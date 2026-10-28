import type { Episode, PanelRules } from '@manga/shared';
import type { EpisodeWithPanels } from '../api';
import { PageViewer } from '../components/PageViewer';

/** 会話ウィンドウの中に出す成果物（NPC が持ってきた「原稿」） */

export function ScenesView({ episode }: { episode: Episode }) {
  return (
    <div>
      <h4>第{episode.number}話「{episode.title}」</h4>
      <div className="muted" style={{ marginBottom: 8 }}>{episode.summary}</div>
      <ol>
        {episode.scenes.map((s, i) => (
          <li key={i}>
            <strong>{s.title}</strong> — {s.summary}
            <span className="muted">（登場: {s.characters.join('・') || 'なし'}
              {s.foreshadowRefs?.length ? ` / 伏線: ${s.foreshadowRefs.map((r) => `${r.title}(${r.action === 'setup' ? '導入' : '回収'})`).join('、')}` : ''}）</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PagesView({ episode, rules }: { episode: EpisodeWithPanels; rules: PanelRules }) {
  return (
    <div>
      <h4>第{episode.number}話「{episode.title}」 {episode.panels.length}コマ</h4>
      <div className="pages">
        <PageViewer panels={episode.panels} rules={rules} />
        <div className="dialogues">
          {episode.panels.map((p) => (
            <div key={p.id}>
              <strong>P{p.layout.page}-{p.index + 1}</strong> {p.description}
              {p.dialogues.map((d, i) => <div key={i} className="muted">　【{d.speaker}】{d.text}</div>)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function EpisodesView({ episodes, title }: { episodes: Episode[]; title: string }) {
  return (
    <div>
      <h4>{title}</h4>
      <ol start={episodes[0]?.number ?? 1}>
        {episodes.map((e) => (
          <li key={e.id}>
            <strong>「{e.title}」</strong> — {e.summary}
            <div className="muted">{e.scenes.map((s) => s.title).join(' → ')}</div>
          </li>
        ))}
      </ol>
    </div>
  );
}
