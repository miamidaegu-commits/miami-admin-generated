import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import {
  clickGroupRow,
  getGroupRow,
  getRegisteredStudentsHeading,
  loginAsAdmin,
  openDashboardSection,
  selectTeacherOption,
} from './e2e-helpers.js';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
  DEFAULT_E2E_ACADEMY_NAME,
  TEST_TEACHER_EMAIL,
} from './fixtures/test-data.js';

const require = createRequire(import.meta.url);
const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const TEACHER_NAME = 'teacher';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  if (admin.apps.find((app) => app?.name === '[DEFAULT]')) return;
  const serviceAccount = require(SERVICE_ACCOUNT_PATH);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

async function readDoc(ref) {
  const snap = await ref.get();
  return snap.exists ? snap.data() : null;
}

async function restoreDoc(ref, data) {
  if (data) {
    await ref.set(data);
  } else {
    await ref.delete().catch(() => {});
  }
}

function getLessonRowById(page, lessonId) {
  return page
    .locator(`[data-testid="group-lesson-row"][data-lesson-id="${lessonId}"]`)
    .first();
}

async function getGroupClassDebugSnapshot(db, groupName, groupClassId) {
  if (groupClassId) {
    const snap = await db.collection('groupClasses').doc(groupClassId).get();
    if (snap.exists) {
      const data = snap.data() || {};
      return {
        id: snap.id,
        academyId: data.academyId || null,
        name: data.name || null,
        teacher: data.teacher || null,
        teacherName: data.teacherName || null,
        groupCourseType: data.groupCourseType || null,
      };
    }
  }

  const snap = await db
    .collection('groupClasses')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('name', '==', groupName)
    .limit(1)
    .get();
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    academyId: data.academyId || null,
    name: data.name || null,
    teacher: data.teacher || null,
    teacherName: data.teacherName || null,
    groupCourseType: data.groupCourseType || null,
  };
}

async function expectGroupRowCourseType(page, db, groupName, groupClassId) {
  const row = getGroupRow(page, groupName);
  try {
    await expect(row).toContainText('프리토킹', { timeout: 15000 });
  } catch (error) {
    const [groupDoc, visibleRows, bodyText] = await Promise.all([
      getGroupClassDebugSnapshot(db, groupName, groupClassId).catch((snapshotError) => ({
        error: snapshotError?.message || String(snapshotError),
      })),
      page
        .locator('[data-testid="group-row"]')
        .evaluateAll((rows) =>
          rows.map((rowEl) => ({
            dataGroupName: rowEl.getAttribute('data-group-name') || '',
            text: rowEl.textContent || '',
          }))
        )
        .catch(() => []),
      page.locator('body').innerText().catch(() => ''),
    ]);

    throw new Error(
      [
        `Group row was not visible for ${groupName}.`,
        `Firestore groupClasses snapshot: ${JSON.stringify(groupDoc)}`,
        `Visible group rows: ${JSON.stringify(visibleRows.slice(0, 40))}`,
        'Visible page text:',
        bodyText.slice(0, 1500),
        '',
        `Original assertion: ${error.message}`,
      ].join('\n')
    );
  }
}

