import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Job } from '@manga/shared';
import { api, type DiscussionWithMessages } from '../api';
import { useAction, useFetch, useJobTracker } from '../hooks';
import { JobOverlay } from '../components/JobProgress';

const ROLE_CLASS: Record<string, string> = {
  '編集者': 'editor',
  'プロット担当': 'plotter',
  '読者代表': 'reader',
  'ユーザー': 'user',
  'まとめ役': 'facilitator',
};

const STATUS_LABEL: Record<string, string> = {
  running: '議論中',
  awaiting_user: 'あなたの判断待ち',
  adopted: '採用済み',
  rejected: '不採用',
};

/**
 * AI編集会議。
 *
 * 議論はサーバー側でバックグラウンド実行され、発言は生成され次第 DB に入る。
 * この画面はジョブと議論本体をポーリングし、«発言が1つずつ増えていく» 様子を表示する。
 */
export function DiscussionsPage() {
  const projectId = Number(useParams().projectId);
  const { data: discussions, reload } = useFetch(() => api.listDiscussions(projectId), [projectId]);
  const { error, run } = useAction();
  const [topic, setTopic] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);
  const [tick, setTick] = useState(0); // 詳細を再取得させるためのカウンタ

  const tracker = useJobTracker({
    intervalMs: 1200,
    onTick: () => setTick((t) => t + 1),
    onDone: () => { setTick((t) => t + 1); reload(); },
  });

  const start = () =>
    run('AI議論の開始', async () => {
      const { discussion, job } = await api.startDiscussion(projectId, topic.trim());
      setTopic('');
      setOpenId(discussion.id);
      tracker.track(job);
      reload();
    });

  return (
    <div>
      <div className="page-head">
        <h1>AI編集会議</h1>
        <p className="lead">
          編集者・プロット担当・読者代表の3役が議題を議論し、合意案をまとめます。
          途中で介入でき、採否はあなたが決めます。
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}

      {tracker.job && (
        <JobOverlay
          job={tracker.job}
          onClose={tracker.dismiss}
          doneHint={
            <button className="primary" onClick={tracker.dismiss}>合意案を確認する</button>
          }
        />
      )}

      <div className="card">
        <label>議題</label>
        <textarea rows={2} value={topic} onChange={(e) => setTopic(e.target.value)}
          placeholder="例: 第1話の引きは十分か? / 主人公のライバルは何話で登場させるべきか?" />
        <div style={{ marginTop: 8 }}>
          <button className="primary" disabled={tracker.running || !topic.trim()} onClick={start}>
            議論を開始
          </button>
        </div>
      </div>

      {!discussions?.length && (
        <div className="empty-state">
          <div className="big">💬</div>
          まだ議論がありません。構成に迷ったときの相談相手として使えます。
        </div>
      )}

      {discussions?.map((d) => (
        <div className="card" key={d.id}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <strong>{d.topic}</strong>{' '}
              <span className={`badge ${d.status === 'adopted' ? 'ok' : d.status === 'awaiting_user' ? 'warn' : ''}`}>
                {STATUS_LABEL[d.status]}
              </span>
              {d.summary && <div className="muted" style={{ marginTop: 4 }}>📝 {d.summary}</div>}
            </div>
            <button className="sm" onClick={() => setOpenId(openId === d.id ? null : d.id)}>
              {openId === d.id ? '閉じる' : 'ログを見る'}
            </button>
          </div>
          {openId === d.id && (
            <DiscussionDetail
              discussionId={d.id}
              tick={tick}
              activeJob={tracker.job}
              onChanged={reload}
              onJob={(job) => tracker.track(job)}
            />
          )}
        </div>
      ))}
    </div>
  );
}

function DiscussionDetail({
  discussionId, tick, activeJob, onChanged, onJob,
}: {
  discussionId: number;
  /** 変化するたびに再取得するためのトリガ */
  tick: number;
  activeJob: Job | null;
  onChanged: () => void;
  onJob: (job: Job) => void;
}) {
  const { data: d, reload } = useFetch<DiscussionWithMessages>(
    () => api.getDiscussion(discussionId), [discussionId, tick],
  );
  const { busy, error, run } = useAction();
  const [comment, setComment] = useState('');

  if (!d) {
    return (
      <div style={{ marginTop: 12 }}>
        <div className="skeleton" style={{ height: 54, marginBottom: 8 }} />
        <div className="skeleton" style={{ height: 54 }} />
      </div>
    );
  }

  const refresh = () => { reload(); onChanged(); };
  const live = d.status === 'running';
  const jobStep = activeJob?.status === 'running' ? activeJob.step : null;

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      {error && <div className="error-box">{error}</div>}

      <div className="chat">
        {d.messages.map((m) => (
          <div key={m.id} className={`chat-msg ${ROLE_CLASS[m.roleName] ?? ''}`}>
            <div className="who">{m.roleName}<span className="muted">（ラウンド{m.round}）</span></div>
            <div className="body">{m.content}</div>
          </div>
        ))}

        {/* 実行中は「次の発言者が考えている」プレースホルダを出す */}
        {live && (
          <div className="chat-msg pending">
            <div className="who row tight">
              <span className="typing"><i /><i /><i /></span>
              {jobStep ?? '次の発言を生成しています…'}
            </div>
          </div>
        )}
      </div>

      {d.proposal && (
        <div className="card" style={{ marginTop: 12, background: 'var(--accent-soft)', borderColor: '#c7d2fe' }}>
          <strong>合意された提案</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{d.proposal}</div>
        </div>
      )}

      {d.status === 'awaiting_user' && (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={busy !== null}
              onClick={() => run('採用と構成への反映', async () => {
                await api.decide(d.id, true, true);
                refresh();
              })}
            >
              採用して構成に反映
            </button>
            <button disabled={busy !== null}
              onClick={() => run('採用', async () => { await api.decide(d.id, true, false); refresh(); })}>
              採用のみ（反映しない）
            </button>
            <button className="danger" disabled={busy !== null}
              onClick={() => run('不採用', async () => { await api.decide(d.id, false, false); refresh(); })}>
              不採用
            </button>
          </div>

          <label>議論に介入する <span className="hint">／ 意見を追加すると追加ラウンドが走ります</span></label>
          <div className="row">
            <input style={{ flex: 1, minWidth: 200 }} value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例: ライバルの登場はもっと後にしたい" />
            <button disabled={busy !== null || !comment.trim()}
              onClick={() => run('介入と追加ラウンド', async () => {
                const { job } = await api.intervene(d.id, comment.trim());
                setComment('');
                onJob(job);
                refresh();
              })}
            >
              送信
            </button>
          </div>
        </>
      )}
    </div>
  );
}
