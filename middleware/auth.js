const jwt = require('jsonwebtoken');
const User = require('../models/User');

const authMiddleware = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.header('Authorization');
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ 
        error: 'Access denied',
        details: 'No valid authorization token provided'
      });
    }

    // Extract token
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    try {
      // Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      
      // Check if user still exists
      const user = await User.findById(decoded.userId).select('-password -refreshToken');
      
      if (!user) {
        return res.status(401).json({ 
          error: 'User not found',
          details: 'The account associated with this token no longer exists'
        });
      }

      if (!user.isActive) {
        return res.status(401).json({ 
          error: 'Account deactivated',
          details: 'Your account has been deactivated'
        });
      }

      // Check if account is locked
      if (user.isAccountLocked()) {
        return res.status(423).json({ 
          error: 'Account locked',
          details: 'Your account is temporarily locked due to too many failed login attempts'
        });
      }

      // Add user to request object
      req.user = {
        userId: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role
      };

      next();
    } catch (jwtError) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token expired',
          details: 'Your session has expired. Please login again.'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token',
          details: 'The provided token is invalid'
        });
      } else {
        throw jwtError;
      }
    }
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ 
      error: 'Authentication failed',
      details: 'Unable to verify authentication. Please try again.'
    });
  }
};

// Optional auth middleware - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
  const authHeader = req.header('Authorization');
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    // If token is provided, validate it
    return authMiddleware(req, res, next);
  } else {
    // No token provided, continue without user
    req.user = null;
    next();
  }
};

// Admin middleware
const adminMiddleware = (req, res, next) => {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ 
      error: 'Admin access required',
      details: 'You do not have permission to access this resource'
    });
  }
  next();
};

module.exports = authMiddleware;
module.exports.optionalAuth = optionalAuth;
module.exports.adminMiddleware = adminMiddleware;