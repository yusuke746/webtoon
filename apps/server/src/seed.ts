/**
 * サンプルデータ投入スクリプト。
 *   npm run seed   （ルートから）
 * 既に同タイトルの作品がある場合はスキップする（再実行しても重複しない）。
 */
import { db } from './db.js';

const SAMPLE_TITLE = 'ムーンライト・アンティーク';

const exists = db.prepare('SELECT id FROM projects WHERE title = ?').get(SAMPLE_TITLE);
if (exists) {
  console.log(`[seed] 「${SAMPLE_TITLE}」は既に存在します (id=${(exists as any).id})。スキップします。`);
  process.exit(0);
}

// ---------- 作品 ----------

const synopsis =
  '高校2年生の月森ひかりは、失踪した祖母の代わりに「夜9時から夜明けまでだけ開く」骨董品店を継ぐことになる。' +
  'ひかりには品物に触れると、その持ち主の記憶と未練が視える力があった。' +
  '店の番人を名乗る人語を話す黒猫のクロに導かれ、訳ありの客が持ち込む品々の謎を解くうち、' +
  'ひかりは祖母の失踪が「開かずの抽斗」に隠された一枚の写真と、' +
  '半世紀前にこの店で起きた出来事に繋がっていることを知る。' +
  '品物の未練を解くたびに祖母の足取りへ近づく、一話完結×縦軸ミステリーの現代ファンタジー。';

const panelRules = {
  maxPanelsPerPage: 6,
  gridCols: 4,
  gridRows: 6,
  readingDirection: 'rtl',
  customRules: '各話1回、感情の頂点で縦長の大ゴマを使う。回想シーンはコマの枠線を波線風の演出にする想定でモノローグを厚めに。',
};

const storyTemplate = {
  name: '起承転結',
  pagesPerEpisode: 12,
  instructions:
    '基本は一話完結（その回の客と品物の未練を解決する）。ただし各話に必ず縦軸（祖母の失踪の謎）の手がかりを1つ配置し、最終コマは次話への引きで終えること。',
};

const projectResult = db.prepare(
  'INSERT INTO projects (title, synopsis, panel_rules, story_template) VALUES (?, ?, ?, ?)',
).run(SAMPLE_TITLE, synopsis, JSON.stringify(panelRules), JSON.stringify(storyTemplate));
const projectId = Number(projectResult.lastInsertRowid);
console.log(`[seed] 作品「${SAMPLE_TITLE}」を作成しました (id=${projectId})`);

// ---------- キャラクター（ペルソナ） ----------

const characters = [
  {
    name: '月森ひかり',
    role: '主人公',
    appearance:
      '16歳の女子高生。肩までの黒髪ボブに三日月形の銀のヘアピン。放課後は制服の上に祖母の深緑色のエプロンを着る。大きな琥珀色の瞳。小柄で華奢。',
    personality:
      'お節介で涙もろいが、芯は頑固。品物の記憶を視た後は必ず「…見ちゃった」と呟く癖がある。祖母を「ばあば」と呼び、失踪を信じておらず「長い買い付け旅行」と言い張っている。敬語が苦手。',
  },
  {
    name: 'クロ',
    role: '相棒・店の番人',
    appearance:
      '左耳が欠けた大きな黒猫。首輪に古い金色の鈴。月光の下でだけ、燕尾服姿の黒髪の青年（20代半ば・金色の瞳）に変化する。',
    personality:
      '慇懃無礼な毒舌家。ひかりを「小娘」と呼ぶが、危険からは体を張って守る。50年前から店にいるが、その理由と鈴の由来は決して語らない。マタタビ茶に目がない。',
  },
  {
    name: '灰田道彦',
    role: '常連客・協力者',
    appearance:
      '45歳の刑事。よれたトレンチコートに無精髭、常に胃薬を携帯。若い頃の傷が右眉を横切る。',
    personality:
      '遺失物や盗品の line で店に出入りするうち、ひかりの力に気づいた数少ない大人。表向きは「オカルトは信じない」と言いつつ、迷宮入り事件の遺品を持ち込む。祖母・静とは旧知の仲だが、それをひかりに隠している。',
  },
  {
    name: '月森静',
    role: '祖母・失踪中',
    appearance:
      '70歳。白髪を櫛でまとめ、若草色の着物に古い懐中時計を帯に挟んでいる。写真の中では常に微笑んでいる。',
    personality:
      '穏やかだが秘密主義。「品物は、持ち主より長生きした記憶の器」が口癖だった。失踪の一週間前、ひかりに店の合鍵と「抽斗は、時計が止まった夜に開けなさい」という言葉を残した。',
  },
  {
    name: '宵坂澪',
    role: 'ライバル・古物商',
    appearance:
      '18歳の女性古物商。白髪染めの銀髪ロングを紫のリボンで結ぶ。ゴシック調の黒いドレスと白手袋。常に骨董市で競り勝つ。',
    personality:
      '「未練は商品価値」と公言し、記憶の宿る品を高値で転売する現実主義者。ひかりを敵視する一方、彼女の力に強い興味を持つ。祖母・静に弟子入りを断られた過去がある。',
  },
];

const insertChar = db.prepare(
  'INSERT INTO characters (project_id, name, role, appearance, personality) VALUES (?, ?, ?, ?, ?)',
);
for (const c of characters) {
  insertChar.run(projectId, c.name, c.role, c.appearance, c.personality);
}
console.log(`[seed] キャラクター ${characters.length} 名を作成しました`);

