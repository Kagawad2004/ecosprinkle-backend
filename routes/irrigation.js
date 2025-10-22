const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const IrrigationStatus = require('../models/IrrigationStatus');
const authMiddleware = require('../middleware/auth');
const { validateIrrigationControl, validateDeviceId, sanitizeInput } = require('../middleware/validation');

// Apply input sanitization to all routes
router.use(sanitizeInput);

// GET /api/irrigation/:deviceId/status - Get current irrigation status (from MQTT data)
router.get('/:deviceId/status', authMiddleware, validateDeviceId, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;

    // Verify device ownership
    const device = await Device.findOne({ deviceId, userID: userId });
    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    // Get latest irrigation status
    const irrigationStatus = await IrrigationStatus.getLatestStatus(deviceId);

    // If no irrigation status exists, create a default one
    const status = irrigationStatus || {
      deviceId,
      moistureLevel: device.moistureLevel || 0,
      irrigationStatus: device.wateringMode || 'auto',
      pumpStatus: 'off',
      wateringMode: device.wateringMode || 'auto',
      thresholds: device.thresholds || { dryThreshold: 1700, wetThreshold: 4000 },
      isWateringEnabled: device.isWateringEnabled !== false,
      lastIrrigationTime: null
    };

    res.json({
      success: true,
      status: {
        deviceId,
        moistureLevel: status.moistureLevel,
        irrigationStatus: status.irrigationStatus,
        pumpStatus: status.pumpStatus,
        wateringMode: status.wateringMode,
        thresholds: status.thresholds,
        isWateringEnabled: status.isWateringEnabled,
        lastIrrigationTime: status.lastIrrigationTime,
        deviceStatus: device.Status,
        batteryLevel: device.batteryLevel,
        lastSensorUpdate: device.lastSensorUpdate,
        lastUpdated: device.LastUpdated
      }
    });
  } catch (error) {
    console.error('Get irrigation status error:', error);
    res.status(500).json({
      error: 'Failed to retrieve irrigation status',
      details: 'Unable to fetch irrigation status. Please try again.'
    });
  }
});

// POST /api/irrigation/:deviceId/control - Update irrigation mode/pump status (publish to MQTT)
router.post('/:deviceId/control', authMiddleware, validateDeviceId, validateIrrigationControl, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const { irrigationMode, pumpStatus, thresholds, isWateringEnabled } = req.body;

    // Verify device ownership
    const device = await Device.findOne({ deviceId, userID: userId });
    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    // Prepare updates
    const updates = {};
    const deviceUpdates = {};

    if (irrigationMode) {
      updates.irrigationStatus = irrigationMode;
      updates.wateringMode = irrigationMode;
      deviceUpdates.wateringMode = irrigationMode;
    }

    if (pumpStatus) {
      updates.pumpStatus = pumpStatus;
      updates.lastCommand = pumpStatus === 'on' ? 'pump_on' : 'pump_off';
      updates.commandTimestamp = new Date();
      deviceUpdates.LastUpdated = new Date();
    }

    if (thresholds) {
      updates.thresholds = thresholds;
      deviceUpdates.thresholds = thresholds;
    }

    if (isWateringEnabled !== undefined) {
      updates.isWateringEnabled = isWateringEnabled;
      deviceUpdates.isWateringEnabled = isWateringEnabled;
    }

    // Update irrigation status in database
    const irrigationStatus = await IrrigationStatus.updateIrrigationStatus(deviceId, updates);

    // Update device configuration
    if (Object.keys(deviceUpdates).length > 0) {
      await Device.findByIdAndUpdate(device._id, { $set: deviceUpdates });
    }

    // Publish command to MQTT if pump status changed
    if (pumpStatus) {
      const mqttClient = req.app.get('mqttClient');
      if (mqttClient) {
        const commandTopic = `devices/${deviceId}/commands`;
        const commandPayload = JSON.stringify({
          commandId: irrigationStatus._id,
          command: pumpStatus === 'on' ? 'pump_on' : 'pump_off',
          timestamp: new Date().toISOString(),
          userId: userId
        });

        mqttClient.publish(commandTopic, commandPayload, { qos: 1 }, (err) => {
          if (err) {
            console.error('MQTT publish error:', err);
          } else {
            console.log(`Published irrigation command to ${commandTopic}:`, commandPayload);
          }
        });
      }
    }

    res.json({
      success: true,
      message: 'Irrigation control updated successfully',
      status: {
        deviceId,
        irrigationStatus: irrigationStatus.irrigationStatus,
        pumpStatus: irrigationStatus.pumpStatus,
        wateringMode: irrigationStatus.wateringMode,
        thresholds: irrigationStatus.thresholds,
        isWateringEnabled: irrigationStatus.isWateringEnabled,
        lastCommand: irrigationStatus.lastCommand,
        commandTimestamp: irrigationStatus.commandTimestamp,
        lastIrrigationTime: irrigationStatus.lastIrrigationTime
      }
    });
  } catch (error) {
    console.error('Irrigation control error:', error);
    res.status(500).json({
      error: 'Failed to update irrigation control',
      details: 'Unable to update irrigation settings. Please try again.'
    });
  }
});

