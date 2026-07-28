import type { Episode, Foreshadowing, Scene } from '@manga/shared';
import { db } from '../db.js';
import { extractJson, getLLMClient } from '../llm/index.js';
import { applyChangePrompt } from '../prompts.js';
import { getProject, listEpisodes, listForeshadowings } from './story.js';

/**
 * 要約ベースの変更指示エンジン（みやすいUI/UXの中核）。
 * 「ペンダントの回収を3話に延ばして」のような自然言語指示を
 * 構成データ（episodes / foreshadowings）へ直接反映する。
 */

interface ChangeOutput {
  episodes: { number: number; title: string; summary: string; scenes: Scene[] }[];
  foreshadowings: {
    title: string; description: string; setupEpisode: number | null;
    plannedPayoffEpisode: number | null; status?: string;
    relatedCharacters: string[]; relatedItems: string[];
  }[];
}

export async function applyChange(
  projectId: number,
  instruction: string,
): Promise<{ episodes: Episode[]; foreshadowings: Foreshadowing[] }> {
  const project = getProject(projectId);
  const episodes = listEpisodes(projectId);
  const foreshadowings = listForeshadowings(projectId);

  const text = await getLLMClient().complete({
    task: 'apply_change',
    prompt: applyChangePrompt(instruction, project, episodes, foreshadowings),
  });
  const out = extractJson<ChangeOutput>(text);

  // モック等が全量を返さない場合は何もしない（安全側）
  if (Array.isArray(out.episodes) && out.episodes.length) {
    const updateEp = db.prepare(
      'UPDATE episodes SET title = ?, summary = ?, scenes = ? WHERE project_id = ? AND number = ?',
    );
    const insertEp = db.prepare(
      "INSERT INTO episodes (project_id, number, title, summary, scenes, status) VALUES (?, ?, ?, ?, ?, 'structured')",
    );
    for (const ep of out.episodes) {
      const exists = episodes.some((e) => e.number === ep.number);
      if (exists) updateEp.run(ep.title, ep.summary, JSON.stringify(ep.scenes ?? []), projectId, ep.number);
      else insertEp.run(projectId, ep.number, ep.title, ep.summary, JSON.stringify(ep.scenes ?? []));
    }
  }

  if (Array.isArray(out.foreshadowings) && out.foreshadowings.length) {
    const updateFs = db.prepare(
      `UPDATE foreshadowings SET description = ?, setup_episode = ?, planned_payoff_episode = ?,
        related_characters = ?, related_items = ? WHERE project_id = ? AND title = ?`,
    );
    const insertFs = db.prepare(
      `INSERT INTO foreshadowings
        (project_id, title, description, setup_episode, planned_payoff_episode, status, related_characters, related_items)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const f of out.foreshadowings) {
      const exists = foreshadowings.some((x) => x.title === f.title);
      if (exists) {
        updateFs.run(
          f.description ?? '', f.setupEpisode ?? null, f.plannedPayoffEpisode ?? null,
          JSON.stringify(f.relatedCharacters ?? []), JSON.stringify(f.relatedItems ?? []),
          projectId, f.title,
        );
      } else {
        insertFs.run(
          projectId, f.title, f.description ?? '',
          f.setupEpisode ?? null, f.plannedPayoffEpisode ?? null,
          f.setupEpisode ? 'planted' : 'planned',
          JSON.stringify(f.relatedCharacters ?? []), JSON.stringify(f.relatedItems ?? []),
        );
      }
    }
  }

  return { episodes: listEpisodes(projectId), foreshadowings: listForeshadowings(projectId) };
}
