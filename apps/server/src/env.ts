import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * リポジトリルートの .env / .env.local を process.env へ読み込む。
 *
 * このモジュールは副作用が目的なので、index.ts の «先頭» で import すること。
 * ESM の import は宣言順に評価されるため、db.ts（DATA_DIR をトップレベルで参照）
 * より前に import しないと設定が効かない。
 *
 * process.loadEnvFile() は既に定義済みのキーを «上書きしない» ため、
 * 優先順位は  シェルの環境変数 > .env.local > .env  となる。
 * 例: 一時的に mock で動かしたい場合は `set IMAGE_CLIENT=mock` が .env に勝つ。
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// src/ から実行（tsx）でも dist/ から実行（node）でもリポジトリルートを指す
const repoRoot = path.resolve(__dirname, '../../..');

const loaded: string[] = [];
for (const file of ['.env.local', '.env']) {
  const filePath = path.join(repoRoot, file);
  if (!existsSync(filePath)) continue;
  try {
    process.loadEnvFile(filePath);
    loaded.push(file);
  } catch (err) {
    console.warn(`[env] ${file} の読み込みに失敗しました:`, (err as Error).message);
  }
}

if (loaded.length > 0) {
  console.log(`[env] 読み込み: ${loaded.join(', ')}`);
} else {
  console.log('[env] .env は見つかりませんでした（シェルの環境変数のみ使用）');
}
