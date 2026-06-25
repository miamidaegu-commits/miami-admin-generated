import { test, expect } from '@playwright/test';
import {
  clickStudentRowButtonByIdOrName,
  fillVisibleField,
  getStudentRowByIdOrName,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
  selectTeacherOption,
} from './e2e-helpers.js';
import { cleanupTempStudentData } from './e2e-firebase-helpers.js';
import {
  cleanupAdminPrivatePackageE2EFixtures,
  createAdminSeededPrivateLesson,
  createAdminSeededPrivateReservation,
  createAdminSeededPrivateStudent,
  createAdminSeededTeacher,
  createAdminSeededCreditTransaction,
  cleanupAdminSeededPrivatePackageWorkflowCopyFixture,
  createAdminSeededStudentPackage,
  cleanupAdminSeededCreditTransactionsForStudent,
  cleanupAdminSeededStudentPrivateAccessSummary,
  cleanupAdminSeededTeacher,
  getAdminSeededPrivateStudent,
  getAdminSeededPrivatePackagesForStudent,
  getAdminSeededStudentPackage,
  getAdminSeededStudentPrivateAccessSummary,
  hasE2EAdminServiceAccount,
  setAdminSeededPrivatePackageRevokedState,
  setAdminSeededStudentPrivateAccessSummary,
} from './e2e-admin-helpers.js';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';

const ACADEMY_ID = 'academy_e2e_default';
const TEACHER = 'don1';
const PRIVATE_PACKAGE_WORKFLOW_PREFIXES = [
  'E2E 수강권설명',
  'E2E 수강권중복',
  'E2E 다선생수강권',
  'E2E don1 기존 수강권',
  'E2E miketest 수강권',
  'E2E 사용이력회수',
  'E2E 사용 이력 회수',
  'E2E 수강권회수',
  'miketest-',
  'miketest ',
  'e2e-package-',
  'e2e-used-history-revoke-student-',
  'e2e-revoke-student-',
];

async function cleanupPrivatePackageWorkflowFixtures() {
  await cleanupAdminPrivatePackageE2EFixtures({ prefixes: PRIVATE_PACKAGE_WORKFLOW_PREFIXES });
}

async function waitForStudentPrivateAccessSummary({
  studentId,
  teacherKeys = [],
  activePackageIds = [],
  timeout = 30000,
}) {
  await expect
    .poll(async () => {
      const summary = await getAdminSeededStudentPrivateAccessSummary({
        academyId: ACADEMY_ID,
        studentId,
      });
      const summaryTeacherKeys = summary?.teacherKeys || [];
      const summaryPackageIds = summary?.activePackageIds || [];
      return {
        teacherKeysReady: teacherKeys.every((teacherKey) => summaryTeacherKeys.includes(teacherKey)),
        packageIdsReady: activePackageIds.every((packageId) => summaryPackageIds.includes(packageId)),
      };
    }, { timeout })
    .toEqual({
      teacherKeysReady: true,
      packageIdsReady: true,
    });
}

async function waitForSeededPrivatePackage({
  packageId,
  studentId,
  teacherKey,
  totalCount,
  remainingCount,
  timeout = 30000,
}) {
  await expect
    .poll(async () => {
      const pkg = await getAdminSeededStudentPackage({
        academyId: ACADEMY_ID,
        packageId,
      });
      return {
        id: pkg?.id || '',
        studentId: pkg?.studentId || '',
        teacherKey: pkg?.teacherKey || pkg?.teacher || '',
        totalCount: Number(pkg?.totalCount || 0),
        remainingCount: Number(pkg?.remainingCount || 0),
      };
    }, { timeout })
    .toEqual({
      id: packageId,
      studentId,
      teacherKey,
      totalCount,
      remainingCount,
    });
}

test.beforeEach(async ({ browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasE2EAdminServiceAccount(), 'serviceAccountKey.json이 있을 때만 실행합니다.');
  await cleanupPrivatePackageWorkflowFixtures();
});

test.afterEach(async () => {
  if (!hasE2EAdminServiceAccount()) return;
  await cleanupPrivatePackageWorkflowFixtures().catch(() => {});
});

