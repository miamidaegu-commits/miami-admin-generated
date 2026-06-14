import { open, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  clickGroupRow,
  getGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  cleanupTempGroupAttendanceSetup,
  cleanupTempCalendarGroupLessonSetup,
  createTempCalendarGroupLessonSetup,
  createTempStudent,
  createTempGroupAttendanceSetup,
  getTempGroupAttendanceState,
  setTempGroupAttendanceState,
} from './e2e-firebase-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
} from './fixtures/test-data.js';

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

function getTodayInSeoul() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAttendanceRowSnapshot(attendanceDialog, studentName, packageTitle) {
  const rows = attendanceDialog
    .locator('.table-row')
    .filter({ hasText: studentName })
    .filter({ hasText: packageTitle });
  const row = rows.first();

  const deductButton = row.getByRole('button', { name: '차감', exact: true });
  const restoreButton = row.getByRole('button', { name: '차감복구', exact: true });

  const [rowCount, deductCount, restoreCount] = await Promise.all([
    rows.count(),
    deductButton.count(),
    restoreButton.count(),
  ]);

  return {
    row,
    rowCount,
    deductButton,
    deductVisible: deductCount > 0,
    deductEnabled:
      deductCount > 0 ? await deductButton.isEnabled({ timeout: 1000 }).catch(() => false) : false,
    restoreButton,
    restoreVisible: restoreCount > 0,
    restoreEnabled:
      restoreCount > 0 ? await restoreButton.isEnabled({ timeout: 1000 }).catch(() => false) : false,
  };
}

function isDeductReady(snapshot) {
  return snapshot.rowCount === 1 && snapshot.deductVisible && snapshot.deductEnabled;
}

function isRestoreReady(snapshot) {
  return snapshot.rowCount === 1 && snapshot.restoreVisible && snapshot.restoreEnabled;
}

function toSerializableState(snapshot) {
  return {
    rowCount: snapshot.rowCount,
    deductVisible: snapshot.deductVisible,
    deductEnabled: snapshot.deductEnabled,
    restoreVisible: snapshot.restoreVisible,
    restoreEnabled: snapshot.restoreEnabled,
  };
}

async function waitForAttendanceRowState(
  attendanceDialog,
  studentName,
  packageTitle,
  predicate,
  options = {}
) {
  const { timeout = 15000, diagnostics = null } = options;
  const deadline = Date.now() + timeout;
  let lastState = null;

  while (Date.now() < deadline) {
    const snapshot = await getAttendanceRowSnapshot(
      attendanceDialog,
      studentName,
      packageTitle
    );
    lastState = toSerializableState(snapshot);

    if (predicate(lastState)) {
      return snapshot;
    }

    await sleep(250);
  }

  const diagnosticText = diagnostics
    ? await diagnostics().catch((error) => `Diagnostics unavailable: ${error?.message || String(error)}`)
    : '';
  throw new Error(
    [
      `Timed out waiting for attendance row state. Last state: ${JSON.stringify(lastState)}`,
      diagnosticText,
    ].filter(Boolean).join('\n')
  );
}

async function collectAttendanceDiagnostics({
  page,
  attendanceDialog,
  groupName,
  lessonDate,
  lessonTime,
  lessonSubject,
  groupClassId,
  groupLessonId,
  studentId,
  packageId,
  groupStudentId,
}) {
  const [visibleGroupRows, modalRowTexts, firestoreState] = await Promise.all([
    page
      .locator('[data-testid="group-row"]')
      .evaluateAll((rows) =>
        rows.slice(0, 40).map((row) => ({
          dataGroupName: row.getAttribute('data-group-name') || '',
          text: (row.textContent || '').trim(),
        }))
      )
      .catch((error) => ({ error: error?.message || String(error) })),
    attendanceDialog
      .locator('.table-row')
      .evaluateAll((rows) => rows.slice(0, 40).map((row) => (row.textContent || '').trim()))
      .catch((error) => ({ error: error?.message || String(error) })),
    getTempGroupAttendanceState(page, {
      groupClassId,
      groupLessonId,
      studentId,
      packageId,
      groupStudentId,
      strictLessonIdsOnly: true,
      firebaseTaskTimeoutMs: 10000,
    }).catch((error) => ({ error: error?.message || String(error) })),
  ]);

  return `Attendance diagnostics: ${JSON.stringify(
    {
      selectedGroupName: groupName,
      lesson: { date: lessonDate, time: lessonTime, subject: lessonSubject },
      visibleGroupRows,
      modalRowTexts,
      firestoreState,
    },
    null,
    2
  )}`;
}

