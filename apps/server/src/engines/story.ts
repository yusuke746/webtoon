import type { Character, Dialogue, Episode, Foreshadowing, Panel, PanelLayout, Project, Scene } from '@manga/shared';
import { db, rowToCharacter, rowToEpisode, rowToForeshadowing, rowToPanel, rowToProject } from '../db.js';
import { getLLMClient, extractJson, type LLMTask } from '../llm/index.js';
import { getImageClient } from '../image/index.js';
import { persistImage } from '../image/storage.js';
import {
  NAME_REVIEW_ROLES, charactersPrompt, nameCritiquePrompt,
  panelsPrompt, panelsRevisePrompt, reviseScenesPrompt, structurePrompt,
} from '../prompts.js';
import { rowToArtStyle } from '../db.js';
import { listBackgrounds, listRefImages } from './visual.js';
import { archiveDir, buildSeriesContext, getArchiveInfo, registerEpisode, syncArchive } from './archive.js';
import { ART_CHECK_ENABLED, ART_CHECK_MAX_RETRY, NO_TEXT_NEGATIVE, NO_TEXT_PROMPT, checkPanelImage, ensureVisual, replaceNamesWithHandles, subjectBlock } from './artcheck.js';
import { RETRY_IN_JAPANESE, looksJapanese } from '../llm/lang.js';

// ---------- 取得ヘルパ ----------

export function getProject(id: number): Project {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
  if (!r) throw new Error(`プロジェクトが見つかりません: ${id}`);
  return rowToProject(r as any);
}

export function listEpisodes(projectId: number): Episode[] {
  return (db.prepare('SELECT * FROM episodes WHERE project_id = ? ORDER BY number').all(projectId) as any[]).map(rowToEpisode);
}

