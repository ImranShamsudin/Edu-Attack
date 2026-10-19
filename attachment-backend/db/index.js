const { Pool, types } = require('pg');
require('dotenv').config();

// --- Type parsing -----------------------------------------------------------
// DATE (oid 1082): return the plain 'YYYY-MM-DD' string instead of a JS Date.
// A JS Date is created at *local* midnight, which silently shifts the day by
// one when it is later serialised to UTC (toISOString / JSON) on any server or
// browser that is not in UTC.
types.setTypeParser(1082, (value) => value);
// NUMERIC (oid 1700): marks come back as numbers (85) instead of strings ("85.00").
types.setTypeParser(1700, (value) => (value === null ? null : parseFloat(value)));

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error', err);
});

module.exports = pool;
