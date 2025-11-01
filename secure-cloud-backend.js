require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketIO = require('socket.io');
const mqtt = require('mqtt');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');

const app = express();
const server = http.createServer(app);

// Enhanced Security Middleware
app.use(helmet());
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || ["http://localhost:3000"],
    credentials: true
}));

// Rate limiting to prevent DoS attacks
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // limit each IP to 100 requests per windowMs
    message: 'Too many requests, please try again later',
    standardHeaders: true,
    legacyHeaders: false,
});
app.use('/api/', limiter);

// WebSocket rate limiting
const socketLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 50, // limit each IP to 50 WebSocket events per minute
    skip: (req) => req.ip === '127.0.0.1' // Skip localhost
});

const io = socketIO(server, {
    cors: {
        origin: process.env.ALLOWED_ORIGINS?.split(',') || ["http://localhost:3000"],
        methods: ["GET", "POST"]
    },
    transports: ['websocket', 'polling'],
    upgradeTimeout: 30000,
    pingTimeout: 60000,
    pingInterval: 25000
});

// Store io instance for use in controllers
app.set('io', io);

// Enhanced MQTT Configuration with Circuit Breaker Pattern
class MQTTManager {
    constructor() {
        this.client = null;
        this.isConnected = false;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.backoffDelay = 1000;
        this.messageQueue = [];
        this.maxQueueSize = 1000;
        this.init();
    }

    init() {
        const mqttBrokerEnv = process.env.MQTT_BROKER || 'mqtt://broker.hivemq.com:1883';
        const BACKEND_CLIENT_ID = 'BACKEND_Ecosprinkle_' + Math.random().toString(36).substr(2, 9);

        // Smart URL parsing: handle both full URLs and hostname-only formats
        let brokerUrl;
        if (mqttBrokerEnv.includes('://')) {
            // Full URL format (e.g., mqtt://test.mosquitto.org:1883)
            brokerUrl = mqttBrokerEnv;
        } else {
            // Hostname-only format (e.g., test.mosquitto.org)
            const CLOUD_MQTT_PORT = parseInt(process.env.MQTT_PORT) || 1883;
            brokerUrl = `mqtt://${mqttBrokerEnv}:${CLOUD_MQTT_PORT}`;
        }

        console.log('🔒 Initializing Enhanced MQTT Connection...');
        console.log('📍 Broker URL:', brokerUrl);
        console.log('📍 Client ID:', BACKEND_CLIENT_ID);

        this.client = mqtt.connect(brokerUrl, {
            clientId: BACKEND_CLIENT_ID,
            clean: true,
            connectTimeout: 30000,
            reconnectPeriod: 5000,
            keepalive: 60,
            protocolVersion: 4,
            will: {
                topic: 'Ecosprinkle/backend/status',
                payload: 'offline',
                qos: 1,
                retain: true
            }
        });

        this.setupEventHandlers();
    }

