import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch, useAction } from '../hooks';

export function ProjectListPage() {
  const { data: projects, loading, reload } = useFetch(() => api.listProjects());
  const { busy, error, run } = useAction();
  const [title, setTitle] = useState('');
  const [synopsis, setSynopsis] = useState('');

  const create = () =>
    run('create', async () => {
      await api.createProject(title.trim(), synopsis.trim());
      setTitle('');
      setSynopsis('');
      reload();
    });

  return (
    <div>
      <h1>作品一覧</h1>
      {error && <div className="error-box">{error}</div>}

      <div className="card">
        <h3>新しい連載を始める</h3>
        <label>タイトル</label>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="作品タイトル" />
        <label>あらすじ</label>
        <textarea
          value={synopsis}
          onChange={(e) => setSynopsis(e.target.value)}
          placeholder="物語のあらすじを入力してください。ここからストーリー構成・キャラ・伏線を自動生成します。"
          rows={4}
        />
        <div style={{ marginTop: 10 }}>
          <button className="primary" disabled={!title.trim() || busy !== null} onClick={create}>
            {busy ? '作成中…' : '作品を作成'}
          </button>
        </div>
      </div>

      {loading && <p className="muted">読み込み中…</p>}
      {projects?.map((p) => (
        <div className="card" key={p.id}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <Link to={`/projects/${p.id}`} style={{ fontWeight: 700, fontSize: 16 }}>{p.title}</Link>
              <div className="muted">{p.synopsis.slice(0, 120) || 'あらすじ未設定'}</div>
            </div>
            <button
              className="danger"
              onClick={() => {
                if (confirm(`「${p.title}」を削除しますか?`)) {
                  api.deleteProject(p.id).then(reload);
                }
              }}
            >
              削除
            </button>
          </div>
        </div>
      ))}
      {projects && projects.length === 0 && !loading && (
        <p className="muted">まだ作品がありません。上のフォームから作成してください。</p>
      )}
    </div>
  );
}