export function listCharacters(projectId: number): Character[] {
  return (db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY id').all(projectId) as any[]).map(rowToCharacter);
}

export function listForeshadowings(projectId: number): Foreshadowing[] {
  return (db.prepare('SELECT * FROM foreshadowings WHERE project_id = ? ORDER BY id').all(projectId) as any[]).map(rowToForeshadowing);
}

// ---------- ストーリー構成生成 ----------

interface StructureOutput {
  episodes: { number: number; title: string; summary: string; scenes: Scene[] }[];
  foreshadowings: {
    title: string; description: string; setupEpisode: number | null;
    plannedPayoffEpisode: number | null; relatedCharacters: string[]; relatedItems: string[];
  }[];
}

/**
 * 物語の文章を返す呼び出し。出力が日本語になっていなければ、注意を足して 1 回だけ作り直させる。
 * pick は「日本語であるべき文章」を取り出す関数（タイトル・要約・セリフなど）。
 */
async function completeInJapanese<T>(req: { task: LLMTask; prompt: string; cwd?: string; system?: string }, parse: (text: string) => T, pick: (out: T) => string): Promise<T> {
  const llm = getLLMClient();
  const out = parse(await llm.complete(req));
  if (looksJapanese(pick(out)) || process.env.LANG_CHECK === '0') return out;
  console.warn(`[llm] ${req.task}: 出力が日本語ではありません。日本語で作り直させます`);
  const retry = parse(await llm.complete({ ...req, prompt: req.prompt + RETRY_IN_JAPANESE }));
  return looksJapanese(pick(retry)) ? retry : out;
}

/** あらすじ → 話数構成 + 伏線の構造データを生成し DB へ保存 */
export async function generateStructure(projectId: number, episodeCount: number, instruction?: string): Promise<Episode[]> {
  const project = getProject(projectId);
  const existing = listEpisodes(projectId);
  const foreshadowings = listForeshadowings(projectId);

  // 続きの話を作るときは、連載マネージャーの文脈（連載メモ・各話要約）を渡して矛盾を防ぐ
  const seriesContext = existing.length ? buildSeriesContext(projectId) : '';
  const out = await completeInJapanese(
    { task: 'structure', prompt: structurePrompt(project, episodeCount, existing, foreshadowings, seriesContext, instruction), cwd: seriesContext ? archiveDir(project) : undefined },
    (text) => extractJson<StructureOutput>(text),
    (o) => (o.episodes ?? []).map((e: any) => `${e.title ?? ''} ${e.summary ?? ''} ${(e.scenes ?? []).map((sc: any) => `${sc.title ?? ''} ${sc.summary ?? ''}`).join(' ')}`).join(' '),
  );

  const insertEp = db.prepare(
    'INSERT INTO episodes (project_id, number, title, summary, scenes, status) VALUES (?, ?, ?, ?, ?, ?)',
  );
  for (const ep of out.episodes ?? []) {
    // 既存話と番号が重複する場合はスキップ（続きから生成する前提）
    if (existing.some((e) => e.number === ep.number)) continue;
    insertEp.run(projectId, ep.number, ep.title, ep.summary, JSON.stringify(ep.scenes ?? []), 'structured');
  }

  const insertFs = db.prepare(
    `INSERT INTO foreshadowings
      (project_id, title, description, setup_episode, planned_payoff_episode, status, related_characters, related_items)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (const f of out.foreshadowings ?? []) {
    if (foreshadowings.some((x) => x.title === f.title)) continue;
    insertFs.run(
      projectId, f.title, f.description ?? '',
      f.setupEpisode ?? null, f.plannedPayoffEpisode ?? null,
      f.setupEpisode ? 'planted' : 'planned',
      JSON.stringify(f.relatedCharacters ?? []), JSON.stringify(f.relatedItems ?? []),
    );
  }

  safeSync(projectId);
  return listEpisodes(projectId);
}

/** 書庫への書き出し。失敗しても生成結果は返したいので警告に留める */
function safeSync(projectId: number) {
  try {
    syncArchive(projectId);
  } catch (e) {
    console.warn('[archive] 書庫の同期に失敗しました:', (e as Error).message);
  }
}

// ---------- キャラクター生成 ----------

interface CharactersOutput {
  characters: { name: string; role: string; appearance: string; personality: string }[];
}

export async function generateCharacters(projectId: number): Promise<Character[]> {
  const project = getProject(projectId);
  const episodes = listEpisodes(projectId);
  const existing = listCharacters(projectId);

  const seriesContext = buildSeriesContext(projectId, { includePreviousScript: false, maxChars: 8000 });
  const text = await getLLMClient().complete({
    task: 'characters',
    prompt: charactersPrompt(project, episodes, seriesContext),
    cwd: seriesContext ? archiveDir(project) : undefined,
  });
  const out = extractJson<CharactersOutput>(text);

  const insert = db.prepare(
    'INSERT INTO characters (project_id, name, role, appearance, personality) VALUES (?, ?, ?, ?, ?)',
  );
  for (const c of out.characters ?? []) {
    if (existing.some((e) => e.name === c.name)) continue; // 手動編集済みキャラを上書きしない
    insert.run(projectId, c.name, c.role ?? '', c.appearance ?? '', c.personality ?? '');
  }
  safeSync(projectId);
  return listCharacters(projectId);
}

// ---------- コマ割り・セリフ生成 ----------

interface PanelsOutput {
  panels: {
    layout: PanelLayout; description: string; dialogues: Dialogue[];
    imagePrompt: string; characters: string[]; background?: string | null;
  }[];
}

/**
 * 担当編集の指示に沿って1話分のシーン構成を書き直す（話数・ID は維持）。
 * オフィスの会話「直してほしい」から呼ばれる。
 */
export async function reviseEpisodeScenes(episodeId: number, instruction: string): Promise<Episode> {
  const epRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!epRow) throw new Error(`エピソードが見つかりません: ${episodeId}`);
  const episode = rowToEpisode(epRow as any);
  const project = getProject(episode.projectId);
  const seriesContext = buildSeriesContext(episode.projectId, { uptoEpisode: episode.number, includePreviousScript: false, maxChars: 8000 });
  const out = await completeInJapanese(
    { task: 'revise_scenes', prompt: reviseScenesPrompt(project, episode, instruction, seriesContext), cwd: seriesContext ? archiveDir(project) : undefined },
    (text) => extractJson<{ title?: string; summary?: string; scenes?: Scene[] }>(text),
    (o) => `${o.title ?? ''} ${o.summary ?? ''} ${(o.scenes ?? []).map((sc) => `${sc.title} ${sc.summary}`).join(' ')}`,
  );
  db.prepare('UPDATE episodes SET title = ?, summary = ?, scenes = ? WHERE id = ?').run(
    out.title?.trim() || episode.title, out.summary?.trim() || episode.summary,
    JSON.stringify(out.scenes?.length ? out.scenes : episode.scenes), episodeId,
  );
  safeSync(episode.projectId);
  return rowToEpisode(db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as any);
}

/**
 * ネーム生成。instruction（担当編集の指示）があり既にネームがある場合は、
 * そのネームを指示に沿って改稿する（初稿からやり直さない）。
 */
export async function generatePanels(episodeId: number, instruction?: string): Promise<Panel[]> {
  const epRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!epRow) throw new Error(`エピソードが見つかりません: ${episodeId}`);
  const episode = rowToEpisode(epRow as any);
  const project = getProject(episode.projectId);
  const characters = listCharacters(episode.projectId);
  const llm = getLLMClient();
  const backgrounds = listBackgrounds(episode.projectId);

  // 前の話までの要約と直前の話の全文を渡し、人物の現在地・口調を引き継ぐ
  const seriesContext = buildSeriesContext(episode.projectId, { uptoEpisode: episode.number });
  const cwd = seriesContext ? archiveDir(project) : undefined;
  const existingPanels = listPanels(episodeId);
  let out: PanelsOutput;
  if (instruction?.trim() && existingPanels.length) {
    // 改稿: 現在のネームを「担当編集の批評」として改稿プロンプトに渡す
    const current: PanelsOutput = {
      panels: existingPanels.map((p) => ({
        layout: p.layout, description: p.description, dialogues: p.dialogues, imagePrompt: p.imagePrompt,
        characters: p.characterIds.map((id) => characters.find((c) => c.id === id)?.name).filter((n): n is string => !!n),
        background: p.backgroundId ? backgrounds.find((b) => b.id === p.backgroundId)?.name ?? null : null,
      })),
    };
    const text = await llm.complete({
      task: 'panels',
      prompt: panelsRevisePrompt(project, episode, characters, JSON.stringify(current.panels, null, 1), [{ roleName: '担当編集', content: instruction.trim() }]),
      cwd,
    });
    out = extractJson<PanelsOutput>(text);
    if (!(out.panels ?? []).length) out = current;
  } else {
    out = await completeInJapanese(
      { task: 'panels', prompt: panelsPrompt(project, episode, characters, backgrounds, seriesContext, instruction), cwd },
      (text) => extractJson<PanelsOutput>(text),
      (o) => (o.panels ?? []).map((pn) => `${pn.description ?? ''} ${(pn.dialogues ?? []).map((d) => d.text).join(' ')}`).join(' '),
    );
  }

  // ネーム批評ループ: 演出担当・読者代表が批評し、改稿版を生成する。
  // 議論ログは AI編集会議に保存され、ユーザーが後から確認できる。
  const reviewRounds = project.panelRules.nameReviewRounds ?? 1;
  if (reviewRounds > 0 && (out.panels ?? []).length > 0) {
    out = await reviewAndRevisePanels(project, episode, characters, out, reviewRounds);
  }

  // 再生成時は既存パネルを置き換える
  db.prepare('DELETE FROM panels WHERE episode_id = ?').run(episodeId);
  const insert = db.prepare(
    `INSERT INTO panels (episode_id, idx, layout, description, dialogues, image_prompt, character_ids, background_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
  );
  (out.panels ?? []).forEach((p, i) => {
    const charIds = (p.characters ?? [])
      .map((name) => characters.find((c) => c.name === name)?.id)
      .filter((id): id is number => id !== undefined);
    const backgroundId = p.background
      ? backgrounds.find((b) => b.name === p.background)?.id ?? null
      : null;
    insert.run(
      episodeId, i, JSON.stringify(p.layout ?? { page: 1, x: 0, y: 0, w: 4, h: 2 }),
      p.description ?? '', JSON.stringify(p.dialogues ?? []),
      p.imagePrompt ?? '', JSON.stringify(charIds), backgroundId,
    );
  });
  db.prepare("UPDATE episodes SET status = 'paneled' WHERE id = ?").run(episodeId);

  // 書庫へ登録: 要約と連載メモを更新する（次話以降の生成に使う）。失敗してもネームは有効
  if (process.env.ARCHIVE_AUTO_REGISTER !== '0') {
    try {
      await registerEpisode(episodeId);
    } catch (e) {
      console.warn('[archive] 書庫への登録に失敗しました:', (e as Error).message);
      safeSync(episode.projectId);
    }
  } else {
    safeSync(episode.projectId);
  }

  return listPanels(episodeId);
}

/**
 * ネームの自動批評→改稿ループ。
 * 批評で「問題なし」が揃ったラウンドで打ち切る。失敗時は元のネームを維持する。
 */
async function reviewAndRevisePanels(
  project: Project,
  episode: Episode,
  characters: Character[],
  initial: PanelsOutput,
  rounds: number,
): Promise<PanelsOutput> {
  const llm = getLLMClient();
  let current = initial;

  const discussionResult = db.prepare(
    "INSERT INTO discussions (project_id, topic, status) VALUES (?, ?, 'running')",
  ).run(project.id, `第${episode.number}話ネーム批評（自動）`);
  const discussionId = Number(discussionResult.lastInsertRowid);
  const addMessage = (round: number, roleName: string, content: string) =>
    db.prepare(
      'INSERT INTO discussion_messages (discussion_id, round, role_name, content) VALUES (?, ?, ?, ?)',
    ).run(discussionId, round, roleName, content);

  let lastSummary = '批評の結果、修正点はありませんでした。';
  try {
    for (let round = 1; round <= rounds; round++) {
      const panelsJson = JSON.stringify(current.panels, null, 1);
      const critiques: { roleName: string; content: string }[] = [];
      for (const role of NAME_REVIEW_ROLES) {
        const content = (await llm.complete({
          task: 'name_critique',
          system: role.system,
          prompt: nameCritiquePrompt(project, episode, panelsJson),
        })).trim();
        critiques.push({ roleName: role.name, content });
        addMessage(round, role.name, content);
      }

      const hasIssues = critiques.some((c) => !c.content.startsWith('問題なし'));
      if (!hasIssues) break;

      const revisedText = await llm.complete({
        task: 'panels',
        prompt: panelsRevisePrompt(project, episode, characters, panelsJson, critiques),
      });
      const revised = extractJson<PanelsOutput>(revisedText);
      if ((revised.panels ?? []).length > 0) {
        current = revised;
        lastSummary = `批評を反映してネームを改稿しました（ラウンド${round}）。`;
        addMessage(round, 'まとめ役', lastSummary);
      }
    }
    db.prepare(
      "UPDATE discussions SET status = 'adopted', summary = ? WHERE id = ?",
    ).run(lastSummary, discussionId);
  } catch (e) {
    // 批評・改稿に失敗しても初稿ネームは残す
    const msg = `批評ループが中断されました: ${(e as Error).message}`;
    console.warn('[panels]', msg);
    addMessage(rounds, 'まとめ役', msg);
    db.prepare("UPDATE discussions SET status = 'adopted', summary = ? WHERE id = ?").run(msg, discussionId);
  }
  return current;
}

export function listPanels(episodeId: number): Panel[] {
  return (db.prepare('SELECT * FROM panels WHERE episode_id = ? ORDER BY idx').all(episodeId) as any[]).map(rowToPanel);
}

// ---------- 作画（画像生成） ----------

/**
 * 1コマを作画し、作画チェック（Claude が画像を見る）に通るまで描き直す。
 * 上限回数を超えたら最後の結果を «要確認（fail）» として残し、編集が判断する。
 */
export async function generateCheckedPanelImage(panelId: number, onStep?: (label: string) => void): Promise<Panel> {
  let fixHint = '';
  const maxAttempts = ART_CHECK_ENABLED ? 1 + ART_CHECK_MAX_RETRY : 1;
  let panel: Panel | null = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    onStep?.(attempt === 1 ? '作画中' : `描き直し ${attempt - 1}/${ART_CHECK_MAX_RETRY}`);
    panel = await generatePanelImage(panelId, fixHint);
    if (!ART_CHECK_ENABLED) break;
    onStep?.('設定担当がチェック中');
    const result = await checkPanelImage(panelId, attempt);
    if (result.status !== 'fail') break;
    fixHint = result.fixPrompt;
    console.log(`[art] コマ ${panelId} 不一致（${attempt}回目）: ${result.issues.join(' / ')}`);
  }
  // チェック結果（check_status / check_notes）を含めて返す
  return rowToPanel(db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId) as any);
}

