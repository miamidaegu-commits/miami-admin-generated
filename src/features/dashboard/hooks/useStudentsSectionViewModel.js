import { useEffect, useMemo, useRef, useState } from 'react'
import {
  addCalendarDaysToYmd,
  earliestNextLessonSortKey,
  formatGroupStudentStartDate,
  getLessonStorageDateString,
  getGroupStudentRegistrationOperationalLabelForToday,
  getTodayStorageDateString,
  isGroupStudentOperationallyEligibleOnYmd,
  isGroupStudentRowActive,
  isGroupStudentStartedByYmd,
  normalizeText,
  studentFirstRegisteredYmdForSort,
  studentPackageAttentionScope,
  studentPackageExpiresAtToYmd,
} from '../dashboardViewUtils.js'

/**
 * Students 탭 전용: 필터·정렬·KPI·표 요약·전화 복사 등 읽기/뷰 상태만 담당.
 * Firestore 쓰기·모달 submit·권한 판단 변경은 Dashboard에 둔다.
 */
export default function useStudentsSectionViewModel({
  privateStudents,
  studentPackages,
  lessons,
  studentSummaryGroupStudents,
  studentSummaryGroupLessons,
  groupClasses,
  userProfile,
}) {
  const [expandedStudentPackageStudentId, setExpandedStudentPackageStudentId] =
    useState(null)
  const [showAllStudentPackagesInDetail, setShowAllStudentPackagesInDetail] =
    useState(false)
  const [copiedStudentPhoneId, setCopiedStudentPhoneId] = useState(null)
  const copiedStudentPhoneTimeoutRef = useRef(null)

  const [studentSearchQuery, setStudentSearchQuery] = useState('')
  const [studentTeacherFilter, setStudentTeacherFilter] = useState('')
  const [studentRegistrationFilter, setStudentRegistrationFilter] = useState('all')
  const [studentPrivatePackageFilter, setStudentPrivatePackageFilter] = useState('all')
  const [studentGroupPackageFilter, setStudentGroupPackageFilter] = useState('all')
  const [studentNextLessonFilter, setStudentNextLessonFilter] = useState('all')
  const [studentSortKey, setStudentSortKey] = useState('name')
  const [studentAttentionFilter, setStudentAttentionFilter] = useState('all')
  const [studentTodayLessonOnly, setStudentTodayLessonOnly] = useState(false)

  useEffect(() => {
    return () => {
      if (copiedStudentPhoneTimeoutRef.current != null) {
        clearTimeout(copiedStudentPhoneTimeoutRef.current)
      }
    }
  }, [])

  const sortedPrivateStudents = useMemo(() => {
    return [...privateStudents].sort((a, b) => {
      const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
      if (byName !== 0) return byName
      return String(a.teacher || '').localeCompare(String(b.teacher || ''), 'ko')
    })
  }, [privateStudents])

  const studentPackageTableSummaryByStudentId = useMemo(() => {
    const map = new Map()
    for (const p of studentPackages) {
      if (String(p.status || 'active') !== 'active') continue
      const sid = String(p.studentId || '').trim()
      if (!sid) continue
      if (!map.has(sid)) {
        map.set(sid, {
          privateCount: 0,
          privateRemainingTotal: 0,
          groupCount: 0,
          groupRemainingTotal: 0,
        })
      }
      const agg = map.get(sid)
      const rem = Number(p.remainingCount ?? 0)
      const pt = p.packageType
      if (pt === 'private') {
        agg.privateCount += 1
        agg.privateRemainingTotal += rem
      } else if (pt === 'group' || pt === 'openGroup') {
        agg.groupCount += 1
        agg.groupRemainingTotal += rem
      }
    }
    return map
  }, [studentPackages])

  const studentPackagesSortedByStudentId = useMemo(() => {
    const statusOrder = (s) => {
      const v = String(s == null || String(s).trim() === '' ? 'active' : s).toLowerCase()
      return v === 'active' ? 0 : 1
    }
    const typeOrder = (pt) => {
      if (pt === 'private') return 0
      if (pt === 'group') return 1
      if (pt === 'openGroup') return 2
      return 3
    }
    const createdMs = (p) => {
      const c = p?.createdAt
      if (c && typeof c.toDate === 'function') return c.toDate().getTime()
      if (c?.seconds != null) return Number(c.seconds) * 1000
      return 0
    }
    const expiresMs = (p) => {
      const raw = p?.expiresAt
      if (raw == null || raw === '') return Number.POSITIVE_INFINITY
      if (typeof raw.toDate === 'function') return raw.toDate().getTime()
      if (raw?.seconds != null) return Number(raw.seconds) * 1000
      if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(String(raw).trim())) {
        const [y, mo, d] = String(raw).trim().split('-').map(Number)
        return new Date(y, mo - 1, d).getTime()
      }
      return Number.POSITIVE_INFINITY
    }

    const map = new Map()
    for (const p of studentPackages) {
      const sid = String(p.studentId || '').trim()
      if (!sid) continue
      if (!map.has(sid)) map.set(sid, [])
      map.get(sid).push(p)
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => {
        const so = statusOrder(a.status) - statusOrder(b.status)
        if (so !== 0) return so
        const to = typeOrder(a.packageType) - typeOrder(b.packageType)
        if (to !== 0) return to
        const co = createdMs(b) - createdMs(a)
        if (co !== 0) return co
        return expiresMs(a) - expiresMs(b)
      })
    }
    return map
  }, [studentPackages])

  const activeGroupRegistrationsByStudentId = useMemo(() => {
    const today = getTodayStorageDateString()
    const pkgById = new Map(studentPackages.map((p) => [p.id, p]))
    const gcById = new Map(groupClasses.map((g) => [g.id, g]))
    const map = new Map()
    for (const gs of studentSummaryGroupStudents) {
      if (!isGroupStudentRowActive(gs)) continue
      if (!isGroupStudentStartedByYmd(gs, today)) continue
      const sid = String(gs.studentId || '').trim()
      if (!sid) continue
      const gid = String(gs.groupClassId || '').trim()
      const pkgId = String(gs.packageId || '').trim()
      const gc = gid ? gcById.get(gid) : null
      const className =
        gc?.name != null && String(gc.name).trim() ? String(gc.name).trim() : '-'
      const startDisplay = formatGroupStudentStartDate(gs.startDate)
      const pkg = pkgId ? pkgById.get(pkgId) : null
      const pkgTitle =
        pkg?.title != null && String(pkg.title).trim() ? String(pkg.title).trim() : '-'
      const remainingDisplay =
        pkg && pkg.remainingCount != null && pkg.remainingCount !== ''
          ? String(pkg.remainingCount)
          : '-'
      if (!map.has(sid)) map.set(sid, [])
      map.get(sid).push({
        key: gs.id,
        className,
        startDisplay,
        packageTitle: pkgTitle,
        remainingDisplay,
        operationalLabel: getGroupStudentRegistrationOperationalLabelForToday(gs),
      })
    }
    return map
  }, [studentSummaryGroupStudents, groupClasses, studentPackages])

  const nextPrivateLessonByStudentId = useMemo(() => {
    const today = getTodayStorageDateString()
    const best = new Map()
    for (const lesson of lessons) {
      const sid = String(lesson.studentId || '').trim()
      if (!sid) continue
      const dateStr = getLessonStorageDateString(lesson)
      if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
      if (dateStr < today) continue
      const timeStr = String(lesson.time || '').trim() || '00:00'
      const sortKey = `${dateStr} ${timeStr}`
      const prev = best.get(sid)
      if (!prev || sortKey < prev.sortKey) {
        best.set(sid, { lesson, sortKey })
      }
    }
    const out = new Map()
    for (const [sid, v] of best) {
      out.set(sid, v.lesson)
    }
    return out
  }, [lessons])

  const nextGroupLessonByStudentId = useMemo(() => {
    const today = getTodayStorageDateString()
    const activeGsRows = []
    for (const gs of studentSummaryGroupStudents) {
      if (!isGroupStudentRowActive(gs)) continue
      const sid = String(gs.studentId || '').trim()
      const gid = String(gs.groupClassId || '').trim()
      if (!sid || !gid) continue
      activeGsRows.push({ sid, gid, gs })
    }

    const sidSet = new Set(activeGsRows.map((r) => r.sid))

    const out = new Map()
    for (const sid of sidSet) {
      let bestLesson = null
      let bestKey = null
      for (const gl of studentSummaryGroupLessons) {
        const gid = String(gl.groupClassId || '').trim()
        const dateStr = String(gl.date || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
        if (dateStr < today) continue

        let eligible = false
        for (const row of activeGsRows) {
          if (row.sid !== sid || row.gid !== gid) continue
          if (isGroupStudentOperationallyEligibleOnYmd(row.gs, dateStr)) {
            eligible = true
            break
          }
        }
        if (!eligible) continue

        const timeStr = String(gl.time || '').trim() || '00:00'
        const sortKey = `${dateStr} ${timeStr}`
        if (bestKey === null || sortKey < bestKey) {
          bestKey = sortKey
          bestLesson = gl
        }
      }
      if (bestLesson) out.set(sid, bestLesson)
    }
    return out
  }, [studentSummaryGroupStudents, studentSummaryGroupLessons])

  const studentListTeacherOptions = useMemo(() => {
    const set = new Set()
    for (const s of privateStudents) {
      const t = String(s.teacher || '').trim()
      if (t) set.add(t)
    }
    return [...set].sort((a, b) => a.localeCompare(b, 'ko'))
  }, [privateStudents])

  const studentAttentionFlagsByStudentId = useMemo(() => {
    const today = getTodayStorageDateString()
    const limitYmd = addCalendarDaysToYmd(today, 14) || today

    /** sid -> scope -> { hasActive, activeLowRem, hasExhausted } */
    const scopeAgg = new Map()
    const expiringBySid = new Set()

    for (const p of studentPackages) {
      const sid = String(p.studentId || '').trim()
      if (!sid) continue

      const st = String(p.status == null || String(p.status).trim() === '' ? 'active' : p.status)
        .trim()
        .toLowerCase()

      if (st === 'active') {
        const scope = studentPackageAttentionScope(p)
        if (!scopeAgg.has(sid)) scopeAgg.set(sid, new Map())
        const byScope = scopeAgg.get(sid)
        if (!byScope.has(scope)) {
          byScope.set(scope, {
            hasActive: false,
            activeLowRem: false,
            hasExhausted: false,
          })
        }
        const cell = byScope.get(scope)
        cell.hasActive = true
        const rem = Number(p.remainingCount ?? 0)
        if (Number.isFinite(rem) && rem <= 1) {
          cell.activeLowRem = true
        }
        const expYmd = studentPackageExpiresAtToYmd(p.expiresAt)
        if (expYmd && /^\d{4}-\d{2}-\d{2}$/.test(expYmd) && expYmd >= today && expYmd <= limitYmd) {
          expiringBySid.add(sid)
        }
      } else if (st === 'exhausted') {
        const scope = studentPackageAttentionScope(p)
        if (!scopeAgg.has(sid)) scopeAgg.set(sid, new Map())
        const byScope = scopeAgg.get(sid)
        if (!byScope.has(scope)) {
          byScope.set(scope, {
            hasActive: false,
            activeLowRem: false,
            hasExhausted: false,
          })
        }
        byScope.get(scope).hasExhausted = true
      }
    }

    const map = new Map()
    for (const [sid, byScope] of scopeAgg) {
      let hasRenewalNeeded = false
      for (const cell of byScope.values()) {
        if (cell.hasActive) {
          if (cell.activeLowRem) hasRenewalNeeded = true
        } else if (cell.hasExhausted) {
          hasRenewalNeeded = true
        }
      }
      map.set(sid, {
        hasRenewalNeeded,
        hasExpiringSoon: expiringBySid.has(sid),
      })
    }

    for (const sid of expiringBySid) {
      if (map.has(sid)) continue
      map.set(sid, { hasRenewalNeeded: false, hasExpiringSoon: true })
    }

    return map
  }, [studentPackages])

  const studentIdsWithLessonTodaySet = useMemo(() => {
    const today = getTodayStorageDateString()
    const ids = new Set()

    for (const lesson of lessons) {
      const d = getLessonStorageDateString(lesson)
      if (d !== today) continue
      const sid = String(lesson.studentId || '').trim()
      if (sid) ids.add(sid)
    }

    const todayGroupClassIds = new Set()
    for (const gl of studentSummaryGroupLessons) {
      const ds = String(gl.date || '').trim()
      if (ds === today && /^\d{4}-\d{2}-\d{2}$/.test(ds)) {
        const gid = String(gl.groupClassId || '').trim()
        if (gid) todayGroupClassIds.add(gid)
      }
    }

    for (const gs of studentSummaryGroupStudents) {
      if (!isGroupStudentRowActive(gs)) continue
      if (!isGroupStudentStartedByYmd(gs, today)) continue
      if (!isGroupStudentOperationallyEligibleOnYmd(gs, today)) continue
      const gid = String(gs.groupClassId || '').trim()
      if (!todayGroupClassIds.has(gid)) continue
      const sid = String(gs.studentId || '').trim()
      if (sid) ids.add(sid)
    }

    return ids
  }, [lessons, studentSummaryGroupLessons, studentSummaryGroupStudents])

  const studentListKpis = useMemo(() => {
    const totalStudents = privateStudents.length

    let renewalNeededCount = 0
    let expiringSoonCount = 0
    for (const flags of studentAttentionFlagsByStudentId.values()) {
      if (flags?.hasRenewalNeeded) renewalNeededCount += 1
      if (flags?.hasExpiringSoon) expiringSoonCount += 1
    }

    const activeGroupRegistrationStudentCount = activeGroupRegistrationsByStudentId.size
    const todayLessonStudentCount = studentIdsWithLessonTodaySet.size

    return {
      totalStudents,
      renewalNeededCount,
      expiringSoonCount,
      activeGroupRegistrationStudentCount,
      todayLessonStudentCount,
    }
  }, [
    privateStudents,
    studentAttentionFlagsByStudentId,
    activeGroupRegistrationsByStudentId,
    studentIdsWithLessonTodaySet,
  ])

  const filteredSortedPrivateStudents = useMemo(() => {
    const admin = userProfile?.role === 'admin'
    const q = normalizeText(studentSearchQuery)
    const teacherF = String(studentTeacherFilter || '').trim()

    const list = sortedPrivateStudents.filter((student) => {
      if (q) {
        const fields = [
          student.name,
          student.phone,
          student.carNumber,
          student.learningPurpose,
          student.note,
        ]
        const match = fields.some((f) =>
          normalizeText(String(f ?? '')).includes(q)
        )
        if (!match) return false
      }

      if (admin && teacherF) {
        if (normalizeText(student.teacher || '') !== normalizeText(teacherF)) {
          return false
        }
      }

      const regs = activeGroupRegistrationsByStudentId.get(student.id) ?? []
      if (studentRegistrationFilter === 'has' && regs.length === 0) return false
      if (studentRegistrationFilter === 'none' && regs.length > 0) return false

      const pkgSum = studentPackageTableSummaryByStudentId.get(student.id) ?? {
        privateCount: 0,
        privateRemainingTotal: 0,
        groupCount: 0,
        groupRemainingTotal: 0,
      }
      const privCount = Number(pkgSum.privateCount) || 0
      const grpCount = Number(pkgSum.groupCount) || 0
      if (studentPrivatePackageFilter === 'has' && privCount <= 0) return false
      if (studentPrivatePackageFilter === 'none' && privCount > 0) return false
      if (studentGroupPackageFilter === 'has' && grpCount <= 0) return false
      if (studentGroupPackageFilter === 'none' && grpCount > 0) return false

      const nextPriv = nextPrivateLessonByStudentId.get(student.id)
      const nextGrp = nextGroupLessonByStudentId.get(student.id)
      const hasNext = Boolean(nextPriv || nextGrp)
      if (studentNextLessonFilter === 'has' && !hasNext) return false
      if (studentNextLessonFilter === 'none' && hasNext) return false

      const att = studentAttentionFlagsByStudentId.get(student.id) ?? {
        hasRenewalNeeded: false,
        hasExpiringSoon: false,
      }
      if (studentAttentionFilter === 'renewal' && !att.hasRenewalNeeded) return false
      if (studentAttentionFilter === 'expiring' && !att.hasExpiringSoon) return false

      if (studentTodayLessonOnly && !studentIdsWithLessonTodaySet.has(student.id)) {
        return false
      }

      return true
    })

    const sorted = [...list]
    if (studentSortKey === 'firstRegisteredDesc') {
      sorted.sort((a, b) => {
        const ya = studentFirstRegisteredYmdForSort(a.firstRegisteredAt) || ''
        const yb = studentFirstRegisteredYmdForSort(b.firstRegisteredAt) || ''
        if (ya !== yb) return yb.localeCompare(ya)
        const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
        if (byName !== 0) return byName
        return String(a.teacher || '').localeCompare(String(b.teacher || ''), 'ko')
      })
    } else if (studentSortKey === 'nextLessonAsc') {
      sorted.sort((a, b) => {
        const ka = earliestNextLessonSortKey(
          nextPrivateLessonByStudentId.get(a.id),
          nextGroupLessonByStudentId.get(a.id)
        )
        const kb = earliestNextLessonSortKey(
          nextPrivateLessonByStudentId.get(b.id),
          nextGroupLessonByStudentId.get(b.id)
        )
        if (!ka && !kb) {
          const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
          if (byName !== 0) return byName
          return String(a.teacher || '').localeCompare(String(b.teacher || ''), 'ko')
        }
        if (!ka) return 1
        if (!kb) return -1
        const c = ka.localeCompare(kb)
        if (c !== 0) return c
        const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
        if (byName !== 0) return byName
        return String(a.teacher || '').localeCompare(String(b.teacher || ''), 'ko')
      })
    } else {
      sorted.sort((a, b) => {
        const byName = String(a.name || '').localeCompare(String(b.name || ''), 'ko')
        if (byName !== 0) return byName
        return String(a.teacher || '').localeCompare(String(b.teacher || ''), 'ko')
      })
    }

    return sorted
  }, [
    sortedPrivateStudents,
    studentSearchQuery,
    studentTeacherFilter,
    studentRegistrationFilter,
    studentPrivatePackageFilter,
    studentGroupPackageFilter,
    studentNextLessonFilter,
    studentSortKey,
    studentAttentionFilter,
    studentTodayLessonOnly,
    userProfile?.role,
    activeGroupRegistrationsByStudentId,
    studentPackageTableSummaryByStudentId,
    nextPrivateLessonByStudentId,
    nextGroupLessonByStudentId,
    studentAttentionFlagsByStudentId,
    studentIdsWithLessonTodaySet,
  ])

  async function copyStudentPhone(student) {
    const raw = student?.phone
    if (raw == null) return
    const text = String(raw).trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedStudentPhoneId(student.id)
      if (copiedStudentPhoneTimeoutRef.current != null) {
        clearTimeout(copiedStudentPhoneTimeoutRef.current)
      }
      copiedStudentPhoneTimeoutRef.current = setTimeout(() => {
        setCopiedStudentPhoneId(null)
        copiedStudentPhoneTimeoutRef.current = null
      }, 1800)
    } catch (_err) {
      alert('전화번호를 복사하지 못했습니다.')
    }
  }

  return {
    expandedStudentPackageStudentId,
    setExpandedStudentPackageStudentId,
    showAllStudentPackagesInDetail,
    setShowAllStudentPackagesInDetail,
    copiedStudentPhoneId,
    studentSearchQuery,
    setStudentSearchQuery,
    studentTeacherFilter,
    setStudentTeacherFilter,
    studentRegistrationFilter,
    setStudentRegistrationFilter,
    studentPrivatePackageFilter,
    setStudentPrivatePackageFilter,
    studentGroupPackageFilter,
    setStudentGroupPackageFilter,
    studentNextLessonFilter,
    setStudentNextLessonFilter,
    studentSortKey,
    setStudentSortKey,
    studentAttentionFilter,
    setStudentAttentionFilter,
    studentTodayLessonOnly,
    setStudentTodayLessonOnly,
    sortedPrivateStudents,
    studentPackageTableSummaryByStudentId,
    studentPackagesSortedByStudentId,
    activeGroupRegistrationsByStudentId,
    nextPrivateLessonByStudentId,
    nextGroupLessonByStudentId,
    studentListTeacherOptions,
    studentAttentionFlagsByStudentId,
    studentIdsWithLessonTodaySet,
    studentListKpis,
    filteredSortedPrivateStudents,
    copyStudentPhone,
  }
}
