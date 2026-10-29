import type { Character, DesignKind, DesignProposal, Episode, Job } from '@manga/shared';
import type { Npc } from './floors';
import type { OfficeStatus } from './dialogue';

/**
 * 職場の進行ロジック（純粋関数）。
 * 「誰に何を頼めるか」「頼んだ仕事がどう戻ってくるか」「進行表の状態」を決める。
 */

export interface Choice { key: string; label: string }

/** 頼んだ仕事（ジョブ）の控え。完了すると Delivery になる */
export interface Requested {
  jobId: number;
  npcId: string;
  kind: 'structure' | 'scenes' | 'panels' | 'images' | 'archive' | 'design' | 'locations' | 'discussion' | 'office_art';
  /** design のとき: キャラか背景か */
  designKind?: DesignKind;
  /** discussion のとき: 会議の id */
  discussionId?: number;
  /** office_art のとき: 描き直したフロア */
  floorIds?: string[];
  episodeId?: number;
  label: string;
  /** 依頼時点の話数（構成依頼で新しい話を見分けるため） */
  episodeCountBefore?: number;
}

/** NPC からの報告（話しかけると受け取れる） */
export interface Delivery extends Requested {
  ok: boolean;
  error?: string;
}

export const EP_LABEL: Record<string, string> = {
  draft: '下書き', structured: '構成済み', paneled: 'ネーム済み', rendered: '作画済み',
};

// ---------- 設定画（キャラクターデザイン）の状態 ----------

/** 話に登場する主要キャラ（シーンの登場名で引く。見つからなければ全員） */
export function mainCharacters(status: OfficeStatus | null, episode?: Episode | null): Character[] {
  if (!status) return [];
  const eps = episode ? [episode] : status.episodes;
  const names = new Set(eps.flatMap((e) => e.scenes.flatMap((sc) => sc.characters)));
  const hit = status.characters.filter((c) => names.has(c.name));
  return hit.length ? hit : episode ? [] : status.characters;
}

/** 設定画がまだのキャラ */
export function missingDesign(status: OfficeStatus | null, episode?: Episode | null): Character[] {
  return mainCharacters(status, episode).filter((c) => !c.refImageUrl);
}

/** 担当が選んだおすすめが未採用のまま残っている提案 */
export function pendingProposals(status: OfficeStatus | null, kind: DesignKind = 'character'): DesignProposal[] {
  return ((kind === 'character' ? status?.design : status?.designBg) ?? []).filter((d) => !d.adopted && d.top);
}

/** 設定画のない背景 */
export function missingBgDesign(status: OfficeStatus | null): { id: number; name: string }[] {
  return (status?.backgrounds ?? []).filter((b) => !b.refImageUrl);
}

/** 進行表の1話ぶん */
export interface QuestRow {
  episode: Episode;
  steps: { key: 'structure' | 'panels' | 'images' | 'archive'; label: string; done: boolean; active: boolean }[];
}

export function questRows(status: OfficeStatus | null, jobs: Job[]): QuestRow[] {
  if (!status) return [];
  const activeFor = (kinds: string[], episodeId: number) =>
    jobs.some((j) => kinds.includes(j.kind) && (j.resultRef === `episode:${episodeId}` || (j.kind === 'structure' && j.resultRef === null)));
  return status.episodes.map((e) => {
    const archived = status.archive?.episodes.find((a) => a.episodeId === e.id)?.hasSummary ?? false;
    const paneled = e.status === 'paneled' || e.status === 'rendered';
    return {
      episode: e,
      steps: [
        { key: 'structure', label: '構成', done: e.status !== 'draft', active: jobs.some((j) => j.kind === 'structure' && j.resultRef === `episode:${e.id}`) },
        { key: 'panels', label: 'ネーム', done: paneled, active: activeFor(['panels'], e.id) },
        { key: 'images', label: '作画', done: e.status === 'rendered', active: activeFor(['episode_images'], e.id) },
        { key: 'archive', label: '書庫', done: archived, active: activeFor(['archive'], e.id) },
      ],
    };
  });
}

