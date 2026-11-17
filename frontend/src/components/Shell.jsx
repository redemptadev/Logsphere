import { useState } from 'react'
import { useAuth } from '../context/useAuth'

const navigation = [
  { id: 'Dashboard', icon: '⌂' },
  { id: 'Log Management', icon: '▤' },
  { id: 'Reports', icon: '▧' },
  { id: 'Settings', icon: '⚙' },
]

export default function Shell({ page, setPage, children }) {
  const { user, logout } = useAuth()
  const [profileOpen, setProfileOpen] = useState(false)
  const visibleNav = user?.role === 'admin'
    ? [...navigation, { id: 'User Management', icon: '♙' }, { id: 'Audit History', icon: '◷' }]
    : navigation
  const title = page === 'Log Details' ? 'Log Management' : page
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark">◉</span><span>LogSphere</span></div>
        <nav className="side-nav">
          {visibleNav.map((item) => (
            <button key={item.id} className={title === item.id ? 'nav-item active' : 'nav-item'} onClick={() => setPage(item.id)}>
              <span className="nav-icon">{item.icon}</span>{item.id}
            </button>
          ))}
          <button className="nav-item logout" onClick={() => logout()}><span className="nav-icon">⇥</span>Logout</button>
        </nav>
        <div className="sidebar-footer"><span className="online-dot" /> System operational</div>
      </aside>
      <main className="main-area">
        <header className="topbar">
          <span className="topbar-note">Nairobi Tech Hub · Server Log Management System</span>
          <div className="top-actions">
            <button className="icon-button notification" aria-label="Open log activity" onClick={() => setPage('Log Management')}>♧<span /></button>
            <button className="profile-button" onClick={() => setProfileOpen(!profileOpen)}>
              <span className="avatar">{(user?.full_name || 'U').split(' ').map((part) => part[0]).slice(0, 2).join('').toUpperCase()}</span>
              <span className="profile-text"><strong>{user?.full_name || user?.username}</strong><small>{user?.role}</small></span><span className="chevron">⌄</span>
            </button>
            {profileOpen && <div className="profile-menu"><b>{user?.email}</b><button onClick={() => { setPage('Settings'); setProfileOpen(false) }}>Account settings</button><button onClick={() => logout()}>Sign out</button></div>}
          </div>
        </header>
        <div className="page-content">{children}</div>
      </main>
    </div>
  )
}
