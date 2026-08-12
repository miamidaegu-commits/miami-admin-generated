import assert from "node:assert/strict";
import crypto from "node:crypto";
import {createRequire} from "node:module";
import test, {after, before} from "node:test";

const require = createRequire(import.meta.url);
const PROJECT_ID = "demo-miami-e2e";
const MARKER = "reservation_v1";
const EMULATOR_HOST = String(process.env.FIRESTORE_EMULATOR_HOST || "");

assert.match(
    EMULATOR_HOST,
    /^(127\.0\.0\.1|localhost):\d+$/,
    "FIRESTORE_EMULATOR_HOST must be a loopback emulator endpoint.",
);
assert.equal(PROJECT_ID.startsWith("demo-"), true);
assert.notEqual(PROJECT_ID, "daegu-miami-production");

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.GOOGLE_CLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID});

const functionsTest = require(
    "../functions/node_modules/firebase-functions-test",
)({projectId: PROJECT_ID});
const functions = require("../functions/index.js");
const admin = require("../functions/node_modules/firebase-admin");
const createAssignment = functionsTest.wrap(
    functions.createFixedPrivateLessonAssignment,
);
const db = admin.firestore();

const STATE_COLLECTIONS = [
  "academyMemberships",
  "privateStudents",
  "studentPackages",
  "privateLessonAvailabilityTemplates",
  "lessons",
  "privateLessonSlots",
  "privateLessonReservations",
  "fixedPrivateAssignmentBatches",
  "creditTransactions",
  "notificationEvents",
  "auditLogs",
  "academyAuditLogs",
];

let fixtureSequence = 0;

function addUtcDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function seoulToday() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function backfillWeeklyDates() {
  const today = seoulToday();
  return {
    past: addUtcDays(today, -7),
    future: [7, 14, 21].map((days) => addUtcDays(today, days)),
  };
}

function sortRows(rows) {
  return rows.sort((left, right) => left.id.localeCompare(right.id));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) => {
      return `${JSON.stringify(key)}:${stableStringify(value[key])}`;
    }).join(",") + "}";
  }
  return JSON.stringify(value);
}

function assignmentPayloadHash(fixture) {
  return crypto.createHash("sha256").update(stableStringify({
    version: 1,
    academyId: fixture.academyId,
    requestId: fixture.requestId,
    templateId: fixture.templateId,
    studentId: fixture.studentId,
    packageId: fixture.packageId,
    subject: fixture.data.subject,
    assignableDates: fixture.dates,
  })).digest("hex");
}

async function clearEmulator() {
  const endpoint =
    `http://${EMULATOR_HOST}/emulator/v1/projects/${PROJECT_ID}` +
    "/databases/(default)/documents";
  const response = await fetch(endpoint, {method: "DELETE"});
  assert.equal(response.ok, true, `Emulator cleanup failed: ${response.status}`);
}

async function snapshotState() {
  const state = {};
  for (const collectionName of STATE_COLLECTIONS) {
    const snap = await db.collection(collectionName).get();
    state[collectionName] = sortRows(snap.docs.map((docSnap) => ({
      id: docSnap.id,
      data: docSnap.data(),
    })));
  }
  return JSON.stringify(state);
}

async function collectionRows(collectionName, academyId) {
  const snap = await db.collection(collectionName)
      .where("academyId", "==", academyId)
      .get();
  return sortRows(snap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data(),
  })));
}

async function expectError(operation, expectedCodes) {
  let caught = null;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, "Expected callable rejection.");
  const codes = Array.isArray(expectedCodes) ? expectedCodes : [expectedCodes];
  assert.ok(
      codes.includes(caught.code),
      `Expected ${codes.join("|")}, received ${caught.code || "unknown"}.`,
  );
  return caught;
}

async function expectErrorWithoutWrites(operation, expectedCodes) {
  const beforeState = await snapshotState();
  const error = await expectError(operation, expectedCodes);
  assert.equal(await snapshotState(), beforeState);
  return error;
}

