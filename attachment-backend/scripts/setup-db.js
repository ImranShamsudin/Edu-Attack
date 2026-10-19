// Creates / upgrades every table. Safe to run repeatedly.
//   npm run db:setup
const fs = require('fs');
const path = require('path');
const pool = require('../db');

(async () => {
  try {
    for (const file of ['schema.sql', 'migrate.sql']) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'db', file), 'utf8');
      await pool.query(sql);
      console.log(`✔ ${file} applied`);
    }
    console.log('\nDatabase is ready. Next: npm run admin:create -- "Your Name" you@school.ac.ke "TempPass123"');
  } catch (err) {
    console.error('\nDatabase setup failed:', err.message);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
})();
