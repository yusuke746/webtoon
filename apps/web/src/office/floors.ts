import type { Look } from './art/people';

/**
 * オフィスのフロア定義。
 *
 * マップは1文字=1タイル。記号は art/tiles.ts の TILES に対応する。
 *   '#' 奥の壁  '|' 左右の壁  'W' 窓  '_' 手前の壁  '.' 床  '~' 窓の光が落ちる床  ',' カーペット
 *   'D' 机(モニター)  'd' 机(書類)  'K' 受付  'B' 本棚  'A' 画材棚  'E' 製図台  'T' 会議テーブル
 *   'C' コルクボード  'P' 観葉植物  'F' キャビネット  'c' 椅子  'b' ホワイトボード
 *   'U' 上り階段  'V' 下り階段
 * NPC は床タイルの上に置く。話しかけると会話ウィンドウが開き、「部屋に入る」で route のページが開く。
 */

export interface Npc {
  id: string;
  name: string;
  /** 役職（会話ウィンドウの見出し） */
  title: string;
  x: number;
  y: number;
  look: Look;
  /** 「部屋に入る」で開くルート。{p} は projectId、{e} は直近の話IDに置換される */
  route: string;
  /** 部屋の呼び名（メニューの文言） */
  room: string;
  /** 一言（マップ上のヒント） */
  hint: string;
  /** 作品未選択でも使えるか */
  global?: boolean;
  /** このNPCが「作業中」になるジョブ種別 */
  jobKinds?: string[];
  /** 相談（LLM）に対応するか */
  canChat?: boolean;
  /** 作業中に座る場所（机の前）。未指定なら定位置のまま */
  desk?: { x: number; y: number; facing: 'up' | 'down' | 'left' | 'right' };
}

export interface Floor {
  id: string;
  label: string;
  map: string[];
  npcs: Npc[];
  stairs: Partial<Record<'U' | 'V', string>>;
  spawn: { x: number; y: number };
}

