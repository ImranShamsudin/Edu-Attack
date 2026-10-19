const jwt = require('jsonwebtoken');
const pool = require('../db');
require('dotenv').config();

// Verifies the Bearer token, then re-checks the account in the database so that
// deactivating a user, un-approving them or changing their role takes effect
// immediately instead of when their token expires.
//
// Also enforces "must change password" on the SERVER (not just in the browser):
// until the password is changed, every endpoint except /auth/change-password is blocked.
async function authenticateToken(req, res, next) {
  const header = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(header);
  if (!match) {
    return res.status(401).json({ error: 'No token provided', code: 'NO_TOKEN' });
  }

  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set.');
    return res.status(500).json({ error: 'Internal server configuration error' });
  }

  let decoded;
  try {
    decoded = jwt.verify(match[1], process.env.JWT_SECRET);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token', code: 'INVALID_TOKEN' });
  }

  try {
    const result = await pool.query(
      'SELECT id, role, is_active, approval_status, must_change_password FROM users WHERE id = $1',
      [decoded.id]
    );
    const user = result.rows[0];

    if (!user || !user.is_active || user.approval_status !== 'approved') {
      return res.status(401).json({ error: 'This account is not active', code: 'ACCOUNT_INACTIVE' });
    }

    const path = req.originalUrl.split('?')[0];
    if (user.must_change_password && path !== '/auth/change-password') {
      return res.status(403).json({
        error: 'You must change your temporary password before continuing',
        code: 'PASSWORD_CHANGE_REQUIRED',
      });
    }

    req.user = { id: user.id, role: user.role }; // role always comes from the DB, not the token
    next();
  } catch (err) {
    console.error('Auth lookup failed:', err);
    res.status(500).json({ error: 'Server error while verifying your session' });
  }
}

module.exports = authenticateToken;