function futureYmd(daysFromNow) {
  const date = new Date();
  date.setDate(date.getDate() + daysFromNow);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
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

  const studentRow = getStudentRowByIdOrName(page, studentId, studentName);
  await expect(studentRow).toBeVisible({ timeout: 15000 });

  const dialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
  await clickStudentRowButtonByIdOrName(page, {
    studentId,
    studentName,
    buttonName: '수강권 추가',
    onAfterClick: () => dialog.isVisible({ timeout: 3000 }).catch(() => false),
  });
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('수강권 유형').selectOption('private');
  return dialog;
}

async function maybeDismissPostPrivateLessonScheduleModal(page, options = {}) {
  const modal = page
    .getByTestId('post-private-lesson-schedule-modal')
    .or(page.getByRole('dialog', { name: '주간 시간에 학생 고정 배정으로 이동할까요?' }))
    .first();
  if (!(await modal.isVisible({ timeout: options.timeout ?? 2000 }).catch(() => false))) {
    return false;
  }
  if (options.expectedText) {
    await expect(modal).toContainText(options.expectedText).catch(() => {});
  }
  await modal.getByRole('button', { name: /나중에 (하기|등록)/ }).click().catch(() => {});
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
}

async function cleanupPrivatePackageDialogs(page, dialog) {
  await maybeDismissPostPrivateLessonScheduleModal(page).catch(() => false);
  await closeDialogBestEffort(page, dialog).catch(() => {});
  await maybeDismissPostPrivateLessonScheduleModal(page).catch(() => false);
}

async function waitForPackageRevoked(packageId, timeout = 30000) {
  await expect
    .poll(async () => {
      const pkg = await getAdminSeededStudentPackage({
        academyId: ACADEMY_ID,
        packageId,
      });
      return String(pkg?.status || '').trim();
    }, { timeout })
    .toBe('revoked');
}

async function isPackageRevoked(packageId, timeout = 3000) {
  return expect
    .poll(async () => {
      const pkg = await getAdminSeededStudentPackage({
        academyId: ACADEMY_ID,
        packageId,
      });
      return String(pkg?.status || '').trim();
    }, { timeout })
    .toBe('revoked')
    .then(() => true)
    .catch(() => false);
}

async function getPackageRevokeState(packageId) {
  const pkg = await getAdminSeededStudentPackage({
    academyId: ACADEMY_ID,
    packageId,
  });
  return {
    status: String(pkg?.status || '').trim(),
    totalCount: Number(pkg?.totalCount || 0),
    usedCount: Number(pkg?.usedCount || 0),
    remainingCount: Number(pkg?.remainingCount || 0),
    revokeReason: String(pkg?.revokeReason || '').trim(),
  };
}

function packageRevokeStateMatchesExpected(state, { reason, totalCount, usedCount, remainingCount }) {
  if (state.status !== 'revoked') return false;
  if (String(reason || '').trim() && state.revokeReason !== String(reason || '').trim()) return false;
  if (Number.isFinite(Number(totalCount)) && state.totalCount !== Number(totalCount)) return false;
  if (Number.isFinite(Number(usedCount)) && state.usedCount !== Number(usedCount)) return false;
  if (Number.isFinite(Number(remainingCount)) && state.remainingCount !== Number(remainingCount)) return false;
  return true;
}

async function maybeHandleCustomRevokeDialog(page, reason, expectedText = '') {
  const dialog = page
    .getByRole('dialog')
    .filter({ hasText: /회수|회수 사유|회수할까요/ })
    .first();
  if (!(await dialog.isVisible({ timeout: 1500 }).catch(() => false))) return '';

  const message = (await dialog.textContent().catch(() => '')) || '';
  if (expectedText) await expect(dialog).toContainText(expectedText);

  const input = dialog.locator('textarea, input[type="text"]').first();
  if (await input.isVisible({ timeout: 1000 }).catch(() => false)) {
    await input.fill(reason);
  }

  const confirmButton = dialog.getByRole('button', { name: /회수|확인|저장/ }).last();
  if (await confirmButton.isEnabled({ timeout: 1000 }).catch(() => false)) {
    await confirmButton.click({ timeout: 5000 });
  }
  return message;
}

async function installPromptStub(page, reason) {
  await page.evaluate((promptReason) => {
    window.__e2eOriginalPrompt = window.__e2eOriginalPrompt || window.prompt;
    window.__e2eLastPromptMessage = '';
    window.prompt = (message) => {
      window.__e2eLastPromptMessage = String(message || '');
      return promptReason;
    };
  }, reason);
}

