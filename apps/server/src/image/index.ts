import type { ImageClient } from './ImageClient.js';
import { ReplicateImageClient } from './ReplicateImageClient.js';
import { MockImageClient } from './MockImageClient.js';

export * from './ImageClient.js';
export { ReplicateImageClient } from './ReplicateImageClient.js';
export { MockImageClient } from './MockImageClient.js';

let client: ImageClient | null = null;

/**
 * IMAGE_CLIENT 環境変数でバックエンドを切り替える。
 *   "replicate"（デフォルト。ただし REPLICATE_API_TOKEN 未設定時は mock へフォールバック）
 *   "mock"
 */
export function getImageClient(): ImageClient {
  if (!client) {
    const kind =
      process.env.IMAGE_CLIENT ??
      (process.env.REPLICATE_API_TOKEN ? 'replicate' : 'mock');
    client = kind === 'mock' ? new MockImageClient() : new ReplicateImageClient();
    console.log(`[image] using client: ${client.name}`);
  }
  return client;
}
