require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const aedes = require('aedes')();
const net = require('net');
const mqttServer = net.createServer({
  allowHalfOpen: false
}, aedes.handle);
const mqtt = require('mqtt');
const authController = require('./controllers/authController');
const deviceController = require('./controllers/deviceController');
const sensorController = require('./controllers/sensorController');
const authMiddleware = require('./middleware/auth');

// NEW: Import passport configuration
const passport = require('./config/passport');

const app = express();
const server = http.createServer(app);
const io = socketIO(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Store io instance for use in controllers
app.set('io', io);

// Connection Status Verification System
const connectionStatus = {
  secureCloudBackend: {
    isRunning: false,
    lastHeartbeat: null,
    mqttConnected: false,
    esp32Connected: false,
    dataReceived: false,
    lastDataTimestamp: null
  },
  localMqttBroker: {
    isRunning: false,
    port: null,
    clientsConnected: 0
  }
};

// Function to check secure cloud backend status
async function checkSecureCloudBackendStatus() {
  return new Promise((resolve) => {
    const req = http.request({
      hostname: 'localhost',
      port: 3001,
      path: '/api/status',
      method: 'GET',
      timeout: 5000
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          connectionStatus.secureCloudBackend.isRunning = true;
          connectionStatus.secureCloudBackend.lastHeartbeat = Date.now();
          connectionStatus.secureCloudBackend.mqttConnected = parsed.mqttConnected;
          
          console.log('✅ Secure Cloud Backend Status:', {
            running: true,
            mqttConnected: parsed.mqttConnected,
            timestamp: new Date().toISOString()
          });
          
          resolve(parsed);
        } catch (error) {
          connectionStatus.secureCloudBackend.isRunning = false;
          console.log('❌ Secure Cloud Backend Status: Parse Error');
          resolve(null);
        }
      });
    });
    
    req.on('error', () => {
      connectionStatus.secureCloudBackend.isRunning = false;
      console.log('❌ Secure Cloud Backend Status: Offline');
      resolve(null);
    });
    
    req.on('timeout', () => {
      connectionStatus.secureCloudBackend.isRunning = false;
      console.log('❌ Secure Cloud Backend Status: Timeout');
      resolve(null);
    });
    
    req.end();
  });
}

// Monitor secure cloud backend every 30 seconds
setInterval(checkSecureCloudBackendStatus, 30000);

// Initial check after 5 seconds
setTimeout(checkSecureCloudBackendStatus, 5000);

// MQTT Broker on port 1883 (standard MQTT port)
const mqttPort = process.env.MQTT_PORT || 1883;

mqttServer.on('error', (err) => {
  console.error('MQTT Server Error:', err);
});

mqttServer.on('listening', () => {
  console.log('MQTT Server started listening on', mqttServer.address());
});

mqttServer.on('connection', (socket) => {
  console.log('🔌 New TCP connection from:', socket.remoteAddress, socket.remotePort);
  
  socket.on('error', (err) => {
    console.error('❌ Socket error:', err);
  });
  
  socket.on('close', () => {
    console.log('🔌 Socket closed from:', socket.remoteAddress, socket.remotePort);
  });
  
  socket.on('data', (data) => {
    console.log('📨 Raw data from', socket.remoteAddress + ':', data.toString().substring(0, 100));
  });
});

let mqttClient = null;

// Import watering decision engine
const wateringEngine = require('./services/wateringDecisionEngine');

mqttServer.listen(mqttPort, '0.0.0.0', function () {
  console.log(`MQTT Broker running on port ${mqttPort} (all interfaces)`);
  console.log(`MQTT Broker address: ${mqttServer.address().address}:${mqttServer.address().port}`);
  console.log('MQTT Server listening and ready for connections');
  
  // Create the internal MQTT client after the server is fully listening
  setTimeout(() => {
    console.log('Creating internal MQTT client...');
    mqttClient = mqtt.connect(`mqtt://localhost:${mqttPort}`);
    
    mqttClient.on('connect', () => {
      console.log('Backend MQTT client connected to internal broker');
      
      // Set MQTT client in watering engine for sending commands
      wateringEngine.setMqttClient(mqttClient);
      console.log('✅ Watering Decision Engine initialized');
    });
    
    mqttClient.on('error', (error) => {
      console.error('Backend MQTT client error:', error);
    });
    
    // Store MQTT client for use in controllers
    app.set('mqttClient', mqttClient);
  }, 1000);
});

