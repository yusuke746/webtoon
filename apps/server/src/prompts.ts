import type {
  Background, Character, Episode, Foreshadowing, Panel, PanelRules, Project, StoryTemplate,
} from '@manga/shared';

/** Claude へ渡すプロンプトのテンプレート集。すべて JSON 出力を強制する */

const JSON_ONLY = '出力は指定した JSON のみとし、前置きや説明文は一切書かないこと。';

/** 担当編集からの指示（会話で伝えた要望）。最優先で反映させる */
function instructionSection(instruction?: string): string {
  if (!instruction?.trim()) return '';
  return `
## 担当編集からの指示（最優先で反映すること）
${instruction.trim()}
`;
}

/**
 * 連載マネージャーが用意した文脈（連載メモ・各話要約・直前の話の全文）をプロンプトへ差し込む。
 * アーカイブが空なら何も出さない。
 */
function seriesContextSection(seriesContext?: string): string {
  if (!seriesContext?.trim()) return '';
  return `
## 連載アーカイブ（連載マネージャーより。設定・人物の現在地・時系列はここと矛盾させないこと）
${seriesContext.trim()}

作業ディレクトリに連載アーカイブ（bible.md / characters/ / episodes/NN/script.md / foreshadow.md）があります。
上記で足りない過去話の描写やセリフを確認したい場合は、該当ファイルを読んでから書いてください。
`;
}

export function structurePrompt(
  project: Project,
  episodeCount: number,
  existingEpisodes: Episode[],
  foreshadowings: Foreshadowing[],
  seriesContext?: string,
  instruction?: string,
): string {
  const tmpl: StoryTemplate = project.storyTemplate;
  const existing = existingEpisodes.length
    ? `\n## 既存の話（変更しないこと。続きから作る）\n${existingEpisodes
        .map((e) => `- 第${e.number}話「${e.title}」: ${e.summary}`)
        .join('\n')}`
    : '';
  const fs = foreshadowings.length
    ? `\n## 登録済みの伏線（回収予定を考慮すること）\n${foreshadowings
        .map(
          (f) =>
            `- 「${f.title}」(状態:${f.status}, 導入:${f.setupEpisode ?? '未'}話, 回収予定:${f.plannedPayoffEpisode ?? '未定'}話): ${f.description}`,
        )
        .join('\n')}`
    : '';

  return `あなたはプロの漫画原作者です。以下のあらすじから連載漫画の話数構成を作ってください。

## あらすじ
${project.synopsis}

## 構成テンプレート
- 型: ${tmpl.name}
- 1話あたり約${tmpl.pagesPerEpisode}ページ
- 追加指示: ${tmpl.instructions || 'なし'}
${existing}${fs}
${seriesContextSection(seriesContext)}${instructionSection(instruction)}
## 依頼
新しく${episodeCount}話分の構成を作成してください。物語に「伏線(setup)」と「回収(payoff)」を意図的に設計し、各シーンにどの伏線が関わるかを明記してください。

## 出力形式（JSON）
{
  "episodes": [
    {
      "number": 話数(整数),
      "title": "話タイトル",
      "summary": "話の要約",
      "scenes": [
        {
          "title": "シーン名",
          "summary": "シーンの内容",
          "characters": ["登場キャラ名"],
          "foreshadowRefs": [{"title": "伏線タイトル", "action": "setup または payoff"}]
        }
      ]
    }
  ],
  "foreshadowings": [
    {
      "title": "伏線タイトル",
      "description": "伏線の内容",
      "setupEpisode": 導入話数,
      "plannedPayoffEpisode": 回収予定話数,
      "relatedCharacters": ["関連キャラ名"],
      "relatedItems": ["関連アイテム名"]
    }
  ]
}
${JSON_ONLY}`;
}

export function charactersPrompt(project: Project, episodes: Episode[], seriesContext?: string): string {
  return `あなたはプロのキャラクターデザイナーです。以下の作品に登場するキャラクターの設定を作ってください。

## あらすじ
${project.synopsis}

## 話数構成
${episodes.map((e) => `- 第${e.number}話「${e.title}」: ${e.summary}\n  シーン: ${e.scenes.map((s) => `${s.title}(${s.characters.join('・')})`).join(' / ')}`).join('\n')}
${seriesContextSection(seriesContext)}
## 依頼
構成に登場する全キャラクターについて、画像生成の一貫性維持に使える具体的な外見描写を含む設定を作成してください。

## 出力形式（JSON）
{
  "characters": [
    {
      "name": "キャラ名",
      "role": "役割（主人公/ヒロイン/敵役など）",
      "appearance": "外見の詳細（髪型・髪色・服装・体格・特徴）",
      "personality": "性格・口調・行動原理"
    }
  ]
}
${JSON_ONLY}`;
}

