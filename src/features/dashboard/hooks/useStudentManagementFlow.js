import { useEffect, useMemo, useState } from 'react'
import { addDoc, collection, doc, serverTimestamp, updateDoc } from 'firebase/firestore'
import { db } from '../../../../firebase'
import { normalizeText } from '../dashboardViewUtils.js'

const DEFAULT_STUDENT_FORM = {
  name: '',
  teacher: '',
  phone: '',
  carNumber: '',
  learningPurpose: '',
  firstRegisteredAt: '',
  note: '',
}

function resolveStateUpdater(updater, prev) {
  return typeof updater === 'function' ? updater(prev) : updater
}

function createDefaultStudentForm(overrides = {}) {
  return {
    ...DEFAULT_STUDENT_FORM,
    ...overrides,
  }
}

export default function useStudentManagementFlow({
  activeSection,
  userProfile,
  formatLocalYmd,
  studentDocFieldToYmdString,
  openStudentPackageModal,
}) {
  const [studentModalOpen, setStudentModalOpen] = useState(false)
  const [studentForm, setStudentFormState] = useState(createDefaultStudentForm())
  const [studentFormErrors, setStudentFormErrors] = useState({})
  const [busyStudentSubmit, setBusyStudentSubmit] = useState(false)

  const [editStudentModalStudent, setEditStudentModalStudent] = useState(null)
  const [editStudentForm, setEditStudentForm] = useState(createDefaultStudentForm())
  const [editStudentFormErrors, setEditStudentFormErrors] = useState({})
  const [busyEditStudentSubmit, setBusyEditStudentSubmit] = useState(null)

  const [postStudentCreateModalStudent, setPostStudentCreateModalStudent] = useState(null)

  const isAdmin = userProfile?.role === 'admin'
  const studentModal = studentModalOpen
    ? { type: 'add' }
    : editStudentModalStudent
      ? { type: 'edit', student: editStudentModalStudent }
      : null

  const activeStudentForm = studentModalOpen ? studentForm : editStudentForm
  const activeStudentFormErrors = studentModalOpen ? studentFormErrors : editStudentFormErrors
  const busyStudentId = busyStudentSubmit ? '__add__' : busyEditStudentSubmit || null

  const isStudentModalSubmitting = useMemo(() => {
    if (!studentModal) return false
    return studentModal.type === 'add'
      ? busyStudentSubmit
      : busyEditStudentSubmit === studentModal.student.id
  }, [busyEditStudentSubmit, busyStudentSubmit, studentModal])

  useEffect(() => {
    if (activeSection !== 'students') {
      setStudentModalOpen(false)
      setStudentFormErrors({})
      setEditStudentModalStudent(null)
      setEditStudentFormErrors({})
    }
  }, [activeSection])

  useEffect(() => {
    if (!studentModalOpen && !editStudentModalStudent) return

    function onKeyDown(e) {
      if (e.key === 'Escape') {
        closeStudentModal()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [studentModalOpen, editStudentModalStudent])

  function setStudentForm(updater) {
    if (studentModalOpen) {
      setStudentFormState((prev) => resolveStateUpdater(updater, prev))
      return
    }
    if (editStudentModalStudent) {
      setEditStudentForm((prev) => resolveStateUpdater(updater, prev))
    }
  }

  function openStudentModal() {
    openStudentAddModal()
  }

  function openStudentAddModal() {
    if (!(userProfile?.role === 'admin' || userProfile?.canAddStudent === true)) {
      alert('학생 추가 권한이 없습니다.')
      return
    }

    setStudentFormState(
      createDefaultStudentForm({
        teacher: isAdmin ? '' : normalizeText(userProfile?.teacherName || ''),
        firstRegisteredAt: formatLocalYmd(new Date()),
      })
    )
    setStudentFormErrors({})
    setStudentModalOpen(true)
    setEditStudentModalStudent(null)
  }

  function openEditStudentModal(student) {
    if (!(userProfile?.role === 'admin' || userProfile?.canEditStudent === true)) {
      alert('학생 수정 권한이 없습니다.')
      return
    }

    setEditStudentForm(
      createDefaultStudentForm({
        name: student.name || '',
        teacher: isAdmin ? student.teacher || '' : normalizeText(userProfile?.teacherName || ''),
        phone: student.phone != null ? String(student.phone) : '',
        carNumber: student.carNumber != null ? String(student.carNumber) : '',
        learningPurpose:
          student.learningPurpose != null ? String(student.learningPurpose) : '',
        firstRegisteredAt: studentDocFieldToYmdString(student.firstRegisteredAt),
        note: student.note != null ? String(student.note) : '',
      })
    )
    setEditStudentFormErrors({})
    setEditStudentModalStudent(student)
    setStudentModalOpen(false)
  }

  function openStudentEditModal(student) {
    openEditStudentModal(student)
  }

  function closeStudentModal() {
    if (studentModalOpen) {
      setStudentModalOpen(false)
      setStudentFormErrors({})
      return
    }
    closeEditStudentModal()
  }

  function closeEditStudentModal() {
    setEditStudentModalStudent(null)
    setEditStudentFormErrors({})
  }

  function validateStudentFormFields(form) {
    const errors = {}
    const name = String(form.name || '').trim()
    const teacher = String(form.teacher || '').trim()
    if (!name) errors.name = '이름을 입력해주세요.'
    if (!teacher) errors.teacher = '선생님 이름을 입력해주세요.'

    const phone = String(form.phone ?? '').trim()
    const carNumber = String(form.carNumber ?? '').trim()
    const learningPurpose = String(form.learningPurpose ?? '').trim()
    const note = String(form.note ?? '').trim()

    let firstRegisteredAt = ''
    const firstRegisteredAtRaw = String(form.firstRegisteredAt ?? '').trim()
    if (firstRegisteredAtRaw) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(firstRegisteredAtRaw)) {
        errors.firstRegisteredAt = '날짜 형식이 올바르지 않습니다.'
      } else {
        const [y, mo, d] = firstRegisteredAtRaw.split('-').map(Number)
        const date = new Date(y, mo - 1, d)
        if (
          date.getFullYear() !== y ||
          date.getMonth() !== mo - 1 ||
          date.getDate() !== d
        ) {
          errors.firstRegisteredAt = '유효한 날짜를 선택해주세요.'
        } else {
          firstRegisteredAt = firstRegisteredAtRaw
        }
      }
    }

    return {
      valid: Object.keys(errors).length === 0,
      errors,
      name,
      teacher,
      phone,
      carNumber,
      learningPurpose,
      firstRegisteredAt,
      note,
    }
  }

  function validateEditStudentFormFields(form) {
    return validateStudentFormFields(form)
  }

  async function submitStudentModal() {
    if (studentModalOpen) {
      await submitAddStudentModal()
      return
    }
    await submitEditStudentModal()
  }

  async function submitAddStudentModal() {
    if (!studentModalOpen) return

    const result = validateStudentFormFields(studentForm)
    setStudentFormErrors(result.errors)
    if (!result.valid) return

    const teacherStored = isAdmin
      ? normalizeText(result.teacher)
      : normalizeText(userProfile?.teacherName)

    try {
      setBusyStudentSubmit(true)
      const docRef = await addDoc(collection(db, 'privateStudents'), {
        name: result.name,
        teacher: teacherStored,
        phone: result.phone,
        carNumber: result.carNumber,
        learningPurpose: result.learningPurpose,
        firstRegisteredAt: result.firstRegisteredAt,
        note: result.note,
        paidLessons: 0,
        attendanceCount: 0,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      closeStudentModal()
      if (isAdmin) {
        setPostStudentCreateModalStudent({
          id: docRef.id,
          name: result.name,
          teacher: teacherStored,
          paidLessons: 0,
          attendanceCount: 0,
        })
      }
    } catch (error) {
      console.error('학생 추가 실패:', error)
      alert(`학생 추가 실패: ${error.message}`)
    } finally {
      setBusyStudentSubmit(false)
    }
  }

  async function submitEditStudentModal() {
    if (!editStudentModalStudent) return

    const result = validateEditStudentFormFields(editStudentForm)
    setEditStudentFormErrors(result.errors)
    if (!result.valid) return

    const teacherStored = isAdmin
      ? normalizeText(result.teacher)
      : normalizeText(userProfile?.teacherName)

    try {
      setBusyEditStudentSubmit(editStudentModalStudent.id)
      await updateDoc(doc(db, 'privateStudents', editStudentModalStudent.id), {
        name: result.name,
        teacher: teacherStored,
        phone: result.phone,
        carNumber: result.carNumber,
        learningPurpose: result.learningPurpose,
        firstRegisteredAt: result.firstRegisteredAt,
        note: result.note,
        updatedAt: serverTimestamp(),
      })
      closeEditStudentModal()
    } catch (error) {
      console.error('학생 수정 실패:', error)
      alert(`학생 수정 실패: ${error.message}`)
    } finally {
      setBusyEditStudentSubmit(null)
    }
  }

  function closePostStudentCreateModal() {
    setPostStudentCreateModalStudent(null)
  }

  function selectPostStudentCreatePrivatePackage() {
    const student = postStudentCreateModalStudent
    if (!student) return
    setPostStudentCreateModalStudent(null)
    openStudentPackageModal(student, 'private')
  }

  function selectPostStudentCreateGroupPackage() {
    const student = postStudentCreateModalStudent
    if (!student) return
    setPostStudentCreateModalStudent(null)
    openStudentPackageModal(student, 'group')
  }

  return {
    studentModalOpen,
    studentAddForm: studentForm,
    studentAddFormErrors: studentFormErrors,
    busyStudentSubmit,
    openStudentModal,
    openStudentAddModal,
    closeStudentModal,
    validateStudentFormFields,
    submitStudentModal,
    editStudentModalStudent,
    editStudentForm,
    editStudentFormErrors,
    busyEditStudentSubmit,
    openEditStudentModal,
    openStudentEditModal,
    closeEditStudentModal,
    validateEditStudentFormFields,
    submitEditStudentModal,
    postStudentCreateModalStudent,
    closePostStudentCreateModal,
    selectPostStudentCreatePrivatePackage,
    selectPostStudentCreateGroupPackage,
    studentModal,
    studentForm: activeStudentForm,
    setStudentForm,
    studentFormErrors: activeStudentFormErrors,
    busyStudentId,
    isStudentModalSubmitting,
  }
}
