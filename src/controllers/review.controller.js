const mongoose = require('mongoose');
const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const Rule = require('../models/rule.model');
const { franc } = require('franc-min');
const axios = require('axios');
const creditService = require('../services/creditService');

// Aggiungi un sistema di deduplicazione delle richieste
const requestCache = new Map();
const CACHE_TTL = 60000; // 1 minuto in millisecondi

const reviewController = {
    generateResponse: async (req, res) => {
        try {
            const { hotelId, review, responseSettings, previousMessages, generateSuggestions, isNewManualReview } = req.body;
            const userId = req.userId;
            
            console.log('Request body:', req.body);
            
            // Crea una chiave unica per questa richiesta
            const requestKey = JSON.stringify({
                userId,
                hotelId,
                review: typeof review === 'object' ? review.text : review,
                responseSettings
            });
            
            // Controllo ottimizzato con lock per evitare race condition
            const cachedRequest = requestCache.get(requestKey);
            if (cachedRequest) {
                const timeSinceLastRequest = Date.now() - cachedRequest.timestamp;
                if (timeSinceLastRequest < 10000) { // 10 secondi
                    console.log('Duplicate request detected, ignoring...');
                    return res.status(429).json({ 
                        message: 'Too many similar requests. Please wait a moment before trying again.',
                        type: 'DUPLICATE_REQUEST'
                    });
                }
            }
            
            // Memorizza questa richiesta nel cache PRIMA di procedere
            requestCache.set(requestKey, { 
                timestamp: Date.now(),
                processing: true // Indica che stiamo elaborando questa richiesta
            });
            
            // Pulisci periodicamente il cache
            setTimeout(() => {
                requestCache.delete(requestKey);
            }, CACHE_TTL);
            
            // Validazione input
            if (!hotelId || !review) {
                return res.status(400).json({ 
                    message: 'Missing required fields: hotelId and review are required' 
                });
            }

            // Verifica l'utente e i suoi crediti
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            // Inizializza i client AI
            const anthropic = new Anthropic({
                apiKey: process.env.CLAUDE_API_KEY,
            });
            
            const openai = new OpenAI({
                apiKey: process.env.OPENAI_API_KEY,
            });

            // Ottieni il nome del recensore: controlla se è presente review.name oppure review.reviewerName
            const reviewerName = typeof review === 'object' ? (review.name || review.reviewerName || 'Guest') : 'Guest';

            // Rileva la lingua solo alla prima richiesta
            let detectedLanguage = null;
            if (!previousMessages) {
                try {
                    const reviewText = typeof review === 'object' ? review.text : review;
                    
                    // Prova prima con Claude
                    try {
                        const languageDetectionMessage = await anthropic.messages.create({
                            model: "claude-3-7-sonnet-20250219",
                            max_tokens: 50,
                            temperature: 0,
                            system: "You are a language detection expert. Respond only with the ISO language code.",
                            messages: [{ role: "user", content: reviewText }]
                        });
                        
                        if (languageDetectionMessage?.content?.[0]?.text) {
                            detectedLanguage = languageDetectionMessage.content[0].text.trim();
                        } else {
                            detectedLanguage = 'en'; // fallback to English
                        }
                    } catch (claudeError) {
                        console.log('Claude language detection failed, trying OpenAI:', claudeError.message);
                        
                        // Fallback a OpenAI per il rilevamento della lingua
                        const openaiLanguageDetection = await openai.chat.completions.create({
                            model: "gpt-4.5-preview-2025-02-27",
                            messages: [
                                { role: "system", content: "You are a language detection expert. Respond only with the ISO language code." },
                                { role: "user", content: reviewText }
                            ],
                            max_tokens: 50,
                            temperature: 0
                        });
                        
                        if (openaiLanguageDetection?.choices?.[0]?.message?.content) {
                            detectedLanguage = openaiLanguageDetection.choices[0].message.content.trim();
                        } else {
                            detectedLanguage = 'en'; // fallback to English
                        }
                    }
                } catch (error) {
                    console.error('Language detection error with both providers:', error);
                    detectedLanguage = 'en'; // fallback to English
                }
            }

            // Costruisci le istruzioni in base alle impostazioni della risposta
            const style = responseSettings?.style || 'professional';
            const length = responseSettings?.length || 'medium';

            let styleInstruction = style === 'professional' 
                ? "Maintain a professional and formal tone throughout the response."
                : "Use a friendly and warm tone, while remaining respectful.";

            let lengthInstruction = "Keep the response ";
            switch(length) {
                case 'short':
                    lengthInstruction += "concise and brief, around 2-3 sentences.";
                    break;
                case 'medium':
                    lengthInstruction += "moderate in length, around 4-5 sentences.";
                    break;
                case 'long':
                    lengthInstruction += "detailed and comprehensive, around 6-8 sentences.";
                    break;
                default:
                    lengthInstruction += "moderate in length, around 4-5 sentences.";
            }

            // Dopo la verifica dell'hotel e prima della generazione del prompt
            const activeRules = await Rule.find({ 
                hotelId: hotel._id, 
                isActive: true 
            }).sort({ priority: -1 });

            // Genera il testo delle regole per il prompt
            const rulesInstructions = activeRules.length > 0 
                ? `\nApply these active response rules in order of priority:
${activeRules.map((rule, index) => `
${index + 1}. When review ${rule.condition.field} ${rule.condition.operator} ${Array.isArray(rule.condition.value) ? rule.condition.value.join(', ') : rule.condition.value}:
   Response guideline: ${rule.response.text}
   Style: ${rule.response.settings.style}`).join('\n')}`
                : '';

            // Crea il prompt principale con esempi per stili differenti
            const systemPrompt = `You are an experienced hotel manager responding to guest reviews.
${styleInstruction}
${lengthInstruction}

${rulesInstructions}

When responding, please follow these guidelines:
- For a "professional" style, use a formal and respectful tone appropriate for the detected language. Address the reviewer by their name if provided, using formal conventions of the detected language.
- For a "friendly" style, use an informal, warm, and conversational tone appropriate for the detected language. Address the reviewer by their first name if available, using casual greeting conventions of the detected language.

Use the following hotel information in your response when relevant:
- Hotel Name: ${hotel.name}
- Hotel Type: ${hotel.type}
- Hotel Description: ${hotel.description}

CRITICAL INSTRUCTION: You MUST respond ONLY in the reviewer's language, which has been detected as "${detectedLanguage}". 
Do NOT use English or any other language unless "${detectedLanguage}" is English.
The entire response must be written in "${detectedLanguage}", following proper linguistic and cultural conventions, 
formality levels, and grammatical structures specific to "${detectedLanguage}"-speaking cultures.

BACKUP INSTRUCTION: If the detected language code "${detectedLanguage}" appears incorrect or doesn't match the language of the review, IGNORE the detected language and simply respond in the SAME LANGUAGE as the review text itself. Analyze the review text to determine its language and use that language for your response.

If the review has limited or no text content, create a polite response based on:
- The rating (if available)
- The reviewer's name (if available)
- General appreciation for feedback
- An invitation to return

Always end the response with:
${hotel.managerSignature}
${hotel.name}

Format the response appropriately with proper spacing and paragraphs according to ${detectedLanguage} conventions.

If the user asks for modifications to your previous response, adjust it according to their request while maintaining the same language and format.`;

            // Costruisci i messaggi con validazione
            let messages = [];
            if (Array.isArray(previousMessages) && previousMessages.length > 0) {
                messages = previousMessages
                    .filter(msg => msg && msg.sender)
                    .map(msg => ({
                        role: msg.sender === "ai" ? "assistant" : "user",
                        content: msg.sender === "ai" ? msg.content || '' : msg.content || ''
                    }));
                
                messages.unshift({
                    role: "user",
                    content: `Please generate a response to this hotel review from ${reviewerName}: ${typeof review === 'object' ? review.text : review}`
                });
            } else {
                messages = [{ 
                    role: "user", 
                    content: `Please generate a response to this hotel review from ${reviewerName}: ${typeof review === 'object' ? review.text : review}`
                }];
            }

            // Funzione per generare risposta con Claude e fallback a OpenAI
            const generateAIResponse = async () => {
                try {
                    // Prima prova con Claude
                    console.log('Attempting to generate response with Claude...');
                    
                    // Imposta un timeout più breve per Claude in caso di sovraccarico
                    const claudePromise = anthropic.messages.create({
                        model: "claude-3-7-sonnet-20250219",
                        max_tokens: 1000,
                        temperature: 0.7,
                        system: systemPrompt,
                        messages: messages
                    });
                    
                    // Utilizziamo un timeout di 5 secondi per rilevare rapidamente se Claude è sovraccarico
                    const timeoutPromise = new Promise((_, reject) => {
                        setTimeout(() => reject(new Error('Claude timeout after 5s')), 5000);
                    });
                    
                    // Race tra la risposta di Claude e il timeout
                    const claudeResponse = await Promise.race([claudePromise, timeoutPromise]);
                    
                    console.log('Generated response with Claude successfully');
                    return {
                        text: claudeResponse?.content?.[0]?.text || 'We apologize, but we could not generate a response at this time.',
                        provider: 'claude'
                    };
                } catch (claudeError) {
                    // Se Claude fallisce, prova subito con OpenAI
                    console.log('Claude API error, falling back to OpenAI:', claudeError.message);
                    
                    try {
                        // Converti i messaggi nel formato OpenAI
                        const openaiMessages = [
                            { role: "system", content: systemPrompt },
                            ...messages
                        ];
                        
                        const openaiResponse = await openai.chat.completions.create({
                            model: "gpt-4.5-preview-2025-02-27",
                            messages: openaiMessages,
                            max_tokens: 1000,
                            temperature: 0.7
                        });
                        
                        console.log('Generated response with OpenAI successfully');
                        return {
                            text: openaiResponse?.choices?.[0]?.message?.content || 'We apologize, but we could not generate a response at this time.',
                            provider: 'openai'
                        };
                    } catch (openaiError) {
                        console.error('OpenAI API error:', openaiError);
                        throw new Error('Failed to generate response from both AI providers');
                    }
                }
            };

            // Genera la risposta con fallback
            const aiResponseResult = await generateAIResponse();
            const aiResponse = aiResponseResult.text;
            const provider = aiResponseResult.provider;

            // Se richiesti, genera suggerimenti basati sulla recensione
            let suggestions = [];
            if (generateSuggestions && !previousMessages) {
                try {
                    const suggestionsPrompt = `Based on this review: "${review.text}"

Generate 3 relevant suggestions for improving the response. Each suggestion should be a short question or request (max 6 words).

Consider:
- Specific points mentioned in the review
- The rating (${review.rating})
- Areas for improvement
- Positive aspects to emphasize

Format your response as a simple array of 3 strings, nothing else. For example:
["Address the breakfast complaint", "Highlight room cleanliness more", "Mention upcoming renovations"]`;

                    // Prova prima con Claude per i suggerimenti
                    try {
                        const suggestionsResponse = await anthropic.messages.create({
                            model: "claude-3-7-sonnet-20250219",
                            max_tokens: 150,
                            temperature: 0.7,
                            system: "You are a helpful assistant generating suggestions for improving hotel review responses.",
                            messages: [{ role: "user", content: suggestionsPrompt }]
                        });

                        if (suggestionsResponse?.content?.[0]?.text) {
                            try {
                                suggestions = JSON.parse(suggestionsResponse.content[0].text);
                            } catch (e) {
                                console.error('Error parsing Claude suggestions:', e);
                                suggestions = [];
                            }
                        }
                    } catch (claudeSuggestionsError) {
                        // Fallback a OpenAI per i suggerimenti
                        console.log('Claude suggestions failed, trying OpenAI:', claudeSuggestionsError.message);
                        
                        const openaiSuggestionsResponse = await openai.chat.completions.create({
                            model: "gpt-4.5-preview-2025-02-27",
                            messages: [
                                { role: "system", content: "You are a helpful assistant generating suggestions for improving hotel review responses." },
                                { role: "user", content: suggestionsPrompt }
                            ],
                            max_tokens: 150,
                            temperature: 0.7
                        });
                        
                        if (openaiSuggestionsResponse?.choices?.[0]?.message?.content) {
                            try {
                                suggestions = JSON.parse(openaiSuggestionsResponse.choices[0].message.content);
                            } catch (e) {
                                console.error('Error parsing OpenAI suggestions:', e);
                                suggestions = [];
                            }
                        }
                    }
                } catch (error) {
                    console.error('Error generating suggestions with both providers:', error);
                }
            }

            // Salva la recensione solo se è una nuova recensione manuale e non ci sono messaggi precedenti
            if ((!previousMessages || previousMessages.length === 0) && isNewManualReview === true) {
                // Salva la recensione nel database
                const reviewDoc = new Review({
                    hotelId,
                    platform: 'manual',
                    content: {
                        text: typeof review === 'object' ? review.text : review,
                        language: detectedLanguage,
                        rating: typeof review === 'object' && review.rating ? review.rating : 5,
                        reviewerName: reviewerName
                    },
                    metadata: {
                        originalCreatedAt: new Date()
                    },
                    response: {
                        text: aiResponse,
                        createdAt: new Date(),
                        settings: responseSettings || {
                            style: 'professional',
                            length: 'medium'
                        }
                    }
                });

                await reviewDoc.save();
            }

            // Decrementa i crediti in base al tipo di richiesta
            const creditCost = previousMessages ? 1 : 2;  // 2 crediti per prima risposta, 1 per follow-up

            // Utilizza il servizio centralizzato per verificare i crediti
            const creditStatus = await creditService.checkCredits(hotelId);
            if (!creditStatus.hasCredits || creditStatus.credits < creditCost) {
                return res.status(403).json({ 
                    message: 'Insufficient credits available. Please purchase more credits to continue.',
                    type: 'NO_CREDITS'
                });
            }

            // Consuma i crediti attraverso il servizio centralizzato
            const creditsConsumed = await creditService.consumeCredits(
                hotelId, 
                'review_response', 
                previousMessages ? null : reviewId, 
                `AI response to ${previousMessages ? 'follow-up' : 'review'}`
            );

            if (!creditsConsumed) {
                return res.status(403).json({ 
                    message: 'Failed to consume credits. Please try again later.',
                    type: 'CREDIT_ERROR'
                });
            }

            // Aggiorna lo stato dei crediti dopo il consumo
            const updatedCreditStatus = await creditService.checkCredits(hotelId);

            res.json({ 
                response: aiResponse,
                detectedLanguage,
                creditsRemaining: updatedCreditStatus.credits,
                suggestions,
                provider // Aggiungiamo il provider utilizzato nella risposta
            });

        } catch (error) {
            console.error('Generate response error:', error);
            res.status(500).json({ 
                message: 'Error generating response',
                error: error.message
            });
        }
    },

    getHotelReviews: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const { platform, responseStatus, rating, search } = req.query;
            const userId = req.userId;

            let query = { hotelId };

            if (platform && platform !== 'all') {
                query.platform = platform;
            }

            if (responseStatus === 'responded') {
                query['response.text'] = { $exists: true, $ne: '' };
            } else if (responseStatus === 'unresponded') {
                query['$or'] = [
                    { response: { $exists: false } },
                    { response: null },
                    { 'response.text': { $exists: false } },
                    { 'response.text': '' },
                    { 'response.text': null }
                ];
            }

            if (rating && rating !== 'all') {
                query['content.rating'] = parseInt(rating);
            }

            if (search) {
                query['content.text'] = { $regex: search, $options: 'i' };
            }

            const reviews = await Review.find(query)
                .sort({ 'content.date': -1 })
                .lean()
                .exec();

            res.json(reviews);
        } catch (error) {
            console.error('Get hotel reviews error:', error);
            res.status(500).json({ message: 'Failed to fetch reviews' });
        }
    },

    getReviewStats: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const userId = req.userId;

            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            const stats = await Review.aggregate([
                { $match: { hotelId: hotel._id } },
                { 
                    $group: {
                        _id: null,
                        averageRating: { $avg: '$content.rating' },
                        totalReviews: { $sum: 1 },
                        responseRate: {
                            $avg: { $cond: [{ $ifNull: ['$response', false] }, 1, 0] }
                        }
                    }
                }
            ]);

            res.json(stats[0] || {
                averageRating: 0,
                totalReviews: 0,
                responseRate: 0
            });
        } catch (error) {
            console.error('Get stats error:', error);
            res.status(500).json({ message: 'Error fetching statistics' });
        }
    },

    deleteReview: async (req, res) => {
        try {
            const { reviewId } = req.params;
            const userId = req.userId;

            // Trova la recensione e popola l'hotelId per verificare la proprietà
            const review = await Review.findById(reviewId).populate({
                path: 'hotelId',
                select: 'userId'
            });

            if (!review) {
                return res.status(404).json({ message: 'Review not found' });
            }

            // Verifica che l'utente sia il proprietario dell'hotel
            if (review.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            await Review.findByIdAndDelete(reviewId);
            
            res.json({ message: 'Review deleted successfully' });
        } catch (error) {
            console.error('Delete review error:', error);
            res.status(500).json({ 
                message: 'Error deleting review',
                error: error.message 
            });
        }
    },

    bulkDeleteReviews: async (req, res) => {
        try {
            const { reviewIds } = req.body;
            const userId = req.userId;

            if (!Array.isArray(reviewIds) || reviewIds.length === 0) {
                return res.status(400).json({ message: 'No reviews selected' });
            }

            // Verifica che tutte le recensioni appartengano a hotel dell'utente
            const reviews = await Review.find({
                _id: { $in: reviewIds }
            }).populate({
                path: 'hotelId',
                select: 'userId'
            });

            // Verifica autorizzazione per ogni recensione
            const unauthorized = reviews.some(review => 
                review.hotelId.userId.toString() !== userId
            );

            if (unauthorized) {
                return res.status(403).json({ message: 'Unauthorized to delete some reviews' });
            }

            await Review.deleteMany({ _id: { $in: reviewIds } });
            
            res.json({ 
                message: 'Reviews deleted successfully',
                count: reviewIds.length
            });
        } catch (error) {
            console.error('Bulk delete reviews error:', error);
            res.status(500).json({ 
                message: 'Error deleting reviews',
                error: error.message 
            });
        }
    },

    updateReviewResponse: async (req, res) => {
        try {
            const { reviewId } = req.params;
            const { response } = req.body;
            const userId = req.userId;

            // Validazione input
            if (!response || !response.text) {
                return res.status(400).json({ message: 'Response text is required' });
            }

            // Trova la recensione e popola l'hotelId per verificare la proprietà
            const review = await Review.findById(reviewId).populate({
                path: 'hotelId',
                select: 'userId'
            });

            if (!review) {
                return res.status(404).json({ message: 'Review not found' });
            }

            // Verifica che l'utente sia il proprietario dell'hotel
            if (review.hotelId.userId.toString() !== userId) {
                return res.status(403).json({ message: 'Unauthorized' });
            }

            // Aggiorna la risposta
            review.response = {
                text: response.text,
                createdAt: response.createdAt || new Date(),
                settings: response.settings || {
                    style: 'professional',
                    length: 'medium'
                },
                synced: false // La risposta dovrà essere sincronizzata con la piattaforma
            };

            await review.save();

            res.json({ 
                message: 'Response updated successfully',
                review
            });

        } catch (error) {
            console.error('Update review response error:', error);
            res.status(500).json({ 
                message: 'Error updating review response',
                error: error.message 
            });
        }
    }
};

module.exports = reviewController;
