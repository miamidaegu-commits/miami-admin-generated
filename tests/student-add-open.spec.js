import { test, expect } from '@playwright/test';
import { loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

test('학생 추가 모달 열기 테스트', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  await page.getByRole('button', { name: '학생 추가' }).click();

  await expect(page.getByRole('dialog', { name: '학생 추가' })).toBeVisible();
});
