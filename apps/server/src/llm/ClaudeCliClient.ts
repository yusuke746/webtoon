import { spawn } from 'node:child_process';
import type { LLMClient, LLMRequest } from './LLMClient.js';

/**
 * Claude CLI（MAX契約）をサブプロセスとして呼び出す LLMClient 実装。
 * API キーは使わず、`claude -p` の標準出力を受け取る。
 *
 * 環境変数:
 *   CLAUDE_CLI_PATH   … CLI のパス（デフォルト: "claude"）
 *   CLAUDE_CLI_MODEL  … モデル指定（省略時は CLI のデフォルト）
 *   LLM_TIMEOUT_MS    … タイムアウト（デフォルト: 300000 = 5分）
 */
export class ClaudeCliClient implements LLMClient {
  readonly name = 'claude-cli';
  private cliPath = process.env.CLAUDE_CLI_PATH ?? 'claude';
  private model = process.env.CLAUDE_CLI_MODEL;
  private timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 300_000);

  async complete(req: LLMRequest): Promise<string> {
    const args = ['-p', '--output-format', 'json'];
    if (this.model) args.push('--model', this.model);
    if (req.system) args.push('--append-system-prompt', req.system);

    const stdout = await this.run(args, req.prompt);
    // --output-format json は {"result": "...", ...} 形式で返す
    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed?.result === 'string') return parsed.result;
    } catch {
      // JSON でなければ生テキストとして扱う（CLIバージョン差異への保険）
    }
    return stdout;
  }

  private run(args: string[], stdin: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });
      let out = '';
      let err = '';
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error(`Claude CLI がタイムアウトしました (${this.timeoutMs}ms)`));
      }, this.timeoutMs);

      child.stdout.on('data', (d) => (out += d));
      child.stderr.on('data', (d) => (err += d));
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(new Error(`Claude CLI の起動に失敗しました (${this.cliPath}): ${e.message}`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else reject(new Error(`Claude CLI がエラー終了しました (code=${code}): ${err.slice(0, 500)}`));
      });

      child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}
