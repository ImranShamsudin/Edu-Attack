const express = require('express');
const cors = require('cors');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const organizationRoutes = require('./routes/organizations');
const attachmentRoutes = require('./routes/attachments');
const logbookRoutes = require('./routes/logbook');
const weeklyReportRoutes = require('./routes/weeklyReports');
const adminRoutes = require('./routes/admin');
const supervisorRoutes = require('./routes/supervisor');
const finalReportRoutes = require('./routes/finalReport');
const authenticateToken = require('./middleware/auth');
const requireRole = require('./middleware/role');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// ===== ROUTES - NO /api PREFIX =====
app.use('/auth', authRoutes);
app.use('/organizations', organizationRoutes);
app.use('/attachments', attachmentRoutes);
app.use('/logbook', logbookRoutes);
app.use('/weekly-reports', weeklyReportRoutes);
app.use('/admin', adminRoutes);
app.use('/supervisor', supervisorRoutes);
app.use('/final-report', finalReportRoutes);

// Test route
app.get('/', (req, res) => {
  res.json({ message: 'Attachment Management API is running' });
});

// Protected test route
app.get('/protected', authenticateToken, (req, res) => {
  res.json({ message: `Hello user ${req.user.id}, your role is ${req.user.role}` });
});

// Admin test route
app.get('/admin-only', authenticateToken, requireRole('admin'), (req, res) => {
  res.json({ message: 'Welcome, admin. This route is restricted.' });
});

// Serve HTML files
app.get('*.html', (req, res) => {
  res.sendFile(__dirname + '/' + req.path);
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Test the API at http://localhost:${PORT}/`);
});