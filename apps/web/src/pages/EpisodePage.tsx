import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Dialogue, Panel } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';
import { PageViewer } from '../components/PageViewer';

/** エピソード詳細: シーン編集 → ネーム生成 → 手動編集 → 作画 のループ */
export function EpisodePage() {
  const projectId = Number(useParams().projectId);
  const episodeId = Number(useParams().episodeId);
  const { data: project } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: episode, reload } = useFetch(() => api.getEpisode(episodeId), [episodeId]);
  const { data: health } = useFetch(() => api.health(), []);
  const { busy, error, run } = useAction();
  const [editingPanel, setEditingPanel] = useState<Panel | null>(null);

  if (!episode || !project) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <p><Link to={`/projects/${projectId}`}>← ダッシュボード</Link></p>
      <h1>第{episode.number}話「{episode.title}」</h1>
      {health?.imageClient === 'mock' && (
        <div className="warning-item">
          現在<strong>モック作画</strong>（プレースホルダ画像）で動作しています。画風は反映されません。
          環境変数 <code>REPLICATE_API_TOKEN</code> を設定してサーバーを再起動すると、設定した画風で実際に作画されます。
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      {busy && <p className="spinner-note">⏳ {busy} を実行中…</p>}

      <div className="card">
        <h3>シーン構成</h3>
        <table>
          <tbody>
            {episode.scenes.map((s, i) => (
              <tr key={i}>
                <td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{s.title}</td>
                <td>
                  {s.summary}
                  <div className="muted">
                    登場: {s.characters.join('・') || 'なし'}
                    {s.foreshadowRefs?.length > 0 && (
                      <> ／ 伏線: {s.foreshadowRefs.map((f) => `${f.title}(${f.action === 'setup' ? '導入' : '回収'})`).join('、')}</>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="row" style={{ marginTop: 10 }}>
          <button
            className="primary"
            disabled={busy !== null}
            onClick={() => run('ネーム（コマ割り・セリフ）生成', async () => {
              await api.generatePanels(episodeId);
              reload();
            })}
          >
            {episode.panels.length ? 'ネームを再生成' : 'ネームを生成'}
          </button>
          {episode.panels.length > 0 && (
            <button
              disabled={busy !== null}
              onClick={() => run('全コマの作画', async () => {
                await api.generateEpisodeImages(episodeId);
                reload();
              })}
            >
              未作画コマを一括作画
            </button>
          )}
        </div>
        <p className="muted">
          ネーム生成時は「ネーム演出担当」「読者代表」のAIが自動で批評→改稿を行います
          （回数は<Link to={`/projects/${projectId}/settings`}>カスタマイズ</Link>で変更可。
          批評ログは<Link to={`/projects/${projectId}/discussions`}>AI編集会議</Link>に保存されます）。
          {episode.panels.length > 0 && ' 再生成は既存のコマ（手動編集含む）を置き換えます。'}
        </p>
      </div>

      {episode.panels.length > 0 && (
        <>
          <h2>ページプレビュー</h2>
          <PageViewer panels={episode.panels} rules={project.panelRules} />

          <h2>コマ一覧（クリックで編集）</h2>
          {episode.panels.map((p) => (
            <div className="card" key={p.id}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div style={{ flex: 1 }}>
                  <span className="badge">P{p.layout.page}-{p.index + 1}</span>{' '}
                  <span className={`badge ${p.status === 'done' ? 'ok' : p.status === 'error' ? 'danger' : ''}`}>
                    {{ draft: '未作画', generating: '作画中', done: '作画済み', error: 'エラー' }[p.status]}
                  </span>
                  <div style={{ marginTop: 6 }}>{p.description}</div>
                  <div className="muted">
                    {p.dialogues.map((d, i) => <div key={i}>【{d.speaker}】{d.text}</div>)}
                  </div>
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  <button onClick={() => setEditingPanel(editingPanel?.id === p.id ? null : p)}>
                    {editingPanel?.id === p.id ? '閉じる' : '編集'}
                  </button>
                  <button
                    disabled={busy !== null}
                    onClick={() => run(`コマ P${p.layout.page}-${p.index + 1} の作画`, async () => {
                      await api.generatePanelImage(p.id);
                      reload();
                    })}
                  >
                    {p.imageUrl ? '再作画' : '作画'}
                  </button>
                </div>
              </div>
              {editingPanel?.id === p.id && (
                <PanelEditor
                  panel={editingPanel}
                  onChange={setEditingPanel}
                  onSave={() => run('コマの保存', async () => {
                    await api.updatePanel(editingPanel.id, editingPanel);
                    setEditingPanel(null);
                    reload();
                  })}
                />
              )}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function PanelEditor({
  panel, onChange, onSave,
}: {
  panel: Panel;
  onChange: (p: Panel) => void;
  onSave: () => void;
}) {
  const setDialogue = (i: number, patch: Partial<Dialogue>) => {
    const dialogues = panel.dialogues.map((d, j) => (j === i ? { ...d, ...patch } : d));
    onChange({ ...panel, dialogues });
  };
  return (
    <div style={{ marginTop: 12, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
      <label>情景・構図の説明</label>
      <textarea
        rows={2}
        value={panel.description}
        onChange={(e) => onChange({ ...panel, description: e.target.value })}
      />
      <label>画像生成プロンプト（英語）</label>
      <textarea
        rows={2}
        value={panel.imagePrompt}
        onChange={(e) => onChange({ ...panel, imagePrompt: e.target.value })}
      />
      <label>セリフ</label>
      {panel.dialogues.map((d, i) => (
        <div className="row" key={i} style={{ marginBottom: 6 }}>
          <input
            style={{ width: 120 }}
            value={d.speaker}
            onChange={(e) => setDialogue(i, { speaker: e.target.value })}
          />
          <input
            style={{ flex: 1 }}
            value={d.text}
            onChange={(e) => setDialogue(i, { text: e.target.value })}
          />
          <select
            style={{ width: 110 }}
            value={d.kind}
            onChange={(e) => setDialogue(i, { kind: e.target.value as Dialogue['kind'] })}
          >
            <option value="speech">セリフ</option>
            <option value="thought">心の声</option>
            <option value="narration">ナレーション</option>
            <option value="sfx">効果音</option>
          </select>
          <select
            style={{ width: 90 }}
            value={d.position ?? ''}
            onChange={(e) => setDialogue(i, { position: (e.target.value || undefined) as Dialogue['position'] })}
          >
            <option value="">位置: 自動</option>
            <option value="top-right">右上</option>
            <option value="top-left">左上</option>
            <option value="middle-right">右中</option>
            <option value="middle-left">左中</option>
            <option value="bottom-right">右下</option>
            <option value="bottom-left">左下</option>
          </select>
          <button
            className="danger"
            onClick={() => onChange({ ...panel, dialogues: panel.dialogues.filter((_, j) => j !== i) })}
          >
            ×
          </button>
        </div>
      ))}
      <div className="row" style={{ marginTop: 8 }}>
        <button
          onClick={() => onChange({
            ...panel,
            dialogues: [...panel.dialogues, { speaker: '', text: '', kind: 'speech' }],
          })}
        >
          セリフを追加
        </button>
        <button className="primary" onClick={onSave}>保存</button>
      </div>
    </div>
  );
}
