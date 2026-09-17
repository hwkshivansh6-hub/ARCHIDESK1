/**
 * ARCHIDESK STUDIO — CLIENT CONTROLLER
 * Full client-side architecture for managing projects, clients, accounts, drawings & site timeline
 */

const API_BASE = '/api';

// Application Global State
const state = {
  token: localStorage.getItem('archidesk_token') || sessionStorage.getItem('archidesk_token') || null,
  user: null,
  currentNav: 'dashboard',
  activeProjectId: null,
  activeProject: null,
  projects: [],
  clients: [],
  projectTypes: [],
  filters: {
    status: '',
    type: '',
    client: '',
    location: '',
    search: ''
  },
  drawingCategoryFilter: 'All',
  imageCategoryFilter: 'All',
  isMobileFrame: false,
  isGridActive: false
};

// Currency Formatter for Indian Rupees (₹)
function formatINR(val) {
  const num = parseFloat(val) || 0;
  return '₹' + num.toLocaleString('en-IN');
}

// Format Date e.g. "17 Sep 2026"
function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
  } catch (e) {
    return dateStr;
  }
}

// Toast Notifications
function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✓' : '⚠️';
  toast.innerHTML = `<span style="font-weight:bold;">${icon}</span> <span>${msg}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 3200);
}

// API Helper with Auth Bearer Token
async function apiRequest(endpoint, options = {}) {
  const headers = options.headers || {};
  if (state.token) {
    headers['Authorization'] = `Bearer ${state.token}`;
  }

  // Handle FormData vs JSON
  let body = options.body;
  if (body && !(body instanceof FormData) && typeof body === 'object') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  try {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers,
      body
    });

    if (res.status === 401) {
      // Only logout if this was an authenticated API request, NOT during login or registration
      if (!endpoint.startsWith('/auth/login') && !endpoint.startsWith('/auth/register')) {
        logout();
        throw new Error('Session expired. Please log in again.');
      }
    }

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Server request error');
    }
    return data;
  } catch (err) {
    console.error(`API Error on ${endpoint}:`, err);
    throw err;
  }
}

// ================= PWA & MOBILE APP INSTALLATION =================
let deferredInstallPrompt = null;

// Register Service Worker early for offline capability & mobile installability
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => {
        console.log('[PWA] Service Worker registered with scope:', reg.scope);
      })
      .catch(err => {
        console.warn('[PWA] Service Worker registration failed:', err);
      });
  });
}

function initPWA() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                       window.navigator.standalone === true ||
                       document.referrer.includes('android-app://');

  const banner = document.getElementById('pwa-install-banner');
  const btnHeaderInstall = document.getElementById('btn-header-install');
  const btnLoginInstall = document.getElementById('btn-login-install-app');
  const btnAuthInstall = document.getElementById('btn-auth-install-app');

  if (isStandalone) {
    if (banner) banner.style.display = 'none';
    if (btnHeaderInstall) btnHeaderInstall.style.display = 'none';
    if (btnLoginInstall) btnLoginInstall.style.display = 'none';
    if (btnAuthInstall) btnAuthInstall.style.display = 'none';
    console.log('[PWA] Running in standalone mobile mode');
    return;
  }

  // Intercept the mobile install prompt
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    console.log('[PWA] Mobile install prompt ready');
    if (banner) banner.style.display = 'flex';
    if (btnHeaderInstall) btnHeaderInstall.style.display = 'inline-flex';
    if (btnLoginInstall) btnLoginInstall.style.display = 'inline-flex';
    if (btnAuthInstall) btnAuthInstall.style.display = 'inline-flex';
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    if (banner) banner.style.display = 'none';
    if (btnHeaderInstall) btnHeaderInstall.style.display = 'none';
    if (btnLoginInstall) btnLoginInstall.style.display = 'none';
    if (btnAuthInstall) btnAuthInstall.style.display = 'none';
    showToast('SHASWAT DESIGNS installed on your mobile home screen!', 'success');
  });

  async function handleInstallTrigger() {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      const { outcome } = await deferredInstallPrompt.userChoice;
      if (outcome === 'accepted') {
        showToast('Installing SHASWAT DESIGNS app...', 'success');
      }
      deferredInstallPrompt = null;
      if (banner) banner.style.display = 'none';
      return;
    }

    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    if (isIOS) {
      alert('📱 Install on iPhone / iPad (Safari):\n\n1. Tap the Share button (⎋) in the Safari toolbar.\n2. Scroll down and tap "Add to Home Screen" (⊞).\n3. Tap "Add" at the top-right.\n\nThe app will open full-screen directly from your home screen!');
      return;
    }

    alert('📱 Install on Mobile / Android:\n\n1. Open your browser menu (the three dots ⋮ at the top right).\n2. Tap "Install app" or "Add to Home screen".\n3. Tap "Install" to confirm.\n\nSHASWAT DESIGNS will now appear alongside your regular phone apps!');
  }

  const btnPwaInstall = document.getElementById('btn-pwa-install');
  if (btnPwaInstall) btnPwaInstall.addEventListener('click', handleInstallTrigger);

  if (btnHeaderInstall) btnHeaderInstall.addEventListener('click', handleInstallTrigger);

  const btnSettingsInstall = document.getElementById('btn-settings-install-pwa');
  if (btnSettingsInstall) btnSettingsInstall.addEventListener('click', handleInstallTrigger);

  if (btnLoginInstall) btnLoginInstall.addEventListener('click', handleInstallTrigger);
  if (btnAuthInstall) btnAuthInstall.addEventListener('click', handleInstallTrigger);

  const btnDismiss = document.getElementById('btn-pwa-dismiss');
  if (btnDismiss) {
    btnDismiss.addEventListener('click', () => {
      if (banner) banner.style.display = 'none';
    });
  }
}

// ================= INITIALIZATION & AUTH =================
document.addEventListener('DOMContentLoaded', async () => {
  initEventListeners();
  initModals();
  initPWA();

  if (state.token) {
    try {
      const data = await apiRequest('/auth/me');
      state.user = data.user;
      showApp();
    } catch (err) {
      showAuth();
    }
  } else {
    showAuth();
  }
});

function showAuth() {
  document.getElementById('auth-view').style.display = 'flex';
  document.getElementById('app-view').style.display = 'none';
}

function showApp() {
  document.getElementById('auth-view').style.display = 'none';
  document.getElementById('app-view').style.display = 'flex';
  updateUserDisplay();
  loadInitialData();
  switchNav(state.currentNav || 'dashboard');
}

function updateUserDisplay() {
  if (state.user) {
    const studioName = state.user.studio_name || 'SHASWAT DESIGNS';
    const userName = state.user.name || 'Er. Shivansh';
    const role = state.user.role || 'Principal Architect';

    document.getElementById('app-studio-title').innerHTML = `${studioName} <span class="studio-badge">STUDIO</span>`;
    document.getElementById('app-user-subtitle').textContent = `${userName} • ${role}`;

    // Update personalized engineer greeting
    updateGreeting();

    // Update settings profile card
    const sStudio = document.getElementById('settings-studio-name');
    const sName = document.getElementById('settings-user-name');
    const sEmail = document.getElementById('settings-user-email');
    const sRole = document.getElementById('settings-user-role');
    if (sStudio) sStudio.textContent = studioName;
    if (sName) sName.textContent = userName;
    if (sEmail) sEmail.textContent = state.user.email || '';
    if (sRole) sRole.textContent = role;
  }
}

function updateGreeting() {
  const hour = new Date().getHours();
  let timeGreet = 'Good morning';
  if (hour >= 12 && hour < 17) timeGreet = 'Good afternoon';
  else if (hour >= 17 && hour < 22) timeGreet = 'Good evening';
  else if (hour >= 22 || hour < 5) timeGreet = 'Welcome / Working late';

  const userName = state.user?.name || 'Er. Shivansh';
  const studioName = state.user?.studio_name || 'SHASWAT DESIGNS';

  const greetingTextEl = document.getElementById('dash-greeting-text');
  const greetingSubEl = document.getElementById('dash-greeting-subtitle');
  if (greetingTextEl) {
    greetingTextEl.innerHTML = `${timeGreet}, <strong>${userName}</strong> 👋`;
  }
  if (greetingSubEl) {
    greetingSubEl.innerHTML = `Welcome to <strong>${studioName}</strong> • Digital Studio Workspace`;
  }
}

function logout() {
  if (state.token) {
    apiRequest('/auth/logout', { method: 'POST' }).catch(() => {});
  }
  localStorage.removeItem('archidesk_token');
  sessionStorage.removeItem('archidesk_token');
  state.token = null;
  state.user = null;
  showAuth();
  showToast('Logged out successfully', 'success');
}

// ================= LOAD DATA =================
async function loadInitialData() {
  await Promise.all([
    loadProjectTypes(),
    loadClients(),
    loadProjects(),
    loadDashboardStats()
  ]);
}

async function loadProjectTypes() {
  try {
    state.projectTypes = await apiRequest('/project-types');
    populateProjectTypesSelects();
    renderSettingsProjectTypes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadClients() {
  try {
    state.clients = await apiRequest('/clients');
    populateClientsSelects();
    if (state.currentNav === 'clients') renderClients();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadProjects() {
  try {
    const params = new URLSearchParams();
    if (state.filters.status) params.append('status', state.filters.status);
    if (state.filters.type) params.append('project_type_id', state.filters.type);
    if (state.filters.client) params.append('client_id', state.filters.client);
    if (state.filters.location) params.append('location', state.filters.location);
    if (state.filters.search) params.append('search', state.filters.search);

    const query = params.toString() ? `?${params.toString()}` : '';
    state.projects = await apiRequest(`/projects${query}`);
    renderProjects();
    updateProjectCounts();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function loadDashboardStats() {
  try {
    const stats = await apiRequest('/dashboard/stats');
    renderDashboard(stats);
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

// ================= NAVIGATION =================
function switchNav(navKey) {
  state.currentNav = navKey;

  // Update bottom nav items
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.nav === navKey);
  });

  // Hide all sections
  document.querySelectorAll('.app-section').forEach(sec => sec.style.display = 'none');

  if (navKey === 'dashboard') {
    document.getElementById('view-dashboard').style.display = 'block';
    loadDashboardStats();
  } else if (navKey === 'projects') {
    document.getElementById('view-projects').style.display = 'block';
    loadProjects();
  } else if (navKey === 'clients') {
    document.getElementById('view-clients').style.display = 'block';
    loadClients();
  } else if (navKey === 'accounts') {
    document.getElementById('view-accounts').style.display = 'block';
    loadAccountsSummary();
  } else if (navKey === 'settings') {
    document.getElementById('view-settings').style.display = 'block';
    renderSettingsProjectTypes();
  } else if (navKey === 'workspace') {
    document.getElementById('view-project-workspace').style.display = 'block';
  }

  // Scroll to top
  document.getElementById('main-viewport').scrollTop = 0;
}

// ================= DASHBOARD RENDERING =================
function renderDashboard(stats) {
  if (!stats) return;

  // 1. Projects counts
  const pc = stats.projects_counts || {};
  document.getElementById('dash-projects-total').textContent = `${pc.total || 0} Projects`;
  document.getElementById('dash-proj-active').textContent = pc.active || 0;
  document.getElementById('dash-proj-preplan').textContent = pc.pre_planning || 0;
  document.getElementById('dash-proj-completed').textContent = pc.completed || 0;

  // 2. Clients
  document.getElementById('dash-clients-total').textContent = `${stats.clients_count || 0} Clients`;
  document.getElementById('dash-clients-count').textContent = stats.clients_count || 0;

  // 3. Accounts Financials
  const fin = stats.financials || {};
  const totalDeal = fin.total_deal || 0;
  const totalRec = fin.total_received || 0;
  const totalBal = fin.total_balance || 0;

  document.getElementById('dash-total-deal').textContent = formatINR(totalDeal);
  document.getElementById('dash-total-received').textContent = formatINR(totalRec);
  document.getElementById('dash-total-balance').textContent = formatINR(totalBal);

  const pct = totalDeal > 0 ? Math.min(100, Math.round((totalRec / totalDeal) * 100)) : 0;
  document.getElementById('dash-finance-progress').style.width = `${pct}%`;

  // Recent Projects List
  const recentProjContainer = document.getElementById('dash-recent-projects-list');
  if (stats.recent_projects && stats.recent_projects.length > 0) {
    recentProjContainer.innerHTML = stats.recent_projects.map(p => `
      <div class="client-project-pill" style="cursor: pointer;" onclick="openProjectWorkspace(${p.id})">
        <div>
          <strong style="font-size: 13px;">${p.name}</strong>
          <span style="font-size: 11px; color: var(--arch-ink-muted); margin-left: 6px;">${p.client_name} • ${p.location}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 8px;">
          <span class="badge-status status-${p.status.replace(' ', '-')}">${p.status}</span>
          <span style="font-family: var(--font-mono); font-weight: 600; font-size: 12px;">${formatINR(p.total_fee)}</span>
        </div>
      </div>
    `).join('');
  } else {
    recentProjContainer.innerHTML = `<div style="font-size: 12px; color: var(--arch-ink-muted); padding: 8px;">No projects created yet.</div>`;
  }

  // Recent Payments List
  const recentPayContainer = document.getElementById('dash-recent-payments-list');
  if (stats.recent_payments && stats.recent_payments.length > 0) {
    recentPayContainer.innerHTML = stats.recent_payments.map(pmt => `
      <div class="client-project-pill">
        <div>
          <div style="font-weight: 600; font-size: 13px;">${pmt.project_name}</div>
          <div style="font-size: 11px; color: var(--arch-ink-muted);">${formatDate(pmt.payment_date)} • ${pmt.payment_method}</div>
        </div>
        <div style="font-family: var(--font-mono); font-weight: 700; color: var(--arch-sage); font-size: 13px;">
          +${formatINR(pmt.amount)}
        </div>
      </div>
    `).join('');
  } else {
    recentPayContainer.innerHTML = `<div style="font-size: 12px; color: var(--arch-ink-muted); padding: 8px;">No payments recorded yet.</div>`;
  }
}

// ================= PROJECTS RENDERING & FILTERING =================
function updateProjectCounts() {
  const all = state.projects.length;
  const active = state.projects.filter(p => p.status === 'Active').length;
  const preplan = state.projects.filter(p => p.status === 'Pre-Planning').length;
  const comp = state.projects.filter(p => p.status === 'Completed').length;

  document.getElementById('tab-badge-all').textContent = all;
  document.getElementById('tab-badge-active').textContent = active;
  document.getElementById('tab-badge-preplan').textContent = preplan;
  document.getElementById('tab-badge-completed').textContent = comp;
}

function renderProjects() {
  const container = document.getElementById('projects-cards-container');
  if (!state.projects || state.projects.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; background: var(--arch-paper); border: 1px dashed var(--arch-border); border-radius: var(--radius-lg);">
        <div style="font-size: 32px; margin-bottom: 8px;">📐</div>
        <h3 style="font-family: var(--font-heading); font-size: 16px; font-weight: 700; color: var(--arch-ink);">No matching projects found</h3>
        <p style="font-size: 13px; color: var(--arch-ink-muted); margin-top: 4px;">Try clearing filters or create a new architectural project.</p>
        <button class="btn btn-primary btn-sm" onclick="openNewProjectModal()" style="margin-top: 14px;">+ Create Project</button>
      </div>
    `;
    return;
  }

  container.innerHTML = state.projects.map(p => {
    const fee = p.total_fee || 0;
    const rec = p.received_amount || 0;
    const bal = p.balance_amount !== undefined ? p.balance_amount : (fee - rec);
    const progressPct = fee > 0 ? Math.min(100, Math.round((rec / fee) * 100)) : 0;

    return `
      <div class="project-card" onclick="openProjectWorkspace(${p.id})">
        <div>
          <div class="project-card-header">
            <h3 class="project-title">${p.name}</h3>
            <div class="project-badges">
              <span class="badge-type" style="border-left: 3px solid ${p.badge_color || '#2563eb'}">${p.project_type_name || 'Architectural'}</span>
              <span class="badge-status status-${p.status.replace(' ', '-')}">${p.status}</span>
            </div>
          </div>

          <div class="project-meta-row">
            <span class="meta-client">👤 ${p.client_name}</span>
            <span>📍 ${p.location}</span>
          </div>

          <!-- Financial Summary Block -->
          <div class="project-card-finances">
            <div class="finance-metrics-row">
              <div class="metric-col">
                <span class="metric-title">Deal Fee</span>
                <span class="metric-amount">${formatINR(fee)}</span>
              </div>
              <div class="metric-col">
                <span class="metric-title">Received</span>
                <span class="metric-amount" style="color: var(--arch-sage);">${formatINR(rec)}</span>
              </div>
              <div class="metric-col">
                <span class="metric-title">Balance</span>
                <span class="metric-amount balance">${formatINR(bal)}</span>
              </div>
            </div>

            <div class="fin-progress-bar" title="${progressPct}% collected">
              <div class="fin-progress-fill" style="width: ${progressPct}%;"></div>
            </div>
          </div>
        </div>

        <div class="project-card-footer">
          <div class="card-attachments-info">
            <span>📐 ${p.drawings_count || 0} drawings</span>
            <span>📷 ${p.images_count || 0} photos</span>
          </div>
          <span style="font-weight: 600; color: var(--arch-blueprint);">Open Workspace →</span>
        </div>
      </div>
    `;
  }).join('');
}

