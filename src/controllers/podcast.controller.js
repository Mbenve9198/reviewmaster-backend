const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Analysis = require('../models/analysis.model');
const Book = require('../models/book.model');
const Review = require('../models/review.model');
const WhatsappInteraction = require('../models/whatsapp-interaction.model');

// Inizializza Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Funzione per recuperare le conoscenze dai libri
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

// Funzione per generare lo script iniziale con Gemini
const generateInitialScript = async (analysis, reviews, bookKnowledge, language) => {
    try {
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
        // Prepara il contesto dell'analisi
        const hotelMeta = analysis.analysis.meta;
        const strengths = analysis.analysis.strengths || [];
        const issues = analysis.analysis.issues || [];
        
        // Estrai citazioni dalle recensioni per dare più colore
        const reviewQuotes = reviews.slice(0, 10).map(r => 
            `"${r.content.text.substring(0, 200)}${r.content.text.length > 200 ? '...' : ''}" - Guest, ${r.content.rating}/${r.platform === 'booking' ? 10 : 5} stars`
        ).join('\n\n');
        
        const prompt = `You are an expert podcast script writer for the hospitality industry with deep knowledge of hotel marketing and operations. Create a 15-minute podcast script about a hotel's performance based on guest reviews.

INDUSTRY KNOWLEDGE:
${bookKnowledge}

HOTEL ANALYSIS:
Hotel: ${hotelMeta.hotelName}
Reviews analyzed: ${analysis.reviewsAnalyzed}
Average rating: ${hotelMeta.avgRating}

Key strengths: ${strengths.map(s => s.title).join(', ')}
Key issues: ${issues.map(i => i.title).join(', ')}

GUEST QUOTES:
${reviewQuotes}

Your task:
1. Create a professional-sounding podcast script in ${language}
2. Include an engaging introduction that mentions the hotel
3. For EACH key strength:
   - Explain why it's important in the hospitality industry
   - Provide specific examples from guest reviews
   - Develop a DETAILED MARKETING PLAN to leverage this strength, including:
     * Specific marketing channels and content strategies
     * Ways to highlight this strength in booking platforms
     * How to use this strength to differentiate from competitors
     * Estimated ROI and timeline for implementation

4. For EACH major issue:
   - Explain its impact on guest satisfaction and business
   - Provide specific examples from reviews
   - Develop a DETAILED RESOLUTION PLAN, including:
     * Root cause analysis of the problem
     * Step-by-step actions to resolve the issue
     * Timeline for implementation
     * Required resources and investment
     * How to measure success and follow up

5. Include short segments with quotes from actual guests
6. Add industry insights based on the knowledge provided
7. Conclude with a summary and actionable advice for the hotel
8. Format as a complete script with clear speaker parts

The marketing and resolution plans should be PRACTICAL, SPECIFIC, and ACTIONABLE - avoid generic advice. Include concrete examples, numbers where appropriate (costs, timelines, expected results), and clear metrics for success. These plans should be immediately useful to a hotel manager in real-world situations.

The podcast should feel like a professional hospitality industry analysis, similar to what you might hear on a business podcast, but with immediately applicable business solutions.`;

        const result = await model.generateContent({
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: {
                temperature: 0.7,
                maxOutputTokens: 8000
            }
        });
        
        return result.response.text();
    } catch (error) {
        console.error('Error generating initial script with Gemini:', error);
        throw error;
    }
};

// Funzione per perfezionare lo script con Claude
const refineScriptWithClaude = async (initialScript, language) => {
    try {
        const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': process.env.CLAUDE_API_KEY,
                'anthropic-version': '2023-06-01'
            },
            body: JSON.stringify({
                model: "claude-3-7-sonnet-20250219",
                max_tokens: 4000,
                messages: [
                    {
                        role: "user",
                        content: `You are an expert podcast scriptwriter and voice actor coach. I have an initial script for a hotel analysis podcast in ${language}. 
                        
Your task is to refine this script to make it sound completely natural for a spoken podcast. Focus on:

1. Conversational language that sounds natural when read aloud
2. Varied sentence structures and natural transitions
3. Proper pacing, including pauses and emphasis (indicate these in the script)
4. Natural interjections, hesitations, and speaking patterns that make audio content engaging
5. Maintaining a professional but friendly tone suitable for a business podcast
6. Preserving all the valuable insights while making the language flow better

The script will be used with an AI voice generator, so please include direction for tone, pacing, and emphasis where needed. Indicate pauses with (pause) and emphasis with *asterisks*.

Here is the initial script:

${initialScript}`
                    }
                ]
            })
        });
        
        const data = await response.json();
        
        if (!data || !data.content || !Array.isArray(data.content) || data.content.length === 0) {
            console.error('Unexpected Claude response structure:', data);
            throw new Error('Invalid response structure from Claude');
        }
        
        return data.content[0].text;
    } catch (error) {
        console.error('Error refining script with Claude:', error);
        throw error;
    }
};

