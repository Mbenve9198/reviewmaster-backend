const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Anthropic = require('@anthropic-ai/sdk');

const reviewController = {
    generateResponse: async (req, res) => {
        try {
            console.log('Request body:', req.body);
            
            // Validazione input
            if (!req.body) {
                throw new Error('Request body is missing');
            }

            const { hotelId, review, responseSettings, previousMessages } = req.body;
            const userId = req.userId;

            // Validazione campi obbligatori
            if (!hotelId || !review) {
                throw new Error('Missing required fields: hotelId and review are required');
            }

            console.log('Processing request with:', {
                userId,
                hotelId,
                review: review.substring(0, 100) + '...', // Log solo l'inizio della recensione
                responseSettings,
                previousMessagesCount: previousMessages?.length
            });

            // Verifica l'utente e i suoi crediti
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Verifica se l'utente ha crediti disponibili
            if (user.subscription.responseCredits <= 0) {
                return res.status(403).json({ 
                    message: 'No credits available. Please upgrade your plan to continue generating responses.',
                    type: 'NO_CREDITS'
                });
            }

            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            // Inizializza il client Claude
            const anthropic = new Anthropic({
                apiKey: process.env.CLAUDE_API_KEY,
            });

            // Rileva la lingua solo alla prima richiesta
            let detectedLanguage = null;
            if (!previousMessages) {
                try {
                    const languageDetectionMessage = await anthropic.messages.create({
                        model: "claude-3-sonnet-20240229",
                        max_tokens: 50,
                        temperature: 0,
                        system: "You are a language detection expert. Respond only with the ISO language code.",
                        messages: [{ role: "user", content: review }]
                    });
                    
                    if (languageDetectionMessage?.content?.[0]?.text) {
                        detectedLanguage = languageDetectionMessage.content[0].text.trim();
                    } else {
                        detectedLanguage = 'en'; // fallback to English
                    }
                } catch (error) {
                    console.error('Language detection error:', error);
                    detectedLanguage = 'en'; // fallback to English
                }
            }

            // Costruisci il prompt in base alle impostazioni
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

            // Crea il prompt principale
            const systemPrompt = `You are an experienced hotel manager responding to guest reviews. 
${styleInstruction}
${lengthInstruction}

Use the following hotel information in your response when relevant:
- Hotel Name: ${hotel.name}
- Hotel Type: ${hotel.type}
- Hotel Description: ${hotel.description}

If you find a name in the review, address that person. Otherwise, use a generic greeting like 'Dear Guest' or equivalent in the review language.

Always end the response with:
${hotel.managerSignature}
${hotel.name}

Respond in the same language as the review. Format the response appropriately with proper spacing and paragraphs.

If the user asks for modifications to your previous response, adjust it according to their request while maintaining the same language and format.`;

            // Costruisci i messaggi con validazione
            let messages = [];
            if (Array.isArray(previousMessages) && previousMessages.length > 0) {
                messages = previousMessages.map(msg => ({
                    role: msg.sender === "ai" ? "assistant" : "user",
                    content: msg.content
                }));
                
                // Add the original review as first message for context
                messages.unshift({
                    role: "user",
                    content: `Please generate a response to this hotel review: ${review}`
                });
            } else {
                messages = [{ 
                    role: "user", 
                    content: `Please generate a response to this hotel review: ${review}`
                }];
            }

            // Genera la risposta con Claude con gestione errori
            const response = await anthropic.messages.create({
                model: "claude-3-sonnet-20240229",
                max_tokens: 1000,
                temperature: 0.7,
                system: systemPrompt,
                messages: messages
            }).catch(error => {
                console.error('Claude API error:', error);
                throw new Error('Failed to generate response from AI');
            });

            let aiResponse = 'We apologize, but we could not generate a response at this time.';
            if (response?.content?.[0]?.text) {
                aiResponse = response.content[0].text;
                console.log('Generated response successfully');
            }

            // Salva la recensione solo alla prima richiesta
            if (!previousMessages) {
                // Salva la recensione nel database
                const reviewDoc = new Review({
                    hotelId,
                    platform: 'manual',
                    content: {
                        text: review,
                        language: detectedLanguage,
                        rating: 5,
                        reviewerName: 'Guest'
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

            // Decrementa i crediti
            await User.findByIdAndUpdate(userId, {
                $inc: { 'subscription.responseCredits': -1 }
            });

            res.json({ 
                response: aiResponse,
                detectedLanguage,
                creditsRemaining: user.subscription.responseCredits - 1
            });

        } catch (error) {
            console.error('Generate response error:', error);
            res.status(500).json({ 
                message: 'Error generating response',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    },

    getHotelReviews: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const { 
                status,
                platform,
                rating,
                search
            } = req.query;
            const userId = req.userId;

            // Costruisci il filtro base
            let filter = {};

            // Se hotelId non è 'all', aggiungi il filtro per hotel specifico
            if (hotelId !== 'all') {
                // Verifica che l'hotel appartenga all'utente
                const hotel = await Hotel.findOne({ _id: hotelId, userId });
                if (!hotel) {
                    return res.status(404).json({ message: 'Hotel not found' });
                }
                filter.hotelId = hotelId;
            } else {
                // Se hotelId è 'all', ottieni tutti gli hotel dell'utente
                const userHotels = await Hotel.find({ userId });
                filter.hotelId = { $in: userHotels.map(h => h._id) };
            }

            // Resto dei filtri...
            if (status === 'responded') {
                filter['response'] = { $exists: true };
            } else if (status === 'not-responded') {
                filter['response'] = { $exists: false };
            }

            if (platform && platform !== 'all') {
                filter['platform'] = platform;
            }

            if (rating && rating !== 'all') {
                filter['content.rating'] = parseInt(rating);
            }

            if (search) {
                filter['content.text'] = { $regex: search, $options: 'i' };
            }

            const reviews = await Review.find(filter)
                .sort({ 'content.createdAt': -1 });

            res.json(reviews);
        } catch (error) {
            console.error('Get reviews error:', error);
            res.status(500).json({ message: 'Error fetching reviews' });
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
    }
};

module.exports = reviewController;