function formatLocalYmd(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function nextWeekdayYmd(targetDay) {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  while (date.getDay() !== targetDay) {
    date.setDate(date.getDate() + 1);
  }
  return formatLocalYmd(date);
}

function firstWeekdayOnOrAfterYmd(startYmd, targetDay) {
  const date = new Date(`${startYmd}T00:00:00`);
  while (date.getDay() !== targetDay) {
    date.setDate(date.getDate() + 1);
  }
  return formatLocalYmd(date);
}

async function deleteGroupClassLessons(db, groupClassId) {
  if (!groupClassId) return;
  const snap = await db
    .collection('groupLessons')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('groupClassId', '==', groupClassId)
    .get();
  await Promise.all(snap.docs.map((docSnap) => docSnap.ref.delete().catch(() => {})));
}

async function openReservationAdd(row) {
  await row.getByTestId('group-lesson-reserve-add-button').click();
  return row.page().getByTestId('group-reservation-modal');
}

async function openReservationView(row) {
  await row.getByTestId('group-lesson-reserve-view-button').click();
  return row.page().getByTestId('group-reservation-modal');
}

async function reopenGroupLessonRow(page, groupName, lessonId) {
  await openDashboardSection(page, '단체반 관리');
  await clickGroupRow(page, groupName);
  await expect(getRegisteredStudentsHeading(page, groupName)).toBeVisible({ timeout: 15000 });
  const row = getLessonRowById(page, lessonId);
  await expect(row).toBeVisible({ timeout: 15000 });
  return row;
}

async function closeReservationModal(modal) {
  await modal.getByRole('button', { name: '닫기', exact: true }).click();
  await expect(modal).toBeHidden();
}

async function clickExpectingNoDialog(page, locator) {
  const dialogPromise = page
    .waitForEvent('dialog', { timeout: 5000 })
    .then(async (dialog) => {
      const message = dialog.message();
      await dialog.accept();
      throw new Error(`Unexpected dialog while reserving group lesson: ${message}`);
    })
    .catch((error) => {
      if (/Timeout/.test(String(error?.message || ''))) return null;
      throw error;
    });

  await locator.click();
  await dialogPromise;
}

test('admin can create a group class when start date differs from selected weekdays', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 group course type setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  const groupName = `E2E 프리토킹반 ${Date.now()}-${testInfo.workerIndex}`;
  const startYmd = nextWeekdayYmd(1);
  const firstTuesdayYmd = firstWeekdayOnOrAfterYmd(startYmd, 2);
  const firstThursdayYmd = firstWeekdayOnOrAfterYmd(startYmd, 4);
  let groupClassId = '';

  page.on('dialog', async (dialog) => {
    await dialog.accept();
  });

  try {
    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');
    await page.getByRole('button', { name: '정규반 만들기' }).click();

    const dialog = page.getByRole('dialog', { name: '정규반 만들기' });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel('반 이름').fill(groupName);
    await selectTeacherOption(dialog.getByLabel('담당 선생님'), TEACHER_NAME);
    await dialog.getByLabel('정원 (명)').fill('4');
    await dialog.getByLabel('수업 시작일 (자동 일정 기준)').fill(startYmd);
    await dialog.getByLabel('기본 시간 (HH:mm)').fill('15:00');
    await dialog.getByLabel('과목').fill('테스트과목');
    await dialog.getByLabel('코스 유형').selectOption('free_talking');
    await dialog.getByRole('button', { name: '화', exact: true }).click();
    await dialog.getByRole('button', { name: '목', exact: true }).click();
    await dialog.getByRole('button', { name: '저장' }).click();

    await expect
      .poll(async () => {
        const snap = await db
          .collection('groupClasses')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('name', '==', groupName)
          .limit(1)
          .get();
        const createdGroup = snap.docs[0];
        if (!createdGroup) return '';
        groupClassId = createdGroup.id;
        return createdGroup.data().groupCourseType === 'free_talking' ? createdGroup.id : '';
      }, { timeout: 60000 })
      .not.toBe('');

    await expect
      .poll(async () => {
        const snap = await db
          .collection('groupLessons')
          .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
          .where('groupClassId', '==', groupClassId)
          .get();
        const lessons = snap.docs.map((docSnap) => docSnap.data() || {});
        const matchingDates = lessons
          .filter(
            (lesson) =>
              lesson.groupCourseType === 'free_talking' &&
              lesson.subject === '테스트과목' &&
              lesson.time === '15:00'
          )
          .map((lesson) => lesson.date)
          .sort();
        const generatedWeekdays = new Set(
          matchingDates.map((date) => new Date(`${date}T00:00:00`).getDay())
        );
        return {
          hasFirstTuesday: matchingDates.includes(firstTuesdayYmd),
          hasFirstThursday: matchingDates.includes(firstThursdayYmd),
          weekdays: Array.from(generatedWeekdays).sort(),
        };
      }, { timeout: 90000 })
      .toEqual({
        hasFirstTuesday: true,
        hasFirstThursday: true,
        weekdays: [2, 4],
      });

    await expect(dialog)
      .toBeHidden({ timeout: 90000 })
      .catch(async () => {});

    if (await dialog.isVisible().catch(() => false)) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const groupSectionButton = page.getByRole('button', { name: '단체반 관리', exact: true });
      await expect(groupSectionButton)
        .toBeVisible({ timeout: 5000 })
        .catch(async () => {
          await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
        });
      await openDashboardSection(page, '단체반 관리');
    }

    await expectGroupRowCourseType(page, db, groupName, groupClassId);
  } finally {
    await deleteGroupClassLessons(db, groupClassId).catch(() => {});
    if (groupClassId) {
      await db.collection('groupClasses').doc(groupClassId).delete().catch(() => {});
    }
  }
});

