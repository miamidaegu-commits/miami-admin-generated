import crypto from "node:crypto";

import {
  APPROVED_ARTIFACT_REPOSITORY,
  DEPLOYMENT_TARGETS,
  IMMUTABLE_RELEASE_EVIDENCE,
  ORGANIZATION_POLICY_EVIDENCE,
  validateOrganizationPolicyEvidence,
} from "./academy-functions-build-scope-contract.mjs";
import {
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
  ARTIFACT_IAM_COLLECTION_PLAN_DIGEST,
  ARTIFACT_IAM_COLLECTION_PLAN_SCHEMA_VERSION,
  ARTIFACT_IAM_EVIDENCE_SCHEMA_VERSION,
  CLOUD_BUILD_LEGACY_EVIDENCE_AUTHORITY_DIGEST,
  CLOUD_BUILD_LEGACY_EVIDENCE_SCHEMA_VERSION,
  COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE,
  EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS,
  EXPECTED_CUSTOM_ROLE_IDS,
  EXISTING_FUNCTION_NAMES,
  EXISTING_FUNCTION_BASELINE_DIGEST,
  LEGACY_IAM_BASELINE_DIGEST,
  LEGACY_IAM_BASELINE_RECORDS,
  MIGRATION_AUTHORITY_SCHEMA_VERSION,
  PRE_PROVISIONING,
  TARGET_FUNCTION_NAMES,
} from "./academy-legacy-iam-migration-contract.mjs";
import {
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
} from "./academy-reset-freeze-provider-reviewed-sources.mjs";

export const FRESH_PREFLIGHT_RECEIPT_SCHEMA_VERSION =
  "academy_single_operator_fresh_preflight_receipt.v1";
export const FRESH_PREFLIGHT_CONTRACT_VERSION =
  "academy_single_operator_fresh_preflight_contract.v2";
export const FRESH_PREFLIGHT_INVOCATION_VERSION =
  "academy_single_operator_fresh_preflight_invocation.v1";
export const FRESH_PREFLIGHT_CURRENT_STATE_VERSION =
  "academy_single_operator_fresh_preflight_current_state.v1";
export const FRESH_PREFLIGHT_AUDIT_DISPOSITION_VERSION =
  "academy_single_operator_fresh_preflight_audit_disposition.v1";
export const FRESH_PREFLIGHT_COLLECTOR_SCHEMA_VERSION =
  "academy_single_operator_fresh_preflight_collector.v2";
export const FRESH_PREFLIGHT_COLLECTOR_CONFIG_VERSION =
  "academy_single_operator_fresh_preflight_collector_config.v2";
export const FRESH_PREFLIGHT_RAW_PROJECTION_VERSION =
  "academy_single_operator_fresh_preflight_raw_projection.v1";
export const FRESH_PREFLIGHT_OPERATOR_MODE = "SINGLE_OPERATOR_JIT_V1";
export const FRESH_PREFLIGHT_OPERATOR_PRINCIPAL =
  "user:miamidaegu@gmail.com";
export const FRESH_PREFLIGHT_PROJECT = "daegu-miami-production";
export const FRESH_PREFLIGHT_PROJECT_NUMBER = "884850632328";
export const FRESH_PREFLIGHT_REGION = "us-central1";
export const FRESH_PREFLIGHT_CHALLENGE_BYTES = 32;
export const FRESH_PREFLIGHT_CHALLENGE_HEX_LENGTH = 64;
export const FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_RELEASE =
  "5eaa274bcf45b809cf9e7728f9a2ad9b63e71fba";
export const FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_TREE =
  "c164c2255524a145eb27a210b012ed38200e6770";

const SHA256_HEX = /^[a-f0-9]{64}$/;
const GIT_SHA = /^[a-f0-9]{40}$/;
const RFC3339_UTC =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z$/;
const invocationStates = new WeakMap();
const usedNonces = new Set();
const freshAuthorizationCapabilities = new WeakMap();
const freshFinalizationCapabilities = new WeakMap();
const COLLECTOR_SOURCE_PATH =
  "functions/scripts/academy-single-operator-fresh-preflight-contract.mjs";
const collectorSourcePin = PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.find(
    ({path}) => path === COLLECTOR_SOURCE_PATH,
);
if (!collectorSourcePin) {
  throw new Error("Fresh preflight collector reviewed-source pin is absent.");
}

