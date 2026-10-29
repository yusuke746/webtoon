import type { Job, OfficeArt } from '@manga/shared';
import { db, rowToOfficeArt } from '../db.js';
import { getImageClient } from '../image/index.js';
import { modelCaps } from '../image/models.js';
import { persistImage } from '../image/storage.js';
import { startJob } from './jobs.js';

/**
 * オフィスの美術（フロアの背景絵）を画像生成モデルに描かせる。
 *
 * 手打ちの 16×16 タイルでは絵の密度に限界があるため、タイル配置を描いた下絵（ブラウザで描画してアップロード）を
 * 参照画像として渡し、「配置を保ったまま高品質な 16bit 風に描き直す」。歩ける場所・机・階段の位置は下絵どおりなので、
 * 当たり判定のマップはそのまま使える。採用した絵はタイルの代わりに背景として表示する。
 */

export const OFFICE_ART_MODEL = process.env.OFFICE_ART_MODEL ?? 'black-forest-labs/flux-kontext-pro';

const OFFICE_ART_PROMPT = [
  'Redraw this top-down pixel art floor map as a high-quality 16-bit SNES JRPG interior in the style of Chrono Trigger.',
  'Keep the exact layout and positions of everything in the reference: walls, windows, doors, desks, chairs, bookshelves, cabinets, plants, tables, stairs and the open walkable floor areas must stay where they are.',
  'Same top-down camera and same proportions, no perspective change. Rich pixel shading, warm indoor lighting, detailed wooden floor and furniture, clean dithering, consistent 16-bit palette.',
  'Empty room: no characters, no people, no animals. No text, no letters, no logos, no UI, no borders.',
].join(' ');

export function listOfficeArt(): OfficeArt[] {
  return (db.prepare('SELECT * FROM office_art ORDER BY id DESC').all() as any[]).map(rowToOfficeArt);
}

/** フロアごとの採用中の絵 */
export function adoptedOfficeArt(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const a of listOfficeArt()) if (a.adopted && !out[a.floorId]) out[a.floorId] = a.url;
  return out;
}

/** 人物のスプライトシート（3 行 = 正面/横/後ろ、3 列 = 立ち/歩き 1/歩き 2）を描き直す指示 */
const SPRITE_ART_PROMPT = [
  'Redraw this pixel art character sprite sheet as a high-quality 16-bit SNES JRPG sprite in the style of Chrono Trigger.',
  'The reference is a 3 by 3 grid of equal cells: rows from top to bottom are facing down (front view), facing right (side view), facing up (back view); columns from left to right are standing, walking frame 1, walking frame 2.',
  'Keep exactly the same 3 by 3 grid with the same cell size, and keep the character at the same position, scale and pose in every cell. Keep the same silhouette, hairstyle, hair color and clothing colors as the reference; add proper shading, clean outlines and detail. All nine cells must show the same character.',
  'The background of every cell must stay a flat solid magenta color (#FF00FF) with no gradient, no shadow and no outline around the cells. No text, no letters, no grid lines.',
].join(' ');

/** フロアの絵か人物のスプライトか（id の接頭辞で区別。人物は "npc:<id>"） */
export function officeArtKind(targetId: string): 'floor' | 'sprite' {
  return targetId.startsWith('npc:') ? 'sprite' : 'floor';
}

export async function generateOfficeArt(floorId: string, sourceUrl: string, hint = '', description = ''): Promise<OfficeArt> {
  const model = OFFICE_ART_MODEL;
  const caps = modelCaps(model);
  if (caps.refMode === 'none') throw new Error(`モデル ${model} は参照画像を受け取れません。OFFICE_ART_MODEL に flux-kontext-pro や google/nano-banana を指定してください`);
  const kind = officeArtKind(floorId);
  // 部屋の用途と「何がどこにあるか」（人物なら見た目）の文を添える（モデルは下絵の記号の意味を知らない）。要望があれば最後に
  const prompt = [
    description.trim() ? `${kind === 'sprite' ? 'Character' : 'Room'}: ${description.trim()}` : '',
    kind === 'sprite' ? SPRITE_ART_PROMPT : OFFICE_ART_PROMPT,
    hint.trim() ? `Additional request: ${hint.trim()}` : '',
  ].filter(Boolean).join(' ');
  const result = await getImageClient().generate({
    prompt,
    model,
    referenceSheets: [{ label: kind === 'sprite' ? 'the character sprite sheet to redraw' : 'the floor layout to redraw', kind: kind === 'sprite' ? 'character' : 'background', urls: [sourceUrl] }],
    // 下絵と同じ縦横比で返せるモデルはそれを使う。無ければ下絵に一番近い比率になる（フロア 16:10、シート 3:4 付近）
    aspectRatio: caps.aspectValues?.includes('match_input_image') ? 'match_input_image' : kind === 'sprite' ? '3:4' : '16:10',
  });
  const url = await persistImage(result.url, `office-${floorId.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`);
  const r = db.prepare('INSERT INTO office_art (floor_id, url, source_url, prompt) VALUES (?, ?, ?, ?)').run(floorId, url, sourceUrl, prompt);
  return rowToOfficeArt(db.prepare('SELECT * FROM office_art WHERE id = ?').get(Number(r.lastInsertRowid)) as any);
}

/** 複数フロアをまとめて描き直すジョブ */
export function startOfficeArtJob(projectId: number | null, floors: { floorId: string; sourceUrl: string; description?: string }[], hint = ''): Job {
  if (!floors.length) throw new Error('描き直すフロアがありません');
  return startJob(
    {
      projectId,
      kind: 'office_art',
      label: floors.every((f) => officeArtKind(f.floorId) === 'sprite') ? `人物のドット絵: ${floors.length} 人` : `オフィスの美術: ${floors.map((f) => f.floorId).join('・')}`,
      totalSteps: floors.length,
      step: `${floors[0].floorId} を描いています…`,
    },
    async (ctx) => {
      ctx.setResultRef('office:art');
      for (const f of floors) {
        ctx.setStep(`${f.floorId} を描いています…`);
        await generateOfficeArt(f.floorId, f.sourceUrl, hint, f.description ?? '');
        ctx.advance(`${f.floorId} ができました`);
      }
    },
  );
}

/** 採用: 同じフロアの他の絵は採用解除 */
export function adoptOfficeArt(id: number): OfficeArt {
  const row = db.prepare('SELECT * FROM office_art WHERE id = ?').get(id) as any;
  if (!row) throw new Error(`絵が見つかりません: ${id}`);
  db.prepare('UPDATE office_art SET adopted = 0 WHERE floor_id = ?').run(row.floor_id);
  db.prepare('UPDATE office_art SET adopted = 1 WHERE id = ?').run(id);
  return rowToOfficeArt(db.prepare('SELECT * FROM office_art WHERE id = ?').get(id) as any);
}

/** そのフロアをタイル絵に戻す（候補は残す） */
export function revertOfficeArt(floorId: string): void {
  db.prepare('UPDATE office_art SET adopted = 0 WHERE floor_id = ?').run(floorId);
}

export function deleteOfficeArt(id: number): void {
  db.prepare('DELETE FROM office_art WHERE id = ?').run(id);
}
