const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');

const router = express.Router();

// Store uploaded files on disk under uploads/final-reports, named by attachment id + original name
const uploadDir = path.join(__dirname, '..', 'uploads', 'final-reports');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_')}`;
    cb(null, safeName);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB cap
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (!allowed.includes(ext)) {
      return cb(new Error('Only PDF, DOC, or DOCX files are allowed'));
    }
    cb(null, true);
  },
});

// POST /final-report - student uploads their final report document (PDF/DOC/DOCX)
// multipart/form-data with fields: attachment_id, file
router.post('/', authenticateToken, requireRole('student'), upload.single('file'), async (req, res) => {
  const { attachment_id } = req.body;
  const studentId = req.user.id;

  if (!attachment_id || !req.file) {
    return res.status(400).json({ error: 'attachment_id and a file are required' });
  }

  try {
    const ownsCheck = await pool.query(
      'SELECT id FROM attachments WHERE id = $1 AND student_id = $2',
      [attachment_id, studentId]
    );
    if (ownsCheck.rows.length === 0) {
      return res.status(403).json({ error: 'This attachment record does not belong to you' });
    }

    const result = await pool.query(
      `INSERT INTO final_reports (attachment_id, file_path, original_filename)
       VALUES ($1, $2, $3)
       ON CONFLICT (attachment_id)
       DO UPDATE SET file_path = EXCLUDED.file_path, original_filename = EXCLUDED.original_filename, submitted_at = NOW()
       RETURNING *`,
      [attachment_id, req.file.filename, req.file.originalname]
    );
    res.status(201).json({ final_report: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error uploading final report' });
  }
});

// GET /final-report/me - student views their own submission status + grade if graded
router.get('/me', authenticateToken, requireRole('student'), async (req, res) => {
  const studentId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT fr.id, fr.original_filename, fr.submitted_at,
              fg.marks, fg.comments, fg.graded_at
       FROM attachments a
       LEFT JOIN final_reports fr ON fr.attachment_id = a.id
       LEFT JOIN final_grades fg ON fg.attachment_id = a.id
       WHERE a.student_id = $1
       ORDER BY a.created_at DESC
       LIMIT 1`,
      [studentId]
    );
    res.json({ final_report: result.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching final report status' });
  }
});

// GET /final-report/attachment/:attachmentId/download - admin/supervisors download the submitted file
router.get('/attachment/:attachmentId/download', authenticateToken, requireRole('admin', 'industrial_supervisor', 'university_supervisor'), async (req, res) => {
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

    const result = await pool.query('SELECT * FROM final_reports WHERE attachment_id = $1', [attachmentId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'No final report submitted yet' });
    }

    const fr = result.rows[0];
    const filePath = path.join(uploadDir, fr.file_path);
    res.download(filePath, fr.original_filename);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error downloading final report' });
  }
});

// GET /final-report/pending - admin views all students who have submitted (or not) their final report, with grade status
router.get('/pending', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id AS attachment_id, u.name AS student_name, u.email AS student_email,
              fr.original_filename, fr.submitted_at,
              fg.marks, fg.comments, fg.graded_at
       FROM attachments a
       JOIN users u ON a.student_id = u.id
       LEFT JOIN final_reports fr ON fr.attachment_id = a.id
       LEFT JOIN final_grades fg ON fg.attachment_id = a.id
       ORDER BY fr.submitted_at DESC NULLS LAST, u.name`
    );
    res.json({ submissions: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching submissions' });
  }
});

// PATCH /final-report/:attachmentId/grade - admin enters marks (0-100) and comments after reviewing
// the final report document together with the student's logbook and weekly reports
router.patch('/:attachmentId/grade', authenticateToken, requireRole('admin'), async (req, res) => {
  const { attachmentId } = req.params;
  const { marks, comments } = req.body;
  const graderId = req.user.id;

  if (marks === undefined || marks === null) {
    return res.status(400).json({ error: 'marks is required' });
  }
  if (marks < 0 || marks > 100) {
    return res.status(400).json({ error: 'marks must be between 0 and 100' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO final_grades (attachment_id, marks, comments, graded_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (attachment_id)
       DO UPDATE SET marks = EXCLUDED.marks, comments = EXCLUDED.comments, graded_by = EXCLUDED.graded_by, graded_at = NOW()
       RETURNING *`,
      [attachmentId, marks, comments || null, graderId]
    );
    res.json({ final_grade: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error saving grade' });
  }
});

module.exports = router;
