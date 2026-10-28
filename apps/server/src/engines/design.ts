import { existsSync } from 'node:fs';
import path from 'node:path';
import type { DesignKind, DesignProposal, Job, RefImage } from '@manga/shared';
import { db, rowToBackground, rowToCharacter } from '../db.js';
import { extractJson, getLLMClient } from '../llm/index.js';
import { IMAGES_DIR, localImageFile } from '../image/storage.js';
import { artPickPrompt, locationsPrompt } from '../prompts.js';
import { startJob } from './jobs.js';
import { generateRefImages, listBackgrounds, listRefImages, selectRefImage, startRefVariationsJob } from './visual.js';
import { getProject, listCharacters, listEpisodes, listPanels } from './story.js';

/**
 * 設定画づくり（キャラクターデザイン / 背景設定）の工程。キャラも背景も同じ流れ。
 *
 * 1. 設定画のない対象ごとに候補を数枚生成する
 * 2. 担当（Claude）が候補を «見比べて» 順位を付け、おすすめを決める
 * 3. 編集が「採用」すると、その1枚から4枚セットを派生させる
 *    （キャラ: 正面・横顔・全身・表情 / 背景: 引き・入口から・細部・夜）
 *
 * 背景は手で登録しないと存在しないため、構成・ネームから場所を拾い出す工程も持つ。
 */

export const DESIGN_CANDIDATES = Number(process.env.DESIGN_CANDIDATES ?? 4);

/** 採用した設定画から派生させる4つの見せ方 */
export const DESIGN_VIEWS: Record<DesignKind, string[]> = {
  character: [
    'front view bust-up portrait, neutral expression, looking at viewer',
    'side profile view bust-up, neutral expression',
    'full body standing, front view, arms relaxed at sides',
    'face close-ups with two expressions side by side: smiling and angry',
  ],
  background: [
    'wide establishing shot of the whole space, eye level, no people',
    'view from the entrance looking into the space, no people',
    'close-up of the most characteristic corner or furniture, no people',
    'the same place at night lit by lamps, no people',
  ],
};

interface Owner { id: number; name: string; subtitle: string; description: string; visualPrompt: string | null; refImageUrl: string | null }

function listOwners(projectId: number, kind: DesignKind): Owner[] {
  if (kind === 'character') {
    return listCharacters(projectId).map((c) => ({
      id: c.id, name: c.name, subtitle: c.role, description: c.appearance, visualPrompt: c.visualPrompt, refImageUrl: c.refImageUrl,
    }));
  }
  return listBackgrounds(projectId).map((b) => ({
    id: b.id, name: b.name, subtitle: '背景', description: b.description, visualPrompt: b.visualPrompt, refImageUrl: b.refImageUrl,
  }));
}

function getOwner(kind: DesignKind, id: number): Owner | null {
  const row = db.prepare(`SELECT * FROM ${kind === 'character' ? 'characters' : 'backgrounds'} WHERE id = ?`).get(id);
  if (!row) return null;
  if (kind === 'character') {
    const c = rowToCharacter(row as any);
    return { id: c.id, name: c.name, subtitle: c.role, description: c.appearance, visualPrompt: c.visualPrompt, refImageUrl: c.refImageUrl };
  }
  const b = rowToBackground(row as any);
  return { id: b.id, name: b.name, subtitle: '背景', description: b.description, visualPrompt: b.visualPrompt, refImageUrl: b.refImageUrl };
}

/** 候補の順位付け（Claude が画像を見る）。失敗時は生成順のまま */
export async function rankCandidates(kind: DesignKind, ownerId: number, candidateIds?: number[]): Promise<RefImage[]> {
  const owner = getOwner(kind, ownerId);
  if (!owner) throw new Error(`対象が見つかりません: ${kind} ${ownerId}`);
  let candidates = listRefImages(kind, ownerId).filter((r) => !r.selected && r.role === 'candidate');
  if (candidateIds?.length) candidates = candidates.filter((r) => candidateIds.includes(r.id));
  const photos = listRefImages(kind, ownerId)
    .filter((r) => r.role === 'photo')
    .map((r) => localImageFile(r.url))
    .filter((f): f is string => !!f && existsSync(f))
    .map((f) => path.relative(IMAGES_DIR, f));
  const viewable = candidates
    .map((r) => ({ r, file: localImageFile(r.url) }))
    .filter((x): x is { r: RefImage; file: string } => !!x.file && existsSync(x.file));
  if (viewable.length < 2) {
    viewable.forEach((x) => db.prepare('UPDATE ref_images SET rank = 1, note = ? WHERE id = ?').run('候補が1枚のためそのまま', x.r.id));
    return listRefImages(kind, ownerId);
  }
  try {
    const text = await getLLMClient().complete({
      task: 'art_pick',
      system: kind === 'character'
        ? 'あなたは漫画編集部の設定担当（キャラクターデザイン監修）です。画像を実際に Read で開いて見比べ、設定への忠実さで順位を付けます。'
        : 'あなたは漫画編集部のロケハン担当（背景設定の監修）です。画像を実際に Read で開いて見比べ、場所の設定への忠実さと «以後の基準にしやすさ» で順位を付けます。',
      prompt: artPickPrompt(kind, owner, viewable.map((x) => ({ id: x.r.id, file: path.relative(IMAGES_DIR, x.file) })), photos),
      cwd: IMAGES_DIR,
    });
    const out = extractJson<{ ranking?: number[]; reason?: string }>(text);
    const ranking = (out.ranking ?? []).filter((id) => viewable.some((x) => x.r.id === id));
    const rest = viewable.map((x) => x.r.id).filter((id) => !ranking.includes(id));
    [...ranking, ...rest].forEach((id, i) => {
      db.prepare('UPDATE ref_images SET rank = ?, note = ? WHERE id = ?').run(i + 1, i === 0 ? (out.reason ?? '').trim() || null : null, id);
    });
  } catch (e) {
    console.warn(`[design] ${owner.name} の候補の順位付けに失敗（生成順のまま）:`, (e as Error).message);
    viewable.forEach((x, i) => db.prepare('UPDATE ref_images SET rank = ? WHERE id = ?').run(i + 1, x.r.id));
  }
  return listRefImages(kind, ownerId);
}

