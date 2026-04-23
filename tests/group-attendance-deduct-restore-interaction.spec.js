import { open, stat, unlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import {
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

async function getTodayInSeoul(page) {
  return page.evaluate(() =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Seoul',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  );
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
      deductCount > 0 ? await deductButton.isEnabled().catch(() => false) : false,
    restoreButton,
    restoreVisible: restoreCount > 0,
    restoreEnabled:
      restoreCount > 0 ? await restoreButton.isEnabled().catch(() => false) : false,
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
  const { timeout = 20000, dialogCollector = null } = options;
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

  throw new Error(
    `Timed out waiting for attendance row state. Last state: ${JSON.stringify(lastState)}`
  );
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

async function openAttendanceDialogForLesson(targetLessonRow, page) {
  const attendanceButton = targetLessonRow.first().getByRole('button', {
    name: '출결/차감',
    exact: true,
  });
  await expect(attendanceButton).toBeVisible();
  await attendanceButton.click();

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

  const todayYmd = await getTodayInSeoul(page);
  const lessonDate = formatYmd(addDays(new Date(`${todayYmd}T00:00:00`), -2));
  const lessonTime = '22:35';
  const uniqueToken = `interaction${Date.now()}-w${testInfo.workerIndex}-r${testInfo.repeatEachIndex}`;
  const groupName = `E2E 출결상호작용반 ${uniqueToken}`;
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

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    dialogCollector = createDialogCollector(page);

    await createTempStudent(page, {
      studentId: tempStudentId,
      studentName: tempStudentName,
      teacherName: '',
      note: 'E2E temporary student for group attendance interaction test',
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
    });

    await openDashboardSection(page, '반 관리');

    const groupRow = getGroupRow(page, groupName);
    await expect(groupRow).toBeVisible();
    await groupRow.click();

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
    let snapshot = await waitForAttendanceRowState(
      attendanceDialog,
      tempStudentName,
      tempPackageTitle,
      isDeductReady,
      { dialogCollector }
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
            { dialogCollector }
          ),
        selectButton: (readySnapshot) => readySnapshot.deductButton,
        waitForNextState: () =>
          waitForAttendanceRowState(
            attendanceDialog,
            tempStudentName,
            tempPackageTitle,
            isRestoreReady,
            { timeout: 30000, dialogCollector }
          ),
      });

      snapshot = await clickAttendanceActionAndWait({
        actionName: '차감복구',
        getReadySnapshot: () =>
          waitForAttendanceRowState(
            attendanceDialog,
            tempStudentName,
            tempPackageTitle,
            isRestoreReady,
            { dialogCollector }
          ),
        selectButton: (readySnapshot) => readySnapshot.restoreButton,
        waitForNextState: () =>
          waitForAttendanceRowState(
            attendanceDialog,
            tempStudentName,
            tempPackageTitle,
            isDeductReady,
            { timeout: 30000, dialogCollector }
          ),
      });

      expect(isDeductReady(snapshot)).toBe(true);
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
      if (attendanceDialog && (await attendanceDialog.isVisible().catch(() => false))) {
        await attendanceDialog.getByRole('button', { name: '닫기', exact: true }).click();
        await expect(attendanceDialog).toBeHidden();
      }

      await cleanupBestEffort('group attendance interaction setup', () =>
        cleanupTempGroupAttendanceSetup(page, {
          packageId: tempPackageId,
          groupStudentId: tempGroupStudentId,
          studentId: tempStudentId,
          groupLessonId: tempTargetLessonId,
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
