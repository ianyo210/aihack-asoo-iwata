/* =========================================================
   api/analyze.js — Vercel Serverless Function & Local Analyzer
   子ども部屋の発話（テキスト＋直近バッファ）を解析し、
   話者分離・ケンカ発端と伝え方アドバイス・ことばの博物館・
   ほっこり/持ち物発見を JSON で返す。
   GEMINI_API_KEY が未設定または失敗時は内蔵エンジンへ自動フォールバック。
   ========================================================= */

const CHILD_WORDS_DICT = [
  { child: 'とうもころし', adult: 'とうもろこし', category: 'たべもの', icon: '🌽' },
  { child: 'てビリ', adult: 'テレビ', category: 'おうち', icon: '📺' },
  { child: 'てびり', adult: 'テレビ', category: 'おうち', icon: '📺' },
  { child: 'おちゃかな', adult: 'お魚', category: 'たべもの', icon: '🐟' },
  { child: 'エベレーター', adult: 'エレベーター', category: 'おでかけ', icon: '🛗' },
  { child: 'えべれーたー', adult: 'エレベーター', category: 'おでかけ', icon: '🛗' },
  { child: 'すぱげっち', adult: 'スパゲッティ', category: 'たべもの', icon: '🍝' },
  { child: 'ぶるぞーだー', adult: 'ブルドーザー', category: 'のりもの', icon: '🚜' },
  { child: 'しょぼしゃ', adult: '消防車', category: 'のりもの', icon: '🚒' },
  { child: 'きゅきゅしゃ', adult: '救急車', category: 'のりもの', icon: '🚑' },
  { child: 'しんかんちぇん', adult: '新幹線', category: 'のりもの', icon: '🚅' },
  { child: 'おにぎりぎり', adult: 'おにぎり', category: 'たべもの', icon: '🍙' },
  { child: 'あっちっち', adult: '熱いもの', category: 'せいかつ', icon: '🔥' },
  { child: 'くっく', adult: 'くつ', category: 'おでかけ', icon: '👟' },
  { child: 'ぷっちん', adult: 'プリン', category: 'たべもの', icon: '🍮' },
  { child: 'とまとま', adult: 'トマト', category: 'たべもの', icon: '🍅' },
  { child: 'ちゅうちゅう', adult: 'ジュース', category: 'たべもの', icon: '🧃' },
];

const MILESTONE_WORDS = [
  'ちなみに',
  'やっぱり',
  'なるほど',
  'おやくそく',
  '約束',
  'じゅんばん',
  '順番',
  'はんぶんこ',
  '半分こ',
  'ありがとう',
  'ごめんね',
  'だいじょうぶ',
  'かんぺき',
];

const CONFLICT_RE =
  /(ダメ|だめ|返して|かえして|取った|とった|とらないで|言った|言ってない|聞いてない|ずるい|うわーん|わーん|ママー|叩いた|たたいた|ぶった|壊した|こわした|やだ|先に|さっき|ぼくの|僕の|ルール|やめて|押した|おした)/;

const KINDNESS_RE =
  /(半分こ|はんぶんこ|どうぞ|ありがとう|ごめんね|だいじょうぶ|大丈夫|貸してあげる|手伝う|いっしょに|一緒に|よしよし|すごいね|えらい)/;

const TODO_RE =
  /(明日|あした|あさって|幼稚園|小学校|学校|持ち物|持っていく|もっていく|どんぐり|牛乳パック|コンパス|体操服|提出|プリント|遠足|宿題|先生|スイミング|検診|病院|絵の具|のり|はさみ)/;

const FUNNY_RE =
  /(宇宙人|ゾンビ|魔法|恐竜|もしも|へんしん|変身|社長|おばけ|秘密|ひみつ|ぼうけん|最強|おなら|うんち|ねこ語|ロボット)/;

function pickTopicNoun(text) {
  const candidates = [
    '赤い電車',
    '電車',
    'ブロック',
    'お城',
    'レゴ',
    'ゲーム',
    'スイッチ',
    'タブレット',
    'クレヨン',
    '絵本',
    'お菓子',
    'おやつ',
    'ぬいぐるみ',
    'おもちゃ',
    'テレビ',
    'ボール',
  ];
  for (const c of candidates) {
    if (text.includes(c)) return c;
  }
  return 'おもちゃ';
}

