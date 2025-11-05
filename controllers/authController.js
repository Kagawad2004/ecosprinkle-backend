const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const crypto = require('crypto');

// ============ FINAL DEFENSE REVISION: USERNAME-BASED VALIDATION ============
// Input validation helpers
const validateUsername = (username) => {
  // 3-30 characters, letters, numbers, underscores only
  const usernameRegex = /^[a-zA-Z0-9_]{3,30}$/;
  return usernameRegex.test(username);
};

const validateEmail = (email) => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
};

const validatePassword = (password) => {
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
  const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d@$!%*?&]{8,}$/;
  return passwordRegex.test(password);
};

// Generate tokens
const generateTokens = (user) => {
  const accessToken = jwt.sign(
    { userId: user._id, username: user.username, email: user.email },
    process.env.JWT_SECRET,
    { expiresIn: '24h' }
  );
  
  const refreshToken = jwt.sign(
    { userId: user._id },
    process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET,
    { expiresIn: '30d' }
  );
  
  return { accessToken, refreshToken };
};

// Register new user
exports.register = async (req, res) => {
  try {
    const { username, firstName, lastName, email, password, confirmPassword } = req.body;

    // Input validation - username is required, email is optional
    if (!username || !password || !firstName || !lastName) {
      return res.status(400).json({ 
        error: 'Required fields missing',
        details: 'Username, first name, last name, and password are required'
      });
    }

    if (!validateUsername(username)) {
      return res.status(400).json({ 
        error: 'Invalid username format',
        details: 'Username must be 3-30 characters using only letters, numbers, and underscores'
      });
    }

    // Validate email only if provided and not empty
    if (email && email.trim() !== '' && !validateEmail(email)) {
      return res.status(400).json({ 
        error: 'Invalid email format',
        details: 'Please enter a valid email address or leave it blank'
      });
    }

    if (!validatePassword(password)) {
      return res.status(400).json({ 
        error: 'Password does not meet requirements',
        details: 'Password must be at least 8 characters with uppercase, lowercase, and number'
      });
    }

    if (password !== confirmPassword) {
      return res.status(400).json({ 
        error: 'Passwords do not match',
        details: 'Password and confirm password must be identical'
      });
    }

    // Check if username already exists
    const existingUsername = await User.findOne({ username: username.toLowerCase() });
    if (existingUsername) {
      return res.status(409).json({ 
        error: 'Username already taken',
        details: 'This username is already in use. Please choose another.'
      });
    }

    // Check if email already exists (only if email is provided and not empty)
    if (email && email.trim() !== '') {
      const existingEmail = await User.findOne({ email: email.toLowerCase() });
      if (existingEmail) {
        return res.status(409).json({ 
          error: 'Email already registered',
          details: 'An account with this email address already exists'
        });
      }
    }

    // Create new user (password will be hashed by pre-save hook)
    // IMPORTANT: Don't set email field at all if not provided (not even undefined)
    const userData = {
      username: username.toLowerCase(),
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      password,
      profile: {
        lastLogin: new Date()
      }
    };
    
    // Only add email field if it's provided and not empty
    if (email && email.trim() !== '') {
      userData.email = email.toLowerCase();
    }
    
    const user = new User(userData);

    await user.save();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Update user with refresh token
    user.refreshToken = refreshToken;
    await user.save();

    res.status(201).json({
      success: true,
      message: 'Account created successfully',
      accessToken,
      refreshToken,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
        displayName: user.displayName
      }
    });
  } catch (error) {
    console.error('Registration error:', error);
    
    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      
      // Special handling for email duplicate errors when email is null/undefined
      if (field === 'email' && (!email || email.trim() === '')) {
        console.error('🚨 CRITICAL: Email duplicate key error with no email provided!');
        console.error('This indicates a database index issue. Run fix-email-null-issue.js');
        return res.status(500).json({ 
          error: 'Database configuration error',
          details: 'There is a database configuration issue. Please contact support or check server logs.'
        });
      }
      
      // Provide user-friendly field names
      const fieldName = field === 'username' ? 'username' : field;
      const article = field === 'email' ? 'an' : 'a';
      
      return res.status(409).json({ 
        error: `This ${fieldName} is already taken`,
        details: `Please choose ${article} different ${fieldName}.`
      });
    }
    
    res.status(500).json({ 
      error: 'Registration failed',
      details: 'Unable to create account. Please try again later.'
    });
  }
};

