import crypto from "node:crypto";

export const WRITE_SURFACE_REGISTRY_VERSION =
  "academy_reset_write_surface.v2";
export const EXPECTED_WRITE_SURFACE_COUNT = 59;
export const EXPECTED_WRITE_SURFACE_IDENTITY_DIGEST =
  "45f0bdda40f26303f792f72cc214d5f1ffea0e7f21ddd887be3dd5f693475092";
export const EXPECTED_WRITE_SOURCE_COUNT = 21;
export const EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST =
  "92e19a4706b0855335578a6bb9e41306ef6784ab354111728601485f913417bf";

export const WRITE_SOURCE_SHA256_ALLOWLIST = Object.freeze([
  Object.freeze({
    sourceFile: "AuthContext.jsx",
    sha256: "dde9c60deac6918997f2fcc61e83c7759199a3439b482af5a3d83d23631857d9",
  }),
  Object.freeze({
    sourceFile: "Dashboard.jsx",
    sha256: "ff667ff46a653768f8699a630b61fa65565a19d6f04852069294e5d4bbd31b2c",
  }),
  Object.freeze({
    sourceFile: "functions/index.js",
    sha256: "0c3629a77f6d4af46068a8413daf3ee8aa0621a9d885c4d73a929f9e4d6e0c67",
  }),
  Object.freeze({
    sourceFile: "lessonApi.js",
    sha256: "d8cad46552155de9fc981a53ec11222542bfe1876216bfd505f4e246dc30e993",
  }),
  Object.freeze({
    sourceFile:
      "src/features/dashboard/hooks/useGroupAttendanceFlow.js",
    sha256: "a7dec4cc46af5a1bf0df4b492d32181cf2df36ea0a2b56d20fc77a53ff1a8a18",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useGroupLessonManagementFlow.js",
    sha256: "bc75505ce2d3df5d79e7d1ac955ad862f606b8cb7849ba2577159c590fdfed77",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useGroupManagementFlow.js",
    sha256: "60e987edc589a9c1dff4ca37bc440634a8cb0da9eff2a9c4010536a7c22e66c8",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useGroupScheduleRebuildFlow.js",
    sha256: "e43dcf23e50c61d76146dba938e0d58c2f63de7f2b27a45395f33da8e520d0bc",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useGroupStudentAddFlow.js",
    sha256: "2a4b9da41d74414c217bb0d2e0e53913d4ce832beb1fc7412d683f2c2511e937",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useGroupStudentManagementFlow.js",
    sha256: "edc2ea9391681b5fbe05da0cc2955bac8d7865c260339daf83cca7ce4f58849d",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/usePrivateLessonFlow.js",
    sha256: "273620cfa4cc319bdcd28009b0bb1a5ce51a5ed8f049abb77b21b3e380d3eb44",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useStudentManagementFlow.js",
    sha256: "6ae31f9f4ab23e15f2c16584b616d62910bf69d7fbfb3fbc5046e38f3463d89d",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useStudentPackageAdminFlow.js",
    sha256: "a0d4b46ee82c4b16fcfae3d30357d42ccf89d63ca5c036dd8d39397deb356f42",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/hooks/useStudentPackageFlow.js",
    sha256: "1559b20523add9d9f2d9e5a99efc69c0ef85ed8100dcd04bdc4f1c39700d3b85",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/sections/DailyMaterialsSection.jsx",
    sha256: "242c43d80eda6c1f0aad91fb1b8d352e5406679290e5c1165c404107dcaeaed4",
  }),
  Object.freeze({
    sourceFile: "src/features/dashboard/sections/LessonRequestsSection.jsx",
    sha256: "a9c2d1b38fbe748afdd35fa9a6cc13791f073710fd54a93103ad655631c63038",
  }),
  Object.freeze({
    sourceFile:
      "src/features/dashboard/sections/TeacherPrivateLessonRequestsSection.jsx",
    sha256: "ffbacef9e76c68ad5b97086472a5fd7983dce02c216d232c197c81cf61939bf4",
  }),
  Object.freeze({
    sourceFile: "src/features/group-booking/groupClassEnrollmentClient.js",
    sha256: "3e6144b5e6ce5b98e1a0e09b253a6dd65af1f16f1067b42a8553c48b81a4cdf9",
  }),
  Object.freeze({
    sourceFile: "src/features/group-booking/studentGroupAccessClient.js",
    sha256: "3143a9f47a64db86124d7dcfd46266b61ff8dfc1a5143da38fbbf258fdda3dc2",
  }),
  Object.freeze({
    sourceFile: "src/features/group-booking/studentGroupAccessSummaryClient.js",
    sha256: "3fd59cb42172e3b3f00f32ae1e99936cbca2f29c5205b5801269a365d84f0089",
  }),
  Object.freeze({
    sourceFile:
      "src/features/private-booking/studentPrivateAccessSummaryClient.js",
    sha256: "8ab114f5f2d1de0662b0f6e129ddf15b011e721ec990560505434038c6c6b105",
  }),
]);

