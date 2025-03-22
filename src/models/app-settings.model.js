const mongoose = require('mongoose');

const appSettingsSchema = new mongoose.Schema({
    // Identificatore univoco per questo documento di impostazioni
    key: {
        type: String,
        required: true,
        unique: true,
        default: 'global'
    },
    
    // Impostazioni dei crediti
    credits: {
        // Crediti gratuiti che ogni nuovo utente riceve all'iscrizione
        initialFreeCredits: {
            type: Number,
            default: 50
        },
        
        // Costi per operazione
        costs: {
            inboundMessage: {
                type: Number,
                default: 0.5
            },
            outboundMessage: {
                type: Number,
                default: 0.5
            },
            scheduledMessage: {
                type: Number,
                default: 1.0
            },
            reviewResponse: {
                type: Number,
                default: 2.0
            },
            reviewAnalysis: {
                type: Number,
                default: 1.0
            }
        }
    },
    
    // Data dell'ultima modifica
    updatedAt: {
        type: Date,
        default: Date.now
    }
});

// Metodo statico per ottenere le impostazioni globali
appSettingsSchema.statics.getGlobalSettings = async function() {
    let settings = await this.findOne({ key: 'global' });
    
    // Se non esistono impostazioni, crea il documento con i valori predefiniti
    if (!settings) {
        settings = await this.create({ key: 'global' });
    }
    
    return settings;
};

// Metodo per aggiornare le impostazioni
appSettingsSchema.statics.updateSettings = async function(updates) {
    return this.findOneAndUpdate(
        { key: 'global' },
        { 
            $set: updates,
            updatedAt: Date.now()
        },
        { 
            new: true,
            upsert: true,
            runValidators: true
        }
    );
};

const AppSettings = mongoose.model('AppSettings', appSettingsSchema);

// Assicuriamoci che esista un documento di impostazioni all'avvio dell'app
AppSettings.getGlobalSettings().catch(err => {
    console.error('Error initializing app settings:', err);
});

module.exports = AppSettings; 