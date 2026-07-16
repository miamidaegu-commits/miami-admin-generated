export const RESET_PLAN_VERSION = 2;
export const EXPECTED_PRODUCTION_PROJECT = "daegu-miami-production";
export const EXPECTED_TARGET_ACADEMY = "academy_daegumiami";
export const ALL_ACADEMY_DATA_TEST_PROFILE =
  "all_academy_data_test_v1";
export const PROFILE_POLICY_VERSION =
  "all_academy_data_test_v1.policy.v3";
export const MEMBERSHIP_CLASSIFICATION_POLICY_VERSION =
  "academy_membership_test_reset.policy.v3";
export const KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION =
  "credit_source_reference_allowlist.v2";
export const REFERENCE_CARDINALITY_POLICY_VERSION = 1;
export const REFERENCE_CARDINALITIES = Object.freeze({
  OPTIONAL_SCALAR: "optional_scalar",
  REQUIRED_SCALAR: "required_scalar",
  OPTIONAL_ARRAY: "optional_array",
  REQUIRED_ARRAY: "required_array",
});
export const STAFF_MEMBERSHIP_ROLES = Object.freeze([
  "admin",
  "owner",
  "staff",
  "teacher",
]);
export const MEMBERSHIP_STATUS_FIELDS = Object.freeze(["status"]);
export const KNOWN_MEMBERSHIP_STATUSES = Object.freeze(["active"]);
export const MEMBERSHIP_PRINCIPAL_UID_FIELDS = Object.freeze([
  "uid",
  "memberUid",
  "authUid",
]);
export const TEACHER_IDENTITY_FIELD_FAMILIES = Object.freeze({
  authUid: Object.freeze(["teacherUid", "teacherUID"]),
  teacherId: Object.freeze(["teacherId", "teacherID"]),
  teacherKey: Object.freeze(["teacherKey"]),
});

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
  const valueType = options.valueType || "string";
  if (!["string", "array"].includes(valueType)) {
    throw new Error("Reference value type must be explicitly scalar or array.");
  }
  const cardinality = valueType === "array" ?
    REFERENCE_CARDINALITIES.OPTIONAL_ARRAY :
    REFERENCE_CARDINALITIES.OPTIONAL_SCALAR;
  const fieldSpecs = fields.map((field) => {
    const absenceShapes = options.allowedAbsenceShapesByField?.[field] || [];
    return Object.freeze({
      field,
      targetCollections: Object.freeze([...targetCollections]),
      cardinality,
      allowNull: absenceShapes.includes("null"),
      allowEmptyString: absenceShapes.includes("empty_string"),
      deduplicate: true,
      policyVersion: REFERENCE_CARDINALITY_POLICY_VERSION,
    });
  });
  return Object.freeze({
    family,
    targetCollections: Object.freeze([...targetCollections]),
    fields: Object.freeze([...fields]),
    fieldSpecs: Object.freeze(fieldSpecs),
    aliasPolicy: options.aliasPolicy || "collect",
    valueType,
    lookup: options.lookup || "document_id",
    allowedAbsenceShapesByField: Object.freeze(
        Object.fromEntries(
            Object.entries(options.allowedAbsenceShapesByField || {})
                .map(([field, shapes]) => [
                  field,
                  Object.freeze([...shapes]),
                ]),
        ),
    ),
  });
}

export const KNOWN_CREDIT_SOURCE_TYPE_KEYS = Object.freeze([
  "fixed-private-renewal",
  "fixedPrivateReservation",
  "groupClass",
  "groupLesson",
  "lesson",
  "privateReservation",
  "studentPackage",
]);
export const KNOWN_CREDIT_SOURCE_TYPE_CARDINALITY =
  KNOWN_CREDIT_SOURCE_TYPE_KEYS.length;
export const KNOWN_CREDIT_SOURCE_TYPE_TARGETS = Object.freeze({
  "fixed-private-renewal": "fixedPrivateRenewalBatches",
  "fixedPrivateReservation": "privateLessonReservations",
  "groupClass": "groupClasses",
  "groupLesson": "groupLessons",
  "lesson": "lessons",
  "privateReservation": "privateLessonReservations",
  "studentPackage": "studentPackages",
});

