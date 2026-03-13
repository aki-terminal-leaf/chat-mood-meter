import { Outlet, NavLink } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import './Layout.css';

export default function Layout() {
  const { user, logout } = useAuth();

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="logo">🎭 CMM</div>

        <div className="nav-links">
          <NavLink to="/dashboard" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            📊 Dashboard
          </NavLink>
          <NavLink to="/settings" className={({ isActive }) => isActive ? 'nav-link active' : 'nav-link'}>
            ⚙️ Settings
          </NavLink>
        </div>

        <div className="user-info">
          {user?.avatarUrl && (
            <img src={user.avatarUrl} alt={user.displayName ?? user.username} className="avatar" />
          )}
          <span className="username">{user?.displayName ?? user?.username}</span>
          <button onClick={logout} className="logout-btn">Logout</button>
        </div>
      </nav>

      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
