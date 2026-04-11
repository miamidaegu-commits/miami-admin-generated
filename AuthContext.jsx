// src/context/AuthContext.jsx
import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

const AuthContext = createContext(null)

const emptyState = {
  user: null,
  role: null,
  loading: true,
  isAdmin: false,
  isActive: false,
  teacherName: '',
  canAddStudent: false,
  canEditLesson: false,
  canDeleteLesson: false,
  canManageAttendance: false,
  canEditStudent: false,
  canDeleteStudent: false,
  canCreateLessonDirectly: false,
  requiresLessonApproval: false,
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(emptyState.user)
  const [role, setRole] = useState(emptyState.role)
  const [loading, setLoading] = useState(emptyState.loading)
  const [isAdmin, setIsAdmin] = useState(emptyState.isAdmin)
  const [isActive, setIsActive] = useState(emptyState.isActive)
  const [teacherName, setTeacherName] = useState(emptyState.teacherName)
  const [canAddStudent, setCanAddStudent] = useState(emptyState.canAddStudent)
  const [canEditLesson, setCanEditLesson] = useState(emptyState.canEditLesson)
  const [canDeleteLesson, setCanDeleteLesson] = useState(emptyState.canDeleteLesson)
  const [canManageAttendance, setCanManageAttendance] = useState(emptyState.canManageAttendance)
  const [canEditStudent, setCanEditStudent] = useState(emptyState.canEditStudent)
  const [canDeleteStudent, setCanDeleteStudent] = useState(emptyState.canDeleteStudent)
  const [canCreateLessonDirectly, setCanCreateLessonDirectly] = useState(emptyState.canCreateLessonDirectly)
  const [requiresLessonApproval, setRequiresLessonApproval] = useState(emptyState.requiresLessonApproval)

  const resetSession = () => {
    setUser(null)
    setRole(null)
    setIsAdmin(false)
    setIsActive(false)
    setTeacherName('')
    setCanAddStudent(false)
    setCanEditLesson(false)
    setCanDeleteLesson(false)
    setCanManageAttendance(false)
    setCanEditStudent(false)
    setCanDeleteStudent(false)
    setCanCreateLessonDirectly(false)
    setRequiresLessonApproval(false)
  }

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setLoading(true)

      if (!firebaseUser) {
        resetSession()
        setLoading(false)
        return
      }

      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))

        if (!snap.exists()) {
          console.warn('[AuthContext] users/{uid} 문서가 없습니다:', firebaseUser.uid)
          resetSession()
          await signOut(auth)
          setLoading(false)
          return
        }

        const data = snap.data() || {}
        const active = data.isActive === true
        const nextRole = data.role ?? null
        const admin = active && nextRole === 'admin'
        const normalizedTeacherName =
          typeof data.teacherName === 'string'
            ? data.teacherName.trim().toLowerCase()
            : ''

        console.log('[AuthContext] uid=', firebaseUser.uid)
        console.log('[AuthContext] email=', firebaseUser.email)
        console.log('[AuthContext] role=', nextRole)
        console.log('[AuthContext] rawTeacherName=', data.teacherName ?? null)
        console.log('[AuthContext] normalizedTeacherName=', normalizedTeacherName)
        console.log('[AuthContext] isActive=', active)

        if (!active) {
          console.warn('[AuthContext] 비활성 계정입니다. 자동 로그아웃합니다.')
          resetSession()
          await signOut(auth)
          setLoading(false)
          return
        }

        setUser(firebaseUser)
        setRole(nextRole)
        setIsAdmin(admin)
        setIsActive(active)
        setTeacherName(normalizedTeacherName)

        setCanAddStudent(admin || data.canAddStudent === true)
        setCanEditLesson(admin || data.canEditLesson === true)
        setCanDeleteLesson(admin || data.canDeleteLesson === true)
        setCanManageAttendance(admin || data.canManageAttendance === true)
        setCanEditStudent(admin || data.canEditStudent === true)
        setCanDeleteStudent(admin || data.canDeleteStudent === true)
        setCanCreateLessonDirectly(admin || data.canCreateLessonDirectly === true)
        setRequiresLessonApproval(!admin && data.requiresLessonApproval === true)
      } catch (error) {
        console.error('[AuthContext] 사용자 문서 로드 실패:', error)
        resetSession()
      } finally {
        setLoading(false)
      }
    })

    return unsubscribe
  }, [])

  const value = useMemo(
    () => ({
      user,
      role,
      loading,
      isAdmin,
      isActive,
      teacherName,
      canAddStudent,
      canEditLesson,
      canDeleteLesson,
      canManageAttendance,
      canEditStudent,
      canDeleteStudent,
      canCreateLessonDirectly,
      requiresLessonApproval,
    }),
    [
      user,
      role,
      loading,
      isAdmin,
      isActive,
      teacherName,
      canAddStudent,
      canEditLesson,
      canDeleteLesson,
      canManageAttendance,
      canEditStudent,
      canDeleteStudent,
      canCreateLessonDirectly,
      requiresLessonApproval,
    ]
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}