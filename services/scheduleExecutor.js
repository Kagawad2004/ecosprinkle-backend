const Device = require('../models/Device');
const DeviceCommand = require('../models/DeviceCommand');

/**
 * Schedule Executor Service
 * Checks all devices every minute and executes scheduled watering
 */
class ScheduleExecutor {
  constructor() {
    this.mqttClient = null;
    this.checkInterval = null;
    this.isRunning = false;
  }

  /**
   * Set MQTT client for publishing commands
   */
  setMqttClient(client) {
    this.mqttClient = client;
    console.log('📅 Schedule Executor: MQTT client set');
  }

  /**
   * Start the schedule checker (runs every minute)
   */
  start() {
    if (this.isRunning) {
      console.log('⚠️ Schedule Executor: Already running');
      return;
    }

    console.log('🚀 Schedule Executor: Starting...');
    this.isRunning = true;

    // Check immediately on start
    this.checkSchedules();

    // Then check every minute
    this.checkInterval = setInterval(() => {
      this.checkSchedules();
    }, 60000); // Check every 60 seconds

    console.log('✅ Schedule Executor: Started (checking every 60 seconds)');
  }

  /**
   * Stop the schedule checker
   */
  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
    this.isRunning = false;
    console.log('🛑 Schedule Executor: Stopped');
  }

  /**
   * Check all devices for schedules that need to execute
   */
  async checkSchedules() {
    try {
      // Get current Philippine Time (UTC+8)
      const now = new Date();
      const phTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
      const currentDay = phTime.getDay(); // 0-6 (Sun-Sat), convert to 1-7 (Mon-Sun)
      const dayOfWeek = currentDay === 0 ? 7 : currentDay; // Convert Sunday from 0 to 7
      const currentTime = `${String(phTime.getHours()).padStart(2, '0')}:${String(phTime.getMinutes()).padStart(2, '0')}`;

      console.log(`\n⏰ Schedule Executor: Checking at ${currentTime} (PH Time), Day ${dayOfWeek}`);

      // Find all devices in schedule mode with active schedules
      const devices = await Device.find({
        wateringMode: 'schedule',
        'scheduleMode.isEnabled': true,
        'scheduleMode.isPaused': false,
        'schedules.0': { $exists: true } // Has at least one schedule
      });

      if (devices.length === 0) {
        console.log('   No devices in schedule mode');
        return;
      }

      console.log(`   Found ${devices.length} device(s) in schedule mode`);

      for (const device of devices) {
        await this.checkDeviceSchedules(device, dayOfWeek, currentTime, phTime);
      }

    } catch (error) {
      console.error('❌ Schedule Executor: Error checking schedules:', error);
    }
  }

  /**
   * Check and execute schedules for a specific device
   */
  async checkDeviceSchedules(device, dayOfWeek, currentTime, phTime) {
    const deviceId = device.deviceId;
    
    try {
      // Find schedules that match current day and time
      const matchingSchedules = device.schedules.filter(schedule => {
        if (!schedule.isActive) return false;
        if (!schedule.daysOfWeek.includes(dayOfWeek)) return false;
        
        // Match time (HH:MM format)
        return schedule.time === currentTime;
      });

      if (matchingSchedules.length === 0) {
        return; // No schedules to execute right now
      }

      console.log(`   📍 Device ${deviceId}: ${matchingSchedules.length} schedule(s) to execute`);

      for (const schedule of matchingSchedules) {
        await this.executeSchedule(device, schedule, phTime);
      }

      // Update next scheduled time after execution
      await this.updateNextScheduledTime(device);

    } catch (error) {
      console.error(`❌ Schedule Executor: Error checking device ${deviceId}:`, error);
    }
  }

  /**
   * Execute a specific schedule
   */
  async executeSchedule(device, schedule, phTime) {
    const deviceId = device.deviceId;
    const duration = schedule.duration || 15; // Default 15 seconds
    
    try {
      console.log(`   💧 Executing schedule for ${deviceId}:`);
      console.log(`      Time: ${schedule.time}`);
      console.log(`      Duration: ${duration}s`);
      console.log(`      Days: ${schedule.daysOfWeek.join(',')}`);

      // Create device command record (include userID for tracking)
      const command = new DeviceCommand({
        deviceId,
        command: 'PUMP_ON',
        parameters: {
          duration,
          source: 'schedule',
          scheduleId: schedule.timeSlotId || schedule._id,
          scheduleTime: schedule.time,
          userID: device.userID // Include for consistency
        },
        status: 'pending',
        executed: false,
        timestamp: phTime
      });

      await command.save();

      // Send MQTT command to ESP32
      if (this.mqttClient) {
        const topic = `ecosprinkle/${deviceId}/command`;
        const payload = {
          command: 'PUMP_ON',
          duration,
          reason: `Scheduled watering at ${schedule.time}`,
          commandId: command._id.toString(),
          timestamp: Math.floor(phTime.getTime() / 1000),
          source: 'schedule'
        };

        console.log(`      📡 Publishing to MQTT: ${topic}`);
        this.mqttClient.publish(topic, JSON.stringify(payload), { qos: 1 });
        console.log(`      ✅ MQTT command sent successfully`);

        // Mark command as sent
        command.status = 'sent';
        await command.save();

        // Update device state
        device.isPumpOn = true;
        device.lastCommand = 'PUMP_ON (SCHEDULE)';
        device.lastCommandTime = phTime;
        device.scheduleMode.lastExecutedAt = phTime;
        device.scheduleMode.executionCount = (device.scheduleMode.executionCount || 0) + 1;
        await device.save();

        console.log(`      ✅ Schedule executed successfully`);

      } else {
        console.error(`      ❌ MQTT client not available - cannot send command!`);
        command.status = 'failed';
        command.error = 'MQTT client not available';
        await command.save();
      }

    } catch (error) {
      console.error(`❌ Schedule Executor: Error executing schedule for ${deviceId}:`, error);
    }
  }

  /**
   * Update next scheduled time after execution
   */
  async updateNextScheduledTime(device) {
    try {
      const nextSchedule = this.calculateNextScheduledTime(device.schedules);
      device.scheduleMode.nextScheduledAt = nextSchedule;
      await device.save();

      if (nextSchedule) {
        const phTime = new Date(nextSchedule.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
        console.log(`      📅 Next schedule: ${phTime.toLocaleString('en-US', { timeZone: 'Asia/Manila' })}`);
      }
    } catch (error) {
      console.error(`❌ Error updating next scheduled time:`, error);
    }
  }

  /**
   * Calculate Next Scheduled Time (Philippine Time UTC+8)
   */
  calculateNextScheduledTime(schedules) {
    if (!schedules || schedules.length === 0) return null;

    // Get current Philippine Time
    const now = new Date();
    const phTime = new Date(now.toLocaleString('en-US', { timeZone: 'Asia/Manila' }));
    const currentDay = phTime.getDay(); // 0-6 (Sun-Sat)
    const currentDayOfWeek = currentDay === 0 ? 7 : currentDay; // Convert to 1-7 (Mon-Sun)
    const currentTime = `${String(phTime.getHours()).padStart(2, '0')}:${String(phTime.getMinutes()).padStart(2, '0')}`;

    let nextSchedule = null;
    let minDiff = Infinity;

    schedules.forEach(schedule => {
      if (!schedule.isActive) return;

      schedule.daysOfWeek.forEach(day => {
        const [hours, minutes] = schedule.time.split(':').map(Number);
        
        // Calculate days until this schedule
        let daysUntil = day - currentDayOfWeek;
        if (daysUntil < 0) daysUntil += 7;
        if (daysUntil === 0 && schedule.time <= currentTime) daysUntil = 7;

        // Calculate exact datetime in Philippine Time
        const scheduledDate = new Date(phTime);
        scheduledDate.setDate(scheduledDate.getDate() + daysUntil);
        scheduledDate.setHours(hours, minutes, 0, 0);

        const diff = scheduledDate - phTime;
        if (diff > 0 && diff < minDiff) {
          minDiff = diff;
          nextSchedule = scheduledDate;
        }
      });
    });

    return nextSchedule;
  }
}

// Export singleton instance
module.exports = new ScheduleExecutor();