async function seedFixture(label, {
  academyId: academyOverride = "",
  dates = ["2027-03-01"],
  packageOverrides = {},
  templateOverrides = {},
  studentOverrides = {},
} = {}) {
  fixtureSequence += 1;
  const key = `${label}-${fixtureSequence}`;
  const academyId = academyOverride || `fixed-assignment-${key}`;
  const adminUid = `admin-${key}`;
  const nonAdminUid = `student-user-${key}`;
  const teacherUid = `teacher-${key}`;
  const teacherKey = `teacher-key-${key}`;
  const studentId = `student-${key}`;
  const packageId = `package-${key}`;
  const templateId = `template-${key}`;
  const requestId = `request-${key}`;
  const date = dates[0];
  const student = {
    academyId,
    name: `Synthetic Student ${key}`,
    status: "active",
    ...studentOverrides,
  };
  const packageData = {
    academyId,
    studentId,
    studentName: student.name,
    teacher: teacherKey,
    teacherName: teacherKey,
    teacherKey,
    teacherUid,
    packageType: "private",
    title: `Synthetic Package ${key}`,
    totalCount: 8,
    usedCount: 0,
    remainingCount: 8,
    status: "active",
    startDate: "2026-01-01",
    endDate: "2028-12-31",
    ...packageOverrides,
  };
  const template = {
    academyId,
    teacher: teacherKey,
    teacherName: teacherKey,
    teacherKey,
    teacherUid,
    weekday: new Date(`${date}T12:00:00+09:00`).getUTCDay(),
    time: "19:00",
    durationMinutes: 50,
    status: "active",
    useForFixedAssignment: true,
    effectiveStartDate: "2026-01-01",
    effectiveEndDate: "2028-12-31",
    ...templateOverrides,
  };
  await Promise.all([
    db.collection("academyMemberships")
        .doc(`${academyId}_${adminUid}`)
        .set({
          academyId,
          uid: adminUid,
          role: "owner",
          status: "active",
          displayName: `Synthetic Admin ${key}`,
        }),
    db.collection("academyMemberships")
        .doc(`${academyId}_${nonAdminUid}`)
        .set({
          academyId,
          uid: nonAdminUid,
          role: "student",
          status: "active",
          displayName: `Synthetic Non Admin ${key}`,
        }),
    db.collection("academyMemberships")
        .doc(`${academyId}_${teacherUid}`)
        .set({
          academyId,
          uid: teacherUid,
          role: "teacher",
          status: "active",
          teacherKey,
          teacherName: teacherKey,
          displayName: teacherKey,
        }),
    db.collection("privateStudents").doc(studentId).set(student),
    db.collection("studentPackages").doc(packageId).set(packageData),
    db.collection("privateLessonAvailabilityTemplates")
        .doc(templateId)
        .set(template),
  ]);
  const auth = {
    uid: adminUid,
    token: {
      academyId,
      role: "owner",
      name: `Synthetic Admin ${key}`,
    },
  };
  return {
    key,
    academyId,
    adminUid,
    nonAdminUid,
    teacherUid,
    teacherKey,
    studentId,
    packageId,
    templateId,
    requestId,
    dates,
    student,
    packageData,
    template,
    auth,
    data: {
      academyId,
      requestId,
      templateId,
      studentId,
      packageId,
      subject: `Synthetic Assignment ${key}`,
      assignableDates: dates,
      commit: true,
      dryRun: false,
      previewOnly: false,
    },
  };
}