// MQTT Client Connections
aedes.on('client', function (client) {
  console.log('🎯 MQTT Client Connected:', client.id);
  connectionStatus.localMqttBroker.clientsConnected++;
  
  if (client.id.includes('ESP32')) {
    console.log('🚀 ESP32 Device Connected Successfully!');
    connectionStatus.secureCloudBackend.esp32Connected = true;
  }
  
  // Update connection status
  connectionStatus.localMqttBroker.isRunning = true;
  connectionStatus.localMqttBroker.port = mqttPort;
});

aedes.on('clientDisconnect', function (client) {
  console.log('🔌 MQTT Client Disconnected:', client.id);
  connectionStatus.localMqttBroker.clientsConnected--;
  
  if (client.id.includes('ESP32')) {
    console.log('⚠️ ESP32 Device Disconnected');
    connectionStatus.secureCloudBackend.esp32Connected = false;
  }
});

// Handle MQTT Messages from ESP32
aedes.on('publish', async function (packet, client) {
  const topic = packet.topic;
  const payload = packet.payload.toString();
  
  console.log('MQTT Message:', topic, payload);
  
  try {
    // Handle ESP32 direct publish: Ecosprinkle/{deviceId}/sensors/data
    if (topic.match(/^Ecosprinkle\/[^\/]+\/sensors\/data$/)) {
      const topicParts = topic.split('/');
      const deviceId = topicParts[1]; // Extract deviceId from topic
      const data = JSON.parse(payload);
      
      // Ensure deviceId is in the payload
      data.deviceId = data.deviceId || deviceId;
      
      // Update connection status - data received
      connectionStatus.secureCloudBackend.dataReceived = true;
      connectionStatus.secureCloudBackend.lastDataTimestamp = Date.now();
      
      console.log('🌱 FINAL DEFENSE - CALIBRATED SENSOR DATA RECEIVED:');
      console.log('   Device: ' + data.deviceId + ' | Topic: ' + topic);
      console.log('   ============ INDIVIDUAL ZONE READINGS ============');
      console.log('   Zone 1 (Lettuce): ' + (data.zone1 || 'N/A') + ' ADC → ' + (data.zone1Percent || 'N/A') + '%');
      console.log('   Zone 2 (Tomatoes): ' + (data.zone2 || 'N/A') + ' ADC → ' + (data.zone2Percent || 'N/A') + '%');
      console.log('   Zone 3 (Root veg): ' + (data.zone3 || 'N/A') + ' ADC → ' + (data.zone3Percent || 'N/A') + '%');
      console.log('   ============ MAJORITY VOTING RESULTS ============');
      console.log('   DRY votes: ' + (data.dryVotes || 0) + ' | WET votes: ' + (data.wetVotes || 0));
      console.log('   Decision: ' + (data.majorityVoteDry ? '🚰 WATER NEEDED' : '💧 NO WATER NEEDED'));
      console.log('   Valid sensors: ' + (data.validSensors || 0) + '/3 | Health: ' + (data.sensorHealth || 'unknown'));
      console.log('   ============ SYSTEM STATUS ============');
      console.log('   Pump: ' + (data.pumpState === 1 ? 'ON' : 'OFF') + ' | Mode: ' + (data.wateringMode || 'auto'));
      console.log('   RSSI: ' + (data.rssi || 'N/A') + ' dBm | Time: ' + new Date().toISOString());
      
      // Auto-register device if not exists
      try {
        const Device = require('./models/Device');
        let device = await Device.findOne({ deviceId: data.deviceId });
        if (!device) {
          // Device not found - could be deleted or never registered
          console.log(`⚠️ Device ${data.deviceId} not found in database`);
          console.log(`📡 Sending DEVICE_DELETED signal to ESP32...`);
          
          // Send deletion notification to ESP32 via MQTT
          const deletionMessage = {
            command: 'DEVICE_DELETED',
            deviceId: data.deviceId,
            message: 'Device was removed. Please reset to factory settings.',
            timestamp: new Date().toISOString()
          };
          
          mqttClient.publish(
            `Ecosprinkle/${data.deviceId}/commands/control`,
            JSON.stringify(deletionMessage),
            { qos: 1, retain: false },
            (err) => {
              if (err) {
                console.error('❌ Failed to send deletion notification:', err);
              } else {
                console.log(`✅ Sent DEVICE_DELETED to ${data.deviceId}`);
              }
            }
          );
          
          // DO NOT auto-register - require manual re-registration via app
          console.log(`🔒 Device ${data.deviceId} must be manually re-registered`);
        } else {
          // Update last seen timestamp
          await Device.updateOne(
            { deviceId: data.deviceId },
            { $set: { lastSeen: new Date() } }
          );
        }
      } catch (regError) {
        console.error('❌ Error with device registration:', regError);
      }
      
      // Store sensor data in database
      await storeSensorData(data);
      // Emit to WebSocket clients
      io.to(data.deviceId).emit('sensorData', data);
    }
    // Legacy format: Ecosprinkle/sensors/data (keep for compatibility)
    else if (topic === 'Ecosprinkle/sensors/data') {
      const data = JSON.parse(payload);
      
      // Update connection status - data received
      connectionStatus.secureCloudBackend.dataReceived = true;
      connectionStatus.secureCloudBackend.lastDataTimestamp = Date.now();
      
      console.log('🌱 Legacy MQTT: Sensor data received:', {
        deviceId: data.deviceId,
        source: 'Legacy format'
      });
      
      // Store sensor data in database
      await storeSensorData(data);
      // Emit to WebSocket clients
      io.to(data.deviceId).emit('sensorData', data);
    } else if (topic.startsWith('devices/') && topic.includes('/responses')) {
      // Handle command responses from devices
      const topicParts = topic.split('/');
      const deviceId = topicParts[1];
      const responseData = JSON.parse(payload);
      
      // Update command status based on response
      if (responseData.commandId && responseData.status) {
        const DeviceCommand = require('./models/DeviceCommand');
        const updateData = {
          status: responseData.status,
          executed: responseData.status === 'executed',
          executedAt: responseData.status === 'executed' ? new Date() : undefined,
          response: responseData.response || {},
          failedAt: responseData.status === 'failed' ? new Date() : undefined,
          error: responseData.status === 'failed' ? responseData.error : undefined
        };
        
        await DeviceCommand.findByIdAndUpdate(responseData.commandId, { $set: updateData });
        console.log(`Command ${responseData.commandId} updated with status: ${responseData.status}`);
        
        // Emit response via WebSocket
        io.emit(`command-response:${deviceId}`, {
          commandId: responseData.commandId,
          status: responseData.status,
          response: responseData.response
        });
      }
    }

    // NEW: MQTT-API Bridge for Irrigation Status and Logging
    // Handle irrigation status updates from devices
    if (topic.startsWith('Ecosprinkle/irrigation/')) {
      const topicParts = topic.split('/');
      const deviceId = topicParts[2];
      const eventType = topicParts[3]; // status, command, error

      if (eventType === 'status') {
        const statusData = JSON.parse(payload);
        await storeIrrigationStatus(deviceId, statusData);
        // Emit to WebSocket clients
        io.to(deviceId).emit('irrigationStatus', { deviceId, ...statusData });
      }
    }

    // Handle sensor data logging
    if (topic.startsWith('Ecosprinkle/sensors/')) {
      const topicParts = topic.split('/');
      const deviceId = topicParts[2];
      const dataType = topicParts[3]; // data, alert, error

      if (dataType === 'data') {
        const sensorData = JSON.parse(payload);
        await logSensorData(deviceId, sensorData);
      } else if (dataType === 'alert') {
        const alertData = JSON.parse(payload);
        await logSystemEvent(deviceId, 'alert', alertData);
      } else if (dataType === 'error') {
        const errorData = JSON.parse(payload);
        await logSystemEvent(deviceId, 'error', errorData);
      }
    }

    // Handle device command acknowledgments
    if (topic.startsWith('Ecosprinkle/commands/')) {
      const topicParts = topic.split('/');
      const deviceId = topicParts[2];
      const commandId = topicParts[3];

      const ackData = JSON.parse(payload);
      await logSystemEvent(deviceId, 'command_ack', { commandId, ...ackData });
    }

    // ============ V2.0 ARCHITECTURE HANDLERS ============
    // Handle sensor data from v2.0 firmware: ecosprinkle/{deviceId}/sensor
    if (topic.match(/^ecosprinkle\/[^\/]+\/sensor$/)) {
      const topicParts = topic.split('/');
      const deviceId = topicParts[1];
      const sensorData = JSON.parse(payload);
      
      console.log(`📥 V2.0: Received sensor data from ${deviceId}`);
      
      // Let decision engine handle all logic
      await wateringEngine.processSensorData(deviceId, sensorData);
    }
    // Handle command acknowledgments from v2.0 firmware: ecosprinkle/{deviceId}/ack
    else if (topic.match(/^ecosprinkle\/[^\/]+\/ack$/)) {
      const topicParts = topic.split('/');
      const deviceId = topicParts[1];
      const ack = JSON.parse(payload);
      
      console.log(`✅ V2.0: Command ${ack.commandId} acknowledged: ${ack.status}`);
      
      // Update device state
      const Device = require('./models/Device');
      await Device.findOneAndUpdate(
        { deviceId },
        { 
          isPumpOn: ack.pumpState,
          lastAck: new Date(),
          lastAckMessage: ack.message
        }
      );
    }
    // Handle device status updates from v2.0 firmware: ecosprinkle/{deviceId}/status
    else if (topic.match(/^ecosprinkle\/[^\/]+\/status$/)) {
      const topicParts = topic.split('/');
      const deviceId = topicParts[1];
      const status = JSON.parse(payload);
      
      console.log(`📡 V2.0: Device ${deviceId} status: ${status.online ? 'ONLINE' : 'OFFLINE'}`);
      
      const Device = require('./models/Device');
      await Device.findOneAndUpdate(
        { deviceId },
        { 
          isOnline: status.online,
          lastSeen: new Date()
        }
      );
      
      // Send config when device comes online
      if (status.online) {
        setTimeout(() => {
          wateringEngine.sendDeviceConfig(deviceId);
        }, 2000); // Wait 2 seconds for device to be ready
      }
    }

  } catch (error) {
    console.error('MQTT message processing error:', error);
  }
});

