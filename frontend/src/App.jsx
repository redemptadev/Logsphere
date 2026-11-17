import { Suspense, lazy, useEffect, useState } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import api, { getSessionToken } from './api/client'
import Shell from './components/Shell'
import { AuthProvider } from './context/AuthContext'
import { useAuth } from './context/useAuth'
import './App.css'

const AuditPage = lazy(() => import('./pages/AuditPage'))
const DashboardPage = lazy(() => import('./pages/DashboardPage'))
const LogDetailsPage = lazy(() => import('./pages/LogDetailsPage'))
const LogsPage = lazy(() => import('./pages/LogsPage'))
const LoginPage = lazy(() => import('./pages/LoginPage'))
const ReportsPage = lazy(() => import('./pages/ReportsPage'))
const SettingsPage = lazy(() => import('./pages/SettingsPage'))
const UsersPage = lazy(() => import('./pages/UsersPage'))

function Application() {
  const { user, setSession } = useAuth()
  const navigate = useNavigate()
  const [page, setPage] = useState('Dashboard')
  const [detailId, setDetailId] = useState(null)
  const [checking, setChecking] = useState(Boolean(getSessionToken()))

  useEffect(() => {
    const token = getSessionToken()
    if (!token) return
    let active = true
    api.get('/auth/me').then(({ data }) => {
      if (active && !user) setSession(token, data.user, localStorage.getItem('logsphere-token') === token)
    }).catch(() => {
      if (active) {
        sessionStorage.removeItem('logsphere-token')
        sessionStorage.removeItem('logsphere-user')
        localStorage.removeItem('logsphere-token')
        localStorage.removeItem('logsphere-user')
      }
    }).finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [setSession, user])

  function login(token, nextUser, rememberMe) {
    setSession(token, nextUser, rememberMe)
    setPage('Dashboard')
    navigate('/app')
  }

  function changePage(nextPage) {
    setDetailId(null)
    setPage(nextPage)
  }

  function openLog(id) {
    setDetailId(id)
    setPage('Log Management')
  }

  if (checking) return <div className="loading-screen"><span className="loading-mark">◉</span><p>Connecting to LogSphere…</p></div>
  return <Suspense fallback={<div className="loading-screen"><span className="loading-mark">◉</span><p>Loading LogSphere…</p></div>}>
    <Routes>
      <Route path="/" element={user ? <Navigate to="/app" replace /> : <LoginPage onLogin={login} />} />
      <Route path="/app" element={user ? (
        <Shell page={page} setPage={changePage}>
          {page === 'Dashboard' && <DashboardPage setPage={changePage} openLog={openLog} />}
          {page === 'Log Management' && <LogsPage user={user} openLog={openLog} />}
          {page === 'Log Management' && detailId && <LogDetailsPage id={detailId} goBack={() => setDetailId(null)} />}
          {page === 'Reports' && <ReportsPage />}
          {page === 'Settings' && <SettingsPage user={user} setPage={changePage} />}
          {page === 'User Management' && user.role === 'admin' && <UsersPage user={user} />}
          {page === 'Audit History' && user.role === 'admin' && <AuditPage />}
        </Shell>
      ) : <Navigate to="/" replace />} />
      <Route path="*" element={<Navigate to={user ? '/app' : '/'} replace />} />
    </Routes>
  </Suspense>
}

export default function App() {
  return <BrowserRouter><AuthProvider><Application /></AuthProvider></BrowserRouter>
}
