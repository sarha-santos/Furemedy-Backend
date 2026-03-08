const express = require("express");
const router = express.Router();
const pgPool = require("../config/db");
const bcrypt = require("bcrypt");
const multer = require("multer");
const jwt = require("jsonwebtoken");
const path = require("path");
const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');
const axios = require('axios');

// Initialize Google Auth Client
const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

// Configure Multer for file storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) { cb(null, 'uploads/'); },
  filename: function (req, file, cb) { cb(null, file.fieldname + '-' + Date.now() + path.extname(file.originalname)); }
});
const upload = multer({ storage: storage });

const normalizeProfileImagePath = (value) => {
  if (!value) return null;

  let normalized = String(value).replace(/\\/g, '/').trim();

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  const uploadsIndex = normalized.toLowerCase().indexOf('/uploads/');
  if (uploadsIndex !== -1) {
    normalized = normalized.substring(uploadsIndex + '/uploads/'.length);
  }

  if (normalized.startsWith('/uploads/')) {
    normalized = normalized.slice('/uploads/'.length);
  } else if (normalized.startsWith('uploads/')) {
    normalized = normalized.slice('uploads/'.length);
  }

  return normalized.startsWith('/') ? normalized.slice(1) : normalized;
};

const buildProfileImageUrl = (req, value) => {
  const normalized = normalizeProfileImagePath(value);
  if (!normalized) return null;

  if (/^https?:\/\//i.test(normalized)) {
    return normalized;
  }

  return `${req.protocol}://${req.get('host')}/uploads/${normalized}`;
};

// ====================================================================
// SIGNUP ROUTE 
// ====================================================================
router.post("/signup", upload.single('profileImage'), async (req, res) => {
  const { firstName, lastName, email, mobileNumber, password, securityQuestion, securityAnswer } = req.body;
  const profileImagePath = req.file ? req.file.filename : null;

  if (!firstName || !lastName || !email || !mobileNumber || !password || !securityQuestion || !securityAnswer) {
    return res.status(400).json({ msg: "Please enter all fields." });
  }

  try {
    // FIX: Normalize email to lowercase
    const normalizedEmail = email.toLowerCase();

    const userExists = await pgPool.query("SELECT * FROM users WHERE email = $1 OR mobile_number = $2", [normalizedEmail, mobileNumber]);
    if (userExists.rows.length > 0) {
      return res.status(400).json({ msg: "User with this email or mobile number already exists." });
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const hashedSecurityAnswer = await bcrypt.hash(securityAnswer, salt);

    const newUserResult = await pgPool.query(
      "INSERT INTO users (first_name, last_name, email, mobile_number, password, profile_image_path, is_verified, security_question, security_answer) VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8) RETURNING *",
      [firstName, lastName, normalizedEmail, mobileNumber, hashedPassword, profileImagePath, securityQuestion, hashedSecurityAnswer]
    );

    const user = newUserResult.rows[0];
    const payload = { user: { id: user.id } };
    
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
      if (err) throw err;
      const normalizedPath = normalizeProfileImagePath(user.profile_image_path);
      res.status(201).json({
        token,
        user: {
          id: user.id,
          first_name: user.first_name,
          email: user.email,
          profile_image_path: normalizedPath,
          profile_image_url: buildProfileImageUrl(req, normalizedPath)
        }
      });
    });

  } catch (err) {
    console.error("Signup server error:", err);
    res.status(500).send("Server Error");
  }
});


// ====================================================================
// LOGIN ROUTE
// ====================================================================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ msg: "Please enter all fields." });
  }

  try {
    // FIX: Normalize email to lowercase
    const normalizedEmail = email.toLowerCase();
    
    console.log(`[Login Info] Attempting login for: ${normalizedEmail}`);

    // Look for user
    const result = await pgPool.query("SELECT * FROM users WHERE email = $1", [normalizedEmail]);
    const user = result.rows[0];

    // Debug: Check if user exists
    if (!user) {
      console.log(`[Login Fail] User not found: ${normalizedEmail}`);
      return res.status(400).json({ msg: "Invalid credentials." });
    }
    
    // Check for social login users (no password)
    if (!user.password) {
      console.log(`[Login Fail] Social user trying to password login: ${normalizedEmail}`);
      return res.status(400).json({ msg: "Please log in using your social account (Google/Apple)." });
    }

    // Compare Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      console.log(`[Login Fail] Password mismatch for: ${normalizedEmail}`);
      return res.status(400).json({ msg: "Invalid credentials." });
    }
    
    console.log(`[Login Success] User logged in: ${normalizedEmail}`);

    // Generate Token
    const payload = { user: { id: user.id } };
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
      if (err) throw err;
      const normalizedPath = normalizeProfileImagePath(user.profile_image_path);
      res.json({
        token,
        user: {
          id: user.id,
          first_name: user.first_name,
          email: user.email,
          profile_image_path: normalizedPath,
          profile_image_url: buildProfileImageUrl(req, normalizedPath)
        }
      });
    });
  } catch (err) {
    console.error("Login Server Error:", err.message);
    res.status(500).send("Server Error");
  }
});


