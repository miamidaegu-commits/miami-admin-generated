import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { debugLog } from './src/utils/debugLog.js'
import { useTranslation } from './src/i18n/LocalizationProvider.jsx'

export default function ProtectedRoute({
  children,
  allowedRoles = ['admin', 'teacher'],
}) {
  const { user, role, loading } = useAuth()
  const { t } = useTranslation()
  
  debugLog('[ProtectedRoute]', {
    hasUser: Boolean(user),
    role,
    loading,
    allowedRoles,
  })

  if (loading) {
    return (
      <div className="loader-wrap">
        <div className="loader" />
        <span className="sr-only">{t('common.loading')}</span>
      </div>
    )
  }

  if (!user) return <Navigate to="/" replace />

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
