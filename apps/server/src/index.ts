// .env の読み込み。他の import より «前» に置くこと（並べ替え禁止）。
// routes.js -> db.js はトップレベルで process.env を参照するため、順序が入れ替わると設定が効かない。
import './env.js';

import express from 'express';
import cors from 'cors';
import { router } from './routes.js';
import { failStaleJobs } from './engines/jobs.js';
import { IMAGES_DIR } from './image/storage.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
// 生成画像はローカル保存して配信する（Replicate の出力URLは約1時間で失効するため）
app.use('/api/images', express.static(IMAGES_DIR, { maxAge: '365d', immutable: true }));
app.use('/api', router);

// エラーハンドラ（エンジン層の throw をここで JSON 化）
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message });
});

// ジョブの実行状態はプロセス内メモリにあるため、再起動をまたいだ running は復帰できない。
// 「永遠に0%」の表示を残さないよう起動時に失敗扱いにする。
const stale = failStaleJobs();
if (stale > 0) console.log(`[jobs] 中断された実行中ジョブを ${stale} 件クリーンアップしました`);

const port = Number(process.env.PORT ?? 3001);
const server = app.listen(port, () => {
  console.log(`[server] AI漫画スタジオ API: http://localhost:${port}/api`);
});

// listen 失敗は unhandled 'error' でスタックトレースを吐いて落ちるため、原因を明示して終了する
server.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(
      `[server] ポート ${port} は既に使用中です。開発サーバーが二重起動している可能性があります。\n` +
        `  使用中のプロセスを確認: netstat -ano | findstr :${port}\n` +
        `  停止する:              taskkill /PID <PID> /F\n` +
        `  別ポートで起動する:    set PORT=3002 && npm run dev:server`,
    );
  } else if (err.code === 'EACCES') {
    console.error(`[server] ポート ${port} を使用する権限がありません。PORT に 1024 以上の値を指定してください。`);
  } else {
    console.error('[server] サーバーの起動に失敗しました:', err);
  }
  process.exit(1);
});
