import { useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Background } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';
import { RefImageStudio } from '../components/RefImageStudio';
import { LoraStudio } from '../components/LoraStudio';

/**
 * 背景・ロケーションの一貫性を作る画面。
 * 「同じ酒場」「同じ教室」を毎回同じ絵で描くための基準画像 / LoRA をここで用意する。
 * ネーム生成時に、コマへ自動で背景が割り当てられる（名前一致）。
 */
export function BackgroundsPage() {
  const projectId = Number(useParams().projectId);
  const { data: backgrounds, reload } = useFetch(() => api.listBackgrounds(projectId), [projectId]);
  const { error, run } = useAction();
  const [editing, setEditing] = useState<Background | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [tab, setTab] = useState<'ref' | 'lora'>('ref');

  const blank: Background = {
    id: 0, projectId, name: '', description: '',
    refImageUrl: null, loraUrl: null, sourceAssetId: null, createdAt: '',
  };

  return (
    <div>
      <div className="page-head">
        <h1>背景・ロケーション</h1>
        <p className="lead">
          同じ場所を毎回同じ絵で描くための基準を作ります。ここで登録した名前はネーム生成時にコマへ自動で割り当てられます。
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="primary" onClick={() => setEditing(blank)}>背景を追加</button>
      </div>

      {editing && (
        <div className="card accent">
          <h3>{editing.id ? `「${editing.name}」を編集` : '新しい背景'}</h3>
          <div className="grid2">
            <div>
              <label>名前 <span className="hint">／ ネームでこの名前が使われます</span></label>
              <input value={editing.name} placeholder="例: 主人公の教室 / 港の倉庫街"
                onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              <label>参照画像URL <span className="hint">／ 下のタブから生成もできます</span></label>
              <input value={editing.refImageUrl ?? ''}
                onChange={(e) => setEditing({ ...editing, refImageUrl: e.target.value || null })} />
            </div>
            <div>
              <label>場所の説明 <span className="hint">／ 参照画像の生成プロンプトの元になります</span></label>
              <textarea rows={5} value={editing.description}
                placeholder="例: 木造の古い校舎の教室。窓は南向きで西日が強い。机は4列6行。"
                onChange={(e) => setEditing({ ...editing, description: e.target.value })} />
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="primary" disabled={!editing.name.trim()}
              onClick={() => run('背景の保存', async () => {
                if (editing.id) await api.updateBackground(editing.id, editing);
                else await api.createBackground(projectId, editing);
                setEditing(null);
                reload();
              })}
            >
              保存
            </button>
            <button className="ghost" onClick={() => setEditing(null)}>キャンセル</button>
          </div>
        </div>
      )}

      {!backgrounds?.length && !editing && (
        <div className="empty-state">
          <div className="big">🏞</div>
          まだ背景が登録されていません。<br />
          よく出る場所を登録しておくと、話をまたいでも同じ空間として描かれます。
        </div>
      )}

      {backgrounds?.map((b) => (
        <div className="card" key={b.id}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="asset-tile">
              {b.refImageUrl
                ? <img className="asset-thumb wide" src={b.refImageUrl} alt={b.name} loading="lazy" />
                : <div className="asset-thumb wide placeholder">参照画像なし</div>}
              <div>
                <strong>{b.name}</strong>
                {b.loraUrl && <span className="badge ok" style={{ marginLeft: 6 }}>LoRAあり</span>}
                {b.sourceAssetId && <span className="badge" style={{ marginLeft: 6 }}>ライブラリ由来</span>}
                <div className="muted" style={{ marginTop: 4 }}>{b.description || '説明未設定'}</div>
              </div>
            </div>
            <div className="row tight">
              <button className="sm" onClick={() => { setOpenId(openId === b.id ? null : b.id); setTab('ref'); }}>
                {openId === b.id ? '閉じる' : 'ビジュアル工房'}
              </button>
              <button className="sm" onClick={() => setEditing(b)}>編集</button>
              <button className="sm" onClick={() => run('ライブラリへ保存', () => api.saveAsset('background', b.id))}>
                ライブラリへ
              </button>
              <button className="danger sm"
                onClick={() => {
                  if (confirm(`「${b.name}」を削除しますか?`)) {
                    run('背景の削除', async () => { await api.deleteBackground(b.id); reload(); });
                  }
                }}
              >
                削除
              </button>
            </div>
          </div>

          {openId === b.id && (
            <div style={{ marginTop: 14, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
              <div className="tabs">
                <button className={`tab ${tab === 'ref' ? 'active' : ''}`} onClick={() => setTab('ref')}>
                  参照画像
                </button>
                <button className={`tab ${tab === 'lora' ? 'active' : ''}`} onClick={() => setTab('lora')}>
                  LoRA学習
                </button>
              </div>
              {tab === 'ref' ? (
                <RefImageStudio
                  projectId={projectId} kind="background" ownerId={b.id}
                  ownerName={b.name} description={b.description} onAdopted={reload}
                />
              ) : (
                <LoraStudio
                  projectId={projectId} targetKind="background" targetId={b.id}
                  targetName={b.name} currentLoraUrl={b.loraUrl} onChanged={reload}
                />
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
