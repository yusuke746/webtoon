import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { LLMClient, LLMRequest } from './LLMClient.js';

/**
 * CLI の実行ファイルを解決する。
 * Windows では npm の shim（claude.cmd）を Node から直接 spawn できない（EINVAL）ため、
 * shim の隣にある cli.js を見つけて node で起動する。ネイティブ版（claude.exe）はそのまま。
 */
export function resolveClaudeCommand(cliPath = process.env.CLAUDE_CLI_PATH ?? 'claude'): { file: string; prefixArgs: string[] } {
  if (process.platform !== 'win32' || path.extname(cliPath) === '.exe') return { file: cliPath, prefixArgs: [] };
  const dirs = cliPath.includes('\\') || cliPath.includes('/') ? [path.dirname(cliPath)] : (process.env.PATH ?? '').split(';').filter(Boolean);
  const base = path.basename(cliPath).replace(/\.(cmd|bat)$/i, '');
  for (const dir of dirs) {
    const cliJs = path.join(dir, 'node_modules', '@anthropic-ai', 'claude-code', 'cli.js');
    if (existsSync(path.join(dir, `${base}.cmd`)) && existsSync(cliJs)) return { file: process.execPath, prefixArgs: [cliJs] };
    if (existsSync(path.join(dir, `${base}.exe`))) return { file: path.join(dir, `${base}.exe`), prefixArgs: [] };
  }
  return { file: cliPath, prefixArgs: [] };
}

/** 失敗時に stderr が空でも原因が分かるよう、stdout（JSON の result / error）も読む */
function describeFailure(code: number | null, out: string, err: string): string {
  const stderr = err.trim();
  if (stderr) return stderr.slice(0, 600);
  const stdout = out.trim();
  try {
    const j = JSON.parse(stdout);
    const msg = j?.result ?? j?.error?.message ?? j?.error ?? j?.message;
    if (typeof msg === 'string' && msg.trim()) return msg.trim().slice(0, 600);
  } catch { /* JSON でなければ生テキスト */ }
  if (stdout) return stdout.slice(0, 600);
  return `出力なし (code=${code})。ログイン状態は \`claude auth status\`、動作は \`claude -p "hi"\` で確認できます`;
}

/** 起動時の事前確認: CLI の場所・バージョン・ログイン状態をログに出す（失敗してもサーバーは止めない） */
export async function checkClaudeCli(): Promise<void> {
  const { file, prefixArgs } = resolveClaudeCommand();
  const run = (args: string[]) => new Promise<{ code: number | null; out: string; err: string }>((resolve) => {
    const child = spawn(file, [...prefixArgs, ...args], { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = ''; let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ code: null, out, err: e.message }));
    child.on('close', (code) => resolve({ code, out, err }));
    setTimeout(() => child.kill(), 20_000);
  });
  const ver = await run(['--version']);
  if (ver.code !== 0) {
    console.warn(`[llm] Claude CLI を起動できません (${file}): ${describeFailure(ver.code, ver.out, ver.err)}。CLAUDE_CLI_PATH を確認してください`);
    return;
  }
  const status = await run(['auth', 'status']);
  let loggedIn: boolean | null = null;
  let method = '';
  try { const j = JSON.parse(status.out); loggedIn = !!j.loggedIn; method = j.authMethod ?? ''; } catch { /* 古い CLI は auth status が無い */ }
  if (loggedIn === false) console.warn(`[llm] Claude CLI ${ver.out.trim()} にログインしていません。\`claude auth login\` を実行してください`);
  else console.log(`[llm] Claude CLI ${ver.out.trim()}${loggedIn ? ` / ログイン済み (${method})` : ''}`);
}

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
      const { file, prefixArgs } = resolveClaudeCommand(this.cliPath);
      const child = spawn(file, [...prefixArgs, ...args], {
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
        reject(new Error(`Claude CLI の起動に失敗しました (${file}): ${e.message}。CLAUDE_CLI_PATH を確認してください`));
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(out.trim());
        else {
          console.warn(`[llm] Claude CLI 失敗 (code=${code}) args: ${[...prefixArgs, ...args].map((a) => (a.length > 60 ? `${a.slice(0, 60)}…` : a)).join(' ')}`);
          reject(new Error(`Claude CLI がエラー終了しました (code=${code}): ${describeFailure(code, out, err)}`));
        }
      });

      child.stdin.write(stdin);
      child.stdin.end();
    });
  }
}
