/**
 * EMERGENCY FIX: Reset pump state to OFF
 * Run this to fix stuck pump state in database
 */

const mongoose = require('mongoose');
require('dotenv').config();

const Device = require('./models/Device');

async function resetPumpState() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Reset all devices with isPumpOn=true to false
    const result = await Device.updateMany(
      { isPumpOn: true },
      { $set: { isPumpOn: false } }
    );

    console.log(`✅ Reset pump state for ${result.modifiedCount} devices`);
    console.log('   All devices now show isPumpOn=false');

    process.exit(0);
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

resetPumpState();
