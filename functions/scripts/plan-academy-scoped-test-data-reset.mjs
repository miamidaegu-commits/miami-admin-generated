import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLANNER_SOURCE_PATH = fs.realpathSync(__filename);
const CRITICAL_RUNTIME_SOURCE_PATHS = Object.freeze([
  "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
  "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
]);
const RESET_PLAN_VERSION = 2;
const EXPECTED_PRODUCTION_PROJECT = "daegu-miami-production";
const EXPECTED_TARGET_ACADEMY = "academy_daegumiami";
const ALL_ACADEMY_DATA_TEST_PROFILE =
  "all_academy_data_test_v1";
const PROFILE_POLICY_VERSION =
  "all_academy_data_test_v1.policy.v3";
const MEMBERSHIP_CLASSIFICATION_POLICY_VERSION =
  "academy_membership_test_reset.policy.v3";
const KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION =
  "credit_source_reference_allowlist.v2";
const PUBLICATION_SET_CONTRACT_VERSION = 1;
const CANDIDATE_SET_DIGEST_VERSION = 1;
const FINDING_SET_DIGEST_VERSION = 2;
const RUNTIME_SOURCE_CONTRACT_VERSION = 1;
const CRITICAL_RUNTIME_SOURCE_SET_DIGEST_VERSION = 1;
const ROOT_COLLECTION_SET_DIGEST_VERSION = 1;
const COLLECTION_DISCOVERY_CONTRACT_VERSION = 1;
const PUBLICATION_STATE_CONTRACT_VERSION = 1;
const EXECUTION_SAFETY_CONTRACT_VERSION = 1;
const RECORD_SET_CONTRACT_VERSION = 2;
const RECORD_SET_DIGEST_VERSION = 2;
const FIRESTORE_VALUE_CANONICALIZATION_VERSION = 3;
const TOP_LEVEL_OUTPUT_SCHEMA_VERSION = 1;
const CANONICAL_PLAN_SCHEMA_VERSION = 1;
const REDACTED_SUMMARY_SCHEMA_VERSION = 1;
const SENSITIVE_MANIFEST_SCHEMA_VERSION = 1;
export const SENSITIVE_MANIFEST_RECORD_KEYS = Object.freeze([
  "academyScopeEvidence",
  "classification",
  "collection",
  "creditSourceEvidence",
  "deletionOrderGroup",
  "directReferences",
  "documentDigest",
  "membershipProfileDecision",
  "plannerDisposition",
  "profilePolicyReason",
  "rawDocumentPath",
  "referenceFindings",
  "teacherIdentityEvidence",
  "typedDocumentKey",
]);
const OPTIONAL_SENSITIVE_MANIFEST_RECORD_KEYS = Object.freeze([
  "creditSourceEvidence",
  "membershipProfileDecision",
  "profilePolicyReason",
  "teacherIdentityEvidence",
]);
export const PUBLISHED_FINDING_SEMANTIC_KEYS = Object.freeze([
  "aliasEvidence",
  "code",
  "conflict",
  "creditSourceEvidence",
  "expectedShape",
  "family",
  "field",
  "policyReason",
  "resolvedValue",
  "severity",
  "shapeEvidence",
  "sourceClassification",
  "sourceDisposition",
  "sourceTypedKey",
  "targetCollectionClassification",
  "targetTypedKeys",
]);
const OPTIONAL_PUBLISHED_FINDING_SEMANTIC_KEYS = Object.freeze([
  "aliasEvidence",
  "conflict",
  "creditSourceEvidence",
  "expectedShape",
  "resolvedValue",
  "shapeEvidence",
]);
const REQUIRED_PUBLISHED_FINDING_SEMANTIC_KEYS = Object.freeze(
    PUBLISHED_FINDING_SEMANTIC_KEYS.filter(
        (key) => !OPTIONAL_PUBLISHED_FINDING_SEMANTIC_KEYS.includes(key),
    ),
);
export const PUBLISHED_FINDING_RECORD_KEYS = Object.freeze([
  ...PUBLISHED_FINDING_SEMANTIC_KEYS,
  "findingDigest",
  "findingIdentityDigest",
  "publishedFindingDigest",
]);
const REQUIRED_PUBLISHED_FINDING_RECORD_KEYS = Object.freeze([
  ...REQUIRED_PUBLISHED_FINDING_SEMANTIC_KEYS,
  "findingDigest",
  "findingIdentityDigest",
  "publishedFindingDigest",
]);
const CREDIT_SOURCE_EVIDENCE_KEYS = Object.freeze([
  "actualShape",
  "explicitLessonIdPresent",
  "explicitReservationIdPresent",
  "explicitSlotIdPresent",
  "lengthBucket",
  "sourceIdPresent",
  "sourceTypeCategory",
  "sourceTypeKnown",
  "sourceTypeLiteral",
  "sourceTypePresent",
]);
const REQUIRED_SENSITIVE_MANIFEST_RECORD_KEYS = Object.freeze(
    SENSITIVE_MANIFEST_RECORD_KEYS.filter(
        (key) => !OPTIONAL_SENSITIVE_MANIFEST_RECORD_KEYS.includes(key),
    ),
);
const SENSITIVE_DIRECT_REFERENCE_KEYS = Object.freeze([
  "aliasEvidence",
  "candidateTypedKeys",
  "conflict",
  "family",
  "field",
  "lookup",
  "resolvedValue",
  "targetCollections",
]);
const OPTIONAL_SENSITIVE_DIRECT_REFERENCE_KEYS = Object.freeze([
  "aliasEvidence",
  "conflict",
  "resolvedValue",
]);
const STAFF_MEMBERSHIP_ROLES = Object.freeze([
  "admin",
  "owner",
  "staff",
  "teacher",
]);
const MEMBERSHIP_STATUS_FIELDS = Object.freeze(["status"]);
const KNOWN_MEMBERSHIP_STATUSES = Object.freeze(["active"]);
const MEMBERSHIP_PRINCIPAL_UID_FIELDS = Object.freeze([
  "uid",
  "memberUid",
  "authUid",
]);
const TEACHER_IDENTITY_FIELD_FAMILIES = Object.freeze({
  authUid: Object.freeze(["teacherUid", "teacherUID"]),
  teacherId: Object.freeze(["teacherId", "teacherID"]),
  teacherKey: Object.freeze(["teacherKey"]),
});
const MINIMUM_SAFETY_SNAPSHOTS_REQUIRED = Object.freeze({
  finalPlanDigest: true,
  expectedDeleteCount: true,
  academyShellSnapshot: true,
  preservedStaffMembershipSnapshot: true,
  teacherMappingSnapshot: true,
  authUidInventory: true,
  postResetZeroStateAudit: true,
});
const IRREVERSIBLE_EXECUTOR_BOUNDARY = Object.freeze({
  irreversibleExecutorConfirmationRequired: true,
  irreversibleExecutorConfirmationName:
    "CONFIRM_IRREVERSIBLE_TEST_DATA_RESET",
  irreversibleExecutorConfirmationValue: "YES",
  exactPlanDigestRequired: true,
  exactDeleteCountRequired: true,
});
const RESET_CLASSIFICATIONS = Object.freeze({
  RESET_ALL_ACADEMY_SCOPED: "RESET_ALL_ACADEMY_SCOPED",
  RESET_WITH_PRESERVE_FILTER: "RESET_WITH_PRESERVE_FILTER",
  ARCHIVE_OR_RETAIN: "ARCHIVE_OR_RETAIN",
  GLOBAL_NEVER_RESET: "GLOBAL_NEVER_RESET",
});
const ACADEMY_SCOPE_STRATEGIES = Object.freeze({
  ACADEMY_ID_FIELD: "academy_id_field",
  ACADEMY_DOCUMENT_ID: "academy_document_id",
  MEMBERSHIP_ACADEMY_ID_FIELD: "membership_academy_id_field",
  GLOBAL_DOCUMENT: "global_document",
});
let ACADEMY_SCOPED_RESET_REGISTRY = null;
let CREDIT_SOURCE_REFERENCE_MAPPINGS = null;
let CREDIT_SOURCE_GENERIC_REFERENCE_FIELD_SPECS = null;
let RESET_REGISTRY_BY_COLLECTION = null;
let RESET_REGISTRY_COUNTS = null;
let REFERENCE_FIELD_SPECS = null;
let REFERENCE_CARDINALITY_POLICY_VERSION = null;
let assertResetRegistry = null;
let registryModulePromise = null;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;
const BANNED_FLAGS = new Set(["write", "commit", "delete", "execute"]);
const ALLOWED_FLAGS = new Set([
  "project",
  "academy",
  "release-sha",
  "summary-output",
  "sensitive-output",
  "page-size",
  "reset-profile",
]);
const RESET_CLASS = RESET_CLASSIFICATIONS.RESET_ALL_ACADEMY_SCOPED;
const PRESERVE_CLASS =
  RESET_CLASSIFICATIONS.RESET_WITH_PRESERVE_FILTER;
const RETAIN_CLASS = RESET_CLASSIFICATIONS.ARCHIVE_OR_RETAIN;
const GLOBAL_CLASS = RESET_CLASSIFICATIONS.GLOBAL_NEVER_RESET;
const SCOPE = ACADEMY_SCOPE_STRATEGIES;
const PROHIBITED_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bAuthorization\s*:/i,
  /\bBearer\s+[A-Za-z0-9._~-]+/i,
  /\b(?:access|refresh|id)[_-]?token\b/i,
  /\bprivate[_-]?key(?:[_-]?id)?\b/i,
];
const EMAIL_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

async function loadRuntimeRegistryModule() {
  if (!registryModulePromise) {
    registryModulePromise =
      import("./academy-scoped-test-data-reset-registry.mjs")
          .then((registry) => {
            if (registry.RESET_PLAN_VERSION !== RESET_PLAN_VERSION ||
                registry.EXPECTED_PRODUCTION_PROJECT !==
                  EXPECTED_PRODUCTION_PROJECT ||
                registry.EXPECTED_TARGET_ACADEMY !==
                  EXPECTED_TARGET_ACADEMY ||
                registry.ALL_ACADEMY_DATA_TEST_PROFILE !==
                  ALL_ACADEMY_DATA_TEST_PROFILE ||
                registry.PROFILE_POLICY_VERSION !==
                  PROFILE_POLICY_VERSION ||
                registry.MEMBERSHIP_CLASSIFICATION_POLICY_VERSION !==
                  MEMBERSHIP_CLASSIFICATION_POLICY_VERSION ||
                registry.KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION !==
                  KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION ||
                registry.REFERENCE_CARDINALITY_POLICY_VERSION !== 1 ||
                stableStringify(registry.STAFF_MEMBERSHIP_ROLES) !==
                  stableStringify(STAFF_MEMBERSHIP_ROLES) ||
                stableStringify(registry.MEMBERSHIP_STATUS_FIELDS) !==
                  stableStringify(MEMBERSHIP_STATUS_FIELDS) ||
                stableStringify(registry.KNOWN_MEMBERSHIP_STATUSES) !==
                  stableStringify(KNOWN_MEMBERSHIP_STATUSES) ||
                stableStringify(registry.MEMBERSHIP_PRINCIPAL_UID_FIELDS) !==
                  stableStringify(MEMBERSHIP_PRINCIPAL_UID_FIELDS) ||
                stableStringify(registry.TEACHER_IDENTITY_FIELD_FAMILIES) !==
                  stableStringify(TEACHER_IDENTITY_FIELD_FAMILIES) ||
                stableStringify(registry.RESET_CLASSIFICATIONS) !==
                  stableStringify(RESET_CLASSIFICATIONS) ||
                stableStringify(registry.ACADEMY_SCOPE_STRATEGIES) !==
                  stableStringify(ACADEMY_SCOPE_STRATEGIES)) {
              throw new PlannerConfigError(
                  "critical_runtime_registry_contract_mismatch",
              );
            }
            ACADEMY_SCOPED_RESET_REGISTRY =
              registry.ACADEMY_SCOPED_RESET_REGISTRY;
            CREDIT_SOURCE_REFERENCE_MAPPINGS =
              registry.CREDIT_SOURCE_REFERENCE_MAPPINGS;
            CREDIT_SOURCE_GENERIC_REFERENCE_FIELD_SPECS =
              registry.CREDIT_SOURCE_GENERIC_REFERENCE_FIELD_SPECS;
            RESET_REGISTRY_BY_COLLECTION =
              registry.RESET_REGISTRY_BY_COLLECTION;
            RESET_REGISTRY_COUNTS = registry.RESET_REGISTRY_COUNTS;
            REFERENCE_FIELD_SPECS = registry.REFERENCE_FIELD_SPECS;
            REFERENCE_CARDINALITY_POLICY_VERSION =
              registry.REFERENCE_CARDINALITY_POLICY_VERSION;
            assertResetRegistry = registry.assertResetRegistry;
            return registry;
          });
  }
  return registryModulePromise;
}

export class PlannerConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlannerConfigError";
  }
}

export class PlannerIncompleteError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlannerIncompleteError";
  }
}

const OUTPUT_FIELD_TYPE = Object.freeze({
  ARRAY: "array",
  BOOLEAN: "boolean",
  DIGEST: "sha256",
  INTEGER: "nonnegative_integer",
  NULLABLE_STRING: "nullable_non_empty_string",
  OBJECT: "plain_object",
  STRING: "non_empty_string",
});

function outputFieldTypes({
  arrays = [],
  booleans = [],
  digests = [],
  integers = [],
  nullableStrings = [],
  objects = [],
  strings = [],
}) {
  const fieldTypes = Object.create(null);
  for (const [type, keys] of [
    [OUTPUT_FIELD_TYPE.ARRAY, arrays],
    [OUTPUT_FIELD_TYPE.BOOLEAN, booleans],
    [OUTPUT_FIELD_TYPE.DIGEST, digests],
    [OUTPUT_FIELD_TYPE.INTEGER, integers],
    [OUTPUT_FIELD_TYPE.NULLABLE_STRING, nullableStrings],
    [OUTPUT_FIELD_TYPE.OBJECT, objects],
    [OUTPUT_FIELD_TYPE.STRING, strings],
  ]) {
    for (const key of keys) {
      if (Object.hasOwn(fieldTypes, key)) {
        throw new Error(`Duplicate output schema field: ${key}`);
      }
      fieldTypes[key] = type;
    }
  }
  return Object.freeze(fieldTypes);
}

function mergeOutputFieldTypes(...fieldTypeGroups) {
  const merged = Object.create(null);
  for (const fieldTypes of fieldTypeGroups) {
    for (const [key, type] of Object.entries(fieldTypes)) {
      if (Object.hasOwn(merged, key) && merged[key] !== type) {
        throw new Error(`Conflicting output schema field type: ${key}`);
      }
      merged[key] = type;
    }
  }
  return Object.freeze(merged);
}

function outputSchemaDescriptor(version, fieldTypes) {
  return Object.freeze({
    version,
    requiredKeys: Object.freeze(Object.keys(fieldTypes).sort()),
    optionalKeys: Object.freeze([]),
    fieldTypes,
  });
}

const COMMON_OUTPUT_FIELD_TYPES = outputFieldTypes({
  arrays: ["criticalRuntimeSources"],
  booleans: [
    "backupVerified",
    "complete",
    "consistency",
    "dataRecoveryAvailable",
    "exactDeleteCountRequired",
    "exactPlanDigestRequired",
    "executionEligible",
    "executorImplemented",
    "executorRevalidationRequired",
    "finalMatchesRun1",
    "finalMatchesRun2",
    "freshPlanRequiredUnderWriteFreeze",
    "fullBackupWaiverConfirmed",
    "independentReviewApproved",
    "irreversibleExecutorConfirmationRequired",
    "managedExportRequired",
    "managedFirestoreExportRequired",
    "operatorTestDataConfirmation",
    "resetApproved",
    "run1RootCollectionSetStable",
    "run2RootCollectionSetStable",
    "truncated",
    "writeAuthorized",
    "writeFreezeRequiredForExecution",
    "writeFreezeVerified",
  ],
  digests: ["planDigest", "referenceFieldSpecSchemaDigest"],
  integers: [
    "actualWrites",
    "canonicalPlanSchemaVersion",
    "completedRuns",
    "executionSafetyContractVersion",
    "exitCode",
    "firestoreValueCanonicalizationVersion",
    "manifestSchemaVersion",
    "omitted",
    "planVersion",
    "publicationStateContractVersion",
    "referenceCardinalityPolicyVersion",
    "summarySchemaVersion",
    "topLevelOutputSchemaVersion",
  ],
  nullableStrings: ["resetProfile"],
  objects: [
    "collectionDiscoveryContract",
    "executionSafetyContract",
    "minimumSafetySnapshotsRequired",
    "publicationContract",
    "publicationSetContract",
    "publicationStateContract",
    "recordSetContract",
    "runtimeSourceContract",
  ],
  strings: [
    "academy",
    "backupPolicy",
    "irreversibleExecutorConfirmationName",
    "irreversibleExecutorConfirmationValue",
    "knownCreditSourceAllowlistVersion",
    "membershipClassificationPolicyVersion",
    "planClassification",
    "profilePolicyVersion",
    "project",
    "provisioningLogPolicy",
    "provisioningLogPolicyReason",
    "releaseSha",
    "runtimeHeadSha",
    "runtimeTreeSha",
    "snapshotMode",
    "verdict",
  ],
});

const CANONICAL_PLAN_ONLY_FIELD_TYPES = outputFieldTypes({
  arrays: ["candidateInputs", "recordInputs"],
  digests: ["candidateSetDigest", "firstRunDigest", "secondRunDigest"],
  integers: ["expectedDeleteCount"],
  objects: [
    "collectionCounts",
    "findingDeduplicationResult",
    "plannedMutations",
    "referenceCounts",
    "referenceFindings",
    "registryContract",
  ],
});

const SERIALIZED_OUTPUT_SHARED_FIELD_TYPES = outputFieldTypes({
  digests: [
    "candidateSetDigest",
    "criticalRuntimeSourceSetDigest",
    "findingSetDigest",
    "recordSetDigest",
  ],
  integers: [
    "candidateCount",
    "candidateSetDigestVersion",
    "criticalRuntimeSourceCount",
    "criticalRuntimeSourceSetDigestVersion",
    "findingCount",
    "findingSetDigestVersion",
    "publicationSetContractVersion",
    "recordCount",
    "recordSetContractVersion",
    "recordSetDigestVersion",
    "runtimeSourceContractVersion",
  ],
  strings: ["mode"],
});

const REDACTED_SUMMARY_ONLY_FIELD_TYPES = outputFieldTypes({
  arrays: [
    "malformedReferenceShapes",
    "unknownCreditSourceEvidence",
  ],
  objects: [
    "backupPreconditions",
    "collections",
    "membershipProfile",
    "planned",
    "registry",
    "runtimeDiscovery",
    "totals",
  ],
});

const SENSITIVE_MANIFEST_ONLY_FIELD_TYPES = outputFieldTypes({
  arrays: ["blockers", "records"],
  integers: ["referenceFindingCount", "sensitiveRecordFindingCount"],
  objects: ["referenceFindings"],
  strings: ["sensitivity"],
});

export const CANONICAL_PLAN_SCHEMA = outputSchemaDescriptor(
    CANONICAL_PLAN_SCHEMA_VERSION,
    mergeOutputFieldTypes(
        COMMON_OUTPUT_FIELD_TYPES,
        CANONICAL_PLAN_ONLY_FIELD_TYPES,
    ),
);
export const REDACTED_SUMMARY_SCHEMA = outputSchemaDescriptor(
    REDACTED_SUMMARY_SCHEMA_VERSION,
    mergeOutputFieldTypes(
        COMMON_OUTPUT_FIELD_TYPES,
        SERIALIZED_OUTPUT_SHARED_FIELD_TYPES,
        REDACTED_SUMMARY_ONLY_FIELD_TYPES,
    ),
);
export const SENSITIVE_MANIFEST_SCHEMA = outputSchemaDescriptor(
    SENSITIVE_MANIFEST_SCHEMA_VERSION,
    mergeOutputFieldTypes(
        COMMON_OUTPUT_FIELD_TYPES,
        SERIALIZED_OUTPUT_SHARED_FIELD_TYPES,
        SENSITIVE_MANIFEST_ONLY_FIELD_TYPES,
    ),
);

function isPlainOutputObject(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function outputFieldTypeMatches(value, type) {
  if (type === OUTPUT_FIELD_TYPE.ARRAY) return Array.isArray(value);
  if (type === OUTPUT_FIELD_TYPE.BOOLEAN) return typeof value === "boolean";
  if (type === OUTPUT_FIELD_TYPE.DIGEST) {
    return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  }
  if (type === OUTPUT_FIELD_TYPE.INTEGER) {
    return Number.isSafeInteger(value) && value >= 0;
  }
  if (type === OUTPUT_FIELD_TYPE.NULLABLE_STRING) {
    return value === null ||
      (typeof value === "string" && value.length > 0);
  }
  if (type === OUTPUT_FIELD_TYPE.OBJECT) return isPlainOutputObject(value);
  return typeof value === "string" && value.length > 0;
}

export function validateExactOutputSchema(value, schema, surfaceName) {
  if (!isPlainOutputObject(value)) {
    throw new PlannerIncompleteError(
        `${surfaceName} must be a plain top-level object.`,
    );
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new PlannerIncompleteError(
        `${surfaceName} has unsupported symbol fields.`,
    );
  }
  const actualKeys = Object.keys(value).sort();
  const nonEnumerableKeys = Object.getOwnPropertyNames(value)
      .filter((key) => !Object.prototype.propertyIsEnumerable.call(value, key))
      .sort();
  const allowedKeys = [...schema.requiredKeys, ...schema.optionalKeys].sort();
  const missingKeys = schema.requiredKeys.filter(
      (key) => !Object.hasOwn(value, key),
  );
  const unknownKeys = actualKeys.filter((key) => !allowedKeys.includes(key));
  if (missingKeys.length > 0 ||
      unknownKeys.length > 0 ||
      nonEnumerableKeys.length > 0) {
    throw new PlannerIncompleteError(
        `${surfaceName} top-level schema mismatch: ` +
        `missing=${missingKeys.join(",") || "none"}; ` +
        `unknown=${unknownKeys.join(",") || "none"}; ` +
        `nonEnumerable=${nonEnumerableKeys.join(",") || "none"}.`,
    );
  }
  for (const key of actualKeys) {
    if (!outputFieldTypeMatches(value[key], schema.fieldTypes[key])) {
      throw new PlannerIncompleteError(
          `${surfaceName}.${key} has an invalid top-level field type.`,
      );
    }
  }
  return true;
}

function resolvePlannerFilesystemRepositoryRoot(
    plannerSourcePath = PLANNER_SOURCE_PATH,
) {
  const realPlannerPath = fs.realpathSync(plannerSourcePath);
  let candidate = path.dirname(realPlannerPath);
  while (true) {
    const gitMarker = path.join(candidate, ".git");
    if (fs.existsSync(gitMarker)) {
      const markerStat = fs.lstatSync(gitMarker);
      if (!markerStat.isDirectory() && !markerStat.isFile()) {
        throw new PlannerConfigError(
            "Planner repository .git marker must be a file or directory.",
        );
      }
      const repositoryRoot = fs.realpathSync(candidate);
      if (!pathInside(repositoryRoot, realPlannerPath)) {
        throw new PlannerConfigError(
            "Planner source path is outside its filesystem repository root.",
        );
      }
      return {
        repositoryRoot,
        plannerSourcePath: realPlannerPath,
        plannerRelativePath: path.relative(repositoryRoot, realPlannerPath),
      };
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new PlannerConfigError(
          "Planner filesystem repository root is unavailable.",
      );
    }
    candidate = parent;
  }
}

function sanitizedGitEnvironment(environment = process.env) {
  const allowedNames = [
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
  ];
  return Object.fromEntries(
      allowedNames
          .filter((name) => typeof environment[name] === "string")
          .map((name) => [name, environment[name]]),
  );
}

function runGitIdentityCommand(
    execFile,
    repositoryRoot,
    args,
    environment,
) {
  return String(execFile("git", args, {
    cwd: repositoryRoot,
    env: sanitizedGitEnvironment(environment),
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

function runGitIdentityBufferCommand(
    execFile,
    repositoryRoot,
    args,
    environment,
) {
  const output = execFile("git", args, {
    cwd: repositoryRoot,
    env: sanitizedGitEnvironment(environment),
    encoding: null,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function criticalSourceError(code, relativePath) {
  return new PlannerConfigError(`${code}:${relativePath}`);
}

function resolveCriticalRuntimeFile(repositoryRoot, relativePath) {
  if (path.isAbsolute(relativePath) ||
      path.posix.normalize(relativePath) !== relativePath ||
      relativePath.split("/").includes("..")) {
    throw criticalSourceError(
        "critical_runtime_source_invalid_path",
        relativePath,
    );
  }
  const absolutePath = path.resolve(
      repositoryRoot,
      ...relativePath.split("/"),
  );
  if (!pathInside(repositoryRoot, absolutePath)) {
    throw criticalSourceError(
        "critical_runtime_source_outside_repository",
        relativePath,
    );
  }
  let sourceStat;
  try {
    sourceStat = fs.lstatSync(absolutePath);
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_missing",
        relativePath,
    );
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw criticalSourceError(
        "critical_runtime_source_not_regular_file",
        relativePath,
    );
  }
  const realPath = fs.realpathSync(absolutePath);
  const canonicalRelativePath = path.relative(repositoryRoot, realPath)
      .split(path.sep)
      .join("/");
  if (!pathInside(repositoryRoot, realPath) ||
      canonicalRelativePath !== relativePath) {
    throw criticalSourceError(
        "critical_runtime_source_path_mismatch",
        relativePath,
    );
  }
  return realPath;
}

function resolveCriticalRuntimeSourceIdentity({
  execFile,
  repositoryRoot,
  relativePath,
  environment,
}) {
  const runtimeAbsolutePath = resolveCriticalRuntimeFile(
      repositoryRoot,
      relativePath,
  );
  let trackedPath;
  try {
    trackedPath = runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["ls-files", "--error-unmatch", "--", relativePath],
        environment,
    );
    runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["cat-file", "-e", `HEAD:${relativePath}`],
        environment,
    );
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_not_tracked",
        relativePath,
    );
  }
  if (trackedPath !== relativePath) {
    throw criticalSourceError(
        "critical_runtime_source_path_mismatch",
        relativePath,
    );
  }

  let treeEntry;
  try {
    treeEntry = runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["ls-tree", "HEAD", "--", relativePath],
        environment,
    );
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_not_tracked",
        relativePath,
    );
  }
  const treeMatch =
    /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64})\t(.+)$/.exec(treeEntry);
  if (!treeMatch || treeMatch[4] !== relativePath ||
      !["100644", "100755"].includes(treeMatch[1]) ||
      treeMatch[2] !== "blob") {
    throw criticalSourceError(
        "critical_runtime_source_not_regular_blob",
        relativePath,
    );
  }
  const headBlobOid = treeMatch[3];
  let headBytes;
  try {
    headBytes = runGitIdentityBufferCommand(
        execFile,
        repositoryRoot,
        ["cat-file", "blob", `HEAD:${relativePath}`],
        environment,
    );
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_blob_unavailable",
        relativePath,
    );
  }
  const runtimeBytes = fs.readFileSync(runtimeAbsolutePath);
  const headBlobSha256 = crypto.createHash("sha256")
      .update(headBytes)
      .digest("hex");
  const runtimeSha256 = crypto.createHash("sha256")
      .update(runtimeBytes)
      .digest("hex");
  const bytesMatch = runtimeBytes.equals(headBytes);
  if (!bytesMatch) {
    throw criticalSourceError(
        "critical_runtime_source_bytes_mismatch",
        relativePath,
    );
  }

  const indexStatus = runGitIdentityCommand(
      execFile,
      repositoryRoot,
      ["ls-files", "-v", "--", relativePath],
      environment,
  );
  if (indexStatus !== `H ${relativePath}`) {
    throw criticalSourceError(
        "critical_runtime_source_index_flags",
        relativePath,
    );
  }
  return Object.freeze({
    relativePath,
    headBlobOid,
    headBlobSha256,
    runtimeSha256,
    bytesMatch: true,
    tracked: true,
    regularBlob: true,
    indexFlagsClean: true,
  });
}

