const mongoose = require('mongoose');

const sentimentAnalysisSchema = new mongoose.Schema({
    hotelId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Hotel',
        required: true
    },
    positive: {
        type: Number,
        required: true
    },
    neutral: {
        type: Number,
        required: true
    },
    negative: {
        type: Number,
        required: true
    },
    summary: {
        type: String,
        required: true
    },
    createdAt: {
        type: Date,
        default: Date.now
    },
    // Periodo di tempo analizzato (opzionale per future implementazioni)
    timeRange: {
        from: Date,
        to: Date
    }
});

// Indice per ottimizzare le query per hotelId
sentimentAnalysisSchema.index({ hotelId: 1 });

module.exports = mongoose.model('SentimentAnalysis', sentimentAnalysisSchema); 