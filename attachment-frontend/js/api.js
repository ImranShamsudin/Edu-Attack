// =============================================================================
// EduAttach - shared frontend helpers
// =============================================================================

// ===== API CONFIG =====
// - Opened through the backend (Render, or http://localhost:5000)  -> same address, nothing to configure.
// - Local Live Server / file:// -> talks to http://localhost:5000.
// - To point somewhere else, define  window.API_BASE = 'https://your-api'  BEFORE loading this file.
const API_BASE = (() => {
  if (typeof window === 'undefined') return '';
  if (window.API_BASE) return window.API_BASE;
  const { protocol, hostname, port, origin } = window.location;
  if (!protocol.startsWith('http')) return 'http://localhost:5000';
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  if (isLocal && port !== '5000') return 'http://localhost:5000';
  return origin;
})();

// ===== SAFE OUTPUT =====
// Every value that comes from the database or from a user MUST go through esc() before it is
// placed inside an innerHTML template. Without it, a student who types <script> (or an
// onerror= handler) as their company name could run code in the coordinator's browser.
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ===== TOKEN / SESSION HELPERS =====
function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  try {
    const raw = localStorage.getItem('user');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null; // corrupted value - treat as logged out
  }
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function logout() {
  clearSession();
  window.location.href = 'index.html';
}

// Reads the expiry out of the JWT (no verification - the server does that) so an expired
// session sends the user to the login page instead of showing a wall of failed requests.
function tokenExpired(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' && payload.exp * 1000 < Date.now();
  } catch {
    return true;
  }
}

function requireAuth(allowedRoles) {
  const token = getToken();
  const user = getUser();
  if (!token || !user || tokenExpired(token)) {
    clearSession();
    window.location.href = 'index.html';
    return null;
  }
  if (user.must_change_password && !window.location.pathname.endsWith('change-password.html')) {
    window.location.href = 'change-password.html';
    return null;
  }
  if (allowedRoles && !allowedRoles.includes(user.role)) {
    window.location.href = roleHomePage(user.role);
    return null;
  }
  return user;
}

function roleHomePage(role) {
  switch (role) {
    case 'student': return 'student.html';
    case 'admin': return 'admin.html';
    case 'industrial_supervisor': return 'ind-supervisor.html';
    case 'university_supervisor': return 'uni-supervisor.html';
    default: return 'index.html';
  }
}

// ===== FETCH WRAPPERS =====
const NETWORK_ERROR = 'Could not reach the server. Make sure the backend is running (npm start).';

// Shared by every request: turns "session is no longer valid" into a redirect.
function handleAuthFailure(response, data) {
  if (response.status === 401 && data && (data.code === 'INVALID_TOKEN' || data.code === 'NO_TOKEN' || data.code === 'ACCOUNT_INACTIVE')) {
    clearSession();
    window.location.href = 'index.html';
    return true;
  }
  if (response.status === 403 && data && data.code === 'PASSWORD_CHANGE_REQUIRED') {
    const user = getUser();
    if (user) saveSession(getToken(), { ...user, must_change_password: true });
    if (!window.location.pathname.endsWith('change-password.html')) {
      window.location.href = 'change-password.html';
    }
    return true;
  }
  return false;
}

async function parseJson(response) {
  try { return await response.json(); } catch { return {}; }
}

async function apiRequest(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new Error(NETWORK_ERROR);
  }

  const data = await parseJson(response);
  if (!response.ok) {
    if (auth && handleAuthFailure(response, data)) {
      throw new Error(data.error || 'Please sign in again.');
    }
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

async function apiUpload(path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch {
    throw new Error(NETWORK_ERROR);
  }

  const data = await parseJson(response);
  if (!response.ok) {
    if (handleAuthFailure(response, data)) throw new Error(data.error || 'Please sign in again.');
    throw new Error(data.error || `Request failed (${response.status})`);
  }
  return data;
}

// A plain <a href> cannot send the Authorization header, so protected files are fetched with the
// token and handed to the browser as a temporary blob URL (used for report downloads and CSV exports).
async function apiDownload(path, suggestedFilename) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method: 'GET', headers });
  } catch {
    throw new Error(NETWORK_ERROR);
  }

  if (!response.ok) {
    const data = await parseJson(response);
    if (handleAuthFailure(response, data)) throw new Error(data.error || 'Please sign in again.');
    throw new Error(data.error || `Download failed (${response.status})`);
  }

  let filename = suggestedFilename || 'download';
  const disposition = response.headers.get('Content-Disposition');
  if (disposition) {
    const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
    if (match) {
      try { filename = decodeURIComponent(match[1]); } catch { filename = match[1]; }
    }
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ===== DATES =====
// The API returns DATE columns as plain 'YYYY-MM-DD'. new Date('2026-09-01') would be UTC midnight,
// which shows as the previous day for anyone west of UTC, so such strings are parsed as LOCAL dates.
function parseDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value));
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function formatDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '-';
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeAgo(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  if (weeks < 9) return `${weeks} weeks ago`;
  return formatDate(dateStr);
}

// ===== PLACEMENT PROGRESS =====
// Length of a placement in weeks, counting both the first and the last day and rounding UP,
// e.g. 1 Sep - 31 Dec (122 days) = 18 weeks.
function programWeeks(startStr, endStr) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  if (!start || !end) return 1;
  const days = Math.round((end - start) / 86400000) + 1;
  return Math.max(1, Math.ceil(days / 7));
}
const weeksBetween = programWeeks; // old name, still used by some pages

