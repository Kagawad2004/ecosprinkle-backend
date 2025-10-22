const mongoose = require('mongoose');

const notificationSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  userId: {
    type: String,
    required: true,
    index: true
  },
  type: {
    type: String,
    required: true,
    enum: ['watering_started', 'watering_completed', 'low_moisture', 'device_offline', 'device_online', 'battery_low', 'maintenance_required', 'error']
  },
  title: {
    type: String,
    required: true
  },
  message: {
    type: String,
    required: true
  },
  severity: {
    type: String,
    enum: ['low', 'medium', 'high', 'critical'],
    default: 'medium'
  },
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  read: {
    type: Boolean,
    default: false
  },
  readAt: {
    type: Date
  },
  data: {
    type: Map,
    of: mongoose.Schema.Types.Mixed,
    default: {}
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// Indexes for efficient queries
notificationSchema.index({ userId: 1, read: 1, timestamp: -1 });
notificationSchema.index({ deviceId: 1, timestamp: -1 });

module.exports = mongoose.model('Notification', notificationSchema);