    setupEventHandlers() {
        this.client.on('connect', () => {
            console.log('✅ Backend connected to secure cloud MQTT broker');
            this.isConnected = true;
            this.reconnectAttempts = 0;
            
            // Subscribe to ESP32 sensor data with WILDCARD pattern to match ANY device ID
            // ESP32 publishes to: Ecosprinkle/esp32-3c8a1f7f442c/sensors/data
            // Wildcard (+) matches any device ID
            this.client.subscribe('Ecosprinkle/+/sensors/data', { qos: 1 }, (err) => {
                if (err) {
                    console.error('❌ Subscription error for sensors/data:', err);
                } else {
                    console.log('✅ Subscribed to: Ecosprinkle/+/sensors/data (all devices)');
                }
            });
            
            // Subscribe to device commands responses
            this.client.subscribe('Ecosprinkle/+/commands/pump', { qos: 1 }, (err) => {
                if (err) {
                    console.error('❌ Subscription error for pump commands:', err);
                } else {
                    console.log('✅ Subscribed to: Ecosprinkle/+/commands/pump (all devices)');
                }
            });
            
            // Subscribe to device status updates
            this.client.subscribe('Ecosprinkle/+/status', { qos: 1 }, (err) => {
                if (err) {
                    console.error('❌ Subscription error for device status:', err);
                } else {
                    console.log('✅ Subscribed to: Ecosprinkle/+/status (all devices)');
                }
            });
            
            // Publish backend online status
            this.client.publish('Ecosprinkle/backend/status', 'online', { qos: 1, retain: true });
            
            // Process any queued messages
            this.processQueuedMessages();
            
            console.log('📡 Successfully subscribed to all ESP32 MQTT topics with wildcard pattern');
        });

        this.client.on('error', (error) => {
            console.error('❌ Cloud MQTT connection error:', error);
            this.isConnected = false;
        });

        this.client.on('offline', () => {
            console.log('📴 Cloud MQTT client offline - attempting reconnection...');
            this.isConnected = false;
            this.handleReconnection();
        });

        this.client.on('reconnect', () => {
            this.reconnectAttempts++;
            console.log(`🔄 Reconnecting to cloud MQTT broker... (Attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        });

        // Enhanced message handling with rate limiting and error recovery
        this.client.on('message', async (topic, payload) => {
            try {
                await this.handleMessage(topic, payload);
            } catch (error) {
                console.error('❌ Error processing MQTT message:', error);
                // Log the problematic message for debugging
                console.error('📨 Problematic message:', { topic, payload: payload.toString() });
            }
        });
    }

    async handleMessage(topic, payload) {
        console.log('📨 Cloud MQTT Message:', topic, payload.toString());
        
        // Extract device ID from topic: Ecosprinkle/esp32-3c8a1f7f442c/sensors/data
        const topicParts = topic.split('/');
        const deviceId = topicParts[1]; // Get device ID from topic
        
        // Handle sensor data messages (Ecosprinkle/+/sensors/data)
        if (topic.includes('/sensors/data')) {
            const rawData = JSON.parse(payload.toString());
            
            // Use synchronized sensor algorithm service
            const sensorAlgorithm = require('./services/esp32SensorAlgorithm');
            
            // Validate data structure
            const validation = sensorAlgorithm.validateSensorData(rawData);
            if (!validation.isValid) {
                console.error('❌ Invalid sensor data:', validation.error);
                throw new Error(`Invalid sensor data: ${validation.error}`);
            }
            
            // Process sensor data using EXACT ESP32 algorithm
            const processedData = sensorAlgorithm.processSensorData(rawData);
            
            console.log('🌱 Sensor data received from ESP32:', {
                deviceId: processedData.deviceId,
                zone1: `${processedData.zone1.moisturePercent}% (${processedData.zone1.status})`,
                zone2: `${processedData.zone2.moisturePercent}% (${processedData.zone2.status})`,
                zone3: `${processedData.zone3.moisturePercent}% (${processedData.zone3.status})`,
                dryVotes: processedData.votingResults.dryVotes,
                wetVotes: processedData.votingResults.wetVotes,
                decision: processedData.votingResults.wateringRecommendation,
                validSensors: processedData.votingResults.validSensors,
                sensorHealth: processedData.deviceStatus.sensorHealth,
                timestamp: processedData.receivedAt
            });
            
            // Store sensor data with proper error handling
            try {
                await storeSensorDataSafely(rawData, processedData);
                console.log('💾 Sensor data stored successfully in MongoDB');
            } catch (dbError) {
                console.error('❌ Database storage failed:', dbError.message);
                console.error('❌ Error details:', dbError);
                // Continue operation even if database fails
            }
            
            // Emit to WebSocket clients for real-time updates (with error handling)
            try {
                io.emit('sensorData', processedData);
            } catch (socketError) {
                console.error('❌ WebSocket emission failed:', socketError.message);
            }
            
        } 
        // Handle device status messages (Ecosprinkle/+/status)
        else if (topic.includes('/status')) {
            console.log('🚀 ESP32 device online:', deviceId);
            
            // Emit device status to WebSocket clients
            try {
                io.emit('deviceStatus', { deviceId, status: 'online', timestamp: Date.now() });
            } catch (error) {
                console.error('❌ Failed to emit device status:', error);
            }
        }
    }

    handleReconnection() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('❌ Max reconnection attempts reached. Stopping reconnection.');
            return;
        }

        // Exponential backoff
        const delay = Math.min(this.backoffDelay * Math.pow(2, this.reconnectAttempts), 30000);
        setTimeout(() => {
            console.log(`⏰ Retrying connection in ${delay}ms...`);
        }, delay);
    }

    sendCommand(deviceId, command, payload) {
        const topic = `Ecosprinkle/commands/${command}`;
        const message = JSON.stringify({
            deviceId,
            command,
            payload,
            timestamp: Date.now()
        });

        if (this.isConnected) {
            this.client.publish(topic, message, { qos: 1 }, (err) => {
                if (err) {
                    console.error('❌ Failed to send command:', err);
                    this.queueMessage(topic, message);
                } else {
                    console.log('📤 Command sent to ESP32:', topic, message);
                }
            });
        } else {
            console.log('📦 MQTT offline, queueing command:', { topic, message });
            this.queueMessage(topic, message);
        }
    }

    queueMessage(topic, message) {
        if (this.messageQueue.length >= this.maxQueueSize) {
            console.warn('⚠️ Message queue full, dropping oldest message');
            this.messageQueue.shift();
        }
        this.messageQueue.push({ topic, message, timestamp: Date.now() });
    }

    processQueuedMessages() {
        console.log(`📦 Processing ${this.messageQueue.length} queued messages...`);
        while (this.messageQueue.length > 0) {
            const { topic, message } = this.messageQueue.shift();
            this.client.publish(topic, message, { qos: 1 });
        }
    }
}

// Initialize enhanced MQTT manager
const mqttManager = new MQTTManager();

// Store MQTT manager for use in routes
app.set('mqttClient', mqttManager.client);
app.set('sendCommand', (deviceId, command, payload) => mqttManager.sendCommand(deviceId, command, payload));

// Enhanced sensor data storage with circuit breaker pattern
class DatabaseManager {
    constructor() {
        this.isHealthy = true;
        this.failureCount = 0;
        this.maxFailures = 5;
        this.resetTimeout = 60000; // 1 minute
        this.lastFailureTime = 0;
    }

    async executeQuery(operation) {
        // Circuit breaker pattern
        if (!this.isHealthy) {
            if (Date.now() - this.lastFailureTime > this.resetTimeout) {
                console.log('🔄 Attempting to reset database circuit breaker...');
                this.isHealthy = true;
                this.failureCount = 0;
            } else {
                throw new Error('Database circuit breaker is open');
            }
        }

        try {
            const result = await operation();
            // Reset failure count on success
            this.failureCount = 0;
            return result;
        } catch (error) {
            this.failureCount++;
            this.lastFailureTime = Date.now();
            
            if (this.failureCount >= this.maxFailures) {
                console.error('❌ Database circuit breaker opened due to repeated failures');
                this.isHealthy = false;
            }
            
            throw error;
        }
    }
}

const dbManager = new DatabaseManager();

// Enhanced sensor data storage function with synchronized algorithm
async function storeSensorDataSafely(rawData, processedData) {
    return await dbManager.executeQuery(async () => {
        const Sensor = require('./models/Sensor');
        const Device = require('./models/Device');
        const SensorData = require('./models/SensorData');
        
        // ========== STEP 1: GET DEVICE AND USER ID ==========
        // Fetch device to get the userID for proper data association
        const device = await Device.findOne({ deviceId: processedData.deviceId });
        
        if (!device) {
            console.error('❌ Device not found:', processedData.deviceId);
            console.error('⚠️  Data cannot be stored - device must be registered first!');
            throw new Error(`Device ${processedData.deviceId} not registered in database`);
        }
        
        const userID = device.userID;
        console.log('👤 User ID for device:', userID);
        
        // ========== STEP 2: INSERT HISTORICAL DATA (SensorData) ==========
        // Store EVERY reading for time-series analysis (append-only)
        // MUST include userID for proper data ownership
        try {
            await SensorData.create({
                deviceId: processedData.deviceId,
                userID: userID, // ← Link to user
                timestamp: new Date(), // Server timestamp
                deviceTimestamp: processedData.deviceStatus.deviceTimestamp,
                
                // Zone 1
                zone1: processedData.zone1.rawADC,
                zone1Percent: processedData.zone1.moisturePercent,
                
                // Zone 2
                zone2: processedData.zone2.rawADC,
                zone2Percent: processedData.zone2.moisturePercent,
                
                // Zone 3
                zone3: processedData.zone3.rawADC,
                zone3Percent: processedData.zone3.moisturePercent,
                
                // Voting results
                dryVotes: processedData.votingResults.dryVotes,
                wetVotes: processedData.votingResults.wetVotes,
                majorityVoteDry: processedData.votingResults.majorityVoteDry,
                validSensors: processedData.votingResults.validSensors,
                median: processedData.votingResults.medianADC,
                
                // Device status
                sensorHealth: processedData.deviceStatus.sensorHealth,
                pumpState: processedData.deviceStatus.pumpState,
                rssi: processedData.deviceStatus.rssi
            });
            console.log('📈 Historical data saved to SensorData collection (User:', userID + ')');
        } catch (error) {
            console.error('❌ Failed to save historical data:', error.message);
            throw error; // Re-throw to handle properly
        }
        
        // ========== STEP 3: UPDATE SENSOR MODEL (Current State) ==========
        // Store complete zone data with voting results
        // MUST include userID for proper data ownership
        const sensorUpdate = {
            deviceId: processedData.deviceId,
            userID: userID, // ← Link to user
            
            // Zone 1 data
            'zone1.rawADC': processedData.zone1.rawADC,
            'zone1.moisturePercent': processedData.zone1.moisturePercent,
            'zone1.status': processedData.zone1.status,
            'zone1.vote': processedData.zone1.vote,
            'zone1.isValid': processedData.zone1.isValid,
            
            // Zone 2 data
            'zone2.rawADC': processedData.zone2.rawADC,
            'zone2.moisturePercent': processedData.zone2.moisturePercent,
            'zone2.status': processedData.zone2.status,
            'zone2.vote': processedData.zone2.vote,
            'zone2.isValid': processedData.zone2.isValid,
            
            // Zone 3 data
            'zone3.rawADC': processedData.zone3.rawADC,
            'zone3.moisturePercent': processedData.zone3.moisturePercent,
            'zone3.status': processedData.zone3.status,
            'zone3.vote': processedData.zone3.vote,
            'zone3.isValid': processedData.zone3.isValid,
            
            // Voting results
            'votingResults.dryVotes': processedData.votingResults.dryVotes,
            'votingResults.wetVotes': processedData.votingResults.wetVotes,
            'votingResults.majorityVoteDry': processedData.votingResults.majorityVoteDry,
            'votingResults.validSensors': processedData.votingResults.validSensors,
            'votingResults.medianADC': processedData.votingResults.medianADC,
            
            // Device status
            sensorHealth: processedData.deviceStatus.sensorHealth,
            pumpState: processedData.deviceStatus.pumpState,
            rssi: processedData.deviceStatus.rssi,
            deviceTimestamp: processedData.deviceStatus.deviceTimestamp,
            
            // Legacy fields (average of all zones for backward compatibility)
            moistureLevel: Math.round((processedData.zone1.moisturePercent + 
                                      processedData.zone2.moisturePercent + 
                                      processedData.zone3.moisturePercent) / 3),
            lastUpdated: new Date(),
            isActive: true
        };
        
        await Sensor.findOneAndUpdate(
            { deviceId: processedData.deviceId },
            sensorUpdate,
            { upsert: true, new: true }
        );
        console.log('📊 Sensor state updated (User:', userID + ')');
        
        // ========== STEP 4: UPDATE DEVICE MODEL ==========
        // Update device with latest sensor data
        const deviceUpdate = {
            deviceId: processedData.deviceId,
            
            // Complete sensor data in nested structure
            'sensorData.zone1': processedData.zone1.rawADC,
            'sensorData.zone2': processedData.zone2.rawADC,
            'sensorData.zone3': processedData.zone3.rawADC,
            'sensorData.zone1Percent': processedData.zone1.moisturePercent,
            'sensorData.zone2Percent': processedData.zone2.moisturePercent,
            'sensorData.zone3Percent': processedData.zone3.moisturePercent,
            'sensorData.dryVotes': processedData.votingResults.dryVotes,
            'sensorData.wetVotes': processedData.votingResults.wetVotes,
            'sensorData.majorityVoteDry': processedData.votingResults.majorityVoteDry,
            'sensorData.validSensors': processedData.votingResults.validSensors,
            'sensorData.sensorHealth': processedData.deviceStatus.sensorHealth,
            'sensorData.median': processedData.votingResults.medianADC,
            'sensorData.pumpState': processedData.deviceStatus.pumpState,
            'sensorData.rssi': processedData.deviceStatus.rssi,
            'sensorData.deviceTimestamp': processedData.deviceStatus.deviceTimestamp,
            'sensorData.receivedAt': processedData.receivedAt,
            
            // Update device status
            Status: 'Online',
            LastUpdated: new Date(),
            lastSensorUpdate: new Date(),
            
            // Update overall moisture level (average for display)
            moistureLevel: Math.round((processedData.zone1.moisturePercent + 
                                      processedData.zone2.moisturePercent + 
                                      processedData.zone3.moisturePercent) / 3)
        };
        
        await Device.findOneAndUpdate(
            { deviceId: processedData.deviceId },
            deviceUpdate,
            { upsert: false } // Don't create device if it doesn't exist
        );
        
        console.log('💾 Sensor data stored in MongoDB for device:', processedData.deviceId);
        console.log('📊 Stored data:', {
            deviceId: processedData.deviceId,
            zone1: `${processedData.zone1.moisturePercent}% (${processedData.zone1.status})`,
            zone2: `${processedData.zone2.moisturePercent}% (${processedData.zone2.status})`,
            zone3: `${processedData.zone3.moisturePercent}% (${processedData.zone3.status})`,
            dryVotes: processedData.votingResults.dryVotes,
            wetVotes: processedData.votingResults.wetVotes,
            majorityVoteDry: processedData.votingResults.majorityVoteDry,
            recommendation: processedData.votingResults.wateringRecommendation,
            pumpState: processedData.deviceStatus.pumpState === 1 ? 'ON' : 'OFF',
            rssi: processedData.deviceStatus.rssi
        });

        // Clean up old data to prevent unbounded growth
        await cleanupOldData(processedData.deviceId);
    });
}

// Data cleanup function to prevent memory issues
async function cleanupOldData(deviceId) {
    try {
        const SensorData = require('./models/SensorData');
        const cutoffDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // 30 days ago
        
        const result = await SensorData.deleteMany({
            deviceId: deviceId,
            timestamp: { $lt: cutoffDate }
        });
        
        if (result.deletedCount > 0) {
            console.log(`🧹 Cleaned up ${result.deletedCount} old records for device ${deviceId}`);
        }
    } catch (error) {
        console.error('❌ Failed to cleanup old data:', error.message);
    }
}

// Enhanced middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Import and use auth routes
const authRoutes = require('./routes/auth');
app.use('/api/auth', authRoutes);

// Import and use sensor routes
const sensorRoutes = require('./routes/sensors');
app.use('/api', sensorRoutes);

// Import and use device routes (includes DELETE with MQTT notification)
const deviceRoutes = require('./routes/devices');
app.use('/api/devices', deviceRoutes);

// Import and use watering control routes
const wateringRoutes = require('./routes/watering');
app.use('/api/devices', wateringRoutes);

// Enhanced MongoDB Connection with retry logic
async function connectToMongoDB() {
    const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/Ecosprinkle';
    console.log('🗄️ Connecting to MongoDB:', mongoUri);

    const maxRetries = 5;
    let retryCount = 0;

    while (retryCount < maxRetries) {
        try {
            await mongoose.connect(mongoUri, {
                serverSelectionTimeoutMS: 10000,
                socketTimeoutMS: 45000,
                family: 4,
                maxPoolSize: 10,
                minPoolSize: 2,
                maxIdleTimeMS: 30000
            });

            console.log('✅ Connected to MongoDB successfully');
            
            // Setup connection event handlers
            mongoose.connection.on('error', (err) => {
                console.error('❌ MongoDB connection error:', err);
            });

            mongoose.connection.on('disconnected', () => {
                console.log('📴 MongoDB disconnected');
            });

            mongoose.connection.on('reconnected', () => {
                console.log('🔄 MongoDB reconnected');
            });

            break;
        } catch (err) {
            retryCount++;
            console.error(`❌ MongoDB connection attempt ${retryCount} failed:`, err.message);
            
            if (retryCount >= maxRetries) {
                console.error('❌ Max MongoDB connection retries reached. Server will continue without database');
                break;
            }
            
            // Exponential backoff
            const delay = Math.pow(2, retryCount) * 1000;
            console.log(`⏰ Retrying MongoDB connection in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Initialize MongoDB connection
connectToMongoDB();

// Enhanced WebSocket Connection with proper error handling
io.on('connection', (socket) => {
    console.log('🔌 WebSocket client connected:', socket.id);

    // Apply rate limiting to socket events
    socket.use((packet, next) => {
        socketLimiter(socket.request, {}, next);
    });

    socket.on('subscribe', (deviceId) => {
        try {
            if (typeof deviceId === 'string' && deviceId.length > 0) {
                socket.join(deviceId);
                console.log(`📡 Client ${socket.id} subscribed to device ${deviceId}`);
            } else {
                socket.emit('error', 'Invalid device ID');
            }
        } catch (error) {
            console.error('❌ Socket subscription error:', error);
            socket.emit('error', 'Subscription failed');
        }
    });

    socket.on('sendCommand', (data) => {
        try {
            const { deviceId, command, payload } = data;
            
            // Validate input
            if (!deviceId || !command) {
                socket.emit('error', 'Missing required fields: deviceId, command');
                return;
            }
            
            mqttManager.sendCommand(deviceId, command, payload);
            console.log('📤 Command sent via WebSocket:', data);
            socket.emit('commandAck', { success: true, timestamp: Date.now() });
        } catch (error) {
            console.error('❌ Socket command error:', error);
            socket.emit('error', 'Command failed');
        }
    });

    socket.on('disconnect', (reason) => {
        console.log('🔌 WebSocket client disconnected:', socket.id, 'Reason:', reason);
    });

    socket.on('error', (error) => {
        console.error('❌ Socket error for client', socket.id, ':', error);
    });
});

// Enhanced API Routes with proper error handling
app.get('/api/status', (req, res) => {
    try {
        res.json({
            status: 'running',
            mqttConnected: mqttManager.isConnected,
            dbConnected: mongoose.connection.readyState === 1,
            timestamp: Date.now(),
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            version: process.env.npm_package_version || '1.0.0'
        });
    } catch (error) {
        console.error('❌ Status endpoint error:', error);
        res.status(500).json({ error: 'Status check failed' });
    }
});

app.post('/api/command/:deviceId', (req, res) => {
    try {
        const { deviceId } = req.params;
        const { command, payload } = req.body;
        
        // Validate input
        if (!deviceId || !command) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: deviceId, command'
            });
        }
        
        mqttManager.sendCommand(deviceId, command, payload);
        
        res.json({
            success: true,
            deviceId,
            command,
            payload,
            timestamp: Date.now()
        });
    } catch (error) {
        console.error('❌ Command endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Command processing failed'
        });
    }
});

// Enhanced sensor data endpoint with pagination and caching
app.get('/api/sensor/:deviceId/recent', async (req, res) => {
    try {
        const { deviceId } = req.params;
        const limit = Math.min(parseInt(req.query.limit) || 100, 1000); // Max 1000 records
        const page = Math.max(parseInt(req.query.page) || 1, 1);
        const skip = (page - 1) * limit;
        
        if (!deviceId) {
            return res.status(400).json({
                success: false,
                error: 'Device ID is required'
            });
        }

        const result = await dbManager.executeQuery(async () => {
            const SensorData = require('./models/SensorData');
            
            const recentData = await SensorData
                .find({ deviceId })
                .sort({ timestamp: -1 })
                .skip(skip)
                .limit(limit)
                .lean(); // Use lean() for better performance
                
            const totalCount = await SensorData.countDocuments({ deviceId });
            
            return { recentData, totalCount };
        });
        
        res.json({
            success: true,
            deviceId,
            data: result.recentData,
            pagination: {
                page,
                limit,
                total: result.totalCount,
                totalPages: Math.ceil(result.totalCount / limit)
            }
        });
    } catch (error) {
        console.error('❌ Sensor data endpoint error:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to retrieve sensor data'
        });
    }
});