test('admin closing a group class cancels future lessons and preserves past lessons', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 group closure setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const groupClassId = `e2e-close-group-class-${unique}`;
  const groupName = `E2E 종료반 ${unique}`;
  const futureSubject = `Close Future ${unique}`;
  const pastSubject = `Close Past ${unique}`;
  const futureLessonId = `e2e-close-future-lesson-${unique}`;
  const pastLessonId = `e2e-close-past-lesson-${unique}`;
  const futureYmd = nextWeekdayYmd(1);
  const pastYmd = '2000-01-03';
  const dialogMessages = [];

  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  try {
    await Promise.all([
      db.collection('groupClasses').doc(groupClassId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: groupName,
        teacher: TEACHER_NAME,
        teacherName: TEACHER_NAME,
        maxStudents: 4,
        time: '15:00',
        subject: '종료 테스트',
        groupCourseType: 'free_talking',
        weekdays: ['월'],
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupLessons').doc(futureLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId,
        groupClassName: groupName,
        teacher: TEACHER_NAME,
        date: futureYmd,
        time: '15:00',
        subject: futureSubject,
        capacity: 4,
        bookedCount: 0,
        isBookable: true,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
      db.collection('groupLessons').doc(pastLessonId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        groupClassId,
        groupClassName: groupName,
        teacher: TEACHER_NAME,
        date: pastYmd,
        time: '15:00',
        subject: pastSubject,
        capacity: 4,
        bookedCount: 0,
        isBookable: true,
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');

    const groupRow = getGroupRow(page, groupName);
    await expect(groupRow).toBeVisible({ timeout: 15000 });
    await groupRow.click();
    const futureLessonRow = getLessonRowById(page, futureLessonId);
    await expect(futureLessonRow).toBeVisible({ timeout: 15000 });

    await groupRow.getByRole('button', { name: '반 운영 종료', exact: true }).click();
    const modal = page.getByTestId('group-closure-modal');
    await expect(modal).toBeVisible();
    await modal.getByLabel('종료 기준일').fill(futureYmd);
    await modal.getByLabel('종료 사유').fill('E2E 운영 종료');
    await modal.getByRole('button', { name: '운영 종료', exact: true }).click();

    await expect
      .poll(async () => {
        const snap = await db.collection('groupClasses').doc(groupClassId).get();
        const data = snap.data() || {};
        return {
          exists: snap.exists,
          status: data.status || '',
          closedFromDate: data.closedFromDate || '',
          closedReason: data.closedReason || '',
        };
      }, { timeout: 15000 })
      .toEqual({
        exists: true,
        status: 'closed',
        closedFromDate: futureYmd,
        closedReason: 'E2E 운영 종료',
      });
    await expect
      .poll(async () => {
        const snap = await db.collection('groupLessons').doc(futureLessonId).get();
        const data = snap.data() || {};
        return {
          exists: snap.exists,
          status: data.status || '',
          groupClassDeleted: data.groupClassDeleted === true,
          cancellationType: data.cancellationType || '',
          cancelledReason: data.cancelledReason || '',
          noDeduction: data.noDeduction === true,
        };
      }, { timeout: 15000 })
      .toEqual({
        exists: true,
        status: 'cancelled',
        groupClassDeleted: true,
        cancellationType: 'class_closure',
        cancelledReason: 'group_class_closed',
        noDeduction: true,
      });
    await expect(groupRow).toBeVisible({ timeout: 15000 });
    if ((await futureLessonRow.count()) > 0) {
      await expect(futureLessonRow).toContainText('휴강', { timeout: 15000 });
      await expect(futureLessonRow).toContainText('차감 없음');
      await expect(futureLessonRow.getByTestId('group-lesson-reserve-add-button')).toBeDisabled();
    }
    await expect
      .poll(async () => {
        const snap = await db.collection('groupLessons').doc(pastLessonId).get();
        const data = snap.data() || {};
        return {
          exists: snap.exists,
          status: data.status || '',
          groupClassDeleted: data.groupClassDeleted === true,
        };
      }, { timeout: 15000 })
      .toEqual({
        exists: true,
        status: '',
        groupClassDeleted: false,
      });
    if (dialogMessages.length > 0) {
      expect(dialogMessages.join('\n')).toContain('과거 수업 기록은 유지됩니다.');
      expect(dialogMessages.join('\n')).toContain('선택한 날짜 이후 예정 수업 1건을 취소했습니다.');
    }
  } finally {
    await Promise.all([
      db.collection('groupLessons').doc(futureLessonId).delete().catch(() => {}),
      db.collection('groupLessons').doc(pastLessonId).delete().catch(() => {}),
      db.collection('groupClasses').doc(groupClassId).delete().catch(() => {}),
    ]);
  }
});

function reservationId({ lessonId, studentId }) {
  return `${DEFAULT_E2E_ACADEMY_ID}__${lessonId}__${studentId}`;
}

async function createBookingFixture(unique) {
  initializeAdmin();
  const db = admin.firestore();
  const nowTs = admin.firestore.Timestamp.now();
  const adminUser = await admin.auth().getUserByEmail(ADMIN_EMAIL);
  const teacherUser = await admin.auth().getUserByEmail(TEST_TEACHER_EMAIL);
  const groupClassId = `e2e-booking-group-${unique}`;
  const firstStudentId = `e2e-booking-student-a-${unique}`;
  const secondStudentId = `e2e-booking-student-b-${unique}`;
  const mismatchStudentId = `e2e-booking-student-mismatch-${unique}`;
  const firstPackageId = `e2e-booking-package-a-${unique}`;
  const secondPackageId = `e2e-booking-package-b-${unique}`;
  const groupName = `E2E 예약반 ${unique}`;
  const firstStudentName = `예약학생 A ${unique}`;
  const secondStudentName = `예약학생 B ${unique}`;
  const mismatchStudentName = `타학원 학생 ${unique}`;
  const bookableLessonId = `e2e-booking-bookable-${unique}`;
  const fullLessonId = `e2e-booking-full-${unique}`;
  const nonBookableLessonId = `e2e-booking-closed-${unique}`;
  const academyRef = db.collection('academies').doc(DEFAULT_E2E_ACADEMY_ID);
  const adminRef = db.collection('users').doc(adminUser.uid);
  const teacherRef = db.collection('users').doc(teacherUser.uid);
  const adminMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${adminUser.uid}`);
  const teacherMembershipRef = db
    .collection('academyMemberships')
    .doc(`${DEFAULT_E2E_ACADEMY_ID}_${teacherUser.uid}`);
  const groupRef = db.collection('groupClasses').doc(groupClassId);
  const permissionDefaults = {
    canAddStudent: true,
    canEditStudent: true,
    canDeleteStudent: true,
    canManageAttendance: true,
    canEditLesson: true,
    canDeleteLesson: true,
    canCreateLessonDirectly: true,
    requiresLessonApproval: false,
  };

  const originals = {
    admin: await readDoc(adminRef),
    teacher: await readDoc(teacherRef),
    adminMembership: await readDoc(adminMembershipRef),
    teacherMembership: await readDoc(teacherMembershipRef),
  };

  await Promise.all([
    academyRef.set(
      {
        id: DEFAULT_E2E_ACADEMY_ID,
        name: DEFAULT_E2E_ACADEMY_NAME,
        slug: DEFAULT_E2E_ACADEMY_ID,
        status: 'active',
        timezone: 'Asia/Seoul',
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    adminRef.set(
      {
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'admin',
        isActive: true,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    teacherRef.set(
      {
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        displayName: 'Teacher E2E',
        role: 'teacher',
        isActive: true,
        teacherName: TEACHER_NAME,
        lastSelectedAcademyId: DEFAULT_E2E_ACADEMY_ID,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    adminMembershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: adminUser.uid,
        email: ADMIN_EMAIL,
        role: 'owner',
        status: 'active',
        teacherName: '',
        displayName: 'Admin E2E',
        permissions: permissionDefaults,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
    teacherMembershipRef.set(
      {
        academyId: DEFAULT_E2E_ACADEMY_ID,
        uid: teacherUser.uid,
        email: TEST_TEACHER_EMAIL,
        role: 'teacher',
        status: 'active',
        teacherName: TEACHER_NAME,
        displayName: 'Teacher E2E',
        permissions: permissionDefaults,
        updatedAt: nowTs,
      },
      { merge: true }
    ),
  ]);

  await groupRef.set({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    name: groupName,
    teacher: TEACHER_NAME,
    teacherName: TEACHER_NAME,
    maxStudents: 2,
    time: '10:00',
    subject: 'Booking',
    weekdays: ['월'],
    createdAt: nowTs,
    updatedAt: nowTs,
  });

  await Promise.all([
    db.collection('privateStudents').doc(firstStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: firstStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(secondStudentId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      name: secondStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('privateStudents').doc(mismatchStudentId).set({
      academyId: 'academy_e2e_other',
      name: mismatchStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(firstPackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: firstStudentId,
      studentName: firstStudentName,
      title: `E2E 단체 수강권 A ${unique}`,
      packageType: 'group',
      groupClassId,
      groupClassIds: [groupClassId],
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('studentPackages').doc(secondPackageId).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      studentId: secondStudentId,
      studentName: secondStudentName,
      title: `E2E 단체 수강권 B ${unique}`,
      packageType: 'group',
      groupClassId,
      groupClassIds: [groupClassId],
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      status: 'active',
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  await Promise.all([
    db.collection('groupStudents').doc(`e2e-booking-gs-a-${unique}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId,
      classID: groupClassId,
      studentId: firstStudentId,
      studentName: firstStudentName,
      name: firstStudentName,
      teacher: TEACHER_NAME,
      packageId: firstPackageId,
      packageType: 'group',
      status: 'active',
      studentStatus: 'active',
      attendanceCount: 0,
      startDate: admin.firestore.Timestamp.fromDate(new Date('2100-01-01T00:00:00')),
      excludedDates: [],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupStudents').doc(`e2e-booking-gs-b-${unique}`).set({
      academyId: DEFAULT_E2E_ACADEMY_ID,
      groupClassId,
      classID: groupClassId,
      studentId: secondStudentId,
      studentName: secondStudentName,
      name: secondStudentName,
      teacher: TEACHER_NAME,
      packageId: secondPackageId,
      packageType: 'group',
      status: 'active',
      studentStatus: 'active',
      attendanceCount: 0,
      startDate: admin.firestore.Timestamp.fromDate(new Date('2100-01-01T00:00:00')),
      excludedDates: [],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
    db.collection('groupStudents').doc(`e2e-booking-gs-mismatch-${unique}`).set({
      academyId: 'academy_e2e_other',
      groupClassId,
      classID: groupClassId,
      studentId: mismatchStudentId,
      studentName: mismatchStudentName,
      name: mismatchStudentName,
      teacher: TEACHER_NAME,
      status: 'active',
      studentStatus: 'active',
      attendanceCount: 0,
      startDate: admin.firestore.Timestamp.fromDate(new Date('2100-01-01T00:00:00')),
      excludedDates: [],
      createdAt: nowTs,
      updatedAt: nowTs,
    }),
  ]);

  const baseLesson = {
    academyId: DEFAULT_E2E_ACADEMY_ID,
    groupClassId,
    groupClassID: groupClassId,
    groupClassName: groupName,
    teacher: TEACHER_NAME,
    teacherName: TEACHER_NAME,
    completed: false,
    countedStudentIDs: [],
    attendanceAppliedAt: null,
    bookingMode: 'fixed',
    generationKind: 'manual',
    createdAt: nowTs,
    updatedAt: nowTs,
  };

  await Promise.all([
    db.collection('groupLessons').doc(bookableLessonId).set({
      ...baseLesson,
      date: '2099-01-05',
      time: '10:00',
      subject: 'Bookable',
      capacity: 2,
      bookedCount: 0,
      isBookable: true,
    }),
    db.collection('groupLessons').doc(fullLessonId).set({
      ...baseLesson,
      date: '2099-01-06',
      time: '10:00',
      subject: 'Full',
      capacity: 1,
      bookedCount: 0,
      isBookable: true,
    }),
    db.collection('groupLessons').doc(nonBookableLessonId).set({
      ...baseLesson,
      date: '2099-01-07',
      time: '10:00',
      subject: 'Closed',
      capacity: 2,
      bookedCount: 0,
      isBookable: false,
    }),
  ]);

  return {
    originals,
    refs: {
      adminRef,
      teacherRef,
      adminMembershipRef,
      teacherMembershipRef,
    },
    groupClassId,
    groupName,
    firstStudentId,
    secondStudentId,
    firstPackageId,
    secondPackageId,
    mismatchStudentName,
    firstStudentName,
    secondStudentName,
    bookableLessonId,
    fullLessonId,
    nonBookableLessonId,
  };
}

async function cleanupBookingFixture(setup) {
  if (!setup) return;
  initializeAdmin();
  const db = admin.firestore();
  const refs = [
    db.collection('groupClasses').doc(setup.groupClassId),
    db.collection('privateStudents').doc(setup.firstStudentId),
    db.collection('privateStudents').doc(setup.secondStudentId),
    db.collection('studentPackages').doc(setup.firstPackageId),
    db.collection('studentPackages').doc(setup.secondPackageId),
    db.collection('privateStudents').doc(`e2e-booking-student-mismatch-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupStudents').doc(`e2e-booking-gs-a-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupStudents').doc(`e2e-booking-gs-b-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupStudents').doc(`e2e-booking-gs-mismatch-${setup.groupClassId.replace('e2e-booking-group-', '')}`),
    db.collection('groupLessons').doc(setup.bookableLessonId),
    db.collection('groupLessons').doc(setup.fullLessonId),
    db.collection('groupLessons').doc(setup.nonBookableLessonId),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: setup.bookableLessonId, studentId: setup.firstStudentId })
    ),
    db.collection('groupLessonReservations').doc(
      reservationId({ lessonId: setup.fullLessonId, studentId: setup.firstStudentId })
    ),
  ];

  await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  await Promise.all([
    restoreDoc(setup.refs.adminRef, setup.originals.admin),
    restoreDoc(setup.refs.teacherRef, setup.originals.teacher),
    restoreDoc(setup.refs.adminMembershipRef, setup.originals.adminMembership),
    restoreDoc(setup.refs.teacherMembershipRef, setup.originals.teacherMembership),
  ]);
}