export function panelsPrompt(
  project: Project,
  episode: Episode,
  characters: Character[],
  backgrounds: Background[] = [],
  seriesContext?: string,
  instruction?: string,
): string {
  const rules: PanelRules = project.panelRules;
  const bgSection = backgrounds.length
    ? `\n## 登録済みの背景（同じ場所は必ず同じ名前を使うこと。一貫性維持に使われる）\n${backgrounds
        .map((b) => `- ${b.name}: ${b.description}`)
        .join('\n')}\n`
    : '';
  return `あなたはプロの漫画家です。以下の話のコマ割り（ネーム）を作ってください。

## 作品あらすじ
${project.synopsis}

## 対象の話
第${episode.number}話「${episode.title}」: ${episode.summary}
シーン構成:
${episode.scenes.map((s, i) => `${i + 1}. ${s.title}: ${s.summary}（登場: ${s.characters.join('・')}）`).join('\n')}

## キャラクター設定（セリフの口調・外見描写に反映すること）
${characters.map((c) => `- ${c.name}（${c.role}）: 外見=${c.appearance} / 性格=${c.personality}`).join('\n')}
${bgSection}
${seriesContextSection(seriesContext)}${instructionSection(instruction)}
${panelRulesSection(project)}

## 依頼
各コマについて、情景描写・セリフ・画像生成用の英語プロンプトを作成してください。
英語プロンプトには "manga panel" とカメラワーク・構図・キャラの表情や動きを必ず含めてください。
キャラの外見（髪・服・体格）は別途固定文で与えるので、プロンプト内で «名前» を使って指し、外見を言い換えないでください。
画像には後工程でセリフと吹き出しを重ねるため、imagePrompt には文字、看板の文字、吹き出し、字幕、擬音、ロゴ、透かし、セリフを描く指示を含めないでください。

${PANELS_OUTPUT_FORMAT}`;
}

function panelRulesSection(project: Project): string {
  const rules: PanelRules = project.panelRules;
  return `## コマ割りルール（読みやすさ最優先）
- 1ページ最大${rules.maxPanelsPerPage}コマ
- レイアウトは ${rules.gridCols}列 × ${rules.gridRows}行 のグリッド座標（x,y,w,h は整数、x+w <= ${rules.gridCols}、y+h <= ${rules.gridRows}）
- 同一ページ内でコマ同士を重ねない。隙間なく敷き詰め、読み順が一目で分かる段組みにする
- コマの大きさに強弱をつける（見せ場は大ゴマ、テンポを出す場面は小さい横長ゴマ）
- 読み方向: ${rules.readingDirection === 'rtl' ? '右から左（日本式）。同じ段では右のコマが先' : rules.readingDirection === 'ltr' ? '左から右' : `縦スクロール（Webtoon）。コマは上から下へ1列。必ず x=0, w=${rules.gridCols} にし、h で縦の長さを決める（見せ場は h=${rules.gridRows} の縦長大ゴマ、テンポを出す場面は h=1〜2 の横長ゴマ）。page は「画面」の区切りとして使い、場面転換で page を進める`}
- 目安ページ数: ${project.storyTemplate.pagesPerEpisode}ページ
- 追加ルール: ${rules.customRules || 'なし'}

## セリフ・吹き出しのルール（重なり厳禁）
- 1コマのセリフは最大3つ。1つのセリフは40字以内（長い場合はコマを分ける）
- 各セリフに position を必ず指定する: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "middle-left" | "middle-right"
- 同一コマ内で同じ position を2回使わない（吹き出しが重なるため）
- 読み方向が${rules.readingDirection === 'ltr' ? '左→右なので、先に読むセリフほど左・上に置く' : rules.readingDirection === 'vertical' ? '上→下の縦読みなので、先に読むセリフほど上に置く（top-* → middle-* → bottom-*）' : '右→左なので、先に読むセリフほど右・上に置く'}
- 人物の顔や重要な被写体はコマ中央に置く想定のため、position は端に配置する`;
}

