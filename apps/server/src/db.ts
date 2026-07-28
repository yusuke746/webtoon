import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ArtStyle, Character, Discussion, DiscussionMessage, Episode,
  Foreshadowing, Panel, Project, Worldview,
} from '@manga/shared';
import { DEFAULT_PANEL_RULES, DEFAULT_STORY_TEMPLATE } from '@manga/shared';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.DATA_DIR ?? path.resolve(__dirname, '../../../data');
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
`);

// ---------- 行 → ドメイン型 変換 ----------

type Row = Record<string, any>;

export function rowToProject(r: Row): Project {
  return {
    id: r.id,
    title: r.title,
    synopsis: r.synopsis,
    artStyleId: r.art_style_id,
    panelRules: r.panel_rules ? JSON.parse(r.panel_rules) : DEFAULT_PANEL_RULES,
    storyTemplate: r.story_template ? JSON.parse(r.story_template) : DEFAULT_STORY_TEMPLATE,
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
    status: r.status,
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
