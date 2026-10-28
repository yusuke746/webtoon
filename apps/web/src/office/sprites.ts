/**
 * ドット絵スプライトの定義と描画。
 *
 * スプライトは「1文字=1ピクセル」の文字列配列で定義し、パレットで色に変換する。
 * 描画は一度だけ Canvas に展開して data URL にし、CSS 背景として使う（タイル数が多くても軽い）。
 */

export type Sprite = { rows: string[]; palette: Record<string, string> };

export const TILE = 16;
export const SCALE = 3;

const cache = new Map<string, string>();

/** スプライトを PNG data URL に変換する（キャッシュ付き） */
export function spriteUrl(sprite: Sprite, key: string): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const h = sprite.rows.length;
  const w = Math.max(...sprite.rows.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    const row = sprite.rows[y];
    for (let x = 0; x < row.length; x++) {
      const color = sprite.palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

// ---------- 共通パレット ----------

const P = {
  o: '#1f1a24', // 輪郭
  w: '#ffffff',
  f1: '#d9c3a0', // 床 明
  f2: '#cdb48f', // 床 暗
  wl: '#6b5a7a', // 壁
  wd: '#4c4058', // 壁 影
  wb: '#8d7aa0', // 壁 上端
  br: '#8a5a3a', // 木 濃
  bl: '#b67a4e', // 木 明
  pp: '#f4efe4', // 紙
  gr: '#4f9d5b', // 植物
  gd: '#2f6d3b',
  pt: '#b2543c', // 植木鉢
  st: '#a7a2b0', // 階段 明
  sd: '#716b7a', // 階段 暗
  ck: '#c9a467', // コルクボード
  r: '#d64545', g: '#3f9d6b', b: '#3f6fd6', y: '#e6b84a', // 本・ピン
  cp: '#5b7bd6', // カーペット
  cd: '#4a66b8',
  gl: '#bfe3f2', // 窓
  gs: '#8cc5df',
  mt: '#d0d4de', // 金属
};

const rep = (s: string, n: number) => Array.from({ length: n }, () => s);

// ---------- タイル ----------

export const TILES: Record<string, Sprite> = {
  // 床（木目）
  '.': {
    palette: P,
    rows: [
      ...rep('aaaaaaaaaaaaaaaa', 3), 'bbbbbbbbbbbbbbbb', ...rep('aaaaaaaabaaaaaaa', 3), 'bbbbbbbbbbbbbbbb',
      ...rep('aaaabaaaaaaaaaaa', 3), 'bbbbbbbbbbbbbbbb', ...rep('aaaaaaaaaaaabaaa', 3), 'bbbbbbbbbbbbbbbb',
    ].map((r) => r.replace(/a/g, '1').replace(/b/g, '2')),
  },
  // 壁
  '#': {
    palette: P,
    rows: [
      'bbbbbbbbbbbbbbbb', 'bbbbbbbbbbbbbbbb', 'wwwwwwwwwwwwwwww', 'wwwwwwwdwwwwwwww', 'wwwwwwwdwwwwwwww',
      'dddddddddddddddd', 'wwwdwwwwwwwwwdww', 'wwwdwwwwwwwwwdww', 'dddddddddddddddd', 'wwwwwwwdwwwwwwww',
      'wwwwwwwdwwwwwwww', 'dddddddddddddddd', 'wwwdwwwwwwwwwdww', 'wwwdwwwwwwwwwdww', 'dddddddddddddddd', 'oooooooooooooooo',
    ].map((r) => r.replace(/b/g, 'B').replace(/w/g, 'W').replace(/d/g, 'D')),
  },
  // 窓付きの壁
  'W': {
    palette: P,
    rows: [
      'BBBBBBBBBBBBBBBB', 'BBBBBBBBBBBBBBBB', 'WWWooooooooooWWW', 'WWWoGGGGSGGGGoWW', 'WWWoGGGGSGGGGoWW',
      'WWWoGGGGSGGGGoWW', 'WWWoSSSSSSSSSoWW', 'WWWoGGGGSGGGGoWW', 'WWWoGGGGSGGGGoWW', 'WWWoGGGGSGGGGoWW',
      'WWWooooooooooWWW', 'DDDDDDDDDDDDDDDD', 'WWWDWWWWWWWWWDWW', 'WWWDWWWWWWWWWDWW', 'DDDDDDDDDDDDDDDD', 'oooooooooooooooo',
    ],
  },
  // 机（書類あり）
  'D': {
    palette: P,
    rows: [
      '1111111111111111', '1111111111111111', 'oooooooooooooooo', 'oLLLLLLLLLLLLLLo', 'oLLppppLLLLLLLLo',
      'oLLpoopLLLmmmLLo', 'oLLppppLLLmmmLLo', 'oLLLLLLLLLLLLLLo', 'oKKKKKKKKKKKKKKo', 'oooooooooooooooo',
      '1oKK1111111111Ko', '1oKK1111111111Ko', '1oKK1111111111Ko', '1oKK1111111111Ko', '1111111111111111', '1111111111111111',
    ],
  },
  // 受付カウンター
  'K': {
    palette: P,
    rows: [
      '1111111111111111', 'oooooooooooooooo', 'oLLLLLLLLLLLLLLo', 'oLLLLLLLLLLLLLLo', 'oooooooooooooooo',
      'oKKKKKKKKKKKKKKo', 'oKKKKKKKKKKKKKKo', 'oKKKyyyyyyyyKKKo', 'oKKKyyyyyyyyKKKo', 'oKKKKKKKKKKKKKKo',
      'oKKKKKKKKKKKKKKo', 'oKKKKKKKKKKKKKKo', 'oooooooooooooooo', '1111111111111111', '1111111111111111', '1111111111111111',
    ],
  },
  // 本棚
  'B': {
    palette: P,
    rows: [
      'oooooooooooooooo', 'oKKKKKKKKKKKKKKo', 'oKrrbbyyggrrbbKo', 'oKrrbbyyggrrbbKo', 'oKrrbbyyggrrbbKo',
      'oKKKKKKKKKKKKKKo', 'oKggrryybbggrrKo', 'oKggrryybbggrrKo', 'oKggrryybbggrrKo', 'oKKKKKKKKKKKKKKo',
      'oKbbyyrrggbbyyKo', 'oKbbyyrrggbbyyKo', 'oKbbyyrrggbbyyKo', 'oKKKKKKKKKKKKKKo', 'oooooooooooooooo', '1111111111111111',
    ],
  },
  // 階段（上り）
  'U': {
    palette: P,
    rows: [
      'oooooooooooooooo', 'oSSSSSSSSSSSSSSo', 'oTTTTTTTTTTTTTTo', 'oooooooooooooooo', 'oSSSSSSSSSSSSSSo',
      'oTTTTTTTTTTTTTTo', 'oooooooooooooooo', 'oSSSSSSSSSSSSSSo', 'oTTTTTTTTTTTTTTo', 'oooooooooooooooo',
      'oSSSSSSSSSSSSSSo', 'oTTTTTTTTTTTTTTo', 'oooooooooooooooo', 'oSSSSSSSSSSSSSSo', 'oTTTTTTTTTTTTTTo', 'oooooooooooooooo',
    ],
  },
  // 階段（下り）
  'V': {
    palette: P,
    rows: [
      'oooooooooooooooo', 'oTTTTTTTTTTTTTTo', 'oSSSSSSSSSSSSSSo', 'oooooooooooooooo', 'oTTTTTTTTTTTTTTo',
      'oSSSSSSSSSSSSSSo', 'oooooooooooooooo', 'oTTTTTTTTTTTTTTo', 'oSSSSSSSSSSSSSSo', 'oooooooooooooooo',
      'oTTTTTTTTTTTTTTo', 'oSSSSSSSSSSSSSSo', 'oooooooooooooooo', 'oTTTTTTTTTTTTTTo', 'oSSSSSSSSSSSSSSo', 'oooooooooooooooo',
    ],
  },
  // 観葉植物
  'P': {
    palette: P,
    rows: [
      '1111111111111111', '111111ogo1111111', '11111oggggo11111', '1111ogggggggo111', '111oggGgggGggo11',
      '111ogGgggggGgo11', '1111oggggggo1111', '11111ooggoo11111', '1111111oo1111111', '111111oooo111111',
      '11111oQQQQo11111', '11111oQQQQo11111', '111111oQQo111111', '111111oooo111111', '1111111111111111', '1111111111111111',
    ],
  },
  // コルクボード（伏線ボード）
  'C': {
    palette: P,
    rows: [
      'oooooooooooooooo', 'oCCCCCCCCCCCCCCo', 'oCrCCppppCCCbCCo', 'oCCCCppppCCCCCCo', 'oCCCCppppCCppCCo',
      'oCCppCCCCCCppCCo', 'oCCppCCgCCCCCCCo', 'oCCppCCCCppppCCo', 'oCCCCCyCCppppCCo', 'oCCCCCCCCppppCCo',
      'oCrCCppppCCCCCCo', 'oCCCCppppCCCbCCo', 'oCCCCCCCCCCCCCCo', 'oooooooooooooooo', '1111111111111111', '1111111111111111',
    ],
  },
  // 会議テーブル
  'T': {
    palette: P,
    rows: [
      '1111111111111111', 'oooooooooooooooo', 'oLLLLLLLLLLLLLLo', 'oLLLLppppLLLLLLo', 'oLLLLppppLLLLLLo',
      'oLLLLLLLLLLLLLLo', 'oLLLLLLLLLLppLLo', 'oLLLLLLLLLLppLLo', 'oLLLLLLLLLLLLLLo', 'oooooooooooooooo',
      '1oKo11111111oKo1', '1oKo11111111oKo1', '1111111111111111', '1111111111111111', '1111111111111111', '1111111111111111',
    ],
  },
  // カーペット（会議室・入口）
  ',': {
    palette: P,
    rows: [...rep('cccccccccccccccc', 16)].map((r, i) => (i % 4 === 0 ? 'cdcccdcccdcccdcc' : r)),
  },
  // 画材棚（作画室）
  'A': {
    palette: P,
    rows: [
      'oooooooooooooooo', 'oKKKKKKKKKKKKKKo', 'oKmmmKrrKbbKyyKo', 'oKmmmKrrKbbKyyKo', 'oKKKKKKKKKKKKKKo',
      'oKppppppppppppKo', 'oKppppppppppppKo', 'oKKKKKKKKKKKKKKo', 'oKggKKmmmKKrrKKo', 'oKggKKmmmKKrrKKo',
      'oKKKKKKKKKKKKKKo', 'oKKKKKKKKKKKKKKo', 'oooooooooooooooo', '1111111111111111', '1111111111111111', '1111111111111111',
    ],
  },
};

// 共有パレットに記号を足す（タイル定義で使っている文字）
Object.assign(P, {
  '1': P.f1, '2': P.f2, B: P.wb, W: P.wl, D: P.wd, L: P.bl, K: P.br, p: P.pp, m: P.mt,
  G: P.gd, Q: P.pt, S: P.st, T: P.sd, C: P.ck, c: P.cp, d: P.cd, y: P.y,
});

// ---------- 人物 ----------

/** 12x16 の人物スプライト。髪・服・肌の色で描き分ける */
export function person(hair: string, cloth: string, opts: { skin?: string; accessory?: string; glasses?: boolean } = {}): Sprite {
  const skin = opts.skin ?? '#f2cfae';
  const acc = opts.accessory ?? cloth;
  const rows = [
    '....oooo....',
    '...ohhhho...',
    '..ohhhhhho..',
    '..ohhhhhho..',
    '..ohssssho..',
    opts.glasses ? '..oGeGGeGo..' : '..osesseso..',
    '..ossssso...',
    '...osssso...',
    '....oooo....',
    '..occccco...',
    '.ocaccccaco.',
    '.ocaccccaco.',
    '..ocxxxxco..',
    '...oxxxxo...',
    '...ox..xo...',
    '...oo..oo...',
  ];
  return {
    rows,
    palette: { o: '#1f1a24', h: hair, s: skin, e: '#1f1a24', c: cloth, a: acc, x: '#3b3550', G: '#3b3550' },
  };
}

export const PLAYER: Sprite = person('#2b2b3a', '#4f6fd6', { accessory: '#e9eef9' });
