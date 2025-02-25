const mongoose = require('mongoose');

const messageSchema = new mongoose.Schema({
    role: {
        type: String,
        enum: ['user', 'assistant', 'system'],
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

const reviewTrackingSchema = new mongoose.Schema({
    trackingId: {
        type: String,
        unique: true
    },
    sentAt: {
        type: Date
    },
    clicked: {
        type: Boolean,
        default: false
    },
    clickedAt: {
        type: Date
    },
    clickCount: {
        type: Number,
        default: 0
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
    reviewRequests: [{
        requestedAt: {
            type: Date,
            required: true
        },
        messageId: {
            type: String
        }
    }],
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
    conversationHistory: {
        type: [messageSchema],
        default: []
    },
    isActive: {
        type: Boolean,
        default: true
    },
    reviewTracking: {
        type: reviewTrackingSchema,
        default: null
    }
}, {
    timestamps: true
});

// Indice composto per evitare duplicati
whatsappInteractionSchema.index({ hotelId: 1, phoneNumber: 1 }, { unique: true });

// Indice composto per ottimizzare le query per hotelId e phoneNumber
whatsappInteractionSchema.index({ hotelId: 1, phoneNumber: 1 });

module.exports = mongoose.model('WhatsappInteraction', whatsappInteractionSchema); 