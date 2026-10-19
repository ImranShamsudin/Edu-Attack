require('dotenv').config();

// Fail fast on a missing/weak secret instead of failing on every login later.
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be set in .env and be at least 32 characters long.');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(48).toString(\'hex\'))"');
  process.exit(1);
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const pool = require('./db');
const authenticateToken = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 5000;

// ---- Middleware -------------------------------------------------------------
const allowedOrigins = (process.env.CORS_ORIGIN || '').split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({ origin: allowedOrigins.length ? allowedOrigins : true }));
app.use(express.json({ limit: '100kb' }));

app.use((req, res, next) => {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
  });
  next();
});

// ---- API routes -------------------------------------------------------------
app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok', database: 'connected' });
  } catch (err) {
    res.status(503).json({ status: 'error', database: 'unreachable' });
  }
});

app.use('/auth', require('./routes/auth'));
app.use('/admin', require('./routes/admin'));
app.use('/attachments', require('./routes/attachments'));
app.use('/organizations', require('./routes/organizations'));
app.use('/logbook', require('./routes/logbook'));
app.use('/supervisor', require('./routes/supervisor'));
app.use('/weekly-reports', require('./routes/weeklyReports'));
app.use('/final-report', require('./routes/finalReport'));

// Simple "who am I" check, handy when debugging tokens.
app.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: 'You are authenticated', user: req.user });
});

// ---- Frontend ---------------------------------------------------------------
// Serve ONLY the frontend folder. (The backend folder, the .env file and the
// uploaded final reports are never served as static files.)
// Open http://localhost:5000 and the app works with no extra setup.
app.use(express.static(path.join(__dirname, '..', 'attachment-frontend')));

// Unknown API-style requests get JSON; errors always return JSON.
app.use(notFound);
app.use(errorHandler);

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`EduAttach running on http://localhost:${PORT}`);
  });
}

module.exports = app;
