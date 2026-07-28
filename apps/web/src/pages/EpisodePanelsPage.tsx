import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import type { Background, Dialogue, Panel } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';
import { WorkflowStepper } from '../components/WorkflowStepper';
import { BusyOverlay } from '../components/JobProgress';
import { PageViewer } from '../components/PageViewer';
import { SkeletonPage } from './EpisodeScenesPage';

/** 制作フロー STEP3: ネーム（コマ割り・セリフ）の確認と手動編集 */
export function EpisodePanelsPage() {
  const projectId = Number(useParams().projectId);
  const episodeId = Number(useParams().episodeId);
  const navigate = useNavigate();
  const { data: project } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: episode, reload } = useFetch(() => api.getEpisode(episodeId), [episodeId]);
  const { data: characters } = useFetch(() => api.listCharacters(projectId), [projectId]);
  const { data: backgrounds } = useFetch(() => api.listBackgrounds(projectId), [projectId]);
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState<Panel | null>(null);

  if (!episode || !project) return <SkeletonPage />;

  return (
    <div>
      <div className="page-head">
        <h1>第{episode.number}話「{episode.title}」のネーム</h1>
        <p className="lead">コマ割り・セリフを確認します。違和感があるコマは編集してから作画へ進んでください。</p>
      </div>

      <WorkflowStepper projectId={projectId} episode={episode} current="panels" />

      {error && <div className="error-box">{error}</div>}
      {busy && <BusyOverlay label={busy} />}

      {episode.panels.length === 0 ? (
        <div className="empty-state">
          <div className="big">✏️</div>
          まだネームがありません。
          <div style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy !== null}
              onClick={() => run('ネーム生成', async () => {
                await api.generatePanels(episodeId);
                reload();
              })}
            >
              ネームを生成
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="card">
            <div className="card-head">
              <h3>ページプレビュー</h3>
              <button className="ghost sm" disabled={busy !== null}
                onClick={() => run('ネームの再生成', async () => {
                  await api.generatePanels(episodeId);
                  reload();
                })}
              >
                ネームを再生成
              </button>
            </div>
            <PageViewer panels={episode.panels} rules={project.panelRules} />
          </div>

          <h2>コマ一覧（{episode.panels.length}コマ）</h2>
          {episode.panels.map((p) => (
            <div className="card" key={p.id}>
              <div className="row between" style={{ alignItems: 'flex-start' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row tight">
                    <span className="badge">P{p.layout.page}-{p.index + 1}</span>
                    {p.characterIds.length > 0 && (
                      <span className="badge neutral">
                        {p.characterIds
                          .map((id) => characters?.find((c) => c.id === id)?.name ?? `#${id}`)
                          .join('・')}
                      </span>
                    )}
                    {p.backgroundId && (
                      <span className="badge neutral">
                        📍{backgrounds?.find((b) => b.id === p.backgroundId)?.name ?? `#${p.backgroundId}`}
                      </span>
                    )}
                  </div>
                  <div style={{ marginTop: 6 }}>{p.description}</div>
                  <div className="muted">
                    {p.dialogues.map((d, i) => <div key={i}>【{d.speaker}】{d.text}</div>)}
                  </div>
                </div>
                <button className="sm" onClick={() => setEditing(editing?.id === p.id ? null : p)}>
                  {editing?.id === p.id ? '閉じる' : '編集'}
                </button>
              </div>
              {editing?.id === p.id && (
                <PanelEditor
                  panel={editing}
                  backgrounds={backgrounds ?? []}
                  onChange={setEditing}
                  onSave={() => run('コマの保存', async () => {
                    await api.updatePanel(editing.id, editing);
                    setEditing(null);
                    reload();
                  })}
                />
              )}
            </div>
          ))}

          <div className="card accent">
            <h3>次のステップ: 作画</h3>
            <p className="muted">
              コマごとの画像を Replicate で生成します。キャラ・背景に参照画像やLoRAが設定されていれば自動で使われます。
            </p>
            <button className="primary"
              onClick={() => navigate(`/projects/${projectId}/episodes/${episodeId}/art`)}
            >
              作画ステップへ進む
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function PanelEditor({
  panel, backgrounds, onChange, onSave,
}: {
  panel: Panel;
  backgrounds: Background[];
  onChange: (p: Panel) => void;
  onSave: () => void;
}) {
  const setDialogue = (i: number, p: Partial<Dialogue>) =>
    onChange({ ...panel, dialogues: panel.dialogues.map((d, j) => (j === i ? { ...d, ...p } : d)) });

  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <div className="grid2">
        <div>
          <label>情景・構図の説明</label>
          <textarea rows={3} value={panel.description}
            onChange={(e) => onChange({ ...panel, description: e.target.value })} />
        </div>
        <div>
          <label>画像生成プロンプト（英語）</label>
          <textarea rows={3} value={panel.imagePrompt}
            onChange={(e) => onChange({ ...panel, imagePrompt: e.target.value })} />
        </div>
      </div>

      <label>背景（一貫性アセット） <span className="hint">／ 指定すると同じ場所が同じ絵で描かれます</span></label>
      <select
        value={panel.backgroundId ?? ''}
        onChange={(e) => onChange({ ...panel, backgroundId: e.target.value ? Number(e.target.value) : null })}
      >
        <option value="">指定なし</option>
        {backgrounds.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}{b.refImageUrl ? '（参照画像あり）' : ''}
          </option>
        ))}
      </select>

      <label>セリフ</label>
      {panel.dialogues.map((d, i) => (
        <div className="row" key={i} style={{ marginBottom: 6 }}>
          <input style={{ width: 120 }} value={d.speaker}
            onChange={(e) => setDialogue(i, { speaker: e.target.value })} />
          <input style={{ flex: 1, minWidth: 160 }} value={d.text}
            onChange={(e) => setDialogue(i, { text: e.target.value })} />
          <select style={{ width: 120 }} value={d.kind}
            onChange={(e) => setDialogue(i, { kind: e.target.value as Dialogue['kind'] })}>
            <option value="speech">セリフ</option>
            <option value="thought">心の声</option>
            <option value="narration">ナレーション</option>
            <option value="sfx">効果音</option>
          </select>
          <button className="danger sm"
            onClick={() => onChange({ ...panel, dialogues: panel.dialogues.filter((_, j) => j !== i) })}>
            ×
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button className="sm" onClick={() => onChange({
          ...panel, dialogues: [...panel.dialogues, { speaker: '', text: '', kind: 'speech' }],
        })}>
          セリフを追加
        </button>
        <button className="primary sm" onClick={onSave}>保存</button>
      </div>
    </div>
  );
}
