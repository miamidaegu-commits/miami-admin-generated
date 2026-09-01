"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const PROJECT_ID = "demo-miami-e2e";
const ACADEMY_ID = "outcome-commit-academy";
const ACTOR_UID = "outcome-commit-admin";
const TEACHER_KEY = "outcome-commit-teacher";
const EMULATOR_CONFIG_PATH = path.resolve(
    __dirname,
    "../firebase.a1-outcome-emulator.json",
);
const EMULATOR_CONFIG = JSON.parse(
    fs.readFileSync(EMULATOR_CONFIG_PATH, "utf8"),
);
const FIRESTORE_CONFIG = EMULATOR_CONFIG &&
  EMULATOR_CONFIG.emulators &&
  EMULATOR_CONFIG.emulators.firestore;
if (!FIRESTORE_CONFIG ||
    FIRESTORE_CONFIG.host !== "127.0.0.1" ||
    FIRESTORE_CONFIG.port !== 8080) {
  throw new Error("Dedicated Firestore emulator config is invalid.");
}
const EXPECTED_FIRESTORE_EMULATOR_HOST =
  `${FIRESTORE_CONFIG.host}:${FIRESTORE_CONFIG.port}`;
const REQUIRED_PROJECT_ENV = ["GCLOUD_PROJECT", "GOOGLE_CLOUD_PROJECT"];
const FORBIDDEN_RUNTIME_ENV = [
  "FIREBASE_TOKEN",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "GOOGLE_CLOUD_QUOTA_PROJECT",
  "FIREBASE_PROJECT",
  "FIREBASE_PROJECT_ID",
  "CLOUDSDK_CORE_PROJECT",
  "VITE_FIREBASE_PROJECT_ID",
  "FIREBASE_CONFIG",
  "DOTENV_CONFIG_PATH",
  "ENV_FILE",
  "FIREBASE_ENV_PATH",
  "FUNCTIONS_ENV_PATH",
];

if (process.env.FIRESTORE_EMULATOR_HOST !==
    EXPECTED_FIRESTORE_EMULATOR_HOST) {
  throw new Error(
      `FIRESTORE_EMULATOR_HOST must equal ${EXPECTED_FIRESTORE_EMULATOR_HOST}.`,
  );
}
for (const envName of REQUIRED_PROJECT_ENV) {
  if (process.env[envName] !== PROJECT_ID) {
    throw new Error(`${envName} must equal the dedicated demo project.`);
  }
}
for (const envName of FORBIDDEN_RUNTIME_ENV) {
  if (process.env[envName] !== undefined && process.env[envName] !== "") {
    throw new Error(`${envName} must be unset for this emulator harness.`);
  }
}

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
const previewStatus = functionsTest.wrap(
    functions.previewPrivateLessonStatusAction,
);
const commitStatus = functionsTest.wrap(
    functions.commitPrivateLessonStatusAction,
);
const markOutcome = functionsTest.wrap(
    functions.markPrivateReservationOutcome,
);
const reverseOutcome = functionsTest.wrap(
    functions.reversePrivateReservationOutcome,
);
const autoDeduct = functionsTest.wrap(
    functions.runAutoDeductPendingLessonsForTest,
);
const auth = {
  uid: ACTOR_UID,
  token: {
    email: "outcome-commit-admin@example.com",
    name: "Outcome Commit Admin",
  },
};

async function clearDedicatedFirestoreEmulator() {
  const requestPath = [
    "/emulator/v1/projects/",
    encodeURIComponent(PROJECT_ID),
    "/databases/(default)/documents",
  ].join("");
  await new Promise((resolve, reject) => {
    const request = http.request({
      hostname: FIRESTORE_CONFIG.host,
      port: FIRESTORE_CONFIG.port,
      path: requestPath,
      method: "DELETE",
    }, (response) => {
      response.resume();
      response.once("end", () => {
        if (response.statusCode === 200 || response.statusCode === 204) {
          resolve();
          return;
        }
        reject(new Error(
            `Firestore emulator cleanup failed with ${response.statusCode}.`,
        ));
      });
    });
    request.once("error", reject);
    request.end();
  });
}

async function runAccountingCase(testCase) {
  assert.match(testCase.title, /^\[A\d{2}\] /);
  assert.equal(typeof testCase.assertionId, "string");
  assert.ok(testCase.assertionId.length > 0);
  await testCase.run();
  console.log(`${testCase.title} PASS (${testCase.assertionId})`);
}

async function runRemediationCase(testCase) {
  assert.match(testCase.title, /^\[R\d{2}\] /);
  await testCase.run();
  console.log(`${testCase.title} PASS`);
}

async function runValidatorCase(testCase) {
  assert.match(testCase.title, /^\[V\d{2}\] /);
  await testCase.run();
  console.log(`${testCase.title} PASS`);
}

async function runNewFormatCase(testCase) {
  assert.match(testCase.title, /^\[N\d{2}\] /);
  await testCase.run();
  console.log(`${testCase.title} PASS`);
}

async function runStatusReversalGuardCase(testCase) {
  assert.match(testCase.title, /^\[S\d{2}\] /);
  await testCase.run();
  console.log(`${testCase.title} PASS`);
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

async function previewReversalFixture({fixture, requestId}) {
  return await previewStatus({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      requestId,
      actionType: "reverse_deduction",
      commit: false,
      dryRun: true,
      previewOnly: true,
    },
  });
}

function buildCurrentReversalPayload({
  fixture,
  requestId,
  preview,
  reason,
}) {
  const normalizedPlan = preview.normalizedPlan || {};
  return {
    academyId: ACADEMY_ID,
    reservationId: fixture.reservationId,
    requestId,
    planHash: preview.planHash,
    packageId: normalizedPlan.packageId,
    activeDeductionId: normalizedPlan.activeDeductionId,
    reversalCreditTransactionId:
      normalizedPlan.reversalCreditTransactionId,
    reason,
  };
}

function safeStableDiagnosticJson(value) {
  if (value === undefined) {
    return "<missing>";
  }
  const seen = new WeakSet();
  const normalize = (currentValue) => {
    if (currentValue === null || typeof currentValue !== "object") {
      return currentValue;
    }
    if (seen.has(currentValue)) {
      throw new TypeError("Circular diagnostic value.");
    }
    seen.add(currentValue);
    let normalized;
    if (Array.isArray(currentValue)) {
      normalized = currentValue.map(normalize);
    } else {
      normalized = {};
      for (const key of Object.keys(currentValue).sort()) {
        normalized[key] = /credential|config|env|source/i.test(key) ?
          "<redacted>" :
          normalize(currentValue[key]);
      }
    }
    seen.delete(currentValue);
    return normalized;
  };
  try {
    return JSON.stringify(normalize(value));
  } catch {
    return "<unserializable>";
  }
}

function provenanceMatrixAssertionMessage(error, expected, context) {
  if (!context) {
    return undefined;
  }
  const details = error && error.details;
  const actualBlockedReasons = details && details.blockedReasons;
  const expectedBlockedReason = context.expectedBlockedReason ||
    expected.blockedReason;
  return [
    "PROVENANCE_MATRIX_ASSERTION_MISMATCH",
    `caseId=${context.caseId}`,
    `caseDescription=${context.caseDescription || "<not-present>"}`,
    `expectedBlockedReason=${expectedBlockedReason}`,
    `actualBlockedReasons=${safeStableDiagnosticJson(actualBlockedReasons)}`,
    `expectedClassification=${context.expectedClassification ||
      "<not-present>"}`,
    "actualClassification=<not-present>",
    `errorCode=${error && error.code !== undefined ?
      error.code : "<missing>"}`,
    `errorDetails=${safeStableDiagnosticJson(details)}`,
  ].join("\n");
}

async function expectHttpsError(promise, {
  code,
  blockedReason,
}, diagnosticContext) {
  try {
    await promise;
    assert.fail(`Expected ${code} HttpsError.`);
  } catch (error) {
    const diagnosticMessage = provenanceMatrixAssertionMessage(
        error,
        {code, blockedReason},
        diagnosticContext,
    );
    assert.equal(error.code, code, diagnosticMessage);
    if (blockedReason) {
      assert.ok(
          Array.isArray(error.details && error.details.blockedReasons),
          diagnosticMessage,
      );
      assert.ok(
          error.details.blockedReasons.includes(blockedReason),
          diagnosticMessage,
      );
    }
    return error;
  }
}

async function seedFixture({
  name,
  remainingCount = 2,
  usedCount = 0,
  studentAcademyId = ACADEMY_ID,
  fixedSource = false,
  date = "2026-07-11",
  packageSentinels = {},
}) {
  const studentId = `${name}-student`;
  const slotId = `${name}-slot`;
  const packageId = `${name}-package`;
  const reservationId = `${name}-reservation`;
  const lessonId = `${name}-lesson`;
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
      lessonId,
      teacher: TEACHER_KEY,
      date,
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: "reserved",
      reservationId,
      ...(fixedSource ? {
        sourceType: "fixed-private-slot-assignment",
        reservationType: "fixed",
      } : {}),
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
      ...packageSentinels,
      createdAt: admin.firestore.Timestamp.fromMillis(
          Date.now() - 24 * 60 * 60 * 1000,
      ),
    }),
    db.collection("privateLessonReservations").doc(reservationId).set({
      academyId: ACADEMY_ID,
      lessonId,
      studentId,
      slotId,
      packageId,
      studentName: `${name} student`,
      teacher: TEACHER_KEY,
      date,
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: "active",
      deductionApplied: false,
      ...(fixedSource ? {
        sourceType: "fixed-private-slot-assignment",
        reservationType: "fixed",
      } : {}),
    }),
    db.collection("lessons").doc(lessonId).set({
      academyId: ACADEMY_ID,
      lessonId,
      reservationId,
      slotId,
      packageId,
      studentId,
      teacher: TEACHER_KEY,
      date,
      time: "17:00",
      startAt,
      durationMinutes: 50,
      status: "active",
    }),
  ]);
  return {
    studentId,
    lessonId,
    slotId,
    packageId,
    reservationId,
    date,
  };
}

async function getPackageCounts(packageId) {
  const data = (await db.collection("studentPackages").doc(packageId).get())
      .data() || {};
  return {
    usedCount: Number(data.usedCount),
    remainingCount: Number(data.remainingCount),
  };
}

async function getReservation(reservationId) {
  return (await db.collection("privateLessonReservations")
      .doc(reservationId).get()).data() || {};
}

async function getSourceCredits(reservationId) {
  const snap = await db.collection("creditTransactions")
      .where("sourceId", "==", reservationId).get();
  return snap.docs.map((docSnap) => ({id: docSnap.id, ...docSnap.data()}));
}

async function runAutoForFixture(fixture, todayYmd) {
  return await autoDeduct({
    auth,
    data: {
      academyId: ACADEMY_ID,
      dates: [fixture.date],
      todayYmd,
      lookbackDays: 1,
      dryRun: false,
    },
  });
}

async function getDocumentData(collectionName, documentId) {
  const snap = await db.collection(collectionName).doc(documentId).get();
  return {
    id: documentId,
    exists: snap.exists,
    data: snap.exists ? snap.data() || {} : null,
  };
}

async function getOutcomeCheckpoint(requestId) {
  return await getDocumentData(
      "privateLessonOutcomeActionBatches",
      buildBatchId(requestId),
  );
}

async function snapshotAccountingState(fixture, requestIds = []) {
  const [packageDoc, reservationDoc, credits, checkpoints] =
    await Promise.all([
      getDocumentData("studentPackages", fixture.packageId),
      getDocumentData(
          "privateLessonReservations",
          fixture.reservationId,
      ),
      getSourceCredits(fixture.reservationId),
      Promise.all(requestIds.map((requestId) =>
        getOutcomeCheckpoint(requestId))),
    ]);
  return stableStringify({
    packageDoc,
    reservationDoc,
    credits: credits.sort((left, right) => left.id.localeCompare(right.id)),
    checkpoints,
  });
}

const ACCOUNTING_INVENTORY_COLLECTIONS = [
  "lessons",
  "privateLessonReservations",
  "privateLessonSlots",
  "privateStudents",
  "studentPackages",
  "creditTransactions",
  "privateLessonOutcomeActionBatches",
  "privateLessonStatusActionBatches",
  "notificationEvents",
];

async function getAccountingInventory() {
  const inventory = {};
  for (const collectionName of ACCOUNTING_INVENTORY_COLLECTIONS) {
    const snap = await db.collection(collectionName)
        .where("academyId", "==", ACADEMY_ID)
        .get();
    inventory[collectionName] = snap.docs
        .map((docSnap) => docSnap.id)
        .sort();
  }
  return inventory;
}

function addedInventoryIds(before, after, collectionName) {
  const beforeIds = new Set(before[collectionName] || []);
  return (after[collectionName] || []).filter((id) => !beforeIds.has(id));
}

async function previewAndCommitFixture({
  fixture,
  requestId,
  actionType = "complete",
}) {
  const preview = await previewFixture({fixture, requestId, actionType});
  assert.equal(preview.allowed, true);
  const payload = buildCommitPayload({
    fixture,
    requestId,
    actionType,
    planHash: preview.planHash,
  });
  const result = await commitOutcome({auth, data: payload});
  assert.equal(result.committed, true);
  return {preview, payload, result};
}

async function reverseFixture({
  fixture,
  requestId,
  reason = "accounting reversal",
  requestMode = "current",
  preview = null,
}) {
  if (requestMode === "legacy") {
    return await reverseOutcome({
      auth,
      data: {
        academyId: ACADEMY_ID,
        reservationId: fixture.reservationId,
        reason,
      },
    });
  }
  const reversalPreview = preview ||
    await previewReversalFixture({fixture, requestId});
  return await reverseOutcome({
    auth,
    data: buildCurrentReversalPayload({
      fixture,
      requestId,
      preview: reversalPreview,
      reason,
    }),
  });
}