// ================= PROJECT WORKSPACE =================
async function openProjectWorkspace(projectId) {
  state.activeProjectId = projectId;
  try {
    const project = await apiRequest(`/projects/${projectId}`);
    state.activeProject = project;
    renderWorkspace(project);
    switchNav('workspace');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderWorkspace(p) {
  document.getElementById('ws-project-name').textContent = p.name;
  document.getElementById('ws-project-type-badge').textContent = p.project_type_name;
  document.getElementById('ws-project-type-badge').style.borderColor = p.badge_color || '#2563eb';
  document.getElementById('ws-client-name').textContent = p.client_name;
  document.getElementById('ws-location').textContent = p.location;
  document.getElementById('ws-status-selector').value = p.status;

  // Overview info
  document.getElementById('ws-info-start-date').textContent = formatDate(p.start_date);
  document.getElementById('ws-info-end-date').textContent = formatDate(p.expected_completion_date);
  document.getElementById('ws-info-location').textContent = p.location;
  document.getElementById('ws-info-notes').textContent = p.notes || 'No architectural notes or scope added for this project.';

  // Client card in overview
  document.getElementById('ws-client-card-name').textContent = p.client_name;
  document.getElementById('ws-client-card-company').textContent = p.client_company || 'Independent Client';
  document.getElementById('ws-client-card-phone').textContent = p.client_phone || '—';
  document.getElementById('ws-client-card-email').textContent = p.client_email || '—';
  document.getElementById('ws-client-avatar').textContent = p.client_name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();

  // Financial calculations
  const fee = p.total_fee || 0;
  const rec = p.received_amount || 0;
  const bal = p.balance_amount !== undefined ? p.balance_amount : (fee - rec);

  // Overview quick fin
  document.getElementById('ws-overview-fee').textContent = formatINR(fee);
  document.getElementById('ws-overview-received').textContent = formatINR(rec);
  document.getElementById('ws-overview-balance').textContent = formatINR(bal);

  // Accounts tab banner
  document.getElementById('ws-acc-total-deal').textContent = formatINR(fee);
  document.getElementById('ws-acc-total-received').textContent = formatINR(rec);
  document.getElementById('ws-acc-total-balance').textContent = formatINR(bal);

  // Payments table
  renderProjectPayments(p.payments || []);

  // Drawings count and tab
  document.getElementById('ws-drawings-count-badge').textContent = p.drawings_count || 0;
  document.getElementById('ws-images-count-badge').textContent = p.images_count || 0;

  // Switch to Overview tab by default
  switchWorkspaceTab('ws-tab-overview');

  // Load drawings and images
  loadProjectDrawings(p.id);
  loadProjectImages(p.id);
}

function switchWorkspaceTab(tabId) {
  document.querySelectorAll('.workspace-nav-tabs .ws-tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabId);
  });
  document.querySelectorAll('.ws-tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });
}

function renderProjectPayments(payments) {
  const tbody = document.getElementById('ws-payments-tbody');
  if (!payments || payments.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--arch-ink-muted); padding: 20px;">No payments recorded yet for this project.</td></tr>`;
    return;
  }

  tbody.innerHTML = payments.map(pmt => `
    <tr>
      <td style="font-family: var(--font-mono);">${formatDate(pmt.payment_date)}</td>
      <td style="font-family: var(--font-mono); font-weight: 700; color: var(--arch-sage);">${formatINR(pmt.amount)}</td>
      <td><span class="method-tag">${pmt.payment_method}</span></td>
      <td style="color: var(--arch-ink-secondary); font-size: 12px;">${pmt.reference_note || '—'}</td>
      <td>
        <button class="btn btn-danger btn-sm" onclick="deletePaymentRecord(${pmt.id})">Delete</button>
      </td>
    </tr>
  `).join('');
}

// ================= DRAWINGS & REVISIONS =================
async function loadProjectDrawings(projectId) {
  try {
    const drawings = await apiRequest(`/projects/${projectId}/drawings`);
    renderDrawings(drawings);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderDrawings(drawings) {
  const container = document.getElementById('ws-drawings-grid');
  let filtered = drawings;
  if (state.drawingCategoryFilter !== 'All') {
    filtered = drawings.filter(d => d.category === state.drawingCategoryFilter);
  }

  if (!filtered || filtered.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 30px; text-align: center; background: var(--arch-card-subtle); border: 1px dashed var(--arch-border); border-radius: var(--radius-lg);">
        <p style="color: var(--arch-ink-muted);">No drawings in this category yet.</p>
        <button class="btn btn-primary btn-sm" onclick="openUploadDrawingModal()" style="margin-top: 10px;">+ Upload Drawing</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(d => {
    const fileUrl = d.latest_file_url || '/assets/sample-floorplan.svg';
    const rev = d.latest_revision || 'R00';
    const revCount = d.revision_count || 1;
    const fileType = d.latest_file_type || 'PDF';

    return `
      <div class="drawing-card">
        <div class="drawing-preview-area" onclick="openLightbox('${d.name}', '${fileUrl}', '${fileType}', 'Rev ${rev} • ${d.category} • ${d.drawing_number || ''}')">
          <img class="drawing-preview-img" src="${fileUrl}" alt="${d.name}" loading="lazy">
          <span class="drawing-rev-badge">${rev}</span>
          <span class="drawing-type-pill">${fileType}</span>
        </div>

        <div class="drawing-card-body">
          <div>
            <h4 class="drawing-name">${d.name}</h4>
            <div class="drawing-number">${d.drawing_number ? d.drawing_number + ' • ' : ''}${d.category}</div>
            <div style="font-size: 11px; color: var(--arch-ink-muted); margin-bottom: 6px;">
              Latest note: <em>"${d.latest_note || 'Current architectural revision'}"</em>
            </div>
          </div>

          <div class="drawing-actions-row">
            <button class="btn btn-secondary btn-sm" onclick="viewDrawingRevisions(${d.id})">
              History (${revCount})
            </button>
            <div style="display: flex; gap: 4px;">
              <button class="btn btn-blueprint btn-sm" onclick="openAddRevisionModal(${d.id}, '${d.name}', '${rev}')">
                + Rev
              </button>
              <button class="btn btn-secondary btn-sm" style="color: var(--arch-rose);" onclick="deleteDrawingRecord(${d.id})">
                🗑
              </button>
            </div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

async function viewDrawingRevisions(drawingId) {
  try {
    const data = await apiRequest(`/drawings/${drawingId}/revisions`);
    document.getElementById('history-modal-title').textContent = `${data.name} — Revision History`;
    const container = document.getElementById('history-revisions-container');

    container.innerHTML = data.revisions.map((r, idx) => `
      <div class="revision-item">
        <div class="revision-header">
          <span class="rev-code">${r.revision_code} ${idx === 0 ? '<span style="font-size: 10px; background: var(--arch-blueprint); color: #fff; padding: 2px 6px; border-radius: 4px;">LATEST</span>' : ''}</span>
          <span style="font-family: var(--font-mono); font-size: 11px; color: var(--arch-ink-muted);">${formatDate(r.revision_date)}</span>
        </div>
        <div style="font-size: 13px; color: var(--arch-ink); font-weight: 500; margin: 4px 0;">
          ${r.revision_note || 'Revision update'}
        </div>
        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 8px;">
          <span style="font-size: 11px; color: var(--arch-ink-muted);">${r.file_name || 'drawing.pdf'} (${r.file_type || 'PDF'})</span>
          <button class="btn btn-secondary btn-sm" onclick="openLightbox('${data.name} (${r.revision_code})', '${r.file_url}', '${r.file_type}', '${r.revision_note}')">
            Preview
          </button>
        </div>
      </div>
    `).join('');

    openModal('modal-rev-history');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= IMAGES & SITE TIMELINE =================
async function loadProjectImages(projectId) {
  try {
    const timeline = await apiRequest(`/projects/${projectId}/timeline?sort=ASC`);
    renderSiteTimeline(timeline);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderSiteTimeline(images) {
  const container = document.getElementById('ws-timeline-entries-list');
  let filtered = images;
  if (state.imageCategoryFilter !== 'All') {
    filtered = images.filter(img => img.category === state.imageCategoryFilter);
  }

  if (!filtered || filtered.length === 0) {
    container.innerHTML = `
      <div style="padding: 30px; text-align: center; background: var(--arch-card-subtle); border: 1px dashed var(--arch-border); border-radius: var(--radius-lg);">
        <p style="color: var(--arch-ink-muted);">No site photographs or progress milestones logged yet.</p>
        <button class="btn btn-primary btn-sm" onclick="openUploadImageModal()" style="margin-top: 10px;">+ Add Site Photo</button>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(img => `
    <div class="timeline-entry">
      <div class="timeline-dot"></div>
      <div class="timeline-card">
        <div class="timeline-img-box" onclick="openLightbox('${img.title}', '${img.file_url}', 'PHOTO', '${formatDate(img.date)} • ${img.location_area || ''} • ${img.description || ''}')">
          <img src="${img.file_url}" alt="${img.title}" loading="lazy">
        </div>
        <div class="timeline-meta-box">
          <div class="timeline-date-stamp">
            <span>📅 ${formatDate(img.date)}</span>
            <span>•</span>
            <span class="badge-type" style="font-size: 10px; padding: 1px 6px;">${img.category}</span>
          </div>
          <h4 class="timeline-title">${img.title}</h4>
          ${img.location_area ? `<div style="font-size: 11px; color: var(--arch-ink-muted); margin-bottom: 6px;">📍 ${img.location_area}</div>` : ''}
          <p style="font-size: 13px; color: var(--arch-ink-secondary); line-height: 1.4;">${img.description || ''}</p>
          
          <div style="display: flex; justify-content: flex-end; margin-top: 10px;">
            <button class="btn btn-secondary btn-sm" style="color: var(--arch-rose);" onclick="deleteProjectPhoto(${img.id})">
              Delete
            </button>
          </div>
        </div>
      </div>
    </div>
  `).join('');
}

// ================= CLIENTS RENDERING =================
function renderClients() {
  const container = document.getElementById('clients-cards-container');
  const search = (document.getElementById('client-search-input')?.value || '').toLowerCase();
  
  let list = state.clients;
  if (search) {
    list = list.filter(c => 
      c.name.toLowerCase().includes(search) ||
      (c.phone && c.phone.toLowerCase().includes(search)) ||
      (c.email && c.email.toLowerCase().includes(search)) ||
      (c.company_name && c.company_name.toLowerCase().includes(search))
    );
  }

  if (!list || list.length === 0) {
    container.innerHTML = `
      <div style="grid-column: 1 / -1; padding: 40px; text-align: center; background: var(--arch-paper); border: 1px dashed var(--arch-border); border-radius: var(--radius-lg);">
        <p style="color: var(--arch-ink-muted);">No clients found.</p>
        <button class="btn btn-primary btn-sm" onclick="openNewClientModal()" style="margin-top: 10px;">+ Add Client</button>
      </div>
    `;
    return;
  }

  container.innerHTML = list.map(c => {
    const initials = c.name.split(' ').map(n => n[0]).join('').substring(0, 2).toUpperCase();
    const relatedProjects = state.projects.filter(p => p.client_id === c.id);

    return `
      <div class="client-card">
        <div>
          <div class="client-header">
            <div class="client-avatar">${initials}</div>
            <div>
              <h3 class="client-name">${c.name}</h3>
              <div class="client-company">${c.company_name || 'Independent Client'}</div>
            </div>
          </div>

          <div style="font-size: 12px; color: var(--arch-ink-secondary); display: flex; flex-direction: column; gap: 4px; margin-bottom: 12px;">
            ${c.phone ? `<div>📞 ${c.phone}</div>` : ''}
            ${c.email ? `<div>✉️ ${c.email}</div>` : ''}
            ${c.address ? `<div>📍 ${c.address}</div>` : ''}
          </div>

          <!-- Associated Projects List -->
          <div class="info-label" style="margin-bottom: 6px;">Connected Projects (${relatedProjects.length})</div>
          <div class="client-projects-pills">
            ${relatedProjects.length > 0 ? relatedProjects.map(p => `
              <div class="client-project-pill" style="cursor: pointer;" onclick="openProjectWorkspace(${p.id})">
                <span style="font-weight: 600;">${p.name}</span>
                <span class="badge-type" style="font-size: 10px;">${p.project_type_name}</span>
              </div>
            `).join('') : '<div style="font-size: 11px; color: var(--arch-ink-muted);">No active projects yet.</div>'}
          </div>
        </div>

        <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--arch-border-light);">
          <button class="btn btn-secondary btn-sm" onclick="openEditClientModal(${c.id})">Edit Profile</button>
          <button class="btn btn-secondary btn-sm" style="color: var(--arch-rose);" onclick="deleteClientRecord(${c.id})">Delete</button>
        </div>
      </div>
    `;
  }).join('');
}

// ================= ACCOUNTS HUB RENDERING =================
async function loadAccountsSummary() {
  try {
    const data = await apiRequest('/accounts/summary');
    const payments = await apiRequest('/payments');

    document.getElementById('acc-global-deal').textContent = formatINR(data.total_deal);
    document.getElementById('acc-global-received').textContent = formatINR(data.total_received);
    document.getElementById('acc-global-balance').textContent = formatINR(data.total_balance);

    // Project breakdown table
    const pBody = document.getElementById('acc-projects-breakdown-tbody');
    if (data.project_accounts && data.project_accounts.length > 0) {
      pBody.innerHTML = data.project_accounts.map(pa => `
        <tr>
          <td><strong style="cursor: pointer; color: var(--arch-blueprint);" onclick="openProjectWorkspace(${pa.id})">${pa.project_name}</strong></td>
          <td>${pa.client_name}</td>
          <td><span class="badge-type">${pa.project_type_name}</span></td>
          <td style="font-family: var(--font-mono);">${formatINR(pa.deal_amount)}</td>
          <td style="font-family: var(--font-mono); color: var(--arch-sage); font-weight: 600;">${formatINR(pa.received_amount)}</td>
          <td style="font-family: var(--font-mono); color: var(--arch-terracotta); font-weight: 700;">${formatINR(pa.balance_amount)}</td>
          <td>
            <button class="btn btn-blueprint btn-sm" onclick="openQuickReceiveModal(${pa.id})">+ Receive</button>
          </td>
        </tr>
      `).join('');
    } else {
      pBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--arch-ink-muted); padding: 20px;">No projects found.</td></tr>`;
    }

    // Full payments table
    const fBody = document.getElementById('acc-full-payments-tbody');
    if (payments && payments.length > 0) {
      fBody.innerHTML = payments.map(pmt => `
        <tr>
          <td style="font-family: var(--font-mono);">${formatDate(pmt.payment_date)}</td>
          <td><strong>${pmt.project_name}</strong></td>
          <td>${pmt.client_name}</td>
          <td style="font-family: var(--font-mono); font-weight: 700; color: var(--arch-sage);">${formatINR(pmt.amount)}</td>
          <td><span class="method-tag">${pmt.payment_method}</span></td>
          <td style="font-size: 12px; color: var(--arch-ink-secondary);">${pmt.reference_note || '—'}</td>
          <td>
            <button class="btn btn-danger btn-sm" onclick="deletePaymentRecord(${pmt.id})">Delete</button>
          </td>
        </tr>
      `).join('');
    } else {
      fBody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--arch-ink-muted); padding: 20px;">No payments recorded yet.</td></tr>`;
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= SETTINGS & PROJECT TYPES =================
function renderSettingsProjectTypes() {
  const container = document.getElementById('settings-types-list');
  if (!container) return;

  container.innerHTML = state.projectTypes.map(t => `
    <div style="display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; background: var(--arch-paper); border: 1px solid var(--arch-border); border-radius: var(--radius-pill); font-size: 12px; font-weight: 600;">
      <span style="width: 8px; height: 8px; border-radius: 50%; background: ${t.badge_color || '#2563eb'};"></span>
      <span>${t.name}</span>
      <span style="font-size: 10px; color: var(--arch-ink-muted); font-weight: 500;">(${t.project_count || 0} projects)</span>
      ${t.is_default ? '' : `
        <button style="background: none; border: none; color: var(--arch-rose); cursor: pointer; font-size: 12px; padding: 0 2px;" onclick="deleteProjectTypeRecord(${t.id})">✕</button>
      `}
    </div>
  `).join('');
}

// ================= MODALS & FORMS LOGIC =================
function initModals() {
  // Close buttons
  document.querySelectorAll('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => {
      const modalId = btn.dataset.close;
      closeModal(modalId);
    });
  });

  // Close on backdrop click
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('open');
      }
    });
  });
}

