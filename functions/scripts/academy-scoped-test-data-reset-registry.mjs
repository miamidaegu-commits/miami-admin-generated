export const RESET_PLAN_VERSION = 1;
export const EXPECTED_PRODUCTION_PROJECT = "daegu-miami-production";
export const EXPECTED_TARGET_ACADEMY = "academy_daegumiami";

export const RESET_CLASSIFICATIONS = Object.freeze({
  RESET_ALL_ACADEMY_SCOPED: "RESET_ALL_ACADEMY_SCOPED",
  RESET_WITH_PRESERVE_FILTER: "RESET_WITH_PRESERVE_FILTER",
  ARCHIVE_OR_RETAIN: "ARCHIVE_OR_RETAIN",
  GLOBAL_NEVER_RESET: "GLOBAL_NEVER_RESET",
});

export const ACADEMY_SCOPE_STRATEGIES = Object.freeze({
  ACADEMY_ID_FIELD: "academy_id_field",
  ACADEMY_DOCUMENT_ID: "academy_document_id",
  MEMBERSHIP_ACADEMY_ID_FIELD: "membership_academy_id_field",
  GLOBAL_DOCUMENT: "global_document",
});

const C = RESET_CLASSIFICATIONS;
const S = ACADEMY_SCOPE_STRATEGIES;

function reference(family, targetCollection, fields, options = {}) {
  const targetCollections = Array.isArray(targetCollection) ?
    targetCollection :
    [targetCollection];
  return Object.freeze({
    family,
    targetCollections: Object.freeze([...targetCollections]),
    fields: Object.freeze([...fields]),
    aliasPolicy: options.aliasPolicy || "collect",
    valueType: options.valueType || "string_or_array",
  });
}

export const CREDIT_SOURCE_REFERENCE_MAPPINGS = Object.freeze({
  "privateReservation": Object.freeze({
    targetCollection: "privateLessonReservations",
    explicitIdFields: Object.freeze([
      "reservationId",
      "privateLessonReservationId",
      "linkedReservationId",
    ]),
  }),
  "fixedPrivateReservation": Object.freeze({
    targetCollection: "privateLessonReservations",
    explicitIdFields: Object.freeze([
      "reservationId",
      "privateLessonReservationId",
      "linkedReservationId",
    ]),
  }),
  "groupLesson": Object.freeze({
    targetCollection: "groupLessons",
    explicitIdFields: Object.freeze(["lessonId", "groupLessonId"]),
  }),
  "studentPackage": Object.freeze({
    targetCollection: "studentPackages",
    explicitIdFields: Object.freeze(["packageId"]),
  }),
  "fixed-private-renewal": Object.freeze({
    targetCollection: "fixedPrivateRenewalBatches",
    explicitIdFields: Object.freeze(["renewalBatchId"]),
  }),
});

function entry({
  collectionName,
  classification,
  academyScopeStrategy = S.ACADEMY_ID_FIELD,
  preserveReason = "",
  referenceExtractors = [],
  expectedDeletionOrderGroup = 0,
  containsPotentialPII = false,
  plannerDisposition,
}) {
  return Object.freeze({
    collectionName,
    classification,
    academyScopeStrategy,
    preserveReason,
    referenceExtractors: Object.freeze([...referenceExtractors]),
    expectedDeletionOrderGroup,
    containsPotentialPII,
    plannerDisposition,
  });
}

