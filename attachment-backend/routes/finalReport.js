const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { cleanStr, toId } = require('../utils/validate');

const router = express.Router();

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'final-reports');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED_EXT = ['.pdf', '.doc', '.docx'];

// File content must match its extension (a renamed .exe is rejected).
const SIGNATURES = {
  '.pdf': [Buffer.from('%PDF')],
  '.docx': [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  '.doc': [Buffer.from([0xd0, 0xcf, 0x11, 0xe0])],
};

function hasValidSignature(filePath, ext) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const head = Buffer.alloc(8);
    fs.readSync(fd, head, 0, 8, 0);
    return (SIGNATURES[ext] || []).some((sig) => head.subarray(0, sig.length).equals(sig));
  } catch (e) {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function removeFile(filePath) {
  fs.unlink(filePath, () => {});
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  // Random name: the user's filename is never used on disk (kept only in the DB for display).
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${path.extname(file.originalname).toLowerCase()}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXT.includes(ext)) {
      const err = new Error('Only PDF, DOC and DOCX files are allowed');
      err.isUserError = true;
      return cb(err);
    }
    cb(null, true);
  },
});

// POST /final-report - student uploads (or replaces, until graded) their final report
router.post('/', authenticateToken, requireRole('student'), upload.single('file'), async (req, res) => {
  const uploaded = req.file;
  const fail = (status, message) => {
    if (uploaded) removeFile(uploaded.path);
    return res.status(status).json({ error: message });
  };

  const attachmentId = toId(req.body.attachment_id);
  if (!attachmentId) return fail(400, 'attachment_id is required');
  if (!uploaded) return fail(400, 'A file is required (field name: file)');

  const ext = path.extname(uploaded.originalname).toLowerCase();
  if (!hasValidSignature(uploaded.path, ext)) {
    return fail(400, 'The file content does not match its extension. Upload a real PDF, DOC or DOCX file.');
  }

  try {
    const owns = await pool.query(
      'SELECT status FROM attachments WHERE id = $1 AND student_id = $2',
      [attachmentId, req.user.id]
    );
    if (owns.rows.length === 0) return fail(403, 'This attachment record does not belong to you');
    if (!['active', 'completed'].includes(owns.rows[0].status)) {
      return fail(409, 'You can submit a final report once your placement has been approved');
    }

    const graded = await pool.query('SELECT 1 FROM final_grades WHERE attachment_id = $1', [attachmentId]);
    if (graded.rows.length > 0) {
      return fail(409, 'Your final report has already been graded and can no longer be replaced');
    }

    const previous = await pool.query('SELECT file_path FROM final_reports WHERE attachment_id = $1', [attachmentId]);

    const result = await pool.query(
      `INSERT INTO final_reports (attachment_id, file_path, original_filename)
       VALUES ($1, $2, $3)
       ON CONFLICT (attachment_id)
       DO UPDATE SET file_path = EXCLUDED.file_path,
                     original_filename = EXCLUDED.original_filename,
                     submitted_at = NOW()
       RETURNING id, attachment_id, original_filename, submitted_at`,
      [attachmentId, uploaded.filename, cleanStr(uploaded.originalname, 255) || 'final-report' + ext]
    );

    // Replace = delete the old file so uploads don't pile up.
    if (previous.rows[0] && previous.rows[0].file_path !== uploaded.filename) {
      removeFile(path.join(UPLOAD_DIR, path.basename(previous.rows[0].file_path)));
    }

    res.status(201).json({ final_report: result.rows[0] });
  } catch (err) {
    removeFile(uploaded.path);
    console.error(err);
    res.status(500).json({ error: 'Server error submitting final report' });
  }
});

// GET /final-report/me - the student's final report + grade (for their approved/completed placement)
router.get('/me', authenticateToken, requireRole('student'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT fr.attachment_id, fr.original_filename, fr.submitted_at,
              fg.marks, fg.comments, fg.graded_at
       FROM attachments a
       LEFT JOIN final_reports fr ON fr.attachment_id = a.id
       LEFT JOIN final_grades fg ON fg.attachment_id = a.id
       WHERE a.student_id = $1 AND a.status IN ('active', 'completed')
       ORDER BY a.created_at DESC LIMIT 1`,
      [req.user.id]
    );
    res.json({ final_report: result.rows[0] || null });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching final report' });
  }
});

// GET /final-report/pending - coordinator: every approved placement with its submission/grade state
router.get('/pending', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id AS attachment_id, u.name AS student_name, u.email AS student_email,
              o.name AS organization, a.semester, a.status,
              fr.original_filename, fr.submitted_at,
              fg.marks, fg.comments, fg.graded_at
       FROM attachments a
       JOIN users u ON a.student_id = u.id
       JOIN organizations o ON a.organization_id = o.id
       LEFT JOIN final_reports fr ON fr.attachment_id = a.id
       LEFT JOIN final_grades fg ON fg.attachment_id = a.id
       WHERE a.status IN ('active', 'completed')
       ORDER BY (fg.id IS NULL) DESC, fr.submitted_at DESC NULLS LAST, u.name`
    );
    res.json({ submissions: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching final reports' });
  }
});

// PATCH /final-report/:attachmentId/grade - coordinator grades a submitted report
router.patch('/:attachmentId/grade', authenticateToken, requireRole('admin'), async (req, res) => {
  const attachmentId = toId(req.params.attachmentId);
  if (!attachmentId) return res.status(400).json({ error: 'Invalid attachment id' });

  const marks = typeof req.body.marks === 'number' ? req.body.marks : parseFloat(req.body.marks);
  const comments = cleanStr(req.body.comments, 1000);

  if (!Number.isFinite(marks) || marks < 0 || marks > 100) {
    return res.status(400).json({ error: 'marks must be a number between 0 and 100' });
  }

  try {
    const submitted = await pool.query('SELECT 1 FROM final_reports WHERE attachment_id = $1', [attachmentId]);
    if (submitted.rows.length === 0) {
      return res.status(409).json({ error: 'This student has not submitted a final report yet' });
    }

    const result = await pool.query(
      `INSERT INTO final_grades (attachment_id, marks, comments, graded_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (attachment_id)
       DO UPDATE SET marks = EXCLUDED.marks, comments = EXCLUDED.comments,
                     graded_by = EXCLUDED.graded_by, graded_at = NOW()
       RETURNING *`,
      [attachmentId, marks, comments, req.user.id]
    );
    res.json({ grade: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error saving grade' });
  }
});

// GET /final-report/attachment/:attachmentId/download - the student, or the coordinator
router.get('/attachment/:attachmentId/download', authenticateToken, requireRole('student', 'admin'), async (req, res) => {
  const attachmentId = toId(req.params.attachmentId);
  if (!attachmentId) return res.status(400).json({ error: 'Invalid attachment id' });

  try {
    const result = await pool.query(
      `SELECT fr.file_path, fr.original_filename, a.student_id
       FROM final_reports fr JOIN attachments a ON fr.attachment_id = a.id
       WHERE fr.attachment_id = $1`,
      [attachmentId]
    );
    const record = result.rows[0];
    if (!record) return res.status(404).json({ error: 'No final report submitted yet' });
    if (req.user.role === 'student' && record.student_id !== req.user.id) {
      return res.status(403).json({ error: 'This final report does not belong to you' });
    }

    const filePath = path.join(UPLOAD_DIR, path.basename(record.file_path));
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'The file is missing from the server. Ask the student to upload it again.' });
    }
    res.download(filePath, record.original_filename);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error downloading final report' });
  }
});

module.exports = router;
