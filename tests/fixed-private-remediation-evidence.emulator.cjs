"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const PROJECT_ID =
  process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || "";
const ACADEMY_ID = "remediation-evidence-academy";
const OTHER_ACADEMY_ID = "remediation-evidence-other-academy";
const OWNER_UID = "remediation-evidence-owner";
const ADMIN_UID = "remediation-evidence-admin";
const TEACHER_UID = "remediation-evidence-teacher";
const STAFF_UID = "remediation-evidence-staff";
const GENERAL_UID = "remediation-evidence-general";
const INACTIVE_UID = "remediation-evidence-inactive";
const CROSS_ACADEMY_UID = "remediation-evidence-cross-owner";
const STUDENT_ID = "remediation-evidence-student";
const SECOND_STUDENT_ID = "remediation-evidence-student-two";
const PACKAGE_ID = "remediation-evidence-package-a";
const SECOND_PACKAGE_ID = "remediation-evidence-package-b";
const LESSON_ID = "remediation-evidence-lesson-a";
const RESERVATION_ID = "remediation-evidence-reservation-a";
const SLOT_ID = "remediation-evidence-slot-a";
const TEACHER_UID_CASE = "TeacherUID-Case-Must-Stay";
const TEACHER_ID = "Teacher-ID-Case";
const TEACHER_KEY = "Teacher-Key-Case";
const MARKER = "reservation_v1";
const PURPOSE = "local_sensitive_remediation_manifest";
const PII_SECRET = "raw-pii-must-never-be-returned";
const FOREIGN_SECRET = "foreign-row-secret-must-never-be-returned";
const FOREIGN_LESSON_ID = "foreign-linked-lesson";
const FOREIGN_RESERVATION_ID = "foreign-linked-reservation";
const FOREIGN_SLOT_ID = "foreign-linked-slot";
const FOREIGN_PACKAGE_ID = "foreign-linked-package";
const FOREIGN_CREDIT_ID = "foreign-linked-credit";
const FOREIGN_STUDENT_ID = "foreign-linked-student";
const CHAIN_REVERSAL_ID = "remediation-evidence-chain-only-reversal";
const MISSING_STUDENT_ID = "remediation-evidence-missing-student";
const MISSING_SEED_REVERSAL_ID =
  "remediation-evidence-missing-seed-reversal";
const MISSING_SEED_MULTI_ID =
  "remediation-evidence-missing-seed-multi-hop";
const FINAL_MISSING_CREDIT_ID =
  "remediation-evidence-final-missing-credit";
const CYCLE_CREDIT_A_ID = "remediation-evidence-cycle-credit-a";
const CYCLE_CREDIT_B_ID = "remediation-evidence-cycle-credit-b";
const DIRECTLESS_FIXED_CREDIT_ID =
  "remediation-evidence-directless-fixed-credit";
const DIRECT_RESERVATION_CREDIT_ID =
  "remediation-evidence-direct-reservation-credit";
const CONTRADICTORY_TARGET_CREDIT_ID =
  "remediation-evidence-contradictory-target-credit";
const SHARED_ROOT_A_ID = "remediation-evidence-shared-root-a";
const SHARED_ROOT_B_ID = "remediation-evidence-shared-root-b";
const TARGET_RESERVATION_A_ID = "remediation-evidence-target-reservation-a";
const TARGET_RESERVATION_B_ID = "remediation-evidence-target-reservation-b";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required.");
}
if (!PROJECT_ID.startsWith("demo-")) {
  throw new Error("A demo Firebase project is required.");
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID});

const functionsTest = require("firebase-functions-test")({
  projectId: PROJECT_ID,
});
const functions = require("../functions/index.js");
const admin = require("firebase-admin");
const db = admin.firestore();
const inspectEvidence = functionsTest.wrap(
    functions.inspectFixedPrivateLessonOutcomeRemediationEvidence,
);

function auth(uid) {
  return {
    uid,
    token: {
      email: `${PII_SECRET}-${uid}@example.com`,
      name: `${PII_SECRET}-${uid}`,
    },
  };
}

function payload(scanFamily, overrides = {}) {
  return {
    academyId: ACADEMY_ID,
    evidenceVersion: 1,
    scanFamily,
    limit: 2,
    cursor: null,
    purpose: PURPOSE,
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

function deductionId() {
  return [
    "deduct",
    ACADEMY_ID,
    RESERVATION_ID,
    STUDENT_ID,
    PACKAGE_ID,
  ].join("_");
}

function timestamp(iso) {
  return admin.firestore.Timestamp.fromDate(new Date(iso));
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    ).join(",") + "}";
  }
  return JSON.stringify(value);
}

function evidenceDigest(value) {
  return crypto.createHash("sha256")
      .update(stableStringify(value))
      .digest("hex");
}

