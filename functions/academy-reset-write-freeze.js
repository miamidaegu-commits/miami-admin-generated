/* eslint-disable require-jsdoc */
"use strict";

const TARGET_ACADEMY_ID = "academy_daegumiami";
const TARGET_PROJECT_ID = "daegu-miami-production";
const RESET_WRITE_FREEZE_MODE = "academy_test_data_reset";
const RESET_WRITE_FREEZE_SCHEMA_VERSION = "academy_reset_write_freeze.v1";
const WRITE_SURFACE_INVENTORY_VERSION =
  "academy_reset_write_surface_inventory.v2";
const RESET_WRITE_FREEZE_KEYS = Object.freeze([
  "active",
  "schemaVersion",
  "mode",
  "academyId",
  "projectId",
]);
const RESET_WRITE_FREEZE_KEY_SET = new Set(RESET_WRITE_FREEZE_KEYS);

function frozenList(values) {
  return Object.freeze([...values]);
}

const WRITE_SURFACE_INVENTORY = Object.freeze({
  version: WRITE_SURFACE_INVENTORY_VERSION,
  writeCallables: frozenList([
    "reserveGroupLessonSeat",
    "cancelGroupLessonSeat",
    "releaseGroupLessonFixedSeat",
    "restoreGroupLessonFixedSeat",
    "reservePrivateLessonSlot",
    "cancelPrivateLessonReservation",
    "cancelFixedPrivateLessonOccurrence",
    "adminClosePrivateLessonSlot",
    "adminReopenPrivateLessonSlot",
    "adminCancelPrivateLessonReservation",
    "updateFixedPrivateLessonScheduleScope",
    "createFixedPrivateLessonAssignment",
    "createFixedPrivateLessonRenewal",
    "updateStudentPrivateCancelAllowance",
    "runAutoDeductPendingLessonsForTest",
    "commitFixedPrivateLessonOutcomeAction",
    "markPrivateReservationOutcome",
    "updateTeacherStudentPackageCounts",
    "commitPrivateLessonStatusAction",
    "commitPrivateLessonOutcomeAction",
    "reversePrivateReservationOutcome",
    "bootstrapAdmin",
    "setUserRole",
    "linkStudentAccount",
    "linkTeacherAccount",
  ]),
  transactionCallables: frozenList([
    "reserveGroupLessonSeat",
    "cancelGroupLessonSeat",
    "releaseGroupLessonFixedSeat",
    "restoreGroupLessonFixedSeat",
    "reservePrivateLessonSlot",
    "cancelPrivateLessonReservation",
    "cancelFixedPrivateLessonOccurrence",
    "adminClosePrivateLessonSlot",
    "adminReopenPrivateLessonSlot",
    "adminCancelPrivateLessonReservation",
    "updateFixedPrivateLessonScheduleScope",
    "createFixedPrivateLessonAssignment",
    "createFixedPrivateLessonRenewal",
    "runAutoDeductPendingLessonsForTest",
    "commitFixedPrivateLessonOutcomeAction",
    "markPrivateReservationOutcome",
    "commitPrivateLessonStatusAction",
    "commitPrivateLessonOutcomeAction",
    "reversePrivateReservationOutcome",
  ]),
  scheduledWriters: frozenList([
    "autoDeductPendingLessons",
  ]),
  writeHelpers: frozenList([
    "setMergeWithTimestamps",
    "createStudentAccessSummaryDocsIfMissing",
    "runFixedPrivateRenewalWriteTransaction",
    "runFixedPrivateAssignmentWriteTransaction",
    "runFixedPrivateRescheduleWriteTransaction",
    "commitPrivateLessonStatusAction",
    "autoDeductPrivateReservation",
    "autoDeductGroupStudent",
    "createPrivateSlotNotification",
    "commitPrivateLessonOutcomeAction",
    "commitFixedPrivateLessonOutcomeAction",
    "applyPrivateReservationOutcomeWithDeductionInTransaction",
    "reversePrivateReservationOutcomeInTransaction",
  ]),
  provisioningAuthCallables: frozenList([
    "bootstrapAdmin",
    "setUserRole",
    "linkStudentAccount",
    "linkTeacherAccount",
  ]),
  authOperations: frozenList([
    "setCustomUserClaims",
    "createUser",
    "updateUser",
    "generatePasswordResetLink",
  ]),
});

const REGISTERED_WRITE_SURFACES = new Set([
  ...WRITE_SURFACE_INVENTORY.writeCallables,
  ...WRITE_SURFACE_INVENTORY.scheduledWriters,
  ...WRITE_SURFACE_INVENTORY.writeHelpers,
]);

function freezeError(message, details = {}) {
  const error = new Error(message);
  error.code = "failed-precondition";
  error.details = Object.freeze({...details});
  return error;
}

function assertRegisteredWriteSurface(writeSurfaceId) {
  if (
    typeof writeSurfaceId !== "string" ||
    !REGISTERED_WRITE_SURFACES.has(writeSurfaceId)
  ) {
    throw freezeError("Unknown backend write surface is blocked.", {
      reason: "unknown_write_surface",
      writeSurfaceId:
        typeof writeSurfaceId === "string" ? writeSurfaceId : null,
      inventoryVersion: WRITE_SURFACE_INVENTORY_VERSION,
    });
  }
}

