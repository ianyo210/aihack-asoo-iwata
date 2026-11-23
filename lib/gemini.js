// Gemini で言い間違いの候補を取り出す。鍵は環境変数 GEMINI_API_KEY（コードに書かない）。
// レート制限（429）や一時障害（5xx）・未提供（404）時は別モデルへ自動で切り替え、全滅時は例外を投げる（呼び出し側が辞書ルールに切替）。
import { buildPrompt, parseCandidates } from './prompt.js';

export const DEFAULT_MODELS = ['gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-lite'];
const RETRYABLE = new Set([404, 429, 500, 502, 503, 504]);

function modelList(override) {
  const base = Array.isArray(override) && override.length ? override : [process.env.GEMINI_MODEL, ...DEFAULT_MODELS];
  return [...new Set(base.map((m) => String(m ?? '').trim()).filter(Boolean))];
}

export async function detectByGemini(text, { apiKey = process.env.GEMINI_API_KEY, models, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です');
  const candidates = modelList(models);
  let lastErr;
  for (const model of candidates) {
    let resp;
    try {
      resp = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        // 鍵は URL ではなくヘッダーで送る（ログに残らないように）
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: buildPrompt(text) }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
        }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      lastErr = e;
      if (e?.name === 'TimeoutError' || e?.name === 'AbortError') continue;
      throw e;
    }
    if (!resp.ok) {
      lastErr = new Error(`Gemini API ${resp.status}`);
      if (RETRYABLE.has(resp.status) || resp.status >= 500) continue;
      throw lastErr;
    }
    const data = await resp.json();
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!raw) throw new Error('Gemini の返事が空です');
    return parseCandidates(raw);
  }
  throw lastErr ?? new Error('Gemini の呼び出しに失敗しました');
}