/** 次にやることの一言（進行表の下に出す） */
export function nextHint(status: OfficeStatus | null, focus: Episode | null): string {
  if (!status?.project) return '1F 受付で担当作品を選ぶ';
  if (!status.episodes.length) return '2F 脚本家に最初の構成を頼む';
  if (!focus) return '進行表から担当する話を選ぶ';
  const archived = status.archive?.episodes.find((a) => a.episodeId === focus.id)?.hasSummary;
  const pending = pendingProposals(status).length;
  const pendingBg = pendingProposals(status, 'background').length;
  const missing = missingDesign(status, focus).length;
  const missingBg = missingBgDesign(status).length;
  if (pending) return `2F 設定担当が設定画の候補を持っている（${pending} 人分）。採用するか決める`;
  if (pendingBg) return `2F ロケハン担当が背景の候補を持っている（${pendingBg} 件）。採用するか決める`;
  if (!missing && missingBg && (focus.status === 'structured' || focus.status === 'paneled')) return `設定画のない場所が ${missingBg} 件。2F ロケハン担当に背景の設定画を頼む`;
  switch (focus.status) {
    case 'draft':
    case 'structured': return missing
      ? `第${focus.number}話: 設定画がまだのキャラが ${missing} 人。2F 設定担当に設定画を頼む`
      : `第${focus.number}話: 2F 脚本家の構成を確認して 3F 漫画家にネームを頼む`;
    case 'paneled': return missing
      ? `第${focus.number}話: 作画の前に 2F 設定担当へ設定画を頼む（${missing} 人）`
      : status.imageCaps && status.imageCaps.refMode === 'none'
        ? `第${focus.number}話: いまの画風のモデルは設定画を渡せない。3F 画材担当でモデルを替えてから作画`
        : `第${focus.number}話: 3F 漫画家の原稿を確認して作画に入ってもらう`;
    case 'rendered': return archived ? `第${focus.number}話は完成。次の話へ（2F 脚本家に続きを頼める）` : `第${focus.number}話: B1 書庫番に登録を頼む`;
  }
  return '';
}

export interface TalkPlan {
  lines: string[];
  choices: Choice[];
  /** 成果物をすぐ見せる（報告のとき） */
  deliver?: Delivery;
}

