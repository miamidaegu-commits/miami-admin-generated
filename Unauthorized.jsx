// src/pages/Unauthorized.jsx
import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'

export default function Unauthorized() {
  const navigate = useNavigate()

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div className="login-header">
          <div className="login-icon" style={{ color: 'var(--danger)' }}>⊘</div>
          <h1>Access Denied</h1>
          <p>Your account does not have admin privileges.</p>
          <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', opacity: 0.5 }}>
            Contact your administrator if you think this is a mistake.
          </p>
        </div>
        <button className="btn-primary" onClick={handleSignOut} style={{ marginTop: '1.5rem' }}>
          Sign Out
        </button>
      </div>
    </div>
  )
}
