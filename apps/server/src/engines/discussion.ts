import type { Discussion, DiscussionMessage } from '@manga/shared';
import { db, rowToDiscussion, rowToDiscussionMessage } from '../db.js';
import { getLLMClient, extractJson } from '../llm/index.js';
import {
  DISCUSSION_ROLES, consensusPrompt, discussionTurnPrompt, projectContextSummary,
} from '../prompts.js';
import { getProject, listCharacters, listEpisodes, listForeshadowings } from './story.js';

/**
 * AI同士の議論エンジン。
 * 編集者 / プロット担当 / 読者代表 の Claude エージェントが議題について議論し、
 * まとめ役が合意案を生成する。全ログは DB に保存され、ユーザーが介入・採否を選べる。
 */

const ROUNDS = Number(process.env.DISCUSSION_ROUNDS ?? 2);

export function getDiscussion(id: number): Discussion {
  const r = db.prepare('SELECT * FROM discussions WHERE id = ?').get(id);
  if (!r) throw new Error(`議論が見つかりません: ${id}`);
  return rowToDiscussion(r as any);
}

export function listMessages(discussionId: number): DiscussionMessage[] {
  return (db.prepare('SELECT * FROM discussion_messages WHERE discussion_id = ? ORDER BY id').all(discussionId) as any[])
    .map(rowToDiscussionMessage);
}

function addMessage(discussionId: number, round: number, roleName: string, content: string) {
  db.prepare(
    'INSERT INTO discussion_messages (discussion_id, round, role_name, content) VALUES (?, ?, ?, ?)',
  ).run(discussionId, round, roleName, content);
}

/** 議論を新規作成し、規定ラウンドを実行して合意案まで進める */
export async function startDiscussion(projectId: number, topic: string): Promise<Discussion> {
  const result = db.prepare(
    "INSERT INTO discussions (project_id, topic, status) VALUES (?, ?, 'running')",
  ).run(projectId, topic);
  const discussionId = Number(result.lastInsertRowid);

  await runRounds(discussionId, 1, ROUNDS);
  await buildConsensus(discussionId);
  return getDiscussion(discussionId);
}

/** ユーザーの介入コメントを追加し、追加ラウンド + 再合意を実行する */
export async function intervene(discussionId: number, userComment: string): Promise<Discussion> {
  const messages = listMessages(discussionId);
  const nextRound = messages.reduce((max, m) => Math.max(max, m.round), 0) + 1;
  addMessage(discussionId, nextRound, 'ユーザー', userComment);
  db.prepare("UPDATE discussions SET status = 'running' WHERE id = ?").run(discussionId);

  await runRounds(discussionId, nextRound + 1, 1);
  await buildConsensus(discussionId);
  return getDiscussion(discussionId);
}

async function runRounds(discussionId: number, startRound: number, count: number) {
  const discussion = getDiscussion(discussionId);
  const project = getProject(discussion.projectId);
  const context = projectContextSummary(
    project,
    listEpisodes(project.id),
    listCharacters(project.id),
    listForeshadowings(project.id),
  );
  const llm = getLLMClient();

  for (let round = startRound; round < startRound + count; round++) {
    for (const role of DISCUSSION_ROLES) {
      const history = listMessages(discussionId).map((m) => ({ roleName: m.roleName, content: m.content }));
      const content = await llm.complete({
        task: 'discussion',
        system: role.system,
        prompt: discussionTurnPrompt(discussion.topic, context, history),
      });
      addMessage(discussionId, round, role.name, content.trim());
    }
  }
}

async function buildConsensus(discussionId: number) {
  const discussion = getDiscussion(discussionId);
  const history = listMessages(discussionId).map((m) => ({ roleName: m.roleName, content: m.content }));
  const text = await getLLMClient().complete({
    task: 'consensus',
    prompt: consensusPrompt(discussion.topic, history),
  });
  const out = extractJson<{ summary: string; proposal: string }>(text);
  addMessage(discussionId, history.length ? Math.max(...listMessages(discussionId).map((m) => m.round)) : 1, 'まとめ役', out.summary);
  db.prepare(
    "UPDATE discussions SET status = 'awaiting_user', summary = ?, proposal = ? WHERE id = ?",
  ).run(out.summary, out.proposal, discussionId);
}

export function setDecision(discussionId: number, adopted: boolean): Discussion {
  db.prepare('UPDATE discussions SET status = ? WHERE id = ?').run(
    adopted ? 'adopted' : 'rejected',
    discussionId,
  );
  return getDiscussion(discussionId);
}
