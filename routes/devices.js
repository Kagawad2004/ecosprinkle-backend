const express = require('express');
const router = express.Router();
const Device = require('../models/Device');
const User = require('../models/User');
const authMiddleware = require('../middleware/auth');
const { validateDeviceRegistration, validateDeviceId, sanitizeInput } = require('../middleware/validation');
const watchdogService = require('../services/watchdogService');

// Apply input sanitization to all routes
router.use(sanitizeInput);

// POST /api/devices/register - Register new device (link to existing MQTT device)
router.post('/register', async (req, res) => {
  try {
    const { userId, deviceId, macAddress, deviceName, plantType, soilType, sunlight, growthStage, minThreshold, maxThreshold, wifiSsid, ipAddress } = req.body;

    // Normalize deviceId to lowercase for consistency
    const normalizedDeviceId = deviceId?.toLowerCase();

    // For now, handle both authenticated and non-authenticated requests (development mode)
    // In production, you'd want to enforce authentication
    const finalUserId = userId || req.user?.userId;
    
    if (!finalUserId) {
      return res.status(401).json({
        error: 'Authentication required',
        details: 'User ID not provided'
      });
    }

    if (!normalizedDeviceId || !macAddress) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'deviceId and macAddress are required'
      });
    }

    // Check if device already exists and is owned by someone
    const existingDevice = await Device.findOne({ deviceId: normalizedDeviceId });
    if (existingDevice) {
      console.log(`⚠️ Device ${normalizedDeviceId} already exists!`);
      console.log(`   Owned by: ${existingDevice.userID}`);
      console.log(`   Attempting registration by: ${finalUserId}`);
      
      // If device exists and is owned by SAME user - allow re-registration (update)
      if (existingDevice.userID === finalUserId) {
        console.log(`✅ Same user re-registering device - updating existing record`);
        
        // Update existing device instead of creating new one
        existingDevice.MACaddress = macAddress;
        existingDevice.DeviceName = deviceName || existingDevice.DeviceName;
        existingDevice.WifiSSID = wifiSsid || existingDevice.WifiSSID;
        existingDevice.Status = 'Online';
        existingDevice.isActive = true;
        existingDevice.lastSensorUpdate = new Date();
        existingDevice.LastUpdated = new Date();
        
        if (plantType) existingDevice.plantType = plantType;
        if (soilType) existingDevice.soilType = soilType;
        if (sunlight) existingDevice.sunlightExposure = sunlight;
        if (growthStage) existingDevice.growthStage = growthStage;
        if (growthStage === 'Seedling') existingDevice.plantedDate = new Date(); // Reset planted date for seedling stage
        if (minThreshold) existingDevice.thresholds.dryThreshold = minThreshold;
        if (maxThreshold) existingDevice.thresholds.wetThreshold = maxThreshold;
        
        await existingDevice.save();
        
        // Stop watchdog timer - device successfully re-registered
        watchdogService.stopTracking(normalizedDeviceId);
        
        // Send REGISTRATION_COMPLETE command to firmware to cancel its watchdog
        watchdogService.initializeMqtt();
        const registrationTopic = `Ecosprinkle/${normalizedDeviceId}/commands/control`;
        const registrationPayload = JSON.stringify({
          command: 'REGISTRATION_COMPLETE',
          timestamp: new Date().toISOString()
        });
        watchdogService.mqttClient.publish(registrationTopic, registrationPayload, { qos: 1 });
        console.log(`🐕 Sent REGISTRATION_COMPLETE command to ${normalizedDeviceId}`);
        
        return res.status(200).json({
          success: true,
          message: 'Device re-registered successfully',
          device: {
            id: existingDevice._id,
            deviceId: existingDevice.deviceId,
            deviceName: existingDevice.DeviceName,
            deviceType: existingDevice.deviceType,
            status: existingDevice.Status,
            isActive: existingDevice.isActive,
            thresholds: existingDevice.thresholds,
            wateringMode: existingDevice.wateringMode,
            plantType: existingDevice.plantType,
            soilType: existingDevice.soilType,
            sunlightExposure: existingDevice.sunlightExposure,
            createdAt: existingDevice.createdAt
          }
        });
      }
      
      // Device owned by different user - reject
      return res.status(409).json({
        error: 'Device already registered',
        details: 'This device is already registered to another user. Please remove it from the previous account first.'
      });
    }

    // Generate security key and QR code for device
    const securityKey = require('crypto').randomBytes(32).toString('hex');
    const qrData = JSON.stringify({
      deviceId: normalizedDeviceId,
      type: 'Ecosprinkle',
      mac: macAddress,
      version: '2.0.0'
    });

    // Generate MQTT topics for this device
    const mqttTopics = {
      sensorData: `Ecosprinkle/${normalizedDeviceId}/sensors/data`,
      commands: `Ecosprinkle/${normalizedDeviceId}/commands`,
      status: `Ecosprinkle/${normalizedDeviceId}/status`,
      responses: `Ecosprinkle/${normalizedDeviceId}/responses`
    };

    // Create new device
    const device = new Device({
      userID: finalUserId,
      deviceId: normalizedDeviceId,
      MACaddress: macAddress,
      DeviceName: deviceName || `Ecosprinkle-${normalizedDeviceId.substring(0, 8)}`,
      deviceType: 'combined', // Assuming combined sensor/pump device
      QRcode: qrData,
      securityKey,
      WifiSSID: wifiSsid || 'Unknown',
      plantID: null, // Will be set when associated with a plant
      Status: 'Online', // Set to Online since device just connected via WiFi
      isActive: true,
      // Store metadata
      location: ipAddress ? { name: ipAddress } : undefined,
      // Set thresholds based on plant/soil type
      thresholds: {
        dryThreshold: minThreshold || 1700,
        wetThreshold: maxThreshold || 4000
      },
      wateringMode: 'auto',
      isWateringEnabled: true,
      lastSensorUpdate: new Date(),
      // Plant and environment settings
      plantType: plantType || 'Unknown',
      soilType: soilType || 'Unknown',
      sunlightExposure: sunlight || 'Unknown',
      growthStage: growthStage || 'Seedling',
      plantedDate: new Date() // Set initial planted date
    });

    await device.save();

    // Update user's device list
    await User.findByIdAndUpdate(finalUserId, {
      $push: { devices: device._id }
    });

    // Stop watchdog timer - device successfully registered
    watchdogService.stopTracking(normalizedDeviceId);
    
    // Send REGISTRATION_COMPLETE command to firmware to cancel its watchdog
    watchdogService.initializeMqtt();
    const registrationTopic = `Ecosprinkle/${normalizedDeviceId}/commands/control`;
    const registrationPayload = JSON.stringify({
      command: 'REGISTRATION_COMPLETE',
      timestamp: new Date().toISOString()
    });
    watchdogService.mqttClient.publish(registrationTopic, registrationPayload, { qos: 1 });
    console.log(`🐕 Sent REGISTRATION_COMPLETE command to ${normalizedDeviceId}`);

    console.log(`✅ Device registered: ${normalizedDeviceId} for user ${finalUserId}`);
    console.log(`📡 MQTT Topics generated:`, mqttTopics);

    res.status(201).json({
      success: true,
      message: 'Device registered successfully',
      device: {
        id: device._id,
        deviceId: device.deviceId,
        deviceName: device.DeviceName,
        deviceType: device.deviceType,
        status: device.Status,
        isActive: device.isActive,
        thresholds: device.thresholds,
        wateringMode: device.wateringMode,
        mqttTopics, // Return MQTT topics for device to use
        plantType,
        soilType,
        sunlightExposure: sunlight,
        createdAt: device.createdAt
      }
    });
  } catch (error) {
    console.error('Device registration error:', error);
    res.status(500).json({
      error: 'Device registration failed',
      details: error.message || 'Unable to register device. Please try again.'
    });
  }
});