// Login user
exports.login = async (req, res) => {
  try {
    const { username, email, password, rememberMe = false } = req.body;

    // Input validation - accept either username or email
    if ((!username && !email) || !password) {
      return res.status(400).json({ 
        error: 'Missing credentials',
        details: 'Username/email and password are required'
      });
    }

    // Determine login method and validate format
    let query = {};
    if (username && username.trim()) {
      if (!validateUsername(username)) {
        return res.status(400).json({ 
          error: 'Invalid username format',
          details: 'Please enter a valid username'
        });
      }
      query = { username: username.toLowerCase() };
    } else if (email && email.trim()) {
      if (!validateEmail(email)) {
        return res.status(400).json({ 
          error: 'Invalid email format',
          details: 'Please enter a valid email address'
        });
      }
      query = { email: email.toLowerCase() };
    }

    // Find user by username or email
    const user = await User.findOne(query);
    if (!user) {
      return res.status(401).json({ 
        error: 'Invalid credentials',
        details: 'Username or password is incorrect'
      });
    }

    // Check if account is locked
    if (user.isAccountLocked()) {
      const lockTimeRemaining = Math.ceil((user.lockUntil - Date.now()) / (1000 * 60));
      return res.status(423).json({ 
        error: 'Account temporarily locked',
        details: `Too many failed attempts. Try again in ${lockTimeRemaining} minutes.`
      });
    }

    // Check password
    const isPasswordValid = await user.comparePassword(password);
    if (!isPasswordValid) {
      // Increment failed login attempts
      await user.incrementLoginAttempts();
      
      return res.status(401).json({ 
        error: 'Invalid credentials',
        details: 'Username or password is incorrect'
      });
    }

    // Reset failed attempts on successful login
    if (user.failedLoginAttempts > 0) {
      await user.resetLoginAttempts();
    }

    // Update last login
    user.profile = user.profile || {};
    user.profile.lastLogin = new Date();
    
    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);
    
    // Store refresh token
    user.refreshToken = refreshToken;
    await user.save();

    res.json({
      success: true,
      message: 'Login successful',
      accessToken,
      refreshToken,
      expiresIn: rememberMe ? '30 days' : '24 hours',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
        displayName: user.displayName,
        lastLogin: user.profile.lastLogin
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ 
      error: 'Login failed',
      details: 'Unable to process login. Please try again later.'
    });
  }
};

// Refresh token
exports.refreshToken = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    
    if (!refreshToken) {
      return res.status(401).json({ 
        error: 'Refresh token required',
        details: 'No refresh token provided'
      });
    }

    // Verify refresh token
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET);
    
    // Find user and validate refresh token
    const user = await User.findById(decoded.userId);
    if (!user || user.refreshToken !== refreshToken) {
      return res.status(401).json({ 
        error: 'Invalid refresh token',
        details: 'Please login again'
      });
    }

    // Generate new tokens
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(user);
    
    // Update refresh token
    user.refreshToken = newRefreshToken;
    await user.save();

    res.json({
      success: true,
      accessToken,
      refreshToken: newRefreshToken
    });
  } catch (error) {
    console.error('Token refresh error:', error);
    res.status(401).json({ 
      error: 'Token refresh failed',
      details: 'Please login again'
    });
  }
};

