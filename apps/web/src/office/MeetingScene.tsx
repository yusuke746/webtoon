import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job } from '@manga/shared';
import { api, type DiscussionWithMessages } from '../api';
import { useTypewriter } from './TalkWindow';

/**
 * 4F の AI 編集会議を «部屋の中の場面» として再生する。
 *
 * 発言はサーバー側でバックグラウンド生成され DB に溜まる。ここではそれをポーリングし、
 * 発言者（編集者・プロット担当・読者代表）の頭上に吹き出しを出しながら、1発言ずつ会話ウィンドウで読ませる。
 * まとめ役の合意案まで来たら、司会が提案を読み上げ、採否・介入をその場で決める。
 */

/** 発言の役割名 → 4F の NPC id */
export const SPEAKER_NPC: Record<string, string> = {
  '編集者': 'editor', 'プロット担当': 'plotter', '読者代表': 'reader', 'まとめ役': 'meeting', '司会': 'meeting',
};

export interface MeetingBubble { npcId: string; text: string; kind: 'say' | 'think' }

interface Props {
  discussionId: number;
  /** begin: 最初から再生 / end: 結論から（判断待ちの会議を開くとき） */
  startAt: 'begin' | 'end';
  /** 進行中のジョブ（次の発言者を知るため） */
  jobs: Job[];
  onBubbles: (b: MeetingBubble[]) => void;
  onJob: (job: Job) => void;
  onDecided: () => void;
  onClose: () => void;
}

type Mode = 'line' | 'waiting' | 'menu' | 'input' | 'busy';
interface Line { speaker: string; title?: string; text: string; npcId: string | null }

const STATUS_JA: Record<string, string> = { adopted: '採用済み', rejected: '不採用' };

