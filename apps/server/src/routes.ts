import { Router, type Request, type Response, type NextFunction } from 'express';
import { DEFAULT_PANEL_RULES, DEFAULT_STORY_TEMPLATE, type RefImageKind } from '@manga/shared';
import {
  db, rowToArtStyle, rowToBackground, rowToCharacter, rowToDiscussion, rowToEpisode,
  rowToForeshadowing, rowToPanel, rowToProject, rowToWorldview,
} from './db.js';
import {
  generateCharacters, generateEpisodeImages, generatePanelImage, generatePanels,
  generateStructure, getProject, listCharacters, listEpisodes, listForeshadowings, listPanels,
} from './engines/story.js';
import { detectWarnings, syncFromEpisodes } from './engines/foreshadow.js';
import { getDiscussion, intervene, listMessages, setDecision, startDiscussion } from './engines/discussion.js';
import { applyChange } from './engines/changes.js';
import { getJob, listActiveJobs, listJobs, startJob } from './engines/jobs.js';
import {
  cancelLoraTraining, createBackground, deleteBackground, deleteRefImage, listBackgrounds,
  listLoraTrainings, listRefImages, selectRefImage, startLoraTrainingJob, startRefImagesJob,
  updateBackground, validateLoraOptions,
} from './engines/visual.js';

export const router = Router();

/** async ハンドラのエラーを express のエラーハンドラへ渡す */
const wrap =
  (fn: (req: Request, res: Response) => Promise<void> | void) =>
  (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

const id = (req: Request, name = 'id') => Number(req.params[name]);

router.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// ============ プロジェクト ============

router.get('/projects', wrap((_req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY id DESC').all() as any[];
  res.json(rows.map(rowToProject));
}));

router.post('/projects', wrap((req, res) => {
  const { title, synopsis } = req.body ?? {};
  if (!title) { res.status(400).json({ error: 'title は必須です' }); return; }
  const result = db.prepare(
    'INSERT INTO projects (title, synopsis, panel_rules, story_template) VALUES (?, ?, ?, ?)',
  ).run(
    title, synopsis ?? '',
    JSON.stringify(DEFAULT_PANEL_RULES), JSON.stringify(DEFAULT_STORY_TEMPLATE),
  );
  res.status(201).json(getProject(Number(result.lastInsertRowid)));
}));

router.get('/projects/:id', wrap((req, res) => {
  res.json(getProject(id(req)));
}));

router.put('/projects/:id', wrap((req, res) => {
  const p = getProject(id(req));
  const { title, synopsis, artStyleId, panelRules, storyTemplate } = req.body ?? {};
  db.prepare(
    'UPDATE projects SET title = ?, synopsis = ?, art_style_id = ?, panel_rules = ?, story_template = ? WHERE id = ?',
  ).run(
    title ?? p.title,
    synopsis ?? p.synopsis,
    artStyleId === undefined ? p.artStyleId : artStyleId,
    JSON.stringify(panelRules ?? p.panelRules),
    JSON.stringify(storyTemplate ?? p.storyTemplate),
    p.id,
  );
  res.json(getProject(p.id));
}));

router.delete('/projects/:id', wrap((req, res) => {
  db.prepare('DELETE FROM projects WHERE id = ?').run(id(req));
  res.json({ ok: true });
}));

// ============ 生成パイプライン ============

router.post('/projects/:id/generate/structure', wrap(async (req, res) => {
  const episodeCount = Number(req.body?.episodeCount ?? 2);
  const episodes = await generateStructure(id(req), episodeCount);
  syncFromEpisodes(id(req));
  res.json({ episodes, foreshadowings: listForeshadowings(id(req)) });
}));

router.post('/projects/:id/generate/characters', wrap(async (req, res) => {
  res.json(await generateCharacters(id(req)));
}));

router.post('/episodes/:id/generate/panels', wrap(async (req, res) => {
  res.json(await generatePanels(id(req)));
}));

/** 一括作画はコマ数ぶん時間がかかるためジョブとして実行し、Job を返す */
router.post('/episodes/:id/generate/images', wrap((req, res) => {
  const episodeId = id(req);
  const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!row) { res.status(404).json({ error: 'エピソードが見つかりません' }); return; }
  const episode = rowToEpisode(row as any);
  const pending = listPanels(episodeId).filter((p) => p.status !== 'done');

  const job = startJob(
    {
      projectId: episode.projectId,
      kind: 'episode_images',
      label: `第${episode.number}話の一括作画`,
      totalSteps: Math.max(pending.length, 1),
      step: `未作画コマ ${pending.length} 件を作画します…`,
    },
    async (ctx) => {
      ctx.setResultRef(`episode:${episodeId}`);
      await generateEpisodeImages(episodeId, (done, total, label) => {
        ctx.advance(`作画中 ${done}/${total}: ${label}`);
      });
    },
  );
  res.status(202).json(job);
}));