export const ACADEMY_SCOPED_RESET_REGISTRY = Object.freeze([
  entry({
    collectionName: "privateStudents",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("teacher_identity", "teachers", ["teacherId", "teacherID"]),
      reference("linked_user", "users", ["uid", "userId", "linkedUid"]),
    ],
    expectedDeletionOrderGroup: 6,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "studentPackages",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId", "studentID"]),
      reference("group_class", "groupClasses", [
        "groupClassId",
        "groupClassID",
        "classId",
        "classID",
      ], {aliasPolicy: "same_single_value"}),
      reference("group_class", "groupClasses", [
        "groupClassIds",
      ], {valueType: "array"}),
      reference("teacher_identity", "teachers", ["teacherId", "teacherID"]),
    ],
    expectedDeletionOrderGroup: 5,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "lessons",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId", "studentID"]),
      reference("package", "studentPackages", [
        "packageId",
        "fixedPrivatePackageId",
        "deductionPackageId",
      ]),
      reference("reservation", "privateLessonReservations", [
        "reservationId",
        "privateLessonReservationId",
        "linkedReservationId",
      ]),
      reference("slot", "privateLessonSlots", [
        "slotId",
        "privateLessonSlotId",
        "linkedSlotId",
      ]),
      reference("template", "privateLessonAvailabilityTemplates", [
        "privateLessonAvailabilityTemplateId",
      ]),
      reference("lesson_request", "lessonRequests", ["lessonRequestId"]),
      reference("assignment_batch", [
        "fixedPrivateAssignmentBatches",
        "fixedPrivateRenewalBatches",
      ], ["fixedPrivateAssignmentBatchId"]),
      reference("renewal_batch", "fixedPrivateRenewalBatches", [
        "fixedPrivateRenewalBatchId",
      ]),
      reference("reschedule_batch", "fixedPrivateRescheduleBatches", [
        "fixedPrivateRescheduleBatchId",
        "rescheduleBatchId",
      ]),
    ],
    expectedDeletionOrderGroup: 3,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "privateLessonReservations",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("lesson", "lessons", [
        "lessonId",
        "privateLessonId",
        "fixedLessonId",
        "linkedLessonId",
      ]),
      reference("slot", "privateLessonSlots", [
        "slotId",
        "privateLessonSlotId",
        "linkedSlotId",
      ]),
      reference("student", "privateStudents", ["studentId", "studentID"]),
      reference("package", "studentPackages", [
        "packageId",
        "deductionPackageId",
        "linkedPackageId",
        "fixedPrivatePackageId",
      ]),
      reference("template", "privateLessonAvailabilityTemplates", [
        "privateLessonAvailabilityTemplateId",
      ]),
      reference("assignment_batch", [
        "fixedPrivateAssignmentBatches",
        "fixedPrivateRenewalBatches",
      ], ["fixedPrivateAssignmentBatchId"]),
      reference("reschedule_batch", "fixedPrivateRescheduleBatches", [
        "fixedPrivateRescheduleBatchId",
      ]),
    ],
    expectedDeletionOrderGroup: 2,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "privateLessonSlots",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("lesson", "lessons", [
        "lessonId",
        "privateLessonId",
        "fixedLessonId",
        "linkedLessonId",
      ]),
      reference("reservation", "privateLessonReservations", [
        "reservationId",
        "privateLessonReservationId",
        "linkedReservationId",
      ]),
      reference("student", "privateStudents", [
        "studentId",
        "studentID",
        "reservedStudentId",
        "fixedStudentId",
        "eligibleStudentIds",
      ]),
      reference("package", "studentPackages", [
        "packageId",
        "deductionPackageId",
        "fixedPrivatePackageId",
      ]),
      reference("template", "privateLessonAvailabilityTemplates", [
        "privateLessonAvailabilityTemplateId",
      ]),
      reference("assignment_batch", [
        "fixedPrivateAssignmentBatches",
        "fixedPrivateRenewalBatches",
      ], ["fixedPrivateAssignmentBatchId"]),
      reference("reschedule_batch", "fixedPrivateRescheduleBatches", [
        "fixedPrivateRescheduleBatchId",
      ]),
    ],
    expectedDeletionOrderGroup: 3,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "privateLessonAvailabilityTemplates",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("teacher_identity", "teachers", ["teacherId", "teacherID"]),
      reference("reschedule_batch", "fixedPrivateRescheduleBatches", [
        "fixedPrivateRescheduleBatchId",
      ]),
    ],
    expectedDeletionOrderGroup: 6,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "creditTransactions",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("package", "studentPackages", [
        "packageId",
        "linkedPackageId",
        "deductionPackageId",
      ]),
      reference("slot", "privateLessonSlots", [
        "slotId",
        "privateLessonSlotId",
        "linkedSlotId",
      ]),
      reference("credit_reversal", "creditTransactions", [
        "reversalOfTransactionId",
        "reversedByTransactionId",
        "originalTransactionId",
        "linkedTransactionId",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "studentPrivateAccessSummary",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
      reference("package", "studentPackages", ["activePackageIds"]),
    ],
    expectedDeletionOrderGroup: 4,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "studentPrivateBookingStats",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
    ],
    expectedDeletionOrderGroup: 4,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "fixedPrivateRenewalBatches",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
      reference("package", "studentPackages", ["packageId"]),
      reference("template", "privateLessonAvailabilityTemplates", ["templateId"]),
      reference("lesson", "lessons", ["created.lessons", "lessons"]),
      reference("slot", "privateLessonSlots", [
        "created.privateLessonSlots",
        "privateLessonSlots",
      ]),
      reference("reservation", "privateLessonReservations", [
        "created.privateLessonReservations",
        "privateLessonReservations",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "fixedPrivateAssignmentBatches",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
      reference("package", "studentPackages", ["packageId"]),
      reference("template", "privateLessonAvailabilityTemplates", ["templateId"]),
      reference("lesson", "lessons", ["created.lessons", "lessons"]),
      reference("slot", "privateLessonSlots", [
        "created.privateLessonSlots",
        "privateLessonSlots",
      ]),
      reference("reservation", "privateLessonReservations", [
        "created.privateLessonReservations",
        "privateLessonReservations",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "fixedPrivateRescheduleBatches",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("lesson", "lessons", [
        "selectedLessonId",
      ]),
      reference("lesson", "lessons", [
        "updated.lessons",
        "includedLessonIds",
        "updatedLessonIds",
      ], {valueType: "array"}),
      reference("slot", "privateLessonSlots", [
        "updated.privateLessonSlots",
        "updatedSlotIds",
      ], {valueType: "array"}),
      reference("reservation", "privateLessonReservations", [
        "updated.privateLessonReservations",
        "updatedReservationIds",
      ], {valueType: "array"}),
      reference("template", "privateLessonAvailabilityTemplates", [
        "teacherTemplateId",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "fixedPrivateLessonOutcomeActionBatches",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("lesson", "lessons", ["lessonId"]),
      reference("reservation", "privateLessonReservations", ["reservationId"]),
      reference("slot", "privateLessonSlots", ["slotId"]),
      reference("package", "studentPackages", ["packageId"]),
      reference("credit", "creditTransactions", [
        "creditTransactionId",
        "deductionTransactionId",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "privateLessonStatusActionBatches",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("lesson", "lessons", ["lessonId"]),
      reference("reservation", "privateLessonReservations", ["reservationId"]),
      reference("slot", "privateLessonSlots", ["slotId"]),
      reference("package", "studentPackages", ["packageId"]),
      reference("credit", "creditTransactions", [
        "creditTransactionId",
        "deductionTransactionId",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "privateLessonOutcomeActionBatches",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("lesson", "lessons", ["lessonId"]),
      reference("reservation", "privateLessonReservations", ["reservationId"]),
      reference("slot", "privateLessonSlots", ["slotId"]),
      reference("package", "studentPackages", ["packageId"]),
      reference("credit", "creditTransactions", [
        "creditTransactionId",
        "deductionTransactionId",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "groupClasses",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("teacher_identity", "teachers", ["teacherId", "teacherID"]),
    ],
    expectedDeletionOrderGroup: 6,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "groupStudents",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("group_class", "groupClasses", [
        "groupClassId",
        "groupClassID",
        "classID",
      ], {aliasPolicy: "same_single_value"}),
      reference("student", "privateStudents", ["studentId"]),
      reference("package", "studentPackages", ["packageId"]),
    ],
    expectedDeletionOrderGroup: 4,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "groupLessons",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("group_class", "groupClasses", [
        "groupClassId",
        "groupClassID",
        "classId",
        "classID",
      ], {aliasPolicy: "strict_scalar_alias"}),
    ],
    expectedDeletionOrderGroup: 3,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "groupLessonReservations",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("group_lesson", "groupLessons", ["lessonId"]),
      reference("group_class", "groupClasses", ["groupClassId"]),
      reference("group_student", "groupStudents", ["groupStudentId"]),
      reference("student", "privateStudents", ["studentId"]),
      reference("package", "studentPackages", ["packageId"]),
    ],
    expectedDeletionOrderGroup: 2,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "studentGroupAccess",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("group_class", "groupClasses", ["groupClassId"]),
      reference("student", "privateStudents", ["studentId"]),
    ],
    expectedDeletionOrderGroup: 4,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "studentGroupAccessSummary",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("group_class", "groupClasses", ["groupClassIds"]),
      reference("student", "privateStudents", ["studentId"]),
    ],
    expectedDeletionOrderGroup: 4,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "lessonRequests",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
      reference("lesson", "lessons", ["lessonId", "lessonID"]),
      reference("package", "studentPackages", ["fixedPrivatePackageId"]),
    ],
    expectedDeletionOrderGroup: 6,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "dailyMaterials",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    expectedDeletionOrderGroup: 6,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "notificationEvents",
    classification: C.RESET_ALL_ACADEMY_SCOPED,
    referenceExtractors: [
      reference("lesson", "lessons", ["lessonId", "linkedLessonId"]),
      reference("reservation", "privateLessonReservations", [
        "reservationId",
        "privateLessonReservationId",
      ]),
      reference("slot", "privateLessonSlots", [
        "slotId",
        "privateLessonSlotId",
      ]),
      reference("group_lesson", "groupLessons", ["groupLessonId"]),
      reference("group_reservation", "groupLessonReservations", [
        "groupLessonReservationId",
      ]),
    ],
    expectedDeletionOrderGroup: 1,
    containsPotentialPII: true,
    plannerDisposition: "reset_candidate",
  }),
  entry({
    collectionName: "academies",
    classification: C.RESET_WITH_PRESERVE_FILTER,
    academyScopeStrategy: S.ACADEMY_DOCUMENT_ID,
    preserveReason: "Preserve the target academy shell and core settings.",
    plannerDisposition: "preserve",
  }),
  entry({
    collectionName: "academyMemberships",
    classification: C.RESET_WITH_PRESERVE_FILTER,
    academyScopeStrategy: S.MEMBERSHIP_ACADEMY_ID_FIELD,
    preserveReason:
      "Preserve all memberships; never infer test-only identities for deletion.",
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
      reference("teacher_identity", "teachers", ["teacherId", "teacherID"]),
      reference("linked_user", "users", ["uid"]),
    ],
    containsPotentialPII: true,
    plannerDisposition: "preserve",
  }),
  entry({
    collectionName: "teachers",
    classification: C.RESET_WITH_PRESERVE_FILTER,
    preserveReason:
      "Preserve teacher profile and key mappings pending explicit review.",
    referenceExtractors: [
      reference("linked_user", "users", ["uid", "userId", "linkedUid"]),
    ],
    containsPotentialPII: true,
    plannerDisposition: "preserve",
  }),
  entry({
    collectionName: "accountProvisioningLogs",
    classification: C.ARCHIVE_OR_RETAIN,
    preserveReason:
      "Retain account provisioning audit records until retention review.",
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
      reference("teacher_identity", "teachers", ["teacherId"]),
      reference("membership", "academyMemberships", ["membershipId"]),
      reference("linked_user", "users", ["uid"]),
    ],
    containsPotentialPII: true,
    plannerDisposition: "retain",
  }),
  entry({
    collectionName: "users",
    classification: C.GLOBAL_NEVER_RESET,
    academyScopeStrategy: S.GLOBAL_DOCUMENT,
    preserveReason: "Global Auth-linked profiles are outside scoped reset.",
    referenceExtractors: [
      reference("student", "privateStudents", ["studentId"]),
      reference("teacher_identity", "teachers", ["teacherId", "teacherID"]),
    ],
    containsPotentialPII: true,
    plannerDisposition: "global_preserve",
  }),
]);

