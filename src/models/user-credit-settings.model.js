const mongoose = require('mongoose');

const userCreditSettingsSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    // Soglia minima di crediti prima del top-up automatico
    minimumThreshold: {
        type: Number,
        default: 50
    },
    // Importo da aggiungere durante il top-up automatico
    topUpAmount: {
        type: Number,
        default: 200
    },
    // Se il top-up automatico è attivo
    autoTopUp: {
        type: Boolean,
        default: false
    },
    // Data dell'ultimo top-up automatico
    lastAutoTopUp: {
        type: Date,
        default: null
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('UserCreditSettings', userCreditSettingsSchema); 