// Forgot password
exports.forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !validateEmail(email)) {
      return res.status(400).json({ 
        error: 'Valid email required',
        details: 'Please enter a valid email address'
      });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    
    // Always return success to prevent email enumeration
    const successResponse = {
      success: true,
      message: 'Password reset instructions sent',
      details: 'If an account exists with this email, you will receive reset instructions.'
    };
    
    if (!user) {
      return res.json(successResponse);
    }

    // Generate reset token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const resetTokenHash = crypto.createHash('sha256').update(resetToken).digest('hex');
    
    user.passwordResetToken = resetTokenHash;
    user.passwordResetExpires = Date.now() + (30 * 60 * 1000); // 30 minutes
    await user.save();

    // For now, just return the token in response (in production, send email)
    console.log(`Password reset token for ${email}: ${resetToken}`);

    res.json({
      ...successResponse,
      resetToken // Remove this in production
    });
  } catch (error) {
    console.error('Forgot password error:', error);
    res.status(500).json({ 
      error: 'Password reset failed',
      details: 'Unable to process password reset. Please try again later.'
    });
  }
};

// Reset password
exports.resetPassword = async (req, res) => {
  try {
    const { token, newPassword, confirmPassword } = req.body;

    if (!token || !newPassword || !confirmPassword) {
      return res.status(400).json({ 
        error: 'All fields required',
        details: 'Token, new password, and confirmation are required'
      });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({ 
        error: 'Password does not meet requirements',
        details: 'Password must be at least 8 characters with uppercase, lowercase, and number'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({ 
        error: 'Passwords do not match',
        details: 'New password and confirmation must be identical'
      });
    }

    // Hash the token to compare with stored hash
    const resetTokenHash = crypto.createHash('sha256').update(token).digest('hex');
    
    // Find user with valid reset token
    const user = await User.findOne({
      passwordResetToken: resetTokenHash,
      passwordResetExpires: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({ 
        error: 'Invalid or expired token',
        details: 'Password reset token is invalid or has expired'
      });
    }

    // Update user password and clear reset token
    user.password = newPassword; // Will be hashed by pre-save hook
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    user.refreshToken = undefined; // Invalidate existing sessions
    
    await user.save();

    res.json({
      success: true,
      message: 'Password reset successful',
      details: 'Your password has been updated. Please login with your new password.'
    });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ 
      error: 'Password reset failed',
      details: 'Unable to reset password. Please try again later.'
    });
  }
};

// Logout
exports.logout = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId);
    if (user) {
      user.refreshToken = undefined;
      await user.save();
    }

    res.json({
      success: true,
      message: 'Logout successful',
      details: 'You have been successfully logged out'
    });
  } catch (error) {
    console.error('Logout error:', error);
    res.status(500).json({ 
      error: 'Logout failed',
      details: 'Unable to complete logout. Please try again.'
    });
  }
};

// Get current user
exports.getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password -refreshToken -passwordResetToken');
    if (!user) {
      return res.status(404).json({ 
        error: 'User not found',
        details: 'Your account could not be found'
      });
    }

    res.json({
      success: true,
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
        displayName: user.displayName,
        profile: user.profile,
        createdAt: user.createdAt
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    res.status(500).json({ 
      error: 'Unable to fetch user data',
      details: 'Please try again later'
    });
  }
};

