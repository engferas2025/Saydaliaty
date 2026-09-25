// app.js — منطق واجهة "صيدليتي"

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
}
function nowIso() { return new Date().toISOString(); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ar-SY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const State = {
  user: null,          // {id, name, role, pin}
  screen: 'login',
  loginPin: '',
  selectedLoginUser: null,
  period: 'day',        // day | week | month
  filterNurse: 'all',
  filterPlace: 'all',
  charts: {},
};

// ---------- Toast ----------
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove('show'), 2200);
}

// ---------- Bootstrap / seed ----------
async function ensureSeed() {
  const users = await DB.getAll('users');
  if (!users.length) {
    // مستخدم مشرف افتراضي لأول تشغيل — يقدر يضيف باقي الممرضين من الإعدادات
    await DB.put('users', { id: uid(), name: 'المشرف', role: 'admin', pin: '0000', dirty: true });
  }
}

// ---------- Router ----------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  State.screen = name;
  window.scrollTo(0, 0);
  render();
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  const isAdmin = State.user?.role === 'admin';
  const tabs = isAdmin
    ? [
        ['dashboard', 'الرئيسية', iconHome],
        ['review', 'المراجعة', iconAlert],
        ['places', 'الأماكن', iconPin],
        ['settings', 'الإعدادات', iconGear],
      ]
    : [
        ['dashboard', 'الرئيسية', iconHome],
        ['inventory', 'المستودع', iconBox],
        ['entry', 'تسجيل عملية', iconPlus],
        ['settings', 'الإعدادات', iconGear],
      ];
  bar.innerHTML = tabs.map(([id, label, icon]) => `
    <button data-tab="${id}" onclick="showScreen('${id}')">
      ${icon}
      <span>${label}</span>
      ${id === 'review' ? '<span id="review-badge-tab"></span>' : ''}
    </button>
  `).join('');
}

// ---------- Icons (inline, no external icon font) ----------
const iconHome = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 11l9-8 9 8"/><path d="M5 10v10h14V10"/></svg>`;
const iconBox = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 8l-9-5-9 5 9 5 9-5z"/><path d="M3 8v8l9 5 9-5V8"/><path d="M12 13v8"/></svg>`;
const iconPlus = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 8v8M8 12h8"/></svg>`;
const iconAlert = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 3l10 18H2L12 3z"/><path d="M12 10v4M12 17h.01"/></svg>`;
const iconPin = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-6.3 7-12a7 7 0 10-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="9" r="2.4"/></svg>`;
const iconGear = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 13.5a7.9 7.9 0 000-3l2-1.5-2-3.4-2.3 1a8 8 0 00-2.6-1.5L14 2h-4l-.5 2.6a8 8 0 00-2.6 1.5l-2.3-1-2 3.4 2 1.5a7.9 7.9 0 000 3l-2 1.5 2 3.4 2.3-1a8 8 0 002.6 1.5L10 22h4l.5-2.6a8 8 0 002.6-1.5l2.3 1 2-3.4-2-1.5z"/></svg>`;

// ============================================================
// LOGIN
// ============================================================
async function renderLogin() {
  const users = await DB.getAll('users');
  const grid = document.getElementById('login-name-grid');
  grid.innerHTML = users.map(u => `
    <button class="name-btn ${State.selectedLoginUser === u.id ? 'selected' : ''}" onclick="selectLoginUser('${u.id}')">
      <span class="avatar">${u.name.trim()[0] || '؟'}</span>
      <span>${u.name}${u.role === 'admin' ? ' (مشرف)' : ''}</span>
    </button>
  `).join('') || `<p style="color:var(--ink-soft);font-size:.85rem">لا يوجد مستخدمون بعد. تواصل مع المشرف لإضافة حسابك.</p>`;

  document.getElementById('login-pin-area').style.display = State.selectedLoginUser ? 'block' : 'none';
  renderPinDots();
}

