import { useEffect, useState } from 'react'
import {
  arrayRemove,
  arrayUnion,
  doc,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore'
import { db } from '../../../../firebase'
import {
  SCHOOL_TIME_ZONE,
  getGroupLessonGroupId,
  getNextStudentPackageStatus,
  groupStudentStartDateToYmd,
  isGroupStudentOperationallyEligibleOnYmd,
  normalizeText,
} from '../dashboardViewUtils.js'

function getNowSchoolDateTimeParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SCHOOL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())
  const year = parts.find((p) => p.type === 'year')?.value || ''
  const month = parts.find((p) => p.type === 'month')?.value || ''
  const day = parts.find((p) => p.type === 'day')?.value || ''
  const hour = parts.find((p) => p.type === 'hour')?.value || '00'
  const minute = parts.find((p) => p.type === 'minute')?.value || '00'
  return {
    ymd: `${year}-${month}-${day}`,
    hm: `${hour}:${minute}`,
  }
}

export default function useGroupAttendanceFlow({
  activeSection,
  userProfile,
  groupClasses,
  selectedGroupClass,
  setSelectedGroupClass,
  groupLessons,
  studentSummaryGroupStudents,
  studentPackages,
  addCreditTransaction,
}) {
  const [groupLessonAttendanceModal, setGroupLessonAttendanceModal] = useState(null)
  const [busyGroupAttendanceStudentId, setBusyGroupAttendanceStudentId] = useState(null)

  useEffect(() => {
    if (activeSection !== 'groups') {
      setGroupLessonAttendanceModal(null)
    }
  }, [activeSection])

  useEffect(() => {
    if (!groupLessonAttendanceModal) return

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setGroupLessonAttendanceModal(null)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [groupLessonAttendanceModal])

  function closeGroupLessonAttendanceModal() {
    setGroupLessonAttendanceModal(null)
  }

  function isPastGroupLesson(lesson) {
    const lessonDate = String(lesson?.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate)) return false

    const now = getNowSchoolDateTimeParts()
    if (lessonDate < now.ymd) return true
    if (lessonDate > now.ymd) return false

    const lessonTime = String(lesson?.time || '').trim()
    if (!lessonTime) return false
    const lessonTimeHm = lessonTime.slice(0, 5)
    if (!/^\d{2}:\d{2}$/.test(lessonTimeHm)) return false
    return lessonTimeHm < now.hm
  }

  function buildSyncRowsForPastLesson(lessonLatest, gid) {
    const countedRaw = Array.isArray(lessonLatest.countedStudentIDs)
      ? lessonLatest.countedStudentIDs
      : []
    const countedSet = new Set(countedRaw.map((id) => String(id || '').trim()))
    const lessonDate = String(lessonLatest.date || '').trim()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate)) return []

    return [...studentSummaryGroupStudents]
      .filter((gs) => {
        const gsGid = String(gs.groupClassId || gs.classID || '').trim()
        if (gsGid !== String(gid)) return false

        const pkgId = String(gs.packageId || '').trim()
        if (!pkgId) return false

        const pkg = studentPackages.find((p) => p.id === pkgId)
        if (!pkg || pkg.packageType !== 'group' || String(pkg.groupClassId || '') !== String(gid)) {
          return false
        }
        if (!isGroupStudentOperationallyEligibleOnYmd(gs, lessonDate)) return false
        return true
      })
      .sort((a, b) =>
        String(a.studentName || a.name || '').localeCompare(
          String(b.studentName || b.name || ''),
          'ko'
        )
      )
      .map((gs) => {
        const studentId = String(gs.studentId || '').trim()
        const pkg = studentPackages.find((p) => p.id === gs.packageId)
        const remaining = pkg ? Number(pkg.remainingCount ?? 0) : 0
        const isCounted = Boolean(studentId && countedSet.has(studentId))
        return {
          groupStudent: gs,
          isCounted,
          canDeduct: Boolean(pkg) && !isCounted && remaining > 0,
        }
      })
  }

  async function applyGroupLessonAttendanceDeduction(
    groupStudentRow,
    lesson,
    explicitGroupClassId
  ) {
    const gid = String(explicitGroupClassId || getGroupLessonGroupId(lesson) || '').trim()
    if (!gid || !lesson?.id) return
    if (!(userProfile?.role === 'admin' || userProfile?.canManageAttendance === true)) {
      alert('출석 관리 권한이 없습니다.')
      return
    }

    const studentId = String(groupStudentRow.studentId || '').trim()
    if (!studentId) {
      alert('반 등록에 학생 정보가 없습니다.')
      return
    }

    const pkgId = String(groupStudentRow.packageId || '').trim()
    if (!pkgId) {
      alert(
        userProfile?.role === 'admin'
          ? '연결된 수강권이 없습니다.'
          : '연결된 수업 등록이 없습니다.'
      )
      return
    }

    const lessonDate = String(lesson.date || '').trim()
    const startYmd = groupStudentStartDateToYmd(groupStudentRow)
    if (startYmd && lessonDate && lessonDate < startYmd) {
      alert('이 수업 날짜는 해당 학생의 반 시작일 이전입니다.')
      return
    }

    const busyKey = `${lesson.id}__${groupStudentRow.id}`
    try {
      setBusyGroupAttendanceStudentId(busyKey)
      await runTransaction(db, async (transaction) => {
        const adminUi = userProfile?.role === 'admin'
        const lessonRef = doc(db, 'groupLessons', lesson.id)
        const pkgRef = doc(db, 'studentPackages', pkgId)
        const gsRef = doc(db, 'groupStudents', groupStudentRow.id)

        const lessonSnap = await transaction.get(lessonRef)
        const pkgSnap = await transaction.get(pkgRef)
        const gsSnap = await transaction.get(gsRef)

        if (!lessonSnap.exists()) throw new Error('수업 일정을 찾을 수 없습니다.')
        if (!pkgSnap.exists()) {
          throw new Error(
            adminUi ? '수강권을 찾을 수 없습니다.' : '등록 정보를 찾을 수 없습니다.'
          )
        }
        if (!gsSnap.exists()) throw new Error('반 학생 정보를 찾을 수 없습니다.')

        const lData = lessonSnap.data()
        if (getGroupLessonGroupId(lData) !== String(gid)) throw new Error('다른 반 수업입니다.')

        const pData = pkgSnap.data()
        if (pData.packageType !== 'group') {
          throw new Error(adminUi ? '그룹 수강권이 아닙니다.' : '그룹 등록이 아닙니다.')
        }
        if (String(pData.groupClassId || '') !== String(gid)) {
          throw new Error(adminUi ? '다른 반 수강권입니다.' : '다른 반 등록입니다.')
        }
        if (String(pData.studentId || '').trim() !== studentId) {
          throw new Error(
            adminUi ? '학생과 수강권이 일치하지 않습니다.' : '학생과 등록 정보가 일치하지 않습니다.'
          )
        }

        const counted = Array.isArray(lData.countedStudentIDs)
          ? lData.countedStudentIDs.map((x) => String(x || '').trim())
          : []
        if (counted.includes(studentId)) throw new Error('이미 차감된 학생입니다.')

        const rem = Number(pData.remainingCount ?? 0)
        if (rem <= 0) throw new Error('남은 횟수가 없습니다.')

        const used = Number(pData.usedCount ?? 0)

        const gsData = gsSnap.data()
        if (String(gsData.groupClassId || '') !== String(gid)) throw new Error('다른 반 학생입니다.')
        if (String(gsData.status || 'active') !== 'active') throw new Error('비활성 학생입니다.')

        const att = Number(gsData.attendanceCount ?? 0)

        const newUsed = used + 1
        const newRem = rem - 1
        const status = getNextStudentPackageStatus(pData.status, newRem)

        transaction.update(pkgRef, {
          usedCount: newUsed,
          remainingCount: newRem,
          status,
          updatedAt: serverTimestamp(),
        })
        transaction.update(gsRef, {
          attendanceCount: att + 1,
          updatedAt: serverTimestamp(),
        })
        transaction.update(lessonRef, {
          countedStudentIDs: arrayUnion(studentId),
          attendanceAppliedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      })

      const pkgLog = studentPackages.find((p) => p.id === pkgId)
      const gName = selectedGroupClass?.name || ''
      const datePart = [lesson.date, lesson.time, lesson.subject].filter(Boolean).join(' ')
      await addCreditTransaction({
        studentId,
        studentName:
          String(groupStudentRow.studentName || groupStudentRow.name || '').trim() || '-',
        teacher: normalizeText(pkgLog?.teacher || ''),
        packageId: pkgId,
        packageType: pkgLog?.packageType || 'group',
        sourceType: 'groupLesson',
        sourceId: lesson.id,
        actionType: 'group_deduct',
        deltaCount: -1,
        memo: [datePart, gName].filter(Boolean).join(' · ') || '그룹 출석 차감',
      })
    } catch (error) {
      console.error('차감 실패:', error)
      alert(`차감 실패: ${error.message}`)
    } finally {
      setBusyGroupAttendanceStudentId(null)
    }
  }

  async function applyGroupLessonAttendanceUndo(groupStudentRow, lesson) {
    const gid = selectedGroupClass?.id
    if (!gid || !lesson?.id) return
    if (!(userProfile?.role === 'admin' || userProfile?.canManageAttendance === true)) {
      alert('출석 관리 권한이 없습니다.')
      return
    }

    const studentId = String(groupStudentRow.studentId || '').trim()
    if (!studentId) {
      alert('반 등록에 학생 정보가 없습니다.')
      return
    }

    const pkgId = String(groupStudentRow.packageId || '').trim()
    if (!pkgId) {
      alert(
        userProfile?.role === 'admin'
          ? '연결된 수강권이 없습니다.'
          : '연결된 수업 등록이 없습니다.'
      )
      return
    }

    const busyKey = `${lesson.id}__${groupStudentRow.id}`
    try {
      setBusyGroupAttendanceStudentId(busyKey)
      await runTransaction(db, async (transaction) => {
        const adminUi = userProfile?.role === 'admin'
        const lessonRef = doc(db, 'groupLessons', lesson.id)
        const pkgRef = doc(db, 'studentPackages', pkgId)
        const gsRef = doc(db, 'groupStudents', groupStudentRow.id)

        const lessonSnap = await transaction.get(lessonRef)
        const pkgSnap = await transaction.get(pkgRef)
        const gsSnap = await transaction.get(gsRef)

        if (!lessonSnap.exists()) throw new Error('수업 일정을 찾을 수 없습니다.')
        if (!pkgSnap.exists()) {
          throw new Error(
            adminUi ? '수강권을 찾을 수 없습니다.' : '등록 정보를 찾을 수 없습니다.'
          )
        }
        if (!gsSnap.exists()) throw new Error('반 학생 정보를 찾을 수 없습니다.')

        const lData = lessonSnap.data()
        if (getGroupLessonGroupId(lData) !== String(gid)) throw new Error('다른 반 수업입니다.')

        const pData = pkgSnap.data()
        if (pData.packageType !== 'group') {
          throw new Error(adminUi ? '그룹 수강권이 아닙니다.' : '그룹 등록이 아닙니다.')
        }
        if (String(pData.groupClassId || '') !== String(gid)) {
          throw new Error(adminUi ? '다른 반 수강권입니다.' : '다른 반 등록입니다.')
        }
        if (String(pData.studentId || '').trim() !== studentId) {
          throw new Error(
            adminUi ? '학생과 수강권이 일치하지 않습니다.' : '학생과 등록 정보가 일치하지 않습니다.'
          )
        }

        const counted = Array.isArray(lData.countedStudentIDs)
          ? lData.countedStudentIDs.map((x) => String(x || '').trim())
          : []
        if (!counted.includes(studentId)) throw new Error('차감 기록이 없습니다.')

        const used = Number(pData.usedCount ?? 0)
        if (used <= 0) throw new Error('usedCount를 더 줄일 수 없습니다.')

        const rem = Number(pData.remainingCount ?? 0)

        const gsData = gsSnap.data()
        if (String(gsData.groupClassId || '') !== String(gid)) throw new Error('다른 반 학생입니다.')

        const att = Number(gsData.attendanceCount ?? 0)
        if (att <= 0) throw new Error('출석 횟수를 더 줄일 수 없습니다.')

        const newUsed = used - 1
        const newRem = rem + 1
        const status = getNextStudentPackageStatus(pData.status, newRem)

        transaction.update(pkgRef, {
          usedCount: newUsed,
          remainingCount: newRem,
          status,
          updatedAt: serverTimestamp(),
        })
        transaction.update(gsRef, {
          attendanceCount: att - 1,
          updatedAt: serverTimestamp(),
        })
        transaction.update(lessonRef, {
          countedStudentIDs: arrayRemove(studentId),
          attendanceAppliedAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      })

      const pkgLogUndo = studentPackages.find((p) => p.id === pkgId)
      const gNameUndo = selectedGroupClass?.name || ''
      const datePartUndo = [lesson.date, lesson.time, lesson.subject].filter(Boolean).join(' ')
      await addCreditTransaction({
        studentId,
        studentName:
          String(groupStudentRow.studentName || groupStudentRow.name || '').trim() || '-',
        teacher: normalizeText(pkgLogUndo?.teacher || ''),
        packageId: pkgId,
        packageType: pkgLogUndo?.packageType || 'group',
        sourceType: 'groupLesson',
        sourceId: lesson.id,
        actionType: 'group_deduct_restore',
        deltaCount: 1,
        memo: [datePartUndo, gNameUndo].filter(Boolean).join(' · ') || '그룹 출석 차감 복구',
      })
    } catch (error) {
      console.error('차감 복구 실패:', error)
      alert(`차감 복구 실패: ${error.message}`)
    } finally {
      setBusyGroupAttendanceStudentId(null)
    }
  }

  async function syncPastGroupLessonAttendance(lesson) {
    if (!(userProfile?.role === 'admin' || userProfile?.canManageAttendance === true)) {
      return
    }
    if (!lesson?.id) return
    if (!isPastGroupLesson(lesson)) return

    const gid = getGroupLessonGroupId(lesson)
    if (!gid) return

    const lessonLatest = groupLessons.find((l) => l.id === lesson.id) || lesson
    const countedRaw = Array.isArray(lessonLatest.countedStudentIDs)
      ? lessonLatest.countedStudentIDs
      : []
    const countedSet = new Set(countedRaw.map((id) => String(id || '').trim()))
    const hasAttendanceAppliedAt = Boolean(lessonLatest.attendanceAppliedAt)
    if (hasAttendanceAppliedAt && countedSet.size > 0) return

    const rows = buildSyncRowsForPastLesson(lessonLatest, gid)
    for (const row of rows) {
      if (row.isCounted || !row.canDeduct) continue
      await applyGroupLessonAttendanceDeduction(row.groupStudent, lessonLatest, gid)
    }
  }

  async function openGroupLessonAttendanceModal(lesson) {
    if (!(userProfile?.role === 'admin' || userProfile?.canManageAttendance === true)) {
      alert('출석 관리 권한이 없습니다.')
      return
    }
    if (!lesson?.id) return
    await syncPastGroupLessonAttendance(lesson)
    setGroupLessonAttendanceModal({ lesson })
  }

  async function openCalendarGroupLessonAttendance(lesson) {
    if (!(userProfile?.role === 'admin' || userProfile?.canManageAttendance === true)) {
      return
    }
    const gid = getGroupLessonGroupId(lesson)
    if (!gid) return
    const matchedGroupClass =
      groupClasses.find((g) => String(g.id) === String(gid)) || null
    if (!matchedGroupClass) return
    setSelectedGroupClass(matchedGroupClass)
    await openGroupLessonAttendanceModal(lesson)
  }

  return {
    groupLessonAttendanceModal,
    busyGroupAttendanceStudentId,
    closeGroupLessonAttendanceModal,
    isPastGroupLesson,
    openGroupLessonAttendanceModal,
    openCalendarGroupLessonAttendance,
    applyGroupLessonAttendanceDeduction,
    applyGroupLessonAttendanceUndo,
  }
}
