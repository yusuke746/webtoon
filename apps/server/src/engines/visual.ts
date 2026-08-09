import type {
  ArtStyle, Background, Job, LoraTargetKind, LoraTraining, RefImage, RefImageKind,
} from '@manga/shared';
import {
  db, rowToArtStyle, rowToBackground, rowToLoraTraining, rowToRefImage,
} from '../db.js';
import { getLLMClient, extractJson } from '../llm/index.js';
import { getImageClient } from '../image/index.js';
import {
  cancelTraining, createTraining, downloadImage, getTraining, hasReplicateToken, uploadFile,
} from '../image/replicateApi.js';
import { createZip } from '../image/zip.js';
import { refImagePrompt } from '../prompts.js';
import { startJob } from './jobs.js';

/**
 * ビジュアル工房エンジン。
 *
 * 「毎回同じ顔・同じ場所で描く」ための一貫性アセットを Replicate で作る。
 *   1. 参照画像: 設定文 → 英語プロンプト（Claude） → 画像を複数生成 → 1枚を採用
 *   2. 背景:     キャラと同じ仕組みを場所に適用
 *   3. LoRA:     採用済みの画像を ZIP 化 → Replicate files → trainings API で学習
 */

// ============================================================
// 背景
// ============================================================

export function listBackgrounds(projectId: number): Background[] {
  return (
    db.prepare('SELECT * FROM backgrounds WHERE project_id = ? ORDER BY id').all(projectId) as any[]
  ).map(rowToBackground);
}

export function getBackground(id: number): Background {
  const row = db.prepare('SELECT * FROM backgrounds WHERE id = ?').get(id);
  if (!row) throw new Error(`背景が見つかりません: ${id}`);
  return rowToBackground(row as any);
}

export function createBackground(projectId: number, body: Partial<Background>): Background {
  const result = db
    .prepare(
      'INSERT INTO backgrounds (project_id, name, description, ref_image_url, lora_url) VALUES (?, ?, ?, ?, ?)',
    )
    .run(projectId, body.name ?? '', body.description ?? '', body.refImageUrl ?? null, body.loraUrl ?? null);
  return getBackground(Number(result.lastInsertRowid));
}

export function updateBackground(id: number, body: Partial<Background>): Background {
  const b = getBackground(id);
  db.prepare(
    'UPDATE backgrounds SET name = ?, description = ?, ref_image_url = ?, lora_url = ? WHERE id = ?',
  ).run(
    body.name ?? b.name,
    body.description ?? b.description,
    body.refImageUrl === undefined ? b.refImageUrl : body.refImageUrl,
    body.loraUrl === undefined ? b.loraUrl : body.loraUrl,
    id,
  );
  return getBackground(id);
}

export function deleteBackground(id: number): void {
  db.prepare('DELETE FROM backgrounds WHERE id = ?').run(id);
  db.prepare("DELETE FROM ref_images WHERE kind = 'background' AND owner_id = ?").run(id);
}

// ============================================================
// 参照画像
// ============================================================

export function listRefImages(kind: RefImageKind, ownerId: number): RefImage[] {
  return (
    db
      .prepare('SELECT * FROM ref_images WHERE kind = ? AND owner_id = ? ORDER BY id DESC')
      .all(kind, ownerId) as any[]
  ).map(rowToRefImage);
}

export function getRefImage(id: number): RefImage {
  const row = db.prepare('SELECT * FROM ref_images WHERE id = ?').get(id);
  if (!row) throw new Error(`参照画像が見つかりません: ${id}`);
  return rowToRefImage(row as any);
}

/** 対象テーブル名と、名前・説明カラムの対応 */
const REF_TARGET = {
  character: { table: 'characters', nameCol: 'name', descCol: 'appearance' },
  background: { table: 'backgrounds', nameCol: 'name', descCol: 'description' },
  style: { table: 'art_styles', nameCol: 'name', descCol: 'style_prompt' },
} as const;

function loadRefTarget(kind: RefImageKind, ownerId: number) {
  const meta = REF_TARGET[kind];
  const row = db.prepare(`SELECT * FROM ${meta.table} WHERE id = ?`).get(ownerId) as any;
  if (!row) throw new Error(`対象が見つかりません (${kind}:${ownerId})`);
  return { meta, row, name: row[meta.nameCol] as string, description: (row[meta.descCol] ?? '') as string };
}

/**
 * 作品に設定された画風を引く。
 * story.js の getProject は使わない（story.js -> visual.js の循環 import を避けるため）。
 */
