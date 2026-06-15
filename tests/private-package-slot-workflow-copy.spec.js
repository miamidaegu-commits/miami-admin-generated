import { test, expect } from '@playwright/test';
import {
  BASE_URL,
  getStudentRow,
  getStudentRowById,
  getStudentSearchInput,
  loginAsAdmin,
  loginAsStudent,
  openDashboardSection,
} from './e2e-helpers.js';
import { createTempStudent, createTempTeacher, cleanupTempStudentData } from './e2e-firebase-helpers.js';
import {
  createAdminSeededPrivateLesson,
  createAdminSeededPrivateReservation,
  createAdminSeededPrivateAvailabilityTemplate,
  createAdminSeededPrivateStudent,
  createAdminSeededStudentUser,
  createAdminSeededTeacher,
  cleanupAdminSeededPrivatePackageWorkflowCopyFixture,
  cleanupAdminSeededPrivateAvailabilityTemplate,
  cleanupAdminSeededStudentUser,
  createAdminSeededStudentPackage,
  cleanupAdminSeededCreditTransactionsForStudent,
  cleanupAdminSeededStudentPrivateAccessSummary,
  cleanupAdminSeededTeacher,
  getAdminSeededCreditTransactionsForPackage,
  getAdminSeededPrivateStudent,
  getAdminSeededPrivatePackagesForStudent,
  getAdminSeededStudentPackage,
  getAdminSeededStudentPrivateAccessSummary,
  setAdminSeededStudentPrivateAccessSummary,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD, TEST_STUDENT_PASSWORD } from './fixtures/test-data.js';

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

function upcomingWeekdayYmd(targetWeekday) {
  const date = new Date();
  const current = date.getDay();
  const daysUntil = (targetWeekday - current + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntil);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

async function openStudentPrivateBooking(page, email) {
  await loginAsStudent(page, email, TEST_STUDENT_PASSWORD);
  await page.goto(new URL('/student-booking?privateSlotBooking=enabled', BASE_URL).toString());
  await expect(page.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
    timeout: 15000,
  });
}

function privateSlotCardForDateTime(page, date, time) {
  return page
    .getByTestId('student-private-slot-card')
    .filter({ hasText: date })
    .filter({ hasText: time });
}

async function openPackageAddDialog(page, studentName, studentId = '') {
  if (studentId) {
    await expect
      .poll(async () => {
        const student = await getAdminSeededPrivateStudent({
          academyId: ACADEMY_ID,
          studentId,
        });
        return String(student?.name || '').trim();
      }, { timeout: 15000 })
      .toBe(studentName);
  }
  await openDashboardSection(page, '학생 관리');
  const studentSearchInput = getStudentSearchInput(page);
  await studentSearchInput.fill(studentName);

  const studentRow = studentId ? getStudentRowById(page, studentId) : getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible({ timeout: 15000 });
  await studentRow.getByRole('button', { name: '수강권 추가', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('수강권 유형').selectOption('private');
  return dialog;
}

async function maybeDismissPostPrivateLessonScheduleModal(page, options = {}) {
  const modal = page
    .getByTestId('post-private-lesson-schedule-modal')
    .or(page.getByRole('dialog', { name: '고정 1:1 수업 배정으로 이동할까요?' }))
    .first();
  if (!(await modal.isVisible({ timeout: options.timeout ?? 2000 }).catch(() => false))) {
    return false;
  }
  await expect(modal).toContainText('고정 1:1 수업 배정으로 이동할까요?');
  if (options.expectedText) {
    await expect(modal).toContainText(options.expectedText);
  }
  await modal.getByRole('button', { name: /나중에 (하기|등록)/ }).click();
  await expect(modal).toBeHidden({ timeout: 10000 });
  return true;
}

async function closeDialogBestEffort(page, dialog) {
  if (!(await dialog.isVisible({ timeout: 1000 }).catch(() => false))) return;
  const cancelButton = dialog.getByRole('button', { name: '취소', exact: true });
  if (await cancelButton.isEnabled({ timeout: 1000 }).catch(() => false)) {
    await cancelButton.click({ timeout: 5000 }).catch(() => {});
  } else {
    await page.keyboard.press('Escape').catch(() => {});
  }
  await expect(dialog).toBeHidden({ timeout: 5000 }).catch(() => {});
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

    const dialog = await openPackageAddDialog(page, studentName, tempStudent.studentId);

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
    if (tempStudent) await cleanupTempStudentData(page, { ...tempStudent, firebaseTaskTimeoutMs: 60000 });
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

    await expect
      .poll(async () => {
        const pkg = await getAdminSeededStudentPackage({
          academyId: ACADEMY_ID,
          packageId: packageSeed.packageId,
        });
        return {
          id: pkg?.id || '',
          studentId: pkg?.studentId || '',
          teacherKey: pkg?.teacherKey || pkg?.teacher || '',
          totalCount: Number(pkg?.totalCount || 0),
          remainingCount: Number(pkg?.remainingCount || 0),
        };
      }, { timeout: 15000 })
      .toEqual({
        id: packageSeed.packageId,
        studentId: tempStudent.studentId,
        teacherKey: TEACHER,
        totalCount: 4,
        remainingCount: 4,
      });

    const dialog = await openPackageAddDialog(page, studentName, tempStudent.studentId);
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
    const editDialog = page.getByRole('dialog', { name: '수강권 수정' });
    await expect(editDialog).toBeVisible();
    await closeDialogBestEffort(page, editDialog);
    await expect
      .poll(async () => {
        const pkg = await getAdminSeededStudentPackage({
          academyId: ACADEMY_ID,
          packageId: packageSeed.packageId,
        });
        return {
          id: pkg?.id || '',
          teacherKey: pkg?.teacherKey || pkg?.teacher || '',
          totalCount: Number(pkg?.totalCount || 0),
          remainingCount: Number(pkg?.remainingCount || 0),
        };
      }, { timeout: 10000 })
      .toEqual({
        id: packageSeed.packageId,
        teacherKey: TEACHER,
        totalCount: 4,
        remainingCount: 4,
      });

    const reopened = await openPackageAddDialog(page, studentName, tempStudent.studentId);
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
    if (tempStudent) await cleanupTempStudentData(page, { ...tempStudent, firebaseTaskTimeoutMs: 60000 });
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

    const dialog = await openPackageAddDialog(page, studentName, tempStudent.studentId);
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
    await maybeDismissPostPrivateLessonScheduleModal(page);

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
    if (tempStudent) {
      await cleanupTempStudentData(page, { ...tempStudent, firebaseTaskTimeoutMs: 60000 }).catch(() => {});
    }
    await cleanupAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: secondTeacherId,
    }).catch(() => {});
  }
});

