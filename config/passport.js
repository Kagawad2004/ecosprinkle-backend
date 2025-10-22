const passport = require('passport');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const User = require('../models/User');

// Serialize user for session
passport.serializeUser((user, done) => {
  done(null, user._id);
});

// Deserialize user from session
passport.deserializeUser(async (id, done) => {
  try {
    const user = await User.findById(id);
    done(null, user);
  } catch (error) {
    done(error, null);
  }
});

// Google OAuth Strategy (only initialize if credentials are provided)
if (process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET) {
  passport.use(new GoogleStrategy({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3002/api/auth/google/callback'
    },
    async (accessToken, refreshToken, profile, done) => {
      try {
        // Check if user already exists with this Google ID
        let user = await User.findOne({ 'google.id': profile.id });

        if (user) {
          // Update Google profile info
          user.google = {
            id: profile.id,
            email: profile.emails?.[0]?.value,
            name: profile.displayName,
            picture: profile.photos?.[0]?.value
          };
          user.profile.lastLogin = new Date();
          await user.save();
          return done(null, user);
        }

        // Check if user exists with same email
        const existingUser = await User.findOne({ email: profile.emails?.[0]?.value });

        if (existingUser) {
          // Link Google account to existing user
          existingUser.google = {
            id: profile.id,
            email: profile.emails?.[0]?.value,
            name: profile.displayName,
            picture: profile.photos?.[0]?.value
          };
          existingUser.profile.lastLogin = new Date();
          user = await existingUser.save();
          return done(null, user);
        }

        // Create new user from Google profile
        user = new User({
          firstName: profile.name?.givenName || profile.displayName.split(' ')[0] || 'Google',
          lastName: profile.name?.familyName || profile.displayName.split(' ').slice(1).join(' ') || 'User',
          email: profile.emails?.[0]?.value,
          google: {
            id: profile.id,
            email: profile.emails?.[0]?.value,
            name: profile.displayName,
            picture: profile.photos?.[0]?.value
          },
          profile: {
            lastLogin: new Date(),
            authProvider: 'google'
          },
          // Set a random password for Google users (they won't use it)
          password: require('crypto').randomBytes(32).toString('hex')
        });

        await user.save();
        return done(null, user);
      } catch (error) {
        console.error('Google OAuth strategy error:', error);
        return done(error, null);
      }
    }
  ));

  console.log('✅ Google OAuth strategy initialized');
} else {
  console.log('⚠️  Google OAuth not configured - skipping Google strategy initialization');
}

module.exports = passport;