export const RESET_COLLECTIONS = Object.freeze([
  "privateStudents",
  "studentPackages",
  "lessons",
  "privateLessonReservations",
  "privateLessonSlots",
  "privateLessonAvailabilityTemplates",
  "creditTransactions",
  "studentPrivateAccessSummary",
  "studentPrivateBookingStats",
  "fixedPrivateRenewalBatches",
  "fixedPrivateAssignmentBatches",
  "fixedPrivateRescheduleBatches",
  "fixedPrivateLessonOutcomeActionBatches",
  "privateLessonStatusActionBatches",
  "privateLessonOutcomeActionBatches",
  "groupClasses",
  "groupStudents",
  "groupLessons",
  "groupLessonReservations",
  "studentGroupAccess",
  "studentGroupAccessSummary",
  "lessonRequests",
  "dailyMaterials",
  "notificationEvents",
  "academies",
  "academyMemberships",
  "teachers",
  "accountProvisioningLogs",
  "users",
]);

export const WRITE_SURFACE_CATEGORIES = Object.freeze([
  "client_direct_writer",
  "callable_writer",
  "transaction_writer",
  "scheduled_writer",
  "auth_global_writer",
]);

export const WRITE_OPERATION_CLASSES = Object.freeze([
  "create",
  "update",
  "delete",
  "merge",
  "batch",
  "transaction",
  "auth_create",
  "auth_update",
  "auth_claims",
  "auth_action_link",
]);

const C = Object.freeze({
  client: "client_direct_writer",
  callable: "callable_writer",
  transaction: "transaction_writer",
  scheduled: "scheduled_writer",
  auth: "auth_global_writer",
});

function writer({
  category,
  sourceFile,
  entryHelper,
  collections,
  operationClass,
  scope,
  guardRequirement,
}) {
  return Object.freeze({
    category,
    sourceFile,
    entryHelper,
    collections: Object.freeze([...collections]),
    operationClass: Object.freeze([...operationClass]),
    scope,
    guardRequirement,
  });
}

const client = (sourceFile, entryHelper, collections, operations, guard) =>
  writer({
    category: C.client,
    sourceFile,
    entryHelper,
    collections,
    operationClass: operations,
    scope: "academy_scoped_firestore",
    guardRequirement: guard,
  });

const callable = (entryHelper, collections, operations, guard) =>
  writer({
    category: C.callable,
    sourceFile: "functions/index.js",
    entryHelper,
    collections,
    operationClass: operations,
    scope: "academy_scoped_admin_sdk",
    guardRequirement: guard,
  });

const transaction = (entryHelper, collections, operations, guard) =>
  writer({
    category: C.transaction,
    sourceFile: "functions/index.js",
    entryHelper,
    collections,
    operationClass: operations,
    scope: "academy_scoped_admin_sdk_transaction",
    guardRequirement: guard,
  });

