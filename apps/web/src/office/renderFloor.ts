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
