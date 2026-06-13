import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
  selectTeacherOption,
} from './e2e-helpers.js';
import { cleanupTempStudentData, createTempStudent, createTempTeacher } from './e2e-firebase-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

test('관리자가 기존 학생에게 개인 수강권을 추가한다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const uniqueToken = Date.now();
  const packageTitle = `E2E 개인 수강권 ${uniqueToken}`;
  const tempStudentName = `E2E 개인학생 ${uniqueToken}`;
  const paymentDate = '2026-06-03';
  let tempStudent = null;

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    tempStudent = await createTempStudent(page, {
      studentName: tempStudentName,
      teacherName: 'don1',
      note: 'E2E temporary student for private package add test',
    });
    await openDashboardSection(page, '학생 관리');

    const studentSearchInput = getStudentSearchInput(page);
    await studentSearchInput.fill(tempStudentName);

    const studentRow = getStudentRow(page, tempStudentName);
    await expect(studentRow).toBeVisible();

    await studentRow.getByRole('button', { name: '수강권 추가' }).click();

    const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await expect(packageDialog).toBeVisible();

    await packageDialog.getByLabel('수강권 유형').selectOption('private');
    await expect(packageDialog.getByTestId('student-package-start-date-input')).toBeVisible();
    await expect(packageDialog.getByTestId('student-package-payment-date-input')).toBeVisible();
    await expect(packageDialog).toContainText('결제일은 실제 결제한 날짜입니다');
    await expect(packageDialog).toContainText('개인 수강권은 선택한 선생님 수업에만 사용할 수 있습니다');
    await packageDialog.getByRole('button', { name: '횟수 수강권' }).click();
    await packageDialog.getByLabel('제목').fill(packageTitle);
    await packageDialog.getByLabel(/총 횟수/).fill('8');
    await packageDialog.getByTestId('student-package-payment-date-input').fill(paymentDate);

    await packageDialog.getByRole('button', { name: '저장' }).click();
    await expect(packageDialog).toBeHidden();

    const postScheduleDialog = page.getByRole('dialog', {
      name: '고정 1:1 수업 배정으로 이동할까요?',
    });
    await expect(postScheduleDialog).toBeVisible();
    await expect(postScheduleDialog).toContainText(tempStudentName);
    await expect(postScheduleDialog).toContainText(packageTitle);
    await expect(postScheduleDialog).toContainText('고정 수업 일정은 1:1 예약 시간 관리');

    await postScheduleDialog.getByRole('button', { name: '나중에 하기' }).click();
    await expect(postScheduleDialog).toBeHidden();

    const studentRowAfterSave = getStudentRow(page, tempStudentName);
    await studentRowAfterSave.getByRole('button', { name: '수강권 보기', exact: true }).click();
    const studentDetail = page
      .locator(`[data-testid="student-detail-panel"][data-student-name="${tempStudentName}"]`)
      .first();
    await expect(studentDetail).toBeVisible();
    const packageCard = studentDetail
      .getByTestId('student-package-card')
      .filter({ hasText: packageTitle })
      .first();
    await expect(packageCard).toBeVisible();
    await expect(packageCard).toContainText('결제일');
    await expect(packageCard).toContainText(paymentDate);
    await expect(packageCard).toContainText('수강권 시작일');
    await expect(packageCard).toContainText('사용 가능 선생님');
    await expect(packageCard).toContainText('don1');

    await packageCard.getByTestId('student-package-history-button').click();
    const historyDialog = page.getByRole('dialog', { name: '수강권 이력' });
    await expect(historyDialog).toBeVisible();
    await expect(historyDialog).toContainText('등록일');
    await expect(historyDialog).toContainText('결제일');
    await expect(historyDialog).toContainText(paymentDate);
    await expect(historyDialog).toContainText('수강권 시작일');
    await expect(historyDialog).toContainText('사용 가능 선생님');
    await historyDialog.getByRole('button', { name: '닫기', exact: true }).click();
    await expect(historyDialog).toBeHidden();
  } finally {
    if (tempStudent) {
      await cleanupTempStudentData(page, tempStudent);
    }
  }
});

test('관리자가 새 학생 등록 직후 개인 수강권을 추가한다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const uniqueToken = Date.now();
  const studentName = `E2E 즉시수강권 학생 ${uniqueToken}`;
  const packageTitle = `E2E 즉시 개인 수강권 ${uniqueToken}`;
  const paymentDate = '2026-06-03';
  const dialogMessages = [];

  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await createTempTeacher(page, {
      teacherId: 'e2e-package-handoff-don1',
      teacherName: 'Don',
      teacherKey: 'don1',
      teacherUid: 'e2e-package-handoff-don1-uid',
      teacherEmail: 'e2e-package-handoff-don1@example.com',
    });

    await openDashboardSection(page, '학생 관리');
    await page.getByRole('button', { name: '학생 추가', exact: true }).click();

    const studentDialog = page.getByRole('dialog', { name: '학생 추가' });
    await expect(studentDialog).toBeVisible();
    await studentDialog.getByLabel('이름').fill(studentName);
    await selectTeacherOption(studentDialog.getByLabel('담당 선생님'), 'Don', {
      timeout: 30000,
    });
    await studentDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(studentDialog).toBeHidden();

    const postCreateDialog = page.getByRole('dialog', { name: '학생을 등록했습니다' });
    await expect(postCreateDialog).toBeVisible();
    await postCreateDialog.getByRole('button', { name: '개인 수강권 추가', exact: true }).click();

    const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await expect(packageDialog).toBeVisible();
    await packageDialog.getByLabel('수강권 유형').selectOption('private');
    await expect(packageDialog).toContainText('사용 가능 선생님: Don · don1');
    await packageDialog.getByRole('button', { name: '횟수 수강권' }).click();
    await packageDialog.getByLabel('제목').fill(packageTitle);
    await packageDialog.getByLabel(/총 횟수/).fill('4');
    await packageDialog.getByTestId('student-package-payment-date-input').fill(paymentDate);
    await packageDialog.getByRole('button', { name: '저장', exact: true }).click();
    await expect(packageDialog).toBeHidden();

    expect(dialogMessages.join('\n')).not.toContain('현재 학원에 속하지 않습니다');

    const postScheduleDialog = page.getByRole('dialog', {
      name: '고정 1:1 수업 배정으로 이동할까요?',
    });
    await expect(postScheduleDialog).toBeVisible();
    await postScheduleDialog.getByRole('button', { name: '나중에 하기', exact: true }).click();

    await getStudentSearchInput(page).fill(studentName);
    const studentRow = getStudentRow(page, studentName);
    await expect(studentRow).toBeVisible();
    const privatePackageCell = studentRow.getByTestId('student-private-package-cell');
    await expect(privatePackageCell).toContainText('Don 수강권', { timeout: 15000 });
  } finally {
    await cleanupTempStudentData(page, { studentName });
  }
});