// Update profile
exports.updateProfile = async (req, res) => {
  try {
    const { firstName, lastName, phone, location } = req.body;
    
    const updateData = {};
    if (firstName) updateData.firstName = firstName.trim();
    if (lastName) updateData.lastName = lastName.trim();
    if (phone) updateData['profile.phone'] = phone.trim();
    if (location) updateData['profile.location'] = location.trim();
    
    const user = await User.findByIdAndUpdate(
      req.user.userId,
      updateData,
      { new: true, select: '-password -refreshToken -passwordResetToken' }
    );

    res.json({
      success: true,
      message: 'Profile updated successfully',
      user: {
        id: user._id,
        username: user.username,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        fullName: `${user.firstName} ${user.lastName}`,
        displayName: user.displayName,
        profile: user.profile
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ 
      error: 'Profile update failed',
      details: 'Unable to update profile. Please try again later.'
    });
  }
};

// Change password
exports.changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword, confirmPassword } = req.body;

    if (!currentPassword || !newPassword || !confirmPassword) {
      return res.status(400).json({
        error: 'All fields required',
        details: 'Current password, new password, and confirmation are required'
      });
    }

    if (!validatePassword(newPassword)) {
      return res.status(400).json({
        error: 'Password does not meet requirements',
        details: 'Password must be at least 8 characters with uppercase, lowercase, and number'
      });
    }

    if (newPassword !== confirmPassword) {
      return res.status(400).json({
        error: 'Passwords do not match',
        details: 'New password and confirmation must be identical'
      });
    }

    const user = await User.findById(req.user.userId);
    if (!user) {
      return res.status(404).json({
        error: 'User not found',
        details: 'Your account could not be found'
      });
    }

    // Verify current password
    const isCurrentPasswordValid = await user.comparePassword(currentPassword);
    if (!isCurrentPasswordValid) {
      return res.status(401).json({
        error: 'Current password incorrect',
        details: 'Please enter your correct current password'
      });
    }

    // Update password and invalidate all sessions
    user.password = newPassword; // Will be hashed by pre-save hook
    user.refreshToken = undefined;
    await user.save();

    res.json({
      success: true,
      message: 'Password changed successfully',
      details: 'Please login again with your new password'
    });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({
      error: 'Password change failed',
      details: 'Unable to change password. Please try again later.'
    });
  }
};

// Google OAuth callback handler
exports.googleOAuthCallback = async (req, res) => {
  try {
    // User is authenticated via passport, available in req.user
    const googleUser = req.user;

    if (!googleUser) {
      return res.status(401).json({
        error: 'Google authentication failed',
        details: 'Unable to authenticate with Google'
      });
    }

    // Find or create user based on Google profile
    let user = await User.findOne({ 'google.id': googleUser.id });

    if (!user) {
      // Check if user exists with same email
      const existingUser = await User.findOne({ email: googleUser.email });

      if (existingUser) {
        // Link Google account to existing user
        existingUser.google = {
          id: googleUser.id,
          email: googleUser.email,
          name: googleUser.displayName,
          picture: googleUser.photos?.[0]?.value
        };
        user = await existingUser.save();
      } else {
        // Create new user from Google profile
        user = new User({
          firstName: googleUser.name?.givenName || googleUser.displayName.split(' ')[0] || 'Google',
          lastName: googleUser.name?.familyName || googleUser.displayName.split(' ').slice(1).join(' ') || 'User',
          email: googleUser.email,
          google: {
            id: googleUser.id,
            email: googleUser.email,
            name: googleUser.displayName,
            picture: googleUser.photos?.[0]?.value
          },
          profile: {
            lastLogin: new Date(),
            authProvider: 'google'
          },
          // Set a random password for Google users (they won't use it)
          password: crypto.randomBytes(32).toString('hex')
        });
        await user.save();
      }
    }

    // Update last login
    user.profile = user.profile || {};
    user.profile.lastLogin = new Date();

    // Generate tokens
    const { accessToken, refreshToken } = generateTokens(user);

    // Store refresh token
    user.refreshToken = refreshToken;
    await user.save();

    // For API clients, return JSON response
    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
      return res.json({
        success: true,
        message: 'Google authentication successful',
        accessToken,
        refreshToken,
        user: {
          id: user._id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          fullName: `${user.firstName} ${user.lastName}`,
          profile: user.profile,
          googleProfile: user.google
        }
      });
    }

    // For web clients, redirect with tokens in query params (not recommended for production)
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    const params = new URLSearchParams({
      accessToken,
      refreshToken,
      success: 'true'
    });

    res.redirect(`${redirectUrl}/auth/callback?${params.toString()}`);
  } catch (error) {
    console.error('Google OAuth callback error:', error);

    if (req.headers.accept?.includes('application/json') || req.query.format === 'json') {
      return res.status(500).json({
        error: 'Google authentication failed',
        details: 'Unable to complete Google authentication. Please try again.'
      });
    }

    // Redirect to frontend with error
    const redirectUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
    res.redirect(`${redirectUrl}/login?error=google_auth_failed`);
  }
};