function selectLoginUser(id) {
  State.selectedLoginUser = id;
  State.loginPin = '';
  renderLogin();
}

function renderPinDots() {
  const wrap = document.getElementById('login-pin-dots');
  wrap.innerHTML = [0, 1, 2, 3].map(i => `<span class="${i < State.loginPin.length ? 'filled' : ''}"></span>`).join('');
}

async function pinPress(d) {
  if (State.loginPin.length >= 4) return;
  State.loginPin += d;
  renderPinDots();
  if (State.loginPin.length === 4) await tryLogin();
}
function pinBackspace() {
  State.loginPin = State.loginPin.slice(0, -1);
  renderPinDots();
}

async function tryLogin() {
  const user = await DB.get('users', State.selectedLoginUser);
  if (!user || user.pin !== State.loginPin) {
    toast('الرمز غير صحيح');
    State.loginPin = '';
    renderPinDots();
    return;
  }
  State.user = user;
  if (document.getElementById('remember-me').checked) {
    localStorage.setItem('saydaliaty-session', user.id);
  }
  afterLogin();
}

function afterLogin() {
  document.getElementById('screen-login-wrap').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  document.getElementById('current-user-name').textContent = State.user.name;
  buildTabbar();
  showScreen('dashboard');
  Sync.fullSync();
}

function logout() {
  localStorage.removeItem('saydaliaty-session');
  State.user = null;
  State.selectedLoginUser = null;
  State.loginPin = '';
  document.getElementById('app').style.display = 'none';
  document.getElementById('screen-login-wrap').style.display = 'flex';
  renderLogin();
}

async function tryRestoreSession() {
  const savedId = localStorage.getItem('saydaliaty-session');
  if (!savedId) return false;
  const user = await DB.get('users', savedId);
  if (!user) return false;
  State.user = user;
  afterLogin();
  return true;
}

// ============================================================
// DASHBOARD
// ============================================================
function periodStart(period) {
  const d = new Date();
  if (period === 'day') { d.setHours(0, 0, 0, 0); }
  else if (period === 'week') { d.setDate(d.getDate() - 7); }
  else { d.setDate(d.getDate() - 30); }
  return d;
}

async function renderDashboard() {
  await Inventory.recompute();
  const [movements, medicines, users, places] = await Promise.all([
    DB.getAll('movements'), DB.getAll('medicines'), DB.getAll('users'), DB.getAll('places')
  ]);

  // فلاتر — تُعاد بناؤها في كل مرة حتى تعكس أي ممرض/مكان جديد، مع الحفاظ على الاختيار الحالي
  const nurseSel = document.getElementById('dash-filter-nurse');
  const placeSel = document.getElementById('dash-filter-place');
  const nurseKey = users.filter(u => u.role !== 'admin').map(u => u.id).join(',');
  if (nurseSel.dataset.key !== nurseKey) {
    nurseSel.innerHTML = '<option value="all">كل الممرضين</option>' + users.filter(u => u.role !== 'admin').map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    nurseSel.dataset.key = nurseKey;
    nurseSel.value = State.filterNurse;
  }
  const placeKey = places.map(p => p.name).join(',');
  if (placeSel.dataset.key !== placeKey) {
    placeSel.innerHTML = '<option value="all">كل الأماكن</option>' + places.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    placeSel.dataset.key = placeKey;
    placeSel.value = State.filterPlace;
  }

  const since = periodStart(State.period);
  let scoped = movements.filter(m => new Date(m.timestamp) >= since);
  if (State.filterNurse !== 'all') scoped = scoped.filter(m => m.nurseId === State.filterNurse);
  if (State.filterPlace !== 'all') scoped = scoped.filter(m => m.place === State.filterPlace);

  const totalIn = scoped.filter(m => m.type === 'in').reduce((s, m) => s + Number(m.qty), 0);
  const totalOut = scoped.filter(m => m.type === 'out').reduce((s, m) => s + Number(m.qty), 0);
  const remaining = medicines.reduce((s, m) => s + Math.max(0, m.quantity || 0), 0);
  const alertsCount = (await Inventory.recompute()).alerts.length;

  document.getElementById('stat-remaining').textContent = remaining.toLocaleString('ar');
  document.getElementById('stat-out').textContent = totalOut.toLocaleString('ar');
  document.getElementById('stat-items').textContent = medicines.length.toLocaleString('ar');
  document.getElementById('stat-alerts').textContent = alertsCount.toLocaleString('ar');

  drawDonut(totalIn, totalOut);
  drawTrend(scoped, State.period);
  updateReviewBadge(alertsCount);
}

