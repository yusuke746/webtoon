# AI漫画スタジオ（連載・拡張版）

あらすじを入力 → ストーリー構成 → キャラ生成 → 作画 → コマ割り・セリフ配置 → 出力 までを自動化する連載対応の漫画制作Webアプリ。

## 差別化ポイント（独自拡張）

| # | 機能                         | 実装                                                                                                                                                                                 |
| - | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | **伏線回収エンジン**   | 伏線を「導入話数 / 回収予定話数 / 状態 / 関連キャラ・アイテム」を持つ構造データとして管理。回収予定を過ぎた未回収伏線を自動検出して警告（`apps/server/src/engines/foreshadow.ts`） |
| 2 | **カスタマイズ自由度** | 画風・コマ割りルール・構成テンプレートを作品ごとに上書き可能。全生成ステップに「手動編集 → 再生成」ループあり                                                                       |
| 3 | **AI同士の議論機能**   | 編集者 / プロット担当 / 読者代表の3役の Claude が議題を議論し合意案を生成。ログ保存・ユーザー介入・採否選択・構成への自動反映に対応（`apps/server/src/engines/discussion.ts`）     |
| 4 | **データの使い回し**   | キャラ・世界観・画風を「ライブラリアセット」として保存し、別作品へキャスティング可能                                                                                                 |
| 5 | **みやすいUI/UX**      | 制作フローを「エピソード選択 → シーン構成 → ネーム生成 → 作画」のステッパーで可視化し、その順に画面遷移する。長時間処理は非同期ジョブ化して進捗を表示                             |
| 6 | **一貫性アセット工房** | キャラ・背景の参照画像を Replicate で複数枚生成して1枚を採用。さらに対象専用の LoRA を Replicate の trainings API で学習できる                                                       |

## 制作フロー

```
ダッシュボード（準備状況の可視化）
   ↓
[1] エピソード選択  /projects/:id/episodes
   ↓
[2] シーン構成      /projects/:id/episodes/:eid/scenes    … 話の流れを確認・編集
   ↓
[3] ネーム生成      /projects/:id/episodes/:eid/panels    … コマ割り・セリフ・背景割り当て
   ↓
[4] 作画            /projects/:id/episodes/:eid/art       … コマ単位 / 一括（非同期ジョブ）
```

各画面の上部にステッパーが常駐し、現在地と到達可否（例: ネーム未生成なら作画は無効）が分かる。

## 一貫性アセット（キャラ・背景を毎回同じ絵で描く）

「参照画像URL」「LoRA URL」を手入力する欄しかなかった箇所に、生成手段を用意している。

| 手段               | 場所                                  | 内容                                                                               |
| ------------------ | ------------------------------------- | ---------------------------------------------------------------------------------- |
| **参照画像** | キャラクター / 背景 → ビジュアル工房 | 設定文 →（Claude）英語プロンプト → Replicate で候補を複数枚生成 → 1枚を「採用」 |
| **LoRA学習** | 同上 → LoRAタブ                      | 採用候補を ZIP 化 → Replicate files API へアップロード → trainings API で学習    |
| **背景**     | サイドバー「背景・ロケーション」      | 場所を登録すると、ネーム生成時にコマへ自動割り当て（名前一致）され作画へ渡る       |

採用した参照画像・学習した LoRA は、作画時に自動でパネルへ渡される。
背景（ロケーション）もキャラと同じく参照画像・LoRA の両方を持てる。

### 1コマに適用できる LoRA / 参照画像は1つずつ

flux 系モデルは `lora_weights` と `image` を1つずつしか受け取れないため、
`resolveConsistencyInputs()`（`src/image/ImageClient.ts`）が優先順位を一元的に決める。

```
登場キャラ  →  背景  →  画風
```

- 人物のいるコマ: 顔の一貫性を優先してキャラの LoRA / 参照画像が使われる
- 人物のいない情景コマ: 背景の LoRA / 参照画像が使われる
- 適用されなかった候補はサーバーログに警告として出る（「学習したのに効かない」を追跡できるように）

人物と背景の LoRA を同時に効かせたい場合は、画風設定で複数LoRA対応モデルを選び、
`ArtStyle.extraInput` にそのモデル固有の入力（例: `hf_loras`）を直接指定する。