// ============ FINAL DEFENSE REVISION: ENHANCED SENSOR DATA PROCESSING ============
// Function to store calibrated sensor data with individual zone processing
async function storeSensorData(data) {
  try {
    const Device = require('./models/Device');
    const SensorData = require('./models/SensorData');
    
    // Get device calibration settings
    const device = await Device.findOne({ deviceId: data.deviceId });
    
    // ENHANCED DATA PROCESSING: Handle individual zone data with calibration
    if (data.zone1Percent !== undefined && data.zone2Percent !== undefined && data.zone3Percent !== undefined) {
      console.log('🌱 Processing CALIBRATED sensor data from ESP32:');
      console.log('   Zone 1: ' + data.zone1 + ' ADC → ' + data.zone1Percent + '%');
      console.log('   Zone 2: ' + data.zone2 + ' ADC → ' + data.zone2Percent + '%');
      console.log('   Zone 3: ' + data.zone3 + ' ADC → ' + data.zone3Percent + '%');
      console.log('   Majority Decision: ' + (data.majorityVoteDry ? 'WATER NEEDED' : 'NO WATER NEEDED'));
      console.log('   Valid Sensors: ' + data.validSensors + '/3, Health: ' + data.sensorHealth);
      
      // Calculate overall moisture level (average of valid sensors)
      let overallMoisture = 0;
      let validZones = 0;
      
      if (data.zone1Percent !== undefined) {
        overallMoisture += data.zone1Percent;
        validZones++;
      }
      if (data.zone2Percent !== undefined) {
        overallMoisture += data.zone2Percent;
        validZones++;
      }
      if (data.zone3Percent !== undefined) {
        overallMoisture += data.zone3Percent;
        validZones++;
      }
      
      overallMoisture = validZones > 0 ? Math.round(overallMoisture / validZones) : 0;
      
      // Determine soil status based on calibrated percentage readings
      let soilStatus = 'Unknown';
      if (overallMoisture >= 80) soilStatus = 'Well Watered';
      else if (overallMoisture >= 60) soilStatus = 'Adequately Moist';
      else if (overallMoisture >= 40) soilStatus = 'Slightly Dry';
      else if (overallMoisture >= 20) soilStatus = 'Dry - Needs Water';
      else soilStatus = 'Very Dry - Urgent';
      
      // Store enhanced sensor data with individual zone information
      const sensorData = new SensorData({
        deviceId: data.deviceId,
        timestamp: new Date(data.timestamp || Date.now()),
        // Individual zone data (RAW ADC)
        zone1: data.zone1 || 0,
        zone2: data.zone2 || 0,
        zone3: data.zone3 || 0,
        // Individual zone percentages (CALIBRATED)
        zone1Percent: data.zone1Percent || 0,
        zone2Percent: data.zone2Percent || 0,
        zone3Percent: data.zone3Percent || 0,
        // Overall system data
        moistureLevel: overallMoisture,
        moisturePercent: overallMoisture,
        soilStatus: soilStatus,
        // Voting system results
        dryVotes: data.dryVotes || 0,
        wetVotes: data.wetVotes || 0,
        majorityVoteDry: data.majorityVoteDry || false,
        validSensors: data.validSensors || 0,
        sensorHealth: data.sensorHealth || 'unknown',
        // Device status
        isWatering: data.pumpState === 1 || false,
        pumpStatus: data.pumpState === 1 ? 'ON' : 'OFF',
        wateringMode: data.wateringMode || 'auto',
        deviceStatus: 'Online',
        rssi: data.rssi || 0,
        // Legacy compatibility
        median: data.median || 0,
        batteryLevel: data.batteryPercentage || 100,
        temperature: data.temperature || null
      });
      
      await sensorData.save();
      
      // Update device's real-time sensor data
      if (device) {
        await Device.findOneAndUpdate(
          { deviceId: data.deviceId },
          {
            $set: {
              'sensorData.zone1': data.zone1,
              'sensorData.zone2': data.zone2,
              'sensorData.zone3': data.zone3,
              'sensorData.zone1Percent': data.zone1Percent,
              'sensorData.zone2Percent': data.zone2Percent,
              'sensorData.zone3Percent': data.zone3Percent,
              'sensorData.dryVotes': data.dryVotes,
              'sensorData.wetVotes': data.wetVotes,
              'sensorData.majorityVoteDry': data.majorityVoteDry,
              'sensorData.validSensors': data.validSensors,
              'sensorData.sensorHealth': data.sensorHealth,
              'sensorData.pumpState': data.pumpState,
              'sensorData.rssi': data.rssi,
              'sensorData.receivedAt': new Date(),
              'lastSensorUpdate': new Date(),
              'moistureLevel': overallMoisture,
              'Status': 'Online',
              'LastUpdated': new Date()
            }
          }
        );
      }
      
      console.log('💾 Enhanced calibrated sensor data stored successfully!');
      console.log('📊 Final processed data:', {
        overallMoisture: overallMoisture + '%',
        soilStatus: soilStatus,
        majorityDecision: data.majorityVoteDry ? 'WATER' : 'NO_WATER',
        sensorHealth: data.sensorHealth,
        validSensors: data.validSensors
      });
      
    } else {
      // LEGACY PROCESSING: Handle old format for backward compatibility
      console.log('� Processing LEGACY sensor data format...');
      
      const moisturePercent = Math.round(((4095 - (data.soilMoisture || 0)) / 4095) * 100);
      
      let soilStatus = 'Unknown';
      if (moisturePercent >= 80) soilStatus = 'Very Wet';
      else if (moisturePercent >= 60) soilStatus = 'Wet';
      else if (moisturePercent >= 40) soilStatus = 'Moist';
      else if (moisturePercent >= 20) soilStatus = 'Dry';
      else soilStatus = 'Very Dry';
      
      const sensorData = new SensorData({
        deviceId: data.deviceId,
        timestamp: new Date(data.timestamp || Date.now()),
        moistureLevel: data.soilMoisture || 0,
        moisturePercent: moisturePercent,
        soilStatus: soilStatus,
        isWatering: data.pumpState || false,
        wateringMode: 'auto',
        deviceStatus: 'Online',
        batteryLevel: data.batteryPercentage || 100,
        temperature: data.temperature || null,
        pumpStatus: data.pumpState ? 'ON' : 'OFF'
      });
      
      await sensorData.save();
      console.log('💾 Legacy sensor data stored for device:', data.deviceId);
    }
    
  } catch (error) {
    console.error('❌ MongoDB storage error:', error.message);
    console.log('📊 Raw ESP32 data that failed to store:', {
      deviceId: data.deviceId,
      hasZoneData: !!(data.zone1Percent && data.zone2Percent && data.zone3Percent),
      dataKeys: Object.keys(data)
    });
  }
}

