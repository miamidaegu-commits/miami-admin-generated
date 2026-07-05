import { test, expect } from '@playwright/test';
import {
  clickGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from './fixtures/test-data.js';
import {
  cleanupAdminSeededTempCalendarGroupLessonSetup,
  cleanupAdminSeededTempGroupAttendanceSetup,
  createAdminSeededCalendarGroupLessonSetup,
  createAdminSeededPrivateStudent,
  createAdminSeededTempGroupAttendanceSetup,
  getAdminGroupStudentById,
} from './e2e-admin-helpers.js';

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

test('관리자가 그룹 학생 관리 모달에서 제외 날짜를 저장하고 다시 원복할 수 있다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const excludedDate = formatYmd(addDays(new Date(), 920));
  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const groupName = `E2E 학생관리반 ${unique}`;
  const studentName = `E2E 학생관리 ${unique}`;
  const groupClassId = `e2e-group-student-manage-class-${unique}`;
  const groupLessonId = `e2e-group-student-manage-lesson-${unique}`;
  const studentId = `e2e-group-student-manage-student-${unique}`;
  const packageId = `e2e-group-student-manage-package-${unique}`;
  const groupStudentId = `e2e-group-student-manage-row-${unique}`;
  let groupSetup = null;
  let groupStudentSetup = null;

  try {
    await createAdminSeededPrivateStudent({
      studentId,
      studentName,
      name: studentName,
      note: 'E2E temporary student for group student manage test',
    });
    groupSetup = await createAdminSeededCalendarGroupLessonSetup({
      groupClassId,
      groupLessonId,
      groupName,
      teacherName: 'teacher',
      lessonDate: formatYmd(addDays(new Date(), 14)),
      lessonTime: '20:20',
      lessonSubject: `E2E 학생관리 수업 ${unique}`,
    });
    groupStudentSetup = await createAdminSeededTempGroupAttendanceSetup({
      groupClassId,
      groupName,
      studentId,
      studentName,
      lessonDate: formatYmd(addDays(new Date(), 14)),
      tempPackageTitle: `E2E 학생관리 수강권 ${unique}`,
      packageId,
      groupStudentId,
      totalCount: 8,
    });

    await expect
      .poll(async () => {
        const groupStudent = await getAdminGroupStudentById({ groupStudentId });
        return {
          exists: Boolean(groupStudent),
          studentId: groupStudent?.studentId || '',
          groupClassId: groupStudent?.groupClassId || '',
        };
      }, { timeout: 20000 })
      .toEqual({
        exists: true,
        studentId,
        groupClassId,
      });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');

    await clickGroupRow(page, groupName);

    await expect(getRegisteredStudentsHeading(page, groupName)).toBeVisible();

    const groupStudentsSection = page.getByTestId('group-students-section');
    await expect(groupStudentsSection).toBeVisible();

    const studentRow = groupStudentsSection.locator(
      `[data-testid="group-student-row"][data-student-name="${studentName}"]`
    ).first();
    await expect(studentRow).toBeVisible({ timeout: 15000 });

    const manageButton = studentRow.getByRole('button', { name: '관리', exact: true });
    await expect(manageButton).toBeVisible();

    async function openManageDialog() {
      await expect(manageButton).toBeEnabled({ timeout: 15000 });
      await manageButton.dispatchEvent('click');
      const dialog = page.getByRole('dialog', { name: '그룹 학생 관리' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(studentName);
      return dialog;
    }

    async function saveManageDialog(dialog, expectedExcludedDates) {
    const saveButton = dialog.getByRole('button', { name: '저장', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();
      await expect
        .poll(async () => {
          const groupStudent = await getAdminGroupStudentById({ groupStudentId });
          return Array.isArray(groupStudent?.excludedDates) ? groupStudent.excludedDates : [];
        }, { timeout: 15000 })
        .toEqual(expectedExcludedDates);
      await expect(dialog).toBeHidden({ timeout: 15000 });
    }

    async function closeDialogBestEffort(dialog) {
      if (!(await dialog.isVisible().catch(() => false))) return;
      const cancelButton = dialog.getByRole('button', { name: '취소', exact: true });
      if (await cancelButton.isEnabled({ timeout: 1000 }).catch(() => false)) {
        await cancelButton.click({ timeout: 5000 }).catch(() => {});
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      await expect(dialog).toBeHidden({ timeout: 5000 }).catch(() => {});
    }

    async function ensureDateRemovedIfPresent() {
    const dialog = await openManageDialog();
    const dateItem = dialog.locator(
      `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
    ).first();
    if ((await dateItem.count()) > 0) {
      await dateItem.getByRole('button', { name: '삭제', exact: true }).click();
        await saveManageDialog(dialog, []);
      return;
    }
      await closeDialogBestEffort(dialog);
    }

    let dateAdded = false;

    await ensureDateRemovedIfPresent();

    const addDialog = await openManageDialog();
    const excludeDateInput = addDialog.getByTestId('group-student-exclude-date-input');
    await expect(excludeDateInput).toBeVisible();
    await excludeDateInput.fill(excludedDate);
    await addDialog.getByRole('button', { name: '날짜 추가', exact: true }).click();
    await expect(
      addDialog.locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      ).first()
    ).toBeVisible();
    await saveManageDialog(addDialog, [excludedDate]);

    dateAdded = true;

    const verifyAddedDialog = await openManageDialog();
    await expect(
      verifyAddedDialog.locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      ).first()
    ).toBeVisible();

    await verifyAddedDialog
      .locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      )
      .first()
      .getByRole('button', { name: '삭제', exact: true })
      .click();
    await saveManageDialog(verifyAddedDialog, []);

    dateAdded = false;

    const verifyRemovedDialog = await openManageDialog();
    await expect(
      verifyRemovedDialog.locator(
        `[data-testid="group-student-excluded-date-item"][data-date="${excludedDate}"]`
      ).first()
    ).toHaveCount(0);
    await expect(
      verifyRemovedDialog.getByText('등록된 제외일이 없습니다.', { exact: true })
    ).toBeVisible();
    await closeDialogBestEffort(verifyRemovedDialog);

    if (dateAdded) {
      await ensureDateRemovedIfPresent();
    }
  } finally {
    await cleanupAdminSeededTempGroupAttendanceSetup({
      ...(groupStudentSetup || {}),
      groupClassId,
      groupLessonId,
      strictLessonIdsOnly: true,
    }).catch(() => {});

    await cleanupAdminSeededTempCalendarGroupLessonSetup({
      ...(groupSetup || {}),
      strictLessonIdsOnly: true,
    }).catch(() => {});
  }
});
