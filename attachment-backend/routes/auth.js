const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const rateLimit = require('../middleware/rateLimit');
const { cleanStr, normalizeEmail, isEmail, passwordProblem } = require('../utils/validate');
require('dotenv').config();

const router = express.Router();

const SUPERVISOR_ROLES = ['university_supervisor', 'industrial_supervisor'];
const COORDINATOR_CREATABLE_ROLES = ['student', 'admin', 'university_supervisor', 'industrial_supervisor'];

// A real bcrypt hash used to keep login timing the same whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many sign-in attempts. Please wait 15 minutes and try again.',
  keyFn: (req) => `${req.ip}|${normalizeEmail(req.body && req.body.email)}`,
});
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: 'Too many registrations from this address. Please try again later.',
});

function publicUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, role: u.role,
    phone: u.phone, department: u.department,
    must_change_password: u.must_change_password,
  };
}

// POST /auth/register - self-registration for university and industrial supervisors.
// The account is created as "pending": a coordinator must approve it before it can sign in.
router.post('/register', registerLimiter, async (req, res) => {
  const name = cleanStr(req.body.name, 100);
  const email = normalizeEmail(req.body.email);
  const { password, role } = req.body;
  const phone = cleanStr(req.body.phone, 30);
  const department = cleanStr(req.body.department, 150);

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, and role are required' });
  }
  if (!SUPERVISOR_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Only university and industrial supervisors can self-register. Student and coordinator accounts are created by the coordinator.' });
  }
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const pwProblem = passwordProblem(password);
  if (pwProblem) return res.status(400).json({ error: pwProblem });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, phone, department, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending')
       RETURNING id, name, email, role, phone, department`,
      [name, email, passwordHash, role, phone, department]
    );

    res.status(201).json({
      message: 'Account created. A coordinator must approve it before you can sign in.',
      user: result.rows[0],
    });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Email already registered' });
    console.error(err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// POST /auth/admin-create-user - coordinator creates any account with a temporary password.
// The account is forced to change its password on first login.
router.post('/admin-create-user', authenticateToken, requireRole('admin'), async (req, res) => {
  const name = cleanStr(req.body.name, 100);
  const email = normalizeEmail(req.body.email);
  const { role, temp_password } = req.body;
  const department = cleanStr(req.body.department, 150);
  const phone = cleanStr(req.body.phone, 30);

  if (!name || !email || !role || !temp_password) {
    return res.status(400).json({ error: 'name, email, role, and temp_password are required' });
  }
  if (!COORDINATOR_CREATABLE_ROLES.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }
  if (!isEmail(email)) return res.status(400).json({ error: 'Enter a valid email address' });
  const pwProblem = passwordProblem(temp_password);
  if (pwProblem) return res.status(400).json({ error: `Temporary ${pwProblem.charAt(0).toLowerCase()}${pwProblem.slice(1)}` });

  try {
    const existing = await pool.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered. Please use a different email.' });
    }

    const passwordHash = await bcrypt.hash(temp_password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, phone, department, must_change_password, approval_status)
       VALUES ($1, $2, $3, $4, $5, $6, TRUE, 'approved')
       RETURNING id, name, email, role, phone, department, must_change_password`,
      [name, email, passwordHash, role, phone, department]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error('Error creating user:', err);
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Email already registered. Please use a different email.' });
    }
    res.status(500).json({ error: 'Server error creating account' });
  }
});

// POST /auth/login
router.post('/login', loginLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password } = req.body;

  if (!email || !password || typeof password !== 'string') {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE LOWER(email) = $1', [email]);
    const user = result.rows[0];

    // Always run bcrypt so response time does not reveal whether the email exists.
    const passwordMatches = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
    if (!user || !passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    // Only reveal account state once the password is proven correct.
    if (user.approval_status === 'pending') {
      return res.status(403).json({ error: 'Your account is awaiting approval by the coordinator. You will be able to sign in once it is approved.' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your coordinator.' });
    }

    if (!process.env.JWT_SECRET) {
      console.error('FATAL: JWT_SECRET environment variable is not set.');
      return res.status(500).json({ error: 'Internal server configuration error' });
    }

    await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);
    loginLimiter.reset(req);

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '12h' }
    );

    res.json({ token, user: publicUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during login' });
  }
});

// POST /auth/change-password - any logged-in user changes their own password.
// Also clears must_change_password so they aren't prompted again.
router.post('/change-password', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'current_password and new_password are required' });
  }
  const pwProblem = passwordProblem(new_password);
  if (pwProblem) return res.status(400).json({ error: pwProblem.replace('Password', 'New password') });
  if (current_password === new_password) {
    return res.status(400).json({ error: 'New password must be different from the current one' });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const matches = await bcrypt.compare(String(current_password), user.password_hash);
    if (!matches) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(new_password, 10);
    await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = FALSE WHERE id = $2',
      [newHash, userId]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error changing password' });
  }
});

// PATCH /auth/profile - update own profile (name, phone, department).
// A field that is not sent is left alone; a field sent as "" is cleared.
router.patch('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const body = req.body || {};

  const sets = [];
  const params = [];
  const add = (column, value) => { params.push(value); sets.push(`${column} = $${params.length}`); };

  if (body.name !== undefined) {
    const name = cleanStr(body.name, 100);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
    add('name', name);
  }
  if (body.phone !== undefined) add('phone', cleanStr(body.phone, 30));
  if (body.department !== undefined) add('department', cleanStr(body.department, 150));

  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  try {
    params.push(userId);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, email, role, phone, department`,
      params
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

module.exports = router;
