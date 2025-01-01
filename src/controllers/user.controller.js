const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');

const userController = {
    getStats: async (req, res) => {
        try {
            const userId = req.userId;
            
            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }
            
            const hotelsCount = await Hotel.countDocuments({ userId });
            
            // Usa i limiti dal virtual del model
            const { responsesLimit, hotelsLimit } = user.subscriptionLimits;
            
            const responsesUsed = responsesLimit - user.subscription.responseCredits;
            
            res.json({
                subscription: {
                    plan: user.subscription.plan,
                    status: user.subscription.status,
                    responsesUsed,
                    responseCredits: user.subscription.responseCredits,
                    responsesLimit,
                    hotelsLimit,
                    nextResetDate: user.subscription.nextResetDate
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
