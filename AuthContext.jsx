// src/context/AuthContext.jsx
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { onAuthStateChanged, signOut } from 'firebase/auth'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { auth, db } from './firebase'
import { debugLog, debugWarn } from './src/utils/debugLog.js'
import {
  isValidOperationalAcademyId,
  normalizeAcademyId,
} from './src/features/dashboard/academyScope.js'

const AuthContext = createContext(null)

const PERMISSION_KEYS = [
  'canManageAttendance',
  'canAddStudent',
  'canEditStudent',
  'canDeleteStudent',
  'canEditLesson',
  'canDeleteLesson',
  'canCreateLessonDirectly',
  'requiresLessonApproval',
]

const emptyState = {
  user: null,
  globalUserProfile: null,
  userProfile: null,
  memberships: [],
  currentAcademyId: '',
  currentMembership: null,
  currentAcademy: null,
  loading: true,
}

function normalizeText(value) {
  return String(value || '').trim().toLowerCase()
}

function normalizeDashboardRole(role, fallbackRole = '') {
  const normalized = String(role || fallbackRole || '').trim().toLowerCase()
  if (normalized === 'owner' || normalized === 'admin') return 'admin'
  if (normalized === 'teacher') return 'teacher'
  return normalized || null
}

function normalizeMembershipRole(role, fallbackRole = '') {
  const normalized = String(role || fallbackRole || '').trim().toLowerCase()
  if (['owner', 'admin', 'teacher', 'staff', 'student'].includes(normalized)) {
    return normalized
  }
  return normalized || 'staff'
}

function normalizePermissions(source = {}) {
  const rawPermissions = source.permissions && typeof source.permissions === 'object'
    ? source.permissions
    : source

  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [key, rawPermissions?.[key] === true])
  )
}

function sortMemberships(rows) {
  return [...rows].sort((a, b) => {
    const academyCompare = String(a.academyId || '').localeCompare(String(b.academyId || ''))
    if (academyCompare !== 0) return academyCompare
    return String(a.uid || '').localeCompare(String(b.uid || ''))
  })
}

function chooseAcademyId(userData, memberships) {
  const activeMemberships = sortMemberships(memberships).filter((membership) =>
    isValidOperationalAcademyId(membership.academyId)
  )
  if (activeMemberships.length === 0) return ''

  const preferredAcademyId = normalizeAcademyId(userData?.lastSelectedAcademyId)
  if (
    isValidOperationalAcademyId(preferredAcademyId) &&
    activeMemberships.some((membership) => membership.academyId === preferredAcademyId)
  ) {
    return preferredAcademyId
  }

  return String(activeMemberships[0].academyId || '')
}

function buildUserProfileAdapter({
  firebaseUser,
  globalUserProfile,
  currentMembership,
  currentAcademyId,
}) {
  if (!firebaseUser || !globalUserProfile || !currentMembership) return null

  const sourceProfile = currentMembership
  const membershipRole = normalizeMembershipRole(
    sourceProfile?.role,
    globalUserProfile.role
  )
  const role = normalizeDashboardRole(membershipRole, globalUserProfile.role)
  const admin = role === 'admin'
  const permissions = normalizePermissions(sourceProfile || {})

  return {
    ...globalUserProfile,
    id: firebaseUser.uid,
    uid: firebaseUser.uid,
    email: globalUserProfile.email || firebaseUser.email || '',
    displayName: globalUserProfile.displayName || firebaseUser.displayName || '',
    accountScope: globalUserProfile.accountScope || 'global',
    academyId: currentAcademyId || '',
    currentAcademyId: currentAcademyId || '',
    membershipId: currentMembership?.id || '',
    membershipRole,
    role,
    studentId: String(sourceProfile?.studentId || '').trim(),
    isActive: currentMembership.status !== 'disabled',
    teacherName: normalizeText(sourceProfile?.teacherName || globalUserProfile.teacherName),
    canManageAttendance: admin || permissions.canManageAttendance === true,
    canAddStudent: admin || permissions.canAddStudent === true,
    canEditStudent: admin || permissions.canEditStudent === true,
    canDeleteStudent: admin || permissions.canDeleteStudent === true,
    canEditLesson: admin || permissions.canEditLesson === true,
    canDeleteLesson: admin || permissions.canDeleteLesson === true,
    canCreateLessonDirectly: admin || permissions.canCreateLessonDirectly === true,
    requiresLessonApproval: !admin && permissions.requiresLessonApproval === true,
  }
}

