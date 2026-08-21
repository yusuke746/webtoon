import { useState } from 'react';
import type { ArtStyle, Background, Character, Project, Worldview } from '@manga/shared';
import { api, type AssetType } from '../api';
import { useAction, useFetch } from '../hooks';

/** アセットライブラリ: 作品横断で再利用できるキャラ・世界観・画風（拡張4） */
export function AssetsPage() {
  const { data: characters } = useFetch(() => api.listAssets<Character>('character'));
  const { data: worldviews } = useFetch(() => api.listAssets<Worldview>('worldview'));
  const { data: artStyles } = useFetch(() => api.listAssets<ArtStyle>('art_style'));
  const { data: backgrounds } = useFetch(() => api.listAssets<Background>('background'));
  const { data: projects } = useFetch(() => api.listProjects());
  const { busy, error, run } = useAction();
  const [castTarget, setCastTarget] = useState<Record<string, number>>({});

  const cast = (type: AssetType, assetId: number) => {
    const projectId = castTarget[`${type}-${assetId}`];
    if (!projectId) return;
    run('キャスティング', () => api.castAsset(projectId, type, assetId));
  };

  const CastControl = ({ type, assetId }: { type: AssetType; assetId: number }) => (
    <div className="row" style={{ flexShrink: 0 }}>
      <select
        style={{ width: 180 }}
        value={castTarget[`${type}-${assetId}`] ?? ''}
        onChange={(e) => setCastTarget({ ...castTarget, [`${type}-${assetId}`]: Number(e.target.value) })}
      >
        <option value="">キャスティング先…</option>
        {projects?.map((p: Project) => <option key={p.id} value={p.id}>{p.title}</option>)}
      </select>
      <button disabled={busy !== null || !castTarget[`${type}-${assetId}`]} onClick={() => cast(type, assetId)}>
        投入
      </button>
    </div>
  );

  return (
    <div>
      <div className="page-head">
        <h1>アセットライブラリ</h1>
        <p className="lead">
          各作品で「ライブラリへ保存」したキャラクター・背景・世界観・画風がここに集まります。
          参照画像やLoRAも一緒に引き継がれるので、別作品でも同じ絵柄・同じ顔で描けます。
        </p>
      </div>
      {error && <div className="error-box">{error}</div>}

      <h2>キャラクター</h2>
      {characters?.map((c) => (
        <div className="card" key={c.id}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="asset-tile">
              {c.refImageUrl
                ? <img className="asset-thumb" src={c.refImageUrl} alt={c.name} loading="lazy" />
                : <div className="asset-thumb placeholder">参照画像なし</div>}
              <div>
                <strong>{c.name}</strong> <span className="badge">{c.role || '役割未設定'}</span>
                {c.loraUrl && <span className="badge ok" style={{ marginLeft: 4 }}>LoRAあり</span>}
                <div className="muted">{c.appearance}</div>
              </div>
            </div>
            <CastControl type="character" assetId={c.id} />
          </div>
        </div>
      ))}
      {characters?.length === 0 && <p className="muted">保存済みキャラクターはありません。</p>}

      <h2>背景・ロケーション</h2>
      {backgrounds?.map((b) => (
        <div className="card" key={b.id}>
          <div className="row between" style={{ alignItems: 'flex-start' }}>
            <div className="asset-tile">
              {b.refImageUrl
                ? <img className="asset-thumb wide" src={b.refImageUrl} alt={b.name} loading="lazy" />
                : <div className="asset-thumb wide placeholder">参照画像なし</div>}
              <div>
                <strong>{b.name}</strong>
                {b.loraUrl && <span className="badge ok" style={{ marginLeft: 4 }}>LoRAあり</span>}
                <div className="muted">{b.description}</div>
              </div>
            </div>
            <CastControl type="background" assetId={b.id} />
          </div>
        </div>
      ))}
      {backgrounds?.length === 0 && <p className="muted">保存済み背景はありません。</p>}

      <h2>世界観</h2>
      {worldviews?.map((w) => (
        <div className="card" key={w.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{w.name}</strong>
              <div className="muted">{w.description}</div>
            </div>
            <CastControl type="worldview" assetId={w.id} />
          </div>
        </div>
      ))}
      {worldviews?.length === 0 && <p className="muted">保存済み世界観はありません。</p>}

      <h2>画風</h2>
      {artStyles?.map((s) => (
        <div className="card" key={s.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{s.name}</strong> <span className="badge">{s.model}</span>
              <div className="muted">{s.stylePrompt}</div>
            </div>
            <CastControl type="art_style" assetId={s.id} />
          </div>
        </div>
      ))}
      {artStyles?.length === 0 && <p className="muted">保存済み画風はありません。</p>}
    </div>
  );
}