const FORBIDDEN_ACCOUNTING_FIELDS = [
  "notice",
  "noticeId",
  "noticeStatus",
  "makeup",
  "makeupCount",
  "makeupCredit",
  "makeupEntitlement",
  "entitlement",
  "entitlementId",
];

function assertForbiddenAccountingFieldsAbsent(documentName, value) {
  const visit = (candidate, prefix) => {
    if (!candidate || typeof candidate !== "object") return;
    if (candidate instanceof admin.firestore.Timestamp) return;
    for (const [key, nested] of Object.entries(candidate)) {
      const fieldPath = prefix ? `${prefix}.${key}` : key;
      assert.equal(
          FORBIDDEN_ACCOUNTING_FIELDS.includes(key),
          false,
          `${documentName} contains forbidden field ${fieldPath}`,
      );
      visit(nested, fieldPath);
    }
  };
  visit(value, "");
}

function canonicalDeductionSubset(credit) {
  return {
    academyId: credit.academyId,
    studentId: credit.studentId,
    packageId: credit.packageId,
    packageType: credit.packageType,
    sourceType: credit.sourceType,
    sourceId: credit.sourceId,
    actionType: credit.actionType,
    deltaCount: credit.deltaCount,
  };
}

async function testRegularAbsenceReplayAndReversal() {
  const fixture = await seedFixture({
    name: "regular-absence",
    remainingCount: 6,
    usedCount: 2,
    date: "2026-06-01",
  });
  await db.collection("privateLessonReservations").doc(fixture.reservationId)
      .update({unrelatedReservationField: "preserve-me"});
  const requestId = "regular-absence-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "no_show",
  });
  assert.equal(preview.allowed, true);
  assert.equal(preview.packageImpact.remainingCountDelta, -1);
  const payload = buildCommitPayload({
    fixture,
    requestId,
    actionType: "no_show",
    planHash: preview.planHash,
  });
  const committed = await commitOutcome({auth, data: payload});
  assert.equal(committed.idempotentReplay, false);
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 3,
    remainingCount: 5,
  });
  let reservation = await getReservation(fixture.reservationId);
  assert.equal(reservation.status, "no_show");
  assert.equal(reservation.unrelatedReservationField, "preserve-me");
  let credits = await getSourceCredits(fixture.reservationId);
  assert.equal(credits.length, 1);
  assert.equal(credits[0].actionType, "private_reservation_no_show_deduct");
  assert.equal(credits[0].deltaCount, -1);

  assert.equal(
      (await commitOutcome({auth, data: payload})).idempotentReplay,
      true,
  );
  const differentRequest = await previewFixture({
    fixture,
    requestId: "regular-absence-different-request",
    actionType: "no_show",
  });
  assert.equal(differentRequest.allowed, true);
  assert.equal(differentRequest.packageImpact.additionalPackageDeduction, 0);

  const reverseResults = await Promise.all([
    reverseFixture({
      fixture,
      requestId: "regular-absence-reverse-a",
      reason: "regular absence reversal",
    }),
    reverseFixture({
      fixture,
      requestId: "regular-absence-reverse-b",
      reason: "regular absence concurrent reversal",
    }),
  ]);
  assert.equal(
      reverseResults.filter((result) => result.idempotentReplay === false)
          .length,
      1,
  );
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 2,
    remainingCount: 6,
  });
  reservation = await getReservation(fixture.reservationId);
  assert.equal(reservation.status, "active");
  assert.equal(reservation.originalOutcomeStatus, "no_show");
  assert.equal(reservation.deductionReversed, true);
  assert.equal(reservation.unrelatedReservationField, "preserve-me");
  credits = await getSourceCredits(fixture.reservationId);
  assert.equal(credits.length, 2);
  assert.deepEqual(
      credits.map((credit) => Number(credit.deltaCount)).sort(),
      [-1, 1],
  );
  const reverseReplay = await reverseFixture({
    fixture,
    requestId: "regular-absence-reverse-replay",
    reason: "regular absence replay",
  });
  assert.equal(reverseReplay.idempotentReplay, true);
  await runAutoForFixture(fixture, "2026-06-02");
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 2,
    remainingCount: 6,
  });
  assert.equal((await getSourceCredits(fixture.reservationId)).length, 2);
}

async function testRegularAbsenceConcurrentAndAutoOrdering() {
  const concurrentFixture = await seedFixture({
    name: "concurrent-regular-absence",
    remainingCount: 6,
    usedCount: 2,
    date: "2026-06-03",
  });
  const [previewA, previewB] = await Promise.all([
    previewFixture({
      fixture: concurrentFixture,
      requestId: "concurrent-regular-absence-a",
      actionType: "no_show",
    }),
    previewFixture({
      fixture: concurrentFixture,
      requestId: "concurrent-regular-absence-b",
      actionType: "no_show",
    }),
  ]);
  const commits = await Promise.allSettled([
    commitOutcome({
      auth,
      data: buildCommitPayload({
        fixture: concurrentFixture,
        requestId: "concurrent-regular-absence-a",
        actionType: "no_show",
        planHash: previewA.planHash,
      }),
    }),
    commitOutcome({
      auth,
      data: buildCommitPayload({
        fixture: concurrentFixture,
        requestId: "concurrent-regular-absence-b",
        actionType: "no_show",
        planHash: previewB.planHash,
      }),
    }),
  ]);
  assert.equal(commits.filter((result) => result.status === "fulfilled").length, 1);
  assert.deepEqual(await getPackageCounts(concurrentFixture.packageId), {
    usedCount: 3,
    remainingCount: 5,
  });
  assert.equal((await getSourceCredits(concurrentFixture.reservationId)).length,
      1);

  const autoFirstFixture = await seedFixture({
    name: "auto-first-regular-absence",
    remainingCount: 6,
    usedCount: 2,
    date: "2026-06-04",
  });
  assert.equal((await runAutoForFixture(
      autoFirstFixture,
      "2026-06-05",
  )).deducted, 1);
  const autoFirstPreview = await previewFixture({
    fixture: autoFirstFixture,
    requestId: "auto-first-reclassify",
    actionType: "no_show",
  });
  assert.equal(autoFirstPreview.allowed, true);
  assert.equal(
      autoFirstPreview.normalizedPlan.deductionMode,
      "reuse_existing_auto_deduction",
  );
  assert.equal(autoFirstPreview.packageImpact.remainingCountDelta, 0);
  assert.equal(autoFirstPreview.creditTransactionPreview.wouldCreate, false);
  await commitOutcome({
    auth,
    data: buildCommitPayload({
      fixture: autoFirstFixture,
      requestId: "auto-first-reclassify",
      actionType: "no_show",
      planHash: autoFirstPreview.planHash,
    }),
  });
  assert.deepEqual(await getPackageCounts(autoFirstFixture.packageId), {
    usedCount: 3,
    remainingCount: 5,
  });
  assert.equal((await getReservation(autoFirstFixture.reservationId)).status,
      "no_show");
  assert.equal((await getSourceCredits(autoFirstFixture.reservationId)).length,
      1);

  const manualFirstFixture = await seedFixture({
    name: "manual-first-regular-absence",
    remainingCount: 6,
    usedCount: 2,
    date: "2026-06-06",
  });
  const manualPreview = await previewFixture({
    fixture: manualFirstFixture,
    requestId: "manual-first",
    actionType: "no_show",
  });
  await commitOutcome({
    auth,
    data: buildCommitPayload({
      fixture: manualFirstFixture,
      requestId: "manual-first",
      actionType: "no_show",
      planHash: manualPreview.planHash,
    }),
  });
  await runAutoForFixture(manualFirstFixture, "2026-06-07");
  assert.deepEqual(await getPackageCounts(manualFirstFixture.packageId), {
    usedCount: 3,
    remainingCount: 5,
  });
  assert.equal((await getSourceCredits(manualFirstFixture.reservationId)).length,
      1);
}

async function testRegularAbsenceFailClosedCases() {
  const missingFixture = await seedFixture({name: "absence-missing-package"});
  await db.collection("studentPackages").doc(missingFixture.packageId).delete();
  const missingPreview = await previewFixture({
    fixture: missingFixture,
    requestId: "absence-missing-package",
    actionType: "no_show",
  });
  assert.equal(missingPreview.allowed, false);
  assert.ok(missingPreview.blockedReasons.includes("package_missing"));
  assert.equal((await getReservation(missingFixture.reservationId)).status,
      "active");
  assert.equal((await getSourceCredits(missingFixture.reservationId)).length, 0);

  const ambiguousFixture = await seedFixture({
    name: "absence-ambiguous-package",
  });
  await db.collection("privateLessonReservations")
      .doc(ambiguousFixture.reservationId)
      .update({packageId: admin.firestore.FieldValue.delete()});
  const firstPackage = (await db.collection("studentPackages")
      .doc(ambiguousFixture.packageId).get()).data();
  await db.collection("studentPackages").doc("absence-ambiguous-package-2")
      .set({...firstPackage, packageTitle: "second match"});
  const ambiguousPreview = await previewFixture({
    fixture: ambiguousFixture,
    requestId: "absence-ambiguous-package",
    actionType: "no_show",
  });
  assert.equal(ambiguousPreview.allowed, false);
  assert.ok(ambiguousPreview.blockedReasons.includes("package_ambiguous"));
  assert.deepEqual(await getPackageCounts(ambiguousFixture.packageId), {
    usedCount: 0,
    remainingCount: 2,
  });
  assert.equal((await getSourceCredits(ambiguousFixture.reservationId)).length,
      0);

  const conflictFixture = await seedFixture({name: "absence-completed-conflict"});
  await db.collection("lessons").doc(conflictFixture.lessonId)
      .update({status: "completed", completed: true});
  const conflictPreview = await previewFixture({
    fixture: conflictFixture,
    requestId: "absence-completed-conflict",
    actionType: "no_show",
  });
  assert.equal(conflictPreview.allowed, false);
  assert.ok(conflictPreview.blockedReasons.includes(
      "conflicting_completed_outcome",
  ));
  assert.deepEqual(await getPackageCounts(conflictFixture.packageId), {
    usedCount: 0,
    remainingCount: 2,
  });

  await expectHttpsError(
      previewOutcome({
        data: {
          academyId: ACADEMY_ID,
          reservationId: conflictFixture.reservationId,
          requestId: "absence-unauthenticated",
          actionType: "no_show",
          commit: false,
          dryRun: true,
          previewOnly: true,
        },
      }),
      {code: "unauthenticated"},
  );
  await expectHttpsError(
      previewOutcome({
        auth: {
          uid: "absence-non-admin",
          token: {email: "absence-non-admin@example.com"},
        },
        data: {
          academyId: ACADEMY_ID,
          reservationId: conflictFixture.reservationId,
          requestId: "absence-non-admin",
          actionType: "no_show",
          commit: false,
          dryRun: true,
          previewOnly: true,
        },
      }),
      {code: "permission-denied"},
  );
  assert.equal((await getSourceCredits(conflictFixture.reservationId)).length,
      0);
}

async function testFixedSourcesRejectedByEveryDirectPath() {
  const fixture = await seedFixture({
    name: "fixed-direct-rejected",
    fixedSource: true,
  });
  const requestId = "fixed-direct-rejected-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(preview.allowed, false);
  assert.ok(preview.blockedReasons.includes(
      "fixed_private_requires_fixed_outcome_action",
  ));
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
        blockedReason: "fixed_private_requires_fixed_outcome_action",
      },
  );
  await expectHttpsError(
      markOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          outcome: "completed",
        },
      }),
      {
        code: "failed-precondition",
        blockedReason: "fixed_private_requires_fixed_outcome_action",
      },
  );

  const statusPreview = await previewStatus({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      requestId: "fixed-direct-status-preview",
      actionType: "complete",
      commit: false,
      dryRun: true,
      previewOnly: true,
    },
  });
  assert.equal(statusPreview.allowed, false);
  assert.ok(statusPreview.blockedReasons.includes(
      "fixed_private_requires_fixed_outcome_action",
  ));
  await expectHttpsError(
      commitStatus({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          requestId: "fixed-direct-status-commit",
          actionType: "complete",
          commit: true,
          dryRun: false,
          previewOnly: false,
        },
      }),
      {
        code: "failed-precondition",
        blockedReason: "fixed_private_requires_fixed_outcome_action",
      },
  );

  await db.collection("privateLessonReservations")
      .doc(fixture.reservationId)
      .update({
        status: "completed",
        deductionApplied: true,
        deductionPackageId: fixture.packageId,
      });
  await expectHttpsError(
      reverseOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          reason: "fixed direct reversal rejected",
        },
      }),
      {
        code: "failed-precondition",
        blockedReason: "fixed_private_requires_fixed_outcome_action",
      },
  );
  const packageSnap = await db.collection("studentPackages")
      .doc(fixture.packageId).get();
  assert.equal(packageSnap.get("usedCount"), 0);
  assert.equal(packageSnap.get("remainingCount"), 2);
}

async function snapshotGenericSafetyState() {
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
  const state = {};
  for (const collectionName of collections) {
    const snap = await db.collection(collectionName)
        .where("academyId", "==", ACADEMY_ID)
        .get();
    state[collectionName] = snap.docs
        .map((docSnap) => ({id: docSnap.id, data: docSnap.data()}))
        .sort((left, right) => left.id.localeCompare(right.id));
  }
  return JSON.stringify(state);
}

