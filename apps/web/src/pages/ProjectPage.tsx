import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';
import { BusyOverlay, JobStrip } from '../components/JobProgress';

/**
 * 作品ダッシュボード。
 *
 * 「今どこまで準備できていて、次に何をすればいいか」を最初に示すことを最優先にしている。
 * 制作フロー（エピソード選択→シーン構成→ネーム→作画）へはここから入る。
 */
export function ProjectPage() {
  const projectId = Number(useParams().projectId);
  const { data: project, reload: reloadProject } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: episodes, reload: reloadEpisodes } = useFetch(() => api.listEpisodes(projectId), [projectId]);
  const { data: warnings, reload: reloadWarnings } = useFetch(() => api.foreshadowWarnings(projectId), [projectId]);
  const { data: characters, reload: reloadCharacters } = useFetch(() => api.listCharacters(projectId), [projectId]);
  const { data: backgrounds } = useFetch(() => api.listBackgrounds(projectId), [projectId]);
  const { data: activeJobs, reload: reloadJobs } = useFetch(() => api.listActiveJobs(projectId), [projectId]);
  const { busy, error, run } = useAction();

  const [instruction, setInstruction] = useState('');
  const [synopsis, setSynopsis] = useState<string | null>(null);

  const reloadAll = () => {
    reloadProject(); reloadEpisodes(); reloadWarnings(); reloadCharacters(); reloadJobs();
  };

  if (!project) {
    return (
      <div>
        <div className="skeleton" style={{ height: 30, width: 240, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 120 }} />
      </div>
    );
  }

  // 準備の進み具合。ここが埋まるほど作画の一貫性が上がる
  const withVisual = (characters ?? []).filter((c) => c.refImageUrl || c.loraUrl).length;
  const prep = [
    {
      label: 'あらすじ', done: !!project.synopsis,
      detail: project.synopsis ? '入力済み' : '未入力', to: null,
    },
    {
      label: '話数構成', done: (episodes?.length ?? 0) > 0,
      detail: `${episodes?.length ?? 0}話`, to: `/projects/${projectId}/episodes`,
    },
    {
      label: 'キャラクター', done: (characters?.length ?? 0) > 0,
      detail: `${characters?.length ?? 0}人`, to: `/projects/${projectId}/characters`,
    },
    {
      label: '一貫性アセット', done: withVisual > 0,
      detail: `参照画像/LoRA ${withVisual}/${characters?.length ?? 0}人・背景${backgrounds?.length ?? 0}件`,
      to: `/projects/${projectId}/characters`,
    },
  ];
  const nextTodo = prep.find((p) => !p.done);

  return (
    <div>
      <div className="page-head">
        <h1>{project.title}</h1>
        <p className="lead">作品ダッシュボード</p>
      </div>

      {error && <div className="error-box">{error}</div>}
      {busy && <BusyOverlay label={busy} />}
      {activeJobs?.map((j) => <JobStrip key={j.id} job={j} />)}

      {/* 次にやること */}
      <div className="card accent">
        <div className="card-head">
          <h3>{nextTodo ? `次にやること: ${nextTodo.label}` : '準備は完了しています'}</h3>
          <Link to={`/projects/${projectId}/episodes`}>
            <button className="primary sm">制作フローを開く →</button>
          </Link>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {prep.map((p) => (
            <div key={p.label} className="row tight" style={{
              padding: '6px 10px', borderRadius: 8,
              background: p.done ? 'var(--ok-bg)' : 'var(--panel-2)',
              border: '1px solid var(--line)',
            }}>
              <span>{p.done ? '✅' : '⬜'}</span>
              <span>
                <strong style={{ fontSize: 12 }}>{p.label}</strong>
                <span className="muted"> {p.detail}</span>
              </span>
            </div>
          ))}
        </div>
      </div>

      {warnings && warnings.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h3>⚠ 伏線の状態</h3>
            <Link to={`/projects/${projectId}/foreshadow`} className="muted">伏線ボードへ →</Link>
          </div>
          {warnings.map((w) => (
            <div key={w.foreshadowing.id} className={`warning-item ${w.level}`}>{w.message}</div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>あらすじ</h3>
        <p className="muted">ここから話数構成・キャラクター・伏線が生成されます。</p>
        <textarea rows={4} value={synopsis ?? project.synopsis}
          onChange={(e) => setSynopsis(e.target.value)} />
        {synopsis !== null && synopsis !== project.synopsis && (
          <div style={{ marginTop: 8 }}>
            <button className="primary"
              onClick={() => run('あらすじの保存', async () => {
                await api.updateProject(projectId, { synopsis });
                setSynopsis(null);
                reloadProject();
              })}
            >
              保存
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head">
          <h3>話数</h3>
          <Link to={`/projects/${projectId}/episodes`} className="muted">すべて見る →</Link>
        </div>
        {!episodes?.length ? (
          <p className="muted">
            まだ構成がありません。<Link to={`/projects/${projectId}/episodes`}>制作フロー</Link>から生成してください。
          </p>
        ) : (
          <table>
            <tbody>
              {episodes.slice(0, 5).map((e) => (
                <tr key={e.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>第{e.number}話</td>
                  <td>
                    <Link to={`/projects/${projectId}/episodes/${e.id}/scenes`} style={{ fontWeight: 600 }}>
                      {e.title || '(無題)'}
                    </Link>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`badge ${e.status === 'rendered' ? 'ok' : ''}`}>
                      {{ draft: '下書き', structured: '構成済み', paneled: 'ネーム済み', rendered: '作画済み' }[e.status]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="card">
        <h3>💬 変更指示（自然言語でOK）</h3>
        <p className="muted">
          例:「ペンダントの伏線回収を3話に延ばして」「2話にライバルキャラの初登場シーンを追加して」。
          指示は現在の構成・伏線データに直接反映されます。
        </p>
        <textarea rows={2} value={instruction} onChange={(e) => setInstruction(e.target.value)}
          placeholder="変更したい内容を書いてください" />
        <div style={{ marginTop: 8 }}>
          <button className="primary" disabled={busy !== null || !instruction.trim() || !episodes?.length}
            onClick={() => run('変更指示の適用', async () => {
              await api.applyChange(projectId, instruction.trim());
              setInstruction('');
              reloadAll();
            })}
          >
            構成に反映
          </button>
        </div>
      </div>
    </div>
  );
}
