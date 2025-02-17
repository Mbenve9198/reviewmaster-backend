const WhatsAppAssistant = require('../models/whatsapp-assistant.model');
const Hotel = require('../models/hotel.model');

const whatsappAssistantController = {
    createAssistant: async (req, res) => {
        try {
            const { hotelId, timezone, breakfast, checkIn, reviewLink, reviewRequestDelay, triggerName } = req.body;

            // Verifica che l'hotel esista e appartenga all'utente
            const hotel = await Hotel.findOne({ _id: hotelId, userId: req.userId });
            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found or unauthorized' });
            }

            // Verifica se esiste già un assistente per questo hotel
            const existingAssistant = await WhatsAppAssistant.findOne({ hotelId });
            if (existingAssistant) {
                return res.status(400).json({ message: 'Assistant already exists for this hotel' });
            }

            const assistant = new WhatsAppAssistant({
                hotelId,
                timezone,
                breakfast,
                checkIn,
                reviewLink,
                reviewRequestDelay,
                triggerName
            });

            await assistant.save();

            res.status(201).json(assistant);
        } catch (error) {
            console.error('Create assistant error:', error);
            res.status(500).json({ message: 'Error creating WhatsApp assistant' });
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
    }
};

module.exports = whatsappAssistantController; 