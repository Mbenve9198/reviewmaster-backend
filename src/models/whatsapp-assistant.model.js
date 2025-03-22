const mongoose = require('mongoose');

const whatsappRuleSchema = new mongoose.Schema({
    topic: {
        type: String,
        required: true
    },
    isCustom: {
        type: Boolean,
        default: false
    },
    response: {
        type: String,
        required: true
    },
    isActive: {
        type: Boolean,
        default: true
    }
});

const whatsappAssistantSchema = new mongoose.Schema({
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true,
        unique: true // Un hotel può avere solo un assistente
    },
    timezone: {
        type: String,
        required: true
    },
    breakfast: {
        startTime: {
            type: String,
            required: true
        },
        endTime: {
            type: String,
            required: true
        }
    },
    checkIn: {
        startTime: {
            type: String,
            required: true
        },
        endTime: {
            type: String,
            required: true
        }
    },
    reviewLink: {
        type: String,
        required: true
    },
    reviewRequestDelay: {
        type: Number,
        required: true,
        default: 3 // Default 3 giorni
    },
    triggerName: {
        type: String,
        required: true,
        unique: true
    },
    isActive: {
        type: Boolean,
        default: true
    },
    // Impostazioni di credito per l'hotel
    creditSettings: {
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
    },
    rules: {
        type: [whatsappRuleSchema],
        default: []
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('WhatsAppAssistant', whatsappAssistantSchema); 