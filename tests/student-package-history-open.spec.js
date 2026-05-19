import { test, expect } from '@playwright/test';
import {
  getStudentRow,
  getStudentSearchInput,
  loginAsAdmin,
  openDashboardSection,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  TEST_GROUP_NAME,
  TEST_STUDENT_NAME,
} from './fixtures/test-data.js';
import {
  createAdminSeededPrivateLesson,
  createAdminSeededPrivateStudent,
  createAdminSeededStudentPackage,
} from './e2e-admin-helpers.js';
import {
  cleanupTempStudentData,
  createTempStudent,
  getGroupPackageStartDate,
  getStudentGroupAccessSummary,
} from './e2e-firebase-helpers.js';

function formatYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function getFirebaseConfigFromEnv() {
  return {
    apiKey: process.env.VITE_FIREBASE_API_KEY,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: process.env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: process.env.VITE_FIREBASE_APP_ID,
  };
}

async function ensureStudentGroupAccessSummary(page, { studentId }) {
  await page.evaluate(
    async ({ academyId, firebaseConfig, studentId }) => {
      const [{ getApp, getApps, initializeApp }, { getAuth, onAuthStateChanged }, firestore] =
        await Promise.all([
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js'),
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js'),
          import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js'),
        ]);

      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
      const auth = getAuth(app);
      if (!auth.currentUser) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Auth user not ready.')), 30000);
          const unsubscribe = onAuthStateChanged(auth, (user) => {
            if (!user) return;
            clearTimeout(timeout);
            unsubscribe();
            resolve();
          });
        });
      }

      const db = firestore.getFirestore(app);
      await firestore.setDoc(
        firestore.doc(db, 'studentGroupAccessSummary', `${academyId}__${studentId}`),
        {
          academyId,
          studentId,
          groupClassIds: [],
          createdAt: firestore.serverTimestamp(),
          updatedAt: firestore.serverTimestamp(),
        },
        { merge: true }
      );
    },
    {
      academyId: DEFAULT_E2E_ACADEMY_ID,
      firebaseConfig: getFirebaseConfigFromEnv(),
      studentId,
    }
  );
}

async function openStudentPackageHistory(page) {
  await openDashboardSection(page, '학생 관리');

  await searchStudent(page, TEST_STUDENT_NAME);

  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
  await expect(studentRow).toBeVisible();

  await studentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();

  const studentDetail = page
    .locator(
      `[data-testid="student-detail-panel"][data-student-name="${TEST_STUDENT_NAME}"]`
    )
    .first();
  await expect(studentDetail).toBeVisible();

  let historyButton = studentDetail.getByTestId('student-package-history-button').first();
  if ((await historyButton.count()) === 0) {
    const showAllButton = studentDetail.getByTestId('student-package-show-all-button');
    if ((await showAllButton.count()) > 0) {
      await showAllButton.click();
    }
    historyButton = studentDetail.getByTestId('student-package-history-button').first();
  }

  await expect(historyButton).toBeVisible();
  await historyButton.click();
}

async function searchStudent(page, studentName) {
  const studentSearchInput = getStudentSearchInput(page);
  try {
    await expect(studentSearchInput).toBeEditable({ timeout: 15000 });
    await studentSearchInput.fill(studentName, { timeout: 15000 });
  } catch (error) {
    const [bodyText, studentRows] = await Promise.all([
      page.locator('body').innerText().catch(() => ''),
      page
        .locator('[data-testid="student-row"]')
        .evaluateAll((rows) =>
          rows.map((rowEl) => ({
            studentName: rowEl.getAttribute('data-student-name') || '',
            text: rowEl.textContent || '',
          }))
        )
        .catch(() => []),
    ]);

    throw new Error(
      [
        `Student search input was not editable for query ${studentName}.`,
        `Visible student rows: ${JSON.stringify(studentRows.slice(0, 40))}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original error: ${error.message}`,
      ].join('\n')
    );
  }
}