export function separateSpeakers(rawText) {
  const cleaned = String(rawText || '').trim();
  if (!cleaned) return [];

  const chunks = cleaned
    .split(/\r?\n|(?<=[。！？!?])\s*/)
    .map((s) => s.trim())
    .filter(Boolean);

  const lines = chunks.length > 0 ? chunks : [cleaned];
  const result = [];
  let lastSpeakerId = 'riku';

  for (const line of lines) {
    const explicit = line.match(/^(兄|ソラ|そら|弟|リク|りく)\s*[:：]\s*(.+)$/);
    if (explicit) {
      const who = explicit[1];
      const isSora = /^(兄|ソラ|そら)$/.test(who);
      result.push({
        speakerId: isSora ? 'sora' : 'riku',
        speaker: isSora ? '兄・ソラ' : '弟・リク',
        avatar: isSora ? '🦁' : '🐣',
        text: explicit[2].trim(),
      });
      lastSpeakerId = isSora ? 'sora' : 'riku';
      continue;
    }

    let speakerId;
    if (/(お兄ちゃん|そら|ソラが|貸して|うわーん|わーん|ママー|だって|ずるい|とった|取った|たたいた|叩いた)/.test(line)) {
      speakerId = 'riku';
    } else if (/(ぼくが先|僕が先|返して|かえして|リク|りく|置いて|おいて|作ってた|つくってた|あとで使う|まだ使って|ダメ|だめ)/.test(line)) {
      speakerId = 'sora';
    } else {
      speakerId = lastSpeakerId === 'sora' ? 'riku' : 'sora';
    }

    lastSpeakerId = speakerId;
    result.push({
      speakerId,
      speaker: speakerId === 'sora' ? '兄・ソラ' : '弟・リク',
      avatar: speakerId === 'sora' ? '🦁' : '🐣',
      text: line,
    });
  }

  return result;
}

