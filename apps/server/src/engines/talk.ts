import { extractJson, getLLMClient } from '../llm/index.js';
import { talkPrompt } from '../prompts.js';
import { getProject, listCharacters, listEpisodes, listForeshadowings } from './story.js';
import { archiveDir, buildSeriesContext } from './archive.js';
import { existsSync } from 'node:fs';

/**
 * オフィスの NPC との «相談»。
 * NPC ごとの役割（編集長・脚本家・漫画家…）で Claude が返答し、
 * 構成に反映できる要望なら action: 'apply_change' を返す（反映自体は既存の applyChange に任せる）。
 */

export interface TalkTurn { role: 'user' | 'npc'; text: string }
export interface TalkResult { reply: string; action: 'apply_change' | null }

export const NPC_PERSONAS: Record<string, { name: string; system: string; canApply: boolean }> = {
  chief: {
    name: '編集長',
    canApply: true,
    system: 'あなたは漫画編集部の編集長です。ぶっきらぼうだが面倒見がよく、進行と商業的な魅力を最優先に判断します。要望は構成への反映可否まで踏み込んで答えます。',
  },
  writer: {
    name: '脚本家',
    canApply: true,
    system: 'あなたはこの作品の脚本家（原作担当）です。物語の整合性・キャラクターの動機・伏線の設計の観点から、丁寧な口調で具体案を返します。',
  },
  artist: {
    name: '漫画家',
    canApply: false,
    system: 'あなたはこの作品の作画を担当する漫画家です。コマ割り・構図・見せ場・読みやすさの観点から、気さくな口調で答えます。',
  },
  chara: {
    name: '設定担当',
    canApply: false,
    system: 'あなたは資料室の人物設定担当です。キャラクターの外見・性格・口調の一貫性と、参照画像づくりの助言を落ち着いた口調で返します。',
  },
  location: {
    name: 'ロケハン担当',
    canApply: false,
    system: 'あなたは資料室の背景・ロケーション担当です。舞台となる場所の見え方・雰囲気・使い回しについて助言します。',
  },
  designer: {
    name: '画材担当',
    canApply: false,
    system: 'あなたは画風・コマ割りルール・構成テンプレートの担当です。画像生成モデルの特性や演出ルールについて実務的に答えます。',
  },
  meeting: {
    name: '司会',
    canApply: false,
    system: 'あなたはAI編集会議の司会です。議題を整理し、どの観点（編集者・プロット・読者）で議論すべきかを提案します。',
  },
  manager: {
    name: '連載マネージャー',
    canApply: false,
    system: 'あなたは書庫番の連載マネージャーです。これまでの話・設定・伏線の状態を正確に把握しており、質問には «根拠となる話数» を添えて簡潔に答えます。推測で設定を作らず、未確定なら「未確定」と言います。',
  },
  foreshadow: {
    name: '進行担当',
    canApply: true,
    system: 'あなたは伏線の進行担当です。導入済み・未回収の伏線と回収予定を把握し、回収のタイミングや構成の調整案を提案します。',
  },
};

export async function talkToNpc(projectId: number, npcId: string, message: string, history: TalkTurn[] = []): Promise<TalkResult> {
  const persona = NPC_PERSONAS[npcId];
  if (!persona) throw new Error(`相談に対応していない相手です: ${npcId}`);
  const project = getProject(projectId);
  const context = buildSeriesContext(projectId, { includePreviousScript: false, maxChars: 9000 });
  const dir = archiveDir(project);

  const text = await getLLMClient().complete({
    task: 'talk',
    system: persona.system,
    prompt: talkPrompt(project, persona, listEpisodes(projectId), listCharacters(projectId), listForeshadowings(projectId), context, history.slice(-8), message),
    cwd: existsSync(dir) ? dir : undefined,
  });
  try {
    const out = extractJson<{ reply?: string; action?: string }>(text);
    const reply = (out.reply ?? '').trim() || text.trim();
    const action = persona.canApply && out.action === 'apply_change' ? 'apply_change' : null;
    return { reply, action };
  } catch {
    return { reply: text.trim(), action: null };
  }
}
