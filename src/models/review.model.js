const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true
    },
    platform: {
        type: String,
        enum: ['booking', 'tripadvisor', 'google', 'expedia', 'manual'],
        required: true,
        default: 'manual'
    },
    content: {
        text: {
            type: String,
            required: true
        },
        rating: {
            type: Number,
            required: true,
            min: 1,
            max: 5,
            default: 5
        },
        reviewerName: {
            type: String,
            default: 'Guest'
        },
        language: String
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
        }
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Review', reviewSchema);