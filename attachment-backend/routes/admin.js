const express = require('express');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');

const router = express.Router();

// GET /admin/students - list all students with their attachment status
router.get('/students', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.department, u.is_active,
              a.id AS attachment_id, o.name AS organization, a.start_date, a.end_date, a.semester, a.status,
              ind.name AS industrial_supervisor_name
       FROM users u
       LEFT JOIN attachments a ON a.student_id = u.id
       LEFT JOIN organizations o ON a.organization_id = o.id
       LEFT JOIN users ind ON a.industrial_supervisor_id = ind.id
       WHERE u.role = 'student'
       ORDER BY u.name`
    );
    res.json({ students: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching students' });
  }
});
// GET /admin/users?role=industrial_supervisor - list users by role (for populating assignment dropdowns)
router.get('/users', authenticateToken, requireRole('admin'), async (req, res) => {
  const { role } = req.query;
  const allowedRoles = ['student', 'admin', 'university_supervisor'];

  if (role && !allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role filter' });
  }

  try {
    const result = role
      ? await pool.query('SELECT id, name, email, role, department, is_active FROM users WHERE role = $1 ORDER BY name', [role])
      : await pool.query('SELECT id, name, email, role, department, is_active FROM users ORDER BY name');
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching users' });
  }
});

// PATCH /admin/users/:id - edit a user's name, department, or role
router.patch('/users/:id', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { name, department, role } = req.body;
  const allowedRoles = ['student', 'admin', 'industrial_supervisor', 'university_supervisor'];

  if (role && !allowedRoles.includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           department = COALESCE($2, department),
           role = COALESCE($3, role)
       WHERE id = $4
       RETURNING id, name, email, role, department, is_active`,
      [name || null, department || null, role || null, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating user' });
  }
});

// PATCH /admin/users/:id/deactivate - deactivate or reactivate a user account
router.patch('/users/:id/deactivate', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active (boolean) is required' });
  }

  try {
    const result = await pool.query(
      'UPDATE users SET is_active = $1 WHERE id = $2 RETURNING id, name, email, is_active',
      [is_active, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating account status' });
  }
});

// GET /admin/departments - list distinct departments currently in use (from student profiles)
router.get('/departments', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department != '' ORDER BY department`
    );
    res.json({ departments: result.rows.map(r => r.department) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching departments' });
  }
});

// GET /admin/logbook/:studentId - view a specific student's logbook entries
router.get('/logbook/:studentId', authenticateToken, requireRole('admin'), async (req, res) => {
  const { studentId } = req.params;

  try {
    const result = await pool.query(
      `SELECT le.* FROM logbook_entries le
       JOIN attachments a ON le.attachment_id = a.id
       WHERE a.student_id = $1
       ORDER BY le.entry_date DESC`,
      [studentId]
    );
    res.json({ entries: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching student logbook' });
  }
});

// GET /admin/placements/pending - list attachments awaiting coordinator approval
router.get('/placements/pending', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id AS attachment_id, u.name AS student_name, u.email AS student_email,
              o.name AS organization, a.start_date, a.end_date, a.semester, a.status, a.created_at
       FROM attachments a
       JOIN users u ON a.student_id = u.id
       JOIN organizations o ON a.organization_id = o.id
       WHERE a.status = 'pending'
       ORDER BY a.created_at`
    );
    res.json({ placements: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching pending placements' });
  }
});

