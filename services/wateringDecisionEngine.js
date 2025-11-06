const Device = require('../models/Device');
const SensorData = require('../models/SensorData');

class WateringDecisionEngine {
  constructor() {
    // Plant type to threshold mapping (from table formulas)
    this.plantThresholds = {
      'Leafy Vegetables': { dry: 30, wet: 85, description: 'Lettuce, Spinach, Kale' },
      'Tomatoes': { dry: 20, wet: 75, description: 'Tomatoes, Peppers' },
      'Root Vegetables': { dry: 25, wet: 80, description: 'Carrots, Potatoes, Beets' },
      'Herbs': { dry: 35, wet: 90, description: 'Basil, Mint, Parsley' },
      'Fruiting Plants': { dry: 20, wet: 75, description: 'Cucumbers, Squash' },
      'Others': { dry: 20, wet: 80, description: 'General purpose' }
    };
    
    this.mqttClient = null;
  }

  /**
   * Set MQTT client for publishing commands
   */
  setMqttClient(client) {
    this.mqttClient = client;
  }

  /**
   * CRITICAL: ADC-to-Moisture conversion
   * RESISTIVE SENSORS: HIGH ADC = DRY, LOW ADC = WET (INVERTED!)
   */
  calculateMoisturePercent(adc, zoneCalibration) {
    const { dry, wet } = zoneCalibration; // dry = HIGH ADC (4095), wet = LOW ADC (1050)
    
    // Clamp ADC to calibration range
    if (adc < wet) adc = wet;   // Below wet threshold (low ADC)
    if (adc > dry) adc = dry;   // Above dry threshold (high ADC)
    
    // Calculate percentage: INVERTED for resistive sensors
    // DRY (4095 ADC) → 0%
    // WET (1050 ADC) → 100%
    const percent = Math.round(100 - ((adc - wet) / (dry - wet)) * 100);
    return Math.max(0, Math.min(100, percent));
  }

  /**
   * Get thresholds for a plant type (from table formulas)
   */
  getThresholdsForPlant(plantType) {
    return this.plantThresholds[plantType] || this.plantThresholds['Others'];
  }

  /**
   * Get default calibration values for a zone
   * RESISTIVE SENSORS: HIGH ADC = DRY, LOW ADC = WET (INVERTED!)
   */
  getDefaultCalibration() {
    return {
      zone1: { dry: 4095, wet: 1050 }, // dry = HIGH ADC (4095), wet = LOW ADC (1050)
      zone2: { dry: 4095, wet: 1070 }, // Resistive sensor behavior
      zone3: { dry: 4095, wet: 1150 }  // Resistive sensor behavior
    };
  }