function ensureChartLib(cb) {
  if (window.Chart) return cb();
  const s = document.createElement('script');
  s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js';
  s.onload = cb;
  document.head.appendChild(s);
}

function chartColors() {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark';
  return {
    primary: dark ? '#6FBFA6' : '#2F6F5E',
    amber: dark ? '#E0AA6E' : '#C8894A',
    grid: dark ? '#2B3733' : '#E7E2D6',
    text: dark ? '#A6ADA6' : '#5B655F',
  };
}

function drawDonut(totalIn, totalOut) {
  ensureChartLib(() => {
    const c = chartColors();
    const remaining = Math.max(totalIn - totalOut, 0);
    const ctx = document.getElementById('chart-donut');
    if (!ctx) return;
    if (State.charts.donut) State.charts.donut.destroy();
    State.charts.donut = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['المتبقي', 'المصروف'],
        datasets: [{ data: [remaining, totalOut], backgroundColor: [c.primary, c.amber], borderWidth: 0 }]
      },
      options: {
        cutout: '68%',
        plugins: { legend: { position: 'bottom', labels: { color: c.text, font: { family: 'Tajawal' }, padding: 14 } } }
      }
    });
  });
}

function drawTrend(scoped, period) {
  ensureChartLib(() => {
    const c = chartColors();
    const buckets = {};
    const fmt = (d) => period === 'day'
      ? d.getHours() + ':00'
      : d.toLocaleDateString('ar-SY', { day: '2-digit', month: '2-digit' });
    scoped.filter(m => m.type === 'out').forEach(m => {
      const key = fmt(new Date(m.timestamp));
      buckets[key] = (buckets[key] || 0) + Number(m.qty);
    });
    const labels = Object.keys(buckets);
    const ctx = document.getElementById('chart-trend');
    if (!ctx) return;
    if (State.charts.trend) State.charts.trend.destroy();
    State.charts.trend = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets: [{ label: 'الكمية المصروفة', data: Object.values(buckets), backgroundColor: c.primary, borderRadius: 6 }] },
      options: {
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: c.text, font: { family: 'Tajawal' } }, grid: { display: false } },
          y: { ticks: { color: c.text, font: { family: 'Tajawal' } }, grid: { color: c.grid } }
        }
      }
    });
  });
}

function setPeriod(p) {
  State.period = p;
  document.querySelectorAll('#period-seg button').forEach(b => b.classList.toggle('active', b.dataset.p === p));
  renderDashboard();
}

// ============================================================
// INVENTORY
// ============================================================
async function renderInventory() {
  const meds = await DB.getAll('medicines');
  meds.sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const list = document.getElementById('inventory-list');
  if (!meds.length) {
    list.innerHTML = `<div class="empty"><div class="glyph">📦</div><p>لا يوجد أدوية بعد. أضف أول صنف من "تسجيل عملية".</p></div>`;
    return;
  }
  list.innerHTML = meds.map(m => `
    <div class="list-row">
      <div class="main">
        <span class="title">${m.name}</span>
        <span class="meta">${m.unit || ''}</span>
      </div>
      <span class="value" style="${(m.quantity || 0) < 0 ? 'color:var(--danger)' : ''}">${(m.quantity || 0).toLocaleString('ar')}</span>
    </div>
  `).join('');
}

