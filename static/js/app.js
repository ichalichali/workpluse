// ── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  page: 'login',
  punchStatus: null,
  pendingCount: 0,
};

// ── R3 · Hand Emoji State ────────────────────────────────────────────────────
const handEmojiState = {
  showQuoteAfterPunchIn: false,
  quoteExpireTime: null,
};

// ── Initialize from localStorage ──────────────────────────────────────────────
function initializeSession() {
  const saved = localStorage.getItem('ontime_user');
  if (saved) {
    try {
      state.user = JSON.parse(saved);
      state.page = 'dashboard';
    } catch (e) {
      console.error('Failed to restore session:', e);
      localStorage.removeItem('ontime_user');
    }
  }
}


// ── API helper ────────────────────────────────────────────────────────────────
async function api(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

// ── R3 · Helper Functions (must be before renderDashboard) ───────────────────
function calculateOntimePercentage(summary) {
  const total = (summary.ontime || 0) + (summary.late || 0);
  if (total === 0) return 0;
  return Math.round(((summary.ontime || 0) / total) * 100);
}

function getHandEmoji(ontimePercent, thresholds) {
  const lower = thresholds.lower || 40;
  const upper = thresholds.upper || 80;
  if (ontimePercent < lower) return { emoji: '👎', label: 'Below Average' };
  if (ontimePercent >= upper) return { emoji: '👍', label: 'Excellent' };
  return { emoji: '👋', label: 'Average' };
}

function shouldShowQuote(ontimePercent, thresholds) {
  const lower = thresholds.lower || 40;
  return ontimePercent < lower;
}

function getRandomMotivationalQuote(userId) {
  const seed = (userId || Math.random()) * 9999;
  const idx = Math.floor(seed % MOTIVATIONAL_QUOTES.length);
  return MOTIVATIONAL_QUOTES[idx];
}

// ── Render Router ─────────────────────────────────────────────────────────────
function render() {
  const app = document.getElementById('app');
  if (!state.user) {
    if (state.page === 'forgot') return renderForgot();
    if (state.page === 'reset')  return renderReset();
    return renderLogin();
  }
  renderShell();
}

// ── Login Page ────────────────────────────────────────────────────────────────
function renderLogin() {
  document.getElementById('app').innerHTML = `
  <div class="auth-wrap">
    <div class="auth-hero">
      <div class="hero-logo">
        <div class="hero-logo-icon">⏱</div>
        <div class="hero-logo-text">OnTime</div>
      </div>
      <h1 class="hero-title">Track time.<br>Manage leave.<br><span>Stay in sync.</span></h1>
      <p class="hero-sub">A modern attendance & leave management system built for teams of every size.</p>
      <div class="hero-pills">
        <span class="hero-pill">✅ Real-time punch-in</span>
        <span class="hero-pill">📅 Leave management</span>
        <span class="hero-pill">📊 Team dashboard</span>
        <span class="hero-pill">👥 3 role levels</span>
      </div>
    </div>
    <div class="auth-panel">
      <h2>Welcome back</h2>
      <p class="sub">Sign in to your account to continue</p>
      <div id="login-alert"></div>
      <div class="form-group">
        <label>Email address</label>
        <input id="login-email" type="email" placeholder="you@company.com" value="alice@company.com"/>
      </div>
      <div class="form-group">
        <label>Password</label>
        <div style="position:relative;display:flex;align-items:center">
          <input id="login-pw" type="password" placeholder="••••••••" value="emp123" style="flex:1;padding-right:40px"/>
          <button type="button" onclick="togglePasswordVisibility()" style="position:absolute;right:10px;background:none;border:none;cursor:pointer;font-size:18px;color:#64748b" id="pw-toggle">👁️</button>
        </div>
      </div>
      <div style="text-align:right;margin-bottom:20px;margin-top:-8px">
        <button class="link-btn" onclick="state.page='forgot';render()">Forgot password?</button>
      </div>
      <button class="btn btn-primary btn-full" id="login-btn" onclick="doLogin()">Sign In</button>
      <div style="margin-top:24px;padding:16px;background:#f8fafc;border-radius:10px;font-size:13px;color:#64748b">
        <strong style="display:block;margin-bottom:8px;color:#334155">🔑 Demo accounts</strong>
        <div style="display:grid;gap:4px">
          <span>HR Admin: <code>hr@company.com</code> / <code>hr123</code></span>
          <span>Manager: <code>manager@company.com</code> / <code>mgr123</code></span>
          <span>Employee: <code>alice@company.com</code> / <code>emp123</code></span>
        </div>
      </div>
    </div>
  </div>`;
  document.getElementById('login-pw').addEventListener('keydown', e => e.key==='Enter' && doLogin());
}

async function doLogin() {
  const email = document.getElementById('login-email').value;
  const pw    = document.getElementById('login-pw').value;
  const btn   = document.getElementById('login-btn');
  btn.innerHTML = '<span class="spinner"></span> Signing in…';
  btn.disabled = true;
  const r = await api('POST', '/login', { email, password: pw });
  btn.innerHTML = 'Sign In'; btn.disabled = false;
  if (!r.ok) {
    document.getElementById('login-alert').innerHTML = `<div class="alert alert-error">⚠ ${r.data.error}</div>`;
    return;
  }
  state.user = r.data.user;
  state.punchStatus = r.data.punch_status;
  state.page = 'dashboard';
  localStorage.setItem('ontime_user', JSON.stringify(state.user));
  
  // R2: Check if user has accepted consent
  if (r.data.consent_accepted === false) {
    // Show consent modal instead of going to dashboard
    showConsentModal();
  } else {
    await loadPendingCount();
    render();
  }
}

// ── Forgot Password ───────────────────────────────────────────────────────────

function togglePasswordVisibility() {
  const input = document.getElementById('login-pw');
  const btn = document.getElementById('pw-toggle');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '👁️‍🗨️';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
  }
}

// ── Forgot Password ───────────────────────────────────────────────────────
function renderForgot() {
  document.getElementById('app').innerHTML = `
    <div class="auth-hero">
      <div class="hero-logo">
        <div class="hero-logo-icon">⏱</div>
        <div class="hero-logo-text">OnTime</div>
      </div>
      <h1 class="hero-title">Reset your<br><span>password</span></h1>
      <p class="hero-sub">Enter your work email and we'll send you a reset link.</p>
    </div>
    <div class="auth-panel">
      <h2>Forgot password?</h2>
      <p class="sub">No worries, we'll send you reset instructions.</p>
      <div id="forgot-alert"></div>
      <div class="form-group">
        <label>Email address</label>
        <input id="forgot-email" type="email" placeholder="you@company.com"/>
      </div>
      <button class="btn btn-primary btn-full" onclick="doForgot()">Send Reset Link</button>
      <div style="text-align:center;margin-top:20px">
        <button class="link-btn" onclick="state.page='login';render()">← Back to login</button>
      </div>
    </div>
  </div>`;
}

async function doForgot() {
  const email = document.getElementById('forgot-email').value;
  const r = await api('POST', '/forgot-password', { email });
  document.getElementById('forgot-alert').innerHTML = r.data.demo_token
    ? `<div class="alert alert-success">✅ ${r.data.message}<br><br>Demo reset token: <code style="word-break:break-all">${r.data.demo_token}</code></div>`
    : `<div class="alert alert-success">✅ If that email exists, a reset link has been sent.</div>`;
}

function renderReset() {
  const token = new URLSearchParams(location.search).get('token') || '';
  document.getElementById('app').innerHTML = `
  <div class="auth-wrap">
    <div class="auth-hero">
      <div class="hero-logo"><div class="hero-logo-icon">⏱</div><div class="hero-logo-text">OnTime</div></div>
      <h1 class="hero-title">Set new<br><span>password</span></h1>
    </div>
    <div class="auth-panel">
      <h2>Create new password</h2>
      <p class="sub">Choose a strong password for your account.</p>
      <div id="reset-alert"></div>
      <div class="form-group"><label>Reset Token</label><input id="reset-token" value="${token}" placeholder="Paste token here"/></div>
      <div class="form-group"><label>New Password</label><input id="reset-pw" type="password" placeholder="Min 8 characters"/></div>
      <div class="form-group"><label>Confirm Password</label><input id="reset-pw2" type="password" placeholder="Repeat password"/></div>
      <button class="btn btn-primary btn-full" onclick="doReset()">Update Password</button>
    </div>
  </div>`;
}

async function doReset() {
  const token = document.getElementById('reset-token').value;
  const pw = document.getElementById('reset-pw').value;
  const pw2 = document.getElementById('reset-pw2').value;
  if (pw !== pw2) { document.getElementById('reset-alert').innerHTML=`<div class="alert alert-error">Passwords do not match</div>`; return; }
  const r = await api('POST', '/reset-password', { token, password: pw });
  if (r.ok) {
    document.getElementById('reset-alert').innerHTML = `<div class="alert alert-success">✅ Password updated! <button class="link-btn" onclick="state.page='login';render()">Sign in now</button></div>`;
  } else {
    document.getElementById('reset-alert').innerHTML = `<div class="alert alert-error">⚠ ${r.data.error}</div>`;
  }
}

// ── App Shell ─────────────────────────────────────────────────────────────────
function renderShell() {
  const role = state.user.role;
  const isManager = role === 'manager' || role === 'hr_admin';
  const isHR = role === 'hr_admin';
  const initials = state.user.name.split(' ').map(n=>n[0]).join('').slice(0,2);

  document.getElementById('app').innerHTML = `
  <div class="app-shell">
    <aside class="sidebar">
      <div class="sidebar-logo">
        <div class="sidebar-logo-icon">⏱</div>
        <div class="sidebar-logo-text">OnTime <span>Attendance & Leave</span></div>
      </div>
      <div class="sidebar-section">
        <div class="sidebar-section-label">Main</div>
        <button class="nav-item ${state.page==='dashboard'?'active':''}" onclick="navigate('dashboard')">
          <span class="nav-icon">🏠</span> Dashboard
        </button>
        <button class="nav-item ${state.page==='attendance'?'active':''}" onclick="navigate('attendance')">
          <span class="nav-icon">📋</span> My Attendance
        </button>
        <button class="nav-item ${state.page==='leave'?'active':''}" onclick="navigate('leave')">
          <span class="nav-icon">🏖</span> Leave
        </button>
        <button class="nav-item ${state.page==='reports'?'active':''}" onclick="navigate('reports')">
          <span class="nav-icon">📊</span> Reports
        </button>
        <button class="nav-item ${state.page==='pdp'?'active':''}" onclick="navigate('pdp')">
          <span class="nav-icon">🔒</span> Profil & Privasi
        </button>
      </div>
      ${isManager ? `
      <div class="sidebar-section">
        <div class="sidebar-section-label">Management</div>
        <button class="nav-item ${state.page==='team'?'active':''}" onclick="navigate('team')">
          <span class="nav-icon">👥</span> Team Attendance
        </button>
        <button class="nav-item ${state.page==='approvals'?'active':''}" onclick="navigate('approvals')">
          <span class="nav-icon">✅</span> Leave Approvals
          ${state.pendingCount > 0 ? `<span class="nav-badge">${state.pendingCount}</span>` : ''}
        </button>
      </div>` : ''}
      ${isHR ? `
      <div class="sidebar-section">
        <div class="sidebar-section-label">HR Admin</div>
        <button class="nav-item ${state.page==='employees'?'active':''}" onclick="navigate('employees')">
          <span class="nav-icon">🧑‍💼</span> Employees
        </button>
        <button class="nav-item ${state.page==='branches'?'active':''}" onclick="navigate('branches')">
          <span class="nav-icon">🏢</span> Branches & Geofence
        </button>
        <button class="nav-item ${state.page==='settings'?'active':''}" onclick="navigate('settings')">
          <span class="nav-icon">⚙️</span> Settings
        </button>
        <button class="nav-item ${state.page==='audit'?'active':''}" onclick="navigate('audit')">
          <span class="nav-icon">📋</span> Audit Log
        </button>
        <button class="nav-item ${state.page==='deletion-requests'?'active':''}" onclick="navigate('deletion-requests')">
          <span class="nav-icon">🗑️</span> Deletion Requests
        </button>
      </div>` : ''}
      <div class="sidebar-footer">
        <div class="user-card">
          <div class="user-avatar">${initials}</div>
          <div class="user-info">
            <div class="user-name">${state.user.name}</div>
            <div class="user-role">${state.user.role.replace('_',' ')}</div>
          </div>
          <button class="logout-btn" onclick="doLogout()" title="Sign out">⏻</button>
        </div>
      </div>
    </aside>
    <main class="main-content" id="page-content"></main>
  </div>`;

  loadPage();
}

async function navigate(page) {
  state.page = page;
  renderShell();
}

async function loadPendingCount() {
  if (state.user.role === 'employee') return;
  const r = await api('GET', '/leave/pending');
  if (r.ok) state.pendingCount = r.data.length;
}

async function doLogout() {
  await api('POST', '/logout');
  state.user = null; state.page = 'login'; state.punchStatus = null;
  localStorage.removeItem('ontime_user');
  render();
}

// ── Page Dispatcher ───────────────────────────────────────────────────────────
async function loadPage() {
  switch(state.page) {
    case 'dashboard':   return renderDashboard();
    case 'attendance':  return renderAttendance();
    case 'leave':       return renderLeave();
    case 'team':        return renderTeam();
    case 'approvals':   return renderApprovals();
    case 'employees':   return renderEmployees();
    case 'branches':    return renderBranches();
    case 'settings':    return renderSettings();
    case 'reports':     return renderReports();
    case 'audit':       return renderAudit();
    case 'pdp':         return renderPDP();
    case 'deletion-requests': {
      if (!pdpState.deletionRequests.length) {
        await loadDeletionRequests();
      }
      return renderDeletionRequests();
    }
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('page-content');
  el.innerHTML = `<div class="page-header"><h1>Good ${greeting()}, ${state.user.name.split(' ')[0]} 👋</h1><p>${formatDate(new Date())}</p></div><div id="dash-body"><p>Loading…</p></div>`;

  const [todayR, summaryR, balR, attR, settingsR] = await Promise.all([
    api('GET', '/attendance/today'),
    api('GET', '/attendance/summary'),
    api('GET', '/leave/balance'),
    api('GET', '/attendance/me'),
    api('GET', '/settings'),
  ]);

  const today = todayR.data;
  window._dashAttendance = today;  // expose for overtime monitor
  const sum   = summaryR.data;
  const bals  = balR.data;
  const att   = attR.data;
  const settings = settingsR.data || {};
  
  // R3: Calculate on-time % and three-tier hand emoji thresholds
  const ontimePercent = calculateOntimePercentage(sum);
  const thresholds = {
    lower: parseInt(settings.thumb_down_threshold || '40', 10),  // 👎 if < this
    upper: parseInt(settings.thumb_up_threshold || '80', 10),    // 👍 if >= this
    // 👋 is anything in between
  };
  const handState = getHandEmoji(ontimePercent, thresholds);
  
  // R3: Get quote from localStorage if employee is LATE (👎 status)
  const todayDateStr = new Date().toISOString().split('T')[0];
  const quoteKey = `ontime_quote_${todayDateStr}`;
  const isLate = ontimePercent < thresholds.lower;
  const storedQuote = isLate ? localStorage.getItem(quoteKey) : null;
  const motivationalQuote = storedQuote || null;
  const willShowQuote = !!motivationalQuote;

  const notPunched = !today.punch_in && isWeekday() && state.punchStatus !== 'leave';
  const alertHtml = notPunched ? `
    <div class="punch-alert">
      <div class="punch-alert-icon">⚠️</div>
      <div class="punch-alert-text">
        <strong>You haven't punched in today!</strong>
        <span>Please punch in to record your attendance for today.</span>
      </div>
      <button class="btn btn-primary btn-sm" onclick="doPunchIn()">Punch In Now</button>
    </div>` : '';

  document.getElementById('dash-body').innerHTML = `
    ${alertHtml}
    <div class="punch-card">
      <div>
        <div class="punch-date">${formatDate(new Date())}</div>
        <div class="punch-time" id="live-clock">--:--:--</div>
        <div class="punch-status">
          <div class="punch-item"><div class="punch-item-val">${today.punch_in ? today.punch_in.slice(0,5) : '--:--'}</div><div class="punch-item-lbl">PUNCH IN</div></div>
          <div class="punch-item"><div class="punch-item-val">${today.punch_out ? today.punch_out.slice(0,5) : '--:--'}</div><div class="punch-item-lbl">PUNCH OUT</div></div>
          <div class="punch-item"><div class="punch-item-val">${handState.emoji} ${ontimePercent}%</div><div class="punch-item-lbl">STATUS</div></div>
          ${willShowQuote ? `<div class="punch-item" style="background:rgba(255,255,255,0.08);border-left:3px solid #667eea;padding:12px 16px;border-radius:6px;font-size:16px;line-height:1.6;color:rgba(255,255,255,0.9);font-weight:500;flex:1;margin-left:16px">💡 ${motivationalQuote}</div>` : ''}
        </div>
      </div>
      <div class="punch-actions" id="punch-actions">
        ${punchButtons(today)}
      </div>
    </div>

    <div class="stats-grid">
      <div class="stat-card"><div class="stat-icon green">✅</div><div><div class="stat-num">${sum.ontime||0}</div><div class="stat-label">On-time this month</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow">⏰</div><div><div class="stat-num">${sum.late||0}</div><div class="stat-label">Late this month</div></div></div>
      <div class="stat-card"><div class="stat-icon red">❌</div><div><div class="stat-num">${sum.absent||0}</div><div class="stat-label">Absences</div></div></div>
      <div class="stat-card"><div class="stat-icon purple">🏖</div><div><div class="stat-num">${sum.leave||0}</div><div class="stat-label">Leave days taken</div></div></div>
    </div>

    <div class="grid-2">
      <div class="card">
        <div class="card-header"><h3>📅 This Month — Attendance</h3></div>
        <div class="card-body">${buildCalendar(att)}</div>
      </div>
      <div class="card">
        <div class="card-header"><h3>🏖 Leave Balance</h3></div>
        <div class="card-body">
          <div class="leave-bal-list">
            ${bals.slice(0,5).map(b => {
              const pct = b.total_days > 0 ? Math.round((b.used_days/b.total_days)*100) : 0;
              const color = pct>80?'var(--red)':pct>50?'var(--yellow)':'var(--green)';
              return `<div class="leave-bal-item">
                <div class="leave-bal-top"><span class="leave-bal-name">${b.leave_name}</span><span class="leave-bal-nums">${b.remaining} / ${b.total_days} days left</span></div>
                <div class="leave-bal-bar"><div class="leave-bal-fill" style="width:${pct}%;background:${color}"></div></div>
              </div>`;
            }).join('')}
          </div>
          <button class="btn btn-outline btn-sm w-full mt-4" onclick="navigate('leave')">Apply for Leave →</button>
        </div>
      </div>
    </div>`;

  // Live clock + overtime monitor
  const tick = () => {
    const el = document.getElementById('live-clock');
    if (el) {
      el.textContent = new Date().toLocaleTimeString('en-GB');
      checkOvertimeAlert();
      setTimeout(tick, 1000);
    }
  };
  tick();
}

function punchButtons(today) {
  if (!isWeekday()) return `<div style="color:rgba(255,255,255,.5);font-size:14px;text-align:center">Weekend 🎉</div>`;
  if (today.status === 'leave') return `<div style="color:rgba(255,255,255,.5);font-size:14px;text-align:center">On Leave 🏖</div>`;
  if (!today.punch_in)  return `<button class="btn btn-success" id="pi-btn" onclick="doPunchIn()">⏰ Punch In</button>`;
  if (!today.punch_out) return `<button class="btn btn-danger" onclick="doPunchOut()">🔚 Punch Out</button>`;
  return `<div style="color:rgba(255,255,255,.6);font-size:13px;text-align:center">All done for today!<br>See you tomorrow 👋</div>`;
}

async function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      ()  => resolve(null),
      { timeout: 8000, enableHighAccuracy: true }
    );
  });
}

