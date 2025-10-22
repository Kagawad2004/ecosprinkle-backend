const express = require('express');
const router = express.Router();
const User = require('../models/User');
const Device = require('../models/Device');
const authMiddleware = require('../middleware/auth');
const { sanitizeInput } = require('../middleware/validation');

// Apply input sanitization to all routes
router.use(sanitizeInput);

// GET /api/onboarding/status - Get user's onboarding status
router.get('/status', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).select('devices profile createdAt');
    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Check if user has completed basic profile setup
    const hasProfile = user.profile && user.profile.phone && user.profile.location;

    // Check if user has any devices
    const deviceCount = user.devices ? user.devices.length : 0;

    // Check if user has any active devices
    const activeDevices = await Device.countDocuments({
      userID: userId,
      isActive: true
    });

    // Determine onboarding status
    let onboardingStatus = 'not_started';
    let nextStep = 'complete_profile';

    if (hasProfile) {
      nextStep = 'add_device';
    }

    if (deviceCount > 0) {
      onboardingStatus = 'device_added';
      nextStep = 'configure_device';
    }

    if (activeDevices > 0) {
      onboardingStatus = 'completed';
      nextStep = null;
    }

    res.json({
      success: true,
      onboarding: {
        status: onboardingStatus,
        completed: onboardingStatus === 'completed',
        nextStep,
        progress: {
          profileCompleted: hasProfile,
          devicesAdded: deviceCount,
          activeDevices: activeDevices,
          accountAge: Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24)) // days
        }
      }
    });
  } catch (error) {
    console.error('Get onboarding status error:', error);
    res.status(500).json({
      error: 'Failed to get onboarding status',
      details: 'Unable to retrieve onboarding information. Please try again.'
    });
  }
});

// PUT /api/onboarding/profile - Update user profile during onboarding
router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { phone, location, timezone, notifications } = req.body;

    const updateData = {
      'profile.phone': phone,
      'profile.location': location,
      'profile.timezone': timezone || 'UTC',
      'profile.notifications': {
        email: notifications?.email !== false,
        push: notifications?.push !== false,
        sms: notifications?.sms || false
      }
    };

    const user = await User.findByIdAndUpdate(
      userId,
      { $set: updateData },
      { new: true }
    ).select('-password -refreshToken');

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      profile: user.profile
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({
      error: 'Failed to update profile',
      details: 'Unable to update profile information. Please try again.'
    });
  }
});

// POST /api/onboarding/device - Quick device setup during onboarding
router.post('/device', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { deviceId, deviceName, plantType } = req.body;

    if (!deviceId || !deviceName || !plantType) {
      return res.status(400).json({
        error: 'Missing required fields',
        details: 'deviceId, deviceName, and plantType are required'
      });
    }

    // Check if device already exists
    const existingDevice = await Device.findOne({ deviceId });
    if (existingDevice) {
      return res.status(409).json({
        error: 'Device already registered',
        details: 'This device is already registered in the system'
      });
    }

    // Create device with basic onboarding settings
    const device = new Device({
      userID: userId,
      deviceId,
      DeviceName: deviceName,
      deviceType: 'combined',
      plantID: null,
      Status: 'Registered',
      isActive: true,
      plantType,
      soilType: 'loam', // Default
      sunlightExposure: 'moderate', // Default
      wateringMode: 'auto',
      isWateringEnabled: true,
      thresholds: {
        dryThreshold: 1700,
        wetThreshold: 4000
      }
    });

    await device.save();

    // Update user's device list
    await User.findByIdAndUpdate(userId, {
      $push: { devices: device._id }
    });

    res.status(201).json({
      success: true,
      message: 'Device added successfully during onboarding',
      device: {
        id: device._id,
        deviceId: device.deviceId,
        deviceName: device.DeviceName,
        plantType: device.plantType,
        status: device.Status
      }
    });
  } catch (error) {
    console.error('Onboarding device setup error:', error);
    res.status(500).json({
      error: 'Failed to add device',
      details: 'Unable to add device during onboarding. Please try again.'
    });
  }
});

