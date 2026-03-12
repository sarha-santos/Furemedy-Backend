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
const { createClient } = require('@supabase/supabase-js');

// 1. Initialize Supabase and Google
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);
const googleClient = new OAuth2Client(process.env.GOOGLE_WEB_CLIENT_ID);

// 2. Configure Multer (ONLY ONCE)
// We use memoryStorage because the file goes to Supabase, not your Render server's disk
const upload = multer({ storage: multer.memoryStorage() });

// ====================================================================
// SIGNUP ROUTE
// ====================================================================
router.post("/signup", upload.single('profileImage'), async (req, res) => {
   // ... rest of your code
  // Match the snake_case keys sent from the updated SignupScreen.tsx
  const { 
    first_name, 
    last_name, 
    email, 
    mobile_number, 
    password, 
    security_question, 
    security_answer 
  } = req.body;

  let profileImageUrl = null;

  // Basic validation
  if (!first_name || !last_name || !email || !mobile_number || !password || !security_question || !security_answer) {
    return res.status(400).json({ msg: "Please enter all fields correctly." });
  }

  try {
    // 1. Check if user exists
    const userExists = await pgPool.query(
        "SELECT * FROM users WHERE email = $1 OR mobile_number = $2", 
        [email, mobile_number]
    );
    if (userExists.rows.length > 0) {
      return res.status(400).json({ msg: "User with this email or mobile number already exists." });
    }

    // 2. Handle Profile Image Upload to Supabase
    if (req.file) {
      const fileExt = path.extname(req.file.originalname) || '.jpg';
      const fileName = `profile-${Date.now()}${fileExt}`;

      const { data, error: uploadError } = await supabase.storage
        .from('profile-pictures')
        .upload(fileName, req.file.buffer, {
          contentType: req.file.mimetype,
          upsert: true
        });

      if (uploadError) {
        console.error("Supabase Profile Upload Error:", uploadError.message);
        // We continue without an image if upload fails, or you can throw error
      } else {
        const { data: publicUrlData } = supabase.storage
          .from('profile-pictures')
          .getPublicUrl(fileName);
        profileImageUrl = publicUrlData.publicUrl;
      }
    }

    // 3. Hash sensitive data
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const hashedSecurityAnswer = await bcrypt.hash(security_answer, salt);

    // 4. Insert into PostgreSQL
    const newUserResult = await pgPool.query(
      `INSERT INTO users 
      (first_name, last_name, email, mobile_number, password, profile_image_path, is_verified, security_question, security_answer) 
      VALUES ($1, $2, $3, $4, $5, $6, TRUE, $7, $8) RETURNING *`,
      [first_name, last_name, email, mobile_number, hashedPassword, profileImageUrl, security_question, hashedSecurityAnswer]
    );

    const user = newUserResult.rows[0];
    const payload = { user: { id: user.id } };
    
    // 5. Generate JWT
    jwt.sign(payload, process.env.JWT_SECRET, { expiresIn: '30d' }, (err, token) => {
      if (err) throw err;
      res.status(201).json({
        token,
        user: { 
            id: user.id, 
            first_name: user.first_name, 
            email: user.email, 
            profile_image_path: user.profile_image_path 
        }
      });
    });

  } catch (err) {
    console.error("Signup server error:", err.message);
    res.status(500).json({ msg: "Server Error during registration" });
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
            email = payload.email;
            firstName = payload.given_name;
            lastName = payload.family_name;
            profileImage = payload.picture;
        } else if (provider === 'apple') {
            const decoded = jwt.decode(token);
            if (!decoded) return res.status(400).json({ msg: 'Invalid Apple token.' });
            email = decoded.email;
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

        res.json({
            token: appToken,
            user: { id: user.id, first_name: user.first_name, last_name: user.last_name, email: user.email, profile_image_path: user.profile_image_path }
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
        const result = await pgPool.query('SELECT security_question FROM users WHERE email = $1', [email]);
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
        const result = await pgPool.query('SELECT * FROM users WHERE email = $1', [email]);
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
        const hashedToken = crypto.createHash('sha256').update(token).digest('hex');
        
        const result = await pgPool.query(
            'SELECT * FROM users WHERE email = $1 AND reset_token = $2 AND reset_token_expires_at > NOW()',
            [email, hashedToken]
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