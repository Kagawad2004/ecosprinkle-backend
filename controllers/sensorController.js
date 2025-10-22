const Sensor = require('../models/Sensor');
const IrrigationSchedule = require('../models/IrrigationSchedule');

// Get sensor data
exports.getSensorData = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const sensor = await Sensor.findOne({ deviceId });
    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found' });
    }
    res.json(sensor);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update sensor data (from ESP32)
exports.updateSensorData = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { moistureLevel, batteryLevel } = req.body;
    
    const sensor = await Sensor.findOneAndUpdate(
      { deviceId },
      { 
        moistureLevel,
        batteryLevel,
        lastUpdated: new Date()
      },
      { new: true, upsert: true }
    );
    
    // Emit updated data through Socket.IO
    req.app.get('io').emit(`sensor-update:${deviceId}`, sensor);
    
    res.json(sensor);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get irrigation schedule
exports.getSchedule = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const schedule = await IrrigationSchedule.findOne({ deviceId });
    if (!schedule) {
      return res.status(404).json({ message: 'Schedule not found' });
    }
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update irrigation schedule
exports.updateSchedule = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { schedules, isAutomatic } = req.body;
    
    const schedule = await IrrigationSchedule.findOneAndUpdate(
      { deviceId },
      { 
        schedules,
        isAutomatic,
        lastModified: new Date()
      },
      { new: true, upsert: true }
    );
    
    // Emit schedule update through Socket.IO
    req.app.get('io').emit(`schedule-update:${deviceId}`, schedule);
    
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Manual irrigation control
exports.manualControl = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { action } = req.body; // 'start' or 'stop'
    
    // Update the sensor status
    const sensor = await Sensor.findOneAndUpdate(
      { deviceId },
      { isActive: action === 'start' },
      { new: true }
    );
    
    if (!sensor) {
      return res.status(404).json({ message: 'Sensor not found' });
    }
    
    // Emit control action through Socket.IO
    req.app.get('io').emit(`control-action:${deviceId}`, { action });
    
    res.json({ message: `Irrigation ${action}ed successfully` });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};