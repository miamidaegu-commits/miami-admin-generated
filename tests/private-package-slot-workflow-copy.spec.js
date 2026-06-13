import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import { createTempStudent, createTempTeacher, cleanupTempStudentData } from './e2e-firebase-helpers.js';
import {
  createAdminSeededPrivateLesson,
  createAdminSeededPrivateReservation,
  cleanupAdminSeededPrivatePackageWorkflowCopyFixture,
  createAdminSeededStudentPackage,
  cleanupAdminSeededStudentPrivateAccessSummary,
  cleanupAdminSeededTeacher,
  getAdminSeededPrivatePackagesForStudent,
  getAdminSeededStudentPrivateAccessSummary,
  setAdminSeededStudentPrivateAccessSummary,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

const ACADEMY_ID = 'academy_e2e_default';
const TEACHER = 'don1';

function futureYmd(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function openPackageAddDialog(page, studentName) {
  await openDashboardSection(page, '학생 관리');
  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(studentName);

  const studentRow = getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible();
  await studentRow.getByRole('button', { name: '수강권 추가', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('수강권 유형').selectOption('private');
  return dialog;
}

test('private package add modal explains package counts and fixed assignment workflow', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const unique = Date.now();
  const studentName = `E2E 수강권설명 ${unique}`;
  let tempStudent = null;

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    tempStudent = await createTempStudent(page, {
      studentName,
      teacherName: TEACHER,
      note: 'E2E private package workflow copy test',
    });

    const dialog = await openPackageAddDialog(page, studentName);

    await expect(dialog.getByRole('button', { name: '정기 수강권', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '횟수 수강권', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '정기등록', exact: true })).toHaveCount(0);
    await expect(dialog).toContainText('수강권은 수업을 들을 수 있는 횟수만 등록합니다');
    await expect(dialog).toContainText('고정 수업 일정은 1:1 예약 시간 관리 > 고정 1:1 수업 배정');
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '운영 순서'
    );
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '1) 수강권 등록/추가 등록: 학생에게 수업 가능 횟수를 부여합니다.'
    );
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '2) 선생님 주간 가능 시간 등록: 고정 배정 또는 학생 직접예약에 사용할 반복 요일/시간을 만듭니다.'
    );
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '3) 고정 1:1 수업 배정: 수강권 횟수를 사용해 실제 수업 날짜를 생성합니다.'
    );
    await expect(dialog).toContainText('주당 횟수와 등록 주수로 총 횟수를 자동 계산합니다.');

    await dialog.getByRole('button', { name: '횟수 수강권', exact: true }).click();
    await expect(dialog).toContainText('총 횟수를 직접 입력합니다.');
  } finally {
    if (tempStudent) await cleanupTempStudentData(page, tempStudent);
  }
});

