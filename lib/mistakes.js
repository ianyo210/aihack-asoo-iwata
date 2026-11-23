// 言い間違いのロジック（外部 API を使わない部分）。鍵がなくても動く。
// 設計: docs/requirements-design.md

/** 既知の言い間違い（辞書ルール）。wrong はひらがなで持つ。 */
export const DICTIONARY = [
  { wrong: 'てびり', right: 'テレビ' },
  { wrong: '手びり', right: 'テレビ' }, // Aqua が「てびり」を漢字まじりで書いた実測の形（2026-11-23）
  { wrong: 'とうもころし', right: 'とうもろこし' },
  { wrong: 'えべれーたー', right: 'エレベーター' },
  { wrong: 'しゃかな', right: 'さかな' },
];

/**
 * 図書館に入った言い間違いを、辞書にも足す（卒業した言葉は除く）。
 * Aqua は知らない言い間違いを実在の言葉に寄せる（例: さんとさん → ほんとさ）が、
 * 一度覚えた言葉はヒントで聞こえたまま書き起こせる。その言葉を、判定の辞書でも拾う。
 */
export function familyDictionary(museum = [], base = DICTIONARY) {
  const extra = museum
    .filter((e) => e && !e.graduatedDate && typeof e.wrong === 'string' && e.wrong.trim())
    .map((e) => ({ wrong: e.wrong.trim().slice(0, 20), right: String(e.right || e.wrong).slice(0, 20) }));
  const seen = new Set();
  return [...base, ...extra].filter((d) => { const k = fold(d.wrong); if (!k || seen.has(k)) return false; seen.add(k); return true; });
}

/** Aqua の文字起こしに渡すヒントの文（「この子がよく言う言葉: …」）。言葉が無ければ空文字。 */
export function hintPrompt(words = [], { max = 40, maxChars = 400 } = {}) {
  const uniq = [...new Set(words.map((w) => String(w ?? '').trim()).filter((w) => w && w.length <= 20))].slice(0, max);
  if (!uniq.length) return '';
  let s = 'この子がよく言う言葉: ';
  for (const [i, w] of uniq.entries()) {
    const next = s + (i ? '、' : '') + w;
    if (next.length > maxChars) break;
    s = next;
  }
  return s;
}

