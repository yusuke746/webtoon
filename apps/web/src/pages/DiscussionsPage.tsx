import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, type DiscussionWithMessages } from '../api';
import { useAction, useFetch } from '../hooks';

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

/** AI編集会議: 複数役割の Claude エージェントによる議論と、ユーザーの介入・採否 */
export function DiscussionsPage() {
  const projectId = Number(useParams().projectId);
  const { data: discussions, reload } = useFetch(() => api.listDiscussions(projectId), [projectId]);
  const { busy, error, run } = useAction();
  const [topic, setTopic] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  return (
    <div>
      <h1>AI編集会議</h1>
      {error && <div className="error-box">{error}</div>}
      <p className="muted">
        編集者・プロット担当・読者代表の3役の Claude が議題について議論し、合意案をまとめます。
        あなたはいつでも介入でき、最終的な採否を決められます。採用時は提案を構成へ自動反映できます。
      </p>

      <div className="card">
        <label>議題</label>
        <textarea
          rows={2}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="例: 第1話の引きは十分か? / 主人公のライバルは何話で登場させるべきか?"
        />
        <div style={{ marginTop: 8 }}>
          <button
            className="primary"
            disabled={busy !== null || !topic.trim()}
            onClick={() => run('AI議論', async () => {
              const d = await api.startDiscussion(projectId, topic.trim());
              setTopic('');
              setOpenId(d.id);
              reload();
            })}
          >
            議論を開始
          </button>
        </div>
        {busy && <p className="spinner-note">⏳ {busy} を実行中です。3役 × 複数ラウンドの応答に数分かかることがあります…</p>}
      </div>

      {discussions?.map((d) => (
        <div className="card" key={d.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{d.topic}</strong>{' '}
              <span className={`badge ${d.status === 'adopted' ? 'ok' : d.status === 'awaiting_user' ? 'warn' : ''}`}>
                {STATUS_LABEL[d.status]}
              </span>
              {d.summary && <div className="muted" style={{ marginTop: 4 }}>📝 {d.summary}</div>}
            </div>
            <button onClick={() => setOpenId(openId === d.id ? null : d.id)}>
              {openId === d.id ? '閉じる' : 'ログを見る'}
            </button>
          </div>
          {openId === d.id && <DiscussionDetail discussionId={d.id} onChanged={reload} />}
        </div>
      ))}
    </div>
  );
}

function DiscussionDetail({ discussionId, onChanged }: { discussionId: number; onChanged: () => void }) {
  const { data: d, reload } = useFetch<DiscussionWithMessages>(
    () => api.getDiscussion(discussionId), [discussionId],
  );
  const { busy, error, run } = useAction();
  const [comment, setComment] = useState('');

  if (!d) return <p className="muted">読み込み中…</p>;

  const refresh = () => { reload(); onChanged(); };

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
      {error && <div className="error-box">{error}</div>}
      <div className="chat">
        {d.messages.map((m) => (
          <div key={m.id} className={`chat-msg ${ROLE_CLASS[m.roleName] ?? ''}`}>
            <div className="who">{m.roleName}<span className="muted">（ラウンド{m.round}）</span></div>
            <div>{m.content}</div>
          </div>
        ))}
      </div>

      {d.proposal && (
        <div className="card" style={{ marginTop: 12, background: 'var(--accent-soft)' }}>
          <strong>合意された提案</strong>
          <div style={{ whiteSpace: 'pre-wrap' }}>{d.proposal}</div>
        </div>
      )}

      {busy && <p className="spinner-note">⏳ {busy} を実行中…</p>}

      {d.status === 'awaiting_user' && (
        <>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={busy !== null}
              onClick={() => run('採用と構成への反映', async () => {
                await api.decide(d.id, true, true);
                refresh();
              })}
            >
              採用して構成に反映
            </button>
            <button
              disabled={busy !== null}
              onClick={() => run('採用', async () => { await api.decide(d.id, true, false); refresh(); })}
            >
              採用のみ（反映しない）
            </button>
            <button
              className="danger"
              disabled={busy !== null}
              onClick={() => run('不採用', async () => { await api.decide(d.id, false, false); refresh(); })}
            >
              不採用
            </button>
          </div>
          <label>議論に介入する（あなたの意見を追加すると、追加ラウンドが実行されます）</label>
          <div className="row">
            <input
              style={{ flex: 1 }}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="例: ライバルの登場はもっと後にしたい"
            />
            <button
              disabled={busy !== null || !comment.trim()}
              onClick={() => run('介入と追加ラウンド', async () => {
                await api.intervene(d.id, comment.trim());
                setComment('');
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
