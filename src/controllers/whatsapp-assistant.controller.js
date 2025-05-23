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

// Mapping contenente i Content SID dei template di recensione per ogni lingua
const REVIEW_TEMPLATE_SID = {
  it: 'HX4533258c317da64b5096ab96d1f815ed', // Template italiano
  en: 'HX374a99c6efa8f6b7780e75e000be8698', // Template inglese
  fr: 'HX0f2f6e50fcd2cbd8b29310362371d963', // Template francese
  es: 'HXfc19c13ead7074cd24147e20220844d7', // Template spagnolo
  de: 'HX8eb545806565f0a4ddade6b4319836ee'  // Template tedesco
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

// Funzione per ottenere il testo sui limiti giornalieri in diverse lingue
const getDailyLimitText = (language, inboundLimit, outboundLimit) => {
  const messageLimitsText = {
    it: `Per tua informazione: puoi inviare fino a ${inboundLimit} messaggi al giorno e ricevere fino a ${outboundLimit} risposte.`,
    en: `Just to let you know: you can send up to ${inboundLimit} messages per day and receive up to ${outboundLimit} responses.`,
    fr: `Pour information: vous pouvez envoyer jusqu'à ${inboundLimit} messages par jour et recevoir jusqu'à ${outboundLimit} réponses.`,
    de: `Zur Information: Sie können bis zu ${inboundLimit} Nachrichten pro Tag senden und bis zu ${outboundLimit} Antworten erhalten.`,
    es: `Para tu información: puedes enviar hasta ${inboundLimit} mensajes al día y recibir hasta ${outboundLimit} respuestas.`
  };
  
  return messageLimitsText[language] || messageLimitsText.en;
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
            const { topic, response, isCustom, question } = req.body;

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

            // Assicuriamoci che ci sia sempre un valore per question
            const questionValue = question || topic;
            
            // Log di debug per vedere i valori
            console.log('Creazione regola con valori:', {
                topic,
                response,
                isCustom: isCustom || false,
                isActive: true,
                question: questionValue
            });

            // Crea un nuovo documento per la regola
            const newRule = {
                topic,
                response,
                isCustom: isCustom || false,
                isActive: true,
                question: questionValue
            };
            
            // Aggiungi la nuova regola
            assistant.rules.push(newRule);

            try {
                const savedAssistant = await assistant.save();
                console.log('Assistente salvato con successo. Nuova regola:',
                    savedAssistant.rules[savedAssistant.rules.length - 1]);
                
                res.status(201).json(savedAssistant.rules[savedAssistant.rules.length - 1]);
            } catch (saveError) {
                console.error('Errore durante il salvataggio della regola:', saveError);
                // Log dettagliato dell'errore di validazione
                if (saveError.name === 'ValidationError') {
                    console.error('Dettagli errore di validazione:');
                    for (let field in saveError.errors) {
                        console.error(`Campo: ${field}, Messaggio: ${saveError.errors[field].message}, Valore: ${saveError.errors[field].value}`);
                    }
                }
                throw saveError;
            }
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

            // Se stiamo aggiornando il campo topic ma non c'è question, aggiorniamo anche question
            if (updateData.topic && !updateData.question) {
                updateData.question = updateData.topic;
            }

            // Log dei dati prima dell'aggiornamento
            console.log('Aggiornamento regola con ID:', ruleId);
            console.log('Dati originali:', assistant.rules[ruleIndex]);
            console.log('Dati aggiornamento:', updateData);

            // Aggiorna i campi della regola
            Object.assign(assistant.rules[ruleIndex], updateData);

            // Assicurati che question sia sempre presente
            if (!assistant.rules[ruleIndex].question) {
                assistant.rules[ruleIndex].question = assistant.rules[ruleIndex].topic;
                console.log('Impostato question dal topic:', assistant.rules[ruleIndex].topic);
            }

            console.log('Dati finali dopo le modifiche:', assistant.rules[ruleIndex]);

            try {
                const savedAssistant = await assistant.save();
                console.log('Assistente aggiornato con successo. Regola aggiornata:', 
                    savedAssistant.rules[ruleIndex]);
                
                res.json(savedAssistant.rules[ruleIndex]);
            } catch (saveError) {
                console.error('Errore durante l\'aggiornamento della regola:', saveError);
                // Log dettagliato dell'errore di validazione
                if (saveError.name === 'ValidationError') {
                    console.error('Dettagli errore di validazione:');
                    for (let field in saveError.errors) {
                        console.error(`Campo: ${field}, Messaggio: ${saveError.errors[field].message}, Valore: ${saveError.errors[field].value}`);
                    }
                }
                throw saveError;
            }
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
            
            // Verifica limiti di messaggi
            console.log('=== VERIFICA LIMITI MESSAGGI ===');
            
            if (assistant.messageLimits && assistant.messageLimits.enabled) {
                // Incrementa il contatore dei messaggi in ingresso
                interaction.incrementDailyCounter('inbound');
                
                // Verifica se l'utente ha superato il limite giornaliero
                const inboundLimit = assistant.messageLimits.inboundPerDay || 5;
                const outboundLimit = assistant.messageLimits.outboundPerDay || 5;
                
                console.log('Limiti messaggi configurati:', {
                    inbound: inboundLimit,
                    outbound: outboundLimit,
                    enabled: assistant.messageLimits.enabled
                });
                
                // Verifica e registra le interazioni di oggi
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const todayInteraction = interaction.dailyInteractions.find(
                    interaction => new Date(interaction.date).setHours(0, 0, 0, 0) === today.getTime()
                );
                
                if (todayInteraction) {
                    console.log('Interazioni odierne:', {
                        inbound: todayInteraction.inboundCount,
                        outbound: todayInteraction.outboundCount,
                        limiteInbound: inboundLimit,
                        limiteOutbound: outboundLimit
                    });
                }
                
                // Verifica se l'utente ha raggiunto il limite di messaggi in ingresso
                const hasReachedInboundLimit = interaction.hasReachedDailyLimit('inbound', inboundLimit);
                
                if (hasReachedInboundLimit) {
                    console.log('LIMITE MESSAGGI RAGGIUNTO per cliente:', message.ProfileName || 'Ospite');
                    
                    // Verifica se abbiamo già inviato una notifica oggi usando il nuovo metodo
                    const limitNotificationAlreadySent = interaction.hasLimitNotificationSentToday();
                    
                    if (limitNotificationAlreadySent) {
                        console.log('Notifica di limite già inviata oggi, nessun messaggio verrà inviato.');
                    } else {
                        console.log('Invio notifica di limite raggiunto...');
                        
                        // Prepara il messaggio multilingua di limite raggiunto
                        const limitMessage = {
                            it: `Spiacenti, hai raggiunto il limite giornaliero di ${inboundLimit} messaggi. Potrai inviare altri messaggi domani.`,
                            en: `Sorry, you have reached the daily limit of ${inboundLimit} messages. You can send more messages tomorrow.`,
                            fr: `Désolé, vous avez atteint la limite quotidienne de ${inboundLimit} messages. Vous pourrez envoyer d'autres messages demain.`,
                            de: `Entschuldigung, Sie haben das tägliche Limit von ${inboundLimit} Nachrichten erreicht. Sie können morgen weitere Nachrichten senden.`,
                            es: `Lo sentimos, has alcanzado el límite diario de ${inboundLimit} mensajes. Podrás enviar más mensajes mañana.`
                        };
                        
                        const userLanguage = getLanguageFromPhone(message.From);
                        
                        // Non consumare crediti per questo messaggio di risposta
                        await twilioClient.messages.create({
                            body: limitMessage[userLanguage] || limitMessage.en,
                            from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                            to: message.From,
                            messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                        });
                        
                        // Segna che abbiamo inviato la notifica usando il nuovo metodo
                        interaction.markLimitNotificationSent();
                        console.log('Notifica di limite inviata e registrata.');
                    }
                    
                    // Salva l'interazione con il conteggio aggiornato
                    await interaction.save();
                    
                    // Return empty TwiML response
                    res.set('Content-Type', 'text/xml');
                    return res.send('<Response></Response>');
                }
            }
            
            // Procedi con il consumo dei crediti per il messaggio in ingresso
            try {
                await creditService.consumeCredits(
                    assistant.hotelId._id.toString(), 
                    'inbound', 
                    interaction._id, 
                    `Messaggio WhatsApp in ingresso da ${message.ProfileName || 'Ospite'}`
                );
                
                // Log dettagliato dei crediti consumati
                console.log('=== CREDITI CONSUMATI (INBOUND) ===');
                console.log(`- Costo messaggio in entrata: ${creditService.CREDIT_COSTS.INBOUND_MESSAGE} crediti`);
                console.log(`- Da: ${message.ProfileName || 'Ospite'} (${message.From})`);
                console.log(`- Hotel: ${assistant.hotelId.name} (ID: ${assistant.hotelId._id})`);
            } catch (creditError) {
                console.error('Error consuming credits for inbound message:', creditError);
                // Continuiamo comunque il flusso, poiché è meglio servire il messaggio anche in caso di errore di crediti
                // (proteggiamo già all'inizio della funzione con creditStatus.hasCredits)
            }
            
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
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            
            const recentReviews = interaction.reviewRequests?.filter(
                review => new Date(review.requestedAt) > threeMonthsAgo
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
                    console.log('*** TENTATIVO DI SCHEDULING RECENSIONE (funzione dedicata) ***');
                    
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
                    
                    // Sostituisco il codice che invia il messaggio di recensione usando il template
                    const userLanguage = getLanguageFromPhone(interaction.phoneNumber);
                    console.log('Lingua utente rilevata:', userLanguage);

                    // Recupera il Content SID appropriato in base alla lingua dell'utente
                    const contentSid = REVIEW_TEMPLATE_SID[userLanguage] || REVIEW_TEMPLATE_SID.en;
                    
                    console.log('Utilizzando template recensione:', contentSid);
                    
                    // Client Twilio
                    const twilioClient = twilio(
                        process.env.TWILIO_ACCOUNT_SID,
                        process.env.TWILIO_AUTH_TOKEN
                    );
                    
                    // Utilizza lo scheduling nativo di Twilio con template
                    console.log('Chiamata a Twilio API per scheduling con template...');
                    
                    // Costruisce un URL di reindirizzamento usando il formato con query parameter che funziona correttamente
                    const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://api.replai.app';
                    const encodedReviewLink = encodeURIComponent(assistant.reviewLink);
                    const redirectUrl = `${baseUrl}/api/redirect/review?id=${encodedReviewLink}`;
                    
                    console.log('Link di recensione originale:', assistant.reviewLink);
                    console.log('Link di recensione codificato:', redirectUrl);
                    
                    const twilioMessage = await twilioClient.messages.create({
                        contentSid: contentSid,
                        contentVariables: JSON.stringify({
                            1: assistant.hotelId.name,                   // Nome hotel
                            2: interaction.profileName || 'Guest',       // Nome cliente
                            3: redirectUrl                              // Link di recensione modificato per il reindirizzamento
                        }),
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
                    try {
                        await creditService.consumeCredits(
                            assistant.hotelId._id.toString(),
                            'scheduled',
                            interaction._id,
                            `Richiesta recensione programmata per ${interaction.phoneNumber}`
                        );
                    } catch (creditError) {
                        console.error('Error consuming credits for scheduled message:', creditError);
                        // Continuiamo comunque poiché il messaggio è già stato programmato
                    }
                    
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

${isNewConversation && assistant.messageLimits && assistant.messageLimits.enabled ? `IMPORTANT: For this FIRST message only, after your greeting, include this information about message limits in a natural, conversational way (translate it appropriately to match the user's language):

"${getDailyLimitText(userLanguage, assistant.messageLimits.inboundPerDay, assistant.messageLimits.outboundPerDay)}"

Make this information sound friendly and natural, not like a system message. Integrate it smoothly into your conversation.` : ''}

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
- Breakfast: ${typeof assistant.breakfast === 'string' 
    ? assistant.breakfast 
    : `${assistant.breakfast.startTime} - ${assistant.breakfast.endTime}`}
- Check-in: ${typeof assistant.checkIn === 'string' 
    ? assistant.checkIn 
    : `${assistant.checkIn.startTime} - ${assistant.checkIn.endTime}`}
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

            // Verifica limiti di messaggi in uscita
            let canSendOutboundMessage = true;
            
            if (assistant.messageLimits && assistant.messageLimits.enabled) {
                // Verifica se l'utente ha superato il limite giornaliero dei messaggi in uscita
                const outboundLimit = assistant.messageLimits.outboundPerDay || 5;
                const hasReachedOutboundLimit = interaction.hasReachedDailyLimit('outbound', outboundLimit);
                
                if (hasReachedOutboundLimit) {
                    console.log('LIMITE MESSAGGI IN USCITA RAGGIUNTO per cliente:', message.ProfileName || 'Ospite');
                    canSendOutboundMessage = false;
                    
                    // Log dettagliato ma non inviamo nessun messaggio (per non peggiorare l'esperienza utente)
                    console.log(`Impossibile inviare risposta: limite di ${outboundLimit} messaggi in uscita raggiunto`);
                }
            }
            
            if (canSendOutboundMessage) {
                // Consumo crediti per il messaggio in uscita
                try {
                    await creditService.consumeCredits(
                        assistant.hotelId._id.toString(), 
                        'outbound', 
                        interaction._id, 
                        `Messaggio WhatsApp in uscita per ${message.ProfileName || 'Ospite'}`
                    );
    
                    // Log dettagliato dei crediti consumati
                    console.log('=== CREDITI CONSUMATI (OUTBOUND) ===');
                    console.log(`- Costo messaggio in uscita: ${creditService.CREDIT_COSTS.OUTBOUND_MESSAGE} crediti`);
                    console.log(`- A: ${message.ProfileName || 'Ospite'} (${message.From})`);
                    console.log(`- Hotel: ${assistant.hotelId.name} (ID: ${assistant.hotelId._id})`);
                    
                    // Nuovo log per il totale dei crediti consumati
                    console.log('=== RIEPILOGO CREDITI ===');
                    console.log(`- Totale crediti consumati per questa interazione: ${creditService.CREDIT_COSTS.INBOUND_MESSAGE + creditService.CREDIT_COSTS.OUTBOUND_MESSAGE}`);
                } catch (creditError) {
                    // Log dell'errore senza interrompere il flusso o inviare una nuova risposta
                    // (La risposta è già stata inviata sopra con res.send)
                    console.error('Error consuming credits for outbound message:', creditError);
                }
    
                // Invia la risposta conversazionale via Twilio
                try {
                    // Incrementa il contatore dei messaggi in uscita
                    interaction.incrementDailyCounter('outbound');
                    await interaction.save();
                    
                    // Invia il messaggio tramite Twilio
                    await twilioClient.messages.create({
                        body: assistantResponse,
                        from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                        to: message.From,
                        messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
                    });
                } catch (twilioError) {
                    console.error('Errore invio messaggio Twilio:', twilioError);
                }
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
                if (req.body && req.body.From) {
                    await twilio(
                        process.env.TWILIO_ACCOUNT_SID,
                        process.env.TWILIO_AUTH_TOKEN
                    ).messages.create({
                        body: "I apologize, but I couldn't process your message. Please try again later.",
                        from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                        to: req.body.From,
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
            
            // Raccoglie dati dettagliati sui clic delle recensioni
            const reviewClickDetails = interactions
                .filter(interaction => interaction.reviewTracking && interaction.reviewTracking.clicked)
                .map(interaction => ({
                    phoneNumber: interaction.phoneNumber,
                    profileName: interaction.profileName || 'Ospite',
                    clickedAt: interaction.reviewTracking.clickedAt,
                    sentAt: interaction.reviewTracking.sentAt || interaction.reviewScheduledFor,
                    clickCount: interaction.reviewTracking.clickCount || 1,
                    // Calcola il tempo impiegato per cliccare (in ore)
                    timeTaken: interaction.reviewTracking.clickedAt && interaction.reviewTracking.sentAt ? 
                        Math.round((new Date(interaction.reviewTracking.clickedAt) - new Date(interaction.reviewTracking.sentAt)) / (1000 * 60 * 60)) : 
                        null
                }))
                .sort((a, b) => new Date(b.clickedAt) - new Date(a.clickedAt)); // Ordina per data di clic (più recenti prima)
            
            // Statistiche temporali sui clic
            const clickTimings = reviewClickDetails
                .filter(detail => detail.timeTaken !== null)
                .reduce((acc, detail) => {
                    // Raggruppa i tempi in categorie
                    let category;
                    if (detail.timeTaken < 1) {
                        category = 'lessThanHour';
                    } else if (detail.timeTaken < 24) {
                        category = 'sameDay';
                    } else {
                        category = 'laterDays';
                    }
                    acc[category]++;
                    return acc;
                }, { lessThanHour: 0, sameDay: 0, laterDays: 0 });
            
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
            
            // Clic su recensioni per giorno negli ultimi 30 giorni
            const reviewClicksByDay = {};
            
            // Inizializza gli ultimi 30 giorni a zero
            for (let i = 0; i < 30; i++) {
                const date = new Date();
                date.setDate(date.getDate() - i);
                const dateString = date.toISOString().split('T')[0];
                reviewClicksByDay[dateString] = 0;
            }
            
            // Popola con i dati reali
            reviewClickDetails.forEach(detail => {
                if (detail.clickedAt && new Date(detail.clickedAt) >= thirtyDaysAgo) {
                    const dateString = new Date(detail.clickedAt).toISOString().split('T')[0];
                    if (dateString in reviewClicksByDay) {
                        reviewClicksByDay[dateString]++;
                    }
                }
            });
            
            // Converti in array per il frontend
            const messagesByDate = Object.keys(messagesPerDay).map(date => ({
                date,
                user: messagesPerDay[date].user,
                assistant: messagesPerDay[date].assistant,
                total: messagesPerDay[date].user + messagesPerDay[date].assistant
            })).sort((a, b) => a.date.localeCompare(b.date));
            
            // Converti in array per il frontend
            const clicksByDate = Object.keys(reviewClicksByDay).map(date => ({
                date,
                clicks: reviewClicksByDay[date]
            })).sort((a, b) => a.date.localeCompare(b.date));
            
            res.json({
                totalInteractions,
                totalMessages,
                userMessages,
                assistantMessages,
                reviewsSent,
                reviewsClicked,
                clickThroughRate,
                messagesByDate,
                // Nuovi dati sui clic delle recensioni
                reviewClicks: {
                    details: reviewClickDetails,
                    timings: clickTimings,
                    byDate: clicksByDate
                }
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
            console.log('=== INIZIO GESTIONE REINDIRIZZAMENTO RECENSIONE ===');
            console.log('URL originalUrl:', req.originalUrl);
            console.log('URL path:', req.path);
            console.log('Query string completa:', req.url.split('?')[1] || 'NESSUNA');
            console.log('Query params:', JSON.stringify(req.query));
            
            // STEP 1: Gestione DIRETTA dell'URL completo nel percorso
            // Questo nuovo approccio controlla PRIMA se l'intero URL contiene un reindirizzamento
            const fullPath = req.originalUrl;
            console.log('Percorso completo ricevuto:', fullPath);
            
            // Verifica se il percorso contiene un'URL di recensione (TripAdvisor, Google, ecc.)
            if (fullPath.includes('/review/')) {
                // Estrai tutto ciò che viene dopo "/review/"
                let redirectUrl = fullPath.split('/review/')[1];
                console.log('URL estratto dopo /review/:', redirectUrl || 'NESSUNO');
                
                if (redirectUrl) {
                    // Gestione URL malformati specifici
                    // Caso 1: URL senza protocollo
                    if (redirectUrl.startsWith('www.')) {
                        redirectUrl = 'https://' + redirectUrl;
                        console.log('Aggiunto protocollo https a URL che inizia con www:', redirectUrl);
                    }
                    
                    // Caso 2: URL con https:/ invece di https://
                    if (redirectUrl.startsWith('https:/') && !redirectUrl.startsWith('https://')) {
                        redirectUrl = redirectUrl.replace('https:/', 'https://');
                        console.log('Corretto URL malformato (https:/):', redirectUrl);
                    }
                    
                    // Caso 3: URL con http:/ invece di http://
                    if (redirectUrl.startsWith('http:/') && !redirectUrl.startsWith('http://')) {
                        redirectUrl = redirectUrl.replace('http:/', 'http://');
                        console.log('Corretto URL malformato (http:/):', redirectUrl);
                    }
                    
                    // Verifica che sia un URL valido per recensioni
                    if (
                        redirectUrl.includes('tripadvisor') || 
                        redirectUrl.includes('google.com/maps') || 
                        redirectUrl.includes('booking.com') ||
                        redirectUrl.includes('trustpilot')
                    ) {
                        console.log('URL riconosciuto come valido per recensioni, reindirizzamento diretto a:', redirectUrl);
                        return res.redirect(redirectUrl);
                    } else {
                        console.log('URL estratto non riconosciuto come piattaforma di recensione:', redirectUrl);
                    }
                } else {
                    console.log('ERRORE: Percorso contiene /review/ ma nessun URL dopo');
                }
            }
            
            // STEP 2: Ottenere l'ID dalla richiesta in vari modi possibili
            let id = null;
            
            // Metodo 1: Dalla query string ?id=xyz
            if (req.query && req.query.id) {
                id = req.query.id;
                console.log('ID trovato nella query string:', id);
            }
            
            // Metodo 2: Dai parametri dell'URL route /:id
            if (!id && req.params && req.params[0]) {
                id = req.params[0];
                console.log('ID trovato nei parametri URL:', id);
            }
            
            // Metodo 3: Dall'ultimo segmento del path
            if (!id) {
                const urlParts = req.originalUrl.split('/');
                if (urlParts.length > 0) {
                    id = urlParts[urlParts.length - 1];
                    // Se c'è una query string, rimuoviamola
                    if (id && id.includes('?')) {
                        id = id.split('?')[0];
                    }
                    console.log('ID estratto dall\'ultimo segmento URL:', id);
                }
            }
            
            if (!id) {
                console.log('ERRORE: Nessun ID trovato nella richiesta');
                return res.status(400).json({ message: 'Missing review link ID' });
            }
            
            // STEP 3: Correggi URL malformati (caso specifico https:/ invece di https://)
            if (id.includes('https:/') && !id.includes('https://')) {
                id = id.replace('https:/', 'https://');
                console.log('URL corretto da formato malformato:', id);
            }
            
            // STEP 4: Gestisci il caso specifico del link completo nel path
            // Verifica se l'URL completo è nella forma /review/https://www.tripadvisor...
            if (req.originalUrl.includes('/review/http')) {
                const urlMatch = req.originalUrl.match(/\/review\/(https?:\/\/.*)/);
                if (urlMatch && urlMatch[1]) {
                    const extractedUrl = urlMatch[1];
                    console.log('URL estratto direttamente dal path completo:', extractedUrl);
                    
                    // Verifica se l'URL è un link TripAdvisor, Google o Booking
                    if (extractedUrl.includes('tripadvisor') || 
                        extractedUrl.includes('google.com') || 
                        extractedUrl.includes('booking.com')) {
                        console.log('Reindirizzamento diretto all\'URL estratto dal path');
                        return res.redirect(extractedUrl);
                    }
                }
            }
            
            // STEP 5: Decodifica l'ID se è URL encoded
            let decodedId = id;
            try {
                // Verifica se l'ID è già un URL valido (potrebbe non essere codificato)
                if (id.startsWith('http')) {
                    console.log('ID già in formato URL non codificato:', id);
                } else {
                    // Prova a decodificare (potrebbe generare errore se non è URL encoded)
                    decodedId = decodeURIComponent(id);
                    console.log('ID decodificato da URL encoded:', decodedId);
                    
                    // Dopo decodifica, controlla di nuovo la forma malformata https:/
                    if (decodedId.includes('https:/') && !decodedId.includes('https://')) {
                        decodedId = decodedId.replace('https:/', 'https://');
                        console.log('URL decodificato corretto da formato malformato:', decodedId);
                    }
                }
            } catch (decodeError) {
                console.log('Errore nella decodifica URL, uso ID originale:', decodeError.message);
                // Continua con l'ID originale
            }
            
            // STEP 6: Se l'ID decodificato è un URL completo, reindirizza direttamente
            if (decodedId.startsWith('http')) {
                console.log('AZIONE: Reindirizzamento diretto all\'URL:', decodedId);
                return res.redirect(decodedId);
            }
            
            // STEP 7: Caso speciale per URL di TripAdvisor malformati
            if (decodedId.includes('tripadvisor') || decodedId.includes('google.com') || decodedId.includes('booking.com')) {
                // Prova a correggere URL malformati per TripAdvisor e altri
                if (decodedId.includes('www.tripadvisor') && !decodedId.startsWith('http')) {
                    const fixedUrl = 'https://' + decodedId;
                    console.log('AZIONE: Correzione di URL TripAdvisor senza protocollo:', fixedUrl);
                    return res.redirect(fixedUrl);
                }
                
                // In caso sia ancora un URL malformato ma riconoscibile come TripAdvisor
                console.log('AZIONE: URL riconosciuto come recensione, tentativo di reindirizzamento diretto');
                return res.redirect(decodedId);
            }
            
            // STEP 8: Cerca l'hotel o l'assistente nel database
            console.log('Ricerca nel database per hotel o assistenti con reviewLink...');
            
            // Cerca hotel con reviewLink corrispondente
            const hotel = await Hotel.findOne({ reviewLink: { $regex: id, $options: 'i' } });
            
            if (hotel) {
                console.log('TROVATO: Hotel con ID:', hotel._id);
                console.log('AZIONE: Reindirizzamento a:', hotel.reviewLink);
                
                // Traccia il clic (se possibile)
                try {
                    const interaction = await WhatsappInteraction.findOne({
                        hotelId: hotel._id
                    }).sort({ lastInteraction: -1 });
                    
                    if (interaction) {
                        if (interaction.reviewTracking) {
                            interaction.reviewTracking.clicked = true;
                            interaction.reviewTracking.clickedAt = new Date();
                            interaction.reviewTracking.clickCount += 1;
                        } else {
                            interaction.reviewTracking = {
                                trackingId: id,
                                sentAt: interaction.reviewScheduledFor || new Date(),
                                clicked: true,
                                clickedAt: new Date(),
                                clickCount: 1
                            };
                        }
                        
                        await interaction.save();
                        console.log('Tracciamento clic registrato per interazione:', interaction._id);
                    }
                } catch (trackingError) {
                    console.error('Errore nel tracciamento del clic:', trackingError);
                    // Continuiamo con il reindirizzamento comunque
                }
                
                return res.redirect(hotel.reviewLink);
            }
            
            // Se non troviamo un hotel, cerca un assistente
            console.log('Nessun hotel trovato, cerco assistenti...');
            
            // Cerca assistente con reviewLink esatto
            const assistant = await WhatsAppAssistant.findOne({ reviewLink: id }).populate('hotelId');
            if (assistant) {
                console.log('TROVATO: Assistente con ID:', assistant._id);
                console.log('AZIONE: Reindirizzamento a:', assistant.reviewLink);
                return res.redirect(assistant.reviewLink);
            }
            
            // Cerca assistente con reviewLink parziale
            const partialAssistant = await WhatsAppAssistant.findOne({ 
                reviewLink: { $regex: id, $options: 'i' } 
            }).populate('hotelId');
            
            if (partialAssistant) {
                console.log('TROVATO: Assistente con match parziale, ID:', partialAssistant._id);
                console.log('AZIONE: Reindirizzamento a:', partialAssistant.reviewLink);
                return res.redirect(partialAssistant.reviewLink);
            }
            
            // Fallback: reindirizza alla home
            console.log('FALLBACK: Nessuna corrispondenza trovata, reindirizzamento alla home');
            console.log('=== FINE GESTIONE REINDIRIZZAMENTO RECENSIONE ===');
            return res.redirect('https://replai.app/');
        } catch (error) {
            console.error('ERRORE in handleReviewRedirect:', error);
            // In caso di errore, reindirizza alla home
            return res.redirect('https://replai.app/');
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

    updateMessageLimits: async (req, res) => {
        try {
            const { hotelId } = req.params;
            const { inboundPerDay, outboundPerDay, enabled } = req.body;
            
            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }
            
            // Trova l'assistente WhatsApp dell'hotel
            const assistant = await WhatsAppAssistant.findOne({ hotelId });
            if (!assistant) {
                return res.status(404).json({ message: 'Assistant not found' });
            }
            
            // Inizializza la struttura se non esiste
            if (!assistant.messageLimits) {
                assistant.messageLimits = {
                    inboundPerDay: 5,
                    outboundPerDay: 5,
                    enabled: true
                };
            }
            
            // Aggiorna i limiti se forniti nella richiesta
            if (inboundPerDay !== undefined) {
                // Assicuriamo che il valore sia almeno 5
                assistant.messageLimits.inboundPerDay = Math.max(5, inboundPerDay);
            }
            
            if (outboundPerDay !== undefined) {
                // Assicuriamo che il valore sia almeno 5
                assistant.messageLimits.outboundPerDay = Math.max(5, outboundPerDay);
            }
            
            if (enabled !== undefined) {
                assistant.messageLimits.enabled = enabled;
            }
            
            // Salva le modifiche
            await assistant.save();
            
            // Restituisci i dati aggiornati
            res.json({
                hotelId: assistant.hotelId,
                messageLimits: assistant.messageLimits
            });
        } catch (error) {
            console.error('Update message limits error:', error);
            res.status(500).json({ 
                message: 'Error updating message limits',
                error: error.message
            });
        }
    },

    getMessageLimits: async (req, res) => {
        try {
            const { hotelId } = req.params;
            
            // Verifica che l'hotel appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }
            
            // Trova l'assistente WhatsApp dell'hotel
            const assistant = await WhatsAppAssistant.findOne({ hotelId });
            if (!assistant) {
                return res.status(404).json({ message: 'Assistant not found' });
            }
            
            // Restituisci i dati dei limiti
            res.json({
                hotelId: assistant.hotelId,
                messageLimits: assistant.messageLimits || {
                    inboundPerDay: 5,
                    outboundPerDay: 5,
                    enabled: true
                }
            });
        } catch (error) {
            console.error('Get message limits error:', error);
            res.status(500).json({ 
                message: 'Error fetching message limits',
                error: error.message
            });
        }
    },

    // Funzione per scheduling delle recensioni utilizzando i template
    scheduleReviewRequest: async (interaction, assistant) => {
        try {
            console.log('*** TENTATIVO DI SCHEDULING RECENSIONE (funzione dedicata) ***');
            
            // Verifica se una recensione è stata inviata negli ultimi 3 mesi
            const threeMonthsAgo = new Date();
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            
            const recentReviews = interaction.reviewRequests?.filter(
                review => new Date(review.requestedAt) > threeMonthsAgo
            ) || [];
            
            if (recentReviews.length > 0) {
                console.log('Recensione già inviata negli ultimi 3 mesi:', {
                    dataUltimaRecensione: recentReviews[recentReviews.length - 1].requestedAt,
                    giorniPassati: Math.floor((new Date() - new Date(recentReviews[recentReviews.length - 1].requestedAt)) / (1000 * 60 * 60 * 24))
                });
                return false;
            }
            
            // Scheduliamo una recensione solo se l'assistente ha un link configurato
            if (!assistant.reviewLink) {
                console.log('Non scheduliamo: assistente senza link per recensioni configurato');
                return false;
            }
            
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
            
            // Recupera il Content SID appropriato in base alla lingua dell'utente
            const contentSid = REVIEW_TEMPLATE_SID[userLanguage] || REVIEW_TEMPLATE_SID.en;
            
            console.log('Utilizzando template recensione:', contentSid);
            
            // Client Twilio
            const twilioClient = twilio(
                process.env.TWILIO_ACCOUNT_SID,
                process.env.TWILIO_AUTH_TOKEN
            );
            
            // Utilizza lo scheduling nativo di Twilio con template
            console.log('Chiamata a Twilio API per scheduling con template...');
            
            // Costruisce un URL di reindirizzamento usando il formato con query parameter che funziona correttamente
            const baseUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://api.replai.app';
            const encodedReviewLink = encodeURIComponent(assistant.reviewLink);
            const redirectUrl = `${baseUrl}/api/redirect/review?id=${encodedReviewLink}`;
            
            console.log('Link di recensione originale:', assistant.reviewLink);
            console.log('Link di recensione codificato:', redirectUrl);
            
            const twilioMessage = await twilioClient.messages.create({
                contentSid: contentSid,
                contentVariables: JSON.stringify({
                    1: assistant.hotelId.name,                   // Nome hotel
                    2: interaction.profileName || 'Guest',       // Nome cliente
                    3: redirectUrl                              // Link di recensione modificato per il reindirizzamento
                }),
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
            try {
                await creditService.consumeCredits(
                    assistant.hotelId._id.toString(),
                    'scheduled',
                    interaction._id,
                    `Richiesta recensione programmata per ${interaction.phoneNumber}`
                );
            } catch (creditError) {
                console.error('Error consuming credits for scheduled message:', creditError);
                // Continuiamo comunque poiché il messaggio è già stato programmato
            }
            
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
            
            console.log('RECENSIONE SCHEDULATA CON SUCCESSO!');
            return true;
        } catch (error) {
            console.error('ERRORE SCHEDULING RECENSIONE:', error);
            console.error('Stack trace:', error.stack);
            
            if (error.code) {
                console.error('Twilio error code:', error.code);
                console.error('Twilio error message:', error.message);
            }
            
            throw error;
        }
    }
};

module.exports = whatsappAssistantController;