const mongoose = require('mongoose');

const plantSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  name: {
    type: String,
    required: true
  },
  plantType: {
    type: String,
    required: true
  },
  location: {
    type: String,
    default: ''
  },
  description: {
    type: String,
    default: ''
  },
  wateringType: {
    type: String,
    enum: ['manual', 'automatic', 'scheduled'],
    default: 'manual'
  },
  isWateringEnabled: {
    type: Boolean,
    default: true
  },
  moistureThresholds: {
    min: { type: Number, default: 30 },
    max: { type: Number, default: 70 }
  },
  schedules: [{
    type: String
  }],
  currentMoisturePercent: {
    type: Number,
    default: 0
  },
  lastWatered: {
    type: Date,
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt field before saving
plantSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('Plant', plantSchema);