// GET /api/devices/user/:userId - Get all devices for a specific user (for development)
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const devices = await Device.find({ userID: userId })
      .sort({ LastUpdated: -1 })
      .select('-securityKey'); // Exclude sensitive information

    const formattedDevices = devices.map(device => ({
      id: device._id,
      deviceId: device.deviceId,
      DeviceName: device.DeviceName,
      deviceName: device.DeviceName,
      deviceType: device.deviceType,
      Status: device.Status,
      status: device.Status,
      isActive: device.isActive,
      isOnline: device.isOnline || false,
      moistureLevel: device.moistureLevel,
      batteryLevel: device.batteryLevel,
      thresholds: device.thresholds,
      wateringMode: device.wateringMode,
      isWateringEnabled: device.isWateringEnabled,
      lastSensorUpdate: device.lastSensorUpdate,
      plantType: device.plantType,
      soilType: device.soilType,
      sunlightExposure: device.sunlightExposure,
      createdAt: device.createdAt,
      lastUpdated: device.LastUpdated,
      MACaddress: device.MACaddress,
      WifiSSID: device.WifiSSID
    }));

    res.json({
      success: true,
      devices: formattedDevices
    });
  } catch (error) {
    console.error('Get user devices error:', error);
    res.status(500).json({
      error: 'Failed to fetch devices',
      details: error.message
    });
  }
});

