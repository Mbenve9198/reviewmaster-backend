const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const authMiddleware = require('../middleware/auth.middleware');
const verificationController = require('../controllers/verification.controller');
const User = require('../models/user.model');

// Public routes
router.post('/register', (req, res) => authController.register(req, res));
router.post('/login', (req, res) => authController.login(req, res));

// Protected routes
router.get('/profile', authMiddleware, (req, res) => authController.getProfile(req, res));

router.post('/verify-email', verificationController.verifyEmail);
router.post('/resend-verification', authMiddleware, async (req, res) => {
    try {
        const user = await User.findById(req.userId);
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }
        
        if (user.isVerified) {
            return res.status(400).json({ message: 'Email already verified' });
        }
        
        await verificationController.sendVerificationEmail(user);
        res.json({ message: 'Verification email sent' });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ message: 'Error sending verification email' });
    }
});

module.exports = router;