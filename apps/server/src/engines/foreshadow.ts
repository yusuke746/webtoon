import type { Foreshadowing, ForeshadowWarning } from '@manga/shared';
import { db } from '../db.js';
import { listEpisodes, listForeshadowings } from './story.js';

/**
 * 伏線回収エンジン。
 * 連載を通して未回収の伏線を検出し、回収漏れを警告する。
 */
export function detectWarnings(projectId: number): ForeshadowWarning[] {
  const episodes = listEpisodes(projectId);
  const latestEpisode = episodes.reduce((max, e) => Math.max(max, e.number), 0);
  const warnings: ForeshadowWarning[] = [];

  for (const f of listForeshadowings(projectId)) {
    if (f.status === 'resolved') continue;

    if (f.plannedPayoffEpisode != null && latestEpisode > f.plannedPayoffEpisode) {
      warnings.push({
        foreshadowing: f,
        level: 'overdue',
        message: `伏線「${f.title}」は第${f.plannedPayoffEpisode}話で回収予定でしたが、第${latestEpisode}話時点で未回収です。`,
      });
    } else if (f.plannedPayoffEpisode != null && latestEpisode === f.plannedPayoffEpisode) {
      warnings.push({
        foreshadowing: f,
        level: 'due',
        message: `伏線「${f.title}」は今話（第${f.plannedPayoffEpisode}話）で回収予定です。`,
      });
    } else if (f.status === 'planted') {
      warnings.push({
        foreshadowing: f,
        level: 'info',
        message: `伏線「${f.title}」は第${f.setupEpisode}話で導入済み・未回収です${f.plannedPayoffEpisode ? `（回収予定: 第${f.plannedPayoffEpisode}話）` : '（回収予定未設定）'}。`,
      });
    }
  }
  // overdue → due → info の順に並べる
  const order = { overdue: 0, due: 1, info: 2 } as const;
  return warnings.sort((a, b) => order[a.level] - order[b.level]);
}

/** シーンの foreshadowRefs から伏線の導入/回収状態を自動同期する */
export function syncFromEpisodes(projectId: number): Foreshadowing[] {
  const episodes = listEpisodes(projectId);
  const update = db.prepare(
    'UPDATE foreshadowings SET setup_episode = ?, resolved_episode = ?, status = ? WHERE id = ?',
  );

  for (const f of listForeshadowings(projectId)) {
    let setupEp = f.setupEpisode;
    let resolvedEp = f.resolvedEpisode;
    for (const ep of episodes) {
      for (const scene of ep.scenes) {
        for (const ref of scene.foreshadowRefs ?? []) {
          if (ref.title !== f.title) continue;
          if (ref.action === 'setup' && (setupEp == null || ep.number < setupEp)) setupEp = ep.number;
          if (ref.action === 'payoff' && (resolvedEp == null || ep.number > resolvedEp)) resolvedEp = ep.number;
        }
      }
    }
    const status = resolvedEp != null ? 'resolved' : setupEp != null ? 'planted' : 'planned';
    update.run(setupEp, resolvedEp, status, f.id);
  }
  return listForeshadowings(projectId);
}