function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('open');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('open');
}

function populateProjectTypesSelects() {
  const selects = ['proj-type', 'filter-project-type'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isFilter = id.startsWith('filter');
    el.innerHTML = (isFilter ? '<option value="">All Project Types</option>' : '') +
      state.projectTypes.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
  });
}

function populateClientsSelects() {
  const selects = ['proj-client', 'filter-project-client'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const isFilter = id.startsWith('filter');
    el.innerHTML = (isFilter ? '<option value="">All Clients</option>' : '') +
      state.clients.map(c => `<option value="${c.id}">${c.name} (${c.company_name || 'Individual'})</option>`).join('');
  });
}

// Open New Project Modal
function openNewProjectModal() {
  document.getElementById('modal-project-title').textContent = 'Create New Project';
  document.getElementById('proj-edit-id').value = '';
  document.getElementById('form-project').reset();
  openModal('modal-project');
}

// Open Edit Project Modal
function openEditProjectModal(projectId) {
  const p = state.activeProject || state.projects.find(x => x.id === projectId);
  if (!p) return;

  document.getElementById('modal-project-title').textContent = 'Edit Project Details';
  document.getElementById('proj-edit-id').value = p.id;
  document.getElementById('proj-name').value = p.name;
  document.getElementById('proj-client').value = p.client_id;
  document.getElementById('proj-type').value = p.project_type_id;
  document.getElementById('proj-location').value = p.location;
  document.getElementById('proj-status').value = p.status;
  document.getElementById('proj-start-date').value = p.start_date || '';
  document.getElementById('proj-end-date').value = p.expected_completion_date || '';
  document.getElementById('proj-fee').value = p.total_fee || 0;
  document.getElementById('proj-notes').value = p.notes || '';

  openModal('modal-project');
}

