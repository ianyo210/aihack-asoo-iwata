// Gemini で言い間違いの候補を取り出す。鍵は環境変数 GEMINI_API_KEY（コードに書かない）。
// 失敗したら例外を投げる。呼び出し側（detectMistakes）が辞書ルールに切り替える。
import { buildPrompt, parseCandidates } from './prompt.js';

const MODEL = 'gemini-2.5-flash';

export async function detectByGemini(text, { apiKey = process.env.GEMINI_API_KEY, fetchImpl = fetch, timeoutMs = 6000 } = {}) {
  if (!apiKey) throw new Error('GEMINI_API_KEY が未設定です');
  const resp = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    // 鍵は URL ではなくヘッダーで送る（ログに残らないように）
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: buildPrompt(text) }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.2 },
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`Gemini API ${resp.status}`);
  const data = await resp.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error('Gemini の返事が空です');
  return parseCandidates(raw);
}
