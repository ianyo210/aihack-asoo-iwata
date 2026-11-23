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
  const list = Array.isArray(input.segments) ? input.segments : Array.isArray(input.utterances) ? input.utterances : [];
  const segments = list
    .map((s) => ({ speaker: s?.speaker ?? s?.speaker_id ?? null, text: String(s?.text ?? '').trim() }))
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
export async function detectMistakes(text, { llm } = {}) {
  const clean = String(text ?? '').trim();
  if (!clean) return { source: 'rules', candidates: [] };
  const byRules = detectByRules(clean);
  if (!llm) return { source: 'rules', candidates: byRules };
  try {
    const byAi = sanitizeCandidates(await llm(clean), 'ai');
    return { source: 'ai+rules', candidates: dedupe([...byAi, ...byRules]) };
  } catch (e) {
    return { source: 'rules', candidates: byRules, aiError: e?.message || String(e) };
  }
}

// ---- 博物館（お母さんが「収蔵する」と決めたものだけを入れる）----

const idOf = (wrong) => 'w-' + fold(wrong);

/** 博物館に追加する。同じ言葉なら回数を足す。元の配列は変えない。 */
export function registerEntry(museum, candidate, { date, clipId = null } = {}) {
  const list = Array.isArray(museum) ? museum : [];
  const id = idOf(candidate.wrong);
  const hit = list.find((e) => e.id === id);
  if (hit) {
    return list.map((e) =>
      e.id === id ? { ...e, count: e.count + 1, lastDate: date ?? e.lastDate, clipIds: clipId ? [...e.clipIds, clipId] : e.clipIds } : e,
    );
  }
  const entry = {
    id,
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
export function graduate(museum, wrong, date) {
  const id = idOf(wrong);
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
