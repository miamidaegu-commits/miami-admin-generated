"use strict";

const assert = require("node:assert/strict");

const PROJECT_ID = "demo-fixed-private-outcome";
const ACADEMY_ID = "fixed-private-outcome-academy";
const ADMIN_UID = "fixed-private-outcome-admin";
const TEACHER_UID = "fixed-private-outcome-teacher";
const OTHER_TEACHER_UID = "fixed-private-outcome-other-teacher";
const TEACHER_KEY = "fixed-private-outcome-teacher-key";
const MARKER = "reservation_v1";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required.");
}
if (!PROJECT_ID.startsWith("demo-")) {
  throw new Error("Fixed private outcome tests require a demo project.");
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID});
process.env.PRIVATE_SLOT_BOOKING_ENABLED = "true";

const {Transaction} = require(
    "../functions/node_modules/@google-cloud/firestore",
);
const originalTransactionGet = Transaction.prototype.get;
// Firestore emulator v1.20.4 can close a retried transaction while parallel
// RunQuery reads are still in flight. Serialize reads inside each test-only
// transaction without serializing the two concurrent callable invocations.
Transaction.prototype.get = function serializedEmulatorTransactionGet(ref) {
  const previous = this.__fixedOutcomeReadChain || Promise.resolve();
  const current = previous.then(() => originalTransactionGet.call(this, ref));
  this.__fixedOutcomeReadChain = current.then(
      () => undefined,
      () => undefined,
  );
  return current;
};

const functionsTest = require(
    "../functions/node_modules/firebase-functions-test",
)({projectId: PROJECT_ID});
const functions = require("../functions/index.js");
const admin = require("../functions/node_modules/firebase-admin");

const db = admin.firestore();
const previewOutcome = functionsTest.wrap(
    functions.previewFixedPrivateLessonOutcomeAction,
);
const commitOutcome = functionsTest.wrap(
    functions.commitFixedPrivateLessonOutcomeAction,
);
const createAssignment = functionsTest.wrap(
    functions.createFixedPrivateLessonAssignment,
);
const studentCancel = functionsTest.wrap(
    functions.cancelPrivateLessonReservation,
);
const adminCancel = functionsTest.wrap(
    functions.adminCancelPrivateLessonReservation,
);
const adminCloseSlot = functionsTest.wrap(
    functions.adminClosePrivateLessonSlot,
);
const adminReopenSlot = functionsTest.wrap(
    functions.adminReopenPrivateLessonSlot,
);
const adminAuth = {
  uid: ADMIN_UID,
  token: {
    email: "fixed-private-admin@example.com",
    name: "Fixed Private Admin",
  },
};
const teacherAuth = {
  uid: TEACHER_UID,
  token: {
    email: "fixed-private-teacher@example.com",
    name: "Fixed Private Teacher",
  },
};
const otherTeacherAuth = {
  uid: OTHER_TEACHER_UID,
  token: {
    email: "other-fixed-private-teacher@example.com",
    name: "Other Fixed Private Teacher",
  },
};
const STUDENT_UID = "fixed-private-outcome-student-user";
const studentAuth = {
  uid: STUDENT_UID,
  token: {
    email: "fixed-private-student@example.com",
    name: "Fixed Private Student",
  },
};

function buildPreviewData(fixture, requestId, actionType = "complete") {
  return {
    academyId: ACADEMY_ID,
    lessonId: fixture.lessonId,
    reservationId: fixture.reservationId,
    slotId: fixture.slotId,
    packageId: fixture.packageId,
    requestId,
    actionType,
    commit: false,
    dryRun: true,
    previewOnly: true,
  };
}

function buildCommitData(previewData, planHash) {
  return {
    ...previewData,
    planHash,
    commit: true,
    dryRun: false,
    previewOnly: false,
  };
}

async function expectHttpsError(promise, code, blockedReason) {
  try {
    await promise;
    assert.fail(`Expected ${code} HttpsError.`);
  } catch (error) {
    assert.equal(error.code, code);
    if (blockedReason) {
      assert.ok(
          Array.isArray(error.details && error.details.blockedReasons),
      );
      assert.ok(error.details.blockedReasons.includes(blockedReason));
    }
    return error;
  }
}

async function seedMembership(uid, {
  role,
  teacherKey = "",
  teacherId = "",
  teacherName = teacherKey,
  status = "active",
  canManageOwnLessonDeductions = false,
  membershipTeacherUid = "",
}) {
  await db.collection("academyMemberships")
      .doc(`${ACADEMY_ID}_${uid}`)
      .set({
        academyId: ACADEMY_ID,
        uid,
        role,
        status,
        displayName: uid,
        teacherName,
        teacherKey,
        teacherId,
        ...(membershipTeacherUid ? {teacherUID: membershipTeacherUid} : {}),
        permissions: {
          canManageOwnLessonDeductions,
        },
      });
}

async function seedFixture({
  name,
  mode = "canonical",
  usedCount = mode === "legacy" ? 1 : 0,
  remainingCount = mode === "legacy" ? 1 : 2,
  packageStatus = "active",
  teacherKey = TEACHER_KEY,
  secondOccurrence = false,
}) {
  const studentId = `${name}-student`;
  const lessonId = `${name}-lesson`;
  const reservationId = `${name}-reservation`;
  const slotId = `${name}-slot`;
  const packageId = `${name}-package`;
  const startAt = admin.firestore.Timestamp.fromMillis(
      Date.now() - 2 * 60 * 60 * 1000,
  );
  const markerPatch = mode === "canonical" ?
    {fixedPrivateDeductionLedger: MARKER} :
    {};
  const lesson = {
    academyId: ACADEMY_ID,
    id: lessonId,
    lessonId,
    fixedLessonId: lessonId,
    reservationId,
    slotId,
    studentId,
    studentID: studentId,
    studentName: `${name} student`,
    teacher: teacherKey,
    teacherName: teacherKey,
    teacherKey,
    teacherUid: TEACHER_UID,
    date: "2026-07-11",
    time: "17:00",
    startAt,
    durationMinutes: 50,
    status: "active",
    packageId,
    deductionPackageId: packageId,
    linkedPackageId: packageId,
    fixedPrivatePackageId: packageId,
    packageType: "private",
    source: "fixed_admin",
    sourceType: "fixed-private-slot-assignment",
    reservationType: "fixed",
    ...markerPatch,
  };
  const reservation = {
    academyId: ACADEMY_ID,
    lessonId,
    fixedLessonId: lessonId,
    slotId,
    studentId,
    studentName: `${name} student`,
    teacher: teacherKey,
    teacherName: teacherKey,
    teacherKey,
    teacherUid: TEACHER_UID,
    date: "2026-07-11",
    time: "17:00",
    startAt,
    durationMinutes: 50,
    status: "active",
    packageId,
    deductionPackageId: packageId,
    linkedPackageId: packageId,
    fixedPrivatePackageId: packageId,
    source: "fixed_admin",
    sourceType: "fixed-private-slot-assignment",
    reservationType: "fixed",
    deductionApplied: false,
    ...markerPatch,
  };
  const slot = {
    academyId: ACADEMY_ID,
    lessonId,
    fixedLessonId: lessonId,
    reservationId,
    reservedStudentId: studentId,
    fixedStudentId: studentId,
    teacher: teacherKey,
    teacherName: teacherKey,
    teacherKey,
    teacherUid: TEACHER_UID,
    date: "2026-07-11",
    time: "17:00",
    startAt,
    durationMinutes: 50,
    status: "reserved",
    slotType: "fixed",
    packageId,
    deductionPackageId: packageId,
    linkedPackageId: packageId,
    fixedPrivatePackageId: packageId,
    ...markerPatch,
  };
  await Promise.all([
    db.collection("privateStudents").doc(studentId).set({
      academyId: ACADEMY_ID,
      name: `${name} student`,
      teacher: teacherKey,
      status: "active",
    }),
    db.collection("studentPackages").doc(packageId).set({
      academyId: ACADEMY_ID,
      studentId,
      studentName: `${name} student`,
      teacher: teacherKey,
      teacherName: teacherKey,
      teacherKey,
      teacherUid: TEACHER_UID,
      packageType: "private",
      packageTitle: `${name} package`,
      totalCount: usedCount + remainingCount,
      usedCount,
      remainingCount,
      status: packageStatus,
    }),
    db.collection("lessons").doc(lessonId).set(lesson),
    db.collection("privateLessonReservations")
        .doc(reservationId).set(reservation),
    db.collection("privateLessonSlots").doc(slotId).set(slot),
  ]);
  let second = null;
  if (secondOccurrence) {
    const secondLessonId = `${name}-second-lesson`;
    const secondReservationId = `${name}-second-reservation`;
    const secondSlotId = `${name}-second-slot`;
    await Promise.all([
      db.collection("lessons").doc(secondLessonId).set({
        ...lesson,
        id: secondLessonId,
        lessonId: secondLessonId,
        fixedLessonId: secondLessonId,
        reservationId: secondReservationId,
        slotId: secondSlotId,
        date: "2026-07-12",
      }),
      db.collection("privateLessonReservations")
          .doc(secondReservationId).set({
            ...reservation,
            lessonId: secondLessonId,
            fixedLessonId: secondLessonId,
            slotId: secondSlotId,
            date: "2026-07-12",
          }),
      db.collection("privateLessonSlots").doc(secondSlotId).set({
        ...slot,
        lessonId: secondLessonId,
        fixedLessonId: secondLessonId,
        reservationId: secondReservationId,
        date: "2026-07-12",
      }),
    ]);
    second = {
      lessonId: secondLessonId,
      reservationId: secondReservationId,
      slotId: secondSlotId,
    };
  }
  return {
    studentId,
    lessonId,
    reservationId,
    slotId,
    packageId,
    second,
  };
}

