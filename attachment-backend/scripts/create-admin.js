// Creates the first Attachment Coordinator (admin) account.
//   npm run admin:create -- "Full Name" email@school.ac.ke "TempPassword1"
// The coordinator must change the temporary password at first login.
const bcrypt = require('bcrypt');
const pool = require('../db');
const { normalizeEmail, isEmail, passwordProblem } = require('../utils/validate');

const [name, emailArg, password] = process.argv.slice(2);

(async () => {
  try {
    const email = normalizeEmail(emailArg);
    if (!name || !isEmail(email) || !password) {
      console.error('Usage: npm run admin:create -- "Full Name" email@school.ac.ke "TempPassword1"');
      process.exitCode = 1;
      return;
    }
    const problem = passwordProblem(password);
    if (problem) {
      console.error(problem);
      process.exitCode = 1;
      return;
    }

    const existing = await pool.query('SELECT id, role FROM users WHERE LOWER(email) = $1', [email]);
    if (existing.rows.length > 0) {
      console.error(`An account with ${email} already exists (role: ${existing.rows[0].role}).`);
      console.error('To regain access to it, run: npm run admin:reset-password -- ' + email + ' "NewTempPassword1"');
      process.exitCode = 1;
      return;
    }

    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, must_change_password, approval_status)
       VALUES ($1, $2, $3, 'admin', TRUE, 'approved') RETURNING id, name, email`,
      [name.trim(), email, hash]
    );
    console.log(`✔ Coordinator created: ${result.rows[0].name} <${result.rows[0].email}>`);
    console.log('  Sign in with the "Coordinator" tab; you will be asked to choose a new password.');
  } catch (err) {
    console.error('Failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
