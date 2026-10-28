/**
 * 人物スプライト（16×24）。スーファミ RPG 風に、3方向（下・横・上。左向きは横を反転）× 3フレーム（立ち・歩き2）。
 *
 * 記号:
 *   o 輪郭   s/S 肌/肌の影   e 目   w 目のハイライト
 *   h/H 髪/髪の影   c/C/L 服/服の影/服のハイライト   p/P ズボン/影   x 靴   G 眼鏡
 * 髪型・眼鏡は «重ね描き» で、'.' 以外の文字だけ上書きする。
 */

export type Dir = 'down' | 'side' | 'up';
export type Frame = 0 | 1 | 2;

const HEAD_DOWN = [
  '....oooooooo....',
  '...ohhhhhhhho...',
  '..ohhhhhhhhhhho.',
  '..ohhhhhhhhhhho.',
  '..ohhhhhhhhhhho.',
  '..ohhHssssssHho.',
  '..oHsssssssssHo.',
  '..osseessseesso.',
  '..ossewsssewsso.',
  '..oSssssssssSSo.',
  '...oSsssssssSo..',
  '....oooSSooo....',
];
const BODY_DOWN = [
  '...oLcccccccLo..',
  '..ocLcccccccLco.',
  '..ocCccccccccCo.',
  '..oSCcccccccCSo.',
  '...oCCcccccCCo..',
  '...oppppppppo...',
  '...oppppppppo...',
];
const LEGS_DOWN: Record<Frame, string[]> = {
  0: ['...opppoopppo...', '...oPppo.oppPo..', '...oPppo.oppPo..', '...oxxxo.oxxxo..', '...ooooo.ooooo..'],
  1: ['...opppoopppo...', '...oPppo.oppPo..', '...oxxxo.oppPo..', '...ooooo.oxxxo..', '.........ooooo..'],
  2: ['...opppoopppo...', '...oPppo.oppPo..', '...oPppo.oxxxo..', '...oxxxo.ooooo..', '...ooooo........'],
};

const HEAD_SIDE = [
  '.....oooooooo...',
  '....ohhhhhhhho..',
  '...ohhhhhhhhhho.',
  '...ohhhhhhhhhho.',
  '...ohhhhhhhhhho.',
  '...ohhhHHsssSSo.',
  '...ohhhHsssssso.',
  '...ohhHssseesso.',
  '...ohhHsssewsso.',
  '...oShSsssssSo..',
  '....oSSssssSo...',
  '.....ooSSooo....',
];
const BODY_SIDE = [
  '.....oLcccco....',
  '....ocLccccco...',
  '....oCcccccco...',
  '....oCScccccо...'.replace('о', 'o'),
  '.....oCcccCo....',
  '.....oppppppo...',
  '.....oppppppo...',
];
const LEGS_SIDE: Record<Frame, string[]> = {
  0: ['.....oppppppo...', '.....oPpppPpo...', '.....oPpppPpo...', '.....oxxxxxxo...', '.....oooooooo...'],
  1: ['....opppopppo...', '....oPpo..oPpo..', '...oPpo....oPpo.', '...oxxo....oxxo.', '...oooo....oooo.'],
  2: ['.....oppppppo...', '.....oPppPpo....', '....oPppoPpo....', '....oxxxoxxo....', '....oooooooo....'],
};

const HEAD_UP = [
  '....oooooooo....',
  '...ohhhhhhhho...',
  '..ohhhhhhhhhhho.',
  '..ohhhhhhhhhhho.',
  '..ohhhhhhhhhhho.',
  '..ohhhhhhhhhhho.',
  '..ohhhhhhhhhhho.',
  '..ohhhhhhhhhhho.',
  '..oHhhhhhhhhhHo.',
  '..oHHhhhhhhhHHo.',
  '...oHHHhhhhHHo..',
  '....oooSSooo....',
];
const BODY_UP = [
  '...oCcccccccCo..',
  '..ocCcccccccCco.',
  '..ocCccccccccCo.',
  '..oSCcccccccCSo.',
  '...oCCcccccCCo..',
  '...oPppppppPo...',
  '...oPppppppPo...',
];

