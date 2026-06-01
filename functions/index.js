/* eslint-disable require-jsdoc */
const {setGlobalOptions} = require("firebase-functions/v2");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
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
const STUDENT_PRIVATE_CANCEL_LIMIT = 2;
const STUDENT_PRIVATE_CANCEL_LIMIT_MAX = 24;
const STUDENT_PRIVATE_CANCEL_CUTOFF_MS = 6 * 60 * 60 * 1000;
const PRIVATE_SLOT_BOOKING_CUTOFF_MS = 7 * 60 * 60 * 1000;
const PRIVATE_SLOT_AVAILABILITY_LIMIT = 100;
const PRIVATE_SLOT_QUERY_CHUNK_SIZE = 10;
const PRIVATE_TEMPLATE_SLOT_PREFIX = "template";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
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

function isPrivateSlotBookingE2eOverride(data) {
  return (
    getRuntimeProjectId() === "miami-e2e" &&
    isEnabledFlag(data && data.privateSlotBooking)
  );
}

function isPrivateSlotReservationEnabled(data) {
  if (isPrivateSlotBookingE2eOverride(data)) return true;
  return isEnabledFlag(process.env.PRIVATE_SLOT_BOOKING_ENABLED);
}

function isPrivateSlotAvailabilityBookingEnabled(data) {
  return isPrivateSlotReservationEnabled(data);
}

function requirePrivateSlotReservationEnabled(data) {
  if (isPrivateSlotReservationEnabled(data)) return;
  throw new HttpsError(
      "failed-precondition",
      PRIVATE_SLOT_BOOKING_NOT_READY_MESSAGE,
  );
}

function requirePrivateSlotBookingPilotEnabled(summary) {
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
      groupCourseTypes: [],
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

function readNonNegativeInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) {
    return 0;
  }
  return Math.floor(n);
}

function readStudentCancelLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return STUDENT_PRIVATE_CANCEL_LIMIT;
  }
  return Math.min(STUDENT_PRIVATE_CANCEL_LIMIT_MAX, Math.floor(n));
}

function resolveStudentPrivateCancelAllowance(stats) {
  const data = stats || {};
  const studentCancelCount = readNonNegativeInteger(data.studentCancelCount);
  const studentCancelLimit = readStudentCancelLimit(data.studentCancelLimit);
  return {
    studentCancelCount,
    studentCancelLimit,
    remainingCancelCount: Math.max(0, studentCancelLimit - studentCancelCount),
  };
}

function parseStudentCancelLimitInput(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new HttpsError(
        "invalid-argument",
        "studentCancelLimit must be an integer.",
    );
  }
  if (n < 0 || n > STUDENT_PRIVATE_CANCEL_LIMIT_MAX) {
    throw new HttpsError(
        "invalid-argument",
        `studentCancelLimit must be between 0 and ` +
        `${STUDENT_PRIVATE_CANCEL_LIMIT_MAX}.`,
    );
  }
  return n;
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
  return {
    ...membership,
    role,
  };
}

async function canMarkPrivateReservationOutcome(db, academyId, uid) {
  await requireAcademyAdmin(db, academyId, uid);
  return {actorRole: "admin"};
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

function requireActiveAcademyMembership(membershipSnap) {
  const membership = membershipSnap.exists ? membershipSnap.data() || {} : null;
  const role = String((membership && membership.role) || "")
      .trim()
      .toLowerCase();
  const status = String((membership && membership.status) || "")
      .trim()
      .toLowerCase();

  if (!membership || status !== "active" || !role) {
    throw new HttpsError(
        "permission-denied",
        "Active academy membership required.",
    );
  }
  return {
    ...membership,
    role,
    studentId: normalizeId(membership.studentId),
  };
}

function canManageGroupReservations(membership) {
  const role = String((membership && membership.role) || "").toLowerCase();
  return role === "owner" || role === "admin" || role === "teacher";
}

function canManageGroupAttendance(membership) {
  const role = String((membership && membership.role) || "").toLowerCase();
  return (
    role === "owner" ||
    role === "admin" ||
    Boolean(
        membership &&
        membership.permissions &&
        membership.permissions.canManageAttendance === true,
    )
  );
}

function requireTeacherPackageCountEditor(membershipSnap) {
  const membership = requireActiveAcademyMembership(membershipSnap);
  if (
    membership.role !== "teacher" ||
    !membership.permissions ||
    membership.permissions.canEditStudentPackageCounts !== true
  ) {
    throw new HttpsError(
        "permission-denied",
        "Teacher package count edit permission required.",
    );
  }
  const teacherName = normalizeId(membership.teacherName);
  if (!teacherName) {
    throw new HttpsError(
        "failed-precondition",
        "Teacher membership is missing teacherName.",
    );
  }
  return {...membership, teacherName};
}

function parsePackageTotalCount(value) {
  const totalCount = Number(value);
  if (!Number.isInteger(totalCount) || totalCount < 1) {
    throw new HttpsError(
        "invalid-argument",
        "totalCount must be an integer greater than zero.",
    );
  }
  return totalCount;
}

function groupLessonReservationDocId({academyId, lessonId, studentId}) {
  return `${academyId}__${lessonId}__${studentId}`;
}

function getGroupLessonGroupId(data) {
  return normalizeId(
      data && (data.groupClassId || data.groupClassID || data.classID),
  );
}

function isCancelledOrDeletedGroupLesson(data) {
  const status = normalizeId(data && data.status).toLowerCase();
  return (
    status === "cancelled" ||
    status === "canceled" ||
    Boolean(data && data.groupClassDeleted === true)
  );
}

function isActiveGroupClass(data) {
  const status = normalizeId(data && data.status).toLowerCase() || "active";
  return (
    data &&
    data.deleted !== true &&
    data.groupClassDeleted !== true &&
    status !== "deleted" &&
    status !== "cancelled" &&
    status !== "canceled" &&
    status !== "closed" &&
    status !== "inactive"
  );
}

function getGroupStudentGroupId(data) {
  return normalizeId(data && (data.groupClassId || data.classID));
}

function getDateValueYmd(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (typeof value.toDate === "function") {
    const date = value.toDate();
    return date ? date.toISOString().slice(0, 10) : "";
  }
  if (value.seconds !== undefined) {
    return new Date(Number(value.seconds) * 1000).toISOString().slice(0, 10);
  }
  return "";
}

function isActiveGroupStudentForLesson(groupStudent, lesson) {
  const status = String(groupStudent.status || "active").trim().toLowerCase();
  if (status !== "active") return false;
  if (getGroupStudentGroupId(groupStudent) !== getGroupLessonGroupId(lesson)) {
    return false;
  }

  const lessonDate = normalizeId(lesson.date);
  const startDate = getDateValueYmd(groupStudent.startDate);
  if (startDate && lessonDate && startDate > lessonDate) return false;

  const studentStatus = String(groupStudent.studentStatus || "")
      .trim()
      .toLowerCase();
  if (studentStatus === "onbreak") {
    const breakStart = getDateValueYmd(groupStudent.breakStartDate);
    const breakEnd = getDateValueYmd(groupStudent.breakEndDate);
    if (breakStart && breakEnd && lessonDate >= breakStart &&
        lessonDate <= breakEnd) {
      return false;
    }
  }

  const excludedDates = normalizeIdList(groupStudent.excludedDates);
  return !(lessonDate && excludedDates.includes(lessonDate));
}

function getFixedMembersForLesson(groupStudents, lesson) {
  return groupStudents.filter((groupStudent) =>
    isActiveGroupStudentForLesson(groupStudent, lesson),
  );
}

function getGroupSeatAvailability({lesson, fixedMembers, reservations}) {
  const capacity = Math.max(0, Math.floor(Number(lesson.capacity || 0)));
  const fixedMemberIds = normalizeIdList(
      fixedMembers.map((member) => member.studentId),
  );
  const fixedMemberIdSet = new Set(fixedMemberIds);
  const countedIdSet = new Set(normalizeIdList(lesson.countedStudentIDs));
  const releasedIds = normalizeIdList(lesson.releasedFixedStudentIDs);
  const releasedIdSet = new Set(releasedIds);
  const attendanceApplied = Boolean(lesson.attendanceAppliedAt);
  const releasedFixedSeatIds = new Set();

  fixedMemberIds.forEach((studentId) => {
    if (releasedIdSet.has(studentId)) {
      releasedFixedSeatIds.add(studentId);
      return;
    }
    if (attendanceApplied && !countedIdSet.has(studentId)) {
      releasedFixedSeatIds.add(studentId);
    }
  });

  const guestReservedStudentIds = new Set();
  reservations.forEach((reservation) => {
    if (String(reservation.status || "") !== "active") return;
    const studentId = normalizeId(reservation.studentId);
    if (!studentId || fixedMemberIdSet.has(studentId)) return;
    guestReservedStudentIds.add(studentId);
  });

  const fixedMemberCount = fixedMemberIds.length;
  const releasedFixedSeatCount = releasedFixedSeatIds.size;
  const fixedAttendingCount =
    Math.max(0, fixedMemberCount - releasedFixedSeatCount);
  const guestReservedCount = guestReservedStudentIds.size;
  const lessonBookedCount = Math.max(
      0,
      Math.floor(Number(lesson && lesson.bookedCount || 0)),
  );
  const effectiveGuestReservedCount = Math.max(
      guestReservedCount,
      Number.isFinite(lessonBookedCount) ? lessonBookedCount : 0,
  );
  const remainingSeats =
    Math.max(0, capacity - fixedAttendingCount - effectiveGuestReservedCount);

  return {
    capacity,
    fixedMemberCount,
    fixedAttendingCount,
    releasedFixedSeatCount,
    guestReservedCount: effectiveGuestReservedCount,
    remainingSeats,
    isFull: remainingSeats <= 0,
  };
}

function getLessonGroupClassIds(lesson) {
  const ids = normalizeIdList(lesson && lesson.groupClassIds);
  const primary = getGroupLessonGroupId(lesson);
  if (primary && !ids.includes(primary)) {
    ids.unshift(primary);
  }
  return ids;
}

function getEffectiveLessonCourseTypes(lesson, groupClassById) {
  const types = new Set();
  const fromLesson = normalizeId(lesson && lesson.groupCourseType);
  if (fromLesson) types.add(fromLesson);

  getLessonGroupClassIds(lesson).forEach((classId) => {
    const groupClass = groupClassById && groupClassById.get(classId);
    const fromClass = normalizeId(groupClass && groupClass.groupCourseType);
    if (fromClass) types.add(fromClass);
  });

  return Array.from(types.values());
}

function hasGroupLessonAccess({summary, lesson, groupClassById = null}) {
  const accessClassIds = normalizeIdList(summary && summary.groupClassIds);
  const accessCourseTypes = normalizeIdList(
      summary && summary.groupCourseTypes,
  );

  if (getLessonGroupClassIds(lesson).some((classId) =>
    accessClassIds.includes(classId),
  )) {
    return true;
  }

  return getEffectiveLessonCourseTypes(lesson, groupClassById)
      .some((courseType) => accessCourseTypes.includes(courseType));
}

function sanitizeGroupLessonForStudent(docSnap, availability, ticketInfo = {}) {
  const lesson = docSnap.data() || {};
  return {
    id: docSnap.id,
    academyId: normalizeId(lesson.academyId),
    groupClassId: getGroupLessonGroupId(lesson),
    groupClassName: normalizeId(lesson.groupClassName),
    groupCourseType: normalizeId(lesson.groupCourseType),
    teacher: normalizeId(lesson.teacher || lesson.teacherName),
    date: normalizeId(lesson.date),
    time: normalizeId(lesson.time),
    subject: normalizeId(lesson.subject),
    capacity: availability.capacity,
    bookedCount: availability.guestReservedCount,
    isBookable: lesson.isBookable === true,
    remainingSeats: availability.remainingSeats,
    isFull: availability.isFull,
    groupTicketStatus: ticketInfo.status || "",
    groupTicketStatusLabel: ticketInfo.statusLabel || "",
    groupTicketAvailableToBook: Number(ticketInfo.availableToBook || 0),
    groupTicketId: ticketInfo.ticketId || "",
  };
}

async function getGroupSeatInputSnaps(transaction, db, academyId) {
  const [groupStudentsSnap, reservationsSnap, groupLessonsSnap] =
    await Promise.all([
      transaction.get(
          db.collection("groupStudents").where("academyId", "==", academyId),
      ),
      transaction.get(
          db
              .collection("groupLessonReservations")
              .where("academyId", "==", academyId),
      ),
      transaction.get(
          db.collection("groupLessons").where("academyId", "==", academyId),
      ),
    ]);
  return {groupStudentsSnap, reservationsSnap, groupLessonsSnap};
}

function docsForLesson(snap, lessonId) {
  return snap.docs
      .filter((docSnap) => normalizeId(docSnap.data().lessonId) === lessonId)
      .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}));
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

function uniqueNormalizedIdList(...values) {
  const ids = new Set();
  values.forEach((value) => {
    normalizeIdList(value).forEach((id) => ids.add(id));
  });
  return Array.from(ids.values());
}

function uniqueNormalizedTeacherKeyList(...values) {
  const keys = new Set();
  values.forEach((value) => {
    normalizeTeacherKeyList(value).forEach((key) => keys.add(key));
  });
  return Array.from(keys.values());
}

function chunkValues(values, size) {
  const chunks = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
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
  const slotTeacherKeys = getPrivateTeacherScopeKeys(slot);
  const hasTeacherPackageAccess =
    activePackageIds.length > 0 &&
    slotTeacherKeys.some((teacherKey) => teacherKeys.includes(teacherKey));

  return eligibleStudentIds.includes(studentId) ||
    allowedSlotIds.includes(slotId) ||
    allowedPrivateLessonSlotIds.includes(slotId) ||
    (eligibleStudentIds.length === 0 && hasTeacherPackageAccess);
}

function hasExplicitSlotEligibility(slot) {
  return normalizeIdList(slot && slot.eligibleStudentIds).length > 0;
}

const ACTIVE_PRIVATE_RESERVATION_STATUSES = [
  "active",
  "reserved",
  "confirmed",
  "booked",
];

function isActivePrivateReservation(data) {
  return ACTIVE_PRIVATE_RESERVATION_STATUSES.includes(
      String((data && data.status) || "").trim().toLowerCase(),
  );
}

function getNextStudentPackageStatus(currentStatus, remainingCount) {
  const status = String(currentStatus || "").trim().toLowerCase();
  if (status === "ended" || status === "cancelled" || status === "canceled") {
    return status;
  }
  const rem = Number(remainingCount || 0);
  if (!Number.isFinite(rem) || rem <= 0) return "exhausted";
  return "active";
}

function buildDeductionKey({academyId, lessonId, studentId, packageId}) {
  return [
    "deduct",
    normalizeId(academyId),
    normalizeId(lessonId),
    normalizeId(studentId),
    normalizeId(packageId),
  ].join("_");
}

function createDeductionSummary() {
  return {
    checked: 0,
    deducted: 0,
    skippedAlreadyDeducted: 0,
    skippedNoDeduction: 0,
    skippedCancelled: 0,
    skippedNoPackage: 0,
    skippedNoRemaining: 0,
    skippedUnsupportedFixedPrivate: 0,
    errors: 0,
  };
}

function addDeductionSummary(target, source) {
  Object.keys(createDeductionSummary()).forEach((key) => {
    target[key] = Number(target[key] || 0) + Number(source[key] || 0);
  });
  return target;
}

