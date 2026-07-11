/* eslint-disable require-jsdoc */
const {setGlobalOptions} = require("firebase-functions/v2");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const crypto = require("crypto");
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
const PRODUCTION_PROJECT_ID = "daegu-miami-production";
const E2E_PROJECT_ID = "miami-e2e";
const STUDENT_PRIVATE_CANCEL_LIMIT = 2;
const STUDENT_PRIVATE_CANCEL_LIMIT_MAX = 24;
const STUDENT_PRIVATE_CANCEL_CUTOFF_MS = 10 * 60 * 60 * 1000;
const PRIVATE_PACKAGE_CANCEL_UNIT_COUNT = 4;
const PRIVATE_SLOT_BOOKING_CUTOFF_MS = 7 * 60 * 60 * 1000;
const PRIVATE_SLOT_AVAILABILITY_LIMIT = 100;
const PRIVATE_SLOT_QUERY_CHUNK_SIZE = 10;
const PRIVATE_TEMPLATE_SLOT_PREFIX = "template";
const FIXED_PRIVATE_RENEWAL_MAX_ASSIGNABLE_COUNT = 52;

const GROUP_COURSE_TYPE_CANONICAL = [
  "일반 영어회화",
  "초급 영어회화",
  "중급 영어회화",
  "고급 영어회화",
  "시험/특강",
];

const LEGACY_GROUP_COURSE_TYPE_TO_CANONICAL = {
  "general_conversation": "일반 영어회화",
  "beginner_conversation": "초급 영어회화",
  "intermediate_conversation": "중급 영어회화",
  "free_talking": "일반 영어회화",
  "프리토킹": "일반 영어회화",
};

function normalizeGroupCourseTypeValue(value) {
  const normalized = normalizeId(value);
  if (GROUP_COURSE_TYPE_CANONICAL.includes(normalized)) return normalized;
  return LEGACY_GROUP_COURSE_TYPE_TO_CANONICAL[normalized] || normalized;
}

function groupCourseTypesEqual(left, right) {
  return normalizeGroupCourseTypeValue(left) ===
    normalizeGroupCourseTypeValue(right);
}
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const PRIVATE_SLOT_BOOKING_NOT_READY_MESSAGE =
  "1:1 예약 기능은 아직 선택된 학생에게만 제공됩니다.";
const HOSTED_APP_URL_BY_PROJECT_ID = {
  [PRODUCTION_PROJECT_ID]: "https://daegumiami.com",
  [E2E_PROJECT_ID]: "https://miami-e2e.web.app",
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

function isProductionProject() {
  return getRuntimeProjectId() === PRODUCTION_PROJECT_ID;
}

function isE2eProject() {
  return getRuntimeProjectId() === E2E_PROJECT_ID;
}

function requireE2eTestProject() {
  if (isE2eProject()) return;
  throw new HttpsError(
      isProductionProject() ? "permission-denied" : "failed-precondition",
      "This test helper is disabled in production and outside miami-e2e.",
  );
}

function requireProductionBootstrapAdminAllowed(callerEmail) {
  if (!isProductionProject()) return;
  const normalizedCallerEmail = String(callerEmail || "").trim().toLowerCase();
  if (
    normalizedCallerEmail === OWNER_EMAIL &&
    isEnabledFlag(process.env.ALLOW_PRODUCTION_BOOTSTRAP_ADMIN)
  ) {
    return;
  }
  throw new HttpsError(
      "failed-precondition",
      "Admin bootstrap is disabled in production unless " +
      "ALLOW_PRODUCTION_BOOTSTRAP_ADMIN=true and the caller is OWNER_EMAIL.",
  );
}

function requireProductionSetUserRoleAllowed(auth) {
  if (!isProductionProject()) return;
  const callerEmail = String(auth && auth.token && auth.token.email || "")
      .trim()
      .toLowerCase();
  if (
    callerEmail === OWNER_EMAIL &&
    isEnabledFlag(process.env.ALLOW_PRODUCTION_SET_USER_ROLE)
  ) {
    return;
  }
  throw new HttpsError(
      "failed-precondition",
      "Setting user roles is disabled in production unless " +
      "ALLOW_PRODUCTION_SET_USER_ROLE=true and the caller is OWNER_EMAIL.",
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
    isE2eProject() &&
    isEnabledFlag(data && data.privateSlotBooking)
  );
}

function isPrivateSlotReservationEnabled(data) {
  if (isPrivateSlotBookingE2eOverride(data)) return true;
  return isEnabledFlag(process.env.PRIVATE_SLOT_BOOKING_ENABLED);
}

function isPrivateSlotAvailabilityBookingEnabled(data, summary) {
  return (
    isPrivateSlotReservationEnabled(data) ||
    (summary && summary.privateSlotBookingPilotEnabled === true)
  );
}

function isPrivateSlotReservationAllowed(data, summary) {
  return (
    isPrivateSlotReservationEnabled(data) ||
    (summary && summary.privateSlotBookingPilotEnabled === true)
  );
}

function requirePrivateSlotReservationEnabled(data) {
  if (isPrivateSlotReservationEnabled(data)) return;
  throw new HttpsError(
      "failed-precondition",
      PRIVATE_SLOT_BOOKING_NOT_READY_MESSAGE,
  );
}

function requirePrivateSlotReservationAllowed(data, summary) {
  if (isPrivateSlotReservationAllowed(data, summary)) return;
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

function computePrivatePackageCancelLimit(packageData) {
  const totalCount = readNonNegativeInteger(
      packageData && packageData.totalCount,
  );
  return Math.floor(totalCount / PRIVATE_PACKAGE_CANCEL_UNIT_COUNT);
}

function readPrivatePackageCancelUsed(packageData) {
  return readNonNegativeInteger(
      packageData && packageData.privateCancelUsedCount,
  );
}

function resolvePrivatePackageCancelAllowance(packageData) {
  const privateCancelUsedCount = readPrivatePackageCancelUsed(packageData);
  const privateCancelLimit = computePrivatePackageCancelLimit(packageData);
  return {
    privateCancelUsedCount,
    privateCancelLimit,
    remainingCancelCount: Math.max(
        0,
        privateCancelLimit - privateCancelUsedCount,
    ),
  };
}

function getPrivatePackageStudentCancelRejectReason({
  pkg,
  academyId,
  studentId,
  teacherKey,
  teacherKeys = [],
}) {
  if (!pkg) return "package_missing";
  if (normalizeId(pkg.academyId) !== normalizeId(academyId)) {
    return "academy_mismatch";
  }
  if (normalizeId(pkg.studentId) !== normalizeId(studentId)) {
    return "student_mismatch";
  }
  const packageType = normalizeId(pkg.packageType).toLowerCase();
  if (packageType && packageType !== "private") {
    return "package_type_mismatch";
  }
  const status = normalizeId(pkg.status || "active").toLowerCase();
  if (
    ["inactive", "expired", "ended", "revoked", "cancelled", "canceled"]
        .includes(status)
  ) {
    return "package_not_active";
  }
  const packageTeacherKeys = getPrivatePackageTeacherKeys(pkg);
  const requestedTeacherKeys = uniqueNormalizedTeacherKeyList([
    teacherKey,
    ...teacherKeys,
  ]);
  if (requestedTeacherKeys.length === 0) return "missing_lesson_teacher";
  if (packageTeacherKeys.length === 0) return "missing_package_teacher";
  if (!requestedTeacherKeys.some((key) => packageTeacherKeys.includes(key))) {
    return "teacher_mismatch";
  }
  return "";
}

function assertPrivatePackageStudentCancelAllowed({
  packageData,
  academyId,
  studentId,
  teacherKey,
  teacherKeys = [],
}) {
  const rejectReason = getPrivatePackageStudentCancelRejectReason({
    pkg: packageData,
    academyId,
    studentId,
    teacherKey,
    teacherKeys,
  });
  if (rejectReason) {
    throw new HttpsError(
        "failed-precondition",
        "수강권 연결 정보가 없어 학원에 문의해 주세요.",
    );
  }
  const allowance = resolvePrivatePackageCancelAllowance(packageData);
  if (allowance.privateCancelUsedCount >= allowance.privateCancelLimit) {
    throw new HttpsError(
        "failed-precondition",
        "이 수강권의 취소 가능 횟수를 모두 사용했습니다. 학원에 문의해 주세요.",
    );
  }
  return allowance;
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

const FIXED_PRIVATE_RENEWAL_PACKAGE_MODES = ["draft", "existing"];
const FIXED_PRIVATE_RENEWAL_BLOCKED_TEACHER_TIME_STATUSES = [
  "conflict",
  "missing_info",
];

function requireFixedPrivateRenewalYmd(data, fieldName) {
  const value = requireString(data, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} must be YYYY-MM-DD.`,
    );
  }
  return value;
}

function normalizeFixedPrivateRenewalDateList(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} must be an array.`,
    );
  }
  return value.map((entry, index) => {
    const date = normalizeId(entry);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError(
          "invalid-argument",
          `${fieldName}[${index}] must be YYYY-MM-DD.`,
      );
    }
    return date;
  });
}

function normalizeFixedPrivateRenewalExcludedDates(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new HttpsError(
        "invalid-argument",
        "excludedDates must be an array.",
    );
  }
  return value.map((entry, index) => {
    const source = entry && typeof entry === "object" ? entry : {date: entry};
    const date = normalizeId(source.date || source.ymd || source.value);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new HttpsError(
          "invalid-argument",
          `excludedDates[${index}] must include a YYYY-MM-DD date.`,
      );
    }
    const reason = normalizeId(source.reason);
    const blockType = normalizeId(
        source.blockType || source.blockReason || source.severity,
    );
    const hardBlock = source.hardBlock === true ||
      source.isHardBlock === true ||
      blockType === "hard";
    return {
      date,
      reason,
      hardBlock,
    };
  });
}

function normalizeFixedPrivateRenewalTeacherIdentity(data) {
  const teacherKey = normalizeTeacherKey(data.teacherKey);
  const teacherId = normalizeId(data.teacherId);
  const teacherUid = normalizeId(data.teacherUid);
  const teacherName = normalizeId(data.teacherName);
  if (!teacherKey && !teacherId && !teacherUid && !teacherName) {
    throw new HttpsError(
        "invalid-argument",
        "At least one teacher identity is required.",
    );
  }
  return {
    teacherKey,
    teacherId,
    teacherUid,
    teacherName,
  };
}

function getFixedPrivateRenewalMode(data) {
  const commit = data && data.commit === true;
  const dryRun = data && data.dryRun === true;
  const previewOnly = data && data.previewOnly === true;
  if (commit) {
    if (data.dryRun !== false || data.previewOnly !== false) {
      throw new HttpsError(
          "failed-precondition",
          "Write mode requires commit: true, dryRun: false, " +
          "and previewOnly: false.",
      );
    }
    return {commit: true, dryRun: false, previewOnly: false};
  }
  if (!dryRun || !previewOnly) {
    throw new HttpsError(
        "failed-precondition",
        "Actual fixed private renewal save is not enabled yet.",
    );
  }
  return {commit: false, dryRun: true, previewOnly: true};
}

function requireUniqueFixedPrivateRenewalDates(dates, fieldName) {
  const seen = new Set();
  dates.forEach((date) => {
    if (seen.has(date)) {
      throw new HttpsError(
          "invalid-argument",
          `${fieldName} must not contain duplicate dates.`,
      );
    }
    seen.add(date);
  });
}

function sanitizeFixedPrivateRenewalDocId(value) {
  const safe = normalizeId(value).replace(/[^A-Za-z0-9_-]/g, "_");
  if (!safe) {
    throw new HttpsError(
        "invalid-argument",
        "Unable to build fixed private renewal document id.",
    );
  }
  return safe.slice(0, 480);
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

function hashFixedPrivateRenewalPayload(payload) {
  return crypto
      .createHash("sha256")
      .update(stableStringify(payload))
      .digest("hex");
}

function ymdToCompactDate(ymd) {
  return normalizeId(ymd).replace(/-/g, "");
}

function buildFixedPrivateRenewalPreviewValidation(data) {
  const mode = getFixedPrivateRenewalMode(data || {});
  const academyId = requireString(data, "academyId");
  const requestId = requireString(data, "requestId");
  const seedLessonId = requireString(data, "seedLessonId");
  const studentId = requireString(data, "studentId");
  const teacher = normalizeFixedPrivateRenewalTeacherIdentity(data);
  const weekday = normalizeId(data.weekday);
  const time = requireString(data, "time");
  const durationMinutes = Number(data.durationMinutes);
  const startDate = requireFixedPrivateRenewalYmd(data, "startDate");
  const endDate = requireFixedPrivateRenewalYmd(data, "endDate");
  const count = Number(data.count);
  const lessonName = normalizeId(data.lessonName);
  const packageMode = normalizeId(data.packageMode);
  const teacherTimePreparation =
    data.teacherTimePreparation &&
    typeof data.teacherTimePreparation === "object" ?
      data.teacherTimePreparation :
      {};
  const teacherTimeStatus = normalizeId(teacherTimePreparation.status);
  const candidateDates = normalizeFixedPrivateRenewalDateList(
      data.candidateDates,
      "candidateDates",
  );
  const assignableDates = normalizeFixedPrivateRenewalDateList(
      data.assignableDates,
      "assignableDates",
  );
  const excludedDates = normalizeFixedPrivateRenewalExcludedDates(
      data.excludedDates,
  );

  validateAcademyId(academyId);
  const weekdayNumber = Number(weekday);
  if (!Number.isInteger(weekdayNumber) || weekdayNumber < 0 ||
      weekdayNumber > 6) {
    throw new HttpsError(
        "invalid-argument",
        "weekday must be between 0 and 6.",
    );
  }
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) {
    throw new HttpsError("invalid-argument", "time must be HH:MM.");
  }
  if (!Number.isFinite(durationMinutes) || durationMinutes <= 0) {
    throw new HttpsError(
        "invalid-argument",
        "durationMinutes must be greater than 0.",
    );
  }
  if (!Number.isFinite(count) || count <= 0) {
    throw new HttpsError(
        "invalid-argument",
        "count must be greater than 0.",
    );
  }
  if (!Number.isInteger(count)) {
    throw new HttpsError("invalid-argument", "count must be an integer.");
  }
  if (!FIXED_PRIVATE_RENEWAL_PACKAGE_MODES.includes(packageMode)) {
    throw new HttpsError(
        "invalid-argument",
        "packageMode must be draft or existing.",
    );
  }
  if (packageMode === "draft" && !data.draftPackage) {
    throw new HttpsError(
        "invalid-argument",
        "draftPackage is required for draft packageMode.",
    );
  }
  if (packageMode === "existing" && !normalizeId(data.existingPackageId)) {
    throw new HttpsError(
        "invalid-argument",
        "existingPackageId is required for existing packageMode.",
    );
  }
  if (assignableDates.length > count) {
    throw new HttpsError(
        "invalid-argument",
        "assignableDates.length must not exceed count.",
    );
  }
  if (assignableDates.length === 0) {
    throw new HttpsError(
        "failed-precondition",
        "At least one assignable date is required.",
    );
  }
  requireUniqueFixedPrivateRenewalDates(assignableDates, "assignableDates");
  requireUniqueFixedPrivateRenewalDates(candidateDates, "candidateDates");
  if (
    mode.commit &&
    assignableDates.length > FIXED_PRIVATE_RENEWAL_MAX_ASSIGNABLE_COUNT
  ) {
    throw new HttpsError(
        "invalid-argument",
        "assignableDates.length must be " +
        `${FIXED_PRIVATE_RENEWAL_MAX_ASSIGNABLE_COUNT} or less.`,
    );
  }
  const outsideRangeDate = assignableDates.find((date) => {
    return date < startDate || date > endDate;
  });
  if (outsideRangeDate) {
    throw new HttpsError(
        "invalid-argument",
        "assignableDates must be within startDate and endDate.",
    );
  }
  if (
    FIXED_PRIVATE_RENEWAL_BLOCKED_TEACHER_TIME_STATUSES.includes(
        teacherTimeStatus,
    )
  ) {
    throw new HttpsError(
        "failed-precondition",
        `teacherTimePreparation.status ${teacherTimeStatus} blocks renewal.`,
    );
  }

  const hardBlockedExcludedDates = excludedDates.filter((date) => {
    return date.hardBlock;
  });
  if (mode.commit && hardBlockedExcludedDates.length > 0) {
    throw new HttpsError(
        "failed-precondition",
        "excludedDates includes hard block dates.",
    );
  }
  const warnings = hardBlockedExcludedDates.length > 0 ?
    [{
      code: "excluded_dates_include_hard_block",
      message:
        "excludedDates includes hard block dates; skeleton returns " +
        "validation only and does not write.",
      dates: hardBlockedExcludedDates.map((date) => date.date),
    }] :
    [];

  const renewalBatchIdCandidate =
    sanitizeFixedPrivateRenewalDocId(
        `fixedPrivateRenewal_${academyId}_${requestId}`,
    );
  const wouldCreate = {
    studentPackage: packageMode === "draft",
    teacherTemplate: teacherTimeStatus === "create",
    reactivateTeacherTemplate: teacherTimeStatus === "reactivate",
    lessons: assignableDates.length,
    privateLessonSlots: assignableDates.length,
    privateLessonReservations: assignableDates.length,
  };

  return {
    academyId,
    requestId,
    commit: mode.commit,
    dryRun: mode.dryRun,
    previewOnly: mode.previewOnly,
    idempotencyKey: requestId,
    renewalBatchIdCandidate,
    warnings,
    normalizedPlan: {
      academyId,
      seedLessonId,
      studentId,
      ...teacher,
      weekday: weekdayNumber,
      time,
      durationMinutes,
      startDate,
      endDate,
      count,
      lessonName,
      packageMode,
      existingPackageId: normalizeId(data.existingPackageId),
      hasDraftPackage: packageMode === "draft",
      teacherTimePreparation: {
        status: teacherTimeStatus,
        templateId: normalizeId(teacherTimePreparation.templateId),
        action: normalizeId(teacherTimePreparation.action),
      },
      candidateDates,
      assignableDates,
      excludedDates,
    },
    wouldCreate,
  };
}

function buildFixedPrivateRenewalPayloadHash(validation) {
  return hashFixedPrivateRenewalPayload({
    requestId: validation.requestId,
    normalizedPlan: validation.normalizedPlan,
    wouldCreate: validation.wouldCreate,
  });
}

function buildFixedPrivateRenewalDeterministicIds(validation) {
  const batchId = validation.renewalBatchIdCandidate;
  const packageId = sanitizeFixedPrivateRenewalDocId(`${batchId}__package`);
  const templateId = sanitizeFixedPrivateRenewalDocId(`${batchId}__template`);
  const creditTransactionId = sanitizeFixedPrivateRenewalDocId(
      `${batchId}__package_created`,
  );
  const occurrences = validation.normalizedPlan.assignableDates.map((date) => {
    const safeDate = ymdToCompactDate(date);
    const lessonId = sanitizeFixedPrivateRenewalDocId(
        `${batchId}__lesson__${safeDate}`,
    );
    const slotId = sanitizeFixedPrivateRenewalDocId(
        `${batchId}__slot__${safeDate}`,
    );
    return {
      date,
      lessonId,
      slotId,
      reservationId: privateReservationDocId({
        academyId: validation.academyId,
        slotId,
        studentId: validation.normalizedPlan.studentId,
      }),
    };
  });
  return {
    batchId,
    packageId,
    templateId,
    creditTransactionId,
    occurrences,
  };
}

function assertFixedPrivateRenewalCheckpointMatches({
  checkpoint,
  payloadHash,
}) {
  if (!checkpoint || checkpoint.status !== "completed") {
    throw new HttpsError(
        "failed-precondition",
        "Fixed private renewal batch is already in progress or incomplete.",
    );
  }
  if (normalizeId(checkpoint.payloadHash) !== payloadHash) {
    throw new HttpsError(
        "already-exists",
        "requestId was already used for a different fixed private renewal.",
    );
  }
}

function buildFixedPrivateRenewalResultFromCheckpoint({
  validation,
  checkpoint,
}) {
  return {
    ok: true,
    committed: true,
    idempotentReplay: true,
    previewOnly: false,
    dryRun: false,
    requestId: validation.requestId,
    idempotencyKey: validation.idempotencyKey,
    renewalBatchIdCandidate: validation.renewalBatchIdCandidate,
    normalizedPlan: validation.normalizedPlan,
    warnings: validation.warnings,
    wouldCreate: validation.wouldCreate,
    created: checkpoint.created || {},
  };
}

function buildFixedPrivateRenewalDryRunResult(validation) {
  return {
    ok: true,
    previewOnly: true,
    dryRun: true,
    commitRequiredForWrite: true,
    requestId: validation.requestId,
    idempotencyKey: validation.idempotencyKey,
    renewalBatchIdCandidate: validation.renewalBatchIdCandidate,
    normalizedPlan: validation.normalizedPlan,
    warnings: validation.warnings,
    wouldCreate: validation.wouldCreate,
    nextStep: "Call with commit: true, dryRun: false, and previewOnly: false.",
  };
}

function getFixedPrivateRenewalTeacherKeys(plan) {
  return uniqueNormalizedTeacherKeyList([
    plan.teacherKey,
    plan.teacherUid,
    plan.teacherId,
    plan.teacherName,
  ]);
}

function assertFixedPrivateRenewalTeacherMatches({
  expected,
  actual,
  label,
}) {
  const expectedKeys = getFixedPrivateRenewalTeacherKeys(expected);
  const actualKeys = uniqueNormalizedTeacherKeyList([
    actual && actual.teacherKey,
    actual && actual.teacherUid,
    actual && actual.teacherUID,
    actual && actual.teacherId,
    actual && actual.teacher,
    actual && actual.teacherName,
  ]);
  if (
    expectedKeys.length > 0 &&
    actualKeys.length > 0 &&
    !expectedKeys.some((key) => actualKeys.includes(key))
  ) {
    throw new HttpsError(
        "failed-precondition",
        `${label} teacher does not match renewal teacher.`,
    );
  }
}

function buildFixedPrivateRenewalPackagePayload({
  validation,
  studentData,
  actor,
  now,
}) {
  const plan = validation.normalizedPlan;
  const packageTitle = normalizeId(plan.lessonName) || "연장 자동 초안";
  return {
    academyId: validation.academyId,
    studentId: plan.studentId,
    studentName: normalizeId(studentData.name || studentData.studentName) ||
      normalizeId(studentData.displayName) ||
      "-",
    teacher: plan.teacherKey || plan.teacherUid || plan.teacherName,
    teacherName: plan.teacherName || plan.teacherKey || plan.teacherUid,
    teacherKey: plan.teacherKey,
    teacherDisplayName: plan.teacherName || plan.teacherKey,
    teacherUid: plan.teacherUid,
    teacherEmail: "",
    teacherId: plan.teacherId,
    packageType: "private",
    groupClassId: null,
    groupClassName: null,
    title: packageTitle,
    totalCount: plan.count,
    usedCount: 0,
    remainingCount: plan.count,
    status: "active",
    privatePackageMode: "countBased",
    registrationStartDate: plan.startDate,
    registrationWeeks: null,
    coverageEndDate: plan.endDate,
    startDate: plan.startDate,
    endDate: plan.endDate,
    expiresAt: timestampFromMillis(
        getSeoulDateTimeMillis(plan.endDate, "23:59"),
    ),
    paymentDate: "",
    amountPaid: 0,
    memo: "연장 자동 초안 · 고정 개인 연장",
    sourceType: "fixed-private-renewal",
    renewalSeedLessonId: plan.seedLessonId,
    renewalBatchId: validation.renewalBatchIdCandidate,
    createdBy: actor.actorUid,
    createdByUid: actor.actorUid,
    createdByName: actor.actorName,
    createdAt: now,
    updatedAt: now,
  };
}

function buildFixedPrivateRenewalCreditPayload({
  validation,
  packageId,
  packageData,
  actor,
  now,
}) {
  const plan = validation.normalizedPlan;
  return {
    academyId: validation.academyId,
    studentId: plan.studentId,
    studentName: packageData.studentName,
    teacher: packageData.teacher,
    packageId,
    packageType: "private",
    packageTitle: packageData.title,
    groupClassName: "",
    sourceType: "fixed-private-renewal",
    sourceId: validation.renewalBatchIdCandidate,
    actionType: "package_created",
    deltaCount: plan.count,
    memo: `고정 1:1 연장 · ${plan.startDate} ~ ${plan.endDate} · ` +
      `${plan.count}회`,
    actorUid: actor.actorUid,
    actorRole: actor.actorRole,
    actorName: actor.actorName,
    reason: "fixed-private-renewal",
    createdAt: now,
  };
}

function buildFixedPrivateRenewalTemplatePayload({
  validation,
  actor,
  now,
}) {
  const plan = validation.normalizedPlan;
  return {
    academyId: validation.academyId,
    teacher: plan.teacherKey || plan.teacherUid || plan.teacherName,
    teacherName: plan.teacherName || plan.teacherKey || plan.teacherUid,
    teacherKey: plan.teacherKey,
    teacherUid: plan.teacherUid,
    teacherId: plan.teacherId,
    weekday: plan.weekday,
    time: plan.time,
    durationMinutes: plan.durationMinutes,
    status: "active",
    effectiveStartDate: plan.startDate,
    effectiveEndDate: plan.endDate,
    useForFixedAssignment: true,
    openForStudentBooking: false,
    sourceType: "fixed-private-renewal",
    renewalBatchId: validation.renewalBatchIdCandidate,
    createdByUid: actor.actorUid,
    createdByName: actor.actorName,
    createdAt: now,
    updatedAt: now,
  };
}

function buildFixedPrivateRenewalOccurrencePayloads({
  validation,
  occurrence,
  packageId,
  packageData,
  templateId,
  actor,
  now,
}) {
  const plan = validation.normalizedPlan;
  const startMillis = getSeoulDateTimeMillis(occurrence.date, plan.time);
  const startTimestamp = timestampFromMillis(startMillis);
  const subject = plan.lessonName || "고정 1:1";
  const packageTitle = normalizeId(packageData.title) || "고정 1:1";
  const teacher = {
    teacher: plan.teacherKey || plan.teacherUid || plan.teacherName,
    teacherName: plan.teacherName || plan.teacherKey || plan.teacherUid,
    teacherKey: plan.teacherKey,
    teacherUid: plan.teacherUid,
    teacherUID: plan.teacherUid,
    teacherId: plan.teacherId,
    teacherEmail: normalizeId(packageData.teacherEmail),
  };
  const fixedBase = {
    academyId: validation.academyId,
    studentId: plan.studentId,
    studentID: plan.studentId,
    studentName: packageData.studentName,
    ...teacher,
    date: occurrence.date,
    time: plan.time,
    subject,
    durationMinutes: plan.durationMinutes,
    packageId,
    deductionPackageId: packageId,
    linkedPackageId: packageId,
    fixedPrivatePackageId: packageId,
    packageName: packageTitle,
    packageTitle,
    packageTeacherKey: plan.teacherKey || teacher.teacher,
    packageType: "private",
    source: "fixed_admin",
    sourceType: "fixed-private-slot-assignment",
    reservationType: "fixed",
    privateLessonAvailabilityTemplateId: templateId,
    fixedPrivateAssignmentBatchId: validation.renewalBatchIdCandidate,
  };
  const slot = {
    academyId: validation.academyId,
    ...teacher,
    date: occurrence.date,
    time: plan.time,
    durationMinutes: plan.durationMinutes,
    status: "reserved",
    slotType: "fixed",
    isBookable: false,
    reservedStudentId: plan.studentId,
    fixedStudentId: plan.studentId,
    fixedStudentName: packageData.studentName,
    reservationId: occurrence.reservationId,
    lessonId: occurrence.lessonId,
    fixedLessonId: occurrence.lessonId,
    packageId,
    deductionPackageId: packageId,
    linkedPackageId: packageId,
    fixedPrivatePackageId: packageId,
    packageName: packageTitle,
    packageTitle,
    packageTeacherKey: plan.teacherKey || teacher.teacher,
    privateLessonAvailabilityTemplateId: templateId,
    fixedPrivateAssignmentBatchId: validation.renewalBatchIdCandidate,
    createdByUid: actor.actorUid,
    startAt: startTimestamp,
    reservedAt: now,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const reservation = {
    academyId: validation.academyId,
    slotId: occurrence.slotId,
    studentName: packageData.studentName,
    studentId: plan.studentId,
    ...teacher,
    date: occurrence.date,
    time: plan.time,
    subject,
    status: "active",
    source: "fixed_admin",
    sourceType: "fixed-private-slot-assignment",
    reservationType: "fixed",
    lessonId: occurrence.lessonId,
    fixedLessonId: occurrence.lessonId,
    packageId,
    deductionPackageId: packageId,
    linkedPackageId: packageId,
    fixedPrivatePackageId: packageId,
    packageName: packageTitle,
    packageTitle,
    packageTeacherKey: plan.teacherKey || teacher.teacher,
    privateLessonAvailabilityTemplateId: templateId,
    fixedPrivateAssignmentBatchId: validation.renewalBatchIdCandidate,
    durationMinutes: plan.durationMinutes,
    reservedAt: now,
    createdAt: now,
    updatedAt: now,
    cancelledAt: null,
  };
  const lesson = {
    ...fixedBase,
    id: occurrence.lessonId,
    lessonId: occurrence.lessonId,
    fixedLessonId: occurrence.lessonId,
    reservationId: occurrence.reservationId,
    slotId: occurrence.slotId,
    scheduleDate: occurrence.date,
    scheduleTime: plan.time,
    status: "active",
    createdByUid: actor.actorUid,
    startAt: startTimestamp,
    startsAt: startTimestamp,
    cancelledAt: null,
    createdAt: now,
    updatedAt: now,
  };
  return {slot, reservation, lesson};
}

function getFixedPrivateRenewalPackageTitle(packageData) {
  return normalizeId(
      packageData &&
      (packageData.packageTitle || packageData.title || packageData.name),
  ) || "고정 1:1";
}

async function loadFixedPrivateRenewalPackageUsageRows(transaction, db, {
  academyId,
  studentId,
  packageId,
}) {
  const [lessonSnap, reservationSnap] = await Promise.all([
    transaction.get(
        db
            .collection("lessons")
            .where("academyId", "==", academyId)
            .where("studentId", "==", studentId)
            .where("packageId", "==", packageId),
    ),
    transaction.get(
        db
            .collection("privateLessonReservations")
            .where("academyId", "==", academyId)
            .where("studentId", "==", studentId)
            .where("packageId", "==", packageId),
    ),
  ]);
  return {
    privateLessons: lessonSnap.docs.map((docSnap) => {
      return {id: docSnap.id, ...docSnap.data()};
    }),
    privateReservations: reservationSnap.docs.map((docSnap) => {
      return {id: docSnap.id, ...docSnap.data()};
    }),
  };
}

function assertFixedPrivateRenewalStudent({
  studentSnap,
  validation,
}) {
  if (!studentSnap.exists) {
    throw new HttpsError("not-found", "Student not found.");
  }
  const studentData = studentSnap.data() || {};
  if (normalizeId(studentData.academyId) !== validation.academyId) {
    throw new HttpsError(
        "permission-denied",
        "Student does not belong to academy.",
    );
  }
  return studentData;
}

function assertFixedPrivateRenewalSeedLesson({
  seedLessonSnap,
  validation,
}) {
  if (!seedLessonSnap.exists) {
    throw new HttpsError("not-found", "Seed lesson not found.");
  }
  const plan = validation.normalizedPlan;
  const seedLesson = seedLessonSnap.data() || {};
  if (normalizeId(seedLesson.academyId) !== validation.academyId) {
    throw new HttpsError(
        "permission-denied",
        "Seed lesson does not belong to academy.",
    );
  }
  const seedStudentId = normalizeId(
      seedLesson.studentId || seedLesson.studentID,
  );
  if (seedStudentId !== plan.studentId) {
    throw new HttpsError(
        "failed-precondition",
        "Seed lesson student does not match renewal student.",
    );
  }
  if (!isFixedPrivateLessonOccurrence(seedLesson)) {
    throw new HttpsError(
        "failed-precondition",
        "Seed lesson is not a fixed private lesson occurrence.",
    );
  }
  assertFixedPrivateRenewalTeacherMatches({
    expected: plan,
    actual: seedLesson,
    label: "Seed lesson",
  });
  return seedLesson;
}

function assertFixedPrivateRenewalExistingPackage({
  packageSnap,
  validation,
  usageRows,
}) {
  if (!packageSnap.exists) {
    throw new HttpsError("not-found", "Student package not found.");
  }
  const plan = validation.normalizedPlan;
  const packageData = packageSnap.data() || {};
  const teacherKeys = getFixedPrivateRenewalTeacherKeys(plan);
  const firstDate = plan.assignableDates[0] || plan.startDate;
  const rejectReason = getPrivatePackageRejectReason({
    pkg: packageData,
    academyId: validation.academyId,
    studentId: plan.studentId,
    teacherKey: plan.teacherKey,
    teacherKeys,
    lessonDate: firstDate,
  });
  if (rejectReason) {
    throw new HttpsError(
        "failed-precondition",
        `Package cannot be used for renewal: ${rejectReason}.`,
    );
  }
  const uncoveredDate = plan.assignableDates.find((date) => {
    return !privatePackageCoversDate(packageData, date);
  });
  if (uncoveredDate) {
    throw new HttpsError(
        "failed-precondition",
        "Package does not cover every renewal date.",
    );
  }
  const usage = computePrivateTeacherPackageUsage({
    privatePackage: packageData,
    packageId: packageSnap.id,
    privateLessons: usageRows.privateLessons,
    privateReservations: usageRows.privateReservations,
    academyId: validation.academyId,
    studentId: plan.studentId,
    teacherKeys,
  });
  if (usage.makeupAvailableCount < plan.assignableDates.length) {
    throw new HttpsError(
        "failed-precondition",
        "Package does not have enough unallocated count for renewal.",
    );
  }
  return {
    id: packageSnap.id,
    data: {
      ...packageData,
      studentName: normalizeId(packageData.studentName) || "-",
      title: getFixedPrivateRenewalPackageTitle(packageData),
    },
    usage,
  };
}

function assertFixedPrivateRenewalTemplate({
  templateSnap,
  validation,
  allowInactive = false,
}) {
  if (!templateSnap.exists) {
    throw new HttpsError("not-found", "Teacher time template not found.");
  }
  const plan = validation.normalizedPlan;
  const template = templateSnap.data() || {};
  if (normalizeId(template.academyId) !== validation.academyId) {
    throw new HttpsError(
        "permission-denied",
        "Teacher time template does not belong to academy.",
    );
  }
  assertFixedPrivateRenewalTeacherMatches({
    expected: plan,
    actual: template,
    label: "Teacher time template",
  });
  if (Number(template.weekday) !== plan.weekday ||
      normalizeId(template.time) !== plan.time ||
      Number(template.durationMinutes || 0) !== plan.durationMinutes) {
    throw new HttpsError(
        "failed-precondition",
        "Teacher time template does not match renewal schedule.",
    );
  }
  const status = normalizeId(template.status || "active").toLowerCase();
  if (allowInactive) {
    if (!["active", "inactive"].includes(status)) {
      throw new HttpsError(
          "failed-precondition",
          "Teacher time template cannot be reactivated.",
      );
    }
  } else if (status !== "active") {
    throw new HttpsError(
        "failed-precondition",
        "Teacher time template is not active.",
    );
  }
  return template;
}

function getFixedPrivateRenewalTemplateRef({db, validation, ids}) {
  const plan = validation.normalizedPlan;
  const status = plan.teacherTimePreparation.status;
  if (status === "create") {
    return db.collection("privateLessonAvailabilityTemplates")
        .doc(ids.templateId);
  }
  const templateId = normalizeId(plan.teacherTimePreparation.templateId);
  if (!templateId) {
    throw new HttpsError(
        "invalid-argument",
        "teacherTimePreparation.templateId is required.",
    );
  }
  return db.collection("privateLessonAvailabilityTemplates").doc(templateId);
}

async function assertFixedPrivateRenewalNoScheduleConflicts({
  transaction,
  db,
  validation,
}) {
  const plan = validation.normalizedPlan;
  for (const date of plan.assignableDates) {
    const hasConflict = await hasTeacherScheduleConflict(transaction, db, {
      academyId: validation.academyId,
      teacher: plan.teacherKey,
      teacherName: plan.teacherName,
      teacherKey: plan.teacherKey,
      teacherUid: plan.teacherUid,
      teacherUID: plan.teacherUid,
      date,
      time: plan.time,
      durationMinutes: plan.durationMinutes,
    });
    if (hasConflict) {
      throw new HttpsError(
          "failed-precondition",
          `Teacher schedule conflict exists on ${date}.`,
      );
    }
  }
}

function assertNoFixedPrivateRenewalDeterministicDocs({
  docSnaps,
}) {
  const existing = docSnaps.find((snap) => snap.exists);
  if (existing) {
    throw new HttpsError(
        "already-exists",
        `Renewal document already exists: ${existing.ref.path}.`,
    );
  }
}

async function runFixedPrivateRenewalWriteTransaction({
  db,
  auth,
  membership,
  validation,
}) {
  const ids = buildFixedPrivateRenewalDeterministicIds(validation);
  const payloadHash = buildFixedPrivateRenewalPayloadHash(validation);
  const actor = buildAdminActorContext(auth, membership);
  return db.runTransaction(async (transaction) => {
    const plan = validation.normalizedPlan;
    const batchRef = db.collection("fixedPrivateRenewalBatches")
        .doc(ids.batchId);
    const studentRef = db.collection("privateStudents").doc(plan.studentId);
    const seedLessonRef = db.collection("lessons").doc(plan.seedLessonId);
    const isDraftPackage = plan.packageMode === "draft";
    const packageRef = db.collection("studentPackages")
        .doc(isDraftPackage ? ids.packageId : plan.existingPackageId);
    const creditRef = db.collection("creditTransactions")
        .doc(ids.creditTransactionId);
    const summaryRef = db
        .collection("studentPrivateAccessSummary")
        .doc(`${validation.academyId}__${plan.studentId}`);
    const templateRef = getFixedPrivateRenewalTemplateRef({
      db,
      validation,
      ids,
    });
    const occurrenceRefs = ids.occurrences.map((occurrence) => {
      return {
        occurrence,
        lessonRef: db.collection("lessons").doc(occurrence.lessonId),
        slotRef: db.collection("privateLessonSlots").doc(occurrence.slotId),
        reservationRef: db
            .collection("privateLessonReservations")
            .doc(occurrence.reservationId),
      };
    });

    const baseReads = [
      transaction.get(batchRef),
      transaction.get(studentRef),
      transaction.get(seedLessonRef),
      transaction.get(packageRef),
      transaction.get(templateRef),
      ...occurrenceRefs.flatMap((refs) => {
        return [
          transaction.get(refs.lessonRef),
          transaction.get(refs.slotRef),
          transaction.get(refs.reservationRef),
        ];
      }),
    ];
    if (isDraftPackage) baseReads.push(transaction.get(creditRef));
    const readSnaps = await Promise.all(baseReads);
    const batchSnap = readSnaps[0];
    if (batchSnap.exists) {
      const checkpoint = batchSnap.data() || {};
      assertFixedPrivateRenewalCheckpointMatches({checkpoint, payloadHash});
      return buildFixedPrivateRenewalResultFromCheckpoint({
        validation,
        checkpoint,
      });
    }

    const studentData = assertFixedPrivateRenewalStudent({
      studentSnap: readSnaps[1],
      validation,
    });
    assertFixedPrivateRenewalSeedLesson({
      seedLessonSnap: readSnaps[2],
      validation,
    });

    let packageResult = null;
    let usageRows = {privateLessons: [], privateReservations: []};
    if (isDraftPackage) {
      if (readSnaps[3].exists) {
        throw new HttpsError(
            "already-exists",
            "Deterministic student package already exists.",
        );
      }
      packageResult = {
        id: ids.packageId,
        data: buildFixedPrivateRenewalPackagePayload({
          validation,
          studentData,
          actor,
          now: admin.firestore.FieldValue.serverTimestamp(),
        }),
      };
    } else {
      usageRows = await loadFixedPrivateRenewalPackageUsageRows(
          transaction,
          db,
          {
            academyId: validation.academyId,
            studentId: plan.studentId,
            packageId: plan.existingPackageId,
          },
      );
      packageResult = assertFixedPrivateRenewalExistingPackage({
        packageSnap: readSnaps[3],
        validation,
        usageRows,
      });
    }

    const teacherTimeStatus = plan.teacherTimePreparation.status;
    const templateSnap = readSnaps[4];
    let templateId = templateRef.id;
    if (teacherTimeStatus === "create") {
      if (templateSnap.exists) {
        throw new HttpsError(
            "already-exists",
            "Deterministic teacher time template already exists.",
        );
      }
    } else {
      assertFixedPrivateRenewalTemplate({
        templateSnap,
        validation,
        allowInactive: teacherTimeStatus === "reactivate",
      });
      templateId = templateRef.id;
    }

    const deterministicDocSnaps = readSnaps.slice(5);
    assertNoFixedPrivateRenewalDeterministicDocs({
      docSnaps: deterministicDocSnaps,
    });
    if (isDraftPackage && readSnaps[readSnaps.length - 1].exists) {
      throw new HttpsError(
          "already-exists",
          "Deterministic credit transaction already exists.",
      );
    }
    await assertFixedPrivateRenewalNoScheduleConflicts({
      transaction,
      db,
      validation,
    });

    const now = admin.firestore.FieldValue.serverTimestamp();
    if (isDraftPackage) {
      transaction.create(packageRef, {
        ...packageResult.data,
        createdAt: now,
        updatedAt: now,
      });
      transaction.create(creditRef, buildFixedPrivateRenewalCreditPayload({
        validation,
        packageId: packageResult.id,
        packageData: packageResult.data,
        actor,
        now,
      }));
      transaction.set(summaryRef, {
        academyId: validation.academyId,
        studentId: plan.studentId,
        teacherKeys: admin.firestore.FieldValue.arrayUnion(
            ...getFixedPrivateRenewalTeacherKeys(plan),
        ),
        activePackageIds: admin.firestore.FieldValue.arrayUnion(
            packageResult.id,
        ),
        createdAt: now,
        updatedAt: now,
      }, {merge: true});
    }

    if (teacherTimeStatus === "create") {
      transaction.create(templateRef, buildFixedPrivateRenewalTemplatePayload({
        validation,
        actor,
        now,
      }));
    } else if (teacherTimeStatus === "reactivate") {
      transaction.update(templateRef, {
        status: "active",
        useForFixedAssignment: true,
        openForStudentBooking: false,
        sourceType: "fixed-private-renewal",
        renewalBatchId: validation.renewalBatchIdCandidate,
        updatedAt: now,
        updatedByUid: actor.actorUid,
        updatedByName: actor.actorName,
      });
    }

    occurrenceRefs.forEach((refs) => {
      const payloads = buildFixedPrivateRenewalOccurrencePayloads({
        validation,
        occurrence: refs.occurrence,
        packageId: packageResult.id,
        packageData: packageResult.data,
        templateId,
        actor,
        now,
      });
      transaction.create(refs.lessonRef, payloads.lesson);
      transaction.create(refs.slotRef, payloads.slot);
      transaction.create(refs.reservationRef, payloads.reservation);
    });

    const created = {
      studentPackage: isDraftPackage ? packageResult.id : "",
      packageId: packageResult.id,
      teacherTemplate: teacherTimeStatus === "create" ? templateId : "",
      reactivatedTeacherTemplate:
        teacherTimeStatus === "reactivate" ? templateId : "",
      templateId,
      lessons: ids.occurrences.map((occurrence) => occurrence.lessonId),
      privateLessonSlots: ids.occurrences.map((occurrence) => {
        return occurrence.slotId;
      }),
      privateLessonReservations: ids.occurrences.map((occurrence) => {
        return occurrence.reservationId;
      }),
    };
    transaction.create(batchRef, {
      academyId: validation.academyId,
      requestId: validation.requestId,
      payloadHash,
      status: "completed",
      packageMode: plan.packageMode,
      packageId: packageResult.id,
      templateId,
      assignableDates: plan.assignableDates,
      created,
      actor,
      createdAt: now,
      updatedAt: now,
    });

    return {
      ok: true,
      committed: true,
      idempotentReplay: false,
      previewOnly: false,
      dryRun: false,
      requestId: validation.requestId,
      idempotencyKey: validation.idempotencyKey,
      renewalBatchIdCandidate: validation.renewalBatchIdCandidate,
      normalizedPlan: validation.normalizedPlan,
      warnings: validation.warnings,
      wouldCreate: validation.wouldCreate,
      created,
    };
  });
}

const FIXED_PRIVATE_RESCHEDULE_SCOPE_MODES = [
  "single",
  "future_series",
  "package_remaining",
  "date_range",
];

const FIXED_PRIVATE_RESCHEDULE_INSPECT_MODES = [
  "before_commit",
  "after_commit",
  "generic",
];

const FIXED_PRIVATE_RESCHEDULE_BLOCKED_STATUSES = [
  "cancelled",
  "canceled",
  "deleted",
  "archived",
  "completed",
  "no_show",
  "no-show",
];

const FIXED_PRIVATE_RESCHEDULE_BLOCKED_CANCELLATION_TYPES = [
  "lesson_cancelled",
  "lesson_canceled",
  "fixed_lesson_cancelled",
  "seat_released",
];

// eslint-disable-next-line max-len
const FIXED_PRIVATE_RESCHEDULE_DRY_RUN_ONLY_MESSAGE = "actual fixed private lesson reschedule is not enabled in this dry-run callable";
// eslint-disable-next-line max-len
const FIXED_PRIVATE_RESCHEDULE_COMMIT_GUARD_MESSAGE = "actual fixed private lesson reschedule requires commit true, dryRun false, previewOnly false";
// eslint-disable-next-line max-len
const FIXED_PRIVATE_RESCHEDULE_DATE_MOVE_DISABLED_MESSAGE = "fixed private reschedule date move is not enabled yet";
// eslint-disable-next-line max-len
const FIXED_PRIVATE_RESCHEDULE_PACKAGE_CHANGE_DISABLED_MESSAGE = "fixed private reschedule package change is not enabled yet";

function getFixedPrivateRescheduleMode(data) {
  if (data && data.commit === true) {
    throw new HttpsError(
        "failed-precondition",
        FIXED_PRIVATE_RESCHEDULE_DRY_RUN_ONLY_MESSAGE,
    );
  }
  if (!data || data.dryRun !== true || data.previewOnly !== true) {
    throw new HttpsError(
        "failed-precondition",
        FIXED_PRIVATE_RESCHEDULE_DRY_RUN_ONLY_MESSAGE,
    );
  }
  return {commit: false, dryRun: true, previewOnly: true};
}

function getFixedPrivateRescheduleCommitMode(data) {
  if (!data || data.commit !== true || data.dryRun !== false ||
      data.previewOnly !== false) {
    throw new HttpsError(
        "failed-precondition",
        FIXED_PRIVATE_RESCHEDULE_COMMIT_GUARD_MESSAGE,
    );
  }
  return {commit: true, dryRun: false, previewOnly: false};
}

function normalizeFixedPrivateRescheduleInspectMode(data) {
  const mode = normalizeId(data && data.inspectMode) || "before_commit";
  if (!FIXED_PRIVATE_RESCHEDULE_INSPECT_MODES.includes(mode)) {
    throw new HttpsError(
        "invalid-argument",
        "inspectMode must be before_commit, after_commit, or generic.",
    );
  }
  return mode;
}

function requireFixedPrivateRescheduleYmd(data, fieldName) {
  const value = requireString(data, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} must be YYYY-MM-DD.`,
    );
  }
  return value;
}

function optionalFixedPrivateRescheduleYmd(data, fieldName) {
  const value = optionalString(data, fieldName);
  if (!value) return "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} must be YYYY-MM-DD.`,
    );
  }
  return value;
}

