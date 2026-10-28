import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { Job } from '@manga/shared';
import { api } from '../api';
import { FLOORS, FLOOR_BY_ID, npcForPath, type Floor, type Npc } from './floors';
import { OfficeMap, type PlayerState } from './OfficeMap';
import { npcLines, type OfficeStatus } from './dialogue';
import { TalkWindow, type TalkState } from './TalkWindow';

/**
 * RPG 風オフィスのシェル。
 *
 * サイドバーの代わりにオフィスのマップが常に表示され、NPC に話しかけると
 * 会話ウィンドウ（定型文 → メニュー → 相談）が開き、「部屋に入る」で既存ページが
 * ダイアログ（部屋の中身）として開く。URL は従来のまま。
 *   /office                      … マップのみ（作品未選択）
 *   /projects/:id/office         … マップのみ（作品選択中）
 *   /projects/:id/characters 等   … マップ + 部屋ダイアログ
 */
export function OfficeLayout({ children }: { children: React.ReactNode }) {
  const { projectId: pid, episodeId } = useParams();
  const projectId = pid ? Number(pid) : null;
  const location = useLocation();
  const navigate = useNavigate();

  const isBase = /^\/office\/?$/.test(location.pathname) || /^\/projects\/\d+\/office\/?$/.test(location.pathname);
  const current = useMemo(() => npcForPath(location.pathname), [location.pathname]);
  const dialogOpen = !isBase;

  // 作品の状態（ヘッダ表示と NPC の定型文に使う）
  const [status, setStatus] = useState<OfficeStatus | null>(null);
  const loadStatus = useCallback(async () => {
    if (!projectId) { setStatus(null); return; }
    try {
      const [project, episodes, characters, backgrounds, warnings, discussions, archive, styles] = await Promise.all([
        api.getProject(projectId), api.listEpisodes(projectId), api.listCharacters(projectId),
        api.listBackgrounds(projectId), api.foreshadowWarnings(projectId), api.listDiscussions(projectId),
        api.getArchive(projectId).catch(() => null), api.listArtStyles(projectId).catch(() => []),
      ]);
      const style = styles.find((s) => s.id === project.artStyleId) ?? null;
      setStatus({ project, episodes, characters, backgrounds, warnings, discussions, archive, artStyleName: style?.name ?? null });
    } catch {
      setStatus(null);
    }
  }, [projectId]);
  // ページ（部屋）で何か変えた後に戻ってきたら読み直す
  useEffect(() => { loadStatus(); }, [loadStatus, location.pathname]);

  // 直近に開いた話（漫画家に話しかけたとき、その話のネームへ）
  useEffect(() => {
    if (projectId && episodeId) localStorage.setItem(`office:lastEpisode:${projectId}`, episodeId);
  }, [projectId, episodeId]);

  // 現在の階とプレイヤー位置（セッション内で保持）
  const [floorId, setFloorId] = useState<string>(() => sessionStorage.getItem('office:floor') ?? '1F');
  const [player, setPlayer] = useState<PlayerState>(() => {
    const saved = sessionStorage.getItem('office:player');
    const p = saved ? JSON.parse(saved) : null;
    return p?.facing ? p : { ...FLOOR_BY_ID['1F'].spawn, facing: 'down' };
  });
  useEffect(() => { sessionStorage.setItem('office:floor', floorId); }, [floorId]);
  useEffect(() => { sessionStorage.setItem('office:player', JSON.stringify(player)); }, [player]);

  // ダイアログを開いている NPC の階へ合わせる（リンクで直接来た場合も含む）
  useEffect(() => {
    if (current && current.floor.id !== floorId) {
      setFloorId(current.floor.id);
      setPlayer({ x: current.npc.x, y: current.npc.y + 1, facing: 'up' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.npc.id]);

  // 作品未選択のときは 1F（受付）だけ
  useEffect(() => { if (!projectId && floorId !== '1F') { setFloorId('1F'); setPlayer({ ...FLOOR_BY_ID['1F'].spawn, facing: 'down' }); } }, [projectId, floorId]);
  const floor: Floor = (projectId ? FLOOR_BY_ID[floorId] : FLOOR_BY_ID['1F']) ?? FLOOR_BY_ID['1F'];

  // 作業中ジョブ → NPC の頭上に表示
  const [jobs, setJobs] = useState<Job[]>([]);
  useEffect(() => {
    if (!projectId) { setJobs([]); return; }
    let alive = true;
    const poll = () => api.listActiveJobs(projectId).then((j) => alive && setJobs(j)).catch(() => undefined);
    poll();
    const t = setInterval(poll, 4000);
    return () => { alive = false; clearInterval(t); };
  }, [projectId, location.pathname]);
  const busyNpcIds = useMemo(() => {
    const kinds = new Set(jobs.map((j) => j.kind as string));
    const ids = new Set<string>();
    for (const f of FLOORS) for (const n of f.npcs) if (n.jobKinds?.some((k) => kinds.has(k))) ids.add(n.id);
    return ids;
  }, [jobs]);

  const disabledNpcIds = useMemo(() => {
    const ids = new Set<string>();
    if (!projectId) for (const f of FLOORS) for (const n of f.npcs) if (!n.global) ids.add(n.id);
    return ids;
  }, [projectId]);

  // 一言メッセージ
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2800);
  }, []);

  const basePath = projectId ? `/projects/${projectId}/office` : '/office';

  // ---- 会話 ----
  const [talk, setTalk] = useState<TalkState | null>(null);

  const routeFor = useCallback((npc: Npc): string => {
    let route = npc.route.replace('{p}', String(projectId ?? ''));
    if (route.includes('{e}')) {
      const last = projectId ? localStorage.getItem(`office:lastEpisode:${projectId}`) : null;
      if (!last) { say('どの話を描くか、先に2Fの脚本家と決めてください。'); return `/projects/${projectId}/episodes`; }
      route = route.replace('{e}', last);
    }
    return route;
  }, [projectId, say]);

  const startTalk = useCallback((npc: Npc) => {
    const disabled = disabledNpcIds.has(npc.id);
    setTalk({
      npc, lines: npcLines(npc, status), index: 0, phase: 'lines', reply: null, action: null,
      lastMessage: '', history: [], disabled,
    });
  }, [disabledNpcIds, status]);

  const advance = useCallback(() => {
    setTalk((t) => {
      if (!t) return t;
      if (t.phase === 'reply') return { ...t, phase: 'menu' };
      if (t.phase !== 'lines') return t;
      if (t.index + 1 < t.lines.length) return { ...t, index: t.index + 1 };
      return { ...t, phase: 'menu' };
    });
  }, []);

  const choose = useCallback((choice: 'enter' | 'chat' | 'close' | 'apply') => {
    if (!talk) return;
    if (choice === 'close') { setTalk(null); return; }
    if (choice === 'enter') { setTalk(null); navigate(routeFor(talk.npc)); return; }
    if (choice === 'chat') { setTalk({ ...talk, phase: 'input', reply: null, action: null }); return; }
    if (choice === 'apply' && projectId) {
      setTalk({ ...talk, phase: 'waiting', action: null });
      api.applyChange(projectId, talk.lastMessage)
        .then(() => { setTalk((t) => t && { ...t, phase: 'reply', reply: '反映した。構成と伏線を確認してくれ。', action: null }); loadStatus(); })
        .catch((e: Error) => setTalk((t) => t && { ...t, phase: 'reply', reply: `反映に失敗した: ${e.message}`, action: null }));
    }
  }, [talk, navigate, routeFor, projectId, loadStatus]);

  const send = useCallback((text: string) => {
    if (!talk || !projectId) return;
    const history = [...talk.history, { role: 'user' as const, text }];
    setTalk({ ...talk, phase: 'waiting', lastMessage: text, history });
    api.talk(projectId, talk.npc.id, text, talk.history)
      .then((r) => setTalk((t) => t && { ...t, phase: 'reply', reply: r.reply, action: r.action, history: [...history, { role: 'npc', text: r.reply }] }))
      .catch((e: Error) => setTalk((t) => t && { ...t, phase: 'reply', reply: `（返事がもらえませんでした: ${e.message}）`, action: null }));
  }, [talk, projectId]);

  const cancelInput = useCallback(() => setTalk((t) => t && { ...t, phase: 'menu' }), []);

  const stairs = useCallback((kind: 'U' | 'V') => {
    if (!projectId) { say('担当作品を決めると上の階へ行けます。受付へどうぞ。'); return; }
    const to = floor.stairs[kind];
    if (!to) return;
    const dest = FLOOR_BY_ID[to];
    setFloorId(to);
    const opposite = kind === 'U' ? 'V' : 'U';
    const pos = findTile(dest, opposite) ?? dest.spawn;
    setPlayer({ x: pos.x + 1, y: pos.y, facing: 'right' });
  }, [projectId, floor, say]);

  const close = () => navigate(basePath);

  const goFloor = (id: string) => {
    if (!projectId && id !== '1F') { say('担当作品を決めると他の階へ行けます。'); return; }
    setTalk(null);
    setFloorId(id);
    setPlayer({ ...FLOOR_BY_ID[id].spawn, facing: 'down' });
    if (dialogOpen) navigate(basePath);
  };

  // 画面幅に合わせてマップを拡大縮小する（基準 768px）
  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth - 40 - (el.clientWidth > 1100 ? 280 : 0);
      setScale(Math.max(0.5, Math.min(1.5, avail / 768)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projectTitle = status?.project?.title ?? null;

  return (
    <div className="office">
      <header className="office-bar">
        <div className="brand">AI漫画スタジオ <span className="muted">編集部ビル</span></div>
        <div className="office-project">
          {projectTitle
            ? <><span className="muted">担当作品:</span> <strong>{projectTitle}</strong></>
            : <span className="muted">担当作品: 未選択（受付へ）</span>}
        </div>
        <nav className="office-floors" aria-label="フロア">
          {[...FLOORS].reverse().map((f) => (
            <button key={f.id} className={f.id === floor.id ? 'active' : ''} onClick={() => goFloor(f.id)}>
              {f.label}
            </button>
          ))}
        </nav>
        <div className="office-tools">
          <span className="muted">矢印キーで移動 / Enter で話す / クリックでも可</span>
          <Link to={location.pathname} className="ghost-link"
            onClick={() => { localStorage.setItem('ui:classic', '1'); window.location.reload(); }}>
            クラシック表示
          </Link>
        </div>
      </header>

      <div className="office-stage" ref={stageRef}>
        <div className="office-map-wrap" style={{ width: 768 * scale, height: 480 * scale }}>
          <div style={{ width: 768, height: 480, transform: `scale(${scale})`, transformOrigin: 'top left' }}>
            <OfficeMap
              floor={floor}
              player={player}
              onMove={setPlayer}
              onTalk={startTalk}
              onStairs={stairs}
              active={!dialogOpen && !talk}
              activeNpcId={current?.npc.id ?? talk?.npc.id ?? null}
              busyNpcIds={busyNpcIds}
              disabledNpcIds={disabledNpcIds}
            />
          </div>
        </div>
        <aside className="office-side">
          <div className="office-floor-title">{floor.label}</div>
          <ul className="office-npcs">
            {floor.npcs.map((n) => (
              <li key={n.id}>
                <button className={`npc-link ${disabledNpcIds.has(n.id) ? 'disabled' : ''}`} onClick={() => startTalk(n)}>
                  <strong>{n.name}</strong>
                  <span>{n.hint}</span>
                  {busyNpcIds.has(n.id) && <em>作業中…</em>}
                </button>
              </li>
            ))}
          </ul>
          {jobs.length > 0 && (
            <div className="office-jobs">
              <div className="muted">進行中の作業</div>
              {jobs.map((j) => <div key={j.id} className="job">{j.label}<br /><small>{j.step}</small></div>)}
            </div>
          )}
        </aside>
        {toast && <div className="office-toast">{toast}</div>}
        {talk && !dialogOpen && (
          <TalkWindow talk={talk} onAdvance={advance} onChoose={choose} onSend={send} onCancelInput={cancelInput} />
        )}
      </div>

      {dialogOpen && (
        <RoomDialog
          title={current ? (current.npc.title === current.npc.name ? current.npc.room : `${current.npc.room}（${current.npc.name}）`) : '部屋'}
          onClose={close}
        >
          {children}
        </RoomDialog>
      )}
    </div>
  );
}

function findTile(floor: Floor, ch: string): { x: number; y: number } | null {
  for (let y = 0; y < floor.map.length; y++) {
    const x = floor.map[y].indexOf(ch);
    if (x >= 0) return { x, y };
  }
  return null;
}

/** 部屋の中身を表示する RPG 風ダイアログ。Esc または閉じるでマップへ戻る */
function RoomDialog({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="room-backdrop" onClick={onClose}>
      <div className="room-dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="room-head">
          <span className="room-title">{title}</span>
          <button className="room-close" onClick={onClose} aria-label="閉じる">× マップへ戻る（Esc）</button>
        </div>
        <div className="room-body">{children}</div>
      </div>
    </div>
  );
}
