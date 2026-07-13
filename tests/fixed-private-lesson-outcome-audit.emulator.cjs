"use strict";

const assert = require("node:assert/strict");

const PROJECT_ID = "demo-fixed-private-outcome-audit";
const ACADEMY_ID = "fixed-private-outcome-audit-academy";
const ADMIN_UID = "fixed-private-outcome-audit-admin";
const TEACHER_UID = "fixed-private-outcome-audit-teacher";
const PACKAGE_ID = "fixed-private-outcome-audit-package";
const STUDENT_ID = "fixed-private-outcome-audit-student";
const TEACHER_KEY = "fixed-private-outcome-audit-teacher-key";
const MARKER = "reservation_v1";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required.");
}
if (!PROJECT_ID.startsWith("demo-")) {
  throw new Error("Fixed private audit tests require a demo project.");
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID});

const functionsTest = require(
    "../functions/node_modules/firebase-functions-test",
)({projectId: PROJECT_ID});
const functions = require("../functions/index.js");
const admin = require("../functions/node_modules/firebase-admin");

const db = admin.firestore();
const inspectLedger = functionsTest.wrap(
    functions.inspectFixedPrivateLessonOutcomeLedger,
);
const adminAuth = {
  uid: ADMIN_UID,
  token: {
    email: "fixed-private-audit-admin@example.com",
    name: "Fixed Private Audit Admin",
  },
};
const teacherAuth = {
  uid: TEACHER_UID,
  token: {
    email: "fixed-private-audit-teacher@example.com",
    name: "Fixed Private Audit Teacher",
  },
};

function deductionKey({reservationId}) {
  return [
    "deduct",
    ACADEMY_ID,
    reservationId,
    STUDENT_ID,
    PACKAGE_ID,
  ].join("_");
}

function auditPayload(overrides = {}) {
  return {
    academyId: ACADEMY_ID,
    packageId: PACKAGE_ID,
    limit: 10,
    cursor: "",
    dryRun: true,
    previewOnly: true,
    commit: false,
    ...overrides,
  };
}

async function expectHttpsError(promise, code) {
  try {
    await promise;
    assert.fail(`Expected ${code} HttpsError.`);
  } catch (error) {
    assert.equal(error.code, code);
  }
}

function occurrenceRows(name, {
  markerMode,
  deducted = false,
}) {
  const lessonId = `${name}-lesson`;
  const reservationId = `${name}-reservation`;
  const slotId = `${name}-slot`;
  const startAt = admin.firestore.Timestamp.fromMillis(
      Date.now() - 2 * 60 * 60 * 1000,
  );
  const lessonMarker = markerMode === "canonical" ||
    markerMode === "mixed" ?
    {fixedPrivateDeductionLedger: MARKER} :
    {};
  const reservationMarker = markerMode === "canonical" ?
    {fixedPrivateDeductionLedger: MARKER} :
    {};
  const slotMarker = markerMode === "canonical" ||
    markerMode === "mixed" ?
    {fixedPrivateDeductionLedger: MARKER} :
    {};
  const creditTransactionId = deductionKey({reservationId});
  const deductionPatch = deducted ? {
    deductionApplied: true,
    deductionPackageId: PACKAGE_ID,
    deductionCreditTransactionId: creditTransactionId,
    deductionTransactionId: creditTransactionId,
  } : {
    deductionApplied: false,
  };
  return {
    lessonId,
    reservationId,
    slotId,
    creditTransactionId,
    lesson: {
      academyId: ACADEMY_ID,
      lessonId,
      fixedLessonId: lessonId,
      reservationId,
      slotId,
      studentId: STUDENT_ID,
      studentID: STUDENT_ID,
      studentName: "must-not-be-returned",
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      date: "2026-07-11",
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: deducted ? "completed" : "active",
      packageId: PACKAGE_ID,
      deductionPackageId: PACKAGE_ID,
      linkedPackageId: PACKAGE_ID,
      fixedPrivatePackageId: PACKAGE_ID,
      packageType: "private",
      source: "fixed_admin",
      sourceType: "fixed-private-slot-assignment",
      reservationType: "fixed",
      ...deductionPatch,
      ...lessonMarker,
    },
    reservation: {
      academyId: ACADEMY_ID,
      lessonId,
      fixedLessonId: lessonId,
      slotId,
      studentId: STUDENT_ID,
      studentName: "must-not-be-returned",
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      date: "2026-07-11",
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: deducted ? "completed" : "active",
      packageId: PACKAGE_ID,
      deductionPackageId: PACKAGE_ID,
      linkedPackageId: PACKAGE_ID,
      fixedPrivatePackageId: PACKAGE_ID,
      source: "fixed_admin",
      sourceType: "fixed-private-slot-assignment",
      reservationType: "fixed",
      ...deductionPatch,
      ...reservationMarker,
    },
    slot: {
      academyId: ACADEMY_ID,
      lessonId,
      fixedLessonId: lessonId,
      reservationId,
      reservedStudentId: STUDENT_ID,
      fixedStudentId: STUDENT_ID,
      fixedStudentName: "must-not-be-returned",
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      date: "2026-07-11",
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: "reserved",
      slotType: "fixed",
      packageId: PACKAGE_ID,
      deductionPackageId: PACKAGE_ID,
      linkedPackageId: PACKAGE_ID,
      fixedPrivatePackageId: PACKAGE_ID,
      ...slotMarker,
    },
  };
}