router.post('/panels/:id/generate-image', wrap(async (req, res) => {
  res.json(await generatePanelImage(id(req)));
}));

// ============ エピソード / パネル（手動編集 → 再生成ループ） ============

router.get('/projects/:id/episodes', wrap((req, res) => {
  res.json(listEpisodes(id(req)));
}));

router.get('/episodes/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id(req));
  if (!row) { res.status(404).json({ error: 'エピソードが見つかりません' }); return; }
  const episode = rowToEpisode(row as any);
  res.json({ ...episode, panels: listPanels(episode.id) });
}));

router.put('/episodes/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM episodes WHERE id = ?').get(id(req));
  if (!row) { res.status(404).json({ error: 'エピソードが見つかりません' }); return; }
  const ep = rowToEpisode(row as any);
  const { title, summary, scenes } = req.body ?? {};
  db.prepare('UPDATE episodes SET title = ?, summary = ?, scenes = ? WHERE id = ?').run(
    title ?? ep.title, summary ?? ep.summary, JSON.stringify(scenes ?? ep.scenes), ep.id,
  );
  syncFromEpisodes(ep.projectId);
  res.json(rowToEpisode(db.prepare('SELECT * FROM episodes WHERE id = ?').get(ep.id) as any));
}));

router.put('/panels/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM panels WHERE id = ?').get(id(req));
  if (!row) { res.status(404).json({ error: 'パネルが見つかりません' }); return; }
  const p = rowToPanel(row as any);
  const { description, dialogues, imagePrompt, layout, characterIds, backgroundId } = req.body ?? {};
  db.prepare(
    `UPDATE panels SET description = ?, dialogues = ?, image_prompt = ?, layout = ?,
      character_ids = ?, background_id = ? WHERE id = ?`,
  ).run(
    description ?? p.description,
    JSON.stringify(dialogues ?? p.dialogues),
    imagePrompt ?? p.imagePrompt,
    JSON.stringify(layout ?? p.layout),
    JSON.stringify(characterIds ?? p.characterIds),
    backgroundId === undefined ? p.backgroundId : backgroundId,
    p.id,
  );
  res.json(rowToPanel(db.prepare('SELECT * FROM panels WHERE id = ?').get(p.id) as any));
}));

// ============ キャラクター ============

router.get('/projects/:id/characters', wrap((req, res) => {
  res.json(listCharacters(id(req)));
}));

router.post('/projects/:id/characters', wrap((req, res) => {
  const { name, role, appearance, personality, refImageUrl, loraUrl } = req.body ?? {};
  if (!name) { res.status(400).json({ error: 'name は必須です' }); return; }
  const result = db.prepare(
    'INSERT INTO characters (project_id, name, role, appearance, personality, ref_image_url, lora_url) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(id(req), name, role ?? '', appearance ?? '', personality ?? '', refImageUrl ?? null, loraUrl ?? null);
  res.status(201).json(rowToCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(Number(result.lastInsertRowid)) as any));
}));

router.put('/characters/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM characters WHERE id = ?').get(id(req));
  if (!row) { res.status(404).json({ error: 'キャラクターが見つかりません' }); return; }
  const c = rowToCharacter(row as any);
  const { name, role, appearance, personality, refImageUrl, loraUrl } = req.body ?? {};
  db.prepare(
    'UPDATE characters SET name = ?, role = ?, appearance = ?, personality = ?, ref_image_url = ?, lora_url = ? WHERE id = ?',
  ).run(
    name ?? c.name, role ?? c.role, appearance ?? c.appearance, personality ?? c.personality,
    refImageUrl === undefined ? c.refImageUrl : refImageUrl,
    loraUrl === undefined ? c.loraUrl : loraUrl,
    c.id,
  );
  res.json(rowToCharacter(db.prepare('SELECT * FROM characters WHERE id = ?').get(c.id) as any));
}));

router.delete('/characters/:id', wrap((req, res) => {
  db.prepare('DELETE FROM characters WHERE id = ?').run(id(req));
  res.json({ ok: true });
}));

// ============ 伏線回収エンジン ============

router.get('/projects/:id/foreshadowings', wrap((req, res) => {
  res.json(listForeshadowings(id(req)));
}));

router.get('/projects/:id/foreshadow-warnings', wrap((req, res) => {
  res.json(detectWarnings(id(req)));
}));

