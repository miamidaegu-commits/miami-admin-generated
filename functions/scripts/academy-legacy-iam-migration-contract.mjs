import crypto from "node:crypto";

export const LEGACY_IAM_BASELINE_SCHEMA_VERSION =
  "academy_legacy_iam_baseline.v1";
export const REVIEWED_MANAGED_IDENTITY_SCHEMA_VERSION =
  "academy_reviewed_managed_identity.v1";
export const DECOMMISSION_PLAN_SCHEMA_VERSION =
  "academy_legacy_iam_decommission_plan.v1";
export const RESOURCE_STATE_SCHEMA_VERSION =
  "academy_iam_resource_state.v1";
export const PHASE_EVIDENCE_SCHEMA_VERSION =
  "academy_iam_migration_phase_evidence.v1";
export const ROLLBACK_RECEIPT_SCHEMA_VERSION =
  "academy_legacy_iam_rollback_receipt.v1";
export const FINAL_IAM_AUDIT_SCHEMA_VERSION =
  "academy_final_iam_audit.v1";
export const MIGRATION_AUTHORITY_SCHEMA_VERSION =
  "academy_legacy_iam_migration_authority.v1";
export const CANONICAL_DIGEST_VERSION = "canonical_json_sha256.v1";
export const CANONICAL_SET_DIGEST_VERSION = "canonical_set_sha256.v1";

export const PROJECT_ID = "daegu-miami-production";
export const PROJECT_NUMBER = "884850632328";
export const PROJECT_SCOPE = `projects/${PROJECT_ID}`;
export const REGION = "us-central1";
export const EXISTING_FUNCTION_BASELINE_DIGEST =
  "1cb924fc62c97771d42fb60b98934d9f48e5192abbf0b03b31d06753ff41dcfd";
export const OPERATOR_MEMBER = "user:miamidaegu@gmail.com";

export const PRE_PROVISIONING = "PRE_PROVISIONING";
export const POST_PROVISIONING_PRE_DEPLOY =
  "POST_PROVISIONING_PRE_DEPLOY";
export const POST_PRIVATE_DEPLOY_PRE_PUBLICATION =
  "POST_PRIVATE_DEPLOY_PRE_PUBLICATION";
export const POST_PUBLICATION_PRE_CLEANUP =
  "POST_PUBLICATION_PRE_CLEANUP";
export const FINAL_STEADY_STATE = "FINAL_STEADY_STATE";

export const MIGRATION_PHASES = frozen([
  PRE_PROVISIONING,
  POST_PROVISIONING_PRE_DEPLOY,
  POST_PRIVATE_DEPLOY_PRE_PUBLICATION,
  POST_PUBLICATION_PRE_CLEANUP,
  FINAL_STEADY_STATE,
]);

const SHA256_HEX = /^[a-f0-9]{64}$/;

function fail(message) {
  throw new Error(`Academy legacy IAM migration contract rejected: ${message}`);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertCanonicalValue(value, path = "$") {
  if (value === null ||
      typeof value === "string" ||
      typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      fail(`non-canonical number at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    const keys = Reflect.ownKeys(value);
    const expected = [
      ...Array.from({length: value.length}, (_, index) => String(index)),
      "length",
    ];
    if (keys.length !== expected.length ||
        expected.some((key) => !keys.includes(key))) {
      fail(`sparse or custom array at ${path}`);
    }
    value.forEach((entry, index) =>
      assertCanonicalValue(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) {
    fail(`non-canonical object at ${path}`);
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" ||
        !Object.prototype.propertyIsEnumerable.call(value, key) ||
        value[key] === undefined) {
      fail(`non-canonical field at ${path}.${String(key)}`);
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) {
      fail(`accessor field at ${path}.${key}`);
    }
    assertCanonicalValue(value[key], `${path}.${key}`);
  }
}

function normalizeCanonical(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeCanonical);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, normalizeCanonical(value[key])]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function frozen(value) {
  assertCanonicalValue(value);
  return deepFreeze(value);
}

export function canonicalJson(value) {
  assertCanonicalValue(value);
  return JSON.stringify(normalizeCanonical(value));
}

export function sha256Hex(value) {
  if (typeof value !== "string") fail("SHA256 input must be a string");
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalDigest(value) {
  return sha256Hex(canonicalJson(value));
}

export function canonicalSetDigest(values, setName = "canonical") {
  if (!Array.isArray(values) ||
      typeof setName !== "string" ||
      setName.length === 0) {
    fail("canonical set requires an array and non-empty name");
  }
  const elements = values.map((value) => canonicalJson(value)).sort();
  if (new Set(elements).size !== elements.length) {
    fail(`${setName} contains a duplicate`);
  }
  return canonicalDigest({
    algorithm: CANONICAL_SET_DIGEST_VERSION,
    setName,
    elements,
  });
}

function projectionWithout(value, field) {
  if (!isPlainObject(value)) fail(`${field} projection requires an object`);
  const {[field]: ignored, ...projection} = value;
  return projection;
}

export function buildRecordDigest(record, field = "recordDigest") {
  return canonicalDigest(projectionWithout(record, field));
}

export function buildBindingSetDigest(records, setName = "iam_bindings") {
  return canonicalSetDigest(records, setName);
}

function exact(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} exact canonical invariant failed`);
  }
}

function exactSet(actual, expected, label) {
  if (!Array.isArray(actual) ||
      canonicalSetDigest(actual, label) !==
        canonicalSetDigest(expected, label)) {
    fail(`${label} exact set invariant failed`);
  }
}

function assertExactKeys(value, keys, label) {
  if (!isPlainObject(value)) fail(`${label} must be a plain object`);
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    fail(`${label} exact key set mismatch`);
  }
}

function assertPhase(phase) {
  if (!MIGRATION_PHASES.includes(phase)) {
    fail(`unknown migration phase ${String(phase)}`);
  }
}

function recordWithDigest(record, field = "recordDigest") {
  return frozen({...record, [field]: canonicalDigest(record)});
}

const ALL_PHASES = [...MIGRATION_PHASES];
const OWNER_PHASES = [PRE_PROVISIONING, POST_PROVISIONING_PRE_DEPLOY];