async function expectLessonBookedCount(db, lessonId, expected) {
  await expect
    .poll(async () => {
      const snap = await db.collection('groupLessons').doc(lessonId).get();
      return snap.data()?.bookedCount;
    }, { timeout: 15000 })
    .toBe(expected);
}

async function expectNoDeductionLessonState(db, lessonId) {
  await expect
    .poll(async () => {
      const snap = await db.collection('groupLessons').doc(lessonId).get();
      const data = snap.data() || {};
      return {
        status: data.status || '',
        cancellationType: data.cancellationType || '',
        cancelledReason: data.cancelledReason || '',
        noDeduction: data.noDeduction === true,
      };
    }, { timeout: 15000 })
    .toEqual({
      status: 'cancelled',
      cancellationType: 'no_deduction',
      cancelledReason: 'teacher_unavailable',
      noDeduction: true,
    });
}

async function expectReservationStatus(db, lessonId, studentId, expected) {
  await expect
    .poll(async () => {
      const snap = await db
        .collection('groupLessonReservations')
        .doc(reservationId({ lessonId, studentId }))
        .get();
      return snap.data()?.status || '';
    }, { timeout: 15000 })
    .toBe(expected);
}

test('admin can mark one group lesson as no-deduction cancelled', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 booking setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  let setup = null;
  const dialogMessages = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  try {
    const unique = `${Date.now()}-${testInfo.workerIndex}`;
    setup = await createBookingFixture(unique);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');

    const groupRow = await clickGroupRow(page, setup.groupName);
    await expect(getRegisteredStudentsHeading(page, setup.groupName)).toBeVisible();

    const bookableRow = page
      .locator(`[data-testid="group-lesson-row"][data-lesson-id="${setup.bookableLessonId}"]`)
      .first();
    await expect(bookableRow).toBeVisible({ timeout: 15000 });
    const reservationModal = await openReservationAdd(bookableRow);
    await clickExpectingNoDialog(
      page,
      reservationModal
        .getByTestId('group-reservation-candidate-row')
        .filter({ hasText: setup.firstStudentName })
        .getByRole('button', { name: '예약', exact: true })
    );
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'active');
    await closeReservationModal(reservationModal);

    await bookableRow.getByRole('button', { name: '휴강 처리', exact: true }).click();
    const cancelModal = page.getByTestId('group-lesson-no-deduction-cancel-modal');
    await expect(cancelModal).toBeVisible();
    await cancelModal.getByLabel('휴강 사유').selectOption('teacher_unavailable');
    await cancelModal.getByLabel('학생 안내 문구 (선택)').fill('선생님 사정으로 휴강합니다.');
    await cancelModal.getByRole('button', { name: '휴강 처리', exact: true }).click();

    await expectNoDeductionLessonState(db, setup.bookableLessonId);
    await expect
      .poll(async () => {
        const snap = await db
          .collection('groupLessonReservations')
          .doc(reservationId({ lessonId: setup.bookableLessonId, studentId: setup.firstStudentId }))
          .get();
        const data = snap.data() || {};
        return {
          status: data.status || '',
          cancellationType: data.cancellationType || '',
          cancelledReason: data.cancelledReason || '',
          noDeduction: data.noDeduction === true,
        };
      }, { timeout: 15000 })
      .toEqual({
        status: 'cancelled',
        cancellationType: 'no_deduction',
        cancelledReason: 'teacher_unavailable',
        noDeduction: true,
      });
    const refreshedBookableRow = await reopenGroupLessonRow(page, setup.groupName, setup.bookableLessonId);
    await expect(refreshedBookableRow).toContainText('휴강', { timeout: 15000 });
    await expect(refreshedBookableRow).toContainText('차감 없음');
    await expect(refreshedBookableRow.getByTestId('group-lesson-reserve-add-button')).toBeDisabled();
    expect(dialogMessages.join('\n')).toContain('수강권이 차감되지 않습니다.');
    await expect(getGroupRow(page, setup.groupName)).toBeVisible();
  } finally {
    if (setup) {
      await cleanupBookingFixture(setup).catch(() => {});
    }
  }
});