const PANELS_OUTPUT_FORMAT = `## 出力形式（JSON）
{
  "panels": [
    {
      "layout": {"page": ページ番号, "x": 0, "y": 0, "w": 4, "h": 2},
      "description": "情景・構図の日本語説明",
      "dialogues": [{"speaker": "話者名", "text": "セリフ", "kind": "speech|thought|narration|sfx", "position": "top-right"}],
      "imagePrompt": "english visual-only prompt; no text, speech bubbles, captions, sound effects, logos, or watermarks",
      "characters": ["このコマに登場するキャラ名"],
      "background": "登録済み背景の名前。該当なしなら null"
    }
  ]
}
${JSON_ONLY}`;

/** ネーム批評を行う役割定義（ネーム生成時の自動議論に使用） */
export const NAME_REVIEW_ROLES = [
  {
    name: 'ネーム演出担当',
    system:
      'あなたはプロの漫画家（ネーム演出の専門家）です。コマ割りの読み順の明快さ、コマの大小のメリハリ、視線誘導、' +
      '吹き出しの配置（重なり・顔への被り・読み順との整合）を厳しくチェックし、具体的な修正案を出してください。',
  },
  {
    name: '読者代表',
    system:
      'あなたは漫画好きの読者代表です。初見でストーリーが追えるか、どのコマから読めばいいか迷わないか、' +
      'セリフが長すぎないか、感情が伝わるかを読者目線で率直に指摘してください。',
  },
] as const;

export function nameCritiquePrompt(
  project: Project,
  episode: Episode,
  panelsJson: string,
): string {
  return `以下は漫画「${project.title}」第${episode.number}話のネーム（コマ割り・セリフ）データです。あなたの役割の観点で問題点を指摘してください。

${panelRulesSection(project)}

## ネームデータ（JSON）
${panelsJson}

## 依頼
問題のあるコマを「ページ番号-コマ番号」で特定し、300字以内で具体的な修正指示を箇条書きしてください。
特に「吹き出しの重なり・同一positionの重複」「読み順の分かりにくさ」「コマの大小のメリハリ不足」を必ず確認してください。
問題がなければ「問題なし」とだけ書いてください。`;
}

export function panelsRevisePrompt(
  project: Project,
  episode: Episode,
  characters: Character[],
  panelsJson: string,
  critiques: { roleName: string; content: string }[],
): string {
  return `あなたはプロの漫画家です。以下のネームに対する批評を反映し、改稿版を出力してください。

## 作品
「${project.title}」第${episode.number}話「${episode.title}」

## キャラクター設定
${characters.map((c) => `- ${c.name}（${c.role}）: ${c.personality}`).join('\n')}

${panelRulesSection(project)}

## 現在のネーム（JSON）
${panelsJson}

## 批評
${critiques.map((c) => `【${c.roleName}】\n${c.content}`).join('\n\n')}

## 依頼
批評で指摘された問題をすべて解消した改稿版を、全コマ分（差分ではなく全量）出力してください。
指摘のなかったコマもルール違反（position 重複など）があれば直してください。

${PANELS_OUTPUT_FORMAT}`;
}

export const DISCUSSION_ROLES = [
  {
    key: 'editor',
    name: '編集者',
    system:
      'あなたはベテランの漫画編集者です。商業的な魅力・引きの強さ・読者を掴む構成の観点から、率直に批評と改善案を述べてください。',
  },
  {
    key: 'plotter',
    name: 'プロット担当',
    system:
      'あなたはプロの漫画原作者（プロット担当）です。物語の整合性・伏線の設計・キャラクターアークの観点から、具体的な構成案を述べてください。',
  },
  {
    key: 'reader',
    name: '読者代表',
    system:
      'あなたは漫画好きの読者代表です。読んでいて面白いか・感情移入できるか・分かりにくい点はないかを、読者目線で率直に述べてください。',
  },
] as const;

export function discussionTurnPrompt(
  topic: string,
  context: string,
  history: { roleName: string; content: string }[],
): string {
  const h = history.length
    ? `\n## これまでの議論\n${history.map((m) => `【${m.roleName}】${m.content}`).join('\n\n')}`
    : '';
  return `漫画作品の企画会議です。以下の議題について、あなたの役割の立場から意見を述べてください。

## 議題
${topic}

## 作品コンテキスト
${context}
${h}

## 依頼
300字以内で、具体的な提案を含めて意見を述べてください。他の参加者の意見には賛成/反対を明確にしてください。`;
}

