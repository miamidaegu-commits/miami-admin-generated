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

async function expectHttpsError(promise, code, message = "") {
  try {
    await promise;
    assert.fail(`Expected ${code} HttpsError.`);
  } catch (error) {
    assert.equal(error.code, code);
    if (message) assert.equal(error.message, message);
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

const V2_BASELINE_ACADEMY_ID = "fixed-private-audit-v2-baseline";
const V2_BLOCKER_ACADEMY_ID = "fixed-private-audit-v2-blockers";
const V2_TEACHER_KEY = "fixed-private-audit-v2-teacher";
const V2_ADMIN_UID = "fixed-private-audit-v2-admin";
const V2_STUDENT_UID = "fixed-private-audit-v2-student";
const v2AdminAuth = {
  uid: V2_ADMIN_UID,
  token: {email: "fixed-private-audit-v2-admin@example.com"},
};
const v2StudentAuth = {
  uid: V2_STUDENT_UID,
  token: {email: "fixed-private-audit-v2-student@example.com"},
};

function auditPayloadV2(academyId, scanFamily, overrides = {}) {
  return {
    auditVersion: 2,
    academyId,
    scanFamily,
    limit: 2,
    cursor: "",
    dryRun: true,
    previewOnly: true,
    commit: false,
    ...overrides,
  };
}

function decodeAuditCursor(token) {
  return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
}

function encodeAuditCursor(payload) {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function v2Occurrence(academyId, name, {
  markerMode = "canonical",
  convertedLegacy = false,
  status = "active",
  teacher = {teacherKey: V2_TEACHER_KEY},
  packageId = `${academyId}-package`,
  studentId = `${academyId}-student`,
  applied = false,
} = {}) {
  const lessonId = `${name}-lesson`;
  const reservationId = `${name}-reservation`;
  const slotId = `${name}-slot`;
  const creditId = [
    "deduct",
    academyId,
    reservationId,
    studentId,
    packageId,
  ].join("_");
  const marker = markerMode === "canonical" ?
    {fixedPrivateDeductionLedger: MARKER} :
    {};
  const mixedLessonMarker = markerMode === "mixed" ?
    {fixedPrivateDeductionLedger: MARKER} :
    marker;
  const deduction = applied ? {
    deductionApplied: true,
    deductionPackageId: packageId,
    deductionCreditTransactionId: creditId,
    deductionTransactionId: creditId,
  } : {
    deductionApplied: false,
  };
  const canonicalCreationEvidence =
    markerMode === "canonical" && !convertedLegacy ? {
      fixedPrivateAssignmentBatchId: `${name}-assignment-batch`,
      privateLessonAvailabilityTemplateId: `${name}-template`,
    } :
    {};
  const shared = {
    academyId,
    studentId,
    packageId,
    deductionPackageId: packageId,
    linkedPackageId: packageId,
    fixedPrivatePackageId: packageId,
    date: "2026-07-11",
    time: "17:00",
    source: "fixed_admin",
    sourceType: convertedLegacy ?
      "weekly-slot-fixed-assignment-v1" :
      "fixed-private-slot-assignment",
    reservationType: "fixed",
    ...teacher,
    ...deduction,
    ...canonicalCreationEvidence,
  };
  return {
    lessonId,
    reservationId,
    slotId,
    creditId,
    lesson: {
      ...shared,
      lessonId,
      fixedLessonId: lessonId,
      reservationId,
      slotId,
      packageType: "private",
      status,
      ...mixedLessonMarker,
    },
    reservation: {
      ...shared,
      lessonId,
      fixedLessonId: lessonId,
      slotId,
      status,
      ...marker,
    },
    slot: {
      ...shared,
      lessonId,
      fixedLessonId: lessonId,
      reservationId,
      reservedStudentId: studentId,
      fixedStudentId: studentId,
      slotType: "fixed",
      status: "reserved",
      ...marker,
    },
  };
}

async function seedV2PackageAndMemberships(academyId) {
  const packageId = `${academyId}-package`;
  const studentId = `${academyId}-student`;
  await Promise.all([
    db.collection("academyMemberships")
        .doc(`${academyId}_${ADMIN_UID}`)
        .set({
          academyId,
          uid: ADMIN_UID,
          role: "owner",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${academyId}_${TEACHER_UID}`)
        .set({
          academyId,
          uid: TEACHER_UID,
          role: "teacher",
          status: "active",
          teacherKey: V2_TEACHER_KEY,
          teacherName: V2_TEACHER_KEY,
        }),
    db.collection("academyMemberships")
        .doc(`${academyId}_${V2_ADMIN_UID}`)
        .set({
          academyId,
          uid: V2_ADMIN_UID,
          role: "admin",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${academyId}_${V2_STUDENT_UID}`)
        .set({
          academyId,
          uid: V2_STUDENT_UID,
          role: "student",
          status: "active",
        }),
    db.collection("studentPackages").doc(packageId).set({
      academyId,
      studentId,
      teacherKey: V2_TEACHER_KEY,
      teacherName: V2_TEACHER_KEY,
      packageType: "private",
      validFrom: "2026-01-01",
      validTo: "2026-12-31",
      totalCount: 20,
      usedCount: 5,
      remainingCount: 15,
      status: "active",
    }),
  ]);
}

async function seedV2Occurrence(rows, {
  credit = false,
  ledgerTransition = "reservation_increment",
} = {}) {
  const writes = [
    db.collection("lessons").doc(rows.lessonId).set(rows.lesson),
    db.collection("privateLessonReservations")
        .doc(rows.reservationId).set(rows.reservation),
    db.collection("privateLessonSlots").doc(rows.slotId).set(rows.slot),
  ];
  if (credit) {
    writes.push(db.collection("creditTransactions").doc(rows.creditId).set({
      academyId: rows.lesson.academyId,
      studentId: rows.lesson.studentId,
      packageId: rows.lesson.packageId,
      sourceId: rows.reservationId,
      lessonId: rows.lessonId,
      slotId: rows.slotId,
      sourceType: "fixedPrivateReservation",
      actionType: "fixed_private_completed_deduct",
      ledgerTransition,
      fixedPrivateDeductionLedger: MARKER,
      deltaCount: -1,
    }));
  }
  await Promise.all(writes);
}

async function scanAllV2(academyId, limit = 2) {
  const families = [
    "fixedLessons",
    "fixedReservations",
    "fixedSlots",
    "deductionCredits",
    "teacherMemberships",
  ];
  const result = {};
  for (const family of families) {
    result[family] = [];
    let cursor = "";
    while (true) {
      const page = await inspectLedger({
        auth: adminAuth,
        data: auditPayloadV2(academyId, family, {limit, cursor}),
      });
      result[family].push(page);
      if (!page.page.hasMore) break;
      assert.ok(page.page.nextCursor);
      cursor = page.page.nextCursor;
    }
  }
  return result;
}

async function snapshotV2Collections(academyId) {
  const collections = [
    "lessons",
    "privateLessonReservations",
    "privateLessonSlots",
    "privateStudents",
    "studentPackages",
    "creditTransactions",
    "academyMemberships",
    "fixedPrivateLessonOutcomeActionBatches",
    "fixedPrivateAssignmentBatches",
    "privateLessonStatusActionBatches",
    "privateLessonOutcomeActionBatches",
    "privateLessonAvailabilityTemplates",
    "notificationEvents",
    "studentPrivateAccessSummary",
    "studentPrivateBookingStats",
  ];
  const result = {};
  for (const collectionName of collections) {
    const snap = await db.collection(collectionName).get();
    result[collectionName] = snap.docs
        .map((doc) => ({id: doc.id, data: doc.data()}))
        .sort((left, right) => left.id.localeCompare(right.id));
  }
  return result;
}

async function seedV2Baseline() {
  await seedV2PackageAndMemberships(V2_BASELINE_ACADEMY_ID);
  const canonical = v2Occurrence(
      V2_BASELINE_ACADEMY_ID,
      "v2-baseline-canonical",
  );
  const legacy = v2Occurrence(
      V2_BASELINE_ACADEMY_ID,
      "v2-baseline-legacy",
      {markerMode: "legacy"},
  );
  const terminal = v2Occurrence(
      V2_BASELINE_ACADEMY_ID,
      "v2-baseline-terminal",
      {status: "completed", applied: true},
  );
  const converted = v2Occurrence(
      V2_BASELINE_ACADEMY_ID,
      "v2-baseline-converted",
      {status: "completed", applied: true, convertedLegacy: true},
  );
  await seedV2Occurrence(canonical);
  await seedV2Occurrence(legacy);
  await seedV2Occurrence(terminal, {credit: true});
  await seedV2Occurrence(converted, {
    credit: true,
    ledgerTransition: "lesson_to_reservation",
  });
  await Promise.all([
    db.collection("lessons").doc("v2-normal-ledger-lesson").set({
      academyId: V2_BASELINE_ACADEMY_ID,
      packageId: `${V2_BASELINE_ACADEMY_ID}-package`,
      date: "2026-07-10",
      status: "active",
      sourceType: "direct-private-lesson",
    }),
    db.collection("privateLessonReservations")
        .doc("v2-normal-ledger-reservation")
        .set({
          academyId: V2_BASELINE_ACADEMY_ID,
          packageId: `${V2_BASELINE_ACADEMY_ID}-package`,
          deductionPackageId: `${V2_BASELINE_ACADEMY_ID}-package`,
          studentId: `${V2_BASELINE_ACADEMY_ID}-student`,
          status: "completed",
          deductionApplied: true,
          source: "student",
          sourceType: "privateReservation",
        }),
    db.collection("creditTransactions").doc("v2-normal-credit-a").set({
      academyId: V2_BASELINE_ACADEMY_ID,
      sourceId: "normal-reservation-a",
      sourceType: "privateReservation",
      actionType: "private_reservation_completed_deduct",
      deltaCount: -1,
    }),
    db.collection("creditTransactions").doc("v2-normal-credit-b").set({
      academyId: V2_BASELINE_ACADEMY_ID,
      sourceId: "normal-reservation-b",
      sourceType: "privateReservation",
      actionType: "private_reservation_completed_deduct",
      deltaCount: -1,
    }),
    db.collection("academyMemberships")
        .doc(`${V2_BASELINE_ACADEMY_ID}_extra-teacher`)
        .set({
          academyId: V2_BASELINE_ACADEMY_ID,
          uid: "extra-teacher",
          role: "teacher",
          status: "active",
          teacherKey: "extra-teacher-key",
        }),
  ]);
}

async function testAuditV2BaselinePaginationAndNoWrite() {
  const {aggregateAuditPages, validateAuditV2Page} = await import(
      "../scripts/run-fixed-private-outcome-ledger-audit.mjs"
  );
  const before = await snapshotV2Collections(V2_BASELINE_ACADEMY_ID);
  const adminPage = await inspectLedger({
    auth: v2AdminAuth,
    data: auditPayloadV2(
        V2_BASELINE_ACADEMY_ID,
        "fixedLessons",
        {limit: 1},
    ),
  });
  assert.equal(adminPage.ok, true);
  assert.equal(adminPage.auditVersion, 2);
  assert.ok(adminPage.inventory);
  assert.ok(adminPage.blocking);
  assert.ok(adminPage.samples);
  assert.ok(adminPage.reasons);
  assert.equal(adminPage.page.returnedCount, adminPage.records.length);
  const pages = await scanAllV2(V2_BASELINE_ACADEMY_ID, 1);
  const repeatedPages = await scanAllV2(V2_BASELINE_ACADEMY_ID, 1);
  assert.deepEqual(repeatedPages, pages);
  for (const [family, familyPages] of Object.entries(pages)) {
    for (const page of familyPages) {
      assert.equal(validateAuditV2Page(page, {
        academyId: V2_BASELINE_ACADEMY_ID,
        scanFamily: family,
        cursor: page.page.cursor,
      }), page);
    }
  }
  const summary = aggregateAuditPages(pages);
  const repeatedSummary = aggregateAuditPages(repeatedPages);
  assert.deepEqual(repeatedSummary, summary);
  const occurrenceRecords = Object.values(pages).flat()
      .flatMap((page) => page.records)
      .filter((record) => record.kind === "occurrence");
  const bornCanonicalRecord = occurrenceRecords.find((record) =>
    record.lessonId === "v2-baseline-canonical-lesson",
  );
  const convertedLegacyRecord = occurrenceRecords.find((record) =>
    record.lessonId === "v2-baseline-converted-lesson",
  );
  assert.equal(bornCanonicalRecord.provenance.originMode, "born_canonical");
  assert.equal(bornCanonicalRecord.provenance.hasLegacyEvidence, false);
  assert.equal(
      bornCanonicalRecord.provenance.legacyEvidenceConsistent,
      false,
  );
  assert.equal(
      convertedLegacyRecord.provenance.originMode,
      "converted_legacy",
  );
  assert.equal(convertedLegacyRecord.provenance.hasLegacyEvidence, true);
  assert.equal(
      convertedLegacyRecord.provenance.legacyEvidenceConsistent,
      true,
  );
  assert.equal(summary.complete, true);
  assert.equal(summary.truncated, false);
  assert.equal(summary.omittedCount, 0);
  assert.equal(summary.blockerTotal, 0);
  assert.equal(summary.pass, true);
  assert.equal(summary.counts.canonicalTotal, 3);
  assert.equal(summary.counts.canonicalReady, 1);
  assert.equal(summary.counts.canonicalTerminal, 2);
  assert.equal(summary.counts.legacyTotal, 1);
  assert.equal(summary.counts.currentCanonicalLedgerTotal, 3);
  assert.equal(summary.counts.currentLegacyLedgerTotal, 1);
  assert.equal(summary.counts.currentUnknownOrMixedLedgerTotal, 0);
  assert.equal(summary.counts.currentLedgerOccurrenceTotal, 4);
  assert.equal(summary.counts.bornCanonicalTotal, 2);
  assert.equal(summary.counts.legacyOriginTotal, 2);
  assert.equal(summary.counts.unknownOriginTotal, 0);
  assert.equal(summary.counts.occurrenceOriginTotal, 4);
  assert.equal(summary.counts.legacySafelyConvertible, 1);
  assert.equal(summary.counts.legacyAlreadyConverted, 1);
  assert.equal(summary.counts.legacyTerminal, 0);
  assert.equal(summary.counts.legacyUnsafeToConvert, 0);
  assert.equal(
      summary.counts.legacyOriginTotal,
      summary.counts.legacySafelyConvertible +
        summary.counts.legacyAlreadyConverted +
        summary.counts.legacyTerminal +
        summary.counts.legacyUnsafeToConvert,
  );
  assert.equal(summary.counts.alreadyReservationDeductedConsistent, 2);
  for (const family of Object.keys(pages)) {
    assert.ok(pages[family].length > 1, `${family} must paginate`);
    const last = pages[family][pages[family].length - 1];
    assert.equal(last.complete, true);
    assert.equal(last.truncated, false);
    assert.equal(last.omittedCount, 0);
  }
  const serialized = JSON.stringify(pages);
  for (const pii of [
    "studentName",
    "teacherName",
    "displayName",
    "email",
    "phone",
    V2_TEACHER_KEY,
  ]) {
    assert.equal(serialized.includes(pii), false);
  }
  const after = await snapshotV2Collections(V2_BASELINE_ACADEMY_ID);
  assert.deepEqual(after, before);
}

async function seedV2Blockers() {
  await seedV2PackageAndMemberships(V2_BLOCKER_ACADEMY_ID);
  const cases = [];

  const linkMismatch = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-link-mismatch",
  );
  linkMismatch.reservation.lessonId = "different-lesson";
  cases.push(seedV2Occurrence(linkMismatch));

  const studentMismatch = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-student-mismatch",
  );
  studentMismatch.reservation.studentId = "different-student";
  cases.push(seedV2Occurrence(studentMismatch));

  const academyMismatch = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-academy-mismatch",
  );
  academyMismatch.slot.academyId = "different-academy";
  cases.push(seedV2Occurrence(academyMismatch));

  const packageMismatch = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-package-mismatch",
  );
  packageMismatch.reservation.packageId = "different-package";
  cases.push(seedV2Occurrence(packageMismatch));

  const packageMissing = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-package-missing",
      {packageId: "missing-package"},
  );
  cases.push(seedV2Occurrence(packageMissing));

  const identityConflict = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-identity-conflict",
      {teacher: {teacherUid: "teacher-a"}},
  );
  identityConflict.reservation.teacherUid = "teacher-b";
  cases.push(seedV2Occurrence(identityConflict));

  const missingTeacher = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-teacher-missing",
      {teacher: {teacherKey: "unknown-teacher"}},
  );
  cases.push(seedV2Occurrence(missingTeacher));

  const duplicateName = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-teacher-ambiguous",
      {teacher: {teacherName: "duplicate-name"}},
  );
  cases.push(seedV2Occurrence(duplicateName));

  const mixed = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-unclassifiable",
      {markerMode: "mixed"},
  );
  cases.push(seedV2Occurrence(mixed));

  const inconsistentLegacyOrigin = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-inconsistent-legacy-origin",
      {convertedLegacy: true},
  );
  inconsistentLegacyOrigin.slot.sourceType =
    "weekly-slot-fixed-assignment-v2";
  cases.push(seedV2Occurrence(inconsistentLegacyOrigin));

  const unsafeLegacy = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-legacy-unsafe",
      {markerMode: "legacy"},
  );
  unsafeLegacy.lesson.noDeduction = true;
  cases.push(seedV2Occurrence(unsafeLegacy));

  const outcomeStatusMismatch = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-outcome-status-mismatch",
  );
  outcomeStatusMismatch.lesson.status = "completed";
  outcomeStatusMismatch.reservation.status = "active";
  cases.push(seedV2Occurrence(outcomeStatusMismatch));

  const reverseOutcomeStatusMismatch = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-reverse-outcome-status-mismatch",
  );
  reverseOutcomeStatusMismatch.lesson.status = "active";
  reverseOutcomeStatusMismatch.reservation.status = "completed";
  cases.push(seedV2Occurrence(reverseOutcomeStatusMismatch));

  const terminalOutcomeStatusMismatch = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-terminal-outcome-status-mismatch",
  );
  terminalOutcomeStatusMismatch.lesson.status = "no_show";
  terminalOutcomeStatusMismatch.reservation.status = "completed";
  cases.push(seedV2Occurrence(terminalOutcomeStatusMismatch));

  const evidenceConflict = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-evidence-conflict",
      {status: "completed", applied: true},
  );
  cases.push(seedV2Occurrence(evidenceConflict));

  const duplicateCredit = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-duplicate-credit",
      {status: "completed", applied: true},
  );
  cases.push(seedV2Occurrence(duplicateCredit, {credit: true}));
  cases.push(db.collection("creditTransactions")
      .doc("v2-duplicate-credit-extra")
      .set({
        academyId: V2_BLOCKER_ACADEMY_ID,
        studentId: duplicateCredit.lesson.studentId,
        packageId: duplicateCredit.lesson.packageId,
        sourceId: duplicateCredit.reservationId,
        lessonId: duplicateCredit.lessonId,
        slotId: duplicateCredit.slotId,
        sourceType: "fixedPrivateReservation",
        actionType: "fixed_private_completed_deduct",
        deltaCount: -1,
      }));

  const orphanReservation = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-orphan-reservation",
      {markerMode: "legacy"},
  );
  cases.push(db.collection("privateLessonReservations")
      .doc(orphanReservation.reservationId)
      .set(orphanReservation.reservation));

  const orphanSlot = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-orphan-slot",
      {markerMode: "legacy"},
  );
  cases.push(db.collection("privateLessonSlots")
      .doc(orphanSlot.slotId)
      .set(orphanSlot.slot));

  const missingLink = v2Occurrence(
      V2_BLOCKER_ACADEMY_ID,
      "v2-missing-link",
  );
  cases.push(db.collection("lessons")
      .doc(missingLink.lessonId)
      .set(missingLink.lesson));

  await Promise.all([
    ...cases,
    db.collection("academyMemberships")
        .doc(`${V2_BLOCKER_ACADEMY_ID}_duplicate-name-a`)
        .set({
          academyId: V2_BLOCKER_ACADEMY_ID,
          uid: "duplicate-name-a",
          role: "teacher",
          status: "active",
          teacherName: "duplicate-name",
        }),
    db.collection("academyMemberships")
        .doc(`${V2_BLOCKER_ACADEMY_ID}_duplicate-name-b`)
        .set({
          academyId: V2_BLOCKER_ACADEMY_ID,
          uid: "duplicate-name-b",
          role: "teacher",
          status: "active",
          teacherName: "duplicate-name",
        }),
  ]);
}