// GET /api/devices - Get all devices for authenticated user
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const devices = await Device.find({ userID: userId })
      .sort({ LastUpdated: -1 })
      .select('-securityKey -WifiSSID'); // Exclude sensitive information

    const formattedDevices = devices.map(device => {
      // Check if device is online (received data in last 5 seconds - for debugging)
      const isOnline = device.lastSensorUpdate && 
        (new Date() - device.lastSensorUpdate) < 5 * 1000; // 5 seconds in milliseconds
      
      return {
        id: device._id,
        deviceId: device.deviceId,
        deviceName: device.DeviceName,
        deviceType: device.deviceType,
        status: device.Status,
        isOnline,
        isActive: device.isActive,
        moistureLevel: device.moistureLevel,
        batteryLevel: device.batteryLevel,
        thresholds: device.thresholds,
        wateringMode: device.wateringMode,
        isWateringEnabled: device.isWateringEnabled,
        lastSensorUpdate: device.lastSensorUpdate,
        plantType: device.plantType,
        soilType: device.soilType,
        sunlightExposure: device.sunlightExposure,
        growthStage: device.growthStage,  // Add growthStage field
        plantedDate: device.plantedDate,  // Also include plantedDate for reference
        createdAt: device.createdAt,
        lastUpdated: device.LastUpdated
      };
    });

    res.json({
      success: true,
      devices: formattedDevices
    });
  } catch (error) {
    console.error('Get devices error:', error);
    res.status(500).json({
      error: 'Failed to retrieve devices',
      details: 'Unable to fetch device list. Please try again.'
    });
  }
});

// GET /api/devices/:deviceId - Get specific device details
router.get('/:deviceId', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user?.userId;

    // Build query - if user is authenticated, verify ownership
    const query = { deviceId };
    if (userId) {
      query.userID = userId;
    }

    const device = await Device.findOne(query).select('-securityKey');

    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    // Check if device is online (received data in last 5 seconds - for debugging)
    const isOnline = device.lastSensorUpdate && 
      (new Date() - device.lastSensorUpdate) < 5 * 1000; // 5 seconds in milliseconds

    res.json({
      success: true,
      device: {
        id: device._id,
        deviceId: device.deviceId,
        deviceName: device.DeviceName,
        deviceType: device.deviceType,
        status: device.Status,
        isOnline,
        isActive: device.isActive,
        moistureLevel: device.moistureLevel,
        batteryLevel: device.batteryLevel,
        thresholds: device.thresholds,
        wateringMode: device.wateringMode,
        isWateringEnabled: device.isWateringEnabled,
        lastSensorUpdate: device.lastSensorUpdate,
        location: device.location,
        schedule: device.schedule,
        createdAt: device.createdAt,
        lastUpdated: device.LastUpdated
      }
    });
  } catch (error) {
    console.error('Get device error:', error);
    res.status(500).json({
      error: 'Failed to retrieve device',
      details: 'Unable to fetch device details. Please try again.'
    });
  }
});

// PUT /api/devices/:deviceId - Update device settings
router.put('/:deviceId', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const updates = req.body;

    // Fields that can be updated
    const allowedUpdates = [
      'DeviceName', 'plantType', 'soilType', 'sunlightExposure', 'growthStage',
      'thresholds', 'wateringMode', 'isWateringEnabled', 'schedule', 'location'
    ];

    const updateData = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updateData[key] = updates[key];
      }
    });

    updateData.LastUpdated = new Date();

    const device = await Device.findOneAndUpdate(
      { deviceId, userID: userId },
      { $set: updateData },
      { new: true }
    ).select('-securityKey -WifiSSID');

    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    res.json({
      success: true,
      message: 'Device updated successfully',
      device: {
        id: device._id,
        deviceId: device.deviceId,
        deviceName: device.DeviceName,
        deviceType: device.deviceType,
        status: device.Status,
        isActive: device.isActive,
        thresholds: device.thresholds,
        wateringMode: device.wateringMode,
        isWateringEnabled: device.isWateringEnabled,
        plantType: device.plantType,
        soilType: device.soilType,
        sunlightExposure: device.sunlightExposure,
        location: device.location,
        schedule: device.schedule,
        lastUpdated: device.LastUpdated
      }
    });
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({
      error: 'Failed to update device',
      details: 'Unable to update device configuration. Please try again.'
    });
  }
});

