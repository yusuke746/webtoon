import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../hooks';
import { PageViewer, PanelContent } from '../components/PageViewer';
import { readingOrder, stripHeightRatio } from '../reader/layout';
import { StripExport } from '../reader/StripExport';

/**
 * 縦読み（Webtoon）リーダー。1話を縦スクロールで読む。
 *
 * - 読み方向が「縦スクロール」の作品はそのまま 1 列。ページ割りの作品もコマを読み順に並べ直して縦に流す
 *   （rtl は同じ段で右→左、ltr は左→右）。「ページ表示」に切り替えればページ単位でも読める
 * - コマの高さはネームのレイアウト（グリッド比）から決める。作画のアスペクト比もこれに合わせて生成している
 * - Space / ↓ / → で 1 画面ぶん進む、↑ / ← で戻る、Esc で戻る。読んだ位置は話ごとに覚える
 */

export function ReaderPage() {
  const projectId = Number(useParams().projectId);
  const episodeId = Number(useParams().episodeId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const mode: 'strip' | 'page' = params.get('mode') === 'page' ? 'page' : 'strip';
  const back = params.get('back') || `/projects/${projectId}/office`;

  const { data: project } = useFetch(() => api.getProject(projectId), [projectId]);
  const { data: episode, error } = useFetch(() => api.getEpisode(episodeId), [episodeId]);
  const { data: episodes } = useFetch(() => api.listEpisodes(projectId), [projectId]);

  const scroller = useRef<HTMLDivElement>(null);
  const [progress, setProgress] = useState(0);
  const [showBar, setShowBar] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const rules = project?.panelRules;
  const ordered = useMemo(() => (episode && rules ? readingOrder(episode.panels, rules) : []), [episode, rules]);
  const next = useMemo(() => {
    if (!episode || !episodes) return null;
    return episodes.find((e) => e.number === episode.number + 1 && (e.status === 'paneled' || e.status === 'rendered')) ?? null;
  }, [episode, episodes]);
  const prev = useMemo(() => (episode && episodes ? episodes.find((e) => e.number === episode.number - 1) ?? null : null), [episode, episodes]);

  // 読んだ位置を覚える / 戻す
  const posKey = `reader:pos:${episodeId}:${mode}`;
  useEffect(() => {
    const el = scroller.current;
    if (!el || !ordered.length) return;
    const saved = Number(sessionStorage.getItem(posKey) ?? 0);
    if (saved > 0) el.scrollTop = saved;
  }, [ordered.length, posKey]);

  const onScroll = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    setProgress(max > 0 ? Math.min(1, el.scrollTop / max) : 1);
    sessionStorage.setItem(posKey, String(el.scrollTop));
    setShowBar(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowBar(false), 1600);
  }, [posKey]);

  const page = useCallback((dir: 1 | -1) => {
    const el = scroller.current;
    if (!el) return;
    el.scrollBy({ top: dir * el.clientHeight * 0.8, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); page(1); }
      else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); page(-1); }
      else if (e.key === 'Escape') { e.preventDefault(); navigate(back); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [page, navigate, back]);

  const setMode = (m: 'strip' | 'page') => {
    const q = new URLSearchParams(params);
    if (m === 'page') q.set('mode', 'page'); else q.delete('mode');
    setParams(q, { replace: true });
  };

  if (error) {
    return <div className="reader"><div className="reader-empty">この話を読み込めませんでした（{error}）。<br /><Link to={back}>戻る</Link></div></div>;
  }
  if (!episode || !project || !rules) return <div className="reader"><div className="reader-empty">読み込み中…</div></div>;

  const title = `第${episode.number}話「${episode.title}」`;
  const drawn = ordered.filter((p) => p.imageUrl).length;

  return (
    <div className="reader" onMouseMove={() => { setShowBar(true); if (hideTimer.current) clearTimeout(hideTimer.current); hideTimer.current = setTimeout(() => setShowBar(false), 2200); }}>
      <div className={`reader-bar ${showBar ? '' : 'hidden'}`}>
        <button className="reader-btn" onClick={() => navigate(back)} title="戻る (Esc)">← 戻る</button>
        <div className="reader-title">
          <strong>{project.title}</strong> <span>{title}</span>
          <span className="reader-count">{ordered.length} コマ{drawn < ordered.length ? `（作画 ${drawn}/${ordered.length}）` : ''}</span>
        </div>
        <div className="reader-modes">
          <button className={`reader-btn ${mode === 'strip' ? 'active' : ''}`} onClick={() => setMode('strip')}>縦読み</button>
          <button className={`reader-btn ${mode === 'page' ? 'active' : ''}`} onClick={() => setMode('page')}>ページ</button>
          <StripExport episode={episode} panels={episode.panels} rules={rules} />
        </div>
        <div className="reader-progress"><div style={{ width: `${Math.round(progress * 100)}%` }} /></div>
      </div>

      <div className="reader-scroll" ref={scroller} onScroll={onScroll}>
        {!ordered.length ? (
          <div className="reader-empty">まだネームがありません。<br /><Link to={back}>戻る</Link></div>
        ) : mode === 'strip' ? (
          <div className="strip">
            <div className="strip-head">
              <div className="strip-ep">第{episode.number}話</div>
              <div className="strip-ttl">{episode.title}</div>
            </div>
            {ordered.map((p, i) => {
              const newPage = i > 0 && (ordered[i - 1].layout.page ?? 1) !== (p.layout.page ?? 1);
              return (
                <div key={p.id} className={`strip-panel ${newPage ? 'break' : ''} ${p.imageUrl ? '' : 'undrawn'}`}
                  style={{ aspectRatio: `1 / ${stripHeightRatio(p, rules)}` }}>
                  <PanelContent panel={p} rules={rules} />
                </div>
              );
            })}
            <div className="strip-end">
              <div className="muted">— 第{episode.number}話 おわり —</div>
              <div className="row" style={{ justifyContent: 'center', marginTop: 14 }}>
                {prev && <Link className="reader-link" to={`/projects/${projectId}/episodes/${prev.id}/read?back=${encodeURIComponent(back)}`}>← 第{prev.number}話</Link>}
                <button className="reader-link" onClick={() => scroller.current?.scrollTo({ top: 0, behavior: 'smooth' })}>最初に戻る</button>
                {next
                  ? <Link className="reader-link primary" to={`/projects/${projectId}/episodes/${next.id}/read?back=${encodeURIComponent(back)}`}>第{next.number}話「{next.title}」へ →</Link>
                  : <span className="muted">次の話はまだありません</span>}
              </div>
            </div>
          </div>
        ) : (
          <div className="reader-pages">
            <PageViewer panels={episode.panels} rules={rules} />
            <div className="strip-end">
              {next && <Link className="reader-link primary" to={`/projects/${projectId}/episodes/${next.id}/read?mode=page&back=${encodeURIComponent(back)}`}>第{next.number}話へ →</Link>}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