// POST /api/onboarding/complete - Mark onboarding as complete
router.post('/complete', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    // Verify user has completed basic onboarding requirements
    const user = await User.findById(userId).select('devices profile');
    const deviceCount = await Device.countDocuments({ userID: userId, isActive: true });

    if (!user) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Check minimum requirements
    const hasProfile = user.profile && user.profile.location;
    const hasDevice = deviceCount > 0;

    if (!hasProfile) {
      return res.status(400).json({
        error: 'Onboarding incomplete',
        details: 'Please complete your profile information first'
      });
    }

    if (!hasDevice) {
      return res.status(400).json({
        error: 'Onboarding incomplete',
        details: 'Please add at least one device to complete onboarding'
      });
    }

    // Onboarding is complete - this is just a status marker
    // The frontend can track this in local storage or user preferences

    res.json({
      success: true,
      message: 'Onboarding completed successfully',
      onboarding: {
        status: 'completed',
        completedAt: new Date(),
        summary: {
          profileCompleted: hasProfile,
          devicesAdded: deviceCount,
          accountReady: true
        }
      }
    });
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({
      error: 'Failed to complete onboarding',
      details: 'Unable to complete onboarding process. Please try again.'
    });
  }
});

// GET /api/onboarding/suggestions - Get personalized onboarding suggestions
router.get('/suggestions', authMiddleware, async (req, res) => {
  try {
    const userId = req.user.userId;

    const user = await User.findById(userId).select('devices profile createdAt');
    const deviceCount = await Device.countDocuments({ userID: userId });

    const suggestions = [];

    // Profile completion suggestions
    if (!user.profile || !user.profile.location) {
      suggestions.push({
        id: 'complete_profile',
        title: 'Complete Your Profile',
        description: 'Add your location and preferences to get personalized recommendations',
        priority: 'high',
        action: {
          type: 'navigate',
          route: '/profile'
        }
      });
    }

    // Device setup suggestions
    if (deviceCount === 0) {
      suggestions.push({
        id: 'add_first_device',
        title: 'Add Your First Device',
        description: 'Connect your EcoSprinkler device to start monitoring your plants',
        priority: 'high',
        action: {
          type: 'navigate',
          route: '/scan'
        }
      });
    } else {
      // Device configuration suggestions
      const devices = await Device.find({ userID: userId }).select('DeviceName plantType Status');
      const unconfiguredDevices = devices.filter(d => !d.plantType);

      if (unconfiguredDevices.length > 0) {
        suggestions.push({
          id: 'configure_devices',
          title: 'Configure Your Devices',
          description: `Set up plant types for ${unconfiguredDevices.length} device${unconfiguredDevices.length > 1 ? 's' : ''}`,
          priority: 'medium',
          action: {
            type: 'navigate',
            route: '/devices'
          }
        });
      }

      // Offline device suggestions
      const offlineDevices = devices.filter(d => d.Status === 'Offline');
      if (offlineDevices.length > 0) {
        suggestions.push({
          id: 'check_device_connection',
          title: 'Check Device Connections',
          description: `${offlineDevices.length} device${offlineDevices.length > 1 ? 's' : ''} appear to be offline`,
          priority: 'medium',
          action: {
            type: 'navigate',
            route: '/devices'
          }
        });
      }
    }

    // New user suggestions
    const accountAge = Math.floor((Date.now() - user.createdAt) / (1000 * 60 * 60 * 24));
    if (accountAge < 7) {
      suggestions.push({
        id: 'explore_features',
        title: 'Explore Features',
        description: 'Take a tour of the app features and learn how to get the most out of your EcoSprinkler',
        priority: 'low',
        action: {
          type: 'navigate',
          route: '/guides'
        }
      });
    }

    res.json({
      success: true,
      suggestions: suggestions.sort((a, b) => {
        const priorityOrder = { high: 3, medium: 2, low: 1 };
        return priorityOrder[b.priority] - priorityOrder[a.priority];
      })
    });
  } catch (error) {
    console.error('Get onboarding suggestions error:', error);
    res.status(500).json({
      error: 'Failed to get suggestions',
      details: 'Unable to retrieve onboarding suggestions. Please try again.'
    });
  }
});

module.exports = router;