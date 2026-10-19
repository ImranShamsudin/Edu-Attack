// Small, dependency-free input helpers shared by all routes.

// Trim + length-limit a string. Returns null for empty / non-string input.
function cleanStr(value, max = 255) {
  if (value === undefined || value === null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  return s.slice(0, max);
}

// Strict positive integer ("12" or 12 -> 12, anything else -> null).
function toId(value) {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;
  if (typeof value === 'string' && /^\d{1,9}$/.test(value.trim())) {
    const n = parseInt(value, 10);
    return n > 0 ? n : null;
  }
  return null;
}

// Strict YYYY-MM-DD that is also a real calendar date.
function isIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// 'YYYY-MM-DD' for (today + offsetDays), in UTC.
function isoDay(offsetDays = 0) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function isEmail(value) {
  return typeof value === 'string' && value.length <= 150 && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

const MIN_PASSWORD_LENGTH = 8;

// Returns an error message, or null when the password is acceptable.
function passwordProblem(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > 128) return 'Password is too long (max 128 characters)';
  return null;
}

// CSV cell: quote it and neutralise spreadsheet formula injection (=, +, -, @).
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function toCsv(headers, rows) {
  // BOM so Excel opens UTF-8 names correctly.
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
}

module.exports = {
  cleanStr, toId, isIsoDate, isoDay, normalizeEmail, isEmail,
  MIN_PASSWORD_LENGTH, passwordProblem, csvCell, toCsv,
};
