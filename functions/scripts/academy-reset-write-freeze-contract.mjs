import crypto from "node:crypto";
import {
  assertValidatedProviderRuntimeContext,
} from "./academy-reset-freeze-provider-attestation.mjs";
import {
  APPROVED_ARTIFACT_REPOSITORY,
  APPROVED_SOURCE_BUCKET,
  APPROVED_UPLOAD_BUCKET,
  BUILD_CORE_PERMISSION_SET_DIGEST,
  BUILD_RESOURCE_BINDING_SET_DIGEST,
  BUILD_SCOPE_CONTRACT_DIGEST,
  BUILD_SCOPE_CONTRACT_VERSION,
  COMPENSATING_CONTROL_DIGEST,
  COMPENSATING_CONTROL_VERSION,
  DEPLOY_PERMISSION_SET_DIGEST,
  DEPLOY_PROFILE_DIGEST,
  DEPLOY_PROFILE_VERSION,
  INFRASTRUCTURE_EVIDENCE_DIGEST,
  ORGANIZATION_POLICY_EVIDENCE,
  buildOrganizationPolicyLineageReference,
  canonicalDigest as buildCanonicalDigest,
  validateFunctionsBuildAndDeployContract,
  validateOrganizationPolicyLineageReference,
} from "./academy-functions-build-scope-contract.mjs";
import {
  BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER,
  EXPECTED_BINDING_SET_DIGESTS_BY_STATE,
  EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE,
  FREEZE_ACTIVE_STATE,
  FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING,
  PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER,
  PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
  PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
  READ_ONLY_DATASTORE_PERMISSIONS,
  WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER,
  WRITER_STEADY_DATASTORE_PERMISSIONS,
  WRITER_STEADY_ROLE,
  EXACT_CHRONOLOGY_PROFILE_VERSION,
  buildBindingSetDigest as buildRuntimeBindingSetDigest,
  buildPermissionSetDigest as buildRuntimePermissionSetDigest,
  parseExactRfc3339UtcNanoseconds,
  validateFreezeActivationReceipt,
  validatePrivateRuntimeIamContract,
  validateStateSnapshot,
} from "./academy-private-runtime-iam-contract.mjs";
import {
  CRITICAL_RUNTIME_SOURCE_PATHS,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS,
  assertRuntimeGitEvidence,
  validateProviderAdapterReviewedSources,
} from "./academy-reset-freeze-runtime-identity.mjs";
import {
  ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
  EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
  RESET_COLLECTIONS,
  WRITE_SOURCE_SHA256_ALLOWLIST,
  WRITE_SURFACE_REGISTRY_VERSION,
  assertWriteSurfaceRegistry,
} from "./academy-reset-write-surface-registry.mjs";
import {
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  PROVIDER_AUTH_DEPENDENCY,
  PROVIDER_HTTP_RUNTIME,
  PROVIDER_NO_MUTATION_OPERATION_COUNT,
  PROVIDER_MANDATORY_OPERATION_COUNT,
  PROVIDER_MANDATORY_OPERATION_IDS,
  PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
  PROVIDER_OPERATION_ALLOWLIST_VERSION,
  PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
  PROVIDER_OPERATION_CLASSIFICATION_VERSION,
  PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
  PROVIDER_TRANSPORT,
  assertProviderOperationClassification,
  assertProviderOperationRegistry,
} from "./academy-reset-freeze-provider-operations.mjs";
import {
  EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
} from "./academy-reset-freeze-provider-reviewed-sources.mjs";
import {
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT,
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
  OFFICIAL_EVIDENCE_SET_DIGEST,
  OBSERVER_PRINCIPAL_POLICY,
  PERMISSION_RESEARCH_ARTIFACT_SHA256,
  PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
  READONLY_PERMISSION_MANIFEST_DIGEST,
  READONLY_PERMISSION_MANIFEST_VERSION,
  REVIEWED_EVIDENCE_SET_DIGEST,
  STANDALONE_PROJECT_OBSERVER_PROFILE,
  assertEffectiveMandatoryPermissionContract,
  assertObserverPrincipalPolicy,
  assertReadonlyPermissionManifest,
  assertStandaloneProjectObserverProfile,
  deriveStandaloneProjectObserverProfile,
} from "./academy-reset-freeze-readonly-permissions.mjs";

export {
  CRITICAL_RUNTIME_SOURCE_PATHS,
  EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
  OBSERVER_PRINCIPAL_POLICY,
  PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS,
  STANDALONE_PROJECT_OBSERVER_PROFILE,
  assertObserverPrincipalPolicy,
  assertStandaloneProjectObserverProfile,
  deriveStandaloneProjectObserverProfile,
  validateProviderAdapterReviewedSources,
};

export const WRITE_FREEZE_CONTRACT_VERSION =
  "academy_reset_write_freeze.v8";
export const WRITE_FREEZE_PROOF_VERSION =
  "academy_reset_write_freeze_proof.v8";
export const DEPLOYMENT_APPROVAL_RECEIPT_VERSION =
  "academy_reset_deployment_approval.v9";
export const PROVIDER_OBSERVATION_VERSION =
  "academy_reset_provider_observation.v8";
export const OBSERVATION_COMPLETENESS_VERSION =
  "academy_reset_observation_completeness.v1";
export const IAM_FAMILY_COMPLETENESS_VERSION =
  "academy_reset_iam_family_completeness.v1";
export const APPROVED_IAM_STATE_CONTRACT_VERSION =
  "academy_reset_approved_iam_state.v1";
export const PROVIDER_DEPENDENCY_CONTRACT_VERSION =
  "academy_reset_provider_dependency.v8";
export const WRITABLE_PERMISSION_DERIVATION_VERSION =
  "academy_reset_writable_permission_derivation.v1";
export const APPROVED_PROVIDER_ADAPTER_ID =
  "gcp_immutable_resource_observer.v1";
export const FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION =
  "academy_reset_function_http_trigger.v2";
export const FUNCTION_HTTP_TRIGGER_CONTRACT_ID =
  "HTTP_CALLABLE_ONLY_EVENT_TRIGGER_ABSENT";
export const FUNCTION_TRIGGER_ABSENCE_EVIDENCE_VERSION =
  "academy_reset_function_trigger_absence_evidence.v2";
export const FUNCTION_HTTP_TRIGGER_TYPE = "HTTP_CALLABLE";
const FUNCTION_HTTP_TRIGGER_CONTRACT_WITHOUT_DIGEST = Object.freeze({
  contractVersion: FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION,
  contractId: FUNCTION_HTTP_TRIGGER_CONTRACT_ID,
  triggerType: FUNCTION_HTTP_TRIGGER_TYPE,
  eventTriggerOwnPropertyDisposition: "REJECT",
  rawPreimageFamilies: Object.freeze([
    "cloudfunctions.v2.projects.locations.functions.list",
    "cloudfunctions.v2.projects.locations.functions.get",
  ]),
});
export const FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST =
  sha256Canonical(FUNCTION_HTTP_TRIGGER_CONTRACT_WITHOUT_DIGEST);
export const WRITE_FREEZE_SENTINEL_MODE = "academy_test_data_reset";
export const PROJECT_IDENTITY_CONTRACT_VERSION = 1;
export const TARGET_PROJECT_IDENTITY = Object.freeze({
  projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
  targetProjectId: "daegu-miami-production",
  targetProjectNumber: "884850632328",
});
export const EXPECTED_PROJECT_ID = TARGET_PROJECT_IDENTITY.targetProjectId;
export const EXPECTED_PROJECT_NUMBER =
  TARGET_PROJECT_IDENTITY.targetProjectNumber;
export const IAM_PRINCIPAL_POLICY_VERSION = 1;
export const FREEZE_IAM_CONTRACT_LINEAGE_VERSION =
  "academy_reset_freeze_iam_contract_lineage.v1";
export const EXPECTED_ACADEMY_ID = "academy_daegumiami";
export const EXPECTED_FUNCTION_REGION = "us-central1";
export const EXPECTED_FUNCTION_GENERATION = "GEN_2";
export const REQUIRED_COMPARISON_BASELINE_DIGEST =
  "cb1c716340afe12a8ec1d9ce77c3466d7808505fff33ce7ae3841eb95898a3b9";
export const MAX_FREEZE_WINDOW_SECONDS = 3600;
export const MIN_DRAIN_QUIET_WINDOW_SECONDS = 120;
export const MAX_DRAIN_QUIET_WINDOW_SECONDS = 900;
export const PROVIDER_DEPENDENCY_STRATEGIES = Object.freeze([
  "declared_google_auth_library_rest",
]);
export const PROVIDER_READ_ONLY_OPERATIONS = PROVIDER_OPERATION_IDS;
export const PROVIDER_ADAPTER_METADATA = Object.freeze({
  providerOperationAllowlistVersion: PROVIDER_OPERATION_ALLOWLIST_VERSION,
  providerOperationDescriptorSetDigest:
    PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  providerOperationClassificationVersion:
    PROVIDER_OPERATION_CLASSIFICATION_VERSION,
  providerOperationClassificationDigest:
    PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
  providerMandatoryOperationCount: PROVIDER_MANDATORY_OPERATION_COUNT,
  providerMandatoryOperationIdsDigest:
    PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
  providerOptionalDiagnosticOperationCount:
    PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT,
  providerOptionalDiagnosticOperationIdsDigest:
    PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
  readonlyPermissionManifestVersion: READONLY_PERMISSION_MANIFEST_VERSION,
  readonlyPermissionManifestDigest: READONLY_PERMISSION_MANIFEST_DIGEST,
  readonlyPermissionOfficialEvidenceSetDigest: OFFICIAL_EVIDENCE_SET_DIGEST,
  readonlyPermissionReviewedEvidenceSetDigest: REVIEWED_EVIDENCE_SET_DIGEST,
  readonlyPermissionResearchArtifactSha256:
    PERMISSION_RESEARCH_ARTIFACT_SHA256,
  effectiveMandatoryPermissionContractDigest:
    EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
  topologyProfileVersion:
    STANDALONE_PROJECT_OBSERVER_PROFILE.topologyProfileVersion,
  topologyProfileId:
    STANDALONE_PROJECT_OBSERVER_PROFILE.topologyProfileId,
  topologyEvidenceDigest:
    STANDALONE_PROJECT_OBSERVER_PROFILE.topologyEvidenceDigest,
  topologyProfileDigest:
    STANDALONE_PROJECT_OBSERVER_PROFILE.profileDigest,
  operationExecutionProfileVersion:
    STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
        .operationExecutionProfileVersion,
  executedMandatoryOperationCount:
    STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
        .executedMandatoryOperationCount,
  executedMandatoryOperationSetDigest:
    STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
        .executedMandatoryOperationSetDigest,
  notApplicableMandatoryOperationCount:
    STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
        .notApplicableMandatoryOperationCount,
  notApplicableMandatoryOperationSetDigest:
    STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
        .notApplicableMandatoryOperationSetDigest,
  effectiveRequiredPermissionCount:
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
        .effectiveRequiredPermissionCount,
  effectivePermissionProfileVersion:
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
        .permissionProfileVersion,
  effectiveRequiredPermissionSetDigest:
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
        .effectiveRequiredPermissionSetDigest,
  effectiveAuxiliaryPermissionCount:
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
        .effectiveAuxiliaryPermissionCount,
  effectiveAuxiliaryPermissionSetDigest:
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
        .effectiveAuxiliaryPermissionSetDigest,
  effectiveRolePermissionCount:
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
        .effectiveRolePermissionCount,
  effectiveRolePermissionSetDigest:
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
        .effectiveRolePermissionSetDigest,
  observerPrincipalPolicy: OBSERVER_PRINCIPAL_POLICY,
  mandatoryRequiredIamPermissions:
    EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.requiredIamPermissions,
  mandatoryConditionalPermissions:
    EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.conditionalPermissions,
  mandatoryAuxiliaryPermissions:
    EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.auxiliaryPermissions,
  mandatoryOauthScopes:
    EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.oauthScopes,
  mandatoryPermissionSourceOperations:
    EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.sourceOperations,
  allowedOperations: PROVIDER_READ_ONLY_OPERATIONS,
  transport: PROVIDER_TRANSPORT,
  authDependency: PROVIDER_AUTH_DEPENDENCY,
  httpRuntime: PROVIDER_HTTP_RUNTIME,
  providerAdapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
  noMutationOperationCount: PROVIDER_NO_MUTATION_OPERATION_COUNT,
  reviewedSourceContractVersion:
    PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  reviewedSourcePaths: PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS,
  reviewedSourceDigestAlgorithm:
    PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM,
  reviewedSourceIdentityPinStatus: "literal_sha256_pinned",
  reviewedSourceIdentities: PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
  reviewedSourceIdentityDigest:
    EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
  privateRuntimeIamContractVersion: PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
  privateRuntimeIamContractDigest: PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
  buildScopeContractVersion: BUILD_SCOPE_CONTRACT_VERSION,
  buildScopeContractDigest: BUILD_SCOPE_CONTRACT_DIGEST,
  deployProfileVersion: DEPLOY_PROFILE_VERSION,
  deployProfileDigest: DEPLOY_PROFILE_DIGEST,
  compensatingControlVersion: COMPENSATING_CONTROL_VERSION,
  compensatingControlDigest: COMPENSATING_CONTROL_DIGEST,
  functionHttpTriggerContractVersion:
    FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION,
  functionHttpTriggerContractId: FUNCTION_HTTP_TRIGGER_CONTRACT_ID,
  functionHttpTriggerContractDigest: FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST,
});
export const IAM_EVIDENCE_FAMILY_NAMES = Object.freeze([
  "bindings",
  "conditionEvaluations",
  "denyPolicies",
  "denyEvaluations",
  "groupExpansions",
  "impersonationEvidence",
  "principals",
  "roleDefinitions",
  "runtimeServiceAccounts",
]);
export const PROOF_GATE_KEYS = Object.freeze([
  "providerObservationComplete",
  "policyAnalysisComplete",
  "drainTelemetryComplete",
  "deploymentLineageApproved",
  "writeFreezeVerified",
]);
export const WRITER_DRAIN_CLASSES = Object.freeze([
  "callable_writer",
  "scheduled_writer",
  "auth_writer",
  "backend_writer",
]);

export const EXPECTED_DEPLOYED_FUNCTION_NAMES = Object.freeze([
  "adminCancelPrivateLessonReservation",
  "adminClosePrivateLessonSlot",
  "adminReopenPrivateLessonSlot",
  "autoDeductPendingLessons",
  "bootstrapAdmin",
  "cancelFixedPrivateLessonOccurrence",
  "cancelGroupLessonSeat",
  "cancelPrivateLessonReservation",
  "commitFixedPrivateLessonOutcomeAction",
  "commitPrivateLessonOutcomeAction",
  "commitPrivateLessonStatusAction",
  "createFixedPrivateLessonAssignment",
  "createFixedPrivateLessonRenewal",
  "inspectFixedPrivateLessonOutcomeLedger",
  "inspectFixedPrivateLessonOutcomeRemediationEvidence",
  "inspectFixedPrivateLessonRescheduleScope",
  "linkStudentAccount",
  "linkTeacherAccount",
  "listGroupLessonAvailability",
  "listPrivateLessonSlotAvailability",
  "markPrivateReservationOutcome",
  "previewFixedPrivateLessonOutcomeAction",
  "previewFixedPrivateLessonRescheduleScope",
  "previewPrivateLessonOutcomeAction",
  "previewPrivateLessonStatusAction",
  "releaseGroupLessonFixedSeat",
  "reserveGroupLessonSeat",
  "reservePrivateLessonSlot",
  "restoreGroupLessonFixedSeat",
  "reversePrivateReservationOutcome",
  "runAutoDeductPendingLessonsForTest",
  "setUserRole",
  "updateFixedPrivateLessonScheduleScope",
  "updateStudentPrivateCancelAllowance",
  "updateTeacherStudentPackageCounts",
].sort());

export const EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES = Object.freeze([
  "adminCancelPrivateLessonReservation",
  "adminClosePrivateLessonSlot",
  "adminReopenPrivateLessonSlot",
  "autoDeductPendingLessons",
  "bootstrapAdmin",
  "cancelFixedPrivateLessonOccurrence",
  "cancelGroupLessonSeat",
  "cancelPrivateLessonReservation",
  "commitFixedPrivateLessonOutcomeAction",
  "commitPrivateLessonOutcomeAction",
  "commitPrivateLessonStatusAction",
  "createFixedPrivateLessonAssignment",
  "createFixedPrivateLessonRenewal",
  "linkStudentAccount",
  "linkTeacherAccount",
  "markPrivateReservationOutcome",
  "releaseGroupLessonFixedSeat",
  "reserveGroupLessonSeat",
  "reservePrivateLessonSlot",
  "restoreGroupLessonFixedSeat",
  "reversePrivateReservationOutcome",
  "runAutoDeductPendingLessonsForTest",
  "setUserRole",
  "updateFixedPrivateLessonScheduleScope",
  "updateStudentPrivateCancelAllowance",
  "updateTeacherStudentPackageCounts",
].sort());

export const NON_EXECUTOR_EFFECTIVE_PERMISSIONS = Object.freeze([
  "datastore.databases.get",
  "datastore.entities.get",
  "datastore.entities.list",
]);
export const FUTURE_EXECUTOR_EFFECTIVE_PERMISSIONS = Object.freeze([
  ...NON_EXECUTOR_EFFECTIVE_PERMISSIONS,
  "datastore.entities.delete",
].sort());
export const REVIEWED_PERMISSION_UNIVERSE = Object.freeze([
  ...new Set([
    ...FUTURE_EXECUTOR_EFFECTIVE_PERMISSIONS,
    ...WRITER_STEADY_DATASTORE_PERMISSIONS,
  ]),
].sort());
export const REVIEWED_WRITABLE_PERMISSIONS = Object.freeze([
  "datastore.entities.create",
  "datastore.entities.delete",
  "datastore.entities.update",
]);
export const REVIEWED_IAM_ROLE_DEFINITIONS = Object.freeze([
  Object.freeze({
    role: "projects/daegu-miami-production/roles/academyBackendReadOnly",
    permissions: NON_EXECUTOR_EFFECTIVE_PERMISSIONS,
    permissionsComplete: true,
    deleted: false,
    stage: "GA",
  }),
  Object.freeze({
    role: "projects/daegu-miami-production/roles/academyResetDeleteOnly",
    permissions: FUTURE_EXECUTOR_EFFECTIVE_PERMISSIONS,
    permissionsComplete: true,
    deleted: false,
    stage: "GA",
  }),
  Object.freeze({
    role: WRITER_STEADY_ROLE,
    permissions: WRITER_STEADY_DATASTORE_PERMISSIONS,
    permissionsComplete: true,
    deleted: false,
    stage: "GA",
  }),
]);
export const KNOWN_IAM_GROUPS = Object.freeze([
  "group:academy-backend-readers@daegu-miami.com",
]);

