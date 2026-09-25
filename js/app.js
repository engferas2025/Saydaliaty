// app.js — منطق واجهة "صيدليتي"

function uid() {
  return (crypto.randomUUID ? crypto.randomUUID() : 'id-' + Date.now() + '-' + Math.random().toString(16).slice(2));
}
function nowIso() { return new Date().toISOString(); }
function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleString('ar-SY', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}
function pad2(n) { return String(n).padStart(2, '0'); }
function updateClock() {
  const d = new Date();
  const dateStr = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  let h = d.getHours();
  const ampm = h >= 12 ? 'م' : 'ص';
  h = h % 12; if (h === 0) h = 12;
  const timeStr = `${pad2(h)}:${pad2(d.getMinutes())} ${ampm}`;
  const el = document.getElementById('topbar-datetime');
  if (el) el.textContent = `${dateStr}  —  ${timeStr}`;
}
function normalizePhone(phone) {
  return (phone || '').replace(/[^\d]/g, '');
}

const State = {
  user: null,          // {id, name, role, pin}
  screen: 'login',
  loginPin: '',
  selectedLoginUser: null,
  period: 'day',        // day | week | month
  filterNurse: 'all',
  filterPlace: 'all',
  filterMedicine: 'all',
  charts: {},
  newUserRole: 'nurse',
  apiUrlUnlocked: false,
  captchaSum: null,
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
    await DB.put('users', { id: uid(), name: 'المشرف', role: 'admin', pin: '0000', active: true, dirty: true });
  }
  // حساب المطوّر — ثابت، مخفي عن قوائم الدخول والإدارة، صلاحياته أعلى من المشرف
  const dev = await DB.get('users', 'dev-fhm');
  if (!dev) {
    await DB.put('users', { id: 'dev-fhm', name: 'FHM', role: 'developer', pin: '222388', active: true, dirty: true });
  }
}

// ---------- Router ----------
function showScreen(name) {
  const prev = State.screen;
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  State.screen = name;
  if (name === 'settings' && prev !== 'settings') State.apiUrlUnlocked = false;
  window.scrollTo(0, 0);
  render();
}

