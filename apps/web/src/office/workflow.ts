import type { Episode, Job } from '@manga/shared';
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
  kind: 'structure' | 'scenes' | 'panels' | 'images' | 'archive';
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
  switch (focus.status) {
    case 'draft':
    case 'structured': return `第${focus.number}話: 2F 脚本家の構成を確認して 3F 漫画家にネームを頼む`;
    case 'paneled': return `第${focus.number}話: 3F 漫画家の原稿を確認して作画に入ってもらう`;
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
  baseLines: string[],
): TalkPlan {
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
          choices: [{ key: 'episode:next', label: 'お疲れさま。次の話へ' }, { key: 'panels:revise', label: 'ネームから直したい' }, enter('書類で見る'), close],
          deliver: delivery,
        };
      case 'archive':
        return {
          lines: [`第${ep?.number ?? '?'}話を書庫に登録しました。連載メモも更新済みです。`],
          choices: [enter('書庫を見る'), close],
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
        choices.push({ key: 'panels:show', label: `${f}の原稿を見せて` }, { key: 'images:generate', label: `${f}の作画に入ってもらう` }, { key: 'panels:revise', label: 'ネームを直してほしい' });
      } else {
        choices.push({ key: 'panels:show', label: `${f}の原稿を見せて（作画済み）` }, { key: 'episode:next', label: '次の話へ' });
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
    case 'chief':
      return { lines: baseLines, choices: [chat, enter('ダッシュボードを見る'), close] };
    case 'meeting':
      return { lines: baseLines, choices: [chat, enter('会議室に入る'), close] };
    default:
      return { lines: baseLines, choices: [...(npc.canChat ? [chat] : []), enter(`${npc.room}を見る`), close] };
  }
}

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
    default:
      switch (npc.id) {
        case 'chief': return '例: 2話にライバルの初登場シーンを入れたい / ペンダントの回収を3話に延ばして';
        case 'manager': return '例: 灰田と静の関係はどこまで描いた? / 第1話で出た設定を教えて';
        case 'meeting': return '例: 第2話の引きは十分か議論してほしい';
        default: return 'ご要望をどうぞ';
      }
  }
}
