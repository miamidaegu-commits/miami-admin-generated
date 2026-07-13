"use strict";

const assert = require("node:assert/strict");

const PROJECT_ID = "demo-fixed-private-auto-deduction";
const ACADEMY_ID = "fixed-private-auto-deduction-academy";
const ADMIN_UID = "fixed-private-auto-deduction-admin";
const TEACHER_UID = "fixed-private-auto-deduction-teacher";
const TEACHER_KEY = "fixed-private-auto-deduction-teacher-key";

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required.");
}
if (!PROJECT_ID.startsWith("demo-")) {
  throw new Error("A demo project is required.");
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID});

const functionsTest = require(
    "../functions/node_modules/firebase-functions-test",
)({projectId: PROJECT_ID});
const functions = require("../functions/index.js");
const admin = require("../functions/node_modules/firebase-admin");
const db = admin.firestore();
const runAutoDeduction = functionsTest.wrap(
    functions.runAutoDeductPendingLessonsForTest,
);
const auth = {
  uid: ADMIN_UID,
  token: {
    email: "fixed-auto-deduction-admin@example.com",
    name: "Fixed Auto Deduction Admin",
  },
};

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

async function seedFixture({name, date, target = "", patch = {}}) {
  const studentId = `${name}-student`;
  const packageId = `${name}-package`;
  const lessonId = `${name}-lesson`;
  const slotId = `${name}-slot`;
  const reservationId = `${name}-reservation`;
  const startAt = admin.firestore.Timestamp.fromMillis(
      Date.now() - 2 * 60 * 60 * 1000,
  );
  const lesson = {
    academyId: ACADEMY_ID,
    studentId,
    packageId,
    slotId,
    reservationId,
    teacher: TEACHER_KEY,
    teacherKey: TEACHER_KEY,
    teacherUid: TEACHER_UID,
    date,
    time: "09:00",
    startAt,
    durationMinutes: 50,
    status: "active",
    source: "direct",
  };
  const reservation = {
    academyId: ACADEMY_ID,
    studentId,
    packageId,
    lessonId,
    slotId,
    teacher: TEACHER_KEY,
    teacherKey: TEACHER_KEY,
    teacherUid: TEACHER_UID,
    date,
    time: "09:00",
    startAt,
    durationMinutes: 50,
    status: "active",
    source: "student",
    deductionApplied: false,
  };
  const slot = {
    academyId: ACADEMY_ID,
    studentId,
    packageId,
    lessonId,
    reservationId,
    reservedStudentId: studentId,
    teacher: TEACHER_KEY,
    teacherKey: TEACHER_KEY,
    teacherUid: TEACHER_UID,
    date,
    time: "09:00",
    startAt,
    durationMinutes: 50,
    status: "reserved",
    slotType: "one_time",
  };
  if (target === "lesson") Object.assign(lesson, patch);
  if (target === "reservation") Object.assign(reservation, patch);
  if (target === "slot") Object.assign(slot, patch);
  await Promise.all([
    db.collection("privateStudents").doc(studentId).set({
      academyId: ACADEMY_ID,
      name: `${name} student`,
      teacher: TEACHER_KEY,
      status: "active",
    }),
    db.collection("studentPackages").doc(packageId).set({
      academyId: ACADEMY_ID,
      studentId,
      studentName: `${name} student`,
      teacher: TEACHER_KEY,
      teacherName: TEACHER_KEY,
      teacherKey: TEACHER_KEY,
      teacherUid: TEACHER_UID,
      packageType: "private",
      totalCount: 3,
      usedCount: 0,
      remainingCount: 3,
      status: "active",
      startDate: "2025-01-01",
      endDate: "2027-12-31",
    }),
    db.collection("lessons").doc(lessonId).set(lesson),
    db.collection("privateLessonReservations")
        .doc(reservationId).set(reservation),
    db.collection("privateLessonSlots").doc(slotId).set(slot),
  ]);
  return {studentId, packageId, lessonId, slotId, reservationId, date};
}

async function main() {
  await db.collection("academyMemberships")
      .doc(`${ACADEMY_ID}_${ADMIN_UID}`).set({
        academyId: ACADEMY_ID,
        uid: ADMIN_UID,
        role: "owner",
        status: "active",
        permissions: {},
      });
  const cases = [
    ["canonical-lesson", "lesson", {fixedPrivateDeductionLedger: "reservation_v1"}],
    ["canonical-reservation", "reservation", {fixedPrivateDeductionLedger: "reservation_v1"}],
    ["canonical-slot", "slot", {fixedPrivateDeductionLedger: "reservation_v1"}],
    ["weekly-legacy-slot", "slot", {sourceType: "weekly-slot-fixed-assignment-legacy"}],
    ["assignment-batch-reservation", "reservation", {fixedPrivateAssignmentBatchId: "legacy-batch"}],
    ["fixed-lesson-id-only", "lesson", {fixedLessonId: "legacy-fixed-lesson"}],
  ];
  const fixedFixtures = [];
  for (let index = 0; index < cases.length; index += 1) {
    const [name, target, patch] = cases[index];
    fixedFixtures.push(await seedFixture({
      name,
      target,
      patch,
      date: `2026-01-${String(index + 2).padStart(2, "0")}`,
    }));
  }
  const fixedBefore = await snapshotSafetyState();
  const fixedResult = await runAutoDeduction({
    auth,
    data: {
      academyId: ACADEMY_ID,
      dates: fixedFixtures.map((fixture) => fixture.date),
      todayYmd: "2026-07-13",
      dryRun: false,
    },
  });
  assert.equal(fixedResult.deducted, 0);
  assert.equal(
      fixedResult.skippedUnsupportedFixedPrivate,
      fixedFixtures.length,
  );
  assert.equal(await snapshotSafetyState(), fixedBefore);

  const normal = await seedFixture({
    name: "normal-direct",
    date: "2026-01-20",
  });
  const normalResult = await runAutoDeduction({
    auth,
    data: {
      academyId: ACADEMY_ID,
      dates: [normal.date],
      todayYmd: "2026-07-13",
      dryRun: false,
    },
  });
  assert.equal(normalResult.deducted, 1);
  const [reservation, privatePackage, credits] = await Promise.all([
    db.collection("privateLessonReservations").doc(normal.reservationId).get(),
    db.collection("studentPackages").doc(normal.packageId).get(),
    db.collection("creditTransactions")
        .where("academyId", "==", ACADEMY_ID)
        .where("sourceId", "==", normal.reservationId).get(),
  ]);
  assert.equal(reservation.get("status"), "completed");
  assert.equal(reservation.get("deductionApplied"), true);
  assert.equal(privatePackage.get("usedCount"), 1);
  assert.equal(privatePackage.get("remainingCount"), 2);
  assert.equal(credits.size, 1);
  console.log("fixed private auto-deduction emulator tests passed");
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
