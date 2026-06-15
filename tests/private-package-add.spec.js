import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
  selectTeacherOption,
} from './e2e-helpers.js';
import { cleanupTempStudentData, createTempStudent, createTempTeacher } from './e2e-firebase-helpers.js';
import {
  getAdminPrivateStudentByName,
  getAdminSeededPrivatePackagesForStudent,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

async function expectPrivatePackageCreated({ studentId, packageTitle, expected }) {
  await expect
    .poll(async () => {
      const packages = await getAdminSeededPrivatePackagesForStudent({ studentId });
      return packages
        .filter((pkg) => pkg.title === packageTitle)
        .map((pkg) => ({
          title: pkg.title,
          packageType: pkg.packageType,
          teacher: pkg.teacher,
          teacherKey: pkg.teacherKey,
          totalCount: Number(pkg.totalCount || 0),
          remainingCount: Number(pkg.remainingCount || 0),
          status: pkg.status,
          paymentDate: pkg.paymentDate || '',
        }));
    }, { timeout: 30000 })
    .toEqual([expect.objectContaining(expected)]);
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
  if (!(await dialog.isVisible({ timeout: 1000 }).catch(() => false))) return;
  const closeButton = dialog.getByRole('button', { name: buttonName }).first();
  if (await closeButton.isEnabled({ timeout: 1000 }).catch(() => false)) {
    await closeButton.click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await expect(dialog).toBeHidden({ timeout: 5000 }).catch(() => {});
}

async function ensurePackageDialogClosed(page, testInfo, packageDialog) {
  if (await packageDialog.isHidden({ timeout: 5000 }).catch(() => false)) return;
    await testInfo.attach('private-package-dialog-diagnostics', {
      body: JSON.stringify(await collectPackageDialogDiagnostics(page, packageDialog), null, 2),
      contentType: 'application/json',
    });
  await closeDialogBestEffort(page, packageDialog, /닫기|취소/);
}

async function dismissOptionalPrivateScheduleDialog(page) {
  const postScheduleDialog = page.getByRole('dialog', {
    name: '고정 1:1 수업 배정으로 이동할까요?',
  });
  if (!(await postScheduleDialog.isVisible({ timeout: 5000 }).catch(() => false))) return false;
  await postScheduleDialog.getByRole('button', { name: /나중에 (하기|등록)/ }).click();
  await expect(postScheduleDialog).toBeHidden({ timeout: 10000 });
  return true;
}

test('관리자가 기존 학생에게 개인 수강권을 추가한다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(120000);

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
    await ensurePackageDialogClosed(page, testInfo, packageDialog);
    await dismissOptionalPrivateScheduleDialog(page);
  } finally {
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
  test.setTimeout(120000);

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
    await expect
      .poll(async () => {
        const student = await getAdminPrivateStudentByName({ studentName });
        return student?.id || '';
      }, { timeout: 30000 })
      .not.toBe('');
    await closeDialogBestEffort(page, studentDialog, /닫기|취소/);

    const postCreateDialog = page.getByRole('dialog', { name: '학생을 등록했습니다' });
    if (await postCreateDialog.isVisible({ timeout: 5000 }).catch(() => false)) {
      await postCreateDialog.getByRole('button', { name: '개인 수강권 추가', exact: true }).click();
    } else {
      await getStudentSearchInput(page).fill(studentName);
      const createdStudentRow = getStudentRow(page, studentName);
      await expect(createdStudentRow).toBeVisible({ timeout: 15000 });
      await createdStudentRow.getByRole('button', { name: '수강권 추가' }).click();
    }

    const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await expect(packageDialog).toBeVisible();
    await packageDialog.getByLabel('수강권 유형').selectOption('private');
    await expect(packageDialog).toContainText('사용 가능 선생님: Don · don1');
    await packageDialog.getByRole('button', { name: '횟수 수강권' }).click();
    await packageDialog.getByLabel('제목').fill(packageTitle);
    await packageDialog.getByLabel(/총 횟수/).fill('4');
    await packageDialog.getByTestId('student-package-payment-date-input').fill(paymentDate);
    await packageDialog.getByRole('button', { name: '저장', exact: true }).click();

    expect(dialogMessages.join('\n')).not.toContain('현재 학원에 속하지 않습니다');
    await expect
      .poll(async () => {
        const student = await getAdminPrivateStudentByName({ studentName });
        return student?.id || '';
      }, { timeout: 30000 })
      .not.toBe('');
    const createdStudent = await getAdminPrivateStudentByName({ studentName });
    const studentId = createdStudent.id;
    await expectPrivatePackageCreated({
      studentId,
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
    await ensurePackageDialogClosed(page, testInfo, packageDialog);
    await dismissOptionalPrivateScheduleDialog(page);
  } finally {
    await cleanupTempStudentData(page, {
      studentName,
      allowStudentNameLookup: true,
      cleanupPackagesByStudent: true,
    });
  }
});
