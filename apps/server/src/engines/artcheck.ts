import { existsSync } from 'node:fs';
import path from 'node:path';
import type { Background, Character, Panel } from '@manga/shared';
import { db, rowToBackground, rowToCharacter, rowToPanel } from '../db.js';
import { extractJson, getLLMClient } from '../llm/index.js';
import { IMAGES_DIR, localImageFile } from '../image/storage.js';
import { artCheckPrompt, visualPromptPrompt } from '../prompts.js';

/**
 * 作画の一貫性を «文章と目» で守る層（LoRA の代わり）。
 *
 * 1. 絵の指示用の固定文（visualPrompt）: キャラ・背景ごとに Claude が一度だけ英語で作り、
 *    以後すべてのコマで同じ文言を画像プロンプトの先頭に置く。
 * 2. 作画チェック: 生成されたコマの画像を Claude が «見て»、設定と参照画像に照らして
 *    不一致（髪色・服装・人数・文字の混入など）を判定する。不一致なら修正ヒント付きで描き直す。
 */

/** 文字・吹き出しを画像に描かせないための共通指示（吹き出しはアプリが描く） */
export const NO_TEXT_PROMPT = 'clean illustration only, no text, no letters, no words, no speech bubbles, no dialogue balloons, no captions, no sound effects, no logos, no watermarks, no signature, leave clear negative space around the edges for dialogue overlays';
export const NO_TEXT_NEGATIVE = 'text, letters, words, speech bubble, caption, subtitle, watermark, signature, logo, extra fingers, deformed hands';

export const ART_CHECK_ENABLED = process.env.ART_CHECK !== '0';
export const ART_CHECK_MAX_RETRY = Number(process.env.ART_CHECK_MAX_RETRY ?? 2);

// ---------- 絵の指示用の固定文 ----------

/** キャラ/背景の visualPrompt を返す。無ければ Claude に作らせて保存する */
export async function ensureVisualPrompt(kind: 'character' | 'background', id: number): Promise<string> {
  const table = kind === 'character' ? 'characters' : 'backgrounds';
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id) as any;
  if (!row) return '';
  if (row.visual_prompt) return row.visual_prompt as string;
  const name = row.name as string;
  const description = kind === 'character' ? `${row.appearance ?? ''}` : `${row.description ?? ''}`;
  try {
    const text = await getLLMClient().complete({ task: 'visual_prompt', prompt: visualPromptPrompt(kind, name, description) });
    const out = extractJson<{ prompt?: string }>(text);
    const vp = (out.prompt ?? '').trim();
    if (vp) {
      db.prepare(`UPDATE ${table} SET visual_prompt = ? WHERE id = ?`).run(vp, id);
      return vp;
    }
  } catch (e) {
    console.warn(`[art] ${kind} ${name} の固定文の生成に失敗:`, (e as Error).message);
  }
  return '';
}

/** コマのプロンプト先頭に置く「登場人物・舞台」ブロック */
export async function subjectBlock(characters: Character[], background: Background | null): Promise<string> {
  const parts: string[] = [];
  for (const c of characters) {
    const vp = await ensureVisualPrompt('character', c.id);
    if (vp) parts.push(`${c.name}: ${vp}`);
  }
  if (background) {
    const vp = await ensureVisualPrompt('background', background.id);
    if (vp) parts.push(`setting: ${vp}`);
  }
  return parts.join('. ');
}

// ---------- 作画チェック ----------

export interface ArtCheckResult {
  status: 'pass' | 'fail' | 'skipped';
  issues: string[];
  /** 描き直し時にプロンプトへ足す英語の修正ヒント */
  fixPrompt: string;
}

export async function checkPanelImage(panelId: number, attempt: number): Promise<ArtCheckResult> {
  const panel = rowToPanel(db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId) as any);
  const file = panel.imageUrl ? localImageFile(panel.imageUrl) : null;
  if (!ART_CHECK_ENABLED || !file || !existsSync(file)) {
    db.prepare("UPDATE panels SET check_status = 'skipped', check_notes = NULL WHERE id = ?").run(panelId);
    return { status: 'skipped', issues: [], fixPrompt: '' };
  }
  const characters = panel.characterIds
    .map((id) => db.prepare('SELECT * FROM characters WHERE id = ?').get(id))
    .filter(Boolean)
    .map((r) => rowToCharacter(r as any));
  const background = panel.backgroundId
    ? (() => { const r = db.prepare('SELECT * FROM backgrounds WHERE id = ?').get(panel.backgroundId); return r ? rowToBackground(r as any) : null; })()
    : null;
  const refs = characters
    .map((c) => ({ name: c.name, file: c.refImageUrl ? localImageFile(c.refImageUrl) : null }))
    .filter((r): r is { name: string; file: string } => !!r.file && existsSync(r.file));

  try {
    const text = await getLLMClient().complete({
      task: 'art_check',
      system: 'あなたは漫画編集部の作画監修（設定担当）です。画像を実際に Read で開いて確認し、設定との不一致だけを厳密に指摘します。',
      prompt: artCheckPrompt(panel, characters, background, path.relative(IMAGES_DIR, file), refs.map((r) => ({ name: r.name, file: path.relative(IMAGES_DIR, r.file) })), attempt),
      cwd: IMAGES_DIR,
    });
    const out = extractJson<{ pass?: boolean; issues?: string[]; fixPrompt?: string }>(text);
    const issues = (out.issues ?? []).map(String).filter(Boolean);
    const status: ArtCheckResult['status'] = out.pass ? 'pass' : 'fail';
    db.prepare('UPDATE panels SET check_status = ?, check_notes = ? WHERE id = ?').run(status, issues.join('\n') || null, panelId);
    return { status, issues, fixPrompt: (out.fixPrompt ?? '').trim() };
  } catch (e) {
    console.warn(`[art] コマ ${panelId} のチェックに失敗（スキップ扱い）:`, (e as Error).message);
    db.prepare("UPDATE panels SET check_status = 'skipped', check_notes = ? WHERE id = ?").run(`チェック失敗: ${(e as Error).message}`, panelId);
    return { status: 'skipped', issues: [], fixPrompt: '' };
  }
}

export function panelCheckSummary(panels: Panel[]): { pass: number; fail: number; skipped: number } {
  return {
    pass: panels.filter((p) => p.checkStatus === 'pass').length,
    fail: panels.filter((p) => p.checkStatus === 'fail').length,
    skipped: panels.filter((p) => p.checkStatus === 'skipped').length,
  };
}
