/**
 * Replicate REST API の薄いラッパ。
 * ReplicateImageClient（推論）に加えて、LoRA学習で使う files / trainings も扱う。
 *
 * 認証は環境変数 REPLICATE_API_TOKEN。未設定なら呼び出し時に明示的に失敗する
 * （画像生成側は MockImageClient へフォールバックするのでここには来ない）。
 */

const API = 'https://api.replicate.com/v1';

export function replicateToken(): string {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN が設定されていません（.env を確認してください）');
  return token;
}

export function hasReplicateToken(): boolean {
  return !!process.env.REPLICATE_API_TOKEN;
}

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${replicateToken()}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Replicate API エラー (${res.status} ${path}): ${body.slice(0, 500)}`);
  }
  return (await res.json()) as T;
}

// ---------- files（学習画像ZIPのアップロード） ----------

export interface ReplicateFile {
  id: string;
  urls: { get: string };
}

/**
 * Replicate の files API へアップロードして公開URLを得る。
 * ローカル開発では自前のサーバーが外部から到達できないため、
 * 学習画像の受け渡しにはこのアップロードが必須。
 */
export async function uploadFile(
  bytes: Uint8Array,
  filename: string,
  contentType = 'application/zip',
): Promise<ReplicateFile> {
  const form = new FormData();
  // Uint8Array -> Blob。Node 20+ は File/Blob/FormData がグローバルに存在する
  form.append('content', new Blob([bytes as unknown as BlobPart], { type: contentType }), filename);

  const res = await fetch(`${API}/files`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${replicateToken()}` }, // Content-Type は FormData に任せる
    body: form,
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Replicate へのファイルアップロードに失敗しました (${res.status}): ${body.slice(0, 500)}`);
  }
  return (await res.json()) as ReplicateFile;
}

// ---------- trainings（LoRA学習） ----------

export interface ReplicateTraining {
  id: string;
  status: 'starting' | 'processing' | 'succeeded' | 'failed' | 'canceled';
  error: string | null;
  output?: { weights?: string; version?: string } | null;
  urls?: { get: string; cancel: string };
}

/**
 * 学習を開始する。
 * trainerModel は "owner/name:versionId" 形式（version 必須）。
 * destination は学習結果の出力先モデル "owner/model"（Replicate 上に事前作成が必要）。
 */
export async function createTraining(
  trainerModel: string,
  destination: string,
  input: Record<string, unknown>,
): Promise<ReplicateTraining> {
  const [ownerName, version] = trainerModel.split(':');
  if (!version) {
    throw new Error(
      `学習モデルには version が必要です: "${trainerModel}" ` +
        '（"owner/name:versionId" 形式で指定してください）',
    );
  }
  const [owner, name] = ownerName.split('/');
  if (!owner || !name) {
    throw new Error(`学習モデルの形式が不正です: "${trainerModel}"`);
  }
  return call<ReplicateTraining>(`/models/${owner}/${name}/versions/${version}/trainings`, {
    method: 'POST',
    body: JSON.stringify({ destination, input }),
  });
}

export async function getTraining(id: string): Promise<ReplicateTraining> {
  return call<ReplicateTraining>(`/trainings/${id}`);
}

export async function cancelTraining(id: string): Promise<void> {
  await call(`/trainings/${id}/cancel`, { method: 'POST' });
}

// ---------- 画像のダウンロード（学習ZIPを組み立てるため） ----------

export async function downloadImage(url: string): Promise<{ bytes: Uint8Array; ext: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`画像の取得に失敗しました (${res.status}): ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  const type = res.headers.get('content-type') ?? '';
  const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : 'jpg';
  return { bytes: buf, ext };
}