async function testAuditV2BlockersAndSecurity() {
  const {aggregateAuditPages} = await import(
      "../scripts/run-fixed-private-outcome-ledger-audit.mjs"
  );
  const before = await snapshotV2Collections(V2_BLOCKER_ACADEMY_ID);
  const pages = await scanAllV2(V2_BLOCKER_ACADEMY_ID, 2);
  const summary = aggregateAuditPages(pages);
  for (const category of [
    "linkMismatch",
    "missingLinkedDocument",
    "academyMismatch",
    "studentMismatch",
    "packageMismatch",
    "packageMissing",
    "teacherOwnershipMissing",
    "teacherOwnershipAmbiguous",
    "teacherIdentityConflict",
    "duplicateDeductionCredit",
    "conflictingDeductionEvidence",
    "unclassifiableOccurrence",
    "orphanFixedReservation",
    "orphanFixedSlot",
    "legacyUnsafeToConvert",
    "fixedProvenanceMismatch",
    "outcomeStatusMismatch",
  ]) {
    assert.ok(summary.counts[category] > 0, `${category} must be detected`);
    assert.ok(summary.samples[category].length > 0);
  }
  assert.ok(summary.counts.outcomeStatusMismatch >= 3);
  assert.equal(summary.pass, false);

  await expectHttpsError(
      inspectLedger({
        auth: teacherAuth,
        data: auditPayloadV2(
            V2_BLOCKER_ACADEMY_ID,
            "fixedLessons",
        ),
      }),
      "permission-denied",
  );
  await expectHttpsError(
      inspectLedger({
        auth: v2StudentAuth,
        data: auditPayloadV2(
            V2_BLOCKER_ACADEMY_ID,
            "fixedLessons",
        ),
      }),
      "permission-denied",
  );
  await expectHttpsError(
      inspectLedger({
        auth: adminAuth,
        data: auditPayloadV2(
            "academy-without-admin-membership",
            "fixedLessons",
        ),
      }),
      "permission-denied",
  );
  const baselineFirstPage = await inspectLedger({
    auth: adminAuth,
    data: auditPayloadV2(
        V2_BASELINE_ACADEMY_ID,
        "fixedLessons",
        {limit: 1},
    ),
  });
  const scopedCursor = baselineFirstPage.page.nextCursor;
  assert.ok(scopedCursor);
  const decodedCursor = decodeAuditCursor(scopedCursor);
  assert.equal(decodedCursor.auditVersion, 2);
  assert.equal(decodedCursor.academyId, V2_BASELINE_ACADEMY_ID);
  assert.equal(decodedCursor.scanFamily, "fixedLessons");

  const invalidCursors = [
    "raw-document-id",
    Buffer.from("not-json", "utf8").toString("base64url"),
    encodeAuditCursor({...decodedCursor, academyId: V2_BLOCKER_ACADEMY_ID}),
    encodeAuditCursor({...decodedCursor, scanFamily: "fixedReservations"}),
    encodeAuditCursor({...decodedCursor, auditVersion: 1}),
    encodeAuditCursor({...decodedCursor, extra: true}),
    encodeAuditCursor({...decodedCursor, lastDocumentId: "missing-document"}),
  ];
  for (const cursor of invalidCursors) {
    await expectHttpsError(
        inspectLedger({
          auth: adminAuth,
          data: auditPayloadV2(
              V2_BASELINE_ACADEMY_ID,
              "fixedLessons",
              {cursor},
          ),
        }),
        "invalid-argument",
    );
  }

  await expectHttpsError(
      inspectLedger({
        auth: adminAuth,
        data: auditPayloadV2(
            V2_BLOCKER_ACADEMY_ID,
            "fixedLessons",
            {cursor: scopedCursor},
        ),
      }),
      "invalid-argument",
  );
  await expectHttpsError(
      inspectLedger({
        auth: adminAuth,
        data: auditPayloadV2(
            V2_BASELINE_ACADEMY_ID,
            "fixedReservations",
            {cursor: scopedCursor},
        ),
      }),
      "invalid-argument",
  );
  const after = await snapshotV2Collections(V2_BLOCKER_ACADEMY_ID);
  assert.deepEqual(after, before);
}

