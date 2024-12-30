const mongoose = require('mongoose');

const hotelSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    type: {
        type: String,
        enum: ['hotel', 'b&b', 'resort', 'apartment'],
        required: true
    },
    description: {
        type: String,
        required: true
    },
    // Manteniamo temporaneamente entrambi i campi
    managerSignature: {
        type: String,
        required: true
    },
    managerName: {
        type: String,
        required: true,
        default: function() {
            return this.managerSignature; // Usa managerSignature come default
        }
    },
    signature: {
        type: String,
        required: true,
        default: function() {
            return this.managerSignature; // Usa managerSignature come default
        }
    },
    responseSettings: {
        style: {
            type: String,
            enum: ['professional', 'friendly', 'formal'],
            default: 'professional'
        },
        length: {
            type: String,
            enum: ['short', 'medium', 'long'],
            default: 'medium'
        }
    }
}, {
    timestamps: true
});

module.exports = mongoose.model('Hotel', hotelSchema);
