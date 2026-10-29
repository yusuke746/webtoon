import type { Look } from './art/people';
import { actorUrl, type Facing, type Frame } from './sprites';

/**
 * 人物のドット絵を AI で描き直すための下絵（スプライトシート）と、描き直した絵の切り出し。
 *
 * 下絵: 3 行 × 3 列。行は 正面 / 横（右向き）/ 後ろ、列は 立ち / 歩き 1 / 歩き 2。各セルは同じ大きさで、背景はマゼンタ一色。
 * 描き直した絵: 同じ 3×3 で返ってくる前提で等分し、マゼンタを透過して向き・コマごとの画像にする。
 */

export const SHEET_DIRS: ('down' | 'side' | 'up')[] = ['down', 'side', 'up'];
export const SHEET_FRAMES: Frame[] = [0, 1, 2];
/** 下絵のセル（16×24 を 8 倍 + 余白） */
const CELL_SCALE = 8;
const CELL_PAD = 8;
export const CELL_W = 16 * CELL_SCALE + CELL_PAD * 2; // 144
export const CELL_H = 24 * CELL_SCALE + CELL_PAD * 2; // 208
export const CHROMA = { r: 255, g: 0, b: 255 };

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('画像を読み込めませんでした'));
    img.src = url;
  });
}

const FACING_OF: Record<'down' | 'side' | 'up', Facing> = { down: 'down', side: 'right', up: 'up' };

/** いまのドット絵からスプライトシートの下絵を描く（data URL） */
export async function renderSpriteSheet(look: Look): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_W * 3;
  canvas.height = CELL_H * 3;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = `rgb(${CHROMA.r},${CHROMA.g},${CHROMA.b})`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      const img = await loadImage(actorUrl(look, FACING_OF[SHEET_DIRS[row]], SHEET_FRAMES[col]));
      ctx.drawImage(img, col * CELL_W + CELL_PAD, row * CELL_H + CELL_PAD, 16 * CELL_SCALE, 24 * CELL_SCALE);
    }
  }
  return canvas.toDataURL('image/png');
}

export type SpriteCells = Record<string, string>; // `${dir}:${frame}` -> data URL

const cellCache = new Map<string, Promise<SpriteCells>>();

/**
 * 描き直したシートを 3×3 に等分し、マゼンタ（と近い色）を透過して向き・コマごとの画像にする。
 * モデルが背景に少し色を乗せても拾えるよう、色距離で判定する。
 */
export function loadSpriteCells(sheetUrl: string): Promise<SpriteCells> {
  const hit = cellCache.get(sheetUrl);
  if (hit) return hit;
  const p = (async () => {
    const img = await loadImage(sheetUrl);
    const cw = img.naturalWidth / 3;
    const ch = img.naturalHeight / 3;
    const out: SpriteCells = {};
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const c = document.createElement('canvas');
        c.width = Math.round(cw);
        c.height = Math.round(ch);
        const ctx = c.getContext('2d')!;
        ctx.drawImage(img, col * cw, row * ch, cw, ch, 0, 0, c.width, c.height);
        const data = ctx.getImageData(0, 0, c.width, c.height);
        const d = data.data;
        for (let i = 0; i < d.length; i += 4) {
          const r = d[i], g = d[i + 1], b = d[i + 2];
          const dist = Math.abs(r - CHROMA.r) + Math.abs(g - CHROMA.g) + Math.abs(b - CHROMA.b);
          if (dist < 160) d[i + 3] = 0;
          else if (dist < 240) d[i + 3] = Math.round(d[i + 3] * ((dist - 160) / 80)); // 縁はなだらかに
        }
        ctx.putImageData(data, 0, 0);
        out[`${SHEET_DIRS[row]}:${SHEET_FRAMES[col]}`] = c.toDataURL('image/png');
      }
    }
    return out;
  })();
  cellCache.set(sheetUrl, p);
  return p;
}

/** 向き・コマに対応するセルを引く（左向きは横向きを CSS で反転するので side） */
export function cellFor(cells: SpriteCells | undefined, facing: Facing, frame: Frame): string | null {
  if (!cells) return null;
  const dir = facing === 'left' || facing === 'right' ? 'side' : facing;
  return cells[`${dir}:${frame}`] ?? cells[`${dir}:0`] ?? null;
}

/** 色の見た目の名前（モデルに渡す説明用） */
export function colorName(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return hex;
  const [r, g, b] = [1, 2, 3].map((i) => parseInt(m[i], 16) / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (max !== min) {
    if (max === r) h = ((g - b) / (max - min)) % 6;
    else if (max === g) h = (b - r) / (max - min) + 2;
    else h = (r - g) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
  }
  if (l < 0.13) return 'black';
  if (l > 0.9 && s < 0.2) return 'white';
  if (s < 0.12) return l < 0.4 ? 'dark gray' : l < 0.7 ? 'gray' : 'light gray';
  const hue = h < 15 || h >= 345 ? 'red' : h < 40 ? 'orange' : h < 65 ? 'yellow' : h < 160 ? 'green' : h < 200 ? 'teal' : h < 250 ? 'blue' : h < 290 ? 'purple' : h < 330 ? 'magenta' : 'pink';
  const tone = l < 0.3 ? 'dark ' : l > 0.7 ? 'light ' : '';
  return `${tone}${hue}`;
}

/** 人物の見た目を英語で説明する */
export function describeLook(name: string, title: string, look: Look): string {
  const hair = `${colorName(look.hair)} ${look.hairStyle === 'beret' ? 'hair under a beret' : `${look.hairStyle ?? 'short'} hair`}`;
  const parts = [
    `${name} (${title}) of a manga publisher's office.`,
    `A small chibi-proportioned pixel character: ${hair}, ${colorName(look.cloth)} clothes${look.pants ? `, ${colorName(look.pants)} trousers` : ''}${look.glasses ? ', glasses' : ''}${look.accent ? `, ${colorName(look.accent)} accent` : ''}.`,
  ];
  return parts.join(' ');
}
