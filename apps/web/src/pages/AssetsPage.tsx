import { useState } from 'react';
import type { ArtStyle, Character, Project, Worldview } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';

type AssetType = 'character' | 'worldview' | 'art_style';

/** アセットライブラリ: 作品横断で再利用できるキャラ・世界観・画風（拡張4） */
export function AssetsPage() {
  const { data: characters } = useFetch(() => api.listAssets<Character>('character'));
  const { data: worldviews } = useFetch(() => api.listAssets<Worldview>('worldview'));
  const { data: artStyles } = useFetch(() => api.listAssets<ArtStyle>('art_style'));
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
      <h1>アセットライブラリ</h1>
      {error && <div className="error-box">{error}</div>}
      <p className="muted">
        各作品のページで「ライブラリへ保存」したキャラクター・世界観・画風がここに集まります。
        別の作品へ「キャスティング」して使い回せます。
      </p>

      <h2>キャラクター</h2>
      {characters?.map((c) => (
        <div className="card" key={c.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{c.name}</strong> <span className="badge">{c.role || '役割未設定'}</span>
              <div className="muted">{c.appearance}</div>
            </div>
            <CastControl type="character" assetId={c.id} />
          </div>
        </div>
      ))}
      {characters?.length === 0 && <p className="muted">保存済みキャラクターはありません。</p>}

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