// Health check endpoint
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'healthy', 
        timestamp: Date.now(),
        services: {
            mqtt: mqttManager.isConnected,
            database: mongoose.connection.readyState === 1
        }
    });
});

// Enhanced error handling middleware
app.use((err, req, res, next) => {
    console.error('❌ API Error:', err.stack);
    
    // Don't leak error details in production
    const isDevelopment = process.env.NODE_ENV === 'development';
    
    res.status(err.status || 500).json({ 
        success: false, 
        message: isDevelopment ? err.message : 'Internal server error',
        ...(isDevelopment && { error: err.message, stack: err.stack })
    });
});

// 404 handler
app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: 'Endpoint not found'
    });
});

// Graceful shutdown handling
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

async function gracefulShutdown(signal) {
    console.log(`🛑 Received ${signal}. Starting graceful shutdown...`);
    
    // Close HTTP server
    server.close(() => {
        console.log('🔌 HTTP server closed');
    });
    
    // Close MQTT connection
    if (mqttManager.client) {
        mqttManager.client.end();
        console.log('📡 MQTT connection closed');
    }
    
    // Close database connection
    if (mongoose.connection.readyState === 1) {
        await mongoose.connection.close();
        console.log('🗄️ Database connection closed');
    }
    
    console.log('✅ Graceful shutdown completed');
    process.exit(0);
}

// Start server
const port = process.env.SECURE_CLOUD_PORT || 3001;
server.listen(port, '0.0.0.0', () => {
    console.log(`🚀 Enhanced Secure Ecosprinkle Backend Server running at http://0.0.0.0:${port} (accessible from all interfaces)`);
    console.log('🔒 Using cloud MQTT broker for secure device communication');
    console.log('🛡️ Enhanced with rate limiting, error handling, and circuit breakers');
    console.log('📊 Health check available at http://localhost:' + port + '/health');
});

// Uncaught exception handler
process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    console.log('🛑 Server shutting down due to uncaught exception');
    process.exit(1);
});

// Unhandled promise rejection handler
process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ Unhandled Rejection at:', promise, 'reason:', reason);
    console.log('🛑 Server shutting down due to unhandled promise rejection');
    process.exit(1);
});