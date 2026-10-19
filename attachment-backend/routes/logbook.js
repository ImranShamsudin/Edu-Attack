const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { cleanStr, toId, isIsoDate, isoDay } = require('../utils/validate');

const router = express.Router();

// POST /logbook - student creates a daily logbook entry.
// Only allowed once the placement is approved (active), for a date inside the
// attachment period and not in the future.
router.post('/', authenticateToken, requireRole('student'), async (req, res) => {
  const attachmentId = toId(req.body.attachment_id);
  const { entry_date } = req.body;
  const description = cleanStr(req.body.description, 3000);

  if (!attachmentId || !entry_date || !description) {
    return res.status(400).json({ error: 'attachment_id, entry_date, and description are required' });
  }
  if (!isIsoDate(entry_date)) {
    return res.status(400).json({ error: 'entry_date must be a valid date (YYYY-MM-DD)' });
  }

  try {
    const result = await pool.query(
      'SELECT id, status, start_date, end_date FROM attachments WHERE id = $1 AND student_id = $2',
      [attachmentId, req.user.id]
    );
    const attachment = result.rows[0];
    if (!attachment) {
      return res.status(403).json({ error: 'This attachment record does not belong to you' });
    }
    if (attachment.status !== 'active') {
      return res.status(409).json({ error: 'You can only log entries once your placement has been approved and while it is active' });
    }
    if (entry_date < attachment.start_date || entry_date > attachment.end_date) {
      return res.status(400).json({ error: 'The entry date must fall within your attachment period' });
    }
    if (entry_date > isoDay(1)) { // +1 day tolerates time-zone differences
      return res.status(400).json({ error: 'You cannot log an entry for a future date' });
    }

    const inserted = await pool.query(
      `INSERT INTO logbook_entries (attachment_id, entry_date, description)
       VALUES ($1, $2, $3) RETURNING *`,
      [attachmentId, entry_date, description]
    );
    res.status(201).json({ entry: inserted.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error creating logbook entry' });
  }
});

// GET /logbook/me - the student's own entries, newest first, with supervisor feedback
router.get('/me', authenticateToken, requireRole('student'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT le.*,
              COALESCE(
                json_agg(
                  json_build_object('id', sf.id, 'comment', sf.comment, 'created_at', sf.created_at)
                  ORDER BY sf.created_at
                ) FILTER (WHERE sf.id IS NOT NULL), '[]'
              ) AS feedback
       FROM logbook_entries le
       JOIN attachments a ON le.attachment_id = a.id
       LEFT JOIN supervisor_feedback sf ON sf.logbook_entry_id = le.id
       WHERE a.student_id = $1
       GROUP BY le.id
       ORDER BY le.entry_date DESC, le.id DESC`,
      [req.user.id]
    );
    res.json({ entries: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching logbook entries' });
  }
});

module.exports = router;
