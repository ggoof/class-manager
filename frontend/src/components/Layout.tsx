import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import type { Role } from '@cm/shared';
import { useAuth } from '../lib/auth';

const NAV: Record<Role, { to: string; label: string }[]> = {
  ADMIN: [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/users', label: 'Users' },
    { to: '/admin/classes', label: 'Classes' },
    { to: '/admin/requests', label: 'Change requests' },
    { to: '/admin/database', label: 'Database' },
  ],
  TEACHER: [
    { to: '/teacher', label: 'My schedule' },
    { to: '/teacher/classes', label: 'My classes' },
    { to: '/teacher/requests', label: 'Change requests' },
  ],
  STUDENT: [
    { to: '/student', label: 'My schedule' },
    { to: '/student/catalog', label: 'Find a class' },
    { to: '/student/teachers', label: 'Teachers' },
    { to: '/student/classes', label: 'My classes' },
    { to: '/student/attendance', label: 'My attendance' },
  ],
};

export function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  if (!user) return null;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">
          Class Manager
          <small>{user.role.toLowerCase()} console</small>
        </div>

        <nav className="nav">
          {NAV[user.role].map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              // `end` keeps the index route from staying highlighted on children.
              end={item.to === `/${user.role.toLowerCase()}`}
              className={({ isActive }) => (isActive ? 'active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
          <NavLink to="/profile" className={({ isActive }) => (isActive ? 'active' : '')}>
            My profile
          </NavLink>
        </nav>

        <div className="sidebar-foot">
          <div className="who">
            <strong>{user.realName}</strong>
            {user.username}
          </div>
          <button
            className="small"
            onClick={() => {
              signOut();
              navigate('/login');
            }}
          >
            Sign out
          </button>
        </div>
      </aside>

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
