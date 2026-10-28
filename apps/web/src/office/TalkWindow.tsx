import { useEffect, useRef, useState } from 'react';
import type { Npc } from './floors';
import type { Choice } from './workflow';

/**
 * スーファミ RPG 風の会話ウィンドウ。
 * - 台詞をタイプライター表示（Enter/クリックで送り。タイプ中なら全文表示）
 * - メニュー（選択肢は呼び出し側が決める）
 * - 成果物（シーン構成・原稿）を窓の中に表示してから選択肢
 * - テキスト入力（相談・修正指示）
 */

export type TalkPhase = 'lines' | 'menu' | 'deliver' | 'input' | 'waiting' | 'reply';

export interface TalkState {
  npc: Npc;
  lines: string[];
  index: number;
  phase: TalkPhase;
  choices: Choice[];
  /** 成果物の表示（deliver / menu のとき窓の上部に出す） */
  content?: React.ReactNode;
  reply: string | null;
  /** 入力の用途（chat / scenes / panels / structure） */
  inputPurpose: string;
  inputHint: string;
  lastMessage: string;
  history: { role: 'user' | 'npc'; text: string }[];
  /** 直前に受け取った提案（「案Nを構成に反映する」で使う） */
  proposals?: { title: string; detail: string; instruction: string }[];
}

interface Props {
  talk: TalkState;
  onAdvance: () => void;
  onChoose: (key: string) => void;
  onSend: (text: string) => void;
  onCancelInput: () => void;
}

export function TalkWindow({ talk, onAdvance, onChoose, onSend, onCancelInput }: Props) {
  const text = talk.phase === 'reply' ? (talk.reply ?? '') : talk.phase === 'lines' ? talk.lines[talk.index] ?? '' : '';
  const [typed, finishTyping] = useTypewriter(text, `${talk.npc.id}:${talk.phase}:${talk.index}:${talk.reply?.length ?? 0}`);
  const done = typed.length >= text.length;
  const advanceOrFinish = () => { if (done) onAdvance(); else finishTyping(); };

  const showMenu = talk.phase === 'menu' || talk.phase === 'deliver';
  const choices = showMenu ? talk.choices : [];
  const [cursor, setCursor] = useState(0);
  useEffect(() => { setCursor(0); }, [talk.phase, talk.choices]);

  const [input, setInput] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { if (talk.phase === 'input') inputRef.current?.focus(); }, [talk.phase]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA' || el.tagName === 'LABEL') && e.key !== 'Escape') return;
      if (talk.phase === 'input') {
        if (e.key === 'Escape') { e.preventDefault(); onCancelInput(); }
        return;
      }
      if (e.key === 'Escape') { e.preventDefault(); onChoose('close'); return; }
      if (showMenu) {
        if (!choices.length) return;
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
  }, [talk.phase, choices, cursor, onAdvance, onChoose, onCancelInput, done, showMenu]);

  const submit = () => {
    const t = input.trim();
    if (!t) return;
    setInput('');
    onSend(t);
  };

  return (
    <div className={`talk ${talk.phase === 'deliver' || (talk.phase === 'menu' && talk.content) ? 'wide' : ''}`}
      onClick={() => { if (talk.phase === 'lines' || talk.phase === 'reply') advanceOrFinish(); }}>
      <div className="talk-name">{talk.npc.name}<span>{talk.npc.title}</span></div>
      <div className="talk-box">
        {talk.phase === 'waiting' && <div className="talk-text">……<span className="talk-dots" /></div>}
        {(talk.phase === 'lines' || talk.phase === 'reply') && (
          <div className="talk-text">
            {typed}
            {done && <span className="talk-next">▼</span>}
          </div>
        )}
        {showMenu && (
          <div className="talk-menu">
            {talk.content && <div className="talk-content" onClick={(e) => e.stopPropagation()}>{talk.content}</div>}
            {talk.reply && !talk.content && <div className="talk-text small">{talk.reply}</div>}
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
            <div className="muted">{talk.inputPurpose === 'chat' ? '要望・質問を書いてください' : '直してほしい点を書いてください'}（Enter で送信 / Shift+Enter で改行 / Esc で戻る）</div>
            <textarea ref={inputRef} value={input} rows={3}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={talk.inputHint} />
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
