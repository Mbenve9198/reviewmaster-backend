const fetch = require('node-fetch');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const Analysis = require('../models/analysis.model');
const { Book } = require('../models/book.model');
const Review = require('../models/review.model');
const WhatsappInteraction = require('../models/whatsapp-interaction.model');

// Inizializza Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Funzione per recuperare le conoscenze dai libri
const getRelevantBookKnowledge = async (reviews) => {
    try {
        // Estraiamo le parole chiave più significative dalle recensioni
        const reviewText = reviews.map(r => r.content?.text || '').join(' ');
        const keywords = reviewText
            .toLowerCase()
            .split(/\W+/)
            .filter(word => word.length > 3)
            .filter(word => !['this', 'that', 'with', 'from', 'have', 'were'].includes(word));

        // Controlliamo se il modello Book è definito correttamente
        if (!Book || typeof Book.find !== 'function') {
            console.error('Book model is not properly defined or imported');
            return "No relevant book knowledge found.";
        }

        // Cerca nei libri usando text search di MongoDB
        const relevantBooks = await Book.find(
            { $text: { $search: keywords.join(' ') } },
            { score: { $meta: "textScore" } }
        )
        .sort({ score: { $meta: "textScore" } })
        .limit(5);  // prendiamo i 5 libri più rilevanti

        if (!relevantBooks || relevantBooks.length === 0) {
            return "No relevant book knowledge found.";
        }

        return relevantBooks.map(book => 
            `From "${book.title}" by ${book.author}:\n${book.content}`
        ).join('\n\n');
    } catch (error) {
        console.error('Error retrieving book knowledge:', error);
        return "Error retrieving book knowledge.";
    }
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
        
        const prompt = `You are a hospitality industry consultant speaking directly to the manager of ${hotelMeta.hotelName}. Create a focused, actionable audio presentation that will inspire concrete improvements.

INDUSTRY KNOWLEDGE:
${bookKnowledge}

HOTEL ANALYSIS:
Hotel: ${hotelMeta.hotelName}
Reviews analyzed: ${analysis.reviewsAnalyzed}
Average rating: ${hotelMeta.avgRating}

All strengths: ${strengths.map(s => s.title).join(', ')}
All issues: ${issues.map(i => i.title).join(', ')}

GUEST QUOTES:
${reviewQuotes}

USING THE KNOWLEDGE DATABASE:
* The INDUSTRY KNOWLEDGE provided above from expert books is your PRIMARY SOURCE for creating actionable plans
* DIRECT INSTRUCTIONS ON KNOWLEDGE USE:
  1. Extract specific strategies, tactics, examples, statistics, and best practices from these books
  2. Cite these sources when creating your marketing and resolution plans
  3. Apply these expert insights directly to this hotel's specific situation
  4. Use the book knowledge as the foundation for ALL recommended actions
  5. Only if the books don't cover a specific point should you use your general knowledge

Your task:
1. Create a conversational, direct audio script in ${language} speaking directly TO the hotel manager
2. Begin with a personal introduction and mention you're focusing on just two key areas today (explaining that the full analysis is available in written form)
3. SELECT AND FOCUS on only TWO points total:
   - The SINGLE most impactful strength that could transform their business
   - The SINGLE most critical issue that needs immediate attention

4. For the key strength:
   - Explain specifically why this strength matters in today's competitive market
   - Reference specific guest quotes that highlight this strength
   - Create a DETAILED, INNOVATIVE MARKETING PLAN including:
     * Exactly how to showcase this strength across specific channels
     * Creative content ideas with examples
     * How to measure success (specific metrics)
     * Timeline and resource allocation suggestions
     * Estimated financial impact (ROI projection)
     * MUST INCLUDE specific strategies from the book knowledge provided

5. For the key issue:
   - Explain the concrete business impact of this problem (revenue, reputation, etc.)
   - Reference specific guest feedback that highlights this issue
   - Create a DETAILED, PRACTICAL RESOLUTION PLAN including:
     * Root cause analysis with industry context
     * Step-by-step implementation strategy
     * Budget considerations and resource requirements
     * Timeline with key milestones
     * How to measure improvement
     * MUST INCLUDE specific solutions from the book knowledge provided

6. Include industry insights and benchmarks from the knowledge provided
7. Conclude with encouragement and next steps

The tone should be conversational but authoritative - like an expert colleague speaking directly to the manager over coffee. The plans must be SPECIFIC, PRACTICAL and ACTIONABLE - avoid generic advice. Include concrete examples, numbers, and clear metrics.

CRITICAL: Your most important job is to extract and apply the hospitality expertise from the book knowledge to create a uniquely valuable action plan that wouldn't be possible without these industry sources.`;

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
                        content: `You are an expert in creating natural spoken audio content for hotels. I have an initial script about a hotel analysis in ${language}. 

Your task is to rewrite this as pure spoken content that will be directly converted to audio. KEEP THE TOTAL LENGTH UNDER 10,000 CHARACTERS (strict technical limitation).

Guidelines:
1. Output ONLY the actual words to be spoken - no directions, annotations, or formatting
2. No stage directions like "(pause)" or "*emphasis*" 
3. No speaker labels or formatting elements
4. Write in a natural, conversational tone as if someone is speaking informally
5. Remove all technical language that wouldn't sound natural in speech
6. Keep the most valuable insights while being concise
7. Maintain a warm, professional tone suitable for hoteliers

The text will be fed directly into a text-to-speech system with a 10,000 character limit. The output must be ready for direct audio conversion with no editing needed.

Here is the initial script to rewrite:

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
        // Utilizziamo voci predefinite di Eleven Labs
        const voiceId = language.toLowerCase() === 'italiano' ? 'EXAVITQu4vr4xnSDxMaL' : '21m00Tcm4TlvDq8ikWAM';
        
        // Parametri personalizzabili della voce
        const voiceSettings = {
            stability: 0.5,           // Stabilità della voce (0.0-1.0): valori più alti = più stabile
            similarity_boost: 0.75,   // Somiglianza con la voce originale (0.0-1.0)
            style: 0.3,               // Espressività dello stile (0.0-1.0): valori più alti = più espressivo
            use_speaker_boost: true,  // Migliora la qualità della voce
            
            // Parametri aggiuntivi per controllare la velocità
            // Disponibili nei modelli più recenti di Eleven Labs
            speaking_rate: 1.0        // Velocità di parlato: 1.0 = normale, <1 più lento, >1 più veloce
        };
        
        const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'xi-api-key': process.env.ELEVEN_LABS_API_KEY
            },
            body: JSON.stringify({
                text: script,
                model_id: 'eleven_multilingual_v2',
                voice_settings: voiceSettings
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