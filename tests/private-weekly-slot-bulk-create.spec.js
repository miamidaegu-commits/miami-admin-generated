import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';
import { test, expect } from '@playwright/test';
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  DEFAULT_E2E_ACADEMY_ID,
} from './fixtures/test-data.js';
import {
  loginAsAdmin,
  openDashboardSection,
  selectTeacherOption,
} from './e2e-helpers.js';
import {
  buildPrivateWeeklyBulkSlotPlan,
  parsePrivateWeeklySlotTimeList,
  privateWeeklySlotsOverlap,
} from '../src/features/booking/privateWeeklySlotBulk.js';

const SERVICE_ACCOUNT_PATH = path.join(process.cwd(), 'serviceAccountKey.json');
const ADMIN_APP_NAME = 'private-weekly-slot-bulk-e2e';

function hasServiceAccount() {
  return fs.existsSync(SERVICE_ACCOUNT_PATH);
}

function initializeAdmin() {
  const existing = admin.apps.find((app) => app?.name === ADMIN_APP_NAME);
  if (existing) return existing;
  const serviceAccount = JSON.parse(fs.readFileSync(SERVICE_ACCOUNT_PATH, 'utf8'));
  return admin.initializeApp(
    {
      credential: admin.credential.cert(serviceAccount),
    },
    ADMIN_APP_NAME
  );
}

function getDb() {
  return initializeAdmin().firestore();
}

async function deleteTemplatesForTeacher(db, teacherKey) {
  const snap = await db
    .collection('privateLessonAvailabilityTemplates')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('teacherKey', '==', teacherKey)
    .get();
  await Promise.all(snap.docs.map((docSnap) => docSnap.ref.delete().catch(() => {})));
}

async function queryTemplatesForTeacher(db, teacherKey) {
  const snap = await db
    .collection('privateLessonAvailabilityTemplates')
    .where('academyId', '==', DEFAULT_E2E_ACADEMY_ID)
    .where('teacherKey', '==', teacherKey)
    .get();
  return snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
}

test('private weekly slot bulk helpers parse times and detect overlap', async () => {
  expect(parsePrivateWeeklySlotTimeList('13:00, 14:10\n15:20')).toEqual({
    times: ['13:00', '14:10', '15:20'],
    invalidTimes: [],
  });
  expect(parsePrivateWeeklySlotTimeList('9:00, 09:00, 13:90, 25:00, abc')).toEqual({
    times: ['09:00'],
    invalidTimes: ['13:90', '25:00', 'abc'],
  });

  const teacher = {
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacher: 'don1',
    teacherKey: 'don1',
    teacherName: 'Don',
  };
  const existing = { ...teacher, weekday: 1, time: '13:00', durationMinutes: 60 };
  expect(
    privateWeeklySlotsOverlap(existing, {
      ...teacher,
      weekday: 1,
      time: '13:30',
      durationMinutes: 50,
    })
  ).toBe(true);
  expect(
    privateWeeklySlotsOverlap(existing, {
      ...teacher,
      weekday: 1,
      time: '14:00',
      durationMinutes: 50,
    })
  ).toBe(false);
  expect(
    privateWeeklySlotsOverlap(existing, {
      ...teacher,
      teacherKey: 'jenny',
      teacher: 'jenny',
      teacherName: 'Jenny',
      weekday: 1,
      time: '13:30',
      durationMinutes: 50,
    })
  ).toBe(false);

  const plan = buildPrivateWeeklyBulkSlotPlan({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacherFields: teacher,
    weekdays: ['1'],
    times: ['13:00', '13:30', '14:10'],
    durationMinutes: 50,
    existingTemplates: [{ ...teacher, weekday: 1, time: '13:00', durationMinutes: 50 }],
  });
  expect(plan.createdRows.map((row) => row.time)).toEqual(['14:10']);
  expect(plan.skippedDuplicateRows.map((row) => row.time)).toEqual(['13:00']);
  expect(plan.skippedOverlapRows.map((row) => row.time)).toEqual(['13:30']);
});

test('admin bulk creates weekly private base slots and skips duplicates and overlaps', async ({
  page,
}, testInfo) => {
  test.skip(!hasServiceAccount(), 'serviceAccountKey.json이 있을 때만 bulk weekly slot E2E를 실행합니다.');
  test.setTimeout(180000);

  const db = getDb();
  const nowTs = admin.firestore.Timestamp.now();
  const unique = `${Date.now()}-${testInfo.workerIndex}`;
  const teacherId = `e2e-bulk-weekly-teacher-${unique}`;
  const teacherKey = `bulk-weekly-teacher-${unique}`;
  const teacherName = `Bulk Weekly Teacher ${unique}`;

  try {
    await Promise.all([
      deleteTemplatesForTeacher(db, teacherKey),
      db.collection('teachers').doc(teacherId).set({
        academyId: DEFAULT_E2E_ACADEMY_ID,
        name: teacherName,
        teacherName: teacherKey,
        teacherKey,
        status: 'active',
        createdAt: nowTs,
        updatedAt: nowTs,
      }),
    ]);

    await loginAsAdmin(page, ADMIN_EMAIL, ADMIN_PASSWORD);
    await openDashboardSection(page, '1:1 예약 시간 관리');

    const bulkSection = page.getByTestId('private-weekly-slot-bulk-section');
    await expect(bulkSection).toBeVisible({ timeout: 15000 });
    await selectTeacherOption(
      bulkSection.getByTestId('private-weekly-bulk-teacher-select'),
      teacherName
    );
    await bulkSection.getByTestId('private-weekly-bulk-weekday-3').check();
    await bulkSection.getByTestId('private-weekly-bulk-times-input').fill(
      '13:00, 14:10, 15:20, 16:30'
    );
    await bulkSection.getByTestId('private-weekly-bulk-duration-input').fill('50');
    await bulkSection.getByTestId('private-weekly-bulk-submit-button').click();
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '생성 8개',
      { timeout: 15000 }
    );

    await expect
      .poll(async () => (await queryTemplatesForTeacher(db, teacherKey)).length, {
        timeout: 15000,
      })
      .toBe(8);

    await expect(
      page
        .locator('[data-testid="private-availability-template-row"]')
        .filter({ hasText: teacherName })
    ).toHaveCount(8, { timeout: 15000 });

    await bulkSection.getByTestId('private-weekly-bulk-times-input').fill(
      '13:00, 14:10, 15:20, 16:30'
    );
    await bulkSection.getByTestId('private-weekly-bulk-submit-button').click();
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '생성 0개 · 중복 제외 8개',
      { timeout: 15000 }
    );
    expect(await queryTemplatesForTeacher(db, teacherKey)).toHaveLength(8);

    await bulkSection.getByTestId('private-weekly-bulk-weekday-3').uncheck();
    await bulkSection.getByTestId('private-weekly-bulk-times-input').fill('13:30');
    await bulkSection.getByTestId('private-weekly-bulk-submit-button').click();
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '생성 0개 · 중복 제외 0개 · 시간 겹침 제외 1개',
      { timeout: 15000 }
    );
    expect(await queryTemplatesForTeacher(db, teacherKey)).toHaveLength(8);
  } finally {
    await Promise.all([
      deleteTemplatesForTeacher(db, teacherKey),
      db.collection('teachers').doc(teacherId).delete().catch(() => {}),
    ]);
  }
});
