const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const Hotel = require('../models/hotel.model');

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
    }
};

module.exports = whatsappAssistantController; 