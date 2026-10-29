import type { BubblePosition, Dialogue, Episode, Panel, PanelRules } from '@manga/shared';
import { resolvePositions } from '../components/PageViewer';
import { readingOrder, stripHeightRatio } from '../reader/layout';

/**
 * 縦長 1 枚画像（投稿用ストリップ）への書き出し。
 *
 * ブラウザの canvas で、リーダーの縦読み表示と同じ並び・同じ比率でコマ画像と吹き出しを合成する。
 * サーバーに画像ライブラリを入れず、日本語フォントの描画をブラウザに任せるのが狙い。
 * 投稿先の制約（幅 800px、1 枚あたり高さ上限など）に合わせて、幅と分割の高さを選べる。
 */

export interface StripOptions {
  /** 出力の幅（px）。投稿サイトは 800 が多い */
  width: number;
  /** この高さごとに分割する（0 なら 1 枚） */
  splitHeight: number;
  /** コマの間隔（px。幅 800 基準） */
  gap: number;
  /** 背景色 */
  background: string;
  /** 先頭に話のタイトルを入れる */
  title: boolean;
}

export const DEFAULT_STRIP_OPTIONS: StripOptions = { width: 800, splitHeight: 0, gap: 32, background: '#ffffff', title: true };

/** ブラウザの canvas の実用上限（これを超える 1 枚は自動で分割） */
const CANVAS_MAX_HEIGHT = 16000;

interface Layout { panel: Panel; x: number; y: number; w: number; h: number }

/** 各コマの配置を決める（リーダーと同じ比率）。戻り値は全体の高さ */
function layoutStrip(panels: Panel[], rules: PanelRules, episode: Episode, o: StripOptions): { items: Layout[]; height: number; titleH: number } {
  const scale = o.width / 800;
  const gap = Math.round(o.gap * scale);
  const margin = Math.round(40 * scale);
  const titleH = o.title ? Math.round(180 * scale) : Math.round(24 * scale);
  let y = titleH;
  const items: Layout[] = [];
  const inner = o.width - margin * 2;
  panels.forEach((p, i) => {
    const prevPage = i > 0 ? panels[i - 1].layout.page ?? 1 : null;
    if (prevPage !== null && prevPage !== (p.layout.page ?? 1)) y += gap * 3; // ページの境目は広めに
    const h = Math.round(inner * stripHeightRatio(p, rules));
    items.push({ panel: p, x: margin, y, w: inner, h });
    y += h + gap;
  });
  y += Math.round(60 * scale);
  return { items, height: y, titleH };
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** object-fit: cover 相当で描く */
function drawCover(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number) {
  const ir = img.naturalWidth / img.naturalHeight;
  const r = w / h;
  let sx = 0, sy = 0, sw = img.naturalWidth, sh = img.naturalHeight;
  if (ir > r) { sw = img.naturalHeight * r; sx = (img.naturalWidth - sw) / 2; } else { sh = img.naturalWidth / r; sy = (img.naturalHeight - sh) / 2; }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

/** 日本語向けに 1 文字ずつ折り返す */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      const t = line + ch;
      if (ctx.measureText(t).width > maxWidth && line) { lines.push(line); line = ch; } else line = t;
    }
    lines.push(line);
  }
  return lines;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** 吹き出しをコーナー領域ごとに縦積みで描く（PanelContent と同じ割り当て） */
