const express = require('express');
const router = express.Router();
const passport = require('passport');
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/auth');
const { validateRegistration, validateLogin, sanitizeInput } = require('../middleware/validation');

// Authentication routes
router.post('/register', sanitizeInput, validateRegistration, authController.register);
router.post('/login', sanitizeInput, validateLogin, authController.login);
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