async function previewFixture(
    fixture,
    requestId,
    actionType = "complete",
    auth = adminAuth,
) {
  const data = buildPreviewData(fixture, requestId, actionType);
  const preview = await previewOutcome({auth, data});
  return {preview, data};
}

async function assertCommitted(fixture, {
  outcome,
  usedCount,
  remainingCount,
}) {
  const [lessonSnap, reservationSnap, slotSnap, packageSnap] =
    await Promise.all([
      db.collection("lessons").doc(fixture.lessonId).get(),
      db.collection("privateLessonReservations")
          .doc(fixture.reservationId).get(),
      db.collection("privateLessonSlots").doc(fixture.slotId).get(),
      db.collection("studentPackages").doc(fixture.packageId).get(),
    ]);
  for (const snap of [lessonSnap, reservationSnap, slotSnap]) {
    assert.equal(snap.get("fixedPrivateDeductionLedger"), MARKER);
  }
  assert.equal(lessonSnap.get("status"), outcome);
  assert.equal(lessonSnap.get("attendanceStatus"), outcome);
  assert.equal(lessonSnap.get("deductionApplied"), true);
  assert.equal(reservationSnap.get("status"), outcome);
  assert.equal(reservationSnap.get("deductionApplied"), true);
  assert.equal(slotSnap.get("status"), "reserved");
  assert.equal(packageSnap.get("usedCount"), usedCount);
  assert.equal(packageSnap.get("remainingCount"), remainingCount);
  const creditId = reservationSnap.get("deductionCreditTransactionId");
  const creditSnap = await db.collection("creditTransactions")
      .doc(creditId).get();
  assert.equal(creditSnap.exists, true);
  assert.equal(creditSnap.get("sourceId"), fixture.reservationId);
  assert.equal(creditSnap.get("deltaCount"), -1);
  return creditId;
}

async function testCanonicalReplayConflictAndSelectedOnly() {
  const fixture = await seedFixture({
    name: "canonical",
    secondOccurrence: true,
  });
  const requestId = "canonical-request";
  const {preview, data} = await previewFixture(fixture, requestId);
  assert.equal(preview.allowed, true, JSON.stringify(preview));
  assert.equal(preview.ledgerClassification.mode, "canonical");
  assert.equal(preview.packageImpact.usedCountDelta, 1);
  assert.equal(preview.packageImpact.nextUsedCount, 1);
  const payload = buildCommitData(data, preview.planHash);
  const result = await commitOutcome({auth: adminAuth, data: payload});
  assert.equal(result.idempotentReplay, false);
  assert.equal(result.updated.lessons.length, 1);
  const creditId = await assertCommitted(fixture, {
    outcome: "completed",
    usedCount: 1,
    remainingCount: 1,
  });
  const secondLessonSnap = await db.collection("lessons")
      .doc(fixture.second.lessonId).get();
  const secondReservationSnap = await db.collection("privateLessonReservations")
      .doc(fixture.second.reservationId).get();
  assert.equal(secondLessonSnap.get("status"), "active");
  assert.equal(secondReservationSnap.get("status"), "active");
  assert.equal(secondReservationSnap.get("deductionApplied"), false);

  const replay = await commitOutcome({auth: adminAuth, data: payload});
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.creditTransactionId, creditId);
  const conflictBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: adminAuth,
        data: {...payload, actionType: "no_show"},
      }),
      "already-exists",
      "request_id_conflict",
  );
  assert.equal(await snapshotSafetyState(), conflictBefore);
}

async function testLegacyNetZero() {
  const fixture = await seedFixture({
    name: "legacy",
    mode: "legacy",
    remainingCount: 0,
    packageStatus: "exhausted",
  });
  const {preview, data} = await previewFixture(
      fixture,
      "legacy-request",
      "no_show",
  );
  assert.equal(preview.allowed, true);
  assert.equal(preview.ledgerClassification.mode, "legacy");
  assert.equal(preview.packageImpact.usedCountDelta, 0);
  assert.equal(preview.packageImpact.nextUsedCount, 1);
  const result = await commitOutcome({
    auth: adminAuth,
    data: buildCommitData(data, preview.planHash),
  });
  assert.equal(result.outcome, "no_show");
  await assertCommitted(fixture, {
    outcome: "no_show",
    usedCount: 1,
    remainingCount: 0,
  });
  const creditSnap = await db.collection("creditTransactions")
      .doc(result.creditTransactionId).get();
  assert.equal(creditSnap.get("ledgerTransition"), "lesson_to_reservation");
}

async function testStaleAndDuplicateCredit() {
  const staleFixture = await seedFixture({name: "stale"});
  const stale = await previewFixture(staleFixture, "stale-request");
  await db.collection("studentPackages").doc(staleFixture.packageId).update({
    totalCount: 3,
    usedCount: 1,
    remainingCount: 2,
  });
  const aggregateConflict = await previewFixture(
      staleFixture,
      "aggregate-conflict-request",
  );
  assert.equal(aggregateConflict.preview.allowed, false);
  assert.ok(aggregateConflict.preview.blockedReasons.includes(
      "package_aggregate_conflict",
  ));
  const staleBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: adminAuth,
        data: buildCommitData(stale.data, stale.preview.planHash),
      }),
      "failed-precondition",
      "preview_stale",
  );
  assert.equal(await snapshotSafetyState(), staleBefore);
  assert.equal(
      (await db.collection("privateLessonReservations")
          .doc(staleFixture.reservationId).get()).get("status"),
      "active",
  );

  const duplicateFixture = await seedFixture({name: "duplicate"});
  const first = await previewFixture(duplicateFixture, "duplicate-request");
  await db.collection("creditTransactions")
      .doc(first.preview.creditTransactionPreview.id)
      .set({
        academyId: ACADEMY_ID,
        packageId: duplicateFixture.packageId,
        sourceId: duplicateFixture.reservationId,
        deltaCount: -1,
      });
  const blocked = await previewFixture(
      duplicateFixture,
      "duplicate-request",
  );
  assert.equal(blocked.preview.allowed, false);
  assert.ok(blocked.preview.blockedReasons.includes(
      "credit_without_matching_deduction_evidence",
  ));
  const duplicateBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: adminAuth,
        data: buildCommitData(blocked.data, blocked.preview.planHash),
      }),
      "failed-precondition",
      "credit_without_matching_deduction_evidence",
  );
  assert.equal(await snapshotSafetyState(), duplicateBefore);
}