async function setAttendanceStateAndWait({
  page,
  attendanceDialog,
  studentName,
  packageTitle,
  groupLessonId,
  studentId,
  packageId,
  groupStudentId,
  syncGuardStudentId,
  deducted,
  totalCount,
  expectedState,
  diagnostics,
}) {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await setTempGroupAttendanceState(page, {
        groupLessonId,
        studentId,
        packageId,
        groupStudentId,
        syncGuardStudentId,
        deducted,
        totalCount,
        firebaseTaskTimeoutMs: 10000,
      });
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      await sleep(1000);
    }
  }

  if (lastError) {
    throw lastError;
  }

  return waitForAttendanceRowState(
    attendanceDialog,
    studentName,
    packageTitle,
    expectedState,
    { timeout: 20000, diagnostics }
  );
}

async function expectAttendanceFixtureReady(page, ids) {
  await expect
    .poll(
      async () => {
        const state = await getTempGroupAttendanceState(page, {
          ...ids,
          strictLessonIdsOnly: true,
          firebaseTaskTimeoutMs: 10000,
        });
        return {
          groupClass: state?.groupClass?.exists === true,
          groupLesson: state?.groupLesson?.exists === true,
          studentPackage: state?.studentPackage?.exists === true,
          groupStudent: state?.groupStudent?.exists === true,
          privateStudent: state?.privateStudent?.exists === true,
        };
      },
      { timeout: 20000 }
    )
    .toEqual({
      groupClass: true,
      groupLesson: true,
      studentPackage: true,
      groupStudent: true,
      privateStudent: true,
    });
}

async function openAttendanceDialogForLesson(targetLessonRow, page) {
  const attendanceButton = targetLessonRow.first().getByRole('button', {
    name: '출결/차감',
    exact: true,
  });
  await expect(attendanceButton).toBeVisible();
  await expect(attendanceButton).toBeEnabled({ timeout: 15000 });
  await attendanceButton.dispatchEvent('click');

  const attendanceDialog = page.getByRole('dialog', { name: /출결\s*\/\s*차감/ });
  await expect(attendanceDialog).toBeVisible({ timeout: 15000 });
  return attendanceDialog;
}

async function cleanupBestEffort(label, cleanupTask) {
  try {
    await cleanupTask();
  } catch (error) {
    console.warn(`${label} cleanup skipped: ${error?.message || String(error)}`);
  }
}

const FIREBASE_ATTENDANCE_LOCK_PATH = path.join(
  os.tmpdir(),
  'miami-e2e-group-attendance-deduct-restore.lock'
);

