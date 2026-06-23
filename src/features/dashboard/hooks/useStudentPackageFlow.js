import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
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
  buildAutoGroupStudentPackageTitle,
  buildAutoPrivateStudentPackageTitle,
  buildPrivateLessonScheduleEntries,
  buildStudentPackageScopeKey,
  computePrivateRegularTotalCount,
  formatGroupWeekdaysDisplay,
  getEarliestFutureGroupLessonYmdFromLessons,
  getGroupLessonGroupId,
  getTodayStorageDateString,
  isStudentPackageRowActive,
  normalizeText,
  parseLegacyLessonToDate,
  parseRequiredMinOneIntField,
  parseYmdToLocalDate,
  studentPackageAttentionScope,
} from '../dashboardViewUtils.js'
import {
  buildStudentGroupAccessPayloadFromGroupStudent,
  setStudentGroupAccessBatch,
} from '../../group-booking/studentGroupAccessClient.js'
import {
  DEFAULT_GROUP_COURSE_TYPE,
  normalizeGroupCourseType,
} from '../../group-booking/groupCourseTypes.js'
import { syncStudentGroupCourseTypeAccessSummary } from '../../group-booking/studentGroupAccessSummaryClient.js'
import { addStudentPrivateTeacherAccessBatch } from '../../private-booking/studentPrivateAccessSummaryClient.js'
import { computePrivateTeacherPackageUsage } from '../privatePackageHelpers.js'

const DEFAULT_STUDENT_PACKAGE_FORM = {
  packageType: 'private',
  privateTeacher: '',
  title: '',
  totalCount: '1',
  groupClassId: '',
  groupCourseType: DEFAULT_GROUP_COURSE_TYPE,
  registrationStartDate: '',
  registrationWeeks: '4',
  weeklyFrequency: '1',
  privatePackageMode: 'regular',
  expiresAt: '',
  paymentDate: '',
  amountPaid: '',
  memo: '',
  registrationLabel: '',
  privateDuplicateAction: 'topUp',
}

const DEFAULT_POST_PRIVATE_LESSON_SCHEDULE_FORM = {
  date: '',
  time: '',
  subject: '',
  repeatWeekly: false,
  repeatWeeks: '4',
  repeatStartMode: 'includeStart',
  repeatAnchorDate: '',
  weeklyFrequency: '1',
  weeklySlot2Date: '',
  weeklySlot2Time: '',
  weeklySlot3Date: '',
  weeklySlot3Time: '',
}

function createDefaultStudentPackageForm(overrides = {}) {
  return {
    ...DEFAULT_STUDENT_PACKAGE_FORM,
    ...overrides,
  }
}

function createDefaultPostPrivateLessonScheduleForm(overrides = {}) {
  return {
    ...DEFAULT_POST_PRIVATE_LESSON_SCHEDULE_FORM,
    ...overrides,
  }
}

function getPrivateTeacherOptionKeys(option) {
  return [
    option?.value,
    option?.teacherKey,
    option?.displayName,
    option?.label,
    option?.teacherUid,
    option?.teacherEmail,
  ]
    .map((value) => normalizeText(value || ''))
    .filter(Boolean)
}

function findPrivateTeacherOption(teacherSelectOptions, value) {
  const key = normalizeText(value || '')
  if (!key) return null
  return (
    (Array.isArray(teacherSelectOptions) ? teacherSelectOptions : []).find((option) =>
      getPrivateTeacherOptionKeys(option).includes(key)
    ) || null
  )
}

function resolvePrivateTeacherSelection(teacherSelectOptions, value, fallback = {}) {
  const option = findPrivateTeacherOption(teacherSelectOptions, value) || null
  const rawValue = String(value || '').trim()
  const teacherKey = normalizeText(
    option?.teacherKey ||
      fallback.teacherKey ||
      fallback.teacher ||
      fallback.teacherName ||
      option?.displayName ||
      option?.label ||
      rawValue
  )
  const teacherName = String(
    option?.displayName ||
      fallback.teacherDisplayName ||
      fallback.teacherName ||
      fallback.name ||
      teacherKey
  ).trim()
  const teacherUid = String(option?.teacherUid || fallback.teacherUid || '').trim()
  const teacherEmail = String(option?.teacherEmail || fallback.teacherEmail || '').trim()
  const selectValue = String(option?.value || rawValue || teacherKey || teacherUid).trim()

  return {
    option,
    selectValue,
    teacher: teacherKey,
    teacherKey,
    teacherName: teacherName || teacherKey,
    teacherDisplayName: teacherName || teacherKey,
    teacherUid,
    teacherEmail,
  }
}

function countPrivatePackageRegistrationEvents(rows) {
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    const actionType = String(row?.actionType || '').trim()
    const deltaCount = Number(row?.deltaCount || 0)
    return (
      deltaCount > 0 &&
      (actionType === 'package_created' ||
        actionType === 'private_package_top_up' ||
        actionType === 'package_top_up')
    )
  }).length
}

function getNormalizedUniqueKeys(values) {
  return Array.from(
    new Set(
      values
        .map((value) => normalizeText(value || ''))
        .filter(Boolean)
    )
  )
}

function getPrivateTeacherIdentity(row) {
  const uidKeys = getNormalizedUniqueKeys([
    row?.teacherUid,
    row?.teacherUID,
    row?.teacherId,
    row?.teacherID,
  ])
  const teacherKeys = getNormalizedUniqueKeys([row?.teacherKey])
  const displayKeys = getNormalizedUniqueKeys([
    row?.teacher,
    row?.teacherName,
    row?.teacherDisplayName,
    row?.displayName,
    row?.name,
    row?.label,
    row?.selectValue,
    row?.value,
    row?.teacherKey,
  ])

  return {
    uidKeys,
    teacherKeys,
    displayKeys,
  }
}

function keysOverlap(a, b) {
  if (a.length === 0 || b.length === 0) return false
  const bKeys = new Set(b)
  return a.some((key) => bKeys.has(key))
}

function hasStableTeacherIdentity(identity) {
  return identity.uidKeys.length > 0 || identity.teacherKeys.length > 0
}

function privatePackageMatchesTeacherSelection(pkg, teacherSelection) {
  const packageIdentity = getPrivateTeacherIdentity(pkg)
  const selectionIdentity = getPrivateTeacherIdentity(teacherSelection)
  if (keysOverlap(packageIdentity.uidKeys, selectionIdentity.uidKeys)) return true
  if (keysOverlap(packageIdentity.teacherKeys, selectionIdentity.teacherKeys)) return true
  if (hasStableTeacherIdentity(packageIdentity) && hasStableTeacherIdentity(selectionIdentity)) {
    return false
  }
  return keysOverlap(packageIdentity.displayKeys, selectionIdentity.displayKeys)
}