test('관리자가 학생의 수강권 이력 모달을 열 수 있다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openStudentPackageHistory(page);

  const historyDialog = page.getByRole('dialog', { name: '수강권 이력' });
  await expect(historyDialog).toBeVisible();
  await expect(historyDialog.getByRole('heading', { name: '수강권 이력' })).toBeVisible();

  const historyRows = historyDialog.locator('text=메모:');
  const historyEmptyText = historyDialog.getByText('등록된 이력이 없습니다.', { exact: true });
  const historyMetaText = historyDialog.getByText('처리 역할:', { exact: false });

  await expect
    .poll(async () => {
      const rowCount = await historyRows.count();
      const hasEmptyText = await historyEmptyText.isVisible().catch(() => false);
      const hasMetaText = await historyMetaText.first().isVisible().catch(() => false);
      return rowCount > 0 || hasEmptyText || hasMetaText;
    })
    .toBe(true);
});

test('학생 관리 목록에 개인 수업 진행 요약이 표시된다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  await searchStudent(page, TEST_STUDENT_NAME);

  const studentRow = getStudentRow(page, TEST_STUDENT_NAME);
  await expect(studentRow).toBeVisible();

  const progress = studentRow.getByTestId('student-private-lesson-progress');
  await expect(progress).toContainText('총 8회');
  await expect(progress).toContainText(/지난 \d+회/);
  await expect(progress).toContainText(/예정 \d+회/);
});

test('학생 관리 목록에 개인 수강권 선생님과 잔여 횟수가 표시된다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const suffix = Date.now();
  const { studentId, studentName } = await createAdminSeededPrivateStudent({
    studentId: `e2e-private-package-teacher-student-${suffix}`,
    name: `E2E 개인수강권 ${suffix}`,
    teacher: 'assigned-teacher',
    paidLessons: 0,
    attendanceCount: 0,
  });

  await Promise.all([
    createAdminSeededStudentPackage({
      packageId: `e2e-private-package-don1-${suffix}`,
      studentId,
      studentName,
      title: 'E2E don1 개인 수강권',
      packageType: 'private',
      teacher: 'don1',
      totalCount: 3,
      usedCount: 0,
      remainingCount: 3,
      status: 'active',
    }),
    createAdminSeededStudentPackage({
      packageId: `e2e-private-package-jenny-${suffix}`,
      studentId,
      studentName,
      title: 'E2E jenny 개인 수강권',
      packageType: 'private',
      teacher: 'jenny',
      totalCount: 5,
      usedCount: 0,
      remainingCount: 5,
      status: 'active',
    }),
  ]);

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  await searchStudent(page, studentName);

  const studentRow = getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible();

  const privatePackageCell = studentRow.getByTestId('student-private-package-cell');
  await expect(privatePackageCell).toContainText('don1');
  await expect(privatePackageCell).toContainText('잔여 3회 / 총 3회 · 사용 0회');
  await expect(privatePackageCell).toContainText('jenny');
  await expect(privatePackageCell).toContainText('잔여 5회 / 총 5회 · 사용 0회');
});

test('수강권 문서가 없어도 학생 관리 목록에 개인 수업 진행 요약이 표시된다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');

  const suffix = Date.now();
  const teacher = `E2E Progress Teacher ${suffix}`;
  const { studentId, studentName } = await createAdminSeededPrivateStudent({
    studentId: `e2e-private-progress-student-${suffix}`,
    name: `E2E 개인진행 ${suffix}`,
    teacher,
    paidLessons: 8,
    attendanceCount: 0,
  });

  const today = new Date();
  const lessonDates = [
    formatYmd(addDays(today, -14)),
    formatYmd(addDays(today, -7)),
    formatYmd(addDays(today, 1)),
    formatYmd(addDays(today, 2)),
    formatYmd(addDays(today, 3)),
    formatYmd(addDays(today, 4)),
    formatYmd(addDays(today, 5)),
    formatYmd(addDays(today, 6)),
  ];

  await Promise.all(
    lessonDates.map((date, index) =>
      createAdminSeededPrivateLesson({
        lessonId: `e2e-private-progress-lesson-${suffix}-${index + 1}`,
        studentId,
        studentID: studentId,
        studentName,
        student: studentName,
        teacher,
        teacherName: teacher,
        date,
        time: '10:00',
        subject: `E2E 개인진행 ${index + 1}`,
        sessionNumber: index + 1,
      })
    )
  );

  await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
  await openDashboardSection(page, '학생 관리');

  await searchStudent(page, studentName);

  const studentRow = getStudentRow(page, studentName);
  await expect(studentRow).toBeVisible();

  const privatePackageCell = studentRow.getByTestId('student-private-package-cell');
  await expect(privatePackageCell).toContainText('총 8회');
  await expect(privatePackageCell).toContainText('지난 2회');
  await expect(privatePackageCell).toContainText('예정 6회');
  await expect(privatePackageCell).toContainText('개인 수강권 없음');
});

