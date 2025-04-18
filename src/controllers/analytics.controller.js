const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Analysis = require('../models/analysis.model');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { Book, BookChunk } = require('../models/book.model');
const mongoose = require('mongoose');
const creditService = require('../services/creditService');

const anthropic = new Anthropic({
    apiKey: process.env.CLAUDE_API_KEY
});

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY
});

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Aggiungi funzione di delay per gestire i limiti di quota
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const generatePhase1Prompt = (hotel, reviews, platforms, avgRating) => {
    const reviewsForAnalysis = reviews.map((review, index) => ({
        id: review._id.toString(),
        text: review.content?.text || '',
        rating: review.content?.rating || 0,
        platform: review.platform,
        date: review.metadata?.originalCreatedAt || new Date().toISOString()
    }));

    return `You are an expert hospitality industry analyst. Focus ONLY on basic analysis of these hotel reviews.

CRITICALLY IMPORTANT: The "reviewCount" field in the meta section MUST BE SET TO ${reviews.length}. This is the exact number of reviews being analyzed. Do not alter this number.

Review data for analysis: ${JSON.stringify(reviewsForAnalysis, null, 2)}

Return a JSON object with ONLY these fields - NO OTHER FIELDS:
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
    "summary": "Brief interpretative summary of the sentiment distribution, highlighting significant patterns and what they mean for the hotel's reputation (2-3 sentences).",
    "distribution": {
      "rating5": "30%",
      "rating4": "25%",
      "rating3": "20%",
      "rating2": "15%",
      "rating1": "10%"
    }
  },
  "trends": [
    {
      "metric": "Rating",
      "change": "-0.3",
      "period": "3 months"
    },
    {
      "metric": "Positive Mentions",
      "change": "+5%",
      "period": "6 months"
    },
    {
      "metric": "Negative Mentions",
      "change": "-2%",
      "period": "6 months"
    }
  ]
}

Calculate actual percentages based on the review data. For trends, analyze how ratings and sentiment have changed over time by grouping reviews by date.`;
};

const generatePhase2Prompt = (hotel, reviews, bookKnowledge, phase1Analysis) => {
    const reviewsForAnalysis = reviews.map((review, index) => ({
        id: review._id.toString(),
        text: review.content?.text || '',
        rating: review.content?.rating || 0,
        platform: review.platform,
        date: review.metadata?.originalCreatedAt || new Date().toISOString()
    }));

    return `First, carefully study this hospitality industry knowledge and use it as the foundation for your analysis. Your recommendations must reflect these industry best practices and methodologies:
${bookKnowledge}

You are an expert hospitality industry analyst. FOCUS ONLY ON IDENTIFYING THE TOP 3 STRENGTHS from these hotel reviews.

IMPORTANT ABOUT REVIEW IDs: Only include in "relatedReviews" the IDs that are ACTUALLY IN THE REVIEW DATA PROVIDED. Never invent or create IDs. Only use the exact "_id" values from the reviewsForAnalysis array. Do not modify these IDs in any way.

IMPORTANT: For each strength, calculate the TOTAL number of reviews that mention it and put this TOTAL COUNT in the "mentions" field. However, in the "relatedReviews" array, include ONLY THE TOP 50 MOST REPRESENTATIVE review IDs - this means the most clear examples that demonstrate this strength.

Previous analysis context:
${JSON.stringify(phase1Analysis, null, 2)}

Review data for analysis: ${JSON.stringify(reviewsForAnalysis, null, 2)}

Return a JSON object with ONLY this exact structure - NO OTHER FIELDS:
{
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
      ],
      "relatedReviews": ["id1", "id2", "id3"]
    }
  ]
}

Use your hospitality industry knowledge to:
1. Identify truly meaningful strengths (not superficial ones)
2. Create impactful marketing tips based on industry best practices
3. Quantify the impact of each strength accurately
4. Include only real quotes from the review data
5. Provide detailed explanations that demonstrate industry expertise`;
};

