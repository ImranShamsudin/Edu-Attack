
const { Pool, types } = require('pg');
require('dotenv').config();

// DATE: preserve YYYY-MM-DD without timezone shifts.
types.setTypeParser(1082, (value) => value);

// NUMERIC: return numbers instead of strings.
types.setTypeParser(1700, (value) =>
  value === null ? null : parseFloat(value)
);

const pool = new Pool({
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'neondb',
  ssl: { rejectUnauthorized: true },
  max: 10,
  idleTimeoutMillis: 30000,
});

pool.on('error', (err) => {
  console.error('Unexpected PostgreSQL error', err);
});

module.exports = pool;