test('admin can revoke one private teacher package without touching another teacher', async ({
  page,
  browser,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(240000);

  const unique = Date.now();
  const studentName = `E2E 수강권회수 ${unique}`;
  const studentId = `e2e-revoke-student-${unique}`;
  const studentEmail = `e2e-revoke-${unique}@example.com`;
  const secondTeacherKey = `miketest-revoke-${unique}`;
  const secondTeacherId = `e2e-revoke-teacher-${unique}`;
  const slotDate = upcomingWeekdayYmd(1);
  const slotTime = '13:00';
  let tempStudent = null;
  let studentUser = null;
  let secondPackageId = '';
  let template = null;
  let studentContext = null;
  let studentPage = null;
  const cleanupFixture = { academyId: ACADEMY_ID, reservationIds: [], packageIds: [], studentId };

  try {
    await createAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: secondTeacherId,
      teacherKey: secondTeacherKey,
      teacherName: 'miketest',
    });
    tempStudent = await createAdminSeededPrivateStudent({
      academyId: ACADEMY_ID,
      studentId,
      name: studentName,
      studentName,
      teacher: TEACHER,
      teacherName: TEACHER,
      status: 'active',
      note: 'E2E private package revoke test',
    });
    studentUser = await createAdminSeededStudentUser({
      academyId: ACADEMY_ID,
      studentId,
      email: studentEmail,
      password: TEST_STUDENT_PASSWORD,
      displayName: studentName,
    });

    const donPackage = await createAdminSeededStudentPackage({
      academyId: ACADEMY_ID,
      studentId,
      studentName,
      title: `E2E don1 유지 수강권 ${unique}`,
      packageType: 'private',
      teacher: TEACHER,
      teacherKey: TEACHER,
      teacherName: TEACHER,
      totalCount: 4,
      remainingCount: 3,
      usedCount: 1,
      privatePackageMode: 'countBased',
      expiresAt: '2099-01-01',
    });
    const secondPackage = await createAdminSeededStudentPackage({
      academyId: ACADEMY_ID,
      studentId,
      studentName,
      title: `E2E miketest 회수 수강권 ${unique}`,
      packageType: 'private',
      teacher: secondTeacherKey,
      teacherKey: secondTeacherKey,
      teacherName: 'miketest',
      totalCount: 3,
      remainingCount: 3,
      usedCount: 0,
      privatePackageMode: 'countBased',
      expiresAt: '2099-01-01',
    });
    secondPackageId = secondPackage.packageId;
    cleanupFixture.packageIds.push(donPackage.packageId, secondPackage.packageId);
    const blockingReservation = await createAdminSeededPrivateReservation({
      academyId: ACADEMY_ID,
      studentId,
      studentName,
      packageId: donPackage.packageId,
      teacher: TEACHER,
      teacherName: TEACHER,
      date: futureYmd(8),
      time: '14:00',
      status: 'active',
    });
    cleanupFixture.reservationIds.push(blockingReservation.reservationId);
    template = await createAdminSeededPrivateAvailabilityTemplate({
      academyId: ACADEMY_ID,
      teacherKey: secondTeacherKey,
      teacherName: 'miketest',
      weekday: 1,
      time: slotTime,
      durationMinutes: 60,
      openForStudentBooking: true,
      useForFixedAssignment: false,
    });
    await setAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId,
      teacherKeys: [TEACHER, secondTeacherKey],
      activePackageIds: [donPackage.packageId, secondPackage.packageId],
      privateSlotBookingPilotEnabled: true,
    });
    await expect
      .poll(async () => {
        const [donPkg, secondPkg, summary] = await Promise.all([
          getAdminSeededStudentPackage({
            academyId: ACADEMY_ID,
            packageId: donPackage.packageId,
          }),
          getAdminSeededStudentPackage({
            academyId: ACADEMY_ID,
            packageId: secondPackage.packageId,
          }),
          getAdminSeededStudentPrivateAccessSummary({
            academyId: ACADEMY_ID,
            studentId,
          }),
        ]);
        return {
          activePackageIds: summary?.activePackageIds || [],
          teacherKeys: summary?.teacherKeys || [],
          packages: [donPkg, secondPkg].filter(Boolean).map((pkg) => ({
            id: pkg.id,
            teacher: String(pkg.teacherKey || pkg.teacher || '').trim(),
            teacherName: String(pkg.teacherName || '').trim(),
            status: String(pkg.status || '').trim(),
          })),
        };
      }, { timeout: 30000 })
      .toEqual(
        expect.objectContaining({
          activePackageIds: expect.arrayContaining([donPackage.packageId, secondPackage.packageId]),
          teacherKeys: expect.arrayContaining([TEACHER, secondTeacherKey]),
          packages: expect.arrayContaining([
            expect.objectContaining({ id: donPackage.packageId, teacher: TEACHER, status: 'active' }),
            expect.objectContaining({
              id: secondPackage.packageId,
              teacher: secondTeacherKey,
              teacherName: 'miketest',
              status: 'active',
            }),
          ]),
        })
      );

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '학생 관리');
    await getStudentSearchInput(page).fill(studentName);
    const studentRow = getStudentRowById(page, studentId);
    await expect(studentRow).toBeVisible({ timeout: 30000 });
    await expect(studentRow.getByTestId('student-private-package-cell')).toContainText(TEACHER, {
      timeout: 30000,
    });
    await studentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();

    const donCard = page.locator(
      `[data-testid="student-package-card"][data-package-id="${donPackage.packageId}"][data-teacher-key="${TEACHER}"]`
    );
    await expect(donCard).toBeVisible({ timeout: 30000 });
    await expect(donCard.getByTestId('student-package-revoke-button')).toBeDisabled();
    await expect(donCard.getByTestId('student-package-revoke-disabled-reason')).toContainText(
      /사용된 회차|활성 1:1 예약/
    );

    const secondCard = page.locator(
      `[data-testid="student-package-card"][data-package-id="${secondPackage.packageId}"][data-teacher-key="${secondTeacherKey}"]`
    );
    await expect(secondCard).toBeVisible({ timeout: 30000 });
    await expect(secondCard.getByTestId('student-package-revoke-button')).toBeEnabled();

    studentContext = await browser.newContext();
    studentPage = await studentContext.newPage();
    await openStudentPrivateBooking(studentPage, studentEmail);
    await expect(
      privateSlotCardForDateTime(studentPage, slotDate, slotTime),
      'miketest package should expose the public weekly slot before revoke'
    ).toBeVisible({ timeout: 30000 });

    page.once('dialog', async (dialog) => {
      expect(dialog.type()).toBe('prompt');
      await dialog.accept('E2E 오발급 회수');
    });
    await secondCard.getByTestId('student-package-revoke-button').click();

    await expect
      .poll(async () => {
        const [donPkg, secondPkg] = await Promise.all([
          getAdminSeededStudentPackage({
            academyId: ACADEMY_ID,
            packageId: donPackage.packageId,
          }),
          getAdminSeededStudentPackage({
            academyId: ACADEMY_ID,
            packageId: secondPackage.packageId,
          }),
        ]);
        return [donPkg, secondPkg].filter(Boolean).map((pkg) => ({
          id: pkg.id,
          teacher: String(pkg.teacherKey || pkg.teacher || '').trim(),
          status: String(pkg.status || '').trim(),
          revokeReason: String(pkg.revokeReason || '').trim(),
        }));
      }, { timeout: 30000 })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: donPackage.packageId, teacher: TEACHER, status: 'active' }),
          expect.objectContaining({
            id: secondPackage.packageId,
            teacher: secondTeacherKey,
            status: 'revoked',
            revokeReason: 'E2E 오발급 회수',
          }),
        ])
      );

    const accessSummary = await getAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId,
    });
    expect(accessSummary?.teacherKeys || []).toContain(TEACHER);
    expect(accessSummary?.teacherKeys || []).not.toContain(secondTeacherKey);
    expect(accessSummary?.activePackageIds || []).toContain(donPackage.packageId);
    expect(accessSummary?.activePackageIds || []).not.toContain(secondPackage.packageId);

    await expect
      .poll(async () => {
        const rows = await getAdminSeededCreditTransactionsForPackage({
          academyId: ACADEMY_ID,
          packageId: secondPackage.packageId,
        });
        return rows.map((row) => ({
          packageId: String(row.packageId || '').trim(),
          sourceId: String(row.sourceId || '').trim(),
          studentId: String(row.studentId || '').trim(),
          actionType: String(row.actionType || '').trim(),
          memo: String(row.memo || '').trim(),
        }));
      }, { timeout: 30000 })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            packageId: secondPackage.packageId,
            sourceId: secondPackage.packageId,
            studentId,
            actionType: 'package_revoked',
            memo: expect.stringContaining('수강권 회수'),
          }),
        ])
      );

    await page.goto(BASE_URL);
    await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible({
      timeout: 30000,
    });
    await openDashboardSection(page, '학생 관리');
    await getStudentSearchInput(page).fill(studentName);
    const refreshedStudentRow = getStudentRowById(page, studentId);
    await expect(refreshedStudentRow).toBeVisible();

    await expect(refreshedStudentRow.getByTestId('student-private-package-cell')).toContainText(TEACHER);

    await refreshedStudentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();
    await page.getByTestId('student-package-show-all-button').click();
    const revokedCard = page.locator(
      `[data-testid="student-package-card"][data-package-id="${secondPackage.packageId}"][data-teacher-key="${secondTeacherKey}"]`
    );
    await expect(revokedCard).toContainText('회수됨');
    await expect(revokedCard).toContainText('E2E 오발급 회수');
    await revokedCard.getByTestId('student-package-history-button').click();
    const packageHistoryDialog = page.getByRole('dialog', { name: '수강권 이력' });
    await expect(packageHistoryDialog).toBeVisible();
    await expect(packageHistoryDialog).toContainText('회수됨');
    await packageHistoryDialog.getByRole('button', { name: '닫기' }).click();

    await refreshedStudentRow.getByTestId('student-history-open-button').click();
    const studentHistoryDialog = page.getByRole('dialog', { name: '학생 수업 내역' });
    await expect(studentHistoryDialog).toBeVisible();
    const revokedHistoryPackageRow = studentHistoryDialog
      .getByTestId('student-history-package-row')
      .filter({ hasText: `E2E miketest 회수 수강권 ${unique}` });
    await expect(revokedHistoryPackageRow).toContainText('회수됨');
    await studentHistoryDialog.getByRole('button', { name: '닫기' }).click();

    await studentPage.goto(new URL('/student-booking?privateSlotBooking=enabled', BASE_URL).toString());
    await expect(studentPage.getByRole('heading', { name: '수업 예약', exact: true })).toBeVisible({
      timeout: 15000,
    });
    await expect(
      privateSlotCardForDateTime(studentPage, slotDate, slotTime),
      'miketest slot should disappear after revoking the only miketest package'
    ).toHaveCount(0, { timeout: 30000 });
  } finally {
    if (studentContext) {
      await studentContext.close().catch(() => {});
    }
    await cleanupAdminSeededPrivatePackageWorkflowCopyFixture(cleanupFixture).catch(() => {});
    if (studentId) {
      await cleanupAdminSeededCreditTransactionsForStudent({
        academyId: ACADEMY_ID,
        studentId,
      }).catch(() => {});
      await cleanupAdminSeededStudentPrivateAccessSummary({
        academyId: ACADEMY_ID,
        studentId,
      }).catch(() => {});
    }
    if (studentUser) {
      await cleanupAdminSeededStudentUser({
        academyId: ACADEMY_ID,
        uid: studentUser.uid,
      }).catch(() => {});
    }
    if (template) {
      await cleanupAdminSeededPrivateAvailabilityTemplate({
        academyId: ACADEMY_ID,
        templateId: template.templateId,
      }).catch(() => {});
    }
    await cleanupAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: secondTeacherId,
    }).catch(() => {});
  }
});
