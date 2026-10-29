import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { walkable, type Floor, type Npc } from './floors';
import { ACTOR_H, SCALE, TILE, actorUrl, tileUrl, type Facing, type Frame } from './sprites';
import { cellFor, loadSpriteCells, type SpriteCells } from './spriteSheet';

const PX = TILE * SCALE; // 1タイル
const AW = 16 * SCALE; // 人物の幅
const AH = ACTOR_H * SCALE; // 人物の高さ

export interface PlayerState { x: number; y: number; facing: Facing }

interface Props {
  floor: Floor;
  player: PlayerState;
  onMove: (p: PlayerState) => void;
  onTalk: (npc: Npc) => void;
  onStairs: (kind: 'U' | 'V') => void;
  /** キー操作を受け付けるか（会話・ダイアログ中は false） */
  active: boolean;
  activeNpcId?: string | null;
  busyNpcIds: Set<string>;
  disabledNpcIds: Set<string>;
  /** 報告待ち（頼んだ仕事が終わった）NPC */
  reportNpcIds: Set<string>;
  /** 会議などで頭上に出す吹き出し（NPC id → 文言） */
  bubbles?: Record<string, { text: string; kind: 'say' | 'think' }>;
  /** 画像生成で描き直したフロアの絵（あればタイルの代わりに背景に敷く） */
  artUrl?: string | null;
  /** 画像生成で描き直した人物のスプライトシート（NPC id または 'player' → シートの URL） */
  spriteSheets?: Record<string, string>;
}

const DIRS: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

/**
 * オフィスのマップ。タイル描画・プレイヤー移動（歩行アニメ付き）・NPC との会話を担当する。
 * 移動は 矢印/WASD、会話は Enter/Space/E。クリックでも歩いて話しかけられる。
 */
