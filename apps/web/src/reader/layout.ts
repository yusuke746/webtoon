import type { Panel, PanelRules } from '@manga/shared';

/** コマを読み順に並べる */
export function readingOrder(panels: Panel[], rules: PanelRules): Panel[] {
  const dir = rules.readingDirection;
  return [...panels].sort((a, b) => {
    const pa = a.layout.page ?? 1, pb = b.layout.page ?? 1;
    if (pa !== pb) return pa - pb;
    if (a.layout.y !== b.layout.y) return a.layout.y - b.layout.y;
    if (a.layout.x !== b.layout.x) return dir === 'rtl' ? b.layout.x - a.layout.x : a.layout.x - b.layout.x;
    return a.index - b.index;
  });
}

/** 列幅に対するコマの高さの比（ページは縦長 3:4.2 想定。作画のアスペクト比の計算と同じ） */
export function stripHeightRatio(p: Panel, rules: PanelRules): number {
  const w = (p.layout.w || 1) / rules.gridCols;
  const h = ((p.layout.h || 1) / rules.gridRows) * 1.4;
  const r = h / w;
  return Math.min(2.4, Math.max(0.3, r));
}