async function doPunchIn() {
  const btn = document.getElementById('pi-btn');
  if (btn) { btn.innerHTML = '📍 Getting location…'; btn.disabled = true; }
  const loc = await getLocation();
  const r = await api('POST', '/punch-in', loc || {});
  if (!r.ok) {
    const dist = r.data.distance ? ` (${r.data.distance}m away)` : '';
    showToast('error', r.data.error + dist);
    if (btn) { btn.innerHTML = '⏰ Punch In'; btn.disabled = false; }
    return;
  }
  state.punchStatus = r.data.status;
  const distMsg = r.data.distance != null ? ` · ${r.data.distance}m from office` : '';
  showToast('success', `Punched in — ${r.data.status}${distMsg}`);
  
  // R3: If employee is LATE (👎), generate and store a motivational quote for the day
  if (r.data.status === 'late') {
    const today = new Date().toISOString().split('T')[0];
    const quoteKey = `ontime_quote_${today}`;
    // Only generate new quote if not already stored for today
    if (!localStorage.getItem(quoteKey)) {
      const randomQuote = MOTIVATIONAL_QUOTES[Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length)];
      localStorage.setItem(quoteKey, randomQuote);
    }
  }
  
  await renderDashboard();
}

async function doPunchOut() {
  const loc = await getLocation();
  const r = await api('POST', '/punch-out', loc || {});
  if (!r.ok) {
    const dist = r.data.distance ? ` (${r.data.distance}m away)` : '';
    showToast('error', r.data.error + dist);
    return;
  }
  const distMsg = r.data.distance != null ? ` · ${r.data.distance}m from office` : '';
  showToast('success', `Punched out successfully${distMsg}`);
  
  // R3: Clear quote from localStorage on punch-out
  const today = new Date().toISOString().split('T')[0];
  localStorage.removeItem(`ontime_quote_${today}`);
  
  await renderDashboard();
}

// ── Overtime & Auto-Checkout System ──────────────────────────────────────────

const _ot = {
  // Phase: 'regular' = before/at shift end, 'overtime' = user confirmed OT
  phase:       'regular',
  alertShown:  false,   // current warning modal visible
  dismissed:   false,   // user clicked No — never re-show same warning
  plannedOut:  null,    // HH:MM — only set when user confirms overtime
  reportSent:  false,   // missing-checkout email sent
};

function _parseHM(t) {
  if (!t) return null;
  const [h,m] = t.split(':').map(Number);
  return h*60+m;
}
function _nowMins() {
  const n=new Date(); return n.getHours()*60+n.getMinutes();
}
function _minsToHHMM(mins) {
  const h=Math.floor(mins/60)%24, m=mins%60;
  return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`;
}

async function checkOvertimeAlert() {
  if (!state.user || state.page !== 'dashboard') return;
  const att = window._dashAttendance;
  if (!att || !att.punch_in || att.punch_out || att.status === 'leave') return;

  const now       = _nowMins();
  const shiftEnd  = _parseHM(state.user.shift_end);  // regular shift end, never changes
  if (!shiftEnd) return;

  // ── REGULAR PHASE: before/at shift end ─────────────────────────────────────
  if (_ot.phase === 'regular') {
    const warnAt = shiftEnd - 15;
    // Show shift-end warning 15 min before (ask if doing OT)
    if (now >= warnAt && now < shiftEnd && !_ot.alertShown && !_ot.dismissed) {
      _ot.alertShown = true;
      showShiftEndModal(shiftEnd);
      return;
    }
    // Past shift end and no overtime — silently auto clock-out, no email
    if (now >= shiftEnd && !_ot.alertShown && !window._autoCheckedOut) {
      await performAutoCheckout(_minsToHHMM(shiftEnd) + ':00', false);
    }
    return;
  }

  // ── OVERTIME PHASE: user confirmed overtime, plannedOut is set ────────────
  if (_ot.phase === 'overtime' && _ot.plannedOut) {
    const plannedMins = _parseHM(_ot.plannedOut);
    const warnAt      = plannedMins - 15;

    // Past planned OT end — if modal was shown but ignored, notify supervisor
    if (now >= plannedMins) {
      if (_ot.alertShown && !_ot.reportSent) {
        // Modal was open but user didn't click — send missing report
        _ot.reportSent = true;
        const overlay = document.getElementById('ot-overlay');
        if (overlay) overlay.remove();
        await api('POST', '/overtime/missing-report');
        showToast('error', 'You missed your overtime clock-out. Your supervisor has been notified.');
      } else if (!_ot.alertShown && !window._autoCheckedOut) {
        // User clicked No on time — auto checkout already handled
      }
      return;
    }

    // Show warning 15 min before OT end
    if (now >= warnAt && now < plannedMins && !_ot.alertShown && !_ot.dismissed) {
      _ot.alertShown = true;
      showOvertimeModal(plannedMins);
    }
  }
}

function showShiftEndModal(shiftEndMins) {
  const existing = document.getElementById('ot-overlay');
  if (existing) existing.remove();
  const shiftEndStr = _minsToHHMM(shiftEndMins);
  const overlay = document.createElement('div');
  overlay.id = 'ot-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px;backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <div style="background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:100%;max-width:420px;overflow:hidden;animation:slideUp .2s ease">
      <div style="background:linear-gradient(135deg,#0f1f3d,#1d3461);padding:20px 24px;display:flex;align-items:center;gap:12px">
        <span style="font-size:28px">⏰</span>
        <div>
          <div style="color:white;font-size:16px;font-weight:700">Shift ending soon!</div>
          <div style="color:rgba(255,255,255,.6);font-size:13px">Your shift ends at ${shiftEndStr}</div>
        </div>
      </div>
      <div style="padding:24px">
        <p style="color:#334155;font-size:14px;margin-bottom:24px">
          Your shift ends at <strong>${shiftEndStr}</strong>. You'll be automatically clocked out then.<br><br>
          Are you planning to work overtime?
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button id="se-no-btn"
            style="padding:12px;border:1.5px solid #e2e8f0;border-radius:8px;background:white;color:#475569;font-size:14px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif">
            No, I'm leaving at ${shiftEndStr}
          </button>
          <button id="se-yes-btn"
            style="padding:12px;border:none;border-radius:8px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;font-size:14px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;box-shadow:0 4px 12px rgba(37,99,235,.35)">
            Yes, I'm doing overtime
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  document.getElementById('se-no-btn').onclick = async () => {
    // User confirms leaving — close modal, mark dismissed so it never re-shows
    overlay.remove();
    _ot.alertShown = false;
    _ot.dismissed  = true;
    // Schedule silent auto-checkout at exact shift end
    const minsLeft = shiftEndMins - _nowMins();
    if (minsLeft <= 0) {
      await performAutoCheckout(shiftEndStr + ':00', false);
    }
    // tick will handle it when now >= shiftEnd
  };

  document.getElementById('se-yes-btn').onclick = () => {
    overlay.remove();
    _ot.alertShown = false;
    // Switch to overtime phase — show OT hours input
    _ot.phase = 'overtime';
    _ot.plannedOut = shiftEndStr;  // temporary — will be updated by OT modal
    showOvertimeModal(shiftEndMins);
  };
}

function showOvertimeModal(plannedMins) {
  const existing = document.getElementById('ot-overlay');
  if (existing) existing.remove();
  const plannedStr = _minsToHHMM(plannedMins);
  const overlay = document.createElement('div');
  overlay.id = 'ot-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:2000;padding:20px;backdrop-filter:blur(4px)';
  overlay.innerHTML = `
    <div style="background:white;border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.25);width:100%;max-width:440px;overflow:hidden;animation:slideUp .2s ease">
      <div style="background:linear-gradient(135deg,#92400e,#b45309);padding:20px 24px;display:flex;align-items:center;gap:12px">
        <span style="font-size:28px">🕐</span>
        <div>
          <div style="color:white;font-size:16px;font-weight:700">Overtime ending soon!</div>
          <div style="color:rgba(255,255,255,.7);font-size:13px">Your overtime ends at ${plannedStr}</div>
        </div>
      </div>
      <div style="padding:24px">
        <p style="color:#334155;font-size:14px;margin-bottom:20px">
          Your overtime clock-out is <strong>${plannedStr}</strong>. If you don't respond within 15 minutes, 
          your supervisor will be notified of a missing clock-out.
        </p>
        <div style="background:#eff6ff;border:1.5px solid #bfdbfe;border-radius:10px;padding:16px;margin-bottom:20px">
          <label style="display:block;font-size:13px;font-weight:600;color:#1e40af;margin-bottom:8px">Working overtime? Enter extra hours:</label>
          <div style="display:flex;align-items:center;gap:10px">
            <input id="ot-hours" type="number" min="0.5" max="8" step="0.5" value="1"
              style="width:80px;padding:8px 12px;border:1.5px solid #bfdbfe;border-radius:8px;font-size:16px;font-weight:700;text-align:center;font-family:DM Mono,monospace;outline:none"/>
            <span style="color:#1e40af;font-size:14px;font-weight:500">extra hour(s)</span>
          </div>
          <div id="ot-preview" style="margin-top:8px;font-size:12px;color:#64748b;font-style:italic"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <button id="ot-no-btn"
            style="padding:12px;border:1.5px solid #e2e8f0;border-radius:8px;background:white;color:#475569;font-size:14px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif">
            No — clock me out at ${plannedStr}
          </button>
          <button id="ot-yes-btn"
            style="padding:12px;border:none;border-radius:8px;background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;font-size:14px;font-weight:600;cursor:pointer;font-family:DM Sans,sans-serif;box-shadow:0 4px 12px rgba(37,99,235,.35)">
            Yes, I'm staying
          </button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  // Preview
  const hoursInput = document.getElementById('ot-hours');
  const preview    = document.getElementById('ot-preview');
  const updatePreview = () => {
    const h = parseFloat(hoursInput.value) || 0;
    const newMins = plannedMins + Math.round(h * 60);
    preview.textContent = `New clock-out: ${_minsToHHMM(newMins)} · Next reminder at ${_minsToHHMM(newMins - 15)}`;
  };
  hoursInput.addEventListener('input', updatePreview);
  updatePreview();

  document.getElementById('ot-no-btn').onclick  = () => handleOvertimeNo(plannedStr);
  document.getElementById('ot-yes-btn').onclick = () => handleOvertimeYes(plannedMins);
}

async function handleOvertimeNo(plannedStr) {
  const overlay = document.getElementById('ot-overlay');
  if (overlay) overlay.remove();
  _ot.alertShown = false;
  _ot.dismissed  = true;   // don't re-show — user already responded
  // User responded — auto clock-out silently, no supervisor report needed
  await performAutoCheckout(plannedStr + ':00', false);
}

async function handleOvertimeYes(currentPlannedMins) {
  const hoursEl   = document.getElementById('ot-hours');
  const extra     = parseFloat(hoursEl ? hoursEl.value : 1) || 1;
  const newMins   = currentPlannedMins + Math.round(extra * 60);
  const newStr    = _minsToHHMM(newMins);
  await api('POST', '/overtime/set', { planned_checkout: newStr });
  _ot.plannedOut  = newStr;
  _ot.alertShown  = false;
  _ot.dismissed   = false;   // reset — new warning cycle for the OT period
  _ot.phase       = 'overtime';   // now in overtime phase — supervisor notified if missed
  const overlay = document.getElementById('ot-overlay');
  if (overlay) overlay.remove();
  showToast('success', `Overtime logged! Reminder at ${_minsToHHMM(newMins - 15)}, auto clock-out at ${newStr}`);
}

async function performAutoCheckout(timeStr, isOvertime=false) {
  if (window._autoCheckedOut) return;
  window._autoCheckedOut = true;
  const r = await api('POST', '/overtime/auto-checkout', { time: timeStr });
  if (r.ok && !r.data.already_done) {
    window._dashAttendance = { ...window._dashAttendance, punch_out: timeStr };
    if (isOvertime) {
      // Overtime auto-checkout: notify supervisor since money is involved
      await api('POST', '/overtime/missing-report');
      showToast('success', `Auto clocked out at ${timeStr.slice(0,5)} ✅ · Supervisor notified`);
    } else {
      showToast('success', `Auto clocked out at ${timeStr.slice(0,5)} ✅`);
    }
    if (state.page === 'dashboard') await renderDashboard();
  }
}

function buildCalendar(att) {
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth();
  const attMap = {};
  att.forEach(a => { attMap[a.date] = a.status; });
  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month+1, 0).getDate();
  const labels = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  let html = `<div class="att-calendar">`;
  labels.forEach(l => html += `<div class="att-day-label">${l}</div>`);
  for(let i=0;i<firstDay;i++) html += `<div class="att-day empty"></div>`;
  for(let d=1;d<=daysInMonth;d++) {
    const dateStr = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const dow = new Date(year,month,d).getDay();
    const isToday = d === now.getDate();
    const future = new Date(year,month,d) > now;
    const status = attMap[dateStr];
    let cls = 'att-day';
    let label = '';
    if (dow===0||dow===6) { cls += ' weekend'; }
    else if (future) { cls += ' future'; }
    else if (status) { cls += ` ${status}`; label = status==='ontime'?'✓':status==='late'?'L':status==='leave'?'HL':'✗'; }
    else { cls += ' absent'; label = '✗'; }
    if (isToday) cls += ' today';
    html += `<div class="${cls}"><div class="att-day-num">${d}</div><div class="att-day-status">${label}</div></div>`;
  }
  html += '</div>';
  return html;
}

