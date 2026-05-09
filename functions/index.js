/* eslint-disable require-jsdoc */
const {setGlobalOptions} = require("firebase-functions/v2");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const {
  STUDENT_ACCOUNT_PERMISSIONS,
  TEACHER_ACCOUNT_PERMISSIONS,
  assertSafeStudentAccountLink,
  assertSafeTeacherAccountLink,
  normalizeEmail,
  normalizeId,
  validateAcademyId,
} = require("./linkStudentAccountSafety.cjs");

admin.initializeApp();

setGlobalOptions({maxInstances: 10});

const OWNER_EMAIL = "miamidaegu@gmail.com";
const REGION = "us-central1";
const STUDENT_PRIVATE_CANCEL_LIMIT = 4;
const STUDENT_PRIVATE_CANCEL_CUTOFF_MS = 6 * 60 * 60 * 1000;
const PRIVATE_SLOT_BOOKING_NOT_READY_MESSAGE =
  "1:1 예약 기능은 아직 선택된 학생에게만 제공됩니다.";
const HOSTED_APP_URL_BY_PROJECT_ID = {
  "daegu-miami-production": "https://daegumiami.com",
  "miami-e2e": "https://miami-e2e.web.app",
};

function normalizeHostedAppUrl(value) {
  return String(value || "").trim().replace(/\/+$/, "");
}

function getProjectIdFromFirebaseConfig() {
  try {
    const config = JSON.parse(process.env.FIREBASE_CONFIG || "{}");
    return normalizeHostedAppUrl(config.projectId);
  } catch (error) {
    if (error instanceof SyntaxError) return "";
    return "";
  }
}

function getRuntimeProjectId() {
  return (
    normalizeHostedAppUrl(process.env.GCLOUD_PROJECT) ||
    normalizeHostedAppUrl(process.env.GOOGLE_CLOUD_PROJECT) ||
    getProjectIdFromFirebaseConfig()
  );
}

function getHostedAppUrl() {
  const explicitUrl = normalizeHostedAppUrl(process.env.HOSTED_APP_URL);
  if (explicitUrl) return explicitUrl;

  const projectId = getRuntimeProjectId();
  return HOSTED_APP_URL_BY_PROJECT_ID[projectId] || "https://miami-e2e.web.app";
}

function isEnabledFlag(value) {
  return ["1", "true", "yes", "on", "enabled"].includes(
      String(value || "").trim().toLowerCase(),
  );
}

function isPrivateSlotReservationEnabled() {
  const projectId = getRuntimeProjectId();
  if (projectId === "miami-e2e") return true;

  return isEnabledFlag(process.env.PRIVATE_SLOT_BOOKING_ENABLED);
}

function isPrivateSlotReservationPilotRequired() {
  return getRuntimeProjectId() !== "miami-e2e";
}

function requirePrivateSlotReservationEnabled() {
  if (isPrivateSlotReservationEnabled()) return;
  throw new HttpsError(
      "failed-precondition",
      PRIVATE_SLOT_BOOKING_NOT_READY_MESSAGE,
  );
}

function requirePrivateSlotBookingPilotEnabled(summary) {
  if (!isPrivateSlotReservationPilotRequired()) return;
  if (summary && summary.privateSlotBookingPilotEnabled === true) return;
  throw new HttpsError(
      "failed-precondition",
      PRIVATE_SLOT_BOOKING_NOT_READY_MESSAGE,
  );
}

const HOSTED_APP_URL = getHostedAppUrl();
const STUDENT_PASSWORD_SETUP_ACTION_SETTINGS = {
  url: HOSTED_APP_URL,
};
const TEACHER_PASSWORD_SETUP_ACTION_SETTINGS = {
  url: HOSTED_APP_URL,
};

function asHttpsError(error) {
  if (error instanceof HttpsError) return error;
  if (/^Invalid email$/.test(error.message)) {
    return new HttpsError("invalid-argument", "Invalid email.");
  }
  if (/real academy id|missing studentId/.test(error.message)) {
    return new HttpsError("invalid-argument", error.message);
  }
  if (/^Refusing to link/.test(error.message) ||
      /^Refusing to convert/.test(error.message)) {
    return new HttpsError("failed-precondition", error.message);
  }
  return new HttpsError("internal", error.message || "Unknown error.");
}

function normalizeTeacherKey(value) {
  return String(value || "").trim().toLowerCase();
}

function requireString(data, key) {
  const value = String((data && data[key]) || "").trim();
  if (!value) {
    throw new HttpsError("invalid-argument", `${key} is required.`);
  }
  return value;
}

function optionalString(data, key) {
  return String((data && data[key]) || "").trim();
}

function validateTemporaryPassword(value) {
  const password = String(value || "");
  if (password && password.length < 6) {
    throw new HttpsError(
        "invalid-argument",
        "temporaryPassword must be at least 6 characters.",
    );
  }
  return password;
}

async function getAuthUserByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error && error.code === "auth/user-not-found") return null;
    throw error;
  }
}

