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
const jwt = require("jsonwebtoken"); // <--- ADDED: Needed to verify frontend token

dotenv.config({ path: path.resolve(__dirname, "../.env") }); //

console.log("Loaded GOOGLE_WEB_CLIENT_ID:", process.env.GOOGLE_WEB_CLIENT_ID ? "Yes" : "No"); //

const app = express();

app.use(cors()); //
app.use(express.json()); //
// app.use(morgan("dev")); 

// Serve the uploads folder so the app can view saved pet images
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
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

// <--- ADDED: Inline Auth Middleware for the profile upload --->
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ success: false, message: "No token provided" });

  // Make sure process.env.JWT_SECRET matches what you used to create the token in auth.js!
  jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret', (err, user) => {
    if (err) return res.status(403).json({ success: false, message: "Invalid token" });
    req.user = user; 
    next();
  });
};

// --- ROUTES ---
app.use("/api/auth", authRoutes); //
app.use('/api/profile', profileRoutes); //

// <--- ADDED: PROFILE IMAGE UPLOAD ENDPOINT --->
/**
 * @route   PUT /api/profile/upload-image
 * @desc    Uploads a profile picture and updates the user's database record
 */
app.put('/api/profile/upload-image', authenticateToken, upload.single('profileImage'), async (req, res) => {
  
  // ADD THIS LINE to see exactly what is inside your token:
  console.log("🔍 MY TOKEN CONTENTS:", req.user); 

  // We will temporarily leave this as is
// Digs one level deeper into the token to grab the 14
const userId = req.user.user.id;
console.log(`📸 [UPLOAD REQUEST] Profile image upload for user ID: ${userId}`);
  
  // ... rest of the code

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file provided' });
    }

    // Normalize path for Windows/Mac compatibility (e.g., "uploads/123-photo.jpg")
    const imagePath = req.file.path.replace(/\\/g, '/');

    // NOTE: If your database table is not named 'users', change it below
    const query = `
      UPDATE users 
      SET profile_image_path = $1 
      WHERE id = $2 
      RETURNING profile_image_path;
    `;
    
    const result = await pgPool.query(query, [imagePath, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found in database' });
    }

    console.log(`✅ [SUCCESS] Profile image updated for user ID: ${userId}`);
    
    // Send back the exact JSON your frontend expects
    res.status(200).json({ 
      success: true, 
      profile_image_path: result.rows[0].profile_image_path 
    });

  } catch (err) {
    console.error("❌ [DATABASE ERROR] Failed to update profile image:", err.message);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

/**
 * @route   PUT /api/profile/update
 * @desc    Updates user profile fields (like about_me)
 */
app.put('/api/profile/update', authenticateToken, async (req, res) => {
  // Grab the correct ID from the token just like we did for the image
  const userId = req.user.user.id;
  const { about_me } = req.body;

  console.log(`📝 [UPDATE REQUEST] Updating About Me for user ID: ${userId}`);

  try {
    // NOTE: Make sure your table is named 'users' and has an 'about_me' column!
    const query = `
      UPDATE users 
      SET about_me = $1 
      WHERE id = $2 
      RETURNING id, first_name, last_name, email, mobile_number, profile_image_path, about_me;
    `;
    
    const result = await pgPool.query(query, [about_me, userId]);

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    console.log(`✅ [SUCCESS] Profile updated for user ID: ${userId}`);
    
    // The frontend expects the full updated user object to refresh the UI
    res.status(200).json(result.rows[0]);

  } catch (err) {
    console.error("❌ [DATABASE ERROR] Failed to update profile:", err.message);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});


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