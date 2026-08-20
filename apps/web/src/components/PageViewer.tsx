import type { BubblePosition, Dialogue, Panel, PanelRules } from '@manga/shared';

/**
 * コマ割りレイアウトをページ単位でレンダリングするビューア。
 * - 吹き出しは position（LLM 指定 or 自動割当）ごとのコーナー領域に縦積みし、重なりを防ぐ
 * - readingDirection が vertical の場合は Webtoon 風の1列レイアウト
 */
export function PageViewer({ panels, rules }: { panels: Panel[]; rules: PanelRules }) {
  if (!panels.length) return null;

  if (rules.readingDirection === 'vertical') {
    return (
      <div style={{ maxWidth: 420 }}>
        {panels.map((p) => (
          <div
            key={p.id}
            className="page-panel"
            style={{ position: 'relative', marginBottom: 10, aspectRatio: `${p.layout.w || 4} / ${p.layout.h || 3}` }}
          >
            <PanelContent panel={p} rules={rules} />
          </div>
        ))}
      </div>
    );
  }

  const pages = [...new Set(panels.map((p) => p.layout.page ?? 1))].sort((a, b) => a - b);
  return (
    <div className="row" style={{ alignItems: 'flex-start' }}>
      {pages.map((page) => (
        <div key={page} style={{ width: 360 }}>
          <div className="muted" style={{ marginBottom: 4 }}>P.{page}</div>
          <div className="page-sheet">
            {panels
              .filter((p) => (p.layout.page ?? 1) === page)
              .map((p) => {
                const { x, y, w, h } = p.layout;
                return (
                  <div
                    key={p.id}
                    className="page-panel"
                    style={{
                      left: `${(x / rules.gridCols) * 100}%`,
                      top: `${(y / rules.gridRows) * 100}%`,
                      width: `${(w / rules.gridCols) * 100}%`,
                      height: `${(h / rules.gridRows) * 100}%`,
                    }}
                  >
                    <PanelContent panel={p} rules={rules} />
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}

const POSITIONS: BubblePosition[] = [
  'top-left', 'top-right', 'middle-left', 'middle-right', 'bottom-left', 'bottom-right',
];

/** position 未指定のセリフに、読み方向に沿って空いているコーナーを割り当てる */
function resolvePositions(dialogues: Dialogue[], rules: PanelRules): BubblePosition[] {
  // 日本式(右→左)は右上→左上→…、左→右はその逆の順で埋める
  const fillOrder: BubblePosition[] =
    rules.readingDirection === 'ltr'
      ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right']
      : ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'middle-right', 'middle-left'];

  const used = new Set<BubblePosition>();
  const result: BubblePosition[] = [];
  for (const d of dialogues) {
    let pos = d.position && POSITIONS.includes(d.position) ? d.position : undefined;
    if (!pos || used.has(pos)) {
      pos = fillOrder.find((p) => !used.has(p)) ?? 'top-left';
    }
    used.add(pos);
    result.push(pos);
  }
  return result;
}

function PanelContent({ panel, rules }: { panel: Panel; rules: PanelRules }) {
  const positions = resolvePositions(panel.dialogues, rules);

  // コーナー領域ごとにグループ化し、領域内は縦積みで重なりを防ぐ
  const groups = new Map<BubblePosition, Dialogue[]>();
  panel.dialogues.forEach((d, i) => {
    const pos = positions[i];
    if (!groups.has(pos)) groups.set(pos, []);
    groups.get(pos)!.push(d);
  });

  return (
    <>
      {panel.imageUrl
        ? <img src={panel.imageUrl} alt={panel.description} />
        : <div className="desc">{panel.description || '(未作画)'}</div>}
      {[...groups.entries()].map(([pos, dialogues]) => {
        const [v, h] = pos.split('-') as ['top' | 'middle' | 'bottom', 'left' | 'right'];
        return (
          <div
            key={pos}
            className="bubble-zone"
            style={{
              ...(h === 'left' ? { left: 4, alignItems: 'flex-start' } : { right: 4, alignItems: 'flex-end' }),
              ...(v === 'top'
                ? { top: 4 }
                : v === 'bottom'
                  ? { bottom: 4 }
                  : { top: '50%', transform: 'translateY(-50%)' }),
            }}
          >
            {dialogues.map((d, i) => (
              <div key={i} className={`bubble ${d.kind}`} title={d.speaker}>
                {d.text}
              </div>
            ))}
          </div>
        );
      })}
    </>
  );
}
