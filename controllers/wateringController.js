const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');
const mqtt = require('mqtt');

// MQTT Client Configuration
const DEFAULT_MQTT_BROKER = 'mqtt://test.mosquitto.org:1883';
let mqttBrokerUrl = process.env.MQTT_BROKER || DEFAULT_MQTT_BROKER;

// Validate and fix MQTT broker URL
if (mqttBrokerUrl && !mqttBrokerUrl.includes('://')) {
  // If protocol is missing, add it
  console.warn(`⚠️ MQTT_BROKER missing protocol, adding 'mqtt://' prefix: ${mqttBrokerUrl}`);
  mqttBrokerUrl = `mqtt://${mqttBrokerUrl}`;
}

let mqttClient = null;

// Initialize MQTT Client
function initMQTTClient() {
  if (!mqttClient) {
    try {
      console.log(`🔌 Connecting to MQTT broker: ${mqttBrokerUrl}`);
      mqttClient = mqtt.connect(mqttBrokerUrl, {
        clientId: `backend_watering_${Math.random().toString(16).substr(2, 8)}`,
        clean: true,
        reconnectPeriod: 1000,
      });

      mqttClient.on('connect', () => {
        console.log('🌐 Watering Controller MQTT Connected');
      });

      mqttClient.on('error', (err) => {
        console.error('❌ MQTT Error:', err);
      });
    } catch (error) {
      console.error('❌ Failed to initialize MQTT client:', error);
      // Return a mock client to prevent crashes
      mqttClient = {
        publish: (topic, payload, options, callback) => {
          console.warn(`⚠️ MQTT not connected, skipping publish to ${topic}`);
          if (callback) callback(null);
        }
      };
    }
  }
  return mqttClient;
}

// Publish MQTT Command to ESP32 and track in DeviceCommand
async function publishPumpCommand(deviceId, action, duration = 0, source = 'manual') {
  const client = initMQTTClient();
  const topic = `Ecosprinkle/${deviceId}/commands/pump`;
  
  // Create a device command record
  const command = new DeviceCommand({
    deviceId,
    command: 'PUMP_CONTROL',
    parameters: {
      action,
      duration,
      source
    },
    status: 'pending',
    executed: false
  });
  
  await command.save();
  
  const payload = JSON.stringify({
    action,      // 'on' or 'off'
    duration,    // seconds (0 = indefinite until manual off)
    source,      // 'manual', 'auto', 'schedule'
    timestamp: Date.now(),
    commandId: command._id
  });

  return new Promise((resolve, reject) => {
    // Add timeout to prevent hanging
    const timeout = setTimeout(() => {
      console.warn(`⚠️ MQTT publish timeout for ${topic}, resolving anyway`);
      resolve(command);
    }, 5000);
    
    client.publish(topic, payload, { qos: 1 }, (err) => {
      clearTimeout(timeout);
      if (err) {
        console.error(`❌ Failed to publish to ${topic}:`, err);
        // Don't reject - just resolve with command to allow mode switch to continue
        resolve(command);
      } else {
        console.log(`📤 Published to ${topic}: ${payload}`);
        resolve(command);
      }
    });
  });
}

/**
 * Switch Watering Mode (Auto/Manual/Schedule)
 * @route POST /api/devices/:deviceId/mode
 */
