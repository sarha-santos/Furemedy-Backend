// In: furemedy-backend/src/routes/profile.js

const express = require('express');
const router = express.Router();
const pgPool = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware'); // Import our new middleware

// @route   GET api/profile/me
// @desc    Get current user's profile
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    try {
        // The user ID is attached to req.user from the authMiddleware
        const userId = req.user.id;

        // Query the database, but DO NOT select the password
        const userResult = await pgPool.query(
            'SELECT id, first_name, last_name, email, mobile_number, profile_image_path, about_me FROM users WHERE id = $1',
            [userId]
        );

        if (userResult.rows.length === 0) {
            return res.status(404).json({ msg: 'User not found' });
        }

        res.json(userResult.rows[0]);

    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;