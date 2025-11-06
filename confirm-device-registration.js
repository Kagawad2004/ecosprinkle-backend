const mqtt = require('mqtt');
const mongoose = require('mongoose');
const Device = require('./models/Device');
require('dotenv').config();

async function confirmDevice() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    const deviceId = 'cdbb40'; // Your device ID

    // Update device in database
    const device = await Device.findOneAndUpdate(
      { deviceId },
      { registrationConfirmed: true },
      { new: true }
    );

    if (!device) {
      console.log(`❌ Device ${deviceId} not found in database`);
      process.exit(1);
    }

    console.log('✅ Device marked as confirmed in database\n');

    // Connect to MQTT and send DEVICE_REGISTERED command
    console.log('📡 Connecting to MQTT broker...');
    const mqttClient = mqtt.connect('mqtt://broker.hivemq.com:1883');

    mqttClient.on('connect', () => {
      console.log('✅ Connected to MQTT broker\n');

      const payload = {
        command: 'DEVICE_REGISTERED',
        commandId: `manual_confirm_${Date.now()}`,
        timestamp: Math.floor(Date.now() / 1000)
      };

      const topic = `ecosprinkle/${deviceId}/command`;
      
      console.log('📤 Sending DEVICE_REGISTERED command:');
      console.log(`   Topic: ${topic}`);
      console.log(`   Payload:`, payload);
      console.log('');

      mqttClient.publish(topic, JSON.stringify(payload), (err) => {
        if (err) {
          console.error('❌ Failed to publish:', err);
          process.exit(1);
        }

        console.log('✅ DEVICE_REGISTERED command sent successfully!\n');
        console.log('🐕 Watchdog timer will be disabled on ESP32');
        console.log('📱 Device will stay connected permanently');
        console.log('');
        console.log('👀 Check ESP32 serial monitor for:');
        console.log('   📥 Received MQTT message');
        console.log('   ✅ DEVICE REGISTERED - Disabling watchdog timer');
        console.log('   🔒 Registration status saved to flash');

        setTimeout(() => {
          mqttClient.end();
          mongoose.disconnect();
          console.log('\n✅ Done!');
          process.exit(0);
        }, 2000);
      });
    });

    mqttClient.on('error', (error) => {
      console.error('❌ MQTT Error:', error);
      process.exit(1);
    });

  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

confirmDevice();
