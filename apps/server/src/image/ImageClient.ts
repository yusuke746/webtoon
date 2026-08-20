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
  /** 背景LoRA（パネルに紐付いた背景） */
  backgroundLoraUrl?: string | null;
  /** キャラ参照画像（image-to-image / IP-Adapter 系モデル向け） */
  referenceImageUrls?: string[];
  /** 背景参照画像 */
  backgroundRefImageUrl?: string | null;
  /** アスペクト比（例: "3:4"） */
  aspectRatio?: string;
  /** モデル固有の追加入力 */
  extraInput?: Record<string, unknown>;
}

export interface ImageResult {
  /** 生成画像のURL */
  url: string;
  /** 実際に適用された LoRA（モデルが1つしか受け取れないため記録する） */
  appliedLora?: string | null;
  /** 実際に適用された参照画像 */
  appliedReferenceImage?: string | null;
}

export interface ImageClient {
  readonly name: string;
  generate(req: ImageRequest): Promise<ImageResult>;
}

/**
 * 一貫性アセット（LoRA / 参照画像）の «適用する1つ» を決める。
 *
 * Replicate の flux 系モデルは lora_weights も image も «1つずつ» しか受け取れない。
 * そのため候補が複数あるときの優先順位をここで一元的に決める:
 *
 *   キャラ（登場人物がいるコマは顔の一貫性が最優先）
 *     → 背景（人物のいない情景コマではここが効く）
 *       → 画風
 *
 * 複数のLoRAを同時に効かせたい場合は、複数LoRA対応モデルを画風に設定し、
 * ArtStyle.extraInput でそのモデル固有の入力（例: hf_loras）を直接指定すること。
 */
export function resolveConsistencyInputs(req: ImageRequest): {
  lora: string | null;
  referenceImage: string | null;
  /** 適用されなかった候補（呼び出し側でログに出す用） */
  droppedLoras: string[];
} {
  const loraCandidates = [
    ...(req.characterLoraUrls ?? []),
    req.backgroundLoraUrl ?? null,
    req.styleLoraUrl ?? null,
  ].filter((u): u is string => !!u);

  const refCandidates = [
    ...(req.referenceImageUrls ?? []),
    req.backgroundRefImageUrl ?? null,
  ].filter((u): u is string => !!u);

  return {
    lora: loraCandidates[0] ?? null,
    referenceImage: refCandidates[0] ?? null,
    droppedLoras: loraCandidates.slice(1),
  };
}