export const LEGACY_IAM_BASELINE_RECORDS = frozen([
  recordWithDigest({
    recordId: "human-owner",
    scope: PROJECT_SCOPE,
    role: "roles/owner",
    members: [OPERATOR_MEMBER],
    condition: null,
    disposition: "MUST_REMOVE_BEFORE_PUBLICATION",
    allowedMigrationPhases: OWNER_PHASES,
    removalTarget: POST_PRIVATE_DEPLOY_PRE_PUBLICATION,
  }, "baselineRecordDigest"),
  recordWithDigest({
    recordId: "default-service-account-editor",
    scope: PROJECT_SCOPE,
    role: "roles/editor",
    members: [
      "serviceAccount:884850632328-compute@" +
        "developer.gserviceaccount.com",
      "serviceAccount:884850632328@cloudservices.gserviceaccount.com",
      "serviceAccount:daegu-miami-production@appspot.gserviceaccount.com",
    ].sort(),
    condition: null,
    disposition: "TRACKED_DEFERRED_DECOMMISSION",
    allowedMigrationPhases: ALL_PHASES,
    removalTarget:
      "AFTER_EXISTING_32_FUNCTION_REPLACEMENT_PERMISSION_REVIEW",
  }, "baselineRecordDigest"),
  recordWithDigest({
    recordId: "firebase-admin-sdk-token-creator",
    scope: PROJECT_SCOPE,
    role: "roles/iam.serviceAccountTokenCreator",
    members: [
      "serviceAccount:firebase-adminsdk-fbsvc@" +
        "daegu-miami-production.iam.gserviceaccount.com",
    ],
    condition: null,
    disposition: "TRACKED_DEFERRED_DECOMMISSION",
    allowedMigrationPhases: ALL_PHASES,
    removalTarget:
      "AFTER_FIREBASE_SIGNING_AND_AUTH_DEPENDENCY_REVIEW",
  }, "baselineRecordDigest"),
]);

export const LEGACY_IAM_BASELINE_DIGEST = canonicalSetDigest(
    LEGACY_IAM_BASELINE_RECORDS,
    "legacy_iam_baseline",
);

export const DEFERRED_LEGACY_IAM_RECORDS = frozen(
    LEGACY_IAM_BASELINE_RECORDS.filter(({disposition}) =>
      disposition === "TRACKED_DEFERRED_DECOMMISSION"),
);

export function validateLegacyIamBaselineSet(records, phase) {
  assertPhase(phase);
  const expected = OWNER_PHASES.includes(phase) ?
    LEGACY_IAM_BASELINE_RECORDS :
    DEFERRED_LEGACY_IAM_RECORDS;
  if (!Array.isArray(records)) fail("legacy baseline must be an array");
  for (const [index, record] of records.entries()) {
    assertExactKeys(record, [
      "allowedMigrationPhases",
      "baselineRecordDigest",
      "condition",
      "disposition",
      "members",
      "recordId",
      "removalTarget",
      "role",
      "scope",
    ], `legacy baseline[${index}]`);
    if (record.condition !== null ||
        !Array.isArray(record.members) ||
        canonicalJson(record.members) !==
          canonicalJson([...record.members].sort()) ||
        record.baselineRecordDigest !==
          buildRecordDigest(record, "baselineRecordDigest") ||
        !record.allowedMigrationPhases.includes(phase)) {
      fail(`legacy baseline[${index}] record or phase mismatch`);
    }
  }
  exactSet(records, expected, "legacy IAM baseline");
  return true;
}

export function validateLeastPrivilegeProofBindings(bindings, phase) {
  assertPhase(phase);
  if (!Array.isArray(bindings)) {
    fail("least-privilege proof bindings must be an array");
  }
  const legacyDigests =
    new Set(LEGACY_IAM_BASELINE_RECORDS.map(({baselineRecordDigest}) =>
      baselineRecordDigest));
  if (bindings.some((binding) =>
    ["roles/owner", "roles/editor"].includes(binding.role) ||
    legacyDigests.has(binding.baselineRecordDigest) ||
    binding.member ===
      DEFERRED_LEGACY_IAM_RECORDS[1].members[0])) {
    fail("legacy broad binding cannot satisfy least-privilege proof");
  }
  const expected = phase === PRE_PROVISIONING ? [] : PERMANENT_BINDINGS;
  exactSet(bindings, expected, "least-privilege proof bindings");
  return true;
}

export const KNOWN_SAME_PROJECT_DEFAULT_SERVICE_ACCOUNTS = frozen([
  "884850632328-compute@developer.gserviceaccount.com",
  "884850632328@cloudservices.gserviceaccount.com",
  "daegu-miami-production@appspot.gserviceaccount.com",
]);

function reviewedRecord(member, role) {
  return recordWithDigest({
    scope: PROJECT_SCOPE,
    member,
    role,
    condition: null,
  });
}

export const REVIEWED_MANAGED_IDENTITY_BINDINGS = frozen([
  reviewedRecord(
      "serviceAccount:service-884850632328@" +
        "gcp-sa-cloudscheduler.iam.gserviceaccount.com",
      "roles/cloudscheduler.serviceAgent",
  ),
  reviewedRecord(
      "serviceAccount:service-884850632328@" +
        "containerregistry.iam.gserviceaccount.com",
      "roles/containerregistry.ServiceAgent",
  ),
  reviewedRecord(
      "serviceAccount:service-884850632328@" +
        "gcp-sa-firebase.iam.gserviceaccount.com",
      "roles/firebase.managementServiceAgent",
  ),
  reviewedRecord(
      "serviceAccount:service-884850632328@" +
        "gcp-sa-firebasemods.iam.gserviceaccount.com",
      "roles/firebasemods.serviceAgent",
  ),
  reviewedRecord(
      "serviceAccount:service-884850632328@" +
        "firebase-rules.iam.gserviceaccount.com",
      "roles/firebaserules.system",
  ),
]);

export const REVIEWED_MANAGED_IDENTITY_DIGEST = canonicalSetDigest(
    REVIEWED_MANAGED_IDENTITY_BINDINGS,
    "reviewed_managed_identity_bindings",
);

export function classifyManagedIdentityBinding(binding) {
  assertExactKeys(binding, [
    "condition", "member", "recordDigest", "role", "scope",
  ], "managed identity binding");
  if (binding.recordDigest !== buildRecordDigest(binding)) {
    fail("managed identity binding digest mismatch");
  }
  const exactReviewed = REVIEWED_MANAGED_IDENTITY_BINDINGS.find(
      (candidate) => candidate.member === binding.member,
  );
  if (exactReviewed) {
    return frozen({
      classification:
        canonicalJson(binding) === canonicalJson(exactReviewed) ?
          "REVIEWED_MANAGED_IDENTITY" :
          "REJECT",
      disposition:
        canonicalJson(binding) === canonicalJson(exactReviewed) ?
          "ALLOW_EXACT_REVIEWED_PAIR" :
          "WRONG_ROLE_SCOPE_OR_CONDITION",
    });
  }
  const email = binding.member.startsWith("serviceAccount:") ?
    binding.member.slice("serviceAccount:".length) :
    "";
  if (KNOWN_SAME_PROJECT_DEFAULT_SERVICE_ACCOUNTS.includes(email)) {
    return frozen({
      classification: "KNOWN_SAME_PROJECT_DEFAULT",
      disposition: "LEGACY_BASELINE_ONLY",
    });
  }
  if (/^service-\d+@[^@]+\.iam\.gserviceaccount\.com$/.test(email) ||
      /^service-\d+@[^@]+\.gserviceaccount\.com$/.test(email)) {
    return frozen({
      classification: "INPUT_REQUIRED",
      disposition: "UNKNOWN_SERVICE_AGENT_REQUIRES_EXACT_REVIEW",
    });
  }
  return frozen({
    classification: "REJECT",
    disposition: "FOREIGN_OR_USER_MANAGED_IDENTITY",
  });
}