async function assertRejectedWithoutWrites(
    operation,
    expected,
    diagnosticContext,
) {
  const before = await snapshotGenericSafetyState();
  const error = await expectHttpsError(
      operation(),
      expected,
      diagnosticContext,
  );
  assert.equal(
      await snapshotGenericSafetyState(),
      before,
      provenanceMatrixAssertionMessage(error, expected, diagnosticContext),
  );
}

async function testFixedProvenanceClassifierMatrix() {
  const marker = {fixedPrivateDeductionLedger: "reservation_v1"};
  const cases = [
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
      patch: {fixedPrivateAssignmentBatchId: "legacy-assignment-batch"},
    },
    {
      name: "template-linked-lesson",
      target: "lesson",
      patch: {
        privateLessonAvailabilityTemplateId: "legacy-template",
        fixedLessonId: "template-linked-lesson-lesson",
      },
    },
    {
      name: "linked-lesson-fixed",
      target: "lesson",
      patch: {fixedPrivatePackageId: "linked-lesson-fixed-package"},
    },
    {
      name: "markerless-legacy",
      target: "lesson",
      patch: {source: "fixed_admin"},
    },
  ];
  for (const testCase of cases) {
    const diagnosticContext = {
      caseId: testCase.name,
      expectedBlockedReason: "fixed_private_requires_fixed_outcome_action",
    };
    const fixture = await seedFixture({name: `classifier-${testCase.name}`});
    const targetRefs = {
      lesson: db.collection("lessons").doc(fixture.lessonId),
      reservation: db.collection("privateLessonReservations")
          .doc(fixture.reservationId),
      slot: db.collection("privateLessonSlots").doc(fixture.slotId),
    };
    await targetRefs[testCase.target].update(testCase.patch);
    const statusRequestId = `classifier-status-${testCase.name}`;
    const statusData = {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      requestId: statusRequestId,
      actionType: "complete",
      commit: false,
      dryRun: true,
      previewOnly: true,
    };
    const previewBefore = await snapshotGenericSafetyState();
    const statusPlan = await previewStatus({auth, data: statusData});
    assert.equal(statusPlan.allowed, false);
    assert.ok(statusPlan.blockedReasons.includes(
        "fixed_private_requires_fixed_outcome_action",
    ));
    assert.equal(await snapshotGenericSafetyState(), previewBefore);
    await assertRejectedWithoutWrites(
        () => commitStatus({
          auth,
          data: {
            ...statusData,
            commit: true,
            dryRun: false,
            previewOnly: false,
          },
        }),
        {
          code: "failed-precondition",
          blockedReason: "fixed_private_requires_fixed_outcome_action",
        },
        diagnosticContext,
    );

    const outcomeRequestId = `classifier-outcome-${testCase.name}`;
    const outcomeBefore = await snapshotGenericSafetyState();
    const outcomePlan = await previewFixture({
      fixture,
      requestId: outcomeRequestId,
      actionType: "complete",
    });
    assert.equal(outcomePlan.allowed, false);
    assert.ok(outcomePlan.blockedReasons.includes(
        "fixed_private_requires_fixed_outcome_action",
    ));
    assert.equal(await snapshotGenericSafetyState(), outcomeBefore);
    await assertRejectedWithoutWrites(
        () => commitOutcome({
          auth,
          data: buildCommitPayload({
            fixture,
            requestId: outcomeRequestId,
            actionType: "complete",
            planHash: outcomePlan.planHash,
          }),
        }),
        {
          code: "failed-precondition",
          blockedReason: "fixed_private_requires_fixed_outcome_action",
        },
        diagnosticContext,
    );
    await assertRejectedWithoutWrites(
        () => markOutcome({
          auth,
          data: {
            academyId: ACADEMY_ID,
            reservationId: fixture.reservationId,
            outcome: "completed",
          },
        }),
        {
          code: "failed-precondition",
          blockedReason: "fixed_private_requires_fixed_outcome_action",
        },
        diagnosticContext,
    );

    await Promise.all([
      db.collection("privateLessonReservations").doc(fixture.reservationId)
          .update({
            status: "completed",
            deductionApplied: true,
            deductionPackageId: fixture.packageId,
          }),
      db.collection("studentPackages").doc(fixture.packageId).update({
        usedCount: 1,
        remainingCount: 1,
      }),
    ]);
    if (testCase.name === "canonical-lesson-only") {
      const canonicalDeductionId = [
        "deduct",
        ACADEMY_ID,
        fixture.reservationId,
        fixture.studentId,
        fixture.packageId,
      ].join("_");
      await Promise.all([
        db.collection("privateLessonReservations").doc(fixture.reservationId)
            .update({
              deductionCreditTransactionId: canonicalDeductionId,
              deductionTransactionId: canonicalDeductionId,
            }),
        db.collection("creditTransactions").doc(canonicalDeductionId).set({
          academyId: ACADEMY_ID,
          sourceId: fixture.reservationId,
          studentId: fixture.studentId,
          packageId: fixture.packageId,
          deltaCount: -1,
        }),
      ]);
    }
    if ([
      "canonical-slot-only",
      "weekly-source-only",
      "template-linked-lesson",
      "linked-lesson-fixed",
      "markerless-legacy",
    ].includes(testCase.name)) {
      const canonicalDeductionId = [
        "deduct",
        ACADEMY_ID,
        fixture.reservationId,
        fixture.studentId,
        fixture.packageId,
      ].join("_");
      await Promise.all([
        db.collection("privateLessonReservations").doc(fixture.reservationId)
            .update({
              deductionCreditTransactionId: canonicalDeductionId,
              deductionTransactionId: canonicalDeductionId,
            }),
        db.collection("creditTransactions").doc(canonicalDeductionId).set({
          academyId: ACADEMY_ID,
          sourceId: fixture.reservationId,
          studentId: fixture.studentId,
          packageId: fixture.packageId,
          deltaCount: -1,
        }),
      ]);
    }
    await assertRejectedWithoutWrites(
        () => reverseOutcome({
          auth,
          data: {
            academyId: ACADEMY_ID,
            reservationId: fixture.reservationId,
            reason: "fixed classifier guard",
          },
        }),
        {
          code: "failed-precondition",
          blockedReason: "fixed_private_requires_fixed_outcome_action",
        },
        diagnosticContext,
    );
    const [statusCheckpoint, outcomeCheckpoint] = await Promise.all([
      db.collection("privateLessonStatusActionBatches")
          .doc([
            "privateLessonStatusAction",
            ACADEMY_ID,
            statusRequestId,
          ].join("_")).get(),
      db.collection("privateLessonOutcomeActionBatches")
          .doc(buildBatchId(outcomeRequestId)).get(),
    ]);
    assert.equal(statusCheckpoint.exists, false);
    assert.equal(outcomeCheckpoint.exists, false);
  }
}

async function testCallableIdValidation() {
  const fixture = await seedFixture({name: "invalid-callable-ids"});
  await expectHttpsError(
      previewOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: "bad/reservation",
          requestId: "bad-reservation-id",
          actionType: "complete",
          commit: false,
          dryRun: true,
          previewOnly: true,
        },
      }),
      {code: "invalid-argument"},
  );
  await expectHttpsError(
      previewOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          requestId: "x".repeat(129),
          actionType: "complete",
          commit: false,
          dryRun: true,
          previewOnly: true,
        },
      }),
      {code: "invalid-argument"},
  );
}

async function testNormalStatusPathStillSucceeds() {
  const fixture = await seedFixture({
    name: "normal-status-success",
    usedCount: 1,
    remainingCount: 1,
  });
  const canonicalDeductionId = [
    "deduct",
    ACADEMY_ID,
    fixture.reservationId,
    fixture.studentId,
    fixture.packageId,
  ].join("_");
  await Promise.all([
    db.collection("privateLessonReservations")
        .doc(fixture.reservationId)
        .update({
          deductionApplied: true,
          deductionPackageId: fixture.packageId,
          deductionCreditTransactionId: canonicalDeductionId,
          deductionTransactionId: canonicalDeductionId,
          deductionStatus: "deducted",
          deductionReversed: false,
          outcomeReversedAt: null,
        }),
    db.collection("creditTransactions").doc(canonicalDeductionId).set({
      academyId: ACADEMY_ID,
      sourceType: "privateReservation",
      sourceId: fixture.reservationId,
      studentId: fixture.studentId,
      packageId: fixture.packageId,
      deltaCount: -1,
    }),
  ]);
  const result = await commitStatus({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      requestId: "normal-status-success-request",
      actionType: "complete",
      commit: true,
      dryRun: false,
      previewOnly: false,
    },
  });
  assert.equal(result.committed, true);
  const [reservationSnap, packageSnap] = await Promise.all([
    db.collection("privateLessonReservations")
        .doc(fixture.reservationId).get(),
    db.collection("studentPackages").doc(fixture.packageId).get(),
  ]);
  assert.equal(reservationSnap.get("status"), "completed");
  assert.equal(packageSnap.get("usedCount"), 1);
  assert.equal(packageSnap.get("remainingCount"), 1);
}

async function testLessonIdOnlyStatusCommitReplays() {
  const fixture = await seedFixture({
    name: "lesson-id-only-status-replay",
    usedCount: 1,
    remainingCount: 1,
  });
  const lessonId = "lesson-id-only-status-replay-lesson";
  const canonicalDeductionId = [
    "deduct",
    ACADEMY_ID,
    fixture.reservationId,
    fixture.studentId,
    fixture.packageId,
  ].join("_");
  await Promise.all([
    db.collection("lessons").doc(lessonId).set({
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      slotId: fixture.slotId,
      packageId: fixture.packageId,
      teacher: TEACHER_KEY,
      status: "active",
      deductionApplied: true,
    }),
    db.collection("privateLessonReservations")
        .doc(fixture.reservationId).update({
          lessonId,
          deductionApplied: true,
          deductionPackageId: fixture.packageId,
          deductionCreditTransactionId: canonicalDeductionId,
          deductionTransactionId: canonicalDeductionId,
          deductionStatus: "deducted",
          deductionReversed: false,
          outcomeReversedAt: null,
        }),
    db.collection("creditTransactions").doc(canonicalDeductionId).set({
      academyId: ACADEMY_ID,
      sourceType: "privateReservation",
      sourceId: fixture.reservationId,
      studentId: fixture.studentId,
      packageId: fixture.packageId,
      deltaCount: -1,
    }),
  ]);
  const data = {
    academyId: ACADEMY_ID,
    lessonId,
    requestId: "lesson-id-only-status-replay-request",
    actionType: "complete",
    commit: true,
    dryRun: false,
    previewOnly: false,
  };
  const first = await commitStatus({auth, data});
  assert.equal(first.committed, true);
  assert.equal(first.idempotentReplay, false);
  const replay = await commitStatus({auth, data});
  assert.equal(replay.committed, true);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.requestId, data.requestId);
  const reservationSnap = await db.collection("privateLessonReservations")
      .doc(fixture.reservationId).get();
  assert.equal(reservationSnap.get("status"), "completed");
  const packageSnap = await db.collection("studentPackages")
      .doc(fixture.packageId).get();
  assert.equal(packageSnap.get("usedCount"), 1);
  assert.equal(packageSnap.get("remainingCount"), 1);
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
  assert.equal(preview.allowed, false);
  assert.ok(preview.blockedReasons.includes("student_academy_mismatch"));
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
        blockedReason: "student_academy_mismatch",
      },
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

async function accountingCaseA01CompleteDeduction() {
  const fixture = await seedFixture({
    name: "accounting-a01-complete",
    remainingCount: 4,
    usedCount: 1,
  });
  const {result} = await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a01-request",
  });
  assert.equal(result.outcome, "completed");
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 2,
    remainingCount: 3,
  });
  const credits = await getSourceCredits(fixture.reservationId);
  assert.equal(credits.length, 1);
  assert.equal(credits[0].deltaCount, -1);
}

async function accountingCaseA02NoShowDeduction() {
  const fixture = await seedFixture({
    name: "accounting-a02-no-show",
    remainingCount: 4,
    usedCount: 1,
  });
  const {result} = await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a02-request",
    actionType: "no_show",
  });
  assert.equal(result.outcome, "no_show");
  assert.equal((await getReservation(fixture.reservationId)).status, "no_show");
  const credits = await getSourceCredits(fixture.reservationId);
  assert.deepEqual(credits.map((credit) => credit.deltaCount), [-1]);
}

async function accountingCaseA03EntitlementInventory() {
  const fixture = await seedFixture({name: "accounting-a03-inventory"});
  const before = await getAccountingInventory();
  await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a03-request",
  });
  const after = await getAccountingInventory();
  assert.deepEqual(
      addedInventoryIds(before, after, "creditTransactions").length,
      1,
  );
  assert.deepEqual(
      addedInventoryIds(
          before,
          after,
          "privateLessonOutcomeActionBatches",
      ).length,
      1,
  );
  for (const collectionName of ACCOUNTING_INVENTORY_COLLECTIONS) {
    if (collectionName === "creditTransactions" ||
        collectionName === "privateLessonOutcomeActionBatches") {
      continue;
    }
    assert.deepEqual(addedInventoryIds(before, after, collectionName), []);
  }
  const credits = await getSourceCredits(fixture.reservationId);
  assert.equal(
      credits.some((credit) => Number(credit.deltaCount) > 0),
      false,
  );
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 1,
    remainingCount: 1,
  });
}

