import type { Floor } from './floors';
import { SCALE, TILE, tileUrl } from './sprites';

/**
 * フロアのタイル配置だけ（人物なし）を PNG の data URL に描く。
 * 画像生成モデルに「この配置のまま高品質に描き直して」と渡す下絵に使う。
 */
export async function renderFloorDataUrl(floor: Floor, upscale = 2): Promise<string> {
  const rows = floor.map.length;
  const cols = floor.map[0].length;
  const px = TILE * SCALE * upscale;
  const canvas = document.createElement('canvas');
  canvas.width = cols * px;
  canvas.height = rows * px;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;

  const cache = new Map<string, HTMLImageElement>();
  const load = (url: string) => new Promise<HTMLImageElement>((resolve, reject) => {
    const hit = cache.get(url);
    if (hit) { resolve(hit); return; }
    const img = new Image();
    img.onload = () => { cache.set(url, img); resolve(img); };
    img.onerror = () => reject(new Error('タイルを描けませんでした'));
    img.src = url;
  });

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = floor.map[y][x];
      const under = ch === '~' || (y > 0 && floor.map[y - 1][x] === 'W') ? '~' : '.';
      const img = await load(tileUrl(ch, under));
      ctx.drawImage(img, x * px, y * px, px, px);
    }
  }
  return canvas.toDataURL('image/png');
}

/** タイル記号 → 英語の名前（下絵の説明に使う） */
const TILE_NAMES: Record<string, string> = {
  D: 'desk with a monitor', d: 'desk with papers and a lamp', K: 'reception counter', B: 'bookshelf', A: 'art supply shelf',
  E: 'drafting table', T: 'conference table', C: 'cork board', P: 'potted plant', U: 'staircase going up', V: 'staircase going down',
  F: 'filing cabinet', c: 'chair', b: 'whiteboard', W: 'window', ',': 'carpet',
};

/**
 * フロアの配置を文章にする（部屋の用途 + 何がどこにあるか）。
 * 画像モデルは下絵の記号の意味を知らないので、位置を 3×3 の区画で言葉にして添える。
 */
export function describeFloor(floor: Floor): string {
  const rows = floor.map.length;
  const cols = floor.map[0].length;
  const region = (x: number, y: number) => {
    const v = y < rows / 3 ? 'top' : y < (rows * 2) / 3 ? 'middle' : 'bottom';
    const h = x < cols / 3 ? 'left' : x < (cols * 2) / 3 ? 'center' : 'right';
    return v === 'middle' && h === 'center' ? 'center' : `${v}-${h}`;
  };
  const counts = new Map<string, Map<string, number>>(); // name -> region -> count
  let carpet = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const ch = floor.map[y][x];
      if (ch === ',') { carpet++; continue; }
      const name = TILE_NAMES[ch];
      if (!name) continue;
      const r = region(x, y);
      if (!counts.has(name)) counts.set(name, new Map());
      const m = counts.get(name)!;
      m.set(r, (m.get(r) ?? 0) + 1);
    }
  }
  const items = [...counts.entries()].map(([name, m]) => {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const where = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${n} at the ${r}`).join(', ');
    const plural = name.endsWith('shelf') ? name.replace(/shelf$/, 'shelves') : `${name}s`;
    return `${total} ${total > 1 ? plural : name} (${where})`;
  });
  const parts = [
    floor.artDescription ?? `Floor "${floor.label}" of a manga publisher's office.`,
    `The reference image is a top-down tile map of this room, ${cols} tiles wide and ${rows} tiles tall: the top row is the back wall with windows, the left and right edges are walls, and the bottom row is the front wall.`,
    items.length ? `Furniture in the reference and where it is: ${items.join('; ')}.` : '',
    carpet ? 'There is a carpet area in the middle of the room.' : '',
    'Everything else is open wooden floor that must stay walkable and empty.',
  ];
  return parts.filter(Boolean).join(' ');
}