test('duplicate private package warning shows actionable capacity details and reuse actions', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(120000);

  const unique = Date.now();
  const studentName = `E2E 수강권중복 ${unique}`;
  let tempStudent = null;
  const cleanupFixture = { academyId: ACADEMY_ID, lessonIds: [], reservationIds: [] };

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    tempStudent = await createTempStudent(page, {
      studentName,
      teacherName: TEACHER,
      note: 'E2E private package duplicate copy test',
    });

    const packageSeed = await createAdminSeededStudentPackage({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      studentName,
      title: `E2E 현재 수강권 ${unique}`,
      packageType: 'private',
      teacher: TEACHER,
      teacherName: TEACHER,
      totalCount: 4,
      remainingCount: 4,
      usedCount: 0,
      registrationStartDate: '2026-05-29',
      registrationWeeks: 4,
      weeklyFrequency: 1,
      expiresAt: '2099-01-01',
    });

    const seededRows = await Promise.all([
      createAdminSeededPrivateLesson({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
        studentName,
        packageId: packageSeed.packageId,
        teacher: TEACHER,
        teacherName: TEACHER,
        date: futureYmd(10),
        time: '10:00',
        subject: `E2E 고정1 ${unique}`,
      }),
      createAdminSeededPrivateLesson({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
        studentName,
        packageId: packageSeed.packageId,
        teacher: TEACHER,
        teacherName: TEACHER,
        date: futureYmd(17),
        time: '10:00',
        subject: `E2E 고정2 ${unique}`,
      }),
      createAdminSeededPrivateLesson({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
        studentName,
        packageId: packageSeed.packageId,
        teacher: TEACHER,
        teacherName: TEACHER,
        date: futureYmd(24),
        time: '10:00',
        subject: `E2E 고정3 ${unique}`,
      }),
      createAdminSeededPrivateReservation({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
        studentName,
        packageId: packageSeed.packageId,
        teacher: TEACHER,
        teacherName: TEACHER,
        date: futureYmd(12),
        time: '11:00',
        status: 'active',
      }),
    ]);
    cleanupFixture.lessonIds = seededRows
      .filter((row) => row.lessonId)
      .map((row) => row.lessonId);
    cleanupFixture.reservationIds = seededRows
      .filter((row) => row.reservationId)
      .map((row) => row.reservationId);

    const dialog = await openPackageAddDialog(page, studentName);
    const guidance = dialog.getByTestId('student-package-duplicate-guidance');
    await expect(guidance).toBeVisible();
    await expect(guidance).toContainText('이미 사용 중인 개인 수강권이 있습니다.');
    await expect(guidance).toContainText('기존 수강권에 추가 등록할 수 있습니다.');
    await expect(dialog.getByTestId('student-package-top-up-section')).toBeVisible();
    await expect(guidance).toContainText(`E2E 현재 수강권 ${unique}`);
    await expect(guidance).toContainText('총 4회 · 사용 0회 · 남은 4회');
    await expect(guidance).toContainText('고정 예정 3회 · 예약 1회 · 새 배정 가능 0회');

    await expect(dialog.getByTestId('student-package-top-up-section')).toContainText(
      '같은 선생님 수강권에 횟수와 결제 이력을 더합니다.'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '2회차/3회차 결제 등록 → 기존 수강권에 추가 등록'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '결제일/금액/횟수 오입력 수정 → 기존 수강권 수정'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '별도 계약으로 분리 → 새 수강권으로 발급'
    );
    await expect(dialog.getByTestId('private-package-situation-guidance')).toContainText(
      '수업 날짜 생성 → 고정 1:1 수업 배정으로 이동'
    );
    await expect(dialog.getByTestId('private-package-other-options')).toContainText('기타 옵션');
    await expect(dialog.getByTestId('private-package-other-options')).toContainText(
      '별도 수강권을 새로 만듭니다. 일반적인 추가 등록에는 사용하지 마세요.'
    );
    await dialog.getByTestId('private-package-force-new-button').click();
    await expect(dialog.getByRole('button', { name: '새 수강권으로 발급', exact: true })).toBeVisible();
    await expect(dialog.getByTestId('private-package-other-options')).toContainText(
      '같은 선생님 수강권에 횟수와 결제 이력을 더합니다.'
    );
    await dialog.getByTestId('private-package-use-top-up-button').click();
    await expect(dialog.getByTestId('private-package-other-options')).toContainText(
      '별도 수강권을 새로 만듭니다. 일반적인 추가 등록에는 사용하지 마세요.'
    );
    await expect(guidance).toContainText('잘못 입력한 정보를 고칠 때 사용합니다.');
    await expect(guidance).toContainText('수강권 횟수를 실제 수업 일정으로 배정합니다.');
    await dialog.getByTestId('student-package-edit-existing-button').click();
    await expect(page.getByRole('dialog', { name: '수강권 수정' })).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();

    const reopened = await openPackageAddDialog(page, studentName);
    await reopened.getByTestId('student-package-go-fixed-assignment-button').click();
    await expect(page.getByRole('heading', { name: '고정 1:1 수업 배정' })).toBeVisible();
    await expect(page.getByTestId('private-fixed-slot-assignment-section')).toContainText(
      '수강권 횟수를 사용해 날짜별 고정수업을 생성합니다.'
    );
    await expect(page.getByTestId('private-fixed-slot-assignment-section')).toContainText(
      '수강권만 등록하면 수업 일정은 자동 생성되지 않습니다.'
    );
    await expect(page.getByTestId('private-fixed-slot-assignment-section')).toContainText(
      '고정수업은 "고정 배정에 사용"이 켜진 주간 가능 시간에서만 만들 수 있습니다.'
    );
    await expect(page.getByTestId('private-fixed-slot-assignment-section')).toContainText(
      '날짜별 예약 가능 시간은 학생 직접 예약용입니다.'
    );
    await expect(page.getByTestId('private-availability-template-section')).toContainText(
      '선생님의 반복 가능한 시간을 고정 1:1 배정이나 학생 직접예약 공개에 사용합니다.'
    );
    await expect(page.getByTestId('private-availability-template-section')).toContainText(
      '기존 주간 기본 슬롯은 고정 배정용으로 유지되며, 학생 직접예약 공개는 선택한 슬롯만 적용됩니다.'
    );
    await expect(page.getByTestId('private-dated-availability-helper')).toContainText(
      '날짜별 예약 가능 시간 (학생 직접 예약용)'
    );
    await expect(page.getByTestId('private-dated-availability-helper')).toContainText(
      '고정 1:1 배정에 사용하려면 선생님 주간 가능 시간으로 등록하세요.'
    );
  } finally {
    await cleanupAdminSeededPrivatePackageWorkflowCopyFixture(cleanupFixture).catch(() => {});
    if (tempStudent) await cleanupTempStudentData(page, tempStudent);
  }
});

