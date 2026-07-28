import type { Panel, PanelRules } from '@manga/shared';

/**
 * コマ割りレイアウトをページ単位でレンダリングするビューア。
 * layout はグリッド座標（PanelRules.gridCols/gridRows 基準）。
 */
export function PageViewer({ panels, rules }: { panels: Panel[]; rules: PanelRules }) {
  const pages = [...new Set(panels.map((p) => p.layout.page ?? 1))].sort((a, b) => a - b);
  if (!pages.length) return null;

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
                const style = {
                  left: `${(x / rules.gridCols) * 100}%`,
                  top: `${(y / rules.gridRows) * 100}%`,
                  width: `${(w / rules.gridCols) * 100}%`,
                  height: `${(h / rules.gridRows) * 100}%`,
                };
                return (
                  <div key={p.id} className="page-panel" style={style}>
                    {p.imageUrl
                      ? <img src={p.imageUrl} alt={p.description} />
                      : <div className="desc">{p.description || '(未作画)'}</div>}
                    {p.dialogues.map((d, i) => (
                      <div
                        key={i}
                        className={`bubble ${d.kind}`}
                        style={{
                          // 読み方向に応じてセリフを右上から順に配置
                          ...(rules.readingDirection === 'ltr'
                            ? { left: 4 + (i % 2) * 10 }
                            : { right: 4 + (i % 2) * 10 }),
                          top: 4 + i * 26,
                        }}
                        title={d.speaker}
                      >
                        {d.text}
                      </div>
                    ))}
                  </div>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
