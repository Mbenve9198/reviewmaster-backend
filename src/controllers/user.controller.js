const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');

const userController = {
    getStats: async (req, res) => {
        try {
            const userId = req.userId;
            
            // Get user with subscription details
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            
            // Count user's hotels
            const hotelsCount = await Hotel.countDocuments({ userId });
            
            // Get limits based on subscription plan
            const SUBSCRIPTION_LIMITS = {
                trial: {
                    responsesLimit: 10,
                    hotelsLimit: 1
                },
                host: {
                    responsesLimit: 50,
                    hotelsLimit: 2
                },
                manager: {
                    responsesLimit: 200,
                    hotelsLimit: 5
                },
                director: {
                    responsesLimit: 500,
                    hotelsLimit: 10
                }
            };

            const { responsesLimit, hotelsLimit } = SUBSCRIPTION_LIMITS[user.subscription.plan];
            
            // responseCredits nel database sono i crediti rimanenti
            const responsesUsed = responsesLimit - user.subscription.responseCredits;
            
            res.json({
                subscription: {
                    plan: user.subscription.plan,
                    status: user.subscription.status,
                    responsesUsed, // aggiungiamo i crediti usati
                    responseCredits: user.subscription.responseCredits, // crediti rimanenti
                    responsesLimit,
                    hotelsLimit
                },
                hotelsCount
            });
        } catch (error) {
            console.error('Get user stats error:', error);
            res.status(500).json({ 
                message: 'Error fetching user stats', 
                error: error.message 
            });
        }
    }
};

module.exports = userController; 