async function accountingCaseA04ForbiddenFields() {
  const fixture = await seedFixture({name: "accounting-a04-fields"});
  const requestId = "accounting-a04-request";
  const {result} = await previewAndCommitFixture({
    fixture,
    requestId,
    actionType: "no_show",
  });
  const [reservationDoc, packageDoc, creditDoc, checkpoint] =
    await Promise.all([
      getDocumentData(
          "privateLessonReservations",
          fixture.reservationId,
      ),
      getDocumentData("studentPackages", fixture.packageId),
      getDocumentData("creditTransactions", result.creditTransactionId),
      getOutcomeCheckpoint(requestId),
    ]);
  for (const document of [
    reservationDoc,
    packageDoc,
    creditDoc,
    checkpoint,
  ]) {
    assert.equal(document.exists, true);
    assertForbiddenAccountingFieldsAbsent(document.id, document.data);
  }
}

async function accountingCaseA05ExactCommitReplay() {
  const fixture = await seedFixture({name: "accounting-a05-replay"});
  const requestId = "accounting-a05-request";
  const {payload, result} = await previewAndCommitFixture({
    fixture,
    requestId,
  });
  assert.equal(result.idempotentReplay, false);
  const beforeReplay = await snapshotAccountingState(fixture, [requestId]);
  const replay = await commitOutcome({auth, data: payload});
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.creditTransactionId, result.creditTransactionId);
  assert.equal(
      await snapshotAccountingState(fixture, [requestId]),
      beforeReplay,
  );
}

async function accountingCaseA06DifferentCommitRequest() {
  const fixture = await seedFixture({name: "accounting-a06-different"});
  const firstRequestId = "accounting-a06-request-a";
  const secondRequestId = "accounting-a06-request-b";
  await previewAndCommitFixture({fixture, requestId: firstRequestId});
  const secondPreview = await previewFixture({
    fixture,
    requestId: secondRequestId,
    actionType: "complete",
  });
  assert.equal(secondPreview.allowed, true);
  assert.equal(secondPreview.packageImpact.additionalPackageDeduction, 0);
  const secondResult = await commitOutcome({
    auth,
    data: buildCommitPayload({
      fixture,
      requestId: secondRequestId,
      actionType: "complete",
      planHash: secondPreview.planHash,
    }),
  });
  assert.equal(secondResult.additionalPackageDeduction, 0);
  assert.equal(
      (await getSourceCredits(fixture.reservationId))
          .reduce((total, credit) => total + Number(credit.deltaCount), 0),
      -1,
  );
}

async function accountingCaseA07ConcurrentCommitRequests() {
  const fixture = await seedFixture({name: "accounting-a07-concurrent"});
  const requestIds = [
    "accounting-a07-request-a",
    "accounting-a07-request-b",
  ];
  const previews = await Promise.all(requestIds.map((requestId) =>
    previewFixture({fixture, requestId, actionType: "complete"})));
  const results = await Promise.allSettled(requestIds.map((requestId, index) =>
    commitOutcome({
      auth,
      data: buildCommitPayload({
        fixture,
        requestId,
        actionType: "complete",
        planHash: previews[index].planHash,
      }),
    })));
  assert.equal(
      results.filter((result) => result.status === "fulfilled").length,
      1,
  );
  assert.equal(
      results.filter((result) => result.status === "rejected").length,
      1,
  );
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 1,
    remainingCount: 1,
  });
  assert.equal((await getSourceCredits(fixture.reservationId)).length, 1);
}

async function accountingCaseA08StalePreview() {
  const fixture = await seedFixture({name: "accounting-a08-stale"});
  const requestId = "accounting-a08-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  await db.collection("studentPackages").doc(fixture.packageId).update({
    remainingCount: 1,
    totalCount: 1,
  });
  const beforeCommit = await snapshotAccountingState(fixture, [requestId]);
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
      {code: "failed-precondition", blockedReason: "preview_stale"},
  );
  assert.equal(
      await snapshotAccountingState(fixture, [requestId]),
      beforeCommit,
  );
}

async function accountingCaseA09DuplicateCreditCollision() {
  const fixture = await seedFixture({name: "accounting-a09-collision"});
  const requestId = "accounting-a09-request";
  const initialPreview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  const creditTransactionId =
    initialPreview.creditTransactionPreview.creditTransactionId;
  await db.collection("creditTransactions").doc(creditTransactionId).set({
    academyId: ACADEMY_ID,
    sourceType: "privateReservation",
    sourceId: fixture.reservationId,
    studentId: fixture.studentId,
    packageId: fixture.packageId,
    deltaCount: -1,
  });
  const blockedPreview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(blockedPreview.allowed, false);
  const beforeCommit = await snapshotAccountingState(fixture, [requestId]);
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
  assert.equal(
      await snapshotAccountingState(fixture, [requestId]),
      beforeCommit,
  );
}

async function accountingCaseA10SingleReversalRestore() {
  const fixture = await seedFixture({
    name: "accounting-a10-reverse",
    remainingCount: 5,
    usedCount: 2,
  });
  await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a10-commit",
    actionType: "no_show",
  });
  const reversed = await reverseFixture({
    fixture,
    requestId: "accounting-a10-reverse",
  });
  assert.equal(reversed.idempotentReplay, false);
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 2,
    remainingCount: 5,
  });
  assert.deepEqual(
      (await getSourceCredits(fixture.reservationId))
          .map((credit) => Number(credit.deltaCount)).sort(),
      [-1, 1],
  );
}

async function accountingCaseA11SameReversalRequestReplay() {
  const fixture = await seedFixture({
    name: "accounting-a11-replay",
    remainingCount: 5,
    usedCount: 2,
  });
  await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a11-commit",
  });
  const requestId = "accounting-a11-reverse";
  const first = await reverseFixture({fixture, requestId});
  const beforeReplay = await snapshotAccountingState(
      fixture,
      ["accounting-a11-commit"],
  );
  const replay = await reverseFixture({fixture, requestId});
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.creditTransactionId, first.creditTransactionId);
  assert.equal(
      await snapshotAccountingState(
          fixture,
          ["accounting-a11-commit"],
      ),
      beforeReplay,
  );
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 2,
    remainingCount: 5,
  });
}

async function accountingCaseA12DifferentReversalRequestReplay() {
  const fixture = await seedFixture({name: "accounting-a12-different"});
  await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a12-commit",
  });
  const first = await reverseFixture({
    fixture,
    requestId: "accounting-a12-reverse-a",
  });
  const beforeReplay = await snapshotAccountingState(
      fixture,
      ["accounting-a12-commit"],
  );
  const replay = await reverseFixture({
    fixture,
    requestId: "accounting-a12-reverse-b",
  });
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.creditTransactionId, first.creditTransactionId);
  assert.equal(
      await snapshotAccountingState(
          fixture,
          ["accounting-a12-commit"],
      ),
      beforeReplay,
  );
}

async function accountingCaseA13ConcurrentReversalRequests() {
  const fixture = await seedFixture({
    name: "accounting-a13-concurrent",
    remainingCount: 5,
    usedCount: 2,
  });
  await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a13-commit",
  });
  const results = await Promise.all([
    reverseFixture({
      fixture,
      requestId: "accounting-a13-reverse-a",
    }),
    reverseFixture({
      fixture,
      requestId: "accounting-a13-reverse-b",
    }),
  ]);
  assert.equal(
      results.filter((result) => result.idempotentReplay === false).length,
      1,
  );
  assert.equal(
      results.filter((result) => result.idempotentReplay === true).length,
      1,
  );
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 2,
    remainingCount: 5,
  });
}

async function accountingCaseA14OriginalDeductionIdentity() {
  const fixture = await seedFixture({name: "accounting-a14-identity"});
  const {result} = await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a14-commit",
  });
  const originalBefore = await getDocumentData(
      "creditTransactions",
      result.creditTransactionId,
  );
  const subsetBefore = canonicalDeductionSubset(originalBefore.data);
  await reverseFixture({
    fixture,
    requestId: "accounting-a14-reverse",
  });
  const originalAfter = await getDocumentData(
      "creditTransactions",
      result.creditTransactionId,
  );
  const reservation = await getReservation(fixture.reservationId);
  assert.equal(originalAfter.id, originalBefore.id);
  assert.deepEqual(canonicalDeductionSubset(originalAfter.data), subsetBefore);
  assert.equal(
      reservation.originalDeductionCreditTransactionId,
      result.creditTransactionId,
  );
}

async function accountingCaseA15DeterministicReversalIdentity() {
  const fixture = await seedFixture({name: "accounting-a15-reverse-id"});
  const {result} = await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a15-commit",
  });
  const reversed = await reverseFixture({
    fixture,
    requestId: "accounting-a15-reverse",
  });
  const expectedReversalId = `reverse_${result.creditTransactionId}`;
  assert.equal(reversed.creditTransactionId, expectedReversalId);
  const credits = await getSourceCredits(fixture.reservationId);
  assert.deepEqual(
      credits.map((credit) => credit.id).sort(),
      [result.creditTransactionId, expectedReversalId].sort(),
  );
  assert.equal(
      credits.filter((credit) => Number(credit.deltaCount) === 1).length,
      1,
  );
}

async function accountingCaseA16PackageSentinelPreservation() {
  const sentinels = {
    accountingSentinelScalar: "preserve-scalar",
    accountingSentinelNested: {
      version: 1,
      flags: {preserve: true},
    },
    accountingSentinelArray: ["one", "two", "three"],
  };
  const fixture = await seedFixture({
    name: "accounting-a16-sentinels",
    remainingCount: 5,
    usedCount: 2,
    packageSentinels: sentinels,
  });
  await previewAndCommitFixture({
    fixture,
    requestId: "accounting-a16-commit",
  });
  let packageData = (await getDocumentData(
      "studentPackages",
      fixture.packageId,
  )).data;
  assert.deepStrictEqual({
    accountingSentinelScalar: packageData.accountingSentinelScalar,
    accountingSentinelNested: packageData.accountingSentinelNested,
    accountingSentinelArray: packageData.accountingSentinelArray,
  }, sentinels);
  await reverseFixture({
    fixture,
    requestId: "accounting-a16-reverse",
  });
  packageData = (await getDocumentData(
      "studentPackages",
      fixture.packageId,
  )).data;
  assert.deepStrictEqual({
    accountingSentinelScalar: packageData.accountingSentinelScalar,
    accountingSentinelNested: packageData.accountingSentinelNested,
    accountingSentinelArray: packageData.accountingSentinelArray,
  }, sentinels);
}

async function accountingCaseA17AutoManualOrdering() {
  await testRegularAbsenceConcurrentAndAutoOrdering();
}

async function accountingCaseA18MissingPackageFailClosed() {
  const fixture = await seedFixture({name: "accounting-a18-missing"});
  await db.collection("studentPackages").doc(fixture.packageId).delete();
  const requestId = "accounting-a18-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(preview.allowed, false);
  const beforeCommit = await snapshotAccountingState(fixture, [requestId]);
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
      {code: "failed-precondition", blockedReason: "package_missing"},
  );
  assert.equal(
      await snapshotAccountingState(fixture, [requestId]),
      beforeCommit,
  );
}

async function accountingCaseA19AmbiguousPackageFailClosed() {
  const fixture = await seedFixture({name: "accounting-a19-ambiguous"});
  await db.collection("privateLessonReservations")
      .doc(fixture.reservationId)
      .update({packageId: admin.firestore.FieldValue.delete()});
  const firstPackage = (await db.collection("studentPackages")
      .doc(fixture.packageId).get()).data();
  await db.collection("studentPackages")
      .doc("accounting-a19-second-package")
      .set({...firstPackage, packageTitle: "ambiguous second package"});
  const requestId = "accounting-a19-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(preview.allowed, false);
  assert.ok(preview.blockedReasons.includes("package_ambiguous"));
  const beforeCommit = await snapshotAccountingState(fixture, [requestId]);
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
      {code: "failed-precondition", blockedReason: "package_ambiguous"},
  );
  assert.equal(
      await snapshotAccountingState(fixture, [requestId]),
      beforeCommit,
  );
}

async function accountingCaseA20ConflictingOutcomeFailClosed() {
  const fixture = await seedFixture({name: "accounting-a20-conflict"});
  await db.collection("lessons").doc(fixture.lessonId).update({
    status: "completed",
    completed: true,
  });
  const requestId = "accounting-a20-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "no_show",
  });
  assert.equal(preview.allowed, false);
  assert.ok(preview.blockedReasons.includes("conflicting_completed_outcome"));
  const beforeCommit = await snapshotAccountingState(fixture, [requestId]);
  await expectHttpsError(
      commitOutcome({
        auth,
        data: buildCommitPayload({
          fixture,
          requestId,
          actionType: "no_show",
          planHash: preview.planHash,
        }),
      }),
      {
        code: "failed-precondition",
        blockedReason: "conflicting_completed_outcome",
      },
  );
  assert.equal(
      await snapshotAccountingState(fixture, [requestId]),
      beforeCommit,
  );
}

async function accountingCaseA21FixedDirectPathRejected() {
  await testFixedSourcesRejectedByEveryDirectPath();
}