export function consensusPrompt(
  topic: string,
  history: { roleName: string; content: string }[],
): string {
  return `あなたは会議のファシリテーターです。以下の議論を総括し、合意形成された案をまとめてください。

## 議題
${topic}

## 議論ログ
${history.map((m) => `【${m.roleName}】${m.content}`).join('\n\n')}

## 出力形式（JSON）
{
  "summary": "ユーザー向けの決定事項の要約（200字以内）",
  "proposal": "採用時に実行する具体的な変更内容の箇条書き"
}
${JSON_ONLY}`;
}

export function applyChangePrompt(
  instruction: string,
  project: Project,
  episodes: Episode[],
  foreshadowings: Foreshadowing[],
): string {
  return `あなたは漫画制作アプリのアシスタントです。ユーザーの変更指示を、現在の構成データに反映した新しいデータを出力してください。

## ユーザーの変更指示
${instruction}

## 現在の構成データ（JSON）
${JSON.stringify(
    {
      episodes: episodes.map((e) => ({
        number: e.number, title: e.title, summary: e.summary, scenes: e.scenes,
      })),
      foreshadowings: foreshadowings.map((f) => ({
        title: f.title, description: f.description, setupEpisode: f.setupEpisode,
        plannedPayoffEpisode: f.plannedPayoffEpisode, status: f.status,
        relatedCharacters: f.relatedCharacters, relatedItems: f.relatedItems,
      })),
    },
    null,
    2,
  )}

## 依頼
変更指示を反映した episodes / foreshadowings の全量を、入力と同じ形式の JSON で出力してください。
変更が不要な要素もそのまま含めてください（差分ではなく全量）。
${JSON_ONLY}`;
}

/**
 * 参照画像（一貫性アセット）用の英語プロンプトを Claude に作らせる。
 *
 * 日本語の外見description をそのまま画像モデルへ渡すと精度が落ちるため、
 * 一度英語のプロンプトへ翻訳・具体化させる。
 * キャラは「設定画（キャラクターシート）」、背景は「無人の情景」を狙う。
 */
export function refImagePrompt(
  kind: 'character' | 'background' | 'style',
  name: string,
  description: string,
  stylePrompt: string,
): string {
  const intent = {
    character:
      'キャラクター設定画（character reference sheet）。同一人物を毎回同じ顔・同じ服装で描くための基準画像。'
      + '正面と横からの全身が入り、背景は無地、表情はニュートラル。他の人物は写り込ませないこと。',
    background:
      '背景の基準画像（establishing shot）。同じ場所を毎回同じ構造・同じ内装で描くための基準画像。'
      + '人物は一切登場させず、空間そのものが分かる引きの構図にすること。',
    style:
      '画風の基準画像（style reference）。線の太さ・トーン・陰影の付け方が分かる代表的な一枚。',
  }[kind];

  return `あなたは漫画の作画監督です。以下の設定から、画像生成モデル（Flux / SDXL 系）へ渡す英語プロンプトを1つ作ってください。

## 目的
${intent}

## 対象の名前
${name}

## 設定（日本語）
${description || '（詳細な設定なし。名前から妥当に補完すること）'}

## 画風指定
${stylePrompt || '（指定なし。日本の漫画・白黒の線画を基本とする）'}

## 制約
- 出力は英語のプロンプト文字列のみ（カンマ区切りのタグ列でよい）
- 日本語や説明文をプロンプトに混ぜないこと
- 人物の年齢が読み取れる場合は必ず明示すること
- 200語以内

## 出力JSON
{"prompt": "英語のプロンプト"}

${JSON_ONLY}`;
}

export function projectContextSummary(
  project: Project,
  episodes: Episode[],
  characters: Character[],
  foreshadowings: Foreshadowing[],
): string {
  return [
    `タイトル: ${project.title}`,
    `あらすじ: ${project.synopsis}`,
    episodes.length
      ? `話数構成:\n${episodes.map((e) => `第${e.number}話「${e.title}」: ${e.summary}`).join('\n')}`
      : '話数構成: 未生成',
    characters.length
      ? `キャラクター: ${characters.map((c) => `${c.name}(${c.role})`).join('、')}`
      : 'キャラクター: 未生成',
    foreshadowings.length
      ? `伏線:\n${foreshadowings.map((f) => `- ${f.title}(${f.status})`).join('\n')}`
      : '伏線: なし',
  ].join('\n\n');
}

// ---------- 連載マネージャー（書庫） ----------