exports.switchMode = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { mode } = req.body; // 'auto', 'manual', 'schedule'
    const userID = req.user?.uid || req.body.userID;

    console.log(`🔄 Switching mode for device: ${deviceId}, Mode: ${mode}, UserID: ${userID || 'not provided'}`);

    // Validate mode
    if (!['auto', 'manual', 'schedule'].includes(mode)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid mode. Must be: auto, manual, or schedule'
      });
    }

    // Build flexible query
    let query = { deviceId };
    
    // Only add userID to query if it's provided
    if (userID) {
      query.userID = userID;
    }
    
    console.log('🔍 Device search query:', query);

    // Find device with more flexible query
    const device = await Device.findOne(query);
    if (!device) {
      console.log('❌ Device not found with query:', query);
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }
    
    console.log('✅ Device found:', device.deviceId);

    // Update mode
    device.wateringMode = mode;
    device.LastUpdated = new Date();

    // Initialize nested objects if they don't exist
    if (!device.manualPumpState) {
      device.manualPumpState = {
        active: false,
        lastChangedAt: null,
        lastChangedBy: null
      };
    }
    
    if (!device.scheduleMode) {
      device.scheduleMode = {
        isEnabled: false,
        isPaused: false,
        lastExecutedAt: null,
        nextScheduledAt: null,
        executionCount: 0
      };
    }

    // Create device command for mode switch
    const command = new DeviceCommand({
      deviceId,
      command: 'SET_WATERING_MODE',
      parameters: { mode },
      status: 'pending',
      executed: false
    });
    
    await command.save();
    
    // Publish command via MQTT
    const mqttTopic = `Ecosprinkle/${deviceId}/commands/control`;
    const mqttPayload = JSON.stringify({
      command: 'SET_WATERING_MODE',
      parameters: { mode },
      commandId: command._id,
      timestamp: Date.now()
    });
    
    const client = initMQTTClient();
    client.publish(mqttTopic, mqttPayload, { qos: 1 });

    // Mode-specific logic
    if (mode === 'manual') {
      // Reset manual state
      device.manualPumpState.active = false;
      device.manualPumpState.lastChangedAt = new Date();
      device.manualPumpState.lastChangedBy = userID;
      
      // Turn off pump when switching to manual (don't fail if this errors)
      try {
        await publishPumpCommand(deviceId, 'off', 0, 'mode_switch');
      } catch (pumpError) {
        console.warn('⚠️ Failed to publish pump command, but continuing:', pumpError.message);
      }
      
    } else if (mode === 'schedule') {
      // Enable schedule mode
      device.scheduleMode.isEnabled = true;
      device.scheduleMode.isPaused = false;
      
      // Calculate next scheduled time (only if schedules exist)
      if (device.schedules && device.schedules.length > 0) {
        try {
          const nextSchedule = calculateNextScheduledTime(device.schedules);
          device.scheduleMode.nextScheduledAt = nextSchedule;
        } catch (schedError) {
          console.warn('⚠️ Failed to calculate next schedule:', schedError.message);
          device.scheduleMode.nextScheduledAt = null;
        }
      } else {
        device.scheduleMode.nextScheduledAt = null;
      }
      
    } else if (mode === 'auto') {
      // Disable schedule mode
      device.scheduleMode.isEnabled = false;
      
      // Reset manual state
      device.manualPumpState.active = false;
    }

    console.log('💾 Saving device...');
    await device.save();
    console.log('✅ Device saved successfully');

    const response = {
      success: true,
      message: `Watering mode switched to: ${mode}`,
      data: {
        deviceId,
        wateringMode: device.wateringMode,
        manualState: device.manualPumpState,  
        scheduleState: device.scheduleMode
      },
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    };
    
    console.log('📤 Sending response:', JSON.stringify(response, null, 2));
    res.json(response);

  } catch (error) {
    console.error('❌ Error switching mode:', error);
    console.error('Error stack:', error.stack);
    const errorResponse = {
      success: false,
      message: 'Failed to switch watering mode',
      error: error.message,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    };
    console.error('📤 Sending error response:', errorResponse);
    res.status(500).json(errorResponse);
  }
};

/**
 * Manual Pump Control (On/Off)
 * @route POST /api/devices/:deviceId/pump
 */