export function validateReviewedManagedIdentitySet(records) {
  if (!Array.isArray(records)) {
    fail("reviewed managed identity set must be an array");
  }
  records.forEach((record) => {
    const result = classifyManagedIdentityBinding(record);
    if (result.classification !== "REVIEWED_MANAGED_IDENTITY") {
      fail(`reviewed managed identity set contains ${result.classification}`);
    }
  });
  exactSet(
      records,
      REVIEWED_MANAGED_IDENTITY_BINDINGS,
      "reviewed managed identity bindings",
  );
  return true;
}

export const FIREBASE_DEPENDENCY_BINDINGS = frozen([
  reviewedRecord(
      "serviceAccount:firebase-adminsdk-fbsvc@" +
        "daegu-miami-production.iam.gserviceaccount.com",
      "roles/firebase.sdkAdminServiceAgent",
  ),
  reviewedRecord(
      "serviceAccount:firebase-adminsdk-fbsvc@" +
        "daegu-miami-production.iam.gserviceaccount.com",
      "roles/firebaseauth.admin",
  ),
]);

const decommissionPlanProjection = {
  schemaVersion: DECOMMISSION_PLAN_SCHEMA_VERSION,
  legacyBaselineDigest: LEGACY_IAM_BASELINE_DIGEST,
  deferredRecordIds: DEFERRED_LEGACY_IAM_RECORDS
      .map(({recordId}) => recordId)
      .sort(),
  dependencyReviews: [
    {
      recordId: "default-service-account-editor",
      requirement:
        "EXISTING_32_FUNCTION_REPLACEMENT_PERMISSIONS_" +
        "INDEPENDENTLY_REVIEWED",
      status: "PENDING",
    },
    {
      recordId: "firebase-admin-sdk-token-creator",
      requirement:
        "FIREBASE_SIGNING_AND_AUTH_DEPENDENCIES_INDEPENDENTLY_REVIEWED",
      status: "PENDING",
    },
  ],
};

export const DECOMMISSION_PLAN = frozen({
  ...decommissionPlanProjection,
  planDigest: canonicalDigest(decommissionPlanProjection),
});
export const DECOMMISSION_PLAN_DIGEST = DECOMMISSION_PLAN.planDigest;

export function buildDecommissionPlanDigest(plan) {
  return canonicalDigest(projectionWithout(plan, "planDigest"));
}

export function validateDecommissionPlan(plan) {
  exact(plan, DECOMMISSION_PLAN, "legacy decommission plan");
  if (plan.planDigest !== buildDecommissionPlanDigest(plan)) {
    fail("legacy decommission plan digest mismatch");
  }
  return true;
}

export const DEPLOY_PERMISSIONS = frozen([
  "cloudfunctions.functions.create",
  "cloudfunctions.functions.get",
  "cloudfunctions.functions.list",
  "cloudfunctions.functions.sourceCodeSet",
  "cloudfunctions.locations.list",
  "cloudfunctions.operations.get",
  "cloudfunctions.operations.list",
  "resourcemanager.projects.get",
  "serviceusage.services.use",
]);
export const BUILD_CORE_PERMISSIONS = frozen([
  "logging.logEntries.create",
  "logging.logEntries.route",
]);
export const WRITER_RUNTIME_PERMISSIONS = frozen([
  "datastore.databases.get",
  "datastore.entities.create",
  "datastore.entities.get",
  "datastore.entities.list",
  "datastore.entities.update",
]);
export const READ_ONLY_RUNTIME_PERMISSIONS = frozen([
  "datastore.databases.get",
  "datastore.entities.get",
  "datastore.entities.list",
]);

function serviceAccountRecord(serviceAccountId) {
  return frozen({
    serviceAccountId,
    email: `${serviceAccountId}@${PROJECT_ID}.iam.gserviceaccount.com`,
    state: "ACTIVE",
    disabled: false,
  });
}

export const EXPECTED_ACADEMY_SERVICE_ACCOUNTS = frozen([
  serviceAccountRecord("academy-functions-deployer"),
  serviceAccountRecord("academy-functions-build"),
  serviceAccountRecord("academy-private-writer-runtime"),
  serviceAccountRecord("academy-private-preview-rt"),
]);

function roleDefinition(roleId, permissions) {
  return frozen({
    roleId,
    name: `${PROJECT_SCOPE}/roles/${roleId}`,
    stage: "GA",
    deleted: false,
    permissions: [...permissions].sort(),
    permissionSetDigest:
      canonicalSetDigest([...permissions].sort(), `${roleId}_permissions`),
  });
}

export const EXPECTED_CUSTOM_ROLE_DEFINITIONS = frozen([
  roleDefinition("academyFunctionsDeployV1", DEPLOY_PERMISSIONS),
  roleDefinition("academyFunctionsBuildCoreV1", BUILD_CORE_PERMISSIONS),
  roleDefinition(
      "academyPrivateWriterRuntimeV1",
      WRITER_RUNTIME_PERMISSIONS,
  ),
  roleDefinition("academyBackendReadOnly", READ_ONLY_RUNTIME_PERMISSIONS),
]);

export const EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS = frozen(
    EXPECTED_ACADEMY_SERVICE_ACCOUNTS.map(({serviceAccountId}) =>
      serviceAccountId).sort(),
);
export const EXPECTED_CUSTOM_ROLE_IDS = frozen(
    EXPECTED_CUSTOM_ROLE_DEFINITIONS.map(({roleId}) => roleId).sort(),
);

function bindingRecord(recordId, scope, member, role) {
  return recordWithDigest({
    recordId,
    scope,
    member,
    role,
    condition: null,
  });
}

const BUILD_MEMBER =
  "serviceAccount:academy-functions-build@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const DEPLOY_MEMBER =
  "serviceAccount:academy-functions-deployer@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const BASELINE_RUNTIME_MEMBER =
  "serviceAccount:884850632328-compute@developer.gserviceaccount.com";
const WRITER_MEMBER =
  "serviceAccount:academy-private-writer-runtime@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const PREVIEW_MEMBER =
  "serviceAccount:academy-private-preview-rt@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const SOURCE_BUCKET = "gs://gcf-v2-sources-884850632328-us-central1";
const UPLOAD_BUCKET =
  "gs://gcf-v2-uploads-884850632328.us-central1." +
  "cloudfunctions.appspot.com";
