import { useEffect, useState } from 'react';
import type { LoraTargetKind, LoraTraining, RefImageKind } from '@manga/shared';
import { api } from '../api';
import { useAction, useFetch, useJobTracker } from '../hooks';
import { JobStrip } from './JobProgress';

/**
 * LoRA 学習スタジオ。
 *
 * 参照画像1枚では顔がぶれる場合に、その対象«専用»のモデル（LoRA）を Replicate で学習する。
 * 学習には数十分と実費がかかるため、開始前に前提条件を検証して不足を明示する。
 *
 * 流れ: 学習画像を選ぶ → ZIP化 → Replicate へアップロード → trainings API → 完了後 loraUrl に反映
 */

const KIND_TO_REF: Record<LoraTargetKind, RefImageKind> = {
  character: 'character',
  background: 'background',
  art_style: 'style',
};

const STATUS_LABEL: Record<LoraTraining['status'], string> = {
  preparing: '準備中',
  uploading: 'アップロード中',
  training: '学習中',
  succeeded: '完了',
  failed: '失敗',
  canceled: 'キャンセル',
};

export function LoraStudio({
  projectId,
  targetKind,
  targetId,
  targetName,
  currentLoraUrl,
  onChanged,
}: {
  projectId: number;
  targetKind: LoraTargetKind;
  targetId: number;
  targetName: string;
  currentLoraUrl: string | null;
  onChanged?: () => void;
}) {
  const refKind = KIND_TO_REF[targetKind];
  const { data: images } = useFetch(() => api.listRefImages(refKind, targetId), [refKind, targetId]);
  const { data: trainings, reload: reloadTrainings } = useFetch(
    () => api.listLoraTrainings(projectId), [projectId],
  );
  const { error, run } = useAction();

  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [triggerWord, setTriggerWord] = useState('');
  const [steps, setSteps] = useState(1000);
  const [trainerModel, setTrainerModel] = useState('');
  const [destination, setDestination] = useState('');
  const [problems, setProblems] = useState<string[] | null>(null);

  const tracker = useJobTracker({ onDone: () => { reloadTrainings(); onChanged?.(); } });

  // 対象名から無難なトリガーワードを作る（英数字のみ・大文字）
  useEffect(() => {
    if (triggerWord) return;
    const ascii = targetName.replace(/[^A-Za-z0-9]/g, '');
    setTriggerWord(ascii ? `${ascii.toUpperCase()}_LORA` : `T${targetId}_LORA`);
  }, [targetName, targetId, triggerWord]);

  const selectedUrls = (images ?? []).filter((i) => selected.has(i.id)).map((i) => i.url);

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

  const body = () => ({
    targetKind, targetId, imageUrls: selectedUrls, triggerWord,
    steps, trainerModel: trainerModel || undefined, destination: destination || undefined,
  });

  const check = () =>
    run('前提条件の確認', async () => {
      const result = await api.validateLora(projectId, body());
      setProblems(result.problems);
      // 環境変数側の既定値をフォームへ反映（未入力のときだけ）
      if (!trainerModel) setTrainerModel(result.defaults.trainerModel);
      if (!destination) setDestination(result.defaults.destination);
    });

  const start = () =>
    run('LoRA学習の開始', async () => {
      const { job } = await api.startLoraTraining(projectId, body());
      tracker.track(job);
      reloadTrainings();
    });

  const mine = (trainings ?? []).filter((t) => t.targetKind === targetKind && t.targetId === targetId);

  return (
    <div>
      {error && <div className="error-box">{error}</div>}
      {tracker.job && <JobStrip job={tracker.job} onDismiss={tracker.dismiss} />}

      <div className="info-box">
        <strong>LoRA学習について</strong><br />
        Replicate 上で「{targetName}」専用モデルを学習します。
        <b>実費（数ドル程度）と時間（20〜40分）がかかります。</b>
        参照画像だけで一貫性が足りるならこの機能は不要です。
        学習画像は<b>10枚以上</b>、同じ対象を別角度・別表情で用意すると精度が上がります。
      </div>

      <div className="info-box" style={{ background: 'var(--warn-bg)', color: 'var(--warn)' }}>
        <strong>1コマに適用できる LoRA は1つだけです</strong><br />
        flux 系モデルは <code>lora_weights</code> を1つしか受け取れないため、
        優先順位は <b>登場キャラ → 背景 → 画風</b> です。
        {targetKind === 'background' && (
          <> つまり背景LoRAが効くのは<b>人物のいない情景コマ</b>が中心になります。
            人物と背景を同時に効かせたい場合は、画風設定で複数LoRA対応モデルを選び、
            「モデル固有の追加入力」でそのモデルの入力（例: <code>hf_loras</code>）を指定してください。</>
        )}
      </div>

      {currentLoraUrl && (
        <div className="card" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok)' }}>
          <strong>LoRA 設定済み</strong>
          <div className="muted" style={{ wordBreak: 'break-all' }}>{currentLoraUrl}</div>
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>1. 学習画像を選ぶ（{selected.size}枚選択中）</h3>
      {!images?.length ? (
        <div className="empty-state">
          参照画像がまだありません。<br />
          先に「参照画像」タブで候補を生成してください（10枚以上の生成を推奨）。
        </div>
      ) : (
        <>
          <div className="gallery">
            {images.map((img) => (
              <div
                key={img.id}
                className={`gallery-item ${targetKind === 'background' ? 'wide' : ''} ${selected.has(img.id) ? 'selected' : ''}`}
                onClick={() => toggle(img.id)}
                style={{ cursor: 'pointer' }}
              >
                <img src={img.url} alt="学習画像の候補" loading="lazy" />
                {selected.has(img.id) && <span className="flag">学習に使う</span>}
              </div>
            ))}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="sm" onClick={() => setSelected(new Set(images.map((i) => i.id)))}>
              すべて選択
            </button>
            <button className="sm" onClick={() => setSelected(new Set())}>選択を解除</button>
          </div>
        </>
      )}

      <h3 style={{ marginTop: 20 }}>2. 学習設定</h3>
      <div className="grid2">
        <div>
          <label>トリガーワード <span className="hint">／ プロンプトでこのLoRAを呼び出す語</span></label>
          <input value={triggerWord} onChange={(e) => setTriggerWord(e.target.value)} />
          <label>学習ステップ数 <span className="hint">／ 多いほど高精度・高コスト</span></label>
          <input type="number" min={200} max={4000} step={100} value={steps}
            onChange={(e) => setSteps(Number(e.target.value))} />
        </div>
        <div>
          <label>
            学習モデル
            <span className="hint"> ／ owner/name:versionId 形式。既定は環境変数 REPLICATE_LORA_TRAINER</span>
          </label>
          <input value={trainerModel} onChange={(e) => setTrainerModel(e.target.value)}
            placeholder="ostris/flux-dev-lora-trainer:<versionId>" />
          <label>
            出力先モデル
            <span className="hint"> ／ owner/model。Replicate 上に事前作成が必要</span>
          </label>
          <input value={destination} onChange={(e) => setDestination(e.target.value)}
            placeholder="your-name/my-manga-lora" />
        </div>
      </div>

      <div className="row" style={{ marginTop: 14 }}>
        <button onClick={check}>前提条件をチェック</button>
        <button
          className="primary"
          disabled={tracker.running || selectedUrls.length === 0}
          onClick={start}
        >
          学習を開始する（実費が発生します）
        </button>
      </div>

      {problems !== null && (
        problems.length === 0
          ? <div className="card" style={{ background: 'var(--ok-bg)', borderColor: 'var(--ok)', marginTop: 12 }}>
              ✅ 前提条件は満たしています。学習を開始できます。
            </div>
          : <div className="error-box" style={{ marginTop: 12 }}>
              学習を開始できません:
              <ul style={{ margin: '6px 0 0', paddingLeft: 20 }}>
                {problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
      )}

      {mine.length > 0 && (
        <>
          <h3 style={{ marginTop: 22 }}>学習履歴</h3>
          <table>
            <tbody>
              {mine.map((t) => (
                <tr key={t.id}>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <span className={`badge ${t.status === 'succeeded' ? 'ok' : t.status === 'failed' ? 'danger' : 'warn'}`}>
                      {STATUS_LABEL[t.status]}
                    </span>
                  </td>
                  <td>
                    <div>{t.triggerWord} ／ {t.imageUrls.length}枚</div>
                    <div className="muted" style={{ wordBreak: 'break-all' }}>
                      {t.weightsUrl ?? t.error ?? t.destination}
                    </div>
                  </td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    {t.status === 'training' && (
                      <button className="danger sm"
                        onClick={() => run('学習のキャンセル', async () => {
                          await api.cancelLoraTraining(t.id);
                          reloadTrainings();
                        })}
                      >
                        キャンセル
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
