import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import type { DesignKind, Episode, Job } from '@manga/shared';
import { api } from '../api';
import { FLOORS, FLOOR_BY_ID, npcForPath, type Floor, type Npc } from './floors';
import { OfficeMap, type PlayerState } from './OfficeMap';
import { npcLines, type OfficeStatus } from './dialogue';
import { TalkWindow, type TalkState } from './TalkWindow';
import {
  designChoices, inputHintFor, mainCharacters, nextHint, pendingProposals, pickChoices, planTalk, questRows,
  type Choice, type Delivery, type Requested,
} from './workflow';
import { DesignAltView, DesignView, EpisodesView, LocationsView, PagesView, PhotosView, ScenesView } from './Deliverables';

/**
 * RPG 風オフィス = 制作工程そのもの。
 *
 * プレイヤーは担当編集。NPC に仕事を頼む（ジョブ化）と NPC は机へ向かい、
 * 終わると「!」を出して報告に来る。成果物（シーン構成・原稿）は会話ウィンドウで受け取り、
 * その場で「OK」「直してほしい」を返す。従来のページは「書類で見る」から開ける補助。
 */
export function OfficeLayout({ children }: { children: React.ReactNode }) {
  const { projectId: pid, episodeId } = useParams();
  const projectId = pid ? Number(pid) : null;
  const location = useLocation();
  const navigate = useNavigate();

  const isBase = /^\/office\/?$/.test(location.pathname) || /^\/projects\/\d+\/office\/?$/.test(location.pathname);
  const current = useMemo(() => npcForPath(location.pathname), [location.pathname]);
  const dialogOpen = !isBase;

  // ---- 作品の状態 ----
  const [status, setStatus] = useState<OfficeStatus | null>(null);
  const loadStatus = useCallback(async () => {
    if (!projectId) { setStatus(null); return; }
    try {
      const [project, episodes, characters, backgrounds, warnings, discussions, archive, styles, design, designBg] = await Promise.all([
        api.getProject(projectId), api.listEpisodes(projectId), api.listCharacters(projectId),
        api.listBackgrounds(projectId), api.foreshadowWarnings(projectId), api.listDiscussions(projectId),
        api.getArchive(projectId).catch(() => null), api.listArtStyles(projectId).catch(() => []),
        api.getDesign(projectId, 'character').catch(() => null), api.getDesign(projectId, 'background').catch(() => null),
      ]);
      const style = styles.find((s) => s.id === project.artStyleId) ?? null;
      const imageCaps = style ? await api.getModelCaps(style.model).catch(() => null) : null;
      setStatus({ project, episodes, characters, backgrounds, warnings, discussions, archive, artStyleName: style?.name ?? null, design, designBg, imageCaps });
    } catch {
      setStatus(null);
    }
  }, [projectId]);
  useEffect(() => { loadStatus(); }, [loadStatus, location.pathname]);

  // ---- 担当中の話 ----
  const focusKey = `office:lastEpisode:${projectId}`;
  const [focusId, setFocusId] = useState<number | null>(() => {
    const v = projectId ? localStorage.getItem(`office:lastEpisode:${projectId}`) : null;
    return v ? Number(v) : null;
  });
  useEffect(() => {
    if (projectId && episodeId) { localStorage.setItem(focusKey, episodeId); setFocusId(Number(episodeId)); }
  }, [projectId, episodeId, focusKey]);
  const setFocus = useCallback((id: number | null) => {
    setFocusId(id);
    if (projectId) { if (id) localStorage.setItem(focusKey, String(id)); else localStorage.removeItem(focusKey); }
  }, [projectId, focusKey]);
  const focus: Episode | null = useMemo(() => status?.episodes.find((e) => e.id === focusId) ?? null, [status, focusId]);

  // ---- 階とプレイヤー ----
  const [floorId, setFloorId] = useState<string>(() => sessionStorage.getItem('office:floor') ?? '1F');
  const [player, setPlayer] = useState<PlayerState>(() => {
    const saved = sessionStorage.getItem('office:player');
    const p = saved ? JSON.parse(saved) : null;
    return p?.facing ? p : { ...FLOOR_BY_ID['1F'].spawn, facing: 'down' };
  });
  useEffect(() => { sessionStorage.setItem('office:floor', floorId); }, [floorId]);
  useEffect(() => { sessionStorage.setItem('office:player', JSON.stringify(player)); }, [player]);
  useEffect(() => {
    if (current && current.floor.id !== floorId) {
      setFloorId(current.floor.id);
      setPlayer({ x: current.npc.x, y: current.npc.y + 1, facing: 'up' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.npc.id]);
  useEffect(() => { if (!projectId && floorId !== '1F') { setFloorId('1F'); setPlayer({ ...FLOOR_BY_ID['1F'].spawn, facing: 'down' }); } }, [projectId, floorId]);
  const floor: Floor = (projectId ? FLOOR_BY_ID[floorId] : FLOOR_BY_ID['1F']) ?? FLOOR_BY_ID['1F'];

  // ---- ジョブ: 頼んだ仕事の控えと報告 ----
  const reqKey = `office:requested:${projectId}`;
  const delKey = `office:deliveries:${projectId}`;
  const [requested, setRequested] = useState<Requested[]>(() => JSON.parse(sessionStorage.getItem(`office:requested:${projectId}`) ?? '[]'));
  const [deliveries, setDeliveries] = useState<Delivery[]>(() => JSON.parse(sessionStorage.getItem(`office:deliveries:${projectId}`) ?? '[]'));
  useEffect(() => { sessionStorage.setItem(reqKey, JSON.stringify(requested)); }, [requested, reqKey]);
  useEffect(() => { sessionStorage.setItem(delKey, JSON.stringify(deliveries)); }, [deliveries, delKey]);

  const [jobs, setJobs] = useState<Job[]>([]);
  const requestedRef = useRef(requested);
  requestedRef.current = requested;

  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const say = useCallback((msg: string, ms = 3200) => {
    setToast(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => {
    if (!projectId) { setJobs([]); return; }
    let alive = true;
    const poll = async () => {
      try {
        const active = await api.listActiveJobs(projectId);
        if (!alive) return;
        setJobs(active);
        // 頼んだ仕事が終わっていれば報告に変える
        const finished = requestedRef.current.filter((r) => !active.some((j) => j.id === r.jobId));
        for (const r of finished) {
          const job = await api.getJob(r.jobId).catch(() => null);
          if (!alive) return;
          const ok = job?.status === 'succeeded';
          const npcName = FLOORS.flatMap((f) => f.npcs).find((n) => n.id === r.npcId)?.name ?? r.npcId;
          setRequested((rs) => rs.filter((x) => x.jobId !== r.jobId));
          setDeliveries((ds) => [...ds.filter((d) => d.npcId !== r.npcId), { ...r, ok, error: job?.error ?? undefined }]);
          say(ok ? `${npcName}: 「${r.label}」ができました。話しかけてください。` : `${npcName}: 「${r.label}」に失敗しました。`, 5000);
          loadStatus();
        }
      } catch { /* オフライン時は次回 */ }
    };
    poll();
    const t = setInterval(poll, 3000);
    return () => { alive = false; clearInterval(t); };
  }, [projectId, loadStatus, say]);

  const track = useCallback((job: Job, r: Omit<Requested, 'jobId'>) => {
    setRequested((rs) => [...rs, { ...r, jobId: job.id }]);
    setJobs((js) => [...js, job]);
  }, []);

  const busyNpcIds = useMemo(() => {
    const kinds = new Set(jobs.map((j) => j.kind as string));
    const ids = new Set<string>();
    for (const f of FLOORS) for (const n of f.npcs) if (n.jobKinds?.some((k) => kinds.has(k))) ids.add(n.id);
    return ids;
  }, [jobs]);
  const reportNpcIds = useMemo(() => new Set(deliveries.map((d) => d.npcId)), [deliveries]);
  const disabledNpcIds = useMemo(() => {
    const ids = new Set<string>();
    if (!projectId) for (const f of FLOORS) for (const n of f.npcs) if (!n.global) ids.add(n.id);
    return ids;
  }, [projectId]);

  const basePath = projectId ? `/projects/${projectId}/office` : '/office';

  // ---- 会話 ----
  const [talk, setTalk] = useState<TalkState | null>(null);
  const rules = status?.project?.panelRules;

  const routeFor = useCallback((npc: Npc): string => {
    let route = npc.route.replace('{p}', String(projectId ?? ''));
    if (route.includes('{e}')) {
      if (!focusId) return `/projects/${projectId}/episodes`;
      route = route.replace('{e}', String(focusId));
    }
    return route;
  }, [projectId, focusId]);

  /** 成果物の表示を用意する（原稿は取得が要るので非同期）。作画チェックの指摘数も返す */
  const buildContent = useCallback(async (kind: Delivery['kind'], ep: Episode | null, countBefore?: number, designKind: DesignKind = 'character'): Promise<{ content: React.ReactNode; fails: number }> => {
    if (kind === 'structure') {
      const eps = status?.episodes ?? [];
      const added = countBefore !== undefined ? eps.slice(countBefore) : eps.slice(-2);
      return { content: <EpisodesView episodes={added.length ? added : eps} title="新しい話の構成" />, fails: 0 };
    }
    if (kind === 'design') {
      const proposals = await api.getDesign(projectId!, designKind);
      return { content: <DesignView proposals={proposals} />, fails: 0 };
    }
    if (kind === 'locations') {
      const bgs = await api.listBackgrounds(projectId!);
      return { content: <LocationsView backgrounds={bgs} />, fails: 0 };
    }
    if (!ep) return { content: null, fails: 0 };
    if (kind === 'scenes') return { content: <ScenesView episode={ep} />, fails: 0 };
    if ((kind === 'panels' || kind === 'images') && rules) {
      const full = await api.getEpisode(ep.id);
      return { content: <PagesView episode={full} rules={rules} />, fails: full.panels.filter((p) => p.checkStatus === 'fail').length };
    }
    return { content: null, fails: 0 };
  }, [status, rules, projectId]);

  /** 指摘のあるコマがあれば「描き直してもらう」を選択肢の先頭に足す */
  const withRedraw = (choices: Choice[], fails: number): Choice[] =>
    fails > 0 ? [{ key: 'images:redraw', label: `指摘のある ${fails} コマを描き直してもらう` }, ...choices] : choices;

  const startTalk = useCallback((npc: Npc) => {
    const busy = busyNpcIds.has(npc.id);
    const delivery = deliveries.find((d) => d.npcId === npc.id) ?? null;
    if (delivery) setDeliveries((ds) => ds.filter((d) => d.npcId !== npc.id));
    const plan = planTalk(npc, status, focus, delivery, busy, npcLines(npc, status));
    const base: TalkState = {
      npc, lines: plan.lines, index: 0, phase: 'lines', choices: plan.choices, reply: null,
      inputPurpose: 'chat', inputHint: inputHintFor('chat', npc), lastMessage: '', history: [],
    };
    setTalk(base);
    if (plan.deliver) {
      const ep = status?.episodes.find((e) => e.id === plan.deliver!.episodeId) ?? null;
      if (ep) setFocus(ep.id);
      buildContent(plan.deliver.kind, ep, plan.deliver.episodeCountBefore, plan.deliver.designKind).then(({ content, fails }) =>
        setTalk((t) => (t && t.npc.id === npc.id ? { ...t, content, choices: withRedraw(t.choices, fails) } : t)));
    }
  }, [busyNpcIds, deliveries, status, focus, buildContent, setFocus]);

  const advance = useCallback(() => {
    setTalk((t) => {
      if (!t) return t;
      if (t.phase === 'reply') return { ...t, phase: 'menu' };
      if (t.phase !== 'lines') return t;
      if (t.index + 1 < t.lines.length) return { ...t, index: t.index + 1 };
      return { ...t, phase: t.content ? 'deliver' : 'menu' };
    });
  }, []);

  /** 台詞だけ言って終わる（依頼を受けたとき） */
  const sayAndClose = useCallback((lines: string[], closeLabel = 'よろしく') => {
    setTalk((t) => t && { ...t, lines, index: 0, phase: 'lines', content: undefined, reply: null, choices: [{ key: 'close', label: closeLabel }] });
  }, []);

  const openInput = useCallback((purpose: string) => {
    setTalk((t) => t && { ...t, phase: 'input', inputPurpose: purpose, inputHint: inputHintFor(purpose, t.npc), reply: null });
  }, []);

  const showDeliver = useCallback(async (kind: Delivery['kind'], ep: Episode, choices: Choice[]) => {
    const { content, fails } = await buildContent(kind, ep);
    setTalk((t) => t && { ...t, phase: 'deliver', content, choices: withRedraw(choices, fails), reply: null });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildContent]);

  const choose = useCallback(async (key: string) => {
    if (!talk) return;
    const npc = talk.npc;
    const eps = status?.episodes ?? [];
    const fail = (e: Error) => sayAndClose([`うまく頼めませんでした: ${e.message}`], '閉じる');

    if (key === 'close') { setTalk(null); return; }
    if (key === 'enter') { setTalk(null); navigate(routeFor(npc)); return; }
    if (key === 'chat') { openInput('chat'); return; }
    if (key.startsWith('propose:') && projectId) {
      const mode = key.split(':')[1] === 'review' ? 'review' : 'next';
      setTalk({ ...talk, phase: 'waiting', content: undefined });
      api.propose(projectId, npc.id, mode, focus?.id)
        .then((r) => setTalk((t) => {
          if (!t) return t;
          const body = r.proposals.map((p, i) => `${i + 1}. ${p.title}\n${p.detail}`).join('\n\n');
          const reply = [r.reply, body].filter(Boolean).join('\n\n');
          return {
            ...t, phase: 'reply', reply, proposals: r.proposals,
            history: [...t.history, { role: 'user', text: mode === 'review' ? '気になる点を教えて' : '次の展開を提案して' }, { role: 'npc', text: reply }],
            choices: [
              ...(r.canApply ? r.proposals.map((p, i) => ({ key: `apply:prop:${i}`, label: `案${i + 1}「${p.title}」を構成に反映する` })) : []),
              { key: 'chat', label: '続けて相談する' }, { key: 'enter', label: `${t.npc.room}を見る` }, { key: 'close', label: 'また今度' },
            ],
          };
        }))
        .catch((e: Error) => setTalk((t) => t && { ...t, phase: 'reply', reply: `（提案がもらえませんでした: ${e.message}）`, choices: [{ key: 'chat', label: '相談する' }, { key: 'close', label: 'また今度' }] }));
      return;
    }
    if (key.startsWith('apply:prop:') && projectId) {
      const i = Number(key.split(':')[2]);
      const prop = talk.proposals?.[i];
      if (!prop) return;
      setTalk({ ...talk, phase: 'waiting' });
      api.applyChange(projectId, prop.instruction || `${prop.title}: ${prop.detail}`)
        .then(() => { setTalk((t) => t && { ...t, phase: 'reply', reply: `案${i + 1}「${prop.title}」を構成に反映した。構成と伏線を確認してくれ。`, choices: t.choices.filter((c) => c.key !== key) }); loadStatus(); })
        .catch((e: Error) => setTalk((t) => t && { ...t, phase: 'reply', reply: `反映に失敗した: ${e.message}` }));
      return;
    }
    if (key === 'apply' && projectId) {
      setTalk({ ...talk, phase: 'waiting' });
      api.applyChange(projectId, talk.lastMessage)
        .then(() => { setTalk((t) => t && { ...t, phase: 'reply', reply: '反映した。構成と伏線を確認してくれ。', choices: t.choices.filter((c) => c.key !== 'apply') }); loadStatus(); })
        .catch((e: Error) => setTalk((t) => t && { ...t, phase: 'reply', reply: `反映に失敗した: ${e.message}` }));
      return;
    }

    if (key.startsWith('structure:') && projectId) {
      const n = Number(key.split(':')[1]) || 1;
      try {
        const job = await api.startStructureJob(projectId, n);
        track(job, { npcId: 'writer', kind: 'structure', label: job.label, episodeCountBefore: eps.length });
        sayAndClose([`わかりました。${n}話分、書き上げたら声をかけます。`, '机に戻ります。']);
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key === 'scenes:show' && focus) {
      await showDeliver('scenes', focus, [
        { key: 'handoff:artist', label: 'OK、3Fの漫画家に回す' }, { key: 'scenes:revise', label: '直してほしい（指示を書く）' },
        { key: 'enter', label: '書類で見る' }, { key: 'close', label: 'また今度' },
      ]);
      return;
    }
    if (key === 'scenes:revise') { openInput('scenes'); return; }
    if (key === 'handoff:artist' && focus) {
      sayAndClose([`第${focus.number}話は漫画家に回しておきます。`, '3Fの作画室で声をかけてください。'], 'わかった');
      return;
    }
    if (key === 'panels:generate' && focus) {
      try {
        const job = await api.startPanelsJob(focus.id);
        track(job, { npcId: 'artist', kind: 'panels', episodeId: focus.id, label: job.label });
        sayAndClose([`第${focus.number}話だね。ネームを切ってくる。`, '上がったら呼ぶよ。']);
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key === 'panels:show' && focus) {
      const choices: Choice[] = focus.status === 'rendered'
        ? [{ key: 'episode:next', label: '次の話へ' }, { key: 'panels:revise', label: 'ネームから直したい' }, { key: 'enter', label: '書類で見る' }, { key: 'close', label: 'また今度' }]
        : [{ key: 'images:generate', label: 'OK、作画に入ってくれ' }, { key: 'panels:revise', label: 'ネームを直してほしい' }, { key: 'enter', label: '書類で見る' }, { key: 'close', label: 'また今度' }];
      await showDeliver(focus.status === 'rendered' ? 'images' : 'panels', focus, choices);
      return;
    }
    if (key === 'panels:revise') { openInput('panels'); return; }
    if (key === 'images:redraw' && focus) {
      try {
        const job = await api.generateEpisodeImages(focus.id, true);
        track(job, { npcId: 'artist', kind: 'images', episodeId: focus.id, label: job.label });
        sayAndClose(['了解、指摘のあったコマを描き直す。', '設定担当のチェックも通し直すよ。']);
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key === 'images:generate' && focus) {
      try {
        const job = await api.generateEpisodeImages(focus.id);
        track(job, { npcId: 'artist', kind: 'images', episodeId: focus.id, label: job.label });
        sayAndClose(['よし、作画に入る。', 'コマ数ぶん時間がかかるから、他の仕事を進めてて。']);
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key === 'episode:next') {
      const next = focus ? eps.find((e) => e.number === focus.number + 1) : eps[0];
      if (next) {
        setFocus(next.id);
        sayAndClose([`次は第${next.number}話「${next.title}」だね。`, next.status === 'structured' || next.status === 'draft' ? '構成は2Fの脚本家に確認してから、またここへ。' : '準備ができたら声をかけて。'], 'わかった');
      } else {
        sayAndClose(['次の話はまだ構成がないよ。', '2Fの脚本家に続きを頼んできて。'], 'わかった');
      }
      return;
    }
    if (key === 'archive:register' && focus) {
      try {
        const job = await api.registerEpisodeToArchive(focus.id);
        track(job, { npcId: 'manager', kind: 'archive', episodeId: focus.id, label: job.label });
        sayAndClose([`第${focus.number}話ですね。要約して連載メモを更新します。`, '少し時間をください。']);
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key === 'locations:extract' && projectId) {
      try {
        const job = await api.startLocationsJob(projectId);
        track(job, { npcId: 'location', kind: 'locations', label: job.label });
        sayAndClose(['わかりました。構成とネームを読んで、何度も出てくる場所を拾い出します。', 'できたら呼びに行きます。']);
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key === 'photos:upload' && projectId) {
      const bgs = status?.backgrounds ?? [];
      const choicesFor = (bgId: number | null, n: number, adopted: boolean): Choice[] => [
        ...(bgId && n && !adopted ? [{ key: `design:start:background:${bgId}`, label: 'この写真から背景の設定画を起こしてもらう' }] : []),
        { key: 'close', label: 'また今度' },
      ];
      setTalk((t) => t && {
        ...t, phase: 'deliver', reply: null, choices: choicesFor(null, 0, false),
        content: <PhotosView backgrounds={bgs} onChanged={(bgId, n, adopted) => setTalk((t2) => t2 && { ...t2, choices: choicesFor(bgId, n, adopted) })} />,
      });
      return;
    }
    if (key.startsWith('design:start:') && projectId) {
      const [, , dkS, oidS] = key.split(':');
      const dk = dkS as DesignKind;
      const fromPhotos = dk === 'background' && !!oidS;
      try {
        const job = await api.startDesignJob(projectId, dk, oidS ? [Number(oidS)] : undefined);
        track(job, { npcId: dk === 'character' ? 'chara' : 'location', kind: 'design', designKind: dk, label: job.label });
        sayAndClose([
          fromPhotos ? 'わかりました。写真の構図を保ったまま、画風に合わせて背景に起こします。' : dk === 'character' ? '承知しました。候補を数枚ずつ描いて、設定に一番近いものを選んでおきます。' : 'わかりました。場所ごとに候補を描いて、説明に一番近いものを選んでおきます。',
          'できたら呼びに行きます。',
        ]);
      } catch (e) { fail(e as Error); }
      return;
    }
    const showDesign = async (dk: DesignKind) => {
      const proposals = await api.getDesign(projectId!, dk);
      const st = { ...(status as NonNullable<typeof status>), ...(dk === 'character' ? { design: proposals } : { designBg: proposals }) };
      setTalk((t) => t && { ...t, phase: 'deliver', content: <DesignView proposals={proposals} />, choices: designChoices(st, dk), reply: null });
    };
    if (key.startsWith('design:show:') && projectId) { await showDesign(key.split(':')[2] as DesignKind); return; }
    if (key.startsWith('design:adopt:all:') && projectId) {
      const dk = key.split(':')[3] as DesignKind;
      setTalk((t) => t && { ...t, phase: 'waiting' });
      try {
        const pending = pendingProposals(status, dk);
        for (const d of pending) await api.adoptDesign(dk, d.owner.id, d.top!.id);
        await loadStatus();
        sayAndClose([
          `${pending.map((d) => d.owner.name).join('・')}の設定画を決めました。`,
          dk === 'character' ? '正面・横顔・全身・表情の4枚セットを描き足しておきます。作画のときはこれを基準に見ます。' : '引き・入口から・細部・夜の4枚セットを描き足しておきます。同じ場所はこれを基準に描きます。',
        ], 'よろしく');
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key.startsWith('design:alt:') && projectId) {
      const [, , dk, oidS] = key.split(':');
      const oid = Number(oidS);
      const proposals = await api.getDesign(projectId, dk as DesignKind);
      const d = proposals.find((x) => x.owner.id === oid);
      if (!d) return;
      const choices: Choice[] = d.candidates.map((c, i) => ({ key: `design:pick:${dk}:${oid}:${c.id}`, label: `候補${i + 1}${c.rank === 1 ? '（おすすめ）' : ''}を採用する` }));
      setTalk((t) => t && { ...t, phase: 'deliver', content: <DesignAltView proposal={d} />, choices: [...choices, { key: `design:show:${dk}`, label: '戻る' }], reply: null });
      return;
    }
    if (key.startsWith('design:pick:') && projectId) {
      const [, , dk, oidS, ridS] = key.split(':');
      setTalk((t) => t && { ...t, phase: 'waiting' });
      try {
        await api.adoptDesign(dk as DesignKind, Number(oidS), Number(ridS));
        await loadStatus();
        const left = (await api.getDesign(projectId, dk as DesignKind)).filter((x) => !x.adopted && x.top);
        if (left.length) await showDesign(dk as DesignKind);
        else sayAndClose(['採用しました。4枚セットを描き足しておきます。'], 'よろしく');
      } catch (e) { fail(e as Error); }
      return;
    }
    if (key === 'pick:menu') {
      setTalk({ ...talk, phase: 'menu', content: undefined, choices: [...pickChoices(eps), { key: 'close', label: 'また今度' }] });
      return;
    }
    if (key.startsWith('pick:')) {
      const id = Number(key.split(':')[1]);
      const ep = eps.find((e) => e.id === id);
      if (!ep) return;
      setFocus(ep.id);
      const plan = planTalk(npc, status, ep, null, false, []);
      setTalk({ ...talk, phase: 'menu', content: undefined, reply: `第${ep.number}話「${ep.title}」を担当します。`, choices: plan.choices });
      return;
    }
  }, [talk, status, focus, projectId, navigate, routeFor, openInput, sayAndClose, showDeliver, track, setFocus, loadStatus]);

  const send = useCallback(async (text: string) => {
    if (!talk || !projectId) return;
    const purpose = talk.inputPurpose;
    if (purpose === 'chat') {
      const history = [...talk.history, { role: 'user' as const, text }];
      setTalk({ ...talk, phase: 'waiting', lastMessage: text, history });
      api.talk(projectId, talk.npc.id, text, talk.history, focus?.id)
        .then((r) => setTalk((t) => t && {
          ...t, phase: 'reply', reply: r.reply, history: [...history, { role: 'npc', text: r.reply }],
          choices: [
            ...(r.action === 'apply_change' ? [{ key: 'apply', label: 'その内容を構成に反映する' }] : []),
            { key: 'chat', label: '続けて相談する' }, { key: 'enter', label: `${t.npc.room}を見る` }, { key: 'close', label: 'また今度' },
          ],
        }))
        .catch((e: Error) => setTalk((t) => t && { ...t, phase: 'reply', reply: `（返事がもらえませんでした: ${e.message}）` }));
      return;
    }
    if (!focus) return;
    try {
      if (purpose === 'scenes') {
        const job = await api.startReviseScenesJob(focus.id, text);
        track(job, { npcId: 'writer', kind: 'scenes', episodeId: focus.id, label: job.label });
        sayAndClose(['承知しました。その方向で書き直します。', '直したら呼びに行きます。']);
      } else if (purpose === 'panels') {
        const job = await api.startPanelsJob(focus.id, text);
        track(job, { npcId: 'artist', kind: 'panels', episodeId: focus.id, label: job.label });
        sayAndClose(['なるほど、そこを直すんだね。', '描き直したら呼ぶよ。']);
      }
    } catch (e) {
      sayAndClose([`うまく頼めませんでした: ${(e as Error).message}`], '閉じる');
    }
  }, [talk, projectId, focus, track, sayAndClose]);

  const cancelInput = useCallback(() => setTalk((t) => t && { ...t, phase: t.content ? 'deliver' : 'menu' }), []);

  // ---- 移動 ----
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

  const stageRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const update = () => {
      const avail = el.clientWidth - 40 - (el.clientWidth > 1100 ? 300 : 0);
      setScale(Math.max(0.5, Math.min(1.5, avail / 768)));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const projectTitle = status?.project?.title ?? null;
  const rows = useMemo(() => questRows(status, jobs), [status, jobs]);

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
            <button key={f.id} className={f.id === floor.id ? 'active' : ''} onClick={() => goFloor(f.id)}>{f.label}</button>
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
              reportNpcIds={reportNpcIds}
            />
          </div>
        </div>

        <aside className="office-side">
          {projectId && (
            <div className="quest">
              <div className="quest-title"><span>進行表</span><span className="muted">担当中: {focus ? `第${focus.number}話` : '—'}</span></div>
              {status && status.characters.length > 0 && (() => {
                const main = mainCharacters(status);
                const done = main.filter((c) => !!c.refImageUrl).length;
                const working = busyNpcIds.has('chara');
                return (
                  <div className="quest-prep">
                    <span>準備</span>
                    <span className={`qstep ${done === main.length ? 'done' : working ? 'active' : ''}`}>キャラ設定画 {done}/{main.length}</span>
                    {pendingProposals(status).length > 0 && <span className="qstep active">候補あり</span>}
                    {status.backgrounds.length > 0 && (
                      <span className={`qstep ${status.backgrounds.every((b) => !!b.refImageUrl) ? 'done' : busyNpcIds.has('location') ? 'active' : ''}`}>
                        背景設定画 {status.backgrounds.filter((b) => !!b.refImageUrl).length}/{status.backgrounds.length}
                      </span>
                    )}
                    {pendingProposals(status, 'background').length > 0 && <span className="qstep active">背景候補あり</span>}
                  </div>
                );
              })()}
              {rows.length ? rows.map((r) => (
                <div key={r.episode.id} className={`quest-row ${r.episode.id === focusId ? 'focus' : ''}`} onClick={() => setFocus(r.episode.id)}>
                  <span className="ep">第{r.episode.number}話</span>
                  <span className="ttl">{r.episode.title}</span>
                  <span className="steps">
                    {r.steps.map((s) => <span key={s.key} className={`qstep ${s.done ? 'done' : ''} ${s.active ? 'active' : ''}`}>{s.label}</span>)}
                  </span>
                </div>
              )) : <div className="quest-empty">まだ話がありません。</div>}
              <div className="quest-next">▶ {nextHint(status, focus)}</div>
            </div>
          )}
          <div className="office-floor-title">{floor.label}</div>
          <ul className="office-npcs">
            {floor.npcs.map((n) => (
              <li key={n.id}>
                <button className={`npc-link ${disabledNpcIds.has(n.id) ? 'disabled' : ''}`} onClick={() => startTalk(n)}>
                  <strong>{n.name}{reportNpcIds.has(n.id) && <span className="report-mark"> !</span>}</strong>
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

/** 書類（従来ページ）を表示するダイアログ。Esc または閉じるでマップへ戻る */
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
