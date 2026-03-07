const jwt = require('jsonwebtoken');

module.exports = function(req, res, next) {
    console.log("\n--- AUTH MIDDLEWARE HIT ---");
    
    // 1. Get token from header
    const authHeader = req.header('Authorization');
    console.log("1. Authorization Header:", authHeader);

    if (!authHeader) {
        console.log("2. FAIL: No Authorization header sent.");
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    const token = authHeader.split(' ')[1];
    
    if (!token) {
        console.log("2. FAIL: Header exists but token is missing.");
        return res.status(401).json({ msg: 'No token, authorization denied' });
    }

    // 3. Verify token
    try {
        // Log the secret (First 3 chars only for security) to make sure it loaded
        const secret = process.env.JWT_SECRET;
        console.log("3. Verifying with JWT_SECRET:", secret ? `${secret.substring(0,3)}...` : "UNDEFINED/NULL");

        if (!secret) {
            console.log("CRITICAL ERROR: JWT_SECRET is missing in .env file!");
            return res.status(500).json({ msg: 'Server Configuration Error' });
        }

        const decoded = jwt.verify(token, secret);
        console.log("4. SUCCESS: Token decoded. User ID:", decoded.user.id);

        req.user = decoded.user;
        next();
    } catch (err) {
        console.log("4. FAIL: Token verification failed.");
        console.log("   Reason:", err.message);
        res.status(401).json({ msg: 'Token is not valid' });
    }
};