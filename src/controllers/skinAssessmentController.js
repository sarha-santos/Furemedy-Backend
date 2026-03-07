const db = require('../config/db');

exports.saveAssessment = async (req, res) => {
  try {
    const userId = req.user.id;
    const { petInfo, possibleCauses, detectedLesions, scanImage, symptoms } = req.body;

    const diagnosis = possibleCauses?.[0] || 'Unknown';
    const lesionsJson = JSON.stringify(detectedLesions || []);
    const symptomsJson = JSON.stringify(symptoms || []);

    const query = `
      INSERT INTO skin_assessments 
      (user_id, pet_name, pet_age, pet_breed, diagnosis, detected_lesions_json, user_symptoms_json, scan_image_url)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    // 3. Ensure petInfo.age is parsed as an integer
    const ageToSave = String(petInfo.age || "Unknown");

    await db.execute(query, [
      userId, 
      petInfo.name, 
      ageToSave, // Saved as string "1-3 years"
      petInfo.breed,
      diagnosis,
      lesionsJson, 
      symptomsJson,
      scanImage 
    ]);

    res.status(201).json({ message: 'Saved successfully' });
  } catch (error) {
    console.error('Save error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.getHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const [rows] = await db.execute(
      'SELECT * FROM skin_assessments WHERE user_id = ? ORDER BY created_at DESC', 
      [userId]
    );

    const history = rows.map(row => ({
      id: row.id.toString(),
      petInfo: {
        name: row.pet_name,
        age: row.pet_age,
        breed: row.pet_breed
      },
      possibleCauses: [row.diagnosis],
      detectedLesions: JSON.parse(row.detected_lesions_json || '[]'),
      // 4. Parse symptoms back to array
      symptoms: row.user_symptoms_json ? JSON.parse(row.user_symptoms_json) : [], 
      scanImage: row.scan_image_url,
      createdAt: row.created_at
    }));

    res.json(history);
  } catch (error) {
    console.error('Fetch error:', error);
    res.status(500).json({ message: 'Server error' });
  }
};

exports.deleteAssessment = async (req, res) => {
  try {
    const userId = req.user.id;
    const assessmentId = req.params.id;

    const query = `DELETE FROM skin_assessments WHERE id = ? AND user_id = ?`;
    
    // Check if the delete actually affected any rows
    const [result] = await db.execute(query, [assessmentId, userId]);

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: 'Record not found or unauthorized' });
    }

    res.json({ message: 'Deleted successfully' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({ message: 'Server error during delete' });
  }
};