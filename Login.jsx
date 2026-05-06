// src/pages/Login.jsx
import { useEffect, useState } from 'react'
import { signInWithEmailAndPassword } from 'firebase/auth'
import { Link, useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { useAuth } from './AuthContext'

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
        return 'Invalid email or password.'
      case 'auth/too-many-requests':
        return 'Too many attempts. Try again later.'
      default:
        return 'Sign-in failed. Please try again.'
    }
  }

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-header">
          <div className="login-icon">⬡</div>
          <h1>마이애미 영어회화</h1>
          <p>수업 관리와 예약을 위해 로그인하세요.</p>
          <Link className="login-public-link" to="/classes">
            수업 소개 보기
          </Link>
        </div>

        <form onSubmit={handleSubmit} className="login-form">
          <div className="field">
            <label htmlFor="email">이메일</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="email@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="field">
            <label htmlFor="password">비밀번호</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="error-msg">{error}</p>}

          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '로그인 중…' : '로그인'}
          </button>
        </form>
      </div>
    </div>
  )
}
