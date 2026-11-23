// 実行: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toHiragana, normalizeTranscript, detectByRules, sanitizeCandidates, detectMistakes,
  registerEntry, graduate, findGraduationHints,
} from '../lib/mistakes.js';
import { detectByGemini } from '../lib/gemini.js';
import { detectByOpenRouter } from '../lib/openrouter.js';

test('カタカナをひらがなにそろえる', () => {
  assert.equal(toHiragana('てビリ'), 'てびり');
});

test('辞書ルール: 「てビリ」を見つけ、元の書き方と出た文を返す', () => {
  const r = detectByRules('てビリ みたいなー。ごはんたべる');
  assert.equal(r.length, 1);
  assert.equal(r[0].wrong, 'てビリ');
  assert.equal(r[0].right, 'テレビ');
  assert.equal(r[0].quote, 'てビリ みたいなー');
});

test('辞書ルール: 正しい「テレビ」は拾わない', () => {
  assert.deepEqual(detectByRules('テレビ みたい'), []);
});

test('辞書ルール: 空白が入っていても見つける', () => {
  const r = detectByRules('と うもころし たべた');
  assert.equal(r.length, 1);
  assert.equal(r[0].right, 'とうもろこし');
});

test('辞書ルール: Aqua の実測の形（手びり／トウモコロシ）を拾う', () => {
  assert.equal(detectByRules('手びりみたいな')[0].right, 'テレビ');
  assert.equal(detectByRules('トウモコロシ食べたい。')[0].right, 'とうもろこし');
  assert.deepEqual(detectByRules('テレビみたいな'), []);
});

test('normalizeTranscript: 形が揺れても落ちない', () => {
  assert.deepEqual(normalizeTranscript('  こんにちは '), { text: 'こんにちは', segments: [] });
  assert.equal(normalizeTranscript({ text: 'あ' }).text, 'あ');
  const seg = normalizeTranscript({ segments: [{ speaker: 'A', text: 'いち' }, { speaker: 'B', text: 'に' }, { text: '' }] });
  assert.equal(seg.text, 'いち\nに');
  assert.equal(seg.segments.length, 2);
  assert.deepEqual(normalizeTranscript(null), { text: '', segments: [] });
});

test('sanitizeCandidates: 同じ言葉・長すぎる・空は捨てる', () => {
  const r = sanitizeCandidates([
    { wrong: 'てビリ', right: 'テレビ' },
    { wrong: 'ぱんだ', right: 'パンダ' }, // ひらがな/カタカナだけの違いは言い間違いではない
    { wrong: '', right: 'x' },
    { wrong: 'あ'.repeat(30), right: 'い' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].wrong, 'てビリ');
  assert.deepEqual(sanitizeCandidates('壊れた返事'), []);
});

test('detectMistakes: AI が失敗してもルールで続ける', async () => {
  const llm = async () => { throw new Error('Gemini API 503'); };
  const r = await detectMistakes('てビリ みたい', { llm });
  assert.equal(r.source, 'rules');
  assert.equal(r.candidates.length, 1);
  assert.match(r.aiError, /503/);
});

test('detectMistakes: AI の候補とルールを合わせ、重複は1つ', async () => {
  const llm = async () => [{ wrong: 'てビリ', right: 'テレビ' }, { wrong: 'ぷりん', right: 'プリン' }];
  // 「ぷりん」と「プリン」はひらがな化すると同じなので捨てられる
  const r = await detectMistakes('てビリ みたい', { llm });
  assert.equal(r.source, 'ai+rules');
  assert.deepEqual(r.candidates.map((c) => c.wrong), ['てビリ']);
});

test('detectMistakes: AI だけが見つけた新しい言い間違いも拾う', async () => {
  const llm = async () => [{ wrong: 'ひこーき', right: '飛行機', note: '' }];
  const r = await detectMistakes('ひこーき とんでる', { llm });
  assert.deepEqual(r.candidates.map((c) => c.wrong), ['ひこーき']);
});

test('detectMistakes: 空の文章は何もしない', async () => {
  assert.deepEqual(await detectMistakes('   '), { source: 'rules', candidates: [] });
});

test('registerEntry: 追加・同じ言葉なら回数を足す・元の配列は変えない', () => {
  const c = { wrong: 'てビリ', right: 'テレビ', note: '' };
  const m0 = [];
  const m1 = registerEntry(m0, c, { date: '2026-11-20', clipId: 'a' });
  const m2 = registerEntry(m1, { ...c, wrong: 'てびり' }, { date: '2026-11-22', clipId: 'b' });
  assert.equal(m0.length, 0);
  assert.equal(m1[0].count, 1);
  assert.equal(m2.length, 1);
  assert.equal(m2[0].count, 2);
  assert.equal(m2[0].firstDate, '2026-11-20');
  assert.equal(m2[0].lastDate, '2026-11-22');
  assert.deepEqual(m2[0].clipIds, ['a', 'b']);
});

test('graduate: 卒業の日を記録する。見つからなければそのまま', () => {
  const m = registerEntry([], { wrong: 'てビリ', right: 'テレビ' }, { date: '2026-11-20' });
  const g = graduate(m, 'てビリ', '2026-11-23');
  assert.equal(g[0].graduatedDate, '2026-11-23');
  assert.equal(graduate(g, 'てビリ', '2026-12-01')[0].graduatedDate, '2026-11-23'); // 上書きしない
  assert.equal(graduate(m, 'ぞうさん', '2026-11-23'), m);
});

test('findGraduationHints: 正しい言い方だけ出たら卒業の候補', () => {
  const m = registerEntry([], { wrong: 'てビリ', right: 'テレビ' }, { date: '2026-11-20' });
  assert.equal(findGraduationHints(m, 'テレビ みたい').length, 1);
  assert.equal(findGraduationHints(m, 'テレビ じゃなくて てビリ みたい').length, 0);
  assert.equal(findGraduationHints(graduate(m, 'てビリ', '2026-11-23'), 'テレビ みたい').length, 0);
});

// ---- Gemini（本物は呼ばない。fetch を差し替える）----
const okResponse = (body) => ({ ok: true, status: 200, json: async () => body });
const geminiBody = (obj) => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });

test('detectByGemini: 鍵はヘッダーで送り、URL に載せない', async () => {
  let seen;
  const fetchImpl = async (url, init) => { seen = { url, init }; return okResponse(geminiBody({ candidates: [{ wrong: 'てビリ', right: 'テレビ' }] })); };
  const r = await detectByGemini('てビリ みたい', { apiKey: 'SECRET', fetchImpl });
  assert.equal(r[0].wrong, 'てビリ');
  assert.ok(!seen.url.includes('SECRET'));
  assert.equal(seen.init.headers['x-goog-api-key'], 'SECRET');
});

test('detectByGemini: 鍵なし・HTTP エラー・空の返事は例外', async () => {
  await assert.rejects(detectByGemini('x', { apiKey: '' }), /GEMINI_API_KEY/);
  await assert.rejects(detectByGemini('x', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/);
  await assert.rejects(detectByGemini('x', { apiKey: 'k', fetchImpl: async () => okResponse({ candidates: [] }) }), /空/);
});

test('detectByOpenRouter: 鍵は Authorization ヘッダー。モデルを指定でき、返事を候補にする', async () => {
  let seen;
  const fetchImpl = async (url, init) => {
    seen = { url, init, body: JSON.parse(init.body) };
    return okResponse({ choices: [{ message: { content: JSON.stringify({ candidates: [{ wrong: 'てビリ', right: 'テレビ' }] }) } }] });
  };
  const r = await detectByOpenRouter('てビリ みたい', { apiKey: 'SECRET', model: 'test/model', fetchImpl });
  assert.equal(r[0].right, 'テレビ');
  assert.equal(seen.url, 'https://openrouter.ai/api/v1/chat/completions');
  assert.ok(!seen.url.includes('SECRET'));
  assert.equal(seen.init.headers.Authorization, 'Bearer SECRET');
  assert.equal(seen.body.model, 'test/model');
});

test('detectByOpenRouter: 鍵なし・HTTP エラー・空の返事は例外', async () => {
  await assert.rejects(detectByOpenRouter('x', { apiKey: '' }), /OPENROUTER_API_KEY/);
  await assert.rejects(detectByOpenRouter('x', { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 401 }) }), /401/);
  await assert.rejects(detectByOpenRouter('x', { apiKey: 'k', fetchImpl: async () => okResponse({ choices: [] }) }), /空/);
});

test('結合: OpenRouter が落ちても、辞書ルールでデモは止まらない', async () => {
  const llm = (t) => detectByOpenRouter(t, { apiKey: 'k', fetchImpl: async () => ({ ok: false, status: 503 }) });
  const r = await detectMistakes('手びり みたい', { llm });
  assert.equal(r.source, 'rules');
  assert.equal(r.candidates[0].right, 'テレビ');
});

test('結合: Gemini が落ちても、辞書ルールでデモは止まらない', async () => {
  const llm = (t) => detectByGemini(t, { apiKey: 'k', fetchImpl: async () => { throw new Error('network'); } });
  const r = await detectMistakes('とうもころし おいしい', { llm });
  assert.equal(r.candidates[0].right, 'とうもろこし');
  assert.equal(r.source, 'rules');
});
