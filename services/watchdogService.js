/**
 * Device Watchdog Service
 * 
 * Tracks devices that have been provisioned with WiFi credentials
 * but not yet registered/saved. Automatically sends WiFi reset command
 * after timeout period expires to prevent orphaned devices.
 * 
 * This is the server-side safety net that works even if the app is closed.
 */

const mqtt = require('mqtt');

class WatchdogService {
  constructor() {
    // Map of deviceId -> { timestamp, timeoutId }
    this.trackedDevices = new Map();
    
    // 30 minutes in milliseconds (matches firmware watchdog)
    this.TIMEOUT_MS = 30 * 60 * 1000;
    
  // MQTT client (will be initialized when needed)
  this.mqttClient = null;
    this.mqttBroker = process.env.MQTT_BROKER || 'mqtt://localhost:1883';
    this.mqttUsername = process.env.MQTT_USERNAME || '';
    this.mqttPassword = process.env.MQTT_PASSWORD || '';
  // Pending MQTT messages queue (messages stored while MQTT disconnected)
  // Each item: { topic, payload, options, retries }
  this.pendingMessages = [];
    
    console.log('🐕 WatchdogService initialized');
  }

  /**
   * Initialize MQTT connection
   */
  initializeMqtt() {
    if (this.mqttClient && this.mqttClient.connected) {
      return;
    }

    const options = {
      username: this.mqttUsername,
      password: this.mqttPassword,
      reconnectPeriod: 1000,
      connectTimeout: 30000,
    };

    this.mqttClient = mqtt.connect(this.mqttBroker, options);

    this.mqttClient.on('connect', () => {
      console.log('🐕 Watchdog MQTT connected');
      // Publish any pending messages
      this._flushPendingMessages();
    });

    this.mqttClient.on('error', (error) => {
      console.error('🐕 Watchdog MQTT error:', error);
    });

    this.mqttClient.on('close', () => {
      console.log('🐕 Watchdog MQTT disconnected');
    });
  }

  /**
   * Internal: push a message to pending queue and optionally try immediate publish
   */
  _queueOrPublish(topic, payload, options = { qos: 1 }, tryNow = true) {
    // If connected, try to publish immediately
    if (this.mqttClient && this.mqttClient.connected) {
      this.mqttClient.publish(topic, payload, options, (err) => {
        if (err) {
          console.error(`🐕 Failed immediate publish to ${topic}:`, err);
          // fallback to queue with 0 retries so retry logic can run later
          this.pendingMessages.push({ topic, payload, options, retries: 0 });
        } else {
          console.log(`🐕 Published to ${topic}`);
        }
      });
      return;
    }

    // Not connected: push to queue
    this.pendingMessages.push({ topic, payload, options, retries: 0 });
    if (tryNow) {
      console.log(`🐕 MQTT not connected, queued message for ${topic}`);
    }
  }

  /**
   * Flush pending messages when MQTT connects. Uses limited retries to avoid infinite loops.
   */
  _flushPendingMessages() {
    if (!this.mqttClient || !this.mqttClient.connected) return;
    if (!this.pendingMessages.length) return;

    console.log(`🐕 Flushing ${this.pendingMessages.length} pending MQTT messages`);

    const maxRetries = 5;
    const toProcess = [...this.pendingMessages];
    this.pendingMessages = [];

    toProcess.forEach((msg) => {
      this.mqttClient.publish(msg.topic, msg.payload, msg.options, (err) => {
        if (err) {
          msg.retries = (msg.retries || 0) + 1;
          if (msg.retries <= maxRetries) {
            console.warn(`🐕 Publish to ${msg.topic} failed, retry ${msg.retries}/${maxRetries}:`, err);
            // requeue with backoff
            setTimeout(() => this.pendingMessages.push(msg), 1000 * msg.retries);
          } else {
            console.error(`🐕 Dropping MQTT message to ${msg.topic} after ${maxRetries} retries`);
          }
        } else {
          console.log(`🐕 Pending message delivered to ${msg.topic}`);
        }
      });
    });
  }

