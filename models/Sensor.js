const mongoose = require('mongoose');

const sensorSchema = new mongoose.Schema({
  // User ID - CRITICAL for data ownership and multi-user support
  userID: {
    type: String,
    required: true,
    index: true
  },
  
  deviceId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  
  // Zone 1 Sensor Data
  zone1: {
    rawADC: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    },
    moisturePercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    status: {
      type: String,
      enum: ['WET', 'DRY', 'ERROR'],
      default: 'DRY'
    },
    vote: {
      type: String,
      enum: ['WATER', 'NO_WATER', 'ERROR'],
      default: 'WATER'
    },
    isValid: {
      type: Boolean,
      default: true
    }
  },

  // Zone 2 Sensor Data
  zone2: {
    rawADC: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    },
    moisturePercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    status: {
      type: String,
      enum: ['WET', 'DRY', 'ERROR'],
      default: 'DRY'
    },
    vote: {
      type: String,
      enum: ['WATER', 'NO_WATER', 'ERROR'],
      default: 'WATER'
    },
    isValid: {
      type: Boolean,
      default: true
    }
  },

  // Zone 3 Sensor Data
  zone3: {
    rawADC: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    },
    moisturePercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    status: {
      type: String,
      enum: ['WET', 'DRY', 'ERROR'],
      default: 'DRY'
    },
    vote: {
      type: String,
      enum: ['WATER', 'NO_WATER', 'ERROR'],
      default: 'WATER'
    },
    isValid: {
      type: Boolean,
      default: true
    }
  },

  // Voting System Results
  votingResults: {
    dryVotes: {
      type: Number,
      min: 0,
      max: 3,
      default: 0
    },
    wetVotes: {
      type: Number,
      min: 0,
      max: 3,
      default: 0
    },
    majorityVoteDry: {
      type: Boolean,
      default: false
    },
    validSensors: {
      type: Number,
      min: 0,
      max: 3,
      default: 0
    },
    medianADC: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    }
  },

  // Overall sensor health
  sensorHealth: {
    type: String,
    enum: ['normal', 'warning', 'error'],
    default: 'normal'
  },

  // Device status
  pumpState: {
    type: Number,
    enum: [0, 1],
    default: 0
  },

  // WiFi signal strength
  rssi: {
    type: Number,
    default: 0
  },

  // ESP32 internal timestamp (milliseconds since boot)
  deviceTimestamp: {
    type: Number,
    default: 0
  },

  // Legacy fields (kept for backward compatibility)
  moistureLevel: {
    type: Number,
    min: 0,
    max: 100,
    default: 0
  },
  batteryLevel: {
    type: Number,
    min: 0,
    max: 100,
    default: 100
  },
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  location: {
    name: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  isActive: {
    type: Boolean,
    default: true
  }
});

// Indexes for performance and multi-user support
// CRITICAL: Index by userID for efficient user queries
sensorSchema.index({ userID: 1, deviceId: 1 }); // User's specific device
sensorSchema.index({ userID: 1, lastUpdated: -1 }); // All user's devices sorted by update time
sensorSchema.index({ deviceId: 1, lastUpdated: -1 }); // Single device history

module.exports = mongoose.model('Sensor', sensorSchema);