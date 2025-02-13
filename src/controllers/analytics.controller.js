const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Analysis = require('../models/analysis.model');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Book, BookChunk } = require('../models/book.model');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

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
6. Count and include the actual number of times each strength and issue is mentioned in the reviews

Analyze this review data: ${JSON.stringify(reviews, null, 2)}`;
};

const generateFollowUpPrompt = (hotel, reviews, previousMessages, previousAnalysis) => {
    return `You are having a conversation about ${hotel.name}'s reviews. Respond naturally and conversationally, focusing only on the specific question asked.

Guidelines:
- Be concise and direct
- Use natural language (not JSON)
- Support points with data
- Include relevant quotes
- Focus only on the asked topic

Previous analysis context:
${previousAnalysis}

Question: ${previousMessages}`;
};

const validateRequestBody = (body) => {
    if (!body) {
        throw new Error('Request body is required');
    }
    
    const { reviews, previousMessages, messages } = body;
    
    if (!Array.isArray(reviews) || reviews.length === 0) {
        throw new Error('Reviews array is required and must not be empty');
    }
    
    return { reviews, previousMessages, messages };
};

const getValidDate = (dateStr) => {
    if (!dateStr) return null;
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
};

const getValidDateRange = (reviews) => {
    const dates = reviews
        .map(review => review.metadata?.originalCreatedAt)
        .filter(date => date != null)
        .map(date => new Date(date))
        .filter(date => !isNaN(date.getTime()));

    if (dates.length === 0) {
        const now = new Date();
        return { start: now, end: now };
    }

    return {
        start: new Date(Math.min(...dates)),
        end: new Date(Math.max(...dates))
    };
};

const getRelevantBookKnowledge = async (reviews) => {
    // Estraiamo le parole chiave più significative dalle recensioni
    const reviewText = reviews.map(r => r.content?.text || '').join(' ');
    const keywords = reviewText
        .toLowerCase()
        .split(/\W+/)
        .filter(word => word.length > 3)
        .filter(word => !['this', 'that', 'with', 'from', 'have', 'were'].includes(word));

    // Cerca nei libri usando text search di MongoDB
    const relevantBooks = await Book.find(
        { $text: { $search: keywords.join(' ') } },
        { score: { $meta: "textScore" } }
    )
    .sort({ score: { $meta: "textScore" } })
    .limit(5);  // prendiamo i 5 libri più rilevanti

    return relevantBooks.map(book => 
        `From "${book.title}" by ${book.author}:\n${book.content}`
    ).join('\n\n');
};

const getBookKnowledge = async () => {
    // Prendiamo tutto il contenuto dei libri
    const books = await Book.find({ processedStatus: 'completed' });
    
    if (books.length === 0) {
        console.warn('No books found in database. Have you run the process-books.js script?');
        return '';
    }

    return books.map(book => 
        `From "${book.title}" by ${book.author}:\n${book.content}`
    ).join('\n\n==========\n\n');
};

const analyticsController = {
    analyzeReviews: async (req, res) => {
        try {
            const { reviews, previousMessages, messages } = validateRequestBody(req.body);
            const userId = req.userId;

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            const creditCost = previousMessages ? 1 : 10;
            const totalCreditsAvailable = (user.wallet?.credits || 0) + (user.wallet?.freeScrapingRemaining || 0);
            
            if (totalCreditsAvailable < creditCost) {
                return res.status(403).json({ 
                    message: 'Insufficient credits available. Please purchase more credits to continue.',
                    type: 'NO_CREDITS'
                });
            }

            const hotel = await Hotel.findById(reviews[0].hotelId);
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            const bookKnowledge = await getBookKnowledge();

            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.metadata?.platform || 'unknown'
            }));

            const avgRating = (reviewsData.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
            const platforms = [...new Set(reviewsData.map(r => r.platform))];

            let systemPrompt;
            if (previousMessages) {
                const lastAnalysis = messages[messages.length - 2].content;
                systemPrompt = generateFollowUpPrompt(hotel, reviewsData, previousMessages, lastAnalysis);
            } else {
                systemPrompt = generateInitialPrompt(hotel, reviewsData, platforms, avgRating);
            }

            const enhancedPrompt = `Use this hospitality industry knowledge to enhance your analysis (but don't mention these sources directly): ${bookKnowledge}\n\n${systemPrompt}`;

            let analysis;
            let provider;
            let suggestions = [];

            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                
                // Forziamo Gemini a rispondere in JSON aggiungendo un prompt più specifico
                const enhancedPromptWithFormat = `${enhancedPrompt}

                IMPORTANT: Your response MUST be a valid JSON object with the exact structure shown above.
                Do not include any explanatory text, markdown formatting, or code blocks.
                Return ONLY the JSON object.`;
                
                const result = await model.generateContent(enhancedPromptWithFormat);
                const response = await result.response;
                analysis = response.text();
                provider = 'gemini';

                if (analysis.includes('```')) {
                    analysis = analysis.replace(/```json\n?|\n?```/g, '').trim();
                }

                // Assicuriamoci che l'analisi sia un oggetto JSON valido
                let parsedAnalysis;
                try {
                    parsedAnalysis = JSON.parse(analysis);
                    analysis = parsedAnalysis;
                } catch (parseError) {
                    console.error('Failed to parse Gemini response as JSON:', parseError);
                    throw new Error('Invalid JSON response from Gemini');
                }

                if (!previousMessages) {
                    const defaultTitle = `Analysis - ${analysis.meta?.hotelName || 'Hotel'} - ${new Date().toLocaleDateString()}`;
                    const dateRange = getValidDateRange(reviews);
                    
                    const savedAnalysis = await Analysis.create({
                        title: defaultTitle,
                        userId,
                        hotelId: reviews[0].hotelId,
                        analysis: analysis,  // Ora è già un oggetto JSON
                        reviewsAnalyzed: reviews.length,
                        provider,
                        metadata: {
                            platforms,
                            dateRange,
                            creditsUsed: creditCost
                        }
                    });

                    analysis = {
                        ...analysis,
                        _id: savedAnalysis._id,
                        title: defaultTitle
                    };

                    const suggestionsMessage = await anthropic.messages.create({
                        model: "claude-3-5-sonnet-20241022",
                        max_tokens: 1000,
                        temperature: 0.7,
                        system: `You are an AI assistant helping hotel managers analyze their reviews.
                                Generate 4-5 follow-up questions that the manager might want to ask YOU about the analysis.
                                The questions should:
                                - Be in English
                                - Be actionable and solution-oriented
                                - Reference specific data from the analysis
                                - Be formulated as direct questions to YOU
                                - Focus on getting specific recommendations and insights
                                
                                Example of GOOD question:
                                "What specific solutions could I implement to address the noise issues mentioned in 35 reviews?"
                                
                                Example of BAD question:
                                "What soundproofing solutions have been tested to address the noise issues mentioned by 35 guests?"
                                
                                Return only a JSON array of strings.`,
                        messages: [
                            {
                                role: "user",
                                content: `Based on this analysis and these reviews, generate relevant follow-up questions that a manager would want to ask YOU:
                                        Analysis: ${analysis}
                                        Reviews: ${JSON.stringify(reviewsData)}`
                            }
                        ]
                    });

                    if (suggestionsMessage?.content?.[0]?.text) {
                        try {
                            suggestions = JSON.parse(suggestionsMessage.content[0].text);
                            await Analysis.findByIdAndUpdate(
                                savedAnalysis._id,
                                { followUpSuggestions: suggestions }
                            );
                        } catch (e) {
                            console.error('Error parsing suggestions:', e);
                            suggestions = [];
                        }
                    }
                }
            } catch (error) {
                console.log('Gemini failed, trying Claude:', error);
                
                try {
                    const message = await anthropic.messages.create({
                        model: "claude-3-5-sonnet-20241022",
                        max_tokens: 4000,
                        temperature: 0,
                        system: "You are an expert hospitality industry analyst.",
                        messages: [
                            {
                                role: "user",
                                content: enhancedPrompt
                            }
                        ]
                    });

                    if (message?.content?.[0]?.text) {
                        analysis = message.content[0].text;
                        provider = 'claude';
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
                provider,
                suggestions
            });

        } catch (error) {
            console.error('Analysis error:', error);
            res.status(500).json({ 
                message: 'Error analyzing reviews',
                error: error.message 
            });
        }
    },

    getAnalyses: async (req, res) => {
        try {
            const userId = req.userId;
            
            const analyses = await Analysis.find({ userId })
                .populate('hotelId', 'name')
                .sort({ createdAt: -1 });

            res.json(analyses);
        } catch (error) {
            console.error('Error fetching analyses:', error);
            res.status(500).json({ 
                message: 'Error fetching analyses',
                error: error.message 
            });
        }
    },

    getAnalysis: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.userId;

            const analysis = await Analysis.findOne({ _id: id, userId })
                .populate('hotelId', 'name');

            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            res.json(analysis);
        } catch (error) {
            console.error('Error fetching analysis:', error);
            res.status(500).json({ 
                message: 'Error fetching analysis',
                error: error.message 
            });
        }
    },

    renameAnalysis: async (req, res) => {
        try {
            const { id } = req.params;
            const { title } = req.body;
            const userId = req.userId;

            if (!title) {
                return res.status(400).json({ message: 'Title is required' });
            }

            const analysis = await Analysis.findOneAndUpdate(
                { _id: id, userId },
                { title },
                { new: true }
            );

            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            res.json(analysis);
        } catch (error) {
            console.error('Error renaming analysis:', error);
            res.status(500).json({ 
                message: 'Error renaming analysis',
                error: error.message 
            });
        }
    },

    deleteAnalysis: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.userId;

            const analysis = await Analysis.findOneAndDelete({ _id: id, userId });

            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            res.json({ message: 'Analysis deleted successfully' });
        } catch (error) {
            console.error('Error deleting analysis:', error);
            res.status(500).json({ 
                message: 'Error deleting analysis',
                error: error.message 
            });
        }
    },

    getFollowUpAnalysis: async (req, res) => {
        try {
            const { id } = req.params;
            const { prompt, previousMessages, messages } = req.body;
            const userId = req.userId;

            const analysis = await Analysis.findOne({ _id: id, userId });
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            const bookKnowledge = await getBookKnowledge();

            const systemPrompt = `You are an expert hospitality industry analyst. Use this hospitality industry knowledge to enhance your analysis (but don't mention these sources directly): ${bookKnowledge}

                Previous analysis context: ${JSON.stringify(analysis.analysis)}
                Previous conversation: ${JSON.stringify(messages)}
                
                Question: ${prompt}
                
                Guidelines:
                1. Use actual data from the analysis and books
                2. Include exact quotes when relevant
                3. Focus on actionable insights
                4. Be specific and data-driven
                5. Respond in a natural, conversational way`;

            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                const result = await model.generateContent(systemPrompt);
                const response = await result.response;
                
                res.json({ 
                    analysis: response.text(),
                    provider: 'gemini'
                });
            } catch (error) {
                console.log('Gemini failed:', error);
                throw new Error('Failed to generate follow-up analysis');
            }
        } catch (error) {
            console.error('Error generating follow-up analysis:', error);
            res.status(500).json({ 
                message: 'Error generating follow-up analysis',
                error: error.message 
            });
        }
    }
};

module.exports = analyticsController;