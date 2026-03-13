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
const PDFDocument = require('pdfkit'); // <-- added for PDF generation

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

    const aiUrl = 'https://delmar-undenotative-apolonia.ngrok-free.dev/predict';
    console.log(`DEBUG: Sending image to AI at: ${aiUrl}`);

    const aiResponse = await axios.post(aiUrl, form, {
      headers: { ...form.getHeaders() },
      timeout: 90000 
    });

    res.status(200).json({ 
      success: true, 
      imageUrl: imageUrl,
      aiResults: aiResponse.data 
    });

  } catch (err) {
    console.error("Scan/AI Error:", err.message);
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
    const values = [
      userName,
      petName || 'Unknown',
      petBreed || 'Unknown',
      petAge || 'Unknown',
      diagnosis,
      severity,
      JSON.stringify(aiResults),
      JSON.stringify(userSymptoms),
      imageUri
    ];
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
    const result = await pgPool.query(
      'SELECT * FROM diagnosis_history WHERE user_name = $1 ORDER BY created_at DESC;',
      [sanitizedUserName]
    );
    res.status(200).json({ success: true, history: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: 'Failed to fetch history' });
  }
});

// --- NEW: DELETE SCAN ENDPOINT (WITH SUPABASE CLEANUP) ---

app.delete('/api/delete-scan/:scanId', async (req, res) => {
  const { scanId } = req.params;
  try {
    // 1. Get the image URL from DB before deleting the row
    const findResult = await pgPool.query(
      'SELECT image_uri FROM diagnosis_history WHERE id = $1',
      [scanId]
    );

    if (findResult.rowCount === 0) {
      return res.status(404).json({ success: false, message: "Scan not found" });
    }

    const imageUrl = findResult.rows[0].image_uri;

    // 2. Delete from Supabase Storage if URI exists
    if (imageUrl && imageUrl.includes('supabase.co')) {
      const fileName = imageUrl.split('/').pop();
      await supabase.storage.from('pet-scans').remove([fileName]);
    }

    // 3. Delete from PostgreSQL
    await pgPool.query('DELETE FROM diagnosis_history WHERE id = $1', [scanId]);

    res.status(200).json({ success: true, message: "Deleted from DB and Storage" });
  } catch (err) {
    console.error("Delete endpoint error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// --- NEW: PDF REPORT ENDPOINT ---
app.get('/api/report-pdf/:historyId', async (req, res) => {
  const { historyId } = req.params;

  try {
    const result = await pgPool.query('SELECT * FROM diagnosis_history WHERE id = $1', [historyId]);
    if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'Report not found' });

    const row = result.rows[0];
    const aiResults = typeof row.ai_results === 'string' 
  ? JSON.parse(row.ai_results) 
  : (row.ai_results || []);

    const userSymptoms = typeof row.user_symptoms === 'string' 
  ? JSON.parse(row.user_symptoms) 
  : (row.user_symptoms || []);

    const severity = (row.severity_level || 'low').toLowerCase();
    const triageColors = {
      high: '#D9534F',    
      moderate: '#F7924A', 
      low: '#5CB85C'      
    };
    const themeColor = triageColors[severity] || triageColors.low;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="furemedy-report-${row.id}.pdf"`);

    const doc = new PDFDocument({ size: 'A4', margin: 40 });
    doc.pipe(res);

    doc.rect(0, 0, 600, 80).fill(themeColor);
    doc.fillColor('#FFFFFF').fontSize(24).font('Helvetica-Bold').text('FurScan Analysis Report', 40, 30);
    doc.fontSize(10).font('Helvetica').text(`Generated on ${new Date(row.created_at).toLocaleDateString()}`, 40, 60);

    let currentY = 100;

    if (row.image_uri) {
      try {
        const imageResponse = await axios.get(row.image_uri, { responseType: 'arraybuffer' });
        doc.image(imageResponse.data, 40, currentY, { width: 160, height: 160 });
        doc.lineWidth(3).rect(40, currentY, 160, 160).stroke(themeColor);
      } catch (e) {
        doc.rect(40, currentY, 160, 160).fill('#EEEEEE');
        doc.fillColor('#999999').text('Image Unavailable', 75, currentY + 75);
      }
    }

    doc.fillColor('#333333');
    doc.font('Helvetica-Bold').fontSize(14).text('PATIENT INFORMATION', 220, currentY);
    doc.font('Helvetica').fontSize(18).fillColor(themeColor).text(row.pet_name || 'Unnamed Pet', 220, currentY + 20);
    
    doc.fontSize(10).fillColor('#666666').text('BREED', 220, currentY + 50);
    doc.fontSize(12).fillColor('#333333').text(row.pet_breed || 'Unknown', 220, currentY + 62);
    
    doc.fontSize(10).fillColor('#666666').text('AGE', 350, currentY + 50);
    doc.fontSize(12).fillColor('#333333').text(row.pet_age || 'N/A', 350, currentY + 62);

    doc.roundedRect(220, currentY + 90, 120, 25, 5).fill(themeColor);
    doc.fillColor('#FFFFFF').fontSize(10).font('Helvetica-Bold').text(severity.toUpperCase(), 230, currentY + 98, { width: 100, align: 'center' });

    currentY = 280;
    doc.fillColor('#666666').font('Helvetica-Bold').fontSize(10).text('DETECTED CONDITION', 40, currentY);
    doc.fillColor(themeColor).fontSize(20).text(row.diagnosis_name || 'NO SKIN DISEASE PRESENT', 40, currentY + 15);

    currentY += 60;
    doc.fillColor('#333333').font('Helvetica-Bold').fontSize(12).text('CONFIDENCE BREAKDOWN', 40, currentY);
    currentY += 20;

    aiResults.slice(0, 5).forEach((res, index) => {
      const label = res.label || res.name || 'Unknown';
      const score = res.score || (res.probability ? Math.round(res.probability * 100) : 0);
      doc.fillColor('#333333').font('Helvetica').fontSize(10).text(label, 40, currentY);
      doc.text(`${score}%`, 520, currentY, { align: 'right' });
      doc.roundedRect(40, currentY + 15, 515, 8, 4).fill('#EAEAEA');
      const barWidth = (score / 100) * 515;
      if (barWidth > 0) {
        doc.roundedRect(40, currentY + 15, barWidth, 8, 4).fill(index === 0 ? themeColor : '#BDC3C7');
      }
      currentY += 35;
    });

    doc.fillColor('#333333').font('Helvetica-Bold').fontSize(12).text('REPORTED SYMPTOMS', 40, currentY);
    currentY += 20;
    
    if (userSymptoms.length > 0) {
      userSymptoms.forEach(s => {
        doc.fillColor('#5CB85C').text('✔', 45, currentY);
        doc.fillColor('#333333').font('Helvetica').text(s, 60, currentY);
        currentY += 15;
      });
    } else {
      doc.font('Helvetica-Oblique').text('No manual symptoms reported.', 40, currentY);
      currentY += 15;
    }

    doc.rect(40, 750, 515, 1).stroke('#EEEEEE');
    doc.fontSize(8).fillColor('#999999').text(
      'DISCLAIMER: This report is generated by FurScan AI for informational purposes. It is not a clinical diagnosis. Please consult a licensed veterinarian for medical advice.',
      40, 765, { align: 'center', width: 515 }
    );

    doc.end();
  } catch (err) {
    console.error('PDF error:', err);
    res.status(500).json({ success: false, message: 'Failed to generate visual PDF' });
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