  /**
   * Process sensor data and decide if watering is needed
   */
  async processSensorData(deviceId, sensorData) {
    try {
      // Get device settings from database
      const device = await Device.findOne({ deviceId });
      if (!device) {
        console.log(`Device ${deviceId} not found in database`);
        return;
      }

      // 🐕 WATCHDOG SAFETY: Auto-confirm registration if device exists in DB
      // This prevents the 30-minute watchdog from resetting WiFi during normal operation
      if (!device.registrationConfirmed && this.mqttClient) {
        console.log(`🐕 Device ${deviceId} found in DB but not confirmed - sending DEVICE_REGISTERED`);
        await this.sendRegistrationConfirmation(deviceId);
        
        // 🧪 NEW: Send 5-second test pump on first connection to verify hardware
        console.log(`🧪 Triggering 5-second connection test pump for ${deviceId}`);
        await this.sendConnectionTestPump(deviceId, 5);
        
        // Mark as confirmed in database
        await Device.findOneAndUpdate(
          { deviceId },
          { registrationConfirmed: true }
        );
      }

      // Get calibration (use custom or default)
      const calibration = device.calibration || this.getDefaultCalibration();

      // Calculate moisture percentages for each zone
      const zone1Percent = this.calculateMoisturePercent(sensorData.zone1, calibration.zone1);
      const zone2Percent = this.calculateMoisturePercent(sensorData.zone2, calibration.zone2);
      const zone3Percent = this.calculateMoisturePercent(sensorData.zone3, calibration.zone3);

      // Get thresholds (use custom or from plant type)
      const thresholds = device.customThresholds || 
        this.getThresholdsForPlant(device.plantType || 'Others');

      // Majority voting logic
      const dryVotes = [zone1Percent, zone2Percent, zone3Percent]
        .filter(p => p < thresholds.dry).length;
      
      const wetVotes = [zone1Percent, zone2Percent, zone3Percent]
        .filter(p => p > thresholds.wet).length;

      const shouldWater = dryVotes >= 2; // 2 or more zones are dry
      const shouldStop = wetVotes >= 2;  // 2 or more zones are wet

      console.log(`\n📊 Device ${deviceId} Analysis:`);
      console.log(`   Plant Type: ${device.plantType}`);
      console.log(`   Mode: ${device.wateringMode}`);
      console.log(`   Zone 1: ${zone1Percent}% [ADC: ${sensorData.zone1}]`);
      console.log(`   Zone 2: ${zone2Percent}% [ADC: ${sensorData.zone2}]`);
      console.log(`   Zone 3: ${zone3Percent}% [ADC: ${sensorData.zone3}]`);
      console.log(`   Dry threshold: ${thresholds.dry}%`);
      console.log(`   Wet threshold: ${thresholds.wet}%`);
      console.log(`   Votes: Dry=${dryVotes}, Wet=${wetVotes}`);
      console.log(`   Decision: Should water = ${shouldWater}`);

      // Only take action in AUTO mode
      if (device.wateringMode === 'auto') {
        if (shouldWater && !device.isPumpOn) {
          await this.sendPumpCommand(deviceId, 'PUMP_ON', 60, 
            `${dryVotes}/3 zones below ${thresholds.dry}% threshold`);
        } else if (shouldStop && device.isPumpOn) {
          await this.sendPumpCommand(deviceId, 'PUMP_OFF', 0, 
            `${wetVotes}/3 zones above ${thresholds.wet}% threshold`);
        }
      }

      // Store processed data in database
      await this.storeSensorData(deviceId, sensorData, {
        zone1Percent,
        zone2Percent,
        zone3Percent,
        dryVotes,
        wetVotes,
        majorityVoteDry: shouldWater,
        validSensors: 3
      });

    } catch (error) {
      console.error(`Error processing sensor data for ${deviceId}:`, error);
    }
  }

  /**
   * Send pump command to ESP32 via MQTT
   */
  async sendPumpCommand(deviceId, command, duration, reason) {
    const commandId = `cmd_${Date.now()}`;
    const payload = {
      command,
      duration,
      reason,
      commandId,
      timestamp: Math.floor(Date.now() / 1000)
    };

    console.log(`📤 Sending ${command} to ${deviceId}: ${reason}`);
    
    if (this.mqttClient) {
      this.mqttClient.publish(`ecosprinkle/${deviceId}/command`, JSON.stringify(payload));
    }

    // Update device state in database
    await Device.findOneAndUpdate(
      { deviceId },
      { 
        isPumpOn: command === 'PUMP_ON',
        lastCommand: command,
        lastCommandTime: new Date()
      }
    );
  }

