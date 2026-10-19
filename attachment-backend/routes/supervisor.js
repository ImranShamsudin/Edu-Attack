const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { cleanStr, toId, isIsoDate } = require('../utils/validate');

const router = express.Router();
const SUPERVISORS = ['industrial_supervisor', 'university_supervisor'];

// Column on `attachments` that holds this supervisor's assignment. Only ever one of two fixed
// values, so it is safe to put in SQL.
const columnFor = (role) => (role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id');

// GET /supervisor/students - placements assigned to the logged-in supervisor
router.get('/students', authenticateToken, requireRole(...SUPERVISORS), async (req, res) => {
  const column = columnFor(req.user.role);
  try {
    const result = await pool.query(
      `SELECT a.id AS attachment_id, u.name AS student_name, u.email AS student_email, u.department,
              o.name AS organization, a.start_date, a.end_date, a.semester, a.status
       FROM attachments a
       JOIN users u ON a.student_id = u.id
       JOIN organizations o ON a.organization_id = o.id
       WHERE a.${column} = $1 AND a.status IN ('pending', 'active', 'completed')
       ORDER BY u.name`,
      [req.user.id]
    );
    res.json({ assigned_students: result.rows });
  } catch (err) {
    console.error('Error in /supervisor/students:', err);
    res.status(500).json({ error: 'Server error fetching assigned students' });
  }
});

// GET /supervisor/all-students - the supervisor's own students PLUS approved placements that have no
// supervisor of this type yet (so they can pick one). Placements supervised by someone else are not
// listed, and contact details are only revealed for the supervisor's own students.
router.get('/all-students', authenticateToken, requireRole(...SUPERVISORS), async (req, res) => {
  const column = columnFor(req.user.role);
  try {
    const result = await pool.query(
      `SELECT a.id AS attachment_id,
              u.name AS student_name,
              CASE WHEN a.${column} = $1 THEN u.email END AS student_email,
              u.department, o.name AS organization,
              a.start_date, a.end_date, a.semester, a.status,
              COALESCE(a.${column} = $1, FALSE) AS is_assigned
       FROM attachments a
       JOIN users u ON a.student_id = u.id
       JOIN organizations o ON a.organization_id = o.id
       WHERE a.${column} = $1
          OR (a.${column} IS NULL AND a.status = 'active')
       ORDER BY u.name`,
      [req.user.id]
    );
    res.json({ students: result.rows });
  } catch (err) {
    console.error('Error in /supervisor/all-students:', err);
    res.status(500).json({ error: 'Server error fetching students' });
  }
});

// Confirms the attachment is assigned to this supervisor. Returns the attachment row or null.
async function assignedAttachment(attachmentId, user) {
  const result = await pool.query(
    `SELECT id, status FROM attachments WHERE id = $1 AND ${columnFor(user.role)} = $2`,
    [attachmentId, user.id]
  );
  return result.rows[0] || null;
}

// GET /supervisor/logbook/:attachmentId
router.get('/logbook/:attachmentId', authenticateToken, requireRole(...SUPERVISORS), async (req, res) => {
  const attachmentId = toId(req.params.attachmentId);
  if (!attachmentId) return res.status(400).json({ error: 'Invalid attachment id' });

  try {
    if (!(await assignedAttachment(attachmentId, req.user))) {
      return res.status(403).json({ error: 'This student is not assigned to you' });
    }
    const entries = await pool.query(
      `SELECT le.*,
              COALESCE(
                json_agg(
                  json_build_object('id', sf.id, 'comment', sf.comment, 'supervisor_id', sf.supervisor_id, 'created_at', sf.created_at)
                  ORDER BY sf.created_at
                ) FILTER (WHERE sf.id IS NOT NULL), '[]'
              ) AS feedback
       FROM logbook_entries le
       LEFT JOIN supervisor_feedback sf ON sf.logbook_entry_id = le.id
       WHERE le.attachment_id = $1
       GROUP BY le.id
       ORDER BY le.entry_date DESC, le.id DESC`,
      [attachmentId]
    );
    res.json({ entries: entries.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching logbook' });
  }
});

// POST /supervisor/feedback
router.post('/feedback', authenticateToken, requireRole(...SUPERVISORS), async (req, res) => {
  const entryId = toId(req.body.logbook_entry_id);
  const comment = cleanStr(req.body.comment, 1000);
  if (!entryId || !comment) {
    return res.status(400).json({ error: 'logbook_entry_id and comment are required' });
  }

  try {
    const ownsCheck = await pool.query(
      `SELECT le.id FROM logbook_entries le
       JOIN attachments a ON le.attachment_id = a.id
       WHERE le.id = $1 AND a.${columnFor(req.user.role)} = $2`,
      [entryId, req.user.id]
    );
    if (ownsCheck.rows.length === 0) {
      return res.status(403).json({ error: 'This logbook entry is not assigned to you' });
    }

    const result = await pool.query(
      `INSERT INTO supervisor_feedback (logbook_entry_id, supervisor_id, comment)
       VALUES ($1, $2, $3) RETURNING *`,
      [entryId, req.user.id, comment]
    );
    res.status(201).json({ feedback: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error posting feedback' });
  }
});

// POST /supervisor/visit - university supervisor records (or updates) visit 1 or 2
router.post('/visit', authenticateToken, requireRole('university_supervisor'), async (req, res) => {
  const attachmentId = toId(req.body.attachment_id);
  const visitNumber = Number(req.body.visit_number);
  const comments = cleanStr(req.body.comments, 3000);
  const { visit_date } = req.body;

  if (!attachmentId || !comments || !visit_date) {
    return res.status(400).json({ error: 'attachment_id, visit_number, comments, and visit_date are required' });
  }
  if (![1, 2].includes(visitNumber)) {
    return res.status(400).json({ error: 'visit_number must be 1 (First Visit) or 2 (Second Visit)' });
  }
  if (!isIsoDate(visit_date)) {
    return res.status(400).json({ error: 'visit_date must be a valid date (YYYY-MM-DD)' });
  }

  try {
    const attachment = await assignedAttachment(attachmentId, req.user);
    if (!attachment) {
      return res.status(403).json({ error: 'This student is not assigned to you' });
    }
    if (!['active', 'completed'].includes(attachment.status)) {
      return res.status(409).json({ error: 'Visits can only be recorded for approved placements' });
    }

    const result = await pool.query(
      `INSERT INTO supervisor_visits (attachment_id, university_supervisor_id, visit_number, comments, visit_date)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (attachment_id, visit_number)
       DO UPDATE SET comments = EXCLUDED.comments, visit_date = EXCLUDED.visit_date,
                     university_supervisor_id = EXCLUDED.university_supervisor_id
       RETURNING *`,
      [attachmentId, req.user.id, visitNumber, comments, visit_date]
    );
    res.status(201).json({ visit: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error recording visit' });
  }
});

// GET /supervisor/visits/:attachmentId
router.get('/visits/:attachmentId', authenticateToken, requireRole('university_supervisor', 'industrial_supervisor', 'admin'), async (req, res) => {
  const attachmentId = toId(req.params.attachmentId);
  if (!attachmentId) return res.status(400).json({ error: 'Invalid attachment id' });

  try {
    if (req.user.role !== 'admin' && !(await assignedAttachment(attachmentId, req.user))) {
      return res.status(403).json({ error: 'This student is not assigned to you' });
    }
    const result = await pool.query(
      'SELECT * FROM supervisor_visits WHERE attachment_id = $1 ORDER BY visit_number',
      [attachmentId]
    );
    res.json({ visits: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching visits' });
  }
});

// PATCH /supervisor/attachments/:attachmentId/claim - a supervisor takes an approved, unassigned student.
// The UPDATE is atomic, so two supervisors clicking at once cannot both win.
router.patch('/attachments/:attachmentId/claim', authenticateToken, requireRole(...SUPERVISORS), async (req, res) => {
  const attachmentId = toId(req.params.attachmentId);
  if (!attachmentId) return res.status(400).json({ error: 'Invalid attachment id' });
  const column = columnFor(req.user.role);

  try {
    const result = await pool.query(
      `UPDATE attachments SET ${column} = $1
       WHERE id = $2 AND status = 'active' AND ${column} IS NULL
       RETURNING *`,
      [req.user.id, attachmentId]
    );
    if (result.rows.length > 0) return res.json({ attachment: result.rows[0] });

    const check = await pool.query(`SELECT status, ${column} AS assigned FROM attachments WHERE id = $1`, [attachmentId]);
    if (check.rows.length === 0) return res.status(404).json({ error: 'Attachment not found' });
    if (check.rows[0].assigned) {
      return res.status(409).json({ error: 'This student already has a supervisor assigned for your role' });
    }
    return res.status(409).json({ error: 'Only approved (active) placements can be taken' });
  } catch (err) {
    console.error('Error claiming student:', err);
    res.status(500).json({ error: 'Server error assigning yourself to this student' });
  }
});

module.exports = router;
