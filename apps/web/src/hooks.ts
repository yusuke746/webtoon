import { useCallback, useEffect, useRef, useState } from 'react';
import type { Job } from '@manga/shared';
import { api } from './api';

/** 単純な fetch フック（読み込み・エラー・再取得付き） */
export function useFetch<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    setError(null);
    fn()
      .then(setData)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => { reload(); }, [reload]);
  return { data, loading, error, reload, setData };
}

/** 実行中フラグ・エラー付きのアクション実行フック（生成ボタン用） */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(async (label: string, fn: () => Promise<unknown>) => {
    setBusy(label);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }, []);

  return { busy, error, run, setError };
}

/**
 * 非同期ジョブを追跡するフック。
 *
 * track(job) を呼ぶと完了するまで一定間隔でポーリングし、
 * 進捗を job として返す。完了/失敗時に onDone(job) が1回だけ呼ばれる。
 * ポーリング中に画面側のデータも更新したい場合は onTick を使う。
 */
export function useJobTracker(options: {
  intervalMs?: number;
  onDone?: (job: Job) => void;
  onTick?: (job: Job) => void;
} = {}) {
  const { intervalMs = 1500 } = options;
  const [job, setJob] = useState<Job | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 最新のコールバックを参照する（依存配列に入れてポーリングを再起動させないため）
  const cbs = useRef(options);
  cbs.current = options;

  const stop = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const track = useCallback((started: Job) => {
    stop();
    setJob(started);

    const poll = async () => {
      try {
        const latest = await api.getJob(started.id);
        setJob(latest);
        cbs.current.onTick?.(latest);
        if (latest.status === 'succeeded' || latest.status === 'failed') {
          cbs.current.onDone?.(latest);
          return; // 次のポーリングを予約しない
        }
      } catch {
        // 一時的な通信エラーはポーリングを続けて回復を待つ
      }
      timer.current = setTimeout(poll, intervalMs);
    };
    timer.current = setTimeout(poll, intervalMs);
  }, [intervalMs, stop]);

  // アンマウント時にタイマーを止める
  useEffect(() => stop, [stop]);

  const dismiss = useCallback(() => { stop(); setJob(null); }, [stop]);

  return { job, track, dismiss, running: job?.status === 'running' || job?.status === 'queued' };
}

/** 経過秒数を数えるだけのフック（ローディング表示用） */
export function useElapsed(active: boolean): number {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    if (!active) { setSec(0); return; }
    const started = Date.now();
    const t = setInterval(() => setSec(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(t);
  }, [active]);
  return sec;
}
