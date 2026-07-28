import type { LLMClient } from './LLMClient.js';
import { ClaudeCliClient } from './ClaudeCliClient.js';
import { MockLLMClient } from './MockLLMClient.js';

export * from './LLMClient.js';
export { ClaudeCliClient } from './ClaudeCliClient.js';
export { MockLLMClient } from './MockLLMClient.js';

let client: LLMClient | null = null;

/**
 * LLM_CLIENT 環境変数でバックエンドを切り替える。
 *   "claude"（デフォルト）… Claude CLI サブプロセス
 *   "mock"               … 開発用モック
 */
export function getLLMClient(): LLMClient {
  if (!client) {
    const kind = process.env.LLM_CLIENT ?? 'claude';
    client = kind === 'mock' ? new MockLLMClient() : new ClaudeCliClient();
    console.log(`[llm] using client: ${client.name}`);
  }
  return client;
}