async function accountingCaseA22CanonicalTeacherUidMismatch() {
  const fixture = await seedFixture({name: "accounting-a22-teacher-uid"});
  const occurrenceUid = "accounting-a22-occurrence-uid";
  const packageUid = "accounting-a22-package-uid";
  const commonName = "Accounting Shared Teacher";
  await Promise.all([
    db.collection("privateLessonReservations")
        .doc(fixture.reservationId)
        .update({
          teacherUid: occurrenceUid,
          teacherUID: occurrenceUid,
          teacher: commonName,
          teacherName: commonName,
          teacherEmail: "shared-teacher@example.test",
        }),
    db.collection("privateLessonSlots").doc(fixture.slotId).update({
      teacherUid: occurrenceUid,
      teacherUID: occurrenceUid,
      teacher: commonName,
      teacherName: commonName,
      teacherEmail: "shared-teacher@example.test",
    }),
    db.collection("lessons").doc(fixture.lessonId).update({
      teacherUid: occurrenceUid,
      teacherUID: occurrenceUid,
      teacher: commonName,
      teacherName: commonName,
      teacherEmail: "shared-teacher@example.test",
    }),
    db.collection("studentPackages").doc(fixture.packageId).update({
      teacherUid: packageUid,
      teacherUID: packageUid,
      teacher: commonName,
      teacherName: commonName,
      teacherEmail: "shared-teacher@example.test",
    }),
  ]);
  const requestId = "accounting-a22-request";
  const preview = await previewFixture({
    fixture,
    requestId,
    actionType: "complete",
  });
  assert.equal(preview.allowed, false);
  assert.ok(preview.blockedReasons.includes("teacher_identity_mismatch"));
  const beforeCommit = await snapshotAccountingState(fixture, [requestId]);
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
        blockedReason: "teacher_identity_mismatch",
      },
  );
  assert.equal(
      await snapshotAccountingState(fixture, [requestId]),
      beforeCommit,
  );
  assert.equal((await getSourceCredits(fixture.reservationId)).length, 0);
}

async function accountingCaseA23CanonicalWriteInventory() {
  const fixture = await seedFixture({name: "accounting-a23-inventory"});
  const requestId = "accounting-a23-commit";
  const before = await getAccountingInventory();
  const {payload, result} = await previewAndCommitFixture({
    fixture,
    requestId,
  });
  const reversed = await reverseFixture({
    fixture,
    requestId: "accounting-a23-reverse",
  });
  const after = await getAccountingInventory();
  assert.deepEqual(
      addedInventoryIds(before, after, "creditTransactions").sort(),
      [result.creditTransactionId, reversed.creditTransactionId].sort(),
  );
  assert.deepEqual(
      addedInventoryIds(
          before,
          after,
          "privateLessonOutcomeActionBatches",
      ),
      [buildBatchId(requestId)],
  );
  for (const collectionName of ACCOUNTING_INVENTORY_COLLECTIONS) {
    if (collectionName === "creditTransactions" ||
        collectionName === "privateLessonOutcomeActionBatches") {
      continue;
    }
    assert.deepEqual(addedInventoryIds(before, after, collectionName), []);
  }
  const beforeReplays = stableStringify(after);
  assert.equal(
      (await commitOutcome({auth, data: payload})).idempotentReplay,
      true,
  );
  assert.equal(
      (await reverseFixture({
        fixture,
        requestId: "accounting-a23-reverse-replay",
      })).idempotentReplay,
      true,
  );
  assert.equal(stableStringify(await getAccountingInventory()), beforeReplays);
}

async function accountingCaseA24TransactionCheckpointEvidence() {
  const fixture = await seedFixture({name: "accounting-a24-transaction"});
  const requestId = "accounting-a24-request";
  const {result} = await previewAndCommitFixture({fixture, requestId});
  const checkpoint = await getOutcomeCheckpoint(requestId);
  assert.equal(checkpoint.exists, true);
  assert.equal(checkpoint.data.status, "completed");
  assert.equal(checkpoint.data.helperResult.ok, true);
  assert.equal(
      checkpoint.data.helperResult.creditTransactionId,
      result.creditTransactionId,
  );
  assert.deepEqual(checkpoint.data.updated, {
    reservations: [fixture.reservationId],
    lessons: [],
    privateLessonSlots: [],
    studentPackages: [fixture.packageId],
    creditTransactions: [result.creditTransactionId],
  });
  const [reservationDoc, packageDoc, creditDoc] = await Promise.all([
    getDocumentData("privateLessonReservations", fixture.reservationId),
    getDocumentData("studentPackages", fixture.packageId),
    getDocumentData("creditTransactions", result.creditTransactionId),
  ]);
  assert.equal(reservationDoc.data.deductionApplied, true);
  assert.equal(packageDoc.data.remainingCount, 1);
  assert.equal(creditDoc.data.deltaCount, -1);
}

async function remediationCaseR01SecondDeductionCycle() {
  const fixture = await seedFixture({
    name: "remediation-r01-cycle",
    remainingCount: 4,
  });
  const first = await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r01-first",
    actionType: "no_show",
  });
  await reverseFixture({
    fixture,
    requestId: "remediation-r01-reverse",
  });
  const second = await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r01-second",
    actionType: "no_show",
  });
  assert.notEqual(
      second.result.creditTransactionId,
      first.result.creditTransactionId,
  );
  assert.equal(second.result.additionalPackageDeduction, 1);
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 1,
    remainingCount: 3,
  });
  const reservation = await getReservation(fixture.reservationId);
  assert.equal(reservation.status, "no_show");
  assert.equal(reservation.deductionApplied, true);
  assert.equal(
      reservation.deductionCreditTransactionId,
      second.result.creditTransactionId,
  );
  const credits = await getSourceCredits(fixture.reservationId);
  assert.equal(credits.filter((credit) => credit.deltaCount === -1).length, 2);
  assert.equal(credits.filter((credit) => credit.deltaCount === 1).length, 1);
  assert.equal(
      credits.find((credit) => credit.id === first.result.creditTransactionId)
          .reversalCreditTransactionId,
      `reverse_${first.result.creditTransactionId}`,
  );
}

async function remediationCaseR02SameRequestReplay() {
  const fixture = await seedFixture({name: "remediation-r02-replay"});
  const first = await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r02-first",
    actionType: "no_show",
  });
  await reverseFixture({fixture, requestId: "remediation-r02-reverse"});
  const second = await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r02-second",
    actionType: "no_show",
  });
  const before = await snapshotAccountingState(
      fixture,
      ["remediation-r02-first", "remediation-r02-second"],
  );
  const replay = await commitOutcome({auth, data: second.payload});
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.additionalPackageDeduction, 0);
  assert.equal(replay.creditTransactionId, second.result.creditTransactionId);
  assert.notEqual(replay.creditTransactionId, first.result.creditTransactionId);
  assert.equal(
      await snapshotAccountingState(
          fixture,
          ["remediation-r02-first", "remediation-r02-second"],
      ),
      before,
  );
}

async function remediationCaseR03DifferentRequestNoAdditionalDeduction() {
  const fixture = await seedFixture({name: "remediation-r03-different"});
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r03-first",
    actionType: "no_show",
  });
  const preview = await previewFixture({
    fixture,
    requestId: "remediation-r03-second",
    actionType: "no_show",
  });
  assert.equal(preview.allowed, true);
  assert.equal(preview.normalizedPlan.deductionMode,
      "reuse_existing_active_deduction");
  assert.equal(preview.packageImpact.additionalPackageDeduction, 0);
  assert.equal(preview.creditTransactionPreview.deltaCount, 0);
  const result = await commitOutcome({
    auth,
    data: buildCommitPayload({
      fixture,
      requestId: "remediation-r03-second",
      actionType: "no_show",
      planHash: preview.planHash,
    }),
  });
  assert.equal(result.additionalPackageDeduction, 0);
  assert.equal((await getSourceCredits(fixture.reservationId)).length, 1);
}

async function remediationCaseR04ConcurrentSecondCycle() {
  const fixture = await seedFixture({
    name: "remediation-r04-concurrent",
    remainingCount: 4,
  });
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r04-first",
    actionType: "no_show",
  });
  await reverseFixture({fixture, requestId: "remediation-r04-reverse"});
  const requestIds = ["remediation-r04-second-a", "remediation-r04-second-b"];
  const previews = await Promise.all(requestIds.map((requestId) =>
    previewFixture({fixture, requestId, actionType: "no_show"})));
  const results = await Promise.allSettled(requestIds.map((requestId, index) =>
    commitOutcome({
      auth,
      data: buildCommitPayload({
        fixture,
        requestId,
        actionType: "no_show",
        planHash: previews[index].planHash,
      }),
    })));
  assert.equal(results.filter((result) => result.status === "fulfilled").length,
      1);
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 1,
    remainingCount: 3,
  });
  assert.equal(
      (await getSourceCredits(fixture.reservationId))
          .filter((credit) => credit.deltaCount === -1).length,
      2,
  );
}

async function remediationCaseR05SecondReversalRestoresOriginalBalance() {
  const fixture = await seedFixture({
    name: "remediation-r05-second-reverse",
    remainingCount: 4,
  });
  const first = await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r05-first",
    actionType: "no_show",
  });
  await reverseFixture({fixture, requestId: "remediation-r05-reverse-a"});
  const second = await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r05-second",
    actionType: "no_show",
  });
  const reversed = await reverseFixture({
    fixture,
    requestId: "remediation-r05-reverse-b",
  });
  assert.deepEqual(await getPackageCounts(fixture.packageId), {
    usedCount: 0,
    remainingCount: 4,
  });
  assert.equal(reversed.restoredPackageLessons, 1);
  assert.equal(reversed.originalCreditTransactionId,
      second.result.creditTransactionId);
  assert.notEqual(second.result.creditTransactionId,
      first.result.creditTransactionId);
  const credits = await getSourceCredits(fixture.reservationId);
  assert.deepEqual(
      credits.map((credit) => Number(credit.deltaCount)).sort(),
      [-1, -1, 1, 1],
  );
}

async function remediationCaseR06AutoDeductionStatusOnly() {
  const fixture = await seedFixture({
    name: "remediation-r06-auto",
    remainingCount: 4,
    date: "2026-06-10",
  });
  assert.equal((await runAutoForFixture(fixture, "2026-06-11")).deducted, 1);
  const statusPreview = await previewStatus({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      requestId: "remediation-r06-status",
      actionType: "no_show",
      commit: false,
      dryRun: true,
      previewOnly: true,
    },
  });
  assert.ok(statusPreview.blockedReasons.includes(
      "package_or_credit_write_required",
  ));
  const preview = await previewFixture({
    fixture,
    requestId: "remediation-r06-outcome",
    actionType: "no_show",
  });
  assert.equal(preview.allowed, true);
  assert.equal(preview.packageImpact.additionalPackageDeduction, 0);
  assert.equal(preview.creditTransactionPreview.deltaCount, 0);
  const result = await commitOutcome({
    auth,
    data: buildCommitPayload({
      fixture,
      requestId: "remediation-r06-outcome",
      actionType: "no_show",
      planHash: preview.planHash,
    }),
  });
  assert.equal(result.additionalPackageDeduction, 0);
  assert.equal((await getReservation(fixture.reservationId)).status, "no_show");
  assert.equal((await getSourceCredits(fixture.reservationId)).length, 1);
}

async function remediationCaseR07ReversalDriftRejectsWithoutWrites() {
  const fixture = await seedFixture({name: "remediation-r07-drift"});
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r07-outcome",
    actionType: "no_show",
  });
  const preview = await previewReversalFixture({
    fixture,
    requestId: "remediation-r07-reverse",
  });
  await db.collection("studentPackages").doc(fixture.packageId).update({
    accountingDriftSentinel: "drift",
    usedCount: 2,
    remainingCount: 0,
  });
  const before = await snapshotAccountingState(fixture);
  await expectHttpsError(
      reverseOutcome({
        auth,
        data: buildCurrentReversalPayload({
          fixture,
          requestId: "remediation-r07-reverse",
          preview,
          reason: "reversal drift",
        }),
      }),
      {code: "failed-precondition", blockedReason: "preview_stale"},
  );
  assert.equal(await snapshotAccountingState(fixture), before);

  const sourceFixture = await seedFixture({name: "remediation-r07-source"});
  const targetFixture = await seedFixture({name: "remediation-r07-target"});
  await previewAndCommitFixture({
    fixture: sourceFixture,
    requestId: "remediation-r07-source-outcome",
    actionType: "no_show",
  });
  await previewAndCommitFixture({
    fixture: targetFixture,
    requestId: "remediation-r07-target-outcome",
    actionType: "no_show",
  });
  const sourcePreview = await previewReversalFixture({
    fixture: sourceFixture,
    requestId: "remediation-r07-cross-reservation",
  });
  const targetBefore = await snapshotAccountingState(targetFixture);
  await expectHttpsError(
      reverseOutcome({
        auth,
        data: buildCurrentReversalPayload({
          fixture: targetFixture,
          requestId: "remediation-r07-cross-reservation",
          preview: sourcePreview,
          reason: "cross reservation",
        }),
      }),
      {
        code: "failed-precondition",
        blockedReason: "reversal_identity_mismatch",
      },
  );
  assert.equal(await snapshotAccountingState(targetFixture), targetBefore);
}

async function remediationCaseR08CrossCycleHashRejects() {
  const fixture = await seedFixture({name: "remediation-r08-cross-cycle"});
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r08-first",
    actionType: "no_show",
  });
  const cycleAPreview = await previewReversalFixture({
    fixture,
    requestId: "remediation-r08-reverse-a",
  });
  await reverseFixture({
    fixture,
    requestId: "remediation-r08-reverse-a",
    preview: cycleAPreview,
  });
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r08-second",
    actionType: "no_show",
  });
  const before = await snapshotAccountingState(fixture);
  await expectHttpsError(
      reverseOutcome({
        auth,
        data: buildCurrentReversalPayload({
          fixture,
          requestId: "remediation-r08-stale",
          preview: cycleAPreview,
          reason: "cross cycle stale",
        }),
      }),
      {
        code: "failed-precondition",
        blockedReason: "reversal_identity_mismatch",
      },
  );
  assert.equal(await snapshotAccountingState(fixture), before);
}