// NEW: MQTT-API Bridge Functions

// Function to store irrigation status updates
async function storeIrrigationStatus(deviceId, statusData) {
  try {
    const IrrigationStatus = require('./models/IrrigationStatus');

    // Find existing status or create new one
    let irrigationStatus = await IrrigationStatus.findOne({ deviceId });

    if (!irrigationStatus) {
      irrigationStatus = new IrrigationStatus({
        deviceId,
        moistureLevel: statusData.moistureLevel || 0,
        irrigationStatus: statusData.irrigationStatus || 'idle',
        pumpStatus: statusData.pumpStatus || 'OFF',
        thresholds: statusData.thresholds || { dryThreshold: 1700, wetThreshold: 4000 }
      });
    } else {
      // Update existing status
      irrigationStatus.moistureLevel = statusData.moistureLevel || irrigationStatus.moistureLevel;
      irrigationStatus.irrigationStatus = statusData.irrigationStatus || irrigationStatus.irrigationStatus;
      irrigationStatus.pumpStatus = statusData.pumpStatus || irrigationStatus.pumpStatus;
      irrigationStatus.lastUpdated = new Date();

      if (statusData.thresholds) {
        irrigationStatus.thresholds = { ...irrigationStatus.thresholds, ...statusData.thresholds };
      }
    }

    await irrigationStatus.save();
    console.log('💧 Irrigation status updated for device:', deviceId, {
      moistureLevel: irrigationStatus.moistureLevel,
      irrigationStatus: irrigationStatus.irrigationStatus,
      pumpStatus: irrigationStatus.pumpStatus
    });
  } catch (error) {
    console.error('❌ Irrigation status storage error:', error.message);
  }
}

