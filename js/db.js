// db.js — طبقة التخزين المحلي (IndexedDB) — تشتغل بدون انترنت بالكامل
const DB_NAME = 'saydaliaty-db';
const DB_VERSION = 1;
const STORES = ['users', 'medicines', 'places', 'movements', 'meta'];

let _dbPromise = null;

function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('medicines')) db.createObjectStore('medicines', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('places')) db.createObjectStore('places', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('movements')) db.createObjectStore('movements', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

async function tx(storeName, mode) {
  const db = await openDB();
  return db.transaction(storeName, mode).objectStore(storeName);
}

const DB = {
  async getAll(storeName) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },
  async get(storeName, id) {
    const store = await tx(storeName, 'readonly');
    return new Promise((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },
  async put(storeName, value) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.put(value);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  },
  async putMany(storeName, values) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      values.forEach(v => store.put(v));
      store.transaction.oncomplete = () => resolve();
      store.transaction.onerror = () => reject(store.transaction.error);
    });
  },
  async delete(storeName, id) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async clear(storeName) {
    const store = await tx(storeName, 'readwrite');
    return new Promise((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  },
  async getMeta(key, fallback = null) {
    const row = await this.get('meta', key);
    return row ? row.value : fallback;
  },
  async setMeta(key, value) {
    return this.put('meta', { key, value });
  }
};

window.DB = DB;
