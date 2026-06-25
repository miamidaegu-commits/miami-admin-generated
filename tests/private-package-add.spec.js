import { test, expect } from '@playwright/test';
import {
  getStudentRowById,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import { cleanupTempStudentData, createTempStudent } from './e2e-firebase-helpers.js';
import {
  createAdminSeededTeacher,
  createAdminSeededPrivateStudent,
  cleanupAdminSeededTeacher,
  getAdminSeededPrivatePackagesForStudent,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

async function expectPrivatePackageCreated({ studentId, packageTitle, expected }) {
  await expect
    .poll(async () => {
      const packages = await getAdminSeededPrivatePackagesForStudent({ studentId });
      const pkg = packages.find((row) => row.title === packageTitle) || null;
      return {
        title: String(pkg?.title || ''),
        packageType: String(pkg?.packageType || ''),
        teacher: String(pkg?.teacher || ''),
        teacherKey: String(pkg?.teacherKey || ''),
        totalCount: Number(pkg?.totalCount || 0),
        remainingCount: Number(pkg?.remainingCount || 0),
        status: String(pkg?.status || ''),
        paymentDate: String(pkg?.paymentDate || ''),
      };
    }, { timeout: 60000 })
    .toEqual(expect.objectContaining({
      ...expected,
    }));
}

async function collectPackageDialogDiagnostics(page, packageDialog) {
  const [visible, text, saveDisabled, bodyText] = await Promise.all([
    packageDialog.isVisible().catch(() => false),
    packageDialog.innerText({ timeout: 1000 }).catch(() => ''),
    packageDialog
      .getByRole('button', { name: '저장', exact: true })
      .isDisabled({ timeout: 1000 })
      .catch(() => null),
    page.locator('body').innerText({ timeout: 1000 }).catch(() => ''),
  ]);
  return {
    currentUrl: page.url(),
    packageDialogVisible: visible,
    packageDialogText: String(text || '').slice(0, 2500),
    saveDisabled,
    bodyText: String(bodyText || '').slice(0, 3000),
  };
}

async function closeDialogBestEffort(page, dialog, buttonName = /닫기|취소|나중에/) {
  if (!(await dialog.isVisible({ timeout: 500 }).catch(() => false))) return;
  if (await clickButtonByTextBestEffort(page, ['닫기', '취소', '나중에'])) return;
  const closeButton = dialog.getByRole('button', { name: buttonName }).first();
  if (await closeButton.isVisible({ timeout: 500 }).catch(() => false)) {
    await clickBestEffort(closeButton);
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function clickVisibleEnabled(locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible({ timeout: 10000 });
  await expect(locator).toBeEnabled({ timeout: 10000 });
  await locator.click({ timeout: 10000 }).catch(async (error) => {
    await locator.scrollIntoViewIfNeeded().catch(() => {});
    await locator.click({ timeout: 5000, force: true }).catch(() => {
      throw error;
    });
  });
}

async function clickBestEffort(locator) {
  await locator.scrollIntoViewIfNeeded({ timeout: 500 }).catch(() => {});
  await locator.click({ timeout: 1500 }).catch(async () => {
    await locator.click({ timeout: 1500, force: true }).catch(() => {});
  });
}

async function clickButtonByTextBestEffort(page, labels) {
  return page.evaluate((buttonLabels) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    const target = buttons.find((button) => {
      const text = String(button.textContent || '').trim();
      return buttonLabels.some((label) => text.includes(label));
    });
    if (!target) return false;
    target.click();
    return true;
  }, labels).catch(() => false);
}

async function ensurePackageDialogClosed(page, testInfo, packageDialog) {
  if (!packageDialog) return;
  if (await packageDialog.isHidden({ timeout: 500 }).catch(() => false)) return;
  await testInfo.attach('private-package-dialog-diagnostics', {
    body: JSON.stringify(await collectPackageDialogDiagnostics(page, packageDialog), null, 2),
    contentType: 'application/json',
  });
  await closeDialogBestEffort(page, packageDialog, /닫기|취소/);
}

async function dismissOptionalPrivateScheduleDialog(page) {
  const postScheduleDialog = page.getByRole('dialog', {
    name: '주간 시간에 학생 고정 배정으로 이동할까요?',
  });
  if (!(await postScheduleDialog.isVisible({ timeout: 500 }).catch(() => false))) return false;
  if (await clickButtonByTextBestEffort(page, ['나중에 하기', '나중에 등록', '나중에'])) {
    return true;
  }
  const laterButton = postScheduleDialog.getByRole('button', { name: /나중에 (하기|등록)/ });
  await clickBestEffort(laterButton);
  return true;
}

async function cleanupPrivatePackageDialogs(page, testInfo, packageDialog) {
  await dismissOptionalPrivateScheduleDialog(page).catch(() => false);
  await ensurePackageDialogClosed(page, testInfo, packageDialog).catch(() => {});
  await dismissOptionalPrivateScheduleDialog(page).catch(() => false);
}

test('관리자가 기존 학생에게 개인 수강권을 추가한다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(240000);

  const uniqueToken = Date.now();
  const packageTitle = `E2E 개인 수강권 ${uniqueToken}`;
  const tempStudentName = `E2E 개인학생 ${uniqueToken}`;
  const paymentDate = '2026-06-03';
  let tempStudent = null;
  let packageDialog = null;

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

    const studentRow = getStudentRowById(page, tempStudent.studentId);
    await expect(studentRow).toBeVisible({ timeout: 15000 });

    await studentRow.getByRole('button', { name: '수강권 추가' }).click();

    packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
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

    const saveButton = packageDialog.getByRole('button', { name: '저장', exact: true });
    await clickVisibleEnabled(saveButton);
    await expectPrivatePackageCreated({
      studentId: tempStudent.studentId,
      packageTitle,
      expected: {
        packageType: 'private',
        teacherKey: 'don1',
        totalCount: 8,
        remainingCount: 8,
        status: 'active',
        paymentDate,
      },
    });
  } finally {
    await cleanupPrivatePackageDialogs(page, testInfo, packageDialog);
    if (tempStudent) {
      await cleanupTempStudentData(page, {
        ...tempStudent,
        cleanupPackagesByStudent: true,
      });
    }
  }
});

test('관리자가 새 학생 등록 직후 개인 수강권을 추가한다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(240000);

  const uniqueToken = Date.now();
  const studentName = `E2E 즉시수강권 학생 ${uniqueToken}`;
  const packageTitle = `E2E 즉시 개인 수강권 ${uniqueToken}`;
  const paymentDate = '2026-06-03';
  const dialogMessages = [];
  let createdStudentId = '';
  const teacherId = 'e2e-package-handoff-don1';
  let packageDialog = null;

  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await createAdminSeededTeacher({
      teacherId,
      teacherName: 'Don',
      teacherKey: 'don1',
      teacherUid: 'e2e-package-handoff-don1-uid',
      teacherEmail: 'e2e-package-handoff-don1@example.com',
    });

    const seededStudent = await createAdminSeededPrivateStudent({
      studentId: `e2e-immediate-package-student-${uniqueToken}`,
      name: studentName,
      studentName,
      teacher: 'don1',
      teacherName: 'Don',
      note: 'E2E immediate private package add test',
    });
    createdStudentId = seededStudent.studentId;

    await openDashboardSection(page, '학생 관리');
    await getStudentSearchInput(page).fill(studentName);
    const createdStudentRow = getStudentRowById(page, seededStudent.studentId);
    await expect(createdStudentRow).toBeVisible({ timeout: 15000 });
    await createdStudentRow.getByRole('button', { name: '수강권 추가' }).click();

    packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await expect(packageDialog).toBeVisible();
    await packageDialog.getByLabel('수강권 유형').selectOption('private');
    await expect(packageDialog).toContainText('사용 가능 선생님: Don · don1');
    await packageDialog.getByRole('button', { name: '횟수 수강권' }).click();
    await packageDialog.getByLabel('제목').fill(packageTitle);
    await packageDialog.getByLabel(/총 횟수/).fill('4');
    await packageDialog.getByTestId('student-package-payment-date-input').fill(paymentDate);
    const saveButton = packageDialog.getByRole('button', { name: '저장', exact: true });
    await clickVisibleEnabled(saveButton);

    expect(dialogMessages.join('\n')).not.toContain('현재 학원에 속하지 않습니다');
    await expectPrivatePackageCreated({
      studentId: createdStudentId,
      packageTitle,
      expected: {
        packageType: 'private',
        teacherKey: 'don1',
        totalCount: 4,
        remainingCount: 4,
        status: 'active',
        paymentDate,
      },
    });
  } finally {
    await cleanupPrivatePackageDialogs(page, testInfo, packageDialog);
    await cleanupTempStudentData(page, {
      studentId: createdStudentId,
      studentName,
      cleanupPackagesByStudent: true,
    });
    await cleanupAdminSeededTeacher({ teacherId }).catch(() => {});
  }
});