async function assertCreatedLinks(fixture, result, expectedCount) {
  assert.equal(result.ok, true);
  assert.equal(result.committed, true);
  assert.equal(result.requestId, fixture.requestId);
  assert.equal(result.created.lessons.length, expectedCount);
  assert.equal(result.created.privateLessonSlots.length, expectedCount);
  assert.equal(
      result.created.privateLessonReservations.length,
      expectedCount,
  );
  const [lessons, slots, reservations, batches] = await Promise.all([
    collectionRows("lessons", fixture.academyId),
    collectionRows("privateLessonSlots", fixture.academyId),
    collectionRows("privateLessonReservations", fixture.academyId),
    collectionRows("fixedPrivateAssignmentBatches", fixture.academyId),
  ]);
  assert.equal(lessons.length, expectedCount);
  assert.equal(slots.length, expectedCount);
  assert.equal(reservations.length, expectedCount);
  assert.equal(batches.length, 1);
  assert.equal(batches[0].id, result.assignmentBatchIdCandidate);
  assert.equal(batches[0].data.requestId, fixture.requestId);
  assert.equal(batches[0].data.status, "completed");
  for (const lesson of lessons) {
    const slot = slots.find((row) => row.id === lesson.data.slotId);
    const reservation = reservations.find(
        (row) => row.id === lesson.data.reservationId,
    );
    assert.ok(slot);
    assert.ok(reservation);
    assert.equal(slot.data.lessonId, lesson.id);
    assert.equal(slot.data.reservationId, reservation.id);
    assert.equal(reservation.data.lessonId, lesson.id);
    assert.equal(reservation.data.slotId, slot.id);
    for (const row of [lesson, slot, reservation]) {
      assert.equal(row.data.fixedPrivateDeductionLedger, MARKER);
      assert.equal(
          row.data.fixedPrivateAssignmentBatchId,
          result.assignmentBatchIdCandidate,
      );
      assert.equal(row.data.packageId, fixture.packageId);
    }
  }
  return {lessons, slots, reservations, batches};
}

before(async () => {
  await clearEmulator();
});

after(async () => {
  await clearEmulator();
  await db.terminate();
  functionsTest.cleanup();
});

test("T01 unauthenticated is denied with zero writes", async () => {
  const fixture = await seedFixture("t01");
  await expectErrorWithoutWrites(
      () => createAssignment({data: fixture.data}),
      "unauthenticated",
  );
});

test("T02 non-admin is denied with zero writes", async () => {
  const fixture = await seedFixture("t02");
  await expectErrorWithoutWrites(
      () => createAssignment({
        auth: {
          uid: fixture.nonAdminUid,
          token: {academyId: fixture.academyId, role: "student"},
        },
        data: fixture.data,
      }),
      "permission-denied",
  );
});

test("T03 cross-academy request is denied with zero writes", async () => {
  const fixture = await seedFixture("t03");
  const other = await seedFixture("t03-other");
  await expectErrorWithoutWrites(
      () => createAssignment({
        auth: fixture.auth,
        data: {...other.data, requestId: `${other.requestId}-cross`},
      }),
      "permission-denied",
  );
});

test("T04 invalid or wrong-academy resources are denied with zero writes",
    async () => {
      for (const field of ["studentId", "packageId", "templateId"]) {
        const missing = await seedFixture(`t04-missing-${field}`);
        await expectErrorWithoutWrites(
            () => createAssignment({
              auth: missing.auth,
              data: {...missing.data, [field]: `missing-${field}`},
            }),
            "not-found",
        );

        const wrong = await seedFixture(`t04-wrong-${field}`);
        const collections = {
          studentId: "privateStudents",
          packageId: "studentPackages",
          templateId: "privateLessonAvailabilityTemplates",
        };
        await db.collection(collections[field])
            .doc(wrong[field])
            .update({academyId: `${wrong.academyId}-other`});
        await expectErrorWithoutWrites(
            () => createAssignment({auth: wrong.auth, data: wrong.data}),
            field === "packageId" ?
              "failed-precondition" :
              "permission-denied",
        );
      }
    });

test("T05 dryRun mode is rejected with zero writes", async () => {
  const fixture = await seedFixture("t05");
  await expectErrorWithoutWrites(
      () => createAssignment({
        auth: fixture.auth,
        data: {...fixture.data, dryRun: true},
      }),
      "failed-precondition",
  );
});

