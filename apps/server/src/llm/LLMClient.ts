/**
 * LLM 呼び出しの抽象化層。
 * 現在は Claude CLI（サブプロセス）実装がデフォルト。将来 API 直叩き等へ差し替え可能。
 */

/** タスク種別。モック実装のディスパッチとログ出力に使う */
export type LLMTask =
  | 'structure'      // あらすじ → 話数構成・シーン・伏線案
  | 'characters'     // キャラクター設定生成
  | 'panels'         // コマ割り・セリフ生成
  | 'discussion'     // AI議論の1発言
  | 'consensus'      // 議論の合意形成・要約
  | 'apply_change'   // 要約ベースの変更指示の適用
  | 'summarize';     // 汎用要約

export interface LLMRequest {
  task: LLMTask;
  /** システム相当の役割指示 */
  system?: string;
  prompt: string;
}

export interface LLMClient {
  readonly name: string;
  complete(req: LLMRequest): Promise<string>;
}

/**
 * LLM 出力から JSON 部分を取り出してパースする。
 * コードフェンスや前置きの文章が混ざっても最初の JSON 値を拾う。
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : text;
  const start = candidate.search(/[[{]/);
  if (start === -1) throw new Error(`LLM出力にJSONが見つかりません: ${text.slice(0, 200)}`);
  const opener = candidate[start];
  const closer = opener === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inString) {
      if (ch === '\\') i++;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === opener) depth++;
    else if (ch === closer) {
      depth--;
      if (depth === 0) return JSON.parse(candidate.slice(start, i + 1)) as T;
    }
  }
  throw new Error(`LLM出力のJSONが閉じていません: ${candidate.slice(start, start + 200)}`);
}
