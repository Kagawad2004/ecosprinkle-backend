const express = require('express');
const router = express.Router();
const passport = require('passport');
const rateLimit = require('express-rate-limit');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const { validateRegistration, validateLogin, sanitizeInput } = require('../middleware/validation');

// Lenient rate limiter for auth routes to prevent lockouts
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Allow 50 requests per 15 minutes per IP
  message: 'Too many authentication attempts, please try again later',
  standardHeaders: true,
  legacyHeaders: false,
  // Skip rate limiting for local development
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === 'localhost'
});

// Stricter rate limiter for login attempts to prevent brute force
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Allow 20 login attempts per 15 minutes per IP
  message: 'Too many login attempts, please try again after 15 minutes',
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === 'localhost'
});

// Authentication routes
router.post('/register', authLimiter, sanitizeInput, validateRegistration, authController.register);
router.post('/login', loginLimiter, sanitizeInput, validateLogin, authController.login);
router.post('/refresh-token', authController.refreshToken);
router.post('/forgot-password', authController.forgotPassword);
router.post('/reset-password', authController.resetPassword);

// Google OAuth routes (only if configured)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  router.get('/google',
    passport.authenticate('google', {
      scope: ['profile', 'email']
    })
  );

  router.get('/google/callback',
    passport.authenticate('google', { failureRedirect: '/login' }),
    authController.googleOAuthCallback
  );

  console.log('✅ Google OAuth routes enabled');
} else {
  console.log('⚠️  Google OAuth routes disabled - configure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable');
}

// Protected routes (require authentication)
router.post('/logout', authMiddleware, authController.logout);
router.get('/me', authMiddleware, authController.getCurrentUser);
router.put('/profile', authMiddleware, authController.updateProfile);
router.put('/change-password', authMiddleware, authController.changePassword);

module.exports = router;