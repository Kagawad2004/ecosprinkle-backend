const express = require('express');
const router = express.Router();
const Log = require('../models/Log');
const Device = require('../models/Device');
const authMiddleware = require('../middleware/auth');
const { validateDeviceId, validateDateRange, sanitizeInput } = require('../middleware/validation');

// Apply input sanitization to all routes
router.use(sanitizeInput);

// GET /api/logs/:deviceId - Get historical data with time filtering
router.get('/:deviceId', authMiddleware, validateDeviceId, validateDateRange, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const { startDate, endDate, limit = 100, eventType, severity } = req.query;

    // Verify device ownership
    const device = await Device.findOne({ deviceId, userID: userId });
    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    // Build query
    const query = { deviceId, userId };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    if (eventType) {
      query.eventType = eventType;
    }

    if (severity) {
      query.severity = severity;
    }

    // Get logs
    const logs = await Log.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .populate('deviceId', 'DeviceName deviceType')
      .lean();

    // Format logs for response
    const formattedLogs = logs.map(log => ({
      id: log._id,
      timestamp: log.timestamp,
      eventType: log.eventType,
      moistureLevel: log.moistureLevel,
      temperature: log.temperature,
      actionTaken: log.actionTaken,
      severity: log.severity,
      source: log.source,
      details: log.details,
      device: {
        id: log.deviceId._id,
        name: log.deviceId.DeviceName,
        type: log.deviceId.deviceType
      }
    }));

    res.json({
      success: true,
      deviceId,
      logs: formattedLogs,
      count: formattedLogs.length,
      query: {
        startDate,
        endDate,
        limit: parseInt(limit),
        eventType,
        severity
      }
    });
  } catch (error) {
    console.error('Get logs error:', error);
    res.status(500).json({
      error: 'Failed to retrieve logs',
      details: 'Unable to fetch log data. Please try again.'
    });
  }
});

// GET /api/logs/:deviceId/graph - Get formatted data for graph visualization
router.get('/:deviceId/graph', authMiddleware, validateDeviceId, validateDateRange, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const { startDate, endDate, hours = 24 } = req.query;

    // Verify device ownership
    const device = await Device.findOne({ deviceId, userID: userId });
    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    // Calculate date range (default to last N hours)
    const end = endDate || new Date();
    const start = startDate || new Date(end.getTime() - (parseInt(hours) * 60 * 60 * 1000));

    // Get sensor reading logs
    const sensorLogs = await Log.find({
      deviceId,
      userId,
      eventType: 'sensor_reading',
      timestamp: { $gte: start, $lte: end }
    })
    .sort({ timestamp: 1 })
    .select('timestamp moistureLevel temperature details')
    .lean();

    // Get irrigation event logs
    const irrigationLogs = await Log.find({
      deviceId,
      userId,
      eventType: { $in: ['irrigation_start', 'irrigation_stop'] },
      timestamp: { $gte: start, $lte: end }
    })
    .sort({ timestamp: 1 })
    .select('timestamp eventType actionTaken')
    .lean();

    // Format data for graphing
    const moistureData = sensorLogs.map(log => ({
      timestamp: log.timestamp,
      value: log.moistureLevel,
      temperature: log.temperature
    }));

    const irrigationEvents = irrigationLogs.map(log => ({
      timestamp: log.timestamp,
      event: log.eventType,
      action: log.actionTaken
    }));

    // Calculate statistics
    const stats = {
      totalReadings: sensorLogs.length,
      averageMoisture: sensorLogs.length > 0
        ? Math.round(sensorLogs.reduce((sum, log) => sum + (log.moistureLevel || 0), 0) / sensorLogs.length)
        : 0,
      minMoisture: sensorLogs.length > 0
        ? Math.min(...sensorLogs.map(log => log.moistureLevel || 0))
        : 0,
      maxMoisture: sensorLogs.length > 0
        ? Math.max(...sensorLogs.map(log => log.moistureLevel || 0))
        : 0,
      irrigationEvents: irrigationLogs.length,
      timeRange: {
        start,
        end
      }
    };

    res.json({
      success: true,
      deviceId,
      deviceName: device.DeviceName,
      graph: {
        moisture: moistureData,
        irrigationEvents,
        stats
      }
    });
  } catch (error) {
    console.error('Get graph data error:', error);
    res.status(500).json({
      error: 'Failed to retrieve graph data',
      details: 'Unable to fetch graph data. Please try again.'
    });
  }
});