export function analyzeWithRules({
  text,
  ageStage = 'kindergarten',
  history = [],
  activeMuseumWords = ['とうもころし', 'てビリ', 'おちゃかな'],
  knownVocabulary = [],
}) {
  const raw = String(text || '').trim();
  const utterances = separateSpeakers(raw);
  const combinedHistory = [
    ...history.map((h) => `${h.speaker || ''} ${h.text || ''}`).join(' '),
    raw,
  ].join(' ');
  const topic = pickTopicNoun(combinedHistory);

  // 1. 卒業チェック（現在博物館にある言い間違いの「正しい大人語」を言えたら卒業！）
  const activeSet = new Set(activeMuseumWords);
  for (const entry of CHILD_WORDS_DICT) {
    if (activeSet.has(entry.child) && raw.includes(entry.adult)) {
      return {
        mode: 'local-fallback',
        ageStage,
        utterances,
        eventType: 'museum_grad',
        liveStatus: {
          emoji: '🌸',
          level: 'happy',
          label: `記念日！「${entry.adult}」が正しく言えました！`,
          detail: `子ども部屋で「${entry.child}」卒業の瞬間をキャッチしました`,
        },
        museumItem: {
          kind: 'graduation',
          icon: entry.icon,
          childWord: entry.child,
          adultWord: entry.adult,
          category: entry.category,
          exampleQuote: utterances[0]?.text || raw,
          note: `これまで「${entry.child}」と呼んでいた言葉を、今日初めて「${entry.adult}」と正しく発音できました！`,
          needsApproval: true,
        },
        newWords: [],
      };
    }
  }

  // 2. ケンカ・取り合い・言った言わないチェック
  if (CONFLICT_RE.test(raw)) {
    const earlierMatch = [...history]
      .reverse()
      .find(
        (h) =>
          h &&
          h.text &&
          !CONFLICT_RE.test(h.text) &&
          (h.text.includes(topic) || /(作|使|置|ルール|交代|あと|先)/.test(h.text)),
      );

    const isElementary = ageStage === 'elementary';
    const firstFact = earlierMatch
      ? `${earlierMatch.timeLabel || '2分前'}：${earlierMatch.speaker || '兄・ソラ'}が「${earlierMatch.text}」と先に宣言・使用していた`
      : isElementary
        ? `数分前：遊びのルール（「1回終わったら交代」など）を口頭で決めていた`
        : `数分前：ソラが「あとで使うから」と${topic}を近くに置いて作業していた`;

    const secondFact = isElementary
      ? `直前：条件の認識がズレたまま「言った」「聞いてない」の口論に発展`
      : `直前：リクが「置いてある＝空いてる」と思い「貸して」と手に取った`;

    const thirdFact =
      utterances.length >= 2
        ? `今：${utterances[utterances.length - 1].speaker}が「${utterances[utterances.length - 1].text}」と感情が高ぶっている`
        : `今：「返して！」「ママー！」と互いに助けを呼んでいる`;

    const advice = isElementary
      ? {
          coachTip:
            '小学生は「どちらが正しいか」を一番気にします。親が感覚で怒る前に、まず記録された事実（ルール決め）を2人に見せて「じゃあ次どうする？」と本人に決めさせるとスッと収まります。',
          toSora: `「ソラは『さっき決めたルールを守りたかった』んだよね。ちゃんと約束を覚えてたのはえらいよ」`,
          toRiku: `「リクは『そこまでは聞いてなかった・もう交代だと思った』んだね。勘違いは誰にでもあるよ」`,
          toBoth: `「常時メモを見たら、条件の言い方がちょっと曖昧だったみたい。今から『タイマー3分で交代』にルールを書き直して再スタートしよう！」`,
          shortVersion: {
            toSora: `「ソラがルール通りにしたかったのは分かったよ」`,
            toRiku: `「リクも聞き違いだったんだね。悪気ないのは分かってるよ」`,
            toBoth: `「今から3分タイマーで公平に交代しよう！」`,
          },
          ngPhrase: '「いい加減にしなさい！2人ともゲーム禁止！」（事実を見ずに取り上げると不信感が残ります）',
          recommendedTimerSec: 180,
        }
      : {
          coachTip:
            '幼児の取り合いは「どちらかが嘘をついている」のではなく、認識のズレが9割。先に使っていた兄の悔しさを一言代弁してから弟の「貸してと言えた頑張り」を認めると、30秒で落ち着きます。',
          toSora: `「ソラ、先に${topic}で遊んでたんだよね。急に取られたらびっくりして嫌だったね」`,
          toRiku: `「リクも使いたかったんだよね。ちゃんと『貸して』って言おうとしたのもえらかったよ」`,
          toBoth: `「ソラは『まだ使ってる途中』、リクは『空いてる』と思っちゃったんだね。ソラがあと3分使ったら、タイマーが鳴ったらリクの番にしよう！」`,
          shortVersion: {
            toSora: `「先使ってたのに取られて悔しかったね」`,
            toRiku: `「リクも使いたかったんだね、痛かったね」`,
            toBoth: `「3分タイマー鳴ったら交代っこしよう！」`,
          },
          ngPhrase: '「お兄ちゃんなんだから貸してあげなさい！」（我慢を押し付けると兄の怒りが爆発します）',
          recommendedTimerSec: 180,
        };

    return {
      mode: 'local-fallback',
      ageStage,
      utterances,
      eventType: 'conflict',
      liveStatus: {
        emoji: '🚨',
        level: 'alert',
        label: isElementary
          ? `言った・言わないの口論を検知！（${topic}）`
          : `取り合いケンカを検知！（${topic}）`,
        detail: '直前バッファから発端を巻き戻し、声かけカンペを作成しました',
      },
      conflict: {
        title: isElementary ? `${topic}のルール・言った言わない発生` : `${topic}の取り合い発生！`,
        severity: 'urgent',
        topic,
        causeTimeline: [
          { timeLabel: '発端', actor: '兄・ソラ', fact: firstFact },
          { timeLabel: 'すれ違い', actor: '弟・リク', fact: secondFact },
          { timeLabel: '現在', actor: '2人', fact: thirdFact },
        ],
        truthConclusion: isElementary
          ? 'どちらも嘘はついていません。口頭のルール確認が途中で曖昧になったすれ違いです。'
          : `どちらも悪気はありません！ソラが「まだ使う途中」で、リクは「空いている」と思ったすれ違いです。`,
        advice,
      },
      newWords: [],
    };
  }

  // 3. 言い間違い発見チェック
  for (const entry of CHILD_WORDS_DICT) {
    if (raw.includes(entry.child)) {
      return {
        mode: 'local-fallback',
        ageStage,
        utterances,
        eventType: 'museum_new',
        liveStatus: {
          emoji: '🏛️',
          level: 'happy',
          label: `かわいい言い間違い「${entry.child}」を発見！`,
          detail: `ことばの博物館に展示候補として届きました（写真添付もできます）`,
        },
        museumItem: {
          kind: 'mispronunciation',
          icon: entry.icon,
          childWord: entry.child,
          adultWord: entry.adult,
          category: entry.category,
          exampleQuote: utterances[0]?.text || raw,
          note: `「${entry.adult}」を「${entry.child}」と言っていました！今のうちに標本保存がおすすめです。`,
          needsApproval: true,
        },
        newWords: [],
      };
    }
  }

  // 4. 持ち物・予定のポロッと発言 / 仲良し / 面白会話 / 増えた言葉
  const spottedNewWords = MILESTONE_WORDS.filter(
    (w) => raw.includes(w) && !knownVocabulary.includes(w),
  );

  if (TODO_RE.test(raw)) {
    return {
      mode: 'local-fallback',
      ageStage,
      utterances,
      eventType: 'discovery',
      liveStatus: {
        emoji: '🎒',
        level: 'warn',
        label: '会話から「明日の予定・持ち物」をキャッチ！',
        detail: '忘れ物防止メモとしてお母さんのスマホに保存しました',
      },
      discovery: {
        kind: 'todo',
        title: 'ポロッと出た持ち物・予定メモ',
        summary: `子どもたちの会話から「${raw}」という予定・持ち物に関する発言が見つかりました。`,
        momAction: 'カレンダーに追加／玄関に準備メモを貼る',
        calendarEvent: {
          title: `持ち物・予定確認：${raw.slice(0, 22)}`,
          dateOffsetDays: 1,
          note: `子ども部屋の会話より自動抽出：「${raw}」`,
        },
      },
      newWords: spottedNewWords,
    };
  }

  if (KINDNESS_RE.test(raw)) {
    return {
      mode: 'local-fallback',
      ageStage,
      utterances,
      eventType: 'discovery',
      liveStatus: {
        emoji: '💖',
        level: 'happy',
        label: '親が見ていないところで仲良し発見！',
        detail: 'ほっこりハイライトに記録しました（夜に褒めてあげましょう）',
      },
      discovery: {
        kind: 'kindness',
        title: '隠れた優しいやり取りキャッチ✨',
        summary: `「${raw}」と、お互いに思いやりを持ってやり取りできていました！`,
        momAction: `寝る前の褒めセリフ：「今日、見えないところで『${raw.slice(0, 18)}』って優しくできてたの、ちゃんと知ってるよ！」`,
      },
      newWords: spottedNewWords,
    };
  }

  if (FUNNY_RE.test(raw)) {
    return {
      mode: 'local-fallback',
      ageStage,
      utterances,
      eventType: 'discovery',
      liveStatus: {
        emoji: '😂',
        level: 'happy',
        label: '子ども部屋の「珍会話・名言」をキャッチ！',
        detail: '面白い会話ギャラリーに保存しました',
      },
      discovery: {
        kind: 'funny',
        title: '今日の子ども部屋・珍会話ラジオ🎙️',
        summary: raw,
        momAction: 'パパにも「今日こんな面白いこと話してたよ！」とシェアする',
      },
      newWords: spottedNewWords,
    };
  }

  if (spottedNewWords.length > 0) {
    return {
      mode: 'local-fallback',
      ageStage,
      utterances,
      eventType: 'museum_new',
      liveStatus: {
        emoji: '🌱',
        level: 'happy',
        label: `新しいことば「${spottedNewWords[0]}」を使えました！`,
        detail: 'ことばの博物館「増えた言葉コーナー」に登録できます',
      },
      museumItem: {
        kind: 'new_word',
        icon: '🌱',
        childWord: spottedNewWords[0],
        adultWord: `新語（${spottedNewWords[0]}）`,
        category: 'ふえたことば',
        exampleQuote: utterances[0]?.text || raw,
        note: `会話の中で自然に「${spottedNewWords[0]}」を使いこなしていました！`,
        needsApproval: true,
      },
      newWords: spottedNewWords,
    };
  }

  // 5. 平常会話（ローリングバッファに一時保持、通知は鳴らさない）
  return {
    mode: 'local-fallback',
    ageStage,
    utterances,
    eventType: 'peaceful',
    liveStatus: {
      emoji: '🟢',
      level: 'peace',
      label: `平和に遊んでいます（${topic}など）`,
      detail: '直近3分バッファにのみ保持（問題なければ自動消去・保存ゼロ）',
    },
    newWords: [],
  };
}

