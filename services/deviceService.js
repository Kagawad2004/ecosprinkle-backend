const Device = require('../models/Device');

exports.updateMoistureLevel = async (deviceId, moistureLevel) => {
  try {
    const device = await Device.findOneAndUpdate(
      { deviceId },
      { 
        $set: { 
          moistureLevel,
          lastUpdate: new Date()
        }
      },
      { new: true }
    );
    return device;
  } catch (error) {
    throw new Error(`Error updating moisture level: ${error.message}`);
  }
};

exports.getDeviceSchedule = async (deviceId) => {
  try {
    const device = await Device.findOne({ deviceId });
    return device?.schedule || [];
  } catch (error) {
    throw new Error(`Error fetching device schedule: ${error.message}`);
  }
};

exports.updateSchedule = async (deviceId, schedule) => {
  try {
    const device = await Device.findOneAndUpdate(
      { deviceId },
      { $set: { schedule } },
      { new: true }
    );
    return device;
  } catch (error) {
    throw new Error(`Error updating schedule: ${error.message}`);
  }
};

exports.manualControl = async (deviceId, action) => {
  try {
    const device = await Device.findOne({ deviceId });
    if (!device) {
      throw new Error('Device not found');
    }
    // Implement manual control logic here
    return { success: true, message: `Manual ${action} executed for device ${deviceId}` };
  } catch (error) {
    throw new Error(`Error in manual control: ${error.message}`);
  }
};