async function testConcurrencyAndTeacherPermission() {
  const fixture = await seedFixture({name: "concurrency"});
  const first = await previewFixture(fixture, "concurrency-a");
  const second = await previewFixture(fixture, "concurrency-b");
  const settled = await Promise.allSettled([
    commitOutcome({
      auth: adminAuth,
      data: buildCommitData(first.data, first.preview.planHash),
    }),
    commitOutcome({
      auth: adminAuth,
      data: buildCommitData(second.data, second.preview.planHash),
    }),
  ]);
  assert.equal(
      settled.filter((entry) => entry.status === "fulfilled").length,
      1,
  );
  const rejected = settled.find((entry) => entry.status === "rejected");
  assert.equal(
      rejected.reason.code,
      "failed-precondition",
      JSON.stringify({
        code: rejected.reason.code,
        message: rejected.reason.message,
        cause: rejected.reason.cause ?
          String(rejected.reason.cause.stack || rejected.reason.cause) :
          "",
        stack: rejected.reason.stack,
        details: rejected.reason.details,
        winnerRequestId: settled.find(
            (entry) => entry.status === "fulfilled",
        )?.value?.requestId,
        loserRequestId: rejected.reason.details?.requestId,
      }),
  );
  assert.ok(rejected.reason.details.blockedReasons.includes("preview_stale"));

  const ownFixture = await seedFixture({name: "teacher-own"});
  const own = await previewFixture(
      ownFixture,
      "teacher-own-request",
      "complete",
      teacherAuth,
  );
  assert.equal(own.preview.allowed, true);
  assert.equal(own.preview.actor.permissionSource,
      "canManageOwnLessonDeductions");
  const ownResult = await commitOutcome({
    auth: teacherAuth,
    data: buildCommitData(own.data, own.preview.planHash),
  });
  assert.equal(ownResult.outcome, "completed");
  await assertCommitted(ownFixture, {
    outcome: "completed",
    usedCount: 1,
    remainingCount: 1,
  });

  const notOwnerFixture = await seedFixture({name: "teacher-not-owner"});
  const notOwner = await previewFixture(
      notOwnerFixture,
      "teacher-not-owner-request",
      "complete",
      otherTeacherAuth,
  );
  assert.equal(notOwner.preview.allowed, false);
  assert.ok(notOwner.preview.blockedReasons.includes("teacher_not_owner"));

  const keyOnlyFixture = await seedFixture({name: "teacher-key-only"});
  await Promise.all([
    db.collection("lessons").doc(keyOnlyFixture.lessonId).update({
      teacherUid: admin.firestore.FieldValue.delete(),
    }),
    db.collection("privateLessonReservations")
        .doc(keyOnlyFixture.reservationId).update({
          teacherUid: admin.firestore.FieldValue.delete(),
        }),
    db.collection("privateLessonSlots").doc(keyOnlyFixture.slotId).update({
      teacherUid: admin.firestore.FieldValue.delete(),
    }),
  ]);
  const keyOnly = await previewFixture(
      keyOnlyFixture,
      "teacher-key-only-request",
      "complete",
      teacherAuth,
  );
  assert.equal(keyOnly.preview.allowed, true, JSON.stringify(keyOnly.preview));

  const uidOnlyFixture = await seedFixture({name: "teacher-uid-only"});
  const identityDeletes = {
    teacher: admin.firestore.FieldValue.delete(),
    teacherName: admin.firestore.FieldValue.delete(),
    teacherKey: admin.firestore.FieldValue.delete(),
  };
  await Promise.all([
    db.collection("lessons").doc(uidOnlyFixture.lessonId)
        .update(identityDeletes),
    db.collection("privateLessonReservations")
        .doc(uidOnlyFixture.reservationId).update(identityDeletes),
    db.collection("privateLessonSlots").doc(uidOnlyFixture.slotId)
        .update(identityDeletes),
  ]);
  const uidOnly = await previewFixture(
      uidOnlyFixture,
      "teacher-uid-only-request",
      "complete",
      teacherAuth,
  );
  assert.equal(uidOnly.preview.allowed, true, JSON.stringify(uidOnly.preview));
}

async function testThreeWayStateFlagsDuplicateAndIds() {
  const stateCases = [
    ["lesson-status", "lessons", {status: "cancelled"}, "lesson_not_active"],
    [
      "reservation-status",
      "privateLessonReservations",
      {status: "completed"},
      "reservation_not_active",
    ],
    ["slot-status", "privateLessonSlots", {status: "released"}, "slot_not_reserved"],
    ["lesson-no-deduction", "lessons", {noDeduction: true}, "lesson_no_deduction"],
    [
      "reservation-cancelled",
      "privateLessonReservations",
      {deductionCancelled: true},
      "reservation_deduction_cancelled",
    ],
    [
      "slot-released",
      "privateLessonSlots",
      {releasedFromFixed: true},
      "slot_released",
    ],
  ];
  for (const [name, collectionName, patch, blockedReason] of stateCases) {
    const fixture = await seedFixture({name: `state-${name}`});
    const docId = collectionName === "lessons" ?
      fixture.lessonId :
      collectionName === "privateLessonReservations" ?
        fixture.reservationId :
        fixture.slotId;
    await db.collection(collectionName).doc(docId).update(patch);
    const result = await previewFixture(
        fixture,
        `state-${name}-request`,
    );
    assert.equal(result.preview.allowed, false);
    assert.ok(
        result.preview.blockedReasons.includes(blockedReason),
        JSON.stringify(result.preview),
    );
  }

  const duplicate = await seedFixture({
    name: "duplicate-ledger-contribution",
    usedCount: 2,
    remainingCount: 1,
  });
  const duplicateLessonId = "duplicate-ledger-existing-lesson";
  const duplicateReservationId = "duplicate-ledger-existing-reservation";
  await Promise.all([
    db.collection("lessons").doc(duplicateLessonId).set({
      academyId: ACADEMY_ID,
      packageId: duplicate.packageId,
      reservationId: duplicateReservationId,
      date: "2026-07-11",
      status: "completed",
    }),
    db.collection("privateLessonReservations")
        .doc(duplicateReservationId).set({
          academyId: ACADEMY_ID,
          deductionPackageId: duplicate.packageId,
          deductionApplied: true,
          status: "completed",
        }),
  ]);
  const duplicatePreview = await previewFixture(
      duplicate,
      "duplicate-ledger-contribution-request",
  );
  assert.equal(duplicatePreview.preview.allowed, false);
  assert.ok(duplicatePreview.preview.blockedReasons.includes(
      "duplicate_fixed_occurrence_contribution",
  ));
  assert.ok(duplicatePreview.preview.blockedReasons.includes(
      "package_aggregate_conflict",
  ));

  await expectHttpsError(
      previewOutcome({
        auth: adminAuth,
        data: {
          ...buildPreviewData(duplicate, "bad-id-request"),
          lessonId: "bad/lesson",
        },
      }),
      "invalid-argument",
  );
  await expectHttpsError(
      previewOutcome({
        auth: adminAuth,
        data: buildPreviewData(duplicate, "x".repeat(129)),
      }),
      "invalid-argument",
  );

  const identityMismatch = await seedFixture({
    name: "teacher-identity-mismatch",
  });
  await Promise.all([
    db.collection("lessons").doc(identityMismatch.lessonId).update({
      teacherId: "stable-teacher-a",
    }),
    db.collection("privateLessonReservations")
        .doc(identityMismatch.reservationId).update({
          teacherId: "stable-teacher-b",
        }),
    db.collection("privateLessonSlots").doc(identityMismatch.slotId).update({
      teacherId: "stable-teacher-a",
    }),
  ]);
  const mismatchPreview = await previewFixture(
      identityMismatch,
      "teacher-identity-mismatch-request",
  );
  assert.equal(mismatchPreview.preview.allowed, false);
  assert.ok(mismatchPreview.preview.blockedReasons.includes(
      "teacher_identity_mismatch",
  ));

  const teacherId = "teacher-id-only-stable-id";
  await db.collection("academyMemberships")
      .doc(`${ACADEMY_ID}_${TEACHER_UID}`)
      .update({teacherId});
  const teacherIdOnly = await seedFixture({name: "teacher-id-only"});
  const teacherIdOnlyPatch = {
    teacherUid: admin.firestore.FieldValue.delete(),
    teacher: admin.firestore.FieldValue.delete(),
    teacherName: admin.firestore.FieldValue.delete(),
    teacherKey: admin.firestore.FieldValue.delete(),
    teacherId,
  };
  await Promise.all([
    db.collection("lessons").doc(teacherIdOnly.lessonId)
        .update(teacherIdOnlyPatch),
    db.collection("privateLessonReservations")
        .doc(teacherIdOnly.reservationId).update(teacherIdOnlyPatch),
    db.collection("privateLessonSlots").doc(teacherIdOnly.slotId)
        .update(teacherIdOnlyPatch),
    db.collection("studentPackages").doc(teacherIdOnly.packageId)
        .update({teacherId}),
  ]);
  const teacherIdOnlyPreview = await previewFixture(
      teacherIdOnly,
      "teacher-id-only-request",
      "complete",
      teacherAuth,
  );
  assert.equal(
      teacherIdOnlyPreview.preview.allowed,
      true,
      JSON.stringify(teacherIdOnlyPreview.preview),
  );
}

async function snapshotSafetyState() {
  const collections = [
    "lessons",
    "privateLessonReservations",
    "privateLessonSlots",
    "privateStudents",
    "studentPackages",
    "creditTransactions",
    "privateLessonStatusActionBatches",
    "privateLessonOutcomeActionBatches",
    "fixedPrivateLessonOutcomeActionBatches",
    "fixedPrivateAssignmentBatches",
    "privateLessonAvailabilityTemplates",
    "notificationEvents",
    "studentPrivateAccessSummary",
    "studentPrivateBookingStats",
  ];
  const result = {};
  for (const collectionName of collections) {
    const snap = await db.collection(collectionName)
        .where("academyId", "==", ACADEMY_ID)
        .get();
    result[collectionName] = snap.docs
        .map((docSnap) => ({id: docSnap.id, data: docSnap.data()}))
        .sort((left, right) => left.id.localeCompare(right.id));
  }
  return JSON.stringify(result);
}

