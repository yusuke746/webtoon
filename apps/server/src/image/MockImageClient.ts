import { resolveConsistencyInputs, type ImageClient, type ImageRequest, type ImageResult } from './ImageClient.js';

/** API トークンなしで動作確認するためのモック。プレースホルダ画像URLを返す */
export class MockImageClient implements ImageClient {
  readonly name = 'mock';
  private counter = 0;

  async generate(req: ImageRequest): Promise<ImageResult> {
    this.counter++;
    const seed = encodeURIComponent(`${req.prompt.slice(0, 32)}-${this.counter}`);
    // 一貫性アセットの解決結果は本番と同じロジックを通す（優先順位をモックでも検証できるように）
    const { lora, referenceImage } = resolveConsistencyInputs(req);
    return {
      url: `https://picsum.photos/seed/${seed}/600/800`,
      appliedLora: lora,
      appliedReferenceImage: referenceImage,
    };
  }
}
