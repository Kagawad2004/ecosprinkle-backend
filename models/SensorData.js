const mongoose = require('mongoose');

/**
 * SensorData Schema - Historical Time-Series Data
 * 
 * Purpose: Store EVERY sensor reading from ESP32 for historical analysis
 * - Append-only (never updated, only inserted)
 * - Used for charts, trends, analytics
 * - Matches ESP32 MQTT payload exactly
 * 
 * Use Cases:
 * - Show moisture trends over 7 days
 * - Generate watering history charts
 * - Analyze sensor performance patterns
 * - Calculate average moisture levels
 */
const sensorDataSchema = new mongoose.Schema({
  // User ID - CRITICAL for data ownership and multi-user support
  userID: {
    type: String,
    required: true,
    index: true
  },
  
  deviceId: {
    type: String,
    required: true,
    index: true
  },
  
  // Server timestamp (when backend received this data)
  timestamp: {
    type: Date,
    default: Date.now,
    index: true
  },
  
  // ESP32 internal timestamp (milliseconds since boot)
  deviceTimestamp: {
    type: Number,
    required: true
  },

  // Zone 1 Raw ADC and Percentage (0-4095 ADC, 0-100%)
  zone1: {
    type: Number,
    min: 0,
    max: 4095,
    required: true
  },
  zone1Percent: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },

  // Zone 2 Raw ADC and Percentage
  zone2: {
    type: Number,
    min: 0,
    max: 4095,
    required: true
  },
  zone2Percent: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },

  // Zone 3 Raw ADC and Percentage
  zone3: {
    type: Number,
    min: 0,
    max: 4095,
    required: true
  },
  zone3Percent: {
    type: Number,
    min: 0,
    max: 100,
    required: true
  },

  // Voting System Results (ESP32 algorithm)
  dryVotes: {
    type: Number,
    min: 0,
    max: 3,
    required: true
  },
  wetVotes: {
    type: Number,
    min: 0,
    max: 3,
    required: true
  },
  majorityVoteDry: {
    type: Boolean,
    required: true
  },
  validSensors: {
    type: Number,
    min: 0,
    max: 3,
    required: true
  },

  // Sensor Health and Median
  sensorHealth: {
    type: String,
    enum: ['normal', 'warning', 'error', 'degraded'],
    required: true
  },
  median: {
    type: Number,
    min: 0,
    max: 4095,
    required: true
  },

  // Pump and WiFi Status
  pumpState: {
    type: Number,
    enum: [0, 1],
    required: true
  },
  rssi: {
    type: Number,
    required: true
  }
});

// Compound indexes for efficient time-series queries
// CRITICAL: Index by userID first for multi-user support
sensorDataSchema.index({ userID: 1, deviceId: 1, timestamp: -1 }); // User's device history
sensorDataSchema.index({ userID: 1, timestamp: -1 }); // All user's devices
sensorDataSchema.index({ deviceId: 1, timestamp: -1 }); // Single device history (covers both deviceId and timestamp queries)
sensorDataSchema.index({ timestamp: -1 }); // Time-based queries across all devices

// TTL index - automatically delete records older than 90 days (optional)
// Uncomment if you want automatic cleanup of old data:
// sensorDataSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

module.exports = mongoose.model('SensorData', sensorDataSchema);