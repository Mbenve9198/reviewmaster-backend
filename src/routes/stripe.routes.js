const express = require('express');
const router = express.Router();
const authenticate = require('../middleware/auth');

/**
 * @route   GET /api/stripe/config
 * @desc    Ottiene la chiave pubblica di Stripe per il frontend
 * @access  Privato (solo utenti autenticati)
 */
router.get('/config', authenticate, (req, res) => {
  try {
    // Invia la chiave pubblica di Stripe al client
    res.json({
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY
    });
  } catch (error) {
    console.error('Errore nel recupero della configurazione Stripe:', error);
    res.status(500).json({ message: 'Errore nel recupero della configurazione Stripe' });
  }
});

// Nota: le operazioni di pagamento sono gestite principalmente tramite il webhook in stripe.webhook.js

module.exports = router; 