// ============================================================
// ENTRY (تسجيل عملية: إدخال / صرف / تسليم)
// ============================================================
State.entryType = 'in';

async function renderEntry() {
  const [meds, places, users] = await Promise.all([DB.getAll('medicines'), DB.getAll('places'), DB.getAll('users')]);
  const medSel = document.getElementById('entry-medicine');
  medSel.innerHTML = `<option value="__new__">+ إضافة دواء جديد</option>` +
    meds.sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(m => `<option value="${m.id}">${m.name} (المتبقي: ${(m.quantity || 0).toLocaleString('ar')})</option>`).join('');

  const placeSel = document.getElementById('entry-place');
  placeSel.innerHTML = places.length
    ? places.map(p => `<option value="${p.name}">${p.name}</option>`).join('')
    : `<option value="">لا يوجد أماكن — يضيفها المشرف من تبويب الأماكن</option>`;

  const nurseSel = document.getElementById('entry-to-nurse');
  nurseSel.innerHTML = users.filter(u => u.id !== State.user.id && u.role !== 'admin')
    .map(u => `<option value="${u.id}">${u.name}</option>`).join('') || `<option value="">لا يوجد ممرضين آخرين</option>`;

  onMedicineChange();
  setEntryType(State.entryType);
}

function onMedicineChange() {
  const isNew = document.getElementById('entry-medicine').value === '__new__';
  document.getElementById('new-medicine-fields').style.display = isNew ? 'block' : 'none';
}