// PATCH /api/devices/:deviceId - Update device settings (partial update)
router.patch('/:deviceId', authMiddleware, validateDeviceId, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const updates = req.body;

    // Fields that can be updated
    const allowedUpdates = [
      'DeviceName', 'plantType', 'soilType', 'sunlightExposure', 'growthStage',
      'thresholds', 'wateringMode', 'isWateringEnabled', 'schedule', 'location'
    ];

    const updateData = {};
    Object.keys(updates).forEach(key => {
      if (allowedUpdates.includes(key)) {
        updateData[key] = updates[key];
      }
    });

    updateData.LastUpdated = new Date();

    const device = await Device.findOneAndUpdate(
      { deviceId, userID: userId },
      { $set: updateData },
      { new: true }
    ).select('-securityKey -WifiSSID');

    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    res.json({
      success: true,
      message: 'Device updated successfully',
      device: {
        id: device._id,
        deviceId: device.deviceId,
        deviceName: device.DeviceName,
        deviceType: device.deviceType,
        status: device.Status,
        isActive: device.isActive,
        thresholds: device.thresholds,
        wateringMode: device.wateringMode,
        isWateringEnabled: device.isWateringEnabled,
        plantType: device.plantType,
        soilType: device.soilType,
        sunlightExposure: device.sunlightExposure,
        location: device.location,
        schedule: device.schedule,
        lastUpdated: device.LastUpdated
      }
    });
  } catch (error) {
    console.error('Update device error:', error);
    res.status(500).json({
      error: 'Failed to update device',
      details: 'Unable to update device configuration. Please try again.'
    });
  }
});

// DELETE /api/devices/:deviceId - Remove device
router.delete('/:deviceId', authMiddleware, validateDeviceId, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;

    console.log(`🗑️ Delete request for device: ${deviceId} by user: ${userId}`);

    const device = await Device.findOneAndDelete({
      deviceId,
      userID: userId
    });

    if (!device) {
      console.log(`❌ Device ${deviceId} not found or not owned by user ${userId}`);
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    console.log(`✅ Device ${deviceId} deleted from database`);

    // Remove device from user's device list
    await User.findByIdAndUpdate(userId, {
      $pull: { devices: device._id }
    });
    
    console.log(`✅ Device ${deviceId} removed from user's device list`);

    // Also delete all associated sensor data (optional - cleanup)
    const SensorData = require('../models/SensorData');
    const deletedSensorData = await SensorData.deleteMany({ deviceId });
    console.log(`🧹 Deleted ${deletedSensorData.deletedCount} sensor data records for device ${deviceId}`);

    // 🔥 CRITICAL: Send DEVICE_DELETED command to ESP32 via MQTT (cloud broker)
    try {
      // Get MQTT client from app (set in secure-cloud-backend.js)
      const mqttClient = req.app.get('cloudMqttClient') || req.app.get('mqttClient');
      
      if (mqttClient && mqttClient.connected) {
        const deletionMessage = {
          command: 'DEVICE_DELETED',
          deviceId: deviceId,
          message: 'Device removed from account. WiFi will be cleared automatically.',
          timestamp: new Date().toISOString()
        };
        
        // Send to device-specific command topic (matching ESP32 subscription)
        const commandTopic = `Ecosprinkle/${deviceId}/commands/control`;
        console.log(`📡 Sending DEVICE_DELETED to ${commandTopic} via cloud MQTT...`);
        
        mqttClient.publish(
          commandTopic,
          JSON.stringify(deletionMessage),
          { qos: 1, retain: false },
          (err) => {
            if (err) {
              console.error(`❌ Failed to send DEVICE_DELETED:`, err);
            } else {
              console.log(`✅ DEVICE_DELETED sent to ${deviceId}`);
              console.log(`   ESP32 will clear WiFi credentials and restart in AP mode`);
            }
          }
        );
      } else {
        console.warn(`⚠️  MQTT client not connected - ESP32 won't receive deletion signal`);
        console.warn(`   Manual factory reset required: Hold button for 5 seconds`);
      }
    } catch (mqttError) {
      console.error(`❌ Error sending MQTT deletion command:`, mqttError);
    }

    res.json({
      success: true,
      message: 'Device removed successfully',
      deviceId,
      cleanedUp: {
        device: true,
        sensorData: deletedSensorData.deletedCount
      }
    });
  } catch (error) {
    console.error('Delete device error:', error);
    res.status(500).json({
      error: 'Failed to remove device',
      details: 'Unable to remove device. Please try again.'
    });
  }
});

