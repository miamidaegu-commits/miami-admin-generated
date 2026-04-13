
export default function GroupLessonAttendanceModal({
  selectedGroupClass,
  groupLessonForAttendanceModal,
  groupLessonAttendanceModalRows,
  isAdmin,
  busyGroupAttendanceStudentId,
  applyGroupLessonAttendanceDeduction,
  applyGroupLessonAttendanceUndo,
  closeGroupLessonAttendanceModal,
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-lesson-attendance-modal-title"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: 16,
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) closeGroupLessonAttendanceModal()
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 640,
          maxHeight: 'min(85vh, 720px)',
          overflow: 'auto',
          background: '#151922',
          border: '1px solid #2e3240',
          borderRadius: 12,
          padding: 20,
          color: 'white',
          boxSizing: 'border-box',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2
          id="group-lesson-attendance-modal-title"
          style={{ margin: '0 0 8px 0', fontSize: '1.1rem', fontWeight: 600 }}
        >
          출결 / 차감
        </h2>
        <p style={{ margin: '0 0 6px 0', fontSize: 13, opacity: 0.88 }}>
          {selectedGroupClass.name || '-'}
        </p>
        <p style={{ margin: '0 0 16px 0', fontSize: 13, opacity: 0.78 }}>
          {groupLessonForAttendanceModal.date || '-'} · {groupLessonForAttendanceModal.time || '-'} ·{' '}
          {groupLessonForAttendanceModal.subject || '-'}
        </p>

        {groupLessonAttendanceModalRows.length === 0 ? (
          <p style={{ margin: 0, fontSize: 13, opacity: 0.75 }}>
            이 수업에 차감할 수 있는 학생이 없습니다. (
            {isAdmin
              ? '반 시작일·상태·수강권을 확인하세요.'
              : '반 시작일·상태·남은 횟수를 확인하세요.'}
            )
          </p>
        ) : (
          <div className="activity-table">
            <div
              className="table-head"
              style={{
                gridTemplateColumns: '1.1fr 1fr 0.55fr 0.9fr minmax(150px, auto)',
              }}
            >
              <span>학생</span>
              <span>{isAdmin ? '수강권' : '등록명'}</span>
              <span>남은 횟수</span>
              <span>상태</span>
              <span>작업</span>
            </div>
            {groupLessonAttendanceModalRows.map((row) => {
              const gs = row.groupStudent
              const lessonRef = groupLessonForAttendanceModal
              const rowBusy =
                busyGroupAttendanceStudentId === `${lessonRef.id}__${gs.id}`
              return (
                <div
                  key={gs.id}
                  className="table-row"
                  style={{
                    gridTemplateColumns: '1.1fr 1fr 0.55fr 0.9fr minmax(150px, auto)',
                  }}
                >
                  <span>{row.groupStudent.studentName || row.groupStudent.name || '-'}</span>
                  <span style={{ wordBreak: 'break-word' }}>{row.packageTitle}</span>
                  <span>
                    {row.remainingCount != null ? row.remainingCount : '—'}
                  </span>
                  <span>{row.statusLabel}</span>
                  <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {!row.isCounted && row.canDeduct ? (
                      <button
                        type="button"
                        onClick={() =>
                          applyGroupLessonAttendanceDeduction(gs, lessonRef)
                        }
                        disabled={rowBusy}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #335533',
                          background: !rowBusy ? '#2a3d2a' : '#2a2a2a',
                          color: 'white',
                          cursor: rowBusy ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {rowBusy ? '처리 중' : '차감'}
                      </button>
                    ) : null}
                    {row.isCounted ? (
                      <button
                        type="button"
                        onClick={() =>
                          applyGroupLessonAttendanceUndo(gs, lessonRef)
                        }
                        disabled={!row.canUndo || rowBusy}
                        style={{
                          padding: '6px 10px',
                          borderRadius: 8,
                          border: '1px solid #554433',
                          background: row.canUndo && !rowBusy ? '#3d352a' : '#2a2a2a',
                          color: 'white',
                          cursor: !row.canUndo || rowBusy ? 'not-allowed' : 'pointer',
                          fontSize: 12,
                        }}
                      >
                        {rowBusy ? '처리 중' : '차감복구'}
                      </button>
                    ) : null}
                  </span>
                </div>
              )
            })}
          </div>
        )}

        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 18,
          }}
        >
          <button
            type="button"
            onClick={closeGroupLessonAttendanceModal}
            style={{
              padding: '10px 16px',
              borderRadius: 8,
              border: '1px solid #555',
              background: 'transparent',
              color: 'white',
              cursor: 'pointer',
            }}
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  )
}
