// ── State ────────────────────────────────────────────────────────────────────
const state = {
  user: null,
  page: 'login',
  punchStatus: null,
  pendingCount: 0,
};

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
        <div class="hero-logo-text">WorkPulse</div>
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
        <input id="login-pw" type="password" placeholder="••••••••" value="emp123"/>
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
  await loadPendingCount();
  render();
}

// ── Forgot Password ───────────────────────────────────────────────────────────
function renderForgot() {
  document.getElementById('app').innerHTML = `
  <div class="auth-wrap">
    <div class="auth-hero">
      <div class="hero-logo">
        <div class="hero-logo-icon">⏱</div>
        <div class="hero-logo-text">WorkPulse</div>
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
      <div class="hero-logo"><div class="hero-logo-icon">⏱</div><div class="hero-logo-text">WorkPulse</div></div>
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
        <div class="sidebar-logo-text">WorkPulse <span>Attendance & Leave</span></div>
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
  }
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
async function renderDashboard() {
  const el = document.getElementById('page-content');
  el.innerHTML = `<div class="page-header"><h1>Good ${greeting()}, ${state.user.name.split(' ')[0]} 👋</h1><p>${formatDate(new Date())}</p></div><div id="dash-body"><p>Loading…</p></div>`;

  const [todayR, summaryR, balR, attR] = await Promise.all([
    api('GET', '/attendance/today'),
    api('GET', '/attendance/summary'),
    api('GET', '/leave/balance'),
    api('GET', '/attendance/me'),
  ]);

  const today = todayR.data;
  const sum   = summaryR.data;
  const bals  = balR.data;
  const att   = attR.data;

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
          <div class="punch-item"><div class="punch-item-val">${today.status ? statusBadge(today.status) : '—'}</div><div class="punch-item-lbl">STATUS</div></div>
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

  // Live clock
  const tick = () => {
    const el = document.getElementById('live-clock');
    if (el) { el.textContent = new Date().toLocaleTimeString('en-GB'); setTimeout(tick, 1000); }
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
  await renderDashboard();
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

  document.getElementById('team-content').innerHTML = `
    <div class="stats-grid" style="grid-template-columns:repeat(5,1fr);margin-bottom:20px">
      <div class="stat-card"><div class="stat-icon green">✅</div><div><div class="stat-num">${counts.ontime}</div><div class="stat-label">On-time</div></div></div>
      <div class="stat-card"><div class="stat-icon yellow">⏰</div><div><div class="stat-num">${counts.late}</div><div class="stat-label">Late</div></div></div>
      <div class="stat-card"><div class="stat-icon red">❌</div><div><div class="stat-num">${counts.absent}</div><div class="stat-label">Absent</div></div></div>
      <div class="stat-card"><div class="stat-icon purple">🏖</div><div><div class="stat-num">${counts.leave}</div><div class="stat-label">On Leave</div></div></div>
      <div class="stat-card"><div class="stat-icon blue">⏳</div><div><div class="stat-num">${counts.not_in}</div><div class="stat-label">Not Punched</div></div></div>
    </div>
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
      <button class="btn btn-primary" onclick="showAddEmployee()">+ Add Employee</button>
    </div>
    <div id="emp-content">Loading…</div>`;
  await loadEmployees();
}

async function loadEmployees() {
  const r = await api('GET', '/users');
  const users = r.data;
  document.getElementById('emp-content').innerHTML = `
    <div class="card">
      <div class="card-header"><h3>All Employees</h3><span class="text-sm text-muted">${users.length} total</span></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Name</th><th>ID</th><th>Email</th><th>Department</th><th>Supervisor</th><th>Branch</th><th>Role</th><th>Shift</th><th></th></tr></thead>
          <tbody>
            ${users.map(u => {
              const ini = u.name.split(' ').map(n=>n[0]).join('').slice(0,2);
              return `<tr>
                <td><div class="flex items-center gap-3">
                  <div style="width:34px;height:34px;border-radius:50%;background:linear-gradient(135deg,var(--blue),var(--cyan));display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;color:white;flex-shrink:0">${ini}</div>
                  <div><div style="font-weight:600">${u.name}</div><div style="font-size:11px;color:var(--text-s)">${u.email}</div></div>
                </div></td>
                <td class="font-mono text-sm">${u.employee_id}</td>
                <td class="text-sm" style="max-width:160px;overflow:hidden;text-overflow:ellipsis">${u.email}</td>
                <td>${u.department||'—'}</td>
                <td class="text-sm">${u.manager_name||'—'}</td>
                <td class="text-sm">${u.branch_name||'—'}</td>
                <td>${roleBadge(u.role)}</td>
                <td class="font-mono text-sm">${u.shift_start}–${u.shift_end}</td>
                <td><button class="btn btn-ghost btn-sm" onclick="showEditEmployee(${JSON.stringify(u).replace(/"/g,'&quot;')})">Edit</button></td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
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
    <div class="form-group"><label>Temp Password ${u.id?'(leave blank to keep current)':''}</label><input id="ae-pw" type="password" placeholder="Password123"/></div>`;
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
    showToast('success', 'Employee added successfully');
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
            <div class="form-group"><label>Gmail Address</label><input id="s-smtp-user" value="${s.smtp_user||''}" placeholder="yourapp@gmail.com"/></div>
            <div class="form-group"><label>Gmail App Password <a href="https://myaccount.google.com/apppasswords" target="_blank" style="font-size:11px;color:var(--blue);font-weight:400;margin-left:6px">Get one here →</a></label>
              <input id="s-smtp-pass" type="password" placeholder="Leave blank to keep current"/></div>
            <div class="form-group"><label>Display Name (From)</label><input id="s-smtp-from" value="${s.smtp_from||''}" placeholder="WorkPulse Notifications"/></div>
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
      </div>
    </div>`;
}

async function saveSmtpSettings() {
  const data = {
    email_enabled: document.getElementById('s-email-on').checked ? '1' : '0',
    smtp_user:  document.getElementById('s-smtp-user').value.trim(),
    smtp_pass:  document.getElementById('s-smtp-pass').value,
    smtp_from:  document.getElementById('s-smtp-from').value.trim(),
    base_url:   document.getElementById('s-base-url').value.trim(),
    smtp_host: 'smtp.gmail.com', smtp_port: '587',
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

async function testEmail() {
  const to = prompt('Send test email to:');
  if (!to) return;
  const r = await api('POST', '/settings/test-email', { to });
  if (r.ok && r.data.ok) showToast('success', 'Test email sent!');
  else showToast('error', r.data.message || 'Failed to send');
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

// ── Boot ──────────────────────────────────────────────────────────────────────
render();
