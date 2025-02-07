const mongoose = require('mongoose');

const ruleSchema = new mongoose.Schema({
  hotelId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Hotel',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  condition: {
    field: {
      type: String,
      enum: ['content.text', 'content.rating', 'content.language'],
      required: true
    },
    operator: {
      type: String,
      enum: ['contains', 'equals', 'greater_than', 'less_than'],
      required: true
    },
    value: {
      type: mongoose.Schema.Types.Mixed,
      required: true
    }
  },
  response: {
    text: {
      type: String,
      required: true
    },
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
  isActive: {
    type: Boolean,
    default: true
  },
  priority: {
    type: Number,
    default: 0
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('Rule', ruleSchema); 