// ── My Attendance ─────────────────────────────────────────────────────────────
async function renderAttendance() {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header flex justify-between items-center">
      <div><h1>📋 My Attendance</h1><p>Your complete attendance history</p></div>
      <div class="flex gap-2">
        <input type="month" id="att-month" value="${new Date().toISOString().slice(0,7)}" style="padding:8px 12px;border:1.5px solid var(--grey-200);border-radius:8px;font-family:DM Sans,sans-serif;font-size:14px" onchange="loadAttHistory()">
      </div>
    </div>
    <div id="att-content">Loading…</div>`;
  await loadAttHistory();
}

async function loadAttHistory() {
  const month = document.getElementById('att-month').value;
  const [attR, sumR] = await Promise.all([
    api('GET', `/attendance/me?month=${month}`),
    api('GET', '/attendance/summary'),
  ]);
  const att = attR.data;
  const sum = sumR.data;

  document.getElementById('att-content').innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-icon green">✅</div><div><div class="stat-num">${sum.ontime||0}</div><div class="stat-label">On-time</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow">⏰</div><div><div class="stat-num">${sum.late||0}</div><div class="stat-label">Late</div></div></div>
      <div class="stat-card"><div class="stat-icon red">❌</div><div><div class="stat-num">${sum.absent||0}</div><div class="stat-label">Absent</div></div></div>
      <div class="stat-card"><div class="stat-icon purple">🏖</div><div><div class="stat-num">${sum.leave||0}</div><div class="stat-label">On Leave</div></div></div>
    </div>
    <div class="card">
      <div class="card-header"><h3>Attendance Records</h3><span class="text-sm text-muted">${att.length} records found</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Date</th><th>Day</th><th>Punch In</th><th>Punch Out</th><th>Duration</th><th>Status</th></tr></thead>
          <tbody>
            ${att.length ? att.map(a => {
              const duration = a.punch_in && a.punch_out ? calcDuration(a.punch_in, a.punch_out) : '—';
              return `<tr>
                <td class="font-mono">${a.date}</td>
                <td>${dayName(a.date)}</td>
                <td class="font-mono">${a.punch_in ? a.punch_in.slice(0,5) : '—'}</td>
                <td class="font-mono">${a.punch_out ? a.punch_out.slice(0,5) : '—'}</td>
                <td>${duration}</td>
                <td>${badgeHtml(a.status)}</td>
              </tr>`;
            }).join('') : '<tr><td colspan="6" class="empty-state"><div class="icon">📭</div><p>No records for this month</p></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Leave Page ────────────────────────────────────────────────────────────────
async function renderLeave() {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header flex justify-between items-center">
      <div><h1>🏖 Leave Management</h1><p>Apply and track your leave requests</p></div>
      <button class="btn btn-primary" onclick="showApplyModal()">+ Apply for Leave</button>
    </div>
    <div id="leave-content">Loading…</div>`;
  await loadLeaveData();
}

async function loadLeaveData() {
  const [balR, reqR] = await Promise.all([
    api('GET', '/leave/balance'),
    api('GET', '/leave/my-requests'),
  ]);
  const bals = balR.data;
  const reqs = reqR.data;

  document.getElementById('leave-content').innerHTML = `
    <div class="grid-3">
      <div>
        <div class="card mb-4">
          <div class="card-header"><h3>📊 Leave Balance ${new Date().getFullYear()}</h3></div>
          <div class="card-body">
            <div class="leave-bal-list">
              ${bals.map(b => {
                const pct = b.total_days > 0 ? Math.round((b.used_days/b.total_days)*100) : 0;
                const color = pct>80?'var(--red)':pct>50?'var(--yellow)':'var(--green)';
                return `<div class="leave-bal-item">
                  <div class="leave-bal-top">
                    <span class="leave-bal-name">${b.leave_name}</span>
                    <span class="leave-bal-nums font-mono">${b.remaining}/${b.total_days}</span>
                  </div>
                  <div class="leave-bal-bar"><div class="leave-bal-fill" style="width:${pct}%;background:${color}"></div></div>
                  <div style="font-size:11px;color:var(--text-s);margin-top:3px">${b.used_days} used · ${b.remaining} remaining</div>
                </div>`;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="card">
          <div class="card-header"><h3>📝 My Leave Requests</h3></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Type</th><th>Dates</th><th>Days</th><th>Status</th><th>Remarks</th></tr></thead>
              <tbody>
                ${reqs.length ? reqs.map(r => `<tr>
                  <td><strong>${r.leave_name}</strong><div style="font-size:12px;color:var(--text-s)">${r.reason||''}</div></td>
                  <td class="text-sm">${formatLeaveDates(r)}</td>
                  <td>${r.days}d</td>
                  <td>${badgeHtml(r.status)}</td>
                  <td style="font-size:12px;color:var(--text-s)">${r.remarks||'—'}</td>
                </tr>`).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="icon">📭</div><p>No leave requests yet</p></div></td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>`;
}

async function showApplyModal() {
  const typesR = await api('GET', '/leave/types');
  const balR   = await api('GET', '/leave/balance');
  const attR   = await api('GET', '/leave/my-requests');
  const types  = typesR.data;
  const bals   = balR.data;
  const reqs   = attR.data;
  const balMap = {};
  bals.forEach(b => balMap[b.leave_type_id] = b.remaining);

  // ── Indonesia National Holidays 2025 & 2026 ──────────────────────────────────
    const ID_HOLIDAYS = {
    "2025-01-01": "New Year's Day",
    "2025-01-27": "Isra Miraj",
    "2025-01-28": "Chinese New Year",
    "2025-01-29": "Chinese New Year Holiday",
    "2025-03-29": "Nyepi (Saka New Year)",
    "2025-03-31": "Eid al-Fitr Eve",
    "2025-04-01": "Eid al-Fitr Day 1",
    "2025-04-02": "Eid al-Fitr Day 2",
    "2025-04-03": "Eid al-Fitr Holiday",
    "2025-04-04": "Eid al-Fitr Holiday",
    "2025-04-07": "Eid al-Fitr Holiday",
    "2025-04-18": "Good Friday",
    "2025-05-01": "Labour Day",
    "2025-05-12": "Vesak Day",
    "2025-05-13": "Vesak Day Holiday",
    "2025-05-29": "Ascension Day",
    "2025-06-01": "Pancasila Day",
    "2025-06-06": "Eid al-Adha Day",
    "2025-06-09": "Eid al-Adha Holiday",
    "2025-06-27": "Islamic New Year",
    "2025-08-17": "Independence Day",
    "2025-09-05": "Prophet Birthday",
    "2025-12-25": "Christmas Day",
    "2025-12-26": "Christmas Holiday",
    "2026-01-01": "New Year's Day",
    "2026-01-16": "Isra Miraj",
    "2026-01-17": "Chinese New Year Eve",
    "2026-01-28": "Chinese New Year",
    "2026-03-03": "Eid al-Fitr Eve",
    "2026-03-04": "Eid al-Fitr Day 1",
    "2026-03-05": "Eid al-Fitr Day 2",
    "2026-03-06": "Eid al-Fitr Holiday",
    "2026-03-09": "Eid al-Fitr Holiday",
    "2026-03-10": "Eid al-Fitr Holiday",
    "2026-03-19": "Nyepi (Saka New Year)",
    "2026-04-03": "Good Friday",
    "2026-05-01": "Labour Day",
    "2026-05-14": "Ascension Day",
    "2026-05-24": "Vesak Day",
    "2026-05-13": "Eid al-Adha Eve",
    "2026-05-27": "Eid al-Adha Day",
    "2026-06-01": "Pancasila Day",
    "2026-06-17": "Islamic New Year",
    "2026-08-17": "Independence Day",
    "2026-08-26": "Prophet Birthday",
    "2026-12-25": "Christmas Day",
    "2026-12-26": "Christmas Holiday",
    "2026-12-31": "New Year Eve Holiday",
  };
  const holidayDates = new Set(Object.keys(ID_HOLIDAYS));

  // Build set of already-applied dates (pending/approved) to mark as unavailable
  const takenDates = new Set();
  reqs.forEach(r => {
    if (r.status === 'pending' || r.status === 'approved' || r.status === 'approvedd') {
      if (r.dates_json) {
        // Use exact selected dates if available
        JSON.parse(r.dates_json).forEach(d => takenDates.add(d));
      } else {
        // Fallback: iterate range for legacy records
        let cur = new Date(r.start_date);
        const end = new Date(r.end_date);
        while (cur <= end) { takenDates.add(cur.toISOString().slice(0,10)); cur.setDate(cur.getDate()+1); }
      }
    }
  });

  // Calendar state
  const today = new Date(); today.setHours(0,0,0,0);
  let calYear  = today.getFullYear();
  let calMonth = today.getMonth();
  let selectedDates = new Set(); // set of 'YYYY-MM-DD' strings

  const modalId = 'leave-cal-modal';

  showModal('Apply for Leave', `
    <div id="apply-alert"></div>
    <div class="form-group">
      <label>Leave Type</label>
      <select id="lt-select">
        ${types.map(t => `<option value="${t.id}">${t.name} (${balMap[t.id]||0} days remaining)</option>`).join('')}
      </select>
    </div>
    <div class="lc-wrap">
      <div class="lc-header">
        <button class="lc-nav" id="lc-prev">&#8249;</button>
        <span id="lc-title"></span>
        <button class="lc-nav" id="lc-next">&#8250;</button>
      </div>
      <div class="lc-day-labels">
        ${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d=>`<div>${d}</div>`).join('')}
      </div>
      <div class="lc-grid" id="lc-grid"></div>
      <div class="lc-legend">
        <span><span class="lc-dot lc-dot-sel"></span> Selected</span>
        <span><span class="lc-dot lc-dot-taken"></span> Already applied</span>
        <span><span class="lc-dot lc-dot-holiday"></span> Public Holiday</span>
        <span><span class="lc-dot lc-dot-weekend"></span> Weekend</span>
      </div>
    </div>
    <div class="alert alert-info" id="days-calc" style="margin-top:12px">Click dates to select your leave days (weekends auto-skipped)</div>
    <div class="form-group" style="margin-top:12px"><label>Reason</label><textarea id="lt-reason" rows="2" placeholder="Brief description of your leave reason…"></textarea></div>`,
    async () => {
      const ltId   = document.getElementById('lt-select').value;
      const reason = document.getElementById('lt-reason').value;
      const sorted = [...selectedDates].sort();
      if (sorted.length === 0) { document.getElementById('apply-alert').innerHTML=`<div class="alert alert-error">Please select at least one leave day</div>`; return false; }
      // Send the exact selected dates so backend counts only those days
      const r = await api('POST', '/leave/apply', { leave_type_id: parseInt(ltId), dates: sorted, reason });
      if (!r.ok) { document.getElementById('apply-alert').innerHTML=`<div class="alert alert-error">⚠ ${r.data.error}</div>`; return false; }
      await loadLeaveData();
      return true;
    }, 'modal-lg');

  function renderCalendar() {
    const title = document.getElementById('lc-title');
    const grid  = document.getElementById('lc-grid');
    if (!title || !grid) return;
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    title.textContent = `${monthNames[calMonth]} ${calYear}`;

    const firstDay = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth+1, 0).getDate();
    let html = '';
    for (let i=0; i<firstDay; i++) html += `<div></div>`;
    for (let d=1; d<=daysInMonth; d++) {
      const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const dObj = new Date(calYear, calMonth, d);
      const dow = dObj.getDay();
      const isWeekend = dow===0 || dow===6;
      const isPast    = dObj < today;
      const isTaken   = takenDates.has(dateStr);
      const isSel     = selectedDates.has(dateStr);
      const isHoliday = holidayDates.has(dateStr);
      const isToday   = dateStr === today.toISOString().slice(0,10);
      const holidayName = ID_HOLIDAYS[dateStr] || '';
      let cls = 'lc-day';
      if (isWeekend)        cls += ' lc-weekend';
      else if (isHoliday)   cls += ' lc-holiday';
      else if (isPast || isTaken) cls += ' lc-disabled';
      else if (isSel)       cls += ' lc-sel';
      else                  cls += ' lc-avail';
      if (isToday) cls += ' lc-today';
      const clickable = !isWeekend && !isPast && !isTaken && !isHoliday;
      const tooltip = holidayName ? `title="${holidayName}"` : '';
      html += `<div class="${cls}" ${clickable ? `onclick="lcToggle('${dateStr}')"` : ''} ${tooltip}>${d}${isHoliday ? '<span class="lc-hflag">🇮🇩</span>' : ''}</div>`;
    }
    grid.innerHTML = html;

    // Update summary
    const workDays = [...selectedDates].filter(ds => { const d=new Date(ds); return d.getDay()>0&&d.getDay()<6 && !holidayDates.has(ds); }).length;
    const calc = document.getElementById('days-calc');
    if (calc) {
      calc.textContent = workDays > 0
        ? `📅 ${workDays} working day${workDays!==1?'s':''} selected — will be deducted from your balance`
        : 'Click dates to select your leave days (weekends auto-skipped)';
    }
  }

  // Expose toggle to global scope
  window.lcToggle = (dateStr) => {
    if (selectedDates.has(dateStr)) selectedDates.delete(dateStr);
    else selectedDates.add(dateStr);
    renderCalendar();
  };

  setTimeout(() => {
    document.getElementById('lc-prev').onclick = () => {
      calMonth--; if (calMonth<0) { calMonth=11; calYear--; }
      renderCalendar();
    };
    document.getElementById('lc-next').onclick = () => {
      calMonth++; if (calMonth>11) { calMonth=0; calYear++; }
      renderCalendar();
    };
    renderCalendar();
  }, 30);
}

// ── Team Attendance (Manager / HR) ────────────────────────────────────────────
async function renderTeam() {
  const el = document.getElementById('page-content');
  const today = new Date().toISOString().slice(0,10);
  el.innerHTML = `
    <div class="page-header flex justify-between items-center">
      <div><h1>👥 Team Attendance</h1><p>Monitor your team's daily attendance</p></div>
      <input type="date" id="team-date" value="${today}" style="padding:8px 12px;border:1.5px solid var(--grey-200);border-radius:8px;font-family:DM Sans,sans-serif;font-size:14px" onchange="loadTeamData()">
    </div>
    <div id="team-content">Loading…</div>`;
  await loadTeamData();
}

