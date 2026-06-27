import { useState } from 'react'
import {
  collection,
  deleteField,
  doc,
  getDocFromServer,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../../../firebase'
import { assertSameAcademy, requireCurrentAcademyId } from '../academyScope.js'
import {
  creditTransactionCreatedAtToMillis,
  getTodayStorageDateString,
  getNextStudentPackageStatus,
  normalizeText,
  parseYmdToLocalDate,
  parseRequiredMinOneIntField,
} from '../dashboardViewUtils.js'
import {
  buildStudentGroupAccessPayloadFromGroupStudent,
  updateStudentGroupAccessBatch,
} from '../../group-booking/studentGroupAccessClient.js'
import { syncStudentGroupCourseTypeAccessSummary } from '../../group-booking/studentGroupAccessSummaryClient.js'
import { removeStudentPrivateTeacherAccessBatch } from '../../private-booking/studentPrivateAccessSummaryClient.js'
import { canViewBillingFields } from '../billingPermissions.js'

const DEFAULT_STUDENT_PACKAGE_EDIT_FORM = {
  title: '',
  totalCount: '',
  expiresAt: '',
  paymentDate: '',
  amountPaid: '',
  memo: '',
  allowGroupFreeBooking: false,
}

function createDefaultStudentPackageEditForm(overrides = {}) {
  return {
    ...DEFAULT_STUDENT_PACKAGE_EDIT_FORM,
    ...overrides,
  }
}

function getPrivatePackageTeacher(pkg) {
  return normalizeText(pkg?.teacherKey || pkg?.teacher || pkg?.teacherName || '')
}

function getPackageLinkedIds(row) {
  return [
    row?.packageId,
    row?.deductionPackageId,
    row?.studentPackageId,
    row?.privatePackageId,
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
}

function isActivePrivateReservationStatus(status) {
  return ['active', 'reserved', 'confirmed', 'booked'].includes(
    String(status || '').trim().toLowerCase()
  )
}

function isFuturePackageRow(row) {
  const date = String(row?.date || row?.lessonDate || row?.scheduleDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date >= getTodayStorageDateString()
  const startAt = row?.startAt || row?.startsAt
  if (startAt && typeof startAt.toMillis === 'function') return startAt.toMillis() >= Date.now()
  if (startAt && typeof startAt.toDate === 'function') return startAt.toDate().getTime() >= Date.now()
  return false
}

function isBlockingPrivateLessonForRevoke(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase()
  if (
    lesson?.cancelled === true ||
    lesson?.canceled === true ||
    lesson?.isDeductCancelled === true ||
    lesson?.noDeduction === true ||
    status === 'cancelled' ||
    status === 'canceled'
  ) {
    return false
  }
  const sourceType = String(lesson?.sourceType || '').trim()
  if (
    String(lesson?.packageType || '').trim() === 'private' &&
    sourceType === 'fixed-private-slot-assignment'
  ) {
    return isFuturePackageRow(lesson)
  }
  const date = String(lesson?.date || lesson?.lessonDate || lesson?.scheduleDate || '').trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return date >= getTodayStorageDateString()
  }
  const startAt = lesson?.startAt || lesson?.startsAt
  if (startAt && typeof startAt.toMillis === 'function') return startAt.toMillis() >= Date.now()
  if (startAt && typeof startAt.toDate === 'function') return startAt.toDate().getTime() >= Date.now()
  return false
}

export default function useStudentPackageAdminFlow({
  user,
  userProfile,
  currentAcademyId,
  addCreditTransaction,
  studentDocFieldToYmdString,
  onStudentPackageRevoked,
}) {
  const [studentPackageEditModalPackage, setStudentPackageEditModalPackage] =
    useState(null)
  const [studentPackageEditForm, setStudentPackageEditForm] = useState(
    createDefaultStudentPackageEditForm()
  )
  const [studentPackageEditFormErrors, setStudentPackageEditFormErrors] = useState({})
  const [busyStudentPackageActionId, setBusyStudentPackageActionId] = useState(null)
  const [studentPackageHistoryModalPackage, setStudentPackageHistoryModalPackage] =
    useState(null)
  const [studentPackageHistoryRows, setStudentPackageHistoryRows] = useState([])
  const [studentPackageHistoryLoading, setStudentPackageHistoryLoading] = useState(false)

  function closeStudentPackageEditModal() {
    setStudentPackageEditModalPackage(null)
    setStudentPackageEditFormErrors({})
  }

  function closeStudentPackageHistoryModal() {
    setStudentPackageHistoryModalPackage(null)
    setStudentPackageHistoryRows([])
    setStudentPackageHistoryLoading(false)
  }

  function isAdminPackageEditor() {
    return canViewBillingFields(userProfile)
  }

  function canEditStudentPackageCountsForPackage(pkg) {
    if (!pkg?.id) return false
    return isAdminPackageEditor()
  }

  function getStudentPackageEditMode(pkg) {
    if (!pkg?.id) return 'none'
    return isAdminPackageEditor() ? 'admin' : 'none'
  }

  async function openStudentPackageHistoryModal(pkg) {
    if (!isAdminPackageEditor() || !pkg?.id) return
    setStudentPackageHistoryModalPackage(pkg)
    setStudentPackageHistoryRows([])
    setStudentPackageHistoryLoading(true)
    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(pkg, scopedAcademyId, '수강권')
      const q = query(
        collection(db, 'creditTransactions'),
        where('academyId', '==', scopedAcademyId),
        where('packageId', '==', pkg.id)
      )
      const snap = await getDocs(q)
      const rows = snap.docs.map((docItem) => ({
        id: docItem.id,
        ...docItem.data(),
      }))
      rows.sort(
        (a, b) =>
          creditTransactionCreatedAtToMillis(b.createdAt) -
          creditTransactionCreatedAtToMillis(a.createdAt)
      )
      setStudentPackageHistoryRows(rows)
    } catch (error) {
      console.error('수강권 이력 조회 실패:', error)
      alert(`수강권 이력을 불러오지 못했습니다: ${error.message}`)
      setStudentPackageHistoryRows([])
    } finally {
      setStudentPackageHistoryLoading(false)
    }
  }

  function openStudentPackageEditModal(pkg) {
    if (!pkg?.id) return
    if (!canEditStudentPackageCountsForPackage(pkg)) return
    setStudentPackageEditModalPackage(pkg)
    setStudentPackageEditForm(
      createDefaultStudentPackageEditForm({
        title: String(pkg.title || '').trim(),
        totalCount:
          pkg.totalCount != null && String(pkg.totalCount).trim() !== ''
            ? String(pkg.totalCount)
            : '1',
        expiresAt: studentDocFieldToYmdString(pkg.expiresAt),
        paymentDate: String(pkg.paymentDate || '').trim(),
        amountPaid:
          pkg.amountPaid != null && String(pkg.amountPaid).trim() !== ''
            ? String(pkg.amountPaid)
            : '',
        memo: String(pkg.memo || ''),
        allowGroupFreeBooking: pkg.allowGroupFreeBooking === true,
      })
    )
    setStudentPackageEditFormErrors({})
  }

  function validateStudentPackageEditFormFields(form, usedCountRaw) {
    const errors = {}
    const usedCount = Number(usedCountRaw ?? 0)
    if (!Number.isFinite(usedCount) || usedCount < 0) {
      errors._used = '사용 횟수가 올바르지 않습니다.'
    }

    const title = String(form.title || '').trim()
    if (!title) errors.title = '수강권 제목을 입력해주세요.'

    const totalParsed = parseRequiredMinOneIntField(form.totalCount)
    if (!totalParsed.ok) {
      errors.totalCount = '1 이상의 정수를 입력해주세요.'
    } else if (Number.isFinite(usedCount) && totalParsed.value < usedCount) {
      errors.totalCount = `총 횟수는 사용 횟수(${usedCount}) 이상이어야 합니다.`
    }

    let expiresAtTs = null
    let expiresClear = false
    const expStr = String(form.expiresAt || '').trim()
    if (!expStr) {
      expiresClear = true
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(expStr)) {
      errors.expiresAt = '날짜 형식이 올바르지 않습니다.'
    } else {
      const [y, mo, d] = expStr.split('-').map(Number)
      const dt = new Date(y, mo - 1, d)
      if (
        dt.getFullYear() !== y ||
        dt.getMonth() !== mo - 1 ||
        dt.getDate() !== d
      ) {
        errors.expiresAt = '유효한 날짜를 선택해주세요.'
      } else {
        expiresAtTs = Timestamp.fromDate(new Date(y, mo - 1, d))
      }
    }

    let amountPaid = 0
    const amountRaw = String(form.amountPaid ?? '').trim()
    if (amountRaw !== '') {
      const n = Number(amountRaw)
      if (!Number.isFinite(n) || n < 0) {
        errors.amountPaid = '0 이상의 숫자를 입력해주세요.'
      } else {
        amountPaid = n
      }
    }

    const paymentDate = String(form.paymentDate || '').trim()
    const paymentDateClear = !paymentDate
    if (paymentDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
        errors.paymentDate = '결제일 형식이 올바르지 않습니다.'
      } else if (!parseYmdToLocalDate(paymentDate)) {
        errors.paymentDate = '유효한 결제일을 선택해주세요.'
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      title,
      totalCount: totalParsed.ok ? totalParsed.value : 0,
      expiresAt: expiresAtTs,
      expiresClear,
      paymentDate,
      paymentDateClear,
      amountPaid,
      memo: String(form.memo || '').trim(),
      allowGroupFreeBooking: form.allowGroupFreeBooking === true,
    }
  }

  async function submitStudentPackageEditModal() {
    const pkg = studentPackageEditModalPackage
    if (!pkg?.id) return
    if (!canEditStudentPackageCountsForPackage(pkg)) {
      alert('수강권 횟수를 수정할 권한이 없습니다.')
      return
    }

    const usedCount = Number(pkg.usedCount ?? 0)
    const isAdminEdit = isAdminPackageEditor()
    const result = isAdminEdit
      ? validateStudentPackageEditFormFields(studentPackageEditForm, usedCount)
      : (() => {
          const errors = {}
          if (!Number.isFinite(usedCount) || usedCount < 0) {
            errors._used = '사용 횟수가 올바르지 않습니다.'
          }
          const totalParsed = parseRequiredMinOneIntField(studentPackageEditForm.totalCount)
          if (!totalParsed.ok) {
            errors.totalCount = '1 이상의 정수를 입력해주세요.'
          } else if (Number.isFinite(usedCount) && totalParsed.value < usedCount) {
            errors.totalCount = `총 횟수는 사용 횟수(${usedCount}) 이상이어야 합니다.`
          }
          return {
            valid: Object.keys(errors).length === 0,
            errors,
            totalCount: totalParsed.ok ? totalParsed.value : 0,
          }
        })()
    setStudentPackageEditFormErrors(result.errors)
    if (!result.valid) return

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(pkg, scopedAcademyId, '수강권')
      setBusyStudentPackageActionId(pkg.id)
      const pkgRef = doc(db, 'studentPackages', pkg.id)
      const remainingCount = Math.max(0, result.totalCount - usedCount)
      const status = getNextStudentPackageStatus(pkg.status, remainingCount)
      const updates = {
        title: result.title,
        totalCount: result.totalCount,
        remainingCount,
        status,
        amountPaid: result.amountPaid,
        memo: result.memo,
        ...(String(pkg.packageType || '').trim() === 'group'
          ? { allowGroupFreeBooking: result.allowGroupFreeBooking === true }
          : {}),
        updatedAt: serverTimestamp(),
      }
      if (result.paymentDateClear) {
        updates.paymentDate = deleteField()
      } else {
        updates.paymentDate = result.paymentDate
      }
      if (result.expiresClear) {
        updates.expiresAt = deleteField()
      } else {
        updates.expiresAt = result.expiresAt
      }
      await updateDoc(pkgRef, updates)
      if (pkg.packageType === 'group' || pkg.packageType === 'openGroup') {
        await syncStudentGroupCourseTypeAccessSummary(db, {
          academyId: scopedAcademyId,
          studentId: String(pkg.studentId || '').trim(),
        })
      }

      const oldTotalCount = Number(pkg.totalCount ?? 0)
      const diff = result.totalCount - oldTotalCount
      const oldTitle = String(pkg.title || '').trim()
      const titleChanged = oldTitle !== result.title
      const oldAmt =
        pkg.amountPaid != null && String(pkg.amountPaid).trim() !== ''
          ? Number(pkg.amountPaid)
          : 0
      const amountChanged = oldAmt !== result.amountPaid
      const oldExpYmd = studentDocFieldToYmdString(pkg.expiresAt) || ''
      const newExpYmd = result.expiresClear
        ? ''
        : String(studentPackageEditForm.expiresAt || '').trim()
      const expiresChanged = oldExpYmd !== newExpYmd
      const oldPaymentDate = String(pkg.paymentDate || '').trim()
      const newPaymentDate = result.paymentDateClear
        ? ''
        : String(studentPackageEditForm.paymentDate || '').trim()
      const paymentDateChanged = oldPaymentDate !== newPaymentDate
      const oldMemo = String(pkg.memo || '')
      const memoChanged = oldMemo !== result.memo
      const sid = String(pkg.studentId || '').trim()
      const sname = String(pkg.studentName || '').trim() || '-'
      const pteacher = normalizeText(pkg.teacher || '')
      const ptype = String(pkg.packageType || '')
      const ptitle = String(result.title || '').trim()
      const gname = pkg.groupClassName ? String(pkg.groupClassName).trim() : ''
      const allowChanged =
        String(pkg.packageType || '').trim() === 'group' &&
        (pkg.allowGroupFreeBooking === true) !==
          (result.allowGroupFreeBooking === true)

      if (diff !== 0) {
        await addCreditTransaction({
          studentId: sid,
          studentName: sname,
          teacher: pteacher,
          packageId: pkg.id,
          packageType: ptype,
          packageTitle: ptitle,
          groupClassName: gname,
          sourceType: 'studentPackage',
          sourceId: pkg.id,
          actionType: 'package_adjusted',
          deltaCount: diff,
          memo: [ptitle, gname, `총 횟수 조정 (${oldTotalCount} → ${result.totalCount})`]
            .filter(Boolean)
            .join(' · '),
        })
      } else if (
        titleChanged ||
        amountChanged ||
        expiresChanged ||
        paymentDateChanged ||
        memoChanged ||
        allowChanged
      ) {
        const parts = []
        if (titleChanged) parts.push('제목')
        if (amountChanged) parts.push('금액')
        if (paymentDateChanged) parts.push('결제일')
        if (expiresChanged) parts.push('만료일')
        if (memoChanged) parts.push('메모')
        if (allowChanged) parts.push('단체반 자유 예약 권한')
        await addCreditTransaction({
          studentId: sid,
          studentName: sname,
          teacher: pteacher,
          packageId: pkg.id,
          packageType: ptype,
          packageTitle: ptitle,
          groupClassName: gname,
          sourceType: 'studentPackage',
          sourceId: pkg.id,
          actionType: 'package_updated',
          deltaCount: 0,
          memo: [ptitle, gname, `수강권 정보 수정 (${parts.join(', ')})`]
            .filter(Boolean)
            .join(' · '),
        })
      }

      closeStudentPackageEditModal()
    } catch (error) {
      console.error('수강권 수정 실패:', error)
      alert(`수강권 수정 실패: ${error.message}`)
    } finally {
      setBusyStudentPackageActionId(null)
    }
  }

  async function endStudentPackage(pkg) {
    if (!isAdminPackageEditor()) {
      alert('관리자만 수강권을 종료할 수 있습니다.')
      return
    }
    if (!pkg?.id) return

    if (String(pkg.status || '').toLowerCase() === 'ended') {
      alert('이미 종료된 수강권입니다.')
      return
    }

    const label = String(pkg.title || '').trim() || pkg.id
    if (!window.confirm(`이 수강권을 종료할까요?\n${label}`)) return

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(pkg, scopedAcademyId, '수강권')
      setBusyStudentPackageActionId(pkg.id)
      const pkgRef = doc(db, 'studentPackages', pkg.id)
      const pt = pkg.packageType

      if (pt === 'group' || pt === 'openGroup') {
        const q = query(
          collection(db, 'groupStudents'),
          where('academyId', '==', scopedAcademyId),
          where('packageId', '==', pkg.id)
        )
        const snap = await getDocs(q)
        const batch = writeBatch(db)
        batch.update(pkgRef, { status: 'ended', updatedAt: serverTimestamp() })
        snap.forEach((d) => {
          const data = d.data()
          if (String(data.status || 'active') !== 'active') return
          batch.update(doc(db, 'groupStudents', d.id), {
            status: 'inactive',
            updatedAt: serverTimestamp(),
          })
          updateStudentGroupAccessBatch(
            batch,
            db,
            buildStudentGroupAccessPayloadFromGroupStudent(
              { id: d.id, ...data },
              { status: 'inactive' }
            )
          )
        })
        await batch.commit()
        await syncStudentGroupCourseTypeAccessSummary(db, {
          academyId: scopedAcademyId,
          studentId: String(pkg.studentId || '').trim(),
        })
      } else if (pt === 'private') {
        const studentId = String(pkg.studentId || '').trim()
        const teacher = normalizeText(pkg.teacher || '')
        const activeSameTeacherSnap =
          studentId && teacher
            ? await getDocs(
                query(
                  collection(db, 'studentPackages'),
                  where('academyId', '==', scopedAcademyId),
                  where('studentId', '==', studentId),
                  where('teacher', '==', teacher),
                  where('status', '==', 'active')
                )
              )
            : null
        const hasOtherActiveSameTeacher = activeSameTeacherSnap
          ? activeSameTeacherSnap.docs.some((docItem) => docItem.id !== pkg.id)
          : false
        const batch = writeBatch(db)
        batch.update(pkgRef, { status: 'ended', updatedAt: serverTimestamp() })
        if (studentId && teacher) {
          removeStudentPrivateTeacherAccessBatch(batch, db, {
            academyId: scopedAcademyId,
            studentId,
            teacher,
            packageId: pkg.id,
            removeTeacher: !hasOtherActiveSameTeacher,
          })
        }
        await batch.commit()
      } else {
        await updateDoc(pkgRef, { status: 'ended', updatedAt: serverTimestamp() })
      }
      await addCreditTransaction({
        studentId: String(pkg.studentId || '').trim(),
        studentName: String(pkg.studentName || '').trim() || '-',
        teacher: normalizeText(pkg.teacher || ''),
        packageId: pkg.id,
        packageType: String(pkg.packageType || ''),
        sourceType: 'studentPackage',
        sourceId: pkg.id,
        actionType: 'package_ended',
        deltaCount: 0,
        memo: [String(pkg.title || '').trim(), pkg.groupClassName ? String(pkg.groupClassName) : '']
          .filter(Boolean)
          .join(' · ') || '수강권 종료',
      })
    } catch (error) {
      console.error('수강권 종료 실패:', error)
      alert(`수강권 종료 실패: ${error.message}`)
    } finally {
      setBusyStudentPackageActionId(null)
    }
  }

  async function revokeStudentPackage(pkg, revokeInfo = null) {
    if (!isAdminPackageEditor()) {
      alert('관리자만 수강권을 회수할 수 있습니다.')
      return
    }
    if (!pkg?.id) return
    if (String(pkg.packageType || '').trim() !== 'private') {
      alert('개인 수강권만 회수할 수 있습니다.')
      return
    }
    const normalizedStatus = String(pkg.status || 'active').trim().toLowerCase()
    if (normalizedStatus === 'revoked') {
      alert('이미 회수된 수강권입니다.')
      return
    }
    if (revokeInfo && revokeInfo.canRevoke === false) {
      alert(revokeInfo.reason || '이 수강권은 회수할 수 없습니다.')
      return
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(pkg, scopedAcademyId, '수강권')
      setBusyStudentPackageActionId(pkg.id)

      const pkgRef = doc(db, 'studentPackages', pkg.id)
      const latestPackageSnap = await getDocFromServer(pkgRef)
      if (!latestPackageSnap.exists()) {
        throw new Error('수강권을 찾을 수 없습니다.')
      }
      const latestPackage = { id: latestPackageSnap.id, ...latestPackageSnap.data() }
      assertSameAcademy(latestPackage, scopedAcademyId, '수강권')
      const studentId = String(latestPackage.studentId || pkg.studentId || '').trim()
      const teacher = getPrivatePackageTeacher(latestPackage) || getPrivatePackageTeacher(pkg)
      const latestStatus = String(latestPackage.status || 'active').trim().toLowerCase()
      const latestUsedCount = Number(latestPackage.usedCount ?? 0) || 0
      const latestTotalCount = Number(latestPackage.totalCount ?? 0) || 0
      const latestRemainingCount = Number(latestPackage.remainingCount ?? 0) || 0
      if (String(latestPackage.packageType || '').trim() !== 'private') {
        alert('개인 수강권만 회수할 수 있습니다.')
        return
      }
      if (latestStatus !== 'active') {
        alert(latestStatus === 'revoked' ? '이미 회수된 수강권입니다.' : '활성 상태의 수강권만 회수할 수 있습니다.')
        return
      }

      const [reservationSnap, lessonSnap] = await Promise.all([
        getDocs(
          query(
            collection(db, 'privateLessonReservations'),
            where('academyId', '==', scopedAcademyId),
            where('studentId', '==', studentId)
          )
        ),
        getDocs(
          query(
            collection(db, 'lessons'),
            where('academyId', '==', scopedAcademyId),
            where('studentId', '==', studentId)
          )
        ),
      ])
      const hasBlockingReservation = reservationSnap.docs.some((docItem) => {
        const row = docItem.data() || {}
        return (
          isActivePrivateReservationStatus(row.status) &&
          getPackageLinkedIds(row).includes(pkg.id) &&
          isFuturePackageRow(row)
        )
      })
      if (hasBlockingReservation) {
        alert('미래 예약/고정 배정을 먼저 취소한 뒤 회수하세요.')
        return
      }
      const hasBlockingLesson = lessonSnap.docs.some((docItem) => {
        const row = docItem.data() || {}
        return getPackageLinkedIds(row).includes(pkg.id) && isBlockingPrivateLessonForRevoke(row)
      })
      if (hasBlockingLesson) {
        alert('미래 예약/고정 배정을 먼저 취소한 뒤 회수하세요.')
        return
      }

      const title = String(latestPackage.title || pkg.title || '').trim() || pkg.id
      const reasonInput = window.prompt(
        [
          '이 개인 수강권을 회수할까요?',
          title,
          '',
          `총 ${latestTotalCount}회 · 사용 ${latestUsedCount}회 · 남은 ${latestRemainingCount}회`,
          '',
          '회수 사유를 입력해 주세요.',
        ].join('\n'),
        '오발급 회수'
      )
      if (reasonInput === null) return
      const revokeReason = String(reasonInput || '').trim()
      if (!revokeReason) {
        alert('회수 사유를 입력해 주세요.')
        return
      }
      const activePrivatePackageSnap = studentId
        ? await getDocs(
            query(
              collection(db, 'studentPackages'),
              where('academyId', '==', scopedAcademyId),
              where('studentId', '==', studentId),
              where('packageType', '==', 'private'),
              where('status', '==', 'active')
            )
          )
        : null
      const hasOtherActiveSameTeacher = activePrivatePackageSnap
        ? activePrivatePackageSnap.docs.some((docItem) => {
            if (docItem.id === pkg.id) return false
            return getPrivatePackageTeacher(docItem.data() || {}) === teacher
          })
        : false
      const revokedBy = String(userProfile?.displayName || userProfile?.email || '관리자').trim()
      const revokedByUid = String(user?.uid || userProfile?.uid || userProfile?.userId || '').trim()
      await updateDoc(pkgRef, {
        status: 'revoked',
        totalCount: latestTotalCount,
        usedCount: latestUsedCount,
        remainingCount: latestRemainingCount,
        revokedAt: serverTimestamp(),
        revokedBy,
        revokedByUid,
        revokeReason,
        updatedAt: serverTimestamp(),
      })

      const revokedPackageSnap = await getDocFromServer(pkgRef)
      const revokedPackage = revokedPackageSnap.exists()
        ? { id: revokedPackageSnap.id, ...revokedPackageSnap.data() }
        : null
      if (String(revokedPackage?.status || '').trim().toLowerCase() !== 'revoked') {
        throw new Error('수강권 회수 상태가 저장되지 않았습니다.')
      }
      onStudentPackageRevoked?.(revokedPackage)

      if (studentId && teacher) {
        try {
          const accessBatch = writeBatch(db)
          removeStudentPrivateTeacherAccessBatch(accessBatch, db, {
            academyId: scopedAcademyId,
            studentId,
            teacher,
            packageId: pkg.id,
            removeTeacher: !hasOtherActiveSameTeacher,
          })
          await accessBatch.commit()
        } catch (accessError) {
          console.error('수강권 회수 접근 요약 갱신 실패:', accessError)
          alert('수강권은 회수되었지만 학생 예약 권한 요약 갱신에 실패했습니다. 새로고침 후 다시 확인해 주세요.')
          return
        }
      }

      try {
        await addCreditTransaction({
          studentId,
          studentName: String(latestPackage.studentName || pkg.studentName || '').trim() || '-',
          teacher,
          packageId: pkg.id,
          packageType: 'private',
          packageTitle: String(latestPackage.title || pkg.title || '').trim(),
          sourceType: 'studentPackage',
          sourceId: pkg.id,
          actionType: 'package_revoked',
          deltaCount: 0,
          memo: ['수강권 회수', revokeReason].filter(Boolean).join(' · '),
        })
      } catch (transactionError) {
        console.error('수강권 회수 이력 기록 실패:', transactionError)
        alert('수강권은 회수되었지만 이력 기록에 실패했습니다. 새로고침 후 다시 확인해 주세요.')
        return
      }
      alert('수강권이 회수되었습니다.')
    } catch (error) {
      console.error('수강권 회수 실패:', error)
      alert('수강권 회수에 실패했습니다. 다시 시도해 주세요.')
    } finally {
      setBusyStudentPackageActionId(null)
    }
  }

  return {
    studentPackageEditModalPackage,
    studentPackageEditForm,
    setStudentPackageEditForm,
    studentPackageEditFormErrors,
    busyStudentPackageActionId,
    studentPackageHistoryModalPackage,
    studentPackageHistoryRows,
    studentPackageHistoryLoading,
    openStudentPackageEditModal,
    canEditStudentPackageCountsForPackage,
    studentPackageEditMode: getStudentPackageEditMode(studentPackageEditModalPackage),
    closeStudentPackageEditModal,
    submitStudentPackageEditModal,
    validateStudentPackageEditFormFields,
    endStudentPackage,
    revokeStudentPackage,
    openStudentPackageHistoryModal,
    closeStudentPackageHistoryModal,
  }
}
