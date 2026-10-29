import { resolveConsistencyInputs, type ImageClient, type ImageRequest, type ImageResult } from './ImageClient.js';
import { localImageToDataUri } from './storage.js';
import { modelCaps, nearestAspect } from './models.js';
import { flattenSheets } from './references.js';

/**
 * Replicate API で画像生成する実装。
 * 認証は環境変数 REPLICATE_API_TOKEN。
 *
 * モデルごとの入力差異は ArtStyle.extraInput / ImageRequest.extraInput で吸収する。
 * LoRA は flux 系の "lora_weights"、参照画像は "image" 入力へマッピング（extraInput で上書き可）。
 */
export class ReplicateImageClient implements ImageClient {
  readonly name = 'replicate';
  private token = process.env.REPLICATE_API_TOKEN;

  async generate(req: ImageRequest): Promise<ImageResult> {
    if (!this.token) {
      throw new Error('REPLICATE_API_TOKEN が設定されていません');
    }
    const caps = modelCaps(req.model);
    const input: Record<string, unknown> = { ...(caps.defaults ?? {}), prompt: req.prompt };
    if (caps.aspectInput && process.env.IMAGE_ASPECT_INPUT !== '0') {
      input[caps.aspectInput] = nearestAspect(req.aspectRatio ?? '3:4', caps.aspectValues);
    }
    Object.assign(input, req.extraInput);
    // negative_prompt は SD 系だけが受け取る（flux 系に渡すと「未知の入力」エラーになる）
    if (req.negativePrompt && input.negative_prompt === undefined && caps.negative) {
      input.negative_prompt = req.negativePrompt;
    }

    // ---- 設定画（マルチリファレンス） ----
    // 対応モデルには、キャラシート・背景シートを配列で渡し、プロンプト先頭に「どの画像が誰か」を書く
    let appliedReferenceCount = 0;
    const refs = flattenSheets(req.referenceSheets ?? [], caps.maxRefs);
    if (caps.refMode === 'multi' && caps.refInput && refs.length && input[caps.refInput] === undefined) {
      input[caps.refInput] = await Promise.all(refs.map((r) => (r.url.startsWith('/api/images/') ? localImageToDataUri(r.url) : r.url)));
      // 参照画像の対応は自然文で書く（"[image 1] = 名前" のような表記や日本語の名前は、画像に文字として描かれやすい）
      input.prompt = `Do not render any text, letters, numbers, logos or signs anywhere in the image. ${refs.map((r, i) => `Reference image ${i + 1} shows ${r.label}`).join('; ')}. Draw the characters and the place exactly as shown in these reference images. ${req.prompt}`;
      appliedReferenceCount = refs.length;
    }

    // lora_weights / image は1つずつしか渡せないため、優先順位に従って1つに決める
    const { lora, referenceImage, droppedLoras } = resolveConsistencyInputs(req);
    // 作画モデル自身が学習済みLoRAモデル（owner/model:version）の場合、重みは焼き込み済みなので渡さない。
    // 渡すと「lora_weights は未知の入力」エラーや private モデルの重みDL失敗になる
    const loraIsSelf = !!lora && (lora === req.model || lora.startsWith(`${req.model}:`));
    if (lora && !loraIsSelf && input.lora_weights === undefined && caps.refMode !== 'multi') input.lora_weights = lora;
    // 単一参照モデル: 台帳の入力名へ（設定画があればその先頭、無ければ従来の参照画像）
    if (caps.refMode === 'single' && caps.refInput && input[caps.refInput] === undefined) {
      const first = refs[0]?.url ?? referenceImage;
      if (first) { input[caps.refInput] = first; appliedReferenceCount = refs[0] ? 1 : 0; }
    }
    if (droppedLoras.length > 0 && input.lora_weights === lora) {
      // 黙って捨てると「LoRAを学習したのに効かない」原因が分からなくなるので明示する
      console.warn(
        `[image] このモデルは LoRA を1つしか適用できません。適用: ${lora} / 未適用: ${droppedLoras.join(', ')}`,
      );
    }

    // クレジット残高が $5 未満だと「毎分6リクエスト・バースト1」に制限されるため、
    // 429 は retry_after（秒）を尊重してリトライする
    // ローカル保存した画像（/api/images/…）は外部から到達できないため data URI にして渡す
    for (const key of ['image', 'input_image', 'image_input', 'input_images'] as const) {
      const v = input[key];
      if (typeof v === 'string' && v.startsWith('/api/images/')) input[key] = await localImageToDataUri(v);
      if (Array.isArray(v)) input[key] = await Promise.all(v.map((u) => (typeof u === 'string' && u.startsWith('/api/images/') ? localImageToDataUri(u) : u)));
    }

    // "owner/name" は models エンドポイント（公式モデル用）、
    // "owner/name:versionId" は /v1/predictions に version を渡す（個人・学習済みモデル用）
    const versionMatch = req.model.match(/^[^:]+:(.+)$/);
    const endpoint = versionMatch
      ? 'https://api.replicate.com/v1/predictions'
      : `https://api.replicate.com/v1/models/${req.model}/predictions`;
    const payload = versionMatch ? { version: versionMatch[1], input } : { input };

    let prediction: any;
    for (let attempt = 1; ; attempt++) {
      const res = await fetch(
        endpoint,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            'Content-Type': 'application/json',
            Prefer: 'wait=60',
          },
          body: JSON.stringify(payload),
        },
      );
      if (res.status === 429 && attempt < 6) {
        const body = await res.text();
        let retryAfter = Number(res.headers.get('retry-after'));
        if (!Number.isFinite(retryAfter) || retryAfter <= 0) {
          try { retryAfter = Number(JSON.parse(body).retry_after); } catch { /* 本文がJSONでない */ }
        }
        const waitSec = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter + 1 : 12;
        console.warn(`[image] レート制限（429）。${waitSec}秒待って再試行します（${attempt}/5）`);
        await new Promise((r) => setTimeout(r, waitSec * 1000));
        continue;
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Replicate API エラー (${res.status}): ${body.slice(0, 500)}`);
      }
      prediction = await res.json();
      break;
    }

    // Prefer: wait でも完了しない場合はポーリング。
    // ポーリングの応答が予測ではないこと（429 やエラー本文で urls が無い）があるため、取得 URL は最初の応答のものを使い続ける
    const getUrl: string | undefined = prediction?.urls?.get;
    const deadline = Date.now() + 180_000;
    let badPolls = 0;
    while (prediction?.status !== 'succeeded' && prediction?.status !== 'failed' && prediction?.status !== 'canceled') {
      if (!getUrl) throw new Error(`Replicate の応答が想定外です: ${JSON.stringify(prediction).slice(0, 300)}`);
      if (Date.now() > deadline) throw new Error('Replicate の生成がタイムアウトしました');
      await new Promise((r) => setTimeout(r, 2000));
      const poll = await fetch(getUrl, { headers: { Authorization: `Bearer ${this.token}` } });
      const body: any = await poll.json().catch(() => null);
      if (!poll.ok || !body || typeof body.status !== 'string') {
        // 一時的な失敗（429 など）は数回まで見逃す
        if (++badPolls > 5) throw new Error(`Replicate の状態取得に失敗しました (${poll.status}): ${JSON.stringify(body).slice(0, 300)}`);
        console.warn(`[image] 状態取得に失敗（${poll.status}）。再試行します（${badPolls}/5）`);
        await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      prediction = body;
    }
    if (prediction.status !== 'succeeded') {
      const reason = String(prediction.error ?? prediction.status);
      const nsfw = /nsfw|safety|sensitive content|content policy|unsafe/i.test(reason);
      throw new Error(`Replicate の生成が失敗しました: ${reason}${nsfw ? '（モデル側の NSFW 判定。コマの imagePrompt の表現を変えて再作画してください）' : ''}`);
    }
    const output = prediction.output;
    const url = Array.isArray(output) ? output[0] : output;
    if (typeof url !== 'string') {
      throw new Error(`Replicate の出力形式が想定外です: ${JSON.stringify(output).slice(0, 200)}`);
    }
    return { url, appliedLora: lora, appliedReferenceImage: referenceImage, appliedReferenceCount };
  }
}