const creditSourceReferenceMappings = Object.assign(Object.create(null), {
  "privateReservation": Object.freeze({
    targetCollection:
      KNOWN_CREDIT_SOURCE_TYPE_TARGETS.privateReservation,
    explicitIdFields: Object.freeze([
      "reservationId",
      "privateLessonReservationId",
      "linkedReservationId",
    ]),
    explicitIdCardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  "fixedPrivateReservation": Object.freeze({
    targetCollection:
      KNOWN_CREDIT_SOURCE_TYPE_TARGETS.fixedPrivateReservation,
    explicitIdFields: Object.freeze([
      "reservationId",
      "privateLessonReservationId",
      "linkedReservationId",
    ]),
    explicitIdCardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  "groupLesson": Object.freeze({
    targetCollection: KNOWN_CREDIT_SOURCE_TYPE_TARGETS.groupLesson,
    explicitIdFields: Object.freeze(["lessonId", "groupLessonId"]),
    explicitIdCardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  "lesson": Object.freeze({
    targetCollection: KNOWN_CREDIT_SOURCE_TYPE_TARGETS.lesson,
    explicitIdFields: Object.freeze([
      "lessonId",
      "fixedLessonId",
      "linkedLessonId",
    ]),
    explicitIdCardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  "groupClass": Object.freeze({
    targetCollection: KNOWN_CREDIT_SOURCE_TYPE_TARGETS.groupClass,
    explicitIdFields: Object.freeze([
      "groupClassId",
      "groupClassID",
      "classId",
      "classID",
    ]),
    explicitIdCardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  "studentPackage": Object.freeze({
    targetCollection: KNOWN_CREDIT_SOURCE_TYPE_TARGETS.studentPackage,
    explicitIdFields: Object.freeze(["packageId"]),
    explicitIdCardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  "fixed-private-renewal": Object.freeze({
    targetCollection:
      KNOWN_CREDIT_SOURCE_TYPE_TARGETS["fixed-private-renewal"],
    explicitIdFields: Object.freeze(["renewalBatchId"]),
    explicitIdCardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
});
export const CREDIT_SOURCE_REFERENCE_MAPPINGS = Object.freeze(
    creditSourceReferenceMappings,
);
export const CREDIT_SOURCE_GENERIC_REFERENCE_FIELD_SPECS = Object.freeze([
  Object.freeze({
    fields: Object.freeze(["lessonId", "fixedLessonId", "linkedLessonId"]),
    cardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  Object.freeze({
    fields: Object.freeze([
      "reservationId",
      "privateLessonReservationId",
      "linkedReservationId",
    ]),
    cardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
  Object.freeze({
    fields: Object.freeze(["slotId", "privateLessonSlotId", "linkedSlotId"]),
    cardinality: REFERENCE_CARDINALITIES.OPTIONAL_SCALAR,
  }),
]);

function entry({
  collectionName,
  classification,
  academyScopeStrategy = S.ACADEMY_ID_FIELD,
  preserveReason = "",
  referenceExtractors = [],
  expectedDeletionOrderGroup = 0,
  profileResetDeletionOrderGroup = 0,
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
    profileResetDeletionOrderGroup,
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
      ], {
        aliasPolicy: "same_single_value",
        valueType: "string",
        allowedAbsenceShapesByField: {
          groupClassId: ["null"],
        },
      }),
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
        "privateLessonReservationId",
        "linkedReservationId",
      ]),
      reference("reservation", "privateLessonReservations", [
        "reservationId",
      ], {
        valueType: "string",
        allowedAbsenceShapesByField: {
          reservationId: ["empty_string"],
        },
      }),
      reference("student", "privateStudents", [
        "studentId",
        "studentID",
        "fixedStudentId",
      ], {
        valueType: "string",
      }),
      reference("student", "privateStudents", [
        "eligibleStudentIds",
      ], {
        valueType: "array",
      }),
      reference("student", "privateStudents", [
        "reservedStudentId",
      ], {
        valueType: "string",
        allowedAbsenceShapesByField: {
          reservedStudentId: ["empty_string"],
        },
      }),
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
      reference("package", "studentPackages", ["activePackageIds"], {
        valueType: "array",
      }),
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
      reference("lesson", "lessons", ["created.lessons", "lessons"], {
        valueType: "array",
      }),
      reference("slot", "privateLessonSlots", [
        "created.privateLessonSlots",
        "privateLessonSlots",
      ], {valueType: "array"}),
      reference("reservation", "privateLessonReservations", [
        "created.privateLessonReservations",
        "privateLessonReservations",
      ], {valueType: "array"}),
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
      reference("lesson", "lessons", ["created.lessons", "lessons"], {
        valueType: "array",
      }),
      reference("slot", "privateLessonSlots", [
        "created.privateLessonSlots",
        "privateLessonSlots",
      ], {valueType: "array"}),
      reference("reservation", "privateLessonReservations", [
        "created.privateLessonReservations",
        "privateLessonReservations",
      ], {valueType: "array"}),
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
      reference("teacher_identity", "teachers", ["teacherId", "teacherID"], {
        valueType: "string",
        allowedAbsenceShapesByField: {
          teacherId: ["null", "empty_string"],
        },
      }),
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
      reference("group_class", "groupClasses", ["groupClassIds"], {
        valueType: "array",
      }),
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
        "privateLessonReservationId",
      ]),
      reference("reservation", "privateLessonReservations", [
        "reservationId",
      ], {
        valueType: "string",
        allowedAbsenceShapesByField: {
          reservationId: ["empty_string"],
        },
      }),
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
      reference("teacher_identity_id", "teachers", [
        "teacherId",
        "teacherID",
      ], {
        aliasPolicy: "strict_scalar_alias",
        valueType: "string",
      }),
      reference("teacher_identity_key", "teachers", [
        "teacherKey",
      ], {
        aliasPolicy: "strict_scalar_alias",
        valueType: "string",
        lookup: "teacher_key",
      }),
      reference("teacher_identity_uid", "teachers",
          TEACHER_IDENTITY_FIELD_FAMILIES.authUid, {
            aliasPolicy: "strict_scalar_alias",
            valueType: "string",
            lookup: "teacher_uid",
          }),
      reference("membership_principal", "users",
          MEMBERSHIP_PRINCIPAL_UID_FIELDS, {
            aliasPolicy: "strict_scalar_alias",
            valueType: "string",
          }),
    ],
    profileResetDeletionOrderGroup: 1,
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
      reference("teacher_identity_id", "teachers", [
        "teacherId",
        "teacherID",
      ], {
        aliasPolicy: "strict_scalar_alias",
        valueType: "string",
      }),
      reference("teacher_identity_key", "teachers", ["teacherKey"], {
        valueType: "string",
        lookup: "teacher_key",
      }),
      reference("teacher_identity_uid", "teachers",
          TEACHER_IDENTITY_FIELD_FAMILIES.authUid, {
            aliasPolicy: "strict_scalar_alias",
            valueType: "string",
            lookup: "teacher_uid",
          }),
      reference("provisioning_legacy_teacher", "teachers", ["teacher"], {
        valueType: "string",
        lookup: "unresolved_teacher_alias",
      }),
      reference("membership", "academyMemberships", ["membershipId"]),
      reference("membership_principal", "users",
          MEMBERSHIP_PRINCIPAL_UID_FIELDS, {
            aliasPolicy: "strict_scalar_alias",
            valueType: "string",
          }),
    ],
    profileResetDeletionOrderGroup: 1,
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

export const REFERENCE_FIELD_SPECS = Object.freeze(
    ACADEMY_SCOPED_RESET_REGISTRY.flatMap((registryEntry) =>
      registryEntry.referenceExtractors.flatMap((extractor) =>
        extractor.fieldSpecs.map((fieldSpec) => Object.freeze({
          collectionName: registryEntry.collectionName,
          family: extractor.family,
          aliasPolicy: extractor.aliasPolicy,
          lookup: extractor.lookup,
          ...fieldSpec,
        })),
      ),
    ),
);

export function assertReferenceCardinalityInvariant(
    registry = ACADEMY_SCOPED_RESET_REGISTRY,
) {
  const knownCardinalities = new Set(Object.values(REFERENCE_CARDINALITIES));
  const registrations = new Map();
  let scalarFields = 0;
  let arrayFields = 0;
  for (const registryEntry of registry) {
    for (const extractor of registryEntry.referenceExtractors) {
      if (!Array.isArray(extractor.fieldSpecs) ||
          extractor.fieldSpecs.length !== extractor.fields.length) {
        throw new Error(
            `${registryEntry.collectionName} reference field specs are incomplete.`,
        );
      }
      const extractorCardinalities = new Set();
      for (const fieldSpec of extractor.fieldSpecs) {
        const expectedValueType =
          fieldSpec?.cardinality?.endsWith("_array") ? "array" : "string";
        const expectedAbsenceShapes = [
          ...(fieldSpec?.allowNull ? ["null"] : []),
          ...(fieldSpec?.allowEmptyString ? ["empty_string"] : []),
        ].sort();
        if (!fieldSpec || typeof fieldSpec !== "object" ||
            !extractor.fields.includes(fieldSpec.field) ||
            !knownCardinalities.has(fieldSpec.cardinality) ||
            !Array.isArray(fieldSpec.targetCollections) ||
            fieldSpec.targetCollections.length === 0 ||
            typeof fieldSpec.allowNull !== "boolean" ||
            typeof fieldSpec.allowEmptyString !== "boolean" ||
            typeof fieldSpec.deduplicate !== "boolean" ||
            fieldSpec.policyVersion !== REFERENCE_CARDINALITY_POLICY_VERSION ||
            extractor.valueType !== expectedValueType ||
            JSON.stringify([...fieldSpec.targetCollections].sort()) !==
              JSON.stringify([...extractor.targetCollections].sort()) ||
            JSON.stringify(expectedAbsenceShapes) !== JSON.stringify(
                [...(extractor.allowedAbsenceShapesByField[
                  fieldSpec.field
                ] || [])].sort(),
            )) {
          throw new Error(
              `${registryEntry.collectionName} has an invalid field cardinality.`,
          );
        }
        const registrationKey =
          `${registryEntry.collectionName}\u0000${fieldSpec.field}`;
        if (registrations.has(registrationKey)) {
          throw new Error(
              `${registryEntry.collectionName}.${fieldSpec.field} ` +
              "has conflicting cardinality registrations.",
          );
        }
        registrations.set(registrationKey, fieldSpec.cardinality);
        extractorCardinalities.add(fieldSpec.cardinality);
        if (fieldSpec.cardinality.endsWith("_scalar")) scalarFields += 1;
        if (fieldSpec.cardinality.endsWith("_array")) arrayFields += 1;
      }
      if (extractorCardinalities.size !== 1) {
        throw new Error(
            `${registryEntry.collectionName} mixes scalar and array fields ` +
            "in one reference extractor.",
        );
      }
    }
  }
  return Object.freeze({
    totalFields: registrations.size,
    scalarFields,
    arrayFields,
  });
}

export function assertCreditSourceAllowlistInvariant(
    mappings = CREDIT_SOURCE_REFERENCE_MAPPINGS,
) {
  if (!mappings || typeof mappings !== "object" ||
      Object.getPrototypeOf(mappings) !== null ||
      !Object.isFrozen(mappings)) {
    throw new Error(
        "Credit source mapping must be frozen with a null prototype.",
    );
  }
  const creditSourceKeys = Object.keys(mappings).sort();
  if (creditSourceKeys.length !== KNOWN_CREDIT_SOURCE_TYPE_CARDINALITY ||
      JSON.stringify(creditSourceKeys) !==
        JSON.stringify(KNOWN_CREDIT_SOURCE_TYPE_KEYS)) {
    throw new Error("Credit source type exact keyset invariant failed.");
  }
  for (const sourceType of KNOWN_CREDIT_SOURCE_TYPE_KEYS) {
    const mapping = Reflect.get(mappings, sourceType);
    if (!mapping || typeof mapping !== "object" ||
        mapping.targetCollection !==
          Reflect.get(KNOWN_CREDIT_SOURCE_TYPE_TARGETS, sourceType) ||
        !Array.isArray(mapping.explicitIdFields) ||
        mapping.explicitIdCardinality !==
          REFERENCE_CARDINALITIES.OPTIONAL_SCALAR ||
        mapping.explicitIdFields.some(
            (field) => typeof field !== "string" || !field.trim(),
        )) {
      throw new Error(
          `Credit source type ${sourceType} target invariant failed.`,
      );
    }
  }
  for (const fieldSpec of CREDIT_SOURCE_GENERIC_REFERENCE_FIELD_SPECS) {
    if (!Array.isArray(fieldSpec.fields) ||
        fieldSpec.fields.length === 0 ||
        fieldSpec.fields.some(
            (field) => typeof field !== "string" || !field.trim(),
        ) ||
        fieldSpec.cardinality !==
          REFERENCE_CARDINALITIES.OPTIONAL_SCALAR) {
      throw new Error(
          "Credit source generic reference cardinality invariant failed.",
      );
    }
  }
  return true;
}

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
      if (!["array", "string"].includes(extractor.valueType)) {
        throw new Error(
            `${item.collectionName} has an invalid reference value type.`,
        );
      }
      if (![
        "document_id",
        "teacher_key",
        "teacher_uid",
        "unresolved_teacher_alias",
      ].includes(extractor.lookup)) {
        throw new Error(
            `${item.collectionName} has an invalid reference lookup.`,
        );
      }
      for (const [field, shapes] of Object.entries(
          extractor.allowedAbsenceShapesByField,
      )) {
        if (!extractor.fields.includes(field) ||
            shapes.some((shape) =>
              !["null", "empty_string"].includes(shape),
            )) {
          throw new Error(
              `${item.collectionName} has an invalid absence shape.`,
          );
        }
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
  assertReferenceCardinalityInvariant();
  for (const [sourceType, mapping] of Object.entries(
      CREDIT_SOURCE_REFERENCE_MAPPINGS,
  )) {
    if (!nameSet.has(mapping.targetCollection)) {
      throw new Error(
          `Credit source type ${sourceType} targets an unknown collection.`,
      );
    }
  }
  assertCreditSourceAllowlistInvariant();
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
