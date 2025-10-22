const mongoose = require('mongoose');

module.exports = function(err, req, res, next) {
    if (err instanceof mongoose.Error.ValidationError) {
        return res.status(400).json({
            error: 'Validation Error',
            details: err.errors
        });
    }

    if (err.name === 'MongoServerError' && err.code === 11000) {
        return res.status(409).json({
            error: 'Duplicate Key Error',
            details: err.keyValue
        });
    }

    if (err.name === 'MongooseServerSelectionError') {
        return res.status(500).json({
            error: 'Database Connection Error',
            message: 'Unable to connect to the database. Please try again later.'
        });
    }

    next(err);
};