export function assertResetRegistry() {
  if (ACADEMY_SCOPED_RESET_REGISTRY.length !== 29) {
    throw new Error("Reset registry must contain exactly 29 collections.");
  }
  const names = ACADEMY_SCOPED_RESET_REGISTRY.map(
      ({collectionName}) => collectionName,
  );
  if (new Set(names).size !== names.length) {
    throw new Error("Reset registry collection names must be unique.");
  }
  const counts = Object.fromEntries(
      Object.values(RESET_CLASSIFICATIONS).map((classification) => [
        classification,
        ACADEMY_SCOPED_RESET_REGISTRY.filter(
            (item) => item.classification === classification,
        ).length,
      ]),
  );
  if (
    counts[C.RESET_ALL_ACADEMY_SCOPED] !== 24 ||
    counts[C.RESET_WITH_PRESERVE_FILTER] !== 3 ||
    counts[C.ARCHIVE_OR_RETAIN] !== 1 ||
    counts[C.GLOBAL_NEVER_RESET] !== 1
  ) {
    throw new Error("Reset registry classification counts are invalid.");
  }
  const nameSet = new Set(names);
  for (const item of ACADEMY_SCOPED_RESET_REGISTRY) {
    for (const extractor of item.referenceExtractors) {
      if (!["collect", "same_single_value", "strict_scalar_alias"].includes(
          extractor.aliasPolicy,
      )) {
        throw new Error(
            `${item.collectionName} has an invalid alias policy.`,
        );
      }
      if (!["string_or_array", "array"].includes(extractor.valueType)) {
        throw new Error(
            `${item.collectionName} has an invalid reference value type.`,
        );
      }
      for (const targetCollection of extractor.targetCollections) {
        if (!nameSet.has(targetCollection)) {
          throw new Error(
              `${item.collectionName} targets unknown ${targetCollection}.`,
          );
        }
      }
    }
  }
  for (const [sourceType, mapping] of Object.entries(
      CREDIT_SOURCE_REFERENCE_MAPPINGS,
  )) {
    if (!nameSet.has(mapping.targetCollection)) {
      throw new Error(
          `Credit source type ${sourceType} targets an unknown collection.`,
      );
    }
  }
  return Object.freeze({...counts});
}

export const RESET_REGISTRY_COUNTS = assertResetRegistry();
export const RESET_REGISTRY_BY_COLLECTION = Object.freeze(
    Object.fromEntries(
        ACADEMY_SCOPED_RESET_REGISTRY.map((item) => [
          item.collectionName,
          item,
        ]),
    ),
);