async function setMergeWithTimestamps(ref, data) {
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : null;
  await ref.set(
      {
        ...data,
        createdAt: existing && existing.createdAt ?
          existing.createdAt :
          admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      {merge: true},
  );
}

async function createStudentAccessSummaryDocsIfMissing(db, {
  academyId,
  studentId,
}) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  const groupSummaryRef = db
      .collection("studentGroupAccessSummary")
      .doc(`${academyId}__${studentId}`);
  const privateSummaryRef = db
      .collection("studentPrivateAccessSummary")
      .doc(`${academyId}__${studentId}`);
  const [groupSummarySnap, privateSummarySnap] = await Promise.all([
    groupSummaryRef.get(),
    privateSummaryRef.get(),
  ]);
  const writes = [];

  if (!groupSummarySnap.exists) {
    writes.push(groupSummaryRef.create({
      academyId,
      studentId,
      groupClassIds: [],
      createdAt: now,
      updatedAt: now,
    }));
  }

  if (!privateSummarySnap.exists) {
    writes.push(privateSummaryRef.create({
      academyId,
      studentId,
      teacherKeys: [],
      activePackageIds: [],
      createdAt: now,
      updatedAt: now,
    }));
  }

  await Promise.all(writes);
}

async function requireAcademyAdmin(db, academyId, uid) {
  const membershipId = `${academyId}_${uid}`;
  const membershipSnap = await db
      .collection("academyMemberships")
      .doc(membershipId)
      .get();
  const membership = membershipSnap.exists ? membershipSnap.data() || {} : null;
  const role = String((membership && membership.role) || "").toLowerCase();
  if (
    !membership ||
    membership.status !== "active" ||
    !(role === "owner" || role === "admin")
  ) {
    throw new HttpsError(
        "permission-denied",
        "Active academy owner/admin membership required.",
    );
  }
}

function requireActiveStudentMembership(membershipSnap) {
  const membership = membershipSnap.exists ? membershipSnap.data() || {} : null;
  const role = String((membership && membership.role) || "")
      .trim()
      .toLowerCase();
  const status = String((membership && membership.status) || "")
      .trim()
      .toLowerCase();
  const studentId = normalizeId(membership && membership.studentId);

  if (!membership || role !== "student" || status !== "active") {
    throw new HttpsError(
        "permission-denied",
        "Active student membership required.",
    );
  }

  if (!studentId) {
    throw new HttpsError(
        "failed-precondition",
        "Student membership is not linked to a student.",
    );
  }

  return {
    ...membership,
    studentId,
  };
}

function normalizeIdList(value) {
  return Array.isArray(value) ?
    value.map((item) => normalizeId(item)).filter(Boolean) :
    [];
}

function normalizeTeacherKeyList(value) {
  return Array.isArray(value) ?
    value.map((item) => normalizeTeacherKey(item)).filter(Boolean) :
    [];
}

function privateReservationDocId({academyId, slotId, studentId}) {
  return `${academyId}__${slotId}__${studentId}`;
}

function hasSlotAccess({slot, summary, slotId, studentId}) {
  const eligibleStudentIds = normalizeIdList(slot.eligibleStudentIds);
  const allowedSlotIds = normalizeIdList(summary && summary.allowedSlotIds);
  const allowedPrivateLessonSlotIds = normalizeIdList(
      summary && summary.allowedPrivateLessonSlotIds,
  );
  const teacherKeys = normalizeTeacherKeyList(summary && summary.teacherKeys);
  const activePackageIds = normalizeIdList(summary && summary.activePackageIds);
  const slotTeacherKeys = [
    normalizeTeacherKey(slot && slot.teacher),
    normalizeTeacherKey(slot && slot.teacherName),
  ].filter(Boolean);
  const hasTeacherPackageAccess =
    activePackageIds.length > 0 &&
    slotTeacherKeys.some((teacherKey) => teacherKeys.includes(teacherKey));

  return eligibleStudentIds.includes(studentId) ||
    allowedSlotIds.includes(slotId) ||
    allowedPrivateLessonSlotIds.includes(slotId) ||
    hasTeacherPackageAccess;
}

function isActivePrivateReservation(data) {
  return String((data && data.status) || "").trim() === "active";
}

function getNextStudentPackageStatus(currentStatus, remainingCount) {
  if (String(currentStatus || "").trim().toLowerCase() === "ended") {
    return "ended";
  }
  const rem = Number(remainingCount || 0);
  if (!Number.isFinite(rem) || rem <= 0) return "exhausted";
  return "active";
}

function isApprovedLessonAtSameTime(data) {
  const status = String((data && data.status) || "").trim().toLowerCase();
  const approvalStatus = String((data && data.approvalStatus) || "")
      .trim()
      .toLowerCase();
  const isCancelled =
    status === "cancelled" ||
    status === "canceled" ||
    data.completed === "cancelled" ||
    data.isDeductCancelled === true;

  if (isCancelled) return false;
  return !approvalStatus || approvalStatus === "approved";
}

