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
const { createClient } = require('@supabase/supabase-js'); 

// Initialize dotenv
dotenv.config(); 

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
app.use(morgan('dev')); 
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// --- MULTER STORAGE CONFIGURATION ---
const storage = multer.memoryStorage();
const upload = multer({ storage: storage }); 

// --- AUTH MIDDLEWARE ---
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  
  if (!token) {
    console.log("AUTH: No token provided");
    return res.status(401).json({ success: false, message: "No token provided" });
  }

  const secret = process.env.JWT_SECRET;

  jwt.verify(token, secret, (err, user) => {
    if (err) {
      console.error("AUTH: Token verification failed:", err.message);
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

// --- DIAGNOSIS & HISTORY ENDPOINTS (UPDATED) ---

app.post('/api/upload-scan', upload.single('file'), async (req, res) => {
  if (!req.file) {
    console.error("❌ No file received in request");
    return res.status(400).json({ success: false, message: "No file uploaded" });
  }

  try {
    const fileExt = path.extname(req.file.originalname) || '.jpg';
    const fileName = `scan-${Date.now()}${fileExt}`;

    console.log(`Cloud: Uploading ${fileName} to 'pet-scans'...`);

    const { data, error } = await supabase.storage
      .from('pet-scans')
      .upload(fileName, req.file.buffer, { 
        contentType: req.file.mimetype,
        upsert: true 
      });

    if (error) {
      // This helps you see if it's a policy issue or bucket name issue
      console.error("❌ Supabase Storage Error:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }

    const { data: publicUrlData } = supabase.storage.from('pet-scans').getPublicUrl(fileName);
    
    console.log("✅ Upload Successful! Public URL:", publicUrlData.publicUrl);
    res.status(200).json({ success: true, imageUrl: publicUrlData.publicUrl });

  } catch (err) {
    console.error("❌ Internal Server Error during scan upload:", err.message);
    res.status(500).json({ success: false, message: "Internal Server Error" });
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