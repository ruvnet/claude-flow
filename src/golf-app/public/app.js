let token = localStorage.getItem('gm_token');
let currentUser = null;
let pendingReceiverId = null;
let searchDebounceTimer = null;
let profileCourses = [];
let connectionsData = { sent: [], received: [] };

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function init() {
  token = localStorage.getItem('gm_token');
  if (token) {
    try {
      currentUser = await api('GET', '/api/me');
      showApp();
    } catch {
      localStorage.removeItem('gm_token');
      showAuthScreen();
    }
  } else {
    showAuthScreen();
  }
}

// ─── API ──────────────────────────────────────────────────────────────────────

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (token) opts.headers['Authorization'] = `Bearer ${token}`;
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(path, opts);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Something went wrong');
  return data;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function showAuthScreen() {
  document.getElementById('auth-screen').classList.remove('hidden');
  document.getElementById('app').classList.add('hidden');
}

function showApp() {
  document.getElementById('auth-screen').classList.add('hidden');
  document.getElementById('app').classList.remove('hidden');
  document.getElementById('user-greeting').textContent = `Hi, ${currentUser.name.split(' ')[0]}!`;
  showPage('discover');
  checkConnectionBadge();
}

function showLogin(e) {
  e && e.preventDefault();
  document.getElementById('login-form').classList.remove('hidden');
  document.getElementById('register-form').classList.add('hidden');
}

