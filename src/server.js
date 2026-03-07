// In: furemidy-backend/src/server.js

const express = require("express");
const morgan = require("morgan");
const dotenv = require("dotenv");
const cors = require("cors");
const path = require("path");
const fs = require("fs");
const pgPool = require("./config/db");
const authRoutes = require("./routes/auth"); // <-- 1. Import the routes
const profileRoutes = require('./routes/profile');

dotenv.config({ path: path.resolve(__dirname, "../.env") });

// --- (Optional but Recommended) A quick check to see if it worked ---
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
//app.use(morgan("dev")); // Temporarily commented out for cleaner logs if needed
app.use('/uploads', express.static('uploads'));

// Define Routes
app.use("/api/auth", authRoutes); // <-- 2. Use the routes
app.use('/api/profile', profileRoutes);

app.get("/test", (req, res) => {
  res.status(200).send("Hello from JavaScript!");
});

const PORT = process.env.PORT || 8080;

pgPool
  .query("SELECT 1") // Verify DB connection before starting
  .then(() => {
    console.log("PostgreSQL connection successful!");
    app.listen(Number(PORT), () => {
      console.log(`Server is running on port ${PORT}`);
    });
  })
  .catch((error) => {
    console.error("Database connection failed:", error);
  });
