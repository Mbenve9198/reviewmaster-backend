const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');
const authMiddleware = require('../middleware/auth.middleware');
const checkEmailVerification = require('../middleware/verification.middleware');

// Proteggi tutte le route
router.use(authMiddleware);
router.use(checkEmailVerification);

// Route per creare il Payment Intent per l'acquisto di crediti
router.post('/payment-intent', (req, res) => walletController.createPaymentIntent(req, res));

// Route per ottenere info sul wallet (crediti, free scraping, etc)
router.get('/', (req, res) => walletController.getWalletInfo(req, res));

// Route per ottenere le transazioni con paginazione
router.get('/transactions', (req, res) => walletController.getTransactions(req, res));

// Route per ottenere l'ID cliente Stripe dell'utente
router.get('/stripe-customer', (req, res) => walletController.getStripeCustomerId(req, res));

module.exports = router;