async function seedOccurrence(name, options) {
  const rows = occurrenceRows(name, options);
  await Promise.all([
    db.collection("lessons").doc(rows.lessonId).set(rows.lesson),
    db.collection("privateLessonReservations")
        .doc(rows.reservationId).set(rows.reservation),
    db.collection("privateLessonSlots").doc(rows.slotId).set(rows.slot),
  ]);
  if (options.deducted) {
    await db.collection("creditTransactions")
        .doc(rows.creditTransactionId)
        .set({
          academyId: ACADEMY_ID,
          studentId: STUDENT_ID,
          packageId: PACKAGE_ID,
          sourceId: rows.reservationId,
          sourceType: "fixedPrivateReservation",
          deltaCount: -1,
        });
  }
  return rows;
}

async function seedAuditFixture() {
  await Promise.all([
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${ADMIN_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: ADMIN_UID,
          role: "owner",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${TEACHER_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: TEACHER_UID,
          role: "teacher",
          status: "active",
          teacherName: TEACHER_KEY,
        }),
    db.collection("studentPackages").doc(PACKAGE_ID).set({
      academyId: ACADEMY_ID,
      studentId: STUDENT_ID,
      studentName: "must-not-be-returned",
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      packageType: "private",
      packageTitle: "must-not-be-returned",
      totalCount: 10,
      usedCount: 3,
      remainingCount: 7,
      status: "active",
    }),
  ]);
  await seedOccurrence("audit-a-canonical", {markerMode: "canonical"});
  await seedOccurrence("audit-b-legacy", {markerMode: "legacy"});
  await seedOccurrence("audit-c-deducted", {
    markerMode: "canonical",
    deducted: true,
  });
  await seedOccurrence("audit-d-conflict", {markerMode: "mixed"});
  const missing = occurrenceRows("audit-e-missing", {markerMode: "legacy"});
  await db.collection("lessons").doc(missing.lessonId).set(missing.lesson);
}

async function collectionCounts() {
  const names = [
    "lessons",
    "privateLessonReservations",
    "privateLessonSlots",
    "studentPackages",
    "creditTransactions",
    "fixedPrivateLessonOutcomeActionBatches",
  ];
  const counts = {};
  for (const name of names) {
    counts[name] = (await db.collection(name).get()).size;
  }
  return counts;
}

async function testRepresentativeCountsAndReadOnly() {
  const beforeCounts = await collectionCounts();
  const packageBefore = (await db.collection("studentPackages")
      .doc(PACKAGE_ID).get()).data();
  const result = await inspectLedger({
    auth: adminAuth,
    data: auditPayload(),
  });
  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.previewOnly, true);
  assert.equal(result.commit, false);
  assert.equal(result.counts.scanned, 5);
  assert.equal(result.counts.fixedOccurrences, 5);
  assert.equal(result.counts.canonicalReady, 1);
  assert.equal(result.counts.legacyReady, 1);
  assert.equal(result.counts.alreadyReservationDeducted, 1);
  assert.equal(result.counts.conflict, 1);
  assert.equal(result.counts.missingLink, 1);
  for (const category of [
    "canonicalReady",
    "legacyReady",
    "alreadyReservationDeducted",
    "conflict",
    "missingLink",
  ]) {
    assert.equal(result.samples[category].length, 1);
    assert.ok(result.samples[category][0].lessonId);
  }
  assert.equal(result.packageAggregateDiagnostics.length, 1);
  const diagnostics = result.packageAggregateDiagnostics[0];
  assert.equal(diagnostics.packageId, PACKAGE_ID);
  assert.equal(diagnostics.lessonLedgerCount, 2);
  assert.equal(diagnostics.reservationLedgerCount, 1);
  assert.equal(diagnostics.expectedUsedCount, 3);
  assert.equal(diagnostics.currentUsedCount, 3);
  assert.equal(diagnostics.aggregateMatches, true);
  const serialized = JSON.stringify(result);
  for (const secret of [
    "must-not-be-returned",
    "studentName",
    "teacherEmail",
    "phone",
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
  const afterCounts = await collectionCounts();
  const packageAfter = (await db.collection("studentPackages")
      .doc(PACKAGE_ID).get()).data();
  assert.deepEqual(afterCounts, beforeCounts);
  assert.deepEqual(packageAfter, packageBefore);
}

async function testGuardsPermissionAndPagination() {
  await expectHttpsError(
      inspectLedger({
        auth: adminAuth,
        data: auditPayload({commit: true}),
      }),
      "invalid-argument",
  );
  await expectHttpsError(
      inspectLedger({
        auth: adminAuth,
        data: auditPayload({limit: 51}),
      }),
      "invalid-argument",
  );
  await expectHttpsError(
      inspectLedger({
        auth: teacherAuth,
        data: auditPayload(),
      }),
      "permission-denied",
  );
  const first = await inspectLedger({
    auth: adminAuth,
    data: auditPayload({limit: 2}),
  });
  assert.equal(first.counts.scanned, 2);
  assert.equal(first.pagination.hasMore, true);
  assert.ok(first.pagination.nextCursor);
  const second = await inspectLedger({
    auth: adminAuth,
    data: auditPayload({
      limit: 2,
      cursor: first.pagination.nextCursor,
    }),
  });
  assert.equal(second.counts.scanned, 2);
  assert.notEqual(second.pagination.cursor, "");
}

async function main() {
  await seedAuditFixture();
  await testRepresentativeCountsAndReadOnly();
  await testGuardsPermissionAndPagination();
  console.log("fixed private lesson outcome audit emulator tests passed");
}

main()
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    })
    .finally(async () => {
      await db.terminate().catch(() => {});
      functionsTest.cleanup();
    });