async function remediationCaseR09CurrentStrictShape() {
  const fixture = await seedFixture({name: "remediation-r09-current"});
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r09-outcome",
    actionType: "no_show",
  });
  const preview = await previewReversalFixture({
    fixture,
    requestId: "remediation-r09-reverse",
  });
  assert.match(preview.planHash, /^[a-f0-9]{64}$/);
  const result = await reverseFixture({
    fixture,
    requestId: "remediation-r09-reverse",
    preview,
  });
  assert.equal(result.requestMode, "current");
  assert.equal(result.planHash, preview.planHash);
}

async function remediationCaseR10LegacyCompatibilityReplay() {
  const fixture = await seedFixture({name: "remediation-r10-legacy"});
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r10-outcome",
    actionType: "no_show",
  });
  const first = await reverseFixture({
    fixture,
    requestMode: "legacy",
    reason: "legacy reversal",
  });
  const before = await snapshotAccountingState(fixture);
  const replay = await reverseFixture({
    fixture,
    requestMode: "legacy",
    reason: "legacy replay",
  });
  assert.equal(first.requestMode, "legacy");
  assert.equal(first.idempotentReplay, false);
  assert.equal(replay.idempotentReplay, true);
  assert.equal(replay.requestId, first.requestId);
  assert.equal(await snapshotAccountingState(fixture), before);
}

async function remediationCaseR11RequestIdOnlyRejects() {
  const fixture = await seedFixture({name: "remediation-r11-request-only"});
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r11-outcome",
    actionType: "no_show",
  });
  const before = await snapshotAccountingState(fixture);
  await expectHttpsError(
      reverseOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          requestId: "remediation-r11-reverse",
          reason: "mixed request only",
        },
      }),
      {
        code: "invalid-argument",
        blockedReason: "mixed_reversal_request_shape",
      },
  );
  assert.equal(await snapshotAccountingState(fixture), before);
}

async function remediationCaseR12PlanHashOnlyRejects() {
  const fixture = await seedFixture({name: "remediation-r12-hash-only"});
  await previewAndCommitFixture({
    fixture,
    requestId: "remediation-r12-outcome",
    actionType: "no_show",
  });
  const preview = await previewReversalFixture({
    fixture,
    requestId: "remediation-r12-preview",
  });
  const before = await snapshotAccountingState(fixture);
  await expectHttpsError(
      reverseOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          planHash: preview.planHash,
          reason: "mixed hash only",
        },
      }),
      {
        code: "invalid-argument",
        blockedReason: "mixed_reversal_request_shape",
      },
  );
  assert.equal(await snapshotAccountingState(fixture), before);
}

async function remediationCaseR13UiImpactWording() {
  const modalSource = fs.readFileSync(path.resolve(
      __dirname,
      "../src/features/dashboard/components/PrivateLessonStatusActionModal.jsx",
  ), "utf8");
  const dashboardSource = fs.readFileSync(path.resolve(
      __dirname,
      "../Dashboard.jsx",
  ), "utf8");
  const enSource = fs.readFileSync(path.resolve(
      __dirname,
      "../src/i18n/resources/en.js",
  ), "utf8");
  const koSource = fs.readFileSync(path.resolve(
      __dirname,
      "../src/i18n/resources/ko.js",
  ), "utf8");
  assert.ok(modalSource.includes(
      "private-lesson-outcome-package-impact-wording",
  ));
  assert.ok(modalSource.includes("additionalPackageDeduction === 0"));
  assert.ok(dashboardSource.includes("'reuse_existing_active_deduction'"));
  for (const key of [
    "teacher.outcome.packageImpact.deduct.one",
    "teacher.outcome.packageImpact.deduct.other",
    "teacher.outcome.packageImpact.noAdditional",
    "teacher.outcome.packageImpact.restore.one",
    "teacher.outcome.packageImpact.restore.other",
  ]) {
    assert.ok(enSource.includes(key));
    assert.ok(koSource.includes(key));
  }
}

async function remediationCaseR14StrictAllowlist() {
  const source = fs.readFileSync(path.resolve(
      __dirname,
      "private-lesson-outcome-commit.spec.js",
  ), "utf8");
  assert.ok(source.includes("['status', '--porcelain=v1']"));
  assert.ok(source.includes("expect(changedPaths).toEqual"));
  assert.ok(source.includes("changedPath.includes('*')"));
  assert.equal(source.includes("'tests/private-lesson-status-actions.spec.js'"),
      false);
}

function buildValidatorCanonicalDeductionId(fixture) {
  return [
    "deduct",
    ACADEMY_ID,
    fixture.reservationId,
    fixture.studentId,
    fixture.packageId,
  ].join("_");
}

async function seedValidatorEvidence({
  name,
  reservationPatch = {},
  creditPatch = {},
  currentPointers = true,
  extraCredits = [],
}) {
  const fixture = await seedFixture({
    name,
    usedCount: 1,
    remainingCount: 2,
  });
  const canonicalDeductionId = buildValidatorCanonicalDeductionId(fixture);
  await Promise.all([
    db.collection("privateLessonReservations").doc(fixture.reservationId)
        .update({
          deductionApplied: true,
          deductionPackageId: fixture.packageId,
          ...(currentPointers ? {
            deductionCreditTransactionId: canonicalDeductionId,
            deductionTransactionId: canonicalDeductionId,
          } : {}),
          deductionStatus: "deducted",
          deductionReversed: false,
          outcomeReversedAt: null,
          ...reservationPatch,
        }),
    db.collection("creditTransactions").doc(canonicalDeductionId).set({
      academyId: ACADEMY_ID,
      sourceType: "privateReservation",
      sourceId: fixture.reservationId,
      studentId: fixture.studentId,
      packageId: fixture.packageId,
      deltaCount: -1,
      ...creditPatch,
    }),
    ...extraCredits.map(({id, data}) =>
      db.collection("creditTransactions").doc(id).set(data)),
  ]);
  return {fixture, canonicalDeductionId};
}

async function assertValidatorEvidenceRejected(name, options = {}) {
  const {fixture} = await seedValidatorEvidence({name, ...options});
  await assertRejectedWithoutWrites(
      () => commitStatus({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          requestId: `${name}-request`,
          actionType: "complete",
          commit: true,
          dryRun: false,
          previewOnly: false,
        },
      }),
      {
        code: "failed-precondition",
        blockedReason: "package_or_credit_write_required",
      },
      {case: name, callable: "commitPrivateLessonStatusAction"},
  );
}

async function validatorCaseV01WrongAcademy() {
  await assertValidatorEvidenceRejected("validator-wrong-academy", {
    creditPatch: {academyId: "other-academy"},
  });
}

async function validatorCaseV02WrongSource() {
  await assertValidatorEvidenceRejected("validator-wrong-source", {
    creditPatch: {
      sourceType: "otherSource",
      sourceId: "other-reservation",
    },
  });
}

async function validatorCaseV03WrongStudent() {
  await assertValidatorEvidenceRejected("validator-wrong-student", {
    creditPatch: {studentId: "other-student"},
  });
}

async function validatorCaseV04WrongPackage() {
  await assertValidatorEvidenceRejected("validator-wrong-package", {
    creditPatch: {packageId: "other-package"},
  });
}

async function validatorCaseV05ReversedHistoricalCredit() {
  const name = "validator-reversed-historical";
  const reversalId = `${name}-reversal`;
  await assertValidatorEvidenceRejected(name, {
    creditPatch: {reversalCreditTransactionId: reversalId},
    extraCredits: [{
      id: reversalId,
      data: {
        academyId: ACADEMY_ID,
        sourceType: "privateReservation",
        sourceId: `${name}-reservation`,
        studentId: `${name}-student`,
        packageId: `${name}-package`,
        deltaCount: 1,
        reversalOfTransactionId: buildValidatorCanonicalDeductionId({
          reservationId: `${name}-reservation`,
          studentId: `${name}-student`,
          packageId: `${name}-package`,
        }),
      },
    }],
  });
}

async function validatorCaseV06HistoricalPointerOnly() {
  const name = "validator-historical-pointer-only";
  const fixture = {
    reservationId: `${name}-reservation`,
    studentId: `${name}-student`,
    packageId: `${name}-package`,
  };
  await assertValidatorEvidenceRejected(name, {
    currentPointers: false,
    reservationPatch: {
      originalDeductionCreditTransactionId:
        buildValidatorCanonicalDeductionId(fixture),
    },
  });
}

async function validatorCaseV07CurrentPointerMismatch() {
  await assertValidatorEvidenceRejected("validator-pointer-mismatch", {
    reservationPatch: {
      deductionTransactionId: "validator-pointer-mismatch-other-credit",
    },
  });
}

async function validatorCaseV08AmbiguousActiveCandidates() {
  const name = "validator-ambiguous-candidates";
  await assertValidatorEvidenceRejected(name, {
    creditPatch: {packageId: `${name}-wrong-package`},
    extraCredits: [{
      id: `${name}-duplicate-credit`,
      data: {
        academyId: ACADEMY_ID,
        sourceType: "privateReservation",
        sourceId: `${name}-reservation`,
        studentId: `${name}-student`,
        packageId: `${name}-package`,
        deltaCount: -1,
      },
    }],
  });
}

async function validatorCaseV09CanonicalActiveControl() {
  const {fixture, canonicalDeductionId} = await seedValidatorEvidence({
    name: "validator-canonical-control",
  });
  const [packageBefore, creditBefore] = await Promise.all([
    getPackageCounts(fixture.packageId),
    getDocumentData("creditTransactions", canonicalDeductionId),
  ]);
  const result = await commitStatus({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      requestId: "validator-canonical-control-request",
      actionType: "no_show",
      commit: true,
      dryRun: false,
      previewOnly: false,
    },
  });
  assert.equal(result.committed, true);
  assert.equal((await getReservation(fixture.reservationId)).status, "no_show");
  assert.deepEqual(await getPackageCounts(fixture.packageId), packageBefore);
  assert.deepEqual(
      await getDocumentData("creditTransactions", canonicalDeductionId),
      creditBefore,
  );
  assert.equal((await getSourceCredits(fixture.reservationId)).length, 1);
}

async function assertNewFormatEvidenceRejected({
  name,
  actionType = "complete",
  seedOptions = {},
  prepare,
}) {
  const seeded = await seedValidatorEvidence({name, ...seedOptions});
  if (prepare) await prepare(seeded);
  await assertRejectedWithoutWrites(
      () => commitStatus({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: seeded.fixture.reservationId,
          requestId: `${name}-request`,
          actionType,
          commit: true,
          dryRun: false,
          previewOnly: false,
        },
      }),
      {
        code: "failed-precondition",
        blockedReason: "package_or_credit_write_required",
      },
      {case: name, callable: "commitPrivateLessonStatusAction"},
  );
}

async function newFormatCaseN01CreditPointerOnly() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-credit-pointer-only",
    seedOptions: {
      reservationPatch: {
        deductionTransactionId: admin.firestore.FieldValue.delete(),
      },
    },
  });
}

async function newFormatCaseN02TransactionPointerOnly() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-transaction-pointer-only",
    seedOptions: {
      reservationPatch: {
        deductionCreditTransactionId: admin.firestore.FieldValue.delete(),
      },
    },
  });
}

async function newFormatCaseN03PointerMismatch() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-pointer-mismatch",
    seedOptions: {
      reservationPatch: {
        deductionTransactionId: "new-format-pointer-mismatch-other",
      },
    },
  });
}

async function newFormatCaseN04MissingDirectCredit() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-missing-direct-credit",
    prepare: async ({canonicalDeductionId}) => {
      await db.collection("creditTransactions").doc(canonicalDeductionId)
          .delete();
    },
  });
}

async function newFormatCaseN05WrongAcademy() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-wrong-academy",
    seedOptions: {creditPatch: {academyId: "other-academy"}},
  });
}

async function newFormatCaseN06WrongSource() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-wrong-source",
    seedOptions: {
      creditPatch: {
        sourceType: "legacyPrivateReservation",
        sourceId: "other-reservation",
      },
    },
  });
}

async function newFormatCaseN07WrongStudent() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-wrong-student",
    seedOptions: {creditPatch: {studentId: "other-student"}},
  });
}

async function newFormatCaseN08WrongPackage() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-wrong-package",
    seedOptions: {creditPatch: {packageId: "other-package"}},
  });
}

async function newFormatCaseN09ReversedCredit() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-reversed-credit",
    seedOptions: {
      creditPatch: {
        reversalCreditTransactionId: "new-format-reversed-credit-marker",
      },
    },
  });
}

async function newFormatCaseN10DeterministicReversalExists() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-deterministic-reversal",
    prepare: async ({fixture, canonicalDeductionId}) => {
      await db.collection("creditTransactions")
          .doc(`reverse_${canonicalDeductionId}`)
          .set({
            academyId: ACADEMY_ID,
            sourceType: "privateReservation",
            sourceId: fixture.reservationId,
            studentId: fixture.studentId,
            packageId: fixture.packageId,
            deltaCount: 1,
            reversalOfTransactionId: canonicalDeductionId,
          });
    },
  });
}

async function newFormatCaseN11HistoricalNegativesNoPointer() {
  const name = "new-format-historical-negatives";
  const extraCredits = Array.from({length: 6}, (_, index) => ({
    id: `${name}-historical-${index + 1}`,
    data: {
      academyId: ACADEMY_ID,
      sourceType: "privateReservation",
      sourceId: `${name}-reservation`,
      studentId: `${name}-student`,
      packageId: `${name}-package`,
      deltaCount: -1,
    },
  }));
  await assertNewFormatEvidenceRejected({
    name,
    seedOptions: {currentPointers: false, extraCredits},
  });
}