// Function to log sensor data
async function logSensorData(deviceId, sensorData) {
  try {
    const Log = require('./models/Log');

    // Find user associated with device
    const Device = require('./models/Device');
    const device = await Device.findOne({ deviceId });

    if (!device) {
      console.log('⚠️ Device not found for logging:', deviceId);
      return;
    }

    const logEntry = new Log({
      deviceId,
      userId: device.userID,
      eventType: 'sensor_reading',
      timestamp: new Date(sensorData.timestamp || Date.now()),
      details: {
        moistureLevel: sensorData.soilMoisture,
        temperature: sensorData.temperature,
        humidity: sensorData.humidity,
        pumpState: sensorData.pumpState,
        batteryLevel: sensorData.batteryPercentage
      }
    });

    await logEntry.save();
    console.log('📝 Sensor data logged for device:', deviceId);
  } catch (error) {
    console.error('❌ Sensor data logging error:', error.message);
  }
}

// Function to log system events
async function logSystemEvent(deviceId, eventType, eventData) {
  try {
    const Log = require('./models/Log');

    // Find user associated with device
    const Device = require('./models/Device');
    const device = await Device.findOne({ deviceId });

    if (!device) {
      console.log('⚠️ Device not found for event logging:', deviceId);
      return;
    }

    const logEntry = new Log({
      deviceId,
      userId: device.userID,
      eventType,
      timestamp: new Date(),
      details: eventData
    });

    await logEntry.save();
    console.log(`📝 System event logged: ${eventType} for device:`, deviceId);
  } catch (error) {
    console.error('❌ System event logging error:', error.message);
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Enable trust proxy for Render deployment (behind reverse proxy)
// This is required for express-rate-limit to correctly identify users via X-Forwarded-For header
if (process.env.NODE_ENV === 'production' || process.env.RENDER) {
  app.set('trust proxy', 1); // Trust first proxy (Render's load balancer)
  console.log('✅ Trust proxy enabled for production/Render environment');
}

// NEW: Passport middleware
app.use(passport.initialize());

// MongoDB Connection (Optional for MQTT testing)
const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/Ecosprinkle';
console.log('Attempting to connect to MongoDB:', mongoUri);

mongoose.connect(mongoUri, {
  serverSelectionTimeoutMS: 5000,
})
.then(() => {
  console.log('Connected to MongoDB successfully');
})
.catch(err => {
  console.error('MongoDB connection failed:', err.message);
  console.log('Server will continue without database. MQTT and HTTP server will still work.');
  // Don't exit process - let MQTT and HTTP server continue
});

// WebSocket Connection
io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('subscribe', (deviceId) => {
    socket.join(deviceId);
    console.log(`Client subscribed to device ${deviceId}`);
  });

  socket.on('unsubscribe', (deviceId) => {
    socket.leave(deviceId);
    console.log(`Client unsubscribed from device ${deviceId}`);
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
  });
});