// Funzione per generare audio con Eleven Labs
const generateAudio = async (script, language) => {
    try {
        const voiceId = language.toLowerCase() === 'italiano' ? 'W71zT1VwIFFx3mMGH2uZ' : 'NZX3G5Vcbc9iwbdtIdDE';
        
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVEN_LABS_API_KEY
            },
            body: JSON.stringify({
                text: script,
                model_id: 'eleven_multilingual_v2',
                voice_settings: {
                    stability: 0.5,
                    similarity_boost: 0.75
                }
            })
        });
        
        if (!response.ok) {
            const errorData = await response.json();
            console.error('Eleven Labs API error:', errorData);
            throw new Error(`Eleven Labs API error: ${response.status}`);
        }
        
        // Restituisci l'audio come buffer
        return await response.arrayBuffer();
    } catch (error) {
        console.error('Error generating audio with Eleven Labs:', error);
        throw error;
    }
};

const podcastController = {
    generatePodcast: async (req, res) => {
        try {
            const { analysisId, language = 'English' } = req.body;
            
            // Validazione
            if (!analysisId) {
                return res.status(400).json({ message: 'Analysis ID is required' });
            }
            
            // Recupera l'analisi
            const analysis = await Analysis.findById(analysisId);
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }
            
            // Recupera le recensioni associate
            const reviews = await Review.find({ 
                _id: { $in: analysis.reviewIds }
            }).sort({ 'metadata.originalCreatedAt': -1 });
            
            // Recupera knowledge dai libri
            const bookKnowledge = await getRelevantBookKnowledge(reviews);
            
            // Genera script iniziale con Gemini
            const initialScript = await generateInitialScript(
                analysis, 
                reviews, 
                bookKnowledge, 
                language
            );
            
            // Refine script with Claude
            const refinedScript = await refineScriptWithClaude(initialScript, language);
            
            // Genera audio con Eleven Labs
            const audioBuffer = await generateAudio(refinedScript, language);
            
            // Salva il podcast nel database associandolo all'analisi
            analysis.podcast = {
                script: refinedScript,
                language,
                createdAt: new Date()
            };
            
            await analysis.save();
            
            // Converti ArrayBuffer in Buffer per inviarlo come risposta
            const buffer = Buffer.from(audioBuffer);
            
            // Imposta gli header per il download
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Disposition', `attachment; filename="hotel-analysis-podcast-${Date.now()}.mp3"`);
            
            // Invia il buffer audio come risposta
            return res.send(buffer);
            
        } catch (error) {
            console.error('Error generating podcast:', error);
            return res.status(500).json({ 
                message: 'Error generating podcast', 
                error: error.message 
            });
        }
    },
    
    // Endpoint per ottenere lo script senza generare l'audio
    getPodcastScript: async (req, res) => {
        try {
            const { analysisId } = req.params;
            
            const analysis = await Analysis.findById(analysisId);
            if (!analysis) {
                return res.status(404).json({ message: 'Analysis not found' });
            }
            
            // Se il podcast è già stato generato
            if (analysis.podcast && analysis.podcast.script) {
                return res.status(200).json({ 
                    script: analysis.podcast.script,
                    language: analysis.podcast.language,
                    createdAt: analysis.podcast.createdAt
                });
            }
            
            return res.status(404).json({ message: 'Podcast script not found for this analysis' });
            
        } catch (error) {
            console.error('Error fetching podcast script:', error);
            return res.status(500).json({ 
                message: 'Error fetching podcast script', 
                error: error.message 
            });
        }
    }
};

module.exports = podcastController; 