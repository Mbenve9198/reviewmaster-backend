const express = require('express');
const { body } = require('express-validator');
const authenticate = require('../middleware/auth');
const creditSettingsController = require('../controllers/credit-settings.controller');

const router = express.Router();

/**
 * @route   GET /api/credit-settings
 * @desc    Ottiene le impostazioni di credito dell'utente
 * @access  Privato (solo utenti autenticati)
 */
router.get(
  '/',
  authenticate,
  creditSettingsController.getCreditSettings
);

/**
 * @route   PATCH /api/credit-settings
 * @desc    Aggiorna le impostazioni di credito dell'utente
 * @access  Privato (solo utenti autenticati)
 */
router.patch(
  '/',
  authenticate,
  [
    body('minimumThreshold')
      .optional()
      .isInt({ min: 10, max: 1000 })
      .withMessage('La soglia minima deve essere un numero intero tra 10 e 1000'),
    
    body('topUpAmount')
      .optional()
      .isInt({ min: 50, max: 10000 })
      .withMessage('L\'importo di ricarica deve essere un numero intero tra 50 e 10000'),
    
    body('autoTopUp')
      .optional()
      .isBoolean()
      .withMessage('autoTopUp deve essere un valore booleano')
  ],
  creditSettingsController.updateCreditSettings
);

module.exports = router; 