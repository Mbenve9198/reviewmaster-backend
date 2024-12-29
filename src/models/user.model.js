const mongoose = require('mongoose');

const SUBSCRIPTION_LIMITS = {
    trial: {
        responsesLimit: 10,
        hotelsLimit: 1
    },
    host: {
        responsesLimit: 50,
        hotelsLimit: 2
    },
    manager: {
        responsesLimit: 200,
        hotelsLimit: 5
    },
    director: {
        responsesLimit: 500,
        hotelsLimit: 10
    }
};

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: true
    },
    name: {
        type: String,
        required: true
    },
    subscription: {
        plan: {
            type: String,
            enum: ['trial', 'host', 'manager', 'director'],
            default: 'trial'
        },
        status: {
            type: String,
            enum: ['active', 'inactive', 'cancelled'],
            default: 'active'
        },
        responseCredits: {
            type: Number,
            default: 10
        },
        trialEndsAt: {
            type: Date,
            default: () => new Date(+new Date() + 14 * 24 * 60 * 60 * 1000) // 14 days from now
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

// Metodo virtuale per ottenere i limiti del piano
userSchema.virtual('subscriptionLimits').get(function() {
    return SUBSCRIPTION_LIMITS[this.subscription.plan];
});

// Assicurati che i virtual siano inclusi quando converti in JSON
userSchema.set('toJSON', { virtuals: true });
userSchema.set('toObject', { virtuals: true });

module.exports = mongoose.model('User', userSchema);