exports.controlPump = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { action, duration = 0, source = 'manual' } = req.body; // action: 'on' or 'off'
    const userID = req.user?.uid || req.body.userID;

    console.log(`🚰 Controlling pump for device: ${deviceId}, Action: ${action}, Duration: ${duration}, Source: ${source}, UserID: ${userID || 'not provided'}`);

    // Validate action
    if (!['on', 'off'].includes(action)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid action. Must be: on or off'
      });
    }

    // Build flexible query
    let query = { deviceId };
    
    // Only add userID to query if it's provided
    if (userID) {
      query.userID = userID;
    }
    
    console.log('🔍 Device search query:', query);

    // Find device with more flexible query
    const device = await Device.findOne(query);
    if (!device) {
      console.log('❌ Device not found with query:', query);
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }
    
    console.log('✅ Device found:', device.deviceId);

    // Check if manual mode is active
    if (device.wateringMode !== 'manual') {
      return res.status(400).json({
        success: false,
        message: `Pump control only available in manual mode. Current mode: ${device.wateringMode}`
      });
    }

    // Initialize nested objects if they don't exist
    if (!device.manualPumpState) {
      device.manualPumpState = {
        active: false,
        lastChangedAt: null,
        lastChangedBy: null
      };
    }
    
    if (!device.sensorData) {
      device.sensorData = {
        pumpState: 0
      };
    }

    // Update device state
    device.manualPumpState.active = (action === 'on');
    device.manualPumpState.lastChangedAt = new Date();
    device.manualPumpState.lastChangedBy = userID;
    device.LastUpdated = new Date();

    // Update sensor data pump state
    device.sensorData.pumpState = (action === 'on') ? 1 : 0;

    await device.save();

    // Send MQTT command to ESP32 and store in DeviceCommand collection
    const command = await publishPumpCommand(deviceId, action, duration, source);

    res.json({
      success: true,
      message: `Pump turned ${action.toUpperCase()}`,
      data: {
        deviceId,
        pumpState: device.manualPumpState.active,
        action,
        duration,
        timestamp: device.manualPumpState.lastChangedAt
      },
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    });

  } catch (error) {
    console.error('Error controlling pump:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to control pump',
      error: error.message
    });
  }
};

/**
 * Get Current Watering State
 * @route GET /api/devices/:deviceId/watering-state
 */
exports.getWateringState = async (req, res) => {
  try {
    const { deviceId } = req.params;
    // Check multiple possible sources for userID to be more flexible
    const userID = req.user?.uid || req.user?.userId || req.query.userID || req.body?.userID;
    
    console.log('🔍 GET watering-state for device:', deviceId);
    console.log('👤 User ID from request:', userID);
    
    // Build flexible query - find device by deviceId only
    // The userID check is not strictly enforced to ensure compatibility with all frontend clients
    let query = { deviceId };
    
    // Only add userID to query if it exists, but don't make it required
    if (userID) {
      query.userID = userID;
    }
    
    console.log('🔍 Using query:', JSON.stringify(query));

    const device = await Device.findOne(query);
    if (!device) {
      console.log('❌ Device not found:', deviceId);
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Safely access nested properties with fallbacks
    const sensorData = device.sensorData || {};
    const manualPumpState = device.manualPumpState || { active: false };
    const scheduleMode = device.scheduleMode || { 
      isEnabled: false, 
      isPaused: false, 
      executionCount: 0 
    };

    res.json({
      success: true,
      data: {
        deviceId,
        wateringMode: device.wateringMode || 'auto',
        manualState: {
          active: manualPumpState.active || false,
          lastChangedAt: manualPumpState.lastChangedAt || null,
          lastChangedBy: manualPumpState.lastChangedBy || null
        },
        scheduleState: {
          isEnabled: scheduleMode.isEnabled || false,
          isPaused: scheduleMode.isPaused || false,
          lastExecutedAt: scheduleMode.lastExecutedAt || null,
          nextScheduledAt: scheduleMode.nextScheduledAt || null,
          executionCount: scheduleMode.executionCount || 0
        },
        schedules: device.schedules || [],
        currentPumpState: sensorData.pumpState || 0,
        sensorVoting: {
          majorityVoteDry: sensorData.majorityVoteDry || false,
          dryVotes: sensorData.dryVotes || 0,
          wetVotes: sensorData.wetVotes || 0,
          validSensors: sensorData.validSensors || 0
        }
      }
    });

  } catch (error) {
    console.error('❌ Error getting watering state:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get watering state',
      error: error.message
    });
  }
};

/**
 * Create/Update Schedule
 * @route POST /api/devices/:deviceId/schedules
 */
