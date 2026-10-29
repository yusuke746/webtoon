import { useEffect, useRef, useState } from 'react';
import type { Episode, Panel, PanelRules } from '@manga/shared';
import { DEFAULT_STRIP_OPTIONS, LINE_MANGA_COVERS, LINE_MANGA_PRESET, downloadFiles, encodeCanvas, encodeStrip, renderCover, renderStrip, type ExportFile, type StripOptions } from '../export/strip';

/**
 * 縦長 1 枚画像（投稿用ストリップ）の書き出し UI。リーダーの上部に置く。
 * 幅・分割・タイトルの有無を選び、ブラウザ内で合成して PNG をダウンロードする。
 */
export function StripExport({ episode, panels, rules }: { episode: Episode; panels: Panel[]; rules: PanelRules }) {
  const [open, setOpen] = useState(false);
  const [opt, setOpt] = useState<StripOptions>(() => {
    try { return { ...DEFAULT_STRIP_OPTIONS, ...JSON.parse(localStorage.getItem('reader:export') ?? '{}') }; } catch { return DEFAULT_STRIP_OPTIONS; }
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [covers, setCovers] = useState(true);
  const ref = useRef<HTMLDivElement>(null);
  const isLine = opt.preset === 'line';

  useEffect(() => { try { localStorage.setItem('reader:export', JSON.stringify(opt)); } catch { /* 保存できなくても動く */ } }, [opt]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const run = async () => {
    setBusy('準備しています…');
    setError(null);
    setResult(null);
    try {
      const canvases = await renderStrip(episode, panels, rules, opt, (d, t) => setBusy(`画像を読み込んでいます… ${d}/${t}`));
      setBusy('書き出しています…');
      // ファイル名は ASCII に限る（日本語名はブラウザや OS によって落ちる）
      const base = `episode-${String(episode.number).padStart(2, '0')}`;
      const files: ExportFile[] = await encodeStrip(canvases, base, opt.format, opt.maxBytes);
      if (isLine && covers) {
        // 話の表紙・作品表紙は、最初の作画済みコマから切り抜く（500KB 以内）
        const specs = [
          { key: 'episode-cover', ...LINE_MANGA_COVERS.episode },
          { key: 'work-cover-portrait', ...LINE_MANGA_COVERS.workPortrait },
          { key: 'work-cover-landscape', ...LINE_MANGA_COVERS.workLandscape },
        ];
        for (const sp of specs) {
          const c = await renderCover(panels, rules, sp.w, sp.h);
          if (!c) continue;
          const { blob, ext, quality } = await encodeCanvas(c, 'jpeg', 500 * 1024);
          files.push({ name: `${base}_${sp.key}.${ext}`, blob, width: sp.w, height: sp.h, quality });
        }
      }
      await downloadFiles(files);
      const strips = files.filter((f) => !f.name.includes('cover'));
      const total = strips.reduce((s, f) => s + f.height, 0);
      const biggest = Math.max(...files.map((f) => f.blob.size));
      const over = opt.maxBytes ? files.filter((f) => f.blob.size > opt.maxBytes).length : 0;
      setResult(`${strips.length} 枚（幅 ${opt.width}px、合計の高さ ${total}px、最大 ${(biggest / 1024 / 1024).toFixed(2)}MB）${files.length > strips.length ? ` + 表紙 ${files.length - strips.length} 枚` : ''}を書き出しました${over ? `。${over} 枚が容量の上限を超えています` : ''}`);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="strip-export" ref={ref}>
      <button className={`reader-btn ${open ? 'active' : ''}`} onClick={() => setOpen((v) => !v)} disabled={!panels.length}>画像で書き出す</button>
      {open && (
        <div className="strip-export-pop" onClick={(e) => e.stopPropagation()}>
          <div className="strip-export-title">縦長画像で書き出す</div>
          <label><span>投稿先</span>
            <select value={opt.preset} onChange={(e) => setOpt(e.target.value === 'line' ? { ...opt, ...LINE_MANGA_PRESET } : { ...opt, preset: 'custom', maxBytes: 0, minSliceHeight: 0 })} disabled={!!busy}>
              <option value="custom">指定なし（自分で決める）</option>
              <option value="line">LINE マンガ インディーズ（縦読み）</option>
            </select>
          </label>
          {isLine && (
            <div className="strip-export-spec">
              幅 800px / 1 枚の高さ 1200px（最後は 600px 以上に余白）/ JPEG で 1 枚 2MB 以内 / 最大 1000 枚。
              許容は横 400〜10000px・縦 600〜10000px。
            </div>
          )}
          <label><span>幅</span>
            <select value={opt.width} onChange={(e) => setOpt({ ...opt, width: Number(e.target.value) })} disabled={!!busy}>
              <option value={800}>800px（投稿サイトの標準）</option>
              <option value={690}>690px</option>
              <option value={1080}>1080px</option>
              <option value={1600}>1600px（高解像度）</option>
            </select>
          </label>
          <label><span>分割</span>
            <select value={opt.splitHeight} onChange={(e) => setOpt({ ...opt, splitHeight: Number(e.target.value) })} disabled={!!busy}>
              <option value={0}>しない（1 枚。長すぎれば自動で分割）</option>
              <option value={1200}>高さ 1200px ごと（LINE マンガ）</option>
              <option value={1280}>高さ 1280px ごと（Webtoon）</option>
              <option value={2000}>高さ 2000px ごと</option>
              <option value={4000}>高さ 4000px ごと</option>
            </select>
          </label>
          <label><span>形式</span>
            <select value={opt.format} onChange={(e) => setOpt({ ...opt, format: e.target.value as 'png' | 'jpeg' })} disabled={!!busy}>
              <option value="png">PNG（容量の上限があれば超えたときだけ JPEG）</option>
              <option value="jpeg">JPEG（容量を抑える）</option>
            </select>
          </label>
          {isLine && (
            <label className="check"><input type="checkbox" checked={covers} onChange={(e) => setCovers(e.target.checked)} disabled={!!busy} /><span>表紙も書き出す（話 284×180 / 作品 240×348・348×220）</span></label>
          )}
          <label><span>コマの間隔</span>
            <select value={opt.gap} onChange={(e) => setOpt({ ...opt, gap: Number(e.target.value) })} disabled={!!busy}>
              <option value={16}>狭い</option>
              <option value={32}>標準</option>
              <option value={64}>広い</option>
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={opt.title} onChange={(e) => setOpt({ ...opt, title: e.target.checked })} disabled={!!busy} /><span>先頭に話のタイトルを入れる</span></label>
          <label><span>背景</span>
            <input type="color" value={opt.background} onChange={(e) => setOpt({ ...opt, background: e.target.value })} disabled={!!busy} />
          </label>
          <div className="row tight" style={{ marginTop: 8 }}>
            <button className="reader-link primary" onClick={run} disabled={!!busy}>{busy ?? (isLine ? 'LINE マンガ用に書き出す' : opt.format === 'jpeg' ? 'JPEG を書き出す' : 'PNG を書き出す')}</button>
            <button className="reader-link" onClick={() => setOpen(false)} disabled={!!busy}>閉じる</button>
          </div>
          {error && <div className="strip-export-msg error">{error}</div>}
          {result && <div className="strip-export-msg">{result}</div>}
          <div className="strip-export-note">吹き出しは画像に焼き込まれます。未作画のコマは説明文の枠になります。</div>
        </div>
      )}
    </div>
  );
}
