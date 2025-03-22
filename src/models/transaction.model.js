const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: ['purchase', 'usage', 'bonus'],
        required: true
    },
    // Crediti (positivo per acquisti/bonus, negativo per usage)
    credits: {
        type: Number,
        required: true
    },
    // Importo in EUR, presente solo per acquisti
    amount: {
        type: Number,
        required: function() {
            return this.type === 'purchase';
        }
    },
    description: {
        type: String,
        required: true
    },
    status: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'completed'
    },
    metadata: {
        // Dati Stripe per acquisti
        stripePaymentIntentId: String,
        pricePerCredit: Number,

        // Dati operativi per usage
        actionType: {
            type: String,
            enum: [
                'review_scraping',
                'review_response',
                'response_edit',
                'review_analysis',
                'analysis_followup',
                'trial_bonus',
                'referral_bonus',
                // Nuovi tipi per WhatsApp
                'whatsapp_inbound_message',
                'whatsapp_outbound_message',
                'whatsapp_scheduled_message',
                'whatsapp_auto_topup'
            ]
        },
        hotelId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Hotel'
        },
        reviewId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'Review'
        },
        // Per tenere traccia delle recensioni gratis
        freeScrapingUsed: {
            type: Boolean,
            default: false
        },
        // Campo per tracciare interazioni WhatsApp
        whatsappInteractionId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'WhatsappInteraction'
        }
    },
    createdAt: {
        type: Date,
        default: Date.now,
        index: true
    }
});

// Indici per performance
transactionSchema.index({ userId: 1, createdAt: -1 });
transactionSchema.index({ 'metadata.hotelId': 1, createdAt: -1 });
transactionSchema.index({ type: 1, createdAt: -1 });

// Virtual per il saldo dopo la transazione
transactionSchema.virtual('balanceAfter').get(function() {
    // Questo verrà popolato dal service layer quando necessario
    return this._balanceAfter;
});

// Method per formattare i dettagli della transazione
transactionSchema.methods.getFormattedDetails = function() {
    const details = {
        id: this._id,
        type: this.type,
        credits: this.credits,
        description: this.description,
        createdAt: this.createdAt
    };

    if (this.type === 'purchase') {
        details.amount = this.amount;
        details.pricePerCredit = this.metadata.pricePerCredit;
    }

    if (this.metadata.actionType) {
        details.actionType = this.metadata.actionType;
    }

    if (this._balanceAfter !== undefined) {
        details.balanceAfter = this._balanceAfter;
    }

    return details;
};

// Statics per queries comuni
transactionSchema.statics.getLatestTransactions = function(userId, limit = 10) {
    return this.find({ userId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .exec();
};

transactionSchema.statics.getUserBalance = async function(userId) {
    const result = await this.aggregate([
        { $match: { userId: mongoose.Types.ObjectId(userId) } },
        { $group: { _id: null, total: { $sum: "$credits" } } }
    ]);
    return result[0]?.total || 0;
};

const Transaction = mongoose.model('Transaction', transactionSchema);

module.exports = Transaction;