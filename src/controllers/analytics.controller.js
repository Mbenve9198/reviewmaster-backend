const Anthropic = require('@anthropic-ai/sdk');

const analyticsController = {
    analyzeReviews: async (req, res) => {
        try {
            const { reviews, prompt } = req.body;
            const userId = req.userId;

            if (!Array.isArray(reviews) || reviews.length === 0) {
                return res.status(400).json({ 
                    message: 'Reviews array is required and must not be empty' 
                });
            }

            // Inizializza il client Claude
            const anthropic = new Anthropic({
                apiKey: process.env.CLAUDE_API_KEY,
            });

            // Prepara i dati delle recensioni in un formato più sicuro
            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.metadata?.platform || 'unknown'
            }));

            // Costruisci il prompt per l'analisi
            const systemPrompt = `You are an expert hotel review analyst. Analyze the following ${reviews.length} reviews and provide insights based on the user's request.

Key guidelines:
- Base patterns on minimum 10 reviews
- Provide evidence from reviews for each insight
- Prioritize by impact
- Suggest concrete, actionable solutions when relevant
- Be objective and data-driven
- Format the response with clear sections and bullet points
- Respond in the same language as the prompt

The reviews data is provided in a structured format with ratings, text, dates and platforms.`;

            // Esegui l'analisi con Claude
            const message = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 1000,
                temperature: 0,
                system: systemPrompt,
                messages: [
                    {
                        role: "user",
                        content: `${prompt}\n\nReviews data:\n${JSON.stringify(reviewsData, null, 2)}`
                    }
                ]
            });

            if (!message?.content?.[0]?.text) {
                throw new Error('Invalid response from AI');
            }

            res.json({ 
                analysis: message.content[0].text,
                reviewsAnalyzed: reviews.length
            });

        } catch (error) {
            console.error('Review analysis error:', error);
            res.status(500).json({ 
                message: 'Error analyzing reviews',
                error: error.message 
            });
        }
    }
};

module.exports = analyticsController; 