// Root route - Welcome message
app.get('/', (req, res) => {
  res.json({
    message: '🌱 Ecosprinkle Backend API - MUBAYAD SA BA? OR ISAHON NALANG SAMAL? HAHAHAHAHA',
    status: 'running',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      status: '/status',
      auth: '/api/auth/*',
      devices: '/api/devices/*',
      irrigation: '/api/irrigation/*',
      sensors: '/api/sensor/*'
    },
    documentation: 'https://github.com/Kagawad2004/ecosprinkle-backend'
  });
});

// Auth routes (public)
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// NEW: Import additional route modules
const deviceRoutes = require('./routes/devices');
const irrigationRoutes = require('./routes/irrigation');
const logRoutes = require('./routes/logs');
const onboardingRoutes = require('./routes/onboarding');
const wateringRoutes = require('./routes/watering');

// Protected routes (require authentication) - DISABLED for development
// app.use('/api', authMiddleware);

// NEW: Use additional route modules
app.use('/api/devices', deviceRoutes);
app.use('/api/devices', wateringRoutes); // Mount watering routes at /api/devices
app.use('/api/irrigation', irrigationRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/onboarding', onboardingRoutes);

// Device routes
app.post('/api/devices/register', deviceController.registerDevice);
app.get('/api/devices/check/:deviceId', deviceController.isDeviceRegistered);
app.get('/api/devices/:deviceId', deviceController.getDeviceById);
app.put('/api/devices/:deviceId/status', deviceController.updateDeviceStatus);
app.delete('/api/devices/:deviceId', deviceController.deleteDevice);
app.delete('/api/devices/all/delete-everything', deviceController.deleteAllDevices); // DEVELOPER ONLY - Delete ALL devices
app.put('/api/devices/:deviceId/plant', deviceController.associateDeviceWithPlant);
app.get('/api/users/:userId/devices', deviceController.getUserDevices);

// Plant routes
app.get('/api/plants/user/:userId', deviceController.getUserPlants);
app.get('/api/plants/:plantId', deviceController.getPlantById);
app.post('/api/plants', deviceController.createPlant);
app.put('/api/plants/:plantId', deviceController.updatePlant);
app.delete('/api/plants/:plantId', deviceController.deletePlant);
app.get('/api/plants/:plantId/devices', deviceController.getPlantDevices);
app.put('/api/plants/:plantId/watering-mode', deviceController.updatePlantWateringMode);
app.put('/api/plants/:plantId/thresholds', deviceController.updatePlantThresholds);
app.put('/api/plants/:plantId/schedules', deviceController.updatePlantSchedules);
app.put('/api/plants/:plantId/watering-enabled', deviceController.togglePlantWatering);

// Sensor data routes
app.post('/api/sensor/:deviceId/data', deviceController.storeSensorData);
app.get('/api/sensor/:deviceId/stream', deviceController.getSensorDataStream);
app.get('/api/sensor/:deviceId/history', deviceController.getSensorDataHistory);

// Device command routes
app.post('/api/commands/:deviceId', deviceController.sendDeviceCommand);
app.get('/api/commands/:deviceId/pending', deviceController.getPendingCommands);
app.put('/api/commands/:commandId/executed', deviceController.markCommandExecuted);
app.put('/api/commands/:commandId/failed', deviceController.markCommandFailed);

// Watering control routes
app.post('/api/watering/:deviceId/command', deviceController.sendWateringCommand);
app.put('/api/watering/:deviceId/thresholds', deviceController.updateWateringThresholds);
app.put('/api/watering/:deviceId/mode', deviceController.setWateringMode);
app.put('/api/watering/:deviceId/schedules', deviceController.setWateringSchedules);

// Device status routes
app.get('/api/status/:deviceId', deviceController.getDeviceStatus);
app.get('/api/status/:deviceId/online', deviceController.isDeviceOnline);

// Notification routes
app.get('/api/notifications/:deviceId', deviceController.getDeviceNotifications);
app.post('/api/notifications', deviceController.createNotification);
app.put('/api/notifications/:notificationId/read', deviceController.markNotificationRead);

// Legacy routes (for backward compatibility)
app.get('/api/device/:deviceId/moisture', deviceController.getMoistureLevel);
app.post('/api/device/:deviceId/schedule', deviceController.updateSchedule);
app.post('/api/device/:deviceId/control', deviceController.manualControl);

// Sensor routes (legacy)
app.get('/api/sensor/:deviceId', sensorController.getSensorData);
app.post('/api/sensor/:deviceId', sensorController.updateSensorData);
app.get('/api/schedule/:deviceId', sensorController.getSchedule);
app.post('/api/schedule/:deviceId', sensorController.updateSchedule);
app.post('/api/control/:deviceId', sensorController.manualControl);

// Connection Status API Routes
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'ok',
    timestamp: Date.now(),
    service: 'Ecosprinkle Backend',
    version: '1.0.0'
  });
});

