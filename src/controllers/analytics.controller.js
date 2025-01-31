const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const analyticsController = {
    analyzeReviews: async (req, res) => {
        try {
            const { reviews, previousMessages } = req.body;
            const userId = req.userId;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            let creditCost;
            if (previousMessages) {
                creditCost = 1;
            } else {
                creditCost = reviews.length <= 100 ? 10 : 15;
            }

            const totalCreditsAvailable = (user.wallet?.credits || 0) + (user.wallet?.freeScrapingRemaining || 0);
            if (totalCreditsAvailable < creditCost) {
                return res.status(403).json({ 
                    message: 'Insufficient credits available. Please purchase more credits to continue.',
                    type: 'NO_CREDITS'
                });
            }

            if (!Array.isArray(reviews) || reviews.length === 0) {
                return res.status(400).json({ 
                    message: 'Reviews array is required and must not be empty' 
                });
            }

            const hotel = await Hotel.findById(reviews[0].hotelId);
            if (!hotel) {
                return res.status(404).json({ 
                    message: 'Hotel not found' 
                });
            }

            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.metadata?.platform || 'unknown'
            }));

            const analysisData = {
                reviews: reviewsData,
                hotel: {
                    name: hotel.name,
                    type: hotel.type,
                    description: hotel.description
                }
            };

            const avgRating = (reviewsData.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
            const platforms = [...new Set(reviewsData.map(r => r.platform))];
            
            let systemPrompt;
            if (previousMessages) {
                systemPrompt = `You are an expert hospitality industry analyst with over 20 years of experience. Respond to the user's question in a conversational and natural way, always considering the hotel's context:

HOTEL CONTEXT:
${hotel.name} (${hotel.type})
${hotel.description}

Keep your responses:
- Concrete and practical
- Specific to this hotel
- Realistic considering size and resources
- Data-supported when possible
- Professional yet conversational in tone

Previous analysis context is provided to help you refer to specific insights and data points when answering follow-up questions.`;
            } else {
                systemPrompt = `You are an expert hospitality industry analyst with over 20 years of experience. Your task is to provide a comprehensive analysis of a hotel based on review data and the hotel's information. Your analysis should be thorough, data-driven, and result in actionable insights for the hotel management.

First, carefully review the following review data for this hotel:

<review_data>
${JSON.stringify(reviewsData, null, 2)}
</review_data>

Now, analyze the hotel information:

<hotel_info>
Name: ${hotel.name}
Type: ${hotel.type}
Description: ${hotel.description}
</hotel_info>

Before producing your final report, wrap your analysis inside <detailed_analysis> tags. Consider the following:
1. Overall patterns in the review data
2. Key problems mentioned frequently
3. Notable strengths of the hotel
4. Potential solutions and improvements, taking into account the hotel's size, type, and resources
5. Opportunities for marketing and development

In your analysis:
- Categorize reviews into positive, negative, and neutral, counting each category.
- List out specific problems mentioned, numbering each one and keeping a count.
- List out specific strengths mentioned, numbering each one and keeping a count.
- Explicitly consider how the hotel's context (size, type, location) affects each point.
- Quote relevant parts of reviews to support your points.

<detailed_analysis>
[Your detailed analysis goes here. Show your reasoning for each point you'll include in the final report.]
</detailed_analysis>

After your analysis, provide a comprehensive report in the following format:

====================
📊 PANORAMICA
====================
<review_stats>
- Rating medio: ${avgRating}/5
- Recensioni analizzate: ${reviews.length}
- Periodo: [oldest date] - [newest date]
- Piattaforme: ${platforms.join(', ')}
</review_stats>

====================
⚠️ PROBLEMI CHIAVE
====================
[For each problem mentioned in at least 3 reviews]

PROBLEMA: [Title]
Frequenza: [X reviews out of ${reviews.length}]
> "[Most representative quote]"
Impatto: [ALTO/MEDIO/BASSO]

SOLUZIONE PROPOSTA:
- Concrete action to implement (considering the hotel's size and resources)
- Estimated implementation time
- Estimated cost (€/€€/€€€)
- Expected ROI
- Feasibility based on the hotel's context

====================
💪 PUNTI DI FORZA
====================
[For each frequently mentioned strength]

PUNTO DI FORZA: [Title]
Menzionato in: [X reviews]
> "[Most effective quote for marketing]"
Come valorizzarlo:
- Marketing suggestion suitable for the hotel's size
- Realistic development opportunities for this type of hotel

Remember:
- Use quantitative data where possible
- ALWAYS cite the source (e.g., "mentioned in 5 reviews on Booking")
- Do not include patterns mentioned fewer than 3 times
- Prioritize based on business impact
- Suggest only concrete and feasible actions for this specific hotel
- If there's insufficient data for analysis, specify this
- Always include a verbatim quote for each point
- Consider the hotel's context and size in all recommendations`;
            }

            const retryWithExponentialBackoff = async (fn, maxRetries = 3, initialDelay = 1000) => {
                for (let i = 0; i < maxRetries; i++) {
                    try {
                        return await fn();
                    } catch (error) {
                        if (error?.error?.type === 'overloaded_error' && i < maxRetries - 1) {
                            const delay = initialDelay * Math.pow(2, i);
                            await new Promise(resolve => setTimeout(resolve, delay));
                            continue;
                        }
                        throw error;
                    }
                }
            };

            let analysis;
            let provider;
            
            try {
                const message = await retryWithExponentialBackoff(async () => {
                    return await anthropic.messages.create({
                        model: "claude-3-5-sonnet-20241022",
                        max_tokens: 4000,
                        temperature: 0,
                        system: systemPrompt,
                        messages: [
                            {
                                role: "user",
                                content: previousMessages ? 
                                    `Context from previous analysis:\n${JSON.stringify(analysisData, null, 2)}\n\nUser question: ${previousMessages}` :
                                    systemPrompt
                            }
                        ]
                    });
                });

                if (message?.content?.[0]?.text) {
                    analysis = message.content[0].text;
                    provider = 'claude';
                }
            } catch (claudeError) {
                console.log('Claude failed, trying OpenAI:', claudeError);
                
                try {
                    const completion = await openai.chat.completions.create({
                        model: "gpt-4o",
                        messages: [
                            {
                                role: "system",
                                content: systemPrompt
                            },
                            {
                                role: "user",
                                content: previousMessages ? 
                                    `Context from previous analysis:\n${JSON.stringify(analysisData, null, 2)}\n\nUser question: ${previousMessages}` :
                                    `Review data to analyze:\n${JSON.stringify(analysisData, null, 2)}`
                            }
                        ],
                        temperature: 0,
                        max_tokens: 4000
                    });

                    if (completion?.choices?.[0]?.message?.content) {
                        analysis = completion.choices[0].message.content;
                        provider = 'gpt4';
                    }
                } catch (openaiError) {
                    console.error('OpenAI fallback failed:', openaiError);
                    throw new Error('Both AI services failed to generate analysis');
                }
            }

            if (!analysis) {
                throw new Error('Failed to generate analysis from both AI services');
            }

            let freeCreditsToDeduct = Math.min(user.wallet?.freeScrapingRemaining || 0, creditCost);
            let paidCreditsToDeduct = creditCost - freeCreditsToDeduct;

            await User.findByIdAndUpdate(userId, {
                $inc: { 
                    'wallet.credits': -paidCreditsToDeduct,
                    'wallet.freeScrapingRemaining': -freeCreditsToDeduct
                }
            });

            res.json({ 
                analysis,
                reviewsAnalyzed: reviews.length,
                avgRating,
                platforms,
                creditsRemaining: totalCreditsAvailable - creditCost,
                provider
            });

        } catch (error) {
            console.error('Analysis error:', error);
            res.status(500).json({ 
                message: 'Error analyzing reviews',
                error: error.message 
            });
        }
    }
};

module.exports = analyticsController;