/** カタカナをひらがなにそろえる（「てビリ」と「てびり」を同じに扱う） */
export function toHiragana(s) {
  return String(s ?? '').replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 比較用に、ひらがな化・空白除去・小文字化 */
export function fold(s) {
  return toHiragana(s).replace(/\s+/g, '').toLowerCase();
}

/** 文を区切る */
function sentences(text) {
  return String(text ?? '')
    .split(/[。！？!?\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** その言葉が出てくる文を返す（見つからなければ空文字） */
function quoteOf(text, needle) {
  const n = fold(needle);
  return sentences(text).find((s) => fold(s).includes(n)) ?? '';
}

/**
 * Aqua の応答を { text, segments } にそろえる。形が揺れても落ちない。
 * 受け付ける形: 文字列 / {text} / {segments:[{speaker,text}]} / {utterances:[...]}
 */
export function normalizeTranscript(input) {
  if (typeof input === 'string') return { text: input.trim(), segments: [] };
  if (!input || typeof input !== 'object') return { text: '', segments: [] };
  // Aqua の diarized_json は turns（speaker・start・end・text）。そのほかの形も受け付ける
  const list = [input.turns, input.segments, input.utterances].find(Array.isArray) ?? [];
  const segments = list
    .map((s) => ({ speaker: s?.speaker ?? s?.speaker_id ?? null, text: String(s?.text ?? '').trim(), start: s?.start ?? null, end: s?.end ?? null }))
    .filter((s) => s.text);
  const text = (typeof input.text === 'string' && input.text.trim()) || segments.map((s) => s.text).join('\n');
  return { text: text.trim(), segments };
}

/** 辞書ルールで言い間違いの候補を見つける */
export function detectByRules(text, dictionary = DICTIONARY) {
  const folded = fold(text);
  const found = [];
  for (const { wrong, right } of dictionary) {
    if (folded.includes(fold(wrong))) {
      found.push({ wrong: displayForm(text, wrong), right, note: '', quote: quoteOf(text, wrong), source: 'rules' });
    }
  }
  return found;
}

/** 元の文章にある書き方（「てビリ」など）をそのまま見せる */
function displayForm(text, wrong) {
  const n = fold(wrong);
  const t = String(text ?? '');
  const folded = fold(t);
  const idx = folded.indexOf(n);
  if (idx < 0) return wrong;
  // 空白を除いた位置を元の文字列の位置に戻す
  let seen = 0;
  let start = -1;
  for (let i = 0; i < t.length; i++) {
    if (/\s/.test(t[i])) continue;
    if (seen === idx) { start = i; break; }
    seen++;
  }
  if (start < 0) return wrong;
  let count = 0;
  let end = start;
  while (end < t.length && count < n.length) {
    if (!/\s/.test(t[end])) count++;
    end++;
  }
  return t.slice(start, end);
}

/** AI の返事を、安全な形の候補だけに絞る */
export function sanitizeCandidates(raw, source = 'ai') {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const c of raw) {
    const wrong = String(c?.wrong ?? '').trim();
    const right = String(c?.right ?? '').trim();
    if (!wrong || !right || wrong.length > 20 || right.length > 20) continue;
    if (fold(wrong) === fold(right)) continue; // 同じなら言い間違いではない
    out.push({ wrong, right, note: String(c?.note ?? '').slice(0, 60), quote: String(c?.quote ?? '').slice(0, 80), source });
    if (out.length >= 5) break;
  }
  return out;
}

/** 同じ言い間違いを1つにまとめる（先に出たものを残す） */
function dedupe(list) {
  const seen = new Set();
  return list.filter((c) => {
    const k = fold(c.wrong);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * 言い間違いを見つける。AI（llm）を試し、失敗してもルールで続ける。
 * llm: async (text) => 候補の配列。省略するとルールだけ。
 * 戻り値: { source: 'ai+rules' | 'rules', candidates, aiError? }
 */
export async function detectMistakes(text, { llm, dictionary = DICTIONARY } = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) return { source: 'rules', candidates: [] };
  const byRules = detectByRules(clean, dictionary);
  if (!llm) return { source: 'rules', candidates: byRules };
  try {
    const byAi = sanitizeCandidates(await llm(clean), 'ai');
    return { source: 'ai+rules', candidates: dedupe([...byAi, ...byRules]) };
  } catch (e) {
    return { source: 'rules', candidates: byRules, aiError: e?.message || String(e) };
  }
}

// ---- 図書館（お母さんが「収蔵する」と決めたものだけを入れる）----

// 同じ言葉でも、子どもが違えば別のカードにする（childId があるとき）
const idOf = (wrong, childId) => (childId ? `${childId}/` : '') + 'w-' + fold(wrong);

/** 図書館に追加する。同じ言葉なら回数を足す。元の配列は変えない。 */
export function registerEntry(museum, candidate, { date, clipId = null } = {}) {
  const list = Array.isArray(museum) ? museum : [];
  const id = idOf(candidate.wrong, candidate.childId);
  const hit = list.find((e) => e.id === id);
  if (hit) {
    return list.map((e) =>
      e.id === id ? { ...e, count: e.count + 1, lastDate: date ?? e.lastDate, clipIds: clipId ? [...e.clipIds, clipId] : e.clipIds } : e,
    );
  }
  const entry = {
    id,
    childId: candidate.childId ?? null,
    wrong: candidate.wrong,
    right: candidate.right,
    note: candidate.note ?? '',
    firstDate: date ?? null,
    lastDate: date ?? null,
    count: 1,
    clipIds: clipId ? [clipId] : [],
    graduatedDate: null,
  };
  return [...list, entry];
}

/** 正しく言えた日を記録して「卒業」にする。見つからなければそのまま返す。 */
export function graduate(museum, wrong, date, childId) {
  const id = idOf(wrong, childId);
  if (!museum.some((e) => e.id === id)) return museum;
  return museum.map((e) => (e.id === id && !e.graduatedDate ? { ...e, graduatedDate: date } : e));
}

/**
 * 今の発話に、現役の言い間違いの「正しい言い方」だけが出ていれば、卒業の候補にする。
 * お母さんが確認して graduate() を呼ぶ。
 */
export function findGraduationHints(museum, text) {
  const folded = fold(text);
  return (museum ?? []).filter(
    (e) => !e.graduatedDate && folded.includes(fold(e.right)) && !folded.includes(fold(e.wrong)),
  );
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * お母さんが詳細画面で直せる項目だけを更新する（元の配列は変えない）。
 * 直せるのは right（訂正）・note・photoId・graduatedDate（YYYY-MM-DD か null）。
 * 日付の形が不正なときは、その項目だけ無視する。
 */
export function updateEntry(museum, id, patch = {}) {
  return museum.map((e) => {
    if (e.id !== id) return e;
    const next = { ...e };
    if (typeof patch.right === 'string') next.right = patch.right.trim().slice(0, 20);
    if (typeof patch.note === 'string') next.note = patch.note.trim().slice(0, 60);
    if ('photoId' in patch) next.photoId = patch.photoId || null;
    if ('graduatedDate' in patch) {
      const d = patch.graduatedDate;
      if (d === null || d === '') next.graduatedDate = null;
      else if (typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(d))) next.graduatedDate = d;
    }
    return next;
  });
}

/** 図書館から外す */
export function removeEntry(museum, id) {
  return museum.filter((e) => e.id !== id);
}

// ---- 聞いた記録（いつ・何回言ったか）。お母さんの確認なしで自動で積む ----

const DAY_MS = 86400000;
const ts = (at) => Date.parse(at);

/**
 * 言い間違いを1回聞いたことを記録する。図書館（entries）に無ければ新しく作り、あれば回数を足す。
 * state: { museum, events }。at は端末の現地時刻 'YYYY-MM-DDTHH:mm:ss'。元の state は変えない。
 */
export function recordSighting({ museum = [], events = [] } = {}, candidate, { at, clipId = null, quote } = {}) {
  const date = String(at ?? '').slice(0, 10) || null;
  const entryId = idOf(candidate.wrong, candidate.childId);
  const event = {
    id: `e-${entryId}-${at}-${events.length}`,
    entryId,
    childId: candidate.childId ?? null,
    speaker: candidate.speaker ?? null, // 録音ごとの話者ラベル（spk_0 など）。録音をまたいで同じとは限らない
    wrong: candidate.wrong,
    quote: quote ?? candidate.quote ?? '',
    clipId,
    at,
  };
  return { museum: registerEntry(museum, candidate, { date, clipId }), events: [event, ...events] };
}

/** その言い間違いの頻度。now は現地時刻の文字列（省略すると最後に聞いた時刻）。 */
export function frequencyOf(events, entryId, now) {
  const mine = events.filter((e) => e.entryId === entryId).sort((a, b) => ts(b.at) - ts(a.at));
  if (!mine.length) return { total: 0, firstAt: null, lastAt: null, last7: 0, perWeek: 0, days: [] };
  const t = ts(now ?? mine[0].at);
  const firstAt = mine[mine.length - 1].at;
  const last7 = mine.filter((e) => t - ts(e.at) >= 0 && t - ts(e.at) < 7 * DAY_MS).length;
  const weeks = Math.max(1, (t - ts(firstAt)) / (7 * DAY_MS));
  const byDay = new Map();
  for (const e of mine) {
    const d = e.at.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  return {
    total: mine.length,
    firstAt,
    lastAt: mine[0].at,
    last7,
    perWeek: Math.round((mine.length / weeks) * 10) / 10,
    days: [...byDay].slice(0, 10).map(([date, count]) => ({ date, count })), // 新しい日から10日分
  };
}

/** 一覧の「N回目」。同じ言葉のうち、その記録が何番目か（古い順で数える）。 */
export function nthSighting(events, event) {
  return events.filter((e) => e.entryId === event.entryId && ts(e.at) <= ts(event.at)).length;
}

// ---- 話者（誰が言ったか） ----

/** 見つかった言い間違いに、それを言った話者のラベルを付ける。見つからなければ null。 */
export function attributeSpeakers(candidates, segments = []) {
  return candidates.map((c) => {
    const w = fold(c.wrong);
    const seg = segments.find((s) => fold(s.text).includes(w)) ?? (c.quote ? segments.find((s) => fold(s.text).includes(fold(c.quote))) : null);
    return { ...c, speaker: seg?.speaker ?? null };
  });
}

// ---- 子どもの情報（数名） ----

export const CHILD_LIMIT = 6;
// ことば鳥の水彩に合わせた色（羽のピンク・空色・葉・ひよこ・マイクの紫・くちばし）
export const CHILD_COLORS = ['#E28C8C', '#6FA8DC', '#8DB863', '#E9B44C', '#A98BC7', '#EE9440'];

const okDate = (d) => typeof d === 'string' && DATE_RE.test(d) && !Number.isNaN(Date.parse(d));

/** 子どもを足す。名前が空・上限を超えるときは、そのまま返す。 */
export function addChild(children = [], { name, birthday } = {}) {
  const n = String(name ?? '').trim().slice(0, 12);
  if (!n || children.length >= CHILD_LIMIT) return children;
  let k = children.length + 1;
  while (children.some((c) => c.id === `ch-${k}`)) k++;
  const used = new Set(children.map((c) => c.color));
  const color = CHILD_COLORS.find((c) => !used.has(c)) ?? CHILD_COLORS[children.length % CHILD_COLORS.length];
  return [...children, { id: `ch-${k}`, name: n, birthday: okDate(birthday) ? birthday : null, color }];
}

export function updateChild(children, id, patch = {}) {
  return children.map((c) => {
    if (c.id !== id) return c;
    const next = { ...c };
    if (typeof patch.name === 'string' && patch.name.trim()) next.name = patch.name.trim().slice(0, 12);
    if ('birthday' in patch) next.birthday = okDate(patch.birthday) ? patch.birthday : null;
    if ('avatarId' in patch) next.avatarId = patch.avatarId || null; // アイコン画像（ブラウザ内に保存した画像の id）
    return next;
  });
}

export const removeChild = (children, id) => children.filter((c) => c.id !== id);

/** 「3歳4か月」の形。誕生日が無い・未来のときは空文字。 */
export function ageText(birthday, now = new Date()) {
  if (!okDate(birthday)) return '';
  const b = new Date(`${birthday}T00:00:00`), n = new Date(now);
  let months = (n.getFullYear() - b.getFullYear()) * 12 + (n.getMonth() - b.getMonth());
  if (n.getDate() < b.getDate()) months -= 1;
  if (months < 0) return '';
  const y = Math.floor(months / 12), m = months % 12;
  return y ? (m ? `${y}歳${m}か月` : `${y}歳`) : `${m}か月`;
}

/** 子どもが1人だけなら、誰が言ったかは決まっている。複数なら null（お母さんが選ぶ）。 */
export const defaultChildId = (children) => (children?.length === 1 ? children[0].id : null);

/**
 * 記録の「誰が言ったか」を変える。同じ録音の同じ声（speaker）の記録は、まとめて動かす。
 * state: { museum, events }。childId が null なら「わからない」に戻す。元の state は変えない。
 */
export function assignChild({ museum, events }, eventId, childId, { sameVoice = true } = {}) {
  const target = events.find((e) => e.id === eventId);
  if (!target) return { museum, events };
  const moved = new Set(
    events.filter((e) => e.id === eventId || (sameVoice && target.speaker && target.clipId && e.clipId === target.clipId && e.speaker === target.speaker)).map((e) => e.id),
  );
  const oldIds = new Set();
  let nextMuseum = [...museum];
  const nextEvents = events.map((e) => {
    if (!moved.has(e.id)) return e;
    const entryId = idOf(e.wrong, childId);
    if (entryId === e.entryId) return e;
    oldIds.add(e.entryId);
    if (!nextMuseum.some((m) => m.id === entryId)) {
      const old = museum.find((m) => m.id === e.entryId);
      nextMuseum.push({ id: entryId, childId: childId ?? null, wrong: e.wrong, right: old?.right ?? '', note: old?.note ?? '', firstDate: null, lastDate: null, count: 0, clipIds: [], graduatedDate: null });
    }
    return { ...e, entryId, childId: childId ?? null };
  });
  // 数え直す（動いた先と、動いた元）
  const touched = new Set([...oldIds, ...nextEvents.filter((e) => moved.has(e.id)).map((e) => e.entryId)]);
  nextMuseum = nextMuseum
    .map((m) => {
      if (!touched.has(m.id)) return m;
      const mine = nextEvents.filter((e) => e.entryId === m.id).sort((a, b) => ts(a.at) - ts(b.at));
      return { ...m, count: mine.length, firstDate: mine[0]?.at.slice(0, 10) ?? m.firstDate, lastDate: mine.at(-1)?.at.slice(0, 10) ?? m.lastDate, clipIds: mine.map((e) => e.clipId).filter(Boolean) };
    })
    .filter((m) => !(oldIds.has(m.id) && !nextEvents.some((e) => e.entryId === m.id))); // 空になった元のカードは消す
  return { museum: nextMuseum, events: nextEvents };
}

// ---- 新着（前回ひらいたあとに届いたもの）。ことば鳥が手紙で運んでくる ----

/** lastSeen（現地時刻の文字列）より後に届いた記録を、古い順に返す。lastSeen が無ければ全部。 */
export function unreadSince(events, lastSeen) {
  const t = lastSeen ? ts(lastSeen) : -Infinity;
  return events.filter((e) => ts(e.at) > t).sort((a, b) => ts(a.at) - ts(b.at));
}