app.get('/api/connection-status', async (req, res) => {
  // Get latest secure cloud backend status
  const cloudBackendStatus = await checkSecureCloudBackendStatus();
  
  res.json({
    success: true,
    timestamp: Date.now(),
    architecture: {
      description: "Ecosprinkle uses Secure Cloud Backend for ESP32 communication",
      esp32Handler: "secure-cloud-backend.js",
      localMqttBroker: "index.js (legacy/backup)"
    },
    secureCloudBackend: {
      ...connectionStatus.secureCloudBackend,
      url: "http://localhost:3001",
      description: "Primary handler for ESP32 communication via cloud MQTT broker"
    },
    localMqttBroker: {
      ...connectionStatus.localMqttBroker,
      description: "Local MQTT broker for legacy/backup use"
    },
    overallStatus: {
      healthy: connectionStatus.secureCloudBackend.isRunning && cloudBackendStatus?.mqttConnected,
      primarySystem: "Secure Cloud Backend",
      esp32Connection: connectionStatus.secureCloudBackend.mqttConnected ? "Connected via Cloud MQTT" : "Disconnected"
    }
  });
});

app.get('/api/connection-status/summary', (req, res) => {
  const isHealthy = connectionStatus.secureCloudBackend.isRunning;
  const lastData = connectionStatus.secureCloudBackend.lastDataTimestamp;
  const dataAge = lastData ? Date.now() - lastData : null;
  
  res.json({
    status: isHealthy ? 'healthy' : 'unhealthy',
    primarySystem: 'Secure Cloud Backend (secure-cloud-backend.js)',
    esp32Status: connectionStatus.secureCloudBackend.mqttConnected ? 'connected' : 'disconnected',
    lastDataReceived: lastData ? new Date(lastData).toISOString() : null,
    dataAgeSeconds: dataAge ? Math.floor(dataAge / 1000) : null,
    secureCloudBackendRunning: connectionStatus.secureCloudBackend.isRunning,
    timestamp: new Date().toISOString()
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Something went wrong!' });
});

const port = process.env.PORT || 3000;
server.listen(port, '0.0.0.0', () => {
  console.log('========================================');
  console.log('🚀 Ecosprinkle Local MQTT Broker & Connection Monitor (index.js)');
  console.log(`📍 Server running at http://0.0.0.0:${port} (accessible from all interfaces)`);
  console.log('========================================');
  console.log('🏗️  SYSTEM ARCHITECTURE:');
  console.log('   📱 ESP32 → 🔒 Secure Cloud Backend (secure-cloud-backend.js:3001)');
  console.log('   🔒 Cloud Backend → 💾 Database + 🌐 WebSocket');
  console.log('   🏢 Local MQTT Broker (this server:' + port + ') → 🔄 Legacy/Backup + 📊 Monitoring');
  console.log('========================================');
  console.log('📊 Connection Status API:');
  console.log(`   GET http://localhost:${port}/api/connection-status`);
  console.log(`   GET http://localhost:${port}/api/connection-status/summary`);
  console.log('========================================');
  
  // Check if secure cloud backend is running
  setTimeout(() => {
    checkSecureCloudBackendStatus().then(status => {
      if (status) {
        console.log('✅ Secure Cloud Backend detected and running');
        console.log('🌐 ESP32 communication: ACTIVE via cloud MQTT');
      } else {
        console.log('⚠️  Secure Cloud Backend not detected');
        console.log('💡 Start it with: node secure-cloud-backend.js');
      }
    });
  }, 2000);
});