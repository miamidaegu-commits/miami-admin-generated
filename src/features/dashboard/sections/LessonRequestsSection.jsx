import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../../../firebase.js'
import { assertSameAcademy, requireCurrentAcademyId } from '../academyScope.js'
import { parseLegacyLessonToDate } from '../dashboardViewUtils.js'
import {
  ensurePrivatePackageForFixedLessons,
  fetchActivePrivatePackagesForTeacher,
} from '../privatePackageHelpers.js'
import { addStudentPrivateTeacherAccessBatch } from '../../private-booking/studentPrivateAccessSummaryClient.js'

function cleanText(value, fallback = '-') {
  const text = String(value || '').trim()
  return text || fallback
}

function formatTimestamp(value) {
  if (!value) return '-'
  const date = typeof value.toDate === 'function' ? value.toDate() : new Date(value)
  if (Number.isNaN(date.getTime())) return '-'
  return date.toLocaleString('ko-KR', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function timestampSortValue(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 0 : date.getTime()
}

function sortPendingRequests(snapshot) {
  return snapshot.docs
    .map((docItem) => ({ id: docItem.id, ...docItem.data() }))
    .filter((row) => getApprovalStatus(row) === 'pending')
    .sort((a, b) => timestampSortValue(b.createdAt) - timestampSortValue(a.createdAt))
}

function formatYmd(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function addWeeksToYmd(ymd, weeks) {
  const parts = String(ymd || '').split('-').map(Number)
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return ''
  const date = new Date(parts[0], parts[1] - 1, parts[2] + weeks * 7)
  if (Number.isNaN(date.getTime())) return ''
  return formatYmd(date)
}

function getRepeatWeeks(request) {
  const candidates = [
    request?.repeatWeeks,
    request?.repeatCount,
    request?.recurrenceCount,
    request?.lessonCount,
    request?.numberOfLessons,
    request?.sessions,
    request?.durationWeeks,
    request?.count,
  ]
  let fallback = 1
  for (const candidate of candidates) {
    const parsed = Number.parseInt(String(candidate ?? ''), 10)
    if (Number.isInteger(parsed) && parsed > 1) return Math.min(parsed, 60)
    if (Number.isInteger(parsed) && parsed === 1) fallback = 1
  }
  return fallback
}

function isRecurringRequest(request) {
  return request?.repeatWeekly === true ||
    request?.repeat === true ||
    request?.isRecurring === true ||
    request?.repeatEnabled === true ||
    getRepeatWeeks(request) > 1
}

function getLessonTime(lesson) {
  return String(lesson?.time || lesson?.startTime || '').trim()
}

function getLessonTeacher(lesson) {
  return String(lesson?.teacher || lesson?.teacherName || '').trim()
}

function getLessonStudentId(lesson) {
  return String(lesson?.studentId || lesson?.studentID || '').trim()
}

function isActivePrivateLessonForSessionNumber(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  return lesson?.isDeductCancelled !== true &&
    lesson?.cancelled !== true &&
    status !== 'cancelled' &&
    status !== 'canceled'
}

function compareSessionLessonRows(a, b) {
  const dateCompare = String(a.date || '').localeCompare(String(b.date || ''))
  if (dateCompare !== 0) return dateCompare
  const timeCompare = String(a.time || '').localeCompare(String(b.time || ''))
  if (timeCompare !== 0) return timeCompare
  return String(a.id || '').localeCompare(String(b.id || ''))
}

async function fetchExistingSessionLessons({ academyId, studentId, teacher }) {
  const querySpecs = ['studentId', 'studentID']
  const byId = new Map()

  await Promise.all(
    querySpecs.map(async (studentField) => {
      const snapshot = await getDocs(
        query(
          collection(db, 'lessons'),
          where('academyId', '==', academyId),
          where(studentField, '==', studentId)
        )
      )

      snapshot.docs.forEach((docItem) => {
        const data = docItem.data() || {}
        if (String(data.academyId || '').trim() !== academyId) return
        if (getLessonStudentId(data) !== studentId) return
        if (getLessonTeacher(data) !== teacher) return
        if (!isActivePrivateLessonForSessionNumber(data)) return
        byId.set(docItem.id, {
          kind: 'existing',
          id: docItem.id,
          ref: docItem.ref,
          data,
          date: String(data.date || '').trim(),
          time: getLessonTime(data),
          currentSessionNumber: Number(data.sessionNumber || 0),
        })
      })
    })
  )

  return Array.from(byId.values())
}

function planSessionNumberWrites({ existingLessons, newLessons }) {
  const rows = [...existingLessons, ...newLessons]
    .filter((row) => /^\d{4}-\d{2}-\d{2}$/.test(String(row.date || '')))
    .sort(compareSessionLessonRows)

  const existingUpdates = []
  const newSessionNumbers = new Map()

  rows.forEach((row, index) => {
    const nextSessionNumber = index + 1
    if (row.kind === 'new') {
      newSessionNumbers.set(row.id, nextSessionNumber)
      return
    }
    if (Number(row.currentSessionNumber || 0) !== nextSessionNumber) {
      existingUpdates.push({
        ref: row.ref,
        id: row.id,
        sessionNumber: nextSessionNumber,
      })
    }
  })

  return {
    existingUpdates,
    newSessionNumbers,
  }
}

function buildLessonDates(request) {
  const date = String(request?.date || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return []
  const repeatWeekly = isRecurringRequest(request)
  const repeatWeeks = repeatWeekly ? getRepeatWeeks(request) : 1

  const dates = []
  for (let index = 0; index < repeatWeeks; index += 1) {
    const nextDate = addWeeksToYmd(date, index)
    if (nextDate) dates.push(nextDate)
  }
  return dates
}

function reviewerNameFor(user, userProfile) {
  return cleanText(
    userProfile?.displayName ||
      userProfile?.teacherName ||
      userProfile?.email ||
      user?.displayName ||
      user?.email,
    'admin'
  )
}

function canReviewLessonRequests(userProfile) {
  const role = String(userProfile?.role || '').trim().toLowerCase()
  const membershipRole = String(userProfile?.membershipRole || '').trim().toLowerCase()
  return role === 'admin' || role === 'owner' || membershipRole === 'admin' || membershipRole === 'owner'
}

function buildLessonPayload({
  academyId,
  lessonRequest,
  lessonRequestId,
  lessonDate,
  seriesID,
  sessionNumber,
  selectedPackage,
  user,
  userProfile,
}) {
  const time = String(lessonRequest.time || '').trim()
  const startAt = parseLegacyLessonToDate(lessonDate, time)
  const studentId = cleanText(lessonRequest.studentId || lessonRequest.studentID, '')
  const studentName = cleanText(lessonRequest.studentName || lessonRequest.student, '')
  const teacher = cleanText(lessonRequest.teacher || lessonRequest.teacherName, '')
  const reviewerName = reviewerNameFor(user, userProfile)

  return {
    academyId,
    teacher,
    teacherName: cleanText(lessonRequest.teacherName || teacher, teacher),
    student: cleanText(lessonRequest.student || studentName, studentName),
    studentName,
    studentId,
    studentID: cleanText(lessonRequest.studentID || studentId, studentId),
    date: lessonDate,
    time,
    subject: String(lessonRequest.subject || '').trim(),
    completed: false,
    isDeductCancelled: false,
    deductMemo: '',
    lessonRequestId,
    sourceType: 'lessonRequest',
    ...(selectedPackage
      ? {
          packageId: selectedPackage.id,
          packageType: 'private',
          packageTitle: String(selectedPackage.title || '고정 1:1'),
          billingType: 'private',
        }
      : {}),
    createdBy: reviewerName,
    createdByUID: user?.uid || '',
    createdByUid: user?.uid || '',
    ...(startAt ? { startAt: Timestamp.fromDate(startAt) } : {}),
    ...(seriesID ? { seriesID } : {}),
    ...(sessionNumber ? { sessionNumber } : {}),
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  }
}

function getFixedPrivateTotalCount(lessonRequest, fallbackCount = 0) {
  const candidates = [
    lessonRequest?.fixedPrivateTotalCount,
    lessonRequest?.paidLessons,
    lessonRequest?.totalCount,
    lessonRequest?.lessonCount,
    lessonRequest?.numberOfLessons,
    lessonRequest?.sessions,
    lessonRequest?.recurrenceCount,
    lessonRequest?.repeatCount,
    lessonRequest?.count,
    lessonRequest?.durationWeeks,
  ]
  for (const candidate of candidates) {
    const parsed = Number(candidate)
    if (Number.isInteger(parsed) && parsed > 0) return parsed
  }
  return fallbackCount > 0 ? fallbackCount : 0
}

function getApprovalStatus(request) {
  return String(request?.approvalStatus || request?.status || '').trim().toLowerCase()
}

function describeFirestoreRef(ref) {
  const path = ref?.path || ''
  const parts = path.split('/').filter(Boolean)
  return {
    path,
    collection: parts.length >= 2 ? parts[parts.length - 2] : parts[0] || '',
    docId: parts[parts.length - 1] || '',
  }
}

function makeApprovalStepLogger(baseContext) {
  const steps = []
  return {
    steps,
    record(stepName, ref, operation = 'write') {
      steps.push({
        ...baseContext,
        stepName,
        operation,
        ...describeFirestoreRef(ref),
      })
    },
  }
}

function logApprovalFailure(error, context, plannedSteps) {
  const diagnostic = {
    ...context,
    stepName: 'batch.commit',
    firebaseCode: error?.code || '',
    firebaseMessage: error?.message || String(error || ''),
    plannedSteps,
  }
  console.error('수업 요청 승인 Firestore 진단:', diagnostic)
}

function validateRequestForApproval(request, academyId) {
  assertSameAcademy(request, academyId, '수업 요청')
  if (getApprovalStatus(request) !== 'pending') {
    throw new Error('이미 처리된 수업 요청입니다.')
  }
  const dates = buildLessonDates(request)
  if (dates.length === 0) throw new Error('요청 날짜 형식이 올바르지 않습니다.')
  if (!/^\d{2}:\d{2}$/.test(String(request.time || '').trim())) {
    throw new Error('요청 시간이 올바르지 않습니다.')
  }
  if (!cleanText(request.studentId || request.studentID, '')) {
    throw new Error('학생 ID가 없는 요청은 승인할 수 없습니다.')
  }
  if (!cleanText(request.studentName || request.student, '')) {
    throw new Error('학생 이름이 없는 요청은 승인할 수 없습니다.')
  }
  if (!cleanText(request.teacher || request.teacherName, '')) {
    throw new Error('선생님 정보가 없는 요청은 승인할 수 없습니다.')
  }
  return dates
}

export default function LessonRequestsSection({ currentAcademyId, user, userProfile }) {
  const [lessonRequests, setLessonRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const [busyRequestId, setBusyRequestId] = useState('')
  const canReviewRequests = canReviewLessonRequests(userProfile)

  useEffect(() => {
    if (!canReviewRequests) {
      setLessonRequests([])
      setLoading(false)
      return
    }

    let scopedAcademyId = ''
    try {
      scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    } catch (error) {
      console.warn('수업 요청 관리 학원 범위 확인 실패:', error)
      setLessonRequests([])
      setLoading(false)
      return
    }

    setLoading(true)
    const handleSnapshot = (snapshot) => {
      setLessonRequests(sortPendingRequests(snapshot))
      setLoading(false)
    }
    const handleError = (error) => {
      console.error('수업 요청 목록 불러오기 실패:', error)
      setLessonRequests([])
      setLoading(false)
    }

    const unsubscribe = onSnapshot(
      query(
        collection(db, 'lessonRequests'),
        where('academyId', '==', scopedAcademyId),
        where('approvalStatus', '==', 'pending')
      ),
      handleSnapshot,
      handleError
    )

    return () => {
      unsubscribe()
    }
  }, [canReviewRequests, currentAcademyId])

  const pendingCount = lessonRequests.length

  const requestRows = useMemo(
    () =>
      lessonRequests.map((request) => ({
        ...request,
        repeatWeeksValue: getRepeatWeeks(request),
      })),
    [lessonRequests]
  )

  async function approveRequest(lessonRequest) {
    if (!canReviewRequests) {
      alert('관리자만 수업 요청을 승인할 수 있습니다.')
      return
    }
    if (!lessonRequest?.id || busyRequestId) return

    let plannedApprovalSteps = []

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      const dates = validateRequestForApproval(lessonRequest, scopedAcademyId)
      const isRepeat = isRecurringRequest(lessonRequest) && dates.length > 1
      const seriesID = isRepeat
        ? cleanText(
            lessonRequest.seriesID,
            `lesson-request-series-${lessonRequest.id}-${Date.now()}`
          )
        : ''
      const studentId = cleanText(lessonRequest.studentId || lessonRequest.studentID, '')
      const teacher = cleanText(lessonRequest.teacher || lessonRequest.teacherName, '')
      const studentName = cleanText(lessonRequest.studentName || lessonRequest.student, '-')
      const reviewerName = reviewerNameFor(user, userProfile)
      const diagnostics = makeApprovalStepLogger({
        requestId: lessonRequest.id,
        academyId: scopedAcademyId,
        studentId,
        studentName,
        teacher,
      })
      plannedApprovalSteps = diagnostics.steps
      const batch = writeBatch(db)
      const createdLessonRefs = dates.map(() => doc(collection(db, 'lessons')))
      setBusyRequestId(lessonRequest.id)
      let fixedPrivateTotalCount = getFixedPrivateTotalCount(lessonRequest, dates.length)
      if (fixedPrivateTotalCount <= 0) {
        const studentSnap = await getDocs(
          query(
            collection(db, 'privateStudents'),
            where('academyId', '==', scopedAcademyId)
          )
        )
        const studentDoc = studentSnap.docs.find((docItem) => docItem.id === studentId)
        if (studentDoc) {
          const studentData = studentDoc.data() || {}
          assertSameAcademy(studentData, scopedAcademyId, '학생')
          const paidLessons = Number(studentData.paidLessons || 0)
          if (Number.isInteger(paidLessons) && paidLessons > 0) {
            fixedPrivateTotalCount = paidLessons
          }
        }
      }
      let selectedPackage = null
      if (fixedPrivateTotalCount > 0) {
        const packageResult = await ensurePrivatePackageForFixedLessons({
          db,
          academyId: scopedAcademyId,
          studentId,
          studentName,
          teacher,
          totalCount: fixedPrivateTotalCount,
        })
        selectedPackage = {
          id: packageResult.packageId,
          ...(packageResult.packageData || {}),
        }
        if (packageResult.created) {
          batch.set(packageResult.packageRef, packageResult.packageData)
          diagnostics.record('studentPackages.create', packageResult.packageRef, 'set')
          addStudentPrivateTeacherAccessBatch(batch, db, {
            academyId: scopedAcademyId,
            studentId,
            teacher,
            packageId: packageResult.packageId,
          })
          diagnostics.record(
            'studentPrivateAccessSummary.upsert',
            doc(db, 'studentPrivateAccessSummary', `${scopedAcademyId}__${studentId}`),
            'set'
          )
          const creditRef = doc(collection(db, 'creditTransactions'))
          batch.set(creditRef, {
            academyId: scopedAcademyId,
            studentId,
            studentName,
            teacher,
            packageId: packageResult.packageId,
            packageType: 'private',
            packageTitle: '고정 1:1',
            groupClassName: '',
            sourceType: 'studentPackage',
            sourceId: packageResult.packageId,
            actionType: 'package_created',
            deltaCount: fixedPrivateTotalCount,
            memo: '고정 1:1 수강권 자동 생성',
            actorUid: user?.uid || '',
            actorRole: 'admin',
            createdAt: serverTimestamp(),
          })
          diagnostics.record('creditTransactions.create', creditRef, 'set')
        }
      } else {
        const matchingPackages = await fetchActivePrivatePackagesForTeacher({
          db,
          academyId: scopedAcademyId,
          studentId,
          teacher,
        })
        if (matchingPackages.length === 1) {
          selectedPackage = matchingPackages[0]
        } else if (matchingPackages.length > 1) {
          throw new Error('같은 선생님의 활성 개인 수강권이 여러 개 있어 자동 연결할 수 없습니다.')
        }
      }
      const existingLessons = await fetchExistingSessionLessons({
        academyId: scopedAcademyId,
        studentId,
        teacher,
      })
      const newLessonRows = createdLessonRefs.map((lessonRef, index) => ({
        kind: 'new',
        id: lessonRef.id,
        ref: lessonRef,
        date: dates[index],
        time: String(lessonRequest.time || '').trim(),
      }))
      const { existingUpdates, newSessionNumbers } = planSessionNumberWrites({
        existingLessons,
        newLessons: newLessonRows,
      })
      const batchWriteCount = createdLessonRefs.length + existingUpdates.length + 1

      if (batchWriteCount > 500) {
        throw new Error(
          `승인할 수업과 회차 업데이트가 ${batchWriteCount}건입니다. Firestore 한도를 초과하므로 안전하게 중단했습니다. 관리자가 학생별 회차 재정렬 스크립트로 나누어 처리해 주세요.`
        )
      }

      createdLessonRefs.forEach((lessonRef, index) => {
        const sessionNumber = newSessionNumbers.get(lessonRef.id)
        batch.set(
          lessonRef,
          buildLessonPayload({
            academyId: scopedAcademyId,
            lessonRequest,
            lessonRequestId: lessonRequest.id,
            lessonDate: dates[index],
            seriesID,
            sessionNumber,
            selectedPackage,
            user,
            userProfile,
          })
        )
        diagnostics.record('lessons.create', lessonRef, 'set')
      })

      existingUpdates.forEach((update) => {
        batch.update(update.ref, {
          sessionNumber: update.sessionNumber,
          updatedAt: serverTimestamp(),
        })
        diagnostics.record('lessons.sessionNumber.update', update.ref, 'update')
      })

      const requestPatch = {
        approvalStatus: 'approved',
        rejectionReason: String(lessonRequest.rejectionReason || ''),
        updatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
        approvedAt: serverTimestamp(),
        reviewedBy: reviewerName,
        reviewedByUID: user?.uid || '',
        reviewedByName: reviewerName,
        approvedBy: reviewerName,
        approvedByUID: user?.uid || '',
        approvedByName: reviewerName,
      }
      if (Object.prototype.hasOwnProperty.call(lessonRequest, 'status')) {
        requestPatch.status = 'approved'
      }
      if (selectedPackage?.id) {
        requestPatch.fixedPrivatePackageId = selectedPackage.id
      }
      if (createdLessonRefs.length === 1) {
        requestPatch.lessonId = createdLessonRefs[0].id
        requestPatch.lessonID = createdLessonRefs[0].id
      }

      const requestRef = doc(db, 'lessonRequests', lessonRequest.id)
      batch.update(requestRef, requestPatch)
      diagnostics.record('lessonRequests.approve.update', requestRef, 'update')
      await batch.commit()
    } catch (error) {
      const studentId = cleanText(lessonRequest.studentId || lessonRequest.studentID, '')
      const teacher = cleanText(lessonRequest.teacher || lessonRequest.teacherName, '')
      logApprovalFailure(
        error,
        {
          requestId: lessonRequest?.id || '',
          academyId: currentAcademyId || '',
          studentId,
          studentName: cleanText(lessonRequest.studentName || lessonRequest.student, '-'),
          teacher,
        },
        plannedApprovalSteps
      )
      console.error('수업 요청 승인 실패:', error)
      alert(
        error?.code
          ? `${error.code}: ${error.message || '수업 요청 승인에 실패했습니다.'}`
          : error.message || '수업 요청 승인에 실패했습니다.'
      )
    } finally {
      setBusyRequestId('')
    }
  }

  async function rejectRequest(lessonRequest) {
    if (!canReviewRequests) {
      alert('관리자만 수업 요청을 거절할 수 있습니다.')
      return
    }
    if (!lessonRequest?.id || busyRequestId) return

    const rejectionReason = window.prompt('거절 사유를 입력해 주세요.')
    if (rejectionReason == null) return
    const trimmedReason = rejectionReason.trim()
    if (!trimmedReason) {
      alert('거절 사유를 입력해 주세요.')
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(lessonRequest, scopedAcademyId, '수업 요청')
      if (lessonRequest.approvalStatus !== 'pending') {
        throw new Error('이미 처리된 수업 요청입니다.')
      }

      const reviewerName = reviewerNameFor(user, userProfile)
      setBusyRequestId(lessonRequest.id)
      await updateDoc(doc(db, 'lessonRequests', lessonRequest.id), {
        approvalStatus: 'rejected',
        ...(Object.prototype.hasOwnProperty.call(lessonRequest, 'status')
          ? { status: 'rejected' }
          : {}),
        rejectionReason: trimmedReason,
        updatedAt: serverTimestamp(),
        reviewedAt: serverTimestamp(),
        rejectedAt: serverTimestamp(),
        reviewedBy: reviewerName,
        reviewedByUID: user?.uid || '',
        reviewedByName: reviewerName,
        rejectedBy: reviewerName,
        rejectedByUID: user?.uid || '',
        rejectedByName: reviewerName,
      })
    } catch (error) {
      console.error('수업 요청 거절 실패:', error)
      alert(error.message || '수업 요청 거절에 실패했습니다.')
    } finally {
      setBusyRequestId('')
    }
  }

  if (!canReviewRequests) {
    return null
  }

  return (
    <section className="activity-section" data-testid="lesson-requests-section">
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 16,
          flexWrap: 'wrap',
        }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          수업 요청 관리
        </h2>
        <span style={{ color: '#aab5c4', fontSize: 13 }}>대기 {pendingCount}건</span>
      </div>

      {loading ? (
        <p>불러오는 중...</p>
      ) : requestRows.length === 0 ? (
        <p style={{ opacity: 0.8 }}>대기 중인 수업 요청이 없습니다.</p>
      ) : (
        <div className="activity-table" data-testid="lesson-requests-table">
          <div
            className="table-head"
            style={{
              gridTemplateColumns:
                '1fr 0.9fr 0.85fr 0.7fr 0.9fr 0.75fr 0.75fr 1.1fr minmax(132px, auto)',
            }}
          >
            <span>학생 이름</span>
            <span>선생님</span>
            <span>날짜</span>
            <span>시간</span>
            <span>과목</span>
            <span>반복 여부</span>
            <span>반복 횟수</span>
            <span>생성일</span>
            <span>작업</span>
          </div>
          {requestRows.map((request) => {
            const busy = busyRequestId === request.id
            return (
              <div
                key={request.id}
                className="table-row"
                data-testid="lesson-request-row"
                data-request-id={request.id}
                data-student-name={cleanText(request.studentName || request.student)}
                style={{
                  gridTemplateColumns:
                    '1fr 0.9fr 0.85fr 0.7fr 0.9fr 0.75fr 0.75fr 1.1fr minmax(132px, auto)',
                }}
              >
                <span>{cleanText(request.studentName || request.student)}</span>
                <span>{cleanText(request.teacherName || request.teacher)}</span>
                <span>{cleanText(request.date)}</span>
                <span>{cleanText(request.time)}</span>
                <span>{cleanText(request.subject)}</span>
                <span>{isRecurringRequest(request) ? '반복' : '단일'}</span>
                <span>{isRecurringRequest(request) ? request.repeatWeeksValue : 1}</span>
                <span>{formatTimestamp(request.createdAt)}</span>
                <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    onClick={() => approveRequest(request)}
                    disabled={busy || Boolean(busyRequestId)}
                    data-testid="lesson-request-approve-button"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #34543d',
                      background: '#20351f',
                      color: 'white',
                      cursor: busy || busyRequestId ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {busy ? '처리 중...' : '승인'}
                  </button>
                  <button
                    type="button"
                    onClick={() => rejectRequest(request)}
                    disabled={busy || Boolean(busyRequestId)}
                    data-testid="lesson-request-reject-button"
                    style={{
                      padding: '6px 10px',
                      borderRadius: 8,
                      border: '1px solid #553333',
                      background: '#4a2a2a',
                      color: 'white',
                      cursor: busy || busyRequestId ? 'not-allowed' : 'pointer',
                    }}
                  >
                    거절
                  </button>
                </span>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