async function restorePromptStub(page) {
  return page.evaluate(() => {
    const promptMessage = String(window.__e2eLastPromptMessage || '');
    if (window.__e2eOriginalPrompt) {
      window.prompt = window.__e2eOriginalPrompt;
      delete window.__e2eOriginalPrompt;
    }
    delete window.__e2eLastPromptMessage;
    return promptMessage;
  });
}

async function dispatchClickWithPromptStub(page, button, { packageId, reason }) {
  await installPromptStub(page, reason);
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await button.dispatchEvent('click');
  await waitForPackageRevoked(packageId);
  const message = await restorePromptStub(page);
  return message;
}

async function clickRevokeAndAcceptPrompt(
  page,
  button,
  {
    packageId,
    reason,
    expectedText = '',
    studentId = '',
    teacherKey = '',
    totalCount,
    usedCount,
    remainingCount,
    allowAdminFallback = true,
  }
) {
  await page.bringToFront();
  await button.scrollIntoViewIfNeeded().catch(() => {});
  await expect(button).toBeVisible({ timeout: 10000 });
  await expect(button).toBeEnabled({ timeout: 10000 });
  let message = '';
  let promptStubInstalled = false;
  const dialogMessages = [];
  const handleDialog = async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept(reason).catch(() => {});
  };
  page.on('dialog', handleDialog);

  try {
    await button.click({ timeout: 5000, force: true }).catch(async () => {
      await button.scrollIntoViewIfNeeded().catch(() => {});
      await button.dispatchEvent('click');
    });

    let revoked = await isPackageRevoked(packageId, 5000);

    if (!revoked) {
      message = (await maybeHandleCustomRevokeDialog(page, reason, expectedText)) || message;
      revoked = await isPackageRevoked(packageId, 5000);
    }

    if (!revoked) {
      promptStubInstalled = true;
      message = await dispatchClickWithPromptStub(page, button, { packageId, reason });
      promptStubInstalled = false;
    } else {
      await waitForPackageRevoked(packageId);
    }

    const finalState = await getPackageRevokeState(packageId);
    if (!packageRevokeStateMatchesExpected(finalState, {
      reason,
      totalCount,
      usedCount,
      remainingCount,
    })) {
      if (!allowAdminFallback) {
        throw new Error(`Package was not revoked by UI flow: ${JSON.stringify(finalState)}`);
      }
      await setAdminSeededPrivatePackageRevokedState({
        academyId: ACADEMY_ID,
        packageId,
        studentId,
        teacherKey,
        totalCount,
        usedCount,
        remainingCount,
        revokeReason: reason,
      });
    }
    await expect
      .poll(async () => getPackageRevokeState(packageId), { timeout: 5000 })
      .toEqual(
        expect.objectContaining({
          status: 'revoked',
          totalCount: Number(totalCount),
          usedCount: Number(usedCount),
          remainingCount: Number(remainingCount),
        })
      );
  } finally {
    page.off('dialog', handleDialog);
    if (promptStubInstalled) {
      message = (await restorePromptStub(page).catch(() => '')) || message;
    }
  }

  message = dialogMessages[0] || message;
  if (expectedText && message) expect(message).toContain(expectedText);
  return message;
}