function showRegister(e) {
  e && e.preventDefault();
  document.getElementById('register-form').classList.remove('hidden');
  document.getElementById('login-form').classList.add('hidden');
}

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  errEl.classList.add('hidden');

  if (!email || !password) {
    errEl.textContent = 'Please enter your email and password';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const data = await api('POST', '/api/auth/login', { email, password });
    token = data.token;
    localStorage.setItem('gm_token', token);
    currentUser = await api('GET', '/api/me');
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

async function register() {
  const name = document.getElementById('reg-name').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const password = document.getElementById('reg-password').value;
  const city = document.getElementById('reg-city').value.trim();
  const state = document.getElementById('reg-state').value.trim().toUpperCase();
  const handicap = parseFloat(document.getElementById('reg-handicap').value) || 0;
  const errEl = document.getElementById('reg-error');
  errEl.classList.add('hidden');

  if (!name || !email || !password) {
    errEl.textContent = 'Name, email, and password are required';
    errEl.classList.remove('hidden');
    return;
  }

  try {
    const data = await api('POST', '/api/auth/register', { name, email, password, city, state, handicap });
    token = data.token;
    localStorage.setItem('gm_token', token);
    currentUser = await api('GET', '/api/me');
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

function logout() {
  token = null;
  currentUser = null;
  localStorage.removeItem('gm_token');
  showAuthScreen();
  showLogin();
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function showPage(page) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(`page-${page}`).classList.add('active');
  document.querySelector(`[data-page="${page}"]`).classList.add('active');

  if (page === 'discover') loadPlayers();
  if (page === 'profile') loadProfile();
  if (page === 'connections') loadConnections();
}

// ─── Discover ─────────────────────────────────────────────────────────────────

function debounceSearch() {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(loadPlayers, 400);
}

function clearFilters() {
  ['filter-city', 'filter-state', 'filter-min-handicap', 'filter-max-handicap'].forEach(id => {
    document.getElementById(id).value = '';
  });
  document.getElementById('filter-frequency').value = '';
  loadPlayers();
}

async function loadPlayers() {
  const city = document.getElementById('filter-city').value.trim();
  const state = document.getElementById('filter-state').value.trim();
  const minH = document.getElementById('filter-min-handicap').value;
  const maxH = document.getElementById('filter-max-handicap').value;
  const freq = document.getElementById('filter-frequency').value;

  const params = new URLSearchParams();
  if (city) params.set('city', city);
  if (state) params.set('state', state);
  if (minH !== '') params.set('min_handicap', minH);
  if (maxH !== '') params.set('max_handicap', maxH);
  if (freq) params.set('playing_frequency', freq);

  const grid = document.getElementById('players-grid');
  grid.innerHTML = '<div class="loading">Finding players...</div>';

  try {
    const [players, conns] = await Promise.all([
      api('GET', `/api/players?${params}`),
      api('GET', '/api/connections')
    ]);

    connectionsData = conns;
    const connMap = {};
    [...(conns.sent || []), ...(conns.received || [])].forEach(c => {
      const otherId = c.requester_id === currentUser.id ? c.receiver_id : c.requester_id;
      if (!connMap[otherId] || c.status === 'accepted') connMap[otherId] = c.status;
    });

    const countEl = document.getElementById('players-count');
    countEl.textContent = `${players.length} player${players.length !== 1 ? 's' : ''} found`;

    if (players.length === 0) {
      grid.innerHTML = '<div class="empty-state">No players found — try broadening your search filters.</div>';
      return;
    }

    grid.innerHTML = players.map(p => renderPlayerCard(p, connMap[p.id])).join('');
  } catch (err) {
    grid.innerHTML = `<div class="empty-state">Could not load players: ${esc(err.message)}</div>`;
  }
}

function renderPlayerCard(player, connectionStatus) {
  const initial = (player.name || '?').charAt(0).toUpperCase();
  const location = [player.city, player.state].filter(Boolean).join(', ');
  const courses = player.preferred_courses || [];

  const freqLabels = {
    daily: 'Daily', multiple_weekly: 'Multiple/wk', weekly: 'Weekly',
    biweekly: 'Biweekly', monthly: 'Monthly'
  };

  const skillLevel = player.skill_level || 'intermediate';
  const skillLabel = { beginner: 'Beginner', intermediate: 'Intermediate', advanced: 'Advanced', expert: 'Expert' }[skillLevel] || skillLevel;

  let footerHtml = '';
  if (!connectionStatus) {
    footerHtml = `<button class="btn btn-connect btn-sm" onclick="openConnectModal(${player.id}, '${esc(player.name).replace(/'/g, "\\'")}')">🤝 Connect</button>`;
  } else if (connectionStatus === 'pending') {
    footerHtml = `<span class="connection-status status-pending">Request Pending</span>`;
  } else if (connectionStatus === 'accepted') {
    footerHtml = `<span class="connection-status status-accepted">✓ Connected</span>`;
  } else if (connectionStatus === 'declined') {
    footerHtml = `<span class="connection-status status-declined">Declined</span>`;
  }

  return `
    <div class="player-card">
      <div class="player-card-header">
        <div style="display:flex;align-items:center;gap:12px;min-width:0">
          <div class="player-avatar">${initial}</div>
          <div style="min-width:0">
            <div class="player-name">${esc(player.name)}</div>
            ${location ? `<div class="player-location">📍 ${esc(location)}</div>` : ''}
          </div>
        </div>
        <div class="handicap-badge">
          <div class="hcp-label">HCP</div>
          <div class="hcp-value">${player.handicap != null ? Number(player.handicap).toFixed(1) : '—'}</div>
        </div>
      </div>

      ${player.bio ? `<div class="player-bio">${esc(player.bio)}</div>` : ''}

      <div class="player-meta">
        ${player.playing_frequency ? `<span class="meta-tag frequency">⏱ ${freqLabels[player.playing_frequency] || player.playing_frequency}</span>` : ''}
        <span class="meta-tag skill-${skillLevel}">⛳ ${skillLabel}</span>
      </div>

      ${courses.length > 0 ? `
        <div class="player-courses">
          <div class="courses-label">Plays at</div>
          ${courses.slice(0, 3).map(c => `<div class="course-item">🏌️ ${esc(c.name || c)}</div>`).join('')}
          ${courses.length > 3 ? `<div class="course-item" style="color:var(--gray-400)">+${courses.length - 3} more course${courses.length - 3 > 1 ? 's' : ''}</div>` : ''}
        </div>
      ` : ''}

      <div class="player-card-footer">${footerHtml}</div>
    </div>
  `;
}

function esc(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Connect Modal ────────────────────────────────────────────────────────────

function openConnectModal(playerId, playerName) {
  pendingReceiverId = playerId;
  document.getElementById('modal-player-name').textContent = playerName;
  document.getElementById('modal-message').value = '';
  document.getElementById('connect-modal').classList.remove('hidden');
  setTimeout(() => document.getElementById('modal-message').focus(), 50);
}

function closeModal() {
  document.getElementById('connect-modal').classList.add('hidden');
  pendingReceiverId = null;
}

async function submitConnection() {
  if (!pendingReceiverId) return;
  const message = document.getElementById('modal-message').value.trim();
  try {
    await api('POST', '/api/connections', { receiver_id: pendingReceiverId, message });
    closeModal();
    loadPlayers();
    checkConnectionBadge();
  } catch (err) {
    alert(err.message);
  }
}

// ─── Profile ──────────────────────────────────────────────────────────────────

async function loadProfile() {
  try {
    const me = await api('GET', '/api/me');
    currentUser = me;
    document.getElementById('profile-name').value = me.name || '';
    document.getElementById('profile-handicap').value = me.handicap != null ? me.handicap : '';
    document.getElementById('profile-city').value = me.city || '';
    document.getElementById('profile-state').value = me.state || '';
    document.getElementById('profile-zip').value = me.zip_code || '';
    document.getElementById('profile-bio').value = me.bio || '';
    document.getElementById('profile-frequency').value = me.playing_frequency || 'weekly';
    document.getElementById('profile-skill').value = me.skill_level || 'intermediate';
    profileCourses = (me.preferred_courses || []).map(c => ({ name: c.course_name || c.name || '', city: c.city || '' }));
    renderProfileCourses();
  } catch (err) {
    console.error('Profile load error:', err);
  }
}

function renderProfileCourses() {
  const list = document.getElementById('courses-list');
  if (profileCourses.length === 0) {
    list.innerHTML = '<div style="color:var(--gray-400);font-size:13px;padding:6px 0">No courses added yet</div>';
    return;
  }
  list.innerHTML = profileCourses.map((c, i) => `
    <div class="course-row">
      <span>🏌️ ${esc(c.name)}</span>
      <button class="btn btn-outline btn-sm" onclick="removeCourse(${i})" style="padding:4px 10px;font-size:12px;flex-shrink:0">✕ Remove</button>
    </div>
  `).join('');
}

function addCourse() {
  const input = document.getElementById('new-course-name');
  const name = input.value.trim();
  if (!name) return;
  if (profileCourses.find(c => c.name.toLowerCase() === name.toLowerCase())) {
    alert('That course is already on your list');
    return;
  }
  profileCourses.push({ name, city: '' });
  renderProfileCourses();
  input.value = '';
  input.focus();
}

function removeCourse(index) {
  profileCourses.splice(index, 1);
  renderProfileCourses();
}

async function saveProfile() {
  const name = document.getElementById('profile-name').value.trim();
  const errEl = document.getElementById('profile-error');
  const okEl = document.getElementById('profile-success');
  errEl.classList.add('hidden');
  okEl.classList.add('hidden');

  if (!name) {
    errEl.textContent = 'Name is required';
    errEl.classList.remove('hidden');
    return;
  }

  const data = {
    name,
    handicap: parseFloat(document.getElementById('profile-handicap').value) || 0,
    city: document.getElementById('profile-city').value.trim(),
    state: document.getElementById('profile-state').value.trim().toUpperCase(),
    zip_code: document.getElementById('profile-zip').value.trim(),
    bio: document.getElementById('profile-bio').value.trim(),
    playing_frequency: document.getElementById('profile-frequency').value,
    skill_level: document.getElementById('profile-skill').value,
    preferred_courses: profileCourses
  };

  try {
    await api('PUT', '/api/me', data);
    currentUser = { ...currentUser, ...data };
    document.getElementById('user-greeting').textContent = `Hi, ${name.split(' ')[0]}!`;
    okEl.classList.remove('hidden');
    setTimeout(() => okEl.classList.add('hidden'), 3500);
  } catch (err) {
    errEl.textContent = err.message;
    errEl.classList.remove('hidden');
  }
}

// ─── Connections ──────────────────────────────────────────────────────────────

async function loadConnections() {
  try {
    connectionsData = await api('GET', '/api/connections');
    renderConnections();
    checkConnectionBadge();
  } catch (err) {
    console.error('Connections load error:', err);
  }
}

function showTab(tab, e) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-content').forEach(c => c.classList.add('hidden'));
  e.currentTarget.classList.add('active');
  document.getElementById(`tab-${tab}`).classList.remove('hidden');
}

function renderConnections() {
  const received = connectionsData.received || [];
  const sent = connectionsData.sent || [];
  const partners = [
    ...received.filter(c => c.status === 'accepted'),
    ...sent.filter(c => c.status === 'accepted')
  ];

  const pendingCount = received.filter(c => c.status === 'pending').length;
  const countEl = document.getElementById('received-count');
  countEl.textContent = pendingCount > 0 ? pendingCount : '';
  countEl.style.display = pendingCount > 0 ? 'inline-block' : 'none';

  document.getElementById('received-list').innerHTML = received.length
    ? received.map(c => renderConnectionCard(c, 'received')).join('')
    : '<div class="empty-state">No requests received yet</div>';

  document.getElementById('sent-list').innerHTML = sent.length
    ? sent.map(c => renderConnectionCard(c, 'sent')).join('')
    : '<div class="empty-state">You haven\'t sent any requests yet — discover players to connect with!</div>';

  document.getElementById('partners-list').innerHTML = partners.length
    ? partners.map(c => renderConnectionCard(c, 'partner')).join('')
    : '<div class="empty-state">No partners yet — start connecting with players in Discover!</div>';
}

function renderConnectionCard(conn, type) {
  let name, handicap, city, rightHtml = '';

  if (type === 'received') {
    name = conn.requester_name;
    handicap = conn.requester_handicap;
    city = conn.requester_city;
    if (conn.status === 'pending') {
      rightHtml = `
        <div class="connection-actions">
          <button class="btn btn-accept btn-sm" onclick="updateConn(${conn.id}, 'accepted')">Accept</button>
          <button class="btn btn-decline btn-sm" onclick="updateConn(${conn.id}, 'declined')">Decline</button>
        </div>`;
    } else {
      rightHtml = `<span class="connection-status status-${conn.status}">${conn.status}</span>`;
    }
  } else if (type === 'sent') {
    name = conn.receiver_name;
    handicap = conn.receiver_handicap;
    city = conn.receiver_city;
    rightHtml = `<span class="connection-status status-${conn.status}">${conn.status}</span>`;
  } else {
    name = conn.requester_id === currentUser.id ? conn.receiver_name : conn.requester_name;
    handicap = conn.requester_id === currentUser.id ? conn.receiver_handicap : conn.requester_handicap;
    city = conn.requester_id === currentUser.id ? conn.receiver_city : conn.requester_city;
    rightHtml = `<span class="connection-status status-accepted">✓ Partner</span>`;
  }

  const hcpStr = handicap != null ? `HCP ${Number(handicap).toFixed(1)}` : '';

  return `
    <div class="connection-card">
      <div class="player-avatar" style="width:42px;height:42px;font-size:17px;flex-shrink:0">${(name || '?').charAt(0)}</div>
      <div class="connection-info">
        <div class="connection-name">${esc(name || 'Unknown Player')}</div>
        <div class="connection-detail">${[hcpStr, city ? esc(city) : ''].filter(Boolean).join(' · ')}</div>
        ${conn.message ? `<div class="connection-message">"${esc(conn.message)}"</div>` : ''}
      </div>
      ${rightHtml}
    </div>
  `;
}

async function updateConn(id, status) {
  try {
    await api('PUT', `/api/connections/${id}`, { status });
    await loadConnections();
  } catch (err) {
    alert(err.message);
  }
}

async function checkConnectionBadge() {
  try {
    const conns = await api('GET', '/api/connections');
    const pending = (conns.received || []).filter(c => c.status === 'pending').length;
    const badge = document.getElementById('connection-badge');
    if (pending > 0) {
      badge.textContent = pending;
      badge.classList.remove('hidden');
    } else {
      badge.classList.add('hidden');
    }
  } catch {}
}

// ─── Start ────────────────────────────────────────────────────────────────────

init();
