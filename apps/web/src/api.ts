import type {
  ArtStyle, Background, Character, Discussion, DiscussionMessage, Episode,
  Foreshadowing, ForeshadowWarning, Job, LoraTargetKind, LoraTraining,
  Panel, Project, RefImage, RefImageKind, Worldview,
} from '@manga/shared';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!res.ok) {
    let message = `APIエラー (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* JSONでないエラーはそのまま */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });
const put = <T>(path: string, body: unknown) =>
  request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
const del = <T>(path: string) => request<T>(path, { method: 'DELETE' });

export type EpisodeWithPanels = Episode & { panels: Panel[] };
export type DiscussionWithMessages = Discussion & { messages: DiscussionMessage[] };
/** 議論の開始・介入は非同期実行。進捗追跡用の job が一緒に返る */
export type DiscussionStart = { discussion: Discussion; job: Job };
export type LoraStart = { job: Job; training: LoraTraining };
export type AssetType = 'character' | 'worldview' | 'art_style' | 'background';

export const api = {
  // プロジェクト
  listProjects: () => get<Project[]>('/projects'),
  createProject: (title: string, synopsis: string) => post<Project>('/projects', { title, synopsis }),
  getProject: (id: number) => get<Project>(`/projects/${id}`),
  updateProject: (id: number, body: Partial<Project>) => put<Project>(`/projects/${id}`, body),
  deleteProject: (id: number) => del<{ ok: true }>(`/projects/${id}`),

  // 生成
  generateStructure: (projectId: number, episodeCount: number) =>
    post<{ episodes: Episode[]; foreshadowings: Foreshadowing[] }>(
      `/projects/${projectId}/generate/structure`, { episodeCount }),
  generateCharacters: (projectId: number) => post<Character[]>(`/projects/${projectId}/generate/characters`),
  generatePanels: (episodeId: number) => post<Panel[]>(`/episodes/${episodeId}/generate/panels`),
  /** 一括作画は非同期。Job を返すので進捗はポーリングで追う */
  generateEpisodeImages: (episodeId: number) => post<Job>(`/episodes/${episodeId}/generate/images`),
  generatePanelImage: (panelId: number) => post<Panel>(`/panels/${panelId}/generate-image`),

  // エピソード / パネル
  listEpisodes: (projectId: number) => get<Episode[]>(`/projects/${projectId}/episodes`),
  getEpisode: (id: number) => get<EpisodeWithPanels>(`/episodes/${id}`),
  updateEpisode: (id: number, body: Partial<Episode>) => put<Episode>(`/episodes/${id}`, body),
  updatePanel: (id: number, body: Partial<Panel>) => put<Panel>(`/panels/${id}`, body),

  // キャラクター
  listCharacters: (projectId: number) => get<Character[]>(`/projects/${projectId}/characters`),
  createCharacter: (projectId: number, body: Partial<Character>) =>
    post<Character>(`/projects/${projectId}/characters`, body),
  updateCharacter: (id: number, body: Partial<Character>) => put<Character>(`/characters/${id}`, body),
  deleteCharacter: (id: number) => del<{ ok: true }>(`/characters/${id}`),

  // 伏線
  listForeshadowings: (projectId: number) => get<Foreshadowing[]>(`/projects/${projectId}/foreshadowings`),
  foreshadowWarnings: (projectId: number) => get<ForeshadowWarning[]>(`/projects/${projectId}/foreshadow-warnings`),
  foreshadowSync: (projectId: number) => post<Foreshadowing[]>(`/projects/${projectId}/foreshadow-sync`),
  createForeshadowing: (projectId: number, body: Partial<Foreshadowing>) =>
    post<Foreshadowing>(`/projects/${projectId}/foreshadowings`, body),
  updateForeshadowing: (id: number, body: Partial<Foreshadowing>) =>
    put<Foreshadowing>(`/foreshadowings/${id}`, body),
  deleteForeshadowing: (id: number) => del<{ ok: true }>(`/foreshadowings/${id}`),

  // AI議論
  listDiscussions: (projectId: number) => get<Discussion[]>(`/projects/${projectId}/discussions`),
  startDiscussion: (projectId: number, topic: string) =>
    post<DiscussionStart>(`/projects/${projectId}/discussions`, { topic }),
  getDiscussion: (id: number) => get<DiscussionWithMessages>(`/discussions/${id}`),
  intervene: (id: number, comment: string) =>
    post<DiscussionStart>(`/discussions/${id}/intervene`, { comment }),
  decide: (id: number, adopted: boolean, applyToStructure: boolean) =>
    post<Discussion>(`/discussions/${id}/decision`, { adopted, applyToStructure }),

  // 変更指示（拡張5）
  applyChange: (projectId: number, instruction: string) =>
    post<{ episodes: Episode[]; foreshadowings: Foreshadowing[] }>(
      `/projects/${projectId}/apply-change`, { instruction }),

  // 画風 / 世界観
  listArtStyles: (projectId: number) => get<ArtStyle[]>(`/projects/${projectId}/art-styles`),
  createArtStyle: (projectId: number, body: Partial<ArtStyle>) =>
    post<ArtStyle>(`/projects/${projectId}/art-styles`, body),
  updateArtStyle: (id: number, body: Partial<ArtStyle>) => put<ArtStyle>(`/art-styles/${id}`, body),
  listWorldviews: (projectId: number) => get<Worldview[]>(`/projects/${projectId}/worldviews`),
  createWorldview: (projectId: number, body: Partial<Worldview>) =>
    post<Worldview>(`/projects/${projectId}/worldviews`, body),

  // アセットライブラリ（拡張4）
  listAssets: <T>(type: AssetType) => get<T[]>(`/assets/${type}`),
  saveAsset: (type: AssetType, itemId: number) => post<unknown>(`/assets/${type}/save/${itemId}`),
  castAsset: (projectId: number, type: AssetType, assetId: number) =>
    post<unknown>(`/projects/${projectId}/cast/${type}/${assetId}`),

  // ジョブ（非同期処理の進捗）
  getJob: (id: number) => get<Job>(`/jobs/${id}`),
  listJobs: (projectId: number) => get<Job[]>(`/projects/${projectId}/jobs`),
  listActiveJobs: (projectId: number) => get<Job[]>(`/projects/${projectId}/jobs/active`),

  // 背景（背景・ロケーションの一貫性）
  listBackgrounds: (projectId: number) => get<Background[]>(`/projects/${projectId}/backgrounds`),
  createBackground: (projectId: number, body: Partial<Background>) =>
    post<Background>(`/projects/${projectId}/backgrounds`, body),
  updateBackground: (id: number, body: Partial<Background>) => put<Background>(`/backgrounds/${id}`, body),
  deleteBackground: (id: number) => del<{ ok: true }>(`/backgrounds/${id}`),

  // 参照画像（一貫性アセットの候補画像）
  listRefImages: (kind: RefImageKind, ownerId: number) =>
    get<RefImage[]>(`/ref-images/${kind}/${ownerId}`),
  generateRefImages: (
    projectId: number, kind: RefImageKind, ownerId: number, count: number, prompt?: string,
  ) => post<Job>(`/projects/${projectId}/ref-images/${kind}/${ownerId}/generate`, { count, prompt }),
  generateRefVariations: (
    projectId: number, kind: RefImageKind, ownerId: number, count: number,
  ) => post<Job>(`/projects/${projectId}/ref-images/${kind}/${ownerId}/variations`, { count }),
  selectRefImage: (id: number) => post<RefImage>(`/ref-images/${id}/select`),
  deleteRefImage: (id: number) => del<{ ok: true }>(`/ref-images/${id}`),

  // LoRA学習
  listLoraTrainings: (projectId: number) => get<LoraTraining[]>(`/projects/${projectId}/lora-trainings`),
  validateLora: (projectId: number, body: Record<string, unknown>) =>
    post<{ problems: string[]; defaults: { trainerModel: string; destination: string } }>(
      `/projects/${projectId}/lora-trainings/validate`, body),
  startLoraTraining: (
    projectId: number,
    body: {
      targetKind: LoraTargetKind; targetId: number; imageUrls: string[]; triggerWord: string;
      steps?: number; loraRank?: number; trainerModel?: string; destination?: string;
    },
  ) => post<LoraStart>(`/projects/${projectId}/lora-trainings`, body),
  cancelLoraTraining: (id: number) => post<LoraTraining>(`/lora-trainings/${id}/cancel`),
};
