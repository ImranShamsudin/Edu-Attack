const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const authenticateToken = require('../middleware/auth');
const requireRole = require('../middleware/role');
const { cleanStr, toId, toCsv, passwordProblem } = require('../utils/validate');

const router = express.Router();
router.use(authenticateToken, requireRole('admin'));

const ALL_ROLES = ['student', 'admin', 'industrial_supervisor', 'university_supervisor'];

// Picks the "current" placement of a student: active first, then pending, completed, rejected.
const CURRENT_ATTACHMENT_ORDER = `
  CASE x.status WHEN 'active' THEN 1 WHEN 'pending' THEN 2 WHEN 'completed' THEN 3 ELSE 4 END, x.created_at DESC`;

function badId(res, what = 'id') {
  return res.status(400).json({ error: `Invalid ${what}` });
}

// ---------------------------------------------------------------------------
// Students & users
// ---------------------------------------------------------------------------

// GET /admin/students - one row per student, showing their current placement (if any)
router.get('/students', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.name, u.email, u.department, u.is_active,
              a.id AS attachment_id, o.name AS organization, a.start_date, a.end_date, a.semester, a.status,
              a.industrial_supervisor_id, a.university_supervisor_id,
              ind.name AS industrial_supervisor_name, uni.name AS university_supervisor_name
       FROM users u
       LEFT JOIN LATERAL (
         SELECT * FROM attachments x WHERE x.student_id = u.id
         ORDER BY ${CURRENT_ATTACHMENT_ORDER} LIMIT 1
       ) a ON TRUE
       LEFT JOIN organizations o ON a.organization_id = o.id
       LEFT JOIN users ind ON a.industrial_supervisor_id = ind.id
       LEFT JOIN users uni ON a.university_supervisor_id = uni.id
       WHERE u.role = 'student'
       ORDER BY u.name`
    );
    res.json({ students: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching students' });
  }
});

// GET /admin/users?role=&status= - list accounts (role: any of the 4 roles; status: approved|pending)
router.get('/users', async (req, res) => {
  const { role, status } = req.query;
  if (role && !ALL_ROLES.includes(role)) return res.status(400).json({ error: 'Invalid role filter' });
  if (status && !['approved', 'pending'].includes(status)) return res.status(400).json({ error: 'Invalid status filter' });

  try {
    const result = await pool.query(
      `SELECT id, name, email, phone, role, department, is_active, approval_status, last_login, created_at
       FROM users
       WHERE ($1::text IS NULL OR role = $1) AND ($2::text IS NULL OR approval_status = $2)
       ORDER BY name`,
      [role || null, status || null]
    );
    res.json({ users: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching users' });
  }
});

// PATCH /admin/users/:id - edit name, phone, department or role. Fields not sent are untouched.
router.patch('/users/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'user id');
  const body = req.body || {};

  if (body.role !== undefined) {
    if (!ALL_ROLES.includes(body.role)) return res.status(400).json({ error: 'Invalid role' });
    if (id === req.user.id && body.role !== req.user.role) {
      return res.status(400).json({ error: 'You cannot change your own role' });
    }
  }

  const sets = [];
  const params = [];
  const add = (col, val) => { params.push(val); sets.push(`${col} = $${params.length}`); };

  if (body.name !== undefined) {
    const name = cleanStr(body.name, 100);
    if (!name) return res.status(400).json({ error: 'Name cannot be empty' });
    add('name', name);
  }
  if (body.department !== undefined) add('department', cleanStr(body.department, 150));
  if (body.phone !== undefined) add('phone', cleanStr(body.phone, 30));
  if (body.role !== undefined) add('role', body.role);
  if (sets.length === 0) return res.status(400).json({ error: 'Nothing to update' });

  try {
    params.push(id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
       RETURNING id, name, email, phone, role, department, is_active, approval_status`,
      params
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating user' });
  }
});

// PATCH /admin/users/:id/deactivate - deactivate or reactivate an account
router.patch('/users/:id/deactivate', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'user id');
  const { is_active } = req.body;

  if (typeof is_active !== 'boolean') {
    return res.status(400).json({ error: 'is_active (boolean) is required' });
  }
  if (id === req.user.id && is_active === false) {
    return res.status(400).json({ error: 'You cannot deactivate your own account' });
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

// PATCH /admin/users/:id/approve - approve a self-registered supervisor
router.patch('/users/:id/approve', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'user id');
  try {
    const result = await pool.query(
      `UPDATE users SET approval_status = 'approved' WHERE id = $1 AND approval_status = 'pending'
       RETURNING id, name, email, role, approval_status`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'No pending account with that id' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error approving account' });
  }
});

