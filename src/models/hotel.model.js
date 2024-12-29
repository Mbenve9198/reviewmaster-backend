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
    managerName: {
        type: String,
        required: true
    },
    signature: {
        type: String,
        required: true
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
});

module.exports = mongoose.model('Hotel', hotelSchema);