import crypto from "node:crypto";
import {
  DEPLOYMENT_TARGETS,
  FUNCTIONS_IDENTITIES,
  IMMUTABLE_RELEASE_EVIDENCE,
  ORGANIZATION_POLICY_EVIDENCE,
  buildOrganizationPolicyLineageReference,
  computeOrganizationPolicyEvidenceDigest,
  validateOrganizationPolicyEvidence,
  validateOrganizationPolicyLineageReference,
} from "./academy-functions-build-scope-contract.mjs";
import {
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY,
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
  FINAL_STEADY_STATE as FINAL_IAM_MIGRATION_PHASE,
  MIGRATION_AUTHORITY_SCHEMA_VERSION,
  POST_PRIVATE_DEPLOY_PRE_PUBLICATION,
  POST_PROVISIONING_PRE_DEPLOY,
  POST_PUBLICATION_PRE_CLEANUP,
  PRE_PROVISIONING,
  validateFinalIamAudit,
  validateMigrationAuthority,
  validatePhaseEvidence,
  validateRollbackReceipt,
} from "./academy-legacy-iam-migration-contract.mjs";

export const PRIVATE_RUNTIME_IAM_CONTRACT_VERSION =
  "academy_private_runtime_iam.v7";
export const PRIVATE_RUNTIME_IAM_SET_DIGEST_VERSION =
  "academy_private_runtime_iam_set_sha256.v1";
export const FREEZE_ACTIVATION_RECEIPT_VERSION =
  "academy_private_runtime_freeze_activation.v3";
export const UNFREEZE_RESTORATION_RECEIPT_VERSION =
  "academy_private_runtime_unfreeze_restoration.v4";
export const EXECUTABLE_APPROVAL_VERSION =
  "academy_private_runtime_executable_approval.v6";
export const EXACT_CHRONOLOGY_PROFILE_VERSION =
  "academy_private_runtime_exact_chronology.v2";
export const SERVICE_ACCOUNT_KEY_AUDIT_VERSION =
  "academy_private_runtime_service_account_key_audit.v1";
export const OPERATOR_MODE_CONTRACT_VERSION =
  "academy_private_runtime_operator_mode.v1";
export const SINGLE_OPERATOR_CONTROL_MANIFEST_VERSION =
  "academy_private_runtime_single_operator_control_manifest.v2";
export const SINGLE_OPERATOR_PRIVATE_VALIDATION_RECEIPT_VERSION =
  "academy_private_runtime_single_operator_private_validation.v2";
export const SINGLE_OPERATOR_INVOKER_PUBLICATION_RECEIPT_VERSION =
  "academy_private_runtime_single_operator_invoker_publication.v1";
export const SINGLE_OPERATOR_COMPLETION_RECEIPT_VERSION =
  "academy_private_runtime_single_operator_completion.v2";
export const THREE_PERSON_SEPARATION = "THREE_PERSON_SEPARATION";
export const SINGLE_OPERATOR_JIT_V1 = "SINGLE_OPERATOR_JIT_V1";
export const APPROVED_SINGLE_OPERATOR_PRINCIPAL =
  "user:miamidaegu@gmail.com";
export const MAX_JIT_DURATION_NANOSECONDS_DECIMAL = "7200000000000";
export const SINGLE_OPERATOR_MAX_JIT_DURATION_NANOSECONDS_DECIMAL =
  "3600000000000";

export const SINGLE_OPERATOR_EXECUTION_STEPS = deepFreeze([
  "PROVISIONING_PREFLIGHT_AND_BASELINE",
  "SERVICE_ACCOUNT_ROLE_BINDING_PROVISIONING",
  "EFFECTIVE_PERMISSION_AND_KEY_COUNT_AUDIT",
  "DEPLOY_SERVICE_ACCOUNT_IMPERSONATION",
  "PREVIEW_PRIVATE_DEPLOYMENT",
  "ASSIGNMENT_WRITER_PRIVATE_DEPLOYMENT",
  "OUTCOME_WRITER_PRIVATE_DEPLOYMENT",
  "BASELINE_32_AND_FINAL_35_VALIDATION",
  "PRIVATE_VALIDATION_COMPLETION",
  "INVOKER_PUBLICATION_CONFIRMATION",
  "NEW_THREE_SERVICES_PUBLIC_INVOKER",
  "TEMPORARY_ACCESS_REMOVAL",
  "FINAL_PERMISSION_KEY_INVENTORY_AUDIT",
]);
export const SINGLE_OPERATOR_PRIVATE_VALIDATION_STEPS =
  deepFreeze(SINGLE_OPERATOR_EXECUTION_STEPS.slice(0, 9));
export const SINGLE_OPERATOR_COMPLETION_STEPS =
  deepFreeze(SINGLE_OPERATOR_EXECUTION_STEPS.slice(10));
export const SINGLE_OPERATOR_TARGET_FUNCTION_NAMES = deepFreeze(
    DEPLOYMENT_TARGETS.map(({functionName}) => functionName),
);

export const OPERATOR_MODE_AUTHORITY = deepFreeze({
  contractVersion: OPERATOR_MODE_CONTRACT_VERSION,
  authorityBaseReleaseSha:
    "d93ea87b68fa2fb8b9623f418e9a1bf2a3ac1297",
  missingModeDisposition: "REJECT",
  sourceDefaultPrincipalDisposition: "REJECT",
  modes: {
    [THREE_PERSON_SEPARATION]: {
      principalTuple: "THREE_DISTINCT_EXACT_USERS",
      maximumJitDurationNanoseconds:
        MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
      singleOperatorControlManifest: null,
    },
    [SINGLE_OPERATOR_JIT_V1]: {
      principalTuple: "EXACT_APPROVED_SINGLE_USER_REPEATED_THREE_TIMES",
      approvedPrincipal: APPROVED_SINGLE_OPERATOR_PRINCIPAL,
      maximumJitDurationNanoseconds:
        SINGLE_OPERATOR_MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
      controlManifestVersion: SINGLE_OPERATOR_CONTROL_MANIFEST_VERSION,
      orderedSteps: SINGLE_OPERATOR_EXECUTION_STEPS,
      productionApprovalReferenceRequired: true,
      separateInvokerPublicationReceiptRequired: true,
      temporaryAccessRemovalEvidenceRequired: true,
      rollbackManifestRequired: true,
      secureAuditArtifactRequired: true,
    },
  },
});

const EXACT_CHRONOLOGY_PROFILE = deepFreeze({
  profileVersion: EXACT_CHRONOLOGY_PROFILE_VERSION,
  timestampGrammar: "RFC3339_UTC_Z_FRACTION_0_TO_9",
  integerRepresentation: "SIGNED_EPOCH_NANOSECONDS_BASE10",
  maximumJitDurationNanoseconds: MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
  startBoundary: "INCLUSIVE",
  expiryBoundary: "EXCLUSIVE",
  equalStageBoundary: "ALLOWED",
});

export const TARGET_PROJECT_ID = "daegu-miami-production";
export const TARGET_PROJECT_NUMBER = "884850632328";
export const TARGET_PROJECT_RESOURCE = `projects/${TARGET_PROJECT_ID}`;
export const TARGET_DATABASE_ID = "(default)";
export const TARGET_DATABASE_RESOURCE =
  `${TARGET_PROJECT_RESOURCE}/databases/${TARGET_DATABASE_ID}`;
export const TARGET_DATABASE_LOCATION = "asia-northeast3";
export const TARGET_DATABASE_TYPE = "FIRESTORE_NATIVE";
export const TARGET_DATABASE_CMEK_KEY = null;
export const TARGET_DATABASE_DELETE_PROTECTION =
  "DELETE_PROTECTION_DISABLED";

export const STEADY_STATE = "steady_state";
export const FREEZE_ACTIVE_STATE = "freeze_active";
export const PRIVATE_RUNTIME_IAM_STATES =
  deepFreeze([STEADY_STATE, FREEZE_ACTIVE_STATE]);

export const BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL =
  `${TARGET_PROJECT_NUMBER}-compute@developer.gserviceaccount.com`;