test("T06 previewOnly backfill succeeds with zero writes", async () => {
  const {past} = backfillWeeklyDates();
  const fixture = await seedFixture("t06", {dates: [past]});
  const beforeState = await snapshotState();
  const result = await createAssignment({
    auth: fixture.auth,
    data: {
      ...fixture.data,
      commit: false,
      dryRun: true,
      previewOnly: true,
      allowPastDates: true,
    },
  });
  assert.equal(result.ok, true);
  assert.equal(result.committed, false);
  assert.equal(result.previewOnly, true);
  assert.equal(result.dryRun, true);
  assert.deepEqual(result.normalizedPlan.assignableDates, [past]);
  assert.equal(await snapshotState(), beforeState);
});

test("T07 commit false is rejected with zero writes", async () => {
  const fixture = await seedFixture("t07");
  await expectErrorWithoutWrites(
      () => createAssignment({
        auth: fixture.auth,
        data: {...fixture.data, commit: false},
      }),
      "failed-precondition",
  );
});

test("T08 valid commit creates exact linked assignment rows", async () => {
  const dates = ["2027-03-01", "2027-03-08"];
  const fixture = await seedFixture("t08", {dates});
  const result = await createAssignment({
    auth: fixture.auth,
    data: fixture.data,
  });
  await assertCreatedLinks(fixture, result, dates.length);
});

