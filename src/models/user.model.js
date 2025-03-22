const mongoose = require('mongoose');
const AppSettings = require('./app-settings.model');

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
    phoneNumber: {
        type: String,
        trim: true
    },
    companyName: {
        type: String,
        trim: true
    },
    wallet: {
        credits: {
            type: Number,
            default: 30 // Trial credits
        },
        freeScrapingUsed: {
            type: Number,
            default: 0
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    isVerified: {
        type: Boolean,
        default: false
    },
    verificationToken: String,
    verificationTokenExpires: Date,
    stripeCustomerId: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date
});

userSchema.methods.hasFreeScrapingCredits = async function() {
    try {
        // Carica le impostazioni globali
        const settings = await AppSettings.getGlobalSettings();
        const initialFreeCredits = settings.credits?.initialFreeCredits || 50;
        
        return this.wallet.freeScrapingUsed < initialFreeCredits;
    } catch (error) {
        console.error('Error checking free credits:', error);
        // Fallback al valore predefinito in caso di errore
        return this.wallet.freeScrapingUsed < 50;
    }
};

userSchema.methods.incrementFreeScrapingUsed = async function() {
    try {
        // Carica le impostazioni globali
        const settings = await AppSettings.getGlobalSettings();
        const initialFreeCredits = settings.credits?.initialFreeCredits || 50;
        
        if (this.wallet.freeScrapingUsed < initialFreeCredits) {
            this.wallet.freeScrapingUsed += 1;
            return true;
        }
        return false;
    } catch (error) {
        console.error('Error incrementing free credits:', error);
        // Fallback al valore predefinito in caso di errore
        if (this.wallet.freeScrapingUsed < 50) {
            this.wallet.freeScrapingUsed += 1;
            return true;
        }
        return false;
    }
};

const User = mongoose.model('User', userSchema);

module.exports = User;