exports.upsertSchedule = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { schedules } = req.body; // Array of schedule objects
    const userID = req.user?.uid || req.body?.userID;

    // Validate schedules
    if (!Array.isArray(schedules) || schedules.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Schedules must be a non-empty array'
      });
    }

    // Build flexible query
    let query = { deviceId };
    
    // Only add userID to query if it's provided
    if (userID) {
      query.userID = userID;
    }
    
    console.log('🔍 Device search query for schedule update:', query);

    // Find device with more flexible query
    const device = await Device.findOne(query);
    if (!device) {
      console.log('❌ Device not found with query:', query);
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Replace all schedules
    device.schedules = schedules.map(s => ({
      timeSlotId: s.timeSlotId || `slot_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      time: s.time,
      duration: s.duration,
      daysOfWeek: s.daysOfWeek,
      isActive: s.isActive !== undefined ? s.isActive : true,
      createdAt: s.createdAt || new Date()
    }));

    // Calculate next scheduled time
    const nextSchedule = calculateNextScheduledTime(device.schedules);
    device.scheduleMode.nextScheduledAt = nextSchedule;
    device.scheduleMode.isEnabled = true;
    device.LastUpdated = new Date();

    const client = initMQTTClient();
    const mqttTopic = `Ecosprinkle/${deviceId}/commands/control`;
    
    // 🚨 CRITICAL FIX: Send ONE ADD_SCHEDULE command per day
    const commandPromises = [];
    let totalCommands = 0;
    
    for (const schedule of device.schedules) {
      const [hour, minute] = schedule.time.split(':').map(Number);
      
      // For EACH day in daysOfWeek, send separate ADD_SCHEDULE command
      for (const dayOfWeek of schedule.daysOfWeek) {
        const scheduleId = `${schedule.timeSlotId}_day${dayOfWeek}`;
        
        // Create device command record
        const command = new DeviceCommand({
          deviceId,
          command: 'ADD_SCHEDULE',
          parameters: { 
            scheduleId: scheduleId,
            dayOfWeek: dayOfWeek,  // Single day (1-7, or 0-6 for ESP32)
            hour: hour,
            minute: minute,
            duration: schedule.duration,
            active: schedule.isActive  // 🚨 FIX: ESP32 expects "active" not "isActive"
          },
          status: 'pending',
          executed: false
        });
        
        await command.save();
        
        // Publish to MQTT with correct ESP32 format
        const mqttPayload = JSON.stringify({
          command: 'ADD_SCHEDULE',
          parameters: {
            scheduleId: scheduleId,
            dayOfWeek: dayOfWeek,
            hour: hour,
            minute: minute,
            duration: schedule.duration,
            active: schedule.isActive  // 🚨 FIX: ESP32 expects "active" not "isActive"
          },
          messageId: command._id.toString(),
          timestamp: Date.now()
        });
        
        console.log(`📤 Publishing ADD_SCHEDULE for day ${dayOfWeek}: ${mqttPayload}`);
        
        const publishPromise = new Promise((resolve) => {
          client.publish(mqttTopic, mqttPayload, { qos: 1 }, (err) => {
            if (err) {
              console.error(`❌ Failed to publish schedule for day ${dayOfWeek}:`, err);
            } else {
              console.log(`✅ Published schedule for day ${dayOfWeek}`);
            }
            resolve();
          });
        });
        
        commandPromises.push(publishPromise);
        totalCommands++;
      }
    }
    
    // Wait for all MQTT publishes to complete
    await Promise.all(commandPromises);
    console.log(`✅ Published ${totalCommands} schedule commands to ESP32`);
    
    // 🚨 CRITICAL: Add delay to ensure ESP32 processes all ADD_SCHEDULE commands
    // before receiving SET_WATERING_MODE command
    console.log('⏳ Waiting 500ms for ESP32 to process schedules...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
    await device.save();

    res.json({
      success: true,
      message: 'Schedules updated successfully',
      data: {
        deviceId,
        schedules: device.schedules,
        nextScheduledAt: device.scheduleMode.nextScheduledAt,
        mqttCommandsSent: totalCommands
      }
    });

  } catch (error) {
    console.error('Error updating schedules:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update schedules',
      error: error.message
    });
  }
};

/**
 * Update Schedule Status (enable/disable)
 * @route PATCH /api/devices/:deviceId/schedules/:scheduleId
 */
exports.updateScheduleStatus = async (req, res) => {
  try {
    const { deviceId, scheduleId } = req.params;
    const { isActive } = req.body;
    const userID = req.user?.uid || req.body?.userID;
    
    if (isActive === undefined) {
      return res.status(400).json({
        success: false,
        message: 'isActive status is required'
      });
    }

    // Build flexible query
    let query = { deviceId };
    
    // Only add userID to query if it's provided
    if (userID) {
      query.userID = userID;
    }

    const device = await Device.findOne(query);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Find and update the specific schedule
    const scheduleIndex = device.schedules.findIndex(
      s => s.timeSlotId === scheduleId
    );

    if (scheduleIndex === -1) {
      return res.status(404).json({
        success: false,
        message: 'Schedule not found'
      });
    }

    // Update the schedule
    device.schedules[scheduleIndex].isActive = isActive;
    device.LastUpdated = new Date();

    // If we're enabling a schedule, make sure scheduleMode is enabled
    if (isActive) {
      device.scheduleMode.isEnabled = true;
    }
    
    // Recalculate next scheduled time
    device.scheduleMode.nextScheduledAt = calculateNextScheduledTime(device.schedules);
    
    // Create device command for updating the schedule status
    const command = new DeviceCommand({
      deviceId,
      command: 'UPDATE_SCHEDULE_STATUS',
      parameters: { 
        scheduleId: device.schedules[scheduleIndex].timeSlotId,
        enabled: isActive,
        schedule: {
          day: device.schedules[scheduleIndex].daysOfWeek[0], // Format for ESP32
          hour: parseInt(device.schedules[scheduleIndex].time.split(':')[0]),
          minute: parseInt(device.schedules[scheduleIndex].time.split(':')[1]),
          duration: device.schedules[scheduleIndex].duration,
        }
      },
      status: 'pending',
      executed: false
    });
    
    await command.save();
    
    // Publish command via MQTT
    const mqttTopic = `Ecosprinkle/${deviceId}/commands/control`;
    const mqttPayload = JSON.stringify({
      command: 'UPDATE_SCHEDULE_STATUS',
      parameters: command.parameters,
      commandId: command._id,
      timestamp: Date.now()
    });
    
    const client = initMQTTClient();
    client.publish(mqttTopic, mqttPayload, { qos: 1 });
    
    await device.save();

    res.json({
      success: true,
      message: 'Schedule status updated successfully',
      data: {
        scheduleId,
        isActive,
        nextScheduledAt: device.scheduleMode.nextScheduledAt
      },
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    });

  } catch (error) {
    console.error('Error updating schedule status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update schedule status',
      error: error.message
    });
  }
};

/**
 * Update Schedule Execution Status
 * @route POST /api/devices/:deviceId/schedule-status
 */
exports.updateScheduleExecution = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { scheduleId, status, executionTime, waterUsed } = req.body;
    
    // Validate required fields
    if (!scheduleId || !status) {
      return res.status(400).json({
        success: false,
        message: 'scheduleId and status are required'
      });
    }

    // Validate status
    if (!['completed', 'started', 'failed', 'skipped'].includes(status)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid status. Must be: completed, started, failed, or skipped'
      });
    }

    // Build query to find device
    let query = { deviceId };
    
    // Find device
    const device = await Device.findOne(query);
    if (!device) {
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Find the schedule by ID
    const scheduleIndex = device.schedules.findIndex(
      s => s.timeSlotId === scheduleId
    );

    // If schedule exists, update its execution status
    if (scheduleIndex !== -1) {
      device.schedules[scheduleIndex].lastExecution = {
        status,
        executedAt: executionTime || new Date(),
        waterUsed: waterUsed || 0
      };
    }

    // Update device schedule mode
    device.scheduleMode.lastExecutedAt = executionTime || new Date();
    device.scheduleMode.executionCount += 1;
    device.LastUpdated = new Date();
    
    // Create device command record
    const command = new DeviceCommand({
      deviceId,
      command: 'SCHEDULE_EXECUTION',
      parameters: { 
        scheduleId,
        status,
        executionTime: executionTime || new Date(),
        waterUsed: waterUsed || 0
      },
      status: 'completed', // This is a notification, not a command
      executed: true,
      executedAt: new Date()
    });
    
    await command.save();
    
    // Save device updates
    await device.save();

    res.json({
      success: true,
      message: `Schedule execution status updated to ${status}`,
      data: {
        deviceId,
        scheduleId,
        status,
        executionTime: executionTime || new Date(),
        waterUsed: waterUsed || 0
      },
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    });

  } catch (error) {
    console.error('Error updating schedule execution status:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update schedule execution status',
      error: error.message
    });
  }
};

/**
 * Delete Schedule
 * @route DELETE /api/devices/:deviceId/schedules/:timeSlotId
 */
exports.deleteSchedule = async (req, res) => {
  try {
    const { deviceId, timeSlotId } = req.params;
    const userID = req.user?.uid || req.query?.userID;

    // Build flexible query
    let query = { deviceId };
    
    // Only add userID to query if it's provided
    if (userID) {
      query.userID = userID;
    }
    
    console.log('🔍 Device search query for schedule deletion:', query);

    // Find device with more flexible query
    const device = await Device.findOne(query);
    if (!device) {
      console.log('❌ Device not found with query:', query);
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Remove schedule
    device.schedules = device.schedules.filter(s => s.timeSlotId !== timeSlotId);
    
    // Recalculate next scheduled time
    if (device.schedules.length > 0) {
      const nextSchedule = calculateNextScheduledTime(device.schedules);
      device.scheduleMode.nextScheduledAt = nextSchedule;
    } else {
      device.scheduleMode.isEnabled = false;
      device.scheduleMode.nextScheduledAt = null;
    }

    // Create device command for deleting the schedule
    const command = new DeviceCommand({
      deviceId,
      command: 'DELETE_SCHEDULE',
      parameters: { 
        scheduleId: timeSlotId
      },
      status: 'pending',
      executed: false
    });
    
    await command.save();
    
    // Publish command via MQTT
    const mqttTopic = `Ecosprinkle/${deviceId}/commands/control`;
    const mqttPayload = JSON.stringify({
      command: 'DELETE_SCHEDULE',
      parameters: { scheduleId: timeSlotId },
      commandId: command._id,
      timestamp: Date.now()
    });
    
    const client = initMQTTClient();
    client.publish(mqttTopic, mqttPayload, { qos: 1 });

    device.LastUpdated = new Date();
    await device.save();

    res.json({
      success: true,
      message: 'Schedule deleted successfully',
      data: {
        deviceId,
        remainingSchedules: device.schedules.length
      },
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    });

  } catch (error) {
    console.error('Error deleting schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete schedule',
      error: error.message
    });
  }
};

/**
 * Cancel All Schedules
 * @route POST /api/devices/:deviceId/schedule/cancel
 */
exports.cancelAllSchedules = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userID = req.user?.uid || req.body?.userID;

    // Build flexible query
    let query = { deviceId };
    
    // Only add userID to query if it's provided
    if (userID) {
      query.userID = userID;
    }
    
    console.log('🗑️ Cancelling all schedules for device:', deviceId);

    // Find device
    const device = await Device.findOne(query);
    if (!device) {
      console.log('❌ Device not found with query:', query);
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    // Clear all schedules
    const schedulesCount = device.schedules ? device.schedules.length : 0;
    device.schedules = [];
    device.scheduleMode.isEnabled = false;
    device.scheduleMode.isPaused = false;
    device.scheduleMode.nextScheduledAt = null;
    device.LastUpdated = new Date();
    
    // Switch back to auto mode
    device.wateringMode = 'auto';
    
    // Create device command
    const command = new DeviceCommand({
      deviceId,
      command: 'CANCEL_ALL_SCHEDULES',
      parameters: { 
        cancelledCount: schedulesCount
      },
      status: 'pending',
      executed: false
    });
    
    await command.save();
    
    // Publish command via MQTT to ESP32
    const mqttTopic = `Ecosprinkle/${deviceId}/commands/control`;
    const mqttPayload = JSON.stringify({
      command: 'CANCEL_ALL_SCHEDULES',
      parameters: {},
      messageId: command._id.toString(),
      timestamp: Date.now()
    });
    
    const client = initMQTTClient();
    client.publish(mqttTopic, mqttPayload, { qos: 1 });
    
    console.log(`✅ Cancelled ${schedulesCount} schedules for device ${deviceId}`);
    
    await device.save();

    res.json({
      success: true,
      message: `All schedules cancelled (${schedulesCount} removed)`,
      data: {
        deviceId,
        cancelledCount: schedulesCount,
        wateringMode: device.wateringMode
      },
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    });

  } catch (error) {
    console.error('Error cancelling all schedules:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to cancel all schedules',
      error: error.message
    });
  }
};

/**
 * Pause/Resume Schedule Mode
 * @route POST /api/devices/:deviceId/schedule/pause
 */
exports.pauseResumeSchedule = async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { paused } = req.body; // boolean
    const userID = req.user?.uid || req.body?.userID;

    // Build flexible query
    let query = { deviceId };
    
    // Only add userID to query if it's provided
    if (userID) {
      query.userID = userID;
    }
    
    console.log('🔍 Device search query for schedule pause/resume:', query);

    // Find device with more flexible query
    const device = await Device.findOne(query);
    if (!device) {
      console.log('❌ Device not found with query:', query);
      return res.status(404).json({
        success: false,
        message: 'Device not found'
      });
    }

    device.scheduleMode.isPaused = paused;
    device.LastUpdated = new Date();
    
    // Create device command for pausing/resuming the schedule
    const command = new DeviceCommand({
      deviceId,
      command: paused ? 'PAUSE_SCHEDULE' : 'RESUME_SCHEDULE',
      parameters: { 
        isPaused: paused
      },
      status: 'pending',
      executed: false
    });
    
    await command.save();
    
    // Publish command via MQTT
    const mqttTopic = `Ecosprinkle/${deviceId}/commands/control`;
    const mqttPayload = JSON.stringify({
      command: paused ? 'PAUSE_SCHEDULE' : 'RESUME_SCHEDULE',
      parameters: { isPaused: paused },
      commandId: command._id,
      timestamp: Date.now()
    });
    
    const client = initMQTTClient();
    client.publish(mqttTopic, mqttPayload, { qos: 1 });
    
    await device.save();

    res.json({
      success: true,
      message: `Schedule ${paused ? 'paused' : 'resumed'}`,
      data: {
        deviceId,
        isPaused: device.scheduleMode.isPaused
      },
      command: {
        id: command._id,
        status: command.status,
        timestamp: command.timestamp
      }
    });

  } catch (error) {
    console.error('Error pausing/resuming schedule:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to pause/resume schedule',
      error: error.message
    });
  }
};

/**
 * Helper: Calculate Next Scheduled Time
 */
function calculateNextScheduledTime(schedules) {
  if (!schedules || schedules.length === 0) return null;

  const now = new Date();
  const currentDay = now.getDay(); // 0-6 (Sun-Sat)
  const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  let nextSchedule = null;
  let minDiff = Infinity;

  schedules.forEach(schedule => {
    if (!schedule.isActive) return;

    schedule.daysOfWeek.forEach(day => {
      const [hours, minutes] = schedule.time.split(':').map(Number);
      
      // Calculate days until this schedule
      let daysUntil = day - currentDay;
      if (daysUntil < 0) daysUntil += 7;
      if (daysUntil === 0 && schedule.time <= currentTime) daysUntil = 7;

      // Calculate exact datetime
      const scheduledDate = new Date(now);
      scheduledDate.setDate(scheduledDate.getDate() + daysUntil);
      scheduledDate.setHours(hours, minutes, 0, 0);

      const diff = scheduledDate - now;
      if (diff > 0 && diff < minDiff) {
        minDiff = diff;
        nextSchedule = scheduledDate;
      }
    });
  });

  return nextSchedule;
}

module.exports = exports;
