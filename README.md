# AI漫画スタジオ（連載・拡張版）

あらすじを入力 → ストーリー構成 → キャラ生成 → 作画 → コマ割り・セリフ配置 → 出力 までを自動化する連載対応の漫画制作Webアプリ。

## 差別化ポイント（独自拡張）

| # | 機能                         | 実装                                                                                                                                                                                 |
| - | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1 | **伏線回収エンジン**   | 伏線を「導入話数 / 回収予定話数 / 状態 / 関連キャラ・アイテム」を持つ構造データとして管理。回収予定を過ぎた未回収伏線を自動検出して警告（`apps/server/src/engines/foreshadow.ts`） |
| 2 | **カスタマイズ自由度** | 画風・コマ割りルール・構成テンプレートを作品ごとに上書き可能。全生成ステップに「手動編集 → 再生成」ループあり                                                                       |
| 3 | **AI同士の議論機能**   | 編集者 / プロット担当 / 読者代表の3役の Claude が議題を議論し合意案を生成。ログ保存・ユーザー介入・採否選択・構成への自動反映に対応（`apps/server/src/engines/discussion.ts`）     |
| 4 | **データの使い回し**   | キャラ・世界観・画風を「ライブラリアセット」として保存し、別作品へキャスティング可能                                                                                                 |
| 5 | **みやすいUI/UX**      | 議論の要約表示と、自然言語の変更指示（「ペンダントの回収を3話に延ばして」）を構成データへ直接反映する`apply-change`                                                                |

## アーキテクチャ

```
apps/
  server/   Express + SQLite(node:sqlite) REST API
    src/llm/      LLMClient 抽象化層（ClaudeCliClient / MockLLMClient）
    src/image/    ImageClient 抽象化層（ReplicateImageClient / MockImageClient）
    src/engines/  story（構成/キャラ/ネーム/作画）, foreshadow, discussion, changes
  web/      React + Vite フロントエンド
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

| 変数                    | 既定値                             | 説明                                                                      |
| ----------------------- | ---------------------------------- | ------------------------------------------------------------------------- |
| `LLM_CLIENT`          | `claude`                         | `claude`（CLI サブプロセス） / `mock`（開発用）                       |
| `CLAUDE_CLI_PATH`     | `claude`                         | Claude CLI のパス                                                         |
| `CLAUDE_CLI_MODEL`    | (CLI 既定)                         | `--model` に渡すモデル名                                                |
| `LLM_TIMEOUT_MS`      | `300000`                         | CLI 呼び出しのタイムアウト                                                |
| `DISCUSSION_ROUNDS`   | `2`                              | AI議論のラウンド数                                                        |
| `IMAGE_CLIENT`        | 自動                               | `replicate` / `mock`（`REPLICATE_API_TOKEN` 未設定時は自動で mock） |
| `REPLICATE_API_TOKEN` | —                                 | Replicate の API トークン                                                 |
| `REPLICATE_MODEL`     | `black-forest-labs/flux-schnell` | 画風未設定時のフォールバックモデル                                        |
| `PORT`                | `3001`                           | API サーバーのポート                                                      |
| `DATA_DIR`            | `./data`                         | SQLite DB の保存先                                                        |

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

| メソッド | パス                                      | 説明                               |
| -------- | ----------------------------------------- | ---------------------------------- |
| POST     | `/api/projects/:id/generate/structure`  | 構成 + 伏線の生成                  |
| POST     | `/api/projects/:id/generate/characters` | キャラ生成                         |
| POST     | `/api/episodes/:id/generate/panels`     | ネーム生成                         |
| POST     | `/api/episodes/:id/generate/images`     | 一括作画                           |
| GET      | `/api/projects/:id/foreshadow-warnings` | 伏線回収漏れ警告                   |
| POST     | `/api/projects/:id/discussions`         | AI議論の開始                       |
| POST     | `/api/discussions/:id/intervene`        | 議論への介入                       |
| POST     | `/api/discussions/:id/decision`         | 採否（採用時は構成へ反映可）       |
| POST     | `/api/projects/:id/apply-change`        | 自然言語の変更指示を構成へ反映     |
| POST     | `/api/assets/:type/save/:itemId`        | アセットをライブラリへ保存         |
| POST     | `/api/projects/:id/cast/:type/:assetId` | ライブラリから作品へキャスティング |

## ロードマップ

- 生成ジョブのキュー化・進捗ストリーミング（現状はリクエスト同期実行）
- ページ画像の合成エクスポート（PNG/PDF）
- 世界観アセットの生成プロンプトへの反映強化
- 議論役割のユーザー定義（役割プロンプトの編集UI）
