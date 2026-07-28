import type { Character, Dialogue, Episode, Foreshadowing, Panel, PanelLayout, Project, Scene } from '@manga/shared';
import { db, rowToCharacter, rowToEpisode, rowToForeshadowing, rowToPanel, rowToProject } from '../db.js';
import { getLLMClient, extractJson } from '../llm/index.js';
import { getImageClient } from '../image/index.js';
import { charactersPrompt, panelsPrompt, structurePrompt } from '../prompts.js';
import { rowToArtStyle } from '../db.js';
import { listBackgrounds } from './visual.js';

// ---------- 取得ヘルパ ----------

export function getProject(id: number): Project {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!r) throw new Error(`プロジェクトが見つかりません: ${id}`);
  return rowToProject(r as any);
}

export function listEpisodes(projectId: number): Episode[] {
  return (db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY number').all(projectId) as any[]).map(rowToEpisode);
}

export function listCharacters(projectId: number): Character[] {
  return (db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY id').all(projectId) as any[]).map(rowToCharacter);
}

export function listForeshadowings(projectId: number): Foreshadowing[] {
  return (db.prepare('SELECT * FROM foreshadowings WHERE project_id = ? ORDER BY id').all(projectId) as any[]).map(rowToForeshadowing);
}

// ---------- ストーリー構成生成 ----------

interface StructureOutput {
  episodes: { number: number; title: string; summary: string; scenes: Scene[] }[];
  foreshadowings: {
    title: string; description: string; setupEpisode: number | null;
    plannedPayoffEpisode: number | null; relatedCharacters: string[]; relatedItems: string[];
  }[];
}

/** あらすじ → 話数構成 + 伏線の構造データを生成し DB へ保存 */
export async function generateStructure(projectId: number, episodeCount: number): Promise<Episode[]> {
  const project = getProject(projectId);
  const existing = listEpisodes(projectId);
  const foreshadowings = listForeshadowings(projectId);

  const text = await getLLMClient().complete({
    task: 'structure',
    prompt: structurePrompt(project, episodeCount, existing, foreshadowings),
  });
  const out = extractJson<StructureOutput>(text);

  const insertEp = db.prepare(
    'INSERT INTO episodes (project_id, number, title, summary, scenes, status) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const ep of out.episodes ?? []) {
    // 既存話と番号が重複する場合はスキップ（続きから生成する前提）
    if (existing.some((e) => e.number === ep.number)) continue;
    insertEp.run(projectId, ep.number, ep.title, ep.summary, JSON.stringify(ep.scenes ?? []), 'structured');
  }

  const insertFs = db.prepare(
    `INSERT INTO foreshadowings
      (project_id, title, description, setup_episode, planned_payoff_episode, status, related_characters, related_items)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const f of out.foreshadowings ?? []) {
    if (foreshadowings.some((x) => x.title === f.title)) continue;
    insertFs.run(
      projectId, f.title, f.description ?? '',
      f.setupEpisode ?? null, f.plannedPayoffEpisode ?? null,
      f.setupEpisode ? 'planted' : 'planned',
      JSON.stringify(f.relatedCharacters ?? []), JSON.stringify(f.relatedItems ?? []),
    );
  }

  return listEpisodes(projectId);
}

// ---------- キャラクター生成 ----------

interface CharactersOutput {
  characters: { name: string; role: string; appearance: string; personality: string }[];
}

export async function generateCharacters(projectId: number): Promise<Character[]> {
  const project = getProject(projectId);
  const episodes = listEpisodes(projectId);
  const existing = listCharacters(projectId);

  const text = await getLLMClient().complete({
    task: 'characters',
    prompt: charactersPrompt(project, episodes),
  });
  const out = extractJson<CharactersOutput>(text);

  const insert = db.prepare(
    'INSERT INTO characters (project_id, name, role, appearance, personality) VALUES (?, ?, ?, ?, ?)',
  );
  for (const c of out.characters ?? []) {
    if (existing.some((e) => e.name === c.name)) continue; // 手動編集済みキャラを上書きしない
    insert.run(projectId, c.name, c.role ?? '', c.appearance ?? '', c.personality ?? '');
  }
  return listCharacters(projectId);
}

// ---------- コマ割り・セリフ生成 ----------

interface PanelsOutput {
  panels: {
    layout: PanelLayout; description: string; dialogues: Dialogue[];
    imagePrompt: string; characters: string[]; background?: string | null;
  }[];
}

export async function generatePanels(episodeId: number): Promise<Panel[]> {
  const epRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!epRow) throw new Error(`エピソードが見つかりません: ${episodeId}`);
  const episode = rowToEpisode(epRow as any);
  const project = getProject(episode.projectId);
  const characters = listCharacters(episode.projectId);
  const backgrounds = listBackgrounds(episode.projectId);

  const text = await getLLMClient().complete({
    task: 'panels',
    prompt: panelsPrompt(project, episode, characters, backgrounds),
  });
  const out = extractJson<PanelsOutput>(text);

  // 再生成時は既存パネルを置き換える
  db.prepare('DELETE FROM panels WHERE episode_id = ?').run(episodeId);
  const insert = db.prepare(
    `INSERT INTO panels (episode_id, idx, layout, description, dialogues, image_prompt, character_ids, background_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
  );
  (out.panels ?? []).forEach((p, i) => {
    const charIds = (p.characters ?? [])
      .map((name) => characters.find((c) => c.name === name)?.id)
      .filter((id): id is number => id !== undefined);
    const backgroundId = p.background
      ? backgrounds.find((b) => b.name === p.background)?.id ?? null
      : null;
    insert.run(
      episodeId, i, JSON.stringify(p.layout ?? { page: 1, x: 0, y: 0, w: 4, h: 2 }),
      p.description ?? '', JSON.stringify(p.dialogues ?? []),
      p.imagePrompt ?? '', JSON.stringify(charIds), backgroundId,
    );
  });
  db.prepare("UPDATE episodes SET status = 'paneled' WHERE id = ?").run(episodeId);

  return listPanels(episodeId);
}

export function listPanels(episodeId: number): Panel[] {
  return (db.prepare('SELECT * FROM panels WHERE episode_id = ? ORDER BY idx').all(episodeId) as any[]).map(rowToPanel);
}

// ---------- 作画（画像生成） ----------

export async function generatePanelImage(panelId: number): Promise<Panel> {
  const row = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!row) throw new Error(`パネルが見つかりません: ${panelId}`);
  const panel = rowToPanel(row as any);
  const epRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(panel.episodeId);
  const episode = rowToEpisode(epRow as any);
  const project = getProject(episode.projectId);

  const styleRow = project.artStyleId
    ? db.prepare('SELECT * FROM art_styles WHERE id = ?').get(project.artStyleId)
    : null;
  const style = styleRow ? rowToArtStyle(styleRow as any) : null;

  const panelChars = listCharacters(episode.projectId).filter((c) => panel.characterIds.includes(c.id));
  // 背景も一貫性アセットとして扱う（同じ場所を毎回同じ構造で描くため）
  const background = panel.backgroundId
    ? listBackgrounds(episode.projectId).find((b) => b.id === panel.backgroundId) ?? null
    : null;

  db.prepare("UPDATE panels SET status = 'generating' WHERE id = ?").run(panelId);
  try {
    const result = await getImageClient().generate({
      prompt: [style?.stylePrompt, panel.imagePrompt].filter(Boolean).join(', '),
      model: style?.model ?? process.env.REPLICATE_MODEL ?? 'black-forest-labs/flux-schnell',
      styleLoraUrl: style?.loraUrl,
      characterLoraUrls: panelChars.map((c) => c.loraUrl).filter((u): u is string => !!u),
      referenceImageUrls: panelChars.map((c) => c.refImageUrl).filter((u): u is string => !!u),
      // 背景はキャラとは別枠で渡す。混ぜると「キャラLoRAがあると背景LoRAが黙って落ちる」ため
      backgroundLoraUrl: background?.loraUrl ?? null,
      backgroundRefImageUrl: background?.refImageUrl ?? null,
      extraInput: style?.extraInput,
    });
    db.prepare("UPDATE panels SET image_url = ?, status = 'done' WHERE id = ?").run(result.url, panelId);
  } catch (e) {
    db.prepare("UPDATE panels SET status = 'error' WHERE id = ?").run(panelId);
    throw e;
  }
  return rowToPanel(db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId) as any);
}

/**
 * エピソード内の全パネルを順次作画（レート制限に配慮して直列実行）。
 * onProgress を渡すとコマ1件ごとに進捗を通知する（ジョブの進捗表示用）。
 */
export async function generateEpisodeImages(
  episodeId: number,
  onProgress?: (done: number, total: number, label: string) => void,
): Promise<Panel[]> {
  const panels = listPanels(episodeId);
  const pending = panels.filter((p) => p.status !== 'done');
  let done = 0;
  for (const p of pending) {
    await generatePanelImage(p.id);
    done += 1;
    onProgress?.(done, pending.length, `P${p.layout.page}-${p.index + 1}`);
  }
  db.prepare("UPDATE episodes SET status = 'rendered' WHERE id = ?").run(episodeId);
  return listPanels(episodeId);
}