export function MeetingScene({ discussionId, startAt, jobs, onBubbles, onJob, onDecided, onClose }: Props) {
  const [d, setD] = useState<DiscussionWithMessages | null>(null);
  /** 何番目の台詞まで読んだか（-1 = 司会の開会、messages.length = 司会の締め） */
  const [idx, setIdx] = useState<number>(startAt === 'begin' ? -1 : Number.MAX_SAFE_INTEGER);
  const [mode, setMode] = useState<Mode>('line');
  const [cursor, setCursor] = useState(0);
  const [input, setInput] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [closing, setClosing] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const load = useCallback(async () => {
    try {
      const data = await api.getDiscussion(discussionId);
      setD(data);
      // 「結論から」開いたときは末尾に合わせる（以後に増えた発言はそこから順に読める）
      setIdx((i) => (i > data.messages.length ? data.messages.length : i));
    } catch (e) { setError((e as Error).message); }
  }, [discussionId]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!d || d.status !== 'running') return;
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [d, load]);

  const msgs = d?.messages ?? [];
  const total = msgs.length;
  const cur = Math.min(idx, total);
  const running = d?.status === 'running';
  const awaiting = d?.status === 'awaiting_user';

  /** 次の発言者（ジョブのステップ「ラウンド2: 編集者が発言中…」から拾う） */
  const job = jobs.find((j) => j.kind === 'discussion' && j.resultRef === `discussion:${discussionId}`) ?? jobs.find((j) => j.kind === 'discussion');
  const nextSpeaker = job?.step.match(/: (.+?)が発言中/)?.[1] ?? (job?.step.includes('合意') ? 'まとめ役' : null);

  /** いま表示する台詞 */
  const line: Line | null = (() => {
    if (!d) return null;
    if (closing) return { speaker: '司会', text: closing, npcId: 'meeting' };
    if (cur < 0) return { speaker: '司会', text: `では始めます。議題は「${d.topic}」。\n編集者・プロット担当・読者代表の順に意見をもらいます。`, npcId: 'meeting' };
    if (cur < total) {
      const m = msgs[cur];
      const npcId = SPEAKER_NPC[m.roleName] ?? null;
      return { speaker: m.roleName === 'ユーザー' ? 'あなた' : m.roleName, title: `ラウンド${m.round}`, text: m.content, npcId };
    }
    if (running) return { speaker: '司会', text: `（${nextSpeaker ?? '次の発言者'}が考えています…）`, npcId: 'meeting' };
    if (awaiting) return { speaker: '司会', text: `合意案はこうです。\n${d.proposal ?? d.summary ?? '（提案なし）'}\n\nどうしますか。`, npcId: 'meeting' };
    return { speaker: '司会', text: `この会議は${STATUS_JA[d.status] ?? d.status}です。${d.summary ? `\n結論: ${d.summary}` : ''}`, npcId: 'meeting' };
  })();

  const lineKey = `${discussionId}:${cur}:${closing ? 'c' : ''}:${line?.text.length ?? 0}`;
  const [typed, finish] = useTypewriter(line?.text ?? '', lineKey);
  const done = typed.length >= (line?.text.length ?? 0);

  // 待ちの間に新しい発言が来たら自動で進める
  useEffect(() => {
    if (mode === 'waiting' && cur < total) setMode('line');
  }, [mode, cur, total]);

  // 吹き出し: 話している人は台詞の頭、考え中の人は「…」
  useEffect(() => {
    const b: MeetingBubble[] = [];
    if (line?.npcId && line.npcId !== 'meeting' && !closing) b.push({ npcId: line.npcId, text: clip(line.text, 16), kind: 'say' });
    if (running && cur >= total && nextSpeaker && SPEAKER_NPC[nextSpeaker]) b.push({ npcId: SPEAKER_NPC[nextSpeaker], text: '…', kind: 'think' });
    onBubbles(b);
    return () => onBubbles([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey, running, nextSpeaker, closing]);

  const choices: { key: string; label: string }[] = closing
    ? [{ key: 'close', label: '会議室を出る' }]
    : awaiting
      ? [
        { key: 'adopt_apply', label: '採用して構成に反映する' },
        { key: 'adopt', label: '採用する（構成には反映しない）' },
        { key: 'intervene', label: '意見を言って、もう一度議論してもらう' },
        { key: 'reject', label: '不採用にする' },
        { key: 'later', label: '後で決める' },
      ]
      : [{ key: 'close', label: '会議室を出る' }];

  const advance = useCallback(() => {
    if (!d || mode !== 'line') return;
    if (!done) { finish(); return; }
    if (closing) { setMode('menu'); return; }
    if (cur < total) {
      if (cur + 1 < total) { setIdx(cur + 1); return; }
      // 最後の発言を読み終えた
      setIdx(total);
      setMode(running ? 'waiting' : 'menu');
      return;
    }
    if (cur < 0) { setIdx(0); if (!total) setMode(running ? 'waiting' : 'menu'); return; }
    setMode(running ? 'waiting' : 'menu');
  }, [d, mode, done, finish, closing, cur, total, running]);

  // 「考えています…」のまま進行したら、次の発言が来た時点で line に戻す（上の effect）。
  // 待ち状態でも Enter を押したら最新の発言へ飛べる。
  const choose = useCallback(async (key: string) => {
    if (!d) return;
    setError(null);
    if (key === 'close' || key === 'later') { onClose(); return; }
    if (key === 'intervene') { setMode('input'); setTimeout(() => inputRef.current?.focus(), 30); return; }
    setMode('busy');
    try {
      if (key === 'adopt_apply') { await api.decide(d.id, true, true); setClosing('承知しました。提案を構成に反映しておきます。構成と伏線を確認してください。'); }
      else if (key === 'adopt') { await api.decide(d.id, true, false); setClosing('採用ですね。反映は別途、編集長か脚本家に伝えてください。'); }
      else if (key === 'reject') { await api.decide(d.id, false, false); setClosing('不採用、了解しました。別の議題があればまた開きます。'); }
      await load();
      onDecided();
      setMode('line');
    } catch (e) { setError((e as Error).message); setMode('menu'); }
  }, [d, load, onClose, onDecided]);

  const submit = useCallback(async () => {
    const text = input.trim();
    if (!d || !text) return;
    setMode('busy');
    try {
      const { job: j } = await api.intervene(d.id, text);
      onJob(j);
      setInput('');
      await load();
      setIdx((i) => Math.min(i, total)); // ユーザーの発言から再生
      setMode('line');
    } catch (e) { setError((e as Error).message); setMode('menu'); }
  }, [d, input, load, onJob, total]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') && e.key !== 'Escape') return;
      if (e.key === 'Escape') { e.preventDefault(); if (mode === 'input') setMode('menu'); else onClose(); return; }
      if (mode === 'menu') {
        if (e.key === 'ArrowUp' || e.key === 'w') { e.preventDefault(); setCursor((c) => (c + choices.length - 1) % choices.length); }
        else if (e.key === 'ArrowDown' || e.key === 's') { e.preventDefault(); setCursor((c) => (c + 1) % choices.length); }
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(choices[cursor].key); }
        return;
      }
      if (mode === 'line' && (e.key === 'Enter' || e.key === ' ' || e.key === 'e')) { e.preventDefault(); advance(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, choices, cursor, choose, advance, onClose]);

  if (!d) {
    return (
      <div className="talk meeting"><div className="talk-name">司会<span>AI編集会議</span></div>
        <div className="talk-box"><div className="talk-text">{error ?? '会議室の記録を開いています…'}</div></div></div>
    );
  }

  const roleClass = line?.npcId ?? 'user';
  return (
    <div className={`talk meeting ${mode === 'menu' ? 'wide' : ''}`} onClick={() => { if (mode === 'line') advance(); }}>
      <div className={`talk-name role-${roleClass}`}>{line?.speaker}<span>{line?.title ?? `AI編集会議 ${cur >= 0 && total ? `${Math.min(cur + 1, total)}/${total}` : ''}`}</span></div>
      <div className="talk-box">
        {error && <div className="talk-text small">{error}</div>}
        {(mode === 'line' || mode === 'waiting') && (
          <div className="talk-text">
            {typed}
            {done && mode === 'line' && <span className="talk-next">▼</span>}
            {mode === 'waiting' && <span className="talk-dots" />}
          </div>
        )}
        {mode === 'busy' && <div className="talk-text">……<span className="talk-dots" /></div>}
        {mode === 'menu' && (
          <div className="talk-menu">
            {awaiting && !closing && d.summary && <div className="talk-text small">まとめ: {d.summary}</div>}
            {choices.map((c, i) => (
              <button key={c.key} className={i === cursor ? 'active' : ''} onMouseEnter={() => setCursor(i)}
                onClick={(e) => { e.stopPropagation(); choose(c.key); }}>
                <span className="cur">{i === cursor ? '▶' : ''}</span>{c.label}
              </button>
            ))}
          </div>
        )}
        {mode === 'input' && (
          <div className="talk-input" onClick={(e) => e.stopPropagation()}>
            <div className="muted">あなたの意見を書いてください。追加ラウンドのあと合意案を作り直します（Enter で送信 / Esc で戻る）</div>
            <textarea ref={inputRef} value={input} rows={3} onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder="例: ライバルの登場はもっと後にしたい / 第1話の引きは今のままで十分だと思う" />
            <div className="row tight">
              <button className="primary sm" onClick={submit} disabled={!input.trim()}>送信</button>
              <button className="ghost sm" onClick={() => setMode('menu')}>戻る</button>
            </div>
          </div>
        )}
        {mode === 'waiting' && <div className="talk-hint">Esc で会議室を出ても、発言は続きます。司会に話しかければ続きから見られます。</div>}
      </div>
    </div>
  );
}

function clip(t: string, n: number) { const s = t.replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n)}…` : s; }