function setEntryType(t) {
  State.entryType = t;
  document.querySelectorAll('#entry-seg button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  document.getElementById('entry-field-place').style.display = t === 'out' ? 'block' : 'none';
  document.getElementById('entry-field-to-nurse').style.display = t === 'transfer' ? 'block' : 'none';
  document.getElementById('entry-field-delivered-by').style.display = t === 'in' ? 'block' : 'none';
  document.getElementById('entry-submit').textContent = t === 'in' ? 'تسجيل الإدخال' : t === 'out' ? 'تسجيل الصرف' : 'تسجيل التسليم';
}

async function submitEntry(ev) {
  ev.preventDefault();
  const medSelVal = document.getElementById('entry-medicine').value;
  const qty = Number(document.getElementById('entry-qty').value);
  if (!qty || qty <= 0) { toast('أدخل كمية صحيحة'); return; }

  let medicineId = medSelVal, medicineName = '';
  if (medSelVal === '__new__') {
    const name = document.getElementById('new-medicine-name').value.trim();
    const unit = document.getElementById('new-medicine-unit').value.trim();
    if (!name) { toast('أدخل اسم الدواء'); return; }
    medicineId = uid();
    medicineName = name;
    await DB.put('medicines', { id: medicineId, name, unit, quantity: 0, dirty: true, createdBy: State.user.name, createdAt: nowIso() });
  } else {
    const med = await DB.get('medicines', medicineId);
    medicineName = med.name;
  }

  const base = {
    id: uid(), medicineId, medicineName, qty,
    nurseId: State.user.id, nurseName: State.user.name,
    timestamp: nowIso(), dirty: true, reviewed: false, overIssue: false,
  };

  if (State.entryType === 'in') {
    const deliveredBy = document.getElementById('entry-delivered-by').value.trim();
    if (!deliveredBy) { toast('أدخل اسم من قام بالتسليم'); return; }
    await DB.put('movements', { ...base, type: 'in', deliveredBy });
  } else if (State.entryType === 'out') {
    const place = document.getElementById('entry-place').value;
    if (!place) { toast('اختر المكان المستفيد'); return; }
    await DB.put('movements', { ...base, type: 'out', place });
  } else {
    const toNurseId = document.getElementById('entry-to-nurse').value;
    if (!toNurseId) { toast('اختر الممرض المستلم'); return; }
    const toNurse = await DB.get('users', toNurseId);
    await DB.put('movements', { ...base, type: 'transfer', fromNurseId: State.user.id, fromNurseName: State.user.name, toNurseId, toNurseName: toNurse.name });
  }

  document.getElementById('entry-form').reset();
  await Inventory.recompute();
  toast('تم الحفظ — راح يتزامن تلقائياً عند توفر الانترنت');
  showScreen('dashboard');
  Sync.fullSync();
}

// ============================================================
// REVIEW (المشرف)
// ============================================================
async function renderReview() {
  const { alerts } = await Inventory.recompute();
  const list = document.getElementById('review-list');
  if (!alerts.length) {
    list.innerHTML = `<div class="empty"><div class="glyph">✅</div><p>لا يوجد حالات تحتاج مراجعة حالياً.</p></div>`;
  } else {
    list.innerHTML = alerts.map(m => `
      <div class="card">
        <div class="list-row" style="border:none;padding-bottom:.3rem">
          <div class="main">
            <span class="title">${m.medicineName}</span>
            <span class="meta">الممرض: ${m.nurseName} — ${fmtDate(m.timestamp)}</span>
          </div>
          <span class="pill pill-alert">تجاوز المخزون</span>
        </div>
        <p style="font-size:.85rem;color:var(--ink-soft);margin-bottom:.7rem">صُرفت كمية ${m.qty} تجاوزت الرصيد المسجّل وقت التنفيذ${m.place ? ' — المكان: ' + m.place : ''}</p>
        <button class="btn btn-outline" onclick="markReviewed('${m.id}')">تمّت المراجعة</button>
      </div>
    `).join('');
  }
  updateReviewBadge(alerts.length);
}

async function markReviewed(id) {
  const mv = await DB.get('movements', id);
  mv.reviewed = true;
  mv.dirty = true;
  await DB.put('movements', mv);
  await Inventory.recompute();
  renderReview();
  Sync.fullSync();
}

function updateReviewBadge(count) {
  const iconBadge = document.getElementById('review-badge-icon');
  const tabBadge = document.getElementById('review-badge-tab');
  if (iconBadge) iconBadge.innerHTML = count ? `<span class="badge-dot">${count}</span>` : '';
  if (tabBadge) tabBadge.innerHTML = count ? `<span class="badge-dot" style="position:static;display:inline-flex;margin-top:2px">${count}</span>` : '';
}

// ============================================================
// PLACES (المشرف)
// ============================================================
async function renderPlaces() {
  const places = await DB.getAll('places');
  const list = document.getElementById('places-list');
  list.innerHTML = places.length ? places.map(p => `
    <div class="list-row">
      <span class="title">${p.name}</span>
      <button class="btn-ghost" onclick="deletePlace('${p.id}')">حذف</button>
    </div>
  `).join('') : `<div class="empty"><div class="glyph">📍</div><p>لم تُضف أي أماكن بعد.</p></div>`;
}

async function addPlace(ev) {
  ev.preventDefault();
  const input = document.getElementById('new-place-name');
  const name = input.value.trim();
  if (!name) return;
  await DB.put('places', { id: uid(), name, dirty: true });
  input.value = '';
  renderPlaces();
  Sync.fullSync();
}

async function deletePlace(id) {
  await DB.delete('places', id);
  renderPlaces();
}

// ============================================================
// SETTINGS
// ============================================================
async function renderSettings() {
  document.getElementById('settings-user-name').textContent = State.user.name;
  document.getElementById('settings-user-role').textContent = State.user.role === 'admin' ? 'مشرف' : 'ممرض';
  const lastSync = await DB.getMeta('lastSync');
  document.getElementById('settings-last-sync').textContent = lastSync ? fmtDate(lastSync) : 'لم تتم أي مزامنة بعد';
  document.getElementById('settings-api-url').value = await Sync.getEndpoint();
  document.getElementById('font-scale-label').textContent = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) * 100) + '%';

  const isAdmin = State.user.role === 'admin';
  document.getElementById('settings-admin-only').style.display = isAdmin ? 'block' : 'none';
  if (isAdmin) renderUsersAdmin();
}