// Open New Client Modal
function openNewClientModal() {
  document.getElementById('modal-client-title').textContent = 'Add New Client';
  document.getElementById('client-edit-id').value = '';
  document.getElementById('form-client').reset();
  openModal('modal-client');
}

// Open Edit Client Modal
function openEditClientModal(clientId) {
  const c = state.clients.find(x => x.id === clientId);
  if (!c) return;

  document.getElementById('modal-client-title').textContent = 'Edit Client Profile';
  document.getElementById('client-edit-id').value = c.id;
  document.getElementById('client-name').value = c.name;
  document.getElementById('client-phone').value = c.phone || '';
  document.getElementById('client-email').value = c.email || '';
  document.getElementById('client-company').value = c.company_name || '';
  document.getElementById('client-address').value = c.address || '';
  document.getElementById('client-notes').value = c.notes || '';

  openModal('modal-client');
}

// Open Receive Payment Modal
function openReceivePaymentModal(defaultProjectId = null) {
  const projSelect = document.getElementById('pay-project');
  projSelect.innerHTML = state.projects.map(p => `
    <option value="${p.id}" ${p.id === defaultProjectId ? 'selected' : ''}>${p.name} — ${p.client_name}</option>
  `).join('');

  document.getElementById('pay-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('pay-amount').value = '';
  document.getElementById('pay-reference').value = '';

  updatePaymentModalProjectSummary();
  openModal('modal-payment');
}

function openQuickReceiveModal(projectId) {
  openReceivePaymentModal(projectId);
}

function updatePaymentModalProjectSummary() {
  const pid = parseInt(document.getElementById('pay-project').value, 10);
  const p = state.projects.find(x => x.id === pid);
  const box = document.getElementById('pay-project-summary-box');
  if (p) {
    box.style.display = 'block';
    document.getElementById('pay-box-fee').textContent = formatINR(p.total_fee);
    document.getElementById('pay-box-received').textContent = formatINR(p.received_amount);
    document.getElementById('pay-box-balance').textContent = formatINR(p.balance_amount);
  } else {
    box.style.display = 'none';
  }
}

// Open Upload Drawing Modal
function openUploadDrawingModal() {
  document.getElementById('form-drawing').reset();
  document.getElementById('draw-file-name-display').textContent = 'Click to browse drawing file';
  openModal('modal-drawing');
}

// Open Add Revision Modal
function openAddRevisionModal(drawingId, drawingName, currentRev) {
  document.getElementById('rev-drawing-id').value = drawingId;
  document.getElementById('rev-drawing-title-display').textContent = `${drawingName} (Current: ${currentRev})`;
  
  // Suggest next rev code e.g. R01 -> R02
  let nextRev = 'R01';
  if (currentRev && currentRev.startsWith('R')) {
    const num = parseInt(currentRev.substring(1), 10);
    if (!isNaN(num)) nextRev = 'R' + String(num + 1).padStart(2, '0');
  }
  document.getElementById('rev-code-input').value = nextRev;
  document.getElementById('rev-date-input').value = new Date().toISOString().split('T')[0];
  document.getElementById('rev-note-input').value = '';
  document.getElementById('rev-file-name-display').textContent = 'Click to browse revised file';

  openModal('modal-revision');
}

// Open Upload Image Modal
function openUploadImageModal() {
  document.getElementById('form-image').reset();
  document.getElementById('img-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('img-file-name-display').textContent = 'Click to select photo';
  openModal('modal-image');
}

// Open Lightbox
function openLightbox(title, imgUrl, badge, metaText) {
  document.getElementById('lightbox-title').textContent = title;
  document.getElementById('lightbox-img').src = imgUrl;
  document.getElementById('lightbox-badge').textContent = badge;
  document.getElementById('lightbox-meta').textContent = metaText || '';
  document.getElementById('lightbox-download-link').href = imgUrl;
  openModal('modal-lightbox');
}

// ================= CRUD API DISPATCHERS =================

// Save Project (Create / Update)
async function handleSaveProject(e) {
  e.preventDefault();
  const id = document.getElementById('proj-edit-id').value;
  const payload = {
    name: document.getElementById('proj-name').value,
    client_id: document.getElementById('proj-client').value,
    project_type_id: document.getElementById('proj-type').value,
    location: document.getElementById('proj-location').value,
    status: document.getElementById('proj-status').value,
    start_date: document.getElementById('proj-start-date').value,
    expected_completion_date: document.getElementById('proj-end-date').value,
    total_fee: document.getElementById('proj-fee').value,
    notes: document.getElementById('proj-notes').value
  };

  try {
    if (id) {
      await apiRequest(`/projects/${id}`, { method: 'PUT', body: payload });
      showToast('Project updated successfully', 'success');
      if (state.activeProjectId === parseInt(id, 10)) {
        await openProjectWorkspace(id);
      }
    } else {
      const res = await apiRequest('/projects', { method: 'POST', body: payload });
      showToast('Project created successfully', 'success');
      openProjectWorkspace(res.id);
    }
    closeModal('modal-project');
    loadProjects();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Save Client (Create / Update)
async function handleSaveClient(e) {
  e.preventDefault();
  const id = document.getElementById('client-edit-id').value;
  const payload = {
    name: document.getElementById('client-name').value,
    phone: document.getElementById('client-phone').value,
    email: document.getElementById('client-email').value,
    company_name: document.getElementById('client-company').value,
    address: document.getElementById('client-address').value,
    notes: document.getElementById('client-notes').value
  };

  try {
    if (id) {
      await apiRequest(`/clients/${id}`, { method: 'PUT', body: payload });
      showToast('Client updated successfully', 'success');
    } else {
      await apiRequest('/clients', { method: 'POST', body: payload });
      showToast('Client registered successfully', 'success');
    }
    closeModal('modal-client');
    loadClients();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete Client
async function deleteClientRecord(clientId) {
  if (!confirm('Are you sure you want to delete this client?')) return;
  try {
    await apiRequest(`/clients/${clientId}`, { method: 'DELETE' });
    showToast('Client deleted', 'success');
    loadClients();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Save Payment
async function handleSavePayment(e) {
  e.preventDefault();
  const projectId = document.getElementById('pay-project').value;
  const amount = document.getElementById('pay-amount').value;
  const paymentDate = document.getElementById('pay-date').value;
  const paymentMethod = document.getElementById('pay-method').value;
  const referenceNote = document.getElementById('pay-reference').value;

  try {
    const res = await apiRequest('/payments', {
      method: 'POST',
      body: {
        project_id: projectId,
        amount,
        payment_date: paymentDate,
        payment_method: paymentMethod,
        reference_note: referenceNote
      }
    });

    showToast(`Payment of ${formatINR(amount)} recorded!`, 'success');
    closeModal('modal-payment');

    // Live refresh
    if (state.activeProjectId === parseInt(projectId, 10)) {
      openProjectWorkspace(projectId);
    }
    loadProjects();
    loadDashboardStats();
    if (state.currentNav === 'accounts') loadAccountsSummary();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete Payment
async function deletePaymentRecord(paymentId) {
  if (!confirm('Are you sure you want to delete this payment entry? Balance will automatically recalculate.')) return;
  try {
    await apiRequest(`/payments/${paymentId}`, { method: 'DELETE' });
    showToast('Payment deleted & balance recalculated', 'success');
    if (state.activeProjectId) {
      openProjectWorkspace(state.activeProjectId);
    }
    loadProjects();
    loadDashboardStats();
    if (state.currentNav === 'accounts') loadAccountsSummary();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Save Drawing
async function handleSaveDrawing(e) {
  e.preventDefault();
  if (!state.activeProjectId) return;

  const formData = new FormData();
  formData.append('name', document.getElementById('draw-name').value);
  formData.append('drawing_number', document.getElementById('draw-number').value);
  formData.append('category', document.getElementById('draw-category').value);
  formData.append('revision_code', document.getElementById('draw-rev-code').value);
  formData.append('revision_note', document.getElementById('draw-rev-note').value);
  formData.append('description', document.getElementById('draw-desc').value);

  const fileInput = document.getElementById('draw-file-input');
  if (fileInput.files.length > 0) {
    formData.append('file', fileInput.files[0]);
  } else {
    // Select sample CAD asset based on category
    const cat = document.getElementById('draw-category').value;
    if (cat === 'Elevations') formData.append('preset_asset', '/assets/sample-elevation.svg');
    else if (cat === 'Sections') formData.append('preset_asset', '/assets/sample-section.svg');
    else formData.append('preset_asset', '/assets/sample-floorplan.svg');
  }

  try {
    await apiRequest(`/projects/${state.activeProjectId}/drawings`, {
      method: 'POST',
      body: formData
    });
    showToast('Drawing uploaded successfully', 'success');
    closeModal('modal-drawing');
    loadProjectDrawings(state.activeProjectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Save Drawing Revision
async function handleSaveRevision(e) {
  e.preventDefault();
  const drawingId = document.getElementById('rev-drawing-id').value;

  const formData = new FormData();
  formData.append('revision_code', document.getElementById('rev-code-input').value);
  formData.append('revision_date', document.getElementById('rev-date-input').value);
  formData.append('revision_note', document.getElementById('rev-note-input').value);

  const fileInput = document.getElementById('rev-file-input');
  if (fileInput.files.length > 0) {
    formData.append('file', fileInput.files[0]);
  }

  try {
    await apiRequest(`/drawings/${drawingId}/revisions`, {
      method: 'POST',
      body: formData
    });
    showToast('New drawing revision recorded', 'success');
    closeModal('modal-revision');
    loadProjectDrawings(state.activeProjectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete Drawing
async function deleteDrawingRecord(drawingId) {
  if (!confirm('Are you sure you want to delete this drawing and all historical revisions?')) return;
  try {
    await apiRequest(`/drawings/${drawingId}`, { method: 'DELETE' });
    showToast('Drawing deleted', 'success');
    loadProjectDrawings(state.activeProjectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Save Image to Site Timeline
async function handleSaveImage(e) {
  e.preventDefault();
  if (!state.activeProjectId) return;

  const formData = new FormData();
  formData.append('title', document.getElementById('img-title').value);
  formData.append('date', document.getElementById('img-date').value);
  formData.append('category', document.getElementById('img-category').value);
  formData.append('location_area', document.getElementById('img-location').value);
  formData.append('description', document.getElementById('img-desc').value);

  const fileInput = document.getElementById('img-file-input');
  if (fileInput.files.length > 0) {
    formData.append('file', fileInput.files[0]);
  } else {
    // Pick realistic preset image based on category
    const cat = document.getElementById('img-category').value;
    if (cat === 'Progress') formData.append('preset_asset', '/assets/columns.svg');
    else if (cat === 'Design') formData.append('preset_asset', '/assets/concept_render.svg');
    else formData.append('preset_asset', '/assets/site_excavation.svg');
  }

  try {
    await apiRequest(`/projects/${state.activeProjectId}/images`, {
      method: 'POST',
      body: formData
    });
    showToast('Photo added to project progress timeline', 'success');
    closeModal('modal-image');
    loadProjectImages(state.activeProjectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete Site Photo
async function deleteProjectPhoto(imageId) {
  if (!confirm('Are you sure you want to delete this site photo?')) return;
  try {
    await apiRequest(`/images/${imageId}`, { method: 'DELETE' });
    showToast('Photo removed from timeline', 'success');
    loadProjectImages(state.activeProjectId);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Add Custom Project Type
async function handleAddProjectType(e) {
  e.preventDefault();
  const name = document.getElementById('type-name-input').value;
  const color = document.getElementById('type-color-input').value;

  try {
    await apiRequest('/project-types', {
      method: 'POST',
      body: { name, color }
    });
    showToast(`Project type "${name}" created`, 'success');
    closeModal('modal-type');
    document.getElementById('form-type').reset();
    loadProjectTypes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete Custom Project Type
async function deleteProjectTypeRecord(typeId) {
  if (!confirm('Are you sure you want to delete this custom project type?')) return;
  try {
    await apiRequest(`/project-types/${typeId}`, { method: 'DELETE' });
    showToast('Project type deleted', 'success');
    loadProjectTypes();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Change Project Status directly from workspace dropdown
async function handleWorkspaceStatusChange(newStatus) {
  if (!state.activeProjectId) return;
  try {
    await apiRequest(`/projects/${state.activeProjectId}/status`, {
      method: 'PATCH',
      body: { status: newStatus }
    });
    showToast(`Project status moved to ${newStatus}`, 'success');
    loadProjects();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Delete Project
async function handleDeleteCurrentProject() {
  if (!state.activeProjectId) return;
  if (!confirm('Are you sure you want to permanently delete this project, including its drawings, images, and payments?')) return;
  try {
    await apiRequest(`/projects/${state.activeProjectId}`, { method: 'DELETE' });
    showToast('Project deleted', 'success');
    switchNav('projects');
    loadProjects();
    loadDashboardStats();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ================= EVENT LISTENERS BINDING =================
function initEventListeners() {
  // Login Form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const remember = document.getElementById('remember-me').checked;

    try {
      const res = await apiRequest('/auth/login', {
        method: 'POST',
        body: { email, password }
      });

      state.token = res.token;
      state.user = res.user;

      // Always save in localStorage when remember is checked (default)
      if (remember) {
        localStorage.setItem('archidesk_token', res.token);
      } else {
        sessionStorage.setItem('archidesk_token', res.token);
      }

      showToast(`Welcome back, ${res.user.name}`, 'success');
      showApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Registration Form Submit
  document.getElementById('register-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const name = document.getElementById('reg-name').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const studio_name = document.getElementById('reg-studio').value.trim();
    const role = document.getElementById('reg-role').value.trim();

    try {
      const res = await apiRequest('/auth/register', {
        method: 'POST',
        body: { name, email, password, studio_name, role }
      });

      state.token = res.token;
      state.user = res.user;
      localStorage.setItem('archidesk_token', res.token);

      showToast(`Welcome to SHASWAT DESIGNS, ${res.user.name}!`, 'success');
      showApp();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Auth Tabs Switcher
  const tabLogin = document.getElementById('tab-auth-login');
  const tabRegister = document.getElementById('tab-auth-register');
  const formLogin = document.getElementById('login-form');
  const formRegister = document.getElementById('register-form');

  function switchToRegister() {
    formLogin.style.display = 'none';
    formRegister.style.display = 'block';
    tabLogin.classList.remove('active');
    tabRegister.classList.add('active');
  }

  function switchToLogin() {
    formRegister.style.display = 'none';
    formLogin.style.display = 'block';
    tabRegister.classList.remove('active');
    tabLogin.classList.add('active');
  }

  tabLogin.addEventListener('click', switchToLogin);
  tabRegister.addEventListener('click', switchToRegister);

  document.getElementById('link-switch-to-register').addEventListener('click', (e) => {
    e.preventDefault();
    const emailVal = document.getElementById('login-email').value;
    if (emailVal) document.getElementById('reg-email').value = emailVal;
    switchToRegister();
  });

  document.getElementById('link-switch-to-login').addEventListener('click', (e) => {
    e.preventDefault();
    switchToLogin();
  });

  // Demo auto-fill
  document.getElementById('quick-demo-fill').addEventListener('click', () => {
    document.getElementById('login-email').value = 'architect@archidesk.com';
    document.getElementById('login-password').value = 'studio2026';
    showToast('Demo architect credentials filled', 'success');
  });

  // Logout button
  document.getElementById('logout-btn').addEventListener('click', logout);

  // Bottom Navigation tabs
  document.querySelectorAll('.bottom-nav .nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      switchNav(item.dataset.nav);
    });
  });

  // Top header drafting grid toggle
  document.getElementById('toggle-grid-btn').addEventListener('click', () => {
    state.isGridActive = !state.isGridActive;
    document.body.classList.toggle('drafting-grid-active', state.isGridActive);
    document.getElementById('toggle-grid-btn').classList.toggle('active', state.isGridActive);
    showToast(state.isGridActive ? 'Architectural drafting grid enabled' : 'Clean layout enabled', 'success');
  });

  // Device frame toggle (Mobile Frame vs Studio Desktop)
  document.getElementById('toggle-frame-btn').addEventListener('click', () => {
    state.isMobileFrame = !state.isMobileFrame;
    document.body.classList.toggle('mode-mobile-frame', state.isMobileFrame);
    document.getElementById('toggle-frame-btn').classList.toggle('active', state.isMobileFrame);
    document.getElementById('frame-btn-text').textContent = state.isMobileFrame ? 'Studio View' : 'Mobile View';
    showToast(state.isMobileFrame ? 'Mobile Phone Frame Mode' : 'Desktop Studio Mode', 'success');
  });

  // Dashboard quick triggers
  document.getElementById('dash-card-projects').addEventListener('click', () => switchNav('projects'));
  document.getElementById('dash-card-clients').addEventListener('click', () => switchNav('clients'));
  document.getElementById('dash-card-accounts').addEventListener('click', () => switchNav('accounts'));
  document.getElementById('dash-new-project-btn').addEventListener('click', openNewProjectModal);
  document.getElementById('action-quick-project').addEventListener('click', openNewProjectModal);
  document.getElementById('action-quick-client').addEventListener('click', openNewClientModal);
  document.getElementById('action-quick-payment').addEventListener('click', () => openReceivePaymentModal());
  document.getElementById('action-quick-manage-types').addEventListener('click', () => switchNav('settings'));
  document.getElementById('dash-view-all-projects').addEventListener('click', () => switchNav('projects'));
  document.getElementById('dash-view-all-accounts').addEventListener('click', () => switchNav('accounts'));

  // Projects View Triggers
  document.getElementById('projects-add-btn').addEventListener('click', openNewProjectModal);
  
  // Category tabs: All, Active, Pre-Planning, Completed
  document.querySelectorAll('.cat-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      state.filters.status = tab.dataset.status;
      loadProjects();
    });
  });

  // Search input with debounce
  let searchTimer;
  document.getElementById('project-search-input').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.search = e.target.value.trim();
      loadProjects();
    }, 250);
  });

  document.getElementById('filter-project-type').addEventListener('change', (e) => {
    state.filters.type = e.target.value;
    loadProjects();
  });

  document.getElementById('filter-project-client').addEventListener('change', (e) => {
    state.filters.client = e.target.value;
    loadProjects();
  });

  document.getElementById('filter-project-location').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      state.filters.location = e.target.value.trim();
      loadProjects();
    }, 300);
  });

  document.getElementById('reset-project-filters').addEventListener('click', () => {
    state.filters = { status: '', type: '', client: '', location: '', search: '' };
    document.getElementById('project-search-input').value = '';
    document.getElementById('filter-project-type').value = '';
    document.getElementById('filter-project-client').value = '';
    document.getElementById('filter-project-location').value = '';
    document.querySelectorAll('.cat-tab').forEach(t => t.classList.remove('active'));
    document.querySelector('.cat-tab[data-status=""]').classList.add('active');
    loadProjects();
  });

  // Workspace back button
  document.getElementById('btn-back-to-projects').addEventListener('click', () => switchNav('projects'));
  document.getElementById('ws-edit-project-btn').addEventListener('click', () => openEditProjectModal(state.activeProjectId));
  document.getElementById('ws-delete-project-btn').addEventListener('click', handleDeleteCurrentProject);

  // Workspace status switcher
  document.getElementById('ws-status-selector').addEventListener('change', (e) => {
    handleWorkspaceStatusChange(e.target.value);
  });

  // Workspace tabs
  document.querySelectorAll('.workspace-nav-tabs .ws-tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchWorkspaceTab(btn.dataset.tab));
  });

  // Overview quick action
  document.getElementById('ws-quick-receive-payment-btn').addEventListener('click', () => openReceivePaymentModal(state.activeProjectId));
  document.getElementById('btn-add-payment-modal').addEventListener('click', () => openReceivePaymentModal(state.activeProjectId));
  document.getElementById('accounts-receive-btn').addEventListener('click', () => openReceivePaymentModal());

  // Drawings buttons
  document.getElementById('btn-upload-drawing-modal').addEventListener('click', openUploadDrawingModal);
  document.getElementById('ws-drawing-category-filter').addEventListener('change', (e) => {
    state.drawingCategoryFilter = e.target.value;
    loadProjectDrawings(state.activeProjectId);
  });

  // Images buttons
  document.getElementById('btn-upload-image-modal').addEventListener('click', openUploadImageModal);
  document.getElementById('ws-images-category-filter').addEventListener('change', (e) => {
    state.imageCategoryFilter = e.target.value;
    loadProjectImages(state.activeProjectId);
  });

  // Client view triggers
  document.getElementById('btn-add-client-modal').addEventListener('click', openNewClientModal);
  document.getElementById('client-search-input').addEventListener('input', renderClients);

  // Settings triggers
  document.getElementById('btn-add-custom-type-modal').addEventListener('click', () => openModal('modal-type'));

  // File dropzone text updates
  document.getElementById('draw-file-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      document.getElementById('draw-file-name-display').textContent = `Selected: ${e.target.files[0].name}`;
    }
  });

  document.getElementById('rev-file-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      document.getElementById('rev-file-name-display').textContent = `Selected: ${e.target.files[0].name}`;
    }
  });

  document.getElementById('img-file-input').addEventListener('change', (e) => {
    if (e.target.files.length > 0) {
      document.getElementById('img-file-name-display').textContent = `Selected: ${e.target.files[0].name}`;
    }
  });

  // Payment project change
  document.getElementById('pay-project').addEventListener('change', updatePaymentModalProjectSummary);

  // Profile modal buttons
  function openProfileModal() {
    if (!state.user) return;
    document.getElementById('profile-name').value = state.user.name || 'Er. Shivansh';
    document.getElementById('profile-studio').value = state.user.studio_name || 'SHASWAT DESIGNS';
    document.getElementById('profile-email').value = state.user.email || '';
    document.getElementById('profile-role').value = state.user.role || 'Principal Architect';
    openModal('modal-profile');
  }

  async function handleSaveProfile(e) {
    e.preventDefault();
    const name = document.getElementById('profile-name').value.trim();
    const studio_name = document.getElementById('profile-studio').value.trim();
    const email = document.getElementById('profile-email').value.trim();
    const role = document.getElementById('profile-role').value.trim();

    try {
      const res = await apiRequest('/auth/profile', {
        method: 'PUT',
        body: { name, studio_name, email, role }
      });

      state.user = res.user;
      updateUserDisplay();
      closeModal('modal-profile');
      showToast(`Profile updated: ${state.user.name} (${state.user.studio_name})`, 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  const btnHeaderProfile = document.getElementById('btn-header-profile');
  if (btnHeaderProfile) btnHeaderProfile.addEventListener('click', openProfileModal);

  const btnDashProfile = document.getElementById('btn-dash-edit-profile');
  if (btnDashProfile) btnDashProfile.addEventListener('click', openProfileModal);

  const btnSettingsProfile = document.getElementById('btn-settings-edit-profile');
  if (btnSettingsProfile) btnSettingsProfile.addEventListener('click', openProfileModal);

  const formProfile = document.getElementById('form-profile');
  if (formProfile) formProfile.addEventListener('submit', handleSaveProfile);

  // Forms submit handlers
  document.getElementById('form-project').addEventListener('submit', handleSaveProject);
  document.getElementById('form-client').addEventListener('submit', handleSaveClient);
  document.getElementById('form-payment').addEventListener('submit', handleSavePayment);
  document.getElementById('form-drawing').addEventListener('submit', handleSaveDrawing);
  document.getElementById('form-revision').addEventListener('submit', handleSaveRevision);
  document.getElementById('form-image').addEventListener('submit', handleSaveImage);
  document.getElementById('form-type').addEventListener('submit', handleAddProjectType);
}
