const express = require("express");
const morgan = require("morgan");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const pgPool = require("./config/db");
const authRoutes = require("./routes/auth");
const profileRoutes = require('./routes/profile');
const petRoutes = require('./routes/pet');
const skinRoutes = require('./routes/skinAssessment');

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
app.use('/uploads', express.static('uploads'));

// Define Routes
app.use("/api/auth", authRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/pets', petRoutes);
app.use('/api/skin-assessment', skinRoutes); // Fixed: matched variable name 'skinRoutes'

app.get("/test", (req, res) => {
  res.status(200).send("Hello from JavaScript!");
});

const PORT = process.env.PORT || 5000;

pgPool
  .query("SELECT 1")
  .then(() => {
    console.log("PostgreSQL connection successful!");
    
    // We assign it to 'server' to inspect the address
    const server = app.listen(Number(PORT), '0.0.0.0', () => {
      const address = server.address();
      console.log(`-----------------------------------------------`);
      console.log(`✅ Server is successfully running!`);
      console.log(`🔌 Port: ${PORT}`);
      console.log(`🌍 Network: ${address.address} (This MUST say 0.0.0.0)`); 
      console.log(`📁 API URL: http://0.0.0.0:${PORT}`);
      console.log(`-----------------------------------------------`);
    });
  })
  .catch((error) => {
    console.error("❌ Database connection failed:", error);
  });