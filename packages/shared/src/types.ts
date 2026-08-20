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
  /** ネーム生成後に AI 批評→改稿を行う回数（0で無効） */
  nameReviewRounds: number;
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

/** 吹き出しのコマ内配置。同一コマ内で重複させないことで被りを防ぐ */
export type BubblePosition =
  | 'top-left' | 'top-right'
  | 'bottom-left' | 'bottom-right'
  | 'middle-left' | 'middle-right';

export interface Dialogue {
  speaker: string;
  text: string;
  kind: 'speech' | 'thought' | 'narration' | 'sfx';
  /** 吹き出しの配置。未指定時はビューア側が読み方向に沿って自動配置 */
  position?: BubblePosition;
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
  /** 背景ID（背景の参照画像/LoRAの解決に使用。未設定なら null） */
  backgroundId: number | null;
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

// ---------- 背景（背景・ロケーションの一貫性） ----------

/**
 * 「同じ酒場」「同じ教室」を毎回同じ絵で出すための背景アセット。
 * キャラと同じく参照画像 / LoRA を持ち、パネルに紐付けて作画時へ渡される。
 */
export interface Background {
  id: number;
  /** null = プロジェクト非依存のライブラリアセット */
  projectId: number | null;
  name: string;
  /** 場所の説明（日本語）。参照画像の生成プロンプトの元になる */
  description: string;
  /** 画像生成時に一貫性維持へ使う参照画像URL */
  refImageUrl: string | null;
  /** 背景専用LoRAのURL/識別子 */
  loraUrl: string | null;
  sourceAssetId: number | null;
  createdAt: string;
}

// ---------- 参照画像（一貫性アセットの候補画像） ----------

export type RefImageKind = 'character' | 'background' | 'style';

/**
 * Replicate で生成した参照画像の候補。
 * 同じ対象に対して複数枚生成し、ユーザーが「これを正とする」1枚を選ぶ。
 */
export interface RefImage {
  id: number;
  projectId: number;
  kind: RefImageKind;
  /** character.id / background.id / art_style.id */
  ownerId: number;
  url: string;
  /** 生成に使った英語プロンプト（再現・微調整用） */
  prompt: string;
  /** 対象の refImageUrl として採用中か */
  selected: boolean;
  createdAt: string;
}

// ---------- 非同期ジョブ ----------

export type JobKind =
  | 'structure'
  | 'characters'
  | 'panels'
  | 'episode_images'
  | 'discussion'
  | 'apply_change'
  | 'ref_images'
  | 'lora_train';

export type JobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

/**
 * 数十秒〜数十分かかる処理の進捗をフロントへ返すためのジョブ。
 * サーバー内メモリではなく DB に持つため、リロードしても進捗が追える。
 */
export interface Job {
  id: number;
  projectId: number | null;
  kind: JobKind;
  status: JobStatus;
  /** 画面表示用のジョブ名（例: "AI編集会議"） */
  label: string;
  /** 現在実行中のステップ名（例: "編集者が発言中…"） */
  step: string;
  doneSteps: number;
  totalSteps: number;
  /** 完了後に開くべき対象（例: "discussion:12"） */
  resultRef: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- LoRA学習 ----------

export type LoraTargetKind = 'character' | 'background' | 'art_style';

export type LoraTrainingStatus =
  | 'preparing'
  | 'uploading'
  | 'training'
  | 'succeeded'
  | 'failed'
  | 'canceled';

/**
 * Replicate の trainings API による LoRA 学習。
 * 学習画像を ZIP 化 → Replicate files API へアップロード → trainer モデルを実行、
 * という流れを1レコードで追跡する。完了すると weightsUrl が対象の loraUrl に入る。
 */
export interface LoraTraining {
  id: number;
  projectId: number;
  targetKind: LoraTargetKind;
  targetId: number;
  /** 表示名（対象の名前をコピー） */
  name: string;
  /** 学習に使う Replicate モデル（version 付き） */
  trainerModel: string;
  /** 学習結果の出力先モデル（owner/model 形式。事前に Replicate 上で作成が必要） */
  destination: string;
  /** プロンプトでこの LoRA を呼び出すためのトリガーワード */
  triggerWord: string;
  /** 学習に使った画像URL */
  imageUrls: string[];
  /** Replicate 側の training id */
  replicateId: string | null;
  status: LoraTrainingStatus;
  /** 完了後の重みURL */
  weightsUrl: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

// ---------- デフォルト値 ----------

export const DEFAULT_PANEL_RULES: PanelRules = {
  maxPanelsPerPage: 6,
  gridCols: 4,
  gridRows: 6,
  readingDirection: 'rtl',
  nameReviewRounds: 1,
  customRules: '',
};

export const DEFAULT_STORY_TEMPLATE: StoryTemplate = {
  name: '起承転結',
  pagesPerEpisode: 8,
  instructions: '各話の最後に次話への引きを作ること。',
};
