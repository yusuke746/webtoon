import { mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DATA_DIR } from '../db.js';

/**
 * 生成画像のローカル保存。
 * Replicate の出力URL（replicate.delivery）は約1時間で失効するため、
 * 生成直後にダウンロードして DATA_DIR/images に保存し、
 * サーバーが配信する永続URL（/api/images/…）へ差し替える。
 */
export const IMAGES_DIR = path.join(DATA_DIR, 'images');
mkdirSync(IMAGES_DIR, { recursive: true });

const EXT_BY_TYPE: Record<string, string> = {
  'image/webp': '.webp',
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
};

/** 配信用パス（/api/images/<file>）をディスク上の絶対パスへ変換する。対象外のURLは null */
export function localImageFile(url: string): string | null {
  const m = url.match(/^\/api\/images\/([^/?#]+)$/);
  return m ? path.join(IMAGES_DIR, m[1]) : null;
}

/**
 * ローカル配信URLを data URI に変換する（Replicate の画像入力用）。
 * ローカル開発ではサーバーが外部から到達できないため、URL のままでは Replicate 側が取得できない。
 */
export async function localImageToDataUri(url: string): Promise<string> {
  const file = localImageFile(url);
  if (!file) return url;
  const { readFile } = await import('node:fs/promises');
  const buf = await readFile(file);
  const ext = path.extname(file).slice(1) || 'webp';
  return `data:image/${ext};base64,${buf.toString('base64')}`;
}

/**
 * URL の画像をダウンロードして保存し、配信用パス（/api/images/<file>）を返す。
 * すでにローカル配信URLの場合はそのまま返す。
 * ダウンロードに失敗した場合は警告を出して元のURLを返す（生成自体は成功扱いのまま）。
 */
export async function persistImage(url: string, key: string): Promise<string> {
  if (url.startsWith('/api/images/')) return url;
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const type = res.headers.get('content-type')?.split(';')[0] ?? '';
    const ext = EXT_BY_TYPE[type] ?? path.extname(new URL(url).pathname) ?? '.webp';
    const filename = `${key}-${Date.now()}${ext || '.webp'}`;
    await writeFile(path.join(IMAGES_DIR, filename), Buffer.from(await res.arrayBuffer()));
    return `/api/images/${filename}`;
  } catch (e) {
    console.warn(`[image] ローカル保存に失敗したため元URLを使用します（時間経過で失効する可能性あり）: ${url}`, e);
    return url;
  }
}