function validateResetWriteFreezeMapShape(sentinel) {
  if (
    typeof sentinel !== "object" ||
    sentinel === null ||
    Array.isArray(sentinel)
  ) {
    return "sentinel_malformed";
  }

  let prototype;
  let ownKeys;
  let descriptors;
  try {
    prototype = Object.getPrototypeOf(sentinel);
    ownKeys = Reflect.ownKeys(sentinel);
    descriptors = Object.getOwnPropertyDescriptors(sentinel);
  } catch (error) {
    return "sentinel_malformed";
  }
  if (prototype !== Object.prototype && prototype !== null) {
    return "sentinel_prototype_invalid";
  }
  if (
    ownKeys.length !== RESET_WRITE_FREEZE_KEYS.length ||
    ownKeys.some((key) =>
      typeof key !== "string" || !RESET_WRITE_FREEZE_KEY_SET.has(key),
    )
  ) {
    return "sentinel_keys_invalid";
  }
  for (const key of RESET_WRITE_FREEZE_KEYS) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      descriptor.enumerable !== true ||
      !Object.prototype.hasOwnProperty.call(descriptor, "value")
    ) {
      return "sentinel_keys_invalid";
    }
  }
  return "";
}

function classifyResetWriteFreeze({
  academyId,
  projectId,
  academyExists,
  sentinel,
}) {
  if (projectId !== TARGET_PROJECT_ID || academyId !== TARGET_ACADEMY_ID) {
    return Object.freeze({blocked: false, reason: "outside_exact_target"});
  }
  if (academyExists !== true) {
    return Object.freeze({blocked: true, reason: "academy_document_missing"});
  }
  if (sentinel === undefined) {
    return Object.freeze({blocked: false, reason: "sentinel_absent"});
  }
  const shapeError = validateResetWriteFreezeMapShape(sentinel);
  if (shapeError) {
    return Object.freeze({blocked: true, reason: shapeError});
  }
  if (sentinel.active !== true && sentinel.active !== false) {
    return Object.freeze({blocked: true, reason: "sentinel_active_invalid"});
  }
  if (sentinel.schemaVersion !== RESET_WRITE_FREEZE_SCHEMA_VERSION) {
    return Object.freeze({blocked: true, reason: "sentinel_schema_invalid"});
  }
  if (sentinel.mode !== RESET_WRITE_FREEZE_MODE) {
    return Object.freeze({blocked: true, reason: "sentinel_mode_invalid"});
  }
  if (sentinel.academyId !== TARGET_ACADEMY_ID) {
    return Object.freeze({blocked: true, reason: "sentinel_academy_invalid"});
  }
  if (sentinel.projectId !== TARGET_PROJECT_ID) {
    return Object.freeze({blocked: true, reason: "sentinel_project_invalid"});
  }
  if (sentinel.active === false) {
    return Object.freeze({blocked: false, reason: "sentinel_inactive"});
  }
  return Object.freeze({blocked: true, reason: "reset_write_freeze_active"});
}

async function assertAcademyResetWriteAllowed({
  db,
  transaction = null,
  academyId,
  projectId,
  writeSurfaceId,
}) {
  assertRegisteredWriteSurface(writeSurfaceId);
  if (projectId !== TARGET_PROJECT_ID || academyId !== TARGET_ACADEMY_ID) {
    return Object.freeze({allowed: true, reason: "outside_exact_target"});
  }

  const academyRef = db.collection("academies").doc(TARGET_ACADEMY_ID);
  let academySnap;
  try {
    academySnap = transaction ?
      await transaction.get(academyRef) :
      await academyRef.get();
  } catch (cause) {
    throw freezeError("Unable to verify academy reset write freeze.", {
      reason: "sentinel_read_failed",
      writeSurfaceId,
      inventoryVersion: WRITE_SURFACE_INVENTORY_VERSION,
    });
  }
  const academyData = academySnap.exists ? academySnap.data() || {} : {};
  const classification = classifyResetWriteFreeze({
    academyId,
    projectId,
    academyExists: academySnap.exists === true,
    sentinel: academyData.resetWriteFreeze,
  });
  if (classification.blocked) {
    throw freezeError("Academy writes are frozen for test-data reset.", {
      reason: classification.reason,
      academyId: TARGET_ACADEMY_ID,
      projectId: TARGET_PROJECT_ID,
      writeSurfaceId,
      inventoryVersion: WRITE_SURFACE_INVENTORY_VERSION,
    });
  }
  return Object.freeze({allowed: true, reason: classification.reason});
}

async function assertGlobalResetWriteAllowed({
  db,
  projectId,
  writeSurfaceId,
}) {
  return assertAcademyResetWriteAllowed({
    db,
    academyId: TARGET_ACADEMY_ID,
    projectId,
    writeSurfaceId,
  });
}

function createGlobalFreezeGuardedHandler({
  getDb,
  guardGlobalWrite,
  isEnabled,
  onDisabled,
  runner,
  writeSurfaceId,
}) {
  return async (...args) => {
    assertRegisteredWriteSurface(writeSurfaceId);
    await guardGlobalWrite({
      db: getDb(),
      writeSurfaceId,
    });
    if (!isEnabled()) {
      return onDisabled(...args);
    }
    return runner(...args);
  };
}

module.exports = {
  RESET_WRITE_FREEZE_MODE,
  RESET_WRITE_FREEZE_KEYS,
  RESET_WRITE_FREEZE_SCHEMA_VERSION,
  TARGET_ACADEMY_ID,
  TARGET_PROJECT_ID,
  WRITE_SURFACE_INVENTORY,
  WRITE_SURFACE_INVENTORY_VERSION,
  assertAcademyResetWriteAllowed,
  assertGlobalResetWriteAllowed,
  assertRegisteredWriteSurface,
  classifyResetWriteFreeze,
  createGlobalFreezeGuardedHandler,
};
