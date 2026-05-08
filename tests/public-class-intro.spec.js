import { test, expect } from '@playwright/test'
import { BASE_URL } from './e2e-helpers.js'
import { hasPublicClassLink, publicClassLinks } from '../src/features/public/publicClassLinks.js'

async function expectSafeExternalLink(locator, expectedHref) {
  await expect(locator).toHaveAttribute('href', expectedHref)
  await expect(locator).toHaveAttribute('target', '_blank')
  await expect(locator).toHaveAttribute('rel', /noreferrer noopener|noopener noreferrer/)
}

test('public class intro page loads without login and shows class information', async ({ page }) => {
  await page.goto(`${BASE_URL}classes`)

  await expect(page).toHaveURL(/\/classes/)
  await expect(page.getByRole('heading', { name: '마이애미 영어회화 수업 안내', level: 1 })).toBeVisible()
  await expect(page.getByRole('heading', { name: '1:1 수업' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '단체반 수업' })).toBeVisible()
  await expect(page.getByText('결제는 학원 안내에 따라 오프라인으로 진행됩니다.')).toBeVisible()
  await expect(page.getByRole('heading', { name: '수업 영상 미리보기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '수강생 후기' })).toBeVisible()
  await expect(page.getByRole('heading', { name: '수업 문의' })).toBeVisible()
  await expect(page.getByText('문의 링크는 준비 중입니다.')).toBeVisible()

  const instagramUrl = publicClassLinks.instagramUrl
  const youtubeUrl = publicClassLinks.youtubeUrl
  const reviewUrl = publicClassLinks.reviewUrl
  const sampleVideoUrl = publicClassLinks.sampleVideoUrl
  const contactUrl = publicClassLinks.contactUrl

  if (hasPublicClassLink(instagramUrl)) {
    await expectSafeExternalLink(page.getByTestId('public-instagram-link'), instagramUrl)
  } else {
    await expect(page.getByTestId('public-instagram-link')).toHaveCount(0)
  }

  if (hasPublicClassLink(youtubeUrl)) {
    await expectSafeExternalLink(page.getByTestId('public-youtube-link'), youtubeUrl)
  } else {
    await expect(page.getByTestId('public-youtube-link')).toHaveCount(0)
  }

  if (hasPublicClassLink(reviewUrl)) {
    await expectSafeExternalLink(page.getByTestId('public-review-link'), reviewUrl)
    await expect(page.getByText('후기는 준비 중입니다.')).toHaveCount(0)
  } else {
    await expect(page.getByTestId('public-review-link')).toHaveCount(0)
    await expect(page.getByText('후기는 준비 중입니다.')).toBeVisible()
  }

  if (hasPublicClassLink(sampleVideoUrl)) {
    await expectSafeExternalLink(page.getByTestId('public-sample-video-link'), sampleVideoUrl)
  } else {
    await expect(page.getByTestId('public-sample-video-link')).toHaveCount(0)
  }

  if (hasPublicClassLink(contactUrl)) {
    await expectSafeExternalLink(page.getByTestId('public-contact-link'), contactUrl)
  } else {
    await expect(page.getByTestId('public-contact-link')).toHaveCount(0)
  }

  expect(hasPublicClassLink('http://example.com')).toBe(false)

  await page.getByRole('link', { name: '리뷰 보기' }).click()
  await expect(page).toHaveURL(/\/classes#reviews/)

  await page.getByRole('link', { name: '로그인하기' }).click()
  await expect(page).toHaveURL(/\/login/)
  await expect(page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first()).toBeVisible()
})

test('login page links to public class intro and protected routes remain protected', async ({ page }) => {
  await page.goto(BASE_URL)
  await page.getByRole('link', { name: '수업 소개 보기' }).click()
  await expect(page).toHaveURL(/\/classes/)
  await expect(page.getByRole('heading', { name: '마이애미 영어회화 수업 안내', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0)

  await page.goto(`${BASE_URL}dashboard/`)
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toHaveCount(0)

  await page.goto(`${BASE_URL}student-booking`)
  await expect(page.getByRole('heading', { name: '수업 예약', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: '내 수업 내역', exact: true })).toHaveCount(0)
})

test('public SEO files are available for classes indexing', async ({ page }) => {
  const robotsResponse = await page.goto(`${BASE_URL}robots.txt`)
  expect(robotsResponse?.ok()).toBe(true)
  const robotsBody = page.locator('body')
  await expect(robotsBody).toContainText('User-agent: *')
  await expect(robotsBody).toContainText(/Sitemap:\s*https?:\/\/\S+\/sitemap\.xml/)

  const sitemapResponse = await page.goto(`${BASE_URL}sitemap.xml`)
  expect(sitemapResponse?.ok()).toBe(true)
  const sitemapText = await page.locator('body').innerText()
  expect(sitemapText).toMatch(/https?:\/\/[^\s/]+\/(?:[\s<]|$)/)
  expect(sitemapText).toMatch(/https?:\/\/[^\s/]+\/login\b/)
  expect(sitemapText).toMatch(/https?:\/\/[^\s/]+\/classes\b/)
})