async function snapshotOutcomeSideEffects(fixture) {
  const [privateStudent, summary, bookingStats, notifications, templates] =
    await Promise.all([
      db.collection("privateStudents").doc(fixture.studentId).get(),
      db.collection("studentPrivateAccessSummary")
          .doc(`${ACADEMY_ID}__${fixture.studentId}`).get(),
      db.collection("studentPrivateBookingStats")
          .doc(`${ACADEMY_ID}__${fixture.studentId}`).get(),
      db.collection("notificationEvents")
          .where("academyId", "==", ACADEMY_ID).get(),
      db.collection("privateLessonAvailabilityTemplates")
          .where("academyId", "==", ACADEMY_ID).get(),
    ]);
  const collectionRows = (snap) => snap.docs
      .map((docSnap) => ({id: docSnap.id, data: docSnap.data()}))
      .sort((left, right) => left.id.localeCompare(right.id));
  return JSON.stringify({
    privateStudent: privateStudent.exists ? privateStudent.data() : null,
    summary: summary.exists ? summary.data() : null,
    bookingStats: bookingStats.exists ? bookingStats.data() : null,
    notifications: collectionRows(notifications),
    templates: collectionRows(templates),
  });
}

async function removeStrongTeacherIdentity(fixture, teacherName) {
  const patch = {
    teacherUid: admin.firestore.FieldValue.delete(),
    teacherUID: admin.firestore.FieldValue.delete(),
    teacherId: admin.firestore.FieldValue.delete(),
    teacherID: admin.firestore.FieldValue.delete(),
    teacherKey: admin.firestore.FieldValue.delete(),
    teacher: teacherName,
    teacherName,
  };
  await Promise.all([
    db.collection("lessons").doc(fixture.lessonId).update(patch),
    db.collection("privateLessonReservations")
        .doc(fixture.reservationId).update(patch),
    db.collection("privateLessonSlots").doc(fixture.slotId).update(patch),
    db.collection("studentPackages").doc(fixture.packageId).update(patch),
  ]);
}

async function testCanonicalNoShowAndLegacyReplay() {
  const canonical = await seedFixture({name: "canonical-no-show"});
  const canonicalPreview = await previewFixture(
      canonical,
      "canonical-no-show-request",
      "no_show",
  );
  assert.equal(canonicalPreview.preview.allowed, true);
  const canonicalResult = await commitOutcome({
    auth: adminAuth,
    data: buildCommitData(
        canonicalPreview.data,
        canonicalPreview.preview.planHash,
    ),
  });
  assert.equal(canonicalResult.outcome, "no_show");
  await assertCommitted(canonical, {
    outcome: "no_show",
    usedCount: 1,
    remainingCount: 1,
  });

  const legacy = await seedFixture({
    name: "legacy-replay",
    mode: "legacy",
    remainingCount: 0,
    packageStatus: "exhausted",
  });
  const legacyPreview = await previewFixture(
      legacy,
      "legacy-replay-request",
      "no_show",
  );
  const payload = buildCommitData(
      legacyPreview.data,
      legacyPreview.preview.planHash,
  );
  const committed = await commitOutcome({auth: adminAuth, data: payload});
  const replay = await commitOutcome({auth: adminAuth, data: payload});
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.creditTransactionId, committed.creditTransactionId);
  const reprocess = await previewFixture(
      legacy,
      "legacy-reprocess-different-request",
      "no_show",
  );
  assert.equal(reprocess.preview.allowed, false);
  assert.ok(reprocess.preview.blockedReasons.includes(
      "deduction_already_applied",
  ));
  const reprocessBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: adminAuth,
        data: buildCommitData(
            reprocess.data,
            legacyPreview.preview.planHash,
        ),
      }),
      "failed-precondition",
  );
  assert.equal(await snapshotSafetyState(), reprocessBefore);
}

async function testCompleteNoShowConcurrency() {
  for (const mode of ["canonical", "legacy"]) {
    const name = `mixed-concurrency-${mode}`;
    const fixture = await seedFixture({
      name,
      mode,
      usedCount: mode === "canonical" ? 0 : 2,
      remainingCount: mode === "canonical" ? 2 : 0,
      packageStatus: mode === "canonical" ? "active" : "exhausted",
      secondOccurrence: true,
    });
    const requestIds = {
      complete: `${name}-complete`,
      no_show: `${name}-no-show`,
    };
    const completePreview = await previewFixture(
        fixture,
        requestIds.complete,
        "complete",
    );
    const noShowPreview = await previewFixture(
        fixture,
        requestIds.no_show,
        "no_show",
    );
    assert.equal(
        completePreview.preview.allowed,
        true,
        JSON.stringify(completePreview.preview),
    );
    assert.equal(
        noShowPreview.preview.allowed,
        true,
        JSON.stringify(noShowPreview.preview),
    );
    const [
      otherLessonBefore,
      otherReservationBefore,
      otherSlotBefore,
      sideEffectsBefore,
    ] =
      await Promise.all([
        db.collection("lessons").doc(fixture.second.lessonId).get(),
        db.collection("privateLessonReservations")
            .doc(fixture.second.reservationId).get(),
        db.collection("privateLessonSlots").doc(fixture.second.slotId).get(),
        snapshotOutcomeSideEffects(fixture),
      ]);
    const settled = await Promise.allSettled([
      commitOutcome({
        auth: adminAuth,
        data: buildCommitData(
            completePreview.data,
            completePreview.preview.planHash,
        ),
      }),
      commitOutcome({
        auth: adminAuth,
        data: buildCommitData(
            noShowPreview.data,
            noShowPreview.preview.planHash,
        ),
      }),
    ]);
    const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
    const rejected = settled.filter((entry) => entry.status === "rejected");
    assert.equal(fulfilled.length, 1);
    assert.equal(rejected.length, 1);
    assert.equal(rejected[0].reason.code, "failed-precondition");
    assert.ok(rejected[0].reason.details.blockedReasons.includes(
        "preview_stale",
    ));

    const winner = fulfilled[0].value;
    const winnerAction = winner.actionType;
    const loserAction = winnerAction === "complete" ? "no_show" : "complete";
    const winnerOutcome = winnerAction === "complete" ?
      "completed" :
      "no_show";
    assert.equal(winner.outcome, winnerOutcome);
    const [
      lessonSnap,
      reservationSnap,
      slotSnap,
      packageSnap,
      winnerCheckpoint,
      loserCheckpoint,
      credits,
      outcomeCheckpoints,
      otherLessonAfter,
      otherReservationAfter,
      otherSlotAfter,
      sideEffectsAfter,
    ] = await Promise.all([
      db.collection("lessons").doc(fixture.lessonId).get(),
      db.collection("privateLessonReservations")
          .doc(fixture.reservationId).get(),
      db.collection("privateLessonSlots").doc(fixture.slotId).get(),
      db.collection("studentPackages").doc(fixture.packageId).get(),
      db.collection("fixedPrivateLessonOutcomeActionBatches")
          .doc(winner.batchId).get(),
      db.collection("fixedPrivateLessonOutcomeActionBatches")
          .doc([
            "fixedPrivateLessonOutcomeAction",
            ACADEMY_ID,
            requestIds[loserAction],
          ].join("_")).get(),
      db.collection("creditTransactions")
          .where("academyId", "==", ACADEMY_ID)
          .where("sourceId", "==", fixture.reservationId)
          .get(),
      db.collection("fixedPrivateLessonOutcomeActionBatches")
          .where("academyId", "==", ACADEMY_ID)
          .where("lessonId", "==", fixture.lessonId)
          .get(),
      db.collection("lessons").doc(fixture.second.lessonId).get(),
      db.collection("privateLessonReservations")
          .doc(fixture.second.reservationId).get(),
      db.collection("privateLessonSlots").doc(fixture.second.slotId).get(),
      snapshotOutcomeSideEffects(fixture),
    ]);
    for (const docSnap of [lessonSnap, reservationSnap]) {
      assert.equal(docSnap.get("status"), winnerOutcome);
      assert.equal(docSnap.get("outcome"), winnerOutcome);
      assert.equal(docSnap.get("attendanceStatus"), winnerOutcome);
      assert.equal(docSnap.get("outcomeActionType"), winnerAction);
      assert.equal(docSnap.get("outcomeActionBatchId"), winner.batchId);
      assert.equal(
          docSnap.get("outcomeActionRequestId"),
          requestIds[winnerAction],
      );
      assert.equal(docSnap.get("outcomeByUid"), ADMIN_UID);
      assert.equal(docSnap.get("deductionApplied"), true);
    }
    assert.equal(
        lessonSnap.get("deductionCreditTransactionId"),
        reservationSnap.get("deductionCreditTransactionId"),
    );
    assert.equal(
        packageSnap.get("usedCount"),
        mode === "canonical" ? 1 : 2,
    );
    assert.equal(
        packageSnap.get("remainingCount"),
        mode === "canonical" ? 1 : 0,
    );
    assert.equal(credits.size, 1);
    assert.equal(
        credits.docs[0].id,
        reservationSnap.get("deductionCreditTransactionId"),
    );
    assert.equal(credits.docs[0].get("reason"), winnerOutcome);
    assert.equal(winnerCheckpoint.exists, true);
    assert.equal(winnerCheckpoint.get("status"), "completed");
    assert.equal(winnerCheckpoint.get("actionType"), winnerAction);
    assert.equal(outcomeCheckpoints.size, 1);
    assert.equal(loserCheckpoint.exists, false);
    assert.equal(slotSnap.get("status"), "reserved");
    assert.equal(slotSnap.get("lessonId"), fixture.lessonId);
    assert.equal(slotSnap.get("reservationId"), fixture.reservationId);
    assert.equal(slotSnap.get("fixedPrivateDeductionLedger"), MARKER);
    assert.deepEqual(otherLessonAfter.data(), otherLessonBefore.data());
    assert.deepEqual(
        otherReservationAfter.data(),
        otherReservationBefore.data(),
    );
    assert.deepEqual(otherSlotAfter.data(), otherSlotBefore.data());
    assert.equal(sideEffectsAfter, sideEffectsBefore);

    const loserPreview = loserAction === "complete" ?
      completePreview :
      noShowPreview;
    const loserRetryBefore = await snapshotSafetyState();
    await expectHttpsError(
        commitOutcome({
          auth: adminAuth,
          data: buildCommitData(
              loserPreview.data,
              loserPreview.preview.planHash,
          ),
        }),
        "failed-precondition",
    );
    assert.equal(await snapshotSafetyState(), loserRetryBefore);
  }
}