function optionalFixedPrivateRescheduleTime(data, fieldName) {
  const value = optionalString(data, fieldName);
  if (!value) return "";
  if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(value)) {
    throw new HttpsError(
        "invalid-argument",
        `${fieldName} must be HH:MM.`,
    );
  }
  return value;
}

function normalizeFixedPrivateRescheduleTarget(data) {
  const targetDate = optionalFixedPrivateRescheduleYmd(data, "targetDate");
  const targetTime = optionalFixedPrivateRescheduleTime(data, "targetTime");
  const targetDurationRaw = data && data.targetDurationMinutes;
  let targetDurationMinutes = null;
  if (targetDurationRaw !== undefined && targetDurationRaw !== null &&
      `${targetDurationRaw}`.trim() !== "") {
    const parsed = Number(targetDurationRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new HttpsError(
          "invalid-argument",
          "targetDurationMinutes must be greater than 0.",
      );
    }
    targetDurationMinutes = Math.floor(parsed);
  }
  const teacher = {
    teacherId: normalizeId(data && data.targetTeacherId),
    teacherUid: normalizeId(data && data.targetTeacherUid),
    teacherName: normalizeId(data && data.targetTeacherName),
    teacherKey: normalizeTeacherKey(data && data.targetTeacherKey),
  };
  const hasTargetTeacher = Boolean(
      teacher.teacherId ||
      teacher.teacherUid ||
      teacher.teacherName ||
      teacher.teacherKey,
  );
  return {
    targetDate,
    targetTime,
    targetTeacher: hasTargetTeacher ? teacher : null,
    targetDurationMinutes,
    targetLessonName: normalizeId(data && data.targetLessonName),
    targetPackageId: normalizeId(data && data.targetPackageId),
    hasAnyTargetChange: Boolean(
        targetDate ||
        targetTime ||
        hasTargetTeacher ||
        targetDurationMinutes ||
        normalizeId(data && data.targetLessonName) ||
        normalizeId(data && data.targetPackageId),
    ),
  };
}

function buildFixedPrivateRescheduleValidation(data) {
  const mode = getFixedPrivateRescheduleMode(data || {});
  const requestId = requireString(data, "requestId");
  const academyId = requireString(data, "academyId");
  const selectedLessonId = requireString(data, "selectedLessonId");
  const scopeMode = normalizeId(data && data.scopeMode);
  validateAcademyId(academyId);
  if (!FIXED_PRIVATE_RESCHEDULE_SCOPE_MODES.includes(scopeMode)) {
    throw new HttpsError(
        "invalid-argument",
        "scopeMode must be single, future_series, package_remaining, " +
        "or date_range.",
    );
  }
  let rangeStart = optionalFixedPrivateRescheduleYmd(data, "rangeStart");
  let rangeEnd = optionalFixedPrivateRescheduleYmd(data, "rangeEnd");
  if (scopeMode === "date_range") {
    rangeStart = requireFixedPrivateRescheduleYmd(data, "rangeStart");
    rangeEnd = requireFixedPrivateRescheduleYmd(data, "rangeEnd");
    if (rangeStart > rangeEnd) {
      throw new HttpsError(
          "invalid-argument",
          "rangeStart must be before or equal to rangeEnd.",
      );
    }
  }
  const target = normalizeFixedPrivateRescheduleTarget(data || {});
  if (target.targetDate && scopeMode !== "single") {
    throw new HttpsError(
        "invalid-argument",
        "targetDate is only allowed for single scope dry-run.",
    );
  }
  return {
    ...mode,
    requestId,
    academyId,
    selectedLessonId,
    scopeMode,
    rangeStart,
    rangeEnd,
    target,
  };
}

function buildFixedPrivateRescheduleCommitValidation(data) {
  const mode = getFixedPrivateRescheduleCommitMode(data || {});
  const requestId = requireString(data, "requestId");
  const academyId = requireString(data, "academyId");
  const selectedLessonId = requireString(data, "selectedLessonId");
  const scopeMode = normalizeId(data && data.scopeMode);
  validateAcademyId(academyId);
  if (!FIXED_PRIVATE_RESCHEDULE_SCOPE_MODES.includes(scopeMode)) {
    throw new HttpsError(
        "invalid-argument",
        "scopeMode must be single, future_series, package_remaining, " +
        "or date_range.",
    );
  }
  let rangeStart = optionalFixedPrivateRescheduleYmd(data, "rangeStart");
  let rangeEnd = optionalFixedPrivateRescheduleYmd(data, "rangeEnd");
  if (scopeMode === "date_range") {
    rangeStart = requireFixedPrivateRescheduleYmd(data, "rangeStart");
    rangeEnd = requireFixedPrivateRescheduleYmd(data, "rangeEnd");
    if (rangeStart > rangeEnd) {
      throw new HttpsError(
          "invalid-argument",
          "rangeStart must be before or equal to rangeEnd.",
      );
    }
  }
  const target = normalizeFixedPrivateRescheduleTarget(data || {});
  if (target.targetPackageId) {
    throw new HttpsError(
        "failed-precondition",
        FIXED_PRIVATE_RESCHEDULE_PACKAGE_CHANGE_DISABLED_MESSAGE,
    );
  }
  if (target.targetDate && scopeMode !== "single") {
    throw new HttpsError(
        "invalid-argument",
        "targetDate is only allowed for single scope commit.",
    );
  }
  const batchId = getFixedPrivateRescheduleBatchIdCandidate({
    academyId,
    requestId,
  });
  return {
    ...mode,
    requestId,
    academyId,
    selectedLessonId,
    scopeMode,
    rangeStart,
    rangeEnd,
    target,
    batchId,
  };
}

function buildFixedPrivateReschedulePayloadHash(validation) {
  return hashFixedPrivateRenewalPayload({
    requestId: validation.requestId,
    academyId: validation.academyId,
    selectedLessonId: validation.selectedLessonId,
    scopeMode: validation.scopeMode,
    rangeStart: validation.rangeStart,
    rangeEnd: validation.rangeEnd,
    target: validation.target,
    commit: validation.commit,
    dryRun: validation.dryRun,
    previewOnly: validation.previewOnly,
  });
}

function getFixedPrivateRescheduleBatchIdCandidate(validation) {
  return sanitizeFixedPrivateRenewalDocId(
      `fixedPrivateReschedule_${validation.academyId}_${validation.requestId}`,
  );
}

function getFixedPrivateRescheduleLessonId(lesson) {
  return normalizeId(lesson && (lesson.id || lesson.lessonId ||
    lesson.fixedLessonId));
}

function getFixedPrivateRescheduleStudentId(lesson) {
  return normalizeId(lesson && (lesson.studentId || lesson.studentID));
}

function getFixedPrivateRescheduleDate(lesson) {
  return normalizeId(lesson && (lesson.date || lesson.lessonDate ||
    lesson.scheduleDate));
}

function getFixedPrivateRescheduleTime(lesson) {
  return normalizeId(lesson && (lesson.time || lesson.startTime ||
    lesson.scheduleTime));
}

function getFixedPrivateRescheduleDuration(lesson) {
  return getPrivateScheduleDurationMinutes(lesson);
}

function getFixedPrivateRescheduleWeekday(lesson) {
  const date = getFixedPrivateRescheduleDate(lesson);
  const weekday = getSeoulWeekday(date);
  return weekday ? String(weekday) : "";
}

function getFixedPrivateReschedulePackageIds(lesson) {
  return normalizeIdList([
    lesson && lesson.packageId,
    lesson && lesson.deductionPackageId,
    lesson && lesson.linkedPackageId,
    lesson && lesson.fixedPrivatePackageId,
  ]);
}

function getFixedPrivateRescheduleBatchId(lesson) {
  return normalizeId(lesson && lesson.fixedPrivateAssignmentBatchId);
}

function getFixedPrivateRescheduleTemplateId(lesson) {
  return normalizeId(lesson && lesson.privateLessonAvailabilityTemplateId);
}

function isFixedPrivateRescheduleLesson(lesson) {
  const packageType = normalizeId(lesson && lesson.packageType).toLowerCase();
  const sourceType = normalizeId(lesson && lesson.sourceType).toLowerCase();
  const source = normalizeId(lesson && lesson.source).toLowerCase();
  const reservationType = normalizeId(
      lesson && lesson.reservationType,
  ).toLowerCase();
  const hasFixedMarker =
    sourceType === "fixed-private-slot-assignment" ||
    sourceType.includes("fixed") ||
    source === "fixed_admin" ||
    reservationType === "fixed" ||
    Boolean(getFixedPrivateRescheduleBatchId(lesson)) ||
    Boolean(getFixedPrivateRescheduleTemplateId(lesson));
  return packageType === "private" && hasFixedMarker;
}

function getFixedPrivateRescheduleExcludedReason(lesson) {
  if (!isFixedPrivateRescheduleLesson(lesson)) return "not_fixed_private";
  const status = normalizeId(lesson && lesson.status).toLowerCase();
  const cancellationType = normalizeId(
      lesson && lesson.cancellationType,
  ).toLowerCase();
  const outcome = normalizeId(
      lesson && (lesson.outcome || lesson.attendanceStatus),
  ).toLowerCase();
  if (FIXED_PRIVATE_RESCHEDULE_BLOCKED_STATUSES.includes(status)) {
    return status;
  }
  if (FIXED_PRIVATE_RESCHEDULE_BLOCKED_STATUSES.includes(outcome)) {
    return outcome;
  }
  if (FIXED_PRIVATE_RESCHEDULE_BLOCKED_CANCELLATION_TYPES.includes(
      cancellationType,
  )) {
    return cancellationType;
  }
  if (lesson && lesson.isSeatReleased === true) return "seat_released";
  if (lesson && lesson.releasedForPrivateBooking === true) {
    return "releasedForPrivateBooking";
  }
  return "";
}

function summarizeFixedPrivateRescheduleLesson(lesson) {
  return {
    id: getFixedPrivateRescheduleLessonId(lesson),
    date: getFixedPrivateRescheduleDate(lesson),
    time: getFixedPrivateRescheduleTime(lesson),
    studentId: getFixedPrivateRescheduleStudentId(lesson),
    studentName: normalizeId(lesson && (lesson.studentName || lesson.student)),
    teacherName: normalizeId(lesson && (lesson.teacherName || lesson.teacher)),
    teacherKey: normalizeTeacherKey(lesson && lesson.teacherKey),
    teacherUid: normalizeId(lesson && (lesson.teacherUid ||
      lesson.teacherUID)),
    teacherId: normalizeId(lesson && (lesson.teacherId ||
      lesson.teacherID)),
    durationMinutes: getFixedPrivateRescheduleDuration(lesson),
    packageId: getFixedPrivateReschedulePackageIds(lesson)[0] || "",
    fixedPrivateAssignmentBatchId: getFixedPrivateRescheduleBatchId(lesson),
    privateLessonAvailabilityTemplateId:
      getFixedPrivateRescheduleTemplateId(lesson),
  };
}

function summarizeFixedPrivateRescheduleLiveLesson(lesson) {
  return {
    ...summarizeFixedPrivateRescheduleLesson(lesson),
    status: normalizeId((lesson && lesson.status) || "active"),
    outcome: normalizeId(lesson && (lesson.outcome || lesson.attendanceStatus)),
    cancellationType: normalizeId(lesson && lesson.cancellationType),
    privateLessonSlotId: normalizeId(lesson && (
      lesson.privateLessonSlotId || lesson.slotId
    )),
    privateLessonReservationId: normalizeId(lesson && (
      lesson.privateLessonReservationId || lesson.reservationId
    )),
    excludedReason: getFixedPrivateRescheduleExcludedReason(lesson),
  };
}

function summarizeFixedPrivateRescheduleLinkedDoc(row) {
  return {
    id: normalizeId(row && row.id),
    academyId: normalizeId(row && row.academyId),
    date: getFixedPrivateRescheduleLinkedRowDate(row),
    time: getFixedPrivateRescheduleLinkedRowTime(row),
    studentId: getPrivateRowStudentId(row),
    teacherName: normalizeId(row && (row.teacherName || row.teacher)),
    teacherKey: normalizeTeacherKey(row && row.teacherKey),
    teacherUid: normalizeId(row && (row.teacherUid || row.teacherUID)),
    durationMinutes: getPrivateScheduleDurationMinutes(row),
    status: normalizeId(row && row.status),
    lessonId: normalizeId(row && row.lessonId),
    fixedLessonId: normalizeId(row && row.fixedLessonId),
    privateLessonId: normalizeId(row && row.privateLessonId),
    linkedLessonId: normalizeId(row && row.linkedLessonId),
    reservationId: normalizeId(row && row.reservationId),
    privateLessonReservationId:
      normalizeId(row && row.privateLessonReservationId),
    linkedReservationId: normalizeId(row && row.linkedReservationId),
    packageId: normalizeId(row && (row.packageId || row.deductionPackageId)),
    templateId: normalizeId(row && (
      row.availabilityTemplateId ||
      row.privateLessonAvailabilityTemplateId
    )),
  };
}

function normalizeFixedPrivateRescheduleInspectorTarget(validation) {
  const target = validation.target || {};
  const teacher = target.targetTeacher || {};
  return {
    targetDate: normalizeId(target.targetDate),
    targetTime: normalizeId(target.targetTime),
    targetDurationMinutes: target.targetDurationMinutes || null,
    targetLessonName: normalizeId(target.targetLessonName),
    targetPackageId: normalizeId(target.targetPackageId),
    targetTeacher: target.targetTeacher ? {
      teacherId: normalizeId(teacher.teacherId),
      teacherUid: normalizeId(teacher.teacherUid),
      teacherName: normalizeId(teacher.teacherName),
      teacherKey: normalizeTeacherKey(teacher.teacherKey),
    } : null,
    hasAnyTargetChange: target.hasAnyTargetChange === true,
  };
}

function fixedPrivateRescheduleTeacherMatches(a, b) {
  const left = getPrivateTeacherScopeKeys(a);
  const right = getPrivateTeacherScopeKeys(b);
  return left.length > 0 && left.some((key) => right.includes(key));
}

function normalizeFixedPrivateRescheduleTimeValue(value) {
  const raw = normalizeId(value);
  const match = raw.match(/^(\d{1,2}):([0-5]\d)/);
  if (!match) return raw;
  const hour = Number(match[1]);
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return raw;
  return `${padTwo(hour)}:${match[2]}`;
}

function formatSeoulTimeStringFromMillis(millis) {
  if (!Number.isFinite(millis)) return "";
  const date = new Date(millis + 9 * HOUR_MS);
  return `${padTwo(date.getUTCHours())}:${padTwo(date.getUTCMinutes())}`;
}

function getFixedPrivateRescheduleLinkedRowDate(row) {
  const direct = normalizeId(row && (
    row.date ||
    row.lessonDate ||
    row.scheduleDate ||
    row.startDate
  ));
  if (direct) return direct;
  const startsAtMillis = getTimestampMillis(row && (
    row.startAt ||
    row.startsAt
  ));
  return startsAtMillis === null ?
    "" :
    formatSeoulDateStringFromMillis(startsAtMillis);
}

function getFixedPrivateRescheduleLinkedRowTime(row) {
  const direct = normalizeFixedPrivateRescheduleTimeValue(row && (
    row.time ||
    row.startTime ||
    row.lessonTime ||
    row.scheduleTime
  ));
  if (direct) return direct;
  const startsAtMillis = getTimestampMillis(row && (
    row.startAt ||
    row.startsAt
  ));
  return startsAtMillis === null ?
    "" :
    formatSeoulTimeStringFromMillis(startsAtMillis);
}

function getFixedPrivateRescheduleLinkedLessonIds(row) {
  return normalizeIdList([
    row && row.lessonId,
    row && row.fixedLessonId,
    row && row.privateLessonId,
    row && row.linkedLessonId,
  ]);
}

function getFixedPrivateRescheduleLinkedReservationIds(row) {
  return normalizeIdList([
    row && row.reservationId,
    row && row.privateLessonReservationId,
    row && row.linkedReservationId,
  ]);
}

function getFixedPrivateRescheduleLinkedSlotIds(row) {
  return normalizeIdList([
    row && row.slotId,
    row && row.privateLessonSlotId,
    row && row.linkedSlotId,
  ]);
}

function getFixedPrivateRescheduleSlotStatus(row) {
  return normalizeId(row && row.status).toLowerCase();
}

function isFixedPrivateRescheduleReservedSlotStatus(status) {
  return [
    "reserved",
    "assigned",
    "fixed_reserved",
    "fixed-assigned",
    "fixed_assignment_reserved",
  ].includes(normalizeId(status).toLowerCase());
}

function pushFailedFixedPrivateRescheduleField({
  failedFields,
  field,
  passed,
}) {
  if (!passed) failedFields.push(field);
}

function buildFixedPrivateRescheduleLinkedSlotPrecondition({
  row,
  slot,
  slotId,
}) {
  const current = slot || null;
  const expectedReservationIds = normalizeIdList([
    row && row.reservationId,
    ...((row && row.linkedReservationIds) || []),
  ]);
  const expected = {
    slotId: normalizeId(slotId || (row && row.slotId)),
    lessonId: normalizeId(row && row.id),
    studentId: normalizeId(row && row.studentId),
    date: normalizeId(row && row.date),
    time: normalizeFixedPrivateRescheduleTimeValue(row && row.time),
    durationMinutes: Number(row && row.durationMinutes) || null,
    status: "reserved",
    reservationIds: expectedReservationIds,
  };
  const currentLessonIds = current ?
    getFixedPrivateRescheduleLinkedLessonIds(current) :
    [];
  const currentReservationIds = current ?
    getFixedPrivateRescheduleLinkedReservationIds(current) :
    [];
  const currentSummary = current ? {
    slotId: normalizeId(current.id || slotId),
    academyId: normalizeId(current.academyId),
    lessonId: normalizeId(current.lessonId),
    fixedLessonId: normalizeId(current.fixedLessonId),
    privateLessonId: normalizeId(current.privateLessonId),
    linkedLessonId: normalizeId(current.linkedLessonId),
    studentId: normalizeId(current.studentId || current.studentID ||
      current.studentUid),
    reservedStudentId: normalizeId(current.reservedStudentId),
    reservedStudentUid: normalizeId(current.reservedStudentUid),
    fixedStudentId: normalizeId(current.fixedStudentId),
    fixedStudentUid: normalizeId(current.fixedStudentUid),
    assignedStudentId: normalizeId(current.assignedStudentId),
    assignedStudentUid: normalizeId(current.assignedStudentUid),
    date: getFixedPrivateRescheduleLinkedRowDate(current),
    time: normalizeFixedPrivateRescheduleTimeValue(current.time),
    startTime: normalizeFixedPrivateRescheduleTimeValue(current.startTime),
    lessonTime: normalizeFixedPrivateRescheduleTimeValue(current.lessonTime),
    durationMinutes: getPrivateScheduleDurationMinutes(current),
    status: getFixedPrivateRescheduleSlotStatus(current),
    reservationId: normalizeId(current.reservationId),
    privateLessonReservationId:
      normalizeId(current.privateLessonReservationId),
    linkedReservationId: normalizeId(current.linkedReservationId),
  } : {
    slotId: normalizeId(slotId),
  };
  const failedFields = [];
  pushFailedFixedPrivateRescheduleField({
    failedFields,
    field: "exists",
    passed: Boolean(current),
  });
  if (current) {
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "academyId",
      passed: normalizeId(current.academyId) === normalizeId(row.academyId),
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "lessonId",
      passed: currentLessonIds.length === 0 ||
        currentLessonIds.includes(expected.lessonId),
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "studentId",
      passed: getPrivateRowStudentId(current) === expected.studentId,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "date",
      passed: getFixedPrivateRescheduleLinkedRowDate(current) ===
        expected.date,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "time",
      passed: getFixedPrivateRescheduleLinkedRowTime(current) ===
        expected.time,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "durationMinutes",
      passed: getPrivateScheduleDurationMinutes(current) ===
        expected.durationMinutes,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "status",
      passed: isFixedPrivateRescheduleReservedSlotStatus(
          getFixedPrivateRescheduleSlotStatus(current),
      ),
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "reservationId",
      passed: currentReservationIds.length === 0 ||
        expectedReservationIds.length === 0 ||
        currentReservationIds.some((id) => expectedReservationIds.includes(id)),
    });
  }
  return {
    ok: failedFields.length === 0,
    reason: failedFields.length === 0 ?
      "" :
      "linked_slot_changed_before_commit",
    code: failedFields.length === 0 ?
      "" :
      "linked_slot_precondition_mismatch",
    slotId: expected.slotId || normalizeId(slotId),
    failedFields,
    expected,
    current: currentSummary,
  };
}

function getFixedPrivateRescheduleReservationStatus(row) {
  return normalizeId(row && row.status).toLowerCase();
}

function isFixedPrivateRescheduleActiveReservationStatus(status) {
  return [
    "active",
    "reserved",
    "assigned",
    "fixed_reserved",
    "fixed-assigned",
    "fixed_assignment_reserved",
  ].includes(normalizeId(status).toLowerCase());
}

function buildFixedPrivateRescheduleLinkedReservationPrecondition({
  row,
  reservation,
  reservationId,
}) {
  const current = reservation || null;
  const expectedSlotIds = normalizeIdList([
    row && row.slotId,
    ...((row && row.linkedSlotIds) || []),
  ]);
  const expected = {
    reservationId: normalizeId(reservationId || (row && row.reservationId)),
    lessonId: normalizeId(row && row.id),
    studentId: normalizeId(row && row.studentId),
    date: normalizeId(row && row.date),
    time: normalizeFixedPrivateRescheduleTimeValue(row && row.time),
    durationMinutes: Number(row && row.durationMinutes) || null,
    status: "active",
    slotIds: expectedSlotIds,
  };
  const currentLessonIds = current ?
    getFixedPrivateRescheduleLinkedLessonIds(current) :
    [];
  const currentSlotIds = current ?
    getFixedPrivateRescheduleLinkedSlotIds(current) :
    [];
  const currentSummary = current ? {
    reservationId: normalizeId(current.id || reservationId),
    academyId: normalizeId(current.academyId),
    lessonId: normalizeId(current.lessonId),
    fixedLessonId: normalizeId(current.fixedLessonId),
    privateLessonId: normalizeId(current.privateLessonId),
    linkedLessonId: normalizeId(current.linkedLessonId),
    slotId: normalizeId(current.slotId),
    privateLessonSlotId: normalizeId(current.privateLessonSlotId),
    linkedSlotId: normalizeId(current.linkedSlotId),
    studentId: normalizeId(current.studentId || current.studentID ||
      current.studentUid),
    reservedStudentId: normalizeId(current.reservedStudentId),
    fixedStudentId: normalizeId(current.fixedStudentId),
    date: getFixedPrivateRescheduleLinkedRowDate(current),
    time: normalizeFixedPrivateRescheduleTimeValue(current.time),
    startTime: normalizeFixedPrivateRescheduleTimeValue(current.startTime),
    lessonTime: normalizeFixedPrivateRescheduleTimeValue(current.lessonTime),
    durationMinutes: getPrivateScheduleDurationMinutes(current),
    status: getFixedPrivateRescheduleReservationStatus(current),
  } : {
    reservationId: normalizeId(reservationId),
  };
  const failedFields = [];
  pushFailedFixedPrivateRescheduleField({
    failedFields,
    field: "exists",
    passed: Boolean(current),
  });
  if (current) {
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "academyId",
      passed: normalizeId(current.academyId) === normalizeId(row.academyId),
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "lessonId",
      passed: currentLessonIds.length === 0 ||
        currentLessonIds.includes(expected.lessonId),
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "slotId",
      passed: currentSlotIds.length === 0 ||
        expectedSlotIds.length === 0 ||
        currentSlotIds.some((id) => expectedSlotIds.includes(id)),
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "studentId",
      passed: getPrivateRowStudentId(current) === expected.studentId,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "date",
      passed: getFixedPrivateRescheduleLinkedRowDate(current) ===
        expected.date,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "time",
      passed: getFixedPrivateRescheduleLinkedRowTime(current) ===
        expected.time,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "durationMinutes",
      passed: getPrivateScheduleDurationMinutes(current) ===
        expected.durationMinutes,
    });
    pushFailedFixedPrivateRescheduleField({
      failedFields,
      field: "status",
      passed: isFixedPrivateRescheduleActiveReservationStatus(
          getFixedPrivateRescheduleReservationStatus(current),
      ),
    });
  }
  return {
    ok: failedFields.length === 0,
    reason: failedFields.length === 0 ?
      "" :
      "linked_reservation_changed_before_commit",
    code: failedFields.length === 0 ?
      "" :
      "linked_reservation_precondition_mismatch",
    reservationId: expected.reservationId || normalizeId(reservationId),
    failedFields,
    expected,
    current: currentSummary,
  };
}

function fixedPrivateRescheduleSamePattern(a, b) {
  if (getFixedPrivateRescheduleStudentId(a) !==
      getFixedPrivateRescheduleStudentId(b)) {
    return false;
  }
  if (!fixedPrivateRescheduleTeacherMatches(a, b)) return false;
  if (getFixedPrivateRescheduleWeekday(a) !==
      getFixedPrivateRescheduleWeekday(b)) {
    return false;
  }
  if (getFixedPrivateRescheduleTime(a) !==
      getFixedPrivateRescheduleTime(b)) {
    return false;
  }
  if (getFixedPrivateRescheduleDuration(a) !==
      getFixedPrivateRescheduleDuration(b)) {
    return false;
  }
  const templateA = getFixedPrivateRescheduleTemplateId(a);
  const templateB = getFixedPrivateRescheduleTemplateId(b);
  if (templateA && templateB && templateA !== templateB) return false;
  const packageIdsA = getFixedPrivateReschedulePackageIds(a);
  const packageIdsB = getFixedPrivateReschedulePackageIds(b);
  if (packageIdsA.length > 0 && packageIdsB.length > 0) {
    return packageIdsA.some((packageId) => packageIdsB.includes(packageId));
  }
  return true;
}