const ARTIFACT_REPOSITORY =
  `${PROJECT_SCOPE}/locations/${REGION}/repositories/gcf-artifacts`;

export const PERMANENT_BINDINGS = frozen([
  bindingRecord(
      "build-core-project",
      PROJECT_SCOPE,
      BUILD_MEMBER,
      `${PROJECT_SCOPE}/roles/academyFunctionsBuildCoreV1`,
  ),
  bindingRecord(
      "baseline-runtime-project",
      PROJECT_SCOPE,
      BASELINE_RUNTIME_MEMBER,
      `${PROJECT_SCOPE}/roles/academyBackendReadOnly`,
  ),
  bindingRecord(
      "writer-runtime-project",
      PROJECT_SCOPE,
      WRITER_MEMBER,
      `${PROJECT_SCOPE}/roles/academyPrivateWriterRuntimeV1`,
  ),
  bindingRecord(
      "preview-runtime-project",
      PROJECT_SCOPE,
      PREVIEW_MEMBER,
      `${PROJECT_SCOPE}/roles/academyBackendReadOnly`,
  ),
  bindingRecord(
      "source-bucket-object-viewer",
      SOURCE_BUCKET,
      BUILD_MEMBER,
      "roles/storage.objectViewer",
  ),
  bindingRecord(
      "upload-bucket-object-viewer",
      UPLOAD_BUCKET,
      BUILD_MEMBER,
      "roles/storage.objectViewer",
  ),
  bindingRecord(
      "artifact-repository-writer",
      ARTIFACT_REPOSITORY,
      BUILD_MEMBER,
      "roles/artifactregistry.writer",
  ),
]);

function serviceAccountScope(email) {
  return `${PROJECT_SCOPE}/serviceAccounts/${email}`;
}

export const TEMPORARY_BINDINGS = frozen([
  bindingRecord(
      "operator-deploy",
      PROJECT_SCOPE,
      OPERATOR_MEMBER,
      `${PROJECT_SCOPE}/roles/academyFunctionsDeployV1`,
  ),
  bindingRecord(
      "operator-deploy-token-creator",
      serviceAccountScope(
          "academy-functions-deployer@" +
          "daegu-miami-production.iam.gserviceaccount.com",
      ),
      OPERATOR_MEMBER,
      "roles/iam.serviceAccountTokenCreator",
  ),
  bindingRecord(
      "deploy-act-as-build",
      serviceAccountScope(
          "academy-functions-build@" +
          "daegu-miami-production.iam.gserviceaccount.com",
      ),
      DEPLOY_MEMBER,
      "roles/iam.serviceAccountUser",
  ),
  bindingRecord(
      "deploy-act-as-writer",
      serviceAccountScope(
          "academy-private-writer-runtime@" +
          "daegu-miami-production.iam.gserviceaccount.com",
      ),
      DEPLOY_MEMBER,
      "roles/iam.serviceAccountUser",
  ),
  bindingRecord(
      "deploy-act-as-preview",
      serviceAccountScope(
          "academy-private-preview-rt@" +
          "daegu-miami-production.iam.gserviceaccount.com",
      ),
      DEPLOY_MEMBER,
      "roles/iam.serviceAccountUser",
  ),
]);

export function buildResourceStateDigest(state) {
  return canonicalDigest(projectionWithout(state, "stateDigest"));
}

export function buildResourceState(phase) {
  assertPhase(phase);
  const absent = phase === PRE_PROVISIONING;
  const state = {
    schemaVersion: RESOURCE_STATE_SCHEMA_VERSION,
    phase,
    inventoryComplete: true,
    serviceAccounts: absent ? [] : EXPECTED_ACADEMY_SERVICE_ACCOUNTS,
    customRoles: absent ? [] : EXPECTED_CUSTOM_ROLE_DEFINITIONS,
    notFoundConfirmations: absent ? [
      ...EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS.map((resourceId) => ({
        resourceType: "SERVICE_ACCOUNT",
        resourceId,
      })),
      ...EXPECTED_CUSTOM_ROLE_IDS.map((resourceId) => ({
        resourceType: "CUSTOM_ROLE",
        resourceId,
      })),
    ] : [],
    unexpectedAcademyPrefixedServiceAccounts: [],
    unexpectedAcademyPrefixedRoles: [],
    userManagedKeys: [],
  };
  return frozen({...state, stateDigest: canonicalDigest(state)});
}

export function validateResourceState(state, phase) {
  assertPhase(phase);
  assertExactKeys(state, [
    "customRoles",
    "inventoryComplete",
    "notFoundConfirmations",
    "phase",
    "schemaVersion",
    "serviceAccounts",
    "stateDigest",
    "unexpectedAcademyPrefixedRoles",
    "unexpectedAcademyPrefixedServiceAccounts",
    "userManagedKeys",
  ], "resource state");
  if (state.schemaVersion !== RESOURCE_STATE_SCHEMA_VERSION ||
      state.phase !== phase ||
      state.inventoryComplete !== true ||
      state.stateDigest !== buildResourceStateDigest(state) ||
      state.unexpectedAcademyPrefixedServiceAccounts.length !== 0 ||
      state.unexpectedAcademyPrefixedRoles.length !== 0 ||
      state.userManagedKeys.length !== 0) {
    fail("resource state metadata, unexpected resource, key, or digest mismatch");
  }
  const absent = phase === PRE_PROVISIONING;
  exactSet(
      state.serviceAccounts,
      absent ? [] : EXPECTED_ACADEMY_SERVICE_ACCOUNTS,
      "Academy service accounts",
  );
  exactSet(
      state.customRoles,
      absent ? [] : EXPECTED_CUSTOM_ROLE_DEFINITIONS,
      "Academy custom roles",
  );
  if (!Array.isArray(state.notFoundConfirmations)) {
    fail("notFoundConfirmations must be an array");
  }
  const allowedNotFound = new Set([
    ...EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS.map((resourceId) =>
      `SERVICE_ACCOUNT:${resourceId}`),
    ...EXPECTED_CUSTOM_ROLE_IDS.map((resourceId) =>
      `CUSTOM_ROLE:${resourceId}`),
  ]);
  for (const confirmation of state.notFoundConfirmations) {
    assertExactKeys(
        confirmation,
        ["resourceId", "resourceType"],
        "notFound confirmation",
    );
    if (!absent ||
        !allowedNotFound.has(
            `${confirmation.resourceType}:${confirmation.resourceId}`,
        )) {
      fail("notFound confirmation is not an expected absent resource");
    }
  }
  return true;
}

export const TARGET_FUNCTION_NAMES = frozen([
  "previewFixedPrivateLessonOutcomeAction",
  "createFixedPrivateLessonAssignment",
  "commitFixedPrivateLessonOutcomeAction",
]);