function projectArtStyle(projectId: number): ArtStyle | null {
  const project = db.prepare('SELECT art_style_id FROM projects WHERE id = ?').get(projectId) as
    | { art_style_id: number | null }
    | undefined;
  if (!project?.art_style_id) return null;
  const row = db.prepare('SELECT * FROM art_styles WHERE id = ?').get(project.art_style_id);
  return row ? rowToArtStyle(row as any) : null;
}

/**
 * 参照画像の候補を count 枚生成するジョブを開始する。
 * promptOverride があれば Claude を通さずそのプロンプトで生成する（微調整の再生成用）。
 */
export function startRefImagesJob(
  projectId: number,
  kind: RefImageKind,
  ownerId: number,
  count: number,
  promptOverride?: string,
): Job {
  const { name } = loadRefTarget(kind, ownerId);
  const kindLabel = { character: 'キャラ', background: '背景', style: '画風' }[kind];

  return startJob(
    {
      projectId,
      kind: 'ref_images',
      label: `${kindLabel}参照画像の生成: ${name}`,
      // プロンプト作成(1) + 画像count枚
      totalSteps: count + 1,
      step: 'プロンプトを作成中…',
    },
    async (ctx) => {
      const target = loadRefTarget(kind, ownerId);
      const style = projectArtStyle(projectId);

      let prompt = promptOverride?.trim() ?? '';
      if (!prompt) {
        const text = await getLLMClient().complete({
          task: 'ref_image',
          prompt: refImagePrompt(kind, target.name, target.description, style?.stylePrompt ?? ''),
        });
        prompt = extractJson<{ prompt: string }>(text).prompt;
      }
      ctx.advance(`プロンプト完成。画像を生成します（0/${count}）`);

      const image = getImageClient();
      const model = style?.model ?? process.env.REPLICATE_MODEL ?? 'black-forest-labs/flux-schnell';
      const insert = db.prepare(
        'INSERT INTO ref_images (project_id, kind, owner_id, url, prompt) VALUES (?, ?, ?, ?, ?)',
      );

      // Replicate 側の一時エラーがあるため1枚単位でリトライし、駄目でも残りは続行する
      let failures = 0;
      for (let i = 0; i < count; i++) {
        const MAX_ATTEMPTS = 3;
        for (let attempt = 1; ; attempt++) {
          try {
            const result = await image.generate({
              prompt: [style?.stylePrompt, prompt].filter(Boolean).join(', '),
              model,
              styleLoraUrl: style?.loraUrl,
              // キャラ設定画は縦長、背景は横長が扱いやすい
              aspectRatio: kind === 'background' ? '16:9' : '3:4',
              extraInput: style?.extraInput,
            });
            insert.run(projectId, kind, ownerId, result.url, prompt);
            break;
          } catch (e) {
            if (attempt >= MAX_ATTEMPTS) {
              console.warn(`[ref-images] ${i + 1}枚目は ${MAX_ATTEMPTS} 回失敗したためスキップします:`, e);
              failures += 1;
              break;
            }
            console.warn(`[ref-images] ${i + 1}枚目の生成に失敗。リトライします（${attempt}/${MAX_ATTEMPTS}）:`, e);
            await new Promise((r) => setTimeout(r, 5000 * attempt));
          }
        }
        ctx.advance(`画像を生成中（${i + 1}/${count}）`);
      }
      if (failures >= count) {
        throw new Error(`参照画像を1枚も生成できませんでした（${count}枚中 ${failures} 失敗）`);
      }

      ctx.setResultRef(`${kind}:${ownerId}`);
    },
  );
}

/** 候補の1枚を「正」として採用し、対象の ref_image_url へ書き込む */
export function selectRefImage(refImageId: number): RefImage {
  const ref = getRefImage(refImageId);
  const meta = REF_TARGET[ref.kind];

  db.prepare('UPDATE ref_images SET selected = 0 WHERE kind = ? AND owner_id = ?').run(ref.kind, ref.ownerId);
  db.prepare('UPDATE ref_images SET selected = 1 WHERE id = ?').run(refImageId);

  // art_styles には ref_image_url 列がないため、画像を持てる対象だけ更新する
  if (ref.kind !== 'style') {
    db.prepare(`UPDATE ${meta.table} SET ref_image_url = ? WHERE id = ?`).run(ref.url, ref.ownerId);
  }
  return getRefImage(refImageId);
}