export const FLOORS: Floor[] = [
  {
    id: 'B1',
    label: 'B1 書庫',
    spawn: { x: 2, y: 7 },
    stairs: { U: '1F' },
    map: [
      '################',
      '|BBBBB.F..BBBBB|',
      '|..............|',
      '|..............|',
      '|...CC....dc...|',
      '|..............|',
      '|BBB.......BBBB|',
      '|U.........FF..|',
      '|..............|',
      '________________',
    ],
    npcs: [
      {
        id: 'manager', name: '連載マネージャー', title: '書庫番', x: 11, y: 3, room: '書庫',
        look: { hair: '#7a5a3a', cloth: '#6c7a4b', hairStyle: 'short', glasses: true },
        route: '/projects/{p}/archive', hint: 'これまでの話と設定を預かっています', jobKinds: ['archive'], canChat: true,
        desk: { x: 11, y: 4, facing: 'left' },
      },
      {
        id: 'foreshadow', name: '進行担当', title: '伏線ボード係', x: 4, y: 5, room: '伏線ボード',
        look: { hair: '#c04a4a', cloth: '#4a4a5a', hairStyle: 'ponytail' },
        route: '/projects/{p}/foreshadow', hint: '回収漏れの伏線を見張っています', canChat: true,
      },
      {
        id: 'assets', name: '倉庫番', title: 'アセット倉庫', x: 13, y: 8, room: 'アセット倉庫',
        look: { hair: '#3a3a3a', cloth: '#8a6a3a', hairStyle: 'beret', accent: '#4a6a3a' },
        route: '/assets', hint: '作品をまたいで使えるキャラ・画風・世界観', global: true,
      },
    ],
  },
  {
    id: '1F',
    label: '1F 編集部',
    spawn: { x: 8, y: 7 },
    stairs: { U: '2F', V: 'B1' },
    map: [
      '####WW####WW####',
      '|P..~~....~~..P|',
      '|KK.........Dc.|',
      '|..............|',
      '|..............|',
      '|...,,,,,,,,...|',
      '|...,,,,,,,,...|',
      '|U.........V...|',
      '|F.............|',
      '________________',
    ],
    npcs: [
      {
        id: 'reception', name: '受付', title: '受付', x: 2, y: 3, room: '作品一覧',
        look: { hair: '#5a3a2a', cloth: '#d64f6b', hairStyle: 'bob' },
        route: '/', hint: '担当作品の選択・新しい連載の立ち上げ', global: true,
      },
      {
        id: 'chief', name: '編集長', title: '編集長', x: 12, y: 3, room: 'ダッシュボード',
        look: { hair: '#5c5c66', cloth: '#2f2f3f', hairStyle: 'slick', glasses: true },
        route: '/projects/{p}', hint: '進行状況と次にやることを把握しています', jobKinds: ['apply_change'], canChat: true,
        desk: { x: 13, y: 2, facing: 'left' },
      },
    ],
  },
  {
    id: '2F',
    label: '2F 脚本室・資料室',
    spawn: { x: 2, y: 7 },
    stairs: { U: '3F', V: '1F' },
    map: [
      '####WW####WW####',
      '|dc.~~...BBBBBB|',
      '|..............|',
      '|..............|',
      '|dc......BBB.F.|',
      '|..............|',
      '|P.............|',
      '|U.........V..P|',
      '|..............|',
      '________________',
    ],
    npcs: [
      {
        id: 'writer', name: '脚本家', title: '脚本家', x: 2, y: 2, room: '制作フロー（構成・シーン）',
        look: { hair: '#2a2a3a', cloth: '#8a5a9a', hairStyle: 'long' },
        route: '/projects/{p}/episodes', hint: '話数構成とシーンの流れを書いています', jobKinds: ['structure'], canChat: true,
        desk: { x: 2, y: 1, facing: 'left' },
      },
      {
        id: 'chara', name: '設定担当', title: '資料室・人物設定', x: 11, y: 2, room: 'キャラクター資料',
        look: { hair: '#d6a64a', cloth: '#3f8f6f', hairStyle: 'bob' },
        route: '/projects/{p}/characters', hint: 'キャラの設定・参照画像・作画チェック', jobKinds: ['characters', 'ref_images', 'lora_train'], canChat: true,
        desk: { x: 13, y: 4, facing: 'up' },
      },
      {
        id: 'location', name: 'ロケハン担当', title: '資料室・背景', x: 11, y: 5, room: '背景・ロケーション',
        look: { hair: '#4a7a4a', cloth: '#c08a3a', hairStyle: 'short' },
        route: '/projects/{p}/backgrounds', hint: '場所の拾い出し・背景の設定画', canChat: true, jobKinds: ['design_background', 'locations'],
        desk: { x: 13, y: 5, facing: 'right' },
      },
    ],
  },
  {
    id: '3F',
    label: '3F 作画室',
    spawn: { x: 2, y: 7 },
    stairs: { U: '4F', V: '2F' },
    map: [
      '####WW####WW####',
      '|AAA~~...~~EEc.|',
      '|..............|',
      '|..............|',
      '|...Ec.........|',
      '|..............|',
      '|AA.........P..|',
      '|U.........V...|',
      '|..............|',
      '________________',
    ],
    npcs: [
      {
        id: 'artist', name: '漫画家', title: '漫画家', x: 12, y: 2, room: 'ネーム・作画',
        look: { hair: '#1f1f2a', cloth: '#f4f1ea', hairStyle: 'beret', accent: '#4f6fd6' },
        route: '/projects/{p}/episodes/{e}/panels', hint: 'ネームと作画。話を決めてから声をかけてください', jobKinds: ['panels', 'episode_images'], canChat: true,
        desk: { x: 13, y: 1, facing: 'left' },
      },
      {
        id: 'designer', name: '画材担当', title: '画風・カスタマイズ', x: 2, y: 2, room: '画風・カスタマイズ',
        look: { hair: '#a04a8a', cloth: '#f0c050', hairStyle: 'ponytail' },
        route: '/projects/{p}/settings', hint: '画風・コマ割りルール・構成テンプレート', canChat: true,
      },
    ],
  },
  {
    id: '4F',
    label: '4F 会議室',
    spawn: { x: 2, y: 7 },
    stairs: { V: '3F' },
    map: [
      '####WW####WW####',
      '|P..~~.b..~~..P|',
      '|....,,,,,,....|',
      '|....,TTTT,....|',
      '|....,TTTT,....|',
      '|....,,,,,,....|',
      '|..............|',
      '|..........V...|',
      '|..............|',
      '________________',
    ],
    npcs: [
      {
        id: 'meeting', name: '司会', title: 'AI編集会議', x: 7, y: 6, room: 'AI編集会議',
        look: { hair: '#3a5a8a', cloth: '#2f2f3f', hairStyle: 'short', accent: '#d64545' },
        route: '/projects/{p}/discussions', hint: '編集者・プロット担当・読者代表が議論します', jobKinds: ['discussion'], canChat: true,
      },
    ],
  },
];

export const FLOOR_BY_ID = Object.fromEntries(FLOORS.map((f) => [f.id, f])) as Record<string, Floor>;

/** タイルが歩けるか */
export function walkable(ch: string): boolean {
  return ch === '.' || ch === ',' || ch === '~' || ch === 'U' || ch === 'V';
}

/** 現在のURLから「どのNPCの部屋か」を求める */
export function npcForPath(pathname: string): { floor: Floor; npc: Npc } | null {
  const rules: [RegExp, string][] = [
    [/^\/$/, 'reception'],
    [/^\/assets/, 'assets'],
    [/^\/projects\/\d+\/archive/, 'manager'],
    [/^\/projects\/\d+\/foreshadow/, 'foreshadow'],
    [/^\/projects\/\d+\/characters/, 'chara'],
    [/^\/projects\/\d+\/backgrounds/, 'location'],
    [/^\/projects\/\d+\/settings/, 'designer'],
    [/^\/projects\/\d+\/discussions/, 'meeting'],
    [/^\/projects\/\d+\/episodes\/\d+\/(panels|art)/, 'artist'],
    [/^\/projects\/\d+\/episodes/, 'writer'],
    [/^\/projects\/\d+\/?$/, 'chief'],
  ];
  for (const [re, id] of rules) {
    if (re.test(pathname)) {
      for (const floor of FLOORS) {
        const npc = floor.npcs.find((n) => n.id === id);
        if (npc) return { floor, npc };
      }
    }
  }
  return null;
}
