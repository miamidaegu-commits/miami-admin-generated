"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");

const PROJECT_ID = "demo-private-lesson-outcome-commit";
const ACADEMY_ID = "outcome-commit-academy";
const ACTOR_UID = "outcome-commit-admin";
const TEACHER_KEY = "outcome-commit-teacher";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required.");
}
if (!PROJECT_ID.startsWith("demo-")) {
  throw new Error("Outcome commit emulator tests require a demo project.");
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID});

const functionsTest = require(
    "../functions/node_modules/firebase-functions-test",
)({projectId: PROJECT_ID});
const functions = require("../functions/index.js");
const admin = require("../functions/node_modules/firebase-admin");

const db = admin.firestore();
const previewOutcome = functionsTest.wrap(
    functions.previewPrivateLessonOutcomeAction,
);
const commitOutcome = functionsTest.wrap(
    functions.commitPrivateLessonOutcomeAction,
);
const auth = {
  uid: ACTOR_UID,
  token: {
    email: "outcome-commit-admin@example.com",
    name: "Outcome Commit Admin",
  },
};

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

function hashPayload(payload) {
  return crypto
      .createHash("sha256")
      .update(stableStringify(payload))
      .digest("hex");
}

function buildBatchId(requestId) {
  return `privateLessonOutcomeAction_${ACADEMY_ID}_${requestId}`;
}

function buildCommitPayload({fixture, requestId, actionType, planHash}) {
  return {
    academyId: ACADEMY_ID,
    reservationId: fixture.reservationId,
    requestId,
    actionType,
    planHash,
    commit: true,
    dryRun: false,
    previewOnly: false,
  };
}

async function previewFixture({fixture, requestId, actionType}) {
  return await previewOutcome({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      requestId,
      actionType,
      commit: false,
      dryRun: true,
      previewOnly: true,
    },
  });
}