export const WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL =
  `academy-private-writer-runtime@${TARGET_PROJECT_ID}.iam.gserviceaccount.com`;
export const PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL =
  `academy-private-preview-rt@${TARGET_PROJECT_ID}.iam.gserviceaccount.com`;
export const BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER =
  `serviceAccount:${BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL}`;
export const WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER =
  `serviceAccount:${WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL}`;
export const PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER =
  `serviceAccount:${PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL}`;

export const WRITER_STEADY_ROLE_ID = "academyPrivateWriterRuntimeV1";
export const READ_ONLY_ROLE_ID = "academyBackendReadOnly";
export const WRITER_STEADY_ROLE =
  `${TARGET_PROJECT_RESOURCE}/roles/${WRITER_STEADY_ROLE_ID}`;
export const READ_ONLY_ROLE =
  `${TARGET_PROJECT_RESOURCE}/roles/${READ_ONLY_ROLE_ID}`;

export const READ_ONLY_DATASTORE_PERMISSIONS = deepFreeze([
  "datastore.databases.get",
  "datastore.entities.get",
  "datastore.entities.list",
]);
export const WRITER_STEADY_DATASTORE_PERMISSIONS = deepFreeze([
  "datastore.databases.get",
  "datastore.entities.create",
  "datastore.entities.get",
  "datastore.entities.list",
  "datastore.entities.update",
]);
export const APPROVED_DATASTORE_PERMISSION_UNIVERSE = deepFreeze([
  ...new Set([
    ...READ_ONLY_DATASTORE_PERMISSIONS,
    ...WRITER_STEADY_DATASTORE_PERMISSIONS,
  ]),
].sort());
export const WRITABLE_DATASTORE_PERMISSIONS = deepFreeze([
  "datastore.entities.create",
  "datastore.entities.update",
]);

export const DEPLOYED_FUNCTION_NAMES = deepFreeze([
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

export const WRITER_RUNTIME_FUNCTION_NAMES = deepFreeze([
  "commitFixedPrivateLessonOutcomeAction",
  "createFixedPrivateLessonAssignment",
].sort());
export const PREVIEW_RUNTIME_FUNCTION_NAMES = deepFreeze([
  "previewFixedPrivateLessonOutcomeAction",
]);
export const BASELINE_RUNTIME_FUNCTION_NAMES = deepFreeze(
    DEPLOYED_FUNCTION_NAMES.filter((functionName) =>
      !WRITER_RUNTIME_FUNCTION_NAMES.includes(functionName) &&
      !PREVIEW_RUNTIME_FUNCTION_NAMES.includes(functionName)),
);

export const FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING = deepFreeze(
    DEPLOYED_FUNCTION_NAMES.map((functionName) => ({
      functionName,
      serviceAccountEmail:
        WRITER_RUNTIME_FUNCTION_NAMES.includes(functionName) ?
          WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL :
          PREVIEW_RUNTIME_FUNCTION_NAMES.includes(functionName) ?
            PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL :
            BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL,
    })),
);

function fail(message) {
  throw new Error(`Academy private runtime IAM contract rejected: ${message}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

export const EXECUTION_PRINCIPAL_RECEIPT_FIELDS = deepFreeze([
  "impersonationPrincipal",
  "invokerOperatorPrincipal",
  "provisioningPrincipal",
]);
export const EXECUTION_SERVICE_ACCOUNT_EMAILS = deepFreeze([
  FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
  FUNCTIONS_IDENTITIES.deployServiceAccount,
  PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL,
].sort());

function assertPlainData(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) {
    fail(`${label} must be a plain object`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string") fail(`${label} contains a symbol key`);
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(`${label}.${key} must be an enumerable data property`);
    }
  }
}

function assertExactKeys(value, keys, label) {
  assertPlainData(value, label);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} exact key set mismatch`);
  }
}

export function canonicalJson(value) {
  if (value === undefined) fail("undefined is not canonical");
  if (value === null) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined || !["string", "number", "boolean"]
        .includes(typeof value)) {
      fail("unsupported canonical value");
    }
    if (typeof value === "number" && !Number.isFinite(value)) {
      fail("non-finite numbers are not canonical");
    }
    return encoded;
  }
  if (Array.isArray(value)) {
    const actualKeys = Reflect.ownKeys(value).sort();
    const expectedKeys = [
      ...Array.from({length: value.length}, (_, index) => String(index)),
      "length",
    ].sort();
    if (!sameStringArrays(actualKeys, expectedKeys)) {
      fail("sparse or custom arrays are not canonical");
    }
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  assertPlainData(value, "canonical object");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

function sameStringArrays(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function normalizedCanonicalSet(values, label) {
  if (!Array.isArray(values)) fail(`${label} must be an array`);
  const byCanonicalValue = new Map();
  for (const value of values) {
    const encoded = canonicalJson(value);
    if (byCanonicalValue.has(encoded)) fail(`${label} contains a duplicate`);
    byCanonicalValue.set(encoded, value);
  }
  return [...byCanonicalValue.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, value]) => value);
}

export function buildCanonicalSetDigest(values, setName = "canonical") {
  if (typeof setName !== "string" || setName.length === 0) {
    fail("setName must be a non-empty string");
  }
  const elements = normalizedCanonicalSet(values, setName);
  return canonicalDigest({
    algorithm: PRIVATE_RUNTIME_IAM_SET_DIGEST_VERSION,
    setName,
    elements,
  });
}

export function buildPermissionSetDigest(permissionRecords) {
  if (!Array.isArray(permissionRecords)) {
    fail("principal_permissions must be an array");
  }
  const normalized = permissionRecords.map((record, index) => {
    assertExactKeys(
        record,
        ["member", "permissions"],
        `principal_permissions[${index}]`,
    );
    if (typeof record.member !== "string" ||
        !Array.isArray(record.permissions) ||
        record.permissions.some((permission) =>
          typeof permission !== "string") ||
        new Set(record.permissions).size !== record.permissions.length) {
      fail(`principal_permissions[${index}] is invalid`);
    }
    return {
      member: record.member,
      permissions: [...record.permissions].sort(),
    };
  });
  return buildCanonicalSetDigest(normalized, "principal_permissions");
}

export function buildBindingSetDigest(bindings) {
  return buildCanonicalSetDigest(bindings, "project_iam_bindings");
}

function binding(member, role) {
  return {
    attachmentPoint: TARGET_PROJECT_RESOURCE,
    member,
    role,
    inherited: false,
    condition: null,
  };
}

function permissionRecord(member, permissions) {
  return {member, permissions: [...permissions].sort()};
}

function expectedBindings(state) {
  return [
    binding(BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER, READ_ONLY_ROLE),
    binding(PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER, READ_ONLY_ROLE),
    binding(
        WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        state === STEADY_STATE ? WRITER_STEADY_ROLE : READ_ONLY_ROLE,
    ),
  ];
}

function expectedPermissionRecords(state) {
  return [
    permissionRecord(
        BASELINE_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        READ_ONLY_DATASTORE_PERMISSIONS,
    ),
    permissionRecord(
        PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        READ_ONLY_DATASTORE_PERMISSIONS,
    ),
    permissionRecord(
        WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER,
        state === STEADY_STATE ?
          WRITER_STEADY_DATASTORE_PERMISSIONS :
          READ_ONLY_DATASTORE_PERMISSIONS,
    ),
  ];
}

export const EXPECTED_BINDINGS_BY_STATE = deepFreeze({
  [STEADY_STATE]: expectedBindings(STEADY_STATE),
  [FREEZE_ACTIVE_STATE]: expectedBindings(FREEZE_ACTIVE_STATE),
});
export const EXPECTED_PERMISSION_SETS_BY_STATE = deepFreeze({
  [STEADY_STATE]: expectedPermissionRecords(STEADY_STATE),
  [FREEZE_ACTIVE_STATE]: expectedPermissionRecords(FREEZE_ACTIVE_STATE),
});
export const EXPECTED_BINDING_SET_DIGESTS_BY_STATE = deepFreeze(
    Object.fromEntries(PRIVATE_RUNTIME_IAM_STATES.map((state) => [
      state,
      buildBindingSetDigest(EXPECTED_BINDINGS_BY_STATE[state]),
    ])),
);
export const EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE = deepFreeze(
    Object.fromEntries(PRIVATE_RUNTIME_IAM_STATES.map((state) => [
      state,
      buildPermissionSetDigest(EXPECTED_PERMISSION_SETS_BY_STATE[state]),
    ])),
);

