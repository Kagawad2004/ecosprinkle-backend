const Device = require('../models/Device');
const Plant = require('../models/Plant');
const SensorData = require('../models/SensorData');
const DeviceCommand = require('../models/DeviceCommand');
const Notification = require('../models/Notification');
const User = require('../models/User');

// ==================== DEVICE REGISTRATION ====================

// Register a new device
exports.registerDevice = async (req, res) => {
  try {
    const { deviceData, userId } = req.body;

    // Check if device is already registered
    const existingDevice = await Device.findOne({ deviceId: deviceData.deviceId });
    
    if (existingDevice) {
      // Check if device is orphaned or inactive
      const isOrphaned = existingDevice.Status === 'Orphaned' || !existingDevice.isActive;
      
      // Also check if device is in user's device list
      const deviceOwner = await User.findById(existingDevice.userID);
      const isInUserDeviceList = deviceOwner && deviceOwner.devices.includes(existingDevice._id);
      
      if (isOrphaned || !isInUserDeviceList) {
        console.log(`📝 Re-registering device ${deviceData.deviceId} to new user ${userId}`);
        console.log(`   Previous status: ${existingDevice.Status}, isActive: ${existingDevice.isActive}`);
        console.log(`   Previous owner had device in list: ${isInUserDeviceList}`);
        
        // Remove device from old user's list (if any)
        if (existingDevice.userID && existingDevice.userID.toString() !== userId) {
          await User.findByIdAndUpdate(existingDevice.userID, {
            $pull: { devices: existingDevice._id }
          });
          console.log(`   Removed device from old user ${existingDevice.userID}`);
        }
        
        // Re-assign device to new user
        existingDevice.userID = userId;
        existingDevice.DeviceName = deviceData.deviceName;
        existingDevice.WifiSSID = deviceData.wifiSSID;
        existingDevice.isActive = true;
        existingDevice.Status = 'Registered';
        existingDevice.LastUpdated = new Date();
        
        // Clear old state that might cause issues
        existingDevice.manualPumpState = undefined;
        existingDevice.wateringMode = 'auto'; // Reset to default mode
        
        await existingDevice.save();
        
        // Add device to new user's device list
        await User.findByIdAndUpdate(userId, {
          $addToSet: { devices: existingDevice._id } // Use $addToSet to prevent duplicates
        });
        
        console.log(`✅ Device re-registered successfully to user ${userId}`);
        
        return res.status(200).json({
          message: 'Device re-registered successfully',
          device: existingDevice
        });
      } else {
        // Device is still actively owned by another user
        console.log(`❌ Device ${deviceData.deviceId} is still actively registered to user ${existingDevice.userID}`);
        return res.status(409).json({ 
          error: 'Device already registered',
          details: 'This device is already registered in the system. Please remove it from the previous account first, or contact support if this is your device.',
          deviceId: deviceData.deviceId
        });
      }
    }

    // Create new device document
    const device = new Device({
      userID: userId,
      QRcode: deviceData.deviceId,
      deviceId: deviceData.deviceId,
      deviceType: deviceData.deviceType || 'sensor',
      MACaddress: deviceData.macAddress,
      securityKey: deviceData.securityKey,
      WifiSSID: deviceData.wifiSSID,
      DeviceName: deviceData.deviceName,
      isActive: true,
      Status: 'Registered',
    });

    await device.save();

    // Add device to user's device list
    await User.findByIdAndUpdate(userId, {
      $push: { devices: device._id }
    });

    res.status(201).json({
      message: 'Device registered successfully',
      device: device
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Check if device is registered
exports.isDeviceRegistered = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = await Device.findOne({ deviceId });
    res.json({ isRegistered: !!device });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get device by ID
exports.getDeviceById = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }
    res.json(device);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update device status
exports.updateDeviceStatus = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { statusData } = req.body;

    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          ...statusData,
          LastUpdated: new Date()
        }
      },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete/remove device from user's account (orphan it for re-registration)
exports.deleteDevice = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user?.id; // Get from auth middleware if available

    console.log(`🗑️ Delete request for device ${deviceId} from user ${userId}`);

    // Find the device
    const device = await Device.findOne({ deviceId });
    if (!device) {
      console.log(`❌ Device ${deviceId} not found`);
      return res.status(404).json({ message: 'Device not found' });
    }

    console.log(`   Current device status: ${device.Status}, isActive: ${device.isActive}`);
    console.log(`   Current device owner: ${device.userID}`);

    // Remove device from user's device list
    if (userId) {
      const updateResult = await User.findByIdAndUpdate(userId, {
        $pull: { devices: device._id }
      });
      console.log(`✅ Removed device from user ${userId}'s device list`);
    } else if (device.userID) {
      // Fallback: remove from device's registered user
      const updateResult = await User.findByIdAndUpdate(device.userID, {
        $pull: { devices: device._id }
      });
      console.log(`✅ Removed device from user ${device.userID}'s device list (fallback)`);
    }

    // Mark device as orphaned (don't delete, allow re-registration)
    device.isActive = false;
    device.Status = 'Orphaned';
    device.LastUpdated = new Date();
    // Optionally clear userID to fully orphan the device
    // device.userID = null; // Uncomment if you want to completely disassociate
    await device.save();

    console.log(`✅ Device ${deviceId} marked as orphaned and ready for re-registration`);
    console.log(`   New status: ${device.Status}, isActive: ${device.isActive}`);

    // 🔥 CRITICAL: Send DEVICE_DELETED command to ESP32 via MQTT
    try {
      const mqttClient = req.app.get('mqttClient');
      if (mqttClient && mqttClient.connected) {
        const deletionMessage = {
          command: 'DEVICE_DELETED',
          deviceId: deviceId,
          message: 'Device was removed from user account. Performing factory reset.',
          timestamp: new Date().toISOString()
        };
        
        // Send to device-specific command topic
        const commandTopic = `ecosprinkler/${deviceId}/commands/control`;
        console.log(`📡 Sending DEVICE_DELETED to ${commandTopic}...`);
        
        mqttClient.publish(
          commandTopic,
          JSON.stringify(deletionMessage),
          { qos: 1, retain: false },
          (err) => {
            if (err) {
              console.error(`❌ Failed to send DEVICE_DELETED via MQTT:`, err);
            } else {
              console.log(`✅ DEVICE_DELETED command sent to ${deviceId}`);
              console.log(`   ESP32 will clear WiFi and restart in AP mode`);
            }
          }
        );
      } else {
        console.warn(`⚠️  MQTT client not available - ESP32 won't receive deletion notification`);
        console.warn(`   Device will need manual factory reset (hold button for 5s)`);
      }
    } catch (mqttError) {
      console.error(`❌ Error sending MQTT deletion command:`, mqttError);
    }

    res.json({ 
      success: true,
      message: 'Device removed successfully. Device WiFi credentials have been cleared and it can be re-registered by scanning the QR code again.',
      deviceId 
    });
  } catch (error) {
    console.error('❌ Delete device error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to remove device',
      error: error.message 
    });
  }
};