### LoRA学習の前提（実費・時間がかかります）

- Replicate 上での実費（数ドル程度）と時間（20〜40分）が発生する
- 学習画像は10枚以上を推奨（参照画像タブでまとめて生成できる）
- `REPLICATE_LORA_TRAINER` に **version 付き** で学習モデルを指定する必要がある（`owner/name:versionId`）
- `REPLICATE_LORA_DESTINATION` の出力先モデルは **Replicate 上に事前作成** しておく必要がある

UI の「前提条件をチェック」で、上記のうち何が足りないかを開始前に確認できる。

## アーキテクチャ

```
apps/
  server/   Express + SQLite(node:sqlite) REST API
    src/env.ts    .env の読み込み（他の import より前に読むこと）
    src/llm/      LLMClient 抽象化層（ClaudeCliClient / MockLLMClient）
    src/image/    ImageClient 抽象化層 + Replicate REST（predictions/files/trainings）+ 無依存ZIP writer
    src/engines/  story（構成/キャラ/ネーム/作画）, foreshadow, discussion, changes,
                  jobs（非同期ジョブ基盤）, visual（参照画像・背景・LoRA学習）
  web/      React + Vite フロントエンド
    src/components/  WorkflowStepper, JobProgress, RefImageStudio, LoraStudio, PageViewer
    src/pages/       ダッシュボード / 制作フロー4画面 / キャラ / 背景 / 伏線 / AI議論 / 設定
packages/
  shared/   ドメイン型定義（サーバー・フロント共通）
```

### 生成エンジンの前提

- **テキスト生成**: Claude CLI（MAX契約）をサブプロセス実行し標準出力を受け取る。APIキー不要。
  `LLMClient` インターフェースでラップ済みのため、将来 API 直叩き等へ差し替え可能。
- **作画**: Replicate API（`REPLICATE_API_TOKEN`）。画風ごとにモデル / スタイルプロンプト / LoRA を設定でき、
  パネルごとに登場キャラの LoRA・参照画像が自動で渡される（一貫性維持）。

## セットアップ

```bash
npm install
npm run build --workspace packages/shared   # 初回のみ（型パッケージのビルド）
npm run dev                                  # server(3001) + web(5173) を同時起動
```

ブラウザで http://localhost:5173 を開く。

### サンプルデータ

```bash
npm run seed
```

サンプル作品「ムーンライト・アンティーク」（あらすじ・キャラ5名・伏線5件・画風・世界観）と、
作品横断で使えるライブラリアセット（キャラ・画風・世界観 各1件）が投入されます。
再実行しても重複しません。

### 環境変数

リポジトリルートの `.env` に書けば自動で読み込まれます（`.env.example` をコピーして使用）。

```bash
cp .env.example .env    # Windows: copy .env.example .env
```

優先順位は **シェルの環境変数 > `.env.local` > `.env`**。`.env` / `.env.local` は `.gitignore` 済みです。
一時的に切り替えたい場合はシェル側が勝つため、`IMAGE_CLIENT=mock npm run dev` のように上書きできます。

| 変数                           | 既定値                             | 説明                                                                      |
| ------------------------------ | ---------------------------------- | ------------------------------------------------------------------------- |
| `LLM_CLIENT`                 | `claude`                         | `claude`（CLI サブプロセス） / `mock`（開発用）                       |
| `CLAUDE_CLI_PATH`            | `claude`                         | Claude CLI のパス                                                         |
| `CLAUDE_CLI_MODEL`           | (CLI 既定)                         | `--model` に渡すモデル名                                                |
| `LLM_TIMEOUT_MS`             | `300000`                         | CLI 呼び出しのタイムアウト                                                |
| `DISCUSSION_ROUNDS`          | `2`                              | AI議論のラウンド数                                                        |
| `IMAGE_CLIENT`               | 自動                               | `replicate` / `mock`（`REPLICATE_API_TOKEN` 未設定時は自動で mock） |
| `REPLICATE_API_TOKEN`        | —                                 | Replicate の API トークン                                                 |
| `REPLICATE_MODEL`            | `black-forest-labs/flux-schnell` | 画風未設定時のフォールバックモデル                                        |
| `REPLICATE_LORA_TRAINER`     | —                                 | LoRA学習モデル。`owner/name:versionId` 形式（version 必須）             |
| `REPLICATE_LORA_DESTINATION` | —                                 | LoRA学習の出力先`owner/model`（Replicate 上に事前作成が必要）           |
| `LORA_POLL_INTERVAL_MS`      | `15000`                          | 学習状況のポーリング間隔                                                  |
| `LORA_TIMEOUT_MS`            | `5400000`                        | 学習の打ち切り時間（既定90分）                                            |
| `PORT`                       | `3001`                           | API サーバーのポート                                                      |
| `DATA_DIR`                   | `./data`                         | SQLite DB の保存先                                                        |

