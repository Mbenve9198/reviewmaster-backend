const mongoose = require('mongoose');

const analysisSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true
  },
  hotelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  analysis: {
    meta: {
      hotelName: String,
      reviewCount: Number,
      avgRating: Number,
      platforms: String
    },
    sentiment: {
      excellent: String,
      average: String,
      needsImprovement: String,
      distribution: {
        rating5: String,
        rating4: String,
        rating3: String,
        rating2: String,
        rating1: String
      }
    },
    strengths: [{
      title: String,
      impact: String,
      mentions: Number,
      quote: String,
      details: String,
      relatedReviews: [{
        reviewId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Review'
        },
        relevantText: String,
        rating: Number
      }],
      marketingTips: [{
        action: String,
        cost: String,
        roi: String
      }]
    }],
    issues: [{
      title: String,
      priority: String,
      impact: String,
      mentions: Number,
      quote: String,
      details: String,
      relatedReviews: [{
        reviewId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Review'
        },
        relevantText: String,
        rating: Number
      }],
      solution: {
        title: String,
        timeline: String,
        cost: String,
        roi: String,
        steps: [String]
      }
    }],
    quickWins: [{
      action: String,
      timeline: String,
      cost: String,
      impact: String
    }],
    trends: [{
      metric: String,
      change: String,
      period: String
    }]
  },
  followUpSuggestions: [String],
  reviewsAnalyzed: Number,
  provider: {
    type: String,
    enum: ['claude', 'gpt4', 'gemini'],
    required: true
  },
  metadata: {
    platforms: [String],
    dateRange: {
      start: Date,
      end: Date
    },
    creditsUsed: Number
  },
  reviewIds: [{
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Review'
  }]
}, {
  timestamps: true,
  indexes: [
    { hotelId: 1, createdAt: -1 },
    { userId: 1 },
    { 'metadata.platforms': 1 }
  ]
});

module.exports = mongoose.model('Analysis', analysisSchema); 