import { test, expect } from '@playwright/test';
import { getStudentRow, getStudentSearchInput, loginAsAdmin, openDashboardSection } from './e2e-helpers.js';
import {
  cleanupTempStudentData,
  createTempStudent,
  getGroupPackageStartDate,
} from './e2e-firebase-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from './fixtures/test-data.js';
import {
  cleanupAdminSeededCalendarGroupLessonSetup,
  createAdminSeededCalendarGroupLessonSetup,
} from './e2e-admin-helpers.js';

test.setTimeout(90000);

function futureYmd(daysAhead = 14) {
  const date = new Date();
  date.setDate(date.getDate() + daysAhead);
  return date.toISOString().slice(0, 10);
}

test('관리자가 반 등록 단체반 수강권 발급 시 학생이 자동으로 반에 등록된다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  const uniqueToken = Date.now();
  const tempStudentName = `E2E 그룹수강권 ${uniqueToken}`;
  const groupName = `E2E 그룹수강권반 ${uniqueToken}`;
  let tempStudent = null;
  let groupSetup = null;

  try {
    groupSetup = await createAdminSeededCalendarGroupLessonSetup({
      groupClassId: `e2e-group-package-add-class-${uniqueToken}`,
      groupLessonId: `e2e-group-package-add-lesson-${uniqueToken}`,
      groupName,
      teacherName: 'teacher',
      lessonDate: futureYmd(14),
      lessonTime: '21:10',
      lessonSubject: `E2E 그룹수강권 수업 ${uniqueToken}`,
      weekdays: [1],
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    tempStudent = await createTempStudent(page, {
      studentName: tempStudentName,
      note: 'E2E temporary student for group package add test',
    });
    await openDashboardSection(page, '학생 관리');

    const studentSearchInput = getStudentSearchInput(page);
    await studentSearchInput.fill(tempStudentName);

    const studentRow = getStudentRow(page, tempStudentName);
    await expect(studentRow).toBeVisible();
    await studentRow.getByRole('button', { name: '수강권 추가' }).click();

    const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await expect(packageDialog).toBeVisible();

    await packageDialog.getByLabel('수강권 유형').selectOption('group');

    const groupSelect = packageDialog.getByLabel('등록할 반 선택');
    const getFixtureGroupValue = () =>
      groupSelect.locator('option').evaluateAll((options, { groupClassId, groupName }) => {
          const exactValue = options.find((option) => option.getAttribute('value') === groupClassId);
          if (exactValue) return exactValue.getAttribute('value') || '';
          const matched = options.find((option) =>
            option.textContent?.includes(String(groupName))
          );
          return matched?.getAttribute('value') || '';
        }, { groupClassId: groupSetup.groupClassId, groupName });
    await expect.poll(getFixtureGroupValue, { timeout: 15000 }).not.toBe('');
    const groupValue = await getFixtureGroupValue();

    await groupSelect.selectOption(groupValue);

    const startDateInput = packageDialog.getByTestId('student-package-start-date-input');
    await startDateInput.fill(await getGroupPackageStartDate(page, {
      groupClassId: groupSetup.groupClassId,
      groupName,
    }));
    await packageDialog.getByLabel('등록 주수').fill('4');

    await packageDialog.getByRole('button', { name: '저장' }).click();
    await expect(packageDialog).toBeHidden({ timeout: 30000 });
    await expect(
      page.getByRole('dialog', { name: '이 반에 바로 등록할까요?' })
    ).toHaveCount(0);

    await openDashboardSection(page, '단체반 관리');
    await page.getByRole('row', { name: new RegExp(groupName) }).click();
    const enrolledStudentsSection = page.getByTestId('group-students-section');
    await expect(
      enrolledStudentsSection.locator(
        `[data-testid="group-student-row"][data-student-name="${tempStudentName}"]`
      ).first()
    ).toBeVisible({ timeout: 15000 });

    expect(
      dialogMessages.every((message) => !message.includes('실패')),
      `Unexpected dialog messages: ${dialogMessages.join(' | ')}`
    ).toBe(true);
  } finally {
    if (tempStudent) {
      await cleanupTempStudentData(page, {
        ...tempStudent,
        cleanupPackagesByStudent: true,
        cleanupGroupStudentsByStudent: true,
      });
    }
    if (groupSetup) {
      await cleanupAdminSeededCalendarGroupLessonSetup({
        ...groupSetup,
        strictLessonIdsOnly: true,
      }).catch(() => {});
    }
  }
});