export default function useStudentPackageFlow({
  activeSection,
  userProfile,
  currentAcademyId,
  privateStudents,
  groupClasses,
  studentPackages,
  lessons,
  privateLessonReservations = [],
  studentSummaryGroupLessons,
  buildGroupPackageCoverageLessons,
  addCreditTransaction,
  recomputePrivatePackageUsage,
  validatePrivateLessonFormFields,
  teacherSelectOptions = [],
}) {
  const [studentPackageModalStudent, setStudentPackageModalStudent] = useState(null)
  const [studentPackageForm, setStudentPackageForm] = useState(
    createDefaultStudentPackageForm()
  )
  const [studentPackageFormErrors, setStudentPackageFormErrors] = useState({})
  const [busyStudentPackageSubmit, setBusyStudentPackageSubmit] = useState(false)
  const [, setStudentPackageReRegisterSourcePackage] = useState(null)
  const [studentPackageTopUpRoundsByPackageId, setStudentPackageTopUpRoundsByPackageId] =
    useState({})

  const [postPrivateLessonScheduleModalData, setPostPrivateLessonScheduleModalData] =
    useState(null)
  const [postPrivateLessonScheduleForm, setPostPrivateLessonScheduleForm] = useState(
    createDefaultPostPrivateLessonScheduleForm()
  )
  const [postPrivateLessonScheduleErrors, setPostPrivateLessonScheduleErrors] = useState(
    {}
  )
  const [busyPostPrivateLessonSchedule, setBusyPostPrivateLessonSchedule] =
    useState(false)

  const [postGroupReEnrollModalData, setPostGroupReEnrollModalData] = useState(null)
  const [postGroupReEnrollStartDate, setPostGroupReEnrollStartDate] = useState('')
  const [postGroupReEnrollErrors, setPostGroupReEnrollErrors] = useState({})
  const [busyPostGroupReEnroll, setBusyPostGroupReEnroll] = useState(false)

  useEffect(() => {
    if (activeSection !== 'students') {
      setStudentPackageModalStudent(null)
      setStudentPackageFormErrors({})
    }
  }, [activeSection])

  useEffect(() => {
    if (!studentPackageModalStudent) return

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        setStudentPackageModalStudent(null)
        setStudentPackageFormErrors({})
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [studentPackageModalStudent])

  const nextGroupLessonDateByGroupId = useMemo(() => {
    const today = getTodayStorageDateString()
    const map = new Map()
    for (const gl of studentSummaryGroupLessons) {
      const gid = getGroupLessonGroupId(gl)
      const ds = String(gl.date || '').trim()
      if (!gid || !/^\d{4}-\d{2}-\d{2}$/.test(ds) || ds < today) continue
      const prev = map.get(gid)
      if (!prev || ds < prev) map.set(gid, ds)
    }
    return map
  }, [studentSummaryGroupLessons])

  const studentPackageGroupAutoSummary = useMemo(() => {
    const pt = studentPackageForm.packageType
    if (pt !== 'group' && pt !== 'openGroup') return null

    const gid = String(studentPackageForm.groupClassId || '').trim()
    if (!gid) return null

    const groupClass = groupClasses.find((gc) => String(gc.id || '') === gid) || null
    const startDate =
      String(studentPackageForm.registrationStartDate || '').trim() ||
      nextGroupLessonDateByGroupId.get(gid) ||
      getTodayStorageDateString()
    const weeks = Number.parseInt(
      String(studentPackageForm.registrationWeeks ?? '4'),
      10
    )
    const safeWeeks = Number.isInteger(weeks) && weeks > 0 ? weeks : 0
    const coverage = buildGroupPackageCoverageLessons({
      groupClassId: gid,
      registrationStartDate: startDate,
      registrationWeeks: safeWeeks,
      groupLessons: studentSummaryGroupLessons,
      groupClasses,
    })

    return {
      weeklyClassCount: coverage.weeklyClassCount,
      registrationWeeks: safeWeeks,
      targetCount: coverage.targetCount,
      computedTotalCount: coverage.computedTotalCount,
      coverageStartDate: coverage.coverageStartDate,
      coverageEndDate: coverage.coverageEndDate,
      defaultStartDate: nextGroupLessonDateByGroupId.get(gid) || getTodayStorageDateString(),
      groupName: groupClass?.name || '',
      weekdayLabels: formatGroupWeekdaysDisplay(groupClass?.weekdays),
    }
  }, [
    studentPackageForm.packageType,
    studentPackageForm.groupClassId,
    studentPackageForm.registrationStartDate,
    studentPackageForm.registrationWeeks,
    groupClasses,
    nextGroupLessonDateByGroupId,
    studentSummaryGroupLessons,
    buildGroupPackageCoverageLessons,
  ])

  const studentPackageModalActiveSameScopeBasePackages = useMemo(() => {
    const student = studentPackageModalStudent
    if (!student?.id) return []

    const packageType = String(studentPackageForm.packageType || 'private').trim()
    if (packageType !== 'private' && packageType !== 'group' && packageType !== 'openGroup') {
      return []
    }

    let teacherForScope = String(student.teacher || '')
    let groupClassId = ''
    let selectedPrivateTeacher = null
    if (packageType === 'group' || packageType === 'openGroup') {
      groupClassId = String(studentPackageForm.groupClassId || '').trim()
      if (!groupClassId) return []
      teacherForScope = ''
    } else {
      selectedPrivateTeacher = resolvePrivateTeacherSelection(
        teacherSelectOptions,
        studentPackageForm.privateTeacher,
        student
      )
      teacherForScope = selectedPrivateTeacher.teacher
    }

    const scopeKey = buildStudentPackageScopeKey({
      packageType,
      teacher: teacherForScope,
      groupClassId,
    })
    const studentId = String(student.id).trim()

    return studentPackages
      .filter((pkg) => {
        if (String(pkg.studentId || '').trim() !== studentId) return false
        if (!isStudentPackageRowActive(pkg)) return false
        if (packageType === 'private') {
          if (String(pkg.packageType || '').trim() !== 'private') return false
          return privatePackageMatchesTeacherSelection(pkg, selectedPrivateTeacher)
        }
        return studentPackageAttentionScope(pkg) === scopeKey
      })
      .map((pkg) => {
        if (packageType !== 'private') return pkg
        const balance = computePrivateTeacherPackageUsage({
          privatePackage: pkg,
          privateLessons: lessons,
          privateReservations: privateLessonReservations,
          academyId: currentAcademyId,
          studentId,
          teacher: pkg.teacher || pkg.teacherName,
          teacherKey: pkg.teacherKey,
          teacherUid: pkg.teacherUid,
          teacherUID: pkg.teacherUID,
          teacherId: pkg.teacherId,
        })
        return {
          ...pkg,
          privateAssignmentBalance: balance,
        }
      })
  }, [
    currentAcademyId,
    lessons,
    privateLessonReservations,
    studentPackageModalStudent,
    studentPackageForm.packageType,
    studentPackageForm.groupClassId,
    studentPackageForm.privateTeacher,
    studentPackages,
    teacherSelectOptions,
  ])

  useEffect(() => {
    const privatePackageIds = studentPackageModalActiveSameScopeBasePackages
      .filter((pkg) => String(pkg.packageType || '').trim() === 'private')
      .map((pkg) => String(pkg.id || '').trim())
      .filter(Boolean)
    if (privatePackageIds.length === 0) return

    let cancelled = false
    async function loadTopUpRounds() {
      try {
        const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
        const entries = await Promise.all(
          privatePackageIds.map(async (packageId) => {
            const txSnap = await getDocs(
              query(
                collection(db, 'creditTransactions'),
                where('academyId', '==', scopedAcademyId),
                where('packageId', '==', packageId)
              )
            )
            const count = countPrivatePackageRegistrationEvents(
              txSnap.docs.map((docItem) => docItem.data() || {})
            )
            return [packageId, Math.max(2, count + 1)]
          })
        )
        if (!cancelled) {
          setStudentPackageTopUpRoundsByPackageId((prev) => ({
            ...prev,
            ...Object.fromEntries(entries),
          }))
        }
      } catch (error) {
        console.warn('개인 수강권 등록 회차 조회 실패:', error)
      }
    }
    void loadTopUpRounds()
    return () => {
      cancelled = true
    }
  }, [
    currentAcademyId,
    studentPackageModalActiveSameScopeBasePackages
      .map((pkg) => String(pkg.id || '').trim())
      .filter(Boolean)
      .join('|'),
  ])

  const studentPackageModalActiveSameScopeDuplicates = useMemo(() => {
    return studentPackageModalActiveSameScopeBasePackages.map((pkg) => {
      if (String(pkg.packageType || '').trim() !== 'private') return pkg
      const packageId = String(pkg.id || '').trim()
      return {
        ...pkg,
        nextRegistrationRound: studentPackageTopUpRoundsByPackageId[packageId] || 2,
      }
    })
  }, [studentPackageModalActiveSameScopeBasePackages, studentPackageTopUpRoundsByPackageId])

  const postGroupReEnrollMinStartYmd = useMemo(() => {
    if (!postGroupReEnrollModalData?.groupClassId) return ''

    const packageRegistrationStartDate = String(
      postGroupReEnrollModalData.packageRegistrationStartDate || ''
    ).trim()
    const earliestFutureLessonYmd = getEarliestFutureGroupLessonYmdFromLessons({
      groupClassId: postGroupReEnrollModalData.groupClassId,
      groupLessons: studentSummaryGroupLessons,
      todayYmd: getTodayStorageDateString(),
    })
    const packageStartOk = /^\d{4}-\d{2}-\d{2}$/.test(packageRegistrationStartDate)
    const earliestOk = /^\d{4}-\d{2}-\d{2}$/.test(earliestFutureLessonYmd)

    if (packageStartOk && earliestOk) {
      return packageRegistrationStartDate > earliestFutureLessonYmd
        ? packageRegistrationStartDate
        : earliestFutureLessonYmd
    }
    if (packageStartOk) return packageRegistrationStartDate
    if (earliestOk) return earliestFutureLessonYmd
    return ''
  }, [postGroupReEnrollModalData, studentSummaryGroupLessons])

  function closeStudentPackageModal() {
    setStudentPackageModalStudent(null)
    setStudentPackageFormErrors({})
    setStudentPackageReRegisterSourcePackage(null)
  }

  function closePostGroupReEnrollModal() {
    setPostGroupReEnrollModalData(null)
    setPostGroupReEnrollStartDate('')
    setPostGroupReEnrollErrors({})
  }

  function closePostPrivateLessonScheduleModal() {
    setPostPrivateLessonScheduleModalData(null)
    setPostPrivateLessonScheduleForm(createDefaultPostPrivateLessonScheduleForm())
    setPostPrivateLessonScheduleErrors({})
  }

  function mergeKnownStudentForPackage(student) {
    if (!student?.id) return student
    const knownStudent = (Array.isArray(privateStudents) ? privateStudents : []).find(
      (row) => String(row.id || '').trim() === String(student.id || '').trim()
    )
    return knownStudent ? { ...student, ...knownStudent } : student
  }

  async function ensureStudentForPackageSubmit(student) {
    if (!student?.id) return student
    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    let nextStudent = mergeKnownStudentForPackage(student)
    const hasAcademy = String(nextStudent?.academyId || '').trim() === scopedAcademyId
    const hasTeacherScope =
      String(nextStudent?.teacher || '').trim() ||
      String(nextStudent?.teacherKey || '').trim()
    if (!hasAcademy || !hasTeacherScope) {
      const studentSnap = await getDoc(doc(db, 'privateStudents', student.id))
      if (studentSnap.exists()) {
        nextStudent = { ...nextStudent, id: studentSnap.id, ...studentSnap.data() }
      }
    }
    setStudentPackageModalStudent(nextStudent)
    return nextStudent
  }

  function openStudentPackageModal(student, initialPackageType, reRegisterSourcePackage) {
    if (userProfile?.role !== 'admin') return

    let packageType =
      initialPackageType === 'group' ||
      initialPackageType === 'openGroup' ||
      initialPackageType === 'private'
        ? initialPackageType
        : 'private'

    const knownStudent = mergeKnownStudentForPackage(student)
    setStudentPackageModalStudent(knownStudent)

    const getDefaultRegistrationStartDate = (groupClassId) => {
      const targetGroupClassId = String(groupClassId || '').trim()
      if (!targetGroupClassId) return ''

      const today = getTodayStorageDateString()
      let best = ''
      for (const groupLesson of studentSummaryGroupLessons) {
        if (getGroupLessonGroupId(groupLesson) !== targetGroupClassId) continue
        const dateStr = String(groupLesson.date || '').trim()
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue
        if (dateStr < today) continue
        if (!best || dateStr < best) best = dateStr
      }
      return best || today
    }

    if (reRegisterSourcePackage) {
      const sourcePackage = reRegisterSourcePackage
      const sourcePackageType = sourcePackage.packageType
      if (
        sourcePackageType === 'group' ||
        sourcePackageType === 'openGroup' ||
        sourcePackageType === 'private'
      ) {
        packageType = sourcePackageType
      }

      const groupClassId =
        packageType === 'group' || packageType === 'openGroup'
          ? String(sourcePackage.groupClassId || '')
          : ''
      const groupCourseType =
        packageType === 'group' || packageType === 'openGroup'
          ? normalizeGroupCourseType(sourcePackage.groupCourseType) || DEFAULT_GROUP_COURSE_TYPE
          : ''
      const totalCount =
        sourcePackage.totalCount != null && String(sourcePackage.totalCount).trim() !== ''
          ? String(sourcePackage.totalCount)
          : '1'
      const sourceWeeksRaw = String(sourcePackage.registrationWeeks ?? '').trim()
      const registrationWeeks =
        sourceWeeksRaw && /^[1-9]\d*$/.test(sourceWeeksRaw) ? sourceWeeksRaw : '4'
      const registrationStartDate =
        packageType === 'group' || packageType === 'openGroup'
          ? getDefaultRegistrationStartDate(groupClassId)
          : String(sourcePackage.registrationStartDate || '').trim()
      const weeklyFrequencyRaw = String(sourcePackage.weeklyFrequency ?? '1').trim()
      const weeklyFrequency =
        weeklyFrequencyRaw === '2' || weeklyFrequencyRaw === '3'
          ? weeklyFrequencyRaw
          : '1'
      const privatePackageMode =
        packageType === 'private' &&
        String(sourcePackage.privatePackageMode || '').trim() === 'countBased'
          ? 'countBased'
          : packageType === 'private'
            ? 'regular'
            : 'regular'
      const privateTeacher = resolvePrivateTeacherSelection(
        teacherSelectOptions,
        sourcePackage.teacherKey ||
          sourcePackage.teacher ||
          sourcePackage.teacherName ||
          knownStudent?.teacherKey ||
          knownStudent?.teacher ||
          '',
        {
          ...knownStudent,
          teacherKey: sourcePackage.teacherKey,
          teacher: sourcePackage.teacher,
          teacherName: sourcePackage.teacherName,
          teacherDisplayName: sourcePackage.teacherDisplayName,
          teacherUid: sourcePackage.teacherUid,
          teacherEmail: sourcePackage.teacherEmail,
        }
      ).selectValue

      setStudentPackageForm(
        createDefaultStudentPackageForm({
          packageType,
          privateTeacher,
          title: String(sourcePackage.title || '').trim(),
          totalCount,
          groupClassId,
          groupCourseType,
          registrationStartDate,
          registrationWeeks,
          weeklyFrequency,
          privatePackageMode,
          paymentDate: String(sourcePackage.paymentDate || '').trim(),
        })
      )
    } else {
      const registrationStartDate =
        packageType === 'group' || packageType === 'openGroup'
          ? getDefaultRegistrationStartDate('')
          : ''

      setStudentPackageForm(
        createDefaultStudentPackageForm({
          packageType,
          privateTeacher: resolvePrivateTeacherSelection(
            teacherSelectOptions,
            knownStudent?.teacherKey || knownStudent?.teacher || '',
            knownStudent || {}
          ).selectValue,
          registrationStartDate,
        })
      )
    }

    setStudentPackageFormErrors({})
    setStudentPackageReRegisterSourcePackage(reRegisterSourcePackage || null)
  }

  function validateStudentPackageFormFields(form, options = {}) {
    const errors = {}
    const title = String(form.title || '').trim()
    const packageTypeEarly = form.packageType
    const isPrivateTopUp = options.privateTopUp === true
    const privatePackageMode =
      packageTypeEarly === 'private' &&
      String(form.privatePackageMode || '').trim() === 'countBased'
        ? 'countBased'
        : packageTypeEarly === 'private'
          ? 'regular'
          : null
    const isPrivateRegular =
      packageTypeEarly === 'private' && privatePackageMode === 'regular'

    let amountPaid = 0
    const amountPaidRaw = String(form.amountPaid ?? '').trim()
    if (amountPaidRaw !== '') {
      const numeric = Number(amountPaidRaw)
      if (!Number.isFinite(numeric) || numeric < 0) {
        errors.amountPaid = '0 이상의 숫자를 입력해주세요.'
      } else {
        amountPaid = numeric
      }
    }

    const paymentDate = String(form.paymentDate || '').trim()
    if (paymentDate) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(paymentDate)) {
        errors.paymentDate = '결제일 형식이 올바르지 않습니다.'
      } else if (!parseYmdToLocalDate(paymentDate)) {
        errors.paymentDate = '유효한 결제일을 선택해주세요.'
      }
    }

    if (isPrivateTopUp) {
      const privateTeacher = resolvePrivateTeacherSelection(
        teacherSelectOptions,
        form.privateTeacher,
        studentPackageModalStudent || {}
      )
      if (!privateTeacher.teacher) {
        errors.privateTeacher = '수강권 선생님을 선택해 주세요.'
      }
      const topUpParsed = parseRequiredMinOneIntField(form.totalCount)
      if (!topUpParsed.ok) {
        errors.totalCount = '이번에 추가할 수업 횟수는 1 이상의 정수여야 합니다.'
      }

      return {
        valid: Object.keys(errors).length === 0,
        errors,
        title: title || '',
        totalCount: topUpParsed.ok ? topUpParsed.value : 0,
        packageType: 'private',
        groupClassId: '',
        groupCourseType: '',
        registrationStartDate: '',
        registrationWeeks: null,
        weeklyFrequency: '1',
        privatePackageMode,
        expiresAt: null,
        paymentDate,
        amountPaid,
        amountPaidProvided: amountPaidRaw !== '',
        registrationLabel: String(form.registrationLabel || '').trim(),
        memo: String(form.memo || '').trim(),
        privateTeacher,
      }
    }

    const privateTeacher =
      packageTypeEarly === 'private'
        ? resolvePrivateTeacherSelection(
            teacherSelectOptions,
            form.privateTeacher,
            studentPackageModalStudent || {}
          )
        : null
    if (packageTypeEarly === 'private' && !privateTeacher?.teacher) {
      errors.privateTeacher = '수강권 선생님을 선택해 주세요.'
    }

    if (packageTypeEarly === 'private' && privatePackageMode === 'countBased' && !title) {
      errors.title = '수강권 제목을 입력해주세요.'
    }

    const totalParsed = parseRequiredMinOneIntField(form.totalCount)
    if (!isPrivateRegular && !totalParsed.ok) {
      errors.totalCount = '1 이상의 정수를 입력해주세요.'
    }

    const packageType = form.packageType
    let groupClassId = String(form.groupClassId || '').trim()
    let registrationStartDate = ''
    let registrationWeeks = null
    let weeklyFrequency = '1'
    let groupCourseType = ''
    let outgoingTotalCount = totalParsed.ok ? totalParsed.value : 1

    if (packageType === 'group' || packageType === 'openGroup') {
      if (!groupClassId) errors.groupClassId = '그룹을 선택해주세요.'
      groupCourseType = normalizeGroupCourseType(form.groupCourseType)
      if (!groupCourseType) errors.groupCourseType = '코스 유형을 선택해주세요.'
      registrationStartDate = String(form.registrationStartDate || '').trim()
      if (!registrationStartDate) {
        errors.registrationStartDate = '수강권 시작일을 선택해주세요.'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(registrationStartDate)) {
        errors.registrationStartDate = '수강권 시작일 형식이 올바르지 않습니다.'
      } else if (!parseYmdToLocalDate(registrationStartDate)) {
        errors.registrationStartDate = '유효한 날짜를 선택해주세요.'
      }

      const weeksParsed = parseRequiredMinOneIntField(form.registrationWeeks)
      if (!weeksParsed.ok) {
        errors.registrationWeeks = '등록 주수는 1 이상의 정수여야 합니다.'
      } else {
        registrationWeeks = weeksParsed.value
      }
    } else if (packageType === 'private' && privatePackageMode === 'regular') {
      groupClassId = ''
      registrationStartDate = String(form.registrationStartDate || '').trim()
      if (!registrationStartDate) {
        errors.registrationStartDate = '수강권 시작일을 선택해주세요.'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(registrationStartDate)) {
        errors.registrationStartDate = '수강권 시작일 형식이 올바르지 않습니다.'
      } else if (!parseYmdToLocalDate(registrationStartDate)) {
        errors.registrationStartDate = '유효한 날짜를 선택해주세요.'
      }

      const weeksParsed = parseRequiredMinOneIntField(form.registrationWeeks)
      if (!weeksParsed.ok) {
        errors.registrationWeeks = '등록 주수는 1 이상의 정수여야 합니다.'
      } else {
        registrationWeeks = weeksParsed.value
      }

      const weeklyFrequencyRaw = String(form.weeklyFrequency ?? '1').trim()
      if (
        weeklyFrequencyRaw !== '1' &&
        weeklyFrequencyRaw !== '2' &&
        weeklyFrequencyRaw !== '3'
      ) {
        errors.weeklyFrequency = '주당 횟수는 1, 2, 3 중에서 선택해주세요.'
      }
      weeklyFrequency =
        weeklyFrequencyRaw === '1' ||
        weeklyFrequencyRaw === '2' ||
        weeklyFrequencyRaw === '3'
          ? weeklyFrequencyRaw
          : '1'

      const computed = computePrivateRegularTotalCount({
        registrationWeeks: weeksParsed.ok ? weeksParsed.value : 0,
        weeklyFrequency: Number(weeklyFrequency),
      })
      if (computed <= 0) {
        errors.registrationWeeks =
          errors.registrationWeeks ||
          '등록 주수와 주당 횟수를 확인해주세요. (총 횟수를 계산할 수 없습니다.)'
      }
      outgoingTotalCount = computed
    } else {
      groupClassId = ''
      registrationStartDate = ''
      registrationWeeks = null
      if (packageType === 'private' && privatePackageMode === 'countBased') {
        outgoingTotalCount = totalParsed.ok ? totalParsed.value : 1
      }
    }

    let expiresAtTs = null
    const expiresAtRaw = String(form.expiresAt || '').trim()
    if (expiresAtRaw) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(expiresAtRaw)) {
        errors.expiresAt = '날짜 형식이 올바르지 않습니다.'
      } else {
        const [y, mo, d] = expiresAtRaw.split('-').map(Number)
        const date = new Date(y, mo - 1, d)
        if (
          date.getFullYear() !== y ||
          date.getMonth() !== mo - 1 ||
          date.getDate() !== d
        ) {
          errors.expiresAt = '유효한 날짜를 선택해주세요.'
        } else {
          expiresAtTs = Timestamp.fromDate(new Date(y, mo - 1, d))
        }
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      title: title || '',
      totalCount: outgoingTotalCount,
      packageType,
      groupClassId,
      groupCourseType,
      registrationStartDate,
      registrationWeeks,
      weeklyFrequency,
      privatePackageMode,
      expiresAt: expiresAtTs,
      paymentDate,
      amountPaid,
      amountPaidProvided: amountPaidRaw !== '',
      registrationLabel: String(form.registrationLabel || '').trim(),
      memo: String(form.memo || '').trim(),
      privateTeacher,
    }
  }

  async function submitStudentPackageModal() {
    if (!studentPackageModalStudent) return
    if (userProfile?.role !== 'admin') {
      alert('관리자만 수강권을 추가할 수 있습니다.')
      return
    }

    const activePrivateSameScopePackages =
      String(studentPackageForm.packageType || '').trim() === 'private'
        ? studentPackageModalActiveSameScopeDuplicates.filter(
            (pkg) => String(pkg.packageType || '').trim() === 'private'
          )
        : []
    const shouldTopUpExistingPrivatePackage =
      activePrivateSameScopePackages.length > 0 &&
      String(studentPackageForm.privateDuplicateAction || 'topUp') !== 'new'
    const result = validateStudentPackageFormFields(studentPackageForm, {
      privateTopUp: shouldTopUpExistingPrivatePackage,
    })
    setStudentPackageFormErrors(result.errors)
    if (!result.valid) return

    let student
    try {
      student = await ensureStudentForPackageSubmit(studentPackageModalStudent)
    } catch (error) {
      console.error('학생 정보 확인 실패:', error)
      alert(`학생 수강권 추가 실패: ${error.message}`)
      return
    }
    const studentId = student.id
    const studentName = String(student.name || '').trim() || '-'

    let teacher = ''
    let groupClassId = null
    let groupClassName = null
    let groupCourseType = ''
    let computedTotalCount = result.totalCount
    let coverageEndDate = ''
    let registrationStartDateForSave = ''
    let registrationWeeksForSave = null

    if (result.packageType === 'private') {
      teacher = result.privateTeacher.teacher
      if (shouldTopUpExistingPrivatePackage) {
        const targetPackage = activePrivateSameScopePackages[0]
        try {
          const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
          assertSameAcademy(student, scopedAcademyId, '학생')
          assertSameAcademy(targetPackage, scopedAcademyId, '수강권')
          setBusyStudentPackageSubmit(true)

          const topUpCount = Number(result.totalCount || 0)
          const txSnap = await getDocs(
            query(
              collection(db, 'creditTransactions'),
              where('academyId', '==', scopedAcademyId),
              where('packageId', '==', targetPackage.id)
            )
          )
          const registrationEventCount = countPrivatePackageRegistrationEvents(
            txSnap.docs.map((docItem) => docItem.data() || {})
          )
          const registrationRound = Math.max(2, registrationEventCount + 1)
          const registrationLabel =
            String(result.registrationLabel || '').trim() || `${registrationRound}회차 등록`

          await updateDoc(doc(db, 'studentPackages', targetPackage.id), {
            totalCount: increment(topUpCount),
            remainingCount: increment(topUpCount),
            topUpCount: increment(1),
            lastTopUpAt: serverTimestamp(),
            status: 'active',
            updatedAt: serverTimestamp(),
          })

          const packageTitle = String(targetPackage.title || '').trim()
          await addCreditTransaction({
            studentId,
            studentName,
            teacher,
            packageId: targetPackage.id,
            packageType: 'private',
            packageTitle,
            groupClassName: '',
            sourceType: 'studentPackage',
            sourceId: targetPackage.id,
            actionType: 'private_package_top_up',
            deltaCount: topUpCount,
            registrationRound,
            roundNumber: registrationRound,
            registrationLabel,
            registrationMemo: String(result.memo || '').trim(),
            paymentDate: result.paymentDate,
            ...(result.amountPaidProvided ? { amountPaid: result.amountPaid } : {}),
            memo: [
              registrationLabel,
              `+${topUpCount}회`,
              String(result.memo || '').trim(),
            ]
              .filter(Boolean)
              .join(' · '),
          })

          closeStudentPackageModal()
          setPostPrivateLessonScheduleModalData({
            packageId: targetPackage.id,
            studentId,
            studentName,
            teacher,
            packageTitle,
            totalCount: Number(targetPackage.totalCount || 0) + topUpCount,
            remainingCount: Number(targetPackage.remainingCount || 0) + topUpCount,
            action: 'topUp',
          })
          setPostPrivateLessonScheduleErrors({})
        } catch (error) {
          console.error('개인 수강권 추가 등록 실패:', error)
          alert(`개인 수강권 추가 등록 실패: ${error.message}`)
        } finally {
          setBusyStudentPackageSubmit(false)
        }
        return
      }

      if (result.privatePackageMode === 'regular') {
        registrationStartDateForSave = String(result.registrationStartDate || '').trim()
        registrationWeeksForSave = Number(result.registrationWeeks || 0)
      }
    } else if (result.packageType === 'group' || result.packageType === 'openGroup') {
      const groupClass = groupClasses.find((gc) => gc.id === result.groupClassId)
      if (!groupClass) {
        setStudentPackageFormErrors((prev) => ({
          ...prev,
          groupClassId: '선택한 그룹을 찾을 수 없습니다.',
        }))
        return
      }

      teacher = normalizeText(groupClass.teacher || '')
      groupClassId = groupClass.id
      groupClassName = groupClass.name || null
      groupCourseType =
        normalizeGroupCourseType(result.groupCourseType) ||
        normalizeGroupCourseType(groupClass.groupCourseType)
      const coverage = buildGroupPackageCoverageLessons({
        groupClassId: groupClass.id,
        registrationStartDate: result.registrationStartDate,
        registrationWeeks: result.registrationWeeks,
        groupLessons: studentSummaryGroupLessons,
        groupClasses,
      })
      computedTotalCount = Number(coverage.computedTotalCount || 0)
      coverageEndDate = String(coverage.coverageEndDate || '').trim()
      registrationStartDateForSave = String(result.registrationStartDate || '').trim()
      registrationWeeksForSave = Number(result.registrationWeeks || 0)
      if (computedTotalCount <= 0) {
        setStudentPackageFormErrors((prev) => ({
          ...prev,
          registrationStartDate:
            '선택한 시작일 이후의 그룹 수업 일정이 없어 수강권을 만들 수 없습니다.',
        }))
        return
      }
    }

    const scopeKey = buildStudentPackageScopeKey({
      packageType: result.packageType,
      teacher:
        result.packageType === 'private'
          ? result.privateTeacher.teacher
          : '',
      groupClassId:
        result.packageType === 'private' ? '' : String(groupClassId || '').trim(),
    })
    const activeSameScope = studentPackages.filter((pkg) => {
      if (String(pkg.studentId || '').trim() !== studentId) return false
      if (!isStudentPackageRowActive(pkg)) return false
      if (result.packageType === 'private') {
        if (String(pkg.packageType || '').trim() !== 'private') return false
        return privatePackageMatchesTeacherSelection(pkg, result.privateTeacher)
      }
      return studentPackageAttentionScope(pkg) === scopeKey
    })
    if (activeSameScope.length > 0) {
      const confirmMessage =
        result.packageType === 'private'
          ? [
              '같은 선생님 수강권이 이미 있습니다.',
              '일반적인 2회차/3회차 등록은 기존 수강권에 추가 등록을 사용하세요.',
              '정말 별도 수강권으로 발급할까요?',
            ].join('\n')
          : '같은 범위의 사용 중 수강권이 이미 있습니다. 그래도 새 수강권을 발급할까요?'
      const ok = window.confirm(
        confirmMessage
      )
      if (!ok) return
    }

    let saveTitle = String(result.title || '').trim()
    if (
      (result.packageType === 'group' || result.packageType === 'openGroup') &&
      !saveTitle
    ) {
      saveTitle = buildAutoGroupStudentPackageTitle({
        groupClassName: groupClassName ? String(groupClassName).trim() : '',
        registrationStartDate:
          registrationStartDateForSave || result.registrationStartDate,
        registrationWeeks:
          registrationWeeksForSave != null && registrationWeeksForSave > 0
            ? registrationWeeksForSave
            : result.registrationWeeks,
      })
    } else if (
      result.packageType === 'private' &&
      result.privatePackageMode === 'regular' &&
      !saveTitle
    ) {
      saveTitle = buildAutoPrivateStudentPackageTitle({
        studentName,
        registrationStartDate: result.registrationStartDate,
        registrationWeeks: result.registrationWeeks,
        weeklyFrequency: result.weeklyFrequency,
      })
    }

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      assertSameAcademy(student, scopedAcademyId, '학생')
      setBusyStudentPackageSubmit(true)

      const newStudentPackagePayload = {
        academyId: scopedAcademyId,
        studentId,
        studentName,
        teacher,
        ...(result.packageType === 'private'
          ? {
              teacherName: result.privateTeacher.teacherName,
              teacherKey: result.privateTeacher.teacherKey,
              teacherDisplayName: result.privateTeacher.teacherDisplayName,
              teacherUid: result.privateTeacher.teacherUid,
              teacherEmail: result.privateTeacher.teacherEmail,
            }
          : {}),
        packageType: result.packageType,
        groupClassId,
        groupClassName,
        ...((result.packageType === 'group' || result.packageType === 'openGroup') && groupCourseType
          ? { groupCourseType }
          : {}),
        title: saveTitle,
        totalCount: computedTotalCount,
        usedCount: 0,
        remainingCount: computedTotalCount,
        status: 'active',
        registrationStartDate: registrationStartDateForSave || '',
        registrationWeeks:
          registrationWeeksForSave != null && registrationWeeksForSave > 0
            ? registrationWeeksForSave
            : null,
        coverageEndDate: coverageEndDate || '',
        expiresAt: result.expiresAt,
        paymentDate: result.paymentDate,
        amountPaid: result.amountPaid,
        memo: result.memo,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      if (result.packageType === 'private' && result.privatePackageMode === 'regular') {
        newStudentPackagePayload.privatePackageMode = 'regular'
        newStudentPackagePayload.weeklyFrequency = String(result.weeklyFrequency || '1')
      } else if (result.packageType === 'private') {
        newStudentPackagePayload.privatePackageMode = 'countBased'
      }

      const docRef = doc(collection(db, 'studentPackages'))
      const createBatch = writeBatch(db)
      createBatch.set(docRef, newStudentPackagePayload)
      if (result.packageType === 'private') {
        addStudentPrivateTeacherAccessBatch(createBatch, db, {
          academyId: scopedAcademyId,
          studentId,
          teacher,
          packageId: docRef.id,
        })
      }
      await createBatch.commit()
      await addCreditTransaction({
        studentId,
        studentName,
        teacher,
        packageId: docRef.id,
        packageType: result.packageType,
        packageTitle: String(saveTitle || '').trim(),
        groupClassName: groupClassName ? String(groupClassName).trim() : '',
        sourceType: 'studentPackage',
        sourceId: docRef.id,
        actionType: 'package_created',
        deltaCount: Number(computedTotalCount || 0),
        memo: [
          String(saveTitle || '').trim(),
          groupClassName ? String(groupClassName).trim() : '',
          '신규 수강권 발급',
        ]
          .filter(Boolean)
          .join(' · '),
      })
      closeStudentPackageModal()

      if (result.packageType === 'private') {
        setPostPrivateLessonScheduleModalData({
          packageId: docRef.id,
          studentId,
          studentName,
          teacher,
          packageTitle: String(saveTitle || '').trim(),
          totalCount: computedTotalCount,
          remainingCount: computedTotalCount,
          openedFromPrivateRegular: result.privatePackageMode === 'regular',
          action: 'created',
        })
        if (result.privatePackageMode === 'regular') {
          setPostPrivateLessonScheduleForm(
            createDefaultPostPrivateLessonScheduleForm({
              date: String(result.registrationStartDate || '').trim(),
              repeatWeekly: true,
              repeatWeeks: String(result.registrationWeeks ?? '4'),
              weeklyFrequency: String(result.weeklyFrequency ?? '1'),
            })
          )
        } else {
          setPostPrivateLessonScheduleForm(
            createDefaultPostPrivateLessonScheduleForm({
              date: getTodayStorageDateString(),
            })
          )
        }
        setPostPrivateLessonScheduleErrors({})
      }

      if (
        (result.packageType === 'group' || result.packageType === 'openGroup') &&
        groupClassId
      ) {
        const todayYmd = getTodayStorageDateString()
        const nextStartYmd =
          getEarliestFutureGroupLessonYmdFromLessons({
            groupClassId,
            groupLessons: studentSummaryGroupLessons,
            todayYmd,
          }) || todayYmd
        const defaultPostGroupReEnrollStartDate =
          /^\d{4}-\d{2}-\d{2}$/.test(nextStartYmd) &&
          nextStartYmd > registrationStartDateForSave
            ? nextStartYmd
            : registrationStartDateForSave
        setPostGroupReEnrollModalData({
          newPackageId: docRef.id,
          newPackageType: result.packageType,
          isReenrollFlow: false,
          studentId,
          studentName,
          teacher,
          groupClassId,
          groupClassName,
          totalCount: computedTotalCount,
          usedCount: 0,
          showNextLessonAutoHint:
            defaultPostGroupReEnrollStartDate === nextStartYmd &&
            nextStartYmd !== todayYmd,
          packageRegistrationStartDate: registrationStartDateForSave,
        })
        setPostGroupReEnrollStartDate(defaultPostGroupReEnrollStartDate)
        setPostGroupReEnrollErrors({})
        void syncStudentGroupCourseTypeAccessSummary(db, {
          academyId: scopedAcademyId,
          studentId,
        }).catch((error) => {
          console.warn('그룹 수강권 접근 요약 동기화 실패:', error)
        })
      }
    } catch (error) {
      console.error('학생 수강권 추가 실패:', error)
      alert(`학생 수강권 추가 실패: ${error.message}`)
    } finally {
      setBusyStudentPackageSubmit(false)
    }
  }

  async function submitPostGroupReEnroll() {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 등록할 수 있습니다.')
      return
    }

    const data = postGroupReEnrollModalData
    if (!data?.newPackageId || !data.groupClassId) {
      alert('등록 정보가 올바르지 않습니다.')
      return
    }

    const groupClassId = String(data.groupClassId || '').trim()
    const errors = {}
    const dateStr = String(postGroupReEnrollStartDate || '').trim()
    if (!dateStr) {
      errors.startDate = '시작일을 선택해주세요.'
    } else if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      errors.startDate = '시작일 형식이 올바르지 않습니다.'
    } else {
      const [y, mo, d] = dateStr.split('-').map(Number)
      const date = new Date(y, mo - 1, d)
      if (
        date.getFullYear() !== y ||
        date.getMonth() !== mo - 1 ||
        date.getDate() !== d
      ) {
        errors.startDate = '유효한 날짜를 선택해주세요.'
      }
    }

    if (Object.keys(errors).length === 0) {
      const packageRegistrationStartDate = String(
        data.packageRegistrationStartDate || ''
      ).trim()
      if (/^\d{4}-\d{2}-\d{2}$/.test(packageRegistrationStartDate) && dateStr < packageRegistrationStartDate) {
        errors.startDate = '등록 시작일은 수강권 시작일보다 이를 수 없습니다.'
      }
      if (!errors.startDate) {
        const earliest = getEarliestFutureGroupLessonYmdFromLessons({
          groupClassId,
          groupLessons: studentSummaryGroupLessons,
          todayYmd: getTodayStorageDateString(),
        })
        if (/^\d{4}-\d{2}-\d{2}$/.test(earliest) && dateStr < earliest) {
          errors.startDate = '등록 시작일은 반의 첫 예정 수업일보다 이를 수 없습니다.'
        }
      }
    }

    setPostGroupReEnrollErrors(errors)
    if (Object.keys(errors).length > 0) return

    const [y, mo, d] = dateStr.split('-').map(Number)
    const startTimestamp = Timestamp.fromDate(new Date(y, mo - 1, d))
    const enrollStudentId = String(data.studentId || '').trim()
    const teacherNorm = normalizeText(data.teacher || '')

    try {
      const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
      setBusyPostGroupReEnroll(true)

      const snap = await getDocs(
        query(
          collection(db, 'groupStudents'),
          where('academyId', '==', scopedAcademyId),
          where('studentId', '==', enrollStudentId)
        )
      )

      const batch = writeBatch(db)
      snap.forEach((docItem) => {
        const row = docItem.data()
        if (String(row.groupClassId || '') !== groupClassId) return
        if (String(row.status || 'active') !== 'active') return
        batch.update(doc(db, 'groupStudents', docItem.id), {
          status: 'ended',
          updatedAt: serverTimestamp(),
        })
      })

      const newGroupStudentRef = doc(collection(db, 'groupStudents'))
      const newGroupStudentPayload = {
        academyId: scopedAcademyId,
        groupClassId,
        classID: groupClassId,
        studentId: enrollStudentId,
        studentName: String(data.studentName || '').trim() || '-',
        name: String(data.studentName || '').trim() || '-',
        teacher: teacherNorm,
        packageId: data.newPackageId,
        packageType: data.newPackageType,
        paidLessons: Number(data.totalCount ?? 0),
        attendanceCount: 0,
        startDate: startTimestamp,
        status: 'active',
        studentStatus: 'active',
        excludedDates: [],
        breakStartDate: '',
        breakEndDate: '',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      }
      batch.set(newGroupStudentRef, newGroupStudentPayload)
      setStudentGroupAccessBatch(
        batch,
        db,
        buildStudentGroupAccessPayloadFromGroupStudent(
          { id: newGroupStudentRef.id, ...newGroupStudentPayload },
          { groupStudentId: newGroupStudentRef.id }
        )
      )

      await batch.commit()
      await addCreditTransaction({
        studentId: enrollStudentId,
        studentName: String(data.studentName || '').trim() || '-',
        teacher: teacherNorm,
        packageId: data.newPackageId,
        packageType: String(data.newPackageType || 'group'),
        sourceType: 'groupClass',
        sourceId: groupClassId,
        actionType: 'group_reenroll',
        deltaCount: 0,
        memo: `같은 반 재등록 · ${String(data.groupClassName || '').trim() || '-'} · 시작 ${dateStr}`,
      })
      closePostGroupReEnrollModal()
    } catch (error) {
      console.error('같은 반 재등록 실패:', error)
      alert(`같은 반 재등록 실패: ${error.message}`)
    } finally {
      setBusyPostGroupReEnroll(false)
    }
  }

  async function createPrivateLessonsForPackage({
    result,
    student,
    selectedPackage,
    teacherKey,
  }) {
    const scopedAcademyId = requireCurrentAcademyId(currentAcademyId)
    assertSameAcademy(student, scopedAcademyId, '학생')
    assertSameAcademy(selectedPackage, scopedAcademyId, '수강권')
    const studentName = String(student.name || '').trim()
    const scheduleEntries = buildPrivateLessonScheduleEntries({
      date: result.date,
      time: result.time,
      repeatWeekly: result.repeatWeekly,
      repeatWeeks: result.repeatWeeks,
      repeatStartMode: result.repeatStartMode,
      repeatAnchorDate: result.repeatAnchorDate,
      weeklyFrequency: result.weeklyFrequency,
      weeklySlot2Date: result.weeklySlot2Date,
      weeklySlot2Time: result.weeklySlot2Time,
      weeklySlot3Date: result.weeklySlot3Date,
      weeklySlot3Time: result.weeklySlot3Time,
    })
    if (scheduleEntries.length === 0) {
      return { ok: false, errors: { date: '날짜·시간·반복 설정을 확인해주세요.' } }
    }

    const internalDupKeys = scheduleEntries.map((entry) => `${entry.date} ${entry.time}`)
    if (new Set(internalDupKeys).size !== internalDupKeys.length) {
      return {
        ok: false,
        errors: { date: '반복 일정에 중복된 날짜·시간이 포함되어 있습니다.' },
      }
    }

    const existingDupKeys = []
    for (const entry of scheduleEntries) {
      const hasDup = lessons.some(
        (lesson) =>
          String(lesson.packageId || '').trim() === String(selectedPackage.id) &&
          String(lesson.date || '').trim() === entry.date &&
          String(lesson.time || '').trim() === entry.time
      )
      if (hasDup) existingDupKeys.push(`${entry.date} ${entry.time}`)
    }
    if (existingDupKeys.length > 0) {
      const duplicateText = Array.from(new Set(existingDupKeys)).sort().join(', ')
      return {
        ok: false,
        errors: {
          date: `같은 수강권에 이미 같은 날짜·시간의 수업이 있습니다. (${duplicateText})`,
        },
      }
    }

    const existingScheduledCount = lessons.filter(
      (lesson) =>
        String(lesson.packageId || '').trim() === String(selectedPackage.id) &&
        lesson.isDeductCancelled !== true
    ).length
    const newCount = scheduleEntries.length
    const totalCount = Number(selectedPackage.totalCount ?? 0)
    if (
      Number.isFinite(totalCount) &&
      totalCount >= 0 &&
      existingScheduledCount + newCount > totalCount
    ) {
      return {
        ok: false,
        errors: {
          packageId: `이 수강권으로 예약 가능한 수업 수를 초과했습니다. (현재 예약 ${existingScheduledCount} / 총 ${totalCount})`,
        },
      }
    }

    const seriesId = result.repeatWeekly
      ? `private-series-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
      : null
    const batch = writeBatch(db)
    for (const entry of scheduleEntries) {
      const start = parseLegacyLessonToDate(entry.date, entry.time)
      if (!start) continue

      const lessonRef = doc(collection(db, 'lessons'))
      batch.set(lessonRef, {
        academyId: scopedAcademyId,
        studentId: student.id,
        studentName,
        teacherName: teacherKey,
        student: studentName,
        teacher: teacherKey,
        date: entry.date,
        time: entry.time,
        startAt: Timestamp.fromDate(start),
        subject: result.subject,
        packageId: selectedPackage.id,
        packageType: selectedPackage.packageType,
        packageTitle: String(selectedPackage.title || ''),
        billingType: 'private',
        completed: false,
        completedAt: null,
        isDeductCancelled: false,
        deductMemo: '',
        ...(seriesId ? { seriesId } : {}),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    }
    await batch.commit()
    await recomputePrivatePackageUsage(selectedPackage.id, currentAcademyId)
    return { ok: true }
  }

  async function submitPostPrivateLessonSchedule() {
    if (userProfile?.role !== 'admin') {
      alert('관리자만 수업을 예약할 수 있습니다.')
      return
    }

    const data = postPrivateLessonScheduleModalData
    if (!data?.packageId || !data?.studentId) {
      alert('예약 정보가 올바르지 않습니다.')
      return
    }

    const syntheticForm = {
      studentId: data.studentId,
      packageId: data.packageId,
      date: postPrivateLessonScheduleForm.date,
      time: postPrivateLessonScheduleForm.time,
      subject: postPrivateLessonScheduleForm.subject,
      repeatWeekly: postPrivateLessonScheduleForm.repeatWeekly === true,
      repeatWeeks: postPrivateLessonScheduleForm.repeatWeeks,
      repeatStartMode: postPrivateLessonScheduleForm.repeatStartMode,
      repeatAnchorDate: postPrivateLessonScheduleForm.repeatAnchorDate ?? '',
      weeklyFrequency: postPrivateLessonScheduleForm.weeklyFrequency ?? '1',
      weeklySlot2Date: postPrivateLessonScheduleForm.weeklySlot2Date ?? '',
      weeklySlot2Time: postPrivateLessonScheduleForm.weeklySlot2Time ?? '',
      weeklySlot3Date: postPrivateLessonScheduleForm.weeklySlot3Date ?? '',
      weeklySlot3Time: postPrivateLessonScheduleForm.weeklySlot3Time ?? '',
    }
    const result = validatePrivateLessonFormFields(syntheticForm)
    setPostPrivateLessonScheduleErrors(result.errors)
    if (!result.valid) return

    const student = privateStudents.find((row) => row.id === result.studentId)
    if (!student) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        studentId: '선택한 학생을 찾을 수 없습니다.',
      }))
      return
    }

    const packageSnap = await getDoc(doc(db, 'studentPackages', result.packageId))
    if (!packageSnap.exists()) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        packageId: '등록된 수강권을 찾을 수 없습니다.',
      }))
      return
    }
    const selectedPackage = { id: packageSnap.id, ...packageSnap.data() }
    try {
      assertSameAcademy(student, currentAcademyId, '학생')
      assertSameAcademy(selectedPackage, currentAcademyId, '수강권')
    } catch (error) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        packageId: error.message,
      }))
      return
    }

    if (selectedPackage.packageType !== 'private') {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        packageId: '개인 수강권이 아닙니다.',
      }))
      return
    }
    if (String(selectedPackage.studentId || '').trim() !== student.id) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        packageId: '선택한 학생과 수강권이 일치하지 않습니다.',
      }))
      return
    }
    if (selectedPackage.status !== 'active') {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        packageId: '활성 수강권만 사용할 수 있습니다.',
      }))
      return
    }
    if (Number(selectedPackage.remainingCount ?? 0) <= 0) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        packageId: '남은 횟수가 있는 수강권을 선택해주세요.',
      }))
      return
    }

    const packageTeacher = normalizeText(selectedPackage.teacher || '')
    const studentTeacher = normalizeText(student.teacher || '')
    if (!studentTeacher || packageTeacher !== studentTeacher) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        packageId: '학생 담당 선생님과 수강권의 담당 선생님이 일치하지 않습니다.',
      }))
      return
    }

    const teacherKey = normalizeText(student.teacher)
    if (!teacherKey) {
      alert('이 학생의 담당 선생님(teacher)이 비어 있어 수업을 만들 수 없습니다.')
      return
    }

    if (!parseLegacyLessonToDate(result.date, result.time)) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        date: '날짜·시간을 확인해주세요.',
      }))
      return
    }

    const studentName = String(student.name || '').trim()
    if (!studentName) {
      setPostPrivateLessonScheduleErrors((prev) => ({
        ...prev,
        studentId: '학생 이름이 비어 있습니다.',
      }))
      return
    }

    try {
      setBusyPostPrivateLessonSchedule(true)
      const created = await createPrivateLessonsForPackage({
        result,
        student,
        selectedPackage,
        teacherKey,
      })
      if (!created.ok) {
        setPostPrivateLessonScheduleErrors((prev) => ({ ...prev, ...created.errors }))
        return
      }
      closePostPrivateLessonScheduleModal()
    } catch (error) {
      console.error('첫 수업 예약 실패:', error)
      alert(`첫 수업 예약 실패: ${error.message}`)
    } finally {
      setBusyPostPrivateLessonSchedule(false)
    }
  }

  return {
    studentPackageModalStudent,
    studentPackageForm,
    setStudentPackageForm,
    studentPackageFormErrors,
    busyStudentPackageSubmit,
    openStudentPackageModal,
    closeStudentPackageModal,
    validateStudentPackageFormFields,
    submitStudentPackageModal,
    nextGroupLessonDateByGroupId,
    studentPackageGroupAutoSummary,
    studentPackageModalActiveSameScopeDuplicates,
    postPrivateLessonScheduleModalData,
    postPrivateLessonScheduleForm,
    setPostPrivateLessonScheduleForm,
    postPrivateLessonScheduleErrors,
    busyPostPrivateLessonSchedule,
    closePostPrivateLessonScheduleModal,
    submitPostPrivateLessonSchedule,
    createPrivateLessonsForPackage,
    postGroupReEnrollModalData,
    postGroupReEnrollStartDate,
    setPostGroupReEnrollStartDate,
    postGroupReEnrollErrors,
    busyPostGroupReEnroll,
    closePostGroupReEnrollModal,
    submitPostGroupReEnroll,
    postGroupReEnrollMinStartYmd,
  }
}
