const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Analysis = require('../models/analysis.model');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Book, BookChunk } = require('../models/book.model');
const mongoose = require('mongoose');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generateInitialPrompt = (hotel, reviews, platforms, avgRating) => {
    return `First, carefully study this hospitality industry knowledge and use it as the foundation for your analysis. Your recommendations must reflect these industry best practices and methodologies:

You are an expert hospitality industry analyst. Analyze the reviews and return a JSON object with this exact structure:

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
3. Calculate realistic costs and ROI estimates based on industry standards
4. Prioritize based on mention frequency and impact
5. Focus on actionable insights that align with industry best practices
6. Count and include the actual number of times each strength and issue is mentioned in the reviews
7. Ensure all recommendations follow established hospitality management principles

Analyze this review data: ${JSON.stringify(reviews, null, 2)}`;
};

const generateFollowUpPrompt = (hotel, reviews, previousMessages, previousAnalysis, bookKnowledge) => {
    return `First, analyze this hospitality industry expertise. IMPORTANT: Never cite or reference these sources - use this knowledge as if it were your own expertise:
${bookKnowledge}

You are having a conversation about ${hotel.name}'s reviews. 

Your response should:
- Incorporate industry best practices
- Reference proven methodologies and solutions
- Provide data-backed recommendations
- Use specific industry benchmarks where applicable
- Never mention or cite any sources

FORMAT YOUR RESPONSE:
- Use proper spacing between paragraphs (double line breaks)
- Use **bold** for important terms and numbers
- Use bullet points where appropriate
- Keep a conversational tone while being professional
- Break down complex information into digestible chunks
- Use markdown formatting for better readability

Guidelines:
- Be concise and direct
- Use natural language
- Support points with data
- Focus only on the asked topic

Previous analysis context:
${previousAnalysis}

Question: ${previousMessages}`;
};

