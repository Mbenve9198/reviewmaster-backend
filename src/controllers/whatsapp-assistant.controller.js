const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const WhatsappInteraction = require('../models/whatsapp-interaction.model');
const Hotel = require('../models/hotel.model');
const twilio = require('twilio');
const SentimentAnalysis = require('../models/sentiment-analysis.model');
const mongoose = require('mongoose');
const creditService = require('../services/creditService');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Mappa dei prefissi telefonici e relative lingue
const COUNTRY_CODES = {
  '39': 'it',  // Italia
  '44': 'en',  // Regno Unito
  '33': 'fr',  // Francia
  '49': 'de',  // Germania
  '34': 'es',  // Spagna
  '31': 'nl',  // Paesi Bassi
  '351': 'pt', // Portogallo
  '41': 'de',  // Svizzera (assumiamo tedesco come default)
  '43': 'de',  // Austria
  '32': 'fr',  // Belgio (assumiamo francese come default)
  // Aggiungi altri paesi secondo necessità
};

// Template messaggi multilingua per le recensioni
const REVIEW_MESSAGES = {
  it: (hotelName) => `Ciao! Grazie per aver scelto ${hotelName}. Ti è piaciuto il tuo soggiorno? Ci aiuterebbe molto se potessi lasciarci una recensione: {{REVIEW_LINK}}`,
  en: (hotelName) => `Hello! Thank you for choosing ${hotelName}. Did you enjoy your stay? It would help us a lot if you could leave us a review: {{REVIEW_LINK}}`,
  fr: (hotelName) => `Bonjour! Merci d'avoir choisi ${hotelName}. Avez-vous apprécié votre séjour? Cela nous aiderait beaucoup si vous pouviez nous laisser un avis: {{REVIEW_LINK}}`,
  de: (hotelName) => `Hallo! Vielen Dank, dass Sie sich für ${hotelName} entschieden haben. Hat Ihnen Ihr Aufenthalt gefallen? Es würde uns sehr helfen, wenn Sie uns eine Bewertung hinterlassen könnten: {{REVIEW_LINK}}`,
  es: (hotelName) => `¡Hola! Gracias por elegir ${hotelName}. ¿Disfrutaste tu estancia? Nos ayudaría mucho si pudieras dejarnos una reseña: {{REVIEW_LINK}}`
};

const RATE_LIMITS = {
    DAILY_MAX: 50,      // Aumentato a 50 messaggi per giorno
    MONTHLY_MAX: 100,   // Questo lo lasciamo per riferimento futuro
};

const getLanguageFromPhone = (phoneNumber) => {
  // Rimuovi il prefisso "whatsapp:" e il "+"
  const cleanNumber = phoneNumber.replace('whatsapp:', '').replace('+', '');
  
  // Cerca il prefisso più lungo che corrisponde
  const matchingPrefix = Object.keys(COUNTRY_CODES)
    .sort((a, b) => b.length - a.length)
    .find(prefix => cleanNumber.startsWith(prefix));

  return matchingPrefix ? COUNTRY_CODES[matchingPrefix] : 'en'; // Default a inglese
};

