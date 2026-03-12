// furemidy-backend/src/server.js

const express = require("express");
const morgan = require("morgan");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const multer = require("multer"); 
const pgPool = require("./config/db"); 
const authRoutes = require("./routes/auth"); 
const profileRoutes = require('./routes/profile'); 
const chatRoutes = require('./routes/chat'); 
const jwt = require("jsonwebtoken"); 
const { createClient } = require('@supabase/supabase-js'); // <--- ADDED SUPABASE

dotenv.config({ path: path.resolve(__dirname, "../.env") }); 

// --- INITIALIZE SUPABASE CLIENT ---
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

console.log("Loaded GOOGLE_WEB_CLIENT_ID:", process.env.GOOGLE_WEB_CLIENT_ID ? "Yes" : "No"); 

const app = express();

// Create uploads directories if they don't exist
const uploadDirs = ['uploads', 'uploads/skin-assessments'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

app.use(cors()); 
app.use(express.json()); 
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// --- MULTER STORAGE CONFIGURATION ---
// CHANGED: Now using memoryStorage to hold the file temporarily before sending to Supabase
const storage = multer.memoryStorage();
const upload = multer({ storage: storage }); 

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) return res.status(401).json({ success: false, message: "No token provided" });

  jwt.verify(token, process.env.JWT_SECRET || 'your_jwt_secret', (err, user) => {
    if (err) return res.status(403).json({ success: false, message: "Invalid token" });
    req.user = user; 
    next();
  });
};

// --- ROUTES ---
app.use("/api/auth", authRoutes); 
app.use('/api/profile', profileRoutes); 
app.use('/api/chat', chatRoutes); 

// --- PROFILE ENDPOINTS ---

app.put('/api/profile/upload-image', authenticateToken, upload.single('profileImage'), async (req, res) => {
  const userId = req.user.user.id;
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });

    // 1. Create unique filename
    const fileName = `user-${userId}-${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;

    // 2. Upload to Supabase 'profile-pictures' bucket
    const { data, error } = await supabase.storage
      .from('profile-pictures')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (error) throw error;

    // 3. Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('profile-pictures')
      .getPublicUrl(fileName);

    const imageUrl = publicUrlData.publicUrl;

    // 4. Update the database with the new URL
    const query = `UPDATE users SET profile_image_path = $1 WHERE id = $2 RETURNING profile_image_path;`;
    const result = await pgPool.query(query, [imageUrl, userId]);
    
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    
    res.status(200).json({ success: true, profile_image_path: result.rows[0].profile_image_path });
  } catch (err) {
    console.error("Profile image upload error:", err.message);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

app.put('/api/profile/update', authenticateToken, async (req, res) => {
  const userId = req.user.user.id;
  const { about_me } = req.body;
  try {
    const query = `UPDATE users SET about_me = $1 WHERE id = $2 RETURNING *;`;
    const result = await pgPool.query(query, [about_me, userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.status(200).json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// --- DIAGNOSIS & HISTORY ENDPOINTS ---

app.post('/api/upload-scan', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

  try {
    // 1. Create unique filename
    const fileName = `${Date.now()}-${req.file.originalname.replace(/\s+/g, '-')}`;

    // 2. Upload to Supabase 'pet-scans' bucket
    const { data, error } = await supabase.storage
      .from('pet-scans')
      .upload(fileName, req.file.buffer, {
        contentType: req.file.mimetype,
      });

    if (error) throw error;

    // 3. Get public URL
    const { data: publicUrlData } = supabase.storage
      .from('pet-scans')
      .getPublicUrl(fileName);

    // 4. Return the URL to the frontend
    res.status(200).json({ 
      success: true, 
      imageUrl: publicUrlData.publicUrl 
    });
  } catch (err) {
    console.error("Supabase upload error:", err.message);
    res.status(500).json({ success: false, message: "Failed to upload image", error: err.message });
  }
});

app.post('/api/save-diagnosis', async (req, res) => {
  const { userName, petName, petBreed, petAge, diagnosis, severity, aiResults, userSymptoms, imageUri } = req.body;
  try {
    const query = `
      INSERT INTO diagnosis_history 
      (user_name, pet_name, pet_breed, pet_age, diagnosis_name, severity_level, ai_results, user_symptoms, image_uri) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *;`;
    const values = [userName, petName || 'Unknown', petBreed || 'Unknown', petAge || 'Unknown', diagnosis, severity, JSON.stringify(aiResults), JSON.stringify(userSymptoms), imageUri];
    const result = await pgPool.query(query, values);
    res.status(200).json({ success: true, data: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/get-history/:userName', async (req, res) => {
  const rawUserName = decodeURIComponent(req.params.userName || '').trim();
  const sanitizedUserName = rawUserName.replace(/\bundefined\b/gi, '').replace(/\s+/g, ' ').trim();

  if (!sanitizedUserName) return res.status(200).json({ success: true, history: [] });

  try {
    const result = await pgPool.query('SELECT * FROM diagnosis_history WHERE user_name = $1 ORDER BY created_at DESC;', [sanitizedUserName]);
    res.status(200).json({ success: true, history: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

app.delete('/api/delete-scan/:id', async (req, res) => {
  try {
    await pgPool.query('DELETE FROM diagnosis_history WHERE id = $1', [req.params.id]);
    res.status(200).json({ success: true, message: "Scan deleted" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/clear-history/:userName', async (req, res) => {
  try {
    await pgPool.query('DELETE FROM diagnosis_history WHERE user_name = $1', [req.params.userName]);
    res.status(200).json({ success: true, message: "History cleared" });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- SERVER INITIALIZATION ---

const PORT = process.env.PORT || 8080;

pgPool.query("SELECT 1")
  .then(() => {
    console.log("PostgreSQL connection successful!");
    // Only ONE app.listen here
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });