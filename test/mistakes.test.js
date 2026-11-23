// 実行: node --test test/
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toHiragana, normalizeTranscript, detectByRules, sanitizeCandidates, detectMistakes,
  registerEntry, graduate, findGraduationHints, updateEntry, removeEntry,
  recordSighting, frequencyOf, nthSighting,
  attributeSpeakers, addChild, updateChild, removeChild, ageText, defaultChildId, assignChild, CHILD_LIMIT, unreadSince, familyDictionary, hintPrompt, telHref,
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

test('updateEntry: 訂正・写真・卒業の日を直せる。不正な日付は無視。元の配列は変えない', () => {
  const m = registerEntry([], { wrong: 'てビリ', right: 'テレビ' }, { date: '2026-11-20' });
  const id = m[0].id;
  const u = updateEntry(m, id, { right: '  テレビ番組 ', photoId: 'ph-1', graduatedDate: '2026-11-23' });
  assert.equal(u[0].right, 'テレビ番組');
  assert.equal(u[0].photoId, 'ph-1');
  assert.equal(u[0].graduatedDate, '2026-11-23');
  assert.equal(m[0].right, 'テレビ'); // 元は変わらない
  assert.equal(updateEntry(u, id, { graduatedDate: '2026/11/23' })[0].graduatedDate, '2026-11-23'); // 形が違う
  assert.equal(updateEntry(u, id, { graduatedDate: '2026-13-45' })[0].graduatedDate, '2026-11-23'); // 存在しない日
  assert.equal(updateEntry(u, id, { graduatedDate: null })[0].graduatedDate, null); // 卒業を取り消す
  assert.equal(updateEntry(u, id, { id: 'x', count: 99 })[0].count, 1); // 直せない項目は無視
  assert.equal(updateEntry(u, 'ない', { right: 'x' })[0].right, 'テレビ番組');
});

test('removeEntry: 図書館から外す', () => {
  const m = registerEntry(registerEntry([], { wrong: 'てビリ', right: 'テレビ' }), { wrong: 'とうもころし', right: 'とうもろこし' });
  assert.equal(removeEntry(m, m[0].id).length, 1);
  assert.equal(m.length, 2);
});

test('recordSighting: 初めては新しく作り、2回目からは回数を足す。記録は新しい順', () => {
  let s = { museum: [], events: [] };
  s = recordSighting(s, { wrong: 'てビリ', right: 'テレビ' }, { at: '2026-11-18T09:00:00', clipId: 'a', quote: 'てビリ みたい' });
  s = recordSighting(s, { wrong: 'てビリ', right: 'テレビ' }, { at: '2026-11-21T18:30:00', clipId: 'b' });
  assert.equal(s.museum.length, 1);
  assert.equal(s.museum[0].count, 2);
  assert.equal(s.museum[0].firstDate, '2026-11-18');
  assert.equal(s.events.length, 2);
  assert.equal(s.events[0].at, '2026-11-21T18:30:00'); // 新しい順
  assert.equal(s.events[1].quote, 'てビリ みたい');
  assert.equal(s.events[0].entryId, s.museum[0].id);
  assert.deepEqual(recordSighting(undefined, { wrong: 'x', right: 'y' }, { at: '2026-11-23T10:00:00' }).events.length, 1);
});

test('frequencyOf: 通算・直近7日・1週間あたり・日別', () => {
  let s = { museum: [], events: [] };
  const c = { wrong: 'てビリ', right: 'テレビ' };
  for (const at of ['2026-11-02T08:00:00', '2026-11-18T09:00:00', '2026-11-21T18:30:00', '2026-11-21T19:00:00', '2026-11-23T07:10:00']) s = recordSighting(s, c, { at });
  s = recordSighting(s, { wrong: 'ぱんだ', right: 'パンダ' }, { at: '2026-11-22T10:00:00' });
  const id = s.museum[0].id;
  const f = frequencyOf(s.events, id, '2026-11-23T12:00:00');
  assert.equal(f.total, 5);
  assert.equal(f.firstAt, '2026-11-02T08:00:00');
  assert.equal(f.lastAt, '2026-11-23T07:10:00');
  assert.equal(f.last7, 4); // 11/18（5日と3時間前）、11/21 が2回、11/23 が1回。11/02 は含まない
  assert.deepEqual(f.days.slice(0, 2), [{ date: '2026-11-23', count: 1 }, { date: '2026-11-21', count: 2 }]);
  assert.equal(f.perWeek, 1.7); // 5回 ÷ 約3.02週（11/02 08:00 〜 11/23 12:00）
  assert.deepEqual(frequencyOf(s.events, 'w-ない'), { total: 0, firstAt: null, lastAt: null, last7: 0, perWeek: 0, days: [] });
});

test('nthSighting: その言葉の何回目か', () => {
  let s = { museum: [], events: [] };
  for (const at of ['2026-11-18T09:00:00', '2026-11-21T18:30:00']) s = recordSighting(s, { wrong: 'てビリ', right: 'テレビ' }, { at });
  const [latest, first] = s.events;
  assert.equal(nthSighting(s.events, first), 1);
  assert.equal(nthSighting(s.events, latest), 2);
});

test('normalizeTranscript: Aqua の diarized_json（turns）から話者つきの文を取る', () => {
  const r = normalizeTranscript({
    text: 'てびり みたい。ぼくも',
    speakers: [{ id: 'spk_0' }, { id: 'spk_1' }],
    turns: [{ speaker: 'spk_0', start: 0.1, end: 2, text: 'てびり みたい', words: [] }, { speaker: 'spk_1', start: 2.5, end: 3, text: 'ぼくも' }],
  });
  assert.deepEqual(r.segments, [
    { speaker: 'spk_0', text: 'てびり みたい', start: 0.1, end: 2 },
    { speaker: 'spk_1', text: 'ぼくも', start: 2.5, end: 3 },
  ]);
});

test('attributeSpeakers: 言い間違いを、それを言った話者に結びつける', () => {
  const segs = [{ speaker: 'spk_0', text: 'ぼくも あそぶ' }, { speaker: 'spk_1', text: 'てビリ みたいなー' }];
  const r = attributeSpeakers([{ wrong: 'てびり', right: 'テレビ' }, { wrong: 'ぷりん', right: 'プリン', quote: 'ぼくも あそぶ' }, { wrong: 'ない', right: 'x' }], segs);
  assert.equal(r[0].speaker, 'spk_1'); // ひらがなとカタカナの違いは吸収
  assert.equal(r[1].speaker, 'spk_0'); // wrong が見つからなければ引用文から
  assert.equal(r[2].speaker, null);
  assert.equal(attributeSpeakers([{ wrong: 'a', right: 'b' }])[0].speaker, null); // 話者なし
});

test('子どもの情報: 追加・上限・更新・削除・年齢', () => {
  let c = addChild([], { name: ' ゆい ', birthday: '2023-07-15' });
  c = addChild(c, { name: 'そら', birthday: 'ふせい' });
  assert.deepEqual(c.map((x) => [x.id, x.name, x.birthday]), [['ch-1', 'ゆい', '2023-07-15'], ['ch-2', 'そら', null]]);
  assert.notEqual(c[0].color, c[1].color);
  assert.equal(addChild(c, { name: '  ' }), c); // 名前が空
  let many = []; for (let i = 0; i < 9; i++) many = addChild(many, { name: `こ${i}` });
  assert.equal(many.length, CHILD_LIMIT);
  c = updateChild(c, 'ch-2', { name: 'そらと', birthday: '2021-02-01' });
  assert.equal(c[1].name, 'そらと'); assert.equal(c[1].birthday, '2021-02-01');
  assert.equal(updateChild(c, 'ch-2', { name: '   ' })[1].name, 'そらと'); // 空の名前は無視
  const withIcon = updateChild(c, 'ch-2', { avatarId: 'av-1' });
  assert.equal(withIcon[1].avatarId, 'av-1');                         // アイコンを登録
  assert.equal(updateChild(withIcon, 'ch-2', { avatarId: '' })[1].avatarId, null); // はずす
  assert.equal(updateChild(withIcon, 'ch-2', { name: 'そら' })[1].avatarId, 'av-1'); // 名前を変えても残る
  c = removeChild(c, 'ch-1'); assert.equal(c.length, 1);
  assert.deepEqual(addChild(c, { name: 'みお' }).map((x) => x.id), ['ch-2', 'ch-3']); // 削除のあとでも番号は重ならない
  assert.equal(ageText('2023-07-15', new Date('2026-11-23T12:00:00')), '3歳4か月');
  assert.equal(ageText('2026-09-01', new Date('2026-11-23T12:00:00')), '2か月');
  assert.equal(ageText('2026-12-01', new Date('2026-11-23T12:00:00')), ''); // 未来
  assert.equal(ageText(null), '');
  assert.equal(defaultChildId([{ id: 'ch-1' }]), 'ch-1');
  assert.equal(defaultChildId([{ id: 'ch-1' }, { id: 'ch-2' }]), null);
  assert.equal(defaultChildId([]), null);
});

test('子どもごと: 同じ言葉でも、子どもが違えば別のカード', () => {
  let s = { museum: [], events: [] };
  s = recordSighting(s, { wrong: 'てビリ', right: 'テレビ', childId: 'ch-1' }, { at: '2026-11-20T09:00:00' });
  s = recordSighting(s, { wrong: 'てビリ', right: 'テレビ', childId: 'ch-2' }, { at: '2026-11-21T09:00:00' });
  s = recordSighting(s, { wrong: 'てビリ', right: 'テレビ', childId: 'ch-1' }, { at: '2026-11-22T09:00:00' });
  assert.equal(s.museum.length, 2);
  assert.equal(s.museum.find((m) => m.childId === 'ch-1').count, 2);
  assert.equal(frequencyOf(s.events, s.museum.find((m) => m.childId === 'ch-2').id, '2026-11-23T00:00:00').total, 1);
});

test('assignChild: 同じ録音の同じ声はまとめて動く。別の声・別の録音は動かない', () => {
  let s = { museum: [], events: [] };
  const rec = (wrong, speaker, clipId, at) => { s = recordSighting(s, { wrong, right: 'x', speaker }, { at, clipId }); };
  rec('てビリ', 'spk_0', 'c1', '2026-11-22T09:00:00');
  rec('とうもころし', 'spk_0', 'c1', '2026-11-22T09:00:05'); // 同じ録音・同じ声
  rec('ぱすた', 'spk_1', 'c1', '2026-11-22T09:00:08');       // 同じ録音・別の声
  rec('てビリ', 'spk_0', 'c2', '2026-11-22T18:00:00');       // 別の録音
  const first = s.events.find((e) => e.wrong === 'てビリ' && e.clipId === 'c1');
  const a = assignChild(s, first.id, 'ch-1');
  const byWrong = (w, clip) => a.events.find((e) => e.wrong === w && e.clipId === clip);
  assert.equal(byWrong('てビリ', 'c1').childId, 'ch-1');
  assert.equal(byWrong('とうもころし', 'c1').childId, 'ch-1'); // まとめて
  assert.equal(byWrong('ぱすた', 'c1').childId, null);          // 別の声は動かない
  assert.equal(byWrong('てビリ', 'c2').childId, null);          // 別の録音は動かない
  // カードの数え直し: ch-1 の てビリ は1回、元の（誰か不明の）てビリ は c2 の1回
  assert.equal(a.museum.find((m) => m.childId === 'ch-1' && m.wrong === 'てビリ').count, 1);
  assert.equal(a.museum.find((m) => !m.childId && m.wrong === 'てビリ').count, 1);
  assert.equal(s.events.find((e) => e.id === first.id).childId, null); // 元の state は変わらない
  // 「わからない」に戻すと、元のカードに戻って合算される
  const back = assignChild(a, first.id, null);
  assert.equal(back.museum.find((m) => !m.childId && m.wrong === 'てビリ').count, 2);
  assert.ok(!back.museum.some((m) => m.childId === 'ch-1' && m.wrong === 'てビリ')); // 空のカードは消える
  assert.equal(assignChild(s, 'ない', 'ch-1').events, s.events); // 無い記録は何もしない
});

test('unreadSince: 前回ひらいたあとに届いたものだけ、古い順', () => {
  const ev = [
    { id: 'c', at: '2026-11-23T12:30:00' },
    { id: 'a', at: '2026-11-22T16:05:00' },
    { id: 'b', at: '2026-11-23T08:10:00' },
  ];
  assert.deepEqual(unreadSince(ev, '2026-11-22T20:00:00').map((e) => e.id), ['b', 'c']);
  assert.deepEqual(unreadSince(ev, '2026-11-23T12:30:00').map((e) => e.id), []); // ちょうどの時刻は既読
  assert.deepEqual(unreadSince(ev, null).map((e) => e.id), ['a', 'b', 'c']);     // はじめては全部
  assert.deepEqual(unreadSince([], '2026-11-22T20:00:00'), []);
});

test('familyDictionary: 図書館の言葉を辞書に足す（卒業した言葉・重複は除く）', () => {
  const museum = [
    { wrong: 'さんとさん', right: 'サンタさん' },
    { wrong: 'てびり', right: 'テレビ' },              // 辞書と重複
    { wrong: 'えべれーたー', right: 'エレベーター', graduatedDate: '2026-11-20' }, // 卒業は除く
    { wrong: 'ぶーぶ', right: '' },                    // 訂正なしでも入る
  ];
  const d = familyDictionary(museum);
  assert.ok(d.some((x) => x.wrong === 'さんとさん'));
  assert.equal(d.filter((x) => x.wrong === 'てびり').length, 1);
  assert.equal(familyDictionary([{ wrong: 'ぴよぴよ', right: 'ひよこ', graduatedDate: '2026-11-20' }]).some((x) => x.wrong === 'ぴよぴよ'), false); // 卒業した言葉は足さない
  assert.ok(d.some((x) => x.wrong === 'ぶーぶ'));
});

test('本物の声の結果を再現: ヒントで「さんとさん」と書けたら、図書館の言葉で拾える', async () => {
  const museum = [{ wrong: 'さんとさん', right: 'サンタさん' }];
  const noLlm = await detectMistakes('さんとさん', { dictionary: familyDictionary(museum) });
  assert.deepEqual(noLlm.candidates.map((c) => c.wrong + '→' + c.right), ['さんとさん→サンタさん']);
  // AI が「言い間違いではない」と答えても（実測で Gemini は空だった）、図書館の言葉で拾う
  const aiEmpty = await detectMistakes('さんとさん', { llm: async () => [], dictionary: familyDictionary(museum) });
  assert.equal(aiEmpty.candidates[0].right, 'サンタさん');
  // 図書館に無ければ拾えない（＝1回目は、おうちのひとが登録する）
  assert.deepEqual((await detectMistakes('ほんとさ', { dictionary: familyDictionary(museum) })).candidates, []);
});

test('hintPrompt: Aqua に渡すヒントの文', () => {
  assert.equal(hintPrompt(['さんとさん', 'てびり', 'さんとさん', '']), 'この子がよく言う言葉: さんとさん、てびり');
  assert.equal(hintPrompt([]), '');
  assert.ok(hintPrompt(Array.from({ length: 100 }, (_, i) => `ことば${i}`)).length <= 400);
});

test('telHref: 電話番号を tel: リンクに（全角・ハイフン・空白も整える）', () => {
  assert.equal(telHref('090-1234-5678'), 'tel:09012345678');
  assert.equal(telHref('０９０ １２３４ ５６７８'), 'tel:09012345678');
  assert.equal(telHref('+81 90-1234-5678'), 'tel:+819012345678');
  assert.equal(telHref('110'), 'tel:110');
  assert.equal(telHref(''), '');
  assert.equal(telHref('12'), '');           // 短すぎる
  assert.equal(telHref('でんわ'), '');
  assert.equal(telHref('javascript:alert(1)'), ''); // 数字が1つだけなので、リンクにしない
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
