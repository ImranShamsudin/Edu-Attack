const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');

const router = express.Router();

// POST /attachments - student registers attachment using company name (+ optional address)
router.post('/', authenticateToken, requireRole('student'), async (req, res) => {
    const { 
        company_name, 
        address, 
        start_date, 
        end_date, 
        semester,
        duties_description,
        tools_used,
        additional_notes
    } = req.body;
    const studentId = req.user.id;

    if (!company_name || !start_date || !end_date) {
        return res.status(400).json({ error: 'company_name, start_date, and end_date are required' });
    }

    try {
        const trimmedName = company_name.trim();
        const trimmedAddress = address ? address.trim() : null;

        // 1. Look for an existing organization with the same name (case-insensitive)
        let orgResult = await pool.query(
            'SELECT id, address FROM organizations WHERE LOWER(name) = LOWER($1)',
            [trimmedName]
        );

        let organizationId;

        if (orgResult.rows.length > 0) {
            organizationId = orgResult.rows[0].id;
            if (trimmedAddress && !orgResult.rows[0].address) {
                await pool.query('UPDATE organizations SET address = $1 WHERE id = $2', [trimmedAddress, organizationId]);
            }
        } else {
            const newOrg = await pool.query(
                'INSERT INTO organizations (name, address) VALUES ($1, $2) RETURNING id',
                [trimmedName, trimmedAddress]
            );
            organizationId = newOrg.rows[0].id;
        }

        // 3. Create the attachment record with all the new fields
        const result = await pool.query(
            `INSERT INTO attachments (student_id, organization_id, start_date, end_date, semester, duties_description, tools_used, additional_notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING *`,
            [studentId, organizationId, start_date, end_date, semester || null, duties_description || null, tools_used || null, additional_notes || null]
        );

        res.status(201).json({ attachment: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error creating attachment' });
    }
});

// GET /attachments/me - student views their own attachment record(s), with organization details joined in
router.get('/me', authenticateToken, async (req, res) => {
  const studentId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT a.*, o.name AS organization_name, o.address AS organization_address,
              ind.name AS industrial_supervisor_name, uni.name AS university_supervisor_name
       FROM attachments a
       JOIN organizations o ON a.organization_id = o.id
       LEFT JOIN users ind ON a.industrial_supervisor_id = ind.id
       LEFT JOIN users uni ON a.university_supervisor_id = uni.id
       WHERE a.student_id = $1
       ORDER BY a.created_at DESC`,
      [studentId]
    );
    res.json({ attachments: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching attachments' });
  }
});

// GET /attachments/me/visits - student views university supervisor visit evaluations for their own attachment
router.get('/me/visits', authenticateToken, async (req, res) => {
  const studentId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT sv.* FROM supervisor_visits sv
       JOIN attachments a ON sv.attachment_id = a.id
       WHERE a.student_id = $1
       ORDER BY sv.visit_number`,
      [studentId]
    );
    res.json({ visits: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching visits' });
  }
});

module.exports = router;