export const ACADEMY_RESET_WRITE_SURFACE_REGISTRY = Object.freeze([
  client(
      "Dashboard.jsx",
      "Dashboard write handlers",
      [
        "teachers", "academyMemberships", "lessons", "studentPackages",
        "creditTransactions", "privateStudents", "groupStudents",
        "studentGroupAccess", "studentGroupAccessSummary", "groupLessons",
        "privateLessonAvailabilityTemplates", "privateLessonSlots",
        "privateLessonReservations",
      ],
      ["create", "update", "delete", "batch"],
      "authenticated academy UI role plus exact academy record guard",
  ),
  client(
      "AuthContext.jsx",
      "persistSelectedAcademy",
      ["users"],
      ["update"],
      "authenticated uid must equal the global user document id",
  ),
  client(
      "lessonApi.js",
      "createLesson",
      ["lessons"],
      ["create"],
      "requireCurrentAcademyId",
  ),
  client(
      "src/features/private-booking/studentPrivateAccessSummaryClient.js",
      "student private access summary helpers",
      ["studentPrivateAccessSummary"],
      ["merge", "batch"],
      "caller supplies exact academyId and studentId",
  ),
  client(
      "src/features/group-booking/studentGroupAccessSummaryClient.js",
      "student group access summary helpers",
      ["studentGroupAccessSummary", "studentPackages"],
      ["merge", "batch"],
      "caller supplies exact academyId and studentId",
  ),
  client(
      "src/features/group-booking/studentGroupAccessClient.js",
      "student group access helpers",
      ["studentGroupAccess"],
      ["merge", "update", "delete", "batch"],
      "caller supplies exact academyId, groupClassId, and studentId",
  ),
  client(
      "src/features/group-booking/groupClassEnrollmentClient.js",
      "enrollStudentInGroupClassFromPackage",
      ["groupStudents", "studentGroupAccess"],
      ["create", "merge", "batch"],
      "exact academy package and group-class ownership checks",
  ),
  client(
      "src/features/dashboard/sections/TeacherPrivateLessonRequestsSection.jsx",
      "request decision handlers",
      ["lessonRequests"],
      ["update", "batch"],
      "teacher identity and exact academy request guard",
  ),
  client(
      "src/features/dashboard/sections/LessonRequestsSection.jsx",
      "lesson request approval handlers",
      ["lessonRequests", "lessons"],
      ["create", "update", "batch"],
      "academy admin UI and exact academy request guard",
  ),
  client(
      "src/features/dashboard/sections/DailyMaterialsSection.jsx",
      "daily material submit handler",
      ["dailyMaterials"],
      ["create", "update"],
      "authenticated academy UI and exact academyId",
  ),
  client(
      "src/features/dashboard/hooks/useStudentPackageFlow.js",
      "student package create and schedule handlers",
      [
        "studentPackages", "creditTransactions", "lessons",
        "privateLessonSlots", "privateLessonReservations",
        "studentPrivateAccessSummary",
      ],
      ["create", "update", "batch"],
      "requireCurrentAcademyId and selected-student academy guard",
  ),
  client(
      "src/features/dashboard/hooks/useStudentPackageAdminFlow.js",
      "student package admin handlers",
      [
        "studentPackages", "creditTransactions", "groupStudents",
        "studentGroupAccess", "studentGroupAccessSummary",
        "studentPrivateAccessSummary",
      ],
      ["create", "update", "delete", "batch"],
      "exact package academy guard and admin permission",
  ),
  client(
      "src/features/dashboard/hooks/useStudentManagementFlow.js",
      "student create and edit handlers",
      ["privateStudents"],
      ["create", "update"],
      "requireCurrentAcademyId and assertSameAcademy",
  ),
  client(
      "src/features/dashboard/hooks/usePrivateLessonFlow.js",
      "private lesson edit handler",
      ["lessons"],
      ["update"],
      "assertSameAcademy",
  ),
  client(
      "src/features/dashboard/hooks/useGroupStudentManagementFlow.js",
      "group student management handler",
      ["groupStudents", "studentGroupAccess"],
      ["update", "delete", "batch"],
      "assertSameAcademy",
  ),
  client(
      "src/features/dashboard/hooks/useGroupStudentAddFlow.js",
      "group student add handler",
      ["groupStudents", "studentGroupAccess"],
      ["create", "merge", "batch"],
      "requireCurrentAcademyId and group/student academy guards",
  ),
  client(
      "src/features/dashboard/hooks/useGroupScheduleRebuildFlow.js",
      "group schedule rebuild handler",
      ["groupLessons"],
      ["create", "delete", "batch"],
      "requireCurrentAcademyId and assertSameAcademy",
  ),
  client(
      "src/features/dashboard/hooks/useGroupManagementFlow.js",
      "group class management handlers",
      ["groupClasses", "groupLessons"],
      ["create", "update", "batch"],
      "requireCurrentAcademyId and assertSameAcademy",
  ),
  client(
      "src/features/dashboard/hooks/useGroupLessonManagementFlow.js",
      "group lesson management handlers",
      ["groupLessons"],
      ["create", "update", "delete", "batch"],
      "requireCurrentAcademyId and assertSameAcademy",
  ),
  client(
      "src/features/dashboard/hooks/useGroupAttendanceFlow.js",
      "group attendance transaction handlers",
      ["groupLessons", "groupStudents", "groupLessonReservations"],
      ["update", "transaction"],
      "membership role and exact academy guards inside transaction",
  ),

  callable(
      "reserveGroupLessonSeat",
      [
        "groupLessons", "groupClasses", "groupStudents",
        "groupLessonReservations", "studentPackages",
      ],
      ["merge", "update", "transaction"],
      "active student membership and academy-scoped seat/package checks",
  ),
  callable(
      "cancelGroupLessonSeat",
      ["groupLessons", "groupLessonReservations", "studentPackages"],
      ["update", "transaction"],
      "active student membership and owned reservation guard",
  ),
  callable(
      "releaseGroupLessonFixedSeat",
      ["groupLessons", "groupStudents"],
      ["update", "transaction"],
      "active membership plus group reservation management permission",
  ),
  callable(
      "restoreGroupLessonFixedSeat",
      ["groupLessons", "groupStudents"],
      ["update", "transaction"],
      "active membership plus group reservation management permission",
  ),
  callable(
      "reservePrivateLessonSlot",
      [
        "privateLessonSlots", "privateLessonReservations", "lessons",
        "privateStudents", "studentPrivateAccessSummary", "studentPackages",
      ],
      ["merge", "update", "transaction"],
      "active student membership, pilot, package, and academy guards",
  ),
  callable(
      "cancelPrivateLessonReservation",
      [
        "privateLessonReservations", "privateLessonSlots",
        "studentPackages", "lessons",
      ],
      ["update", "transaction"],
      "active student membership and owned reservation allowance guard",
  ),
  callable(
      "cancelFixedPrivateLessonOccurrence",
      [
        "lessons", "privateLessonReservations", "privateLessonSlots",
        "studentPackages",
      ],
      ["merge", "update", "transaction"],
      "academy admin and fixed-occurrence precondition guards",
  ),
  callable(
      "adminClosePrivateLessonSlot",
      ["privateLessonSlots", "privateLessonReservations"],
      ["update", "transaction"],
      "academy admin and slot academy/provenance guards",
  ),
  callable(
      "adminReopenPrivateLessonSlot",
      ["privateLessonSlots"],
      ["update", "transaction"],
      "academy admin and slot academy/provenance guards",
  ),
  callable(
      "adminCancelPrivateLessonReservation",
      ["privateLessonSlots", "privateLessonReservations", "lessons"],
      ["update", "transaction"],
      "academy admin and reservation/slot academy guards",
  ),
  callable(
      "updateFixedPrivateLessonScheduleScope",
      [
        "fixedPrivateRescheduleBatches", "lessons", "privateLessonSlots",
        "privateLessonReservations", "privateLessonAvailabilityTemplates",
      ],
      ["merge", "update", "transaction"],
      "academy admin, commit flags, payload hash, and snapshot checks",
  ),
  callable(
      "createFixedPrivateLessonAssignment",
      [
        "fixedPrivateAssignmentBatches", "lessons", "privateLessonSlots",
        "privateLessonReservations", "privateStudents", "studentPackages",
        "privateLessonAvailabilityTemplates",
      ],
      ["create", "transaction"],
      "academy admin, exact commit flags, and deterministic id checks",
  ),
  callable(
      "createFixedPrivateLessonRenewal",
      [
        "fixedPrivateRenewalBatches", "lessons", "privateLessonSlots",
        "privateLessonReservations", "privateStudents", "studentPackages",
        "creditTransactions", "studentPrivateAccessSummary",
        "privateLessonAvailabilityTemplates",
      ],
      ["create", "merge", "update", "transaction"],
      "academy admin, exact commit flags, and deterministic id checks",
  ),
  callable(
      "updateStudentPrivateCancelAllowance",
      ["privateStudents", "studentPrivateBookingStats"],
      ["merge"],
      "academy admin and exact student academy guard",
  ),
  callable(
      "runAutoDeductPendingLessonsForTest",
      [
        "lessons", "privateLessonReservations", "groupLessons",
        "groupStudents", "groupLessonReservations", "studentPackages",
        "creditTransactions", "notificationEvents",
      ],
      ["merge", "update", "transaction"],
      "non-production E2E project guard",
  ),
  callable(
      "commitFixedPrivateLessonOutcomeAction",
      [
        "fixedPrivateLessonOutcomeActionBatches",
        "privateLessonReservations", "privateLessonSlots", "lessons",
        "studentPackages", "creditTransactions",
      ],
      ["merge", "update", "transaction"],
      "academy permission, request hash, and fixed provenance guards",
  ),
  callable(
      "markPrivateReservationOutcome",
      [
        "privateLessonReservations", "privateLessonSlots", "lessons",
        "studentPackages", "creditTransactions",
      ],
      ["merge", "update", "transaction"],
      "academy outcome permission and reservation provenance guards",
  ),
  callable(
      "updateTeacherStudentPackageCounts",
      ["studentPackages", "creditTransactions"],
      ["create", "update"],
      "teacher membership permission and package academy guard",
  ),
  callable(
      "commitPrivateLessonStatusAction",
      [
        "privateLessonStatusActionBatches", "privateLessonReservations",
        "privateLessonSlots", "lessons",
      ],
      ["merge", "update", "transaction"],
      "actor permission, request hash, and current-state checks",
  ),
  callable(
      "commitPrivateLessonOutcomeAction",
      [
        "privateLessonOutcomeActionBatches", "privateLessonReservations",
        "privateLessonSlots", "lessons", "studentPackages",
        "creditTransactions",
      ],
      ["merge", "update", "transaction"],
      "actor permission, request hash, and current-state checks",
  ),
  callable(
      "reversePrivateReservationOutcome",
      [
        "privateLessonReservations", "privateLessonSlots", "lessons",
        "studentPackages", "creditTransactions",
      ],
      ["merge", "update", "transaction"],
      "academy admin and exact prior deduction/reversal guards",
  ),

  transaction(
      "setMergeWithTimestamps",
      ["users", "academyMemberships"],
      ["merge"],
      "only called after exact global/account academy authorization",
  ),
  transaction(
      "createStudentAccessSummaryDocsIfMissing",
      ["studentGroupAccessSummary", "studentPrivateAccessSummary"],
      ["create"],
      "only called after academy admin and account-link collision checks",
  ),
  transaction(
      "runFixedPrivateRenewalWriteTransaction",
      [
        "fixedPrivateRenewalBatches", "lessons", "privateLessonSlots",
        "privateLessonReservations", "privateStudents", "studentPackages",
        "creditTransactions", "studentPrivateAccessSummary",
        "privateLessonAvailabilityTemplates",
      ],
      ["create", "merge", "update", "transaction"],
      "validated admin plan, deterministic ids, and conflict-free snapshot",
  ),
  transaction(
      "runFixedPrivateAssignmentWriteTransaction",
      [
        "fixedPrivateAssignmentBatches", "lessons", "privateLessonSlots",
        "privateLessonReservations", "privateStudents", "studentPackages",
        "privateLessonAvailabilityTemplates",
      ],
      ["create", "transaction"],
      "validated admin plan, deterministic ids, and conflict-free snapshot",
  ),
  transaction(
      "runFixedPrivateRescheduleWriteTransaction",
      [
        "fixedPrivateRescheduleBatches", "lessons", "privateLessonSlots",
        "privateLessonReservations", "privateLessonAvailabilityTemplates",
      ],
      ["merge", "update", "transaction"],
      "validated admin plan, payload hash, and linked-document snapshots",
  ),
  transaction(
      "commitPrivateLessonStatusAction",
      [
        "privateLessonStatusActionBatches", "privateLessonReservations",
        "privateLessonSlots", "lessons",
      ],
      ["merge", "update", "transaction"],
      "authorized actor and idempotent request checkpoint",
  ),
  transaction(
      "applyPrivateReservationOutcomeWithDeductionInTransaction",
      [
        "privateLessonReservations", "privateLessonSlots", "lessons",
        "studentPackages", "creditTransactions",
      ],
      ["merge", "update", "transaction"],
      "resolved academy target and deduction invariants",
  ),
  transaction(
      "autoDeductPrivateReservation",
      [
        "privateLessonReservations", "lessons", "studentPackages",
        "creditTransactions", "notificationEvents",
      ],
      ["merge", "update", "transaction"],
      "pending due occurrence and idempotent deduction key",
  ),
  transaction(
      "autoDeductGroupStudent",
      [
        "groupLessons", "groupStudents", "groupLessonReservations",
        "studentPackages", "creditTransactions", "notificationEvents",
      ],
      ["merge", "update", "transaction"],
      "pending due occurrence and idempotent deduction key",
  ),
  transaction(
      "createPrivateSlotNotification",
      ["notificationEvents"],
      ["create", "transaction"],
      "enclosing transaction has exact academy and reservation authorization",
  ),
  transaction(
      "commitPrivateLessonOutcomeAction",
      [
        "privateLessonOutcomeActionBatches", "privateLessonReservations",
        "privateLessonSlots", "lessons", "studentPackages",
        "creditTransactions",
      ],
      ["create", "update", "transaction"],
      "authorized actor, guarded academy, request hash, and state snapshot",
  ),
  transaction(
      "commitFixedPrivateLessonOutcomeAction",
      [
        "fixedPrivateLessonOutcomeActionBatches",
        "privateLessonReservations", "privateLessonSlots", "lessons",
        "studentPackages", "creditTransactions",
      ],
      ["create", "update", "transaction"],
      "authorized actor, guarded academy, request hash, and fixed provenance",
  ),
  transaction(
      "reversePrivateReservationOutcomeInTransaction",
      [
        "studentPackages", "privateLessonReservations", "creditTransactions",
      ],
      ["create", "update", "transaction"],
      "authorized actor, guarded academy, and exact reversal evidence",
  ),

  writer({
    category: C.scheduled,
    sourceFile: "functions/index.js",
    entryHelper: "autoDeductPendingLessons",
    collections: [
      "lessons", "privateLessonReservations", "groupLessons",
      "groupStudents", "groupLessonReservations", "studentPackages",
      "creditTransactions", "notificationEvents",
    ],
    operationClass: ["merge", "update", "transaction"],
    scope: "global_scheduler_academy_partitioned_admin_sdk",
    guardRequirement:
      "scheduler must be disabled and in-flight executions drained",
  }),

  writer({
    category: C.auth,
    sourceFile: "functions/index.js",
    entryHelper: "bootstrapAdmin",
    collections: ["users"],
    operationClass: ["merge", "auth_claims"],
    scope: "global_auth_and_firestore",
    guardRequirement: "authenticated exact owner email and production allow flag",
  }),
  writer({
    category: C.auth,
    sourceFile: "functions/index.js",
    entryHelper: "setUserRole",
    collections: ["users", "academyMemberships"],
    operationClass: ["merge", "auth_claims"],
    scope: "global_auth_and_academy_firestore",
    guardRequirement: "academy owner, non-owner target, and production allow flag",
  }),
  writer({
    category: C.auth,
    sourceFile: "functions/index.js",
    entryHelper: "linkStudentAccount",
    collections: [
      "users", "academyMemberships", "privateStudents",
      "studentGroupAccessSummary", "studentPrivateAccessSummary",
      "accountProvisioningLogs", "academies",
    ],
    operationClass: [
      "create", "merge", "auth_create", "auth_update", "auth_claims",
      "auth_action_link",
    ],
    scope: "global_auth_and_academy_firestore",
    guardRequirement: "academy admin and cross-account collision safety checks",
  }),
  writer({
    category: C.auth,
    sourceFile: "functions/index.js",
    entryHelper: "linkTeacherAccount",
    collections: [
      "users", "academyMemberships", "teachers",
      "accountProvisioningLogs",
    ],
    operationClass: [
      "create", "merge", "auth_create", "auth_update", "auth_claims",
      "auth_action_link",
    ],
    scope: "global_auth_and_academy_firestore",
    guardRequirement: "academy admin and cross-account collision safety checks",
  }),
]);

