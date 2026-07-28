import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Foreshadowing } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';

const STATUS_LABEL: Record<Foreshadowing['status'], string> = {
  planned: '計画中',
  planted: '導入済み・未回収',
  resolved: '回収済み',
};

/** 伏線ボード: 伏線の構造データ管理と回収漏れ警告 */
export function ForeshadowPage() {
  const projectId = Number(useParams().projectId);
  const { data: items, reload } = useFetch(() => api.listForeshadowings(projectId), [projectId]);
  const { data: warnings, reload: reloadWarnings } = useFetch(() => api.foreshadowWarnings(projectId), [projectId]);
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<Foreshadowing | null>(null);

  const reloadAll = () => { reload(); reloadWarnings(); };

  return (
    <div>
      <h1>伏線ボード</h1>
      {error && <div className="error-box">{error}</div>}
      <p className="muted">
        伏線は「導入話数」「回収予定話数」「状態」を持つ構造データとして管理され、
        回収漏れは自動で警告されます。「話数構成から同期」でシーン内の setup / payoff 参照を状態に反映します。
      </p>

      {warnings && warnings.length > 0 && (
        <div className="card">
          {warnings.map((w) => (
            <div key={w.foreshadowing.id} className={`warning-item ${w.level}`}>{w.message}</div>
          ))}
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <button
          disabled={busy !== null}
          onClick={() => run('同期', async () => { await api.foreshadowSync(projectId); reloadAll(); })}
        >
          話数構成から同期
        </button>
        <button
          className="primary"
          onClick={() => setEditing({
            id: 0, projectId, title: '', description: '', setupEpisode: null,
            plannedPayoffEpisode: null, resolvedEpisode: null, status: 'planned',
            relatedCharacters: [], relatedItems: [], createdAt: '',
          })}
        >
          伏線を追加
        </button>
      </div>

      <table>
        <thead>
          <tr>
            <th>伏線</th><th>状態</th><th>導入</th><th>回収予定</th><th>回収済み</th><th>関連</th><th></th>
          </tr>
        </thead>
        <tbody>
          {items?.map((f) => (
            <tr key={f.id}>
              <td>
                <strong>{f.title}</strong>
                <div className="muted">{f.description}</div>
              </td>
              <td>
                <span className={`badge ${f.status === 'resolved' ? 'ok' : f.status === 'planted' ? 'warn' : ''}`}>
                  {STATUS_LABEL[f.status]}
                </span>
              </td>
              <td>{f.setupEpisode ? `第${f.setupEpisode}話` : '—'}</td>
              <td>{f.plannedPayoffEpisode ? `第${f.plannedPayoffEpisode}話` : '未定'}</td>
              <td>{f.resolvedEpisode ? `第${f.resolvedEpisode}話` : '—'}</td>
              <td className="muted">
                {[...f.relatedCharacters, ...f.relatedItems].join('、') || '—'}
              </td>
              <td style={{ whiteSpace: 'nowrap' }}>
                <button onClick={() => setEditing(f)}>編集</button>{' '}
                <button
                  className="danger"
                  onClick={() => {
                    if (confirm(`伏線「${f.title}」を削除しますか?`)) {
                      api.deleteForeshadowing(f.id).then(reloadAll);
                    }
                  }}
                >
                  削除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {items && items.length === 0 && <p className="muted">伏線はまだありません。構成生成時に自動で登録されます。</p>}

      {editing && (
        <div className="card" style={{ borderColor: 'var(--accent)', marginTop: 14 }}>
          <h3>{editing.id ? `「${editing.title}」を編集` : '新規伏線'}</h3>
          <label>タイトル</label>
          <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
          <label>内容</label>
          <textarea
            rows={2}
            value={editing.description}
            onChange={(e) => setEditing({ ...editing, description: e.target.value })}
          />
          <div className="grid2">
            <div>
              <label>導入話数</label>
              <input
                type="number"
                value={editing.setupEpisode ?? ''}
                onChange={(e) => setEditing({ ...editing, setupEpisode: e.target.value ? Number(e.target.value) : null })}
              />
              <label>回収予定話数</label>
              <input
                type="number"
                value={editing.plannedPayoffEpisode ?? ''}
                onChange={(e) => setEditing({ ...editing, plannedPayoffEpisode: e.target.value ? Number(e.target.value) : null })}
              />
              <label>状態</label>
              <select
                value={editing.status}
                onChange={(e) => setEditing({ ...editing, status: e.target.value as Foreshadowing['status'] })}
              >
                <option value="planned">計画中</option>
                <option value="planted">導入済み・未回収</option>
                <option value="resolved">回収済み</option>
              </select>
            </div>
            <div>
              <label>関連キャラ（読点区切り）</label>
              <input
                value={editing.relatedCharacters.join('、')}
                onChange={(e) => setEditing({
                  ...editing,
                  relatedCharacters: e.target.value.split('、').map((s) => s.trim()).filter(Boolean),
                })}
              />
              <label>関連アイテム（読点区切り）</label>
              <input
                value={editing.relatedItems.join('、')}
                onChange={(e) => setEditing({
                  ...editing,
                  relatedItems: e.target.value.split('、').map((s) => s.trim()).filter(Boolean),
                })}
              />
              <label>回収済み話数</label>
              <input
                type="number"
                value={editing.resolvedEpisode ?? ''}
                onChange={(e) => setEditing({ ...editing, resolvedEpisode: e.target.value ? Number(e.target.value) : null })}
              />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={!editing.title.trim()}
              onClick={() => run('伏線保存', async () => {
                if (editing.id) await api.updateForeshadowing(editing.id, editing);
                else await api.createForeshadowing(projectId, editing);
                setEditing(null);
                reloadAll();
              })}
            >
              保存
            </button>
            <button onClick={() => setEditing(null)}>キャンセル</button>
          </div>
        </div>
      )}
    </div>
  );
}
