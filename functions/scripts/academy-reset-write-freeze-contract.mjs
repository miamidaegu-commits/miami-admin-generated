import crypto from "node:crypto";
import {
  ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
  EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
  RESET_COLLECTIONS,
  WRITE_SOURCE_SHA256_ALLOWLIST,
  WRITE_SURFACE_REGISTRY_VERSION,
  assertWriteSurfaceRegistry,
} from "./academy-reset-write-surface-registry.mjs";

export const WRITE_FREEZE_CONTRACT_VERSION =
  "academy_reset_write_freeze.v2";
export const WRITE_FREEZE_PROOF_VERSION =
  "academy_reset_write_freeze_proof.v2";
export const DEPLOYMENT_APPROVAL_RECEIPT_VERSION =
  "academy_reset_deployment_approval.v2";
export const PROVIDER_OBSERVATION_VERSION =
  "academy_reset_provider_observation.v2";
export const APPROVED_PROVIDER_ADAPTER_ID =
  "gcp_immutable_resource_observer.v1";
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
export const EXPECTED_ACADEMY_ID = "academy_daegumiami";
export const EXPECTED_FUNCTION_REGION = "us-central1";
export const EXPECTED_FUNCTION_GENERATION = "GEN_2";
export const REQUIRED_COMPARISON_BASELINE_DIGEST =
  "cb1c716340afe12a8ec1d9ce77c3466d7808505fff33ce7ae3841eb95898a3b9";
export const MAX_FREEZE_WINDOW_SECONDS = 3600;

const INFRASTRUCTURE_RUNTIME_SOURCE_PATHS = Object.freeze([
  "firestore.rules",
  "functions/academy-reset-write-freeze.js",
  "functions/linkStudentAccountSafety.cjs",
  "functions/scripts/academy-reset-write-freeze-contract.mjs",
  "functions/scripts/academy-reset-write-surface-registry.mjs",
  "functions/scripts/verify-academy-reset-write-freeze.mjs",
]);
export const CRITICAL_RUNTIME_SOURCE_PATHS = Object.freeze([
  ...new Set([
    ...INFRASTRUCTURE_RUNTIME_SOURCE_PATHS,
    ...WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile}) => sourceFile),
  ]),
].sort());

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

export const NON_EXECUTOR_EFFECTIVE_PERMISSIONS = Object.freeze([
  "datastore.databases.get",
  "datastore.entities.get",
  "datastore.entities.list",
]);
export const FUTURE_EXECUTOR_EFFECTIVE_PERMISSIONS = Object.freeze([
  ...NON_EXECUTOR_EFFECTIVE_PERMISSIONS,
  "datastore.entities.delete",
].sort());

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
  "audit",
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
const ISO_UTC = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/;
const EXACT_TOP_LEVEL_KEYS = Object.freeze([
  "academyId",
  "artifactDigest",
  "baselineComparison",
  "deploymentApprovalReceipt",
  "freezeWindow",
  "iamPolicy",
  "negativeProbes",
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
  if (!ISO_UTC.test(requireString(value, label)) ||
      !Number.isFinite(Date.parse(value))) {
    fail(`${label} must be an ISO UTC timestamp`);
  }
}
function latestUtcTimestamp(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    fail(`${label} timestamps are missing`);
  }
  values.forEach((value, index) =>
    requireUtc(value, `${label}[${index}]`));
  return values.reduce((latest, current) =>
    Date.parse(current) > Date.parse(latest) ? current : latest);
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
    if (SECRET_KEY_PATTERN.test(key)) fail(`secret-bearing key at ${path}.${key}`);
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
      ["clean", "criticalSources", "headSha", "treeSha"],
      "release.runtimeGit");
  requireGitSha(release.runtimeGit.headSha, "release.runtimeGit.headSha");
  requireGitSha(release.runtimeGit.treeSha, "release.runtimeGit.treeSha");
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
}

function validateSourceBundle(bundle, label) {
  exactKeys(bundle, ["bucket", "generation", "object", "sha256"], label);
  requireString(bundle.bucket, `${label}.bucket`);
  requireString(bundle.object, `${label}.object`);
  requireString(bundle.generation, `${label}.generation`);
  requireDigest(bundle.sha256, `${label}.sha256`);
}

