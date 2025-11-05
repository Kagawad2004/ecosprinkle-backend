const mongoose = require('mongoose');

const deviceSchema = new mongoose.Schema({
  // Firebase-compatible fields
  userID: {
    type: String,
    required: true,
    index: true
  },
  QRcode: {
    type: String,
    required: true
  },
  deviceId: {
    type: String,
    required: true,
    unique: true
  },
  deviceType: {
    type: String,
    required: true,
    enum: ['sensor', 'pump', 'combined']
  },
  MACaddress: {
    type: String,
    required: true
  },
  securityKey: {
    type: String,
    required: true
  },
  WifiSSID: {
    type: String,
    required: true
  },
  DeviceName: {
    type: String,
    required: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  LastUpdated: {
    type: Date,
    default: Date.now
  },
  plantID: {
    type: String,
    default: null
  },
  Status: {
    type: String,
    default: 'Registered',
    enum: ['Registered', 'Online', 'Offline', 'Error']
  },
  createdAt: {
    type: Date,
    default: Date.now
  },

  // Additional fields for device functionality
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
  location: {
    name: String,
    coordinates: {
      latitude: Number,
      longitude: Number
    }
  },
  // Watering Control Mode
  wateringMode: {
    type: String,
    enum: ['auto', 'manual', 'schedule'],
    default: 'auto'
  },
  
  // Manual Mode State
  manualPumpState: {
    active: {
      type: Boolean,
      default: false
    },
    lastChangedAt: {
      type: Date
    },
    lastChangedBy: {
      type: String // userID
    }
  },

  // Schedule Mode Configuration
  schedules: [{
    timeSlotId: {
      type: String,
      required: true
    },
    time: {
      type: String,
      required: true,
      match: /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/ // HH:MM format
    },
    duration: {
      type: Number,
      required: true,
      min: 1,
      max: 120 // Max 2 hours per slot
    },
    daysOfWeek: {
      type: [Number],
      required: true,
      validate: {
        validator: function(arr) {
          return arr.every(day => day >= 0 && day <= 6);
        },
        message: 'Days must be 0-6 (Sun-Sat)'
      }
    },
    isActive: {
      type: Boolean,
      default: true
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Schedule Mode State
  scheduleMode: {
    isEnabled: {
      type: Boolean,
      default: false
    },
    isPaused: {
      type: Boolean,
      default: false
    },
    lastExecutedAt: {
      type: Date
    },
    nextScheduledAt: {
      type: Date
    },
    executionCount: {
      type: Number,
      default: 0
    }
  },
  // ============ FINAL DEFENSE REVISION: INDIVIDUAL SENSOR CALIBRATION ============
  // Zone-specific calibration data for enhanced accuracy
  sensorCalibrations: {
    zone1: {
      wetAdc: {
        type: Number,
        default: 1050, // Lettuce/Herbs calibration
        min: 0,
        max: 4095
      },
      dryAdc: {
        type: Number,
        default: 4095,
        min: 0,
        max: 4095
      },
      soilType: {
        type: String,
        default: 'Fine soil'
      },
      cropType: {
        type: String,
        default: 'Lettuce/Herbs'
      },
      dryThresholdPercent: {
        type: Number,
        default: 25, // Water when below 25% (leafy greens need consistent moisture)
        min: 0,
        max: 100
      },
      wetThresholdPercent: {
        type: Number,
        default: 85, // Stop when above 85%
        min: 0,
        max: 100
      }
    },
    zone2: {
      wetAdc: {
        type: Number,
        default: 1070, // Tomatoes calibration
        min: 0,
        max: 4095
      },
      dryAdc: {
        type: Number,
        default: 4095,
        min: 0,
        max: 4095
      },
      soilType: {
        type: String,
        default: 'Medium soil'
      },
      cropType: {
        type: String,
        default: 'Tomatoes'
      },
      dryThresholdPercent: {
        type: Number,
        default: 20, // Water when below 20% (tomatoes are drought tolerant)
        min: 0,
        max: 100
      },
      wetThresholdPercent: {
        type: Number,
        default: 80, // Stop when above 80%
        min: 0,
        max: 100
      }
    },
    zone3: {
      wetAdc: {
        type: Number,
        default: 1150, // Root vegetables calibration
        min: 0,
        max: 4095
      },
      dryAdc: {
        type: Number,
        default: 4095,
        min: 0,
        max: 4095
      },
      soilType: {
        type: String,
        default: 'Coarse soil'
      },
      cropType: {
        type: String,
        default: 'Root vegetables'
      },
      dryThresholdPercent: {
        type: Number,
        default: 15, // Water when below 15% (roots can handle drier conditions)
        min: 0,
        max: 100
      },
      wetThresholdPercent: {
        type: Number,
        default: 75, // Stop when above 75%
        min: 0,
        max: 100
      }
    }
  },

  // Legacy thresholds for backward compatibility
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
  lastSensorUpdate: {
    type: Date
  },
  // Plant and environment settings
  plantType: {
    type: String,
    default: 'Unknown'
  },
  soilType: {
    type: String,
    enum: ['Clay', 'Sandy', 'Loam', 'Loamy', 'Silt', 'Peat', 'Potting Mix', 'Unknown'],
    default: 'Unknown'
  },
  sunlightExposure: {
    type: String,
    enum: ['Full Sun', 'Partial Sun', 'Partial', 'Shade', 'Unknown'],
    default: 'Unknown'
  },
  growthStage: {
    type: String,
    enum: ['Seedling', 'Vegetative', 'Mature', 'Harvest', 'Unknown'],
    default: 'Seedling'
  },
  plantedDate: {
    type: Date,
    default: Date.now
  },

  // ESP32 MQTT Sensor Data - Real-time readings from device
  sensorData: {
    // Raw ADC readings (0-4095)
    zone1: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    },
    zone2: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    },
    zone3: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    },
    // Moisture percentages (0-100%)
    zone1Percent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    zone2Percent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    zone3Percent: {
      type: Number,
      min: 0,
      max: 100,
      default: 0
    },
    // Voting system results
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
    sensorHealth: {
      type: String,
      enum: ['normal', 'warning', 'error'],
      default: 'normal'
    },
    median: {
      type: Number,
      min: 0,
      max: 4095,
      default: 0
    },
    // Device status
    pumpState: {
      type: Number,
      enum: [0, 1],
      default: 0
    },
    rssi: {
      type: Number,
      default: 0
    },
    // ESP32 internal timestamp (milliseconds since boot)
    deviceTimestamp: {
      type: Number,
      default: 0
    },
    // Server timestamp when data was received
    receivedAt: {
      type: Date,
      default: Date.now
    }
  }
});

// Indexes for performance
deviceSchema.index({ userID: 1, deviceId: 1 });
deviceSchema.index({ LastUpdated: -1 });

module.exports = mongoose.model('Device', deviceSchema);