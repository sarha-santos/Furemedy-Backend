// furemedy-backend/src/server.js
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
const { createClient } = require('@supabase/supabase-js'); 
const axios = require('axios'); 
const FormData = require('form-data'); 

// 1. Initialize dotenv
dotenv.config(); 

// 2. Initialize App
const app = express();

// 3. Initialize Supabase
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

// 4. GLOBAL MIDDLEWARE
app.use(cors({
  origin: '*', 
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json()); 
app.use(morgan('dev')); 
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Create uploads directories if they don't exist
const uploadDirs = ['uploads', 'uploads/skin-assessments'];
uploadDirs.forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
});

// --- MULTER STORAGE CONFIGURATION ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage }); 

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ success: false, message: "Invalid token signature" });
    }
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

    const fileExt = path.extname(req.file.originalname) || '.jpg';
    const fileName = `user-${userId}-${Date.now()}${fileExt}`;
    
    const { data, error } = await supabase.storage
      .from('profile-pictures')
      .upload(fileName, req.file.buffer, { contentType: req.file.mimetype, upsert: true });

    if (error) throw error;

    const { data: publicUrlData } = supabase.storage.from('profile-pictures').getPublicUrl(fileName);
    const imageUrl = publicUrlData.publicUrl;

    const query = `UPDATE users SET profile_image_path = $1 WHERE id = $2 RETURNING profile_image_path;`;
    const result = await pgPool.query(query, [imageUrl, userId]);
    
    res.status(200).json({ success: true, profile_image_path: result.rows[0].profile_image_path });
  } catch (err) {
    console.error("Upload error:", err.message);
    res.status(500).json({ error: 'Failed to upload image' });
  }
});

app.put('/api/profile/update', authenticateToken, async (req, res) => {
  const userId = req.user.user.id; 
  const { about_me } = req.body;

  try {
    const query = `
      UPDATE users 
      SET about_me = $1 
      WHERE id = $2 
      RETURNING id, first_name, last_name, email, profile_image_path, about_me;
    `;
    const result = await pgPool.query(query, [about_me, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    res.status(200).json(result.rows[0]);
  } catch (err) {
    console.error("Update profile error:", err.message);
    res.status(500).json({ success: false, error: 'Failed to update about me' });
  }
});

// --- DIAGNOSIS & HISTORY ENDPOINTS ---
app.post('/api/upload-scan', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

  try {
    // 1. Upload to Supabase
    const fileExt = path.extname(req.file.originalname) || '.jpg';
    const fileName = `scan-${Date.now()}${fileExt}`;

    const { data, error } = await supabase.storage
      .from('pet-scans')
      .upload(fileName, req.file.buffer, { 
        contentType: req.file.mimetype,
        upsert: true 
      });

    if (error) return res.status(500).json({ success: false, message: error.message });

    const { data: publicUrlData } = supabase.storage.from('pet-scans').getPublicUrl(fileName);
    const imageUrl = publicUrlData.publicUrl;

    // 2. Forward to Python AI Service
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: fileName,
      contentType: req.file.mimetype,
    });

    // CLEANED UP AI CALL
    const aiUrl = 'https://furemedy-ai-service.onrender.com/predict';
    console.log(`DEBUG: Sending image to AI at: ${aiUrl}`);

    const aiResponse = await axios.post(aiUrl, form, {
      headers: { ...form.getHeaders() }
    });

    res.status(200).json({ 
      success: true, 
      imageUrl: imageUrl,
      aiResults: aiResponse.data 
    });

  } catch (err) {
    console.error("Scan/AI Error:", err.message);
    // Send back the specific error message to help debug in the app logs
    res.status(500).json({ 
      success: false, 
      message: `AI Service Error: ${err.message}` 
    });
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

// --- SERVER INITIALIZATION ---
const PORT = process.env.PORT || 8080;

pgPool.query("SELECT 1")
  .then(() => {
    console.log("✅ PostgreSQL connection successful!");
    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`🚀 Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("❌ Database connection failed:", error);
  });