async function renderUsersAdmin() {
  const users = await DB.getAll('users');
  const list = document.getElementById('users-admin-list');
  list.innerHTML = users.map(u => `
    <div class="list-row">
      <div class="main"><span class="title">${u.name}</span><span class="meta">${u.role === 'admin' ? 'مشرف' : 'ممرض'} — رمز: ${u.pin}</span></div>
      ${u.id !== State.user.id ? `<button class="btn-ghost" onclick="deleteUser('${u.id}')">حذف</button>` : ''}
    </div>
  `).join('');
}

async function addNurse(ev) {
  ev.preventDefault();
  const name = document.getElementById('new-nurse-name').value.trim();
  const pin = document.getElementById('new-nurse-pin').value.trim();
  if (!name || pin.length !== 4) { toast('أدخل اسم ورمز مكوّن من 4 أرقام'); return; }
  await DB.put('users', { id: uid(), name, role: 'nurse', pin, dirty: true });
  document.getElementById('add-nurse-form').reset();
  renderUsersAdmin();
  toast('تمت إضافة الممرض');
  Sync.fullSync();
}

async function deleteUser(id) {
  await DB.delete('users', id);
  renderUsersAdmin();
}

function setTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('saydaliaty-theme', theme);
  document.querySelectorAll('#theme-seg button').forEach(b => b.classList.toggle('active', b.dataset.theme === theme));
  if (State.screen === 'dashboard') renderDashboard();
}

function changeFontScale(delta) {
  let scale = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) || 1;
  scale = Math.min(1.3, Math.max(0.85, scale + delta));
  document.documentElement.style.setProperty('--font-scale', scale.toFixed(2));
  localStorage.setItem('saydaliaty-font-scale', scale.toFixed(2));
  document.getElementById('font-scale-label').textContent = Math.round(scale * 100) + '%';
}

async function saveApiUrl() {
  const val = document.getElementById('settings-api-url').value;
  await Sync.setEndpoint(val);
  toast('تم حفظ رابط المزامنة');
  Sync.fullSync();
}

let deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById('install-btn');
  if (btn) btn.style.display = 'block';
});
async function installApp() {
  if (!deferredInstallPrompt) { toast('التثبيت غير متاح على هذا المتصفح حالياً — جرّب "إضافة إلى الشاشة الرئيسية" من قائمة المتصفح'); return; }
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
}

// ============================================================
// RENDER DISPATCH
// ============================================================
function render() {
  if (!State.user) return;
  const map = {
    dashboard: renderDashboard,
    inventory: renderInventory,
    entry: renderEntry,
    review: renderReview,
    places: renderPlaces,
    settings: renderSettings,
  };
  (map[State.screen] || (() => {}))();
}

// ============================================================
// INIT
// ============================================================
async function init() {
  const savedTheme = localStorage.getItem('saydaliaty-theme') || 'light';
  setTheme(savedTheme);
  const savedScale = localStorage.getItem('saydaliaty-font-scale');
  if (savedScale) document.documentElement.style.setProperty('--font-scale', savedScale);

  await ensureSeed();

  Sync.onChange((status) => {
    const banner = document.getElementById('offline-banner');
    if (status === 'offline') banner.classList.add('show');
    if (status === 'online' || status === 'synced') banner.classList.remove('show');
    if (status === 'synced') { render(); }
  });
  Sync.init();
  document.getElementById('offline-banner').classList.toggle('show', !navigator.onLine);

  const restored = await tryRestoreSession();
  if (!restored) {
    document.getElementById('screen-login-wrap').style.display = 'flex';
    renderLogin();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
