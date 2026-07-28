import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ArtStyle, PanelRules, StoryTemplate } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch } from '../hooks';

/** カスタマイズ: 画風 / コマ割りルール / ストーリー構成テンプレートの上書き（拡張2） */
export function SettingsPage() {
  const projectId = Number(useParams().projectId);
  const { data: project, reload } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: artStyles, reload: reloadStyles } = useFetch(() => api.listArtStyles(projectId), [projectId]);
  const { busy, error, run } = useAction();

  const [rules, setRules] = useState<PanelRules | null>(null);
  const [template, setTemplate] = useState<StoryTemplate | null>(null);
  const [newStyle, setNewStyle] = useState<Partial<ArtStyle> | null>(null);

  useEffect(() => {
    if (project) {
      setRules(project.panelRules);
      setTemplate(project.storyTemplate);
    }
  }, [project]);

  if (!project || !rules || !template) return <p className="muted">読み込み中…</p>;

  return (
    <div>
      <h1>カスタマイズ</h1>
      {error && <div className="error-box">{error}</div>}
      {busy && <p className="spinner-note">⏳ {busy} を実行中…</p>}

      <div className="grid2">
        <div className="card">
          <h3>コマ割りルール</h3>
          <label>1ページの最大コマ数</label>
          <input
            type="number" min={1} max={12}
            value={rules.maxPanelsPerPage}
            onChange={(e) => setRules({ ...rules, maxPanelsPerPage: Number(e.target.value) })}
          />
          <div className="grid2">
            <div>
              <label>グリッド列数</label>
              <input
                type="number" min={2} max={8}
                value={rules.gridCols}
                onChange={(e) => setRules({ ...rules, gridCols: Number(e.target.value) })}
              />
            </div>
            <div>
              <label>グリッド行数</label>
              <input
                type="number" min={2} max={12}
                value={rules.gridRows}
                onChange={(e) => setRules({ ...rules, gridRows: Number(e.target.value) })}
              />
            </div>
          </div>
          <label>読み方向</label>
          <select
            value={rules.readingDirection}
            onChange={(e) => setRules({ ...rules, readingDirection: e.target.value as PanelRules['readingDirection'] })}
          >
            <option value="rtl">右から左（日本式）</option>
            <option value="ltr">左から右</option>
            <option value="vertical">縦スクロール（Webtoon）</option>
          </select>
          <label>追加ルール（自由記述。ネーム生成プロンプトに反映）</label>
          <textarea
            rows={3}
            value={rules.customRules}
            onChange={(e) => setRules({ ...rules, customRules: e.target.value })}
            placeholder="例: 1話に1回は見開きの大ゴマを入れる。アクションシーンは斜めコマを多用する。"
          />
        </div>

        <div className="card">
          <h3>ストーリー構成テンプレート</h3>
          <label>構成の型</label>
          <select
            value={template.name}
            onChange={(e) => setTemplate({ ...template, name: e.target.value })}
          >
            <option value="起承転結">起承転結</option>
            <option value="三幕構成">三幕構成</option>
            <option value="序破急">序破急</option>
            <option value="カスタム">カスタム（下の指示で定義）</option>
          </select>
          <label>1話あたりの目安ページ数</label>
          <input
            type="number" min={1} max={60}
            value={template.pagesPerEpisode}
            onChange={(e) => setTemplate({ ...template, pagesPerEpisode: Number(e.target.value) })}
          />
          <label>構成への指示（自由記述。構成生成プロンプトに反映）</label>
          <textarea
            rows={5}
            value={template.instructions}
            onChange={(e) => setTemplate({ ...template, instructions: e.target.value })}
            placeholder="例: 各話の最後に次話への引きを作る。ギャグとシリアスを交互に。"
          />
        </div>
      </div>

      <button
        className="primary"
        disabled={busy !== null}
        onClick={() => run('設定の保存', async () => {
          await api.updateProject(projectId, { panelRules: rules, storyTemplate: template });
          reload();
        })}
      >
        コマ割り・構成設定を保存
      </button>

      <h2>画風</h2>
      <p className="muted">
        作画に使う Replicate モデル・スタイルプロンプト・LoRA を定義し、作品に適用します。
        適用中の画風は全コマの作画に使われます。
      </p>
      {artStyles?.map((s) => (
        <div className="card" key={s.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <strong>{s.name}</strong>{' '}
              {project.artStyleId === s.id && <span className="badge ok">適用中</span>}
              <div className="muted">モデル: {s.model}{s.loraUrl ? ` ／ LoRA: ${s.loraUrl}` : ''}</div>
              <div className="muted">スタイル: {s.stylePrompt || '未設定'}</div>
            </div>
            <div className="row" style={{ flexShrink: 0 }}>
              {project.artStyleId !== s.id && (
                <button
                  onClick={() => run('画風の適用', async () => {
                    await api.updateProject(projectId, { artStyleId: s.id });
                    reload();
                  })}
                >
                  この画風を適用
                </button>
              )}
              <button onClick={() => run('ライブラリへ保存', () => api.saveAsset('art_style', s.id))}>
                ライブラリへ保存
              </button>
            </div>
          </div>
        </div>
      ))}

      {newStyle ? (
        <div className="card" style={{ borderColor: 'var(--accent)' }}>
          <h3>新規画風</h3>
          <label>名前</label>
          <input value={newStyle.name ?? ''} onChange={(e) => setNewStyle({ ...newStyle, name: e.target.value })} />
          <label>Replicate モデル（owner/name）</label>
          <input
            value={newStyle.model ?? 'black-forest-labs/flux-schnell'}
            onChange={(e) => setNewStyle({ ...newStyle, model: e.target.value })}
          />
          <label>スタイルプロンプト（全コマに付与）</label>
          <textarea
            rows={2}
            value={newStyle.stylePrompt ?? ''}
            onChange={(e) => setNewStyle({ ...newStyle, stylePrompt: e.target.value })}
            placeholder="例: black and white manga style, screentone shading, high contrast ink"
          />
          <label>LoRA URL（任意）</label>
          <input
            value={newStyle.loraUrl ?? ''}
            onChange={(e) => setNewStyle({ ...newStyle, loraUrl: e.target.value || null })}
          />
          <div className="row" style={{ marginTop: 10 }}>
            <button
              className="primary"
              disabled={!newStyle.name?.trim()}
              onClick={() => run('画風の作成', async () => {
                await api.createArtStyle(projectId, newStyle);
                setNewStyle(null);
                reloadStyles();
              })}
            >
              作成
            </button>
            <button onClick={() => setNewStyle(null)}>キャンセル</button>
          </div>
        </div>
      ) : (
        <button onClick={() => setNewStyle({})}>画風を追加</button>
      )}
    </div>
  );
}
