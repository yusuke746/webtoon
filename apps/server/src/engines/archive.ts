import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type {
  ArchiveEpisodeStatus, ArchiveFile, ArchiveInfo, Character, Episode, Foreshadowing, Panel, Project,
} from '@manga/shared';
import { DATA_DIR, db, rowToArtStyle, rowToDiscussion, rowToDiscussionMessage, rowToWorldview } from '../db.js';
import { getLLMClient } from '../llm/index.js';
import { archiveBibleNotesPrompt, archiveEpisodeSummaryPrompt } from '../prompts.js';
import { getProject, listCharacters, listEpisodes, listForeshadowings, listPanels } from './story.js';
import { listBackgrounds } from './visual.js';
import { localImageFile } from '../image/storage.js';

/**
 * 連載アーカイブ（書庫）エンジン。
 *
 * 作品ごとに «人間が読める Markdown のフォルダ» を保ち、生成のたびに DB の内容を書き出す。
 * 「連載マネージャー」はこのフォルダを根拠に、各話の要約と「連載メモ」（人物の現在地・確定設定・
 * 未回収の伏線）を LLM で更新し、以降の生成プロンプトへ文脈として渡す。
 *
 *   series/<id>-<title>/
 *     bible.md            シリーズバイブル（auto ブロックは DB 由来、連載メモは LLM、他は自由記述）
 *     characters/*.md     キャラ設定（DB 由来・毎回上書き）
 *     episodes/NN/script.md   構成 + ネーム（DB 由来・毎回上書き）
 *     episodes/NN/summary.md  話の要約（マネージャーが生成。手直し可）
 *     episodes/NN/images/     作画済みコマ（ローカル保存画像のコピー）
 *     foreshadow.md       伏線の状態（DB 由来）
 *     meetings/*.md       AI編集会議のログ（DB 由来）
 *
 * ロジック（生成エンジン）自体は変えず、プロンプトに «文脈セクション» を足すだけに留めている。
 */

export const SERIES_DIR = process.env.SERIES_DIR ?? path.join(DATA_DIR, 'series');

const AUTO_START = '<!-- auto:start -->';
const AUTO_END = '<!-- auto:end -->';
const NOTES_START = '<!-- notes:start -->';
const NOTES_END = '<!-- notes:end -->';

// ---------- パス ----------

function safeName(s: string): string {
  return s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 60) || 'untitled';
}

export function archiveDir(project: Project): string {
  return path.join(SERIES_DIR, `${project.id}-${safeName(project.title)}`);
}

function episodeDir(dir: string, number: number): string {
  return path.join(dir, 'episodes', String(number).padStart(2, '0'));
}

/** アーカイブ外へ抜けるパスを拒否して絶対パスへ解決する */
function resolveInside(dir: string, rel: string): string {
  const abs = path.resolve(dir, rel);
  const root = path.resolve(dir);
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`アーカイブ外のパスは扱えません: ${rel}`);
  }
  return abs;
}

function readIfExists(file: string): string | null {
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
}

function writeText(file: string, content: string) {
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content, 'utf8');
}

/** マーカーで囲まれたブロックを置換する。マーカーが無ければ末尾に追加する */
function replaceBlock(text: string, start: string, end: string, body: string, heading?: string): string {
  const block = `${start}\n${body.trim()}\n${end}`;
  const re = new RegExp(`${escapeRe(start)}[\\s\\S]*?${escapeRe(end)}`);
  if (re.test(text)) return text.replace(re, block);
  return `${text.trimEnd()}\n\n${heading ? `${heading}\n` : ''}${block}\n`;
}