function fail(message) {
  throw new Error(
      `Academy single-operator fresh preflight rejected: ${message}`,
  );
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

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

function assertSha256(value, label) {
  if (typeof value !== "string" || !SHA256_HEX.test(value)) {
    fail(`${label} must be lowercase SHA-256 hex`);
  }
}

function assertGitSha(value, label) {
  if (typeof value !== "string" || !GIT_SHA.test(value)) {
    fail(`${label} must be lowercase Git SHA`);
  }
}

function sameStringArrays(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}

export function canonicalJson(value) {
  if (value === undefined) fail("undefined is not canonical");
  if (value === null) return "null";
  if (typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined ||
        !["string", "number", "boolean"].includes(typeof value) ||
        (typeof value === "number" && !Number.isFinite(value))) {
      fail("unsupported canonical value");
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

export function canonicalDigest(value) {
  return crypto.createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export const FRESH_PREFLIGHT_COLLECTOR_OPERATIONS = deepFreeze([
  {id: "ACTIVE_ACCOUNT_EXACT", readOnly: true},
  {id: "ACTIVE_PROJECT_EXACT", readOnly: true},
  {id: "IMPERSONATION_ABSENT", readOnly: true},
  {id: "EXECUTION_SOURCE_RELEASE_TREE_EXACT", readOnly: true},
  {id: "ACADEMY_SERVICE_ACCOUNTS_ALL_ABSENT", readOnly: true},
  {id: "ACADEMY_CUSTOM_ROLES_ALL_ABSENT", readOnly: true},
  {id: "LEGACY_IAM_BASELINE_EXACT_FOUR_RECORDS", readOnly: true},
  {id: "UNEXPECTED_ACADEMY_PREFIXED_RESOURCES_ZERO", readOnly: true},
  {id: "FUNCTIONS_TOTAL_32_GEN1_0_GEN2_32", readOnly: true},
  {id: "TARGET_THREE_FUNCTIONS_ABSENT", readOnly: true},
  {id: "UNIQUE_BUILDS_EXACT_14", readOnly: true},
  {id: "FUNCTION_RUN_BUILD_MAPPING_EXACT", readOnly: true},
  {id: "USER_MANAGED_SERVICE_ACCOUNT_KEYS_ZERO", readOnly: true},
  {id: "ARTIFACT_REPOSITORY_METADATA_IAM_EXACT", readOnly: true},
  {id: "ORGANIZATION_POLICY_EXACT_21_RECORD_DIGEST", readOnly: true},
  {id: "PRODUCTION_DATA_ACCESS_ZERO", readOnly: true},
  {id: "MUTATIONS_ZERO", readOnly: true},
]);

const collectorOperationProjection = {
  schemaVersion: FRESH_PREFLIGHT_COLLECTOR_SCHEMA_VERSION,
  sourcePath: COLLECTOR_SOURCE_PATH,
  sourceSha256: collectorSourcePin.sha256,
  operations: FRESH_PREFLIGHT_COLLECTOR_OPERATIONS,
  transport: "STATIC_APPROVED_COLLECTOR_ONLY",
};
export const FRESH_PREFLIGHT_COLLECTOR_AUTHORITY = deepFreeze({
  ...collectorOperationProjection,
  operationConfigDigest: canonicalDigest(collectorOperationProjection),
});
export const FRESH_PREFLIGHT_COLLECTOR_CONFIG_DIGEST =
  FRESH_PREFLIGHT_COLLECTOR_AUTHORITY.operationConfigDigest;

const approvedConfigProjection = {
  schemaVersion: FRESH_PREFLIGHT_COLLECTOR_CONFIG_VERSION,
  collectorSchemaVersion: FRESH_PREFLIGHT_COLLECTOR_SCHEMA_VERSION,
  collectorSourceSha256: collectorSourcePin.sha256,
  collectorOperationConfigDigest: FRESH_PREFLIGHT_COLLECTOR_CONFIG_DIGEST,
  executionSource: {
    release: FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_RELEASE,
    tree: FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_TREE,
  },
  previousResultVerdict: "READY_FOR_JIT_EXECUTION_RECEIPT",
  rawEvidenceDigest:
    "f5e79e8e3a79ac60a3aaaaf03c88991030f2e9072610e36dc2457d159927c8cc",
  resultPackageDigest:
    "f9a5d5a219445d35c6d958279ac6b579de5212c8aedcdee9c0ed6c9d2e826fd8",
  preflightEvidenceDigest:
    "05511b24755ac1a07b557c6a1f842a53675b03b3d2dd387924c581e31a28404e",
  rollbackManifestDigest:
    "76099bb7d9152139dd4aec61c07adb159565da6749698af091154bc7b278c612",
  provisioningManifestDigest:
    "9e8027a49a8412a77bd132b4216e883456ff69ddc325a0baa802171a4c748db1",
  executionManifestDigest:
    "5c423d822338618e87b9028afeebb95970d608ccff2cd00453151c10b43d4158",
  issuanceToolDigest:
    "4c80bf2353b45ab772628fd9550077509034aff1d0cc2fbbe5302a1c6309e411",
};
export const FRESH_PREFLIGHT_APPROVED_CONFIG = deepFreeze({
  ...approvedConfigProjection,
  configDigest: canonicalDigest(approvedConfigProjection),
});
export const FRESH_PREFLIGHT_APPROVED_CONFIG_DIGEST =
  FRESH_PREFLIGHT_APPROVED_CONFIG.configDigest;

const APPROVED_FUNCTION_BUILD_ID_BY_NAME = deepFreeze({
  adminCancelPrivateLessonReservation:
    "dfa63e8a-cfb0-4b60-bf3c-bda9827b37d9",
  adminClosePrivateLessonSlot:
    "dfa63e8a-cfb0-4b60-bf3c-bda9827b37d9",
  adminReopenPrivateLessonSlot:
    "dfa63e8a-cfb0-4b60-bf3c-bda9827b37d9",
  autoDeductPendingLessons: "779f7598-0376-4ae4-a1d4-bda3f2da22fc",
  bootstrapAdmin: "779f7598-0376-4ae4-a1d4-bda3f2da22fc",
  cancelFixedPrivateLessonOccurrence:
    "b1eae3d7-1c9f-42bf-bb67-adf64293fea8",
  cancelGroupLessonSeat: "dfbc2971-a12d-4115-bac2-8446b1433ca6",
  cancelPrivateLessonReservation:
    "dfa63e8a-cfb0-4b60-bf3c-bda9827b37d9",
  commitPrivateLessonOutcomeAction:
    "160e5022-62b9-44db-9031-f9572f0de298",
  commitPrivateLessonStatusAction:
    "81e41ee3-604b-4257-bab9-07bb4c1f1567",
  createFixedPrivateLessonRenewal:
    "0419f199-d673-49da-a114-9ec998dde732",
  inspectFixedPrivateLessonOutcomeLedger:
    "f351835f-6b5a-4da6-a567-5470312d7ac9",
  inspectFixedPrivateLessonOutcomeRemediationEvidence:
    "d2c899c3-fdf9-4bf1-94eb-650b48525af1",
  inspectFixedPrivateLessonRescheduleScope:
    "fb55e4f2-1637-49c6-bd0a-16dd882d8fa7",
  linkStudentAccount: "779f7598-0376-4ae4-a1d4-bda3f2da22fc",
  linkTeacherAccount: "779f7598-0376-4ae4-a1d4-bda3f2da22fc",
  listGroupLessonAvailability:
    "dfbc2971-a12d-4115-bac2-8446b1433ca6",
  listPrivateLessonSlotAvailability:
    "de162f9d-31e0-4c12-845d-c4b32610939c",
  markPrivateReservationOutcome:
    "26ab970a-37ba-4628-946f-536616b10a7f",
  previewFixedPrivateLessonRescheduleScope:
    "fb55e4f2-1637-49c6-bd0a-16dd882d8fa7",
  previewPrivateLessonOutcomeAction:
    "fa6df20e-4f92-4151-bddf-ed16cfcb394f",
  previewPrivateLessonStatusAction:
    "81e41ee3-604b-4257-bab9-07bb4c1f1567",
  releaseGroupLessonFixedSeat:
    "dfbc2971-a12d-4115-bac2-8446b1433ca6",
  reserveGroupLessonSeat: "dfbc2971-a12d-4115-bac2-8446b1433ca6",
  reservePrivateLessonSlot: "eb40405f-8b7b-46ae-b9ef-d1af3e1f2488",
  restoreGroupLessonFixedSeat:
    "dfbc2971-a12d-4115-bac2-8446b1433ca6",
  reversePrivateReservationOutcome:
    "dfa63e8a-cfb0-4b60-bf3c-bda9827b37d9",
  runAutoDeductPendingLessonsForTest:
    "779f7598-0376-4ae4-a1d4-bda3f2da22fc",
  setUserRole: "779f7598-0376-4ae4-a1d4-bda3f2da22fc",
  updateFixedPrivateLessonScheduleScope:
    "fb55e4f2-1637-49c6-bd0a-16dd882d8fa7",
  updateStudentPrivateCancelAllowance:
    "dfa63e8a-cfb0-4b60-bf3c-bda9827b37d9",
  updateTeacherStudentPackageCounts:
    "779f7598-0376-4ae4-a1d4-bda3f2da22fc",
});

function approvedFunctionRecords() {
  return EXISTING_FUNCTION_NAMES.map((functionName) => {
    const buildId = APPROVED_FUNCTION_BUILD_ID_BY_NAME[functionName];
    return {
      buildResource:
        `projects/${FRESH_PREFLIGHT_PROJECT_NUMBER}/locations/` +
        `${FRESH_PREFLIGHT_REGION}/builds/${buildId}`,
      buildServiceAccount: COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE,
      functionName,
      functionResource:
        `projects/${FRESH_PREFLIGHT_PROJECT}/locations/` +
        `${FRESH_PREFLIGHT_REGION}/functions/${functionName}`,
      generation: "GEN_2",
      region: FRESH_PREFLIGHT_REGION,
      serviceResource:
        `projects/${FRESH_PREFLIGHT_PROJECT}/locations/` +
        `${FRESH_PREFLIGHT_REGION}/services/${functionName.toLowerCase()}`,
    };
  });
}

function approvedBuildRecords() {
  return [...new Set(Object.values(APPROVED_FUNCTION_BUILD_ID_BY_NAME))]
      .sort()
      .map((id) => ({
        id,
        logging: "CLOUD_LOGGING_ONLY",
        logsBucket: null,
        name:
          `projects/${FRESH_PREFLIGHT_PROJECT_NUMBER}/locations/` +
          `${FRESH_PREFLIGHT_REGION}/builds/${id}`,
        projectId: FRESH_PREFLIGHT_PROJECT,
        region: FRESH_PREFLIGHT_REGION,
        serviceAccount: COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE,
        status: "SUCCESS",
      }));
}

const expectedServiceAccountEmails = EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS
    .map((serviceAccountId) =>
      `${serviceAccountId}@${FRESH_PREFLIGHT_PROJECT}` +
      ".iam.gserviceaccount.com")
    .sort();

const approvedRawProjectionWithoutDigest = {
  schemaVersion: FRESH_PREFLIGHT_RAW_PROJECTION_VERSION,
  activeAccount: "miamidaegu@gmail.com",
  activeProject: FRESH_PREFLIGHT_PROJECT,
  impersonation: null,
  academyServiceAccountIds: [],
  academyCustomRoleIds: [],
  legacyIamBaselineRecords: LEGACY_IAM_BASELINE_RECORDS,
  unexpectedAcademyPrefixedResources: [],
  functions: approvedFunctionRecords(),
  builds: approvedBuildRecords(),
  serviceAccountKeyRecords: expectedServiceAccountEmails.map((email) => ({
    email,
    exists: false,
    userManagedKeyCount: 0,
  })),
  artifactRepository: {
    metadata: APPROVED_ARTIFACT_REPOSITORY,
    iamPolicy: {bindings: [], etag: "ACAB", version: 1},
  },
  organizationPolicy: ORGANIZATION_POLICY_EVIDENCE,
  forbiddenFindings: [],
  inputRequired: [],
  productionDataAccess: 0,
  mutations: 0,
};
export const FRESH_PREFLIGHT_APPROVED_RAW_PROJECTION = deepFreeze({
  ...approvedRawProjectionWithoutDigest,
  projectionDigest: canonicalDigest(approvedRawProjectionWithoutDigest),
});
export const FRESH_PREFLIGHT_APPROVED_PROJECTION_DIGEST =
  FRESH_PREFLIGHT_APPROVED_RAW_PROJECTION.projectionDigest;

function parseExactRfc3339Utc(value, label) {
  if (typeof value !== "string") fail(`${label} must be a string`);
  const match = RFC3339_UTC.exec(value);
  if (!match) fail(`${label} must be exact RFC3339 UTC`);
  const [, year, month, day, hour, minute, second, fraction = ""] = match;
  const milliseconds = Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
  );
  const date = new Date(milliseconds);
  if (date.getUTCFullYear() !== Number(year) ||
      date.getUTCMonth() + 1 !== Number(month) ||
      date.getUTCDate() !== Number(day) ||
      date.getUTCHours() !== Number(hour) ||
      date.getUTCMinutes() !== Number(minute) ||
      date.getUTCSeconds() !== Number(second)) {
    fail(`${label} is not a real UTC instant`);
  }
  return BigInt(milliseconds) * 1_000_000n +
    BigInt(fraction.padEnd(9, "0") || "0");
}

function exactNowTimestamp() {
  return new Date().toISOString();
}

export const FRESH_PREFLIGHT_REQUIRED_CLOUD_CHECKS = deepFreeze(
    FRESH_PREFLIGHT_COLLECTOR_OPERATIONS.map(({id}) => id),
);

const contractWithoutDigest = {
  schemaVersion: FRESH_PREFLIGHT_CONTRACT_VERSION,
  receiptSchemaVersion: FRESH_PREFLIGHT_RECEIPT_SCHEMA_VERSION,
  invocationSchemaVersion: FRESH_PREFLIGHT_INVOCATION_VERSION,
  currentStateSchemaVersion: FRESH_PREFLIGHT_CURRENT_STATE_VERSION,
  authorityBaseRelease:
    FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_RELEASE,
  authorityBaseTree: FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_TREE,
  challenge: {
    generation: "CRYPTO_RANDOM_BYTES_IN_ISSUANCE_PROCESS",
    bytes: FRESH_PREFLIGHT_CHALLENGE_BYTES,
    encoding: "LOWERCASE_HEX",
    singleUse: true,
    callerSelectedNonceDisposition: "REJECT",
  },
  coupling: {
    sameInvocationRequired: true,
    standaloneReceiptPathAccepted: false,
    receiptReplayDisposition: "REJECT",
    mutationBetweenCollectionAndValidationDisposition: "REJECT",
    jitStartBeforeCollectionCompletionDisposition: "REJECT",
    jitStartEstablishedAfterReceiptValidation: true,
    receiptTransport: "IN_MEMORY_BUFFER",
    secureAuditCopyBeforeJitStartRequired: true,
    temporaryFreshnessEvidenceDisposition: "NOT_CREATED",
    failureDisposition: {
      activeJitReceiptCount: 0,
      mutationPackageCount: 0,
      allEligibility: false,
      auditOutput: "FAILURE_RECEIPT_ONLY",
    },
  },
  productionAuthorizationBoundary: {
    overrideParametersAccepted: false,
    callerClockAccepted: false,
    callerRawProjectionAccepted: false,
    callerSyntheticReceiptAccepted: false,
    exportedCapabilityMintingTestHelpers: [],
    collectorAndConfigAuthority: "REVIEWED_SOURCE_FIXED",
    clockAuthority: "INTERNAL_ONLY",
  },
  finalizationCapability: {
    storage: "MODULE_PRIVATE_WEAKMAP",
    canonicalSameInvocationField:
      "freshPreflightSameInvocationValidated",
    consumeBeforeValidation: true,
    copiedSerializedReconstructedDisposition: "REJECT",
    successfulRuntimeSuccessor: "PRIVATE_VALIDATION",
    failureSuccessorDisposition: "NONE",
  },
  requiredCloudChecks: FRESH_PREFLIGHT_REQUIRED_CLOUD_CHECKS,
  project: {
    project: FRESH_PREFLIGHT_PROJECT,
    projectNumber: FRESH_PREFLIGHT_PROJECT_NUMBER,
    region: FRESH_PREFLIGHT_REGION,
  },
  operator: {
    operatorMode: FRESH_PREFLIGHT_OPERATOR_MODE,
    operatorPrincipal: FRESH_PREFLIGHT_OPERATOR_PRINCIPAL,
  },
  sourceAuthority: {
    collectorSchemaVersion: FRESH_PREFLIGHT_COLLECTOR_SCHEMA_VERSION,
    collectorSourcePath: COLLECTOR_SOURCE_PATH,
    collectorSourceSha256: collectorSourcePin.sha256,
    collectorOperationConfigDigest:
      FRESH_PREFLIGHT_COLLECTOR_CONFIG_DIGEST,
    approvedConfigDigest: FRESH_PREFLIGHT_APPROVED_CONFIG_DIGEST,
    approvedProjectionDigest:
      FRESH_PREFLIGHT_APPROVED_PROJECTION_DIGEST,
    migrationAuthorityVersion: MIGRATION_AUTHORITY_SCHEMA_VERSION,
    migrationAuthorityDigest:
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
    cloudBuildEvidenceVersion:
      CLOUD_BUILD_LEGACY_EVIDENCE_SCHEMA_VERSION,
    cloudBuildEvidenceDigest:
      CLOUD_BUILD_LEGACY_EVIDENCE_AUTHORITY_DIGEST,
    artifactIamEvidenceVersion: ARTIFACT_IAM_EVIDENCE_SCHEMA_VERSION,
    artifactIamCollectionPlanDigest:
      ARTIFACT_IAM_COLLECTION_PLAN_DIGEST,
    deploymentSource: IMMUTABLE_RELEASE_EVIDENCE,
    organizationPolicyEvidenceDigest:
      ORGANIZATION_POLICY_EVIDENCE.evidenceDigest,
  },
};

export const FRESH_PREFLIGHT_CONTRACT = deepFreeze({
  ...contractWithoutDigest,
  contractDigest: canonicalDigest(contractWithoutDigest),
});
export const FRESH_PREFLIGHT_CONTRACT_DIGEST =
  FRESH_PREFLIGHT_CONTRACT.contractDigest;

export function buildFreshPreflightSourceIdentities(executionSource) {
  assertExactKeys(
      executionSource,
      ["release", "tree"],
      "execution source",
  );
  assertGitSha(executionSource.release, "execution source release");
  assertGitSha(executionSource.tree, "execution source tree");
  if (executionSource.release !==
        FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_RELEASE ||
      executionSource.tree !== FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_TREE) {
    fail("execution source release or tree is not the exact authority base");
  }
  return deepFreeze({
    executionSource: {
      release: executionSource.release,
      tree: executionSource.tree,
    },
    freshPreflightContract: {
      version: FRESH_PREFLIGHT_CONTRACT_VERSION,
      digest: FRESH_PREFLIGHT_CONTRACT_DIGEST,
    },
    collector: {
      schemaVersion: FRESH_PREFLIGHT_COLLECTOR_SCHEMA_VERSION,
      sourcePath: COLLECTOR_SOURCE_PATH,
      sourceSha256: collectorSourcePin.sha256,
      operationConfigDigest: FRESH_PREFLIGHT_COLLECTOR_CONFIG_DIGEST,
      approvedConfigDigest: FRESH_PREFLIGHT_APPROVED_CONFIG_DIGEST,
      approvedProjectionDigest:
        FRESH_PREFLIGHT_APPROVED_PROJECTION_DIGEST,
    },
    migrationAuthority: {
      version: MIGRATION_AUTHORITY_SCHEMA_VERSION,
      digest: ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
    },
    cloudBuildEvidence: {
      version: CLOUD_BUILD_LEGACY_EVIDENCE_SCHEMA_VERSION,
      digest: CLOUD_BUILD_LEGACY_EVIDENCE_AUTHORITY_DIGEST,
    },
    artifactCollectionPlan: {
      version: ARTIFACT_IAM_COLLECTION_PLAN_SCHEMA_VERSION,
      digest: ARTIFACT_IAM_COLLECTION_PLAN_DIGEST,
    },
    deploymentSource: IMMUTABLE_RELEASE_EVIDENCE,
    existingFunctionBaselineDigest: EXISTING_FUNCTION_BASELINE_DIGEST,
    targetThreeSelectorDigest: IMMUTABLE_RELEASE_EVIDENCE.selectorLfDigest,
    organizationPolicy: {
      evidenceDigest: ORGANIZATION_POLICY_EVIDENCE.evidenceDigest,
    },
  });
}

function projectionWithoutDigest(rawProjection) {
  const projection = {...rawProjection};
  delete projection.projectionDigest;
  return projection;
}

export function validateFreshPreflightRawProjection(rawProjection) {
  assertExactKeys(rawProjection, [
    "academyCustomRoleIds",
    "academyServiceAccountIds",
    "activeAccount",
    "activeProject",
    "artifactRepository",
    "builds",
    "forbiddenFindings",
    "functions",
    "impersonation",
    "inputRequired",
    "legacyIamBaselineRecords",
    "mutations",
    "organizationPolicy",
    "productionDataAccess",
    "projectionDigest",
    "schemaVersion",
    "serviceAccountKeyRecords",
    "unexpectedAcademyPrefixedResources",
  ], "fresh raw projection");
  const projection = projectionWithoutDigest(rawProjection);
  const recomputedDigest = canonicalDigest(projection);
  if (rawProjection.schemaVersion !==
        FRESH_PREFLIGHT_RAW_PROJECTION_VERSION ||
      rawProjection.projectionDigest !== recomputedDigest ||
      recomputedDigest !== FRESH_PREFLIGHT_APPROVED_PROJECTION_DIGEST ||
      canonicalJson(projection) !==
        canonicalJson(approvedRawProjectionWithoutDigest)) {
    fail("fresh raw projection or recomputed digest is not authoritative");
  }
  if (rawProjection.functions.length !== 32 ||
      rawProjection.builds.length !== 14 ||
      rawProjection.legacyIamBaselineRecords.length !== 4 ||
      rawProjection.organizationPolicy.directProjectPolicies.count +
        rawProjection.organizationPolicy.effectivePolicies.count !== 21 ||
      rawProjection.academyServiceAccountIds.length !== 0 ||
      rawProjection.academyCustomRoleIds.length !== 0 ||
      rawProjection.unexpectedAcademyPrefixedResources.length !== 0 ||
      rawProjection.forbiddenFindings.length !== 0 ||
      rawProjection.inputRequired.length !== 0 ||
      rawProjection.productionDataAccess !== 0 ||
      rawProjection.mutations !== 0) {
    fail("fresh raw projection record sets or safety counters mismatch");
  }
  validateOrganizationPolicyEvidence(rawProjection.organizationPolicy);
  return deepFreeze(structuredClone(rawProjection));
}

function buildCurrentStateFromRawProjection(rawProjection) {
  validateFreshPreflightRawProjection(rawProjection);
  const functionRecords = rawProjection.functions;
  const buildRecords = rawProjection.builds;
  const functionBuildReferenceDigest = canonicalDigest(functionRecords.map(
      ({buildResource, buildServiceAccount, functionName}) => ({
        buildResource,
        buildServiceAccount,
        functionName,
      }),
  ));
  const rawBuildSetDigest = canonicalDigest(buildRecords);
  const buildCollectionStatusDigest = canonicalDigest(buildRecords.map(
      ({id, status}) => ({id, status}),
  ));
  const mappingEvidenceDigest = canonicalDigest({
    buildCollectionStatusDigest,
    functionBuildReferenceDigest,
    rawBuildSetDigest,
  });
  const artifactMetadataDigest =
    canonicalDigest(rawProjection.artifactRepository.metadata);
  const artifactIamDigest =
    canonicalDigest(rawProjection.artifactRepository.iamPolicy);
  return deepFreeze({
    schemaVersion: FRESH_PREFLIGHT_CURRENT_STATE_VERSION,
    activeAccount: rawProjection.activeAccount,
    activeProject: rawProjection.activeProject,
    impersonation: rawProjection.impersonation,
    academyServiceAccounts: {
      expectedIds: [...EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS],
      presentIds: [...rawProjection.academyServiceAccountIds],
      unexpectedIds: [],
    },
    academyCustomRoles: {
      expectedIds: [...EXPECTED_CUSTOM_ROLE_IDS],
      presentIds: [...rawProjection.academyCustomRoleIds],
      unexpectedIds: [],
    },
    legacyIamBaseline: {
      digest: LEGACY_IAM_BASELINE_DIGEST,
      recordCount: rawProjection.legacyIamBaselineRecords.length,
      recordDigests: rawProjection.legacyIamBaselineRecords
          .map(({baselineRecordDigest}) => baselineRecordDigest)
          .sort(),
    },
    unexpectedAcademyPrefixedResourceCount:
      rawProjection.unexpectedAcademyPrefixedResources.length,
    functions: {
      totalCount: functionRecords.length,
      gen1Count:
        functionRecords.filter(({generation}) => generation === "GEN_1").length,
      gen2Count:
        functionRecords.filter(({generation}) => generation === "GEN_2").length,
      targetFunctionsPresent: functionRecords
          .map(({functionName}) => functionName)
          .filter((functionName) => TARGET_FUNCTION_NAMES.includes(functionName)),
      existingFunctionBaselineDigest: EXISTING_FUNCTION_BASELINE_DIGEST,
    },
    builds: {
      uniqueBuildCount: new Set(buildRecords.map(({id}) => id)).size,
      rawBuildSetDigest,
      buildCollectionStatusDigest,
    },
    functionRunBuildMapping: {
      complete: true,
      functionCount: functionRecords.length,
      uniqueBuildCount: new Set(
          functionRecords.map(({buildResource}) => buildResource),
      ).size,
      functionBuildReferenceDigest,
      evidenceDigest: mappingEvidenceDigest,
    },
    serviceAccountKeys: {
      serviceAccountEmails: rawProjection.serviceAccountKeyRecords
          .map(({email}) => email),
      userManagedKeyCount: rawProjection.serviceAccountKeyRecords
          .reduce((total, {userManagedKeyCount}) =>
            total + userManagedKeyCount, 0),
    },
    artifactRepository: {
      metadataExact: true,
      iamExact: true,
      iamDisposition: "EXACT_EMPTY_BINDINGS",
      collectionPlanDigest: ARTIFACT_IAM_COLLECTION_PLAN_DIGEST,
      evidenceDigest: canonicalDigest(rawProjection.artifactRepository),
      metadataEvidenceDigest: artifactMetadataDigest,
      iamEvidenceDigest: artifactIamDigest,
      policyDigest: artifactIamDigest,
    },
    organizationPolicy: {
      recordCount:
        rawProjection.organizationPolicy.directProjectPolicies.count +
        rawProjection.organizationPolicy.effectivePolicies.count,
      evidenceDigest: rawProjection.organizationPolicy.evidenceDigest,
    },
  });
}

export function buildApprovedFreshPreflightCurrentState() {
  return buildCurrentStateFromRawProjection(
      FRESH_PREFLIGHT_APPROVED_RAW_PROJECTION,
  );
}

function validateCurrentState(state) {
  assertExactKeys(state, [
    "academyCustomRoles",
    "academyServiceAccounts",
    "activeAccount",
    "activeProject",
    "artifactRepository",
    "builds",
    "functionRunBuildMapping",
    "functions",
    "impersonation",
    "legacyIamBaseline",
    "organizationPolicy",
    "schemaVersion",
    "serviceAccountKeys",
    "unexpectedAcademyPrefixedResourceCount",
  ], "fresh current state");
  assertExactKeys(state.academyServiceAccounts, [
    "expectedIds", "presentIds", "unexpectedIds",
  ], "fresh service account state");
  assertExactKeys(state.academyCustomRoles, [
    "expectedIds", "presentIds", "unexpectedIds",
  ], "fresh custom role state");
  assertExactKeys(state.legacyIamBaseline, [
    "digest", "recordCount", "recordDigests",
  ], "fresh legacy IAM baseline");
  assertExactKeys(state.functions, [
    "existingFunctionBaselineDigest",
    "gen1Count",
    "gen2Count",
    "targetFunctionsPresent",
    "totalCount",
  ], "fresh Function state");
  assertExactKeys(state.builds, [
    "buildCollectionStatusDigest",
    "rawBuildSetDigest",
    "uniqueBuildCount",
  ], "fresh Build state");
  assertExactKeys(state.functionRunBuildMapping, [
    "complete",
    "evidenceDigest",
    "functionBuildReferenceDigest",
    "functionCount",
    "uniqueBuildCount",
  ], "fresh Function Run Build mapping");
  assertExactKeys(state.serviceAccountKeys, [
    "serviceAccountEmails", "userManagedKeyCount",
  ], "fresh service account key state");
  assertExactKeys(state.artifactRepository, [
    "collectionPlanDigest",
    "evidenceDigest",
    "iamDisposition",
    "iamEvidenceDigest",
    "iamExact",
    "metadataEvidenceDigest",
    "metadataExact",
    "policyDigest",
  ], "fresh Artifact Repository state");
  assertExactKeys(state.organizationPolicy, [
    "evidenceDigest", "recordCount",
  ], "fresh Organization Policy state");
  const expectedBaselineRecordDigests = LEGACY_IAM_BASELINE_RECORDS
      .map(({baselineRecordDigest}) => baselineRecordDigest)
      .sort();
  const expectedServiceAccountIds =
    [...EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS].sort();
  const expectedRoleIds = [...EXPECTED_CUSTOM_ROLE_IDS].sort();
  const expectedServiceAccountEmails = EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS
      .map((serviceAccountId) =>
        `${serviceAccountId}@${FRESH_PREFLIGHT_PROJECT}` +
        ".iam.gserviceaccount.com")
      .sort();
  if (canonicalJson(state) !==
        canonicalJson(buildApprovedFreshPreflightCurrentState()) ||
      state.schemaVersion !== FRESH_PREFLIGHT_CURRENT_STATE_VERSION ||
      state.activeAccount !== "miamidaegu@gmail.com" ||
      state.activeProject !== FRESH_PREFLIGHT_PROJECT ||
      state.impersonation !== null ||
      state.unexpectedAcademyPrefixedResourceCount !== 0 ||
      canonicalJson([...state.academyServiceAccounts.expectedIds].sort()) !==
        canonicalJson(expectedServiceAccountIds) ||
      state.academyServiceAccounts.presentIds.length !== 0 ||
      state.academyServiceAccounts.unexpectedIds.length !== 0 ||
      canonicalJson([...state.academyCustomRoles.expectedIds].sort()) !==
        canonicalJson(expectedRoleIds) ||
      state.academyCustomRoles.presentIds.length !== 0 ||
      state.academyCustomRoles.unexpectedIds.length !== 0 ||
      state.legacyIamBaseline.digest !== LEGACY_IAM_BASELINE_DIGEST ||
      state.legacyIamBaseline.recordCount !== 4 ||
      canonicalJson([...state.legacyIamBaseline.recordDigests].sort()) !==
        canonicalJson(expectedBaselineRecordDigests) ||
      state.functions.totalCount !== 32 ||
      state.functions.gen1Count !== 0 ||
      state.functions.gen2Count !== 32 ||
      state.functions.existingFunctionBaselineDigest !==
        EXISTING_FUNCTION_BASELINE_DIGEST ||
      canonicalJson(state.functions.targetFunctionsPresent) !==
        canonicalJson([]) ||
      state.builds.uniqueBuildCount !== 14 ||
      !SHA256_HEX.test(state.builds.rawBuildSetDigest) ||
      !SHA256_HEX.test(state.builds.buildCollectionStatusDigest) ||
      state.functionRunBuildMapping.complete !== true ||
      state.functionRunBuildMapping.functionCount !== 32 ||
      state.functionRunBuildMapping.uniqueBuildCount !== 14 ||
      !SHA256_HEX.test(state.functionRunBuildMapping.evidenceDigest) ||
      !SHA256_HEX.test(
          state.functionRunBuildMapping.functionBuildReferenceDigest,
      ) ||
      state.serviceAccountKeys.userManagedKeyCount !== 0 ||
      canonicalJson([...state.serviceAccountKeys.serviceAccountEmails]
          .sort()) !== canonicalJson(expectedServiceAccountEmails) ||
      state.artifactRepository.metadataExact !== true ||
      state.artifactRepository.iamExact !== true ||
      state.artifactRepository.iamDisposition !== "EXACT_EMPTY_BINDINGS" ||
      state.artifactRepository.collectionPlanDigest !==
        ARTIFACT_IAM_COLLECTION_PLAN_DIGEST ||
      !SHA256_HEX.test(state.artifactRepository.evidenceDigest) ||
      !SHA256_HEX.test(state.artifactRepository.metadataEvidenceDigest) ||
      !SHA256_HEX.test(state.artifactRepository.iamEvidenceDigest) ||
      !SHA256_HEX.test(state.artifactRepository.policyDigest) ||
      state.organizationPolicy.recordCount !== 21 ||
      state.organizationPolicy.evidenceDigest !==
        ORGANIZATION_POLICY_EVIDENCE.evidenceDigest) {
    fail("fresh current state is not the exact PRE_PROVISIONING projection");
  }
}

export function validateFreshPreflightCollectorAuthority(authority) {
  if (canonicalJson(authority) !==
      canonicalJson(FRESH_PREFLIGHT_COLLECTOR_AUTHORITY)) {
    fail("fresh collector source or operation authority mismatch");
  }
  return true;
}

function validateInvocationConfig(config) {
  assertExactKeys(config, [
    "collectorOperationConfigDigest",
    "collectorSchemaVersion",
    "collectorSourceSha256",
    "configDigest",
    "executionManifestDigest",
    "executionSource",
    "issuanceToolDigest",
    "preflightEvidenceDigest",
    "previousResultVerdict",
    "provisioningManifestDigest",
    "rawEvidenceDigest",
    "resultPackageDigest",
    "rollbackManifestDigest",
    "schemaVersion",
  ], "fresh invocation configuration");
  if (canonicalJson(config) !==
      canonicalJson(FRESH_PREFLIGHT_APPROVED_CONFIG) ||
      config.configDigest !== canonicalDigest(approvedConfigProjection)) {
    fail("fresh invocation configuration is not the sealed authority");
  }
  validateFreshPreflightCollectorAuthority(
      FRESH_PREFLIGHT_COLLECTOR_AUTHORITY,
  );
  buildFreshPreflightSourceIdentities(config.executionSource);
  if (config.previousResultVerdict !==
      "READY_FOR_JIT_EXECUTION_RECEIPT") {
    fail("fresh invocation requires a previous READY result package");
  }
  for (const key of [
    "executionManifestDigest",
    "issuanceToolDigest",
    "preflightEvidenceDigest",
    "provisioningManifestDigest",
    "rawEvidenceDigest",
    "resultPackageDigest",
    "rollbackManifestDigest",
  ]) {
    assertSha256(config[key], `fresh invocation ${key}`);
  }
}

export function assessFreshPreflightApprovedConfig(config) {
  validateInvocationConfig(config);
  return deepFreeze({
    schemaVersion: config.schemaVersion,
    configDigest: config.configDigest,
    collectorOperationConfigDigest:
      config.collectorOperationConfigDigest,
    sealedAuthorityValidated: true,
    authorizationCapability: null,
  });
}

function beginFreshPreflightInvocation(nowTimestamp) {
  const config = FRESH_PREFLIGHT_APPROVED_CONFIG;
  validateInvocationConfig(config);
  parseExactRfc3339Utc(nowTimestamp, "challengeCreatedAt");
  const challengeNonce =
    crypto.randomBytes(FRESH_PREFLIGHT_CHALLENGE_BYTES).toString("hex");
  if (!SHA256_HEX.test(challengeNonce) || usedNonces.has(challengeNonce)) {
    fail("fresh challenge generation failed closed");
  }
  const invocation = deepFreeze({
    schemaVersion: FRESH_PREFLIGHT_INVOCATION_VERSION,
    challengeNonce,
    challengeCreatedAt: nowTimestamp,
    receiptSchemaVersion: FRESH_PREFLIGHT_RECEIPT_SCHEMA_VERSION,
    standaloneReceiptAccepted: false,
  });
  invocationStates.set(invocation, {
    attempted: false,
    auditAttempted: false,
    challengeCreatedAt:
      parseExactRfc3339Utc(nowTimestamp, "challengeCreatedAt"),
    challengeNonce,
    config: structuredClone(config),
    finalized: false,
    finalizationAttempted: false,
    auditDisposition: null,
    validatedReceipt: null,
  });
  return invocation;
}

function beginSingleOperatorFreshPreflightInvocation() {
  if (arguments.length !== 0) {
    fail("production fresh invocation accepts no collector or config input");
  }
  return beginFreshPreflightInvocation(exactNowTimestamp());
}

function beginSingleOperatorFreshPreflightInvocationForTest(
    nowTimestamp,
) {
  if (arguments.length !== 1) {
    fail("test-only fresh invocation requires one internal-clock timestamp");
  }
  return beginFreshPreflightInvocation(nowTimestamp);
}

function receiptDigestProjection(receipt) {
  const projection = {...receipt};
  delete projection.receiptDigest;
  return projection;
}

export function buildFreshPreflightReceiptDigest(receipt) {
  assertPlainData(receipt, "fresh preflight receipt");
  return canonicalDigest(receiptDigestProjection(receipt));
}

export function buildFreshPreflightReceiptCanonicalBytes(receipt) {
  if (receipt.receiptDigest !== buildFreshPreflightReceiptDigest(receipt)) {
    fail("fresh receipt digest mismatch");
  }
  return Buffer.from(`${canonicalJson(receipt)}\n`, "utf8");
}

export async function runApprovedSingleOperatorFreshPreflightCollector() {
  if (arguments.length !== 0) {
    fail("approved production collector accepts no override input");
  }
  beginSingleOperatorFreshPreflightInvocation();
  const error = new Error(
      "Approved fresh-preflight Cloud runtime is not installed in this " +
      "repository contract snapshot.",
  );
  error.code = "INPUT_REQUIRED";
  error.reason = "APPROVED_FRESH_PREFLIGHT_COLLECTOR_RUNTIME_UNAVAILABLE";
  throw error;
}

function buildSingleOperatorFreshPreflightReceiptForTest({
  collectionCompletedAt,
  collectionStartedAt,
  invocation,
  rawProjection,
}) {
  const state = invocationStates.get(invocation);
  if (!state) {
    fail("test-only receipt builder requires an active invocation");
  }
  validateFreshPreflightRawProjection(rawProjection);
  const config = state.config;
  const receipt = {
    schemaVersion: FRESH_PREFLIGHT_RECEIPT_SCHEMA_VERSION,
    operatorMode: FRESH_PREFLIGHT_OPERATOR_MODE,
    operatorPrincipal: FRESH_PREFLIGHT_OPERATOR_PRINCIPAL,
    project: FRESH_PREFLIGHT_PROJECT,
    projectNumber: FRESH_PREFLIGHT_PROJECT_NUMBER,
    region: FRESH_PREFLIGHT_REGION,
    challengeNonce: invocation.challengeNonce,
    sourceIdentities:
      buildFreshPreflightSourceIdentities(config.executionSource),
    rawEvidenceDigest: config.rawEvidenceDigest,
    resultPackageDigest: config.resultPackageDigest,
    preflightEvidenceDigest: config.preflightEvidenceDigest,
    rollbackManifestDigest: config.rollbackManifestDigest,
    provisioningManifestDigest: config.provisioningManifestDigest,
    executionManifestDigest: config.executionManifestDigest,
    issuanceToolDigest: config.issuanceToolDigest,
    collectionStartedAt,
    collectionCompletedAt,
    readOnly: true,
    productionDataAccess: rawProjection.productionDataAccess,
    mutations: rawProjection.mutations,
    forbiddenFindings: rawProjection.forbiddenFindings,
    inputRequired: rawProjection.inputRequired,
    migrationPhase: PRE_PROVISIONING,
    rawProjection: structuredClone(rawProjection),
    currentState: buildCurrentStateFromRawProjection(rawProjection),
    receiptDigest: "",
  };
  receipt.receiptDigest = buildFreshPreflightReceiptDigest(receipt);
  return deepFreeze(receipt);
}

function parseCanonicalReceiptBytes(receiptBytes) {
  if (!Buffer.isBuffer(receiptBytes)) {
    fail("fresh receipt must be provided as in-memory Buffer bytes");
  }
  let receipt;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
  } catch {
    fail("fresh receipt JSON is invalid");
  }
  const canonicalBytes = Buffer.from(`${canonicalJson(receipt)}\n`, "utf8");
  if (!receiptBytes.equals(canonicalBytes)) {
    fail("fresh receipt bytes are not exact canonical JSON");
  }
  return receipt;
}

function validateReceiptShape(receipt) {
  assertExactKeys(receipt, [
    "challengeNonce",
    "collectionCompletedAt",
    "collectionStartedAt",
    "currentState",
    "executionManifestDigest",
    "forbiddenFindings",
    "inputRequired",
    "issuanceToolDigest",
    "migrationPhase",
    "mutations",
    "operatorMode",
    "operatorPrincipal",
    "preflightEvidenceDigest",
    "productionDataAccess",
    "project",
    "projectNumber",
    "rawProjection",
    "provisioningManifestDigest",
    "rawEvidenceDigest",
    "readOnly",
    "receiptDigest",
    "region",
    "resultPackageDigest",
    "rollbackManifestDigest",
    "schemaVersion",
    "sourceIdentities",
  ], "fresh preflight receipt");
  if (receipt.schemaVersion !== FRESH_PREFLIGHT_RECEIPT_SCHEMA_VERSION ||
      receipt.operatorMode !== FRESH_PREFLIGHT_OPERATOR_MODE ||
      receipt.operatorPrincipal !== FRESH_PREFLIGHT_OPERATOR_PRINCIPAL ||
      receipt.project !== FRESH_PREFLIGHT_PROJECT ||
      receipt.projectNumber !== FRESH_PREFLIGHT_PROJECT_NUMBER ||
      receipt.region !== FRESH_PREFLIGHT_REGION ||
      receipt.readOnly !== true ||
      receipt.productionDataAccess !== 0 ||
      receipt.mutations !== 0 ||
      receipt.migrationPhase !== PRE_PROVISIONING ||
      canonicalJson(receipt.forbiddenFindings) !== canonicalJson([]) ||
      canonicalJson(receipt.inputRequired) !== canonicalJson([]) ||
      !SHA256_HEX.test(receipt.challengeNonce) ||
      receipt.receiptDigest !== buildFreshPreflightReceiptDigest(receipt)) {
    fail("fresh receipt authority, safety, or digest mismatch");
  }
  validateFreshPreflightRawProjection(receipt.rawProjection);
  validateCurrentState(receipt.currentState);
  if (canonicalJson(receipt.currentState) !== canonicalJson(
      buildCurrentStateFromRawProjection(receipt.rawProjection),
  )) {
    fail("fresh receipt current state was not derived from raw projection");
  }
}

function validateSingleOperatorFreshPreflightReceipt(
    invocation,
    receiptBytes,
) {
  const state = invocationStates.get(invocation);
  if (!state) {
    fail("standalone or reconstructed fresh receipt invocation is forbidden");
  }
  if (state.attempted || usedNonces.has(state.challengeNonce)) {
    fail("fresh challenge nonce was already used");
  }
  state.attempted = true;
  usedNonces.add(state.challengeNonce);
  const receipt = parseCanonicalReceiptBytes(receiptBytes);
  validateReceiptShape(receipt);
  const config = state.config;
  if (receipt.challengeNonce !== state.challengeNonce ||
      canonicalJson(receipt.sourceIdentities) !== canonicalJson(
          buildFreshPreflightSourceIdentities(config.executionSource),
      ) ||
      receipt.rawEvidenceDigest !== config.rawEvidenceDigest ||
      receipt.resultPackageDigest !== config.resultPackageDigest ||
      receipt.preflightEvidenceDigest !== config.preflightEvidenceDigest ||
      receipt.rollbackManifestDigest !== config.rollbackManifestDigest ||
      receipt.provisioningManifestDigest !==
        config.provisioningManifestDigest ||
      receipt.executionManifestDigest !== config.executionManifestDigest ||
      receipt.issuanceToolDigest !== config.issuanceToolDigest ||
      receipt.rawProjection.projectionDigest !==
        FRESH_PREFLIGHT_APPROVED_PROJECTION_DIGEST) {
    fail("fresh receipt nonce, source, evidence, manifest, or state mismatch");
  }
  const collectionStartedAt = parseExactRfc3339Utc(
      receipt.collectionStartedAt,
      "collectionStartedAt",
  );
  const collectionCompletedAt = parseExactRfc3339Utc(
      receipt.collectionCompletedAt,
      "collectionCompletedAt",
  );
  if (collectionStartedAt < state.challengeCreatedAt ||
      collectionCompletedAt < collectionStartedAt) {
    fail("fresh collection chronology is invalid");
  }
  state.validatedReceipt = {
    collectionCompletedAt,
    collectionCompletedAtTimestamp: receipt.collectionCompletedAt,
    receiptDigest: receipt.receiptDigest,
  };
  const capability = Object.freeze(Object.create(null));
  freshAuthorizationCapabilities.set(capability, {
    consumed: false,
    invocation,
  });
  return capability;
}

function inspectSingleOperatorFreshPreflightCapability(capability) {
  const capabilityState = freshAuthorizationCapabilities.get(capability);
  if (!capabilityState || capabilityState.consumed) {
    fail("fresh authorization capability is absent, copied, or consumed");
  }
  const state = invocationStates.get(capabilityState.invocation);
  if (!state?.validatedReceipt) {
    fail("fresh authorization capability has no validated receipt");
  }
  return deepFreeze({
    activeJitReceiptEligible: false,
    challengeNonce: state.challengeNonce,
    collectionCompletedAt:
      state.validatedReceipt.collectionCompletedAtTimestamp,
    freshPreflightReceiptDigest: state.validatedReceipt.receiptDigest,
    freshPreflightSameInvocationValidated: true,
    mutationCommandsPublished: false,
    nonceConsumed: true,
  });
}

function validateSingleOperatorFreshPreflightAuditDisposition(
    capability,
    disposition,
) {
  const capabilityState = freshAuthorizationCapabilities.get(capability);
  if (!capabilityState || capabilityState.consumed) {
    fail("fresh authorization capability is absent, copied, or consumed");
  }
  const invocation = capabilityState.invocation;
  const state = invocationStates.get(invocation);
  if (!state || !state.validatedReceipt) {
    fail("fresh receipt must be validated before secure audit copy");
  }
  if (state.auditAttempted || state.auditDisposition !== null) {
    fail("fresh secure audit copy was already recorded");
  }
  state.auditAttempted = true;
  assertExactKeys(disposition, [
    "freshPreflightReceiptDigest",
    "mutationCommandsPublished",
    "mutations",
    "productionDataAccess",
    "receiptTransport",
    "schemaVersion",
    "secureAuditCopyComplete",
    "temporaryFreshnessEvidenceDisposition",
  ], "fresh secure audit disposition");
  if (disposition.schemaVersion !==
        FRESH_PREFLIGHT_AUDIT_DISPOSITION_VERSION ||
      disposition.freshPreflightReceiptDigest !==
        state.validatedReceipt.receiptDigest ||
      disposition.secureAuditCopyComplete !== true ||
      disposition.receiptTransport !== "IN_MEMORY_BUFFER" ||
      disposition.temporaryFreshnessEvidenceDisposition !== "NOT_CREATED" ||
      disposition.mutationCommandsPublished !== false ||
      disposition.productionDataAccess !== 0 ||
      disposition.mutations !== 0) {
    fail("fresh secure audit copy disposition is not exact or read-only");
  }
  state.auditDisposition = structuredClone(disposition);
  return deepFreeze(structuredClone(disposition));
}

function finalizeSingleOperatorFreshPreflightInvocation(
    capability,
    {freshPreflightReceiptDigest, jitStartsAt},
) {
  const capabilityState = freshAuthorizationCapabilities.get(capability);
  if (!capabilityState || capabilityState.consumed) {
    fail("fresh authorization capability is absent, copied, or consumed");
  }
  capabilityState.consumed = true;
  freshAuthorizationCapabilities.delete(capability);
  const invocation = capabilityState.invocation;
  const state = invocationStates.get(invocation);
  if (!state || !state.validatedReceipt) {
    fail("fresh receipt must be validated in the same invocation first");
  }
  if (!state.auditDisposition) {
    fail("fresh receipt secure audit copy must complete before JIT start");
  }
  if (state.finalizationAttempted || state.finalized) {
    fail("fresh invocation was already finalized");
  }
  state.finalizationAttempted = true;
  const startsAt = parseExactRfc3339Utc(jitStartsAt, "jitStartsAt");
  if (freshPreflightReceiptDigest !==
        state.validatedReceipt.receiptDigest ||
      startsAt <= state.validatedReceipt.collectionCompletedAt) {
    fail("fresh receipt digest or JIT start ordering is invalid");
  }
  state.jitStartsAt = jitStartsAt;
  state.finalized = true;
  const assessment = deepFreeze({
    activeJitReceiptEligible: true,
    executionManifestDigest: state.config.executionManifestDigest,
    freshPreflightReceiptDigest,
    freshPreflightSameInvocationValidated: true,
    issuanceToolDigest: state.config.issuanceToolDigest,
    jitStartsAt,
    jitStartsAfterFreshCollection: true,
    mutationCommandsPublished: false,
    nonceConsumed: true,
    preflightEvidenceDigest: state.config.preflightEvidenceDigest,
    provisioningManifestDigest: state.config.provisioningManifestDigest,
    rawEvidenceDigest: state.config.rawEvidenceDigest,
    resultPackageDigest: state.config.resultPackageDigest,
    rollbackManifestDigest: state.config.rollbackManifestDigest,
    secureAuditCopyValidated: true,
  });
  const finalizationCapability = Object.freeze(Object.create(null));
  freshFinalizationCapabilities.set(finalizationCapability, {
    assessment: structuredClone(assessment),
    invocation,
  });
  return finalizationCapability;
}

function buildExpectedFreshFinalizationAssessment(state) {
  return {
    activeJitReceiptEligible: true,
    executionManifestDigest: state.config.executionManifestDigest,
    freshPreflightReceiptDigest: state.validatedReceipt.receiptDigest,
    freshPreflightSameInvocationValidated: true,
    issuanceToolDigest: state.config.issuanceToolDigest,
    jitStartsAt: state.jitStartsAt,
    jitStartsAfterFreshCollection: true,
    mutationCommandsPublished: false,
    nonceConsumed: true,
    preflightEvidenceDigest: state.config.preflightEvidenceDigest,
    provisioningManifestDigest: state.config.provisioningManifestDigest,
    rawEvidenceDigest: state.config.rawEvidenceDigest,
    resultPackageDigest: state.config.resultPackageDigest,
    rollbackManifestDigest: state.config.rollbackManifestDigest,
    secureAuditCopyValidated: true,
  };
}

export function consumeSingleOperatorFreshPreflightFinalizationCapability(
    finalizationCapability,
) {
  const finalization =
    freshFinalizationCapabilities.get(finalizationCapability);
  if (!finalization) {
    fail("fresh finalization capability is absent, copied, or consumed");
  }
  freshFinalizationCapabilities.delete(finalizationCapability);
  const state = invocationStates.get(finalization.invocation);
  if (!state?.finalized || state.finalizationAttempted !== true ||
      !state.validatedReceipt || !state.auditDisposition) {
    fail("fresh finalization capability has no finalized invocation");
  }
  const expected = buildExpectedFreshFinalizationAssessment(state);
  if (canonicalJson(finalization.assessment) !== canonicalJson(expected)) {
    fail("fresh finalization capability assessment or lineage mismatch");
  }
  return deepFreeze(structuredClone(finalization.assessment));
}

export function validateFreshPreflightContract() {
  if (FRESH_PREFLIGHT_CONTRACT.contractDigest !==
      canonicalDigest(contractWithoutDigest) ||
      FRESH_PREFLIGHT_REQUIRED_CLOUD_CHECKS.length !== 17 ||
      TARGET_FUNCTION_NAMES.length !== 3 ||
      DEPLOYMENT_TARGETS.length !== 3) {
    fail("fresh preflight contract digest or authority mismatch");
  }
  return true;
}
