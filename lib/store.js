// ブラウザ内の保存（localStorage ＋ IndexedDB）。room.html と museum.html が共有する。外へは送らない。
import { recordSighting, defaultChildId } from './mistakes.js';

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
/** 端末の現地時刻 'YYYY-MM-DDTHH:mm:ss'（UTC にずらさない） */
export const nowLocal = () => `${today()}T${new Date().toLocaleTimeString('sv-SE')}`;

/** おうちのひとの電話番号（子ども部屋の「でんわ」ボタン用）。この端末のブラウザの中だけに置く */
export const loadTel = () => read('km.tel', '');
export const saveTel = (t) => write('km.tel', String(t ?? '').slice(0, 30));

export const loadChildren = () => read('km.children', []);
export const saveChildren = (c) => write('km.children', c);

/** 前回、手紙を読んだ時刻（現地時刻 'YYYY-MM-DDTHH:mm:ss'）。無ければ null */
export const loadLastSeen = () => read('km.lastSeen', null);
export const saveLastSeen = (at) => write('km.lastSeen', at);

export const loadEvents = () => read('km.events', []);
export const saveEvents = (e) => write('km.events', e);

/** 見つけた言い間違いを、確認なしで図書館と記録に入れる */
export function recordCandidates(items, { at = nowLocal(), clipId = null } = {}) {
  let state = { museum: loadMuseum(), events: loadEvents() };
  const only = defaultChildId(loadChildren()); // 子どもが1人なら、その子が言ったことにする
  for (const c of items) state = recordSighting(state, { ...c, childId: c.childId ?? only }, { at, clipId, quote: c.quote });
  saveMuseum(state.museum);
  saveEvents(state.events);
  return state;
}

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

/** 写真を縮めて JPEG にする（スマホの大きな写真で容量を使い切らないように） */
export async function resizeImage(file, max = 900) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return new Promise((res) => c.toBlob(res, 'image/jpeg', 0.82));
}

export async function imageUrl(id) {
  const blob = id ? await getClip(id) : null;
  return blob ? URL.createObjectURL(blob) : null;
}

export async function playClip(id) {
  const blob = await getClip(id);
  if (!blob) return false;
  const url = URL.createObjectURL(blob);
  const a = new Audio(url);
  a.onended = () => URL.revokeObjectURL(url);
  try { await a.play(); return true; } catch { return false; }
}
