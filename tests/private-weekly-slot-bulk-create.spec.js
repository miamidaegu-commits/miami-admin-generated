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
  privateWeeklyTemplateAppliesToDate,
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

async function seedWeeklyTemplates(db, rows) {
  await Promise.all(
    rows.map((row) => db.collection('privateLessonAvailabilityTemplates').doc().set(row))
  );
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
  const existing = {
    ...teacher,
    weekday: 1,
    time: '13:00',
    durationMinutes: 60,
    effectiveStartDate: '2026-06-01',
    effectiveEndDate: '2026-08-31',
  };
  expect(
    privateWeeklySlotsOverlap(existing, {
      ...teacher,
      weekday: 1,
      time: '13:30',
      durationMinutes: 50,
      effectiveStartDate: '2026-07-01',
      effectiveEndDate: '2026-07-31',
    })
  ).toBe(true);
  expect(
    privateWeeklySlotsOverlap(existing, {
      ...teacher,
      weekday: 1,
      time: '14:00',
      durationMinutes: 50,
      effectiveStartDate: '2026-07-01',
      effectiveEndDate: '2026-07-31',
    })
  ).toBe(false);
  expect(
    privateWeeklySlotsOverlap(existing, {
      ...teacher,
      weekday: 1,
      time: '13:30',
      durationMinutes: 50,
      effectiveStartDate: '2026-09-01',
      effectiveEndDate: '2026-09-30',
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
      effectiveStartDate: '2026-07-01',
      effectiveEndDate: '2026-07-31',
    })
  ).toBe(false);
  expect(privateWeeklyTemplateAppliesToDate(existing, '2026-06-01')).toBe(true);
  expect(privateWeeklyTemplateAppliesToDate(existing, '2026-08-31')).toBe(true);
  expect(privateWeeklyTemplateAppliesToDate(existing, '2026-09-01')).toBe(false);
  expect(privateWeeklyTemplateAppliesToDate({ ...teacher, weekday: 1 }, '2026-12-01')).toBe(true);

  const plan = buildPrivateWeeklyBulkSlotPlan({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacherFields: teacher,
    weekdays: ['1'],
    times: ['13:00', '13:30', '14:10'],
    durationMinutes: 50,
    effectiveStartDate: '2026-06-01',
    effectiveEndDate: '2026-08-31',
    existingTemplates: [
      {
        ...teacher,
        weekday: 1,
        time: '13:00',
        durationMinutes: 50,
        effectiveStartDate: '2026-06-01',
        effectiveEndDate: '2026-08-31',
      },
    ],
  });
  expect(plan.createdRows.map((row) => row.time)).toEqual(['14:10']);
  expect(plan.skippedDuplicateRows.map((row) => row.time)).toEqual(['13:00']);
  expect(plan.skippedOverlapRows.map((row) => row.time)).toEqual(['13:30']);

  const nonOverlappingRangePlan = buildPrivateWeeklyBulkSlotPlan({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacherFields: teacher,
    weekdays: ['1'],
    times: ['13:00'],
    durationMinutes: 50,
    effectiveStartDate: '2026-09-01',
    effectiveEndDate: '2026-11-30',
    existingTemplates: [
      {
        ...teacher,
        weekday: 1,
        time: '13:00',
        durationMinutes: 50,
        effectiveStartDate: '2026-06-01',
        effectiveEndDate: '2026-08-31',
      },
      existing,
    ],
  });
  expect(nonOverlappingRangePlan.createdRows.map((row) => row.time)).toEqual(['13:00']);
  expect(nonOverlappingRangePlan.skippedDuplicateRows).toHaveLength(0);
  expect(nonOverlappingRangePlan.skippedOverlapRows).toHaveLength(0);

  const nonOverlappingRangeTimeOverlapPlan = buildPrivateWeeklyBulkSlotPlan({
    academyId: DEFAULT_E2E_ACADEMY_ID,
    teacherFields: teacher,
    weekdays: ['1'],
    times: ['13:30'],
    durationMinutes: 50,
    effectiveStartDate: '2026-09-01',
    effectiveEndDate: '2026-09-30',
    existingTemplates: [existing],
  });
  expect(nonOverlappingRangeTimeOverlapPlan.createdRows.map((row) => row.time)).toEqual(['13:30']);
  expect(nonOverlappingRangeTimeOverlapPlan.skippedOverlapRows).toHaveLength(0);
});

