// In furemedy-backend/src/routes/pets.js

const express = require('express');
const router = express.Router();
const pgPool = require('../config/db');
const authMiddleware = require('../middleware/authMiddleware'); // To protect the route
const multer = require('multer');
const path = require('path');

// Use the same multer storage setup as your auth route
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/'); },
  filename: function (req, file, cb) { cb(null, 'petImage-' + Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

// @route   POST api/pets/add
// @desc    Add a new pet for the logged-in user
// @access  Private
router.get('/mine', authMiddleware, async (req, res) => {
    try {
        // The user ID comes from the token via authMiddleware
        const pets = await pgPool.query(
            'SELECT * FROM pets WHERE owner_id = $1 ORDER BY created_at DESC', 
            [req.user.id]
        );

        res.json(pets.rows);

    } catch (err) {
        console.error("Get pets error:", err.message);
        res.status(500).send('Server Error');
    }
});

router.get('/:id', authMiddleware, async (req, res) => {
    const petId = req.params.id;
    const ownerId = req.user.id;

    try {
        // Security check: ensure the pet belongs to the user requesting it
        const petResult = await pgPool.query(
            'SELECT * FROM pets WHERE id = $1 AND owner_id = $2',
            [petId, ownerId]
        );

        if (petResult.rows.length === 0) {
            return res.status(404).json({ msg: 'Pet not found.' });
        }

        res.json(petResult.rows[0]);

    } catch (err) {
        console.error("Get single pet error:", err.message);
        res.status(500).send('Server Error');
    }
});

router.post('/add', authMiddleware, upload.single('petImage'), async (req, res) => {
    // The user's ID is available from the authMiddleware
    const ownerId = req.user.id;

    const {
        firstName,
        species,
        breed,
        birthdate, // Will come in as a string
        medicalHistory,
        sex,
        weight
    } = req.body;

    const petImagePath = req.file ? req.file.path : null;

    if (!firstName || !species) {
        return res.status(400).json({ msg: 'First name and species are required.' });
    }

    try {
        const newPet = await pgPool.query(
            `INSERT INTO pets (owner_id, first_name, species, breed, birthdate, medical_history, pet_image_path, sex, weight)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING *`,
            [ownerId, firstName, species, breed, birthdate || null, medicalHistory, petImagePath, sex, weight]
        );

        res.status(201).json(newPet.rows[0]);

    } catch (err) {
        console.error("Add pet error:", err.message);
        res.status(500).send('Server Error');
    }
});

router.delete('/:id', authMiddleware, async (req, res) => {
    const petId = req.params.id;
    const ownerId = req.user.id; // User ID from token

    try {
        // First, verify the pet belongs to the user trying to delete it (for security)
        const petResult = await pgPool.query(
            'SELECT * FROM pets WHERE id = $1 AND owner_id = $2',
            [petId, ownerId]
        );

        if (petResult.rows.length === 0) {
            return res.status(404).json({ msg: 'Pet not found or you do not have permission to delete it.' });
        }

        // If check passes, delete the pet
        await pgPool.query('DELETE FROM pets WHERE id = $1', [petId]);

        res.json({ msg: 'Pet deleted successfully.' });

    } catch (err) {
        console.error("Delete pet error:", err.message);
        res.status(500).send('Server Error');
    }
});

router.put('/:id', authMiddleware, upload.single('petImage'), async (req, res) => {
    const petId = req.params.id;
    const ownerId = req.user.id;

    const { firstName, species, breed, birthdate, medicalHistory, sex, weight } = req.body;
    const newPetImagePath = req.file ? req.file.path : null;

    try {
        const petResult = await pgPool.query(
            'SELECT pet_image_path FROM pets WHERE id = $1 AND owner_id = $2',
            [petId, ownerId]
        );

        if (petResult.rows.length === 0) {
            return res.status(404).json({ msg: 'Pet not found or you do not have permission to edit it.' });
        }
        
        // Determine the correct image path to save
        // If a new image is uploaded, use its path. Otherwise, keep the old path from the database.
        const finalPetImagePath = newPetImagePath || petResult.rows[0].pet_image_path;

        const updatedPet = await pgPool.query(
            `UPDATE pets 
             SET first_name = $1, species = $2, breed = $3, birthdate = $4, medical_history = $5, pet_image_path = $6
             WHERE id = $7
             RETURNING *`,
            [firstName, species, breed, birthdate || null, medicalHistory, finalPetImagePath, petId]
        );

        res.json(updatedPet.rows[0]);

    } catch (err) {
        console.error("Update pet error:", err.message);
        res.status(500).send('Server Error');
    }
});

module.exports = router;