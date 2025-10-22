const mongoose = require('mongoose');

const irrigationStatusSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  moistureLevel: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },
  irrigationStatus: {
    type: String,
    enum: ['automatic', 'manual', 'scheduled'],
    default: 'automatic'
  },
  pumpStatus: {
    type: String,
    enum: ['on', 'off'],
    default: 'off'
  },
  lastIrrigationTime: {
    type: Date,
    default: null
  },
  wateringMode: {
    type: String,
    enum: ['automatic', 'scheduled', 'manual'],
    default: 'automatic'
  },
  thresholds: {
    dryThreshold: {
      type: Number,
      default: 1700,
      min: 0,
      max: 4095
    },
    wetThreshold: {
      type: Number,
      default: 4000,
      min: 0,
      max: 4095
    }
  },
  isWateringEnabled: {
    type: Boolean,
    default: true
  },
  lastCommand: {
    type: String,
    default: null
  },
  commandTimestamp: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Indexes for performance
irrigationStatusSchema.index({ deviceId: 1, createdAt: -1 });
irrigationStatusSchema.index({ deviceId: 1, pumpStatus: 1 });

// Static method to get latest status for a device
irrigationStatusSchema.statics.getLatestStatus = function(deviceId) {
  return this.findOne({ deviceId }).sort({ createdAt: -1 });
};

// Static method to update irrigation status
irrigationStatusSchema.statics.updateIrrigationStatus = function(deviceId, updates) {
  return this.findOneAndUpdate(
    { deviceId },
    {
      ...updates,
      lastIrrigationTime: updates.pumpStatus === 'on' ? new Date() : undefined
    },
    { upsert: true, new: true }
  );
};

module.exports = mongoose.model('IrrigationStatus', irrigationStatusSchema);