export function archiveEpisodeSummaryPrompt(
  project: Project,
  episode: Episode,
  script: string,
  previousContext: string,
): string {
  return `あなたは漫画編集部の「連載マネージャー」です。作品「${project.title}」の第${episode.number}話「${episode.title}」の脚本・ネームを読み、
後続の話を書く作家が «一貫性を保つために必要な情報» だけを Markdown で整理してください。感想や評価は不要です。
${previousContext ? `\n## これまでの流れ（参考）\n${previousContext}\n` : ''}
## 第${episode.number}話の脚本・ネーム
${script}

## 出力形式（Markdown のみ。前置き不要）
# 第${episode.number}話「${episode.title}」要約
## あらすじ（300字以内）
## 登場人物と変化
（名前: この話での行動・心情・関係の変化。初登場なら「初登場」と明記）
## 新たに判明した設定・事実
（世界観・能力・過去など、以後矛盾させてはいけないこと）
## 伏線の動き
（導入 / 進展 / 回収 を伏線名ごとに）
## 次話への引き
## 口調・文体メモ
（キャラの一人称・呼び方・口癖、ナレーションの文体など）`;
}

export function archiveBibleNotesPrompt(
  project: Project,
  currentNotes: string,
  summaries: { number: number; title: string; text: string }[],
  foreshadowings: Foreshadowing[],
  decisions = '',
): string {
  const hasDecisions = !!decisions.trim() && !decisions.trim().startsWith('（まだありません');
  return `あなたは漫画編集部の「連載マネージャー」です。作品「${project.title}」のシリーズバイブルの「連載メモ」を最新の状態に書き直してください。
連載メモは、次の話を書く作家が最初に読む «現在地の要約» です。古い情報は最新話の内容で上書きし、矛盾があれば最新話を優先して明記してください。
${hasDecisions ? `編集会議で採用された方針は「確定した設定・ルール」または「未回収の伏線と含み」に、どの議題で決まったかが分かる形で必ず織り込んでください。不採用になった案は採らないでください。\n` : ''}
## 現在の連載メモ
${currentNotes.trim() || '（まだありません）'}

## 各話の要約（古い順）
${summaries.map((s) => `--- 第${s.number}話「${s.title}」 ---\n${s.text}`).join('\n\n')}

## 伏線の登録状況（アプリ側の管理データ）
${foreshadowings.length ? foreshadowings.map((f) => `- ${f.title}（${f.status} / 導入 ${f.setupEpisode ?? '未'}話 / 回収予定 ${f.plannedPayoffEpisode ?? '未定'}話）`).join('\n') : 'なし'}
${hasDecisions ? `\n## 編集会議の決定事項（採否の決まった議題）\n${decisions.trim()}\n` : ''}
## 出力形式（Markdown のみ。見出しは以下を必ず使う。前置き不要）
## 現在の状況（最新話時点）
## 人物の現在地（関係・感情・所在）
## 確定した設定・ルール（矛盾させてはいけないこと）
## 時系列
## 未回収の伏線と含み
## 文体・演出の約束事`;
}

// ---------- オフィスの NPC との相談 ----------

/**
 * 相談・提案で NPC に渡す «作品の中身»。要約だけでなく、人物の外見・性格、場所、担当中の話のシーン構成とネームまで渡す。
 * 長くなりすぎないよう各項目を切り詰める。
 */
export function talkDetailSection(
  characters: Character[],
  backgrounds: Background[],
  focus: { episode: Episode; panels: Panel[] } | null,
  maxChars = 7000,
): string {
  const clip = (t: string, n: number) => (t.length > n ? `${t.slice(0, n)}…` : t);
  const parts: string[] = [];
  if (characters.length) {
    parts.push(`### 登場人物の詳細\n${characters.map((c) => `- ${c.name}（${c.role}）: 外見: ${clip(c.appearance || '未設定', 160)} / 性格: ${clip(c.personality || '未設定', 160)}`).join('\n')}`);
  }
  if (backgrounds.length) {
    parts.push(`### 登録済みの場所\n${backgrounds.map((b) => `- ${b.name}: ${clip(b.description || '説明なし', 120)}`).join('\n')}`);
  }
  if (focus) {
    const { episode: e, panels } = focus;
    const scenes = e.scenes.length
      ? e.scenes.map((sc, i) => `${i + 1}. ${sc.title}: ${clip(sc.summary, 200)}（登場: ${sc.characters.join('・') || 'なし'}）`).join('\n')
      : '（シーン構成なし）';
    let name = '';
    if (panels.length) {
      const lines = panels.map((p) => {
        const dlg = p.dialogues.map((d) => (d.kind === 'narration' ? `N「${d.text}」` : d.kind === 'sfx' ? `[${d.text}]` : `${d.speaker}「${d.text}」`)).join(' ');
        return `p${p.layout.page} #${p.index + 1}: ${clip(p.description, 120)}${dlg ? ` ${clip(dlg, 160)}` : ''}`;
      });
      name = `\nネーム（${panels.length} コマ）:\n${lines.join('\n')}`;
    }
    parts.push(`### 担当中の話: 第${e.number}話「${e.title}」（${e.status}）\n${e.summary}\nシーン構成:\n${scenes}${name}`);
  }
  let out = parts.join('\n\n');
  if (out.length > maxChars) out = `${out.slice(0, maxChars)}\n…（長いため省略）`;
  return out;
}

