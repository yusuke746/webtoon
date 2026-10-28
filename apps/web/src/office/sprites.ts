/**
 * ドット絵の描画基盤。
 *
 * 文字列配列で定義したスプライト（art/tiles.ts, art/people.ts）を Canvas に展開し、
 * data URL にして CSS 背景として使う。タイル数が多くても DOM は軽い。
 */
import { TILES, TILE_PALETTE } from './art/tiles';
import { personPalette, personRows, type Dir, type Frame, type Look } from './art/people';

export const TILE = 16;
export const SCALE = 3;
/** 人物スプライトの高さ（タイルより背が高い） */
export const ACTOR_H = 24;

const cache = new Map<string, string>();

export function spriteUrl(rows: string[], palette: Record<string, string>, key: string): string {
  const hit = cache.get(key);
  if (hit) return hit;
  const h = rows.length;
  const w = Math.max(...rows.map((r) => r.length));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < h; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const color = palette[row[x]];
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  const url = canvas.toDataURL('image/png');
  cache.set(key, url);
  return url;
}

/** 家具タイルは床の上に重ねる（'.' は透過なので床を下に敷く） */
export function tileUrl(ch: string, under = '.'): string {
  const rows = TILES[ch] ?? TILES['.'];
  const floor = TILES[under] ?? TILES['.'];
  const composed = rows.map((r, y) => r.split('').map((c, x) => (c === '.' ? floor[y][x] : c)).join(''));
  return spriteUrl(composed, TILE_PALETTE, `tile:${ch}:${under}`);
}

export type Facing = 'down' | 'up' | 'left' | 'right';

/** 向きと歩行フレームに応じた人物スプライト。左向きは横向きを CSS で反転する */
export function actorUrl(look: Look, facing: Facing, frame: Frame): string {
  const dir: Dir = facing === 'left' || facing === 'right' ? 'side' : facing;
  const key = `actor:${JSON.stringify(look)}:${dir}:${frame}`;
  return spriteUrl(personRows(look, dir, frame), personPalette(look), key);
}

export type { Look, Frame };
