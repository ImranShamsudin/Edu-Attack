const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { cleanStr, toId, isEmail } = require('../utils/validate');

const router = express.Router();

async function validContact(id) {
  const check = await pool.query(
    `SELECT id FROM users WHERE id = $1 AND role = 'industrial_supervisor' AND is_active = TRUE AND approval_status = 'approved'`,
    [id]
  );
  return check.rows.length > 0;
}

// GET /organizations - any logged-in user can list organizations.
// Contact details (name, email, phone) are only returned to the coordinator.
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT o.id, o.name, o.address, o.phone, o.email, o.created_at,
              u.id AS contact_id, u.name AS contact_name, u.email AS contact_email, u.phone AS contact_phone
       FROM organizations o
       LEFT JOIN users u ON o.primary_contact_id = u.id
       ORDER BY o.name`
    );
    let organizations = result.rows;
    if (req.user.role !== 'admin') {
      organizations = organizations.map((o) => ({
        id: o.id, name: o.name, address: o.address, created_at: o.created_at,
      }));
    }
    res.json({ organizations });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching organizations' });
  }
});

// POST /organizations - coordinator creates an organization, optionally with a primary contact
router.post('/', authenticateToken, requireRole('admin'), async (req, res) => {
  const name = cleanStr(req.body.name, 150);
  const address = cleanStr(req.body.address, 255);
  const phone = cleanStr(req.body.phone, 30);
  const email = cleanStr(req.body.email, 150);
  const contactId = req.body.primary_contact_id ? toId(req.body.primary_contact_id) : null;

  if (!name) return res.status(400).json({ error: 'name is required' });
  if (email && !isEmail(email)) return res.status(400).json({ error: 'Organization email is not valid' });
  if (req.body.primary_contact_id && !contactId) {
    return res.status(400).json({ error: 'primary_contact_id is not valid' });
  }

  try {
    const dup = await pool.query('SELECT id FROM organizations WHERE LOWER(name) = LOWER($1)', [name]);
    if (dup.rows.length > 0) {
      return res.status(409).json({ error: 'An organization with that name already exists' });
    }
    if (contactId && !(await validContact(contactId))) {
      return res.status(400).json({ error: 'primary_contact_id must belong to an active, approved industrial supervisor' });
    }

    const result = await pool.query(
      `INSERT INTO organizations (name, address, phone, email, primary_contact_id)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, address, phone, email, contactId]
    );
    res.status(201).json({ organization: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating organization' });
  }
});

// PATCH /organizations/:id - coordinator fixes a name/address/phone/email (students type these in themselves)
router.patch('/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid organization id' });
  const body = req.body || {};

  const sets = [];
  const params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (body.name !== undefined) {
    const name = cleanStr(body.name, 150);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
    add('name', name);
  }
  if (body.address !== undefined) add('address', cleanStr(body.address, 255));
  if (body.phone !== undefined) add('phone', cleanStr(body.phone, 30));
  if (body.email !== undefined) {
    const email = cleanStr(body.email, 150);
    if (email && !isEmail(email)) return res.status(400).json({ error: 'Organization email is not valid' });
    add('email', email);
  }
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  try {
    params.push(id);
    const result = await pool.query(
      `UPDATE organizations SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating organization' });
  }
});

// PATCH /organizations/:id/contact - assign, change or clear (null) the primary contact
router.patch('/:id/contact', authenticateToken, requireRole('admin'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid organization id' });

  const raw = req.body.primary_contact_id;
  if (raw === undefined) return res.status(400).json({ error: 'primary_contact_id is required (use null to clear)' });
  const contactId = raw === null || raw === '' ? null : toId(raw);
  if (raw !== null && raw !== '' && !contactId) {
    return res.status(400).json({ error: 'primary_contact_id is not valid' });
  }

  try {
    if (contactId && !(await validContact(contactId))) {
      return res.status(400).json({ error: 'primary_contact_id must belong to an active, approved industrial supervisor' });
    }
    const result = await pool.query(
      'UPDATE organizations SET primary_contact_id = $1 WHERE id = $2 RETURNING *',
      [contactId, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating contact' });
  }
});

module.exports = router;
