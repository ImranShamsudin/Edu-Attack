const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
require('dotenv').config();

const router = express.Router();

// POST /auth/register - self-registration for university and industrial supervisors.
// Student and coordinator accounts are provisioned by the coordinator.
router.post('/register', async (req, res) => {
  const { name, email, password, role, phone, department } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ error: 'name, email, password, and role are required' });
  }
  if (!['university_supervisor', 'industrial_supervisor'].includes(role)) {
    return res.status(400).json({ error: 'Only university and industrial supervisors can self-register. Student and coordinator accounts are created by the coordinator.' });
  }

  try {
    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, phone, department)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, name, email, role, phone, department`,
      [name, email, passwordHash, role, phone || null, department || null]
    );

    res.status(201).json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error during registration' });
  }
});

// POST /auth/admin-create-user - coordinator creates student/university supervisor accounts with a temp password.
// The account is forced to change its password on first login.
// POST /auth/admin-create-user - coordinator creates student/university supervisor accounts with a temp password.
// The account is forced to change its password on first login.
router.post('/admin-create-user', authenticateToken, requireRole('admin'), async (req, res) => {
    const { name, email, role, temp_password, department, phone } = req.body;

    // Validation
    if (!name || !email || !role || !temp_password) {
        return res.status(400).json({ error: 'name, email, role, and temp_password are required' });
    }
    if (!['student', 'admin', 'university_supervisor'].includes(role)) {
        return res.status(400).json({ error: 'Invalid role' });
    }
    if (temp_password.length < 6) {
        return res.status(400).json({ error: 'temp_password must be at least 6 characters' });
    }

    try {
        // Check if user already exists
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
        if (existing.rows.length > 0) {
            return res.status(409).json({ error: 'Email already registered. Please use a different email.' });
        }

        const passwordHash = await bcrypt.hash(temp_password, 10);

        const result = await pool.query(
            `INSERT INTO users (name, email, password_hash, role, phone, department, must_change_password)
             VALUES ($1, $2, $3, $4, $5, $6, TRUE)
             RETURNING id, name, email, role, phone, department, must_change_password`,
            [name, email, passwordHash, role, phone || null, department || null]
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
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }

  try {
    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    if (!user.is_active) {
      return res.status(403).json({ error: 'This account has been deactivated. Contact your coordinator.' });
    }

    const passwordMatches = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatches) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' }
    );

    res.json({
      token,
      user: {
        id: user.id, name: user.name, email: user.email, role: user.role,
        phone: user.phone, department: user.department,
        must_change_password: user.must_change_password,
      },
    });
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
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'new_password must be at least 6 characters' });
  }

  try {
    const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [userId]);
    const user = result.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found' });

    const matches = await bcrypt.compare(current_password, user.password_hash);
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

// PATCH /auth/profile - update own profile (name, phone, department)
router.patch('/profile', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { name, phone, department } = req.body;

  try {
    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name), phone = COALESCE($2, phone), department = COALESCE($3, department)
       WHERE id = $4
       RETURNING id, name, email, role, phone, department`,
      [name || null, phone || null, department || null, userId]
    );
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating profile' });
  }
});

module.exports = router;