const generatePhase3Prompt = (hotel, reviews, bookKnowledge, phase1Analysis) => {
    const reviewsForAnalysis = reviews.map((review, index) => ({
        id: review._id.toString(),
        text: review.content?.text || '',
        rating: review.content?.rating || 0,
        platform: review.platform,
        date: review.metadata?.originalCreatedAt || new Date().toISOString()
    }));

    return `First, carefully study this hospitality industry knowledge and use it as the foundation for your analysis. Your recommendations must reflect these industry best practices and methodologies:
${bookKnowledge}

You are an expert hospitality industry analyst. FOCUS ONLY ON IDENTIFYING KEY ISSUES AND AREAS FOR IMPROVEMENT from these hotel reviews.

IMPORTANT ABOUT REVIEW IDs: Only include in "relatedReviews" the IDs that are ACTUALLY IN THE REVIEW DATA PROVIDED. Never invent or create IDs. Only use the exact "_id" values from the reviewsForAnalysis array. Do not modify these IDs in any way.

IMPORTANT: For each issue, calculate the TOTAL number of reviews that mention it and put this TOTAL COUNT in the "mentions" field. However, in the "relatedReviews" array, include ONLY THE TOP 50 MOST REPRESENTATIVE review IDs - this means the most clear examples that demonstrate this issue.

Previous analysis context:
${JSON.stringify(phase1Analysis, null, 2)}

Review data for analysis: ${JSON.stringify(reviewsForAnalysis, null, 2)}

Return a JSON object with ONLY this exact structure - NO OTHER FIELDS:
{
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
      },
      "relatedReviews": ["id1", "id2", "id3"]
    }
  ]
}

Use your hospitality industry knowledge to:
1. Identify genuine problems (not just minor complaints)
2. Prioritize issues based on guest impact and frequency
3. Create comprehensive solutions based on industry best practices
4. Provide realistic timelines, costs, and ROI estimates
5. Include detailed implementation steps that show industry expertise`;
};

const generatePhase4Prompt = (hotel, combinedAnalysis, bookKnowledge) => {
    return `First, carefully study this hospitality industry knowledge and use it as the foundation for your analysis. Your recommendations must reflect these industry best practices and methodologies:
${bookKnowledge}

You are an expert hospitality industry analyst. FOCUS ONLY ON GENERATING QUICK WINS from this combined analysis of hotel reviews.

Previous analysis context:
${JSON.stringify(combinedAnalysis, null, 2)}

Return a JSON object with ONLY this exact structure - NO OTHER FIELDS:
{
  "quickWins": [
    {
      "action": "Install door dampeners",
      "timeline": "2 weeks",
      "cost": "€",
      "impact": "Medium"
    }
  ],
  "followUpSuggestions": [
    "What specific steps can we take to improve our breakfast offering based on the reviews?",
    "How can we better communicate our sustainability initiatives to guests?"
  ]
}

Use your hospitality industry knowledge to:
1. Identify 3-5 truly impactful quick wins that can be implemented rapidly
2. Ensure each quick win addresses a real issue identified in the analysis
3. Provide realistic timelines, costs, and impact assessments
4. Create 4-5 follow-up suggestions that would provide valuable insights
5. Make all recommendations specific to this hotel's situation, not generic`;
};

