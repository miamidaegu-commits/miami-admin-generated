import { buildPrivateLessonScheduleEntries } from '../dashboardViewUtils.js'

export default function PostPrivateLessonScheduleModal({
  postPrivateLessonScheduleModalData,
  postPrivateLessonScheduleForm,
  setPostPrivateLessonScheduleForm,
  postPrivateLessonScheduleErrors,
  closePostPrivateLessonScheduleModal,
  submitPostPrivateLessonSchedule,
  busyPostPrivateLessonSchedule,
}) {
  const data = postPrivateLessonScheduleModalData
  const openedFromPrivateRegular = data?.openedFromPrivateRegular === true
  const weeklyFrequencyStr = String(postPrivateLessonScheduleForm.weeklyFrequency ?? '1')
  const repeatWeekly = postPrivateLessonScheduleForm.repeatWeekly === true
  const repeatStartMode =
    postPrivateLessonScheduleForm.repeatStartMode === 'afterFirst' ? 'afterFirst' : 'includeStart'
  const previewEntries = buildPrivateLessonScheduleEntries({
    ...postPrivateLessonScheduleForm,
    repeatWeekly,
  })
  const plannedCount = previewEntries.length
  const previewRange =
    previewEntries.length > 0
      ? `${previewEntries[0].date} ~ ${previewEntries[previewEntries.length - 1].date}`
      : ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="post-private-lesson-schedule-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1004,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closePostPrivateLessonScheduleModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 440,
          background: '#151922',
          border: '1px solid #2e3240',
          borderRadius: 12,
          padding: 20,
          color: 'white',
          boxSizing: 'border-box',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="post-private-lesson-schedule-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          첫 수업을 바로 예약할까요?
        </h2>
        <p style={{ margin: '0 0 12px 0', fontSize: 13, opacity: 0.88, lineHeight: 1.5 }}>
          새 개인 수강권이 발급되었습니다. 아래에서 첫 수업 일정을 입력하면 바로 예약됩니다.
        </p>
        {openedFromPrivateRegular ? (
          <p
            style={{
              margin: '0 0 12px 0',
              fontSize: 12,
              opacity: 0.88,
              lineHeight: 1.55,
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid #3d4a7a',
              background: 'rgba(40, 55, 110, 0.25)',
            }}
          >
            정기등록 기준으로 첫 수업과 반복 슬롯을 확인해주세요.
            {weeklyFrequencyStr === '2' || weeklyFrequencyStr === '3' ? (
              <>
                {' '}
                주 2회·3회인 경우 두 번째
                {weeklyFrequencyStr === '3' ? '·세 번째' : ''} 슬롯의 첫 날짜와 시간을 입력해야
                전체 일정이 맞게 채워집니다.
              </>
            ) : null}
          </p>
        ) : null}

        <div
          style={{
            padding: 12,
            borderRadius: 8,
            border: '1px solid #333',
            background: '#1a1d26',
            fontSize: 12,
            lineHeight: 1.55,
            marginBottom: 14,
          }}
        >
          <div>
            <span style={{ opacity: 0.75 }}>학생</span>{' '}
            <strong>{data?.studentName || '-'}</strong>
          </div>
          <div>
            <span style={{ opacity: 0.75 }}>수강권</span>{' '}
            <strong>{String(data?.packageTitle || '').trim() || '—'}</strong>
          </div>
          <div>
            <span style={{ opacity: 0.75 }}>남은 / 총</span>{' '}
            <strong>
              {data?.remainingCount != null ? String(data.remainingCount) : '-'} /{' '}
              {data?.totalCount != null ? String(data.totalCount) : '-'}
            </strong>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>첫 수업 날짜</span>
            <input
              type="date"
              value={postPrivateLessonScheduleForm.date}
              onChange={(e) =>
                setPostPrivateLessonScheduleForm((prev) => ({ ...prev, date: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {postPrivateLessonScheduleErrors.date ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {postPrivateLessonScheduleErrors.date}
              </span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>시간</span>
            <input
              type="time"
              value={postPrivateLessonScheduleForm.time}
              onChange={(e) =>
                setPostPrivateLessonScheduleForm((prev) => ({ ...prev, time: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {postPrivateLessonScheduleErrors.time ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {postPrivateLessonScheduleErrors.time}
              </span>
            ) : null}
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
            <span style={{ opacity: 0.85 }}>과목</span>
            <input
              type="text"
              value={postPrivateLessonScheduleForm.subject}
              onChange={(e) =>
                setPostPrivateLessonScheduleForm((prev) => ({ ...prev, subject: e.target.value }))
              }
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                border: '1px solid #444',
                background: '#1f1f1f',
                color: 'white',
              }}
            />
            {postPrivateLessonScheduleErrors.subject ? (
              <span style={{ color: '#f08080', fontSize: 12 }}>
                {postPrivateLessonScheduleErrors.subject}
              </span>
            ) : null}
          </label>

          <div style={{ padding: 12, borderRadius: 8, border: '1px solid #333', background: '#1a1d26' }}>
            <label
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                fontSize: 13,
                marginBottom: repeatWeekly ? 10 : 0,
              }}
            >
              <input
                type="checkbox"
                checked={repeatWeekly}
                onChange={(e) =>
                  setPostPrivateLessonScheduleForm((prev) => ({
                    ...prev,
                    repeatWeekly: e.target.checked,
                  }))
                }
              />
              <span style={{ opacity: 0.9 }}>매주 반복</span>
            </label>

            {repeatWeekly ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>반복 주수</span>
                  <input
                    type="number"
                    min="1"
                    value={postPrivateLessonScheduleForm.repeatWeeks ?? '4'}
                    onChange={(e) =>
                      setPostPrivateLessonScheduleForm((prev) => ({
                        ...prev,
                        repeatWeeks: e.target.value,
                      }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  />
                  {postPrivateLessonScheduleErrors.repeatWeeks ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {postPrivateLessonScheduleErrors.repeatWeeks}
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>시작 방식</span>
                  <select
                    value={repeatStartMode}
                    onChange={(e) =>
                      setPostPrivateLessonScheduleForm((prev) => ({
                        ...prev,
                        repeatStartMode: e.target.value,
                      }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  >
                    <option value="includeStart">시작일 포함</option>
                    <option value="afterFirst">첫 수업 먼저 + 반복 시작일 이후 반복</option>
                  </select>
                  {postPrivateLessonScheduleErrors.repeatStartMode ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {postPrivateLessonScheduleErrors.repeatStartMode}
                    </span>
                  ) : null}
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                  <span style={{ opacity: 0.85 }}>주당 횟수 (반복 슬롯)</span>
                  <select
                    value={String(postPrivateLessonScheduleForm.weeklyFrequency ?? '1')}
                    onChange={(e) =>
                      setPostPrivateLessonScheduleForm((prev) => ({
                        ...prev,
                        weeklyFrequency: e.target.value,
                      }))
                    }
                    style={{
                      padding: '10px 12px',
                      borderRadius: 8,
                      border: '1px solid #444',
                      background: '#1f1f1f',
                      color: 'white',
                    }}
                  >
                    <option value="1">주 1회</option>
                    <option value="2">주 2회</option>
                    <option value="3">주 3회</option>
                  </select>
                  {postPrivateLessonScheduleErrors.weeklyFrequency ? (
                    <span style={{ color: '#f08080', fontSize: 12 }}>
                      {postPrivateLessonScheduleErrors.weeklyFrequency}
                    </span>
                  ) : null}
                </label>

                {(postPrivateLessonScheduleForm.weeklyFrequency === '2' ||
                  postPrivateLessonScheduleForm.weeklyFrequency === '3') && (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                      <span style={{ opacity: 0.85 }}>두 번째 수업 첫 날짜</span>
                      <input
                        type="date"
                        value={postPrivateLessonScheduleForm.weeklySlot2Date || ''}
                        onChange={(e) =>
                          setPostPrivateLessonScheduleForm((prev) => ({
                            ...prev,
                            weeklySlot2Date: e.target.value,
                          }))
                        }
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid #444',
                          background: '#1f1f1f',
                          color: 'white',
                        }}
                      />
                      {postPrivateLessonScheduleErrors.weeklySlot2Date ? (
                        <span style={{ color: '#f08080', fontSize: 12 }}>
                          {postPrivateLessonScheduleErrors.weeklySlot2Date}
                        </span>
                      ) : null}
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                      <span style={{ opacity: 0.85 }}>두 번째 수업 시간</span>
                      <input
                        type="time"
                        value={postPrivateLessonScheduleForm.weeklySlot2Time || ''}
                        onChange={(e) =>
                          setPostPrivateLessonScheduleForm((prev) => ({
                            ...prev,
                            weeklySlot2Time: e.target.value,
                          }))
                        }
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid #444',
                          background: '#1f1f1f',
                          color: 'white',
                        }}
                      />
                      {postPrivateLessonScheduleErrors.weeklySlot2Time ? (
                        <span style={{ color: '#f08080', fontSize: 12 }}>
                          {postPrivateLessonScheduleErrors.weeklySlot2Time}
                        </span>
                      ) : null}
                    </label>
                  </>
                )}

                {postPrivateLessonScheduleForm.weeklyFrequency === '3' && (
                  <>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                      <span style={{ opacity: 0.85 }}>세 번째 수업 첫 날짜</span>
                      <input
                        type="date"
                        value={postPrivateLessonScheduleForm.weeklySlot3Date || ''}
                        onChange={(e) =>
                          setPostPrivateLessonScheduleForm((prev) => ({
                            ...prev,
                            weeklySlot3Date: e.target.value,
                          }))
                        }
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid #444',
                          background: '#1f1f1f',
                          color: 'white',
                        }}
                      />
                      {postPrivateLessonScheduleErrors.weeklySlot3Date ? (
                        <span style={{ color: '#f08080', fontSize: 12 }}>
                          {postPrivateLessonScheduleErrors.weeklySlot3Date}
                        </span>
                      ) : null}
                    </label>
                    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                      <span style={{ opacity: 0.85 }}>세 번째 수업 시간</span>
                      <input
                        type="time"
                        value={postPrivateLessonScheduleForm.weeklySlot3Time || ''}
                        onChange={(e) =>
                          setPostPrivateLessonScheduleForm((prev) => ({
                            ...prev,
                            weeklySlot3Time: e.target.value,
                          }))
                        }
                        style={{
                          padding: '10px 12px',
                          borderRadius: 8,
                          border: '1px solid #444',
                          background: '#1f1f1f',
                          color: 'white',
                        }}
                      />
                      {postPrivateLessonScheduleErrors.weeklySlot3Time ? (
                        <span style={{ color: '#f08080', fontSize: 12 }}>
                          {postPrivateLessonScheduleErrors.weeklySlot3Time}
                        </span>
                      ) : null}
                    </label>
                  </>
                )}

                {repeatStartMode === 'afterFirst' ? (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 13 }}>
                    <span style={{ opacity: 0.85 }}>반복 시작일</span>
                    <input
                      type="date"
                      value={postPrivateLessonScheduleForm.repeatAnchorDate || ''}
                      onChange={(e) =>
                        setPostPrivateLessonScheduleForm((prev) => ({
                          ...prev,
                          repeatAnchorDate: e.target.value,
                        }))
                      }
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        border: '1px solid #444',
                        background: '#1f1f1f',
                        color: 'white',
                      }}
                    />
                    {postPrivateLessonScheduleErrors.repeatAnchorDate ? (
                      <span style={{ color: '#f08080', fontSize: 12 }}>
                        {postPrivateLessonScheduleErrors.repeatAnchorDate}
                      </span>
                    ) : null}
                    <span style={{ fontSize: 12, opacity: 0.7 }}>
                      첫 수업은 위에서 선택한 날짜에 생성되고, 반복 시작일 이후부터 매주 반복됩니다.
                    </span>
                  </label>
                ) : null}
                {postPrivateLessonScheduleErrors.scheduleSlots ? (
                  <span style={{ color: '#f08080', fontSize: 12 }}>
                    {postPrivateLessonScheduleErrors.scheduleSlots}
                  </span>
                ) : null}
              </div>
            ) : null}

            <p style={{ margin: '10px 0 0 0', fontSize: 12, opacity: 0.78 }}>
              총 {plannedCount}건 생성{previewRange ? ` · ${previewRange}` : ''}
            </p>
          </div>

          {postPrivateLessonScheduleErrors.packageId ? (
            <span style={{ color: '#f08080', fontSize: 12 }}>
              {postPrivateLessonScheduleErrors.packageId}
            </span>
          ) : null}
          {postPrivateLessonScheduleErrors.studentId ? (
            <span style={{ color: '#f08080', fontSize: 12 }}>
              {postPrivateLessonScheduleErrors.studentId}
            </span>
          ) : null}
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            marginTop: 20,
            flexWrap: 'wrap',
          }}
        >
          <button
            type="button"
            onClick={closePostPrivateLessonScheduleModal}
            disabled={busyPostPrivateLessonSchedule}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: busyPostPrivateLessonSchedule ? 'not-allowed' : 'pointer',
            }}
          >
            나중에 하기
          </button>
          <button
            type="button"
            onClick={submitPostPrivateLessonSchedule}
            disabled={busyPostPrivateLessonSchedule}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #4a6fff55',
              background: '#1f2a44',
              color: 'white',
              cursor: busyPostPrivateLessonSchedule ? 'not-allowed' : 'pointer',
            }}
          >
            {busyPostPrivateLessonSchedule ? '처리 중...' : '첫 수업 예약'}
          </button>
        </div>
      </div>
    </div>
  )
}