// PATCH /admin/attachments/:id/approve - coordinator approves a pending placement submission
router.patch('/attachments/:id/approve', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const adminId = req.user.id;

  try {
    const result = await pool.query(
      `UPDATE attachments
       SET status = 'active', approved_by = $1, approved_at = NOW(), rejection_reason = NULL
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [adminId, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pending placement not found (already actioned, or does not exist)' });
    }
    res.json({ attachment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error approving placement' });
  }
});

// PATCH /admin/attachments/:id/reject - coordinator rejects a pending placement submission with a reason
router.patch('/attachments/:id/reject', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { reason } = req.body;
  const adminId = req.user.id;

  if (!reason) {
    return res.status(400).json({ error: 'reason is required' });
  }

  try {
    const result = await pool.query(
      `UPDATE attachments
       SET status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [reason, adminId, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Pending placement not found (already actioned, or does not exist)' });
    }
    res.json({ attachment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error rejecting placement' });
  }
});

// PATCH /admin/attachments/:id/assign - assign a university supervisor to an attachment
// (Industrial supervisors self-assign via /supervisor/attachments/:id/claim)
router.patch('/attachments/:id/assign', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { university_supervisor_id } = req.body;

  if (!university_supervisor_id) {
    return res.status(400).json({ error: 'university_supervisor_id is required' });
  }

  try {
    const check = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND role = 'university_supervisor'",
      [university_supervisor_id]
    );
    if (check.rows.length === 0) {
      return res.status(400).json({ error: 'university_supervisor_id does not match a user with that role' });
    }

    const result = await pool.query(
      `UPDATE attachments SET university_supervisor_id = $1 WHERE id = $2 RETURNING *`,
      [university_supervisor_id, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found' });
    }

    res.json({ attachment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error assigning supervisor' });
  }
});

// GET /admin/stats - overview counts for the coordinator dashboard (completion rates etc.)
router.get('/stats', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM users WHERE role = 'student') AS total_students,
        (SELECT COUNT(*) FROM organizations) AS total_organizations,
        (SELECT COUNT(*) FROM attachments WHERE status = 'pending') AS pending_approval,
        (SELECT COUNT(*) FROM attachments WHERE status = 'active') AS active_placements,
        (SELECT COUNT(*) FROM attachments WHERE status = 'completed') AS completed_placements,
        (SELECT COUNT(*) FROM attachments WHERE status = 'rejected') AS rejected_placements,
        (SELECT COUNT(*) FROM attachments WHERE industrial_supervisor_id IS NULL OR university_supervisor_id IS NULL) AS unassigned_supervisors
    `);
    res.json({ stats: totals.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching stats' });
  }
});

// GET /admin/reports/export - CSV export of all placements for the coordinator's records
router.get('/reports/export', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT u.name AS student_name, u.email AS student_email, u.department,
             o.name AS organization, a.start_date, a.end_date, a.semester, a.status,
             ind.name AS industrial_supervisor, uni.name AS university_supervisor,
             fg.marks AS final_marks
      FROM attachments a
      JOIN users u ON a.student_id = u.id
      JOIN organizations o ON a.organization_id = o.id
      LEFT JOIN users ind ON a.industrial_supervisor_id = ind.id
      LEFT JOIN users uni ON a.university_supervisor_id = uni.id
      LEFT JOIN final_grades fg ON fg.attachment_id = a.id
      ORDER BY u.name
    `);

    const headers = ['Student', 'Email', 'Department', 'Organization', 'Semester / Period', 'Start Date', 'End Date', 'Status', 'Industrial Supervisor', 'University Supervisor', 'Final Marks'];
    const rows = result.rows.map(r => [
      r.student_name, r.student_email, r.department || '', r.organization, r.semester || '',
      r.start_date ? r.start_date.toISOString().split('T')[0] : '',
      r.end_date ? r.end_date.toISOString().split('T')[0] : '',
      r.status, r.industrial_supervisor || '', r.university_supervisor || '', r.final_marks ?? ''
    ]);

    const csvEscape = (val) => `"${String(val).replace(/"/g, '""')}"`;
    const csv = [headers.map(csvEscape).join(','), ...rows.map(row => row.map(csvEscape).join(','))].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attachment_report.csv"');
    res.send(csv);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error generating report' });
  }
});

// GET /admin/settings - view system settings
router.get('/settings', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value, updated_at FROM system_settings ORDER BY key');
    res.json({ settings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching settings' });
  }
});

// PATCH /admin/settings - update or create a system setting (key/value)
router.patch('/settings', authenticateToken, requireRole('admin'), async (req, res) => {
  const { key, value } = req.body;
  const adminId = req.user.id;

  if (!key || value === undefined) {
    return res.status(400).json({ error: 'key and value are required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO system_settings (key, value, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [key, value, adminId]
    );
    res.json({ setting: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating setting' });
  }
});

// GET /admin/placements/status-summary - three buckets: completed, undergoing (active), and not yet placed
router.get('/placements/status-summary', authenticateToken, requireRole('admin'), async (req, res) => {
  try {
    const semester = (req.query.semester || '').trim();
    const semesterFilter = semester ? ' AND LOWER(a.semester) LIKE LOWER($1)' : '';
    const params = semester ? [`%${semester}%`] : [];

    const completed = await pool.query(`
      SELECT u.id, u.name, u.email, u.department, o.name AS organization, a.semester, a.start_date, a.end_date
      FROM attachments a
      JOIN users u ON a.student_id = u.id
      JOIN organizations o ON a.organization_id = o.id
      WHERE a.status = 'completed' ${semesterFilter}
      ORDER BY u.name
    `, params);

    const undergoing = await pool.query(`
      SELECT u.id, u.name, u.email, u.department, o.name AS organization, a.semester, a.start_date, a.end_date
      FROM attachments a
      JOIN users u ON a.student_id = u.id
      JOIN organizations o ON a.organization_id = o.id
      WHERE a.status IN ('active', 'pending') ${semesterFilter}
      ORDER BY u.name
    `, params);

    const notYetPlaced = await pool.query(`
      SELECT u.id, u.name, u.email, u.department
      FROM users u
      WHERE u.role = 'student'
        AND NOT EXISTS (
          SELECT 1 FROM attachments a WHERE a.student_id = u.id AND a.status IN ('pending', 'active', 'completed')
        )
      ORDER BY u.name
    `);

    res.json({
      completed: completed.rows,
      undergoing: undergoing.rows,
      not_yet_placed: notYetPlaced.rows,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching placement status summary' });
  }
});

// PATCH /admin/attachments/:id/complete - mark an active attachment as completed
router.patch('/attachments/:id/complete', authenticateToken, requireRole('admin'), async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE attachments SET status = 'completed' WHERE id = $1 AND status = 'active' RETURNING *`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Active attachment not found' });
    }
    res.json({ attachment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error marking attachment complete' });
  }
});

module.exports = router;
