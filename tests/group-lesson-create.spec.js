import { test, expect } from '@playwright/test';
import {
  getGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';

// group-schedule-create.spec.js와 역할이 겹치고, 더 안정적인 범위 기반 검증으로 대체되었습니다.
const ADMIN_EMAIL = 'test-admin@miami.com';
const ADMIN_PASSWORD = '12345678';
const TEST_GROUP_NAME = '고급영어회화';
const YMD_REGEX_SOURCE = '\\b\\d{4}-\\d{2}-\\d{2}\\b';

test('관리자가 특정 그룹의 미래 수업 일정을 확인한다', async ({ page, browserName }) => {
  test.skip(true, 'group-schedule-create.spec.js로 대체된 중복 테스트입니다.');
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '반 관리');

  // 취약한 selector: 그룹 row에 안정적인 식별자가 없어 class+텍스트 조합을 사용합니다.
  // 가능하면 `data-testid="group-row"`를 넣고 이름은 별도 data attribute로 노출하세요.
  const groupRow = getGroupRow(page, TEST_GROUP_NAME);
  await expect(groupRow).toBeVisible();
  await groupRow.click();

  await expect(getRegisteredStudentsHeading(page, TEST_GROUP_NAME)).toBeVisible();
  await expect(page.getByRole('heading', { name: '수업 일정' })).toBeVisible();

  // 취약한 selector: heading 부모를 타고 섹션 컨테이너를 찾습니다.
  // 가능하면 `data-testid="group-lessons-section"`로 치환하세요.
  const lessonSection = page
    .getByRole('heading', { name: '수업 일정' })
    .locator('..')
    .locator('..');

  // 취약한 selector: 일정 row도 table class 구조에 의존합니다.
  // 가능하면 `data-testid="group-lesson-row"`를 추가하세요.
  const lessonRows = lessonSection.locator('.table-row');
  await expect(lessonRows.first()).toBeVisible();

  const today = await page.evaluate(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  });

  const lessonDates = await lessonRows.evaluateAll((rows, regexSource) => {
    const regex = new RegExp(regexSource, 'g');

    return rows.flatMap((row) => {
      const text = row.textContent || '';
      return text.match(regex) || [];
    });
  }, YMD_REGEX_SOURCE);
  const futureLessonDates = lessonDates.filter((value) => value > today);

  expect(futureLessonDates.length).toBeGreaterThan(0);
});
