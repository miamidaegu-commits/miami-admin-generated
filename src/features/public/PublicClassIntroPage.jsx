import { Link } from 'react-router-dom'
import { hasPublicClassLink, publicClassLinks } from './publicClassLinks.js'

const classTypes = [
  {
    title: '1:1 수업',
    description:
      '처음 영어회화를 시작하는 분도 부담 없이 말할 수 있도록 목표, 레벨, 속도에 맞춰 진행합니다.',
  },
  {
    title: '단체반 수업',
    description:
      '비슷한 레벨의 수강생들과 함께 듣고 말하며, 실제 대화에 필요한 표현을 자연스럽게 연습합니다.',
  },
]

const steps = ['상담', '수강권 등록', '로그인 초대', '수업 예약', '수업 참여']

const socialLinks = [
  {
    label: 'Instagram',
    url: publicClassLinks.instagramUrl,
    testId: 'public-instagram-link',
  },
  {
    label: 'YouTube',
    url: publicClassLinks.youtubeUrl,
    testId: 'public-youtube-link',
  },
].filter((link) => hasPublicClassLink(link.url))

const contactUrl = publicClassLinks.contactUrl
const hasContactUrl = hasPublicClassLink(contactUrl)
const reviewUrl = publicClassLinks.reviewUrl
const hasReviewUrl = hasPublicClassLink(reviewUrl)
const sampleVideoUrl = publicClassLinks.sampleVideoUrl
const hasSampleVideoUrl = hasPublicClassLink(sampleVideoUrl)

export default function PublicClassIntroPage() {
  return (
    <main className="public-class-page">
      <section className="public-hero" id="intro" aria-labelledby="intro-title">
        <div className="public-hero-copy">
          <p className="public-eyebrow">Miami English Conversation</p>
          <h1 id="intro-title">마이애미 영어회화 수업 안내</h1>
          <p className="public-hero-subtitle">
            영어로 말하는 일이 아직 어색한 분도 차근차근 시작할 수 있도록 1:1 수업과 단체반 수업을 안내합니다.
          </p>
          <div className="public-cta-row">
            <Link className="public-button primary" to="/login">
              로그인하기
            </Link>
            <a className="public-button secondary" href="#contact">
              수업 문의하기
            </a>
            <a className="public-button ghost" href="#reviews">
              리뷰 보기
            </a>
          </div>
        </div>
        <figure className="public-hero-media" aria-label="영어회화 수업 이미지">
          <img
            src="https://images.unsplash.com/photo-1522202176988-66273c2fd55f?auto=format&fit=crop&w=900&q=80"
            alt="책상에 모여 대화하며 공부하는 수업 분위기"
          />
        </figure>
      </section>

      <section className="public-section" id="class-types" aria-labelledby="class-types-title">
        <div className="public-section-header">
          <h2 id="class-types-title">수업 종류</h2>
          <p>혼자 집중해서 연습하거나, 함께 대화하며 익히는 방식 중에서 선택할 수 있습니다.</p>
        </div>
        <div className="public-card-grid">
          {classTypes.map((classType) => (
            <article className="public-info-card" key={classType.title}>
              <h3>{classType.title}</h3>
              <p>{classType.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="public-section" id="how-it-works" aria-labelledby="how-it-works-title">
        <div className="public-section-header">
          <h2 id="how-it-works-title">이용 방법</h2>
          <p>상담 후 수강권 등록이 완료되면 로그인 초대를 받아 직접 수업을 예약합니다.</p>
        </div>
        <ol className="public-step-list">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
        <p className="public-payment-notice">
          결제는 학원 안내에 따라 오프라인으로 진행됩니다.
        </p>
        <Link className="public-button primary compact" to="/login">
          수업 예약 로그인
        </Link>
      </section>

      <section className="public-section" id="sample-video" aria-labelledby="sample-video-title">
        <div className="public-section-header">
          <h2 id="sample-video-title">수업 영상 미리보기</h2>
          <p>마이애미 영어회화 수업 분위기와 짧은 학습 콘텐츠를 영상으로 확인해 보세요.</p>
        </div>
        <article className="public-info-card public-feature-card">
          <h3>오늘 바로 따라 해볼 수 있는 영어 표현</h3>
          <p>짧은 영상으로 수업 스타일과 말하기 연습 방식을 미리 볼 수 있습니다.</p>
          {hasSampleVideoUrl ? (
            <a
              className="public-button secondary compact"
              data-testid="public-sample-video-link"
              href={sampleVideoUrl}
              target="_blank"
              rel="noreferrer noopener"
            >
              영상 보기
            </a>
          ) : (
            <p className="public-social-empty">영상 링크는 준비 중입니다.</p>
          )}
        </article>
      </section>

      <section className="public-section" id="reviews" aria-labelledby="reviews-title">
        <div className="public-section-header">
          <h2 id="reviews-title">수강생 후기</h2>
          <p>수강생 후기는 외부 블로그 글에서 확인할 수 있습니다.</p>
        </div>
        {hasReviewUrl ? (
          <a
            className="public-button secondary compact"
            data-testid="public-review-link"
            href={reviewUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            후기 보기
          </a>
        ) : (
          <div className="public-empty-review">후기는 준비 중입니다.</div>
        )}
      </section>

      <section className="public-section" id="contact" aria-labelledby="contact-title">
        <div className="public-section-header">
          <h2 id="contact-title">수업 문의</h2>
          <p>수업 방식, 레벨, 일정이 궁금하다면 학원 안내 채널로 문의해 주세요.</p>
        </div>
        {hasContactUrl ? (
          <a
            className="public-button secondary compact"
            data-testid="public-contact-link"
            href={contactUrl}
            target="_blank"
            rel="noreferrer noopener"
          >
            수업 문의하기
          </a>
        ) : (
          <p className="public-social-empty">문의 링크는 준비 중입니다.</p>
        )}
      </section>

      <section className="public-section" id="social-links" aria-labelledby="social-title">
        <div className="public-section-header">
          <h2 id="social-title">소셜 링크</h2>
          <p>공식 채널이 준비되면 수업 소식과 분위기를 이곳에서 확인할 수 있습니다.</p>
        </div>
        {socialLinks.length > 0 ? (
          <div className="public-social-row">
            {socialLinks.map((link) => (
              <a
                className="public-button secondary"
                data-testid={link.testId}
                href={link.url}
                key={link.label}
                target="_blank"
                rel="noreferrer noopener"
              >
                {link.label}
              </a>
            ))}
          </div>
        ) : (
          <p className="public-social-empty">소셜 링크는 준비 중입니다.</p>
        )}
      </section>
    </main>
  )
}