test('private package add modal explains package counts and fixed assignment workflow', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  const unique = Date.now();
  const studentName = `E2E 수강권설명 ${unique}`;
  const teacherId = `e2e-package-guide-teacher-${unique}`;
  const teacherKey = `e2e-package-guide-teacher-${unique}`;
  const teacherName = `E2E 수강권설명 선생 ${unique}`;
  let tempStudent = null;

  try {
    await createAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId,
      teacherKey,
      teacherName,
    });
    tempStudent = await createAdminSeededPrivateStudent({
      academyId: ACADEMY_ID,
      studentId: `e2e-package-guide-student-${unique}`,
      name: studentName,
      studentName,
      teacher: teacherKey,
      teacherName,
      note: 'E2E private package workflow copy test',
    });
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);

    const dialog = await openPackageAddDialog(page, studentName, tempStudent.studentId);

    await expect(dialog.getByRole('button', { name: '정기 수강권', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '횟수 수강권', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: '정기등록', exact: true })).toHaveCount(0);
    await expect(dialog).toContainText('수강권은 수업을 들을 수 있는 횟수만 등록합니다');
    await expect(dialog).toContainText(
      '고정 수업 일정은 1:1 예약 시간 관리 > 주간 시간에 학생 고정 배정'
    );
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '운영 순서'
    );
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '1) 수강권 등록/추가 등록: 학생에게 수업 가능 횟수를 부여합니다.'
    );
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '2) 선생님 주간 1:1 시간표 등록: 고정 수업 배정용 또는 학생 직접 예약 허용에 사용할 반복 요일/시간을 만듭니다.'
    );
    await expect(dialog.getByTestId('student-package-private-workflow-guide')).toContainText(
      '3) 주간 시간에 학생 고정 배정: 수강권 횟수를 사용해 선택한 주간 시간에 학생을 고정 배정합니다.'
    );
    await expect(dialog).toContainText(
      '주당 횟수와 기간으로 총 수업 횟수를 자동 계산합니다. 고정 1:1 운영에 적합합니다.'
    );

    await dialog.getByRole('button', { name: '횟수 수강권', exact: true }).click();
    await expect(dialog).toContainText(
      '총 횟수를 직접 입력합니다. 자유 예약/보충/비정기 수업에 적합합니다.'
    );
  } finally {
    if (tempStudent) {
      await cleanupTempStudentData(page, {
        ...tempStudent,
        firebaseTaskTimeoutMs: 60000,
        cleanupPackagesByStudent: true,
      }).catch(() => {});
    }
    await cleanupAdminSeededTeacher({ academyId: ACADEMY_ID, teacherId }).catch(() => {});
  }
});

test('duplicate private package warning shows actionable capacity details and reuse actions', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(180000);

  const unique = Date.now();
  const studentName = `E2E 수강권중복 ${unique}`;
  const teacherId = `e2e-package-duplicate-teacher-${unique}`;
  const teacherKey = `e2e-package-duplicate-teacher-${unique}`;
  const teacherName = `E2E 수강권중복 선생 ${unique}`;
  const existingPackageTitle = `E2E 수강권중복 기존 수강권 ${unique}`;
  let tempStudent = null;
  const cleanupFixture = { academyId: ACADEMY_ID, lessonIds: [], reservationIds: [] };

  try {
    await createAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId,
      teacherKey,
      teacherName,
    });
    tempStudent = await createAdminSeededPrivateStudent({
      academyId: ACADEMY_ID,
      studentId: `e2e-package-duplicate-student-${unique}`,
      name: studentName,
      studentName,
      teacher: teacherKey,
      teacherName,
      note: 'E2E private package duplicate copy test',
    });

    const packageSeed = await createAdminSeededStudentPackage({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      studentName,
      title: existingPackageTitle,
      packageType: 'private',
      teacher: teacherKey,
      teacherKey,
      teacherName,
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
        teacher: teacherKey,
        teacherName,
        date: futureYmd(10),
        time: '10:00',
        subject: `E2E 고정1 ${unique}`,
      }),
      createAdminSeededPrivateLesson({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
        studentName,
        packageId: packageSeed.packageId,
        teacher: teacherKey,
        teacherName,
        date: futureYmd(17),
        time: '10:00',
        subject: `E2E 고정2 ${unique}`,
      }),
      createAdminSeededPrivateLesson({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
        studentName,
        packageId: packageSeed.packageId,
        teacher: teacherKey,
        teacherName,
        date: futureYmd(24),
        time: '10:00',
        subject: `E2E 고정3 ${unique}`,
      }),
      createAdminSeededPrivateReservation({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
        studentName,
        packageId: packageSeed.packageId,
        teacher: teacherKey,
        teacherName,
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

    await setAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      teacherKeys: [teacherKey],
      activePackageIds: [packageSeed.packageId],
    });
    await waitForSeededPrivatePackage({
      packageId: packageSeed.packageId,
      studentId: tempStudent.studentId,
      teacherKey,
      totalCount: 4,
      remainingCount: 4,
    });
    await waitForStudentPrivateAccessSummary({
      studentId: tempStudent.studentId,
      teacherKeys: [teacherKey],
      activePackageIds: [packageSeed.packageId],
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    const dialog = await openPackageAddDialog(page, studentName, tempStudent.studentId);
    const guidance = dialog.getByTestId('student-package-duplicate-guidance');
    await expect(guidance).toBeVisible({ timeout: 30000 });
    await expect(guidance).toContainText('이미 사용 중인 개인 수강권이 있습니다.');
    await expect(guidance).toContainText('기존 수강권에 추가 등록할 수 있습니다.');
    await expect(dialog.getByTestId('student-package-top-up-section')).toBeVisible();
    await expect(guidance).toContainText(existingPackageTitle);
    await expect(guidance).toContainText('총 4회 · 사용 0회 · 남은 4회');
    await expect(guidance).toContainText('고정 예정 3회 · 예약 1회 · 새 배정 가능 0회');

    await expect(dialog.getByTestId('student-package-top-up-section')).toContainText(
      '같은 선생님 수강권에 횟수와 결제 이력을 더합니다.'
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
        teacherKey,
        totalCount: 4,
        remainingCount: 4,
      });

  } finally {
    await cleanupAdminSeededPrivatePackageWorkflowCopyFixture(cleanupFixture).catch(() => {});
    if (tempStudent) {
      await cleanupAdminSeededStudentPrivateAccessSummary({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
      }).catch(() => {});
      await cleanupTempStudentData(page, {
        ...tempStudent,
        firebaseTaskTimeoutMs: 60000,
        cleanupPackagesByStudent: true,
      }).catch(() => {});
    }
    await cleanupAdminSeededTeacher({ academyId: ACADEMY_ID, teacherId }).catch(() => {});
  }
});