function resolvePlannerRuntimeSourceIdentity({
  execFile = execFileSync,
  environment = process.env,
} = {}) {
  try {
    const filesystemIdentity = resolvePlannerFilesystemRepositoryRoot();
    const repositoryRoot = filesystemIdentity.repositoryRoot;
    if (filesystemIdentity.plannerRelativePath !==
        CRITICAL_RUNTIME_SOURCE_PATHS[0]) {
      throw new PlannerConfigError(
          "planner_runtime_source_path_mismatch",
      );
    }
    const discoveredRoot = runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["rev-parse", "--show-toplevel"],
        environment,
    );
    const expectedRoot = fs.realpathSync(repositoryRoot);
    const actualRoot = fs.realpathSync(discoveredRoot);
    if (actualRoot !== expectedRoot) {
      throw new PlannerConfigError(
          "Planner runtime repository root does not match its source root.",
      );
    }
    const runtimeHeadSha = runGitIdentityCommand(
        execFile,
        actualRoot,
        ["rev-parse", "HEAD"],
        environment,
    );
    const runtimeTreeSha = runGitIdentityCommand(
        execFile,
        actualRoot,
        ["rev-parse", "HEAD^{tree}"],
        environment,
    );
    const status = runGitIdentityCommand(
        execFile,
        actualRoot,
        ["status", "--porcelain=v1", "--untracked-files=all"],
        environment,
    );
    if (status !== "") {
      throw new PlannerConfigError(
          "Planner runtime Git worktree must be clean.",
      );
    }
    const criticalRuntimeSources = CRITICAL_RUNTIME_SOURCE_PATHS
        .map((relativePath) => resolveCriticalRuntimeSourceIdentity({
          execFile,
          repositoryRoot: actualRoot,
          relativePath,
          environment,
        }))
        .sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath),
        );
    return {
      repositoryRoot: actualRoot,
      runtimeHeadSha,
      runtimeTreeSha,
      clean: status === "",
      criticalRuntimeSources,
    };
  } catch (error) {
    if (error instanceof PlannerConfigError) throw error;
    throw new PlannerConfigError(
        "Planner runtime Git source identity is unavailable.",
    );
  }
}