// Delete ALL devices from the database (DEVELOPER ONLY - USE WITH CAUTION!)
exports.deleteAllDevices = async (req, res) => {
  try {
    console.log(`🗑️🗑️🗑️ DELETE ALL DEVICES REQUEST - This will remove ALL devices from database!`);
    
    // Count devices before deletion
    const deviceCount = await Device.countDocuments();
    console.log(`   Found ${deviceCount} devices to delete`);
    
    if (deviceCount === 0) {
      return res.json({ 
        success: true,
        message: 'No devices found in database',
        deletedCount: 0
      });
    }

    // Remove all device references from all users
    await User.updateMany(
      { devices: { $exists: true, $ne: [] } },
      { $set: { devices: [] } }
    );
    console.log(`✅ Cleared device references from all users`);

    // Delete all devices from database
    const deleteResult = await Device.deleteMany({});
    console.log(`✅ Deleted ${deleteResult.deletedCount} devices from database`);

    // Also clean up related data (optional - remove if you want to keep history)
    const sensorDataCount = await SensorData.deleteMany({});
    console.log(`✅ Deleted ${sensorDataCount.deletedCount} sensor data records`);
    
    const commandCount = await DeviceCommand.deleteMany({});
    console.log(`✅ Deleted ${commandCount.deletedCount} device commands`);

    res.json({ 
      success: true,
      message: `All devices deleted successfully`,
      deletedCount: deleteResult.deletedCount,
      sensorDataDeleted: sensorDataCount.deletedCount,
      commandsDeleted: commandCount.deletedCount
    });
  } catch (error) {
    console.error('❌ Delete all devices error:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to delete all devices',
      error: error.message 
    });
  }
};