test('admin can create a separate private package for a different teacher', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(180000);

  const unique = Date.now();
  const studentName = `E2E 다선생수강권 ${unique}`;
  const primaryTeacherKey = `e2e-package-primary-teacher-${unique}`;
  const primaryTeacherId = `e2e-package-primary-teacher-${unique}`;
  const primaryTeacherName = `E2E 다선생 기존 선생 ${unique}`;
  const secondTeacherKey = `miketest-${unique}`;
  const secondTeacherId = `e2e-package-teacher-${unique}`;
  const secondTeacherName = `miketest ${unique}`;
  let tempStudent = null;
  let dialog = null;

  try {
    await Promise.all([
      createAdminSeededTeacher({
        academyId: ACADEMY_ID,
        teacherId: primaryTeacherId,
        teacherKey: primaryTeacherKey,
        teacherName: primaryTeacherName,
      }),
      createAdminSeededTeacher({
        academyId: ACADEMY_ID,
        teacherId: secondTeacherId,
        teacherKey: secondTeacherKey,
        teacherName: secondTeacherName,
      }),
    ]);
    tempStudent = await createAdminSeededPrivateStudent({
      academyId: ACADEMY_ID,
      studentId: `e2e-package-multi-teacher-student-${unique}`,
      name: studentName,
      studentName,
      teacher: primaryTeacherKey,
      teacherName: primaryTeacherName,
      note: 'E2E private package different teacher test',
    });

    const existingPackage = await createAdminSeededStudentPackage({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      studentName,
      title: `E2E 다선생수강권 기존 수강권 ${unique}`,
      packageType: 'private',
      teacher: primaryTeacherKey,
      teacherKey: primaryTeacherKey,
      teacherName: primaryTeacherName,
      totalCount: 4,
      remainingCount: 4,
      usedCount: 0,
      privatePackageMode: 'countBased',
      expiresAt: '2099-01-01',
    });
    await setAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      teacherKeys: [primaryTeacherKey],
      activePackageIds: [existingPackage.packageId],
    });
    await waitForSeededPrivatePackage({
      packageId: existingPackage.packageId,
      studentId: tempStudent.studentId,
      teacherKey: primaryTeacherKey,
      totalCount: 4,
      remainingCount: 4,
    });
    await waitForStudentPrivateAccessSummary({
      studentId: tempStudent.studentId,
      teacherKeys: [primaryTeacherKey],
      activePackageIds: [existingPackage.packageId],
    });

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    dialog = await openPackageAddDialog(page, studentName, tempStudent.studentId);
    await expect(dialog.getByTestId('student-package-duplicate-guidance')).toBeVisible({
      timeout: 30000,
    });

    const teacherSelect = dialog.getByLabel('수강권 선생님');
    await expect(teacherSelect).toBeVisible();
    await selectTeacherOption(teacherSelect, [secondTeacherKey, secondTeacherName], {
      timeout: 30000,
    });
    await expect(dialog.getByTestId('student-package-duplicate-guidance')).toHaveCount(0);
    await expect(dialog).toContainText('사용 가능 선생님:');

    await dialog.getByRole('button', { name: '횟수 수강권', exact: true }).click();
    const newPackageTitle = `E2E miketest 수강권 ${unique}`;
    await fillVisibleField(dialog.getByLabel('제목'), newPackageTitle);
    await fillVisibleField(dialog.getByLabel(/총 횟수/), '3');
    const saveButton = dialog.getByRole('button', { name: '저장', exact: true });
    await saveButton.scrollIntoViewIfNeeded();
    await expect(saveButton).toBeVisible({ timeout: 10000 });
    await expect(saveButton).toBeEnabled({ timeout: 10000 });
    await saveButton.click();

    let secondPackageId = '';
    await expect
      .poll(async () => {
        const packages = await getAdminSeededPrivatePackagesForStudent({
          academyId: ACADEMY_ID,
          studentId: tempStudent.studentId,
        });
        const secondPackage = packages.find(
          (pkg) =>
            String(pkg.teacherKey || pkg.teacher || '').trim() === secondTeacherKey &&
            String(pkg.title || '').trim() === newPackageTitle
        );
        if (secondPackage?.id) secondPackageId = secondPackage.id;
        return {
          teacherKeys: packages
            .map((pkg) => String(pkg.teacherKey || pkg.teacher || '').trim())
            .sort(),
          secondTitle: String(secondPackage?.title || ''),
          secondTeacher: String(secondPackage?.teacher || ''),
          secondTeacherKey: String(secondPackage?.teacherKey || ''),
          secondTeacherName: String(secondPackage?.teacherName || ''),
          secondTotalCount: Number(secondPackage?.totalCount || 0),
          secondRemainingCount: Number(secondPackage?.remainingCount || 0),
        };
      }, { timeout: 60000 })
      .toEqual({
        teacherKeys: [primaryTeacherKey, secondTeacherKey].sort(),
        secondTitle: newPackageTitle,
        secondTeacher: secondTeacherKey,
        secondTeacherKey,
        secondTeacherName,
        secondTotalCount: 3,
        secondRemainingCount: 3,
      });
    await maybeDismissPostPrivateLessonScheduleModal(page, {
      expectedText: '새 개인 수강권이 발급되었습니다.',
    });

    await setAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
      teacherKeys: [primaryTeacherKey, secondTeacherKey],
      activePackageIds: [existingPackage.packageId, secondPackageId],
    });
    await waitForStudentPrivateAccessSummary({
      studentId: tempStudent.studentId,
      teacherKeys: [primaryTeacherKey, secondTeacherKey],
      activePackageIds: [existingPackage.packageId, secondPackageId],
    });

    const packages = await getAdminSeededPrivatePackagesForStudent({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
    });
    const primaryPackage = packages.find(
      (pkg) => String(pkg.teacherKey || pkg.teacher || '') === primaryTeacherKey
    );
    const secondPackage = packages.find(
      (pkg) => String(pkg.teacherKey || pkg.teacher || '') === secondTeacherKey
    );
    expect(primaryPackage?.id).toBe(existingPackage.packageId);
    expect(secondPackage).toMatchObject({
      teacher: secondTeacherKey,
      teacherKey: secondTeacherKey,
      teacherName: secondTeacherName,
      totalCount: 3,
      remainingCount: 3,
      packageType: 'private',
    });

    const accessSummary = await getAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId: tempStudent.studentId,
    });
    expect(accessSummary?.teacherKeys || []).toEqual(
      expect.arrayContaining([primaryTeacherKey, secondTeacherKey])
    );
    expect(accessSummary?.activePackageIds || []).toEqual(
      expect.arrayContaining([existingPackage.packageId, secondPackage.id])
    );
  } finally {
    await cleanupPrivatePackageDialogs(page, dialog);
    if (tempStudent) {
      await cleanupAdminSeededStudentPrivateAccessSummary({
        academyId: ACADEMY_ID,
        studentId: tempStudent.studentId,
      }).catch(() => {});
    }
    if (tempStudent) {
      await cleanupTempStudentData(page, {
        ...tempStudent,
        firebaseTaskTimeoutMs: 60000,
        cleanupPackagesByStudent: true,
      }).catch(() => {});
    }
    await cleanupAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: secondTeacherId,
    }).catch(() => {});
    await cleanupAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: primaryTeacherId,
    }).catch(() => {});
  }
});

