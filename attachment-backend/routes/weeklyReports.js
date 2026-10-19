const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { cleanStr, toId, isIsoDate } = require('../utils/validate');

const router = express.Router();

// POST /weekly-reports - student submits (or edits, until reviewed) the report for a week.
// Matches "TRAINEE'S WEEKLY REPORT" in the physical logbook: one per week per attachment.
router.post('/', authenticateToken, requireRole('student'), async (req, res) => {
  const attachmentId = toId(req.body.attachment_id);
  const weekNumber = Number(req.body.week_number);
  const reportText = cleanStr(req.body.report_text, 5000);
  const { week_ending } = req.body;

  if (!attachmentId || !req.body.week_number || !week_ending || !reportText) {
    return res.status(400).json({ error: 'attachment_id, week_number, week_ending, and report_text are required' });
  }
  if (!Number.isInteger(weekNumber) || weekNumber < 1 || weekNumber > 52) {
    return res.status(400).json({ error: 'week_number must be a whole number between 1 and 52' });
  }
  if (!isIsoDate(week_ending)) {
    return res.status(400).json({ error: 'week_ending must be a valid date (YYYY-MM-DD)' });
  }

  try {
    const owns = await pool.query(
      'SELECT status FROM attachments WHERE id = $1 AND student_id = $2',
      [attachmentId, req.user.id]
    );
    if (owns.rows.length === 0) {
      return res.status(403).json({ error: 'This attachment record does not belong to you' });
    }
    if (owns.rows[0].status !== 'active') {
      return res.status(409).json({ error: 'You can only submit weekly reports once your placement has been approved and while it is active' });
    }

    // The WHERE on DO UPDATE stops a student rewriting a report their supervisor has already reviewed.
    const result = await pool.query(
      `INSERT INTO weekly_reports (attachment_id, week_number, week_ending, report_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (attachment_id, week_number)
       DO UPDATE SET week_ending = EXCLUDED.week_ending, report_text = EXCLUDED.report_text
       WHERE weekly_reports.supervisor_comment IS NULL
       RETURNING *`,
      [attachmentId, weekNumber, week_ending, reportText]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: `Week ${weekNumber} has already been reviewed by your supervisor and can no longer be changed` });
    }
    res.status(201).json({ weekly_report: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error submitting weekly report' });
  }
});

// GET /weekly-reports/me - student views their own weekly reports
router.get('/me', authenticateToken, requireRole('student'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT wr.* FROM weekly_reports wr
       JOIN attachments a ON wr.attachment_id = a.id
       WHERE a.student_id = $1
       ORDER BY wr.week_number`,
      [req.user.id]
    );
    res.json({ weekly_reports: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching weekly reports' });
  }
});

// GET /weekly-reports/attachment/:attachmentId - assigned supervisor or admin views a student's reports
router.get('/attachment/:attachmentId', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor', 'admin'), async (req, res) => {
  const attachmentId = toId(req.params.attachmentId);
  if (!attachmentId) return res.status(400).json({ error: 'Invalid attachment id' });
  const { id: userId, role } = req.user;

  try {
    if (role !== 'admin') {
      const column = role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id';
      const ownsCheck = await pool.query(
        `SELECT id FROM attachments WHERE id = $1 AND ${column} = $2`,
        [attachmentId, userId]
      );
      if (ownsCheck.rows.length === 0) {
        return res.status(403).json({ error: 'This student is not assigned to you' });
      }
    }
    const result = await pool.query(
      'SELECT * FROM weekly_reports WHERE attachment_id = $1 ORDER BY week_number',
      [attachmentId]
    );
    res.json({ weekly_reports: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching weekly reports' });
  }
});

// PATCH /weekly-reports/:id/comment - the assigned supervisor adds the weekly comment.
// Only the first comment is accepted, so one supervisor can never silently overwrite another's.
router.patch('/:id/comment', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor'), async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return res.status(400).json({ error: 'Invalid report id' });
  const comment = cleanStr(req.body.supervisor_comment, 1000);
  if (!comment) return res.status(400).json({ error: 'supervisor_comment is required' });

  const { id: supervisorId, role } = req.user;
  const column = role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id';

  try {
    const ownsCheck = await pool.query(
      `SELECT wr.id, wr.supervisor_comment FROM weekly_reports wr
       JOIN attachments a ON wr.attachment_id = a.id
       WHERE wr.id = $1 AND a.${column} = $2`,
      [id, supervisorId]
    );
    if (ownsCheck.rows.length === 0) {
      return res.status(403).json({ error: 'This weekly report is not assigned to you' });
    }
    if (ownsCheck.rows[0].supervisor_comment) {
      return res.status(409).json({ error: 'This report already has a supervisor comment' });
    }

    const result = await pool.query(
      `UPDATE weekly_reports
       SET supervisor_comment = $1, supervisor_id = $2, commented_at = NOW()
       WHERE id = $3 AND supervisor_comment IS NULL
       RETURNING *`,
      [comment, supervisorId, id]
    );
    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'This report already has a supervisor comment' });
    }
    res.json({ weekly_report: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error adding comment' });
  }
});

module.exports = router;
