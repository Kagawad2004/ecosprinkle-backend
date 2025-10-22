const mongoose = require('mongoose');

const irrigationScheduleSchema = new mongoose.Schema({
  deviceId: {
    type: String,
    required: true
  },
  schedules: [{
    dayOfWeek: {
      type: Number,
      required: true,
      min: 0,
      max: 6
    },
    startTime: {
      type: String,
      required: true
    },
    duration: {
      type: Number,
      required: true,
      min: 1
    },
    moistureThreshold: {
      type: Number,
      required: true,
      min: 0,
      max: 100
    }
  }],
  isAutomatic: {
    type: Boolean,
    default: true
  },
  lastModified: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('IrrigationSchedule', irrigationScheduleSchema);