function contractDigestProjection(contract) {
  const {contractDigest: ignored, ...projection} = contract;
  return projection;
}

const contractWithoutDigest = {
  schemaVersion: PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
  exactChronologyProfile: EXACT_CHRONOLOGY_PROFILE,
  executionPrincipalReceipt: {
    fields: EXECUTION_PRINCIPAL_RECEIPT_FIELDS,
    resolution: "EXACT_RECEIPT_REQUIRED_NO_SOURCE_DEFAULT",
    placeholderDisposition: "REJECT",
    inferredCurrentUserDisposition: "REJECT",
    operatorModeAuthority: OPERATOR_MODE_AUTHORITY,
  },
  serviceAccountKeyAudit: {
    schemaVersion: SERVICE_ACCOUNT_KEY_AUDIT_VERSION,
    serviceAccountEmails: EXECUTION_SERVICE_ACCOUNT_EMAILS,
    requiredUserManagedKeyCount: 0,
  },
  organizationPolicyAuthority: {
    evidence: ORGANIZATION_POLICY_EVIDENCE,
    lineage: buildOrganizationPolicyLineageReference(),
  },
  legacyIamMigrationAuthority: {
    schemaVersion: MIGRATION_AUTHORITY_SCHEMA_VERSION,
    authorityDigest: ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
    phases: ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY.phases,
    legacyBaselineDigest:
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY.legacyBaselineDigest,
  },
  project: {
    projectId: TARGET_PROJECT_ID,
    projectNumber: TARGET_PROJECT_NUMBER,
    resource: TARGET_PROJECT_RESOURCE,
  },
  firestoreDatabase: {
    resource: TARGET_DATABASE_RESOURCE,
    databaseId: TARGET_DATABASE_ID,
    locationId: TARGET_DATABASE_LOCATION,
    type: TARGET_DATABASE_TYPE,
    cmekKeyName: TARGET_DATABASE_CMEK_KEY,
    deleteProtectionState: TARGET_DATABASE_DELETE_PROTECTION,
    iamAttachmentScope: TARGET_PROJECT_RESOURCE,
  },
  states: [...PRIVATE_RUNTIME_IAM_STATES],
  roles: {
    writerSteady: {
      role: WRITER_STEADY_ROLE,
      permissions: [...WRITER_STEADY_DATASTORE_PERMISSIONS],
    },
    readOnly: {
      role: READ_ONLY_ROLE,
      permissions: [...READ_ONLY_DATASTORE_PERMISSIONS],
    },
  },
  runtimeServiceAccounts: {
    baseline: BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL,
    writer: WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL,
    preview: PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  },
  functionRuntimeMapping: FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING,
  expectedBindingsByState: EXPECTED_BINDINGS_BY_STATE,
  expectedPermissionSetsByState: EXPECTED_PERMISSION_SETS_BY_STATE,
  expectedBindingSetDigestsByState: EXPECTED_BINDING_SET_DIGESTS_BY_STATE,
  expectedPermissionSetDigestsByState:
    EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE,
};

export const ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT = deepFreeze({
  ...contractWithoutDigest,
  contractDigest: canonicalDigest(contractWithoutDigest),
});
export const PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST =
  ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT.contractDigest;

function same(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

function assertState(state) {
  if (!PRIVATE_RUNTIME_IAM_STATES.includes(state)) {
    fail(`unknown state ${String(state)}`);
  }
}

export function validateFunctionRuntimeServiceAccountMapping(mapping) {
  if (!Array.isArray(mapping) || mapping.length !== 35) {
    fail("function runtime mapping must contain exactly 35 entries");
  }
  for (const [index, item] of mapping.entries()) {
    assertExactKeys(
        item,
        ["functionName", "serviceAccountEmail"],
        `functionRuntimeMapping[${index}]`,
    );
  }
  const normalized = normalizedCanonicalSet(
      mapping,
      "function runtime mapping",
  );
  const expected = normalizedCanonicalSet(
      FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING,
      "expected function runtime mapping",
  );
  if (!same(normalized, expected) ||
      mapping.some(({functionName}) => functionName === "*" ||
        functionName.toLowerCase() === "default")) {
    fail("function runtime mapping differs from the exact 35-function map");
  }
  return true;
}

export function validatePrivateRuntimeIamContract(
    contract = ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT,
) {
  validateMigrationAuthority();
  assertExactKeys(contract, Object.keys(ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT),
      "contract");
  if (!same(contract, ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT) ||
      contract.contractDigest !==
        canonicalDigest(contractDigestProjection(contract))) {
    fail("contract content or digest mismatch");
  }
  validateFunctionRuntimeServiceAccountMapping(contract.functionRuntimeMapping);
  return true;
}

function assertExactPermissionRecords(records, state, label) {
  if (!Array.isArray(records)) fail(`${label} must be an array`);
  for (const [index, record] of records.entries()) {
    assertExactKeys(record, ["member", "permissions"], `${label}[${index}]`);
    if (!Array.isArray(record.permissions) ||
        new Set(record.permissions).size !== record.permissions.length) {
      fail(`${label}[${index}] has invalid permissions`);
    }
    for (const permission of record.permissions) {
      if (!APPROVED_DATASTORE_PERMISSION_UNIVERSE.includes(permission)) {
        fail(`${label} contains unknown permission ${String(permission)}`);
      }
    }
  }
  const normalized = normalizedCanonicalSet(records, label).map((record) => ({
    member: record.member,
    permissions: [...record.permissions].sort(),
  }));
  const expected = normalizedCanonicalSet(
      EXPECTED_PERMISSION_SETS_BY_STATE[state],
      `expected ${label}`,
  );
  if (!same(normalized, expected)) {
    fail(`${label} differs from exact ${state} permissions`);
  }
}

function assertExactBindings(bindings, state, label) {
  if (!Array.isArray(bindings)) fail(`${label} must be an array`);
  for (const [index, item] of bindings.entries()) {
    assertExactKeys(item, [
      "attachmentPoint", "condition", "inherited", "member", "role",
    ], `${label}[${index}]`);
    if (item.inherited !== false) fail(`${label} contains inherited binding`);
    if (item.condition !== null) fail(`${label} contains conditional binding`);
    if (item.attachmentPoint !== TARGET_PROJECT_RESOURCE) {
      fail(`${label} has a foreign attachment point`);
    }
    if (![READ_ONLY_ROLE, WRITER_STEADY_ROLE].includes(item.role)) {
      fail(`${label} contains unknown role`);
    }
  }
  const actual = normalizedCanonicalSet(bindings, label);
  const expected = normalizedCanonicalSet(
      EXPECTED_BINDINGS_BY_STATE[state],
      `expected ${label}`,
  );
  if (!same(actual, expected)) {
    fail(`${label} differs from exact ${state} bindings`);
  }
}

export function validateStateSnapshot(snapshot, state) {
  assertState(state);
  assertExactKeys(snapshot, [
    "bindingSetDigest",
    "bindings",
    "permissionSetDigest",
    "principalPermissions",
    "state",
  ], `${state} snapshot`);
  if (snapshot.state !== state) fail("snapshot state mismatch");
  assertExactBindings(snapshot.bindings, state, `${state} bindings`);
  assertExactPermissionRecords(
      snapshot.principalPermissions,
      state,
      `${state} principal permissions`,
  );
  const bindingSetDigest = buildBindingSetDigest(snapshot.bindings);
  const permissionSetDigest =
    buildPermissionSetDigest(snapshot.principalPermissions);
  if (snapshot.bindingSetDigest !== bindingSetDigest ||
      snapshot.bindingSetDigest !==
        EXPECTED_BINDING_SET_DIGESTS_BY_STATE[state] ||
      snapshot.permissionSetDigest !== permissionSetDigest ||
      snapshot.permissionSetDigest !==
        EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[state]) {
    fail(`${state} snapshot digest mismatch`);
  }
  return true;
}

export function buildStateSnapshot(state) {
  assertState(state);
  return deepFreeze({
    state,
    bindings: EXPECTED_BINDINGS_BY_STATE[state],
    bindingSetDigest: EXPECTED_BINDING_SET_DIGESTS_BY_STATE[state],
    principalPermissions: EXPECTED_PERMISSION_SETS_BY_STATE[state],
    permissionSetDigest: EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[state],
  });
}

const RFC3339_UTC =
  /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])T([01]\d|2[0-3]):([0-5]\d):([0-5]\d)(?:\.(\d{1,9}))?Z$/;
