// furemidy-backend/src/server.js

const express = require("express");
const morgan = require("morgan");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const multer = require("multer"); //
const pgPool = require("./config/db"); //
const authRoutes = require("./routes/auth"); //
const profileRoutes = require('./routes/profile'); //

dotenv.config({ path: path.resolve(__dirname, "../.env") }); //

console.log("Loaded GOOGLE_WEB_CLIENT_ID:", process.env.GOOGLE_WEB_CLIENT_ID ? "Yes" : "No"); //

const app = express();

app.use(cors()); //
app.use(express.json()); //
// app.use(morgan("dev")); 

// Serve the uploads folder so the app can view saved pet images
app.use('/uploads', express.static('uploads')); 

// --- MULTER STORAGE CONFIGURATION ---
// This handles saving the physical image file to your server
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/'); 
  },
  filename: (req, file, cb) => {
    // Unique filename using timestamp + original name
    cb(null, Date.now() + '-' + file.originalname);
  }
});

const upload = multer({ storage: storage }); //

// --- ROUTES ---
app.use("/api/auth", authRoutes); //
app.use('/api/profile', profileRoutes); //

// --- DIAGNOSIS & HISTORY ENDPOINTS ---

/**
 * @route   POST /api/upload-scan
 * @desc    Uploads a pet skin image and returns the permanent server URL
 */
app.post('/api/upload-scan', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }
  // Construct the permanent URL (e.g., http://192.168.100.4:8080/uploads/123-photo.jpg)
  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.status(200).json({ success: true, imageUrl: imageUrl });
});

/**
 * @route   POST /api/save-diagnosis
 * @desc    Saves a diagnosis record to PostgreSQL
 */
app.post('/api/save-diagnosis', async (req, res) => {
  console.log("\n📥 [SAVE REQUEST] Incoming scan data..."); //
  
  const { 
    userName,      
    petName, 
    petBreed, 
    petAge, 
    diagnosis, 
    severity, 
    aiResults, 
    userSymptoms,
    imageUri // Now expecting the permanent server URL
  } = req.body;

  try {
    const query = `
      INSERT INTO diagnosis_history 
      (user_name, pet_name, pet_breed, pet_age, diagnosis_name, severity_level, ai_results, user_symptoms, image_uri) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) 
      RETURNING *;
    `; //
    
    const values = [
      userName, 
      petName || 'Unknown', 
      petBreed || 'Unknown', 
      petAge || 'Unknown', 
      diagnosis, 
      severity, 
      JSON.stringify(aiResults), 
      JSON.stringify(userSymptoms),
      imageUri //
    ];

    const result = await pgPool.query(query, values); //
    console.log("✅ [SUCCESS] Diagnosis saved to PostgreSQL for:", userName); //
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    console.error("❌ [DATABASE ERROR] Failed to save diagnosis:", err.message); //
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @route   GET /api/get-history/:userName
 * @desc    Fetches history for a specific user
 */
app.get('/api/get-history/:userName', async (req, res) => {
  const { userName } = req.params;
  console.log(`🔍 [FETCH REQUEST] History requested for: ${userName}`); //

  try {
    const query = `
      SELECT * FROM diagnosis_history 
      WHERE user_name = $1 
      ORDER BY created_at DESC;
    `; //
    const result = await pgPool.query(query, [userName]); //
    
    console.log(`📊 [SUCCESS] Found ${result.rows.length} records for ${userName}`); //
    res.status(200).json({ success: true, history: result.rows });
  } catch (err) {
    console.error("❌ [DATABASE ERROR] Failed to fetch history:", err.message); //
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * @route   DELETE /api/delete-scan/:id
 * @desc    Deletes a specific record
 */
app.delete('/api/delete-scan/:id', async (req, res) => {
  const { id } = req.params;
  console.log(`🗑️ [DELETE REQUEST] Removing scan ID: ${id}`); //

  try {
    await pgPool.query('DELETE FROM diagnosis_history WHERE id = $1', [id]); //
    console.log("✅ [SUCCESS] Scan record deleted."); //
    res.status(200).json({ success: true, message: "Scan deleted" });
  } catch (err) {
    console.error("❌ [DATABASE ERROR] Failed to delete scan:", err.message); //
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SERVER INITIALIZATION ---

app.get("/test", (req, res) => {
  res.status(200).send("Hello from JavaScript!");
});

const PORT = process.env.PORT || 8080; //

pgPool
  .query("SELECT 1") // Verify DB connection before starting
  .then(() => {
    console.log("PostgreSQL connection successful!"); //
    app.listen(Number(PORT), () => {
      console.log(`Server is running on port ${PORT}`); //
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error); //
  });

  // Add this to furemedy-backend/src/server.js if you want a faster "Clear All"
app.delete('/api/clear-history/:userName', async (req, res) => {
  const { userName } = req.params;
  try {
    await pgPool.query('DELETE FROM diagnosis_history WHERE user_name = $1', [userName]);
    res.status(200).json({ success: true, message: "History cleared" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});