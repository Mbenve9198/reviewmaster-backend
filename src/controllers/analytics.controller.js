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

const generateInitialPrompt = (hotel, reviews, platforms, avgRating, bookKnowledge) => {
    return `First, carefully read and internalize this hospitality industry knowledge (but NEVER mention these sources directly):
${bookKnowledge}

Now, as an expert hospitality industry analyst enriched with this knowledge, analyze the reviews and return a JSON object with this exact structure:

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
3. Calculate realistic costs and ROI estimates based on industry knowledge
4. Prioritize based on mention frequency, impact, and industry best practices
5. Focus on actionable insights supported by both reviews and industry expertise
6. Count and include the actual number of times each strength and issue is mentioned in the reviews
7. Ensure all recommendations align with current hospitality industry standards and practices

Analyze this review data: ${JSON.stringify(reviews, null, 2)}`;
};

const generateFollowUpPrompt = (hotel, reviews, previousMessages, previousAnalysis, bookKnowledge) => {
    return `Use this hospitality industry knowledge to enhance your response (but don't mention these sources directly):
${bookKnowledge}

You are having a conversation about ${hotel.name}'s reviews. Respond naturally and conversationally, focusing only on the specific question asked.

Guidelines:
- Be concise and direct
- Use natural language
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
    const books = await Book.find({ processedStatus: 'completed' });
    
    if (books.length === 0) {
        console.warn('No books found in database.');
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

            // Leggiamo i libri prima di procedere
            console.log('Fetching book knowledge...');
            const bookKnowledge = await getBookKnowledge();
            console.log('Book knowledge fetched, length:', bookKnowledge.length);
            console.log('Sample of book knowledge:', bookKnowledge.substring(0, 200) + '...');  // Log per vedere l'inizio del contenuto

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
                systemPrompt = generateFollowUpPrompt(hotel, reviewsData, previousMessages, lastAnalysis, bookKnowledge);
                console.log('Generated follow-up prompt with book knowledge');
            } else {
                systemPrompt = generateInitialPrompt(hotel, reviewsData, platforms, avgRating, bookKnowledge);
                console.log('Generated initial prompt with book knowledge');
            }

            let analysis;
            let provider;
            let suggestions = [];
            let suggestionsMessage;

            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                
                if (previousMessages) {
                    console.log('Sending follow-up prompt to Gemini...');
                    const result = await model.generateContent({
                        contents: [{ 
                            role: 'user', 
                            parts: [{ 
                                text: `Before answering, carefully read and consider this hospitality industry knowledge (but don't mention these sources):
                                      ${bookKnowledge}
                                      
                                      Now, based on this knowledge and the previous analysis, answer the following:
                                      ${systemPrompt}` 
                            }] 
                        }],
                        generationConfig: {
                            temperature: 0.7,
                            topP: 0.8,
                            topK: 40
                        }
                    });
                    
                    const response = await result.response;
                    analysis = response.text();
                    provider = 'gemini';
                    console.log('Received follow-up response from Gemini');
                } else {
                    // Per l'analisi iniziale
                    const enhancedPromptWithFormat = `IMPORTANT: THIS IS A JSON-ONLY TASK. YOUR RESPONSE MUST BE A SINGLE VALID JSON OBJECT.

                    Step 1: Read and internalize this hospitality industry knowledge (but NEVER mention these sources):
                    ${bookKnowledge}

                    Step 2: Read and analyze these ${reviews.length} reviews:
                    ${systemPrompt}

                    Step 3: Generate a SINGLE JSON OBJECT that incorporates both the review analysis AND insights from the industry knowledge...`;
                    
                    const result = await model.generateContent({
                        contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
                        generationConfig: {
                            temperature: 0.1,
                            topP: 0.1,
                            topK: 1
                        }
                    });
                    
                    const response = await result.response;
                    let rawText = response.text();
                    
                    // Log per debug
                    console.log('Raw Gemini response:', rawText);
                    
                    // Pulizia più aggressiva
                    rawText = rawText.replace(/```json\n?|\n?```/g, '');
                    rawText = rawText.replace(/^[^{]*/, '');  // Rimuove tutto prima della prima {
                    rawText = rawText.replace(/}[^}]*$/, '}'); // Rimuove tutto dopo l'ultima }
                    rawText = rawText.trim();
                    
                    // Log dopo la pulizia
                    console.log('Cleaned response:', rawText);
                    
                    try {
                        analysis = JSON.parse(rawText);
                        provider = 'gemini';
                    } catch (parseError) {
                        console.error('Failed to parse Gemini response as JSON:', parseError);
                        console.error('Raw response:', rawText);
                        throw new Error('Invalid JSON response from Gemini');
                    }
                }

                // Salviamo l'analisi nel database se non è un follow-up
                if (!previousMessages) {
                    const defaultTitle = `Analysis - ${analysis.meta?.hotelName || 'Hotel'} - ${new Date().toLocaleDateString()}`;
                    const dateRange = getValidDateRange(reviews);
                    
                    const savedAnalysis = await Analysis.create({
                        title: defaultTitle,
                        userId,
                        hotelId: reviews[0].hotelId,
                        analysis: analysis,
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

                    // Per i suggerimenti
                    console.log('Generating suggestions with Gemini...');
                    const suggestionsPrompt = `First, carefully read this hospitality industry knowledge (but don't mention these sources):
                    ${bookKnowledge}

                    Now, as an expert enriched with this knowledge, generate 4-5 follow-up questions about this analysis.
                    The questions should:
                    - Be in English
                    - Be actionable and solution-oriented
                    - Reference specific data from the analysis
                    - Incorporate industry best practices and standards
                    - Focus on getting specific recommendations and insights
                    - Bridge the gap between the current situation and industry best practices

                    Return ONLY a JSON array of strings, no other text.
                    Example format: ["question 1", "question 2", "question 3"]

                    Analysis to generate questions about:
                    ${JSON.stringify(analysis)}`;

                    const suggestionsResult = await model.generateContent({
                        contents: [{ role: 'user', parts: [{ text: suggestionsPrompt }] }],
                        generationConfig: {
                            temperature: 0.7
                        }
                    });

                    const suggestionsResponse = await suggestionsResult.response;
                    try {
                        suggestions = JSON.parse(suggestionsResponse.text());
                        console.log('Successfully generated suggestions:', suggestions);
                    } catch (e) {
                        console.error('Failed to parse suggestions response:', e);
                        suggestions = [];
                    }
                }
            } catch (error) {
                console.error('Error in analysis:', error);
                throw new Error('Error in analysis');
            }

            return res.status(200).json({
                analysis,
                provider,
                suggestions,
                suggestionsMessage
            });
        } catch (error) {
            console.error('Error in analyzeReviews:', error);
            return res.status(500).json({ message: 'Error in analyzeReviews' });
        }
    },

    // Aggiungiamo le funzioni mancanti
    getAnalyses: async (req, res) => {
        try {
            const userId = req.userId;
            const analyses = await Analysis.find({ userId })
                .sort({ createdAt: -1 })
                .select('title metadata createdAt analysis.meta');
            
            return res.status(200).json(analyses);
        } catch (error) {
            console.error('Error in getAnalyses:', error);
            return res.status(500).json({ message: 'Error fetching analyses' });
        }
    },

    getAnalysis: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.userId;

            const analysis = await Analysis.findOne({ _id: id, userId });
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            return res.status(200).json(analysis);
        } catch (error) {
            console.error('Error in getAnalysis:', error);
            return res.status(500).json({ message: 'Error fetching analysis' });
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

            return res.status(200).json(analysis);
        } catch (error) {
            console.error('Error in renameAnalysis:', error);
            return res.status(500).json({ message: 'Error renaming analysis' });
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

            return res.status(200).json({ message: 'Analysis deleted successfully' });
        } catch (error) {
            console.error('Error in deleteAnalysis:', error);
            return res.status(500).json({ message: 'Error deleting analysis' });
        }
    },

    getFollowUpAnalysis: async (req, res) => {
        try {
            const { id } = req.params;
            const { question } = req.body;
            const userId = req.userId;

            if (!question) {
                return res.status(400).json({ message: 'Question is required' });
            }

            const analysis = await Analysis.findOne({ _id: id, userId });
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            // Riutilizziamo la logica esistente di analyzeReviews
            const response = await analyticsController.analyzeReviews({
                ...req,
                body: {
                    ...req.body,
                    previousMessages: question,
                    messages: [
                        { role: 'assistant', content: JSON.stringify(analysis.analysis) },
                        { role: 'user', content: question }
                    ]
                }
            }, res);

            return response;
        } catch (error) {
            console.error('Error in getFollowUpAnalysis:', error);
            return res.status(500).json({ message: 'Error getting follow-up analysis' });
        }
    }
};

module.exports = analyticsController;