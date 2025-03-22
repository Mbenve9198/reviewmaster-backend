const UserCreditSettings = require('../models/user-credit-settings.model');
const { validationResult } = require('express-validator');

/**
 * Ottiene le impostazioni di credito dell'utente
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
exports.getCreditSettings = async (req, res) => {
    try {
        const userId = req.user.id;
        
        // Trova o crea le impostazioni di credito dell'utente
        const creditSettings = await UserCreditSettings.findOrCreate(userId);
        
        // Restituisci le impostazioni al client
        return res.status(200).json({
            minimumThreshold: creditSettings.minimumThreshold,
            topUpAmount: creditSettings.topUpAmount,
            autoTopUp: creditSettings.autoTopUp,
            lastAutoTopUp: creditSettings.lastAutoTopUp
        });
    } catch (error) {
        console.error('Errore nel recupero delle impostazioni di credito:', error);
        return res.status(500).json({ message: 'Errore nel recupero delle impostazioni di credito.' });
    }
};

/**
 * Aggiorna le impostazioni di credito dell'utente
 * @param {Object} req - Request object
 * @param {Object} res - Response object
 */
exports.updateCreditSettings = async (req, res) => {
    try {
        // Verifica errori di validazione
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
        }
        
        const userId = req.user.id;
        const { minimumThreshold, topUpAmount, autoTopUp } = req.body;

        // Costruisci l'oggetto di aggiornamento con solo i campi forniti
        const updateObj = {};
        if (minimumThreshold !== undefined) updateObj.minimumThreshold = minimumThreshold;
        if (topUpAmount !== undefined) updateObj.topUpAmount = topUpAmount;
        if (autoTopUp !== undefined) updateObj.autoTopUp = autoTopUp;

        // Aggiorna le impostazioni
        const updatedSettings = await UserCreditSettings.findOneAndUpdate(
            { userId },
            updateObj,
            { new: true, upsert: true, runValidators: true }
        );

        // Restituisci le impostazioni aggiornate
        return res.status(200).json({
            message: 'Impostazioni di credito aggiornate con successo.',
            settings: {
                minimumThreshold: updatedSettings.minimumThreshold,
                topUpAmount: updatedSettings.topUpAmount,
                autoTopUp: updatedSettings.autoTopUp,
                lastAutoTopUp: updatedSettings.lastAutoTopUp
            }
        });
    } catch (error) {
        console.error('Errore nell\'aggiornamento delle impostazioni di credito:', error);
        return res.status(500).json({ message: 'Errore nell\'aggiornamento delle impostazioni di credito.' });
    }
}; 