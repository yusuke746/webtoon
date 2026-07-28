import { NavLink, Route, Routes, useParams } from 'react-router-dom';
import { ProjectListPage } from './pages/ProjectListPage';
import { ProjectPage } from './pages/ProjectPage';
import { EpisodePage } from './pages/EpisodePage';
import { CharactersPage } from './pages/CharactersPage';
import { ForeshadowPage } from './pages/ForeshadowPage';
import { DiscussionsPage } from './pages/DiscussionsPage';
import { AssetsPage } from './pages/AssetsPage';
import { SettingsPage } from './pages/SettingsPage';

function Sidebar() {
  const { projectId } = useParams();
  return (
    <nav className="sidebar">
      <div className="brand">AI漫画スタジオ</div>
      <NavLink to="/" end>作品一覧</NavLink>
      <NavLink to="/assets">アセットライブラリ</NavLink>
      {projectId && (
        <>
          <div className="section">この作品</div>
          <NavLink to={`/projects/${projectId}`} end>ダッシュボード</NavLink>
          <NavLink to={`/projects/${projectId}/characters`}>キャラクター</NavLink>
          <NavLink to={`/projects/${projectId}/foreshadow`}>伏線ボード</NavLink>
          <NavLink to={`/projects/${projectId}/discussions`}>AI編集会議</NavLink>
          <NavLink to={`/projects/${projectId}/settings`}>カスタマイズ</NavLink>
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

export function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout><ProjectListPage /></Layout>} />
      <Route path="/assets" element={<Layout><AssetsPage /></Layout>} />
      <Route path="/projects/:projectId" element={<Layout><ProjectPage /></Layout>} />
      <Route path="/projects/:projectId/characters" element={<Layout><CharactersPage /></Layout>} />
      <Route path="/projects/:projectId/foreshadow" element={<Layout><ForeshadowPage /></Layout>} />
      <Route path="/projects/:projectId/discussions" element={<Layout><DiscussionsPage /></Layout>} />
      <Route path="/projects/:projectId/settings" element={<Layout><SettingsPage /></Layout>} />
      <Route path="/projects/:projectId/episodes/:episodeId" element={<Layout><EpisodePage /></Layout>} />
    </Routes>
  );
}