function fixedPrivateReschedulePackageOverlaps(selected, candidate) {
  const selectedPackageIds = getFixedPrivateReschedulePackageIds(selected);
  const candidatePackageIds = getFixedPrivateReschedulePackageIds(candidate);
  return selectedPackageIds.length > 0 &&
    selectedPackageIds.some((packageId) =>
      candidatePackageIds.includes(packageId),
    );
}

async function loadFixedPrivateRescheduleLessonRows(db, validation, selected) {
  const studentId = getFixedPrivateRescheduleStudentId(selected);
  const snap = await db
      .collection("lessons")
      .where("academyId", "==", validation.academyId)
      .where("studentId", "==", studentId)
      .where("packageType", "==", "private")
      .limit(300)
      .get();
  const byId = new Map();
  snap.docs.forEach((docSnap) => {
    byId.set(docSnap.id, {id: docSnap.id, ...docSnap.data()});
  });
  byId.set(validation.selectedLessonId, {
    id: validation.selectedLessonId,
    ...selected,
  });
  return [...byId.values()];
}

function fixedPrivateRescheduleCandidateReason({
  validation,
  selected,
  candidate,
}) {
  const candidateDate = getFixedPrivateRescheduleDate(candidate);
  const selectedDate = getFixedPrivateRescheduleDate(selected);
  const selectedBatchId = getFixedPrivateRescheduleBatchId(selected);
  const candidateId = getFixedPrivateRescheduleLessonId(candidate);
  if (validation.scopeMode === "single") {
    return candidateId === validation.selectedLessonId ? "" : "not_selected";
  }
  if (getFixedPrivateRescheduleStudentId(candidate) !==
      getFixedPrivateRescheduleStudentId(selected)) {
    return "student_mismatch";
  }
  if (validation.scopeMode !== "date_range") {
    if (!candidateDate || !selectedDate || candidateDate < selectedDate) {
      return "before_selected_date";
    }
  }
  if (validation.scopeMode === "future_series") {
    if (selectedBatchId) {
      return getFixedPrivateRescheduleBatchId(candidate) === selectedBatchId ?
        "" :
        "batch_mismatch";
    }
    return fixedPrivateRescheduleSamePattern(selected, candidate) ?
      "" :
      "pattern_mismatch";
  }
  if (validation.scopeMode === "package_remaining") {
    return fixedPrivateReschedulePackageOverlaps(selected, candidate) ?
      "" :
      "package_mismatch";
  }
  if (validation.scopeMode === "date_range") {
    if (!candidateDate ||
        candidateDate < validation.rangeStart ||
        candidateDate > validation.rangeEnd) {
      return "outside_date_range";
    }
    return fixedPrivateRescheduleSamePattern(selected, candidate) ?
      "" :
      "pattern_mismatch";
  }
  return "unknown_scope";
}

function buildFixedPrivateRescheduleScope({
  validation,
  selected,
  rows,
}) {
  const included = [];
  const excluded = [];
  rows.forEach((candidate) => {
    const candidateId = getFixedPrivateRescheduleLessonId(candidate);
    const inactiveReason = getFixedPrivateRescheduleExcludedReason(candidate);
    const scopeReason = fixedPrivateRescheduleCandidateReason({
      validation,
      selected,
      candidate,
    });
    if (scopeReason) {
      if (candidateId === validation.selectedLessonId || !inactiveReason) {
        excluded.push({
          ...summarizeFixedPrivateRescheduleLesson(candidate),
          reason: scopeReason,
          message: scopeReason,
        });
      }
      return;
    }
    if (inactiveReason) {
      excluded.push({
        ...summarizeFixedPrivateRescheduleLesson(candidate),
        reason: inactiveReason,
        message: inactiveReason,
      });
      return;
    }
    included.push(candidate);
  });
  included.sort((a, b) => {
    const left = `${getFixedPrivateRescheduleDate(a)} ` +
      `${getFixedPrivateRescheduleTime(a)}`;
    const right = `${getFixedPrivateRescheduleDate(b)} ` +
      `${getFixedPrivateRescheduleTime(b)}`;
    return left.localeCompare(right);
  });
  return {included, excluded};
}

function getFixedPrivateRescheduleTargetForLesson({
  lesson,
  validation,
}) {
  const target = validation.target;
  const originalDate = getFixedPrivateRescheduleDate(lesson);
  const targetDate = validation.scopeMode === "single" && target.targetDate ?
    target.targetDate :
    originalDate;
  const teacher = target.targetTeacher || {};
  const originalTeacher = {
    teacherId: normalizeId(lesson && (lesson.teacherId || lesson.teacherID)),
    teacherUid: normalizeId(lesson && (lesson.teacherUid ||
      lesson.teacherUID)),
    teacherName: normalizeId(lesson && (lesson.teacherName ||
      lesson.teacher)),
    teacherKey: normalizeTeacherKey(lesson && lesson.teacherKey),
  };
  const targetTeacher = target.targetTeacher ? {
    teacherId: teacher.teacherId,
    teacherUid: teacher.teacherUid,
    teacherName: teacher.teacherName,
    teacherKey: teacher.teacherKey,
  } : originalTeacher;
  const packageId = target.targetPackageId ||
    getFixedPrivateReschedulePackageIds(lesson)[0] ||
    "";
  return {
    academyId: normalizeId(lesson && lesson.academyId),
    studentId: getFixedPrivateRescheduleStudentId(lesson),
    date: targetDate,
    time: target.targetTime || getFixedPrivateRescheduleTime(lesson),
    durationMinutes: target.targetDurationMinutes ||
      getFixedPrivateRescheduleDuration(lesson),
    lessonName: target.targetLessonName ||
      normalizeId(lesson && (lesson.subject || lesson.lessonName ||
        lesson.name || lesson.title)) ||
      "고정 1:1",
    packageId,
    ...targetTeacher,
  };
}

async function getFixedPrivateRescheduleDocById(db, collectionName, docId) {
  const safeDocId = normalizeId(docId);
  if (!safeDocId) return null;
  const snap = await db.collection(collectionName).doc(safeDocId).get();
  if (!snap.exists) return null;
  return {id: snap.id, refPath: snap.ref.path, ...snap.data()};
}

function fixedPrivateRescheduleRowsMatchFallback({
  lesson,
  row,
}) {
  if (normalizeId(row && row.academyId) !==
      normalizeId(lesson && lesson.academyId)) {
    return false;
  }
  const rowDate = getFixedPrivateRescheduleLinkedRowDate(row);
  const rowTime = getFixedPrivateRescheduleLinkedRowTime(row);
  if (rowDate !== getFixedPrivateRescheduleDate(lesson) ||
      rowTime !== getFixedPrivateRescheduleTime(lesson)) {
    return false;
  }
  const rowStudentId = getPrivateRowStudentId(row);
  if (rowStudentId !== getFixedPrivateRescheduleStudentId(lesson)) {
    return false;
  }
  if (getPrivateScheduleDurationMinutes(row) !==
      getFixedPrivateRescheduleDuration(lesson)) {
    return false;
  }
  return fixedPrivateRescheduleTeacherMatches(lesson, row);
}

async function loadFixedPrivateRescheduleLinkedRowsForLesson(db, {
  academyId,
  lesson,
}) {
  const lessonId = getFixedPrivateRescheduleLessonId(lesson);
  const slotRowsById = new Map();
  const reservationRowsById = new Map();
  const remember = (map, row) => {
    if (!row || normalizeId(row.academyId) !== academyId) return;
    map.set(row.id, row);
  };
  const directSlot = await getFixedPrivateRescheduleDocById(
      db,
      "privateLessonSlots",
      normalizeId(lesson && (lesson.privateLessonSlotId || lesson.slotId)),
  );
  remember(slotRowsById, directSlot);
  const directReservation = await getFixedPrivateRescheduleDocById(
      db,
      "privateLessonReservations",
      normalizeId(lesson && (lesson.privateLessonReservationId ||
        lesson.reservationId)),
  );
  remember(reservationRowsById, directReservation);
  const [slotByLesson, slotByFixedLesson, reservationByLesson,
    reservationByFixedLesson, fallbackSlots, fallbackReservations] =
    await Promise.all([
      db.collection("privateLessonSlots").where("lessonId", "==", lessonId)
          .limit(20).get(),
      db.collection("privateLessonSlots").where("fixedLessonId", "==", lessonId)
          .limit(20).get(),
      db.collection("privateLessonReservations").where("lessonId", "==",
          lessonId).limit(20).get(),
      db.collection("privateLessonReservations").where("fixedLessonId", "==",
          lessonId).limit(20).get(),
      db.collection("privateLessonSlots")
          .where("academyId", "==", academyId)
          .where("date", "==", getFixedPrivateRescheduleDate(lesson))
          .where("time", "==", getFixedPrivateRescheduleTime(lesson))
          .limit(50).get(),
      db.collection("privateLessonReservations")
          .where("academyId", "==", academyId)
          .where("date", "==", getFixedPrivateRescheduleDate(lesson))
          .where("time", "==", getFixedPrivateRescheduleTime(lesson))
          .limit(50).get(),
    ]);
  [slotByLesson, slotByFixedLesson].forEach((snap) => {
    snap.docs.forEach((docSnap) => remember(slotRowsById, {
      id: docSnap.id,
      refPath: docSnap.ref.path,
      ...docSnap.data(),
    }));
  });
  [reservationByLesson, reservationByFixedLesson].forEach((snap) => {
    snap.docs.forEach((docSnap) => remember(reservationRowsById, {
      id: docSnap.id,
      refPath: docSnap.ref.path,
      ...docSnap.data(),
    }));
  });
  fallbackSlots.docs.forEach((docSnap) => {
    const row = {id: docSnap.id, refPath: docSnap.ref.path, ...docSnap.data()};
    if (fixedPrivateRescheduleRowsMatchFallback({lesson, row})) {
      remember(slotRowsById, row);
    }
  });
  fallbackReservations.docs.forEach((docSnap) => {
    const row = {id: docSnap.id, refPath: docSnap.ref.path, ...docSnap.data()};
    if (fixedPrivateRescheduleRowsMatchFallback({lesson, row})) {
      remember(reservationRowsById, row);
    }
  });
  return {
    slots: [...slotRowsById.values()],
    reservations: [...reservationRowsById.values()],
  };
}

function buildFixedPrivateRescheduleIncludedRow({
  lesson,
  target,
  linked,
}) {
  const summary = summarizeFixedPrivateRescheduleLesson(lesson);
  return {
    academyId: normalizeId(lesson && lesson.academyId),
    ...summary,
    slotId: linked.slots[0] ? linked.slots[0].id : "",
    reservationId: linked.reservations[0] ? linked.reservations[0].id : "",
    linkedSlotIds: linked.slots.map((slot) => slot.id),
    linkedReservationIds: linked.reservations.map((reservation) => {
      return reservation.id;
    }),
    target,
  };
}

function fixedPrivateRescheduleTemplateTimeOverlaps(candidate, template) {
  if (String(candidate.weekday) !== String(template && template.weekday)) {
    return false;
  }
  if (!fixedPrivateRescheduleTeacherMatches(candidate, template)) return false;
  const candidateStart = getSeoulDateTimeMillis("2026-01-05", candidate.time);
  const templateStart = getSeoulDateTimeMillis(
      "2026-01-05",
      normalizeId(template && template.time),
  );
  if (candidateStart === null || templateStart === null) return false;
  const candidateEnd = candidateStart + candidate.durationMinutes * 60 * 1000;
  const templateEnd = templateStart +
    getPrivateScheduleDurationMinutes(template) * 60 * 1000;
  return candidateStart < templateEnd && templateStart < candidateEnd;
}

function fixedPrivateRescheduleTemplateRangesOverlap(candidate, template) {
  const start = normalizeId(candidate.effectiveStartDate);
  const end = normalizeId(candidate.effectiveEndDate);
  const templateStart = normalizeId(template && template.effectiveStartDate);
  const templateEnd = normalizeId(template && template.effectiveEndDate);
  const leftStart = templateStart || start;
  const leftEnd = templateEnd || end;
  return start <= leftEnd && leftStart <= end;
}

function buildFixedPrivateRescheduleTeacherTimePreparation({
  templates,
  includedLessons,
}) {
  const items = [];
  const conflicts = [];
  const uniqueCandidates = new Map();
  includedLessons.forEach((row) => {
    const target = row.target || {};
    const weekday = getSeoulWeekday(target.date);
    const key = [
      target.teacherKey || target.teacherUid || target.teacherName,
      weekday,
      target.time,
      target.durationMinutes,
    ].join("__");
    if (!uniqueCandidates.has(key)) {
      uniqueCandidates.set(key, {
        academyId: row.academyId,
        teacherKey: target.teacherKey,
        teacherUid: target.teacherUid,
        teacherName: target.teacherName,
        teacherId: target.teacherId,
        weekday,
        time: target.time,
        durationMinutes: target.durationMinutes,
        effectiveStartDate: target.date,
        effectiveEndDate: target.date,
      });
      return;
    }
    const existing = uniqueCandidates.get(key);
    if (target.date < existing.effectiveStartDate) {
      existing.effectiveStartDate = target.date;
    }
    if (target.date > existing.effectiveEndDate) {
      existing.effectiveEndDate = target.date;
    }
  });
  uniqueCandidates.forEach((candidate) => {
    if (!candidate.weekday || !candidate.time ||
        !candidate.durationMinutes ||
        getPrivateTeacherScopeKeys(candidate).length === 0) {
      items.push({status: "missing_info", candidate});
      return;
    }
    const exact = templates.filter((template) => {
      return String(template.weekday) === String(candidate.weekday) &&
        normalizeId(template.time) === candidate.time &&
        getPrivateScheduleDurationMinutes(template) ===
          candidate.durationMinutes &&
        fixedPrivateRescheduleTeacherMatches(candidate, template) &&
        fixedPrivateRescheduleTemplateRangesOverlap(candidate, template);
    });
    const activeExact = exact.filter((template) => {
      return normalizeId(template.status || "active").toLowerCase() ===
        "active";
    });
    if (activeExact.length === 1) {
      items.push({
        status: "ready",
        templateId: activeExact[0].id,
        candidate,
      });
      return;
    }
    if (activeExact.length > 1) {
      items.push({
        status: "duplicate",
        templateIds: activeExact.map((template) => template.id),
        candidate,
      });
      return;
    }
    const inactiveExact = exact.find((template) => {
      return normalizeId(template.status || "active").toLowerCase() !==
        "active";
    });
    if (inactiveExact) {
      items.push({
        status: "reactivate",
        templateId: inactiveExact.id,
        candidate,
      });
      return;
    }
    const overlap = templates.find((template) => {
      return normalizeId(template.status || "active").toLowerCase() ===
        "active" &&
        fixedPrivateRescheduleTemplateRangesOverlap(candidate, template) &&
        fixedPrivateRescheduleTemplateTimeOverlaps(candidate, template);
    });
    if (overlap) {
      conflicts.push({
        code: "teacher_template_conflict",
        templateId: overlap.id,
        message: "Target teacher time overlaps an active template.",
      });
      items.push({status: "conflict", templateId: overlap.id, candidate});
      return;
    }
    items.push({status: "create", candidate});
  });
  const statuses = items.map((item) => item.status);
  let status = "ready";
  if (statuses.includes("missing_info")) status = "missing_info";
  else if (statuses.includes("conflict")) status = "conflict";
  else if (statuses.includes("duplicate")) status = "duplicate";
  else if (statuses.includes("create")) status = "create";
  else if (statuses.includes("reactivate")) status = "reactivate";
  return {
    status,
    items,
    conflicts,
    action: status,
  };
}