function drawBubbles(ctx: CanvasRenderingContext2D, panel: Panel, rules: PanelRules, L: Layout, scale: number) {
  const positions = resolvePositions(panel.dialogues, rules);
  const groups = new Map<BubblePosition, Dialogue[]>();
  panel.dialogues.forEach((d, i) => { const pos = positions[i]; if (!groups.has(pos)) groups.set(pos, []); groups.get(pos)!.push(d); });
  const font = Math.round(15 * scale);
  const pad = Math.round(8 * scale);
  const inset = Math.round(12 * scale);
  const maxW = Math.round(L.w * 0.6);
  const lineH = Math.round(font * 1.4);

  for (const [pos, dialogues] of groups) {
    const [v, hSide] = pos.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'right'];
    // 各吹き出しのサイズ
    const boxes = dialogues.map((d) => {
      ctx.font = `${d.kind === 'sfx' ? 'bold ' : ''}${d.kind === 'sfx' ? Math.round(font * 1.3) : font}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
      const lines = wrapText(ctx, d.text, maxW - pad * 2);
      const w = Math.min(maxW, Math.max(...lines.map((l) => ctx.measureText(l).width)) + pad * 2);
      const lh = d.kind === 'sfx' ? Math.round(lineH * 1.3) : lineH;
      return { d, lines, w, h: lines.length * lh + pad * 2, lh };
    });
    const total = boxes.reduce((s, b) => s + b.h, 0) + (boxes.length - 1) * Math.round(6 * scale);
    let y = v === 'top' ? L.y + inset : v === 'bottom' ? L.y + L.h - inset - total : L.y + (L.h - total) / 2;
    for (const b of boxes) {
      const x = hSide === 'left' ? L.x + inset : L.x + L.w - inset - b.w;
      ctx.font = `${b.d.kind === 'sfx' ? 'bold ' : ''}${b.d.kind === 'sfx' ? Math.round(font * 1.3) : font}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
      if (b.d.kind !== 'sfx') {
        ctx.fillStyle = b.d.kind === 'narration' ? '#f3f4f6' : 'rgba(255,255,255,0.96)';
        ctx.strokeStyle = '#111';
        ctx.lineWidth = Math.max(1.5, 2 * scale);
        ctx.setLineDash(b.d.kind === 'thought' ? [Math.round(5 * scale), Math.round(4 * scale)] : []);
        roundRect(ctx, x, y, b.w, b.h, b.d.kind === 'narration' ? Math.round(3 * scale) : Math.round(16 * scale));
        ctx.fill();
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.fillStyle = '#111';
      ctx.textBaseline = 'top';
      if (b.d.kind === 'sfx') { ctx.strokeStyle = '#fff'; ctx.lineWidth = Math.max(2, 4 * scale); }
      b.lines.forEach((line, i) => {
        const ty = y + pad + i * b.lh;
        if (b.d.kind === 'sfx') ctx.strokeText(line, x + pad, ty);
        ctx.fillText(line, x + pad, ty);
      });
      y += b.h + Math.round(6 * scale);
    }
  }
}

/** 1 話を縦長画像に描く。canvas の上限を超える場合は複数枚に分ける */
export async function renderStrip(episode: Episode, panels: Panel[], rules: PanelRules, options: Partial<StripOptions> = {}, onProgress?: (done: number, total: number) => void): Promise<HTMLCanvasElement[]> {
  const o = { ...DEFAULT_STRIP_OPTIONS, ...options };
  const scale = o.width / 800;
  const ordered = readingOrder(panels, rules);
  const { items, height, titleH } = layoutStrip(ordered, rules, episode, o);

  // まず 1 枚の大きな canvas に描く（上限を超えるなら、描画自体を区間ごとに行う）
  const sliceH = o.splitHeight > 0 ? o.splitHeight : Math.min(height, CANVAS_MAX_HEIGHT);
  const slices: HTMLCanvasElement[] = [];
  const images = new Map<number, HTMLImageElement | null>();
  let done = 0;
  for (const it of items) {
    images.set(it.panel.id, it.panel.imageUrl ? await loadImage(it.panel.imageUrl) : null);
    onProgress?.(++done, items.length);
  }

  for (let top = 0; top < height; top += sliceH) {
    const h = Math.min(sliceH, height - top);
    const canvas = document.createElement('canvas');
    canvas.width = o.width;
    canvas.height = h;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = o.background;
    ctx.fillRect(0, 0, o.width, h);
    ctx.translate(0, -top);

    if (o.title && top < titleH) {
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${Math.round(14 * scale)}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
      ctx.fillText(`第 ${episode.number} 話`, o.width / 2, Math.round(60 * scale));
      ctx.font = `bold ${Math.round(30 * scale)}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
      ctx.fillText(episode.title, o.width / 2, Math.round(110 * scale));
      ctx.textAlign = 'left';
    }

    for (const it of items) {
      if (it.y + it.h < top || it.y > top + h) continue; // この区間に掛からない
      const img = images.get(it.panel.id);
      if (img) drawCover(ctx, img, it.x, it.y, it.w, it.h);
      else {
        ctx.fillStyle = '#e5e7eb';
        ctx.fillRect(it.x, it.y, it.w, it.h);
        ctx.fillStyle = '#6b7280';
        ctx.font = `${Math.round(14 * scale)}px "Hiragino Sans", "Noto Sans JP", "Yu Gothic", "Meiryo", sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        wrapText(ctx, it.panel.description || '（未作画）', it.w - 40 * scale).slice(0, 4)
          .forEach((line, i, arr) => ctx.fillText(line, it.x + it.w / 2, it.y + it.h / 2 + (i - (arr.length - 1) / 2) * Math.round(20 * scale)));
        ctx.textAlign = 'left';
      }
      ctx.strokeStyle = '#111';
      ctx.lineWidth = Math.max(1, 2 * scale);
      ctx.strokeRect(it.x, it.y, it.w, it.h);
      drawBubbles(ctx, it.panel, rules, it, scale);
    }
    slices.push(canvas);
  }
  return slices;
}

/** canvas を PNG としてダウンロードする */
export async function downloadCanvases(canvases: HTMLCanvasElement[], baseName: string): Promise<void> {
  for (let i = 0; i < canvases.length; i++) {
    const blob = await new Promise<Blob | null>((r) => canvases[i].toBlob(r, 'image/png'));
    if (!blob) continue;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = canvases.length > 1 ? `${baseName}_${String(i + 1).padStart(3, '0')}.png` : `${baseName}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // 連続ダウンロードはブラウザが取りこぼすことがあるので少し間を置く
    await new Promise((r) => setTimeout(r, 400));
    URL.revokeObjectURL(a.href);
  }
}