test('group lesson booking MVP reserves, blocks duplicate/full/closed cases, and cancels', async ({
  page,
  browserName,
}, testInfo) => {
  test.skip(browserName !== 'chromium', '이 테스트는 chromium 기준으로 작성되었습니다.');
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 booking setup을 실행합니다.');
  test.setTimeout(120000);

  initializeAdmin();
  const db = admin.firestore();
  let setup = null;

  try {
    const unique = `${Date.now()}-${testInfo.workerIndex}`;
    setup = await createBookingFixture(unique);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '단체반 관리');

    const groupRow = await clickGroupRow(page, setup.groupName);
    await expect(getRegisteredStudentsHeading(page, setup.groupName)).toBeVisible();

    const bookableRow = getLessonRowById(page, setup.bookableLessonId);
    await expect(bookableRow).toBeVisible({ timeout: 15000 });
    await expect(bookableRow).toContainText('정원 2명');
    await expect(bookableRow).toContainText('추가 예약 0명');
    await expect(bookableRow).toContainText('남은 자리 2명');
    await expect(bookableRow).toContainText('예약 가능');

    let modal = await openReservationAdd(bookableRow);
    await expect(modal.getByText(setup.firstStudentName)).toBeVisible();
    await expect(modal.getByText(setup.secondStudentName)).toBeVisible();
    await expect(modal.getByText(setup.mismatchStudentName)).toHaveCount(0);
    await clickExpectingNoDialog(
      page,
      modal
        .getByTestId('group-reservation-candidate-row')
        .filter({ hasText: setup.firstStudentName })
        .getByRole('button', { name: '예약', exact: true })
    );
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'active');
    await expectLessonBookedCount(db, setup.bookableLessonId, 1);
    await closeReservationModal(modal);
    let refreshedBookableRow = await reopenGroupLessonRow(page, setup.groupName, setup.bookableLessonId);
    await expect(refreshedBookableRow).toContainText('추가 예약 1명', { timeout: 15000 });
    await expect(refreshedBookableRow).toContainText('남은 자리 1명', { timeout: 15000 });

    modal = await openReservationAdd(refreshedBookableRow);
    await expect(modal.getByText(setup.firstStudentName)).toHaveCount(0);
    await expect(modal.getByText(setup.secondStudentName)).toBeVisible();
    await closeReservationModal(modal);

    modal = await openReservationView(refreshedBookableRow);
    let activeReservation = modal
      .getByTestId('group-reservation-row')
      .filter({ hasText: setup.firstStudentName });
    await expect(activeReservation).toContainText('관리자 예약');
    await expect(activeReservation).toContainText('예약 완료');
    await activeReservation.getByRole('button', { name: '예약 취소', exact: true }).click();
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'cancelled');
    await expectLessonBookedCount(db, setup.bookableLessonId, 0);
    await closeReservationModal(modal);
    refreshedBookableRow = await reopenGroupLessonRow(page, setup.groupName, setup.bookableLessonId);
    await expect(refreshedBookableRow).toContainText('추가 예약 0명', { timeout: 15000 });
    await expect(refreshedBookableRow).toContainText('남은 자리 2명', { timeout: 15000 });

    modal = await openReservationAdd(refreshedBookableRow);
    await expect(modal.getByText(setup.firstStudentName)).toBeVisible();
    await clickExpectingNoDialog(
      page,
      modal
        .getByTestId('group-reservation-candidate-row')
        .filter({ hasText: setup.firstStudentName })
        .getByRole('button', { name: '예약', exact: true })
    );
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'active');
    await expectLessonBookedCount(db, setup.bookableLessonId, 1);
    await closeReservationModal(modal);
    refreshedBookableRow = await reopenGroupLessonRow(page, setup.groupName, setup.bookableLessonId);

    modal = await openReservationView(refreshedBookableRow);
    activeReservation = modal
      .getByTestId('group-reservation-row')
      .filter({ hasText: setup.firstStudentName });
    await activeReservation.getByRole('button', { name: '예약 취소', exact: true }).click();
    await expectReservationStatus(db, setup.bookableLessonId, setup.firstStudentId, 'cancelled');
    await expectLessonBookedCount(db, setup.bookableLessonId, 0);
    await closeReservationModal(modal);

    const fullRow = getLessonRowById(page, setup.fullLessonId);
    await expect(fullRow).toContainText('정원 1명');
    await expect(fullRow).toContainText('남은 자리 1명');
    modal = await openReservationAdd(fullRow);
    await clickExpectingNoDialog(
      page,
      modal
        .getByTestId('group-reservation-candidate-row')
        .filter({ hasText: setup.firstStudentName })
        .getByRole('button', { name: '예약', exact: true })
    );
    await expectReservationStatus(db, setup.fullLessonId, setup.firstStudentId, 'active');
    await expectLessonBookedCount(db, setup.fullLessonId, 1);
    await expect(fullRow).toContainText('추가 예약 1명', { timeout: 15000 });
    await expect(fullRow).toContainText('남은 자리 0명', { timeout: 15000 });
    await expect(fullRow).toContainText('마감');
    await closeReservationModal(modal);
    await expect(fullRow.getByTestId('group-lesson-reserve-add-button')).toBeDisabled();

    const nonBookableRow = getLessonRowById(page, setup.nonBookableLessonId);
    await expect(nonBookableRow).toContainText('비활성');
    await expect(nonBookableRow.getByTestId('group-lesson-reserve-add-button')).toBeDisabled();

    await expect(page.getByRole('heading', { name: '단체반 관리', level: 1 })).toBeVisible();
  } finally {
    if (setup) {
      await cleanupBookingFixture(setup).catch(() => {});
    }
  }
});
