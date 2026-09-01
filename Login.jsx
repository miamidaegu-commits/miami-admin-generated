// src/pages/Login.jsx
import { useEffect, useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { useAuth } from './AuthContext'
import { useTranslation } from './src/i18n/LocalizationProvider.jsx'

function getDefaultRouteForRole(role) {
  if (role === 'student') return '/student-booking'
  if (role === 'admin' || role === 'teacher') return '/dashboard'
  return null
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()
  const { user, role, loading: authLoading } = useAuth()
  const { language, setLanguage, t } = useTranslation()

  useEffect(() => {
    if (authLoading || !user) return
    const nextPath = getDefaultRouteForRole(role)
    if (nextPath) navigate(nextPath, { replace: true })
  }, [authLoading, navigate, role, user])

  async function handleSubmit(e) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signInWithEmailAndPassword(auth, email, password)
    } catch (err) {
      setError(getFriendlyError(err.code))
    } finally {
      setLoading(false)
    }
  }

  function getFriendlyError(code) {
    switch (code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        return t('login.error.invalidCredentials')
      case 'auth/too-many-requests':
        return t('login.error.tooManyRequests')
      default:
        return t('login.error.generic')
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div
          className="login-language-selector"
          role="group"
          aria-label={t('settings.language')}
          data-testid="login-language-selector"
        >
          {['ko', 'en'].map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={language === option}
              className={language === option ? 'selected' : ''}
              onClick={() => setLanguage(option, { syncAccount: false })}
            >
              {t(`settings.language.${option}`)}
            </button>
          ))}
        </div>
        <div className="login-header">
          <div className="login-icon">⬡</div>
          <h1>{t('login.title')}</h1>
          <p>{t('login.subtitle')}</p>
          <Link className="login-public-link" to="/classes">
            {t('login.publicClasses')}
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label htmlFor="email">{t('login.email')}</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder={t('login.emailPlaceholder')}
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">{t('login.password')}</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder={t('login.passwordPlaceholder')}
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? t('login.submitting') : t('login.submit')}
          </button>
        </form>
      </div>
    </div>
  )
}
