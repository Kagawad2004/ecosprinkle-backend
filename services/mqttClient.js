/**
 * Shared MQTT Client Service
 * 
 * Provides a single MQTT client instance for the entire backend.
 * This prevents duplicate connections and ensures consistent connection state.
 */

const mqtt = require('mqtt');
const EventEmitter = require('events');

class MqttClientService extends EventEmitter {
  constructor() {
    super();
    this.client = null;
    this.isConnected = false;
    this.isConnecting = false;
    this.brokerUrl = null;
    this.options = null;
    
    // Pending messages queue for when client is not connected
    this.pendingMessages = [];
  }

  /**
   * Initialize MQTT connection
   * @param {string} brokerUrl - MQTT broker URL (e.g., 'mqtt://broker.hivemq.com:1883')
   * @param {object} options - MQTT connection options
   */
  initialize(brokerUrl, options = {}) {
    if (this.client && this.isConnected) {
      console.log('🔄 MQTT client already connected');
      return this.client;
    }

    if (this.isConnecting) {
      console.log('⏳ MQTT client connection in progress...');
      return this.client;
    }

    this.brokerUrl = brokerUrl;
    this.options = {
      username: options.username || process.env.MQTT_USERNAME || '',
      password: options.password || process.env.MQTT_PASSWORD || '',
      reconnectPeriod: options.reconnectPeriod || 1000,
      connectTimeout: options.connectTimeout || 30000,
      clientId: options.clientId || `ecosprinkle_backend_${Date.now()}`,
      clean: options.clean !== false, // Default to clean session
      ...options
    };

    console.log('🔌 Initializing shared MQTT client...');
    console.log(`   Broker: ${this.brokerUrl}`);
    console.log(`   Client ID: ${this.options.clientId}`);

    this.isConnecting = true;
    this.client = mqtt.connect(this.brokerUrl, this.options);

    this.client.on('connect', () => {
      this.isConnected = true;
      this.isConnecting = false;
      console.log('✅ Shared MQTT client connected successfully');
      this.emit('connected');
      
      // Flush any pending messages
      this._flushPendingMessages();
    });

    this.client.on('error', (error) => {
      console.error('❌ Shared MQTT client error:', error.message);
      this.emit('error', error);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      console.log('🔌 Shared MQTT client disconnected');
      this.emit('disconnected');
    });

    this.client.on('reconnect', () => {
      console.log('🔄 Shared MQTT client reconnecting...');
      this.emit('reconnecting');
    });

    this.client.on('offline', () => {
      this.isConnected = false;
      console.log('📡 Shared MQTT client is offline');
      this.emit('offline');
    });

    return this.client;
  }

  /**
   * Get the MQTT client instance
   */
  getClient() {
    return this.client;
  }

  /**
   * Check if client is connected
   */
  isClientConnected() {
    return this.isConnected && this.client && this.client.connected;
  }

  /**
   * Publish a message (with automatic queueing if disconnected)
   * @param {string} topic - MQTT topic
   * @param {string|Buffer} payload - Message payload
   * @param {object} options - Publish options (qos, retain, etc.)
   * @returns {Promise<void>}
   */
  publish(topic, payload, options = { qos: 1 }) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        const error = new Error('MQTT client not initialized');
        console.error('❌ Publish failed:', error.message);
        reject(error);
        return;
      }

      // If not connected, queue the message
      if (!this.isClientConnected()) {
        console.log(`📦 MQTT not connected, queuing message for topic: ${topic}`);
        this.pendingMessages.push({
          topic,
          payload,
          options,
          retries: 0,
          resolve,
          reject
        });
        // Resolve immediately - message will be delivered when connected
        resolve();
        return;
      }

      // Connected - publish immediately
      this.client.publish(topic, payload, options, (error) => {
        if (error) {
          console.error(`❌ Failed to publish to ${topic}:`, error.message);
          // Queue for retry
          this.pendingMessages.push({
            topic,
            payload,
            options,
            retries: 0,
            resolve,
            reject
          });
          reject(error);
        } else {
          console.log(`✅ Published to ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * Subscribe to topic(s)
   * @param {string|string[]} topics - Topic or array of topics
   * @param {object} options - Subscribe options
   * @returns {Promise<void>}
   */
  subscribe(topics, options = { qos: 1 }) {
    return new Promise((resolve, reject) => {
      if (!this.client) {
        reject(new Error('MQTT client not initialized'));
        return;
      }

      if (!this.isClientConnected()) {
        reject(new Error('MQTT client not connected'));
        return;
      }

      this.client.subscribe(topics, options, (error, granted) => {
        if (error) {
          console.error('❌ Subscribe failed:', error.message);
          reject(error);
        } else {
          console.log('✅ Subscribed to:', granted.map(g => g.topic).join(', '));
          resolve(granted);
        }
      });
    });
  }

  /**
   * Flush pending messages when connection is restored
   */
  _flushPendingMessages() {
    if (!this.pendingMessages.length) return;
    if (!this.isClientConnected()) return;

    const count = this.pendingMessages.length;
    console.log(`📤 Flushing ${count} pending MQTT messages...`);

    const maxRetries = 5;
    const toProcess = [...this.pendingMessages];
    this.pendingMessages = [];

    toProcess.forEach((msg) => {
      this.client.publish(msg.topic, msg.payload, msg.options, (error) => {
        if (error) {
          msg.retries = (msg.retries || 0) + 1;
          if (msg.retries <= maxRetries) {
            console.warn(`⚠️ Publish to ${msg.topic} failed, retry ${msg.retries}/${maxRetries}`);
            // Requeue with backoff
            setTimeout(() => {
              this.pendingMessages.push(msg);
              if (this.isClientConnected()) {
                this._flushPendingMessages();
              }
            }, 1000 * msg.retries);
          } else {
            console.error(`❌ Dropping message to ${msg.topic} after ${maxRetries} retries`);
            if (msg.reject) msg.reject(error);
          }
        } else {
          console.log(`✅ Pending message delivered to ${msg.topic}`);
          if (msg.resolve) msg.resolve();
        }
      });
    });
  }

  /**
   * Close the MQTT connection
   */
  close() {
    if (this.client) {
      console.log('🔌 Closing shared MQTT client...');
      this.client.end();
      this.client = null;
      this.isConnected = false;
      this.isConnecting = false;
    }
  }
}

// Singleton instance
const mqttClientService = new MqttClientService();

// Graceful shutdown
process.on('SIGTERM', () => {
  mqttClientService.close();
});

process.on('SIGINT', () => {
  mqttClientService.close();
});

module.exports = mqttClientService;
