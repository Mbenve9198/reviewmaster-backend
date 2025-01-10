const mongoose = require('mongoose');

const integrationSchema = new mongoose.Schema({
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true
    },
    platform: {
        type: String,
        enum: ['google', 'tripadvisor', 'booking'],
        required: true
    },
    placeId: {
        type: String,
        required: true
    },
    url: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['active', 'error', 'disconnected', 'pending'],
        default: 'pending'
    },
    syncConfig: {
        type: {
            type: String,
            enum: ['manual', 'automatic'],
            default: 'manual'
        },
        frequency: {
            type: String,
            enum: ['daily', 'weekly', 'monthly'],
            default: 'weekly'
        },
        language: {
            type: String,
            default: 'en'
        },
        lastSync: Date,
        nextScheduledSync: Date,
        error: {
            message: String,
            code: String,
            timestamp: Date
        }
    },
    stats: {
        totalReviews: {
            type: Number,
            default: 0
        },
        syncedReviews: {
            type: Number,
            default: 0
        },
        lastSyncedReviewDate: Date
    },
    platformCredentials: {
        accessToken: String,
        refreshToken: String,
        expiresAt: Date
    }
}, {
    timestamps: true,
    indexes: [
        { hotelId: 1, platform: 1 },
        { status: 1 },
        { 'syncConfig.nextScheduledSync': 1 }
    ]
});

// Metodo per verificare se è necessaria una sincronizzazione
integrationSchema.methods.needsSync = function() {
    if (this.status !== 'active') return false;
    if (this.syncConfig.type === 'manual') return false;
    
    const now = new Date();
    return !this.syncConfig.nextScheduledSync || this.syncConfig.nextScheduledSync <= now;
};

// Metodo per aggiornare le statistiche dopo una sincronizzazione
integrationSchema.methods.updateSyncStats = async function(newReviews) {
    this.stats.syncedReviews += newReviews.length;
    this.syncConfig.lastSync = new Date();
    
    // Aggiorna la data della prossima sincronizzazione in base alla frequenza
    const nextSync = new Date();
    switch(this.syncConfig.frequency) {
        case 'daily':
            nextSync.setDate(nextSync.getDate() + 1);
            break;
        case 'weekly':
            nextSync.setDate(nextSync.getDate() + 7);
            break;
        case 'monthly':
            nextSync.setMonth(nextSync.getMonth() + 1);
            break;
    }
    
    this.syncConfig.nextScheduledSync = nextSync;
    
    if (newReviews.length > 0) {
        this.stats.lastSyncedReviewDate = new Date(
            Math.max(...newReviews.map(r => r.date))
        );
    }
    
    return this.save();
};

// Metodo per gestire gli errori di sincronizzazione
integrationSchema.methods.handleSyncError = async function(error) {
    this.status = 'error';
    this.syncConfig.error = {
        message: error.message,
        code: error.code,
        timestamp: new Date()
    };
    
    return this.save();
};

module.exports = mongoose.model('Integration', integrationSchema); 