async function analyzeWithGemini({ text, ageStage, history, activeMuseumWords }) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5500);

  try {
    const prompt = `
あなたは共働きのお母さんを助ける家庭内見守りAI「ことばの博物館＆ママコーチ」です。
子ども部屋で録音された直近の発話と今回の発話を解析し、必ず有効なJSONのみを返してください。

条件:
- 年齢モード: ${ageStage === 'elementary' ? '小学生（7〜12歳: 論理・ルール・言った言わない重視）' : '幼稚園児（3〜6歳: 気持ち代弁・やさしい翻訳・言い間違い重視）'}
- 現在博物館で現役の言い間違い: ${JSON.stringify(activeMuseumWords)}
- 直近の3分バッファ履歴: ${JSON.stringify(history.slice(-6))}
- 今回の発話テキスト: ${JSON.stringify(text)}

出力JSON形式:
{
  "utterances": [{"speakerId":"sora|riku","speaker":"兄・ソラ|弟・リク","avatar":"🦁|🐣","text":"..."}],
  "eventType": "conflict|museum_new|museum_grad|discovery|peaceful",
  "liveStatus": {"emoji":"🟢|🚨|🏛️|🌸|💖|🎒|😂","level":"peace|warn|alert|happy","label":"1行タイトル","detail":"補足"},
  "conflict": {
    "title": "...",
    "severity": "urgent|caution",
    "topic": "...",
    "causeTimeline": [{"timeLabel":"発端","actor":"...","fact":"..."},{"timeLabel":"すれ違い","actor":"...","fact":"..."},{"timeLabel":"現在","actor":"...","fact":"..."}],
    "truthConclusion": "...",
    "advice": {
      "coachTip": "...",
      "toSora": "...",
      "toRiku": "...",
      "toBoth": "...",
      "shortVersion": {"toSora":"...","toRiku":"...","toBoth":"..."},
      "ngPhrase": "...",
      "recommendedTimerSec": 180
    }
  },
  "museumItem": {
    "kind": "mispronunciation|graduation|new_word",
    "icon": "🌽",
    "childWord": "...",
    "adultWord": "...",
    "category": "...",
    "exampleQuote": "...",
    "note": "...",
    "needsApproval": true
  },
  "discovery": {
    "kind": "kindness|funny|todo",
    "title": "...",
    "summary": "...",
    "momAction": "..."
  },
  "newWords": []
}
※該当しないサブオブジェクト(conflict, museumItem, discovery)はnullにしてください。
`.trim();

    const resp = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.3,
          },
        }),
        signal: controller.signal,
      },
    );

    if (!resp.ok) return null;
    const data = await resp.json();
    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;
    const parsed = JSON.parse(rawText);
    if (!parsed || !parsed.eventType || !Array.isArray(parsed.utterances)) return null;
    return {
      mode: 'gemini',
      ageStage,
      ...parsed,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeUtterance(payload) {
  const text = String(payload?.text || '').trim();
  if (!text) {
    return {
      mode: 'local-fallback',
      ageStage: payload?.ageStage || 'kindergarten',
      utterances: [],
      eventType: 'peaceful',
      liveStatus: {
        emoji: '🟢',
        level: 'peace',
        label: '見守り待機中',
        detail: '声を感知すると自動で聞き取りを始めます',
      },
      newWords: [],
    };
  }

  const geminiResult = await analyzeWithGemini(payload);
  if (geminiResult) return geminiResult;
  return analyzeWithRules(payload);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ok: true,
        service: 'kotoba-museum-analyzer',
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
      }),
    );
    return;
  }

  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: 'Method Not Allowed' }));
    return;
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      body = JSON.parse(body || '{}');
    } else if (!body) {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const rawBody = Buffer.concat(chunks).toString('utf8');
      body = rawBody ? JSON.parse(rawBody) : {};
    }

    const result = await analyzeUtterance(body || {});
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: true, ...result }));
  } catch (err) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ ok: false, error: err?.message || 'Analyze failed' }));
  }
}