function extractBlock(text: string, start: string, end: string): string {
  const m = text.match(new RegExp(`${escapeRe(start)}([\\s\\S]*?)${escapeRe(end)}`));
  return m ? m[1].trim() : '';
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ---------- DB → Markdown ----------

function renderBibleAuto(project: Project, characters: Character[], episodes: Episode[]): string {
  const worldviews = (db.prepare('SELECT * FROM worldviews WHERE project_id = ? ORDER BY id').all(project.id) as any[])
    .map(rowToWorldview);
  const styleRow = project.artStyleId
    ? db.prepare('SELECT * FROM art_styles WHERE id = ?').get(project.artStyleId)
    : null;
  const style = styleRow ? rowToArtStyle(styleRow as any) : null;
  const rules = project.panelRules;
  const dir = rules.readingDirection === 'rtl' ? '右→左（日本式）' : rules.readingDirection === 'ltr' ? '左→右' : '縦スクロール（Webtoon）';

  return [
    '## 作品概要（自動生成・編集はアプリ側で）',
    `- タイトル: ${project.title}`,
    `- あらすじ: ${project.synopsis}`,
    `- 構成テンプレート: ${project.storyTemplate.name}（1話 約${project.storyTemplate.pagesPerEpisode}ページ）`,
    project.storyTemplate.instructions ? `- 構成への指示: ${project.storyTemplate.instructions}` : null,
    `- コマ割り: ${rules.gridCols}列×${rules.gridRows}行 / 1ページ最大${rules.maxPanelsPerPage}コマ / 読み方向 ${dir}`,
    rules.customRules ? `- コマ割り追加ルール: ${rules.customRules}` : null,
    style ? `- 画風: ${style.name}（${style.stylePrompt}）` : '- 画風: 未設定',
    '',
    '## 世界観',
    worldviews.length ? worldviews.map((w) => `- ${w.name}: ${w.description}`).join('\n') : '（未登録）',
    '',
    '## 登場人物（詳細は characters/ を参照）',
    characters.length
      ? characters.map((c) => `- ${c.name}（${c.role || '役割未設定'}）`).join('\n')
      : '（未生成）',
    '',
    '## 話数一覧',
    episodes.length
      ? episodes.map((e) => `- 第${e.number}話「${e.title}」[${e.status}]: ${e.summary}`).join('\n')
      : '（未生成）',
  ].filter((l) => l !== null).join('\n');
}

const BIBLE_TEMPLATE = (title: string) => `# ${title} シリーズバイブル

${AUTO_START}
${AUTO_END}

## 連載メモ（マネージャー更新）
${NOTES_START}
（まだありません。話を書庫へ登録すると、連載マネージャーがここを更新します）
${NOTES_END}

## 作者メモ（自由記述・同期で消えません）

`;

function renderCharacter(c: Character, refImageRel: string | null): string {
  return [
    `# ${c.name}`,
    `- 役割: ${c.role || '未設定'}`,
    `- 外見: ${c.appearance || '未設定'}`,
    `- 性格・口調: ${c.personality || '未設定'}`,
    refImageRel ? `- 参照画像: ${refImageRel}` : c.refImageUrl ? `- 参照画像URL: ${c.refImageUrl}` : null,
    c.visualPrompt ? `- 絵の固定文: ${c.visualPrompt}` : null,
    c.loraUrl ? `- LoRA: ${c.loraUrl}` : null,
  ].filter(Boolean).join('\n') + '\n';
}

function renderScript(ep: Episode, panels: Panel[], characters: Character[], bgNames: Map<number, string>, imageRel: Map<number, string>): string {
  const charName = (id: number) => characters.find((c) => c.id === id)?.name ?? `#${id}`;
  const lines: string[] = [
    `# 第${ep.number}話「${ep.title}」`,
    `- 状態: ${ep.status}`,
    '',
    '## あらすじ',
    ep.summary || '（未設定）',
    '',
    '## シーン構成',
    ...(ep.scenes.length
      ? ep.scenes.map((s, i) => {
          const refs = (s.foreshadowRefs ?? []).map((r) => `${r.title}(${r.action})`).join('、');
          return `${i + 1}. ${s.title} — ${s.summary}（登場: ${s.characters.join('・') || 'なし'}${refs ? ` / 伏線: ${refs}` : ''}）`;
        })
      : ['（未生成）']),
    '',
    '## ネーム',
  ];
  if (!panels.length) {
    lines.push('（未生成）');
  }
  for (const p of panels) {
    lines.push(`### P${p.layout.page}-${p.index + 1}`);
    lines.push(`- 情景: ${p.description}`);
    if (p.characterIds.length) lines.push(`- 登場: ${p.characterIds.map(charName).join('・')}`);
    if (p.backgroundId && bgNames.has(p.backgroundId)) lines.push(`- 背景: ${bgNames.get(p.backgroundId)}`);
    for (const d of p.dialogues) {
      const kind = d.kind === 'speech' ? '' : `（${d.kind}）`;
      lines.push(`- 【${d.speaker}】${d.text}${kind}`);
    }
    if (imageRel.has(p.id)) lines.push(`- 画像: ${imageRel.get(p.id)}`);
    lines.push('');
  }
  return lines.join('\n');
}

function renderForeshadow(items: Foreshadowing[]): string {
  const label: Record<Foreshadowing['status'], string> = {
    planned: '計画中', planted: '導入済み・未回収', resolved: '回収済み',
  };
  return [
    '# 伏線',
    '',
    ...(items.length
      ? items.map((f) => [
          `## ${f.title} — ${label[f.status]}`,
          `- 内容: ${f.description}`,
          `- 導入: ${f.setupEpisode ? `第${f.setupEpisode}話` : '未'} / 回収予定: ${f.plannedPayoffEpisode ? `第${f.plannedPayoffEpisode}話` : '未定'} / 回収済み: ${f.resolvedEpisode ? `第${f.resolvedEpisode}話` : '—'}`,
          `- 関連: ${[...f.relatedCharacters, ...f.relatedItems].join('、') || 'なし'}`,
          '',
        ].join('\n'))
      : ['（まだありません）']),
  ].join('\n');
}

/** ローカル保存画像をアーカイブへコピーし、script.md からの相対パスを返す */
function copyImage(url: string | null, destDir: string, name: string): string | null {
  if (!url) return null;
  const src = localImageFile(url);
  if (!src || !existsSync(src)) return null;
  const ext = path.extname(src) || '.png';
  const dest = path.join(destDir, 'images', `${name}${ext}`);
  if (!existsSync(dest) || statSync(dest).mtimeMs < statSync(src).mtimeMs) {
    mkdirSync(path.dirname(dest), { recursive: true });
    copyFileSync(src, dest);
  }
  return `images/${name}${ext}`;
}

// ---------- 同期 ----------

/** DB の内容をアーカイブへ書き出す（LLM は呼ばない。人間が書いた部分は保持する） */
export function syncArchive(projectId: number): ArchiveInfo {
  const project = getProject(projectId);
  const dir = archiveDir(project);
  mkdirSync(dir, { recursive: true });

  const characters = listCharacters(projectId);
  const episodes = listEpisodes(projectId);
  const backgrounds = listBackgrounds(projectId);
  const bgNames = new Map(backgrounds.map((b) => [b.id, b.name]));

  // bible.md: auto ブロックのみ更新
  const bibleFile = path.join(dir, 'bible.md');
  const bible = readIfExists(bibleFile) ?? BIBLE_TEMPLATE(project.title);
  writeText(bibleFile, replaceBlock(bible, AUTO_START, AUTO_END, renderBibleAuto(project, characters, episodes)));

  // characters/
  for (const c of characters) {
    const cdir = path.join(dir, 'characters');
    const ref = copyImage(c.refImageUrl, cdir, safeName(c.name));
    writeText(path.join(cdir, `${safeName(c.name)}.md`), renderCharacter(c, ref));
  }

  // episodes/NN/script.md
  for (const ep of episodes) {
    const edir = episodeDir(dir, ep.number);
    const panels = listPanels(ep.id);
    const imageRel = new Map<number, string>();
    for (const p of panels) {
      const rel = copyImage(p.imageUrl, edir, `p${p.layout.page}-${p.index + 1}`);
      if (rel) imageRel.set(p.id, rel);
    }
    writeText(path.join(edir, 'script.md'), renderScript(ep, panels, characters, bgNames, imageRel));
  }

  // foreshadow.md
  writeText(path.join(dir, 'foreshadow.md'), renderForeshadow(listForeshadowings(projectId)));

  // meetings/
  const discussions = (db.prepare('SELECT * FROM discussions WHERE project_id = ? ORDER BY id').all(projectId) as any[])
    .map(rowToDiscussion);
  for (const d of discussions) {
    const messages = (db.prepare('SELECT * FROM discussion_messages WHERE discussion_id = ? ORDER BY id').all(d.id) as any[])
      .map(rowToDiscussionMessage);
    const body = [
      `# ${d.topic}`,
      `- 状態: ${d.status}`,
      d.summary ? `- 要約: ${d.summary}` : null,
      d.proposal ? `- 提案:\n${d.proposal}` : null,
      '',
      ...messages.map((m) => `## ${m.roleName}（ラウンド${m.round}）\n${m.content}\n`),
    ].filter((l) => l !== null).join('\n');
    writeText(path.join(dir, 'meetings', `${String(d.id).padStart(3, '0')}-${safeName(d.topic)}.md`), body);
  }

  return getArchiveInfo(projectId);
}

// ---------- 参照 ----------

function listFilesRec(root: string, rel = ''): ArchiveFile[] {
  const abs = path.join(root, rel);
  if (!existsSync(abs)) return [];
  const out: ArchiveFile[] = [];
  for (const name of readdirSync(abs).sort()) {
    const r = rel ? `${rel}/${name}` : name;
    const st = statSync(path.join(abs, name));
    if (st.isDirectory()) out.push(...listFilesRec(root, r));
    else out.push({ path: r, size: st.size, mtime: st.mtime.toISOString(), editable: name.endsWith('.md') });
  }
  return out;
}

export function getArchiveInfo(projectId: number): ArchiveInfo {
  const project = getProject(projectId);
  const dir = archiveDir(project);
  const exists = existsSync(dir);
  const episodes: ArchiveEpisodeStatus[] = listEpisodes(projectId).map((e) => {
    const edir = episodeDir(dir, e.number);
    const summary = readIfExists(path.join(edir, 'summary.md'));
    return {
      episodeId: e.id, number: e.number, title: e.title, status: e.status,
      hasScript: existsSync(path.join(edir, 'script.md')),
      hasSummary: !!summary,
      summaryUpdatedAt: summary ? statSync(path.join(edir, 'summary.md')).mtime.toISOString() : null,
    };
  });
  const bible = readIfExists(path.join(dir, 'bible.md'));
  const notes = bible ? extractBlock(bible, NOTES_START, NOTES_END) : '';
  return {
    dir,
    exists,
    files: exists ? listFilesRec(dir) : [],
    episodes,
    notes: notes.startsWith('（まだありません') ? '' : notes,
  };
}

export function readArchiveFile(projectId: number, rel: string): string {
  const abs = resolveInside(archiveDir(getProject(projectId)), rel);
  const content = readIfExists(abs);
  if (content === null) throw new Error(`ファイルがありません: ${rel}`);
  return content;
}

export function writeArchiveFile(projectId: number, rel: string, content: string): void {
  if (!rel.endsWith('.md')) throw new Error('編集できるのは Markdown ファイルだけです');
  const abs = resolveInside(archiveDir(getProject(projectId)), rel);
  writeText(abs, content);
}

// ---------- マネージャー（LLM） ----------

/** 1話分の要約を生成して episodes/NN/summary.md に保存する */
export async function summarizeEpisode(episodeId: number): Promise<string> {
  const epRow = db.prepare('SELECT * FROM episodes WHERE id = ?').get(episodeId);
  if (!epRow) throw new Error(`エピソードが見つかりません: ${episodeId}`);
  const projectId = Number((epRow as any).project_id);
  const project = getProject(projectId);
  syncArchive(projectId);

  const dir = archiveDir(project);
  const episode = listEpisodes(projectId).find((e) => e.id === episodeId)!;
  const script = readArchiveFile(projectId, `episodes/${String(episode.number).padStart(2, '0')}/script.md`);
  const previous = buildSeriesContext(projectId, { uptoEpisode: episode.number, includePreviousScript: false, maxChars: 6000 });

  const text = await getLLMClient().complete({
    task: 'summarize',
    prompt: archiveEpisodeSummaryPrompt(project, episode, script, previous),
    cwd: dir,
  });
  const summary = text.trim();
  writeText(path.join(episodeDir(dir, episode.number), 'summary.md'), summary + '\n');
  return summary;
}

/** 全話の要約をもとに bible.md の「連載メモ」を書き直す */
export async function updateBibleNotes(projectId: number): Promise<string> {
  const project = getProject(projectId);
  syncArchive(projectId);
  const dir = archiveDir(project);
  const bibleFile = path.join(dir, 'bible.md');
  const bible = readIfExists(bibleFile) ?? BIBLE_TEMPLATE(project.title);
  const current = extractBlock(bible, NOTES_START, NOTES_END);
  const summaries = collectSummaries(projectId);
  if (!summaries.length) throw new Error('要約済みの話がありません。先に話を書庫へ登録してください。');

  const text = await getLLMClient().complete({
    task: 'archive',
    prompt: archiveBibleNotesPrompt(project, current, summaries, listForeshadowings(projectId)),
    cwd: dir,
  });
  const notes = text.trim();
  writeText(bibleFile, replaceBlock(bible, NOTES_START, NOTES_END, notes, '## 連載メモ（マネージャー更新）'));
  return notes;
}

/** 話を書庫へ登録する: 要約生成 → 連載メモ更新 */
export async function registerEpisode(episodeId: number): Promise<{ summary: string; notes: string }> {
  const summary = await summarizeEpisode(episodeId);
  const projectId = Number((db.prepare('SELECT project_id FROM episodes WHERE id = ?').get(episodeId) as any).project_id);
  const notes = await updateBibleNotes(projectId);
  return { summary, notes };
}

function collectSummaries(projectId: number): { number: number; title: string; text: string }[] {
  const dir = archiveDir(getProject(projectId));
  return listEpisodes(projectId)
    .map((e) => ({ number: e.number, title: e.title, text: readIfExists(path.join(episodeDir(dir, e.number), 'summary.md')) }))
    .filter((s): s is { number: number; title: string; text: string } => !!s.text);
}

// ---------- 生成プロンプト向けの文脈 ----------

export interface SeriesContextOptions {
  /** この話数 «より前» の話を文脈に含める（省略時は全話） */
  uptoEpisode?: number;
  /** 直前の話の script.md 全文を含めるか */
  includePreviousScript?: boolean;
  /** 文脈の上限文字数（超える場合は古い話から要約を切り詰める） */
  maxChars?: number;
}

/**
 * 連載マネージャーが生成プロンプトへ渡す文脈。
 * 連載メモ → 各話の要約（無ければ DB のあらすじ）→ 直前の話の全文、の順に重要度が高い。
 * アーカイブが空なら '' を返し、プロンプト側はセクションを出さない。
 */
export function buildSeriesContext(projectId: number, opts: SeriesContextOptions = {}): string {
  const { uptoEpisode, includePreviousScript = true, maxChars = 16000 } = opts;
  const project = getProject(projectId);
  const dir = archiveDir(project);
  if (!existsSync(dir)) return '';

  const bible = readIfExists(path.join(dir, 'bible.md')) ?? '';
  const notes = extractBlock(bible, NOTES_START, NOTES_END);
  // 作者メモ（auto / notes ブロック以外の自由記述）
  const authorNotes = bible
    .replace(new RegExp(`${escapeRe(AUTO_START)}[\\s\\S]*?${escapeRe(AUTO_END)}`), '')
    .replace(new RegExp(`${escapeRe(NOTES_START)}[\\s\\S]*?${escapeRe(NOTES_END)}`), '')
    .split('\n')
    .filter((l) => !/^#\s/.test(l) && !/^## (連載メモ|作者メモ)/.test(l))
    .join('\n')
    .trim();

  const episodes = listEpisodes(projectId).filter((e) => uptoEpisode === undefined || e.number < uptoEpisode);
  const sections: string[] = [];
  if (notes && !notes.startsWith('（まだありません')) sections.push(`### 連載メモ（人物の現在地・確定設定・未回収の伏線）\n${notes}`);
  if (authorNotes) sections.push(`### 作者メモ\n${authorNotes}`);

  const summaries = episodes.map((e) => {
    const s = readIfExists(path.join(episodeDir(dir, e.number), 'summary.md'));
    return { e, text: s ? s.trim() : `第${e.number}話「${e.title}」: ${e.summary}` };
  });
  if (summaries.length) {
    sections.push(`### これまでの話\n${summaries.map((s) => s.text).join('\n\n')}`);
  }

  let prevScript = '';
  if (includePreviousScript && episodes.length) {
    const last = episodes[episodes.length - 1];
    const script = readIfExists(path.join(episodeDir(dir, last.number), 'script.md'));
    if (script) prevScript = `### 直前の話（第${last.number}話）の脚本・ネーム全文\n${script.trim()}`;
  }

  let out = [...sections, prevScript].filter(Boolean).join('\n\n');
  if (out.length > maxChars && prevScript) {
    out = sections.join('\n\n');
  }
  if (out.length > maxChars) {
    // 古い話から順に要約を短くする
    const shortened = summaries.map((s, i) => (i < summaries.length - 2 ? s.text.slice(0, 300) + '…' : s.text));
    const idx = sections.findIndex((s) => s.startsWith('### これまでの話'));
    if (idx >= 0) sections[idx] = `### これまでの話\n${shortened.join('\n\n')}`;
    out = sections.join('\n\n');
  }
  if (out.length > maxChars) out = out.slice(0, maxChars) + '\n…（以降省略）';
  return out;
}
