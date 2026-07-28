// ============================================================
// ドメイン型定義（サーバー・フロント共通）
// ============================================================

// ---------- プロジェクト（作品） ----------

export interface PanelRules {
  /** 1ページあたりの最大コマ数 */
  maxPanelsPerPage: number;
  /** グリッド列数（レイアウト座標系） */
  gridCols: number;
  /** グリッド行数 */
  gridRows: number;
  /** 読み方向 */
  readingDirection: 'rtl' | 'ltr' | 'vertical';
  /** 自由記述のレイアウト指示（例: "見開きの大ゴマを1話に1回入れる"） */
  customRules: string;
}

export interface StoryTemplate {
  /** 構成テンプレート名（例: 起承転結 / 三幕構成 / 序破急） */
  name: string;
  /** 1話あたりの目安ページ数 */
  pagesPerEpisode: number;
  /** 構成の自由記述指示 */
  instructions: string;
}

export interface Project {
  id: number;
  title: string;
  synopsis: string;
  artStyleId: number | null;
  panelRules: PanelRules;
  storyTemplate: StoryTemplate;
  createdAt: string;
}

// ---------- 話（エピソード） ----------

export interface Scene {
  title: string;
  summary: string;
  /** このシーンで登場するキャラ名 */
  characters: string[];
  /** 関係する伏線タイトル（導入 or 回収） */
  foreshadowRefs: { title: string; action: 'setup' | 'payoff' }[];
}

export type EpisodeStatus = 'draft' | 'structured' | 'paneled' | 'rendered';

export interface Episode {
  id: number;
  projectId: number;
  number: number;
  title: string;
  summary: string;
  scenes: Scene[];
  status: EpisodeStatus;
  createdAt: string;
}

// ---------- キャラクター ----------

export interface Character {
  id: number;
  /** null = プロジェクト非依存のライブラリアセット */
  projectId: number | null;
  name: string;
  role: string;
  appearance: string;
  personality: string;
  /** 画像生成時に一貫性維持へ使う参照画像URL */
  refImageUrl: string | null;
  /** キャラ専用LoRAのURL/識別子 */
  loraUrl: string | null;
  /** ライブラリからキャスティングした場合の元アセットID */
  sourceAssetId: number | null;
  createdAt: string;
}

// ---------- 世界観 ----------

export interface Worldview {
  id: number;
  projectId: number | null;
  name: string;
  description: string;
  sourceAssetId: number | null;
  createdAt: string;
}

// ---------- 画風 ----------

export interface ArtStyle {
  id: number;
  projectId: number | null;
  name: string;
  /** Replicate モデル（owner/name 形式） */
  model: string;
  /** 全パネル共通で付与するスタイルプロンプト */
  stylePrompt: string;
  /** スタイルLoRAのURL/識別子 */
  loraUrl: string | null;
  /** モデル固有の追加入力（JSON） */
  extraInput: Record<string, unknown>;
  sourceAssetId: number | null;
  createdAt: string;
}

// ---------- 伏線 ----------

export type ForeshadowStatus = 'planned' | 'planted' | 'resolved';

export interface Foreshadowing {
  id: number;
  projectId: number;
  title: string;
  description: string;
  /** 導入話数（未導入なら null） */
  setupEpisode: number | null;
  /** 回収予定話数 */
  plannedPayoffEpisode: number | null;
  /** 実際に回収された話数 */
  resolvedEpisode: number | null;
  status: ForeshadowStatus;
  relatedCharacters: string[];
  relatedItems: string[];
  createdAt: string;
}

export interface ForeshadowWarning {
  foreshadowing: Foreshadowing;
  level: 'overdue' | 'due' | 'info';
  message: string;
}

// ---------- コマ（パネル） ----------

export interface PanelLayout {
  page: number;
  /** グリッド座標（PanelRules.gridCols/gridRows 基準） */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Dialogue {
  speaker: string;
  text: string;
  kind: 'speech' | 'thought' | 'narration' | 'sfx';
}

export type PanelStatus = 'draft' | 'generating' | 'done' | 'error';

export interface Panel {
  id: number;
  episodeId: number;
  index: number;
  layout: PanelLayout;
  /** 情景・構図の説明（日本語） */
  description: string;
  dialogues: Dialogue[];
  /** 画像生成に使う英語プロンプト */
  imagePrompt: string;
  imageUrl: string | null;
  /** 登場キャラID（参照画像/LoRAの解決に使用） */
  characterIds: number[];
  status: PanelStatus;
}

// ---------- AI議論 ----------

export type DiscussionStatus = 'running' | 'awaiting_user' | 'adopted' | 'rejected';

export interface Discussion {
  id: number;
  projectId: number;
  topic: string;
  status: DiscussionStatus;
  /** 合意形成された提案の要約（ユーザー向け） */
  summary: string | null;
  /** 採用時に適用する具体的な変更提案 */
  proposal: string | null;
  createdAt: string;
}

export interface DiscussionMessage {
  id: number;
  discussionId: number;
  round: number;
  /** 役割名（編集者 / プロット担当 / 読者代表 / まとめ役 / ユーザー） */
  roleName: string;
  content: string;
  createdAt: string;
}

// ---------- デフォルト値 ----------

export const DEFAULT_PANEL_RULES: PanelRules = {
  maxPanelsPerPage: 6,
  gridCols: 4,
  gridRows: 6,
  readingDirection: 'rtl',
  customRules: '',
};

export const DEFAULT_STORY_TEMPLATE: StoryTemplate = {
  name: '起承転結',
  pagesPerEpisode: 8,
  instructions: '各話の最後に次話への引きを作ること。',
};