test('관리자가 프리토킹 그룹 수강권을 만들면 summary에 groupCourseTypes가 반영된다', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.setTimeout(90000);

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  const uniqueToken = Date.now();
  const tempStudentName = `E2E 코스타입수강권 ${uniqueToken}`;
  let tempStudent = null;

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    tempStudent = await createTempStudent(page, {
      studentName: tempStudentName,
      note: 'E2E temporary student for groupCourseType package projection',
    });
    await ensureStudentGroupAccessSummary(page, { studentId: tempStudent.studentId });

    await openDashboardSection(page, '학생 관리');
    await searchStudent(page, tempStudentName);
    const studentRow = getStudentRow(page, tempStudentName);
    await expect(studentRow).toBeVisible();
    await studentRow.getByRole('button', { name: '수강권 추가' }).click();

    const packageDialog = page.getByRole('dialog', { name: '학생 수강권 추가' });
    await expect(packageDialog).toBeVisible();
    await packageDialog.getByLabel('수강권 유형').selectOption('group');

    const groupSelect = packageDialog.getByLabel('그룹 수업');
    await expect.poll(async () => await groupSelect.locator('option').count()).toBeGreaterThan(1);
    const groupValue = await groupSelect.locator('option').evaluateAll((options, groupName) => {
      const matched = options.find((option) => option.textContent?.includes(String(groupName)));
      return matched?.getAttribute('value') || '';
    }, TEST_GROUP_NAME);
    expect(groupValue).not.toBe('');
    await groupSelect.selectOption(groupValue);
    await packageDialog.getByLabel('코스 유형').selectOption('free_talking');
    await packageDialog.getByLabel('시작일').fill(
      await getGroupPackageStartDate(page, { groupName: TEST_GROUP_NAME })
    );
    await packageDialog.getByLabel('등록 주수').fill('4');
    const saveButton = packageDialog.getByRole('button', { name: '저장', exact: true });
    await expect(saveButton).toBeEnabled();
    await saveButton.click();

    await expect
      .poll(async () => {
        const summary = await getStudentGroupAccessSummary(page, {
          studentId: tempStudent.studentId,
        }).catch(() => null);
        return Array.isArray(summary?.groupCourseTypes) ? summary.groupCourseTypes : [];
      }, { timeout: 30000 })
      .toContain('free_talking');

    const postEnrollDialog = page.getByRole('dialog', { name: '이 반에 바로 등록할까요?' });
    if (await postEnrollDialog.isVisible().catch(() => false)) {
      await postEnrollDialog.getByRole('button', { name: '나중에 등록' }).click();
      await expect(postEnrollDialog).toBeHidden();
    }

    if (await packageDialog.isVisible().catch(() => false)) {
      await packageDialog.getByRole('button', { name: '취소' }).click();
      await expect(packageDialog).toBeHidden();
    }

    await studentRow.getByRole('button', { name: '수강권 보기', exact: true }).click();
    const packageCard = page.locator('[data-testid="student-package-card"]').filter({
      hasText: '프리토킹',
    });
    await expect(packageCard.first()).toBeVisible();
  } finally {
    if (tempStudent) {
      await cleanupTempStudentData(page, tempStudent).catch(() => {});
    }
  }
});