function validatePlannerRuntimeSourceIdentity({
  identity,
  releaseSha,
}) {
  if (!identity || typeof identity !== "object") {
    throw new PlannerConfigError(
        "Planner runtime Git source identity is required.",
    );
  }
  const expectedRoot = resolvePlannerFilesystemRepositoryRoot()
      .repositoryRoot;
  let actualRoot = "";
  try {
    actualRoot = fs.realpathSync(identity.repositoryRoot);
  } catch {
    throw new PlannerConfigError(
        "Planner runtime repository root is unavailable.",
    );
  }
  if (actualRoot !== expectedRoot) {
    throw new PlannerConfigError(
        "Planner runtime repository root does not match its source root.",
    );
  }
  if (!/^[0-9a-f]{40}$/.test(identity.runtimeHeadSha || "") ||
      !/^[0-9a-f]{40}$/.test(identity.runtimeTreeSha || "")) {
    throw new PlannerConfigError(
        "Planner runtime Git HEAD and tree SHA are required.",
    );
  }
  if (identity.clean !== true) {
    throw new PlannerConfigError(
        "Planner runtime Git worktree must be clean.",
    );
  }
  const criticalRuntimeSources = identity.criticalRuntimeSources;
  if (!Array.isArray(criticalRuntimeSources) ||
      criticalRuntimeSources.length !==
        CRITICAL_RUNTIME_SOURCE_PATHS.length) {
    throw new PlannerConfigError(
        "Planner critical runtime source identity is required.",
    );
  }
  const normalizedCriticalSources = [...criticalRuntimeSources]
      .sort((left, right) =>
        String(left?.relativePath || "").localeCompare(
            String(right?.relativePath || ""),
        ),
      )
      .map((source, index) => {
        const expectedPath = [...CRITICAL_RUNTIME_SOURCE_PATHS]
            .sort()[index];
        if (!source || source.relativePath !== expectedPath ||
            !/^[0-9a-f]{40,64}$/.test(source.headBlobOid || "") ||
            !/^[0-9a-f]{64}$/.test(source.headBlobSha256 || "") ||
            !/^[0-9a-f]{64}$/.test(source.runtimeSha256 || "") ||
            source.headBlobSha256 !== source.runtimeSha256 ||
            source.bytesMatch !== true ||
            source.tracked !== true ||
            source.regularBlob !== true ||
            source.indexFlagsClean !== true) {
          throw new PlannerConfigError(
              "Planner critical runtime source identity is invalid.",
          );
        }
        return Object.freeze({
          relativePath: source.relativePath,
          headBlobOid: source.headBlobOid,
          headBlobSha256: source.headBlobSha256,
          runtimeSha256: source.runtimeSha256,
          bytesMatch: true,
          tracked: true,
          regularBlob: true,
          indexFlagsClean: true,
        });
      });
  if (releaseSha !== identity.runtimeHeadSha) {
    throw new PlannerConfigError(
        "--release-sha does not match the executing Git HEAD.",
    );
  }
  return Object.freeze({
    repositoryRoot: actualRoot,
    runtimeHeadSha: identity.runtimeHeadSha,
    runtimeTreeSha: identity.runtimeTreeSha,
    clean: true,
    criticalRuntimeSources: Object.freeze(normalizedCriticalSources),
  });
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    if (Array.from({length: value.length}, (_, index) => index)
        .some((index) => !(index in value))) {
      throw new PlannerConfigError(
          "Canonical JSON arrays must not contain sparse entries.",
      );
    }
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    ).join(",")}}`;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new PlannerConfigError(
          "Canonical JSON numbers must be finite.",
      );
    }
    return Object.is(value, -0) ? "-0" : JSON.stringify(value);
  }
  if (value === undefined || typeof value === "bigint" ||
      typeof value === "symbol" || typeof value === "function") {
    throw new PlannerConfigError(
        "Canonical JSON contains an unsupported value.",
    );
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256")
      .update(typeof value === "string" ? value : stableStringify(value))
      .digest("hex");
}

function canonicalRootCollectionSet(rootCollections) {
  if (!Array.isArray(rootCollections)) {
    throw new PlannerIncompleteError(
        "Root collection discovery did not return an array.",
    );
  }
  const names = rootCollections.map((collection) => {
    if (!collection || typeof collection !== "object" ||
        Array.isArray(collection) ||
        typeof collection.id !== "string" ||
        !collection.id.trim() ||
        collection.id !== collection.id.trim()) {
      throw new PlannerIncompleteError(
          "Root collection discovery returned a malformed collection.",
      );
    }
    return collection.id;
  }).sort();
  if (new Set(names).size !== names.length) {
    throw new PlannerIncompleteError(
        "Root collection discovery returned duplicate collections.",
    );
  }
  return Object.freeze({
    names: Object.freeze(names),
    count: names.length,
    digestVersion: ROOT_COLLECTION_SET_DIGEST_VERSION,
    setDigest: digest(names),
  });
}

async function discoverRootCollectionSet(db) {
  return canonicalRootCollectionSet(await db.listCollections());
}

function rootCollectionSetsMatch(left, right) {
  return left.count === right.count &&
    left.digestVersion === right.digestVersion &&
    left.setDigest === right.setDigest &&
    stableStringify(left.names) === stableStringify(right.names);
}

function requirePublicationString(value, label) {
  if (typeof value !== "string" || !value.trim()) {
    throw new PlannerConfigError(`${label} must be a non-empty string.`);
  }
  return value;
}

function canonicalizeAcademyScopePublicationEvidence(evidence) {
  if (!evidence || typeof evidence !== "object" ||
      Array.isArray(evidence) ||
      typeof evidence.exactAcademyMatch !== "boolean") {
    throw new PlannerConfigError(
        "Candidate academy scope publication evidence is malformed.",
    );
  }
  return Object.freeze({
    strategy: requirePublicationString(
        evidence.strategy,
        "Candidate academy scope strategy",
    ),
    result: requirePublicationString(
        evidence.result,
        "Candidate academy scope result",
    ),
    exactAcademyMatch: evidence.exactAcademyMatch,
  });
}

export function canonicalizeCandidatePublicationIdentity(candidate) {
  if (!candidate || typeof candidate !== "object" ||
      Array.isArray(candidate) ||
      !Number.isInteger(candidate.deletionOrderGroup) ||
      candidate.deletionOrderGroup < 1) {
    throw new PlannerConfigError(
        "Candidate publication identity is malformed.",
    );
  }
  const plannerDisposition = requirePublicationString(
      candidate.plannerDisposition,
      "Candidate planner disposition",
  );
  if (plannerDisposition !== "reset") {
    throw new PlannerConfigError(
        "Publication candidate must have reset disposition.",
    );
  }
  return Object.freeze({
    typedDocumentKey: requirePublicationString(
        candidate.typedDocumentKey,
        "Candidate typed document key",
    ),
    collectionName: requirePublicationString(
        candidate.collectionName,
        "Candidate collection name",
    ),
    classification: requirePublicationString(
        candidate.classification,
        "Candidate classification",
    ),
    deletionOrderGroup: candidate.deletionOrderGroup,
    plannerDisposition,
    academyScopeEvidence:
      canonicalizeAcademyScopePublicationEvidence(
          candidate.academyScopeEvidence,
      ),
  });
}

function normalizedFindingTargetKeys(targetTypedKeys) {
  if (!Array.isArray(targetTypedKeys)) {
    throw new PlannerConfigError(
        "Finding target typed keys must be an array.",
    );
  }
  return [...new Set(targetTypedKeys.map((key) =>
    requirePublicationString(key, "Finding target typed key"),
  ))].sort();
}

function canonicalizeFindingShapeEvidence(shapeEvidence) {
  if (shapeEvidence == null) return null;
  if (!shapeEvidence || typeof shapeEvidence !== "object" ||
      Array.isArray(shapeEvidence)) {
    throw new PlannerConfigError(
        "Finding shape evidence is malformed.",
    );
  }
  const expectedKeys = [
    "actualShape",
    "type",
    ...(Object.hasOwn(shapeEvidence, "arrayLength") ?
      ["arrayLength"] :
      []),
    ...(Object.hasOwn(shapeEvidence, "stringEmpty") ?
      ["stringEmpty"] :
      []),
  ].sort();
  if (stableStringify(Object.keys(shapeEvidence).sort()) !==
      stableStringify(expectedKeys) ||
      (Object.hasOwn(shapeEvidence, "arrayLength") &&
       (!Number.isInteger(shapeEvidence.arrayLength) ||
        shapeEvidence.arrayLength < 0)) ||
      (Object.hasOwn(shapeEvidence, "stringEmpty") &&
       typeof shapeEvidence.stringEmpty !== "boolean")) {
    throw new PlannerConfigError(
        "Finding shape evidence schema is invalid.",
    );
  }
  return Object.freeze({
    actualShape: requirePublicationString(
        shapeEvidence.actualShape,
        "Finding actual shape",
    ),
    type: requirePublicationString(
        shapeEvidence.type,
        "Finding shape type",
    ),
    ...(Object.hasOwn(shapeEvidence, "arrayLength") ?
      {arrayLength: shapeEvidence.arrayLength} :
      {}),
    ...(Object.hasOwn(shapeEvidence, "stringEmpty") ?
      {stringEmpty: shapeEvidence.stringEmpty} :
      {}),
  });
}

export function canonicalizeFindingPublicationIdentity(finding) {
  if (!finding || typeof finding !== "object" || Array.isArray(finding)) {
    throw new PlannerConfigError(
        "Finding publication identity is malformed.",
    );
  }
  const field = finding.field == null ? null :
    requirePublicationString(finding.field, "Finding field");
  const policyReason = finding.policyReason == null ? null :
    requirePublicationString(finding.policyReason, "Finding policy reason");
  const expectedShape = finding.expectedShape == null ? null :
    requirePublicationString(
        finding.expectedShape,
        "Finding expected shape",
    );
  const shapeEvidence =
    canonicalizeFindingShapeEvidence(finding.shapeEvidence);
  return Object.freeze({
    severity: requirePublicationString(
        finding.severity,
        "Finding severity",
    ),
    code: requirePublicationString(finding.code, "Finding code"),
    sourceTypedKey: requirePublicationString(
        finding.sourceTypedKey,
        "Finding source typed key",
    ),
    field,
    targetTypedKeys:
      normalizedFindingTargetKeys(finding.targetTypedKeys),
    policyReason,
    expectedShape,
    shapeEvidence,
  });
}

export function findingPublicationIdentityDigest(finding) {
  return digest(canonicalizeFindingPublicationIdentity(finding));
}

function nullablePublishedFindingString(value, label) {
  if (value === null) return null;
  return requirePublicationString(value, label);
}

function canonicalizeCreditSourceEvidence(evidence) {
  assertExactObjectKeys(
      evidence,
      CREDIT_SOURCE_EVIDENCE_KEYS,
      CREDIT_SOURCE_EVIDENCE_KEYS,
      "Published finding credit source evidence",
  );
  for (const field of [
    "sourceTypePresent",
    "sourceTypeKnown",
    "sourceIdPresent",
    "explicitLessonIdPresent",
    "explicitReservationIdPresent",
    "explicitSlotIdPresent",
  ]) {
    if (typeof evidence[field] !== "boolean") {
      throw new PlannerConfigError(
          `Published finding credit evidence ${field} is invalid.`,
      );
    }
  }
  if (evidence.sourceTypeLiteral !== null &&
      (typeof evidence.sourceTypeLiteral !== "string" ||
       !Object.hasOwn(
           CREDIT_SOURCE_REFERENCE_MAPPINGS,
           evidence.sourceTypeLiteral,
       ))) {
    throw new PlannerConfigError(
        "Published finding credit source literal is invalid.",
    );
  }
  if (!["known", "missing", "unknown"].includes(
      evidence.sourceTypeCategory,
  ) ||
      typeof evidence.actualShape !== "string" ||
      !evidence.actualShape ||
      ![null, "1-16", "17-32", "33-64", "65+"].includes(
          evidence.lengthBucket,
      )) {
    throw new PlannerConfigError(
        "Published finding credit source shape evidence is invalid.",
    );
  }
  return Object.freeze({
    sourceTypeLiteral: evidence.sourceTypeLiteral,
    sourceTypePresent: evidence.sourceTypePresent,
    sourceTypeKnown: evidence.sourceTypeKnown,
    sourceTypeCategory: evidence.sourceTypeCategory,
    actualShape: evidence.actualShape,
    lengthBucket: evidence.lengthBucket,
    sourceIdPresent: evidence.sourceIdPresent,
    explicitLessonIdPresent: evidence.explicitLessonIdPresent,
    explicitReservationIdPresent:
      evidence.explicitReservationIdPresent,
    explicitSlotIdPresent: evidence.explicitSlotIdPresent,
  });
}

function canonicalizePublishedFindingSemanticRecord(finding) {
  assertExactObjectKeys(
      finding,
      PUBLISHED_FINDING_RECORD_KEYS,
      REQUIRED_PUBLISHED_FINDING_SEMANTIC_KEYS,
      "Published finding semantic record",
  );
  const family = nullablePublishedFindingString(
      finding.family,
      "Published finding family",
  );
  const field = nullablePublishedFindingString(
      finding.field,
      "Published finding field",
  );
  const expectedShape = Object.hasOwn(finding, "expectedShape") ?
    requirePublicationString(
        finding.expectedShape,
        "Published finding expected shape",
    ) :
    undefined;
  if (Object.hasOwn(finding, "aliasEvidence") &&
      !Array.isArray(finding.aliasEvidence)) {
    throw new PlannerConfigError(
        "Published finding alias evidence must be an array.",
    );
  }
  if (Object.hasOwn(finding, "resolvedValue") &&
      finding.resolvedValue !== null &&
      (typeof finding.resolvedValue !== "string" ||
       !finding.resolvedValue ||
       finding.resolvedValue !== finding.resolvedValue.trim())) {
    throw new PlannerConfigError(
        "Published finding resolved value is invalid.",
    );
  }
  if (Object.hasOwn(finding, "conflict") &&
      typeof finding.conflict !== "boolean") {
    throw new PlannerConfigError(
        "Published finding conflict value is invalid.",
    );
  }
  return Object.freeze({
    severity: requirePublicationString(
        finding.severity,
        "Published finding severity",
    ),
    code: requirePublicationString(finding.code, "Published finding code"),
    sourceTypedKey: requirePublicationString(
        finding.sourceTypedKey,
        "Published finding source typed key",
    ),
    targetTypedKeys: canonicalStringSet(
        finding.targetTypedKeys,
        "Published finding target typed keys",
    ),
    sourceClassification: requirePublicationString(
        finding.sourceClassification,
        "Published finding source classification",
    ),
    sourceDisposition: requirePublicationString(
        finding.sourceDisposition,
        "Published finding source disposition",
    ),
    targetCollectionClassification: canonicalStringSet(
        finding.targetCollectionClassification,
        "Published finding target collection classifications",
    ),
    family,
    field,
    policyReason: requirePublicationString(
        finding.policyReason,
        "Published finding policy reason",
    ),
    ...(expectedShape === undefined ? {} : {expectedShape}),
    ...(Object.hasOwn(finding, "shapeEvidence") ?
      {
        shapeEvidence:
          canonicalizeFindingShapeEvidence(finding.shapeEvidence),
      } :
      {}),
    ...(Object.hasOwn(finding, "creditSourceEvidence") ?
      {
        creditSourceEvidence:
          canonicalizeCreditSourceEvidence(finding.creditSourceEvidence),
      } :
      {}),
    ...(Object.hasOwn(finding, "aliasEvidence") ?
      {
        aliasEvidence: Object.freeze(finding.aliasEvidence
            .map((value) => canonicalizeFirestoreValue(value))
            .sort((left, right) =>
              stableStringify(left).localeCompare(stableStringify(right)))),
      } :
      {}),
    ...(Object.hasOwn(finding, "resolvedValue") ?
      {resolvedValue: finding.resolvedValue} :
      {}),
    ...(Object.hasOwn(finding, "conflict") ?
      {conflict: finding.conflict} :
      {}),
  });
}

export function publishedFindingRecordDigest(finding) {
  return digest(canonicalizePublishedFindingSemanticRecord(finding));
}

export function canonicalizePublishedFindingRecord(finding) {
  assertExactObjectKeys(
      finding,
      PUBLISHED_FINDING_RECORD_KEYS,
      REQUIRED_PUBLISHED_FINDING_RECORD_KEYS,
      "Published finding record",
  );
  const identityDigest = findingPublicationIdentityDigest(finding);
  const publishedDigest = publishedFindingRecordDigest(finding);
  if (finding.findingIdentityDigest !== identityDigest ||
      finding.findingDigest !== identityDigest ||
      finding.publishedFindingDigest !== publishedDigest) {
    throw new PlannerConfigError(
        "Published finding claimed digest is stale or invalid.",
    );
  }
  canonicalizePublishedFindingSemanticRecord(finding);
  return Object.freeze({
    ...finding,
    findingIdentityDigest: identityDigest,
    findingDigest: identityDigest,
    publishedFindingDigest: publishedDigest,
  });
}

function buildPublishedFindingRecord(finding) {
  assertExactObjectKeys(
      finding,
      PUBLISHED_FINDING_SEMANTIC_KEYS,
      REQUIRED_PUBLISHED_FINDING_SEMANTIC_KEYS,
      "Generated published finding",
  );
  const findingIdentityDigest = findingPublicationIdentityDigest(finding);
  const publishedFindingDigest = publishedFindingRecordDigest(finding);
  return canonicalizePublishedFindingRecord({
    ...finding,
    findingIdentityDigest,
    findingDigest: findingIdentityDigest,
    publishedFindingDigest,
  });
}

function canonicalCandidateInputsFromPlannerRecords(records) {
  return records
      .filter(({disposition}) => disposition === "reset")
      .map((record) => ({
        typedDocumentKey: record.typedDocumentKey,
        collectionName: record.collection,
        classification: record.classification,
        deletionOrderGroup: record.deletionOrderGroup,
        plannerDisposition: record.disposition,
        academyScopeEvidence: record.academyScopeEvidence,
      }));
}

function canonicalCandidateInputsFromManifestRecords(records) {
  if (!Array.isArray(records)) {
    throw new PlannerConfigError(
        "Sensitive manifest records must be an array.",
    );
  }
  return records
      .filter(({plannerDisposition}) => plannerDisposition === "reset")
      .map((record) => ({
        typedDocumentKey: record.typedDocumentKey,
        collectionName: record.collection,
        classification: record.classification,
        deletionOrderGroup: record.deletionOrderGroup,
        plannerDisposition: record.plannerDisposition,
        academyScopeEvidence: record.academyScopeEvidence,
      }));
}

function candidatePublicationSetMetadata(candidateInputs) {
  const identities = candidateInputs.map(
      canonicalizeCandidatePublicationIdentity,
  );
  const typedDocumentKeys = new Set();
  for (const identity of identities) {
    if (typedDocumentKeys.has(identity.typedDocumentKey)) {
      throw new PlannerConfigError(
          "Duplicate candidate publication identity.",
      );
    }
    typedDocumentKeys.add(identity.typedDocumentKey);
  }
  const identityDigests = identities
      .map((identity) => digest(identity))
      .sort();
  return {
    candidateCount: identities.length,
    candidateSetDigestVersion: CANDIDATE_SET_DIGEST_VERSION,
    candidateSetDigest: digest(identityDigests),
  };
}

function findingPublicationSetMetadata(referenceFindings) {
  const expectedBuckets = ["blockers", "diagnostics", "warnings"];
  if (!referenceFindings || typeof referenceFindings !== "object" ||
      Array.isArray(referenceFindings) ||
      stableStringify(Object.keys(referenceFindings).sort()) !==
        stableStringify(expectedBuckets) ||
      expectedBuckets.some((bucket) =>
        !Array.isArray(referenceFindings[bucket]),
      )) {
    throw new PlannerConfigError(
        "Reference finding publication buckets are malformed.",
    );
  }
  const publishedDigests = [];
  const uniqueDigests = new Set();
  const uniqueIdentityDigests = new Set();
  for (const bucket of expectedBuckets) {
    const expectedSeverity = {
      blockers: "blocking",
      diagnostics: "diagnostic_only",
      warnings: "warning",
    }[bucket];
    for (const finding of referenceFindings[bucket]) {
      if (finding.severity !== expectedSeverity) {
        throw new PlannerConfigError(
            "Reference finding severity bucket mismatch.",
        );
      }
      const canonicalFinding =
        canonicalizePublishedFindingRecord(finding);
      const computedDigest = canonicalFinding.publishedFindingDigest;
      if (uniqueDigests.has(computedDigest) ||
          uniqueIdentityDigests.has(
              canonicalFinding.findingIdentityDigest,
          )) {
        throw new PlannerConfigError(
            "Duplicate published finding record.",
        );
      }
      uniqueDigests.add(computedDigest);
      uniqueIdentityDigests.add(canonicalFinding.findingIdentityDigest);
      publishedDigests.push(computedDigest);
    }
  }
  publishedDigests.sort();
  return {
    findingCount: publishedDigests.length,
    findingSetDigestVersion: FINDING_SET_DIGEST_VERSION,
    findingSetDigest: digest(publishedDigests),
  };
}

function canonicalizePublishedFindingBuckets(referenceFindings) {
  findingPublicationSetMetadata(referenceFindings);
  return Object.freeze(Object.fromEntries(
      ["blockers", "diagnostics", "warnings"].map((bucket) => [
        bucket,
        Object.freeze(referenceFindings[bucket]
            .map(canonicalizePublishedFindingRecord)
            .sort((left, right) =>
              left.publishedFindingDigest.localeCompare(
                  right.publishedFindingDigest,
              ))),
      ]),
  ));
}

function canonicalBlockerPublishedDigestSet(findings, label) {
  if (!Array.isArray(findings)) {
    throw new PlannerConfigError(`${label} must be an array.`);
  }
  const publishedDigests = new Set();
  const identityDigests = new Set();
  for (const finding of findings) {
    const canonicalFinding =
      canonicalizePublishedFindingRecord(finding);
    if (canonicalFinding.severity !== "blocking") {
      throw new PlannerConfigError(
          `${label} contains a non-blocking finding.`,
      );
    }
    if (publishedDigests.has(canonicalFinding.publishedFindingDigest) ||
        identityDigests.has(canonicalFinding.findingIdentityDigest)) {
      throw new PlannerConfigError(`${label} contains a duplicate blocker.`);
    }
    publishedDigests.add(canonicalFinding.publishedFindingDigest);
    identityDigests.add(canonicalFinding.findingIdentityDigest);
  }
  return Object.freeze([...publishedDigests].sort());
}

function canonicalBlockerPublishedDigestSetFromBuckets(
    referenceFindings,
    label,
) {
  findingPublicationSetMetadata(referenceFindings);
  const blockers = [
    ...referenceFindings.blockers,
    ...referenceFindings.diagnostics,
    ...referenceFindings.warnings,
  ].filter(({severity}) => severity === "blocking");
  return canonicalBlockerPublishedDigestSet(blockers, label);
}

function canonicalRecordFindingMap(referenceFindings) {
  findingPublicationSetMetadata(referenceFindings);
  const findingMap = new Map();
  for (const bucket of ["blockers", "diagnostics", "warnings"]) {
    for (const finding of referenceFindings[bucket]) {
      const canonicalFinding =
        canonicalizePublishedFindingRecord(finding);
      const publishedDigest = canonicalFinding.publishedFindingDigest;
      if (!findingMap.has(canonicalFinding.sourceTypedKey)) {
        findingMap.set(canonicalFinding.sourceTypedKey, []);
      }
      findingMap.get(canonicalFinding.sourceTypedKey).push(publishedDigest);
    }
  }
  return Object.freeze(Object.fromEntries(
      [...findingMap.entries()]
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([sourceTypedKey, identityDigests]) => [
            sourceTypedKey,
            Object.freeze(identityDigests.sort()),
          ]),
  ));
}

function manifestRecordFindingMap(records) {
  if (!Array.isArray(records)) {
    throw new PlannerConfigError(
        "Sensitive manifest records must be an array.",
    );
  }
  const findingMap = new Map();
  const recordKeys = new Set();
  for (const record of records) {
    if (!record || typeof record !== "object" || Array.isArray(record)) {
      throw new PlannerConfigError(
          "Sensitive manifest record is malformed.",
      );
    }
    const sourceTypedKey = requirePublicationString(
        record.typedDocumentKey,
        "Sensitive manifest record typed document key",
    );
    if (recordKeys.has(sourceTypedKey)) {
      throw new PlannerConfigError(
          "Duplicate sensitive manifest record typed document key.",
      );
    }
    recordKeys.add(sourceTypedKey);
    if (!Array.isArray(record.referenceFindings)) {
      throw new PlannerConfigError(
          "Sensitive manifest record findings must be an array.",
      );
    }
    const publishedDigests = [];
    const uniqueDigests = new Set();
    const uniqueIdentityDigests = new Set();
    for (const finding of record.referenceFindings) {
      const canonicalFinding =
        canonicalizePublishedFindingRecord(finding);
      if (canonicalFinding.sourceTypedKey !== sourceTypedKey) {
        throw new PlannerConfigError(
            "Sensitive record finding source does not match its record.",
        );
      }
      const computedDigest = canonicalFinding.publishedFindingDigest;
      if (uniqueDigests.has(computedDigest) ||
          uniqueIdentityDigests.has(
              canonicalFinding.findingIdentityDigest,
          )) {
        throw new PlannerConfigError(
            "Duplicate sensitive record published finding.",
        );
      }
      uniqueDigests.add(computedDigest);
      uniqueIdentityDigests.add(canonicalFinding.findingIdentityDigest);
      publishedDigests.push(computedDigest);
    }
    if (publishedDigests.length > 0) {
      findingMap.set(sourceTypedKey, Object.freeze(publishedDigests.sort()));
    }
  }
  return Object.freeze(Object.fromEntries(
      [...findingMap.entries()]
          .sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function recordFindingSetMetadata(findingMap) {
  const sourceEntries = Object.entries(findingMap);
  const identityDigests = sourceEntries.flatMap(([, digests]) => digests);
  return Object.freeze({
    recordFindingSourceCount: sourceEntries.length,
    recordFindingCount: identityDigests.length,
    recordFindingSetDigestVersion: FINDING_SET_DIGEST_VERSION,
    recordFindingSetDigest: digest(sourceEntries),
  });
}

function assertExactObjectKeys(value, allowedKeys, requiredKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlannerConfigError(`${label} must be an object.`);
  }
  const actualKeys = Object.keys(value).sort();
  const allowed = new Set(allowedKeys);
  if (actualKeys.some((key) => !allowed.has(key)) ||
      requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    throw new PlannerConfigError(`${label} field set is invalid.`);
  }
}

function canonicalStringSet(values, label) {
  if (!Array.isArray(values)) {
    throw new PlannerConfigError(`${label} must be an array.`);
  }
  const normalized = values.map((value) => {
    if (typeof value !== "string" || !value ||
        value !== value.trim()) {
      throw new PlannerConfigError(
          `${label} entries must be exact non-empty strings.`,
      );
    }
    return value;
  });
  if (new Set(normalized).size !== normalized.length) {
    throw new PlannerConfigError(`${label} contains duplicates.`);
  }
  return Object.freeze(normalized.sort());
}

function canonicalizeSensitiveDirectReference(reference) {
  const requiredKeys = SENSITIVE_DIRECT_REFERENCE_KEYS.filter(
      (key) => !OPTIONAL_SENSITIVE_DIRECT_REFERENCE_KEYS.includes(key),
  );
  assertExactObjectKeys(
      reference,
      SENSITIVE_DIRECT_REFERENCE_KEYS,
      requiredKeys,
      "Sensitive direct reference",
  );
  for (const field of ["family", "field", "lookup"]) {
    if (typeof reference[field] !== "string" ||
        !reference[field] ||
        reference[field] !== reference[field].trim()) {
      throw new PlannerConfigError(
          `Sensitive direct reference ${field} is invalid.`,
      );
    }
  }
  if (Object.hasOwn(reference, "aliasEvidence") &&
      !Array.isArray(reference.aliasEvidence)) {
    throw new PlannerConfigError(
        "Sensitive direct reference alias evidence must be an array.",
    );
  }
  if (Object.hasOwn(reference, "resolvedValue") &&
      reference.resolvedValue !== null &&
      (typeof reference.resolvedValue !== "string" ||
       !reference.resolvedValue ||
       reference.resolvedValue !== reference.resolvedValue.trim())) {
    throw new PlannerConfigError(
        "Sensitive direct reference resolved value is invalid.",
    );
  }
  if (Object.hasOwn(reference, "conflict") &&
      typeof reference.conflict !== "boolean") {
    throw new PlannerConfigError(
        "Sensitive direct reference conflict state is invalid.",
    );
  }
  return Object.freeze({
    family: reference.family,
    field: reference.field,
    candidateTypedKeys: canonicalStringSet(
        reference.candidateTypedKeys,
        "Sensitive direct reference candidate typed keys",
    ),
    targetCollections: canonicalStringSet(
        reference.targetCollections,
        "Sensitive direct reference target collections",
    ),
    lookup: reference.lookup,
    ...(Object.hasOwn(reference, "aliasEvidence") ?
      {
        aliasEvidence: Object.freeze(reference.aliasEvidence
            .map((value) => canonicalizeFirestoreValue(value))
            .sort((left, right) =>
              stableStringify(left).localeCompare(stableStringify(right)))),
      } :
      {}),
    ...(Object.hasOwn(reference, "resolvedValue") ?
      {resolvedValue: reference.resolvedValue} :
      {}),
    ...(Object.hasOwn(reference, "conflict") ?
      {conflict: reference.conflict} :
      {}),
  });
}

function canonicalizeSensitiveDirectReferences(references) {
  if (!Array.isArray(references)) {
    throw new PlannerConfigError(
        "Sensitive manifest direct references must be an array.",
    );
  }
  const canonical = references
      .map(canonicalizeSensitiveDirectReference)
      .sort((left, right) =>
        stableStringify(left).localeCompare(stableStringify(right)));
  const identities = canonical.map(stableStringify);
  if (new Set(identities).size !== identities.length) {
    throw new PlannerConfigError(
        "Duplicate sensitive manifest direct reference.",
    );
  }
  return Object.freeze(canonical);
}

function canonicalizeSensitiveRecordFindings(record) {
  if (!Array.isArray(record.referenceFindings)) {
    throw new PlannerConfigError(
        "Sensitive manifest record findings must be an array.",
    );
  }
  const canonical = record.referenceFindings.map((finding) => {
    const canonicalFinding =
      canonicalizePublishedFindingRecord(finding);
    if (canonicalFinding.sourceTypedKey !== record.typedDocumentKey) {
      throw new PlannerConfigError(
          "Sensitive record finding source does not match its record.",
      );
    }
    return canonicalFinding;
  }).sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)));
  const identities = canonical.map(stableStringify);
  if (new Set(identities).size !== identities.length) {
    throw new PlannerConfigError(
        "Duplicate sensitive record finding identity.",
    );
  }
  return Object.freeze(canonical);
}

export function canonicalizeSensitiveManifestRecord(record) {
  assertExactObjectKeys(
      record,
      SENSITIVE_MANIFEST_RECORD_KEYS,
      REQUIRED_SENSITIVE_MANIFEST_RECORD_KEYS,
      "Sensitive manifest record",
  );
  const typedKey = requirePublicationString(
      record.typedDocumentKey,
      "Sensitive manifest record typed document key",
  );
  const collection = requirePublicationString(
      record.collection,
      "Sensitive manifest record collection",
  );
  const rawPath = requirePublicationString(
      record.rawDocumentPath,
      "Sensitive manifest record raw document path",
  );
  if (typedKey !== typedKey.trim() ||
      collection !== collection.trim() ||
      collection.includes("/") ||
      rawPath !== rawPath.trim() ||
      !rawPath.startsWith(`${collection}/`)) {
    throw new PlannerConfigError(
        "Sensitive manifest record document identity is malformed.",
    );
  }
  const documentId = rawPath.slice(collection.length + 1);
  if (!documentId || documentId.includes("/") ||
      typedKey !== typedDocumentKey(collection, documentId)) {
    throw new PlannerConfigError(
        "Sensitive manifest record path does not match its typed identity.",
    );
  }
  const knownClassifications = new Set([
    ...Object.values(RESET_CLASSIFICATIONS),
    "UNKNOWN_BLOCKER",
  ]);
  const knownDispositions = new Set([
    "global_preserve",
    "other_academy_preserve",
    "preserve",
    "reset",
    "retain",
    "unknown",
  ]);
  if (!knownClassifications.has(record.classification) ||
      !knownDispositions.has(record.plannerDisposition) ||
      !Number.isInteger(record.deletionOrderGroup) ||
      record.deletionOrderGroup < 0 ||
      !/^[0-9a-f]{64}$/.test(record.documentDigest || "")) {
    throw new PlannerConfigError(
        "Sensitive manifest record policy identity is malformed.",
    );
  }
  for (const field of [
    "membershipProfileDecision",
    "creditSourceEvidence",
    "teacherIdentityEvidence",
  ]) {
    if (Object.hasOwn(record, field) &&
        (!record[field] || typeof record[field] !== "object" ||
         Array.isArray(record[field]))) {
      throw new PlannerConfigError(
          `Sensitive manifest record ${field} is malformed.`,
      );
    }
  }
  if (Object.hasOwn(record, "profilePolicyReason") &&
      (typeof record.profilePolicyReason !== "string" ||
       !record.profilePolicyReason ||
       record.profilePolicyReason !== record.profilePolicyReason.trim())) {
    throw new PlannerConfigError(
        "Sensitive manifest record profile policy reason is malformed.",
    );
  }
  return Object.freeze({
    rawDocumentPath: rawPath,
    typedDocumentKey: typedKey,
    collection,
    classification: record.classification,
    plannerDisposition: record.plannerDisposition,
    deletionOrderGroup: record.deletionOrderGroup,
    academyScopeEvidence:
      canonicalizeAcademyScopePublicationEvidence(
          record.academyScopeEvidence,
      ),
    documentDigest: record.documentDigest,
    ...(Object.hasOwn(record, "membershipProfileDecision") ?
      {
        membershipProfileDecision:
          canonicalizeFirestoreValue(record.membershipProfileDecision),
      } :
      {}),
    ...(Object.hasOwn(record, "creditSourceEvidence") ?
      {
        creditSourceEvidence:
          canonicalizeFirestoreValue(record.creditSourceEvidence),
      } :
      {}),
    ...(Object.hasOwn(record, "teacherIdentityEvidence") ?
      {
        teacherIdentityEvidence:
          canonicalizeFirestoreValue(record.teacherIdentityEvidence),
      } :
      {}),
    ...(Object.hasOwn(record, "profilePolicyReason") ?
      {profilePolicyReason: record.profilePolicyReason} :
      {}),
    directReferences:
      canonicalizeSensitiveDirectReferences(record.directReferences),
    referenceFindings:
      canonicalizeSensitiveRecordFindings(record),
  });
}

function canonicalRecordInputsFromPlannerRecords(
    records,
    referenceFindings,
) {
  const findingBySource =
    buildManifestFindingBySource(referenceFindings);
  return records.map((record) =>
    manifestRecord(record, findingBySource));
}

function canonicalRecordInputsFromManifestRecords(records) {
  manifestRecordFindingMap(records);
  return records;
}

export function buildRecordSetContract(recordInputs) {
  if (!Array.isArray(recordInputs)) {
    throw new PlannerConfigError(
        "Record publication inputs must be an array.",
    );
  }
  const identities = recordInputs
      .map(canonicalizeSensitiveManifestRecord)
      .sort((left, right) =>
        left.typedDocumentKey.localeCompare(right.typedDocumentKey));
  const recordKeys = identities.map(({typedDocumentKey}) =>
    typedDocumentKey);
  if (new Set(recordKeys).size !== recordKeys.length) {
    throw new PlannerConfigError(
        "Duplicate record publication identity.",
    );
  }
  return Object.freeze({
    recordSetContractVersion: RECORD_SET_CONTRACT_VERSION,
    recordCount: identities.length,
    recordSetDigestVersion: RECORD_SET_DIGEST_VERSION,
    recordSetDigest: digest(identities),
  });
}

export function recomputeManifestRecordSetContract(manifest) {
  return buildRecordSetContract(
      canonicalRecordInputsFromManifestRecords(manifest.records),
  );
}

function buildPublicationSetContract({
  candidateInputs,
  referenceFindings,
}) {
  return Object.freeze({
    publicationSetContractVersion: PUBLICATION_SET_CONTRACT_VERSION,
    ...candidatePublicationSetMetadata(candidateInputs),
    ...findingPublicationSetMetadata(referenceFindings),
  });
}

export function buildPlannerPublicationSetContract(run) {
  return buildPublicationSetContract({
    candidateInputs:
      canonicalCandidateInputsFromPlannerRecords(run.records),
    referenceFindings:
      canonicalizePublishedFindingBuckets(run.referenceFindings),
  });
}

export function recomputeManifestPublicationSetContract(manifest) {
  return buildPublicationSetContract({
    candidateInputs:
      canonicalCandidateInputsFromManifestRecords(manifest.records),
    referenceFindings: manifest.referenceFindings,
  });
}

export function canonicalizeCriticalRuntimeSourceIdentity(source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) {
    throw new PlannerConfigError(
        "Critical runtime source publication identity is malformed.",
    );
  }
  const expectedFields = [
    "bytesMatch",
    "headBlobOid",
    "headBlobSha256",
    "indexFlagsClean",
    "regularBlob",
    "relativePath",
    "runtimeSha256",
    "tracked",
  ];
  if (stableStringify(Object.keys(source).sort()) !==
      stableStringify(expectedFields)) {
    throw new PlannerConfigError(
        "Critical runtime source publication schema is invalid.",
    );
  }
  const relativePath = requirePublicationString(
      source.relativePath,
      "Critical runtime source relative path",
  );
  if (path.isAbsolute(relativePath) ||
      path.normalize(relativePath) !== relativePath ||
      relativePath.startsWith("../")) {
    throw new PlannerConfigError(
        "Critical runtime source path must be canonical and relative.",
    );
  }
  if (!/^[0-9a-f]{40,64}$/.test(source.headBlobOid || "") ||
      !/^[0-9a-f]{64}$/.test(source.headBlobSha256 || "") ||
      !/^[0-9a-f]{64}$/.test(source.runtimeSha256 || "") ||
      typeof source.tracked !== "boolean" ||
      typeof source.regularBlob !== "boolean" ||
      typeof source.bytesMatch !== "boolean" ||
      typeof source.indexFlagsClean !== "boolean") {
    throw new PlannerConfigError(
        "Critical runtime source publication fields are invalid.",
    );
  }
  return Object.freeze({
    relativePath,
    tracked: source.tracked,
    regularBlob: source.regularBlob,
    headBlobOid: source.headBlobOid,
    headBlobSha256: source.headBlobSha256,
    runtimeSha256: source.runtimeSha256,
    bytesMatch: source.bytesMatch,
    indexFlagsClean: source.indexFlagsClean,
  });
}

function canonicalCriticalRuntimeSourceIdentities(sources) {
  if (!Array.isArray(sources)) {
    throw new PlannerConfigError(
        "Critical runtime sources must be an array.",
    );
  }
  const identities = sources.map(
      canonicalizeCriticalRuntimeSourceIdentity,
  );
  const relativePaths = new Set();
  for (const identity of identities) {
    if (relativePaths.has(identity.relativePath)) {
      throw new PlannerConfigError(
          "Duplicate critical runtime source relative path.",
      );
    }
    relativePaths.add(identity.relativePath);
  }
  return identities.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
}

export function buildRuntimeSourceContract(sources) {
  const identities = canonicalCriticalRuntimeSourceIdentities(sources);
  const identityDigests = identities.map((identity) =>
    digest(identity),
  ).sort();
  return Object.freeze({
    runtimeSourceContractVersion: RUNTIME_SOURCE_CONTRACT_VERSION,
    criticalRuntimeSourceCount: identities.length,
    criticalRuntimeSourceSetDigestVersion:
      CRITICAL_RUNTIME_SOURCE_SET_DIGEST_VERSION,
    criticalRuntimeSourceSetDigest: digest(identityDigests),
  });
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function exactPersistedAcademyId(value) {
  if (typeof value !== "string" ||
      value.length === 0 ||
      value !== value.trim()) {
    return null;
  }
  return value;
}

function canonicalFirestoreNumber(value) {
  if (typeof value !== "number") {
    throw new PlannerConfigError(
        "Firestore numeric value must be a number.",
    );
  }
  if (Number.isNaN(value)) return "NaN";
  if (value === Number.POSITIVE_INFINITY) return "+Infinity";
  if (value === Number.NEGATIVE_INFINITY) return "-Infinity";
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

export function canonicalizeFirestoreValue(value) {
  if (value === null) return ["null"];
  if (typeof value === "boolean") return ["boolean", value];
  if (typeof value === "string") return ["string", value];
  if (typeof value === "number") {
    return ["number", canonicalFirestoreNumber(value)];
  }
  if (value instanceof Date) {
    return ["date", value.toISOString()];
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return ["bytes", Buffer.from(value).toString("base64")];
  }
  if (Array.isArray(value)) {
    return [
      "array",
      value.map((item) => canonicalizeFirestoreValue(item)),
    ];
  }
  const constructorName =
    value && typeof value === "object" ?
      Object.getPrototypeOf(value)?.constructor?.name :
      "";
  if (constructorName === "Timestamp" &&
      Number.isSafeInteger(value.seconds) &&
      Number.isSafeInteger(value.nanoseconds) &&
      value.nanoseconds >= 0 &&
      value.nanoseconds <= 999999999) {
    return [
      "firestore_timestamp",
      String(value.seconds),
      String(value.nanoseconds),
    ];
  }
  if (constructorName === "Timestamp") {
    throw new PlannerConfigError(
        "Firestore Timestamp seconds or nanoseconds are invalid.",
    );
  }
  if (constructorName === "DocumentReference" &&
      typeof value.path === "string" &&
      typeof value.id === "string") {
    return ["documentReference", value.path];
  }
  if (constructorName === "GeoPoint" &&
      typeof value.latitude === "number" &&
      typeof value.longitude === "number") {
    return [
      "geoPoint",
      [
        canonicalFirestoreNumber(value.latitude),
        canonicalFirestoreNumber(value.longitude),
      ],
    ];
  }
  if (value && typeof value === "object") {
    if (Object.getOwnPropertySymbols(value).length > 0) {
      throw new PlannerConfigError(
          "Firestore maps must not contain symbol keys.",
      );
    }
    return [
      "map",
      Object.keys(value).sort().map((key) => [
          key,
          canonicalizeFirestoreValue(value[key]),
      ]),
    ];
  }
  throw new PlannerConfigError(
      "Firestore value cannot be represented canonically.",
  );
}

export function firestoreDocumentDigest(value) {
  return digest(canonicalizeFirestoreValue(value));
}

export function typedDocumentKey(collectionName, documentId) {
  return `${collectionName}:${documentId}`;
}

function rawValuesAtPath(value, dottedPath) {
  const parts = dottedPath.split(".");
  let current = [value];
  for (const part of parts) {
    const next = [];
    for (const item of current) {
      if (Array.isArray(item)) {
        for (const nested of item) {
          if (nested && typeof nested === "object" &&
              Object.prototype.hasOwnProperty.call(nested, part)) {
            next.push(nested[part]);
          }
        }
      } else if (item && typeof item === "object" &&
          Object.prototype.hasOwnProperty.call(item, part)) {
        next.push(item[part]);
      }
    }
    current = next;
  }
  return current;
}

export function describeReferenceValueShape(value, present = true) {
  if (!present || value === undefined) return "missing";
  if (value === null) return "null";
  if (typeof value === "string") {
    return value.length === 0 ? "empty_string" : "string";
  }
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  if (Array.isArray(value)) {
    if (value.length === 0) return "array_empty";
    return value.every((item) => typeof item === "string") ?
      "array_strings" :
      "array_mixed";
  }
  if (typeof value === "object") return "object";
  return "other";
}

function expectedReferenceShape(valueType, allowedAbsenceShapes = []) {
  if (valueType === "array") return "array_strings";
  if (valueType === "string") {
    const allowed = new Set(allowedAbsenceShapes);
    if (allowed.has("null") && allowed.has("empty_string")) {
      return "missing_null_empty_or_non_empty_string";
    }
    if (allowed.has("null")) {
      return "missing_null_or_non_empty_string";
    }
    if (allowed.has("empty_string")) {
      return "missing_empty_or_non_empty_string";
    }
    return "missing_or_non_empty_string";
  }
  return "non_empty_string_or_array_strings";
}

function referenceValueTypeForCardinality(cardinality) {
  if (cardinality === "optional_scalar" ||
      cardinality === "required_scalar") {
    return "string";
  }
  if (cardinality === "optional_array" ||
      cardinality === "required_array") {
    return "array";
  }
  throw new PlannerConfigError("Unknown reference cardinality policy.");
}

function safeReferenceShapeEvidence(value, present = true) {
  const actualShape = describeReferenceValueShape(value, present);
  return {
    actualShape,
    type: actualShape.startsWith("array_") ? "array" :
      actualShape === "empty_string" ? "string" :
      actualShape,
    ...(Array.isArray(value) ? {arrayLength: value.length} : {}),
    ...(typeof value === "string" ?
      {stringEmpty: value.length === 0} :
      {}),
  };
}

export function parseReferenceFieldValues({
  data,
  field,
  valueType,
  cardinality,
  deduplicate = true,
  targetCollections,
  allowedAbsenceShapes = [],
}) {
  const values = [];
  const issues = [];
  const rawValues = rawValuesAtPath(data, field);
  if (cardinality?.startsWith("required_") && rawValues.length === 0) {
    issues.push({
      code: "malformed_reference_field",
      field,
      targetCollections,
      expectedShape: expectedReferenceShape(valueType, allowedAbsenceShapes),
      shapeEvidence: safeReferenceShapeEvidence(undefined, false),
      policyReason: "Required reference field is missing.",
    });
  }
  for (const rawValue of rawValues) {
    if (valueType === "string") {
      const actualShape = describeReferenceValueShape(rawValue);
      if (allowedAbsenceShapes.includes(actualShape)) {
        continue;
      }
      if (actualShape !== "string" || !rawValue.trim()) {
        issues.push({
          code: "malformed_reference_field",
          field,
          targetCollections,
          expectedShape: expectedReferenceShape(
              valueType,
              allowedAbsenceShapes,
          ),
          shapeEvidence: safeReferenceShapeEvidence(rawValue),
          policyReason:
            "Scalar reference must match its field-specific absence " +
            "policy or be a " +
            "non-empty string document ID.",
        });
        continue;
      }
      values.push(rawValue.trim());
      continue;
    }
    const candidates = valueType === "array" ?
      (Array.isArray(rawValue) ? rawValue : null) :
      (Array.isArray(rawValue) ? rawValue : [rawValue]);
    if (!candidates) {
      issues.push({
        code: "malformed_reference_field",
        field,
        targetCollections,
        expectedShape: expectedReferenceShape(
            valueType,
            allowedAbsenceShapes,
        ),
        shapeEvidence: safeReferenceShapeEvidence(rawValue),
        policyReason: "Reference field must be an array of document IDs.",
      });
      continue;
    }
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        issues.push({
          code: "malformed_reference_element",
          field,
          targetCollections,
          expectedShape: expectedReferenceShape(
              valueType,
              allowedAbsenceShapes,
          ),
          shapeEvidence: safeReferenceShapeEvidence(candidate),
          policyReason:
            "Reference values must be non-empty string document IDs.",
        });
        continue;
      }
      values.push(candidate.trim());
    }
  }
  return {
    values: deduplicate ? [...new Set(values)] : values,
    issues,
  };
}

function buildExtractedReference({
  family,
  field,
  documentId,
  targetCollections,
  lookup = "document_id",
  aliasEvidence,
  resolvedValue,
  conflict,
}) {
  return {
    family,
    field,
    documentId,
    invalidIdentifier:
      lookup === "document_id" && documentId.includes("/"),
    targetCollections,
    lookup,
    candidateTypedKeys: lookup === "document_id" ?
      targetCollections.map((targetCollection) =>
        typedDocumentKey(targetCollection, documentId),
      ) :
      [],
    ...(aliasEvidence ? {aliasEvidence} : {}),
    ...(resolvedValue !== undefined ? {resolvedValue} : {}),
    ...(conflict !== undefined ? {conflict} : {}),
  };
}

function hasPersistedFieldValue(data, fields) {
  return fields.some((field) => rawValuesAtPath(data, field).length > 0);
}

function sourceTypeLengthBucket(value) {
  if (typeof value !== "string") return null;
  if (value.length <= 16) return "1-16";
  if (value.length <= 32) return "17-32";
  if (value.length <= 64) return "33-64";
  return "65+";
}

function assertKnownCreditSourceMappingSchema(mapping) {
  if (!mapping || typeof mapping !== "object" ||
      typeof mapping.targetCollection !== "string" ||
      !mapping.targetCollection.trim() ||
      !Array.isArray(mapping.explicitIdFields) ||
      mapping.explicitIdFields.some((field) =>
        typeof field !== "string" || !field.trim(),
      )) {
    throw new PlannerConfigError(
        "Known credit source mapping schema is invalid.",
    );
  }
  return mapping;
}

export function getKnownCreditSourceMapping(sourceType) {
  if (typeof sourceType !== "string" ||
      !Object.hasOwn(CREDIT_SOURCE_REFERENCE_MAPPINGS, sourceType)) {
    return null;
  }
  return assertKnownCreditSourceMappingSchema(
      Reflect.get(CREDIT_SOURCE_REFERENCE_MAPPINGS, sourceType),
  );
}

function buildCreditSourceEvidence(data) {
  const sourceTypeValues = rawValuesAtPath(data, "sourceType");
  const rawSourceType = sourceTypeValues.length === 1 ?
    sourceTypeValues[0] :
    undefined;
  const sourceTypeLiteral =
    getKnownCreditSourceMapping(rawSourceType) ? rawSourceType : null;
  const sourceTypePresent = sourceTypeValues.length > 0;
  const sourceTypeKnown = sourceTypeLiteral !== null;
  return Object.freeze({
    sourceTypeLiteral,
    sourceTypePresent,
    sourceTypeKnown,
    sourceTypeCategory: !sourceTypePresent ?
      "missing" :
      sourceTypeKnown ? "known" : "unknown",
    actualShape: describeReferenceValueShape(
        rawSourceType,
        sourceTypePresent,
    ),
    lengthBucket: sourceTypeLengthBucket(rawSourceType),
    sourceIdPresent: hasPersistedFieldValue(data, ["sourceId"]),
    explicitLessonIdPresent: hasPersistedFieldValue(data, [
      "lessonId",
      "fixedLessonId",
      "linkedLessonId",
    ]),
    explicitReservationIdPresent: hasPersistedFieldValue(data, [
      "reservationId",
      "privateLessonReservationId",
      "linkedReservationId",
    ]),
    explicitSlotIdPresent: hasPersistedFieldValue(data, [
      "slotId",
      "privateLessonSlotId",
      "linkedSlotId",
    ]),
  });
}

function extractCreditSourceReferences(data) {
  const references = [];
  const issues = [];
  const evidence = buildCreditSourceEvidence(data);
  const result = () => ({
    references,
    issues: issues.map((issue) => ({
      ...issue,
      creditSourceEvidence: evidence,
    })),
    evidence,
  });
  const sourceIdResult = parseReferenceFieldValues({
    data,
    field: "sourceId",
    valueType: "string",
    targetCollections: [],
  });
  const sourceTypeResult = parseReferenceFieldValues({
    data,
    field: "sourceType",
    valueType: "string",
    targetCollections: [],
  });
  issues.push(...sourceIdResult.issues, ...sourceTypeResult.issues);
  const sourceIds = sourceIdResult.values;
  const sourceTypes = sourceTypeResult.values;
  if (sourceIds.length > 1 || sourceTypes.length > 1) {
    issues.push({
      code: "ambiguous_credit_source",
      field: "sourceId/sourceType",
      targetCollections: [],
      policyReason: "Credit sourceId and sourceType must be singular.",
    });
    return result();
  }
  const sourceId = sourceIds[0] || "";
  const rawSourceTypeValues = rawValuesAtPath(data, "sourceType");
  const sourceType =
    rawSourceTypeValues.length === 1 &&
    typeof rawSourceTypeValues[0] === "string" &&
    rawSourceTypeValues[0].length > 0 ?
      rawSourceTypeValues[0] :
      sourceTypes[0] || "";
  if (sourceId && !sourceType) {
    issues.push({
      code: "missing_credit_source_type",
      field: "sourceType",
      targetCollections: [],
      policyReason: "Credit sourceId requires an exact sourceType.",
    });
    return result();
  }
  const mapping = sourceType ?
    getKnownCreditSourceMapping(sourceType) :
    null;
  if (sourceType && !mapping) {
    issues.push({
      code: "unknown_credit_source_type",
      field: "sourceType",
      targetCollections: [],
      policyReason: "Credit sourceType is not in the exact mapping allowlist.",
    });
    return result();
  }
  if (sourceType && !sourceId) {
    issues.push({
      code: "missing_credit_source_id",
      field: "sourceId",
      targetCollections: [],
      policyReason: "Credit sourceType requires a sourceId.",
    });
    return result();
  }
  if (!sourceId && !sourceType) return result();
  references.push(buildExtractedReference({
    family: "credit_source",
    field: "sourceId",
    documentId: sourceId,
    targetCollections: [mapping.targetCollection],
  }));
  const explicitIds = [];
  for (const field of mapping.explicitIdFields) {
    const result = parseReferenceFieldValues({
      data,
      field,
      valueType: referenceValueTypeForCardinality(
          mapping.explicitIdCardinality,
      ),
      cardinality: mapping.explicitIdCardinality,
      deduplicate: true,
      targetCollections: [mapping.targetCollection],
    });
    issues.push(...result.issues);
    explicitIds.push(...result.values.map((value) => ({field, value})));
  }
  explicitIds.forEach(({field, value}) => {
    references.push(buildExtractedReference({
      family: "credit_source_explicit",
      field,
      documentId: value,
      targetCollections: [mapping.targetCollection],
    }));
  });
  const conflicting = explicitIds.filter(({value}) => value !== sourceId);
  if (conflicting.length > 0) {
    issues.push({
      code: "conflicting_credit_source_reference",
      field: conflicting.map(({field}) => field).join(","),
      targetCollections: [mapping.targetCollection],
      candidateTypedKeys: [
        typedDocumentKey(mapping.targetCollection, sourceId),
        ...conflicting.map(({value}) =>
          typedDocumentKey(mapping.targetCollection, value),
        ),
      ],
      policyReason:
        "Credit sourceId conflicts with its explicit typed target field.",
    });
  }
  const explicitTargetGroups = [
    {
      family: "credit_explicit_lesson",
      fields: ["lessonId", "fixedLessonId", "linkedLessonId"],
      targetCollection: sourceType === "groupLesson" ?
        "groupLessons" :
        "lessons",
    },
    {
      family: "credit_explicit_reservation",
      fields: [
        "reservationId",
        "privateLessonReservationId",
        "linkedReservationId",
      ],
      targetCollection: "privateLessonReservations",
    },
    {
      family: "credit_explicit_slot",
      fields: ["slotId", "privateLessonSlotId", "linkedSlotId"],
      targetCollection: "privateLessonSlots",
    },
  ];
  for (const [groupIndex, group] of explicitTargetGroups.entries()) {
    const fieldSpec =
      CREDIT_SOURCE_GENERIC_REFERENCE_FIELD_SPECS[groupIndex];
    if (stableStringify(fieldSpec?.fields) !==
        stableStringify(group.fields)) {
      throw new PlannerConfigError(
          "Credit source generic reference field contract mismatch.",
      );
    }
    for (const field of group.fields) {
      const result = parseReferenceFieldValues({
        data,
        field,
        valueType: referenceValueTypeForCardinality(
            fieldSpec.cardinality,
        ),
        cardinality: fieldSpec.cardinality,
        deduplicate: true,
        targetCollections: [group.targetCollection],
      });
      issues.push(...result.issues);
      result.values.forEach((value) => {
        references.push(buildExtractedReference({
          family: group.family,
          field,
          documentId: value,
          targetCollections: [group.targetCollection],
        }));
      });
    }
  }
  return result();
}

function extractReferences(registryEntry, data) {
  const references = [];
  const issues = [];
  let creditSourceEvidence = null;
  let teacherIdentityEvidence = null;
  for (const extractor of registryEntry.referenceExtractors) {
    const valuesByField = new Map();
    for (const fieldSpec of extractor.fieldSpecs) {
      const {field} = fieldSpec;
      const valueType =
        referenceValueTypeForCardinality(fieldSpec.cardinality);
      const allowedAbsenceShapes = [
        ...(fieldSpec.allowNull ? ["null"] : []),
        ...(fieldSpec.allowEmptyString ? ["empty_string"] : []),
      ];
      const parsed = parseReferenceFieldValues({
        data,
        field,
        valueType,
        cardinality: fieldSpec.cardinality,
        deduplicate: fieldSpec.deduplicate,
        targetCollections: fieldSpec.targetCollections,
        allowedAbsenceShapes,
      });
      issues.push(...parsed.issues.map((issue) => ({
        ...issue,
        family: extractor.family,
      })));
      valuesByField.set(field, parsed.values);
      if (extractor.aliasPolicy !== "strict_scalar_alias") {
        for (const documentId of parsed.values) {
          references.push(buildExtractedReference({
            family: extractor.family,
            field,
            documentId,
            targetCollections: fieldSpec.targetCollections,
            lookup: extractor.lookup,
          }));
        }
      }
    }
    if (extractor.aliasPolicy === "strict_scalar_alias") {
      const aliasEvidence = [...valuesByField.entries()].flatMap(
          ([field, values]) => values.map((value) => ({field, value})),
      );
      const distinctValues = new Set(
          aliasEvidence.map(({value}) => value),
      );
      const conflict = distinctValues.size > 1 ||
        [...valuesByField.values()].some((values) => values.length > 1);
      if (conflict) {
        const conflictCodeByFamily = {
          membership_principal:
            "conflicting_membership_principal_uid_alias",
          teacher_identity_uid: "conflicting_teacher_uid_alias",
          teacher_identity_id: "conflicting_teacher_id_alias",
          teacher_identity_key: "conflicting_teacher_key_alias",
        };
        issues.push({
          code: conflictCodeByFamily[extractor.family] ||
            "ambiguous_reference_alias",
          field: extractor.fields.join(","),
          targetCollections: extractor.targetCollections,
          candidateTypedKeys: [...distinctValues].flatMap((documentId) =>
            extractor.targetCollections.map((targetCollection) =>
              typedDocumentKey(targetCollection, documentId),
            ),
          ),
          aliasEvidence,
          resolvedValue: null,
          conflict: true,
          policyReason:
            "Reference aliases contain conflicting document IDs.",
        });
      } else if (distinctValues.size === 1) {
        const [resolvedValue] = distinctValues;
        references.push(buildExtractedReference({
          family: extractor.family,
          field: [...valuesByField.entries()]
              .filter(([, values]) => values.length > 0)
              .map(([field]) => field)
              .join(","),
          documentId: resolvedValue,
          targetCollections: extractor.targetCollections,
          lookup: extractor.lookup,
          aliasEvidence,
          resolvedValue,
          conflict: false,
        }));
      }
    }
    if (extractor.aliasPolicy === "same_single_value") {
      const distinctValues = new Set(
          [...valuesByField.values()].flat(),
      );
      if (distinctValues.size > 1 ||
          [...valuesByField.values()].some((values) => values.length > 1)) {
        issues.push({
          code: "ambiguous_reference_alias",
          field: extractor.fields.join(","),
          targetCollections: extractor.targetCollections,
          candidateTypedKeys: [...distinctValues].flatMap((documentId) =>
            extractor.targetCollections.map((targetCollection) =>
              typedDocumentKey(targetCollection, documentId),
            ),
          ),
          policyReason:
            "Reference aliases contain conflicting document IDs.",
        });
      }
    }
  }
  if (registryEntry.collectionName === "creditTransactions") {
    const creditSource = extractCreditSourceReferences(data);
    references.push(...creditSource.references);
    issues.push(...creditSource.issues);
    creditSourceEvidence = creditSource.evidence;
  }
  if (["academyMemberships", "accountProvisioningLogs"].includes(
      registryEntry.collectionName,
  )) {
    teacherIdentityEvidence = buildTeacherIdentityEvidence(data);
  }
  if (registryEntry.collectionName === "accountProvisioningLogs") {
    const studentIdentityFields = ["studentId"];
    const teacherIdentityFields = [
      "teacherId",
      "teacherID",
      "teacherKey",
      "teacherUid",
      "teacherUID",
      "teacher",
    ];
    const studentIdentityPresent =
      hasPersistedFieldValue(data, studentIdentityFields);
    const teacherIdentityPresent =
      hasPersistedFieldValue(data, teacherIdentityFields);
    if (studentIdentityPresent && teacherIdentityPresent) {
      issues.push({
        code: "mixed_provisioning_identity",
        family: "provisioning_identity",
        field: [
          ...studentIdentityFields.filter((field) =>
            hasPersistedFieldValue(data, [field]),
          ),
          ...teacherIdentityFields.filter((field) =>
            hasPersistedFieldValue(data, [field]),
          ),
        ].join(","),
        targetCollections: ["privateStudents", "teachers"],
        policyReason:
          "Provisioning logs without an authoritative flow discriminator " +
          "must not mix student and teacher identity families.",
      });
    }
  }
  const unique = new Map();
  references.forEach((item) => {
    const key = stableStringify(item);
    if (!unique.has(key)) unique.set(key, item);
  });
  const uniqueIssues = new Map();
  issues.forEach((item) => {
    const key = stableStringify(item);
    if (!uniqueIssues.has(key)) uniqueIssues.set(key, item);
  });
  return {
    references: [...unique.values()].sort((a, b) =>
      stableStringify(a).localeCompare(stableStringify(b)),
    ),
    issues: [...uniqueIssues.values()].sort((a, b) =>
      stableStringify(a).localeCompare(stableStringify(b)),
    ),
    creditSourceEvidence,
    teacherIdentityEvidence,
  };
}

function isTestDataProfile(resetProfile) {
  return resetProfile === ALL_ACADEMY_DATA_TEST_PROFILE;
}

export function createCanonicalExecutionSafetyContract() {
  return Object.freeze({
    executionSafetyContractVersion: EXECUTION_SAFETY_CONTRACT_VERSION,
    planClassification: "non_executable_advisory",
    snapshotMode: "live_read_only_unfrozen",
    writeFreezeRequiredForExecution: true,
    writeFreezeVerified: false,
    freshPlanRequiredUnderWriteFreeze: true,
    executorRevalidationRequired: true,
    executionEligible: false,
    executorImplemented: false,
    writeAuthorized: false,
    actualWrites: 0,
  });
}

export function readExecutionSafetyContract(
    value,
    {requireCanonicalValues = true} = {},
) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Number.isSafeInteger(value.executionSafetyContractVersion) ||
      typeof value.planClassification !== "string" ||
      typeof value.snapshotMode !== "string" ||
      typeof value.writeFreezeRequiredForExecution !== "boolean" ||
      typeof value.writeFreezeVerified !== "boolean" ||
      typeof value.freshPlanRequiredUnderWriteFreeze !== "boolean" ||
      typeof value.executorRevalidationRequired !== "boolean" ||
      typeof value.executionEligible !== "boolean" ||
      typeof value.executorImplemented !== "boolean" ||
      typeof value.writeAuthorized !== "boolean" ||
      typeof value.actualWrites !== "number" ||
      !Number.isFinite(value.actualWrites)) {
    throw new PlannerConfigError(
        "Planner execution safety contract is malformed.",
    );
  }
  const contract = Object.freeze({
    executionSafetyContractVersion:
      value.executionSafetyContractVersion,
    planClassification: value.planClassification,
    snapshotMode: value.snapshotMode,
    writeFreezeRequiredForExecution:
      value.writeFreezeRequiredForExecution,
    writeFreezeVerified: value.writeFreezeVerified,
    freshPlanRequiredUnderWriteFreeze:
      value.freshPlanRequiredUnderWriteFreeze,
    executorRevalidationRequired: value.executorRevalidationRequired,
    executionEligible: value.executionEligible,
    executorImplemented: value.executorImplemented,
    writeAuthorized: value.writeAuthorized,
    actualWrites: value.actualWrites,
  });
  if (requireCanonicalValues &&
      stableStringify(contract) !==
        stableStringify(createCanonicalExecutionSafetyContract())) {
    throw new PlannerConfigError(
        "Planner execution safety contract is not advisory-only.",
    );
  }
  return contract;
}

function plannerSafetyContract({
  resetProfile,
  fullBackupWaiverConfirmed,
}) {
  const waived = isTestDataProfile(resetProfile);
  return Object.freeze({
    backupPolicy: waived ?
      "operator_waived_full_backup" :
      "managed_firestore_export_required",
    dataRecoveryAvailable: false,
    managedExportRequired: !waived,
    managedFirestoreExportRequired: !waived,
    fullBackupWaiverConfirmed:
      waived && fullBackupWaiverConfirmed === true,
    minimumSafetySnapshotsRequired:
      MINIMUM_SAFETY_SNAPSHOTS_REQUIRED,
    ...IRREVERSIBLE_EXECUTOR_BOUNDARY,
    backupVerified: false,
    resetApproved: false,
    independentReviewApproved: false,
  });
}

const OUTPUT_POLICY_PARITY_FIELDS = Object.freeze([
  "resetProfile",
  "topLevelOutputSchemaVersion",
  "canonicalPlanSchemaVersion",
  "summarySchemaVersion",
  "manifestSchemaVersion",
  "referenceCardinalityPolicyVersion",
  "referenceFieldSpecSchemaDigest",
  "firestoreValueCanonicalizationVersion",
  "profilePolicyVersion",
  "membershipClassificationPolicyVersion",
  "knownCreditSourceAllowlistVersion",
  "operatorTestDataConfirmation",
  "provisioningLogPolicy",
  "provisioningLogPolicyReason",
  "backupPolicy",
  "fullBackupWaiverConfirmed",
  "dataRecoveryAvailable",
  "managedExportRequired",
  "managedFirestoreExportRequired",
  "minimumSafetySnapshotsRequired",
  "executionSafetyContract",
  "executionSafetyContractVersion",
  "planClassification",
  "snapshotMode",
  "writeFreezeRequiredForExecution",
  "writeFreezeVerified",
  "freshPlanRequiredUnderWriteFreeze",
  "executorRevalidationRequired",
  "executionEligible",
  "irreversibleExecutorConfirmationRequired",
  "irreversibleExecutorConfirmationName",
  "irreversibleExecutorConfirmationValue",
  "exactPlanDigestRequired",
  "exactDeleteCountRequired",
  "backupVerified",
  "resetApproved",
  "independentReviewApproved",
  "writeAuthorized",
  "executorImplemented",
  "actualWrites",
]);

export function buildReferenceFieldSpecSchemaDigest(
    fieldSpecs = REFERENCE_FIELD_SPECS,
    creditMappings = CREDIT_SOURCE_REFERENCE_MAPPINGS,
    genericCreditFieldSpecs = CREDIT_SOURCE_GENERIC_REFERENCE_FIELD_SPECS,
) {
  if (!Array.isArray(fieldSpecs) ||
      !creditMappings ||
      !Array.isArray(genericCreditFieldSpecs)) {
    throw new PlannerConfigError(
        "Reference field specs must be loaded before policy construction.",
    );
  }
  const canonicalSpecs = fieldSpecs.map((fieldSpec) => ({
    collectionName: fieldSpec.collectionName,
    family: fieldSpec.family,
    field: fieldSpec.field,
    targetCollections: [...fieldSpec.targetCollections].sort(),
    cardinality: fieldSpec.cardinality,
    allowNull: fieldSpec.allowNull,
    allowEmptyString: fieldSpec.allowEmptyString,
    deduplicate: fieldSpec.deduplicate,
    policyVersion: fieldSpec.policyVersion,
    aliasPolicy: fieldSpec.aliasPolicy,
    lookup: fieldSpec.lookup,
  })).sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)),
  );
  const canonicalCreditMappingSpecs = Object.entries(creditMappings)
      .flatMap(([sourceType, mapping]) =>
        mapping.explicitIdFields.map((field) => ({
          sourceType,
          field,
          targetCollection: mapping.targetCollection,
          cardinality: mapping.explicitIdCardinality,
        })),
      )
      .sort((left, right) =>
        stableStringify(left).localeCompare(stableStringify(right)),
      );
  const canonicalGenericCreditSpecs = genericCreditFieldSpecs
      .map((fieldSpec) => ({
        fields: [...fieldSpec.fields].sort(),
        cardinality: fieldSpec.cardinality,
      }))
      .sort((left, right) =>
        stableStringify(left).localeCompare(stableStringify(right)),
      );
  return digest({
    registryFieldSpecs: canonicalSpecs,
    creditMappingFieldSpecs: canonicalCreditMappingSpecs,
    genericCreditFieldSpecs: canonicalGenericCreditSpecs,
  });
}

function canonicalPlannerPolicy({
  resetProfile,
  operatorTestDataConfirmation,
  fullBackupWaiverConfirmed,
}) {
  const executionSafetyContract =
    createCanonicalExecutionSafetyContract();
  return Object.freeze({
    resetProfile: resetProfile || null,
    topLevelOutputSchemaVersion: TOP_LEVEL_OUTPUT_SCHEMA_VERSION,
    canonicalPlanSchemaVersion: CANONICAL_PLAN_SCHEMA_VERSION,
    summarySchemaVersion: REDACTED_SUMMARY_SCHEMA_VERSION,
    manifestSchemaVersion: SENSITIVE_MANIFEST_SCHEMA_VERSION,
    referenceCardinalityPolicyVersion:
      REFERENCE_CARDINALITY_POLICY_VERSION,
    referenceFieldSpecSchemaDigest:
      buildReferenceFieldSpecSchemaDigest(),
    firestoreValueCanonicalizationVersion:
      FIRESTORE_VALUE_CANONICALIZATION_VERSION,
    profilePolicyVersion: PROFILE_POLICY_VERSION,
    membershipClassificationPolicyVersion:
      MEMBERSHIP_CLASSIFICATION_POLICY_VERSION,
    knownCreditSourceAllowlistVersion:
      KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION,
    operatorTestDataConfirmation,
    provisioningLogPolicy: isTestDataProfile(resetProfile) ?
      "archive_then_reset" :
      "retain",
    provisioningLogPolicyReason: isTestDataProfile(resetProfile) ?
      "archive_then_reset_under_operator_backup_waiver" :
      "retain_until_retention_review",
    ...plannerSafetyContract({
      resetProfile,
      fullBackupWaiverConfirmed,
    }),
    executionSafetyContract,
    ...executionSafetyContract,
  });
}

export function assertOutputPolicyParity(summary, manifest) {
  for (const [label, output] of [
    ["summary", summary],
    ["manifest", manifest],
  ]) {
    if (!Number.isSafeInteger(
        output?.firestoreValueCanonicalizationVersion,
    ) ||
        output.firestoreValueCanonicalizationVersion !==
          FIRESTORE_VALUE_CANONICALIZATION_VERSION) {
      throw new PlannerConfigError(
          `Planner ${label} Firestore canonicalization version is invalid.`,
      );
    }
  }
  for (const field of OUTPUT_POLICY_PARITY_FIELDS) {
    if (stableStringify(summary?.[field]) !==
        stableStringify(manifest?.[field])) {
      throw new PlannerConfigError(
          `Planner output policy parity mismatch: ${field}.`,
      );
    }
  }
}

export function buildCanonicalPlanDigestInput(canonicalPlan) {
  const canonicalInput = Object.fromEntries([
    "planVersion",
    "project",
    "academy",
    "releaseSha",
    "runtimeHeadSha",
    "runtimeTreeSha",
    "criticalRuntimeSources",
    ...OUTPUT_POLICY_PARITY_FIELDS,
    "firstRunDigest",
    "secondRunDigest",
    "consistency",
    "candidateSetDigest",
    "expectedDeleteCount",
    "findingDeduplicationResult",
    "publicationSetContract",
    "recordSetContract",
    "runtimeSourceContract",
    "collectionDiscoveryContract",
    "completedRuns",
    "registryContract",
    "collectionCounts",
    "referenceCounts",
    "plannedMutations",
  ].map((field) => [field, canonicalPlan[field]]));
  canonicalInput.criticalRuntimeSources =
    canonicalCriticalRuntimeSourceIdentities(
        canonicalPlan.criticalRuntimeSources,
    );
  canonicalInput.publicationStateContract =
    readPublicationStateContract(canonicalPlan, {
      requireSupportedVersion: false,
    });
  canonicalInput.executionSafetyContract =
    readExecutionSafetyContract(canonicalPlan, {
      requireCanonicalValues: false,
    });
  canonicalInput.claimedExecutionSafetyContract =
    readExecutionSafetyContract(canonicalPlan.executionSafetyContract, {
      requireCanonicalValues: false,
    });
  return canonicalInput;
}

export function buildCanonicalPlanDigest(canonicalPlan) {
  return digest(buildCanonicalPlanDigestInput(canonicalPlan));
}

function deepFreezeCanonicalSnapshot(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const nested of Object.values(value)) {
    deepFreezeCanonicalSnapshot(nested);
  }
  return Object.freeze(value);
}

function detachedCanonicalClone(value) {
  if (Array.isArray(value)) {
    return value.map(detachedCanonicalClone);
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        detachedCanonicalClone(nested),
      ]),
  );
}

const TRUSTED_CANONICAL_PLAN_SNAPSHOTS = new WeakSet();

function immutableCanonicalSnapshot(value) {
  const snapshot =
    deepFreezeCanonicalSnapshot(detachedCanonicalClone(value));
  TRUSTED_CANONICAL_PLAN_SNAPSHOTS.add(snapshot);
  return snapshot;
}

function assertTrustedCanonicalPlanSnapshot(canonicalPlan) {
  if (!TRUSTED_CANONICAL_PLAN_SNAPSHOTS.has(canonicalPlan)) {
    throw new PlannerConfigError(
        "Publication requires the original canonical plan snapshot.",
    );
  }
}

function minimalAliasFieldEvidence(value, present = true) {
  const shape = describeReferenceValueShape(value, present);
  return {
    present,
    shape,
    ...(typeof value === "string" || typeof value === "boolean" ?
      {value} :
      {}),
  };
}

function collectScalarAliasFamily(data, fields, {
  booleanCanonicalizer = null,
  normalize = (value) => value.trim(),
  requireExactString = false,
} = {}) {
  const rawFields = {};
  const canonicalValues = [];
  let malformed = false;
  for (const field of fields) {
    const values = rawValuesAtPath(data, field);
    if (values.length === 0) continue;
    if (values.length > 1) malformed = true;
    const value = values[0];
    rawFields[field] = minimalAliasFieldEvidence(value);
    if (value == null || value === "") {
      malformed = true;
      continue;
    }
    if (typeof value === "string") {
      const normalized = normalize(value);
      if (requireExactString && normalized !== value) malformed = true;
      if (normalized) canonicalValues.push(normalized);
      else malformed = true;
      continue;
    }
    if (typeof value === "boolean" && booleanCanonicalizer) {
      canonicalValues.push(booleanCanonicalizer(value));
      continue;
    }
    malformed = true;
  }
  const uniqueValues = [...new Set(canonicalValues)].sort();
  return Object.freeze({
    rawFields: Object.freeze(rawFields),
    uniqueValues: Object.freeze(uniqueValues),
    resolvedValue: uniqueValues.length === 1 ? uniqueValues[0] : null,
    conflict: uniqueValues.length > 1,
    malformed,
    present: Object.keys(rawFields).length > 0,
  });
}

function buildMembershipStatusEvidence(data) {
  const present = Boolean(
      data &&
      Object.prototype.hasOwnProperty.call(data, "status"),
  );
  const value = present ? data.status : undefined;
  const exactString = typeof value === "string" &&
    value.length > 0 &&
    value === value.trim();
  const known = exactString &&
    KNOWN_MEMBERSHIP_STATUSES.includes(value);
  return Object.freeze({
    rawFields: Object.freeze({
      ...(present ? {status: minimalAliasFieldEvidence(value)} : {}),
    }),
    uniqueValues: Object.freeze(known ? [value] : []),
    resolvedStatus: known ? value : null,
    conflict: false,
    primaryStatusPresent: present,
    known,
    malformed: !present || !exactString || !known,
  });
}

function buildMembershipPrincipalEvidence(data) {
  return collectScalarAliasFamily(data, MEMBERSHIP_PRINCIPAL_UID_FIELDS, {
    requireExactString: true,
  });
}

function buildTeacherIdentityEvidence(data) {
  return Object.freeze(Object.fromEntries(
      Object.entries(TEACHER_IDENTITY_FIELD_FAMILIES).map(
          ([family, fields]) => [
            family,
            collectScalarAliasFamily(data, fields, {
              requireExactString: true,
            }),
          ],
      ),
  ));
}

function buildTeacherResolverIdentityEvidence(data) {
  return Object.freeze({
    authUid: collectScalarAliasFamily(
        data,
        [
          ...MEMBERSHIP_PRINCIPAL_UID_FIELDS,
          ...TEACHER_IDENTITY_FIELD_FAMILIES.authUid,
          "userId",
          "linkedUid",
        ],
        {requireExactString: true},
    ),
    teacherId: collectScalarAliasFamily(
        data,
        TEACHER_IDENTITY_FIELD_FAMILIES.teacherId,
        {requireExactString: true},
    ),
    teacherKey: collectScalarAliasFamily(
        data,
        TEACHER_IDENTITY_FIELD_FAMILIES.teacherKey,
        {requireExactString: true},
    ),
  });
}

function teacherIdentityAliasEvidence(identityEvidence) {
  return Object.entries(identityEvidence).flatMap(([family, evidence]) =>
    Object.entries(evidence.rawFields).map(([field, item]) => ({
      family,
      field,
      ...item,
    })),
  );
}

function hasNonEmptyStringField(data, fields) {
  return fields.some((field) =>
    rawValuesAtPath(data, field).some((value) =>
      typeof value === "string" && value.trim().length > 0,
    ),
  );
}

export function classifyMembershipForTestDataProfile(data) {
  const rolePresent = Boolean(
      data &&
      Object.prototype.hasOwnProperty.call(data, "role"),
  );
  const rawRole = rolePresent ? data.role : undefined;
  const roleExactString = typeof rawRole === "string" &&
    rawRole.length > 0 &&
    rawRole === rawRole.trim();
  const roleKnown = roleExactString &&
    [...STAFF_MEMBERSHIP_ROLES, "student"].includes(rawRole);
  const role = roleKnown ? rawRole : null;
  const statusEvidence = buildMembershipStatusEvidence(data);
  const membershipPrincipalEvidence =
    buildMembershipPrincipalEvidence(data);
  const teacherIdentityEvidence = buildTeacherIdentityEvidence(data);
  const staffRole = STAFF_MEMBERSHIP_ROLES.includes(role);
  const studentRole = role === "student";
  const permissions = data?.permissions;
  const permissionsPresent = Boolean(
      data &&
      Object.prototype.hasOwnProperty.call(data, "permissions"),
  );
  const permissionsWellFormed =
    !permissionsPresent ||
    Boolean(
        permissions &&
        typeof permissions === "object" &&
        !Array.isArray(permissions) &&
        Object.values(permissions).every(
            (value) => typeof value === "boolean",
        ),
    );
  const staffPermissionPresent = Boolean(
      permissions &&
      typeof permissions === "object" &&
      !Array.isArray(permissions) &&
      Object.values(permissions).some((value) => value === true),
  );
  const identityFamilies = Object.values(teacherIdentityEvidence);
  const teacherIdentityPresent = identityFamilies.some(
      ({resolvedValue}) => resolvedValue !== null,
  );
  const teacherIdentityMalformed = identityFamilies.some(
      ({malformed}) => malformed,
  );
  const teacherIdentityConflict = identityFamilies.some(
      ({conflict}) => conflict,
  );
  const membershipPrincipalMalformed =
    membershipPrincipalEvidence.malformed;
  const membershipPrincipalConflict =
    membershipPrincipalEvidence.conflict;
  const membershipPrincipalPresent =
    membershipPrincipalEvidence.resolvedValue !== null;
  const studentPointerPresent = hasNonEmptyStringField(data, ["studentId"]);
  const roleStatus = staffRole ? "staff" :
    studentRole ? "student" :
    rolePresent ? "invalid" :
    "missing";
  const malformedIdentityEvidence =
    !permissionsWellFormed ||
    membershipPrincipalMalformed ||
    membershipPrincipalConflict ||
    teacherIdentityMalformed ||
    teacherIdentityConflict;
  const conflictingStudentEvidence =
    studentRole && (staffPermissionPresent || teacherIdentityPresent);
  const validStatus = statusEvidence.known &&
    !statusEvidence.conflict &&
    !statusEvidence.malformed;
  const staffStrongIdentityRequired =
    role === "teacher" || role === "staff";
  const strongStaffIdentityPresent =
    membershipPrincipalPresent || teacherIdentityPresent;
  const principalTeacherUidConflict = staffRole &&
    membershipPrincipalPresent &&
    teacherIdentityEvidence.authUid.resolvedValue !== null &&
    membershipPrincipalEvidence.resolvedValue !==
      teacherIdentityEvidence.authUid.resolvedValue;
  const invalidRole = !roleKnown;
  const blockerReasons = [
    ...(invalidRole ? ["invalid_membership_role_literal"] : []),
    ...(!validStatus ? ["invalid_membership_status_literal"] : []),
    ...(membershipPrincipalConflict ?
      ["conflicting_membership_principal_uid_alias"] :
      []),
    ...(teacherIdentityEvidence.authUid.conflict ?
      ["conflicting_teacher_uid_alias"] :
      []),
    ...(teacherIdentityEvidence.teacherId.conflict ?
      ["conflicting_teacher_id_alias"] :
      []),
    ...(teacherIdentityEvidence.teacherKey.conflict ?
      ["conflicting_teacher_key_alias"] :
      []),
    ...((conflictingStudentEvidence || principalTeacherUidConflict) ?
      ["membership_role_identity_conflict"] :
      []),
  ];
  const decision = invalidRole ||
      !validStatus ||
      malformedIdentityEvidence ||
      principalTeacherUidConflict ?
    "ambiguous_membership" :
    staffRole &&
      (!staffStrongIdentityRequired || strongStaffIdentityPresent) ?
    "preserve_staff_membership" :
    studentRole &&
      studentPointerPresent &&
      !conflictingStudentEvidence ?
      "reset_test_membership" :
      "ambiguous_membership";
  if (decision === "ambiguous_membership" &&
      blockerReasons.length === 0) {
    blockerReasons.push("ambiguous_membership");
  }
  return Object.freeze({
    decision,
    roleStatus,
    ...(staffRole || studentRole ? {roleLiteral: role} : {}),
    statusStatus: statusEvidence.resolvedStatus ||
      (statusEvidence.primaryStatusPresent ? "invalid" : "missing"),
    statusEvidence,
    blockerReasons: Object.freeze(blockerReasons),
    permissionsWellFormed,
    staffPermissionPresent,
    membershipPrincipalPresent,
    membershipPrincipalMalformed,
    membershipPrincipalConflict,
    membershipPrincipalEvidence,
    teacherIdentityPresent,
    teacherIdentityMalformed,
    teacherIdentityConflict,
    teacherIdentityEvidence,
    studentPointerPresent,
    preservedPointerCleanupRequired:
      decision === "preserve_staff_membership" &&
      studentPointerPresent,
  });
}

function classifyKnownDocument({
  registryEntry,
  documentId,
  data,
  academy,
  resetProfile,
}) {
  const strategy = registryEntry.academyScopeStrategy;
  let scope = "global";
  let scopeAcademyId = null;
  let malformedScope = false;
  if (strategy === SCOPE.ACADEMY_DOCUMENT_ID) {
    scope = documentId === academy ? "target_academy" : "other_academy";
    scopeAcademyId = documentId;
  } else if (strategy === SCOPE.GLOBAL_DOCUMENT) {
    scope = "global";
  } else {
    const persistedAcademyId = exactPersistedAcademyId(data.academyId);
    if (!persistedAcademyId) {
      scope = "malformed";
      malformedScope = true;
    } else {
      scopeAcademyId = persistedAcademyId;
      scope = persistedAcademyId === academy ?
        "target_academy" :
        "other_academy";
    }
  }

  let disposition = "preserve";
  if (malformedScope) {
    disposition = "unknown";
  } else if (scope === "target_academy" &&
      registryEntry.classification === RESET_CLASS) {
    disposition = "reset";
  } else if (registryEntry.classification === RETAIN_CLASS) {
    disposition = "retain";
  } else if (registryEntry.classification === GLOBAL_CLASS) {
    disposition = "global_preserve";
  } else if (scope === "other_academy") {
    disposition = "other_academy_preserve";
  } else if (registryEntry.classification === PRESERVE_CLASS) {
    disposition = "preserve";
  }

  let membershipProfileDecision = null;
  let profilePolicyReason = null;
  if (isTestDataProfile(resetProfile) && scope === "target_academy") {
    if (registryEntry.collectionName === "academyMemberships") {
      membershipProfileDecision =
        classifyMembershipForTestDataProfile(data);
      if (membershipProfileDecision.decision ===
          "preserve_staff_membership") {
        disposition = "preserve";
      } else if (membershipProfileDecision.decision ===
          "reset_test_membership") {
        disposition = "reset";
      } else {
        disposition = "unknown";
      }
      profilePolicyReason = membershipProfileDecision.decision;
    } else if (registryEntry.collectionName ===
        "accountProvisioningLogs") {
      disposition = "reset";
      profilePolicyReason =
        "archive_then_reset_under_operator_backup_waiver";
    }
  }

  return {
    scope,
    scopeAcademyId,
    malformedScope,
    disposition,
    membershipProfileDecision,
    profilePolicyReason,
    scopeEvidence: {
      strategy,
      result: scope,
      exactAcademyMatch: scope === "target_academy",
    },
  };
}

function documentRecord({
  collectionName,
  documentId,
  data,
  registryEntry,
  academy,
  resetProfile,
}) {
  const scope = classifyKnownDocument({
    registryEntry,
    documentId,
    data,
    academy,
    resetProfile,
  });
  const extractedReferences = extractReferences(registryEntry, data);
  return {
    collection: collectionName,
    documentId,
    rawDocumentPath: `${collectionName}/${documentId}`,
    typedDocumentKey: typedDocumentKey(collectionName, documentId),
    classification: registryEntry.classification,
    disposition: scope.disposition,
    deletionOrderGroup:
      scope.disposition === "reset" ?
        (isTestDataProfile(resetProfile) &&
          registryEntry.profileResetDeletionOrderGroup > 0 ?
          registryEntry.profileResetDeletionOrderGroup :
          registryEntry.expectedDeletionOrderGroup) :
        0,
    scope: scope.scope,
    scopeAcademyId: scope.scopeAcademyId,
    academyScopeEvidence: scope.scopeEvidence,
    documentDigest: firestoreDocumentDigest(data),
    references: extractedReferences.references,
    referenceIssues: extractedReferences.issues,
    creditSourceEvidence: extractedReferences.creditSourceEvidence,
    teacherIdentityEvidence:
      extractedReferences.teacherIdentityEvidence ||
      (collectionName === "teachers" ?
        buildTeacherResolverIdentityEvidence(data) :
        null),
    membershipProfileDecision: scope.membershipProfileDecision,
    profilePolicyReason: scope.profilePolicyReason,
    warnings: [
      ...(scope.malformedScope ? ["academy_scope_unresolved"] : []),
      ...(scope.membershipProfileDecision?.decision ===
        "ambiguous_membership" ?
        scope.membershipProfileDecision.blockerReasons :
        []),
    ],
  };
}

function unknownDocumentRecord({
  collectionName,
  documentId,
  data,
  academy,
}) {
  const persistedAcademyId = exactPersistedAcademyId(data.academyId);
  const scope = !persistedAcademyId ?
    "unknown_global_or_malformed" :
    persistedAcademyId === academy ?
      "unknown_target_academy" :
      "unknown_other_academy";
  return {
    collection: collectionName,
    documentId,
    rawDocumentPath: `${collectionName}/${documentId}`,
    typedDocumentKey: typedDocumentKey(collectionName, documentId),
    classification: "UNKNOWN_BLOCKER",
    disposition: "unknown",
    deletionOrderGroup: 0,
    scope,
    scopeAcademyId: persistedAcademyId || null,
    academyScopeEvidence: {
      strategy: "unregistered_collection",
      result: scope,
      exactAcademyMatch: persistedAcademyId === academy,
    },
    documentDigest: firestoreDocumentDigest(data),
    references: [],
    referenceIssues: [],
    warnings: ["unknown_runtime_collection"],
  };
}

async function scanCollectionPages({
  db,
  collectionName,
  pageSize,
  buildRecord,
}) {
  const records = [];
  const cursors = new Set();
  let cursor = "";
  let pageCount = 0;
  while (true) {
    let query = db.collection(collectionName)
        .orderBy("__name__")
        .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    pageCount += 1;
    if (snapshot.size > pageSize) {
      throw new PlannerIncompleteError(
          `Page bound exceeded for ${collectionName}.`,
      );
    }
    for (const document of snapshot.docs) {
      records.push(buildRecord({
        documentId: document.id,
        data: document.data() || {},
      }));
    }
    if (snapshot.size < pageSize) break;
    const nextCursor = snapshot.docs[snapshot.docs.length - 1]?.id || "";
    if (!nextCursor || nextCursor === cursor || cursors.has(nextCursor)) {
      throw new PlannerIncompleteError(
          `Cursor loop detected for ${collectionName}.`,
      );
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  return {records, pageCount, complete: true, truncated: false, omitted: 0};
}

function emptyCollectionCounts() {
  return {
    scanned: 0,
    reset: 0,
    preserved: 0,
    retained: 0,
    unknown: 0,
  };
}

function summarizeCollectionRecords(records) {
  const counts = emptyCollectionCounts();
  for (const record of records) {
    counts.scanned += 1;
    if (record.disposition === "reset") counts.reset += 1;
    else if (record.disposition === "retain") counts.retained += 1;
    else if (record.disposition === "unknown") counts.unknown += 1;
    else counts.preserved += 1;
  }
  return counts;
}

function isPreservedDisposition(disposition) {
  return [
    "preserve",
    "retain",
    "global_preserve",
    "other_academy_preserve",
  ].includes(disposition);
}

function referenceTargetClassifications(reference) {
  return [...new Set(reference.candidateTypedKeys.map((key) => {
    const separator = key.indexOf(":");
    const collectionName = separator === -1 ? "" : key.slice(0, separator);
    return RESET_REGISTRY_BY_COLLECTION[collectionName]?.classification ||
      "UNKNOWN_COLLECTION";
  }))].sort();
}

function buildReferenceFinding({
  code,
  severity,
  source,
  reference,
  policyReason,
  targetTypedKeys = reference.candidateTypedKeys,
}) {
  const normalizedTargetTypedKeys = [...new Set(targetTypedKeys)].sort();
  const finding = {
    code,
    severity,
    sourceTypedKey: source.typedDocumentKey,
    targetTypedKeys: normalizedTargetTypedKeys,
    sourceClassification: source.classification,
    sourceDisposition: source.disposition,
    targetCollectionClassification:
      referenceTargetClassifications(reference),
    family: reference.family || null,
    field: reference.field,
    policyReason,
    ...(reference.expectedShape ?
      {expectedShape: reference.expectedShape} :
      {}),
    ...(reference.shapeEvidence ?
      {shapeEvidence: reference.shapeEvidence} :
      {}),
    ...(reference.creditSourceEvidence ?
      {creditSourceEvidence: reference.creditSourceEvidence} :
      {}),
    ...(reference.aliasEvidence ?
      {aliasEvidence: reference.aliasEvidence} :
      {}),
    ...(reference.resolvedValue !== undefined ?
      {resolvedValue: reference.resolvedValue} :
      {}),
    ...(reference.conflict !== undefined ?
      {conflict: reference.conflict} :
      {}),
  };
  return buildPublishedFindingRecord(finding);
}

function isPreservedMembershipStudentPointer(source, reference) {
  return source.collection === "academyMemberships" &&
    source.membershipProfileDecision?.decision ===
      "preserve_staff_membership" &&
    reference.family === "student";
}

export function classifyReferenceFinding({
  source,
  reference,
  targets,
  academy,
}) {
  if (source.disposition === "unknown") {
    return buildReferenceFinding({
      code: "unknown_reference_source_scope",
      severity: "blocking",
      source,
      reference,
      policyReason: "Reference source academy scope is unresolved.",
    });
  }
  if (reference.invalidIdentifier) {
    return buildReferenceFinding({
      code: "invalid_reference_identifier",
      severity: "blocking",
      source,
      reference,
      policyReason: "Document IDs cannot contain a slash.",
    });
  }
  const targetClassifications = referenceTargetClassifications(reference);
  if (targetClassifications.includes("UNKNOWN_COLLECTION")) {
    return buildReferenceFinding({
      code: "unknown_reference_target_collection",
      severity: "blocking",
      source,
      reference,
      policyReason: "Reference target collection is outside the registry.",
    });
  }
  if (targets.length === 0) {
    const resetInternal =
      source.disposition === "reset" &&
      source.scopeAcademyId === academy &&
      targetClassifications.length > 0 &&
      targetClassifications.every((classification) =>
        classification === RESET_CLASS,
      );
    const resetSourceMissingPreservedTarget =
      source.disposition === "reset" &&
      source.scopeAcademyId === academy &&
      reference.conflict !== true &&
      targetClassifications.length > 0 &&
      targetClassifications.every((classification) =>
        classification === PRESERVE_CLASS,
      );
    if (isPreservedMembershipStudentPointer(source, reference)) {
      return buildReferenceFinding({
        code: "preserved_membership_pointer_cleanup_required",
        severity: "blocking",
        source,
        reference,
        policyReason:
          "Preserved staff membership keeps a student pointer that " +
          "requires separately approved cleanup.",
      });
    }
    return buildReferenceFinding({
      code: resetInternal ?
        "missing_reset_internal_reference" :
        resetSourceMissingPreservedTarget ?
          "missing_reset_source_preserved_target_reference" :
          "missing_reference",
      severity: resetInternal || resetSourceMissingPreservedTarget ?
        "diagnostic_only" :
        "blocking",
      source,
      reference,
      policyReason: resetInternal ?
        "Missing target is confined to the target academy reset domain." :
        resetSourceMissingPreservedTarget ?
          "Reset source will be removed, the preserved target does not " +
          "exist in any scanned academy scope, and no target update is " +
          "required." :
          "Missing target scope or preservation impact cannot be proven safe.",
    });
  }
  if (targets.length > 1) {
    return buildReferenceFinding({
      code: "ambiguous_reference",
      severity: "blocking",
      source,
      reference,
      policyReason: "Multiple typed target documents exist.",
    });
  }
  const target = targets[0];
  if (target.disposition === "unknown") {
    return buildReferenceFinding({
      code: "unknown_reference_target_scope",
      severity: "blocking",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason: "Reference target academy scope is unresolved.",
    });
  }
  const sourceIsTarget = source.scopeAcademyId === academy;
  const targetIsTarget = target.scopeAcademyId === academy;
  if (source.scopeAcademyId &&
      target.scopeAcademyId &&
      sourceIsTarget !== targetIsTarget) {
    return buildReferenceFinding({
      code: "cross_academy_reference",
      severity: "blocking",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason: "Reference crosses the target academy boundary.",
    });
  }
  if (isPreservedMembershipStudentPointer(source, reference)) {
    return buildReferenceFinding({
      code: "preserved_membership_pointer_cleanup_required",
      severity: "blocking",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason:
        "Preserved staff membership keeps a student pointer that " +
        "requires separately approved cleanup.",
    });
  }
  if (isPreservedDisposition(source.disposition) &&
      target.disposition === "reset") {
    return buildReferenceFinding({
      code: "preserved_document_references_reset_candidate",
      severity: "blocking",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason:
        "Preserved, retained, or global source would keep a stale pointer.",
    });
  }
  if (source.disposition === "reset" &&
      isPreservedDisposition(target.disposition)) {
    return buildReferenceFinding({
      code: "reset_candidate_references_preserved_document",
      severity: "warning",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason:
        "Deleting the source does not require updating the preserved target.",
    });
  }
  if (source.disposition === "reset" &&
      target.disposition === "reset" &&
      source.scopeAcademyId === academy &&
      target.scopeAcademyId === academy) {
    return buildReferenceFinding({
      code: "reset_internal_reference",
      severity: "warning",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason:
        "Both documents are target-academy reset candidates.",
    });
  }
  return null;
}

function teacherIdentityIndexes(records) {
  const byKey = new Map();
  const byUid = new Map();
  const add = (index, value, record) => {
    if (!value) return;
    if (!index.has(value)) index.set(value, []);
    index.get(value).push(record);
  };
  records
      .filter(({collection}) => collection === "teachers")
      .forEach((record) => {
        const evidence = record.teacherIdentityEvidence || {};
        const key = evidence.teacherKey;
        const uid = evidence.authUid;
        if (key && !key.conflict && !key.malformed) {
          add(byKey, key.resolvedValue, record);
        }
        if (uid && !uid.conflict && !uid.malformed) {
          add(byUid, uid.resolvedValue, record);
        }
      });
  return {byKey, byUid};
}

function resolveSemanticReference(reference, teacherIndexes) {
  if (reference.lookup === "unresolved_teacher_alias") {
    return {
      ...reference,
      candidateTypedKeys: [],
    };
  }
  if (!["teacher_key", "teacher_uid"].includes(reference.lookup)) {
    return reference;
  }
  const index = reference.lookup === "teacher_key" ?
    teacherIndexes.byKey :
    teacherIndexes.byUid;
  const matches = index.get(reference.documentId) || [];
  return {
    ...reference,
    candidateTypedKeys: matches.map(({typedDocumentKey: key}) => key).sort(),
  };
}

function referenceEvidence(records, academy) {
  const byTypedKey = new Map(
      records.map((record) => [record.typedDocumentKey, record]),
  );
  const teacherIndexes = teacherIdentityIndexes(records);
  const findings = {
    diagnostics: [],
    warnings: [],
    blockers: [],
  };
  const addFinding = (finding) => {
    if (!finding) return;
    if (finding.severity === "diagnostic_only") {
      findings.diagnostics.push(finding);
    } else if (finding.severity === "warning") {
      findings.warnings.push(finding);
    } else {
      findings.blockers.push(finding);
    }
  };
  for (const source of records) {
    const resolvedTeacherTargets = new Set();
    for (const issue of source.referenceIssues) {
      const reference = {
        family: issue.family || null,
        field: issue.field,
        candidateTypedKeys: issue.candidateTypedKeys ||
          issue.targetCollections.map((collectionName) =>
            typedDocumentKey(collectionName, "<malformed>"),
          ),
        aliasEvidence: issue.aliasEvidence,
        resolvedValue: issue.resolvedValue,
        conflict: issue.conflict,
        expectedShape: issue.expectedShape,
        shapeEvidence: issue.shapeEvidence,
        creditSourceEvidence: issue.creditSourceEvidence,
      };
      addFinding(buildReferenceFinding({
        code: issue.code,
        severity: "blocking",
        source,
        reference,
        policyReason: issue.policyReason,
      }));
    }
    for (const reference of source.references) {
      const resolvedReference =
        resolveSemanticReference(reference, teacherIndexes);
      const targets = resolvedReference.candidateTypedKeys
          .map((key) => byTypedKey.get(key))
          .filter(Boolean);
      const strictTeacherIdentitySource =
        ["academyMemberships", "accountProvisioningLogs"].includes(
            source.collection,
        ) &&
        [
          "teacher_identity_id",
          "teacher_identity_key",
          "teacher_identity_uid",
          "provisioning_legacy_teacher",
        ].includes(
            resolvedReference.family,
        );
      if (strictTeacherIdentitySource && targets.length === 0) {
        addFinding(buildReferenceFinding({
          code: resolvedReference.family === "provisioning_legacy_teacher" ?
            "unresolved_provisioning_identity" :
            "unresolved_teacher_identity",
          severity: "blocking",
          source,
          reference: resolvedReference,
          policyReason:
            "Persisted teacher identity does not resolve to an existing " +
            "teacher document.",
        }));
        continue;
      }
      if (["teacher_key", "teacher_uid"].includes(
          resolvedReference.lookup,
      ) &&
          targets.length > 1) {
        addFinding(buildReferenceFinding({
          code: "ambiguous_teacher_identity_lookup",
          severity: "blocking",
          source,
          reference: resolvedReference,
          policyReason:
            "Teacher key resolves to multiple teacher documents.",
        }));
        continue;
      }
      if (strictTeacherIdentitySource && targets.length === 1) {
        resolvedTeacherTargets.add(targets[0].typedDocumentKey);
      }
      addFinding(classifyReferenceFinding({
        source,
        reference: resolvedReference,
        targets,
        academy,
      }));
    }
    const authUid = source.teacherIdentityEvidence?.authUid;
    if (authUid && authUid.resolvedValue &&
        !authUid.conflict && !authUid.malformed) {
      (teacherIndexes.byUid.get(authUid.resolvedValue) || [])
          .forEach(({typedDocumentKey: key}) =>
            resolvedTeacherTargets.add(key),
          );
    }
    if (resolvedTeacherTargets.size > 1) {
      const targetTypedKeys = [...resolvedTeacherTargets].sort();
      addFinding(buildReferenceFinding({
        code: "conflicting_teacher_identity_targets",
        severity: "blocking",
        source,
        reference: {
          family: "teacher_identity_semantic",
          field: "authUid/teacherId/teacherKey",
          targetCollections: ["teachers"],
          candidateTypedKeys: targetTypedKeys,
          aliasEvidence: teacherIdentityAliasEvidence(
              source.teacherIdentityEvidence || {},
          ),
          conflict: true,
        },
        targetTypedKeys,
        policyReason:
          "Teacher identity families resolve to different existing " +
          "teacher documents.",
      }));
    }
    if (source.collection === "creditTransactions") {
      const sourceReference = source.references.find((reference) =>
        reference.family === "credit_source" &&
        reference.candidateTypedKeys.some((key) =>
          key.startsWith("privateLessonReservations:"),
        ),
      );
      const explicitLessonReferences = source.references.filter(
          ({family}) => family === "credit_explicit_lesson",
      );
      const reservation = sourceReference ?
        sourceReference.candidateTypedKeys
            .map((key) => byTypedKey.get(key))
            .find(Boolean) :
        null;
      const reservationLessonKeys = new Set(
          (reservation?.references || [])
              .filter(({family}) => family === "lesson")
              .flatMap(({candidateTypedKeys}) => candidateTypedKeys),
      );
      for (const explicitReference of explicitLessonReferences) {
        if (reservationLessonKeys.size > 0 &&
            !explicitReference.candidateTypedKeys.some((key) =>
              reservationLessonKeys.has(key),
            )) {
          addFinding(buildReferenceFinding({
            code: "conflicting_credit_occurrence_reference",
            severity: "blocking",
            source,
            reference: explicitReference,
            policyReason:
              "Credit explicit lesson conflicts with its source reservation.",
          }));
        }
      }
    }
  }
  return Object.fromEntries(
      Object.entries(findings).map(([category, categoryFindings]) => {
        const unique = new Map();
        categoryFindings.forEach((finding) => {
          if (!unique.has(finding.findingIdentityDigest)) {
            unique.set(finding.findingIdentityDigest, finding);
          }
        });
        return [
          category,
          [...unique.values()].sort((a, b) =>
            a.findingDigest.localeCompare(b.findingDigest),
          ),
        ];
      }),
  );
}

function runCollectionSummary(records, pageCount) {
  const counts = summarizeCollectionRecords(records);
  return {
    ...counts,
    pageCount,
    complete: true,
    truncated: false,
    omitted: 0,
    digest: digest(records.map((record) => ({
      typedDocumentKey: record.typedDocumentKey,
      documentDigest: record.documentDigest,
      disposition: record.disposition,
      references: record.references,
      referenceIssues: record.referenceIssues,
      warnings: record.warnings,
    }))),
  };
}

export async function scanPlannerInventoryOnce({
  db,
  academy,
  pageSize,
  resetProfile = "",
}) {
  await loadRuntimeRegistryModule();
  assertResetRegistry();
  const startRootCollectionSet = await discoverRootCollectionSet(db);
  const runtimeCollections = startRootCollectionSet.names;
  const knownNames = new Set(
      ACADEMY_SCOPED_RESET_REGISTRY.map(({collectionName}) =>
        collectionName,
      ),
  );
  const unknownRuntimeCollections = runtimeCollections.filter(
      (name) => !knownNames.has(name),
  );
  const records = [];
  const collectionSummaries = {};

  for (const registryEntry of ACADEMY_SCOPED_RESET_REGISTRY) {
    const collectionName = registryEntry.collectionName;
    const result = await scanCollectionPages({
      db,
      collectionName,
      pageSize,
      buildRecord: ({documentId, data}) => documentRecord({
        collectionName,
        documentId,
        data,
        registryEntry,
        academy,
        resetProfile,
      }),
    });
    records.push(...result.records);
    collectionSummaries[collectionName] = runCollectionSummary(
        result.records,
        result.pageCount,
    );
  }

  const unknownCollectionSummaries = {};
  for (const collectionName of unknownRuntimeCollections) {
    const result = await scanCollectionPages({
      db,
      collectionName,
      pageSize,
      buildRecord: ({documentId, data}) => unknownDocumentRecord({
        collectionName,
        documentId,
        data,
        academy,
      }),
    });
    records.push(...result.records);
    unknownCollectionSummaries[collectionName] = runCollectionSummary(
        result.records,
        result.pageCount,
    );
  }
  const endRootCollectionSet = await discoverRootCollectionSet(db);
  const rootCollectionSetStable = rootCollectionSetsMatch(
      startRootCollectionSet,
      endRootCollectionSet,
  );

  records.sort((a, b) =>
    a.typedDocumentKey.localeCompare(b.typedDocumentKey),
  );
  const referenceFindings = referenceEvidence(records, academy);
  const malformedScopeBlockers = records
      .filter((record) => record.disposition === "unknown")
      .map((record) => {
        const code = record.warnings[0] || "unknown_document";
        return {
          code,
          severity: "blocking",
          sourceTypedKey: record.typedDocumentKey,
          policyReason: code === "academy_scope_unresolved" ?
            "Document academy scope is unresolved." :
            "Membership profile evidence is invalid or ambiguous.",
        };
      })
      .filter(({code, sourceTypedKey}) =>
        !referenceFindings.blockers.some((finding) =>
          finding.code === code &&
          finding.sourceTypedKey === sourceTypedKey,
        ),
      );
  const unknownCollectionBlockers = unknownRuntimeCollections.map(
      (collectionName) => ({
        code: "unknown_runtime_collection",
        severity: "blocking",
        collectionName,
        policyReason: "Runtime collection is outside the strict registry.",
      }),
  );
  const blockers = [
    ...malformedScopeBlockers,
    ...unknownCollectionBlockers,
    ...referenceFindings.blockers,
  ].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const runIdentity = {
    firestoreValueCanonicalizationVersion:
      FIRESTORE_VALUE_CANONICALIZATION_VERSION,
    startRootCollectionCount: startRootCollectionSet.count,
    startRootCollectionSetDigestVersion:
      startRootCollectionSet.digestVersion,
    startRootCollectionSetDigest: startRootCollectionSet.setDigest,
    endRootCollectionCount: endRootCollectionSet.count,
    endRootCollectionSetDigestVersion: endRootCollectionSet.digestVersion,
    endRootCollectionSetDigest: endRootCollectionSet.setDigest,
    rootCollectionSetStable,
    runtimeCollections,
    unknownRuntimeCollections,
    collectionSummaries,
    unknownCollectionSummaries,
    resetCandidateKeys: records
        .filter(({disposition}) => disposition === "reset")
        .map(({typedDocumentKey: key}) => key),
    preservedKeys: records
        .filter(({disposition}) => isPreservedDisposition(disposition))
        .map(({typedDocumentKey: key}) => key),
    unknownKeys: records
        .filter(({disposition}) => disposition === "unknown")
        .map(({typedDocumentKey: key}) => key),
    referenceDiagnosticDigests: referenceFindings.diagnostics.map(
        ({findingDigest}) => findingDigest,
    ),
    referenceWarningDigests: referenceFindings.warnings.map(
        ({findingDigest}) => findingDigest,
    ),
    referenceBlockerDigests: referenceFindings.blockers.map(
        ({findingDigest}) => findingDigest,
    ),
    blockerDigest: digest(blockers),
  };
  return {
    firestoreValueCanonicalizationVersion:
      FIRESTORE_VALUE_CANONICALIZATION_VERSION,
    complete: rootCollectionSetStable,
    truncated: false,
    omitted: 0,
    startRootCollections: startRootCollectionSet.names,
    startRootCollectionCount: startRootCollectionSet.count,
    startRootCollectionSetDigestVersion:
      startRootCollectionSet.digestVersion,
    startRootCollectionSetDigest: startRootCollectionSet.setDigest,
    endRootCollections: endRootCollectionSet.names,
    endRootCollectionCount: endRootCollectionSet.count,
    endRootCollectionSetDigestVersion: endRootCollectionSet.digestVersion,
    endRootCollectionSetDigest: endRootCollectionSet.setDigest,
    rootCollectionSetStable,
    runtimeCollections,
    unknownRuntimeCollections,
    collectionSummaries,
    unknownCollectionSummaries,
    records,
    referenceFindings,
    blockers,
    runDigest: digest(runIdentity),
  };
}

function buildCollectionDiscoveryContract({
  firstRun,
  secondRun,
  finalRootCollectionSet,
}) {
  const finalMatchesRun1 =
    finalRootCollectionSet.count === firstRun.endRootCollectionCount &&
    finalRootCollectionSet.digestVersion ===
      firstRun.endRootCollectionSetDigestVersion &&
    finalRootCollectionSet.setDigest ===
      firstRun.endRootCollectionSetDigest &&
    stableStringify(finalRootCollectionSet.names) ===
      stableStringify(firstRun.endRootCollections);
  const finalMatchesRun2 =
    finalRootCollectionSet.count === secondRun.endRootCollectionCount &&
    finalRootCollectionSet.digestVersion ===
      secondRun.endRootCollectionSetDigestVersion &&
    finalRootCollectionSet.setDigest ===
      secondRun.endRootCollectionSetDigest &&
    stableStringify(finalRootCollectionSet.names) ===
      stableStringify(secondRun.endRootCollections);
  return Object.freeze({
    collectionDiscoveryContractVersion:
      COLLECTION_DISCOVERY_CONTRACT_VERSION,
    rootCollectionSetDigestVersion: ROOT_COLLECTION_SET_DIGEST_VERSION,
    run1: Object.freeze({
      startRootCollectionCount: firstRun.startRootCollectionCount,
      startRootCollectionSetDigest: firstRun.startRootCollectionSetDigest,
      endRootCollectionCount: firstRun.endRootCollectionCount,
      endRootCollectionSetDigest: firstRun.endRootCollectionSetDigest,
      rootCollectionSetStable: firstRun.rootCollectionSetStable,
    }),
    run2: Object.freeze({
      startRootCollectionCount: secondRun.startRootCollectionCount,
      startRootCollectionSetDigest: secondRun.startRootCollectionSetDigest,
      endRootCollectionCount: secondRun.endRootCollectionCount,
      endRootCollectionSetDigest: secondRun.endRootCollectionSetDigest,
      rootCollectionSetStable: secondRun.rootCollectionSetStable,
    }),
    finalRootCollectionCount: finalRootCollectionSet.count,
    finalRootCollectionSetDigest: finalRootCollectionSet.setDigest,
    finalMatchesRun1,
    finalMatchesRun2,
  });
}

function assertCollectionDiscoveryContract(contract) {
  if (!contract || typeof contract !== "object" ||
      Array.isArray(contract) ||
      contract.collectionDiscoveryContractVersion !==
        COLLECTION_DISCOVERY_CONTRACT_VERSION ||
      contract.rootCollectionSetDigestVersion !==
        ROOT_COLLECTION_SET_DIGEST_VERSION ||
      !Number.isInteger(contract.finalRootCollectionCount) ||
      contract.finalRootCollectionCount < 0 ||
      !/^[0-9a-f]{64}$/.test(
          contract.finalRootCollectionSetDigest || "",
      ) ||
      typeof contract.finalMatchesRun1 !== "boolean" ||
      typeof contract.finalMatchesRun2 !== "boolean") {
    throw new PlannerConfigError(
        "Collection discovery publication contract is malformed.",
    );
  }
  for (const run of [contract.run1, contract.run2]) {
    if (!run || typeof run !== "object" || Array.isArray(run) ||
        !Number.isInteger(run.startRootCollectionCount) ||
        run.startRootCollectionCount < 0 ||
        !Number.isInteger(run.endRootCollectionCount) ||
        run.endRootCollectionCount < 0 ||
        !/^[0-9a-f]{64}$/.test(
            run.startRootCollectionSetDigest || "",
        ) ||
        !/^[0-9a-f]{64}$/.test(
            run.endRootCollectionSetDigest || "",
        ) ||
        typeof run.rootCollectionSetStable !== "boolean") {
      throw new PlannerConfigError(
          "Collection discovery run contract is malformed.",
      );
    }
    const metadataMatches =
      run.startRootCollectionCount === run.endRootCollectionCount &&
      run.startRootCollectionSetDigest === run.endRootCollectionSetDigest;
    if (run.rootCollectionSetStable !== metadataMatches) {
      throw new PlannerConfigError(
          "Collection discovery run stability contract is stale.",
      );
    }
  }
  const finalMatchesRun1 =
    contract.finalRootCollectionCount ===
      contract.run1.endRootCollectionCount &&
    contract.finalRootCollectionSetDigest ===
      contract.run1.endRootCollectionSetDigest;
  const finalMatchesRun2 =
    contract.finalRootCollectionCount ===
      contract.run2.endRootCollectionCount &&
    contract.finalRootCollectionSetDigest ===
      contract.run2.endRootCollectionSetDigest;
  if (contract.finalMatchesRun1 !== finalMatchesRun1 ||
      contract.finalMatchesRun2 !== finalMatchesRun2) {
    throw new PlannerConfigError(
        "Final collection discovery contract is stale.",
    );
  }
  return contract;
}

function publicationStateFields(value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      typeof value.complete !== "boolean" ||
      typeof value.consistency !== "boolean" ||
      typeof value.truncated !== "boolean" ||
      !Number.isInteger(value.omitted) ||
      value.omitted < 0 ||
      !Number.isInteger(value.exitCode) ||
      ![0, 2, 3].includes(value.exitCode) ||
      !Number.isInteger(value.completedRuns) ||
      value.completedRuns < 0 ||
      typeof value.run1RootCollectionSetStable !== "boolean" ||
      typeof value.run2RootCollectionSetStable !== "boolean" ||
      typeof value.finalMatchesRun1 !== "boolean" ||
      typeof value.finalMatchesRun2 !== "boolean") {
    throw new PlannerConfigError(
        "Planner publication state fields are malformed.",
    );
  }
  const verdict = requirePublicationString(
      value.verdict,
      "Planner publication verdict",
  );
  if (!["complete", "blocked", "incomplete"].includes(verdict)) {
    throw new PlannerConfigError(
        "Planner publication verdict is invalid.",
    );
  }
  return {
    complete: value.complete,
    verdict,
    exitCode: value.exitCode,
    completedRuns: value.completedRuns,
    consistency: value.consistency,
    truncated: value.truncated,
    omitted: value.omitted,
    run1RootCollectionSetStable:
      value.run1RootCollectionSetStable,
    run2RootCollectionSetStable:
      value.run2RootCollectionSetStable,
    finalMatchesRun1: value.finalMatchesRun1,
    finalMatchesRun2: value.finalMatchesRun2,
  };
}

export function createCanonicalPublicationStateContract(state) {
  return Object.freeze({
    publicationStateContractVersion:
      PUBLICATION_STATE_CONTRACT_VERSION,
    ...publicationStateFields(state),
  });
}

export function readPublicationStateContract(
    value,
    {requireSupportedVersion = true} = {},
) {
  if (!Number.isSafeInteger(value?.publicationStateContractVersion) ||
      (requireSupportedVersion &&
       value.publicationStateContractVersion !==
        PUBLICATION_STATE_CONTRACT_VERSION)) {
    throw new PlannerConfigError(
        "Planner publication state contract version is unsupported.",
    );
  }
  return Object.freeze({
    publicationStateContractVersion:
      value.publicationStateContractVersion,
    ...publicationStateFields(value),
  });
}

function assertPublicationStateSemantics(publicationStateContract) {
  const state = readPublicationStateContract(
      publicationStateContract,
  );
  const expectedState = {
    0: {complete: true, consistency: true, verdict: "complete"},
    2: {complete: true, consistency: true, verdict: "blocked"},
    3: {complete: false, consistency: false, verdict: "incomplete"},
  }[state.exitCode];
  if (state.completedRuns !== 2 ||
      state.complete !== expectedState.complete ||
      state.consistency !== expectedState.consistency ||
      state.verdict !== expectedState.verdict ||
      (state.complete &&
       (state.truncated ||
        state.omitted !== 0 ||
        !state.run1RootCollectionSetStable ||
        !state.run2RootCollectionSetStable ||
        !state.finalMatchesRun1 ||
        !state.finalMatchesRun2))) {
    throw new PlannerConfigError(
        "Planner publication state is internally inconsistent.",
    );
  }
  return state;
}

function assertPublishableCanonicalState(publicationStateContract) {
  const state = assertPublicationStateSemantics(
      publicationStateContract,
  );
  if (state.complete !== true ||
      ![0, 2].includes(state.exitCode) ||
      state.consistency !== true ||
      state.truncated !== false ||
      state.omitted !== 0 ||
      state.run1RootCollectionSetStable !== true ||
      state.run2RootCollectionSetStable !== true ||
      state.finalMatchesRun1 !== true ||
      state.finalMatchesRun2 !== true) {
    throw new PlannerIncompleteError(
        "Only a complete and consistent plan pair can be published.",
    );
  }
  return state;
}

function aggregateCounts(collectionSummaries) {
  return Object.values(collectionSummaries).reduce(
      (totals, counts) => {
        Object.keys(totals).forEach((key) => {
          totals[key] += counts[key];
        });
        return totals;
      },
      emptyCollectionCounts(),
  );
}

function warningCount(warnings, code) {
  return warnings.filter((warning) => warning.code === code).length;
}

function redactedCollectionSummaries(collectionSummaries) {
  return Object.fromEntries(
      Object.entries(collectionSummaries).map(([name, summary]) => [
        name,
        {
          scanned: summary.scanned,
          reset: summary.reset,
          preserved: summary.preserved,
          retained: summary.retained,
          unknown: summary.unknown,
          pageCount: summary.pageCount,
          complete: summary.complete,
          truncated: summary.truncated,
          omitted: summary.omitted,
          digest: summary.digest,
        },
      ]),
  );
}

function sourceCollectionFromTypedKey(typedKey) {
  const separator = String(typedKey || "").indexOf(":");
  return separator === -1 ? "unknown" : typedKey.slice(0, separator);
}

function allReferenceFindings(run) {
  return [
    ...run.referenceFindings.diagnostics,
    ...run.referenceFindings.warnings,
    ...run.referenceFindings.blockers,
  ];
}

function malformedReferenceShapeSummaries(run) {
  const patterns = new Map();
  allReferenceFindings(run)
      .filter(({code}) => code === "malformed_reference_element" ||
        code === "malformed_reference_field")
      .forEach((finding) => {
        const item = {
          collection: sourceCollectionFromTypedKey(finding.sourceTypedKey),
          field: finding.field,
          expectedShape: finding.expectedShape || "unknown",
          actualShape: finding.shapeEvidence?.actualShape || "other",
        };
        const key = stableStringify(item);
        patterns.set(key, {
          ...item,
          count: (patterns.get(key)?.count || 0) + 1,
        });
      });
  return [...patterns.values()].sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)),
  );
}

function membershipProfileSummary(records) {
  const decisions = records
      .filter(({collection}) => collection === "academyMemberships")
      .map(({membershipProfileDecision}) => membershipProfileDecision)
      .filter(Boolean);
  return {
    preservedStaffMembershipCount: decisions.filter(({decision}) =>
      decision === "preserve_staff_membership").length,
    resetTestMembershipCount: decisions.filter(({decision}) =>
      decision === "reset_test_membership").length,
    ambiguousMembershipCount: decisions.filter(({decision}) =>
      decision === "ambiguous_membership").length,
    preservedMembershipPointerCleanupCount: decisions.filter(
        ({preservedPointerCleanupRequired}) =>
          preservedPointerCleanupRequired === true,
    ).length,
  };
}

function unknownCreditSourceEvidenceSummary(run) {
  const recordByKey = new Map(
      run.records.map((record) => [record.typedDocumentKey, record]),
  );
  const patterns = new Map();
  run.referenceFindings.blockers
      .filter(({code}) => code === "unknown_credit_source_type")
      .forEach((finding) => {
        const record = recordByKey.get(finding.sourceTypedKey);
        const evidence = finding.creditSourceEvidence ||
          record?.creditSourceEvidence;
        const item = {
          sourceTypePresent: evidence?.sourceTypePresent === true,
          sourceTypeKnown: evidence?.sourceTypeKnown === true,
          sourceTypeCategory:
            evidence?.sourceTypeCategory || "unknown",
          actualShape: evidence?.actualShape || "other",
          lengthBucket: evidence?.lengthBucket || null,
          sourceIdPresent: evidence?.sourceIdPresent === true,
          explicitLessonIdPresent:
            evidence?.explicitLessonIdPresent === true,
          explicitReservationIdPresent:
            evidence?.explicitReservationIdPresent === true,
          explicitSlotIdPresent:
            evidence?.explicitSlotIdPresent === true,
          creditDocumentDisposition: record?.disposition || "unknown",
          academyScopeResult: record?.scope || "unknown",
        };
        const key = stableStringify(item);
        patterns.set(key, {
          ...item,
          count: (patterns.get(key)?.count || 0) + 1,
        });
      });
  return [...patterns.values()].sort((left, right) =>
    stableStringify(left).localeCompare(stableStringify(right)),
  );
}

function createCanonicalPlanVersionContract() {
  return RESET_PLAN_VERSION;
}

export function readActualPlanVersion(value, label = "Planner output") {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !Number.isSafeInteger(value.planVersion) ||
      value.planVersion !== RESET_PLAN_VERSION) {
    throw new PlannerConfigError(
        `${label} plan version is malformed or unsupported.`,
    );
  }
  return value.planVersion;
}

function buildCanonicalPublicationContract({
  project,
  academy,
  releaseSha,
  runtimeSourceIdentity,
  run,
  consistency,
  planDigest,
  outputPolicy,
  publicationSetContract,
  recordSetContract,
  runtimeSourceContract,
  collectionDiscoveryContract,
  publicationStateContract,
}) {
  const totals = aggregateCounts(run.collectionSummaries);
  const referenceDiagnosticCount =
    run.referenceFindings.diagnostics.length;
  const referenceWarningCount =
    run.referenceFindings.warnings.length;
  const referenceBlockerCount =
    run.referenceFindings.blockers.length;
  return Object.freeze({
    planVersion: createCanonicalPlanVersionContract(),
    releaseSha,
    runtimeHeadSha: runtimeSourceIdentity.runtimeHeadSha,
    runtimeTreeSha: runtimeSourceIdentity.runtimeTreeSha,
    criticalRuntimeSources: runtimeSourceIdentity.criticalRuntimeSources,
    project,
    academy,
    policy: outputPolicy,
    publicationSetContract,
    recordSetContract,
    runtimeSourceContract,
    collectionDiscoveryContract,
    publicationStateContract,
    completedRuns: publicationStateContract.completedRuns,
    consistency: publicationStateContract.consistency,
    registry: {
      total: ACADEMY_SCOPED_RESET_REGISTRY.length,
      resetAll: RESET_REGISTRY_COUNTS[RESET_CLASS],
      preserve: RESET_REGISTRY_COUNTS[PRESERVE_CLASS],
      retain: RESET_REGISTRY_COUNTS[RETAIN_CLASS],
      global: RESET_REGISTRY_COUNTS[GLOBAL_CLASS],
    },
    collections: redactedCollectionSummaries(run.collectionSummaries),
    counts: {
      scanned: totals.scanned,
      resetCandidates: totals.reset,
      preserved: totals.preserved,
      retained: totals.retained,
      unknown: totals.unknown,
      blockerCount: run.blockers.length,
      referenceDiagnosticCount,
      referenceWarningCount,
      referenceBlockerCount,
      deduplicatedFindingCount:
        referenceDiagnosticCount +
        referenceWarningCount +
        referenceBlockerCount,
    },
    planned: {
      creates: 0,
      updates: 0,
      deletes: consistency ? totals.reset : 0,
    },
    planDigest,
  });
}

function outputPolicyProjection(output) {
  return Object.fromEntries(
      OUTPUT_POLICY_PARITY_FIELDS.map((field) => [field, output?.[field]]),
  );
}

const PUBLICATION_SET_CONTRACT_FIELDS = Object.freeze([
  "publicationSetContractVersion",
  "candidateCount",
  "candidateSetDigestVersion",
  "candidateSetDigest",
  "findingCount",
  "findingSetDigestVersion",
  "findingSetDigest",
]);
const RECORD_SET_CONTRACT_FIELDS = Object.freeze([
  "recordSetContractVersion",
  "recordCount",
  "recordSetDigestVersion",
  "recordSetDigest",
]);
const RUNTIME_SOURCE_CONTRACT_FIELDS = Object.freeze([
  "runtimeSourceContractVersion",
  "criticalRuntimeSourceCount",
  "criticalRuntimeSourceSetDigestVersion",
  "criticalRuntimeSourceSetDigest",
]);

function publicationSetContractProjection(output) {
  return Object.fromEntries(
      PUBLICATION_SET_CONTRACT_FIELDS.map(
          (field) => [field, output?.[field]],
      ),
  );
}

function recordSetContractProjection(output) {
  return Object.fromEntries(
      RECORD_SET_CONTRACT_FIELDS.map(
          (field) => [field, output?.[field]],
      ),
  );
}

function runtimeSourceContractProjection(output) {
  return Object.fromEntries(
      RUNTIME_SOURCE_CONTRACT_FIELDS.map(
          (field) => [field, output?.[field]],
      ),
  );
}

function summaryPublicationProjection(summary) {
  return {
    planVersion: readActualPlanVersion(summary, "Planner summary"),
    releaseSha: summary.releaseSha,
    runtimeHeadSha: summary.runtimeHeadSha,
    runtimeTreeSha: summary.runtimeTreeSha,
    criticalRuntimeSources:
      canonicalCriticalRuntimeSourceIdentities(
          summary.criticalRuntimeSources,
      ),
    project: summary.project,
    academy: summary.academy,
    policy: outputPolicyProjection(summary),
    publicationSetContract: summary.publicationSetContract,
    recordSetContract: summary.recordSetContract,
    runtimeSourceContract: summary.runtimeSourceContract,
    collectionDiscoveryContract: summary.collectionDiscoveryContract,
    publicationStateContract:
      readPublicationStateContract(summary),
    completedRuns: summary.completedRuns,
    consistency: summary.consistency,
    registry: summary.registry,
    collections: summary.collections,
    counts: {
      scanned: summary.totals?.scanned,
      resetCandidates: summary.totals?.resetCandidates,
      preserved: summary.totals?.preserved,
      retained: summary.totals?.retained,
      unknown: summary.totals?.unknown,
      blockerCount:
        (summary.totals?.unknownBlockers || 0) +
        (summary.totals?.referenceBlockerCount || 0),
      referenceDiagnosticCount:
        summary.totals?.referenceDiagnosticCount,
      referenceWarningCount: summary.totals?.referenceWarningCount,
      referenceBlockerCount: summary.totals?.referenceBlockerCount,
      deduplicatedFindingCount:
        (summary.totals?.referenceDiagnosticCount || 0) +
        (summary.totals?.referenceWarningCount || 0) +
        (summary.totals?.referenceBlockerCount || 0),
    },
    planned: summary.planned,
    planDigest: summary.planDigest,
  };
}

export function recomputeCanonicalPlanPublicationContract(canonicalPlan) {
  return {
    planVersion:
      readActualPlanVersion(canonicalPlan, "Canonical planner snapshot"),
    releaseSha: canonicalPlan.releaseSha,
    runtimeHeadSha: canonicalPlan.runtimeHeadSha,
    runtimeTreeSha: canonicalPlan.runtimeTreeSha,
    criticalRuntimeSources:
      canonicalCriticalRuntimeSourceIdentities(
          canonicalPlan.criticalRuntimeSources,
      ),
    project: canonicalPlan.project,
    academy: canonicalPlan.academy,
    policy: outputPolicyProjection(canonicalPlan),
    publicationSetContract: canonicalPlan.publicationSetContract,
    recordSetContract: canonicalPlan.recordSetContract,
    runtimeSourceContract: canonicalPlan.runtimeSourceContract,
    collectionDiscoveryContract:
      canonicalPlan.collectionDiscoveryContract,
    publicationStateContract:
      readPublicationStateContract(canonicalPlan),
    completedRuns: canonicalPlan.completedRuns,
    consistency: canonicalPlan.consistency,
    registry: canonicalPlan.registryContract,
    collections: canonicalPlan.collectionCounts,
    counts: canonicalPlan.referenceCounts,
    planned: canonicalPlan.plannedMutations,
    planDigest: canonicalPlan.planDigest,
  };
}

export function assertCanonicalPlanIntegrity(canonicalPlan) {
  if (!canonicalPlan || typeof canonicalPlan !== "object" ||
      Array.isArray(canonicalPlan) ||
      !/^[0-9a-f]{64}$/.test(canonicalPlan.planDigest || "")) {
    throw new PlannerConfigError(
        "Immutable canonical plan snapshot is required.",
    );
  }
  readActualPlanVersion(canonicalPlan, "Canonical planner snapshot");
  const recomputedRuntimeSourceContract = buildRuntimeSourceContract(
      canonicalPlan.criticalRuntimeSources,
  );
  const recomputedPublicationSetContract = buildPublicationSetContract({
    candidateInputs: canonicalPlan.candidateInputs,
    referenceFindings: canonicalPlan.referenceFindings,
  });
  const recomputedRecordSetContract =
    buildRecordSetContract(canonicalPlan.recordInputs);
  const collectionDiscoveryContract =
    assertCollectionDiscoveryContract(
        canonicalPlan.collectionDiscoveryContract,
    );
  const publicationStateContract =
    readPublicationStateContract(canonicalPlan);
  assertPublicationStateSemantics(publicationStateContract);
  const executionSafetyContract =
    readExecutionSafetyContract(canonicalPlan);
  const recomputedPolicy = canonicalPlannerPolicy({
    resetProfile: canonicalPlan.resetProfile || "",
    operatorTestDataConfirmation:
      canonicalPlan.operatorTestDataConfirmation,
    fullBackupWaiverConfirmed:
      canonicalPlan.fullBackupWaiverConfirmed,
  });
  const recomputedPlanDigest = buildCanonicalPlanDigest(canonicalPlan);
  const recomputedPublicationContract =
    recomputeCanonicalPlanPublicationContract(canonicalPlan);
  if (stableStringify(recomputedRuntimeSourceContract) !==
      stableStringify(canonicalPlan.runtimeSourceContract)) {
    throw new PlannerConfigError(
        "Canonical plan runtime source contract is stale.",
    );
  }
  if (stableStringify(recomputedPublicationSetContract) !==
      stableStringify(canonicalPlan.publicationSetContract)) {
    throw new PlannerConfigError(
        "Canonical plan candidate or finding contract is stale.",
    );
  }
  if (stableStringify(recomputedRecordSetContract) !==
      stableStringify(canonicalPlan.recordSetContract)) {
    throw new PlannerConfigError(
        "Canonical plan record set contract is stale.",
    );
  }
  const collectionDiscoveryComplete =
    collectionDiscoveryContract.run1.rootCollectionSetStable &&
    collectionDiscoveryContract.run2.rootCollectionSetStable &&
    collectionDiscoveryContract.finalMatchesRun1 &&
    collectionDiscoveryContract.finalMatchesRun2;
  if (canonicalPlan.consistency === true &&
      !collectionDiscoveryComplete) {
    throw new PlannerConfigError(
        "Canonical plan collection discovery contract is incomplete.",
    );
  }
  if (stableStringify(publicationStateContract) !==
      stableStringify(canonicalPlan.publicationStateContract)) {
    throw new PlannerConfigError(
        "Canonical plan publication state contract is stale.",
    );
  }
  if (stableStringify(executionSafetyContract) !==
      stableStringify(canonicalPlan.executionSafetyContract)) {
    throw new PlannerConfigError(
        "Canonical plan execution safety contract is stale.",
    );
  }
  if (stableStringify(recomputedPolicy) !==
      stableStringify(outputPolicyProjection(canonicalPlan))) {
    throw new PlannerConfigError(
        "Canonical plan policy contract is stale.",
    );
  }
  if (recomputedPlanDigest !== canonicalPlan.planDigest) {
    throw new PlannerConfigError(
        "Canonical plan snapshot digest or contract is stale.",
    );
  }
  if (stableStringify(recomputedPublicationContract) !==
      stableStringify(canonicalPlan.publicationContract)) {
    throw new PlannerConfigError(
        "Canonical plan publication contract is stale.",
    );
  }
  if (canonicalPlan.expectedDeleteCount !==
      canonicalPlan.plannedMutations?.deletes ||
      (canonicalPlan.consistency === true &&
       canonicalPlan.expectedDeleteCount !==
        canonicalPlan.publicationSetContract?.candidateCount)) {
    throw new PlannerConfigError(
        "Canonical plan delete count contract is stale.",
    );
  }
  return Object.freeze({
    recomputedPlanDigest,
    runtimeSourceContract: recomputedRuntimeSourceContract,
    publicationSetContract: recomputedPublicationSetContract,
    recordSetContract: recomputedRecordSetContract,
    collectionDiscoveryContract,
    publicationStateContract,
    executionSafetyContract,
    publicationContract: recomputedPublicationContract,
  });
}

function manifestDispositionCounts(records, knownCollections) {
  const counts = {
    resetCandidates: 0,
    preserved: 0,
    retained: 0,
    unknown: 0,
  };
  for (const record of records || []) {
    if (!knownCollections.has(record.collection)) continue;
    if (record.plannerDisposition === "reset") {
      counts.resetCandidates += 1;
    } else if (record.plannerDisposition === "retain") {
      counts.retained += 1;
    } else if (record.plannerDisposition === "unknown") {
      counts.unknown += 1;
    } else {
      counts.preserved += 1;
    }
  }
  return counts;
}

function manifestCollectionCounts(records, collectionNames) {
  const counts = Object.fromEntries(
      collectionNames.map((collection) => [
        collection,
        {
          scanned: 0,
          reset: 0,
          preserved: 0,
          retained: 0,
          unknown: 0,
        },
      ]),
  );
  for (const record of records || []) {
    const collectionCounts = counts[record.collection];
    if (!collectionCounts) continue;
    collectionCounts.scanned += 1;
    if (record.plannerDisposition === "reset") {
      collectionCounts.reset += 1;
    } else if (record.plannerDisposition === "retain") {
      collectionCounts.retained += 1;
    } else if (record.plannerDisposition === "unknown") {
      collectionCounts.unknown += 1;
    } else {
      collectionCounts.preserved += 1;
    }
  }
  return counts;
}

export function assertExactPublicationParity(
    canonicalPlan,
    summary,
    manifest,
) {
  assertTrustedCanonicalPlanSnapshot(canonicalPlan);
  validateExactOutputSchema(
      canonicalPlan,
      CANONICAL_PLAN_SCHEMA,
      "Canonical plan",
  );
  validateExactOutputSchema(
      summary,
      REDACTED_SUMMARY_SCHEMA,
      "Redacted summary",
  );
  if (manifest) {
    validateExactOutputSchema(
        manifest,
        SENSITIVE_MANIFEST_SCHEMA,
        "Sensitive manifest",
    );
  }
  const canonicalIntegrity =
    assertCanonicalPlanIntegrity(canonicalPlan);
  if (!summary?.publicationContract || !manifest?.publicationContract) {
    throw new PlannerConfigError(
        "Planner publication contract is required.",
    );
  }
  const canonicalPlanVersion =
    readActualPlanVersion(canonicalPlan, "Canonical planner snapshot");
  if (readActualPlanVersion(summary, "Planner summary") !==
      canonicalPlanVersion ||
      readActualPlanVersion(manifest, "Sensitive manifest") !==
      canonicalPlanVersion) {
    throw new PlannerConfigError(
        "Planner output plan version parity mismatch.",
    );
  }
  assertOutputPolicyParity(summary, manifest);
  const contract = canonicalIntegrity.publicationContract;
  const publicationSetContract = contract.publicationSetContract;
  const recordSetContract = canonicalIntegrity.recordSetContract;
  const runtimeSourceContract = contract.runtimeSourceContract;
  const collectionDiscoveryContract =
    canonicalIntegrity.collectionDiscoveryContract;
  const canonicalPublicationState =
    canonicalIntegrity.publicationStateContract;
  const summaryPublicationState =
    readPublicationStateContract(summary);
  const manifestPublicationState =
    readPublicationStateContract(manifest);
  if (stableStringify(summaryPublicationState) !==
      stableStringify(canonicalPublicationState) ||
      stableStringify(manifestPublicationState) !==
      stableStringify(canonicalPublicationState) ||
      stableStringify(summary.publicationStateContract) !==
      stableStringify(canonicalPublicationState) ||
      stableStringify(manifest.publicationStateContract) !==
      stableStringify(canonicalPublicationState)) {
    throw new PlannerConfigError(
        "Planner publication state parity mismatch.",
    );
  }
  const canonicalExecutionSafety =
    canonicalIntegrity.executionSafetyContract;
  const summaryExecutionSafety =
    readExecutionSafetyContract(summary);
  const manifestExecutionSafety =
    readExecutionSafetyContract(manifest);
  if (stableStringify(summaryExecutionSafety) !==
      stableStringify(canonicalExecutionSafety) ||
      stableStringify(manifestExecutionSafety) !==
      stableStringify(canonicalExecutionSafety) ||
      stableStringify(summary.executionSafetyContract) !==
      stableStringify(canonicalExecutionSafety) ||
      stableStringify(manifest.executionSafetyContract) !==
      stableStringify(canonicalExecutionSafety)) {
    throw new PlannerConfigError(
        "Planner execution safety parity mismatch.",
    );
  }
  if (!publicationSetContract ||
      stableStringify(publicationSetContractProjection(summary)) !==
        stableStringify(publicationSetContract) ||
      stableStringify(publicationSetContractProjection(manifest)) !==
        stableStringify(publicationSetContract) ||
      stableStringify(summary.publicationSetContract) !==
        stableStringify(publicationSetContract) ||
      stableStringify(manifest.publicationSetContract) !==
        stableStringify(publicationSetContract)) {
    throw new PlannerConfigError(
        "Planner publication set contract parity mismatch.",
    );
  }
  if (!recordSetContract ||
      stableStringify(recordSetContractProjection(summary)) !==
        stableStringify(recordSetContract) ||
      stableStringify(recordSetContractProjection(manifest)) !==
        stableStringify(recordSetContract) ||
      stableStringify(summary.recordSetContract) !==
        stableStringify(recordSetContract) ||
      stableStringify(manifest.recordSetContract) !==
        stableStringify(recordSetContract)) {
    throw new PlannerConfigError(
        "Planner record set contract parity mismatch.",
    );
  }
  if (!runtimeSourceContract ||
      stableStringify(runtimeSourceContractProjection(summary)) !==
        stableStringify(runtimeSourceContract) ||
      stableStringify(runtimeSourceContractProjection(manifest)) !==
        stableStringify(runtimeSourceContract) ||
      stableStringify(summary.runtimeSourceContract) !==
        stableStringify(runtimeSourceContract) ||
      stableStringify(manifest.runtimeSourceContract) !==
        stableStringify(runtimeSourceContract)) {
    throw new PlannerConfigError(
        "Planner runtime source contract parity mismatch.",
    );
  }
  if (stableStringify(summary.collectionDiscoveryContract) !==
      stableStringify(collectionDiscoveryContract) ||
      stableStringify(manifest.collectionDiscoveryContract) !==
      stableStringify(collectionDiscoveryContract)) {
    throw new PlannerConfigError(
        "Planner collection discovery contract parity mismatch.",
    );
  }
  if (stableStringify(contract) !==
      stableStringify(summary.publicationContract) ||
      stableStringify(contract) !==
      stableStringify(manifest.publicationContract) ||
      stableStringify(summaryPublicationProjection(summary)) !==
      stableStringify(contract)) {
    throw new PlannerConfigError(
        "Planner summary/manifest publication parity mismatch.",
    );
  }
  const knownCollections = new Set(Object.keys(contract.collections));
  const dispositionCounts = manifestDispositionCounts(
      manifest.records,
      knownCollections,
  );
  const knownRecordCount = (manifest.records || []).filter((record) =>
    knownCollections.has(record.collection),
  ).length;
  const manifestCountsByCollection = manifestCollectionCounts(
      manifest.records,
      [...knownCollections],
  );
  const contractCountsByCollection = Object.fromEntries(
      Object.entries(contract.collections).map(([collection, counts]) => [
        collection,
        {
          scanned: counts.scanned,
          reset: counts.reset,
          preserved: counts.preserved,
          retained: counts.retained,
          unknown: counts.unknown,
        },
      ]),
  );
  const findingCount = Object.values(manifest.referenceFindings || {})
      .flat().length;
  const recomputedManifestSetContract =
    recomputeManifestPublicationSetContract(manifest);
  const recomputedManifestRecordSetContract =
    recomputeManifestRecordSetContract(manifest);
  const recomputedSummaryRuntimeSourceContract =
    buildRuntimeSourceContract(summary.criticalRuntimeSources);
  const recomputedManifestRuntimeSourceContract =
    buildRuntimeSourceContract(manifest.criticalRuntimeSources);
  const canonicalRecordFindingMapValue =
    canonicalRecordFindingMap(canonicalPlan.referenceFindings);
  const manifestRecordFindingMapValue =
    manifestRecordFindingMap(manifest.records);
  const canonicalRecordFindingMetadata =
    recordFindingSetMetadata(canonicalRecordFindingMapValue);
  const manifestRecordFindingMetadata =
    recordFindingSetMetadata(manifestRecordFindingMapValue);
  const canonicalBlockerSet =
    canonicalBlockerPublishedDigestSetFromBuckets(
        canonicalPlan.referenceFindings,
        "Canonical blocker set",
    );
  const manifestReferenceBlockerSet =
    canonicalBlockerPublishedDigestSetFromBuckets(
        manifest.referenceFindings,
        "Sensitive manifest reference blocker set",
    );
  const manifestBlockerSet = canonicalBlockerPublishedDigestSet(
      manifest.blockers,
      "Sensitive manifest blocker set",
  );
  if (manifest.planVersion !== contract.planVersion ||
      manifest.planDigest !== contract.planDigest ||
      manifest.releaseSha !== contract.releaseSha ||
      manifest.runtimeHeadSha !== contract.runtimeHeadSha ||
      manifest.runtimeTreeSha !== contract.runtimeTreeSha ||
      manifest.project !== contract.project ||
      manifest.academy !== contract.academy ||
      manifest.completedRuns !== contract.completedRuns ||
      manifest.consistency !== contract.consistency ||
      knownRecordCount !== contract.counts.scanned ||
      stableStringify(manifestCountsByCollection) !==
        stableStringify(contractCountsByCollection) ||
      dispositionCounts.resetCandidates !==
        contract.counts.resetCandidates ||
      dispositionCounts.preserved !== contract.counts.preserved ||
      dispositionCounts.retained !== contract.counts.retained ||
      dispositionCounts.unknown !== contract.counts.unknown ||
      findingCount !== contract.counts.deduplicatedFindingCount ||
      manifest.referenceFindingCount !==
        publicationSetContract.findingCount ||
      stableStringify(recomputedManifestSetContract) !==
        stableStringify(publicationSetContract) ||
      stableStringify(recomputedManifestRecordSetContract) !==
        stableStringify(recordSetContract) ||
      stableStringify(recomputedSummaryRuntimeSourceContract) !==
        stableStringify(runtimeSourceContract) ||
      stableStringify(recomputedManifestRuntimeSourceContract) !==
        stableStringify(runtimeSourceContract) ||
      stableStringify(manifestRecordFindingMapValue) !==
        stableStringify(canonicalRecordFindingMapValue) ||
      stableStringify(manifestRecordFindingMetadata) !==
        stableStringify(canonicalRecordFindingMetadata) ||
      manifest.sensitiveRecordFindingCount !==
        canonicalRecordFindingMetadata.recordFindingCount ||
      stableStringify(manifestReferenceBlockerSet) !==
        stableStringify(canonicalBlockerSet) ||
      stableStringify(manifestBlockerSet) !==
        stableStringify(canonicalBlockerSet)) {
    throw new PlannerConfigError(
        "Planner sensitive manifest count or identity parity mismatch.",
    );
  }
}

function buildRedactedSummary({
  project,
  academy,
  releaseSha,
  runtimeSourceIdentity,
  firstRun,
  secondRun,
  consistency,
  planDigest,
  resetProfile,
  operatorTestDataConfirmation,
  fullBackupWaiverConfirmed,
  publicationContract,
  publicationSetContract,
  recordSetContract,
  runtimeSourceContract,
  collectionDiscoveryContract,
  publicationStateContract,
}) {
  const sourceRun = consistency ? secondRun : firstRun;
  const totals = aggregateCounts(sourceRun.collectionSummaries);
  const outputPolicy = canonicalPlannerPolicy({
    resetProfile,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
  });
  const safetyContract = outputPolicy;
  const summary = {
    planVersion: RESET_PLAN_VERSION,
    releaseSha,
    runtimeHeadSha: runtimeSourceIdentity.runtimeHeadSha,
    runtimeTreeSha: runtimeSourceIdentity.runtimeTreeSha,
    criticalRuntimeSources: runtimeSourceIdentity.criticalRuntimeSources,
    project,
    academy,
    mode: "read_only_plan",
    ...outputPolicy,
    publicationStateContract,
    ...publicationStateContract,
    planDigest,
    publicationContract,
    publicationSetContract,
    ...publicationSetContract,
    recordSetContract,
    ...recordSetContract,
    runtimeSourceContract,
    ...runtimeSourceContract,
    collectionDiscoveryContract,
    registry: {
      total: ACADEMY_SCOPED_RESET_REGISTRY.length,
      resetAll: RESET_REGISTRY_COUNTS[RESET_CLASS],
      preserve: RESET_REGISTRY_COUNTS[PRESERVE_CLASS],
      retain: RESET_REGISTRY_COUNTS[RETAIN_CLASS],
      global: RESET_REGISTRY_COUNTS[GLOBAL_CLASS],
    },
    runtimeDiscovery: {
      discoveredCollectionCount: sourceRun.runtimeCollections.length,
      unknownCollectionCount: sourceRun.unknownRuntimeCollections.length,
      ...collectionDiscoveryContract,
    },
    collections: redactedCollectionSummaries(
        sourceRun.collectionSummaries,
    ),
    membershipProfile: membershipProfileSummary(sourceRun.records),
    malformedReferenceShapes:
      malformedReferenceShapeSummaries(sourceRun),
    unknownCreditSourceEvidence:
      unknownCreditSourceEvidenceSummary(sourceRun),
    totals: {
      scanned: totals.scanned,
      resetCandidates: totals.reset,
      preserved: totals.preserved,
      retained: totals.retained,
      unknown: totals.unknown,
      unknownBlockers:
        sourceRun.blockers.length -
        sourceRun.referenceFindings.blockers.length,
      referenceDiagnosticCount:
        sourceRun.referenceFindings.diagnostics.length,
      referenceWarningCount:
        sourceRun.referenceFindings.warnings.length,
      referenceBlockerCount:
        sourceRun.referenceFindings.blockers.length,
      crossAcademyReferences: warningCount(
          sourceRun.referenceFindings.blockers,
          "cross_academy_reference",
      ),
      preservedReferenceWarnings: warningCount(
          sourceRun.referenceFindings.blockers,
          "preserved_document_references_reset_candidate",
      ),
      resetInternalMissingReferences: warningCount(
          sourceRun.referenceFindings.diagnostics,
          "missing_reset_internal_reference",
      ),
      resetSourceMissingPreservedTargetReferences: warningCount(
          sourceRun.referenceFindings.diagnostics,
          "missing_reset_source_preserved_target_reference",
      ),
    },
    planned: {
      creates: 0,
      updates: 0,
      deletes: consistency ? totals.reset : 0,
    },
    backupPreconditions: {
      managedFirestoreExportRequired:
        safetyContract.managedFirestoreExportRequired,
      authInventoryRequired:
        safetyContract.minimumSafetySnapshotsRequired.authUidInventory,
      academyShellSnapshotRequired:
        safetyContract.minimumSafetySnapshotsRequired.academyShellSnapshot,
      membershipsSnapshotRequired:
        safetyContract.minimumSafetySnapshotsRequired
            .preservedStaffMembershipSnapshot,
      teachersSnapshotRequired:
        safetyContract.minimumSafetySnapshotsRequired.teacherMappingSnapshot,
      preResetPlanDigestRequired:
        safetyContract.minimumSafetySnapshotsRequired.finalPlanDigest,
      expectedDeleteCountRequired:
        safetyContract.minimumSafetySnapshotsRequired.expectedDeleteCount,
      postResetZeroStateAuditRequired:
        safetyContract.minimumSafetySnapshotsRequired.postResetZeroStateAudit,
    },
  };
  validateExactOutputSchema(
      summary,
      REDACTED_SUMMARY_SCHEMA,
      "Redacted summary",
  );
  return summary;
}

function buildManifestFindingBySource(referenceFindings) {
  const findingBySource = new Map();
  for (const finding of [
    ...referenceFindings.diagnostics,
    ...referenceFindings.warnings,
    ...referenceFindings.blockers,
  ]) {
    const canonicalFinding =
      canonicalizePublishedFindingRecord(finding);
    const source = canonicalFinding.sourceTypedKey;
    if (!findingBySource.has(source)) findingBySource.set(source, []);
    findingBySource.get(source).push(canonicalFinding);
  }
  return findingBySource;
}

function manifestRecord(record, findingBySource) {
  const serializedRecord = {
    rawDocumentPath: record.rawDocumentPath,
    typedDocumentKey: record.typedDocumentKey,
    collection: record.collection,
    classification: record.classification,
    plannerDisposition: record.disposition,
    deletionOrderGroup: record.deletionOrderGroup,
    academyScopeEvidence: record.academyScopeEvidence,
    documentDigest: record.documentDigest,
    ...(record.membershipProfileDecision ?
      {membershipProfileDecision: record.membershipProfileDecision} :
      {}),
    ...(record.creditSourceEvidence ?
      {creditSourceEvidence: record.creditSourceEvidence} :
      {}),
    ...(record.teacherIdentityEvidence ?
      {teacherIdentityEvidence: record.teacherIdentityEvidence} :
      {}),
    ...(record.profilePolicyReason ?
      {profilePolicyReason: record.profilePolicyReason} :
      {}),
    directReferences: record.references.map((reference) => ({
      family: reference.family,
      field: reference.field,
      candidateTypedKeys: reference.candidateTypedKeys,
      targetCollections: reference.targetCollections,
      lookup: reference.lookup,
      ...(reference.aliasEvidence ?
        {aliasEvidence: reference.aliasEvidence} :
        {}),
      ...(reference.resolvedValue !== undefined ?
        {resolvedValue: reference.resolvedValue} :
        {}),
      ...(reference.conflict !== undefined ?
        {conflict: reference.conflict} :
        {}),
    })),
    referenceFindings:
      findingBySource.get(record.typedDocumentKey) || [],
  };
  assertExactObjectKeys(
      serializedRecord,
      SENSITIVE_MANIFEST_RECORD_KEYS,
      REQUIRED_SENSITIVE_MANIFEST_RECORD_KEYS,
      "Serialized sensitive manifest record",
  );
  return serializedRecord;
}

function buildSensitiveManifest({
  project,
  academy,
  releaseSha,
  runtimeSourceIdentity,
  run,
  planDigest,
  resetProfile,
  operatorTestDataConfirmation,
  fullBackupWaiverConfirmed,
  publicationContract,
  publicationSetContract,
  recordSetContract,
  runtimeSourceContract,
  collectionDiscoveryContract,
  publicationStateContract,
}) {
  const findings = [
    ...run.referenceFindings.diagnostics,
    ...run.referenceFindings.warnings,
    ...run.referenceFindings.blockers,
  ];
  const findingBySource =
    buildManifestFindingBySource(run.referenceFindings);
  const publishedReferenceFindings =
    canonicalizePublishedFindingBuckets(run.referenceFindings);
  const records = run.records.map((record) =>
    manifestRecord(record, findingBySource),
  );
  const sensitiveRecordFindingCount = records.reduce(
      (total, record) => total + record.referenceFindings.length,
      0,
  );
  if (sensitiveRecordFindingCount !== findings.length) {
    throw new PlannerConfigError(
        "Reference finding redacted/sensitive parity mismatch.",
    );
  }
  const outputPolicy = canonicalPlannerPolicy({
    resetProfile,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
  });
  const manifest = {
    planVersion: RESET_PLAN_VERSION,
    releaseSha,
    runtimeHeadSha: runtimeSourceIdentity.runtimeHeadSha,
    runtimeTreeSha: runtimeSourceIdentity.runtimeTreeSha,
    criticalRuntimeSources: runtimeSourceIdentity.criticalRuntimeSources,
    project,
    academy,
    mode: "read_only_plan",
    ...outputPolicy,
    publicationStateContract,
    ...publicationStateContract,
    sensitivity: "LOCAL_ONLY_CONTAINS_RAW_FIRESTORE_PATHS",
    planDigest,
    publicationContract,
    publicationSetContract,
    ...publicationSetContract,
    recordSetContract,
    ...recordSetContract,
    runtimeSourceContract,
    ...runtimeSourceContract,
    collectionDiscoveryContract,
    referenceFindingCount: findings.length,
    sensitiveRecordFindingCount,
    records,
    referenceFindings: publishedReferenceFindings,
    blockers: publishedReferenceFindings.blockers,
  };
  validateExactOutputSchema(
      manifest,
      SENSITIVE_MANIFEST_SCHEMA,
      "Sensitive manifest",
  );
  return manifest;
}

function assertNoProhibitedContent(value, label) {
  const rendered = stableStringify(value);
  if (EMAIL_PATTERN.test(rendered)) {
    throw new PlannerConfigError(`${label} contains an email address.`);
  }
  for (const pattern of PROHIBITED_TEXT_PATTERNS) {
    if (pattern.test(rendered)) {
      throw new PlannerConfigError(
          `${label} contains prohibited credential or token material.`,
      );
    }
  }
}

function assertRedactedSummary(summary) {
  const forbiddenKeys = new Set([
    "documentid",
    "rawdocumentpath",
    "typeddocumentkey",
    "uid",
    "email",
    "name",
    "phone",
    "address",
    "token",
    "authorization",
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) {
        throw new PlannerConfigError(
            `Redacted summary contains forbidden key: ${key}.`,
        );
      }
      visit(nested);
    }
  };
  visit(summary);
  assertNoProhibitedContent(summary, "Redacted summary");
}

export async function buildAcademyScopedResetPlan({
  db,
  project,
  academy,
  releaseSha,
  runtimeSourceIdentity,
  pageSize = DEFAULT_PAGE_SIZE,
  beforeSecondRun = null,
  resetProfile = "",
  operatorTestDataConfirmation = false,
  fullBackupWaiverConfirmed = false,
}) {
  validatePlannerIdentity({project, academy, releaseSha, pageSize});
  validateResetProfileContract({
    academy,
    resetProfile,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
  });
  const validatedRuntimeSourceIdentity =
    validatePlannerRuntimeSourceIdentity({
      identity: runtimeSourceIdentity,
      releaseSha,
    });
  const firstRun = await scanPlannerInventoryOnce({
    db,
    academy,
    pageSize,
    resetProfile,
  });
  if (beforeSecondRun) await beforeSecondRun();
  const secondRun = await scanPlannerInventoryOnce({
    db,
    academy,
    pageSize,
    resetProfile,
  });
  const finalRootCollectionSet = await discoverRootCollectionSet(db);
  const collectionDiscoveryContract = buildCollectionDiscoveryContract({
    firstRun,
    secondRun,
    finalRootCollectionSet,
  });
  assertCollectionDiscoveryContract(collectionDiscoveryContract);
  const consistency =
    firstRun.rootCollectionSetStable &&
    secondRun.rootCollectionSetStable &&
    collectionDiscoveryContract.finalMatchesRun1 &&
    collectionDiscoveryContract.finalMatchesRun2 &&
    firstRun.runDigest === secondRun.runDigest;
  const outputPolicy = canonicalPlannerPolicy({
    resetProfile,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
  });
  const findingDeduplicationResult = {
    firstRun: {
      diagnostics: firstRun.referenceFindings.diagnostics.map(
          ({findingIdentityDigest}) => findingIdentityDigest,
      ),
      warnings: firstRun.referenceFindings.warnings.map(
          ({findingIdentityDigest}) => findingIdentityDigest,
      ),
      blockers: firstRun.referenceFindings.blockers.map(
          ({findingIdentityDigest}) => findingIdentityDigest,
      ),
    },
    secondRun: {
      diagnostics: secondRun.referenceFindings.diagnostics.map(
          ({findingIdentityDigest}) => findingIdentityDigest,
      ),
      warnings: secondRun.referenceFindings.warnings.map(
          ({findingIdentityDigest}) => findingIdentityDigest,
      ),
      blockers: secondRun.referenceFindings.blockers.map(
          ({findingIdentityDigest}) => findingIdentityDigest,
      ),
    },
  };
  const publicationRun = consistency ? secondRun : firstRun;
  const publicationSetContract =
    buildPlannerPublicationSetContract(publicationRun);
  const recordInputs = canonicalRecordInputsFromPlannerRecords(
      publicationRun.records,
      publicationRun.referenceFindings,
  );
  const recordSetContract = buildRecordSetContract(recordInputs);
  const runtimeSourceContract = buildRuntimeSourceContract(
      validatedRuntimeSourceIdentity.criticalRuntimeSources,
  );
  const exitCode = !consistency ? 3 :
    secondRun.blockers.length > 0 ? 2 : 0;
  const publicationStateContract = createCanonicalPublicationStateContract({
    complete: consistency &&
      firstRun.complete &&
      secondRun.complete &&
      collectionDiscoveryContract.finalMatchesRun1 &&
      collectionDiscoveryContract.finalMatchesRun2,
    verdict: exitCode === 3 ?
      "incomplete" :
      exitCode === 2 ? "blocked" : "complete",
    exitCode,
    completedRuns: 2,
    consistency,
    truncated: firstRun.truncated || secondRun.truncated,
    omitted: firstRun.omitted + secondRun.omitted,
    run1RootCollectionSetStable:
      collectionDiscoveryContract.run1.rootCollectionSetStable,
    run2RootCollectionSetStable:
      collectionDiscoveryContract.run2.rootCollectionSetStable,
    finalMatchesRun1: collectionDiscoveryContract.finalMatchesRun1,
    finalMatchesRun2: collectionDiscoveryContract.finalMatchesRun2,
  });
  const candidateSetDigest =
    publicationSetContract.candidateSetDigest;
  const expectedDeleteCount = consistency ?
    aggregateCounts(secondRun.collectionSummaries).reset :
    0;
  if (consistency &&
      publicationSetContract.candidateCount !== expectedDeleteCount) {
    throw new PlannerConfigError(
        "Publication candidate count does not match expected deletes.",
    );
  }
  const publicationContractComponents =
    buildCanonicalPublicationContract({
      project,
      academy,
      releaseSha,
      runtimeSourceIdentity: validatedRuntimeSourceIdentity,
      run: publicationRun,
      consistency,
      planDigest: "",
      outputPolicy,
      publicationSetContract,
      recordSetContract,
      runtimeSourceContract,
      collectionDiscoveryContract,
      publicationStateContract,
    });
  const canonicalPlanDraft = {
    planVersion: RESET_PLAN_VERSION,
    project,
    academy,
    releaseSha,
    runtimeHeadSha: validatedRuntimeSourceIdentity.runtimeHeadSha,
    runtimeTreeSha: validatedRuntimeSourceIdentity.runtimeTreeSha,
    criticalRuntimeSources:
      validatedRuntimeSourceIdentity.criticalRuntimeSources,
    ...outputPolicy,
    findingDeduplicationResult,
    firstRunDigest: firstRun.runDigest,
    secondRunDigest: secondRun.runDigest,
    consistency,
    candidateSetDigest,
    expectedDeleteCount,
    publicationSetContract,
    recordSetContract,
    runtimeSourceContract,
    collectionDiscoveryContract,
    publicationStateContract,
    ...publicationStateContract,
    registryContract: publicationContractComponents.registry,
    collectionCounts: publicationContractComponents.collections,
    referenceCounts: publicationContractComponents.counts,
    plannedMutations: publicationContractComponents.planned,
    candidateInputs:
      canonicalCandidateInputsFromPlannerRecords(publicationRun.records),
    recordInputs,
    referenceFindings: publicationRun.referenceFindings,
  };
  const planDigest = buildCanonicalPlanDigest(canonicalPlanDraft);
  const publicationContract = buildCanonicalPublicationContract({
    project,
    academy,
    releaseSha,
    runtimeSourceIdentity: validatedRuntimeSourceIdentity,
    run: consistency ? secondRun : firstRun,
    consistency,
    planDigest,
    outputPolicy,
    publicationSetContract,
    recordSetContract,
    runtimeSourceContract,
    collectionDiscoveryContract,
    publicationStateContract,
  });
  const canonicalPlan = immutableCanonicalSnapshot({
    ...canonicalPlanDraft,
    planDigest,
    publicationContract,
  });
  validateExactOutputSchema(
      canonicalPlan,
      CANONICAL_PLAN_SCHEMA,
      "Canonical plan",
  );
  assertCanonicalPlanIntegrity(canonicalPlan);
  const summary = structuredClone(buildRedactedSummary({
    project,
    academy,
    releaseSha,
    runtimeSourceIdentity: validatedRuntimeSourceIdentity,
    firstRun,
    secondRun,
    consistency,
    planDigest,
    resetProfile,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
    publicationContract,
    publicationSetContract,
    recordSetContract,
    runtimeSourceContract,
    collectionDiscoveryContract,
    publicationStateContract,
  }));
  assertRedactedSummary(summary);
  const manifest = consistency ? structuredClone(buildSensitiveManifest({
    project,
    academy,
    releaseSha,
    runtimeSourceIdentity: validatedRuntimeSourceIdentity,
    run: secondRun,
    planDigest,
    resetProfile,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
    publicationContract,
    publicationSetContract,
    recordSetContract,
    runtimeSourceContract,
    collectionDiscoveryContract,
    publicationStateContract,
  })) : null;
  if (manifest) {
    assertExactPublicationParity(canonicalPlan, summary, manifest);
    assertNoProhibitedContent(manifest, "Sensitive manifest");
  }
  return {
    exitCode,
    summary,
    manifest,
    canonicalPlan,
    firstRun,
    secondRun,
    finalRootCollections: finalRootCollectionSet.names,
    finalRootCollectionCount: finalRootCollectionSet.count,
    finalRootCollectionSetDigest:
      finalRootCollectionSet.setDigest,
    finalMatchesRun1: collectionDiscoveryContract.finalMatchesRun1,
    finalMatchesRun2: collectionDiscoveryContract.finalMatchesRun2,
  };
}

function parseFlagToken(token) {
  const body = token.slice(2);
  const separator = body.indexOf("=");
  if (separator === -1) return {key: body, inlineValue: null};
  return {
    key: body.slice(0, separator),
    inlineValue: body.slice(separator + 1),
  };
}

export function parsePlannerArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new PlannerConfigError(`Unexpected positional argument: ${token}`);
    }
    const {key, inlineValue} = parseFlagToken(token);
    if (BANNED_FLAGS.has(key)) {
      throw new PlannerConfigError(`Forbidden mutation flag: --${key}`);
    }
    if (!ALLOWED_FLAGS.has(key)) {
      throw new PlannerConfigError(`Unknown flag: --${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new PlannerConfigError(`Duplicate flag: --${key}`);
    }
    const value = inlineValue == null ? argv[index + 1] : inlineValue;
    if (inlineValue == null) index += 1;
    if (!value || value.startsWith("--")) {
      throw new PlannerConfigError(`Missing value for --${key}`);
    }
    values[key] = value;
  }
  return {
    project: values.project || "",
    academy: values.academy || "",
    releaseSha: values["release-sha"] || "",
    summaryOutput: values["summary-output"] || "",
    sensitiveOutput: values["sensitive-output"] || "",
    resetProfile: values["reset-profile"] || "",
    pageSize: values["page-size"] == null ?
      DEFAULT_PAGE_SIZE :
      Number(values["page-size"]),
  };
}

