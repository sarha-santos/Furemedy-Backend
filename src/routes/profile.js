// In: furemedy-backend/src/routes/profile.js

const express = require('express');
const router = express.Router();
const pgPool = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// --- 1. SETUP IMAGE STORAGE (Multer) ---
// This tells the code where to put the files (in the 'uploads' folder)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        // Ensure the uploads directory exists
        const uploadDir = 'uploads/';
        if (!fs.existsSync(uploadDir)){
            fs.mkdirSync(uploadDir);
        }
        cb(null, uploadDir);
    },
    filename: function (req, file, cb) {
        // Name the file: "profileImage-" + timestamp + ".jpg"
        const uniqueSuffix = Date.now() + Math.round(Math.random() * 1E9);
        cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
    }
});

const upload = multer({ storage: storage });

// --- ROUTES ---

// @route   GET api/profile/me
// @desc    Get current user's profile
// @access  Private
router.get('/me', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.id;
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

// @route   PUT api/profile/update
// @desc    Update text fields (About Me, etc.)
// @access  Private
router.put('/update', authMiddleware, async (req, res) => {
    const { about_me } = req.body;
    const userId = req.user.id;

    try {
        // Update the 'about_me' column for this specific user
        const result = await pgPool.query(
            'UPDATE users SET about_me = $1 WHERE id = $2 RETURNING id, first_name, last_name, email, mobile_number, profile_image_path, about_me',
            [about_me, userId]
        );

        res.json(result.rows[0]); // Send back the updated profile
    } catch (err) {
        console.error(err.message);
        res.status(500).send('Server Error');
    }
});

// @route   PUT api/profile/upload-image
// @desc    Upload profile picture
// @access  Private
router.put('/upload-image', authMiddleware, upload.single('profileImage'), async (req, res) => {
    const userId = req.user.id;

    try {
        if (!req.file) {
            return res.status(400).json({ msg: 'No file uploaded' });
        }

        // Multer creates the file path (e.g., "uploads/profileImage-12345.jpg")
        const filePath = req.file.path;

        // Save this path into the database
        const result = await pgPool.query(
            'UPDATE users SET profile_image_path = $1 WHERE id = $2 RETURNING profile_image_path',
            [filePath, userId]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error("Upload Error:", err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;