// ---------- 世界観 ----------

db.prepare('INSERT INTO worldviews (project_id, name, description) VALUES (?, ?, ?)').run(
  projectId,
  '月光骨董店「つきのわ」',
  '商店街の外れ、夜9時から夜明けまでだけ扉が現れる骨董品店。強い未練が宿った品物は月光の下でかすかに光る。' +
    '品物の記憶は「視る」ことはできても「消す」ことはできず、未練は持ち主にまつわる誰かへ想いを届けることでしか解けない。' +
    '店の地下には祖母が「預かりもの」と呼んでいた、売り物ではない品々の保管室がある。',
);
console.log('[seed] 世界観を作成しました');

// ---------- 伏線（縦軸ミステリーの構造データ） ----------

const foreshadowings = [
  {
    title: '止まった懐中時計',
    description:
      '祖母が帯に挟んでいた懐中時計。失踪当夜の午前2時17分で止まっている。ひかりが触れても、なぜかこの品だけ記憶が視えない。',
    setup: 1, payoff: 8,
    chars: ['月森静', '月森ひかり'], items: ['懐中時計'],
  },
  {
    title: '開かずの抽斗',
    description:
      '店のレジ台にある鍵穴のない抽斗。祖母の言葉「時計が止まった夜に開けなさい」の意味は不明。中には半世紀前の写真が入っている。',
    setup: 1, payoff: 6,
    chars: ['月森静'], items: ['抽斗', '古い写真'],
  },
  {
    title: 'クロの金色の鈴',
    description:
      'クロの首輪の鈴は、50年前にこの店で「ある取引」の対価として付けられたもの。鈴が鳴るとクロは嘘をつけない。',
    setup: 2, payoff: 10,
    chars: ['クロ', '月森静'], items: ['金色の鈴'],
  },
  {
    title: '灰田と静の旧知の仲',
    description:
      '灰田は30年前、新米刑事の頃に静に救われた事件がある。彼が店に通うのは捜査のためだけではない。',
    setup: 3, payoff: 7,
    chars: ['灰田道彦', '月森静'], items: [],
  },
  {
    title: '宵坂澪の弟子入り拒否',
    description:
      '澪が静に弟子入りを断られたのは、澪の持つ「もう一つの力」が理由。澪自身もそれを知らない。',
    setup: 4, payoff: 11,
    chars: ['宵坂澪', '月森静'], items: [],
  },
];

const insertFs = db.prepare(
  `INSERT INTO foreshadowings
    (project_id, title, description, setup_episode, planned_payoff_episode, status, related_characters, related_items)
   VALUES (?, ?, ?, ?, ?, 'planned', ?, ?)`,
);
for (const f of foreshadowings) {
  insertFs.run(
    projectId, f.title, f.description, f.setup, f.payoff,
    JSON.stringify(f.chars), JSON.stringify(f.items),
  );
}
console.log(`[seed] 伏線 ${foreshadowings.length} 件を作成しました`);

// ---------- 画風 ----------

const styleResult = db.prepare(
  'INSERT INTO art_styles (project_id, name, model, style_prompt, extra_input) VALUES (?, ?, ?, ?, ?)',
).run(
  projectId,
  '夜の情緒モノクロ',
  'black-forest-labs/flux-schnell',
  'black and white manga style, detailed screentone shading, soft moonlight and deep shadows, nostalgic antique shop atmosphere, delicate ink lines',
  JSON.stringify({}),
);
db.prepare('UPDATE projects SET art_style_id = ? WHERE id = ?').run(
  Number(styleResult.lastInsertRowid), projectId,
);
console.log('[seed] 画風を作成し、作品に適用しました');

// ---------- ライブラリアセット（作品横断の再利用デモ用） ----------

db.prepare(
  'INSERT INTO characters (project_id, name, role, appearance, personality) VALUES (NULL, ?, ?, ?, ?)',
).run(
  '写楽帖アン',
  '万能サブキャラ（案内人）',
  '年齢不詳の小柄な少女。丸眼鏡に白いベレー帽、インク染みだらけの外套。大きなスケッチブックを常に抱えている。',
  'どの作品世界にも「記録係」として現れる観察者。口数は少ないが、核心を突く一言を残して去る。物語の解説役・幕間役として便利。',
);
db.prepare(
  'INSERT INTO art_styles (project_id, name, model, style_prompt, extra_input) VALUES (NULL, ?, ?, ?, ?)',
).run(
  '水彩カラー少女漫画風',
  'black-forest-labs/flux-schnell',
  'watercolor shoujo manga style, soft pastel colors, sparkling eyes, flower motifs in background, gentle line art',
  JSON.stringify({}),
);
db.prepare(
  'INSERT INTO worldviews (project_id, name, description) VALUES (NULL, ?, ?)',
).run(
  '雨の止まない港町アルストラ',
  '一年中霧雨が降り続く異国の港町。時計塔の鐘が鳴ると、住人は一つだけ嘘をつける。ミステリー・恋愛ものの舞台として流用可能。',
);
console.log('[seed] ライブラリアセット（キャラ1・画風1・世界観1）を作成しました');

console.log('\n[seed] 完了。ブラウザで作品「ムーンライト・アンティーク」を開き、「構成を生成」から始めてください。');
