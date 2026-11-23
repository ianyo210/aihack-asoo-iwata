// POST /api/transcribe  （本文: 音声クリップ。Content-Type は application/octet-stream、種類は X-Audio-Type）
// Aqua Voice の素の文字起こし（audio/transcriptions）に、話者分離つきで送り、{ text, segments } を返す。
// segments は [{ speaker: 'spk_0', text, start, end }]。話者分離が使えないときは、通常の文字起こしに切り替える。
// 整形済みの dictations は使わない（言い間違いを正しい言葉に直してしまう恐れがあるため）。
// 鍵は環境変数 AQUA_API_KEY。コードにもログにも書かない。
import { normalizeTranscript } from '../lib/mistakes.js';

const MAX_BYTES = 4 * 1024 * 1024; // Vercel の関数の本文上限（約4.5MB）に収める
const ENDPOINT = 'https://api.aquavoice.com/v1/audio/transcriptions';

const json = (res, code, body) => {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
};

async function readAudio(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BYTES) throw new Error('音声が大きすぎます（4MBまで）');
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function post(key, audio, type, diarize) {
  const form = new FormData();
  form.append('file', new Blob([audio], { type }), 'clip.' + (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : type.includes('wav') ? 'wav' : 'webm'));
  form.append('model', 'avalon-2');
  form.append('language', 'ja');
  if (diarize) {
    form.append('diarize', 'true');
    form.append('response_format', 'diarized_json');
  } else {
    form.append('response_format', 'json');
  }
  return fetch(ENDPOINT, { method: 'POST', headers: { Authorization: `Bearer ${key}` }, body: form, signal: AbortSignal.timeout(20000) });
}

export default async function handler(req, res) {
  if (req.method === 'GET') return json(res, 200, { ok: true, aquaConfigured: Boolean(process.env.AQUA_API_KEY) });
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'Method Not Allowed' });
  const key = process.env.AQUA_API_KEY;
  if (!key) return json(res, 503, { ok: false, error: 'AQUA_API_KEY が未設定です（台本のデモをお使いください）' });
  try {
    const audio = await readAudio(req);
    if (!audio.length) return json(res, 400, { ok: false, error: '音声が空です' });
    if (audio.length > MAX_BYTES) return json(res, 413, { ok: false, error: '音声が大きすぎます（4MBまで）' });
    const type = String(req.headers['x-audio-type'] || 'audio/webm');

    let diarized = true;
    let resp = await post(key, audio, type, true);
    if (resp.status === 400 || resp.status === 422) { // 話者分離を受け付けない形式のとき
      diarized = false;
      resp = await post(key, audio, type, false);
    }
    if (!resp.ok) return json(res, 502, { ok: false, error: `Aqua API ${resp.status}` });
    const out = normalizeTranscript(await resp.json());
    return json(res, 200, { ok: true, diarized, ...out });
  } catch (e) {
    return json(res, 500, { ok: false, error: e?.message || 'transcribe failed' });
  }
}