// GET /api/devices/:deviceId/sensor-data/latest - Get latest sensor reading
router.get('/:deviceId/sensor-data/latest', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const SensorData = require('../models/SensorData');

    // Get the most recent sensor reading for this device
    const latestData = await SensorData.findOne({ deviceId })
      .sort({ timestamp: -1 })
      .limit(1);

    if (!latestData) {
      return res.json({
        success: true,
        data: null,
        message: 'No sensor data available yet'
      });
    }

    res.json({
      success: true,
      data: {
        deviceId: latestData.deviceId,
        zone1: latestData.zone1,
        zone2: latestData.zone2,
        zone3: latestData.zone3,
        moisture: latestData.zone1, // Default to zone1 for backward compatibility
        median: latestData.median,
        timestamp: latestData.timestamp,
        createdAt: latestData.createdAt
      }
    });
  } catch (error) {
    console.error('Get latest sensor data error:', error);
    res.status(500).json({
      error: 'Failed to fetch sensor data',
      details: error.message
    });
  }
});

// GET /api/devices/:deviceId/command-history - Get command history for device
router.get('/:deviceId/command-history', async (req, res) => {
  const deviceController = require('../controllers/deviceController');
  await deviceController.getDeviceCommandHistory(req, res);
});

// POST /api/devices/:deviceId/provision-started - Notify that WiFi provisioning started
// This starts the backend watchdog timer
router.post('/:deviceId/provision-started', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const normalizedDeviceId = deviceId?.toLowerCase();

    if (!normalizedDeviceId) {
      return res.status(400).json({
        error: 'Missing required field',
        details: 'deviceId is required'
      });
    }

    // Start watchdog tracking
    watchdogService.startTracking(normalizedDeviceId);

    res.status(200).json({
      success: true,
      message: 'WiFi provisioning watchdog started',
      deviceId: normalizedDeviceId,
      timeoutMinutes: 5
    });
  } catch (error) {
    console.error('Provision started error:', error);
    res.status(500).json({
      error: 'Failed to start watchdog',
      details: error.message
    });
  }
});

// POST /api/devices/:deviceId/reset-wifi - Manually reset device WiFi
// This sends immediate MQTT command without waiting for timeout
router.post('/:deviceId/reset-wifi', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const normalizedDeviceId = deviceId?.toLowerCase();

    if (!normalizedDeviceId) {
      return res.status(400).json({
        error: 'Missing required field',
        details: 'deviceId is required'
      });
    }

    // Initialize MQTT if needed
    watchdogService.initializeMqtt();

    // Send WiFi reset command immediately
    await watchdogService.sendWiFiResetCommand(normalizedDeviceId);

    // Also stop any active watchdog tracking
    watchdogService.stopTracking(normalizedDeviceId);

    res.status(200).json({
      success: true,
      message: 'WiFi reset command sent',
      deviceId: normalizedDeviceId
    });
  } catch (error) {
    console.error('WiFi reset error:', error);
    res.status(500).json({
      error: 'Failed to reset WiFi',
      details: error.message
    });
  }
});

// GET /api/devices/watchdog/status - Get watchdog status (for debugging)
router.get('/watchdog/status', async (req, res) => {
  try {
    const trackedDevices = watchdogService.getTrackedDevices();
    
    res.status(200).json({
      success: true,
      trackedDevices,
      count: trackedDevices.length
    });
  } catch (error) {
    console.error('Watchdog status error:', error);
    res.status(500).json({
      error: 'Failed to get watchdog status',
      details: error.message
    });
  }
});

module.exports = router;