  /**
   * Send DEVICE_REGISTERED confirmation to disable watchdog timer
   */
  async sendRegistrationConfirmation(deviceId) {
    const payload = {
      command: 'DEVICE_REGISTERED',
      commandId: `reg_${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000)
    };

    console.log(`🐕 Sending DEVICE_REGISTERED to ${deviceId} to disable watchdog`);
    
    if (this.mqttClient) {
      this.mqttClient.publish(`ecosprinkle/${deviceId}/command`, JSON.stringify(payload));
    }
  }

  /**
   * 🧪 TEST PUMP: Send quick pump test when device first connects
   * This verifies MQTT connectivity and pump hardware functionality
   */
  async sendConnectionTestPump(deviceId, testDuration = 5) {
    const payload = {
      command: 'PUMP_ON',
      duration: testDuration, // Short 5-second test
      reason: 'Connection test - Verifying MQTT and pump hardware',
      commandId: `test_${Date.now()}`,
      timestamp: Math.floor(Date.now() / 1000),
      isTest: true
    };

    console.log(`🧪 Sending ${testDuration}s connection test pump to ${deviceId}`);
    
    if (this.mqttClient) {
      this.mqttClient.publish(`ecosprinkle/${deviceId}/command`, JSON.stringify(payload));
    }

    // Update device state in database
    await Device.findOneAndUpdate(
      { deviceId },
      { 
        isPumpOn: true,
        lastCommand: 'PUMP_ON (TEST)',
        lastCommandTime: new Date()
      }
    );

    // Auto turn off after test duration
    setTimeout(async () => {
      await Device.findOneAndUpdate(
        { deviceId },
        { isPumpOn: false }
      );
    }, testDuration * 1000 + 1000); // Add 1 second buffer
  }

  /**
   * Send configuration to ESP32 when device connects
   */
  async sendDeviceConfig(deviceId) {
    try {
      const device = await Device.findOne({ deviceId });
      if (!device) return;

      const thresholds = device.customThresholds || 
        this.getThresholdsForPlant(device.plantType || 'Others');
      
      const calibration = device.calibration || this.getDefaultCalibration();

      const config = {
        thresholds: {
          dryPercent: thresholds.dry,
          wetPercent: thresholds.wet
        },
        calibration,
        mode: device.wateringMode || 'auto',
        plantType: device.plantType || 'Others',
        deviceName: device.deviceName || device.DeviceName || 'EcoSprinkle Device'
      };

      console.log(`📤 Sending config to ${deviceId}:`, config);
      
      if (this.mqttClient) {
        this.mqttClient.publish(`ecosprinkle/${deviceId}/config`, JSON.stringify(config));
      }
    } catch (error) {
      console.error(`Error sending config to ${deviceId}:`, error);
    }
  }

  /**
   * Store sensor data with calculated percentages
   */
  async storeSensorData(deviceId, rawData, processedData) {
    try {
      const device = await Device.findOne({ deviceId });
      
      // Calculate median ADC from 3 zones
      const adcValues = [rawData.zone1, rawData.zone2, rawData.zone3].sort((a, b) => a - b);
      const median = adcValues[1]; // Middle value
      
      // Determine sensor health based on valid sensors
      const sensorHealth = processedData.validSensors === 3 ? 'normal' :
                          processedData.validSensors === 2 ? 'degraded' :
                          processedData.validSensors === 1 ? 'warning' : 'error';
      
      const sensorEntry = new SensorData({
        deviceId,
        userID: device?.userID,
        zone1: rawData.zone1,
        zone2: rawData.zone2,
        zone3: rawData.zone3,
        zone1Percent: processedData.zone1Percent,
        zone2Percent: processedData.zone2Percent,
        zone3Percent: processedData.zone3Percent,
        dryVotes: processedData.dryVotes,
        wetVotes: processedData.wetVotes,
        majorityVoteDry: processedData.majorityVoteDry,
        validSensors: processedData.validSensors,
        median: median,
        sensorHealth: sensorHealth,
        pumpState: rawData.pumpState ? 1 : 0,
        rssi: rawData.rssi || -50,
        timestamp: rawData.timestamp ? new Date(rawData.timestamp * 1000) : new Date(),
        deviceTimestamp: rawData.timestamp || Date.now()
      });

      await sensorEntry.save();
      console.log(`✅ Watering engine: Sensor data saved to SensorData collection`);
    } catch (error) {
      console.error(`❌ Watering engine: Error storing sensor data:`, error);
    }
  }
}

module.exports = new WateringDecisionEngine();