async function newFormatCaseN12CompleteBypassAttempt() {
  await assertNewFormatEvidenceRejected({
    name: "new-format-complete-bypass",
    seedOptions: {currentPointers: false},
    prepare: async ({fixture}) => {
      await db.collection("lessons").doc(fixture.lessonId).update({
        deductionApplied: true,
        packageId: fixture.packageId,
      });
    },
  });
}

async function newFormatCaseN13NoShowBypassAttempt() {
  const name = "new-format-no-show-bypass";
  const {fixture} = await seedValidatorEvidence({
    name,
    currentPointers: false,
  });
  await db.collection("privateLessonReservations").doc(fixture.reservationId)
      .update({
        status: "completed",
        deductionSource: "auto",
        outcomeActorRole: "auto",
      });
  await assertRejectedWithoutWrites(
      () => markOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: fixture.reservationId,
          outcome: "no_show",
        },
      }),
      {code: "failed-precondition"},
      {case: name, callable: "markPrivateReservationOutcome"},
  );
}

async function newFormatCaseN14ValidDeltaZeroControls() {
  for (const actionType of ["complete", "no_show"]) {
    const {fixture, canonicalDeductionId} = await seedValidatorEvidence({
      name: `new-format-valid-${actionType}`,
    });
    const [packageBefore, creditBefore] = await Promise.all([
      getPackageCounts(fixture.packageId),
      getDocumentData("creditTransactions", canonicalDeductionId),
    ]);
    const result = await commitStatus({
      auth,
      data: {
        academyId: ACADEMY_ID,
        reservationId: fixture.reservationId,
        requestId: `new-format-valid-${actionType}-request`,
        actionType,
        commit: true,
        dryRun: false,
        previewOnly: false,
      },
    });
    assert.equal(result.committed, true);
    assert.equal(
        (await getReservation(fixture.reservationId)).status,
        actionType === "complete" ? "completed" : "no_show",
    );
    assert.deepEqual(await getPackageCounts(fixture.packageId), packageBefore);
    assert.deepEqual(
        await getDocumentData("creditTransactions", canonicalDeductionId),
        creditBefore,
    );
    assert.equal((await getSourceCredits(fixture.reservationId)).length, 1);
  }
}

async function seedDirectMarkReuseFixture({name, reservationPatch = {},
  creditPatch = {}, currentPointers = true}) {
  const fixture = await seedFixture({
    name,
    usedCount: 0,
    remainingCount: 4,
  });
  const committed = await previewAndCommitFixture({
    fixture,
    requestId: `${name}-initial-complete`,
    actionType: "complete",
  });
  const canonicalDeductionId = committed.result.creditTransactionId;
  const pointerPatch = currentPointers ? {} : {
    deductionCreditTransactionId: admin.firestore.FieldValue.delete(),
    deductionTransactionId: admin.firestore.FieldValue.delete(),
  };
  if (Object.keys(reservationPatch).length > 0 || !currentPointers) {
    await db.collection("privateLessonReservations").doc(fixture.reservationId)
        .update({...pointerPatch, ...reservationPatch});
  }
  if (Object.keys(creditPatch).length > 0) {
    await db.collection("creditTransactions").doc(canonicalDeductionId)
        .update(creditPatch);
  }
  return {fixture, canonicalDeductionId};
}

async function assertDirectMarkReuseRejected({
  name,
  reservationPatch = {},
  creditPatch = {},
  currentPointers = true,
  prepare,
  outcome = "completed",
}) {
  const seeded = await seedDirectMarkReuseFixture({
    name,
    reservationPatch,
    creditPatch,
    currentPointers,
  });
  if (prepare) await prepare(seeded);
  await assertRejectedWithoutWrites(
      () => markOutcome({
        auth,
        data: {
          academyId: ACADEMY_ID,
          reservationId: seeded.fixture.reservationId,
          outcome,
        },
      }),
      {
        code: "failed-precondition",
        blockedReason: "deduction_evidence_conflict",
      },
      {case: name, callable: "markPrivateReservationOutcome"},
  );
}

async function statusReversalCaseS01DirectCompletedReuse() {
  const {fixture, canonicalDeductionId} =
    await seedDirectMarkReuseFixture({name: "status-guard-s01-completed"});
  const [packageBefore, creditBefore] = await Promise.all([
    getPackageCounts(fixture.packageId),
    getDocumentData("creditTransactions", canonicalDeductionId),
  ]);
  const result = await markOutcome({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      outcome: "completed",
    },
  });
  assert.equal(result.reusedExistingDeduction, true);
  assert.equal(result.additionalPackageDeduction, 0);
  assert.deepEqual(await getPackageCounts(fixture.packageId), packageBefore);
  assert.deepEqual(
      await getDocumentData("creditTransactions", canonicalDeductionId),
      creditBefore,
  );
}

async function statusReversalCaseS02DirectAutoNoShowReuse() {
  const fixture = await seedFixture({
    name: "status-guard-s02-auto-no-show",
    remainingCount: 4,
    date: "2026-06-10",
  });
  assert.equal((await runAutoForFixture(fixture, "2026-06-11")).deducted, 1);
  const canonicalDeductionId =
    (await getReservation(fixture.reservationId))
        .deductionCreditTransactionId;
  const [packageBefore, creditBefore] = await Promise.all([
    getPackageCounts(fixture.packageId),
    getDocumentData("creditTransactions", canonicalDeductionId),
  ]);
  const result = await markOutcome({
    auth,
    data: {
      academyId: ACADEMY_ID,
      reservationId: fixture.reservationId,
      outcome: "no_show",
    },
  });
  assert.equal(result.reusedExistingDeduction, true);
  assert.equal(result.additionalPackageDeduction, 0);
  assert.equal((await getReservation(fixture.reservationId)).status, "no_show");
  assert.deepEqual(await getPackageCounts(fixture.packageId), packageBefore);
  assert.deepEqual(
      await getDocumentData("creditTransactions", canonicalDeductionId),
      creditBefore,
  );
}

async function statusReversalCaseS03CreditPointerOnly() {
  await assertDirectMarkReuseRejected({
    name: "status-guard-s03-credit-pointer-only",
    reservationPatch: {
      deductionTransactionId: admin.firestore.FieldValue.delete(),
    },
  });
}

async function statusReversalCaseS04TransactionPointerOnly() {
  await assertDirectMarkReuseRejected({
    name: "status-guard-s04-transaction-pointer-only",
    reservationPatch: {
      deductionCreditTransactionId: admin.firestore.FieldValue.delete(),
    },
  });
}

async function statusReversalCaseS05PointerMismatch() {
  await assertDirectMarkReuseRejected({
    name: "status-guard-s05-pointer-mismatch",
    reservationPatch: {
      deductionTransactionId: "status-guard-s05-other-credit",
    },
  });
}

async function statusReversalCaseS06MissingPointedCredit() {
  await assertDirectMarkReuseRejected({
    name: "status-guard-s06-missing-credit",
    prepare: async ({canonicalDeductionId}) => {
      await db.collection("creditTransactions").doc(canonicalDeductionId)
          .delete();
    },
  });
}

async function statusReversalCaseS07WrongTuple() {
  await assertDirectMarkReuseRejected({
    name: "status-guard-s07-wrong-tuple",
    creditPatch: {sourceId: "status-guard-s07-other-reservation"},
  });
}

async function statusReversalCaseS08ReversalAndHistoryReject() {
  await assertDirectMarkReuseRejected({
    name: "status-guard-s08-deterministic-reversal",
    prepare: async ({fixture, canonicalDeductionId}) => {
      await db.collection("creditTransactions")
          .doc(`reverse_${canonicalDeductionId}`)
          .set({
            academyId: ACADEMY_ID,
            sourceType: "privateReservation",
            sourceId: fixture.reservationId,
            studentId: fixture.studentId,
            packageId: fixture.packageId,
            deltaCount: 1,
            reversalOfTransactionId: canonicalDeductionId,
          });
    },
  });
  const name = "status-guard-s08-historical-only";
  await assertDirectMarkReuseRejected({
    name,
    currentPointers: false,
    reservationPatch: {
      originalDeductionCreditTransactionId:
        buildValidatorCanonicalDeductionId({
          reservationId: `${name}-reservation`,
          studentId: `${name}-student`,
          packageId: `${name}-package`,
        }),
    },
  });
}

async function seedActiveOutcomeForReversal(name) {
  const fixture = await seedFixture({name, usedCount: 0, remainingCount: 4});
  const committed = await previewAndCommitFixture({
    fixture,
    requestId: `${name}-deduct`,
    actionType: "no_show",
  });
  return {
    fixture,
    deductionId: committed.result.creditTransactionId,
  };
}

async function statusReversalCaseS09OriginalReversalOfReject() {
  const seeded = await seedActiveOutcomeForReversal(
      "status-guard-s09-original-reversal-of",
  );
  await db.collection("creditTransactions").doc(seeded.deductionId).update({
    reversalOfTransactionId: "status-guard-s09-unexpected-original",
  });
  const preview = await previewReversalFixture({
    fixture: seeded.fixture,
    requestId: "status-guard-s09-reverse",
  });
  assert.equal(preview.allowed, false);
  await assertRejectedWithoutWrites(
      () => reverseOutcome({
        auth,
        data: buildCurrentReversalPayload({
          fixture: seeded.fixture,
          requestId: "status-guard-s09-reverse",
          preview,
          reason: "reject malformed original marker",
        }),
      }),
      {
        code: "failed-precondition",
        blockedReason: "deduction_evidence_conflict",
      },
      {case: "S09", callable: "reversePrivateReservationOutcome"},
  );
}

async function statusReversalCaseS10ExistingReversalReject() {
  const seeded = await seedActiveOutcomeForReversal(
      "status-guard-s10-existing-reversal",
  );
  await reverseFixture({
    fixture: seeded.fixture,
    requestId: "status-guard-s10-first-reversal",
  });
  await db.collection("privateLessonReservations")
      .doc(seeded.fixture.reservationId)
      .update({
        status: "no_show",
        deductionApplied: true,
        deductionReversed: false,
        deductionStatus: "deducted",
        outcomeReversedAt: null,
      });
  const preview = await previewReversalFixture({
    fixture: seeded.fixture,
    requestId: "status-guard-s10-second-reversal",
  });
  await assertRejectedWithoutWrites(
      () => reverseOutcome({
        auth,
        data: buildCurrentReversalPayload({
          fixture: seeded.fixture,
          requestId: "status-guard-s10-second-reversal",
          preview,
          reason: "reject second package restore",
        }),
      }),
      {code: "failed-precondition"},
      {case: "S10", callable: "reversePrivateReservationOutcome"},
  );
}

async function seedReversedOutcomeForReplay(name) {
  const seeded = await seedActiveOutcomeForReversal(name);
  const first = await reverseFixture({
    fixture: seeded.fixture,
    requestId: `${name}-first-reversal`,
  });
  return {
    ...seeded,
    reversalId: first.creditTransactionId,
  };
}

async function assertReversalReplayMarkerRejected({name, markerValue}) {
  const seeded = await seedReversedOutcomeForReplay(name);
  await db.collection("creditTransactions").doc(seeded.deductionId).update({
    reversalCreditTransactionId: markerValue,
  });
  await assertRejectedWithoutWrites(
      () => reverseFixture({
        fixture: seeded.fixture,
        requestId: `${name}-replay`,
      }),
      {
        code: "failed-precondition",
        blockedReason: "reversal_checkpoint_incomplete",
      },
      {case: name, callable: "reversePrivateReservationOutcome"},
  );
}

async function statusReversalCaseS11ReplayMarkerMissing() {
  await assertReversalReplayMarkerRejected({
    name: "status-guard-s11-marker-missing",
    markerValue: admin.firestore.FieldValue.delete(),
  });
}

async function statusReversalCaseS12ReplayMarkerWrong() {
  await assertReversalReplayMarkerRejected({
    name: "status-guard-s12-marker-wrong",
    markerValue: "status-guard-s12-other-reversal",
  });
}

async function statusReversalCaseS13CanonicalReplays() {
  const seeded = await seedReversedOutcomeForReplay(
      "status-guard-s13-canonical-replays",
  );
  const packageAfterFirst = await getPackageCounts(seeded.fixture.packageId);
  const same = await reverseFixture({
    fixture: seeded.fixture,
    requestId: "status-guard-s13-canonical-replays-first-reversal",
  });
  const different = await reverseFixture({
    fixture: seeded.fixture,
    requestId: "status-guard-s13-different-reversal",
  });
  assert.equal(same.idempotentReplay, true);
  assert.equal(different.idempotentReplay, true);
  assert.deepEqual(
      await getPackageCounts(seeded.fixture.packageId),
      packageAfterFirst,
  );
  const original = await getDocumentData(
      "creditTransactions",
      seeded.deductionId,
  );
  const reversal = await getDocumentData(
      "creditTransactions",
      seeded.reversalId,
  );
  assert.equal(
      original.data.reversalCreditTransactionId,
      seeded.reversalId,
  );
  assert.equal(reversal.data.reversalOfTransactionId, seeded.deductionId);
}