/** 話しかけたときの台詞と選択肢を決める */
export function planTalk(
  npc: Npc,
  status: OfficeStatus | null,
  focus: Episode | null,
  delivery: Delivery | null,
  busy: boolean,
  baseLinesIn: string[],
): TalkPlan {
  let baseLines = baseLinesIn;
  const p = status?.project ?? null;
  const close: Choice = { key: 'close', label: 'また今度' };
  const enter = (label: string): Choice => ({ key: 'enter', label });
  const chat: Choice = { key: 'chat', label: '相談する・要望を伝える' };

  if (!p && !npc.global) return { lines: baseLines, choices: [close] };
  if (npc.id === 'reception') return { lines: baseLines, choices: [enter('作品一覧を見る'), close] };
  if (npc.id === 'assets') return { lines: baseLines, choices: [enter('倉庫を見る'), close] };

  if (busy) {
    return { lines: [`${npc.name}はいま作業中です。終わったら報告に来ます。`], choices: [enter('書類で進み具合を見る'), close] };
  }

  // ---- 報告（頼んだ仕事が終わった） ----
  if (delivery) {
    if (!delivery.ok) {
      return {
        lines: ['……すみません、うまくいきませんでした。', delivery.error ?? '原因は不明です。', 'もう一度頼んでもらえますか。'],
        choices: [enter('書類で確認する'), close],
      };
    }
    const ep = status?.episodes.find((e) => e.id === delivery.episodeId) ?? null;
    switch (delivery.kind) {
      case 'structure':
        return {
          lines: ['お待たせしました。続きの構成ができました。'],
          choices: [...newEpisodeChoices(status, delivery.episodeCountBefore ?? 0), enter('書類で見る'), close],
          deliver: delivery,
        };
      case 'scenes':
        return {
          lines: [`第${ep?.number ?? '?'}話のシーン構成を直しました。確認してください。`],
          choices: [{ key: 'handoff:artist', label: 'OK、3Fの漫画家に回す' }, { key: 'scenes:revise', label: 'もう少し直してほしい' }, enter('書類で見る'), close],
          deliver: delivery,
        };
      case 'panels':
        return {
          lines: [`第${ep?.number ?? '?'}話のネーム、上がりました。見てください。`],
          choices: [{ key: 'images:generate', label: 'OK、作画に入ってくれ' }, { key: 'panels:revise', label: 'ネームを直してほしい' }, enter('書類で見る'), close],
          deliver: delivery,
        };
      case 'images':
        return {
          lines: [`第${ep?.number ?? '?'}話、作画が終わりました。`],
          choices: [{ key: 'read', label: '縦読みで読む' }, { key: 'episode:next', label: 'お疲れさま。次の話へ' }, { key: 'panels:revise', label: 'ネームから直したい' }, enter('書類で見る'), close],
          deliver: delivery,
        };
      case 'archive':
        return {
          lines: [`第${ep?.number ?? '?'}話を書庫に登録しました。連載メモも更新済みです。`],
          choices: [enter('書庫を見る'), close],
        };
      case 'design': {
        const dk = delivery.designKind ?? 'character';
        return {
          lines: dk === 'character'
            ? ['設定画の候補ができました。', '設定に一番近い1枚を私が選んであります。見てください。']
            : ['背景の設定画の候補ができました。', '場所の説明に一番近い1枚を選んであります。見てください。'],
          choices: designChoices(status, dk),
          deliver: delivery,
        };
      }
      case 'office_art':
        return {
          lines: ['オフィスの絵、描き上がりました。', 'いまの絵と並べて見てください。気に入ったら採用で。'],
          choices: [{ key: 'office:art:show', label: '見せて' }, close],
          deliver: delivery,
        };
      case 'discussion':
        return {
          lines: ['会議がまとまりました。', '結論を聞きますか。それとも最初から見ますか。'],
          choices: [
            { key: `meeting:open:${delivery.discussionId}`, label: '結論を聞く' },
            { key: `meeting:replay:${delivery.discussionId}`, label: '議論を最初から見る' },
            close,
          ],
        };
      case 'locations':
        return {
          lines: ['構成とネームから場所を拾い出しました。', '設定画を作る場所を決めてください。'],
          choices: [...(missingBgDesign(status).length ? [{ key: 'design:start:background', label: `場所 ${missingBgDesign(status).length} 件の設定画を作ってもらう` }] : []), enter('背景の一覧を見る'), close],
          deliver: delivery,
        };
    }
  }

  // ---- 通常の用件 ----
  const eps = status?.episodes ?? [];
  const f = focus ? `第${focus.number}話` : '';
  switch (npc.id) {
    case 'writer': {
      const choices: Choice[] = [];
      if (!eps.length) {
        choices.push({ key: 'structure:2', label: '最初の2話分の構成を書いてもらう' });
      } else {
        if (focus) choices.push({ key: 'scenes:show', label: `${f}のシーン構成を見せて` });
        choices.push({ key: 'structure:1', label: '続きを1話分書いてもらう' }, { key: 'structure:2', label: '続きを2話分書いてもらう' });
        choices.push({ key: 'propose:next', label: '次の展開を提案してもらう' }, { key: 'propose:review', label: focus ? `${f}で気になる点を聞く` : 'いまの構成で気になる点を聞く' });
      }
      return { lines: baseLines, choices: [...choices, chat, enter('書類で見る'), close] };
    }
    case 'artist': {
      if (!eps.length) return { lines: baseLines, choices: [close] };
      if (!focus) return { lines: [...baseLines, 'どの話を描きますか?'], choices: [...pickChoices(eps), close] };
      const choices: Choice[] = [];
      if (focus.status === 'draft' || focus.status === 'structured') {
        choices.push({ key: 'panels:generate', label: `${f}のネームを切ってもらう` });
      } else if (focus.status === 'paneled') {
        const miss = missingDesign(status, focus);
        choices.push(
          { key: 'panels:show', label: `${f}の原稿を見せて` },
          { key: 'images:generate', label: miss.length ? `設定画なしで${f}の作画に入る（${miss.map((c) => c.name).join('・')}の顔がブレるかも）` : `${f}の作画に入ってもらう` },
          { key: 'panels:revise', label: 'ネームを直してほしい' },
        );
        if (miss.length) baseLines = [...baseLines, `${miss.map((c) => c.name).join('・')}の設定画がまだない。先に2Fの設定担当に頼んでくると顔が安定するよ。`];
      } else {
        choices.push({ key: 'panels:show', label: `${f}の原稿を見せて（作画済み）` }, { key: 'read', label: `${f}を縦読みで読む` }, { key: 'episode:next', label: '次の話へ' });
      }
      choices.push({ key: 'pick:menu', label: '別の話にする' });
      return { lines: baseLines, choices: [...choices, chat, enter('書類で見る'), close] };
    }
    case 'manager': {
      const choices: Choice[] = [];
      if (focus) {
        const done = status?.archive?.episodes.find((a) => a.episodeId === focus.id)?.hasSummary;
        choices.push({ key: 'archive:register', label: done ? `${f}を書庫に登録し直す` : `${f}を書庫に登録してもらう` });
      }
      return { lines: baseLines, choices: [...choices, chat, enter('書庫を見る'), close] };
    }
    case 'chara': {
      const choices: Choice[] = [];
      const pending = pendingProposals(status);
      const missing = (status?.characters ?? []).filter((c) => !c.refImageUrl);
      if (pending.length) choices.push({ key: 'design:show:character', label: `設定画の候補を見せて（${pending.length} 人分）` });
      if (missing.length) choices.push({ key: 'design:start:character', label: `設定画のない ${missing.length} 人の設定画を作ってもらう` });
      return { lines: baseLines, choices: [...choices, chat, enter('資料室を見る'), close] };
    }
    case 'location': {
      const choices: Choice[] = [];
      const pending = pendingProposals(status, 'background');
      const missing = missingBgDesign(status);
      if (pending.length) choices.push({ key: 'design:show:background', label: `背景の設定画の候補を見せて（${pending.length} 件）` });
      if (missing.length) choices.push({ key: 'design:start:background', label: `設定画のない ${missing.length} 件の背景の設定画を作ってもらう` });
      if (eps.length) choices.push({ key: 'locations:extract', label: (status?.backgrounds.length ? '構成とネームから新しい場所を拾い出してもらう' : '構成とネームから場所を拾い出してもらう') });
      if (status?.backgrounds.length) choices.push({ key: 'photos:upload', label: 'ロケハン写真を渡す（自分で撮った写真から背景を起こす）' });
      return { lines: baseLines, choices: [...choices, chat, enter('背景の一覧を見る'), close] };
    }
    case 'chief': {
      const choices: Choice[] = eps.length
        ? [{ key: 'propose:next', label: '次の展開をどう考えてるか聞く' }, { key: 'propose:review', label: focus ? `${f}の気になる点を聞く` : 'いまの構成の気になる点を聞く' }]
        : [];
      return { lines: baseLines, choices: [...choices, chat, enter('ダッシュボードを見る'), close] };
    }
    case 'designer': {
      const choices: Choice[] = [
        { key: 'office:art:this', label: 'このフロアの美術を描き直してもらう（AI で高品質に）' },
        { key: 'office:art:all', label: '全フロアの美術を描き直してもらう' },
      ];
      if (status?.officeArt?.candidates.some((a) => !a.adopted)) choices.push({ key: 'office:art:show', label: '描き直した絵の候補を見せて' });
      if (status?.officeArt?.adopted[status.floorId ?? '']) choices.push({ key: 'office:art:revert', label: 'このフロアを元のタイル絵に戻す' });
      return { lines: baseLines, choices: [...choices, chat, enter('画風の設定を見る'), close] };
    }
    case 'foreshadow': {
      const choices: Choice[] = eps.length ? [{ key: 'propose:review', label: '伏線の回収案を聞く' }] : [];
      return { lines: baseLines, choices: [...choices, chat, enter('伏線ボードを見る'), close] };
    }
    case 'meeting': {
      const ds = status?.discussions ?? [];
      const choices: Choice[] = [{ key: 'meeting:start', label: '議題を出して会議を開く' }];
      for (const d of ds.filter((x) => x.status === 'running').slice(0, 1)) choices.push({ key: `meeting:open:${d.id}`, label: `進行中の会議「${clipLabel(d.topic)}」を見る` });
      for (const d of ds.filter((x) => x.status === 'awaiting_user').slice(0, 3)) choices.push({ key: `meeting:open:${d.id}`, label: `「${clipLabel(d.topic)}」の結論を聞く（判断待ち）` });
      const last = ds.find((x) => x.status === 'adopted' || x.status === 'rejected');
      if (last) choices.push({ key: `meeting:replay:${last.id}`, label: `前回の会議「${clipLabel(last.topic)}」を見返す` });
      return { lines: baseLines, choices: [...choices, chat, enter('議事録を見る'), close] };
    }
    default:
      if (npc.participant) return { lines: baseLines, choices: [close] };
      return { lines: baseLines, choices: [...(npc.canChat ? [chat] : []), enter(`${npc.room}を見る`), close] };
  }
}

