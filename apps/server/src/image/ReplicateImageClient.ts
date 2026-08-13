import { resolveConsistencyInputs, type ImageClient, type ImageRequest, type ImageResult } from './ImageClient.js';
import { localImageToDataUri } from './storage.js';

/**
 * Replicate API で画像生成する実装。
 * 認証は環境変数 REPLICATE_API_TOKEN。
 *
 * モデルごとの入力差異は ArtStyle.extraInput / ImageRequest.extraInput で吸収する。
 * LoRA は flux 系の "lora_weights"、参照画像は "image" 入力へマッピング（extraInput で上書き可）。
 */
export class ReplicateImageClient implements ImageClient {
  readonly name = 'replicate';
  private token = process.env.REPLICATE_API_TOKEN;

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!this.token) {
      throw new Error('REPLICATE_API_TOKEN が設定されていません');
    }
    const input: Record<string, unknown> = {
      prompt: req.prompt,
      aspect_ratio: req.aspectRatio ?? '3:4',
      ...req.extraInput,
    };
    // lora_weights / image は1つずつしか渡せないため、優先順位に従って1つに決める
    const { lora, referenceImage, droppedLoras } = resolveConsistencyInputs(req);
    // 作画モデル自身が学習済みLoRAモデル（owner/model:version）の場合、重みは焼き込み済みなので渡さない。
    // 渡すと「lora_weights は未知の入力」エラーや private モデルの重みDL失敗になる
    const loraIsSelf = !!lora && (lora === req.model || lora.startsWith(`${req.model}:`));
    if (lora && !loraIsSelf && input.lora_weights === undefined) input.lora_weights = lora;
    if (referenceImage && input.image === undefined) input.image = referenceImage;
    if (droppedLoras.length > 0 && input.lora_weights === lora) {
      // 黙って捨てると「LoRAを学習したのに効かない」原因が分からなくなるので明示する
      console.warn(
        `[image] このモデルは LoRA を1つしか適用できません。適用: ${lora} / 未適用: ${droppedLoras.join(', ')}`,
      );
    }

    // クレジット残高が $5 未満だと「毎分6リクエスト・バースト1」に制限されるため、
    // 429 は retry_after（秒）を尊重してリトライする
    // ローカル保存した画像（/api/images/…）は外部から到達できないため data URI にして渡す
    for (const key of ['image', 'input_image'] as const) {
      const v = input[key];
      if (typeof v === 'string' && v.startsWith('/api/images/')) {
        input[key] = await localImageToDataUri(v);
      }
    }

    // "owner/name" は models エンドポイント（公式モデル用）、
    // "owner/name:versionId" は /v1/predictions に version を渡す（個人・学習済みモデル用）
    const versionMatch = req.model.match(/^[^:]+:(.+)$/);
    const endpoint = versionMatch
      ? 'https://api.replicate.com/v1/predictions'
      : `https://api.replicate.com/v1/models/${req.model}/predictions`;
    const payload = versionMatch ? { version: versionMatch[1], input } : { input };

    let prediction: any;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            Prefer: 'wait=60',
          },
          body: JSON.stringify(payload),
        },
      );
      if (res.status === 429 && attempt < 6) {
        const body = await res.text();
        let retryAfter = Number(res.headers.get('retry-after'));
        if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
          try { retryAfter = Number(JSON.parse(body).retry_after); } catch { /* 本文がJSONでない */ }
        }
        const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter + 1 : 12;
        console.warn(`[image] レート制限（429）。${waitSec}秒待って再試行します（${attempt}/5）`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Replicate API エラー (${res.status}): ${body.slice(0, 500)}`);
      }
      prediction = await res.json();
      break;
    }

    // Prefer: wait でも完了しない場合はポーリング
    const deadline = Date.now() + 180_000;
    while (
      prediction.status !== 'succeeded' &&
      prediction.status !== 'failed' &&
      prediction.status !== 'canceled'
    ) {
      if (Date.now() > deadline) throw new Error('Replicate の生成がタイムアウトしました');
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(prediction.urls.get, {
        headers: { Authorization: `Bearer ${this.token}` },
      });
      prediction = await poll.json();
    }
    if (prediction.status !== 'succeeded') {
      throw new Error(`Replicate の生成が失敗しました: ${prediction.error ?? prediction.status}`);
    }
    const output = prediction.output;
    const url = Array.isArray(output) ? output[0] : output;
    if (typeof url !== 'string') {
      throw new Error(`Replicate の出力形式が想定外です: ${JSON.stringify(output).slice(0, 200)}`);
    }
    return { url, appliedLora: lora, appliedReferenceImage: referenceImage };
  }
}
