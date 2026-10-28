import type { Discussion, DiscussionMessage, Job } from '@manga/shared';
import { db, rowToDiscussion, rowToDiscussionMessage } from '../db.js';
import { getLLMClient, extractJson } from '../llm/index.js';
import { startJob, type JobContext } from './jobs.js';
import {
  DISCUSSION_ROLES, consensusPrompt, discussionTurnPrompt, projectContextSummary,
} from '../prompts.js';
import { getProject, listCharacters, listEpisodes, listForeshadowings } from './story.js';
import { buildSeriesContext } from './archive.js';
import { talkDetail } from './talk.js';

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

/**
 * 議論を新規作成し、ラウンド実行をバックグラウンドのジョブへ流す。
 *
 * 3役 × 複数ラウンド + 合意形成で数分かかるため、HTTP は即座に返し、
 * フロントは discussion をポーリングして «発言が増えていく様子» を表示する。
 */
export function startDiscussion(projectId: number, topic: string): { discussion: Discussion; job: Job } {
  const result = db.prepare(
    "INSERT INTO discussions (project_id, topic, status) VALUES (?, ?, 'running')",
  ).run(projectId, topic);
  const discussionId = Number(result.lastInsertRowid);

  const job = startJob(
    {
      projectId,
      kind: 'discussion',
      label: `AI編集会議: ${topic}`,
      // 3役 × ラウンド数 + 合意形成
      totalSteps: DISCUSSION_ROLES.length * ROUNDS + 1,
      step: '議論を開始しています…',
    },
    async (ctx) => {
      ctx.setResultRef(`discussion:${discussionId}`);
      await runRounds(discussionId, 1, ROUNDS, ctx);
      ctx.setStep('合意案をまとめています…');
      await buildConsensus(discussionId);
      ctx.advance('合意案がまとまりました');
    },
  );

  return { discussion: getDiscussion(discussionId), job };
}

/** ユーザーの介入コメントを追加し、追加ラウンド + 再合意をバックグラウンドで実行する */
export function intervene(discussionId: number, userComment: string): { discussion: Discussion; job: Job } {
  const messages = listMessages(discussionId);
  const nextRound = messages.reduce((max, m) => Math.max(max, m.round), 0) + 1;
  addMessage(discussionId, nextRound, 'ユーザー', userComment);
  db.prepare("UPDATE discussions SET status = 'running' WHERE id = ?").run(discussionId);
  const discussion = getDiscussion(discussionId);

  const job = startJob(
    {
      projectId: discussion.projectId,
      kind: 'discussion',
      label: '介入をふまえた追加ラウンド',
      totalSteps: DISCUSSION_ROLES.length + 1,
      step: 'あなたの意見を反映しています…',
    },
    async (ctx) => {
      ctx.setResultRef(`discussion:${discussionId}`);
      await runRounds(discussionId, nextRound + 1, 1, ctx);
      ctx.setStep('合意案を作り直しています…');
      await buildConsensus(discussionId);
      ctx.advance('合意案を更新しました');
    },
  );

  return { discussion, job };
}

async function runRounds(discussionId: number, startRound: number, count: number, ctx?: JobContext) {
  const discussion = getDiscussion(discussionId);
  const project = getProject(discussion.projectId);
  // 要約だけでなく、人物・場所・各話の中身と書庫の連載メモも踏まえて議論する
  const series = buildSeriesContext(project.id, { includePreviousScript: false, maxChars: 6000 });
  const context = [
    projectContextSummary(project, listEpisodes(project.id), listCharacters(project.id), listForeshadowings(project.id)),
    talkDetail(project.id),
    series ? `### 連載アーカイブ（連載マネージャーより）\n${series}` : '',
  ].filter(Boolean).join('\n\n');
  const llm = getLLMClient();

  for (let round = startRound; round < startRound + count; round++) {
    for (const role of DISCUSSION_ROLES) {
      ctx?.setStep(`ラウンド${round}: ${role.name}が発言中…`);
      const history = listMessages(discussionId).map((m) => ({ roleName: m.roleName, content: m.content }));
      const content = await llm.complete({
        task: 'discussion',
        system: role.system,
        prompt: discussionTurnPrompt(discussion.topic, context, history),
      });
      addMessage(discussionId, round, role.name, content.trim());
      ctx?.advance(`ラウンド${round}: ${role.name}の発言が完了`);
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

export function setDecision(discussionId: number, adopted: boolean, applied = false): Discussion {
  db.prepare("UPDATE discussions SET status = ?, applied = ?, decided_at = datetime('now') WHERE id = ?").run(
    adopted ? 'adopted' : 'rejected',
    applied ? 1 : 0,
    discussionId,
  );
  return getDiscussion(discussionId);
}
