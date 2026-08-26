const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');

const router = express.Router();

// GET /supervisor/students - list attachments assigned to the logged-in supervisor
router.get('/students', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor'), async (req, res) => {
    const supervisorId = req.user.id;
    const column = req.user.role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id';

    console.log('Supervisor /students called');
    console.log('Supervisor ID:', supervisorId);
    console.log('Using column:', column);

    try {
        const result = await pool.query(
            `SELECT a.id AS attachment_id, u.name AS student_name, u.email AS student_email,
                    o.name AS organization, a.start_date, a.end_date, a.semester, a.status
             FROM attachments a
             JOIN users u ON a.student_id = u.id
             JOIN organizations o ON a.organization_id = o.id
             WHERE a.${column} = $1
             ORDER BY u.name`,
            [supervisorId]
        );
        console.log(`Found ${result.rows.length} assigned students`);
        res.json({ assigned_students: result.rows });
    } catch (err) {
        console.error('Error in /students:', err);
        res.status(500).json({ error: 'Server error fetching assigned students' });
    }
});

// ===== GET /supervisor/all-students - list ALL students on attachment =====
router.get('/all-students', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor'), async (req, res) => {
    console.log('=== /supervisor/all-students CALLED ===');
    console.log('User:', req.user);
    
    try {
        const result = await pool.query(
            `SELECT 
                a.id AS attachment_id, 
                u.id AS student_id,
                u.name AS student_name, 
                u.email AS student_email,
                u.department,
                o.name AS organization, 
                o.address AS organization_address,
                a.start_date, 
                a.end_date, 
                a.semester, 
                a.status,
                a.industrial_supervisor_id,
                a.university_supervisor_id,
                a.created_at
             FROM attachments a
             JOIN users u ON a.student_id = u.id
             JOIN organizations o ON a.organization_id = o.id
             WHERE a.status IN ('active', 'pending', 'completed')
             ORDER BY u.name`
        );
        
        console.log(`Found ${result.rows.length} students on attachment`);
        res.json({ students: result.rows });
    } catch (err) {
        console.error('Error in /all-students:', err);
        res.status(500).json({ error: 'Server error fetching students' });
    }
});
// ===== END NEW ROUTE =====

// GET /supervisor/logbook/:attachmentId
router.get('/logbook/:attachmentId', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor'), async (req, res) => {
    const supervisorId = req.user.id;
    const column = req.user.role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id';
    const { attachmentId } = req.params;

    try {
        const ownsCheck = await pool.query(
            `SELECT id FROM attachments WHERE id = $1 AND ${column} = $2`,
            [attachmentId, supervisorId]
        );
        if (ownsCheck.rows.length === 0) {
            return res.status(403).json({ error: 'This student is not assigned to you' });
        }

        const entries = await pool.query(
            `SELECT le.*,
                    COALESCE(
                        json_agg(
                            json_build_object('id', sf.id, 'comment', sf.comment, 'supervisor_id', sf.supervisor_id, 'created_at', sf.created_at)
                        ) FILTER (WHERE sf.id IS NOT NULL), '[]'
                    ) AS feedback
             FROM logbook_entries le
             LEFT JOIN supervisor_feedback sf ON sf.logbook_entry_id = le.id
             WHERE le.attachment_id = $1
             GROUP BY le.id
             ORDER BY le.entry_date DESC`,
            [attachmentId]
        );
        res.json({ entries: entries.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error fetching logbook' });
    }
});

// POST /supervisor/feedback
router.post('/feedback', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor'), async (req, res) => {
    const supervisorId = req.user.id;
    const column = req.user.role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id';
    const { logbook_entry_id, comment } = req.body;

    if (!logbook_entry_id || !comment) {
        return res.status(400).json({ error: 'logbook_entry_id and comment are required' });
    }

    try {
        const ownsCheck = await pool.query(
            `SELECT le.id FROM logbook_entries le
             JOIN attachments a ON le.attachment_id = a.id
             WHERE le.id = $1 AND a.${column} = $2`,
            [logbook_entry_id, supervisorId]
        );
        if (ownsCheck.rows.length === 0) {
            return res.status(403).json({ error: 'This logbook entry is not assigned to you' });
        }

        const result = await pool.query(
            `INSERT INTO supervisor_feedback (logbook_entry_id, supervisor_id, comment)
             VALUES ($1, $2, $3)
             RETURNING *`,
            [logbook_entry_id, supervisorId, comment]
        );
        res.status(201).json({ feedback: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error posting feedback' });
    }
});

// POST /supervisor/visit
router.post('/visit', authenticateToken, requireRole('university_supervisor'), async (req, res) => {
    const supervisorId = req.user.id;
    const { attachment_id, visit_number, comments, visit_date } = req.body;

    if (!attachment_id || !visit_number || !comments || !visit_date) {
        return res.status(400).json({ error: 'attachment_id, visit_number, comments, and visit_date are required' });
    }
    if (![1, 2].includes(Number(visit_number))) {
        return res.status(400).json({ error: 'visit_number must be 1 (First Visit) or 2 (Second Visit)' });
    }

    try {
        const ownsCheck = await pool.query(
            'SELECT id FROM attachments WHERE id = $1 AND university_supervisor_id = $2',
            [attachment_id, supervisorId]
        );
        if (ownsCheck.rows.length === 0) {
            return res.status(403).json({ error: 'This student is not assigned to you' });
        }

        const result = await pool.query(
            `INSERT INTO supervisor_visits (attachment_id, university_supervisor_id, visit_number, comments, visit_date)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (attachment_id, visit_number)
             DO UPDATE SET comments = EXCLUDED.comments, visit_date = EXCLUDED.visit_date
             RETURNING *`,
            [attachment_id, supervisorId, visit_number, comments, visit_date]
        );
        res.status(201).json({ visit: result.rows[0] });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error recording visit' });
    }
});

// GET /supervisor/visits/:attachmentId
router.get('/visits/:attachmentId', authenticateToken, requireRole('university_supervisor', 'industrial_supervisor', 'admin'), async (req, res) => {
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
            'SELECT * FROM supervisor_visits WHERE attachment_id = $1 ORDER BY visit_number',
            [attachmentId]
        );
        res.json({ visits: result.rows });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Server error fetching visits' });
    }
});
// PATCH /supervisor/attachments/:attachmentId/claim - supervisor assigns themselves to an unassigned student
router.patch('/attachments/:attachmentId/claim', authenticateToken, requireRole('industrial_supervisor', 'university_supervisor'), async (req, res) => {
    const supervisorId = req.user.id;
    const { attachmentId } = req.params;
    const column = req.user.role === 'industrial_supervisor' ? 'industrial_supervisor_id' : 'university_supervisor_id';

    try {
        const check = await pool.query(
            `SELECT id, ${column} FROM attachments WHERE id = $1`,
            [attachmentId]
        );
        if (check.rows.length === 0) {
            return res.status(404).json({ error: 'Attachment not found' });
        }
        if (check.rows[0][column]) {
            return res.status(409).json({ error: 'This student already has a supervisor assigned for your role' });
        }

        const result = await pool.query(
            `UPDATE attachments SET ${column} = $1 WHERE id = $2 RETURNING *`,
            [supervisorId, attachmentId]
        );
        res.json({ attachment: result.rows[0] });
    } catch (err) {
        console.error('Error claiming student:', err);
        res.status(500).json({ error: 'Server error assigning yourself to this student' });
    }
});
module.exports = router;