export const ALL_FUNCTION_NAMES = frozen([
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

export const EXISTING_FUNCTION_NAMES = frozen(
    ALL_FUNCTION_NAMES.filter((name) => !TARGET_FUNCTION_NAMES.includes(name)),
);

function existingFunctionRecord(functionName) {
  return {
    functionName,
    generation: "GEN_2",
    region: REGION,
    state: "PINNED_BASELINE",
  };
}

function targetFunctionRecord(functionName, state) {
  return {
    functionName,
    generation: "GEN_2",
    region: REGION,
    state,
  };
}

export function buildFunctionStateDigest(state) {
  return canonicalDigest(projectionWithout(state, "stateDigest"));
}

export function buildFunctionState(phase) {
  assertPhase(phase);
  const deployed = MIGRATION_PHASES.indexOf(phase) >=
    MIGRATION_PHASES.indexOf(POST_PRIVATE_DEPLOY_PRE_PUBLICATION);
  const published = MIGRATION_PHASES.indexOf(phase) >=
    MIGRATION_PHASES.indexOf(POST_PUBLICATION_PRE_CLEANUP);
  const targetState = !deployed ?
    "ABSENT" :
    published ? "ACTIVE_PUBLIC" : "ACTIVE_PRIVATE";
  const existingFunctionRecords =
    EXISTING_FUNCTION_NAMES.map(existingFunctionRecord);
  const targetFunctionRecords =
    TARGET_FUNCTION_NAMES.map((name) =>
      targetFunctionRecord(name, targetState));
  const inventoryRecords = deployed ?
    [...existingFunctionRecords, ...targetFunctionRecords] :
    existingFunctionRecords;
  const state = {
    existingFunctionBaselineDigest: EXISTING_FUNCTION_BASELINE_DIGEST,
    existingBaselineUnchanged: true,
    existingFunctionCount: 32,
    existingGen1FunctionCount: 0,
    existingGen2FunctionCount: 32,
    existingFunctionRecords,
    targetFunctionRecords,
    finalFunctionCount: deployed ? 35 : 32,
    finalGen2FunctionCount: deployed ? 35 : 32,
    inventoryDigest:
      canonicalSetDigest(inventoryRecords, "function_inventory"),
  };
  return frozen({...state, stateDigest: canonicalDigest(state)});
}

export function validateFunctionState(state, phase) {
  exact(state, buildFunctionState(phase), "Function state");
  if (state.stateDigest !== buildFunctionStateDigest(state) ||
      state.existingFunctionBaselineDigest !==
        EXISTING_FUNCTION_BASELINE_DIGEST ||
      state.existingBaselineUnchanged !== true) {
    fail("Function state digest or existing baseline pin mismatch");
  }
  return true;
}

function buildReceipt(schemaVersion, fields) {
  const projection = {schemaVersion, ...fields};
  return frozen({...projection, receiptDigest: canonicalDigest(projection)});
}

export function buildPrivateValidationReceipt() {
  return buildReceipt("academy_private_validation_receipt.v1", {
    targets: TARGET_FUNCTION_NAMES,
    allTargetsPrivate: true,
    finalFunctionCount: 35,
    finalGen2FunctionCount: 35,
    existingFunctionBaselineDigest: EXISTING_FUNCTION_BASELINE_DIGEST,
  });
}

export function buildPublicationReceipt() {
  const privateReceipt = buildPrivateValidationReceipt();
  return buildReceipt("academy_publication_receipt.v1", {
    privateValidationReceiptDigest: privateReceipt.receiptDigest,
    targets: TARGET_FUNCTION_NAMES,
    publicInvokerMember: "allUsers",
    publicInvokerRole: "roles/run.invoker",
    publicationAfterPrivateValidation: true,
  });
}

export function buildMutationJitReceipt() {
  return buildReceipt("academy_migration_mutation_jit.v1", {
    active: true,
    operator: OPERATOR_MEMBER,
    temporaryBindingSetDigest:
      canonicalSetDigest(TEMPORARY_BINDINGS, "temporary_bindings"),
  });
}

function validateReceiptDigest(receipt, label) {
  if (!isPlainObject(receipt) ||
      receipt.receiptDigest !==
        canonicalDigest(projectionWithout(receipt, "receiptDigest"))) {
    fail(`${label} digest mismatch`);
  }
}

export function buildPhaseEvidenceDigest(evidence) {
  return canonicalDigest(projectionWithout(evidence, "evidenceDigest"));
}

export function buildPhaseEvidence(phase) {
  assertPhase(phase);
  const phaseIndex = MIGRATION_PHASES.indexOf(phase);
  const privatePhase = phaseIndex >=
    MIGRATION_PHASES.indexOf(POST_PRIVATE_DEPLOY_PRE_PUBLICATION);
  const publicationPhase = phaseIndex >=
    MIGRATION_PHASES.indexOf(POST_PUBLICATION_PRE_CLEANUP);
  const finalPhase = phase === FINAL_STEADY_STATE;
  const evidence = {
    schemaVersion: PHASE_EVIDENCE_SCHEMA_VERSION,
    phase,
    legacyBaselineDigest: LEGACY_IAM_BASELINE_DIGEST,
    legacyRecords: OWNER_PHASES.includes(phase) ?
      LEGACY_IAM_BASELINE_RECORDS :
      DEFERRED_LEGACY_IAM_RECORDS,
    reviewedManagedBindings: REVIEWED_MANAGED_IDENTITY_BINDINGS,
    firebaseDependencyBindings: FIREBASE_DEPENDENCY_BINDINGS,
    resourceState: buildResourceState(phase),
    functionState: buildFunctionState(phase),
    leastPrivilegeProofBindings:
      phase === PRE_PROVISIONING ? [] : PERMANENT_BINDINGS,
    mutationJitReceipt:
      phase === PRE_PROVISIONING || finalPhase ?
        null :
        buildMutationJitReceipt(),
    privateValidationReceipt:
      privatePhase ? buildPrivateValidationReceipt() : null,
    publicationReceipt:
      publicationPhase ? buildPublicationReceipt() : null,
    temporaryAccessBindings:
      phase === PRE_PROVISIONING || finalPhase ? [] : TEMPORARY_BINDINGS,
    decommissionPlan: DECOMMISSION_PLAN,
  };
  return frozen({...evidence, evidenceDigest: canonicalDigest(evidence)});
}

export function validatePhaseEvidence(evidence) {
  assertExactKeys(evidence, [
    "decommissionPlan",
    "evidenceDigest",
    "firebaseDependencyBindings",
    "functionState",
    "leastPrivilegeProofBindings",
    "legacyBaselineDigest",
    "legacyRecords",
    "mutationJitReceipt",
    "phase",
    "privateValidationReceipt",
    "publicationReceipt",
    "resourceState",
    "reviewedManagedBindings",
    "schemaVersion",
    "temporaryAccessBindings",
  ], "phase evidence");
  assertPhase(evidence.phase);
  if (evidence.schemaVersion !== PHASE_EVIDENCE_SCHEMA_VERSION ||
      evidence.legacyBaselineDigest !== LEGACY_IAM_BASELINE_DIGEST ||
      evidence.evidenceDigest !== buildPhaseEvidenceDigest(evidence)) {
    fail("phase evidence version, baseline, or digest mismatch");
  }
  validateLegacyIamBaselineSet(evidence.legacyRecords, evidence.phase);
  validateReviewedManagedIdentitySet(evidence.reviewedManagedBindings);
  exactSet(
      evidence.firebaseDependencyBindings,
      FIREBASE_DEPENDENCY_BINDINGS,
      "Firebase dependency bindings",
  );
  validateResourceState(evidence.resourceState, evidence.phase);
  validateFunctionState(evidence.functionState, evidence.phase);
  validateLeastPrivilegeProofBindings(
      evidence.leastPrivilegeProofBindings,
      evidence.phase,
  );
  validateDecommissionPlan(evidence.decommissionPlan);

  const phaseIndex = MIGRATION_PHASES.indexOf(evidence.phase);
  const privatePhase = phaseIndex >=
    MIGRATION_PHASES.indexOf(POST_PRIVATE_DEPLOY_PRE_PUBLICATION);
  const publicationPhase = phaseIndex >=
    MIGRATION_PHASES.indexOf(POST_PUBLICATION_PRE_CLEANUP);
  const finalPhase = evidence.phase === FINAL_STEADY_STATE;
  const expectedTemporary =
    evidence.phase === PRE_PROVISIONING || finalPhase ?
      [] :
      TEMPORARY_BINDINGS;
  exactSet(
      evidence.temporaryAccessBindings,
      expectedTemporary,
      "temporary Academy access",
  );
  if (evidence.phase === PRE_PROVISIONING) {
    if (evidence.mutationJitReceipt !== null) {
      fail("PRE_PROVISIONING forbids active mutation or JIT receipt");
    }
  } else if (finalPhase) {
    if (evidence.mutationJitReceipt !== null) {
      fail("FINAL_STEADY_STATE forbids active mutation or JIT receipt");
    }
  } else {
    exact(
        evidence.mutationJitReceipt,
        buildMutationJitReceipt(),
        "mutation JIT receipt",
    );
  }
  if (privatePhase) {
    exact(
        evidence.privateValidationReceipt,
        buildPrivateValidationReceipt(),
        "private validation receipt",
    );
    validateReceiptDigest(
        evidence.privateValidationReceipt,
        "private validation receipt",
    );
  } else if (evidence.privateValidationReceipt !== null) {
    fail("private validation receipt is premature");
  }
  if (publicationPhase) {
    exact(
        evidence.publicationReceipt,
        buildPublicationReceipt(),
        "publication receipt",
    );
    validateReceiptDigest(evidence.publicationReceipt, "publication receipt");
  } else if (evidence.publicationReceipt !== null) {
    fail("public invoker publication is premature");
  }
  return true;
}

function rollbackSetDigest(records, label) {
  return canonicalSetDigest(records, `rollback_${label}_bindings`);
}

export function buildRollbackReceiptDigest(receipt) {
  return canonicalDigest(projectionWithout(receipt, "receiptDigest"));
}

export function buildRollbackReceipt({
  phase = POST_PROVISIONING_PRE_DEPLOY,
  beforeRecords = [],
  restoredRecords = [LEGACY_IAM_BASELINE_RECORDS[0]],
  automatic = true,
  breakGlassApprovalSha256 = null,
} = {}) {
  assertPhase(phase);
  const afterRecords = [...beforeRecords, ...restoredRecords];
  const receipt = {
    schemaVersion: ROLLBACK_RECEIPT_SCHEMA_VERSION,
    phase,
    originalBaselineDigest: LEGACY_IAM_BASELINE_DIGEST,
    automatic,
    breakGlassApprovalSha256,
    beforeRecords,
    beforeBindingSetDigest: rollbackSetDigest(beforeRecords, "before"),
    restoredRecords,
    restoredBindingSetDigest: rollbackSetDigest(restoredRecords, "restored"),
    afterRecords,
    afterBindingSetDigest: rollbackSetDigest(afterRecords, "after"),
  };
  return frozen({...receipt, receiptDigest: canonicalDigest(receipt)});
}

export function validateRollbackReceipt(receipt) {
  assertExactKeys(receipt, [
    "afterBindingSetDigest",
    "afterRecords",
    "automatic",
    "beforeBindingSetDigest",
    "beforeRecords",
    "breakGlassApprovalSha256",
    "originalBaselineDigest",
    "phase",
    "receiptDigest",
    "restoredBindingSetDigest",
    "restoredRecords",
    "schemaVersion",
  ], "rollback receipt");
  assertPhase(receipt.phase);
  if (receipt.schemaVersion !== ROLLBACK_RECEIPT_SCHEMA_VERSION ||
      receipt.originalBaselineDigest !== LEGACY_IAM_BASELINE_DIGEST ||
      receipt.beforeBindingSetDigest !==
        rollbackSetDigest(receipt.beforeRecords, "before") ||
      receipt.restoredBindingSetDigest !==
        rollbackSetDigest(receipt.restoredRecords, "restored") ||
      receipt.afterBindingSetDigest !==
        rollbackSetDigest(receipt.afterRecords, "after") ||
      receipt.receiptDigest !== buildRollbackReceiptDigest(receipt)) {
    fail("rollback receipt digest or authority mismatch");
  }
  const baselineByDigest = new Map(
      LEGACY_IAM_BASELINE_RECORDS.map((record) =>
        [record.baselineRecordDigest, record]),
  );
  for (const [setName, records] of [
    ["before", receipt.beforeRecords],
    ["after", receipt.afterRecords],
  ]) {
    for (const record of records) {
      const baseline = baselineByDigest.get(record.baselineRecordDigest);
      if (!baseline || canonicalJson(record) !== canonicalJson(baseline)) {
        fail(`rollback ${setName} records must be original baseline subsets`);
      }
    }
  }
  for (const restored of receipt.restoredRecords) {
    const baseline = baselineByDigest.get(restored.baselineRecordDigest);
    if (!baseline || canonicalJson(restored) !== canonicalJson(baseline)) {
      fail("rollback restoration is not an exact original baseline subset");
    }
    const ownerAfterPublication = restored.recordId === "human-owner" &&
      [
        POST_PUBLICATION_PRE_CLEANUP,
        FINAL_STEADY_STATE,
      ].includes(receipt.phase);
    if (ownerAfterPublication) {
      if (receipt.automatic !== false ||
          !SHA256_HEX.test(receipt.breakGlassApprovalSha256 ?? "")) {
        fail("Owner restoration after publication requires break-glass SHA");
      }
    } else if (!restored.allowedMigrationPhases.includes(receipt.phase)) {
      fail("rollback restoration is forbidden in this phase");
    }
  }
  const restoresLateOwner = receipt.restoredRecords.some(({recordId}) =>
    recordId === "human-owner") &&
    [
      POST_PUBLICATION_PRE_CLEANUP,
      FINAL_STEADY_STATE,
    ].includes(receipt.phase);
  if (!restoresLateOwner &&
      (receipt.automatic !== true ||
       receipt.breakGlassApprovalSha256 !== null)) {
    fail("non-break-glass rollback must be automatic with no approval SHA");
  }
  const expectedAfter = [...receipt.beforeRecords, ...receipt.restoredRecords];
  exactSet(receipt.afterRecords, expectedAfter, "rollback after records");
  return true;
}

function serviceAccountPolicy(serviceAccount) {
  return {
    serviceAccount: serviceAccount.email,
    scope: serviceAccountScope(serviceAccount.email),
    bindings: [],
  };
}

function runInvokerBinding(functionName) {
  return bindingRecord(
      `public-run-invoker-${functionName}`,
      `${PROJECT_SCOPE}/locations/${REGION}/services/${functionName}`,
      "allUsers",
      "roles/run.invoker",
  );
}

export const TARGET_RUN_INVOKER_BINDINGS = frozen(
    TARGET_FUNCTION_NAMES.map(runInvokerBinding),
);

export const EXPECTED_EFFECTIVE_PERMISSION_RECORDS = frozen([
  {
    member: BUILD_MEMBER,
    permissions: BUILD_CORE_PERMISSIONS,
  },
  {
    member: BASELINE_RUNTIME_MEMBER,
    permissions: READ_ONLY_RUNTIME_PERMISSIONS,
  },
  {
    member: WRITER_MEMBER,
    permissions: WRITER_RUNTIME_PERMISSIONS,
  },
  {
    member: PREVIEW_MEMBER,
    permissions: READ_ONLY_RUNTIME_PERMISSIONS,
  },
]);

const FINAL_PROJECT_BINDINGS = frozen([
  ...PERMANENT_BINDINGS.filter(({scope}) => scope === PROJECT_SCOPE),
  ...DEFERRED_LEGACY_IAM_RECORDS,
  ...REVIEWED_MANAGED_IDENTITY_BINDINGS,
  ...FIREBASE_DEPENDENCY_BINDINGS,
]);
const FINAL_SERVICE_ACCOUNT_POLICIES = frozen(
    EXPECTED_ACADEMY_SERVICE_ACCOUNTS.map(serviceAccountPolicy),
);
const FINAL_SOURCE_BUCKET_POLICY = frozen({
  scope: SOURCE_BUCKET,
  bindings: PERMANENT_BINDINGS.filter(({scope}) => scope === SOURCE_BUCKET),
});
const FINAL_UPLOAD_BUCKET_POLICY = frozen({
  scope: UPLOAD_BUCKET,
  bindings: PERMANENT_BINDINGS.filter(({scope}) => scope === UPLOAD_BUCKET),
});
const FINAL_REPOSITORY_POLICY = frozen({
  scope: ARTIFACT_REPOSITORY,
  bindings:
    PERMANENT_BINDINGS.filter(({scope}) => scope === ARTIFACT_REPOSITORY),
});

function finalAuditProjection() {
  const functionState = buildFunctionState(FINAL_STEADY_STATE);
  const bindingSet = [
    ...FINAL_PROJECT_BINDINGS,
    ...FINAL_SERVICE_ACCOUNT_POLICIES.flatMap(({bindings}) => bindings),
    ...FINAL_SOURCE_BUCKET_POLICY.bindings,
    ...FINAL_UPLOAD_BUCKET_POLICY.bindings,
    ...FINAL_REPOSITORY_POLICY.bindings,
    ...TARGET_RUN_INVOKER_BINDINGS,
  ];
  const projection = {
    schemaVersion: FINAL_IAM_AUDIT_SCHEMA_VERSION,
    phase: FINAL_STEADY_STATE,
    projectBindings: FINAL_PROJECT_BINDINGS,
    serviceAccountPolicies: FINAL_SERVICE_ACCOUNT_POLICIES,
    sourceBucketPolicy: FINAL_SOURCE_BUCKET_POLICY,
    uploadBucketPolicy: FINAL_UPLOAD_BUCKET_POLICY,
    repositoryPolicy: FINAL_REPOSITORY_POLICY,
    roleDefinitions: EXPECTED_CUSTOM_ROLE_DEFINITIONS,
    effectivePermissionRecords: EXPECTED_EFFECTIVE_PERMISSION_RECORDS,
    temporaryAccessBindings: [],
    legacyExceptions: DEFERRED_LEGACY_IAM_RECORDS,
    decommissionPlan: DECOMMISSION_PLAN,
    reviewedManagedBindings: REVIEWED_MANAGED_IDENTITY_BINDINGS,
    unexpectedAcademyResources: [],
    userManagedKeys: [],
    runInvokerBindings: TARGET_RUN_INVOKER_BINDINGS,
    functionState,
    bindingSetDigest:
      canonicalSetDigest(bindingSet, "final_complete_binding_set"),
    projectBindingSetDigest:
      canonicalSetDigest(FINAL_PROJECT_BINDINGS, "final_project_bindings"),
    serviceAccountPolicySetDigest: canonicalSetDigest(
        FINAL_SERVICE_ACCOUNT_POLICIES,
        "final_service_account_policies",
    ),
    resourcePolicySetDigest: canonicalSetDigest([
      FINAL_SOURCE_BUCKET_POLICY,
      FINAL_UPLOAD_BUCKET_POLICY,
      FINAL_REPOSITORY_POLICY,
    ], "final_resource_policies"),
    roleDefinitionSetDigest: canonicalSetDigest(
        EXPECTED_CUSTOM_ROLE_DEFINITIONS,
        "final_role_definitions",
    ),
    effectivePermissionDigest: canonicalSetDigest(
        EXPECTED_EFFECTIVE_PERMISSION_RECORDS,
        "final_effective_permissions",
    ),
    legacyExceptionDigest: canonicalSetDigest(
        DEFERRED_LEGACY_IAM_RECORDS,
        "final_legacy_exceptions",
    ),
    reviewedManagedIdentityDigest: canonicalSetDigest(
        REVIEWED_MANAGED_IDENTITY_BINDINGS,
        "final_reviewed_managed_bindings",
    ),
    temporaryAccessCount: 0,
    temporaryAccessDigest:
      canonicalSetDigest([], "final_temporary_access"),
    finalInventoryDigest: functionState.inventoryDigest,
  };
  return projection;
}

export function buildFinalIamAuditDigest(audit) {
  return canonicalDigest(projectionWithout(audit, "auditDigest"));
}

export function buildFinalIamAudit() {
  const projection = finalAuditProjection();
  return frozen({...projection, auditDigest: canonicalDigest(projection)});
}

export function validateFinalIamAudit(audit) {
  assertExactKeys(audit, [
    "auditDigest",
    "bindingSetDigest",
    "decommissionPlan",
    "effectivePermissionDigest",
    "effectivePermissionRecords",
    "finalInventoryDigest",
    "functionState",
    "legacyExceptionDigest",
    "legacyExceptions",
    "phase",
    "projectBindingSetDigest",
    "projectBindings",
    "repositoryPolicy",
    "resourcePolicySetDigest",
    "reviewedManagedBindings",
    "reviewedManagedIdentityDigest",
    "roleDefinitionSetDigest",
    "roleDefinitions",
    "runInvokerBindings",
    "schemaVersion",
    "serviceAccountPolicies",
    "serviceAccountPolicySetDigest",
    "sourceBucketPolicy",
    "temporaryAccessBindings",
    "temporaryAccessCount",
    "temporaryAccessDigest",
    "unexpectedAcademyResources",
    "uploadBucketPolicy",
    "userManagedKeys",
  ], "final IAM audit");
  if (audit.schemaVersion !== FINAL_IAM_AUDIT_SCHEMA_VERSION ||
      audit.phase !== FINAL_STEADY_STATE ||
      audit.auditDigest !== buildFinalIamAuditDigest(audit)) {
    fail("final IAM audit version, phase, or digest mismatch");
  }
  const expected = finalAuditProjection();
  for (const key of Object.keys(expected)) {
    exact(audit[key], expected[key], `final IAM audit ${key}`);
  }
  if (audit.projectBindingSetDigest !==
        canonicalSetDigest(audit.projectBindings, "final_project_bindings") ||
      audit.bindingSetDigest !== canonicalSetDigest([
        ...audit.projectBindings,
        ...audit.serviceAccountPolicies.flatMap(({bindings}) => bindings),
        ...audit.sourceBucketPolicy.bindings,
        ...audit.uploadBucketPolicy.bindings,
        ...audit.repositoryPolicy.bindings,
        ...audit.runInvokerBindings,
      ], "final_complete_binding_set") ||
      audit.serviceAccountPolicySetDigest !== canonicalSetDigest(
          audit.serviceAccountPolicies,
          "final_service_account_policies",
      ) ||
      audit.resourcePolicySetDigest !== canonicalSetDigest([
        audit.sourceBucketPolicy,
        audit.uploadBucketPolicy,
        audit.repositoryPolicy,
      ], "final_resource_policies") ||
      audit.roleDefinitionSetDigest !== canonicalSetDigest(
          audit.roleDefinitions,
          "final_role_definitions",
      ) ||
      audit.effectivePermissionDigest !== canonicalSetDigest(
          audit.effectivePermissionRecords,
          "final_effective_permissions",
      ) ||
      audit.legacyExceptionDigest !== canonicalSetDigest(
          audit.legacyExceptions,
          "final_legacy_exceptions",
      ) ||
      audit.reviewedManagedIdentityDigest !== canonicalSetDigest(
          audit.reviewedManagedBindings,
          "final_reviewed_managed_bindings",
      ) ||
      audit.temporaryAccessCount !== audit.temporaryAccessBindings.length ||
      audit.temporaryAccessDigest !== canonicalSetDigest(
          audit.temporaryAccessBindings,
          "final_temporary_access",
      ) ||
      audit.finalInventoryDigest !== audit.functionState.inventoryDigest) {
    fail("final IAM audit derived count or digest mismatch");
  }
  validateFunctionState(audit.functionState, FINAL_STEADY_STATE);
  validateDecommissionPlan(audit.decommissionPlan);
  validateReviewedManagedIdentitySet(audit.reviewedManagedBindings);
  validateLegacyIamBaselineSet(audit.legacyExceptions, FINAL_STEADY_STATE);
  if (audit.temporaryAccessBindings.length !== 0 ||
      audit.unexpectedAcademyResources.length !== 0 ||
      audit.userManagedKeys.length !== 0) {
    fail("final IAM audit contains temporary access, keys, or unexpected data");
  }
  return true;
}

const authorityProjection = {
  schemaVersion: MIGRATION_AUTHORITY_SCHEMA_VERSION,
  project: {
    projectId: PROJECT_ID,
    projectNumber: PROJECT_NUMBER,
    scope: PROJECT_SCOPE,
    region: REGION,
  },
  versions: {
    baseline: LEGACY_IAM_BASELINE_SCHEMA_VERSION,
    reviewedManagedIdentity: REVIEWED_MANAGED_IDENTITY_SCHEMA_VERSION,
    decommissionPlan: DECOMMISSION_PLAN_SCHEMA_VERSION,
    resourceState: RESOURCE_STATE_SCHEMA_VERSION,
    phaseEvidence: PHASE_EVIDENCE_SCHEMA_VERSION,
    rollbackReceipt: ROLLBACK_RECEIPT_SCHEMA_VERSION,
    finalAudit: FINAL_IAM_AUDIT_SCHEMA_VERSION,
  },
  phases: MIGRATION_PHASES,
  legacyBaselineRecords: LEGACY_IAM_BASELINE_RECORDS,
  legacyBaselineDigest: LEGACY_IAM_BASELINE_DIGEST,
  reviewedManagedBindings: REVIEWED_MANAGED_IDENTITY_BINDINGS,
  reviewedManagedIdentityDigest: REVIEWED_MANAGED_IDENTITY_DIGEST,
  knownSameProjectDefaults: KNOWN_SAME_PROJECT_DEFAULT_SERVICE_ACCOUNTS,
  decommissionPlan: DECOMMISSION_PLAN,
  expectedServiceAccounts: EXPECTED_ACADEMY_SERVICE_ACCOUNTS,
  expectedRoleDefinitions: EXPECTED_CUSTOM_ROLE_DEFINITIONS,
  permanentBindings: PERMANENT_BINDINGS,
  temporaryBindings: TEMPORARY_BINDINGS,
  firebaseDependencyBindings: FIREBASE_DEPENDENCY_BINDINGS,
  targetRunInvokerBindings: TARGET_RUN_INVOKER_BINDINGS,
  existingFunctionBaselineDigest: EXISTING_FUNCTION_BASELINE_DIGEST,
};

export const ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY = frozen({
  ...authorityProjection,
  authorityDigest: canonicalDigest(authorityProjection),
});
export const ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST =
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY.authorityDigest;

export function validateMigrationAuthority(
    authority = ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY,
) {
  exact(
      authority,
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY,
      "migration authority",
  );
  if (authority.authorityDigest !==
      canonicalDigest(projectionWithout(authority, "authorityDigest"))) {
    fail("migration authority digest mismatch");
  }
  return true;
}

validateMigrationAuthority();
