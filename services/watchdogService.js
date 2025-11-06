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
    });

    this.mqttClient.on('error', (error) => {
      console.error('🐕 Watchdog MQTT error:', error);
    });

    this.mqttClient.on('close', () => {
      console.log('🐕 Watchdog MQTT disconnected');
    });
  }

  /**
   * Send WiFi reset command via MQTT
   */
  sendWiFiResetCommand(deviceId) {
    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        console.error('🐕 MQTT not connected, cannot send reset command');
        reject(new Error('MQTT not connected'));
        return;
      }

      const topic = `ecosprinkle/${deviceId}/command`;
      const payload = JSON.stringify({
        command: 'RESET_WIFI',
        commandId: `reset-${Date.now()}`,
        timestamp: new Date().toISOString(),
        reason: 'Registration timeout - device not saved within 30 minutes'
      });

      this.mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
          console.error(`🐕 Failed to send WiFi reset to ${deviceId}:`, error);
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
      if (!this.mqttClient || !this.mqttClient.connected) {
        console.error('🐕 MQTT not connected, cannot send registration confirmation');
        reject(new Error('MQTT not connected'));
        return;
      }

      const topic = `ecosprinkle/${deviceId}/command`;
      const payload = JSON.stringify({
        command: 'DEVICE_REGISTERED',
        commandId: `reg-${Date.now()}`,
        timestamp: new Date().toISOString()
      });

      this.mqttClient.publish(topic, payload, { qos: 1 }, (error) => {
        if (error) {
          console.error(`🐕 Failed to send registration confirmation to ${deviceId}:`, error);
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