async function loadTeamData() {
  const date = document.getElementById('team-date').value;
  const r = await api('GET', `/attendance/team?date=${date}`);
  const rows = r.data;
  const counts = { ontime:0, late:0, absent:0, leave:0, not_in:0 };
  rows.forEach(r => {
    if (!r.punch_in && r.status !== 'leave') counts.not_in++;
    else if (r.status) counts[r.status] = (counts[r.status]||0)+1;
  });

  const missingR = await api('GET', `/attendance/missing-checkouts?date=${date}`);
  const missing  = missingR.ok ? missingR.data : [];

  document.getElementById('team-content').innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-icon green">✅</div><div><div class="stat-num">${counts.ontime}</div><div class="stat-label">On-time</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow">⏰</div><div><div class="stat-num">${counts.late}</div><div class="stat-label">Late</div></div></div>
      <div class="stat-card"><div class="stat-icon red">❌</div><div><div class="stat-num">${counts.absent}</div><div class="stat-label">Absent</div></div></div>
      <div class="stat-card"><div class="stat-icon purple">🏖</div><div><div class="stat-num">${counts.leave}</div><div class="stat-label">On Leave</div></div></div>
      <div class="stat-card"><div class="stat-icon blue">⏳</div><div><div class="stat-num">${counts.not_in}</div><div class="stat-label">Not Punched</div></div></div>
    </div>
    ${missing.length ? `
    <div class="card mb-4" style="border:1.5px solid #fecaca">
      <div class="card-header" style="background:#fef2f2">
        <h3 style="color:#dc2626">⚠️ Missing Clock-Out (${missing.length})</h3>
        <span class="text-sm text-muted">Enter clock-out time manually</span>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Department</th><th>Shift End</th><th>Clock In</th><th>Enter Clock-Out Time</th><th></th></tr></thead>
          <tbody>
            ${missing.map(m => `<tr>
              <td><strong>${m.name}</strong><div style="font-size:11px;color:var(--text-s)">${m.employee_id}</div></td>
              <td>${m.department||'—'}</td>
              <td class="font-mono">${m.shift_end||'—'}</td>
              <td class="font-mono">${m.punch_in ? m.punch_in.slice(0,5) : '—'}</td>
              <td><input type="time" id="mc-${m.id}" style="padding:7px 10px;border:1.5px solid var(--grey-200);border-radius:8px;font-family:DM Mono,monospace;font-size:14px" value="${m.shift_end||'18:00'}"/></td>
              <td><button class="btn btn-primary btn-sm" onclick="saveManualCheckout(${m.id},'${date}')">Save</button></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>` : ''}
    <div class="card">
      <div class="card-header"><h3>Team Status for ${date}</h3><span class="text-sm text-muted">${rows.length} employees</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>Punch In</th><th>Punch Out</th><th>Location</th><th>Status</th></tr></thead>
          <tbody>
            ${rows.map(r => `<tr>
              <td><strong>${r.name}</strong></td>
              <td class="font-mono text-sm">${r.employee_id}</td>
              <td>${r.department||'—'}</td>
              <td class="font-mono">${r.punch_in ? r.punch_in.slice(0,5) : '—'}</td>
              <td class="font-mono">${r.punch_out ? r.punch_out.slice(0,5) : '—'}</td>
              <td style="font-size:12px;color:var(--text-s)">${r.geo_in ? '📍 '+r.geo_in : '—'}</td>
              <td>${r.status ? badgeHtml(r.status) : '<span class="badge badge-grey">Not punched</span>'}</td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function saveManualCheckout(userId, date) {
  const timeEl = document.getElementById(`mc-${userId}`);
  if (!timeEl || !timeEl.value) { showToast('error','Please enter a time'); return; }
  const r = await api('POST', '/overtime/manual-checkout', { user_id: userId, date, time: timeEl.value });
  if (r.ok) {
    showToast('success', 'Clock-out time saved');
    await loadTeamData();
  } else {
    showToast('error', r.data.error || 'Failed to save');
  }
}

// ── Leave Approvals ───────────────────────────────────────────────────────────
async function renderApprovals() {
  const el = document.getElementById('page-content');
  el.innerHTML = `<div class="page-header"><h1>✅ Leave Approvals</h1><p>Review and action pending leave requests</p></div><div id="approvals-content">Loading…</div>`;
  await loadApprovals();
}

async function loadApprovals() {
  const r = await api('GET', '/leave/pending');
  const rows = r.data;
  state.pendingCount = rows.length;

  document.getElementById('approvals-content').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Pending Requests</h3><span class="badge badge-yellow">${rows.length} pending</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>Department</th><th>Leave Type</th><th>Dates</th><th>Days</th><th>Reason</th><th>Submitted</th><th>Action</th></tr></thead>
          <tbody>
            ${rows.length ? rows.map(r => `<tr>
              <td><strong>${r.employee_name}</strong><div class="text-xs text-muted">${r.employee_id}</div></td>
              <td>${r.department||'—'}</td>
              <td>${r.leave_name}</td>
              <td class="text-sm">${formatLeaveDates(r)}</td>
              <td>${r.days}d</td>
              <td style="max-width:180px;font-size:13px">${r.reason||'—'}</td>
              <td class="text-sm text-muted">${r.created_at.slice(0,10)}</td>
              <td>
                <div class="flex gap-2">
                  <button class="btn btn-success btn-sm" onclick="actionLeave(${r.id},'approve')">Approve</button>
                  <button class="btn btn-danger btn-sm" onclick="actionLeave(${r.id},'reject')">Reject</button>
                </div>
              </td>
            </tr>`).join('') : '<tr><td colspan="8"><div class="empty-state"><div class="icon">🎉</div><p>No pending leave requests</p></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>`;
}

async function actionLeave(id, action) {
  let remarks = '';
  if (action === 'reject') {
    remarks = prompt('Reason for rejection (optional):') || '';
  }
  const r = await api('POST', '/leave/action', { request_id: id, action, remarks });
  if (r.ok) { await loadApprovals(); renderShell(); }
  else alert(r.data.error);
}

// ── Employees (HR Admin) ──────────────────────────────────────────────────────
async function renderEmployees() {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header flex justify-between items-center">
      <div><h1>🧑‍💼 Employees</h1><p>Manage your workforce</p></div>
      <div class="flex gap-2">
        <button class="btn btn-secondary" onclick="downloadCSVTemplate()">📥 CSV Template</button>
        <button class="btn btn-primary" onclick="showAddEmployee()">+ Add Employee</button>
      </div>
    </div>
    <div id="emp-content">Loading…</div>`;
  await loadEmployees();
}

async function loadEmployees() {
  const r = await api('GET', '/users');
  const users = r.data;
  document.getElementById('emp-content').innerHTML = `
    <div id="emp-bulk-bar" style="display:none;background:var(--surface-s);padding:12px;border-radius:6px;margin-bottom:12px;display:flex;align-items:center;justify-content:space-between;gap:12px">
      <div><strong><span id="emp-selected-count">0</span> selected</strong></div>
      <div class="flex gap-2">
        <button class="btn btn-ghost btn-sm" onclick="empBulkExport()">📥 Export Selected</button>
        <button class="btn btn-danger btn-sm" onclick="empBulkTerminate()">🗑️ Terminate Selected</button>
        <button class="btn btn-ghost btn-sm" onclick="empClearSelection()">Clear</button>
      </div>
    </div>
    <div class="card">
      <div class="card-header"><h3>All Employees</h3><span class="text-sm text-muted">${users.length} total</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr>
            <th style="width:40px"><input type="checkbox" id="emp-select-all" onchange="empToggleSelectAll(this.checked)" style="width:18px;height:18px;accent-color:var(--blue);cursor:pointer"/></th>
            <th>Name</th><th>ID</th><th>Email</th><th>Department</th><th>Hire Date</th><th>Probation Status</th><th></th>
          </tr></thead>
          <tbody>
            ${users.map(u => {
              const ini = u.name.split(' ').map(n=>n[0]).join('').slice(0,2);
              const probationBadge = u.probation_status === 'active' ? '<span style="background:#ff6b6b;color:white;padding:2px 6px;border-radius:3px;font-size:11px;font-weight:600">⚠ On Probation</span>' : '';
              return `<tr>
                <td style="width:40px;text-align:center"><input type="checkbox" class="emp-checkbox" data-emp-id="${u.id}" data-emp-name="${u.name}" onchange="empUpdateBulkBar()" style="width:18px;height:18px;accent-color:var(--blue);cursor:pointer"/></td>
                <td><div class="flex items-center gap-3">
                  <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:white;flex-shrink:0">${ini}</div>
                  <div><div style="font-weight:600">${u.name}</div><div style="font-size:11px;color:var(--text-s)">${u.email}</div></div>
                </div></td>
                <td class="font-mono text-sm">${u.employee_id}</td>
                <td class="text-sm" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${u.email}</td>
                <td>${u.department||'—'}</td>
                <td class="font-mono text-sm">${u.hire_date||'—'}</td>
                <td>${probationBadge}</td>
                <td><div class="flex gap-2">
                  <button class="btn btn-ghost btn-sm" onclick="showEditEmployee(${JSON.stringify(u).replace(/"/g,'&quot;')})">Edit</button>
                  <button class="btn btn-ghost btn-sm" onclick="empTerminateSingle(${u.id}, '${u.name}')" style="color:var(--red)">🗑️</button>
                </div></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
}

// ── Employee Termination Helpers ──
function empUpdateBulkBar() {
  const checked = document.querySelectorAll('.emp-checkbox:checked').length;
  const bar = document.getElementById('emp-bulk-bar');
  if (checked > 0) {
    bar.style.display = 'flex';
    document.getElementById('emp-selected-count').textContent = checked;
  } else {
    bar.style.display = 'none';
  }
}

function empToggleSelectAll(isChecked) {
  document.querySelectorAll('.emp-checkbox').forEach(cb => cb.checked = isChecked);
  empUpdateBulkBar();
}

function empClearSelection() {
  document.querySelectorAll('.emp-checkbox').forEach(cb => cb.checked = false);
  document.getElementById('emp-select-all').checked = false;
  empUpdateBulkBar();
}

async function empTerminateSingle(userId, userName) {
  const conf = confirm(`Terminate employee "${userName}"?\n\nYou will be able to export their data first.`);
  if (!conf) return;
  
  // Export first
  const resp = await fetch(`/api/users/export-archive/${userId}`);
  if (resp.ok) {
    const blob = await resp.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `employee_archive_${userId}_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('success', `📥 Archive downloaded for ${userName}`);
  }
  
  // Then terminate
  const r = await api('POST', '/users/terminate', {user_id: userId});
  if (r.ok) {
    showToast('success', `✅ ${userName} has been terminated`);
    await renderEmployees();
  } else {
    showToast('error', r.data.error || 'Failed to terminate');
  }
}

async function empBulkExport() {
  const selected = Array.from(document.querySelectorAll('.emp-checkbox:checked')).map(cb => ({
    id: parseInt(cb.getAttribute('data-emp-id')),
    name: cb.getAttribute('data-emp-name')
  }));
  
  if (selected.length === 0) {
    showToast('error', 'No employees selected');
    return;
  }
  
  showToast('info', `Exporting ${selected.length} employee(s)...`);
  
  for (const emp of selected) {
    const resp = await fetch(`/api/users/export-archive/${emp.id}`);
    if (resp.ok) {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `employee_archive_${emp.id}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }
  
  showToast('success', `📥 Exported ${selected.length} archive(s)`);
}

async function empBulkTerminate() {
  const selected = Array.from(document.querySelectorAll('.emp-checkbox:checked')).map(cb => ({
    id: parseInt(cb.getAttribute('data-emp-id')),
    name: cb.getAttribute('data-emp-name')
  }));
  
  if (selected.length === 0) {
    showToast('error', 'No employees selected');
    return;
  }
  
  const names = selected.map(e => e.name).join(', ');
  const conf = confirm(`Terminate ${selected.length} employee(s)?\n\n${names}\n\nYou will be able to export their data first.`);
  if (!conf) return;
  
  // Export all first
  showToast('info', `Exporting ${selected.length} archive(s)...`);
  for (const emp of selected) {
    const resp = await fetch(`/api/users/export-archive/${emp.id}`);
    if (resp.ok) {
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `employee_archive_${emp.id}_${new Date().toISOString().split('T')[0]}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    }
  }
  showToast('success', `📥 Archives downloaded`);
  
  // Then terminate
  const r = await api('POST', '/users/terminate-bulk', {user_ids: selected.map(e => e.id)});
  if (r.ok) {
    showToast('success', `✅ Terminated ${r.data.count} employee(s)`);
    await renderEmployees();
  } else {
    showToast('error', r.data.error || 'Failed to terminate');
  }
}

async function empFormHtml(alertId, u={}) {
  const usersR = await api('GET', '/users');
  const branchR = await api('GET', '/branches');
  const supervisors = usersR.data.filter(x => x.role !== 'employee');
  const branches = branchR.data;
  return `
    <div id="${alertId}"></div>
    <div class="form-row">
      <div class="form-group"><label>First Name *</label><input id="ae-first" value="${u.first_name||''}" placeholder="Jane"/></div>
      <div class="form-group"><label>Last Name *</label><input id="ae-last" value="${u.last_name||''}" placeholder="Doe"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Employee ID *</label><input id="ae-eid" value="${u.employee_id||''}" placeholder="EMP004"/></div>
      <div class="form-group"><label>Email *</label><input id="ae-email" type="email" value="${u.email||''}" placeholder="jane@company.com"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Department</label><input id="ae-dept" value="${u.department||''}" placeholder="Engineering"/></div>
      <div class="form-group"><label>Role</label>
        <select id="ae-role">
          <option value="employee" ${u.role==='employee'?'selected':''}>Employee</option>
          <option value="manager"  ${u.role==='manager'?'selected':''}>Manager</option>
          <option value="hr_admin" ${u.role==='hr_admin'?'selected':''}>HR Admin</option>
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Supervisor (for leave approval)</label>
        <select id="ae-mgr">
          <option value="">— None —</option>
          ${supervisors.map(m=>`<option value="${m.id}" ${u.manager_id==m.id?'selected':''}>${m.name} · ${m.role.replace('_',' ')}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Branch</label>
        <select id="ae-branch">
          <option value="">— None —</option>
          ${branches.map(b=>`<option value="${b.id}" ${u.branch_id==b.id?'selected':''}>${b.name}</option>`).join('')}
        </select>
      </div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Shift Start</label><input id="ae-ss" type="time" value="${u.shift_start||'09:00'}"/></div>
      <div class="form-group"><label>Shift End</label><input id="ae-se" type="time" value="${u.shift_end||'18:00'}"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Hire Date (R4b)</label><input id="ae-hd" type="date" value="${u.hire_date||''}"/></div>
      <div class="form-group"><label>Certificate Name</label><input id="ae-cert-name" value="${u.certificate_name||''}" placeholder="AWS Solutions Architect"/></div>
    </div>
    <div class="form-row">
      <div class="form-group"><label>Certificate Expiry</label><input id="ae-cert-exp" type="date" value="${u.certificate_expiry||''}"/></div>
      <div class="form-group"></div>
    </div>
    <div class="form-group">
      <label>Temp Password ${u.id?'(leave blank to keep current)':''}</label>
      <div style="display:flex;gap:8px">
        <input id="ae-pw" type="password" placeholder="Password123" style="flex:1"/>
        <button type="button" class="btn btn-ghost" onclick="togglePasswordVisibility('ae-pw')" style="padding:8px 12px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:transparent">👁️</button>
      </div>
    </div>`;
}

function togglePasswordVisibility(fieldId) {
  const field = document.getElementById(fieldId);
  if (field.type === 'password') {
    field.type = 'text';
  } else {
    field.type = 'password';
  }
}

function empFormData() {
  return {
    first_name:  document.getElementById('ae-first').value.trim(),
    last_name:   document.getElementById('ae-last').value.trim(),
    employee_id: document.getElementById('ae-eid').value.trim(),
    email:       document.getElementById('ae-email').value.trim(),
    department:  document.getElementById('ae-dept').value.trim(),
    role:        document.getElementById('ae-role').value,
    manager_id:  document.getElementById('ae-mgr').value || null,
    branch_id:   document.getElementById('ae-branch').value || null,
    shift_start: document.getElementById('ae-ss').value,
    shift_end:   document.getElementById('ae-se').value,
    password:    document.getElementById('ae-pw').value,
    hire_date:   document.getElementById('ae-hd').value || null,
    certificate_name: document.getElementById('ae-cert-name').value.trim(),
    certificate_expiry: document.getElementById('ae-cert-exp').value || null,
  };
}

async function showAddEmployee() {
  const html = await empFormHtml('add-emp-alert');
  showModal('Add New Employee', html, async () => {
    const data = empFormData();
    if (!data.first_name || !data.last_name || !data.email || !data.employee_id) {
      document.getElementById('add-emp-alert').innerHTML = `<div class="alert alert-error">First name, last name, employee ID and email are required</div>`; return false;
    }
    const r = await api('POST', '/users/add', data);
    if (!r.ok) { document.getElementById('add-emp-alert').innerHTML = `<div class="alert alert-error">⚠ ${r.data.error}</div>`; return false; }
    // R4b: Show auto-generated password in success message
    const tempPwd = r.data.temp_password ? ` Auto-generated password: <code>${r.data.temp_password}</code> (welcome email sent)` : '';
    showToast('success', `Employee added successfully.${tempPwd}`, 8000);
    await loadEmployees(); return true;
  });
}

async function showEditEmployee(u) {
  const html = await empFormHtml('edit-emp-alert', u);
  showModal(`Edit — ${u.name}`, html, async () => {
    const data = { id: u.id, ...empFormData() };
    if (!data.first_name || !data.last_name || !data.email) {
      document.getElementById('edit-emp-alert').innerHTML = `<div class="alert alert-error">Name and email are required</div>`; return false;
    }
    const r = await api('POST', '/users/update', data);
    if (!r.ok) { document.getElementById('edit-emp-alert').innerHTML = `<div class="alert alert-error">⚠ ${r.data.error}</div>`; return false; }
    showToast('success', 'Employee updated');
    await loadEmployees(); return true;
  });
}

// R4b: CSV Bulk Import Functions
function downloadCSVTemplate() {
  const link = document.createElement('a');
  link.href = '/api/users/csv-template';
  link.download = 'employee_template.csv';
  link.click();
  showToast('info', 'CSV template downloaded');
}

async function showBulkImportModal() {
  const html = `
    <div id="bulk-import-alert"></div>
    <div class="form-group">
      <label>Select CSV File</label>
      <input id="bulk-csv-file" type="file" accept=".csv" />
      <div style="font-size:12px;color:var(--text-s);margin-top:8px">
        Download the CSV template first, then fill in employee data and upload here.
      </div>
    </div>
    <div id="bulk-preview" style="display:none;margin-top:16px">
      <h4 style="margin-bottom:8px">Preview (first 5 rows):</h4>
      <div id="bulk-preview-content" style="max-height:200px;overflow-y:auto;border:1px solid var(--border);border-radius:4px;padding:8px;background:var(--bg-secondary);font-size:12px"></div>
    </div>
  `;
  showModal('Bulk Import Employees (CSV)', html, async () => {
    const file = document.getElementById('bulk-csv-file').files[0];
    if (!file) {
      document.getElementById('bulk-import-alert').innerHTML = `<div class="alert alert-error">Please select a CSV file</div>`;
      return false;
    }
    
    const formData = new FormData();
    formData.append('file', file);
    
    try {
      const response = await fetch('/api/users/bulk-import', {
        method: 'POST',
        credentials: 'include',
        body: formData
      });
      const r = await response.json();
      
      if (!response.ok || !r.ok) {
        const errors = r.errors ? r.errors.map(e => `<li>${e}</li>`).join('') : r.error;
        document.getElementById('bulk-import-alert').innerHTML = `<div class="alert alert-error">Import errors:<ul>${errors}</ul></div>`;
        return false;
      }
      
      showToast('success', `✅ Imported ${r.imported} employee(s). Welcome emails sent.`, 6000);
      await loadEmployees();
      return true;
    } catch (e) {
      document.getElementById('bulk-import-alert').innerHTML = `<div class="alert alert-error">⚠ ${e.message}</div>`;
      return false;
    }
  });
  
  // Add file change listener to show preview
  const fileInput = document.getElementById('bulk-csv-file');
  fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (ev) => {
      const csv = ev.target.result;
      const lines = csv.split('\n').filter(l => l.trim());
      const preview = lines.slice(0, 6).map(l => `<code style="display:block;padding:4px">${l.replace(/</g,'&lt;').replace(/>/g,'&gt;')}</code>`).join('');
      document.getElementById('bulk-preview').style.display = 'block';
      document.getElementById('bulk-preview-content').innerHTML = preview;
    };
    reader.readAsText(file);
  });
}


// ── Branches & Geofence ───────────────────────────────────────────────────────
async function renderBranches() {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header flex justify-between items-center">
      <div><h1>🏢 Branches & Geofence</h1><p>Set office locations for punch-in validation</p></div>
      <button class="btn btn-primary" onclick="showBranchModal()">+ Add Branch</button>
    </div>
    <div id="branch-content">Loading…</div>`;
  await loadBranches();
}

async function loadBranches() {
  const r = await api('GET', '/branches');
  const branches = r.data;
  document.getElementById('branch-content').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>Office Locations</h3><span class="text-sm text-muted">${branches.length} branch(es)</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Branch Name</th><th>Address</th><th>Coordinates</th><th>Radius</th><th></th></tr></thead>
          <tbody>
            ${branches.length ? branches.map(b => `<tr>
              <td><strong>${b.name}</strong></td>
              <td class="text-sm">${b.address||'—'}</td>
              <td class="font-mono text-sm">${b.latitude!=null ? `${b.latitude.toFixed(5)}, ${b.longitude.toFixed(5)}` : '⚠ Not set'}</td>
              <td>${b.radius_m}m</td>
              <td><div class="flex gap-2">
                <button class="btn btn-ghost btn-sm" onclick="showBranchModal(${JSON.stringify(b).replace(/"/g,'&quot;')})">Edit</button>
                <button class="btn btn-danger btn-sm" onclick="deleteBranch(${b.id},'${b.name}')">Delete</button>
              </div></td>
            </tr>`).join('') : '<tr><td colspan="5"><div class="empty-state"><div class="icon">🏢</div><p>No branches yet. Add your first office location.</p></div></td></tr>'}
          </tbody>
        </table>
      </div>
    </div>
    <div class="alert alert-info" style="margin-top:16px">
      💡 <strong>How geofencing works:</strong> Employees must be within the branch radius to punch in or out. 
      Coordinates are GPS latitude/longitude — you can get them from Google Maps (right-click any location → "What's here?").
    </div>`;
}

function showBranchModal(b={}) {
  const isEdit = !!b.id;
  showModal(isEdit ? `Edit — ${b.name}` : 'Add Branch', `
    <div id="branch-alert"></div>
    <div class="form-group"><label>Branch Name *</label><input id="br-name" value="${b.name||''}" placeholder="Head Office"/></div>
    <div class="form-group"><label>Address</label><input id="br-addr" value="${b.address||''}" placeholder="Jl. Sudirman No.1, Jakarta"/></div>
    <div class="form-row">
      <div class="form-group"><label>Latitude *</label><input id="br-lat" type="number" step="any" value="${b.latitude||''}" placeholder="-6.2088"/></div>
      <div class="form-group"><label>Longitude *</label><input id="br-lon" type="number" step="any" value="${b.longitude||''}" placeholder="106.8456"/></div>
    </div>
    <div class="form-group"><label>Allowed Radius (meters)</label><input id="br-rad" type="number" value="${b.radius_m||200}" min="50" max="5000"/></div>
    <button class="btn btn-ghost btn-sm" onclick="useMyLocation()" style="margin-top:-4px">📍 Use my current location</button>`,
    async () => {
      const data = {
        id: b.id || null,
        name: document.getElementById('br-name').value.trim(),
        address: document.getElementById('br-addr').value.trim(),
        latitude: parseFloat(document.getElementById('br-lat').value) || null,
        longitude: parseFloat(document.getElementById('br-lon').value) || null,
        radius_m: parseInt(document.getElementById('br-rad').value) || 200,
      };
      if (!data.name) { document.getElementById('branch-alert').innerHTML=`<div class="alert alert-error">Branch name is required</div>`; return false; }
      if (!data.latitude || !data.longitude) { document.getElementById('branch-alert').innerHTML=`<div class="alert alert-error">Coordinates are required for geofencing</div>`; return false; }
      const r = await api('POST', '/branches/save', data);
      if (!r.ok) { document.getElementById('branch-alert').innerHTML=`<div class="alert alert-error">⚠ ${r.data.error}</div>`; return false; }
      showToast('success', `Branch ${isEdit ? 'updated' : 'added'} successfully`);
      await loadBranches(); return true;
    });
}

async function useMyLocation() {
  const loc = await getLocation();
  if (!loc) { showToast('error', 'Could not get your location'); return; }
  document.getElementById('br-lat').value = loc.lat.toFixed(6);
  document.getElementById('br-lon').value = loc.lon.toFixed(6);
  showToast('success', `Location set: ${loc.lat.toFixed(4)}, ${loc.lon.toFixed(4)}`);
}

async function deleteBranch(id, name) {
  if (!confirm(`Delete branch "${name}"? This cannot be undone.`)) return;
  const r = await api('POST', '/branches/delete', { id });
  if (r.ok) { showToast('success', 'Branch deleted'); await loadBranches(); }
  else showToast('error', r.data.error);
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function renderSettings() {
  const el = document.getElementById('page-content');
  el.innerHTML = `<div class="page-header"><h1>⚙️ Settings</h1><p>Email notifications and system configuration</p></div><div id="settings-content">Loading…</div>`;
  const r = await api('GET', '/settings');
  const s = r.data;
  document.getElementById('settings-content').innerHTML = `
    <div class="grid-2">
      <div>
        <div class="card mb-4">
          <div class="card-header"><h3>📧 Email Notifications</h3></div>
          <div class="card-body">
            <div id="smtp-alert"></div>
            <div class="form-group" style="margin-bottom:16px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" id="s-email-on" ${s.email_enabled==='1'?'checked':''} style="width:18px;height:18px;accent-color:var(--blue)"/>
                <span style="font-weight:600;font-size:14px">Enable email notifications</span>
              </label>
              <p class="text-sm text-muted" style="margin-top:4px;margin-left:28px">Supervisors receive email when an employee submits a leave request.</p>
            </div>
            <div class="form-group"><label>Resend API Key <a href="https://resend.com/api-keys" target="_blank" style="font-size:11px;color:var(--blue);font-weight:400;margin-left:6px">Get one here →</a></label><div style="display:flex;gap:8px"><input id="s-resend-api-key" type="password" placeholder="re_..." style="flex:1"/><button type="button" class="btn btn-ghost" onclick="togglePasswordVisibility('s-resend-api-key')" style="padding:8px 12px;border:1px solid var(--border);border-radius:4px;cursor:pointer;background:transparent">👁️</button></div></div>
            <div class="form-group"><label>Sender Email (must be verified in Resend)</label><input id="s-smtp-from" value="${s.smtp_from||''}" placeholder="noreply@yourdomain.com"/></div>
            <div class="form-group"><label>App Base URL (for links in emails)</label><input id="s-base-url" value="${s.base_url||'http://localhost:5000'}" placeholder="https://yourapp.com"/></div>
            <div class="flex gap-2">
              <button class="btn btn-primary" onclick="saveSmtpSettings()">Save Email Settings</button>
              <button class="btn btn-ghost" onclick="testEmail()">Send Test Email</button>
            </div>
          </div>
        </div>
      </div>
      <div>
        <div class="card mb-4">
          <div class="card-header"><h3>📍 Geofencing</h3></div>
          <div class="card-body">
            <div class="form-group" style="margin-bottom:12px">
              <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
                <input type="checkbox" id="s-geo-on" ${s.geofence_enabled==='1'?'checked':''} style="width:18px;height:18px;accent-color:var(--blue)"/>
                <span style="font-weight:600;font-size:14px">Enable geofencing</span>
              </label>
              <p class="text-sm text-muted" style="margin-top:4px;margin-left:28px">Employees must be within branch radius to punch in/out.</p>
            </div>
            <button class="btn btn-primary" onclick="saveGeoSettings()">Save</button>
            <div style="margin-top:16px" class="alert alert-info text-sm">Manage branch locations and radius from <button class="link-btn" onclick="navigate('branches')">Branches & Geofence →</button></div>
          </div>
        </div>
        <div class="card mb-4">
          <div class="card-header"><h3>💡 Motivational Quotes & Hand Emoji</h3></div>
          <div class="card-body">
            <p class="text-sm text-muted" style="margin-bottom:16px">Set thresholds for hand emoji status and quote display.</p>
            
            <div style="margin-bottom:20px">
              <label style="display:block;margin-bottom:8px;font-weight:600;font-size:14px">On-Time Percentage Thresholds</label>
              <p class="text-sm text-muted" style="margin-bottom:12px">👎 Below left threshold | 👋 Between | 👍 Above right threshold</p>
              
              <div style="position:relative;margin:30px 0;padding:20px;background:rgba(255,255,255,0.02);border-radius:8px;border:1px solid rgba(255,255,255,0.1)">
                <!-- Tick marks (ruler) -->
                <div style="position:relative;height:20px;margin-bottom:4px;display:flex;justify-content:space-between;padding:0 10px">
                  ${[0,10,20,30,40,50,60,70,80,90,100].map(i => `<div style="position:relative;text-align:center;flex:1">
                    <div style="position:absolute;left:50%;transform:translateX(-50%);top:10px;width:1px;height:${i%10===0?'10px':'6px'};background:rgba(255,255,255,${i%10===0?'0.4':'0.2'})"></div>
                  </div>`).join('')}
                </div>
                
                <!-- Slider track -->
                <div style="position:relative;height:6px;background:rgba(255,255,255,0.1);border-radius:3px;margin-bottom:20px;cursor:pointer" id="threshold-track" onclick="handleSliderClick(event)">
                  <!-- Filled range -->
                  <div style="position:absolute;height:100%;background:linear-gradient(to right, #ef4444, #eab308, #22c55e);border-radius:3px" id="threshold-fill"></div>
                  
                  <!-- Left handle (👎) -->
                  <div style="position:absolute;top:-6px;width:20px;height:20px;background:#ef4444;border:2px solid white;border-radius:50%;cursor:grab;user-select:none" id="threshold-lower" draggable="true" onmousedown="startDrag(event, 'lower')"></div>
                  
                  <!-- Right handle (👍) -->
                  <div style="position:absolute;top:-6px;width:20px;height:20px;background:#22c55e;border:2px solid white;border-radius:50%;cursor:grab;user-select:none" id="threshold-upper" draggable="true" onmousedown="startDrag(event, 'upper')"></div>
                </div>
                
                <!-- Labels -->
                <div style="display:grid;grid-template-columns:repeat(11,1fr);gap:0;font-size:10px;color:rgba(255,255,255,0.5);text-align:center;padding:0 10px">
                  ${[0,10,20,30,40,50,60,70,80,90,100].map(i => `<div>${i}</div>`).join('')}
                </div>
              </div>
              
              <!-- Value display -->
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
                <div>
                  <label style="font-size:13px;color:rgba(255,255,255,0.7);display:block;margin-bottom:4px">👎 Thumbs Down Below</label>
                  <div style="font-size:20px;font-weight:700;color:#ef4444"><span id="thumb-down-val">${s.thumb_down_threshold || '40'}</span>%</div>
                </div>
                <div>
                  <label style="font-size:13px;color:rgba(255,255,255,0.7);display:block;margin-bottom:4px">👍 Thumbs Up Above</label>
                  <div style="font-size:20px;font-weight:700;color:#22c55e"><span id="thumb-up-val">${s.thumb_up_threshold || '80'}</span>%</div>
                </div>
              </div>
              
              <p class="text-sm text-muted" style="margin-top:12px">• 👎 Employees below left threshold see motivational quotes for 10 seconds after punch-in<br>• 👋 Employees between thresholds see wave emoji (no quote)<br>• 👍 Employees above right threshold see thumbs up (excellent!)</p>
            </div>
            
            <button class="btn btn-primary" onclick="saveThresholdSettings()">Save Thresholds</button>
          </div>
        </div>
      </div>
    </div>`;
  
  // R3: Initialize slider UI after rendering
  setTimeout(updateSliderUI, 0);
}

async function saveSmtpSettings() {
  const data = {
    email_enabled: document.getElementById('s-email-on').checked ? '1' : '0',
    resend_api_key: document.getElementById('s-resend-api-key').value,
    smtp_from: document.getElementById('s-smtp-from').value.trim(),
    base_url: document.getElementById('s-base-url').value.trim(),
  };
  const r = await api('POST', '/settings/save', data);
  if (r.ok) showToast('success', 'Email settings saved');
  else showToast('error', r.data.error);
}

async function saveGeoSettings() {
  const data = { geofence_enabled: document.getElementById('s-geo-on').checked ? '1' : '0' };
  const r = await api('POST', '/settings/save', data);
  if (r.ok) showToast('success', 'Geofence setting saved');
  else showToast('error', r.data.error);
}

async function saveThresholdSettings() {
  const lower = parseInt(document.getElementById('thumb-down-val').textContent, 10);
  const upper = parseInt(document.getElementById('thumb-up-val').textContent, 10);
  
  if (lower >= upper) {
    showToast('error', 'Thumbs Down threshold must be less than Thumbs Up threshold');
    return;
  }
  if (lower < 0 || upper > 100) {
    showToast('error', 'Thresholds must be between 0 and 100');
    return;
  }
  
  const data = {
    thumb_down_threshold: String(lower),
    thumb_up_threshold: String(upper),
  };
  const r = await api('POST', '/settings/save', data);
  if (r.ok) showToast('success', 'Thresholds saved');
  else showToast('error', r.data.error);
}

let dragState = { active: null, startX: 0, startVal: 0 };

function startDrag(e, handle) {
  dragState.active = handle;
  dragState.startX = e.clientX || e.touches?.[0]?.clientX;
  dragState.startVal = parseInt(document.getElementById(`thumb-${handle === 'lower' ? 'down' : 'up'}-val`).textContent, 10);
  
  document.addEventListener('mousemove', handleDrag);
  document.addEventListener('mouseup', stopDrag);
  e.preventDefault();
}

function stopDrag() {
  dragState.active = null;
  document.removeEventListener('mousemove', handleDrag);
  document.removeEventListener('mouseup', stopDrag);
  updateSliderUI();
}

function handleDrag(e) {
  if (!dragState.active) return;
  
  const track = document.getElementById('threshold-track');
  const trackRect = track.getBoundingClientRect();
  const currentX = e.clientX;
  const moveX = currentX - dragState.startX;
  const pxPerPercent = trackRect.width / 100;
  const movePercent = Math.round(moveX / pxPerPercent);
  const newVal = Math.max(0, Math.min(100, dragState.startVal + movePercent));
  
  const lowerVal = parseInt(document.getElementById('thumb-down-val').textContent, 10);
  const upperVal = parseInt(document.getElementById('thumb-up-val').textContent, 10);
  
  if (dragState.active === 'lower') {
    if (newVal < upperVal) document.getElementById('thumb-down-val').textContent = newVal;
  } else {
    if (newVal > lowerVal) document.getElementById('thumb-up-val').textContent = newVal;
  }
  
  updateSliderUI();
}

function handleSliderClick(e) {
  const track = document.getElementById('threshold-track');
  const trackRect = track.getBoundingClientRect();
  const clickX = e.clientX - trackRect.left;
  const clickPercent = Math.round((clickX / trackRect.width) * 100);
  
  const lowerVal = parseInt(document.getElementById('thumb-down-val').textContent, 10);
  const upperVal = parseInt(document.getElementById('thumb-up-val').textContent, 10);
  const midpoint = (lowerVal + upperVal) / 2;
  
  if (clickPercent < midpoint && clickPercent < upperVal) {
    document.getElementById('thumb-down-val').textContent = Math.max(0, Math.min(clickPercent, upperVal - 1));
  } else if (clickPercent > midpoint && clickPercent > lowerVal) {
    document.getElementById('thumb-up-val').textContent = Math.min(100, Math.max(clickPercent, lowerVal + 1));
  }
  
  updateSliderUI();
}

function updateSliderUI() {
  const lower = parseInt(document.getElementById('thumb-down-val').textContent, 10);
  const upper = parseInt(document.getElementById('thumb-up-val').textContent, 10);
  const lowerHandle = document.getElementById('threshold-lower');
  const upperHandle = document.getElementById('threshold-upper');
  const fillBar = document.getElementById('threshold-fill');
  
  const lowerPercent = lower;
  const upperPercent = upper;
  const trackWidth = document.getElementById('threshold-track').offsetWidth;
  
  lowerHandle.style.left = `calc(${lowerPercent}% - 10px)`;
  upperHandle.style.left = `calc(${upperPercent}% - 10px)`;
  fillBar.style.left = `${lowerPercent}%`;
  fillBar.style.width = `${upperPercent - lowerPercent}%`;
}


async function testEmail() {
  const html = `
    <div id="test-email-alert"></div>
    <div class="form-group">
      <label>Send Test Email To:</label>
      <input id="test-email-to" type="email" placeholder="your-email@gmail.com" style="width:100%"/>
      <div style="font-size:12px;color:var(--text-s);margin-top:8px">
        We'll send a test email to verify SMTP is configured correctly.
      </div>
    </div>
  `;
  showModal('Send Test Email', html, async () => {
    const to = document.getElementById('test-email-to').value.trim();
    if (!to) {
      document.getElementById('test-email-alert').innerHTML = `<div class="alert alert-error">Email address is required</div>`;
      return false;
    }
    if (!to.includes('@')) {
      document.getElementById('test-email-alert').innerHTML = `<div class="alert alert-error">Invalid email address</div>`;
      return false;
    }
    
    // Show loading state
    document.getElementById('test-email-alert').innerHTML = `<div class="alert alert-info">⏳ Sending test email to ${to}...</div>`;
    
    const r = await api('POST', '/settings/test-email', { to });
    
    if (r.ok && r.data.ok) {
      document.getElementById('test-email-alert').innerHTML = `<div class="alert alert-success">✅ Test email sent to ${to}! Check your inbox (may take 10-30 seconds)</div>`;
      showToast('success', `Test email sent to ${to}`, 6000);
      return true;
    } else {
      const errorMsg = r.data.error || r.data.message || 'Unknown error';
      document.getElementById('test-email-alert').innerHTML = `<div class="alert alert-error">❌ Failed to send email: ${errorMsg}</div>`;
      return false;
    }
  });
}

// ── Modal helper ──────────────────────────────────────────────────────────────
function showModal(title, bodyHtml, onConfirm, sizeClass='') {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal ${sizeClass}">
      <div class="modal-header">
        <h3>${title}</h3>
        <button class="modal-close" id="modal-close-btn">✕</button>
      </div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-footer">
        <button class="btn btn-ghost" id="modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="modal-confirm">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);

  const close = () => document.body.removeChild(overlay);
  overlay.querySelector('#modal-close-btn').onclick = close;
  overlay.querySelector('#modal-cancel').onclick = close;
  overlay.querySelector('#modal-confirm').onclick = async () => {
    const btn = overlay.querySelector('#modal-confirm');
    btn.innerHTML = '<span class="spinner"></span>';
    btn.disabled = true;
    const ok = await onConfirm();
    if (ok !== false) close();
    else { btn.innerHTML = 'Confirm'; btn.disabled = false; }
  };
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
}

// Format leave dates — show individual dates if available, otherwise show range
function formatLeaveDates(r) {
  if (r.dates_json) {
    const dates = JSON.parse(r.dates_json);
    if (dates.length === 1) {
      return `<span class="font-mono">${dates[0]}</span>`;
    }
    // Group consecutive dates into ranges for compact display
    const groups = [];
    let rangeStart = dates[0], rangePrev = dates[0];
    for (let i = 1; i < dates.length; i++) {
      const cur  = dates[i];
      const prev = new Date(rangePrev);
      // Check if cur is the next weekday after prev (skip weekends)
      let next = new Date(prev); next.setDate(next.getDate() + 1);
      while (next.getDay() === 0 || next.getDay() === 6) next.setDate(next.getDate() + 1);
      if (cur === next.toISOString().slice(0,10)) {
        rangePrev = cur; // extend current group
      } else {
        groups.push(rangeStart === rangePrev ? rangeStart : `${rangeStart} → ${rangePrev}`);
        rangeStart = rangePrev = cur;
      }
    }
    groups.push(rangeStart === rangePrev ? rangeStart : `${rangeStart} → ${rangePrev}`);
    return groups.map(g => `<span class="font-mono" style="display:block;white-space:nowrap">${g}</span>`).join('');
  }
  // Legacy: no dates_json, show range
  return `<span class="font-mono">${r.start_date}${r.end_date !== r.start_date ? ' → '+r.end_date : ''}</span>`;
}

// ── Toast notifications ───────────────────────────────────────────────────────
function showToast(type, message) {
  const existing = document.getElementById('wp-toast');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.id = 'wp-toast';
  const bg = type === 'success' ? '#10b981' : type === 'error' ? '#ef4444' : '#2563eb';
  t.style.cssText = `position:fixed;bottom:28px;right:28px;background:${bg};color:white;padding:14px 20px;border-radius:10px;font-size:14px;font-weight:600;box-shadow:0 8px 24px rgba(0,0,0,.2);z-index:9999;max-width:360px;animation:slideUp .2s ease`;
  t.textContent = message;
  document.body.appendChild(t);
  setTimeout(() => t.style.opacity='0', 3200);
  setTimeout(() => t.remove(), 3500);
}

// ── Utilities ─────────────────────────────────────────────────────────────────
function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'morning' : h < 17 ? 'afternoon' : 'evening';
}

function formatDate(d) {
  return d.toLocaleDateString('en-US', { weekday:'short', year:'numeric', month:'short', day:'numeric' });
}

function dayName(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-US', { weekday:'short' });
}

function isWeekday() {
  const d = new Date().getDay();
  return d > 0 && d < 6;
}

function calcDuration(pin, pout) {
  const [ph,pm] = pin.split(':').map(Number);
  const [oh,om] = pout.split(':').map(Number);
  const mins = (oh*60+om) - (ph*60+pm);
  if (mins < 0) return '—';
  return `${Math.floor(mins/60)}h ${mins%60}m`;
}

function statusBadge(status) {
  const map = { ontime:'✅', late:'⏰', absent:'❌', leave:'🏖', pending:'⏳', approved:'✅', rejected:'❌', approvedd:'✅', rejectedd:'❌' };
  return map[status] || status;
}

function badgeHtml(status) {
  const map = {
    ontime:   ['badge-green',  'On-time'],
    late:     ['badge-yellow', 'Late'],
    absent:   ['badge-red',    'Absent'],
    leave:    ['badge-purple', 'On Leave'],
    pending:  ['badge-yellow', 'Pending'],
    approved: ['badge-green',  'Approved'],
    approvedd:['badge-green',  'Approved'],
    rejected: ['badge-red',    'Rejected'],
    rejectedd:['badge-red',    'Rejected'],
  };
  const [cls, label] = map[status] || ['badge-grey', status];
  return `<span class="badge ${cls}">${label}</span>`;
}

function roleBadge(role) {
  const map = { employee: ['badge-blue','Employee'], manager: ['badge-green','Manager'], hr_admin: ['badge-purple','HR Admin'] };
  const [cls, label] = map[role] || ['badge-grey', role];
  return `<span class="badge ${cls}">${label}</span>`;
}



// ── Consent Modal & Acceptance ─────────────────────────────────────────────
function showConsentModal() {
  const modal = document.createElement('div');
  modal.id = 'consent-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:90%;max-width:600px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden">
      <div style="padding:24px;border-bottom:1px solid #e2e8f0;background:#f8fafc">
        <h2 style="margin:0;color:#0f172a">🔒 Kebijakan Privasi & Consent</h2>
        <p style="margin:8px 0 0;color:#64748b;font-size:14px">Kami membutuhkan persetujuan Anda untuk memproses data pribadi sesuai UU PDP</p>
      </div>
      <div style="flex:1;overflow-y:auto;padding:24px;font-size:14px;color:#334155;line-height:1.6">
        <h3 style="margin:0 0 12px;color:#0f172a">Data yang Kami Proses</h3>
        <ul style="margin:0;padding-left:20px">
          <li>Nama lengkap dan email kerja</li>
          <li>Waktu punch in/out dan lokasi GPS</li>
          <li>Riwayat permohonan cuti</li>
          <li>Informasi departemen dan posisi</li>
        </ul>
        <h3 style="margin:20px 0 12px;color:#0f172a">Hak Anda</h3>
        <ul style="margin:0;padding-left:20px">
          <li><strong>Hak Akses:</strong> Download semua data pribadi Anda</li>
          <li><strong>Hak Lupa:</strong> Minta penghapusan akun (diproses dalam 7 hari)</li>
          <li><strong>Hak Koreksi:</strong> Hubungi HR untuk memperbarui data</li>
        </ul>
        <p style="margin:20px 0 0;border-top:1px solid #e2e8f0;padding-top:20px;font-size:12px;color:#94a3b8">
          Dengan mengklik "Saya Setuju", Anda menerima <strong>Kebijakan Privasi</strong> kami dan memberikan consent untuk pemrosesan data pribadi sesuai dengan Undang-Undang Perlindungan Data Pribadi (UU PDP).
        </p>
      </div>
      <div style="padding:20px;background:#f8fafc;border-top:1px solid #e2e8f0;display:flex;gap:12px;justify-content:flex-end">
        <button onclick="doLogout()" style="padding:10px 20px;border:1px solid #cbd5e1;background:#fff;border-radius:6px;cursor:pointer;font-weight:600">Tolak & Logout</button>
        <button onclick="acceptConsentAndContinue()" style="padding:10px 20px;background:#2563eb;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">Saya Setuju</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

async function acceptConsentAndContinue() {
  const r = await api('POST', '/consent/accept');
  if (r.ok) {
    document.getElementById('consent-modal').remove();
    state.page = 'dashboard';
    await loadPendingCount();
    render();
  } else {
    alert('Gagal menyimpan consent. Silakan coba lagi.');
  }
}



// ── HR Admin: Deletion Requests Review ─────────────────────────────────────
function renderDeletionRequests() {
  if (!state.user || state.user.role !== 'hr_admin') return renderLogin();
  
  const el = document.getElementById('page-content');
  if (!pdpState.deletionRequests.length) {
    el.innerHTML = '<div style="padding:20px;text-align:center;color:#94a3b8">Tidak ada permintaan penghapusan akun</div>';
    return;
  }
  
  let html = '<div style="max-width:1000px;margin:0 auto;padding:20px"><h1 style="margin:0 0 20px">🗑️ Permintaan Penghapusan Akun</h1>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:14px">';
  html += '<thead><tr style="background:#f1f5f9">';
  html += '<th style="padding:12px;text-align:left;border-bottom:2px solid #cbd5e1">Nama</th>';
  html += '<th style="padding:12px;text-align:left;border-bottom:2px solid #cbd5e1">Email</th>';
  html += '<th style="padding:12px;text-align:left;border-bottom:2px solid #cbd5e1">Tanggal</th>';
  html += '<th style="padding:12px;text-align:left;border-bottom:2px solid #cbd5e1">Status</th>';
  html += '<th style="padding:12px;text-align:center;border-bottom:2px solid #cbd5e1">Aksi</th>';
  html += '</tr></thead><tbody>';
  
  pdpState.deletionRequests.forEach((req, idx) => {
    const status = req.status === 'pending' ? '⏳ Menunggu' : req.status === 'approved' ? '✅ Disetujui' : '❌ Ditolak';
    const canAction = req.status === 'pending';
    html += `<tr style="border-bottom:1px solid #e2e8f0">`;
    html += `<td style="padding:12px">${req.u.name}</td>`;
    html += `<td style="padding:12px">${req.u.email}</td>`;
    html += `<td style="padding:12px">${new Date(req.requested_at).toLocaleDateString('id-ID')}</td>`;
    html += `<td style="padding:12px">${status}</td>`;
    html += `<td style="padding:12px;text-align:center">`;
    if (canAction) {
      html += `<button onclick="openDeletionReview(${idx})" style="padding:6px 12px;background:#2563eb;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:13px">Review</button>`;
    }
    html += `</td>`;
    html += `</tr>`;
  });
  
  html += '</tbody></table></div>';
  el.innerHTML = html;
}

function openDeletionReview(idx) {
  const req = pdpState.deletionRequests[idx];
  const modal = document.createElement('div');
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
  modal.id = 'review-modal';
  
  modal.innerHTML = `
    <div style="background:#fff;border-radius:12px;width:90%;max-width:500px;padding:24px">
      <h2 style="margin:0 0 16px;color:#0f172a">Review Permintaan Penghapusan</h2>
      <p style="margin:0 0 8px;color:#64748b"><strong>Nama:</strong> ${req.u.name}</p>
      <p style="margin:0 0 8px;color:#64748b"><strong>Email:</strong> ${req.u.email}</p>
      <p style="margin:0 0 16px;color:#64748b"><strong>Alasan:</strong> ${req.reason || '-'}</p>
      
      <textarea id="review-notes" placeholder="Catatan review (opsional)" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-family:inherit;font-size:14px;margin-bottom:16px;resize:vertical;min-height:80px"></textarea>
      
      <div style="display:flex;gap:12px">
        <button onclick="reviewDeletion(${idx}, 'reject')" style="flex:1;padding:10px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">Tolak</button>
        <button onclick="reviewDeletion(${idx}, 'approve')" style="flex:1;padding:10px;background:#10b981;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">Setujui</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(modal);
}

async function reviewDeletion(idx, action) {
  const req = pdpState.deletionRequests[idx];
  const notes = document.getElementById('review-notes').value;
  
  const r = await api('POST', '/admin/deletion-review', {
    request_id: req.id,
    action: action,
    notes: notes
  });
  
  if (r.ok) {
    alert(action === 'approve' ? 'Permintaan disetujui. Data akan dihapus.' : 'Permintaan ditolak.');
    document.getElementById('review-modal').remove();
    await loadDeletionRequests();
    renderDeletionRequests();
  } else {
    alert('Gagal: ' + (r.data?.error || 'Unknown error'));
  }
}

async function loadDeletionRequests() {
  const r = await api('GET', '/admin/deletion-requests');
  if (r.ok) {
    pdpState.deletionRequests = r.data.map(d => ({ ...d, u: { name: d.name, email: d.email } }));
  }
}


// ── Boot ──────────────────────────────────────────────────────────────────────
initializeSession();
render();

// ── Reports Page ──────────────────────────────────────────────────────────────
async function renderReports() {
  const el   = document.getElementById('page-content');
  const role = state.user.role;
  const isManager = role === 'manager' || role === 'hr_admin';
  const thisMonth  = new Date().toISOString().slice(0,7);

  el.innerHTML = `
    <div class="page-header">
      <h1>📊 Reports</h1>
      <p>Download attendance and leave reports as PDF or Excel</p>
    </div>

    <!-- My Report (all roles) -->
    <div class="card mb-4">
      <div class="card-header">
        <h3>👤 My Attendance & Leave Report</h3>
        <span class="text-sm text-muted">PDF only</span>
      </div>
      <div class="card-body">
        <div class="flex gap-3 items-center" style="flex-wrap:wrap">
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;font-weight:600;color:var(--text-s);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Month</label>
            <input type="month" id="my-month" value="${thisMonth}" style="padding:9px 14px;border:1.5px solid var(--grey-200);border-radius:8px;font-family:DM Sans,sans-serif;font-size:14px"/>
          </div>
          <button class="btn btn-primary" style="margin-top:18px" onclick="downloadMyPDF()">
            📄 Download PDF
          </button>
        </div>
      </div>
    </div>

    <!-- Team / Company Report (manager + HR) -->
    ${isManager ? `
    <div class="card">
      <div class="card-header">
        <h3>${role === 'hr_admin' ? '🏢 Company' : '👥 Department'} Attendance & Leave Report</h3>
        <div class="flex gap-2">
          <span class="badge badge-blue">Excel</span>
          <span class="badge badge-green">PDF</span>
        </div>
      </div>
      <div class="card-body">
        <div class="flex gap-3 items-center" style="flex-wrap:wrap;margin-bottom:20px">
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;font-weight:600;color:var(--text-s);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Month</label>
            <input type="month" id="team-month" value="${thisMonth}" style="padding:9px 14px;border:1.5px solid var(--grey-200);border-radius:8px;font-family:DM Sans,sans-serif;font-size:14px"/>
          </div>
          ${role === 'hr_admin' ? `
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;font-weight:600;color:var(--text-s);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Department</label>
            <select id="team-dept" style="padding:9px 14px;border:1.5px solid var(--grey-200);border-radius:8px;font-family:DM Sans,sans-serif;font-size:14px">
              <option value="">All Departments</option>
            </select>
          </div>` : ''}
          <div class="form-group" style="margin:0">
            <label style="font-size:12px;font-weight:600;color:var(--text-s);text-transform:uppercase;letter-spacing:.05em;display:block;margin-bottom:6px">Report Type</label>
            <select id="team-type" style="padding:9px 14px;border:1.5px solid var(--grey-200);border-radius:8px;font-family:DM Sans,sans-serif;font-size:14px">
              <option value="attendance">Attendance Only</option>
              <option value="leave">Leave Only</option>
              <option value="both" selected>Attendance + Leave</option>
            </select>
          </div>
        </div>
        <div class="flex gap-2" style="flex-wrap:wrap">
          <button class="btn btn-primary" onclick="downloadTeamExcel()">📊 Download Excel</button>
          <button class="btn btn-outline" onclick="downloadTeamPDF()">📄 Download PDF</button>
        </div>
      </div>
    </div>` : ''}`;

  // Load departments for HR filter
  if (role === 'hr_admin') {
    const r = await api('GET', `/reports/team-attendance?month=${thisMonth}`);
    if (r.ok && r.data.departments) {
      const sel = document.getElementById('team-dept');
      if (sel) r.data.departments.forEach(d => {
        const o = document.createElement('option'); o.value = d; o.textContent = d; sel.appendChild(o);
      });
    }
  }
}

// ── My PDF ────────────────────────────────────────────────────────────────────
async function downloadMyPDF() {
  const month = document.getElementById('my-month').value;
  showToast('success', 'Preparing your report…');
  const r = await api('GET', `/reports/my-attendance?month=${month}`);
  if (!r.ok) { showToast('error', 'Failed to load data'); return; }
  const { attendance, leaves } = r.data;
  const [year, mon] = month.split('-');
  const monthName = new Date(year, mon-1).toLocaleString('en-US',{month:'long',year:'numeric'});

  const attRows = attendance.map(a => {
    const dur = a.punch_in && a.punch_out ? calcDuration(a.punch_in, a.punch_out) : '—';
    return `<tr>
      <td>${a.date}</td><td>${dayName(a.date)}</td>
      <td>${a.punch_in ? a.punch_in.slice(0,5) : '—'}</td>
      <td>${a.punch_out ? a.punch_out.slice(0,5) : '—'}</td>
      <td>${dur}</td>
      <td><span class="s-${a.status}">${capFirst(a.status)}</span></td>
      <td style="font-size:11px;color:#64748b">${a.geo_in||''}</td>
    </tr>`;
  }).join('');

  const leaveRows = leaves.map(l => `<tr>
    <td>${formatLeaveDates(l)}</td>
    <td>${l.leave_name}</td><td>${l.days}d</td>
    <td><span class="s-${l.status}">${capFirst(l.status)}</span></span></td>
    <td>${l.reason||'—'}</td>
  </tr>`).join('');

  // Summary
  const ontime = attendance.filter(a=>a.status==='ontime').length;
  const late   = attendance.filter(a=>a.status==='late').length;
  const absent = attendance.filter(a=>a.status==='absent').length;
  const leave  = attendance.filter(a=>a.status==='leave').length;

  printHTML(reportStyles() + `
    <div class="rpt-header">
      <div class="rpt-logo">⏱ OnTime</div>
      <h1>Attendance & Leave Report</h1>
      <p>${state.user.name} · ${state.user.employee_id} · ${state.user.department||''}</p>
      <p class="period">${monthName}</p>
    </div>
    <div class="summary-grid">
      <div class="sum-card green"><div class="sum-num">${ontime}</div><div class="sum-lbl">On-time</div></div>
      <div class="sum-card yellow"><div class="sum-num">${late}</div><div class="sum-lbl">Late</div></div>
      <div class="sum-card red"><div class="sum-num">${absent}</div><div class="sum-lbl">Absent</div></div>
      <div class="sum-card purple"><div class="sum-num">${leave}</div><div class="sum-lbl">On Leave</div></div>
    </div>
    <h2>Attendance Records</h2>
    <table><thead><tr><th>Date</th><th>Day</th><th>Clock In</th><th>Clock Out</th><th>Duration</th><th>Status</th><th>Location</th></tr></thead>
    <tbody>${attRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8">No records</td></tr>'}</tbody></table>
    ${leaves.length ? `
    <h2 style="margin-top:24px">Leave Requests</h2>
    <table><thead><tr><th>Dates</th><th>Type</th><th>Days</th><th>Status</th><th>Reason</th></tr></thead>
    <tbody>${leaveRows}</tbody></table>` : ''}
    <div class="rpt-footer">Generated by OnTime · ${new Date().toLocaleDateString()}</div>
  `);
}

// ── Team Excel ────────────────────────────────────────────────────────────────
async function downloadTeamExcel() {
  const {month, dept, type, data} = await fetchTeamData();
  if (!data) return;
  const { attendance, leaves } = data;
  const [year, mon] = month.split('-');
  const monthName = new Date(year, mon-1).toLocaleString('en-US',{month:'long',year:'numeric'});

  // Build workbook using SheetJS
  const XLSX = await loadSheetJS();
  if (!XLSX) return;

  const wb = XLSX.utils.book_new();

  // Sheet 1: Attendance
  if (type !== 'leave') {
    const attData = [
      ['Employee','ID','Department','Shift','Date','Day','Clock In','Clock Out','Duration','Status','Location']
    ];
    attendance.forEach(a => {
      const dur = a.punch_in && a.punch_out ? calcDuration(a.punch_in, a.punch_out) : '';
      attData.push([
        a.name, a.employee_id, a.department||'',
        `${a.shift_start}–${a.shift_end}`,
        a.date, dayName(a.date),
        a.punch_in ? a.punch_in.slice(0,5) : '',
        a.punch_out ? a.punch_out.slice(0,5) : '',
        dur, capFirst(a.status||''), a.geo_in||''
      ]);
    });
    const ws1 = XLSX.utils.aoa_to_sheet(attData);
    ws1['!cols'] = [18,10,14,10,12,6,10,10,10,10,20].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws1, 'Attendance');
  }

  // Sheet 2: Leave
  if (type !== 'attendance') {
    const leaveData = [
      ['Employee','ID','Department','Leave Type','Start Date','End Date','Days','Status','Reason']
    ];
    leaves.forEach(l => {
      leaveData.push([
        l.name, l.employee_id, l.department||'',
        l.leave_name, l.start_date, l.end_date,
        l.days, capFirst(l.status||''), l.reason||''
      ]);
    });
    const ws2 = XLSX.utils.aoa_to_sheet(leaveData);
    ws2['!cols'] = [18,10,14,16,12,12,6,10,30].map(w=>({wch:w}));
    XLSX.utils.book_append_sheet(wb, ws2, 'Leave Requests');
  }

  // Summary sheet
  const empMap = {};
  attendance.forEach(a => {
    if (!empMap[a.employee_id]) empMap[a.employee_id] = {name:a.name,dept:a.department||'',ontime:0,late:0,absent:0,leave:0,total:0};
    if (a.status === 'ontime') empMap[a.employee_id].ontime++;
    else if (a.status === 'late') empMap[a.employee_id].late++;
    else if (a.status === 'absent') empMap[a.employee_id].absent++;
    else if (a.status === 'leave') empMap[a.employee_id].leave++;
    empMap[a.employee_id].total++;
  });
  const sumData = [['Employee','ID','Department','On-time','Late','Absent','On Leave','Total Days']];
  Object.entries(empMap).forEach(([id,e]) => sumData.push([e.name,id,e.dept,e.ontime,e.late,e.absent,e.leave,e.total]));
  const ws3 = XLSX.utils.aoa_to_sheet(sumData);
  ws3['!cols'] = [18,10,14,10,8,8,10,10].map(w=>({wch:w}));
  XLSX.utils.book_append_sheet(wb, ws3, 'Summary');

  const fname = `OnTime_${dept||'Company'}_${month}.xlsx`;
  XLSX.writeFile(wb, fname);
  showToast('success', `Excel downloaded: ${fname}`);
}

// ── Team PDF ──────────────────────────────────────────────────────────────────
async function downloadTeamPDF() {
  const {month, dept, type, data} = await fetchTeamData();
  if (!data) return;
  const { attendance, leaves } = data;
  const [year, mon] = month.split('-');
  const monthName = new Date(year, mon-1).toLocaleString('en-US',{month:'long',year:'numeric'});
  const scope = dept || (state.user.role==='hr_admin' ? 'All Departments' : 'My Department');

  // Group by employee for summary
  const empMap = {};
  attendance.forEach(a => {
    if (!empMap[a.employee_id]) empMap[a.employee_id]={name:a.name,dept:a.department||'',ontime:0,late:0,absent:0,leave:0};
    if (a.status==='ontime') empMap[a.employee_id].ontime++;
    else if (a.status==='late') empMap[a.employee_id].late++;
    else if (a.status==='absent') empMap[a.employee_id].absent++;
    else if (a.status==='leave') empMap[a.employee_id].leave++;
  });

  const summaryRows = Object.entries(empMap).map(([id,e]) =>
    `<tr><td>${e.name}</td><td class="mono">${id}</td><td>${e.dept}</td>
    <td class="c green">${e.ontime}</td><td class="c yellow">${e.late}</td>
    <td class="c red">${e.absent}</td><td class="c purple">${e.leave}</td></tr>`
  ).join('');

  const attRows = type !== 'leave' ? attendance.map(a =>
    `<tr><td>${a.name}</td><td class="mono">${a.employee_id}</td><td>${a.department||''}</td>
    <td class="mono">${a.date}</td><td>${dayName(a.date)}</td>
    <td class="mono">${a.punch_in?a.punch_in.slice(0,5):'—'}</td>
    <td class="mono">${a.punch_out?a.punch_out.slice(0,5):'—'}</td>
    <td><span class="s-${a.status}">${capFirst(a.status||'')}</span></td></tr>`
  ).join('') : '';

  const leaveRows = type !== 'attendance' ? leaves.map(l =>
    `<tr><td>${l.name}</td><td class="mono">${l.employee_id}</td><td>${l.department||''}</td>
    <td>${l.leave_name}</td><td class="mono">${l.start_date}</td>
    <td class="c">${l.days}d</td>
    <td><span class="s-${l.status}">${capFirst(l.status||'')}</span></td>
    <td>${l.reason||'—'}</td></tr>`
  ).join('') : '';

  printHTML(reportStyles() + `
    <div class="rpt-header">
      <div class="rpt-logo">⏱ OnTime</div>
      <h1>Attendance & Leave Report</h1>
      <p>${scope}</p>
      <p class="period">${monthName}</p>
    </div>
    <h2>Summary by Employee</h2>
    <table><thead><tr><th>Employee</th><th>ID</th><th>Department</th><th>On-time</th><th>Late</th><th>Absent</th><th>On Leave</th></tr></thead>
    <tbody>${summaryRows||'<tr><td colspan="7" style="text-align:center;color:#94a3b8">No data</td></tr>'}</tbody></table>
    ${type !== 'leave' ? `
    <h2 style="margin-top:24px">Attendance Detail</h2>
    <table><thead><tr><th>Employee</th><th>ID</th><th>Dept</th><th>Date</th><th>Day</th><th>In</th><th>Out</th><th>Status</th></tr></thead>
    <tbody>${attRows||'<tr><td colspan="8" style="text-align:center;color:#94a3b8">No records</td></tr>'}</tbody></table>` : ''}
    ${type !== 'attendance' && leaves.length ? `
    <h2 style="margin-top:24px">Leave Requests</h2>
    <table><thead><tr><th>Employee</th><th>ID</th><th>Dept</th><th>Leave Type</th><th>Start</th><th>Days</th><th>Status</th><th>Reason</th></tr></thead>
    <tbody>${leaveRows}</tbody></table>` : ''}
    <div class="rpt-footer">Generated by OnTime · ${new Date().toLocaleDateString()} · ${state.user.name}</div>
  `);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
async function fetchTeamData() {
  const month = document.getElementById('team-month')?.value || new Date().toISOString().slice(0,7);
  const dept  = document.getElementById('team-dept')?.value  || '';
  const type  = document.getElementById('team-type')?.value  || 'both';
  showToast('success', 'Loading report data…');
  const r = await api('GET', `/reports/team-attendance?month=${month}&dept=${encodeURIComponent(dept)}`);
  if (!r.ok) { showToast('error', 'Failed to load data'); return {month,dept,type,data:null}; }
  return {month, dept, type, data: r.data};
}

async function loadSheetJS() {
  if (window.XLSX) return window.XLSX;
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
    s.onload  = () => resolve(window.XLSX);
    s.onerror = () => { showToast('error','Failed to load Excel library'); reject(); };
    document.head.appendChild(s);
  });
}

function printHTML(html) {
  const win = window.open('', '_blank', 'width=900,height=700');
  win.document.write(`<!DOCTYPE html><html><head><meta charset="UTF-8">
    <title>OnTime Report</title></head><body>${html}</body></html>`);
  win.document.close();
  setTimeout(() => { win.focus(); win.print(); }, 400);
}

function reportStyles() {
  return `<style>
    * { margin:0;padding:0;box-sizing:border-box; }
    body { font-family:'Segoe UI',sans-serif;font-size:12px;color:#1e293b;padding:24px; }
    .rpt-header { text-align:center;margin-bottom:24px;padding-bottom:16px;border-bottom:2px solid #e2e8f0; }
    .rpt-logo { font-size:20px;font-weight:800;color:#2563eb;margin-bottom:6px; }
    h1 { font-size:18px;font-weight:700;color:#0f172a;margin-bottom:4px; }
    .rpt-header p { color:#64748b;font-size:12px; }
    .period { font-size:14px;font-weight:600;color:#334155;margin-top:4px; }
    h2 { font-size:13px;font-weight:700;color:#0f1f3d;margin-bottom:8px;padding:6px 0;border-bottom:1px solid #e2e8f0; }
    table { width:100%;border-collapse:collapse;margin-bottom:4px;font-size:11px; }
    th { background:#f1f5f9;padding:6px 8px;text-align:left;font-weight:700;color:#475569;font-size:10px;text-transform:uppercase;letter-spacing:.04em; }
    td { padding:5px 8px;border-bottom:1px solid #f1f5f9;color:#334155; }
    tr:nth-child(even) td { background:#fafbfc; }
    .mono { font-family:monospace;font-size:11px; }
    .c { text-align:center; }
    .summary-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:20px; }
    .sum-card { text-align:center;padding:12px;border-radius:8px;border:1px solid #e2e8f0; }
    .sum-num { font-size:22px;font-weight:800; }
    .sum-lbl { font-size:11px;color:#64748b;margin-top:2px; }
    .green { background:#f0fdf4; } .green .sum-num { color:#16a34a; }
    .yellow { background:#fffbeb; } .yellow .sum-num { color:#d97706; }
    .red { background:#fef2f2; } .red .sum-num { color:#dc2626; }
    .purple { background:#f5f3ff; } .purple .sum-num { color:#7c3aed; }
    .s-ontime,.s-approved,.s-approvedd { color:#16a34a;font-weight:600; }
    .s-late,.s-pending { color:#d97706;font-weight:600; }
    .s-absent,.s-rejected,.s-rejectedd { color:#dc2626;font-weight:600; }
    .s-leave { color:#7c3aed;font-weight:600; }
    .rpt-footer { text-align:center;margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:10px; }
    @media print {
      body { padding:12px; }
      @page { margin:1cm; size:A4 landscape; }
    }
  </style>`;
}

function capFirst(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''; }

// ── Audit Log Page (HR Admin · R1) ───────────────────────────────────────────
const auditState = { limit: 50, offset: 0, total: 0, rows: [], filters: {}, users: [] };

const AUDIT_ACTIONS = [
  'login_success','login_failed','logout',
  'punch_in','punch_out','auto_checkout','manual_checkout','overtime_set',
  'leave_apply','leave_approve','leave_reject',
  'user_create','user_update','user_password_reset',
  'branch_create','branch_update','branch_delete',
  'settings_update',
  'password_reset_requested','password_reset_completed'
];

function _auditFmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    timeZone: 'Asia/Jakarta',
    year:'numeric', month:'short', day:'2-digit',
    hour:'2-digit', minute:'2-digit', second:'2-digit'
  });
}

