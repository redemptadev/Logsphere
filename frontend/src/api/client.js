import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:5000/api',
})

api.interceptors.request.use((config) => {
  const token = sessionStorage.getItem('logsphere-token') || localStorage.getItem('logsphere-token')
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})

api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      sessionStorage.removeItem('logsphere-token')
      sessionStorage.removeItem('logsphere-user')
      localStorage.removeItem('logsphere-token')
      localStorage.removeItem('logsphere-user')
      if (window.location.pathname !== '/') window.location.assign('/')
    }
    return Promise.reject(error)
  },
)

export default api

export function getSessionToken() {
  return sessionStorage.getItem('logsphere-token') || localStorage.getItem('logsphere-token')
}

export function getErrorMessage(error) {
  return error.response?.data?.error || error.message || 'The request could not be completed.'
}
