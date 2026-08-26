const jwt = require('jsonwebtoken');
require('dotenv').config();

// Checks for a valid JWT in the Authorization header.
// If valid, attaches { id, role } to req.user and lets the request through.
// If missing/invalid, blocks the request with a 401.
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization']; // format: "Bearer <token>"
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set.');
    return res.status(500).json({ error: 'Internal server configuration error' });
  }
  
  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = decoded; // { id, role }
    next();
  });
}

module.exports = authenticateToken;
