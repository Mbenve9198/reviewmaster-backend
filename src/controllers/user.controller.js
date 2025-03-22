const User = require('../models/user.model');
const Hotel = require('../models/hotel.model');
const creditService = require('../services/creditService');
const AppSettings = require('../models/app-settings.model');

const userController = {
    getStats: async (req, res) => {
        try {
            const userId = req.userId;
            
            const [user, hotelsCount, settings] = await Promise.all([
                User.findById(userId),
                Hotel.countDocuments({ userId }),
                AppSettings.getGlobalSettings()
            ]);

            if (!user) {
                return res.status(404).json({ message: 'User not found' });
            }

            // Utilizza il valore delle impostazioni o il valore di fallback dal creditService
            const initialFreeCredits = settings?.credits?.initialFreeCredits || creditService.getInitialFreeCredits();
            
            res.json({
                wallet: {
                    credits: user.wallet.credits,
                    freeScrapingUsed: user.wallet.freeScrapingUsed,
                    freeScrapingRemaining: Math.max(0, initialFreeCredits - user.wallet.freeScrapingUsed)
                },
                hotelsCount,
                // Non rimuovere ancora completamente subscription per retrocompatibilità
                subscription: {
                    status: 'active',
                    responseCredits: user.wallet.credits
                }
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