async function testStrictTeacherIdentityPrecedence() {
  const caseTargetUid = "CaseTeacher";
  const caseAuthUid = "caseteacher";
  const sharedCaseIdentity = "case-shared-teacher";
  await seedMembership(caseAuthUid, {
    role: "teacher",
    teacherKey: sharedCaseIdentity,
    teacherId: sharedCaseIdentity,
    teacherName: sharedCaseIdentity,
    membershipTeacherUid: caseTargetUid,
    canManageOwnLessonDeductions: true,
  });
  const caseMismatch = await seedFixture({
    name: "uid-case-mismatch",
    teacherKey: sharedCaseIdentity,
  });
  const caseTargetPatch = {
    teacherUid: caseTargetUid,
    teacherId: sharedCaseIdentity,
    teacherKey: sharedCaseIdentity,
    teacher: sharedCaseIdentity,
    teacherName: sharedCaseIdentity,
  };
  await Promise.all([
    db.collection("lessons").doc(caseMismatch.lessonId)
        .update(caseTargetPatch),
    db.collection("privateLessonReservations").doc(caseMismatch.reservationId)
        .update(caseTargetPatch),
    db.collection("privateLessonSlots").doc(caseMismatch.slotId)
        .update(caseTargetPatch),
    db.collection("studentPackages").doc(caseMismatch.packageId).update({
      teacherUid: caseTargetUid,
      teacherId: sharedCaseIdentity,
      teacherKey: sharedCaseIdentity,
      teacher: sharedCaseIdentity,
      teacherName: sharedCaseIdentity,
    }),
  ]);
  const caseAuth = {uid: caseAuthUid, token: {}};
  const caseMismatchPreview = await previewFixture(
      caseMismatch,
      "uid-case-mismatch-request",
      "complete",
      caseAuth,
  );
  assert.equal(caseMismatchPreview.preview.allowed, false);
  assert.ok(caseMismatchPreview.preview.blockedReasons.includes(
      "teacher_not_owner",
  ));
  const caseMismatchBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: caseAuth,
        data: buildCommitData(
            caseMismatchPreview.data,
            caseMismatchPreview.preview.planHash,
        ),
      }),
      "permission-denied",
      "teacher_not_owner",
  );
  assert.equal(await snapshotSafetyState(), caseMismatchBefore);

  await seedMembership(caseTargetUid, {
    role: "teacher",
    teacherKey: sharedCaseIdentity,
    teacherId: sharedCaseIdentity,
    teacherName: sharedCaseIdentity,
    membershipTeacherUid: caseTargetUid,
    canManageOwnLessonDeductions: true,
  });
  const exactCaseMatch = await seedFixture({
    name: "uid-exact-case-match",
    teacherKey: sharedCaseIdentity,
  });
  await Promise.all([
    db.collection("lessons").doc(exactCaseMatch.lessonId)
        .update(caseTargetPatch),
    db.collection("privateLessonReservations")
        .doc(exactCaseMatch.reservationId).update(caseTargetPatch),
    db.collection("privateLessonSlots").doc(exactCaseMatch.slotId)
        .update(caseTargetPatch),
    db.collection("studentPackages").doc(exactCaseMatch.packageId).update({
      teacherUid: caseTargetUid,
      teacherId: sharedCaseIdentity,
      teacherKey: sharedCaseIdentity,
      teacher: sharedCaseIdentity,
      teacherName: sharedCaseIdentity,
    }),
  ]);
  const exactCasePreview = await previewFixture(
      exactCaseMatch,
      "uid-exact-case-match-request",
      "complete",
      {uid: caseTargetUid, token: {}},
  );
  assert.equal(
      exactCasePreview.preview.allowed,
      true,
      JSON.stringify(exactCasePreview.preview),
  );
  const exactCaseResult = await commitOutcome({
    auth: {uid: caseTargetUid, token: {}},
    data: buildCommitData(
        exactCasePreview.data,
        exactCasePreview.preview.planHash,
    ),
  });
  assert.equal(exactCaseResult.outcome, "completed");

  await db.collection("academyMemberships")
      .doc(`${ACADEMY_ID}_${caseTargetUid}`)
      .update({teacherUID: "DifferentTeacher"});
  const membershipUidConflict = await seedFixture({
    name: "membership-uid-conflict",
    teacherKey: sharedCaseIdentity,
  });
  await Promise.all([
    db.collection("lessons").doc(membershipUidConflict.lessonId)
        .update(caseTargetPatch),
    db.collection("privateLessonReservations")
        .doc(membershipUidConflict.reservationId).update(caseTargetPatch),
    db.collection("privateLessonSlots").doc(membershipUidConflict.slotId)
        .update(caseTargetPatch),
  ]);
  const membershipConflictPreview = await previewFixture(
      membershipUidConflict,
      "membership-uid-conflict-request",
      "complete",
      {uid: caseTargetUid, token: {}},
  );
  assert.equal(membershipConflictPreview.preview.allowed, false);
  assert.ok(membershipConflictPreview.preview.blockedReasons.includes(
      "teacher_not_owner",
  ));
  const membershipConflictBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: {uid: caseTargetUid, token: {}},
        data: buildCommitData(
            membershipConflictPreview.data,
            membershipConflictPreview.preview.planHash,
        ),
      }),
      "permission-denied",
      "teacher_not_owner",
  );
  assert.equal(await snapshotSafetyState(), membershipConflictBefore);

  const uidMismatch = await seedFixture({name: "uid-mismatch"});
  await Promise.all([
    db.collection("lessons").doc(uidMismatch.lessonId).update({
      teacherUid: OTHER_TEACHER_UID,
      teacherId: "shared-teacher-id",
    }),
    db.collection("privateLessonReservations")
        .doc(uidMismatch.reservationId).update({
          teacherUid: OTHER_TEACHER_UID,
          teacherId: "shared-teacher-id",
        }),
    db.collection("privateLessonSlots").doc(uidMismatch.slotId).update({
      teacherUid: OTHER_TEACHER_UID,
      teacherId: "shared-teacher-id",
    }),
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${TEACHER_UID}`)
        .update({teacherId: "shared-teacher-id"}),
  ]);
  const uidMismatchPreview = await previewFixture(
      uidMismatch,
      "uid-mismatch-request",
      "complete",
      teacherAuth,
  );
  assert.equal(uidMismatchPreview.preview.allowed, false);
  assert.ok(uidMismatchPreview.preview.blockedReasons.includes(
      "teacher_not_owner",
  ));
  const uidMismatchBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: teacherAuth,
        data: buildCommitData(
            uidMismatchPreview.data,
            uidMismatchPreview.preview.planHash,
        ),
      }),
      "permission-denied",
      "teacher_not_owner",
  );
  assert.equal(await snapshotSafetyState(), uidMismatchBefore);

  const duplicateName = "Duplicate Teacher Name";
  await seedMembership("duplicate-name-a", {
    role: "teacher",
    teacherName: duplicateName,
    canManageOwnLessonDeductions: true,
  });
  await seedMembership("duplicate-name-b", {
    role: "teacher",
    teacherName: duplicateName,
    canManageOwnLessonDeductions: true,
  });
  const duplicateFixture = await seedFixture({name: "duplicate-name-only"});
  await removeStrongTeacherIdentity(duplicateFixture, duplicateName);
  const duplicatePreview = await previewFixture(
      duplicateFixture,
      "duplicate-name-request",
      "complete",
      teacherAuth,
  );
  assert.equal(duplicatePreview.preview.allowed, false);
  assert.ok(duplicatePreview.preview.blockedReasons.includes(
      "teacher_identity_ambiguous",
  ));
  const duplicateNameBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: teacherAuth,
        data: buildCommitData(
            duplicatePreview.data,
            duplicatePreview.preview.planHash,
        ),
      }),
      "permission-denied",
      "teacher_identity_ambiguous",
  );
  assert.equal(await snapshotSafetyState(), duplicateNameBefore);

  const uniqueName = "Unique Active Teacher";
  await seedMembership(TEACHER_UID, {
    role: "teacher",
    teacherName: uniqueName,
    canManageOwnLessonDeductions: true,
  });
  await seedMembership("unique-name-inactive", {
    role: "teacher",
    teacherName: uniqueName,
    status: "inactive",
    canManageOwnLessonDeductions: true,
  });
  const uniqueFixture = await seedFixture({name: "unique-name-only"});
  await removeStrongTeacherIdentity(uniqueFixture, uniqueName);
  const uniquePreview = await previewFixture(
      uniqueFixture,
      "unique-name-request",
      "complete",
      teacherAuth,
  );
  assert.equal(uniquePreview.preview.allowed, true, JSON.stringify(
      uniquePreview.preview,
  ));
  const uniqueCommit = await commitOutcome({
    auth: teacherAuth,
    data: buildCommitData(
        uniquePreview.data,
        uniquePreview.preview.planHash,
    ),
  });
  assert.equal(uniqueCommit.outcome, "completed");

  const otherOnlyName = "Other Unique Teacher";
  await seedMembership(OTHER_TEACHER_UID, {
    role: "teacher",
    teacherName: otherOnlyName,
    canManageOwnLessonDeductions: true,
  });
  const otherOnlyFixture = await seedFixture({name: "other-name-only"});
  await removeStrongTeacherIdentity(otherOnlyFixture, otherOnlyName);
  const otherOnlyPreview = await previewFixture(
      otherOnlyFixture,
      "other-name-request",
      "complete",
      teacherAuth,
  );
  assert.equal(otherOnlyPreview.preview.allowed, false);
  assert.ok(otherOnlyPreview.preview.blockedReasons.includes(
      "teacher_not_owner",
  ));

  const inactiveUid = "inactive-teacher";
  await seedMembership(inactiveUid, {
    role: "teacher",
    teacherKey: "inactive-teacher-key",
    status: "inactive",
    canManageOwnLessonDeductions: true,
  });
  const inactiveFixture = await seedFixture({
    name: "inactive-membership",
    teacherKey: "inactive-teacher-key",
  });
  const inactivePreview = await previewFixture(
      inactiveFixture,
      "inactive-membership-request",
      "complete",
      {uid: inactiveUid, token: {}},
  );
  assert.equal(inactivePreview.preview.allowed, false);
  assert.ok(inactivePreview.preview.blockedReasons.includes(
      "permission_denied",
  ));
  const inactiveBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: {uid: inactiveUid, token: {}},
        data: buildCommitData(
            inactivePreview.data,
            inactivePreview.preview.planHash,
        ),
      }),
      "permission-denied",
      "permission_denied",
  );
  assert.equal(await snapshotSafetyState(), inactiveBefore);

  const noPermissionUid = "no-permission-teacher";
  await seedMembership(noPermissionUid, {
    role: "teacher",
    teacherKey: "no-permission-key",
    canManageOwnLessonDeductions: false,
  });
  const noPermissionFixture = await seedFixture({
    name: "missing-permission",
    teacherKey: "no-permission-key",
  });
  await Promise.all([
    db.collection("lessons").doc(noPermissionFixture.lessonId)
        .update({teacherUid: noPermissionUid}),
    db.collection("privateLessonReservations")
        .doc(noPermissionFixture.reservationId)
        .update({teacherUid: noPermissionUid}),
    db.collection("privateLessonSlots").doc(noPermissionFixture.slotId)
        .update({teacherUid: noPermissionUid}),
  ]);
  const noPermissionPreview = await previewFixture(
      noPermissionFixture,
      "missing-permission-request",
      "complete",
      {uid: noPermissionUid, token: {}},
  );
  assert.equal(noPermissionPreview.preview.allowed, false);
  assert.ok(noPermissionPreview.preview.blockedReasons.includes(
      "teacher_permission_missing",
  ));
  const noPermissionBefore = await snapshotSafetyState();
  await expectHttpsError(
      commitOutcome({
        auth: {uid: noPermissionUid, token: {}},
        data: buildCommitData(
            noPermissionPreview.data,
            noPermissionPreview.preview.planHash,
        ),
      }),
      "permission-denied",
      "teacher_permission_missing",
  );
  assert.equal(await snapshotSafetyState(), noPermissionBefore);
}

async function testGenericCancellationGuards() {
  const marker = {fixedPrivateDeductionLedger: MARKER};
  const provenanceCases = [
    {name: "canonical-lesson-only", target: "lesson", patch: marker},
    {name: "canonical-reservation-only", target: "reservation", patch: marker},
    {name: "canonical-slot-only", target: "slot", patch: marker},
    {
      name: "weekly-source-only",
      target: "slot",
      patch: {sourceType: "weekly-slot-fixed-assignment-legacy"},
    },
    {
      name: "assignment-batch-only",
      target: "reservation",
      patch: {fixedPrivateAssignmentBatchId: "cancel-assignment-batch"},
    },
    {
      name: "template-linked-lesson",
      target: "lesson",
      patch: {
        privateLessonAvailabilityTemplateId: "cancel-template",
        fixedLessonId: "cancel-template-linked-lesson",
      },
    },
    {
      name: "linked-lesson-fixed",
      target: "lesson",
      patch: {fixedPrivatePackageId: "cancel-linked-package"},
    },
    {
      name: "markerless-legacy",
      target: "lesson",
      patch: {fixedLessonId: "cancel-markerless-fixed-lesson"},
    },
  ];
  const deleteFixedFields = {
    fixedPrivateDeductionLedger: admin.firestore.FieldValue.delete(),
    sourceType: admin.firestore.FieldValue.delete(),
    reservationType: admin.firestore.FieldValue.delete(),
    fixedPrivateAssignmentBatchId: admin.firestore.FieldValue.delete(),
    privateLessonAvailabilityTemplateId:
      admin.firestore.FieldValue.delete(),
    fixedPrivatePackageId: admin.firestore.FieldValue.delete(),
    fixedLessonId: admin.firestore.FieldValue.delete(),
  };
  for (const provenanceCase of provenanceCases) {
    const fixture = await seedFixture({
      name: `generic-cancel-${provenanceCase.name}`,
      mode: "legacy",
    });
    await Promise.all([
      db.collection("lessons").doc(fixture.lessonId).update({
        ...deleteFixedFields,
        source: "direct",
      }),
      db.collection("privateLessonReservations")
          .doc(fixture.reservationId).update({
            ...deleteFixedFields,
            source: "student",
          }),
      db.collection("privateLessonSlots").doc(fixture.slotId).update({
        ...deleteFixedFields,
        source: "direct",
        slotType: "one_time",
      }),
    ]);
    const provenanceTargets = {
      lesson: db.collection("lessons").doc(fixture.lessonId),
      reservation: db.collection("privateLessonReservations")
          .doc(fixture.reservationId),
      slot: db.collection("privateLessonSlots").doc(fixture.slotId),
    };
    await provenanceTargets[provenanceCase.target]
        .update(provenanceCase.patch);
    const deterministicReservationId =
      `${ACADEMY_ID}__${fixture.slotId}__${fixture.studentId}`;
    const sourceReservation = await db.collection("privateLessonReservations")
        .doc(fixture.reservationId).get();
    await Promise.all([
      db.collection("privateLessonReservations")
          .doc(deterministicReservationId)
          .set(sourceReservation.data()),
      db.collection("privateLessonReservations")
          .doc(fixture.reservationId)
          .delete(),
      db.collection("lessons").doc(fixture.lessonId).update({
        reservationId: deterministicReservationId,
      }),
      db.collection("privateLessonSlots").doc(fixture.slotId).update({
        reservationId: deterministicReservationId,
      }),
    ]);
    fixture.reservationId = deterministicReservationId;
    await seedMembership(STUDENT_UID, {role: "student"});
    await db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${STUDENT_UID}`)
        .update({studentId: fixture.studentId});
    for (const [label, callable, auth, data] of [
      [
        "student",
        studentCancel,
        studentAuth,
        {academyId: ACADEMY_ID, slotId: fixture.slotId},
      ],
      [
        "admin",
        adminCancel,
        adminAuth,
        {
          academyId: ACADEMY_ID,
          slotId: fixture.slotId,
          studentId: fixture.studentId,
        },
      ],
    ]) {
      const before = await snapshotSafetyState();
      await expectHttpsError(
          callable({auth, data}),
          "failed-precondition",
          "fixed_private_requires_dedicated_cancel",
      );
      assert.equal(
          await snapshotSafetyState(),
          before,
          `${provenanceCase.name} ${label} cancellation must not write`,
      );
    }
  }
  const directStudentId = "generic-direct-student";
  const directSlotId = "generic-direct-slot";
  const directPackageId = "generic-direct-package";
  const directReservationId =
    `${ACADEMY_ID}__${directSlotId}__${directStudentId}`;
  const futureStart = admin.firestore.Timestamp.fromMillis(
      Date.now() + 48 * 60 * 60 * 1000,
  );
  await seedMembership(STUDENT_UID, {role: "student"});
  await Promise.all([
    db.collection("academyMemberships")
        .doc(`${ACADEMY_ID}_${STUDENT_UID}`)
        .update({studentId: directStudentId}),
    db.collection("privateStudents").doc(directStudentId).set({
      academyId: ACADEMY_ID,
      name: "Generic Direct Student",
      status: "active",
    }),
    db.collection("studentPrivateAccessSummary")
        .doc(`${ACADEMY_ID}__${directStudentId}`)
        .set({
          academyId: ACADEMY_ID,
          studentId: directStudentId,
          privateSlotBookingPilotEnabled: true,
        }),
    db.collection("studentPackages").doc(directPackageId).set({
      academyId: ACADEMY_ID,
      studentId: directStudentId,
      teacher: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      packageType: "private",
      status: "active",
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      startDate: "2026-01-01",
      endDate: "2027-12-31",
      privateCancelLimit: 2,
      privateCancelUsedCount: 0,
    }),
    db.collection("privateLessonReservations").doc(directReservationId).set({
      academyId: ACADEMY_ID,
      slotId: directSlotId,
      studentId: directStudentId,
      studentName: "Generic Direct Student",
      teacher: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      date: "2027-02-01",
      time: "17:00",
      status: "active",
      source: "student",
      packageId: directPackageId,
      cancelledAt: null,
    }),
    db.collection("privateLessonSlots").doc(directSlotId).set({
      academyId: ACADEMY_ID,
      reservationId: directReservationId,
      reservedStudentId: directStudentId,
      teacher: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      date: "2027-02-01",
      time: "17:00",
      durationMinutes: 50,
      startAt: futureStart,
      status: "reserved",
      slotType: "one_time",
    }),
  ]);
  await studentCancel({
    auth: studentAuth,
    data: {academyId: ACADEMY_ID, slotId: directSlotId},
  });
  const [reservationSnap, slotSnap, packageSnap] = await Promise.all([
    db.collection("privateLessonReservations").doc(directReservationId).get(),
    db.collection("privateLessonSlots").doc(directSlotId).get(),
    db.collection("studentPackages").doc(directPackageId).get(),
  ]);
  assert.equal(reservationSnap.get("status"), "cancelled");
  assert.equal(slotSnap.get("status"), "open");
  assert.equal(packageSnap.get("privateCancelUsedCount"), 1);
}