export function talkPrompt(
  project: Project,
  persona: { name: string; canApply: boolean },
  episodes: Episode[],
  characters: Character[],
  foreshadowings: Foreshadowing[],
  seriesContext: string,
  history: { role: 'user' | 'npc'; text: string }[],
  message: string,
  detail = '',
): string {
  return `あなたは漫画編集部の「${persona.name}」として、作者（ユーザー）と会話しています。作品の状況を踏まえて、役割にふさわしい口調で «3〜6文» で答えてください。
作品の中身（人物・場所・担当中の話のシーン構成とネーム）を把握したうえで、具体的な話数・人物名・シーンに触れて答えてください。

## 作品の状況
${projectContextSummary(project, episodes, characters, foreshadowings)}
${detail ? `\n## 作品の中身\n${detail}\n` : ''}${seriesContext ? `\n## 連載アーカイブ（連載マネージャーより）\n${seriesContext}\n` : ''}
${history.length ? `## これまでの会話\n${history.map((h) => `${h.role === 'user' ? '作者' : persona.name}: ${h.text}`).join('\n')}\n` : ''}
## 今回の発言
${message}

## 出力形式（JSON）
{
  "reply": "返答（日本語。改行可）",
  "action": ${persona.canApply ? '"apply_change" または null  … 発言が «構成・伏線・話の内容を変える具体的な要望» で、そのまま反映して良いなら "apply_change"。質問や雑談なら null' : 'null'}
}
${JSON_ONLY}`;
}

/** NPC からの提案。mode: next = 次の展開 / review = いまの構成・ネームで気になる点 */
export function proposePrompt(
  project: Project,
  persona: { name: string; canApply: boolean },
  mode: 'next' | 'review',
  episodes: Episode[],
  characters: Character[],
  foreshadowings: Foreshadowing[],
  seriesContext: string,
  detail: string,
): string {
  const ask = mode === 'next'
    ? `この連載の «次の展開» を、あなたの役割の観点から 3 案提案してください。これまでの話の流れ・人物の現在地・未回収の伏線を踏まえ、どの話に何を入れるかまで具体的に。既にある話の焼き直しは避けること。`
    : `いまの構成（担当中の話があればそのシーン構成とネーム）を読んで、あなたの役割の観点から «気になる点» を 3 つ指摘し、それぞれ直し方を添えてください。矛盾・動機の弱さ・伏線の放置・テンポ・見せ場の不足など、具体的な話数・シーン・人物名を挙げて。褒めるだけの指摘は不要。`;
  return `あなたは漫画編集部の「${persona.name}」です。作者（ユーザー）に、作品の中身を踏まえた提案をします。
${ask}

## 作品の状況
${projectContextSummary(project, episodes, characters, foreshadowings)}
${detail ? `\n## 作品の中身\n${detail}\n` : ''}${seriesContext ? `\n## 連載アーカイブ（連載マネージャーより）\n${seriesContext}\n` : ''}
## 出力形式（JSON）
{
  "reply": "前置き1〜2文（役割の口調で。日本語）",
  "proposals": [
    { "title": "案の見出し（20字以内）", "detail": "内容（2〜4文。どの話のどこに何を、まで具体的に）", "instruction": "この案をそのまま構成に反映するときの指示文（1〜2文。命令形）" }
  ]
}
${JSON_ONLY}`;
}

/** 1話分のシーン構成を、担当編集の指示に沿って書き直す */
export function reviseScenesPrompt(project: Project, episode: Episode, instruction: string, seriesContext?: string): string {
  return `あなたはプロの漫画原作者です。以下の話のシーン構成を、担当編集の指示に沿って書き直してください。
話数と大筋は維持し、指示に関係ない部分はなるべく変えないでください。

## 作品あらすじ
${project.synopsis}

## 対象の話
第${episode.number}話「${episode.title}」: ${episode.summary}

## 現在のシーン構成
${episode.scenes.map((s, i) => `${i + 1}. ${s.title}: ${s.summary}（登場: ${s.characters.join('・')} / 伏線: ${(s.foreshadowRefs ?? []).map((r) => `${r.title}(${r.action})`).join('、') || 'なし'}）`).join('\n')}
${seriesContextSection(seriesContext)}
## 担当編集からの指示
${instruction.trim()}

## 出力形式（JSON）
{
  "title": "話タイトル（変更不要ならそのまま）",
  "summary": "話の要約",
  "scenes": [
    { "title": "シーン名", "summary": "シーンの内容", "characters": ["登場キャラ名"], "foreshadowRefs": [{"title": "伏線タイトル", "action": "setup または payoff"}] }
  ]
}
${JSON_ONLY}`;
}

// ---------- 絵の指示用の固定文 / 作画チェック ----------

export function visualPromptPrompt(kind: 'character' | 'background', name: string, description: string): string {
  const what = kind === 'character'
    ? 'このキャラクターを «毎回同じ見た目» で描くための外見タグ列。年齢・性別・髪型・髪色・目の色・肌・体格・標準の服装と小物を、固有名詞を使わず具体的に。表情・ポーズ・構図・背景は含めない。'
    : 'この場所を «毎回同じ構造» で描くための描写タグ列。建物の種類・内装・家具の配置・照明・時間帯の既定・雰囲気を具体的に。人物は含めない。';
  return `あなたは漫画の作画監督です。画像生成モデルへ渡す «固定文»（英語）を1つ作ってください。全コマで同じ文言を使うので、曖昧語を避け、短く密度高く。

## 目的
${what}

## 対象の名前
${name}

## 設定（日本語）
${description || '（詳細な設定なし。名前から妥当に補完すること）'}

## 制約
- 英語のカンマ区切りタグ列のみ。日本語・説明文を混ぜない
- 60語以内
- 文字・ロゴ・吹き出しに関する語を入れない

## 出力JSON
{"prompt": "英語の固定文"}
出力は指定した JSON のみとし、前置きや説明文は一切書かないこと。`;
}

export function artCheckPrompt(
  panel: { description: string; imagePrompt: string; dialogues: { speaker: string; text: string }[] },
  characters: { name: string; appearance: string; visualPrompt: string | null }[],
  background: { name: string; description: string; visualPrompt: string | null } | null,
  imageFile: string,
  refImages: { name: string; file: string }[],
  attempt: number,
): string {
  return `生成されたコマの画像を確認し、設定と合っているか判定してください。
まず Read ツールで画像ファイルを開いて実際に見てください（開かずに判定しないこと）。

## 確認する画像
${imageFile}

## 参照画像（キャラクター設定画。あれば必ず見比べる）
${refImages.length ? refImages.map((r) => `- ${r.name}: ${r.file}`).join('\n') : '（なし。文章の設定だけで判定）'}

## このコマの意図
- 情景: ${panel.description}
- 画像プロンプト: ${panel.imagePrompt}
- 登場人物: ${characters.length ? characters.map((c) => c.name).join('・') : 'なし（人物が写っていたら不一致）'}

## 登場人物の設定（これと一致していること）
${characters.length ? characters.map((c) => `- ${c.name}: ${c.visualPrompt || c.appearance}`).join('\n') : '（なし）'}
${background ? `\n## 舞台の設定\n- ${background.name}: ${background.visualPrompt || background.description}\n` : ''}
## 試行
${attempt}

## 判定基準（不一致のときだけ指摘。好みや画風の良し悪しは指摘しない）
1. 髪型・髪色・目の色・服装・小物が設定（参照画像）と違う
2. 登場人物の人数が意図と違う、別人が混ざっている
3. 画像内に文字・吹き出し・判読不能な記号・ロゴ・透かしが入っている（吹き出しはアプリが描くので画像に入っていたら不一致）
4. 手や顔が明らかに破綻している
5. 情景が意図と大きく違う（例: 夜のはずが昼）

## 出力形式（JSON）
{
  "pass": true または false,
  "issues": ["不一致の内容（日本語・簡潔）"],
  "fixPrompt": "描き直し時に画像プロンプトへ追加する英語の短い指示（pass なら空文字）"
}
出力は指定した JSON のみとし、前置きや説明文は一切書かないこと。`;
}

/** 設定画の候補を見比べて順位付けする（キャラ: 設定担当 / 背景: ロケハン担当） */
export function artPickPrompt(
  kind: 'character' | 'background',
  owner: { name: string; description: string; visualPrompt: string | null },
  candidates: { id: number; file: string }[],
  photos: string[] = [],
): string {
  const what = kind === 'character' ? `キャラクター「${owner.name}」の設定画` : `場所「${owner.name}」の背景設定画`;
  const criteria = kind === 'character'
    ? `1. 髪型・髪色・目・服装・小物が設定と一致している
2. 顔立ちが判別しやすく、以後の作画の基準にしやすい（正面寄り・表情ニュートラル・他人物なし）
3. 文字・透かし・破綻がない`
    : `1. 建物の種類・内装・家具・照明・雰囲気が設定と一致している
2. 空間の構造が分かる引きの構図で、以後「同じ場所」を描く基準にしやすい
3. 人物が写っていない。文字・看板の文字・透かし・破綻がない`;
  return `${what}の候補を見比べ、設定に最も忠実な1枚を選んでください。
まず Read ツールで各画像ファイルを開いて実際に見てください（開かずに判定しないこと）。

## 設定（これに最も近いものを選ぶ）
${owner.visualPrompt ? `- 固定文: ${owner.visualPrompt}\n` : ''}- 説明: ${owner.description || '（詳細なし）'}

## 候補
${candidates.map((c, i) => `- 候補${i + 1} id=${c.id}: ${c.file}`).join('\n')}
${photos.length ? `\n## 元になったロケハン写真（候補はこれを漫画風に起こしたもの。構造が写真と一致しているかも見る）\n${photos.map((f) => `- ${f}`).join('\n')}\n` : ''}
## 判定基準（優先順）
${criteria}${photos.length ? '\n4. 元の写真の構図・建物・家具の配置が保たれている（別の場所になっていない）' : ''}

## 出力形式（JSON）
{ "ranking": [最も良い候補のidから順に全候補のid], "reason": "1位を選んだ理由と、他を下げた理由（日本語・簡潔）" }
出力は指定した JSON のみとし、前置きや説明文は一切書かないこと。`;
}

/** ロケハン写真を漫画の背景に様式化する（画像生成モデルへの英語プロンプト） */
export function stylizePhotoPrompt(name: string, stylePrompt: string): string {
  return [
    `Redraw the reference photo as a manga background illustration of "${name}".`,
    'Keep the exact layout, perspective, architecture, furniture and lighting of the photo.',
    'Remove all people, vehicles, signage text and logos. No text, no letters, no watermark.',
    stylePrompt || 'black and white manga style, clean ink lines, screentone shading',
  ].join(' ');
}

/** 構成・ネームから繰り返し使う場所を拾い出す（ロケハン担当） */
export function locationsPrompt(
  project: Project,
  episodes: { episode: Episode; panels: { description: string; backgroundId: number | null }[] }[],
  existingNames: string[],
): string {
  return `あなたは漫画編集部のロケハン担当です。以下の構成とネームから、«繰り返し登場する、毎回同じ構造で描くべき場所» を拾い出してください。
一度しか出ない場所や、描写が「街」「路上」程度に曖昧な場所は入れないでください。

## 作品あらすじ
${project.synopsis}

## 話ごとのシーンとコマ
${episodes.map(({ episode, panels }) => `### 第${episode.number}話「${episode.title}」
シーン: ${episode.scenes.map((sc) => `${sc.title}（${sc.summary}）`).join(' / ')}
${panels.length ? `コマ: ${panels.map((p) => p.description).join(' / ')}` : ''}`).join('\n')}

## 既に登録済みの場所（重複させない）
${existingNames.length ? existingNames.map((n) => `- ${n}`).join('\n') : 'なし'}

## 出力形式（JSON）
{
  "locations": [
    { "name": "場所の名前（短く。作中で呼ぶ名前）", "description": "建物の種類・内装・家具・照明・雰囲気・時間帯の既定（日本語で2〜4文）" }
  ]
}
${JSON_ONLY}`;
}