function _auditEsc(s) {
  if (s == null) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── PDP Profile Page (Data Download & Deletion Request) ────────────────────
function renderPDP() {
  if (!state.user) return renderLogin();
  
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <h1 style="margin:0 0 24px">⚙️ Privasi & Data Saya</h1>
      
      <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;border-left:4px solid #2563eb">
        <h3 style="margin:0 0 8px;color:#0f172a">✅ Data Anda Aman</h3>
        <p style="margin:0;color:#64748b;font-size:14px">Data pribadi Anda dilindungi sesuai Undang-Undang Perlindungan Data Pribadi (UU PDP).</p>
      </div>
      
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:20px;margin-bottom:20px">
        <h3 style="margin:0 0 16px;color:#0f172a">📥 Download Data Pribadi Anda</h3>
        <p style="margin:0 0 16px;color:#64748b;font-size:14px">Dapatkan salinan semua data pribadi yang kami simpan, termasuk riwayat absensi dan permohonan cuti.</p>
        <button onclick="downloadUserData()" style="padding:10px 16px;background:#10b981;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">📥 Download Data (JSON)</button>
      </div>
      
      <div style="background:#fff;border-radius:12px;border:1px solid #e2e8f0;padding:20px;margin-bottom:20px">
        <h3 style="margin:0 0 8px;color:#0f172a">🗑️ Permintaan Penghapusan Akun</h3>
        <p style="margin:8px 0 16px;color:#64748b;font-size:14px">Kirim permintaan untuk menghapus akun Anda. Kami akan memproses dalam 7 hari kerja. <strong>Tindakan ini tidak dapat dibatalkan.</strong></p>
        <textarea id="delete-reason" placeholder="Alasan (opsional)" style="width:100%;padding:10px;border:1px solid #cbd5e1;border-radius:6px;font-family:inherit;font-size:14px;margin-bottom:12px;resize:vertical;min-height:80px"></textarea>
        <button onclick="requestDeletion()" style="padding:10px 16px;background:#ef4444;color:#fff;border:none;border-radius:6px;cursor:pointer;font-weight:600">🗑️ Minta Penghapusan Akun</button>
      </div>
      
      <div style="background:#fef2f2;border-radius:12px;border:1px solid #fecaca;padding:16px;color:#991b1b;font-size:14px">
        <strong>⚠️ Perhatian:</strong> Setelah permintaan diterima HR, data Anda akan dihapus secara permanen termasuk riwayat absensi dan cuti.
      </div>
    </div>
  `;
}

async function downloadUserData() {
  try {
    const r = await api('GET', '/user/data');
    if (r.ok) {
      const data = r.data;
      const json = JSON.stringify(data, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `data-pribadi-${state.user.employee_id}-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } else {
      alert('Gagal mengunduh data: ' + (r.data?.error || 'Unknown error'));
    }
  } catch (err) {
    console.error('Download error:', err);
    alert('Gagal mengunduh data');
  }
}