/** 設定画のない対象（指定があればその中で）に候補を作り、順位を付けるジョブ */
export function startDesignJob(projectId: number, kind: DesignKind, ownerIds?: number[]): Job {
  const targets = listOwners(projectId, kind).filter((o) => !o.refImageUrl && (!ownerIds?.length || ownerIds.includes(o.id)));
  if (!targets.length) throw new Error(kind === 'character' ? '設定画がまだのキャラクターはいません' : '設定画がまだの背景はありません');
  const label = kind === 'character' ? '設定画づくり' : '背景の設定画づくり';
  return startJob(
    {
      projectId,
      kind: kind === 'character' ? 'ref_images' : 'design_background',
      label: `${label}: ${targets.map((o) => o.name).join('・')}`,
      totalSteps: targets.length * 2,
      step: `${targets[0].name} の候補を描いています…`,
    },
    async (ctx) => {
      ctx.setResultRef(`design:${kind}`);
      for (const o of targets) {
        // 背景にロケハン写真があれば、写真から起こす
        const photos = kind === 'background' ? listRefImages('background', o.id).filter((r) => r.role === 'photo').map((r) => r.url) : [];
        ctx.setStep(photos.length ? `${o.name} の写真を背景に起こしています…` : `${o.name} の候補を描いています…`);
        const made = await generateRefImages(projectId, kind, o.id, DESIGN_CANDIDATES, undefined, () => undefined, { fromPhotos: photos });
        ctx.advance(`${o.name} の候補を見比べています…`);
        await rankCandidates(kind, o.id, made.map((r) => r.id));
        ctx.advance(`${o.name} の設定画の候補ができました`);
      }
    },
  );
}

export function listDesignProposals(projectId: number, kind: DesignKind): DesignProposal[] {
  return listOwners(projectId, kind).map((owner) => {
    const all = listRefImages(kind, owner.id);
    const candidates = all.filter((r) => r.role === 'candidate').sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || b.id - a.id);
    const top = candidates.find((r) => r.rank === 1 && !r.selected) ?? (owner.refImageUrl ? null : candidates[0] ?? null);
    const photos = all.filter((r) => r.role === 'photo').length;
    return { kind, owner: { id: owner.id, name: owner.name, subtitle: photos ? `${owner.subtitle}・写真${photos}枚` : owner.subtitle }, candidates, top, adopted: !!owner.refImageUrl };
  });
}

/** 採用して、4枚セットの派生を始める */
export async function adoptDesign(kind: DesignKind, ownerId: number, refImageId: number): Promise<{ ref: RefImage; job: Job | null }> {
  const ref = await selectRefImage(refImageId);
  if (ref.ownerId !== ownerId || ref.kind !== kind) throw new Error('その対象の候補ではありません');
  const name = getOwner(kind, ownerId)?.name ?? '';
  let job: Job | null = null;
  if (process.env.DESIGN_VIEWS !== '0') {
    try {
      job = startRefVariationsJob(ref.projectId, kind, ownerId, DESIGN_VIEWS[kind].length, {
        prompts: DESIGN_VIEWS[kind],
        label: kind === 'character' ? `設定画セット（正面・横顔・全身・表情）: ${name}` : `背景セット（引き・入口・細部・夜）: ${name}`,
        jobKind: kind === 'character' ? 'ref_images' : 'design_background',
      });
    } catch (e) {
      console.warn('[design] 4枚セットの生成を開始できませんでした:', (e as Error).message);
    }
  }
  return { ref, job };
}

// ---------- 場所の拾い出し（ロケハン） ----------

/** 構成・ネームから繰り返し出てくる場所を拾い、背景として登録する（既存の名前は重複させない） */
export async function extractLocations(projectId: number): Promise<{ created: string[]; skipped: string[] }> {
  const project = getProject(projectId);
  const episodes = listEpisodes(projectId);
  const existing = listBackgrounds(projectId);
  const panelsByEp = episodes.map((e) => ({ episode: e, panels: listPanels(e.id) }));
  const text = await getLLMClient().complete({
    task: 'locations',
    prompt: locationsPrompt(project, panelsByEp, existing.map((b) => b.name)),
  });
  const out = extractJson<{ locations?: { name: string; description: string }[] }>(text);
  const created: string[] = [];
  const skipped: string[] = [];
  const insert = db.prepare('INSERT INTO backgrounds (project_id, name, description) VALUES (?, ?, ?)');
  for (const loc of out.locations ?? []) {
    const name = (loc.name ?? '').trim();
    if (!name) continue;
    if (existing.some((b) => b.name === name) || created.includes(name)) { skipped.push(name); continue; }
    insert.run(projectId, name, (loc.description ?? '').trim());
    created.push(name);
  }
  return { created, skipped };
}

export function startLocationsJob(projectId: number): Job {
  return startJob(
    { projectId, kind: 'locations', label: '場所の拾い出し', totalSteps: 1, step: 'ロケハン担当が構成とネームを読んでいます…' },
    async (ctx) => {
      ctx.setResultRef('locations');
      const r = await extractLocations(projectId);
      ctx.setStep(`${r.created.length} 件の場所を登録しました`);
    },
  );
}
