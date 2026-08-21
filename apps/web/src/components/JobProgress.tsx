import type { Job } from '@manga/shared';
import { useElapsed } from '../hooks';

/**
 * 非同期処理の進捗表示。
 *   - JobOverlay: 画面を覆うモーダル。AI議論など「待つのが主目的」の処理向け
 *   - JobStrip:   ページ内に置く細い進捗バー。裏で走らせたまま操作を続けたい処理向け
 *   - BusyOverlay: ジョブ化していない同期処理（構成生成など）用の簡易版
 */

function fmt(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${String(s).padStart(2, '0')}秒` : `${s}秒`;
}

function ratio(job: Job): number {
  if (job.totalSteps <= 0) return 0;
  return Math.min(job.doneSteps / job.totalSteps, 1);
}

function Orbs() {
  return <span className="orbs"><i /><i /><i /></span>;
}

export function JobOverlay({
  job,
  onClose,
  /** 完了後に表示する補足（結果への導線など） */
  doneHint,
}: {
  job: Job;
  onClose: () => void;
  doneHint?: React.ReactNode;
}) {
  const running = job.status === 'running' || job.status === 'queued';
  const elapsed = useElapsed(running);
  const pct = Math.round(ratio(job) * 100);

  return (
    <div className="job-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div className="job-card">
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="row tight">
            {running && <Orbs />}
            <h3 style={{ margin: 0 }}>
              {job.status === 'succeeded' ? '✅ 完了しました' : job.status === 'failed' ? '⚠ 失敗しました' : job.label}
            </h3>
          </div>
          {!running && <button className="ghost sm" onClick={onClose}>閉じる</button>}
        </div>

        {running && (
          <>
            <div className="job-step">{job.step || '実行中…'}</div>
            <div className="progress" style={{ margin: '12px 0 8px' }}>
              <span style={{ width: `${Math.max(pct, 4)}%` }} />
            </div>
            <div className="row between job-meta">
              <span>{job.doneSteps} / {job.totalSteps} ステップ</span>
              <span>経過 {fmt(elapsed)}</span>
            </div>
            <p className="muted" style={{ marginTop: 14, marginBottom: 0 }}>
              この画面を閉じても処理は続きます。時間がかかる場合は Claude / Replicate の応答待ちです。
            </p>
            <div style={{ marginTop: 12 }}>
              <button className="ghost sm" onClick={onClose}>バックグラウンドで続ける</button>
            </div>
          </>
        )}

        {job.status === 'failed' && (
          <div className="error-box" style={{ marginTop: 8, marginBottom: 0 }}>{job.error}</div>
        )}

        {job.status === 'succeeded' && (
          <>
            <div className="muted">{job.label}（所要 {fmt(elapsed)}）</div>
            {doneHint && <div style={{ marginTop: 12 }}>{doneHint}</div>}
          </>
        )}
      </div>
    </div>
  );
}

export function JobStrip({ job, onDismiss }: { job: Job; onDismiss?: () => void }) {
  const running = job.status === 'running' || job.status === 'queued';
  const pct = Math.round(ratio(job) * 100);

  if (job.status === 'failed') {
    return (
      <div className="error-box row between">
        <span>{job.label}: {job.error}</span>
        {onDismiss && <button className="ghost sm" onClick={onDismiss}>閉じる</button>}
      </div>
    );
  }

  return (
    <div className="job-strip">
      {running ? <Orbs /> : <span aria-hidden>✅</span>}
      <div className="grow">
        <div className="t">{job.label}</div>
        <div className="s">{job.step}</div>
        <div className="progress" style={{ marginTop: 6 }}>
          <span style={{ width: `${running ? Math.max(pct, 4) : 100}%` }} />
        </div>
      </div>
      {onDismiss && !running && <button className="ghost sm" onClick={onDismiss}>閉じる</button>}
    </div>
  );
}

/** ジョブ化していない同期処理（構成生成・ネーム生成など）用のローディング */
export function BusyOverlay({ label, hint }: { label: string; hint?: string }) {
  const elapsed = useElapsed(true);
  return (
    <div className="job-overlay" role="dialog" aria-modal="true" aria-live="polite">
      <div className="job-card">
        <div className="row tight" style={{ marginBottom: 12 }}>
          <Orbs />
          <h3 style={{ margin: 0 }}>{label}</h3>
        </div>
        <div className="progress indeterminate" style={{ marginBottom: 10 }}><span /></div>
        <div className="row between job-meta">
          <span>{hint ?? 'Claude の応答を待っています…'}</span>
          <span>経過 {fmt(elapsed)}</span>
        </div>
      </div>
    </div>
  );
}
