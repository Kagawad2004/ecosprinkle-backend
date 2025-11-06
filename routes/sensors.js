const express = require('express');
const router = express.Router();
const authMiddleware = require('../middleware/auth');
const SensorData = require('../models/SensorData');
const Sensor = require('../models/Sensor');
const Device = require('../models/Device');

/**
 * GET /api/devices/:deviceId/sensor-data/latest
 * Get the most recent sensor reading for a device
 * Public endpoint (no auth required for quick access)
 */
router.get('/devices/:deviceId/sensor-data/latest', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    // Get latest sensor data from SensorData collection (historical)
    const latest = await SensorData.findOne({ deviceId })
      .sort({ timestamp: -1 })
      .limit(1);
    
    if (!latest) {
      return res.json({ 
        success: true, 
        deviceId, 
        data: null,
        message: 'No sensor data found for this device'
      });
    }
    
    res.json({
      success: true,
      deviceId,
      data: {
        timestamp: latest.timestamp,
        deviceTimestamp: latest.deviceTimestamp,
        zone1: latest.zone1,
        zone2: latest.zone2,
        zone3: latest.zone3,
        zone1Percent: latest.zone1Percent,
        zone2Percent: latest.zone2Percent,
        zone3Percent: latest.zone3Percent,
        dryVotes: latest.dryVotes,
        wetVotes: latest.wetVotes,
        majorityVoteDry: latest.majorityVoteDry,
        validSensors: latest.validSensors,
        sensorHealth: latest.sensorHealth,
        median: latest.median,
        pumpState: latest.pumpState,
        rssi: latest.rssi
      }
    });
  } catch (error) {
    console.error('Error getting latest sensor data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve sensor data',
      details: error.message 
    });
  }
});

/**
 * GET /api/sensor/:deviceId/history
 * Get historical sensor data for charts and logs
 * Requires authentication
 */
router.get('/sensor/:deviceId/history', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { start, end, limit = 100 } = req.query;
    
    // Build query with user ID for security
    const query = { 
      deviceId, 
      userID: req.user.userId // Ensure user can only access their own data (fixed: was req.user.id)
    };
    
    // Add date range filter if provided
    if (start && end) {
      query.timestamp = {
        $gte: new Date(start),
        $lte: new Date(end)
      };
    }
    
    // Get historical data sorted by most recent first
    const history = await SensorData.find(query)
      .sort({ timestamp: -1 })
      .limit(parseInt(limit))
      .select('timestamp deviceTimestamp zone1 zone2 zone3 zone1Percent zone2Percent zone3Percent dryVotes wetVotes majorityVoteDry validSensors sensorHealth median pumpState rssi');
    
    res.json({
      success: true,
      deviceId,
      count: history.length,
      data: history
    });
  } catch (error) {
    console.error('Error getting sensor history:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve sensor history',
      details: error.message 
    });
  }
});

/**
 * GET /api/devices/:deviceId/sensor/current
 * Get current sensor state from Sensor collection
 * Public endpoint (no auth required for quick access)
 */
router.get('/devices/:deviceId/sensor/current', async (req, res) => {
  try {
    const { deviceId } = req.params;
    
    const sensor = await Sensor.findOne({ deviceId });
    
    if (!sensor) {
      return res.json({ 
        success: true, 
        deviceId, 
        sensor: null,
        message: 'No current sensor state found for this device'
      });
    }
    
    res.json({
      success: true,
      deviceId,
      sensor: {
        zone1: sensor.zone1,
        zone2: sensor.zone2,
        zone3: sensor.zone3,
        votingResults: sensor.votingResults,
        sensorHealth: sensor.sensorHealth,
        pumpState: sensor.pumpState,
        rssi: sensor.rssi,
        deviceTimestamp: sensor.deviceTimestamp,
        moistureLevel: sensor.moistureLevel, // Average moisture (legacy)
        lastUpdated: sensor.lastUpdated
      }
    });
  } catch (error) {
    console.error('Error getting current sensor state:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve current sensor state',
      details: error.message 
    });
  }
});

/**
 * GET /api/sensor/:deviceId/recent
 * Get recent sensor readings (last 10)
 * Useful for quick display without full history
 */
router.get('/sensor/:deviceId/recent', async (req, res) => {
  try {
    const { deviceId } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    
    const recentData = await SensorData.find({ deviceId })
      .sort({ timestamp: -1 })
      .limit(limit)
      .select('timestamp zone1Percent zone2Percent zone3Percent majorityVoteDry validSensors sensorHealth pumpState');
    
    res.json({
      success: true,
      deviceId,
      count: recentData.length,
      data: recentData
    });
  } catch (error) {
    console.error('Error getting recent sensor data:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to retrieve recent sensor data',
      details: error.message 
    });
  }
});

/**
 * GET /api/sensor/:deviceId/stats
 * Get sensor statistics (min, max, average over time period)
 * Requires authentication
 */
router.get('/sensor/:deviceId/stats', authMiddleware, async (req, res) => {
  try {
    const { deviceId } = req.params;
    const { start, end } = req.query;
    
    const query = { 
      deviceId,
      userID: req.user.userId
    };
    
    if (start && end) {
      query.timestamp = {
        $gte: new Date(start),
        $lte: new Date(end)
      };
    }
    
    // Calculate statistics using MongoDB aggregation
    const stats = await SensorData.aggregate([
      { $match: query },
      {
        $group: {
          _id: '$deviceId',
          avgZone1: { $avg: '$zone1Percent' },
          avgZone2: { $avg: '$zone2Percent' },
          avgZone3: { $avg: '$zone3Percent' },
          minZone1: { $min: '$zone1Percent' },
          minZone2: { $min: '$zone2Percent' },
          minZone3: { $min: '$zone3Percent' },
          maxZone1: { $max: '$zone1Percent' },
          maxZone2: { $max: '$zone2Percent' },
          maxZone3: { $max: '$zone3Percent' },
          totalReadings: { $sum: 1 },
          dryCount: { $sum: { $cond: ['$majorityVoteDry', 1, 0] } },
          wetCount: { $sum: { $cond: ['$majorityVoteDry', 0, 1] } }
        }
      }
    ]);
    
    if (stats.length === 0) {
      return res.json({
        success: true,
        deviceId,
        stats: null,
        message: 'No data available for statistics'
      });
    }
    
    res.json({
      success: true,
      deviceId,
      stats: {
        zone1: {
          average: Math.round(stats[0].avgZone1),
          min: stats[0].minZone1,
          max: stats[0].maxZone1
        },
        zone2: {
          average: Math.round(stats[0].avgZone2),
          min: stats[0].minZone2,
          max: stats[0].maxZone2
        },
        zone3: {
          average: Math.round(stats[0].avgZone3),
          min: stats[0].minZone3,
          max: stats[0].maxZone3
        },
        totalReadings: stats[0].totalReadings,
        dryPercentage: Math.round((stats[0].dryCount / stats[0].totalReadings) * 100),
        wetPercentage: Math.round((stats[0].wetCount / stats[0].totalReadings) * 100)
      }
    });
  } catch (error) {
    console.error('Error calculating sensor stats:', error);
    res.status(500).json({ 
      success: false, 
      error: 'Failed to calculate sensor statistics',
      details: error.message 
    });
  }
});

module.exports = router;