function getKstDateString(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function offsetYmd(ymd, offsetDays) {
  const [year, month, day] = String(ymd || "").split("-").map(Number);
  if (!year || !month || !day) return "";
  const millis = Date.UTC(year, month - 1, day) + offsetDays * DAY_MS;
  return new Date(millis).toISOString().slice(0, 10);
}

function getAutoDeductionDateRange({
  todayYmd = getKstDateString(),
  lookbackDays = 3,
} = {}) {
  const safeLookback = Math.min(
      7,
      Math.max(1, Math.floor(Number(lookbackDays) || 3)),
  );
  const dates = [];
  for (let offset = safeLookback; offset >= 1; offset -= 1) {
    dates.push(offsetYmd(todayYmd, -offset));
  }
  return dates.filter(Boolean);
}

function isPackageActiveForDeduction(pkg) {
  const status = normalizeId(pkg && (pkg.status || "active")).toLowerCase();
  return ![
    "inactive",
    "expired",
    "ended",
    "cancelled",
    "canceled",
  ].includes(status);
}

function getDeductionSkipReasonForLesson(lesson) {
  const status = normalizeId(lesson && lesson.status).toLowerCase();
  const cancellationType = normalizeId(
      lesson && lesson.cancellationType,
  ).toLowerCase();
  const cancelledReason = normalizeId(
      lesson && lesson.cancelledReason,
  ).toLowerCase();
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (lesson && lesson.groupClassDeleted === true) return "cancelled";
  if (lesson && lesson.noDeduction === true) return "noDeduction";
  if (cancellationType === "class_closure") return "noDeduction";
  if (cancellationType === "no_deduction") return "noDeduction";
  if ([
    "holiday",
    "teacher_unavailable",
    "academy_closed",
    "group_class_closed",
    "group_class_deleted",
  ].includes(cancelledReason)) {
    return "noDeduction";
  }
  return "";
}

function getPrivateReservationSkipReason(reservation) {
  const status = normalizeId(reservation && reservation.status).toLowerCase();
  const cancellationType = normalizeId(
      reservation && reservation.cancellationType,
  ).toLowerCase();
  const cancelledReason = normalizeId(
      reservation && reservation.cancelledReason,
  ).toLowerCase();
  if (status === "cancelled" || status === "canceled") return "cancelled";
  if (reservation && reservation.noDeduction === true) return "noDeduction";
  if (cancellationType === "no_deduction") return "noDeduction";
  if ([
    "holiday",
    "teacher_unavailable",
    "academy_closed",
  ].includes(cancelledReason)) {
    return "noDeduction";
  }
  return "";
}

function incrementDeductionSkip(summary, reason) {
  if (reason === "cancelled") summary.skippedCancelled += 1;
  else if (reason === "noDeduction") summary.skippedNoDeduction += 1;
  else if (reason === "noRemaining") summary.skippedNoRemaining += 1;
  else if (reason === "alreadyDeducted") {
    summary.skippedAlreadyDeducted += 1;
  } else if (reason === "unsupportedFixedPrivate") {
    summary.skippedUnsupportedFixedPrivate += 1;
  } else {
    summary.skippedNoPackage += 1;
  }
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
  return getPrivateTeacherScopeKeys(reservation, slot)[0] || "";
}

function getReservationTeacherKeys(reservation, slot) {
  return getPrivateTeacherScopeKeys(reservation, slot);
}

function getPrivateTeacherScopeKeys(...rows) {
  const stableUidKeys = [];
  const stableTeacherKeys = [];
  const displayKeys = [];
  rows.forEach((row) => {
    if (!row) return;
    [
      row.teacherUid,
      row.teacherUID,
      row.teacherId,
      row.teacherID,
    ].forEach((value) => {
      const key = normalizeTeacherKey(value);
      if (key) stableUidKeys.push(key);
    });
    [row.teacherKey].forEach((value) => {
      const key = normalizeTeacherKey(value);
      if (key) stableTeacherKeys.push(key);
    });
    [
      row.teacher,
      row.teacherName,
      row.displayName,
      row.name,
    ].forEach((value) => {
      const key = normalizeTeacherKey(value);
      if (key) displayKeys.push(key);
    });
  });
  return uniqueNormalizedTeacherKeyList([
    ...stableUidKeys,
    ...stableTeacherKeys,
    ...displayKeys,
  ]);
}

function getPrivatePackageTeacherKey(pkg) {
  return getPrivateTeacherScopeKeys(pkg)[0] || "";
}

function getPrivatePackageTeacherKeys(pkg) {
  return getPrivateTeacherScopeKeys(pkg);
}

function getPrivatePackageRejectReason({
  pkg,
  academyId,
  studentId,
  teacherKey,
  teacherKeys = [],
}) {
  if (!pkg) return "package_missing";
  if (normalizeId(pkg.academyId) !== academyId) return "academy_mismatch";
  if (normalizeId(pkg.studentId) !== studentId) return "student_mismatch";

  const packageType = normalizeId(pkg.packageType).toLowerCase();
  if (packageType && packageType !== "private") {
    return "package_type_mismatch";
  }

  const status = normalizeId(pkg.status || "active").toLowerCase();
  if (
    ["inactive", "expired", "ended", "cancelled", "canceled"]
        .includes(status)
  ) {
    return "package_not_active";
  }

  const remainingCount = Number(pkg.remainingCount || 0);
  if (!Number.isFinite(remainingCount) || remainingCount <= 0) {
    return "no_remaining_count";
  }

  const packageTeacherKeys = getPrivatePackageTeacherKeys(pkg);
  const requestedTeacherKeys = uniqueNormalizedTeacherKeyList([
    teacherKey,
    ...teacherKeys,
  ]);
  if (requestedTeacherKeys.length === 0) return "missing_slot_teacher";
  if (packageTeacherKeys.length === 0) return "missing_package_teacher";
  if (!requestedTeacherKeys.some((key) => packageTeacherKeys.includes(key))) {
    return "teacher_mismatch";
  }
  return null;
}

function isPrivatePackageForReservation(pkg, reservation, slot) {
  return !getPrivatePackageRejectReason({
    pkg,
    academyId: normalizeId(reservation && reservation.academyId),
    studentId: normalizeId(reservation && reservation.studentId),
    teacherKey: getReservationTeacherKey(reservation, slot),
    teacherKeys: getReservationTeacherKeys(reservation, slot),
  });
}

function sortPrivatePackageCandidates(a, b) {
  const aRemaining = Number(a.data.remainingCount || 0);
  const bRemaining = Number(b.data.remainingCount || 0);
  if (aRemaining !== bRemaining) return aRemaining - bRemaining;
  const aCreated = getTimestampMillis(a.data.createdAt) || 0;
  const bCreated = getTimestampMillis(b.data.createdAt) || 0;
  return aCreated - bCreated;
}

async function findActivePrivatePackageForTeacher({
  transaction,
  db,
  academyId,
  studentId,
  teacherKey,
  teacherKeys = [],
  candidatePackageIds = [],
}) {
  const normalizedAcademyId = normalizeId(academyId);
  const normalizedStudentId = normalizeId(studentId);
  const normalizedTeacherKey = normalizeTeacherKey(teacherKey);
  const normalizedTeacherKeys = uniqueNormalizedTeacherKeyList([
    normalizedTeacherKey,
    ...teacherKeys,
  ]);
  const checkedPackages = [];
  const uniqueCandidateIds = [];
  normalizeIdList(candidatePackageIds).forEach((packageId) => {
    if (!uniqueCandidateIds.includes(packageId)) {
      uniqueCandidateIds.push(packageId);
    }
  });

  for (const packageId of uniqueCandidateIds) {
    const packageRef = db.collection("studentPackages").doc(packageId);
    const packageSnap = await transaction.get(packageRef);
    if (!packageSnap.exists) {
      checkedPackages.push({packageId, rejectReason: "package_missing"});
      continue;
    }
    const packageData = packageSnap.data() || {};
    const rejectReason = getPrivatePackageRejectReason({
      pkg: packageData,
      academyId: normalizedAcademyId,
      studentId: normalizedStudentId,
      teacherKey: normalizedTeacherKey,
      teacherKeys: normalizedTeacherKeys,
    });
    checkedPackages.push({
      packageId,
      teacher: normalizeId(packageData.teacher),
      teacherName: normalizeId(packageData.teacherName),
      packageType: normalizeId(packageData.packageType),
      status: normalizeId(packageData.status),
      remainingCount: Number(packageData.remainingCount || 0),
      rejectReason,
    });
    if (!rejectReason) {
      return {
        ok: true,
        ref: packageRef,
        id: packageId,
        data: packageData,
        checkedPackages,
      };
    }
  }

  const packageSnap = await transaction.get(
      db
          .collection("studentPackages")
          .where("academyId", "==", normalizedAcademyId)
          .where("studentId", "==", normalizedStudentId),
  );
  const fallbackCandidates = packageSnap.docs
      .map((docSnap) => {
        const packageData = docSnap.data() || {};
        const rejectReason = getPrivatePackageRejectReason({
          pkg: packageData,
          academyId: normalizedAcademyId,
          studentId: normalizedStudentId,
          teacherKey: normalizedTeacherKey,
          teacherKeys: normalizedTeacherKeys,
        });
        checkedPackages.push({
          packageId: docSnap.id,
          teacher: normalizeId(packageData.teacher),
          teacherName: normalizeId(packageData.teacherName),
          packageType: normalizeId(packageData.packageType),
          status: normalizeId(packageData.status),
          remainingCount: Number(packageData.remainingCount || 0),
          rejectReason,
        });
        return {
          ref: docSnap.ref,
          id: docSnap.id,
          data: packageData,
          rejectReason,
        };
      })
      .filter((candidate) => !candidate.rejectReason)
      .sort(sortPrivatePackageCandidates);

  if (fallbackCandidates.length === 0) {
    return {
      ok: false,
      reason: "no_remaining_matching_package",
      checkedPackages,
    };
  }
  if (fallbackCandidates.length > 1) {
    return {ok: false, reason: "ambiguous_matching_packages", checkedPackages};
  }
  return {ok: true, ...fallbackCandidates[0], checkedPackages};
}

async function findUsablePrivatePackageForTeacher(args) {
  return findActivePrivatePackageForTeacher(args);
}

function isFixedPrivateSlot(slot, reservation) {
  const slotType = normalizeId(slot && slot.slotType);
  const sourceType = normalizeId(reservation && reservation.sourceType);
  const fixedStudentId = normalizeId(slot && slot.fixedStudentId);
  if (slotType === "fixed" || slotType === "released_fixed") return true;
  if (sourceType === "fixed") return true;
  return Boolean(fixedStudentId);
}

function buildCancelledPrivateReservationUpdates({
  now,
  uid,
  studentId,
  cancelledBy = "student",
  cancellationReason = "student_cancelled",
}) {
  return {
    status: "cancelled",
    cancelledAt: now,
    cancelledBy,
    cancelledByUid: uid,
    cancelledByStudentId: studentId,
    cancellationReason,
    updatedAt: now,
  };
}

function buildReleasedPrivateSlotUpdates({slot, reservation, studentId, now}) {
  const fixedSlot = isFixedPrivateSlot(slot, reservation);
  const fixedStudentId =
    normalizeId(slot && slot.fixedStudentId) ||
    normalizeId(slot && slot.reservedStudentId) ||
    studentId;
  const fixedStudentName =
    normalizeId(slot && slot.fixedStudentName) ||
    normalizeId(reservation && reservation.studentName) ||
    normalizeId(slot && slot.studentName);
  const updates = {
    status: "open",
    reservedStudentId: "",
    reservationId: "",
    reservedAt: null,
    cancelledAt: now,
    updatedAt: now,
    reservedCount: 0,
  };

  if (!fixedSlot) {
    updates.slotType = normalizeId(slot && slot.slotType) || "open";
    return updates;
  }

  return {
    ...updates,
    slotType: "released_fixed",
    fixedStudentId,
    fixedStudentName,
    releasedFromFixed: true,
    releasedByStudentId: studentId,
    releasedAt: now,
    releaseReason: "fixed_student_cancelled",
    isBookable: true,
  };
}

function buildAdminCancelledPrivateSlotUpdates({now}) {
  return {
    status: "cancelled",
    cancelledAt: now,
    updatedAt: now,
  };
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

function padTwo(value) {
  return String(value).padStart(2, "0");
}

function formatSeoulDateStringFromMillis(millis) {
  const date = new Date(millis + 9 * HOUR_MS);
  return [
    date.getUTCFullYear(),
    padTwo(date.getUTCMonth() + 1),
    padTwo(date.getUTCDate()),
  ].join("-");
}

function formatSeoulOpenDateTime(millis) {
  const date = new Date(millis + 9 * HOUR_MS);
  return `${date.getUTCFullYear()}.` +
    `${padTwo(date.getUTCMonth() + 1)}.` +
    `${padTwo(date.getUTCDate())} ` +
    `${padTwo(date.getUTCHours())}:${padTwo(date.getUTCMinutes())}`;
}

function addSeoulDays(dateValue, days) {
  const startMillis = getSeoulDateTimeMillis(dateValue, "00:00");
  if (startMillis === null) return "";
  return formatSeoulDateStringFromMillis(startMillis + days * DAY_MS);
}

function getSeoulWeekday(dateValue) {
  const startMillis = getSeoulDateTimeMillis(dateValue, "00:00");
  if (startMillis === null) return null;
  const weekday = new Date(startMillis + 9 * HOUR_MS).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

function getSeoulMondayForDate(dateValue) {
  const weekday = getSeoulWeekday(dateValue);
  if (!weekday) return "";
  return addSeoulDays(dateValue, 1 - weekday);
}

function computePrivateBookingWindow(slot) {
  const date = normalizeId(slot && slot.date);
  const time = normalizeId(slot && slot.time);
  const startsAt = getSeoulDateTimeMillis(date, time);
  if (startsAt === null) return null;
  const weekStartsOn = getSeoulMondayForDate(date);
  const bookingOpensAt = getSeoulDateTimeMillis(
      addSeoulDays(weekStartsOn, -3),
      "00:00",
  );
  const explicitBookingOpensAt =
    getTimestampMillis(slot && slot.bookingOpensAt);
  const explicitBookingClosesAt =
    getTimestampMillis(slot && slot.bookingClosesAt);
  return {
    startsAt,
    bookingOpensAt: explicitBookingOpensAt !== null ?
      explicitBookingOpensAt :
      bookingOpensAt,
    bookingClosesAt: explicitBookingClosesAt !== null ?
      explicitBookingClosesAt :
      startsAt - PRIVATE_SLOT_BOOKING_CUTOFF_MS,
    weekStartsOn,
    weekEndsOn: addSeoulDays(weekStartsOn, 5),
    weekday: getSeoulWeekday(date),
  };
}

function timestampFromMillis(millis) {
  return admin.firestore.Timestamp.fromMillis(millis);
}

function getPrivateBookingStatusLabel(status) {
  if (status === "available") return "예약 가능";
  if (status === "busy") return "수업 있음";
  if (status === "not_open") return "예약 오픈 대기";
  if (status === "closed") return "예약 마감 · 수업 준비 중";
  if (status === "my_reservation") return "내 예약";
  if (status === "reserved_by_me") return "내 예약";
  if (status === "reserved") return "수업 있음";
  if (status === "blocked") return "수업 있음";
  if (status === "no_ticket") return "수업 있음";
  if (status === "no_package") return "수강권 등록 필요";
  if (status === "no_makeup") return "보충 가능 0회";
  return "예약 중지";
}

function getPrivateBookingOpenRelativeLabel(openMillis, nowMillis) {
  const diff = Math.max(0, openMillis - nowMillis);
  if (diff < DAY_MS) {
    return `${Math.max(1, Math.ceil(diff / HOUR_MS))}시간 후`;
  }
  return `${Math.max(1, Math.ceil(diff / DAY_MS))}일 후`;
}

function computePrivateBookingStatus({
  slot,
  nowMillis,
  bookingEnabled,
  pilotBookable,
  packageSummary,
  activeReservation,
  studentId,
}) {
  const reservationStudentId = normalizeId(
      activeReservation && activeReservation.studentId,
  );
  if (reservationStudentId && reservationStudentId === studentId) {
    return "my_reservation";
  }
  const status = normalizeId(slot && slot.status).toLowerCase();
  if (slot && slot.isBusy === true) return "busy";
  if (status === "reserved") return "reserved";
  if (status === "blocked") return "blocked";
  if (status !== "open") return "blocked";
  if (!packageSummary) {
    return "no_ticket";
  }
  if (Number(packageSummary.remainingCount || 0) <= 0) return "no_makeup";
  const window = computePrivateBookingWindow(slot);
  if (!window || window.weekday < 1 || window.weekday > 6) return "closed";
  if (nowMillis < window.bookingOpensAt) return "not_open";
  if (nowMillis >= window.bookingClosesAt) return "closed";
  if (!bookingEnabled || !pilotBookable) return "blocked";
  return "available";
}

function getPrivateSlotStudentVisibleStatus(bookingStatus) {
  if (bookingStatus === "available") return "available";
  if (
    bookingStatus === "no_ticket" ||
    bookingStatus === "no_makeup" ||
    bookingStatus === "busy" ||
    bookingStatus === "reserved"
  ) {
    return "busy";
  }
  return "available";
}

function getPrivateSlotDisabledReason(bookingStatus) {
  if (bookingStatus === "no_ticket") return "no_ticket";
  if (bookingStatus === "no_makeup") return "no_makeup";
  if (bookingStatus === "closed") return "booking_window_closed";
  if (bookingStatus === "not_open") return "booking_window_not_open";
  if (bookingStatus === "blocked") return "inactive";
  if (bookingStatus === "reserved" || bookingStatus === "busy") return "busy";
  return "";
}

function buildPrivateTemplateSlotId({templateId, date, time}) {
  const safeTemplateId = normalizeId(templateId)
      .replace(/[^A-Za-z0-9_-]/g, "_");
  const safeDate = normalizeId(date).replace(/-/g, "");
  const safeTime = normalizeId(time).replace(/:/g, "");
  return `${PRIVATE_TEMPLATE_SLOT_PREFIX}__${safeTemplateId}__` +
    `${safeDate}__${safeTime}`;
}

function getPrivateSlotStartMillis(slot) {
  const startAtMillis = getTimestampMillis(slot && slot.startAt);
  if (startAtMillis !== null) return startAtMillis;
  return getSeoulDateTimeMillis(slot && slot.date, slot && slot.time);
}

function getSeoulTodayDateString() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function getPrivateReservationStartMillis(reservation, slot) {
  const slotStartAtMillis = getTimestampMillis(slot && slot.startAt);
  if (slotStartAtMillis !== null) return slotStartAtMillis;
  return getSeoulDateTimeMillis(
      (reservation && reservation.date) || (slot && slot.date),
      (reservation && reservation.time) || (slot && slot.time),
  );
}

function getPrivateReservationDurationMinutes(reservation, slot) {
  const slotDuration = Number(slot && slot.durationMinutes);
  if (Number.isFinite(slotDuration) && slotDuration > 0) return slotDuration;
  const reservationDuration = Number(
      reservation && reservation.durationMinutes,
  );
  if (Number.isFinite(reservationDuration) && reservationDuration > 0) {
    return reservationDuration;
  }
  return 50;
}

function getPrivateReservationEndMillis(reservation, slot) {
  const startMillis = getPrivateReservationStartMillis(reservation, slot);
  if (startMillis === null) return null;
  return startMillis +
    getPrivateReservationDurationMinutes(reservation, slot) * 60 * 1000;
}

async function findPrivatePackageForAutoDeduction({
  transaction,
  db,
  academyId,
  reservation,
  slot,
}) {
  const explicitPackageId = normalizeId(reservation.packageId);
  if (explicitPackageId) {
    const packageRef = db.collection("studentPackages").doc(explicitPackageId);
    const packageSnap = await transaction.get(packageRef);
    if (!packageSnap.exists) return null;
    const packageData = packageSnap.data() || {};
    if (!isPrivatePackageForReservation(packageData, reservation, slot)) {
      return null;
    }
    return {ref: packageRef, data: packageData};
  }

  const studentId = normalizeId(reservation.studentId);
  const packageSnap = await transaction.get(
      db.collection("studentPackages")
          .where("academyId", "==", academyId)
          .where("studentId", "==", studentId),
  );
  const candidates = packageSnap.docs
      .map((docSnap) => ({ref: docSnap.ref, data: docSnap.data() || {}}))
      .filter((candidate) =>
        isPrivatePackageForReservation(candidate.data, reservation, slot) &&
        Number(candidate.data.remainingCount || 0) > 0,
      )
      .sort(sortPrivatePackageCandidates);
  return candidates[0] || null;
}

async function findGroupPackageForAutoDeduction({
  transaction,
  db,
  academyId,
  lesson,
  studentId,
}) {
  const packageSnap = await transaction.get(
      db.collection("studentPackages")
          .where("academyId", "==", academyId)
          .where("studentId", "==", studentId),
  );
  const groupClassId = getGroupLessonGroupId(lesson);
  const groupCourseType = normalizeId(lesson.groupCourseType);
  const candidates = packageSnap.docs
      .map((docSnap) => ({ref: docSnap.ref, data: docSnap.data() || {}}))
      .filter((candidate) => {
        const pkg = candidate.data;
        if (normalizeId(pkg.packageType).toLowerCase() !== "group") {
          return false;
        }
        if (!isPackageActiveForDeduction(pkg)) return false;
        const pkgGroupId = normalizeId(pkg.groupClassId);
        const pkgCourseType = normalizeId(pkg.groupCourseType);
        return (
          (groupClassId && pkgGroupId === groupClassId) ||
          (groupCourseType && pkgCourseType === groupCourseType)
        );
      })
      .sort((a, b) => {
        const aRemaining = Number(a.data.remainingCount || 0);
        const bRemaining = Number(b.data.remainingCount || 0);
        if (aRemaining !== bRemaining) return aRemaining - bRemaining;
        const aCreated = getTimestampMillis(a.data.createdAt) || 0;
        const bCreated = getTimestampMillis(b.data.createdAt) || 0;
        return aCreated - bCreated;
      });
  return candidates[0] || null;
}

function getGroupTicketClassIds(ticket) {
  return normalizeIdList([
    ticket && ticket.groupClassId,
    ticket && ticket.classID,
    ticket && ticket.classId,
    ...(Array.isArray(ticket && ticket.groupClassIds) ?
      ticket.groupClassIds :
      []),
  ]);
}

function getGroupTicketCourseTypes(ticket) {
  return normalizeIdList([
    ticket && ticket.groupCourseType,
    ticket && ticket.courseType,
    ...(Array.isArray(ticket && ticket.groupCourseTypes) ?
      ticket.groupCourseTypes :
      []),
  ]);
}

function groupTicketMatchesScope(ticket, lesson) {
  const ticketClassIds = getGroupTicketClassIds(ticket);
  const lessonClassId = getGroupLessonGroupId(lesson);
  if (lessonClassId && ticketClassIds.includes(lessonClassId)) return true;

  const ticketCourseTypes = getGroupTicketCourseTypes(ticket);
  const lessonCourseType = normalizeId(
      lesson && (lesson.groupCourseType || lesson.courseType),
  );
  return Boolean(
      lessonCourseType && ticketCourseTypes.includes(lessonCourseType),
  );
}

function groupRowMatchesTicketScope({row, ticket, academyId, studentId}) {
  if (normalizeId(row && row.academyId) !== academyId) return false;
  const rowStudentId = normalizeId(row && (row.studentId || row.studentID));
  if (rowStudentId && rowStudentId !== studentId) return false;
  const packageId = normalizeId(ticket && ticket.id);
  const rowPackageIds = normalizeIdList([
    row && row.packageId,
    row && row.deductionPackageId,
  ]);
  if (packageId && rowPackageIds.length > 0) {
    return rowPackageIds.includes(packageId);
  }
  return groupTicketMatchesScope(ticket, row);
}

function computeGroupTicketBalance({
  ticket,
  fixedGroupLessons = [],
  groupReservations = [],
  academyId,
  studentId,
  nowMillis = Date.now(),
}) {
  const totalRaw = Number(ticket && ticket.totalCount);
  const usedRaw = Number(ticket && ticket.usedCount);
  const remainingRaw = Number(ticket && ticket.remainingCount);
  const totalCount = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
  const usedCount = Number.isFinite(usedRaw) && usedRaw > 0 ? usedRaw : 0;
  const remainingCount =
    Number.isFinite(remainingRaw) && remainingRaw > 0 ? remainingRaw : 0;
  const rawAvailableCount = totalCount > 0 ?
    Math.min(remainingCount, Math.max(0, totalCount - usedCount)) :
    remainingCount;

  let futureFixedAllocatedCount = 0;
  let noDeductionReleasedCount = 0;
  fixedGroupLessons.forEach((lesson) => {
    if (!groupRowMatchesTicketScope({
      row: lesson,
      ticket,
      academyId,
      studentId,
    })) {
      return;
    }
    const releasedIds = normalizeIdList(
        lesson && lesson.releasedFixedStudentIDs,
    );
    const countedIds = normalizeIdList(lesson && lesson.countedStudentIDs);
    const skipReason = getDeductionSkipReasonForLesson(lesson);
    if (
      skipReason ||
      releasedIds.includes(studentId) ||
      (lesson && lesson.attendanceAppliedAt && !countedIds.includes(studentId))
    ) {
      noDeductionReleasedCount += 1;
      return;
    }
    if (isFuturePrivateAllocation(lesson, nowMillis)) {
      futureFixedAllocatedCount += 1;
    }
  });

  let activeFutureReservationCount = 0;
  groupReservations.forEach((reservation) => {
    const reservationStatus =
      normalizeId(reservation && reservation.status).toLowerCase();
    if (reservationStatus !== "active") {
      return;
    }
    if (!groupRowMatchesTicketScope({
      row: reservation,
      ticket,
      academyId,
      studentId,
    })) {
      return;
    }
    if (isFuturePrivateAllocation(reservation, nowMillis)) {
      activeFutureReservationCount += 1;
    }
  });

  const availableToBook = Math.max(
      0,
      rawAvailableCount -
        futureFixedAllocatedCount -
        activeFutureReservationCount,
  );

  return {
    totalCount,
    usedCount,
    usedDeductedCount: usedCount,
    remainingCount,
    futureFixedAllocatedCount,
    activeFutureReservationCount,
    activeFutureReservationAllocatedCount: activeFutureReservationCount,
    noDeductionReleasedCount,
    availableToBook,
    makeupAvailableCount: availableToBook,
  };
}

function getGroupTicketStatusLabel({ticket, balance, ambiguous = false}) {
  if (!ticket) return ambiguous ? "수강권 연결 필요" : "수강권 등록 필요";
  if (ambiguous) return "수강권 연결 필요";
  if (Number(balance && balance.remainingCount || 0) <= 0) return "소진";
  const availableToBook = Number(balance && balance.availableToBook || 0);
  return `선택예약 가능 ${Math.max(0, availableToBook)}회`;
}

function buildFixedGroupTicketLessons({
  groupLessons,
  groupStudents,
  studentId,
}) {
  const byGroupId = new Map();
  groupStudents.forEach((groupStudent) => {
    if (normalizeId(groupStudent && groupStudent.studentId) !== studentId) {
      return;
    }
    const groupId = getGroupStudentGroupId(groupStudent);
    if (!groupId) return;
    if (!byGroupId.has(groupId)) byGroupId.set(groupId, []);
    byGroupId.get(groupId).push(groupStudent);
  });

  const rows = [];
  groupLessons.forEach((lesson) => {
    const groupId = getGroupLessonGroupId(lesson);
    const fixedMembers = byGroupId.get(groupId) || [];
    fixedMembers.forEach((member) => {
      if (!isActiveGroupStudentForLesson(member, lesson)) return;
      rows.push({
        ...lesson,
        studentId,
        packageId: normalizeId(member.packageId),
      });
    });
  });
  return rows;
}

async function getGroupTicketBalanceForLesson({
  transaction,
  db,
  academyId,
  studentId,
  lesson,
  groupLessons = [],
  groupStudents = [],
  groupReservations = [],
}) {
  const packageSnap = await transaction.get(
      db.collection("studentPackages")
          .where("academyId", "==", academyId)
          .where("studentId", "==", studentId),
  );
  const candidates = packageSnap.docs
      .map((docSnap) => ({
        id: docSnap.id,
        ref: docSnap.ref,
        data: docSnap.data() || {},
      }))
      .filter((candidate) => {
        const pkg = candidate.data;
        if (normalizeId(pkg.packageType).toLowerCase() !== "group") {
          return false;
        }
        if (!isPackageActiveForDeduction(pkg)) return false;
        return groupTicketMatchesScope(pkg, lesson);
      })
      .sort((a, b) => {
        const aRemaining = Number(a.data.remainingCount || 0);
        const bRemaining = Number(b.data.remainingCount || 0);
        if (aRemaining !== bRemaining) return bRemaining - aRemaining;
        const aCreated = getTimestampMillis(a.data.createdAt) || 0;
        const bCreated = getTimestampMillis(b.data.createdAt) || 0;
        return aCreated - bCreated;
      });

  if (candidates.length === 0) {
    const hasAnyGroupTicket = packageSnap.docs.some((docSnap) => {
      const pkg = docSnap.data() || {};
      return normalizeId(pkg.packageType).toLowerCase() === "group" &&
        isPackageActiveForDeduction(pkg);
    });
    return {
      ok: false,
      reason: hasAnyGroupTicket ? "scope_missing" : "no_ticket",
      ticket: null,
      balance: computeGroupTicketBalance({ticket: null, academyId, studentId}),
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: "ambiguous_ticket",
      ticket: candidates[0],
      candidates,
      balance: computeGroupTicketBalance({
        ticket: {id: candidates[0].id, ...candidates[0].data},
        fixedGroupLessons: buildFixedGroupTicketLessons({
          groupLessons,
          groupStudents,
          studentId,
        }),
        groupReservations,
        academyId,
        studentId,
      }),
    };
  }

  const ticket = {id: candidates[0].id, ...candidates[0].data};
  const balance = computeGroupTicketBalance({
    ticket,
    fixedGroupLessons: buildFixedGroupTicketLessons({
      groupLessons,
      groupStudents,
      studentId,
    }),
    groupReservations,
    academyId,
    studentId,
  });
  return {ok: true, ticket: candidates[0], balance};
}

function getGroupLessonStudentDeductionId(lesson, studentId) {
  const map = lesson && lesson.deductionTransactionIds;
  if (!map || typeof map !== "object") return "";
  return normalizeId(map[studentId]);
}

async function autoDeductPrivateReservation({
  db,
  academyId,
  reservationId,
  dryRun = false,
}) {
  const summary = createDeductionSummary();
  summary.checked = 1;
  return await db.runTransaction(async (transaction) => {
    const reservationRef = db
        .collection("privateLessonReservations")
        .doc(reservationId);
    const reservationSnap = await transaction.get(reservationRef);
    if (!reservationSnap.exists) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }

    const reservation = reservationSnap.data() || {};
    if (normalizeId(reservation.academyId) !== academyId) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }
    if (reservation.deductionApplied === true ||
        normalizeId(reservation.deductionTransactionId) ||
        normalizeId(reservation.deductionCreditTransactionId)) {
      incrementDeductionSkip(summary, "alreadyDeducted");
      return summary;
    }
    const skipReason = getPrivateReservationSkipReason(reservation);
    if (skipReason) {
      incrementDeductionSkip(summary, skipReason);
      return summary;
    }
    if (!isActivePrivateReservation(reservation)) {
      incrementDeductionSkip(summary, "cancelled");
      return summary;
    }

    const studentId = normalizeId(reservation.studentId);
    const slotId = normalizeId(reservation.slotId);
    if (!studentId || !slotId) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
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
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }
    const endMillis = getPrivateReservationEndMillis(reservation, slot);
    if (endMillis === null || Date.now() < endMillis) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }

    const packageCandidate = await findPrivatePackageForAutoDeduction({
      transaction,
      db,
      academyId,
      reservation,
      slot,
    });
    if (!packageCandidate) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }

    const packageData = packageCandidate.data;
    const packageRef = packageCandidate.ref;
    if (!isPackageActiveForDeduction(packageData)) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }
    const remainingBefore = Number(packageData.remainingCount || 0);
    const usedBefore = Number(packageData.usedCount || 0);
    if (!Number.isFinite(remainingBefore) || remainingBefore <= 0 ||
        !Number.isFinite(usedBefore)) {
      incrementDeductionSkip(summary, "noRemaining");
      return summary;
    }

    const deductionKey = buildDeductionKey({
      academyId,
      lessonId: reservationId,
      studentId,
      packageId: packageRef.id,
    });
    const creditRef = db.collection("creditTransactions").doc(deductionKey);
    const creditSnap = await transaction.get(creditRef);
    if (creditSnap.exists) {
      incrementDeductionSkip(summary, "alreadyDeducted");
      return summary;
    }
    if (dryRun) {
      summary.deducted += 1;
      return summary;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const remainingAfter = Math.max(0, remainingBefore - 1);
    const usedAfter = usedBefore + 1;
    const nextPackageStatus = getNextStudentPackageStatus(
        packageData.status,
        remainingAfter,
    );
    const teacher = getReservationTeacherKey(reservation, slot);
    const studentName =
      getOptionalStudentName({student, membership: null, reservation}) ||
      studentId;
    const datePart = [
      normalizeId(reservation.date || (slot && slot.date)),
      normalizeId(reservation.time || (slot && slot.time)),
      normalizeId(reservation.subject || (slot && slot.subject)),
    ].filter(Boolean).join(" ");

    transaction.update(packageRef, {
      usedCount: usedAfter,
      remainingCount: remainingAfter,
      status: nextPackageStatus,
      updatedAt: now,
    });
    transaction.update(reservationRef, {
      status: "completed",
      completedAt: now,
      noShowAt: null,
      deductionApplied: true,
      deductionAppliedAt: now,
      deductionPackageId: packageRef.id,
      deductionCreditTransactionId: deductionKey,
      deductionTransactionId: deductionKey,
      deductionSource: "auto",
      deductionStatus: "deducted",
      outcomeActorRole: "auto",
      updatedAt: now,
    });
    transaction.set(creditRef, {
      academyId,
      studentId,
      studentName,
      teacher,
      packageId: packageRef.id,
      packageType: "private",
      packageTitle: String(packageData.packageTitle || packageData.title || ""),
      groupClassName: "",
      sourceType: "privateReservation",
      sourceId: reservationId,
      actionType: "auto_private_reservation_deduct",
      deltaCount: -1,
      memo: datePart ?
        `자동 1:1 예약 차감 ${datePart}` :
        "자동 1:1 예약 차감",
      actorUid: "system:autoDeductPendingLessons",
      actorRole: "system",
      deductionSource: "auto",
      createdAt: now,
    }, {merge: false});
    summary.deducted += 1;
    return summary;
  });
}