export const BODY: Record<Dir, Record<Frame, string[]>> = {
  down: { 0: [...HEAD_DOWN, ...BODY_DOWN, ...LEGS_DOWN[0]], 1: [...HEAD_DOWN, ...BODY_DOWN, ...LEGS_DOWN[1]], 2: [...HEAD_DOWN, ...BODY_DOWN, ...LEGS_DOWN[2]] },
  side: { 0: [...HEAD_SIDE, ...BODY_SIDE, ...LEGS_SIDE[0]], 1: [...HEAD_SIDE, ...BODY_SIDE, ...LEGS_SIDE[1]], 2: [...HEAD_SIDE, ...BODY_SIDE, ...LEGS_SIDE[2]] },
  up: { 0: [...HEAD_UP, ...BODY_UP, ...LEGS_DOWN[0]], 1: [...HEAD_UP, ...BODY_UP, ...LEGS_DOWN[1]], 2: [...HEAD_UP, ...BODY_UP, ...LEGS_DOWN[2]] },
};

/** 髪型の重ね描き（行番号 → 文字列。'.' は透過） */
export type Overlay = Partial<Record<Dir, Record<number, string>>>;

export const HAIR: Record<string, Overlay> = {
  /** 短髪（テンプレートのまま。前髪にハイライト） */
  short: {
    down: { 2: '...hLhhhhhhhh...'.replace(/L/g, 'l'), 5: '..ohhhHssssHhho.' },
    side: { 2: '....hlhhhhhhh...' },
    up: { 2: '...hhhhhlhhhh...' },
  },
  /** ボブ（顎の高さまで） */
  bob: {
    down: {
      5: '..ohhhHssssHhho.', 6: '.ohhHsssssssHhho', 7: '.ohhsseessseesho'.replace('sseessseesh', 'sseessseesh'),
      8: '.ohhssewsssewsho', 9: '.ohhSssssssssSho', 10: '.oHHoSsssssssSoH'.replace('H', 'H'), 11: '..oo.oooSSooo.oo',
    },
    side: { 6: '...ohhhhHsssso..', 7: '...ohhhhHsseesso'.slice(0, 16), 8: '...ohhhhHssewsso'.slice(0, 16), 9: '...ohhhHSsssssSo', 10: '...oHHhoSssssSo.', 11: '....oo.ooSSooo..' },
    up: { 11: '..oHHHhhhhhhHHo.', 12: '...oHHhhhhhhHo..', 13: '....ooooooooo...' },
  },
  /** ロング（肩より下まで） */
  long: {
    down: {
      5: '..ohhhHssssHhho.', 6: '.ohhHsssssssHhho', 7: '.ohhsseessseesho', 8: '.ohhssewsssewsho',
      9: '.ohhSssssssssSho', 10: '.ohhoSsssssssSoh', 11: '.ohh.oooSSooo.hh', 12: '.ohhoLcccccccLho',
      13: '.ohHcLcccccccLHo', 14: '.oHH.........HHo', 15: '..oo.........oo.',
    },
    side: {
      6: '...ohhhhHsssso..', 7: '...ohhhhHsseesso'.slice(0, 16), 8: '...ohhhhHssewsso'.slice(0, 16), 9: '...ohhhhSsssssSo',
      10: '...ohhhhoSsssSo.', 11: '...ohhhh.ooSooo.', 12: '...ohhhhoLcccco.', 13: '...oHhhHcLcccco.', 14: '...oHHHo........', 15: '....ooo.........',
    },
    up: { 11: '..oHhhhhhhhhhHo.', 12: '..oHhhhhhhhhhHo.', 13: '..oHHhhhhhhhHHo.', 14: '...oHHhhhhhHHo..', 15: '....oHHHHHHHo...', 16: '.....ooooooo....' },
  },
  /** ポニーテール（後ろに束） */
  ponytail: {
    down: { 1: '...ohhhhhhhho...', 5: '..ohhhHssssHhho.' },
    side: { 3: '..oohhhhhhhhhho.', 4: '.ohhhhhhhhhhhho.', 5: '.ohhhhhhHHsssSo.', 6: '.oHhhhhhHsssss o'.replace(' ', 's'), 7: '.oHhhhhHssseesso'.slice(0, 16), 8: '..oHhhHsssewsso.', 9: '..oHHhSsssssSo..', 10: '...ooSSssssSo...' },
    up: { 8: '..oHhhhhhhhhhHo.', 9: '..oHHhhhhhhhHHo.', 10: '...oHHHhhhhHHo..', 11: '....ooohhhooo...', 12: '...oCccohhoccCo.', 13: '..ocCccohhoccCo.', 14: '..ocCccoHHocCCo.', 15: '..oSCccoHHoccSo.', 16: '...oCCcoooccCo..' },
  },
  /** オールバック（編集長） */
  slick: {
    down: { 1: '...ohhhhhhhho...', 4: '..ohhhhhhhhhhho.', 5: '..ohHHssssssHHo.', 6: '..oHssssssssssHo'.slice(0, 16) },
    side: { 5: '...ohhhhHHsssSo.', 6: '...ohhhhHssssso.' },
    up: {},
  },
  /** 帽子（ベレー） */
  beret: {
    down: { 0: '....aaaaaaaa....', 1: '..aaaaaaaaaaaa..', 2: '.oaaaaaaaaaaaao.', 3: '..oaaaaaaaaaao..', 4: '..ohhhhhhhhhhho.' },
    side: { 0: '.....aaaaaaaa...', 1: '...aaaaaaaaaaaa.', 2: '..oaaaaaaaaaaaao'.slice(0, 16), 3: '...oaaaaaaaaaao.', 4: '...ohhhhhhhhhho.' },
    up: { 0: '....aaaaaaaa....', 1: '..aaaaaaaaaaaa..', 2: '.oaaaaaaaaaaaao.', 3: '..oaaaaaaaaaao..', 4: '..ohhhhhhhhhhho.' },
  },
};

