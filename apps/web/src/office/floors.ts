import type { Sprite } from './sprites';
import { person } from './sprites';

/**
 * オフィスのフロア定義。
 *
 * マップは1文字=1タイル。記号は sprites.ts の TILES に対応する。
 *   '#' 壁  'W' 窓  '.' 床  ',' カーペット  'D' 机  'K' 受付  'B' 本棚  'A' 画材棚
 *   'T' 会議テーブル  'C' コルクボード  'P' 観葉植物  'U' 上り階段  'V' 下り階段
 * NPC は床タイルの上に置く。話しかけると route のページがダイアログで開く。
 */

export interface Npc {
  id: string;
  name: string;
  /** 役職（吹き出しの見出し） */
  title: string;
  x: number;
  y: number;
  sprite: Sprite;
  /** 話しかけたときに開くルート。{p} は projectId に置換される */
  route: string;
  /** 一言（マップ上のヒント） */
  hint: string;
  /** 作品未選択でも使えるか */
  global?: boolean;
  /** このNPCが「作業中」になるジョブ種別 */
  jobKinds?: string[];
}

export interface Floor {
  id: string;
  /** 階の表示名（例: 1F 編集部） */
  label: string;
  map: string[];
  npcs: Npc[];
  /** 階段の行き先: タイル記号 → フロアID */
  stairs: Partial<Record<'U' | 'V', string>>;
  /** 階段から来たときの立ち位置 */
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
      '#BBBBB....BBBBB#',
      '#..............#',
      '#..............#',
      '#...CC.........#',
      '#..............#',
      '#BBB.......BBBB#',
      '#U.............#',
      '#..............#',
      '################',
    ],
    npcs: [
      {
        id: 'manager', name: '連載マネージャー', title: '書庫番', x: 11, y: 3,
        sprite: person('#7a5a3a', '#6c7a4b', { glasses: true }),
        route: '/projects/{p}/archive', hint: 'これまでの話と設定を預かっています', jobKinds: ['archive'],
      },
      {
        id: 'foreshadow', name: '伏線ボード', title: '進行担当', x: 4, y: 5,
        sprite: person('#c04a4a', '#4a4a5a'),
        route: '/projects/{p}/foreshadow', hint: '回収漏れの伏線を見張っています',
      },
      {
        id: 'assets', name: 'アセット倉庫', title: '倉庫番', x: 13, y: 7,
        sprite: person('#3a3a3a', '#8a6a3a'),
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
      '#P............P#',
      '#KK.........DD.#',
      '#..............#',
      '#..............#',
      '#...,,,,,,,,...#',
      '#...,,,,,,,,...#',
      '#U.........V...#',
      '#..............#',
      '################',
    ],
    npcs: [
      {
        id: 'reception', name: '受付', title: '受付', x: 2, y: 3,
        sprite: person('#5a3a2a', '#d64f6b', { accessory: '#ffffff' }),
        route: '/', hint: '担当作品の選択・新しい連載の立ち上げ', global: true,
      },
      {
        id: 'chief', name: '編集長', title: '編集長', x: 12, y: 3,
        sprite: person('#5c5c66', '#2f2f3f', { glasses: true }),
        route: '/projects/{p}', hint: '進行状況と次にやることを把握しています', jobKinds: ['apply_change'],
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
      '#DD......BBBBBB#',
      '#..............#',
      '#..............#',
      '#DD......BBB...#',
      '#..............#',
      '#P.............#',
      '#U.........V..P#',
      '#..............#',
      '################',
    ],
    npcs: [
      {
        id: 'writer', name: '脚本家', title: '脚本家', x: 2, y: 2,
        sprite: person('#2a2a3a', '#8a5a9a'),
        route: '/projects/{p}/episodes', hint: '話数構成とシーンの流れを書いています', jobKinds: ['structure'],
      },
      {
        id: 'chara', name: '設定担当', title: '資料室・人物設定', x: 11, y: 2,
        sprite: person('#d6a64a', '#3f8f6f'),
        route: '/projects/{p}/characters', hint: 'キャラの設定・参照画像・LoRA', jobKinds: ['characters', 'ref_images', 'lora_train'],
      },
      {
        id: 'location', name: 'ロケハン担当', title: '資料室・背景', x: 11, y: 5,
        sprite: person('#4a7a4a', '#c08a3a'),
        route: '/projects/{p}/backgrounds', hint: '同じ場所を同じ絵で描くための基準',
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
      '#AAA.......DDD.#',
      '#..............#',
      '#..............#',
      '#...DD.........#',
      '#..............#',
      '#AA..........P.#',
      '#U.........V...#',
      '#..............#',
      '################',
    ],
    npcs: [
      {
        id: 'artist', name: '漫画家', title: '漫画家', x: 12, y: 2,
        sprite: person('#1f1f2a', '#ffffff', { accessory: '#4f6fd6' }),
        route: '/projects/{p}/episodes/{e}/panels', hint: 'ネームと作画。話を決めてから声をかけてください', jobKinds: ['panels', 'episode_images'],
      },
      {
        id: 'designer', name: '画材担当', title: '画風・カスタマイズ', x: 2, y: 2,
        sprite: person('#a04a8a', '#f0c050'),
        route: '/projects/{p}/settings', hint: '画風・コマ割りルール・構成テンプレート',
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
      '#P............P#',
      '#....,,,,,,....#',
      '#....,TTTT,....#',
      '#....,TTTT,....#',
      '#....,,,,,,....#',
      '#..............#',
      '#..........V...#',
      '#..............#',
      '################',
    ],
    npcs: [
      {
        id: 'meeting', name: 'AI編集会議', title: '司会', x: 7, y: 6,
        sprite: person('#3a5a8a', '#2f2f3f', { accessory: '#d64545' }),
        route: '/projects/{p}/discussions', hint: '編集者・プロット担当・読者代表が議論します', jobKinds: ['discussion'],
      },
    ],
  },
];

export const FLOOR_BY_ID = Object.fromEntries(FLOORS.map((f) => [f.id, f])) as Record<string, Floor>;

/** タイルが歩けるか */
export function walkable(ch: string): boolean {
  return ch === '.' || ch === ',' || ch === 'U' || ch === 'V';
}

/**
 * 現在のURLから「話しかけているNPC」を求める。
 * ダイアログの見出しと、どの階を表示するかに使う。
 */
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
