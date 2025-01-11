const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true
    },
    integrationId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Integration'
    },
    platform: {
        type: String,
        enum: ['booking', 'tripadvisor', 'google', 'expedia', 'manual'],
        required: true
    },
    externalReviewId: {
        type: String,
        sparse: true
    },
    content: {
        text: {
            type: String,
            required: true
        },
        rating: {
            type: Number,
            required: true,
            validate: {
                validator: function(rating) {
                    const maxRatings = {
                        'google': 5,
                        'tripadvisor': 5,
                        'booking': 10,
                        'manual': 5
                    };
                    return rating >= 1 && rating <= maxRatings[this.platform];
                },
                message: props => `Rating must be between 1 and max rating for the platform!`
            }
        },
        reviewerName: {
            type: String,
            default: 'Guest'
        },
        reviewerImage: String,
        language: String,
        images: [{
            url: String,
            caption: String
        }],
        likes: Number,
        originalUrl: String
    },
    response: {
        text: String,
        createdAt: Date,
        settings: {
            style: {
                type: String,
                enum: ['professional', 'friendly'],
                default: 'professional'
            },
            length: {
                type: String,
                enum: ['short', 'medium', 'long'],
                default: 'medium'
            }
        },
        externalResponseId: String,
        synced: {
            type: Boolean,
            default: false
        },
        error: {
            message: String,
            code: String,
            timestamp: Date
        }
    },
    metadata: {
        originalCreatedAt: Date,
        lastUpdated: Date,
        syncedAt: Date
    }
}, {
    timestamps: true,
    indexes: [
        { hotelId: 1, platform: 1 },
        { externalReviewId: 1 },
        { 'metadata.originalCreatedAt': -1 }
    ]
});

// Middleware per aggiornare le statistiche dell'integrazione
reviewSchema.post('save', async function(doc) {
    if (doc.integrationId) {
        const Integration = mongoose.model('Integration');
        await Integration.findByIdAndUpdate(
            doc.integrationId,
            { $inc: { 'stats.totalReviews': 1 } }
        );
    }
});

module.exports = mongoose.model('Review', reviewSchema);