function validateResetProfileContract({
  academy,
  resetProfile,
  operatorTestDataConfirmation,
  fullBackupWaiverConfirmed,
}) {
  if (resetProfile &&
      resetProfile !== ALL_ACADEMY_DATA_TEST_PROFILE) {
    throw new PlannerConfigError("unsupported_reset_profile");
  }
  if (resetProfile && academy !== EXPECTED_TARGET_ACADEMY) {
    throw new PlannerConfigError(
        "Test-data reset profile is restricted to the exact target academy.",
    );
  }
  if (resetProfile &&
      operatorTestDataConfirmation !== true) {
    throw new PlannerConfigError("test_data_confirmation_required");
  }
  if (resetProfile &&
      fullBackupWaiverConfirmed !== true) {
    throw new PlannerConfigError(
        "full_backup_waiver_confirmation_required",
    );
  }
  if (!resetProfile &&
      (operatorTestDataConfirmation === true ||
       fullBackupWaiverConfirmed === true)) {
    throw new PlannerConfigError("confirmation_without_reset_profile");
  }
}

function validatePlannerIdentity({
  project,
  academy,
  releaseSha,
  pageSize,
}) {
  if (!normalizeText(project)) {
    throw new PlannerConfigError("--project is required.");
  }
  if (typeof academy !== "string" ||
      academy.length === 0 ||
      academy !== academy.trim() ||
      academy !== EXPECTED_TARGET_ACADEMY) {
    throw new PlannerConfigError(
        `--academy must be exactly ${EXPECTED_TARGET_ACADEMY}.`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new PlannerConfigError(
        "--release-sha must be a lowercase 40-character Git SHA.",
    );
  }
  if (!Number.isSafeInteger(pageSize) ||
      pageSize < MIN_PAGE_SIZE ||
      pageSize > MAX_PAGE_SIZE) {
    throw new PlannerConfigError(
        `--page-size must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}.`,
    );
  }
}

function pathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateOutputPath(filePath, label) {
  if (!path.isAbsolute(filePath)) {
    throw new PlannerConfigError(`${label} must be an absolute path.`);
  }
  if (fs.existsSync(filePath)) {
    throw new PlannerConfigError(`${label} already exists.`);
  }
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new PlannerConfigError(`${label} parent directory must exist.`);
  }
  if (fs.lstatSync(parent).isSymbolicLink()) {
    throw new PlannerConfigError(`${label} parent must not be a symlink.`);
  }
  const parentMode = fs.statSync(parent).mode & 0o777;
  if ((parentMode & 0o077) !== 0) {
    throw new PlannerConfigError(
        `${label} parent directory must not permit group/other access.`,
    );
  }
  const realParent = fs.realpathSync(parent);
  const resolvedOutput = path.join(realParent, path.basename(filePath));
  const repositoryRealPath =
    resolvePlannerFilesystemRepositoryRoot().repositoryRoot;
  if (pathInside(repositoryRealPath, resolvedOutput) ||
      pathInside(path.join(repositoryRealPath, ".git"), resolvedOutput)) {
    throw new PlannerConfigError(
        `${label} must be outside the repository and .git.`,
    );
  }
  return resolvedOutput;
}

