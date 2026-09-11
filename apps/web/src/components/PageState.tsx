import { Link } from 'react-router-dom';

/** 読み込み中のプレースホルダ */
export function SkeletonPage() {
  return (
    <div>
      <div className="skeleton" style={{ height: 28, width: 260, marginBottom: 14 }} />
      <div className="skeleton" style={{ height: 62, marginBottom: 18 }} />
      <div className="skeleton" style={{ height: 180 }} />
    </div>
  );
}

/**
 * データ取得に失敗した（存在しないID・サーバー停止など）ときの表示。
 * スケルトンのまま止まらないよう、原因と戻り先を示す。
 */
export function LoadErrorPage({ message, backTo, backLabel }: {
  message: string;
  backTo: string;
  backLabel: string;
}) {
  return (
    <div className="empty-state">
      <div className="big">🧭</div>
      <div style={{ marginBottom: 10 }}>{message}</div>
      <Link to={backTo}>{backLabel}</Link>
    </div>
  );
}
