import { useState } from 'react'
import {
  collection,
  deleteField,
  doc,
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
  getNextStudentPackageStatus,
  normalizeText,
  parseRequiredMinOneIntField,
} from '../dashboardViewUtils.js'
import {
  buildStudentGroupAccessPayloadFromGroupStudent,
  updateStudentGroupAccessBatch,
} from '../../group-booking/studentGroupAccessClient.js'
import { syncStudentGroupCourseTypeAccessSummary } from '../../group-booking/studentGroupAccessSummaryClient.js'
import { removeStudentPrivateTeacherAccessBatch } from '../../private-booking/studentPrivateAccessSummaryClient.js'

const DEFAULT_STUDENT_PACKAGE_EDIT_FORM = {
  title: '',
  totalCount: '',
  expiresAt: '',
  amountPaid: '',
  memo: '',
}

function createDefaultStudentPackageEditForm(overrides = {}) {
  return {
    ...DEFAULT_STUDENT_PACKAGE_EDIT_FORM,
    ...overrides,
  }
}

export default function useStudentPackageAdminFlow({
  userProfile,
  currentAcademyId,
  addCreditTransaction,
  studentDocFieldToYmdString,
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
    return userProfile?.role === 'admin'
  }

  function packageBelongsToCurrentTeacher(pkg) {
    const teacherKey = normalizeText(userProfile?.teacherName || '')
    if (!teacherKey || !pkg) return false
    if (String(pkg.academyId || '').trim() !== String(currentAcademyId || '').trim()) {
      return false
    }
    return (
      normalizeText(pkg.teacher || '') === teacherKey ||
      normalizeText(pkg.teacherName || '') === teacherKey
    )
  }

  function canEditStudentPackageCountsForPackage(pkg) {
    if (!pkg?.id) return false
    if (isAdminPackageEditor()) return true
    return (
      userProfile?.role === 'teacher' &&
      userProfile?.canEditStudentPackageCounts === true &&
      packageBelongsToCurrentTeacher(pkg)
    )
  }

  function getStudentPackageEditMode(pkg) {
    if (!pkg?.id) return 'none'
    return isAdminPackageEditor() ? 'admin' : 'teacherCount'
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
        amountPaid:
          pkg.amountPaid != null && String(pkg.amountPaid).trim() !== ''
            ? String(pkg.amountPaid)
            : '',
        memo: String(pkg.memo || ''),
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

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      title,
      totalCount: totalParsed.ok ? totalParsed.value : 0,
      expiresAt: expiresAtTs,
      expiresClear,
      amountPaid,
      memo: String(form.memo || '').trim(),
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
      if (!isAdminEdit) {
        await updateDoc(pkgRef, {
          totalCount: result.totalCount,
          remainingCount,
          updatedAt: serverTimestamp(),
        })
        closeStudentPackageEditModal()
        return
      }

      const status = getNextStudentPackageStatus(pkg.status, remainingCount)
      const updates = {
        title: result.title,
        totalCount: result.totalCount,
        remainingCount,
        status,
        amountPaid: result.amountPaid,
        memo: result.memo,
        updatedAt: serverTimestamp(),
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
      const oldMemo = String(pkg.memo || '')
      const memoChanged = oldMemo !== result.memo
      const sid = String(pkg.studentId || '').trim()
      const sname = String(pkg.studentName || '').trim() || '-'
      const pteacher = normalizeText(pkg.teacher || '')
      const ptype = String(pkg.packageType || '')
      const ptitle = String(result.title || '').trim()
      const gname = pkg.groupClassName ? String(pkg.groupClassName).trim() : ''

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
      } else if (titleChanged || amountChanged || expiresChanged || memoChanged) {
        const parts = []
        if (titleChanged) parts.push('제목')
        if (amountChanged) parts.push('금액')
        if (expiresChanged) parts.push('만료일')
        if (memoChanged) parts.push('메모')
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
            status: 'ended',
            updatedAt: serverTimestamp(),
          })
          updateStudentGroupAccessBatch(
            batch,
            db,
            buildStudentGroupAccessPayloadFromGroupStudent(
              { id: d.id, ...data },
              { status: 'ended' }
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
    openStudentPackageHistoryModal,
    closeStudentPackageHistoryModal,
  }
}
