const User = require('../models/user.model');

const checkEmailVerification = async (req, res, next) => {
    try {
        const user = await User.findById(req.userId);
        
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (!user.isVerified) {
            return res.status(403).json({ 
                message: 'Email not verified',
                code: 'EMAIL_NOT_VERIFIED'
            });
        }
        
        next();
    } catch (error) {
        console.error('Email verification check error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

module.exports = checkEmailVerification; 