/**
 * コマの画像プロンプトを組み立てる。
 * 画風 → 登場人物・舞台の固定文 → コマの指示 → 描き直しの指摘 → 「文字を描かない」固定文、の順。
 * セリフと吹き出しは後工程でアプリが重ねるので、画像には文字を描かせず、縁に余白を残させる。
 */
export function buildPanelImagePrompt(
  stylePrompt: string | undefined,
  imagePrompt: string,
  parts: { subjects?: string; fixHint?: string } = {},
): string {
  return ['no text or lettering anywhere in the image', stylePrompt, parts.subjects, imagePrompt, parts.fixHint, NO_TEXT_PROMPT].filter(Boolean).join(', ');
}

export async function generatePanelImage(panelId: number, fixHint = ''): Promise<Panel> {
  const row = db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId);
  if (!row) throw new Error(`パネルが見つかりません: ${panelId}`);
  const panel = rowToPanel(row as any);
  const epRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(panel.episodeId);
  const episode = rowToEpisode(epRow as any);
  const project = getProject(episode.projectId);

  const styleRow = project.artStyleId
    ? db.prepare('SELECT * FROM art_styles WHERE id = ?').get(project.artStyleId)
    : null;
  const style = styleRow ? rowToArtStyle(styleRow as any) : null;

  const panelChars = listCharacters(episode.projectId).filter((c) => panel.characterIds.includes(c.id));
  // 背景も一貫性アセットとして扱う（同じ場所を毎回同じ構造で描くため）
  const background = panel.backgroundId
    ? listBackgrounds(episode.projectId).find((b) => b.id === panel.backgroundId) ?? null
    : null;

  // 登場人物・舞台の固定文を先頭に置く（全コマで同じ文言 → 見た目がブレにくい）
  const subjects = await subjectBlock(panelChars, background);
  // 画像プロンプトの中の日本語の名前は英語の呼び名に置き換える（名前が画像に文字として描かれるのを防ぐ）
  const handles = new Map<string, string>();
  for (const c of panelChars) handles.set(c.name, (await ensureVisual('character', c.id)).handle);
  if (background) handles.set(background.name, (await ensureVisual('background', background.id)).handle);
  const namePairs = [...handles.entries()].map(([name, handle]) => ({ name, handle }));
  const englishPrompt = replaceNamesWithHandles(panel.imagePrompt, namePairs);
  const englishFix = replaceNamesWithHandles(fixHint, namePairs);
  // 設定画（採用1枚 + 派生ビュー）をまとめて渡す。対応モデルなら画像で一貫性を保てる
  const sheetOf = (kind: 'character' | 'background', id: number, name: string, adopted: string | null) => {
    const views = listRefImages(kind, id).filter((r) => r.role === 'view').map((r) => r.url);
    const urls = [adopted, ...views].filter((u): u is string => !!u);
    return urls.length ? [{ label: name, kind, urls }] : [];
  };
  const referenceSheets = [
    ...panelChars.flatMap((c) => sheetOf('character', c.id, handles.get(c.name) || c.name, c.refImageUrl)),
    ...(background ? sheetOf('background', background.id, handles.get(background.name) || background.name, background.refImageUrl) : []),
  ];

  db.prepare("UPDATE panels SET status = 'generating', check_status = 'none', check_notes = NULL WHERE id = ?").run(panelId);
  try {
    const result = await getImageClient().generate({
      prompt: buildPanelImagePrompt(style?.stylePrompt, englishPrompt, { subjects, fixHint: englishFix }),
      negativePrompt: NO_TEXT_NEGATIVE,
      referenceSheets,
      model: style?.model ?? process.env.REPLICATE_MODEL ?? 'black-forest-labs/flux-schnell',
      styleLoraUrl: style?.loraUrl,
      characterLoraUrls: panelChars.map((c) => c.loraUrl).filter((u): u is string => !!u),
      referenceImageUrls: panelChars.map((c) => c.refImageUrl).filter((u): u is string => !!u),
      aspectRatio: panelAspectRatio(panel, project),
      // 背景はキャラとは別枠で渡す。混ぜると「キャラLoRAがあると背景LoRAが黙って落ちる」ため
      backgroundLoraUrl: background?.loraUrl ?? null,
      backgroundRefImageUrl: background?.refImageUrl ?? null,
      extraInput: style?.extraInput,
    });
    if (referenceSheets.length && !result.appliedReferenceCount) {
      console.warn(`[image] コマ ${panelId}: 設定画 ${referenceSheets.length} 件があるが、モデル ${style?.model ?? '(既定)'} は参照画像を受け取れない`);
    }
    // Replicate の出力URLは失効するため、ローカルへ保存して配信URLに差し替える
    const url = await persistImage(result.url, `panel-${panelId}`);
    db.prepare("UPDATE panels SET image_url = ?, status = 'done' WHERE id = ?").run(url, panelId);
  } catch (e) {
    db.prepare("UPDATE panels SET status = 'error' WHERE id = ?").run(panelId);
    throw e;
  }
  return rowToPanel(db.prepare('SELECT * FROM panels WHERE id = ?').get(panelId) as any);
}