// Associate device with plant
exports.associateDeviceWithPlant = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { plantId } = req.body;

    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          plantID: plantId,
          LastUpdated: new Date()
        }
      },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get user's devices
exports.getUserDevices = async (req, res) => {
  try {
    const { userId } = req.params;
    const devices = await Device.find({ userID: userId })
      .sort({ LastUpdated: -1 });
    res.json(devices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==================== SENSOR DATA ====================

// Store sensor data
exports.storeSensorData = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const sensorData = req.body;

    const data = new SensorData({
      deviceId,
      ...sensorData,
      timestamp: new Date()
    });

    await data.save();

    // Update device's last sensor update
    await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          lastSensorUpdate: new Date(),
          moistureLevel: sensorData.moisturePercent || 0,
          batteryLevel: sensorData.batteryLevel || 100
        }
      }
    );

    // Emit real-time update via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit(`sensor-update:${deviceId}`, data);
    }

    res.status(201).json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get real-time sensor data stream (latest)
exports.getSensorDataStream = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const latestData = await SensorData.findOne({ deviceId })
      .sort({ timestamp: -1 });

    res.json(latestData || {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get sensor data history
exports.getSensorDataHistory = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { startDate, endDate, limit = 100 } = req.query;

    const query = { deviceId };
    if (startDate && endDate) {
      query.timestamp = {
        $gte: new Date(startDate),
        $lte: new Date(endDate)
      };
    }

    const data = await SensorData.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json(data);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==================== DEVICE COMMANDS ====================

// Send device command
exports.sendDeviceCommand = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { command, plantId, parameters } = req.body;

    const commandDoc = new DeviceCommand({
      deviceId,
      command,
      plantId,
      parameters: parameters || {},
      status: 'pending',
      executed: false
    });

    await commandDoc.save();

    // Emit command via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit(`device-command:${deviceId}`, commandDoc);
    }

    // Publish command via MQTT
    const mqttClient = req.app.get('mqttClient');
    if (mqttClient && mqttClient.connected) {
      // Enhanced topic structure for better organization
      const topic = `ecosprinkler/${deviceId}/commands/control`;
      const message = JSON.stringify({
        commandId: commandDoc._id,
        command: commandDoc.command,
        parameters: commandDoc.parameters,
        timestamp: commandDoc.timestamp
      });

      mqttClient.publish(topic, message, { qos: 1 }, (error) => {
        if (error) {
          console.error('MQTT publish error:', error);
        } else {
          console.log(`Command published to MQTT topic: ${topic}`);
        }
      });
    }

    res.status(201).json(commandDoc);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get pending commands
exports.getPendingCommands = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const commands = await DeviceCommand.find({
      deviceId,
      status: 'pending',
      executed: false
    }).sort({ timestamp: 1 });

    res.json({
      success: true,
      commands
    });
  } catch (error) {
    res.status(500).json({ 
      success: false,
      message: error.message 
    });
  }
};

// Get command history for a device
exports.getDeviceCommandHistory = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 20, command } = req.query;
    
    // Build query
    const query = { deviceId };
    
    // Filter by command type if specified
    if (command) {
      query.command = command;
    }
    
    const commands = await DeviceCommand.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));
      
    res.json({
      success: true,
      deviceId,
      commands,
      count: commands.length
    });
  } catch (error) {
    console.error('Error getting command history:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to get command history',
      error: error.message
    });
  }
};

