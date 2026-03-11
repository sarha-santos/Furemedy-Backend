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
const chatRoutes = require('./routes/chat'); // <--- ADDED
const jwt = require("jsonwebtoken"); 

dotenv.config({ path: path.resolve(__dirname, "../.env") }); 

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
const storage = multer.diskStorage({
  destination: (req, file, cb) => { cb(null, 'uploads/'); },
  filename: (req, file, cb) => { cb(null, Date.now() + '-' + file.originalname); }
});
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
app.use('/api/chat', chatRoutes); // <--- ADDED

// --- PROFILE ENDPOINTS ---

app.put('/api/profile/upload-image', authenticateToken, upload.single('profileImage'), async (req, res) => {
  const userId = req.user.user.id;
  try {
    if (!req.file) return res.status(400).json({ error: 'No image file provided' });
    const imagePath = req.file.path.replace(/\\/g, '/');
    const query = `UPDATE users SET profile_image_path = $1 WHERE id = $2 RETURNING profile_image_path;`;
    const result = await pgPool.query(query, [imagePath, userId]);
    if (result.rowCount === 0) return res.status(404).json({ error: 'User not found' });
    res.status(200).json({ success: true, profile_image_path: result.rows[0].profile_image_path });
  } catch (err) {
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

app.post('/api/upload-scan', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });
  const imageUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.status(200).json({ success: true, imageUrl: imageUrl });
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
    app.listen(Number(PORT), () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });