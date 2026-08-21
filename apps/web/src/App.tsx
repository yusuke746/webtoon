import { NavLink, Navigate, Route, Routes, useParams } from 'react-router-dom';
import { api } from './api';
import { useFetch } from './hooks';
import { ProjectListPage } from './pages/ProjectListPage';
import { ProjectPage } from './pages/ProjectPage';
import { EpisodeSelectPage } from './pages/EpisodeSelectPage';
import { EpisodeScenesPage } from './pages/EpisodeScenesPage';
import { EpisodePanelsPage } from './pages/EpisodePanelsPage';
import { EpisodeArtPage } from './pages/EpisodeArtPage';
import { CharactersPage } from './pages/CharactersPage';
import { BackgroundsPage } from './pages/BackgroundsPage';
import { ForeshadowPage } from './pages/ForeshadowPage';
import { DiscussionsPage } from './pages/DiscussionsPage';
import { AssetsPage } from './pages/AssetsPage';
import { SettingsPage } from './pages/SettingsPage';

/**
 * サイドバー。
 * 「制作」「設定・素材」「相談」でグループを分け、
 * 毎回通る導線（制作フロー）を最上位に置いて迷いを減らしている。
 */
function Sidebar() {
  const { projectId } = useParams();
  const { data: project } = useFetch(
    () => (projectId ? api.getProject(Number(projectId)) : Promise.resolve(null)),
    [projectId],
  );

  return (
    <nav className="sidebar">
      <div className="brand">AI漫画スタジオ</div>
      <div className="brand-sub">連載対応・伏線回収エンジン搭載</div>

      <NavLink to="/" end><span className="ico">📚</span>作品一覧</NavLink>
      <NavLink to="/assets"><span className="ico">🗂</span>アセットライブラリ</NavLink>

      {projectId && (
        <>
          <div className="section">この作品</div>
          {project && <div className="project-chip">{project.title}</div>}
          <NavLink to={`/projects/${projectId}`} end><span className="ico">🏠</span>ダッシュボード</NavLink>

          <div className="section">制作</div>
          <NavLink to={`/projects/${projectId}/episodes`}><span className="ico">🎬</span>制作フロー</NavLink>

          <div className="section">一貫性アセット</div>
          <NavLink to={`/projects/${projectId}/characters`}><span className="ico">👤</span>キャラクター</NavLink>
          <NavLink to={`/projects/${projectId}/backgrounds`}><span className="ico">🏞</span>背景・ロケーション</NavLink>
          <NavLink to={`/projects/${projectId}/settings`}><span className="ico">🎨</span>画風・カスタマイズ</NavLink>

          <div className="section">検討・管理</div>
          <NavLink to={`/projects/${projectId}/foreshadow`}><span className="ico">🧩</span>伏線ボード</NavLink>
          <NavLink to={`/projects/${projectId}/discussions`}><span className="ico">💬</span>AI編集会議</NavLink>
        </>
      )}
    </nav>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="layout">
      <Sidebar />
      <main className="main">{children}</main>
    </div>
  );
}

/** 旧URL（/episodes/:id）からシーン構成ステップへ寄せる */
function LegacyEpisodeRedirect() {
  const { projectId, episodeId } = useParams();
  return <Navigate to={`/projects/${projectId}/episodes/${episodeId}/scenes`} replace />;
}

export function App() {
  const page = (element: React.ReactNode) => <Layout>{element}</Layout>;

  return (
    <Routes>
      <Route path="/" element={page(<ProjectListPage />)} />
      <Route path="/assets" element={page(<AssetsPage />)} />

      <Route path="/projects/:projectId" element={page(<ProjectPage />)} />
      <Route path="/projects/:projectId/characters" element={page(<CharactersPage />)} />
      <Route path="/projects/:projectId/backgrounds" element={page(<BackgroundsPage />)} />
      <Route path="/projects/:projectId/foreshadow" element={page(<ForeshadowPage />)} />
      <Route path="/projects/:projectId/discussions" element={page(<DiscussionsPage />)} />
      <Route path="/projects/:projectId/settings" element={page(<SettingsPage />)} />

      {/* 制作フロー: エピソード選択 → シーン構成 → ネーム生成 → 作画 */}
      <Route path="/projects/:projectId/episodes" element={page(<EpisodeSelectPage />)} />
      <Route path="/projects/:projectId/episodes/:episodeId" element={<LegacyEpisodeRedirect />} />
      <Route path="/projects/:projectId/episodes/:episodeId/scenes" element={page(<EpisodeScenesPage />)} />
      <Route path="/projects/:projectId/episodes/:episodeId/panels" element={page(<EpisodePanelsPage />)} />
      <Route path="/projects/:projectId/episodes/:episodeId/art" element={page(<EpisodeArtPage />)} />

      <Route path="*" element={page(
        <div className="empty-state">
          <div className="big">🧭</div>
          ページが見つかりません。
        </div>,
      )} />
    </Routes>
  );
}
