import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Scene } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { BusyOverlay } from '../components/JobProgress';

/** 制作フロー STEP2: シーン構成の確認・編集 → ネーム生成へ */
export function EpisodeScenesPage() {
  const projectId = Number(useParams().projectId);
  const episodeId = Number(useParams().episodeId);
  const navigate = useNavigate();
  const { data: episode, reload } = useFetch(() => api.getEpisode(episodeId), [episodeId]);
  const { busy, error, run } = useAction();
  const [draft, setDraft] = useState<Scene[] | null>(null);

  if (!episode) return <SkeletonPage />;

  const scenes = draft ?? episode.scenes;
  const dirty = draft !== null;

  const patch = (i: number, p: Partial<Scene>) =>
    setDraft(scenes.map((s, j) => (j === i ? { ...s, ...p } : s)));

  return (
    <div>
      <div className="page-head">
        <h1>第{episode.number}話「{episode.title}」</h1>
        <p className="lead">この話の流れを確認します。気になる点は直接編集できます。</p>
      </div>

      <WorkflowStepper projectId={projectId} episode={episode} current="scenes" />

      {error && <div className="error-box">{error}</div>}
      {busy && <BusyOverlay label={busy} hint="コマ割り・セリフ・画像プロンプトを作成しています…" />}

      <div className="card">
        <div className="card-head">
          <h3>シーン構成（{scenes.length}シーン）</h3>
          {dirty && (
            <div className="row tight">
              <button className="ghost sm" onClick={() => setDraft(null)}>変更を破棄</button>
              <button className="primary sm"
                onClick={() => run('シーン構成の保存', async () => {
                  await api.updateEpisode(episodeId, { scenes });
                  setDraft(null);
                  reload();
                })}
              >
                保存
              </button>
            </div>
          )}
        </div>

        {scenes.length === 0 && <p className="muted">シーンがありません。構成を再生成してください。</p>}

        {scenes.map((s, i) => (
          <div key={i} className="card" style={{ background: 'var(--panel-2)', marginBottom: 10 }}>
            <div className="row" style={{ alignItems: 'flex-start' }}>
              <span className="badge neutral" style={{ marginTop: 8 }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <input value={s.title} onChange={(e) => patch(i, { title: e.target.value })}
                  style={{ fontWeight: 700 }} />
                <textarea rows={2} value={s.summary} style={{ marginTop: 6 }}
                  onChange={(e) => patch(i, { summary: e.target.value })} />
                <div className="muted" style={{ marginTop: 6 }}>
                  登場: {s.characters?.join('・') || 'なし'}
                  {s.foreshadowRefs?.length > 0 && (
                    <> ／ 伏線: {s.foreshadowRefs
                      .map((f) => `${f.title}(${f.action === 'setup' ? '導入' : '回収'})`).join('、')}</>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="card accent">
        <div className="card-head">
          <h3>次のステップ: ネーム生成</h3>
          {episode.panels.length > 0 && <span className="badge ok">生成済み（{episode.panels.length}コマ）</span>}
        </div>
        <p className="muted">
          シーン構成からコマ割り・セリフ・画像生成プロンプトを作ります。
          {episode.panels.length > 0 && '再生成すると既存のコマ（手動編集を含む）は置き換わります。'}
        </p>
        <div className="row">
          <button className="primary" disabled={busy !== null || scenes.length === 0}
            onClick={() => run('ネーム（コマ割り・セリフ）生成', async () => {
              if (dirty) await api.updateEpisode(episodeId, { scenes });
              await api.generatePanels(episodeId);
              setDraft(null);
              navigate(`/projects/${projectId}/episodes/${episodeId}/panels`);
            })}
          >
            {episode.panels.length ? 'ネームを再生成して次へ' : 'ネームを生成して次へ'}
          </button>
          {episode.panels.length > 0 && (
            <button onClick={() => navigate(`/projects/${projectId}/episodes/${episodeId}/panels`)}>
              生成済みのネームを見る
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function SkeletonPage() {
  return (
    <div>
      <div className="skeleton" style={{ height: 28, width: 260, marginBottom: 14 }} />
      <div className="skeleton" style={{ height: 62, marginBottom: 18 }} />
      <div className="skeleton" style={{ height: 180 }} />
    </div>
  );
}