async function requestDeletion() {
  const reason = document.getElementById('delete-reason').value;
  if (!confirm('Apakah Anda yakin ingin meminta penghapusan akun? Tindakan ini tidak dapat dibatalkan.')) {
    return;
  }
  
  const r = await api('POST', '/user/delete-request', { reason });
  if (r.ok) {
    alert('Permintaan penghapusan akun telah dikirim. Tim HR akan meninjau dalam 7 hari kerja.');
    state.page = 'dashboard';
    render();
  } else {
    alert('Gagal mengirim permintaan: ' + (r.data?.error || r.data?.message || 'Unknown error'));
  }
}


async function renderAudit() {
  const el = document.getElementById('page-content');
  el.innerHTML = `
    <div class="page-header flex justify-between items-center">
      <div>
        <h1>📋 Audit Log</h1>
        <p>Compliance-grade record of every state change in OnTime</p>
      </div>
      <button class="btn btn-secondary" onclick="auditExportCSV()">⬇ Export CSV</button>
    </div>

    <div class="card" style="margin-bottom:16px;padding:0">
      <div style="padding:16px;border-bottom:1px solid #e2e8f0">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <span style="font-size:13px;font-weight:600;color:#64748b;text-transform:uppercase;letter-spacing:0.5px">🔍 Filters</span>
          <button class="btn btn-sm" style="background:none;border:none;color:#64748b;cursor:pointer;text-decoration:underline;font-size:12px" onclick="auditClear()">Clear all</button>
        </div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:140px">
            <label class="form-label" style="font-size:12px">User</label>
            <select id="aud-f-user" class="form-input" style="font-size:13px;padding:8px 10px">
              <option value="">All users</option>
            </select>
          </div>
          <div style="flex:1;min-width:140px">
            <label class="form-label" style="font-size:12px">Action</label>
            <select id="aud-f-action" class="form-input" style="font-size:13px;padding:8px 10px">
              <option value="">All actions</option>
              ${AUDIT_ACTIONS.map(a=>`<option value="${a}">${a.replace(/_/g,' ')}</option>`).join('')}
            </select>
          </div>
          <div style="flex:0.8;min-width:120px">
            <label class="form-label" style="font-size:12px">Entity</label>
            <select id="aud-f-entity" class="form-input" style="font-size:13px;padding:8px 10px">
              <option value="">Any entity</option>
              <option value="user">👤 User</option>
              <option value="leave_request">📅 Leave</option>
              <option value="attendance">⏱️ Attendance</option>
              <option value="branch">🏢 Branch</option>
              <option value="settings">⚙️ Settings</option>
            </select>
          </div>
          <div style="flex:0.9;min-width:130px">
            <label class="form-label" style="font-size:12px">From</label>
            <input type="date" id="aud-f-from" class="form-input" style="font-size:13px;padding:8px 10px">
          </div>
          <div style="flex:0.9;min-width:130px">
            <label class="form-label" style="font-size:12px">To</label>
            <input type="date" id="aud-f-to" class="form-input" style="font-size:13px;padding:8px 10px">
          </div>
          <div style="display:flex;gap:8px;align-items:flex-end">
            <button class="btn btn-primary" onclick="auditApply()" style="padding:8px 16px;font-size:13px;font-weight:600">Apply</button>
          </div>
        </div>
      </div>
      <div id="aud-active-filters" style="display:none;padding:10px 16px;background:#f0f9ff;border-bottom:1px solid #e0f2fe;font-size:12px;color:#0369a1">
        Active filters: <span id="aud-filter-badges"></span>
      </div>
    </div>

    <div class="card" style="padding:0;overflow:hidden">
      <table class="data-table" style="width:100%;border-collapse:collapse">
        <thead>
          <tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th></tr>
        </thead>
        <tbody id="aud-tbody"><tr><td colspan="5" style="text-align:center;padding:32px;color:#94a3b8">Loading…</td></tr></tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 16px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:14px;color:#64748b">
        <span id="aud-summary">—</span>
        <div style="display:flex;gap:6px;align-items:center">
          <button class="btn btn-secondary btn-sm" id="aud-prev" onclick="auditPrev()">← Prev</button>
          <span id="aud-page">Page 1</span>
          <button class="btn btn-secondary btn-sm" id="aud-next" onclick="auditNext()">Next →</button>
        </div>
      </div>
    </div>

    <div id="aud-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center">
      <div style="background:#fff;border-radius:12px;width:90%;max-width:720px;max-height:80vh;display:flex;flex-direction:column">
        <div style="padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;justify-content:space-between;align-items:center">
          <h3 style="margin:0">Audit Entry Detail</h3>
          <button onclick="document.getElementById('aud-modal').style.display='none'" style="background:none;border:none;font-size:24px;cursor:pointer;color:#64748b">×</button>
        </div>
        <div id="aud-modal-body" style="padding:20px;overflow-y:auto">—</div>
      </div>
    </div>
  `;
  // Load users for filter dropdown
  const uRes = await api('GET', '/users');
  if (uRes.ok) {
    auditState.users = uRes.data;
    const sel = document.getElementById('aud-f-user');
    uRes.data.forEach(u => {
      const o = document.createElement('option');
      o.value = u.id; o.textContent = `${u.name} (${u.email})`;
      sel.appendChild(o);
    });
  }
  await auditLoad();
}

