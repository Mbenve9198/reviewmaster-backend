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
const redisService = require('../services/redisService');
const aiService = require('../services/aiService');
const hotelService = require('../services/hotelService');

// Rimuoviamo la cache in memoria locale che non è distribuibile
// const requestCache = new Map();

const reviewController = {
    generateResponse: async (req, res) => {
        try {
            const { hotelId, review, responseSettings, previousMessages, generateSuggestions, isNewManualReview } = req.body;
            const userId = req.userId;
            
            console.log('Request body:', req.body);
            
            // Crea una chiave unica per questa richiesta usando Redis invece della Map locale
            const requestKey = JSON.stringify({
                userId,
                hotelId,
                review: typeof review === 'object' ? review.text : review,
                responseSettings
            });
            
            // Controlla se è una richiesta duplicata usando Redis
            const isDuplicate = await redisService.isDuplicateRequest(requestKey, 10000); // 10 secondi
            if (isDuplicate) {
                console.log('Duplicate request detected, ignoring...');
                return res.status(429).json({ 
                    message: 'Too many similar requests. Please wait a moment before trying again.',
                    type: 'DUPLICATE_REQUEST'
                });
            }
            
            // Registra questa richiesta in Redis
            await redisService.registerRequest(requestKey);
            
            // Validazione input
            if (!hotelId || !review) {
                return res.status(400).json({ 
                    message: 'Missing required fields: hotelId and review are required' 
                });
            }

            // Controlla il rate limit per utente
            const rateLimiterKey = `user:${userId}:review_responses`;
            const rateLimitStatus = await redisService.rateLimit(rateLimiterKey, 10, 60); // 10 richieste al minuto
            
            if (!rateLimitStatus.allowed) {
                console.log(`Rate limit exceeded for user ${userId}: ${rateLimitStatus.current}/${10}`);
                return res.status(429).json({
                    message: 'Rate limit exceeded. Please try again later.',
                    type: 'RATE_LIMIT_EXCEEDED',
                    remaining: rateLimitStatus.remaining,
                    resetIn: '60 seconds'
                });
            }

            // Ottieni tutti i dati necessari in modo ottimizzato
            const { hotel, user, activeRules } = await hotelService.getHotelDataWithRules(hotelId, userId);
            
            // Verifica dell'utente
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Verifica dell'hotel
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            // Rileva la lingua della recensione
            const reviewText = typeof review === 'object' ? review.text : review;
            const detectedLanguage = aiService.detectLanguage(reviewText);

            // Ottieni il nome del recensore: controlla se è presente review.name oppure review.reviewerName
            const reviewerName = typeof review === 'object' ? (review.name || review.reviewerName || 'Guest') : 'Guest';

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

CRITICAL INSTRUCTION: You MUST analyze the language of the review and respond ONLY in the SAME LANGUAGE as the reviewer used. 
Detect the language used in the review and make sure your entire response is written in that same language,
following proper linguistic and cultural conventions, formality levels, and grammatical structures specific to that language.

Always end the response with:
${hotel.managerSignature}
${hotel.name}

Format the response appropriately with proper spacing and paragraphs according to the conventions of the detected language.

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

            // Variabile per tenere traccia dello stato della risposta
            let responseHasBeenSent = false;
            let aiResponse;
            let suggestions = [];

            try {
                // Consuma i crediti attraverso il servizio centralizzato
                const creditsConsumed = await creditService.consumeCredits(
                    hotelId, 
                    'review_response', 
                    previousMessages ? null : null, // Corretto il riferimento a reviewId che era indefinito
                    `AI response to ${previousMessages ? 'follow-up' : 'review'}`
                );

                if (!creditsConsumed) {
                    return res.status(403).json({ 
                        message: 'Failed to consume credits. Please try again later.',
                        type: 'CREDIT_ERROR'
                    });
                }

                // Genera la risposta AI utilizzando il nuovo servizio
                const aiResponseObj = await aiService.generateAIResponse(systemPrompt, messages, {
                    timeout: 15000, // Timeout più lungo di 15 secondi invece di 5
                    maxRetries: 1    // Un solo retry
                });
                aiResponse = aiResponseObj.text;

                // Genera suggerimenti se richiesto, in modo asincrono e parallelo
                if (generateSuggestions && !previousMessages) {
                    // Esegui questa richiesta parallelamente, senza bloccare la risposta principale
                    aiService.generateSuggestions(review)
                        .then(generatedSuggestions => {
                            suggestions = generatedSuggestions;
                        })
                        .catch(error => {
                            console.error('Error generating suggestions:', error);
                            suggestions = [];
                        });
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

                // Invia la risposta al client senza attendere i suggerimenti
                responseHasBeenSent = true;
                res.json({
                    content: aiResponse,
                    suggestions
                });
            } catch (error) {
                console.error('Error processing credits or generating AI response:', error);
                if (!responseHasBeenSent) {
                    return res.status(500).json({
                        message: 'Error processing credits or generating AI response',
                        error: error.message
                    });
                }
            }
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

            // Verifica che l'hotel appartenga all'utente
            const hotel = await hotelService.getHotelWithCache(hotelId, userId);
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            // Genera una chiave di cache per questa query specifica
            const cacheKey = `reviews:${hotelId}:${platform || 'all'}:${responseStatus || 'all'}:${rating || 'all'}:${search || ''}`;
            
            // Controlla se abbiamo risultati in cache
            const cachedReviews = await redisService.getCachedResponse(cacheKey);
            if (cachedReviews) {
                return res.json(cachedReviews);
            }

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

            // Salva in cache con TTL di 5 minuti
            await redisService.cacheResponse(cacheKey, reviews, 300000);

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
            const hotel = await hotelService.getHotelWithCache(hotelId, userId);
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            // Genera una chiave di cache per le statistiche
            const cacheKey = `reviews:stats:${hotelId}`;
            
            // Controlla se abbiamo statistiche in cache
            const cachedStats = await redisService.getCachedResponse(cacheKey);
            if (cachedStats) {
                return res.json(cachedStats);
            }

            const stats = await Review.aggregate([
                { $match: { hotelId: mongoose.Types.ObjectId(hotelId) } },
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

            const result = stats[0] || {
                averageRating: 0,
                totalReviews: 0,
                responseRate: 0
            };

            // Salva in cache con TTL di 10 minuti
            await redisService.cacheResponse(cacheKey, result, 600000);

            res.json(result);
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