const PLACEHOLDER =
  /(?:TODO|TBD|REPLACE_ME|<[^>]*>|example\.com|placeholder)/i;
const EMAIL_LOCAL_ATOM = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+$/;
const EMAIL_DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const APPROVAL_PRINCIPAL_KEYS = EXECUTION_PRINCIPAL_RECEIPT_FIELDS;
const EXECUTION_ACTION_KEYS = deepFreeze([
  "actualProvisioningEligible",
  "deploymentApprovalEligible",
  "publicInvokerApprovalEligible",
  "iamMutationCommandPublication",
]);

const NANOSECONDS_PER_SECOND = 1_000_000_000n;
const NANOSECONDS_PER_MILLISECOND = 1_000_000n;
const SECONDS_PER_DAY = 86_400n;
const MAX_JIT_DURATION_NANOSECONDS =
  BigInt(MAX_JIT_DURATION_NANOSECONDS_DECIMAL);
const SINGLE_OPERATOR_MAX_JIT_DURATION_NANOSECONDS =
  BigInt(SINGLE_OPERATOR_MAX_JIT_DURATION_NANOSECONDS_DECIMAL);
const SHA256_HEX = /^[a-f0-9]{64}$/;

function maximumJitDurationNanoseconds(operatorMode) {
  if (operatorMode === THREE_PERSON_SEPARATION) {
    return MAX_JIT_DURATION_NANOSECONDS;
  }
  if (operatorMode === SINGLE_OPERATOR_JIT_V1) {
    return SINGLE_OPERATOR_MAX_JIT_DURATION_NANOSECONDS;
  }
  fail("operator mode is missing or unsupported");
}

export function parseExactUserPrincipal(value) {
  if (typeof value !== "string" || !value.startsWith("user:")) {
    fail("principal must use the exact user: prefix");
  }
  const email = value.slice("user:".length);
  if (email.length < 3 || email.length > 254 ||
      [...email].some((character) => character.codePointAt(0) > 0x7f)) {
    fail("principal email must be strict ASCII and at most 254 characters");
  }
  const at = email.indexOf("@");
  if (at <= 0 || at !== email.lastIndexOf("@") || at === email.length - 1) {
    fail("principal email must contain one non-edge @");
  }
  const localPart = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (localPart.length > 64 ||
      localPart.split(".").some((atom) => !EMAIL_LOCAL_ATOM.test(atom))) {
    fail("principal local-part is not strict ASCII dot-atom");
  }
  const domainLabels = domain.split(".");
  if (domain.startsWith("[") || domain.endsWith(".") ||
      domainLabels.some((label) => !EMAIL_DOMAIN_LABEL.test(label))) {
    fail("principal domain is not a valid ASCII domain");
  }
  return deepFreeze({principal: value, email, localPart, domain});
}

function floorDiv(dividend, divisor) {
  const quotient = dividend / divisor;
  const remainder = dividend % divisor;
  return remainder < 0n ? quotient - 1n : quotient;
}

function daysFromCivil(yearInput, monthInput, dayInput) {
  let year = BigInt(yearInput);
  const month = BigInt(monthInput);
  const day = BigInt(dayInput);
  if (month <= 2n) year -= 1n;
  const era = floorDiv(year, 400n);
  const yearOfEra = year - era * 400n;
  const shiftedMonth = month + (month > 2n ? -3n : 9n);
  const dayOfYear = (153n * shiftedMonth + 2n) / 5n + day - 1n;
  const dayOfEra = yearOfEra * 365n + yearOfEra / 4n -
    yearOfEra / 100n + dayOfYear;
  return era * 146097n + dayOfEra - 719468n;
}

function maximumCalendarDay(year, month) {
  if ([4, 6, 9, 11].includes(month)) return 30;
  if (month !== 2) return 31;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return leap ? 29 : 28;
}

export function parseExactRfc3339UtcNanoseconds(value, label = "timestamp") {
  const match = typeof value === "string" ? RFC3339_UTC.exec(value) : null;
  if (!match) {
    fail(`${label} must be exact RFC3339 UTC`);
  }
  const [
    , yearText, monthText, dayText, hourText, minuteText, secondText,
    fractionalText = "",
  ] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (day > maximumCalendarDay(year, month)) {
    fail(`${label} is not a real timestamp`);
  }
  const wholeSeconds = daysFromCivil(year, month, day) * SECONDS_PER_DAY +
    BigInt(hourText) * 3600n +
    BigInt(minuteText) * 60n +
    BigInt(secondText);
  const fractionalNanoseconds = BigInt(
      (fractionalText || "0").padEnd(9, "0"),
  );
  const epochNanoseconds =
    wholeSeconds * NANOSECONDS_PER_SECOND + fractionalNanoseconds;
  return deepFreeze({
    originalTimestamp: value,
    epochNanoseconds,
    epochNanosecondsDecimal: epochNanoseconds.toString(),
    fractionalDigitCount: fractionalText.length,
  });
}

export function compareExactRfc3339UtcInstants(left, right) {
  const leftNanoseconds =
    parseExactRfc3339UtcNanoseconds(left, "left timestamp").epochNanoseconds;
  const rightNanoseconds =
    parseExactRfc3339UtcNanoseconds(right, "right timestamp").epochNanoseconds;
  return leftNanoseconds < rightNanoseconds ?
    -1 :
    leftNanoseconds > rightNanoseconds ? 1 : 0;
}

export function exactDurationNanoseconds(start, end) {
  return parseExactRfc3339UtcNanoseconds(
      end,
      "duration end",
  ).epochNanoseconds -
    parseExactRfc3339UtcNanoseconds(
        start,
        "duration start",
    ).epochNanoseconds;
}

function timestampDigestRecord(value, label) {
  const parsed = parseExactRfc3339UtcNanoseconds(value, label);
  return {
    originalTimestamp: parsed.originalTimestamp,
    epochNanoseconds: parsed.epochNanosecondsDecimal,
    fractionalDigitCount: parsed.fractionalDigitCount,
  };
}

function approvalChronologyProjection(approval) {
  const jitStartsAt = parseExactRfc3339UtcNanoseconds(
      approval.jitStartsAt,
      "approval.jitStartsAt",
  );
  const jitExpiresAt = parseExactRfc3339UtcNanoseconds(
      approval.jitExpiresAt,
      "approval.jitExpiresAt",
  );
  return {
    profileVersion: EXACT_CHRONOLOGY_PROFILE_VERSION,
    operatorModeContractVersion: OPERATOR_MODE_CONTRACT_VERSION,
    operatorMode: approval.operatorMode,
    maximumJitDurationNanoseconds:
      maximumJitDurationNanoseconds(approval.operatorMode).toString(),
    approvedAt: timestampDigestRecord(
        approval.approvedAt,
        "approval.approvedAt",
    ),
    organizationPolicyEvidenceDigest:
      approval.organizationPolicy?.evidenceDigest,
    organizationPolicyLineageDigest:
      canonicalDigest(approval.organizationPolicyLineage),
    jitStartsAt: timestampDigestRecord(
        approval.jitStartsAt,
        "approval.jitStartsAt",
    ),
    jitExpiresAt: timestampDigestRecord(
        approval.jitExpiresAt,
        "approval.jitExpiresAt",
    ),
    jitDurationNanoseconds:
      (jitExpiresAt.epochNanoseconds -
        jitStartsAt.epochNanoseconds).toString(),
  };
}