async function auditLoad() {
  const params = new URLSearchParams();
  Object.entries(auditState.filters).forEach(([k,v]) => { if (v) params.append(k,v); });
  params.append('limit',  auditState.limit);
  params.append('offset', auditState.offset);
  const r = await api('GET', '/audit-log?' + params.toString());
  if (!r.ok) {
    document.getElementById('aud-tbody').innerHTML =
      `<tr><td colspan="5" style="text-align:center;padding:32px;color:#dc2626">Failed to load.</td></tr>`;
    return;
  }
  auditState.rows  = r.data.rows || [];
  auditState.total = r.data.total || 0;
  auditRender();
}

function auditRender() {
  const tbody = document.getElementById('aud-tbody');
  if (!auditState.rows.length) {
    tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:32px;color:#94a3b8">No entries match these filters.</td></tr>`;
  } else {
    tbody.innerHTML = auditState.rows.map((row, i) => `
      <tr style="cursor:pointer" onclick="auditDetail(${i})">
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;color:#64748b;white-space:nowrap;font-variant-numeric:tabular-nums">${_auditFmtTime(row.created_at)}</td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;font-weight:500">${_auditEsc(row.user_name)}</td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9"><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;background:#eff6ff;color:#1e40af">${_auditEsc(row.action)}</span></td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9">${_auditEsc(row.entity_type || '')}${row.entity_id ? ' #' + row.entity_id : ''}</td>
        <td style="padding:12px;border-bottom:1px solid #f1f5f9;color:#64748b">${_auditEsc(row.ip || '—')}</td>
      </tr>
    `).join('');
  }
  const start = auditState.total === 0 ? 0 : auditState.offset + 1;
  const end   = Math.min(auditState.offset + auditState.limit, auditState.total);
  document.getElementById('aud-summary').textContent = `Showing ${start}–${end} of ${auditState.total}`;
  const page  = Math.floor(auditState.offset / auditState.limit) + 1;
  const pages = Math.max(1, Math.ceil(auditState.total / auditState.limit));
  document.getElementById('aud-page').textContent = `Page ${page} of ${pages}`;
  document.getElementById('aud-prev').disabled = auditState.offset === 0;
  document.getElementById('aud-next').disabled = end >= auditState.total;
}

