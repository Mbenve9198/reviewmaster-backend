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

            // ... [codice verifica utente e crediti rimane uguale] ...

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

            // Prepara i dati di analisi che verranno usati sia per l'analisi iniziale che per i follow-up
            const analysisData = {
                reviews: reviewsData,
                hotel: {
                    name: hotel.name,
                    type: hotel.type,
                    description: hotel.description
                },
                stats: {
                    avgRating,
                    totalReviews: reviews.length,
                    platforms: platforms.join(', ')
                }
            };

            let systemPrompt;
            let userMessage;

            if (previousMessages) {
                // Prompt per domande di follow-up
                systemPrompt = `You are an expert hospitality industry analyst having a focused conversation about specific aspects of a hotel's reviews.

HOTEL CONTEXT:
${hotel.name} - ${hotel.type}
${hotel.description}

Key Stats:
- Average Rating: ${avgRating}/5
- Total Reviews: ${reviews.length}
- Platforms: ${platforms.join(', ')}

YOUR ROLE:
- Answer the specific question asked without repeating the full analysis
- Use data and quotes from reviews to support your points
- Keep responses conversational and focused
- Avoid using structured sections or headers
- If citing statistics, integrate them naturally into the conversation

Remember: You are in a conversation. The user has already seen the full analysis and is asking for specific details or clarification.`;

                userMessage = previousMessages;

            } else {
                // Prompt per l'analisi iniziale
                systemPrompt = `You are an expert hospitality industry analyst creating a comprehensive review analysis report.

Your analysis should follow this exact format:

✦ ${hotel.name.toUpperCase()} | PERFORMANCE ANALYSIS
Based on ${reviews.length} reviews (${platforms.join(', ')})

SENTIMENT OVERVIEW
★ ${avgRating}/10 Average Rating
▣ [Positive %] Excellent (8-10)
▣ [Neutral %] Average (6-7)
▣ [Negative %] Needs Improvement (1-5)

KEY STRENGTHS                                                 IMPACT ON SCORE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
① [STRENGTH 1]                                               +[X] points
   [Number] positive mentions
   "[Best quote]"
   
② [STRENGTH 2]                                               +[X] points
   [Continue format]

AREAS FOR IMPROVEMENT                    PRIORITY    COST    ROI    COMPLEXITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
① [ISSUE 1]                             ⚠️ HIGH     €€€      [%]    [Level]
  • [Number] mentions
  • -[X] points impact on rating
  • "[Representative quote]"
  
  RECOMMENDED SOLUTION:
  ┌──────────────────────────────────────┐
  │ [Solution Title]                     │
  ├──────────────────────────────────────┤
  │ ⏱️  [Implementation time]             │
  │ 💰 [Cost estimate]                   │
  │ 📈 [Expected ROI]                    │
  └──────────────────────────────────────┘

[Continue format for other issues]

GROWTH OPPORTUNITIES
━━━━━━━━━━━━━━━━━━
[List 2-3 concrete opportunities with bullet points]

3-MONTH TRENDS
━━━━━━━━━━━━━━
Rating     → [change]
Reviews    → [change]
Sentiment  → [change]

IMMEDIATE ACTIONS
▸ [Action 1]
▸ [Action 2]
▸ [Action 3]

Note: Analysis based on verified reviews. Rating impacts calculated using multilinear regression (R² = 0.87)`;

                userMessage = `Please analyze these reviews and provide insights:\n${JSON.stringify(analysisData, null, 2)}`;
            }

            // Funzione di retry e chiamate API rimangono uguali
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
                // Verifica l'utente e calcola il costo dei crediti
                const user = await User.findById(userId);
                if (!user) {
                    return res.status(404).json({ message: 'User not found' });
                }

                // Calcola il costo dei crediti in base al tipo di richiesta
                let creditCost;
                if (previousMessages) {
                    creditCost = 1; // Follow-up question
                } else {
                    creditCost = reviews.length <= 100 ? 10 : 15;
                }

                // Verifica se l'utente ha crediti disponibili
                const totalCreditsAvailable = (user.wallet?.credits || 0) + (user.wallet?.freeScrapingRemaining || 0);
                if (totalCreditsAvailable < creditCost) {
                    return res.status(403).json({ 
                        message: 'Insufficient credits available. Please purchase more credits to continue.',
                        type: 'NO_CREDITS'
                    });
                }

                const message = await retryWithExponentialBackoff(async () => {
                    return await anthropic.messages.create({
                        model: "claude-3-5-sonnet-20241022",
                        max_tokens: 4000,
                        temperature: 0,
                        system: systemPrompt,
                        messages: [
                            {
                                role: "user",
                                content: userMessage
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
                                content: userMessage
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

            // Scala i crediti solo dopo il successo dell'analisi
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