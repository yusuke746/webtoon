import type { DesignProposal, Episode, PanelRules } from '@manga/shared';
import { FallbackImage } from '../components/PageViewer';
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
  const checked = episode.panels.filter((p) => p.checkStatus === 'pass' || p.checkStatus === 'fail');
  const fails = episode.panels.filter((p) => p.checkStatus === 'fail');
  return (
    <div>
      <h4>
        第{episode.number}話「{episode.title}」 {episode.panels.length}コマ
        {checked.length > 0 && (
          <span className={`muted`} style={{ marginLeft: 10, fontWeight: 500 }}>
            設定担当のチェック: {checked.length - fails.length}/{checked.length} OK{fails.length ? `、${fails.length}コマに指摘` : ''}
          </span>
        )}
      </h4>
      <div className="pages">
        <PageViewer panels={episode.panels} rules={rules} />
        <div className="dialogues">
          {episode.panels.map((p) => (
            <div key={p.id}>
              <strong>P{p.layout.page}-{p.index + 1}</strong> {p.description}
              {p.checkStatus === 'pass' && <span className="badge ok" style={{ marginLeft: 6 }}>監修OK</span>}
              {p.checkStatus === 'fail' && <span className="badge danger" style={{ marginLeft: 6 }}>要確認</span>}
              {p.checkStatus === 'fail' && p.checkNotes && <div className="check-notes">{p.checkNotes}</div>}
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

/** 設定画の提案（キャラごとのおすすめ1枚 + 理由 + 他の候補） */
export function DesignView({ proposals }: { proposals: DesignProposal[] }) {
  const pending = proposals.filter((d) => !d.adopted && d.top);
  const done = proposals.filter((d) => d.adopted);
  const kind = proposals[0]?.kind ?? 'character';
  const unit = kind === 'character' ? '人' : '件';
  return (
    <div>
      <h4>{kind === 'character' ? '設定画' : '背景の設定画'}の候補 {pending.length} {unit}分{done.length ? <span className="muted" style={{ marginLeft: 8, fontWeight: 500 }}>（採用済み {done.length} {unit}）</span> : null}</h4>
      <div className={`design-grid ${kind}`}>
        {pending.map((d) => (
          <div key={d.owner.id} className="design-card">
            <div className="design-top">
              <FallbackImage src={d.top!.url} alt={d.owner.name} />
              <span className="badge ok">おすすめ</span>
            </div>
            <div className="design-meta">
              <strong>{d.owner.name}</strong> <span className="muted">{d.owner.subtitle}</span>
              {d.top!.note && <div className="design-note">{d.top!.note}</div>}
              <div className="design-thumbs">
                {d.candidates.filter((c) => c.id !== d.top!.id).slice(0, 3).map((c) => (
                  <FallbackImage key={c.id} src={c.url} alt={`${d.owner.name} 候補${c.rank ?? ''}`} />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** 1人分の候補を番号付きで並べる（別の候補を選ぶとき） */
export function DesignAltView({ proposal }: { proposal: DesignProposal }) {
  return (
    <div>
      <h4>{proposal.owner.name} の候補</h4>
      <div className={`design-alt ${proposal.kind}`}>
        {proposal.candidates.map((c, i) => (
          <div key={c.id} className={`design-alt-item ${c.rank === 1 ? 'best' : ''}`}>
            <FallbackImage src={c.url} alt={`候補${i + 1}`} />
            <div>候補{i + 1}{c.rank === 1 ? '（おすすめ）' : c.rank ? `（${c.rank}位）` : ''}</div>
          </div>
        ))}
      </div>
      {proposal.top?.note && <div className="design-note">{proposal.top.note}</div>}
    </div>
  );
}

/** 拾い出した場所の一覧 */
export function LocationsView({ backgrounds }: { backgrounds: { id: number; name: string; description?: string; refImageUrl: string | null }[] }) {
  return (
    <div>
      <h4>登録されている場所 {backgrounds.length} 件</h4>
      <ol>
        {backgrounds.map((b) => (
          <li key={b.id}><strong>{b.name}</strong>{b.description ? ` — ${b.description}` : ''} <span className="muted">{b.refImageUrl ? '（設定画あり）' : '（設定画なし）'}</span></li>
        ))}
      </ol>
    </div>
  );
}
