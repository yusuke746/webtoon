import { Link } from 'react-router-dom';
import type { Episode } from '@manga/shared';

/**
 * 制作フローの現在地を示すステッパー。
 *   エピソード選択 → シーン構成 → ネーム生成 → 作画
 * 各ステップはリンクになっていて、クリックでその画面へ遷移する。
 * まだ到達できないステップ（例: 構成前のネーム）は disabled にして誤操作を防ぐ。
 */

export type WorkflowStep = 'select' | 'scenes' | 'panels' | 'art';

const STEPS: { key: WorkflowStep; label: string; sub: string }[] = [
  { key: 'select', label: 'エピソード選択', sub: '作る話を決める' },
  { key: 'scenes', label: 'シーン構成', sub: '話の流れを確認' },
  { key: 'panels', label: 'ネーム生成', sub: 'コマ割り・セリフ' },
  { key: 'art', label: '作画', sub: '画像を生成' },
];

export function WorkflowStepper({
  projectId,
  episode,
  current,
}: {
  projectId: number;
  /** エピソード未選択なら null（ステップ2以降は無効） */
  episode: Pick<Episode, 'id' | 'number' | 'status'> | null;
  current: WorkflowStep;
  }) {
  const currentIndex = STEPS.findIndex((s) => s.key === current);

  // 到達可否: エピソード未選択なら2以降は不可。ネーム未生成なら作画は不可。
  const reachable = (key: WorkflowStep): boolean => {
    if (key === 'select') return true;
    if (!episode) return false;
    if (key === 'art') return episode.status === 'paneled' || episode.status === 'rendered';
    return true;
  };

  const href = (key: WorkflowStep): string => {
    if (key === 'select' || !episode) return `/projects/${projectId}/episodes`;
    return `/projects/${projectId}/episodes/${episode.id}/${key}`;
  };

  return (
    <nav className="stepper" aria-label="制作フロー">
      {STEPS.map((step, i) => {
        const state = i === currentIndex ? 'current' : i < currentIndex ? 'done' : '';
        const enabled = reachable(step.key);
        const className = `step ${state} ${enabled ? '' : 'disabled'}`.trim();

        const inner = (
          <>
            <span className="num">{i < currentIndex ? '✓' : i + 1}</span>
            <span>
              <span className="label">{step.label}</span>
              <br />
              <span className="sub">
                {step.key === 'select' && episode ? `第${episode.number}話を選択中` : step.sub}
              </span>
            </span>
          </>
        );

        if (!enabled) {
          return (
            <span key={step.key} className={className} aria-disabled="true">
              {inner}
            </span>
          );
        }
        return (
          <Link key={step.key} to={href(step.key)} className={className}>
            {inner}
          </Link>
        );
      })}
    </nav>
  );
}
