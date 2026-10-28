import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FLOOR_BY_ID, walkable, type Floor, type Npc } from './floors';
import { PLAYER, SCALE, TILE, TILES, spriteUrl } from './sprites';

const PX = TILE * SCALE; // 1タイルの画面上のサイズ

export interface PlayerState { x: number; y: number; dir: 'left' | 'right' }

interface Props {
  floor: Floor;
  player: PlayerState;
  onMove: (p: PlayerState) => void;
  /** NPC に話しかけた */
  onTalk: (npc: Npc) => void;
  /** 階段に乗った */
  onStairs: (kind: 'U' | 'V') => void;
  /** キー操作を受け付けるか（ダイアログ表示中は false） */
  active: boolean;
  /** 現在話しかけている NPC（強調表示） */
  activeNpcId?: string | null;
  /** 作業中の NPC（頭上に吹き出し） */
  busyNpcIds: Set<string>;
  /** 使えない NPC（作品未選択時など） */
  disabledNpcIds: Set<string>;
}

/**
 * オフィスのマップ。タイル描画・プレイヤー移動・NPC との会話を担当する。
 * 移動は 矢印/WASD、会話は Enter/Space/E。クリックでも歩いて話しかけられる。
 */
export function OfficeMap({
  floor, player, onMove, onTalk, onStairs, active, activeNpcId, busyNpcIds, disabledNpcIds,
}: Props) {
  const rows = floor.map.length;
  const cols = floor.map[0].length;
  const npcAt = useMemo(() => new Map(floor.npcs.map((n) => [`${n.x},${n.y}`, n])), [floor]);
  const walkTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hover, setHover] = useState<Npc | null>(null);

  const tileAt = useCallback((x: number, y: number) => floor.map[y]?.[x] ?? '#', [floor]);
  const canStep = useCallback(
    (x: number, y: number) => walkable(tileAt(x, y)) && !npcAt.has(`${x},${y}`),
    [tileAt, npcAt],
  );

  const stopWalking = () => {
    if (walkTimer.current) { clearInterval(walkTimer.current); walkTimer.current = null; }
  };
  useEffect(() => stopWalking, [floor.id]);

  const arrive = useCallback((x: number, y: number) => {
    const ch = tileAt(x, y);
    if (ch === 'U' || ch === 'V') onStairs(ch);
  }, [tileAt, onStairs]);

  const step = useCallback((dx: number, dy: number) => {
    const nx = player.x + dx;
    const ny = player.y + dy;
    const dir = dx < 0 ? 'left' : dx > 0 ? 'right' : player.dir;
    if (!canStep(nx, ny)) { onMove({ ...player, dir }); return; }
    onMove({ x: nx, y: ny, dir });
    arrive(nx, ny);
  }, [player, canStep, onMove, arrive]);

  /** 隣接する NPC（上下左右） */
  const adjacentNpc = useCallback((): Npc | null => {
    for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const n = npcAt.get(`${player.x + dx},${player.y + dy}`);
      if (n) return n;
    }
    return null;
  }, [npcAt, player]);

  // キー操作
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
        const n = adjacentNpc();
        if (n) { e.preventDefault(); onTalk(n); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, step, adjacentNpc, onTalk]);

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
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
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
      cur = { x: nxt.x, y: nxt.y, dir: nxt.x < cur.x ? 'left' : nxt.x > cur.x ? 'right' : cur.dir };
      onMove(cur);
    };
    tick();
    walkTimer.current = setInterval(tick, 90);
  };

  const clickNpc = (npc: Npc) => {
    // 隣接タイルのうち歩ける最も近いものへ
    const targets = [[0, 1], [0, -1], [-1, 0], [1, 0]]
      .map(([dx, dy]) => ({ x: npc.x + dx, y: npc.y + dy }))
      .filter((t) => canStep(t.x, t.y))
      .sort((a, b) => dist(a, player) - dist(b, player));
    if (!targets.length) { onTalk(npc); return; }
    if (targets.some((t) => t.x === player.x && t.y === player.y)) { onTalk(npc); return; }
    walkTo(targets[0], () => onTalk(npc));
  };

  const clickTile = (x: number, y: number) => {
    if (!active) return;
    const npc = npcAt.get(`${x},${y}`);
    if (npc) { clickNpc(npc); return; }
    if (canStep(x, y)) walkTo({ x, y });
  };

  return (
    <div
      className="office-map"
      style={{ width: cols * PX, height: rows * PX }}
      role="application"
      aria-label={`${floor.label}のマップ`}
    >
      {floor.map.map((row, y) =>
        row.split('').map((ch, x) => (
          <div
            key={`${x},${y}`}
            className={`tile ${walkable(ch) ? 'walkable' : ''}`}
            style={{
              left: x * PX, top: y * PX, width: PX, height: PX,
              backgroundImage: `url(${spriteUrl(TILES[ch] ?? TILES['.'], `tile:${ch}`)})`,
            }}
            onClick={() => clickTile(x, y)}
          />
        )),
      )}

      {floor.npcs.map((n) => {
        const disabled = disabledNpcIds.has(n.id);
        const busy = busyNpcIds.has(n.id);
        return (
          <div
            key={n.id}
            className={`actor npc ${activeNpcId === n.id ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
            style={{ left: n.x * PX + (PX - 12 * SCALE) / 2, top: n.y * PX - 8 * SCALE + PX - 16 * SCALE + 8 * SCALE }}
            onClick={() => clickNpc(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
            title={`${n.name}: ${n.hint}`}
          >
            <div className="sprite" style={{ backgroundImage: `url(${spriteUrl(n.sprite, `npc:${n.id}`)})` }} />
            <div className="name">{n.name}</div>
            {busy && <div className="bubble">作業中…</div>}
            {!busy && adjacentTo(player, n) && active && <div className="bubble key">Enter で話す</div>}
          </div>
        );
      })}

      <div
        className={`actor player ${player.dir}`}
        style={{ left: player.x * PX + (PX - 12 * SCALE) / 2, top: player.y * PX - 8 * SCALE + PX - 16 * SCALE + 8 * SCALE }}
      >
        <div className="sprite" style={{ backgroundImage: `url(${spriteUrl(PLAYER, 'player')})` }} />
      </div>

      {hover && (
        <div className="office-hint">
          <strong>{hover.name}</strong>（{hover.title}）— {hover.hint}
        </div>
      )}
    </div>
  );
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

function adjacentTo(p: { x: number; y: number }, n: { x: number; y: number }) {
  return dist(p, n) === 1;
}

export { FLOOR_BY_ID };