function getLessonDateString(data) {
  const date = String((data && (data.date || data.lessonDate)) || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

async function getStudentLessonRows(transaction, db, {academyId, studentId}) {
  const querySpecs = [
    db
        .collection("lessons")
        .where("academyId", "==", academyId)
        .where("studentId", "==", studentId),
    db
        .collection("lessons")
        .where("academyId", "==", academyId)
        .where("studentID", "==", studentId),
  ];
  const snaps = await Promise.all(
      querySpecs.map((querySpec) => transaction.get(querySpec)),
  );
  const byId = new Map();
  snaps.forEach((snap) => {
    snap.docs.forEach((docSnap) => {
      byId.set(docSnap.id, docSnap.data() || {});
    });
  });
  return Array.from(byId.values());
}

function getOptionalSlotString(slot, key) {
  const value = normalizeId(slot && slot[key]);
  return value || null;
}

function getOptionalStudentName({student, membership, reservation}) {
  return (
    getOptionalSlotString(student, "name") ||
    getOptionalSlotString(student, "studentName") ||
    getOptionalSlotString(membership, "displayName") ||
    getOptionalSlotString(reservation, "studentName") ||
    null
  );
}

function getReservationTeacherKey(reservation, slot) {
  return normalizeTeacherKey(
      reservation && (reservation.teacherName || reservation.teacher),
  ) || normalizeTeacherKey(slot && (slot.teacherName || slot.teacher));
}

function isPrivatePackageForReservation(pkg, reservation, slot) {
  if (
    !pkg ||
    normalizeId(pkg.academyId) !== normalizeId(reservation.academyId)
  ) {
    return false;
  }
  if (normalizeId(pkg.studentId) !== normalizeId(reservation.studentId)) {
    return false;
  }
  if (String(pkg.packageType || "").trim() !== "private") return false;
  const teacherKey = getReservationTeacherKey(reservation, slot);
  if (!teacherKey) return false;
  if (normalizeTeacherKey(pkg.teacher) !== teacherKey) return false;
  const status = String(pkg.status || "active").trim().toLowerCase();
  return status !== "ended" && status !== "cancelled" && status !== "canceled";
}

function sortPrivatePackageCandidates(a, b) {
  const aRemaining = Number(a.data.remainingCount || 0);
  const bRemaining = Number(b.data.remainingCount || 0);
  if (aRemaining !== bRemaining) return aRemaining - bRemaining;
  const aCreated = getTimestampMillis(a.data.createdAt) || 0;
  const bCreated = getTimestampMillis(b.data.createdAt) || 0;
  return aCreated - bCreated;
}

function getTimestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : null;
  }
  if (value instanceof Date) {
    const millis = value.getTime();
    return Number.isFinite(millis) ? millis : null;
  }
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function getSeoulDateTimeMillis(dateValue, timeValue) {
  const date = String(dateValue || "").trim();
  const time = String(timeValue || "").trim();
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function getPrivateSlotStartMillis(slot) {
  const startAtMillis = getTimestampMillis(slot && slot.startAt);
  if (startAtMillis !== null) return startAtMillis;
  return getSeoulDateTimeMillis(slot && slot.date, slot && slot.time);
}

function createPrivateSlotNotification(transaction, db, {
  academyId,
  type,
  studentId,
  studentName,
  teacher,
  teacherName,
  slotId,
  reservationId,
  date,
  time,
  source,
  createdAt,
}) {
  const eventData = {
    academyId,
    type,
    studentId,
    teacher,
    slotId,
    reservationId,
    date,
    time,
    source,
    createdAt,
  };
  if (studentName) eventData.studentName = studentName;
  if (teacherName) eventData.teacherName = teacherName;

  transaction.create(db.collection("notificationEvents").doc(), eventData);
}

exports.reservePrivateLessonSlot = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        requirePrivateSlotReservationEnabled();

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const slotId = requireString(data, "slotId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const slotRef = db.collection("privateLessonSlots").doc(slotId);

        return await db.runTransaction(async (transaction) => {
          const [membershipSnap, slotSnap] = await Promise.all([
            transaction.get(membershipRef),
            transaction.get(slotRef),
          ]);
          const membership = requireActiveStudentMembership(membershipSnap);

          if (!slotSnap.exists) {
            throw new HttpsError(
                "not-found",
                "Private lesson slot not found.",
            );
          }

          const slot = slotSnap.data() || {};
          if (normalizeId(slot.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private lesson slot academy mismatch.",
            );
          }
          if (String(slot.status || "").trim() !== "open") {
            throw new HttpsError(
                "failed-precondition",
                "Private lesson slot is not open.",
            );
          }

          const studentId = membership.studentId;
          const studentRef = db.collection("privateStudents").doc(studentId);
          const summaryRef = db
              .collection("studentPrivateAccessSummary")
              .doc(`${academyId}__${studentId}`);
          const [studentSnap, summarySnap] = await Promise.all([
            transaction.get(studentRef),
            transaction.get(summaryRef),
          ]);
          if (!studentSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "Student record not found.",
            );
          }
          const student = studentSnap.data() || {};
          if (normalizeId(student.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Student academy mismatch.",
            );
          }
          const summary = summarySnap.exists ? summarySnap.data() || {} : null;
          requirePrivateSlotBookingPilotEnabled(summary);

          if (!hasSlotAccess({slot, summary, slotId, studentId})) {
            throw new HttpsError(
                "permission-denied",
                "Student is not eligible for this private lesson slot.",
            );
          }

          const date = requireString(slot, "date");
          const time = requireString(slot, "time");
          const teacher = requireString(slot, "teacher");
          const reservationId = privateReservationDocId({
            academyId,
            slotId,
            studentId,
          });
          const reservationRef = db
              .collection("privateLessonReservations")
              .doc(reservationId);
          const reservationSnap = await transaction.get(reservationRef);
          if (
            reservationSnap.exists &&
            isActivePrivateReservation(reservationSnap.data() || {})
          ) {
            throw new HttpsError(
                "already-exists",
                "Student already reserved this private lesson slot.",
            );
          }

          const sameTimeActiveReservationSnap = await transaction.get(
              db
                  .collection("privateLessonReservations")
                  .where("academyId", "==", academyId)
                  .where("studentId", "==", studentId)
                  .where("date", "==", date)
                  .where("time", "==", time)
                  .where("status", "==", "active"),
          );
          const hasReservationConflict =
            sameTimeActiveReservationSnap.docs.some(
                (docSnap) => docSnap.id !== reservationId,
            );
          if (hasReservationConflict) {
            throw new HttpsError(
                "failed-precondition",
                "Student already has a private reservation at this time.",
            );
          }

          const studentLessons = await getStudentLessonRows(
              transaction,
              db,
              {academyId, studentId},
          );
          const hasLessonConflict = studentLessons.some((lesson) =>
            getLessonDateString(lesson) === date &&
              String(lesson.time || "").trim() === time &&
              isApprovedLessonAtSameTime(lesson),
          );
          if (hasLessonConflict) {
            throw new HttpsError(
                "failed-precondition",
                "Student already has an approved lesson at this time.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          const existingReservation =
            reservationSnap.exists ? reservationSnap.data() || {} : null;
          const existingReservationStatus = String(
              (existingReservation && existingReservation.status) || "",
          ).trim();
          if (
            existingReservation &&
            existingReservationStatus !== "cancelled" &&
            existingReservationStatus !== "canceled"
          ) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation cannot be reused in its current status.",
            );
          }
          const reservationData = {
            academyId,
            slotId,
            studentId,
            teacher,
            date,
            time,
            status: "active",
            source: "student",
            reservedAt: now,
            cancelledAt: null,
            createdAt:
              existingReservation && existingReservation.createdAt ?
                existingReservation.createdAt :
                now,
            updatedAt: now,
          };
          const teacherName = getOptionalSlotString(slot, "teacherName");
          const subject = getOptionalSlotString(slot, "subject");
          const studentName = getOptionalStudentName({student, membership});
          if (teacherName) reservationData.teacherName = teacherName;
          if (subject) reservationData.subject = subject;
          if (studentName) reservationData.studentName = studentName;

          transaction.set(reservationRef, reservationData, {merge: true});
          transaction.update(slotRef, {
            status: "reserved",
            reservedStudentId: studentId,
            reservationId,
            reservedAt: now,
            updatedAt: now,
            reservedCount: 1,
          });
          createPrivateSlotNotification(transaction, db, {
            academyId,
            type: "private_slot_reserved",
            studentId,
            studentName,
            teacher,
            teacherName,
            slotId,
            reservationId,
            date,
            time,
            source: "student",
            createdAt: now,
          });

          return {
            ok: true,
            academyId,
            slotId,
            studentId,
            reservationId,
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.cancelPrivateLessonReservation = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        requirePrivateSlotReservationEnabled();

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const slotId = requireString(data, "slotId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const slotRef = db.collection("privateLessonSlots").doc(slotId);

        return await db.runTransaction(async (transaction) => {
          const membershipSnap = await transaction.get(membershipRef);
          const membership = requireActiveStudentMembership(membershipSnap);
          const studentId = membership.studentId;
          const reservationId = privateReservationDocId({
            academyId,
            slotId,
            studentId,
          });
          const reservationRef = db
              .collection("privateLessonReservations")
              .doc(reservationId);
          const statsRef = db
              .collection("studentPrivateBookingStats")
              .doc(`${academyId}__${studentId}`);
          const studentRef = db.collection("privateStudents").doc(studentId);
          const summaryRef = db
              .collection("studentPrivateAccessSummary")
              .doc(`${academyId}__${studentId}`);

          const [
            reservationSnap,
            slotSnap,
            statsSnap,
            studentSnap,
            summarySnap,
          ] = await Promise.all([
            transaction.get(reservationRef),
            transaction.get(slotRef),
            transaction.get(statsRef),
            transaction.get(studentRef),
            transaction.get(summaryRef),
          ]);

          if (!reservationSnap.exists) {
            throw new HttpsError(
                "not-found",
                "Active private reservation not found.",
            );
          }
          const reservation = reservationSnap.data() || {};
          if (normalizeId(reservation.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private reservation academy mismatch.",
            );
          }
          if (normalizeId(reservation.studentId) !== studentId) {
            throw new HttpsError(
                "permission-denied",
                "Cannot cancel another student's private reservation.",
            );
          }
          if (normalizeId(reservation.slotId) !== slotId) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation slot mismatch.",
            );
          }
          if (!isActivePrivateReservation(reservation)) {
            throw new HttpsError(
                "failed-precondition",
                "Active private reservation not found.",
            );
          }
          if (!slotSnap.exists) {
            throw new HttpsError(
                "not-found",
                "Private lesson slot not found.",
            );
          }

          const slot = slotSnap.data() || {};
          if (normalizeId(slot.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private lesson slot academy mismatch.",
            );
          }
          const summary = summarySnap.exists ? summarySnap.data() || {} : null;
          requirePrivateSlotBookingPilotEnabled(summary);
          const startMillis = getPrivateSlotStartMillis(slot);
          if (startMillis === null) {
            throw new HttpsError(
                "failed-precondition",
                "Private lesson slot start time is invalid.",
            );
          }
          if (Date.now() > startMillis - STUDENT_PRIVATE_CANCEL_CUTOFF_MS) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation can only be cancelled at least 6 hours " +
                "before start time.",
            );
          }

          const stats = statsSnap.exists ? statsSnap.data() || {} : {};
          const studentCancelCount = Number(stats.studentCancelCount || 0);
          const safeStudentCancelCount =
            Number.isFinite(studentCancelCount) && studentCancelCount > 0 ?
              Math.floor(studentCancelCount) :
              0;
          if (safeStudentCancelCount >= STUDENT_PRIVATE_CANCEL_LIMIT) {
            throw new HttpsError(
                "failed-precondition",
                "Student private reservation cancellation limit reached.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(reservationRef, {
            status: "cancelled",
            cancelledAt: now,
            cancelledBy: "student",
            cancelledByUid: uid,
            updatedAt: now,
          });
          transaction.set(statsRef, {
            academyId,
            studentId,
            studentCancelCount: safeStudentCancelCount + 1,
            createdAt:
              statsSnap.exists && stats.createdAt ? stats.createdAt : now,
            updatedAt: now,
          }, {merge: true});

          if (normalizeId(slot.reservationId) === reservationId) {
            transaction.update(slotRef, {
              status: "open",
              reservedStudentId: "",
              reservationId: "",
              reservedAt: null,
              cancelledAt: now,
              updatedAt: now,
              reservedCount: 0,
            });
          }
          const student = studentSnap.exists ? studentSnap.data() || {} : null;
          const date = requireString(slot, "date");
          const time = requireString(slot, "time");
          const teacher = requireString(slot, "teacher");
          const teacherName = getOptionalSlotString(slot, "teacherName") ||
            getOptionalSlotString(reservation, "teacherName");
          const studentName = getOptionalStudentName({
            student,
            membership,
            reservation,
          });
          createPrivateSlotNotification(transaction, db, {
            academyId,
            type: "private_slot_cancelled",
            studentId,
            studentName,
            teacher,
            teacherName,
            slotId,
            reservationId,
            date,
            time,
            source: "student",
            createdAt: now,
          });

          return {
            ok: true,
            academyId,
            slotId,
            studentId,
            reservationId,
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.markPrivateReservationOutcome = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const reservationId = requireString(data, "reservationId");
        const outcome = requireString(data, "outcome");
        validateAcademyId(academyId);
        if (!["completed", "no_show"].includes(outcome)) {
          throw new HttpsError("invalid-argument", "Invalid outcome.");
        }

        const db = admin.firestore();
        const uid = request.auth.uid;
        await requireAcademyAdmin(db, academyId, uid);

        const reservationRef = db
            .collection("privateLessonReservations")
            .doc(reservationId);

        return await db.runTransaction(async (transaction) => {
          const reservationSnap = await transaction.get(reservationRef);
          if (!reservationSnap.exists) {
            throw new HttpsError(
                "not-found",
                "Private reservation not found.",
            );
          }

          const reservation = reservationSnap.data() || {};
          if (normalizeId(reservation.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private reservation academy mismatch.",
            );
          }
          if (!isActivePrivateReservation(reservation)) {
            throw new HttpsError(
                "failed-precondition",
                "Only active private reservations can be completed.",
            );
          }
          if (reservation.deductionApplied === true) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation deduction was already applied.",
            );
          }

          const studentId = normalizeId(reservation.studentId);
          const slotId = normalizeId(reservation.slotId);
          if (!studentId || !slotId) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation is missing student or slot linkage.",
            );
          }

          const slotRef = db.collection("privateLessonSlots").doc(slotId);
          const studentRef = db.collection("privateStudents").doc(studentId);
          const [slotSnap, studentSnap] = await Promise.all([
            transaction.get(slotRef),
            transaction.get(studentRef),
          ]);
          const slot = slotSnap.exists ? slotSnap.data() || {} : null;
          const student = studentSnap.exists ? studentSnap.data() || {} : null;
          if (slot && normalizeId(slot.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private lesson slot academy mismatch.",
            );
          }
          if (student && normalizeId(student.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Student academy mismatch.",
            );
          }

          const explicitPackageId = normalizeId(reservation.packageId);
          let packageRef = null;
          let packageData = null;
          if (explicitPackageId) {
            const explicitPackageRef = db
                .collection("studentPackages")
                .doc(explicitPackageId);
            const explicitPackageSnap =
              await transaction.get(explicitPackageRef);
            if (!explicitPackageSnap.exists) {
              throw new HttpsError(
                  "failed-precondition",
                  "Linked private package not found.",
              );
            }
            const explicitPackage = explicitPackageSnap.data() || {};
            if (!isPrivatePackageForReservation(
                explicitPackage,
                reservation,
                slot,
            )) {
              throw new HttpsError(
                  "failed-precondition",
                  "Linked private package does not match reservation.",
              );
            }
            packageRef = explicitPackageRef;
            packageData = explicitPackage;
          } else {
            const packageSnap = await transaction.get(
                db
                    .collection("studentPackages")
                    .where("academyId", "==", academyId)
                    .where("studentId", "==", studentId),
            );
            const candidates = packageSnap.docs
                .map((docSnap) => ({
                  ref: docSnap.ref,
                  data: docSnap.data() || {},
                }))
                .filter((candidate) =>
                  isPrivatePackageForReservation(
                      candidate.data,
                      reservation,
                      slot,
                  ) && Number(candidate.data.remainingCount || 0) > 0,
                )
                .sort(sortPrivatePackageCandidates);
            if (candidates.length === 0) {
              throw new HttpsError(
                  "failed-precondition",
                  "No remaining matching private package found.",
              );
            }
            packageRef = candidates[0].ref;
            packageData = candidates[0].data;
          }

          const remainingBefore = Number(packageData.remainingCount || 0);
          const usedBefore = Number(packageData.usedCount || 0);
          if (
            !Number.isFinite(remainingBefore) ||
            remainingBefore <= 0 ||
            !Number.isFinite(usedBefore)
          ) {
            throw new HttpsError(
                "failed-precondition",
                "No remaining matching private package found.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          const remainingAfter = Math.max(0, remainingBefore - 1);
          const usedAfter = usedBefore + 1;
          const nextPackageStatus = getNextStudentPackageStatus(
              packageData.status,
              remainingAfter,
          );
          const creditTransactionId =
            `privateReservationDeduction__${reservationId}`;
          const creditRef = db
              .collection("creditTransactions")
              .doc(creditTransactionId);
          const datePart = [
            normalizeId(reservation.date || (slot && slot.date)),
            normalizeId(reservation.time || (slot && slot.time)),
            normalizeId(reservation.subject || (slot && slot.subject)),
          ].filter(Boolean).join(" ");
          const teacher = getReservationTeacherKey(reservation, slot);
          const studentName =
            getOptionalStudentName({student, membership: null, reservation}) ||
            studentId;
          const actionType = outcome === "completed" ?
            "private_reservation_completed_deduct" :
            "private_reservation_no_show_deduct";

          transaction.update(packageRef, {
            usedCount: usedAfter,
            remainingCount: remainingAfter,
            status: nextPackageStatus,
            updatedAt: now,
          });
          transaction.update(reservationRef, {
            status: outcome,
            completedAt: outcome === "completed" ? now : null,
            noShowAt: outcome === "no_show" ? now : null,
            deductionApplied: true,
            deductionAppliedAt: now,
            deductionPackageId: packageRef.id,
            deductionCreditTransactionId: creditTransactionId,
            outcomeByUid: uid,
            updatedAt: now,
          });
          transaction.set(creditRef, {
            academyId,
            studentId,
            studentName,
            teacher,
            packageId: packageRef.id,
            packageType: "private",
            packageTitle: String(packageData.packageTitle || ""),
            groupClassName: "",
            sourceType: "privateReservation",
            sourceId: reservationId,
            actionType,
            deltaCount: -1,
            memo: datePart ?
              `유연 1:1 예약 ${datePart}` :
              "유연 1:1 예약 차감",
            actorUid: uid,
            actorRole: "admin",
            createdAt: now,
          }, {merge: false});

          return {
            ok: true,
            academyId,
            reservationId,
            outcome,
            packageId: packageRef.id,
            creditTransactionId,
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.bootstrapAdmin = onCall(
    {region: REGION, cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login required.");
      }

      const callerUid = request.auth.uid;
      const callerEmail = request.auth.token.email || "";

      if (callerEmail !== OWNER_EMAIL) {
        throw new HttpsError("permission-denied", "Not allowed.");
      }

      await admin.auth().setCustomUserClaims(callerUid, {
        role: "admin",
      });

      await admin.firestore().collection("users").doc(callerUid).set(
          {
            email: callerEmail,
            role: "admin",
            isActive: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
      );

      return {
        success: true,
        message: "You are now admin. Please refresh your token.",
      };
    },
);

exports.setUserRole = onCall(
    {region: REGION, cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login required.");
      }

      const callerUid = request.auth.uid;
      const caller = await admin.auth().getUser(callerUid);
      const callerRole = caller.customClaims ? caller.customClaims.role : null;
      if (callerRole !== "admin") {
        throw new HttpsError("permission-denied", "Admins only.");
      }

      const {uid, role, academyId, teacherName, isActive} = request.data || {};

      if (!uid || !role) {
        throw new HttpsError("invalid-argument", "uid and role are required.");
      }

      if (!["admin", "teacher"].includes(role)) {
        throw new HttpsError(
            "invalid-argument",
            "role must be admin or teacher.",
        );
      }

      await admin.auth().setCustomUserClaims(uid, {role});

      await admin.firestore().collection("users").doc(uid).set(
          {
            role,
            academyId: academyId || null,
            teacherName: teacherName || null,
            isActive: isActive !== false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
      );

      return {
        success: true,
        message: `Role ${role} set for ${uid}`,
      };
    },
);

exports.linkStudentAccount = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const studentId = requireString(data, "studentId");
        const email = normalizeEmail(requireString(data, "email"));
        const displayName = optionalString(data, "displayName");

        validateAcademyId(academyId);

        const auth = admin.auth();
        const db = admin.firestore();
        const actorUid = request.auth.uid;
        await requireAcademyAdmin(db, academyId, actorUid);

        const academySnap = await db
            .collection("academies")
            .doc(academyId)
            .get();
        if (!academySnap.exists) {
          throw new HttpsError("invalid-argument", "Academy not found.");
        }

        const studentSnap = await db
            .collection("privateStudents")
            .doc(studentId)
            .get();
        if (!studentSnap.exists) {
          throw new HttpsError("invalid-argument", "Student not found.");
        }

        const studentData = studentSnap.data() || {};
        if (normalizeId(studentData.academyId) !== academyId) {
          throw new HttpsError(
              "invalid-argument",
              "Student does not belong to academy.",
          );
        }

        const existingAuthUser = await getAuthUserByEmail(auth, email);
        const temporaryPassword = validateTemporaryPassword(
            optionalString(data, "temporaryPassword"),
        );
        const resolvedDisplayName =
          displayName || String(studentData.name || "").trim() || email;
        const existingUid = existingAuthUser ? existingAuthUser.uid : "";
        const existingMembershipId = existingUid ?
          `${academyId}_${existingUid}` :
          "";

        const [userSnap, sameMembershipSnap, linkedStudentMembershipSnap] =
          await Promise.all([
            existingUid ?
              db.collection("users").doc(existingUid).get() :
              Promise.resolve(null),
            existingMembershipId ?
              db
                  .collection("academyMemberships")
                  .doc(existingMembershipId)
                  .get() :
              Promise.resolve(null),
            db
                .collection("academyMemberships")
                .where("academyId", "==", academyId)
                .where("studentId", "==", studentId)
                .get(),
          ]);

        const safety = assertSafeStudentAccountLink({
          uid: existingUid || "__new_auth_user__",
          targetStudentId: studentId,
          authCustomClaims: existingAuthUser ?
            existingAuthUser.customClaims || null :
            null,
          userProfile: userSnap && userSnap.exists ?
            userSnap.data() || {} :
            null,
          sameAcademyMembership:
            sameMembershipSnap && sameMembershipSnap.exists ?
              sameMembershipSnap.data() || {} :
              null,
          matchingStudentMemberships: linkedStudentMembershipSnap.docs.map(
              (docSnap) => ({
                id: docSnap.id,
                data: docSnap.data() || {},
              }),
          ),
        });

        const authPayload = {
          email,
          displayName: resolvedDisplayName,
          disabled: false,
        };
        if (temporaryPassword) authPayload.password = temporaryPassword;

        const userRecord = existingAuthUser ?
          await auth.updateUser(existingAuthUser.uid, authPayload) :
          await auth.createUser(authPayload);
        const action = existingAuthUser ? "updated" : "created";
        const uid = userRecord.uid;
        const membershipId = `${academyId}_${uid}`;
        const existingCustomClaims = existingAuthUser ?
          existingAuthUser.customClaims || {} :
          {};

        await auth.setCustomUserClaims(uid, {
          ...existingCustomClaims,
          role: "student",
        });

        await setMergeWithTimestamps(db.collection("users").doc(uid), {
          uid,
          email,
          displayName: resolvedDisplayName,
          accountScope: "global",
          role: "student",
          isActive: true,
          teacherName: "",
          lastSelectedAcademyId: academyId,
        });

        await setMergeWithTimestamps(
            db.collection("academyMemberships").doc(membershipId),
            {
              academyId,
              uid,
              email,
              displayName: resolvedDisplayName,
              role: "student",
              studentId,
              teacherName: "",
              status: "active",
              permissions: STUDENT_ACCOUNT_PERMISSIONS,
            },
        );

        await createStudentAccessSummaryDocsIfMissing(db, {
          academyId,
          studentId,
        });

        const passwordResetLink = await auth.generatePasswordResetLink(
            email,
            STUDENT_PASSWORD_SETUP_ACTION_SETTINGS,
        );

        await db.collection("accountProvisioningLogs").add({
          academyId,
          actorUid,
          uid,
          studentId,
          email,
          membershipId,
          action,
          result: "success",
          alreadyLinked: safety.alreadyLinked,
          passwordSet: Boolean(temporaryPassword),
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          ok: true,
          action,
          alreadyLinked: safety.alreadyLinked,
          uid,
          email,
          academyId,
          studentId,
          membershipId,
          passwordSet: Boolean(temporaryPassword),
          passwordResetLink,
        };
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.linkTeacherAccount = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const teacherId = optionalString(data, "teacherId");
        const requestedTeacherKey = normalizeTeacherKey(
            optionalString(data, "teacherKey"),
        );
        const email = normalizeEmail(requireString(data, "email"));
        const displayName = optionalString(data, "displayName");

        validateAcademyId(academyId);
        if (!teacherId && !requestedTeacherKey) {
          throw new HttpsError(
              "invalid-argument",
              "teacherId or teacherKey is required.",
          );
        }

        const auth = admin.auth();
        const db = admin.firestore();
        const actorUid = request.auth.uid;
        await requireAcademyAdmin(db, academyId, actorUid);

        const teacherSnap = teacherId ?
          await db.collection("teachers").doc(teacherId).get() :
          null;
        let resolvedTeacherSnap = teacherSnap;
        if (!resolvedTeacherSnap || !resolvedTeacherSnap.exists) {
          let teacherQuerySnap = await db
              .collection("teachers")
              .where("academyId", "==", academyId)
              .where("teacherKey", "==", requestedTeacherKey)
              .limit(1)
              .get();
          if (teacherQuerySnap.empty) {
            teacherQuerySnap = await db
                .collection("teachers")
                .where("academyId", "==", academyId)
                .where("teacherName", "==", requestedTeacherKey)
                .limit(1)
                .get();
          }
          resolvedTeacherSnap = teacherQuerySnap.empty ?
            null :
            teacherQuerySnap.docs[0];
        }
        if (!resolvedTeacherSnap || !resolvedTeacherSnap.exists) {
          throw new HttpsError("invalid-argument", "Teacher not found.");
        }

        const teacherData = resolvedTeacherSnap.data() || {};
        if (normalizeId(teacherData.academyId) !== academyId) {
          throw new HttpsError(
              "invalid-argument",
              "Teacher does not belong to academy.",
          );
        }
        if (String(teacherData.status || "active").trim() !== "active") {
          throw new HttpsError(
              "failed-precondition",
              "Teacher is not active.",
          );
        }

        const teacherKey = normalizeTeacherKey(
            teacherData.teacherKey ||
            teacherData.teacherName ||
            requestedTeacherKey,
        );
        if (!teacherKey) {
          throw new HttpsError(
              "invalid-argument",
              "Teacher key is required.",
          );
        }
        if (requestedTeacherKey && requestedTeacherKey !== teacherKey) {
          throw new HttpsError(
              "invalid-argument",
              "Teacher key does not match teacher document.",
          );
        }

        const existingAuthUser = await getAuthUserByEmail(auth, email);
        const existingUid = existingAuthUser ? existingAuthUser.uid : "";
        const membershipId = existingUid ? `${academyId}_${existingUid}` : "";

        const [userSnap, sameMembershipSnap, allMembershipSnap] =
          await Promise.all([
            existingUid ?
              db.collection("users").doc(existingUid).get() :
              Promise.resolve(null),
            membershipId ?
              db.collection("academyMemberships").doc(membershipId).get() :
              Promise.resolve(null),
            existingUid ?
              db
                  .collection("academyMemberships")
                  .where("uid", "==", existingUid)
                  .get() :
              Promise.resolve(null),
          ]);

        const safety = assertSafeTeacherAccountLink({
          targetTeacherKey: teacherKey,
          authCustomClaims: existingAuthUser ?
            existingAuthUser.customClaims || null :
            null,
          userProfile: userSnap && userSnap.exists ?
            userSnap.data() || {} :
            null,
          sameAcademyMembership:
            sameMembershipSnap && sameMembershipSnap.exists ?
              sameMembershipSnap.data() || {} :
              null,
        });

        if (allMembershipSnap && !allMembershipSnap.empty) {
          for (const docSnap of allMembershipSnap.docs) {
            if (docSnap.id === membershipId) continue;
            const membership = docSnap.data() || {};
            const role = String(membership.role || "").trim().toLowerCase();
            if (
              role === "owner" ||
              role === "admin" ||
              role === "student" ||
              role === "staff"
            ) {
              throw new HttpsError(
                  "failed-precondition",
                  `Refusing to link: existing academy membership role is ` +
                  `${role}`,
              );
            }
          }
        }

        const resolvedDisplayName =
          displayName || String(teacherData.name || "").trim() || email;
        const authPayload = {
          email,
          displayName: resolvedDisplayName,
          disabled: false,
        };
        const userRecord = existingAuthUser ?
          await auth.updateUser(existingAuthUser.uid, authPayload) :
          await auth.createUser(authPayload);
        const action = existingAuthUser ? "updated" : "created";
        const uid = userRecord.uid;
        const resolvedMembershipId = `${academyId}_${uid}`;
        const existingCustomClaims = existingAuthUser ?
          existingAuthUser.customClaims || {} :
          {};

        await auth.setCustomUserClaims(uid, {
          ...existingCustomClaims,
          role: "teacher",
        });

        await setMergeWithTimestamps(db.collection("users").doc(uid), {
          uid,
          email,
          displayName: resolvedDisplayName,
          accountScope: "global",
          role: "teacher",
          isActive: true,
          teacherName: teacherKey,
          lastSelectedAcademyId: academyId,
        });

        await setMergeWithTimestamps(
            db.collection("academyMemberships").doc(resolvedMembershipId),
            {
              academyId,
              uid,
              email,
              displayName: resolvedDisplayName,
              role: "teacher",
              status: "active",
              teacherName: teacherKey,
              permissions: TEACHER_ACCOUNT_PERMISSIONS,
            },
        );

        const passwordResetLink = await auth.generatePasswordResetLink(
            email,
            TEACHER_PASSWORD_SETUP_ACTION_SETTINGS,
        );

        await db.collection("accountProvisioningLogs").add({
          academyId,
          actorUid,
          uid,
          email,
          teacherKey,
          teacherId: resolvedTeacherSnap.id,
          membershipId: resolvedMembershipId,
          action,
          result: "success",
          alreadyLinked: safety.alreadyLinked,
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          ok: true,
          action,
          alreadyLinked: safety.alreadyLinked,
          uid,
          email,
          academyId,
          teacherKey,
          teacherId: resolvedTeacherSnap.id,
          membershipId: resolvedMembershipId,
          passwordResetLink,
        };
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);
