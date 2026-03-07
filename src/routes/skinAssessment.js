const express = require('express');
const router = express.Router();
// 1. Ensure this path points to the correct file
const authMiddleware = require('../middleware/authMiddleware'); 
// 2. Ensure this path is correct
const controller = require('../controllers/skinAssessmentController');

// DEBUGGING: Add this to see which one is undefined
if (!controller.getHistory) console.log("ERROR: controller.getHistory is undefined!");
if (!authMiddleware) console.log("ERROR: authMiddleware is undefined!");

// 3. The Routes
router.get('/history', authMiddleware, controller.getHistory);
router.post('/save', authMiddleware, controller.saveAssessment);
router.delete('/:id', authMiddleware, controller.deleteAssessment);

module.exports = router;