import { test, expect } from '@playwright/test';
import {
  clickStudentRowButtonByIdOrName,
  fillVisibleField,
  getStudentRowByIdOrName,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import { cleanupTempStudentData } from './e2e-firebase-helpers.js';
import {
  cleanupAdminPrivatePackageE2EFixtures,
  createAdminSeededTeacher,
  createAdminSeededPrivateStudent,
  cleanupAdminSeededTeacher,
  getAdminSeededPrivatePackagesForStudent,
  hasE2EAdminServiceAccount,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

const PRIVATE_PACKAGE_ADD_PREFIXES = [
  'E2E 개인학생',
  'E2E 개인 수강권',
  'E2E 즉시수강권',
  'E2E 즉시 개인 수강권',
  'e2e-private-package-add-',
  'e2e-private-package-handoff-',
  'e2e-immediate-package-student-',
];

async function cleanupPrivatePackageAddFixtures() {
  await cleanupAdminPrivatePackageE2EFixtures({ prefixes: PRIVATE_PACKAGE_ADD_PREFIXES });
}

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasE2EAdminServiceAccount(), 'serviceAccountKey.json이 있을 때만 실행합니다.');
  await cleanupPrivatePackageAddFixtures();
});

test.afterEach(async () => {
  if (!hasE2EAdminServiceAccount()) return;
  await cleanupPrivatePackageAddFixtures().catch(() => {});
});

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
  if (!(await dialog.isVisible({ timeout: 1000 }).catch(() => false))) return;
  const closeButton = dialog.getByRole('button', { name: buttonName }).first();
  if (await closeButton.isEnabled({ timeout: 1000 }).catch(() => false)) {
    await closeButton.click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
}

async function ensurePackageDialogClosed(page, testInfo, packageDialog) {
  if (!packageDialog) return;
  if (await packageDialog.isHidden({ timeout: 5000 }).catch(() => false)) return;
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
  if (!(await postScheduleDialog.isVisible({ timeout: 2000 }).catch(() => false))) return false;
  await postScheduleDialog.getByRole('button', { name: /나중에 (하기|등록)/ }).click().catch(() => {});
  return true;
}

async function cleanupPrivatePackageDialogs(page, testInfo, packageDialog) {
  await dismissOptionalPrivateScheduleDialog(page).catch(() => false);
  await ensurePackageDialogClosed(page, testInfo, packageDialog).catch(() => {});
  await dismissOptionalPrivateScheduleDialog(page).catch(() => false);
}