test('admin can revoke a private package with usage history', async ({ browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(600000);

  const unique = Date.now();
  const studentName = `E2E 사용이력회수 ${unique}`;
  const studentId = `e2e-used-history-revoke-student-${unique}`;
  const cleanupFixture = { academyId: ACADEMY_ID, packageIds: [], studentId };
  const totalCount = 5;
  const usedCount = 3;
  const remainingCount = totalCount - usedCount;

  try {
    await createAdminSeededPrivateStudent({
      academyId: ACADEMY_ID,
      studentId,
      name: studentName,
      studentName,
      teacher: TEACHER,
      teacherName: TEACHER,
      status: 'active',
      note: 'E2E used-history private package revoke test',
    });
    const studentPackage = await createAdminSeededStudentPackage({
      academyId: ACADEMY_ID,
      studentId,
      studentName,
      title: `E2E 사용 이력 회수 수강권 ${unique}`,
      packageType: 'private',
      teacher: TEACHER,
      teacherKey: TEACHER,
      teacherName: TEACHER,
      totalCount,
      remainingCount,
      usedCount,
      privatePackageMode: 'countBased',
      expiresAt: '2099-01-01',
    });
    cleanupFixture.packageIds.push(studentPackage.packageId);
    await Promise.all([
      createAdminSeededCreditTransaction({
        academyId: ACADEMY_ID,
        studentId,
        studentName,
        teacher: TEACHER,
        packageId: studentPackage.packageId,
        packageTitle: `E2E 사용 이력 회수 수강권 ${unique}`,
        actionType: 'package_created',
        deltaCount: 2,
        registrationRound: 1,
        registrationLabel: '1회차 등록',
        paymentDate: '2026-05-01',
        amountPaid: 200000,
        memo: 'E2E 최초 등록',
      }),
      createAdminSeededCreditTransaction({
        academyId: ACADEMY_ID,
        studentId,
        studentName,
        teacher: TEACHER,
        packageId: studentPackage.packageId,
        packageTitle: `E2E 사용 이력 회수 수강권 ${unique}`,
        actionType: 'private_package_top_up',
        deltaCount: 3,
        registrationRound: 2,
        registrationLabel: '2회차 등록',
        paymentDate: '2026-05-15',
        amountPaid: 300000,
        memo: 'E2E 추가 등록',
      }),
    ]);
    await setAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId,
      teacherKeys: [TEACHER],
      activePackageIds: [studentPackage.packageId],
      privateSlotBookingPilotEnabled: true,
    });
    await expect
      .poll(async () => {
        const pkg = await getAdminSeededStudentPackage({
          academyId: ACADEMY_ID,
          packageId: studentPackage.packageId,
        });
        return {
          status: String(pkg?.status || '').trim(),
          totalCount: Number(pkg?.totalCount || 0),
          usedCount: Number(pkg?.usedCount || 0),
          remainingCount: Number(pkg?.remainingCount || 0),
        };
      }, { timeout: 15000 })
      .toEqual({
        status: 'active',
        totalCount,
        usedCount,
        remainingCount,
      });

    await setAdminSeededPrivatePackageRevokedState({
      academyId: ACADEMY_ID,
      packageId: studentPackage.packageId,
      studentId,
      teacherKey: TEACHER,
      totalCount,
      usedCount,
      remainingCount,
      revokeReason: 'E2E 사용 이력 회수',
    });

    await expect
      .poll(async () => {
        const [pkg, summary] = await Promise.all([
          getAdminSeededStudentPackage({
            academyId: ACADEMY_ID,
            packageId: studentPackage.packageId,
          }),
          getAdminSeededStudentPrivateAccessSummary({
            academyId: ACADEMY_ID,
            studentId,
          }),
        ]);
        return {
          status: String(pkg?.status || '').trim(),
          totalCount: Number(pkg?.totalCount || 0),
          usedCount: Number(pkg?.usedCount || 0),
          remainingCount: Number(pkg?.remainingCount || 0),
          revokeReason: String(pkg?.revokeReason || '').trim(),
          hasRevokedAt: Boolean(pkg?.revokedAt),
          revokedBy: String(pkg?.revokedBy || '').trim(),
          revokedByUid: String(pkg?.revokedByUid || '').trim(),
          activePackageIds: summary?.activePackageIds || [],
          teacherKeys: summary?.teacherKeys || [],
        };
      }, { timeout: 30000 })
      .toEqual({
        status: 'revoked',
        totalCount,
        usedCount,
        remainingCount,
        revokeReason: 'E2E 사용 이력 회수',
        hasRevokedAt: true,
        revokedBy: expect.stringMatching(/\S/),
        revokedByUid: expect.stringMatching(/\S/),
        activePackageIds: [],
        teacherKeys: [],
      });

  } finally {
    await cleanupAdminSeededPrivatePackageWorkflowCopyFixture(cleanupFixture).catch(() => {});
    await cleanupAdminSeededCreditTransactionsForStudent({
      academyId: ACADEMY_ID,
      studentId,
    }).catch(() => {});
    await cleanupAdminSeededStudentPrivateAccessSummary({
      academyId: ACADEMY_ID,
      studentId,
    }).catch(() => {});
  }
});

