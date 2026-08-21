import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { Episode } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { BusyOverlay } from '../components/JobProgress';

const STATUS: Record<Episode['status'], { label: string; cls: string; next: string }> = {
  draft: { label: '下書き', cls: 'neutral', next: 'scenes' },
  structured: { label: '構成済み', cls: '', next: 'scenes' },
  paneled: { label: 'ネーム済み', cls: 'warn', next: 'art' },
  rendered: { label: '作画済み', cls: 'ok', next: 'art' },
};

/** 制作フロー STEP1: どの話を作るか選ぶ */
export function EpisodeSelectPage() {
  const projectId = Number(useParams().projectId);
  const navigate = useNavigate();
  const { data: project } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: episodes, reload } = useFetch(() => api.listEpisodes(projectId), [projectId]);
  const { busy, error, run } = useAction();
  const [episodeCount, setEpisodeCount] = useState(2);

  return (
    <div>
      <div className="page-head">
        <h1>制作フロー</h1>
        <p className="lead">{project?.title ?? ''}｜作る話を選んでください。</p>
      </div>

      <WorkflowStepper projectId={projectId} episode={null} current="select" />

      {error && <div className="error-box">{error}</div>}
      {busy && <BusyOverlay label={busy} hint="話数構成と伏線を生成しています…" />}

      {!episodes?.length ? (
        <div className="empty-state">
          <div className="big">📖</div>
          まだ話がありません。あらすじから話数構成を生成してください。
          <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
            <input type="number" min={1} max={10} style={{ width: 70 }} value={episodeCount}
              onChange={(e) => setEpisodeCount(Number(e.target.value))} />
            <span>話分を</span>
            <button className="primary" disabled={busy !== null || !project?.synopsis}
              onClick={() => run('ストーリー構成の生成', async () => {
                await api.generateStructure(projectId, episodeCount);
                reload();
              })}
            >
              構成を生成
            </button>
          </div>
          {!project?.synopsis && (
            <p className="muted" style={{ marginTop: 10 }}>
              先に<Link to={`/projects/${projectId}`}>ダッシュボード</Link>であらすじを入力してください。
            </p>
          )}
        </div>
      ) : (
        <>
          <div className="card">
            <table>
              <tbody>
                {episodes.map((e) => {
                  const st = STATUS[e.status];
                  return (
                    <tr key={e.id}>
                      <td style={{ whiteSpace: 'nowrap', fontWeight: 700 }}>第{e.number}話</td>
                      <td>
                        <Link to={`/projects/${projectId}/episodes/${e.id}/scenes`} style={{ fontWeight: 600 }}>
                          {e.title || '(無題)'}
                        </Link>
                        <div className="muted">{e.summary}</div>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <span className={`badge ${st.cls}`}>{st.label}</span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button className="primary sm"
                          onClick={() => navigate(`/projects/${projectId}/episodes/${e.id}/${st.next}`)}
                        >
                          {e.status === 'rendered' ? '見直す' : e.status === 'paneled' ? '作画へ' : '続きから'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>連載を続ける</h3>
            <p className="muted">
              既存の話は変更されません。伏線の回収予定を踏まえて続きの話数が追加されます。
            </p>
            <div className="row">
              <input type="number" min={1} max={10} style={{ width: 70 }} value={episodeCount}
                onChange={(e) => setEpisodeCount(Number(e.target.value))} />
              <span>話分を追加</span>
              <button disabled={busy !== null}
                onClick={() => run('ストーリー構成の生成', async () => {
                  await api.generateStructure(projectId, episodeCount);
                  reload();
                })}
              >
                構成を生成
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
