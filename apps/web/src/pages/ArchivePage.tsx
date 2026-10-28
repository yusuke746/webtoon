import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import type { ArchiveFile } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch, useJobTracker } from '../hooks';
import { BusyOverlay, JobStrip } from '../components/JobProgress';

/**
 * 書庫（連載アーカイブ）。
 *
 * 作品ごとの Markdown フォルダを「連載マネージャー」が管理する。
 * - 同期: DB の内容を script.md / characters / foreshadow.md へ書き出す（LLM なし）
 * - 登録: 話の要約（summary.md）を作り、bible.md の「連載メモ」を更新する（LLM）
 * - 編集: bible.md の作者メモや summary.md を直接直せる。次の生成から反映される
 */
export function ArchivePage() {
  const projectId = Number(useParams().projectId);
  const { data: info, reload } = useFetch(() => api.getArchive(projectId), [projectId]);
  const { busy, error, run } = useAction();
  const tracker = useJobTracker({ onDone: () => { reload(); if (selected) openFile(selected); } });

  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [saved, setSaved] = useState('');
  const editorRef = useRef<HTMLDivElement>(null);

  const openFile = (path: string, scroll = false) => {
    setSelected(path);
    api.readArchiveFile(projectId, path).then((r) => {
      setContent(r.content); setSaved(r.content);
      if (scroll) editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  // 初回は bible.md を開く
  useEffect(() => {
    if (info?.exists && !selected && info.files.some((f) => f.path === 'bible.md')) openFile('bible.md');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [info?.exists]);

  const dirty = content !== saved;
  const editable = !!selected && (info?.files.find((f) => f.path === selected)?.editable ?? false);

  // パスをフォルダごとにまとめて表示する
  const groups = groupFiles(info?.files ?? []);

  return (
    <div>
      <div className="page-head">
        <h1>書庫（連載アーカイブ）</h1>
        <p className="lead">
          これまでの話・設定・会議録を Markdown のフォルダとして保存します。
          連載マネージャーが各話の要約と「連載メモ」を更新し、次の話を作るときの文脈として Claude に渡します。
        </p>
      </div>

      {error && <div className="error-box">{error}</div>}
      {busy && <BusyOverlay label={busy} />}
      {tracker.job && <JobStrip job={tracker.job} onDismiss={tracker.dismiss} />}

      <div className="card">
        <div className="row between">
          <div>
            <div className="archive-path">{info?.dir ?? '…'}</div>
            <div className="muted" style={{ marginTop: 4 }}>
              {info?.exists
                ? `${info.files.length} ファイル／要約済み ${info.episodes.filter((e) => e.hasSummary).length} / ${info.episodes.length} 話`
                : 'まだ書き出されていません。「同期」で作成されます。'}
            </div>
          </div>
          <div className="row tight actions">
            <button disabled={busy !== null}
              onClick={() => run('書庫を同期', async () => { await api.syncArchive(projectId); reload(); if (selected) openFile(selected); })}>
              同期（DB → フォルダ）
            </button>
            <button className="primary" disabled={busy !== null || !info?.episodes.some((e) => e.hasSummary)}
              onClick={() => run('連載メモを更新', async () => { await api.updateArchiveNotes(projectId); reload(); if (selected === 'bible.md') openFile('bible.md'); })}>
              連載メモを更新
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>連載メモ（マネージャー更新）</h3></div>
        {info?.notes
          ? <div className="archive-notes">{info.notes}</div>
          : <p className="muted">まだありません。下の一覧から話を「書庫へ登録」すると生成されます。ネーム生成時にも自動で登録されます。</p>}
      </div>

      <div className="card">
        <div className="card-head"><h3>会議の決定事項</h3></div>
        {info?.decisions
          ? <div className="archive-notes">{info.decisions}</div>
          : <p className="muted">まだありません。4F の会議で採否を決めると、ここに結論が残り、次の話の生成や相談にも渡ります。</p>}
      </div>

      <div className="card">
        <div className="card-head"><h3>話ごとの登録状況</h3></div>
        {info?.episodes.length ? (
          <table>
            <thead><tr><th>話</th><th>状態</th><th>要約</th><th></th></tr></thead>
            <tbody>
              {info.episodes.map((e) => (
                <tr key={e.episodeId}>
                  <td className="nowrap"><strong>第{e.number}話</strong> {e.title}</td>
                  <td className="nowrap"><span className="badge">{e.status}</span></td>
                  <td className="muted">
                    {e.hasSummary ? `登録済み（${new Date(e.summaryUpdatedAt!).toLocaleString('ja-JP')}）` : '未登録'}
                  </td>
                  <td className="nowrap">
                    <button className="sm" disabled={tracker.running || busy !== null}
                      onClick={async () => tracker.track(await api.registerEpisodeToArchive(e.episodeId))}>
                      {e.hasSummary ? '再登録' : '書庫へ登録'}
                    </button>{' '}
                    {e.hasSummary && (
                      <button className="ghost sm" onClick={() => openFile(`episodes/${String(e.number).padStart(2, '0')}/summary.md`, true)}>
                        要約を見る
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <p className="muted">話がまだありません。先に構成を生成してください。</p>}
      </div>

      {info?.exists && (
        <div className="archive-layout">
          <div className="card file-tree">
            {Object.entries(groups).map(([dir, files]) => (
              <div key={dir}>
                <div className="dir">{dir || '/'}</div>
                {files.map((f) => (
                  <button key={f.path} className={selected === f.path ? 'active' : ''} onClick={() => openFile(f.path)}>
                    {f.path.split('/').pop()}
                    <span className="sz">{formatSize(f.size)}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div className="card archive-editor" ref={editorRef}>
            {selected ? (
              <>
                <div className="row between" style={{ marginBottom: 8 }}>
                  <div className="archive-path">{selected}{dirty ? '（未保存）' : ''}</div>
                  {editable && (
                    <button className="primary sm" disabled={!dirty || busy !== null}
                      onClick={() => run('保存', async () => { await api.writeArchiveFile(projectId, selected, content); setSaved(content); reload(); })}>
                      保存
                    </button>
                  )}
                </div>
                {editable
                  ? <textarea value={content} onChange={(e) => setContent(e.target.value)} spellCheck={false} />
                  : <p className="muted">このファイルは画像などの非テキストです。</p>}
                {selected === 'bible.md' && (
                  <p className="muted" style={{ marginTop: 8 }}>
                    「auto」マーカーの中はアプリ側の設定から再生成されます。「作者メモ」は自由に書けて、次の生成から Claude に渡されます。
                  </p>
                )}
              </>
            ) : <p className="muted">左のファイルを選ぶと内容を表示します。</p>}
          </div>
        </div>
      )}
    </div>
  );
}

function groupFiles(files: ArchiveFile[]): Record<string, ArchiveFile[]> {
  const out: Record<string, ArchiveFile[]> = {};
  for (const f of files) {
    const dir = f.path.includes('/') ? f.path.slice(0, f.path.lastIndexOf('/')) : '';
    (out[dir] ??= []).push(f);
  }
  return out;
}

function formatSize(n: number): string {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}
