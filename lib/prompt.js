// 言い間違い抽出のプロンプト（Gemini と OpenRouter で共通）

export const buildPrompt = (text) =>
  `
あなたは子どもの言語発達に詳しいアシスタントです。
次は、子どもの声を文字起こしした文章です。子どもの「言い間違い」だけを取り出し、有効なJSONのみを返してください。

ルール:
- 言い間違いとは、子どもが言葉の音を間違えて言ったもの（例: てビリ→テレビ、とうもころし→とうもろこし）。
- 文字起こしは、すでに正しい言葉に直されている可能性がある。直されていて確かめられないものは、候補にしない。
- 文章に書かれていないことは作らない。見つからなければ空の配列を返す。
- 大人の言い間違い、方言、擬音語、あだ名は含めない。
- 最大5件。

出力:
{"candidates":[{"wrong":"言い間違いの形","right":"正しい言葉","note":"一言（20字以内）","quote":"その言葉が出た文"}]}

文字起こし:
${JSON.stringify(text)}
`.trim();

/** AI の返事（JSON 文字列）から候補の配列を取り出す。未検証なので sanitizeCandidates を通すこと。 */
export function parseCandidates(raw) {
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : parsed?.candidates ?? [];
}