async function testAdminSlotCloseReopenClassifierGuards() {
  const provenanceCases = [
    {
      name: "canonical-lesson",
      target: "lesson",
      patch: {fixedPrivateDeductionLedger: MARKER},
    },
    {
      name: "canonical-reservation",
      target: "reservation",
      patch: {fixedPrivateDeductionLedger: MARKER},
    },
    {
      name: "canonical-slot",
      target: "slot",
      patch: {fixedPrivateDeductionLedger: MARKER},
    },
    {
      name: "weekly-legacy-slot",
      target: "slot",
      patch: {sourceType: "weekly-slot-fixed-assignment-legacy"},
    },
    {
      name: "assignment-batch-reservation",
      target: "reservation",
      patch: {fixedPrivateAssignmentBatchId: "admin-slot-legacy-batch"},
    },
    {
      name: "fixed-lesson-id-only",
      target: "lesson",
      patch: {fixedLessonId: "admin-slot-legacy-lesson"},
    },
  ];
  const deleteFixedFields = {
    fixedPrivateDeductionLedger: admin.firestore.FieldValue.delete(),
    sourceType: admin.firestore.FieldValue.delete(),
    reservationType: admin.firestore.FieldValue.delete(),
    fixedPrivateAssignmentBatchId: admin.firestore.FieldValue.delete(),
    privateLessonAvailabilityTemplateId:
      admin.firestore.FieldValue.delete(),
    fixedPrivatePackageId: admin.firestore.FieldValue.delete(),
    fixedLessonId: admin.firestore.FieldValue.delete(),
  };
  for (const operation of ["close", "reopen"]) {
    for (const provenanceCase of provenanceCases) {
      const fixture = await seedFixture({
        name: `admin-slot-${operation}-${provenanceCase.name}`,
        mode: "legacy",
      });
      await Promise.all([
        db.collection("lessons").doc(fixture.lessonId).update({
          ...deleteFixedFields,
          source: "direct",
        }),
        db.collection("privateLessonReservations")
            .doc(fixture.reservationId).update({
              ...deleteFixedFields,
              source: "student",
            }),
        db.collection("privateLessonSlots").doc(fixture.slotId).update({
          ...deleteFixedFields,
          source: "direct",
          slotType: "one_time",
        }),
      ]);
      const targets = {
        lesson: db.collection("lessons").doc(fixture.lessonId),
        reservation: db.collection("privateLessonReservations")
            .doc(fixture.reservationId),
        slot: db.collection("privateLessonSlots").doc(fixture.slotId),
      };
      await targets[provenanceCase.target].update(provenanceCase.patch);
      if (operation === "reopen") {
        await db.collection("privateLessonSlots").doc(fixture.slotId).update({
          status: "cancelled",
          releaseReason: "teacher_unavailable",
          cancellationReason: "teacher_unavailable",
        });
      }
      const before = await snapshotSafetyState();
      const callable = operation === "close" ? adminCloseSlot : adminReopenSlot;
      const data = operation === "close" ?
        {
          academyId: ACADEMY_ID,
          slotId: fixture.slotId,
          cancellationReason: "teacher_unavailable",
        } :
        {
          academyId: ACADEMY_ID,
          slotId: fixture.slotId,
          reason: "teacher_unavailable_reopened",
        };
      await expectHttpsError(
          callable({auth: adminAuth, data}),
          "failed-precondition",
          "fixed_private_requires_dedicated_cancel",
      );
      assert.equal(await snapshotSafetyState(), before);
    }
  }

  const normalSlotId = `normal-admin-slot-${Date.now()}`;
  const normalStart = admin.firestore.Timestamp.fromMillis(
      Date.now() + 24 * 60 * 60 * 1000,
  );
  await db.collection("privateLessonSlots").doc(normalSlotId).set({
    academyId: ACADEMY_ID,
    teacher: TEACHER_KEY,
    teacherName: TEACHER_KEY,
    teacherKey: TEACHER_KEY,
    teacherUid: TEACHER_UID,
    date: "2027-02-08",
    time: "18:00",
    startAt: normalStart,
    durationMinutes: 50,
    status: "open",
    slotType: "one_time",
    reservedStudentId: "",
    reservationId: "",
    reservedCount: 0,
    isBookable: true,
  });
  await adminCloseSlot({
    auth: adminAuth,
    data: {
      academyId: ACADEMY_ID,
      slotId: normalSlotId,
      cancellationReason: "teacher_unavailable",
    },
  });
  const closed = await db.collection("privateLessonSlots")
      .doc(normalSlotId).get();
  assert.equal(closed.get("status"), "cancelled");
  await adminReopenSlot({
    auth: adminAuth,
    data: {
      academyId: ACADEMY_ID,
      slotId: normalSlotId,
      reason: "teacher_unavailable_reopened",
    },
  });
  const reopened = await db.collection("privateLessonSlots")
      .doc(normalSlotId).get();
  assert.equal(reopened.get("status"), "open");
}