test('관리자가 기존 학생에게 개인 수강권을 추가한다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(180000);

  const uniqueToken = Date.now();
  const packageTitle = `E2E 개인 수강권 ${uniqueToken}`;
  const tempStudentName = `E2E 개인학생 ${uniqueToken}`;
  const teacherId = `e2e-private-package-add-teacher-${uniqueToken}`;
  const teacherKey = `e2e-private-package-add-teacher-${uniqueToken}`;
  const teacherName = `E2E 개인학생 선생 ${uniqueToken}`;
  const paymentDate = '2026-06-03';
  let tempStudent = null;
  let packageDialog = null;

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  try {
    await createAdminSeededTeacher({
      teacherId,
      teacherName,
      teacherKey,
      teacherUid: `${teacherId}-uid`,
      teacherEmail: `${teacherId}@example.com`,
    });
    tempStudent = await createAdminSeededPrivateStudent({
      studentId: `e2e-private-package-add-student-${uniqueToken}`,
      name: tempStudentName,
      studentName: tempStudentName,
      teacher: teacherKey,
      teacherName,
      note: 'E2E temporary student for private package add test',
    });
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '학생 관리');

    const studentSearchInput = getStudentSearchInput(page);
    await studentSearchInput.fill(tempStudentName);

    const studentRow = getStudentRowByIdOrName(page, tempStudent.studentId, tempStudentName);
    await expect(studentRow).toBeVisible({ timeout: 15000 });

    packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await clickStudentRowButtonByIdOrName(page, {
      studentId: tempStudent.studentId,
      studentName: tempStudentName,
      buttonName: '수강권 추가',
      onAfterClick: () => packageDialog.isVisible({ timeout: 3000 }).catch(() => false),
    });
    await expect(packageDialog).toBeVisible();

    await packageDialog.getByLabel('수강권 유형').selectOption('private');
    await expect(packageDialog.getByTestId('student-package-start-date-input')).toBeVisible();
    await expect(packageDialog.getByTestId('student-package-payment-date-input')).toBeVisible();
    await expect(packageDialog).toContainText('결제일은 실제 결제한 날짜입니다');
    await expect(packageDialog).toContainText('개인 수강권은 선택한 선생님 수업에만 사용할 수 있습니다');
    await packageDialog.getByRole('button', { name: '횟수 수강권' }).click();
    await fillVisibleField(packageDialog.getByLabel('제목'), packageTitle);
    await fillVisibleField(packageDialog.getByLabel(/총 횟수/), '8');
    await fillVisibleField(packageDialog.getByTestId('student-package-payment-date-input'), paymentDate);

    await packageDialog.getByRole('button', { name: '저장' }).click();
    await expectPrivatePackageCreated({
      studentId: tempStudent.studentId,
      packageTitle,
      expected: {
        packageType: 'private',
        teacherKey,
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
    await cleanupAdminSeededTeacher({ teacherId }).catch(() => {});
  }
});

test('관리자가 새 학생 등록 직후 개인 수강권을 추가한다', async ({ page, browserName }, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(180000);

  const uniqueToken = Date.now();
  const studentName = `E2E 즉시수강권 학생 ${uniqueToken}`;
  const packageTitle = `E2E 즉시 개인 수강권 ${uniqueToken}`;
  const paymentDate = '2026-06-03';
  const dialogMessages = [];
  let createdStudentId = '';
  const teacherId = `e2e-private-package-handoff-teacher-${uniqueToken}`;
  const teacherKey = `e2e-private-package-handoff-teacher-${uniqueToken}`;
  const teacherName = `E2E 즉시수강권 선생 ${uniqueToken}`;
  let packageDialog = null;

  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  try {
    await createAdminSeededTeacher({
      teacherId,
      teacherName,
      teacherKey,
      teacherUid: `${teacherId}-uid`,
      teacherEmail: `${teacherId}@example.com`,
    });

    const seededStudent = await createAdminSeededPrivateStudent({
      studentId: `e2e-immediate-package-student-${uniqueToken}`,
      name: studentName,
      studentName,
      teacher: teacherKey,
      teacherName,
      note: 'E2E immediate private package add test',
    });
    createdStudentId = seededStudent.studentId;

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '학생 관리');
    await getStudentSearchInput(page).fill(studentName);
    const createdStudentRow = getStudentRowByIdOrName(page, seededStudent.studentId, studentName);
    await expect(createdStudentRow).toBeVisible({ timeout: 15000 });
    packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await clickStudentRowButtonByIdOrName(page, {
      studentId: seededStudent.studentId,
      studentName,
      buttonName: '수강권 추가',
      onAfterClick: () => packageDialog.isVisible({ timeout: 3000 }).catch(() => false),
    });
    await expect(packageDialog).toBeVisible();
    await packageDialog.getByLabel('수강권 유형').selectOption('private');
    await expect(packageDialog).toContainText('사용 가능 선생님:');
    await expect(packageDialog).toContainText(teacherKey);
    await packageDialog.getByRole('button', { name: '횟수 수강권' }).click();
    await fillVisibleField(packageDialog.getByLabel('제목'), packageTitle);
    await fillVisibleField(packageDialog.getByLabel(/총 횟수/), '4');
    await fillVisibleField(packageDialog.getByTestId('student-package-payment-date-input'), paymentDate);
    await packageDialog.getByRole('button', { name: '저장', exact: true }).click();

    expect(dialogMessages.join('\n')).not.toContain('현재 학원에 속하지 않습니다');
    await expectPrivatePackageCreated({
      studentId: createdStudentId,
      packageTitle,
      expected: {
        packageType: 'private',
        teacherKey,
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