async function autoDeductGroupStudent({
  db,
  academyId,
  lessonId,
  groupStudentId = "",
  reservationId = "",
  dryRun = false,
}) {
  const summary = createDeductionSummary();
  summary.checked = 1;
  return await db.runTransaction(async (transaction) => {
    const lessonRef = db.collection("groupLessons").doc(lessonId);
    const lessonSnap = await transaction.get(lessonRef);
    if (!lessonSnap.exists) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }
    const lesson = {id: lessonSnap.id, ...lessonSnap.data()};
    if (normalizeId(lesson.academyId) !== academyId) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }
    const lessonSkip = getDeductionSkipReasonForLesson(lesson);
    if (lessonSkip) {
      incrementDeductionSkip(summary, lessonSkip);
      return summary;
    }

    let studentId = "";
    let studentName = "";
    let packageRef = null;
    let packageData = null;
    let groupStudentRef = null;
    let groupStudentData = null;
    let reservationRef = null;
    const releasedIds = normalizeIdList(lesson.releasedFixedStudentIDs);

    if (groupStudentId) {
      groupStudentRef = db.collection("groupStudents").doc(groupStudentId);
      const groupStudentSnap = await transaction.get(groupStudentRef);
      if (!groupStudentSnap.exists) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      groupStudentData = groupStudentSnap.data() || {};
      if (normalizeId(groupStudentData.academyId) !== academyId ||
          getGroupStudentGroupId(groupStudentData) !==
            getGroupLessonGroupId(lesson)) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      if (!isActiveGroupStudentForLesson(groupStudentData, lesson)) {
        incrementDeductionSkip(summary, "noDeduction");
        return summary;
      }
      studentId = normalizeId(groupStudentData.studentId);
      studentName = normalizeId(
          groupStudentData.studentName || groupStudentData.name,
      );
      if (!studentId || releasedIds.includes(studentId)) {
        incrementDeductionSkip(summary, "noDeduction");
        return summary;
      }
      if (lesson.attendanceAppliedAt &&
          !normalizeIdList(lesson.countedStudentIDs).includes(studentId)) {
        incrementDeductionSkip(summary, "alreadyDeducted");
        return summary;
      }
      const packageId = normalizeId(groupStudentData.packageId);
      if (!packageId) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      packageRef = db.collection("studentPackages").doc(packageId);
      const packageSnap = await transaction.get(packageRef);
      if (!packageSnap.exists) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      packageData = packageSnap.data() || {};
    } else if (reservationId) {
      reservationRef = db.collection("groupLessonReservations")
          .doc(reservationId);
      const reservationSnap = await transaction.get(reservationRef);
      if (!reservationSnap.exists) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      const reservation = reservationSnap.data() || {};
      if (normalizeId(reservation.academyId) !== academyId ||
          normalizeId(reservation.lessonId) !== lessonId) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      const reservationStatus = normalizeId(reservation.status).toLowerCase();
      if (reservationStatus !== "active") {
        incrementDeductionSkip(summary, "cancelled");
        return summary;
      }
      if (reservation.noDeduction === true ||
          normalizeId(reservation.cancellationType) === "no_deduction" ||
          normalizeId(reservation.cancellationType) === "class_closure") {
        incrementDeductionSkip(summary, "noDeduction");
        return summary;
      }
      if (reservation.deductionApplied === true ||
          normalizeId(reservation.deductionTransactionId)) {
        incrementDeductionSkip(summary, "alreadyDeducted");
        return summary;
      }
      studentId = normalizeId(reservation.studentId);
      studentName = normalizeId(reservation.studentName) || studentId;
      if (!studentId) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      const packageCandidate = await findGroupPackageForAutoDeduction({
        transaction,
        db,
        academyId,
        lesson,
        studentId,
      });
      if (!packageCandidate) {
        incrementDeductionSkip(summary, "noPackage");
        return summary;
      }
      packageRef = packageCandidate.ref;
      packageData = packageCandidate.data;
    } else {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }

    const countedIds = normalizeIdList(lesson.countedStudentIDs);
    if (countedIds.includes(studentId) ||
        getGroupLessonStudentDeductionId(lesson, studentId)) {
      incrementDeductionSkip(summary, "alreadyDeducted");
      return summary;
    }
    if (normalizeId(packageData.academyId) !== academyId ||
        normalizeId(packageData.studentId) !== studentId ||
        normalizeId(packageData.packageType).toLowerCase() !== "group") {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }
    if (!isPackageActiveForDeduction(packageData)) {
      incrementDeductionSkip(summary, "noPackage");
      return summary;
    }
    const remainingBefore = Number(packageData.remainingCount || 0);
    const usedBefore = Number(packageData.usedCount || 0);
    if (!Number.isFinite(remainingBefore) || remainingBefore <= 0 ||
        !Number.isFinite(usedBefore)) {
      incrementDeductionSkip(summary, "noRemaining");
      return summary;
    }

    const deductionKey = buildDeductionKey({
      academyId,
      lessonId,
      studentId,
      packageId: packageRef.id,
    });
    const creditRef = db.collection("creditTransactions").doc(deductionKey);
    const creditSnap = await transaction.get(creditRef);
    if (creditSnap.exists) {
      incrementDeductionSkip(summary, "alreadyDeducted");
      return summary;
    }
    if (dryRun) {
      summary.deducted += 1;
      return summary;
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    const remainingAfter = Math.max(0, remainingBefore - 1);
    const usedAfter = usedBefore + 1;
    const nextPackageStatus = getNextStudentPackageStatus(
        packageData.status,
        remainingAfter,
    );
    const groupClassName = normalizeId(lesson.groupClassName);
    const teacher = normalizeTeacherKey(
        lesson.teacher || lesson.teacherName || packageData.teacher,
    );
    const datePart = [
      normalizeId(lesson.date),
      normalizeId(lesson.time),
      normalizeId(lesson.subject),
    ].filter(Boolean).join(" ");

    transaction.update(packageRef, {
      usedCount: usedAfter,
      remainingCount: remainingAfter,
      status: nextPackageStatus,
      updatedAt: now,
    });
    if (groupStudentRef && groupStudentData) {
      const attendanceCount = Number(groupStudentData.attendanceCount || 0);
      transaction.update(groupStudentRef, {
        attendanceCount: attendanceCount + 1,
        updatedAt: now,
      });
    }
    transaction.set(lessonRef, {
      countedStudentIDs: admin.firestore.FieldValue.arrayUnion(studentId),
      autoDeductedStudentIDs: admin.firestore.FieldValue.arrayUnion(studentId),
      attendanceAppliedAt: now,
      deductionTransactionIds: {[studentId]: deductionKey},
      deductionSources: {[studentId]: "auto"},
      deductionSource: "auto",
      deductionStatus: "deducted",
      autoDeductedAt: now,
      updatedAt: now,
    }, {merge: true});
    if (reservationRef) {
      transaction.update(reservationRef, {
        deductionApplied: true,
        deductionAppliedAt: now,
        deductionPackageId: packageRef.id,
        deductionCreditTransactionId: deductionKey,
        deductionTransactionId: deductionKey,
        deductionSource: "auto",
        deductionStatus: "deducted",
        updatedAt: now,
      });
    }
    transaction.set(creditRef, {
      academyId,
      studentId,
      studentName: studentName || studentId,
      teacher,
      packageId: packageRef.id,
      packageType: "group",
      packageTitle: String(packageData.packageTitle || packageData.title || ""),
      groupClassName,
      sourceType: "groupLesson",
      sourceId: lessonId,
      actionType: "auto_group_deduct",
      deltaCount: -1,
      memo: datePart ? `자동 그룹 차감 ${datePart}` : "자동 그룹 차감",
      actorUid: "system:autoDeductPendingLessons",
      actorRole: "system",
      deductionSource: "auto",
      createdAt: now,
    }, {merge: false});
    summary.deducted += 1;
    return summary;
  });
}

