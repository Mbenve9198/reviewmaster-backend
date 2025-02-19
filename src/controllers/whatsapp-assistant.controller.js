const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const WhatsappInteraction = require('../models/whatsapp-interaction.model');
const Hotel = require('../models/hotel.model');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');

const client = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const anthropic = new Anthropic({
  apiKey: process.env.CLAUDE_API_KEY,
});

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
  it: (hotelName) => `Gentile ospite di ${hotelName},

Grazie per aver scelto la nostra struttura per il suo soggiorno. La sua opinione è molto importante per noi e ci aiuterebbe a migliorare ulteriormente i nostri servizi.

Le saremmo molto grati se potesse dedicare qualche minuto per condividere la sua esperienza:
{link}

La ringraziamo per il suo prezioso feedback e speriamo di poterla accogliere nuovamente.

Cordiali saluti,
Lo staff di ${hotelName}`,

  en: (hotelName) => `Dear ${hotelName} guest,

Thank you for choosing our hotel for your stay. Your opinion is very important to us and would help us further improve our services.

We would be grateful if you could take a few minutes to share your experience:
{link}

Thank you for your valuable feedback and we hope to welcome you again.

Best regards,
The ${hotelName} team`,

  fr: (hotelName) => `Cher client de ${hotelName},

Nous vous remercions d'avoir choisi notre établissement pour votre séjour. Votre avis est très important pour nous et nous aidera à améliorer davantage nos services.

Nous vous serions reconnaissants de prendre quelques minutes pour partager votre expérience :
{link}

Merci pour vos précieux commentaires et nous espérons vous accueillir à nouveau.

Cordialement,
L'équipe ${hotelName}`,

  de: (hotelName) => `Sehr geehrter Gast von ${hotelName},

Vielen Dank, dass Sie sich für unseren Hotel entschieden haben. Ihre Meinung ist uns sehr wichtig und hilft uns, unsere Dienstleistungen weiter zu verbessern.

Wir wären Ihnen dankbar, wenn Sie sich einige Minuten Zeit nehmen könnten, um Ihre Erfahrung zu teilen:
{link}

Vielen Dank für Ihr wertvolles Feedback und wir hoffen, Sie wieder bei uns begrüßen zu dürfen.

Mit freundlichen Grüßen,
Das ${hotelName}-Team`,

  es: (hotelName) => `Estimado huésped de ${hotelName},

Gracias por elegir nuestro establecimiento para su estancia. Su opinión es muy importante para nosotros y nos ayudaría a mejorar aún más nuestros servicios.

Le agradeceríamos que dedicara unos minutos a compartir su experiencia:
{link}

Gracias por sus valiosos comentarios y esperamos darle la bienvenida nuevamente.

Saludos cordiales,
El equipo de ${hotelName}`
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

