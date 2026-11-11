// Stockage local (IndexedDB) : tout reste sur ton téléphone.
const DB_NAME = 'garde-robe';
const DB_VERSION = 1;
export const STORES = ['items', 'outfits', 'wishes'];

let dbPromise;
function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const s of STORES) {
        if (!db.objectStoreNames.contains(s)) db.createObjectStore(s, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(store, mode, fn) {
  return open().then(db => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const result = fn(s);
    t.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
    t.onerror = () => reject(t.error);
  }));
}

export const all = store => tx(store, 'readonly', s => s.getAll());
export const get = (store, id) => tx(store, 'readonly', s => s.get(id));
export const put = (store, obj) => tx(store, 'readwrite', s => { s.put(obj); return obj; });
export const del = (store, id) => tx(store, 'readwrite', s => { s.delete(id); });
export const clear = store => tx(store, 'readwrite', s => { s.clear(); });

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

// Sauvegarde / restauration (les photos sont converties en data URL)
const blobToDataURL = b => new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); });
const dataURLToBlob = async u => (await fetch(u)).blob();

export async function exportAll() {
  const out = { app: 'garde-robe', version: 1, exportedAt: new Date().toISOString() };
  for (const s of STORES) {
    const rows = await all(s);
    out[s] = await Promise.all(rows.map(async r => (r.image instanceof Blob ? { ...r, image: await blobToDataURL(r.image) } : r)));
  }
  return out;
}

export async function importAll(data, { replace = false } = {}) {
  if (!data || data.app !== 'garde-robe') throw new Error('Fichier de sauvegarde invalide');
  for (const s of STORES) {
    if (replace) await clear(s);
    for (const r of data[s] || []) {
      if (typeof r.image === 'string' && r.image.startsWith('data:')) r.image = await dataURLToBlob(r.image);
      await put(s, r);
    }
  }
}