export function writeSurfaceIdentity(entry) {
  return `${entry.category}\u0000${entry.sourceFile}\u0000${entry.entryHelper}`;
}

export const EXPECTED_WRITE_SURFACE_IDENTITIES = Object.freeze(
    ACADEMY_RESET_WRITE_SURFACE_REGISTRY.map(writeSurfaceIdentity).sort(),
);

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function writeSurfaceIdentityDigest(registry) {
  return sha256(registry.map(writeSurfaceIdentity).sort().join("\n"));
}

export function writeSourceIdentityDigest(
    allowlist = WRITE_SOURCE_SHA256_ALLOWLIST,
) {
  return sha256(
      allowlist
          .map(({sourceFile, sha256: digest}) => `${sourceFile}\u0000${digest}`)
          .sort()
          .join("\n"),
  );
}

export function assertWriteSourceIdentityAllowlist(
    allowlist = WRITE_SOURCE_SHA256_ALLOWLIST,
) {
  if (!Array.isArray(allowlist) ||
      allowlist.length !== EXPECTED_WRITE_SOURCE_COUNT) {
    throw new Error("Writer source identity count invariant failed.");
  }
  const seen = new Set();
  for (const identity of allowlist) {
    if (!identity || Object.getPrototypeOf(identity) !== Object.prototype ||
        JSON.stringify(Object.keys(identity).sort()) !==
          JSON.stringify(["sha256", "sourceFile"]) ||
        typeof identity.sourceFile !== "string" ||
        pathIsUnsafe(identity.sourceFile) ||
        !/^[a-f0-9]{64}$/.test(identity.sha256) ||
        seen.has(identity.sourceFile)) {
      throw new Error("Writer source identity schema invariant failed.");
    }
    seen.add(identity.sourceFile);
  }
  const registrySources = new Set(
      ACADEMY_RESET_WRITE_SURFACE_REGISTRY.map(({sourceFile}) => sourceFile),
  );
  if (seen.size !== registrySources.size ||
      [...seen].some((sourceFile) => !registrySources.has(sourceFile)) ||
      writeSourceIdentityDigest(allowlist) !==
        EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST) {
    throw new Error("Writer source exact identity invariant failed.");
  }
  return true;
}