const scheduleReviewRequest = async (interaction, assistant) => {
    const delayDays = assistant.reviewRequestDelay || 3;
    const scheduledDate = new Date();
    scheduledDate.setDate(scheduledDate.getDate() + delayDays);

    // Aggiorna l'interazione con la data programmata
    interaction.reviewScheduledFor = scheduledDate;
    await interaction.save();

    // Schedula l'invio del messaggio
    setTimeout(async () => {
        try {
            const userLanguage = getLanguageFromPhone(interaction.phoneNumber);
            const messageTemplate = REVIEW_MESSAGES[userLanguage] || REVIEW_MESSAGES.en;
            const reviewMessage = messageTemplate(assistant.hotelId.name)
                .replace('{link}', assistant.reviewLink);

            await client.messages.create({
                body: reviewMessage,
                from: `whatsapp:${process.env.NEXT_PUBLIC_WHATSAPP_NUMBER}`,
                to: interaction.phoneNumber,
                messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
            });

            interaction.reviewRequested = true;
            await interaction.save();
        } catch (error) {
            console.error('Error sending review request:', error);
        }
    }, delayDays * 24 * 60 * 60 * 1000);
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
        try {
            console.log('Raw request body:', req.body);

            const message = {
                Body: req.body.Body,
                From: req.body.From,
                ProfileName: req.body.ProfileName || 'Guest'
            };

            // Prima cerchiamo una conversazione attiva negli ultimi 30 giorni
            const thirtyDaysAgo = new Date();
            thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

            let interaction = await WhatsappInteraction.findOne({
                phoneNumber: message.From,
                lastInteraction: { $gte: thirtyDaysAgo }
            }).populate({
                path: 'hotelId',
                select: 'name type description',
                populate: {
                    path: 'whatsappAssistant'
                }
            });

            let assistant;

            if (interaction && interaction.hotelId?.whatsappAssistant?.isActive) {
                // Se esiste una conversazione attiva, usa quell'assistente
                assistant = interaction.hotelId.whatsappAssistant;
                console.log('Found active conversation with assistant:', {
                    assistantId: assistant._id,
                    hotelName: interaction.hotelId.name,
                    lastInteraction: interaction.lastInteraction
                });
            } else {
                // Se non c'è una conversazione attiva, cerca il trigger name
                const activeAssistants = await WhatsAppAssistant.find({ 
                    isActive: true 
                }).populate('hotelId');

                assistant = activeAssistants.find(ast => 
                    message.Body.toLowerCase().includes(ast.triggerName.toLowerCase())
                );

                console.log('Assistant search result:', {
                    found: !!assistant,
                    message: message.Body,
                    matchedTrigger: assistant?.triggerName,
                    assistantId: assistant?._id,
                    hotelName: assistant?.hotelId?.name
                });
            }

            if (!assistant || !assistant.hotelId) {
                return res.status(200).send({
                    success: false,
                    message: 'No assistant found'
                });
            }

            // Se non esisteva l'interazione, creala
            if (!interaction) {
                interaction = new WhatsappInteraction({
                    hotelId: assistant.hotelId._id,
                    phoneNumber: message.From,
                    firstInteraction: new Date(),
                    dailyInteractions: [{
                        date: new Date(),
                        count: 1
                    }]
                });
                await interaction.save();
                await scheduleReviewRequest(interaction, assistant);
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

            const hotel = assistant.hotelId;

            // Rimuovi il trigger name dal messaggio per l'elaborazione
            const userQuery = message.Body.replace(assistant.triggerName, '').trim();

            // Aggiungi il messaggio dell'utente allo storico
            interaction.conversationHistory.push({
                role: 'user',
                content: userQuery,
                timestamp: new Date()
            });

            // Prepara il contesto della conversazione per Claude
            // Prendiamo gli ultimi 10 messaggi per mantenere il contesto rilevante
            const recentHistory = interaction.conversationHistory
                .slice(-10)
                .map(msg => ({
                    role: msg.role,
                    content: msg.content
                }));

            const userLanguage = getLanguageFromPhone(message.From);
            
            const systemPrompt = `You are ${hotel.name}'s personal WhatsApp concierge, having a natural, friendly conversation with ${message.ProfileName}. 
Always respond in ${userLanguage.toUpperCase()}, maintaining a warm and personal tone.

Remember:
- You're having a casual chat with ${message.ProfileName}, like a helpful friend at the hotel
- Keep responses conversational and natural, avoiding formal or robotic language
- Show empathy and personality in your responses
- Use natural conversation flow, like you would in a real chat
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
            const response = await anthropic.messages.create({
                model: "claude-3-5-sonnet-20241022",
                max_tokens: 500,
                temperature: 0.7,
                system: systemPrompt,
                messages: [
                    ...recentHistory,
                    { 
                        role: "user", 
                        content: userQuery
                    }
                ]
            });

            if (!response?.content?.[0]?.text) {
                throw new Error('Failed to generate response');
            }

            const aiResponse = response.content[0].text;

            // Salva la risposta dell'assistente nello storico
            interaction.conversationHistory.push({
                role: 'assistant',
                content: aiResponse,
                timestamp: new Date()
            });

            // Salva l'interazione aggiornata
            await interaction.save();

            // Invia la risposta via WhatsApp
            await client.messages.create({
                body: aiResponse,
                from: 'whatsapp:' + process.env.NEXT_PUBLIC_WHATSAPP_NUMBER,
                to: message.From,
                messagingServiceSid: process.env.TWILIO_MESSAGING_SERVICE_SID
            });

            res.status(200).send({
                success: true,
                message: 'Message processed successfully'
            });

        } catch (error) {
            console.error('WhatsApp webhook error:', error);
            res.status(500).json({ 
                success: false,
                message: 'Error processing message',
                error: error.message
            });
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
    }
};

module.exports = whatsappAssistantController; 