export const IAM_PRINCIPAL_POLICY_SCHEMA = Object.freeze([
  Object.freeze({
    id: "cloud_functions_runtime",
    memberBinding: "project_number_derived",
    semanticRole: "academy_backend_read_only",
    disposition: "ACTIVE_READ_ONLY",
    effectivePermissions: NON_EXECUTOR_EFFECTIVE_PERMISSIONS,
    authPermissions: Object.freeze([]),
  }),
  Object.freeze({
    id: "firebase_admin_backend",
    memberBinding: "approval_receipt_exact",
    semanticRole: "academy_backend_read_only",
    disposition: "ACTIVE_READ_ONLY",
    effectivePermissions: NON_EXECUTOR_EFFECTIVE_PERMISSIONS,
    authPermissions: Object.freeze([]),
  }),
  Object.freeze({
    id: "private_writer_runtime",
    memberBinding: "canonical_runtime_contract",
    semanticRole: "academy_backend_read_only",
    disposition: "ACTIVE_READ_ONLY",
    effectivePermissions: READ_ONLY_DATASTORE_PERMISSIONS,
    authPermissions: Object.freeze([]),
  }),
  Object.freeze({
    id: "private_preview_runtime",
    memberBinding: "canonical_runtime_contract",
    semanticRole: "academy_backend_read_only",
    disposition: "ACTIVE_READ_ONLY",
    effectivePermissions: READ_ONLY_DATASTORE_PERMISSIONS,
    authPermissions: Object.freeze([]),
  }),
  Object.freeze({
    id: "future_reset_executor",
    memberBinding: "approval_receipt_exact",
    semanticRole: "academy_reset_delete_only_inactive",
    disposition: "INACTIVE",
    effectivePermissions: FUTURE_EXECUTOR_EFFECTIVE_PERMISSIONS,
    authPermissions: Object.freeze([]),
  }),
]);
export const REQUIRED_IAM_PRINCIPAL_IDS = Object.freeze(
    IAM_PRINCIPAL_POLICY_SCHEMA.map(({id}) => id),
);

export const SCHEDULER_JOB_ALLOWLIST = Object.freeze([
  Object.freeze({
    name: "autoDeductPendingLessons",
    projectId: EXPECTED_PROJECT_ID,
    region: EXPECTED_FUNCTION_REGION,
    target:
      `projects/${EXPECTED_PROJECT_ID}/locations/${EXPECTED_FUNCTION_REGION}` +
      "/functions/autoDeductPendingLessons",
  }),
]);

export const UNFREEZE_ORDER = Object.freeze([
  "iamRestore",
  "schedulerRestore",
  "sentinelDeactivate",
  "positiveSmoke",
]);
export const ROLLBACK_UNFREEZE_ORDER = UNFREEZE_ORDER;

const TARGET_PROBE_PREFIX = "__academy_reset_freeze_probe_";
function probe(metadata) {
  return Object.freeze({
    targetProjectId: EXPECTED_PROJECT_ID,
    targetAcademyId: EXPECTED_ACADEMY_ID,
    providerAdapterId: APPROVED_PROVIDER_ADAPTER_ID,
    ...metadata,
  });
}
export const REQUIRED_NEGATIVE_PROBES = Object.freeze([
  probe({
    id: "target_admin_client",
    layer: "firestore_rules",
    provider: "firestore.googleapis.com",
    providerGeneration: "RULES_V2",
    providerVersion: "v1",
    entrypoint: "firestore.rules",
    principalId: "target_admin_client",
    operation: "create",
    collection: "dailyMaterials",
    target: `dailyMaterials/${TARGET_PROBE_PREFIX}admin__`,
    denialCode: "permission-denied",
  }),
  probe({
    id: "target_student_client",
    layer: "firestore_rules",
    provider: "firestore.googleapis.com",
    providerGeneration: "RULES_V2",
    providerVersion: "v1",
    entrypoint: "firestore.rules",
    principalId: "target_student_client",
    operation: "update",
    collection: "privateStudents",
    target: `privateStudents/${TARGET_PROBE_PREFIX}student__`,
    denialCode: "permission-denied",
  }),
  probe({
    id: "callable_non_transaction",
    layer: "functions_guard",
    provider: "cloudfunctions.googleapis.com",
    providerGeneration: EXPECTED_FUNCTION_GENERATION,
    providerVersion: "v2",
    entrypoint: "updateStudentPrivateCancelAllowance",
    principalId: "cloud_functions_runtime",
    operation: "callable:updateStudentPrivateCancelAllowance",
    collection: "studentPrivateBookingStats",
    target: `studentPrivateBookingStats/${TARGET_PROBE_PREFIX}callable__`,
    denialCode: "failed-precondition",
  }),
  probe({
    id: "transaction_callable",
    layer: "functions_transaction_guard",
    provider: "cloudfunctions.googleapis.com",
    providerGeneration: EXPECTED_FUNCTION_GENERATION,
    providerVersion: "v2",
    entrypoint: "reservePrivateLessonSlot",
    principalId: "cloud_functions_runtime",
    operation: "callable:reservePrivateLessonSlot",
    collection: "privateLessonReservations",
    target: `privateLessonReservations/${TARGET_PROBE_PREFIX}transaction__`,
    denialCode: "failed-precondition",
  }),
  probe({
    id: "scheduled_writer_guard",
    layer: "scheduler_functions_guard",
    provider: "cloudfunctions.googleapis.com",
    providerGeneration: EXPECTED_FUNCTION_GENERATION,
    providerVersion: "v2",
    entrypoint: "autoDeductPendingLessons",
    principalId: "cloud_functions_runtime",
    operation: "schedule:autoDeductPendingLessons",
    collection: "creditTransactions",
    target: `creditTransactions/${TARGET_PROBE_PREFIX}scheduler__`,
    denialCode: "failed-precondition",
  }),
  ...[
    ["backend_create", "backend_iam", "firestore_create", "privateStudents",
      "backend_create__"],
    ["backend_update", "backend_iam", "firestore_update", "studentPackages",
      "backend_update__"],
    ["backend_delete", "backend_iam", "firestore_delete", "lessons",
      "backend_delete__"],
    ["auth_mutation", "auth_iam", "auth_mutation", "users", "auth__"],
  ].map(([id, layer, operation, collection, suffix]) => probe({
    id,
    layer,
    provider: "iam.googleapis.com",
    providerGeneration: "IAM_V1",
    providerVersion: "v1",
    entrypoint: id === "auth_mutation" ? "firebaseauth.users.update" :
      `datastore.entities.${operation.replace("firestore_", "")}`,
    principalId: "cloud_functions_runtime",
    operation,
    collection,
    target: `${collection}/${TARGET_PROBE_PREFIX}${suffix}`,
    denialCode: "permission-denied",
  })),
]);

const HEX_64 = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const INTEGRATED_CHRONOLOGY_PROFILE = Object.freeze({
  profileVersion: "academy_reset_write_freeze_exact_chronology.v1",
  parserProfileVersion: EXACT_CHRONOLOGY_PROFILE_VERSION,
  integerRepresentation: "SIGNED_EPOCH_NANOSECONDS_BASE10",
  startBoundary: "INCLUSIVE",
  expiryBoundary: "EXCLUSIVE",
  equalStageBoundary: "ALLOWED",
});
const EXACT_TOP_LEVEL_KEYS = Object.freeze([
  "academyId",
  "artifactDigest",
  "baselineComparison",
  "deploymentApprovalReceipt",
  "drainTelemetry",
  "freezeWindow",
  "gateStates",
  "iamPolicy",
  "negativeProbes",
  "operationalSafety",
  "projectIdentityContractVersion",
  "projectId",
  "projectNumber",
  "release",
  "scheduler",
  "schemaVersion",
  "sentinel",
  "verifiedAt",
].sort());
const SECRET_KEY_PATTERN =
  /(?:password|passwd|secret|credential|private.?key|api.?key|token|authorization|cookie)/i;
const SECRET_VALUE_PATTERNS = Object.freeze([
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAIza[0-9A-Za-z_-]{30,}\b/,
  /\bya29\.[0-9A-Za-z_-]+\b/,
  /\bsk-(?:live|test|proj)-[0-9A-Za-z_-]{12,}\b/,
  /\b(?:eyJ[a-zA-Z0-9_-]{8,}\.){2}[a-zA-Z0-9_-]+\b/,
]);

function fail(message) {
  throw new Error(`Write-freeze evidence rejected: ${message}`);
}

function assertPlainRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail(`${label} must not contain symbol keys`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || descriptor.enumerable !== true ||
        !Object.hasOwn(descriptor, "value")) {
      fail(`${label}.${key} must be an enumerable data property`);
    }
  }
  return keys;
}