export function deleteRefImage(id: number): void {
  const ref = getRefImage(id);
  db.prepare('DELETE FROM ref_images WHERE id = ?').run(id);
  // 採用中の画像を消した場合は対象側の参照も外す
  if (ref.selected && ref.kind !== 'style') {
    const meta = REF_TARGET[ref.kind];
    db.prepare(`UPDATE ${meta.table} SET ref_image_url = NULL WHERE id = ?`).run(ref.ownerId);
  }
}

// ============================================================
// LoRA 学習
// ============================================================

const LORA_TABLE = {
  character: 'characters',
  background: 'backgrounds',
  art_style: 'art_styles',
} as const;

export function listLoraTrainings(projectId: number): LoraTraining[] {
  return (
    db.prepare('SELECT * FROM lora_trainings WHERE project_id = ? ORDER BY id DESC').all(projectId) as any[]
  ).map(rowToLoraTraining);
}

export function getLoraTraining(id: number): LoraTraining {
  const row = db.prepare('SELECT * FROM lora_trainings WHERE id = ?').get(id);
  if (!row) throw new Error(`LoRA学習が見つかりません: ${id}`);
  return rowToLoraTraining(row as any);
}

function updateTrainingRow(id: number, patch: Record<string, unknown>) {
  const cols = Object.keys(patch);
  db.prepare(
    `UPDATE lora_trainings SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`,
  ).run(...cols.map((c) => patch[c] as any), id);
}

export interface StartLoraOptions {
  targetKind: LoraTargetKind;
  targetId: number;
  /** 学習に使う画像URL（10枚以上を推奨） */
  imageUrls: string[];
  triggerWord: string;
  steps?: number;
  loraRank?: number;
  /** 未指定なら環境変数 REPLICATE_LORA_TRAINER */
  trainerModel?: string;
  /** 未指定なら環境変数 REPLICATE_LORA_DESTINATION */
  destination?: string;
}

/** 学習の前提条件を検証する。UI から事前チェックにも使う */
export function validateLoraOptions(opts: StartLoraOptions): string[] {
  const problems: string[] = [];
  if (!hasReplicateToken()) {
    problems.push('REPLICATE_API_TOKEN が未設定です（.env に設定してください）');
  }
  const trainer = opts.trainerModel ?? process.env.REPLICATE_LORA_TRAINER ?? '';
  if (!trainer) {
    problems.push(
      'LoRA学習モデルが未設定です。REPLICATE_LORA_TRAINER に "owner/name:versionId" 形式で指定してください',
    );
  } else if (!trainer.includes(':')) {
    problems.push(`学習モデルには version が必要です: "${trainer}"（"owner/name:versionId" 形式）`);
  }
  const destination = opts.destination ?? process.env.REPLICATE_LORA_DESTINATION ?? '';
  if (!destination) {
    problems.push(
      '学習結果の出力先が未設定です。REPLICATE_LORA_DESTINATION に "owner/model" を指定してください'
        + '（Replicate 上にモデルを事前作成する必要があります）',
    );
  } else if (!destination.includes('/')) {
    problems.push(`出力先の形式が不正です: "${destination}"（"owner/model" 形式）`);
  }
  if (opts.imageUrls.length < 4) {
    problems.push(`学習画像が少なすぎます（${opts.imageUrls.length}枚）。10枚以上を推奨します`);
  }
  if (!opts.triggerWord.trim()) {
    problems.push('トリガーワードは必須です');
  }
  return problems;
}

/** 学習の進捗をポーリングする間隔 */
const POLL_INTERVAL_MS = Number(process.env.LORA_POLL_INTERVAL_MS ?? 15_000);
/** 打ち切り時間（既定90分） */
const POLL_TIMEOUT_MS = Number(process.env.LORA_TIMEOUT_MS ?? 90 * 60 * 1000);

/**
 * LoRA 学習を開始する。
 * ZIP 化 → アップロード → 学習開始 → 完了までポーリング、を1ジョブで実行する。
 * 完了すると対象（キャラ/背景/画風）の lora_url に学習結果が書き込まれる。
 */
