import { useMemo, useState } from 'react'
import { doc, getDoc, writeBatch } from 'firebase/firestore'
import { db } from '../../../../firebase'
import {
  addCalendarDaysToYmd,
  getGroupLessonGroupId,
  getTodayStorageDateString,
  GROUP_CLASS_AUTO_LESSON_RANGE_LAST_OFFSET_DAYS,
  normalizeText,
  parseYmdToLocalDate,
} from '../dashboardViewUtils.js'

function maxLexYmd(a, b) {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function hasGroupLessonAttendanceAppliedField(v) {
  if (v == null || v === '') return false
  if (typeof v?.toDate === 'function') return true
  if (v?.seconds != null) return true
  return Boolean(v)
}

function isGroupLessonInScheduleRebuildWindow(gl, groupId, effectiveFromYmd) {
  if (getGroupLessonGroupId(gl) !== String(groupId)) return false
  const ds = String(gl.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return false
  return ds >= effectiveFromYmd
}

function isGroupLessonEligibleScheduleRebuildDelete(gl, groupId, effectiveFromYmd) {
  if (!gl?.id) return false
  if (getGroupLessonGroupId(gl) !== String(groupId)) return false
  const ds = String(gl.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ds)) return false
  if (ds < effectiveFromYmd) return false
  if (gl.completed === true) return false
  const counted = Array.isArray(gl.countedStudentIDs) ? gl.countedStudentIDs : []
  if (counted.some((x) => String(x || '').trim())) return false
  if (hasGroupLessonAttendanceAppliedField(gl.attendanceAppliedAt)) return false
  if (gl.generationKind === 'manual') return false
  return true
}

export default function useGroupScheduleRebuildFlow({
  userProfile,
  fetchGroupLessonsForClassIdMerge,
  createGroupLessonsInDateRange,
}) {
  const [postGroupScheduleRebuildModalData, setPostGroupScheduleRebuildModalData] =
    useState(null)
  const [postGroupScheduleRebuildFromDate, setPostGroupScheduleRebuildFromDate] = useState('')
  const [postGroupScheduleRebuildErrors, setPostGroupScheduleRebuildErrors] = useState({})
  const [busyPostGroupScheduleRebuild, setBusyPostGroupScheduleRebuild] = useState(false)

  const postGroupScheduleRebuildEffectiveFromYmd = useMemo(() => {
    const enteredFromYmd = String(postGroupScheduleRebuildFromDate || '').trim()
    const todayYmd = getTodayStorageDateString()
    return enteredFromYmd ? maxLexYmd(enteredFromYmd, todayYmd) : todayYmd
  }, [postGroupScheduleRebuildFromDate])

  function openPostGroupScheduleRebuildModal(data, fromYmd) {
    setPostGroupScheduleRebuildFromDate(String(fromYmd || '').trim())
    setPostGroupScheduleRebuildErrors({})
    setPostGroupScheduleRebuildModalData(data || null)
  }

  function closePostGroupScheduleRebuildModal(options = {}) {
    if (!options.force && busyPostGroupScheduleRebuild) return
    setPostGroupScheduleRebuildModalData(null)
    setPostGroupScheduleRebuildFromDate('')
    setPostGroupScheduleRebuildErrors({})
  }

  function validatePostGroupScheduleRebuildFromDate(fromDate) {
    const fromD = String(fromDate || '').trim()
    if (!fromD) {
      return { valid: false, errors: { fromDate: '기준일을 선택해주세요.' } }
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fromD) || !parseYmdToLocalDate(fromD)) {
      return { valid: false, errors: { fromDate: '유효한 기준일을 선택해주세요.' } }
    }
    return { valid: true, errors: {}, fromDate: fromD }
  }

  async function submitPostGroupScheduleRebuild() {
    const data = postGroupScheduleRebuildModalData
    if (!data?.groupId) return
    if (userProfile?.role !== 'admin') {
      alert('관리자만 사용할 수 있습니다.')
      return
    }

    const validation = validatePostGroupScheduleRebuildFromDate(
      postGroupScheduleRebuildFromDate
    )
    setPostGroupScheduleRebuildErrors(validation.errors)
    if (!validation.valid) return

    const todayYmd = getTodayStorageDateString()
    const effectiveFromYmd = maxLexYmd(validation.fromDate, todayYmd)
    const gid = String(data.groupId)

    let sourceGroupLessons
    try {
      sourceGroupLessons = await fetchGroupLessonsForClassIdMerge(gid)
    } catch (error) {
      console.error('그룹 수업 목록 불러오기 실패:', error)
      alert(`그룹 수업 목록을 불러오지 못했습니다: ${error.message}`)
      return
    }

    const windowLessons = sourceGroupLessons.filter((gl) =>
      isGroupLessonInScheduleRebuildWindow(gl, gid, effectiveFromYmd)
    )
    const toDelete = windowLessons.filter((gl) =>
      isGroupLessonEligibleScheduleRebuildDelete(gl, gid, effectiveFromYmd)
    )
    const skippedProtected = windowLessons.filter(
      (gl) => !isGroupLessonEligibleScheduleRebuildDelete(gl, gid, effectiveFromYmd)
    )

    if (skippedProtected.length > 0) {
      const proceed = window.confirm(
        `기준일(${effectiveFromYmd}) 이후 일정 중, 삭제·재생성에서 제외되는 수업(출석 반영·완료·특별 수업 등)이 ${skippedProtected.length}건 있습니다. 계속할까요?`
      )
      if (!proceed) return
    }

    const deletedLessonIds = new Set(toDelete.map((gl) => gl.id))
    let maxDelDate = null
    for (const gl of toDelete) {
      const ds = String(gl.date || '').trim()
      if (!maxDelDate || ds > maxDelDate) maxDelDate = ds
    }

    const endYmd =
      maxDelDate ||
      addCalendarDaysToYmd(effectiveFromYmd, GROUP_CLASS_AUTO_LESSON_RANGE_LAST_OFFSET_DAYS)

    try {
      setBusyPostGroupScheduleRebuild(true)
      const chunkSize = 400
      for (let i = 0; i < toDelete.length; i += chunkSize) {
        const batch = writeBatch(db)
        const chunk = toDelete.slice(i, i + chunkSize)
        for (const gl of chunk) {
          batch.delete(doc(db, 'groupLessons', gl.id))
        }
        await batch.commit()
      }

      const groupSnap = await getDoc(doc(db, 'groupClasses', gid))
      if (!groupSnap.exists()) throw new Error('반 정보를 찾을 수 없습니다.')
      const g = { id: groupSnap.id, ...groupSnap.data() }

      const existingAfterDelete = sourceGroupLessons.filter((gl) => !deletedLessonIds.has(gl.id))

      const { created, skippedDup } = await createGroupLessonsInDateRange({
        groupClassId: gid,
        groupClassName: g.name || data.groupName || '',
        teacher: normalizeText(g.teacher || ''),
        time: String(g.time || '').trim(),
        subject: String(g.subject || '').trim(),
        weekdays: g.weekdays,
        maxStudents: g.maxStudents,
        startYmd: effectiveFromYmd,
        endYmd,
        existingLessons: existingAfterDelete,
      })

      closePostGroupScheduleRebuildModal({ force: true })
      let msg = `처리했습니다. 적용 기준일: ${effectiveFromYmd}\n삭제 ${toDelete.length}건, 새로 생성 ${created}건 (중복 건너뜀 ${skippedDup}건).`
      if (skippedProtected.length > 0) {
        msg += `\n제외된 일정 ${skippedProtected.length}건은 그대로 두었습니다.`
      }
      alert(msg)
    } catch (error) {
      console.error('그룹 일정 재생성 실패:', error)
      alert(`처리 실패: ${error.message}`)
    } finally {
      setBusyPostGroupScheduleRebuild(false)
    }
  }

  return {
    postGroupScheduleRebuildModalData,
    postGroupScheduleRebuildFromDate,
    setPostGroupScheduleRebuildFromDate,
    postGroupScheduleRebuildErrors,
    busyPostGroupScheduleRebuild,
    postGroupScheduleRebuildEffectiveFromYmd,
    openPostGroupScheduleRebuildModal,
    closePostGroupScheduleRebuildModal,
    submitPostGroupScheduleRebuild,
    validatePostGroupScheduleRebuildFromDate,
  }
}
