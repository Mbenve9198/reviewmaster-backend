const mongoose = require('mongoose');

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

userSchema.methods.hasFreeScrapingCredits = function() {
    return this.wallet.freeScrapingUsed < 1000;
};

userSchema.methods.incrementFreeScrapingUsed = function() {
    if (this.wallet.freeScrapingUsed < 1000) {
        this.wallet.freeScrapingUsed += 1;
        return true;
    }
    return false;
};

const User = mongoose.model('User', userSchema);

module.exports = User;