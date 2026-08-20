import { Link, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAction, useFetch, useJobTracker } from '../hooks';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { JobStrip } from '../components/JobProgress';
import { PageViewer } from '../components/PageViewer';
import { SkeletonPage } from './EpisodeScenesPage';

const PANEL_STATUS = {
  draft: { label: '未作画', cls: 'neutral' },
  generating: { label: '作画中', cls: 'warn' },
  done: { label: '作画済み', cls: 'ok' },
  error: { label: 'エラー', cls: 'danger' },
} as const;

/** 制作フロー STEP4: 作画（コマ単位 / 一括） */
export function EpisodeArtPage() {
  const projectId = Number(useParams().projectId);
  const episodeId = Number(useParams().episodeId);
  const { data: project } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: episode, reload } = useFetch(() => api.getEpisode(episodeId), [episodeId]);
  const { data: characters } = useFetch(() => api.listCharacters(projectId), [projectId]);
  const { data: health } = useFetch(() => api.health(), []);
  const { busy, error, run } = useAction();

  // 一括作画は1コマごとに進むので、進捗のたびに画面も更新する
  const tracker = useJobTracker({ onTick: () => reload(), onDone: () => reload() });

  if (!episode || !project) return <SkeletonPage />;

  const panels = episode.panels;
  const done = panels.filter((p) => p.status === 'done').length;
  const pending = panels.length - done;

  // 参照画像・LoRAが未設定のキャラがいると一貫性が崩れるため、事前に知らせる
  const usedCharIds = new Set(panels.flatMap((p) => p.characterIds));
  const unconfigured = (characters ?? []).filter(
    (c) => usedCharIds.has(c.id) && !c.refImageUrl && !c.loraUrl,
  );

  return (
    <div>
      <div className="page-head">
        <h1>第{episode.number}話「{episode.title}」の作画</h1>
        <p className="lead">{done} / {panels.length} コマが作画済みです。</p>
      </div>

      <WorkflowStepper projectId={projectId} episode={episode} current="art" />

      {health?.imageClient === 'mock' && (
        <div className="warning-item">
          現在<strong>モック作画</strong>（プレースホルダ画像）で動作しています。画風・参照画像・LoRAは反映されません。
          <code>REPLICATE_API_TOKEN</code> を設定してサーバーを再起動すると実際に作画されます。
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      {tracker.job && <JobStrip job={tracker.job} onDismiss={tracker.dismiss} />}

      {unconfigured.length > 0 && (
        <div className="info-box">
          <strong>一貫性のヒント</strong>：
          {unconfigured.map((c) => c.name).join('・')} に参照画像もLoRAも設定されていません。
          コマごとに顔が変わる可能性があります。
          <Link to={`/projects/${projectId}/characters`}> キャラクター画面</Link>で参照画像を生成できます。
        </div>
      )}

      <div className="card">
        <div className="row between">
          <div>
            <div className="progress" style={{ width: 220 }}>
              <span style={{ width: `${panels.length ? (done / panels.length) * 100 : 0}%` }} />
            </div>
            <div className="muted" style={{ marginTop: 6 }}>
              未作画 {pending} コマ／画像生成は {project.artStyleId ? '作品の画風設定' : '既定モデル'} を使用
            </div>
          </div>
          <div className="row tight">
            <button className="primary" disabled={tracker.running || pending === 0}
              onClick={() => run('一括作画の開始', async () => {
                const job = await api.generateEpisodeImages(episodeId);
                tracker.track(job);
              })}
            >
              未作画コマを一括作画（{pending}件）
            </button>
            <Link to={`/projects/${projectId}/settings`}><button className="ghost sm">画風設定</button></Link>
          </div>
        </div>
      </div>

      <div className="card">
        <h3>ページプレビュー</h3>
        <PageViewer panels={panels} rules={project.panelRules} />
      </div>

      <h2>コマ一覧</h2>
      <div className="panel-grid">
        {panels.map((p) => {
          const st = PANEL_STATUS[p.status];
          return (
            <div className="panel-card" key={p.id}>
              <div className="thumb">
                {p.imageUrl
                  ? <img src={p.imageUrl} alt={`P${p.layout.page}-${p.index + 1}`} loading="lazy" />
                  : <span>未作画</span>}
              </div>
              <div className="meta">
                <div className="row tight" style={{ marginBottom: 4 }}>
                  <span className="badge">P{p.layout.page}-{p.index + 1}</span>
                  <span className={`badge ${st.cls}`}>{st.label}</span>
                </div>
                <div className="muted">{p.description}</div>
              </div>
              <div className="acts">
                <button className="sm" disabled={busy !== null || tracker.running}
                  onClick={() => run(`コマ P${p.layout.page}-${p.index + 1} の作画`, async () => {
                    await api.generatePanelImage(p.id);
                    reload();
                  })}
                >
                  {p.imageUrl ? '再作画' : '作画'}
                </button>
                {p.imageUrl && (
                  <a href={p.imageUrl} target="_blank" rel="noreferrer">
                    <button className="ghost sm">原寸</button>
                  </a>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {done === panels.length && panels.length > 0 && (
        <div className="card accent" style={{ marginTop: 18 }}>
          <h3>🎉 この話の作画が完了しました</h3>
          <div className="row">
            <Link to={`/projects/${projectId}/episodes`}><button className="primary">次の話へ</button></Link>
            <Link to={`/projects/${projectId}/foreshadow`}><button>伏線の回収状況を確認</button></Link>
          </div>
        </div>
      )}
    </div>
  );
}
