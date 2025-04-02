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
    try {
        if (!this.dailyInteractions || !Array.isArray(this.dailyInteractions)) {
            return false; // Se non ci sono interazioni, non abbiamo raggiunto il limite
        }
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Cerca l'interazione di oggi in modo sicuro
        let todayInteraction = null;
        
        for (let i = 0; i < this.dailyInteractions.length; i++) {
            const interaction = this.dailyInteractions[i];
            if (interaction && interaction.date) {
                const interactionDate = new Date(interaction.date);
                interactionDate.setHours(0, 0, 0, 0);
                
                if (interactionDate.getTime() === today.getTime()) {
                    todayInteraction = interaction;
                    break;
                }
            }
        }
        
        if (!todayInteraction) {
            return false;
        }
        
        if (type === 'inbound') {
            return (todayInteraction.inboundCount || 0) >= limit;
        } else if (type === 'outbound') {
            return (todayInteraction.outboundCount || 0) >= limit;
        }
        
        return false;
    } catch (error) {
        console.error('Error in hasReachedDailyLimit:', error);
        return false; // In caso di errore, meglio non bloccare l'utente
    }
};

// Metodo per incrementare il contatore dei messaggi giornalieri
whatsappInteractionSchema.methods.incrementDailyCounter = function(type) {
    try {
        // Inizializza l'array se non esiste
        if (!this.dailyInteractions || !Array.isArray(this.dailyInteractions)) {
            this.dailyInteractions = [];
        }
        
        // Preparazione data di oggi
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        // Cerca l'interazione di oggi in modo sicuro
        let todayInteractionIndex = -1;
        
        for (let i = 0; i < this.dailyInteractions.length; i++) {
            const interaction = this.dailyInteractions[i];
            if (interaction && interaction.date) {
                const interactionDate = new Date(interaction.date);
                interactionDate.setHours(0, 0, 0, 0);
                
                if (interactionDate.getTime() === today.getTime()) {
                    todayInteractionIndex = i;
                    break;
                }
            }
        }
        
        // Se non esiste, crea una nuova interazione per oggi
        if (todayInteractionIndex === -1) {
            const newInteraction = {
                date: today,
                inboundCount: 0,
                outboundCount: 0,
                count: 0
            };
            
            this.dailyInteractions.push(newInteraction);
            todayInteractionIndex = this.dailyInteractions.length - 1;
        }
        
        // Assicurati che l'oggetto e i contatori siano inizializzati
        if (!this.dailyInteractions[todayInteractionIndex]) {
            this.dailyInteractions[todayInteractionIndex] = {
                date: today,
                inboundCount: 0,
                outboundCount: 0,
                count: 0
            };
        }
        
        if (typeof this.dailyInteractions[todayInteractionIndex].inboundCount !== 'number') {
            this.dailyInteractions[todayInteractionIndex].inboundCount = 0;
        }
        
        if (typeof this.dailyInteractions[todayInteractionIndex].outboundCount !== 'number') {
            this.dailyInteractions[todayInteractionIndex].outboundCount = 0;
        }
        
        if (typeof this.dailyInteractions[todayInteractionIndex].count !== 'number') {
            this.dailyInteractions[todayInteractionIndex].count = 0;
        }
        
        // Incrementa i contatori appropriati
        if (type === 'inbound') {
            this.dailyInteractions[todayInteractionIndex].inboundCount += 1;
        } else if (type === 'outbound') {
            this.dailyInteractions[todayInteractionIndex].outboundCount += 1;
        }
        
        // Aggiorna il contatore totale per retrocompatibilità
        this.dailyInteractions[todayInteractionIndex].count += 1;
        
        // Verifica finale e log per debug
        console.log('Daily interaction after increment:', JSON.stringify({
            index: todayInteractionIndex,
            date: this.dailyInteractions[todayInteractionIndex].date,
            inboundCount: this.dailyInteractions[todayInteractionIndex].inboundCount,
            outboundCount: this.dailyInteractions[todayInteractionIndex].outboundCount,
            count: this.dailyInteractions[todayInteractionIndex].count
        }));
        
        return this.dailyInteractions[todayInteractionIndex];
    } catch (error) {
        // Gestione errori
        console.error('Error in incrementDailyCounter:', error);
        
        // Fallback: crea un nuovo contatore
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const fallbackCounter = {
            date: today,
            inboundCount: type === 'inbound' ? 1 : 0,
            outboundCount: type === 'outbound' ? 1 : 0,
            count: 1
        };
        
        // Se possibile, aggiungi all'array
        if (Array.isArray(this.dailyInteractions)) {
            this.dailyInteractions.push(fallbackCounter);
        } else {
            this.dailyInteractions = [fallbackCounter];
        }
        
        return fallbackCounter;
    }
};

module.exports = mongoose.model('WhatsappInteraction', whatsappInteractionSchema); 