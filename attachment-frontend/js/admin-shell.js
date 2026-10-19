// =============================================================================
// Coordinator (admin) page shell: sidebar + top bar + modal helper.
// Every coordinator page loads this after api.js, so navigation is identical everywhere
// and every link goes to a page the coordinator is actually allowed to open.
//
//   mountAdminShell('dashboard', { searchPlaceholder: 'Search students...' });
//   window.onShellSearch = (query) => { ... };   // optional, called while typing in the search box
// =============================================================================

const ADMIN_NAV = [
  { key: 'dashboard', href: 'admin.html', icon: 'dashboard', label: 'Dashboard' },
  { key: 'accounts', href: 'users.html', icon: 'manage_accounts', label: 'Accounts' },
  { key: 'companies', href: 'companies.html', icon: 'business', label: 'Companies' },
  { key: 'grading', href: 'admin.html#grading', icon: 'assignment_turned_in', label: 'Grading' },
  { key: 'reports', href: 'reports.html', icon: 'description', label: 'Reports' },
  { key: 'settings', href: 'settings.html', icon: 'settings', label: 'Settings' },
];

function mountAdminShell(activeKey, options = {}) {
  const user = getUser() || {};

  const navHtml = ADMIN_NAV.map((item) => {
    const isActive = item.key === activeKey;
    const cls = isActive
      ? 'bg-secondary-container text-on-secondary-container font-semibold'
      : 'text-on-primary-fixed-variant hover:text-white hover:bg-on-primary-fixed-variant/20';
    return `
      <a href="${item.href}" data-nav="${item.key}" class="flex items-center gap-3 px-3 py-2 mx-2 rounded-lg transition-colors ${cls}">
        <span class="material-symbols-outlined">${item.icon}</span>
        <span class="font-body-md text-body-md flex-1">${item.label}</span>
        <span data-badge="${item.key}" class="hidden min-w-[20px] h-5 px-1.5 rounded-full bg-error text-white text-xs font-semibold items-center justify-center"></span>
      </a>`;
  }).join('');

  const searchHtml = options.searchPlaceholder ? `
    <div class="hidden sm:flex items-center bg-surface-container-high rounded-full px-4 py-2 w-64 lg:w-96 border border-outline-variant focus-within:border-secondary focus-within:ring-1 focus-within:ring-secondary transition-all">
      <span class="material-symbols-outlined text-on-surface-variant mr-2">search</span>
      <input id="shell-search" type="search" autocomplete="off" placeholder="${esc(options.searchPlaceholder)}"
             class="bg-transparent border-none outline-none w-full font-body-md text-body-md text-on-surface placeholder-on-surface-variant focus:ring-0 p-0">
    </div>` : '<div></div>';

  const html = `
    <div id="shell-overlay" class="fixed inset-0 bg-black/40 z-40 hidden md:hidden"></div>
    <aside id="shell-sidebar" class="fixed h-screen w-sidebar-width left-0 top-0 bg-primary text-secondary-fixed flex flex-col py-stack-md z-50 -translate-x-full md:translate-x-0 transition-transform duration-200">
      <a href="admin.html" class="px-container-padding mb-stack-lg flex items-center gap-3">
        <div class="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center border border-on-primary-fixed-variant">
          <span class="material-symbols-outlined text-white">school</span>
        </div>
        <div>
          <h1 class="font-headline-sm text-headline-sm font-bold text-white">EduAttach</h1>
          <p class="font-label-md text-label-md text-on-primary-container">Management System</p>
        </div>
      </a>
      <nav class="flex-1 space-y-1 overflow-y-auto">${navHtml}</nav>
      <div class="mt-stack-md pt-stack-md border-t border-on-primary-fixed-variant mx-4">
        <a href="#" onclick="logout(); return false;" class="flex items-center gap-3 px-3 py-2 text-on-primary-fixed-variant hover:text-white mx-2 hover:bg-on-primary-fixed-variant/20 transition-colors rounded-lg">
          <span class="material-symbols-outlined">logout</span>
          <span class="font-body-md text-body-md">Logout</span>
        </a>
      </div>
    </aside>
    <header class="fixed top-0 right-0 left-0 md:left-[260px] h-16 bg-surface flex justify-between items-center px-container-padding z-30 border-b border-outline-variant">
      <div class="flex items-center gap-3">
        <button id="shell-menu-btn" class="md:hidden p-2 rounded-full text-on-surface-variant hover:bg-surface-container-high" aria-label="Open menu">
          <span class="material-symbols-outlined">menu</span>
        </button>
        ${searchHtml}
      </div>
      <a href="settings.html" class="flex items-center gap-3" title="Account settings">
        <div class="hidden sm:block text-right">
          <div class="font-label-md text-label-md text-on-surface" data-user-name>${esc(user.name)}</div>
          <div class="text-[10px] text-on-surface-variant" data-user-role>${esc(roleLabel(user.role))}</div>
        </div>
        <div class="h-8 w-8 rounded-full bg-primary-container flex items-center justify-center text-white text-xs font-bold border border-outline-variant" data-user-initials>${esc(initials(user.name))}</div>
      </a>
    </header>`;

  document.body.insertAdjacentHTML('afterbegin', html);

  // Mobile menu
  const sidebar = document.getElementById('shell-sidebar');
  const overlay = document.getElementById('shell-overlay');
  const toggle = (open) => {
    sidebar.classList.toggle('-translate-x-full', !open);
    overlay.classList.toggle('hidden', !open);
  };
  document.getElementById('shell-menu-btn').addEventListener('click', () => toggle(true));
  overlay.addEventListener('click', () => toggle(false));

  // Search
  const search = document.getElementById('shell-search');
  if (search) {
    search.addEventListener('input', debounce(() => {
      if (typeof window.onShellSearch === 'function') window.onShellSearch(search.value.trim().toLowerCase());
    }, 150));
  }

  // "Accounts" badge = registrations waiting for approval (best effort, never blocks the page)
  apiRequest('/admin/stats').then((data) => {
    const n = data.stats && data.stats.pending_accounts;
    const badge = document.querySelector('[data-badge="accounts"]');
    if (badge && n > 0) { badge.textContent = n; badge.classList.remove('hidden'); badge.classList.add('inline-flex'); }
  }).catch(() => {});
}