async function seedFixture() {
  const shared = {
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    fixedPrivatePackageId: PACKAGE_ID,
    source: "fixed_admin",
    sourceType: "fixed-private-slot-assignment",
    reservationType: "fixed",
    fixedPrivateDeductionLedger: MARKER,
    fixedPrivateAssignmentBatchId: "assignment-batch-a",
    privateLessonAvailabilityTemplateId: "template-a",
    renewalBatchId: "renewal-batch-a",
    createdByFlow: "fixed-private-renewal",
    createdBySource: "server-assignment",
    originFlow: "fixed-private",
    originSource: "renewal",
    migrationMarker: "legacy-fixed-private-v1",
    fixedPrivateMigrationMarker: "converted-v1",
    migrationVersion: 1,
    ledgerTransition: "lesson_to_reservation",
    packageType: "private",
    status: "completed",
    attendanceStatus: "completed",
    outcome: "completed",
    outcomeActionType: "complete",
    outcomeActionBatchId: "outcome-batch-a",
    outcomeActionRequestId: "outcome-request-a",
    outcomeByUid: "Outcome-Actor-UID-Case",
    deductionApplied: true,
    deductionSource: "manual",
    deductionStatus: "deducted",
    deductionAttemptNumber: 2,
    deductionCreditTransactionId: deductionId(),
    createdAt: timestamp("2026-07-01T00:00:00.000Z"),
    updatedAt: timestamp("2026-07-02T00:00:00.000Z"),
    deductionAppliedAt: timestamp("2026-07-02T09:59:00.000Z"),
      creditId: CYCLE_CREDIT_A_ID,
    studentName: PII_SECRET,
    teacherName: PII_SECRET,
    email: `${PII_SECRET}@example.com`,
    phone: PII_SECRET,
    address: PII_SECRET,
    token: PII_SECRET,
    profile: {secret: PII_SECRET},
  };
  await Promise.all([
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${OWNER_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: OWNER_UID,
          role: "owner",
          status: "active",
          email: `${PII_SECRET}@example.com`,
        }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${ADMIN_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: ADMIN_UID,
          role: "admin",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${TEACHER_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: TEACHER_UID_CASE,
          authUid: "Auth-UID-Case",
          memberUid: "Member-UID-Case",
          teacherUid: "Teacher-Alias-Case",
          teacherUID: "Teacher-UID-Alias-Case",
          teacherId: TEACHER_ID,
          teacherID: "Teacher-ID-Alias-Case",
          teacherKey: TEACHER_KEY,
          teacherName: PII_SECRET,
          displayName: PII_SECRET,
          role: "teacher",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_document-id-must-not-be-uid`)
        .set({
          academyId: ACADEMY_ID,
          teacherKey: "unmatched-teacher-key",
          role: "teacher",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${STAFF_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: STAFF_UID,
          role: "staff",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${GENERAL_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: GENERAL_UID,
          role: "student",
          status: "active",
        }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${INACTIVE_UID}`)
        .set({
          academyId: ACADEMY_ID,
          uid: INACTIVE_UID,
          role: "admin",
          status: "inactive",
        }),
    db.collection("academyMemberships")
        .doc(`${OTHER_ACADEMY_ID}_${CROSS_ACADEMY_UID}`)
        .set({
          academyId: OTHER_ACADEMY_ID,
          uid: CROSS_ACADEMY_UID,
          role: "owner",
          status: "active",
        }),
    db.collection("privateStudents").doc(STUDENT_ID).set({
      academyId: ACADEMY_ID,
      name: PII_SECRET,
      email: `${PII_SECRET}@example.com`,
      phone: PII_SECRET,
    }),
    db.collection("privateStudents").doc(SECOND_STUDENT_ID).set({
      academyId: ACADEMY_ID,
      name: PII_SECRET,
    }),
    db.collection("studentPackages").doc(PACKAGE_ID).set({
      academyId: ACADEMY_ID,
      studentId: STUDENT_ID,
      packageType: "private",
      packageScope: "fixed",
      status: "active",
      totalCount: 12,
      usedCount: 4,
      remainingCount: 8,
      title: PII_SECRET,
      studentName: PII_SECRET,
    }),
    db.collection("studentPackages").doc(SECOND_PACKAGE_ID).set({
      academyId: ACADEMY_ID,
      studentId: SECOND_STUDENT_ID,
      type: "private",
      scope: "legacy",
      status: "archived",
      usedCount: 2,
      remainingCount: 0,
      title: PII_SECRET,
    }),
    db.collection("lessons").doc(LESSON_ID).set({
      ...shared,
      lessonId: "persisted-lesson-link",
      privateLessonId: "persisted-private-lesson-link",
      fixedLessonId: LESSON_ID,
      reservationId: RESERVATION_ID,
      slotId: SLOT_ID,
      packageId: PACKAGE_ID,
      linkedPackageId: SECOND_PACKAGE_ID,
      packageType: "private",
      teacherUid: TEACHER_UID_CASE,
      teacherUID: "Lesson-UID-Alias-Case",
      instructorUid: "Instructor-UID-Case",
      instructorUID: "Instructor-UID-Alias-Case",
      assignedTeacherId: TEACHER_ID,
      assignedTeacherUid: "Assigned-UID-Case",
      date: "2026-07-02",
      time: "18:00",
      startAt: timestamp("2026-07-02T09:00:00.000Z"),
    }),
    db.collection("privateLessonReservations").doc(RESERVATION_ID).set({
      ...shared,
      lessonId: LESSON_ID,
      fixedLessonId: LESSON_ID,
      linkedLessonId: "persisted-linked-lesson",
      reservationId: "persisted-reservation-link",
      privateLessonReservationId: "persisted-private-reservation-link",
      slotId: SLOT_ID,
      privateLessonSlotId: "persisted-private-slot-link",
      linkedSlotId: "persisted-linked-slot",
      deductionPackageId: PACKAGE_ID,
      teacherId: TEACHER_ID,
      assignedTeacherUID: "Teacher-UID-Alias-Case",
      outcomeStatus: "completed",
      completedAt: timestamp("2026-07-02T10:00:00.000Z"),
      noShowAt: null,
    }),
    db.collection("privateLessonSlots").doc(SLOT_ID).set({
      ...shared,
      lessonId: LESSON_ID,
      fixedLessonId: LESSON_ID,
      linkedLessonId: "persisted-linked-slot-lesson",
      reservationId: RESERVATION_ID,
      linkedReservationId: "persisted-linked-reservation",
      slotId: "persisted-slot-link",
      privateLessonSlotId: "persisted-private-slot-link",
      linkedSlotId: "persisted-linked-slot",
      slotType: "fixed",
      linkedPackageId: SECOND_PACKAGE_ID,
      fixedStudentId: SECOND_STUDENT_ID,
      reservedStudentId: MISSING_STUDENT_ID,
      teacherKey: TEACHER_KEY,
      assignedTeacherKey: TEACHER_KEY,
      deductionTransactionId: "remediation-evidence-missing-credit",
      status: "reserved",
    }),
    db.collection("lessons").doc("remediation-evidence-lesson-b").set({
      academyId: ACADEMY_ID,
      sourceType: "direct-private-lesson",
      status: "active",
      packageId: PACKAGE_ID,
      studentId: STUDENT_ID,
      studentName: PII_SECRET,
    }),
    db.collection("creditTransactions").doc(deductionId()).set({
      academyId: ACADEMY_ID,
      studentId: STUDENT_ID,
      packageId: PACKAGE_ID,
      sourceId: RESERVATION_ID,
      reservationId: RESERVATION_ID,
      lessonId: LESSON_ID,
      fixedLessonId: LESSON_ID,
      slotId: SLOT_ID,
      linkedReservationId: RESERVATION_ID,
      linkedLessonId: LESSON_ID,
      linkedSlotId: SLOT_ID,
      sourceType: "fixedPrivateReservation",
      actionType: "fixed_private_completed_deduct",
      ledgerTransition: "reservation_increment",
      fixedPrivateDeductionLedger: MARKER,
      deltaCount: -1,
      createdAt: timestamp("2026-07-02T10:00:00.000Z"),
      memo: PII_SECRET,
    }),
    db.collection("creditTransactions")
        .doc("remediation-evidence-reversal")
        .set({
          academyId: ACADEMY_ID,
          studentId: STUDENT_ID,
          packageId: SECOND_PACKAGE_ID,
          sourceId: RESERVATION_ID,
          reservationId: RESERVATION_ID,
          lessonId: LESSON_ID,
          slotId: SLOT_ID,
          sourceType: "privateReservation",
          actionType: "private_reservation_deduct_reversal",
          ledgerTransition: "reservation_reversal",
          reversalOfTransactionId: deductionId(),
          originalCreditTransactionId: deductionId(),
          deltaCount: 1,
          createdAt: timestamp("2026-07-03T10:00:00.000Z"),
          reason: PII_SECRET,
        }),
    db.collection("creditTransactions")
        .doc("remediation-evidence-unrelated")
        .set({
          academyId: ACADEMY_ID,
          studentId: "other-student",
          packageId: PACKAGE_ID,
          sourceId: "other-reservation",
          sourceType: "package",
          actionType: "package_adjusted",
          deltaCount: 2,
          createdAt: timestamp("2026-07-04T10:00:00.000Z"),
        }),
    db.collection("creditTransactions").doc(CHAIN_REVERSAL_ID).set({
      academyId: ACADEMY_ID,
      reversalOfTransactionId: "remediation-evidence-reversal",
      originalCreditTransactionId: "remediation-evidence-reversal",
      sourceType: "fixedPrivateReversalChain",
      actionType: "fixed_private_chain_reversal",
      ledgerTransition: "chain_reversal",
      deltaCount: 1,
      createdAt: timestamp("2026-07-05T10:00:00.000Z"),
    }),
    db.collection("creditTransactions").doc(MISSING_SEED_REVERSAL_ID).set({
      academyId: ACADEMY_ID,
      reversalOfTransactionId: "remediation-evidence-missing-credit",
      originalCreditTransactionId: "remediation-evidence-missing-credit",
      sourceType: "fixedPrivateMissingSeedReversal",
      actionType: "fixed_private_missing_seed_reversal",
      ledgerTransition: "missing_seed_reversal",
      deltaCount: 1,
      createdAt: timestamp("2026-07-05T11:00:00.000Z"),
    }),
    db.collection("creditTransactions").doc(MISSING_SEED_MULTI_ID).set({
      academyId: ACADEMY_ID,
      reversalOfTransactionId: MISSING_SEED_REVERSAL_ID,
      originalCreditTransactionId: FINAL_MISSING_CREDIT_ID,
      sourceType: "fixedPrivateMissingSeedMultiHop",
      actionType: "fixed_private_missing_seed_multi_hop",
      ledgerTransition: "missing_seed_multi_hop",
      deltaCount: 1,
      createdAt: timestamp("2026-07-05T12:00:00.000Z"),
    }),
    db.collection("creditTransactions").doc(CYCLE_CREDIT_A_ID).set({
      academyId: ACADEMY_ID,
      originalCreditTransactionId: CYCLE_CREDIT_B_ID,
      reversalOfTransactionId: CYCLE_CREDIT_B_ID,
      sourceType: "fixedPrivateCycle",
      actionType: "cycle_reversal_a",
      deltaCount: 1,
    }),
    db.collection("creditTransactions").doc(CYCLE_CREDIT_B_ID).set({
      academyId: ACADEMY_ID,
      originalCreditTransactionId: CYCLE_CREDIT_A_ID,
      reversalOfTransactionId: CYCLE_CREDIT_A_ID,
      sourceType: "fixedPrivateCycle",
      actionType: "cycle_reversal_b",
      deltaCount: 1,
    }),
    db.collection("lessons").doc("foreign-links-general-root").set({
      academyId: ACADEMY_ID,
      sourceType: "direct-private-lesson",
      reservationId: FOREIGN_RESERVATION_ID,
      slotId: FOREIGN_SLOT_ID,
      packageId: FOREIGN_PACKAGE_ID,
      studentId: FOREIGN_STUDENT_ID,
      deductionCreditTransactionId: FOREIGN_CREDIT_ID,
    }),
    db.collection("privateLessonReservations")
        .doc("foreign-lesson-general-root")
        .set({
          academyId: ACADEMY_ID,
          sourceType: "direct-private-reservation",
          lessonId: FOREIGN_LESSON_ID,
        }),
    db.collection("lessons").doc("same-academy-linked-general-root").set({
      academyId: ACADEMY_ID,
      sourceType: "direct-private-lesson",
      reservationId: "same-academy-fixed-reservation",
    }),
    db.collection("privateLessonReservations")
        .doc("same-academy-fixed-reservation")
        .set({
          academyId: ACADEMY_ID,
          reservationType: "fixed",
          sourceType: "fixed-private-reservation",
          lessonId: "same-academy-linked-general-root",
        }),
    db.collection("lessons").doc("linked-only-alias-root").set({
      academyId: ACADEMY_ID,
      linkedReservationId: "linked-only-alias-reservation",
      linkedSlotId: "linked-only-alias-slot",
      sourceType: "direct-private-lesson",
    }),
    db.collection("privateLessonReservations")
        .doc("linked-only-alias-reservation")
        .set({
          academyId: ACADEMY_ID,
          reservationType: "fixed",
        }),
    db.collection("privateLessonSlots").doc("linked-only-alias-slot").set({
      academyId: ACADEMY_ID,
      slotType: "fixed",
    }),
    db.collection("lessons").doc("same-alias-values-root").set({
      academyId: ACADEMY_ID,
      reservationId: "same-alias-values-reservation",
      linkedReservationId: "same-alias-values-reservation",
      privateLessonReservationId: "same-alias-values-reservation",
      slotId: "same-alias-values-slot",
      linkedSlotId: "same-alias-values-slot",
      privateLessonSlotId: "same-alias-values-slot",
      sourceType: "direct-private-lesson",
    }),
    db.collection("privateLessonReservations")
        .doc("same-alias-values-reservation")
        .set({
          academyId: ACADEMY_ID,
          reservationType: "fixed",
        }),
    db.collection("privateLessonSlots").doc("same-alias-values-slot").set({
      academyId: ACADEMY_ID,
      slotType: "fixed",
    }),
    db.collection("lessons").doc("cross-source-conflict-root").set({
      academyId: ACADEMY_ID,
      reservationId: "cross-source-conflict-reservation-a",
      sourceType: "direct-private-lesson",
    }),
    db.collection("privateLessonReservations")
        .doc("cross-source-conflict-reservation-a")
        .set({
          academyId: ACADEMY_ID,
          reservationId: "cross-source-conflict-reservation-b",
          reservationType: "fixed",
        }),
    db.collection("privateLessonReservations")
        .doc("private-lesson-id-semantic-root")
        .set({
          academyId: ACADEMY_ID,
          privateLessonId: "private-lesson-id-semantic-target",
          sourceType: "direct-private-reservation",
        }),
    db.collection("lessons")
        .doc("private-lesson-id-semantic-target")
        .set({
          academyId: ACADEMY_ID,
          sourceType: "direct-private-lesson",
        }),
    db.collection("lessons").doc(SHARED_ROOT_A_ID).set({
      academyId: ACADEMY_ID,
      studentId: STUDENT_ID,
      packageId: PACKAGE_ID,
      sourceType: "direct-private-lesson",
    }),
    db.collection("lessons").doc(SHARED_ROOT_B_ID).set({
      academyId: ACADEMY_ID,
      studentId: STUDENT_ID,
      packageId: PACKAGE_ID,
      sourceType: "direct-private-lesson",
    }),
    db.collection("privateLessonReservations")
        .doc(TARGET_RESERVATION_A_ID)
        .set({
          academyId: ACADEMY_ID,
          studentId: STUDENT_ID,
          packageId: PACKAGE_ID,
          sourceType: "direct-private-reservation",
        }),
    db.collection("privateLessonReservations")
        .doc(TARGET_RESERVATION_B_ID)
        .set({
          academyId: ACADEMY_ID,
          studentId: STUDENT_ID,
          packageId: PACKAGE_ID,
          sourceType: "direct-private-reservation",
        }),
    db.collection("creditTransactions").doc(DIRECTLESS_FIXED_CREDIT_ID).set({
      academyId: ACADEMY_ID,
      studentId: STUDENT_ID,
      packageId: PACKAGE_ID,
      sourceType: "fixedPrivateReservation",
      actionType: "fixed_private_completed_deduct",
      deltaCount: -1,
    }),
    db.collection("creditTransactions")
        .doc(DIRECT_RESERVATION_CREDIT_ID)
        .set({
          academyId: ACADEMY_ID,
          studentId: STUDENT_ID,
          packageId: PACKAGE_ID,
          sourceId: TARGET_RESERVATION_A_ID,
          reservationId: TARGET_RESERVATION_A_ID,
          sourceType: "fixedPrivateReservation",
          actionType: "fixed_private_completed_deduct",
          deltaCount: -1,
        }),
    db.collection("creditTransactions")
        .doc(CONTRADICTORY_TARGET_CREDIT_ID)
        .set({
          academyId: ACADEMY_ID,
          lessonId: SHARED_ROOT_A_ID,
          reservationId: TARGET_RESERVATION_B_ID,
          sourceType: "fixedPrivateReservation",
          actionType: "fixed_private_completed_deduct",
          deltaCount: -1,
        }),
    db.collection("lessons").doc(FOREIGN_LESSON_ID).set({
      academyId: OTHER_ACADEMY_ID,
      sourceType: "fixed-private-foreign",
      reservationType: "fixed",
      studentId: "foreign-secret-lesson-student",
      packageId: "foreign-secret-lesson-package",
      teacherUid: "foreign-secret-lesson-teacher",
      status: FOREIGN_SECRET,
      studentName: FOREIGN_SECRET,
    }),
    db.collection("privateLessonReservations")
        .doc(FOREIGN_RESERVATION_ID)
        .set({
          academyId: OTHER_ACADEMY_ID,
          sourceType: "fixed-private-foreign",
          reservationType: "fixed",
          lessonId: "foreign-secret-reservation-lesson",
          slotId: "foreign-secret-reservation-slot",
          studentId: "foreign-secret-reservation-student",
          packageId: "foreign-secret-reservation-package",
          teacherUid: "foreign-secret-reservation-teacher",
          status: FOREIGN_SECRET,
          teacherName: FOREIGN_SECRET,
        }),
    db.collection("privateLessonSlots").doc(FOREIGN_SLOT_ID).set({
      academyId: OTHER_ACADEMY_ID,
      sourceType: "fixed-private-foreign",
      slotType: "fixed",
      lessonId: "foreign-secret-slot-lesson",
      reservationId: "foreign-secret-slot-reservation",
      studentId: "foreign-secret-slot-student",
      packageId: "foreign-secret-slot-package",
      teacherUid: "foreign-secret-slot-teacher",
      status: FOREIGN_SECRET,
      profile: {secret: FOREIGN_SECRET},
    }),
    db.collection("studentPackages").doc(FOREIGN_PACKAGE_ID).set({
      academyId: OTHER_ACADEMY_ID,
      studentId: "foreign-secret-package-student",
      type: FOREIGN_SECRET,
      scope: FOREIGN_SECRET,
      status: FOREIGN_SECRET,
      totalCount: 999,
      usedCount: 998,
      remainingCount: 1,
      title: FOREIGN_SECRET,
    }),
    db.collection("creditTransactions").doc(FOREIGN_CREDIT_ID).set({
      academyId: OTHER_ACADEMY_ID,
      studentId: "foreign-secret-credit-student",
      packageId: "foreign-secret-credit-package",
      sourceId: "foreign-secret-credit-source",
      sourceType: FOREIGN_SECRET,
      actionType: FOREIGN_SECRET,
      deltaCount: -999,
      originalCreditTransactionId: "foreign-secret-chain-id",
      createdAt: timestamp("2026-07-06T10:00:00.000Z"),
      memo: FOREIGN_SECRET,
    }),
    db.collection("privateStudents").doc(FOREIGN_STUDENT_ID).set({
      academyId: OTHER_ACADEMY_ID,
      name: FOREIGN_SECRET,
      email: `${FOREIGN_SECRET}@example.com`,
      status: FOREIGN_SECRET,
    }),
  ]);
}

const SNAPSHOT_COLLECTIONS = [
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

async function snapshotCollections() {
  const result = {};
  for (const collectionName of SNAPSHOT_COLLECTIONS) {
    const snap = await db.collection(collectionName).get();
    result[collectionName] = snap.docs
        .map((doc) => ({id: doc.id, data: doc.data()}))
        .sort((left, right) => left.id.localeCompare(right.id));
  }
  return result;
}

async function scanAll(scanFamily, limit = 2) {
  const pages = [];
  let cursor = null;
  do {
    const page = await inspectEvidence({
      auth: auth(OWNER_UID),
      data: payload(scanFamily, {limit, cursor}),
    });
    pages.push(page);
    cursor = page.page.nextCursor;
  } while (pages[pages.length - 1].page.hasMore);
  return pages;
}

function assertExactKeys(value, expected) {
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

const RECORD_KEYS = {
  occurrence: [
    "kind", "rootFamily", "rootId", "occurrenceKey", "academyId",
    "resolvedLinks", "lessonId", "reservationId", "slotId",
    "studentCandidateIds", "studentId", "packageCandidateIds", "packageId",
    "membershipIds", "creditIds", "documentPresence", "documentScopes",
    "storedLinkAliases", "storedLinkConflict", "storedLinks",
    "packageCandidates", "teacher", "provenance", "statusDeduction",
    "schedule", "ledgerTargeting", "credits", "auditFingerprint",
  ],
  credit: [
    "kind", "id", "academyId", "academyScoped", "studentId", "packageId",
    "targeting",
    "sourceType", "actionType", "deltaCount", "ledgerTransition",
    "fixedPrivateDeductionLedger", "effect", "isDeduction", "isReversal",
    "timestamp", "isDeterministicCanonicalId", "ledgerTargeting",
    "auditFingerprint",
  ],
  membership: [
    "kind", "id", "academyId", "uid", "authUid", "memberUid",
    "teacherUid", "teacherUID", "teacherId", "teacherID", "teacherKey",
    "role", "status", "active", "normalizedNameDigest",
    "auditFingerprint",
  ],
  package: [
    "kind", "id", "academyId", "studentId", "type", "scope", "status",
    "totalCount", "usedCount", "remainingCount", "auditFingerprint",
  ],
};
const STORED_LINK_KEYS = [
  "lessonId", "privateLessonId", "fixedLessonId", "linkedLessonId",
  "reservationId", "privateLessonReservationId", "linkedReservationId",
  "slotId", "privateLessonSlotId", "linkedSlotId", "packageId",
  "deductionPackageId", "linkedPackageId", "fixedPrivatePackageId",
];
const TEACHER_EVIDENCE_KEYS = [
  "teacherUid", "teacherUID", "instructorUid", "instructorUID",
  "teacherId", "teacherID", "teacherKey", "assignedTeacherUid",
  "assignedTeacherUID", "assignedTeacherId", "assignedTeacherID",
  "assignedTeacherKey", "normalizedNameDigest",
];
const PACKAGE_CANDIDATE_KEYS = [
  "id", "academyId", "academyScoped", "studentId", "type", "scope",
  "status", "totalCount", "usedCount", "remainingCount", "exists", "sources",
];
const DOCUMENT_SCOPE_KEYS = ["id", "exists", "academyScoped", "academyId"];
const STORED_LINK_ALIAS_SOURCE_KEYS = ["lesson", "reservation", "slot"];
const STORED_LESSON_ALIAS_KEYS = [
  "lessonId", "fixedLessonId", "linkedLessonId", "privateLessonId",
  "uniqueValues", "resolvedValue", "conflict",
];
const STORED_RESERVATION_ALIAS_KEYS = [
  "reservationId", "linkedReservationId", "privateLessonReservationId",
  "uniqueValues", "resolvedValue", "conflict",
];
const STORED_SLOT_ALIAS_KEYS = [
  "slotId", "linkedSlotId", "privateLessonSlotId", "uniqueValues",
  "resolvedValue", "conflict",
];
const LEDGER_TARGETING_KEYS = [
  "collectionFamily", "documentId", "academyId", "studentId", "packageId",
  "reservationId", "lessonId", "slotId", "date", "sourceType",
  "deltaCount", "ledgerTransition", "effect", "isDeduction", "isReversal",
];
const PROVENANCE_RAW_KEYS = [
  "fixedPrivateDeductionLedger", "sourceType", "reservationType", "source",
  "slotType", "fixedPrivateAssignmentBatchId",
  "privateLessonAvailabilityTemplateId", "fixedPrivatePackageId",
  "fixedLessonId", "packageType", "renewalBatchId", "createdByFlow",
  "createdBySource", "originFlow", "originSource", "migrationMarker",
  "fixedPrivateMigrationMarker", "migrationVersion", "ledgerTransition",
];
const STATUS_DEDUCTION_KEYS = [
  "status", "attendance", "attendanceStatus", "outcome", "outcomeStatus",
  "previousOutcomeStatus", "actionType", "statusActionType",
  "outcomeActionType", "deductionApplied", "deductionReversed",
  "noDeduction", "isDeductCancelled", "deductionPackageId",
  "deductionCreditTransactionId", "deductionTransactionId",
  "reversalCreditTransactionId", "originalCreditTransactionId",
  "reversalOfTransactionId", "deductionSource", "deductionStatus",
  "deductionAttemptNumber", "reversalAttemptNumber", "outcomeByUid",
  "outcomeByUID", "outcomeActorUid", "outcomeActorUID", "actorUid",
  "actorUID", "outcomeReversedByUid", "outcomeReversedByUID",
  "createdByUid", "updatedByUid", "requestId", "statusActionRequestId",
  "outcomeActionRequestId", "statusActionBatchId", "outcomeActionBatchId",
  "timestamps",
];
const TIMESTAMP_KEYS = [
  "createdAt", "updatedAt", "completedAt", "noShowAt", "outcomeAt",
  "deductionAppliedAt", "deductionReversedAt", "outcomeReversedAt",
  "attendanceAppliedAt", "ledgerUpdatedAt", "cancelledAt", "reservedAt",
];
const CREDIT_TARGETING_KEYS = [
  "sourceId", "reservationId", "lessonId", "fixedLessonId", "slotId",
  "linkedReservationId", "linkedLessonId", "linkedSlotId",
  "originalCreditTransactionId", "reversalOfTransactionId",
];

async function testAuthenticationAndPayloadGuards() {
  await expectHttpsError(
      inspectEvidence({data: payload("lessons")}),
      "unauthenticated",
  );
  for (const uid of [
    TEACHER_UID,
    STAFF_UID,
    GENERAL_UID,
    INACTIVE_UID,
    CROSS_ACADEMY_UID,
  ]) {
    await expectHttpsError(
        inspectEvidence({
          auth: auth(uid),
          data: payload("lessons"),
        }),
        "permission-denied",
    );
  }
  for (const uid of [OWNER_UID, ADMIN_UID]) {
    const result = await inspectEvidence({
      auth: auth(uid),
      data: payload("lessons", {limit: 1}),
    });
    assert.equal(result.evidenceVersion, 1);
  }
  const invalidOverrides = [
    {evidenceVersion: "1"},
    {evidenceVersion: 2},
    {purpose: `${PURPOSE}-wrong`},
    {dryRun: false},
    {previewOnly: false},
    {commit: true},
    {limit: 0},
    {limit: 51},
    {limit: "2"},
    {cursor: ""},
    {cursor: 1},
    {scanFamily: "fixedLessons"},
    {packageId: PACKAGE_ID},
    {action: "update"},
    {update: {status: "active"}},
  ];
  for (const overrides of invalidOverrides) {
    await expectHttpsError(
        inspectEvidence({
          auth: auth(OWNER_UID),
          data: payload("lessons", overrides),
        }),
        "invalid-argument",
    );
  }
}

async function testPaginationCursorAndEnvelope() {
  const first = await inspectEvidence({
    auth: auth(OWNER_UID),
    data: payload("lessons", {limit: 1, cursor: null}),
  });
  assert.equal(first.page.hasMore, true);
  assert.equal(first.page.complete, false);
  assert.ok(first.page.nextCursor);
  assert.notEqual(first.page.nextCursor, first.records[0].rootId);
  const decoded = JSON.parse(
      Buffer.from(first.page.nextCursor, "base64url").toString("utf8"),
  );
  assert.equal(decoded.namespace, "fixed-private-remediation-evidence-v1");
  assert.equal(decoded.evidenceVersion, 1);
  assert.equal(decoded.academyId, ACADEMY_ID);
  assert.equal(decoded.scanFamily, "lessons");
  let terminal = await inspectEvidence({
    auth: auth(OWNER_UID),
    data: payload("lessons", {
      limit: 1,
      cursor: first.page.nextCursor,
    }),
  });
  while (terminal.page.hasMore) {
    terminal = await inspectEvidence({
      auth: auth(OWNER_UID),
      data: payload("lessons", {
        limit: 1,
        cursor: terminal.page.nextCursor,
      }),
    });
  }
  assert.equal(terminal.page.complete, true);
  assert.equal(terminal.page.hasMore, false);
  assert.equal(terminal.page.nextCursor, null);
  assertExactKeys(first, [
    "evidenceVersion",
    "academyId",
    "scanFamily",
    "dryRun",
    "previewOnly",
    "commit",
    "page",
    "records",
    "pageDigest",
    "schemaDigest",
  ]);
  assertExactKeys(first.page, [
    "pageSize",
    "returnedCount",
    "scannedCount",
    "hasMore",
    "nextCursor",
    "complete",
    "truncated",
    "omittedCount",
  ]);
  assert.equal(first.page.returnedCount, first.records.length);
  assert.equal(first.page.scannedCount, 1);
  assert.equal(first.page.truncated, false);
  assert.equal(first.page.omittedCount, 0);
  const invalidCursors = [
    first.records[0].rootId,
    Buffer.from("not-json").toString("base64url"),
    Buffer.from(JSON.stringify({...decoded, extra: true}))
        .toString("base64url"),
    Buffer.from(JSON.stringify({...decoded, scanFamily: "slots"}))
        .toString("base64url"),
    Buffer.from(JSON.stringify({...decoded, evidenceVersion: 2}))
        .toString("base64url"),
    Buffer.from(JSON.stringify({
      ...decoded,
      lastDocumentId: "missing-document",
    })).toString("base64url"),
  ];
  for (const cursor of invalidCursors) {
    await expectHttpsError(
        inspectEvidence({
          auth: auth(OWNER_UID),
          data: payload("lessons", {limit: 1, cursor}),
        }),
        "invalid-argument",
    );
  }
  await expectHttpsError(
      inspectEvidence({
        auth: auth(OWNER_UID),
        data: payload("slots", {cursor: first.page.nextCursor}),
      }),
      "invalid-argument",
  );
}

function findOccurrence(pages) {
  return pages.flatMap((page) => page.records)
      .find((record) => record.rootId === LESSON_ID);
}

async function testAllEvidenceFamiliesAndDeterminism() {
  const families = [
    "lessons",
    "reservations",
    "slots",
    "credits",
    "memberships",
    "packages",
  ];
  const scans = {};
  const schemaDigests = new Set();
  for (const family of families) {
    scans[family] = await scanAll(family, 1);
    const repeated = await scanAll(family, 1);
    assert.deepEqual(repeated, scans[family]);
    for (const page of scans[family]) {
      assert.equal(page.records.length, page.page.scannedCount);
      assert.equal(page.page.returnedCount, page.records.length);
      assert.match(page.pageDigest, /^[a-f0-9]{64}$/);
      assert.equal(page.pageDigest, evidenceDigest(page.records));
      assert.match(page.schemaDigest, /^[a-f0-9]{64}$/);
      schemaDigests.add(page.schemaDigest);
      for (const record of page.records) {
        assert.match(record.auditFingerprint, /^[a-f0-9]{64}$/);
        const {auditFingerprint, ...content} = record;
        assert.equal(auditFingerprint, evidenceDigest(content));
        assertExactKeys(record, RECORD_KEYS[record.kind]);
      }
    }
  }
  assert.equal(schemaDigests.size, 1);
  const runner = await import(
      "../scripts/run-fixed-private-outcome-ledger-audit.mjs"
  );
  assert.equal(
      [...schemaDigests][0],
      runner.remediationEvidenceSchemaDigest(),
  );
  const shallowSchemaDigest = crypto.createHash("sha256")
      .update(stableStringify({
        evidenceVersion: 1,
        responseKeys: [
          "academyId", "commit", "dryRun", "evidenceVersion", "page",
          "pageDigest", "previewOnly", "records", "scanFamily",
          "schemaDigest",
        ],
        pageKeys: [
          "complete", "hasMore", "nextCursor", "omittedCount", "pageSize",
          "returnedCount", "scannedCount", "truncated",
        ],
        recordKinds: ["occurrence", "credit", "membership", "package"],
      }))
      .digest("hex");
  assert.notEqual([...schemaDigests][0], shallowSchemaDigest);
  const occurrence = findOccurrence(scans.lessons);
  assert.ok(occurrence);
  assert.equal(occurrence.kind, "occurrence");
  assert.deepEqual(occurrence.resolvedLinks, {
    lessonId: LESSON_ID,
    reservationId: null,
    slotId: null,
  });
  assert.equal(occurrence.lessonId, LESSON_ID);
  assert.equal(occurrence.reservationId, RESERVATION_ID);
  assert.equal(occurrence.slotId, SLOT_ID);
  assert.deepEqual(occurrence.studentCandidateIds, [
    MISSING_STUDENT_ID,
    STUDENT_ID,
    SECOND_STUDENT_ID,
  ].sort());
  assert.equal(occurrence.studentId, null);
  assert.deepEqual(occurrence.packageCandidateIds, [
    PACKAGE_ID,
    SECOND_PACKAGE_ID,
  ].sort());
  assert.equal(occurrence.packageId, null);
  assert.equal(occurrence.documentPresence.lesson, true);
  assert.equal(occurrence.documentPresence.reservation, true);
  assert.equal(occurrence.documentPresence.slot, true);
  assert.equal(occurrence.documentPresence.student, false);
  assert.equal(occurrence.documentPresence.package, false);
  assert.deepEqual(
      occurrence.documentPresence.students,
      [
        {
          id: MISSING_STUDENT_ID,
          exists: false,
          academyScoped: null,
          academyId: null,
        },
        {
          id: STUDENT_ID,
          exists: true,
          academyScoped: true,
          academyId: ACADEMY_ID,
        },
        {
          id: SECOND_STUDENT_ID,
          exists: true,
          academyScoped: true,
          academyId: ACADEMY_ID,
        },
      ].sort((left, right) => left.id.localeCompare(right.id)),
  );
  for (const studentPresence of occurrence.documentPresence.students) {
    assertExactKeys(studentPresence, DOCUMENT_SCOPE_KEYS);
  }
  assertExactKeys(occurrence.documentScopes, [
    "lesson", "reservation", "slot", "student",
  ]);
  for (const family of ["lesson", "reservation", "slot", "student"]) {
    assertExactKeys(occurrence.documentScopes[family], DOCUMENT_SCOPE_KEYS);
  }
  assert.equal(occurrence.documentScopes.lesson.academyScoped, true);
  assert.equal(occurrence.documentScopes.reservation.academyScoped, true);
  assert.equal(occurrence.documentScopes.slot.academyScoped, true);
  assert.equal(occurrence.documentScopes.student.academyScoped, null);
  for (const family of ["lesson", "reservation", "slot"]) {
    assertExactKeys(occurrence.storedLinks[family], STORED_LINK_KEYS);
    assertExactKeys(
        occurrence.storedLinkAliases[family],
        STORED_LINK_ALIAS_SOURCE_KEYS,
    );
    assertExactKeys(
        occurrence.storedLinkAliases[family].lesson,
        STORED_LESSON_ALIAS_KEYS,
    );
    assertExactKeys(
        occurrence.storedLinkAliases[family].reservation,
        STORED_RESERVATION_ALIAS_KEYS,
    );
    assertExactKeys(
        occurrence.storedLinkAliases[family].slot,
        STORED_SLOT_ALIAS_KEYS,
    );
    assertExactKeys(occurrence.teacher[family], TEACHER_EVIDENCE_KEYS);
    assertExactKeys(
        occurrence.provenance.raw[family],
        PROVENANCE_RAW_KEYS,
    );
    assertExactKeys(
        occurrence.statusDeduction[family],
        STATUS_DEDUCTION_KEYS,
    );
    assertExactKeys(
        occurrence.statusDeduction[family].timestamps,
        TIMESTAMP_KEYS,
    );
    assertExactKeys(
        occurrence.ledgerTargeting[family],
        LEDGER_TARGETING_KEYS,
    );
  }
  assert.equal(occurrence.storedLinkConflict, true);
  assert.deepEqual(
      occurrence.storedLinkAliases.lesson.lesson.uniqueValues,
      [
        "persisted-lesson-link",
        "persisted-private-lesson-link",
        LESSON_ID,
      ].sort(),
  );
  assert.equal(
      occurrence.storedLinkAliases.lesson.lesson.resolvedValue,
      null,
  );
  assert.equal(
      occurrence.storedLinkAliases.lesson.lesson.conflict,
      true,
  );
  assert.deepEqual(
      occurrence.storedLinkAliases.reservation.reservation.uniqueValues,
      [
        "persisted-private-reservation-link",
        "persisted-reservation-link",
      ].sort(),
  );
  assert.equal(
      occurrence.storedLinkAliases.reservation.reservation.resolvedValue,
      null,
  );
  assert.equal(
      occurrence.storedLinkAliases.reservation.reservation.conflict,
      true,
  );
  assert.equal(occurrence.resolvedLinks.reservationId, null);
  assert.equal(occurrence.resolvedLinks.slotId, null);
  assert.equal(
      occurrence.storedLinks.lesson.lessonId,
      "persisted-lesson-link",
  );
  assert.equal(occurrence.storedLinks.lesson.fixedLessonId, LESSON_ID);
  assert.equal(
      occurrence.storedLinks.lesson.privateLessonId,
      "persisted-private-lesson-link",
  );
  assert.equal(
      occurrence.storedLinks.reservation.linkedLessonId,
      "persisted-linked-lesson",
  );
  assert.equal(
      occurrence.storedLinks.slot.linkedReservationId,
      "persisted-linked-reservation",
  );
  assert.equal(
      occurrence.storedLinks.reservation.reservationId,
      "persisted-reservation-link",
  );
  assert.equal(
      occurrence.storedLinks.reservation.privateLessonReservationId,
      "persisted-private-reservation-link",
  );
  assert.notEqual(
      occurrence.storedLinks.reservation.reservationId,
      occurrence.storedLinks.reservation.privateLessonReservationId,
  );
  assert.equal(occurrence.storedLinks.slot.slotId, "persisted-slot-link");
  assert.equal(
      occurrence.storedLinks.slot.privateLessonSlotId,
      "persisted-private-slot-link",
  );
  assert.notEqual(
      occurrence.storedLinks.slot.slotId,
      occurrence.storedLinks.slot.privateLessonSlotId,
  );
  assert.notEqual(
      occurrence.storedLinks.lesson.lessonId,
      occurrence.resolvedLinks.lessonId,
  );
  assert.notEqual(
      occurrence.storedLinks.slot.slotId,
      occurrence.resolvedLinks.slotId,
  );
  for (const candidate of occurrence.packageCandidates) {
    assertExactKeys(candidate, PACKAGE_CANDIDATE_KEYS);
    assert.equal(candidate.exists, true);
    assert.deepEqual(candidate.sources, [...candidate.sources].sort());
  }
  const firstPackageCandidate = occurrence.packageCandidates.find(
      (candidate) => candidate.id === PACKAGE_ID,
  );
  assert.ok(firstPackageCandidate.sources.includes("lesson.packageId"));
  assert.ok(firstPackageCandidate.sources.includes(
      "reservation.deductionPackageId",
  ));
  assert.equal(firstPackageCandidate.studentId, STUDENT_ID);
  const secondPackageCandidate = occurrence.packageCandidates.find(
      (candidate) => candidate.id === SECOND_PACKAGE_ID,
  );
  assert.ok(secondPackageCandidate.sources.includes(
      "lesson.linkedPackageId",
  ));
  assert.ok(secondPackageCandidate.sources.includes(
      "credit:remediation-evidence-reversal.packageId",
  ));
  assert.equal(secondPackageCandidate.studentId, SECOND_STUDENT_ID);
  assert.ok(occurrence.creditIds.includes(deductionId()));
  assert.ok(
      occurrence.creditIds.includes("remediation-evidence-reversal"),
  );
  assert.ok(occurrence.creditIds.includes(CHAIN_REVERSAL_ID));
  assert.ok(
      occurrence.creditIds.includes("remediation-evidence-missing-credit"),
  );
  assert.ok(occurrence.creditIds.includes(MISSING_SEED_REVERSAL_ID));
  assert.ok(occurrence.creditIds.includes(MISSING_SEED_MULTI_ID));
  assert.ok(occurrence.creditIds.includes(FINAL_MISSING_CREDIT_ID));
  assert.ok(occurrence.creditIds.includes(CYCLE_CREDIT_A_ID));
  assert.ok(occurrence.creditIds.includes(CYCLE_CREDIT_B_ID));
  assert.deepEqual(
      occurrence.documentPresence.credits.find(
          (row) => row.id === "remediation-evidence-missing-credit",
      ),
      {
        id: "remediation-evidence-missing-credit",
        exists: false,
        academyScoped: null,
        academyId: null,
      },
  );
  for (const chainId of [
    MISSING_SEED_REVERSAL_ID,
    MISSING_SEED_MULTI_ID,
  ]) {
    assert.deepEqual(
        occurrence.documentPresence.credits.find(
            (row) => row.id === chainId,
        ),
        {
          id: chainId,
          exists: true,
          academyScoped: true,
          academyId: ACADEMY_ID,
        },
    );
  }
  assert.deepEqual(
      occurrence.documentPresence.credits.find(
          (row) => row.id === FINAL_MISSING_CREDIT_ID,
      ),
      {
        id: FINAL_MISSING_CREDIT_ID,
        exists: false,
        academyScoped: null,
        academyId: null,
      },
  );
  const missingSeedReversal = occurrence.credits.find(
      (row) => row.id === MISSING_SEED_REVERSAL_ID,
  );
  const missingSeedMultiHop = occurrence.credits.find(
      (row) => row.id === MISSING_SEED_MULTI_ID,
  );
  assert.ok(missingSeedReversal);
  assert.ok(missingSeedMultiHop);
  assertExactKeys(missingSeedReversal, RECORD_KEYS.credit);
  assertExactKeys(missingSeedMultiHop, RECORD_KEYS.credit);
  for (const embeddedCredit of [
    missingSeedReversal,
    missingSeedMultiHop,
  ]) {
    const {auditFingerprint, ...content} = embeddedCredit;
    assert.equal(auditFingerprint, evidenceDigest(content));
  }
  assert.equal(missingSeedReversal.studentId, null);
  assert.equal(missingSeedReversal.packageId, null);
  assert.equal(
      missingSeedReversal.targeting.reversalOfTransactionId,
      "remediation-evidence-missing-credit",
  );
  assert.equal(
      missingSeedMultiHop.targeting.reversalOfTransactionId,
      MISSING_SEED_REVERSAL_ID,
  );
  const cycleCredits = occurrence.credits.filter((row) =>
    [CYCLE_CREDIT_A_ID, CYCLE_CREDIT_B_ID].includes(row.id),
  );
  assert.equal(cycleCredits.length, 2);
  assert.equal(
      cycleCredits.find((row) => row.id === CYCLE_CREDIT_A_ID)
          .targeting.originalCreditTransactionId,
      CYCLE_CREDIT_B_ID,
  );
  assert.equal(
      cycleCredits.find((row) => row.id === CYCLE_CREDIT_B_ID)
          .targeting.originalCreditTransactionId,
      CYCLE_CREDIT_A_ID,
  );
  const chainOnlyReversal = occurrence.credits.find(
      (row) => row.id === CHAIN_REVERSAL_ID,
  );
  assert.ok(chainOnlyReversal);
  assert.equal(chainOnlyReversal.studentId, null);
  assert.equal(chainOnlyReversal.packageId, null);
  assert.equal(chainOnlyReversal.targeting.reservationId, null);
  assert.equal(
      chainOnlyReversal.targeting.reversalOfTransactionId,
      "remediation-evidence-reversal",
  );
  assert.equal(chainOnlyReversal.isReversal, true);
  assert.equal(chainOnlyReversal.ledgerTargeting.effect, "reversal");
  assert.deepEqual(
      occurrence.creditIds,
      [...occurrence.creditIds].sort(),
  );
  assert.deepEqual(
      occurrence.credits.map((row) => row.id),
      [...occurrence.credits.map((row) => row.id)].sort(),
  );
  assert.ok(
      occurrence.membershipIds.includes(
          `${ACADEMY_ID}_${TEACHER_UID}`,
      ),
  );
  assert.equal(
      occurrence.teacher.lesson.teacherUid,
      TEACHER_UID_CASE,
  );
  assert.equal(
      occurrence.teacher.lesson.instructorUid,
      "Instructor-UID-Case",
  );
  assert.equal(
      occurrence.teacher.lesson.assignedTeacherUid,
      "Assigned-UID-Case",
  );
  const matchedTeacher = occurrence.teacher.matchedMemberships.find(
      (membership) => membership.teacherId === TEACHER_ID,
  );
  assertExactKeys(
      matchedTeacher,
      RECORD_KEYS.membership.filter(
          (key) => !["kind", "auditFingerprint"].includes(key),
      ),
  );
  assert.equal(matchedTeacher.uid, TEACHER_UID_CASE);
  assert.equal(matchedTeacher.authUid, "Auth-UID-Case");
  assert.equal(matchedTeacher.memberUid, "Member-UID-Case");
  assert.equal(matchedTeacher.teacherKey, TEACHER_KEY);
  assert.equal(matchedTeacher.role, "teacher");
  assert.equal(matchedTeacher.status, "active");
  assert.equal(matchedTeacher.active, true);
  assert.equal(occurrence.provenance.classifier.isFixed, true);
  assert.equal(occurrence.provenance.classifier.ledgerType, "canonical");
  assert.equal(occurrence.provenance.ledger.mode, "canonical");
  assert.equal(
      occurrence.provenance.raw.lesson.renewalBatchId,
      "renewal-batch-a",
  );
  assert.equal(
      occurrence.provenance.raw.lesson.createdByFlow,
      "fixed-private-renewal",
  );
  assert.equal(
      occurrence.provenance.raw.lesson.migrationVersion,
      1,
  );
  assert.equal(
      occurrence.provenance.raw.lesson.ledgerTransition,
      "lesson_to_reservation",
  );
  assert.equal(
      occurrence.statusDeduction.reservation.deductionApplied,
      true,
  );
  assert.equal(
      occurrence.statusDeduction.reservation.attendanceStatus,
      "completed",
  );
  assert.equal(
      occurrence.statusDeduction.reservation.outcomeActionType,
      "complete",
  );
  assert.equal(
      occurrence.statusDeduction.reservation.outcomeByUid,
      "Outcome-Actor-UID-Case",
  );
  assert.equal(
      occurrence.statusDeduction.reservation.outcomeActionRequestId,
      "outcome-request-a",
  );
  assert.equal(
      occurrence.statusDeduction.reservation.timestamps.completedAt,
      "2026-07-02T10:00:00.000Z",
  );
  assert.equal(
      occurrence.statusDeduction.reservation.timestamps
          .deductionAppliedAt,
      "2026-07-02T09:59:00.000Z",
  );
  assert.equal(
      occurrence.schedule.lesson.startAt,
      "2026-07-02T09:00:00.000Z",
  );
  assert.equal(
      occurrence.ledgerTargeting.lesson.collectionFamily,
      "lessons",
  );
  assert.equal(
      occurrence.ledgerTargeting.lesson.documentId,
      LESSON_ID,
  );
  assert.equal(
      occurrence.ledgerTargeting.lesson.effect,
      "deduction",
  );

  const direct = scans.lessons.flatMap((page) => page.records)
      .find((record) =>
        record.rootId === "remediation-evidence-lesson-b",
      );
  assert.ok(direct);
  assert.equal(direct.provenance.classifier.isFixed, false);
  assert.equal(direct.provenance.classifier.evidence.length, 0);

  const foreignLinked = scans.lessons.flatMap((page) => page.records)
      .find((record) => record.rootId === "foreign-links-general-root");
  assert.ok(foreignLinked);
  assert.equal(foreignLinked.provenance.classifier.isFixed, false);
  assert.equal(
      foreignLinked.storedLinks.lesson.reservationId,
      FOREIGN_RESERVATION_ID,
  );
  assert.equal(
      foreignLinked.storedLinks.lesson.slotId,
      FOREIGN_SLOT_ID,
  );
  assert.equal(
      foreignLinked.storedLinks.reservation.lessonId,
      null,
  );
  assert.equal(foreignLinked.storedLinks.slot.lessonId, null);
  assert.deepEqual(
      foreignLinked.storedLinkAliases.reservation.lesson.uniqueValues,
      [],
  );
  assert.equal(foreignLinked.documentScopes.lesson.academyScoped, true);
  assert.deepEqual(foreignLinked.documentScopes.reservation, {
    id: FOREIGN_RESERVATION_ID,
    exists: true,
    academyScoped: false,
    academyId: OTHER_ACADEMY_ID,
  });
  assert.deepEqual(foreignLinked.documentScopes.slot, {
    id: FOREIGN_SLOT_ID,
    exists: true,
    academyScoped: false,
    academyId: OTHER_ACADEMY_ID,
  });
  assert.deepEqual(foreignLinked.documentScopes.student, {
    id: FOREIGN_STUDENT_ID,
    exists: true,
    academyScoped: false,
    academyId: OTHER_ACADEMY_ID,
  });
  assert.deepEqual(foreignLinked.documentPresence.students, [{
    id: FOREIGN_STUDENT_ID,
    exists: true,
    academyScoped: false,
    academyId: OTHER_ACADEMY_ID,
  }]);
  assert.equal(
      foreignLinked.teacher.reservation.teacherUid,
      null,
  );
  assert.equal(
      foreignLinked.provenance.raw.reservation.sourceType,
      null,
  );
  assert.equal(
      foreignLinked.statusDeduction.reservation.status,
      null,
  );
  const foreignPackage = foreignLinked.packageCandidates.find(
      (candidate) => candidate.id === FOREIGN_PACKAGE_ID,
  );
  assert.deepEqual(foreignPackage, {
    id: FOREIGN_PACKAGE_ID,
    academyId: OTHER_ACADEMY_ID,
    academyScoped: false,
    studentId: null,
    type: null,
    scope: null,
    status: null,
    totalCount: null,
    usedCount: null,
    remainingCount: null,
    exists: true,
    sources: ["lesson.packageId"],
  });
  const foreignCredit = foreignLinked.credits.find(
      (credit) => credit.id === FOREIGN_CREDIT_ID,
  );
  assert.ok(foreignCredit);
  assert.equal(foreignCredit.academyId, OTHER_ACADEMY_ID);
  assert.equal(foreignCredit.academyScoped, false);
  assert.equal(foreignCredit.studentId, null);
  assert.equal(foreignCredit.packageId, null);
  assert.equal(foreignCredit.sourceType, null);
  assert.equal(foreignCredit.deltaCount, null);
  assert.equal(foreignCredit.timestamp, null);
  assert.equal(foreignCredit.isDeduction, false);
  assert.equal(foreignCredit.isReversal, false);
  assert.deepEqual(
      Object.values(foreignCredit.targeting),
      Object.values(foreignCredit.targeting).map(() => null),
  );
  const foreignLessonLinked =
    scans.reservations.flatMap((page) => page.records)
        .find((record) => record.rootId === "foreign-lesson-general-root");
  assert.ok(foreignLessonLinked);
  assert.equal(foreignLessonLinked.provenance.classifier.isFixed, false);
  assert.deepEqual(foreignLessonLinked.documentScopes.lesson, {
    id: FOREIGN_LESSON_ID,
    exists: true,
    academyScoped: false,
    academyId: OTHER_ACADEMY_ID,
  });
  const sameAcademyLinked =
    scans.lessons.flatMap((page) => page.records)
        .find((record) =>
          record.rootId === "same-academy-linked-general-root",
        );
  assert.ok(sameAcademyLinked);
  assert.equal(
      sameAcademyLinked.documentScopes.reservation.academyScoped,
      true,
  );
  assert.equal(sameAcademyLinked.provenance.classifier.isFixed, true);
  const linkedOnly = scans.lessons.flatMap((page) => page.records)
      .find((record) => record.rootId === "linked-only-alias-root");
  assert.ok(linkedOnly);
  assert.equal(linkedOnly.storedLinkConflict, false);
  assert.deepEqual(linkedOnly.resolvedLinks, {
    lessonId: "linked-only-alias-root",
    reservationId: "linked-only-alias-reservation",
    slotId: "linked-only-alias-slot",
  });
  assert.equal(
      linkedOnly.storedLinkAliases.lesson.reservation.reservationId,
      null,
  );
  assert.equal(
      linkedOnly.storedLinkAliases.lesson.reservation.linkedReservationId,
      "linked-only-alias-reservation",
  );
  assert.deepEqual(
      linkedOnly.storedLinkAliases.lesson.reservation.uniqueValues,
      ["linked-only-alias-reservation"],
  );
  const sameAliases = scans.lessons.flatMap((page) => page.records)
      .find((record) => record.rootId === "same-alias-values-root");
  assert.ok(sameAliases);
  assert.equal(sameAliases.storedLinkConflict, false);
  assert.equal(
      sameAliases.storedLinkAliases.lesson.reservation.resolvedValue,
      "same-alias-values-reservation",
  );
  assert.deepEqual(
      sameAliases.storedLinkAliases.lesson.reservation.uniqueValues,
      ["same-alias-values-reservation"],
  );
  assert.equal(
      sameAliases.storedLinkAliases.lesson.reservation.conflict,
      false,
  );
  assert.deepEqual(sameAliases.resolvedLinks, {
    lessonId: "same-alias-values-root",
    reservationId: "same-alias-values-reservation",
    slotId: "same-alias-values-slot",
  });
  const crossSourceConflict =
    scans.lessons.flatMap((page) => page.records)
        .find((record) => record.rootId === "cross-source-conflict-root");
  assert.ok(crossSourceConflict);
  assert.equal(
      crossSourceConflict.storedLinkAliases.lesson.reservation.conflict,
      false,
  );
  assert.equal(
      crossSourceConflict.storedLinkAliases.reservation.reservation
          .conflict,
      false,
  );
  assert.equal(crossSourceConflict.storedLinkConflict, true);
  assert.equal(crossSourceConflict.resolvedLinks.reservationId, null);
  const privateLessonSemantic =
    scans.reservations.flatMap((page) => page.records)
        .find((record) =>
          record.rootId === "private-lesson-id-semantic-root",
        );
  assert.ok(privateLessonSemantic);
  assert.equal(
      privateLessonSemantic.storedLinkAliases.reservation.lesson
          .privateLessonId,
      "private-lesson-id-semantic-target",
  );
  assert.equal(
      privateLessonSemantic.storedLinkAliases.reservation.lesson
          .resolvedValue,
      "private-lesson-id-semantic-target",
  );
  assert.equal(
      privateLessonSemantic.resolvedLinks.lessonId,
      "private-lesson-id-semantic-target",
  );
  const sharedA = scans.lessons.flatMap((page) => page.records)
      .find((record) => record.rootId === SHARED_ROOT_A_ID);
  const sharedB = scans.lessons.flatMap((page) => page.records)
      .find((record) => record.rootId === SHARED_ROOT_B_ID);
  const targetReservationA =
    scans.reservations.flatMap((page) => page.records)
        .find((record) => record.rootId === TARGET_RESERVATION_A_ID);
  const targetReservationB =
    scans.reservations.flatMap((page) => page.records)
        .find((record) => record.rootId === TARGET_RESERVATION_B_ID);
  assert.ok(sharedA);
  assert.ok(sharedB);
  assert.ok(targetReservationA);
  assert.ok(targetReservationB);
  assert.equal(sharedA.creditIds.includes(DIRECTLESS_FIXED_CREDIT_ID), false);
  assert.equal(sharedB.creditIds.includes(DIRECTLESS_FIXED_CREDIT_ID), false);
  assert.equal(
      targetReservationA.creditIds.includes(DIRECT_RESERVATION_CREDIT_ID),
      true,
  );
  assert.equal(
      targetReservationB.creditIds.includes(DIRECT_RESERVATION_CREDIT_ID),
      false,
  );
  assert.equal(
      sharedA.creditIds.includes(CONTRADICTORY_TARGET_CREDIT_ID),
      true,
  );
  assert.equal(
      targetReservationB.creditIds.includes(
          CONTRADICTORY_TARGET_CREDIT_ID,
      ),
      true,
  );
  for (const targetOccurrence of [sharedA, targetReservationB]) {
    const contradictory = targetOccurrence.credits.find(
        (credit) => credit.id === CONTRADICTORY_TARGET_CREDIT_ID,
    );
    assert.equal(contradictory.targeting.lessonId, SHARED_ROOT_A_ID);
    assert.equal(
        contradictory.targeting.reservationId,
        TARGET_RESERVATION_B_ID,
    );
  }

  const creditRecords = scans.credits.flatMap((page) => page.records);
  assert.ok(
      creditRecords.some((row) => row.id === DIRECTLESS_FIXED_CREDIT_ID),
  );
  const deduction = creditRecords.find((row) => row.id === deductionId());
  const reversal = creditRecords.find(
      (row) => row.id === "remediation-evidence-reversal",
  );
  assert.equal(deduction.kind, "credit");
  assert.equal(deduction.academyScoped, true);
  assertExactKeys(deduction.targeting, CREDIT_TARGETING_KEYS);
  assertExactKeys(deduction.ledgerTargeting, LEDGER_TARGETING_KEYS);
  assert.equal(deduction.targeting.reservationId, RESERVATION_ID);
  assert.equal(deduction.targeting.lessonId, LESSON_ID);
  assert.equal(deduction.targeting.slotId, SLOT_ID);
  assert.equal(deduction.sourceType, "fixedPrivateReservation");
  assert.equal(deduction.deltaCount, -1);
  assert.equal(deduction.ledgerTransition, "reservation_increment");
  assert.equal(deduction.effect, "deduction");
  assert.equal(deduction.isDeduction, true);
  assert.equal(deduction.isReversal, false);
  assert.equal(deduction.isDeterministicCanonicalId, true);
  assert.equal(deduction.timestamp, "2026-07-02T10:00:00.000Z");
  assert.equal(reversal.effect, "reversal");
  assert.equal(reversal.isReversal, true);
  assert.equal(
      reversal.targeting.reversalOfTransactionId,
      deductionId(),
  );

  const memberships = scans.memberships.flatMap((page) => page.records);
  const teacherMembership = memberships.find(
      (row) => row.teacherId === TEACHER_ID,
  );
  assert.equal(teacherMembership.kind, "membership");
  assert.equal(teacherMembership.uid, TEACHER_UID_CASE);
  assert.equal(teacherMembership.teacherUid, "Teacher-Alias-Case");
  assert.equal(teacherMembership.teacherUID, "Teacher-UID-Alias-Case");
  assert.equal(teacherMembership.teacherKey, TEACHER_KEY);
  assert.equal(teacherMembership.authUid, "Auth-UID-Case");
  assert.equal(teacherMembership.memberUid, "Member-UID-Case");
  assert.match(
      teacherMembership.normalizedNameDigest,
      /^[a-f0-9]{64}$/,
  );
  const membershipWithoutUid = memberships.find(
      (row) => row.id ===
        `${ACADEMY_ID}_document-id-must-not-be-uid`,
  );
  assert.equal(membershipWithoutUid.uid, null);
  assert.equal(membershipWithoutUid.authUid, null);
  assert.equal(membershipWithoutUid.memberUid, null);

  const packages = scans.packages.flatMap((page) => page.records);
  const packageRecord = packages.find((row) => row.id === PACKAGE_ID);
  assert.deepEqual({
    kind: packageRecord.kind,
    academyId: packageRecord.academyId,
    studentId: packageRecord.studentId,
    type: packageRecord.type,
    scope: packageRecord.scope,
    status: packageRecord.status,
    totalCount: packageRecord.totalCount,
    usedCount: packageRecord.usedCount,
    remainingCount: packageRecord.remainingCount,
  }, {
    kind: "package",
    academyId: ACADEMY_ID,
    studentId: STUDENT_ID,
    type: "private",
    scope: "fixed",
    status: "active",
    totalCount: 12,
    usedCount: 4,
    remainingCount: 8,
  });

  const serialized = JSON.stringify(scans);
  for (const forbidden of [
    PII_SECRET,
    FOREIGN_SECRET,
    "foreign-secret-lesson-student",
    "foreign-secret-lesson-package",
    "foreign-secret-lesson-teacher",
    "foreign-secret-reservation-lesson",
    "foreign-secret-reservation-slot",
    "foreign-secret-reservation-student",
    "foreign-secret-reservation-package",
    "foreign-secret-reservation-teacher",
    "foreign-secret-slot-lesson",
    "foreign-secret-slot-reservation",
    "foreign-secret-slot-student",
    "foreign-secret-slot-package",
    "foreign-secret-slot-teacher",
    "foreign-secret-package-student",
    "foreign-secret-credit-student",
    "foreign-secret-credit-package",
    "foreign-secret-credit-source",
    "foreign-secret-chain-id",
    "studentName",
    "teacherName",
    "displayName",
    "email",
    "phone",
    "address",
    "token",
    "Authorization",
    "profile",
    "fullProfile",
    "actorName",
    "outcomeActorName",
    "outcomeReversedByName",
    "reason",
    "memo",
    "packageTitle",
    "title",
    "subject",
  ]) {
    assert.equal(serialized.includes(forbidden), false);
  }
}

async function main() {
  await seedFixture();
  const before = await snapshotCollections();
  await testAuthenticationAndPayloadGuards();
  await testPaginationCursorAndEnvelope();
  await testAllEvidenceFamiliesAndDeterminism();
  const after = await snapshotCollections();
  assert.deepEqual(after, before);
  console.log("fixed private remediation evidence emulator tests passed");
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
