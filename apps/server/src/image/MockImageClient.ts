import path from 'node:path';
import { resolveConsistencyInputs, type ImageClient, type ImageRequest, type ImageResult } from './ImageClient.js';
import { IMAGES_DIR } from './storage.js';
import { writePlaceholderPng } from './placeholder.js';

/**
 * API トークンなしで動作確認するためのモック。
 * ローカルにプレースホルダ PNG を書き出して配信URLを返す（作画チェックが画像を読めるように）。
 */
export class MockImageClient implements ImageClient {
  readonly name = 'mock';
  private counter = 0;

  async generate(req: ImageRequest): Promise<ImageResult> {
    this.counter++;
    // 一貫性アセットの解決結果は本番と同じロジックを通す（優先順位をモックでも検証できるように）
    const { lora, referenceImage } = resolveConsistencyInputs(req);
    const [w, h] = (req.aspectRatio ?? '3:4').split(':').map(Number);
    const width = 384;
    const height = Math.round((width * (h || 4)) / (w || 3));
    const filename = `mock-${Date.now()}-${this.counter}.png`;
    writePlaceholderPng(path.join(IMAGES_DIR, filename), width, height, this.counter + req.prompt.length);
    return {
      url: `/api/images/${filename}`,
      appliedLora: lora,
      appliedReferenceImage: referenceImage,
    };
  }
}