export const GLASSES: Overlay = {
  down: { 7: '...GGeeGGeeGG...', 8: '....GewGGewG....' },
  side: { 7: '........GGeeGG..', 8: '.........GewG...' },
};

/** テンプレートに重ね描きを適用する */
export function compose(base: string[], overlays: (Record<number, string> | undefined)[]): string[] {
  const rows = base.map((r) => r.split(''));
  for (const ov of overlays) {
    if (!ov) continue;
    for (const [y, line] of Object.entries(ov)) {
      const yy = Number(y);
      if (!rows[yy]) continue;
      for (let x = 0; x < line.length && x < 16; x++) {
        if (line[x] !== '.') rows[yy][x] = line[x];
      }
    }
  }
  return rows.map((r) => r.join(''));
}

export interface Look {
  hair: string;
  hairStyle?: keyof typeof HAIR;
  cloth: string;
  pants?: string;
  skin?: string;
  glasses?: boolean;
  /** 帽子やアクセントの色（beret など） */
  accent?: string;
}

/** 色を暗く/明るくする（影・ハイライト用） */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(k < 1 ? v * k : v + (255 - v) * (k - 1))));
  return `#${[f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

export function personPalette(look: Look): Record<string, string> {
  const skin = look.skin ?? '#f6cfa8';
  const pants = look.pants ?? shade(look.cloth, 0.55);
  return {
    o: '#3b2a3a', e: '#2b1f2e', w: '#ffffff',
    s: skin, S: shade(skin, 0.82),
    h: look.hair, H: shade(look.hair, 0.72), l: shade(look.hair, 1.35),
    c: look.cloth, C: shade(look.cloth, 0.72), L: shade(look.cloth, 1.3),
    p: pants, P: shade(pants, 0.72), x: '#3a2a2a', G: '#2b1f2e', a: look.accent ?? '#c9402f',
  };
}

export function personRows(look: Look, dir: Dir, frame: Frame): string[] {
  const hair = HAIR[look.hairStyle ?? 'short'];
  return compose(BODY[dir][frame], [hair?.[dir], look.glasses ? GLASSES[dir] : undefined]);
}