Claude CLI / Replicate なしで動作確認する場合:

```bash
LLM_CLIENT=mock IMAGE_CLIENT=mock npm run dev
```

## 使い方（生成フロー）

1. **作品作成**: タイトルとあらすじを入力
2. **カスタマイズ**（任意）: コマ割りルール・構成テンプレート・画風を設定
3. **構成を生成**: 話数構成・シーン・伏線が自動生成され、伏線ボードに登録される
4. **キャラクターを生成**: 外見・性格の設定を生成（手動編集可。参照画像 / LoRA を紐付け可能）
5. **各話でネームを生成**: コマ割り・セリフ・画像プロンプトを生成（コマ単位で手動編集可）
6. **作画**: コマ単位 or 一括で Replicate により画像生成。ページプレビューでコマ割り+フキダシを確認
7. **連載を続ける**: 「構成を生成」で続きの話数を追加。伏線の回収漏れは自動警告
8. **迷ったら AI編集会議**: 議題を投げて3役の Claude に議論させ、合意案を採用 → 構成へ自動反映

## 主要 API

| メソッド | パス                                                     | 説明                               |
| -------- | -------------------------------------------------------- | ---------------------------------- |
| POST     | `/api/projects/:id/generate/structure`                 | 構成 + 伏線の生成                  |
| POST     | `/api/projects/:id/generate/characters`                | キャラ生成                         |
| POST     | `/api/episodes/:id/generate/panels`                    | ネーム生成                         |
| POST     | `/api/episodes/:id/generate/images`                    | 一括作画                           |
| GET      | `/api/projects/:id/foreshadow-warnings`                | 伏線回収漏れ警告                   |
| POST     | `/api/projects/:id/discussions`                        | AI議論の開始                       |
| POST     | `/api/discussions/:id/intervene`                       | 議論への介入                       |
| POST     | `/api/discussions/:id/decision`                        | 採否（採用時は構成へ反映可）       |
| POST     | `/api/projects/:id/apply-change`                       | 自然言語の変更指示を構成へ反映     |
| POST     | `/api/assets/:type/save/:itemId`                       | アセットをライブラリへ保存         |
| POST     | `/api/projects/:id/cast/:type/:assetId`                | ライブラリから作品へキャスティング |
| GET      | `/api/jobs/:id`                                        | 非同期ジョブの進捗                 |
| GET      | `/api/projects/:id/jobs/active`                        | 実行中ジョブ一覧                   |
| POST     | `/api/projects/:id/ref-images/:kind/:ownerId/generate` | 参照画像の候補生成                 |
| POST     | `/api/ref-images/:id/select`                           | 候補を採用（refImageUrl へ反映）   |
| GET/POST | `/api/projects/:id/backgrounds`                        | 背景の一覧・作成                   |
| POST     | `/api/projects/:id/lora-trainings`                     | LoRA学習の開始                     |
| POST     | `/api/projects/:id/lora-trainings/validate`            | 学習の前提条件チェック             |

### 非同期ジョブ

数十秒〜数十分かかる処理（AI議論・一括作画・参照画像生成・LoRA学習）はジョブ化され、
HTTP は即座に `Job` を返す。進捗は `jobs` テーブルに保存されるためリロードしても追跡できる。
実行自体はプロセス内メモリのため、サーバー再起動時に残った実行中ジョブは起動時に失敗扱いへ倒す。

## ロードマップ

- 生成ジョブのキュー化・進捗ストリーミング（現状はリクエスト同期実行）
- ページ画像の合成エクスポート（PNG/PDF）
- 世界観アセットの生成プロンプトへの反映強化
- 議論役割のユーザー定義（役割プロンプトの編集UI）