export function parseRulesResourceIdentity(rules, label = "rules") {
  exactKeys(rules,
      ["deploymentId", "rulesetId", "sourceBundle", "updateTime"], label);
  const deploymentId = requireString(
      rules.deploymentId,
      `${label}.deploymentId`,
  );
  const rulesetId = requireString(rules.rulesetId, `${label}.rulesetId`);
  requireUtc(rules.updateTime, `${label}.updateTime`);
  validateSourceBundle(rules.sourceBundle, `${label}.sourceBundle`);

  const rulesetMatch =
    /^projects\/([^/]+)\/rulesets\/([^/]+)$/.exec(rulesetId);
  const releaseMatch =
    /^projects\/([^/]+)\/releases\/(cloud\.firestore)$/.exec(deploymentId);
  if (!rulesetMatch || !releaseMatch) {
    fail(`${label} has a malformed Rules resource name`);
  }
  if (rulesetMatch[1] !== EXPECTED_PROJECT_ID ||
      releaseMatch[1] !== EXPECTED_PROJECT_ID ||
      rulesetMatch[1] !== releaseMatch[1]) {
    fail(`${label} Rules resources do not match the pinned project identity`);
  }

  return Object.freeze({
    projectId: rulesetMatch[1],
    projectNumber: EXPECTED_PROJECT_NUMBER,
    rulesetResourceName: rulesetId,
    rulesetId: rulesetMatch[2],
    releaseResourceName: deploymentId,
    releaseId: releaseMatch[2],
    updateTime: rules.updateTime,
    sourceBundle: Object.freeze({...rules.sourceBundle}),
  });
}
function validateFunctionIdentity(item, label) {
  exactKeys(item, [
    "buildId", "generation", "name", "projectId", "region", "revisionId",
    "sourceBundle", "updateTime",
  ], label);
  requireString(item.name, `${label}.name`);
  requireString(item.buildId, `${label}.buildId`);
  requireString(item.revisionId, `${label}.revisionId`);
  requireUtc(item.updateTime, `${label}.updateTime`);
  validateSourceBundle(item.sourceBundle, `${label}.sourceBundle`);
  if (item.projectId !== EXPECTED_PROJECT_ID ||
      item.region !== EXPECTED_FUNCTION_REGION ||
      item.generation !== EXPECTED_FUNCTION_GENERATION) {
    fail(`${label} target metadata mismatch`);
  }
}
function validateDeploymentResources(resources, label) {
  exactKeys(resources, [
    "functions", "projectIdentityContractVersion", "projectId",
    "projectNumber", "rules",
  ], label);
  validatePinnedProjectIdentity(resources, label);
  if (resources.projectId !== EXPECTED_PROJECT_ID) {
    fail(`${label}.projectId mismatch`);
  }
  const rulesResourceIdentity =
    parseRulesResourceIdentity(resources.rules, `${label}.rules`);
  if (!Array.isArray(resources.functions)) {
    fail(`${label}.functions must be an array`);
  }
  const names = [];
  const functionUpdateTimes = [];
  resources.functions.forEach((item, index) => {
    validateFunctionIdentity(item, `${label}.functions[${index}]`);
    names.push(item.name);
    functionUpdateTimes.push(item.updateTime);
  });
  exactArray(names, EXPECTED_DEPLOYED_FUNCTION_NAMES,
      `${label}.functions deployed function`);
  return Object.freeze({
    rulesResourceIdentity,
    resourceUpdateTimes: Object.freeze([
      resources.rules.updateTime,
      ...functionUpdateTimes,
    ]),
  });
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

function validateApprovalReceipt(receipt, release) {
  exactKeys(receipt, [
    "approvedAt", "expiresAt", "iamPrincipalAllowlist", "localSources",
    "projectId", "projectIdentityContractVersion", "projectNumber", "receiptId",
    "releaseSha", "resources", "schemaVersion",
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
      ["functionsSha256", "rulesSha256", "writerSourceIdentityDigest"],
      "deploymentApprovalReceipt.localSources");
  Object.entries(receipt.localSources).forEach(([key, value]) =>
    requireDigest(value, `deploymentApprovalReceipt.localSources.${key}`));
  const runtimeByPath = new Map(
      release.runtimeGit.criticalSources.map((source) => [source.path, source]),
  );
  if (receipt.localSources.rulesSha256 !==
        runtimeByPath.get("firestore.rules")?.headSha256 ||
      receipt.localSources.functionsSha256 !==
        runtimeByPath.get("functions/index.js")?.headSha256 ||
      receipt.localSources.writerSourceIdentityDigest !==
        EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST) {
    fail("deployment approval is not bound to exact local release sources");
  }
  validateDeploymentResources(receipt.resources,
      "deploymentApprovalReceipt.resources");
  validateIamPrincipalSet(
      receipt.iamPrincipalAllowlist,
      "deploymentApprovalReceipt.iamPrincipalAllowlist",
  );
}

export function validateProviderDeploymentVerification(
    evidence,
    providerResult,
) {
  exactKeys(providerResult,
      ["adapterId", "approvalReceipt", "observation"], "provider result");
  if (providerResult.adapterId !== APPROVED_PROVIDER_ADAPTER_ID) {
    fail("provider adapter is not approved");
  }
  if (stableStringify(providerResult.approvalReceipt) !==
      stableStringify(evidence.deploymentApprovalReceipt)) {
    fail("provider approval receipt does not exactly match evidence receipt");
  }
  const observation = providerResult.observation;
  exactKeys(observation, [
    "adapterId", "functions", "iamPolicy", "observedAt", "projectId",
    "projectIdentityContractVersion", "projectNumber", "rules", "schemaVersion",
  ], "provider observation");
  if (observation.schemaVersion !== PROVIDER_OBSERVATION_VERSION ||
      observation.adapterId !== APPROVED_PROVIDER_ADAPTER_ID) {
    fail("provider observation target or adapter mismatch");
  }
  validatePinnedProjectIdentity(observation, "provider observation");
  requireUtc(observation.observedAt, "provider observation observedAt");
  const resources = {
    projectIdentityContractVersion:
      observation.projectIdentityContractVersion,
    projectId: observation.projectId,
    projectNumber: observation.projectNumber,
    rules: observation.rules,
    functions: observation.functions,
  };
  const deploymentResources =
    validateDeploymentResources(resources, "provider observation resources");
  if (stableStringify(resources) !==
      stableStringify(evidence.deploymentApprovalReceipt.resources)) {
    fail("immutable deployed resources differ from approved receipt");
  }
  exactKeys(observation.iamPolicy, [
    "inventoryComplete", "observedAt", "policyDigest", "principals",
  ], "provider observation IAM policy");
  requireUtc(
      observation.iamPolicy.observedAt,
      "provider observation IAM policy observedAt",
  );
  requireDigest(
      observation.iamPolicy.policyDigest,
      "provider observation IAM policy policyDigest",
  );
  if (observation.iamPolicy.inventoryComplete !== true) {
    fail("provider IAM inventory is incomplete");
  }
  const providerIamPrincipals = validateIamPrincipalSet(
      observation.iamPolicy.principals,
      "provider observation IAM principals",
      {requireSnapshotDigest: true},
  );
  const approvedIamPrincipals = validateIamPrincipalSet(
      evidence.deploymentApprovalReceipt.iamPrincipalAllowlist,
      "approved IAM principals",
  );
  if (stableStringify(providerIamPrincipals) !==
      stableStringify(approvedIamPrincipals)) {
    fail("provider IAM principals differ from approved receipt");
  }
  return Object.freeze({
    observedAt: observation.observedAt,
    latestDeploymentObservedAt: latestUtcTimestamp([
      observation.observedAt,
      ...deploymentResources.resourceUpdateTimes,
    ], "provider deployment observation"),
    rulesResourceIdentity: deploymentResources.rulesResourceIdentity,
    observationDigest: sha256Canonical(observation),
    approvalReceiptDigest: sha256Canonical(providerResult.approvalReceipt),
    iamPolicy: observation.iamPolicy,
  });
}

function validateSentinel(sentinel) {
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
  requireDigest(sentinel.snapshotDigest, "sentinel.snapshotDigest");
  requireDigest(sentinel.writerRegistryDigest, "sentinel.writerRegistryDigest");
  if (sentinel.writerRegistryDigest !==
      sha256Canonical(ACADEMY_RESET_WRITE_SURFACE_REGISTRY)) {
    fail("sentinel writer registry digest is stale");
  }
}

function validateScheduler(scheduler) {
  exactKeys(scheduler, [
    "authProvisioningInFlightExecutions", "authProvisioningIngressBlocked",
    "callableInFlightExecutions", "callableIngressBlocked", "drainEvidenceDigest",
    "drainedAt", "inventoryComplete", "jobs", "stoppedAt",
  ], "scheduler");
  requireUtc(scheduler.stoppedAt, "scheduler.stoppedAt");
  requireUtc(scheduler.drainedAt, "scheduler.drainedAt");
  requireDigest(scheduler.drainEvidenceDigest, "scheduler.drainEvidenceDigest");
  if (scheduler.inventoryComplete !== true ||
      scheduler.callableIngressBlocked !== true ||
      scheduler.callableInFlightExecutions !== 0 ||
      scheduler.authProvisioningIngressBlocked !== true ||
      scheduler.authProvisioningInFlightExecutions !== 0) {
    fail("scheduler/callable/Auth inventory is incomplete or not drained");
  }
  if (!Array.isArray(scheduler.jobs)) fail("scheduler jobs are missing");
  const expectedByName = new Map(
      SCHEDULER_JOB_ALLOWLIST.map((item) => [item.name, item]),
  );
  const names = [];
  for (const job of scheduler.jobs) {
    exactKeys(job, [
      "evidenceDigest", "inFlightExecutions", "name", "projectId", "region",
      "state", "target",
    ], "scheduler job");
    const expected = expectedByName.get(job.name);
    if (!expected ||
        ["projectId", "region", "target"].some((key) =>
          job[key] !== expected[key])) {
      fail(`unknown scheduler job or target: ${job.name}`);
    }
    requireDigest(job.evidenceDigest, `${job.name}.evidenceDigest`);
    if (job.state !== "DISABLED" || job.inFlightExecutions !== 0) {
      fail(`scheduler job is enabled or not drained: ${job.name}`);
    }
    names.push(job.name);
  }
  exactArray(names, SCHEDULER_JOB_ALLOWLIST.map(({name}) => name),
      "scheduler job");
  if (Date.parse(scheduler.stoppedAt) > Date.parse(scheduler.drainedAt)) {
    fail("scheduler stoppedAt must precede drainedAt");
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
  exactKeys(iamPolicy,
      ["inventoryComplete", "policyDigest", "principals", "readOnlyObservedAt"],
      "iamPolicy");
  requireUtc(iamPolicy.readOnlyObservedAt, "iamPolicy.readOnlyObservedAt");
  requireDigest(iamPolicy.policyDigest, "iamPolicy.policyDigest");
  if (iamPolicy.inventoryComplete !== true ||
      !Array.isArray(iamPolicy.principals)) fail("IAM inventory is incomplete");
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
  if (iamPolicy.readOnlyObservedAt !== providerIamPolicy.observedAt ||
      iamPolicy.policyDigest !== providerIamPolicy.policyDigest ||
      iamPolicy.inventoryComplete !== providerIamPolicy.inventoryComplete ||
      stableStringify(iamPolicy.principals
          .map((principal) => ({...principal}))
          .sort((left, right) => left.id.localeCompare(right.id))) !==
        stableStringify(providerIamPolicy.principals
            .map((principal) => ({...principal}))
            .sort((left, right) => left.id.localeCompare(right.id)))) {
    fail("IAM evidence does not exactly match provider IAM observation");
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

function validateFreezeTimeline(evidence, deploymentVerification, currentTimeMs) {
  exactKeys(evidence.freezeWindow, ["activatedAt", "expiresAt"],
      "freezeWindow");
  requireUtc(evidence.freezeWindow.activatedAt, "freezeWindow.activatedAt");
  requireUtc(evidence.freezeWindow.expiresAt, "freezeWindow.expiresAt");
  requireUtc(evidence.verifiedAt, "verifiedAt");
  const activated = Date.parse(evidence.freezeWindow.activatedAt);
  const expires = Date.parse(evidence.freezeWindow.expiresAt);
  const verified = Date.parse(evidence.verifiedAt);
  if (!Number.isFinite(currentTimeMs) || expires <= activated ||
      expires - activated > MAX_FREEZE_WINDOW_SECONDS * 1000 ||
      verified < activated || verified > expires ||
      currentTimeMs < verified || currentTimeMs > expires) {
    fail("freeze window is expired, reversed, stale, or exceeds bound");
  }
  const latestDeploymentObservedAt =
    deploymentVerification.latestDeploymentObservedAt;
  requireUtc(latestDeploymentObservedAt, "latestDeploymentObservedAt");
  const deployment = Date.parse(latestDeploymentObservedAt);
  const sentinel = Date.parse(evidence.sentinel.capturedAt);
  const stopped = Date.parse(evidence.scheduler.stoppedAt);
  const drained = Date.parse(evidence.scheduler.drainedAt);
  const iam = Date.parse(evidence.iamPolicy.readOnlyObservedAt);
  const probeObservedAts =
    evidence.negativeProbes.map(({observedAt}) => observedAt);
  const negativeProbesCompletedAt =
    latestUtcTimestamp(probeObservedAts, "negative probe observedAt");
  const probes = probeObservedAts.map(Date.parse);
  if (deployment > activated || activated > sentinel ||
      sentinel > stopped || stopped > drained || drained > iam ||
      probes.some((time) => time < iam || time > verified) ||
      verified < Math.max(...probes)) {
    fail(
        "activation order must be deployment<=activatedAt<=sentinel<=" +
        "schedulerStopped<=drained<=iamReadOnly<=probes<=verifiedAt",
    );
  }
  if (sentinel - deployment > MAX_FREEZE_WINDOW_SECONDS * 1000) {
    fail("provider deployment observation is stale for this freeze window");
  }
  const receipt = evidence.deploymentApprovalReceipt;
  if (Date.parse(receipt.approvedAt) > deployment ||
      Date.parse(receipt.expiresAt) < verified) {
    fail("deployment approval receipt is not valid for verification window");
  }
  const resourceTimes = [
    receipt.resources.rules.updateTime,
    ...receipt.resources.functions.map(({updateTime}) => updateTime),
  ].map(Date.parse);
  const providerObserved = Date.parse(deploymentVerification.observedAt);
  if (resourceTimes.some((time) => time > providerObserved)) {
    fail("provider observation predates deployed immutable resource");
  }
  return Object.freeze({
    latestDeploymentObservedAt,
    activatedAt: evidence.freezeWindow.activatedAt,
    sentinelCapturedAt: evidence.sentinel.capturedAt,
    schedulerStoppedAt: evidence.scheduler.stoppedAt,
    inFlightDrainedAt: evidence.scheduler.drainedAt,
    iamReadOnlyAt: evidence.iamPolicy.readOnlyObservedAt,
    negativeProbesCompletedAt,
    verifiedAt: evidence.verifiedAt,
  });
}

export function validateWriteFreezeEvidence(
    evidence,
    {currentTimeMs = Date.now(), providerResult} = {},
) {
  assertWriteSurfaceRegistry();
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
  validateApprovalReceipt(evidence.deploymentApprovalReceipt, evidence.release);
  if (!providerResult) fail("approved provider adapter result is required");
  const deploymentVerification =
    validateProviderDeploymentVerification(evidence, providerResult);
  validateSentinel(evidence.sentinel);
  validateScheduler(evidence.scheduler);
  const iamVerification = validateIamPolicy(
      evidence.iamPolicy,
      evidence.deploymentApprovalReceipt.iamPrincipalAllowlist,
      deploymentVerification.iamPolicy,
  );
  validateNegativeProbes(evidence.negativeProbes, evidence.sentinel);
  validateBaselineComparison(evidence.baselineComparison);
  const activationChronology =
    validateFreezeTimeline(evidence, deploymentVerification, currentTimeMs);
  return Object.freeze({
    artifactDigest,
    releaseSha: evidence.release.sha,
    writerCount: ACADEMY_RESET_WRITE_SURFACE_REGISTRY.length,
    collectionCount: RESET_COLLECTIONS.length,
    schedulerCount: evidence.scheduler.jobs.length,
    principalCount: evidence.iamPolicy.principals.length,
    negativeProbeCount: evidence.negativeProbes.length,
    activationChronology,
    ...iamVerification,
    ...deploymentVerification,
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
    providerAdapterId: APPROVED_PROVIDER_ADAPTER_ID,
    providerObservationDigest: validation.observationDigest,
    deploymentApprovalReceiptDigest: validation.approvalReceiptDigest,
    rulesResourceIdentity: validation.rulesResourceIdentity,
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
    schedulerCount: validation.schedulerCount,
    principalCount: validation.principalCount,
    principalPolicyVersion: validation.principalPolicyVersion,
    principalPolicyDigest: validation.principalPolicyDigest,
    expectedIamPrincipals: validation.expectedIamPrincipals,
    observedIamPrincipals: validation.observedIamPrincipals,
    negativeProbeCount: validation.negativeProbeCount,
    verifiedAt: evidence.verifiedAt,
    freezeExpiresAt: evidence.freezeWindow.expiresAt,
    writeFreezeVerified: true,
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
