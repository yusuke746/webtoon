/**
 * 画像生成モデルの «参照画像の受け取り方» の台帳。
 *
 * 一貫性を保つには、設定画（キャラシート・背景シート）を生成時に渡す必要があるが、
 * モデルごとに入力名も枚数も違う。ここで吸収し、ReplicateImageClient が入力を組み立てる。
 *
 *   multi  … 複数の参照画像を一度に受け取る（マルチリファレンス）。漫画の一貫性にはこれが本命
 *   single … 1枚だけ受け取る（編集・img2img 系）
 *   none   … 画像入力なし（flux-schnell など）。設定画は渡せず、固定文と作画チェックだけが効く
 *
 * モデル名・入力仕様は変わりやすいので、ArtStyle.extraInput で上書きできる（同名キーは extraInput が勝つ）。
 */

export interface ModelCaps {
  /** 台帳上の表示名 */
  label: string;
  /** 参照画像の受け取り方 */
  refMode: 'multi' | 'single' | 'none';
  /** 参照画像を入れる入力名（配列か単一か refMode による） */
  refInput: string | null;
  /** 一度に渡せる参照画像の上限 */
  maxRefs: number;
  /** アスペクト比の入力名（null なら渡さない） */
  aspectInput: string | null;
  /** アスペクト比に使える値（指定があれば一番近いものへ丸める） */
  aspectValues?: string[];
  /** negative_prompt を受け取るか */
  negative: boolean;
  /** 既定で足す入力（例: output_format） */
  defaults?: Record<string, unknown>;
  /** 備考（画面に出す） */
  note: string;
}

const REGISTRY: { pattern: RegExp; caps: ModelCaps }[] = [
  {
    pattern: /^google\/nano-banana/i,
    caps: {
      label: 'Gemini 2.5 Flash Image (nano-banana)', refMode: 'multi', refInput: 'image_input', maxRefs: 10,
      aspectInput: 'aspect_ratio', aspectValues: ['1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '5:4', '4:5', '21:9'],
      negative: false, defaults: { output_format: 'png' },
      note: 'キャラシート・背景シートを同時に渡せる。漫画の一貫性に最適',
    },
  },
  {
    pattern: /^bytedance\/seedream-4/i,
    caps: {
      label: 'Seedream 4', refMode: 'multi', refInput: 'image_input', maxRefs: 10,
      aspectInput: 'aspect_ratio', aspectValues: ['1:1', '4:3', '3:4', '16:9', '9:16', '3:2', '2:3', '21:9'],
      negative: false, defaults: { size: '2K', sequential_image_generation: 'disabled', max_images: 1 },
      note: '複数の参照画像を受け取れる。高解像度',
    },
  },
  {
    pattern: /^openai\/gpt-image/i,
    caps: {
      label: 'GPT Image', refMode: 'multi', refInput: 'input_images', maxRefs: 10,
      aspectInput: 'aspect_ratio', aspectValues: ['1:1', '3:2', '2:3'],
      negative: false, defaults: { quality: 'medium' },
      note: '複数の参照画像を受け取れる。extraInput に openai_api_key が必要',
    },
  },
  {
    pattern: /^black-forest-labs\/flux-kontext-(max|pro|dev)/i,
    caps: {
      label: 'FLUX.1 Kontext', refMode: 'single', refInput: 'input_image', maxRefs: 1,
      aspectInput: 'aspect_ratio', aspectValues: ['match_input_image', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9', '9:21'],
      negative: false, defaults: { output_format: 'png' },
      note: '参照画像は1枚だけ（主役キャラのシート）。背景は固定文で補う',
    },
  },
  {
    pattern: /^black-forest-labs\/flux-dev/i,
    caps: {
      label: 'FLUX.1 dev', refMode: 'single', refInput: 'image', maxRefs: 1,
      aspectInput: 'aspect_ratio', negative: false,
      note: 'image は img2img（構図を写す）で、人物の同一性は保てない。設定画は実質効かない',
    },
  },
  {
    pattern: /^black-forest-labs\/flux-schnell/i,
    caps: {
      label: 'FLUX.1 schnell', refMode: 'none', refInput: null, maxRefs: 0,
      aspectInput: 'aspect_ratio', negative: false,
      note: '画像入力なし。設定画は渡せない（固定文と作画チェックのみ）',
    },
  },
  {
    pattern: /sdxl|stable-diffusion|animagine|anything|counterfeit|pony|illustrious/i,
    caps: {
      label: 'Stable Diffusion 系', refMode: 'single', refInput: 'image', maxRefs: 1,
      aspectInput: null, negative: true,
      note: 'image は img2img。negative_prompt が使える',
    },
  },
];

const UNKNOWN: ModelCaps = {
  label: '未登録のモデル', refMode: 'none', refInput: null, maxRefs: 0, aspectInput: 'aspect_ratio', negative: false,
  note: '台帳にないモデル。参照画像の入力名が分かれば環境変数 IMAGE_REF_INPUT=入力名[:枚数] で指定できる',
};

/** モデル名から能力を引く。環境変数で未登録モデルの参照入力を指定できる */
export function modelCaps(model: string): ModelCaps {
  const base = model.split(':')[0];
  const hit = REGISTRY.find((r) => r.pattern.test(base))?.caps ?? UNKNOWN;
  const override = process.env.IMAGE_REF_INPUT;
  if (hit === UNKNOWN && override) {
    const [key, n] = override.split(':');
    return { ...UNKNOWN, refMode: Number(n ?? 1) > 1 ? 'multi' : 'single', refInput: key, maxRefs: Number(n ?? 1), note: `環境変数 IMAGE_REF_INPUT で ${key} に ${n ?? 1} 枚渡す設定` };
  }
  return hit;
}

/** おすすめのモデル（画面の候補リストに出す） */
export const RECOMMENDED_MODELS = [
  { model: 'google/nano-banana', why: 'キャラ・背景の設定画を同時に渡せる。まずこれ' },
  { model: 'bytedance/seedream-4', why: '複数参照・高解像度' },
  { model: 'black-forest-labs/flux-kontext-max', why: '参照1枚。設定画セットの派生にも使う' },
  { model: 'black-forest-labs/flux-schnell', why: '安くて速いが設定画は渡せない（下書き用）' },
];

/** 望むアスペクト比を、そのモデルが受け付ける値に丸める */
export function nearestAspect(want: string, allowed?: string[]): string {
  if (!allowed?.length || allowed.includes(want)) return want;
  const ratio = (s: string) => { const [w, h] = s.split(':').map(Number); return w && h ? w / h : NaN; };
  const r = ratio(want);
  let best = allowed.find((a) => !Number.isNaN(ratio(a))) ?? allowed[0];
  for (const a of allowed) {
    const ra = ratio(a);
    if (Number.isNaN(ra)) continue;
    if (Math.abs(ra - r) < Math.abs(ratio(best) - r)) best = a;
  }
  return best;
}