// Where a student is in their placement, based on the CALENDAR.
function programProgress(startStr, endStr, status) {
  const start = parseDate(startStr);
  const end = parseDate(endStr);
  const totalWeeks = programWeeks(startStr, endStr);
  if (!start || !end) return { totalWeeks, currentWeek: 0, pct: 0, state: 'upcoming', label: 'Not started' };

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const totalDays = Math.round((end - start) / 86400000) + 1;

  let state = 'in_progress';
  if (status === 'completed' || today > end) state = 'completed';
  else if (today < start) state = 'upcoming';

  let currentWeek = 0;
  let pct = 0;
  if (state === 'completed') {
    currentWeek = totalWeeks;
    pct = 100;
  } else if (state === 'in_progress') {
    const dayNumber = Math.round((today - start) / 86400000) + 1;
    currentWeek = Math.min(totalWeeks, Math.ceil(dayNumber / 7));
    pct = Math.min(99, Math.round((dayNumber / totalDays) * 100));
  }

  let label = 'In progress';
  if (state === 'upcoming') label = 'Not started';
  else if (state === 'completed') label = 'Completed';
  else if (pct >= 75) label = 'Almost complete';
  else if (pct >= 50) label = 'Half completed';
  return { totalWeeks, currentWeek, pct, state, label };
}

// Today as 'YYYY-MM-DD' in the user's own time zone (for <input type="date" max="...">).
function todayIso() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// ===== LABELS & BADGES =====
function roleLabel(role) {
  const labels = {
    student: 'Student',
    admin: 'Coordinator',
    industrial_supervisor: 'Industrial Supervisor',
    university_supervisor: 'University Supervisor',
  };
  return labels[role] || role;
}

const STATUS_STYLES = {
  pending: 'bg-yellow-100 text-yellow-800',
  active: 'bg-green-100 text-green-800',
  completed: 'bg-blue-100 text-blue-800',
  rejected: 'bg-red-100 text-red-800',
};
const STATUS_LABELS = {
  pending: 'Pending approval',
  active: 'Active',
  completed: 'Completed',
  rejected: 'Rejected',
};

function statusBadge(status) {
  const cls = STATUS_STYLES[status] || 'bg-gray-100 text-gray-800';
  const label = STATUS_LABELS[status] || status || 'N/A';
  return `<span class="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${cls}">${esc(label)}</span>`;
}

function initials(name) {
  return String(name || '?').trim().split(/\s+/).map((p) => p[0]).join('').substring(0, 2).toUpperCase() || '?';
}

// A student can have several placements over time (e.g. one rejected, then a corrected one).
// Pages that show "my placement" must use the most relevant one, not simply the newest.
function pickCurrentAttachment(attachments) {
  if (!attachments || attachments.length === 0) return null;
  const rank = { active: 1, pending: 2, completed: 3, rejected: 4 };
  return [...attachments].sort((a, b) => (rank[a.status] || 5) - (rank[b.status] || 5))[0];
}

function debounce(fn, ms = 200) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

// ===== TOAST =====
function toast(message, isError = false, durationMs) {
  let el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__toast';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);max-width:90vw;' +
      'padding:12px 20px;border-radius:8px;font-family:Inter,sans-serif;font-size:14px;' +
      'color:#fff;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s;pointer-events:none;';
    document.body.appendChild(el);
  }
  el.style.background = isError ? '#ba1a1a' : '#0056c6';
  el.textContent = message;
  el.style.opacity = '1';
  el.style.display = 'block';
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.style.opacity = '0'; }, durationMs || (isError ? 5000 : 3000));
}

// ===== MOBILE SIDEBAR =====
// Pages hide their sidebar below the md breakpoint. Any  <button data-menu-toggle>  opens it as a
// slide-over; tapping the dark backdrop or a link closes it again.
document.addEventListener('DOMContentLoaded', () => {
  const sidebar = document.querySelector('aside.hidden, nav.hidden');
  if (!sidebar) return;
  let buttons = document.querySelectorAll('[data-menu-toggle]');
  if (buttons.length === 0) {
    // Page has a sidebar but no menu button (e.g. logbook): add a floating one, shown only on small screens.
    const bp = sidebar.className.includes('lg:flex') ? 'lg:hidden' : 'md:hidden';
    const fab = document.createElement('button');
    fab.setAttribute('data-menu-toggle', '');
    fab.setAttribute('aria-label', 'Open menu');
    fab.className = `${bp} fixed top-3 left-3 z-30 w-10 h-10 rounded-full bg-primary text-white shadow flex items-center justify-center`;
    fab.innerHTML = '<span class="material-symbols-outlined">menu</span>';
    document.body.appendChild(fab);
    buttons = [fab];
  }

  const overlay = document.createElement('div');
  overlay.className = 'fixed inset-0 bg-black/40 z-40 hidden';
  document.body.appendChild(overlay);

  const setOpen = (open) => {
    sidebar.classList.toggle('hidden', !open);
    sidebar.classList.toggle('flex', open);
    sidebar.style.zIndex = open ? '50' : '';
    overlay.classList.toggle('hidden', !open);
  };
  buttons.forEach((b) => b.addEventListener('click', () => setOpen(sidebar.classList.contains('hidden'))));
  overlay.addEventListener('click', () => setOpen(false));
  sidebar.addEventListener('click', (e) => { if (e.target.closest('a')) setOpen(false); });
});

// ===== FILL-IN HELPERS =====
// Elements marked  data-user-name  /  data-user-role  /  data-user-initials  show the logged-in user.
document.addEventListener('DOMContentLoaded', () => {
  const user = getUser();
  if (!user) return;
  document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = user.name || ''; });
  document.querySelectorAll('[data-user-role]').forEach((el) => { el.textContent = roleLabel(user.role); });
  document.querySelectorAll('[data-user-initials]').forEach((el) => { el.textContent = initials(user.name); });
});
