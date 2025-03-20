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

// Route per il reinvio dell'email di verifica (non richiede autenticazione)
router.post('/resend-verification', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.status(400).json({ message: 'Email is required' });
        }
        
        // Trova l'utente tramite email
        const user = await User.findOne({ email });
        
        if (!user) {
            // Per motivi di sicurezza, non riveliamo che l'utente non esiste
            return res.json({ message: 'If an account exists with this email, a verification link has been sent.' });
        }
        
        if (user.isVerified) {
            return res.json({ message: 'If an account exists with this email, a verification link has been sent.' });
        }
        
        await verificationController.sendVerificationEmail(user);
        res.json({ message: 'If an account exists with this email, a verification link has been sent.' });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ message: 'Error sending verification email' });
    }
});

// Aggiungi queste due routes per il reset password
router.post('/reset-password-request', authController.requestPasswordReset);
router.post('/reset-password', authController.resetPassword);

module.exports = router;