async function loadFixedPrivateRescheduleConflictRows(db, {
  academyId,
  dates,
}) {
  const lessons = [];
  const slots = [];
  const reservations = [];
  await Promise.all(dates.map(async (date) => {
    const [lessonSnap, slotSnap, reservationSnap] = await Promise.all([
      db.collection("lessons")
          .where("academyId", "==", academyId)
          .where("date", "==", date)
          .limit(500)
          .get(),
      db.collection("privateLessonSlots")
          .where("academyId", "==", academyId)
          .where("date", "==", date)
          .limit(500)
          .get(),
      db.collection("privateLessonReservations")
          .where("academyId", "==", academyId)
          .where("date", "==", date)
          .limit(500)
          .get(),
    ]);
    lessonSnap.docs.forEach((docSnap) => lessons.push({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    slotSnap.docs.forEach((docSnap) => slots.push({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    reservationSnap.docs.forEach((docSnap) => reservations.push({
      id: docSnap.id,
      ...docSnap.data(),
    }));
  }));
  return {lessons, slots, reservations};
}

function buildFixedPrivateRescheduleSelfSets(includedLessons) {
  return {
    lessonIds: new Set(includedLessons.map((row) => row.id).filter(Boolean)),
    slotIds: new Set(includedLessons.flatMap((row) =>
      row.linkedSlotIds || [],
    )),
    reservationIds: new Set(includedLessons.flatMap((row) =>
      row.linkedReservationIds || [],
    )),
  };
}

function isFixedPrivateRescheduleSelfRow(row, selfSets, source) {
  const id = normalizeId(row && row.id);
  if (source === "lessons") return selfSets.lessonIds.has(id);
  if (source === "privateLessonSlots") return selfSets.slotIds.has(id);
  if (source === "privateLessonReservations") {
    return selfSets.reservationIds.has(id);
  }
  return false;
}

function buildFixedPrivateRescheduleConflicts({
  includedLessons,
  conflictRows,
}) {
  const conflicts = [];
  const selfSets = buildFixedPrivateRescheduleSelfSets(includedLessons);
  const sources = [
    {name: "lessons", rows: conflictRows.lessons},
    {name: "privateLessonSlots", rows: conflictRows.slots},
    {name: "privateLessonReservations", rows: conflictRows.reservations},
  ];
  includedLessons.forEach((included) => {
    const target = included.target;
    sources.forEach((source) => {
      source.rows.forEach((row) => {
        if (isFixedPrivateRescheduleSelfRow(row, selfSets, source.name)) {
          return;
        }
        const teacherConflict = isTeacherBlockingScheduleRow(row) &&
          privateSchedulesOverlap(target, row);
        if (teacherConflict) {
          conflicts.push({
            code: "teacher_schedule_conflict",
            source: source.name,
            id: row.id,
            lessonId: included.id,
            message: "Teacher schedule conflict.",
          });
        }
        const sameStudent = getPrivateRowStudentId(row) === included.studentId;
        const studentConflict = sameStudent &&
          privateScheduleTimeRangesOverlap(
              getPrivateScheduleTimeRange(target),
              getPrivateScheduleTimeRange(row),
          );
        if (studentConflict) {
          conflicts.push({
            code: "student_schedule_conflict",
            source: source.name,
            id: row.id,
            lessonId: included.id,
            message: "Student schedule conflict.",
          });
        }
      });
    });
  });
  return conflicts;
}

async function loadFixedPrivateReschedulePackages(db, packageIds) {
  const uniquePackageIds = normalizeIdList(packageIds);
  const packages = new Map();
  await Promise.all(uniquePackageIds.map(async (packageId) => {
    const snap = await db.collection("studentPackages").doc(packageId).get();
    if (snap.exists) packages.set(packageId, {id: snap.id, ...snap.data()});
  }));
  return packages;
}

function buildFixedPrivateReschedulePackageConflicts({
  academyId,
  includedLessons,
  packages,
}) {
  const conflicts = [];
  const warnings = [];
  includedLessons.forEach((row) => {
    const packageId = row.target && row.target.packageId;
    if (!packageId) return;
    const packageData = packages.get(packageId);
    if (!packageData) {
      warnings.push({
        code: "package_not_found",
        lessonId: row.id,
        packageId,
        message: "Package was not found for dry-run validation.",
      });
      return;
    }
    if (normalizeId(packageData.academyId) !== academyId ||
        normalizeId(packageData.studentId) !== row.studentId) {
      conflicts.push({
        code: "package_ownership_mismatch",
        lessonId: row.id,
        packageId,
        message: "Package does not belong to the selected student.",
      });
    }
    if (normalizeId(packageData.status || "active").toLowerCase() !==
        "active") {
      conflicts.push({
        code: "package_inactive",
        lessonId: row.id,
        packageId,
        message: "Package is not active.",
      });
    }
    if (!privatePackageCoversDate(packageData, row.target.date)) {
      conflicts.push({
        code: "package_period_conflict",
        lessonId: row.id,
        packageId,
        date: row.target.date,
        message: "Target date is outside package period.",
      });
    }
  });
  return {conflicts, warnings};
}

async function buildFixedPrivateReschedulePreviewResult({
  db,
  validation,
}) {
  const warnings = [];
  if (!validation.target.hasAnyTargetChange) {
    warnings.push({
      code: "no_target_change_requested",
      message: "No target change was requested; original values are used.",
    });
  }
  if (validation.scopeMode === "package_remaining") {
    warnings.push({
      code: "package_scope_may_include_multiple_patterns",
      message:
        "Package scope may include multiple lesson time patterns; server " +
        "validation is required before write.",
    });
  }
  const selectedSnap = await db
      .collection("lessons")
      .doc(validation.selectedLessonId)
      .get();
  if (!selectedSnap.exists) {
    throw new HttpsError(
        "not-found",
        "Selected fixed private lesson not found.",
    );
  }
  const selected = {id: selectedSnap.id, ...selectedSnap.data()};
  if (normalizeId(selected.academyId) !== validation.academyId) {
    throw new HttpsError(
        "permission-denied",
        "Selected fixed private lesson academy mismatch.",
    );
  }
  if (!isFixedPrivateRescheduleLesson(selected)) {
    throw new HttpsError(
        "failed-precondition",
        "Selected lesson is not a fixed private lesson.",
    );
  }
  const selectedInactiveReason = getFixedPrivateRescheduleExcludedReason(
      selected,
  );
  if (selectedInactiveReason) {
    throw new HttpsError(
        "failed-precondition",
        `Selected lesson cannot be rescheduled: ${selectedInactiveReason}.`,
    );
  }
  if (!getFixedPrivateRescheduleStudentId(selected)) {
    throw new HttpsError(
        "failed-precondition",
        "Selected lesson needs studentId.",
    );
  }
  if (getPrivateTeacherScopeKeys(selected).length === 0) {
    throw new HttpsError(
        "failed-precondition",
        "Selected lesson needs teacher identity.",
    );
  }
  if (!getFixedPrivateRescheduleDate(selected) ||
      !getFixedPrivateRescheduleTime(selected) ||
      !getFixedPrivateRescheduleDuration(selected)) {
    throw new HttpsError(
        "failed-precondition",
        "Selected lesson needs date, time, and duration.",
    );
  }
  const lessonRows = await loadFixedPrivateRescheduleLessonRows(
      db,
      validation,
      selected,
  );
  const scope = buildFixedPrivateRescheduleScope({
    validation,
    selected,
    rows: lessonRows,
  });
  const includedLessons = [];
  for (const lesson of scope.included) {
    const target = getFixedPrivateRescheduleTargetForLesson({
      lesson,
      validation,
    });
    const linked = await loadFixedPrivateRescheduleLinkedRowsForLesson(db, {
      academyId: validation.academyId,
      lesson,
    });
    if (linked.slots.length === 0) {
      warnings.push({
        code: "linked_slot_missing",
        lessonId: getFixedPrivateRescheduleLessonId(lesson),
        message: "Linked privateLessonSlot was not found.",
      });
    }
    if (linked.reservations.length === 0) {
      warnings.push({
        code: "linked_reservation_missing",
        lessonId: getFixedPrivateRescheduleLessonId(lesson),
        message: "Linked privateLessonReservation was not found.",
      });
    }
    includedLessons.push(buildFixedPrivateRescheduleIncludedRow({
      lesson,
      target,
      linked,
    }));
  }
  const targetDates = normalizeIdList(includedLessons.map((row) => {
    return row.target && row.target.date;
  }));
  const [templateSnap, conflictRows, packages] = await Promise.all([
    db.collection("privateLessonAvailabilityTemplates")
        .where("academyId", "==", validation.academyId)
        .limit(500)
        .get(),
    loadFixedPrivateRescheduleConflictRows(db, {
      academyId: validation.academyId,
      dates: targetDates,
    }),
    loadFixedPrivateReschedulePackages(
        db,
        includedLessons.map((row) => row.target && row.target.packageId),
    ),
  ]);
  const templates = templateSnap.docs.map((docSnap) => {
    return {id: docSnap.id, ...docSnap.data()};
  });
  const teacherTimePreparation =
    buildFixedPrivateRescheduleTeacherTimePreparation({
      templates,
      includedLessons,
    });
  const conflictGuardConflicts = buildFixedPrivateRescheduleConflicts({
    includedLessons,
    conflictRows,
  });
  const packageGuard = buildFixedPrivateReschedulePackageConflicts({
    academyId: validation.academyId,
    includedLessons,
    packages,
  });
  const conflicts = [
    ...teacherTimePreparation.conflicts,
    ...conflictGuardConflicts,
    ...packageGuard.conflicts,
  ];
  warnings.push(...packageGuard.warnings);
  const templateStatus = teacherTimePreparation.status;
  const ok = conflicts.length === 0 &&
    includedLessons.length > 0 &&
    !["conflict", "missing_info", "duplicate"].includes(templateStatus);
  const linkedSlotCount = includedLessons.reduce((count, row) => {
    return count + (row.linkedSlotIds || []).length;
  }, 0);
  const linkedReservationCount = includedLessons.reduce((count, row) => {
    return count + (row.linkedReservationIds || []).length;
  }, 0);
  return {
    ok,
    dryRun: true,
    previewOnly: true,
    requestId: validation.requestId,
    selectedLesson: summarizeFixedPrivateRescheduleLesson(selected),
    scopeMode: validation.scopeMode,
    includedLessons,
    excludedLessons: scope.excluded,
    teacherTimePreparation,
    wouldUpdate: {
      lessons: includedLessons.length,
      privateLessonSlots: linkedSlotCount,
      privateLessonReservations: linkedReservationCount,
      teacherTemplateAction: teacherTimePreparation.action,
    },
    conflicts,
    warnings,
    normalizedPlan: {
      targetDates,
      count: includedLessons.length,
      scopeMode: validation.scopeMode,
      from: targetDates[0] || "",
      to: targetDates[targetDates.length - 1] || "",
    },
    nextStep:
      "Frontend can show this dry-run result before enabling a later " +
      "commit flow.",
  };
}

async function getFixedPrivateRescheduleLiveLessonSummary(db, validation) {
  const lessonSnap = await db
      .collection("lessons")
      .doc(validation.selectedLessonId)
      .get();
  if (!lessonSnap.exists) {
    return {exists: false, id: validation.selectedLessonId};
  }
  return {
    exists: true,
    ...summarizeFixedPrivateRescheduleLiveLesson({
      id: lessonSnap.id,
      ...lessonSnap.data(),
    }),
  };
}

async function getFixedPrivateRescheduleInspectorLinkedDocs(db, preview) {
  const includedLessons = Array.isArray(preview.includedLessons) ?
    preview.includedLessons :
    [];
  const expectedSlotRowsById = new Map();
  const expectedReservationRowsById = new Map();
  includedLessons.forEach((row) => {
    (row.linkedSlotIds || []).forEach((slotId) => {
      expectedSlotRowsById.set(slotId, row);
    });
    (row.linkedReservationIds || []).forEach((reservationId) => {
      expectedReservationRowsById.set(reservationId, row);
    });
  });
  const slotIds = normalizeIdList(includedLessons.flatMap(
      (row) => row.linkedSlotIds || [],
  ));
  const reservationIds = normalizeIdList(
      includedLessons.flatMap(
          (row) => row.linkedReservationIds || [],
      ),
  );
  const [slotSnaps, reservationSnaps] = await Promise.all([
    Promise.all(slotIds.map((slotId) =>
      db.collection("privateLessonSlots").doc(slotId).get(),
    )),
    Promise.all(reservationIds.map((reservationId) =>
      db.collection("privateLessonReservations").doc(reservationId).get(),
    )),
  ]);
  const privateLessonSlots = slotSnaps.map((snap) => {
    const expectedRow = expectedSlotRowsById.get(snap.id) || null;
    if (!snap.exists) {
      return {
        exists: false,
        id: snap.id,
        precondition: buildFixedPrivateRescheduleLinkedSlotPrecondition({
          row: expectedRow,
          slot: null,
          slotId: snap.id,
        }),
      };
    }
    const slot = {
      id: snap.id,
      ...snap.data(),
    };
    return {
      exists: true,
      ...summarizeFixedPrivateRescheduleLinkedDoc(slot),
      precondition: buildFixedPrivateRescheduleLinkedSlotPrecondition({
        row: expectedRow,
        slot,
        slotId: snap.id,
      }),
    };
  });
  const privateLessonReservations = reservationSnaps.map((snap) => {
    const expectedRow = expectedReservationRowsById.get(snap.id) || null;
    if (!snap.exists) {
      return {
        exists: false,
        id: snap.id,
        precondition:
          buildFixedPrivateRescheduleLinkedReservationPrecondition({
            row: expectedRow,
            reservation: null,
            reservationId: snap.id,
          }),
      };
    }
    const reservation = {
      id: snap.id,
      ...snap.data(),
    };
    return {
      exists: true,
      ...summarizeFixedPrivateRescheduleLinkedDoc(reservation),
      precondition: buildFixedPrivateRescheduleLinkedReservationPrecondition({
        row: expectedRow,
        reservation,
        reservationId: snap.id,
      }),
    };
  });
  const linkedSlotPreconditionFailures = privateLessonSlots
      .map((row) => row.precondition)
      .filter((precondition) => precondition && precondition.ok !== true);
  const linkedReservationPreconditionFailures = privateLessonReservations
      .map((row) => row.precondition)
      .filter((precondition) => precondition && precondition.ok !== true);
  return {
    privateLessonSlots,
    privateLessonReservations,
    linkedSlotPreconditionFailures,
    linkedReservationPreconditionFailures,
    counts: {
      privateLessonSlots: privateLessonSlots.length,
      privateLessonReservations: privateLessonReservations.length,
      missingPrivateLessonSlots:
        privateLessonSlots.filter((row) => !row.exists).length,
      missingPrivateLessonReservations:
        privateLessonReservations.filter((row) => !row.exists).length,
      linkedSlotPreconditionFailures: linkedSlotPreconditionFailures.length,
      linkedReservationPreconditionFailures:
        linkedReservationPreconditionFailures.length,
    },
  };
}

async function getFixedPrivateRescheduleInspectorCheckpoint(db, {
  validation,
  batchIdCandidate,
}) {
  const commitPayloadHashCandidate = buildFixedPrivateReschedulePayloadHash({
    ...validation,
    commit: true,
    dryRun: false,
    previewOnly: false,
  });
  const batchSnap = await db
      .collection("fixedPrivateRescheduleBatches")
      .doc(batchIdCandidate)
      .get();
  if (!batchSnap.exists) {
    return {
      exists: false,
      code: "after_commit_batch_missing",
      batchId: batchIdCandidate,
      payloadHashCandidate: commitPayloadHashCandidate,
    };
  }
  const checkpoint = batchSnap.data() || {};
  return {
    exists: true,
    code: "checkpoint_already_exists",
    batchId: batchSnap.id,
    requestId: normalizeId(checkpoint.requestId),
    status: normalizeId(checkpoint.status),
    selectedLessonId: normalizeId(checkpoint.selectedLessonId),
    scopeMode: normalizeId(checkpoint.scopeMode),
    payloadHashMatches:
      normalizeId(checkpoint.payloadHash) === commitPayloadHashCandidate,
    updated: buildFixedPrivateRescheduleUpdatedFromCheckpoint(checkpoint),
    includedLessonIds: normalizeIdList(checkpoint.includedLessonIds),
    excludedLessons: Array.isArray(checkpoint.excludedLessons) ?
      checkpoint.excludedLessons :
      [],
    teacherTemplateId: normalizeId(checkpoint.teacherTemplateId),
    teacherTemplateAction: normalizeId(checkpoint.teacherTemplateAction),
  };
}

async function getFixedPrivateRescheduleInspectorLessonSnapshots(db, {
  academyId,
  selectedLesson,
}) {
  const sameBatchLessons = [];
  const samePackageLessons = [];
  const batchId = normalizeId(selectedLesson.fixedPrivateAssignmentBatchId);
  const packageId = normalizeId(selectedLesson.packageId);
  if (batchId) {
    const batchSnap = await db.collection("lessons")
        .where("academyId", "==", academyId)
        .where("fixedPrivateAssignmentBatchId", "==", batchId)
        .limit(100)
        .get();
    batchSnap.docs.forEach((docSnap) => {
      sameBatchLessons.push(summarizeFixedPrivateRescheduleLiveLesson({
        id: docSnap.id,
        ...docSnap.data(),
      }));
    });
  }
  if (packageId) {
    const packageSnap = await db.collection("lessons")
        .where("academyId", "==", academyId)
        .where("packageId", "==", packageId)
        .limit(100)
        .get();
    packageSnap.docs.forEach((docSnap) => {
      samePackageLessons.push(summarizeFixedPrivateRescheduleLiveLesson({
        id: docSnap.id,
        ...docSnap.data(),
      }));
    });
  }
  return {
    sameBatchLessons,
    samePackageLessons,
    counts: {
      sameBatchLessons: sameBatchLessons.length,
      samePackageLessons: samePackageLessons.length,
    },
  };
}

function buildFixedPrivateRescheduleInspectorConsistency({
  preview,
  linkedDocs,
  checkpoint,
  inspectMode,
}) {
  const conflicts = Array.isArray(preview.conflicts) ? preview.conflicts : [];
  const warnings = Array.isArray(preview.warnings) ? preview.warnings : [];
  const includedLessons = Array.isArray(preview.includedLessons) ?
    preview.includedLessons :
    [];
  const wouldUpdate = preview.wouldUpdate || {};
  const teacherTimeStatus = normalizeId(
      preview.teacherTimePreparation && preview.teacherTimePreparation.status,
  );
  const linkedSlotCountMatches =
    Number(wouldUpdate.privateLessonSlots || 0) ===
    linkedDocs.counts.privateLessonSlots;
  const linkedReservationCountMatches =
    Number(wouldUpdate.privateLessonReservations || 0) ===
    linkedDocs.counts.privateLessonReservations;
  const missingLinkedDocs =
    linkedDocs.counts.missingPrivateLessonSlots +
    linkedDocs.counts.missingPrivateLessonReservations;
  const linkedPreconditionFailures =
    Number(linkedDocs.counts.linkedSlotPreconditionFailures || 0) +
    Number(linkedDocs.counts.linkedReservationPreconditionFailures || 0);
  const checkpointBlocksBeforeCommit =
    inspectMode === "before_commit" && checkpoint.exists === true;
  const checkpointMissingAfterCommit =
    inspectMode === "after_commit" && checkpoint.exists !== true;
  return {
    ok: preview.ok === true &&
      includedLessons.length > 0 &&
      conflicts.length === 0 &&
      !["conflict", "missing_info", "duplicate"].includes(teacherTimeStatus) &&
      linkedSlotCountMatches &&
      linkedReservationCountMatches &&
      missingLinkedDocs === 0 &&
      linkedPreconditionFailures === 0 &&
      !checkpointBlocksBeforeCommit &&
      !checkpointMissingAfterCommit,
    canProceedToCommitCandidate: inspectMode !== "after_commit" &&
      preview.ok === true &&
      conflicts.length === 0 &&
      missingLinkedDocs === 0 &&
      linkedPreconditionFailures === 0 &&
      checkpoint.exists !== true,
    dryRunOk: preview.ok === true,
    inspectMode,
    includedCount: includedLessons.length,
    excludedCount: Array.isArray(preview.excludedLessons) ?
      preview.excludedLessons.length :
      0,
    conflictCount: conflicts.length,
    warningCount: warnings.length,
    linkedSlotCountMatches,
    linkedReservationCountMatches,
    missingLinkedDocs,
    linkedPreconditionFailures,
    linkedSlotPreconditionFailures:
      Number(linkedDocs.counts.linkedSlotPreconditionFailures || 0),
    linkedReservationPreconditionFailures:
      Number(linkedDocs.counts.linkedReservationPreconditionFailures || 0),
    teacherTimeStatus,
    checkpointExists: checkpoint.exists === true,
    checkpointCode: normalizeId(checkpoint.code),
    afterCommitTargetMismatch: false,
    afterCommitTargetMismatchCode: "after_commit_target_mismatch",
  };
}

async function buildFixedPrivateRescheduleInspectorResult({
  db,
  validation,
  inspectMode,
}) {
  const batchIdCandidate =
    getFixedPrivateRescheduleBatchIdCandidate(validation);
  const preview = await buildFixedPrivateReschedulePreviewResult({
    db,
    validation,
  });
  const [selectedLesson, linkedDocs, checkpoint] = await Promise.all([
    getFixedPrivateRescheduleLiveLessonSummary(db, validation),
    getFixedPrivateRescheduleInspectorLinkedDocs(db, preview),
    getFixedPrivateRescheduleInspectorCheckpoint(db, {
      validation,
      batchIdCandidate,
    }),
  ]);
  const lessonSnapshots =
    await getFixedPrivateRescheduleInspectorLessonSnapshots(db, {
      academyId: validation.academyId,
      selectedLesson,
    });
  const normalizedTarget =
    normalizeFixedPrivateRescheduleInspectorTarget(validation);
  const targetConflicts = {
    conflicts: preview.conflicts || [],
    conflictCount: (preview.conflicts || []).length,
    checkedDates: preview.normalizedPlan &&
      preview.normalizedPlan.targetDates ?
      preview.normalizedPlan.targetDates :
      [],
  };
  const targetTemplate = preview.teacherTimePreparation || {};
  const fixedPrivateRescheduleBatch = checkpoint;
  const consistency = buildFixedPrivateRescheduleInspectorConsistency({
    preview,
    linkedDocs,
    checkpoint,
    inspectMode,
  });
  const linkedPreconditionWarnings = [
    ...(linkedDocs.linkedSlotPreconditionFailures || []).map((precondition) => {
      return {
        code: "linked_slot_precondition_mismatch",
        reason: precondition.reason || "linked_slot_changed_before_commit",
        message: "Linked private lesson slot changed before commit.",
        diagnostics: precondition,
      };
    }),
    ...(linkedDocs.linkedReservationPreconditionFailures || []).map(
        (precondition) => {
          return {
            code: "linked_reservation_precondition_mismatch",
            reason: precondition.reason ||
              "linked_reservation_changed_before_commit",
            message: "Linked private lesson reservation changed before commit.",
            diagnostics: precondition,
          };
        },
    ),
  ];
  return {
    ok: true,
    readOnly: true,
    inspectOnly: true,
    inspectMode,
    dryRun: true,
    previewOnly: true,
    commit: false,
    requestId: validation.requestId,
    selectedLessonId: validation.selectedLessonId,
    scopeMode: validation.scopeMode,
    batchIdCandidate,
    selectedLesson,
    normalizedTarget,
    linkedSlot: {
      rows: linkedDocs.privateLessonSlots,
      count: linkedDocs.counts.privateLessonSlots,
      missingCount: linkedDocs.counts.missingPrivateLessonSlots,
      preconditions: linkedDocs.privateLessonSlots.map((row) => {
        return row.precondition;
      }).filter(Boolean),
    },
    linkedReservation: {
      rows: linkedDocs.privateLessonReservations,
      count: linkedDocs.counts.privateLessonReservations,
      missingCount: linkedDocs.counts.missingPrivateLessonReservations,
      preconditions: linkedDocs.privateLessonReservations.map((row) => {
        return row.precondition;
      }).filter(Boolean),
    },
    linkedDocs,
    targetTemplate,
    targetConflicts,
    targetConflictInspection: targetConflicts,
    teacherTemplateInspection: targetTemplate,
    fixedPrivateRescheduleBatch,
    checkpointInspection: fixedPrivateRescheduleBatch,
    sameBatchLessons: lessonSnapshots.sameBatchLessons,
    samePackageLessons: lessonSnapshots.samePackageLessons,
    dryRunPreview: preview,
    warnings: [
      ...((preview && preview.warnings) || []),
      ...linkedPreconditionWarnings,
    ],
    consistency,
    canProceedToCommitCandidate: consistency.canProceedToCommitCandidate,
    nextStep:
      "Review this read-only inspector result before any controlled write QA.",
  };
}

function assertFixedPrivateRescheduleCheckpointMatches({
  checkpoint,
  payloadHash,
}) {
  if (!checkpoint || checkpoint.status !== "completed") {
    throw new HttpsError(
        "failed-precondition",
        "Fixed private reschedule batch is already in progress or incomplete.",
    );
  }
  if (normalizeId(checkpoint.payloadHash) !== payloadHash) {
    throw new HttpsError(
        "already-exists",
        "requestId was already used for a different fixed private reschedule.",
    );
  }
}

function buildFixedPrivateRescheduleUpdatedFromCheckpoint(checkpoint) {
  const updated = checkpoint && checkpoint.updated ? checkpoint.updated : {};
  return {
    lessons: normalizeIdList(updated.lessons || checkpoint.updatedLessonIds),
    privateLessonSlots: normalizeIdList(
        updated.privateLessonSlots || checkpoint.updatedSlotIds,
    ),
    privateLessonReservations: normalizeIdList(
        updated.privateLessonReservations ||
        checkpoint.updatedReservationIds,
    ),
    teacherTemplateId: normalizeId(
        updated.teacherTemplateId || checkpoint.teacherTemplateId,
    ),
    teacherTemplateAction: normalizeId(
        updated.teacherTemplateAction || checkpoint.teacherTemplateAction,
    ),
  };
}

function buildFixedPrivateRescheduleResultFromCheckpoint({
  validation,
  checkpoint,
}) {
  return {
    ok: true,
    committed: true,
    dryRun: false,
    previewOnly: false,
    requestId: validation.requestId,
    batchId: validation.batchId,
    idempotentReplay: true,
    scopeMode: validation.scopeMode,
    updated: buildFixedPrivateRescheduleUpdatedFromCheckpoint(checkpoint),
    excludedLessons: checkpoint.excludedLessons || [],
    warnings: checkpoint.warnings || [],
    normalizedPlan: checkpoint.normalizedPlan || {},
    nextStep: "Fixed private lesson schedule update completed.",
  };
}

function getFixedPrivateRescheduleTemplateWritePlan({
  validation,
  teacherTimePreparation,
}) {
  const status = normalizeId(teacherTimePreparation &&
    teacherTimePreparation.status);
  if (["conflict", "missing_info", "duplicate"].includes(status)) {
    throw new HttpsError(
        "failed-precondition",
        `teacherTimePreparation.status ${status} blocks reschedule.`,
    );
  }
  const items = Array.isArray(teacherTimePreparation &&
    teacherTimePreparation.items) ?
    teacherTimePreparation.items :
    [];
  if (items.length !== 1) {
    throw new HttpsError(
        "failed-precondition",
        "Fixed private reschedule requires one teacher template target.",
    );
  }
  const item = items[0] || {};
  if (status === "create") {
    return {
      action: "create",
      templateId: sanitizeFixedPrivateRenewalDocId(
          `fixedPrivateRescheduleTemplate_${validation.academyId}_` +
          validation.requestId,
      ),
      candidate: item.candidate || {},
    };
  }
  const templateId = normalizeId(item.templateId);
  if (!templateId) {
    throw new HttpsError(
        "failed-precondition",
        "Teacher template id is required before commit.",
    );
  }
  return {
    action: status === "reactivate" ? "reactivate" : "ready",
    templateId,
    candidate: item.candidate || {},
  };
}

function throwFixedPrivateReschedulePlanError(message, details = {}) {
  throw new HttpsError("failed-precondition", message, details);
}

function assertFixedPrivateRescheduleCommitPlan({plan, validation}) {
  const conflicts = Array.isArray(plan.conflicts) ? plan.conflicts : [];
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : [];
  const includedLessons = Array.isArray(plan.includedLessons) ?
    plan.includedLessons :
    [];
  if (includedLessons.length === 0) {
    throwFixedPrivateReschedulePlanError(
        "Fixed private reschedule scope is empty.",
        {conflicts, warnings},
    );
  }
  if (conflicts.length > 0) {
    throwFixedPrivateReschedulePlanError(
        "Fixed private reschedule conflicts must be resolved before commit.",
        {conflicts, warnings},
    );
  }
  const templateStatus = normalizeId(plan.teacherTimePreparation &&
    plan.teacherTimePreparation.status);
  if (["conflict", "missing_info", "duplicate"].includes(templateStatus)) {
    throwFixedPrivateReschedulePlanError(
        `teacherTimePreparation.status ${templateStatus} blocks reschedule.`,
        {conflicts, warnings},
    );
  }
  const multiplePatternWarning = warnings.find((warning) => {
    return normalizeId(warning && warning.code) ===
      "package_scope_may_include_multiple_patterns";
  });
  if (multiplePatternWarning) {
    throwFixedPrivateReschedulePlanError(
        "package scope includes multiple patterns; use a narrower scope " +
        "before committing",
        {conflicts, warnings},
    );
  }
  includedLessons.forEach((row) => {
    if ((row.linkedSlotIds || []).length === 0) {
      throwFixedPrivateReschedulePlanError(
          "linked private lesson slot is required before commit",
          {lessonId: row.id, conflicts, warnings},
      );
    }
    if ((row.linkedReservationIds || []).length === 0) {
      throwFixedPrivateReschedulePlanError(
          "linked private lesson reservation is required before commit",
          {lessonId: row.id, conflicts, warnings},
      );
    }
    const targetDate = normalizeId(row.target && row.target.date);
    if (targetDate && targetDate !== row.date) {
      throw new HttpsError(
          "failed-precondition",
          FIXED_PRIVATE_RESCHEDULE_DATE_MOVE_DISABLED_MESSAGE,
      );
    }
  });
  if (validation.target && validation.target.targetPackageId) {
    throw new HttpsError(
        "failed-precondition",
        FIXED_PRIVATE_RESCHEDULE_PACKAGE_CHANGE_DISABLED_MESSAGE,
    );
  }
}

function assertFixedPrivateRescheduleCurrentLesson({
  row,
  lessonSnap,
  validation,
}) {
  if (!lessonSnap || !lessonSnap.exists) {
    throw new HttpsError("not-found", "Included lesson not found.");
  }
  const lesson = {id: lessonSnap.id, ...lessonSnap.data()};
  if (normalizeId(lesson.academyId) !== validation.academyId) {
    throw new HttpsError(
        "permission-denied",
        "Included lesson academy mismatch.",
    );
  }
  const inactiveReason = getFixedPrivateRescheduleExcludedReason(lesson);
  if (inactiveReason) {
    throw new HttpsError(
        "failed-precondition",
        `Included lesson cannot be rescheduled: ${inactiveReason}.`,
    );
  }
  if (getFixedPrivateRescheduleStudentId(lesson) !== row.studentId ||
      getFixedPrivateRescheduleDate(lesson) !== row.date ||
      getFixedPrivateRescheduleTime(lesson) !== row.time ||
      getFixedPrivateRescheduleDuration(lesson) !== row.durationMinutes) {
    throw new HttpsError(
        "failed-precondition",
        "Included lesson changed before commit.",
    );
  }
  return lesson;
}

function assertFixedPrivateRescheduleLinkedSlot({row, slotSnap}) {
  if (!slotSnap || !slotSnap.exists) {
    const diagnostics = buildFixedPrivateRescheduleLinkedSlotPrecondition({
      row,
      slot: null,
      slotId: slotSnap && slotSnap.id,
    });
    throw new HttpsError(
        "failed-precondition",
        "linked private lesson slot is required before commit",
        {
          reason: diagnostics.reason,
          linkedSlotPrecondition: diagnostics,
        },
    );
  }
  const slot = {id: slotSnap.id, ...slotSnap.data()};
  const diagnostics = buildFixedPrivateRescheduleLinkedSlotPrecondition({
    row,
    slot,
    slotId: slotSnap.id,
  });
  if (diagnostics.ok !== true) {
    throw new HttpsError(
        "failed-precondition",
        "Linked private lesson slot changed before commit.",
        {
          reason: "linked_slot_changed_before_commit",
          linkedSlotPrecondition: diagnostics,
        },
    );
  }
  return slot;
}

function assertFixedPrivateRescheduleLinkedReservation({row, reservationSnap}) {
  if (!reservationSnap || !reservationSnap.exists) {
    const diagnostics =
      buildFixedPrivateRescheduleLinkedReservationPrecondition({
        row,
        reservation: null,
        reservationId: reservationSnap && reservationSnap.id,
      });
    throw new HttpsError(
        "failed-precondition",
        "linked private lesson reservation is required before commit",
        {
          reason: diagnostics.reason,
          linkedReservationPrecondition: diagnostics,
        },
    );
  }
  const reservation = {id: reservationSnap.id, ...reservationSnap.data()};
  const diagnostics =
    buildFixedPrivateRescheduleLinkedReservationPrecondition({
      row,
      reservation,
      reservationId: reservationSnap.id,
    });
  if (diagnostics.ok !== true) {
    throw new HttpsError(
        "failed-precondition",
        "Linked private lesson reservation changed before commit.",
        {
          reason: "linked_reservation_changed_before_commit",
          linkedReservationPrecondition: diagnostics,
        },
    );
  }
  return reservation;
}

async function loadFixedPrivateRescheduleConflictRowsInTransaction(
    transaction,
    db,
    {
      academyId,
      dates,
    },
) {
  const lessons = [];
  const slots = [];
  const reservations = [];
  for (const date of dates) {
    const [lessonSnap, slotSnap, reservationSnap] = await Promise.all([
      transaction.get(db.collection("lessons")
          .where("academyId", "==", academyId)
          .where("date", "==", date)
          .limit(500)),
      transaction.get(db.collection("privateLessonSlots")
          .where("academyId", "==", academyId)
          .where("date", "==", date)
          .limit(500)),
      transaction.get(db.collection("privateLessonReservations")
          .where("academyId", "==", academyId)
          .where("date", "==", date)
          .limit(500)),
    ]);
    lessonSnap.docs.forEach((docSnap) => lessons.push({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    slotSnap.docs.forEach((docSnap) => slots.push({
      id: docSnap.id,
      ...docSnap.data(),
    }));
    reservationSnap.docs.forEach((docSnap) => reservations.push({
      id: docSnap.id,
      ...docSnap.data(),
    }));
  }
  return {lessons, slots, reservations};
}

async function loadFixedPrivateReschedulePackagesInTransaction(
    transaction,
    db,
    packageIds,
) {
  const uniquePackageIds = normalizeIdList(packageIds);
  const packages = new Map();
  const snaps = await Promise.all(uniquePackageIds.map((packageId) => {
    return transaction.get(db.collection("studentPackages").doc(packageId));
  }));
  snaps.forEach((snap) => {
    if (snap.exists) packages.set(snap.id, {id: snap.id, ...snap.data()});
  });
  return packages;
}

function buildFixedPrivateRescheduleTeacherPatch(target) {
  const teacher = normalizeId(
      target.teacherKey ||
      target.teacherUid ||
      target.teacherName ||
      target.teacherId,
  );
  return {
    teacher,
    teacherName: normalizeId(target.teacherName || teacher),
    teacherKey: normalizeTeacherKey(target.teacherKey || teacher),
    teacherUid: normalizeId(target.teacherUid),
    teacherUID: normalizeId(target.teacherUid),
    teacherId: normalizeId(target.teacherId),
  };
}

function buildFixedPrivateRescheduleLessonPatch({
  row,
  templateId,
  batchId,
  actor,
  now,
}) {
  const target = row.target || {};
  const startAt = timestampFromMillis(
      getSeoulDateTimeMillis(row.date, target.time),
  );
  const patch = {
    date: row.date,
    scheduleDate: row.date,
    time: target.time,
    startTime: target.time,
    scheduleTime: target.time,
    durationMinutes: target.durationMinutes,
    subject: target.lessonName,
    lessonName: target.lessonName,
    title: target.lessonName,
    ...buildFixedPrivateRescheduleTeacherPatch(target),
    privateLessonAvailabilityTemplateId: templateId,
    fixedPrivateRescheduleBatchId: batchId,
    rescheduleBatchId: batchId,
    status: "active",
    updatedAt: now,
    updatedBy: actor.actorUid,
    updatedByUid: actor.actorUid,
    updatedByName: actor.actorName,
  };
  if (startAt) {
    patch.startAt = startAt;
    patch.startsAt = startAt;
  }
  return patch;
}

function buildFixedPrivateRescheduleSlotPatch({
  row,
  templateId,
  batchId,
  actor,
  now,
}) {
  const target = row.target || {};
  const startAt = timestampFromMillis(
      getSeoulDateTimeMillis(row.date, target.time),
  );
  const patch = {
    date: row.date,
    time: target.time,
    startTime: target.time,
    durationMinutes: target.durationMinutes,
    ...buildFixedPrivateRescheduleTeacherPatch(target),
    privateLessonAvailabilityTemplateId: templateId,
    fixedPrivateRescheduleBatchId: batchId,
    status: "reserved",
    openForStudentBooking: false,
    isBookable: false,
    useForFixedAssignment: true,
    updatedAt: now,
    updatedBy: actor.actorUid,
    updatedByUid: actor.actorUid,
    updatedByName: actor.actorName,
  };
  if (startAt) patch.startAt = startAt;
  return patch;
}

function buildFixedPrivateRescheduleReservationPatch({
  row,
  templateId,
  batchId,
  actor,
  now,
}) {
  const target = row.target || {};
  return {
    date: row.date,
    time: target.time,
    startTime: target.time,
    durationMinutes: target.durationMinutes,
    subject: target.lessonName,
    lessonName: target.lessonName,
    title: target.lessonName,
    ...buildFixedPrivateRescheduleTeacherPatch(target),
    privateLessonAvailabilityTemplateId: templateId,
    fixedPrivateRescheduleBatchId: batchId,
    status: "active",
    updatedAt: now,
    updatedBy: actor.actorUid,
    updatedByUid: actor.actorUid,
    updatedByName: actor.actorName,
  };
}

function buildFixedPrivateRescheduleTemplatePayload({
  validation,
  templatePlan,
  actor,
  now,
}) {
  const candidate = templatePlan.candidate || {};
  return {
    academyId: validation.academyId,
    teacher: candidate.teacherKey ||
      candidate.teacherUid ||
      candidate.teacherName,
    teacherId: normalizeId(candidate.teacherId),
    teacherUid: normalizeId(candidate.teacherUid),
    teacherName: normalizeId(candidate.teacherName),
    teacherKey: normalizeTeacherKey(candidate.teacherKey),
    weekday: Number(candidate.weekday),
    time: normalizeId(candidate.time),
    startTime: normalizeId(candidate.time),
    durationMinutes: Number(candidate.durationMinutes),
    status: "active",
    effectiveStartDate: normalizeId(candidate.effectiveStartDate),
    effectiveEndDate: normalizeId(candidate.effectiveEndDate),
    useForFixedAssignment: true,
    openForStudentBooking: false,
    sourceType: "fixed-private-reschedule",
    fixedPrivateRescheduleBatchId: validation.batchId,
    createdAt: now,
    createdBy: actor.actorUid,
    createdByUid: actor.actorUid,
    createdByName: actor.actorName,
    updatedAt: now,
    updatedBy: actor.actorUid,
    updatedByUid: actor.actorUid,
    updatedByName: actor.actorName,
  };
}

function buildFixedPrivateRescheduleCommitResult({
  validation,
  updated,
  excludedLessons,
  warnings,
  normalizedPlan,
  idempotentReplay = false,
}) {
  return {
    ok: true,
    committed: true,
    dryRun: false,
    previewOnly: false,
    requestId: validation.requestId,
    batchId: validation.batchId,
    idempotentReplay,
    scopeMode: validation.scopeMode,
    updated,
    excludedLessons,
    warnings,
    normalizedPlan,
    nextStep: "Fixed private lesson schedule update completed.",
  };
}

async function runFixedPrivateRescheduleWriteTransaction({
  db,
  auth,
  membership,
  validation,
}) {
  const initialPlan = await buildFixedPrivateReschedulePreviewResult({
    db,
    validation,
  });
  assertFixedPrivateRescheduleCommitPlan({plan: initialPlan, validation});
  const payloadHash = buildFixedPrivateReschedulePayloadHash(validation);
  const actor = buildAdminActorContext(auth, membership);
  const batchRef = db.collection("fixedPrivateRescheduleBatches")
      .doc(validation.batchId);
  return db.runTransaction(async (transaction) => {
    const batchSnap = await transaction.get(batchRef);
    if (batchSnap.exists) {
      const checkpoint = batchSnap.data() || {};
      assertFixedPrivateRescheduleCheckpointMatches({
        checkpoint,
        payloadHash,
      });
      return buildFixedPrivateRescheduleResultFromCheckpoint({
        validation,
        checkpoint,
      });
    }

    const includedLessons = initialPlan.includedLessons || [];
    const includedLessonIds = includedLessons.map((row) => row.id);
    const updatedSlotIds = normalizeIdList(includedLessons.flatMap((row) => {
      return row.linkedSlotIds || [];
    }));
    const updatedReservationIds = normalizeIdList(
        includedLessons.flatMap((row) => {
          return row.linkedReservationIds || [];
        }),
    );
    const lessonSnaps = await Promise.all(includedLessonIds.map((lessonId) => {
      return transaction.get(db.collection("lessons").doc(lessonId));
    }));
    const slotSnaps = await Promise.all(updatedSlotIds.map((slotId) => {
      return transaction.get(db.collection("privateLessonSlots").doc(slotId));
    }));
    const reservationSnaps = await Promise.all(updatedReservationIds.map(
        (reservationId) => {
          return transaction.get(
              db.collection("privateLessonReservations").doc(reservationId),
          );
        },
    ));
    const lessonSnapById = new Map(lessonSnaps.map((snap) => [snap.id, snap]));
    const slotSnapById = new Map(slotSnaps.map((snap) => [snap.id, snap]));
    const reservationSnapById =
      new Map(reservationSnaps.map((snap) => [snap.id, snap]));

    includedLessons.forEach((row) => {
      assertFixedPrivateRescheduleCurrentLesson({
        row,
        lessonSnap: lessonSnapById.get(row.id),
        validation,
      });
      (row.linkedSlotIds || []).forEach((slotId) => {
        assertFixedPrivateRescheduleLinkedSlot({
          row,
          slotSnap: slotSnapById.get(slotId),
        });
      });
      (row.linkedReservationIds || []).forEach((reservationId) => {
        assertFixedPrivateRescheduleLinkedReservation({
          row,
          reservationSnap: reservationSnapById.get(reservationId),
        });
      });
    });

    const targetDates = normalizeIdList(includedLessons.map((row) => {
      return row.target && row.target.date;
    }));
    const [templateSnap, conflictRows, packages] = await Promise.all([
      transaction.get(db.collection("privateLessonAvailabilityTemplates")
          .where("academyId", "==", validation.academyId)
          .limit(500)),
      loadFixedPrivateRescheduleConflictRowsInTransaction(
          transaction,
          db,
          {
            academyId: validation.academyId,
            dates: targetDates,
          },
      ),
      loadFixedPrivateReschedulePackagesInTransaction(
          transaction,
          db,
          includedLessons.map((row) => row.target && row.target.packageId),
      ),
    ]);
    const templates = templateSnap.docs.map((docSnap) => {
      return {id: docSnap.id, ...docSnap.data()};
    });
    const teacherTimePreparation =
      buildFixedPrivateRescheduleTeacherTimePreparation({
        templates,
        includedLessons,
      });
    const conflictGuardConflicts = buildFixedPrivateRescheduleConflicts({
      includedLessons,
      conflictRows,
    });
    const packageGuard = buildFixedPrivateReschedulePackageConflicts({
      academyId: validation.academyId,
      includedLessons,
      packages,
    });
    const warnings = [
      ...(initialPlan.warnings || []),
      ...packageGuard.warnings,
    ];
    const transactionPlan = {
      ...initialPlan,
      teacherTimePreparation,
      conflicts: [
        ...teacherTimePreparation.conflicts,
        ...conflictGuardConflicts,
        ...packageGuard.conflicts,
      ],
      warnings,
    };
    assertFixedPrivateRescheduleCommitPlan({
      plan: transactionPlan,
      validation,
    });

    const templatePlan = getFixedPrivateRescheduleTemplateWritePlan({
      validation,
      teacherTimePreparation,
    });
    const templateRef = db.collection("privateLessonAvailabilityTemplates")
        .doc(templatePlan.templateId);
    if (templatePlan.action === "create") {
      const newTemplateSnap = await transaction.get(templateRef);
      if (newTemplateSnap.exists) {
        throw new HttpsError(
            "already-exists",
            "Deterministic teacher template already exists.",
        );
      }
    }

    const now = admin.firestore.FieldValue.serverTimestamp();
    if (templatePlan.action === "create") {
      transaction.set(templateRef, buildFixedPrivateRescheduleTemplatePayload({
        validation,
        templatePlan,
        actor,
        now,
      }));
    } else if (templatePlan.action === "reactivate") {
      transaction.update(templateRef, {
        status: "active",
        useForFixedAssignment: true,
        openForStudentBooking: false,
        fixedPrivateRescheduleBatchId: validation.batchId,
        updatedAt: now,
        updatedBy: actor.actorUid,
        updatedByUid: actor.actorUid,
        updatedByName: actor.actorName,
      });
    }

    includedLessons.forEach((row) => {
      transaction.update(
          db.collection("lessons").doc(row.id),
          buildFixedPrivateRescheduleLessonPatch({
            row,
            templateId: templatePlan.templateId,
            batchId: validation.batchId,
            actor,
            now,
          }),
      );
      (row.linkedSlotIds || []).forEach((slotId) => {
        transaction.update(
            db.collection("privateLessonSlots").doc(slotId),
            buildFixedPrivateRescheduleSlotPatch({
              row,
              templateId: templatePlan.templateId,
              batchId: validation.batchId,
              actor,
              now,
            }),
        );
      });
      (row.linkedReservationIds || []).forEach((reservationId) => {
        transaction.update(
            db.collection("privateLessonReservations").doc(reservationId),
            buildFixedPrivateRescheduleReservationPatch({
              row,
              templateId: templatePlan.templateId,
              batchId: validation.batchId,
              actor,
              now,
            }),
        );
      });
    });

    const updated = {
      lessons: includedLessonIds,
      privateLessonSlots: updatedSlotIds,
      privateLessonReservations: updatedReservationIds,
      teacherTemplateId: templatePlan.templateId,
      teacherTemplateAction: templatePlan.action,
    };
    const checkpoint = {
      academyId: validation.academyId,
      requestId: validation.requestId,
      payloadHash,
      status: "completed",
      selectedLessonId: validation.selectedLessonId,
      scopeMode: validation.scopeMode,
      includedLessonIds,
      excludedLessons: initialPlan.excludedLessons || [],
      updatedLessonIds: updated.lessons,
      updatedSlotIds: updated.privateLessonSlots,
      updatedReservationIds: updated.privateLessonReservations,
      teacherTemplateId: templatePlan.templateId,
      teacherTemplateAction: templatePlan.action,
      target: validation.target,
      updated,
      warnings,
      normalizedPlan: initialPlan.normalizedPlan || {},
      sourceType: "fixed-private-reschedule",
      createdAt: now,
      createdBy: actor.actorUid,
      createdByUid: actor.actorUid,
      createdByName: actor.actorName,
      completedAt: now,
    };
    transaction.set(batchRef, checkpoint);

    return buildFixedPrivateRescheduleCommitResult({
      validation,
      updated,
      excludedLessons: checkpoint.excludedLessons,
      warnings,
      normalizedPlan: checkpoint.normalizedPlan,
    });
  });
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

async function requireAcademyOwner(db, academyId, uid) {
  const membershipId = `${academyId}_${uid}`;
  const membershipSnap = await db
      .collection("academyMemberships")
      .doc(membershipId)
      .get();
  const membership = membershipSnap.exists ? membershipSnap.data() || {} : null;
  const role = String((membership && membership.role) || "")
      .trim()
      .toLowerCase();
  const status = String((membership && membership.status) || "")
      .trim()
      .toLowerCase();
  if (!membership || status !== "active" || role !== "owner") {
    throw new HttpsError(
        "permission-denied",
        "Active academy owner membership required.",
    );
  }
  return {
    ...membership,
    role,
    status,
  };
}

function getCallableActorName(auth, membership) {
  return normalizeId(membership && (
    membership.displayName ||
    membership.name ||
    membership.teacherName ||
    membership.email
  )) ||
    normalizeId(auth && auth.token && (auth.token.name || auth.token.email)) ||
    normalizeId(auth && auth.uid);
}

function buildAdminActorContext(auth, membership) {
  return {
    actorRole: "admin",
    actorUid: normalizeId(auth && auth.uid),
    actorName: getCallableActorName(auth, membership),
  };
}

const PRIVATE_LESSON_STATUS_ACTIONS = {
  complete: "수업완료",
  no_show: "결석/노쇼",
  reverse_deduction: "차감취소",
};

const PRIVATE_LESSON_STATUS_ACTIVE_STATUSES = [
  "",
  "active",
  "reserved",
  "assigned",
  "scheduled",
  "booked",
  "confirmed",
  "open",
];

const PRIVATE_LESSON_STATUS_BLOCKED_STATUSES = [
  "completed",
  "no_show",
  "no-show",
  "cancelled",
  "canceled",
  "seat_released",
  "released",
  "deleted",
  "archived",
];

function getPrivateStatusActionPermission(membership, permissionKey) {
  const permissions = membership &&
    typeof membership.permissions === "object" ?
    membership.permissions :
    {};
  return permissions[permissionKey] === true;
}

function buildTeacherStatusActor(auth, membership) {
  return {
    actorRole: "teacher",
    actorUid: normalizeId(auth && auth.uid),
    actorName: getCallableActorName(auth, membership),
    teacherKeys: getPrivateTeacherScopeKeys({
      teacherName: membership && membership.teacherName,
      teacher: membership && membership.teacherName,
      teacherKey: membership && membership.teacherKey,
      teacherUid: normalizeId(auth && auth.uid),
      teacherEmail: auth && auth.token && auth.token.email,
      displayName: membership && membership.displayName,
      name: membership && membership.name,
    }),
    permissions: {
      canManageOwnLessonDeductions: getPrivateStatusActionPermission(
          membership,
          "canManageOwnLessonDeductions",
      ),
      canReverseOwnPrivateLessonDeduction: getPrivateStatusActionPermission(
          membership,
          "canReverseOwnPrivateLessonDeduction",
      ),
    },
  };
}

async function resolvePrivateLessonStatusActor(db, academyId, auth) {
  const uid = normalizeId(auth && auth.uid);
  const membershipSnap = await db
      .collection("academyMemberships")
      .doc(`${academyId}_${uid}`)
      .get();
  const membership = membershipSnap.exists ? membershipSnap.data() || {} : null;
  const role = String((membership && membership.role) || "")
      .trim()
      .toLowerCase();
  const status = String((membership && membership.status) || "")
      .trim()
      .toLowerCase();
  if (!membership || status !== "active") {
    return {
      uid,
      role: role || "",
      isAdmin: false,
      isTeacher: false,
      allowed: false,
      permissionSource: "membership_inactive_or_missing",
      blockedReason: "permission_denied",
    };
  }
  if (role === "owner" || role === "admin") {
    const adminActor = buildAdminActorContext(auth, {...membership, role});
    return {
      uid,
      role: "admin",
      isAdmin: true,
      isTeacher: false,
      allowed: true,
      permissionSource: "academy_admin",
      ...adminActor,
    };
  }
  if (role === "teacher" || role === "staff") {
    return {
      uid,
      role,
      isAdmin: false,
      isTeacher: true,
      allowed: false,
      permissionSource: "teacher_membership",
      ...buildTeacherStatusActor(auth, {...membership, role}),
    };
  }
  return {
    uid,
    role,
    isAdmin: false,
    isTeacher: false,
    allowed: false,
    permissionSource: "unsupported_membership_role",
    blockedReason: "permission_denied",
  };
}

function privateLessonStatusDocSummary(docId, data = {}) {
  const status = normalizeId(data.status);
  return {
    id: normalizeId(docId),
    exists: Boolean(docId && data),
    status,
    date: normalizeId(data.date || data.lessonDate || data.scheduleDate),
    time: normalizeId(data.time || data.startTime),
    studentId: normalizeId(data.studentId || data.studentID),
    studentName: normalizeId(data.studentName || data.student),
    teacherUid: normalizeId(
        data.teacherUid || data.teacherUID || data.teacherId,
    ),
    teacherName: normalizeId(data.teacherName || data.teacher),
    packageId: normalizeId(data.packageId),
    deductionPackageId: normalizeId(data.deductionPackageId),
    deductionApplied: data.deductionApplied === true,
    deductionReversed: data.deductionReversed === true ||
      data.deductionCanceled === true ||
      data.isDeductCancelled === true,
    slotId: normalizeId(data.slotId || data.privateLessonSlotId),
    reservationId: normalizeId(
        data.reservationId || data.privateLessonReservationId,
    ),
    lessonId: normalizeId(data.lessonId || data.fixedLessonId),
    sourceType: normalizeId(data.sourceType),
    packageType: normalizeId(data.packageType),
    fixedPrivateAssignmentBatchId: normalizeId(
        data.fixedPrivateAssignmentBatchId,
    ),
    privateLessonAvailabilityTemplateId: normalizeId(
        data.privateLessonAvailabilityTemplateId,
    ),
  };
}

function privateLessonStatusPackageSummary(docId, data = {}) {
  return {
    id: normalizeId(docId),
    exists: Boolean(docId && data),
    status: normalizeId(data.status),
    studentId: normalizeId(data.studentId),
    studentName: normalizeId(data.studentName),
    teacherUid: normalizeId(
        data.teacherUid || data.teacherUID || data.teacherId,
    ),
    teacherName: normalizeId(data.teacherName || data.teacher),
    packageId: normalizeId(docId),
    packageType: normalizeId(data.packageType),
    currentUsedCount: Number(data.usedCount || 0),
    currentRemainingCount: Number(data.remainingCount || 0),
    totalCount: Number(data.totalCount || 0),
  };
}

async function fetchPrivateLessonStatusDoc(db, collectionName, docId) {
  const id = normalizeId(docId);
  if (!id) return {id: "", exists: false, data: null};
  const snap = await db.collection(collectionName).doc(id).get();
  return {
    id,
    exists: snap.exists,
    data: snap.exists ? snap.data() || {} : null,
  };
}

async function findPrivateLessonStatusReservationByLesson(
    db,
    academyId,
    lessonId,
) {
  const normalizedLessonId = normalizeId(lessonId);
  if (!normalizedLessonId) return null;
  const snap = await db
      .collection("privateLessonReservations")
      .where("academyId", "==", academyId)
      .where("lessonId", "==", normalizedLessonId)
      .limit(2)
      .get();
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return {id: docSnap.id, exists: true, data: docSnap.data() || {}};
}

async function findPrivateLessonStatusReservationBySlot(
    db,
    academyId,
    slotId,
) {
  const normalizedSlotId = normalizeId(slotId);
  if (!normalizedSlotId) return null;
  const snap = await db
      .collection("privateLessonReservations")
      .where("academyId", "==", academyId)
      .where("slotId", "==", normalizedSlotId)
      .limit(2)
      .get();
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return {id: docSnap.id, exists: true, data: docSnap.data() || {}};
}

async function fetchPrivateLessonStatusCreditCandidates({
  db,
  academyId,
  lessonId,
  reservationId,
  packageId,
  directIds = [],
}) {
  const candidatesById = {};
  for (const directId of directIds.map(normalizeId).filter(Boolean)) {
    const snap = await db.collection("creditTransactions").doc(directId).get();
    candidatesById[directId] = {
      id: directId,
      exists: snap.exists,
      actionType: snap.exists ?
        normalizeId((snap.data() || {}).actionType) :
        "",
      sourceType: snap.exists ?
        normalizeId((snap.data() || {}).sourceType) :
        "",
      sourceId: snap.exists ? normalizeId((snap.data() || {}).sourceId) : "",
      packageId: snap.exists ? normalizeId((snap.data() || {}).packageId) : "",
      deltaCount: snap.exists ? Number((snap.data() || {}).deltaCount || 0) : 0,
    };
  }
  const sourceIds = [reservationId, lessonId].map(normalizeId).filter(Boolean);
  for (const sourceId of sourceIds) {
    const snap = await db
        .collection("creditTransactions")
        .where("academyId", "==", academyId)
        .where("sourceId", "==", sourceId)
        .limit(5)
        .get();
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (packageId && normalizeId(data.packageId) !== packageId) return;
      candidatesById[docSnap.id] = {
        id: docSnap.id,
        exists: true,
        actionType: normalizeId(data.actionType),
        sourceType: normalizeId(data.sourceType),
        sourceId: normalizeId(data.sourceId),
        packageId: normalizeId(data.packageId),
        deltaCount: Number(data.deltaCount || 0),
      };
    });
  }
  return Object.values(candidatesById);
}

async function resolvePrivateLessonStatusTarget({db, academyId, data}) {
  const initialLessonId = optionalString(data, "lessonId");
  const initialReservationId = optionalString(data, "reservationId");
  const initialSlotId = optionalString(data, "slotId");
  let lessonDoc = await fetchPrivateLessonStatusDoc(
      db,
      "lessons",
      initialLessonId,
  );
  let reservationDoc = await fetchPrivateLessonStatusDoc(
      db,
      "privateLessonReservations",
      initialReservationId,
  );
  let slotDoc = await fetchPrivateLessonStatusDoc(
      db,
      "privateLessonSlots",
      initialSlotId,
  );
  if (lessonDoc.exists && !reservationDoc.exists) {
    const linkedReservationId = normalizeId(
        lessonDoc.data.reservationId ||
        lessonDoc.data.privateLessonReservationId,
    );
    reservationDoc = await fetchPrivateLessonStatusDoc(
        db,
        "privateLessonReservations",
        linkedReservationId,
    );
  }
  if (reservationDoc.exists && !lessonDoc.exists) {
    lessonDoc = await fetchPrivateLessonStatusDoc(
        db,
        "lessons",
        reservationDoc.data.lessonId || reservationDoc.data.fixedLessonId,
    );
  }
  if (!reservationDoc.exists && lessonDoc.exists) {
    reservationDoc =
      await findPrivateLessonStatusReservationByLesson(
          db,
          academyId,
          lessonDoc.id,
      ) || reservationDoc;
  }
  const linkedSlotId = normalizeId(
      initialSlotId ||
      (lessonDoc.exists && (
        lessonDoc.data.slotId || lessonDoc.data.privateLessonSlotId
      )) ||
      (reservationDoc.exists && (
        reservationDoc.data.slotId || reservationDoc.data.privateLessonSlotId
      )),
  );
  if (linkedSlotId && !slotDoc.exists) {
    slotDoc = await fetchPrivateLessonStatusDoc(
        db,
        "privateLessonSlots",
        linkedSlotId,
    );
  }
  if (!reservationDoc.exists && slotDoc.exists) {
    const slotReservationId = normalizeId(slotDoc.data.reservationId);
    reservationDoc = await fetchPrivateLessonStatusDoc(
        db,
        "privateLessonReservations",
        slotReservationId,
    );
    if (!reservationDoc.exists) {
      reservationDoc =
        await findPrivateLessonStatusReservationBySlot(
            db,
            academyId,
            slotDoc.id,
        ) || reservationDoc;
    }
  }
  const packageId = normalizeId(
      (reservationDoc.exists && (
        reservationDoc.data.deductionPackageId ||
        reservationDoc.data.packageId ||
        reservationDoc.data.linkedPackageId ||
        reservationDoc.data.fixedPrivatePackageId
      )) ||
      (lessonDoc.exists && (
        lessonDoc.data.deductionPackageId ||
        lessonDoc.data.packageId ||
        lessonDoc.data.linkedPackageId ||
        lessonDoc.data.fixedPrivatePackageId
      )) ||
      (slotDoc.exists && (
        slotDoc.data.packageId ||
        slotDoc.data.linkedPackageId ||
        slotDoc.data.fixedPrivatePackageId
      )),
  );
  const packageDoc = await fetchPrivateLessonStatusDoc(
      db,
      "studentPackages",
      packageId,
  );
  const creditTransactionCandidates =
    await fetchPrivateLessonStatusCreditCandidates({
      db,
      academyId,
      lessonId: lessonDoc.id,
      reservationId: reservationDoc.id,
      packageId,
      directIds: [
        reservationDoc.exists && (
          reservationDoc.data.deductionCreditTransactionId ||
          reservationDoc.data.deductionTransactionId
        ),
        lessonDoc.exists && (
          lessonDoc.data.deductionCreditTransactionId ||
          lessonDoc.data.deductionTransactionId
        ),
      ],
    });
  return {
    lessonDoc,
    reservationDoc,
    slotDoc,
    packageDoc,
    packageId,
    creditTransactionCandidates,
  };
}

function isTeacherOwnPrivateLessonTarget(actor, target) {
  if (!actor || actor.isTeacher !== true) return false;
  const actorKeys = Array.isArray(actor.teacherKeys) ? actor.teacherKeys : [];
  if (actorKeys.length === 0) return false;
  const targetKeys = getPrivateTeacherScopeKeys(
      target.lessonDoc && target.lessonDoc.data,
      target.reservationDoc && target.reservationDoc.data,
      target.slotDoc && target.slotDoc.data,
      target.packageDoc && target.packageDoc.data,
  );
  return targetKeys.length > 0 &&
    targetKeys.some((key) => actorKeys.includes(key));
}

function canPreviewPrivateLessonStatusAction({actor, actionType, target}) {
  if (actor.isAdmin) {
    return {allowed: true, permissionSource: "academy_admin"};
  }
  if (!actor.isTeacher) {
    return {
      allowed: false,
      permissionSource: actor.permissionSource,
      blockedReason: "permission_denied",
    };
  }
  if (!isTeacherOwnPrivateLessonTarget(actor, target)) {
    return {
      allowed: false,
      permissionSource: "teacher_target_scope",
      blockedReason: "teacher_not_owner",
    };
  }
  if (actionType === "reverse_deduction") {
    if (actor.permissions.canReverseOwnPrivateLessonDeduction === true) {
      return {
        allowed: true,
        permissionSource: "canReverseOwnPrivateLessonDeduction",
      };
    }
    return {
      allowed: false,
      permissionSource: "canReverseOwnPrivateLessonDeduction",
      blockedReason: "teacher_permission_missing",
    };
  }
  if (actor.permissions.canManageOwnLessonDeductions === true) {
    return {
      allowed: true,
      permissionSource: "canManageOwnLessonDeductions",
    };
  }
  return {
    allowed: false,
    permissionSource: "canManageOwnLessonDeductions",
    blockedReason: "teacher_permission_missing",
  };
}

function getPrivateLessonStatusValue(target) {
  return String(
      (target.reservationDoc.exists && target.reservationDoc.data.status) ||
      (target.lessonDoc.exists && target.lessonDoc.data.status) ||
      (target.slotDoc.exists && target.slotDoc.data.status) ||
      "",
  ).trim().toLowerCase();
}

function getPrivateLessonStatusBlockedReason(target) {
  const status = getPrivateLessonStatusValue(target);
  const cancellationType = String(
      (target.lessonDoc.exists && target.lessonDoc.data.cancellationType) ||
      (target.reservationDoc.exists &&
        target.reservationDoc.data.cancellationType) ||
      (target.slotDoc.exists && target.slotDoc.data.cancellationType) ||
      "",
  ).trim().toLowerCase();
  if (status === "completed") return "already_completed";
  if (status === "no_show" || status === "no-show") return "already_no_show";
  if (["cancelled", "canceled"].includes(status)) return "cancelled_lesson";
  if (["seat_released", "released"].includes(status)) {
    return "seat_released_lesson";
  }
  if (cancellationType === "seat_released") return "seat_released_lesson";
  const lesson = target.lessonDoc.exists ? target.lessonDoc.data : {};
  const reservation = target.reservationDoc.exists ?
    target.reservationDoc.data :
    {};
  if (
    lesson.isSeatReleased === true ||
    reservation.isSeatReleased === true ||
    lesson.releasedForPrivateBooking === true ||
    reservation.releasedForPrivateBooking === true
  ) {
    return "seat_released_lesson";
  }
  if (
    lesson.deletedAt ||
    lesson.archivedAt ||
    reservation.deletedAt ||
    reservation.archivedAt ||
    status === "deleted" ||
    status === "archived"
  ) {
    return status === "archived" ||
      lesson.archivedAt ||
      reservation.archivedAt ?
      "archived_lesson" :
      "deleted_lesson";
  }
  return "";
}

function getPrivateLessonStatusTargetId(target) {
  return normalizeId(
      target.reservationDoc.id ||
      target.lessonDoc.id ||
      target.slotDoc.id,
  );
}

function buildPrivateLessonStatusPackageImpact({actionType, target}) {
  const packageData = target.packageDoc.exists ? target.packageDoc.data : null;
  const packageSummary = target.packageDoc.exists ?
    privateLessonStatusPackageSummary(target.packageDoc.id, packageData) :
    privateLessonStatusPackageSummary("", {});
  if (actionType !== "reverse_deduction") {
    return {
      packageId: packageSummary.id,
      currentUsedCount: packageSummary.currentUsedCount,
      currentRemainingCount: packageSummary.currentRemainingCount,
      usedCountDelta: 0,
      remainingCountDelta: 0,
      nextUsedCount: packageSummary.currentUsedCount,
      nextRemainingCount: packageSummary.currentRemainingCount,
      reason: `${actionType}_keeps_deduction`,
    };
  }
  const currentUsedCount = packageSummary.currentUsedCount;
  const currentRemainingCount = packageSummary.currentRemainingCount;
  const nextUsedCount = Math.max(0, currentUsedCount - 1);
  const totalCount = Number(packageSummary.totalCount || 0);
  const restoredRemaining = currentRemainingCount + 1;
  const nextRemainingCount = Number.isFinite(totalCount) && totalCount > 0 ?
    Math.min(totalCount, restoredRemaining) :
    restoredRemaining;
  return {
    packageId: packageSummary.id,
    currentUsedCount,
    currentRemainingCount,
    usedCountDelta: -1,
    remainingCountDelta: 1,
    nextUsedCount,
    nextRemainingCount,
    reason: "reverse_deduction_restores_one_private_lesson",
  };
}

function hasPrivateLessonStatusDeductionEvidence(target) {
  const reservation = target.reservationDoc.exists ?
    target.reservationDoc.data :
    {};
  const lesson = target.lessonDoc.exists ? target.lessonDoc.data : {};
  if (reservation.deductionApplied === true) return true;
  if (lesson.deductionApplied === true) return true;
  if (lesson.isDeductCancelled === true) return false;
  if (normalizeId(lesson.packageId) && normalizeId(lesson.date)) return true;
  return target.creditTransactionCandidates.some(
      (candidate) => Number(candidate.deltaCount || 0) < 0,
  );
}

function buildPrivateLessonStatusCreditPreview({actionType, target}) {
  const linkedReservationId = normalizeId(target.reservationDoc.id);
  const linkedLessonId = normalizeId(target.lessonDoc.id);
  const linkedPackageId = normalizeId(target.packageId || target.packageDoc.id);
  const sourceId = linkedReservationId ||
    linkedLessonId ||
    getPrivateLessonStatusTargetId(target);
  const originalCredit = target.creditTransactionCandidates.find(
      (candidate) => Number(candidate.deltaCount || 0) < 0,
  ) || null;
  if (actionType !== "reverse_deduction") {
    return {
      wouldCreate: false,
      actionType: "",
      sourceType: "private-lesson-status-action",
      sourceId,
      linkedLessonId,
      linkedReservationId,
      linkedPackageId,
      reversalOfTransactionId: "",
      idempotencyKeyCandidate: "",
    };
  }
  return {
    wouldCreate: true,
    actionType: "private_lesson_deduction_reversed",
    sourceType: "private-lesson-status-action",
    sourceId,
    linkedLessonId,
    linkedReservationId,
    linkedPackageId,
    reversalOfTransactionId: originalCredit ? originalCredit.id : "",
    idempotencyKeyCandidate: [
      "privateLessonStatusAction",
      "reverse_deduction",
      sourceId,
      linkedPackageId,
    ].filter(Boolean).join("__"),
  };
}

function buildPrivateLessonStatusDeductionEvidence(target, currentState) {
  const reservation = target.reservationDoc.exists ?
    target.reservationDoc.data :
    {};
  const lesson = target.lessonDoc.exists ? target.lessonDoc.data : {};
  const negativeCreditTransaction = target.creditTransactionCandidates.some(
      (candidate) => Number(candidate.deltaCount || 0) < 0,
  );
  const lessonPackageDateEvidence = Boolean(
      normalizeId(lesson.packageId) && normalizeId(lesson.date),
  );
  const hasEvidence = hasPrivateLessonStatusDeductionEvidence(target);
  return {
    hasEvidence,
    currentStateDeductionApplied: Boolean(
        currentState && currentState.deductionApplied === true,
    ),
    reservationDeductionApplied: reservation.deductionApplied === true,
    lessonDeductionApplied: lesson.deductionApplied === true,
    lessonDeductionCancelled: lesson.isDeductCancelled === true,
    lessonPackageDateEvidence,
    negativeCreditTransaction,
  };
}

function buildPrivateLessonStatusPackageCreditPolicy({
  actionType,
  target,
  packageImpact,
  creditTransactionPreview,
  currentState,
}) {
  const deductionEvidence =
    buildPrivateLessonStatusDeductionEvidence(target, currentState);
  const statusOnlyAction = actionType === "complete" ||
    actionType === "no_show";
  const usedCountDelta = Number(packageImpact &&
    packageImpact.usedCountDelta || 0);
  const remainingCountDelta = Number(packageImpact &&
    packageImpact.remainingCountDelta || 0);
  const creditWouldCreate =
    creditTransactionPreview && creditTransactionPreview.wouldCreate === true;
  const allowedStatusOnly = Boolean(
      statusOnlyAction &&
      usedCountDelta === 0 &&
      remainingCountDelta === 0 &&
      creditWouldCreate !== true &&
      deductionEvidence.hasEvidence === true,
  );
  const blockedReasons = [];
  const warnings = [];
  let reason = statusOnlyAction ?
    "status_only_requires_existing_deduction_evidence" :
    "status_only_policy_not_applicable";
  if (statusOnlyAction && allowedStatusOnly) {
    reason = "status_only_keeps_existing_deduction";
  } else if (statusOnlyAction) {
    blockedReasons.push("package_or_credit_write_required");
    warnings.push(PRIVATE_LESSON_STATUS_PACKAGE_CREDIT_BLOCK_MESSAGE);
  }
  // actual status-only commit requires deduction evidence.
  // preview and commit share package credit policy through this helper.
  return {
    allowedStatusOnly,
    blockedReasons,
    warnings,
    packageImpact,
    creditTransactionPreview,
    deductionEvidence,
    reason,
  };
}

function buildPrivateLessonStatusPlan({actionType, target}) {
  const blockedReasons = [];
  const warnings = [];
  if (!target.lessonDoc.exists && !target.reservationDoc.exists) {
    blockedReasons.push("missing_target");
  }
  if (!target.lessonDoc.exists && target.reservationDoc.exists) {
    warnings.push("lesson_missing_but_reservation_exists");
  }
  if (!target.reservationDoc.exists && target.lessonDoc.exists) {
    warnings.push("reservation_missing_but_lesson_exists");
  }
  if (!target.slotDoc.exists) warnings.push("missing_slot");
  const statusReason = getPrivateLessonStatusBlockedReason(target);
  const status = getPrivateLessonStatusValue(target);
  if (actionType === "complete" || actionType === "no_show") {
    if (statusReason) blockedReasons.push(statusReason);
    if (!PRIVATE_LESSON_STATUS_ACTIVE_STATUSES.includes(status) ||
        PRIVATE_LESSON_STATUS_BLOCKED_STATUSES.includes(status)) {
      blockedReasons.push("unsupported_current_status");
    }
    warnings.push(
        actionType === "complete" ?
          "complete_keeps_deduction" :
          "no_show_keeps_deduction",
    );
  }
  if (actionType === "reverse_deduction") {
    warnings.push("reverse_deduction_is_high_risk");
    const reservation = target.reservationDoc.exists ?
      target.reservationDoc.data :
      {};
    const lesson = target.lessonDoc.exists ? target.lessonDoc.data : {};
    if (!target.packageDoc.exists) blockedReasons.push("missing_package");
    if (!hasPrivateLessonStatusDeductionEvidence(target)) {
      blockedReasons.push("deduction_not_applied");
    }
    if (
      reservation.deductionReversed === true ||
      reservation.deductionCanceled === true ||
      lesson.deductionReversed === true ||
      lesson.deductionCanceled === true ||
      lesson.isDeductCancelled === true
    ) {
      blockedReasons.push("deduction_already_reversed");
    }
    if (target.packageDoc.exists) {
      const usedCount = Number(target.packageDoc.data.usedCount || 0);
      const remainingCount = Number(target.packageDoc.data.remainingCount || 0);
      if (!Number.isFinite(usedCount) ||
          !Number.isFinite(remainingCount) ||
          usedCount <= 0) {
        blockedReasons.push("package_count_invalid");
      }
    }
    if (!target.creditTransactionCandidates.some(
        (candidate) => Number(candidate.deltaCount || 0) < 0,
    )) {
      warnings.push("package_transaction_not_found");
      warnings.push("original_credit_transaction_missing");
    }
  }
  const packageImpact = buildPrivateLessonStatusPackageImpact({
    actionType,
    target,
  });
  const creditTransactionPreview = buildPrivateLessonStatusCreditPreview({
    actionType,
    target,
  });
  const targetStatus = actionType === "complete" ? "completed" :
    actionType === "no_show" ? "no_show" : status;
  const currentState = {
    status,
    deductionApplied: Boolean(
        (target.reservationDoc.exists &&
          target.reservationDoc.data.deductionApplied === true) ||
        (target.lessonDoc.exists &&
          target.lessonDoc.data.deductionApplied === true),
    ),
    deductionReversed: Boolean(
        (target.reservationDoc.exists &&
          target.reservationDoc.data.deductionReversed === true) ||
        (target.lessonDoc.exists &&
          (target.lessonDoc.data.deductionReversed === true ||
            target.lessonDoc.data.isDeductCancelled === true)),
    ),
  };
  const statusOnlyPolicy = buildPrivateLessonStatusPackageCreditPolicy({
    actionType,
    target,
    packageImpact,
    creditTransactionPreview,
    currentState,
  });
  if (actionType === "complete" || actionType === "no_show") {
    blockedReasons.push(...statusOnlyPolicy.blockedReasons);
    warnings.push(...statusOnlyPolicy.warnings);
  }
  const uniqueBlockedReasons = Array.from(new Set(blockedReasons));
  const uniqueWarnings = Array.from(new Set(warnings));
  return {
    currentState,
    proposedState: {
      lesson: target.lessonDoc.exists ? {
        id: target.lessonDoc.id,
        status: targetStatus,
        deductionReversed:
          actionType === "reverse_deduction" ? true : undefined,
      } : null,
      reservation: target.reservationDoc.exists ? {
        id: target.reservationDoc.id,
        status: targetStatus,
        deductionReversed:
          actionType === "reverse_deduction" ? true : undefined,
      } : null,
      slot: target.slotDoc.exists ? {
        id: target.slotDoc.id,
        status: targetStatus,
      } : null,
    },
    packageImpact,
    creditTransactionPreview,
    statusOnlyPolicy,
    blockedReasons: uniqueBlockedReasons,
    warnings: uniqueWarnings,
    normalizedPlan: {
      actionType,
      targetStatus,
      linkedLessonId: normalizeId(target.lessonDoc.id),
      linkedReservationId: normalizeId(target.reservationDoc.id),
      linkedSlotId: normalizeId(target.slotDoc.id),
      linkedPackageId: normalizeId(target.packageId || target.packageDoc.id),
    },
  };
}

async function previewPrivateLessonStatusAction({db, auth, data}) {
  const academyId = requireString(data, "academyId");
  const actionType = requireString(data, "actionType");
  validateAcademyId(academyId);
  if (!Object.prototype.hasOwnProperty.call(
      PRIVATE_LESSON_STATUS_ACTIONS,
      actionType,
  )) {
    throw new HttpsError("invalid-argument", "unsupported_action_type");
  }
  if (data.dryRun !== true ||
      data.previewOnly !== true ||
      data.commit !== false) {
    throw new HttpsError(
        "invalid-argument",
        "Preview requires dryRun true, previewOnly true, and commit false.",
    );
  }
  if (!optionalString(data, "lessonId") &&
      !optionalString(data, "reservationId")) {
    throw new HttpsError(
        "invalid-argument",
        "lessonId or reservationId is required.",
    );
  }
  const requestId = optionalString(data, "requestId") ||
    `preview_private_lesson_status_${Date.now()}`;
  const target = await resolvePrivateLessonStatusTarget({db, academyId, data});
  const actor = await resolvePrivateLessonStatusActor(db, academyId, auth);
  const permission = canPreviewPrivateLessonStatusAction({
    actor,
    actionType,
    target,
  });
  const plan = buildPrivateLessonStatusPlan({actionType, target});
  const blockedReasons = Array.from(new Set([
    ...plan.blockedReasons,
    ...(permission.allowed ? [] : [
      permission.blockedReason || "permission_denied",
    ]),
  ]));
  const warnings = Array.from(new Set([
    ...plan.warnings,
    ...(actionType === "reverse_deduction" && actor.isTeacher ? [
      "teacher_reverse_deduction_requires_explicit_permission",
    ] : []),
  ]));
  const allowed = permission.allowed && blockedReasons.length === 0;
  return {
    ok: true,
    dryRun: true,
    previewOnly: true,
    commit: false,
    requestId,
    actionType,
    actionLabel: PRIVATE_LESSON_STATUS_ACTIONS[actionType],
    actor: {
      uid: actor.uid,
      role: actor.role,
      isAdmin: actor.isAdmin === true,
      isTeacher: actor.isTeacher === true,
      allowed: permission.allowed === true,
      permissionSource: permission.permissionSource || actor.permissionSource,
    },
    target: {
      lesson: target.lessonDoc.exists ?
        privateLessonStatusDocSummary(
            target.lessonDoc.id,
            target.lessonDoc.data,
        ) :
        {id: normalizeId(data.lessonId), exists: false},
      reservation: target.reservationDoc.exists ?
        privateLessonStatusDocSummary(
            target.reservationDoc.id,
            target.reservationDoc.data,
        ) :
        {id: normalizeId(data.reservationId), exists: false},
      slot: target.slotDoc.exists ?
        privateLessonStatusDocSummary(target.slotDoc.id, target.slotDoc.data) :
        {id: normalizeId(data.slotId), exists: false},
      package: target.packageDoc.exists ?
        privateLessonStatusPackageSummary(
            target.packageDoc.id,
            target.packageDoc.data,
        ) :
        {id: normalizeId(target.packageId), exists: false},
      creditTransactionCandidates: target.creditTransactionCandidates,
    },
    currentState: plan.currentState,
    proposedState: plan.proposedState,
    packageImpact: plan.packageImpact,
    creditTransactionPreview: plan.creditTransactionPreview,
    statusOnlyPolicy: plan.statusOnlyPolicy,
    deductionEvidence: plan.statusOnlyPolicy &&
      plan.statusOnlyPolicy.deductionEvidence,
    allowed,
    blockedReasons,
    warnings,
    normalizedPlan: plan.normalizedPlan,
    nextStep: allowed ?
      "실제 처리는 최종 확인 후 진행할 수 있습니다." :
      "차단 사유를 확인한 뒤 기존 차감 포함 처리 또는 별도 기능을 사용하세요.",
  };
}

async function canMarkPrivateReservationOutcome(db, academyId, auth) {
  const membership = await requireAcademyAdmin(db, academyId, auth.uid);
  return buildAdminActorContext(auth, membership);
}

const PRIVATE_LESSON_STATUS_COMMIT_ACTIONS = ["complete", "no_show"];
const PRIVATE_LESSON_STATUS_ACTION_BATCH_COLLECTION =
  "privateLessonStatusActionBatches";
const PRIVATE_LESSON_STATUS_PACKAGE_CREDIT_BLOCK_MESSAGE =
  "Package or credit deduction write is not enabled for this status commit.";

function buildPrivateLessonStatusActionBatchId({academyId, requestId}) {
  return [
    "privateLessonStatusAction",
    normalizeId(academyId),
    normalizeId(requestId),
  ].join("_");
}

function hashPrivateLessonStatusActionPayload(payload) {
  return crypto
      .createHash("sha256")
      .update(stableStringify(payload))
      .digest("hex");
}

function buildPrivateLessonStatusActionPayloadHash({auth, data}) {
  return hashPrivateLessonStatusActionPayload({
    uid: normalizeId(auth && auth.uid),
    academyId: normalizeId(data && data.academyId),
    requestId: normalizeId(data && data.requestId),
    actionType: normalizeId(data && data.actionType),
    lessonId: normalizeId(data && data.lessonId),
    reservationId: normalizeId(data && data.reservationId),
    slotId: normalizeId(data && data.slotId),
    commit: data && data.commit === true,
    dryRun: data && data.dryRun === false,
    previewOnly: data && data.previewOnly === false,
  });
}

function validatePrivateLessonStatusCommitPayload(data) {
  const academyId = requireString(data, "academyId");
  const requestId = requireString(data, "requestId");
  const actionType = requireString(data, "actionType");
  validateAcademyId(academyId);
  if (actionType === "reverse_deduction") {
    throw new HttpsError(
        "invalid-argument",
        "reverse_deduction commit is not enabled in this release.",
    );
  }
  if (!PRIVATE_LESSON_STATUS_COMMIT_ACTIONS.includes(actionType)) {
    throw new HttpsError("invalid-argument", "unsupported_action_type");
  }
  if (data.commit !== true ||
      data.dryRun !== false ||
      data.previewOnly !== false) {
    throw new HttpsError(
        "invalid-argument",
        "Commit requires commit true, dryRun false, and previewOnly false.",
    );
  }
  if (!optionalString(data, "lessonId") &&
      !optionalString(data, "reservationId")) {
    throw new HttpsError(
        "invalid-argument",
        "lessonId or reservationId is required.",
    );
  }
  return {
    academyId,
    requestId,
    actionType,
    lessonId: optionalString(data, "lessonId"),
    reservationId: optionalString(data, "reservationId"),
    slotId: optionalString(data, "slotId"),
  };
}

function buildPrivateLessonStatusActorFromMembership({auth, membership}) {
  const role = String((membership && membership.role) || "")
      .trim()
      .toLowerCase();
  const status = String((membership && membership.status) || "")
      .trim()
      .toLowerCase();
  const uid = normalizeId(auth && auth.uid);
  if (!membership || status !== "active") {
    return {
      uid,
      role: role || "",
      isAdmin: false,
      isTeacher: false,
      allowed: false,
      permissionSource: "membership_inactive_or_missing",
      blockedReason: "permission_denied",
    };
  }
  if (role === "owner" || role === "admin") {
    return {
      uid,
      role: "admin",
      isAdmin: true,
      isTeacher: false,
      allowed: true,
      permissionSource: "academy_admin",
      ...buildAdminActorContext(auth, {...membership, role}),
    };
  }
  if (role === "teacher" || role === "staff") {
    return {
      uid,
      role,
      isAdmin: false,
      isTeacher: true,
      allowed: false,
      permissionSource: "teacher_membership",
      ...buildTeacherStatusActor(auth, {...membership, role}),
    };
  }
  return {
    uid,
    role,
    isAdmin: false,
    isTeacher: false,
    allowed: false,
    permissionSource: "unsupported_membership_role",
    blockedReason: "permission_denied",
  };
}

function privateLessonStatusEmptyDoc(id = "") {
  return {id: normalizeId(id), exists: false, data: null};
}

async function transactionGetPrivateLessonStatusDoc(
    transaction,
    db,
    collectionName,
    docId,
) {
  const id = normalizeId(docId);
  if (!id) return privateLessonStatusEmptyDoc("");
  const ref = db.collection(collectionName).doc(id);
  const snap = await transaction.get(ref);
  return {
    id,
    ref,
    exists: snap.exists,
    data: snap.exists ? snap.data() || {} : null,
  };
}

async function transactionFindPrivateLessonStatusReservationByLesson({
  transaction,
  db,
  academyId,
  lessonId,
}) {
  const normalizedLessonId = normalizeId(lessonId);
  if (!normalizedLessonId) return privateLessonStatusEmptyDoc("");
  const snap = await transaction.get(
      db
          .collection("privateLessonReservations")
          .where("academyId", "==", academyId)
          .where("lessonId", "==", normalizedLessonId)
          .limit(2),
  );
  if (snap.empty) return privateLessonStatusEmptyDoc("");
  const docSnap = snap.docs[0];
  return {
    id: docSnap.id,
    ref: docSnap.ref,
    exists: true,
    data: docSnap.data() || {},
  };
}

async function transactionFindPrivateLessonStatusReservationBySlot({
  transaction,
  db,
  academyId,
  slotId,
}) {
  const normalizedSlotId = normalizeId(slotId);
  if (!normalizedSlotId) return privateLessonStatusEmptyDoc("");
  const snap = await transaction.get(
      db
          .collection("privateLessonReservations")
          .where("academyId", "==", academyId)
          .where("slotId", "==", normalizedSlotId)
          .limit(2),
  );
  if (snap.empty) return privateLessonStatusEmptyDoc("");
  const docSnap = snap.docs[0];
  return {
    id: docSnap.id,
    ref: docSnap.ref,
    exists: true,
    data: docSnap.data() || {},
  };
}

async function transactionFetchPrivateLessonStatusCreditCandidates({
  transaction,
  db,
  academyId,
  lessonId,
  reservationId,
  packageId,
  directIds = [],
}) {
  const candidatesById = {};
  for (const directId of directIds.map(normalizeId).filter(Boolean)) {
    const snap = await transaction.get(
        db.collection("creditTransactions").doc(directId),
    );
    candidatesById[directId] = {
      id: directId,
      exists: snap.exists,
      actionType: snap.exists ?
        normalizeId((snap.data() || {}).actionType) :
        "",
      sourceType: snap.exists ?
        normalizeId((snap.data() || {}).sourceType) :
        "",
      sourceId: snap.exists ? normalizeId((snap.data() || {}).sourceId) : "",
      packageId: snap.exists ? normalizeId((snap.data() || {}).packageId) : "",
      deltaCount: snap.exists ? Number((snap.data() || {}).deltaCount || 0) : 0,
    };
  }
  const sourceIds = [reservationId, lessonId].map(normalizeId).filter(Boolean);
  for (const sourceId of sourceIds) {
    const snap = await transaction.get(
        db
            .collection("creditTransactions")
            .where("academyId", "==", academyId)
            .where("sourceId", "==", sourceId)
            .limit(5),
    );
    snap.docs.forEach((docSnap) => {
      const data = docSnap.data() || {};
      if (packageId && normalizeId(data.packageId) !== packageId) return;
      candidatesById[docSnap.id] = {
        id: docSnap.id,
        exists: true,
        actionType: normalizeId(data.actionType),
        sourceType: normalizeId(data.sourceType),
        sourceId: normalizeId(data.sourceId),
        packageId: normalizeId(data.packageId),
        deltaCount: Number(data.deltaCount || 0),
      };
    });
  }
  return Object.values(candidatesById);
}

async function resolvePrivateLessonStatusTargetInTransaction({
  transaction,
  db,
  academyId,
  data,
}) {
  const initialLessonId = optionalString(data, "lessonId");
  const initialReservationId = optionalString(data, "reservationId");
  const initialSlotId = optionalString(data, "slotId");
  let reservationDoc = await transactionGetPrivateLessonStatusDoc(
      transaction,
      db,
      "privateLessonReservations",
      initialReservationId,
  );
  let lessonDoc = await transactionGetPrivateLessonStatusDoc(
      transaction,
      db,
      "lessons",
      initialLessonId ||
        (reservationDoc.exists && (
          reservationDoc.data.lessonId || reservationDoc.data.fixedLessonId
        )),
  );
  if (!reservationDoc.exists && lessonDoc.exists) {
    const linkedReservationId = normalizeId(
        lessonDoc.data.reservationId ||
        lessonDoc.data.privateLessonReservationId,
    );
    reservationDoc = await transactionGetPrivateLessonStatusDoc(
        transaction,
        db,
        "privateLessonReservations",
        linkedReservationId,
    );
    if (!reservationDoc.exists) {
      reservationDoc =
        await transactionFindPrivateLessonStatusReservationByLesson({
          transaction,
          db,
          academyId,
          lessonId: lessonDoc.id,
        });
    }
  }
  const linkedSlotId = normalizeId(
      initialSlotId ||
      (reservationDoc.exists && (
        reservationDoc.data.slotId || reservationDoc.data.privateLessonSlotId
      )) ||
      (lessonDoc.exists && (
        lessonDoc.data.slotId || lessonDoc.data.privateLessonSlotId
      )),
  );
  let slotDoc = await transactionGetPrivateLessonStatusDoc(
      transaction,
      db,
      "privateLessonSlots",
      linkedSlotId,
  );
  if (!reservationDoc.exists && slotDoc.exists) {
    const slotReservationId = normalizeId(slotDoc.data.reservationId);
    reservationDoc = await transactionGetPrivateLessonStatusDoc(
        transaction,
        db,
        "privateLessonReservations",
        slotReservationId,
    );
    if (!reservationDoc.exists) {
      reservationDoc =
        await transactionFindPrivateLessonStatusReservationBySlot({
          transaction,
          db,
          academyId,
          slotId: slotDoc.id,
        });
    }
  }
  if (!lessonDoc.exists && reservationDoc.exists) {
    lessonDoc = await transactionGetPrivateLessonStatusDoc(
        transaction,
        db,
        "lessons",
        reservationDoc.data.lessonId || reservationDoc.data.fixedLessonId,
    );
  }
  if (!slotDoc.exists && reservationDoc.exists) {
    slotDoc = await transactionGetPrivateLessonStatusDoc(
        transaction,
        db,
        "privateLessonSlots",
        reservationDoc.data.slotId || reservationDoc.data.privateLessonSlotId,
    );
  }
  const packageId = normalizeId(
      (reservationDoc.exists && (
        reservationDoc.data.deductionPackageId ||
        reservationDoc.data.packageId ||
        reservationDoc.data.linkedPackageId ||
        reservationDoc.data.fixedPrivatePackageId
      )) ||
      (lessonDoc.exists && (
        lessonDoc.data.deductionPackageId ||
        lessonDoc.data.packageId ||
        lessonDoc.data.linkedPackageId ||
        lessonDoc.data.fixedPrivatePackageId
      )) ||
      (slotDoc.exists && (
        slotDoc.data.packageId ||
        slotDoc.data.linkedPackageId ||
        slotDoc.data.fixedPrivatePackageId
      )),
  );
  const packageDoc = await transactionGetPrivateLessonStatusDoc(
      transaction,
      db,
      "studentPackages",
      packageId,
  );
  const creditTransactionCandidates =
    await transactionFetchPrivateLessonStatusCreditCandidates({
      transaction,
      db,
      academyId,
      lessonId: lessonDoc.id,
      reservationId: reservationDoc.id,
      packageId,
      directIds: [
        reservationDoc.exists && (
          reservationDoc.data.deductionCreditTransactionId ||
          reservationDoc.data.deductionTransactionId
        ),
        lessonDoc.exists && (
          lessonDoc.data.deductionCreditTransactionId ||
          lessonDoc.data.deductionTransactionId
        ),
      ],
    });
  return {
    lessonDoc,
    reservationDoc,
    slotDoc,
    packageDoc,
    packageId,
    creditTransactionCandidates,
  };
}

function buildPrivateLessonStatusCommitErrorDetails({
  requestId,
  actionType,
  plan,
  blockedReasons,
  warnings,
}) {
  return {
    blockedReasons: Array.from(new Set(blockedReasons || [])),
    warnings: Array.from(new Set(warnings || [])),
    currentState: plan && plan.currentState ? plan.currentState : {},
    packageImpact: plan && plan.packageImpact ? plan.packageImpact : {},
    creditTransactionPreview: plan && plan.creditTransactionPreview ?
      plan.creditTransactionPreview :
      {},
    statusOnlyPolicy: plan && plan.statusOnlyPolicy ?
      plan.statusOnlyPolicy :
      {},
    deductionEvidence:
      plan && plan.statusOnlyPolicy && plan.statusOnlyPolicy.deductionEvidence ?
        plan.statusOnlyPolicy.deductionEvidence :
        {},
    normalizedPlan: plan && plan.normalizedPlan ? plan.normalizedPlan : {},
    requestId,
    actionType,
  };
}

function firstPrivateLessonStatusValue(row, fields) {
  if (!row) return "";
  for (const field of fields) {
    const value = normalizeId(row[field]);
    if (value) return value;
  }
  return "";
}

function privateLessonStatusValuesConflict(first, second, fields) {
  const firstValue = firstPrivateLessonStatusValue(first, fields);
  const secondValue = firstPrivateLessonStatusValue(second, fields);
  return Boolean(firstValue && secondValue && firstValue !== secondValue);
}

function assertPrivateLessonStatusCommitAllowed({
  validation,
  target,
  permission,
  plan,
}) {
  const blockedReasons = [
    ...plan.blockedReasons,
    ...(permission.allowed ? [] : [
      permission.blockedReason || "permission_denied",
    ]),
  ];
  const warnings = [...plan.warnings];
  if (!target.reservationDoc.exists) {
    blockedReasons.push("missing_reservation");
  }
  if (target.reservationDoc.exists &&
      normalizeId(target.reservationDoc.data.academyId) !==
        validation.academyId) {
    blockedReasons.push("academy_mismatch");
  }
  if (target.lessonDoc.exists &&
      normalizeId(target.lessonDoc.data.academyId) !== validation.academyId) {
    blockedReasons.push("academy_mismatch");
  }
  if (target.slotDoc.exists &&
      normalizeId(target.slotDoc.data.academyId) !== validation.academyId) {
    blockedReasons.push("academy_mismatch");
  }
  if (target.packageDoc.exists &&
      normalizeId(target.packageDoc.data.academyId) !== validation.academyId) {
    blockedReasons.push("academy_mismatch");
  }
  const reservation = target.reservationDoc.exists ?
    target.reservationDoc.data :
    {};
  const lesson = target.lessonDoc.exists ? target.lessonDoc.data : {};
  const slot = target.slotDoc.exists ? target.slotDoc.data : {};
  const packageData = target.packageDoc.exists ? target.packageDoc.data : {};
  const reservationLessonId = normalizeId(
      reservation.lessonId || reservation.fixedLessonId,
  );
  const reservationSlotId = normalizeId(
      reservation.slotId || reservation.privateLessonSlotId,
  );
  if (validation.lessonId &&
      reservationLessonId &&
      reservationLessonId !== validation.lessonId) {
    blockedReasons.push("lesson_mismatch");
  }
  if (validation.slotId &&
      reservationSlotId &&
      reservationSlotId !== validation.slotId) {
    blockedReasons.push("slot_mismatch");
  }
  const lessonReservationId = normalizeId(
      lesson.reservationId || lesson.privateLessonReservationId,
  );
  if (lessonReservationId &&
      target.reservationDoc.id &&
      lessonReservationId !== target.reservationDoc.id) {
    blockedReasons.push("reservation_mismatch");
  }
  const slotReservationId = normalizeId(slot.reservationId);
  if (slotReservationId &&
      target.reservationDoc.id &&
      slotReservationId !== target.reservationDoc.id) {
    blockedReasons.push("slot_reservation_mismatch");
  }
  [
    ["student_mismatch", ["studentId", "studentID"]],
    ["date_mismatch", ["date", "lessonDate", "scheduleDate"]],
    ["time_mismatch", ["time", "startTime"]],
  ].forEach(([reason, fields]) => {
    if (privateLessonStatusValuesConflict(reservation, lesson, fields) ||
        privateLessonStatusValuesConflict(reservation, slot, fields)) {
      blockedReasons.push(reason);
    }
  });
  [
    reservation.packageType,
    lesson.packageType,
    slot.packageType,
    packageData.packageType,
  ].map((value) => normalizeId(value).toLowerCase())
      .filter(Boolean)
      .forEach((packageType) => {
        if (packageType !== "private") {
          blockedReasons.push("package_type_mismatch");
        }
      });
  if (target.packageDoc.exists && target.reservationDoc.exists &&
      !isPrivatePackageForReservation(packageData, reservation, slot)) {
    blockedReasons.push("package_mismatch");
  }
  if (target.slotDoc.exists && !target.reservationDoc.exists) {
    const slotStatus = String(target.slotDoc.data.status || "")
        .trim()
        .toLowerCase();
    if (slotStatus === "open" || slotStatus === "available") {
      blockedReasons.push("open_unreserved_slot");
    }
  }
  const statusOnlyPolicy = plan.statusOnlyPolicy || {};
  if (PRIVATE_LESSON_STATUS_COMMIT_ACTIONS.includes(validation.actionType) &&
      statusOnlyPolicy.allowedStatusOnly !== true) {
    blockedReasons.push(
        ...(statusOnlyPolicy.blockedReasons || [
          "package_or_credit_write_required",
        ]),
    );
    warnings.push(...(statusOnlyPolicy.warnings || [
      PRIVATE_LESSON_STATUS_PACKAGE_CREDIT_BLOCK_MESSAGE,
    ]));
  }
  return {
    blockedReasons: Array.from(new Set(blockedReasons)),
    warnings: Array.from(new Set(warnings)),
  };
}

function buildPrivateLessonStatusCommitReplay(checkpoint) {
  const data = checkpoint || {};
  return {
    ok: true,
    committed: true,
    dryRun: false,
    previewOnly: false,
    requestId: normalizeId(data.requestId),
    batchId: normalizeId(data.batchId || data.id),
    idempotentReplay: true,
    actionType: normalizeId(data.actionType),
    updated: data.updated || {
      reservations: [],
      lessons: [],
      privateLessonSlots: [],
      studentPackages: [],
      creditTransactions: [],
    },
    normalizedPlan: data.normalizedPlan || {},
    nextStep: "Private lesson status action committed.",
  };
}

async function commitPrivateLessonStatusAction({db, auth, data}) {
  const validation = validatePrivateLessonStatusCommitPayload(data || {});
  const payloadHash = buildPrivateLessonStatusActionPayloadHash({auth, data});
  const batchId = buildPrivateLessonStatusActionBatchId(validation);
  const batchRef = db
      .collection(PRIVATE_LESSON_STATUS_ACTION_BATCH_COLLECTION)
      .doc(batchId);
  return await db.runTransaction(async (transaction) => {
    const batchSnap = await transaction.get(batchRef);
    if (batchSnap.exists) {
      const checkpoint = batchSnap.data() || {};
      if (
        checkpoint.status === "completed" &&
        checkpoint.payloadHash === payloadHash
      ) {
        return buildPrivateLessonStatusCommitReplay({
          id: batchSnap.id,
          ...checkpoint,
        });
      }
      if (checkpoint.payloadHash !== payloadHash) {
        throw new HttpsError(
            "already-exists",
            "private lesson status action requestId already exists.",
            {
              requestId: validation.requestId,
              actionType: validation.actionType,
              blockedReasons: ["request_id_conflict"],
            },
        );
      }
      throw new HttpsError(
          "failed-precondition",
          "private lesson status action checkpoint is not completed.",
          {
            requestId: validation.requestId,
            actionType: validation.actionType,
            blockedReasons: ["checkpoint_not_completed"],
          },
      );
    }
    const membershipRef = db
        .collection("academyMemberships")
        .doc(`${validation.academyId}_${normalizeId(auth && auth.uid)}`);
    const membershipSnap = await transaction.get(membershipRef);
    const membership = membershipSnap.exists ?
      membershipSnap.data() || {} :
      null;
    const actor = buildPrivateLessonStatusActorFromMembership({
      auth,
      membership,
    });
    const target = await resolvePrivateLessonStatusTargetInTransaction({
      transaction,
      db,
      academyId: validation.academyId,
      data: validation,
    });
    const permission = canPreviewPrivateLessonStatusAction({
      actor,
      actionType: validation.actionType,
      target,
    });
    const plan = buildPrivateLessonStatusPlan({
      actionType: validation.actionType,
      target,
    });
    const {blockedReasons, warnings} = assertPrivateLessonStatusCommitAllowed({
      validation,
      target,
      permission,
      plan,
    });
    if (!permission.allowed) {
      throw new HttpsError(
          "permission-denied",
          "Private lesson status action permission denied.",
          buildPrivateLessonStatusCommitErrorDetails({
            requestId: validation.requestId,
            actionType: validation.actionType,
            plan,
            blockedReasons,
            warnings,
          }),
      );
    }
    if (blockedReasons.length > 0) {
      throw new HttpsError(
          "failed-precondition",
          blockedReasons.includes("package_or_credit_write_required") ?
            PRIVATE_LESSON_STATUS_PACKAGE_CREDIT_BLOCK_MESSAGE :
            "Private lesson status action is blocked.",
          buildPrivateLessonStatusCommitErrorDetails({
            requestId: validation.requestId,
            actionType: validation.actionType,
            plan,
            blockedReasons,
            warnings,
          }),
      );
    }
    const now = admin.firestore.FieldValue.serverTimestamp();
    const reservationId = target.reservationDoc.id;
    const targetStatus = validation.actionType === "complete" ?
      "completed" :
      "no_show";
    const actorSummary = {
      uid: actor.uid,
      role: actor.role,
      isAdmin: actor.isAdmin === true,
      isTeacher: actor.isTeacher === true,
      permissionSource: permission.permissionSource || actor.permissionSource,
    };
    const reservationPatch = {
      status: targetStatus,
      attendanceStatus: targetStatus,
      statusActionType: validation.actionType,
      statusActionBatchId: batchId,
      statusActionRequestId: validation.requestId,
      statusUpdatedAt: now,
      statusUpdatedBy: actor.uid,
      statusUpdatedByRole: actor.role,
      statusUpdatedByName: actor.actorName || "",
      updatedAt: now,
    };
    if (targetStatus === "completed") {
      reservationPatch.completedAt = now;
      reservationPatch.completedBy = actor.uid;
      reservationPatch.noShowAt = null;
      reservationPatch.noShowBy = null;
    } else {
      reservationPatch.noShowAt = now;
      reservationPatch.noShowBy = actor.uid;
      reservationPatch.completedAt = null;
      reservationPatch.completedBy = null;
    }
    const updated = {
      reservations: [reservationId],
      lessons: [],
      privateLessonSlots: [],
      studentPackages: [],
      creditTransactions: [],
    };
    const normalizedPlan = {
      ...plan.normalizedPlan,
      actionType: validation.actionType,
      targetStatus,
      linkedReservationId: reservationId,
    };
    const checkpoint = {
      batchId,
      academyId: validation.academyId,
      requestId: validation.requestId,
      payloadHash,
      actionType: validation.actionType,
      lessonId: normalizeId(target.lessonDoc.id || validation.lessonId),
      reservationId,
      slotId: normalizeId(target.slotDoc.id || validation.slotId),
      packageId: normalizeId(target.packageId || target.packageDoc.id),
      actor: actorSummary,
      status: "completed",
      updated,
      warnings,
      normalizedPlan,
      sourceType: "private-lesson-status-action",
      createdAt: now,
      completedAt: now,
    };
    transaction.update(target.reservationDoc.ref, reservationPatch);
    transaction.set(batchRef, checkpoint);
    return {
      ok: true,
      committed: true,
      dryRun: false,
      previewOnly: false,
      requestId: validation.requestId,
      batchId,
      idempotentReplay: false,
      actionType: validation.actionType,
      updated,
      normalizedPlan,
      nextStep: "Private lesson status action committed.",
    };
  });
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
  return role === "owner" || role === "admin";
}

function canManageGroupAttendance(membership) {
  const role = String((membership && membership.role) || "").toLowerCase();
  return role === "owner" || role === "admin";
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
    enrollmentType: "guest",
    isFixedMemberLesson: false,
    canReserve: true,
  };
}

function getFixedMemberLessonStatusLabel(lesson) {
  const lessonDate = normalizeId(lesson && lesson.date);
  const today = getSeoulTodayDateString();
  if (lessonDate && lessonDate >= today) return "반 등록 예정";
  return "반 등록됨";
}

function sanitizeFixedMemberLessonForStudent(docSnap) {
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
    isBookable: lesson.isBookable === true,
    enrollmentType: "fixed",
    isFixedMemberLesson: true,
    memberStatusLabel: getFixedMemberLessonStatusLabel(lesson),
    canReserve: false,
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

function isCancelledPrivateReservation(data) {
  const status = String((data && data.status) || "").trim().toLowerCase();
  return status === "cancelled" || status === "canceled";
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
    "revoked",
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

function formatPrivatePackageDateValueYmd(value) {
  if (!value) return "";
  if (typeof value === "string") {
    const match = value.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return match ? match[1] : "";
  }
  let date = null;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value.toDate === "function") {
    date = value.toDate();
  } else if (typeof value.seconds === "number") {
    date = new Date(value.seconds * 1000);
  } else if (typeof value === "number" && Number.isFinite(value)) {
    date = new Date(value);
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function getPrivatePackageDateBounds(pkg) {
  const startDate =
    formatPrivatePackageDateValueYmd(pkg && pkg.registrationStartDate) ||
    formatPrivatePackageDateValueYmd(pkg && pkg.startDate) ||
    formatPrivatePackageDateValueYmd(pkg && pkg.packageStartDate) ||
    formatPrivatePackageDateValueYmd(pkg && pkg.validFrom);
  const endDate =
    formatPrivatePackageDateValueYmd(pkg && pkg.expiresAt) ||
    formatPrivatePackageDateValueYmd(pkg && pkg.endDate) ||
    formatPrivatePackageDateValueYmd(pkg && pkg.coverageEndDate) ||
    formatPrivatePackageDateValueYmd(pkg && pkg.packageEndDate) ||
    formatPrivatePackageDateValueYmd(pkg && pkg.validUntil);
  return {startDate, endDate};
}

function privatePackageCoversDate(pkg, date) {
  const ymd = normalizeId(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const {startDate, endDate} = getPrivatePackageDateBounds(pkg);
  if (startDate && ymd < startDate) return false;
  if (endDate && ymd > endDate) return false;
  return true;
}

function getPrivatePackageRejectReason({
  pkg,
  academyId,
  studentId,
  teacherKey,
  teacherKeys = [],
  lessonDate = "",
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
    ["inactive", "expired", "ended", "revoked", "cancelled", "canceled"]
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
  if (lessonDate && !privatePackageCoversDate(pkg, lessonDate)) {
    return "package_date_out_of_range";
  }
  return null;
}

function isPrivatePackageForReservation(pkg, reservation, slot) {
  const lessonDate = normalizeId(
      (reservation && reservation.date) || (slot && slot.date),
  );
  return !getPrivatePackageRejectReason({
    pkg,
    academyId: normalizeId(reservation && reservation.academyId),
    studentId: normalizeId(reservation && reservation.studentId),
    teacherKey: getReservationTeacherKey(reservation, slot),
    teacherKeys: getReservationTeacherKeys(reservation, slot),
    lessonDate,
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

function sanitizeComputedPrivatePackageSummary(summary) {
  const data = (summary && summary.packageData) || {};
  const totalCount = Number(
      (summary && summary.totalCount) || data.totalCount || 0,
  );
  const remainingCount = Number(
      summary && summary.makeupAvailableCount !== undefined ?
        summary.makeupAvailableCount :
        summary && summary.remainingCount !== undefined ?
          summary.remainingCount :
          data.remainingCount || 0,
  );
  const usedCount = Number(
      summary && summary.usedDeductedCount !== undefined ?
        summary.usedDeductedCount :
        data.usedCount !== undefined && data.usedCount !== null ?
          data.usedCount :
          Math.max(
              (Number.isFinite(totalCount) ? totalCount : 0) -
                (Number.isFinite(remainingCount) ? remainingCount : 0),
              0,
          ),
  );
  return {
    id: normalizeId(summary && summary.packageId),
    teacher: normalizeId(summary && summary.teacherKey) ||
      normalizeId(data.teacher),
    teacherName: normalizeId(data.teacherName) ||
      normalizeId(summary && summary.teacherKey) ||
      normalizeId(data.teacher),
    totalCount: Number.isFinite(totalCount) ? totalCount : 0,
    usedCount: Number.isFinite(usedCount) ? usedCount : 0,
    remainingCount: Number.isFinite(remainingCount) ? remainingCount : 0,
    status: normalizeId(data.status || "active"),
  };
}

function getComputedPrivatePackageSummaries(packageSummary) {
  const byPackageId = new Map();
  if (!packageSummary || !(packageSummary.byTeacherKey instanceof Map)) {
    return [];
  }
  packageSummary.byTeacherKey.forEach((value) => {
    const summaries = Array.isArray(value) ? value : value ? [value] : [];
    summaries.forEach((summary) => {
      const packageId = normalizeId(summary && summary.packageId);
      if (!packageId || byPackageId.has(packageId)) return;
      byPackageId.set(
          packageId,
          sanitizeComputedPrivatePackageSummary(summary),
      );
    });
  });
  return Array.from(byPackageId.values()).sort((a, b) => {
    const aKey = `${a.teacher || a.teacherName || ""} ${a.id}`;
    const bKey = `${b.teacher || b.teacherName || ""} ${b.id}`;
    return aKey.localeCompare(bKey, "ko");
  });
}

async function findActivePrivatePackageForTeacher({
  transaction,
  db,
  academyId,
  studentId,
  teacherKey,
  teacherKeys = [],
  candidatePackageIds = [],
  lessonDate = "",
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
      lessonDate,
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
          lessonDate,
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

function isReleasedFixedPrivateSlot(slot, reservation) {
  const slotType = normalizeId(slot && slot.slotType);
  const sourceType = normalizeId(reservation && reservation.sourceType);
  return slotType === "released_fixed" ||
    sourceType === "released_fixed_slot" ||
    (slot && slot.releasedFromFixed === true);
}

function buildCancelledPrivateReservationUpdates({
  now,
  uid,
  studentId,
  cancelledBy = "student",
  cancelledByRole = cancelledBy,
  actorName = "",
  cancellationReason = "student_cancelled",
}) {
  return {
    status: "cancelled",
    cancelledAt: now,
    cancelledBy,
    cancelledByUid: uid,
    cancelledByRole,
    cancelledByName: actorName,
    cancelledByStudentId: studentId,
    cancellationReason,
    updatedAt: now,
  };
}

function buildReleasedPrivateSlotUpdates({
  slot,
  reservation,
  studentId,
  now,
  releaseReason = "fixed_student_cancelled",
}) {
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
    releaseReason,
    isBookable: true,
  };
}

function privateSlotBelongsToCancelledReservation({
  slot,
  reservationId,
  studentId,
}) {
  if (!slot) return false;
  const slotReservationId = normalizeId(slot.reservationId);
  if (slotReservationId && slotReservationId === reservationId) return true;
  const reservedStudentId = normalizeId(slot.reservedStudentId);
  return Boolean(reservedStudentId && reservedStudentId === studentId);
}

function getPrivateSlotLinkedReservationId({academyId, slotId, slot}) {
  const reservationId = normalizeId(slot && slot.reservationId);
  if (reservationId) return reservationId;
  const reservedStudentId = normalizeId(slot && slot.reservedStudentId);
  if (!reservedStudentId) return "";
  return privateReservationDocId({
    academyId,
    slotId,
    studentId: reservedStudentId,
  });
}

function privateSlotHasCancelledLinkedReservation({
  slot,
  reservation,
  academyId,
  slotId,
}) {
  if (!slot || !reservation) return false;
  const status = normalizeId(slot.status).toLowerCase();
  if (status !== "reserved") return false;
  if (!normalizeId(slot.reservationId) &&
      !normalizeId(slot.reservedStudentId)) {
    return false;
  }
  const cancellationType = normalizeId(slot.cancellationType).toLowerCase();
  if (cancellationType === "lesson_cancelled") return false;
  if (isFixedPrivateSlot(slot, reservation) &&
      !isReleasedFixedPrivateSlot(slot, reservation)) {
    return false;
  }
  return normalizeId(reservation.academyId) === academyId &&
    normalizeId(reservation.slotId) === slotId &&
    isCancelledPrivateReservation(reservation);
}

function buildReservablePrivateSlotFromStaleReservation(slot) {
  return {
    ...slot,
    status: "open",
    reservedStudentId: "",
    reservationId: "",
    reservedAt: null,
    reservedCount: 0,
  };
}

function isTeacherUnavailablePrivateCancellationReason(reason) {
  return [
    "teacher_absent",
    "teacher_unavailable",
    "teacher_unavailable_closed",
    "teacher_absence",
    "teacher_no_show",
    "closed",
    "academy_closed",
    "holiday",
    "class_closure",
  ].includes(normalizeId(reason).toLowerCase());
}

function shouldBlockClosedPrivateSlot(slot) {
  const slotType = normalizeId(slot && slot.slotType).toLowerCase();
  return Boolean(
      slot &&
      (slot.isGeneratedFromTemplate === true ||
        slotType === "template" ||
        normalizeId(slot.availabilityTemplateId)),
  );
}

function buildAdminClosedPrivateSlotUpdates({
  slot = null,
  now,
  uid = "",
  actorRole = "admin",
  actorName = "",
  cancellationReason = "teacher_unavailable",
}) {
  const status = shouldBlockClosedPrivateSlot(slot) ? "blocked" : "cancelled";
  return {
    status,
    reservedStudentId: "",
    reservationId: "",
    reservedAt: null,
    reservedCount: 0,
    cancelledAt: now,
    blockedAt: now,
    updatedAt: now,
    releaseReason: cancellationReason,
    cancellationReason,
    cancelledReason: cancellationReason,
    cancelledBy: "admin",
    cancelledByUid: uid,
    cancelledByRole: actorRole,
    cancelledByName: actorName,
    isBookable: false,
  };
}

function buildAdminClosedPrivateSlotFromTemplate({
  templateId,
  template,
  date,
  time,
  now,
  uid,
  actor,
  cancellationReason = "teacher_unavailable",
}) {
  return {
    ...buildSlotFromAvailabilityTemplate({templateId, template, date, time}),
    ...buildAdminClosedPrivateSlotUpdates({
      slot: {slotType: "template", isGeneratedFromTemplate: true},
      now,
      uid,
      actorRole: actor.actorRole,
      actorName: actor.actorName,
      cancellationReason,
    }),
    createdByUid: uid,
    createdAt: now,
  };
}

function buildAdminReopenedPrivateSlotUpdates({
  slot = null,
  now,
  uid = "",
  actorRole = "admin",
  actorName = "",
  reason = "teacher_unavailable_reopened",
}) {
  const deleteField = admin.firestore.FieldValue.delete();
  const slotType = normalizeId(slot && slot.slotType).toLowerCase();
  const updates = {
    status: "open",
    reservedStudentId: "",
    reservationId: "",
    reservedAt: null,
    reservedCount: 0,
    cancelledAt: null,
    blockedAt: null,
    updatedAt: now,
    isBookable: true,
    reopenedAt: now,
    reopenedByUid: uid,
    reopenedByRole: actorRole,
    reopenedByName: actorName,
    reopenedReason: reason,
    reopenMetadata: {
      actorUid: uid,
      actorRole,
      actorName,
      reason,
    },
    cancellationReason: deleteField,
    cancelledReason: deleteField,
    cancelledBy: deleteField,
    cancelledByUid: deleteField,
    cancelledByRole: deleteField,
    cancelledByName: deleteField,
  };
  if (slotType === "fixed_closed") {
    updates.slotType = "released_fixed";
    updates.releasedFromFixed = true;
    updates.releasedForPrivateBooking = true;
    updates.releasedAt = now;
    updates.releasedByUid = uid;
    updates.releasedByRole = actorRole;
    updates.releasedByName = actorName;
    updates.releaseReason = reason;
  } else {
    updates.releaseReason = deleteField;
  }
  return updates;
}

function getFixedPrivateLessonStartMillis(lesson) {
  const startAtMillis = getTimestampMillis(lesson && lesson.startAt);
  if (startAtMillis !== null) return startAtMillis;
  return getSeoulDateTimeMillis(
      normalizeId(lesson && lesson.date),
      normalizeId(lesson && lesson.time),
  );
}

function isFixedPrivateLessonOccurrence(lesson) {
  if (!lesson) return false;
  const packageType = normalizeId(lesson.packageType).toLowerCase();
  const sourceType = normalizeId(lesson.sourceType).toLowerCase();
  return packageType === "private" &&
    sourceType === "fixed-private-slot-assignment";
}

function normalizeFixedPrivateCancellationType(value) {
  const type = normalizeId(value).toLowerCase();
  if (type === "seat_released" || type === "lesson_cancelled") return type;
  throw new HttpsError(
      "invalid-argument",
      "cancellationType must be seat_released or lesson_cancelled.",
  );
}

function getFixedPrivateActorRole(membership) {
  const role = normalizeId(membership && membership.role).toLowerCase();
  if (role === "owner" || role === "admin") return "admin";
  if (role === "teacher") return "teacher";
  if (role === "student") return "student";
  throw new HttpsError(
      "permission-denied",
      "Admin, teacher, or student membership required.",
  );
}

function buildFixedPrivateLessonCancellationPatch({
  now,
  uid,
  actorRole,
  actorName = "",
  cancellationType,
  reason,
  lessonId,
}) {
  const isSeatReleased = cancellationType === "seat_released";
  const cancellationReason =
    normalizeId(reason) ||
    (isSeatReleased ?
      "fixed_private_seat_released" :
      "fixed_private_lesson_cancelled");
  return {
    status: "cancelled",
    cancelledAt: now,
    cancelledBy: uid,
    cancelledByUid: uid,
    cancelledByRole: actorRole,
    cancelledByName: actorName,
    cancellationReason,
    cancelledReason: cancellationReason,
    cancellationType,
    isSeatReleased,
    releasedForPrivateBooking: isSeatReleased,
    releasedFromFixedLessonId: isSeatReleased ? lessonId : "",
    releasedAt: isSeatReleased ? now : null,
    releasedBy: isSeatReleased ? uid : "",
    releasedByUid: isSeatReleased ? uid : "",
    releasedByRole: isSeatReleased ? actorRole : "",
    releasedByName: isSeatReleased ? actorName : "",
    noDeduction: true,
    updatedAt: now,
  };
}

function isStudentReleasedFixedPrivateLessonCancellation(lesson) {
  const status = normalizeId(lesson && lesson.status).toLowerCase();
  const cancellationType = normalizeId(
      lesson && lesson.cancellationType,
  ).toLowerCase();
  const cancelledByRole = normalizeId(
      lesson && lesson.cancelledByRole,
  ).toLowerCase();
  const cancellationReason = normalizeId(
      lesson && (lesson.cancellationReason || lesson.cancelledReason),
  ).toLowerCase();
  return (
    (status === "cancelled" || status === "canceled") &&
    cancellationType === "seat_released" &&
    (
      cancelledByRole === "student" ||
      cancellationReason.includes("student_cancelled")
    )
  );
}

function buildFixedPrivateReservationCancellationPatch({
  now,
  uid,
  actorRole,
  actorName = "",
  cancellationType,
  reason,
  lessonId,
}) {
  const reservationOutcome = actorRole === "student" ?
    "student_cancelled" :
    `${actorRole || "admin"}_cancelled`;
  return {
    ...buildFixedPrivateLessonCancellationPatch({
      now,
      uid,
      actorRole,
      actorName,
      cancellationType,
      reason,
      lessonId,
    }),
    status: "cancelled",
    canceledAt: now,
    canceledBy: uid,
    canceledByRole: actorRole,
    cancellationStatus: "cancelled",
    reservationOutcome,
    lessonOutcome: reservationOutcome,
  };
}

function buildOriginalFixedPrivateSlotReleasePatch({
  now,
  uid,
  actorRole,
  actorName = "",
  cancellationType,
  reason,
  lessonId,
}) {
  const isSeatReleased = cancellationType === "seat_released";
  return {
    status: isSeatReleased ? "released" : "cancelled",
    slotType: isSeatReleased ? "fixed_seat_released" : "fixed_closed",
    cancellationType,
    cancellationReason: reason,
    cancelledReason: reason,
    releasedAt: isSeatReleased ? now : null,
    releasedBy: isSeatReleased ? uid : "",
    releasedByUid: isSeatReleased ? uid : "",
    releasedByRole: isSeatReleased ? actorRole : "",
    releasedByName: isSeatReleased ? actorName : "",
    releasedForPrivateBooking: isSeatReleased,
    releasedFromFixed: isSeatReleased,
    releasedFromFixedLessonId: isSeatReleased ? lessonId : "",
    isSeatReleased,
    isBookable: false,
    cancelledAt: now,
    cancelledBy: uid,
    cancelledByUid: uid,
    cancelledByRole: actorRole,
    cancelledByName: actorName,
    noDeduction: true,
    updatedAt: now,
  };
}

function buildReleasedFixedPrivateLessonSlot({
  academyId,
  lessonId,
  lesson,
  now,
  uid,
  actorRole,
  actorName = "",
}) {
  const date = normalizeId(lesson && lesson.date);
  const time = normalizeId(lesson && lesson.time);
  const startMillis = getSeoulDateTimeMillis(date, time);
  const durationMinutes = getPrivateScheduleDurationMinutes(lesson);
  const teacher =
    normalizeId(lesson && lesson.teacher) ||
    normalizeId(lesson && lesson.teacherKey) ||
    normalizeId(lesson && lesson.teacherName);
  const teacherName = normalizeId(lesson && lesson.teacherName) || teacher;
  const teacherKey = normalizeTeacherKey(lesson && lesson.teacherKey) ||
    normalizeTeacherKey(teacher);
  const teacherUid = normalizeId(
      lesson && (lesson.teacherUid || lesson.teacherUID || lesson.teacherId),
  );
  const studentId = normalizeId(lesson && (lesson.studentId ||
    lesson.studentID));
  const studentName = normalizeId(lesson && (lesson.studentName ||
    lesson.student));
  const payload = {
    academyId,
    teacher,
    teacherName,
    teacherKey,
    teacherUid,
    teacherEmail: normalizeId(lesson && lesson.teacherEmail),
    date,
    time,
    subject: normalizeId(lesson && lesson.subject) || "1:1 수업",
    capacity: 1,
    reservedCount: 0,
    durationMinutes,
    status: "open",
    reservedStudentId: "",
    reservationId: "",
    slotType: "released_fixed",
    releasedFromFixed: true,
    releasedFromFixedLessonId: lessonId,
    fixedStudentId: studentId,
    fixedStudentName: studentName,
    fixedPrivateAssignmentBatchId:
      normalizeId(lesson && lesson.fixedPrivateAssignmentBatchId),
    privateLessonAvailabilityTemplateId:
      normalizeId(lesson && lesson.privateLessonAvailabilityTemplateId),
    packageId: normalizeId(lesson && lesson.packageId),
    packageType: "private",
    releaseReason: "fixed_private_seat_released",
    releasedAt: now,
    releasedBy: uid,
    releasedByUid: uid,
    releasedByRole: actorRole,
    releasedByName: actorName,
    isBookable: true,
    createdByUid: uid,
    updatedAt: now,
    reservedAt: null,
    cancelledAt: null,
  };
  if (now) payload.createdAt = now;
  if (startMillis !== null) {
    payload.startAt = timestampFromMillis(startMillis);
  }
  return payload;
}

function buildSlotFromReleasedFixedPrivateLesson({
  academyId,
  lessonId,
  lesson,
}) {
  return buildReleasedFixedPrivateLessonSlot({
    academyId,
    lessonId,
    lesson,
    now: null,
    uid: normalizeId(lesson && lesson.releasedByUid),
    actorRole: normalizeId(lesson && lesson.releasedByRole),
  });
}

function buildClosedFixedPrivateLessonSlot({
  academyId,
  lessonId,
  lesson,
  now,
  uid,
  actorRole,
  actorName = "",
  cancellationReason = "teacher_unavailable",
}) {
  const slot = buildReleasedFixedPrivateLessonSlot({
    academyId,
    lessonId,
    lesson,
    now,
    uid,
    actorRole,
    actorName,
  });
  return {
    ...slot,
    status: "blocked",
    slotType: "fixed_closed",
    releasedFromFixed: false,
    releasedForPrivateBooking: false,
    releasedFromFixedLessonId: "",
    reservationId: "",
    reservedStudentId: "",
    reservedCount: 0,
    releaseReason: cancellationReason,
    cancellationReason,
    cancelledReason: cancellationReason,
    cancelledAt: now,
    blockedAt: now,
    isBookable: false,
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
  if (status === "package_date_out_of_range") return "수강권 기간 밖";
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
  if (packageSummary.dateOutOfRange === true) {
    return "package_date_out_of_range";
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
    bookingStatus === "package_date_out_of_range" ||
    bookingStatus === "no_makeup" ||
    bookingStatus === "busy" ||
    bookingStatus === "reserved" ||
    bookingStatus === "blocked"
  ) {
    return "busy";
  }
  return "available";
}

function getPrivateSlotDisabledReason(bookingStatus) {
  if (bookingStatus === "no_ticket") return "no_ticket";
  if (bookingStatus === "package_date_out_of_range") {
    return "package_date_out_of_range";
  }
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

function buildBusyPrivateScheduleRowId({
  source,
  docId,
  academyId,
  teacherKey,
  teacherUid,
  date,
  time,
}) {
  if (source !== "privateLessonReservations") {
    return `busy__${source}__${docId}`;
  }
  const safeAcademyId = normalizeId(academyId).replace(/[^A-Za-z0-9_-]/g, "_");
  const safeTeacher = normalizeId(teacherUid || teacherKey)
      .replace(/[^A-Za-z0-9_-]/g, "_");
  const safeDate = normalizeId(date).replace(/-/g, "");
  const safeTime = normalizeId(time).replace(/:/g, "");
  return `busy__${source}__${safeAcademyId}__${safeTeacher}__` +
    `${safeDate}__${safeTime}`;
}

function buildReleasedFixedPrivateSlotId(lessonId) {
  return `released_fixed__${normalizeId(lessonId)}`;
}

function buildClosedFixedPrivateSlotId(lessonId) {
  return `closed_fixed__${normalizeId(lessonId)}`;
}

function parseReleasedFixedPrivateSlotId(slotId) {
  const value = normalizeId(slotId);
  const prefix = "released_fixed__";
  return value.startsWith(prefix) ? value.slice(prefix.length) : "";
}

function privateAvailabilityTemplateAppliesToDate(template, date) {
  const safeDate = normalizeId(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDate)) return false;
  const effectiveStartDate = normalizeId(
      template && template.effectiveStartDate,
  );
  const effectiveEndDate = normalizeId(
      template && template.effectiveEndDate,
  );
  if (/^\d{4}-\d{2}-\d{2}$/.test(effectiveStartDate) &&
      safeDate < effectiveStartDate) {
    return false;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(effectiveEndDate) &&
      safeDate > effectiveEndDate) {
    return false;
  }
  return true;
}

function privateAvailabilityTemplateOpenForStudentBooking(template) {
  return template && template.openForStudentBooking === true;
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
          (
            groupCourseType &&
            groupCourseTypesEqual(pkgCourseType, groupCourseType)
          )
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
      lessonCourseType &&
      ticketCourseTypes.some((ticketCourseType) =>
        groupCourseTypesEqual(ticketCourseType, lessonCourseType),
      ),
  );
}

function withGroupClassCourseTypeFallback(lesson, groupClass) {
  const lessonCourseType = normalizeId(
      lesson && (lesson.groupCourseType || lesson.courseType),
  );
  const groupClassCourseType = normalizeId(
      groupClass && groupClass.groupCourseType,
  );
  if (lessonCourseType || !groupClassCourseType) return lesson;
  return {
    ...lesson,
    groupCourseType: groupClassCourseType,
  };
}

function getGroupTicketPackageType(ticket) {
  return normalizeId(ticket && ticket.packageType).toLowerCase();
}

function isGroupTicketPackage(ticket) {
  const packageType = getGroupTicketPackageType(ticket);
  return packageType === "group" || packageType === "opengroup";
}

function isGroupTicketFreeBookingAllowed(ticket) {
  const packageType = getGroupTicketPackageType(ticket);
  if (packageType === "opengroup") return true;
  if (packageType !== "group") return false;
  return ticket && (
    ticket.allowGroupFreeBooking === true ||
    ticket.allowStudentGroupBooking === true
  );
}

function groupTicketMatchesFreeBookingScope(ticket, lesson) {
  return isGroupTicketFreeBookingAllowed(ticket) &&
    groupTicketMatchesScope(ticket, lesson);
}

function getYmdFromAnyDateValue(value) {
  const millis = getTimestampMillis(value);
  if (millis !== null) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Seoul",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(millis));
    const byType = new Map(parts.map((part) => [part.type, part.value]));
    return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
  }
  const raw = normalizeId(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : "";
}

function getSeoulYearMonthFromMillis(millis) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date(millis));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}`;
}

function getGroupCancelLimitPeriodBounds(pkg, nowMillis) {
  const period = normalizeId(pkg && pkg.groupCancelLimitPeriod) ===
    "packagePeriod" ? "packagePeriod" : "calendarMonth";
  if (period === "packagePeriod") {
    return {
      period,
      startYmd: getYmdFromAnyDateValue(
          pkg &&
            (pkg.registrationStartDate || pkg.startDate || pkg.paymentDate),
      ),
      endYmd: getYmdFromAnyDateValue(
          pkg && (pkg.coverageEndDate || pkg.endDate || pkg.expiresAt),
      ),
      yearMonth: "",
    };
  }
  return {
    period,
    startYmd: "",
    endYmd: "",
    yearMonth: getSeoulYearMonthFromMillis(nowMillis),
  };
}

function isCancelledReservationInGroupCancelLimitPeriod(
    reservation,
    bounds,
) {
  const cancelledMillis = getTimestampMillis(
      reservation && reservation.cancelledAt,
  );
  if (cancelledMillis === null) return false;
  if (bounds.period === "calendarMonth") {
    return getSeoulYearMonthFromMillis(cancelledMillis) === bounds.yearMonth;
  }
  const ymd = getYmdFromAnyDateValue(reservation && reservation.cancelledAt);
  if (!ymd) return false;
  if (bounds.startYmd && ymd < bounds.startYmd) return false;
  if (bounds.endYmd && ymd > bounds.endYmd) return false;
  return true;
}

function countStudentGroupCancellationsForLimit({
  reservations,
  academyId,
  studentId,
  packageId,
  bounds,
}) {
  return (Array.isArray(reservations) ? reservations : []).filter((row) => {
    if (normalizeId(row && row.academyId) !== academyId) return false;
    if (normalizeId(row && row.studentId) !== studentId) return false;
    if (normalizeId(row && row.packageId) !== packageId) return false;
    const status = normalizeId(row && row.status).toLowerCase();
    if (status !== "cancelled" && status !== "canceled") return false;
    if (normalizeId(row && row.cancelledByRole).toLowerCase() === "admin") {
      return false;
    }
    return isCancelledReservationInGroupCancelLimitPeriod(row, bounds);
  }).length;
}

function getGroupCancelLimitPolicy(pkg, nowMillis = Date.now()) {
  const limitRaw = Number(pkg && pkg.groupCancelLimitCount);
  const limitCount = Number.isFinite(limitRaw) && limitRaw > 0 ?
    Math.floor(limitRaw) :
    0;
  const enabled = Boolean(
      pkg &&
      pkg.groupCancelLimitEnabled === true &&
      limitCount > 0 &&
      isGroupTicketFreeBookingAllowed(pkg),
  );
  return {
    enabled,
    limitCount,
    ...getGroupCancelLimitPeriodBounds(pkg, nowMillis),
  };
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
      isGroupTicketFreeBookingAllowed(ticket) ?
        rawAvailableCount -
          futureFixedAllocatedCount -
          activeFutureReservationCount :
        0,
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
    availableFreeBookingCount: availableToBook,
    makeupAvailableCount: availableToBook,
  };
}

function getGroupTicketStatusLabel({ticket, balance, ambiguous = false}) {
  if (!ticket) return ambiguous ? "수강권 연결 필요" : "수강권 등록 필요";
  if (ambiguous) return "수강권 연결 필요";
  if (Number(balance && balance.remainingCount || 0) <= 0) return "소진";
  if (ticket && !isGroupTicketFreeBookingAllowed(ticket)) {
    return "반 등록 수업만 가능";
  }
  const availableToBook = Number(balance && balance.availableToBook || 0);
  return `자유 예약 가능 ${Math.max(0, availableToBook)}회`;
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
        if (!isGroupTicketPackage(pkg)) return false;
        if (!isPackageActiveForDeduction(pkg)) return false;
        return groupTicketMatchesFreeBookingScope(pkg, lesson);
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
      return isGroupTicketPackage(pkg) &&
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
  actorUid,
  actorRole,
  actorName,
  reason,
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
  if (actorUid) eventData.actorUid = actorUid;
  if (actorRole) eventData.actorRole = actorRole;
  if (actorName) eventData.actorName = actorName;
  if (reason) eventData.reason = reason;

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
    privateCancelUsedCount: Number(packageSummary.privateCancelUsedCount || 0),
    privateCancelLimit: Number(packageSummary.privateCancelLimit || 0),
    privateCancelRemaining: Number(packageSummary.privateCancelRemaining || 0),
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
    dateOutOfRange: packageSummary.dateOutOfRange === true,
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
        row.minutes ||
        row.lengthMinutes ||
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

function isCancelledLessonStatus(status) {
  const normalized = normalizeId(status).toLowerCase();
  return normalized === "cancelled" || normalized === "canceled";
}

function isReleasedFixedPrivateSeatLesson(lesson) {
  const cancellationType = normalizeId(
      lesson && lesson.cancellationType,
  ).toLowerCase();
  return cancellationType === "seat_released" ||
    (lesson && lesson.isSeatReleased === true) ||
    (lesson && lesson.releasedForPrivateBooking === true);
}

function isBlockingPrivateLessonForAvailability(lesson) {
  const cancellationType = normalizeId(
      lesson && lesson.cancellationType,
  ).toLowerCase();
  if (cancellationType === "lesson_cancelled") return false;
  if (isReleasedFixedPrivateSeatLesson(lesson)) return false;
  if (isCancelledLessonStatus(lesson && lesson.status)) return false;
  return true;
}

function isCancelledScheduleRow(row) {
  const status = normalizeId(row && row.status).toLowerCase();
  const approvalStatus = normalizeId(row && row.approvalStatus).toLowerCase();
  if (isCancelledLessonStatus(status)) return true;
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
      privateCancelUsedCount:
        Number(packageSummary.privateCancelUsedCount || 0),
      privateCancelLimit: Number(packageSummary.privateCancelLimit || 0),
      privateCancelRemaining:
        Number(packageSummary.privateCancelRemaining || 0),
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
      dateOutOfRange: packageSummary.dateOutOfRange === true,
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
  ignoredSlotIds = new Set(),
}) {
  snap.docs.forEach((docSnap) => {
    if (source === "privateLessonSlots" && ignoredSlotIds.has(docSnap.id)) {
      return;
    }
    const row = docSnap.data() || {};
    if (normalizeId(row.academyId) !== academyId) return;
    if (source === "privateLessonReservations" &&
        !isActivePrivateReservation(row)) {
      return;
    }
    if (source === "lessons" &&
        !isBlockingPrivateLessonForAvailability(row)) {
      return;
    }
    if (isCancelledScheduleRow(row)) return;
    const date = normalizeId(row.date || row.scheduleDate);
    const time = normalizeId(row.time || row.startTime || row.scheduleTime);
    if (!isPrivateScheduleDateInRange(date, rangeStart, rangeEnd)) return;
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return;
    const teacherKey = getPrivateScheduleTeacherKey(row);
    const packageSummary = getSlotTeacherPackageSummary(
        row,
        packageByTeacherKey,
    );
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
      id: buildBusyPrivateScheduleRowId({
        source,
        docId: docSnap.id,
        academyId,
        teacherKey,
        teacherUid,
        date,
        time,
      }),
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
  ignoredSlotIds = new Set(),
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
      ignoredSlotIds,
    });
  });
  return busyRowsByKey;
}

async function loadReleasedFixedPrivateLessonSlots(db, {
  academyId,
  teacherKeys,
  packageByTeacherKey,
  rangeStart,
  rangeEnd,
  bookingEnabled,
  pilotBookable,
  studentId,
  nowMillis,
}) {
  const releasedRowsByKey = new Map();
  const queryPromises = [];
  for (const chunk of chunkValues(teacherKeys, PRIVATE_SLOT_QUERY_CHUNK_SIZE)) {
    [
      "teacherKey",
      "teacherUid",
      "teacherUID",
      "teacherId",
      "teacher",
      "teacherName",
    ].forEach((field) => {
      queryPromises.push(db
          .collection("lessons")
          .where("academyId", "==", academyId)
          .where(field, "in", chunk)
          .get());
    });
  }
  const snaps = await Promise.all(queryPromises);
  snaps.forEach((snap) => {
    snap.docs.forEach((docSnap) => {
      const lesson = {id: docSnap.id, ...(docSnap.data() || {})};
      if (normalizeId(lesson.academyId) !== academyId) return;
      if (!isReleasedFixedPrivateSeatLesson(lesson)) return;
      const date = normalizeId(lesson.date || lesson.scheduleDate);
      const time = normalizeId(lesson.time || lesson.startTime);
      if (!isPrivateScheduleDateInRange(date, rangeStart, rangeEnd)) return;
      if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return;
      const slot = buildSlotFromReleasedFixedPrivateLesson({
        academyId,
        lessonId: docSnap.id,
        lesson,
      });
      const slotId = buildReleasedFixedPrivateSlotId(docSnap.id);
      const conflictKey = getPrivateSlotConflictKey(slot);
      if (!conflictKey || releasedRowsByKey.has(conflictKey)) return;
      releasedRowsByKey.set(conflictKey, sanitizePrivateSlotAvailabilityRow({
        slotId,
        slot,
        bookingEnabled,
        pilotBookable,
        packageSummary: getSlotTeacherPackageSummary(
            slot,
            packageByTeacherKey,
        ),
        studentId,
        nowMillis,
      }));
    });
  });
  return releasedRowsByKey;
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
      ["inactive", "expired", "ended", "revoked", "cancelled", "canceled"]
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
      packageData,
      remainingCount: safeRemainingCount,
      makeupAvailableCount: safeRemainingCount,
      totalCount: usage.totalCount,
      usedDeductedCount: usage.usedDeductedCount,
      privateCancelUsedCount: readPrivatePackageCancelUsed(packageData),
      privateCancelLimit: computePrivatePackageCancelLimit(packageData),
      privateCancelRemaining:
        resolvePrivatePackageCancelAllowance(packageData).remainingCancelCount,
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
      const summaries = byTeacherKey.get(packageTeacherKey) || [];
      summaries.push(summary);
      summaries.sort((a, b) => {
        const br = Number(b.remainingCount || 0);
        const ar = Number(a.remainingCount || 0);
        if (ar !== br) return br - ar;
        return String(a.packageId || "")
            .localeCompare(String(b.packageId || ""));
      });
      byTeacherKey.set(packageTeacherKey, summaries);
    });
    if (safeRemainingCount > 0) activePackageIds.push(docSnap.id);
  });
  return {byTeacherKey, activePackageIds};
}

function getSlotTeacherPackageSummary(slot, packageByTeacherKey) {
  const slotDate = normalizeId(slot && slot.date);
  const teacherKeys = getPrivateTeacherScopeKeys(slot);
  for (const teacherKey of teacherKeys) {
    const summaries = packageByTeacherKey.get(teacherKey);
    const list = Array.isArray(summaries) ?
      summaries :
      summaries ? [summaries] : [];
    const summary = list.find((candidate) => {
      if (!candidate) return false;
      return !slotDate ||
        privatePackageCoversDate(candidate.packageData, slotDate);
    });
    if (summary) return summary;
    const fallbackSummary =
      list.find((candidate) =>
        candidate && Number(candidate.remainingCount || 0) > 0,
      ) ||
      list.find(Boolean);
    if (slotDate && fallbackSummary) {
      return {
        ...fallbackSummary,
        remainingCount: 0,
        makeupAvailableCount: 0,
        dateOutOfRange: true,
      };
    }
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
  const conflictTeacherKey = getPrivateTeacherScopeKeys({
    teacher,
    teacherName,
    teacherKey,
    teacherUid,
    teacherUID,
  })[0] || "";
  return `${conflictTeacherKey}__${normalizeId(date)}__${normalizeId(time)}`;
}

function getPrivateRowTeacherKeys(row) {
  return getPrivateTeacherScopeKeys(row);
}

function getPrivateRowStudentId(row) {
  return normalizeId(
      row && (
        row.studentId ||
        row.studentID ||
        row.studentUid ||
        row.studentUID ||
        row.reservedStudentId ||
        row.reservedStudentUid ||
        row.fixedStudentId ||
        row.fixedStudentUid ||
        row.assignedStudentId ||
        row.assignedStudentUid
      ),
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
  const countedFixedLessonIds = new Set();
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
    const lessonId = normalizeId(lesson && (lesson.id || lesson.lessonId));
    if (lessonId) countedFixedLessonIds.add(lessonId);
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
    const linkedLessonId = normalizeId(
        reservation && (reservation.lessonId || reservation.fixedLessonId),
    );
    if (linkedLessonId && countedFixedLessonIds.has(linkedLessonId)) {
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
      if (docSnap.ref.parent.id === "lessons" &&
          !isBlockingPrivateLessonForAvailability(row)) {
        continue;
      }
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
    openForStudentBooking: true,
    useForFixedAssignment: template.useForFixedAssignment !== false,
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
    if (!privateAvailabilityTemplateOpenForStudentBooking(data)) return;
    const teacher = normalizeTeacherKey(
        data.teacherKey || data.teacher || data.teacherUid,
    );
    if (!teacher || !teacherKeys.includes(teacher)) return;
    const weekday = Number(data.weekday);
    if (!Number.isInteger(weekday) || weekday < 1 || weekday > 6) return;
    const time = normalizeId(data.time);
    if (!/^([01]\d|2[0-3]):([0-5]\d)$/.test(time)) return;
    weeks.forEach((weekStartsOn) => {
      const date = addSeoulDays(weekStartsOn, weekday - 1);
      if (!privateAvailabilityTemplateAppliesToDate(data, date)) return;
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
        openForStudentBooking: true,
        useForFixedAssignment: data.useForFixedAssignment !== false,
      };
      const packageSummary = getSlotTeacherPackageSummary(
          slot,
          packageByTeacherKey,
      );
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
              isGroupTicketPackage(pkg) &&
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
              const groupClass = groupClassById.get(lessonGroupId) || null;
              const scopedLesson = withGroupClassCourseTypeFallback(
                  lesson,
                  groupClass,
              );
              return lesson.isBookable === true &&
                !isCancelledOrDeletedGroupLesson(lesson) &&
                lessonGroupId &&
                activeGroupClassIds.has(lessonGroupId) &&
                studentGroupTickets.some((ticket) =>
                  groupTicketMatchesFreeBookingScope(ticket, scopedLesson),
                );
            })
            .map((docSnap) => {
              const lesson = {id: docSnap.id, ...docSnap.data()};
              const lessonGroupId = getGroupLessonGroupId(lesson);
              const groupClass = groupClassById.get(lessonGroupId) || null;
              const scopedLesson = withGroupClassCourseTypeFallback(
                  lesson,
                  groupClass,
              );
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
              if (availability.remainingSeats <= 0) return null;
              const ticketCandidates = studentGroupTickets
                  .filter((ticket) =>
                    groupTicketMatchesFreeBookingScope(ticket, scopedLesson),
                  )
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
              if (ambiguous || Number(balance.availableToBook || 0) <= 0) {
                return null;
              }
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

        const fixedMemberLessons = lessonSnap.docs
            .filter((docSnap) => {
              const lesson = docSnap.data() || {};
              const lessonGroupId = getGroupLessonGroupId(lesson);
              return !isCancelledOrDeletedGroupLesson(lesson) &&
                lessonGroupId &&
                activeGroupClassIds.has(lessonGroupId);
            })
            .filter((docSnap) => {
              const lesson = {id: docSnap.id, ...docSnap.data()};
              return getFixedMembersForLesson(groupStudents, lesson).some(
                  (member) => normalizeId(member.studentId) === studentId,
              );
            })
            .map((docSnap) => sanitizeFixedMemberLessonForStudent(docSnap))
            .sort((a, b) => {
              const aKey = `${a.date || ""} ${a.time || ""} ${a.subject || ""}`;
              const bKey = `${b.date || ""} ${b.time || ""} ${b.subject || ""}`;
              return aKey.localeCompare(bKey, "ko");
            });

        return {lessons, fixedMemberLessons};
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
          const lessonForTicketScope = withGroupClassCourseTypeFallback(
              lesson,
              groupClassSnap.data() || {},
          );
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
                "반 등록 학생은 추가 예약 대상이 아닙니다.",
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
            lesson: lessonForTicketScope,
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
          const reservationPackageId = normalizeId(reservation.packageId);

          const {reservationsSnap} =
            await getGroupSeatInputSnaps(transaction, db, academyId);
          const allReservations = reservationsSnap.docs.map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));
          if (membership.role === "student" && reservationPackageId) {
            const packageRef = db
                .collection("studentPackages")
                .doc(reservationPackageId);
            const packageSnap = await transaction.get(packageRef);
            if (!packageSnap.exists) {
              throw new HttpsError(
                  "failed-precondition",
                  "예약에 연결된 수강권을 찾을 수 없습니다.",
              );
            }
            const pkg = {id: packageSnap.id, ...packageSnap.data()};
            if (normalizeId(pkg.academyId) !== academyId ||
                normalizeId(pkg.studentId) !== studentId) {
              throw new HttpsError("permission-denied", "Package mismatch.");
            }
            const cancelPolicy = getGroupCancelLimitPolicy(pkg, Date.now());
            if (cancelPolicy.enabled) {
              const usedCancelCount = countStudentGroupCancellationsForLimit({
                reservations: allReservations,
                academyId,
                studentId,
                packageId: reservationPackageId,
                bounds: cancelPolicy,
              });
              if (usedCancelCount >= cancelPolicy.limitCount) {
                const message =
                  `단체반 자유 예약 취소 가능 횟수(${cancelPolicy.limitCount}회)를 모두 사용했습니다.`;
                throw new HttpsError(
                    "failed-precondition",
                    message,
                );
              }
            }
          }
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
            cancelledByRole:
              membership.role === "student" ? "student" : "admin",
            cancelledByUid: uid,
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
                "차감취소된 등록 좌석이 아닙니다.",
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
        const privatePackageSummaries =
          getComputedPrivatePackageSummaries(packageSummary);
        // Slot-date package matching keeps 수강권 기간 밖 dates unbookable
        // even when another private package has remainingCount.
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
        const bookingEnabled = isPrivateSlotAvailabilityBookingEnabled(
            data,
            summary,
        );
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
          const isClosedByTeacherUnavailable =
            status === "cancelled" &&
            isTeacherUnavailablePrivateCancellationReason(
                slot.releaseReason || slot.cancelledReason ||
                slot.cancellationReason,
            );
          if (normalizeId(slot.academyId) !== academyId) return;
          if (!(status === "open" ||
            status === "reserved" ||
            status === "blocked" ||
            isClosedByTeacherUnavailable)) {
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
          ["open", "reserved", "blocked", "cancelled"].forEach((status) => {
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
        const staleCancelledReservationBySlotId = new Map();
        await Promise.all(
            visibleSlotEntries.map(async ([slotId, slot]) => {
              if (String(slot.status || "").trim() !== "reserved") return;
              const reservationId = getPrivateSlotLinkedReservationId({
                academyId,
                slotId,
                slot,
              });
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
                return;
              }
              if (privateSlotHasCancelledLinkedReservation({
                slot,
                reservation,
                academyId,
                slotId,
              })) {
                staleCancelledReservationBySlotId.set(slotId, reservation);
              }
            }),
        );

        let manualSlots = visibleSlotEntries
            .filter(([slotId, slot]) => {
              const status = String(slot.status || "").trim();
              if (status === "open") {
                return true;
              }
              if (staleCancelledReservationBySlotId.has(slotId)) return true;
              if (status !== "reserved") return false;
              const reservation = activeReservationBySlotId.get(slotId);
              return normalizeId(reservation && reservation.studentId) ===
                studentId;
            })
            .map(([slotId, slot]) => {
              const staleCancelled =
                staleCancelledReservationBySlotId.has(slotId);
              const effectiveSlot = staleCancelled ?
                buildReservablePrivateSlotFromStaleReservation(slot) :
                slot;
              return sanitizePrivateSlotAvailabilityRow({
                slotId,
                slot: effectiveSlot,
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
              });
            });

        const reservedSlotIds = new Set(
            staleCancelledReservationBySlotId.keys(),
        );
        visibleSlotEntries.forEach(([slotId, slot]) => {
          if (String(slot.status || "").trim() !== "reserved") return;
          if (activeReservationBySlotId.has(slotId)) {
            reservedSlotIds.add(slotId);
          }
        });
        const busyRowsByKey = teacherKeys.length > 0 ?
          await loadBusyPrivateScheduleRows(db, {
            academyId,
            teacherKeys,
            packageByTeacherKey: packageSummary.byTeacherKey,
            rangeStart,
            rangeEnd,
            ignoredSlotIds: reservedSlotIds,
          }) :
          new Map();
        visibleSlotEntries.forEach(([slotId, slot]) => {
          if (String(slot.status || "").trim() !== "reserved") return;
          if (staleCancelledReservationBySlotId.has(slotId)) return;
          const reservation = activeReservationBySlotId.get(slotId);
          if (normalizeId(reservation && reservation.studentId) === studentId) {
            return;
          }
          const key = getPrivateSlotConflictKey(slot || {});
          if (!key) return;
          const teacherKey = getPrivateScheduleTeacherKey(slot);
          if (!teacherKey) return;
          busyRowsByKey.set(key, buildBusyPrivateScheduleRow({
            id: `busy__privateLessonSlots__${slotId}`,
            academyId,
            teacherKey,
            teacherUid: normalizeId(slot.teacherUid || slot.teacherUID),
            teacherName: slot.teacherName || slot.teacher || teacherKey,
            date: normalizeId(slot.date),
            time: normalizeId(slot.time),
            durationMinutes: getPrivateScheduleDurationMinutes(slot),
            packageSummary: getSlotTeacherPackageSummary(
                slot,
                packageSummary.byTeacherKey,
            ),
            status: "reserved",
          }));
        });
        const releasedRowsByKey = teacherKeys.length > 0 ?
          await loadReleasedFixedPrivateLessonSlots(db, {
            academyId,
            teacherKeys,
            packageByTeacherKey: packageSummary.byTeacherKey,
            rangeStart,
            rangeEnd,
            bookingEnabled,
            pilotBookable,
            studentId,
            nowMillis,
          }) :
          new Map();
        releasedRowsByKey.forEach((row, key) => {
          busyRowsByKey.delete(key);
        });
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
          ...Array.from(releasedRowsByKey.values()),
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

        return {
          ok: true,
          academyId,
          slots,
          cancelAllowance,
          privatePackages: privatePackageSummaries,
        };
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
            if (!privateAvailabilityTemplateOpenForStudentBooking(template)) {
              throw new HttpsError("failed-precondition", "slot-not-available");
            }
            const weekday = getSeoulWeekday(requestedDate);
            if (weekday !== Number(template.weekday)) {
              throw new HttpsError("failed-precondition", "slot-not-available");
            }
            if (!privateAvailabilityTemplateAppliesToDate(
                template,
                requestedDate,
            )) {
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
            const releasedLessonId = parseReleasedFixedPrivateSlotId(slotId);
            if (releasedLessonId) {
              const lessonRef = db.collection("lessons").doc(releasedLessonId);
              const lessonSnap = await transaction.get(lessonRef);
              if (!lessonSnap.exists) {
                throw new HttpsError("not-found", "slot-not-available");
              }
              const lesson = lessonSnap.data() || {};
              if (
                normalizeId(lesson.academyId) !== academyId ||
                !isReleasedFixedPrivateSeatLesson(lesson)
              ) {
                throw new HttpsError(
                    "failed-precondition",
                    "slot-not-available",
                );
              }
              slot = buildSlotFromReleasedFixedPrivateLesson({
                academyId,
                lessonId: releasedLessonId,
                lesson,
              });
              shouldCreateGeneratedSlot = true;
            }
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
          const slotStatus = normalizeId(slot.status).toLowerCase();
          if (slotStatus !== "open") {
            let canUseStaleCancelledReservation = false;
            if (slotStatus === "reserved") {
              const linkedReservationId = getPrivateSlotLinkedReservationId({
                academyId,
                slotId,
                slot,
              });
              if (linkedReservationId) {
                const linkedReservationSnap = await transaction.get(
                    db
                        .collection("privateLessonReservations")
                        .doc(linkedReservationId),
                );
                const linkedReservation = linkedReservationSnap.exists ?
                  linkedReservationSnap.data() || {} :
                  null;
                canUseStaleCancelledReservation =
                  privateSlotHasCancelledLinkedReservation({
                    slot,
                    reservation: linkedReservation,
                    academyId,
                    slotId,
                  });
              }
            }
            if (!canUseStaleCancelledReservation) {
              throw new HttpsError(
                  "failed-precondition",
                  "Private lesson slot is not open.",
              );
            }
            slot = buildReservablePrivateSlotFromStaleReservation(slot);
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
          requirePrivateSlotReservationAllowed(data, summary);
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
            lessonDate: date,
          });
          // The transaction repeats the slot lessonDate guard so 수강권 기간 밖
          // dates cannot reserve against an unrelated remainingCount.
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
          const durationMinutes = getPrivateScheduleDurationMinutes(slot);
          const reservationData = {
            academyId,
            slotId,
            studentId,
            teacher,
            date,
            time,
            durationMinutes,
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
          const studentRef = db.collection("privateStudents").doc(studentId);
          const summaryRef = db
              .collection("studentPrivateAccessSummary")
              .doc(`${academyId}__${studentId}`);

          const [
            reservationSnap,
            slotSnap,
            studentSnap,
            summarySnap,
          ] = await Promise.all([
            transaction.get(reservationRef),
            transaction.get(slotRef),
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
                "Private reservation can only be cancelled at least 10 hours " +
                "before start time.",
            );
          }

          const reservationPackageId = normalizeId(reservation.packageId);
          if (!reservationPackageId) {
            throw new HttpsError(
                "failed-precondition",
                "수강권 연결 정보가 없어 학원에 문의해 주세요.",
            );
          }
          const packageRef = db
              .collection("studentPackages")
              .doc(reservationPackageId);
          const packageSnap = await transaction.get(packageRef);
          if (!packageSnap.exists) {
            throw new HttpsError(
                "failed-precondition",
                "수강권 연결 정보가 없어 학원에 문의해 주세요.",
            );
          }
          const packageData = packageSnap.data() || {};
          const allowance = assertPrivatePackageStudentCancelAllowed({
            packageData,
            academyId,
            studentId,
            teacherKey: getReservationTeacherKey(reservation, slot),
            teacherKeys: getReservationTeacherKeys(reservation, slot),
          });

          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(
              reservationRef,
              buildCancelledPrivateReservationUpdates({
                now,
                uid,
                studentId,
              }),
          );
          transaction.update(packageRef, {
            privateCancelUsedCount: allowance.privateCancelUsedCount + 1,
            updatedAt: now,
          });

          if (privateSlotBelongsToCancelledReservation({
            slot,
            reservationId,
            studentId,
          })) {
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
            packageCancelAllowance: {
              privateCancelUsedCount: allowance.privateCancelUsedCount + 1,
              privateCancelLimit: allowance.privateCancelLimit,
              remainingCancelCount: Math.max(
                  0,
                  allowance.privateCancelLimit -
                    (allowance.privateCancelUsedCount + 1),
              ),
            },
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.cancelFixedPrivateLessonOccurrence = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }
        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const lessonId = requireString(data, "lessonId");
        const cancellationType = normalizeFixedPrivateCancellationType(
            data.cancellationType,
        );
        const reason = normalizeId(data.reason);
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const membershipRef = db
            .collection("academyMemberships")
            .doc(`${academyId}_${uid}`);
        const lessonRef = db.collection("lessons").doc(lessonId);

        return await db.runTransaction(async (transaction) => {
          const [membershipSnap, lessonSnap] = await Promise.all([
            transaction.get(membershipRef),
            transaction.get(lessonRef),
          ]);
          const membership = requireActiveAcademyMembership(membershipSnap);
          const actorRole = getFixedPrivateActorRole(membership);
          const actorName = getCallableActorName(request.auth, membership);
          if (!lessonSnap.exists) {
            throw new HttpsError(
                "not-found",
                "Fixed private lesson not found.",
            );
          }
          const lesson = lessonSnap.data() || {};
          if (normalizeId(lesson.academyId) !== academyId) {
            throw new HttpsError(
                "permission-denied",
                "Fixed private lesson academy mismatch.",
            );
          }
          if (!isFixedPrivateLessonOccurrence(lesson)) {
            throw new HttpsError(
                "failed-precondition",
                "Only fixed private lesson occurrences can be cancelled here.",
            );
          }
          const lessonStatus = normalizeId(lesson.status).toLowerCase();
          const alreadyStudentSeatReleased =
            isStudentReleasedFixedPrivateLessonCancellation(lesson);
          if (
            (lessonStatus === "cancelled" || lessonStatus === "canceled") &&
            !alreadyStudentSeatReleased
          ) {
            throw new HttpsError(
                "failed-precondition",
                "Fixed private lesson is already cancelled.",
            );
          }
          const startMillis = getFixedPrivateLessonStartMillis(lesson);
          if (
            !alreadyStudentSeatReleased &&
            (startMillis === null || Date.now() >= startMillis)
          ) {
            throw new HttpsError(
                "failed-precondition",
                "Only future fixed private lessons can be cancelled.",
            );
          }

          const lessonStudentId = normalizeId(
              lesson.studentId || lesson.studentID,
          );
          let packageRef = null;
          let allowance = null;
          if (actorRole === "student") {
            if (
              !membership.studentId ||
              membership.studentId !== lessonStudentId
            ) {
              throw new HttpsError(
                  "permission-denied",
                  "Cannot cancel another student's fixed private lesson.",
              );
            }
            if (
              !alreadyStudentSeatReleased &&
              Date.now() > startMillis - STUDENT_PRIVATE_CANCEL_CUTOFF_MS
            ) {
              throw new HttpsError(
                  "failed-precondition",
                  "Fixed private lessons can only be cancelled at least " +
                  "10 hours " +
                  "before start time.",
              );
            }
            const lessonPackageId = normalizeId(lesson.packageId);
            if (!lessonPackageId && !alreadyStudentSeatReleased) {
              throw new HttpsError(
                  "failed-precondition",
                  "수강권 연결 정보가 없어 학원에 문의해 주세요.",
              );
            }
            if (lessonPackageId) {
              packageRef = db
                  .collection("studentPackages")
                  .doc(lessonPackageId);
              const packageSnap = await transaction.get(packageRef);
              if (!packageSnap.exists && !alreadyStudentSeatReleased) {
                throw new HttpsError(
                    "failed-precondition",
                    "수강권 연결 정보가 없어 학원에 문의해 주세요.",
                );
              }
              if (!alreadyStudentSeatReleased) {
                const packageData = packageSnap.data() || {};
                allowance = assertPrivatePackageStudentCancelAllowed({
                  packageData,
                  academyId,
                  studentId: lessonStudentId,
                  teacherKey: normalizeId(lesson.teacher || lesson.teacherKey),
                  teacherKeys: getPrivateTeacherScopeKeys(lesson),
                });
              }
            }
          } else if (actorRole === "teacher") {
            throw new HttpsError(
                "permission-denied",
                "Fixed private lesson actions require admin permission.",
            );
          }

          const reservationReadPromises = [];
          const lessonReservationId = normalizeId(lesson.reservationId);
          if (lessonReservationId) {
            reservationReadPromises.push(transaction.get(
                db.collection("privateLessonReservations")
                    .doc(lessonReservationId),
            ));
          }
          reservationReadPromises.push(
              transaction.get(db.collection("privateLessonReservations")
                  .where("lessonId", "==", lessonId)),
              transaction.get(db.collection("privateLessonReservations")
                  .where("fixedLessonId", "==", lessonId)),
          );
          const slotReadPromises = [];
          const lessonSlotId = normalizeId(
              lesson.slotId || lesson.privateLessonSlotId,
          );
          if (lessonSlotId) {
            slotReadPromises.push(transaction.get(
                db.collection("privateLessonSlots").doc(lessonSlotId),
            ));
          }
          slotReadPromises.push(
              transaction.get(db.collection("privateLessonSlots")
                  .where("lessonId", "==", lessonId)),
              transaction.get(db.collection("privateLessonSlots")
                  .where("fixedLessonId", "==", lessonId)),
          );
          const [reservationReadResults, slotReadResults] = await Promise.all([
            Promise.all(reservationReadPromises),
            Promise.all(slotReadPromises),
          ]);
          const reservationSnapsByPath = new Map();
          const addReservationSnap = (snap) => {
            if (!snap || !snap.exists) return;
            const row = snap.data() || {};
            if (normalizeId(row.academyId) !== academyId) return;
            reservationSnapsByPath.set(snap.ref.path, snap);
          };
          reservationReadResults.forEach((result) => {
            if (result && Array.isArray(result.docs)) {
              result.docs.forEach(addReservationSnap);
            } else {
              addReservationSnap(result);
            }
          });
          const slotSnapsByPath = new Map();
          const addSlotSnap = (snap) => {
            if (!snap || !snap.exists) return;
            const row = snap.data() || {};
            if (normalizeId(row.academyId) !== academyId) return;
            slotSnapsByPath.set(snap.ref.path, snap);
          };
          slotReadResults.forEach((result) => {
            if (result && Array.isArray(result.docs)) {
              result.docs.forEach(addSlotSnap);
            } else {
              addSlotSnap(result);
            }
          });

          const now = admin.firestore.FieldValue.serverTimestamp();
          const effectiveReason = reason || (
            cancellationType === "seat_released" ?
              "fixed_private_seat_released" :
              "fixed_private_lesson_cancelled"
          );
          const cancellationTimestamp = alreadyStudentSeatReleased ?
            (lesson.cancelledAt ||
              lesson.canceledAt ||
              lesson.releasedAt ||
              now) :
            now;
          const syncUid = alreadyStudentSeatReleased ?
            normalizeId(lesson.cancelledBy || lesson.cancelledByUid || uid) :
            uid;
          const syncActorRole = alreadyStudentSeatReleased ?
            (normalizeId(lesson.cancelledByRole) || actorRole) :
            actorRole;
          const syncActorName = alreadyStudentSeatReleased ?
            (normalizeId(lesson.cancelledByName) || actorName) :
            actorName;
          const syncReason = alreadyStudentSeatReleased ?
            (normalizeId(lesson.cancellationReason || lesson.cancelledReason) ||
              effectiveReason) :
            effectiveReason;
          if (!alreadyStudentSeatReleased) {
            transaction.update(
                lessonRef,
                buildFixedPrivateLessonCancellationPatch({
                  now: cancellationTimestamp,
                  uid,
                  actorRole,
                  actorName,
                  cancellationType,
                  reason: effectiveReason,
                  lessonId,
                }),
            );
          }
          reservationSnapsByPath.forEach((snap) => {
            transaction.update(
                snap.ref,
                buildFixedPrivateReservationCancellationPatch({
                  now: cancellationTimestamp,
                  uid: syncUid,
                  actorRole: syncActorRole,
                  actorName: syncActorName,
                  cancellationType,
                  reason: syncReason,
                  lessonId,
                }),
            );
          });
          slotSnapsByPath.forEach((snap) => {
            transaction.update(
                snap.ref,
                buildOriginalFixedPrivateSlotReleasePatch({
                  now: cancellationTimestamp,
                  uid: syncUid,
                  actorRole: syncActorRole,
                  actorName: syncActorName,
                  cancellationType,
                  reason: syncReason,
                  lessonId,
                }),
            );
          });
          if (cancellationType === "seat_released") {
            const releasedSlotRef = db
                .collection("privateLessonSlots")
                .doc(buildReleasedFixedPrivateSlotId(lessonId));
            transaction.set(
                releasedSlotRef,
                buildReleasedFixedPrivateLessonSlot({
                  academyId,
                  lessonId,
                  lesson,
                  now: cancellationTimestamp,
                  uid: syncUid,
                  actorRole: syncActorRole,
                  actorName: syncActorName,
                }),
                {merge: true},
            );
          } else {
            const closedSlotRef = db
                .collection("privateLessonSlots")
                .doc(buildClosedFixedPrivateSlotId(lessonId));
            transaction.set(
                closedSlotRef,
                buildClosedFixedPrivateLessonSlot({
                  academyId,
                  lessonId,
                  lesson,
                  now: cancellationTimestamp,
                  uid: syncUid,
                  actorRole: syncActorRole,
                  actorName: syncActorName,
                  cancellationReason: syncReason,
                }),
                {merge: true},
            );
          }
          if (!alreadyStudentSeatReleased) {
            createPrivateSlotNotification(transaction, db, {
              academyId,
              type: "private_fixed_lesson_cancelled",
              studentId: lessonStudentId,
              studentName: normalizeId(lesson.studentName || lesson.student),
              teacher: normalizeId(lesson.teacher || lesson.teacherKey),
              teacherName: normalizeId(lesson.teacherName || lesson.teacher),
              slotId: buildReleasedFixedPrivateSlotId(lessonId),
              reservationId: normalizeId(lesson.reservationId),
              date: normalizeId(lesson.date),
              time: normalizeId(lesson.time),
              source: actorRole,
              actorUid: uid,
              actorRole,
              actorName,
              reason: effectiveReason,
              createdAt: now,
            });
          }

          let nextPackageCancelAllowance = null;
          if (
            actorRole === "student" &&
            packageRef &&
            allowance &&
            !alreadyStudentSeatReleased
          ) {
            const nextPrivateCancelUsedCount =
              allowance.privateCancelUsedCount + 1;
            transaction.update(packageRef, {
              privateCancelUsedCount: nextPrivateCancelUsedCount,
              updatedAt: now,
            });
            nextPackageCancelAllowance = {
              privateCancelUsedCount: nextPrivateCancelUsedCount,
              privateCancelLimit: allowance.privateCancelLimit,
              remainingCancelCount: Math.max(
                  0,
                  allowance.privateCancelLimit - nextPrivateCancelUsedCount,
              ),
            };
          }

          return {
            ok: true,
            academyId,
            lessonId,
            cancellationType,
            cancelledByRole: actorRole,
            isSeatReleased: cancellationType === "seat_released",
            packageCancelAllowance: nextPackageCancelAllowance,
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.adminClosePrivateLessonSlot = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const slotId = requireString(data, "slotId");
        const availabilityTemplateId = optionalString(
            data,
            "availabilityTemplateId",
        );
        const requestedDate = optionalString(data, "date");
        const requestedTime = optionalString(data, "time");
        const cancellationReason =
          normalizeId(data.cancellationReason) || "teacher_unavailable";
        if (!isTeacherUnavailablePrivateCancellationReason(
            cancellationReason,
        )) {
          throw new HttpsError(
              "invalid-argument",
              "Only teacher unavailable closure reasons are supported.",
          );
        }
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const adminMembership = await requireAcademyAdmin(db, academyId, uid);
        const actor = buildAdminActorContext(request.auth, adminMembership);
        const slotRef = db.collection("privateLessonSlots").doc(slotId);

        return await db.runTransaction(async (transaction) => {
          const slotSnap = await transaction.get(slotRef);
          const now = admin.firestore.FieldValue.serverTimestamp();
          let slot = null;
          let closedReservation = null;
          let closedReservationId = "";

          if (slotSnap.exists) {
            slot = slotSnap.data() || {};
            if (normalizeId(slot.academyId) !== academyId) {
              throw new HttpsError(
                  "permission-denied",
                  "Private lesson slot academy mismatch.",
              );
            }
            const status = normalizeId(slot.status).toLowerCase();
            if (status === "reserved") {
              const linkedReservationId = getPrivateSlotLinkedReservationId({
                academyId,
                slotId,
                slot,
              });
              if (linkedReservationId) {
                const reservationRef = db
                    .collection("privateLessonReservations")
                    .doc(linkedReservationId);
                const reservationSnap = await transaction.get(reservationRef);
                if (reservationSnap.exists) {
                  const reservation = reservationSnap.data() || {};
                  if (
                    normalizeId(reservation.academyId) === academyId &&
                    normalizeId(reservation.slotId) === slotId &&
                    isActivePrivateReservation(reservation)
                  ) {
                    closedReservation = reservation;
                    closedReservationId = linkedReservationId;
                    transaction.update(
                        reservationRef,
                        buildCancelledPrivateReservationUpdates({
                          now,
                          uid,
                          studentId: normalizeId(reservation.studentId),
                          cancelledBy: "admin",
                          cancelledByRole: actor.actorRole,
                          actorName: actor.actorName,
                          cancellationReason,
                        }),
                    );
                  }
                }
              }
            }
            transaction.update(slotRef, buildAdminClosedPrivateSlotUpdates({
              slot,
              now,
              uid,
              actorRole: actor.actorRole,
              actorName: actor.actorName,
              cancellationReason,
            }));
          } else {
            if (!availabilityTemplateId || !requestedDate || !requestedTime) {
              throw new HttpsError(
                  "invalid-argument",
                  "Template id, date, and time are required for empty slots.",
              );
            }
            const expectedSlotId = buildPrivateTemplateSlotId({
              templateId: availabilityTemplateId,
              date: requestedDate,
              time: requestedTime,
            });
            if (expectedSlotId !== slotId) {
              throw new HttpsError(
                  "failed-precondition",
                  "Template slot id does not match date/time.",
              );
            }
            const templateRef = db
                .collection("privateLessonAvailabilityTemplates")
                .doc(availabilityTemplateId);
            const templateSnap = await transaction.get(templateRef);
            if (!templateSnap.exists) {
              throw new HttpsError(
                  "not-found",
                  "Availability template not found.",
              );
            }
            const template = templateSnap.data() || {};
            if (normalizeId(template.academyId) !== academyId) {
              throw new HttpsError(
                  "permission-denied",
                  "Availability template academy mismatch.",
              );
            }
            if (normalizeId(template.status || "active") !== "active") {
              throw new HttpsError(
                  "failed-precondition",
                  "Availability template is inactive.",
              );
            }
            if (!privateAvailabilityTemplateAppliesToDate(
                template,
                requestedDate,
            )) {
              throw new HttpsError(
                  "failed-precondition",
                  "Availability template does not apply to this date.",
              );
            }
            if (getSeoulWeekday(requestedDate) !== Number(template.weekday)) {
              throw new HttpsError(
                  "failed-precondition",
                  "Availability template weekday mismatch.",
              );
            }
            if (normalizeId(template.time) !== requestedTime) {
              throw new HttpsError(
                  "failed-precondition",
                  "Availability template time mismatch.",
              );
            }
            slot = buildAdminClosedPrivateSlotFromTemplate({
              templateId: availabilityTemplateId,
              template,
              date: requestedDate,
              time: requestedTime,
              now,
              uid,
              actor,
              cancellationReason,
            });
            transaction.set(slotRef, slot);
          }

          createPrivateSlotNotification(transaction, db, {
            academyId,
            type: closedReservation ?
              "private_slot_cancelled" :
              "private_slot_closed",
            studentId: normalizeId(
                closedReservation && closedReservation.studentId,
            ),
            studentName: normalizeId(
                closedReservation && closedReservation.studentName,
            ),
            teacher: normalizeId(slot.teacher || slot.teacherKey),
            teacherName: normalizeId(slot.teacherName || slot.teacher),
            slotId,
            reservationId: closedReservationId,
            date: normalizeId(slot.date),
            time: normalizeId(slot.time),
            source: "admin",
            actorUid: actor.actorUid,
            actorRole: actor.actorRole,
            actorName: actor.actorName,
            reason: cancellationReason,
            createdAt: now,
          });

          return {
            ok: true,
            academyId,
            slotId,
            reservationId: closedReservationId,
            cancelledReservation: Boolean(closedReservation),
            releasedForPrivateBooking: false,
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.adminReopenPrivateLessonSlot = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const academyId = requireString(data, "academyId");
        const slotId = requireString(data, "slotId");
        const reason =
          normalizeId(data.reason) || "teacher_unavailable_reopened";
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const adminMembership = await requireAcademyAdmin(db, academyId, uid);
        const actor = buildAdminActorContext(request.auth, adminMembership);
        const slotRef = db.collection("privateLessonSlots").doc(slotId);

        return await db.runTransaction(async (transaction) => {
          const slotSnap = await transaction.get(slotRef);
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

          const status = normalizeId(slot.status).toLowerCase();
          const closedReason = normalizeId(
              slot.releaseReason ||
              slot.cancellationReason ||
              slot.cancelledReason,
          );
          if (
            !["blocked", "cancelled", "canceled"].includes(status) ||
            !isTeacherUnavailablePrivateCancellationReason(closedReason)
          ) {
            throw new HttpsError(
                "failed-precondition",
                "Only teacher-unavailable closed slots can be reopened.",
            );
          }

          const now = admin.firestore.FieldValue.serverTimestamp();
          transaction.update(slotRef, buildAdminReopenedPrivateSlotUpdates({
            slot,
            now,
            uid,
            actorRole: actor.actorRole,
            actorName: actor.actorName,
            reason,
          }));

          createPrivateSlotNotification(transaction, db, {
            academyId,
            type: "private_slot_reopened",
            studentId: "",
            studentName: "",
            teacher: normalizeId(slot.teacher || slot.teacherKey),
            teacherName: normalizeId(slot.teacherName || slot.teacher),
            slotId,
            reservationId: "",
            date: normalizeId(slot.date),
            time: normalizeId(slot.time),
            source: "admin",
            actorUid: actor.actorUid,
            actorRole: actor.actorRole,
            actorName: actor.actorName,
            reason,
            createdAt: now,
          });

          return {
            ok: true,
            academyId,
            slotId,
            releasedForPrivateBooking: true,
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
        const cancellationReason =
          normalizeId(data.cancellationReason) || "admin_cancelled";
        validateAcademyId(academyId);

        const db = admin.firestore();
        const uid = request.auth.uid;
        const adminMembership = await requireAcademyAdmin(db, academyId, uid);
        const actor = buildAdminActorContext(request.auth, adminMembership);

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
                cancelledByRole: actor.actorRole,
                actorName: actor.actorName,
                cancellationReason,
              }),
          );
          const shouldCloseSlot =
            isTeacherUnavailablePrivateCancellationReason(
                cancellationReason,
            );
          if (normalizeId(slot.reservationId) === reservationId) {
            if (shouldCloseSlot) {
              transaction.update(slotRef, buildAdminClosedPrivateSlotUpdates({
                slot,
                now,
                uid,
                actorRole: actor.actorRole,
                actorName: actor.actorName,
                cancellationReason,
              }));
            } else {
              transaction.update(slotRef, buildReleasedPrivateSlotUpdates({
                slot,
                reservation,
                studentId,
                now,
                releaseReason: "admin_cancelled",
              }));
            }
          }
          createPrivateSlotNotification(transaction, db, {
            academyId,
            type: "private_slot_cancelled",
            studentId,
            studentName: normalizeId(
                reservation.studentName || slot.studentName,
            ),
            teacher: normalizeId(slot.teacher || reservation.teacher),
            teacherName: normalizeId(
                slot.teacherName || reservation.teacherName,
            ),
            slotId,
            reservationId,
            date: normalizeId(slot.date || reservation.date),
            time: normalizeId(slot.time || reservation.time),
            source: "admin",
            actorUid: actor.actorUid,
            actorRole: actor.actorRole,
            actorName: actor.actorName,
            reason: cancellationReason,
            createdAt: now,
          });

          return {
            ok: true,
            academyId,
            slotId,
            studentId,
            reservationId,
            releasedForPrivateBooking: !shouldCloseSlot,
          };
        });
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.previewFixedPrivateLessonRescheduleScope = onCall({
  region: REGION,
  cors: true,
}, async (request) => {
  try {
    // Static guard: dryRun previewOnly commit selectedLessonId scopeMode.
    // Static guard: includedLessons excludedLessons wouldUpdate conflicts.
    // Static guard: warnings normalizedPlan.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required.");
    }

    const data = request.data || {};
    const validation = buildFixedPrivateRescheduleValidation(data);
    const db = admin.firestore();
    await requireAcademyAdmin(
        db,
        validation.academyId,
        request.auth.uid,
    );
    return await buildFixedPrivateReschedulePreviewResult({
      db,
      validation,
    });
  } catch (error) {
    throw asHttpsError(error);
  }
});

exports.updateFixedPrivateLessonScheduleScope = onCall({
  region: REGION,
  cors: true,
}, async (request) => {
  try {
    // Static guard: commit !== true dryRun !== false previewOnly !== false.
    // Static guard: requestId selectedLessonId scopeMode.
    // Static guard: fixedPrivateRescheduleBatches payloadHash.
    // Static guard: idempotentReplay.
    // Static guard: runTransaction transaction.get.
    // Static guard: transaction.set transaction.update.
    // Static guard: lessons privateLessonSlots privateLessonReservations.
    // Static guard: teacherTimePreparation teacherTemplateAction.
    // Static guard: normalizedPlan.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required.");
    }

    const data = request.data || {};
    const validation = buildFixedPrivateRescheduleCommitValidation(data);
    const db = admin.firestore();
    const membership = await requireAcademyAdmin(
        db,
        validation.academyId,
        request.auth.uid,
    );
    return await runFixedPrivateRescheduleWriteTransaction({
      db,
      auth: request.auth,
      membership,
      validation,
    });
  } catch (error) {
    throw asHttpsError(error);
  }
});

exports.inspectFixedPrivateLessonRescheduleScope = onCall({
  region: REGION,
  cors: true,
}, async (request) => {
  try {
    // Static guard: readOnly inspectOnly dryRun previewOnly commit false.
    // Static guard: before_commit after_commit generic normalizedTarget.
    // Static guard: selectedLesson linkedSlot linkedReservation.
    // Static guard: targetTemplate targetConflicts.
    // Static guard: fixedPrivateRescheduleBatch consistency.
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Login required.");
    }

    const data = request.data || {};
    const validation = buildFixedPrivateRescheduleValidation(data);
    const inspectMode = normalizeFixedPrivateRescheduleInspectMode(data);
    const db = admin.firestore();
    await requireAcademyAdmin(
        db,
        validation.academyId,
        request.auth.uid,
    );
    return await buildFixedPrivateRescheduleInspectorResult({
      db,
      validation,
      inspectMode,
    });
  } catch (error) {
    throw asHttpsError(error);
  }
});

exports.createFixedPrivateLessonRenewal = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "Login required.");
        }

        const data = request.data || {};
        const validation = buildFixedPrivateRenewalPreviewValidation(data);
        const db = admin.firestore();
        const membership = await requireAcademyAdmin(
            db,
            validation.academyId,
            request.auth.uid,
        );

        if (!validation.commit) {
          return buildFixedPrivateRenewalDryRunResult(validation);
        }

        return await runFixedPrivateRenewalWriteTransaction({
          db,
          auth: request.auth,
          membership,
          validation,
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
        requireE2eTestProject();
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

exports.previewPrivateLessonStatusAction = onCall(
    {region: REGION, cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "auth_required");
      }
      const data = request.data || {};
      if (data.commit === true) {
        throw new HttpsError("invalid-argument", "commit must be false.");
      }
      if (
        data.dryRun !== true ||
        data.previewOnly !== true ||
        data.commit !== false
      ) {
        throw new HttpsError(
            "invalid-argument",
            "dryRun true, previewOnly true, and commit false are required.",
        );
      }
      // Static guard contract: complete, no_show, reverse_deduction return
      // packageImpact, creditTransactionPreview, blockedReasons,
      // proposedState, normalizedPlan.
      const preview = await previewPrivateLessonStatusAction({
        db: admin.firestore(),
        auth: request.auth,
        data,
      });
      return {
        ...preview,
        dryRun: true,
        previewOnly: true,
        commit: false,
      };
    },
);

function mapPrivateReservationOutcomePackageBlockedReason(reason) {
  const reasonMap = {
    package_missing: "package_missing",
    academy_mismatch: "package_academy_mismatch",
    student_mismatch: "package_student_mismatch",
    package_not_active: "package_not_active",
    no_remaining_count: "package_remaining_insufficient",
    package_type_mismatch: "package_type_mismatch",
    missing_slot_teacher: "reservation_teacher_missing",
    missing_package_teacher: "package_teacher_missing",
    teacher_mismatch: "package_teacher_mismatch",
    package_date_out_of_range: "package_date_out_of_range",
  };
  return reasonMap[reason] || "package_mismatch";
}

function buildPrivateReservationOutcomePlan({
  academyId,
  reservationId,
  actionType,
  reservation,
  slot,
  packageDoc,
  packageIdCandidate = "",
  packageLookupReason = "",
  creditTransactionExists = false,
  creditTransactionId = "",
  actor = {},
  nowMillis,
}) {
  const blockedReasons = [];
  const warnings = [];
  const reservationData = reservation || null;
  const packageData = packageDoc && packageDoc.data ?
    packageDoc.data :
    null;
  const packageId = normalizeId(packageDoc && packageDoc.id) ||
    normalizeId(packageIdCandidate);
  const normalizedOutcome = actionType === "complete" ?
    "completed" :
    actionType === "no_show" ? "no_show" : "";

  if (!normalizedOutcome) blockedReasons.push("invalid_action");
  if (!reservationData) {
    blockedReasons.push("reservation_missing");
  }

  const currentReservationStatus = normalizeId(
      reservationData && reservationData.status,
  ).toLowerCase();
  const reservationAcademyMatches = Boolean(
      reservationData &&
      normalizeId(reservationData.academyId) === academyId,
  );
  if (reservationData) {
    if (!reservationAcademyMatches) {
      blockedReasons.push("academy_mismatch");
    } else {
      if (currentReservationStatus === "completed") {
        blockedReasons.push("already_completed");
      } else if (
        currentReservationStatus === "no_show" ||
        currentReservationStatus === "no-show"
      ) {
        blockedReasons.push("already_no_show");
      } else if (
        currentReservationStatus === "cancelled" ||
        currentReservationStatus === "canceled"
      ) {
        blockedReasons.push("reservation_cancelled");
      }
      if (!isActivePrivateReservation(reservationData)) {
        blockedReasons.push("reservation_not_active");
      }
      if (reservationData.deductionApplied === true) {
        blockedReasons.push("deduction_already_applied");
      }
      if (!normalizeId(reservationData.studentId) ||
          !normalizeId(reservationData.slotId)) {
        blockedReasons.push("reservation_linkage_missing");
      }
      if (slot && normalizeId(slot.academyId) !== academyId) {
        blockedReasons.push("slot_academy_mismatch");
      }
      const endMillis = getPrivateReservationEndMillis(reservationData, slot);
      if (endMillis === null) {
        blockedReasons.push("reservation_schedule_missing");
      } else if (!Number.isFinite(nowMillis) || nowMillis < endMillis) {
        blockedReasons.push("reservation_not_ended");
      }
      if (!slot && endMillis !== null) {
        warnings.push("slot_missing_using_reservation_schedule");
      }
    }
  }

  if (reservationAcademyMatches) {
    if (packageLookupReason) blockedReasons.push(packageLookupReason);
    if (!packageData) {
      blockedReasons.push("package_missing");
    } else {
      const packageRejectReason = getPrivatePackageRejectReason({
        pkg: packageData,
        academyId,
        studentId: normalizeId(reservationData.studentId),
        teacherKey: getReservationTeacherKey(reservationData, slot),
        teacherKeys: getReservationTeacherKeys(reservationData, slot),
        lessonDate: normalizeId(
            reservationData.date || (slot && slot.date),
        ),
      });
      if (packageRejectReason) {
        blockedReasons.push(
            mapPrivateReservationOutcomePackageBlockedReason(
                packageRejectReason,
            ),
        );
      }
    }
  }

  const usedValue = packageData ?
    Number(packageData.usedCount || 0) :
    NaN;
  const remainingValue = packageData ?
    Number(packageData.remainingCount || 0) :
    NaN;
  const currentUsedCount = Number.isFinite(usedValue) ? usedValue : null;
  const currentRemainingCount =
    Number.isFinite(remainingValue) ? remainingValue : null;
  if (packageData && currentUsedCount === null) {
    blockedReasons.push("package_count_invalid");
  }
  if (
    packageData &&
    (currentRemainingCount === null || currentRemainingCount <= 0)
  ) {
    blockedReasons.push("package_remaining_insufficient");
  }

  const nextUsedCount = currentUsedCount === null ?
    null :
    currentUsedCount + 1;
  const nextRemainingCount = currentRemainingCount === null ?
    null :
    Math.max(0, currentRemainingCount - 1);
  const currentPackageStatus = packageData ?
    normalizeId(packageData.status || "active").toLowerCase() :
    "";
  const nextPackageStatus = packageData && nextRemainingCount !== null ?
    getNextStudentPackageStatus(
        packageData.status,
        nextRemainingCount,
    ) :
    "";
  const creditActionType = normalizedOutcome === "completed" ?
    "private_reservation_completed_deduct" :
    normalizedOutcome === "no_show" ?
      "private_reservation_no_show_deduct" :
      "";

  if (creditTransactionExists) {
    blockedReasons.push("credit_transaction_already_exists");
  }
  if (!packageLookupReason &&
      !normalizeId(reservationData && reservationData.packageId) &&
      packageId) {
    warnings.push("matching_package_selected_by_legacy_rules");
  }

  const uniqueBlockedReasons = Array.from(new Set(blockedReasons));
  if (uniqueBlockedReasons.length === 0) {
    warnings.push("package_deduction_will_be_applied");
    warnings.push("credit_transaction_will_be_created");
  }
  const uniqueWarnings = Array.from(new Set(warnings));
  const wouldCreate = Boolean(
      normalizedOutcome &&
      reservationData &&
      packageData &&
      creditTransactionId &&
      !creditTransactionExists &&
      uniqueBlockedReasons.length === 0,
  );

  const packageImpact = {
    packageId,
    currentUsedCount,
    currentRemainingCount,
    usedCountDelta: 1,
    remainingCountDelta: -1,
    nextUsedCount,
    nextRemainingCount,
    currentStatus: currentPackageStatus,
    nextStatus: nextPackageStatus,
  };
  const creditTransactionPreview = {
    wouldCreate,
    creditTransactionId,
    sourceType: "privateReservation",
    sourceId: reservationId,
    deltaCount: -1,
    actionType: creditActionType,
    packageId,
    duplicateExists: creditTransactionExists === true,
  };
  const currentState = {
    reservation: reservationData ? {
      id: reservationId,
      status: currentReservationStatus,
      deductionApplied: reservationData.deductionApplied === true,
      deductionPackageId: normalizeId(
          reservationData.deductionPackageId,
      ),
      deductionCreditTransactionId: normalizeId(
          reservationData.deductionCreditTransactionId,
      ),
    } : null,
    package: packageData ? {
      id: packageId,
      status: currentPackageStatus,
      usedCount: currentUsedCount,
      remainingCount: currentRemainingCount,
    } : null,
    creditTransaction: {
      id: creditTransactionId,
      exists: creditTransactionExists === true,
    },
  };
  const proposedState = {
    reservation: reservationData ? {
      id: reservationId,
      currentStatus: currentReservationStatus,
      nextStatus: normalizedOutcome,
      deductionApplied: true,
      deductionPackageId: packageId,
      deductionCreditTransactionId: creditTransactionId,
    } : null,
  };
  const normalizedPlan = {
    academyId,
    reservationId,
    actionType,
    normalizedOutcome,
    packageId,
    creditTransactionId,
    packageUsedCount: nextUsedCount,
    packageRemainingCount: nextRemainingCount,
    packageStatus: nextPackageStatus,
    reservationStatus: normalizedOutcome,
    creditActionType,
    actorUid: normalizeId(actor.actorUid),
    actorRole: normalizeId(actor.actorRole),
  };
  return {
    ok: uniqueBlockedReasons.length === 0,
    blockedReasons: uniqueBlockedReasons,
    warnings: uniqueWarnings,
    currentState,
    proposedState,
    packageImpact,
    creditTransactionPreview,
    normalizedPlan,
  };
}

async function resolvePrivateReservationOutcomePreviewTarget({
  db,
  academyId,
  reservationId,
}) {
  const reservationRef = db
      .collection("privateLessonReservations")
      .doc(reservationId);
  const reservationSnap = await reservationRef.get();
  if (!reservationSnap.exists) {
    return {
      reservation: null,
      slot: null,
      packageDoc: null,
      packageId: "",
      packageLookupReason: "",
      creditTransactionId: "",
      creditTransactionExists: false,
    };
  }

  const reservation = reservationSnap.data() || {};
  if (normalizeId(reservation.academyId) !== academyId) {
    return {
      reservation: {
        academyId: normalizeId(reservation.academyId),
      },
      slot: null,
      packageDoc: null,
      packageId: "",
      packageLookupReason: "",
      creditTransactionId: "",
      creditTransactionExists: false,
    };
  }

  const slotId = normalizeId(reservation.slotId);
  const slotSnap = slotId ?
    await db.collection("privateLessonSlots").doc(slotId).get() :
    null;
  const slot = slotSnap && slotSnap.exists ? slotSnap.data() || {} : null;
  const explicitPackageId = normalizeId(reservation.packageId);
  let packageDoc = null;
  let packageLookupReason = "";

  if (explicitPackageId) {
    const packageSnap = await db
        .collection("studentPackages")
        .doc(explicitPackageId)
        .get();
    if (packageSnap.exists) {
      packageDoc = {
        id: packageSnap.id,
        data: packageSnap.data() || {},
      };
    } else {
      packageLookupReason = "package_missing";
    }
  } else {
    const studentId = normalizeId(reservation.studentId);
    if (studentId) {
      const packageSnap = await db
          .collection("studentPackages")
          .where("academyId", "==", academyId)
          .where("studentId", "==", studentId)
          .get();
      const candidates = packageSnap.docs.map((docSnap) => ({
        id: docSnap.id,
        ref: docSnap.ref,
        data: docSnap.data() || {},
      }));
      const matchingCandidates = candidates
          .filter((candidate) =>
            isPrivatePackageForReservation(
                candidate.data,
                reservation,
                slot,
            ) && Number(candidate.data.remainingCount || 0) > 0,
          )
          .sort(sortPrivatePackageCandidates);
      if (matchingCandidates.length > 0) {
        packageDoc = {
          id: matchingCandidates[0].id,
          data: matchingCandidates[0].data,
        };
      } else {
        const rejectedCandidates = candidates.map((candidate) => ({
          candidate,
          reason: getPrivatePackageRejectReason({
            pkg: candidate.data,
            academyId,
            studentId,
            teacherKey: getReservationTeacherKey(reservation, slot),
            teacherKeys: getReservationTeacherKeys(reservation, slot),
            lessonDate: normalizeId(
                reservation.date || (slot && slot.date),
            ),
          }),
        }));
        const preferredReason = [
          "no_remaining_count",
          "package_not_active",
          "package_type_mismatch",
          "teacher_mismatch",
          "package_date_out_of_range",
        ].find((reason) =>
          rejectedCandidates.some((entry) => entry.reason === reason),
        );
        const diagnosticCandidate = rejectedCandidates.find(
            (entry) => entry.reason === preferredReason,
        );
        if (diagnosticCandidate) {
          packageDoc = {
            id: diagnosticCandidate.candidate.id,
            data: diagnosticCandidate.candidate.data,
          };
          packageLookupReason =
            mapPrivateReservationOutcomePackageBlockedReason(
                preferredReason,
            );
        } else {
          packageLookupReason = "package_missing";
        }
      }
    } else {
      packageLookupReason = "package_missing";
    }
  }

  let creditTransactionId = "";
  let creditTransactionExists = false;
  if (packageDoc) {
    const packageRejectReason = getPrivatePackageRejectReason({
      pkg: packageDoc.data,
      academyId,
      studentId: normalizeId(reservation.studentId),
      teacherKey: getReservationTeacherKey(reservation, slot),
      teacherKeys: getReservationTeacherKeys(reservation, slot),
      lessonDate: normalizeId(
          reservation.date || (slot && slot.date),
      ),
    });
    const remainingCount = Number(packageDoc.data.remainingCount || 0);
    const usedCount = Number(packageDoc.data.usedCount || 0);
    if (!packageRejectReason &&
        Number.isFinite(remainingCount) &&
        remainingCount > 0 &&
        Number.isFinite(usedCount)) {
      creditTransactionId = buildDeductionKey({
        academyId,
        lessonId: reservationId,
        studentId: normalizeId(reservation.studentId),
        packageId: packageDoc.id,
      });
      const creditSnap = await db
          .collection("creditTransactions")
          .doc(creditTransactionId)
          .get();
      creditTransactionExists = creditSnap.exists;
    }
  }

  return {
    reservation,
    slot,
    packageDoc,
    packageId: packageDoc ? packageDoc.id : explicitPackageId,
    packageLookupReason,
    creditTransactionId,
    creditTransactionExists,
  };
}

function buildPrivateReservationOutcomePreviewTarget({
  reservationId,
  target,
}) {
  const packageData = target.packageDoc ? target.packageDoc.data : null;
  return {
    reservation: {
      id: reservationId,
      exists: Boolean(target.reservation),
      status: normalizeId(target.reservation && target.reservation.status),
      studentId: normalizeId(
          target.reservation && target.reservation.studentId,
      ),
      slotId: normalizeId(target.reservation && target.reservation.slotId),
    },
    slot: {
      id: normalizeId(target.reservation && target.reservation.slotId),
      exists: Boolean(target.slot),
      status: normalizeId(target.slot && target.slot.status),
    },
    package: {
      id: normalizeId(target.packageId),
      exists: Boolean(packageData),
      status: normalizeId(packageData && packageData.status),
    },
    creditTransaction: {
      id: target.creditTransactionId,
      exists: target.creditTransactionExists === true,
    },
  };
}

exports.previewPrivateLessonOutcomeAction = onCall(
    {region: REGION, cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login required.");
      }
      const data = request.data || {};
      const academyId = requireString(data, "academyId");
      const reservationId = requireString(data, "reservationId");
      const requestId = requireString(data, "requestId");
      const actionType = requireString(data, "actionType");
      validateAcademyId(academyId);
      if (!["complete", "no_show"].includes(actionType)) {
        throw new HttpsError("invalid-argument", "invalid_action");
      }
      if (data.dryRun !== true ||
          data.previewOnly !== true ||
          data.commit !== false) {
        throw new HttpsError(
            "invalid-argument",
            "Preview requires dryRun true, previewOnly true, and commit false.",
        );
      }

      const db = admin.firestore();
      const actor = await canMarkPrivateReservationOutcome(
          db,
          academyId,
          request.auth,
      );
      const target = await resolvePrivateReservationOutcomePreviewTarget({
        db,
        academyId,
        reservationId,
      });
      const plan = buildPrivateReservationOutcomePlan({
        academyId,
        reservationId,
        actionType,
        reservation: target.reservation,
        slot: target.slot,
        packageDoc: target.packageDoc,
        packageIdCandidate: target.packageId,
        packageLookupReason: target.packageLookupReason,
        creditTransactionExists: target.creditTransactionExists,
        creditTransactionId: target.creditTransactionId,
        actor,
        nowMillis: Date.now(),
      });
      return {
        ok: plan.ok,
        allowed: plan.ok,
        dryRun: true,
        previewOnly: true,
        commit: false,
        requestId,
        actionType,
        normalizedOutcome: plan.normalizedPlan.normalizedOutcome,
        actor: {
          uid: actor.actorUid,
          role: actor.actorRole,
          name: actor.actorName,
          isAdmin: actor.actorRole === "admin",
        },
        target: buildPrivateReservationOutcomePreviewTarget({
          reservationId,
          target,
        }),
        currentState: plan.currentState,
        proposedState: plan.proposedState,
        packageImpact: plan.packageImpact,
        creditTransactionPreview: plan.creditTransactionPreview,
        blockedReasons: plan.blockedReasons,
        warnings: plan.warnings,
        normalizedPlan: plan.normalizedPlan,
        nextStep: plan.ok ?
          "차감 및 수업 상태 변경 내용을 확인한 뒤 " +
            "최종 확인 단계로 진행할 수 있습니다." :
          "차단 사유를 확인한 뒤 수강권 또는 예약 상태를 먼저 확인하세요.",
      };
    },
);

async function applyPrivateReservationOutcomeWithDeductionInTransaction(
    transaction,
    {
      db,
      academyId,
      reservationId,
      outcome,
      actor,
      actorUid,
      now,
    },
) {
  const outcomeActor = actor || {};
  const uid = actorUid;
  const reservationRef = db
      .collection("privateLessonReservations")
      .doc(reservationId);
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

  const writeTime = now || admin.firestore.FieldValue.serverTimestamp();
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
    updatedAt: writeTime,
  });
  transaction.update(reservationRef, {
    status: outcome,
    completedAt: outcome === "completed" ? writeTime : null,
    noShowAt: outcome === "no_show" ? writeTime : null,
    deductionApplied: true,
    deductionAppliedAt: writeTime,
    deductionPackageId: packageRef.id,
    deductionCreditTransactionId: creditTransactionId,
    deductionTransactionId: creditTransactionId,
    deductionSource: "manual",
    deductionStatus: "deducted",
    deductionAttemptNumber,
    outcomeByUid: uid,
    outcomeActorRole: outcomeActor.actorRole,
    outcomeActorName: outcomeActor.actorName,
    updatedAt: writeTime,
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
    actorName: outcomeActor.actorName,
    reason: outcome,
    createdAt: writeTime,
  }, {merge: false});

  // no behavior change: preserve the legacy public response shape.
  return {
    ok: true,
    academyId,
    reservationId,
    outcome,
    packageId: packageRef.id,
    creditTransactionId,
  };
}

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
          await canMarkPrivateReservationOutcome(db, academyId, request.auth);

        return await db.runTransaction(async (transaction) => {
          return await applyPrivateReservationOutcomeWithDeductionInTransaction(
              transaction,
              {
                db,
                academyId,
                reservationId,
                outcome,
                actor: outcomeActor,
                actorUid: uid,
              },
          );
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
        const adminMembership = await requireAcademyAdmin(db, academyId, uid);
        const actor = buildAdminActorContext(request.auth, adminMembership);
        const packageRef = db.collection("studentPackages").doc(packageId);
        const packageSnap = await packageRef.get();
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

        const previousTotalCount = Number(pkg.totalCount || 0);
        const remainingCount = Math.max(0, totalCount - usedCount);
        const now = admin.firestore.FieldValue.serverTimestamp();
        await packageRef.update({
          totalCount,
          remainingCount,
          updatedAt: now,
        });
        if (totalCount !== previousTotalCount) {
          await db.collection("creditTransactions").add({
            academyId,
            studentId: normalizeId(pkg.studentId),
            studentName: normalizeId(pkg.studentName),
            teacher: normalizeId(pkg.teacher || pkg.teacherName),
            packageId,
            packageType: normalizeId(pkg.packageType),
            packageTitle: String(pkg.packageTitle || pkg.title || ""),
            groupClassName: normalizeId(pkg.groupClassName),
            sourceType: "studentPackage",
            sourceId: packageId,
            actionType: "package_adjusted",
            deltaCount: totalCount - previousTotalCount,
            memo: `수강권 총 횟수 조정 (${previousTotalCount} → ${totalCount})`,
            actorUid: actor.actorUid,
            actorRole: actor.actorRole,
            actorName: actor.actorName,
            reason: "admin_package_count_update",
            createdAt: now,
          });
        }

        return {ok: true, totalCount, remainingCount};
      } catch (error) {
        throw asHttpsError(error);
      }
    },
);

exports.commitPrivateLessonStatusAction = onCall(
    {region: REGION, cors: true},
    async (request) => {
      try {
        if (!request.auth) {
          throw new HttpsError("unauthenticated", "auth_required");
        }
        const data = request.data || {};
        if (data.actionType === "reverse_deduction") {
          throw new HttpsError(
              "invalid-argument",
              "reverse_deduction commit is not enabled in this release.",
          );
        }
        if (
          data.commit !== true ||
          data.dryRun !== false ||
          data.previewOnly !== false
        ) {
          throw new HttpsError(
              "invalid-argument",
              "commit: true, dryRun: false, previewOnly: false are required.",
          );
        }
        return await commitPrivateLessonStatusAction({
          db: admin.firestore(),
          auth: request.auth,
          data,
        });
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
          await canMarkPrivateReservationOutcome(db, academyId, request.auth);
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
            outcomeReversedByRole: outcomeActor.actorRole,
            outcomeReversedByName: outcomeActor.actorName,
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
            actorName: outcomeActor.actorName,
            reason,
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

      requireProductionBootstrapAdminAllowed(callerEmail);

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
      const data = request.data || {};
      const uid = requireString(data, "uid");
      const role = normalizeId(requireString(data, "role")).toLowerCase();
      const academyId = requireString(data, "academyId");
      const teacherName = optionalString(data, "teacherName");
      const emailInput = optionalString(data, "email");
      let email = "";
      if (emailInput) {
        try {
          email = normalizeEmail(emailInput);
        } catch (error) {
          throw asHttpsError(error);
        }
      }
      const isActive = data.isActive;

      validateAcademyId(academyId);
      if (role === "owner") {
        throw new HttpsError(
            "failed-precondition",
            "Owner role changes are not allowed.",
        );
      }
      if (!["admin", "teacher", "student"].includes(role)) {
        throw new HttpsError(
            "invalid-argument",
            "role must be admin, teacher, or student.",
        );
      }

      const auth = admin.auth();
      const db = admin.firestore();
      await requireAcademyOwner(db, academyId, callerUid);
      requireProductionSetUserRoleAllowed(request.auth);

      const targetMembershipSnap = await db
          .collection("academyMemberships")
          .doc(`${academyId}_${uid}`)
          .get();
      const targetMembership = targetMembershipSnap.exists ?
        targetMembershipSnap.data() || {} :
        null;
      const targetMembershipRole = String(
          (targetMembership && targetMembership.role) || "",
      ).trim().toLowerCase();
      if (targetMembershipRole === "owner") {
        throw new HttpsError(
            "failed-precondition",
            "Owner role changes are not allowed.",
        );
      }

      const targetUser = await auth.getUser(uid);
      const targetClaimsRole = String(
          (targetUser.customClaims && targetUser.customClaims.role) || "",
      ).trim().toLowerCase();
      if (targetClaimsRole === "owner") {
        throw new HttpsError(
            "failed-precondition",
            "Owner role changes are not allowed.",
        );
      }

      const userPayload = {
        role,
        academyId,
        teacherName: teacherName || null,
        isActive: isActive !== false,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (email) userPayload.email = email;

      await auth.setCustomUserClaims(uid, {role});

      await db.collection("users").doc(uid).set(userPayload, {merge: true});

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
