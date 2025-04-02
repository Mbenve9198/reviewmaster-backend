const mongoose = require('mongoose');
const _ = require('lodash');

// Schema per le regole di risposta
const responseRuleSchema = new mongoose.Schema({
    question: {
        type: String,
        required: true,
        default: function() {
            // Usa il topic come valore predefinito per question se non specificato
            return this.topic || '';
        }
    },
    response: {
        type: String,
        required: true
    },
    keywords: [String],
    isActive: {
        type: Boolean,
        default: true
    },
    topic: {
        type: String,
        required: true
    },
    isCustom: {
        type: Boolean,
        default: false
    },
    customTopic: {
        type: String
    }
}, { _id: true, timestamps: true });

// Aggiungi un middleware pre-validate per garantire che question abbia sempre un valore
responseRuleSchema.pre('validate', function(next) {
    if (!this.question && this.topic) {
        this.question = this.topic;
    }
    next();
});

// Schema principale per l'assistente WhatsApp
const whatsappAssistantSchema = new mongoose.Schema({
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true,
        unique: true
    },
    // Imposta il fuso orario dell'hotel (utile per messaggi programmati)
    timezone: {
        type: String,
        default: 'Europe/Rome'
    },
    // Limiti giornalieri di messaggi per cliente
    messageLimits: {
        inboundPerDay: {
            type: Number,
            default: 5,
            min: 5,  // Minimo 5 messaggi in ingresso al giorno
            validate: {
                validator: function(v) {
                    return v >= 5;
                },
                message: props => `Il limite minimo per i messaggi in ingresso è 5, hai impostato ${props.value}`
            }
        },
        outboundPerDay: {
            type: Number,
            default: 5,
            min: 5,  // Minimo 5 messaggi in uscita al giorno
            validate: {
                validator: function(v) {
                    return v >= 5;
                },
                message: props => `Il limite minimo per i messaggi in uscita è 5, hai impostato ${props.value}`
            }
        },
        enabled: {
            type: Boolean,
            default: true
        }
    },
    // Informazioni sull'hotel
    breakfast: {
        type: mongoose.Schema.Types.Mixed,
        default: {
            startTime: "07:00",
            endTime: "10:30"
        }
    },
    checkIn: {
        type: mongoose.Schema.Types.Mixed,
        default: {
            startTime: "14:00",
            endTime: "22:00"
        }
    },
    // Impostazioni per le recensioni
    reviewLink: {
        type: String,
        default: null
    },
    reviewRequestDelay: {
        type: Number,
        default: 12 // ore dopo il checkout
    },
    // Nome che attiva le risposte alle domande
    triggerName: {
        type: String,
        default: 'Hotel Assistant'
    },
    // Stato attivo/inattivo
    isActive: {
        type: Boolean,
        default: true
    },
    // Regole di risposta
    rules: [responseRuleSchema]
}, { timestamps: true });

// Trova regole che corrispondono a una query
whatsappAssistantSchema.methods.findMatchingRules = function(query) {
    if (!query || !this.rules || this.rules.length === 0) {
        return [];
    }
    
    // Normalizza la query per il confronto
    const normalizedQuery = query.toLowerCase().trim();
    
    // Verifica se la domanda contiene le parole chiave o è simile alle domande nelle regole
    const matchingRules = this.rules.filter(rule => {
        // Ignora le regole non attive
        if (!rule.isActive) return false;
        
        // Controlla se la query corrisponde esattamente alla domanda della regola
        if (rule.question.toLowerCase().trim() === normalizedQuery) {
            return true;
        }
        
        // Controlla se la query contiene le parole chiave della regola
        if (rule.keywords && rule.keywords.length > 0) {
            const matchesKeywords = rule.keywords.some(keyword => 
                normalizedQuery.includes(keyword.toLowerCase().trim())
            );
            if (matchesKeywords) return true;
        }
        
        // Implementa un controllo base di similarità
        const questionWords = rule.question.toLowerCase().split(/\s+/);
        const queryWords = normalizedQuery.split(/\s+/);
        const matchingWords = _.intersection(questionWords, queryWords);
        
        // Se almeno il 60% delle parole corrisponde, considera una corrispondenza
        const matchPercentage = matchingWords.length / questionWords.length;
        return matchPercentage >= 0.6;
    });
    
    return matchingRules;
};

module.exports = mongoose.model('WhatsAppAssistant', whatsappAssistantSchema); 