async function getAutoDeductionAcademyIds(db, explicitAcademyId) {
  const academyId = normalizeId(explicitAcademyId);
  if (academyId) return [academyId];
  const snap = await db.collection("academies").limit(50).get();
  return snap.docs
      .map((docSnap) => normalizeId(docSnap.id))
      .filter(Boolean);
}

async function runAutoDeductPendingLessons({
  academyId = "",
  dates = null,
  lookbackDays = 3,
  todayYmd = getKstDateString(),
  dryRun = false,
} = {}) {
  const db = admin.firestore();
  const academyIds = await getAutoDeductionAcademyIds(db, academyId);
  const rangeDates = Array.isArray(dates) && dates.length > 0 ?
    dates.map((date) => normalizeId(date)).filter(Boolean) :
    getAutoDeductionDateRange({todayYmd, lookbackDays});
  const summary = createDeductionSummary();
  summary.academies = {};
  summary.dates = rangeDates;
  summary.dryRun = dryRun === true;

  for (const scopedAcademyId of academyIds) {
    const academySummary = createDeductionSummary();
    summary.academies[scopedAcademyId] = academySummary;
    for (const date of rangeDates) {
      if (!date || date >= todayYmd) continue;

      const privateSnap = await db.collection("privateLessonReservations")
          .where("academyId", "==", scopedAcademyId)
          .where("date", "==", date)
          .limit(200)
          .get();
      for (const docSnap of privateSnap.docs) {
        try {
          const result = await autoDeductPrivateReservation({
            db,
            academyId: scopedAcademyId,
            reservationId: docSnap.id,
            dryRun,
          });
          addDeductionSummary(academySummary, result);
          addDeductionSummary(summary, result);
        } catch (error) {
          academySummary.errors += 1;
          summary.errors += 1;
          console.error("auto private deduction failed", {
            academyId: scopedAcademyId,
            reservationId: docSnap.id,
            error: error.message,
          });
        }
      }

      const groupLessonSnap = await db.collection("groupLessons")
          .where("academyId", "==", scopedAcademyId)
          .where("date", "==", date)
          .limit(200)
          .get();
      for (const lessonDoc of groupLessonSnap.docs) {
        const lesson = {id: lessonDoc.id, ...lessonDoc.data()};
        const lessonSkip = getDeductionSkipReasonForLesson(lesson);
        if (lessonSkip) {
          academySummary.checked += 1;
          summary.checked += 1;
          incrementDeductionSkip(academySummary, lessonSkip);
          incrementDeductionSkip(summary, lessonSkip);
          continue;
        }
        const groupClassId = getGroupLessonGroupId(lesson);
        const [groupStudentsSnap, reservationsSnap] = await Promise.all([
          db.collection("groupStudents")
              .where("academyId", "==", scopedAcademyId)
              .where("groupClassId", "==", groupClassId)
              .get(),
          db.collection("groupLessonReservations")
              .where("academyId", "==", scopedAcademyId)
              .where("lessonId", "==", lessonDoc.id)
              .get(),
        ]);
        const fixedMembers = groupStudentsSnap.docs
            .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}))
            .filter((groupStudent) =>
              isActiveGroupStudentForLesson(groupStudent, lesson),
            );
        for (const groupStudent of fixedMembers) {
          try {
            const result = await autoDeductGroupStudent({
              db,
              academyId: scopedAcademyId,
              lessonId: lessonDoc.id,
              groupStudentId: groupStudent.id,
              dryRun,
            });
            addDeductionSummary(academySummary, result);
            addDeductionSummary(summary, result);
          } catch (error) {
            academySummary.errors += 1;
            summary.errors += 1;
            console.error("auto group fixed deduction failed", {
              academyId: scopedAcademyId,
              lessonId: lessonDoc.id,
              groupStudentId: groupStudent.id,
              error: error.message,
            });
          }
        }
        const guestReservations = reservationsSnap.docs
            .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}))
            .filter((reservation) =>
              normalizeId(reservation.status).toLowerCase() === "active",
            );
        for (const reservation of guestReservations) {
          try {
            const result = await autoDeductGroupStudent({
              db,
              academyId: scopedAcademyId,
              lessonId: lessonDoc.id,
              reservationId: reservation.id,
              dryRun,
            });
            addDeductionSummary(academySummary, result);
            addDeductionSummary(summary, result);
          } catch (error) {
            academySummary.errors += 1;
            summary.errors += 1;
            console.error("auto group reservation deduction failed", {
              academyId: scopedAcademyId,
              lessonId: lessonDoc.id,
              reservationId: reservation.id,
              error: error.message,
            });
          }
        }
      }
    }
  }
  return summary;
}

function normalizePositiveAttempt(value) {
  const attempt = Number(value || 0);
  if (!Number.isFinite(attempt) || attempt < 0) return 0;
  return Math.floor(attempt);
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

function sanitizePrivateSlotAvailabilityRow({
  slotId,
  slot,
  bookingEnabled,
  pilotBookable,
  activeReservation = null,
  packageSummary = null,
  studentId = "",
  nowMillis = Date.now(),
}) {
  const status = String((slot && slot.status) || "").trim();
  const isReserved = status === "reserved";
  const durationMinutes = Number(slot && slot.durationMinutes);
  const window = computePrivateBookingWindow(slot);
  const bookingStatus = computePrivateBookingStatus({
    slot,
    nowMillis,
    bookingEnabled,
    pilotBookable,
    packageSummary,
    activeReservation,
    studentId,
  });
  const isBookable = bookingStatus === "available";
  const studentVisibleStatus =
    getPrivateSlotStudentVisibleStatus(bookingStatus);
  const isBusy =
    studentVisibleStatus === "busy" ||
    bookingStatus === "busy" ||
    bookingStatus === "reserved" ||
    status === "blocked";
  const bookingOpensAt = window ? window.bookingOpensAt : null;
  const bookingClosesAt = window ? window.bookingClosesAt : null;
  const startsAt = window ? window.startsAt : null;
  const packageAvailableCount = packageSummary &&
    packageSummary.makeupAvailableCount !== undefined ?
      packageSummary.makeupAvailableCount :
      packageSummary && packageSummary.remainingCount !== undefined ?
        packageSummary.remainingCount :
        0;
  const packageRemainingCount = packageSummary ?
    Number(packageAvailableCount) :
    0;
  const safePackageSummary = packageSummary ? {
    packageId: packageSummary.packageId || "",
    teacherKey: packageSummary.teacherKey || "",
    remainingCount: packageRemainingCount,
    totalCount: Number(packageSummary.totalCount || 0),
    usedDeductedCount: Number(packageSummary.usedDeductedCount || 0),
    futureFixedAllocatedCount:
      Number(packageSummary.futureFixedAllocatedCount || 0),
    activeFutureReservationAllocatedCount:
      Number(packageSummary.activeFutureReservationAllocatedCount || 0),
    activeFutureReservationCount:
      Number(
          packageSummary.activeFutureReservationCount ||
          packageSummary.activeFutureReservationAllocatedCount ||
          0,
      ),
    noDeductionReleasedCount:
      Number(packageSummary.noDeductionReleasedCount || 0),
    makeupAvailableCount: packageRemainingCount,
  } : null;

  return {
    id: slotId,
    academyId: normalizeId(slot && slot.academyId),
    teacher: normalizeId(slot && slot.teacher),
    teacherKey:
      normalizeTeacherKey(slot && slot.teacherKey) ||
      normalizeTeacherKey(slot && slot.teacherUid) ||
      normalizeTeacherKey(slot && slot.teacherUID) ||
      normalizeTeacherKey(slot && slot.teacher) ||
      normalizeTeacherKey(slot && slot.teacherName),
    teacherUid: normalizeId(
        (slot && slot.teacherUid) ||
        (slot && slot.teacherUID) ||
        (slot && slot.teacherId),
    ),
    teacherId: normalizeId(slot && slot.teacherId),
    teacherEmail: normalizeId(slot && slot.teacherEmail),
    teacherName: normalizeId(slot && slot.teacherName),
    date: normalizeId(slot && slot.date),
    time: normalizeId(slot && slot.time),
    durationMinutes:
      Number.isFinite(durationMinutes) && durationMinutes > 0 ?
        Math.floor(durationMinutes) :
        50,
    subject: normalizeId(slot && slot.subject),
    status,
    statusLabel: getPrivateBookingStatusLabel(bookingStatus),
    isReserved,
    isBookable,
    isReservable: isBookable,
    isBusy,
    bookingStatus,
    bookingStatusLabel: getPrivateBookingStatusLabel(bookingStatus),
    studentVisibleStatus,
    studentVisibleStatusLabel:
      getPrivateBookingStatusLabel(studentVisibleStatus),
    disabledReason: isBookable ?
      "" :
      getPrivateSlotDisabledReason(bookingStatus),
    bookingOpensAtMillis: bookingOpensAt,
    bookingClosesAtMillis: bookingClosesAt,
    startsAtMillis: startsAt,
    bookingOpensAt: bookingOpensAt ? timestampFromMillis(bookingOpensAt) : null,
    bookingClosesAt: bookingClosesAt ?
      timestampFromMillis(bookingClosesAt) :
      null,
    startsAt: startsAt ? timestampFromMillis(startsAt) : null,
    bookingOpenDisplay: bookingOpensAt ?
      formatSeoulOpenDateTime(bookingOpensAt) :
      "",
    bookingOpenRelativeLabel:
      bookingStatus === "not_open" && bookingOpensAt ?
        getPrivateBookingOpenRelativeLabel(bookingOpensAt, nowMillis) :
        "",
    packageId: packageSummary ? packageSummary.packageId : "",
    packageRemainingCount,
    makeupAvailableCount: packageRemainingCount,
    packageSummary: safePackageSummary,
    slotType: normalizeId(slot && slot.slotType),
    releasedFromFixed: slot && slot.releasedFromFixed === true,
    availabilityTemplateId: normalizeId(slot && slot.availabilityTemplateId),
    isGeneratedFromTemplate: slot && slot.isGeneratedFromTemplate === true,
    isReleasedFixedSlot:
      normalizeId(slot && slot.slotType) === "released_fixed" ||
      (slot && slot.releasedFromFixed === true),
  };
}

function isPrivateScheduleDateInRange(value, startDate, endDate) {
  const date = normalizeId(value);
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= startDate &&
    date <= endDate
  );
}

function getPrivateScheduleDurationMinutes(row) {
  const duration = Number(
      row && (
        row.durationMinutes ||
        row.duration ||
        row.lessonDurationMinutes ||
        row.classDurationMinutes
      ),
  );
  if (Number.isFinite(duration) && duration > 0) return Math.floor(duration);
  return 50;
}

function getPrivateScheduleTeacherKey(row) {
  return getPrivateTeacherScopeKeys(row)[0] || "";
}

function isCancelledScheduleRow(row) {
  const status = normalizeId(row && row.status).toLowerCase();
  const approvalStatus = normalizeId(row && row.approvalStatus).toLowerCase();
  if (status === "cancelled" || status === "canceled") return true;
  if (row && row.completed === "cancelled") return true;
  if (row && row.isDeductCancelled === true) return true;
  if (approvalStatus && approvalStatus !== "approved") return true;
  return false;
}

function buildBusyPrivateScheduleRow({
  id,
  academyId,
  teacherKey,
  teacherUid = "",
  teacherName,
  date,
  time,
  durationMinutes,
  packageSummary,
  status = "busy",
}) {
  const startsAt = getSeoulDateTimeMillis(date, time);
  const window = computePrivateBookingWindow({date, time});
  const safeStatus = status === "reserved" || status === "blocked" ?
    status :
    "busy";
  const packageRemainingCount = packageSummary ?
    Number(
        packageSummary.makeupAvailableCount !== undefined ?
          packageSummary.makeupAvailableCount :
          packageSummary.remainingCount !== undefined ?
            packageSummary.remainingCount :
            0,
    ) :
    0;
  return {
    id,
    academyId,
    teacher: teacherKey,
    teacherKey,
    teacherUid: normalizeId(teacherUid),
    teacherName: normalizeId(teacherName || teacherKey),
    date,
    time,
    durationMinutes,
    status: safeStatus,
    statusLabel: getPrivateBookingStatusLabel(safeStatus),
    isReserved: safeStatus === "reserved",
    isBookable: false,
    isReservable: false,
    isBusy: true,
    bookingStatus: safeStatus,
    bookingStatusLabel: getPrivateBookingStatusLabel(safeStatus),
    studentVisibleStatus: "busy",
    studentVisibleStatusLabel: getPrivateBookingStatusLabel("busy"),
    disabledReason: "busy",
    bookingOpensAtMillis: window ? window.bookingOpensAt : null,
    bookingClosesAtMillis: window ? window.bookingClosesAt : null,
    startsAtMillis: startsAt,
    bookingOpensAt: window && window.bookingOpensAt ?
      timestampFromMillis(window.bookingOpensAt) :
      null,
    bookingClosesAt: window && window.bookingClosesAt ?
      timestampFromMillis(window.bookingClosesAt) :
      null,
    startsAt: startsAt ? timestampFromMillis(startsAt) : null,
    bookingOpenDisplay: window && window.bookingOpensAt ?
      formatSeoulOpenDateTime(window.bookingOpensAt) :
      "",
    bookingOpenRelativeLabel: "",
    packageId: packageSummary ? packageSummary.packageId : "",
    packageRemainingCount,
    makeupAvailableCount: packageRemainingCount,
    packageSummary: packageSummary ? {
      packageId: packageSummary.packageId || "",
      teacherKey: packageSummary.teacherKey || "",
      remainingCount: packageRemainingCount,
      totalCount: Number(packageSummary.totalCount || 0),
      usedDeductedCount: Number(packageSummary.usedDeductedCount || 0),
      futureFixedAllocatedCount:
        Number(packageSummary.futureFixedAllocatedCount || 0),
      activeFutureReservationAllocatedCount:
        Number(packageSummary.activeFutureReservationAllocatedCount || 0),
      activeFutureReservationCount:
        Number(
            packageSummary.activeFutureReservationCount ||
            packageSummary.activeFutureReservationAllocatedCount ||
            0,
        ),
      noDeductionReleasedCount:
        Number(packageSummary.noDeductionReleasedCount || 0),
      makeupAvailableCount: packageRemainingCount,
    } : null,
    slotType: "busy",
    availabilityTemplateId: "",
    isGeneratedFromTemplate: false,
    isReleasedFixedSlot: false,
  };
}

