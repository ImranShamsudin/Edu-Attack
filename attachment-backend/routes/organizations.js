const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// GET /organizations - any logged-in user can view the list, with primary contact's details joined in
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.name, o.address, o.created_at,
              u.id AS contact_id, u.name AS contact_name, u.email AS contact_email, u.phone AS contact_phone
       FROM organizations o
       LEFT JOIN users u ON o.primary_contact_id = u.id
       ORDER BY o.name`
    );
    res.json({ organizations: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching organizations' });
  }
});

// POST /organizations - create a new organization, optionally linking an existing
// industrial_supervisor user as its primary contact (the person the school interacts with)
router.post('/', authenticateToken, async (req, res) => {
  const { name, address, primary_contact_id } = req.body;

  if (!name) {
    return res.status(400).json({ error: 'name is required' });
  }

  try {
    if (primary_contact_id) {
      const check = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND role = 'industrial_supervisor'",
        [primary_contact_id]
      );
      if (check.rows.length === 0) {
        return res.status(400).json({ error: 'primary_contact_id must belong to a registered industrial_supervisor user' });
      }
    }

    const result = await pool.query(
      `INSERT INTO organizations (name, address, primary_contact_id)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [name, address || null, primary_contact_id || null]
    );
    res.status(201).json({ organization: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating organization' });
  }
});

// PATCH /organizations/:id/contact - assign or change the primary contact after the fact
// (useful when the supervisor registers an account after the org was already created)
router.patch('/:id/contact', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { primary_contact_id } = req.body;

  if (!primary_contact_id) {
    return res.status(400).json({ error: 'primary_contact_id is required' });
  }

  try {
    const check = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'industrial_supervisor'",
      [primary_contact_id]
    );
    if (check.rows.length === 0) {
      return res.status(400).json({ error: 'primary_contact_id must belong to a registered industrial_supervisor user' });
    }

    const result = await pool.query(
      `UPDATE organizations SET primary_contact_id = $1 WHERE id = $2 RETURNING *`,
      [primary_contact_id, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }
    res.json({ organization: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating contact' });
  }
});

module.exports = router;
