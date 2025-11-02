const mongoose = require('mongoose');

// Validation middleware for user registration
const validateRegistration = (req, res, next) => {
  const { email, firstName, lastName, password, confirmPassword } = req.body;

  const errors = [];

  // Email validation (optional)
  if (email && email.trim()) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.push('Please provide a valid email address');
    }
  }

  // Name validation
  if (!firstName || !firstName.trim()) {
    errors.push('First name is required');
  } else if (firstName.trim().length < 2) {
    errors.push('First name must be at least 2 characters long');
  }

  if (!lastName || !lastName.trim()) {
    errors.push('Last name is required');
  } else if (lastName.trim().length < 2) {
    errors.push('Last name must be at least 2 characters long');
  }

  // Password validation
  if (!password) {
    errors.push('Password is required');
  } else if (password.length < 8) {
    errors.push('Password must be at least 8 characters long');
  } else if (!/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/.test(password)) {
    errors.push('Password must contain at least one uppercase letter, one lowercase letter, and one number');
  }

  // Confirm password validation
  if (password !== confirmPassword) {
    errors.push('Passwords do not match');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  // Sanitize input
  if (email && email.trim()) {
    req.body.email = email.trim().toLowerCase();
  }
  req.body.firstName = firstName.trim();
  req.body.lastName = lastName.trim();

  next();
};

// Validation middleware for login
const validateLogin = (req, res, next) => {
  const { username, email, password } = req.body;

  const errors = [];

  // Accept either username or email
  if ((!username || !username.trim()) && (!email || !email.trim())) {
    errors.push('Username or email is required');
  }

  if (!password) {
    errors.push('Password is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  // Normalize the input
  if (username && username.trim()) {
    req.body.username = username.trim().toLowerCase();
  }
  if (email && email.trim()) {
    req.body.email = email.trim().toLowerCase();
  }
  
  next();
};

// Validation middleware for device registration
const validateDeviceRegistration = (req, res, next) => {
  const { deviceId, deviceName, plantType, soilType, sunlightExposure } = req.body;

  const errors = [];

  if (!deviceId || !deviceId.trim()) {
    errors.push('Device ID is required');
  }

  if (!deviceName || !deviceName.trim()) {
    errors.push('Device name is required');
  } else if (deviceName.trim().length < 2) {
    errors.push('Device name must be at least 2 characters long');
  }

  if (!plantType || !plantType.trim()) {
    errors.push('Plant type is required');
  }

  if (!soilType || !soilType.trim()) {
    errors.push('Soil type is required');
  }

  if (!sunlightExposure || !sunlightExposure.trim()) {
    errors.push('Sunlight exposure is required');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  next();
};

// Validation middleware for irrigation control
const validateIrrigationControl = (req, res, next) => {
  const { irrigationMode, pumpStatus } = req.body;

  const errors = [];

  if (irrigationMode && !['automatic', 'manual', 'scheduled'].includes(irrigationMode)) {
    errors.push('Invalid irrigation mode. Must be one of: automatic, manual, scheduled');
  }

  if (pumpStatus && !['on', 'off'].includes(pumpStatus)) {
    errors.push('Invalid pump status. Must be one of: on, off');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  next();
};

// Validation middleware for device ID parameter
const validateDeviceId = (req, res, next) => {
  const { deviceId } = req.params;

  if (!deviceId || !deviceId.trim()) {
    return res.status(400).json({
      error: 'Device ID is required'
    });
  }

  // Validate ObjectId format if needed
  if (!mongoose.Types.ObjectId.isValid(deviceId) && deviceId.length !== 24) {
    // Allow non-ObjectId device IDs (like ESP32 device IDs)
    if (deviceId.length < 3 || deviceId.length > 50) {
      return res.status(400).json({
        error: 'Invalid device ID format'
      });
    }
  }

  next();
};

// Validation middleware for date range queries
const validateDateRange = (req, res, next) => {
  const { startDate, endDate } = req.query;

  const errors = [];

  if (startDate) {
    const start = new Date(startDate);
    if (isNaN(start.getTime())) {
      errors.push('Invalid start date format');
    } else {
      req.query.startDate = start;
    }
  }

  if (endDate) {
    const end = new Date(endDate);
    if (isNaN(end.getTime())) {
      errors.push('Invalid end date format');
    } else {
      req.query.endDate = end;
    }
  }

  if (startDate && endDate && req.query.startDate > req.query.endDate) {
    errors.push('Start date cannot be after end date');
  }

  if (errors.length > 0) {
    return res.status(400).json({
      error: 'Validation failed',
      details: errors
    });
  }

  next();
};

// General input sanitization middleware
const sanitizeInput = (req, res, next) => {
  // Recursively sanitize string inputs
  const sanitize = (obj) => {
    for (let key in obj) {
      if (typeof obj[key] === 'string') {
        // Trim whitespace and remove potentially harmful characters
        obj[key] = obj[key].trim().replace(/[<>]/g, '');
      } else if (typeof obj[key] === 'object' && obj[key] !== null) {
        sanitize(obj[key]);
      }
    }
  };

  if (req.body) sanitize(req.body);
  if (req.query) sanitize(req.query);
  if (req.params) sanitize(req.params);

  next();
};

module.exports = {
  validateRegistration,
  validateLogin,
  validateDeviceRegistration,
  validateIrrigationControl,
  validateDeviceId,
  validateDateRange,
  sanitizeInput
};