function buildTabbar() {
  const bar = document.getElementById('tabbar');
  const isAdmin = State.user?.role === 'admin' || State.user?.role === 'developer';
  const tabs = isAdmin
    ? [
        ['dashboard', 'الرئيسية', iconHome],
        ['review', 'المراجعة', iconAlert],
        ['log', 'السجل', iconLog],
        ['places', 'الأماكن', iconPin],
        ['settings', 'الإعدادات', iconGear],
      ]
    : [
        ['dashboard', 'الرئيسية', iconHome],
        ['inventory', 'المستودع', iconBox],
        ['entry', 'تسجيل عملية', iconPlus],
        ['log', 'السجل', iconLog],
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
const iconLog = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 6h16M4 12h16M4 18h10"/></svg>`;

// ---------- نافذة سفلية عامة (Sheet) ----------
function openSheet(html) {
  document.getElementById('sheet-content').innerHTML = `<div class="sheet-handle"></div>` + html;
  document.getElementById('sheet-backdrop').classList.add('show');
}
function closeSheet() { document.getElementById('sheet-backdrop').classList.remove('show'); }
function closeSheetBackdrop(e) { if (e.target.id === 'sheet-backdrop') closeSheet(); }

// ============================================================
// LOGIN
// ============================================================
async function renderLogin() {
  const users = (await DB.getAll('users')).filter(u => u.role !== 'developer' && u.active !== false);
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
  if (!user || user.pin !== State.loginPin || user.active === false) {
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
  maybeShowInstallBanner();
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
  if (!user || user.active === false) { localStorage.removeItem('saydaliaty-session'); return false; }
  State.user = user;
  afterLogin();
  return true;
}

function toggleAltLogin() {
  const el = document.getElementById('login-alt-form');
  el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

async function altLogin() {
  const name = document.getElementById('alt-login-name').value.trim().toLowerCase();
  const pass = document.getElementById('alt-login-pass').value.trim();
  if (!name || !pass) return;
  const users = await DB.getAll('users');
  const user = users.find(u => u.name.trim().toLowerCase() === name && String(u.pin) === pass);
  if (!user) { toast('بيانات الدخول غير صحيحة'); return; }
  if (user.active === false) { toast('هذا الحساب معطل'); return; }
  State.user = user;
  if (document.getElementById('remember-me').checked) localStorage.setItem('saydaliaty-session', user.id);
  afterLogin();
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

async function getScopedMovements() {
  const [movements, medicines, users, places] = await Promise.all([
    DB.getAll('movements'), DB.getAll('medicines'), DB.getAll('users'), DB.getAll('places')
  ]);
  const since = periodStart(State.period);
  let scoped = movements.filter(m => new Date(m.timestamp) >= since);
  if (State.filterNurse !== 'all') scoped = scoped.filter(m => m.nurseId === State.filterNurse);
  if (State.filterPlace !== 'all') scoped = scoped.filter(m => m.place === State.filterPlace);
  if (State.filterMedicine !== 'all') scoped = scoped.filter(m => m.medicineId === State.filterMedicine);
  return { scoped, movements, medicines, users, places, since };
}

async function renderDashboard() {
  await Inventory.recompute();
  const { scoped, medicines, users, places } = await getScopedMovements();

  // فلاتر — تُعاد بناؤها في كل مرة حتى تعكس أي ممرض/مكان جديد، مع الحفاظ على الاختيار الحالي
  const nurseSel = document.getElementById('dash-filter-nurse');
  const placeSel = document.getElementById('dash-filter-place');
  const nurseKey = users.filter(u => u.role === 'nurse').map(u => u.id).join(',');
  if (nurseSel.dataset.key !== nurseKey) {
    nurseSel.innerHTML = '<option value="all">كل الممرضين</option>' + users.filter(u => u.role === 'nurse').map(u => `<option value="${u.id}">${u.name}</option>`).join('');
    nurseSel.dataset.key = nurseKey;
    nurseSel.value = State.filterNurse;
  }
  const placeKey = places.map(p => p.name).join(',');
  if (placeSel.dataset.key !== placeKey) {
    placeSel.innerHTML = '<option value="all">كل الأماكن</option>' + places.map(p => `<option value="${p.name}">${p.name}</option>`).join('');
    placeSel.dataset.key = placeKey;
    placeSel.value = State.filterPlace;
  }
  const medSel = document.getElementById('dash-filter-medicine');
  const medKey = medicines.map(m => m.id).join(',');
  if (medSel.dataset.key !== medKey) {
    medSel.innerHTML = '<option value="all">كل الأدوية</option>' + medicines.sort((a, b) => a.name.localeCompare(b.name, 'ar')).map(m => `<option value="${m.id}">${m.name}</option>`).join('');
    medSel.dataset.key = medKey;
    medSel.value = State.filterMedicine;
  }

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
// REPORTS (PDF + WhatsApp)
// ============================================================
const periodLabels = { day: 'اليوم', week: 'آخر أسبوع', month: 'آخر شهر' };

async function buildReportData() {
  const { scoped, users, places } = await getScopedMovements();
  const totalOut = scoped.filter(m => m.type === 'out').reduce((s, m) => s + Number(m.qty), 0);
  const totalIn = scoped.filter(m => m.type === 'in').reduce((s, m) => s + Number(m.qty), 0);

  const byMedicine = {};
  scoped.forEach(m => {
    if (!byMedicine[m.medicineName]) byMedicine[m.medicineName] = { in: 0, out: 0 };
    if (m.type === 'in') byMedicine[m.medicineName].in += Number(m.qty);
    if (m.type === 'out') byMedicine[m.medicineName].out += Number(m.qty);
  });

  const nurseLabel = State.filterNurse === 'all' ? 'كل الممرضين' : (users.find(u => u.id === State.filterNurse)?.name || '');
  const placeLabel = State.filterPlace === 'all' ? 'كل الأماكن' : State.filterPlace;

  return {
    generatedAt: fmtDate(nowIso()),
    periodLabel: periodLabels[State.period],
    nurseLabel, placeLabel,
    totalIn, totalOut,
    rows: Object.entries(byMedicine).map(([name, v]) => ({ name, ...v })),
  };
}

function reportHtml(data) {
  const rows = data.rows.map(r => `
    <tr><td>${r.name}</td><td>${r.in.toLocaleString('ar')}</td><td>${r.out.toLocaleString('ar')}</td></tr>
  `).join('') || `<tr><td colspan="3" style="text-align:center;color:#888">لا توجد حركات بهذه الفترة</td></tr>`;
  return `
  <!DOCTYPE html><html lang="ar" dir="rtl"><head><meta charset="UTF-8">
  <style>
    body{font-family:Tahoma,Arial,sans-serif;padding:24px;color:#1C2321;direction:rtl}
    h1{color:#2F6F5E;margin-bottom:4px}
    .meta{color:#5B655F;font-size:13px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse;margin-top:12px}
    th,td{border:1px solid #DDD8CC;padding:8px 10px;text-align:right;font-size:14px}
    th{background:#E4EEE9}
    .stats{display:flex;gap:16px;margin:16px 0}
    .stat{border:1px solid #DDD8CC;border-radius:10px;padding:10px 16px}
    .stat b{display:block;font-size:20px;color:#2F6F5E}
  </style></head><body>
    <h1>صيدليتي — تقرير التوزيع</h1>
    <div class="meta">الفترة: ${data.periodLabel} — الممرض: ${data.nurseLabel} — المكان: ${data.placeLabel} — تاريخ الإصدار: ${data.generatedAt}</div>
    <div class="stats">
      <div class="stat">إجمالي المُدخل<b>${data.totalIn.toLocaleString('ar')}</b></div>
      <div class="stat">إجمالي المصروف<b>${data.totalOut.toLocaleString('ar')}</b></div>
    </div>
    <table><thead><tr><th>الدواء</th><th>إدخال</th><th>صرف</th></tr></thead><tbody>${rows}</tbody></table>
  </body></html>`;
}

async function downloadReportPdf() {
  const data = await buildReportData();
  const iframe = document.createElement('iframe');
  iframe.style.position = 'fixed';
  iframe.style.left = '-9999px';
  document.body.appendChild(iframe);
  iframe.srcdoc = reportHtml(data);
  iframe.onload = () => {
    setTimeout(() => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      setTimeout(() => document.body.removeChild(iframe), 1000);
    }, 300);
  };
  toast('اختر "حفظ كـ PDF" من نافذة الطباعة');
}

function reportWhatsappText(data) {
  const lines = [
    `📋 تقرير صيدليتي`,
    `الفترة: ${data.periodLabel}`,
    `الممرض: ${data.nurseLabel} — المكان: ${data.placeLabel}`,
    ``,
    `إجمالي المُدخل: ${data.totalIn}`,
    `إجمالي المصروف: ${data.totalOut}`,
    ``,
  ];
  data.rows.forEach(r => lines.push(`• ${r.name}: إدخال ${r.in} — صرف ${r.out}`));
  lines.push('', `تاريخ الإصدار: ${data.generatedAt}`);
  return lines.join('\n');
}

async function shareReportWhatsapp() {
  const data = await buildReportData();
  const text = reportWhatsappText(data);

  if (State.user.role === 'admin') {
    if (State.filterNurse !== 'all') {
      const nurse = (await DB.getAll('users')).find(u => u.id === State.filterNurse);
      return sendReportTo(nurse, text);
    }
    const nurses = (await DB.getAll('users')).filter(u => u.role === 'nurse');
    if (!nurses.length) { toast('لا يوجد ممرضين لإرسال التقرير لهم'); return; }
    openSheet(`
      <h3 style="margin-bottom:.8rem">إرسال إلى</h3>
      ${nurses.map(n => `
        <button class="name-btn" style="width:100%;margin-bottom:.5rem" onclick='closeSheet();sendReportToId("${n.id}")'>
          <span class="avatar">${n.name.trim()[0] || '؟'}</span><span>${n.name}${n.phone ? '' : ' (بدون رقم هاتف)'}</span>
        </button>
      `).join('')}
    `);
  } else {
    const admins = (await DB.getAll('users')).filter(u => u.role === 'admin');
    const admin = admins.find(a => a.phone) || admins[0];
    return sendReportTo(admin, text);
  }
}

async function sendReportToId(id) {
  const user = await DB.get('users', id);
  const data = await buildReportData();
  sendReportTo(user, reportWhatsappText(data));
}

function sendReportTo(user, text) {
  if (!user || !user.phone) { toast('لا يوجد رقم واتساب مسجّل لهذا المستخدم — أضفه من الإعدادات'); return; }
  window.open(`https://wa.me/${user.phone}?text=${encodeURIComponent(text)}`, '_blank');
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
let _medsCache = [];

async function renderEntry() {
  const [meds, places, users] = await Promise.all([DB.getAll('medicines'), DB.getAll('places'), DB.getAll('users')]);
  _medsCache = meds;

  const medDatalist = document.getElementById('medicine-options');
  medDatalist.innerHTML = meds.sort((a, b) => a.name.localeCompare(b.name, 'ar'))
    .map(m => `<option value="${m.name}">${(m.quantity || 0).toLocaleString('ar')} متبقي</option>`).join('');
  document.getElementById('entry-medicine-input').value = '';

  const placeDatalist = document.getElementById('place-options');
  placeDatalist.innerHTML = places.map(p => `<option value="${p.name}">`).join('');
  document.getElementById('entry-place-input').value = '';
  document.getElementById('entry-place-input').placeholder = places.length ? 'اكتب أو اختر اسم المكان' : 'لا يوجد أماكن — يضيفها المشرف من تبويب الأماكن';

  const nurseSel = document.getElementById('entry-to-nurse');
  nurseSel.innerHTML = users.filter(u => u.id !== State.user.id && u.role === 'nurse')
    .map(u => `<option value="${u.id}">${u.name}</option>`).join('') || `<option value="">لا يوجد ممرضين آخرين</option>`;

  onMedicineInputChange();
  setEntryType(State.entryType);
}

function findMedicineByName(name) {
  const norm = name.trim().toLowerCase();
  return _medsCache.find(m => m.name.trim().toLowerCase() === norm);
}

function onMedicineInputChange() {
  const typed = document.getElementById('entry-medicine-input').value.trim();
  const match = typed ? findMedicineByName(typed) : null;
  document.getElementById('new-medicine-fields').style.display = (typed && !match) ? 'block' : 'none';
}

function setEntryType(t) {
  State.entryType = t;
  document.querySelectorAll('#entry-seg button').forEach(b => b.classList.toggle('active', b.dataset.t === t));
  document.getElementById('entry-field-place').style.display = t === 'out' ? 'block' : 'none';
  document.getElementById('entry-field-to-nurse').style.display = t === 'transfer' ? 'block' : 'none';
  document.getElementById('entry-field-delivered-by').style.display = t === 'in' ? 'block' : 'none';
  document.getElementById('entry-submit').textContent = t === 'in' ? 'تسجيل الإدخال' : t === 'out' ? 'تسجيل الصرف' : 'تسجيل التسليم';
  document.getElementById('entry-submit').disabled = false; // إعادة تفعيل الزر كل ما نفتح الشاشة أو نبدّل النوع
}

async function submitEntry(ev) {
  ev.preventDefault();
  const medicineTyped = document.getElementById('entry-medicine-input').value.trim();
  const qty = Number(document.getElementById('entry-qty').value);
  if (!medicineTyped) { toast('اكتب اسم الدواء'); return; }
  if (!qty || qty <= 0) { toast('أدخل كمية صحيحة'); return; }

  let medicineId, medicineName;
  const existing = findMedicineByName(medicineTyped);
  if (existing) {
    medicineId = existing.id; medicineName = existing.name;
  } else {
    const unit = document.getElementById('new-medicine-unit').value.trim();
    medicineId = uid(); medicineName = medicineTyped;
    await DB.put('medicines', { id: medicineId, name: medicineName, unit, quantity: 0, dirty: true, createdBy: State.user.name, createdAt: nowIso() });
  }

  let extra = {};
  if (State.entryType === 'in') {
    const deliveredBy = document.getElementById('entry-delivered-by').value.trim();
    if (!deliveredBy) { toast('أدخل اسم من قام بالتسليم'); return; }
    extra = { type: 'in', deliveredBy };
  } else if (State.entryType === 'out') {
    const placeTyped = document.getElementById('entry-place-input').value.trim();
    const places = await DB.getAll('places');
    const placeMatch = places.find(p => p.name.trim().toLowerCase() === placeTyped.toLowerCase());
    if (!placeMatch) { toast('اختر مكاناً من القائمة — إذا كان جديداً اطلب من المشرف إضافته'); return; }
    extra = { type: 'out', place: placeMatch.name };
  } else {
    const toNurseId = document.getElementById('entry-to-nurse').value;
    if (!toNurseId) { toast('اختر الممرض المستلم'); return; }
    const toNurse = await DB.get('users', toNurseId);
    extra = { type: 'transfer', fromNurseId: State.user.id, fromNurseName: State.user.name, toNurseId, toNurseName: toNurse.name };
  }

  document.getElementById('entry-submit').disabled = true; // منع الضغط المزدوج
  const base = {
    id: uid(), medicineId, medicineName, qty,
    nurseId: State.user.id, nurseName: State.user.name,
    timestamp: nowIso(), dirty: true, reviewed: false, overIssue: false,
  };
  await DB.put('movements', { ...base, ...extra });
  document.getElementById('entry-form').reset();
  await Inventory.recompute();
  if (navigator.vibrate) navigator.vibrate(60);
  toast('تم الحفظ — راح يتزامن تلقائياً عند توفر الانترنت');
  showScreen('dashboard');
  Sync.fullSync();
}

// ============================================================
// LOG (سجل الحركات — تعديل كمية بالخطأ + من عدّلها)
// ============================================================
async function renderLog() {
  const isPriv = State.user.role === 'admin' || State.user.role === 'developer';
  const movements = (await DB.getAll('movements'))
    .filter(m => isPriv || m.nurseId === State.user.id)
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
    .slice(0, 150);

  const list = document.getElementById('log-list');
  if (!movements.length) {
    list.innerHTML = `<div class="empty"><div class="glyph">🗒️</div><p>لا توجد عمليات مسجّلة بعد.</p></div>`;
    return;
  }
  list.innerHTML = movements.map(m => {
    const typeLabel = m.type === 'in' ? 'إدخال' : m.type === 'out' ? 'صرف' : 'تسليم';
    const pillClass = m.type === 'in' ? 'pill-in' : m.type === 'out' ? 'pill-out' : 'pill-transfer';
    const detail = m.type === 'out' ? (' — ' + (m.place || '')) : m.type === 'transfer' ? (' — إلى ' + (m.toNurseName || '')) : (m.deliveredBy ? ' — من ' + m.deliveredBy : '');
    const canEdit = isPriv || m.nurseId === State.user.id;
    return `
      <div class="card">
        <div class="list-row" style="border:none;padding-bottom:.2rem">
          <div class="main">
            <span class="title">${m.medicineName}</span>
            <span class="meta">${m.nurseName}${detail} — ${fmtDate(m.timestamp)}</span>
          </div>
          <span class="pill ${pillClass}">${typeLabel}</span>
        </div>
        <div class="list-row" style="border:none;padding-top:0">
          <span class="value">${m.qty}</span>
          ${canEdit ? `<button class="btn-ghost" onclick="editMovementQty('${m.id}')">تعديل الكمية</button>` : ''}
        </div>
        ${m.editedBy ? `<p style="font-size:.75rem;color:var(--ink-soft);margin-top:.2rem">✎ آخر تعديل بواسطة ${m.editedBy} — ${fmtDate(m.editedAt)}</p>` : ''}
      </div>
    `;
  }).join('');
}

async function editMovementQty(id) {
  const mv = await DB.get('movements', id);
  const val = prompt(`الكمية الحالية لـ "${mv.medicineName}": ${mv.qty}\nأدخل الكمية الصحيحة:`, mv.qty);
  if (val === null) return;
  const num = Number(val);
  if (!num || num <= 0) { toast('كمية غير صالحة'); return; }
  mv.qty = num;
  mv.editedBy = State.user.name;
  mv.editedAt = nowIso();
  mv.dirty = true;
  await DB.put('movements', mv);
  await Inventory.recompute();
  renderLog();
  toast('تم تعديل الكمية');
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
  document.getElementById('settings-user-role').textContent = State.user.role === 'admin' ? 'مشرف' : State.user.role === 'developer' ? 'مطوّر' : 'ممرض';
  document.getElementById('my-phone').value = State.user.phone || '';
  const lastSync = await DB.getMeta('lastSync');
  document.getElementById('settings-last-sync').textContent = lastSync ? fmtDate(lastSync) : 'لم تتم أي مزامنة بعد';
  document.getElementById('settings-api-url').value = await Sync.getEndpoint();
  await renderApiUrlSection();
  document.getElementById('font-scale-label').textContent = Math.round(parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) * 100) + '%';
  refreshInstallUI();

  const isAdminOrDev = State.user.role === 'admin' || State.user.role === 'developer';
  const isDev = State.user.role === 'developer';
  document.getElementById('settings-admin-only').style.display = isAdminOrDev ? 'block' : 'none';
  document.getElementById('settings-dev-only').style.display = isDev ? 'block' : 'none';
  document.getElementById('settings-backup-section').style.display = isAdminOrDev ? 'block' : 'none';
  if (isAdminOrDev) renderUsersAdmin();
}

async function renderUsersAdmin() {
  const users = (await DB.getAll('users')).filter(u => u.role !== 'developer');
  const list = document.getElementById('users-admin-list');
  list.innerHTML = users.map(u => `
    <div class="list-row" style="${u.active === false ? 'opacity:.55' : ''}">
      <div class="main">
        <span class="title">${u.name} ${u.active === false ? '<span class="pill pill-alert">معطّل</span>' : ''}</span>
        <span class="meta">${u.role === 'admin' ? 'مشرف' : 'ممرض'} — رمز: ${u.pin} ${u.phone ? '— 📱 ' + u.phone : ''}</span>
      </div>
      <div style="display:flex;gap:.3rem;flex-wrap:wrap;justify-content:flex-end">
        <button class="btn-ghost" onclick="editUserPhone('${u.id}')">${u.phone ? 'تعديل الهاتف' : 'إضافة هاتف'}</button>
        ${u.phone ? `<button class="btn-ghost" onclick="sendCredentialsWhatsapp('${u.id}')">إرسال الحساب</button>` : ''}
        ${u.id !== State.user.id ? `<button class="btn-ghost" onclick="toggleUserActive('${u.id}')">${u.active === false ? 'تفعيل' : 'تعطيل'}</button>` : ''}
        ${u.id !== State.user.id ? `<button class="btn-ghost" onclick="deleteUser('${u.id}')">حذف</button>` : ''}
      </div>
    </div>
  `).join('');
}

async function toggleUserActive(id) {
  const user = await DB.get('users', id);
  user.active = user.active === false ? true : false;
  user.dirty = true;
  await DB.put('users', user);
  renderUsersAdmin();
  toast(user.active === false ? 'تم تعطيل الحساب' : 'تم تفعيل الحساب');
  Sync.fullSync();
}

async function exportBackup() {
  const [users, medicines, places, movements] = await Promise.all([
    DB.getAll('users'), DB.getAll('medicines'), DB.getAll('places'), DB.getAll('movements')
  ]);
  const data = { exportedAt: nowIso(), users, medicines, places, movements };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `saydaliaty-backup-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast('تم تنزيل النسخة الاحتياطية');
}

async function editUserPhone(id) {
  const user = await DB.get('users', id);
  const val = prompt('رقم الواتساب مع رمز الدولة (مثال: 9639xxxxxxxx)', user.phone || '');
  if (val === null) return;
  user.phone = normalizePhone(val);
  user.dirty = true;
  await DB.put('users', user);
  renderUsersAdmin();
  Sync.fullSync();
}

async function sendCredentialsWhatsapp(id) {
  const user = await DB.get('users', id);
  if (!user.phone) { toast('أضف رقم واتساب لهذا المستخدم أولاً'); return; }
  const appUrl = location.origin + location.pathname;
  const msg = [
    `مرحباً ${user.name} 👋`,
    `هذا حسابك على تطبيق صيدليتي:`,
    ``,
    `الاسم: ${user.name}`,
    `رمز الدخول: ${user.pin}`,
    `رابط الدخول: ${appUrl}`,
  ].join('\n');
  window.open(`https://wa.me/${user.phone}?text=${encodeURIComponent(msg)}`, '_blank');
}

async function saveMyPhone() {
  const val = document.getElementById('my-phone').value;
  const user = await DB.get('users', State.user.id);
  user.phone = normalizePhone(val);
  user.dirty = true;
  await DB.put('users', user);
  State.user = user;
  toast('تم حفظ رقم الواتساب');
  Sync.fullSync();
}

function setNewUserRole(role) {
  State.newUserRole = role;
  document.querySelectorAll('#new-user-role-seg button').forEach(b => b.classList.toggle('active', b.dataset.role === role));
}

async function addNurse(ev) {
  ev.preventDefault();
  const name = document.getElementById('new-nurse-name').value.trim();
  const pin = document.getElementById('new-nurse-pin').value.trim();
  const phone = normalizePhone(document.getElementById('new-nurse-phone').value);
  if (!name || pin.length !== 4) { toast('أدخل اسم ورمز مكوّن من 4 أرقام'); return; }
  const addedRole = State.newUserRole;
  await DB.put('users', { id: uid(), name, role: addedRole, pin, phone, active: true, dirty: true });
  document.getElementById('add-nurse-form').reset();
  State.newUserRole = 'nurse';
  document.querySelectorAll('#new-user-role-seg button').forEach(b => b.classList.toggle('active', b.dataset.role === 'nurse'));
  renderUsersAdmin();
  toast(addedRole === 'admin' ? 'تمت إضافة المشرف' : 'تمت إضافة الممرض');
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
  State.apiUrlUnlocked = false;
  document.getElementById('api-url-warning').style.display = 'none';
  await renderApiUrlSection();
  toast('تم حفظ رابط المزامنة');
  Sync.fullSync();
}

// ---------- قفل رابط المزامنة بسؤال حسابي بسيط ----------
async function renderApiUrlSection() {
  const url = await Sync.getEndpoint();
  const input = document.getElementById('settings-api-url');
  const hasUrl = !!url;
  const unlocked = State.apiUrlUnlocked;
  input.disabled = hasUrl && !unlocked;
  document.getElementById('api-url-save-btn').style.display = (!hasUrl || unlocked) ? 'block' : 'none';
  document.getElementById('api-url-edit-btn').style.display = (hasUrl && !unlocked) ? 'block' : 'none';
}

function requestApiUrlEdit() {
  const a = Math.floor(Math.random() * 15) + 3;
  const b = Math.floor(Math.random() * 15) + 3;
  State.captchaSum = a + b;
  document.getElementById('captcha-question-label').textContent = `كم يساوي ${a} + ${b}؟`;
  document.getElementById('captcha-answer-input').value = '';
  document.getElementById('api-url-warning').style.display = 'block';
  document.getElementById('api-url-edit-btn').style.display = 'none';
  document.getElementById('api-url-save-btn').style.display = 'none';
}

function cancelApiUrlEdit() {
  document.getElementById('api-url-warning').style.display = 'none';
  renderApiUrlSection();
}

function checkCaptcha() {
  const answer = Number(document.getElementById('captcha-answer-input').value);
  if (answer === State.captchaSum) {
    State.apiUrlUnlocked = true;
    document.getElementById('api-url-warning').style.display = 'none';
    renderApiUrlSection();
    document.getElementById('settings-api-url').focus();
    toast('تم فتح التعديل — لا تنسَ حفظ الرابط بعد التعديل');
  } else {
    toast('إجابة غير صحيحة، حاول مرة أخرى');
    requestApiUrlEdit();
  }
}

// ============================================================
// التثبيت على الجهاز (موبايل وكمبيوتر) + تذكير تلقائي
// ============================================================
let deferredInstallPrompt = null;

function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  refreshInstallUI();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  toast('تم تثبيت التطبيق ✅');
  refreshInstallUI();
  dismissInstallBanner();
});

function refreshInstallUI() {
  const statusEl = document.getElementById('install-status');
  if (!statusEl) return;
  statusEl.textContent = isStandalone() ? 'مثبّت على هذا الجهاز ✅' : 'غير مثبّت بعد';
}

async function installApp() {
  if (isStandalone()) { toast('التطبيق مثبّت بالفعل على هذا الجهاز ✅'); return; }

  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    const choice = await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    if (choice.outcome === 'accepted') { toast('تم تثبيت التطبيق ✅'); refreshInstallUI(); }
    return;
  }

  if (isIOS()) {
    openSheet(`
      <h3 style="margin-bottom:.8rem">تثبيت على آيفون</h3>
      <p style="font-size:.9rem;line-height:1.9;margin-bottom:1rem">
        1) اضغط زر المشاركة <b>Share</b> (المربّع مع السهم لفوق) بأسفل الشاشة بمتصفح سفاري.<br>
        2) مرّر لتحت واختر <b>"إضافة إلى الشاشة الرئيسية"</b> (Add to Home Screen).<br>
        3) اضغط <b>"إضافة"</b> بالأعلى.
      </p>
      <button class="btn btn-primary" onclick="closeSheet()">فهمت</button>
    `);
    return;
  }

  toast('متصفحك الحالي لا يدعم التثبيت المباشر — جرّب Chrome أو Edge');
}

function maybeShowInstallBanner() {
  if (isStandalone()) return;
  const snoozeUntil = Number(localStorage.getItem('saydaliaty-install-snooze') || 0);
  if (Date.now() < snoozeUntil) return;
  document.getElementById('install-banner').classList.add('show');
}
function dismissInstallBanner() {
  document.getElementById('install-banner').classList.remove('show');
  localStorage.setItem('saydaliaty-install-snooze', String(Date.now() + 3 * 24 * 60 * 60 * 1000));
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
    log: renderLog,
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
  updateClock();
  setInterval(updateClock, 30000);

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
    maybeShowInstallBanner();
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./service-worker.js').catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
