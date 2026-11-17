import { useState } from 'react'
import api, { getErrorMessage } from '../api/client'

export default function LoginPage({ onLogin }) {
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({})
  const [showPassword, setShowPassword] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [rememberMe, setRememberMe] = useState(false)
  const change = (event) => setForm({ ...form, [event.target.name]: event.target.value })

  async function submit(event) {
    event.preventDefault()
    setError('')
    setMessage('')
    setBusy(true)
    try {
      if (mode === 'login') {
        const { data } = await api.post('/auth/login', { identifier: form.identifier, password: form.password })
        onLogin(data.token, data.user, rememberMe)
      } else if (mode === 'register') {
        const { data } = await api.post('/auth/register', {
          full_name: form.full_name, email: form.email, username: form.username,
          password: form.password, confirm_password: form.confirm_password,
        })
        setMessage(data.message)
        setMode('verify')
      } else if (mode === 'verify') {
        const { data } = await api.post('/auth/verify-email', { email: form.email, code: form.code })
        setMessage(data.message)
        setMode('login')
      } else if (mode === 'forgot') {
        const { data } = await api.post('/auth/forgot-password', { email: form.email })
        setMessage(data.message)
        setMode('reset-password')
      } else {
        if (form.password !== form.confirm_password) throw new Error('Passwords do not match.')
        const { data } = await api.post('/auth/reset-password', { email: form.email, code: form.code, password: form.password })
        setMessage(data.message)
        setMode('login')
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    } finally { setBusy(false) }
  }

  async function resendVerification() {
    setError('')
    setMessage('')
    try {
      const { data } = await api.post('/auth/resend-verification', { email: form.email })
      setMessage(data.message)
    } catch (requestError) {
      setError(getErrorMessage(requestError))
    }
  }

  return (
    <div className="login-page">
      <section className="login-hero">
        <div className="server-art" aria-hidden="true"><div className="server server-one" /><div className="server server-two" /><div className="server server-three" /></div>
        <div className="hero-content">
          <div className="logo-symbol"><span>▤</span><i>⌕</i></div>
          <h1>Log<span>Sphere</span></h1>
          <p className="tagline">Monitor · Analyse · Stay Informed</p>
        </div>
        <div className="hero-caption"><strong>Nairobi Tech Hub</strong><span>Server Log Management System</span></div>
      </section>
      <section className="login-panel">
        <div className="login-form-wrap">
          <h2>{mode === 'login' ? 'Welcome Back' : mode === 'register' ? 'Create Account' : mode === 'verify' ? 'Verify Email' : mode === 'forgot' ? 'Forgot Password?' : 'Reset Password'}</h2>
          <p className="form-subtitle">{mode === 'login' ? 'Sign in to continue to LogSphere' : mode === 'register' ? 'Register for secure access to LogSphere' : mode === 'verify' ? 'Enter the verification code sent to your email' : mode === 'forgot' ? 'We’ll email a secure reset code if your account exists' : 'Enter the code and choose a new password'}</p>
          {message && <div className="form-message success">{message}</div>}
          {error && <div className="form-message error">{error}</div>}
          <form onSubmit={submit}>
            {mode === 'register' && <>
              <label className="input-wrap"><span>♙</span><input name="full_name" placeholder="Full name" autoComplete="name" required onChange={change} /></label>
              <label className="input-wrap"><span>✉</span><input name="email" placeholder="Email address" type="email" autoComplete="email" required onChange={change} /></label>
              <label className="input-wrap"><span>＠</span><input name="username" placeholder="Username" autoComplete="username" required onChange={change} /></label>
            </>}
            {(mode === 'verify' || mode === 'forgot' || mode === 'reset-password') && <>
              <label className="input-wrap"><span>✉</span><input name="email" placeholder="Email address" type="email" required onChange={change} /></label>
              {(mode === 'verify' || mode === 'reset-password') && <label className="input-wrap"><span>⌑</span><input name="code" placeholder="6-digit verification code" inputMode="numeric" required onChange={change} /></label>}
            </>}
            {mode === 'verify' && <button className="resend-code" type="button" onClick={resendVerification}>Resend verification code</button>}
            {mode === 'login' && <label className="input-wrap"><span>♙</span><input name="identifier" placeholder="Email or Username" autoComplete="username" required onChange={change} /></label>}
            {(mode === 'login' || mode === 'register' || mode === 'reset-password') && <>
              <label className="input-wrap"><span>♙</span><input name="password" placeholder={mode === 'login' ? 'Password' : 'New password'} type={showPassword ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required onChange={change} /><button className="input-action" type="button" onClick={() => setShowPassword(!showPassword)} aria-label="Toggle password visibility">{showPassword ? '◉' : '⊘'}</button></label>
              {(mode === 'register' || mode === 'reset-password') && <label className="input-wrap"><span>♙</span><input name="confirm_password" placeholder="Confirm password" type="password" autoComplete="new-password" required onChange={change} /></label>}
            </>}
            {mode === 'login' && <div className="login-options"><label><input type="checkbox" checked={rememberMe} onChange={(event) => setRememberMe(event.target.checked)} /> Remember Me</label><button type="button" onClick={() => { setMode('forgot'); setError(''); setMessage('') }}>Forgot Password?</button></div>}
            <button className="primary-button login-submit" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Login' : mode === 'register' ? 'Create Account' : mode === 'verify' ? 'Verify Email' : mode === 'forgot' ? 'Send Reset Code' : 'Reset Password'}</button>
          </form>
          <p className="switch-mode">{mode === 'login' ? 'New to LogSphere?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setMessage('') }}>{mode === 'login' ? 'Create account' : 'Sign in'}</button>{mode === 'login' && <> <span>·</span> <button onClick={() => { setMode('verify'); setError(''); setMessage('') }}>Verify account</button></>}</p>
          <div className="secure-note"><span>Secure Access</span><b>•</b><span>Trusted Monitoring</span></div>
        </div>
      </section>
    </div>
  )
}