function validatePlannerExecutionOptions(options, env = process.env) {
  validatePlannerIdentity(options);
  const rawProfileValue =
    typeof options.resetProfile === "string" ? options.resetProfile : "";
  const profileProvided = rawProfileValue !== "";
  const testConfirmationProvided =
    Object.prototype.hasOwnProperty.call(
        env,
        "CONFIRM_ALL_ACADEMY_DATA_IS_TEST",
    );
  const backupWaiverConfirmationProvided =
    Object.prototype.hasOwnProperty.call(
        env,
        "CONFIRM_OPERATOR_WAIVES_FULL_BACKUP",
    );
  if (!profileProvided &&
      (testConfirmationProvided || backupWaiverConfirmationProvided)) {
    throw new PlannerConfigError("confirmation_without_reset_profile");
  }
  if (profileProvided &&
      rawProfileValue !== ALL_ACADEMY_DATA_TEST_PROFILE) {
    throw new PlannerConfigError("unsupported_reset_profile");
  }
  const operatorTestDataConfirmation =
    testConfirmationProvided &&
    env.CONFIRM_ALL_ACADEMY_DATA_IS_TEST === "YES";
  const fullBackupWaiverConfirmed =
    backupWaiverConfirmationProvided &&
    env.CONFIRM_OPERATOR_WAIVES_FULL_BACKUP === "YES";
  validateResetProfileContract({
    academy: options.academy,
    resetProfile: rawProfileValue,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
  });
  const emulatorHost = normalizeText(env.FIRESTORE_EMULATOR_HOST);
  if (emulatorHost) {
    if (!options.project.startsWith("demo-")) {
      throw new PlannerConfigError(
          "Emulator planner requires a demo-* project.",
      );
    }
  } else {
    if (options.project !== EXPECTED_PRODUCTION_PROJECT) {
      throw new PlannerConfigError(
          `Non-emulator project must be ${EXPECTED_PRODUCTION_PROJECT}.`,
      );
    }
    if (env.CONFIRM_PRODUCTION_READONLY_RESET_PLAN !== "YES") {
      throw new PlannerConfigError(
          "CONFIRM_PRODUCTION_READONLY_RESET_PLAN=YES is required.",
      );
    }
  }
  return {
    ...options,
    resetProfile: rawProfileValue,
    operatorTestDataConfirmation,
    fullBackupWaiverConfirmed,
  };
}