const EXACT_ENTRY_KEYS = Object.freeze([
  "category",
  "sourceFile",
  "entryHelper",
  "collections",
  "operationClass",
  "scope",
  "guardRequirement",
].sort());

export function assertWriteSurfaceRegistry(
    registry = ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
    expectedIdentities = EXPECTED_WRITE_SURFACE_IDENTITIES,
) {
  if (!Array.isArray(registry) || !Array.isArray(expectedIdentities)) {
    throw new Error("Write surface registry and expected identities are required.");
  }
  if (RESET_COLLECTIONS.length !== 29 ||
      new Set(RESET_COLLECTIONS).size !== RESET_COLLECTIONS.length) {
    throw new Error("Reset collection allowlist must contain exactly 29 names.");
  }
  const knownCollections = new Set(RESET_COLLECTIONS);
  const knownCategories = new Set(WRITE_SURFACE_CATEGORIES);
  const knownOperations = new Set(WRITE_OPERATION_CLASSES);
  const seen = new Set();
  for (const entry of registry) {
    if (!entry || typeof entry !== "object" ||
        JSON.stringify(Object.keys(entry).sort()) !==
          JSON.stringify(EXACT_ENTRY_KEYS)) {
      throw new Error("Writer entry has unknown or missing fields.");
    }
    const identity = writeSurfaceIdentity(entry);
    if (seen.has(identity)) {
      throw new Error(`Duplicate writer entry: ${identity}`);
    }
    seen.add(identity);
    if (!knownCategories.has(entry.category) ||
        typeof entry.sourceFile !== "string" || !entry.sourceFile ||
        pathIsUnsafe(entry.sourceFile) ||
        typeof entry.entryHelper !== "string" || !entry.entryHelper ||
        typeof entry.scope !== "string" || !entry.scope ||
        typeof entry.guardRequirement !== "string" ||
        !entry.guardRequirement) {
      throw new Error(`Invalid writer metadata: ${identity}`);
    }
    if (!Array.isArray(entry.collections) || entry.collections.length === 0 ||
        new Set(entry.collections).size !== entry.collections.length ||
        entry.collections.some((name) => !knownCollections.has(name))) {
      throw new Error(`Unknown or duplicate collection in writer: ${identity}`);
    }
    if (!Array.isArray(entry.operationClass) ||
        entry.operationClass.length === 0 ||
        new Set(entry.operationClass).size !== entry.operationClass.length ||
        entry.operationClass.some((name) => !knownOperations.has(name))) {
      throw new Error(`Unknown or duplicate operation in writer: ${identity}`);
    }
  }
  const actual = [...seen].sort();
  const expected = [...expectedIdentities].sort();
  if (registry.length !== EXPECTED_WRITE_SURFACE_COUNT ||
      writeSurfaceIdentityDigest(registry) !==
        EXPECTED_WRITE_SURFACE_IDENTITY_DIGEST ||
      new Set(expected).size !== expected.length ||
      JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Writer exact coverage invariant failed.");
  }
  return Object.freeze({
    writerCount: registry.length,
    collectionCount: RESET_COLLECTIONS.length,
    categoryCounts: Object.freeze(Object.fromEntries(
        WRITE_SURFACE_CATEGORIES.map((category) => [
          category,
          registry.filter((entry) => entry.category === category).length,
        ]),
    )),
  });
}

function pathIsUnsafe(value) {
  return value.startsWith("/") || value.split("/").includes("..") ||
    value.includes("\\") || value.includes("\u0000");
}

export const WRITE_SURFACE_COUNTS = assertWriteSurfaceRegistry();
assertWriteSourceIdentityAllowlist();
