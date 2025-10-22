const mongoose = require('mongoose');

const logSchema = new mongoose.Schema({
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
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  eventType: {
    type: String,
    enum: ['sensor_reading', 'irrigation_start', 'irrigation_stop', 'device_connected', 'device_disconnected', 'command_executed', 'error', 'maintenance'],
    required: true
  },
  moistureLevel: {
    type: Number,
    min: 0,
    max: 100
  },
  temperature: {
    type: Number
  },
  actionTaken: {
    type: String,
    enum: ['watering_started', 'watering_stopped', 'threshold_adjusted', 'mode_changed', 'device_registered', 'device_removed', 'command_sent', 'error_occurred']
  },
  details: {
    type: mongoose.Schema.Types.Mixed // Flexible object for additional data
  },
  severity: {
    type: String,
    enum: ['info', 'warning', 'error', 'critical'],
    default: 'info'
  },
  source: {
    type: String,
    enum: ['mqtt', 'api', 'system', 'user'],
    default: 'system'
  }
}, {
  timestamps: true
});

// Indexes for performance
logSchema.index({ deviceId: 1, timestamp: -1 });
logSchema.index({ userId: 1, timestamp: -1 });
logSchema.index({ eventType: 1, timestamp: -1 });
logSchema.index({ timestamp: -1 });

// Static method to get logs for a device with time filtering
logSchema.statics.getDeviceLogs = function(deviceId, startDate, endDate, limit = 100) {
  const query = { deviceId };

  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = startDate;
    if (endDate) query.timestamp.$lte = endDate;
  }

  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit);
};

// Static method to get logs for user
logSchema.statics.getUserLogs = function(userId, startDate, endDate, limit = 100) {
  const query = { userId };

  if (startDate || endDate) {
    query.timestamp = {};
    if (startDate) query.timestamp.$gte = startDate;
    if (endDate) query.timestamp.$lte = endDate;
  }

  return this.find(query)
    .sort({ timestamp: -1 })
    .limit(limit);
};

// Static method to log sensor data
logSchema.statics.logSensorData = function(deviceId, userId, sensorData) {
  return this.create({
    deviceId,
    userId,
    eventType: 'sensor_reading',
    moistureLevel: sensorData.moisturePercent,
    temperature: sensorData.temperature,
    details: sensorData,
    source: 'mqtt'
  });
};

// Static method to log irrigation events
logSchema.statics.logIrrigationEvent = function(deviceId, userId, action, details = {}) {
  const eventType = action.includes('start') ? 'irrigation_start' : 'irrigation_stop';
  const actionTaken = action.includes('start') ? 'watering_started' : 'watering_stopped';

  return this.create({
    deviceId,
    userId,
    eventType,
    actionTaken,
    details,
    source: 'system'
  });
};

// Static method to log device events
logSchema.statics.logDeviceEvent = function(deviceId, userId, eventType, details = {}) {
  return this.create({
    deviceId,
    userId,
    eventType,
    details,
    source: 'mqtt'
  });
};

module.exports = mongoose.model('Log', logSchema);