function getCandidateAcademyIds(userData) {
  return [
    userData?.lastSelectedAcademyId,
    userData?.currentAcademyId,
    userData?.academyId,
  ]
    .map(normalizeAcademyId)
    .filter((academyId, index, academyIds) =>
      isValidOperationalAcademyId(academyId) && academyIds.indexOf(academyId) === index
    )
}

async function loadActiveMemberships(uid, userData) {
  const membershipsById = new Map()

  await Promise.all(
    getCandidateAcademyIds(userData).map(async (academyId) => {
      try {
        const membershipSnap = await getDoc(doc(db, 'academyMemberships', `${academyId}_${uid}`))
        if (!membershipSnap.exists()) return
        const membership = {
          id: membershipSnap.id,
          ...membershipSnap.data(),
        }
        if (membership.uid === uid && membership.status === 'active') {
          membershipsById.set(membership.id, membership)
        }
      } catch (error) {
        debugWarn('[AuthContext] academyMemberships 직접 로드 실패:', academyId, error)
      }
    })
  )

  try {
    const membershipSnap = await getDocs(
      query(
        collection(db, 'academyMemberships'),
        where('uid', '==', uid),
        where('status', '==', 'active')
      )
    )

    const memberships = membershipSnap.docs.map((docItem) => ({
      id: docItem.id,
      ...docItem.data(),
    }))

    memberships.forEach((membership) => membershipsById.set(membership.id, membership))
  } catch (error) {
    debugWarn('[AuthContext] academyMemberships 로드 실패:', error)
  }

  return sortMemberships([...membershipsById.values()])
}

async function loadAcademy(academyId) {
  if (!academyId) return null

  try {
    const academySnap = await getDoc(doc(db, 'academies', academyId))
    return academySnap.exists() ? { id: academySnap.id, ...academySnap.data() } : null
  } catch (error) {
    debugWarn('[AuthContext] academies 문서 로드 실패:', academyId, error)
    return null
  }
}

async function healLastSelectedAcademyId(uid, previousAcademyId, nextAcademyId) {
  if (!uid || !isValidOperationalAcademyId(nextAcademyId)) return
  if (normalizeAcademyId(previousAcademyId) === nextAcademyId) return

  try {
    await updateDoc(doc(db, 'users', uid), {
      lastSelectedAcademyId: nextAcademyId,
      updatedAt: serverTimestamp(),
    })
  } catch (error) {
    debugWarn('[AuthContext] lastSelectedAcademyId 자동 보정 실패:', error)
  }
}

