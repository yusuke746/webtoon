import { useState } from 'react';
import type { Job, RefImageKind } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch, useJobTracker } from '../hooks';
import { JobStrip } from './JobProgress';

/**
 * 参照画像スタジオ。
 *
 * 「参照画像URL を手入力する欄しかない」状態を解消するためのコンポーネント。
 * Replicate で候補を複数枚生成し、その中から1枚を «採用» すると
 * 対象（キャラ / 背景）の refImageUrl に自動で入る。
 *
 * キャラ・背景・画風のどれにも使えるよう kind + ownerId で汎用化している。
 */
export function RefImageStudio({
  projectId,
  kind,
  ownerId,
  ownerName,
  /** 対象の設定文（プロンプト生成の元）。空なら警告を出す */
  description,
  onAdopted,
}: {
  projectId: number;
  kind: RefImageKind;
  ownerId: number;
  ownerName: string;
  description: string;
  onAdopted?: () => void;
}) {
  const { data: images, reload } = useFetch(() => api.listRefImages(kind, ownerId), [kind, ownerId]);
  const { error, run } = useAction();
  const [count, setCount] = useState(4);
  const [prompt, setPrompt] = useState('');
  const [showPrompt, setShowPrompt] = useState(false);

  const tracker = useJobTracker({
    onTick: (j: Job) => { if (j.doneSteps > 0) reload(); },
    onDone: () => reload(),
  });

  const generate = () =>
    run('参照画像の生成', async () => {
      const job = await api.generateRefImages(projectId, kind, ownerId, count, prompt.trim() || undefined);
      tracker.track(job);
    });

  const lastPrompt = images?.[0]?.prompt ?? '';
  const wide = kind === 'background';

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      {tracker.job && <JobStrip job={tracker.job} onDismiss={tracker.dismiss} />}

      {!description.trim() && (
        <div className="info-box">
          {kind === 'character' ? '外見の設定' : '説明'}が空です。先に埋めると、より狙いどおりの参照画像になります。
        </div>
      )}

      <div className="row" style={{ marginBottom: 12 }}>
        <button className="primary" disabled={tracker.running} onClick={generate}>
          {images?.length ? '候補を追加生成' : '参照画像を生成'}
        </button>
        <select
          style={{ width: 90 }}
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          disabled={tracker.running}
          aria-label="生成枚数"
        >
          {[1, 2, 4, 6, 8].map((n) => <option key={n} value={n}>{n}枚</option>)}
        </select>
        <button className="ghost sm" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? 'プロンプト指定を閉じる' : 'プロンプトを指定する'}
        </button>
      </div>

      {showPrompt && (
        <div className="card" style={{ background: 'var(--panel-2)' }}>
          <label>
            画像生成プロンプト（英語）
            <span className="hint"> ／ 空欄なら「{ownerName}」の設定文から Claude が自動生成します</span>
          </label>
          <textarea
            rows={3}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={lastPrompt || 'character reference sheet, front and side view, ...'}
          />
          {lastPrompt && (
            <div className="row" style={{ marginTop: 8 }}>
              <button className="sm" onClick={() => setPrompt(lastPrompt)}>前回のプロンプトを使う</button>
            </div>
          )}
        </div>
      )}

      {!images?.length && !tracker.running && (
        <div className="empty-state">
          <div className="big">🖼</div>
          まだ参照画像がありません。<br />
          生成した候補から1枚を「採用」すると、以降の作画で
          {kind === 'character' ? 'この顔・服装' : 'この場所の構造'}が保たれます。
        </div>
      )}

      {!!images?.length && (
        <>
          <div className="gallery">
            {images.map((img) => (
              <div key={img.id} className={`gallery-item ${wide ? 'wide' : ''} ${img.selected ? 'selected' : ''}`}>
                <img src={img.url} alt={`${ownerName} の参照画像候補`} loading="lazy" />
                {img.selected && <span className="flag">採用中</span>}
                <div className="pick">
                  {!img.selected && (
                    <button
                      onClick={() => run('参照画像の採用', async () => {
                        await api.selectRefImage(img.id);
                        reload();
                        onAdopted?.();
                      })}
                    >
                      採用
                    </button>
                  )}
                  <button
                    onClick={() => run('参照画像の削除', async () => {
                      await api.deleteRefImage(img.id);
                      reload();
                      onAdopted?.();
                    })}
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ marginTop: 10 }}>
            採用した1枚が作画時の参照画像として全コマへ渡されます。
            候補はそのまま残るので、LoRA学習の学習画像としても使えます。
          </p>
        </>
      )}
    </div>
  );
}