// GET /api/logs/user - Get logs for all user's devices
router.get('/user/all', authMiddleware, validateDateRange, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { startDate, endDate, limit = 50, eventType, severity } = req.query;

    // Get user's devices
    const devices = await Device.find({ userID: userId }).select('deviceId DeviceName deviceType');
    const deviceIds = devices.map(d => d.deviceId);

    // Build query
    const query = { deviceId: { $in: deviceIds }, userId };

    if (startDate || endDate) {
      query.timestamp = {};
      if (startDate) query.timestamp.$gte = startDate;
      if (endDate) query.timestamp.$lte = endDate;
    }

    if (eventType) {
      query.eventType = eventType;
    }

    if (severity) {
      query.severity = severity;
    }

    // Get logs
    const logs = await Log.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .populate('deviceId', 'DeviceName deviceType')
      .lean();

    // Format logs for response
    const formattedLogs = logs.map(log => ({
      id: log._id,
      timestamp: log.timestamp,
      eventType: log.eventType,
      moistureLevel: log.moistureLevel,
      temperature: log.temperature,
      actionTaken: log.actionTaken,
      severity: log.severity,
      source: log.source,
      details: log.details,
      device: {
        id: log.deviceId._id,
        deviceId: log.deviceId.deviceId,
        name: log.deviceId.DeviceName,
        type: log.deviceId.deviceType
      }
    }));

    res.json({
      success: true,
      userId,
      logs: formattedLogs,
      count: formattedLogs.length,
      devices: devices.map(d => ({
        deviceId: d.deviceId,
        name: d.DeviceName,
        type: d.deviceType
      })),
      query: {
        startDate,
        endDate,
        limit: parseInt(limit),
        eventType,
        severity
      }
    });
  } catch (error) {
    console.error('Get user logs error:', error);
    res.status(500).json({
      error: 'Failed to retrieve user logs',
      details: 'Unable to fetch user log data. Please try again.'
    });
  }
});

// GET /api/logs/stats/:deviceId - Get log statistics for a device
router.get('/stats/:deviceId', authMiddleware, validateDeviceId, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const userId = req.user.userId;
    const { days = 7 } = req.query;

    // Verify device ownership
    const device = await Device.findOne({ deviceId, userID: userId });
    if (!device) {
      return res.status(404).json({
        error: 'Device not found',
        details: 'The requested device does not exist or you do not have access to it'
      });
    }

    const startDate = new Date(Date.now() - (parseInt(days) * 24 * 60 * 60 * 1000));

    // Get statistics
    const stats = await Log.aggregate([
      {
        $match: {
          deviceId,
          userId,
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: '$eventType',
          count: { $sum: 1 },
          avgMoisture: { $avg: '$moistureLevel' },
          minMoisture: { $min: '$moistureLevel' },
          maxMoisture: { $max: '$moistureLevel' },
          lastEvent: { $max: '$timestamp' }
        }
      }
    ]);

    // Get daily averages
    const dailyStats = await Log.aggregate([
      {
        $match: {
          deviceId,
          userId,
          eventType: 'sensor_reading',
          timestamp: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$timestamp' }
          },
          avgMoisture: { $avg: '$moistureLevel' },
          avgTemperature: { $avg: '$temperature' },
          readingCount: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);

    res.json({
      success: true,
      deviceId,
      deviceName: device.DeviceName,
      period: `${days} days`,
      eventStats: stats,
      dailyAverages: dailyStats
    });
  } catch (error) {
    console.error('Get log stats error:', error);
    res.status(500).json({
      error: 'Failed to retrieve log statistics',
      details: 'Unable to fetch log statistics. Please try again.'
    });
  }
});

module.exports = router;