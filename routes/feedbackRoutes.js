const express = require('express');
const Feedback = require('../models/Feedback');
const router = express.Router();
const { body, validationResult } = require('express-validator');

// Temporary test route to verify feedbackRoutes is loaded
router.get('/test', (req, res) => res.json({ message: 'Feedback routes working' }));

// Route to handle feedback submission
router.post(
  '/feedback',
  [
    // Validation rules
    body('name').notEmpty().withMessage('Name is required.'),
    body('email').isEmail().withMessage('Valid email is required.'),
    body('rating')
      .isInt({ min: 1, max: 5 })
      .withMessage('Rating must be between 1 and 5.'),
    body('category').notEmpty().withMessage('Category is required.'),
    body('message')
      .isLength({ min: 4 })
      .withMessage('Message must be at least 4 characters long.'),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }

    try {
      const { name, email, rating, category, message } = req.body;

      // Create a new feedback entry
      const feedback = new Feedback({
        name,
        email,
        rating,
        category,
        message,
        date: new Date(),
      });

      // Save feedback to the database
      await feedback.save();

      res.status(201).json({ message: 'Feedback submitted successfully.' });
    } catch (error) {
      console.error('Error saving feedback:', error);
      res.status(500).json({ error: 'An error occurred while submitting feedback.' });
    }
  }
);

// Route to fetch recent feedback
router.get('/feedback', async (req, res) => {
  try {
    const feedbackList = await Feedback.find().sort({ date: -1 }).limit(10);
    const totalCount = await Feedback.countDocuments();
    const avgRating = await Feedback.aggregate([
      { $group: { _id: null, average: { $avg: '$rating' } } }
    ]);
    
    res.status(200).json({
      feedbacks: feedbackList,
      stats: {
        total: totalCount,
        averageRating: avgRating.length > 0 ? avgRating[0].average : 0,
        satisfaction: totalCount > 0 ? Math.round((avgRating.length > 0 ? avgRating[0].average : 0) / 5 * 100) : 0
      }
    });
  } catch (error) {
    console.error('Error fetching feedback:', error);
    res.status(500).json({ error: 'An error occurred while fetching feedback.' });
  }
});

module.exports = router;