// DELETE /admin/users/:id - decline (delete) a pending self-registration
router.delete('/users/:id', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'user id');
  try {
    const result = await pool.query(
      `DELETE FROM users WHERE id = $1 AND approval_status = 'pending' RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Only pending registrations can be declined. Deactivate active accounts instead.' });
    }
    res.json({ message: 'Registration declined' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error declining registration' });
  }
});

// POST /admin/users/:id/reset-password - set a new temporary password (user must change it at next login).
// This is the "forgot password" flow: the coordinator resets it and shares the temporary password.
router.post('/users/:id/reset-password', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'user id');
  if (id === req.user.id) {
    return res.status(400).json({ error: 'Use Settings to change your own password' });
  }
  const { temp_password } = req.body;
  const pwProblem = passwordProblem(temp_password);
  if (pwProblem) return res.status(400).json({ error: `Temporary ${pwProblem.charAt(0).toLowerCase()}${pwProblem.slice(1)}` });

  try {
    const hash = await bcrypt.hash(temp_password, 10);
    const result = await pool.query(
      'UPDATE users SET password_hash = $1, must_change_password = TRUE WHERE id = $2 RETURNING id, name, email',
      [hash, id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error resetting password' });
  }
});

// GET /admin/departments - distinct departments currently in use
router.get('/departments', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DISTINCT department FROM users WHERE department IS NOT NULL AND department != '' ORDER BY department`
    );
    res.json({ departments: result.rows.map((r) => r.department) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching departments' });
  }
});

// ---------------------------------------------------------------------------
// Placements
// ---------------------------------------------------------------------------

// GET /admin/attachments/:id/logbook - a student's logbook (with supervisor feedback), for review/grading
router.get('/attachments/:id/logbook', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'attachment id');
  try {
    const result = await pool.query(
      `SELECT le.*,
              COALESCE(json_agg(json_build_object('id', sf.id, 'comment', sf.comment, 'supervisor_id', sf.supervisor_id, 'created_at', sf.created_at)
                       ORDER BY sf.created_at) FILTER (WHERE sf.id IS NOT NULL), '[]') AS feedback
       FROM logbook_entries le
       LEFT JOIN supervisor_feedback sf ON sf.logbook_entry_id = le.id
       WHERE le.attachment_id = $1
       GROUP BY le.id
       ORDER BY le.entry_date DESC, le.id DESC`,
      [id]
    );
    res.json({ entries: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching student logbook' });
  }
});