async function statusReversalCaseS14ConcurrentCanonicalReversal() {
  const seeded = await seedActiveOutcomeForReversal(
      "status-guard-s14-concurrent-reversal",
  );
  const previews = await Promise.all([
    previewReversalFixture({
      fixture: seeded.fixture,
      requestId: "status-guard-s14-reversal-a",
    }),
    previewReversalFixture({
      fixture: seeded.fixture,
      requestId: "status-guard-s14-reversal-b",
    }),
  ]);
  const results = await Promise.all([
    reverseOutcome({
      auth,
      data: buildCurrentReversalPayload({
        fixture: seeded.fixture,
        requestId: "status-guard-s14-reversal-a",
        preview: previews[0],
        reason: "concurrent canonical reversal a",
      }),
    }),
    reverseOutcome({
      auth,
      data: buildCurrentReversalPayload({
        fixture: seeded.fixture,
        requestId: "status-guard-s14-reversal-b",
        preview: previews[1],
        reason: "concurrent canonical reversal b",
      }),
    }),
  ]);
  assert.equal(
      results.filter((result) => result.idempotentReplay === false).length,
      1,
  );
  assert.deepEqual(await getPackageCounts(seeded.fixture.packageId), {
    usedCount: 0,
    remainingCount: 4,
  });
  const reservation = await getReservation(seeded.fixture.reservationId);
  const original = await getDocumentData(
      "creditTransactions",
      seeded.deductionId,
  );
  const reversal = await getDocumentData(
      "creditTransactions",
      reservation.reversalCreditTransactionId,
  );
  assert.equal(
      original.data.reversalCreditTransactionId,
      reservation.reversalCreditTransactionId,
  );
  assert.equal(reversal.data.reversalOfTransactionId, seeded.deductionId);
}

const STATUS_REVERSAL_GUARD_CASES = [
  ["[S01] direct completed reuse keeps delta zero", statusReversalCaseS01DirectCompletedReuse],
  ["[S02] direct automatic no-show reuse keeps delta zero", statusReversalCaseS02DirectAutoNoShowReuse],
  ["[S03] direct credit pointer alone rejects", statusReversalCaseS03CreditPointerOnly],
  ["[S04] direct transaction pointer alone rejects", statusReversalCaseS04TransactionPointerOnly],
  ["[S05] direct pointer mismatch rejects", statusReversalCaseS05PointerMismatch],
  ["[S06] direct missing pointed credit rejects", statusReversalCaseS06MissingPointedCredit],
  ["[S07] direct wrong credit tuple rejects", statusReversalCaseS07WrongTuple],
  ["[S08] direct reversal and history evidence reject", statusReversalCaseS08ReversalAndHistoryReject],
  ["[S09] original reversal-of marker rejects", statusReversalCaseS09OriginalReversalOfReject],
  ["[S10] existing canonical reversal blocks second restore", statusReversalCaseS10ExistingReversalReject],
  ["[S11] replay missing original marker rejects", statusReversalCaseS11ReplayMarkerMissing],
  ["[S12] replay wrong original marker rejects", statusReversalCaseS12ReplayMarkerWrong],
  ["[S13] canonical same and different requests replay", statusReversalCaseS13CanonicalReplays],
  ["[S14] concurrent canonical reversal restores once", statusReversalCaseS14ConcurrentCanonicalReversal],
].map(([title, run]) => ({title, run}));

const NEW_FORMAT_CASES = [
  ["[N01] credit pointer alone rejects without writes", newFormatCaseN01CreditPointerOnly],
  ["[N02] transaction pointer alone rejects without writes", newFormatCaseN02TransactionPointerOnly],
  ["[N03] mismatched pointers reject without writes", newFormatCaseN03PointerMismatch],
  ["[N04] missing direct credit rejects without writes", newFormatCaseN04MissingDirectCredit],
  ["[N05] wrong academy rejects without writes", newFormatCaseN05WrongAcademy],
  ["[N06] wrong source rejects without writes", newFormatCaseN06WrongSource],
  ["[N07] wrong student rejects without writes", newFormatCaseN07WrongStudent],
  ["[N08] wrong package rejects without writes", newFormatCaseN08WrongPackage],
  ["[N09] reversed credit rejects without writes", newFormatCaseN09ReversedCredit],
  ["[N10] deterministic reversal rejects without writes", newFormatCaseN10DeterministicReversalExists],
  ["[N11] historical negatives cannot replace pointers", newFormatCaseN11HistoricalNegativesNoPointer],
  ["[N12] complete bypass attempt rejects without writes", newFormatCaseN12CompleteBypassAttempt],
  ["[N13] no-show bypass attempt rejects without writes", newFormatCaseN13NoShowBypassAttempt],
  ["[N14] valid complete and no-show keep delta zero", newFormatCaseN14ValidDeltaZeroControls],
].map(([title, run]) => ({title, run}));

const VALIDATOR_CASES = [
  ["[V01] wrong academy credit rejects without writes", validatorCaseV01WrongAcademy],
  ["[V02] wrong source credit rejects without writes", validatorCaseV02WrongSource],
  ["[V03] wrong student credit rejects without writes", validatorCaseV03WrongStudent],
  ["[V04] wrong package credit rejects without writes", validatorCaseV04WrongPackage],
  ["[V05] reversed historical credit rejects without writes", validatorCaseV05ReversedHistoricalCredit],
  ["[V06] historical pointer alone rejects without writes", validatorCaseV06HistoricalPointerOnly],
  ["[V07] mismatched current pointers reject without writes", validatorCaseV07CurrentPointerMismatch],
  ["[V08] ambiguous active candidates reject without writes", validatorCaseV08AmbiguousActiveCandidates],
  ["[V09] canonical active evidence keeps delta zero", validatorCaseV09CanonicalActiveControl],
].map(([title, run]) => ({title, run}));

const ACCOUNTING_CASES = [
  {
    title: "[A01] completed outcome deducts one",
    assertionId: "complete-package-credit-delta",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "deduction"},
    run: accountingCaseA01CompleteDeduction,
  },
  {
    title: "[A02] no-show outcome deducts one",
    assertionId: "no-show-package-credit-delta",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "deduction"},
    run: accountingCaseA02NoShowDeduction,
  },
  {
    title: "[A03] entitlement inventory remains bounded",
    assertionId: "inventory-no-positive-entitlement",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "inventory"},
    run: accountingCaseA03EntitlementInventory,
  },
  {
    title: "[A04] forbidden notice and makeup fields stay absent",
    assertionId: "forbidden-field-set-absent",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "schema"},
    run: accountingCaseA04ForbiddenFields,
  },
  {
    title: "[A05] identical commit request replays",
    assertionId: "same-request-zero-delta",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "replay"},
    run: accountingCaseA05ExactCommitReplay,
  },
  {
    title: "[A06] different commit request cannot rededuct",
    assertionId: "different-request-rejected-zero-delta",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "replay"},
    run: accountingCaseA06DifferentCommitRequest,
  },
  {
    title: "[A07] concurrent commits deduct once",
    assertionId: "parallel-commit-single-winner",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "parallel"},
    run: accountingCaseA07ConcurrentCommitRequests,
  },
  {
    title: "[A08] stale preview writes nothing",
    assertionId: "stale-preview-zero-delta",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "atomicity"},
    run: accountingCaseA08StalePreview,
  },
  {
    title: "[A09] duplicate credit collision writes nothing",
    assertionId: "credit-collision-zero-delta",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "atomicity"},
    run: accountingCaseA09DuplicateCreditCollision,
  },
  {
    title: "[A10] reversal restores one",
    assertionId: "single-reversal-restoration",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "reversal"},
    run: accountingCaseA10SingleReversalRestore,
  },
  {
    title: "[A11] identical reversal request replays",
    assertionId: "same-reversal-request-zero-delta",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "replay"},
    run: accountingCaseA11SameReversalRequestReplay,
  },
  {
    title: "[A12] different reversal request replays",
    assertionId: "different-reversal-request-zero-delta",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "replay"},
    run: accountingCaseA12DifferentReversalRequestReplay,
  },
  {
    title: "[A13] concurrent reversals restore once",
    assertionId: "parallel-reversal-single-winner",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "parallel"},
    run: accountingCaseA13ConcurrentReversalRequests,
  },
  {
    title: "[A14] original deduction identity is preserved",
    assertionId: "canonical-deduction-subset-stable",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "identity"},
    run: accountingCaseA14OriginalDeductionIdentity,
  },
  {
    title: "[A15] reversal identity is deterministic",
    assertionId: "reverse-prefix-no-alternate",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "identity"},
    run: accountingCaseA15DeterministicReversalIdentity,
  },
  {
    title: "[A16] package sentinels survive accounting writes",
    assertionId: "scalar-nested-array-deep-equality",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "preserve"},
    run: accountingCaseA16PackageSentinelPreservation,
  },
  {
    title: "[A17] automatic and manual ordering deducts once",
    assertionId: "auto-manual-ordering-single-deduction",
    evidence: {callable: "runAutoDeductPendingLessonsForTest", kind: "order"},
    run: accountingCaseA17AutoManualOrdering,
  },
  {
    title: "[A18] missing package fails closed",
    assertionId: "missing-package-zero-writes",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "guard"},
    run: accountingCaseA18MissingPackageFailClosed,
  },
  {
    title: "[A19] ambiguous package fails closed",
    assertionId: "ambiguous-package-zero-writes",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "guard"},
    run: accountingCaseA19AmbiguousPackageFailClosed,
  },
  {
    title: "[A20] conflicting lesson outcome fails closed",
    assertionId: "conflicting-outcome-zero-writes",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "guard"},
    run: accountingCaseA20ConflictingOutcomeFailClosed,
  },
  {
    title: "[A21] fixed provenance rejects direct paths",
    assertionId: "fixed-source-direct-path-zero-writes",
    evidence: {callable: "markPrivateReservationOutcome", kind: "provenance"},
    run: accountingCaseA21FixedDirectPathRejected,
  },
  {
    title: "[A22] canonical teacher UID mismatch writes nothing",
    assertionId: "teacher-uid-authority-zero-writes",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "authority"},
    run: accountingCaseA22CanonicalTeacherUidMismatch,
  },
  {
    title: "[A23] canonical write inventory has no shadows",
    assertionId: "deduction-reversal-inventory-exact",
    evidence: {callable: "reversePrivateReservationOutcome", kind: "inventory"},
    run: accountingCaseA23CanonicalWriteInventory,
  },
  {
    title: "[A24] transaction checkpoint records helper evidence",
    assertionId: "transaction-helper-checkpoint-exact",
    evidence: {callable: "commitPrivateLessonOutcomeAction", kind: "transaction"},
    run: accountingCaseA24TransactionCheckpointEvidence,
  },
];

const REMEDIATION_CASES = [
  ["[R01] second no-show cycle deducts once", remediationCaseR01SecondDeductionCycle],
  ["[R02] same request replays without another write", remediationCaseR02SameRequestReplay],
  ["[R03] different request reuses active deduction", remediationCaseR03DifferentRequestNoAdditionalDeduction],
  ["[R04] concurrent second cycle deducts once", remediationCaseR04ConcurrentSecondCycle],
  ["[R05] second reversal restores original balance", remediationCaseR05SecondReversalRestoresOriginalBalance],
  ["[R06] automatic deduction becomes no-show with delta zero", remediationCaseR06AutoDeductionStatusOnly],
  ["[R07] reversal drift rejects with zero writes", remediationCaseR07ReversalDriftRejectsWithoutWrites],
  ["[R08] cross-cycle reversal hash rejects", remediationCaseR08CrossCycleHashRejects],
  ["[R09] current reversal shape is strict", remediationCaseR09CurrentStrictShape],
  ["[R10] legacy reversal shape replays once", remediationCaseR10LegacyCompatibilityReplay],
  ["[R11] requestId-only reversal rejects", remediationCaseR11RequestIdOnlyRejects],
  ["[R12] planHash-only reversal rejects", remediationCaseR12PlanHashOnlyRejects],
  ["[R13] UI wording follows actual package impact", remediationCaseR13UiImpactWording],
  ["[R14] A1 allowlist is exact and wildcard-free", remediationCaseR14StrictAllowlist],
].map(([title, run]) => ({title, run}));

async function seedAdminMembership() {
  await db.collection("academyMemberships")
      .doc(`${ACADEMY_ID}_${ACTOR_UID}`)
      .set({
        academyId: ACADEMY_ID,
        uid: ACTOR_UID,
        role: "owner",
        status: "active",
        displayName: "Outcome Commit Admin",
      });
}

async function main() {
  await clearDedicatedFirestoreEmulator();
  try {
    await seedAdminMembership();
    for (const testCase of ACCOUNTING_CASES) {
      await runAccountingCase(testCase);
    }
    for (const testCase of REMEDIATION_CASES) {
      await runRemediationCase(testCase);
    }
    for (const testCase of VALIDATOR_CASES) {
      await runValidatorCase(testCase);
    }
    for (const testCase of NEW_FORMAT_CASES) {
      await runNewFormatCase(testCase);
    }
    for (const testCase of STATUS_REVERSAL_GUARD_CASES) {
      await runStatusReversalGuardCase(testCase);
    }

    await clearDedicatedFirestoreEmulator();
    await seedAdminMembership();
    await testCompleteReplayAndConflict();
    await testNoShowAtomicResult();
    await testRegularAbsenceReplayAndReversal();
    await testRegularAbsenceConcurrentAndAutoOrdering();
    await testRegularAbsenceFailClosedCases();
    await testStalePreviewAbortsBeforeWrites();
    await testDuplicateCreditIsBlocked();
    await testHelperFailureLeavesNoCheckpoint();
    await testIncompleteCheckpointIsNotReplayed();
    await testConcurrentRequestsDeductOnce();
    await testFixedSourcesRejectedByEveryDirectPath();
    await testFixedProvenanceClassifierMatrix();
    await testCallableIdValidation();
    await testNormalStatusPathStillSucceeds();
    await testLessonIdOnlyStatusCommitReplays();
    console.log("private lesson outcome commit emulator tests passed");
  } finally {
    await clearDedicatedFirestoreEmulator();
  }
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
