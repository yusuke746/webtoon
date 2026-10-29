import { useCallback, useEffect, useState } from 'react';
import type { DesignProposal, Episode, OfficeArt, PanelRules, RefImage } from '@manga/shared';
import { api } from '../api';
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

/**
 * ロケハン写真の持ち込み。自分で撮った写真を場所に添付する（会話ウィンドウ内で操作する成果物）。
 * 添付した写真は「背景の設定画づくり」で、構図を保ったまま画風に合わせて背景に起こされる。
 */
export function PhotosView({ backgrounds, onChanged }: {
  backgrounds: { id: number; name: string; refImageUrl: string | null }[];
  onChanged?: (backgroundId: number, photoCount: number, adopted: boolean) => void;
}) {
  const [bgId, setBgId] = useState<number>(backgrounds.find((b) => !b.refImageUrl)?.id ?? backgrounds[0]?.id ?? 0);
  const [photos, setPhotos] = useState<RefImage[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bg = backgrounds.find((b) => b.id === bgId) ?? null;

  const load = useCallback(async (id: number) => {
    const list = (await api.listRefImages('background', id)).filter((r) => r.role === 'photo');
    setPhotos(list);
    const b = backgrounds.find((x) => x.id === id);
    onChanged?.(id, list.length, !!b?.refImageUrl);
  }, [backgrounds, onChanged]);
  useEffect(() => { if (bgId) load(bgId).catch((e: Error) => setError(e.message)); }, [bgId, load]);

  const onFiles = async (files: FileList | null) => {
    const list = Array.from(files ?? []); // FileList は input のリセットで空になるので先に写す
    if (!list.length || !bgId) return;
    setError(null);
    try {
      const urls: string[] = [];
      for (let i = 0; i < list.length; i++) {
        setBusy(`${i + 1} / ${list.length} 枚目を受け取っています…`);
        urls.push((await api.uploadImage(list[i])).url);
      }
      await api.attachBackgroundPhotos(bgId, urls);
      await load(bgId);
    } catch (e) { setError((e as Error).message); } finally { setBusy(null); }
  };

  if (!backgrounds.length) return <div className="muted">場所がまだ登録されていません。先に「構成とネームから場所を拾い出してもらう」か、背景の一覧で登録してください。</div>;
  return (
    <div className="photos-view">
      <h4>ロケハン写真を渡す</h4>
      <p className="muted">自分で撮った写真を場所に添付します。設定画づくりのときに、写真の構図・建物の配置を保ったまま画風に合わせた背景に起こします。<br />
        ※ ストリートビューなど他サービスの画像は規約上使えません。自分で撮影した写真を使ってください。</p>
      <div className="row" style={{ marginBottom: 8 }}>
        <select value={bgId} onChange={(e) => setBgId(Number(e.target.value))} aria-label="場所" disabled={!!busy}>
          {backgrounds.map((b) => <option key={b.id} value={b.id}>{b.name}{b.refImageUrl ? '（設定画あり）' : ''}</option>)}
        </select>
        <label className={`file-btn ${busy ? 'disabled' : ''}`}>
          写真を選ぶ
          <input type="file" accept="image/*" multiple disabled={!!busy} onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
        </label>
      </div>
      {busy && <div className="muted">{busy}</div>}
      {error && <div className="error-box">{error}</div>}
      {bg?.refImageUrl && <div className="info-box">「{bg.name}」はもう設定画が決まっています。写真は参考資料として保管します。</div>}
      {photos.length ? (
        <div className="photo-strip">
          {photos.map((p) => <FallbackImage key={p.id} src={p.url} alt={`${bg?.name ?? ''} の写真`} />)}
        </div>
      ) : <div className="muted">{bg ? `「${bg.name}」の写真はまだありません。` : ''}</div>}
    </div>
  );
}

/** オフィスの美術の候補（下絵と描き直した絵を並べる） */
export function OfficeArtView({ candidates, adopted }: { candidates: OfficeArt[]; adopted: Record<string, string> }) {
  const pending = candidates.filter((a) => !a.adopted);
  const byFloor = new Map<string, OfficeArt[]>();
  for (const a of pending) { if (!byFloor.has(a.floorId)) byFloor.set(a.floorId, []); byFloor.get(a.floorId)!.push(a); }
  if (!pending.length) return <div className="muted">描き直した絵の候補はありません。</div>;
  return (
    <div>
      <h4>描き直したフロアの絵（採用すると、そのフロアの背景になります）</h4>
      {[...byFloor.entries()].map(([floorId, list]) => (
        <div key={floorId} className="office-art-group">
          <strong>{floorId}</strong>{adopted[floorId] && <span className="muted" style={{ marginLeft: 8 }}>（いまは別の絵を採用中）</span>}
          <div className="office-art-row">
            {list[0].sourceUrl && <figure><FallbackImage src={list[0].sourceUrl} alt="下絵" /><figcaption>いまの配置（下絵）</figcaption></figure>}
            {list.map((a, i) => (
              <figure key={a.id}><FallbackImage src={a.url} alt={`${floorId} 候補${i + 1}`} /><figcaption>候補{i + 1}</figcaption></figure>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