function clipLabel(t: string, n = 18) { return t.length > n ? `${t.slice(0, n)}…` : t; }

/** 話を選ぶ選択肢（新しい順に最大6件） */
export function pickChoices(eps: Episode[]): Choice[] {
  return [...eps].reverse().slice(0, 6).map((e) => ({ key: `pick:${e.id}`, label: `第${e.number}話「${e.title}」（${EP_LABEL[e.status] ?? e.status}）` }));
}

/** 構成依頼で増えた話を「この話から進める」として並べる */
function newEpisodeChoices(status: OfficeStatus | null, countBefore: number): Choice[] {
  const eps = status?.episodes ?? [];
  const added = eps.slice(countBefore);
  const list = added.length ? added : eps.slice(-2);
  return list.map((e) => ({ key: `pick:${e.id}`, label: `第${e.number}話「${e.title}」から進める` }));
}

/** 依頼ごとの入力欄の案内文 */
export function inputHintFor(purpose: string, npc: Npc): string {
  switch (purpose) {
    case 'scenes': return '例: 2シーン目にクロの出番を足して / ラストの引きをもっと不穏に';
    case 'panels': return '例: 見せ場のコマをもっと大きく / 1ページ目はテンポよく小ゴマで / セリフを短く';
    case 'structure': return '例: 次の話はライバルの初登場回にして / 祖母の手がかりを1つ出す';
    case 'topic': return '例: 第2話の引きは十分か? / ライバルは何話で登場させるべきか?';
    default:
      switch (npc.id) {
        case 'chief': return '例: 2話にライバルの初登場シーンを入れたい / ペンダントの回収を3話に延ばして';
        case 'manager': return '例: 灰田と静の関係はどこまで描いた? / 第1話で出た設定を教えて';
        case 'meeting': return '例: 第2話の引きは十分か議論してほしい';
        default: return 'ご要望をどうぞ';
      }
  }
}

/** 設定画の提案に対する選択肢: おすすめを全部採用 / 対象ごとに別の候補 */
export function designChoices(status: OfficeStatus | null, kind: DesignKind = 'character'): Choice[] {
  const pending = pendingProposals(status, kind);
  const unit = kind === 'character' ? '人' : '件';
  const choices: Choice[] = [];
  if (pending.length) {
    choices.push({
      key: `design:adopt:all:${kind}`,
      label: pending.length > 1 ? `おすすめを ${pending.length} ${unit}とも採用する` : `${pending[0].owner.name}は${kind === 'character' ? 'この顔' : 'この絵'}で採用する`,
    });
  }
  for (const d of pending.slice(0, 4)) {
    if (d.candidates.length > 1) choices.push({ key: `design:alt:${kind}:${d.owner.id}`, label: `${d.owner.name}は別の候補を見る` });
  }
  choices.push({ key: 'enter', label: kind === 'character' ? '資料室で見る' : '背景の一覧を見る' }, { key: 'close', label: 'また今度' });
  return choices;
}
