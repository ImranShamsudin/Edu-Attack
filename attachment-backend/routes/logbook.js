const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');

const router = express.Router();

// Helper: confirm the attachment belongs to the logged-in student
async function verifyOwnership(attachmentId, studentId) {
  const result = await pool.query(
    'SELECT id FROM attachments WHERE id = $1 AND student_id = $2',
    [attachmentId, studentId]
  );
  return result.rows.length > 0;
}

// POST /logbook - student creates a daily logbook entry
router.post('/', authenticateToken, async (req, res) => {
  const { attachment_id, entry_date, description } = req.body;
  const studentId = req.user.id;

  if (!attachment_id || !entry_date || !description) {
    return res.status(400).json({ error: 'attachment_id, entry_date, and description are required' });
  }

  try {
    const owns = await verifyOwnership(attachment_id, studentId);
    if (!owns) {
      return res.status(403).json({ error: 'This attachment record does not belong to you' });
    }

    const result = await pool.query(
      `INSERT INTO logbook_entries (attachment_id, entry_date, description)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [attachment_id, entry_date, description]
    );
    res.status(201).json({ entry: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating logbook entry' });
  }
});

// GET /logbook/me - student lists their own logbook entries, newest first, with any supervisor feedback
router.get('/me', authenticateToken, async (req, res) => {
  const studentId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT le.*,
              COALESCE(
                json_agg(
                  json_build_object('id', sf.id, 'comment', sf.comment, 'created_at', sf.created_at)
                ) FILTER (WHERE sf.id IS NOT NULL), '[]'
              ) AS feedback
       FROM logbook_entries le
       JOIN attachments a ON le.attachment_id = a.id
       LEFT JOIN supervisor_feedback sf ON sf.logbook_entry_id = le.id
       WHERE a.student_id = $1
       GROUP BY le.id
       ORDER BY le.entry_date DESC`,
      [studentId]
    );
    res.json({ entries: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching logbook entries' });
  }
});

module.exports = router;
