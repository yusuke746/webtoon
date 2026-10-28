import type { ReferenceSheet } from './ImageClient.js';

/**
 * 設定画のまとまりを、モデルに渡す1列に並べる。
 * 優先順位: 各キャラの採用画像 → 背景の採用画像 → 各キャラの派生ビュー → 背景の派生ビュー。
 * 上限を超える分は落とす（主役の顔が最優先）。
 */
export function flattenSheets(sheets: ReferenceSheet[], max: number): { url: string; label: string }[] {
  if (max <= 0 || !sheets.length) return [];
  const out: { url: string; label: string }[] = [];
  const chars = sheets.filter((s) => s.kind === 'character');
  const bgs = sheets.filter((s) => s.kind === 'background');
  const push = (s: ReferenceSheet, i: number, suffix: string) => { if (s.urls[i]) out.push({ url: s.urls[i], label: `${s.label}${suffix}` }); };
  for (const s of chars) push(s, 0, ' (character sheet)');
  for (const s of bgs) push(s, 0, ' (location)');
  const views = ['', ' (side view)', ' (full body)', ' (expressions)'];
  const bgViews = ['', ' (from entrance)', ' (detail)', ' (night)'];
  for (let i = 1; i < 5; i++) {
    for (const s of chars) push(s, i, views[i] ?? ` (view ${i})`);
    for (const s of bgs) push(s, i, bgViews[i] ?? ` (view ${i})`);
  }
  return out.slice(0, max);
}
