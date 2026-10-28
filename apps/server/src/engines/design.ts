import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DesignProposal, Job, RefImage } from '@manga/shared';
import { db, rowToCharacter, rowToRefImage } from '../db.js';
import { extractJson, getLLMClient } from '../llm/index.js';
import { IMAGES_DIR, localImageFile } from '../image/storage.js';
import { artPickPrompt } from '../prompts.js';
import { startJob } from './jobs.js';
import { generateRefImages, listRefImages, selectRefImage, startRefVariationsJob } from './visual.js';
import { listCharacters } from './story.js';

/**
 * 設定画づくり（キャラクターデザインの工程）。
 *
 * 1. 設定画のないキャラごとに候補を数枚生成する
 * 2. 設定担当（Claude）が候補を «見比べて» 順位を付け、おすすめを決める
 * 3. 編集が「採用」すると、その1枚から 正面・横顔・全身・表情 の4枚セットを派生させる
 *    （作画の参照と作画チェックの比較対象になる）
 */

export const DESIGN_CANDIDATES = Number(process.env.DESIGN_CANDIDATES ?? 4);

/** 採用した設定画から派生させる4つの見せ方 */
export const DESIGN_VIEWS = [
  'front view bust-up portrait, neutral expression, looking at viewer',
  'side profile view bust-up, neutral expression',
  'full body standing, front view, arms relaxed at sides',
  'face close-ups with two expressions side by side: smiling and angry',
];

/** 候補の順位付け（Claude が画像を見る）。失敗時は生成順のまま */
export async function rankCandidates(characterId: number, candidateIds?: number[]): Promise<RefImage[]> {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(characterId);
  if (!row) throw new Error(`キャラクターが見つかりません: ${characterId}`);
  const character = rowToCharacter(row as any);
  let candidates = listRefImages('character', characterId).filter((r) => !r.selected);
  if (candidateIds?.length) candidates = candidates.filter((r) => candidateIds.includes(r.id));
  const viewable = candidates
    .map((r) => ({ r, file: localImageFile(r.url) }))
    .filter((x): x is { r: RefImage; file: string } => !!x.file && existsSync(x.file));
  if (viewable.length < 2) {
    // 1枚しか見られないなら順位は自明
    viewable.forEach((x) => db.prepare('UPDATE ref_images SET rank = 1, note = ? WHERE id = ?').run('候補が1枚のためそのまま', x.r.id));
    return listRefImages('character', characterId);
  }
  try {
    const text = await getLLMClient().complete({
      task: 'art_pick',
      system: 'あなたは漫画編集部の設定担当（キャラクターデザイン監修）です。画像を実際に Read で開いて見比べ、設定への忠実さで順位を付けます。',
      prompt: artPickPrompt(character, viewable.map((x) => ({ id: x.r.id, file: path.relative(IMAGES_DIR, x.file) }))),
      cwd: IMAGES_DIR,
    });
    const out = extractJson<{ ranking?: number[]; reason?: string }>(text);
    const ranking = (out.ranking ?? []).filter((id) => viewable.some((x) => x.r.id === id));
    const rest = viewable.map((x) => x.r.id).filter((id) => !ranking.includes(id));
    [...ranking, ...rest].forEach((id, i) => {
      db.prepare('UPDATE ref_images SET rank = ?, note = ? WHERE id = ?').run(i + 1, i === 0 ? (out.reason ?? '').trim() || null : null, id);
    });
  } catch (e) {
    console.warn(`[design] ${character.name} の候補の順位付けに失敗（生成順のまま）:`, (e as Error).message);
    viewable.forEach((x, i) => db.prepare('UPDATE ref_images SET rank = ? WHERE id = ?').run(i + 1, x.r.id));
  }
  return listRefImages('character', characterId);
}

/** 設定画のないキャラ（指定があればその中で）に候補を作り、順位を付けるジョブ */
export function startCharacterDesignJob(projectId: number, characterIds?: number[]): Job {
  const targets = listCharacters(projectId).filter((c) => !c.refImageUrl && (!characterIds?.length || characterIds.includes(c.id)));
  if (!targets.length) throw new Error('設定画がまだのキャラクターはいません');
  return startJob(
    {
      projectId,
      kind: 'ref_images',
      label: `設定画づくり: ${targets.map((c) => c.name).join('・')}`,
      totalSteps: targets.length * 2,
      step: `${targets[0].name} の候補を描いています…`,
    },
    async (ctx) => {
      ctx.setResultRef('design');
      for (const c of targets) {
        ctx.setStep(`${c.name} の候補を描いています…`);
        const made = await generateRefImages(projectId, 'character', c.id, DESIGN_CANDIDATES, undefined, () => undefined);
        ctx.advance(`${c.name} の候補を見比べています…`);
        await rankCandidates(c.id, made.map((r) => r.id));
        ctx.advance(`${c.name} の設定画の候補ができました`);
      }
    },
  );
}

export function listDesignProposals(projectId: number): DesignProposal[] {
  return listCharacters(projectId).map((character) => {
    const candidates = listRefImages('character', character.id)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.id - a.id);
    const top = candidates.find((r) => r.rank === 1 && !r.selected) ?? (character.refImageUrl ? null : candidates[0] ?? null);
    return { character, candidates, top, adopted: !!character.refImageUrl };
  });
}

/** 採用して、4枚セット（正面・横顔・全身・表情）の派生を始める */
export async function adoptDesign(characterId: number, refImageId: number): Promise<{ ref: RefImage; job: Job | null }> {
  const ref = await selectRefImage(refImageId);
  if (ref.ownerId !== characterId || ref.kind !== 'character') throw new Error('そのキャラクターの候補ではありません');
  const projectId = ref.projectId;
  const name = (db.prepare('SELECT name FROM characters WHERE id = ?').get(characterId) as any)?.name ?? '';
  let job: Job | null = null;
  if (process.env.DESIGN_VIEWS !== '0') {
    try {
      job = startRefVariationsJob(projectId, 'character', characterId, DESIGN_VIEWS.length, {
        prompts: DESIGN_VIEWS, label: `設定画セット（正面・横顔・全身・表情）: ${name}`,
      });
    } catch (e) {
      console.warn('[design] 4枚セットの生成を開始できませんでした:', (e as Error).message);
    }
  }
  return { ref, job };
}

export { rowToRefImage };
