import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_TEACHER_EMAIL,
  TEST_TEACHER_PASSWORD,
  TEST_STUDENT_EMAIL,
  TEST_STUDENT_PASSWORD,
} from './fixtures/test-data.js';
import { ensureE2EUserFixtures, hasE2EServiceAccount } from './e2e-user-fixtures.js';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || 'https://miami-e2e.web.app';
const EXPECTED_HOSTED_FIREBASE_PROJECT_ID = 'miami-e2e';
let hostedAuthSmokeSkipReason = '';

const forbiddenConsolePatterns = [
  /Firebase project mismatch/i,
  /miamiacademyschedule/i,
  /localhost/i,
  /127\.0\.0\.1/i,
];

function installHostedSmokeChecks(page) {
  const forbiddenConsoleErrors = [];
  let sawMiamiE2eRequest = false;

  page.on('console', (message) => {
    if (message.type() !== 'error') return;

    const text = message.text();
    if (forbiddenConsolePatterns.some((pattern) => pattern.test(text))) {
      forbiddenConsoleErrors.push(text);
    }
  });

  page.on('request', (request) => {
    if (request.url().includes('miami-e2e')) {
      sawMiamiE2eRequest = true;
    }
  });

  return {
    assertClean() {
      expect(forbiddenConsoleErrors, 'forbidden hosted console errors').toEqual([]);
      expect(sawMiamiE2eRequest, 'expected at least one network request targeting miami-e2e').toBe(true);
    },
  };
}

async function login(page, email, password, pathPattern) {
  const baseUrl = BASE_URL.replace(/\/$/, '');
  await page.goto(`${baseUrl}/login`);
  await page.getByLabel(/Email|이메일/i).or(page.locator('input[type="email"]')).first().fill(email);
  await page
    .getByLabel(/Password|비밀번호/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(password);
  await page.getByRole('button', { name: /Sign In|로그인/i }).click();
  await expect(page).toHaveURL(pathPattern, { timeout: 15000 });
}

async function getHostedFirebaseProjectId() {
  const baseUrl = BASE_URL.replace(/\/$/, '');
  const indexResponse = await fetch(`${baseUrl}/`);
  if (!indexResponse.ok) {
    throw new Error(`Unable to fetch hosted index: ${indexResponse.status}`);
  }
  const indexHtml = await indexResponse.text();
  const assetPath = indexHtml.match(/<script[^>]+src="([^"]*\/assets\/[^"]+\.js)"/)?.[1];
  if (!assetPath) return '';

  const assetUrl = new URL(assetPath, `${baseUrl}/`).toString();
  const assetResponse = await fetch(assetUrl);
  if (!assetResponse.ok) {
    throw new Error(`Unable to fetch hosted bundle: ${assetResponse.status}`);
  }
  const assetText = await assetResponse.text();
  return (
    assetText.match(/VITE_FIREBASE_PROJECT_ID:\s*"([^"]+)"/)?.[1] ||
    assetText.match(/projectId:\s*"([^"]+)"/)?.[1] ||
    ''
  );
}

test.describe('hosted miami-e2e smoke', () => {
  test.beforeAll(async () => {
    const hostedProjectId = await getHostedFirebaseProjectId().catch(() => '');
    if (hostedProjectId && hostedProjectId !== EXPECTED_HOSTED_FIREBASE_PROJECT_ID) {
      hostedAuthSmokeSkipReason =
        `Hosted app is configured for Firebase project ${hostedProjectId}, not ${EXPECTED_HOSTED_FIREBASE_PROJECT_ID}.`;
      return;
    }
    if (!hasE2EServiceAccount()) {
      hostedAuthSmokeSkipReason = 'serviceAccountKey.json is required to seed hosted smoke users.';
      return;
    }

    if (!hostedProjectId) {
      hostedAuthSmokeSkipReason = 'Could not verify hosted Firebase project id.';
      return;
    }

    if (hasE2EServiceAccount()) {
      await ensureE2EUserFixtures();
    }
  });

  test('public classes route loads from hosted app and survives refresh', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'hosted smoke is run against chromium');

    const smokeChecks = installHostedSmokeChecks(page);

    await page.goto(`${BASE_URL}/classes`);
    await expect(page.getByRole('heading', { name: '마이애미 영어회화 수업 안내' })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('heading', { name: '1:1 수업', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '단체반 수업', exact: true })).toBeVisible();

    await page.reload();
    await expect(page).toHaveURL(/\/classes/);
    await expect(page.getByRole('heading', { name: '마이애미 영어회화 수업 안내' })).toBeVisible({
      timeout: 15000,
    });

    smokeChecks.assertClean();
  });

  test('admin dashboard route loads from hosted app', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'hosted smoke is run against chromium');
    test.skip(Boolean(hostedAuthSmokeSkipReason), hostedAuthSmokeSkipReason);

    const smokeChecks = installHostedSmokeChecks(page);

    await login(page, ADMIN_EMAIL, ADMIN_PASSWORD, /\/dashboard/);

    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '1:1 예약 시간 관리', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '학생 관리', exact: true }).click();
    await expect(page.getByRole('heading', { name: '학생 관리', level: 1 })).toBeVisible({
      timeout: 15000,
    });

    await page.goto(`${BASE_URL}/dashboard`);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible({
      timeout: 15000,
    });

    smokeChecks.assertClean();
  });

  test('teacher dashboard route loads from hosted app with teacher-scoped UI', async ({
    page,
    browserName,
  }) => {
    test.skip(browserName !== 'chromium', 'hosted smoke is run against chromium');
    test.skip(Boolean(hostedAuthSmokeSkipReason), hostedAuthSmokeSkipReason);

    const smokeChecks = installHostedSmokeChecks(page);

    await login(page, TEST_TEACHER_EMAIL, TEST_TEACHER_PASSWORD, /\/dashboard/);

    await expect(page.getByRole('button', { name: '캘린더', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: '내 1:1 관리', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '내 단체반 관리', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '캘린더', level: 1 })).toBeVisible();
    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '1:1 예약 시간 관리', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '1:1 수업 관리', exact: true })).toHaveCount(0);

    await page.goto(`${BASE_URL}/dashboard`);
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(page.getByRole('button', { name: '캘린더', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('button', { name: '내 1:1 관리', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '내 단체반 관리', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: '단체반 관리', exact: true })).toHaveCount(0);

    smokeChecks.assertClean();
  });

  test('student booking route loads from hosted app', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'hosted smoke is run against chromium');
    test.skip(Boolean(hostedAuthSmokeSkipReason), hostedAuthSmokeSkipReason);

    const smokeChecks = installHostedSmokeChecks(page);

    await login(page, TEST_STUDENT_EMAIL, TEST_STUDENT_PASSWORD, /\/student-booking/);

    await expect(page.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(page.getByRole('heading', { name: '단체반 예약', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '1:1 수업 예약', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '내 단체반 예약', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '내 1:1 수업 예약', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: '내 수업 내역', exact: true })).toBeVisible();

    await page.goto(`${BASE_URL}/student-booking`);
    await expect(page).toHaveURL(/\/student-booking/);
    await expect(page.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });

    smokeChecks.assertClean();
  });
});
