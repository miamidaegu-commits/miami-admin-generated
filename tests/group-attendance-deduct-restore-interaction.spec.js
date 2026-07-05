import { open, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
  clickGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  cleanupTempGroupAttendanceSetup,
  cleanupTempCalendarGroupLessonSetup,
  getTempGroupAttendanceState,
} from './e2e-firebase-helpers.js';
import {
  createAdminSeededCalendarGroupLessonSetup,
  createAdminSeededPrivateStudent,
  createAdminSeededTempGroupAttendanceSetup,
} from './e2e-admin-helpers.js';
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

class AttendanceActionDialogError extends Error {
  constructor(message) {
    super(`Attendance action opened an alert: ${message}`);
    this.dialogMessage = message;
  }
}

function createDialogCollector(page) {
  const messages = [];
  const handler = async (dialog) => {
    messages.push(dialog.message());
    await dialog.accept().catch(() => {});
  };

  page.on('dialog', handler);

  return {
    messages,
    stop: () => page.off('dialog', handler),
  };
}

function isQuotaExceededMessage(message) {
  return /quota|resource[-_ ]?exhausted|too many requests|할당량/i.test(
    String(message || '')
  );
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

async function expectAttendancePackageCounts(page, ids, expected) {
  await expect
    .poll(
      async () => {
        const state = await getTempGroupAttendanceState(page, {
          ...ids,
          strictLessonIdsOnly: true,
          firebaseTaskTimeoutMs: 10000,
        });
        return {
          usedCount: Number(state?.studentPackage?.usedCount ?? -1),
          remainingCount: Number(state?.studentPackage?.remainingCount ?? -1),
        };
      },
      { timeout: 20000 }
    )
    .toEqual(expected);
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
  const { timeout = 20000, dialogCollector = null, diagnostics = null } = options;
  const deadline = Date.now() + timeout;
  let lastState = null;

  while (Date.now() < deadline) {
    if (dialogCollector?.messages.length > 0) {
      throw new AttendanceActionDialogError(dialogCollector.messages.shift());
    }

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

async function clickAttendanceActionAndWait({
  actionName,
  getReadySnapshot,
  selectButton,
  waitForNextState,
}) {
  const maxAttempts = 2;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const snapshot = await getReadySnapshot();
    await selectButton(snapshot).click();

    try {
      return await waitForNextState();
    } catch (error) {
      if (
        error instanceof AttendanceActionDialogError &&
        isQuotaExceededMessage(error.dialogMessage) &&
        attempt < maxAttempts
      ) {
        await sleep(1000);
        continue;
      }

      throw new Error(
        `${actionName} failed after ${attempt} attempt(s): ${
          error?.dialogMessage || error?.message || String(error)
        }`
      );
    }
  }

  throw new Error(`${actionName} failed after ${maxAttempts} attempt(s).`);
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

async function closeAttendanceDialogBestEffort(attendanceDialog) {
  if (!attendanceDialog || !(await attendanceDialog.isVisible().catch(() => false))) return;
  await attendanceDialog
    .getByRole('button', { name: '닫기', exact: true })
    .click({ timeout: 5000 })
    .catch(() => {});
  await expect(attendanceDialog).toBeHidden({ timeout: 5000 }).catch(() => {});
}

async function cleanupBestEffort(label, cleanupTask) {
  try {
    await cleanupTask();
  } catch (error) {
    console.warn(`${label} cleanup skipped: ${error?.message || String(error)}`);
  }
}

const FIREBASE_ATTENDANCE_INTERACTION_LOCK_PATH = path.join(
  os.tmpdir(),
  'miami-e2e-group-attendance-deduct-restore-interaction.lock'
);

async function acquireFirebaseAttendanceInteractionLock() {
  const startedAt = Date.now();
  const timeoutMs = 120000;
  const staleAfterMs = 120000;

  while (true) {
    try {
      const handle = await open(FIREBASE_ATTENDANCE_INTERACTION_LOCK_PATH, 'wx');
      return async () => {
        await handle.close().catch(() => {});
        await unlink(FIREBASE_ATTENDANCE_INTERACTION_LOCK_PATH).catch(() => {});
      };
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        throw error;
      }

      const lockStats = await stat(FIREBASE_ATTENDANCE_INTERACTION_LOCK_PATH).catch(() => null);
      if (lockStats && Date.now() - lockStats.mtimeMs > staleAfterMs) {
        await unlink(FIREBASE_ATTENDANCE_INTERACTION_LOCK_PATH).catch(() => {});
        continue;
      }

      if (Date.now() - startedAt > timeoutMs) {
        throw new Error('Timed out waiting for the Firebase attendance interaction test lock.');
      }

      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
}

test.describe.configure({ mode: 'serial' });

test('관리자가 그룹 출결 모달에서 차감 버튼과 차감복구 버튼을 실제로 클릭해 전환할 수 있다', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.slow();
  test.setTimeout(180000);

  const todayYmd = getTodayInSeoul();
  const lessonDate = formatYmd(addDays(new Date(`${todayYmd}T00:00:00`), -2));
  const lessonTime = '22:35';
  const uniqueToken = `interaction${Date.now()}-w${testInfo.workerIndex}-r${testInfo.repeatEachIndex}`;
  const groupName = `000 E2E 출결상호작용반 ${uniqueToken}`;
  const lessonSubject = `E2E 출결상호작용 ${uniqueToken}`;
  const tempStudentName = `E2E 상호작용학생 ${uniqueToken}`;
  const tempPackageTitle = `E2E 출결상호작용 수강권 ${uniqueToken}`;
  const tempStudentId = `e2e-group-attendance-interaction-student-${uniqueToken}`;
  const tempGroupClassId = `e2e-group-attendance-interaction-class-${uniqueToken}`;
  const tempTargetLessonId = `e2e-group-attendance-interaction-lesson-${uniqueToken}`;
  const tempPackageId = `e2e-group-attendance-interaction-package-${uniqueToken}`;
  const tempGroupStudentId = `e2e-group-attendance-interaction-group-student-${uniqueToken}`;

  let releaseFirebaseAttendanceLock = null;
  let attendanceDialog = null;
  let dialogCollector = null;

  try {
    releaseFirebaseAttendanceLock = await acquireFirebaseAttendanceInteractionLock();

    await createAdminSeededPrivateStudent({
      studentId: tempStudentId,
      studentName: tempStudentName,
      name: tempStudentName,
      teacherName: '',
      note: 'E2E temporary student for group attendance interaction test',
    });

    await createAdminSeededCalendarGroupLessonSetup({
      groupClassId: tempGroupClassId,
      groupLessonId: tempTargetLessonId,
      groupName,
      teacherName: 'teacher',
      lessonDate,
      lessonTime,
      lessonSubject,
      skipPastAttendanceSync: true,
    });

    await createAdminSeededTempGroupAttendanceSetup({
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

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');
    dialogCollector = createDialogCollector(page);
    await openDashboardSection(page, '단체반 관리');
    const groupRow = await clickGroupRow(page, groupName);

    await expect(getRegisteredStudentsHeading(page, groupName)).toBeVisible();

    const lessonSection = page.getByTestId('group-lessons-section').locator('..');
    await expect(lessonSection).toBeVisible();

    const targetLessonRow = lessonSection.locator(
      `[data-testid="group-lesson-row"][data-lesson-id="${tempTargetLessonId}"]`
    );

    await expect(targetLessonRow).toHaveCount(1, { timeout: 10000 });

    attendanceDialog = await openAttendanceDialogForLesson(targetLessonRow, page);
    await expect(attendanceDialog.getByTestId('group-lesson-seat-summary')).toBeVisible();
    await expect(attendanceDialog.getByTestId('group-lesson-fixed-attending-count')).toContainText(
      '등록 참석 예정'
    );
    await expect(attendanceDialog.getByTestId('group-lesson-released-seat-count')).toContainText(
      '등록 결석/차감취소'
    );
    await expect(attendanceDialog.getByTestId('group-lesson-guest-reserved-count')).toContainText(
      '추가 예약'
    );
    await expect(attendanceDialog.getByTestId('group-lesson-remaining-seats')).toContainText(
      '남은 자리'
    );
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
    const attendanceIds = {
      groupClassId: tempGroupClassId,
      groupLessonId: tempTargetLessonId,
      studentId: tempStudentId,
      packageId: tempPackageId,
      groupStudentId: tempGroupStudentId,
    };
    let snapshot = await waitForAttendanceRowState(
      attendanceDialog,
      tempStudentName,
      tempPackageTitle,
      isDeductReady,
      { dialogCollector, diagnostics: attendanceDiagnostics }
    );
    await expect(snapshot.row.getByTestId('group-attendance-remaining-count')).toHaveText('8');
    await expectAttendancePackageCounts(
      page,
      attendanceIds,
      { usedCount: 0, remainingCount: 8 }
    );

    try {
      snapshot = await clickAttendanceActionAndWait({
        actionName: '차감',
        getReadySnapshot: () =>
          waitForAttendanceRowState(
            attendanceDialog,
            tempStudentName,
            tempPackageTitle,
            isDeductReady,
            { dialogCollector, diagnostics: attendanceDiagnostics }
          ),
        selectButton: (readySnapshot) => readySnapshot.deductButton,
        waitForNextState: () =>
          waitForAttendanceRowState(
            attendanceDialog,
            tempStudentName,
            tempPackageTitle,
            isRestoreReady,
            { timeout: 30000, dialogCollector, diagnostics: attendanceDiagnostics }
          ),
      });
      await expect(snapshot.row.getByTestId('group-attendance-remaining-count')).toHaveText('7');
      await expectAttendancePackageCounts(
        page,
        attendanceIds,
        { usedCount: 1, remainingCount: 7 }
      );

      snapshot = await clickAttendanceActionAndWait({
        actionName: '차감복구',
        getReadySnapshot: () =>
          waitForAttendanceRowState(
            attendanceDialog,
            tempStudentName,
            tempPackageTitle,
            isRestoreReady,
            { dialogCollector, diagnostics: attendanceDiagnostics }
          ),
        selectButton: (readySnapshot) => readySnapshot.restoreButton,
        waitForNextState: async () => {
          await expectAttendancePackageCounts(page, attendanceIds, { usedCount: 0, remainingCount: 8 });
          return waitForAttendanceRowState(
            attendanceDialog,
            tempStudentName,
            tempPackageTitle,
            (state) => state.rowCount === 1 && state.restoreVisible === false,
            { timeout: 30000, dialogCollector, diagnostics: attendanceDiagnostics }
          );
        },
      });

      await expect(snapshot.row.getByTestId('group-attendance-remaining-count')).toHaveText('8');
      await expectAttendancePackageCounts(
        page,
        attendanceIds,
        { usedCount: 0, remainingCount: 8 }
      );
    } catch (error) {
      test.skip(
        isQuotaExceededMessage(error?.message),
        `Firestore quota blocked the real attendance interaction path: ${
          error?.message || String(error)
        }`
      );
      throw error;
    }
  } finally {
    try {
      await closeAttendanceDialogBestEffort(attendanceDialog);

      await cleanupBestEffort('group attendance interaction setup', () =>
        cleanupTempGroupAttendanceSetup(page, {
          packageId: tempPackageId,
          groupStudentId: tempGroupStudentId,
          studentId: tempStudentId,
          groupClassId: tempGroupClassId,
          groupLessonId: tempTargetLessonId,
          strictLessonIdsOnly: true,
          firebaseTaskTimeoutMs: 15000,
        })
      );

      await cleanupBestEffort('calendar group lesson interaction setup', () =>
        cleanupTempCalendarGroupLessonSetup(page, {
          groupClassId: tempGroupClassId,
          groupLessonIds: [tempTargetLessonId],
          strictLessonIdsOnly: true,
          firebaseTaskTimeoutMs: 15000,
        })
      );
    } finally {
      if (dialogCollector) {
        dialogCollector.stop();
      }
      if (releaseFirebaseAttendanceLock) {
        await releaseFirebaseAttendanceLock();
      }
    }
  }
});
