import express from 'express';
import cors from 'cors';
import { router } from './routes.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use('/api', router);

// エラーハンドラ（エンジン層の throw をここで JSON 化）
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[error]', err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT ?? 3001);
app.listen(port, () => {
  console.log(`[server] AI漫画スタジオ API: http://localhost:${port}/api`);
});