const generateInitialPrompt = (hotel, reviews, platforms, avgRating) => {
    const reviewsForAnalysis = reviews.map((review, index) => ({
        id: review._id.toString(),
        text: review.content?.text || '',
        rating: review.content?.rating || 0,
        platform: review.platform,
        date: review.metadata?.originalCreatedAt || new Date().toISOString()
    }));

    return `First, carefully study this hospitality industry knowledge and use it as the foundation for your analysis. Your recommendations must reflect these industry best practices and methodologies:

You are an expert hospitality industry analyst. Analyze the reviews and return a JSON object with this exact structure.

CRITICALLY IMPORTANT: The "reviewCount" field in the meta section MUST BE SET TO ${reviews.length}. This is the exact number of reviews being analyzed. Do not alter this number.

IMPORTANT ABOUT REVIEW IDs: Only include in "relatedReviews" the IDs that are ACTUALLY IN THE REVIEW DATA PROVIDED. Never invent or create IDs. Only use the exact "_id" values from the reviewsForAnalysis array. Do not modify these IDs in any way.

IMPORTANT: For each strength and issue, calculate the TOTAL number of reviews that mention it and put this TOTAL COUNT in the "mentions" field. However, in the "relatedReviews" array, include ONLY THE TOP 50 MOST REPRESENTATIVE review IDs - this means the most clear examples that demonstrate this strength or issue. Ensure that the "mentions" count and the number of IDs in "relatedReviews" are consistent - never claim more reviews mention a topic than you have valid IDs for.

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
    "summary": "Brief interpretative summary of the sentiment distribution, highlighting significant patterns and what they mean for the hotel's reputation (2-3 sentences).",
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
      "mentions": 87,  // If you specify 87 mentions, you must include 87 related reviews
      "quote": "Perfect location, close to train station and attractions",
      "details": "Consistently praised for central location and easy access to public transport",
      "marketingTips": [
        {
          "action": "Create local attractions guide",
          "cost": "€",
          "roi": "125%"
        }
      ],
      "relatedReviews": ["mongoid_here_1", "mongoid_here_2", "mongoid_here_87"]
    }
  ],
  "issues": [
    {
      "title": "Noise Insulation",
      "priority": "HIGH",
      "impact": "-0.9",
      "mentions": 42,  // If you specify 42 mentions, you must include 42 related reviews Ids
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
      },
      "relatedReviews": ["mongoid_here_1", "mongoid_here_2", "mongoid_here_42"]
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
6. Ensure "mentions" field accurately reflects the TOTAL COUNT of reviews mentioning each strength/issue
7. Ensure all recommendations follow established hospitality management principles
8. For each strength and issue, include ONLY UP TO 50 MOST REPRESENTATIVE review IDs in the relatedReviews array
9. Use the MongoDB ObjectId from the reviews array as the reviewId in relatedReviews
10. The "mentions" value should be the ACTUAL TOTAL COUNT of reviews mentioning this topic, even if you only include 50 IDs
11. The meta.reviewCount MUST be ${reviews.length} - this is critically important

Review data (with IDs) for analysis: ${JSON.stringify(reviewsForAnalysis, null, 2)}`;
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

const generateAIResponse = async (analysis, messages) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        // Recupera le conoscenze dai libri
        console.log('Fetching book knowledge for chat response...');
        const bookKnowledge = await getBookKnowledge();
        console.log('Book knowledge fetched, length:', bookKnowledge.length);

        // Prepara il contesto dell'analisi
        const analysisContext = `First, carefully study this hospitality industry knowledge and use it as the foundation for your response:
${bookKnowledge}

You are an AI assistant helping analyze this hotel data:
Hotel: ${analysis.analysis.meta.hotelName}
Reviews analyzed: ${analysis.reviewsAnalyzed}
Average rating: ${analysis.analysis.meta.avgRating}

Key strengths: ${analysis.analysis.strengths.map(s => s.title).join(', ')}
Key issues: ${analysis.analysis.issues.map(i => i.title).join(', ')}`;

        // Prepara la cronologia della conversazione
        const conversationHistory = messages
            .map(m => `${m.role}: ${m.content}`)
            .join('\n');

        // Costruisci il prompt completo
        const prompt = `${analysisContext}

Previous conversation:
${conversationHistory}

Guidelines for your response:
- Use the hospitality industry knowledge provided above to inform your answers
- Be concise and professional
- Use data from the analysis to support your points
- Provide actionable insights based on industry best practices
- Use markdown formatting for better readability
- Break down complex information into digestible chunks
- Keep the conversation focused on the hotel's performance
- NEVER mention or reference the source of your knowledge directly

Please respond to the last user message, incorporating relevant industry expertise where appropriate.`;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                topP: 0.8,
                topK: 40,
                maxOutputTokens: 2000
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
        const rawText = response.text();
        
        // Ensure proper markdown formatting
        let formattedText = rawText
            // Preserve markdown bold formatting
            .replace(/\*\*(.*?)\*\*/g, '**$1**')
            
            // Ensure proper paragraph spacing
            .replace(/([.!?])\s*(\n)?/g, '$1\n\n')
            
            // Remove excess line breaks
            .replace(/\n{3,}/g, '\n\n')
            
            // Format bullet points
            .replace(/\n\*\s/g, '\n\n* ')
            .replace(/\n-\s/g, '\n\n- ')
            
            // Format headers
            .replace(/\n(#{1,3})\s/g, '\n\n$1 ')
            
            .trim();
        
        return formattedText;

    } catch (error) {
        console.error('Error generating AI response:', error);
        throw new Error('Failed to generate AI response');
    }
};

const runAnalysisWithValidation = async (model, systemPrompt) => {
    // Prima chiamata con Gemini
    const initialResponse = await model.generateContent({
        contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
        generationConfig: {
            temperature: 0.1,
            topP: 0.1,
            topK: 1,
            maxOutputTokens: 80000
        }
    });
    
    let text = initialResponse.response.text();
    
    // Pulizia base del testo
    text = text.replace(/```json\s*|\s*```/g, '').trim();
    
    // Prima di tentare il parsing, estraiamo e salviamo il conteggio recensioni, che potrebbe essere perso nella riparazione
    let originalReviewCount = null;
    try {
        // Cerca il reviewCount nel JSON malformato usando regex
        const reviewCountMatch = text.match(/"reviewCount":\s*(\d+)/);
        if (reviewCountMatch && reviewCountMatch[1]) {
            originalReviewCount = parseInt(reviewCountMatch[1], 10);
            console.log(`Extracted original reviewCount from response: ${originalReviewCount}`);
        }
    } catch (extractError) {
        console.warn('Error extracting reviewCount:', extractError);
    }
    
    // Tentativo di parsing del JSON
    try {
        const parsedAnalysis = JSON.parse(text);
        return parsedAnalysis;
    } catch (parseError) {
        console.warn('Malformed JSON response, attempting correction with Claude...');
        
        // Inizializza il client Claude come nel controller review
        const anthropic = new Anthropic({
            apiKey: process.env.CLAUDE_API_KEY,
        });
        
        // Prompt specifico per la correzione del JSON in inglese
        const fixPrompt = `You are a JSON expert. You have been provided with a malformed JSON that needs to be fixed.

IMPORTANT: You must preserve ALL fields and the complete structure of the original JSON. DO NOT synthesize, DO NOT omit fields, DO NOT modify the structure.

The JSON contains syntax errors, but the structure and data are correct. Common errors include:
- Missing commas between array elements or properties
- Excess commas at the end of arrays or objects
- Unbalanced brackets
- String escaping problems
- Invalid values (e.g., undefined)

Return ONLY the corrected JSON, without explanations, comments, or other text. The JSON must be valid and parsable by JSON.parse().

Here is the JSON to fix:
${text}`;

        try {
            // Chiamata a Claude 3.7 per correzione
            const fixResult = await anthropic.messages.create({
                model: "claude-3-7-sonnet-20250219",
                max_tokens: 40000,
                temperature: 0,
                system: "You are a JSON expert. Fix the syntax errors in the provided JSON without changing the structure or content. Return ONLY the corrected JSON. DO NOT add explanations or comments.",
                messages: [{ role: "user", content: fixPrompt }]
            });
            
            // Estrai il testo corretto dalla risposta
            const fixedText = fixResult.content[0].text;
            console.log('JSON corrected with Claude 3.7');
            
            // Pulizia e parsing finale
            const cleanedText = fixedText.replace(/```json\s*|\s*```/g, '').trim();
            const correctedAnalysis = JSON.parse(cleanedText);
            
            // Ripristina il conteggio originale se l'abbiamo estratto
            if (originalReviewCount && correctedAnalysis.meta) {
                const currentCount = correctedAnalysis.meta.reviewCount || 0;
                console.log(`Correcting reviewCount from ${currentCount} to original ${originalReviewCount}`);
                correctedAnalysis.meta.reviewCount = originalReviewCount;
            }
            
            return correctedAnalysis;
        } catch (claudeError) {
            console.error('Error during Claude fix:', claudeError);
            throw new Error('Unable to process model response: ' + parseError.message);
        }
    }
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

            // Calcola avgRating usando i dati originali delle recensioni
            const avgRating = (reviews.reduce((acc, r) => acc + (r.content?.rating || 0), 0) / reviews.length).toFixed(1);

            // Estrai le piattaforme direttamente dalle recensioni originali
            const platforms = [...new Set(reviews.map(r => r.platform))];

            // Creazione dell'oggetto base per archiviare l'analisi
            let analysisResult = {
                provider: 'gemini',
                _id: null
            };

            // Inizializza il modello Gemini
            const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

            // Verifica se è una richiesta di follow-up
            if (req.body.previousMessages) {
                const lastAnalysis = req.body.messages[req.body.messages.length - 2].content;
                const systemPrompt = generateFollowUpPrompt(hotel, reviews, req.body.previousMessages, lastAnalysis, bookKnowledge);
                
                console.log('Sending follow-up prompt to Gemini...');
                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
                    generationConfig: {
                        temperature: 0.7,
                        topP: 0.8,
                        topK: 40,
                        maxOutputTokens: 10000
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
                    .replace(/\*\*/g, '**')
                    .replace(/([.!?])\s*(\n)?/g, '$1\n\n')
                    .replace(/\n{3,}/g, '\n\n')
                    .trim();
                
                analysisResult.analysis = formattedResponse;
                console.log('Received follow-up response from Gemini');

                return res.status(200).json({
                    _id: analysisResult._id,
                    analysis: analysisResult.analysis,
                    provider: analysisResult.provider,
                    suggestions: [],
                    suggestionsMessage: null
                });
            }

            // ---- FASE 1: Analisi di base ----
            console.log('PHASE 1: Starting base analysis...');
            const phase1Prompt = generatePhase1Prompt(hotel, reviews, platforms, avgRating);
            let phase1Analysis;
            
            try {
                phase1Analysis = await runAnalysisWithValidation(model, phase1Prompt);
                
                // Crea un documento di analisi iniziale nel database
                const defaultTitle = `Analysis - ${hotel.name} - ${new Date().toLocaleDateString()}`;
                const dateRange = getValidDateRange(reviews);
                
                const initialAnalysis = await Analysis.create({
                    title: defaultTitle,
                    userId,
                    hotelId: hotelId,
                    analysis: {
                        meta: phase1Analysis.meta,
                        sentiment: phase1Analysis.sentiment,
                        trends: phase1Analysis.trends || [],
                        strengths: [],
                        issues: [],
                        quickWins: []
                    },
                    reviewsAnalyzed: reviews.length,
                    reviewIds: reviews.map(r => r._id),
                    provider: 'gemini',
                    metadata: {
                        platforms,
                        dateRange,
                        creditsUsed: creditCost
                    }
                });
                
                analysisResult._id = initialAnalysis._id;
                analysisResult.analysis = initialAnalysis.analysis;
                
                console.log('PHASE 1: Base analysis completed and saved to database');
                
                // Attendiamo 70 secondi prima di passare alla fase 2
                console.log('Waiting 70 seconds before starting Phase 2...');
                await delay(70000);
            } catch (error) {
                console.error('PHASE 1: Error in base analysis:', error);
                throw new Error('Error in Phase 1: Base analysis failed');
            }

            // ---- FASE 2: Analisi dei punti di forza ----
            console.log('PHASE 2: Starting strengths analysis...');
            const phase2Prompt = generatePhase2Prompt(hotel, reviews, bookKnowledge, phase1Analysis);
            let phase2Analysis;
            
            try {
                phase2Analysis = await runAnalysisWithValidation(model, phase2Prompt);
                
                if (phase2Analysis && phase2Analysis.strengths) {
                    // Valida e filtra gli ID delle recensioni correlate
                    for (const strength of phase2Analysis.strengths) {
                        if (!Array.isArray(strength.relatedReviews)) {
                            strength.relatedReviews = [];
                        }
                        
                        // Filtra ID duplicati e invalidi
                        strength.relatedReviews = strength.relatedReviews
                            .filter(id => mongoose.Types.ObjectId.isValid(id))
                            .filter((id, index, self) => self.indexOf(id) === index)
                            .slice(0, 50); // Limita a max 50 ID
                        
                        // Aggiorna mentions per riflettere il numero effettivo di relatedReviews
                        strength.mentions = strength.relatedReviews.length;
                    }
                    
                    // Aggiorna il documento nel database
                    await Analysis.findByIdAndUpdate(
                        analysisResult._id,
                        { 'analysis.strengths': phase2Analysis.strengths }
                    );
                    
                    // Aggiorna il risultato
                    analysisResult.analysis.strengths = phase2Analysis.strengths;
                }
                
                console.log('PHASE 2: Strengths analysis completed and saved');
                
                // Attendiamo 90 secondi prima di passare alla fase 3
                console.log('Waiting 90 seconds before starting Phase 3...');
                await delay(90000);
            } catch (error) {
                console.error('PHASE 2: Error in strengths analysis:', error);
                // Continuiamo con la fase 3 anche se la fase 2 fallisce
            }

            // ---- FASE 3: Analisi delle criticità ----
            console.log('PHASE 3: Starting issues analysis...');
            const phase3Prompt = generatePhase3Prompt(hotel, reviews, bookKnowledge, phase1Analysis);
            let phase3Analysis;
            
            try {
                phase3Analysis = await runAnalysisWithValidation(model, phase3Prompt);
                
                if (phase3Analysis && phase3Analysis.issues) {
                    // Valida e filtra gli ID delle recensioni correlate
                    for (const issue of phase3Analysis.issues) {
                        if (!Array.isArray(issue.relatedReviews)) {
                            issue.relatedReviews = [];
                        }
                        
                        // Filtra ID duplicati e invalidi
                        issue.relatedReviews = issue.relatedReviews
                            .filter(id => mongoose.Types.ObjectId.isValid(id))
                            .filter((id, index, self) => self.indexOf(id) === index)
                            .slice(0, 50); // Limita a max 50 ID
                        
                        // Aggiorna mentions per riflettere il numero effettivo di relatedReviews
                        issue.mentions = issue.relatedReviews.length;
                    }
                    
                    // Aggiorna il documento nel database
                    await Analysis.findByIdAndUpdate(
                        analysisResult._id,
                        { 'analysis.issues': phase3Analysis.issues }
                    );
                    
                    // Aggiorna il risultato
                    analysisResult.analysis.issues = phase3Analysis.issues;
                }
                
                console.log('PHASE 3: Issues analysis completed and saved');
                
                // Attendiamo 70 secondi prima di passare alla fase 4
                console.log('Waiting 70 seconds before starting Phase 4...');
                await delay(70000);
            } catch (error) {
                console.error('PHASE 3: Error in issues analysis:', error);
                // Continuiamo con la fase 4 anche se la fase 3 fallisce
            }

            // ---- FASE 4: Quick Wins e suggerimenti ----
            console.log('PHASE 4: Starting quick wins and suggestions analysis...');
            const phase4Prompt = generatePhase4Prompt(hotel, analysisResult.analysis, bookKnowledge);
            let phase4Analysis;
            
            try {
                phase4Analysis = await runAnalysisWithValidation(model, phase4Prompt);
                
                if (phase4Analysis) {
                    // Aggiorna il documento nel database
                    await Analysis.findByIdAndUpdate(
                        analysisResult._id,
                        { 
                            'analysis.quickWins': phase4Analysis.quickWins || [],
                            'followUpSuggestions': phase4Analysis.followUpSuggestions || []
                        }
                    );
                    
                    // Aggiorna il risultato
                    analysisResult.analysis.quickWins = phase4Analysis.quickWins || [];
                    analysisResult.followUpSuggestions = phase4Analysis.followUpSuggestions || [];
                }
                
                console.log('PHASE 4: Quick wins and suggestions analysis completed and saved');
            } catch (error) {
                console.error('PHASE 4: Error in quick wins analysis:', error);
                // La fase 4 è opzionale, quindi continuiamo anche se fallisce
            }

            // Verifichiamo che gli ID existano nel database
            const allReviewIds = [
                ...(analysisResult.analysis.strengths || []).flatMap(s => s.relatedReviews || []),
                ...(analysisResult.analysis.issues || []).flatMap(i => i.relatedReviews || [])
            ];

            if (allReviewIds.length > 0) {
                try {
                    // Verifica quali ID esistono effettivamente nel database
                    const existingReviews = await Review.find({
                        _id: { $in: allReviewIds }
                    }).select('_id');
                    
                    const existingIds = existingReviews.map(r => r._id.toString());
                    
                    // Aggiorna nuovamente strengths e issues mantenendo solo gli ID esistenti
                    for (const strength of (analysisResult.analysis.strengths || [])) {
                        const originalCount = strength.relatedReviews?.length || 0;
                        strength.relatedReviews = (strength.relatedReviews || [])
                            .filter(id => existingIds.includes(id.toString()));
                        
                        if (strength.relatedReviews.length !== originalCount) {
                            console.log(`Filtered out ${originalCount - strength.relatedReviews.length} non-existent review IDs from strength '${strength.title}'`);
                            strength.mentions = strength.relatedReviews.length;
                        }
                    }
                    
                    for (const issue of (analysisResult.analysis.issues || [])) {
                        const originalCount = issue.relatedReviews?.length || 0;
                        issue.relatedReviews = (issue.relatedReviews || [])
                            .filter(id => existingIds.includes(id.toString()));
                        
                        if (issue.relatedReviews.length !== originalCount) {
                            console.log(`Filtered out ${originalCount - issue.relatedReviews.length} non-existent review IDs from issue '${issue.title}'`);
                            issue.mentions = issue.relatedReviews.length;
                        }
                    }
                    
                    // Aggiorna il documento nel database una volta verificati tutti gli ID
                    await Analysis.findByIdAndUpdate(
                        analysisResult._id,
                        { 
                            'analysis.strengths': analysisResult.analysis.strengths,
                            'analysis.issues': analysisResult.analysis.issues
                        }
                    );
                } catch (verifyError) {
                    console.error('Error verifying review IDs existence:', verifyError);
                    // Continuiamo comunque per non bloccare il processo
                }
            }

            // Recupera l'analisi completa dal database
            const finalAnalysis = await Analysis.findById(analysisResult._id);

            // Addebita i crediti all'utente
            try {
                console.log(`Consumo ${creditCost} crediti per l'analisi di ${reviews.length} recensioni per l'hotel ${hotel.name}`);
                const creditsConsumed = await creditService.consumeCredits(
                    hotelId,
                    'review_analysis',
                    finalAnalysis._id.toString(),
                    `Analisi di ${reviews.length} recensioni per ${hotel.name}`
                );
                
                if (!creditsConsumed) {
                    console.error(`⚠️ Impossibile addebitare i crediti per l'analisi con ID ${finalAnalysis._id}`);
                    // Continuiamo comunque per non bloccare il processo
                }
            } catch (creditError) {
                console.error('Errore durante il consumo dei crediti:', creditError);
                // Continuiamo comunque per non bloccare il processo
            }

            return res.status(200).json({
                _id: finalAnalysis._id,
                analysis: finalAnalysis.analysis,
                provider: finalAnalysis.provider,
                suggestions: finalAnalysis.followUpSuggestions || [],
                suggestionsMessage: null
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

    getChatHistory: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.userId;

            const analysis = await Analysis.findOne({ 
                _id: id,
                userId 
            });

            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            // Prendi l'ultima conversazione se esiste
            const lastConversation = analysis.conversations?.[analysis.conversations.length - 1];
            
            return res.status(200).json({
                messages: lastConversation?.messages || []
            });

        } catch (error) {
            console.error('Error in getChatHistory:', error);
            return res.status(500).json({ 
                message: 'Error fetching chat history',
                error: error.message 
            });
        }
    },

    getFollowUpAnalysis: async (req, res) => {
        try {
            const { id } = req.params;
            const { question, messages, conversationId } = req.body;
            const userId = req.userId;

            // Trova l'analisi e verifica che esista
            const analysis = await Analysis.findOne({ _id: id, userId });
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            // Inizializza l'array delle conversazioni se non esiste
            if (!analysis.conversations) {
                analysis.conversations = [];
            }

            // Trova o crea una nuova conversazione
            let conversation;
            if (conversationId) {
                conversation = analysis.conversations.find(c => c._id.toString() === conversationId);
            }
            
            if (!conversation) {
                conversation = {
                    messages: [],
                    context: { sourceType: 'analysis', sourceId: id }
                };
                analysis.conversations.push(conversation);
            }

            // Aggiungi il messaggio dell'utente
            conversation.messages.push({
                role: 'user',
                content: question,
                timestamp: new Date()
            });

            // Se la richiesta è per le domande iniziali
            if (question === 'initial') {
                const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
                const suggestionsPrompt = `Based on this analysis, generate 4-5 follow-up questions:
                ${JSON.stringify(analysis.analysis)}`;

                const result = await model.generateContent({
                    contents: [{ role: 'user', parts: [{ text: suggestionsPrompt }] }],
                    generationConfig: {
                        temperature: 0.7
                    }
                });

                const response = await result.response;
                let suggestions = [];
                
                try {
                    const responseText = await response.text();
                    const cleanedText = responseText.replace(/```json\s*|\s*```/g, '').trim();
                    
                    if (cleanedText.startsWith('[') && cleanedText.endsWith(']')) {
                        suggestions = JSON.parse(cleanedText);
                    } else {
                        const questionsRegex = /"([^"]+)"/g;
                        const matches = [...cleanedText.matchAll(questionsRegex)];
                        suggestions = matches.map(match => match[1]);
                    }
                    
                    await analysis.save(); // Salva la conversazione
                    return res.status(200).json({ suggestions });
                } catch (e) {
                    console.error('Failed to parse suggestions:', e);
                    suggestions = [
                        "What are the top 3 areas we should focus on improving?",
                        "Can you suggest specific actions for our biggest strength?",
                        "How do our ratings compare to industry averages?",
                        "What quick wins can we implement immediately?"
                    ];
                    return res.status(200).json({ suggestions });
                }
            } else {
                // Genera la risposta per domande normali
                const response = await generateAIResponse(analysis, conversation.messages);
                
                // Aggiungi la risposta dell'assistente
                conversation.messages.push({
                    role: 'assistant',
                    content: response,
                    timestamp: new Date()
                });

                // Salva l'analisi aggiornata usando markModified per assicurarsi che Mongoose rilevi le modifiche
                analysis.markModified('conversations');
                await analysis.save();

                return res.status(200).json({
                    conversationId: conversation._id,
                    messages: conversation.messages,
                    response
                });
            }

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

            const analysis = await Analysis.findOne({ 
                _id: id, 
                userId 
            });

            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            const targetGroup = category === 'strengths' 
                ? analysis.analysis.strengths.find(s => s._id.toString() === itemId)
                : analysis.analysis.issues.find(i => i._id.toString() === itemId);

            if (!targetGroup) {
                return res.status(404).json({ 
                    message: `${category} group not found` 
                });
            }

            // Verifica prima che gli IDs siano validi ObjectIDs MongoDB
            const validIds = targetGroup.relatedReviews
                .filter(id => mongoose.Types.ObjectId.isValid(id))
                .filter((id, index, self) => self.indexOf(id) === index); // Rimuovi duplicati
            
            // Recupera solo le recensioni che esistono effettivamente
            const reviews = await Review.find({
                _id: { $in: validIds }
            });

            // Aggiorna il conteggio "mentions" per riflettere il numero reale di recensioni
            const foundCount = reviews.length;
            const declaredCount = targetGroup.mentions;
            
            // Se c'è discrepanza, aggiorna l'analisi nel database
            if (foundCount !== declaredCount) {
                console.log(`Discrepancy found in ${category} '${targetGroup.title}': declared ${declaredCount} reviews but found only ${foundCount}`);
                
                // Aggiorniamo il conteggio per riflettere la realtà
                if (category === 'strengths') {
                    const strengthIndex = analysis.analysis.strengths.findIndex(s => s._id.toString() === itemId);
                    if (strengthIndex >= 0) {
                        analysis.analysis.strengths[strengthIndex].mentions = foundCount;
                        analysis.markModified('analysis.strengths');
                        await analysis.save();
                        console.log(`Updated mentions count for strength '${targetGroup.title}' from ${declaredCount} to ${foundCount}`);
                    }
                } else {
                    const issueIndex = analysis.analysis.issues.findIndex(i => i._id.toString() === itemId);
                    if (issueIndex >= 0) {
                        analysis.analysis.issues[issueIndex].mentions = foundCount;
                        analysis.markModified('analysis.issues');
                        await analysis.save();
                        console.log(`Updated mentions count for issue '${targetGroup.title}' from ${declaredCount} to ${foundCount}`);
                    }
                }
            }

            const groupedReviews = reviews.map(review => ({
                id: review._id,
                text: review.content?.text || '',
                rating: review.content?.rating || 0,
                date: review.metadata?.originalCreatedAt || review.createdAt,
                platform: review.platform || 'Unknown',
                author: review.content?.reviewerName || 'Anonymous',
                response: review.response
            }));

            return res.status(200).json({
                title: targetGroup.title,
                count: groupedReviews.length, // Restituisci il conteggio effettivo
                reviews: groupedReviews
            });

        } catch (error) {
            console.error('Error in getGroupedReviews:', error);
            return res.status(500).json({ 
                message: 'Error fetching grouped reviews',
                error: error.message 
            });
        }
    },

    // Ottieni tutte le chat di un'analisi
    getChats: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = req.userId;

            const analysis = await Analysis.findOne({ _id: id, userId });
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            // Formatta le conversazioni per il frontend
            const conversations = analysis.conversations.map(conv => ({
                _id: conv._id,
                messages: conv.messages,
                createdAt: conv.messages[0]?.timestamp || new Date(),
                title: conv.messages[0]?.content?.slice(0, 30) + '...' || 'New Chat'
            }));

            return res.status(200).json({ conversations });
        } catch (error) {
            console.error('Error in getChats:', error);
            return res.status(500).json({ message: 'Error fetching chats' });
        }
    },

    // Crea una nuova chat
    createChat: async (req, res) => {
        try {
            const { id } = req.params;
            const { firstMessage } = req.body;
            const userId = req.userId;

            const analysis = await Analysis.findOne({ _id: id, userId });
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            // Genera un titolo basato sul primo messaggio
            const title = firstMessage.length > 30 
                ? `${firstMessage.slice(0, 30)}...` 
                : firstMessage;

            const newChat = {
                messages: [{
                    role: 'user',
                    content: firstMessage,
                    timestamp: new Date()
                }],
                context: { sourceType: 'analysis', sourceId: id },
                title: title
            };

            analysis.conversations.push(newChat);
            await analysis.save();

            const createdChat = analysis.conversations[analysis.conversations.length - 1];

            return res.status(201).json({
                _id: createdChat._id,
                messages: createdChat.messages,
                createdAt: new Date(),
                title: createdChat.title
            });
        } catch (error) {
            console.error('Error in createChat:', error);
            return res.status(500).json({ message: 'Error creating chat' });
        }
    },

    // Elimina una chat
    deleteChat: async (req, res) => {
        try {
            const { id, chatId } = req.params;
            const userId = req.userId;

            const analysis = await Analysis.findOne({ _id: id, userId });
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }

            analysis.conversations = analysis.conversations.filter(
                conv => conv._id.toString() !== chatId
            );

            await analysis.save();

            return res.status(200).json({ message: 'Chat deleted successfully' });
        } catch (error) {
            console.error('Error in deleteChat:', error);
            return res.status(500).json({ message: 'Error deleting chat' });
        }
    }
};

module.exports = analyticsController;
