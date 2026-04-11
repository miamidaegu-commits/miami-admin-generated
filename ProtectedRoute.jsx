import { Navigate } from 'react-router-dom'
import { useAuth } from './AuthContext'

export default function ProtectedRoute({
  children,
  allowedRoles = ['admin', 'teacher'],
}) {
  const { user, role, loading } = useAuth()
  
  console.log('[ProtectedRoute]', {
    user: user?.email,
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