test('weekly template availability wiring preserves short window and honors effective range', async () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  expect(source).toContain('function privateAvailabilityTemplateAppliesToDate');
  expect(source).toMatch(
    /buildTemplateSlots[\s\S]*privateAvailabilityTemplateAppliesToDate\(data, date\)/
  );
  expect(source).toMatch(
    /reservePrivateLessonSlot[\s\S]*privateAvailabilityTemplateAppliesToDate\([\s\S]*template,[\s\S]*requestedDate/
  );
  expect(source).toContain('const weeks = [currentMonday, addSeoulDays(currentMonday, 7)]');
  expect(source).toContain('const rangeEnd = addSeoulDays(currentMonday, 12)');
});

test('admin bulk previews weekly private base slots with ranges and skips duplicates and overlaps', async ({
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
    await expect(bulkSection.getByTestId('private-weekly-bulk-duration-input')).toHaveValue('60');
    await expect(
      page
        .getByTestId('private-availability-template-section')
        .locator('input[type="number"]')
        .first()
    ).toHaveValue('60');
    await expect(page.getByLabel('1:1 수업 진행 시간')).toHaveValue('60');
    await bulkSection.getByTestId('private-weekly-bulk-times-input').fill(
      '13:00, 14:10, 15:20, 16:30'
    );
    await bulkSection.getByTestId('private-weekly-bulk-start-date-input').fill('2026-06-01');
    await bulkSection.getByTestId('private-weekly-bulk-end-date-input').fill('2026-08-31');
    await bulkSection.getByTestId('private-weekly-bulk-preview-button').click();
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '생성 8개',
      { timeout: 15000 }
    );
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '기간: 2026-06-01 ~ 2026-08-31',
      { timeout: 15000 }
    );

    await seedWeeklyTemplates(
      db,
      [1, 3].flatMap((weekday) =>
        ['13:00', '14:10', '15:20', '16:30'].map((time) => ({
          academyId: DEFAULT_E2E_ACADEMY_ID,
          teacher: teacherKey,
          teacherName,
          teacherKey,
          weekday,
          time,
          durationMinutes: 60,
          status: 'active',
          effectiveStartDate: '2026-06-01',
          effectiveEndDate: '2026-08-31',
          createdAt: nowTs,
          updatedAt: nowTs,
        }))
      )
    );
    await expect
      .poll(async () => (await queryTemplatesForTeacher(db, teacherKey)).length, { timeout: 15000 })
      .toBe(8);
    const initialTemplates = await queryTemplatesForTeacher(db, teacherKey);
    expect(
      initialTemplates.every(
        (template) =>
          template.effectiveStartDate === '2026-06-01' &&
          template.effectiveEndDate === '2026-08-31'
      )
    ).toBe(true);

    await expect(
      page
        .locator('[data-testid="private-availability-template-row"]')
        .filter({ hasText: teacherName })
    ).toHaveCount(8, { timeout: 15000 });
    await expect(
      page
        .locator('[data-testid="private-availability-template-row"]')
        .filter({ hasText: teacherName })
        .first()
    ).toContainText('2026-06-01 ~ 2026-08-31');

    await bulkSection.getByTestId('private-weekly-bulk-times-input').fill(
      '13:00, 14:10, 15:20, 16:30'
    );
    await bulkSection.getByTestId('private-weekly-bulk-start-date-input').fill('2026-08-01');
    await bulkSection.getByTestId('private-weekly-bulk-end-date-input').fill('2026-10-31');
    await bulkSection.getByTestId('private-weekly-bulk-preview-button').click();
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '생성 0개 · 중복 제외 8개',
      { timeout: 15000 }
    );
    expect(await queryTemplatesForTeacher(db, teacherKey)).toHaveLength(8);

    await bulkSection.getByTestId('private-weekly-bulk-weekday-3').uncheck();
    await bulkSection.getByTestId('private-weekly-bulk-times-input').fill('13:30');
    await bulkSection.getByTestId('private-weekly-bulk-start-date-input').fill('2026-07-01');
    await bulkSection.getByTestId('private-weekly-bulk-end-date-input').fill('2026-07-31');
    await bulkSection.getByTestId('private-weekly-bulk-preview-button').click();
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '생성 0개 · 중복 제외 0개 · 시간 겹침 제외 1개',
      { timeout: 15000 }
    );
    expect(await queryTemplatesForTeacher(db, teacherKey)).toHaveLength(8);

    await bulkSection.getByTestId('private-weekly-bulk-times-input').fill('13:00, 13:30');
    await bulkSection.getByTestId('private-weekly-bulk-start-date-input').fill('2026-09-01');
    await bulkSection.getByTestId('private-weekly-bulk-end-date-input').fill('2026-11-30');
    await bulkSection.getByTestId('private-weekly-bulk-preview-button').click();
    await expect(bulkSection.getByTestId('private-weekly-bulk-result')).toContainText(
      '생성 1개 · 중복 제외 0개 · 시간 겹침 제외 1개',
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