// ====================================================================
// SOCIAL LOGIN ROUTE
// ====================================================================
router.post('/social-login', async (req, res) => {
    const { provider, token } = req.body;
    if (!provider || !token) return res.status(400).json({ msg: 'Provider and token are required.' });

    try {
        let email, firstName, lastName, profileImage;
        
        if (provider === 'google') {
            const trustedClientIds = [process.env.GOOGLE_WEB_CLIENT_ID, process.env.GOOGLE_ANDROID_CLIENT_ID, process.env.GOOGLE_IOS_CLIENT_ID].filter(Boolean); 
            const ticket = await googleClient.verifyIdToken({ idToken: token, audience: trustedClientIds });
            const payload = ticket.getPayload();
            if (!payload) return res.status(400).json({ msg: 'Invalid Google token.' });
            
            email = payload.email.toLowerCase(); // FIX: Normalize email
            firstName = payload.given_name;
            lastName = payload.family_name;
            profileImage = payload.picture;

        } else if (provider === 'apple') {
            const decoded = jwt.decode(token);
            if (!decoded) return res.status(400).json({ msg: 'Invalid Apple token.' });
            
            email = decoded.email.toLowerCase(); // FIX: Normalize email
            firstName = 'User'; 
            lastName = '';
            profileImage = null;

        } else {
            return res.status(400).json({ msg: 'Provider not supported.' });
        }

        if (!email) return res.status(400).json({ msg: 'Could not retrieve email from provider.' });

        const userResult = await pgPool.query('SELECT * FROM users WHERE email = $1', [email]);
        let user = userResult.rows[0];

        if (!user) {
            const newUserResult = await pgPool.query(
                'INSERT INTO users (first_name, last_name, email, profile_image_path, is_verified) VALUES ($1, $2, $3, $4, TRUE) RETURNING *',
                [firstName, lastName, email, profileImage]
            );
            user = newUserResult.rows[0];
        }

        const appPayload = { user: { id: user.id } };
        const appToken = jwt.sign(appPayload, process.env.JWT_SECRET, { expiresIn: '30d' });
        const normalizedPath = normalizeProfileImagePath(user.profile_image_path);

        res.json({
            token: appToken,
            user: {
              id: user.id,
              first_name: user.first_name,
              last_name: user.last_name,
              email: user.email,
              profile_image_path: normalizedPath,
              profile_image_url: buildProfileImageUrl(req, normalizedPath)
            }
        });

    } catch (error) {
        console.error('Social login backend error:', error);
        res.status(500).send('Server Error: Could not process social login.');
    }
});

// ====================================================================
// GET SECURITY QUESTION ROUTE
// ====================================================================
router.post('/get-security-question', async (req, res) => {
    const { email } = req.body;
    try {
        // FIX: Normalize email
        const normalizedEmail = email.toLowerCase();
        
        const result = await pgPool.query('SELECT security_question FROM users WHERE email = $1', [normalizedEmail]);
        if (result.rows.length === 0) {
            return res.status(404).json({ msg: 'An account with this email does not exist.' });
        }
        res.json({ security_question: result.rows[0].security_question });
    } catch (error) {
        console.error("Get Security Question Error:", error);
        res.status(500).send('Server Error');
    }
});


// ====================================================================
// VERIFY SECURITY ANSWER ROUTE
// ====================================================================
router.post('/verify-security-answer', async (req, res) => {
    const { email, answer } = req.body;
    try {
        // FIX: Normalize email
        const normalizedEmail = email.toLowerCase();

        const result = await pgPool.query('SELECT * FROM users WHERE email = $1', [normalizedEmail]);
        const user = result.rows[0];

        if (!user) {
            return res.status(404).json({ msg: 'User not found.' });
        }
        
        // Compare the submitted answer with the hashed answer in the database
        const isMatch = await bcrypt.compare(answer, user.security_answer);
        if (!isMatch) {
            return res.status(400).json({ msg: 'Answer is incorrect.' });
        }

        // If correct, generate a temporary, single-use reset token
        const resetToken = crypto.randomBytes(32).toString('hex');
        const hashedResetToken = crypto.createHash('sha256').update(resetToken).digest('hex');
        const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // Token valid for 10 minutes

        await pgPool.query(
            'UPDATE users SET reset_token = $1, reset_token_expires_at = $2 WHERE id = $3',
            [hashedResetToken, expiresAt, user.id]
        );
        
        // Send the plain token back to the client
        res.json({ resetToken });

    } catch (error) {
        console.error("Verify Answer Error:", error);
        res.status(500).send('Server Error');
    }
});


// ====================================================================
// RESET PASSWORD WITH TOKEN ROUTE
// ====================================================================
router.post('/reset-password-with-token', async (req, res) => {
    const { email, token, password } = req.body;
    try {
        // FIX: Normalize email
        const normalizedEmail = email.toLowerCase();
        
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        
        const result = await pgPool.query(
            'SELECT * FROM users WHERE email = $1 AND reset_token = $2 AND reset_token_expires_at > NOW()',
            [normalizedEmail, hashedToken]
        );
        
        const user = result.rows[0];
        if (!user) {
            return res.status(400).json({ msg: 'Invalid or expired password reset token.' });
        }

        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Update password and clear the reset token
        await pgPool.query(
            'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires_at = NULL WHERE id = $2',
            [hashedPassword, user.id]
        );

        res.json({ msg: 'Password has been reset successfully.' });
    } catch (error) {
        console.error("Reset Password with Token Error:", error);
        res.status(500).send('Server Error');
    }
});

module.exports = router;