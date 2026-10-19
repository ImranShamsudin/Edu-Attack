const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { cleanStr, isIsoDate, isEmail } = require('../utils/validate');

const router = express.Router();

// POST /attachments - a student submits a placement for coordinator approval
router.post('/', authenticateToken, requireRole('student'), async (req, res) => {
  const body = req.body || {};
  const companyName = cleanStr(body.company_name, 150);
  const address = cleanStr(body.address, 255);
  const orgPhone = cleanStr(body.phone, 30);
  const orgEmail = cleanStr(body.org_email, 150);
  const branch = cleanStr(body.branch, 150);
  const semester = cleanStr(body.semester, 100);
  const duties = cleanStr(body.duties_description, 3000);
  const tools = cleanStr(body.tools_used, 1000);
  const notes = cleanStr(body.additional_notes, 3000);
  const { start_date, end_date } = body;
  const studentId = req.user.id;

  if (!companyName || !start_date || !end_date) {
    return res.status(400).json({ error: 'company_name, start_date, and end_date are required' });
  }
  if (!duties) {
    return res.status(400).json({ error: 'duties_description is required' });
  }
  if (!isIsoDate(start_date) || !isIsoDate(end_date)) {
    return res.status(400).json({ error: 'Dates must be valid and in YYYY-MM-DD format' });
  }
  if (end_date < start_date) {
    return res.status(400).json({ error: 'End date cannot be before the start date' });
  }
  if (orgEmail && !isEmail(orgEmail)) {
    return res.status(400).json({ error: 'Organization email is not a valid email address' });
  }

  const client = await pool.connect();
  try {
    // A student may have only one open placement, and cannot re-apply after completing.
    const existing = await client.query(
      `SELECT status FROM attachments
       WHERE student_id = $1 AND status IN ('pending', 'active', 'completed') LIMIT 1`,
      [studentId]
    );
    if (existing.rows.length > 0) {
      const messages = {
        pending: 'You already have a placement awaiting approval.',
        active: 'You already have an active placement.',
        completed: 'You have already completed your attachment.',
      };
      return res.status(409).json({ error: messages[existing.rows[0].status] });
    }

    await client.query('BEGIN');

    // Re-use an existing organization with the same name (case-insensitive), else create one.
    const orgResult = await client.query(
      'SELECT id, address, phone, email FROM organizations WHERE LOWER(name) = LOWER($1) ORDER BY id LIMIT 1',
      [companyName]
    );

    let organizationId;
    if (orgResult.rows.length > 0) {
      const org = orgResult.rows[0];
      organizationId = org.id;
      // Only fill in details the organization does not have yet; never overwrite.
      await client.query(
        `UPDATE organizations SET
           address = COALESCE(address, $1), phone = COALESCE(phone, $2), email = COALESCE(email, $3)
         WHERE id = $4`,
        [address, orgPhone, orgEmail, organizationId]
      );
    } else {
      const newOrg = await client.query(
        'INSERT INTO organizations (name, address, phone, email) VALUES ($1, $2, $3, $4) RETURNING id',
        [companyName, address, orgPhone, orgEmail]
      );
      organizationId = newOrg.rows[0].id;
    }

    const result = await client.query(
      `INSERT INTO attachments
         (student_id, organization_id, start_date, end_date, semester, branch,
          duties_description, tools_used, additional_notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [studentId, organizationId, start_date, end_date, semester, branch, duties, tools, notes]
    );

    await client.query('COMMIT');
    res.status(201).json({ attachment: result.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') {
      return res.status(409).json({ error: 'You already have an open placement.' });
    }
    console.error(err);
    res.status(500).json({ error: 'Server error creating attachment' });
  } finally {
    client.release();
  }
});

// GET /attachments/me - the student's own placements, newest first, with organization and supervisor details
router.get('/me', authenticateToken, requireRole('student'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.*, o.name AS organization_name, o.address AS organization_address,
              o.phone AS organization_phone, o.email AS organization_email,
              ind.name AS industrial_supervisor_name, uni.name AS university_supervisor_name
       FROM attachments a
       JOIN organizations o ON a.organization_id = o.id
       LEFT JOIN users ind ON a.industrial_supervisor_id = ind.id
       LEFT JOIN users uni ON a.university_supervisor_id = uni.id
       WHERE a.student_id = $1
       ORDER BY a.created_at DESC, a.id DESC`,
      [req.user.id]
    );
    res.json({ attachments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching attachments' });
  }
});

// GET /attachments/me/visits - university supervisor visit evaluations for the student's attachment(s)
router.get('/me/visits', authenticateToken, requireRole('student'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT sv.* FROM supervisor_visits sv
       JOIN attachments a ON sv.attachment_id = a.id
       WHERE a.student_id = $1
       ORDER BY sv.visit_number`,
      [req.user.id]
    );
    res.json({ visits: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching visits' });
  }
});

module.exports = router;
