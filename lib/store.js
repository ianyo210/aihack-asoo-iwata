// ブラウザ内の保存（localStorage ＋ IndexedDB）。room.html と museum.html が共有する。外へは送らない。
const read = (k, d) => {
  try { return JSON.parse(localStorage.getItem(k) ?? 'null') ?? d; } catch { return d; }
};
const write = (k, v) => {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 容量や拒否は無視 */ }
};

export const loadMuseum = () => read('km.museum', []);
export const saveMuseum = (m) => write('km.museum', m);
export const loadPending = () => read('km.pending', []);
export const savePending = (p) => write('km.pending', p);
export const today = () => new Date().toLocaleDateString('sv-SE'); // 2026-11-23 の形

export function addPending(items) {
  if (items.length) savePending([...items, ...loadPending()]);
}

// ---- 音声クリップ（IndexedDB）----
const openDb = () =>
  new Promise((resolve, reject) => {
    const r = indexedDB.open('km', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('clips');
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

export async function putClip(id, blob) {
  try {
    const db = await openDb();
    await new Promise((res, rej) => {
      const tx = db.transaction('clips', 'readwrite');
      tx.objectStore('clips').put(blob, id);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
    return true;
  } catch { return false; }
}

export async function getClip(id) {
  try {
    const db = await openDb();
    return await new Promise((res, rej) => {
      const r = db.transaction('clips').objectStore('clips').get(id);
      r.onsuccess = () => res(r.result ?? null);
      r.onerror = () => rej(r.error);
    });
  } catch { return null; }
}

export async function playClip(id) {
  const blob = await getClip(id);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  try { await a.play(); return true; } catch { return false; }
}