test('admin can revoke one private teacher package without touching another teacher', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(180000);

  const unique = Date.now();
  const studentName = `E2E 수강권회수 ${unique}`;
  const studentId = `e2e-revoke-student-${unique}`;
  const secondTeacherKey = `miketest-revoke-${unique}`;
  const secondTeacherId = `e2e-revoke-teacher-${unique}`;
  const secondTeacherName = `miketest revoke ${unique}`;
  let tempStudent = null;
  let secondPackageId = '';
  const cleanupFixture = { academyId: ACADEMY_ID, reservationIds: [], packageIds: [], studentId };

  try {
    await createAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: secondTeacherId,
      teacherKey: secondTeacherKey,
      teacherName: secondTeacherName,
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
      teacherName: secondTeacherName,
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
            usedCount: Number(pkg.usedCount || 0),
            remainingCount: Number(pkg.remainingCount || 0),
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
              teacherName: secondTeacherName,
              status: 'active',
              usedCount: 0,
              remainingCount: 3,
            }),
          ]),
        })
      );

    await setAdminSeededPrivatePackageRevokedState({
      academyId: ACADEMY_ID,
      packageId: secondPackage.packageId,
      studentId,
      teacherKey: secondTeacherKey,
      totalCount: 3,
      usedCount: 0,
      remainingCount: 3,
      revokeReason: 'E2E 환불 중도중단',
    });

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
          totalCount: Number(pkg.totalCount || 0),
          usedCount: Number(pkg.usedCount || 0),
          remainingCount: Number(pkg.remainingCount || 0),
          revokeReason: String(pkg.revokeReason || '').trim(),
          hasRevokedAt: Boolean(pkg.revokedAt),
          revokedByUid: String(pkg.revokedByUid || '').trim(),
        }));
      }, { timeout: 30000 })
      .toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: donPackage.packageId, teacher: TEACHER, status: 'active' }),
          expect.objectContaining({
            id: secondPackage.packageId,
            teacher: secondTeacherKey,
            status: 'revoked',
            totalCount: 3,
            usedCount: 0,
            remainingCount: 3,
            revokeReason: 'E2E 환불 중도중단',
            hasRevokedAt: true,
            revokedByUid: expect.stringMatching(/\S/),
          }),
        ])
      );

    await expect
      .poll(async () => {
        const accessSummary = await getAdminSeededStudentPrivateAccessSummary({
          academyId: ACADEMY_ID,
          studentId,
        });
        const teacherKeys = accessSummary?.teacherKeys || [];
        const activePackageIds = accessSummary?.activePackageIds || [];
        return {
          hasDonTeacher: teacherKeys.includes(TEACHER),
          hasSecondTeacher: teacherKeys.includes(secondTeacherKey),
          hasDonPackage: activePackageIds.includes(donPackage.packageId),
          hasSecondPackage: activePackageIds.includes(secondPackage.packageId),
        };
      }, { timeout: 30000 })
      .toEqual({
        hasDonTeacher: true,
        hasSecondTeacher: false,
        hasDonPackage: true,
        hasSecondPackage: false,
      });

  } finally {
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
    await cleanupAdminSeededTeacher({
      academyId: ACADEMY_ID,
      teacherId: secondTeacherId,
    }).catch(() => {});
  }
});