function auditApply() {
  auditState.filters = {
    user_id:     document.getElementById('aud-f-user').value,
    action:      document.getElementById('aud-f-action').value,
    entity_type: document.getElementById('aud-f-entity').value,
    from_date:   document.getElementById('aud-f-from').value,
    to_date:     document.getElementById('aud-f-to').value
  };
  auditState.offset = 0;
  
  // Show active filters badge
  const hasFilters = Object.values(auditState.filters).some(v => v);
  const filterDiv = document.getElementById('aud-active-filters');
  if (hasFilters) {
    const badges = Object.entries(auditState.filters)
      .filter(([k, v]) => v)
      .map(([k, v]) => {
        const labels = {
          user_id: `User: ${auditState.users.find(u => u.id == v)?.name || v}`,
          action: `Action: ${v.replace(/_/g, ' ')}`,
          entity_type: `Entity: ${v}`,
          from_date: `From: ${v}`,
          to_date: `To: ${v}`
        };
        return labels[k] || k;
      })
      .map(b => `<span style="display:inline-block;padding:3px 8px;margin:2px 4px 2px 0;background:#dbeafe;border:1px solid #93c5fd;border-radius:12px;font-weight:500">${b} ×</span>`)
      .join('');
    document.getElementById('aud-filter-badges').innerHTML = badges;
    filterDiv.style.display = 'block';
  } else {
    filterDiv.style.display = 'none';
  }
  
  auditLoad();
}

function auditClear() {
  ['aud-f-user','aud-f-action','aud-f-entity','aud-f-from','aud-f-to']
    .forEach(id => { document.getElementById(id).value = ''; });
  auditState.filters = {};
  auditState.offset  = 0;
  document.getElementById('aud-active-filters').style.display = 'none';
  auditLoad();
}

function auditPrev() {
  if (auditState.offset >= auditState.limit) {
    auditState.offset -= auditState.limit;
    auditLoad();
  }
}
function auditNext() {
  if (auditState.offset + auditState.limit < auditState.total) {
    auditState.offset += auditState.limit;
    auditLoad();
  }
}

function auditDetail(idx) {
  const row = auditState.rows[idx];
  let html = `
    <div style="display:grid;grid-template-columns:140px 1fr;gap:8px 16px;margin-bottom:16px;font-size:14px">
      <span style="color:#64748b;font-weight:500">Timestamp</span><span>${_auditFmtTime(row.created_at)}</span>
      <span style="color:#64748b;font-weight:500">User</span><span>${_auditEsc(row.user_name)} (id ${row.user_id ?? '—'})</span>
      <span style="color:#64748b;font-weight:500">Action</span><span><span style="display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;background:#eff6ff;color:#1e40af">${_auditEsc(row.action)}</span></span>
      <span style="color:#64748b;font-weight:500">Entity</span><span>${_auditEsc(row.entity_type || '—')}${row.entity_id ? ' #' + row.entity_id : ''}</span>
      <span style="color:#64748b;font-weight:500">IP</span><span>${_auditEsc(row.ip || '—')}</span>
      <span style="color:#64748b;font-weight:500">User agent</span><span style="word-break:break-all;font-size:12px">${_auditEsc(row.user_agent || '—')}</span>
    </div>
  `;
  if (row.before) {
    html += `<div style="font-size:12px;font-weight:600;color:#b91c1c;text-transform:uppercase;margin-top:8px">BEFORE</div>
             <pre style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:4px 0 12px">${_auditEsc(JSON.stringify(row.before, null, 2))}</pre>`;
  }
  if (row.after) {
    html += `<div style="font-size:12px;font-weight:600;color:#166534;text-transform:uppercase;margin-top:8px">AFTER</div>
             <pre style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:12px;font-size:12px;overflow-x:auto;margin:4px 0 12px">${_auditEsc(JSON.stringify(row.after, null, 2))}</pre>`;
  }
  if (!row.before && !row.after) {
    html += `<div style="color:#94a3b8;font-size:13px">No before/after payload for this event.</div>`;
  }
  document.getElementById('aud-modal-body').innerHTML = html;
  document.getElementById('aud-modal').style.display = 'flex';
}

function auditExportCSV() {
  window.location.href = '/api/audit-log/export';
}

// ── R2 · Consent & Data Privacy ────────────────────────────────────────────
const pdpState = { showModal: false, deleteReason: '', deletionRequests: [] };

const PRIVACY_POLICY_ID = 'id-privacy-policy';
const CURRENT_CONSENT_VERSION = '2026-05-v1';

// ── R3 · Motivational Quotes (90 quotes) ─────────────────────────────────────
const MOTIVATIONAL_QUOTES = [
  // Indonesian quotes
  "Kesuksesan dimulai dari disiplin diri. Mulai dari sekarang! 💪",
  "Jangan khawatir tentang kegagalan, khawatir tentang peluang yang terlewat.",
  "Setiap hari adalah kesempatan baru untuk menjadi lebih baik. 🌟",
  "Kerja keras hari ini adalah kesuksesan besok. Terus maju! 🚀",
  "Fokus pada apa yang bisa kamu kontrol, bukan pada apa yang tidak bisa.",
  "Ketepatan waktu adalah bentuk penghormatan kepada diri sendiri dan tim.",
  "Konsistensi adalah kunci untuk mencapai tujuan. Jangan putus semangat! 🔑",
  "Setiap hadir tepat waktu adalah kemenangan kecil menuju kesuksesan besar.",
  "Disiplin bukan hukuman, tapi investasi untuk masa depan yang lebih baik.",
  "Mulai hari ini dengan tekad kuat untuk menjadi lebih baik. 💯",
  "Waktu adalah aset paling berharga. Hargai setiap detiknya.",
  "Ketika kamu konsisten, hasil akan datang sendiri. Percaya pada proses! 🌱",
  "Setiap kegagalan adalah pelajaran menuju kesuksesan.",
  "Jangan menunda sampai besok apa yang bisa kamu lakukan hari ini.",
  "Kehadiran tepat waktu mencerminkan profesionalisme dan tanggung jawab.",
  "Bangun semangat baru setiap pagi. Hari ini adalah harimu! ☀️",
  "Perubahan dimulai dari keputusan kecil yang diambil hari ini.",
  "Kesuksesan bukan tujuan, tapi perjalanan. Nikmati setiap langkah! 🎯",
  "Apa pun tantangannya, kamu lebih kuat dari yang kamu kira.",
  "Disiplin adalah jembatan antara tujuan dan pencapaian.",
  "Setiap menit yang tidak terbuang adalah investasi untuk masa depan.",
  "Kamu memiliki kekuatan untuk mengubah situasi. Mulai sekarang! ⚡",
  "Jangan menunggu kesempatan sempurna, ciptakanlah.",
  "Kebiasaan baik adalah fondasi kesuksesan jangka panjang.",
  "Hadir tepat waktu adalah tanda menghormati waktu dan komitmen.",
  "Kemajuan kecil setiap hari menghasilkan perubahan besar. 📈",
  "Mindsetmu adalah satu-satunya batasan yang ada.",
  "Fokus pada tujuan, bukan pada keluh kesah. Bergeraklah maju! 🏃",
  "Kesuksesan dimulai dengan satu langkah kecil menuju perubahan.",
  "Jangan membandingkan dirimu dengan orang lain. Bandingkan dengan dirimu kemarin.",
  "Kepercayaan diri adalah hasil dari konsistensi dan kerja keras.",
  "Setiap hari yang hadir tepat waktu adalah bukti dedikasi dirimu.",
  "Masa depan milik mereka yang siap bekerja keras hari ini.",
  "Hambatan adalah kesempatan untuk tumbuh lebih kuat. 💎",
  "Tetap positif, tetap fokus, dan hasil akan menyusul. ✨",
  "Disiplin adalah kebebasan yang sejati.",
  "Kamu adalah desainer dari masa depanmu sendiri. Ciptakanlah!",
  "Keberhasilan dibangun dari kebiasaan-kebiasaan kecil setiap hari.",
  "Jangan tunggu mood yang sempurna, ambil tindakan sekarang.",
  "Energimu positif hari ini akan menciptakan hasil positif besok.",
  "Hadir tepat waktu bukan hanya tentang jam, tapi tentang rasa hormat.",
  "Kualitas hidupmu ditentukan oleh kualitas keputusan yang kamu ambil.",
  "Mulai dari sekarang, bukan besok. Besok adalah terlambat. 🔥",
  "Kerja keras adalah satu-satunya jalan menuju kesuksesan sejati.",
  "Jangan takut untuk memulai, takut untuk berhenti.",
  "Setiap prestasi dimulai dengan keberanian untuk mencoba.",
  
  // English quotes
  "Success is built on small daily victories. Keep going! 🌟",
  "Your discipline today is your freedom tomorrow.",
  "Don't just dream it, do it. Start today! 💪",
  "Every on-time arrival is a step toward excellence.",
  "Progress is progress, no matter how small. Keep moving! 📈",
  "Don't just watch others succeed, become one of them.",
  "Excellence is a habit, not an act. Build it now! 💎",
  "Being on time shows respect, reliability, and professionalism.",
  "You are stronger than your doubts. Keep going!",
  "Success is 1% inspiration and 99% perspiration.",
  "Focus on being better than you were yesterday.",
  "Your dedication today shapes your tomorrow.",
  "Believe in the process, trust the journey. 🌱",
  "Small steps today, giant leaps tomorrow.",
  "You are the CEO of your own life. Lead it well!",
  "Momentum is built through consistent effort.",
  "Your growth is your responsibility. Own it! 🏆",
  "Success is reserved for those who refuse to quit.",
  "Greatness is not a destination, it's a direction.",
  "You are one decision away from a different life.",
  "Keep pushing, the reward is worth it!",
  "Excellence is not a skill, it's an attitude.",
  "Your potential is infinite. Tap into it!",
  "Today's effort is tomorrow's achievement.",
  "Never settle for less than your best.",
  "You've overcome harder things before. You've got this! 💪",
  "The only way to do great work is to love what you do.",
  "Consistency beats intensity. Show up every day! 🎯",
  "You've got this. One day at a time.",
  "Your future self will thank you for today.",
  "Being on time is being respectful of everyone.",
  "Let today be the day you rise and shine. ☀️",
  "Challenges are opportunities to prove your strength.",
  "Don't wait for perfect conditions, create them.",
  "Every achievement starts with trying.",
  "Your potential is limitless. Believe! 🚀",
  "Success is a journey, enjoy the ride!",
  "The difference between now and 5 years is your choices.",
  "Discipline is choosing what you want most.",
  "You are capable of amazing things.",
  "Today is a gift. Use it wisely! 🎁",
  "The only impossible journey is the one you don't begin.",
  "Your attitude determines your altitude. Stay positive! ✈️",
  "Great things never come from comfort zones.",
  "Push yourself daily for remarkable results.",
];