/** コマの縦横比に近い、生成モデルが受け付けるアスペクト比を選ぶ */
function panelAspectRatio(panel: Panel, project: Project): string {
  const { gridCols, gridRows } = project.panelRules;
  const w = (panel.layout.w || 1) / gridCols;
  // ページ全体を縦長 (3:4.2) と想定した実効縦横比
  const h = ((panel.layout.h || 1) / gridRows) * 1.4;
  const ratio = w / h;
  const candidates: [string, number][] = [
    ['9:16', 9 / 16], ['2:3', 2 / 3], ['3:4', 3 / 4], ['1:1', 1],
    ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9],
  ];
  let best = candidates[0];
  for (const c of candidates) {
    if (Math.abs(c[1] - ratio) < Math.abs(best[1] - ratio)) best = c;
  }
  return best[0];
}

/**
 * エピソード内の全パネルを順次作画（レート制限に配慮して直列実行）。
 * onProgress を渡すとコマ1件ごとに進捗を通知する（ジョブの進捗表示用）。
 */
export async function generateEpisodeImages(
  episodeId: number,
  onProgress?: (done: number, total: number, label: string) => void,
  options: { retryFailed?: boolean } = {},
): Promise<Panel[]> {
  const panels = listPanels(episodeId);
  // retryFailed: 作画チェックで «要確認» になったコマも描き直す
  const pending = panels.filter((p) => p.status !== 'done' || (options.retryFailed && p.checkStatus === 'fail'));
  let done = 0;
  const failed: string[] = [];
  for (const p of pending) {
    const label = `P${p.layout.page}-${p.index + 1}`;
    // Replicate 側の一時エラー（Upstream provider is unavailable 等）があるため、
    // コマ単位でリトライし、それでも駄目なら残りのコマは続行して最後にまとめて報告する
    const MAX_ATTEMPTS = 3;
    for (let attempt = 1; ; attempt++) {
      try {
        await generateCheckedPanelImage(p.id, (step) => onProgress?.(done, pending.length, `${label} ${step}`));
        break;
      } catch (e) {
        if (attempt >= MAX_ATTEMPTS) {
          console.warn(`[image] ${label} は ${MAX_ATTEMPTS} 回失敗したためスキップします:`, e);
          failed.push(label);
          break;
        }
        console.warn(`[image] ${label} の生成に失敗。リトライします（${attempt}/${MAX_ATTEMPTS}）:`, e);
        await new Promise((r) => setTimeout(r, 5000 * attempt));
      }
    }
    done += 1;
    onProgress?.(done, pending.length, label);
  }
  if (failed.length > 0) {
    // ジョブは失敗として報告するが、成功したコマは保存済み。再実行すれば失敗分だけ再作画される
    throw new Error(`${failed.length} コマの作画に失敗しました: ${failed.join(', ')}（再実行で失敗分のみ再作画されます）`);
  }
  db.prepare("UPDATE episodes SET status = 'rendered' WHERE id = ?").run(episodeId);
  const renderedProjectId = rowToEpisode(db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId) as any).projectId;
  safeSync(renderedProjectId);
  // 作画済みの話は必ず書庫に要約がある状態にする（ネーム時の登録が失敗・無効だった場合の保険）
  if (process.env.ARCHIVE_AUTO_REGISTER !== '0' && !getArchiveInfo(renderedProjectId).episodes.find((a) => a.episodeId === episodeId)?.hasSummary) {
    try { await registerEpisode(episodeId); } catch (e) { console.warn('[archive] 書庫への登録に失敗しました:', (e as Error).message); }
  }
  return listPanels(episodeId);
}