test('admin can create a separate private package for a different teacher', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(120000);

  const unique = Date.now();
  const studentName = `E2E 다선생수강권 ${unique}`;
  const secondTeacherKey = `miketest-${unique}`;
  const secondTeacherId = `e2e-package-teacher-${unique}`;
  let tempStudent = null;

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await createTempTeacher(page, {
      teacherId: secondTeacherId,
      teacherKey: secondTeacherKey,
      teacherName: 'miketest',
    });
    tempStudent = await createTempStudent(page, {
      studentName,
      teacherName: TEACHER,
      note: 'E2E private package different teacher test',
    });

    const existingPackage = await createAdminSeededStudentPackage({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      studentName,
      title: `E2E don1 기존 수강권 ${unique}`,
      packageType: 'private',
      teacher: TEACHER,
      teacherName: TEACHER,
      totalCount: 4,
      remainingCount: 4,
      usedCount: 0,
      privatePackageMode: 'countBased',
      expiresAt: '2099-01-01',
    });
    await setAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      teacherKeys: [TEACHER],
      activePackageIds: [existingPackage.packageId],
    });

    const dialog = await openPackageAddDialog(page, studentName);
    await expect(dialog.getByTestId('student-package-duplicate-guidance')).toBeVisible();

    const teacherSelect = dialog.getByLabel('수강권 선생님');
    await expect(teacherSelect).toBeVisible();
    await expect
      .poll(async () => {
        return teacherSelect.locator('option').evaluateAll((options) =>
          options.map((option) => option.getAttribute('value') || '')
        );
      }, { timeout: 30000 })
      .toContain(secondTeacherKey);
    await teacherSelect.selectOption(secondTeacherKey);
    await expect(dialog.getByTestId('student-package-duplicate-guidance')).toHaveCount(0);

    await dialog.getByRole('button', { name: '횟수 수강권', exact: true }).click();
    await dialog.getByLabel('제목').fill(`E2E miketest 수강권 ${unique}`);
    await dialog.getByLabel(/총 횟수/).fill('3');
    await dialog.getByRole('button', { name: '저장', exact: true }).click();

    const postPrivateDialog = page.getByRole('dialog', {
      name: '고정 1:1 수업 배정으로 이동할까요?',
    });
    await expect(postPrivateDialog).toBeVisible({ timeout: 30000 });
    await postPrivateDialog.getByRole('button', { name: '나중에 하기' }).click();
    await expect(postPrivateDialog).toBeHidden();

    await expect
      .poll(async () => {
        const packages = await getAdminSeededPrivatePackagesForStudent({
          academyId: ACADEMY_ID,
          studentId: tempStudent.studentId,
        });
        return packages
          .map((pkg) => String(pkg.teacherKey || pkg.teacher || '').trim())
          .sort();
      }, { timeout: 30000 })
      .toEqual([TEACHER, secondTeacherKey].sort());

    const packages = await getAdminSeededPrivatePackagesForStudent({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
    });
    const donPackage = packages.find((pkg) => String(pkg.teacher || '') === TEACHER);
    const secondPackage = packages.find(
      (pkg) => String(pkg.teacherKey || pkg.teacher || '') === secondTeacherKey
    );
    expect(donPackage?.id).toBe(existingPackage.packageId);
    expect(secondPackage).toMatchObject({
      teacher: secondTeacherKey,
      teacherKey: secondTeacherKey,
      teacherName: 'miketest',
      totalCount: 3,
      remainingCount: 3,
      packageType: 'private',
    });

    const accessSummary = await getAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
    });
    expect(accessSummary?.teacherKeys || []).toEqual(
      expect.arrayContaining([TEACHER, secondTeacherKey])
    );
    expect(accessSummary?.activePackageIds || []).toEqual(
      expect.arrayContaining([existingPackage.packageId, secondPackage.id])
    );
  } finally {
    if (tempStudent) {
      await cleanupAdminSeededStudentPrivateAccessSummary({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
      }).catch(() => {});
    }
    if (tempStudent) await cleanupTempStudentData(page, tempStudent).catch(() => {});
    await cleanupAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: secondTeacherId,
    }).catch(() => {});
  }
});
