import type { Character, Dialogue, Episode, Foreshadowing, Panel, PanelLayout, Project, Scene } from '@manga/shared';
import { db, rowToCharacter, rowToEpisode, rowToForeshadowing, rowToPanel, rowToProject } from '../db.js';
import { getLLMClient, extractJson } from '../llm/index.js';
import { getImageClient } from '../image/index.js';
import {
  NAME_REVIEW_ROLES, charactersPrompt, nameCritiquePrompt,
  panelsPrompt, panelsRevisePrompt, structurePrompt,
} from '../prompts.js';
import { rowToArtStyle } from '../db.js';

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
    imagePrompt: string; characters: string[];
  }[];
}

export async function generatePanels(episodeId: number): Promise<Panel[]> {
  const epRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!epRow) throw new Error(`エピソードが見つかりません: ${episodeId}`);
  const episode = rowToEpisode(epRow as any);
  const project = getProject(episode.projectId);
  const characters = listCharacters(episode.projectId);
  const llm = getLLMClient();

  const text = await llm.complete({
    task: 'panels',
    prompt: panelsPrompt(project, episode, characters),
  });
  let out = extractJson<PanelsOutput>(text);

  // ネーム批評ループ: 演出担当・読者代表が批評し、改稿版を生成する。
  // 議論ログは AI編集会議に保存され、ユーザーが後から確認できる。
  const reviewRounds = project.panelRules.nameReviewRounds ?? 1;
  if (reviewRounds > 0 && (out.panels ?? []).length > 0) {
    out = await reviewAndRevisePanels(project, episode, characters, out, reviewRounds);
  }

  // 再生成時は既存パネルを置き換える
  db.prepare('DELETE FROM panels WHERE episode_id = ?').run(episodeId);
  const insert = db.prepare(
    `INSERT INTO panels (episode_id, idx, layout, description, dialogues, image_prompt, character_ids, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')`,
  );
  (out.panels ?? []).forEach((p, i) => {
    const charIds = (p.characters ?? [])
      .map((name) => characters.find((c) => c.name === name)?.id)
      .filter((id): id is number => id !== undefined);
    insert.run(
      episodeId, i, JSON.stringify(p.layout ?? { page: 1, x: 0, y: 0, w: 4, h: 2 }),
      p.description ?? '', JSON.stringify(p.dialogues ?? []),
      p.imagePrompt ?? '', JSON.stringify(charIds),
    );
  });
  db.prepare("UPDATE episodes SET status = 'paneled' WHERE id = ?").run(episodeId);

  return listPanels(episodeId);
}

/**
 * ネームの自動批評→改稿ループ。
 * 批評で「問題なし」が揃ったラウンドで打ち切る。失敗時は元のネームを維持する。
 */
async function reviewAndRevisePanels(
  project: Project,
  episode: Episode,
  characters: Character[],
  initial: PanelsOutput,
  rounds: number,
): Promise<PanelsOutput> {
  const llm = getLLMClient();
  let current = initial;

  const discussionResult = db.prepare(
    "INSERT INTO discussions (project_id, topic, status) VALUES (?, ?, 'running')",
  ).run(project.id, `第${episode.number}話ネーム批評（自動）`);
  const discussionId = Number(discussionResult.lastInsertRowid);
  const addMessage = (round: number, roleName: string, content: string) =>
    db.prepare(
      'INSERT INTO discussion_messages (discussion_id, round, role_name, content) VALUES (?, ?, ?, ?)',
    ).run(discussionId, round, roleName, content);

  let lastSummary = '批評の結果、修正点はありませんでした。';
  try {
    for (let round = 1; round <= rounds; round++) {
      const panelsJson = JSON.stringify(current.panels, null, 1);
      const critiques: { roleName: string; content: string }[] = [];
      for (const role of NAME_REVIEW_ROLES) {
        const content = (await llm.complete({
          task: 'name_critique',
          system: role.system,
          prompt: nameCritiquePrompt(project, episode, panelsJson),
        })).trim();
        critiques.push({ roleName: role.name, content });
        addMessage(round, role.name, content);
      }

      const hasIssues = critiques.some((c) => !c.content.startsWith('問題なし'));
      if (!hasIssues) break;

      const revisedText = await llm.complete({
        task: 'panels',
        prompt: panelsRevisePrompt(project, episode, characters, panelsJson, critiques),
      });
      const revised = extractJson<PanelsOutput>(revisedText);
      if ((revised.panels ?? []).length > 0) {
        current = revised;
        lastSummary = `批評を反映してネームを改稿しました（ラウンド${round}）。`;
        addMessage(round, 'まとめ役', lastSummary);
      }
    }
    db.prepare(
      "UPDATE discussions SET status = 'adopted', summary = ? WHERE id = ?",
    ).run(lastSummary, discussionId);
  } catch (e) {
    // 批評・改稿に失敗しても初稿ネームは残す
    const msg = `批評ループが中断されました: ${(e as Error).message}`;
    console.warn('[panels]', msg);
    addMessage(rounds, 'まとめ役', msg);
    db.prepare("UPDATE discussions SET status = 'adopted', summary = ? WHERE id = ?").run(msg, discussionId);
  }
  return current;
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

  db.prepare("UPDATE panels SET status = 'generating' WHERE id = ?").run(panelId);
  try {
    const result = await getImageClient().generate({
      prompt: [style?.stylePrompt, panel.imagePrompt].filter(Boolean).join(', '),
      model: style?.model ?? process.env.REPLICATE_MODEL ?? 'black-forest-labs/flux-schnell',
      styleLoraUrl: style?.loraUrl,
      characterLoraUrls: panelChars.map((c) => c.loraUrl).filter((u): u is string => !!u),
      referenceImageUrls: panelChars.map((c) => c.refImageUrl).filter((u): u is string => !!u),
      aspectRatio: panelAspectRatio(panel, project),
      extraInput: style?.extraInput,
    });
    db.prepare("UPDATE panels SET image_url = ?, status = 'done' WHERE id = ?").run(result.url, panelId);
  } catch (e) {
    db.prepare("UPDATE panels SET status = 'error' WHERE id = ?").run(panelId);
    throw e;
  }
  return rowToPanel(db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId) as any);
}

/** コマの縦横比に近い、生成モデルが受け付けるアスペクト比を選ぶ */
function panelAspectRatio(panel: Panel, project: Project): string {
  const { gridCols, gridRows } = project.panelRules;
  const w = (panel.layout.w || 1) / gridCols;
  // ページ全体を縦長 (3:4.2) と想定した実効縦横比
  const h = ((panel.layout.h || 1) / gridRows) * 1.4;
  const ratio = w / h;
  const candidates: [string, number][] = [
    ['9:16', 9 / 16], ['2:3', 2 / 3], ['3:4', 3 / 4], ['1:1', 1],
    ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9],
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c[1] - ratio) < Math.abs(best[1] - ratio)) best = c;
  }
  return best[0];
}

/** エピソード内の全パネルを順次作画（レート制限に配慮して直列実行） */
export async function generateEpisodeImages(episodeId: number): Promise<Panel[]> {
  const panels = listPanels(episodeId);
  for (const p of panels) {
    if (p.status === 'done') continue;
    await generatePanelImage(p.id);
  }
  db.prepare("UPDATE episodes SET status = 'rendered' WHERE id = ?").run(episodeId);
  return listPanels(episodeId);
}