async function acquireFirebaseAttendanceLock() {
  const startedAt = Date.now();
  const timeoutMs = 120000;
  const staleAfterMs = 120000;

  while (true) {
    try {
      const handle = await open(FIREBASE_ATTENDANCE_LOCK_PATH, 'wx');
      return async () => {
        await handle.close().catch(() => {});
        await unlink(FIREBASE_ATTENDANCE_LOCK_PATH).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const lockStats = await stat(FIREBASE_ATTENDANCE_LOCK_PATH).catch(() => null);
      if (lockStats && Date.now() - lockStats.mtimeMs > staleAfterMs) {
        await unlink(FIREBASE_ATTENDANCE_LOCK_PATH).catch(() => {});
        continue;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('Timed out waiting for the Firebase attendance test lock.');
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

test.describe.configure({ mode: 'serial' });

test('관리자가 그룹 출결 모달에서 backend 출결 상태 변경이 버튼 상태로 반영되는지 확인한다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.slow();
  test.setTimeout(180000);

  const todayYmd = getTodayInSeoul();
  const lessonDate = formatYmd(addDays(new Date(`${todayYmd}T00:00:00`), -2));
  const lessonTime = '22:35';
  const uniqueToken = `run${Date.now()}-w${testInfo.workerIndex}-r${testInfo.repeatEachIndex}`;
  const groupName = `000 E2E 그룹출결반 ${uniqueToken}`;
  const lessonSubject = `E2E 그룹출결 ${uniqueToken}`;
  const tempStudentName = `E2E 출결학생 ${uniqueToken}`;
  const tempPackageTitle = `E2E 그룹출결 수강권 ${uniqueToken}`;
  const tempStudentId = `e2e-group-attendance-student-${uniqueToken}`;
  const tempGroupClassId = `e2e-group-attendance-class-${uniqueToken}`;
  const tempTargetLessonId = `e2e-group-attendance-target-lesson-${uniqueToken}`;
  const tempPackageId = `e2e-group-attendance-package-${uniqueToken}`;
  const tempGroupStudentId = `e2e-group-attendance-group-student-${uniqueToken}`;
  const attendanceSyncGuardId = `__e2e_sync_guard_${tempTargetLessonId}`;

  let releaseFirebaseAttendanceLock = null;
  let attendanceDialog = null;

  try {
    releaseFirebaseAttendanceLock = await acquireFirebaseAttendanceLock();
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');
    await createTempStudent(page, {
      studentId: tempStudentId,
      studentName: tempStudentName,
      teacherName: '',
      note: 'E2E temporary student for group attendance deduct/restore test',
    });
    await createTempCalendarGroupLessonSetup(page, {
      groupClassId: tempGroupClassId,
      groupLessonId: tempTargetLessonId,
      groupName,
      teacherName: 'teacher',
      lessonDate,
      lessonTime,
      lessonSubject,
      skipPastAttendanceSync: true,
    });
    await createTempGroupAttendanceSetup(page, {
      groupClassId: tempGroupClassId,
      groupName,
      studentId: tempStudentId,
      studentName: tempStudentName,
      lessonDate,
      tempPackageTitle,
      packageId: tempPackageId,
      groupStudentId: tempGroupStudentId,
      totalCount: 8,
    });
    await expectAttendanceFixtureReady(page, {
      groupClassId: tempGroupClassId,
      groupLessonId: tempTargetLessonId,
      studentId: tempStudentId,
      packageId: tempPackageId,
      groupStudentId: tempGroupStudentId,
    });
    const groupRow = await clickGroupRow(page, groupName);
    await expect(getRegisteredStudentsHeading(page, groupName)).toBeVisible();

    const lessonSection = page.getByTestId('group-lessons-section').locator('..');
    await expect(lessonSection).toBeVisible();

    const targetLessonRow = lessonSection
      .locator('.table-row')
      .filter({ hasText: lessonDate })
      .filter({ hasText: lessonTime })
      .filter({ hasText: lessonSubject });

    await expect(targetLessonRow).toHaveCount(1, { timeout: 10000 });
    attendanceDialog = await openAttendanceDialogForLesson(targetLessonRow, page);
    const attendanceDiagnostics = () =>
      collectAttendanceDiagnostics({
        page,
        attendanceDialog,
        groupName,
        lessonDate,
        lessonTime,
        lessonSubject,
        groupClassId: tempGroupClassId,
        groupLessonId: tempTargetLessonId,
        studentId: tempStudentId,
        packageId: tempPackageId,
        groupStudentId: tempGroupStudentId,
      });
    let snapshot = await waitForAttendanceRowState(
      attendanceDialog,
      tempStudentName,
      tempPackageTitle,
      isDeductReady,
      { timeout: 20000, diagnostics: attendanceDiagnostics }
    );

    expect(isDeductReady(snapshot)).toBe(true);
    await expect(snapshot.row.getByTestId('group-attendance-remaining-count')).toHaveText('8');
    snapshot = await setAttendanceStateAndWait({
      page,
      attendanceDialog,
      studentName: tempStudentName,
      packageTitle: tempPackageTitle,
      groupLessonId: tempTargetLessonId,
      studentId: tempStudentId,
      packageId: tempPackageId,
      groupStudentId: tempGroupStudentId,
      syncGuardStudentId: attendanceSyncGuardId,
      deducted: true,
      totalCount: 8,
      expectedState: isRestoreReady,
      diagnostics: attendanceDiagnostics,
    });

    expect(isRestoreReady(snapshot)).toBe(true);
    await expect(snapshot.row.getByTestId('group-attendance-remaining-count')).toHaveText('7');
    snapshot = await setAttendanceStateAndWait({
      page,
      attendanceDialog,
      studentName: tempStudentName,
      packageTitle: tempPackageTitle,
      groupLessonId: tempTargetLessonId,
      studentId: tempStudentId,
      packageId: tempPackageId,
      groupStudentId: tempGroupStudentId,
      syncGuardStudentId: attendanceSyncGuardId,
      deducted: false,
      totalCount: 8,
      expectedState: isDeductReady,
      diagnostics: attendanceDiagnostics,
    });

    expect(isDeductReady(snapshot)).toBe(true);
    await expect(snapshot.row.getByTestId('group-attendance-remaining-count')).toHaveText('8');
  } finally {
    try {
      if (attendanceDialog && (await attendanceDialog.isVisible().catch(() => false))) {
        await attendanceDialog.getByRole('button', { name: '닫기', exact: true }).click();
        await expect(attendanceDialog).toBeHidden();
      }

      await cleanupBestEffort('group attendance setup', () =>
        cleanupTempGroupAttendanceSetup(page, {
          packageId: tempPackageId,
          groupStudentId: tempGroupStudentId,
          studentId: tempStudentId,
          groupClassId: tempGroupClassId,
          groupLessonId: tempTargetLessonId,
          strictLessonIdsOnly: true,
          skipCreditTransactionCleanup: true,
          firebaseTaskTimeoutMs: 7000,
        })
      );

      await cleanupBestEffort('calendar group lesson setup', () =>
        cleanupTempCalendarGroupLessonSetup(page, {
          groupClassId: tempGroupClassId,
          groupLessonIds: [tempTargetLessonId],
          strictLessonIdsOnly: true,
          firebaseTaskTimeoutMs: 7000,
        })
      );
    } finally {
      if (releaseFirebaseAttendanceLock) {
        await releaseFirebaseAttendanceLock();
      }
    }
  }
});
