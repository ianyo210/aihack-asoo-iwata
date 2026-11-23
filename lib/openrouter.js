// OpenRouter で言い間違いの候補を取り出す。鍵は環境変数 OPENROUTER_API_KEY（コードに書かない）。
// モデルは OPENROUTER_MODEL で変えられる。失敗したら例外（呼び出し側が辞書ルールに切り替える）。
import { buildPrompt, parseCandidates } from './prompt.js';

const DEFAULT_MODEL = 'google/gemini-2.5-flash';

export async function detectByOpenRouter(
  text,
  { apiKey = process.env.OPENROUTER_API_KEY, model = process.env.OPENROUTER_MODEL || DEFAULT_MODEL, fetchImpl = fetch, timeoutMs = 8000 } = {},
) {
  if (!apiKey) throw new Error('OPENROUTER_API_KEY が未設定です');
  const resp = await fetchImpl('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: buildPrompt(text) }],
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 600,
    }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!resp.ok) throw new Error(`OpenRouter API ${resp.status}`);
  const data = await resp.json();
  const raw = data?.choices?.[0]?.message?.content;
  if (!raw) throw new Error('OpenRouter の返事が空です');
  return parseCandidates(raw);
}
