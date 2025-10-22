const mongoose = require('mongoose');

const deviceCommandSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  command: {
    type: String,
    required: true
  },
  plantId: {
    type: String,
    default: null
  },
  parameters: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  status: {
    type: String,
    enum: ['pending', 'executed', 'failed', 'completed'],
    default: 'pending'
  },
  executed: {
    type: Boolean,
    default: false
  },
  processed: {
    type: Boolean,
    default: false
  },
  response: {
    type: mongoose.Schema.Types.Mixed,
    default: null
  },
  error: {
    type: String,
    default: null
  },
  executedAt: {
    type: Date
  },
  processedAt: {
    type: Date
  },
  failedAt: {
    type: Date
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for efficient queries
deviceCommandSchema.index({ deviceId: 1, status: 1, executed: 1 });
deviceCommandSchema.index({ deviceId: 1, timestamp: -1 });
deviceCommandSchema.index({ status: 1, timestamp: -1 });

module.exports = mongoose.model('DeviceCommand', deviceCommandSchema);