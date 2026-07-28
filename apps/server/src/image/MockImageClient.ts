import type { ImageClient, ImageRequest, ImageResult } from './ImageClient.js';

/** API トークンなしで動作確認するためのモック。プレースホルダ画像URLを返す */
export class MockImageClient implements ImageClient {
  readonly name = 'mock';
  private counter = 0;

  async generate(req: ImageRequest): Promise<ImageResult> {
    this.counter++;
    const seed = encodeURIComponent(`${req.prompt.slice(0, 32)}-${this.counter}`);
    return { url: `https://picsum.photos/seed/${seed}/600/800` };
  }
}