async function testServerOwnedCanonicalAssignment() {
  const suffix = `${Date.now()}`;
  const studentId = `assignment-student-${suffix}`;
  const packageId = `assignment-package-${suffix}`;
  const templateId = `assignment-template-${suffix}`;
  const date = "2027-01-04";
  await Promise.all([
    db.collection("privateStudents").doc(studentId).set({
      academyId: ACADEMY_ID,
      name: "Assignment Student",
      status: "active",
    }),
    db.collection("studentPackages").doc(packageId).set({
      academyId: ACADEMY_ID,
      studentId,
      studentName: "Assignment Student",
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      packageType: "private",
      title: "Assignment Package",
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      status: "active",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
    }),
    db.collection("privateLessonAvailabilityTemplates").doc(templateId).set({
      academyId: ACADEMY_ID,
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      weekday: 1,
      time: "19:00",
      durationMinutes: 50,
      status: "active",
      useForFixedAssignment: true,
      effectiveStartDate: "2026-01-01",
      effectiveEndDate: "2027-12-31",
    }),
  ]);
  const assignmentData = {
    academyId: ACADEMY_ID,
    requestId: `assignment-request-${suffix}`,
    templateId,
    studentId,
    packageId,
    subject: "Server Assignment",
    assignableDates: [date],
    commit: true,
    dryRun: false,
    previewOnly: false,
  };
  const result = await createAssignment({
    auth: adminAuth,
    data: assignmentData,
  });
  assert.equal(result.committed, true);
  const [lessonSnap, slotSnap, reservationSnap] = await Promise.all([
    db.collection("lessons").doc(result.created.lessons[0]).get(),
    db.collection("privateLessonSlots")
        .doc(result.created.privateLessonSlots[0]).get(),
    db.collection("privateLessonReservations")
        .doc(result.created.privateLessonReservations[0]).get(),
  ]);
  for (const snap of [lessonSnap, slotSnap, reservationSnap]) {
    assert.equal(snap.get("fixedPrivateDeductionLedger"), MARKER);
    assert.equal(
        snap.get("fixedPrivateAssignmentBatchId"),
        result.assignmentBatchIdCandidate,
    );
  }
  assert.equal(lessonSnap.get("slotId"), slotSnap.id);
  assert.equal(lessonSnap.get("reservationId"), reservationSnap.id);
  assert.equal(slotSnap.get("lessonId"), lessonSnap.id);
  assert.equal(reservationSnap.get("lessonId"), lessonSnap.id);
  const replay = await createAssignment({
    auth: adminAuth,
    data: assignmentData,
  });
  assert.equal(replay.idempotentReplay, true);
  const conflictBefore = await snapshotSafetyState();
  await expectHttpsError(
      createAssignment({
        auth: adminAuth,
        data: {...assignmentData, subject: "Conflicting Assignment"},
      }),
      "already-exists",
  );
  assert.equal(await snapshotSafetyState(), conflictBefore);
}