function exactCurrentTimeNanoseconds({currentTimeMs, currentTimestamp}) {
  if (currentTimestamp !== undefined) {
    return parseExactRfc3339UtcNanoseconds(
        currentTimestamp,
        "current timestamp",
    ).epochNanoseconds;
  }
  if (!Number.isSafeInteger(currentTimeMs)) {
    fail("currentTimeMs must be a safe integer");
  }
  return BigInt(currentTimeMs) * NANOSECONDS_PER_MILLISECOND;
}

function approvalDigestProjection(approval) {
  const {approvalDigest: ignored, ...projection} = approval;
  return {
    ...projection,
    exactChronology: approvalChronologyProjection(approval),
  };
}

export function buildExecutableApprovalDigest(approval) {
  assertPlainData(approval, "approval");
  return canonicalDigest(approvalDigestProjection(approval));
}

export function buildOrganizationPolicyEvidenceDigest(evidence) {
  assertPlainData(evidence, "organization policy evidence");
  return computeOrganizationPolicyEvidenceDigest(evidence);
}

function validateServiceAccountKeyAudit(audit) {
  assertExactKeys(audit, [
    "complete",
    "projectId",
    "schemaVersion",
    "serviceAccountEmails",
    "userManagedKeyCount",
  ], "service account key audit");
  if (audit.schemaVersion !== SERVICE_ACCOUNT_KEY_AUDIT_VERSION ||
      audit.projectId !== TARGET_PROJECT_ID ||
      audit.complete !== true ||
      audit.userManagedKeyCount !== 0 ||
      !Array.isArray(audit.serviceAccountEmails) ||
      canonicalJson([...audit.serviceAccountEmails].sort()) !==
        canonicalJson(EXECUTION_SERVICE_ACCOUNT_EMAILS)) {
    fail("service account key audit must prove exact identities and zero keys");
  }
}

function validateSingleOperatorControlManifest(manifest) {
  assertExactKeys(manifest, [
    "deploymentSource",
    "legacyIamMigrationAuthorityDigest",
    "orderedSteps",
    "productionApprovalReferenceDigest",
    "rollbackManifestDigest",
    "schemaVersion",
    "secureAuditArtifact",
    "targets",
    "temporaryAccessRemovalPlanDigest",
  ], "single operator control manifest");
  assertExactKeys(manifest.secureAuditArtifact, [
    "artifactDigest",
    "directoryMode",
    "fileMode",
  ], "single operator secure audit artifact");
  if (manifest.schemaVersion !== SINGLE_OPERATOR_CONTROL_MANIFEST_VERSION ||
      !same(manifest.deploymentSource, IMMUTABLE_RELEASE_EVIDENCE) ||
      manifest.legacyIamMigrationAuthorityDigest !==
        ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST ||
      !same(manifest.targets, DEPLOYMENT_TARGETS) ||
      !same(manifest.orderedSteps, SINGLE_OPERATOR_EXECUTION_STEPS) ||
      !SHA256_HEX.test(manifest.productionApprovalReferenceDigest) ||
      !SHA256_HEX.test(manifest.rollbackManifestDigest) ||
      !SHA256_HEX.test(manifest.temporaryAccessRemovalPlanDigest) ||
      !SHA256_HEX.test(manifest.secureAuditArtifact.artifactDigest) ||
      manifest.secureAuditArtifact.directoryMode !== "0700" ||
      manifest.secureAuditArtifact.fileMode !== "0600") {
    fail(
        "single operator rollback, audit, source, or ordered control manifest " +
        "is invalid",
    );
  }
}

function validateOperatorMode(approval, executionPrincipals) {
  if (approval.operatorMode === THREE_PERSON_SEPARATION) {
    if (new Set(executionPrincipals).size !== executionPrincipals.length) {
      fail("approval principal roles must be distinct exact receipt users");
    }
    if (approval.singleOperatorControlManifest !== null) {
      fail("three-person mode forbids a single-operator control manifest");
    }
    return;
  }
  if (approval.operatorMode === SINGLE_OPERATOR_JIT_V1) {
    if (executionPrincipals.some((principal) =>
      principal !== APPROVED_SINGLE_OPERATOR_PRINCIPAL)) {
      fail("single-operator mode requires the exact approved principal tuple");
    }
    validateSingleOperatorControlManifest(
        approval.singleOperatorControlManifest,
    );
    return;
  }
  fail("operator mode is missing or unsupported");
}

export function validateExecutableApproval(
    approval,
    {
      currentTimeMs = Date.now(),
      currentTimestamp,
    } = {},
) {
  assertExactKeys(approval, [
    "approvalDigest",
    "approvalId",
    "approvedAt",
    "actualProvisioningEligible",
    "deploymentApprovalEligible",
    "publicInvokerApprovalEligible",
    "iamMutationCommandPublication",
    "impersonationPrincipal",
    "invokerOperatorPrincipal",
    "jitExpiresAt",
    "jitStartsAt",
    "organizationPolicy",
    "organizationPolicyLineage",
    "operatorMode",
    "preProvisioningMigrationEvidence",
    "provisioningPrincipal",
    "schemaVersion",
    "serviceAccountKeyAudit",
    "singleOperatorControlManifest",
  ], "executable approval");
  if (approval.schemaVersion !== EXECUTABLE_APPROVAL_VERSION ||
      typeof approval.approvalId !== "string" ||
      approval.approvalId.length === 0 ||
      PLACEHOLDER.test(approval.approvalId) ||
      approval.approvalDigest !== buildExecutableApprovalDigest(approval)) {
    fail("approval identity or digest mismatch");
  }
  const executionPrincipals = [];
  for (const key of APPROVAL_PRINCIPAL_KEYS) {
    const member = approval[key];
    parseExactUserPrincipal(member);
    if (PLACEHOLDER.test(member)) {
      fail(`approval ${key} must be resolved by the exact receipt`);
    }
    executionPrincipals.push(member);
  }
  validateOperatorMode(approval, executionPrincipals);
  validateServiceAccountKeyAudit(approval.serviceAccountKeyAudit);
  validatePhaseEvidence(approval.preProvisioningMigrationEvidence);
  if (approval.preProvisioningMigrationEvidence.phase !== PRE_PROVISIONING) {
    fail("approval requires exact PRE_PROVISIONING migration evidence");
  }
  const approvedAt = parseExactRfc3339UtcNanoseconds(
      approval.approvedAt,
      "approval.approvedAt",
  ).epochNanoseconds;
  const startsAt = parseExactRfc3339UtcNanoseconds(
      approval.jitStartsAt,
      "approval.jitStartsAt",
  ).epochNanoseconds;
  const expiresAt = parseExactRfc3339UtcNanoseconds(
      approval.jitExpiresAt,
      "approval.jitExpiresAt",
  ).epochNanoseconds;
  const currentTime = exactCurrentTimeNanoseconds({
    currentTimeMs,
    currentTimestamp,
  });
  const maximumJitDuration =
    maximumJitDurationNanoseconds(approval.operatorMode);
  if (expiresAt <= startsAt ||
      expiresAt - startsAt > maximumJitDuration ||
      approvedAt > startsAt || currentTime < startsAt ||
      currentTime >= expiresAt) {
    fail(
        "approval JIT window is inactive, incoherent, longer than 2 hours, " +
        "or longer than the operator-mode maximum",
    );
  }
  const organizationPolicy = approval.organizationPolicy;
  const organizationPolicyResult =
    validateOrganizationPolicyEvidence(organizationPolicy);
  validateOrganizationPolicyLineageReference(
      approval.organizationPolicyLineage,
  );
  if (organizationPolicy.evidenceDigest !==
      ORGANIZATION_POLICY_EVIDENCE.evidenceDigest ||
      canonicalDigest(approval.organizationPolicyLineage) !==
        canonicalDigest(buildOrganizationPolicyLineageReference())) {
    fail("approval Organization Policy lineage is not authoritative");
  }
  if (EXECUTION_ACTION_KEYS.some((key) =>
    typeof approval[key] !== "boolean")) {
    fail("approval execution flags must be boolean");
  }
  const policyEligibility = {
    actualProvisioningEligible:
      organizationPolicyResult.provisioningPolicyCompatible,
    deploymentApprovalEligible:
      organizationPolicyResult.deploymentPolicyCompatible,
    publicInvokerApprovalEligible:
      organizationPolicyResult.publicInvokerPolicyCompatible,
    iamMutationCommandPublication:
      organizationPolicyResult.mutationCommandPublicationPolicyCompatible,
  };
  if (approval.operatorMode === SINGLE_OPERATOR_JIT_V1) {
    policyEligibility.publicInvokerApprovalEligible = false;
  }
  const execution = Object.fromEntries(EXECUTION_ACTION_KEYS.map((key) => [
    key,
    policyEligibility[key] && approval[key] === true,
  ]));
  if (EXECUTION_ACTION_KEYS.some((key) => approval[key] !== execution[key])) {
    fail("approval execution flags do not fail closed for Organization Policy");
  }
  return deepFreeze({
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    operatorModeContractVersion: OPERATOR_MODE_CONTRACT_VERSION,
    operatorMode: approval.operatorMode,
    provisioningPrincipal: approval.provisioningPrincipal,
    impersonationPrincipal: approval.impersonationPrincipal,
    invokerOperatorPrincipal: approval.invokerOperatorPrincipal,
    jitActive: true,
    jitStartsAt: approval.jitStartsAt,
    jitExpiresAt: approval.jitExpiresAt,
    organizationPolicyStatus: organizationPolicy.observationStatus,
    organizationPolicyEvidenceDigest: organizationPolicy.evidenceDigest,
    legacyIamMigrationAuthorityDigest:
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
    preProvisioningMigrationEvidenceDigest:
      approval.preProvisioningMigrationEvidence.evidenceDigest,
    userManagedServiceAccountKeyCount:
      approval.serviceAccountKeyAudit.userManagedKeyCount,
    execution,
    publicInvokerRequiresSeparateReceipt:
      approval.operatorMode === SINGLE_OPERATOR_JIT_V1,
    executable: approval.operatorMode === SINGLE_OPERATOR_JIT_V1 ?
      execution.actualProvisioningEligible &&
        execution.deploymentApprovalEligible &&
        execution.iamMutationCommandPublication &&
        execution.publicInvokerApprovalEligible === false :
      EXECUTION_ACTION_KEYS.every((key) => execution[key]),
  });
}

