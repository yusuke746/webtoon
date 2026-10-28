import { useEffect, useRef, useState } from 'react';
import type { Npc } from './floors';

/**
 * スーファミ RPG 風の会話ウィンドウ。
 * - 定型文をタイプライター表示（Enter/クリックで送り）
 * - 最後にメニュー（部屋に入る / 相談する / やめる）
 * - 相談はテキスト入力 → LLM の返答を表示 → 提案があれば「構成に反映」
 */

export type TalkPhase = 'lines' | 'menu' | 'input' | 'waiting' | 'reply';

export interface TalkState {
  npc: Npc;
  lines: string[];
  index: number;
  phase: TalkPhase;
  reply: string | null;
  /** LLM が提案したアクション */
  action: 'apply_change' | null;
  lastMessage: string;
  history: { role: 'user' | 'npc'; text: string }[];
  disabled: boolean;
}

interface Props {
  talk: TalkState;
  onAdvance: () => void;
  onChoose: (choice: 'enter' | 'chat' | 'close' | 'apply') => void;
  onSend: (text: string) => void;
  onCancelInput: () => void;
}

export function TalkWindow({ talk, onAdvance, onChoose, onSend, onCancelInput }: Props) {
  const text = talk.phase === 'reply' ? (talk.reply ?? '') : talk.phase === 'waiting' ? '' : talk.lines[talk.index] ?? '';
  const [typed, finishTyping] = useTypewriter(text, `${talk.npc.id}:${talk.phase}:${talk.index}:${talk.reply?.length ?? 0}`);
  const done = typed.length >= text.length;
  /** タイプ中なら全文表示、表示済みなら次へ */
  const advanceOrFinish = () => { if (done) onAdvance(); else finishTyping(); };

  const choices: { key: 'enter' | 'chat' | 'close' | 'apply'; label: string }[] = [];
  if (talk.phase === 'menu') {
    if (!talk.disabled) choices.push({ key: 'enter', label: `${talk.npc.room}へ入る` });
    if (!talk.disabled && talk.npc.canChat) choices.push({ key: 'chat', label: '相談する・要望を伝える' });
    if (talk.action === 'apply_change') choices.push({ key: 'apply', label: 'その内容を構成に反映する' });
    choices.push({ key: 'close', label: 'また今度' });
  }
  const [cursor, setCursor] = useState(0);
  useEffect(() => { setCursor(0); }, [talk.phase]);

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (talk.phase === 'input') inputRef.current?.focus(); }, [talk.phase]);

  // キー操作: 送り・メニュー選択・Esc
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (talk.phase === 'input') {
        if (e.key === 'Escape') { e.preventDefault(); onCancelInput(); }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); onChoose('close'); return; }
      if (talk.phase === 'menu') {
        if (e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); setCursor((c) => (c + choices.length - 1) % choices.length); }
        else if (e.key === 'ArrowDown' || e.key === 's') { e.preventDefault(); setCursor((c) => (c + 1) % choices.length); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onChoose(choices[cursor].key); }
        return;
      }
      if (talk.phase === 'lines' || talk.phase === 'reply') {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'e') { e.preventDefault(); advanceOrFinish(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [talk.phase, choices.length, cursor, onAdvance, onChoose, onCancelInput, done]);

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    onSend(t);
  };

  return (
    <div className="talk" onClick={() => { if (talk.phase === 'lines' || talk.phase === 'reply') advanceOrFinish(); }}>
      <div className="talk-name">{talk.npc.name}<span>{talk.npc.title}</span></div>
      <div className="talk-box">
        {talk.phase === 'waiting' && <div className="talk-text">……<span className="talk-dots" /></div>}
        {(talk.phase === 'lines' || talk.phase === 'reply') && (
          <div className="talk-text">
            {typed}
            {done && <span className="talk-next">▼</span>}
          </div>
        )}
        {talk.phase === 'menu' && (
          <div className="talk-menu">
            {talk.reply && <div className="talk-text small">{talk.reply}</div>}
            {choices.map((c, i) => (
              <button key={c.key} className={i === cursor ? 'active' : ''}
                onMouseEnter={() => setCursor(i)} onClick={(e) => { e.stopPropagation(); onChoose(c.key); }}>
                <span className="cur">{i === cursor ? '▶' : ''}</span>{c.label}
              </button>
            ))}
          </div>
        )}
        {talk.phase === 'input' && (
          <div className="talk-input" onClick={(e) => e.stopPropagation()}>
            <div className="muted">要望・質問を書いてください（Enter で送信 / Shift+Enter で改行 / Esc で戻る）</div>
            <textarea ref={inputRef} value={input} rows={3}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={placeholderFor(talk.npc)} />
            <div className="row tight">
              <button className="primary sm" onClick={submit} disabled={!input.trim()}>送信</button>
              <button className="ghost sm" onClick={onCancelInput}>戻る</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function placeholderFor(npc: Npc): string {
  switch (npc.id) {
    case 'chief': return '例: 2話にライバルの初登場シーンを入れたい / ペンダントの回収を3話に延ばして';
    case 'writer': return '例: 第3話はもっとクロの出番を増やして / 主人公の動機をはっきりさせたい';
    case 'artist': return '例: 見せ場のコマをもっと大きく / 1ページ目はテンポよく小ゴマで';
    case 'manager': return '例: 灰田と静の関係はどこまで描いた? / 第1話で出た設定を教えて';
    case 'meeting': return '例: 第2話の引きは十分か議論してほしい';
    default: return 'ご要望をどうぞ';
  }
}

/** タイプライター表示。key が変わると最初から打ち直す。finish() で全文表示 */
function useTypewriter(text: string, key: string): [string, () => void] {
  const [n, setN] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    setN(0);
    if (!text) return;
    let i = 0;
    timer.current = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= text.length && timer.current) clearInterval(timer.current);
    }, 22);
    return () => { if (timer.current) clearInterval(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const finish = () => { if (timer.current) clearInterval(timer.current); setN(text.length); };
  return [text.slice(0, Math.min(n, text.length)), finish];
}
