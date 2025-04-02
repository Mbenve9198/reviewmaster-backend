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
        inboundCount: {
            type: Number,
            default: 0
        },
        outboundCount: {
            type: Number,
            default: 0
        },
        // Manteniamo il campo count per retrocompatibilità
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

// Metodo per verificare se l'utente ha raggiunto il limite giornaliero
whatsappInteractionSchema.methods.hasReachedDailyLimit = function(type, limit) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const todayInteraction = this.dailyInteractions.find(
        interaction => new Date(interaction.date).setHours(0, 0, 0, 0) === today.getTime()
    );
    
    if (!todayInteraction) {
        return false;
    }
    
    if (type === 'inbound') {
        return todayInteraction.inboundCount >= limit;
    } else if (type === 'outbound') {
        return todayInteraction.outboundCount >= limit;
    }
    
    return false;
};

// Metodo per incrementare il contatore dei messaggi giornalieri
whatsappInteractionSchema.methods.incrementDailyCounter = function(type) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Assicuriamoci che dailyInteractions esista
    if (!this.dailyInteractions) {
        this.dailyInteractions = [];
    }
    
    let todayInteraction = this.dailyInteractions.find(
        interaction => new Date(interaction.date).setHours(0, 0, 0, 0) === today.getTime()
    );
    
    if (!todayInteraction) {
        todayInteraction = {
            date: today,
            inboundCount: 0,
            outboundCount: 0,
            count: 0  // Per retrocompatibilità
        };
        this.dailyInteractions.push(todayInteraction);
    }
    
    const index = this.dailyInteractions.indexOf(todayInteraction);
    
    // Assicuriamoci che i contatori esistano prima di incrementarli
    if (!this.dailyInteractions[index].inboundCount) {
        this.dailyInteractions[index].inboundCount = 0;
    }
    
    if (!this.dailyInteractions[index].outboundCount) {
        this.dailyInteractions[index].outboundCount = 0;
    }
    
    if (!this.dailyInteractions[index].count) {
        this.dailyInteractions[index].count = 0;
    }
    
    if (type === 'inbound') {
        this.dailyInteractions[index].inboundCount += 1;
    } else if (type === 'outbound') {
        this.dailyInteractions[index].outboundCount += 1;
    }
    
    // Aggiorna anche il contatore totale per retrocompatibilità
    this.dailyInteractions[index].count += 1;
    
    return this.dailyInteractions[index];
};

module.exports = mongoose.model('WhatsappInteraction', whatsappInteractionSchema); 