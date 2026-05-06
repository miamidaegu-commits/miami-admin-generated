import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  TEST_STUDENT_NAME,
} from './fixtures/test-data.js';
import {
  createAdminSeededPrivateLesson,
  createAdminSeededPrivateStudent,
} from './e2e-admin-helpers.js';

function formatYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function openStudentPackageHistory(page) {
  await openDashboardSection(page, '학생 관리');

  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(TEST_STUDENT_NAME);

  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
  await expect(studentRow).toBeVisible();

  await studentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();

  const studentDetail = page
    .locator(
      `[data-testid="student-detail-panel"][data-student-name="${TEST_STUDENT_NAME}"]`
    )
    .first();
  await expect(studentDetail).toBeVisible();

  let historyButton = studentDetail.getByTestId('student-package-history-button').first();
  if ((await historyButton.count()) === 0) {
    const showAllButton = studentDetail.getByTestId('student-package-show-all-button');
    if ((await showAllButton.count()) > 0) {
      await showAllButton.click();
    }
    historyButton = studentDetail.getByTestId('student-package-history-button').first();
  }

  await expect(historyButton).toBeVisible();
  await historyButton.click();
}

test('관리자가 학생의 수강권 이력 모달을 열 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openStudentPackageHistory(page);

  const historyDialog = page.getByRole('dialog', { name: '수강권 이력' });
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.getByRole('heading', { name: '수강권 이력' })).toBeVisible();

  const historyRows = historyDialog.locator('text=메모:');
  const historyEmptyText = historyDialog.getByText('등록된 이력이 없습니다.', { exact: true });
  const historyMetaText = historyDialog.getByText('처리 역할:', { exact: false });

  await expect
    .poll(async () => {
      const rowCount = await historyRows.count();
      const hasEmptyText = await historyEmptyText.isVisible().catch(() => false);
      const hasMetaText = await historyMetaText.first().isVisible().catch(() => false);
      return rowCount > 0 || hasEmptyText || hasMetaText;
    })
    .toBe(true);
});

test('학생 관리 목록에 개인 수업 진행 요약이 표시된다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(TEST_STUDENT_NAME);

  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
  await expect(studentRow).toBeVisible();

  const progress = studentRow.getByTestId('student-private-lesson-progress');
  await expect(progress).toContainText('총 8회');
  await expect(progress).toContainText(/지난 \d+회/);
  await expect(progress).toContainText(/예정 \d+회/);
});

test('수강권 문서가 없어도 학생 관리 목록에 개인 수업 진행 요약이 표시된다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const suffix = Date.now();
  const teacher = `E2E Progress Teacher ${suffix}`;
  const { studentId, studentName } = await createAdminSeededPrivateStudent({
    studentId: `e2e-private-progress-student-${suffix}`,
    name: `E2E 개인진행 ${suffix}`,
    teacher,
    paidLessons: 8,
    attendanceCount: 0,
  });

  const today = new Date();
  const lessonDates = [
    formatYmd(addDays(today, -14)),
    formatYmd(addDays(today, -7)),
    formatYmd(addDays(today, 1)),
    formatYmd(addDays(today, 2)),
    formatYmd(addDays(today, 3)),
    formatYmd(addDays(today, 4)),
    formatYmd(addDays(today, 5)),
    formatYmd(addDays(today, 6)),
  ];

  await Promise.all(
    lessonDates.map((date, index) =>
      createAdminSeededPrivateLesson({
        lessonId: `e2e-private-progress-lesson-${suffix}-${index + 1}`,
        studentId,
        studentID: studentId,
        studentName,
        student: studentName,
        teacher,
        teacherName: teacher,
        date,
        time: '10:00',
        subject: `E2E 개인진행 ${index + 1}`,
        sessionNumber: index + 1,
      })
    )
  );

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(studentName);

  const studentRow = getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible();

  const privatePackageCell = studentRow.getByTestId('student-private-package-cell');
  await expect(privatePackageCell).toContainText('총 8회');
  await expect(privatePackageCell).toContainText('지난 2회');
  await expect(privatePackageCell).toContainText('예정 6회');
  await expect(privatePackageCell).not.toContainText('수강권 없음');
});