// ----- Modal helper -------------------------------------------------------------
// openModal(title, bodyHtml) - bodyHtml must already be escaped by the caller.
function openModal(title, bodyHtml, { wide = false } = {}) {
  closeModal();
  const el = document.createElement('div');
  el.id = '__modal';
  el.className = 'fixed inset-0 z-[60] flex items-start sm:items-center justify-center bg-black/50 p-4 overflow-y-auto';
  el.innerHTML = `
    <div class="bg-white rounded-xl shadow-xl w-full ${wide ? 'max-w-3xl' : 'max-w-lg'} my-8" role="dialog" aria-modal="true">
      <div class="flex items-center justify-between p-5 border-b border-outline-variant">
        <h3 class="font-headline-sm text-headline-sm text-on-surface">${esc(title)}</h3>
        <button id="__modal-close" class="p-1 rounded-full hover:bg-surface-container-high" aria-label="Close">
          <span class="material-symbols-outlined">close</span>
        </button>
      </div>
      <div class="p-5 max-h-[70vh] overflow-y-auto">${bodyHtml}</div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener('click', (e) => { if (e.target === el) closeModal(); });
  document.getElementById('__modal-close').addEventListener('click', closeModal);
  document.addEventListener('keydown', modalEscape);
  return el;
}
function modalEscape(e) { if (e.key === 'Escape') closeModal(); }
function closeModal() {
  const el = document.getElementById('__modal');
  if (el) el.remove();
  document.removeEventListener('keydown', modalEscape);
}

// Copy text to the clipboard (falls back for http:// pages where navigator.clipboard is unavailable).
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  }
}

// Random temporary password that is easy to read out loud (no 0/O/1/l confusion).
function generateTempPassword(length = 10) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}