function addBusyRowsFromQuerySnapshot({
  snap,
  busyRowsByKey,
  academyId,
  packageByTeacherKey,
  rangeStart,
  rangeEnd,
  source,
}) {
  snap.docs.forEach((docSnap) => {
    const row = docSnap.data() || {};
    if (normalizeId(row.academyId) !== academyId) return;
    if (source === "privateLessonReservations" &&
        !isActivePrivateReservation(row)) {
      return;
    }
    if (isCancelledScheduleRow(row)) return;
    const date = normalizeId(row.date || row.scheduleDate);
    const time = normalizeId(row.time || row.startTime || row.scheduleTime);
    if (!isPrivateScheduleDateInRange(date, rangeStart, rangeEnd)) return;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return;
    const teacherKey = getPrivateScheduleTeacherKey(row);
    const packageSummary = packageByTeacherKey.get(teacherKey);
    if (!teacherKey) return;
    const teacherUid = normalizeId(row.teacherUid || row.teacherUID);
    const key = getPrivateSlotConflictKey({
      teacher: teacherKey,
      teacherName: teacherKey,
      teacherUid,
      date,
      time,
    });
    if (busyRowsByKey.has(key)) return;
    busyRowsByKey.set(key, buildBusyPrivateScheduleRow({
      id: `busy__${source}__${docSnap.id}`,
      academyId,
      teacherKey,
      teacherUid,
      teacherName: row.teacherName || row.teacher || teacherKey,
      date,
      time,
      durationMinutes: getPrivateScheduleDurationMinutes(row),
      packageSummary,
      status: source === "privateLessonSlots" ? "reserved" : "busy",
    }));
  });
}

