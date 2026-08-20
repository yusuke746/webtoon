import type { Job, JobKind } from '@manga/shared';
import { db, rowToJob } from '../db.js';

/**
 * 非同期ジョブ基盤。
 *
 * 生成処理は数十秒〜数十分かかるため、HTTP リクエストを掴んだまま待たせず、
 * ジョブIDを即返してフロントに進捗をポーリングさせる。
 * 進捗は DB に持つのでページをリロードしても追跡できる。
 *
 * 実行はこのプロセス内（インメモリの Promise）で行うため、
 * サーバーを再起動すると running のまま取り残される。起動時に failed へ倒す。
 */

export interface JobContext {
  readonly jobId: number;
  /** 現在のステップ名を更新する（doneSteps は進めない） */
  setStep(step: string): void;
  /** 1ステップ完了として進捗を進める */
  advance(step: string): void;
  /** 完了後に開く対象（例: "discussion:12"） */
  setResultRef(ref: string): void;
}

export function getJob(id: number): Job {
  const row = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  if (!row) throw new Error(`ジョブが見つかりません: ${id}`);
  return rowToJob(row as any);
}

export function listJobs(projectId: number, limit = 20): Job[] {
  return (
    db
      .prepare('SELECT * FROM jobs WHERE project_id = ? ORDER BY id DESC LIMIT ?')
      .all(projectId, limit) as any[]
  ).map(rowToJob);
}

/** 実行中（queued/running）のジョブだけを返す。ヘッダーの進捗表示用 */
export function listActiveJobs(projectId: number): Job[] {
  return (
    db
      .prepare("SELECT * FROM jobs WHERE project_id = ? AND status IN ('queued','running') ORDER BY id")
      .all(projectId) as any[]
  ).map(rowToJob);
}

function touch(id: number, patch: Record<string, unknown>) {
  const cols = Object.keys(patch);
  if (cols.length === 0) return;
  db.prepare(
    `UPDATE jobs SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...cols.map((c) => patch[c] as any), id);
}

export interface StartJobOptions {
  projectId: number | null;
  kind: JobKind;
  label: string;
  /** 進捗バーの分母。不明なら 1 のままでも良い */
  totalSteps?: number;
  /** 最初に表示するステップ名 */
  step?: string;
}

/**
 * ジョブを登録して «即座に» Job を返し、本体はバックグラウンドで実行する。
 * fn が throw した場合は status='failed' と error にメッセージを残す。
 */
export function startJob(
  opts: StartJobOptions,
  fn: (ctx: JobContext) => Promise<void>,
): Job {
  const result = db
    .prepare(
      `INSERT INTO jobs (project_id, kind, status, label, step, done_steps, total_steps)
       VALUES (?, ?, 'running', ?, ?, 0, ?)`,
    )
    .run(opts.projectId, opts.kind, opts.label, opts.step ?? '準備中…', opts.totalSteps ?? 1);
  const jobId = Number(result.lastInsertRowid);

  let done = 0;
  const ctx: JobContext = {
    jobId,
    setStep: (step) => touch(jobId, { step }),
    advance: (step) => {
      done += 1;
      touch(jobId, { step, done_steps: done });
    },
    setResultRef: (ref) => touch(jobId, { result_ref: ref }),
  };

  // 意図的に await しない（レスポンスを先に返すため）
  void (async () => {
    try {
      await fn(ctx);
      const job = getJob(jobId);
      touch(jobId, {
        status: 'succeeded',
        step: '完了',
        done_steps: Math.max(job.doneSteps, job.totalSteps),
      });
    } catch (e) {
      const message = (e as Error).message ?? String(e);
      console.error(`[job:${jobId}] 失敗:`, e);
      touch(jobId, { status: 'failed', step: '失敗', error: message });
    }
  })();

  return getJob(jobId);
}

/**
 * 起動時のクリーンアップ。
 * 実行はプロセス内メモリなので、再起動をまたいだ running は復帰不能。
 * 「進捗0%のまま永遠に回り続ける」表示を避けるため failed に倒す。
 */
export function failStaleJobs(): number {
  const result = db
    .prepare(
      `UPDATE jobs SET status = 'failed', step = '中断', error = ?, updated_at = datetime('now')
       WHERE status IN ('queued','running')`,
    )
    .run('サーバーの再起動により中断されました。もう一度実行してください。');
  return result.changes as number;
}