async function testAuditVersionDispatchIsFailClosed() {
  const before = await snapshotV2Collections(V2_BASELINE_ACADEMY_ID);
  const legacyResult = await inspectLedger({
    auth: adminAuth,
    data: {
      academyId: V2_BASELINE_ACADEMY_ID,
      limit: 1,
      cursor: "",
      dryRun: true,
      previewOnly: true,
      commit: false,
    },
  });
  assert.equal(legacyResult.ok, true);
  assert.equal(Object.hasOwn(legacyResult, "auditVersion"), false);

  const v2Result = await inspectLedger({
    auth: adminAuth,
    data: auditPayloadV2(
        V2_BASELINE_ACADEMY_ID,
        "fixedLessons",
        {limit: 1},
    ),
  });
  assert.equal(v2Result.auditVersion, 2);

  for (const auditVersion of [1, 3, 0, -1, "2", null, {}]) {
    await expectHttpsError(
        inspectLedger({
          auth: adminAuth,
          data: auditPayloadV2(
              V2_BASELINE_ACADEMY_ID,
              "fixedLessons",
              {auditVersion},
          ),
        }),
        "invalid-argument",
        "unsupported_audit_version",
    );
  }
  const after = await snapshotV2Collections(V2_BASELINE_ACADEMY_ID);
  assert.deepEqual(after, before);
}

async function main() {
  await seedAuditFixture();
  await testRepresentativeCountsAndReadOnly();
  await testGuardsPermissionAndPagination();
  await seedV2Baseline();
  await testAuditV2BaselinePaginationAndNoWrite();
  await seedV2Blockers();
  await testAuditV2BlockersAndSecurity();
  await testAuditVersionDispatchIsFailClosed();
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
