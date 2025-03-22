const mongoose = require('mongoose');
const Schema = mongoose.Schema;

/**
 * Schema per le impostazioni di credito dell'utente
 * Questo modello centralizza tutte le impostazioni relative ai crediti e all'autoricarica
 * precedentemente gestite dal modello WhatsAppAssistant
 */
const UserCreditSettingsSchema = new Schema({
    // Collegamento all'utente
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },

    // Soglia minima di crediti prima dell'attivazione dell'autoricarica
    minimumThreshold: {
        type: Number,
        required: true,
        default: 50,
        min: 10,
        max: 1000
    },

    // Importo da aggiungere durante l'autoricarica
    topUpAmount: {
        type: Number,
        required: true,
        default: 100,
        min: 50,
        max: 10000
    },

    // Se l'autoricarica è attiva
    autoTopUp: {
        type: Boolean,
        required: true,
        default: false
    },

    // Data dell'ultima autoricarica
    lastAutoTopUp: {
        type: Date,
        default: null
    },

    // Metodo di pagamento predefinito per l'autoricarica (opzionale)
    defaultPaymentMethodId: {
        type: String,
        default: null
    }
}, {
    timestamps: true
});

// Assicura che ci sia solo un'istanza di impostazioni di credito per utente
UserCreditSettingsSchema.index({ userId: 1 }, { unique: true });

/**
 * Metodo statico per trovare o creare le impostazioni di credito dell'utente
 * @param {string} userId - ID dell'utente
 * @param {Object} defaultSettings - Impostazioni predefinite (opzionale)
 * @returns {Promise<Object>} Le impostazioni di credito dell'utente
 */
UserCreditSettingsSchema.statics.findOrCreate = async function(userId, defaultSettings = {}) {
    let creditSettings = await this.findOne({ userId });
    
    if (!creditSettings) {
        creditSettings = await this.create({
            userId,
            minimumThreshold: defaultSettings.minimumThreshold || 50,
            topUpAmount: defaultSettings.topUpAmount || 100,
            autoTopUp: defaultSettings.autoTopUp || false,
            lastAutoTopUp: defaultSettings.lastAutoTopUp || null
        });
    }
    
    return creditSettings;
};

// Metodo per aggiornare le impostazioni
UserCreditSettingsSchema.statics.updateSettings = async function(userId, updates) {
    return this.findOneAndUpdate(
        { userId },
        { $set: updates },
        { 
            new: true,
            upsert: true,
            runValidators: true
        }
    );
};

const UserCreditSettings = mongoose.model('UserCreditSettings', UserCreditSettingsSchema);

module.exports = UserCreditSettings; 