// Mark command as executed
exports.markCommandExecuted = async (req, res) => {
  try {
    const { commandId } = req.params;
    const { response } = req.body;

    const command = await DeviceCommand.findByIdAndUpdate(
      commandId,
      {
        $set: {
          status: 'executed',
          executed: true,
          response,
          executedAt: new Date()
        }
      },
      { new: true }
    );

    if (!command) {
      return res.status(404).json({ message: 'Command not found' });
    }

    res.json(command);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark command as failed
exports.markCommandFailed = async (req, res) => {
  try {
    const { commandId } = req.params;
    const { error: errorMessage } = req.body;

    const command = await DeviceCommand.findByIdAndUpdate(
      commandId,
      {
        $set: {
          status: 'failed',
          error: errorMessage,
          failedAt: new Date()
        }
      },
      { new: true }
    );

    if (!command) {
      return res.status(404).json({ message: 'Command not found' });
    }

    res.json(command);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==================== WATERING CONTROLS ====================

// Send watering command
exports.sendWateringCommand = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { command, parameters } = req.body;

    await exports.sendDeviceCommand(req, res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update watering thresholds
exports.updateWateringThresholds = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { dryThreshold, wetThreshold } = req.body;

    // Update device thresholds
    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          'thresholds.dryThreshold': dryThreshold,
          'thresholds.wetThreshold': wetThreshold,
          LastUpdated: new Date()
        }
      },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    // Send command to device
    req.body = {
      command: 'UPDATE_THRESHOLDS',
      parameters: { dryThreshold, wetThreshold }
    };
    await exports.sendDeviceCommand(req, res);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Set watering mode
exports.setWateringMode = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { mode } = req.body;

    // Validate mode
    if (!['auto', 'manual', 'schedule'].includes(mode)) {
      return res.status(400).json({ 
        success: false,
        message: 'Invalid mode. Must be "auto", "manual", or "schedule"' 
      });
    }

    // Update device mode
    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          wateringMode: mode,
          LastUpdated: new Date()
        }
      },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ 
        success: false,
        message: 'Device not found' 
      });
    }

    // Create a device command record
    const command = new DeviceCommand({
      deviceId,
      command: 'SET_WATERING_MODE',
      parameters: { mode },
      status: 'pending',
      executed: false
    });
    
    await command.save();

    // Publish command via MQTT
    const mqttClient = req.app.get('mqttClient');
    if (mqttClient && mqttClient.connected) {
      const topic = `ecosprinkler/${deviceId}/commands/control`;
      const message = JSON.stringify({
        command: 'SET_WATERING_MODE',
        parameters: { mode },
        commandId: command._id
      });

      mqttClient.publish(topic, message, { qos: 1 });
    }
    
    // Return response directly rather than calling sendDeviceCommand again
    res.json({
      success: true,
      message: `Watering mode set to ${mode}`,
      device: {
        deviceId: device.deviceId,
        wateringMode: device.wateringMode
      },
      command: {
        id: command._id,
        command: command.command,
        status: command.status,
        timestamp: command.timestamp
      }
    });
  } catch (error) {
    console.error('Error setting watering mode:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to set watering mode',
      error: error.message
    });
  }
};

// Set watering schedules
exports.setWateringSchedules = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { schedules } = req.body;

    // Validate schedules format
    if (!Array.isArray(schedules)) {
      return res.status(400).json({ 
        success: false,
        message: 'Schedules must be an array' 
      });
    }
    
    // Validate each schedule
    for (const schedule of schedules) {
      if (!schedule.day && schedule.day !== 0) {
        return res.status(400).json({
          success: false,
          message: 'Each schedule must contain a day (0-6, where 0 is Sunday)'
        });
      }
      
      if (!schedule.hour && schedule.hour !== 0) {
        return res.status(400).json({
          success: false,
          message: 'Each schedule must contain an hour (0-23)'
        });
      }
      
      if (!schedule.minute && schedule.minute !== 0) {
        return res.status(400).json({
          success: false,
          message: 'Each schedule must contain a minute (0-59)'
        });
      }
      
      if (!schedule.duration) {
        return res.status(400).json({
          success: false,
          message: 'Each schedule must contain a duration in seconds'
        });
      }
    }

    // Update device schedules
    const device = await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          schedule: schedules,
          wateringMode: 'schedule', // Auto-switch to schedule mode when schedules are set
          LastUpdated: new Date()
        }
      },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ 
        success: false,
        message: 'Device not found' 
      });
    }

    // Create device command
    const command = new DeviceCommand({
      deviceId,
      command: 'UPDATE_SCHEDULE',
      parameters: { schedules },
      status: 'pending',
      executed: false
    });
    
    await command.save();
    
    // Publish command via MQTT
    const mqttClient = req.app.get('mqttClient');
    if (mqttClient && mqttClient.connected) {
      const topic = `ecosprinkler/${deviceId}/commands/control`;
      const message = JSON.stringify({
        command: 'UPDATE_SCHEDULE',
        parameters: { schedules },
        commandId: command._id,
        timestamp: Date.now()
      });

      mqttClient.publish(topic, message, { qos: 1 });
    }
    
    res.json({
      success: true,
      message: 'Watering schedules updated',
      schedules: device.schedule,
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    });
  } catch (error) {
    console.error('Error setting schedules:', error);
    res.status(500).json({ 
      success: false,
      message: 'Failed to set watering schedules',
      error: error.message 
    });
  }
};

