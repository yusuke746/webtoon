import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArtStyle, Background, Character, Discussion, DiscussionMessage, Episode,
  Foreshadowing, Job, LoraTraining, Panel, Project, RefImage, Worldview,
} from '@manga/shared';
import { DEFAULT_PANEL_RULES, DEFAULT_STORY_TEMPLATE } from '@manga/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, '../../../data');
mkdirSync(DATA_DIR, { recursive: true });

export const db = new DatabaseSync(path.join(DATA_DIR, 'manga.db'));

db.exec(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  synopsis TEXT NOT NULL DEFAULT '',
  art_style_id INTEGER,
  panel_rules TEXT NOT NULL,
  story_template TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS episodes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  scenes TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS characters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT '',
  appearance TEXT NOT NULL DEFAULT '',
  personality TEXT NOT NULL DEFAULT '',
  ref_image_url TEXT,
  lora_url TEXT,
  source_asset_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS worldviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source_asset_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS art_styles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT 'black-forest-labs/flux-schnell',
  style_prompt TEXT NOT NULL DEFAULT '',
  lora_url TEXT,
  extra_input TEXT NOT NULL DEFAULT '{}',
  source_asset_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS foreshadowings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  setup_episode INTEGER,
  planned_payoff_episode INTEGER,
  resolved_episode INTEGER,
  status TEXT NOT NULL DEFAULT 'planned',
  related_characters TEXT NOT NULL DEFAULT '[]',
  related_items TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS panels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  episode_id INTEGER NOT NULL REFERENCES episodes(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  layout TEXT NOT NULL DEFAULT '{}',
  description TEXT NOT NULL DEFAULT '',
  dialogues TEXT NOT NULL DEFAULT '[]',
  image_prompt TEXT NOT NULL DEFAULT '',
  image_url TEXT,
  character_ids TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'draft'
);

CREATE TABLE IF NOT EXISTS discussions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  topic TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  summary TEXT,
  proposal TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS discussion_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  discussion_id INTEGER NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
  round INTEGER NOT NULL,
  role_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS backgrounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  ref_image_url TEXT,
  lora_url TEXT,
  source_asset_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ref_images (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  owner_id INTEGER NOT NULL,
  url TEXT NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  selected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_ref_images_owner ON ref_images (kind, owner_id);

CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  label TEXT NOT NULL DEFAULT '',
  step TEXT NOT NULL DEFAULT '',
  done_steps INTEGER NOT NULL DEFAULT 0,
  total_steps INTEGER NOT NULL DEFAULT 1,
  result_ref TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs (project_id, id DESC);

CREATE TABLE IF NOT EXISTS lora_trainings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target_kind TEXT NOT NULL,
  target_id INTEGER NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  trainer_model TEXT NOT NULL DEFAULT '',
  destination TEXT NOT NULL DEFAULT '',
  trigger_word TEXT NOT NULL DEFAULT '',
  image_urls TEXT NOT NULL DEFAULT '[]',
  replicate_id TEXT,
  status TEXT NOT NULL DEFAULT 'preparing',
  weights_url TEXT,
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`);

// ---------- 追加カラムのマイグレーション ----------
// CREATE TABLE IF NOT EXISTS は既存テーブルへの列追加をしないため、個別に補う。

/** 既に存在する場合は何もしない ALTER TABLE ADD COLUMN */
function addColumnIfMissing(table: string, column: string, definition: string) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// パネルに背景を紐付ける（作画時に背景の参照画像/LoRAを渡すため）
addColumnIfMissing('panels', 'background_id', 'INTEGER');

// ---------- 行 → ドメイン型 変換 ----------

type Row = Record<string, any>;

export function rowToProject(r: Row): Project {
  return {
    id: r.id,
    title: r.title,
    synopsis: r.synopsis,
    artStyleId: r.art_style_id,
    // 旧データに新設フィールドがなくてもデフォルト値で補完する
    panelRules: { ...DEFAULT_PANEL_RULES, ...(r.panel_rules ? JSON.parse(r.panel_rules) : {}) },
    storyTemplate: { ...DEFAULT_STORY_TEMPLATE, ...(r.story_template ? JSON.parse(r.story_template) : {}) },
    createdAt: r.created_at,
  };
}

export function rowToEpisode(r: Row): Episode {
  return {
    id: r.id,
    projectId: r.project_id,
    number: r.number,
    title: r.title,
    summary: r.summary,
    scenes: JSON.parse(r.scenes),
    status: r.status,
    createdAt: r.created_at,
  };
}

export function rowToCharacter(r: Row): Character {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    role: r.role,
    appearance: r.appearance,
    personality: r.personality,
    refImageUrl: r.ref_image_url,
    loraUrl: r.lora_url,
    sourceAssetId: r.source_asset_id,
    createdAt: r.created_at,
  };
}

export function rowToWorldview(r: Row): Worldview {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    sourceAssetId: r.source_asset_id,
    createdAt: r.created_at,
  };
}

export function rowToArtStyle(r: Row): ArtStyle {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    model: r.model,
    stylePrompt: r.style_prompt,
    loraUrl: r.lora_url,
    extraInput: JSON.parse(r.extra_input),
    sourceAssetId: r.source_asset_id,
    createdAt: r.created_at,
  };
}

export function rowToForeshadowing(r: Row): Foreshadowing {
  return {
    id: r.id,
    projectId: r.project_id,
    title: r.title,
    description: r.description,
    setupEpisode: r.setup_episode,
    plannedPayoffEpisode: r.planned_payoff_episode,
    resolvedEpisode: r.resolved_episode,
    status: r.status,
    relatedCharacters: JSON.parse(r.related_characters),
    relatedItems: JSON.parse(r.related_items),
    createdAt: r.created_at,
  };
}

export function rowToPanel(r: Row): Panel {
  return {
    id: r.id,
    episodeId: r.episode_id,
    index: r.idx,
    layout: JSON.parse(r.layout),
    description: r.description,
    dialogues: JSON.parse(r.dialogues),
    imagePrompt: r.image_prompt,
    imageUrl: r.image_url,
    characterIds: JSON.parse(r.character_ids),
    backgroundId: r.background_id ?? null,
    status: r.status,
  };
}

export function rowToBackground(r: Row): Background {
  return {
    id: r.id,
    projectId: r.project_id,
    name: r.name,
    description: r.description,
    refImageUrl: r.ref_image_url,
    loraUrl: r.lora_url,
    sourceAssetId: r.source_asset_id,
    createdAt: r.created_at,
  };
}

export function rowToRefImage(r: Row): RefImage {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    ownerId: r.owner_id,
    url: r.url,
    prompt: r.prompt,
    selected: !!r.selected,
    createdAt: r.created_at,
  };
}

export function rowToJob(r: Row): Job {
  return {
    id: r.id,
    projectId: r.project_id,
    kind: r.kind,
    status: r.status,
    label: r.label,
    step: r.step,
    doneSteps: r.done_steps,
    totalSteps: r.total_steps,
    resultRef: r.result_ref,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToLoraTraining(r: Row): LoraTraining {
  return {
    id: r.id,
    projectId: r.project_id,
    targetKind: r.target_kind,
    targetId: r.target_id,
    name: r.name,
    trainerModel: r.trainer_model,
    destination: r.destination,
    triggerWord: r.trigger_word,
    imageUrls: JSON.parse(r.image_urls),
    replicateId: r.replicate_id,
    status: r.status,
    weightsUrl: r.weights_url,
    error: r.error,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function rowToDiscussion(r: Row): Discussion {
  return {
    id: r.id,
    projectId: r.project_id,
    topic: r.topic,
    status: r.status,
    summary: r.summary,
    proposal: r.proposal,
    createdAt: r.created_at,
  };
}

export function rowToDiscussionMessage(r: Row): DiscussionMessage {
  return {
    id: r.id,
    discussionId: r.discussion_id,
    round: r.round,
    roleName: r.role_name,
    content: r.content,
    createdAt: r.created_at,
  };
}
