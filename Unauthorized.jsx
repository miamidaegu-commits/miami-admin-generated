// src/pages/Unauthorized.jsx
import { signOut } from 'firebase/auth'
import { useNavigate } from 'react-router-dom'
import { auth } from './firebase'
import { useTranslation } from './src/i18n/LocalizationProvider.jsx'

export default function Unauthorized() {
  const navigate = useNavigate()
  const { t } = useTranslation()

  async function handleSignOut() {
    await signOut(auth)
    navigate('/login')
  }

  return (
    <div className="login-page">
      <div className="login-card" style={{ textAlign: 'center' }}>
        <div className="login-header">
          <div className="login-icon" style={{ color: 'var(--danger)' }}>⊘</div>
          <h1>{t('unauthorized.title')}</h1>
          <p>{t('unauthorized.body')}</p>
          <p style={{ marginTop: '0.25rem', fontSize: '0.8rem', opacity: 0.5 }}>
            {t('unauthorized.help')}
          </p>
        </div>
        <button className="btn-primary" onClick={handleSignOut} style={{ marginTop: '1.5rem' }}>
          {t('common.logout')}
        </button>
      </div>
    </div>
  )
}
