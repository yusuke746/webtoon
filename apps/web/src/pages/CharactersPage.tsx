import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { Character } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';
import { BusyOverlay } from '../components/JobProgress';
import { RefImageStudio } from '../components/RefImageStudio';
import { LoraStudio } from '../components/LoraStudio';

/**
 * キャラクター画面。
 * 設定の編集に加えて、各キャラの «ビジュアル工房»（参照画像の生成 / LoRA学習）を内包する。
 */
export function CharactersPage() {
  const projectId = Number(useParams().projectId);
  const { data: characters, reload } = useFetch(() => api.listCharacters(projectId), [projectId]);
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<Character | null>(null);
  const [openId, setOpenId] = useState<number | null>(null);
  const [tab, setTab] = useState<'ref' | 'lora'>('ref');
  const formRef = useRef<HTMLDivElement>(null);

  // フォームは対象カードの直下（新規は一覧の先頭）に出す。画面外なら見える位置までスクロールする
  useEffect(() => {
    if (editing) formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [editing?.id]);

  const blank: Character = {
    id: 0, projectId, name: '', role: '', appearance: '', personality: '',
    refImageUrl: null, loraUrl: null, sourceAssetId: null, createdAt: '',
  };

  /** 編集/新規フォーム。呼び出し位置でカード直下 or 一覧先頭に描画する */
  const renderForm = () => editing && (
    <div ref={formRef} className="card accent">
      <h3>{editing.id ? `「${editing.name}」を編集` : '新規キャラクター'}</h3>
      <div className="grid2">
        <div>
          <label>名前</label>
          <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
          <label>役割</label>
          <input value={editing.role} onChange={(e) => setEditing({ ...editing, role: e.target.value })} />
          <label>参照画像URL <span className="hint">／ ビジュアル工房から生成できます</span></label>
          <input value={editing.refImageUrl ?? ''}
            onChange={(e) => setEditing({ ...editing, refImageUrl: e.target.value || null })} />
          <label>LoRA URL <span className="hint">／ ビジュアル工房で学習できます</span></label>
          <input value={editing.loraUrl ?? ''}
            onChange={(e) => setEditing({ ...editing, loraUrl: e.target.value || null })} />
        </div>
        <div>
          <label>外見 <span className="hint">／ 参照画像の生成プロンプトの元になります</span></label>
          <textarea rows={5} value={editing.appearance}
            onChange={(e) => setEditing({ ...editing, appearance: e.target.value })} />
          <label>性格・口調</label>
          <textarea rows={4} value={editing.personality}
            onChange={(e) => setEditing({ ...editing, personality: e.target.value })} />
        </div>
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={!editing.name.trim()}
          onClick={() => run('キャラクターの保存', async () => {
            if (editing.id) await api.updateCharacter(editing.id, editing);
            else await api.createCharacter(projectId, editing);
            setEditing(null);
            reload();
          })}
        >
          保存
        </button>
        <button className="ghost" onClick={() => setEditing(null)}>キャンセル</button>
      </div>
    </div>
  
  );

  return (
    <div>
      <div className="page-head">
        <h1>キャラクター</h1>
        <p className="lead">
          外見の設定から参照画像を生成し、1枚を採用すると以降の作画で同じ顔・同じ服装が保たれます。
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}
      {busy && <BusyOverlay label={busy} />}

      <div className="row" style={{ marginBottom: 14 }}>
        <button className="primary" disabled={busy !== null}
          onClick={() => run('キャラクターの自動生成', async () => {
            await api.generateCharacters(projectId);
            reload();
          })}
        >
          構成からキャラクターを自動生成
        </button>
        <button onClick={() => setEditing(blank)}>手動で追加</button>
      </div>

      {editing && !editing.id && renderForm()}

      {!characters?.length && (
        <div className="empty-state">
          <div className="big">👤</div>
          まだキャラクターがいません。<br />
          先に構成を生成してから「構成からキャラクターを自動生成」を押すと、あらすじに沿った配役が作られます。
        </div>
      )}

      {characters?.map((c) => (
        <div key={c.id}>
        <div className="card">
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="asset-tile">
              {c.refImageUrl
                ? <img className="asset-thumb" src={c.refImageUrl} alt={c.name} loading="lazy" />
                : <div className="asset-thumb placeholder">参照画像なし</div>}
              <div>
                <strong>{c.name}</strong> <span className="badge">{c.role || '役割未設定'}</span>
                {c.loraUrl && <span className="badge ok" style={{ marginLeft: 4 }}>LoRAあり</span>}
                {c.sourceAssetId && <span className="badge" style={{ marginLeft: 4 }}>ライブラリ由来</span>}
                <div className="muted" style={{ marginTop: 4 }}>外見: {c.appearance || '未設定'}</div>
                <div className="muted">性格: {c.personality || '未設定'}</div>
                {!c.refImageUrl && !c.loraUrl && (
                  <div className="muted" style={{ color: 'var(--warn)' }}>
                    ⚠ 一貫性アセット未設定（コマごとに顔が変わる可能性があります）
                  </div>
                )}
              </div>
            </div>
            <div className="row tight actions">
              <button className="primary sm"
                onClick={() => { setOpenId(openId === c.id ? null : c.id); setTab('ref'); }}>
                {openId === c.id ? '閉じる' : 'ビジュアル工房'}
              </button>
              <button className="sm" onClick={() => setEditing(c)}>編集</button>
              <button className="sm" onClick={() => run('ライブラリへ保存', () => api.saveAsset('character', c.id))}>
                ライブラリへ
              </button>
              <button className="danger sm"
                onClick={() => {
                  if (confirm(`「${c.name}」を削除しますか?`)) api.deleteCharacter(c.id).then(reload);
                }}
              >
                削除
              </button>
            </div>
          </div>

          {openId === c.id && (
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
                  projectId={projectId} kind="character" ownerId={c.id}
                  ownerName={c.name} description={c.appearance} onAdopted={reload}
                />
              ) : (
                <LoraStudio
                  projectId={projectId} targetKind="character" targetId={c.id}
                  targetName={c.name} currentLoraUrl={c.loraUrl} onChanged={reload}
                />
              )}
            </div>
          )}
        </div>
        {editing?.id === c.id && renderForm()}
        </div>
      ))}

    </div>
  );
}