export const validatePrincipalJitOrgPolicyApproval =
  validateExecutableApproval;

function receiptDigestProjection(receipt) {
  const {receiptDigest: ignored, ...projection} = receipt;
  return projection;
}

function buildReceiptDigest(receipt, label) {
  assertPlainData(receipt, label);
  return canonicalDigest(receiptDigestProjection(receipt));
}

export function buildSingleOperatorPrivateValidationReceiptDigest(receipt) {
  return buildReceiptDigest(receipt, "single operator private validation");
}

export function buildSingleOperatorInvokerPublicationReceiptDigest(receipt) {
  return buildReceiptDigest(receipt, "single operator invoker publication");
}

export function buildSingleOperatorCompletionReceiptDigest(receipt) {
  return buildReceiptDigest(receipt, "single operator completion");
}

function validateSingleOperatorApprovalAt(approval, currentTimestamp) {
  const assessment = validateExecutableApproval(approval, {currentTimestamp});
  if (assessment.operatorMode !== SINGLE_OPERATOR_JIT_V1 ||
      assessment.executable !== true ||
      assessment.execution.actualProvisioningEligible !== true ||
      assessment.execution.deploymentApprovalEligible !== true ||
      assessment.execution.publicInvokerApprovalEligible !== false ||
      assessment.execution.iamMutationCommandPublication !== true) {
    fail("single-operator approval is not executable for private deployment");
  }
  return assessment;
}

function validateOrderedStepCompletions(
    completions,
    expectedSteps,
    approval,
    label,
) {
  if (!Array.isArray(completions) ||
      completions.length !== expectedSteps.length) {
    fail(`${label} must contain the exact ordered steps`);
  }
  const jitStartsAt = parseExactRfc3339UtcNanoseconds(
      approval.jitStartsAt,
      "approval.jitStartsAt",
  ).epochNanoseconds;
  const jitExpiresAt = parseExactRfc3339UtcNanoseconds(
      approval.jitExpiresAt,
      "approval.jitExpiresAt",
  ).epochNanoseconds;
  let previous = null;
  const times = completions.map((completion, index) => {
    assertExactKeys(
        completion,
        ["completedAt", "stepId"],
        `${label}[${index}]`,
    );
    if (completion.stepId !== expectedSteps[index]) {
      fail(`${label} step order mismatch`);
    }
    const completedAt = parseExactRfc3339UtcNanoseconds(
        completion.completedAt,
        `${label}[${index}].completedAt`,
    ).epochNanoseconds;
    if (completedAt < jitStartsAt ||
        completedAt >= jitExpiresAt ||
        (previous !== null && completedAt < previous)) {
      fail(`${label} must be ordered and entirely inside JIT`);
    }
    previous = completedAt;
    return completedAt;
  });
  return times;
}

export function validateSingleOperatorPrivateValidationReceipt(
    receipt,
    approval,
) {
  assertExactKeys(receipt, [
    "allTargetsPrivate",
    "approvalDigest",
    "approvalId",
    "effectivePermissionAuditComplete",
    "existingFunctionBaselineDigest",
    "finalFunctionCount",
    "finalGen2FunctionCount",
    "operatorMode",
    "postProvisioningMigrationEvidence",
    "prePublicationMigrationEvidence",
    "privateValidationCompletedAt",
    "receiptDigest",
    "receiptId",
    "schemaVersion",
    "sourceIdentityVerified",
    "stepCompletions",
    "targets",
    "userManagedKeyCount",
  ], "single operator private validation receipt");
  const assessment = validateSingleOperatorApprovalAt(
      approval,
      receipt.privateValidationCompletedAt,
  );
  validatePhaseEvidence(receipt.postProvisioningMigrationEvidence);
  validatePhaseEvidence(receipt.prePublicationMigrationEvidence);
  if (receipt.postProvisioningMigrationEvidence.phase !==
        POST_PROVISIONING_PRE_DEPLOY ||
      receipt.prePublicationMigrationEvidence.phase !==
        POST_PRIVATE_DEPLOY_PRE_PUBLICATION) {
    fail("private validation requires exact post-provisioning phase evidence");
  }
  const times = validateOrderedStepCompletions(
      receipt.stepCompletions,
      SINGLE_OPERATOR_PRIVATE_VALIDATION_STEPS,
      approval,
      "single operator private validation steps",
  );
  const completedAt = parseExactRfc3339UtcNanoseconds(
      receipt.privateValidationCompletedAt,
      "privateValidationCompletedAt",
  ).epochNanoseconds;
  if (receipt.schemaVersion !==
        SINGLE_OPERATOR_PRIVATE_VALIDATION_RECEIPT_VERSION ||
      typeof receipt.receiptId !== "string" ||
      receipt.receiptId.length === 0 ||
      PLACEHOLDER.test(receipt.receiptId) ||
      receipt.approvalId !== assessment.approvalId ||
      receipt.approvalDigest !== assessment.approvalDigest ||
      receipt.operatorMode !== SINGLE_OPERATOR_JIT_V1 ||
      !same(receipt.targets, SINGLE_OPERATOR_TARGET_FUNCTION_NAMES) ||
      receipt.existingFunctionBaselineDigest !==
        IMMUTABLE_RELEASE_EVIDENCE.existingFunctionBaselineDigest ||
      receipt.finalFunctionCount !== 35 ||
      receipt.finalGen2FunctionCount !== 35 ||
      receipt.allTargetsPrivate !== true ||
      receipt.sourceIdentityVerified !== true ||
      receipt.effectivePermissionAuditComplete !== true ||
      receipt.userManagedKeyCount !== 0 ||
      times.at(-1) !== completedAt ||
      receipt.receiptDigest !==
        buildSingleOperatorPrivateValidationReceiptDigest(receipt)) {
    fail("single operator private validation receipt is incomplete");
  }
  return deepFreeze({
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
    privateValidationCompletedAt: receipt.privateValidationCompletedAt,
    postProvisioningMigrationEvidenceDigest:
      receipt.postProvisioningMigrationEvidence.evidenceDigest,
    prePublicationMigrationEvidenceDigest:
      receipt.prePublicationMigrationEvidence.evidenceDigest,
    provisioningEligible: true,
    deploymentEligible: true,
    publicInvokerEligible: false,
    iamMutationCommandPublication: true,
  });
}

