const Hotel = require('../models/hotel.model');
const User = require('../models/user.model');

const SUBSCRIPTION_LIMITS = {
    trial: { hotelsLimit: 1 },
    host: { hotelsLimit: 2 },
    manager: { hotelsLimit: 5 },
    director: { hotelsLimit: 10 }
};

const hotelController = {
    createHotel: async (req, res) => {
        try {
            const { name, type, description, managerSignature, responseSettings } = req.body;
            const userId = req.userId;

            // Validazione input
            if (!name || !type || !description || !managerSignature) {
                return res.status(400).json({
                    message: 'Missing required fields',
                    details: 'name, type, description, and managerSignature are required'
                });
            }

            // Verifica che l'utente esista
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Verifica che l'utente abbia abbastanza crediti
            if (!user.wallet?.credits && user.wallet?.freeScrapingRemaining <= 0) {
                return res.status(403).json({ 
                    message: 'Insufficient credits',
                    details: 'Please purchase credits to add a new hotel'
                });
            }

            // Crea il nuovo hotel
            const hotel = await Hotel.create({
                name,
                userId,
                type: type.toLowerCase(),
                description,
                managerSignature,
                responseSettings: responseSettings || {
                    style: 'professional',
                    length: 'medium'
                }
            });

            res.status(201).json(hotel);
        } catch (error) {
            console.error('Create hotel error:', error);
            res.status(500).json({ 
                message: 'Failed to create hotel',
                error: error.message,
                details: error.stack
            });
        }
    },

    getHotels: async (req, res) => {
        try {
            console.log('GET /hotels - User ID:', req.userId);
            
            const hotels = await Hotel.find({ userId: req.userId });
            console.log('Hotels found:', {
                count: hotels.length,
                hotels: hotels.map(hotel => hotel.toObject())
            });

            res.json(hotels);
        } catch (error) {
            console.error('Get hotels error:', {
                message: error.message,
                stack: error.stack
            });
            res.status(500).json({ message: 'Error fetching hotels' });
        }
    },

    getHotel: async (req, res) => {
        try {
            const hotel = await Hotel.findOne({
                _id: req.params.id,
                userId: req.userId
            });

            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            res.json(hotel);
        } catch (error) {
            console.error('Get hotel error:', error);
            res.status(500).json({ message: 'Error fetching hotel' });
        }
    },

    updateHotel: async (req, res) => {
        try {
            const { name, type, description, managerSignature, responseSettings } = req.body;

            const hotel = await Hotel.findOneAndUpdate(
                { _id: req.params.id, userId: req.userId },
                {
                    name,
                    type,
                    description,
                    managerSignature,
                    managerName: managerSignature,  // Aggiorniamo anche i campi legacy
                    signature: managerSignature,    // Aggiorniamo anche i campi legacy
                    responseSettings
                },
                { new: true }
            );

            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            res.json(hotel);
        } catch (error) {
            console.error('Update hotel error:', error);
            res.status(500).json({ message: 'Error updating hotel' });
        }
    },

    deleteHotel: async (req, res) => {
        try {
            const hotel = await Hotel.findOneAndDelete({
                _id: req.params.id,
                userId: req.userId
            });

            if (!hotel) {
                return res.status(404).json({ message: 'Hotel not found' });
            }

            res.json({ message: 'Hotel deleted successfully' });
        } catch (error) {
            console.error('Delete hotel error:', error);
            res.status(500).json({ message: 'Error deleting hotel' });
        }
    }
};

module.exports = hotelController;