// ==================== DEVICE STATUS ====================

// Get device status
exports.getDeviceStatus = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const latestData = await SensorData.findOne({ deviceId })
      .sort({ timestamp: -1 });

    res.json(latestData || {});
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Check if device is online
exports.isDeviceOnline = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const latestData = await SensorData.findOne({ deviceId })
      .sort({ timestamp: -1 });

    let isOnline = false;
    if (latestData && latestData.timestamp) {
      const now = new Date();
      const timeDiff = now - latestData.timestamp;
      // Consider online if updated within last 5 minutes
      isOnline = timeDiff < (5 * 60 * 1000);
    }

    res.json({ isOnline });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==================== NOTIFICATIONS ====================

// Get device notifications
exports.getDeviceNotifications = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { limit = 20 } = req.query;

    const notifications = await Notification.find({ deviceId })
      .sort({ timestamp: -1 })
      .limit(parseInt(limit));

    res.json(notifications);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create notification
exports.createNotification = async (req, res) => {
  try {
    const { deviceId, userId, type, title, message, severity, data } = req.body;

    const notification = new Notification({
      deviceId,
      userId,
      type,
      title,
      message,
      severity: severity || 'medium',
      data: data || {}
    });

    await notification.save();

    // Emit notification via Socket.IO
    const io = req.app.get('io');
    if (io) {
      io.emit(`notification:${userId}`, notification);
    }

    res.status(201).json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Mark notification as read
exports.markNotificationRead = async (req, res) => {
  try {
    const { notificationId } = req.params;

    const notification = await Notification.findByIdAndUpdate(
      notificationId,
      {
        $set: {
          read: true,
          readAt: new Date()
        }
      },
      { new: true }
    );

    if (!notification) {
      return res.status(404).json({ message: 'Notification not found' });
    }

    res.json(notification);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==================== PLANT MANAGEMENT ====================

// Get plants for a user
exports.getUserPlants = async (req, res) => {
  try {
    const { userId } = req.params;
    const plants = await Plant.find({ userId, isActive: true })
      .sort({ createdAt: -1 });
    res.json(plants);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get plant by ID
exports.getPlantById = async (req, res) => {
  try {
    const { plantId } = req.params;
    const plant = await Plant.findById(plantId);
    if (!plant) {
      return res.status(404).json({ message: 'Plant not found' });
    }
    res.json(plant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Create new plant
exports.createPlant = async (req, res) => {
  try {
    const { userId, name, plantType, location, description, wateringType } = req.body;

    const plant = new Plant({
      userId,
      name,
      plantType,
      location: location || '',
      description: description || '',
      wateringType: wateringType || 'manual'
    });

    await plant.save();
    res.status(201).json(plant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update plant
exports.updatePlant = async (req, res) => {
  try {
    const { plantId } = req.params;
    const updateData = req.body;

    const plant = await Plant.findByIdAndUpdate(
      plantId,
      { $set: updateData },
      { new: true }
    );

    if (!plant) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    res.json(plant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Delete plant
exports.deletePlant = async (req, res) => {
  try {
    const { plantId } = req.params;

    const plant = await Plant.findByIdAndUpdate(
      plantId,
      { $set: { isActive: false } },
      { new: true }
    );

    if (!plant) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    res.json({ message: 'Plant deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Get devices for a plant
exports.getPlantDevices = async (req, res) => {
  try {
    const { plantId } = req.params;
    const devices = await Device.find({ plantID: plantId })
      .sort({ LastUpdated: -1 });
    res.json(devices);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update plant watering mode
exports.updatePlantWateringMode = async (req, res) => {
  try {
    const { plantId } = req.params;
    const { mode } = req.body;

    const plant = await Plant.findByIdAndUpdate(
      plantId,
      { $set: { wateringType: mode } },
      { new: true }
    );

    if (!plant) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    res.json(plant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update plant watering thresholds
exports.updatePlantThresholds = async (req, res) => {
  try {
    const { plantId } = req.params;
    const { minThreshold, maxThreshold } = req.body;

    const plant = await Plant.findByIdAndUpdate(
      plantId,
      {
        $set: {
          'moistureThresholds.min': minThreshold,
          'moistureThresholds.max': maxThreshold
        }
      },
      { new: true }
    );

    if (!plant) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    res.json(plant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Update plant schedules
exports.updatePlantSchedules = async (req, res) => {
  try {
    const { plantId } = req.params;
    const { schedules } = req.body;

    const plant = await Plant.findByIdAndUpdate(
      plantId,
      { $set: { schedules } },
      { new: true }
    );

    if (!plant) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    res.json(plant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// Toggle watering enabled
exports.togglePlantWatering = async (req, res) => {
  try {
    const { plantId } = req.params;
    const { enabled } = req.body;

    const plant = await Plant.findByIdAndUpdate(
      plantId,
      { $set: { isWateringEnabled: enabled } },
      { new: true }
    );

    if (!plant) {
      return res.status(404).json({ message: 'Plant not found' });
    }

    res.json(plant);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// ==================== LEGACY METHODS (for backward compatibility) ====================

exports.getMoistureLevel = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const device = await Device.findOne({ deviceId });
    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }
    res.json({
      deviceId,
      moistureLevel: device.moistureLevel,
      lastUpdate: device.LastUpdated
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.updateSchedule = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { schedule } = req.body;

    const device = await Device.findOneAndUpdate(
      { deviceId },
      { $set: { schedule } },
      { new: true }
    );

    if (!device) {
      return res.status(404).json({ message: 'Device not found' });
    }

    res.json(device);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

exports.manualControl = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { action, duration, zone } = req.body;
    
    if (!['start', 'stop'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: "Action must be 'start' or 'stop'"
      });
    }

    // Find the device to check if in manual mode
    const device = await Device.findOne({ deviceId });
    
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }
    
    // Create the appropriate command
    const commandName = 'PUMP_CONTROL';
    const commandParams = {
      action: action === 'start' ? 'on' : 'off',
      duration: action === 'start' && duration ? duration : undefined,
      zone: zone || 1, // Default to zone 1 if not specified
      source: 'manual'
    };
    
    // Create device command record
    const command = new DeviceCommand({
      deviceId,
      command: commandName,
      parameters: commandParams,
      status: 'pending',
      executed: false
    });
    
    await command.save();
    
    // Publish to MQTT
    const mqttClient = req.app.get('mqttClient');
    
    if (mqttClient && mqttClient.connected) {
      const topic = `ecosprinkler/${deviceId}/commands/control`;
      
      // Enhanced JSON command structure
      const payload = JSON.stringify({
        command: 'manualControl',
        parameters: {
          pump: commandParams.action,
          duration: commandParams.duration || 0,
          zone: commandParams.zone || 1,
          source: 'manual'
        },
        messageId: command._id.toString(),
        timestamp: Date.now()
      });
      
      mqttClient.publish(topic, payload, { qos: 1 });
      console.log(`Published pump control command to ${topic}: ${payload}`);
    }
    
    // Update device status
    await Device.findOneAndUpdate(
      { deviceId },
      {
        $set: {
          'manualPumpState.active': action === 'start',
          'manualPumpState.lastChangedAt': new Date(),
          'manualPumpState.activeZone': action === 'start' ? (zone || 1) : null,
          LastUpdated: new Date()
        }
      }
    );
    
    res.json({
      success: true,
      message: `Pump ${action === 'start' ? 'started' : 'stopped'} successfully`,
      command: {
        id: command._id,
        status: 'pending',
        action: commandParams.action,
        zone: commandParams.zone || 1,
        duration: commandParams.duration || 0
      }
    });
  } catch (error) {
    console.error('Manual control error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to control pump',
      error: error.message
    });
  }
};