router.post('/projects/:id/foreshadow-sync', wrap((req, res) => {
  res.json(syncFromEpisodes(id(req)));
}));

router.post('/projects/:id/foreshadowings', wrap((req, res) => {
  const { title, description, setupEpisode, plannedPayoffEpisode, relatedCharacters, relatedItems } = req.body ?? {};
  if (!title) { res.status(400).json({ error: 'title は必須です' }); return; }
  const result = db.prepare(
    `INSERT INTO foreshadowings
      (project_id, title, description, setup_episode, planned_payoff_episode, status, related_characters, related_items)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id(req), title, description ?? '', setupEpisode ?? null, plannedPayoffEpisode ?? null,
    setupEpisode ? 'planted' : 'planned',
    JSON.stringify(relatedCharacters ?? []), JSON.stringify(relatedItems ?? []),
  );
  res.status(201).json(rowToForeshadowing(db.prepare('SELECT * FROM foreshadowings WHERE id = ?').get(Number(result.lastInsertRowid)) as any));
}));

router.put('/foreshadowings/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM foreshadowings WHERE id = ?').get(id(req));
  if (!row) { res.status(404).json({ error: '伏線が見つかりません' }); return; }
  const f = rowToForeshadowing(row as any);
  const b = req.body ?? {};
  db.prepare(
    `UPDATE foreshadowings SET title = ?, description = ?, setup_episode = ?, planned_payoff_episode = ?,
      resolved_episode = ?, status = ?, related_characters = ?, related_items = ? WHERE id = ?`,
  ).run(
    b.title ?? f.title, b.description ?? f.description,
    b.setupEpisode === undefined ? f.setupEpisode : b.setupEpisode,
    b.plannedPayoffEpisode === undefined ? f.plannedPayoffEpisode : b.plannedPayoffEpisode,
    b.resolvedEpisode === undefined ? f.resolvedEpisode : b.resolvedEpisode,
    b.status ?? f.status,
    JSON.stringify(b.relatedCharacters ?? f.relatedCharacters),
    JSON.stringify(b.relatedItems ?? f.relatedItems),
    f.id,
  );
  res.json(rowToForeshadowing(db.prepare('SELECT * FROM foreshadowings WHERE id = ?').get(f.id) as any));
}));

router.delete('/foreshadowings/:id', wrap((req, res) => {
  db.prepare('DELETE FROM foreshadowings WHERE id = ?').run(id(req));
  res.json({ ok: true });
}));

// ============ AI議論 ============

router.get('/projects/:id/discussions', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM discussions WHERE project_id = ? ORDER BY id DESC').all(id(req)) as any[];
  res.json(rows.map(rowToDiscussion));
}));

/** 議論はバックグラウンド実行。discussion と進捗追跡用の job を返す */
router.post('/projects/:id/discussions', wrap((req, res) => {
  const { topic } = req.body ?? {};
  if (!topic) { res.status(400).json({ error: 'topic は必須です' }); return; }
  res.status(202).json(startDiscussion(id(req), topic));
}));

router.get('/discussions/:id', wrap((req, res) => {
  const d = getDiscussion(id(req));
  res.json({ ...d, messages: listMessages(d.id) });
}));

router.post('/discussions/:id/intervene', wrap((req, res) => {
  const { comment } = req.body ?? {};
  if (!comment) { res.status(400).json({ error: 'comment は必須です' }); return; }
  res.status(202).json(intervene(id(req), comment));
}));

router.post('/discussions/:id/decision', wrap(async (req, res) => {
  const { adopted, applyToStructure } = req.body ?? {};
  const d = setDecision(id(req), !!adopted);
  // 採用時、提案内容を変更指示としてそのまま構成へ反映できる
  if (adopted && applyToStructure && d.proposal) {
    await applyChange(d.projectId, d.proposal);
  }
  res.json(d);
}));

// ============ 要約ベースの変更指示（拡張5） ============

router.post('/projects/:id/apply-change', wrap(async (req, res) => {
  const { instruction } = req.body ?? {};
  if (!instruction) { res.status(400).json({ error: 'instruction は必須です' }); return; }
  res.json(await applyChange(id(req), instruction));
}));

// ============ 画風 / 世界観 ============

router.get('/projects/:id/art-styles', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM art_styles WHERE project_id = ? ORDER BY id').all(id(req)) as any[];
  res.json(rows.map(rowToArtStyle));
}));

router.post('/projects/:id/art-styles', wrap((req, res) => {
  const { name, model, stylePrompt, loraUrl, extraInput } = req.body ?? {};
  if (!name) { res.status(400).json({ error: 'name は必須です' }); return; }
  const result = db.prepare(
    'INSERT INTO art_styles (project_id, name, model, style_prompt, lora_url, extra_input) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(id(req), name, model ?? 'black-forest-labs/flux-schnell', stylePrompt ?? '', loraUrl ?? null, JSON.stringify(extraInput ?? {}));
  res.status(201).json(rowToArtStyle(db.prepare('SELECT * FROM art_styles WHERE id = ?').get(Number(result.lastInsertRowid)) as any));
}));

router.put('/art-styles/:id', wrap((req, res) => {
  const row = db.prepare('SELECT * FROM art_styles WHERE id = ?').get(id(req));
  if (!row) { res.status(404).json({ error: '画風が見つかりません' }); return; }
  const s = rowToArtStyle(row as any);
  const b = req.body ?? {};
  db.prepare(
    'UPDATE art_styles SET name = ?, model = ?, style_prompt = ?, lora_url = ?, extra_input = ? WHERE id = ?',
  ).run(
    b.name ?? s.name, b.model ?? s.model, b.stylePrompt ?? s.stylePrompt,
    b.loraUrl === undefined ? s.loraUrl : b.loraUrl,
    JSON.stringify(b.extraInput ?? s.extraInput), s.id,
  );
  res.json(rowToArtStyle(db.prepare('SELECT * FROM art_styles WHERE id = ?').get(s.id) as any));
}));

router.get('/projects/:id/worldviews', wrap((req, res) => {
  const rows = db.prepare('SELECT * FROM worldviews WHERE project_id = ? ORDER BY id').all(id(req)) as any[];
  res.json(rows.map(rowToWorldview));
}));

router.post('/projects/:id/worldviews', wrap((req, res) => {
  const { name, description } = req.body ?? {};
  if (!name) { res.status(400).json({ error: 'name は必須です' }); return; }
  const result = db.prepare(
    'INSERT INTO worldviews (project_id, name, description) VALUES (?, ?, ?)',
  ).run(id(req), name, description ?? '');
  res.status(201).json(rowToWorldview(db.prepare('SELECT * FROM worldviews WHERE id = ?').get(Number(result.lastInsertRowid)) as any));
}));

// ============ ジョブ（非同期処理の進捗） ============

router.get('/projects/:id/jobs', wrap((req, res) => {
  res.json(listJobs(id(req)));
}));

router.get('/projects/:id/jobs/active', wrap((req, res) => {
  res.json(listActiveJobs(id(req)));
}));

router.get('/jobs/:id', wrap((req, res) => {
  res.json(getJob(id(req)));
}));

// ============ 背景（背景・ロケーションの一貫性） ============

router.get('/projects/:id/backgrounds', wrap((req, res) => {
  res.json(listBackgrounds(id(req)));
}));

router.post('/projects/:id/backgrounds', wrap((req, res) => {
  const { name } = req.body ?? {};
  if (!name) { res.status(400).json({ error: 'name は必須です' }); return; }
  res.status(201).json(createBackground(id(req), req.body));
}));

router.put('/backgrounds/:id', wrap((req, res) => {
  res.json(updateBackground(id(req), req.body ?? {}));
}));

router.delete('/backgrounds/:id', wrap((req, res) => {
  deleteBackground(id(req));
  res.json({ ok: true });
}));

// ============ 参照画像（一貫性アセットの候補画像） ============

router.get('/ref-images/:kind/:ownerId', wrap((req, res) => {
  const kind = req.params.kind as RefImageKind;
  if (!['character', 'background', 'style'].includes(kind)) {
    res.status(400).json({ error: `不明な種別: ${kind}` }); return;
  }
  res.json(listRefImages(kind, id(req, 'ownerId')));
}));

/** 参照画像を複数枚生成する（バックグラウンド実行。Job を返す） */
router.post('/projects/:id/ref-images/:kind/:ownerId/generate', wrap((req, res) => {
  const kind = req.params.kind as RefImageKind;
  if (!['character', 'background', 'style'].includes(kind)) {
    res.status(400).json({ error: `不明な種別: ${kind}` }); return;
  }
  const count = Math.min(Math.max(Number(req.body?.count ?? 4), 1), 8);
  const job = startRefImagesJob(id(req), kind, id(req, 'ownerId'), count, req.body?.prompt);
  res.status(202).json(job);
}));

/** 候補の1枚を採用（対象の refImageUrl に反映される） */
router.post('/ref-images/:id/select', wrap((req, res) => {
  res.json(selectRefImage(id(req)));
}));

router.delete('/ref-images/:id', wrap((req, res) => {
  deleteRefImage(id(req));
  res.json({ ok: true });
}));

// ============ LoRA 学習 ============

router.get('/projects/:id/lora-trainings', wrap((req, res) => {
  res.json(listLoraTrainings(id(req)));
}));

/** 学習開始前の前提チェック（トークン・学習モデル・出力先・枚数） */
router.post('/projects/:id/lora-trainings/validate', wrap((req, res) => {
  const b = req.body ?? {};
  res.json({
    problems: validateLoraOptions({
      targetKind: b.targetKind, targetId: Number(b.targetId),
      imageUrls: b.imageUrls ?? [], triggerWord: b.triggerWord ?? '',
      trainerModel: b.trainerModel, destination: b.destination,
    }),
    defaults: {
      trainerModel: process.env.REPLICATE_LORA_TRAINER ?? '',
      destination: process.env.REPLICATE_LORA_DESTINATION ?? '',
    },
  });
}));

router.post('/projects/:id/lora-trainings', wrap((req, res) => {
  const b = req.body ?? {};
  if (!b.targetKind || !b.targetId) {
    res.status(400).json({ error: 'targetKind と targetId は必須です' }); return;
  }
  res.status(202).json(startLoraTrainingJob(id(req), {
    targetKind: b.targetKind,
    targetId: Number(b.targetId),
    imageUrls: b.imageUrls ?? [],
    triggerWord: b.triggerWord ?? '',
    steps: b.steps ? Number(b.steps) : undefined,
    loraRank: b.loraRank ? Number(b.loraRank) : undefined,
    trainerModel: b.trainerModel || undefined,
    destination: b.destination || undefined,
  }));
}));

router.post('/lora-trainings/:id/cancel', wrap(async (req, res) => {
  res.json(await cancelLoraTraining(id(req)));
}));

// ============ アセットライブラリ（データの使い回し・拡張4） ============
// project_id が NULL の行 = 作品横断で再利用可能なライブラリアセット

const ASSET_TABLES = {
  character: 'characters',
  worldview: 'worldviews',
  art_style: 'art_styles',
  background: 'backgrounds',
} as const;
type AssetType = keyof typeof ASSET_TABLES;

const assetMapper = {
  character: rowToCharacter,
  worldview: rowToWorldview,
  art_style: rowToArtStyle,
  background: rowToBackground,
} as const;

router.get('/assets/:type', wrap((req, res) => {
  const type = req.params.type as AssetType;
  const table = ASSET_TABLES[type];
  if (!table) { res.status(400).json({ error: `不明なアセット種別: ${req.params.type}` }); return; }
  const rows = db.prepare(`SELECT * FROM ${table} WHERE project_id IS NULL ORDER BY id DESC`).all() as any[];
  res.json(rows.map(assetMapper[type] as (r: any) => unknown));
}));

/** プロジェクト内の要素をライブラリへ保存（コピー） */
router.post('/assets/:type/save/:itemId', wrap((req, res) => {
  const type = req.params.type as AssetType;
  const table = ASSET_TABLES[type];
  if (!table) { res.status(400).json({ error: `不明なアセット種別: ${req.params.type}` }); return; }
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id(req, 'itemId')) as any;
  if (!row) { res.status(404).json({ error: '対象が見つかりません' }); return; }
  const copy = copyRowToProject(table, row, null, row.id);
  res.status(201).json((assetMapper[type] as (r: any) => unknown)(copy));
}));

/** ライブラリアセットをプロジェクトへキャスティング（コピー） */
router.post('/projects/:id/cast/:type/:assetId', wrap((req, res) => {
  const type = req.params.type as AssetType;
  const table = ASSET_TABLES[type];
  if (!table) { res.status(400).json({ error: `不明なアセット種別: ${req.params.type}` }); return; }
  const row = db.prepare(`SELECT * FROM ${table} WHERE id = ? AND project_id IS NULL`).get(id(req, 'assetId')) as any;
  if (!row) { res.status(404).json({ error: 'ライブラリアセットが見つかりません' }); return; }
  const copy = copyRowToProject(table, row, id(req), row.id);
  res.status(201).json((assetMapper[type] as (r: any) => unknown)(copy));
}));

function copyRowToProject(
  table: string,
  row: Record<string, any>,
  projectId: number | null,
  sourceAssetId: number,
): Record<string, any> {
  const cols = Object.keys(row).filter((c) => c !== 'id' && c !== 'created_at');
  const values = cols.map((c) => {
    if (c === 'project_id') return projectId;
    if (c === 'source_asset_id') return sourceAssetId;
    return row[c];
  });
  const result = db.prepare(
    `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
  ).run(...values);
  return db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(Number(result.lastInsertRowid)) as any;
}