export function startLoraTrainingJob(projectId: number, opts: StartLoraOptions): { job: Job; training: LoraTraining } {
  const problems = validateLoraOptions(opts);
  if (problems.length > 0) {
    throw new Error(`LoRA学習を開始できません:\n- ${problems.join('\n- ')}`);
  }

  const table = LORA_TABLE[opts.targetKind];
  const targetRow = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(opts.targetId) as any;
  if (!targetRow) throw new Error(`対象が見つかりません (${opts.targetKind}:${opts.targetId})`);

  const trainerModel = opts.trainerModel ?? process.env.REPLICATE_LORA_TRAINER!;
  const destination = opts.destination ?? process.env.REPLICATE_LORA_DESTINATION!;

  const inserted = db
    .prepare(
      `INSERT INTO lora_trainings
        (project_id, target_kind, target_id, name, trainer_model, destination, trigger_word, image_urls, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'preparing')`,
    )
    .run(
      projectId, opts.targetKind, opts.targetId, targetRow.name ?? '',
      trainerModel, destination, opts.triggerWord.trim(), JSON.stringify(opts.imageUrls),
    );
  const trainingId = Number(inserted.lastInsertRowid);

  const job = startJob(
    {
      projectId,
      kind: 'lora_train',
      label: `LoRA学習: ${targetRow.name ?? opts.targetKind}`,
      // 画像DL + ZIP + アップロード + 学習開始 + 学習完了
      totalSteps: opts.imageUrls.length + 4,
      step: '学習画像を取得中…',
    },
    async (ctx) => {
      ctx.setResultRef(`lora:${trainingId}`);

      // ---- 1. 学習画像をダウンロード ----
      const entries: { name: string; bytes: Uint8Array }[] = [];
      for (let i = 0; i < opts.imageUrls.length; i++) {
        const { bytes, ext } = await downloadImage(opts.imageUrls[i]);
        entries.push({ name: `${String(i + 1).padStart(3, '0')}.${ext}`, bytes });
        ctx.advance(`学習画像を取得中（${i + 1}/${opts.imageUrls.length}）`);
      }

      // ---- 2. ZIP 化 ----
      const zipBytes = createZip(entries);
      ctx.advance(`ZIPを作成しました（${(zipBytes.length / 1024 / 1024).toFixed(1)}MB）`);

      // ---- 3. Replicate へアップロード ----
      updateTrainingRow(trainingId, { status: 'uploading' });
      const file = await uploadFile(zipBytes, `lora-${trainingId}.zip`);
      ctx.advance('学習データをアップロードしました');

      // ---- 4. 学習開始 ----
      const training = await createTraining(trainerModel, destination, {
        input_images: file.urls.get,
        trigger_word: opts.triggerWord.trim(),
        steps: opts.steps ?? 1000,
        lora_rank: opts.loraRank ?? 16,
        autocaption: true,
      });
      updateTrainingRow(trainingId, { status: 'training', replicate_id: training.id });
      ctx.advance(`学習を開始しました（Replicate id: ${training.id}）`);

      // ---- 5. 完了までポーリング ----
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let current = training;
      while (current.status === 'starting' || current.status === 'processing') {
        if (Date.now() > deadline) {
          updateTrainingRow(trainingId, { status: 'failed', error: '学習がタイムアウトしました' });
          throw new Error(
            `LoRA学習がタイムアウトしました（${Math.round(POLL_TIMEOUT_MS / 60000)}分）。`
              + `Replicate 側では継続している可能性があります (id: ${current.id})`,
          );
        }
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
        current = await getTraining(current.id);
        const elapsedMin = Math.round((POLL_TIMEOUT_MS - (deadline - Date.now())) / 60000);
        ctx.setStep(`Replicate で学習中… (${current.status} / 経過 約${elapsedMin}分)`);
      }

      if (current.status !== 'succeeded') {
        const message = current.error ?? `学習が ${current.status} で終了しました`;
        updateTrainingRow(trainingId, { status: 'failed', error: message });
        throw new Error(`LoRA学習に失敗しました: ${message}`);
      }

      // 生成時に lora_weights へ渡せるのは version（owner/model:hash）。無ければ weights の URL
      const weights = current.output?.version ?? current.output?.weights ?? null;
      if (!weights) {
        updateTrainingRow(trainingId, { status: 'failed', error: '学習は成功しましたが重みURLが取得できませんでした' });
        throw new Error('学習は成功しましたが重みURLが取得できませんでした');
      }

      updateTrainingRow(trainingId, { status: 'succeeded', weights_url: weights });
      db.prepare(`UPDATE ${table} SET lora_url = ? WHERE id = ?`).run(weights, opts.targetId);
      ctx.advance('学習完了。対象へLoRAを設定しました');
    },
  );

  return { job, training: getLoraTraining(trainingId) };
}

/** 実行中の学習を Replicate 側でキャンセルする */
export async function cancelLoraTraining(id: number): Promise<LoraTraining> {
  const training = getLoraTraining(id);
  if (training.replicateId && training.status === 'training') {
    await cancelTraining(training.replicateId);
  }
  updateTrainingRow(id, { status: 'canceled' });
  return getLoraTraining(id);
}
