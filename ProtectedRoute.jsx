import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'
import { debugLog } from './src/utils/debugLog.js'

export default function ProtectedRoute({
  children,
  allowedRoles = ['admin', 'teacher'],
}) {
  const { user, role, loading } = useAuth()
  
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
      </div>
    )
  }

  if (!user) return <Navigate to="/" replace />

  if (!allowedRoles.includes(role)) {
    return <Navigate to="/unauthorized" replace />
  }

  return children
}
