const Hotel = require('../models/hotel.model');
const User = require('../models/user.model');

const hotelController = {
    // Crea nuovo hotel
    createHotel: async (req, res) => {
        try {
            console.log('Received request body:', req.body);
            const { name, type, description, managerName, signature } = req.body;
            const userId = req.userId;

            // Log dei dati estratti
            console.log('Extracted data:', { 
                name, 
                type, 
                description, 
                managerName, 
                signature,
                userId 
            });

            // Verifica limiti del piano
            const user = await User.findById(userId);
            const hotelCount = await Hotel.countDocuments({ userId });
            
            const planLimits = {
                'trial': 1,
                'host': 1,
                'manager': 5,
                'director': 15
            };

            if (hotelCount >= planLimits[user.subscription.plan]) {
                return res.status(403).json({ 
                    message: `Your ${user.subscription.plan} plan is limited to ${planLimits[user.subscription.plan]} hotels` 
                });
            }

            const hotel = new Hotel({
                name,
                userId,
                type,
                description,
                managerName,
                signature,
                responseSettings: {
                    style: req.body.responseSettings?.style || 'professional',
                    length: req.body.responseSettings?.length || 'medium'
                }
            });

            console.log('Hotel object before save:', hotel);

            await hotel.save();

            res.status(201).json(hotel);
        } catch (error) {
            console.error('Create hotel error details:', error);
            res.status(500).json({ 
                message: 'Error creating hotel', 
                error: error.message,
                details: error.errors
            });
        }
    },

    // Ottieni tutti gli hotel dell'utente
    getHotels: async (req, res) => {
        try {
            const hotels = await Hotel.find({ userId: req.userId });
            res.json(hotels);
        } catch (error) {
            console.error('Get hotels error:', error);
            res.status(500).json({ message: 'Error fetching hotels' });
        }
    },

    // Ottieni un singolo hotel
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

    // Aggiorna hotel
    updateHotel: async (req, res) => {
        try {
            const { name, type, managerName, signature, responseSettings } = req.body;

            const hotel = await Hotel.findOneAndUpdate(
                { _id: req.params.id, userId: req.userId },
                {
                    name,
                    type,
                    managerName,
                    signature,
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

    // Elimina hotel
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