import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Character } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';

export function CharactersPage() {
  const projectId = Number(useParams().projectId);
  const { data: characters, reload } = useFetch(() => api.listCharacters(projectId), [projectId]);
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<Character | null>(null);

  return (
    <div>
      <h1>キャラクター</h1>
      {error && <div className="error-box">{error}</div>}
      <p className="muted">
        外見描写・参照画像・LoRA は作画時の一貫性維持に使われます。
        「ライブラリへ保存」すると別作品でもキャスティングできます。
      </p>

      <div className="row" style={{ marginBottom: 12 }}>
        <button
          className="primary"
          disabled={busy !== null}
          onClick={() => run('キャラクター生成', async () => {
            await api.generateCharacters(projectId);
            reload();
          })}
        >
          構成からキャラクターを自動生成
        </button>
        <button
          onClick={() => setEditing({
            id: 0, projectId, name: '', role: '', appearance: '', personality: '',
            refImageUrl: null, loraUrl: null, sourceAssetId: null, createdAt: '',
          })}
        >
          手動で追加
        </button>
      </div>
      {busy && <p className="spinner-note">⏳ {busy} を実行中…</p>}

      {characters?.map((c) => (
        <div className="card" key={c.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{c.name}</strong> <span className="badge">{c.role || '役割未設定'}</span>
              {c.sourceAssetId && <span className="badge ok">ライブラリ由来</span>}
              <div className="muted">外見: {c.appearance || '未設定'}</div>
              <div className="muted">性格: {c.personality || '未設定'}</div>
              {(c.refImageUrl || c.loraUrl) && (
                <div className="muted">
                  {c.refImageUrl && <>参照画像: {c.refImageUrl} </>}
                  {c.loraUrl && <>LoRA: {c.loraUrl}</>}
                </div>
              )}
            </div>
            <div className="row" style={{ flexShrink: 0 }}>
              <button onClick={() => setEditing(c)}>編集</button>
              <button
                onClick={() => run('ライブラリへ保存', async () => {
                  await api.saveAsset('character', c.id);
                })}
              >
                ライブラリへ保存
              </button>
              <button
                className="danger"
                onClick={() => {
                  if (confirm(`「${c.name}」を削除しますか?`)) api.deleteCharacter(c.id).then(reload);
                }}
              >
                削除
              </button>
            </div>
          </div>
        </div>
      ))}

      {editing && (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h3>{editing.id ? `「${editing.name}」を編集` : '新規キャラクター'}</h3>
          <div className="grid2">
            <div>
              <label>名前</label>
              <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <label>役割</label>
              <input value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} />
              <label>参照画像URL（作画の一貫性用）</label>
              <input
                value={editing.refImageUrl ?? ''}
                onChange={(e) => setEditing({ ...editing, refImageUrl: e.target.value || null })}
              />
              <label>LoRA URL（キャラ専用LoRA）</label>
              <input
                value={editing.loraUrl ?? ''}
                onChange={(e) => setEditing({ ...editing, loraUrl: e.target.value || null })}
              />
            </div>
            <div>
              <label>外見（画像生成に反映される具体的な描写）</label>
              <textarea
                rows={4}
                value={editing.appearance}
                onChange={(e) => setEditing({ ...editing, appearance: e.target.value })}
              />
              <label>性格・口調</label>
              <textarea
                rows={4}
                value={editing.personality}
                onChange={(e) => setEditing({ ...editing, personality: e.target.value })}
              />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={!editing.name.trim()}
              onClick={() => run('キャラクター保存', async () => {
                if (editing.id) await api.updateCharacter(editing.id, editing);
                else await api.createCharacter(projectId, editing);
                setEditing(null);
                reload();
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
