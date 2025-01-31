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

const generateInitialPrompt = (hotel, reviews, platforms, avgRating) => {
    return `You are an expert hospitality industry analyst. Analyze the reviews and return a JSON object with this exact structure:

{
  "meta": {
    "hotelName": "${hotel.name}",
    "reviewCount": ${reviews.length},
    "avgRating": ${avgRating},
    "platforms": "${platforms.join(', ')}"
  },
  "sentiment": {
    "excellent": "45%",
    "average": "35%",
    "needsImprovement": "20%",
    "distribution": {
      "rating5": "30%",
      "rating4": "25%",
      "rating3": "20%",
      "rating2": "15%",
      "rating1": "10%"
    }
  },
  "strengths": [
    {
      "title": "Location & Accessibility",
      "impact": "+1.2",
      "mentions": 87,
      "quote": "Perfect location, close to train station and attractions",
      "details": "Consistently praised for central location and easy access to public transport",
      "marketingTips": [
        {
          "action": "Create local attractions guide",
          "cost": "€",
          "roi": "125%"
        }
      ]
    }
  ],
  "issues": [
    {
      "title": "Noise Insulation",
      "priority": "HIGH",
      "impact": "-0.9",
      "mentions": 42,
      "quote": "Walls are thin, can hear everything from adjacent rooms",
      "details": "Major issue affecting guest sleep quality and satisfaction",
      "solution": {
        "title": "Comprehensive Sound Proofing",
        "timeline": "3-4 months",
        "cost": "€€€",
        "roi": "180%",
        "steps": [
          "Install soundproof windows",
          "Add wall insulation",
          "Replace door seals"
        ]
      }
    }
  ],
  "quickWins": [
    {
      "action": "Install door dampeners",
      "timeline": "2 weeks",
      "cost": "€",
      "impact": "Medium"
    }
  ],
  "trends": [
    {
      "metric": "Rating",
      "change": "-0.3",
      "period": "3 months"
    }
  ]
}

Guidelines:
1. Use actual data from reviews for all metrics
2. Include exact quotes from reviews
3. Calculate realistic costs and ROI estimates
4. Prioritize based on mention frequency and impact
5. Focus on actionable insights

Analyze this review data: ${JSON.stringify(reviews, null, 2)}`;
};

const generateFollowUpPrompt = (hotel, reviews, previousMessages) => {
    return `You are having a conversation about ${hotel.name}'s reviews. Respond naturally and conversationally, focusing only on the specific question asked.

Guidelines:
- Be concise and direct
- Use natural language (not JSON)
- Support points with data
- Include relevant quotes
- Focus only on the asked topic

Previous context:
${JSON.stringify(reviews.slice(0, 3), null, 2)}

Question: ${previousMessages}`;
};

const analyticsController = {
    analyzeReviews: async (req, res) => {
        try {
            const { reviews, previousMessages } = req.body;
            const userId = req.userId;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const creditCost = previousMessages ? 1 : (reviews.length <= 100 ? 10 : 15);
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
                return res.status(404).json({ message: 'Hotel not found' });
            }

            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.metadata?.platform || 'unknown'
            }));

            const avgRating = (reviewsData.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
            const platforms = [...new Set(reviewsData.map(r => r.platform))];

            const systemPrompt = previousMessages
                ? generateFollowUpPrompt(hotel, reviewsData, previousMessages)
                : generateInitialPrompt(hotel, reviewsData, platforms, avgRating);

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
                        system: "You are an expert hospitality industry analyst.",
                        messages: [
                            {
                                role: "user",
                                content: systemPrompt
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
                                content: "You are an expert hospitality industry analyst."
                            },
                            {
                                role: "user",
                                content: systemPrompt
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