export function validateSingleOperatorInvokerPublicationReceipt(
    receipt,
    approval,
    privateValidationReceipt,
) {
  assertExactKeys(receipt, [
    "approvalDigest",
    "approvalId",
    "confirmationSeparated",
    "operatorMode",
    "privateValidationCompletedAt",
    "privateValidationReceiptDigest",
    "publicationConfirmedAt",
    "receiptDigest",
    "receiptId",
    "schemaVersion",
    "targets",
  ], "single operator invoker publication receipt");
  const privateAssessment = validateSingleOperatorPrivateValidationReceipt(
      privateValidationReceipt,
      approval,
  );
  const approvalAssessment = validateSingleOperatorApprovalAt(
      approval,
      receipt.publicationConfirmedAt,
  );
  const privateCompletedAt = parseExactRfc3339UtcNanoseconds(
      privateAssessment.privateValidationCompletedAt,
      "privateValidationCompletedAt",
  ).epochNanoseconds;
  const publicationConfirmedAt = parseExactRfc3339UtcNanoseconds(
      receipt.publicationConfirmedAt,
      "publicationConfirmedAt",
  ).epochNanoseconds;
  if (receipt.schemaVersion !==
        SINGLE_OPERATOR_INVOKER_PUBLICATION_RECEIPT_VERSION ||
      typeof receipt.receiptId !== "string" ||
      receipt.receiptId.length === 0 ||
      PLACEHOLDER.test(receipt.receiptId) ||
      receipt.approvalId !== approvalAssessment.approvalId ||
      receipt.approvalDigest !== approvalAssessment.approvalDigest ||
      receipt.operatorMode !== SINGLE_OPERATOR_JIT_V1 ||
      receipt.privateValidationReceiptDigest !==
        privateAssessment.receiptDigest ||
      receipt.privateValidationCompletedAt !==
        privateAssessment.privateValidationCompletedAt ||
      receipt.confirmationSeparated !== true ||
      publicationConfirmedAt <= privateCompletedAt ||
      !same(receipt.targets, SINGLE_OPERATOR_TARGET_FUNCTION_NAMES) ||
      receipt.receiptDigest !==
        buildSingleOperatorInvokerPublicationReceiptDigest(receipt)) {
    fail(
        "single operator invoker publication must follow a separate private " +
        "validation receipt",
    );
  }
  return deepFreeze({
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
    publicationConfirmedAt: receipt.publicationConfirmedAt,
    publicInvokerEligible: true,
    iamMutationCommandPublication: true,
  });
}

export function validateSingleOperatorCompletionReceipt(
    receipt,
    approval,
    privateValidationReceipt,
    invokerPublicationReceipt,
) {
  assertExactKeys(receipt, [
    "approvalDigest",
    "approvalId",
    "finalAudit",
    "finalAuditCompletedAt",
    "finalIamAudit",
    "finalMigrationEvidence",
    "operatorMode",
    "postPublicationMigrationEvidence",
    "publicInvokerAppliedAt",
    "publicationReceiptDigest",
    "receiptDigest",
    "receiptId",
    "rollbackReceipt",
    "rollbackManifestDigest",
    "schemaVersion",
    "secureAuditArtifactDigest",
    "stepCompletions",
    "targets",
    "temporaryAccessRemovalEvidence",
    "temporaryAccessRemovedAt",
  ], "single operator completion receipt");
  const publicationAssessment =
    validateSingleOperatorInvokerPublicationReceipt(
        invokerPublicationReceipt,
        approval,
        privateValidationReceipt,
    );
  validateSingleOperatorApprovalAt(approval, receipt.finalAuditCompletedAt);
  validatePhaseEvidence(receipt.postPublicationMigrationEvidence);
  validatePhaseEvidence(receipt.finalMigrationEvidence);
  validateFinalIamAudit(receipt.finalIamAudit);
  validateRollbackReceipt(receipt.rollbackReceipt);
  if (receipt.postPublicationMigrationEvidence.phase !==
        POST_PUBLICATION_PRE_CLEANUP ||
      receipt.finalMigrationEvidence.phase !== FINAL_IAM_MIGRATION_PHASE ||
      receipt.finalIamAudit.phase !== FINAL_IAM_MIGRATION_PHASE ||
      receipt.rollbackReceipt.phase !== FINAL_IAM_MIGRATION_PHASE ||
      receipt.rollbackReceipt.restoredRecords.length !== 0 ||
      !same(
          receipt.rollbackReceipt.beforeRecords,
          receipt.finalMigrationEvidence.legacyRecords,
      ) ||
      !same(
          receipt.rollbackReceipt.afterRecords,
          receipt.finalMigrationEvidence.legacyRecords,
      )) {
    fail("completion migration phase, rollback, or final IAM audit is invalid");
  }
  const times = validateOrderedStepCompletions(
      receipt.stepCompletions,
      SINGLE_OPERATOR_COMPLETION_STEPS,
      approval,
      "single operator completion steps",
  );
  assertExactKeys(receipt.temporaryAccessRemovalEvidence, [
    "actAsBindingsRemoved",
    "deployRoleBindingRemoved",
    "evidenceDigest",
    "tokenCreatorBindingRemoved",
  ], "temporary access removal evidence");
  assertExactKeys(receipt.finalAudit, [
    "complete",
    "effectivePermissionAuditComplete",
    "evidenceDigest",
    "existingFunctionCount",
    "finalFunctionCount",
    "finalGen2FunctionCount",
    "keyAuditComplete",
    "userManagedKeyCount",
  ], "single operator final audit");
  const manifest = approval.singleOperatorControlManifest;
  const publicationConfirmedAt = parseExactRfc3339UtcNanoseconds(
      publicationAssessment.publicationConfirmedAt,
      "publicationConfirmedAt",
  ).epochNanoseconds;
  if (receipt.schemaVersion !== SINGLE_OPERATOR_COMPLETION_RECEIPT_VERSION ||
      typeof receipt.receiptId !== "string" ||
      receipt.receiptId.length === 0 ||
      PLACEHOLDER.test(receipt.receiptId) ||
      receipt.approvalId !== approval.approvalId ||
      receipt.approvalDigest !== approval.approvalDigest ||
      receipt.operatorMode !== SINGLE_OPERATOR_JIT_V1 ||
      receipt.publicationReceiptDigest !==
        publicationAssessment.receiptDigest ||
      times[0] <= publicationConfirmedAt ||
      !same(receipt.targets, SINGLE_OPERATOR_TARGET_FUNCTION_NAMES) ||
      receipt.rollbackManifestDigest !== manifest.rollbackManifestDigest ||
      receipt.secureAuditArtifactDigest !==
        manifest.secureAuditArtifact.artifactDigest ||
      receipt.publicInvokerAppliedAt !==
        receipt.stepCompletions[0]?.completedAt ||
      receipt.temporaryAccessRemovedAt !==
        receipt.stepCompletions[1]?.completedAt ||
      receipt.finalAuditCompletedAt !==
        receipt.stepCompletions[2]?.completedAt ||
      receipt.temporaryAccessRemovalEvidence.tokenCreatorBindingRemoved !==
        true ||
      receipt.temporaryAccessRemovalEvidence.actAsBindingsRemoved !== true ||
      receipt.temporaryAccessRemovalEvidence.deployRoleBindingRemoved !==
        true ||
      !SHA256_HEX.test(
          receipt.temporaryAccessRemovalEvidence.evidenceDigest,
      ) ||
      receipt.finalAudit.complete !== true ||
      receipt.finalAudit.effectivePermissionAuditComplete !== true ||
      receipt.finalAudit.keyAuditComplete !== true ||
      receipt.finalAudit.userManagedKeyCount !== 0 ||
      receipt.finalAudit.existingFunctionCount !== 32 ||
      receipt.finalAudit.finalFunctionCount !== 35 ||
      receipt.finalAudit.finalGen2FunctionCount !== 35 ||
      receipt.finalAudit.evidenceDigest !== receipt.finalIamAudit.auditDigest ||
      times.at(-1) !== parseExactRfc3339UtcNanoseconds(
          receipt.finalAuditCompletedAt,
          "finalAuditCompletedAt",
      ).epochNanoseconds ||
      receipt.receiptDigest !==
        buildSingleOperatorCompletionReceiptDigest(receipt)) {
    fail("single operator completion lacks removal or final audit evidence");
  }
  return deepFreeze({
    receiptId: receipt.receiptId,
    receiptDigest: receipt.receiptDigest,
    publicInvokerEligible: true,
    temporaryAccessRemoved: true,
    finalAuditComplete: true,
    finalIamAuditDigest: receipt.finalIamAudit.auditDigest,
    finalMigrationEvidenceDigest:
      receipt.finalMigrationEvidence.evidenceDigest,
    rollbackReceiptDigest: receipt.rollbackReceipt.receiptDigest,
    completedInsideJit: true,
  });
}