async function loadBusyPrivateScheduleRows(db, {
  academyId,
  teacherKeys,
  packageByTeacherKey,
  rangeStart,
  rangeEnd,
}) {
  const busyRowsByKey = new Map();
  const queryPromises = [];
  for (const chunk of chunkValues(teacherKeys, PRIVATE_SLOT_QUERY_CHUNK_SIZE)) {
    queryPromises.push({
      source: "lessons",
      promise: db
          .collection("lessons")
          .where("academyId", "==", academyId)
          .where("teacherKey", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "lessons",
      promise: db
          .collection("lessons")
          .where("academyId", "==", academyId)
          .where("teacherUid", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "lessons",
      promise: db
          .collection("lessons")
          .where("academyId", "==", academyId)
          .where("teacherUID", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "lessons",
      promise: db
          .collection("lessons")
          .where("academyId", "==", academyId)
          .where("teacherId", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "lessons",
      promise: db
          .collection("lessons")
          .where("academyId", "==", academyId)
          .where("teacher", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "lessons",
      promise: db
          .collection("lessons")
          .where("academyId", "==", academyId)
          .where("teacherName", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "groupLessons",
      promise: db
          .collection("groupLessons")
          .where("academyId", "==", academyId)
          .where("teacherKey", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "groupLessons",
      promise: db
          .collection("groupLessons")
          .where("academyId", "==", academyId)
          .where("teacherUid", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "groupLessons",
      promise: db
          .collection("groupLessons")
          .where("academyId", "==", academyId)
          .where("teacherUID", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "groupLessons",
      promise: db
          .collection("groupLessons")
          .where("academyId", "==", academyId)
          .where("teacherId", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "groupLessons",
      promise: db
          .collection("groupLessons")
          .where("academyId", "==", academyId)
          .where("teacher", "in", chunk)
          .get(),
    });
    queryPromises.push({
      source: "groupLessons",
      promise: db
          .collection("groupLessons")
          .where("academyId", "==", academyId)
          .where("teacherName", "in", chunk)
          .get(),
    });
    [
      "teacherKey",
      "teacherUid",
      "teacherUID",
      "teacherId",
      "teacher",
      "teacherName",
    ].forEach((field) => {
      queryPromises.push({
        source: "privateLessonReservations",
        promise: db
            .collection("privateLessonReservations")
            .where("academyId", "==", academyId)
            .where(field, "in", chunk)
            .where("status", "in", ACTIVE_PRIVATE_RESERVATION_STATUSES)
            .get(),
      });
    });
    ["reserved", "blocked"].forEach((status) => {
      queryPromises.push({
        source: "privateLessonSlots",
        promise: db
            .collection("privateLessonSlots")
            .where("academyId", "==", academyId)
            .where("status", "==", status)
            .where("teacherKey", "in", chunk)
            .get(),
      });
      queryPromises.push({
        source: "privateLessonSlots",
        promise: db
            .collection("privateLessonSlots")
            .where("academyId", "==", academyId)
            .where("status", "==", status)
            .where("teacherUid", "in", chunk)
            .get(),
      });
      queryPromises.push({
        source: "privateLessonSlots",
        promise: db
            .collection("privateLessonSlots")
            .where("academyId", "==", academyId)
            .where("status", "==", status)
            .where("teacherUID", "in", chunk)
            .get(),
      });
      queryPromises.push({
        source: "privateLessonSlots",
        promise: db
            .collection("privateLessonSlots")
            .where("academyId", "==", academyId)
            .where("status", "==", status)
            .where("teacherId", "in", chunk)
            .get(),
      });
      queryPromises.push({
        source: "privateLessonSlots",
        promise: db
            .collection("privateLessonSlots")
            .where("academyId", "==", academyId)
            .where("status", "==", status)
            .where("teacher", "in", chunk)
            .get(),
      });
      queryPromises.push({
        source: "privateLessonSlots",
        promise: db
            .collection("privateLessonSlots")
            .where("academyId", "==", academyId)
            .where("status", "==", status)
            .where("teacherName", "in", chunk)
            .get(),
      });
    });
  }

  const results = await Promise.all(queryPromises.map((item) => item.promise));
  results.forEach((snap, index) => {
    addBusyRowsFromQuerySnapshot({
      snap,
      busyRowsByKey,
      academyId,
      packageByTeacherKey,
      rangeStart,
      rangeEnd,
      source: queryPromises[index].source,
    });
  });
  return busyRowsByKey;
}

function getPackageSummaryByTeacherKey(packageSnap, {
  academyId,
  studentId,
  privateLessons = [],
  privateReservations = [],
  nowMillis = Date.now(),
}) {
  const byTeacherKey = new Map();
  const activePackageIds = [];
  packageSnap.docs.forEach((docSnap) => {
    const packageData = docSnap.data() || {};
    if (normalizeId(packageData.academyId) !== academyId) return;
    if (normalizeId(packageData.studentId) !== studentId) return;
    const packageType = normalizeId(packageData.packageType).toLowerCase();
    const status = normalizeId(packageData.status || "active").toLowerCase();
    if (packageType && packageType !== "private") return;
    if (
      ["inactive", "expired", "ended", "cancelled", "canceled"]
          .includes(status)
    ) {
      return;
    }
    const teacherKey = getPrivatePackageTeacherKey(packageData);
    if (!teacherKey) return;
    const usage = computePrivateTeacherPackageUsage({
      privatePackage: packageData,
      packageId: docSnap.id,
      privateLessons,
      privateReservations,
      academyId,
      studentId,
      teacherKeys: getPrivatePackageTeacherKeys(packageData),
      nowMillis,
    });
    const remainingCount = Number(usage.makeupAvailableCount || 0);
    const safeRemainingCount =
      Number.isFinite(remainingCount) ? remainingCount : 0;
    const summary = {
      packageId: docSnap.id,
      teacherKey,
      remainingCount: safeRemainingCount,
      makeupAvailableCount: safeRemainingCount,
      totalCount: usage.totalCount,
      usedDeductedCount: usage.usedDeductedCount,
      futureFixedAllocatedCount: usage.futureFixedAllocatedCount,
      activeFutureReservationCount:
        usage.activeFutureReservationCount ||
        usage.activeFutureReservationAllocatedCount,
      activeFutureReservationAllocatedCount:
        usage.activeFutureReservationAllocatedCount,
      availableToBook: usage.availableToBook,
      noDeductionReleasedCount: usage.noDeductionReleasedCount,
    };
    const packageTeacherKeys = getPrivatePackageTeacherKeys(packageData);
    packageTeacherKeys.forEach((packageTeacherKey) => {
      const existing = byTeacherKey.get(packageTeacherKey);
      if (!existing || safeRemainingCount > existing.remainingCount) {
        byTeacherKey.set(packageTeacherKey, summary);
      }
    });
    if (safeRemainingCount > 0) activePackageIds.push(docSnap.id);
  });
  return {byTeacherKey, activePackageIds};
}

function getSlotTeacherPackageSummary(slot, packageByTeacherKey) {
  const teacherKeys = getPrivateTeacherScopeKeys(slot);
  for (const teacherKey of teacherKeys) {
    const summary = packageByTeacherKey.get(teacherKey);
    if (summary) return summary;
  }
  return null;
}

function slotMatchesTeacherKeys(slot, teacherKeys) {
  const slotTeacherKeys = getPrivateTeacherScopeKeys(slot);
  return slotTeacherKeys.some((teacherKey) => teacherKeys.includes(teacherKey));
}

function getPrivateSlotConflictKey({
  teacher,
  teacherName,
  teacherKey,
  teacherUid,
  teacherUID,
  date,
  time,
}) {
  const conflictTeacherKey =
    normalizeTeacherKey(teacherKey) ||
    normalizeTeacherKey(teacherUid) ||
    normalizeTeacherKey(teacherUID) ||
    normalizeTeacherKey(teacher) ||
    normalizeTeacherKey(teacherName);
  return `${conflictTeacherKey}__${normalizeId(date)}__${normalizeId(time)}`;
}

function getPrivateRowTeacherKeys(row) {
  return getPrivateTeacherScopeKeys(row);
}

function getPrivateRowStudentId(row) {
  return normalizeId(
      row && (row.studentId || row.studentID || row.studentUid),
  );
}

function privateRowMatchesPackageScope({
  row,
  privatePackage,
  packageId,
  academyId,
  studentId,
  teacherKeys,
  packageIdFields = ["packageId"],
}) {
  if (normalizeId(row && row.academyId) !== academyId) return false;
  if (getPrivateRowStudentId(row) !== studentId) return false;
  const rowPackageIds = packageIdFields
      .map((field) => normalizeId(row && row[field]))
      .filter(Boolean);
  if (rowPackageIds.length > 0) {
    if (packageId && rowPackageIds.includes(packageId)) return true;
  }
  const packageTeacherKeys = teacherKeys && teacherKeys.length > 0 ?
    teacherKeys :
    getPrivatePackageTeacherKeys(privatePackage);
  const rowTeacherKeys = getPrivateRowTeacherKeys(row);
  if (packageTeacherKeys.length === 0) return false;
  if (rowTeacherKeys.length > 0) {
    return rowTeacherKeys.some((key) => packageTeacherKeys.includes(key));
  }
  if (rowPackageIds.length > 0) return false;
  return false;
}

function getPrivateRowStartMillis(row) {
  const explicitStart = getTimestampMillis(row && row.startAt);
  if (explicitStart !== null) return explicitStart;
  return getSeoulDateTimeMillis(
      row && (row.date || row.lessonDate || row.scheduleDate),
      row && (row.time || row.startTime || row.scheduleTime),
  );
}

function getPrivateScheduleTimeRange(row) {
  const startMillis = getPrivateRowStartMillis(row);
  if (startMillis === null) return null;
  const durationMinutes = getPrivateScheduleDurationMinutes(row);
  return {
    startMillis,
    endMillis: startMillis + durationMinutes * 60 * 1000,
  };
}

function privateTeacherScopeKeysOverlap(rowA, rowB) {
  const keysA = getPrivateTeacherScopeKeys(rowA);
  const keysB = getPrivateTeacherScopeKeys(rowB);
  if (keysA.length === 0 || keysB.length === 0) return false;
  return keysA.some((key) => keysB.includes(key));
}

function privateScheduleTimeRangesOverlap(rangeA, rangeB) {
  if (!rangeA || !rangeB) return false;
  return (
    rangeA.startMillis < rangeB.endMillis &&
    rangeB.startMillis < rangeA.endMillis
  );
}

function privateSchedulesOverlap(candidate, existing) {
  if (!candidate || !existing) return false;
  const candidateAcademyId = normalizeId(candidate.academyId);
  const existingAcademyId = normalizeId(existing.academyId);
  if (
    candidateAcademyId &&
    existingAcademyId &&
    candidateAcademyId !== existingAcademyId
  ) {
    return false;
  }
  const candidateRange = getPrivateScheduleTimeRange(candidate);
  const existingRange = getPrivateScheduleTimeRange(existing);
  if (!privateScheduleTimeRangesOverlap(candidateRange, existingRange)) {
    return false;
  }
  return privateTeacherScopeKeysOverlap(candidate, existing);
}

function isTeacherBlockingScheduleRow(row) {
  if (!row) return false;
  if (isCancelledScheduleRow(row)) return false;
  if (isActivePrivateReservation(row)) return true;
  const status = normalizeId(row.status).toLowerCase();
  if (status === "reserved" || status === "blocked" || status === "busy") {
    return true;
  }
  if (status === "open") return false;
  const date = normalizeId(row.date || row.scheduleDate || row.lessonDate);
  const time = normalizeId(row.time || row.startTime || row.scheduleTime);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    /^([01]\d|2[0-3]):([0-5]\d)$/.test(time);
}

function markOverlappingPrivateSlotBusy(slot) {
  if (!slot || slot.bookingStatus === "my_reservation") return slot;
  return {
    ...slot,
    isBusy: true,
    isBookable: false,
    isReservable: false,
    bookingStatus: "busy",
    statusLabel: getPrivateBookingStatusLabel("busy"),
    bookingStatusLabel: getPrivateBookingStatusLabel("busy"),
    studentVisibleStatus: "busy",
    studentVisibleStatusLabel: getPrivateBookingStatusLabel("busy"),
    disabledReason: "busy",
  };
}

function slotOverlapsBusySchedule(slot, busyScheduleRows) {
  if (
    !slot ||
    !Array.isArray(busyScheduleRows) ||
    busyScheduleRows.length === 0
  ) {
    return false;
  }
  return busyScheduleRows.some((busyRow) =>
    privateSchedulesOverlap(slot, busyRow),
  );
}

function isFuturePrivateAllocation(row, nowMillis) {
  const startMillis = getPrivateRowStartMillis(row);
  if (startMillis !== null) return startMillis >= nowMillis;
  const date = normalizeId(
      row && (row.date || row.lessonDate || row.scheduleDate),
  );
  return /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    date >= getSeoulTodayDateString();
}

function isPrivateLessonReleasedFromDeduction(lesson) {
  const status = normalizeId(lesson && lesson.status).toLowerCase();
  const cancellationType = normalizeId(
      lesson && lesson.cancellationType,
  ).toLowerCase();
  const cancelledReason = normalizeId(
      lesson && lesson.cancelledReason,
  ).toLowerCase();
  if (lesson && lesson.isDeductCancelled === true) return true;
  if (lesson && lesson.noDeduction === true) return true;
  if (status === "cancelled" || status === "canceled") return true;
  if (cancellationType === "no_deduction") return true;
  if (cancellationType === "class_closure") return true;
  return [
    "holiday",
    "teacher_unavailable",
    "academy_closed",
  ].includes(cancelledReason);
}

function computePrivateTeacherPackageUsage({
  privatePackage,
  packageId,
  privateLessons = [],
  privateReservations = [],
  academyId,
  studentId,
  teacherKeys = [],
  nowMillis = Date.now(),
}) {
  const totalRaw = Number(privatePackage && privatePackage.totalCount);
  const usedRaw = Number(privatePackage && privatePackage.usedCount);
  const remainingRaw = Number(privatePackage && privatePackage.remainingCount);
  const totalCount = Number.isFinite(totalRaw) && totalRaw > 0 ? totalRaw : 0;
  const usedDeductedCount = Number.isFinite(usedRaw) && usedRaw > 0 ?
    usedRaw :
    0;
  const remainingCount = Number.isFinite(remainingRaw) && remainingRaw > 0 ?
    remainingRaw :
    0;
  const rawAvailableCount = totalCount > 0 ?
    Math.min(remainingCount, Math.max(0, totalCount - usedDeductedCount)) :
    remainingCount;
  const packageTeacherKeys = teacherKeys.length > 0 ?
    teacherKeys :
    getPrivatePackageTeacherKeys(privatePackage);

  let futureFixedAllocatedCount = 0;
  let noDeductionReleasedCount = 0;
  privateLessons.forEach((lesson) => {
    if (!privateRowMatchesPackageScope({
      row: lesson,
      privatePackage,
      packageId,
      academyId,
      studentId,
      teacherKeys: packageTeacherKeys,
    })) {
      return;
    }
    if (isPrivateLessonReleasedFromDeduction(lesson)) {
      noDeductionReleasedCount += 1;
      return;
    }
    if (isFuturePrivateAllocation(lesson, nowMillis)) {
      futureFixedAllocatedCount += 1;
    }
  });

  let activeFutureReservationAllocatedCount = 0;
  privateReservations.forEach((reservation) => {
    if (!isActivePrivateReservation(reservation)) return;
    if (!privateRowMatchesPackageScope({
      row: reservation,
      privatePackage,
      packageId,
      academyId,
      studentId,
      teacherKeys: packageTeacherKeys,
      packageIdFields: ["packageId", "deductionPackageId"],
    })) {
      return;
    }
    activeFutureReservationAllocatedCount += 1;
  });

  const unallocatedRemainingCount =
    rawAvailableCount -
    futureFixedAllocatedCount -
    activeFutureReservationAllocatedCount;
  const availableToBook = Math.max(
      0,
      unallocatedRemainingCount,
  );

  return {
    totalCount,
    usedDeductedCount,
    futureFixedAllocatedCount,
    activeFutureReservationCount: activeFutureReservationAllocatedCount,
    activeFutureReservationAllocatedCount,
    noDeductionReleasedCount,
    availableToBook,
    makeupAvailableCount: availableToBook,
    remainingCount,
  };
}

async function hasTeacherScheduleConflict(transaction, db, {
  academyId,
  teacher,
  teacherName,
  teacherKey: slotTeacherKey,
  teacherUid,
  teacherUID,
  date,
  time,
  durationMinutes,
  ignoredSlotId = "",
}) {
  const teacherKeys = uniqueNormalizedTeacherKeyList([
    teacher,
    teacherName,
    slotTeacherKey,
    teacherUid,
    teacherUID,
  ]);
  const candidate = {
    academyId,
    teacher,
    teacherName,
    teacherKey: slotTeacherKey,
    teacherUid,
    teacherUID,
    date,
    time,
    durationMinutes,
  };
  const queries = [];
  const teacherFields = [
    "teacherKey",
    "teacherUid",
    "teacherUID",
    "teacherId",
    "teacher",
    "teacherName",
  ];
  for (const chunk of chunkValues(teacherKeys, PRIVATE_SLOT_QUERY_CHUNK_SIZE)) {
    teacherFields.forEach((field) => {
      queries.push(transaction.get(
          db
              .collection("lessons")
              .where("academyId", "==", academyId)
              .where(field, "in", chunk),
      ));
      queries.push(transaction.get(
          db
              .collection("privateLessonSlots")
              .where("academyId", "==", academyId)
              .where(field, "in", chunk),
      ));
      queries.push(transaction.get(
          db
              .collection("privateLessonReservations")
              .where("academyId", "==", academyId)
              .where(field, "in", chunk)
              .where("status", "in", ACTIVE_PRIVATE_RESERVATION_STATUSES),
      ));
    });
  }
  queries.push(transaction.get(
      db.collection("groupLessons").where("academyId", "==", academyId),
  ));
  const snaps = await Promise.all(queries);
  for (const snap of snaps) {
    for (const docSnap of snap.docs) {
      if (ignoredSlotId && docSnap.id === ignoredSlotId) continue;
      const row = {id: docSnap.id, ...docSnap.data()};
      if (!isTeacherBlockingScheduleRow(row)) continue;
      if (privateSchedulesOverlap(candidate, row)) return true;
    }
  }
  return false;
}

function buildSlotFromAvailabilityTemplate({templateId, template, date, time}) {
  const teacher =
    normalizeTeacherKey(template.teacherKey || template.teacher) ||
    normalizeTeacherKey(
        template.teacherUid || template.teacherUID || template.teacherId,
    ) ||
    normalizeTeacherKey(template.teacherName);
  const teacherKey = normalizeTeacherKey(template.teacherKey || teacher);
  const teacherUid = normalizeId(
      template.teacherUid || template.teacherUID || template.teacherId,
  );
  const durationMinutes = Number(template.durationMinutes || 60);
  return {
    academyId: normalizeId(template.academyId),
    teacher,
    teacherKey,
    teacherUid,
    teacherId: normalizeId(template.teacherId),
    teacherEmail: normalizeId(template.teacherEmail),
    teacherName: normalizeId(
        template.teacherName || template.teacher || teacher,
    ),
    date,
    time,
    subject: "1:1 수업",
    capacity: 1,
    reservedCount: 0,
    startAt: timestampFromMillis(getSeoulDateTimeMillis(date, time)),
    durationMinutes:
      Number.isFinite(durationMinutes) && durationMinutes > 0 ?
        Math.floor(durationMinutes) :
        60,
    status: "open",
    reservedStudentId: "",
    reservationId: "",
    slotType: "template",
    availabilityTemplateId: templateId,
    isGeneratedFromTemplate: true,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    reservedAt: null,
    cancelledAt: null,
  };
}

function buildTemplateSlots({
  templates,
  academyId,
  packageByTeacherKey,
  teacherKeys,
  conflictKeys,
  conflictSchedules = [],
  nowMillis,
}) {
  const today = getSeoulTodayDateString();
  const currentMonday = getSeoulMondayForDate(today);
  const weeks = [currentMonday, addSeoulDays(currentMonday, 7)];
  const slots = [];
  templates.forEach(({id, data}) => {
    const status = normalizeId(data.status || "active").toLowerCase();
    if (status !== "active") return;
    const teacher = normalizeTeacherKey(
        data.teacherKey || data.teacher || data.teacherUid,
    );
    const packageSummary = packageByTeacherKey.get(teacher);
    if (!teacher || !teacherKeys.includes(teacher)) return;
    const weekday = Number(data.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) return;
    const time = normalizeId(data.time);
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return;
    weeks.forEach((weekStartsOn) => {
      const date = addSeoulDays(weekStartsOn, weekday - 1);
      const startsAt = getSeoulDateTimeMillis(date, time);
      if (startsAt === null || startsAt < nowMillis) return;
      const slot = {
        academyId,
        teacher,
        teacherKey: normalizeTeacherKey(data.teacherKey || teacher),
        teacherUid: normalizeId(
            data.teacherUid || data.teacherUID || data.teacherId,
        ),
        teacherName: normalizeId(data.teacherName || data.teacher || teacher),
        date,
        time,
        subject: "1:1 수업",
        durationMinutes: Number(data.durationMinutes || 60),
        status: "open",
        slotType: "template",
        availabilityTemplateId: id,
        isGeneratedFromTemplate: true,
      };
      const conflictKey = getPrivateSlotConflictKey(slot);
      if (conflictKeys.has(conflictKey)) return;
      if (slotOverlapsBusySchedule(slot, conflictSchedules)) return;
      slots.push({
        slotId: buildPrivateTemplateSlotId({templateId: id, date, time}),
        slot,
        packageSummary,
      });
    });
  });
  return slots;
}

exports.listGroupLessonAvailability = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipSnap = await db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`)
            .get();
        const membership = requireActiveStudentMembership(membershipSnap);
        const studentId = membership.studentId;
        const summarySnap = await db
            .collection("studentGroupAccessSummary")
            .doc(`${academyId}__${studentId}`)
            .get();
        const summary = summarySnap.exists ? summarySnap.data() || {} : {};

        const [
          lessonSnap,
          groupClassesSnap,
          groupStudentsSnap,
          reservationsSnap,
          packagesSnap,
        ] = await Promise.all([
          db.collection("groupLessons")
              .where("academyId", "==", academyId)
              .get(),
          db.collection("groupClasses")
              .where("academyId", "==", academyId)
              .get(),
          db.collection("groupStudents")
              .where("academyId", "==", academyId)
              .get(),
          db.collection("groupLessonReservations")
              .where("academyId", "==", academyId)
              .get(),
          db.collection("studentPackages")
              .where("academyId", "==", academyId)
              .where("studentId", "==", studentId)
              .get(),
        ]);

        const groupStudents = groupStudentsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        const reservations = reservationsSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        const studentGroupTickets = packagesSnap.docs
            .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}))
            .filter((pkg) =>
              normalizeId(pkg.packageType).toLowerCase() === "group" &&
              isPackageActiveForDeduction(pkg),
            );
        const activeGroupClassIds = new Set(
            groupClassesSnap.docs
                .filter((docSnap) => isActiveGroupClass(docSnap.data() || {}))
                .map((docSnap) => docSnap.id),
        );
        const groupClassById = new Map(
            groupClassesSnap.docs.map((docSnap) => [
              docSnap.id,
              {id: docSnap.id, ...docSnap.data()},
            ]),
        );
        const allGroupLessons = lessonSnap.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));
        const fixedTicketLessons = buildFixedGroupTicketLessons({
          groupLessons: allGroupLessons,
          groupStudents,
          studentId,
        });

        const lessons = lessonSnap.docs
            .filter((docSnap) => {
              const lesson = docSnap.data() || {};
              const lessonGroupId = getGroupLessonGroupId(lesson);
              return lesson.isBookable === true &&
                !isCancelledOrDeletedGroupLesson(lesson) &&
                lessonGroupId &&
                activeGroupClassIds.has(lessonGroupId) &&
                hasGroupLessonAccess({summary, lesson, groupClassById});
            })
            .map((docSnap) => {
              const lesson = {id: docSnap.id, ...docSnap.data()};
              const fixedMembers = getFixedMembersForLesson(
                  groupStudents,
                  lesson,
              );
              if (fixedMembers.some((member) =>
                normalizeId(member.studentId) === studentId,
              )) {
                return null;
              }
              const lessonReservations = reservations.filter(
                  (reservation) => reservation.lessonId === docSnap.id,
              );
              const availability = getGroupSeatAvailability({
                lesson,
                fixedMembers,
                reservations: lessonReservations,
              });
              const ticketCandidates = studentGroupTickets
                  .filter((ticket) => groupTicketMatchesScope(ticket, lesson))
                  .sort((a, b) => {
                    const aRemaining = Number(a.remainingCount || 0);
                    const bRemaining = Number(b.remainingCount || 0);
                    if (aRemaining !== bRemaining) {
                      return bRemaining - aRemaining;
                    }
                    const aCreated = getTimestampMillis(a.createdAt) || 0;
                    const bCreated = getTimestampMillis(b.createdAt) || 0;
                    return aCreated - bCreated;
                  });
              const ticket = ticketCandidates[0] || null;
              const balance = computeGroupTicketBalance({
                ticket,
                fixedGroupLessons: fixedTicketLessons,
                groupReservations: reservations,
                academyId,
                studentId,
              });
              const ambiguous = ticketCandidates.length > 1;
              const status = !ticket ?
                (studentGroupTickets.length > 0 ?
                  "scope_missing" :
                  "no_ticket") :
                ambiguous ? "ambiguous" :
                  balance.availableToBook > 0 ? "available" : "no_available";
              return sanitizeGroupLessonForStudent(docSnap, availability, {
                status,
                statusLabel: getGroupTicketStatusLabel({
                  ticket,
                  balance,
                  ambiguous,
                }),
                availableToBook: balance.availableToBook,
                ticketId: ticket && ticket.id,
              });
            })
            .filter(Boolean)
            .sort((a, b) => {
              const aKey = `${a.date || ""} ${a.time || ""} ${a.subject || ""}`;
              const bKey = `${b.date || ""} ${b.time || ""} ${b.subject || ""}`;
              return aKey.localeCompare(bKey, "ko");
            });

        return {lessons};
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.reserveGroupLessonSeat = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const lessonId = requireString(data, "lessonId");
        const groupStudentId = optionalString(data, "groupStudentId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const lessonRef = db.collection("groupLessons").doc(lessonId);

        return await db.runTransaction(async (transaction) => {
          const [membershipSnap, lessonSnap] = await Promise.all([
            transaction.get(membershipRef),
            transaction.get(lessonRef),
          ]);
          const membership = requireActiveAcademyMembership(membershipSnap);
          if (!lessonSnap.exists) {
            throw new HttpsError("not-found", "수업 일정을 찾을 수 없습니다.");
          }

          const lesson = {id: lessonSnap.id, ...lessonSnap.data()};
          if (normalizeId(lesson.academyId) !== academyId) {
            throw new HttpsError("permission-denied", "Academy mismatch.");
          }
          if (lesson.isBookable !== true) {
            throw new HttpsError("failed-precondition", "예약 불가 수업입니다.");
          }
          if (isCancelledOrDeletedGroupLesson(lesson)) {
            throw new HttpsError("failed-precondition", "취소된 수업입니다.");
          }

          const lessonGroupId = getGroupLessonGroupId(lesson);
          if (!lessonGroupId) {
            throw new HttpsError(
                "failed-precondition",
                "수업에 연결된 반 정보를 찾을 수 없습니다.",
            );
          }
          const groupClassSnap = await transaction.get(
              db.collection("groupClasses").doc(lessonGroupId),
          );
          if (!groupClassSnap.exists ||
              normalizeId(groupClassSnap.data().academyId) !== academyId ||
              !isActiveGroupClass(groupClassSnap.data() || {})) {
            throw new HttpsError(
                "failed-precondition",
                "삭제되었거나 비활성화된 반의 수업입니다.",
            );
          }
          let studentId = "";
          let source = "student";
          let studentName = "";
          let groupStudent = null;

          if (membership.role === "student") {
            studentId = membership.studentId;
            if (!studentId) {
              throw new HttpsError(
                  "failed-precondition",
                  "Student membership is not linked to a student.",
              );
            }
            const summaryRef = db
                .collection("studentGroupAccessSummary")
                .doc(`${academyId}__${studentId}`);
            const summarySnap = await transaction.get(summaryRef);
            const summary = summarySnap.exists ? summarySnap.data() || {} : {};
            const reserveAccessGroupClassById = new Map([
              [lessonGroupId, {
                id: groupClassSnap.id,
                ...groupClassSnap.data(),
              }],
            ]);
            if (!hasGroupLessonAccess({
              summary,
              lesson,
              groupClassById: reserveAccessGroupClassById,
            })) {
              throw new HttpsError(
                  "permission-denied",
                  "예약 가능한 반 권한이 없습니다.",
              );
            }
          } else {
            if (!canManageGroupReservations(membership)) {
              throw new HttpsError(
                  "permission-denied",
                  "예약 관리 권한이 없습니다.",
              );
            }
            if (!groupStudentId) {
              throw new HttpsError(
                  "invalid-argument",
                  "groupStudentId is required.",
              );
            }
            const groupStudentRef = db
                .collection("groupStudents")
                .doc(groupStudentId);
            const groupStudentSnap = await transaction.get(groupStudentRef);
            if (!groupStudentSnap.exists) {
              throw new HttpsError(
                  "not-found",
                  "그룹 학생 정보를 찾을 수 없습니다.",
              );
            }
            groupStudent = {
              id: groupStudentSnap.id,
              ...groupStudentSnap.data(),
            };
            if (normalizeId(groupStudent.academyId) !== academyId ||
                getGroupStudentGroupId(groupStudent) !== lessonGroupId) {
              throw new HttpsError("permission-denied", "Academy mismatch.");
            }
            studentId = normalizeId(groupStudent.studentId);
            studentName = normalizeId(
                groupStudent.studentName || groupStudent.name,
            );
            source = "dashboard";
          }

          if (!studentId) {
            throw new HttpsError("invalid-argument", "studentId is required.");
          }

          const reservationRef = db
              .collection("groupLessonReservations")
              .doc(groupLessonReservationDocId({
                academyId,
                lessonId,
                studentId,
              }));
          const reservationSnap = await transaction.get(reservationRef);
          if (reservationSnap.exists &&
              String(reservationSnap.data().status || "") === "active") {
            throw new HttpsError("already-exists", "이미 예약됨");
          }

          const {groupStudentsSnap, reservationsSnap, groupLessonsSnap} =
            await getGroupSeatInputSnaps(transaction, db, academyId);
          const groupStudents = groupStudentsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          const groupLessons = groupLessonsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          const reservations = docsForLesson(reservationsSnap, lessonId);
          const allReservations = reservationsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          const fixedMembers = getFixedMembersForLesson(groupStudents, lesson);
          if (membership.role === "student" &&
              fixedMembers.some((member) =>
                normalizeId(member.studentId) === studentId,
              )) {
            throw new HttpsError(
                "failed-precondition",
                "고정 등록 학생은 추가 예약 대상이 아닙니다.",
            );
          }
          const availability = getGroupSeatAvailability({
            lesson,
            fixedMembers,
            reservations,
          });
          if (availability.remainingSeats <= 0) {
            throw new HttpsError("resource-exhausted", "정원 마감");
          }
          const ticketResult = await getGroupTicketBalanceForLesson({
            transaction,
            db,
            academyId,
            studentId,
            lesson,
            groupLessons,
            groupStudents,
            groupReservations: allReservations,
          });
          if (!ticketResult.ok) {
            throw new HttpsError(
                "failed-precondition",
                getGroupTicketStatusLabel({
                  ticket: ticketResult.ticket && {
                    id: ticketResult.ticket.id,
                    ...ticketResult.ticket.data,
                  },
                  balance: ticketResult.balance,
                  ambiguous: ticketResult.reason === "ambiguous_ticket",
                }),
            );
          }
          if (Number(ticketResult.balance.availableToBook || 0) <= 0) {
            throw new HttpsError(
                "failed-precondition",
                getGroupTicketStatusLabel({
                  ticket: {
                    id: ticketResult.ticket.id,
                    ...ticketResult.ticket.data,
                  },
                  balance: ticketResult.balance,
                }),
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          const existing = reservationSnap.exists ?
            reservationSnap.data() || {} :
            {};
          const reservationData = {
            academyId,
            lessonId,
            groupClassId: lessonGroupId,
            studentId,
            packageId: ticketResult.ticket.id,
            status: "active",
            source,
            createdAt: existing.createdAt || now,
            updatedAt: now,
            cancelledAt: null,
          };
          if (source === "dashboard") {
            reservationData.studentName = studentName || studentId;
            reservationData.teacher = normalizeId(lesson.teacher);
          }

          const activeReservationCount = reservations
              .filter((reservation) => reservation.status === "active")
              .filter((reservation) => reservation.studentId !== studentId)
              .length + 1;
          transaction.set(reservationRef, reservationData, {merge: true});
          transaction.update(lessonRef, {
            bookedCount: activeReservationCount,
            updatedAt: now,
          });

          return {
            remainingSeats: Math.max(0, availability.remainingSeats - 1),
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.cancelGroupLessonSeat = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const lessonId = requireString(data, "lessonId");
        const groupStudentId = optionalString(data, "groupStudentId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const lessonRef = db.collection("groupLessons").doc(lessonId);

        return await db.runTransaction(async (transaction) => {
          const [membershipSnap, lessonSnap] = await Promise.all([
            transaction.get(membershipRef),
            transaction.get(lessonRef),
          ]);
          const membership = requireActiveAcademyMembership(membershipSnap);
          if (!lessonSnap.exists) {
            throw new HttpsError("not-found", "수업 일정을 찾을 수 없습니다.");
          }
          const lesson = {id: lessonSnap.id, ...lessonSnap.data()};
          if (normalizeId(lesson.academyId) !== academyId) {
            throw new HttpsError("permission-denied", "Academy mismatch.");
          }

          let studentId = "";
          if (membership.role === "student") {
            studentId = membership.studentId;
          } else {
            if (!canManageGroupReservations(membership)) {
              throw new HttpsError(
                  "permission-denied",
                  "예약 관리 권한이 없습니다.",
              );
            }
            if (!groupStudentId) {
              throw new HttpsError(
                  "invalid-argument",
                  "groupStudentId is required.",
              );
            }
            const groupStudentSnap = await transaction.get(
                db.collection("groupStudents").doc(groupStudentId),
            );
            if (!groupStudentSnap.exists) {
              throw new HttpsError(
                  "not-found",
                  "그룹 학생 정보를 찾을 수 없습니다.",
              );
            }
            const groupStudent = groupStudentSnap.data() || {};
            if (normalizeId(groupStudent.academyId) !== academyId ||
                getGroupStudentGroupId(groupStudent) !==
                  getGroupLessonGroupId(lesson)) {
              throw new HttpsError("permission-denied", "Academy mismatch.");
            }
            studentId = normalizeId(groupStudent.studentId);
          }

          if (!studentId) {
            throw new HttpsError("invalid-argument", "studentId is required.");
          }

          const reservationRef = db
              .collection("groupLessonReservations")
              .doc(groupLessonReservationDocId({
                academyId,
                lessonId,
                studentId,
              }));
          const reservationSnap = await transaction.get(reservationRef);
          if (!reservationSnap.exists ||
              String(reservationSnap.data().status || "") !== "active") {
            throw new HttpsError(
                "failed-precondition",
                "활성 예약을 찾을 수 없습니다.",
            );
          }
          const reservation = reservationSnap.data() || {};
          if (normalizeId(reservation.academyId) !== academyId ||
              normalizeId(reservation.lessonId) !== lessonId ||
              normalizeId(reservation.studentId) !== studentId) {
            throw new HttpsError("permission-denied", "Academy mismatch.");
          }

          const {reservationsSnap} =
            await getGroupSeatInputSnaps(transaction, db, academyId);
          const reservations = docsForLesson(reservationsSnap, lessonId);
          const activeReservationCount = Math.max(
              0,
              reservations
                  .filter((row) => row.status === "active")
                  .filter((row) => row.studentId !== studentId)
                  .length,
          );
          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(reservationRef, {
            status: "cancelled",
            cancelledAt: now,
            updatedAt: now,
          });
          transaction.update(lessonRef, {
            bookedCount: activeReservationCount,
            updatedAt: now,
          });
          return {remainingActiveReservations: activeReservationCount};
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.releaseGroupLessonFixedSeat = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const lessonId = requireString(data, "lessonId");
        const groupStudentId = requireString(data, "groupStudentId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const lessonRef = db.collection("groupLessons").doc(lessonId);
        const groupStudentRef = db
            .collection("groupStudents")
            .doc(groupStudentId);

        return await db.runTransaction(async (transaction) => {
          const [membershipSnap, lessonSnap, groupStudentSnap] =
            await Promise.all([
              transaction.get(membershipRef),
              transaction.get(lessonRef),
              transaction.get(groupStudentRef),
            ]);
          const membership = requireActiveAcademyMembership(membershipSnap);
          if (!canManageGroupAttendance(membership)) {
            throw new HttpsError(
                "permission-denied",
                "출결 관리 권한이 없습니다.",
            );
          }
          if (!lessonSnap.exists || !groupStudentSnap.exists) {
            throw new HttpsError("not-found", "수업 또는 학생을 찾을 수 없습니다.");
          }
          const lesson = {id: lessonSnap.id, ...lessonSnap.data()};
          const groupStudent = {
            id: groupStudentSnap.id,
            ...groupStudentSnap.data(),
          };
          if (normalizeId(lesson.academyId) !== academyId ||
              normalizeId(groupStudent.academyId) !== academyId ||
              getGroupStudentGroupId(groupStudent) !==
                getGroupLessonGroupId(lesson)) {
            throw new HttpsError("permission-denied", "Academy mismatch.");
          }
          const studentId = normalizeId(groupStudent.studentId);
          if (!studentId) {
            throw new HttpsError("invalid-argument", "studentId is required.");
          }
          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(lessonRef, {
            releasedFixedStudentIDs:
              admin.firestore.FieldValue.arrayUnion(studentId),
            updatedAt: now,
          });
          return {releasedStudentId: studentId};
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.restoreGroupLessonFixedSeat = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const lessonId = requireString(data, "lessonId");
        const groupStudentId = requireString(data, "groupStudentId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const lessonRef = db.collection("groupLessons").doc(lessonId);
        const groupStudentRef = db
            .collection("groupStudents")
            .doc(groupStudentId);

        return await db.runTransaction(async (transaction) => {
          const [membershipSnap, lessonSnap, groupStudentSnap] =
            await Promise.all([
              transaction.get(membershipRef),
              transaction.get(lessonRef),
              transaction.get(groupStudentRef),
            ]);
          const membership = requireActiveAcademyMembership(membershipSnap);
          if (!canManageGroupAttendance(membership)) {
            throw new HttpsError(
                "permission-denied",
                "출결 관리 권한이 없습니다.",
            );
          }
          if (!lessonSnap.exists || !groupStudentSnap.exists) {
            throw new HttpsError("not-found", "수업 또는 학생을 찾을 수 없습니다.");
          }
          const lesson = {id: lessonSnap.id, ...lessonSnap.data()};
          const groupStudent = {
            id: groupStudentSnap.id,
            ...groupStudentSnap.data(),
          };
          if (normalizeId(lesson.academyId) !== academyId ||
              normalizeId(groupStudent.academyId) !== academyId ||
              getGroupStudentGroupId(groupStudent) !==
                getGroupLessonGroupId(lesson)) {
            throw new HttpsError("permission-denied", "Academy mismatch.");
          }
          const studentId = normalizeId(groupStudent.studentId);
          const releasedIds = normalizeIdList(lesson.releasedFixedStudentIDs);
          if (!studentId || !releasedIds.includes(studentId)) {
            throw new HttpsError(
                "failed-precondition",
                "차감취소된 고정 좌석이 아닙니다.",
            );
          }

          const {groupStudentsSnap, reservationsSnap} =
            await getGroupSeatInputSnaps(transaction, db, academyId);
          const groupStudents = groupStudentsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          const reservations = docsForLesson(reservationsSnap, lessonId);
          const fixedMembers = getFixedMembersForLesson(groupStudents, lesson);
          const availability = getGroupSeatAvailability({
            lesson,
            fixedMembers,
            reservations,
          });
          if (availability.remainingSeats <= 0) {
            throw new HttpsError(
                "failed-precondition",
                "이미 추가 예약으로 자리가 채워져 복구할 수 없습니다.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(lessonRef, {
            releasedFixedStudentIDs:
              admin.firestore.FieldValue.arrayRemove(studentId),
            updatedAt: now,
          });
          return {restoredStudentId: studentId};
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.listPrivateLessonSlotAvailability = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const membershipSnap = await membershipRef.get();
        const membership = requireActiveStudentMembership(membershipSnap);
        const studentId = membership.studentId;
        const summaryRef = db
            .collection("studentPrivateAccessSummary")
            .doc(`${academyId}__${studentId}`);
        const statsRef = db
            .collection("studentPrivateBookingStats")
            .doc(`${academyId}__${studentId}`);
        const [
          summarySnap,
          statsSnap,
          packageSnap,
          privateLessonsSnap,
          privateReservationsSnap,
        ] = await Promise.all([
          summaryRef.get(),
          statsRef.get(),
          db
              .collection("studentPackages")
              .where("academyId", "==", academyId)
              .where("studentId", "==", studentId)
              .get(),
          db
              .collection("lessons")
              .where("academyId", "==", academyId)
              .where("studentId", "==", studentId)
              .get(),
          db
              .collection("privateLessonReservations")
              .where("academyId", "==", academyId)
              .where("studentId", "==", studentId)
              .get(),
        ]);
        const summary = summarySnap.exists ? summarySnap.data() || {} : null;
        const nowMillis = Date.now();
        const packageSummary = getPackageSummaryByTeacherKey(packageSnap, {
          academyId,
          studentId,
          privateLessons: privateLessonsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })),
          privateReservations: privateReservationsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          })),
          nowMillis,
        });
        const packageTeacherKeys = Array.from(
            packageSummary.byTeacherKey.keys(),
        );
        const packageIds = packageSummary.activePackageIds;

        const teacherKeys = uniqueNormalizedTeacherKeyList(
            summary && summary.teacherKeys,
            packageTeacherKeys,
        );
        const activePackageIds = uniqueNormalizedIdList(
            summary && summary.activePackageIds,
            packageIds,
        );
        const effectiveSummary = {
          ...(summary || {}),
          teacherKeys,
          activePackageIds,
        };
        const allowedSlotIds = uniqueNormalizedIdList(
            summary && summary.allowedSlotIds,
            summary && summary.allowedPrivateLessonSlotIds,
        );
        const hasTeacherPackageAccess = teacherKeys.length > 0;
        const bookingEnabled = isPrivateSlotAvailabilityBookingEnabled(data);
        const pilotBookable =
          summary && summary.privateSlotBookingPilotEnabled === true;
        const today = getSeoulTodayDateString();
        const currentMonday = getSeoulMondayForDate(today);
        const rangeStart = currentMonday;
        const rangeEnd = addSeoulDays(currentMonday, 12);
        const byId = new Map();

        const addVisibleSlot = (docSnap) => {
          if (!docSnap.exists) return;
          const slot = docSnap.data() || {};
          const slotId = docSnap.id;
          const status = String(slot.status || "").trim();
          const date = normalizeId(slot.date);
          if (normalizeId(slot.academyId) !== academyId) return;
          if (!(status === "open" ||
            status === "reserved" ||
            status === "blocked")) {
            return;
          }
          if (!isPrivateScheduleDateInRange(date, rangeStart, rangeEnd)) {
            return;
          }
          const matchingPackage = getSlotTeacherPackageSummary(
              slot,
              packageSummary.byTeacherKey,
          );
          const hasTeacherScheduleAccess = slotMatchesTeacherKeys(
              slot,
              teacherKeys,
          );
          const hasAccess = hasSlotAccess({
            slot,
            summary: effectiveSummary,
            slotId,
            studentId,
          });
          if (hasExplicitSlotEligibility(slot) && !hasAccess) {
            return;
          }
          if (!hasAccess && !matchingPackage && !hasTeacherScheduleAccess) {
            return;
          }
          byId.set(slotId, slot);
        };

        if (hasTeacherPackageAccess) {
          const queryPromises = [];
          ["open", "reserved", "blocked"].forEach((status) => {
            chunkValues(teacherKeys, PRIVATE_SLOT_QUERY_CHUNK_SIZE)
                .forEach((chunk) => {
                  queryPromises.push(
                      db
                          .collection("privateLessonSlots")
                          .where("academyId", "==", academyId)
                          .where("status", "==", status)
                          .where("teacherKey", "in", chunk)
                          .get(),
                  );
                  queryPromises.push(
                      db
                          .collection("privateLessonSlots")
                          .where("academyId", "==", academyId)
                          .where("status", "==", status)
                          .where("teacherUid", "in", chunk)
                          .get(),
                  );
                  queryPromises.push(
                      db
                          .collection("privateLessonSlots")
                          .where("academyId", "==", academyId)
                          .where("status", "==", status)
                          .where("teacherUID", "in", chunk)
                          .get(),
                  );
                  queryPromises.push(
                      db
                          .collection("privateLessonSlots")
                          .where("academyId", "==", academyId)
                          .where("status", "==", status)
                          .where("teacherId", "in", chunk)
                          .get(),
                  );
                  queryPromises.push(
                      db
                          .collection("privateLessonSlots")
                          .where("academyId", "==", academyId)
                          .where("status", "==", status)
                          .where("teacher", "in", chunk)
                          .get(),
                  );
                  queryPromises.push(
                      db
                          .collection("privateLessonSlots")
                          .where("academyId", "==", academyId)
                          .where("status", "==", status)
                          .where("teacherName", "in", chunk)
                          .get(),
                  );
                });
          });
          const snaps = await Promise.all(queryPromises);
          snaps.forEach((snap) => {
            snap.docs.forEach((docSnap) => addVisibleSlot(docSnap));
          });
        }

        if (allowedSlotIds.length > 0) {
          const directSnaps = await Promise.all(
              allowedSlotIds.map((slotId) =>
                db.collection("privateLessonSlots").doc(slotId).get(),
              ),
          );
          directSnaps.forEach((docSnap) => addVisibleSlot(docSnap));
        }

        const visibleSlotEntries = Array.from(byId.entries());
        const activeReservationBySlotId = new Map();
        await Promise.all(
            visibleSlotEntries.map(async ([slotId, slot]) => {
              if (String(slot.status || "").trim() !== "reserved") return;
              const reservationId = normalizeId(slot.reservationId);
              if (!reservationId) return;
              const reservationSnap = await db
                  .collection("privateLessonReservations")
                  .doc(reservationId)
                  .get();
              if (!reservationSnap.exists) return;
              const reservation = reservationSnap.data() || {};
              if (
                normalizeId(reservation.academyId) === academyId &&
                normalizeId(reservation.slotId) === slotId &&
                isActivePrivateReservation(reservation)
              ) {
                activeReservationBySlotId.set(slotId, reservation);
              }
            }),
        );

        let manualSlots = visibleSlotEntries
            .filter(([slotId, slot]) => {
              const status = String(slot.status || "").trim();
              if (status === "open") {
                return true;
              }
              if (status !== "reserved") return false;
              const reservation = activeReservationBySlotId.get(slotId);
              return normalizeId(reservation && reservation.studentId) ===
                studentId;
            })
            .map(([slotId, slot]) =>
              sanitizePrivateSlotAvailabilityRow({
                slotId,
                slot,
                bookingEnabled,
                pilotBookable,
                activeReservation: activeReservationBySlotId.get(slotId) ||
                  null,
                packageSummary: getSlotTeacherPackageSummary(
                    slot,
                    packageSummary.byTeacherKey,
                ),
                studentId,
                nowMillis,
              }),
            );

        const busyRowsByKey = teacherKeys.length > 0 ?
          await loadBusyPrivateScheduleRows(db, {
            academyId,
            teacherKeys,
            packageByTeacherKey: packageSummary.byTeacherKey,
            rangeStart,
            rangeEnd,
          }) :
          new Map();
        manualSlots = manualSlots.filter((row) => {
          const key = getPrivateSlotConflictKey(row || {});
          if (!key) return true;
          if (row.bookingStatus === "my_reservation") {
            busyRowsByKey.delete(key);
            return true;
          }
          return !busyRowsByKey.has(key);
        });
        const busyScheduleRows = Array.from(busyRowsByKey.values());
        manualSlots = manualSlots.map((row) => {
          if (row.bookingStatus === "my_reservation") return row;
          if (!slotOverlapsBusySchedule(row, busyScheduleRows)) return row;
          return markOverlappingPrivateSlotBusy(row);
        });

        const templateRows = [];
        if (teacherKeys.length > 0) {
          const templateSnap = await db
              .collection("privateLessonAvailabilityTemplates")
              .where("academyId", "==", academyId)
              .get();
          const templates = templateSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            data: docSnap.data() || {},
          }));
          const conflictKeys = new Set(busyRowsByKey.keys());
          visibleSlotEntries.forEach(([, slot]) => {
            conflictKeys.add(getPrivateSlotConflictKey(slot || {}));
          });
          buildTemplateSlots({
            templates,
            academyId,
            packageByTeacherKey: packageSummary.byTeacherKey,
            teacherKeys,
            conflictKeys,
            conflictSchedules: busyScheduleRows,
            nowMillis,
          }).forEach(({slotId, slot, packageSummary: slotPackageSummary}) => {
            templateRows.push(sanitizePrivateSlotAvailabilityRow({
              slotId,
              slot,
              bookingEnabled,
              pilotBookable,
              packageSummary: slotPackageSummary,
              studentId,
              nowMillis,
            }));
          });
        }

        const slots = [
          ...manualSlots,
          ...templateRows,
          ...Array.from(busyRowsByKey.values()),
        ]
            .sort((a, b) => {
              const aKey = `${a.date || ""} ${a.time || ""} ${a.teacher || ""}`;
              const bKey = `${b.date || ""} ${b.time || ""} ${b.teacher || ""}`;
              return aKey.localeCompare(bKey, "ko");
            })
            .slice(0, PRIVATE_SLOT_AVAILABILITY_LIMIT);

        const cancelAllowance = resolveStudentPrivateCancelAllowance(
            statsSnap.exists ? statsSnap.data() : {},
        );

        return {ok: true, academyId, slots, cancelAllowance};
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.reservePrivateLessonSlot = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const data = request.data || {};
        requirePrivateSlotReservationEnabled(data);
        const academyId = requireString(data, "academyId");
        const slotId = requireString(data, "slotId");
        const availabilityTemplateId = optionalString(
            data,
            "availabilityTemplateId",
        );
        const requestedDate = optionalString(data, "date");
        const requestedTime = optionalString(data, "time");
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

          let slot = slotSnap.exists ? slotSnap.data() || {} : null;
          let shouldCreateGeneratedSlot = false;
          if (
            !slot &&
            availabilityTemplateId &&
            requestedDate &&
            requestedTime
          ) {
            const templateRef = db
                .collection("privateLessonAvailabilityTemplates")
                .doc(availabilityTemplateId);
            const templateSnap = await transaction.get(templateRef);
            if (!templateSnap.exists) {
              throw new HttpsError("not-found", "slot-not-available");
            }
            const template = templateSnap.data() || {};
            if (
              normalizeId(template.academyId) !== academyId ||
              normalizeId(template.status || "active") !== "active"
            ) {
              throw new HttpsError("failed-precondition", "slot-not-available");
            }
            const weekday = getSeoulWeekday(requestedDate);
            if (weekday !== Number(template.weekday)) {
              throw new HttpsError("failed-precondition", "slot-not-available");
            }
            if (normalizeId(template.time) !== requestedTime) {
              throw new HttpsError("failed-precondition", "slot-not-available");
            }
            const expectedSlotId = buildPrivateTemplateSlotId({
              templateId: availabilityTemplateId,
              date: requestedDate,
              time: requestedTime,
            });
            if (expectedSlotId !== slotId) {
              throw new HttpsError("failed-precondition", "slot-not-available");
            }
            slot = buildSlotFromAvailabilityTemplate({
              templateId: availabilityTemplateId,
              template,
              date: requestedDate,
              time: requestedTime,
            });
            shouldCreateGeneratedSlot = true;
          }
          if (!slot) {
            throw new HttpsError("not-found", "slot-not-available");
          }
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
          const date = requireString(slot, "date");
          const time = requireString(slot, "time");
          const teacher = requireString(slot, "teacher");
          const window = computePrivateBookingWindow(slot);
          if (!window || window.weekday < 1 || window.weekday > 6) {
            throw new HttpsError("failed-precondition", "slot-not-available");
          }
          const nowMillis = Date.now();
          if (nowMillis < window.bookingOpensAt) {
            throw new HttpsError("failed-precondition", "not-open-yet");
          }
          if (nowMillis >= window.bookingClosesAt) {
            throw new HttpsError("failed-precondition", "booking-closed");
          }
          const teacherKey = normalizeTeacherKey(teacher);
          const teacherKeys = uniqueNormalizedTeacherKeyList([
            teacher,
            slot.teacherName,
            slot.teacherKey,
            slot.teacherUid,
            slot.teacherUID,
          ]);
          const packageResult = await findUsablePrivatePackageForTeacher({
            transaction,
            db,
            academyId,
            studentId,
            teacherKey,
            teacherKeys,
            candidatePackageIds: summary && summary.activePackageIds,
          });
          const hasAccess = hasSlotAccess({slot, summary, slotId, studentId});

          if (hasExplicitSlotEligibility(slot) && !hasAccess) {
            throw new HttpsError(
                "permission-denied",
                "Student is not eligible for this private lesson slot.",
            );
          }

          if (!hasAccess && !packageResult.ok) {
            throw new HttpsError(
                "permission-denied",
                "Student is not eligible for this private lesson slot.",
            );
          }

          if (!packageResult.ok) {
            throw new HttpsError(
                "failed-precondition",
                packageResult.reason === "no_remaining_matching_package" ?
                  "no-remaining-package" :
                  packageResult.reason ||
                    "no-remaining-package",
            );
          }
          const [packageLessonsSnap, packageReservationsSnap] =
            await Promise.all([
              transaction.get(
                  db
                      .collection("lessons")
                      .where("academyId", "==", academyId)
                      .where("studentId", "==", studentId),
              ),
              transaction.get(
                  db
                      .collection("privateLessonReservations")
                      .where("academyId", "==", academyId)
                      .where("studentId", "==", studentId),
              ),
            ]);
          const usage = computePrivateTeacherPackageUsage({
            privatePackage: packageResult.data,
            packageId: packageResult.id,
            privateLessons: packageLessonsSnap.docs.map((docSnap) => ({
              id: docSnap.id,
              ...docSnap.data(),
            })),
            privateReservations: packageReservationsSnap.docs.map(
                (docSnap) => ({
                  id: docSnap.id,
                  ...docSnap.data(),
                }),
            ),
            academyId,
            studentId,
            teacherKeys,
            nowMillis,
          });
          if (usage.makeupAvailableCount <= 0) {
            throw new HttpsError(
                "failed-precondition",
                "no-makeup-available",
            );
          }
          const hasTeacherConflict = await hasTeacherScheduleConflict(
              transaction,
              db,
              {
                academyId,
                teacher,
                teacherName: slot.teacherName,
                teacherKey: slot.teacherKey,
                teacherUid: slot.teacherUid || slot.teacherUID,
                teacherUID: slot.teacherUID,
                date,
                time,
                durationMinutes: getPrivateScheduleDurationMinutes(slot),
                ignoredSlotId: slotSnap.exists ? slotId : "",
              },
          );
          if (hasTeacherConflict) {
            throw new HttpsError("failed-precondition", "slot-not-available");
          }
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
            sourceType:
              slot.releasedFromFixed === true ||
              normalizeId(slot.slotType) === "released_fixed" ?
                "released_fixed_slot" :
                "open_booking",
            packageId: packageResult.id,
            reservedAt: now,
            cancelledAt: null,
            createdAt:
              existingReservation && existingReservation.createdAt ?
                existingReservation.createdAt :
                now,
            updatedAt: now,
          };
          const teacherName = getOptionalSlotString(slot, "teacherName");
          const slotTeacherKey = getOptionalSlotString(slot, "teacherKey");
          const slotTeacherUid =
            getOptionalSlotString(slot, "teacherUid") ||
            getOptionalSlotString(slot, "teacherUID") ||
            getOptionalSlotString(slot, "teacherId");
          const slotTeacherId = getOptionalSlotString(slot, "teacherId");
          const slotTeacherEmail = getOptionalSlotString(slot, "teacherEmail");
          const subject = getOptionalSlotString(slot, "subject");
          const studentName = getOptionalStudentName({student, membership});
          if (teacherName) reservationData.teacherName = teacherName;
          if (slotTeacherKey) reservationData.teacherKey = slotTeacherKey;
          if (slotTeacherUid) reservationData.teacherUid = slotTeacherUid;
          if (slotTeacherId) reservationData.teacherId = slotTeacherId;
          if (slotTeacherEmail) reservationData.teacherEmail = slotTeacherEmail;
          if (subject) reservationData.subject = subject;
          if (studentName) reservationData.studentName = studentName;

          transaction.set(reservationRef, reservationData, {merge: true});
          const slotReservationUpdate = {
            status: "reserved",
            reservedStudentId: studentId,
            reservationId,
            reservedAt: now,
            updatedAt: now,
            reservedCount: 1,
          };
          if (shouldCreateGeneratedSlot) {
            transaction.set(slotRef, {
              ...slot,
              createdByUid: uid,
              createdAt: now,
              ...slotReservationUpdate,
            });
          } else {
            transaction.update(slotRef, slotReservationUpdate);
          }
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
        const data = request.data || {};
        requirePrivateSlotReservationEnabled(data);
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
          const allowance = resolveStudentPrivateCancelAllowance(stats);
          if (allowance.studentCancelCount >= allowance.studentCancelLimit) {
            throw new HttpsError(
                "failed-precondition",
                "1:1 예약 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(
              reservationRef,
              buildCancelledPrivateReservationUpdates({
                now,
                uid,
                studentId,
              }),
          );
          transaction.set(statsRef, {
            academyId,
            studentId,
            studentCancelCount: allowance.studentCancelCount + 1,
            createdAt:
              statsSnap.exists && stats.createdAt ? stats.createdAt : now,
            updatedAt: now,
          }, {merge: true});

          if (normalizeId(slot.reservationId) === reservationId) {
            transaction.update(slotRef, buildReleasedPrivateSlotUpdates({
              slot,
              reservation,
              studentId,
              now,
            }));
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

exports.adminCancelPrivateLessonReservation = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const slotId = requireString(data, "slotId");
        const studentId = requireString(data, "studentId");
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        await requireAcademyAdmin(db, academyId, uid);

        const reservationId = privateReservationDocId({
          academyId,
          slotId,
          studentId,
        });
        const slotRef = db.collection("privateLessonSlots").doc(slotId);
        const reservationRef = db
            .collection("privateLessonReservations")
            .doc(reservationId);

        return await db.runTransaction(async (transaction) => {
          const [slotSnap, reservationSnap] = await Promise.all([
            transaction.get(slotRef),
            transaction.get(reservationRef),
          ]);
          if (!slotSnap.exists) {
            throw new HttpsError(
                "not-found",
                "Private lesson slot not found.",
            );
          }
          if (!reservationSnap.exists) {
            throw new HttpsError(
                "not-found",
                "Active private reservation not found.",
            );
          }

          const slot = slotSnap.data() || {};
          const reservation = reservationSnap.data() || {};
          if (normalizeId(slot.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private lesson slot academy mismatch.",
            );
          }
          if (normalizeId(reservation.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private reservation academy mismatch.",
            );
          }
          if (normalizeId(reservation.studentId) !== studentId) {
            throw new HttpsError(
                "permission-denied",
                "Private reservation student mismatch.",
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
          if (
            normalizeId(slot.reservationId) &&
            normalizeId(slot.reservationId) !== reservationId
          ) {
            throw new HttpsError(
                "failed-precondition",
                "Private slot reservation mismatch.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(
              reservationRef,
              buildCancelledPrivateReservationUpdates({
                now,
                uid,
                studentId,
                cancelledBy: "admin",
                cancellationReason: "admin_cancelled",
              }),
          );
          if (normalizeId(slot.reservationId) === reservationId) {
            transaction.update(slotRef, buildAdminCancelledPrivateSlotUpdates({
              now,
            }));
          }

          return {ok: true, academyId, slotId, studentId, reservationId};
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.updateStudentPrivateCancelAllowance = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const studentId = requireString(data, "studentId");
        const studentCancelLimit = parseStudentCancelLimitInput(
            data.studentCancelLimit,
        );
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        await requireAcademyAdmin(db, academyId, uid);

        const studentSnap = await db
            .collection("privateStudents")
            .doc(studentId)
            .get();
        if (!studentSnap.exists) {
          throw new HttpsError("not-found", "Student not found.");
        }
        const studentData = studentSnap.data() || {};
        if (normalizeId(studentData.academyId) !== academyId) {
          throw new HttpsError(
              "permission-denied",
              "Student does not belong to academy.",
          );
        }

        const statsRef = db
            .collection("studentPrivateBookingStats")
            .doc(`${academyId}__${studentId}`);
        const statsSnap = await statsRef.get();
        const stats = statsSnap.exists ? statsSnap.data() || {} : {};
        const allowance = resolveStudentPrivateCancelAllowance(stats);
        if (studentCancelLimit < allowance.studentCancelCount) {
          throw new HttpsError(
              "failed-precondition",
              "studentCancelLimit cannot be less than current " +
              "studentCancelCount.",
          );
        }

        const actorEmail = String(request.auth.token.email || "").trim();
        const now = admin.firestore.FieldValue.serverTimestamp();
        await statsRef.set({
          academyId,
          studentId,
          studentCancelLimit,
          updatedAt: now,
          updatedBy: uid,
          updatedByEmail: actorEmail,
        }, {merge: true});

        return {
          ok: true,
          studentId,
          studentCancelCount: allowance.studentCancelCount,
          studentCancelLimit,
          remainingCancelCount: Math.max(
              0,
              studentCancelLimit - allowance.studentCancelCount,
          ),
        };
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.autoDeductPendingLessons = onSchedule(
    {
      region: REGION,
      schedule: "30 0 * * *",
      timeZone: "Asia/Seoul",
    },
    async () => {
      if (!isEnabledFlag(process.env.AUTO_DEDUCT_LESSONS_ENABLED)) {
        console.log("autoDeductPendingLessons disabled");
        return {disabled: true};
      }
      const summary = await runAutoDeductPendingLessons({
        lookbackDays: Number(process.env.AUTO_DEDUCT_LOOKBACK_DAYS || 3),
      });
      console.log("autoDeductPendingLessons summary", summary);
      return summary;
    },
);

exports.runAutoDeductPendingLessonsForTest = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        if (getRuntimeProjectId() !== "miami-e2e") {
          throw new HttpsError(
              "failed-precondition",
              "Test auto deduction callable is e2e-only.",
          );
        }
        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        validateAcademyId(academyId);
        await requireAcademyAdmin(
            admin.firestore(),
            academyId,
            request.auth.uid,
        );
        const dates = Array.isArray(data.dates) ?
          data.dates.map((date) => normalizeId(date)).filter(Boolean) :
          null;
        return await runAutoDeductPendingLessons({
          academyId,
          dates,
          todayYmd: optionalString(data, "todayYmd") || getKstDateString(),
          lookbackDays: Number(data.lookbackDays || 3),
          dryRun: data.dryRun === true,
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
        const outcomeActor =
          await canMarkPrivateReservationOutcome(db, academyId, uid);

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
          const endMillis = getPrivateReservationEndMillis(reservation, slot);
          if (endMillis === null) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation schedule is missing.",
            );
          }
          if (Date.now() < endMillis) {
            throw new HttpsError(
                "failed-precondition",
                "수업 종료 후에만 완료/노쇼 처리를 할 수 있습니다.",
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
          const deductionAttemptNumber =
            normalizePositiveAttempt(reservation.deductionAttemptNumber) + 1;
          const creditTransactionId = buildDeductionKey({
            academyId,
            lessonId: reservationId,
            studentId,
            packageId: packageRef.id,
          });
          const creditRef = db
              .collection("creditTransactions")
              .doc(creditTransactionId);
          const creditSnap = await transaction.get(creditRef);
          if (creditSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation deduction was already applied.",
            );
          }
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
            deductionTransactionId: creditTransactionId,
            deductionSource: "manual",
            deductionStatus: "deducted",
            deductionAttemptNumber,
            outcomeByUid: uid,
            outcomeActorRole: outcomeActor.actorRole,
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
            actorRole: outcomeActor.actorRole,
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

exports.updateTeacherStudentPackageCounts = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const packageId = requireString(data, "packageId");
        const totalCount = parsePackageTotalCount(data.totalCount);
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const packageRef = db.collection("studentPackages").doc(packageId);
        const [membershipSnap, packageSnap] = await Promise.all([
          membershipRef.get(),
          packageRef.get(),
        ]);
        const membership = requireTeacherPackageCountEditor(membershipSnap);
        if (!packageSnap.exists) {
          throw new HttpsError("not-found", "Student package not found.");
        }

        const pkg = packageSnap.data() || {};
        if (normalizeId(pkg.academyId) !== academyId) {
          throw new HttpsError(
              "permission-denied",
              "Student package academy mismatch.",
          );
        }

        const packageTeacher = normalizeId(pkg.teacher || pkg.teacherName);
        if (!packageTeacher || packageTeacher !== membership.teacherName) {
          throw new HttpsError(
              "permission-denied",
              "Only own teacher-scoped packages can be edited.",
          );
        }

        const usedCount = Number(pkg.usedCount || 0);
        if (!Number.isFinite(usedCount) || usedCount < 0) {
          throw new HttpsError(
              "failed-precondition",
              "Student package usedCount is invalid.",
          );
        }
        if (totalCount < usedCount) {
          throw new HttpsError(
              "failed-precondition",
              "totalCount cannot be less than usedCount.",
          );
        }

        const remainingCount = Math.max(0, totalCount - usedCount);
        await packageRef.update({
          totalCount,
          remainingCount,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {ok: true, totalCount, remainingCount};
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.reversePrivateReservationOutcome = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const reservationId = requireString(data, "reservationId");
        const reason = requireString(data, "reason");
        validateAcademyId(academyId);
        if (reason.length < 2) {
          throw new HttpsError(
              "invalid-argument",
              "취소 사유를 2자 이상 입력해 주세요.",
          );
        }

        const db = admin.firestore();
        const uid = request.auth.uid;
        const outcomeActor =
          await canMarkPrivateReservationOutcome(db, academyId, uid);
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

          const previousOutcomeStatus = String(reservation.status || "")
              .trim();
          if (!["completed", "no_show"].includes(previousOutcomeStatus)) {
            throw new HttpsError(
                "failed-precondition",
                "완료/노쇼 처리된 1:1 예약만 취소할 수 있습니다.",
            );
          }
          const deductionPackageId = normalizeId(
              reservation.deductionPackageId,
          );
          if (
            reservation.deductionApplied !== true ||
            !deductionPackageId
          ) {
            throw new HttpsError(
                "failed-precondition",
                "차감된 1:1 예약만 처리 취소할 수 있습니다.",
            );
          }

          const studentId = normalizeId(reservation.studentId);
          if (!studentId) {
            throw new HttpsError(
                "failed-precondition",
                "Private reservation is missing student linkage.",
            );
          }

          const packageRef = db
              .collection("studentPackages")
              .doc(deductionPackageId);
          const studentRef = db.collection("privateStudents").doc(studentId);
          const slotId = normalizeId(reservation.slotId);
          const slotRef = slotId ?
            db.collection("privateLessonSlots").doc(slotId) :
            null;
          const [packageSnap, studentSnap, slotSnap] = await Promise.all([
            transaction.get(packageRef),
            transaction.get(studentRef),
            slotRef ? transaction.get(slotRef) : Promise.resolve(null),
          ]);
          if (!packageSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "Linked private package not found.",
            );
          }
          const packageData = packageSnap.data() || {};
          const student = studentSnap.exists ? studentSnap.data() || {} : null;
          const slot = slotSnap && slotSnap.exists ?
            slotSnap.data() || {} :
            null;
          if (normalizeId(packageData.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Package academy mismatch.",
            );
          }
          if (normalizeId(packageData.studentId) !== studentId) {
            throw new HttpsError(
                "failed-precondition",
                "Linked private package does not match reservation.",
            );
          }
          if (student && normalizeId(student.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Student academy mismatch.",
            );
          }
          if (slot && normalizeId(slot.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Private lesson slot academy mismatch.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          const usedBefore = Number(packageData.usedCount || 0);
          const remainingBefore = Number(packageData.remainingCount || 0);
          const totalCount = Number(packageData.totalCount);
          const usedAfter = Math.max(
              0,
              Number.isFinite(usedBefore) ? usedBefore - 1 : 0,
          );
          const restoredRemaining = (
            Number.isFinite(remainingBefore) ? remainingBefore : 0
          ) + 1;
          const remainingAfter =
            Number.isFinite(totalCount) && totalCount >= 0 ?
              Math.min(totalCount, restoredRemaining) :
              restoredRemaining;
          const nextPackageStatus = getNextStudentPackageStatus(
              packageData.status,
              remainingAfter,
          );
          const reversalAttemptNumber =
            normalizePositiveAttempt(reservation.reversalAttemptNumber) + 1;
          const creditTransactionId =
            `privateReservationDeductionReversal__${reservationId}__` +
            `${reversalAttemptNumber}`;
          const creditRef = db
              .collection("creditTransactions")
              .doc(creditTransactionId);
          const teacher = getReservationTeacherKey(reservation, slot);
          const studentName =
            getOptionalStudentName({student, membership: null, reservation}) ||
            studentId;
          const actionType = previousOutcomeStatus === "completed" ?
            "private_reservation_completed_deduct_reversal" :
            "private_reservation_no_show_deduct_reversal";

          transaction.update(packageRef, {
            usedCount: usedAfter,
            remainingCount: remainingAfter,
            status: nextPackageStatus,
            updatedAt: now,
          });
          transaction.update(reservationRef, {
            status: "active",
            deductionApplied: false,
            outcomeReversedAt: now,
            outcomeReversedByUid: uid,
            outcomeReversalReason: reason,
            previousOutcomeStatus,
            reversalAttemptNumber,
            reversalCreditTransactionId: creditTransactionId,
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
            deltaCount: 1,
            memo: `1:1 예약 처리 취소: ${reason}`,
            actorUid: uid,
            actorRole: outcomeActor.actorRole,
            reversalReason: reason,
            createdAt: now,
          }, {merge: false});

          return {
            ok: true,
            academyId,
            reservationId,
            previousOutcomeStatus,
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
