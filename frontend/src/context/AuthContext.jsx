import { useMemo, useState } from 'react'
import { AuthContext } from './authContextValue'

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem('logsphere-user') || localStorage.getItem('logsphere-user') || 'null') } catch { return null }
  })

  const value = useMemo(() => ({
    user,
    setSession(token, nextUser, remember = false) {
      const storage = remember ? localStorage : sessionStorage
      const otherStorage = remember ? sessionStorage : localStorage
      otherStorage.removeItem('logsphere-token')
      otherStorage.removeItem('logsphere-user')
      storage.setItem('logsphere-token', token)
      storage.setItem('logsphere-user', JSON.stringify({ ...nextUser, rememberMe: undefined }))
      setUser(nextUser)
    },
    logout() {
      sessionStorage.removeItem('logsphere-token')
      sessionStorage.removeItem('logsphere-user')
      localStorage.removeItem('logsphere-token')
      localStorage.removeItem('logsphere-user')
      setUser(null)
    },
  }), [user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