async function expectHttpsError(promise, {
  code,
  blockedReason,
}) {
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

async function seedFixture({
  name,
  remainingCount = 2,
  usedCount = 0,
  studentAcademyId = ACADEMY_ID,
}) {
  const studentId = `${name}-student`;
  const slotId = `${name}-slot`;
  const packageId = `${name}-package`;
  const reservationId = `${name}-reservation`;
  const startAt = admin.firestore.Timestamp.fromMillis(
      Date.now() - 2 * 60 * 60 * 1000,
  );
  await Promise.all([
    db.collection("privateStudents").doc(studentId).set({
      academyId: studentAcademyId,
      name: `${name} student`,
      teacher: TEACHER_KEY,
      status: "active",
    }),
    db.collection("privateLessonSlots").doc(slotId).set({
      academyId: ACADEMY_ID,
      teacher: TEACHER_KEY,
      date: "2026-07-11",
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: "reserved",
      reservationId,
    }),
    db.collection("studentPackages").doc(packageId).set({
      academyId: ACADEMY_ID,
      studentId,
      studentName: `${name} student`,
      teacher: TEACHER_KEY,
      packageType: "private",
      packageTitle: `${name} package`,
      totalCount: remainingCount + usedCount,
      usedCount,
      remainingCount,
      status: "active",
      createdAt: admin.firestore.Timestamp.fromMillis(
          Date.now() - 24 * 60 * 60 * 1000,
      ),
    }),
    db.collection("privateLessonReservations").doc(reservationId).set({
      academyId: ACADEMY_ID,
      studentId,
      slotId,
      packageId,
      studentName: `${name} student`,
      teacher: TEACHER_KEY,
      date: "2026-07-11",
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: "active",
      deductionApplied: false,
    }),
  ]);
  return {
    studentId,
    slotId,
    packageId,
    reservationId,
  };
}

async function assertOutcomeWritten({
  fixture,
  outcome,
  usedCount = 1,
  remainingCount = 1,
}) {
  const [reservationSnap, packageSnap] = await Promise.all([
    db.collection("privateLessonReservations")
        .doc(fixture.reservationId).get(),
    db.collection("studentPackages").doc(fixture.packageId).get(),
  ]);
  const reservation = reservationSnap.data() || {};
  const packageData = packageSnap.data() || {};
  assert.equal(reservation.status, outcome);
  assert.equal(reservation.deductionApplied, true);
  assert.equal(reservation.deductionPackageId, fixture.packageId);
  assert.equal(packageData.usedCount, usedCount);
  assert.equal(packageData.remainingCount, remainingCount);
  const creditSnap = await db.collection("creditTransactions")
      .doc(reservation.deductionCreditTransactionId).get();
  assert.equal(creditSnap.exists, true);
  assert.equal(creditSnap.get("sourceId"), fixture.reservationId);
  assert.equal(creditSnap.get("deltaCount"), -1);
  assert.equal(
      creditSnap.get("actionType"),
      outcome === "completed" ?
        "private_reservation_completed_deduct" :
        "private_reservation_no_show_deduct",
  );
  return {
    reservation,
    packageData,
    creditTransactionId: creditSnap.id,
  };
}

async function assertNoOutcomeWrite({
  fixture,
  usedCount = 0,
  remainingCount = 2,
}) {
  const [reservationSnap, packageSnap] = await Promise.all([
    db.collection("privateLessonReservations")
        .doc(fixture.reservationId).get(),
    db.collection("studentPackages").doc(fixture.packageId).get(),
  ]);
  assert.equal(reservationSnap.get("status"), "active");
  assert.equal(reservationSnap.get("deductionApplied"), false);
  assert.equal(packageSnap.get("usedCount"), usedCount);
  assert.equal(packageSnap.get("remainingCount"), remainingCount);
}

async function testCompleteReplayAndConflict() {
  const fixture = await seedFixture({name: "complete-replay"});
  const requestId = "complete-replay-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(preview.allowed, true);
  assert.match(preview.planHash, /^[a-f0-9]{64}$/);
  const payload = buildCommitPayload({
    fixture,
    requestId,
    actionType: "complete",
    planHash: preview.planHash,
  });
  const result = await commitOutcome({auth, data: payload});
  assert.equal(result.committed, true);
  assert.equal(result.idempotentReplay, false);
  assert.equal(result.outcome, "completed");
  assert.equal(result.packageId, fixture.packageId);
  assert.equal(result.batchId, buildBatchId(requestId));
  const written = await assertOutcomeWritten({
    fixture,
    outcome: "completed",
  });
  assert.equal(result.creditTransactionId, written.creditTransactionId);

  const replay = await commitOutcome({auth, data: payload});
  assert.equal(replay.committed, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.creditTransactionId, result.creditTransactionId);
  await assertOutcomeWritten({fixture, outcome: "completed"});

  await expectHttpsError(
      commitOutcome({
        auth,
        data: {
          ...payload,
          actionType: "no_show",
        },
      }),
      {
        code: "already-exists",
        blockedReason: "request_id_conflict",
      },
  );
  await expectHttpsError(
      commitOutcome({
        auth,
        data: {
          ...payload,
          planHash: "0".repeat(64),
        },
      }),
      {
        code: "already-exists",
        blockedReason: "request_id_conflict",
      },
  );
  await expectHttpsError(
      commitOutcome({
        auth,
        data: {
          ...payload,
          reservationId: "different-reservation",
        },
      }),
      {
        code: "already-exists",
        blockedReason: "request_id_conflict",
      },
  );
}

async function testNoShowAtomicResult() {
  const fixture = await seedFixture({name: "no-show"});
  const requestId = "no-show-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "no_show",
  });
  assert.equal(preview.allowed, true);
  const result = await commitOutcome({
    auth,
    data: buildCommitPayload({
      fixture,
      requestId,
      actionType: "no_show",
      planHash: preview.planHash,
    }),
  });
  assert.equal(result.outcome, "no_show");
  await assertOutcomeWritten({fixture, outcome: "no_show"});
}

async function testStalePreviewAbortsBeforeWrites() {
  const fixture = await seedFixture({name: "stale"});
  const requestId = "stale-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  await db.collection("studentPackages").doc(fixture.packageId).update({
    remainingCount: 1,
    totalCount: 1,
  });
  await expectHttpsError(
      commitOutcome({
        auth,
        data: buildCommitPayload({
          fixture,
          requestId,
          actionType: "complete",
          planHash: preview.planHash,
        }),
      }),
      {
        code: "failed-precondition",
        blockedReason: "preview_stale",
      },
  );
  await assertNoOutcomeWrite({
    fixture,
    usedCount: 0,
    remainingCount: 1,
  });
  const batchSnap = await db.collection("privateLessonOutcomeActionBatches")
      .doc(buildBatchId(requestId)).get();
  assert.equal(batchSnap.exists, false);
}

async function testDuplicateCreditIsBlocked() {
  const fixture = await seedFixture({name: "duplicate-credit"});
  const requestId = "duplicate-credit-request";
  const firstPreview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  const creditTransactionId =
    firstPreview.creditTransactionPreview.creditTransactionId;
  await db.collection("creditTransactions").doc(creditTransactionId).set({
    academyId: ACADEMY_ID,
    sourceType: "privateReservation",
    sourceId: fixture.reservationId,
    packageId: fixture.packageId,
    deltaCount: -1,
  });
  const blockedPreview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(blockedPreview.allowed, false);
  assert.ok(
      blockedPreview.blockedReasons.includes(
          "credit_transaction_already_exists",
      ),
  );
  await expectHttpsError(
      commitOutcome({
        auth,
        data: buildCommitPayload({
          fixture,
          requestId,
          actionType: "complete",
          planHash: blockedPreview.planHash,
        }),
      }),
      {
        code: "failed-precondition",
        blockedReason: "credit_transaction_already_exists",
      },
  );
  await assertNoOutcomeWrite({fixture});
}