// PUT /api/irrigation/:deviceId/thresholds - Update watering thresholds
router.put('/:deviceId/thresholds', authMiddleware, validateDeviceId, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const { dryThreshold, wetThreshold } = req.body;

    // Validate thresholds
    if (dryThreshold !== undefined && (dryThreshold < 0 || dryThreshold > 4095)) {
      return res.status(400).json({
        error: 'Invalid dry threshold',
        details: 'Dry threshold must be between 0 and 4095'
      });
    }

    if (wetThreshold !== undefined && (wetThreshold < 0 || wetThreshold > 4095)) {
      return res.status(400).json({
        error: 'Invalid wet threshold',
        details: 'Wet threshold must be between 0 and 4095'
      });
    }

    if (dryThreshold !== undefined && wetThreshold !== undefined && dryThreshold >= wetThreshold) {
      return res.status(400).json({
        error: 'Invalid thresholds',
        details: 'Dry threshold must be less than wet threshold'
      });
    }

    // Verify device ownership
    const device = await Device.findOne({ deviceId, userID: userId });
    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    // Update thresholds
    const newThresholds = {
      dryThreshold: dryThreshold !== undefined ? dryThreshold : device.thresholds.dryThreshold,
      wetThreshold: wetThreshold !== undefined ? wetThreshold : device.thresholds.wetThreshold
    };

    // Update device
    await Device.findByIdAndUpdate(device._id, {
      $set: {
        thresholds: newThresholds,
        LastUpdated: new Date()
      }
    });

    // Update irrigation status
    await IrrigationStatus.updateIrrigationStatus(deviceId, {
      thresholds: newThresholds
    });

    res.json({
      success: true,
      message: 'Watering thresholds updated successfully',
      thresholds: newThresholds
    });
  } catch (error) {
    console.error('Update thresholds error:', error);
    res.status(500).json({
      error: 'Failed to update thresholds',
      details: 'Unable to update watering thresholds. Please try again.'
    });
  }
});

// PUT /api/irrigation/:deviceId/mode - Set watering mode
router.put('/:deviceId/mode', authMiddleware, validateDeviceId, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const { wateringMode } = req.body;

    if (!['automatic', 'scheduled', 'manual'].includes(wateringMode)) {
      return res.status(400).json({
        error: 'Invalid watering mode',
        details: 'Watering mode must be one of: automatic, scheduled, manual'
      });
    }

    // Verify device ownership
    const device = await Device.findOne({ deviceId, userID: userId });
    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    // Update device
    await Device.findByIdAndUpdate(device._id, {
      $set: {
        wateringMode,
        LastUpdated: new Date()
      }
    });

    // Update irrigation status
    await IrrigationStatus.updateIrrigationStatus(deviceId, {
      irrigationStatus: wateringMode,
      wateringMode
    });

    res.json({
      success: true,
      message: 'Watering mode updated successfully',
      wateringMode
    });
  } catch (error) {
    console.error('Update watering mode error:', error);
    res.status(500).json({
      error: 'Failed to update watering mode',
      details: 'Unable to update watering mode. Please try again.'
    });
  }
});

module.exports = router;