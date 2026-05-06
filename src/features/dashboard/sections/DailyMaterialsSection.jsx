import { useEffect, useMemo, useState } from 'react'
import {
  collection,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  doc,
} from 'firebase/firestore'
import { db } from '../../../../firebase.js'
import { requireCurrentAcademyId } from '../academyScope.js'
import { getTodayStorageDateString } from '../dashboardViewUtils.js'

const initialForm = {
  date: getTodayStorageDateString(),
  title: '',
  description: '',
  videoUrl: '',
  status: 'draft',
}

function buildDailyMaterialId(academyId, date) {
  return `${academyId}__${date}`
}

function normalizeForm(form) {
  return {
    date: String(form.date || '').trim(),
    title: String(form.title || '').trim(),
    description: String(form.description || '').trim(),
    videoUrl: String(form.videoUrl || '').trim(),
    status: form.status === 'published' ? 'published' : 'draft',
  }
}

function validateHttpsUrl(value) {
  try {
    const url = new URL(String(value || '').trim())
    return url.protocol === 'https:'
  } catch {
    return false
  }
}

function validateForm(form) {
  const data = normalizeForm(form)
  const errors = {}
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data.date)) errors.date = '날짜를 선택해 주세요.'
  if (!data.title) errors.title = '제목을 입력해 주세요.'
  if (!validateHttpsUrl(data.videoUrl)) errors.videoUrl = 'https 영상 링크를 입력해 주세요.'
  return { data, errors }
}