function validatePlannerOutputPaths(options) {
  if (!options.summaryOutput || !options.sensitiveOutput) {
    throw new PlannerConfigError(
        "--summary-output and --sensitive-output are required.",
    );
  }
  if (options.summaryOutput === options.sensitiveOutput) {
    throw new PlannerConfigError("Output paths must be different.");
  }
  return {
    ...options,
    summaryOutput: validateOutputPath(
        options.summaryOutput,
        "Summary output",
    ),
    sensitiveOutput: validateOutputPath(
        options.sensitiveOutput,
        "Sensitive output",
    ),
  };
}

export function validatePlannerOptions(options, env = process.env) {
  return validatePlannerOutputPaths(
      validatePlannerExecutionOptions(options, env),
  );
}

function serializePlannerOutput(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function prepareAtomicFile(filePath, payload) {
  const temporaryPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.` +
      `${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL,
        0o600,
    );
    fs.writeFileSync(descriptor, payload);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.chmodSync(temporaryPath, 0o600);
    return {filePath, temporaryPath};
  } catch (error) {
    if (descriptor != null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function publishPreparedFiles(prepared, linkFile = fs.linkSync) {
  const published = [];
  try {
    for (const item of prepared) {
      linkFile(item.temporaryPath, item.filePath);
      published.push(item.filePath);
    }
  } catch (error) {
    published.forEach((filePath) => {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Best-effort rollback of a partially published output pair.
      }
    });
    throw error;
  } finally {
    prepared.forEach(({temporaryPath}) => {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The temporary file may already have been removed.
      }
    });
  }
  published.forEach((filePath) => fs.chmodSync(filePath, 0o600));
}

export function writePlannerOutputs({
  summaryOutput,
  sensitiveOutput,
  canonicalPlan,
  summary,
  manifest,
  linkFile = fs.linkSync,
}) {
  assertTrustedCanonicalPlanSnapshot(canonicalPlan);
  validateExactOutputSchema(
      canonicalPlan,
      CANONICAL_PLAN_SCHEMA,
      "Canonical plan",
  );
  validateExactOutputSchema(
      summary,
      REDACTED_SUMMARY_SCHEMA,
      "Redacted summary",
  );
  if (manifest) {
    validateExactOutputSchema(
        manifest,
        SENSITIVE_MANIFEST_SCHEMA,
        "Sensitive manifest",
    );
  }
  const canonicalIntegrity =
    assertCanonicalPlanIntegrity(canonicalPlan);
  const canonicalPublicationState =
    assertPublishableCanonicalState(
        canonicalIntegrity.publicationStateContract,
    );
  if (!manifest ||
      stableStringify(readPublicationStateContract(summary)) !==
        stableStringify(canonicalPublicationState) ||
      stableStringify(readPublicationStateContract(manifest)) !==
        stableStringify(canonicalPublicationState) ||
      stableStringify(summary.publicationStateContract) !==
        stableStringify(canonicalPublicationState) ||
      stableStringify(manifest.publicationStateContract) !==
        stableStringify(canonicalPublicationState)) {
    throw new PlannerConfigError(
        "Planner output publication state does not match canonical state.",
    );
  }
  const canonicalExecutionSafety =
    canonicalIntegrity.executionSafetyContract;
  if (stableStringify(readExecutionSafetyContract(summary)) !==
      stableStringify(canonicalExecutionSafety) ||
      stableStringify(readExecutionSafetyContract(manifest)) !==
      stableStringify(canonicalExecutionSafety) ||
      stableStringify(summary.executionSafetyContract) !==
      stableStringify(canonicalExecutionSafety) ||
      stableStringify(manifest.executionSafetyContract) !==
      stableStringify(canonicalExecutionSafety)) {
    throw new PlannerConfigError(
        "Planner output execution safety contract is not canonical.",
    );
  }
  assertRedactedSummary(summary);
  if (summary.planDigest !== canonicalIntegrity.recomputedPlanDigest ||
      stableStringify(summary.publicationContract) !==
        stableStringify(canonicalIntegrity.publicationContract) ||
      stableStringify(summaryPublicationProjection(summary)) !==
        stableStringify(canonicalIntegrity.publicationContract)) {
    throw new PlannerConfigError(
        "Redacted summary does not match the canonical plan snapshot.",
    );
  }
  if (manifest) {
    assertNoProhibitedContent(manifest, "Sensitive manifest");
    assertExactPublicationParity(canonicalPlan, summary, manifest);
  }
  const serializedOutputs = [
    ...(manifest ? [{
      filePath: sensitiveOutput,
      payload: serializePlannerOutput(manifest),
    }] : []),
    {
      filePath: summaryOutput,
      payload: serializePlannerOutput(summary),
    },
  ];
  const prepared = [];
  try {
    for (const output of serializedOutputs) {
      prepared.push(prepareAtomicFile(output.filePath, output.payload));
    }
    publishPreparedFiles(prepared, linkFile);
  } catch (error) {
    prepared.forEach(({temporaryPath}) => {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The atomic publisher may already have removed the file.
      }
    });
    throw error;
  }
  return {
    summaryWritten: true,
    sensitiveWritten: Boolean(manifest),
  };
}