function validateReceiptApprovalBinding(receipt, approval) {
  const assessment = validateExecutableApproval(approval, {
    currentTimestamp: receipt.observedAt,
  });
  validateOrganizationPolicyLineageReference(
      receipt.organizationPolicyLineage,
  );
  if (receipt.approvalId !== assessment.approvalId ||
      receipt.approvalDigest !== assessment.approvalDigest ||
      canonicalDigest(receipt.organizationPolicyLineage) !==
        canonicalDigest(approval.organizationPolicyLineage)) {
    fail("receipt is not bound to an active executable approval");
  }
  return assessment;
}

const TRANSITION_RECEIPT_KEYS = deepFreeze([
  "after",
  "approvalDigest",
  "approvalId",
  "before",
  "contractDigest",
  "exactChronologyDigest",
  "fromState",
  "observedAt",
  "organizationPolicyLineage",
  "schemaVersion",
  "toState",
]);

export function validateFreezeActivationReceipt(receipt, approval) {
  assertExactKeys(receipt, TRANSITION_RECEIPT_KEYS,
      "freeze activation receipt");
  if (receipt.schemaVersion !== FREEZE_ACTIVATION_RECEIPT_VERSION ||
      receipt.contractDigest !== PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST ||
      receipt.fromState !== STEADY_STATE ||
      receipt.toState !== FREEZE_ACTIVE_STATE ||
      receipt.exactChronologyDigest !==
        buildTransitionReceiptChronologyDigest(receipt, approval)) {
    fail("freeze activation transition identity mismatch");
  }
  const approvalAssessment = validateReceiptApprovalBinding(receipt, approval);
  validateStateSnapshot(receipt.before, STEADY_STATE);
  validateStateSnapshot(receipt.after, FREEZE_ACTIVE_STATE);
  if (!receipt.before.principalPermissions.find(({member}) =>
    member === WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER)?.permissions
      .includes("datastore.entities.create") ||
      receipt.after.principalPermissions.find(({member}) =>
        member === WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER)?.permissions
          .some((permission) =>
            WRITABLE_DATASTORE_PERMISSIONS.includes(permission)) ||
      receipt.before.bindingSetDigest === receipt.after.bindingSetDigest ||
      receipt.before.permissionSetDigest === receipt.after.permissionSetDigest) {
    fail("freeze activation does not prove writer replacement");
  }
  return approvalAssessment.executable;
}

export const validateActivationReceipt = validateFreezeActivationReceipt;

const RESTORATION_CHRONOLOGY_KEYS = deepFreeze([
  "iamRestoredAt",
  "positiveSmokeAt",
  "schedulerRestoredAt",
  "sentinelDeactivatedAt",
]);

function transitionChronologyProjection(receipt, approval) {
  const chronology = Object.hasOwn(receipt, "chronology") ?
    Object.fromEntries(RESTORATION_CHRONOLOGY_KEYS.map((key) => [
      key,
      timestampDigestRecord(
          receipt.chronology?.[key],
          `receipt.chronology.${key}`,
      ),
    ])) :
    null;
  return {
    profileVersion: EXACT_CHRONOLOGY_PROFILE_VERSION,
    approval: approvalChronologyProjection(approval),
    receiptObservedAt: timestampDigestRecord(
        receipt.observedAt,
        "receipt.observedAt",
    ),
    chronology,
  };
}

export function buildTransitionReceiptChronologyDigest(receipt, approval) {
  return canonicalDigest(transitionChronologyProjection(receipt, approval));
}

export function validateUnfreezeRestorationReceipt(receipt, approval) {
  assertExactKeys(receipt, [
    ...TRANSITION_RECEIPT_KEYS,
    "chronology",
  ], "unfreeze restoration receipt");
  if (receipt.schemaVersion !== UNFREEZE_RESTORATION_RECEIPT_VERSION ||
      receipt.contractDigest !== PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST ||
      receipt.fromState !== FREEZE_ACTIVE_STATE ||
      receipt.toState !== STEADY_STATE) {
    fail("unfreeze restoration transition identity mismatch");
  }
  const approvalAssessment =
    validateReceiptApprovalBinding(receipt, approval);
  validateStateSnapshot(receipt.before, FREEZE_ACTIVE_STATE);
  validateStateSnapshot(receipt.after, STEADY_STATE);
  assertExactKeys(
      receipt.chronology,
      RESTORATION_CHRONOLOGY_KEYS,
      "unfreeze chronology",
  );
  if (receipt.exactChronologyDigest !==
      buildTransitionReceiptChronologyDigest(receipt, approval)) {
    fail("unfreeze restoration exact chronology digest mismatch");
  }
  const times = RESTORATION_CHRONOLOGY_KEYS.map((key) =>
    parseExactRfc3339UtcNanoseconds(
        receipt.chronology[key],
        `unfreeze chronology.${key}`,
    ).epochNanoseconds);
  const observedAt = parseExactRfc3339UtcNanoseconds(
      receipt.observedAt,
      "receipt.observedAt",
  ).epochNanoseconds;
  const jitStartsAt = parseExactRfc3339UtcNanoseconds(
      approvalAssessment.jitStartsAt,
      "approval.jitStartsAt",
  ).epochNanoseconds;
  const jitExpiresAt = parseExactRfc3339UtcNanoseconds(
      approvalAssessment.jitExpiresAt,
      "approval.jitExpiresAt",
  ).epochNanoseconds;
  if (!(jitStartsAt <= times[0] &&
      times[0] <= times[2] &&
      times[2] <= times[3] &&
      times[3] <= times[1] &&
      times[1] <= observedAt &&
      observedAt < jitExpiresAt)) {
    fail(
        "IAM restoration must precede scheduler, sentinel, smoke, and " +
        "observation and remain inside JIT",
    );
  }
  return approvalAssessment.executable;
}

export const validateRestorationReceipt =
  validateUnfreezeRestorationReceipt;
export const validateRuntimeIamStateSnapshot = validateStateSnapshot;
export const computeCanonicalSetDigest = buildCanonicalSetDigest;
export const computeBindingSetDigest = buildBindingSetDigest;
export const computePermissionSetDigest = buildPermissionSetDigest;
export const WRITER_SERVICE_ACCOUNT_EMAIL =
  WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL;
export const PREVIEW_SERVICE_ACCOUNT_EMAIL =
  PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL;

validatePrivateRuntimeIamContract();