// GET /admin/placements/pending - placements awaiting coordinator approval
router.get('/placements/pending', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT a.id AS attachment_id, u.name AS student_name, u.email AS student_email,
              o.name AS organization, a.start_date, a.end_date, a.semester, a.status, a.created_at,
              a.duties_description
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

// PATCH /admin/attachments/:id/approve
router.patch('/attachments/:id/approve', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'attachment id');
  try {
    const result = await pool.query(
      `UPDATE attachments
       SET status = 'active', approved_by = $1, approved_at = NOW(), rejection_reason = NULL
       WHERE id = $2 AND status = 'pending'
       RETURNING *`,
      [req.user.id, id]
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

// PATCH /admin/attachments/:id/reject
router.patch('/attachments/:id/reject', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'attachment id');
  const reason = cleanStr(req.body.reason, 500);
  if (!reason) return res.status(400).json({ error: 'reason is required' });

  try {
    const result = await pool.query(
      `UPDATE attachments
       SET status = 'rejected', rejection_reason = $1, approved_by = $2, approved_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [reason, req.user.id, id]
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

// PATCH /admin/attachments/:id/assign - assign (or clear) the university and/or industrial supervisor.
// Send null to clear a supervisor. Fields that are not sent are left alone.
router.patch('/attachments/:id/assign', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'attachment id');

  const body = req.body || {};
  const fields = [
    ['university_supervisor_id', 'university_supervisor'],
    ['industrial_supervisor_id', 'industrial_supervisor'],
  ].filter(([key]) => body[key] !== undefined);

  if (fields.length === 0) {
    return res.status(400).json({ error: 'Provide university_supervisor_id and/or industrial_supervisor_id' });
  }

  try {
    const sets = [];
    const params = [];
    for (const [key, role] of fields) {
      let value = null;
      if (body[key] !== null) {
        value = toId(body[key]);
        if (!value) return res.status(400).json({ error: `${key} must be a valid user id or null` });
        const check = await pool.query(
          `SELECT id FROM users WHERE id = $1 AND role = $2 AND is_active = TRUE AND approval_status = 'approved'`,
          [value, role]
        );
        if (check.rows.length === 0) {
          return res.status(400).json({ error: `${key} does not match an active ${role.replace('_', ' ')}` });
        }
      }
      params.push(value);
      sets.push(`${key} = $${params.length}`);
    }

    params.push(id);
    const result = await pool.query(
      `UPDATE attachments SET ${sets.join(', ')}
       WHERE id = $${params.length} AND status IN ('pending', 'active') RETURNING *`,
      params
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Attachment not found, or it is already completed/rejected' });
    }
    res.json({ attachment: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error assigning supervisor' });
  }
});

// PATCH /admin/attachments/:id/complete - mark an active attachment as completed
router.patch('/attachments/:id/complete', async (req, res) => {
  const id = toId(req.params.id);
  if (!id) return badId(res, 'attachment id');
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

// GET /admin/placements/status-summary - completed / undergoing (active) / not yet placed
router.get('/placements/status-summary', async (req, res) => {
  try {
    const semester = (req.query.semester || '').toString().trim().slice(0, 100);
    const filter = semester ? " AND a.semester ILIKE $1 ESCAPE '\\'" : '';
    const params = semester ? [`%${semester.replace(/[\\%_]/g, '\\$&')}%`] : [];

    const base = `
      SELECT u.id, u.name, u.email, u.department, o.name AS organization, a.id AS attachment_id,
             a.semester, a.start_date, a.end_date
      FROM attachments a
      JOIN users u ON a.student_id = u.id
      JOIN organizations o ON a.organization_id = o.id
      WHERE a.status = $STATUS ${filter}
      ORDER BY u.name`;

    const completed = await pool.query(base.replace('$STATUS', "'completed'"), params);
    const undergoing = await pool.query(base.replace('$STATUS', "'active'"), params);

    // "Not yet placed" = students with no active/completed placement. A placement that is
    // still awaiting approval is shown so the coordinator knows what is outstanding.
    const notYetPlaced = await pool.query(
      `SELECT u.id, u.name, u.email, u.department,
              p.organization AS pending_organization
       FROM users u
       LEFT JOIN LATERAL (
         SELECT o.name AS organization FROM attachments a
         JOIN organizations o ON o.id = a.organization_id
         WHERE a.student_id = u.id AND a.status = 'pending'
         ORDER BY a.created_at DESC LIMIT 1
       ) p ON TRUE
       WHERE u.role = 'student' AND u.is_active = TRUE
         AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.student_id = u.id AND a.status IN ('active', 'completed'))
       ORDER BY u.name`
    );

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

// ---------------------------------------------------------------------------
// Dashboard stats & reports
// ---------------------------------------------------------------------------

// GET /admin/stats
router.get('/stats', async (req, res) => {
  try {
    const totals = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE role = 'student') AS total_students,
        (SELECT COUNT(*)::int FROM organizations) AS total_organizations,
        (SELECT COUNT(*)::int FROM attachments WHERE status = 'pending') AS pending_approval,
        (SELECT COUNT(*)::int FROM attachments WHERE status = 'active') AS active_placements,
        (SELECT COUNT(*)::int FROM attachments WHERE status = 'completed') AS completed_placements,
        (SELECT COUNT(*)::int FROM attachments WHERE status = 'rejected') AS rejected_placements,
        (SELECT COUNT(*)::int FROM attachments WHERE status IN ('pending', 'active')
           AND (industrial_supervisor_id IS NULL OR university_supervisor_id IS NULL)) AS unassigned_supervisors,
        (SELECT COUNT(*)::int FROM users u WHERE u.role = 'student' AND u.is_active = TRUE
           AND NOT EXISTS (SELECT 1 FROM attachments a WHERE a.student_id = u.id AND a.status IN ('pending', 'active', 'completed'))) AS students_without_placement,
        (SELECT COUNT(*)::int FROM users WHERE approval_status = 'pending') AS pending_accounts,
        (SELECT COUNT(*)::int FROM final_reports fr LEFT JOIN final_grades fg ON fg.attachment_id = fr.attachment_id
           WHERE fg.id IS NULL) AS awaiting_grading
    `);
    res.json({ stats: totals.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching stats' });
  }
});

function dateStamp() {
  return new Date().toISOString().slice(0, 10);
}

// GET /admin/reports/export - CSV of all placements
router.get('/reports/export', async (req, res) => {
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
      ORDER BY u.name, a.created_at
    `);

    const headers = ['Student', 'Email', 'Department', 'Organization', 'Semester / Period', 'Start Date', 'End Date', 'Status', 'Industrial Supervisor', 'University Supervisor', 'Final Marks'];
    const rows = result.rows.map((r) => [
      r.student_name, r.student_email, r.department, r.organization, r.semester,
      r.start_date, r.end_date, r.status, r.industrial_supervisor, r.university_supervisor, r.final_marks,
    ]);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="attachment_report_${dateStamp()}.csv"`);
    res.send(toCsv(headers, rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error generating report' });
  }
});

// Shared by the activity report and its CSV export.
// started       = has at least one logbook entry or weekly report
// never_logged_in = no recorded login and no activity
// not_started   = everyone else
async function buildActivityReport() {
  const result = await pool.query(`
    SELECT u.id, u.name, u.email, u.created_at, u.last_login,
           cur.organization, cur.semester, cur.status,
           COALESCE(le.cnt, 0) AS logbook_entries, COALESCE(wr.cnt, 0) AS weekly_reports
    FROM users u
    LEFT JOIN LATERAL (
      SELECT a.id, a.semester, a.status, o.name AS organization
      FROM attachments a JOIN organizations o ON o.id = a.organization_id
      WHERE a.student_id = u.id AND a.status IN ('active', 'completed', 'pending')
      ORDER BY CASE a.status WHEN 'active' THEN 1 WHEN 'completed' THEN 2 ELSE 3 END, a.created_at DESC
      LIMIT 1
    ) cur ON TRUE
    LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM logbook_entries l WHERE l.attachment_id = cur.id) le ON TRUE
    LEFT JOIN LATERAL (SELECT COUNT(*)::int AS cnt FROM weekly_reports w WHERE w.attachment_id = cur.id) wr ON TRUE
    WHERE u.role = 'student' AND u.is_active = TRUE
    ORDER BY u.name
  `);

  const report = { started: [], not_started: [], never_logged_in: [] };
  for (const s of result.rows) {
    if (s.logbook_entries + s.weekly_reports > 0) report.started.push(s);
    else if (!s.last_login) report.never_logged_in.push(s);
    else report.not_started.push(s);
  }
  return report;
}

// GET /admin/reports/activity
router.get('/reports/activity', async (req, res) => {
  try {
    res.json(await buildActivityReport());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error building activity report' });
  }
});

// GET /admin/reports/activity/export
router.get('/reports/activity/export', async (req, res) => {
  try {
    const report = await buildActivityReport();
    const headers = ['Student', 'Email', 'Category', 'Organization', 'Semester / Period', 'Placement Status', 'Logbook Entries', 'Weekly Reports', 'Last Login', 'Registered'];
    const labels = { started: 'Started', not_started: 'Not started', never_logged_in: 'Never logged in' };
    const rows = [];
    for (const key of ['started', 'not_started', 'never_logged_in']) {
      for (const s of report[key]) {
        rows.push([
          s.name, s.email, labels[key], s.organization, s.semester, s.status,
          s.logbook_entries, s.weekly_reports,
          s.last_login ? new Date(s.last_login).toISOString() : '',
          s.created_at ? new Date(s.created_at).toISOString() : '',
        ]);
      }
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="student_activity_report_${dateStamp()}.csv"`);
    res.send(toCsv(headers, rows));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error generating activity report' });
  }
});

// ---------------------------------------------------------------------------
// System settings (free-form key/value; validated)
// ---------------------------------------------------------------------------

router.get('/settings', async (req, res) => {
  try {
    const result = await pool.query('SELECT key, value, updated_at FROM system_settings ORDER BY key');
    res.json({ settings: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error fetching settings' });
  }
});

router.patch('/settings', async (req, res) => {
  const { key, value } = req.body;
  if (typeof key !== 'string' || !/^[a-z0-9_.-]{1,100}$/.test(key)) {
    return res.status(400).json({ error: 'key must be 1-100 characters: lower-case letters, digits, _ . -' });
  }
  if (value === undefined || value === null || String(value).length > 1000) {
    return res.status(400).json({ error: 'value is required (max 1000 characters)' });
  }
  try {
    const result = await pool.query(
      `INSERT INTO system_settings (key, value, updated_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING *`,
      [key, String(value), req.user.id]
    );
    res.json({ setting: result.rows[0] });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Server error updating setting' });
  }
});

module.exports = router;