export function AuthProvider({ children }) {
  const [session, setSession] = useState(emptyState)

  const resetSession = useCallback((loading = false) => {
    setSession({
      ...emptyState,
      loading,
    })
  }, [])

  useEffect(() => {
    let cancelled = false

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setSession((prev) => ({ ...prev, loading: true }))

      if (!firebaseUser) {
        resetSession(false)
        return
      }

      try {
        const userSnap = await getDoc(doc(db, 'users', firebaseUser.uid))

        if (!userSnap.exists()) {
          debugWarn('[AuthContext] users/{uid} 문서가 없습니다')
          resetSession(false)
          await signOut(auth)
          return
        }

        const globalUserProfile = {
          id: userSnap.id,
          uid: firebaseUser.uid,
          ...userSnap.data(),
        }

        if (globalUserProfile.isActive === false) {
          debugWarn('[AuthContext] 비활성 계정입니다. 자동 로그아웃합니다.')
          resetSession(false)
          await signOut(auth)
          return
        }

        const memberships = await loadActiveMemberships(firebaseUser.uid, globalUserProfile)
        const currentAcademyId = chooseAcademyId(globalUserProfile, memberships)
        const currentMembership =
          memberships.find((membership) => membership.academyId === currentAcademyId) || null

        if (!currentMembership || !currentAcademyId) {
          debugWarn('[AuthContext] 활성 academyMemberships 가 없어 세션을 종료합니다.')
          resetSession(false)
          await signOut(auth)
          return
        }

        const currentAcademy = await loadAcademy(currentAcademyId)
        const userProfile = buildUserProfileAdapter({
          firebaseUser,
          globalUserProfile,
          currentMembership,
          currentAcademyId,
        })

        await healLastSelectedAcademyId(
          firebaseUser.uid,
          globalUserProfile.lastSelectedAcademyId,
          currentAcademyId
        )

        debugLog('[AuthContext] session loaded', {
          hasUid: Boolean(firebaseUser.uid),
          hasEmail: Boolean(firebaseUser.email),
          hasAcademy: Boolean(currentAcademyId),
          memberships: memberships.length,
          membershipRole: currentMembership?.role || null,
          dashboardRole: userProfile?.role || null,
          hasTeacherName: Boolean(userProfile?.teacherName),
        })

        if (!cancelled) {
          setSession({
            user: firebaseUser,
            globalUserProfile,
            userProfile,
            memberships,
            currentAcademyId,
            currentMembership,
            currentAcademy,
            loading: false,
          })
        }
      } catch (error) {
        console.error('[AuthContext] 사용자 세션 로드 실패:', error)
        if (!cancelled) resetSession(false)
      }
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [resetSession])

  const selectCurrentAcademyId = useCallback(
    async (academyId) => {
      const nextAcademyId = normalizeAcademyId(academyId)
      if (!session.user?.uid || !isValidOperationalAcademyId(nextAcademyId)) return false

      const nextMembership =
        session.memberships.find((membership) => membership.academyId === nextAcademyId) || null

      if (!nextMembership) {
        debugWarn('[AuthContext] 선택할 수 없는 academyId 입니다')
        return false
      }

      const nextAcademy = await loadAcademy(nextAcademyId)
      const nextUserProfile = buildUserProfileAdapter({
        firebaseUser: session.user,
        globalUserProfile: session.globalUserProfile,
        currentMembership: nextMembership,
        currentAcademyId: nextAcademyId,
      })

      setSession((prev) => ({
        ...prev,
        currentAcademyId: nextAcademyId,
        currentMembership: nextMembership,
        currentAcademy: nextAcademy,
        userProfile: nextUserProfile,
      }))

      try {
        await updateDoc(doc(db, 'users', session.user.uid), {
          lastSelectedAcademyId: nextAcademyId,
          updatedAt: serverTimestamp(),
        })
      } catch (error) {
        debugWarn('[AuthContext] lastSelectedAcademyId 저장 실패:', error)
      }

      return true
    },
    [session.globalUserProfile, session.memberships, session.user]
  )

  const value = useMemo(() => {
    const userProfile = session.userProfile
    const role = userProfile?.role || null

    return {
      user: session.user,
      globalUserProfile: session.globalUserProfile,
      userProfile,
      memberships: session.memberships,
      currentAcademyId: session.currentAcademyId,
      currentMembership: session.currentMembership,
      currentAcademy: session.currentAcademy,
      setCurrentAcademyId: selectCurrentAcademyId,
      role,
      loading: session.loading,
      isAdmin: role === 'admin',
      isActive: userProfile?.isActive === true,
      teacherName: userProfile?.teacherName || '',
      studentId: userProfile?.studentId || '',
      canAddStudent: userProfile?.canAddStudent === true,
      canEditLesson: userProfile?.canEditLesson === true,
      canDeleteLesson: userProfile?.canDeleteLesson === true,
      canManageAttendance: userProfile?.canManageAttendance === true,
      canEditStudent: userProfile?.canEditStudent === true,
      canDeleteStudent: userProfile?.canDeleteStudent === true,
      canCreateLessonDirectly: userProfile?.canCreateLessonDirectly === true,
      requiresLessonApproval: userProfile?.requiresLessonApproval === true,
    }
  }, [selectCurrentAcademyId, session])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
