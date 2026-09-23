import type {
  Background, Character, Episode, Foreshadowing, PanelRules, Project, StoryTemplate,
} from '@manga/shared';

/** Claude へ渡すプロンプトのテンプレート集。すべて JSON 出力を強制する */

const JSON_ONLY = '出力は指定した JSON のみとし、前置きや説明文は一切書かないこと。';

export function structurePrompt(
  project: Project,
  episodeCount: number,
  existingEpisodes: Episode[],
  foreshadowings: Foreshadowing[],
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

export function charactersPrompt(project: Project, episodes: Episode[]): string {
  return `あなたはプロのキャラクターデザイナーです。以下の作品に登場するキャラクターの設定を作ってください。

## あらすじ
${project.synopsis}

## 話数構成
${episodes.map((e) => `- 第${e.number}話「${e.title}」: ${e.summary}\n  シーン: ${e.scenes.map((s) => `${s.title}(${s.characters.join('・')})`).join(' / ')}`).join('\n')}

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
${panelRulesSection(project)}

## 依頼
各コマについて、情景描写・セリフ・画像生成用の英語プロンプトを作成してください。
英語プロンプトには "manga panel" とカメラワーク・構図・キャラの外見特徴を必ず含めてください。
画像には後工程でセリフと吹き出しを重ねるため、imagePrompt には文字、吹き出し、字幕、擬音、ロゴ、透かしを描く指示を含めないでください。

${PANELS_OUTPUT_FORMAT}`;
}

function panelRulesSection(project: Project): string {
  const rules: PanelRules = project.panelRules;
  return `## コマ割りルール（読みやすさ最優先）
- 1ページ最大${rules.maxPanelsPerPage}コマ
- レイアウトは ${rules.gridCols}列 × ${rules.gridRows}行 のグリッド座標（x,y,w,h は整数、x+w <= ${rules.gridCols}、y+h <= ${rules.gridRows}）
- 同一ページ内でコマ同士を重ねない。隙間なく敷き詰め、読み順が一目で分かる段組みにする
- コマの大きさに強弱をつける（見せ場は大ゴマ、テンポを出す場面は小さい横長ゴマ）
- 読み方向: ${rules.readingDirection === 'rtl' ? '右から左（日本式）。同じ段では右のコマが先' : rules.readingDirection === 'ltr' ? '左から右' : '縦スクロール（Webtoon）。コマは上から下へ1列'}
- 目安ページ数: ${project.storyTemplate.pagesPerEpisode}ページ
- 追加ルール: ${rules.customRules || 'なし'}

## セリフ・吹き出しのルール（重なり厳禁）
- 1コマのセリフは最大3つ。1つのセリフは40字以内（長い場合はコマを分ける）
- 各セリフに position を必ず指定する: "top-left" | "top-right" | "bottom-left" | "bottom-right" | "middle-left" | "middle-right"
- 同一コマ内で同じ position を2回使わない（吹き出しが重なるため）
- 読み方向が${rules.readingDirection === 'ltr' ? '左→右なので、先に読むセリフほど左・上に置く' : '右→左なので、先に読むセリフほど右・上に置く'}
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