test("T09 same requestId replay is stable and idempotent", async () => {
  const fixture = await seedFixture("t09");
  const first = await createAssignment({
    auth: fixture.auth,
    data: fixture.data,
  });
  const beforeReplay = await snapshotState();
  const replay = await createAssignment({
    auth: fixture.auth,
    data: fixture.data,
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(
      replay.assignmentBatchIdCandidate,
      first.assignmentBatchIdCandidate,
  );
  assert.deepEqual(replay.created, first.created);
  assert.equal(await snapshotState(), beforeReplay);
});

test("T10 conflicting reuse of requestId adds no duplicate rows", async () => {
  const fixture = await seedFixture("t10");
  await createAssignment({auth: fixture.auth, data: fixture.data});
  const beforeConflict = await snapshotState();
  await expectError(
      () => createAssignment({
        auth: fixture.auth,
        data: {...fixture.data, subject: "Conflicting Synthetic Assignment"},
      }),
      "already-exists",
  );
  assert.equal(await snapshotState(), beforeConflict);
  assert.equal(
      (await collectionRows("creditTransactions", fixture.academyId)).length,
      0,
  );
});

test("T11 schedule conflict fails with zero partial writes", async () => {
  const fixture = await seedFixture("t11");
  await db.collection("lessons").doc(`conflict-${fixture.key}`).set({
    academyId: fixture.academyId,
    studentId: `other-${fixture.studentId}`,
    teacher: fixture.teacherKey,
    teacherName: fixture.teacherKey,
    teacherKey: fixture.teacherKey,
    teacherUid: fixture.teacherUid,
    packageId: `other-${fixture.packageId}`,
    date: fixture.dates[0],
    time: fixture.template.time,
    durationMinutes: fixture.template.durationMinutes,
    status: "active",
  });
  await expectErrorWithoutWrites(
      () => createAssignment({auth: fixture.auth, data: fixture.data}),
      "failed-precondition",
  );
});

test("T12 package capacity rejects exhaustion and valid package stays stable",
    async () => {
      const exhausted = await seedFixture("t12-exhausted", {
        packageOverrides: {
          totalCount: 1,
          usedCount: 1,
          remainingCount: 0,
          status: "exhausted",
        },
      });
      await expectErrorWithoutWrites(
          () => createAssignment({
            auth: exhausted.auth,
            data: exhausted.data,
          }),
          "failed-precondition",
      );

      const valid = await seedFixture("t12-valid", {
        dates: ["2027-04-05", "2027-04-12"],
        packageOverrides: {
          totalCount: 2,
          usedCount: 0,
          remainingCount: 2,
        },
      });
      const packageBefore = (await db.collection("studentPackages")
          .doc(valid.packageId).get()).data();
      const result = await createAssignment({auth: valid.auth, data: valid.data});
      await assertCreatedLinks(valid, result, 2);
      const packageAfter = (await db.collection("studentPackages")
          .doc(valid.packageId).get()).data();
      assert.deepEqual(packageAfter, packageBefore);
      assert.ok(packageAfter.usedCount >= 0);
      assert.ok(packageAfter.remainingCount >= 0);
    });

test("T13 incomplete transaction checkpoint fails atomically", async () => {
  const fixture = await seedFixture("t13");
  const batchId =
    `fixedPrivateAssignment_${fixture.academyId}_${fixture.requestId}`;
  await db.collection("fixedPrivateAssignmentBatches").doc(batchId).set({
    academyId: fixture.academyId,
    requestId: fixture.requestId,
    payloadHash: assignmentPayloadHash(fixture),
    status: "started",
  });
  await expectErrorWithoutWrites(
      () => createAssignment({auth: fixture.auth, data: fixture.data}),
      "failed-precondition",
  );
});

test("T14 domain failure leaves assignment package audit and ledger unchanged",
    async () => {
      const fixture = await seedFixture("t14");
      await db.collection("privateLessonAvailabilityTemplates")
          .doc(fixture.templateId)
          .update({weekday: (fixture.template.weekday + 1) % 7});
      await expectErrorWithoutWrites(
          () => createAssignment({auth: fixture.auth, data: fixture.data}),
          "failed-precondition",
      );
    });

test("T15 success writes exact batch audit and canonical ledger only",
    async () => {
      const fixture = await seedFixture("t15");
      await expectErrorWithoutWrites(
          () => createAssignment({
            auth: fixture.auth,
            data: {...fixture.data, commit: false},
          }),
          "failed-precondition",
      );
      const packageBefore = (await db.collection("studentPackages")
          .doc(fixture.packageId).get()).data();
      const result = await createAssignment({
        auth: fixture.auth,
        data: fixture.data,
      });
      const created = await assertCreatedLinks(fixture, result, 1);
      assert.equal(created.batches[0].data.actor.actorUid, fixture.adminUid);
      assert.equal(
          created.batches[0].data.created.lessons[0],
          created.lessons[0].id,
      );
      assert.equal(
          (await collectionRows(
              "creditTransactions",
              fixture.academyId,
          )).length,
          0,
      );
      assert.deepEqual(
          (await db.collection("studentPackages")
              .doc(fixture.packageId).get()).data(),
          packageBefore,
      );
    });

test("T16 invalid assignableDates variants reject with zero writes", async () => {
  const fixture = await seedFixture("t16");
  const tooManyDates = Array.from(
      {length: 53},
      (_, index) => addUtcDays("2027-05-01", index),
  );
  const cases = [
    {dates: [], code: "invalid-argument"},
    {dates: ["not-a-date"], code: "invalid-argument"},
    {dates: ["2027-03-01", "2027-03-01"], code: "invalid-argument"},
    {dates: tooManyDates, code: "invalid-argument"},
    {dates: ["2020-01-06"], code: "failed-precondition"},
  ];
  for (const invalidCase of cases) {
    await expectErrorWithoutWrites(
        () => createAssignment({
          auth: fixture.auth,
          data: {...fixture.data, assignableDates: invalidCase.dates},
        }),
        invalidCase.code,
    );
  }
});

test("T17 mismatched academy auth claim is denied with zero writes", async () => {
  const fixture = await seedFixture("t17");
  const mismatchedAuth = {
    ...fixture.auth,
    token: {
      ...fixture.auth.token,
      academyId: `${fixture.academyId}-other`,
    },
  };
  await expectErrorWithoutWrites(
      () => createAssignment({auth: mismatchedAuth, data: fixture.data}),
      "permission-denied",
  );
});

test("B01 past dates without allowPastDates reject with all writes zero",
    async () => {
      const {past} = backfillWeeklyDates();
      const fixture = await seedFixture("b01", {dates: [past]});
      await expectErrorWithoutWrites(
          () => createAssignment({auth: fixture.auth, data: fixture.data}),
          "failed-precondition",
      );
    });

test("B02 past preview with allowPastDates returns all dates and writes zero",
    async () => {
      const {past, future} = backfillWeeklyDates();
      const dates = [past, ...future];
      const fixture = await seedFixture("b02", {dates});
      const beforeState = await snapshotState();
      const result = await createAssignment({
        auth: fixture.auth,
        data: {
          ...fixture.data,
          commit: false,
          dryRun: true,
          previewOnly: true,
          allowPastDates: true,
        },
      });
      assert.equal(result.ok, true);
      assert.equal(result.committed, false);
      assert.equal(result.previewOnly, true);
      assert.equal(result.dryRun, true);
      assert.equal(result.backfill, true);
      assert.equal(result.pastDateCount, 1);
      assert.deepEqual(result.normalizedPlan.assignableDates, dates);
      assert.deepEqual(result.wouldCreate, {
        fixedPrivateAssignmentBatch: 1,
        lessons: 4,
        privateLessonSlots: 4,
        privateLessonReservations: 4,
      });
      assert.equal(await snapshotState(), beforeState);
    });

test("B03 mixed backfill commit creates four linked active records atomically",
    async () => {
      const {past, future} = backfillWeeklyDates();
      const dates = [past, ...future];
      const fixture = await seedFixture("b03", {dates});
      const result = await createAssignment({
        auth: fixture.auth,
        data: {...fixture.data, allowPastDates: true},
      });
      assert.equal(result.backfill, true);
      assert.equal(result.pastDateCount, 1);
      const created = await assertCreatedLinks(fixture, result, 4);
      assert.equal(created.batches[0].data.backfill, true);
      assert.equal(created.batches[0].data.pastDateCount, 1);
      for (const row of [
        ...created.lessons,
        ...created.slots,
        ...created.reservations,
      ]) {
        assert.equal(row.data.backfill, true);
        assert.equal(row.data.pastDateCount, 1);
      }
      for (const lesson of created.lessons) {
        assert.equal(lesson.data.status, "active");
        assert.equal(lesson.data.deductionApplied, false);
      }
      for (const reservation of created.reservations) {
        assert.equal(reservation.data.status, "active");
        assert.equal(reservation.data.deductionApplied, false);
      }
    });

test("B04 same backfill requestId replay creates no duplicate rows", async () => {
  const {past, future} = backfillWeeklyDates();
  const fixture = await seedFixture("b04", {dates: [past, ...future]});
  const data = {...fixture.data, allowPastDates: true};
  const first = await createAssignment({auth: fixture.auth, data});
  const beforeReplay = await snapshotState();
  const replay = await createAssignment({auth: fixture.auth, data});
  assert.equal(replay.idempotentReplay, true);
  assert.deepEqual(replay.created, first.created);
  assert.equal(await snapshotState(), beforeReplay);
});

test("B05 unauthorized and academy-mismatched backfill requests write zero",
    async () => {
      const {past} = backfillWeeklyDates();
      const unauthorized = await seedFixture("b05-role", {dates: [past]});
      await expectErrorWithoutWrites(
          () => createAssignment({
            auth: {
              uid: unauthorized.nonAdminUid,
              token: {
                academyId: unauthorized.academyId,
                role: "student",
              },
            },
            data: {...unauthorized.data, allowPastDates: true},
          }),
          "permission-denied",
      );

      const mismatch = await seedFixture("b05-academy", {dates: [past]});
      await expectErrorWithoutWrites(
          () => createAssignment({
            auth: {
              ...mismatch.auth,
              token: {
                ...mismatch.auth.token,
                academyId: `${mismatch.academyId}-other`,
              },
            },
            data: {...mismatch.data, allowPastDates: true},
          }),
          "permission-denied",
      );
    });

test("B06 malformed duplicate dates and non-boolean flag reject with writes zero",
    async () => {
      const {past} = backfillWeeklyDates();
      const fixture = await seedFixture("b06", {dates: [past]});
      const cases = [
        {...fixture.data, assignableDates: ["not-a-date"], allowPastDates: true},
        {...fixture.data, assignableDates: [past, past], allowPastDates: true},
        {...fixture.data, allowPastDates: "true"},
      ];
      for (const data of cases) {
        await expectErrorWithoutWrites(
            () => createAssignment({auth: fixture.auth, data}),
            "invalid-argument",
        );
      }
    });