const validateRequestBody = (req) => {
    const { hotelId, reviews } = req.body;
    
    if (!hotelId) {
        throw new Error('hotelId is required');
    }
    
    if (!Array.isArray(reviews) || reviews.length === 0) {
        throw new Error('reviews array is required and must not be empty');
    }
    
    return { hotelId, reviews };
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

const generateValuePlanPrompt = (strength, bookKnowledge) => {
    return `Based on this hospitality industry knowledge:
${bookKnowledge}

Create a detailed value maximization plan for this key strength:
${JSON.stringify(strength)}

The plan should:
1. Leverage industry best practices
2. Include specific marketing and operational strategies
3. Provide realistic timelines and cost estimates
4. Focus on ROI and measurable outcomes
5. Consider current market trends

Return a JSON object with this structure:
{
    "title": "Value Maximization Plan for [Strength]",
    "overview": "Brief explanation of the opportunity",
    "strategies": [{
        "title": "Strategy name",
        "description": "Detailed explanation",
        "implementation": {
            "timeline": "Expected duration",
            "cost": "€-€€€€",
            "effort": "low/medium/high"
        },
        "expectedOutcomes": {
            "roi": "Expected ROI",
            "timeline": "When to expect results",
            "metrics": ["Metric 1", "Metric 2"]
        }
    }],
    "risks": [{
        "description": "Risk description",
        "mitigation": "How to mitigate"
    }],
    "nextSteps": ["Step 1", "Step 2", "Step 3"]
}`;
};

const generateSolutionPlanPrompt = (issue, bookKnowledge) => {
    return `Based on this hospitality industry knowledge:
${bookKnowledge}

Create a detailed solution plan for this critical issue:
${JSON.stringify(issue)}

The plan should:
1. Follow industry best practices
2. Include specific actionable steps
3. Provide realistic timelines and cost estimates
4. Focus on long-term resolution
5. Consider guest impact during implementation

Return a JSON object with this structure:
{
    "title": "Resolution Plan for [Issue]",
    "priority": "HIGH/MEDIUM/LOW",
    "overview": "Brief explanation of the problem and solution",
    "phases": [{
        "title": "Phase name",
        "description": "Detailed explanation",
        "steps": ["Step 1", "Step 2", "Step 3"],
        "timeline": "Expected duration",
        "cost": "€-€€€€",
        "impact": "Impact on operations"
    }],
    "resources": {
        "team": ["Role 1", "Role 2"],
        "tools": ["Tool 1", "Tool 2"],
        "training": ["Training 1", "Training 2"]
    },
    "successMetrics": [{
        "metric": "Metric name",
        "target": "Target value",
        "timeline": "When to measure"
    }],
    "contingencyPlan": {
        "risks": ["Risk 1", "Risk 2"],
        "mitigations": ["Mitigation 1", "Mitigation 2"]
    }
}`;
};

const analyticsController = {
    analyzeReviews: async (req, res) => {
        try {
            const { hotelId, reviews: reviewIds } = validateRequestBody(req);
            const userId = req.userId;

            // Verifica hotel
            const hotel = await Hotel.findById(hotelId);
            if (!hotel) {
                return res.status(404).json({ 
                    message: 'Hotel not found',
                    details: `Hotel with ID ${hotelId} does not exist`
                });
            }

            // Verifica user
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Ottieni recensioni complete
            const reviews = await Review.find({
                _id: { $in: reviewIds },
                hotelId: hotelId
            });

            if (!reviews.length) {
                return res.status(404).json({ 
                    message: 'No reviews found',
                    details: 'No reviews found for the given IDs and hotel'
                });
            }

            const creditCost = 10;
            const totalCreditsAvailable = (user.wallet?.credits || 0) + (user.wallet?.freeScrapingRemaining || 0);
            
            if (totalCreditsAvailable < creditCost) {
                return res.status(403).json({ 
                    message: 'Insufficient credits available. Please purchase more credits to continue.',
                    type: 'NO_CREDITS'
                });
            }

            // Leggiamo i libri prima di procedere
            console.log('Fetching book knowledge...');
            const bookKnowledge = await getBookKnowledge();
            console.log('Book knowledge fetched, length:', bookKnowledge.length);

            const reviewsData = reviews.map(review => ({
                content: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || new Date().toISOString(),
                platform: review.metadata?.platform || 'unknown'
            }));

            const avgRating = (reviewsData.reduce((acc, r) => acc + r.rating, 0) / reviews.length).toFixed(1);
            const platforms = [...new Set(reviewsData.map(r => r.platform))];

            let systemPrompt;
            if (req.body.previousMessages) {
                const lastAnalysis = req.body.messages[req.body.messages.length - 2].content;
                systemPrompt = generateFollowUpPrompt(hotel, reviewsData, req.body.previousMessages, lastAnalysis, bookKnowledge);
            } else {
                systemPrompt = generateInitialPrompt(hotel, reviewsData, platforms, avgRating);
            }

            let analysis;
            let provider;
            let suggestions = [];
            let suggestionsMessage;

            try {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                
                if (req.body.previousMessages) {
                    console.log('Sending follow-up prompt to Gemini...');
                    const result = await model.generateContent({
                        contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
                        generationConfig: {
                            temperature: 0.7,
                            topP: 0.8,
                            topK: 40,
                            maxOutputTokens: 1000
                        },
                        safetySettings: [
                            {
                                category: "HARM_CATEGORY_HARASSMENT",
                                threshold: "BLOCK_MEDIUM_AND_ABOVE"
                            },
                            {
                                category: "HARM_CATEGORY_HATE_SPEECH",
                                threshold: "BLOCK_MEDIUM_AND_ABOVE"
                            },
                            {
                                category: "HARM_CATEGORY_SEXUALLY_EXPLICIT",
                                threshold: "BLOCK_MEDIUM_AND_ABOVE"
                            },
                            {
                                category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                                threshold: "BLOCK_MEDIUM_AND_ABOVE"
                            }
                        ]
                    });
                    
                    const response = await result.response;
                    let formattedResponse = response.text()
                        .replace(/\*\*/g, '**') // Assicura che i grassetti siano formattati correttamente
                        .replace(/([.!?])\s*(\n)?/g, '$1\n\n') // Aggiunge spaziatura dopo la punteggiatura
                        .replace(/\n{3,}/g, '\n\n') // Normalizza gli spazi multipli
                        .trim();
                    
                    analysis = formattedResponse;
                    provider = 'gemini';
                    console.log('Received follow-up response from Gemini');
                } else {
                    // Per l'analisi iniziale, usiamo il codice esistente
                    const enhancedPromptWithFormat = `IMPORTANT: THIS IS A JSON-ONLY TASK. YOUR RESPONSE MUST BE A SINGLE VALID JSON OBJECT.

                    Step 1: Read and analyze this hospitality knowledge:
                    ${bookKnowledge}

                    Step 2: Read and analyze these ${reviews.length} reviews:
                    ${systemPrompt}

                    Step 3: Generate a SINGLE JSON OBJECT with this exact structure. DO NOT include any other text:

                    {
                        "meta": {
                            "hotelName": "string",
                            "reviewCount": ${reviews.length},
                            "avgRating": 4.5,
                            "platforms": "string"
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
                        "strengths": [{
                            "title": "string",
                            "impact": "string",
                            "mentions": 0,
                            "quote": "string",
                            "details": "string",
                            "marketingTips": [{
                                "action": "string",
                                "cost": "string",
                                "roi": "string"
                            }]
                        }],
                        "issues": [{
                            "title": "string",
                            "priority": "string",
                            "impact": "string",
                            "mentions": 0,
                            "quote": "string",
                            "details": "string",
                            "solution": {
                                "title": "string",
                                "timeline": "string",
                                "cost": "string",
                                "roi": "string",
                                "steps": ["string"]
                            }
                        }],
                        "quickWins": [{
                            "action": "string",
                            "timeline": "string",
                            "cost": "string",
                            "impact": "string"
                        }],
                        "trends": [{
                            "metric": "string",
                            "change": "string",
                            "period": "string"
                        }]
                    }

                    STRICT JSON RULES:
                    1. Response MUST start with { and end with }
                    2. NO text before or after the JSON
                    3. NO markdown
                    4. NO code blocks
                    5. NO explanations
                    6. NO comments
                    7. ALL strings MUST use double quotes
                    8. Use commas between properties
                    9. Format as a single line (no line breaks)
                    10. ONLY valid JSON syntax is allowed

                    FAILURE TO FOLLOW THESE RULES WILL RESULT IN AN ERROR.
                    YOUR ENTIRE RESPONSE SHOULD BE A SINGLE, VALID JSON OBJECT.`;
                    
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
                if (!req.body.previousMessages) {
                    const defaultTitle = `Analysis - ${analysis.meta?.hotelName || 'Hotel'} - ${new Date().toLocaleDateString()}`;
                    const dateRange = getValidDateRange(reviews);
                    
                    const savedAnalysis = await Analysis.create({
                        title: defaultTitle,
                        userId,
                        hotelId: hotelId,
                        analysis: analysis,
                        reviewsAnalyzed: reviews.length,
                        reviewIds: reviews.map(r => r._id),
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

                    // Generiamo i suggerimenti
                    console.log('Generating suggestions with Gemini...');
                    const suggestionsPrompt = `You are an AI assistant helping hotel managers analyze their reviews.
                    Generate 4-5 follow-up questions that the manager might want to ask about this analysis.
                    The questions should:
                    - Be in English
                    - Be actionable and solution-oriented
                    - Reference specific data from the analysis
                    - Be formulated as direct questions
                    - Focus on getting specific recommendations and insights

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
                _id: analysis._id,
                analysis,
                provider,
                suggestions,
                suggestionsMessage
            });
        } catch (error) {
            console.error('Error in analyzeReviews:', error);
            return res.status(500).json({ 
                message: 'Error in analyzeReviews',
                details: error.message 
            });
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
            const analysisId = req.params.id;
            const userId = req.userId;

            // Verifica se l'ID è un ObjectId valido
            if (!mongoose.Types.ObjectId.isValid(analysisId)) {
                return res.status(400).json({ 
                    message: 'Invalid analysis ID format',
                    details: 'The provided ID is not in the correct format'
                });
            }

            const analysis = await Analysis.findOne({ 
                _id: analysisId,
                userId: userId
            });

            if (!analysis) {
                return res.status(404).json({ 
                    message: 'Analysis not found',
                    details: 'No analysis found with the provided ID for this user'
                });
            }

            return res.status(200).json(analysis);
        } catch (error) {
            console.error('Error in getAnalysis:', error);
            return res.status(500).json({ 
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

            const analysis = await Analysis.findOne({ _id: id, userId })
                .populate('hotelId');

            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            // Ottieni le recensioni associate all'analisi originale
            const reviews = await Review.find({ 
                hotelId: analysis.hotelId._id,
                _id: { $in: analysis.reviewsAnalyzed } // Assumendo che tu stia salvando gli ID delle recensioni
            });

            // Modifica la chiamata a analyzeReviews
            const modifiedReq = {
                ...req,
                body: {
                    hotelId: analysis.hotelId._id,
                    reviews: reviews.map(r => r._id), // Passa gli ID delle recensioni
                    question: question,
                    previousMessages: question,
                    messages: [
                        { role: 'assistant', content: JSON.stringify(analysis.analysis) },
                        { role: 'user', content: question }
                    ]
                },
                userId: userId
            };

            return await analyticsController.analyzeReviews(modifiedReq, res);
        } catch (error) {
            console.error('Error in getFollowUpAnalysis:', error);
            return res.status(500).json({ 
                message: 'Error getting follow-up analysis',
                error: error.message 
            });
        }
    },

    getValuePlan: async (req, res) => {
        try {
            const { strength } = req.body;
            if (!strength) {
                return res.status(400).json({ message: 'Strength data is required' });
            }

            const bookKnowledge = await getBookKnowledge();
            const prompt = generateValuePlanPrompt(strength, bookKnowledge);

            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.7,
                    topP: 0.8,
                    topK: 40
                }
            });

            const response = await result.response;
            let text = response.text();
            
            // Rimuovi i backticks e l'identificatore "json" se presenti
            text = text.replace(/```json\n/g, '').replace(/```/g, '');
            
            // Ora prova a parsare il JSON pulito
            const plan = JSON.parse(text.trim());

            return res.status(200).json(plan);
        } catch (error) {
            console.error('Error in getValuePlan:', error);
            return res.status(500).json({ message: 'Error generating value plan' });
        }
    },

    getSolutionPlan: async (req, res) => {
        try {
            const { issue } = req.body;
            console.log('Received issue data:', issue); // Log per debug

            if (!issue) {
                return res.status(400).json({ message: 'Issue data is required' });
            }

            const bookKnowledge = await getBookKnowledge();
            const prompt = generateSolutionPlanPrompt(issue, bookKnowledge);

            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
            
            try {
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        topP: 0.8,
                        topK: 40
                    }
                });

                const response = await result.response;
                let text = response.text();
                
                // Log per debug
                console.log('Raw Gemini response:', text);
                
                // Pulizia più aggressiva del JSON
                text = text.replace(/```json\s*|\s*```/g, '');
                text = text.replace(/^[^{]*/, '');
                text = text.replace(/}[^}]*$/, '}');
                text = text.trim();
                
                console.log('Cleaned response:', text);
                
                try {
                    const plan = JSON.parse(text);
                    
                    // Invia il piano come risposta e anche come messaggio di follow-up
                    return res.status(200).json({
                        plan,
                        message: `Ecco il piano di risoluzione per "${issue.title}":

${JSON.stringify(plan, null, 2)}`
                    });
                } catch (parseError) {
                    console.error('Failed to parse Gemini response:', parseError);
                    return res.status(500).json({ 
                        message: 'Invalid JSON response from Gemini',
                        error: parseError.message,
                        rawResponse: text
                    });
                }
            } catch (geminiError) {
                // Gestione specifica dell'errore di quota
                if (geminiError.status === 429) {
                    return res.status(429).json({
                        message: 'API quota exceeded. Please try again later.',
                        error: 'QUOTA_EXCEEDED'
                    });
                }
                throw geminiError;
            }
        } catch (error) {
            console.error('Error in getSolutionPlan:', error);
            return res.status(500).json({ 
                message: 'Error generating solution plan',
                error: error.message
            });
        }
    },

    getGroupedReviews: async (req, res) => {
        try {
            const { id, category, itemId } = req.params;
            const userId = req.userId;

            // Trova l'analisi
            const analysis = await Analysis.findOne({ 
                _id: id, 
                userId 
            }).populate({
                path: 'reviewIds',
                select: 'text rating metadata.platform metadata.originalCreatedAt'
            });

            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            // Trova il gruppo specifico di recensioni
            let targetGroup;
            if (category === 'strengths') {
                targetGroup = analysis.analysis.strengths.find(s => s._id.toString() === itemId);
            } else if (category === 'issues') {
                targetGroup = analysis.analysis.issues.find(i => i._id.toString() === itemId);
            }

            if (!targetGroup) {
                return res.status(404).json({ 
                    message: `${category} group not found` 
                });
            }

            // Se il gruppo ha relatedReviews, usali per filtrare le recensioni
            let groupedReviews = [];
            if (targetGroup.relatedReviews && targetGroup.relatedReviews.length > 0) {
                groupedReviews = targetGroup.relatedReviews.map(related => {
                    const review = analysis.reviewIds.find(r => r._id.toString() === related.reviewId.toString());
                    if (review) {
                        return {
                            id: review._id,
                            text: related.relevantText || review.text,
                            rating: review.rating,
                            date: review.metadata?.originalCreatedAt || review.createdAt,
                            platform: review.metadata?.platform || 'Unknown'
                        };
                    }
                    return null;
                }).filter(Boolean);
            } else {
                // Se non ci sono relatedReviews, restituisci tutte le recensioni
                groupedReviews = analysis.reviewIds.map(review => ({
                    id: review._id,
                    text: review.text,
                    rating: review.rating,
                    date: review.metadata?.originalCreatedAt || review.createdAt,
                    platform: review.metadata?.platform || 'Unknown'
                }));
            }

            return res.status(200).json({
                title: targetGroup.title,
                count: groupedReviews.length,
                reviews: groupedReviews
            });

        } catch (error) {
            console.error('Error in getGroupedReviews:', error);
            return res.status(500).json({ 
                message: 'Error fetching grouped reviews',
                error: error.message 
            });
        }
    }
};

module.exports = analyticsController;