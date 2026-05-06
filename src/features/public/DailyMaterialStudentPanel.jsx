export default function DailyMaterialStudentPanel({ material, loading }) {
  const hasMaterial = Boolean(material?.id)

  return (
    <section
      data-testid="student-daily-material-panel"
      style={{
        border: '1px solid #334155',
        borderRadius: 16,
        background: '#142033',
        padding: 20,
      }}
    >
      <h2 style={{ margin: 0, fontSize: '1.1rem' }}>오늘의 영상</h2>

      {loading ? (
        <p style={{ opacity: 0.78, marginBottom: 0 }}>불러오는 중...</p>
      ) : hasMaterial ? (
        <div style={{ display: 'grid', gap: 10, marginTop: 12 }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>{material.title || '-'}</h3>
          {material.description ? (
            <p style={{ margin: 0, opacity: 0.78, lineHeight: 1.55 }}>{material.description}</p>
          ) : null}
          <a
            data-testid="student-daily-material-link"
            href={material.videoUrl}
            target="_blank"
            rel="noreferrer noopener"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 'fit-content',
              minHeight: 40,
              padding: '0 14px',
              borderRadius: 10,
              background: '#2563eb',
              color: 'white',
              fontWeight: 700,
              textDecoration: 'none',
            }}
          >
            영상 보기
          </a>
        </div>
      ) : (
        <p style={{ opacity: 0.78, marginBottom: 0 }}>오늘 등록된 영상이 없습니다.</p>
      )}
    </section>
  )
}
