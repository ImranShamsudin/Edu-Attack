// Emergency password reset from the command line (e.g. a coordinator locked out).
//   npm run admin:reset-password -- email@school.ac.ke "NewTempPassword1"
// Also re-activates and approves the account, and forces a password change at next login.
const bcrypt = require('bcrypt');
const pool = require('../db');
const { normalizeEmail, passwordProblem } = require('../utils/validate');

const [emailArg, newPassword] = process.argv.slice(2);

(async () => {
  try {
    const email = normalizeEmail(emailArg);
    if (!email || !newPassword) {
      console.error('Usage: npm run admin:reset-password -- email@school.ac.ke "NewTempPassword1"');
      process.exitCode = 1;
      return;
    }
    const problem = passwordProblem(newPassword);
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
      return;
    }

    const hash = await bcrypt.hash(newPassword, 10);
    const result = await pool.query(
      `UPDATE users
         SET password_hash = $1, must_change_password = TRUE, is_active = TRUE, approval_status = 'approved'
       WHERE LOWER(email) = $2
       RETURNING id, name, email, role`,
      [hash, email]
    );

    if (result.rows.length === 0) {
      console.log(`\nNo user found matching "${emailArg}". Accounts in this database:`);
      const all = await pool.query('SELECT id, role, email, name FROM users ORDER BY id');
      all.rows.forEach((r) => console.log(`  [${r.id}] ${r.role.padEnd(22)} ${r.email}  (${r.name})`));
      process.exitCode = 1;
      return;
    }
    const u = result.rows[0];
    console.log(`✔ Password reset for ${u.name} <${u.email}> (${u.role}). They must change it at next login.`);
  } catch (err) {
    console.error('Reset failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