  /**
   * Send WiFi reset command via MQTT
   */
  sendWiFiResetCommand(deviceId) {
    return new Promise((resolve, reject) => {
      const topic = `ecosprinkle/${deviceId}/command`;
      const payload = JSON.stringify({
        command: 'RESET_WIFI',
        commandId: `reset-${Date.now()}`,
        timestamp: new Date().toISOString(),
        reason: 'Registration timeout - device not saved within 30 minutes'
      });

      // Ensure MQTT client is initialized (will connect in background)
      this.initializeMqtt();

      // Queue or publish; resolve immediately if queued to avoid blocking server
      if (!this.mqttClient || !this.mqttClient.connected) {
        this._queueOrPublish(topic, payload, { qos: 1 }, true);
        // resolve here — delivery will be attempted when MQTT reconnects
        resolve();
        return;
      }

      // Connected: publish immediately
      this.mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
          console.error(`🐕 Failed to send WiFi reset to ${deviceId}:`, error);
          // queue for retry
          this.pendingMessages.push({ topic, payload, options: { qos: 1 }, retries: 0 });
          reject(error);
        } else {
          console.log(`🐕 WiFi reset command sent to ${deviceId} via ${topic}`);
          resolve();
        }
      });
    });
  }

  /**
   * Send device registration confirmation via MQTT
   */
  sendRegistrationConfirmation(deviceId) {
    return new Promise((resolve, reject) => {
      const topic = `ecosprinkle/${deviceId}/command`;
      const payload = JSON.stringify({
        command: 'DEVICE_REGISTERED',
        commandId: `reg-${Date.now()}`,
        timestamp: new Date().toISOString()
      });

      // Ensure MQTT client is initialized
      this.initializeMqtt();

      // If not connected, queue the confirmation and resolve (deliver when connected)
      if (!this.mqttClient || !this.mqttClient.connected) {
        console.warn('🐕 MQTT not connected, queuing registration confirmation');
        this._queueOrPublish(topic, payload, { qos: 1 }, true);
        resolve();
        return;
      }

      this.mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
          console.error(`🐕 Failed to send registration confirmation to ${deviceId}:`, error);
          // queue for retry
          this.pendingMessages.push({ topic, payload, options: { qos: 1 }, retries: 0 });
          reject(error);
        } else {
          console.log(`🐕 Registration confirmation sent to ${deviceId}`);
          resolve();
        }
      });
    });
  }

  /**
   * Start tracking a device that has been provisioned
   * @param {string} deviceId - The device ID
   */
  startTracking(deviceId) {
    // Initialize MQTT if not already done
    this.initializeMqtt();

    // Cancel any existing tracking for this device
    this.stopTracking(deviceId);

    const timestamp = Date.now();
    
    // Set timeout to trigger WiFi reset
    const timeoutId = setTimeout(() => {
      console.log(`🐕⏰ TIMEOUT: Device ${deviceId} not registered within 30 minutes`);
      console.log(`🐕 Sending WiFi reset command to ${deviceId}...`);
      
      // Send reset command
      this.sendWiFiResetCommand(deviceId)
        .then(() => {
          console.log(`🐕✅ Successfully reset WiFi for ${deviceId}`);
        })
        .catch((error) => {
          console.error(`🐕❌ Failed to reset WiFi for ${deviceId}:`, error);
        })
        .finally(() => {
          // Clean up tracking record
          this.trackedDevices.delete(deviceId);
        });
    }, this.TIMEOUT_MS);

    // Store tracking info
    this.trackedDevices.set(deviceId, {
      timestamp,
      timeoutId,
      timeoutAt: new Date(timestamp + this.TIMEOUT_MS).toISOString()
    });

    console.log(`🐕 Started tracking device ${deviceId}`);
    console.log(`🐕 Will reset WiFi at: ${this.trackedDevices.get(deviceId).timeoutAt}`);
  }

  /**
   * Stop tracking a device (called when device is registered/saved)
   * @param {string} deviceId - The device ID
   */
  stopTracking(deviceId) {
    const tracked = this.trackedDevices.get(deviceId);
    
    if (tracked) {
      clearTimeout(tracked.timeoutId);
      this.trackedDevices.delete(deviceId);
      console.log(`🐕✋ Stopped tracking device ${deviceId} (registration confirmed)`);
      return true;
    }
    
    return false;
  }

  /**
   * Get all currently tracked devices (for debugging)
   */
  getTrackedDevices() {
    const devices = [];
    for (const [deviceId, info] of this.trackedDevices.entries()) {
      devices.push({
        deviceId,
        trackedSince: new Date(info.timestamp).toISOString(),
        timeoutAt: info.timeoutAt,
        remainingMs: info.timestamp + this.TIMEOUT_MS - Date.now()
      });
    }
    return devices;
  }

  /**
   * Cleanup on service shutdown
   */
  shutdown() {
    console.log('🐕 Shutting down watchdog service...');
    
    // Clear all timeouts
    for (const [deviceId, info] of this.trackedDevices.entries()) {
      clearTimeout(info.timeoutId);
    }
    this.trackedDevices.clear();

    // Close MQTT connection
    if (this.mqttClient) {
      this.mqttClient.end();
    }

    console.log('🐕 Watchdog service stopped');
  }
}

// Singleton instance
const watchdogService = new WatchdogService();

// Graceful shutdown
process.on('SIGTERM', () => {
  watchdogService.shutdown();
});

process.on('SIGINT', () => {
  watchdogService.shutdown();
});

module.exports = watchdogService;
