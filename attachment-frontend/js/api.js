// ===== API CONFIG =====
const API_BASE = 'http://localhost:5000';  // <-- NO /api here

// ===== TOKEN / SESSION HELPERS =====
function saveSession(token, user) {
  localStorage.setItem('token', token);
  localStorage.setItem('user', JSON.stringify(user));
}

function getToken() {
  return localStorage.getItem('token');
}

function getUser() {
  const raw = localStorage.getItem('user');
  return raw ? JSON.parse(raw) : null;
}

function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
}

function logout() {
  clearSession();
  window.location.href = 'index.html';
}

function requireAuth(allowedRoles) {
  const token = getToken();
  const user = getUser();
  if (!token || !user) {
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

// ===== FETCH WRAPPER =====
async function apiRequest(path, { method = 'GET', body = null, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
  }

  console.log(`Making ${method} request to: ${API_BASE}${path}`);

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new Error('Could not reach the server. Is it running on localhost:5000?');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}

// ===== UI HELPERS =====
function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (weeks === 1) return '1 week ago';
  return `${weeks} weeks ago`;
}

function roleLabel(role) {
  const labels = {
    student: 'Student',
    admin: 'Coordinator',
    industrial_supervisor: 'Industrial Supervisor',
    university_supervisor: 'University Supervisor',
  };
  return labels[role] || role;
}

function toast(message, isError = false) {
  let el = document.getElementById('__toast');
  if (!el) {
    el = document.createElement('div');
    el.id = '__toast';
    el.style.cssText = 'position:fixed;bottom:24px;left:50%;transform:translateX(-50%);' +
      'padding:12px 20px;border-radius:8px;font-family:Inter,sans-serif;font-size:14px;' +
      'color:#fff;z-index:9999;box-shadow:0 4px 12px rgba(0,0,0,0.15);transition:opacity 0.3s;';
    document.body.appendChild(el);
  }
  el.style.background = isError ? '#ba1a1a' : '#0056c6';
  el.textContent = message;
  el.style.opacity = '1';
  el.style.display = 'block';
  clearTimeout(el._timeout);
  el._timeout = setTimeout(() => { el.style.opacity = '0'; }, 2800);
}
async function apiUpload(path, formData) {
  const headers = {};
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, { method: 'POST', headers, body: formData });
  } catch (err) {
    throw new Error('Could not reach the server. Is it running on localhost:5000?');
  }

  let data;
  try {
    data = await response.json();
  } catch {
    data = {};
  }

  if (!response.ok) {
    throw new Error(data.error || `Request failed (${response.status})`);
  }

  return data;
}