async function testHelperFailureLeavesNoCheckpoint() {
  const fixture = await seedFixture({
    name: "helper-failure",
    studentAcademyId: "different-academy",
  });
  const requestId = "helper-failure-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(preview.allowed, true);
  await expectHttpsError(
      commitOutcome({
        auth,
        data: buildCommitPayload({
          fixture,
          requestId,
          actionType: "complete",
          planHash: preview.planHash,
        }),
      }),
      {code: "permission-denied"},
  );
  await assertNoOutcomeWrite({fixture});
  const batchSnap = await db.collection("privateLessonOutcomeActionBatches")
      .doc(buildBatchId(requestId)).get();
  assert.equal(batchSnap.exists, false);
}

async function testIncompleteCheckpointIsNotReplayed() {
  const fixture = await seedFixture({name: "incomplete"});
  const requestId = "incomplete-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  const payload = buildCommitPayload({
    fixture,
    requestId,
    actionType: "complete",
    planHash: preview.planHash,
  });
  const payloadHash = hashPayload({
    version: 1,
    actorUid: ACTOR_UID,
    academyId: ACADEMY_ID,
    reservationId: fixture.reservationId,
    requestId,
    actionType: "complete",
    planHash: preview.planHash,
    commit: true,
    dryRun: false,
    previewOnly: false,
  });
  await db.collection("privateLessonOutcomeActionBatches")
      .doc(buildBatchId(requestId)).set({
        academyId: ACADEMY_ID,
        requestId,
        payloadHash,
        status: "pending",
      });
  await expectHttpsError(
      commitOutcome({auth, data: payload}),
      {
        code: "failed-precondition",
        blockedReason: "checkpoint_not_completed",
      },
  );
  await assertNoOutcomeWrite({fixture});
}

async function testConcurrentRequestsDeductOnce() {
  const fixture = await seedFixture({name: "concurrent"});
  const firstRequestId = "concurrent-request-a";
  const secondRequestId = "concurrent-request-b";
  const [firstPreview, secondPreview] = await Promise.all([
    previewFixture({
      fixture,
      requestId: firstRequestId,
      actionType: "complete",
    }),
    previewFixture({
      fixture,
      requestId: secondRequestId,
      actionType: "complete",
    }),
  ]);
  const results = await Promise.allSettled([
    commitOutcome({
      auth,
      data: buildCommitPayload({
        fixture,
        requestId: firstRequestId,
        actionType: "complete",
        planHash: firstPreview.planHash,
      }),
    }),
    commitOutcome({
      auth,
      data: buildCommitPayload({
        fixture,
        requestId: secondRequestId,
        actionType: "complete",
        planHash: secondPreview.planHash,
      }),
    }),
  ]);
  const fulfilled = results.filter((entry) => entry.status === "fulfilled");
  const rejected = results.filter((entry) => entry.status === "rejected");
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
  assert.equal(rejected[0].reason.code, "failed-precondition");
  assert.ok(
      rejected[0].reason.details.blockedReasons.includes("preview_stale"),
  );
  await assertOutcomeWritten({fixture, outcome: "completed"});

  const [firstBatchSnap, secondBatchSnap] = await Promise.all([
    db.collection("privateLessonOutcomeActionBatches")
        .doc(buildBatchId(firstRequestId)).get(),
    db.collection("privateLessonOutcomeActionBatches")
        .doc(buildBatchId(secondRequestId)).get(),
  ]);
  assert.equal(
      [firstBatchSnap.exists, secondBatchSnap.exists].filter(Boolean).length,
      1,
  );
}

async function main() {
  await db.collection("academyMemberships")
      .doc(`${ACADEMY_ID}_${ACTOR_UID}`)
      .set({
        academyId: ACADEMY_ID,
        uid: ACTOR_UID,
        role: "owner",
        status: "active",
        displayName: "Outcome Commit Admin",
      });
  await testCompleteReplayAndConflict();
  await testNoShowAtomicResult();
  await testStalePreviewAbortsBeforeWrites();
  await testDuplicateCreditIsBlocked();
  await testHelperFailureLeavesNoCheckpoint();
  await testIncompleteCheckpointIsNotReplayed();
  await testConcurrentRequestsDeductOnce();
  console.log("private lesson outcome commit emulator tests passed");
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