export default function DailyMaterialsSection({ currentAcademyId, user }) {
  const [selectedDate, setSelectedDate] = useState(getTodayStorageDateString())
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [form, setForm] = useState(initialForm)
  const [formErrors, setFormErrors] = useState({})
  const [formDirty, setFormDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [savedMessage, setSavedMessage] = useState('')

  const scopedAcademyId = useMemo(() => {
    try {
      return requireCurrentAcademyId(currentAcademyId)
    } catch {
      return ''
    }
  }, [currentAcademyId])

  const expectedMaterialId = scopedAcademyId && selectedDate
    ? buildDailyMaterialId(scopedAcademyId, selectedDate)
    : ''
  const currentMaterial = materials.find((material) => material.id === expectedMaterialId) || null
  const sameDateLegacyMaterialCount = materials.filter((material) => material.id !== expectedMaterialId).length

  useEffect(() => {
    if (!scopedAcademyId || !selectedDate) {
      setMaterials([])
      setLoading(false)
      setError('')
      return
    }

    setLoading(true)
    setError('')

    const q = query(
      collection(db, 'dailyMaterials'),
      where('academyId', '==', scopedAcademyId),
      where('date', '==', selectedDate)
    )

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const rows = snapshot.docs
          .map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }))
          .sort((a, b) => String(a.id).localeCompare(String(b.id)))
        setMaterials(rows)
        setLoading(false)
      },
      (snapshotError) => {
        console.error('오늘의 영상 불러오기 실패:', snapshotError)
        setMaterials([])
        setLoading(false)
        setError('오늘의 영상을 불러오지 못했습니다.')
      }
    )

    return () => unsubscribe()
  }, [scopedAcademyId, selectedDate])

  useEffect(() => {
    if (formDirty) return

    if (currentMaterial) {
      setForm({
        date: String(currentMaterial.date || selectedDate),
        title: String(currentMaterial.title || ''),
        description: String(currentMaterial.description || ''),
        videoUrl: String(currentMaterial.videoUrl || ''),
        status: currentMaterial.status === 'published' ? 'published' : 'draft',
      })
      setFormErrors({})
      return
    }

    setForm({
      ...initialForm,
      date: selectedDate || getTodayStorageDateString(),
    })
    setFormErrors({})
  }, [currentMaterial, formDirty, selectedDate])

  async function saveMaterial() {
    if (!scopedAcademyId) return
    const { data, errors } = validateForm(form)
    setFormErrors(errors)
    setSavedMessage('')
    if (Object.keys(errors).length > 0) return

    setSaving(true)
    try {
      const payload = {
        academyId: scopedAcademyId,
        date: data.date,
        title: data.title,
        description: data.description,
        videoUrl: data.videoUrl,
        status: data.status,
        visibility: 'allStudents',
        updatedAt: serverTimestamp(),
      }
      const materialRef = doc(db, 'dailyMaterials', buildDailyMaterialId(scopedAcademyId, data.date))
      const targetMaterial = materials.find((material) => material.id === materialRef.id) || null

      if (targetMaterial) {
        await updateDoc(materialRef, payload)
      } else {
        await setDoc(materialRef, {
          ...payload,
          createdByUid: user?.uid || '',
          createdAt: serverTimestamp(),
        })
      }

      setSelectedDate(data.date)
      setFormDirty(false)
      setSavedMessage(data.status === 'published' ? '영상이 공개되었습니다.' : '임시저장되었습니다.')
    } catch (saveError) {
      console.error('오늘의 영상 저장 실패:', saveError)
      setError(`오늘의 영상을 저장하지 못했습니다: ${saveError.message}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="activity-section" data-testid="daily-materials-section">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="section-title" style={{ marginBottom: 6 }}>
            오늘의 영상 관리
          </h2>
          <p style={{ margin: 0, opacity: 0.72, fontSize: 13 }}>
            날짜별로 학생에게 공개할 학습 영상을 등록합니다.
          </p>
        </div>
        {currentMaterial ? (
          <span style={{ opacity: 0.72, fontSize: 13 }}>
            현재 상태: {currentMaterial.status === 'published' ? '공개' : '임시저장'}
          </span>
        ) : null}
      </div>

      <div
        style={{
          display: 'grid',
          gap: 12,
          marginTop: 18,
          padding: 16,
          border: '1px solid #2e3240',
          borderRadius: 12,
          background: '#151922',
        }}
      >
        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          날짜
          <input
            aria-label="오늘의 영상 날짜"
            type="date"
            value={form.date}
            onChange={(event) => {
              const nextDate = event.target.value
              setForm((prev) => ({ ...prev, date: nextDate }))
              setFormDirty(false)
              setSavedMessage('')
              setSelectedDate(nextDate)
            }}
          />
          {formErrors.date ? <span style={{ color: '#f4a7a7' }}>{formErrors.date}</span> : null}
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          제목
          <input
            aria-label="오늘의 영상 제목"
            value={form.title}
            onChange={(event) => {
              setFormDirty(true)
              setForm((prev) => ({ ...prev, title: event.target.value }))
            }}
            placeholder="예: 오늘의 표현 연습"
          />
          {formErrors.title ? <span style={{ color: '#f4a7a7' }}>{formErrors.title}</span> : null}
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          설명
          <textarea
            aria-label="오늘의 영상 설명"
            value={form.description}
            onChange={(event) => {
              setFormDirty(true)
              setForm((prev) => ({ ...prev, description: event.target.value }))
            }}
            rows={4}
            placeholder="학생에게 보여줄 안내를 입력해 주세요."
          />
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          영상 링크
          <input
            aria-label="오늘의 영상 링크"
            value={form.videoUrl}
            onChange={(event) => {
              setFormDirty(true)
              setForm((prev) => ({ ...prev, videoUrl: event.target.value }))
            }}
            placeholder="https://..."
          />
          {formErrors.videoUrl ? (
            <span style={{ color: '#f4a7a7' }}>{formErrors.videoUrl}</span>
          ) : null}
        </label>

        <label style={{ display: 'grid', gap: 6, fontSize: 13 }}>
          공개 상태
          <select
            aria-label="오늘의 영상 공개 상태"
            value={form.status}
            onChange={(event) => {
              setFormDirty(true)
              setForm((prev) => ({ ...prev, status: event.target.value }))
            }}
          >
            <option value="draft">임시저장</option>
            <option value="published">공개</option>
          </select>
        </label>

        {error ? <p style={{ color: '#f4a7a7', margin: 0 }}>{error}</p> : null}
        {loading ? <p style={{ opacity: 0.78, margin: 0 }}>불러오는 중...</p> : null}
        {sameDateLegacyMaterialCount > 0 && !currentMaterial ? (
          <p style={{ opacity: 0.68, margin: 0, fontSize: 12 }}>
            같은 날짜의 이전 영상 문서가 있지만 새 저장은 표준 문서로 생성됩니다.
          </p>
        ) : null}
        {savedMessage ? <p style={{ color: '#86efac', margin: 0 }}>{savedMessage}</p> : null}

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn-primary"
            onClick={saveMaterial}
            disabled={saving || loading}
            data-testid="daily-material-save-button"
          >
            {saving ? '저장 중...' : currentMaterial ? '영상 수정' : '영상 등록'}
          </button>
          <span style={{ alignSelf: 'center', opacity: 0.65, fontSize: 12 }}>
            공개 범위: 전체 학생
          </span>
        </div>
      </div>
    </section>
  )
}
