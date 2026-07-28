/**
 * 画像生成の抽象化層。現在は Replicate 実装がデフォルト。
 * キャラ・背景の一貫性維持のため、パネル単位で LoRA / 参照画像を指定できる。
 */
export interface ImageRequest {
  prompt: string;
  /** Replicate モデル（owner/name 形式）。画風設定から渡される */
  model: string;
  /** スタイルLoRA（画風単位） */
  styleLoraUrl?: string | null;
  /** キャラLoRA（パネル登場キャラ単位） */
  characterLoraUrls?: string[];
  /** キャラ参照画像（image-to-image / IP-Adapter 系モデル向け） */
  referenceImageUrls?: string[];
  /** アスペクト比（例: "3:4"） */
  aspectRatio?: string;
  /** モデル固有の追加入力 */
  extraInput?: Record<string, unknown>;
}

export interface ImageResult {
  /** 生成画像のURL */
  url: string;
}

export interface ImageClient {
  readonly name: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}
