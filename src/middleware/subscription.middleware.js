const User = require('../models/user.model');

const checkSubscription = async (req, res, next) => {
    try {
        const user = await User.findById(req.userId);
        
        if (!user) {
            return res.status(404).json({ 
                message: 'User not found',
                code: 'USER_NOT_FOUND'
            });
        }

        // Verifica trial
        if (user.subscription.plan === 'trial') {
            if (new Date() > new Date(user.subscription.trialEndsAt)) {
                return res.status(403).json({ 
                    message: 'Trial expired',
                    code: 'TRIAL_EXPIRED'
                });
            }
        }
        // Verifica stato abbonamento
        else if (['cancelled', 'past_due', 'inactive'].includes(user.subscription.status)) {
            return res.status(403).json({ 
                message: 'Subscription inactive',
                code: 'SUBSCRIPTION_INACTIVE'
            });
        }

        // Verifica crediti disponibili
        if (user.subscription.responseCredits <= 0) {
            return res.status(403).json({ 
                message: 'No credits available',
                code: 'NO_CREDITS'
            });
        }

        // Se tutto ok, passa al prossimo middleware
        next();
    } catch (error) {
        console.error('Subscription check error:', error);
        res.status(500).json({ 
            message: 'Internal server error',
            code: 'INTERNAL_ERROR'
        });
    }
};

module.exports = checkSubscription;