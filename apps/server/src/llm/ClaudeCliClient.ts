import { spawn } from 'node:child_process';
import type { LLMClient, LLMRequest } from './LLMClient.js';

/**
 * Claude CLI（MAX契約）をサブプロセスとして呼び出す LLMClient 実装。
 * API キーは使わず、`claude -p` の標準出力を受け取る。
 *
 * 環境変数:
 *   CLAUDE_CLI_PATH   … CLI のパス（デフォルト: "claude"）
 *   CLAUDE_CLI_MODEL  … モデル指定（省略時は CLI のデフォルト）
 *   CLAUDE_CLI_EFFORT … 推論量（デフォルト: "low"）
 *   LLM_TIMEOUT_MS    … タイムアウト（デフォルト: 300000 = 5分）
 *   SERIES_FILE_ACCESS… "0" で、連載アーカイブのファイル読み取り（Read/Glob/Grep ツール）を無効化
 */
export class ClaudeCliClient implements LLMClient {
  readonly name = 'claude-cli';
  private cliPath = process.env.CLAUDE_CLI_PATH ?? 'claude';
  private model = process.env.CLAUDE_CLI_MODEL;
  private effort = process.env.CLAUDE_CLI_EFFORT ?? 'low';
  private timeoutMs = Number(process.env.LLM_TIMEOUT_MS ?? 300_000);

  async complete(req: LLMRequest): Promise<string> {
    // 連載アーカイブを cwd にし、読み取り専用ツールだけ許可する（書き込みはアプリ側が担う）。
    // それ以外はツールなし・1ターンで、推論量を絞って呼ぶ
    const cwd = req.cwd && process.env.SERIES_FILE_ACCESS !== '0' ? req.cwd : undefined;
    const args = [
      '-p', '--output-format', 'json',
      '--restricted', '--strict-mcp-config',
      '--permission-prompts', 'none',
      '--effort', this.effort,
      ...(cwd
        ? ['--tools', 'Read,Glob,Grep', '--allowedTools', 'Read,Glob,Grep', '--max-turns', process.env.CLAUDE_CLI_FILE_TURNS ?? '8']
        : ['--tools', '', '--max-turns', '1']),
    ];
    if (this.model) args.push('--model', this.model);
    if (req.system) args.push('--append-system-prompt', req.system);

    const stdout = await this.run(args, req.prompt, cwd);
    // --output-format json は {"result": "...", ...} 形式で返す
    try {
      const parsed = JSON.parse(stdout);
      if (typeof parsed?.result === 'string') return parsed.result;
    } catch {
      // JSON でなければ生テキストとして扱う（CLIバージョン差異への保険）
    }
    return stdout;
  }

  private run(args: string[], stdin: string, cwd?: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.cliPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
        cwd,
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