export function OfficeMap({
  floor, player, onMove, onTalk, onStairs, active, activeNpcId, busyNpcIds, disabledNpcIds, reportNpcIds, bubbles, artUrl, spriteSheets,
}: Props) {
  const rows = floor.map.length;
  const cols = floor.map[0].length;
  /** 表示位置（作業中は机の前） */
  const posOf = useCallback((n: Npc) => (busyNpcIds.has(n.id) && n.desk ? { x: n.desk.x, y: n.desk.y } : { x: n.x, y: n.y }), [busyNpcIds]);
  const npcAt = useMemo(() => new Map(floor.npcs.map((n) => { const q = posOf(n); return [`${q.x},${q.y}`, n]; })), [floor, posOf]);
  const walkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const frameTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [frame, setFrame] = useState<Frame>(0);
  const [hover, setHover] = useState<Npc | null>(null);
  // 描き直したスプライトは、シートを 3×3 に切って透過したセルで差し替える
  const [cells, setCells] = useState<Record<string, SpriteCells>>({});
  useEffect(() => {
    let alive = true;
    const entries = Object.entries(spriteSheets ?? {});
    Promise.all(entries.map(async ([id, url]) => [id, await loadSpriteCells(url).catch(() => undefined)] as const))
      .then((list) => { if (alive) setCells(Object.fromEntries(list.filter((x): x is readonly [string, SpriteCells] => !!x[1]))); });
    return () => { alive = false; };
  }, [spriteSheets]);
  const spriteOf = (id: string, look: Parameters<typeof actorUrl>[0], facing: Facing, fr: Frame) => cellFor(cells[id], facing, fr) ?? actorUrl(look, facing, fr);

  const tileAt = useCallback((x: number, y: number) => floor.map[y]?.[x] ?? '#', [floor]);
  const canStep = useCallback(
    (x: number, y: number) => walkable(tileAt(x, y)) && !npcAt.has(`${x},${y}`),
    [tileAt, npcAt],
  );

  const stopWalking = () => {
    if (walkTimer.current) { clearInterval(walkTimer.current); walkTimer.current = null; }
  };
  useEffect(() => () => { stopWalking(); if (frameTimer.current) clearTimeout(frameTimer.current); }, [floor.id]);

  /** 1歩ぶんの歩行フレーム（1→2 と交互に。少し経つと立ち姿へ戻る） */
  const bump = useCallback(() => {
    setFrame((f) => (f === 1 ? 2 : 1));
    if (frameTimer.current) clearTimeout(frameTimer.current);
    frameTimer.current = setTimeout(() => setFrame(0), 180);
  }, []);

  const arrive = useCallback((x: number, y: number) => {
    const ch = tileAt(x, y);
    if (ch === 'U' || ch === 'V') onStairs(ch);
  }, [tileAt, onStairs]);

  const facingOf = (dx: number, dy: number, prev: Facing): Facing =>
    dx < 0 ? 'left' : dx > 0 ? 'right' : dy < 0 ? 'up' : dy > 0 ? 'down' : prev;

  const step = useCallback((dx: number, dy: number) => {
    const nx = player.x + dx;
    const ny = player.y + dy;
    const facing = facingOf(dx, dy, player.facing);
    if (!canStep(nx, ny)) { onMove({ ...player, facing }); return; }
    onMove({ x: nx, y: ny, facing });
    bump();
    arrive(nx, ny);
  }, [player, canStep, onMove, arrive, bump]);

  /** 向いている先、または隣接する NPC */
  const facingNpc = useCallback((): Npc | null => {
    const ahead: Record<Facing, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const [dx, dy] = ahead[player.facing];
    const front = npcAt.get(`${player.x + dx},${player.y + dy}`);
    if (front) return front;
    for (const [ax, ay] of DIRS) {
      const n = npcAt.get(`${player.x + ax},${player.y + ay}`);
      if (n) return n;
    }
    return null;
  }, [npcAt, player]);

  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
      const k = e.key.toLowerCase();
      const map: Record<string, [number, number]> = {
        arrowup: [0, -1], w: [0, -1], arrowdown: [0, 1], s: [0, 1],
        arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0],
      };
      if (map[k]) { e.preventDefault(); stopWalking(); step(...map[k]); return; }
      if (k === 'enter' || k === ' ' || k === 'e') {
        const n = facingNpc();
        if (n) { e.preventDefault(); onTalk(n); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step, facingNpc, onTalk]);

  /** BFS で経路を求め、1タイルずつ歩く。到着後に after() */
  const walkTo = (goal: { x: number; y: number }, after?: () => void) => {
    stopWalking();
    const key = (x: number, y: number) => `${x},${y}`;
    const prev = new Map<string, string | null>([[key(player.x, player.y), null]]);
    const queue = [{ x: player.x, y: player.y }];
    let found = false;
    while (queue.length) {
      const cur = queue.shift()!;
      if (cur.x === goal.x && cur.y === goal.y) { found = true; break; }
      for (const [dx, dy] of DIRS) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!canStep(nx, ny) || prev.has(key(nx, ny))) continue;
        prev.set(key(nx, ny), key(cur.x, cur.y));
        queue.push({ x: nx, y: ny });
      }
    }
    if (!found) return;
    const path: { x: number; y: number }[] = [];
    let k: string | null = key(goal.x, goal.y);
    while (k && k !== key(player.x, player.y)) {
      const [x, y] = k.split(',').map(Number);
      path.unshift({ x, y });
      k = prev.get(k) ?? null;
    }
    let cur = { ...player };
    let i = 0;
    const tick = () => {
      if (i >= path.length) { stopWalking(); arrive(cur.x, cur.y); after?.(); return; }
      const nxt = path[i++];
      cur = { x: nxt.x, y: nxt.y, facing: facingOf(nxt.x - cur.x, nxt.y - cur.y, cur.facing) };
      onMove(cur);
      bump();
    };
    tick();
    walkTimer.current = setInterval(tick, 110);
  };

  const clickNpc = (npc: Npc) => {
    const q = posOf(npc);
    const targets = DIRS
      .map(([dx, dy]) => ({ x: q.x + dx, y: q.y + dy }))
      .filter((t) => canStep(t.x, t.y))
      .sort((a, b) => dist(a, player) - dist(b, player));
    const face = () => onMove({ ...player, x: player.x, y: player.y, facing: facingOf(q.x - player.x, q.y - player.y, player.facing) });
    if (!targets.length) { onTalk(npc); return; }
    if (targets.some((t) => t.x === player.x && t.y === player.y)) { face(); onTalk(npc); return; }
    walkTo(targets[0], () => onTalk(npc));
  };

  const clickTile = (x: number, y: number) => {
    if (!active) return;
    const npc = npcAt.get(`${x},${y}`);
    if (npc) { clickNpc(npc); return; }
    if (canStep(x, y)) walkTo({ x, y });
  };

  /** NPC の向き: 作業中は机の方、プレイヤーが隣にいればそちらを向く */
  const npcFacing = (n: Npc): Facing => {
    const q = posOf(n);
    if (busyNpcIds.has(n.id) && n.desk) return n.desk.facing;
    if (dist(q, player) !== 1) return n.idleFacing ?? 'down';
    return facingOf(player.x - q.x, player.y - q.y, n.idleFacing ?? 'down');
  };

  const actorStyle = (x: number, y: number) => ({ left: x * PX + (PX - AW) / 2, top: y * PX + PX - AH + 2 });

  return (
    <div className={`office-map ${artUrl ? 'has-art' : ''}`} style={{ width: cols * PX, height: rows * PX }} role="application" aria-label={`${floor.label}のマップ`}>
      {artUrl && <img className="office-art" src={artUrl} alt="" draggable={false} />}
      {floor.map.map((row, y) =>
        row.split('').map((ch, x) => {
          // 窓の下の家具は光の床の上に置く
          const under = row[x] === '~' || (y > 0 && floor.map[y - 1][x] === 'W') ? '~' : '.';
          return (
            <div
              key={`${x},${y}`}
              className={`tile ${walkable(ch) ? 'walkable' : ''}`}
              style={{ left: x * PX, top: y * PX, width: PX, height: PX, backgroundImage: artUrl ? undefined : `url(${tileUrl(ch, under)})` }}
              onClick={() => clickTile(x, y)}
            />
          );
        }),
      )}

      {floor.npcs.map((n) => {
        const disabled = disabledNpcIds.has(n.id);
        const busy = busyNpcIds.has(n.id);
        const facing = npcFacing(n);
        const q = posOf(n);
        return (
          <div
            key={n.id}
            className={`actor npc ${facing} ${activeNpcId === n.id ? 'active' : ''} ${disabled ? 'disabled' : ''} ${busy ? 'busy' : ''}`}
            style={{ ...actorStyle(q.x, q.y), zIndex: 2 + q.y }}
            onClick={() => clickNpc(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
            title={`${n.name}: ${n.hint}`}
          >
            <div className="shadow" />
            <div className="sprite" style={{ backgroundImage: `url(${spriteOf(n.id, n.look, facing, 0)})` }} />
            <div className="name">{n.name}</div>
            {bubbles?.[n.id] && <div className={`bubble ${bubbles[n.id].kind}`}>{bubbles[n.id].text}</div>}
            {!bubbles?.[n.id] && busy && <div className="bubble">{n.participant ? '…' : '作業中…'}</div>}
            {!bubbles?.[n.id] && !busy && reportNpcIds.has(n.id) && <div className="bubble report">!</div>}
            {!bubbles?.[n.id] && !busy && active && dist(player, q) === 1 && <div className="bubble key">Enter</div>}
          </div>
        );
      })}

      <div className={`actor player ${player.facing}`} style={{ ...actorStyle(player.x, player.y), zIndex: 2 + player.y + 1 }}>
        <div className="shadow" />
        <div className="sprite" style={{ backgroundImage: `url(${spriteOf('player', PLAYER_LOOK, player.facing, frame)})` }} />
      </div>

      {hover && active && (
        <div className="office-hint">
          <strong>{hover.name}</strong>（{hover.title}）— {hover.hint}
        </div>
      )}
    </div>
  );
}

export const PLAYER_LOOK = { hair: '#2b2b3a', cloth: '#4f6fd6', hairStyle: 'short' as const };

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
