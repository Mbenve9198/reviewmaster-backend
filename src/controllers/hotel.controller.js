const Hotel = require('../models/hotel.model');
const User = require('../models/user.model');

const hotelController = {
    createHotel: async (req, res) => {
        try {
            console.log('Request body received:', req.body);
            
            const { name, type, description, managerSignature, responseSettings } = req.body;
            const userId = req.userId;

            // Validazione dei campi richiesti
            if (!name || !type || !description || !managerSignature) {
                return res.status(400).json({
                    message: 'Missing required fields',
                    error: 'All fields (name, type, description, managerSignature) are required'
                });
            }

            // Verifica limiti del piano
            const userData = await User.findById(userId);
            if (!userData) {
                return res.status(404).json({ message: 'User not found' });
            }

            console.log('User data:', userData.toObject());
            
            const hotelCount = await Hotel.countDocuments({ userId });
            console.log('Hotel count:', hotelCount);
            console.log('Subscription limits:', userData.subscriptionLimits);

            if (hotelCount >= userData.subscriptionLimits.hotelsLimit) {
                return res.status(403).json({ 
                    message: `Your ${userData.subscription.plan} plan is limited to ${userData.subscriptionLimits.hotelsLimit} hotels` 
                });
            }

            // Aggiungiamo i campi legacy mantenendo quello nuovo
            const hotel = new Hotel({
                name,
                userId,
                type,
                description,
                managerSignature,
                managerName: managerSignature,  // Usiamo managerSignature anche per il vecchio campo
                signature: managerSignature,    // Usiamo managerSignature anche per il vecchio campo
                responseSettings: responseSettings || {
                    style: 'professional',
                    length: 'medium'
                }
            });

            console.log('Attempting to save hotel:', hotel.toObject());

            const savedHotel = await hotel.save();
            console.log('Hotel saved successfully:', savedHotel.toObject());

            res.status(201).json(savedHotel);
        } catch (error) {
            console.error('Create hotel error details:', {
                message: error.message,
                stack: error.stack,
                name: error.name
            });
            res.status(500).json({ 
                message: 'Error creating hotel', 
                error: error.message 
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