async function createCliFirestore(project, env) {
  const {
    applicationDefault,
    deleteApp,
    getApps,
    initializeApp,
  } = await import("firebase-admin/app");
  const {getFirestore} = await import("firebase-admin/firestore");
  const emulator = Boolean(normalizeText(env.FIRESTORE_EMULATOR_HOST));
  const app = getApps().find((item) => item.name === "reset-planner") ||
    initializeApp(
        emulator ? {projectId: project} : {
          projectId: project,
          credential: applicationDefault(),
        },
        "reset-planner",
    );
  return {
    db: getFirestore(app),
    cleanup: async () => deleteApp(app),
  };
}

function safeErrorMessage(error) {
  if (error instanceof PlannerConfigError ||
      error instanceof PlannerIncompleteError) {
    return error.message;
  }
  return error?.name || "PlannerError";
}

export async function executePlannerCli({
  argv = process.argv.slice(2),
  env = process.env,
  dbFactory = createCliFirestore,
  stdout = console.log,
  stderr = console.error,
  beforeSecondRun = null,
} = {}) {
  let connection = null;
  try {
    const parsedOptions = parsePlannerArgs(argv);
    const executionOptions =
      validatePlannerExecutionOptions(parsedOptions, env);
    const sourceIdentity = resolvePlannerRuntimeSourceIdentity();
    const runtimeSourceIdentity =
      validatePlannerRuntimeSourceIdentity({
        identity: sourceIdentity,
        releaseSha: executionOptions.releaseSha,
      });
    const options = validatePlannerOutputPaths(executionOptions);
    await loadRuntimeRegistryModule();
    connection = await dbFactory(options.project, env);
    const result = await buildAcademyScopedResetPlan({
      db: connection.db,
      project: options.project,
      academy: options.academy,
      releaseSha: options.releaseSha,
      runtimeSourceIdentity,
      pageSize: options.pageSize,
      beforeSecondRun,
      resetProfile: options.resetProfile,
      operatorTestDataConfirmation:
        options.operatorTestDataConfirmation,
      fullBackupWaiverConfirmed:
        options.fullBackupWaiverConfirmed,
    });
    if (result.exitCode === 3) {
      throw new PlannerIncompleteError(
          "Planner collection or document inventory is inconsistent.",
      );
    }
    const writes = writePlannerOutputs({
      summaryOutput: options.summaryOutput,
      sensitiveOutput: options.sensitiveOutput,
      canonicalPlan: result.canonicalPlan,
      summary: result.summary,
      manifest: result.manifest,
    });
    stdout(JSON.stringify({
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      mode: "read_only_plan",
      resetProfile: result.summary.resetProfile,
      operatorTestDataConfirmation:
        result.summary.operatorTestDataConfirmation,
      fullBackupWaiverConfirmed:
        result.summary.fullBackupWaiverConfirmed,
      backupPolicy: result.summary.backupPolicy,
      completedRuns: 2,
      consistency: result.summary.consistency,
      resetCandidates: result.summary.totals.resetCandidates,
      unknownBlockers: result.summary.totals.unknownBlockers,
      referenceDiagnostics:
        result.summary.totals.referenceDiagnosticCount,
      referenceWarnings: result.summary.totals.referenceWarningCount,
      referenceBlockers: result.summary.totals.referenceBlockerCount,
      plannedDeletes: result.summary.planned.deletes,
      actualWrites: 0,
      writeAuthorized: false,
      executorImplemented: false,
      summaryWritten: writes.summaryWritten,
      sensitiveWritten: writes.sensitiveWritten,
    }));
    return result.exitCode;
  } catch (error) {
    const exitCode = error instanceof PlannerIncompleteError ? 3 : 1;
    stderr(JSON.stringify({
      ok: false,
      exitCode,
      mode: "read_only_plan",
      error: safeErrorMessage(error),
      actualWrites: 0,
      writeAuthorized: false,
      executorImplemented: false,
    }));
    return exitCode;
  } finally {
    if (connection?.cleanup) await connection.cleanup();
  }
}

const isMainModule = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  process.exitCode = await executePlannerCli();
}
