import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';

/** 作品ダッシュボード: 生成パイプライン・話数一覧・伏線警告・要約ベース変更指示 */
export function ProjectPage() {
  const projectId = Number(useParams().projectId);
  const { data: project, reload: reloadProject } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: episodes, reload: reloadEpisodes } = useFetch(() => api.listEpisodes(projectId), [projectId]);
  const { data: warnings, reload: reloadWarnings } = useFetch(() => api.foreshadowWarnings(projectId), [projectId]);
  const { data: characters, reload: reloadCharacters } = useFetch(() => api.listCharacters(projectId), [projectId]);
  const { busy, error, run } = useAction();

  const [episodeCount, setEpisodeCount] = useState(2);
  const [instruction, setInstruction] = useState('');
  const [synopsis, setSynopsis] = useState<string | null>(null);

  const reloadAll = () => { reloadProject(); reloadEpisodes(); reloadWarnings(); reloadCharacters(); };

  if (!project) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <h1>{project.title}</h1>
      {error && <div className="error-box">{error}</div>}
      {busy && <p className="spinner-note">⏳ {busy} を実行中です。Claude の応答に数十秒〜数分かかることがあります…</p>}

      <div className="card">
        <h3>あらすじ</h3>
        <textarea
          rows={4}
          value={synopsis ?? project.synopsis}
          onChange={(e) => setSynopsis(e.target.value)}
        />
        {synopsis !== null && synopsis !== project.synopsis && (
          <div style={{ marginTop: 8 }}>
            <button
              className="primary"
              onClick={() => run('あらすじ保存', async () => {
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

      {warnings && warnings.length > 0 && (
        <div className="card">
          <h3>⚠ 伏線の状態 <Link to={`/projects/${projectId}/foreshadow`} className="muted">→ 伏線ボードへ</Link></h3>
          {warnings.map((w) => (
            <div key={w.foreshadowing.id} className={`warning-item ${w.level}`}>{w.message}</div>
          ))}
        </div>
      )}

      <div className="card">
        <h3>生成パイプライン</h3>
        <div className="row">
          <input
            type="number"
            min={1}
            max={10}
            style={{ width: 70 }}
            value={episodeCount}
            onChange={(e) => setEpisodeCount(Number(e.target.value))}
          />
          <span>話分を</span>
          <button
            className="primary"
            disabled={busy !== null || !project.synopsis}
            onClick={() => run('ストーリー構成の生成', async () => {
              await api.generateStructure(projectId, episodeCount);
              reloadAll();
            })}
          >
            構成を生成
          </button>
          <button
            disabled={busy !== null || !episodes?.length}
            onClick={() => run('キャラクター生成', async () => {
              await api.generateCharacters(projectId);
              reloadCharacters();
            })}
          >
            キャラクターを生成
          </button>
        </div>
        {!project.synopsis && <p className="muted">先にあらすじを入力してください。</p>}
        {characters && characters.length > 0 && (
          <p className="muted">
            キャラクター: {characters.map((c) => c.name).join('、')}（
            <Link to={`/projects/${projectId}/characters`}>編集</Link>）
          </p>
        )}
      </div>

      <div className="card">
        <h3>話数一覧</h3>
        {!episodes?.length && <p className="muted">まだ構成がありません。「構成を生成」から始めてください。</p>}
        <table>
          <tbody>
            {episodes?.map((e) => (
              <tr key={e.id}>
                <td style={{ whiteSpace: 'nowrap' }}>第{e.number}話</td>
                <td>
                  <Link to={`/projects/${projectId}/episodes/${e.id}`} style={{ fontWeight: 600 }}>
                    {e.title || '(無題)'}
                  </Link>
                  <div className="muted">{e.summary}</div>
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
      </div>

      <div className="card">
        <h3>💬 変更指示（自然言語でOK）</h3>
        <p className="muted">
          例:「ペンダントの伏線回収を3話に延ばして」「2話にライバルキャラの初登場シーンを追加して」。
          指示は現在の構成・伏線データに直接反映されます。
        </p>
        <textarea
          rows={2}
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder="変更したい内容を書いてください"
        />
        <div style={{ marginTop: 8 }}>
          <button
            className="primary"
            disabled={busy !== null || !instruction.trim() || !episodes?.length}
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
