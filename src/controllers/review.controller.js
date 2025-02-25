const Review = require('../models/review.model');
const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const Anthropic = require('@anthropic-ai/sdk');
const Rule = require('../models/rule.model');

const reviewController = {
    generateResponse: async (req, res) => {
        try {
            console.log('Request body:', req.body);
            
            const { hotelId, review, responseSettings, previousMessages, generateSuggestions } = req.body;
            const userId = req.userId;

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

            // Verifica se l'utente ha crediti disponibili
            if (!user.wallet?.credits && user.wallet?.freeScrapingRemaining <= 0) {
                return res.status(403).json({ 
                    message: 'No credits available. Please purchase credits to continue.',
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

            // Ottieni il nome del recensore: controlla se è presente review.name oppure review.reviewerName
            const reviewerName = typeof review === 'object' ? (review.name || review.reviewerName || 'Guest') : 'Guest';

            // Rileva la lingua solo alla prima richiesta
            let detectedLanguage = null;
            if (!previousMessages) {
                try {
                    const reviewText = typeof review === 'object' ? review.text : review;

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
                } catch (error) {
                    console.error('Language detection error:', error);
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
- For a "professional" style, use a formal and respectful tone. Address the reviewer using "Gentile [Name]" if a name is provided, and use formal language throughout the response.
  For example: "Gentile ${reviewerName}, la ringraziamo per aver condiviso il suo feedback. Siamo lieti che abbia apprezzato il nostro servizio e speriamo di poterLa accogliere nuovamente nel nostro hotel."
- For a "friendly" style, use an informal, warm, and conversational tone. Address the reviewer by their first name if available, or use a casual greeting such as "Ciao [Name]". 
  For example: "Ciao ${reviewerName}, grazie per averci lasciato il tuo commento! Siamo contenti che il tuo soggiorno sia stato piacevole e non vediamo l'ora di riaverti presto qui!"

Use the following hotel information in your response when relevant:
- Hotel Name: ${hotel.name}
- Hotel Type: ${hotel.type}
- Hotel Description: ${hotel.description}

IMPORTANT: You must respond in ${detectedLanguage}. The response should follow the linguistic and cultural norms appropriate for a ${detectedLanguage}-speaking audience.

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
                        content: msg.content || ''
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

            // Genera la risposta con Claude con gestione errori
            const response = await anthropic.messages.create({
                model: "claude-3-7-sonnet-20250219",
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
                            console.error('Error parsing suggestions:', e);
                            suggestions = [];
                        }
                    }
                } catch (error) {
                    console.error('Error generating suggestions:', error);
                }
            }

            // Salva la recensione solo alla prima richiesta
            if (!previousMessages) {
                // Salva la recensione nel database
                const reviewDoc = new Review({
                    hotelId,
                    platform: 'manual',
                    content: {
                        text: review.text,
                        language: detectedLanguage,
                        rating: 5,
                        reviewerName: reviewerName
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

            // Verifica se l'utente ha abbastanza crediti
            const totalCreditsAvailable = (user.wallet?.credits || 0) + (user.wallet?.freeScrapingRemaining || 0);
            if (totalCreditsAvailable < creditCost) {
                return res.status(403).json({ 
                    message: 'Insufficient credits available. Please purchase more credits to continue.',
                    type: 'NO_CREDITS'
                });
            }

            // Decrementa prima i crediti gratuiti, poi quelli pagati
            let freeCreditsToDeduct = Math.min(user.wallet?.freeScrapingRemaining || 0, creditCost);
            let paidCreditsToDeduct = creditCost - freeCreditsToDeduct;

            await User.findByIdAndUpdate(userId, {
                $inc: { 
                    'wallet.credits': -paidCreditsToDeduct,
                    'wallet.freeScrapingRemaining': -freeCreditsToDeduct
                }
            });

            res.json({ 
                response: aiResponse,
                detectedLanguage,
                creditsRemaining: totalCreditsAvailable - creditCost,
                suggestions
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