const whatsappAssistantController = {
    createAssistant: async (req, res) => {
        try {
            const { hotelId, timezone, breakfast, checkIn } = req.body;

            // Debug log
            console.log('Request user:', req.user);
            console.log('Request userId:', req.userId);
            console.log('Request body:', req.body);

            // Validazione input
            if (!hotelId || !timezone || !breakfast || !checkIn) {
                return res.status(400).json({ 
                    message: 'Missing required fields',
                    details: { hotelId, timezone, breakfast, checkIn }
                });
            }

            // Verifica che l'hotel esista e appartenga all'utente
            const hotel = await Hotel.findOne({ 
                _id: hotelId, 
                userId: req.userId
            });

            if (!hotel) {
                return res.status(404).json({ 
                    message: 'Hotel not found or unauthorized',
                    details: { hotelId, userId: req.userId }
                });
            }

            // Verifica se esiste già un assistente per questo hotel
            const existingAssistant = await WhatsAppAssistant.findOne({ hotelId });
            if (existingAssistant) {
                // Se esiste, aggiorniamo invece di creare
                Object.assign(existingAssistant, {
                    timezone,
                    breakfast,
                    checkIn
                });
                await existingAssistant.save({ validateBeforeSave: false });
                return res.status(200).json(existingAssistant);
            }

            // Crea nuovo assistente con valori temporanei per i campi required
            const assistant = new WhatsAppAssistant({
                hotelId,
                timezone,
                breakfast,
                checkIn,
                // Valori temporanei per i campi required
                reviewLink: 'pending',
                triggerName: `hotel_${hotelId}_pending`,
                reviewRequestDelay: 3
            });

            await assistant.save({ validateBeforeSave: false });
            
            res.status(201).json(assistant);
        } catch (error) {
            console.error('Create assistant error:', error);
            res.status(500).json({ 
                message: 'Error creating WhatsApp assistant',
                error: error.message,
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            });
        }
    },

    getAssistant: async (req, res) => {
        try {
            const { hotelId } = req.params;
            
            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            const assistant = await WhatsAppAssistant.findOne({ hotelId });
            if (!assistant) {
                return res.status(404).json({ message: 'Assistant not found' });
            }

            res.json(assistant);
        } catch (error) {
            console.error('Get assistant error:', error);
            res.status(500).json({ message: 'Error fetching WhatsApp assistant' });
        }
    },

    updateAssistant: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const updateData = req.body;

            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Trova e aggiorna l'assistente
            const assistant = await WhatsAppAssistant.findOne({ hotelId });
            if (!assistant) {
                return res.status(404).json({ message: 'Assistant not found' });
            }

            // Aggiorna solo i campi forniti
            Object.keys(updateData).forEach(key => {
                if (updateData[key] !== undefined) {
                    assistant[key] = updateData[key];
                }
            });

            await assistant.save();

            res.json(assistant);
        } catch (error) {
            console.error('Update assistant error:', error);
            res.status(500).json({ message: 'Error updating WhatsApp assistant' });
        }
    },

    checkTriggerName: async (req, res) => {
        try {
            const { name } = req.params;
            
            // Verifica se il nome esiste già
            const existingAssistant = await WhatsAppAssistant.findOne({ 
                triggerName: name,
                isActive: true
            });

            res.json({
                available: !existingAssistant,
                message: existingAssistant ? 'Name is already in use' : 'Name is available'
            });
        } catch (error) {
            console.error('Check trigger name error:', error);
            res.status(500).json({ 
                message: 'Error checking trigger name',
                error: error.message
            });
        }
    },

    addRule: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const { topic, response, isCustom } = req.body;

            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Trova l'assistente
            const assistant = await WhatsAppAssistant.findOne({ hotelId });
            if (!assistant) {
                return res.status(404).json({ message: 'Assistant not found' });
            }

            // Aggiungi la nuova regola
            assistant.rules.push({
                topic,
                response,
                isCustom: isCustom || false,
                isActive: true
            });

            await assistant.save();

            res.status(201).json(assistant.rules[assistant.rules.length - 1]);
        } catch (error) {
            console.error('Add rule error:', error);
            res.status(500).json({ 
                message: 'Error adding rule',
                error: error.message
            });
        }
    },

    updateRule: async (req, res) => {
        try {
            const { hotelId, ruleId } = req.params;
            const updateData = req.body;

            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Trova l'assistente e aggiorna la regola
            const assistant = await WhatsAppAssistant.findOne({ hotelId });
            if (!assistant) {
                return res.status(404).json({ message: 'Assistant not found' });
            }

            const ruleIndex = assistant.rules.findIndex(rule => rule._id.toString() === ruleId);
            if (ruleIndex === -1) {
                return res.status(404).json({ message: 'Rule not found' });
            }

            // Aggiorna i campi della regola
            Object.assign(assistant.rules[ruleIndex], updateData);
            await assistant.save();

            res.json(assistant.rules[ruleIndex]);
        } catch (error) {
            console.error('Update rule error:', error);
            res.status(500).json({ 
                message: 'Error updating rule',
                error: error.message
            });
        }
    },

    deleteRule: async (req, res) => {
        try {
            const { hotelId, ruleId } = req.params;

            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Trova l'assistente e rimuovi la regola
            const assistant = await WhatsAppAssistant.findOne({ hotelId });
            if (!assistant) {
                return res.status(404).json({ message: 'Assistant not found' });
            }

            assistant.rules = assistant.rules.filter(rule => rule._id.toString() !== ruleId);
            await assistant.save();

            res.json({ message: 'Rule deleted successfully' });
        } catch (error) {
            console.error('Delete rule error:', error);
            res.status(500).json({ 
                message: 'Error deleting rule',
                error: error.message
            });
        }
    },

    handleWebhook: async (req, res) => {
        // Declare interaction at function scope so it's available in catch block
        let interaction = null;
        let assistant = null;
        
        try {
            console.log('Raw request body:', req.body);

            const message = {
                Body: req.body.Body,
                From: req.body.From,
                ProfileName: req.body.ProfileName || 'Guest'
            };

            console.log('Elaborazione messaggio WhatsApp da:', message.ProfileName);

            // Client Twilio
            const twilioClient = twilio(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
            );

            // Find all active assistants
            const activeAssistants = await WhatsAppAssistant.find({ 
                isActive: true 
            }).populate('hotelId');
            
            if (activeAssistants.length === 0) {
                console.log('No active assistants found');
                return res.status(200).send({
                    success: false,
                    message: 'No active assistants found'
                });
            }

            // Cerca interazione esistente
            interaction = await WhatsappInteraction.findOne({
                phoneNumber: message.From
            }).populate({
                path: 'hotelId',
                select: 'name type description'
            });
            
            let isNewConversation = false;
            
            // Check if user wants to switch hotels by using a trigger word
            const triggerWordMatch = activeAssistants.find(ast => 
                message.Body.toLowerCase().includes(ast.triggerName.toLowerCase())
            );
            
            if (triggerWordMatch) {
                console.log('Trigger word detected:', triggerWordMatch.triggerName);
                
                // User is using a trigger word - either new conversation or switching hotels
                if (interaction && interaction.hotelId._id.toString() !== triggerWordMatch.hotelId._id.toString()) {
                    console.log('User switching from hotel', interaction.hotelId.name, 'to', triggerWordMatch.hotelId.name);
                    // Update the existing interaction to point to the new hotel
                    interaction.hotelId = triggerWordMatch.hotelId._id;
                    await interaction.save();
                    
                    // IMPORTANTE: Ricarica l'interazione con i dettagli popolati dell'hotel dopo il cambio
                    interaction = await WhatsappInteraction.findOne({
                        phoneNumber: message.From
                    }).populate({
                        path: 'hotelId',
                        select: 'name type description'
                    });
                    
                    console.log('After hotel switch, populated details:', {
                        hotelId: interaction.hotelId._id,
                        hotelName: interaction.hotelId.name,
                        hotelType: interaction.hotelId.type
                    });
                }
                
                // Usa questo assistente per rilevare l'inizio della conversazione o il cambio di hotel
                assistant = triggerWordMatch;
                isNewConversation = true;
            } else if (interaction) {
                // Existing conversation, find the corresponding assistant
                assistant = activeAssistants.find(ast => 
                    ast.hotelId._id.toString() === interaction.hotelId._id.toString()
                );
                
                console.log('Continuing conversation with assistant:', {
                    assistantId: assistant?._id,
                    hotelName: assistant?.hotelId?.name,
                    lastInteraction: new Date()
                });
            } else {
                // New user, no trigger word - don't respond
                console.log('New user without trigger word, not responding');
                
                // Send polite response explaining they need to use a trigger word
                const noTriggerResponse = "Welcome! To start a conversation with one of our hotels, please use their specific keyword. For example: 'HotelName help'";
                
                await twilioClient.messages.create({
                    body: noTriggerResponse,
                    from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                    to: message.From,
                    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                });
                
                // Return empty TwiML response
                res.set('Content-Type', 'text/xml');
                return res.send('<Response></Response>');
            }

            if (!assistant || !assistant.hotelId) {
                console.log('No assistant found for this hotel!');
                return res.status(200).send({
                    success: false,
                    message: 'No assistant found for this hotel'
                });
            }

            // Crea interazione se non esiste
            if (!interaction) {
                console.log('CREAZIONE NUOVA INTERAZIONE:', message.From);
                interaction = new WhatsappInteraction({
                    hotelId: assistant.hotelId._id,
                    phoneNumber: message.From,
                    profileName: message.ProfileName,
                    firstInteraction: new Date(),
                    dailyInteractions: [{
                        date: new Date(),
                        count: 1
                    }],
                    conversationHistory: [], // Initialize empty conversation history
                    // Inizializza i campi per le recensioni
                    reviewRequested: false,
                    reviewScheduledFor: null,
                    reviewRequests: []
                });
                await interaction.save();
                
                // IMPORTANTE: Ricarica l'interazione con i dettagli popolati dell'hotel
                interaction = await WhatsappInteraction.findOne({
                    phoneNumber: message.From
                }).populate({
                    path: 'hotelId',
                    select: 'name type description'
                });
                
                console.log('Interazione creata con ID:', interaction._id);
            }
            
            // Dopo l'aggiornamento o la creazione dell'interazione, assicuriamoci di usare l'assistente CORRETTO
            // per l'hotel associato all'interazione, non quello del trigger word
            if (assistant && interaction && interaction.hotelId) {
                // Trova l'assistente corretto basato sull'hotelId dell'interazione
                const correctAssistant = activeAssistants.find(ast => 
                    ast.hotelId._id.toString() === interaction.hotelId._id.toString()
                );
                
                if (correctAssistant) {
                    // Se l'assistente del trigger è diverso dall'assistente dell'hotel corrente, utilizza quello corretto
                    if (assistant._id.toString() !== correctAssistant._id.toString()) {
                        console.log('Switching from trigger assistant to correct hotel assistant:', {
                            fromAssistantId: assistant._id,
                            toAssistantId: correctAssistant._id,
                            fromHotelName: assistant.hotelId.name,
                            toHotelName: correctAssistant.hotelId.name
                        });
                        assistant = correctAssistant;
                    }
                }
            }
            
            // VERIFICA DEI CREDITI
            console.log('=== VERIFICA CREDITI ===');
            const creditStatus = await creditService.checkCredits(assistant.hotelId._id.toString());
            
            if (!creditStatus.hasCredits) {
                console.log('CREDITI ESAURITI per hotel:', assistant.hotelId.name);
                
                // Invia messaggio di crediti esauriti
                const lowBalanceMessage = {
                    it: `Spiacenti, il saldo crediti dell'hotel è esaurito. Per favore contatta la reception.`,
                    en: `Sorry, the hotel's credit balance has been depleted. Please contact the reception desk.`,
                    fr: `Désolé, le solde de crédit de l'hôtel est épuisé. Veuillez contacter la réception.`,
                    de: `Entschuldigung, das Guthaben des Hotels ist aufgebraucht. Bitte kontaktieren Sie die Rezeption.`,
                    es: `Lo sentimos, el saldo de crédito del hotel se ha agotado. Por favor, contacte con recepción.`
                };
                
                const userLanguage = getLanguageFromPhone(message.From);
                
                await twilioClient.messages.create({
                    body: lowBalanceMessage[userLanguage] || lowBalanceMessage.en,
                    from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                    to: message.From,
                    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                });
                
                // Return empty TwiML response
                res.set('Content-Type', 'text/xml');
                return res.send('<Response></Response>');
            }
            
            if (creditStatus.lowBalance) {
                console.log('CREDITI BASSI per hotel:', assistant.hotelId.name, 'Saldo:', creditStatus.credits);
            }
            
            // Procedi con il consumo dei crediti per il messaggio in ingresso
            await creditService.consumeCredits(
                assistant.hotelId._id.toString(), 
                'inbound', 
                interaction._id, 
                `Messaggio WhatsApp in ingresso da ${message.ProfileName || 'Ospite'}`
            );
            
            // Verifica e log delle regole dell'assistente
            console.log('Final assistant rules:', {
                assistantId: assistant?._id,
                hotelName: assistant?.hotelId?.name,
                hasRules: !!assistant?.rules,
                rulesCount: assistant?.rules?.length || 0,
                activeRules: assistant?.rules?.filter(rule => rule.isActive)?.length || 0,
                rules: assistant?.rules?.filter(rule => rule.isActive)?.map(rule => ({
                    topic: rule.isCustom ? rule.customTopic : rule.topic,
                    response: rule.response
                }))
            });

            // PARTE CRUCIALE: Controllo dello stato delle recensioni
            console.log('=== VERIFICA STATO RECENSIONE ===');
            console.log('- ReviewRequested:', interaction.reviewRequested);
            console.log('- ReviewScheduledFor:', interaction.reviewScheduledFor);
            console.log('- ReviewRequests:', interaction.reviewRequests?.length || 0);
            
            let reviewScheduled = false;
            
            // Verifica se una recensione è stata inviata negli ultimi 3 mesi
            const treeMonthsAgo = new Date();
            treeMonthsAgo.setMonth(treeMonthsAgo.getMonth() - 3);
            
            const recentReviews = interaction.reviewRequests?.filter(
                review => new Date(review.requestedAt) > treeMonthsAgo
            ) || [];
            
            if (recentReviews.length > 0) {
                console.log('Recensione già inviata negli ultimi 3 mesi:', {
                    dataUltimaRecensione: recentReviews[recentReviews.length - 1].requestedAt,
                    giorniPassati: Math.floor((new Date() - new Date(recentReviews[recentReviews.length - 1].requestedAt)) / (1000 * 60 * 60 * 24))
                });
            }
            
            // Scheduliamo una recensione se:
            // 1. Non ne abbiamo inviate negli ultimi 3 mesi
            // 2. L'assistente ha un link per le recensioni configurato
            if (recentReviews.length === 0 && assistant.reviewLink) {
                try {
                    console.log('*** TENTATIVO DI SCHEDULING RECENSIONE ***');
                    
                    const delayDays = assistant.reviewRequestDelay || 3;
                    const scheduledDate = new Date();
                    scheduledDate.setDate(scheduledDate.getDate() + delayDays);
                    
                    console.log('DETTAGLI SCHEDULING:', {
                        phoneNumber: interaction.phoneNumber,
                        hotelName: assistant.hotelId.name,
                        scheduledDate: scheduledDate.toISOString(),
                        delayDays,
                        reviewLink: assistant.reviewLink
                    });
                    
                    // Utility per ottenere la lingua dal numero di telefono
                    const getLanguageFromPhone = (phoneNumber) => {
                        const COUNTRY_CODES = {
                            '39': 'it',
                            '44': 'en',
                            '33': 'fr',
                            '49': 'de',
                            '34': 'es',
                            '31': 'en',
                            '351': 'en',
                            '41': 'de',
                            '43': 'de',
                            '32': 'fr'
                        };
                        
                        const cleanNumber = phoneNumber.replace('whatsapp:', '').replace('+', '');
                        const matchingPrefix = Object.keys(COUNTRY_CODES)
                            .sort((a, b) => b.length - a.length)
                            .find(prefix => cleanNumber.startsWith(prefix));
                        
                        return matchingPrefix ? COUNTRY_CODES[matchingPrefix] : 'en';
                    };
                    
                    const userLanguage = getLanguageFromPhone(interaction.phoneNumber);
                    console.log('Lingua utente rilevata:', userLanguage);
                    
                    const REVIEW_MESSAGES = {
                        it: (hotelName) => `Ciao! Grazie per aver scelto ${hotelName}. Ti è piaciuto il tuo soggiorno? Ci aiuterebbe molto se potessi lasciarci una recensione: ${assistant.reviewLink}`,
                        en: (hotelName) => `Hello! Thank you for choosing ${hotelName}. Did you enjoy your stay? It would help us a lot if you could leave us a review: ${assistant.reviewLink}`,
                        fr: (hotelName) => `Bonjour! Merci d'avoir choisi ${hotelName}. Avez-vous apprécié votre séjour? Cela nous aiderait beaucoup si vous pouviez nous laisser un avis: ${assistant.reviewLink}`,
                        de: (hotelName) => `Hallo! Vielen Dank, dass Sie sich für ${hotelName} entschieden haben. Hat Ihnen Ihr Aufenthalt gefallen? Es würde uns sehr helfen, wenn Sie uns eine Bewertung hinterlassen könnten: ${assistant.reviewLink}`,
                        es: (hotelName) => `¡Hola! Gracias por elegir ${hotelName}. ¿Disfrutaste tu estancia? Nos ayudaría mucho si pudieras dejarnos una reseña: ${assistant.reviewLink}`
                    };
                    
                    const messageTemplate = REVIEW_MESSAGES[userLanguage] || REVIEW_MESSAGES.en;
                    const reviewMessage = messageTemplate(assistant.hotelId.name);
                        
                    console.log('MESSAGGIO RECENSIONE:', reviewMessage);
                    
                    // Utilizza lo scheduling nativo di Twilio
                    console.log('Chiamata a Twilio API per scheduling...');
                    const twilioMessage = await twilioClient.messages.create({
                        body: reviewMessage,
                        from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                        to: interaction.phoneNumber,
                        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID,
                        scheduleType: 'fixed',
                        sendAt: scheduledDate.toISOString()
                    });
                    
                    console.log('SUCCESSO! Twilio response:', {
                        sid: twilioMessage.sid,
                        status: twilioMessage.status,
                        dateCreated: twilioMessage.dateCreated
                    });
                    
                    // Consuma crediti per il messaggio programmato
                    await creditService.consumeCredits(
                        assistant.hotelId._id.toString(),
                        'scheduled',
                        interaction._id,
                        `Richiesta recensione programmata per ${interaction.phoneNumber}`
                    );
                    
                    // Aggiorna l'interazione con la recensione programmata
                    if (!interaction.reviewRequests) {
                        interaction.reviewRequests = [];
                    }
                    
                    interaction.reviewRequests.push({
                        requestedAt: scheduledDate,
                        messageId: twilioMessage.sid
                    });
                    
                    // Aggiorna anche i campi legacy per retrocompatibilità
                    interaction.reviewRequested = true;
                    interaction.reviewScheduledFor = scheduledDate;
                    
                    console.log('Aggiornamento database con info recensione...');
                    await interaction.save();
                    
                    reviewScheduled = true;
                    console.log('RECENSIONE SCHEDULATA CON SUCCESSO!');
                } catch (error) {
                    console.error('ERRORE SCHEDULING RECENSIONE:', error);
                    console.error('Stack trace:', error.stack);
                    
                    if (error.code) {
                        console.error('Twilio error code:', error.code);
                        console.error('Twilio error message:', error.message);
                    }
                }
            } else {
                // Log del motivo per cui non abbiamo schedulato una recensione
                if (recentReviews.length > 0) {
                    console.log('Non scheduliamo: recensione già inviata negli ultimi 3 mesi');
                } else if (!assistant.reviewLink) {
                    console.log('Non scheduliamo: assistente senza link per recensioni configurato');
                }
            }

            // Verifica limiti giornalieri
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            let dailyInteraction = interaction.dailyInteractions.find(
                di => di.date.getTime() === today.getTime()
            );

            if (!dailyInteraction) {
                dailyInteraction = {
                    date: today,
                    count: 0
                };
                interaction.dailyInteractions.push(dailyInteraction);
            }

            if (dailyInteraction.count >= RATE_LIMITS.DAILY_MAX) {
                const limitMessage = {
                    it: `Hai raggiunto il limite giornaliero di messaggi. Riprova domani.`,
                    en: `You've reached the daily message limit. Please try again tomorrow.`,
                    fr: `Vous avez atteint la limite quotidienne de messages. Réessayez demain.`,
                    de: `Sie haben das tägliche Nachrichtenlimit erreicht. Bitte versuchen Sie es morgen erneut.`,
                    es: `Has alcanzado el límite diario de mensajes. Inténtalo de nuevo mañana.`
                };

                const userLanguage = getLanguageFromPhone(message.From);
                await client.messages.create({
                    body: limitMessage[userLanguage] || limitMessage.en,
                    from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                    to: message.From,
                    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                });

                return res.status(200).send({
                    success: false,
                    message: 'Rate limit: daily limit exceeded'
                });
            }

            // Aggiorna il contatore
            dailyInteraction.count++;
            interaction.monthlyInteractions++;
            interaction.lastInteraction = new Date();
            await interaction.save();

            // Assicuriamoci di usare i dati dell'hotel dall'interazione, non dall'assistente
            const hotel = interaction.hotelId;

            // Rimuovi il trigger name dal messaggio per l'elaborazione
            const userQuery = isNewConversation 
                ? message.Body.replace(assistant.triggerName, '').trim()
                : message.Body.trim();

            // IMPORTANTE: Pulisci la cronologia della conversazione rimuovendo messaggi con contenuto vuoto
            if (interaction.conversationHistory && interaction.conversationHistory.length > 0) {
                interaction.conversationHistory = interaction.conversationHistory.filter(msg => 
                    msg && msg.content && msg.content.trim() !== ''
                );
                await interaction.save();
                console.log(`Cleaned conversation history - removed empty messages. New length: ${interaction.conversationHistory.length}`);
            }

            // Aggiungi il messaggio dell'utente allo storico
            if (userQuery && userQuery.trim() !== '') {
                interaction.conversationHistory.push({
                    role: 'user',
                    content: userQuery,
                    timestamp: new Date()
                });
                await interaction.save();
            } else {
                console.log('Skipping empty user message');
            }

            // Prepara il contesto della conversazione per Claude
            const recentHistory = interaction.conversationHistory
                .slice(-10)
                .filter(msg => msg && msg.content && msg.content.trim() !== '') // Filtra di nuovo per sicurezza
                .map(msg => ({
                    role: msg.role,
                    content: msg.content
                }));

            const userLanguage = getLanguageFromPhone(message.From);
            
            if (!interaction.hotelId || !interaction.hotelId.name) {
                console.error('CRITICAL ERROR: Hotel details not found or not populated correctly');
                console.error('Interaction hotel data:', {
                    hasHotelId: !!interaction.hotelId,
                    hotelIdType: typeof interaction.hotelId,
                    hotelIdValue: interaction.hotelId,
                    hotelName: interaction.hotelId?.name
                });
                
                // Invia un messaggio di errore generico e termina
                await twilioClient.messages.create({
                    body: "I'm sorry, there was a system error. Please try again later.",
                    from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                    to: message.From,
                    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                });
                
                res.set('Content-Type', 'text/xml');
                return res.send('<Response></Response>');
            }
            
            const systemPrompt = `You are ${hotel.name}'s personal WhatsApp Hotel concierge, having a natural, friendly conversation with ${message.ProfileName}. 
First, determine the language the user is writing in by analyzing their message "${message.Body}".
Respond in THE SAME LANGUAGE the user is using, regardless of their phone number's country code.
Only use ${userLanguage.toUpperCase()} as a fallback if you cannot clearly determine the language from their message.
Maintain a warm and personal tone.

Remember:
- You're having a casual chat with ${message.ProfileName}, like a helpful concierge at the hotel
- Keep responses conversational and natural, avoiding formal or robotic language
- Show empathy and personality in your responses
- Use natural conversation flow, like you would in a real chat
- Only greet the user with "Ciao ${message.ProfileName}" or similar greetings for the FIRST message of a conversation or if it's been more than 30 minutes since the last exchange
- For follow-up messages in an active conversation, continue naturally without repeating greetings
- Never sign off with formal closings or hotel signatures
- IMPORTANT: Never offer to:
  * Check with staff or management
  * Call back later
  * Look up additional information
  * Contact other services
  * Make reservations or bookings
  * Promise future actions
- If you don't know something, simply say you don't have that information and suggest contacting the reception directly

Hotel Details (use naturally in conversation):
- Name: ${hotel.name}
- Type: ${hotel.type}
- About: ${hotel.description || 'A welcoming place to stay'}
- Breakfast: ${assistant.breakfast.startTime} - ${assistant.breakfast.endTime}
- Check-in: ${assistant.checkIn.startTime} - ${assistant.checkIn.endTime}
- Reviews: ${assistant.reviewLink}

${assistant.rules && assistant.rules.length > 0 ? `
Response Guidelines:
${assistant.rules.filter(rule => rule.isActive).map((rule, index) => `
${index + 1}. For ${rule.isCustom ? rule.customTopic : rule.topic}:
   ${rule.response}`).join('\n')}` : ''}

Important:
- Only share information you're certain about
- If unsure, simply say you don't have that information and suggest contacting the reception
- Keep the conversation flowing naturally
- Use emojis sparingly but appropriately to add warmth
- Match the guest's tone and energy level
- Stick to the facts you have been given - don't make assumptions or promises`;

// Spostiamo i log di debug fuori dal prompt
console.log('Assistant rules:', {
    hasRules: !!assistant.rules,
    rulesCount: assistant.rules?.length,
    activeRules: assistant.rules?.filter(rule => rule.isActive)?.length,
    rules: assistant.rules?.filter(rule => rule.isActive)?.map(rule => ({
        topic: rule.isCustom ? rule.customTopic : rule.topic,
        response: rule.response
    }))
});

console.log('Hotel details:', {
    name: interaction?.hotelId?.name,
    type: interaction?.hotelId?.type,
    description: interaction?.hotelId?.description
});

            // Genera la risposta con Claude includendo lo storico
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.CLAUDE_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: "claude-3-7-sonnet-20250219",
                    max_tokens: 1000,
                    system: systemPrompt, // Usa il prompt di sistema conversazionale
                    messages: recentHistory.concat([{
                        role: 'user',
                        content: userQuery
                    }])
                })
            });

            const data = await response.json();
            console.log('Claude response:', JSON.stringify(data));

            // Estrai la risposta TESTUALE di Claude con gestione più robusta
            let assistantResponse = "I'm sorry, I can't respond at the moment.";

            try {
                // Verifica prima la struttura della risposta
                if (data && data.content && Array.isArray(data.content)) {
                    // Cerca il primo elemento di tipo 'text'
                    const textContent = data.content.find(item => item.type === 'text' && item.text);
                    
                    if (textContent && textContent.text && textContent.text.trim() !== '') {
                        assistantResponse = textContent.text;
                    } else {
                        // Log dettagliato per debugging
                        console.log('No valid text content found in Claude response:', data.content);
                    }
                } else {
                    // Log dettagliato per debugging
                    console.log('Unexpected Claude response structure:', data);
                }
            } catch (parseError) {
                console.error('Error parsing Claude response:', parseError);
            }

            // Verifica che assistantResponse non sia vuoto prima di salvarlo
            if (assistantResponse && assistantResponse.trim() !== '') {
                // Salva la risposta nella cronologia
                interaction.conversationHistory.push({
                    role: 'assistant',
                    content: assistantResponse,
                    timestamp: new Date()
                });
                await interaction.save();
            } else {
                console.error('Empty assistant response, not saving to conversation history');
                // Utilizziamo un messaggio di fallback generico
                assistantResponse = "I apologize, but I couldn't process your request. Please try again later.";
            }

            // Invia una risposta TwiML vuota
            res.set('Content-Type', 'text/xml');
            res.send('<Response></Response>');

            // Consumo crediti per il messaggio in uscita
            await creditService.consumeCredits(
                assistant.hotelId._id.toString(), 
                'outbound', 
                interaction._id, 
                `Messaggio WhatsApp in uscita per ${message.ProfileName || 'Ospite'}`
            );

            // Invia la risposta conversazionale via Twilio
            try {
                await client.messages.create({
                    body: assistantResponse,
                    from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                    to: message.From,
                    messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                });
            } catch (twilioError) {
                console.error('Errore invio messaggio Twilio:', twilioError);
            }
        } catch (error) {
            console.error('WhatsApp webhook error:', error);
            
            // Add more detailed logging for validation errors
            if (error.name === 'ValidationError') {
                console.error('Validation error details:');
                for (let field in error.errors) {
                    console.error(`- Field: ${field}`);
                    console.error(`  Message: ${error.errors[field].message}`);
                    console.error(`  Value: ${JSON.stringify(error.errors[field].value)}`);
                    console.error(`  Kind: ${error.errors[field].kind}`);
                }
                
                // Log interaction state if available - now this variable is in scope
                if (interaction) {
                    console.error('Interaction state:');
                    console.error(`- ID: ${interaction._id}`);
                    console.error(`- Phone: ${interaction.phoneNumber}`);
                    console.error(`- History Count: ${interaction.conversationHistory?.length || 0}`);
                }
            }
            
            // Try to send a fallback message in case of error
            try {
                if (message && message.From) {
                    await twilio(
                        process.env.TWILIO_ACCOUNT_SID,
                        process.env.TWILIO_AUTH_TOKEN
                    ).messages.create({
                        body: "I apologize, but I couldn't process your message. Please try again later.",
                        from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                        to: message.From,
                        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                    });
                }
            } catch (twilioError) {
                console.error('Failed to send error message:', twilioError);
            }
            
            // Anche in caso di errore, rispondi con un TwiML vuoto
            res.set('Content-Type', 'text/xml');
            res.send('<Response></Response>');
        }
    },

    getConversations: async (req, res) => {
        try {
            const { hotelId } = req.params;
            
            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Recupera le conversazioni degli ultimi 30 giorni
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            const conversations = await WhatsappInteraction.find({
                hotelId,
                lastInteraction: { $gte: thirtyDaysAgo }
            }).sort({ lastInteraction: -1 });

            res.json(conversations);
        } catch (error) {
            console.error('Get conversations error:', error);
            res.status(500).json({ 
                message: 'Error fetching conversations',
                error: error.message
            });
        }
    },

    getAnalytics: async (req, res) => {
        try {
            const { hotelId } = req.params;
            
            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }
            
            // Ottieni tutte le interazioni per questo hotel
            const interactions = await WhatsappInteraction.find({ hotelId });
            
            // Calcola le metriche di base
            const totalInteractions = interactions.length;
            const totalMessages = interactions.reduce((sum, interaction) => 
                sum + interaction.conversationHistory.length, 0);
            
            const userMessages = interactions.reduce((sum, interaction) => 
                sum + interaction.conversationHistory.filter(msg => msg.role === 'user').length, 0);
            
            const assistantMessages = interactions.reduce((sum, interaction) => 
                sum + interaction.conversationHistory.filter(msg => msg.role === 'assistant').length, 0);
            
            // Calcola il numero di recensioni inviate
            const reviewsSent = interactions.reduce((sum, interaction) => 
                sum + (interaction.reviewRequested ? 1 : 0), 0);
            
            // Calcola il numero di recensioni cliccate
            const reviewsClicked = interactions.reduce((sum, interaction) => 
                sum + (interaction.reviewTracking && interaction.reviewTracking.clicked ? 1 : 0), 0);
            
            // Calcola il tasso di clic
            const clickThroughRate = reviewsSent > 0 ? (reviewsClicked / reviewsSent) * 100 : 0;
            
            // Analisi messaggi per giorno negli ultimi 30 giorni
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
            
            const messagesPerDay = {};
            
            // Inizializza gli ultimi 30 giorni a zero
            for (let i = 0; i < 30; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateString = date.toISOString().split('T')[0];
                messagesPerDay[dateString] = { user: 0, assistant: 0 };
            }
            
            // Popola con i dati reali
            interactions.forEach(interaction => {
                interaction.conversationHistory.forEach(message => {
                    if (new Date(message.timestamp) >= thirtyDaysAgo) {
                        const dateString = new Date(message.timestamp).toISOString().split('T')[0];
                        if (!messagesPerDay[dateString]) {
                            messagesPerDay[dateString] = { user: 0, assistant: 0 };
                        }
                        messagesPerDay[dateString][message.role]++;
                    }
                });
            });
            
            // Converti in array per il frontend
            const messagesByDate = Object.keys(messagesPerDay).map(date => ({
                date,
                user: messagesPerDay[date].user,
                assistant: messagesPerDay[date].assistant,
                total: messagesPerDay[date].user + messagesPerDay[date].assistant
            })).sort((a, b) => a.date.localeCompare(b.date));
            
            res.json({
                totalInteractions,
                totalMessages,
                userMessages,
                assistantMessages,
                reviewsSent,
                reviewsClicked,
                clickThroughRate,
                messagesByDate
            });
        } catch (error) {
            console.error('Get analytics error:', error);
            res.status(500).json({ 
                message: 'Error fetching WhatsApp analytics',
                error: error.message
            });
        }
    },

    generateSentimentAnalysis: async (req, res) => {
        try {
            const { hotelId } = req.params;
            
            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Controlla se esiste già un'analisi recente (ultimi 30 minuti)
            const recentAnalysis = await SentimentAnalysis.findOne({
                hotelId,
                createdAt: { $gte: new Date(Date.now() - 30 * 60 * 1000) } // 30 minuti
            }).sort({ createdAt: -1 });

            // Se esiste un'analisi recente, restituiscila
            if (recentAnalysis && !req.query.force) {
                return res.json({
                    positive: recentAnalysis.positive,
                    neutral: recentAnalysis.neutral,
                    negative: recentAnalysis.negative,
                    summary: recentAnalysis.summary,
                    createdAt: recentAnalysis.createdAt,
                    isCached: true
                });
            }

            // Ottieni tutte le interazioni per questo hotel
            const interactions = await WhatsappInteraction.find({ hotelId });
            
            // Estrai tutti i messaggi degli utenti
            const userMessages = [];
            interactions.forEach(interaction => {
                interaction.conversationHistory.forEach(message => {
                    if (message.role === 'user') {
                        userMessages.push(message.content);
                    }
                });
            });
            
            if (userMessages.length === 0) {
                return res.json({
                    positive: 0,
                    neutral: 0,
                    negative: 0,
                    summary: "No user messages found to analyze.",
                    createdAt: new Date(),
                    isCached: false
                });
            }
            
            // Usa la stessa funzione che usi per il bot WhatsApp
            const response = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-api-key': process.env.CLAUDE_API_KEY,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify({
                    model: "claude-3-7-sonnet-20250219",
                    max_tokens: 1000,
                    messages: [
                        {
                            role: "user",
                            content: `Analyze the sentiment of these user messages from hotel guests. Classify each message as positive, neutral, or negative. Then provide a count of each category and a brief summary of the overall sentiment and common themes.

Return your analysis in this JSON format:
{
  "positive": number,
  "neutral": number,
  "negative": number,
  "summary": "Your detailed analysis here"
}

Here are the messages:
${userMessages.join('\n\n')}`
                        }
                    ]
                })
            });
            
            const data = await response.json();
            let analysisResult;
            
            try {
                // Aggiungi log per il debug
                console.log('Claude response:', JSON.stringify(data));
                
                // Verifica che la risposta abbia la struttura attesa
                if (!data || !data.content || !Array.isArray(data.content) || data.content.length === 0) {
                    console.error('Unexpected Claude response structure:', data);
                    throw new Error('Invalid response structure from Claude');
                }
                
                const content = data.content[0].text;
                
                // Estrai il JSON dalla risposta
                const jsonMatch = content.match(/```json\n([\s\S]*?)\n```/);
                
                if (jsonMatch) {
                    analysisResult = JSON.parse(jsonMatch[1]);
                } else {
                    console.error('No valid JSON found in Claude response');
                    throw new Error('Invalid response structure from Claude');
                }
            } catch (error) {
                console.error('Error parsing Claude response:', error);
                throw error;
            }
            
            // Crea nuova analisi di sentimente
            const sentimentAnalysis = new SentimentAnalysis({
                hotelId,
                positive: analysisResult.positive,
                neutral: analysisResult.neutral,
                negative: analysisResult.negative,
                summary: analysisResult.summary,
                createdAt: new Date()
            });

            await sentimentAnalysis.save();

            res.json({
                positive: analysisResult.positive,
                neutral: analysisResult.neutral,
                negative: analysisResult.negative,
                summary: analysisResult.summary,
                createdAt: sentimentAnalysis.createdAt,
                isCached: false
            });
        } catch (error) {
            console.error('Error generating sentiment analysis:', error);
            res.status(500).json({ 
                message: 'Error generating sentiment analysis',
                error: error.message
            });
        }
    },

    handleReviewRedirect: async (req, res) => {
        try {
            // Implementazione temporanea di base
            const { id } = req.query;
            // Reindirizza a una pagina predefinita o restituisci un messaggio
            res.send("Review redirect functionality will be implemented soon");
        } catch (error) {
            console.error('Error in handleReviewRedirect:', error);
            res.status(500).json({ message: 'Internal server error' });
        }
    },

    getSentimentAnalysisHistory: async (req, res) => {
        try {
            const { hotelId } = req.params;
            
            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Recupera le ultime 10 analisi del sentiment
            const analyses = await SentimentAnalysis.find({ hotelId })
                .sort({ createdAt: -1 })
                .limit(10);
                
            res.json(analyses);
        } catch (error) {
            console.error('Error fetching sentiment analysis history:', error);
            res.status(500).json({ 
                message: 'Error fetching sentiment analysis history',
                error: error.message 
            });
        }
    },
};

module.exports = whatsappAssistantController;