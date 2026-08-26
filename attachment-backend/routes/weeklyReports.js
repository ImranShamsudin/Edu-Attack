const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');

const router = express.Router();

// Helper: confirm the attachment belongs to the logged-in student
async function studentOwnsAttachment(attachmentId, studentId) {
  const result = await pool.query(
    'SELECT id FROM attachments WHERE id = $1 AND student_id = $2',
    [attachmentId, studentId]
  );
  return result.rows.length > 0;
}

// POST /weekly-reports - student submits their weekly report
// Matches "TRAINEE'S WEEKLY REPORT" in the physical logbook, one per week per attachment
router.post('/', authenticateToken, requireRole('student'), async (req, res) => {
  const studentId = req.user.id;
  const { attachment_id, week_number, week_ending, report_text } = req.body;

  if (!attachment_id || !week_number || !week_ending || !report_text) {
    return res.status(400).json({ error: 'attachment_id, week_number, week_ending, and report_text are required' });
  }

  try {
    const owns = await studentOwnsAttachment(attachment_id, studentId);
    if (!owns) {
      return res.status(403).json({ error: 'This attachment record does not belong to you' });
    }

    const result = await pool.query(
      `INSERT INTO weekly_reports (attachment_id, week_number, week_ending, report_text)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (attachment_id, week_number)
       DO UPDATE SET week_ending = EXCLUDED.week_ending, report_text = EXCLUDED.report_text
       RETURNING *`,
      [attachment_id, week_number, week_ending, report_text]
    );
    res.status(201).json({ weekly_report: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error submitting weekly report' });
  }
});

// GET /weekly-reports/me - student views their own weekly reports
router.get('/me', authenticateToken, requireRole('student'), async (req, res) => {
  const studentId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT wr.* FROM weekly_reports wr
       JOIN attachments a ON wr.attachment_id = a.id
       WHERE a.student_id = $1
       ORDER BY wr.week_number`,
      [studentId]
    );
    res.json({ weekly_reports: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching weekly reports' });
  }
});

// GET /weekly-reports/attachment/:attachmentId - supervisor or admin views a student's weekly reports
router.get('/attachment/:attachmentId', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor', 'admin'), async (req, res) => {
  const { attachmentId } = req.params;
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

// PATCH /weekly-reports/:id/comment - supervisor (industrial or university) adds their weekly comment
// Matches "Comments by Lecturer/ Supervisor" under each week in the physical logbook
router.patch('/:id/comment', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor'), async (req, res) => {
  const { id } = req.params;
  const { id: supervisorId, role } = req.user;
  const { supervisor_comment } = req.body;

  if (!supervisor_comment) {
    return res.status(400).json({ error: 'supervisor_comment is required' });
  }

  try {
    const column = role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id';
    const ownsCheck = await pool.query(
      `SELECT wr.id FROM weekly_reports wr
       JOIN attachments a ON wr.attachment_id = a.id
       WHERE wr.id = $1 AND a.${column} = $2`,
      [id, supervisorId]
    );
    if (ownsCheck.rows.length === 0) {
      return res.status(403).json({ error: 'This weekly report is not assigned to you' });
    }

    const result = await pool.query(
      `UPDATE weekly_reports
       SET supervisor_comment = $1, supervisor_id = $2, commented_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [supervisor_comment, supervisorId, id]
    );
    res.json({ weekly_report: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error adding comment' });
  }
});

module.exports = router;
