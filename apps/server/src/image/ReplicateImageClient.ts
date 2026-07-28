import type { ImageClient, ImageRequest, ImageResult } from './ImageClient.js';

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
    const lora = req.characterLoraUrls?.[0] ?? req.styleLoraUrl;
    if (lora && input.lora_weights === undefined) input.lora_weights = lora;
    if (req.referenceImageUrls?.[0] && input.image === undefined) {
      input.image = req.referenceImageUrls[0];
    }

    const res = await fetch(
      `https://api.replicate.com/v1/models/${req.model}/predictions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.token}`,
          'Content-Type': 'application/json',
          Prefer: 'wait=60',
        },
        body: JSON.stringify({ input }),
      },
    );
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Replicate API エラー (${res.status}): ${body.slice(0, 500)}`);
    }
    let prediction: any = await res.json();

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
    return { url };
  }
}
