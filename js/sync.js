// sync.js — المزامنة مع Google Sheets عبر Google Apps Script
// المنطق: كل عملية تُسجَّل محلياً فوراً (تشتغل أوفلاين بالكامل)، وتنضاف لطابور الانتظار.
// عند توفر الانترنت، pushPending() يرفع الطابور، ثم pullAll() ينزّل آخر نسخة ويعاد بناء
// كميات المستودع بالترتيب الزمني الحقيقي لكل عملية (وقت التنفيذ لا وقت المزامنة).

const Sync = {
  online: navigator.onLine,
  syncing: false,
  listeners: [],

  onChange(fn) { this.listeners.push(fn); },
  notify(status) { this.listeners.forEach(fn => fn(status)); },

  async getEndpoint() {
    return DB.getMeta('apiUrl', '');
  },
  async setEndpoint(url) {
    await DB.setMeta('apiUrl', url.trim());
  },

  COLLECTIONS: ['medicines', 'places', 'movements'],

  async pendingCount() {
    let n = 0;
    for (const c of this.COLLECTIONS) {
      const rows = await DB.getAll(c);
      n += rows.filter(r => r.dirty).length;
    }
    return n;
  },

  // يرفع كل السجلات المعدَّلة محلياً (أدوية جديدة، أماكن جديدة، حركات) دفعة واحدة
  async pushPending() {
    const url = await this.getEndpoint();
    if (!url) return { ok: false, reason: 'no-endpoint' };

    const payload = {};
    const dirtyByCollection = {};
    let total = 0;
    for (const c of this.COLLECTIONS) {
      const rows = await DB.getAll(c);
      const dirty = rows.filter(r => r.dirty);
      dirtyByCollection[c] = dirty;
      if (dirty.length) { payload[c] = dirty.map(({ dirty, ...rest }) => rest); total += dirty.length; }
    }
    if (!total) return { ok: true, pushed: 0 };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // تجنّب preflight CORS مع Apps Script
      body: JSON.stringify({ action: 'push', ...payload })
    });
    if (!res.ok) throw new Error('push-failed');
    const data = await res.json();
    if (data.ok) {
      for (const c of this.COLLECTIONS) {
        const dirty = dirtyByCollection[c];
        if (dirty.length) {
          await DB.putMany(c, dirty.map(r => ({ ...r, dirty: false })));
        }
      }
    }
    return { ok: true, pushed: total };
  },

  // ينزّل النسخة الكاملة (مستخدمين، أدوية، أماكن، حركات) ويدمجها محلياً
  async pullAll() {
    const url = await this.getEndpoint();
    if (!url) return { ok: false, reason: 'no-endpoint' };
    const res = await fetch(url + (url.includes('?') ? '&' : '?') + 'action=fullDump');
    if (!res.ok) throw new Error('pull-failed');
    const data = await res.json();

    if (Array.isArray(data.users)) await DB.putMany('users', data.users);
    if (Array.isArray(data.places)) await DB.putMany('places', data.places);
    if (Array.isArray(data.medicines)) await DB.putMany('medicines', data.medicines);

    if (Array.isArray(data.movements) && data.movements.length) {
      const local = await DB.getAll('movements');
      const byId = new Map(local.map(m => [m.id, m]));
      for (const rm of data.movements) {
        // لا نستبدل سجلاً محلياً لسا فيه تعديلات لم تُرفع بعد
        const existing = byId.get(rm.id);
        if (existing && existing.dirty) continue;
        byId.set(rm.id, { ...rm, dirty: false });
      }
      await DB.putMany('movements', Array.from(byId.values()));
    }
    await DB.setMeta('lastSync', new Date().toISOString());
    await Inventory.recompute();
    return { ok: true };
  },

  async fullSync() {
    if (this.syncing) return;
    this.syncing = true;
    this.notify('syncing');
    try {
      await this.pushPending();
      await this.pullAll();
      this.notify('synced');
      return true;
    } catch (e) {
      console.warn('sync error', e);
      this.notify('error');
      return false;
    } finally {
      this.syncing = false;
    }
  },

  init() {
    window.addEventListener('online', () => { this.online = true; this.notify('online'); this.fullSync(); });
    window.addEventListener('offline', () => { this.online = false; this.notify('offline'); });
    // مزامنة تلقائية عند فتح البرنامج لو في اتصال
    if (this.online) this.fullSync();
  }
};

// ---------- منطق إعادة حساب المستودع (حل التعارض) ----------
// الفلسفة: التسجيل أهم من الدقة اللحظية. أي عملية "صرف" حقيقية تُسجَّل حتى لو
// تجاوزت الرصيد المتاح — وتُعلَّم كتنبيه يحتاج مراجعة المشرف، بدل ما تُرفض.
const Inventory = {
  quantities: {},   // medicineId -> current qty
  alerts: [],        // movements فيها overIssue = true وغير مُراجَعة

  async recompute() {
    const medicines = await DB.getAll('medicines');
    const movements = await DB.getAll('movements');

    // الترتيب الحاكم هو وقت التنفيذ الفعلي على جهاز الممرض، وليس وقت المزامنة
    movements.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    const running = {};
    medicines.forEach(m => { running[m.id] = 0; });

    const updatedMovements = [];
    for (const mv of movements) {
      if (!(mv.medicineId in running)) running[mv.medicineId] = 0;
      let overIssue = false;
      if (mv.type === 'in') {
        running[mv.medicineId] += Number(mv.qty);
      } else if (mv.type === 'out') {
        running[mv.medicineId] -= Number(mv.qty);
        if (running[mv.medicineId] < 0) overIssue = true;
      }
      // type === 'transfer' لا يغيّر إجمالي المستودع (تبديل عهدة بين ممرضين فقط)
      if (mv.overIssue !== overIssue) {
        updatedMovements.push({ ...mv, overIssue });
      }
    }
    if (updatedMovements.length) await DB.putMany('movements', updatedMovements);

    this.quantities = running;
    const freshMovements = await DB.getAll('movements');
    this.alerts = freshMovements
      .filter(m => m.overIssue && !m.reviewed)
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

    // حفظ الكمية الحالية على وثيقة الدواء نفسها لسهولة العرض
    const meds = await DB.getAll('medicines');
    const updatedMeds = meds.map(m => ({ ...m, quantity: running[m.id] ?? 0 }));
    await DB.putMany('medicines', updatedMeds);

    return { quantities: running, alerts: this.alerts };
  }
};

window.Sync = Sync;
window.Inventory = Inventory;