async function testDifferentRequestAssignmentConcurrency() {
  const suffix = `${Date.now()}`;
  const studentId = `assignment-race-student-${suffix}`;
  const packageId = `assignment-race-package-${suffix}`;
  const templateId = `assignment-race-template-${suffix}`;
  const date = "2027-01-11";
  await Promise.all([
    db.collection("privateStudents").doc(studentId).set({
      academyId: ACADEMY_ID,
      name: "Assignment Race Student",
      status: "active",
    }),
    db.collection("studentPackages").doc(packageId).set({
      academyId: ACADEMY_ID,
      studentId,
      studentName: "Assignment Race Student",
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      packageType: "private",
      title: "Assignment Race Package",
      totalCount: 4,
      usedCount: 0,
      remainingCount: 4,
      status: "active",
      startDate: "2026-01-01",
      endDate: "2027-12-31",
    }),
    db.collection("privateLessonAvailabilityTemplates").doc(templateId).set({
      academyId: ACADEMY_ID,
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      weekday: 1,
      time: "20:00",
      durationMinutes: 50,
      status: "active",
      useForFixedAssignment: true,
      effectiveStartDate: "2026-01-01",
      effectiveEndDate: "2027-12-31",
    }),
  ]);
  const requestIds = [
    `assignment-race-a-${suffix}`,
    `assignment-race-b-${suffix}`,
  ];
  const baseData = {
    academyId: ACADEMY_ID,
    templateId,
    studentId,
    packageId,
    subject: "Concurrent Server Assignment",
    assignableDates: [date],
    commit: true,
    dryRun: false,
    previewOnly: false,
  };
  const [packageBefore, templateBefore, sideEffectsBefore, creditsBefore] =
    await Promise.all([
      db.collection("studentPackages").doc(packageId).get(),
      db.collection("privateLessonAvailabilityTemplates").doc(templateId).get(),
      snapshotOutcomeSideEffects({studentId}),
      db.collection("creditTransactions")
          .where("academyId", "==", ACADEMY_ID).get(),
    ]);
  const settled = await Promise.allSettled(requestIds.map((requestId) =>
    createAssignment({
      auth: adminAuth,
      data: {...baseData, requestId},
    }),
  ));
  const fulfilled = settled.filter((entry) => entry.status === "fulfilled");
  const rejected = settled.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1, JSON.stringify(settled));
  assert.equal(rejected.length, 1, JSON.stringify(settled));
  assert.ok(
      ["already-exists", "failed-precondition"].includes(
          rejected[0].reason.code,
      ),
      rejected[0].reason.code,
  );

  const winner = fulfilled[0].value;
  const loserRequestId = requestIds.find((id) => id !== winner.requestId);
  const loserBatchId = [
    "fixedPrivateAssignment",
    ACADEMY_ID,
    loserRequestId,
  ].join("_");
  const [
    lessons,
    slots,
    reservations,
    winnerBatch,
    loserBatch,
    packageAfter,
    templateAfter,
    sideEffectsAfter,
    creditsAfter,
  ] = await Promise.all([
    db.collection("lessons")
        .where("academyId", "==", ACADEMY_ID)
        .where("studentId", "==", studentId).get(),
    db.collection("privateLessonSlots")
        .where("academyId", "==", ACADEMY_ID).get(),
    db.collection("privateLessonReservations")
        .where("academyId", "==", ACADEMY_ID)
        .where("studentId", "==", studentId).get(),
    db.collection("fixedPrivateAssignmentBatches")
        .doc(winner.assignmentBatchIdCandidate).get(),
    db.collection("fixedPrivateAssignmentBatches").doc(loserBatchId).get(),
    db.collection("studentPackages").doc(packageId).get(),
    db.collection("privateLessonAvailabilityTemplates").doc(templateId).get(),
    snapshotOutcomeSideEffects({studentId}),
    db.collection("creditTransactions")
        .where("academyId", "==", ACADEMY_ID).get(),
  ]);
  const matchingSlots = slots.docs.filter((docSnap) => {
    const row = docSnap.data() || {};
    return row.privateLessonAvailabilityTemplateId === templateId &&
      row.date === date;
  });
  assert.equal(lessons.size, 1);
  assert.equal(matchingSlots.length, 1);
  assert.equal(reservations.size, 1);
  assert.equal(winnerBatch.exists, true);
  assert.equal(loserBatch.exists, false);
  const lesson = lessons.docs[0];
  const slot = matchingSlots[0];
  const reservation = reservations.docs[0];
  assert.equal(lesson.get("slotId"), slot.id);
  assert.equal(lesson.get("reservationId"), reservation.id);
  assert.equal(slot.get("lessonId"), lesson.id);
  assert.equal(slot.get("reservationId"), reservation.id);
  assert.equal(reservation.get("lessonId"), lesson.id);
  assert.equal(reservation.get("slotId"), slot.id);
  assert.deepEqual(packageAfter.data(), packageBefore.data());
  assert.deepEqual(templateAfter.data(), templateBefore.data());
  assert.equal(sideEffectsAfter, sideEffectsBefore);
  assert.equal(creditsAfter.size, creditsBefore.size);

  const loserRetryBefore = await snapshotSafetyState();
  await expectHttpsError(
      createAssignment({
        auth: adminAuth,
        data: {...baseData, requestId: loserRequestId},
      }),
      rejected[0].reason.code,
  );
  assert.equal(await snapshotSafetyState(), loserRetryBefore);
}

async function main() {
  await seedMembership(ADMIN_UID, {role: "owner"});
  await seedMembership(TEACHER_UID, {
    role: "teacher",
    teacherKey: TEACHER_KEY,
    canManageOwnLessonDeductions: true,
  });
  await seedMembership(OTHER_TEACHER_UID, {
    role: "teacher",
    teacherKey: TEACHER_KEY,
    canManageOwnLessonDeductions: true,
  });
  await testCanonicalReplayConflictAndSelectedOnly();
  await testLegacyNetZero();
  await testCanonicalNoShowAndLegacyReplay();
  await testStaleAndDuplicateCredit();
  await testConcurrencyAndTeacherPermission();
  await testCompleteNoShowConcurrency();
  await testThreeWayStateFlagsDuplicateAndIds();
  await testStrictTeacherIdentityPrecedence();
  await testGenericCancellationGuards();
  await testAdminSlotCloseReopenClassifierGuards();
  await testServerOwnedCanonicalAssignment();
  await testDifferentRequestAssignmentConcurrency();
  console.log("fixed private lesson outcome emulator tests passed");
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
