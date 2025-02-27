const mongoose = require('mongoose');
const { GridFSBucket } = require('mongodb');
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

Your task is to create a conversational, direct audio script in ${language} with this EXACT STRUCTURE:

1. INTRODUCTION (1-2 minutes):
   - Brief personal introduction as a hospitality consultant
   - Provide a concise overview of the ENTIRE analysis (briefly mention all major strengths and issues)
   - Explain that today you'll focus on one key strength and one key issue
   - Mention that the full detailed analysis is available in written form

2. KEY STRENGTH SECTION (3-4 minutes):
   - Identify the SINGLE most impactful strength that could transform their business
   - Explain specifically why this strength matters in today's competitive market
   - Reference specific guest quotes that highlight this strength
   - Create a DETAILED, INNOVATIVE MARKETING PLAN including:
     * Exactly how to showcase this strength across specific channels
     * Creative content ideas with examples
     * How to measure success (specific metrics)
     * Timeline and resource allocation suggestions
     * Estimated financial impact (ROI projection)
     * IMPORTANT: Do NOT make assumptions about what the hotel is currently doing
     * MUST INCLUDE specific strategies from the book knowledge provided

3. KEY ISSUE SECTION (3-4 minutes):
   - Identify the SINGLE most critical issue that needs immediate attention
   - Explain the concrete business impact of this problem (revenue, reputation, etc.)
   - Reference specific guest feedback that highlights this issue
   - Create a DETAILED, PRACTICAL RESOLUTION PLAN including:
     * Root cause analysis with industry context
     * Step-by-step implementation strategy
     * Budget considerations and resource requirements
     * Timeline with key milestones
     * How to measure improvement
     * MUST INCLUDE specific solutions from the book knowledge provided

4. ADDITIONAL INSIGHTS (1-2 minutes):
   - Provide any additional important notes based on the industry knowledge
   - Share 1-2 key hospitality trends relevant to this hotel
   - Include any supplemental recommendations from the book knowledge

5. CONCLUSION (1 minute):
   - Provide encouraging final thoughts
   - Suggest next steps and implementation priorities
   - End with a positive, motivational message about the hotel's future potential

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
        const voiceId = language.toLowerCase() === 'italiano' ? 'W71zT1VwIFFx3mMGH2uZ' : 'Dnd9VXpAjEGXiRGBf1O6';
        
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

// Funzione per salvare il file audio in GridFS
const saveAudioToGridFS = async (audioBuffer, filename) => {
    try {
        const db = mongoose.connection.db;
        const bucket = new GridFSBucket(db, { bucketName: 'podcasts' });
        
        // Crea un ID univoco per il file
        const fileId = new mongoose.Types.ObjectId();
        
        // Crea uno stream di scrittura
        const uploadStream = bucket.openUploadStreamWithId(
            fileId,
            filename,
            { contentType: 'audio/mpeg' }
        );
        
        // Converti il buffer in uno stream e scrivi in GridFS
        const stream = require('stream');
        const bufferStream = new stream.PassThrough();
        bufferStream.end(Buffer.from(audioBuffer));
        
        // Restituisci una promessa che si risolve quando il file è stato salvato
        return new Promise((resolve, reject) => {
            bufferStream.pipe(uploadStream)
                .on('error', (error) => reject(error))
                .on('finish', () => resolve(fileId.toString()));
        });
    } catch (error) {
        console.error('Error saving audio to GridFS:', error);
        throw error;
    }
};

// Funzione per recuperare il file audio da GridFS
const getAudioFromGridFS = async (fileId) => {
    try {
        const db = mongoose.connection.db;
        const bucket = new GridFSBucket(db, { bucketName: 'podcasts' });
        
        // Converte l'ID da stringa a ObjectId se necessario
        const objectId = typeof fileId === 'string' ? new mongoose.Types.ObjectId(fileId) : fileId;
        
        // Crea uno stream di lettura
        const downloadStream = bucket.openDownloadStream(objectId);
        
        // Raccogli tutti i dati del file in un buffer
        return new Promise((resolve, reject) => {
            const chunks = [];
            downloadStream
                .on('data', (chunk) => chunks.push(chunk))
                .on('error', (error) => reject(error))
                .on('end', () => resolve(Buffer.concat(chunks)))
                .on('close', () => resolve(Buffer.concat(chunks)));
        });
    } catch (error) {
        console.error('Error retrieving audio from GridFS:', error);
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
            
            // Se è già stato generato un podcast in questa lingua e ha un audioUrl
            if (analysis.podcast && 
                analysis.podcast.script && 
                analysis.podcast.language === language && 
                analysis.podcast.audioUrl) {
                try {
                    // Recupera l'audio da GridFS
                    const audioBuffer = await getAudioFromGridFS(analysis.podcast.audioUrl);
                    
                    // Imposta gli header per il download
                    res.setHeader('Content-Type', 'audio/mpeg');
                    res.setHeader('Content-Disposition', `attachment; filename="hotel-analysis-podcast-${Date.now()}.mp3"`);
                    
                    // Invia il buffer audio come risposta
                    return res.send(audioBuffer);
                } catch (error) {
                    console.error('Error retrieving existing audio, generating new one:', error);
                    // Se c'è un errore nel recupero dell'audio, ne generiamo uno nuovo
                }
            }
            
            // Se arriviamo qui, dobbiamo generare un nuovo podcast
            // O perché non esiste o perché non siamo riusciti a recuperarlo

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
            
            // Salva l'audio in GridFS
            const filename = `podcast-${analysisId}-${Date.now()}.mp3`;
            const fileId = await saveAudioToGridFS(audioBuffer, filename);
            
            // Salva il podcast nel database associandolo all'analisi
            analysis.podcast = {
                script: refinedScript,
                language,
                createdAt: new Date(),
                audioUrl: fileId  // Salviamo l'ID del file GridFS
            };
            
            await analysis.save();
            
            // Imposta gli header per il download
            res.setHeader('Content-Type', 'audio/mpeg');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            
            // Invia il buffer audio come risposta
            return res.send(Buffer.from(audioBuffer));
            
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
                    createdAt: analysis.podcast.createdAt,
                    hasAudio: !!analysis.podcast.audioUrl  // Flag per indicare se l'audio è disponibile
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
    },
    
    // Nuovo endpoint per ottenere solo l'audio
    getPodcastAudio: async (req, res) => {
        try {
            const { analysisId } = req.params;
            
            const analysis = await Analysis.findById(analysisId);
            if (!analysis || !analysis.podcast || !analysis.podcast.audioUrl) {
                return res.status(404).json({ message: 'Podcast audio not found' });
            }
            
            try {
                // Recupera l'audio da GridFS
                const audioBuffer = await getAudioFromGridFS(analysis.podcast.audioUrl);
                
                // Imposta gli header per il download
                res.setHeader('Content-Type', 'audio/mpeg');
                res.setHeader('Content-Disposition', `attachment; filename="hotel-analysis-podcast-${Date.now()}.mp3"`);
                
                // Invia il buffer audio come risposta
                return res.send(audioBuffer);
            } catch (error) {
                console.error('Error retrieving audio from GridFS:', error);
                return res.status(500).json({ 
                    message: 'Error retrieving podcast audio', 
                    error: error.message 
                });
            }
        } catch (error) {
            console.error('Error fetching podcast audio:', error);
            return res.status(500).json({ 
                message: 'Error fetching podcast audio', 
                error: error.message 
            });
        }
    }
};

module.exports = podcastController; 