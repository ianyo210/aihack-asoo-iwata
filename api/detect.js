// POST /api/detect  { text, museum? }  →  { ok, source, candidates, graduations }
// 言い間違いの候補を返す。Gemini が使えなくても辞書ルールで必ず返事をする。
import { detectMistakes, findGraduationHints, attributeSpeakers, familyDictionary } from '../lib/mistakes.js';
import { detectByGemini } from '../lib/gemini.js';
import { detectByOpenRouter } from '../lib/openrouter.js';

/** 使える AI を選ぶ。OpenRouter → Gemini の順。どちらも無ければ辞書ルールだけ。 */
function pickLlm() {
  if (process.env.OPENROUTER_API_KEY) return { name: 'openrouter', run: (t) => detectByOpenRouter(t) };
  if (process.env.GEMINI_API_KEY) return { name: 'gemini', run: (t) => detectByGemini(t) };
  return null;
}

async function readJson(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return JSON.parse(req.body || '{}');
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

export default async function handler(req, res) {
  if (req.method === 'GET') return json(res, 200, { ok: true, llm: pickLlm()?.name ?? 'rules-only' });
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  try {
    const { text = '', museum = [], segments = [] } = await readJson(req);
    const segs = Array.isArray(segments) ? segments.map((s) => ({ speaker: s?.speaker ?? null, text: String(s?.text ?? '') })).filter((s) => s.text) : [];
    const body = String(text || segs.map((s) => s.text).join('\n')).slice(0, 4000);
    const llm = pickLlm();
    // 図書館に入った言葉も辞書に足す（AI が言い間違いと気づかない「さんとさん」なども拾える）
    const dictionary = familyDictionary(Array.isArray(museum) ? museum.slice(0, 300) : []);
    const { source, candidates, aiError } = await detectMistakes(body, { llm: llm?.run, dictionary });
    if (aiError) console.warn(`detect: ${llm.name} 失敗 → ルールに切替:`, aiError);
    const graduations = findGraduationHints(Array.isArray(museum) ? museum : [], body);
    // 誰が言ったか（話者ラベル）を、それぞれの候補に付ける
    return json(res, 200, { ok: true, source, candidates: attributeSpeakers(candidates, segs), graduations });
  } catch (e) {
    return json(res, 400, { ok: false, error: e?.message || 'bad request' });
  }
}