export function assertCanonicalJsonShape(value, label = "$") {
  if (value === null || typeof value === "string" ||
      typeof value === "boolean") return true;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label} has a non-finite number`);
    return true;
  }
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      fail(`${label} has a custom array prototype`);
    }
    const ownKeys = Reflect.ownKeys(value);
    const expectedKeys = [
      ...Array.from({length: value.length}, (_, index) => String(index)),
      "length",
    ];
    if (ownKeys.some((key) => typeof key !== "string") ||
        JSON.stringify([...ownKeys].sort()) !==
          JSON.stringify(expectedKeys.sort())) {
      fail(`${label} must be a dense array without custom properties`);
    }
    value.forEach((item, index) =>
      assertCanonicalJsonShape(item, `${label}[${index}]`));
    return true;
  }
  if (typeof value === "object") {
    const keys = assertPlainRecord(value, label);
    keys.forEach((key) =>
      assertCanonicalJsonShape(value[key], `${label}.${key}`));
    return true;
  }
  fail(`${label} contains unsupported JSON type ${typeof value}`);
}

function exactKeys(value, keys, label) {
  const actual = assertPlainRecord(value, label);
  if (JSON.stringify([...actual].sort()) !==
      JSON.stringify([...keys].sort())) {
    fail(`${label} has unknown or missing fields`);
  }
}
function requireString(value, label) {
  if (typeof value !== "string" || !value) fail(`${label} must be a string`);
  return value;
}
function requireDigest(value, label) {
  if (!HEX_64.test(requireString(value, label))) {
    fail(`${label} must be a lowercase SHA-256 digest`);
  }
}
function requireGitSha(value, label) {
  if (!GIT_SHA.test(requireString(value, label))) {
    fail(`${label} must be a lowercase 40-character Git SHA`);
  }
}
function requireUtc(value, label) {
  requireString(value, label);
  try {
    return parseExactRfc3339UtcNanoseconds(value, label);
  } catch {
    fail(`${label} must be an exact RFC3339 UTC timestamp`);
  }
}
function exactTimestampNanoseconds(value, label) {
  return requireUtc(value, label).epochNanoseconds;
}
function exactCurrentTimeNanoseconds(currentTimeMs, currentTimestamp) {
  if (currentTimestamp !== undefined) {
    return exactTimestampNanoseconds(
        currentTimestamp,
        "currentTimestamp",
    );
  }
  if (!Number.isSafeInteger(currentTimeMs)) {
    fail("currentTimeMs must be a safe integer");
  }
  return BigInt(currentTimeMs) * NANOSECONDS_PER_MILLISECOND;
}
function exactTimestampDigestRecord(value, label) {
  const parsed = requireUtc(value, label);
  return {
    originalTimestamp: parsed.originalTimestamp,
    epochNanoseconds: parsed.epochNanosecondsDecimal,
    fractionalDigitCount: parsed.fractionalDigitCount,
  };
}
function latestUtcTimestamp(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    fail(`${label} timestamps are missing`);
  }
  values.forEach((value, index) =>
    requireUtc(value, `${label}[${index}]`));
  return values.reduce((latest, current) =>
    exactTimestampNanoseconds(current, `${label}.current`) >
      exactTimestampNanoseconds(latest, `${label}.latest`) ?
      current :
      latest);
}
function exactArray(actual, expected, label) {
  if (!Array.isArray(actual) || new Set(actual).size !== actual.length ||
      JSON.stringify([...actual].sort()) !==
        JSON.stringify([...expected].sort())) {
    fail(`${label} exact set mismatch`);
  }
}

export function stableStringify(value) {
  assertCanonicalJsonShape(value);
  return stableStringifyCanonical(value);
}
function stableStringifyCanonical(value) {
  if (value === null) return "null";
  if (typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStringifyCanonical).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableStringifyCanonical(value[key])}`)
      .join(",")}}`;
}
export function sha256Canonical(value) {
  return crypto.createHash("sha256").update(stableStringify(value)).digest("hex");
}
export function computeProviderAdapterReviewedSourceIdentityDigest(
    identities,
) {
  if (!Array.isArray(identities) ||
      identities.length !== PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS.length) {
    fail("provider reviewed source identities exact count mismatch");
  }
  identities.forEach((identity, index) => {
    exactKeys(identity, ["path", "sha256"],
        `provider reviewed source identities[${index}]`);
    requireDigest(
        identity.sha256,
        `provider reviewed source identities[${index}].sha256`,
    );
  });
  const sorted = identities
      .map(({path, sha256}) => ({path, sha256}))
      .sort((left, right) =>
        left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
  if (new Set(sorted.map(({path}) => path)).size !== sorted.length ||
      stableStringify(sorted.map(({path}) => path)) !==
        stableStringify(PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS)) {
    fail("provider reviewed source identities exact path mismatch");
  }
  return sha256Canonical({
    algorithm: PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM,
    identities: sorted,
    schemaVersion: PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  });
}

export function assertNoSecretOrPii(value, path = "$") {
  if (path === "$") assertCanonicalJsonShape(value);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoSecretOrPii(item, `${path}[${index}]`));
    return true;
  }
  if (!value || typeof value !== "object") {
    if (typeof value === "string" &&
        SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
      fail(`secret-like value at ${path}`);
    }
    return true;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key !== "nextPageTokenExhausted" && SECRET_KEY_PATTERN.test(key)) {
      fail(`secret-bearing key at ${path}.${key}`);
    }
    if (/^(?:userEmail|displayName|phone|studentName|teacherName|rawDocument)$/i
        .test(key)) fail(`PII-bearing key at ${path}.${key}`);
    assertNoSecretOrPii(child, `${path}.${key}`);
  }
  return true;
}
export function buildEvidenceDigestInput(evidence) {
  assertCanonicalJsonShape(evidence);
  return Object.fromEntries(Object.keys(evidence)
      .filter((key) => key !== "artifactDigest")
      .map((key) => [key, evidence[key]]));
}
export function computeEvidenceArtifactDigest(evidence) {
  return sha256Canonical(buildEvidenceDigestInput(evidence));
}

function validateRelease(release) {
  exactKeys(release, ["runtimeGit", "sha"], "release");
  requireGitSha(release.sha, "release.sha");
  exactKeys(release.runtimeGit,
      [
        "clean", "criticalSources", "criticalSourceSetDigest", "headSha",
        "iamContractSourceIdentity", "iamContractSourceSetDigest",
        "reviewedSourceIdentityDigest", "reviewedSourceSetDigest",
        "reviewedSources", "treeSha",
      ],
      "release.runtimeGit");
  requireGitSha(release.runtimeGit.headSha, "release.runtimeGit.headSha");
  requireGitSha(release.runtimeGit.treeSha, "release.runtimeGit.treeSha");
  requireDigest(release.runtimeGit.criticalSourceSetDigest,
      "release.runtimeGit.criticalSourceSetDigest");
  requireDigest(release.runtimeGit.reviewedSourceIdentityDigest,
      "release.runtimeGit.reviewedSourceIdentityDigest");
  requireDigest(release.runtimeGit.reviewedSourceSetDigest,
      "release.runtimeGit.reviewedSourceSetDigest");
  requireDigest(release.runtimeGit.iamContractSourceSetDigest,
      "release.runtimeGit.iamContractSourceSetDigest");
  exactKeys(release.runtimeGit.iamContractSourceIdentity, [
    "buildScopeContractDigest", "buildScopeContractVersion",
    "privateRuntimeIamContractDigest", "privateRuntimeIamContractVersion",
    "sources",
  ], "release.runtimeGit.iamContractSourceIdentity");
  const iamContractSourceIdentity =
    release.runtimeGit.iamContractSourceIdentity;
  if (iamContractSourceIdentity.privateRuntimeIamContractVersion !==
        PRIVATE_RUNTIME_IAM_CONTRACT_VERSION ||
      iamContractSourceIdentity.privateRuntimeIamContractDigest !==
        PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST ||
      iamContractSourceIdentity.buildScopeContractVersion !==
        BUILD_SCOPE_CONTRACT_VERSION ||
      iamContractSourceIdentity.buildScopeContractDigest !==
        BUILD_SCOPE_CONTRACT_DIGEST ||
      release.runtimeGit.iamContractSourceSetDigest !==
        sha256Canonical(iamContractSourceIdentity)) {
    fail("runtime IAM contract source identity mismatch");
  }
  if (release.runtimeGit.headSha !== release.sha ||
      release.runtimeGit.clean !== true) {
    fail("runtime Git HEAD is stale or tree is not clean");
  }
  if (!Array.isArray(release.runtimeGit.criticalSources)) {
    fail("critical runtime source list is missing");
  }
  const pinByPath = new Map(
      WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile, sha256}) =>
        [sourceFile, sha256]),
  );
  const paths = [];
  for (const source of release.runtimeGit.criticalSources) {
    exactKeys(source, [
      "fileMode", "gitBlobOid", "headSha256", "indexFlags", "path",
      "runtimeSha256",
    ], "critical runtime source");
    requireString(source.path, "critical source path");
    requireGitSha(source.gitBlobOid, `${source.path}.gitBlobOid`);
    requireDigest(source.headSha256, `${source.path}.headSha256`);
    requireDigest(source.runtimeSha256, `${source.path}.runtimeSha256`);
    if (!["100644", "100755"].includes(source.fileMode) ||
        source.indexFlags !== "H" ||
        source.runtimeSha256 !== source.headSha256) {
      fail(`runtime source is not an unskipped regular HEAD blob: ${source.path}`);
    }
    const pinned = pinByPath.get(source.path);
    if (pinned && source.runtimeSha256 !== pinned) {
      fail(`runtime writer source differs from literal pin: ${source.path}`);
    }
    paths.push(source.path);
  }
  exactArray(paths, CRITICAL_RUNTIME_SOURCE_PATHS,
      "critical runtime source coverage");
  if (release.runtimeGit.criticalSourceSetDigest !==
      sha256Canonical(release.runtimeGit.criticalSources)) {
    fail("critical runtime source set digest mismatch");
  }
  const expectedIamContractSources = release.runtimeGit.criticalSources.filter(
      ({path: sourcePath}) => [
        "functions/scripts/academy-functions-build-scope-contract.mjs",
        "functions/scripts/academy-private-runtime-iam-contract.mjs",
      ].includes(sourcePath),
  );
  if (stableStringify(iamContractSourceIdentity.sources) !==
      stableStringify(expectedIamContractSources)) {
    fail("runtime IAM contract source records mismatch");
  }
  if (!Array.isArray(release.runtimeGit.reviewedSources)) {
    fail("reviewed runtime source list is missing");
  }
  const reviewedPins = new Map(
      PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.map(({path: sourcePath,
        sha256}) => [sourcePath, sha256]),
  );
  const reviewedPaths = [];
  for (const source of release.runtimeGit.reviewedSources) {
    exactKeys(source, [
      "fileMode", "gitBlobOid", "headSha256", "indexFlags", "path",
      "runtimeSha256",
    ], "reviewed runtime source");
    requireString(source.path, "reviewed source path");
    requireGitSha(source.gitBlobOid, `${source.path}.gitBlobOid`);
    requireDigest(source.headSha256, `${source.path}.headSha256`);
    requireDigest(source.runtimeSha256, `${source.path}.runtimeSha256`);
    if (!["100644", "100755"].includes(source.fileMode) ||
        source.indexFlags !== "H" ||
        source.runtimeSha256 !== source.headSha256 ||
        reviewedPins.get(source.path) !== source.runtimeSha256) {
      fail(`reviewed source is not an exact pinned regular HEAD blob: ${
        source.path}`);
    }
    reviewedPaths.push(source.path);
  }
  exactArray(reviewedPaths, PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS,
      "reviewed runtime source coverage");
  if (release.runtimeGit.reviewedSourceIdentityDigest !==
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST ||
      release.runtimeGit.reviewedSourceSetDigest !==
        sha256Canonical(release.runtimeGit.reviewedSources)) {
    fail("reviewed runtime source identity digest mismatch");
  }
}

function canonicalObservedSet(items) {
  return [...items].sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)));
}

export function computeObservedSetDigest(items) {
  if (!Array.isArray(items)) fail("observed set must be an array");
  return sha256Canonical(canonicalObservedSet(items));
}

export function validateObservationCompleteness(
    completeness,
    observedItems,
    expectedCount,
    label,
) {
  exactKeys(completeness, [
    "expectedCount", "nextPageTokenExhausted", "observedCount",
    "observedSetDigest", "pageCount", "scanCompletedAt", "scanStartedAt",
    "schemaVersion", "stable", "startSetDigest", "unreachableResources",
    "endSetDigest",
  ], label);
  if (completeness.schemaVersion !== OBSERVATION_COMPLETENESS_VERSION) {
    fail(`${label} schema version mismatch`);
  }
  requireUtc(completeness.scanStartedAt, `${label}.scanStartedAt`);
  requireUtc(completeness.scanCompletedAt, `${label}.scanCompletedAt`);
  if (exactTimestampNanoseconds(
      completeness.scanStartedAt,
      `${label}.scanStartedAt`,
  ) > exactTimestampNanoseconds(
      completeness.scanCompletedAt,
      `${label}.scanCompletedAt`,
  )) {
    fail(`${label} scan timestamps are reversed`);
  }
  if (!Number.isSafeInteger(completeness.pageCount) ||
      completeness.pageCount < 1 ||
      completeness.nextPageTokenExhausted !== true ||
      !Array.isArray(completeness.unreachableResources) ||
      completeness.unreachableResources.length !== 0 ||
      completeness.stable !== true) {
    fail(`${label} is partial, unreachable, or unstable`);
  }
  if (completeness.observedCount !== observedItems.length ||
      completeness.expectedCount !== expectedCount ||
      completeness.observedCount !== completeness.expectedCount) {
    fail(`${label} observed/expected count mismatch`);
  }
  for (const key of [
    "observedSetDigest", "startSetDigest", "endSetDigest",
  ]) {
    requireDigest(completeness[key], `${label}.${key}`);
  }
  const observedSetDigest = computeObservedSetDigest(observedItems);
  if (completeness.observedSetDigest !== observedSetDigest ||
      completeness.startSetDigest !== observedSetDigest ||
      completeness.endSetDigest !== observedSetDigest) {
    fail(`${label} canonical observed set is incomplete or unstable`);
  }
  return observedSetDigest;
}

function validateProviderSourceIdentity(sourceIdentity, label) {
  exactKeys(sourceIdentity, [
    "generation", "md5Hash", "sha256", "size", "type", "value",
  ], label);
  if (!["storage_source", "repository_source", "build_source"]
      .includes(sourceIdentity.type)) {
    fail(`${label}.type is unknown`);
  }
  requireString(sourceIdentity.value, `${label}.value`);
  requireString(sourceIdentity.generation, `${label}.generation`);
  requireString(sourceIdentity.md5Hash, `${label}.md5Hash`);
  requireDigest(sourceIdentity.sha256, `${label}.sha256`);
  requireString(sourceIdentity.size, `${label}.size`);
  if (!/^[A-Za-z0-9+/]{22}==$/.test(sourceIdentity.md5Hash) ||
      !/^(?:0|[1-9][0-9]*)$/.test(sourceIdentity.size) ||
      !/^(?:0|[1-9][0-9]*)$/.test(sourceIdentity.generation) ||
      !sourceIdentity.value.endsWith(`/${sourceIdentity.generation}`)) {
    fail(`${label} immutable storage checksum lineage is malformed`);
  }
}

export function parseRulesResourceIdentity(rules, label = "rules") {
  exactKeys(rules, [
    "completeness", "projectId", "projectNumber", "releaseCreateTime",
    "releaseName", "releaseUpdateTime", "rulesetCreateTime", "rulesetName",
    "rulesetUpdateTime",
  ], label);
  if (rules.projectId !== EXPECTED_PROJECT_ID ||
      rules.projectNumber !== EXPECTED_PROJECT_NUMBER) {
    fail(`${label} does not match the pinned project identity`);
  }
  const rulesetMatch =
    /^projects\/([^/]+)\/rulesets\/([^/]+)$/.exec(
        requireString(rules.rulesetName, `${label}.rulesetName`),
    );
  const releaseMatch =
    /^projects\/([^/]+)\/releases\/(cloud\.firestore)$/.exec(
        requireString(rules.releaseName, `${label}.releaseName`),
    );
  if (!rulesetMatch || !releaseMatch) {
    fail(`${label} has a malformed Rules resource name`);
  }
  if (rulesetMatch[1] !== EXPECTED_PROJECT_ID ||
      releaseMatch[1] !== EXPECTED_PROJECT_ID ||
      rulesetMatch[1] !== releaseMatch[1]) {
    fail(`${label} Rules resources do not match the pinned project identity`);
  }
  for (const field of [
    "releaseCreateTime", "releaseUpdateTime", "rulesetCreateTime",
    "rulesetUpdateTime",
  ]) requireUtc(rules[field], `${label}.${field}`);
  if (exactTimestampNanoseconds(
      rules.releaseCreateTime,
      `${label}.releaseCreateTime`,
  ) > exactTimestampNanoseconds(
      rules.releaseUpdateTime,
      `${label}.releaseUpdateTime`,
  ) ||
      exactTimestampNanoseconds(
          rules.rulesetCreateTime,
          `${label}.rulesetCreateTime`,
      ) > exactTimestampNanoseconds(
          rules.rulesetUpdateTime,
          `${label}.rulesetUpdateTime`,
      )) {
    fail(`${label} provider create/update times are reversed`);
  }
  const observedItems = [{
    projectId: rules.projectId,
    projectNumber: rules.projectNumber,
    releaseCreateTime: rules.releaseCreateTime,
    releaseName: rules.releaseName,
    releaseUpdateTime: rules.releaseUpdateTime,
    rulesetCreateTime: rules.rulesetCreateTime,
    rulesetName: rules.rulesetName,
    rulesetUpdateTime: rules.rulesetUpdateTime,
  }];
  validateObservationCompleteness(
      rules.completeness,
      observedItems,
      1,
      `${label}.completeness`,
  );
  return Object.freeze({
    projectId: rulesetMatch[1],
    projectNumber: EXPECTED_PROJECT_NUMBER,
    rulesetResourceName: rules.rulesetName,
    rulesetId: rulesetMatch[2],
    releaseResourceName: rules.releaseName,
    releaseId: releaseMatch[2],
    releaseCreateTime: rules.releaseCreateTime,
    releaseUpdateTime: rules.releaseUpdateTime,
    rulesetCreateTime: rules.rulesetCreateTime,
    rulesetUpdateTime: rules.rulesetUpdateTime,
  });
}

function validateApprovedRulesLineage(rules, label) {
  exactKeys(rules, [
    "approvedArtifactDigest", "approvedSourceDigest", "releaseName",
    "rulesetName",
  ], label);
  requireDigest(rules.approvedArtifactDigest, `${label}.approvedArtifactDigest`);
  requireDigest(rules.approvedSourceDigest, `${label}.approvedSourceDigest`);
  const rulesetMatch =
    /^projects\/([^/]+)\/rulesets\/([^/]+)$/.exec(rules.rulesetName);
  const releaseMatch =
    /^projects\/([^/]+)\/releases\/(cloud\.firestore)$/.exec(rules.releaseName);
  if (!rulesetMatch || !releaseMatch ||
      rulesetMatch[1] !== EXPECTED_PROJECT_ID ||
      releaseMatch[1] !== EXPECTED_PROJECT_ID) {
    fail(`${label} has malformed or foreign Rules approval lineage`);
  }
}

function functionNameFromTriggerRecord(record, label) {
  const functionId = typeof record.functionId === "string" ?
    record.functionId :
    record.name;
  if (typeof functionId !== "string") {
    fail(`${label} Function name is missing`);
  }
  const fullName =
    /^projects\/[^/]+\/locations\/[^/]+\/functions\/([^/]+)$/.exec(
        functionId,
    );
  return fullName ? fullName[1] : functionId;
}

export function assertHttpCallableRawFunctionRecord(
    record,
    label = "raw Function record",
) {
  try {
    assertPlainRecord(record, label);
  } catch {
    fail("FUNCTION_EVENT_TRIGGER_REVIEW_REQUIRED");
  }
  if (Object.hasOwn(record, "eventTrigger")) {
    fail("FUNCTION_EVENT_TRIGGER_REVIEW_REQUIRED");
  }
  return true;
}

function canonicalTriggerRecord(record, label) {
  const name = functionNameFromTriggerRecord(record, label);
  if (record.triggerContractVersion !==
        FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION ||
      record.triggerContractId !== FUNCTION_HTTP_TRIGGER_CONTRACT_ID ||
      record.triggerContractDigest !== FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST ||
      record.triggerType !== FUNCTION_HTTP_TRIGGER_TYPE ||
      record.eventTriggerAbsent !== true) {
    fail(`${label} HTTP callable trigger evidence mismatch`);
  }
  return {
    name,
    triggerContractVersion: record.triggerContractVersion,
    triggerContractId: record.triggerContractId,
    triggerContractDigest: record.triggerContractDigest,
    triggerType: record.triggerType,
    eventTriggerAbsent: record.eventTriggerAbsent,
  };
}

function triggerAbsenceEvidenceProjection({
  listRawRecordCount,
  listFunctionNameSetDigest,
  getRawRecordCount,
  getFunctionNameSetDigest,
  functionNameSetDigest,
  canonicalInventoryDigest,
}) {
  const listGetParity = {
    listRawRecordCount,
    listFunctionNameSetDigest,
    listEventTriggerOwnPropertyCount: 0,
    getRawRecordCount,
    getFunctionNameSetDigest,
    getEventTriggerOwnPropertyCount: 0,
  };
  return {
    schemaVersion: FUNCTION_TRIGGER_ABSENCE_EVIDENCE_VERSION,
    triggerContractVersion: FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION,
    triggerContractId: FUNCTION_HTTP_TRIGGER_CONTRACT_ID,
    triggerContractDigest: FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST,
    triggerType: FUNCTION_HTTP_TRIGGER_TYPE,
    rawRecordCount: getRawRecordCount,
    eventTriggerOwnPropertyCount: 0,
    listRawRecordCount,
    listFunctionNameSetDigest,
    listEventTriggerOwnPropertyCount: 0,
    getRawRecordCount,
    getFunctionNameSetDigest,
    getEventTriggerOwnPropertyCount: 0,
    listGetParityDigest: sha256Canonical(listGetParity),
    functionNameSetDigest,
    canonicalInventoryDigest,
  };
}

export function buildFunctionTriggerAbsenceEvidence(
    rawGetRecords,
    canonicalRecords = rawGetRecords,
    rawListRecords = rawGetRecords,
) {
  if (!Array.isArray(rawGetRecords) ||
      !Array.isArray(canonicalRecords) ||
      !Array.isArray(rawListRecords)) {
    fail("Function trigger evidence records must be arrays");
  }
  rawListRecords.forEach((record, index) =>
    assertHttpCallableRawFunctionRecord(record, `list Function[${index}]`));
  rawGetRecords.forEach((record, index) =>
    assertHttpCallableRawFunctionRecord(record, `GET Function[${index}]`));
  const listNames = rawListRecords.map((record, index) =>
    functionNameFromTriggerRecord(record, `list Function[${index}]`));
  const getNames = rawGetRecords.map((record, index) =>
    functionNameFromTriggerRecord(record, `GET Function[${index}]`));
  const canonical = canonicalRecords.map((record, index) =>
    canonicalTriggerRecord(record, `canonical Function[${index}]`));
  const canonicalNames = canonical.map(({name}) => name);
  exactArray(
      listNames,
      getNames,
      "list/GET Function trigger keyset",
  );
  exactArray(
      getNames,
      canonicalNames,
      "GET/canonical Function trigger keyset",
  );
  const canonicalInventory = canonicalObservedSet(canonicalRecords);
  const projection = triggerAbsenceEvidenceProjection({
    listRawRecordCount: rawListRecords.length,
    listFunctionNameSetDigest: computeObservedSetDigest(listNames),
    getRawRecordCount: rawGetRecords.length,
    getFunctionNameSetDigest: computeObservedSetDigest(getNames),
    functionNameSetDigest: computeObservedSetDigest(canonicalNames),
    canonicalInventoryDigest: sha256Canonical(canonicalInventory),
  });
  return Object.freeze({
    ...projection,
    triggerAbsenceEvidenceDigest: sha256Canonical(projection),
  });
}

export function validateFunctionTriggerAbsenceEvidence(evidence, records) {
  exactKeys(evidence, [
    "canonicalInventoryDigest",
    "eventTriggerOwnPropertyCount",
    "functionNameSetDigest",
    "getEventTriggerOwnPropertyCount",
    "getFunctionNameSetDigest",
    "getRawRecordCount",
    "listEventTriggerOwnPropertyCount",
    "listFunctionNameSetDigest",
    "listGetParityDigest",
    "listRawRecordCount",
    "rawRecordCount",
    "schemaVersion",
    "triggerAbsenceEvidenceDigest",
    "triggerContractDigest",
    "triggerContractId",
    "triggerContractVersion",
    "triggerType",
  ], "Function trigger absence evidence");
  const expected = buildFunctionTriggerAbsenceEvidence(records, records);
  if (stableStringify(evidence) !== stableStringify(expected)) {
    fail("Function trigger absence evidence mismatch");
  }
  return true;
}

function validateFunctionIdentity(item, label) {
  exactKeys(item, [
    "buildId", "eventTriggerAbsent", "generation", "name", "projectId",
    "providerSourceIdentity", "region", "revisionId", "runtime",
    "runtimeServiceAccount", "triggerContractDigest", "triggerContractId",
    "triggerContractVersion", "triggerType", "updateTime",
  ], label);
  requireString(item.name, `${label}.name`);
  requireString(item.buildId, `${label}.buildId`);
  requireString(item.revisionId, `${label}.revisionId`);
  requireString(item.runtime, `${label}.runtime`);
  requireUtc(item.updateTime, `${label}.updateTime`);
  validateProviderSourceIdentity(
      item.providerSourceIdentity,
      `${label}.providerSourceIdentity`,
  );
  canonicalTriggerRecord(item, label);
  const runtimeMember =
    requireString(item.runtimeServiceAccount, `${label}.runtimeServiceAccount`);
  if (!runtimeMember.startsWith("serviceAccount:") ||
      !runtimeMember.endsWith(".gserviceaccount.com")) {
    fail(`${label}.runtimeServiceAccount is malformed`);
  }
  if (item.projectId !== EXPECTED_PROJECT_ID ||
      item.region !== EXPECTED_FUNCTION_REGION ||
      item.generation !== EXPECTED_FUNCTION_GENERATION) {
    fail(`${label} target metadata mismatch`);
  }
}

function validateFunctionRecords(records, label) {
  if (!Array.isArray(records)) fail(`${label} must be an array`);
  records.forEach((item, index) =>
    validateFunctionIdentity(item, `${label}[${index}]`));
  exactArray(
      records.map(({name}) => name),
      EXPECTED_DEPLOYED_FUNCTION_NAMES,
      `${label} deployed function`,
  );
}

function validateApprovedDeploymentResources(resources, label) {
  exactKeys(resources, [
    "functions", "iamExpectedState", "projectIdentityContractVersion", "projectId",
    "projectNumber", "rules",
  ], label);
  validatePinnedProjectIdentity(resources, label);
  validateApprovedRulesLineage(resources.rules, `${label}.rules`);
  validateFunctionRecords(resources.functions, `${label}.functions`);
  validateApprovedIamExpectedState(
      resources.iamExpectedState,
      `${label}.iamExpectedState`,
  );
}

function validatePinnedProjectIdentity(value, label) {
  if (value.projectIdentityContractVersion !==
        PROJECT_IDENTITY_CONTRACT_VERSION ||
      value.projectId !== EXPECTED_PROJECT_ID ||
      value.projectNumber !== EXPECTED_PROJECT_NUMBER) {
    fail(`${label} does not match the pinned target project identity`);
  }
}

export function expectedIamPrincipalMember(policy) {
  if (policy.memberBinding === "project_number_derived") {
    return `serviceAccount:${EXPECTED_PROJECT_NUMBER}-compute@` +
      "developer.gserviceaccount.com";
  }
  if (policy.memberBinding === "canonical_runtime_contract") {
    if (policy.id === "private_writer_runtime") {
      return WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER;
    }
    if (policy.id === "private_preview_runtime") {
      return PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER;
    }
  }
  if (policy.memberBinding === "approval_receipt_exact") return null;
  fail(`unknown IAM member binding for ${policy.id}`);
}

function validateIamPrincipalSet(
    principals,
    label,
    {requireSnapshotDigest = false} = {},
) {
  if (!Array.isArray(principals)) fail(`${label} must be an array`);
  const expectedById = new Map(
      IAM_PRINCIPAL_POLICY_SCHEMA.map((item) => [item.id, item]),
  );
  const ids = [];
  const members = [];
  const normalized = [];
  principals.forEach((principal, index) => {
    const principalLabel = `${label}[${index}]`;
    exactKeys(principal, [
      "authPermissions", "disposition", "effectivePermissions", "id", "member",
      "semanticRole",
      ...(requireSnapshotDigest ? ["snapshotDigest"] : []),
    ], principalLabel);
    const expected = expectedById.get(principal.id);
    if (!expected) fail(`unknown principal: ${principal.id}`);
    const member = requireString(principal.member, `${principalLabel}.member`);
    const memberAddress = member.slice("serviceAccount:".length);
    const memberAddressParts = memberAddress.split("@");
    if (!member.startsWith("serviceAccount:") ||
        member.includes("*") || member.trim() !== member ||
        [" ", "\t", "\n", "\r"].some((space) => member.includes(space)) ||
        memberAddressParts.length !== 2 ||
        memberAddressParts.some((part) => !part)) {
      fail(`${principalLabel}.member is not an exact full service-account member`);
    }
    const derivedMember = expectedIamPrincipalMember(expected);
    if (derivedMember !== null && member !== derivedMember) {
      fail(`IAM principal ${principal.id} does not match pinned project number`);
    }
    if (requireSnapshotDigest) {
      requireDigest(principal.snapshotDigest, `${principalLabel}.snapshotDigest`);
      const snapshot = {...principal};
      delete snapshot.snapshotDigest;
      if (principal.snapshotDigest !== sha256Canonical(snapshot)) {
        fail(`IAM principal ${principal.id} canonical snapshot digest mismatch`);
      }
    }
    for (const key of ["semanticRole", "disposition"]) {
      if (principal[key] !== expected[key]) {
        fail(`IAM principal ${principal.id} exact ${key} mismatch`);
      }
    }
    exactArray(principal.effectivePermissions,
        expected.effectivePermissions, `${principal.id} effective permissions`);
    exactArray(principal.authPermissions,
        expected.authPermissions, `${principal.id} Auth permissions`);
    const capabilities = deriveCapabilitiesFromEffectivePermissions(
        principal.effectivePermissions,
        principal.authPermissions,
    );
    if (!capabilities.firestoreRead || capabilities.firestoreCreate ||
        capabilities.firestoreUpdate || capabilities.authMutate ||
        (principal.id === "future_reset_executor" ?
          !capabilities.firestoreDelete :
          capabilities.firestoreDelete)) {
      fail(`IAM principal ${principal.id} has writable capability`);
    }
    ids.push(principal.id);
    members.push(principal.member);
    normalized.push({
      id: principal.id,
      member: principal.member,
      semanticRole: principal.semanticRole,
      disposition: principal.disposition,
      effectivePermissions: [...principal.effectivePermissions].sort(),
      authPermissions: [...principal.authPermissions].sort(),
    });
  });
  exactArray(ids, REQUIRED_IAM_PRINCIPAL_IDS, "IAM principal");
  if (new Set(members).size !== members.length) {
    fail(`${label} contains duplicate full members`);
  }
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function expectedFreezeIamContractLineage(executableApproval) {
  return {
    schemaVersion: FREEZE_IAM_CONTRACT_LINEAGE_VERSION,
    privateRuntimeIamContractVersion: PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
    privateRuntimeIamContractDigest: PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
    freezeBindingSetDigest:
      EXPECTED_BINDING_SET_DIGESTS_BY_STATE[FREEZE_ACTIVE_STATE],
    freezePermissionSetDigest:
      EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[FREEZE_ACTIVE_STATE],
    buildScopeContractVersion: BUILD_SCOPE_CONTRACT_VERSION,
    buildScopeContractDigest: BUILD_SCOPE_CONTRACT_DIGEST,
    buildCorePermissionSetDigest: BUILD_CORE_PERMISSION_SET_DIGEST,
    buildResourceBindingSetDigest: BUILD_RESOURCE_BINDING_SET_DIGEST,
    sourceBucketResourceDigest:
      buildCanonicalDigest(APPROVED_SOURCE_BUCKET),
    uploadBucketResourceDigest:
      buildCanonicalDigest(APPROVED_UPLOAD_BUCKET),
    artifactRepositoryResourceDigest:
      buildCanonicalDigest(APPROVED_ARTIFACT_REPOSITORY),
    infrastructureEvidenceDigest: INFRASTRUCTURE_EVIDENCE_DIGEST,
    deployProfileVersion: DEPLOY_PROFILE_VERSION,
    deployProfileDigest: DEPLOY_PROFILE_DIGEST,
    deployPermissionSetDigest: DEPLOY_PERMISSION_SET_DIGEST,
    compensatingControlVersion: COMPENSATING_CONTROL_VERSION,
    compensatingControlDigest: COMPENSATING_CONTROL_DIGEST,
    principalSetDigest: sha256Canonical([
      executableApproval.provisioningPrincipal,
      executableApproval.impersonationPrincipal,
      executableApproval.invokerOperatorPrincipal,
    ].sort()),
    jitWindowDigest: sha256Canonical({
      jitStartsAt: executableApproval.jitStartsAt,
      jitExpiresAt: executableApproval.jitExpiresAt,
    }),
    organizationPolicyContractVersion:
      ORGANIZATION_POLICY_EVIDENCE.contractVersion,
    organizationPolicyObservationStatus:
      ORGANIZATION_POLICY_EVIDENCE.observationStatus,
    organizationPolicyEffectiveDecision:
      ORGANIZATION_POLICY_EVIDENCE.effectiveDecision,
    authoritativeOrganizationPolicyEvidenceDigest:
      ORGANIZATION_POLICY_EVIDENCE.evidenceDigest,
  };
}

export function buildFreezeIamContractLineage(executableApproval) {
  return Object.freeze(expectedFreezeIamContractLineage(executableApproval));
}

function validateFreezeIamContractLineage(lineage, executableApproval) {
  const expected = expectedFreezeIamContractLineage(executableApproval);
  exactKeys(lineage, Object.keys(expected), "freeze IAM contract lineage");
  if (stableStringify(lineage) !== stableStringify(expected)) {
    fail("freeze IAM contract lineage mismatch");
  }
}

function validateApprovalReceipt(receipt, release) {
  exactKeys(receipt, [
    "approvedAt", "expiresAt", "iamPrincipalAllowlist", "localSources",
    "providerDependencyApproval", "freezeIamContractLineage",
    "organizationPolicyLineage",
    "projectId", "projectIdentityContractVersion", "projectNumber", "receiptId",
    "releaseSha", "resources", "runtimeIamActivationApproval",
    "runtimeIamActivationReceipt", "schemaVersion",
  ], "deploymentApprovalReceipt");
  if (receipt.schemaVersion !== DEPLOYMENT_APPROVAL_RECEIPT_VERSION ||
      receipt.releaseSha !== release.sha) {
    fail("deployment approval receipt target or release mismatch");
  }
  validatePinnedProjectIdentity(receipt, "deploymentApprovalReceipt");
  requireDigest(receipt.receiptId, "deploymentApprovalReceipt.receiptId");
  requireUtc(receipt.approvedAt, "deploymentApprovalReceipt.approvedAt");
  requireUtc(receipt.expiresAt, "deploymentApprovalReceipt.expiresAt");
  exactKeys(receipt.localSources,
      [
        "approvedRulesArtifactDigest", "approvedRulesSourceDigest",
        "functionsSha256", "rulesSha256", "writerSourceIdentityDigest",
      ],
      "deploymentApprovalReceipt.localSources");
  Object.entries(receipt.localSources).forEach(([key, value]) =>
    requireDigest(value, `deploymentApprovalReceipt.localSources.${key}`));
  validateApprovedDeploymentResources(receipt.resources,
      "deploymentApprovalReceipt.resources");
  validateProviderDependencyApproval(receipt.providerDependencyApproval);
  validatePrivateRuntimeIamContract();
  validateFunctionsBuildAndDeployContract();
  validateOrganizationPolicyLineageReference(receipt.organizationPolicyLineage);
  if (stableStringify(receipt.organizationPolicyLineage) !==
      stableStringify(buildOrganizationPolicyLineageReference()) ||
      stableStringify(receipt.organizationPolicyLineage) !==
      stableStringify(
          receipt.runtimeIamActivationApproval.organizationPolicyLineage,
      ) ||
      stableStringify(receipt.organizationPolicyLineage) !==
      stableStringify(
          receipt.runtimeIamActivationReceipt.organizationPolicyLineage,
      )) {
    fail("deployment approval Organization Policy lineage mismatch");
  }
  const executionEligible = validateFreezeActivationReceipt(
      receipt.runtimeIamActivationReceipt,
      receipt.runtimeIamActivationApproval,
  );
  validateStateSnapshot(
      receipt.runtimeIamActivationReceipt.after,
      FREEZE_ACTIVE_STATE,
  );
  validateFreezeIamContractLineage(
      receipt.freezeIamContractLineage,
      receipt.runtimeIamActivationApproval,
  );
  if (receipt.runtimeIamActivationApproval.approvedAt !== receipt.approvedAt ||
      receipt.runtimeIamActivationApproval.jitExpiresAt !== receipt.expiresAt ||
      receipt.runtimeIamActivationReceipt.observedAt <
        receipt.runtimeIamActivationApproval.jitStartsAt ||
      receipt.runtimeIamActivationReceipt.observedAt >= receipt.expiresAt) {
    fail("runtime IAM activation chronology is not bound to approval receipt");
  }
  const runtimeByPath = new Map(
      release.runtimeGit.criticalSources.map((source) => [source.path, source]),
  );
  if (receipt.localSources.rulesSha256 !==
        runtimeByPath.get("firestore.rules")?.headSha256 ||
      receipt.localSources.functionsSha256 !==
        runtimeByPath.get("functions/index.js")?.headSha256 ||
      receipt.localSources.writerSourceIdentityDigest !==
        EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST ||
      receipt.localSources.approvedRulesArtifactDigest !==
        receipt.resources.rules.approvedArtifactDigest ||
      receipt.localSources.approvedRulesSourceDigest !==
        receipt.resources.rules.approvedSourceDigest) {
    fail("deployment approval is not bound to exact local release sources");
  }
  validateIamPrincipalSet(
      receipt.iamPrincipalAllowlist,
      "deploymentApprovalReceipt.iamPrincipalAllowlist",
  );
  return executionEligible;
}

const PROVIDER_ADAPTER_METADATA_KEYS =
  Object.freeze(Object.keys(PROVIDER_ADAPTER_METADATA).sort());

function providerAdapterMetadataFrom(value) {
  return Object.fromEntries(
      PROVIDER_ADAPTER_METADATA_KEYS.map((key) => [key, value[key]]),
  );
}

function validateProviderAdapterMetadata(metadata, label) {
  exactKeys(metadata, PROVIDER_ADAPTER_METADATA_KEYS, label);
  if (stableStringify(metadata) !== stableStringify(PROVIDER_ADAPTER_METADATA)) {
    fail(`${label} does not match the exact provider operation contract`);
  }
}

function validateProviderLineageFields(value, label) {
  validateProviderAdapterMetadata(providerAdapterMetadataFrom(value), label);
  if (value.strategy !== "declared_google_auth_library_rest" ||
      value.module !== "google-auth-library") {
    fail(`${label} strategy or module mismatch`);
  }
  requireDigest(value.reviewedSourceDigest, `${label}.reviewedSourceDigest`);
  requireDigest(
      value.reviewedSourceRepositoryRootDigest,
      `${label}.reviewedSourceRepositoryRootDigest`,
  );
  requireDigest(value.reviewedLockDigest, `${label}.reviewedLockDigest`);
  if (value.reviewedSourceDigest !==
      EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST) {
    fail(`${label} reviewed source digest differs from literal source pins`);
  }
}

function validateProviderDependencyApproval(approval) {
  exactKeys(approval, [
    ...PROVIDER_ADAPTER_METADATA_KEYS,
    "module", "reviewedLockDigest", "reviewedSourceDigest",
    "reviewedSourceRepositoryRootDigest", "strategy",
  ], "provider dependency approval");
  if (!PROVIDER_DEPENDENCY_STRATEGIES.includes(approval.strategy)) {
    fail("provider dependency approval strategy is unknown");
  }
  validateProviderLineageFields(approval, "provider dependency approval");
}

export function validateProviderDependencyContract(dependency, approvalReceipt) {
  exactKeys(dependency, [
    ...PROVIDER_ADAPTER_METADATA_KEYS,
    "approvalLineageDigest", "directDependencyReviewed", "module",
    "publicApiOnly", "reviewedLockDigest", "reviewedSourceDigest",
    "reviewedSourceRepositoryRootDigest",
    "schemaVersion", "strategy",
  ], "provider dependency contract");
  if (dependency.schemaVersion !== PROVIDER_DEPENDENCY_CONTRACT_VERSION ||
      !PROVIDER_DEPENDENCY_STRATEGIES.includes(dependency.strategy) ||
      dependency.directDependencyReviewed !== true ||
      dependency.publicApiOnly !== true) {
    fail("provider dependency strategy is unreviewed, transitive, or private");
  }
  if (dependency.module !== "google-auth-library") {
    fail("provider dependency module does not match reviewed strategy");
  }
  validateProviderLineageFields(dependency, "provider dependency contract");
  requireDigest(
      dependency.approvalLineageDigest,
      "provider dependency approvalLineageDigest",
  );
  requireDigest(
      dependency.reviewedSourceDigest,
      "provider dependency reviewedSourceDigest",
  );
  requireDigest(
      dependency.reviewedLockDigest,
      "provider dependency reviewedLockDigest",
  );
  if (!approvalReceipt ||
      dependency.approvalLineageDigest !== sha256Canonical(approvalReceipt) ||
      stableStringify({
        ...providerAdapterMetadataFrom(dependency),
        module: dependency.module,
        reviewedLockDigest: dependency.reviewedLockDigest,
        reviewedSourceDigest: dependency.reviewedSourceDigest,
        reviewedSourceRepositoryRootDigest:
          dependency.reviewedSourceRepositoryRootDigest,
        strategy: dependency.strategy,
      }) !== stableStringify(approvalReceipt.providerDependencyApproval)) {
    fail("provider dependency is not bound to approved source/lock lineage");
  }
}

function validateFunctionProviderObservation(functions, approvedFunctions) {
  exactKeys(functions,
      ["completeness", "guardedExportNames", "records", "triggerEvidence"],
      "provider observation.functions");
  validateFunctionRecords(functions.records, "provider observation functions");
  validateFunctionTriggerAbsenceEvidence(
      functions.triggerEvidence,
      functions.records,
  );
  exactArray(
      functions.guardedExportNames,
      EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
      "guarded function export",
  );
  validateObservationCompleteness(
      functions.completeness,
      functions.records,
      EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
      "provider observation.functions.completeness",
  );
  if (stableStringify(canonicalObservedSet(functions.records)) !==
      stableStringify(canonicalObservedSet(approvedFunctions))) {
    fail("observed Function records differ from approval lineage");
  }
  return Object.freeze({
    resourceUpdateTimes:
      Object.freeze(functions.records.map(({updateTime}) => updateTime)),
    scanCompletedAt: functions.completeness.scanCompletedAt,
  });
}

function validateIamMember(member, approvedMembers, label) {
  requireString(member, label);
  if (member === "allUsers" || member === "allAuthenticatedUsers") {
    return Object.freeze({kind: "public", member});
  }
  const match = /^(serviceAccount|group|user|domain):(.+)$/.exec(member);
  if (!match) fail(`${label} is malformed`);
  const [, kind, identity] = match;
  if (kind === "group") {
    if (!KNOWN_IAM_GROUPS.includes(member)) fail(`${label} is an unknown group`);
    return Object.freeze({kind, member});
  }
  if (kind === "domain" || kind === "user") {
    fail(`${label} uses an unknown user/domain identity`);
  }
  if (!identity.endsWith(".gserviceaccount.com") ||
      !approvedMembers.has(member)) {
    fail(`${label} is an unknown service-account identity`);
  }
  return Object.freeze({kind, member});
}

function validateCondition(condition, label) {
  if (condition === null) return;
  exactKeys(condition, ["description", "expression", "title"], label);
  requireString(condition.expression, `${label}.expression`);
  requireString(condition.title, `${label}.title`);
  if (typeof condition.description !== "string") {
    fail(`${label}.description must be a string`);
  }
}

function iamPolicyDigestInput(iamPolicy) {
  return {
    bindings: iamPolicy.bindings,
    conditionEvaluations: iamPolicy.conditionEvaluations,
    denyEvaluations: iamPolicy.denyEvaluations,
    denyPolicies: iamPolicy.denyPolicies,
    groupExpansions: iamPolicy.groupExpansions,
    impersonationEvidence: iamPolicy.impersonationEvidence,
    permissionUniverse: iamPolicy.permissionUniverse,
    principals: iamPolicy.principals,
    roleDefinitions: iamPolicy.roleDefinitions,
    runtimeServiceAccounts: iamPolicy.runtimeServiceAccounts,
    writablePermissionDerivation: iamPolicy.writablePermissionDerivation,
  };
}

export function computeIamPolicyDigest(iamPolicy) {
  return sha256Canonical(iamPolicyDigestInput(iamPolicy));
}

function taggedIamItems(iamPolicy) {
  return IAM_EVIDENCE_FAMILY_NAMES.flatMap((family) =>
    iamPolicy[family].map((value) => ({family, value})));
}

function approvedIamStateDigestInput(expectedState) {
  return {
    schemaVersion: expectedState.schemaVersion,
    policyDigest: expectedState.policyDigest,
    families: expectedState.families,
    familyDigest: expectedState.familyDigest,
  };
}

export function buildApprovedIamExpectedState(iamPolicy) {
  const families = IAM_EVIDENCE_FAMILY_NAMES.map((name) => ({
    name,
    expectedCount: iamPolicy[name].length,
    digest: computeObservedSetDigest(iamPolicy[name]),
  }));
  const expectedState = {
    schemaVersion: APPROVED_IAM_STATE_CONTRACT_VERSION,
    policyDigest: computeIamPolicyDigest(iamPolicy),
    families,
    familyDigest: sha256Canonical(families),
  };
  return {
    ...expectedState,
    expectedStateDigest: sha256Canonical(
        approvedIamStateDigestInput(expectedState),
    ),
  };
}

function validateApprovedIamExpectedState(expectedState, label) {
  exactKeys(expectedState, [
    "expectedStateDigest", "families", "familyDigest", "policyDigest",
    "schemaVersion",
  ], label);
  if (expectedState.schemaVersion !== APPROVED_IAM_STATE_CONTRACT_VERSION ||
      !Array.isArray(expectedState.families)) {
    fail(`${label} schema mismatch`);
  }
  requireDigest(expectedState.policyDigest, `${label}.policyDigest`);
  requireDigest(expectedState.familyDigest, `${label}.familyDigest`);
  requireDigest(expectedState.expectedStateDigest,
      `${label}.expectedStateDigest`);
  const names = [];
  for (const family of expectedState.families) {
    exactKeys(family, ["digest", "expectedCount", "name"],
        `${label}.family`);
    if (!IAM_EVIDENCE_FAMILY_NAMES.includes(family.name) ||
        !Number.isSafeInteger(family.expectedCount) ||
        family.expectedCount < 0) {
      fail(`${label} has invalid family expectation`);
    }
    requireDigest(family.digest, `${label}.${family.name}.digest`);
    names.push(family.name);
  }
  exactArray(names, IAM_EVIDENCE_FAMILY_NAMES,
      `${label} family`);
  if (expectedState.familyDigest !==
        sha256Canonical(expectedState.families) ||
      expectedState.expectedStateDigest !==
        sha256Canonical(approvedIamStateDigestInput(expectedState))) {
    fail(`${label} canonical digest mismatch`);
  }
}

export function buildIamFamilyCompleteness(iamPolicy, approvedExpectedState) {
  validateApprovedIamExpectedState(
      approvedExpectedState,
      "approved IAM expected state",
  );
  const approvedByName = new Map(
      approvedExpectedState.families.map((family) => [family.name, family]),
  );
  const families = IAM_EVIDENCE_FAMILY_NAMES.map((name) => ({
    name,
    observedCount: iamPolicy[name].length,
    expectedCount: approvedByName.get(name).expectedCount,
    digest: computeObservedSetDigest(iamPolicy[name]),
  }));
  return {
    schemaVersion: IAM_FAMILY_COMPLETENESS_VERSION,
    families,
    familyDigest: sha256Canonical(families),
  };
}

function validateIamFamilyCompleteness(iamPolicy, approvedExpectedState) {
  validateApprovedIamExpectedState(
      approvedExpectedState,
      "approved IAM expected state",
  );
  const approvedByName = new Map(
      approvedExpectedState.families.map((family) => [family.name, family]),
  );
  const coverage = iamPolicy.familyCompleteness;
  exactKeys(
      coverage,
      ["families", "familyDigest", "schemaVersion"],
      "IAM family completeness",
  );
  if (coverage.schemaVersion !== IAM_FAMILY_COMPLETENESS_VERSION ||
      !Array.isArray(coverage.families)) {
    fail("IAM family completeness schema mismatch");
  }
  const names = [];
  for (const family of coverage.families) {
    exactKeys(family,
        ["digest", "expectedCount", "name", "observedCount"],
        "IAM family completeness entry");
    if (!IAM_EVIDENCE_FAMILY_NAMES.includes(family.name)) {
      fail(`IAM family completeness has unknown family: ${family.name}`);
    }
    requireDigest(family.digest, `IAM family ${family.name} digest`);
    const actual = iamPolicy[family.name];
    const approved = approvedByName.get(family.name);
    if (family.observedCount !== actual.length ||
        family.expectedCount !== approved.expectedCount ||
        family.observedCount !== approved.expectedCount ||
        family.digest !== computeObservedSetDigest(actual) ||
        family.digest !== approved.digest) {
      fail(`IAM family completeness mismatch: ${family.name}`);
    }
    names.push(family.name);
  }
  exactArray(names, IAM_EVIDENCE_FAMILY_NAMES, "IAM evidence family");
  requireDigest(coverage.familyDigest, "IAM family completeness digest");
  if (coverage.familyDigest !== sha256Canonical(coverage.families)) {
    fail("IAM family completeness canonical digest mismatch");
  }
}

function validateIamRoleDefinitions(iamPolicy) {
  if (!Array.isArray(iamPolicy.roleDefinitions)) {
    fail("IAM role definitions are missing");
  }
  for (const [index, role] of iamPolicy.roleDefinitions.entries()) {
    exactKeys(role, [
      "deleted", "permissions", "permissionsComplete", "role", "stage",
    ], `IAM roleDefinitions[${index}]`);
    requireString(role.role, `IAM roleDefinitions[${index}].role`);
    if (role.deleted !== false || role.permissionsComplete !== true ||
        role.stage !== "GA") {
      fail("IAM role definition/expansion is incomplete");
    }
    exactArray(
        role.permissions,
        [...new Set(role.permissions)],
        `IAM role ${role.role} permissions`,
    );
    for (const permission of role.permissions) {
      if (!iamPolicy.permissionUniverse.includes(permission)) {
        fail(`IAM role contains unknown permission: ${permission}`);
      }
    }
  }
  const actual = canonicalObservedSet(iamPolicy.roleDefinitions);
  const expected = canonicalObservedSet(REVIEWED_IAM_ROLE_DEFINITIONS);
  if (stableStringify(actual) !== stableStringify(expected)) {
    fail("IAM role definition exact set mismatch");
  }
}

function validateWritablePermissionDerivation(iamPolicy) {
  exactArray(
      iamPolicy.permissionUniverse,
      REVIEWED_PERMISSION_UNIVERSE,
      "IAM permission universe",
  );
  exactKeys(iamPolicy.writablePermissionDerivation, [
    "permissionUniverseDigest", "readOnlyPermissions", "schemaVersion",
    "writablePermissions",
  ], "IAM writable permission derivation");
  const derivation = iamPolicy.writablePermissionDerivation;
  if (derivation.schemaVersion !== WRITABLE_PERMISSION_DERIVATION_VERSION ||
      derivation.permissionUniverseDigest !==
        sha256Canonical([...iamPolicy.permissionUniverse].sort())) {
    fail("IAM writable permission derivation is stale");
  }
  const writable = iamPolicy.permissionUniverse.filter((permission) =>
    REVIEWED_WRITABLE_PERMISSIONS.includes(permission));
  const readOnly = iamPolicy.permissionUniverse.filter((permission) =>
    !REVIEWED_WRITABLE_PERMISSIONS.includes(permission));
  exactArray(derivation.writablePermissions, writable,
      "derived writable permission");
  exactArray(derivation.readOnlyPermissions, readOnly,
      "derived read-only permission");
}

function validateIamRawEvidence(
    iamPolicy,
    approvedPrincipals,
    functions,
    approvedExpectedState,
) {
  exactKeys(iamPolicy, [
    "bindings", "completeness", "conditionEvaluations", "denyEvaluations",
    "denyPolicies", "familyCompleteness", "groupExpansions",
    "impersonationEvidence", "observedAt", "permissionUniverse", "policyDigest",
    "principals", "roleDefinitions", "runtimeServiceAccounts",
    "writablePermissionDerivation",
  ], "provider observation IAM policy");
  requireUtc(iamPolicy.observedAt, "provider IAM observedAt");
  for (const key of [
    "bindings", "conditionEvaluations", "denyEvaluations", "denyPolicies",
    "groupExpansions", "impersonationEvidence", "permissionUniverse",
    "principals", "roleDefinitions", "runtimeServiceAccounts",
  ]) {
    if (!Array.isArray(iamPolicy[key])) fail(`IAM ${key} must be an array`);
  }
  validateWritablePermissionDerivation(iamPolicy);
  validateIamRoleDefinitions(iamPolicy);
  validateFunctionRuntimeServiceAccounts(functions, approvedPrincipals);
  const normalizedPrincipals = validateIamPrincipalSet(
      iamPolicy.principals,
      "provider observation IAM principals",
      {requireSnapshotDigest: true},
  );
  const approvedMembers = new Set(approvedPrincipals.map(({member}) => member));
  const futureExecutorMember = approvedPrincipals.find(
      ({id}) => id === "future_reset_executor",
  )?.member;
  if (!futureExecutorMember) {
    fail("approved inactive future executor member is missing");
  }
  const groupMembers = validateIamGroups(iamPolicy, approvedMembers);
  const roleByName =
    new Map(iamPolicy.roleDefinitions.map((role) => [role.role, role]));
  const activePermissionsByMember = new Map();
  if (iamPolicy.conditionEvaluations.length !== 0) {
    fail("conditional IAM bindings/evaluations are not approved");
  }
  iamPolicy.bindings.forEach((binding, index) => {
    const label = `IAM binding[${index}]`;
    exactKeys(binding, [
      "attachmentPoint", "condition", "inherited", "member", "role",
    ], label);
    if (binding.attachmentPoint !== `projects/${EXPECTED_PROJECT_ID}` ||
        binding.inherited !== false) {
      fail(`${label} has an unapproved inherited or foreign attachment scope`);
    }
    const memberIdentity =
      validateIamMember(binding.member, approvedMembers, `${label}.member`);
    if (binding.condition !== null) {
      fail(`${label} uses an unapproved conditional binding`);
    }
    const role = roleByName.get(binding.role);
    if (!role) fail(`${label} references an unknown role`);
    const writeCapable = role.permissions.some((permission) =>
      REVIEWED_WRITABLE_PERMISSIONS.includes(permission));
    if (writeCapable) {
      fail(`${label} grants an active or conditional write-capable binding`);
    }
    const effectiveMembers = memberIdentity.kind === "group" ?
      groupMembers.get(binding.member) :
      [binding.member];
    if (binding.member === futureExecutorMember ||
        effectiveMembers.includes(futureExecutorMember)) {
      fail("inactive future reset executor has an active IAM binding");
    }
    for (const member of effectiveMembers) {
      if (!approvedMembers.has(member)) continue;
      const permissions =
        activePermissionsByMember.get(member) ?? new Set();
      role.permissions.forEach((permission) => permissions.add(permission));
      activePermissionsByMember.set(member, permissions);
    }
  });
  for (const principal of approvedPrincipals) {
    if (principal.disposition !== "ACTIVE_READ_ONLY") continue;
    exactArray(
        [...(activePermissionsByMember.get(principal.member) ?? [])],
        principal.effectivePermissions,
        `IAM raw permissions for ${principal.id}`,
    );
  }
  const runtimeMembers = [
    BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER,
    WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER,
    PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER,
  ];
  const runtimeBindings = iamPolicy.bindings.filter(({member}) =>
    runtimeMembers.includes(member));
  const runtimePrincipalPermissions = runtimeMembers.map((member) => ({
    member,
    permissions: [...(activePermissionsByMember.get(member) ?? [])].sort(),
  }));
  validateStateSnapshot({
    state: FREEZE_ACTIVE_STATE,
    bindings: runtimeBindings,
    bindingSetDigest: buildRuntimeBindingSetDigest(runtimeBindings),
    principalPermissions: runtimePrincipalPermissions,
    permissionSetDigest:
      buildRuntimePermissionSetDigest(runtimePrincipalPermissions),
  }, FREEZE_ACTIVE_STATE);
  validateIamDenyEvidence(iamPolicy, approvedMembers);
  validateImpersonationEvidence(iamPolicy, approvedMembers);
  validateRuntimeServiceAccounts(
      iamPolicy.runtimeServiceAccounts,
      functions,
  );
  validateIamFamilyCompleteness(iamPolicy, approvedExpectedState);
  requireDigest(iamPolicy.policyDigest, "provider IAM policyDigest");
  if (iamPolicy.policyDigest !== computeIamPolicyDigest(iamPolicy) ||
      iamPolicy.policyDigest !== approvedExpectedState.policyDigest) {
    fail("provider IAM canonical policy digest mismatch");
  }
  const observedItems = taggedIamItems(iamPolicy);
  validateObservationCompleteness(
      iamPolicy.completeness,
      observedItems,
      observedItems.length,
      "provider IAM completeness",
  );
  if (iamPolicy.observedAt !== iamPolicy.completeness.scanCompletedAt) {
    fail("provider IAM observedAt must equal completed exhaustive scan time");
  }
  return Object.freeze({
    normalizedPrincipals,
    approvedExpectedStateDigest: approvedExpectedState.expectedStateDigest,
    approvedFamilyExpectations: Object.freeze(
        approvedExpectedState.families.map((family) =>
          Object.freeze({...family})),
    ),
  });
}

function validateIamGroups(iamPolicy, approvedMembers) {
  const expansions = new Map();
  iamPolicy.groupExpansions.forEach((expansion, index) => {
    const label = `IAM groupExpansions[${index}]`;
    exactKeys(expansion, ["complete", "group", "members", "paths"], label);
    if (!KNOWN_IAM_GROUPS.includes(expansion.group)) {
      fail(`${label} is an unknown group`);
    }
    if (expansion.complete !== true) fail(`${label} is incomplete`);
    if (!Array.isArray(expansion.members) || !Array.isArray(expansion.paths)) {
      fail(`${label} members/paths are missing`);
    }
    exactArray(expansion.members, [...new Set(expansion.members)],
        `${label}.members`);
    for (const member of expansion.members) {
      validateIamMember(member, approvedMembers, `${label}.member`);
      const paths = expansion.paths.filter((item) => item.member === member);
      if (paths.length !== 1) fail(`${label} expansion path is incomplete`);
      exactKeys(paths[0], ["member", "path"], `${label}.path`);
      if (!Array.isArray(paths[0].path) ||
          paths[0].path[0] !== expansion.group ||
          paths[0].path.at(-1) !== member) {
        fail(`${label} expansion path mismatch`);
      }
    }
    expansions.set(expansion.group, expansion);
  });
  for (const binding of iamPolicy.bindings) {
    if (binding.member.startsWith("group:")) {
      if (!KNOWN_IAM_GROUPS.includes(binding.member)) {
        fail("IAM binding contains an unknown group");
      }
      if (!expansions.has(binding.member)) {
        fail("IAM group binding has incomplete expansion");
      }
    }
  }
  return new Map(
      [...expansions].map(([group, expansion]) =>
        [group, expansion.members]),
  );
}

function validateIamDenyEvidence(iamPolicy, approvedMembers) {
  const requiredEvaluations = [];
  iamPolicy.denyPolicies.forEach((policy, policyIndex) => {
    const label = `IAM denyPolicies[${policyIndex}]`;
    exactKeys(policy,
        ["attachmentPoint", "policyName", "rules", "updateTime"], label);
    if (policy.attachmentPoint !== `projects/${EXPECTED_PROJECT_ID}`) {
      fail(`${label} has an unapproved foreign attachment scope`);
    }
    requireString(policy.policyName, `${label}.policyName`);
    requireUtc(policy.updateTime, `${label}.updateTime`);
    if (!Array.isArray(policy.rules)) fail(`${label}.rules must be an array`);
    policy.rules.forEach((rule, ruleIndex) => {
      exactKeys(rule, [
        "condition", "deniedPermissions", "deniedPrincipals",
        "exceptionPermissions", "exceptionPrincipals",
      ], `${label}.rules[${ruleIndex}]`);
      validateCondition(rule.condition, `${label}.rules[${ruleIndex}].condition`);
      for (const field of ["deniedPermissions", "exceptionPermissions"]) {
        if (!Array.isArray(rule[field])) fail(`${label}.${field} is missing`);
        for (const permission of rule[field]) {
          if (!iamPolicy.permissionUniverse.includes(permission)) {
            fail(`${label} contains unknown deny permission`);
          }
        }
      }
      for (const field of ["deniedPrincipals", "exceptionPrincipals"]) {
        if (!Array.isArray(rule[field])) fail(`${label}.${field} is missing`);
        rule[field].forEach((member) =>
          validateIamMember(member, approvedMembers, `${label}.${field}`));
      }
      for (const member of approvedMembers) {
        requiredEvaluations.push({
          member,
          policyName: policy.policyName,
          ruleIndex,
        });
      }
    });
  });
  iamPolicy.denyEvaluations.forEach((evaluation, index) => {
    exactKeys(evaluation, ["matched", "member", "policyName", "ruleIndex"],
        `IAM denyEvaluations[${index}]`);
    if (typeof evaluation.matched !== "boolean" ||
        !Number.isSafeInteger(evaluation.ruleIndex) ||
        !approvedMembers.has(evaluation.member)) {
      fail("IAM deny evaluation mismatch");
    }
    if (evaluation.matched === true) {
      fail("IAM deny condition/effective permission mismatch");
    }
  });
  const identity = (item) =>
    `${item.policyName}\u0000${item.ruleIndex}\u0000${item.member}`;
  exactArray(
      iamPolicy.denyEvaluations.map(identity),
      requiredEvaluations.map(identity),
      "IAM deny evaluation",
  );
}

function validateImpersonationEvidence(iamPolicy, approvedMembers) {
  iamPolicy.impersonationEvidence.forEach((item, index) => {
    const label = `IAM impersonationEvidence[${index}]`;
    exactKeys(item, [
      "allowed", "condition", "permission", "principal",
      "targetServiceAccount",
    ], label);
    validateIamMember(item.principal, approvedMembers, `${label}.principal`);
    validateIamMember(
        item.targetServiceAccount,
        approvedMembers,
        `${label}.targetServiceAccount`,
    );
    validateCondition(item.condition, `${label}.condition`);
    if (item.permission !== "iam.serviceAccounts.getAccessToken" ||
        item.allowed !== false) {
      fail("IAM impersonation evidence permits escalation or is unknown");
    }
  });
}

function validateRuntimeServiceAccounts(runtimeServiceAccounts, functions) {
  runtimeServiceAccounts.forEach((item, index) => {
    exactKeys(item, ["functionName", "member"],
        `IAM runtimeServiceAccounts[${index}]`);
  });
  const expected = functions.map(({name, runtimeServiceAccount}) => ({
    functionName: name,
    member: runtimeServiceAccount,
  }));
  if (stableStringify(canonicalObservedSet(runtimeServiceAccounts)) !==
      stableStringify(canonicalObservedSet(expected))) {
    fail("IAM runtime service-account inventory mismatch");
  }
}

function validateFunctionRuntimeServiceAccounts(functions, approvedPrincipals) {
  const approvedByMember =
    new Map(approvedPrincipals.map((principal) => [principal.member, principal]));
  const expectedByFunction = new Map(
      FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING.map(
          ({functionName, serviceAccountEmail}) => [
            functionName,
            `serviceAccount:${serviceAccountEmail}`,
          ],
      ),
  );
  for (const item of functions) {
    const expectedMember = expectedByFunction.get(item.name);
    const principal = approvedByMember.get(item.runtimeServiceAccount);
    if (!expectedMember || item.runtimeServiceAccount !== expectedMember ||
        !principal ||
        principal.disposition !== "ACTIVE_READ_ONLY" ||
        principal.semanticRole !== "academy_backend_read_only") {
      fail(`Function ${item.name} runtime service account is not approved`);
    }
    exactArray(
        principal.effectivePermissions,
        NON_EXECUTOR_EFFECTIVE_PERMISSIONS,
        `Function ${item.name} runtime service-account permissions`,
    );
    exactArray(
        principal.authPermissions,
        [],
        `Function ${item.name} runtime service-account Auth permissions`,
    );
  }
  exactArray(
      [...expectedByFunction.keys()].sort(),
      EXPECTED_DEPLOYED_FUNCTION_NAMES,
      "canonical runtime function mapping",
  );
}

function validateSchedulerProviderObservation(scheduler) {
  exactKeys(scheduler, ["completeness", "jobs"],
      "provider scheduler observation");
  if (!Array.isArray(scheduler.jobs)) fail("scheduler jobs are missing");
  const expectedByName = new Map(
      SCHEDULER_JOB_ALLOWLIST.map((item) => [item.name, item]),
  );
  scheduler.jobs.forEach((job) => {
    exactKeys(job, [
      "name", "projectId", "region", "state", "target", "updateTime",
    ], "scheduler job");
    const expected = expectedByName.get(job.name);
    if (!expected || ["projectId", "region", "target"].some((key) =>
      job[key] !== expected[key])) {
      fail(`unknown scheduler job or target: ${job.name}`);
    }
    requireUtc(job.updateTime, `${job.name}.updateTime`);
    if (job.state !== "DISABLED") {
      fail(`scheduler job is not disabled: ${job.name}`);
    }
  });
  exactArray(
      scheduler.jobs.map(({name}) => name),
      SCHEDULER_JOB_ALLOWLIST.map(({name}) => name),
      "scheduler job",
  );
  validateObservationCompleteness(
      scheduler.completeness,
      scheduler.jobs,
      SCHEDULER_JOB_ALLOWLIST.length,
      "provider scheduler completeness",
  );
  const latestUpdateTime = latestUtcTimestamp(
      scheduler.jobs.map(({updateTime}) => updateTime),
      "provider scheduler update time",
  );
  if (exactTimestampNanoseconds(
      latestUpdateTime,
      "provider scheduler latest update time",
  ) > exactTimestampNanoseconds(
      scheduler.completeness.scanCompletedAt,
      "provider scheduler scan completed time",
  )) {
    fail("scheduler scan completed before observed DISABLED update");
  }
  return Object.freeze({
    latestUpdateTime,
    scanCompletedAt: scheduler.completeness.scanCompletedAt,
  });
}

const PROVIDER_EXECUTION_TRACE_KEYS = Object.freeze([
  "mockOnly", "operationId", "pageCount", "paginationComplete",
  "recordCount", "transportExecutionId",
]);
export const REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS = Object.freeze([
  "cloudasset.v1.projects.analyzeIamPolicy",
  "cloudbuild.v1.projects.locations.builds.get",
  "cloudfunctions.v2.projects.locations.functions.get",
  "cloudfunctions.v2.projects.locations.functions.list",
  "cloudresourcemanager.v3.projects.get",
  "cloudresourcemanager.v3.projects.getIamPolicy",
  "cloudscheduler.v1.projects.locations.jobs.get",
  "cloudscheduler.v1.projects.locations.jobs.list",
  "firebaserules.v1.projects.releases.get",
  "firebaserules.v1.projects.rulesets.get",
  "iam.v1.projects.roles.get",
  "iam.v1.projects.roles.list",
  "iam.v1.projects.serviceAccounts.get",
  "iam.v1.projects.serviceAccounts.getIamPolicy",
  "iam.v1.projects.serviceAccounts.list",
  "iam.v2.policies.denypolicies.list",
  "run.v2.projects.locations.services.get",
  "run.v2.projects.locations.services.list",
  "run.v2.projects.locations.services.revisions.get",
  "run.v2.projects.locations.services.revisions.list",
  "serviceusage.v1.projects.services.get",
  "storage.v1.buckets.get",
  "storage.v1.objects.getMedia",
  "storage.v1.objects.getMetadata",
]);
const CONDITIONAL_PROVIDER_OBSERVATION_OPERATION_GROUPS = Object.freeze([
  Object.freeze([
    "cloudresourcemanager.v3.folders.get",
    "cloudresourcemanager.v3.folders.getIamPolicy",
  ]),
  Object.freeze([
    "cloudresourcemanager.v3.organizations.get",
    "cloudresourcemanager.v3.organizations.getIamPolicy",
  ]),
  Object.freeze(["iam.v2.policies.denypolicies.get"]),
]);

function assertProviderObservationClassificationInvariant() {
  const conditionalIds =
    CONDITIONAL_PROVIDER_OBSERVATION_OPERATION_GROUPS.flat();
  exactArray(
      PROVIDER_MANDATORY_OPERATION_IDS,
      [...REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS, ...conditionalIds],
      "mandatory provider observation classification",
  );
  exactArray(
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
      ["policytroubleshooter.v3.iam.troubleshoot"],
      "optional diagnostic provider observation classification",
  );
  if (PROVIDER_MANDATORY_OPERATION_COUNT !== 29 ||
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT !== 1) {
    fail("provider observation classification count invariant mismatch");
  }
}

function validateProviderOperationExecution(value, label) {
  exactKeys(value, [
    "actualMutations", "executedOperationCount", "executedOperationIds",
    "executionTrace", "executionTraceCount", "executionTraceDigest",
    "mutationOperationCount",
    "providerOperationAllowlistVersion",
    "providerOperationDescriptorSetDigest",
    "reviewedSourceRepositoryRootDigest", "unknownOperationCount",
  ], label);
  if (value.providerOperationAllowlistVersion !==
        PROVIDER_OPERATION_ALLOWLIST_VERSION ||
      value.providerOperationDescriptorSetDigest !==
        PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST ||
      value.unknownOperationCount !== 0 ||
      value.actualMutations !== 0 ||
      value.mutationOperationCount !== 0 ||
      !Array.isArray(value.executedOperationIds) ||
      !Array.isArray(value.executionTrace)) {
    fail(`${label} operation contract, unknown count, or mutation mismatch`);
  }
  exactArray(
      value.executedOperationIds,
      [...new Set(value.executedOperationIds)],
      `${label}.executedOperationIds`,
  );
  if (value.executedOperationIds.some((operationId) =>
    !PROVIDER_OPERATION_IDS.includes(operationId))) {
    fail(`${label} contains an unknown operation ID`);
  }
  if (REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS.some((operationId) =>
    !value.executedOperationIds.includes(operationId))) {
    fail(`${label} is missing a required provider family operation`);
  }
  const conditionalIds =
    CONDITIONAL_PROVIDER_OBSERVATION_OPERATION_GROUPS.flat();
  if (value.executedOperationIds.some((operationId) =>
    PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS.includes(operationId))) {
    fail(`${label} cannot mix optional diagnostics into mandatory evidence`);
  }
  if (value.executedOperationIds.some((operationId) =>
    !REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS.includes(operationId) &&
    !conditionalIds.includes(operationId))) {
    fail(`${label} contains an operation outside the exact observation subset`);
  }
  for (const group of CONDITIONAL_PROVIDER_OBSERVATION_OPERATION_GROUPS
      .filter((candidate) => candidate.length > 1)) {
    const observedCount = group.filter((operationId) =>
      value.executedOperationIds.includes(operationId)).length;
    if (observedCount !== 0 && observedCount !== group.length) {
      fail(`${label} has incomplete conditional parent observation operations`);
    }
  }
  const traceIds = [];
  const executionIds = [];
  let derivedMutationOperationCount = 0;
  for (const [index, trace] of value.executionTrace.entries()) {
    exactKeys(
        trace,
        PROVIDER_EXECUTION_TRACE_KEYS,
        `${label}.executionTrace[${index}]`,
    );
    if (!PROVIDER_OPERATION_IDS.includes(trace.operationId) ||
        trace.mockOnly !== true ||
        trace.paginationComplete !== true ||
        typeof trace.transportExecutionId !== "string" ||
        !trace.transportExecutionId ||
        !Number.isSafeInteger(trace.pageCount) || trace.pageCount < 1 ||
        !Number.isSafeInteger(trace.recordCount) || trace.recordCount < 0) {
      fail(`${label} has an invalid or incomplete execution trace`);
    }
    traceIds.push(trace.operationId);
    executionIds.push(trace.transportExecutionId);
    const descriptor = PROVIDER_OPERATION_REGISTRY[trace.operationId];
    if (descriptor.readOnlySemantic !== true ||
        !["GET", "POST"].includes(descriptor.method)) {
      derivedMutationOperationCount += 1;
    }
  }
  if (new Set(executionIds).size !== executionIds.length) {
    fail(`${label} contains a duplicate transport execution ID`);
  }
  exactArray(
      value.executedOperationIds,
      [...new Set(traceIds)],
      `${label} trace operation coverage`,
  );
  if (value.executedOperationCount !== value.executedOperationIds.length ||
      value.executionTraceCount !== value.executionTrace.length ||
      value.mutationOperationCount !== derivedMutationOperationCount ||
      value.actualMutations !== derivedMutationOperationCount ||
      value.executionTraceDigest !== sha256Canonical(value.executionTrace)) {
    fail(`${label} execution counts or canonical trace digest mismatch`);
  }
  requireDigest(value.executionTraceDigest, `${label}.executionTraceDigest`);
  requireDigest(
      value.reviewedSourceRepositoryRootDigest,
      `${label}.reviewedSourceRepositoryRootDigest`,
  );
  const mandatoryExecutedOperationIds = value.executedOperationIds.filter(
      (operationId) => PROVIDER_MANDATORY_OPERATION_IDS.includes(operationId),
  );
  return Object.freeze({
    mandatoryExecutedOperationIds:
      Object.freeze(mandatoryExecutedOperationIds),
    mandatoryExecutedOperationCount: mandatoryExecutedOperationIds.length,
  });
}

function validateMockProviderAdapterResultMetadata(metadata, operationExecution) {
  exactKeys(metadata, [
    "actualMutations", "adapterContractVersion", "adapterId",
    "executedOperationCount", "executedOperationIds", "executionTraceCount",
    "executionTraceDigest", "mockOnly", "mutationOperationCount",
    "providerOperationAllowlistVersion",
    "providerOperationDescriptorSetDigest", "reviewedSourceDigest",
    "reviewedSourceIdentities", "reviewedSourceRepositoryRootDigest",
    "unknownOperationCount",
  ], "provider result metadata");
  if (metadata.adapterId !== APPROVED_PROVIDER_ADAPTER_ID ||
      metadata.adapterContractVersion !== PROVIDER_ADAPTER_CONTRACT_VERSION ||
      metadata.mockOnly !== true ||
      metadata.actualMutations !== 0 ||
      metadata.mutationOperationCount !==
        operationExecution.mutationOperationCount ||
      metadata.unknownOperationCount !== 0 ||
      metadata.providerOperationAllowlistVersion !==
        operationExecution.providerOperationAllowlistVersion ||
      metadata.providerOperationDescriptorSetDigest !==
        operationExecution.providerOperationDescriptorSetDigest ||
      metadata.executedOperationCount !==
        operationExecution.executedOperationCount ||
      metadata.executionTraceCount !== operationExecution.executionTraceCount ||
      metadata.executionTraceDigest !== operationExecution.executionTraceDigest ||
      stableStringify(metadata.executedOperationIds) !==
        stableStringify(operationExecution.executedOperationIds) ||
      stableStringify(metadata.reviewedSourceIdentities) !==
        stableStringify(PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES) ||
      metadata.reviewedSourceDigest !==
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST ||
      metadata.reviewedSourceRepositoryRootDigest !==
        operationExecution.reviewedSourceRepositoryRootDigest ||
      computeProviderAdapterReviewedSourceIdentityDigest(
          metadata.reviewedSourceIdentities,
      ) !== metadata.reviewedSourceDigest) {
    fail("provider result metadata parity mismatch");
  }
}

function validateProviderDeploymentVerification(
    evidence,
    providerResult,
) {
  exactKeys(providerResult, [
    "adapterContractVersion", "adapterId", "approvalReceipt", "metadata",
    "observation",
  ], "provider result");
  if (providerResult.adapterId !== APPROVED_PROVIDER_ADAPTER_ID ||
      providerResult.adapterContractVersion !==
        PROVIDER_ADAPTER_CONTRACT_VERSION) {
    fail("provider adapter is not approved");
  }
  if (stableStringify(providerResult.approvalReceipt) !==
      stableStringify(evidence.deploymentApprovalReceipt)) {
    fail("provider approval receipt does not exactly match evidence receipt");
  }
  const observation = providerResult.observation;
  exactKeys(observation, [
    "actualMutations", "adapterContractVersion", "adapterId",
    "adapterMetadata", "dependencyContract", "functions", "iamPolicy",
    "mockOnly", "mutationOperationCount", "observedAt", "operationExecution",
    "projectId",
    "projectIdentityContractVersion", "projectNumber",
    "providerAdapterMetadata", "providerObservationVersion", "rules",
    "scanCompletedAt", "scanStartedAt", "scheduler", "schemaVersion",
    "unknownOperationCount",
  ], "provider observation");
  if (observation.schemaVersion !== PROVIDER_OBSERVATION_VERSION ||
      observation.providerObservationVersion !== PROVIDER_OBSERVATION_VERSION ||
      observation.adapterId !== APPROVED_PROVIDER_ADAPTER_ID ||
      observation.adapterContractVersion !==
        PROVIDER_ADAPTER_CONTRACT_VERSION ||
      observation.mockOnly !== true ||
      observation.actualMutations !== 0 ||
      observation.mutationOperationCount !==
        observation.operationExecution?.mutationOperationCount ||
      observation.unknownOperationCount !== 0) {
    fail("provider observation target or adapter mismatch");
  }
  validatePinnedProjectIdentity(observation, "provider observation");
  requireUtc(observation.scanStartedAt, "provider observation scanStartedAt");
  requireUtc(observation.scanCompletedAt,
      "provider observation scanCompletedAt");
  requireUtc(observation.observedAt, "provider observation observedAt");
  const scanStartedAt = exactTimestampNanoseconds(
      observation.scanStartedAt,
      "provider observation scanStartedAt",
  );
  const scanCompletedAt = exactTimestampNanoseconds(
      observation.scanCompletedAt,
      "provider observation scanCompletedAt",
  );
  const observationObservedAt = exactTimestampNanoseconds(
      observation.observedAt,
      "provider observation observedAt",
  );
  if (scanStartedAt > scanCompletedAt ||
      scanCompletedAt > observationObservedAt) {
    fail("provider observation scan envelope mismatch");
  }
  const operationClassificationBoundary = validateProviderOperationExecution(
      observation.operationExecution,
      "provider observation operation execution",
  );
  validateMockProviderAdapterResultMetadata(
      providerResult.metadata,
      observation.operationExecution,
  );
  if (stableStringify(observation.adapterMetadata) !==
      stableStringify(providerResult.metadata)) {
    fail("provider observation/result adapter metadata mismatch");
  }
  validateProviderAdapterMetadata(
      observation.providerAdapterMetadata,
      "provider observation adapter metadata",
  );
  validateProviderDependencyContract(
      observation.dependencyContract,
      providerResult.approvalReceipt,
  );
  if (providerResult.metadata.reviewedSourceRepositoryRootDigest !==
        observation.operationExecution.reviewedSourceRepositoryRootDigest ||
      providerResult.metadata.reviewedSourceRepositoryRootDigest !==
        observation.dependencyContract.reviewedSourceRepositoryRootDigest ||
      providerResult.metadata.reviewedSourceRepositoryRootDigest !==
        providerResult.approvalReceipt.providerDependencyApproval
            .reviewedSourceRepositoryRootDigest) {
    fail("provider reviewed source repository root parity mismatch");
  }
  const rulesResourceIdentity =
    parseRulesResourceIdentity(observation.rules, "provider observation.rules");
  const approvedRules = evidence.deploymentApprovalReceipt.resources.rules;
  if (observation.rules.releaseName !== approvedRules.releaseName ||
      observation.rules.rulesetName !== approvedRules.rulesetName) {
    fail("observed Rules release/ruleset differ from approval lineage");
  }
  const functionObservation = validateFunctionProviderObservation(
      observation.functions,
      evidence.deploymentApprovalReceipt.resources.functions,
  );
  const iamPolicy = validateIamRawEvidence(
      observation.iamPolicy,
      evidence.deploymentApprovalReceipt.iamPrincipalAllowlist,
      observation.functions.records,
      evidence.deploymentApprovalReceipt.resources.iamExpectedState,
  );
  const approvedIamPrincipals = validateIamPrincipalSet(
      evidence.deploymentApprovalReceipt.iamPrincipalAllowlist,
      "approved IAM principals",
  );
  if (stableStringify(iamPolicy.normalizedPrincipals) !==
      stableStringify(approvedIamPrincipals)) {
    fail("provider IAM principals differ from approved receipt");
  }
  const schedulerTiming =
    validateSchedulerProviderObservation(observation.scheduler);
  const scanCompletedAts = [
    observation.rules.completeness.scanCompletedAt,
    observation.functions.completeness.scanCompletedAt,
    observation.iamPolicy.completeness.scanCompletedAt,
    observation.scheduler.completeness.scanCompletedAt,
  ];
  if (scanCompletedAts.some((value, index) =>
    exactTimestampNanoseconds(value, `sub-observation[${index}] completedAt`) >
      observationObservedAt)) {
    fail("provider observation predates a sub-observation scan completion");
  }
  const functionsScanCompletedAt = exactTimestampNanoseconds(
      observation.functions.completeness.scanCompletedAt,
      "Functions scan completed time",
  );
  if (functionObservation.resourceUpdateTimes.some((value, index) =>
    exactTimestampNanoseconds(value, `Function[${index}] updateTime`) >
      functionsScanCompletedAt)) {
    fail("Functions scan completed before an observed resource update");
  }
  const rulesScanCompletedAt = exactTimestampNanoseconds(
      observation.rules.completeness.scanCompletedAt,
      "Rules scan completed time",
  );
  if ([
    observation.rules.releaseCreateTime,
    observation.rules.releaseUpdateTime,
    observation.rules.rulesetCreateTime,
    observation.rules.rulesetUpdateTime,
  ].some((value, index) =>
    exactTimestampNanoseconds(value, `Rules resource[${index}] time`) >
      rulesScanCompletedAt)) {
    fail("Rules scan completed before an observed resource time");
  }
  if (stableStringify(observation.iamPolicy) !==
        stableStringify(evidence.iamPolicy) ||
      stableStringify(observation.scheduler) !==
        stableStringify(evidence.scheduler)) {
    fail("operator evidence differs from independent provider observation");
  }
  const latestDeploymentScanCompletedAt = latestUtcTimestamp([
    observation.rules.completeness.scanCompletedAt,
    observation.functions.completeness.scanCompletedAt,
  ], "provider deployment scan completion");
  return Object.freeze({
    observedAt: observation.observedAt,
    latestDeploymentObservedAt: latestUtcTimestamp([
      observation.rules.releaseUpdateTime,
      observation.rules.rulesetUpdateTime,
      ...functionObservation.resourceUpdateTimes,
    ], "provider deployment observation"),
    latestDeploymentScanCompletedAt,
    rulesResourceIdentity,
    observationDigest: sha256Canonical(observation),
    approvalReceiptDigest: sha256Canonical(providerResult.approvalReceipt),
    iamPolicy: observation.iamPolicy,
    approvedIamExpectedStateDigest: iamPolicy.approvedExpectedStateDigest,
    approvedIamFamilyExpectations: iamPolicy.approvedFamilyExpectations,
    providerAdapterMetadata: PROVIDER_ADAPTER_METADATA,
    providerAdapterResultMetadata: providerResult.metadata,
    providerOperationExecution: observation.operationExecution,
    operationClassificationBoundary,
    scheduler: observation.scheduler,
    schedulerTiming,
  });
}

export function computeSentinelSnapshotDigest(sentinel) {
  const input = {...sentinel};
  delete input.snapshotDigest;
  return sha256Canonical(input);
}

function validateSentinel(sentinel, verifiedAt) {
  exactKeys(sentinel, [
    "academyId", "capturedAt", "documentPath", "fieldPath", "generation",
    "mode", "projectId", "provider", "schemaVersion", "snapshotDigest",
    "version", "writeFreezeActive", "writerRegistryDigest",
  ], "sentinel");
  if (sentinel.academyId !== EXPECTED_ACADEMY_ID ||
      sentinel.projectId !== EXPECTED_PROJECT_ID ||
      sentinel.schemaVersion !== WRITE_FREEZE_CONTRACT_VERSION ||
      sentinel.mode !== WRITE_FREEZE_SENTINEL_MODE ||
      sentinel.provider !== "firestore.googleapis.com" ||
      sentinel.documentPath !== `academies/${EXPECTED_ACADEMY_ID}` ||
      sentinel.fieldPath !== "resetWriteFreeze") {
    fail("sentinel is not bound to the exact provider/project/academy");
  }
  if (sentinel.writeFreezeActive !== true ||
      !Number.isSafeInteger(sentinel.generation) ||
      sentinel.generation <= 0) fail("sentinel generation is not active");
  requireUtc(sentinel.capturedAt, "sentinel.capturedAt");
  requireUtc(sentinel.version, "sentinel.version");
  requireUtc(verifiedAt, "verifiedAt");
  if (sentinel.version !== sentinel.capturedAt ||
      exactTimestampNanoseconds(
          sentinel.capturedAt,
          "sentinel.capturedAt",
      ) > exactTimestampNanoseconds(verifiedAt, "verifiedAt")) {
    fail("sentinel version/capturedAt is future or self-inconsistent");
  }
  requireDigest(sentinel.snapshotDigest, "sentinel.snapshotDigest");
  requireDigest(sentinel.writerRegistryDigest, "sentinel.writerRegistryDigest");
  if (sentinel.writerRegistryDigest !==
      sha256Canonical(ACADEMY_RESET_WRITE_SURFACE_REGISTRY)) {
    fail("sentinel writer registry digest is stale");
  }
  if (sentinel.snapshotDigest !== computeSentinelSnapshotDigest(sentinel)) {
    fail("sentinel canonical snapshot digest mismatch");
  }
}

function drainTelemetryDigestInput(telemetry) {
  const input = {...telemetry};
  delete input.telemetryDigest;
  return input;
}

export function computeDrainTelemetryDigest(telemetry) {
  return sha256Canonical(drainTelemetryDigestInput(telemetry));
}

function validateDrainTelemetry(
    telemetry,
    sentinel,
    {
      currentTimeMs,
      currentTimestamp,
      freezeExpiresAt,
      schedulerTiming,
      verifiedAt,
    },
) {
  exactKeys(telemetry, [
    "checkpoints", "lastWriterCompletionAt", "lastWriterIngressAt",
    "quietWindowEndedAt", "quietWindowStartedAt", "schedulerStoppedAt",
    "sentinelGeneration", "telemetryDigest",
  ], "drainTelemetry");
  for (const field of [
    "schedulerStoppedAt", "quietWindowStartedAt", "quietWindowEndedAt",
  ]) requireUtc(telemetry[field], `drainTelemetry.${field}`);
  for (const field of ["lastWriterIngressAt", "lastWriterCompletionAt"]) {
    if (telemetry[field] !== null) {
      requireUtc(telemetry[field], `drainTelemetry.${field}`);
    }
  }
  if (telemetry.sentinelGeneration !== sentinel.generation) {
    fail("drain telemetry uses a stale sentinel generation");
  }
  const stopped = exactTimestampNanoseconds(
      telemetry.schedulerStoppedAt,
      "drainTelemetry.schedulerStoppedAt",
  );
  const quietStarted = exactTimestampNanoseconds(
      telemetry.quietWindowStartedAt,
      "drainTelemetry.quietWindowStartedAt",
  );
  const quietEnded = exactTimestampNanoseconds(
      telemetry.quietWindowEndedAt,
      "drainTelemetry.quietWindowEndedAt",
  );
  const verified = exactTimestampNanoseconds(verifiedAt, "verifiedAt");
  const freezeExpires =
    exactTimestampNanoseconds(freezeExpiresAt, "freezeWindow.expiresAt");
  const quietDuration = quietEnded - quietStarted;
  if (exactTimestampNanoseconds(
      schedulerTiming.latestUpdateTime,
      "schedulerTiming.latestUpdateTime",
  ) > stopped ||
      exactTimestampNanoseconds(
          schedulerTiming.scanCompletedAt,
          "schedulerTiming.scanCompletedAt",
      ) > stopped) {
    fail("schedulerStoppedAt predates exact DISABLED provider evidence");
  }
  if (quietStarted < exactTimestampNanoseconds(
      schedulerTiming.scanCompletedAt,
      "schedulerTiming.scanCompletedAt",
  )) {
    fail("drain quiet window starts before scheduler scan completion");
  }
  if (stopped > quietStarted || quietEnded > verified ||
      quietDuration <
        BigInt(MIN_DRAIN_QUIET_WINDOW_SECONDS) * NANOSECONDS_PER_SECOND ||
      quietDuration >
        BigInt(MAX_DRAIN_QUIET_WINDOW_SECONDS) * NANOSECONDS_PER_SECOND) {
    fail("drain telemetry quiet window is insufficient or out of bounds");
  }
  for (const field of ["lastWriterIngressAt", "lastWriterCompletionAt"]) {
    if (telemetry[field] !== null &&
        exactTimestampNanoseconds(
            telemetry[field],
            `drainTelemetry.${field}`,
        ) >= quietStarted) {
      fail(`writer ingress/completion occurred during quiet window: ${field}`);
    }
  }
  if (!Array.isArray(telemetry.checkpoints)) {
    fail("drain telemetry checkpoints are missing");
  }
  const classes = [];
  for (const [index, checkpoint] of telemetry.checkpoints.entries()) {
    const label = `drainTelemetry.checkpoints[${index}]`;
    exactKeys(checkpoint, [
      "checkpointAt", "completionCountDuringQuietWindow",
      "inFlightExecutions", "ingressBlocked",
      "ingressCountDuringQuietWindow", "sentinelGeneration", "writerClass",
    ], label);
    requireUtc(checkpoint.checkpointAt, `${label}.checkpointAt`);
    if (checkpoint.sentinelGeneration !== sentinel.generation) {
      fail(`${label} uses a stale sentinel generation`);
    }
    const checkpointAt = exactTimestampNanoseconds(
        checkpoint.checkpointAt,
        `${label}.checkpointAt`,
    );
    if (checkpointAt < quietEnded ||
        checkpointAt > verified ||
        checkpointAt >
          exactCurrentTimeNanoseconds(currentTimeMs, currentTimestamp) ||
        checkpointAt >= freezeExpires ||
        checkpoint.ingressBlocked !== true ||
        checkpoint.inFlightExecutions !== 0 ||
        checkpoint.ingressCountDuringQuietWindow !== 0 ||
        checkpoint.completionCountDuringQuietWindow !== 0) {
      fail(`${label} is nonzero, stale, or incomplete`);
    }
    classes.push(checkpoint.writerClass);
  }
  exactArray(classes, WRITER_DRAIN_CLASSES, "drain writer class");
  requireDigest(telemetry.telemetryDigest, "drainTelemetry.telemetryDigest");
  if (telemetry.telemetryDigest !== computeDrainTelemetryDigest(telemetry)) {
    fail("drain telemetry canonical digest mismatch");
  }
}

export function deriveCapabilitiesFromEffectivePermissions(
    effectivePermissions,
    authPermissions = [],
) {
  const permissionSet = new Set(effectivePermissions);
  return Object.freeze({
    firestoreRead:
      permissionSet.has("datastore.entities.get") &&
      permissionSet.has("datastore.entities.list"),
    firestoreCreate: permissionSet.has("datastore.entities.create"),
    firestoreUpdate: permissionSet.has("datastore.entities.update"),
    firestoreDelete: permissionSet.has("datastore.entities.delete"),
    authMutate: authPermissions.length > 0,
  });
}
function validateIamPolicy(
    iamPolicy,
    approvedPrincipalAllowlist,
    providerIamPolicy,
) {
  if (stableStringify(iamPolicy) !== stableStringify(providerIamPolicy)) {
    fail("IAM evidence does not exactly match provider IAM observation");
  }
  const evidencePrincipals = validateIamPrincipalSet(
      iamPolicy.principals,
      "IAM evidence principals",
      {requireSnapshotDigest: true},
  );
  const approvedPrincipals = validateIamPrincipalSet(
      approvedPrincipalAllowlist,
      "approved IAM principals",
  );
  const providerPrincipals = validateIamPrincipalSet(
      providerIamPolicy.principals,
      "provider IAM principals",
      {requireSnapshotDigest: true},
  );
  if (stableStringify(evidencePrincipals) !==
        stableStringify(approvedPrincipals) ||
      stableStringify(providerPrincipals) !==
        stableStringify(approvedPrincipals)) {
    fail("IAM evidence/provider principals differ from approved exact allowlist");
  }
  const withBinding = (principals) => principals.map((principal) => ({
    ...principal,
    memberBinding: IAM_PRINCIPAL_POLICY_SCHEMA.find(
        ({id}) => id === principal.id,
    ).memberBinding,
  }));
  const expectedIamPrincipals = withBinding(approvedPrincipals);
  const observedIamPrincipals = withBinding(evidencePrincipals);
  return Object.freeze({
    principalPolicyVersion: IAM_PRINCIPAL_POLICY_VERSION,
    expectedIamPrincipals: Object.freeze(expectedIamPrincipals),
    observedIamPrincipals: Object.freeze(observedIamPrincipals),
    principalPolicyDigest: sha256Canonical(expectedIamPrincipals),
  });
}

export function computeNegativeProbeEvidenceDigest(probeEvidence) {
  const input = {...probeEvidence};
  delete input.evidenceDigest;
  return sha256Canonical(input);
}

function validateNegativeProbes(probes, sentinel) {
  if (!Array.isArray(probes)) fail("negative probes are missing");
  const expectedById = new Map(
      REQUIRED_NEGATIVE_PROBES.map((item) => [item.id, item]),
  );
  const ids = [];
  for (const item of probes) {
    exactKeys(item, [
      "collection", "denialCode", "denied", "entrypoint", "evidenceDigest",
      "id", "layer", "observedAt", "operation", "principalId", "provider",
      "providerAdapterId", "providerGeneration", "providerVersion",
      "sentinelGeneration", "sentinelVersion", "target", "targetAcademyId",
      "targetProjectId",
    ], "negative probe");
    const expected = expectedById.get(item.id);
    if (!expected) fail(`unknown negative probe: ${item.id}`);
    for (const [key, value] of Object.entries(expected)) {
      if (item[key] !== value) {
        fail(`negative probe ${item.id} has invalid ${key}`);
      }
    }
    if (item.sentinelGeneration !== sentinel.generation ||
        item.sentinelVersion !== sentinel.version) {
      fail(`negative probe ${item.id} is not bound to sentinel version`);
    }
    const segments = item.target.split("/");
    if (segments.length !== 2 || segments[0] !== item.collection ||
        !RESET_COLLECTIONS.includes(item.collection) ||
        !segments[1].startsWith(TARGET_PROBE_PREFIX)) {
      fail("negative probe target is not a top-level synthetic document");
    }
    requireUtc(item.observedAt, `${item.id}.observedAt`);
    requireDigest(item.evidenceDigest, `${item.id}.evidenceDigest`);
    if (item.evidenceDigest !== computeNegativeProbeEvidenceDigest(item)) {
      fail(`negative probe ${item.id} canonical evidence digest mismatch`);
    }
    if (item.denied !== true) fail(`negative probe succeeded: ${item.id}`);
    ids.push(item.id);
  }
  exactArray(ids, REQUIRED_NEGATIVE_PROBES.map(({id}) => id),
      "negative probe");
}

function validateBaselineComparison(baseline) {
  exactKeys(baseline, ["comparisonOnly", "digest", "matched"],
      "baselineComparison");
  if (baseline.comparisonOnly !== true) fail("baseline must be comparison-only");
  requireDigest(baseline.digest, "baseline.digest");
  if (baseline.digest !== REQUIRED_COMPARISON_BASELINE_DIGEST) {
    fail("comparison baseline digest is not the required exact baseline");
  }
  if (baseline.matched !== null && typeof baseline.matched !== "boolean") {
    fail("baseline matched must be boolean or null");
  }
}

function validateProofGateStates(gateStates, derivedGateStates) {
  exactKeys(gateStates, PROOF_GATE_KEYS, "gateStates");
  if (stableStringify(gateStates) !== stableStringify(derivedGateStates)) {
    fail("self-reported proof gates differ from derived successful validators");
  }
}

function validateOperationalSafety(operationalSafety) {
  exactKeys(operationalSafety, [
    "actualMutations", "actualWrites", "advisoryOnly", "executorImplemented",
  ], "operationalSafety");
  if (operationalSafety.actualMutations !== 0 ||
      operationalSafety.actualWrites !== 0 ||
      operationalSafety.advisoryOnly !== true ||
      operationalSafety.executorImplemented !== false) {
    fail("contract must remain advisory-only with zero writes and no executor");
  }
}

function validateFreezeTimeline(
    evidence,
    deploymentVerification,
    currentTimeMs,
    currentTimestamp,
) {
  exactKeys(evidence.freezeWindow, ["activatedAt", "expiresAt"],
      "freezeWindow");
  const activated = exactTimestampNanoseconds(
      evidence.freezeWindow.activatedAt,
      "freezeWindow.activatedAt",
  );
  const expires = exactTimestampNanoseconds(
      evidence.freezeWindow.expiresAt,
      "freezeWindow.expiresAt",
  );
  const verified = exactTimestampNanoseconds(
      evidence.verifiedAt,
      "verifiedAt",
  );
  const currentTime =
    exactCurrentTimeNanoseconds(currentTimeMs, currentTimestamp);
  const freezeDuration = expires - activated;
  if (expires <= activated ||
      freezeDuration >
        BigInt(MAX_FREEZE_WINDOW_SECONDS) * NANOSECONDS_PER_SECOND ||
      verified < activated || verified >= expires ||
      currentTime < verified || currentTime >= expires) {
    fail("freeze window is expired, reversed, stale, or exceeds bound");
  }
  const latestDeploymentObservedAt =
    deploymentVerification.latestDeploymentObservedAt;
  const deployment = exactTimestampNanoseconds(
      latestDeploymentObservedAt,
      "latestDeploymentObservedAt",
  );
  const deploymentScanCompleted =
    exactTimestampNanoseconds(
        deploymentVerification.latestDeploymentScanCompletedAt,
        "latestDeploymentScanCompletedAt",
    );
  const sentinel = exactTimestampNanoseconds(
      evidence.sentinel.capturedAt,
      "sentinel.capturedAt",
  );
  const stopped = exactTimestampNanoseconds(
      evidence.drainTelemetry.schedulerStoppedAt,
      "drainTelemetry.schedulerStoppedAt",
  );
  const drained = exactTimestampNanoseconds(
      evidence.drainTelemetry.quietWindowEndedAt,
      "drainTelemetry.quietWindowEndedAt",
  );
  const runtimeIamTransitionObservedAt =
    evidence.deploymentApprovalReceipt.runtimeIamActivationReceipt.observedAt;
  const runtimeIamTransition =
    exactTimestampNanoseconds(
        runtimeIamTransitionObservedAt,
        "runtimeIamActivationReceipt.observedAt",
    );
  const iam = exactTimestampNanoseconds(
      evidence.iamPolicy.observedAt,
      "iamPolicy.observedAt",
  );
  const probeObservedAts =
    evidence.negativeProbes.map(({observedAt}) => observedAt);
  const negativeProbesCompletedAt =
    latestUtcTimestamp(probeObservedAts, "negative probe observedAt");
  const probes = probeObservedAts.map((value, index) =>
    exactTimestampNanoseconds(value, `negativeProbe[${index}].observedAt`));
  if (deployment > activated || deploymentScanCompleted > activated ||
      activated > sentinel ||
      sentinel > stopped || stopped > drained || drained > iam ||
      runtimeIamTransition < activated || runtimeIamTransition > iam ||
      probes.some((time) => time < iam || time > verified)) {
    fail(
        "activation order must be deployment<=activatedAt<=sentinel<=" +
        "schedulerStopped<=drained<=iamReadOnly<=probes<=verifiedAt",
    );
  }
  if (sentinel - deployment >
      BigInt(MAX_FREEZE_WINDOW_SECONDS) * NANOSECONDS_PER_SECOND) {
    fail("provider deployment observation is stale for this freeze window");
  }
  const receipt = evidence.deploymentApprovalReceipt;
  const approvedAt = exactTimestampNanoseconds(
      receipt.approvedAt,
      "deploymentApprovalReceipt.approvedAt",
  );
  const receiptExpiresAt = exactTimestampNanoseconds(
      receipt.expiresAt,
      "deploymentApprovalReceipt.expiresAt",
  );
  if (approvedAt > activated || receiptExpiresAt <= verified) {
    fail("deployment approval receipt is not valid for verification window");
  }
  const resourceTimestampEntries = [
    ...receipt.resources.functions.map(({updateTime}) => updateTime),
    deploymentVerification.rulesResourceIdentity.releaseCreateTime,
    deploymentVerification.rulesResourceIdentity.releaseUpdateTime,
    deploymentVerification.rulesResourceIdentity.rulesetCreateTime,
    deploymentVerification.rulesResourceIdentity.rulesetUpdateTime,
  ];
  const resourceTimes = resourceTimestampEntries.map((value, index) =>
    exactTimestampNanoseconds(value, `deployedResource[${index}].observedAt`));
  const providerObserved = exactTimestampNanoseconds(
      deploymentVerification.observedAt,
      "providerObservation.observedAt",
  );
  if (providerObserved > verified ||
      resourceTimes.some((time) => time > providerObserved)) {
    fail("provider observation predates deployed immutable resource");
  }
  const exactNanosecondChronology = {
    ...INTEGRATED_CHRONOLOGY_PROFILE,
    profileDigest: sha256Canonical(INTEGRATED_CHRONOLOGY_PROFILE),
    freezeDurationNanoseconds: freezeDuration.toString(),
    stages: [
      ["freezeWindow.activatedAt", evidence.freezeWindow.activatedAt],
      ["freezeWindow.expiresAt", evidence.freezeWindow.expiresAt],
      ["verifiedAt", evidence.verifiedAt],
      ["latestDeploymentObservedAt", latestDeploymentObservedAt],
      [
        "latestDeploymentScanCompletedAt",
        deploymentVerification.latestDeploymentScanCompletedAt,
      ],
      ["sentinel.capturedAt", evidence.sentinel.capturedAt],
      [
        "drainTelemetry.schedulerStoppedAt",
        evidence.drainTelemetry.schedulerStoppedAt,
      ],
      [
        "drainTelemetry.quietWindowEndedAt",
        evidence.drainTelemetry.quietWindowEndedAt,
      ],
      ["runtimeIamActivationReceipt.observedAt",
        runtimeIamTransitionObservedAt],
      ["iamPolicy.observedAt", evidence.iamPolicy.observedAt],
      ...probeObservedAts.map((value, index) =>
        [`negativeProbes[${index}].observedAt`, value]),
      ["deploymentApprovalReceipt.approvedAt", receipt.approvedAt],
      ["deploymentApprovalReceipt.expiresAt", receipt.expiresAt],
      ...resourceTimestampEntries.map((value, index) =>
        [`deployedResources[${index}].observedAt`, value]),
      ["providerObservation.observedAt", deploymentVerification.observedAt],
    ].map(([stage, value]) => ({
      stage,
      ...exactTimestampDigestRecord(value, stage),
    })),
  };
  return Object.freeze({
    chronologyProfileVersion:
      INTEGRATED_CHRONOLOGY_PROFILE.profileVersion,
    exactNanosecondChronology,
    exactNanosecondChronologyDigest:
      sha256Canonical(exactNanosecondChronology),
    latestDeploymentObservedAt,
    latestDeploymentScanCompletedAt:
      deploymentVerification.latestDeploymentScanCompletedAt,
    activatedAt: evidence.freezeWindow.activatedAt,
    sentinelCapturedAt: evidence.sentinel.capturedAt,
    schedulerStoppedAt: evidence.drainTelemetry.schedulerStoppedAt,
    inFlightDrainedAt: evidence.drainTelemetry.quietWindowEndedAt,
    runtimeIamTransitionObservedAt,
    iamReadOnlyAt: evidence.iamPolicy.observedAt,
    negativeProbesCompletedAt,
    verifiedAt: evidence.verifiedAt,
  });
}

function validateWriteFreezeEvidenceContract(
    evidence,
    {currentTimeMs = Date.now(), currentTimestamp, providerResult} = {},
) {
  assertWriteSurfaceRegistry();
  assertProviderOperationRegistry();
  assertProviderOperationClassification();
  assertProviderObservationClassificationInvariant();
  assertReadonlyPermissionManifest();
  assertEffectiveMandatoryPermissionContract();
  assertObserverPrincipalPolicy();
  assertStandaloneProjectObserverProfile(
      STANDALONE_PROJECT_OBSERVER_PROFILE,
  );
  assertNoSecretOrPii(evidence);
  exactKeys(evidence, EXACT_TOP_LEVEL_KEYS, "top-level evidence");
  if (evidence.schemaVersion !== WRITE_FREEZE_CONTRACT_VERSION ||
      evidence.academyId !== EXPECTED_ACADEMY_ID) {
    fail("schema/project/academy exact target mismatch");
  }
  validatePinnedProjectIdentity(evidence, "top-level evidence");
  requireDigest(evidence.artifactDigest, "artifactDigest");
  const artifactDigest = computeEvidenceArtifactDigest(evidence);
  if (artifactDigest !== evidence.artifactDigest) {
    fail("artifact digest mismatch (tamper detected)");
  }
  validateRelease(evidence.release);
  const executionEligible =
    validateApprovalReceipt(evidence.deploymentApprovalReceipt, evidence.release);
  validateOperationalSafety(evidence.operationalSafety);
  if (!providerResult) fail("approved provider adapter result is required");
  const deploymentVerification =
    validateProviderDeploymentVerification(evidence, providerResult);
  validateSentinel(evidence.sentinel, evidence.verifiedAt);
  validateDrainTelemetry(
      evidence.drainTelemetry,
      evidence.sentinel,
      {
        currentTimeMs,
        currentTimestamp,
        freezeExpiresAt: evidence.freezeWindow.expiresAt,
        schedulerTiming: deploymentVerification.schedulerTiming,
        verifiedAt: evidence.verifiedAt,
      },
  );
  const iamVerification = validateIamPolicy(
      evidence.iamPolicy,
      evidence.deploymentApprovalReceipt.iamPrincipalAllowlist,
      deploymentVerification.iamPolicy,
  );
  validateNegativeProbes(evidence.negativeProbes, evidence.sentinel);
  validateBaselineComparison(evidence.baselineComparison);
  const activationChronology =
    validateFreezeTimeline(
        evidence,
        deploymentVerification,
        currentTimeMs,
        currentTimestamp,
    );
  const proofGateStates = Object.freeze(Object.fromEntries(
      PROOF_GATE_KEYS.map((gate) => [gate, true]),
  ));
  validateProofGateStates(evidence.gateStates, proofGateStates);
  return Object.freeze({
    artifactDigest,
    releaseSha: evidence.release.sha,
    freezeIamContractLineage:
      evidence.deploymentApprovalReceipt.freezeIamContractLineage,
    runtimeIamActivationApprovalDigest:
      sha256Canonical(
          evidence.deploymentApprovalReceipt.runtimeIamActivationApproval,
      ),
    runtimeIamActivationReceiptDigest:
      sha256Canonical(
          evidence.deploymentApprovalReceipt.runtimeIamActivationReceipt,
      ),
    writerCount: ACADEMY_RESET_WRITE_SURFACE_REGISTRY.length,
    collectionCount: RESET_COLLECTIONS.length,
    schedulerCount: evidence.scheduler.jobs.length,
    principalCount: evidence.iamPolicy.principals.length,
    negativeProbeCount: evidence.negativeProbes.length,
    providerOperationAllowlistVersion:
      PROVIDER_OPERATION_ALLOWLIST_VERSION,
    providerOperationDescriptorSetDigest:
      PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
    providerOperationClassificationVersion:
      PROVIDER_OPERATION_CLASSIFICATION_VERSION,
    providerOperationClassificationDigest:
      PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
    providerMandatoryOperationIds: PROVIDER_MANDATORY_OPERATION_IDS,
    providerMandatoryOperationCount: PROVIDER_MANDATORY_OPERATION_COUNT,
    providerMandatoryOperationIdsDigest:
      PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
    providerOptionalDiagnosticOperationIds:
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
    providerOptionalDiagnosticOperationCount:
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT,
    providerOptionalDiagnosticOperationIdsDigest:
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
    readonlyPermissionManifestVersion: READONLY_PERMISSION_MANIFEST_VERSION,
    readonlyPermissionManifestDigest: READONLY_PERMISSION_MANIFEST_DIGEST,
    readonlyPermissionOfficialEvidenceSetDigest:
      OFFICIAL_EVIDENCE_SET_DIGEST,
    readonlyPermissionReviewedEvidenceSetDigest:
      REVIEWED_EVIDENCE_SET_DIGEST,
    readonlyPermissionResearchArtifactSha256:
      PERMISSION_RESEARCH_ARTIFACT_SHA256,
    effectiveMandatoryPermissionContractDigest:
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
    topologyProfileVersion:
      STANDALONE_PROJECT_OBSERVER_PROFILE.topologyProfileVersion,
    topologyProfileId:
      STANDALONE_PROJECT_OBSERVER_PROFILE.topologyProfileId,
    topologyEvidence:
      STANDALONE_PROJECT_OBSERVER_PROFILE.topologyEvidence,
    topologyEvidenceDigest:
      STANDALONE_PROJECT_OBSERVER_PROFILE.topologyEvidenceDigest,
    topologyProfileDigest:
      STANDALONE_PROJECT_OBSERVER_PROFILE.profileDigest,
    standaloneOperationExecution:
      STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution,
    standaloneOperationExecutionDigest:
      STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecutionDigest,
    standaloneEffectivePermissions:
      STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions,
    standaloneEffectivePermissionProfileDigest:
      STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissionProfileDigest,
    observerPrincipalPolicy: OBSERVER_PRINCIPAL_POLICY,
    mandatoryRequiredIamPermissions:
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.requiredIamPermissions,
    mandatoryConditionalPermissions:
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.conditionalPermissions,
    mandatoryAuxiliaryPermissions:
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.auxiliaryPermissions,
    mandatoryOauthScopes:
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.oauthScopes,
    mandatoryPermissionSourceOperations:
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.sourceOperations,
    approvedProviderOperationIds: PROVIDER_READ_ONLY_OPERATIONS,
    providerTransport: PROVIDER_TRANSPORT,
    providerAuthDependency: PROVIDER_AUTH_DEPENDENCY,
    providerHttpRuntime: PROVIDER_HTTP_RUNTIME,
    providerAdapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
    noMutationOperationCount: PROVIDER_NO_MUTATION_OPERATION_COUNT,
    providerMockOnly: deploymentVerification
        .providerAdapterResultMetadata.mockOnly,
    actualProviderMutations: deploymentVerification
        .providerAdapterResultMetadata.actualMutations,
    executedProviderOperationIds: deploymentVerification
        .providerOperationExecution.executedOperationIds,
    executedProviderOperationCount: deploymentVerification
        .providerOperationExecution.executedOperationCount,
    providerExecutionTraceCount: deploymentVerification
        .providerOperationExecution.executionTraceCount,
    providerExecutionTraceDigest: deploymentVerification
        .providerOperationExecution.executionTraceDigest,
    mandatoryExecutedProviderOperationIds: deploymentVerification
        .operationClassificationBoundary.mandatoryExecutedOperationIds,
    mandatoryExecutedProviderOperationCount: deploymentVerification
        .operationClassificationBoundary.mandatoryExecutedOperationCount,
    policyAnalysisSource: "mandatory_iam_raw_analysis",
    providerReviewedSourceIdentityDigest: deploymentVerification
        .providerAdapterResultMetadata.reviewedSourceDigest,
    providerReviewedSourceRepositoryRootDigest: deploymentVerification
        .providerAdapterResultMetadata.reviewedSourceRepositoryRootDigest,
    activationChronology,
    proofGateStates,
    organizationPolicyLineage:
      evidence.deploymentApprovalReceipt.organizationPolicyLineage,
    executionEligible,
    publicationEligible: executionEligible,
    ...iamVerification,
    ...deploymentVerification,
  });
}

export function validateWriteFreezeEvidence(
    evidence,
    options = {},
) {
  exactKeys(options, [
    ...(Object.hasOwn(options, "currentTimeMs") ? ["currentTimeMs"] : []),
    ...(Object.hasOwn(options, "currentTimestamp") ?
      ["currentTimestamp"] :
      []),
    "providerRuntimeContext",
  ], "write-freeze validation options");
  const currentTimeMs = options.currentTimeMs ?? Date.now();
  const currentTimestamp = options.currentTimestamp;
  const providerRuntimeContext = options.providerRuntimeContext;
  try {
    assertValidatedProviderRuntimeContext(providerRuntimeContext);
  } catch {
    fail("genuine provider runtime context is required");
  }
  try {
    assertRuntimeGitEvidence(evidence, providerRuntimeContext.runtimeGit);
  } catch (error) {
    fail(error.message);
  }
  if (providerRuntimeContext.headSha !==
        providerRuntimeContext.runtimeGit.headSha ||
      providerRuntimeContext.treeSha !==
        providerRuntimeContext.runtimeGit.treeSha ||
      providerRuntimeContext.criticalSourceSetDigest !==
        providerRuntimeContext.runtimeGit.criticalSourceSetDigest ||
      providerRuntimeContext.reviewedSourceDigest !==
        providerRuntimeContext.runtimeGit.reviewedSourceIdentityDigest ||
      providerRuntimeContext.reviewedSourceSetDigest !==
        providerRuntimeContext.runtimeGit.reviewedSourceSetDigest ||
      stableStringify(providerRuntimeContext.iamContractSourceIdentity) !==
        stableStringify(
            providerRuntimeContext.runtimeGit.iamContractSourceIdentity,
        ) ||
      providerRuntimeContext.iamContractSourceSetDigest !==
        providerRuntimeContext.runtimeGit.iamContractSourceSetDigest) {
    fail("provider runtime context Git/source identity mismatch");
  }
  return validateWriteFreezeEvidenceContract(evidence, {
    currentTimeMs,
    currentTimestamp,
    providerResult: providerRuntimeContext.providerResult,
  });
}

export function buildDeterministicWriteFreezeProof(evidence, options = {}) {
  const validation = validateWriteFreezeEvidence(evidence, options);
  const proofBody = {
    schemaVersion: WRITE_FREEZE_PROOF_VERSION,
    projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    academyId: EXPECTED_ACADEMY_ID,
    releaseSha: validation.releaseSha,
    evidenceArtifactDigest: validation.artifactDigest,
    freezeIamContractLineage: validation.freezeIamContractLineage,
    organizationPolicyLineage: validation.organizationPolicyLineage,
    runtimeIamActivationApprovalDigest:
      validation.runtimeIamActivationApprovalDigest,
    runtimeIamActivationReceiptDigest:
      validation.runtimeIamActivationReceiptDigest,
    providerAdapterId: APPROVED_PROVIDER_ADAPTER_ID,
    providerAdapterContractVersion:
      validation.providerAdapterContractVersion,
    providerOperationAllowlistVersion:
      validation.providerOperationAllowlistVersion,
    providerOperationDescriptorSetDigest:
      validation.providerOperationDescriptorSetDigest,
    providerOperationClassificationVersion:
      validation.providerOperationClassificationVersion,
    providerOperationClassificationDigest:
      validation.providerOperationClassificationDigest,
    providerMandatoryOperationIds:
      validation.providerMandatoryOperationIds,
    providerMandatoryOperationCount:
      validation.providerMandatoryOperationCount,
    providerMandatoryOperationIdsDigest:
      validation.providerMandatoryOperationIdsDigest,
    providerOptionalDiagnosticOperationIds:
      validation.providerOptionalDiagnosticOperationIds,
    providerOptionalDiagnosticOperationCount:
      validation.providerOptionalDiagnosticOperationCount,
    providerOptionalDiagnosticOperationIdsDigest:
      validation.providerOptionalDiagnosticOperationIdsDigest,
    readonlyPermissionManifestVersion:
      validation.readonlyPermissionManifestVersion,
    readonlyPermissionManifestDigest:
      validation.readonlyPermissionManifestDigest,
    readonlyPermissionOfficialEvidenceSetDigest:
      validation.readonlyPermissionOfficialEvidenceSetDigest,
    readonlyPermissionReviewedEvidenceSetDigest:
      validation.readonlyPermissionReviewedEvidenceSetDigest,
    readonlyPermissionResearchArtifactSha256:
      validation.readonlyPermissionResearchArtifactSha256,
    effectiveMandatoryPermissionContractDigest:
      validation.effectiveMandatoryPermissionContractDigest,
    topologyProfileVersion: validation.topologyProfileVersion,
    topologyProfileId: validation.topologyProfileId,
    topologyEvidence: validation.topologyEvidence,
    topologyEvidenceDigest: validation.topologyEvidenceDigest,
    topologyProfileDigest: validation.topologyProfileDigest,
    standaloneOperationExecution:
      validation.standaloneOperationExecution,
    standaloneOperationExecutionDigest:
      validation.standaloneOperationExecutionDigest,
    standaloneEffectivePermissions:
      validation.standaloneEffectivePermissions,
    standaloneEffectivePermissionProfileDigest:
      validation.standaloneEffectivePermissionProfileDigest,
    observerPrincipalPolicy: validation.observerPrincipalPolicy,
    mandatoryRequiredIamPermissions:
      validation.mandatoryRequiredIamPermissions,
    mandatoryConditionalPermissions:
      validation.mandatoryConditionalPermissions,
    mandatoryAuxiliaryPermissions:
      validation.mandatoryAuxiliaryPermissions,
    mandatoryOauthScopes: validation.mandatoryOauthScopes,
    mandatoryPermissionSourceOperations:
      validation.mandatoryPermissionSourceOperations,
    approvedProviderOperationIds:
      validation.approvedProviderOperationIds,
    providerTransport: validation.providerTransport,
    providerAuthDependency: validation.providerAuthDependency,
    providerHttpRuntime: validation.providerHttpRuntime,
    noMutationOperationCount: validation.noMutationOperationCount,
    providerMockOnly: validation.providerMockOnly,
    actualProviderMutations: validation.actualProviderMutations,
    executedProviderOperationIds: validation.executedProviderOperationIds,
    executedProviderOperationCount: validation.executedProviderOperationCount,
    providerExecutionTraceCount: validation.providerExecutionTraceCount,
    providerExecutionTraceDigest: validation.providerExecutionTraceDigest,
    mandatoryExecutedProviderOperationIds:
      validation.mandatoryExecutedProviderOperationIds,
    mandatoryExecutedProviderOperationCount:
      validation.mandatoryExecutedProviderOperationCount,
    policyAnalysisSource: validation.policyAnalysisSource,
    providerReviewedSourceIdentityDigest:
      validation.providerReviewedSourceIdentityDigest,
    runtimeGitTreeSha: options.providerRuntimeContext.treeSha,
    runtimeCriticalSourceSetDigest:
      options.providerRuntimeContext.criticalSourceSetDigest,
    runtimeReviewedSourceSetDigest:
      options.providerRuntimeContext.reviewedSourceSetDigest,
    runtimeIamContractSourceIdentity:
      options.providerRuntimeContext.iamContractSourceIdentity,
    runtimeIamContractSourceSetDigest:
      options.providerRuntimeContext.iamContractSourceSetDigest,
    providerObservationDigest: validation.observationDigest,
    deploymentApprovalReceiptDigest: validation.approvalReceiptDigest,
    rulesResourceIdentity: validation.rulesResourceIdentity,
    providerObservationCompletedAt: validation.observedAt,
    latestDeploymentScanCompletedAt:
      validation.activationChronology.latestDeploymentScanCompletedAt,
    latestDeploymentObservedAt:
      validation.activationChronology.latestDeploymentObservedAt,
    activationChronology: validation.activationChronology,
    writeSurfaceRegistryVersion: WRITE_SURFACE_REGISTRY_VERSION,
    writeSurfaceRegistryDigest:
      sha256Canonical(ACADEMY_RESET_WRITE_SURFACE_REGISTRY),
    writeSourceIdentityCount: WRITE_SOURCE_SHA256_ALLOWLIST.length,
    writeSourceIdentityDigest: EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
    collectionAllowlistDigest: sha256Canonical(RESET_COLLECTIONS),
    writerCount: validation.writerCount,
    collectionCount: validation.collectionCount,
    deployedFunctionCount: EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
    guardedFunctionExportCount: EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length,
    schedulerCount: validation.schedulerCount,
    principalCount: validation.principalCount,
    principalPolicyVersion: validation.principalPolicyVersion,
    principalPolicyDigest: validation.principalPolicyDigest,
    approvedIamExpectedStateDigest:
      validation.approvedIamExpectedStateDigest,
    approvedIamFamilyExpectations:
      validation.approvedIamFamilyExpectations,
    approvedIamExpectedItemCount:
      validation.approvedIamFamilyExpectations.reduce(
          (total, family) => total + family.expectedCount,
          0,
      ),
    expectedIamPrincipals: validation.expectedIamPrincipals,
    observedIamPrincipals: validation.observedIamPrincipals,
    negativeProbeCount: validation.negativeProbeCount,
    verifiedAt: evidence.verifiedAt,
    freezeExpiresAt: evidence.freezeWindow.expiresAt,
    ...validation.proofGateStates,
    actualMutations: 0,
    actualWrites: 0,
    executorImplemented: false,
    executionEligible: false,
    publicationEligible: validation.publicationEligible,
    advisoryOnly: true,
    advisoryPlanWriteFreezeVerifiedUnchanged: true,
    comparisonBaselineDigest: REQUIRED_COMPARISON_BASELINE_DIGEST,
    baselineDigestRole: "comparison_only_not_a_gate",
    unfreezeOrder: UNFREEZE_ORDER,
    rollbackUnfreezeOrder: ROLLBACK_UNFREEZE_ORDER,
  };
  return Object.freeze({
    ...proofBody,
    proofDigest: sha256Canonical(proofBody),
  });
}
