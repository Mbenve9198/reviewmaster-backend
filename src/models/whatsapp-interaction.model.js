const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'assistant'],
        required: true
    },
    content: {
        type: String,
        required: true
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
});

const whatsappInteractionSchema = new mongoose.Schema({
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true
    },
    phoneNumber: {
        type: String,
        required: true
    },
    firstInteraction: {
        type: Date,
        required: true
    },
    reviewRequested: {
        type: Boolean,
        default: false
    },
    reviewScheduledFor: {
        type: Date,
        default: null
    },
    // Aggiungiamo campi per il rate limiting
    dailyInteractions: [{
        date: {
            type: Date,
            required: true
        },
        count: {
            type: Number,
            default: 1
        }
    }],
    monthlyInteractions: {
        type: Number,
        default: 0
    },
    lastInteraction: {
        type: Date,
        default: Date.now
    },
    // Aggiungiamo lo storico della conversazione
    conversationHistory: [messageSchema]
});

// Indice composto per evitare duplicati
whatsappInteractionSchema.index({ hotelId: 1, phoneNumber: 1 }, { unique: true });

module.exports = mongoose.model('WhatsappInteraction', whatsappInteractionSchema); 