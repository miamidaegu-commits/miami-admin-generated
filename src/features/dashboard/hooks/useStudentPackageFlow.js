import { useEffect, useMemo, useState } from 'react'
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  Timestamp,
  where,
  writeBatch,
} from 'firebase/firestore'
import { db } from '../../../../firebase'
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

const DEFAULT_STUDENT_PACKAGE_FORM = {
  packageType: 'private',
  title: '',
  totalCount: '1',
  groupClassId: '',
  registrationStartDate: '',
  registrationWeeks: '4',
  weeklyFrequency: '1',
  privatePackageMode: 'regular',
  expiresAt: '',
  amountPaid: '',
  memo: '',
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

export default function useStudentPackageFlow({
  activeSection,
  userProfile,
  privateStudents,
  groupClasses,
  studentPackages,
  lessons,
  studentSummaryGroupLessons,
  buildGroupPackageCoverageLessons,
  addCreditTransaction,
  getNextGroupLessonDateYmd,
  recomputePrivatePackageUsage,
  validatePrivateLessonFormFields,
}) {
  const [studentPackageModalStudent, setStudentPackageModalStudent] = useState(null)
  const [studentPackageForm, setStudentPackageForm] = useState(
    createDefaultStudentPackageForm()
  )
  const [studentPackageFormErrors, setStudentPackageFormErrors] = useState({})
  const [busyStudentPackageSubmit, setBusyStudentPackageSubmit] = useState(false)
  const [, setStudentPackageReRegisterSourcePackage] = useState(null)

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

  const studentPackageModalActiveSameScopeDuplicates = useMemo(() => {
    const student = studentPackageModalStudent
    if (!student?.id) return []

    const packageType = String(studentPackageForm.packageType || 'private').trim()
    if (packageType !== 'private' && packageType !== 'group' && packageType !== 'openGroup') {
      return []
    }

    let teacherForScope = String(student.teacher || '')
    let groupClassId = ''
    if (packageType === 'group' || packageType === 'openGroup') {
      groupClassId = String(studentPackageForm.groupClassId || '').trim()
      if (!groupClassId) return []
      teacherForScope = ''
    }

    const scopeKey = buildStudentPackageScopeKey({
      packageType,
      teacher: teacherForScope,
      groupClassId,
    })
    const studentId = String(student.id).trim()

    return studentPackages.filter((pkg) => {
      if (String(pkg.studentId || '').trim() !== studentId) return false
      if (!isStudentPackageRowActive(pkg)) return false
      return studentPackageAttentionScope(pkg) === scopeKey
    })
  }, [
    studentPackageModalStudent,
    studentPackageForm.packageType,
    studentPackageForm.groupClassId,
    studentPackages,
  ])

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

  function openStudentPackageModal(student, initialPackageType, reRegisterSourcePackage) {
    if (userProfile?.role !== 'admin') return

    let packageType =
      initialPackageType === 'group' ||
      initialPackageType === 'openGroup' ||
      initialPackageType === 'private'
        ? initialPackageType
        : 'private'

    setStudentPackageModalStudent(student)

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

      setStudentPackageForm(
        createDefaultStudentPackageForm({
          packageType,
          title: String(sourcePackage.title || '').trim(),
          totalCount,
          groupClassId,
          registrationStartDate,
          registrationWeeks,
          weeklyFrequency,
          privatePackageMode,
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
          registrationStartDate,
        })
      )
    }

    setStudentPackageFormErrors({})
    setStudentPackageReRegisterSourcePackage(reRegisterSourcePackage || null)
  }

  function validateStudentPackageFormFields(form) {
    const errors = {}
    const title = String(form.title || '').trim()
    const packageTypeEarly = form.packageType
    const privatePackageMode =
      packageTypeEarly === 'private' &&
      String(form.privatePackageMode || '').trim() === 'countBased'
        ? 'countBased'
        : packageTypeEarly === 'private'
          ? 'regular'
          : null
    const isPrivateRegular =
      packageTypeEarly === 'private' && privatePackageMode === 'regular'

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
    let outgoingTotalCount = totalParsed.ok ? totalParsed.value : 1

    if (packageType === 'group' || packageType === 'openGroup') {
      if (!groupClassId) errors.groupClassId = '그룹을 선택해주세요.'
      registrationStartDate = String(form.registrationStartDate || '').trim()
      if (!registrationStartDate) {
        errors.registrationStartDate = '시작일을 선택해주세요.'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(registrationStartDate)) {
        errors.registrationStartDate = '시작일 형식이 올바르지 않습니다.'
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
        errors.registrationStartDate = '시작일을 선택해주세요.'
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(registrationStartDate)) {
        errors.registrationStartDate = '시작일 형식이 올바르지 않습니다.'
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

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      title: title || '',
      totalCount: outgoingTotalCount,
      packageType,
      groupClassId,
      registrationStartDate,
      registrationWeeks,
      weeklyFrequency,
      privatePackageMode,
      expiresAt: expiresAtTs,
      amountPaid,
      memo: String(form.memo || '').trim(),
    }
  }

  async function submitStudentPackageModal() {
    if (!studentPackageModalStudent) return
    if (userProfile?.role !== 'admin') {
      alert('관리자만 수강권을 추가할 수 있습니다.')
      return
    }

    const result = validateStudentPackageFormFields(studentPackageForm)
    setStudentPackageFormErrors(result.errors)
    if (!result.valid) return

    const student = studentPackageModalStudent
    const studentId = student.id
    const studentName = String(student.name || '').trim() || '-'

    let teacher = ''
    let groupClassId = null
    let groupClassName = null
    let computedTotalCount = result.totalCount
    let coverageEndDate = ''
    let registrationStartDateForSave = ''
    let registrationWeeksForSave = null

    if (result.packageType === 'private') {
      teacher = normalizeText(student.teacher || '')
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
      teacher: result.packageType === 'private' ? String(student.teacher || '') : '',
      groupClassId:
        result.packageType === 'private' ? '' : String(groupClassId || '').trim(),
    })
    const activeSameScope = studentPackages.filter((pkg) => {
      if (String(pkg.studentId || '').trim() !== studentId) return false
      if (!isStudentPackageRowActive(pkg)) return false
      return studentPackageAttentionScope(pkg) === scopeKey
    })
    if (activeSameScope.length > 0) {
      const ok = window.confirm(
        '같은 범위의 사용 중 수강권이 이미 있습니다. 그래도 새 수강권을 발급할까요?'
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
      setBusyStudentPackageSubmit(true)

      const newStudentPackagePayload = {
        studentId,
        studentName,
        teacher,
        packageType: result.packageType,
        groupClassId,
        groupClassName,
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

      const docRef = await addDoc(collection(db, 'studentPackages'), newStudentPackagePayload)
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
        const nextStartYmd = await getNextGroupLessonDateYmd(groupClassId)
        const todayYmd = getTodayStorageDateString()
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
          showNextLessonAutoHint: nextStartYmd !== todayYmd,
          packageRegistrationStartDate: registrationStartDateForSave,
        })
        setPostGroupReEnrollStartDate(registrationStartDateForSave)
        setPostGroupReEnrollErrors({})
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
      setBusyPostGroupReEnroll(true)

      const snap = await getDocs(
        query(collection(db, 'groupStudents'), where('studentId', '==', enrollStudentId))
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
      batch.set(newGroupStudentRef, {
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
      })

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
    await recomputePrivatePackageUsage(selectedPackage.id)
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
