import assert from "node:assert/strict";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";
import {
  ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
  EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
  EXPECTED_WRITE_SURFACE_IDENTITY_DIGEST,
  WRITE_SOURCE_SHA256_ALLOWLIST,
  WRITE_SURFACE_REGISTRY_VERSION,
  writeSurfaceIdentityDigest,
} from "../functions/scripts/academy-reset-write-surface-registry.mjs";
import {
  APPROVED_PROVIDER_ADAPTER_ID,
  CRITICAL_RUNTIME_SOURCE_PATHS,
  DEPLOYMENT_APPROVAL_RECEIPT_VERSION,
  EXPECTED_ACADEMY_ID,
  EXPECTED_DEPLOYED_FUNCTION_NAMES,
  EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
  EXPECTED_FUNCTION_GENERATION,
  EXPECTED_FUNCTION_REGION,
  FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST,
  FUNCTION_HTTP_TRIGGER_CONTRACT_ID,
  FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION,
  FUNCTION_HTTP_TRIGGER_TYPE,
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NUMBER,
  IAM_PRINCIPAL_POLICY_VERSION,
  IAM_PRINCIPAL_POLICY_SCHEMA,
  IAM_EVIDENCE_FAMILY_NAMES,
  OBSERVATION_COMPLETENESS_VERSION,
  OBSERVER_PRINCIPAL_POLICY,
  PROVIDER_ADAPTER_METADATA,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
  PROVIDER_DEPENDENCY_CONTRACT_VERSION,
  WRITE_FREEZE_PROOF_VERSION,
  EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
  PROJECT_IDENTITY_CONTRACT_VERSION,
  PROVIDER_OBSERVATION_VERSION,
  PROOF_GATE_KEYS,
  REVIEWED_IAM_ROLE_DEFINITIONS,
  REVIEWED_PERMISSION_UNIVERSE,
  REVIEWED_WRITABLE_PERMISSIONS,
  REQUIRED_COMPARISON_BASELINE_DIGEST,
  REQUIRED_NEGATIVE_PROBES,
  REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS,
  ROLLBACK_UNFREEZE_ORDER,
  SCHEDULER_JOB_ALLOWLIST,
  STANDALONE_PROJECT_OBSERVER_PROFILE,
  UNFREEZE_ORDER,
  WRITABLE_PERMISSION_DERIVATION_VERSION,
  WRITER_DRAIN_CLASSES,
  WRITE_FREEZE_CONTRACT_VERSION,
  TARGET_PROJECT_IDENTITY,
  assertCanonicalJsonShape,
  buildApprovedIamExpectedState,
  buildFreezeIamContractLineage,
  buildIamFamilyCompleteness,
  buildDeterministicWriteFreezeProof,
  buildFunctionTriggerAbsenceEvidence,
  computeDrainTelemetryDigest,
  computeEvidenceArtifactDigest,
  computeIamPolicyDigest,
  computeNegativeProbeEvidenceDigest,
  computeObservedSetDigest,
  computeSentinelSnapshotDigest,
  sha256Canonical,
  stableStringify,
  validateWriteFreezeEvidence,
  validateFunctionTriggerAbsenceEvidence,
  validateProviderAdapterReviewedSources,
  validateProviderDependencyContract,
} from "../functions/scripts/academy-reset-write-freeze-contract.mjs";
import {
  EXECUTABLE_APPROVAL_VERSION,
  EXECUTION_SERVICE_ACCOUNT_EMAILS,
  FREEZE_ACTIVATION_RECEIPT_VERSION,
  FREEZE_ACTIVE_STATE,
  FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING,
  OPERATOR_MODE_CONTRACT_VERSION,
  PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
  PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
  SERVICE_ACCOUNT_KEY_AUDIT_VERSION,
  STEADY_STATE,
  THREE_PERSON_SEPARATION,
  buildExecutableApprovalDigest,
  buildStateSnapshot,
  buildTransitionReceiptChronologyDigest,
  compareExactRfc3339UtcInstants,
} from "../functions/scripts/academy-private-runtime-iam-contract.mjs";
import {
  BUILD_SCOPE_CONTRACT_DIGEST,
  BUILD_SCOPE_CONTRACT_VERSION,
  ORGANIZATION_POLICY_EVIDENCE,
  buildOrganizationPolicyLineageReference,
} from "../functions/scripts/academy-functions-build-scope-contract.mjs";
import {
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
  MIGRATION_AUTHORITY_SCHEMA_VERSION,
  PRE_PROVISIONING,
  buildPhaseEvidence,
} from "../functions/scripts/academy-legacy-iam-migration-contract.mjs";
import {
  PROVIDER_MANDATORY_OPERATION_COUNT,
  PROVIDER_MANDATORY_OPERATION_IDS,
  PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
  PROVIDER_OPERATION_CLASSIFICATION,
  PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
  PROVIDER_OPERATION_CLASSIFICATION_VERSION,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
  assertProviderOperationClassification,
  computeProviderOperationClassificationDigest,
  computeProviderOperationIdSetDigest,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";
import {
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT,
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
  OFFICIAL_EVIDENCE_SET_DIGEST,
  PERMISSION_RESEARCH_ARTIFACT_SHA256,
  READONLY_PERMISSION_MANIFEST_DIGEST,
  READONLY_PERMISSION_MANIFEST_VERSION,
  READONLY_PERMISSION_OPERATION_IDS,
  READONLY_PERMISSION_RECORDS,
  READONLY_PERMISSION_REGISTRY,
  REVIEWED_EVIDENCE_SET_DIGEST,
  STANDALONE_SOURCE_BUCKET_NAME,
  assertEffectiveMandatoryPermissionContract,
  assertReadonlyPermissionManifest,
  computeEffectiveMandatoryPermissionContract,
  computeReadonlyPermissionManifestDigest,
  convertPermissionRecordToReviewedEvidence,
  evaluateOptionalDiagnostic,
} from "../functions/scripts/academy-reset-freeze-readonly-permissions.mjs";
import {
  createValidatedProviderRuntimeContext,
} from "../functions/scripts/academy-reset-freeze-provider-attestation.mjs";
import {
  executeInjectedMockRawProductionObserverHarness,
} from "../functions/scripts/observe-academy-reset-freeze-production.mjs";
import {
  DEFAULT_REPOSITORY_ROOT,
  executeVerifierCli,
  verifyLocalWriteFreezeEvidence,
  writeProofAtomicNoClobber,
} from "../functions/scripts/verify-academy-reset-write-freeze.mjs";
import {
  resolveRuntimeGitSourceIdentity,
} from "../functions/scripts/academy-reset-freeze-runtime-identity.mjs";
import {
  createGenuineAdapterForEvidence,
  createGenuineTransportFixtureForEvidence,
} from "./helpers/academy-reset-freeze-genuine-adapter.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRepositoryRoot = path.resolve(__dirname, "..");
const sourceRepositoryRootDigest = sha256Canonical({
  repositoryRoot: fs.realpathSync(sourceRepositoryRoot),
  schemaVersion: PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
});

async function loadInstrumentedReleaseValidator() {
  const sourceDirectory = path.join(sourceRepositoryRoot, "functions/scripts");
  const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "academy-release-validator-"),
  );
  const scriptsDirectory = path.join(temporaryRoot, "scripts");
  fs.cpSync(sourceDirectory, scriptsDirectory, {recursive: true});
  const contractPath = path.join(
      scriptsDirectory,
      "academy-reset-write-freeze-contract.mjs",
  );
  fs.appendFileSync(contractPath, `
export {validateRelease as __testValidateRelease};
`);
  try {
    const instrumented = await import(
        `${pathToFileURL(contractPath).href}?instrumented=${Date.now()}`,
    );
    return instrumented.__testValidateRelease;
  } finally {
    fs.rmSync(temporaryRoot, {recursive: true, force: true});
  }
}

const validateReleaseForTest = await loadInstrumentedReleaseValidator();
const SHA = "1234567890abcdef1234567890abcdef12345678";
const TREE_SHA = "abcdef1234567890abcdef1234567890abcdef12";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const EXPECTED_RUNTIME_IAM_SOURCE_PATHS = Object.freeze([
  "functions/scripts/academy-functions-build-scope-contract.mjs",
  "functions/scripts/academy-legacy-iam-migration-contract.mjs",
  "functions/scripts/academy-private-runtime-iam-contract.mjs",
  "functions/scripts/academy-single-operator-fresh-preflight-contract.mjs",
]);
const TEST_NOW_MS = Date.now();
const atOffsetMinutes = (minutes) =>
  new Date(TEST_NOW_MS + minutes * 60 * 1000).toISOString();
const withFraction = (timestamp, fractionalDigits) =>
  timestamp.replace(/\.\d{3}Z$/, `.${fractionalDigits}Z`);
const oneNanosecondAfter = (timestamp) => {
  const match = /^(.*\.)(\d{1,9})Z$/.exec(timestamp);
  assert.ok(match);
  const nanoseconds =
    (BigInt(match[2].padEnd(9, "0")) + 1n).toString().padStart(9, "0");
  return `${match[1]}${nanoseconds}Z`;
};
const oneNanosecondBefore = (timestamp) => {
  const match = /^(.*\.)(\d{1,9})Z$/.exec(timestamp);
  assert.ok(match);
  const nanoseconds = BigInt(match[2].padEnd(9, "0"));
  if (nanoseconds > 0n) {
    return `${match[1]}${(nanoseconds - 1n).toString()
        .padStart(9, "0")}Z`;
  }
  const previousSecond =
    new Date(Date.parse(timestamp) - 1000).toISOString();
  return withFraction(previousSecond, "999999999");
};
const RESOURCE_AT = atOffsetMinutes(-12);
const APPROVED_AT = atOffsetMinutes(-11);
const DEPLOYMENT_AT = atOffsetMinutes(-10);
const ACTIVATED_AT = atOffsetMinutes(-9);
const RUNTIME_IAM_TRANSITION_AT = atOffsetMinutes(-4);
const SENTINEL_AT = atOffsetMinutes(-8);
const SCHEDULER_UPDATE_AT = atOffsetMinutes(-7);
const SCHEDULER_STOPPED_AT = atOffsetMinutes(-6.75);
const LAST_INGRESS_AT = atOffsetMinutes(-6.75);
const LAST_COMPLETION_AT = atOffsetMinutes(-6.5);
const QUIET_STARTED_AT = atOffsetMinutes(-6);
const QUIET_ENDED_AT = atOffsetMinutes(-4);
const IAM_READ_ONLY_AT = atOffsetMinutes(-3.5);
const PROVIDER_OBSERVED_AT = atOffsetMinutes(-3.25);
const PROBE_AT = atOffsetMinutes(-3);
const VERIFIED_AT = atOffsetMinutes(-2);
const EXPIRES_AT = atOffsetMinutes(20);
const SENTINEL_GENERATION = 42;
const SENTINEL_VERSION = SENTINEL_AT;
const FIXTURE_IAM_PRINCIPAL_ALLOWLIST = Object.freeze(
    IAM_PRINCIPAL_POLICY_SCHEMA.map(({
      id,
      semanticRole,
      disposition,
      effectivePermissions,
      authPermissions,
    }) => Object.freeze({
      id,
      semanticRole,
      disposition,
      effectivePermissions,
      authPermissions,
      member: {
        cloud_functions_runtime:
          `serviceAccount:${EXPECTED_PROJECT_NUMBER}-compute@` +
          "developer.gserviceaccount.com",
        firebase_admin_backend:
          "serviceAccount:firebase-adminsdk-ab123@" +
          "daegu-miami-production.iam.gserviceaccount.com",
        private_writer_runtime:
          "serviceAccount:academy-private-writer-runtime@" +
          "daegu-miami-production.iam.gserviceaccount.com",
        private_preview_runtime:
          "serviceAccount:academy-private-preview-rt@" +
          "daegu-miami-production.iam.gserviceaccount.com",
        future_reset_executor:
          "serviceAccount:academy-reset-executor@" +
          "daegu-miami-production.iam.gserviceaccount.com",
      }[id],
    })),
);

function runtimeGitFixture() {
  const pins = new Map(
      WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile, sha256}) =>
        [sourceFile, sha256]),
  );
  const criticalSources = CRITICAL_RUNTIME_SOURCE_PATHS.map((sourcePath) => {
    const digest = pins.get(sourcePath) ?? DIGEST_A;
    return {
      path: sourcePath,
      fileMode: "100644",
      gitBlobOid: SHA,
      indexFlags: "H",
      runtimeSha256: digest,
      headSha256: digest,
    };
  });
  const reviewedSources = PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.map(
      ({path: sourcePath, sha256}) => ({
        path: sourcePath,
        fileMode: "100644",
        gitBlobOid: SHA,
        indexFlags: "H",
        runtimeSha256: sha256,
        headSha256: sha256,
      }),
  );
  const criticalSourceByPath =
    new Map(criticalSources.map((source) => [source.path, source]));
  const iamContractSourceIdentity = {
    legacyIamMigrationAuthorityVersion:
      MIGRATION_AUTHORITY_SCHEMA_VERSION,
    legacyIamMigrationAuthorityDigest:
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
    privateRuntimeIamContractVersion: PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
    privateRuntimeIamContractDigest: PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
    buildScopeContractVersion: BUILD_SCOPE_CONTRACT_VERSION,
    buildScopeContractDigest: BUILD_SCOPE_CONTRACT_DIGEST,
    sources: [
      criticalSourceByPath.get(
          "functions/scripts/academy-functions-build-scope-contract.mjs",
      ),
      criticalSourceByPath.get(
          "functions/scripts/academy-legacy-iam-migration-contract.mjs",
      ),
      criticalSourceByPath.get(
          "functions/scripts/academy-private-runtime-iam-contract.mjs",
      ),
      criticalSourceByPath.get(
          "functions/scripts/academy-single-operator-fresh-preflight-contract.mjs",
      ),
    ],
  };
  return {
    headSha: SHA,
    treeSha: TREE_SHA,
    clean: true,
    criticalSources,
    criticalSourceSetDigest: sha256Canonical(criticalSources),
    reviewedSources,
    reviewedSourceIdentityDigest:
      EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
    reviewedSourceSetDigest: sha256Canonical(reviewedSources),
    iamContractSourceIdentity,
    iamContractSourceSetDigest: sha256Canonical(iamContractSourceIdentity),
  };
}

const RUNTIME_SERVICE_ACCOUNT_BY_FUNCTION = new Map(
    FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING.map(
        ({functionName, serviceAccountEmail}) => [
          functionName,
          `serviceAccount:${serviceAccountEmail}`,
        ],
    ),
);

function completeness(observedItems, {
  expectedCount = observedItems.length,
  scanStartedAt = RESOURCE_AT,
  scanCompletedAt = DEPLOYMENT_AT,
  pageCount = 1,
} = {}) {
  const digest = computeObservedSetDigest(observedItems);
  return {
    schemaVersion: OBSERVATION_COMPLETENESS_VERSION,
    scanStartedAt,
    scanCompletedAt,
    pageCount,
    nextPageTokenExhausted: true,
    unreachableResources: [],
    observedCount: observedItems.length,
    expectedCount,
    startSetDigest: digest,
    endSetDigest: digest,
    observedSetDigest: digest,
    stable: true,
  };
}

function refreshIamObservation(iam, approvedExpectedState) {
  iam.policyDigest = computeIamPolicyDigest(iam);
  iam.familyCompleteness =
    buildIamFamilyCompleteness(iam, approvedExpectedState);
  const observedItems = IAM_EVIDENCE_FAMILY_NAMES.flatMap((family) =>
    iam[family].map((value) => ({family, value})));
  iam.completeness = completeness(observedItems, {
    scanStartedAt: iam.completeness.scanStartedAt,
    scanCompletedAt: iam.completeness.scanCompletedAt,
    pageCount: iam.completeness.pageCount,
  });
  return iam;
}

function functionRecords() {
  return EXPECTED_DEPLOYED_FUNCTION_NAMES.map((name, index) => ({
    name,
    projectId: EXPECTED_PROJECT_ID,
    region: EXPECTED_FUNCTION_REGION,
    runtime: "nodejs24",
    generation: EXPECTED_FUNCTION_GENERATION,
    revisionId: `${name}-00001-abc`,
    buildId:
      `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    updateTime: RESOURCE_AT,
    providerSourceIdentity: {
      type: "storage_source",
      value: `gs://immutable/functions/${name}/987654321`,
      generation: "987654321",
      md5Hash: "VaVACK0bpYmqIQ0mKcHfQQ==",
      sha256:
        "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
      size: "1",
    },
    runtimeServiceAccount: RUNTIME_SERVICE_ACCOUNT_BY_FUNCTION.get(name),
    triggerContractVersion: FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION,
    triggerContractId: FUNCTION_HTTP_TRIGGER_CONTRACT_ID,
    triggerContractDigest: FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST,
    triggerType: FUNCTION_HTTP_TRIGGER_TYPE,
    eventTriggerAbsent: true,
  }));
}

function runtimeActivationApprovalFixture() {
  const approval = {
    schemaVersion: EXECUTABLE_APPROVAL_VERSION,
    approvalId: "academy-reset-freeze-runtime-iam-fixture",
    approvedAt: APPROVED_AT,
    operatorMode: THREE_PERSON_SEPARATION,
    provisioningPrincipal: "user:provisioner@daegu-miami.com",
    impersonationPrincipal: "user:deployer@daegu-miami.com",
    invokerOperatorPrincipal: "user:invoker@daegu-miami.com",
    jitStartsAt: DEPLOYMENT_AT,
    jitExpiresAt: EXPIRES_AT,
    freshPreflightReceiptDigest: null,
    organizationPolicy: structuredClone(ORGANIZATION_POLICY_EVIDENCE),
    organizationPolicyLineage:
      structuredClone(buildOrganizationPolicyLineageReference()),
    preProvisioningMigrationEvidence:
      structuredClone(buildPhaseEvidence(PRE_PROVISIONING)),
    serviceAccountKeyAudit: {
      schemaVersion: SERVICE_ACCOUNT_KEY_AUDIT_VERSION,
      projectId: "daegu-miami-production",
      serviceAccountEmails:
        structuredClone(EXECUTION_SERVICE_ACCOUNT_EMAILS),
      userManagedKeyCount: 0,
      complete: true,
    },
    singleOperatorControlManifest: null,
    actualProvisioningEligible: false,
    deploymentApprovalEligible: false,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: false,
    approvalDigest: "",
  };
  approval.approvalDigest = buildExecutableApprovalDigest(approval);
  return approval;
}

function runtimeActivationReceiptFixture(approval) {
  const receipt = {
    schemaVersion: FREEZE_ACTIVATION_RECEIPT_VERSION,
    contractDigest: PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
    exactChronologyDigest: "",
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    observedAt: RUNTIME_IAM_TRANSITION_AT,
    organizationPolicyLineage:
      structuredClone(buildOrganizationPolicyLineageReference()),
    fromState: STEADY_STATE,
    toState: FREEZE_ACTIVE_STATE,
    before: structuredClone(buildStateSnapshot(STEADY_STATE)),
    after: structuredClone(buildStateSnapshot(FREEZE_ACTIVE_STATE)),
  };
  receipt.exactChronologyDigest =
    buildTransitionReceiptChronologyDigest(receipt, approval);
  return receipt;
}

function approvedDeploymentResources(iamExpectedState) {
  return {
    projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    iamExpectedState: structuredClone(iamExpectedState),
    rules: {
      rulesetName: "projects/daegu-miami-production/rulesets/ruleset-123",
      releaseName:
        "projects/daegu-miami-production/releases/cloud.firestore",
      approvedArtifactDigest: DIGEST_A,
      approvedSourceDigest: DIGEST_B,
    },
    functions: functionRecords(),
  };
}

function rulesObservation() {
  const rules = {
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    releaseName:
      "projects/daegu-miami-production/releases/cloud.firestore",
    rulesetName: "projects/daegu-miami-production/rulesets/ruleset-123",
    releaseCreateTime: RESOURCE_AT,
    releaseUpdateTime: RESOURCE_AT,
    rulesetCreateTime: RESOURCE_AT,
    rulesetUpdateTime: RESOURCE_AT,
  };
  return {...rules, completeness: completeness([rules])};
}

function functionsObservation() {
  const records = functionRecords();
  return {
    records,
    guardedExportNames: [...EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES],
    triggerEvidence: buildFunctionTriggerAbsenceEvidence(records, records),
    completeness: completeness(records, {
      expectedCount: EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
      pageCount: 2,
    }),
  };
}

function principalWithSnapshot(principal) {
  const snapshot = {
    id: principal.id,
    member: principal.member,
    semanticRole: principal.semanticRole,
    disposition: principal.disposition,
    effectivePermissions: [...principal.effectivePermissions],
    authPermissions: [...principal.authPermissions],
  };
  return {...snapshot, snapshotDigest: sha256Canonical(snapshot)};
}

function iamObservation(
    functions = functionRecords(),
    approvedExpectedState = null,
) {
  const readOnlyRole = REVIEWED_IAM_ROLE_DEFINITIONS[0].role;
  const bindings = FIXTURE_IAM_PRINCIPAL_ALLOWLIST
      .filter(({disposition}) => disposition === "ACTIVE_READ_ONLY")
      .map(({member}) => ({
        attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
        inherited: false,
        member,
        role: readOnlyRole,
        condition: null,
      }));
  const principals =
    FIXTURE_IAM_PRINCIPAL_ALLOWLIST.map(principalWithSnapshot);
  const roleDefinitions =
    REVIEWED_IAM_ROLE_DEFINITIONS.map((role) => ({
      ...role,
      permissions: [...role.permissions],
    }));
  const runtimeServiceAccounts = functions.map((item) => ({
    functionName: item.name,
    member: item.runtimeServiceAccount,
  }));
  const iam = {
    observedAt: IAM_READ_ONLY_AT,
    bindings,
    conditionEvaluations: [],
    denyPolicies: [],
    denyEvaluations: [],
    groupExpansions: [{
      group: "group:academy-backend-readers@daegu-miami.com",
      complete: true,
      members: [],
      paths: [],
    }],
    impersonationEvidence: [],
    runtimeServiceAccounts,
    roleDefinitions,
    permissionUniverse: [...REVIEWED_PERMISSION_UNIVERSE],
    writablePermissionDerivation: {
      schemaVersion: WRITABLE_PERMISSION_DERIVATION_VERSION,
      permissionUniverseDigest:
        sha256Canonical([...REVIEWED_PERMISSION_UNIVERSE].sort()),
      writablePermissions: [...REVIEWED_WRITABLE_PERMISSIONS],
      readOnlyPermissions: REVIEWED_PERMISSION_UNIVERSE.filter((permission) =>
        !REVIEWED_WRITABLE_PERMISSIONS.includes(permission)),
    },
    principals,
    policyDigest: "",
    completeness: null,
    familyCompleteness: null,
  };
  iam.policyDigest = computeIamPolicyDigest(iam);
  const expectedState =
    approvedExpectedState ?? buildApprovedIamExpectedState(iam);
  iam.familyCompleteness =
    buildIamFamilyCompleteness(iam, expectedState);
  const observedItems = IAM_EVIDENCE_FAMILY_NAMES.flatMap((family) =>
    iam[family].map((value) => ({family, value})));
  iam.completeness = completeness(observedItems, {
    scanStartedAt: atOffsetMinutes(-5),
    scanCompletedAt: IAM_READ_ONLY_AT,
    pageCount: 4,
  });
  return iam;
}

function schedulerObservation() {
  const jobs = SCHEDULER_JOB_ALLOWLIST.map((job) => ({
    ...job,
    state: "DISABLED",
    updateTime: SCHEDULER_UPDATE_AT,
  }));
  return {
    jobs,
    completeness: completeness(jobs, {
      scanStartedAt: atOffsetMinutes(-7.2),
      scanCompletedAt: atOffsetMinutes(-6.9),
    }),
  };
}

function unboundEvidenceFixture() {
  const runtimeGit = runtimeGitFixture();
  const approvedIamSnapshot = iamObservation();
  const iamExpectedState =
    buildApprovedIamExpectedState(approvedIamSnapshot);
  const iamPolicy = iamObservation(functionRecords(), iamExpectedState);
  const byPath = new Map(
      runtimeGit.criticalSources.map((source) => [source.path, source]),
  );
  const runtimeIamActivationApproval = runtimeActivationApprovalFixture();
  const runtimeIamActivationReceipt =
    runtimeActivationReceiptFixture(runtimeIamActivationApproval);
  const evidence = {
    schemaVersion: WRITE_FREEZE_CONTRACT_VERSION,
    projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    academyId: EXPECTED_ACADEMY_ID,
    verifiedAt: VERIFIED_AT,
    freezeWindow: {
      activatedAt: ACTIVATED_AT,
      expiresAt: EXPIRES_AT,
    },
    release: {sha: SHA, runtimeGit},
    deploymentApprovalReceipt: {
      schemaVersion: DEPLOYMENT_APPROVAL_RECEIPT_VERSION,
      receiptId: DIGEST_A,
      approvedAt: APPROVED_AT,
      expiresAt: EXPIRES_AT,
      projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
      projectId: EXPECTED_PROJECT_ID,
      projectNumber: EXPECTED_PROJECT_NUMBER,
      releaseSha: SHA,
      localSources: {
        rulesSha256: byPath.get("firestore.rules").headSha256,
        functionsSha256: byPath.get("functions/index.js").headSha256,
        writerSourceIdentityDigest:
          EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
        approvedRulesArtifactDigest: DIGEST_A,
        approvedRulesSourceDigest: DIGEST_B,
      },
      resources: approvedDeploymentResources(iamExpectedState),
      runtimeIamActivationApproval,
      runtimeIamActivationReceipt,
      organizationPolicyLineage:
        structuredClone(buildOrganizationPolicyLineageReference()),
      freezeIamContractLineage:
        buildFreezeIamContractLineage(runtimeIamActivationApproval),
      providerDependencyApproval: {
        ...structuredClone(PROVIDER_ADAPTER_METADATA),
        strategy: "declared_google_auth_library_rest",
        module: "google-auth-library",
        reviewedSourceDigest:
          EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
        reviewedSourceRepositoryRootDigest: sourceRepositoryRootDigest,
        reviewedLockDigest: DIGEST_B,
      },
      iamPrincipalAllowlist: FIXTURE_IAM_PRINCIPAL_ALLOWLIST.map(
          (principal) => ({
            ...principal,
            effectivePermissions: [...principal.effectivePermissions],
            authPermissions: [...principal.authPermissions],
          }),
      ),
    },
    sentinel: {
      academyId: EXPECTED_ACADEMY_ID,
      projectId: EXPECTED_PROJECT_ID,
      schemaVersion: WRITE_FREEZE_CONTRACT_VERSION,
      mode: "academy_test_data_reset",
      provider: "firestore.googleapis.com",
      documentPath: `academies/${EXPECTED_ACADEMY_ID}`,
      fieldPath: "resetWriteFreeze",
      writeFreezeActive: true,
      generation: SENTINEL_GENERATION,
      version: SENTINEL_VERSION,
      capturedAt: SENTINEL_AT,
      snapshotDigest: "",
      writerRegistryDigest:
        sha256Canonical(ACADEMY_RESET_WRITE_SURFACE_REGISTRY),
    },
    scheduler: schedulerObservation(),
    iamPolicy,
    drainTelemetry: {
      schedulerStoppedAt: SCHEDULER_STOPPED_AT,
      sentinelGeneration: SENTINEL_GENERATION,
      lastWriterIngressAt: LAST_INGRESS_AT,
      lastWriterCompletionAt: LAST_COMPLETION_AT,
      quietWindowStartedAt: QUIET_STARTED_AT,
      quietWindowEndedAt: QUIET_ENDED_AT,
      checkpoints: WRITER_DRAIN_CLASSES.map((writerClass) => ({
        writerClass,
        sentinelGeneration: SENTINEL_GENERATION,
        ingressBlocked: true,
        inFlightExecutions: 0,
        ingressCountDuringQuietWindow: 0,
        completionCountDuringQuietWindow: 0,
        checkpointAt: IAM_READ_ONLY_AT,
      })),
      telemetryDigest: "",
    },
    gateStates: Object.fromEntries(PROOF_GATE_KEYS.map((key) => [key, true])),
    operationalSafety: {
      actualMutations: 0,
      actualWrites: 0,
      advisoryOnly: true,
      executorImplemented: false,
    },
    negativeProbes: REQUIRED_NEGATIVE_PROBES.map((required) => {
      const probeEvidence = {
        ...required,
        sentinelGeneration: SENTINEL_GENERATION,
        sentinelVersion: SENTINEL_VERSION,
        denied: true,
        observedAt: PROBE_AT,
        evidenceDigest: "",
      };
      probeEvidence.evidenceDigest =
        computeNegativeProbeEvidenceDigest(probeEvidence);
      return probeEvidence;
    }),
    baselineComparison: {
      comparisonOnly: true,
      digest: REQUIRED_COMPARISON_BASELINE_DIGEST,
      matched: null,
    },
    artifactDigest: "",
  };
  evidence.sentinel.snapshotDigest =
    computeSentinelSnapshotDigest(evidence.sentinel);
  evidence.drainTelemetry.telemetryDigest =
    computeDrainTelemetryDigest(evidence.drainTelemetry);
  evidence.artifactDigest = computeEvidenceArtifactDigest(evidence);
  return evidence;
}

function providerResultFor(evidence) {
  const approvalReceipt = structuredClone(evidence.deploymentApprovalReceipt);
  const dependencyApproval = approvalReceipt.providerDependencyApproval;
  const executionTrace = REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS
      .map((operationId, index) => ({
        operationId,
        transportExecutionId: `synthetic-execution-${index}`,
        pageCount: 1,
        recordCount: 1,
        paginationComplete: true,
        mockOnly: true,
      }));
  const operationExecution = {
    providerOperationAllowlistVersion:
      PROVIDER_ADAPTER_METADATA.providerOperationAllowlistVersion,
    providerOperationDescriptorSetDigest:
      PROVIDER_ADAPTER_METADATA.providerOperationDescriptorSetDigest,
    executedOperationIds: [...REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS],
    executedOperationCount: REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS.length,
    executionTrace,
    executionTraceCount: executionTrace.length,
    executionTraceDigest: sha256Canonical(executionTrace),
    unknownOperationCount: 0,
    actualMutations: 0,
    mutationOperationCount: 0,
    reviewedSourceRepositoryRootDigest:
      dependencyApproval.reviewedSourceRepositoryRootDigest,
  };
  const metadata = {
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    adapterContractVersion:
      PROVIDER_ADAPTER_METADATA.providerAdapterContractVersion,
    mockOnly: true,
    actualMutations: 0,
    mutationOperationCount: 0,
    unknownOperationCount: 0,
    providerOperationAllowlistVersion:
      operationExecution.providerOperationAllowlistVersion,
    providerOperationDescriptorSetDigest:
      operationExecution.providerOperationDescriptorSetDigest,
    executedOperationIds: [...operationExecution.executedOperationIds],
    executedOperationCount: operationExecution.executedOperationCount,
    executionTraceCount: operationExecution.executionTraceCount,
    executionTraceDigest: operationExecution.executionTraceDigest,
    reviewedSourceDigest:
      EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
    reviewedSourceRepositoryRootDigest:
      dependencyApproval.reviewedSourceRepositoryRootDigest,
    reviewedSourceIdentities:
      structuredClone(PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES),
  };
  return {
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    adapterContractVersion:
      PROVIDER_ADAPTER_METADATA.providerAdapterContractVersion,
    approvalReceipt,
    metadata,
    observation: {
      schemaVersion: PROVIDER_OBSERVATION_VERSION,
      providerObservationVersion: PROVIDER_OBSERVATION_VERSION,
      adapterId: APPROVED_PROVIDER_ADAPTER_ID,
      adapterContractVersion:
        PROVIDER_ADAPTER_METADATA.providerAdapterContractVersion,
      mockOnly: true,
      actualMutations: 0,
      mutationOperationCount: 0,
      unknownOperationCount: 0,
      scanStartedAt: RESOURCE_AT,
      scanCompletedAt: PROVIDER_OBSERVED_AT,
      observedAt: PROVIDER_OBSERVED_AT,
      projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
      projectId: EXPECTED_PROJECT_ID,
      projectNumber: EXPECTED_PROJECT_NUMBER,
      providerAdapterMetadata: structuredClone(PROVIDER_ADAPTER_METADATA),
      adapterMetadata: structuredClone(metadata),
      operationExecution,
      dependencyContract: {
        ...structuredClone(PROVIDER_ADAPTER_METADATA),
        schemaVersion: PROVIDER_DEPENDENCY_CONTRACT_VERSION,
        strategy: "declared_google_auth_library_rest",
        module: "google-auth-library",
        directDependencyReviewed: true,
        publicApiOnly: true,
        reviewedSourceDigest: dependencyApproval.reviewedSourceDigest,
      reviewedSourceRepositoryRootDigest:
        dependencyApproval.reviewedSourceRepositoryRootDigest,
        reviewedLockDigest: dependencyApproval.reviewedLockDigest,
        approvalLineageDigest: sha256Canonical(approvalReceipt),
      },
      rules: rulesObservation(),
      functions: functionsObservation(),
      iamPolicy: structuredClone(evidence.iamPolicy),
      scheduler: structuredClone(evidence.scheduler),
    },
  };
}

function mockProviderAdapter(evidence, mutate = () => {}) {
  const result = providerResultFor(evidence);
  mutate(result);
  return {
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    adapterContractVersion:
      PROVIDER_ADAPTER_METADATA.providerAdapterContractVersion,
    mockOnly: true,
    async observeDeployment() {
      await Promise.resolve();
      return result;
    },
  };
}

function resign(evidence) {
  evidence.artifactDigest = computeEvidenceArtifactDigest(evidence);
  return evidence;
}

let sharedProviderRuntimeContext;
function validate(evidence, callerSuppliedProviderResult) {
  if (callerSuppliedProviderResult !== undefined) {
    return validateWriteFreezeEvidence(evidence, {
      providerRuntimeContext: {
        ...sharedProviderRuntimeContext,
        providerResult: callerSuppliedProviderResult,
      },
    });
  }
  return validateWriteFreezeEvidence(evidence, {
    providerRuntimeContext: sharedProviderRuntimeContext,
  });
}

let sharedSyntheticRepositoryRoot;
function getSharedSyntheticRepository() {
  if (sharedSyntheticRepositoryRoot) return sharedSyntheticRepositoryRoot;
  sharedSyntheticRepositoryRoot = createSyntheticGitRepository({
    after() {},
  });
  process.once("exit", () => fs.rmSync(sharedSyntheticRepositoryRoot, {
    recursive: true,
    force: true,
  }));
  return sharedSyntheticRepositoryRoot;
}

async function genuineRuntimeFor(evidence, repositoryRoot) {
  repositoryRoot ??= getSharedSyntheticRepository();
  bindEvidenceToRepository(evidence, repositoryRoot);
  const providerAdapter =
    createGenuineAdapterForEvidence(evidence, repositoryRoot);
  const providerResult = await providerAdapter.observeDeployment();
  evidence.iamPolicy = structuredClone(providerResult.observation.iamPolicy);
  evidence.scheduler = structuredClone(providerResult.observation.scheduler);
  resign(evidence);
  const providerRuntimeContext = await createValidatedProviderRuntimeContext({
    providerAdapter,
    providerResult,
    repositoryRoot,
  });
  return {providerAdapter, providerResult, providerRuntimeContext};
}

async function genuineAdapterForVerifier(evidence, repositoryRoot) {
  const observationAdapter =
    createGenuineAdapterForEvidence(evidence, repositoryRoot);
  const observation = await observationAdapter.observeDeployment();
  evidence.iamPolicy = structuredClone(observation.observation.iamPolicy);
  evidence.scheduler = structuredClone(observation.observation.scheduler);
  resign(evidence);
  return createGenuineAdapterForEvidence(evidence, repositoryRoot);
}

function runGit(repositoryRoot, args) {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    shell: false,
  }).trim();
}

function createSyntheticGitRepository(context) {
  const repositoryRoot = fs.realpathSync(fs.mkdtempSync(
      path.join(os.tmpdir(), "academy-freeze-git-"),
  ));
  fs.chmodSync(repositoryRoot, 0o700);
  context.after(() =>
    fs.rmSync(repositoryRoot, {recursive: true, force: true}));
  runGit(repositoryRoot, ["init"]);
  runGit(repositoryRoot, ["config", "user.name", "Freeze Test"]);
  runGit(repositoryRoot, ["config", "user.email", "freeze@example.invalid"]);
  const fixturePaths = [...new Set([
    ...CRITICAL_RUNTIME_SOURCE_PATHS,
    ...PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.map(({path}) => path),
  ])];
  for (const relativePath of fixturePaths) {
    const source = path.join(sourceRepositoryRoot, relativePath);
    const destination = path.join(repositoryRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
    fs.copyFileSync(source, destination);
  }
  runGit(repositoryRoot, ["add", "--", ...fixturePaths]);
  runGit(repositoryRoot, ["commit", "-m", "fixture"]);
  return repositoryRoot;
}

function createExternalDirectory(context, prefix) {
  const directory = fs.realpathSync(fs.mkdtempSync(
      path.join(os.tmpdir(), prefix),
  ));
  fs.chmodSync(directory, 0o700);
  context.after(() =>
    fs.rmSync(directory, {recursive: true, force: true}));
  return directory;
}

function bindEvidenceToRepository(evidence, repositoryRoot) {
  const runtimeGit = resolveRuntimeGitSourceIdentity({repositoryRoot});
  evidence.release.sha = runtimeGit.headSha;
  evidence.release.runtimeGit = runtimeGit;
  evidence.deploymentApprovalReceipt.releaseSha = runtimeGit.headSha;
  const byPath = new Map(
      runtimeGit.criticalSources.map((source) => [source.path, source]),
  );
  evidence.deploymentApprovalReceipt.localSources.rulesSha256 =
    byPath.get("firestore.rules").headSha256;
  evidence.deploymentApprovalReceipt.localSources.functionsSha256 =
    byPath.get("functions/index.js").headSha256;
  evidence.deploymentApprovalReceipt.providerDependencyApproval
      .reviewedSourceRepositoryRootDigest = sha256Canonical({
        repositoryRoot: fs.realpathSync(repositoryRoot),
        schemaVersion: PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
      });
  return resign(evidence);
}

const sharedAttestedEvidence = unboundEvidenceFixture();
const sharedAttestedRuntime = await genuineRuntimeFor(sharedAttestedEvidence);
sharedProviderRuntimeContext =
  sharedAttestedRuntime.providerRuntimeContext;
function evidenceFixture() {
  return structuredClone(sharedAttestedEvidence);
}

function assertDeepFrozen(value, seen = new Set()) {
  if (!value ||
      typeof value !== "object" && typeof value !== "function" ||
      seen.has(value)) return;
  seen.add(value);
  assert.equal(Object.isFrozen(value), true);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) {
      assertDeepFrozen(descriptor.value, seen);
    }
  }
}

function deepFreezeFixture(value, seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    deepFreezeFixture(value[key], seen);
  }
  return Object.freeze(value);
}

function mutateRuntimeIamSourceProjection(mutate) {
  const evidence = evidenceFixture();
  assert.deepEqual(
      evidence.release.runtimeGit,
      sharedProviderRuntimeContext.runtimeGit,
  );
  const release = structuredClone(evidence.release);
  assert.doesNotThrow(() => validateReleaseForTest(release));
  release.runtimeGit.iamContractSourceIdentity = structuredClone(
      release.runtimeGit.iamContractSourceIdentity,
  );
  mutate(
      release.runtimeGit.iamContractSourceIdentity.sources,
      release.runtimeGit,
  );
  release.runtimeGit.iamContractSourceSetDigest = sha256Canonical(
      release.runtimeGit.iamContractSourceIdentity,
  );
  return release;
}

test("blocker K — Runtime IAM lineage uses exact four source bytes", () => {
  const runtimeGit = sharedAttestedEvidence.release.runtimeGit;
  const sources = runtimeGit.iamContractSourceIdentity.sources;
  assert.deepEqual(
      sources.map(({path: sourcePath}) => sourcePath),
      EXPECTED_RUNTIME_IAM_SOURCE_PATHS,
  );
  assert.equal(sources.length, 4);
  const reviewedPins = new Map(
      PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.map(
          ({path: sourcePath, sha256}) => [sourcePath, sha256],
      ),
  );
  for (const source of sources) {
    const actualSha256 = crypto.createHash("sha256")
        .update(fs.readFileSync(path.join(sourceRepositoryRoot, source.path)))
        .digest("hex");
    assert.equal(source.runtimeSha256, actualSha256, source.path);
    assert.equal(source.headSha256, actualSha256, source.path);
    assert.equal(reviewedPins.get(source.path), actualSha256, source.path);
  }
});

test("blocker L1 — missing Runtime IAM lineage source rejects", () => {
  const missing = mutateRuntimeIamSourceProjection(
      (sources) => sources.pop(),
  );
  assert.throws(() => validateReleaseForTest(missing), {
    message: "Write-freeze evidence rejected: runtime IAM contract source " +
      "records mismatch",
  });
});

test("blocker L2 — extra Runtime IAM lineage source rejects", () => {
  const extra = mutateRuntimeIamSourceProjection(
      (sources, runtimeGit) => sources.push(
          structuredClone(runtimeGit.criticalSources.find(
              ({path: sourcePath}) =>
                sourcePath ===
                  "functions/scripts/academy-reset-write-freeze-contract.mjs",
          )),
      ),
  );
  assert.throws(() => validateReleaseForTest(extra), {
    message: "Write-freeze evidence rejected: runtime IAM contract source " +
      "records mismatch",
  });
});

test("blocker M1 — same-count Runtime IAM source swap rejects", () => {
  const swapped = mutateRuntimeIamSourceProjection(
      (sources, runtimeGit) => {
        sources[sources.length - 1] = structuredClone(
            runtimeGit.criticalSources.find(({path: sourcePath}) =>
              sourcePath ===
                "functions/scripts/academy-reset-write-freeze-contract.mjs"),
        );
      },
  );
  assert.throws(() => validateReleaseForTest(swapped), {
    message: "Write-freeze evidence rejected: runtime IAM contract source " +
      "records mismatch",
  });
});

test("blocker M2 — stale Runtime IAM source digest rejects", () => {
  const stale = mutateRuntimeIamSourceProjection(
      (sources) => {
        sources.at(-1).runtimeSha256 = DIGEST_A;
        sources.at(-1).headSha256 = DIGEST_A;
      },
  );
  assert.throws(() => validateReleaseForTest(stale), {
    message: "Write-freeze evidence rejected: runtime IAM contract source " +
      "records mismatch",
  });
});

test("blocker N — runbooks use the exported Runtime IAM version", () => {
  const runtimeSource = fs.readFileSync(path.join(
      sourceRepositoryRoot,
      "functions/scripts/academy-private-runtime-iam-contract.mjs",
  ), "utf8");
  assert.match(
      runtimeSource,
      new RegExp(`\"${PRIVATE_RUNTIME_IAM_CONTRACT_VERSION}\"`),
  );
  for (const relativePath of [
    "docs/academy-reset-write-freeze-runbook.md",
    "docs/production-deploy-runbook.md",
  ]) {
    const runbook = fs.readFileSync(
        path.join(sourceRepositoryRoot, relativePath),
        "utf8",
    );
    assert.equal(
        runbook.includes(PRIVATE_RUNTIME_IAM_CONTRACT_VERSION),
        true,
    );
    const staleVersion = `academy_private_runtime_iam.v${8}`;
    const staleLabel = `local v${8} contract`;
    assert.equal(runbook.includes(staleVersion), false);
    assert.equal(runbook.includes(staleLabel), false);
  }
});

test("v6 Runtime IAM and Build scope lineage is mandatory and fail-closed",
    () => {
      const accepted = evidenceFixture();
      assert.doesNotThrow(() => validate(accepted));
      assert.equal(
          accepted.deploymentApprovalReceipt.runtimeIamActivationReceipt
              .toState,
          FREEZE_ACTIVE_STATE,
      );
      assert.equal(
          accepted.deploymentApprovalReceipt.freezeIamContractLineage
              .buildScopeContractDigest,
          BUILD_SCOPE_CONTRACT_DIGEST,
      );
      assert.equal(
          accepted.deploymentApprovalReceipt.freezeIamContractLineage
              .operatorModeContractVersion,
          OPERATOR_MODE_CONTRACT_VERSION,
      );
      assert.equal(
          accepted.deploymentApprovalReceipt.freezeIamContractLineage
              .operatorMode,
          THREE_PERSON_SEPARATION,
      );

      for (const mutate of [
        (evidence) => {
          delete evidence.deploymentApprovalReceipt.runtimeIamActivationReceipt;
        },
        (evidence) => {
          evidence.deploymentApprovalReceipt.runtimeIamActivationReceipt
              .after.principalPermissions.find(({member}) =>
                member.includes("academy-private-writer-runtime"))
              .permissions.push("datastore.entities.update");
        },
        (evidence) => {
          evidence.deploymentApprovalReceipt.freezeIamContractLineage
              .buildScopeContractDigest = DIGEST_A;
        },
        (evidence) => {
          evidence.deploymentApprovalReceipt.freezeIamContractLineage
              .operatorMode = "SINGLE_OPERATOR_JIT_V1";
        },
        (evidence) => {
          delete evidence.deploymentApprovalReceipt.organizationPolicyLineage;
        },
        (evidence) => {
          evidence.deploymentApprovalReceipt.organizationPolicyLineage
              .organizationPolicyEvidenceDigest = DIGEST_A;
        },
        (evidence) => {
          evidence.deploymentApprovalReceipt.runtimeIamActivationReceipt
              .organizationPolicyLineage
              .organizationPolicyEffectiveDecision = "ALLOW";
        },
        (evidence) => {
          evidence.deploymentApprovalReceipt.resources.functions.find(
              ({name}) => name === "createFixedPrivateLessonAssignment",
          ).runtimeServiceAccount =
            `serviceAccount:${EXPECTED_PROJECT_NUMBER}-compute@` +
            "developer.gserviceaccount.com";
        },
      ]) {
        const candidate = evidenceFixture();
        mutate(candidate);
        resign(candidate);
        assert.throws(() => validate(candidate));
      }
    });

test("operation classification and permission manifest bind exact 29+1 sets",
    () => {
      assert.equal(PROVIDER_MANDATORY_OPERATION_COUNT, 29);
      assert.equal(PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT, 1);
      assert.deepEqual(PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS, [
        "policytroubleshooter.v3.iam.troubleshoot",
      ]);
      assert.deepEqual(
          [...PROVIDER_MANDATORY_OPERATION_IDS,
            ...PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS].sort(),
          PROVIDER_OPERATION_IDS,
      );
      assert.deepEqual(
          READONLY_PERMISSION_OPERATION_IDS,
          PROVIDER_OPERATION_IDS,
      );
      assert.deepEqual(
          Object.keys(READONLY_PERMISSION_REGISTRY).sort(),
          Object.keys(PROVIDER_OPERATION_REGISTRY).sort(),
      );
      assert.equal(
          computeProviderOperationIdSetDigest(
              PROVIDER_MANDATORY_OPERATION_IDS,
          ),
          PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
      );
      assert.equal(
          computeProviderOperationIdSetDigest(
              PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
          ),
          PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
      );
      assert.equal(
          computeProviderOperationClassificationDigest(),
          PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
      );
      assert.equal(
          computeReadonlyPermissionManifestDigest(),
          READONLY_PERMISSION_MANIFEST_DIGEST,
      );
      assert.equal(READONLY_PERMISSION_RECORDS.length, 30);
      assert.doesNotThrow(() => assertProviderOperationClassification());
      assert.doesNotThrow(() => assertReadonlyPermissionManifest());
      assert.doesNotThrow(() =>
        assertEffectiveMandatoryPermissionContract());
      assert.deepEqual(
          computeEffectiveMandatoryPermissionContract(),
          EFFECTIVE_MANDATORY_PERMISSION_CONTRACT,
      );
      assert.equal(
          EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.contractDigest,
          EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
      );
      assert.equal(
          EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.mandatoryOperationCount,
          29,
      );
      assert.equal(
          EFFECTIVE_MANDATORY_PERMISSION_CONTRACT
              .optionalDiagnosticOperationCount,
          1,
      );
    });

test("coherent reclassification and manifest record tamper fail closed", () => {
  const removedMandatory = PROVIDER_MANDATORY_OPERATION_IDS[0];
  const optionalId = PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS[0];
  const reclassifiedMandatory = [
    ...PROVIDER_MANDATORY_OPERATION_IDS.slice(1),
    optionalId,
  ].sort();
  const reclassifiedOptional = [removedMandatory];
  const reclassified = deepFreezeFixture({
    ...structuredClone(PROVIDER_OPERATION_CLASSIFICATION),
    mandatoryOperationIds: reclassifiedMandatory,
    mandatoryOperationIdsDigest:
      computeProviderOperationIdSetDigest(reclassifiedMandatory),
    optionalDiagnosticOperationIds: reclassifiedOptional,
    optionalDiagnosticOperationIdsDigest:
      computeProviderOperationIdSetDigest(reclassifiedOptional),
  });
  assert.equal(reclassified.mandatoryOperationCount, 29);
  assert.equal(reclassified.optionalDiagnosticOperationCount, 1);
  assert.notEqual(
      computeProviderOperationClassificationDigest(reclassified),
      PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
  );
  assert.throws(
      () => assertProviderOperationClassification(reclassified),
      /classification|digest|membership/,
  );

  const tamperedRecords = structuredClone(READONLY_PERMISSION_RECORDS);
  const storage = tamperedRecords.find(
      ({operationId}) => operationId === "storage.v1.objects.getMetadata",
  );
  storage.requiredIamPermissions = ["storage.objects.list"];
  storage.reviewedContentDigest = sha256Canonical(
      convertPermissionRecordToReviewedEvidence(storage),
  );
  const tamperedRegistry = Object.create(null);
  for (const record of tamperedRecords) {
    tamperedRegistry[record.operationId] = deepFreezeFixture(record);
  }
  deepFreezeFixture(tamperedRegistry);
  const tamperedManifestDigest =
    computeReadonlyPermissionManifestDigest(tamperedRegistry);
  assert.notEqual(tamperedManifestDigest, READONLY_PERMISSION_MANIFEST_DIGEST);
  assert.throws(
      () => assertReadonlyPermissionManifest(
          tamperedRegistry,
          PROVIDER_OPERATION_REGISTRY,
          {manifestDigest: tamperedManifestDigest},
      ),
      /manifest|evidence|permission/,
  );
});

test("optional diagnostic absence and success cannot establish gates", () => {
  assert.equal(
      REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS.includes(
          PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS[0],
      ),
      false,
  );
  for (const status of ["omitted", "success"]) {
    const evaluation = evaluateOptionalDiagnostic({status});
    assert.equal(evaluation.mandatoryCompletenessUnaffected, true);
    assert.equal(evaluation.policyAnalysisComplete, false);
    assert.equal(evaluation.writeFreezeVerified, false);
    assert.equal(evaluation.executionEligible, false);
  }
});

test("public proof boundary requires the attested provider result reference",
    () => {
      const evidence = evidenceFixture();
      const genuineResult = sharedAttestedRuntime.providerResult;
      const genuineContext = sharedAttestedRuntime.providerRuntimeContext;
      assert.equal(genuineContext.providerResult, genuineResult);
      assertDeepFrozen(genuineResult);

      const claimedDigest = genuineResult.metadata.executionTraceDigest;
      assert.throws(() => {
        genuineResult.metadata.executionTraceDigest = DIGEST_B;
      }, TypeError);
      assert.throws(() => {
        genuineResult.observation.operationExecution.executionTrace.pop();
      }, TypeError);
      assert.equal(genuineResult.metadata.executionTraceDigest, claimedDigest);

      const coherentRedigestedForge = providerResultFor(evidence);
      const forgedExecution =
        coherentRedigestedForge.observation.operationExecution;
      forgedExecution.executionTrace[0].transportExecutionId =
        "coherently-redigested-forge";
      forgedExecution.executionTraceDigest =
        sha256Canonical(forgedExecution.executionTrace);
      coherentRedigestedForge.metadata.executionTraceDigest =
        forgedExecution.executionTraceDigest;
      coherentRedigestedForge.observation.adapterMetadata.executionTraceDigest =
        forgedExecution.executionTraceDigest;

      const claimedDigestTamper = structuredClone(genuineResult);
      claimedDigestTamper.metadata.executionTraceDigest = DIGEST_B;
      claimedDigestTamper.observation.adapterMetadata.executionTraceDigest =
        DIGEST_B;
      const rejectedResults = [
        ["plain coherent forge", providerResultFor(evidence)],
        ["structured clone", structuredClone(genuineResult)],
        ["spread clone", {...genuineResult}],
        ["JSON round trip", JSON.parse(JSON.stringify(genuineResult))],
        ["coherently re-digested forge", coherentRedigestedForge],
        ["claimed digest tamper", claimedDigestTamper],
      ];
      let rejectedProofCount = 0;
      for (const [label, providerResult] of rejectedResults) {
        assert.throws(
            () => validateWriteFreezeEvidence(evidence, {providerResult}),
            /validation options has unknown or missing fields/,
            label,
        );
        assert.throws(
            () => validateWriteFreezeEvidence(evidence, {
              providerRuntimeContext: {
                ...genuineContext,
                providerResult,
              },
            }),
            /genuine provider runtime context/,
            label,
        );
        assert.throws(
            () => {
              buildDeterministicWriteFreezeProof(evidence, {providerResult});
              rejectedProofCount += 1;
            },
            /validation options has unknown or missing fields/,
            label,
        );
      }

      for (const options of [
        {providerRuntimeContext: genuineContext,
          observation: genuineResult.observation},
        {providerRuntimeContext: genuineContext, genuine: true},
        {providerRuntimeContext: genuineContext, mockOnly: true},
      ]) {
        assert.throws(
            () => validateWriteFreezeEvidence(evidence, options),
            /validation options has unknown or missing fields/,
        );
        assert.throws(
            () => {
              buildDeterministicWriteFreezeProof(evidence, options);
              rejectedProofCount += 1;
            },
            /validation options has unknown or missing fields/,
        );
      }

      const calls = {credential: 0, mutation: 0, provider: 0};
      const capabilityShapedOptions = {
        credentialProvider() {
          calls.credential += 1;
        },
        mutation() {
          calls.mutation += 1;
        },
        providerAdapter: {
          observeDeployment() {
            calls.provider += 1;
            return providerResultFor(evidence);
          },
        },
        providerRuntimeContext: genuineContext,
      };
      assert.throws(
          () => buildDeterministicWriteFreezeProof(
              evidence,
              capabilityShapedOptions,
          ),
          /validation options has unknown or missing fields/,
      );
      assert.deepEqual(calls, {credential: 0, mutation: 0, provider: 0});
      assert.equal(rejectedProofCount, 0);

      assert.doesNotThrow(() => validateWriteFreezeEvidence(evidence, {
        providerRuntimeContext: genuineContext,
      }));
      const acceptedProof = buildDeterministicWriteFreezeProof(evidence, {
        providerRuntimeContext: genuineContext,
      });
      assert.equal(acceptedProof.writeFreezeVerified, true);
    });

test("valid provider-bound evidence produces deterministic proof", async () => {
  const evidence = evidenceFixture();
  const validation = validate(evidence);
  const {providerResult: genuineProviderResult, providerRuntimeContext} =
    await genuineRuntimeFor(evidence);
  assert.equal(validation.writerCount, 59);
  const first = buildDeterministicWriteFreezeProof(evidence, {
    providerRuntimeContext,
  });
  const second = buildDeterministicWriteFreezeProof(
      structuredClone(evidence),
      {providerRuntimeContext},
  );
  assert.deepEqual(first, second);
  assert.equal(first.writeFreezeVerified, true);
  assert.equal(first.schemaVersion, WRITE_FREEZE_PROOF_VERSION);
  assert.equal(
      first.writeSurfaceRegistryVersion,
      "academy_reset_write_surface.v2",
  );
  assert.equal(first.writeSurfaceRegistryVersion, WRITE_SURFACE_REGISTRY_VERSION);
  assert.equal(
      writeSurfaceIdentityDigest(ACADEMY_RESET_WRITE_SURFACE_REGISTRY),
      EXPECTED_WRITE_SURFACE_IDENTITY_DIGEST,
  );
  assert.equal(
      first.writeSurfaceRegistryDigest,
      sha256Canonical(ACADEMY_RESET_WRITE_SURFACE_REGISTRY),
  );
  assert.equal(first.writeSourceIdentityCount, 21);
  assert.equal(
      first.writeSourceIdentityDigest,
      EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
  );
  assert.equal(first.writerCount, 59);
  assert.equal(
      CRITICAL_RUNTIME_SOURCE_PATHS.filter(
          (sourcePath) =>
            sourcePath === "functions/academy-reset-write-freeze.js",
      ).length,
      1,
  );
  assert.deepEqual(first.unfreezeOrder, UNFREEZE_ORDER);
  assert.deepEqual(first.rollbackUnfreezeOrder, ROLLBACK_UNFREEZE_ORDER);
  assert.match(first.providerObservationDigest, /^[a-f0-9]{64}$/);
  assert.equal(
      first.providerObservationCompletedAt,
      genuineProviderResult.observation.observedAt,
  );
  assert.equal(first.latestDeploymentObservedAt, RESOURCE_AT);
  assert.equal(
      first.latestDeploymentScanCompletedAt,
      genuineProviderResult.observation.functions.completeness.scanCompletedAt,
  );
  assert.equal(
      first.approvedIamExpectedStateDigest,
      evidence.deploymentApprovalReceipt.resources
          .iamExpectedState.expectedStateDigest,
  );
  assert.deepEqual(
      first.approvedIamFamilyExpectations,
      evidence.deploymentApprovalReceipt.resources.iamExpectedState.families,
  );
  assert.equal(
      first.approvedIamExpectedItemCount,
      first.approvedIamFamilyExpectations.reduce(
          (total, family) => total + family.expectedCount,
          0,
      ),
  );
  assert.equal(first.deployedFunctionCount, 35);
  assert.equal(first.guardedFunctionExportCount, 26);
  assert.equal(first.actualMutations, 0);
  assert.equal(first.actualWrites, 0);
  assert.equal(first.executorImplemented, false);
  assert.equal(first.providerOperationAllowlistVersion,
      PROVIDER_ADAPTER_METADATA.providerOperationAllowlistVersion);
  assert.equal(first.providerOperationDescriptorSetDigest,
      PROVIDER_ADAPTER_METADATA.providerOperationDescriptorSetDigest);
  assert.equal(first.providerOperationClassificationVersion,
      PROVIDER_OPERATION_CLASSIFICATION_VERSION);
  assert.equal(first.providerOperationClassificationDigest,
      PROVIDER_OPERATION_CLASSIFICATION_DIGEST);
  assert.equal(first.providerMandatoryOperationCount, 29);
  assert.equal(first.providerOptionalDiagnosticOperationCount, 1);
  assert.equal(first.providerMandatoryOperationIdsDigest,
      PROVIDER_MANDATORY_OPERATION_IDS_DIGEST);
  assert.equal(first.providerOptionalDiagnosticOperationIdsDigest,
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST);
  assert.deepEqual(first.providerMandatoryOperationIds,
      PROVIDER_MANDATORY_OPERATION_IDS);
  assert.deepEqual(first.providerOptionalDiagnosticOperationIds,
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS);
  assert.equal(first.readonlyPermissionManifestVersion,
      READONLY_PERMISSION_MANIFEST_VERSION);
  assert.equal(first.readonlyPermissionManifestDigest,
      READONLY_PERMISSION_MANIFEST_DIGEST);
  assert.equal(first.readonlyPermissionOfficialEvidenceSetDigest,
      OFFICIAL_EVIDENCE_SET_DIGEST);
  assert.equal(first.readonlyPermissionReviewedEvidenceSetDigest,
      REVIEWED_EVIDENCE_SET_DIGEST);
  assert.equal(first.readonlyPermissionResearchArtifactSha256,
      PERMISSION_RESEARCH_ARTIFACT_SHA256);
  assert.equal(first.effectiveMandatoryPermissionContractDigest,
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST);
  assert.equal(first.topologyProfileDigest,
      STANDALONE_PROJECT_OBSERVER_PROFILE.profileDigest);
  assert.equal(first.topologyEvidenceDigest,
      STANDALONE_PROJECT_OBSERVER_PROFILE.topologyEvidenceDigest);
  assert.deepEqual(first.standaloneOperationExecution,
      STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution);
  assert.deepEqual(first.standaloneEffectivePermissions,
      STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions);
  assert.deepEqual(first.observerPrincipalPolicy,
      OBSERVER_PRINCIPAL_POLICY);
  assert.deepEqual(first.mandatoryRequiredIamPermissions,
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.requiredIamPermissions);
  assert.deepEqual(first.mandatoryConditionalPermissions,
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.conditionalPermissions);
  assert.deepEqual(first.mandatoryAuxiliaryPermissions,
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.auxiliaryPermissions);
  assert.deepEqual(first.mandatoryOauthScopes,
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.oauthScopes);
  assert.deepEqual(first.mandatoryPermissionSourceOperations,
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.sourceOperations);
  for (const runtimeKey of [
    "optionalDiagnosticExecutedOperationIds",
    "optionalDiagnosticExecutedOperationCount",
    "optionalDiagnosticCanEstablishWriteFreezeVerified",
    "optionalDiagnosticExecutionEligible",
    "optionalDiagnosticEvaluation",
  ]) {
    assert.equal(
        Object.hasOwn(first, runtimeKey),
        false,
        `${runtimeKey} must not enter mandatory proof bytes`,
    );
  }
  assert.equal(first.policyAnalysisSource, "mandatory_iam_raw_analysis");
  assert.equal(first.executionEligible, false);
  assert.equal(first.publicationEligible, false);
  assert.deepEqual(
      first.organizationPolicyLineage,
      buildOrganizationPolicyLineageReference(),
  );
  assert.deepEqual(first.approvedProviderOperationIds,
      PROVIDER_ADAPTER_METADATA.allowedOperations);
  assert.equal(first.providerTransport, PROVIDER_ADAPTER_METADATA.transport);
  assert.equal(first.providerAuthDependency,
      PROVIDER_ADAPTER_METADATA.authDependency);
  assert.equal(first.providerHttpRuntime,
      PROVIDER_ADAPTER_METADATA.httpRuntime);
  assert.equal(first.providerAdapterContractVersion,
      PROVIDER_ADAPTER_METADATA.providerAdapterContractVersion);
  assert.equal(first.noMutationOperationCount, 0);
  for (const gate of PROOF_GATE_KEYS) assert.equal(first[gate], true);
});

test("provider approval, observation metadata, result, and proof have parity",
    async () => {
      const evidence = evidenceFixture();
      const providerResult = providerResultFor(evidence);
      const approvalReceipt = evidence.deploymentApprovalReceipt;
      const approval = approvalReceipt.providerDependencyApproval;
      const observationMetadata =
        providerResult.observation.providerAdapterMetadata;
      const dependency = providerResult.observation.dependencyContract;
      for (const metadata of [approval, observationMetadata, dependency]) {
        for (const [key, expected] of
          Object.entries(PROVIDER_ADAPTER_METADATA)) {
          assert.deepEqual(metadata[key], expected, key);
        }
      }
      assert.equal(
          approval.providerOperationClassificationVersion,
          PROVIDER_OPERATION_CLASSIFICATION_VERSION,
      );
      assert.equal(approval.providerMandatoryOperationCount, 29);
      assert.equal(approval.providerOptionalDiagnosticOperationCount, 1);
      assert.equal(
          approval.readonlyPermissionManifestDigest,
          READONLY_PERMISSION_MANIFEST_DIGEST,
      );
      assert.deepEqual(
          approval.mandatoryPermissionSourceOperations,
          EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.sourceOperations,
      );
      assert.doesNotThrow(() =>
        validateProviderDependencyContract(dependency, approvalReceipt));

      for (const mutateDependency of [
        (candidate) => {
          delete candidate.providerOperationClassificationVersion;
        },
        (candidate) => {
          candidate.providerOperationClassificationDigest = DIGEST_B;
        },
        (candidate) => {
          candidate.readonlyPermissionManifestDigest = DIGEST_B;
        },
        (candidate) => {
          candidate.readonlyPermissionResearchArtifactSha256 = DIGEST_B;
        },
        (candidate) => {
          candidate.mandatoryRequiredIamPermissions[0] =
            "cloudasset.assets.sameCountTamper";
        },
        (candidate) => {
          candidate.mandatoryPermissionSourceOperations
              .requiredIamPermissions = {};
        },
        (candidate) => {
          candidate.topologyProfileDigest = DIGEST_B;
        },
        (candidate) => {
          candidate.observerPrincipalPolicy.email =
            "firebase-adminsdk-ab123@" +
            "daegu-miami-production.iam.gserviceaccount.com";
        },
      ]) {
        const candidate = structuredClone(dependency);
        mutateDependency(candidate);
        assert.throws(
            () => validateProviderDependencyContract(
                candidate,
                approvalReceipt,
            ),
            /provider|dependency|operation contract|unknown or missing fields/,
        );
      }
      const validation = validate(evidence);
      assert.deepEqual(
          validation.providerAdapterMetadata,
          PROVIDER_ADAPTER_METADATA,
      );
      const {providerRuntimeContext} = await genuineRuntimeFor(evidence);
      const proof = buildDeterministicWriteFreezeProof(evidence, {
        providerRuntimeContext,
      });
      const proofBody = structuredClone(proof);
      delete proofBody.proofDigest;
      assert.equal(proof.proofDigest, sha256Canonical(proofBody));
      proofBody.providerOperationDescriptorSetDigest = DIGEST_B;
      assert.notEqual(proof.proofDigest, sha256Canonical(proofBody));

      for (const mutate of [
        (candidate) => {
          candidate.deploymentApprovalReceipt.providerDependencyApproval
              .transport = "generic_fetch";
        },
        (candidate, result) => {
          result.observation.providerAdapterMetadata.authDependency =
            "google-auth-library@0.0.0";
        },
        (candidate, result) => {
          result.observation.dependencyContract
              .providerOperationDescriptorSetDigest = DIGEST_B;
        },
        (candidate, result) => {
          result.observation.dependencyContract.allowedOperations.pop();
        },
      ]) {
        const candidate = evidenceFixture();
        const result = providerResultFor(candidate);
        mutate(candidate, result);
        resign(candidate);
        assert.throws(
            () => validate(candidate, result),
            /provider|receipt|operation contract/,
        );
      }
    });

test("provider adapter and immutable resource receipt comparison fail closed", () => {
  const missingProvider = evidenceFixture();
  assert.throws(() => validateWriteFreezeEvidence(missingProvider),
      /validation options has unknown or missing fields/);
  const forgedResult = providerResultFor(missingProvider);
  assert.throws(() => validateWriteFreezeEvidence(missingProvider, {
    providerResult: forgedResult,
  }), /validation options has unknown or missing fields/);
  assert.throws(() => validateWriteFreezeEvidence(missingProvider, {
    providerRuntimeContext: {
      providerResult: structuredClone(forgedResult),
    },
  }), /genuine provider runtime context/);
  assert.throws(() => buildDeterministicWriteFreezeProof(missingProvider, {
    providerResult: structuredClone(forgedResult),
  }), /validation options has unknown or missing fields/);

  for (const mutate of [
    (result) => {
      result.adapterId = "unapproved.adapter";
    },
    (result) => {
      result.approvalReceipt.receiptId = DIGEST_B;
    },
    (result) => {
      result.observation.rules.rulesetName += "-stale";
    },
    (result) => {
      result.observation.functions.records[0].revisionId += "-stale";
    },
    (result) => {
      result.observation.functions.records.pop();
    },
    (result) => {
      result.observation.functions.records.push(
          {...result.observation.functions.records[0], name: "unknownFunction"},
      );
    },
  ]) {
    const evidence = evidenceFixture();
    const providerResult = providerResultFor(evidence);
    mutate(providerResult);
    assert.throws(
        () => validate(evidence, providerResult),
        /genuine provider runtime context/,
    );
  }

  const digestOnly = evidenceFixture();
  const result = providerResultFor(digestOnly);
  result.observation.rules.rulesetName = "arbitrary";
  assert.throws(
      () => validate(digestOnly, result),
      /genuine provider runtime context/,
  );
});

test("provider execution trace rejects unknown, duplicate, missing, and tamper",
    () => {
      const cases = [
        (result) => {
          const trace = result.observation.operationExecution.executionTrace;
          trace[0].operationId = "unknown.provider.operation";
          result.observation.operationExecution.executedOperationIds[0] =
            "unknown.provider.operation";
        },
        (result) => {
          const trace = result.observation.operationExecution.executionTrace;
          trace[1].transportExecutionId = trace[0].transportExecutionId;
        },
        (result) => {
          result.observation.operationExecution.executedOperationIds.pop();
        },
        (result) => {
          result.observation.operationExecution.executionTraceDigest =
            DIGEST_B;
        },
        (result) => {
          result.observation.operationExecution.actualMutations = 1;
        },
        (result) => {
          result.observation.operationExecution.executionTrace[0].mockOnly =
            false;
        },
      ];
      for (const mutate of cases) {
        const evidence = evidenceFixture();
        const result = providerResultFor(evidence);
        mutate(result);
        assert.throws(
            () => validate(evidence, result),
            /genuine provider runtime context/,
        );
      }
    });

test("provider completeness, dependency, lineage, and proof gates fail closed",
    async () => {
      const runtimeEvidence = evidenceFixture();
      const {providerRuntimeContext} =
        await genuineRuntimeFor(runtimeEvidence);
      for (const [mutate] of [
        [(result) => {
          result.observation.functions.completeness
              .nextPageTokenExhausted = false;
        }, /partial/],
        [(result) => {
          result.observation.rules.completeness.unreachableResources =
            ["projects/daegu-miami-production/rulesets/unreachable"];
        }, /unreachable/],
        [(result) => {
          result.observation.scheduler.completeness.stable = false;
        }, /unstable/],
        [(result) => {
          result.observation.functions.completeness.observedSetDigest =
            DIGEST_A;
        }, /canonical observed set/],
        [(result) => {
          delete result.observation.functions.triggerEvidence;
        }, /unknown or missing fields/],
        [(result) => {
          result.observation.functions.triggerEvidence = {
            ...result.observation.functions.triggerEvidence,
            triggerAbsenceEvidenceDigest: DIGEST_A,
          };
        }, /trigger absence evidence mismatch/],
        [(result) => {
          result.observation.functions.records[0].name =
            "same-count-foreign-function";
        }, /trigger absence evidence mismatch|deployed function/],
        [(result) => {
          const records = result.observation.functions.records;
          records[0].name = "coherent-same-count-foreign-function";
          result.observation.functions.triggerEvidence =
            buildFunctionTriggerAbsenceEvidence(records, records);
          result.observation.functions.completeness = completeness(records, {
            expectedCount: EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
            pageCount: 2,
          });
        }, /deployed function|approval lineage/],
        [(result) => {
          delete result.observation.functions.records[0].eventTriggerAbsent;
        }, /unknown or missing fields/],
        [(result) => {
          result.observation.dependencyContract.strategy =
            "firebase_cli_private";
        }, /dependency strategy/],
        [(result) => {
          result.observation.dependencyContract.directDependencyReviewed =
            false;
        }, /transitive/],
        [(result) => {
          result.observation.dependencyContract.reviewedSourceDigest =
            DIGEST_B;
        }, /source\/lock lineage|literal source pins/],
        [(result) => {
          result.observation.dependencyContract.allowedOperations.push(
              "cloudfunctions.functions.call",
          );
        }, /provider operation contract/],
      ]) {
        const evidence = evidenceFixture();
        const result = providerResultFor(evidence);
        mutate(result);
        assert.throws(
            () => validate(evidence, result),
            /genuine provider runtime context/,
        );
      }

      const missingLineage = evidenceFixture();
      delete missingLineage.deploymentApprovalReceipt
          .localSources.approvedRulesSourceDigest;
      resign(missingLineage);
      assert.throws(
          () => validate(missingLineage),
          /unknown or missing fields/,
      );

      for (const gate of PROOF_GATE_KEYS) {
        const rejected = structuredClone(runtimeEvidence);
        rejected.gateStates[gate] = false;
        resign(rejected);
        assert.throws(
            () => buildDeterministicWriteFreezeProof(rejected, {
              providerRuntimeContext,
            }),
            /self-reported proof gates differ/,
        );
      }
      const unknownGate = evidenceFixture();
      unknownGate.gateStates.unknown = true;
      resign(unknownGate);
      assert.throws(() => validate(unknownGate), /unknown or missing fields/);
    });

test("raw IAM rejects unknown identities, expansion, deny, and condition gaps",
    () => {
      const mutations = [
        [(iam) => {
          iam.bindings.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            inherited: false,
            member: "group:unknown@example.com",
            role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
            condition: null,
          });
        }, /unknown group/],
        [(iam) => {
          iam.bindings.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            inherited: false,
            member: "domain:unknown.example",
            role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
            condition: null,
          });
        }, /unknown user\/domain/],
        [(iam) => {
          iam.groupExpansions = [];
          iam.bindings.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            inherited: false,
            member:
              "group:academy-backend-readers@daegu-miami.com",
            role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
            condition: null,
          });
        }, /incomplete expansion/],
        [(iam) => {
          iam.bindings.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            inherited: false,
            member: "allUsers",
            role: REVIEWED_IAM_ROLE_DEFINITIONS[1].role,
            condition: null,
          });
        }, /write-capable binding/],
        [(iam) => {
          iam.roleDefinitions[0].permissionsComplete = false;
        }, /definition\/expansion is incomplete/],
        [(iam) => {
          iam.bindings[0].role =
            `projects/${EXPECTED_PROJECT_ID}/roles/unknown`;
        }, /unknown role/],
        [(iam) => {
          iam.roleDefinitions[0].permissions.push(
              "datastore.entities.unknown",
          );
        }, /unknown permission/],
        [(iam) => {
          iam.denyPolicies.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            policyName: "policies/deny-writes",
            updateTime: IAM_READ_ONLY_AT,
            rules: [{
              condition: null,
              deniedPermissions: ["datastore.entities.delete"],
              deniedPrincipals: [],
              exceptionPermissions: [],
              exceptionPrincipals: [],
            }],
          });
        }, /deny evaluation exact set mismatch/],
        [(iam) => {
          iam.bindings[0].condition = {
            title: "freeze",
            description: "must be evaluated",
            expression: "request.time < timestamp('2030-01-01T00:00:00Z')",
          };
        }, /unapproved conditional binding/],
      ];
      for (const [mutate] of mutations) {
        const evidence = evidenceFixture();
        const result = providerResultFor(evidence);
        mutate(result.observation.iamPolicy);
        assert.throws(
            () => validate(evidence, result),
            /genuine provider runtime context/,
        );
      }
    });

test("Functions runtime identities require approved active read-only members",
    () => {
      const evidence = evidenceFixture();
      const arbitrary =
        "serviceAccount:arbitrary-runtime@" +
        "daegu-miami-production.iam.gserviceaccount.com";
      evidence.deploymentApprovalReceipt.resources.functions.forEach((item) => {
        item.runtimeServiceAccount = arbitrary;
      });
      evidence.iamPolicy.runtimeServiceAccounts.forEach((item) => {
        item.member = arbitrary;
      });
      refreshIamObservation(
          evidence.iamPolicy,
          evidence.deploymentApprovalReceipt.resources.iamExpectedState,
      );
      resign(evidence);
      const result = providerResultFor(evidence);
      result.observation.functions.records.forEach((item) => {
        item.runtimeServiceAccount = arbitrary;
      });
      result.observation.functions.completeness = completeness(
          result.observation.functions.records,
          {
            expectedCount: EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
            pageCount: 2,
          },
      );
      assert.throws(
          () => validate(evidence, result),
          /genuine provider runtime context/,
      );
    });

test("IAM rejects every write role, condition, and unapproved attachment scope",
    () => {
      const cases = [
        [(iam) => {
          iam.bindings.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            inherited: false,
            member: FIXTURE_IAM_PRINCIPAL_ALLOWLIST[0].member,
            role: REVIEWED_IAM_ROLE_DEFINITIONS[1].role,
            condition: null,
          });
        }, /active or conditional write-capable/],
        [(iam) => {
          iam.bindings.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            inherited: false,
            member: FIXTURE_IAM_PRINCIPAL_ALLOWLIST[0].member,
            role: REVIEWED_IAM_ROLE_DEFINITIONS[1].role,
            condition: {
              title: "write-condition",
              description: "must not make writes acceptable",
              expression: "false",
            },
          });
        }, /unapproved conditional binding/],
        [(iam) => {
          iam.bindings.push({
            attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
            inherited: false,
            member: "group:academy-backend-readers@daegu-miami.com",
            role: REVIEWED_IAM_ROLE_DEFINITIONS[1].role,
            condition: null,
          });
        }, /active or conditional write-capable/],
        [(iam) => {
          iam.bindings[0].condition = {
            title: "read-condition",
            description: "snapshot is insufficient",
            expression: "true",
          };
        }, /unapproved conditional binding/],
        [(iam) => {
          iam.bindings[0].inherited = true;
        }, /inherited or foreign attachment scope/],
        [(iam) => {
          iam.bindings[0].attachmentPoint = "folders/123456";
        }, /inherited or foreign attachment scope/],
      ];
      for (const [mutate] of cases) {
        const evidence = evidenceFixture();
        const result = providerResultFor(evidence);
        mutate(result.observation.iamPolicy);
        assert.throws(
            () => validate(evidence, result),
            /genuine provider runtime context/,
        );
      }
    });

test("IAM family completeness requires exact family counts and digests", () => {
  for (const [mutate] of [
    [(coverage) => {
      coverage.families.find(({name}) => name === "bindings")
          .expectedCount += 1;
    }, /family completeness mismatch/],
    [(coverage) => {
      coverage.families.pop();
    }, /evidence family exact set mismatch/],
    [(coverage) => {
      coverage.familyDigest = DIGEST_A;
    }, /canonical digest mismatch/],
  ]) {
    const evidence = evidenceFixture();
    const result = providerResultFor(evidence);
    mutate(result.observation.iamPolicy.familyCompleteness);
    assert.throws(
        () => validate(evidence, result),
        /genuine provider runtime context/,
    );
  }
});

test("provider and scheduler scan chronology fail closed", () => {
  for (const [mutate] of [
    [(evidence, result) => {
      result.observation.rules.completeness.scanCompletedAt =
        atOffsetMinutes(-8.5);
    }, /deployment<=activatedAt/],
    [(evidence, result) => {
      result.observation.functions.completeness.scanCompletedAt =
        atOffsetMinutes(-8.5);
    }, /deployment<=activatedAt/],
    [(evidence, result) => {
      result.observation.observedAt = atOffsetMinutes(-4);
    }, /scan envelope|sub-observation scan completion/],
    [(evidence, result) => {
      result.observation.observedAt = atOffsetMinutes(-1);
    }, /provider observation/],
    [(evidence, result) => {
      result.observation.iamPolicy.observedAt = atOffsetMinutes(-3.6);
    }, /must equal completed exhaustive scan time/],
    [(evidence, result) => {
      result.observation.scheduler.jobs[0].updateTime =
        atOffsetMinutes(-6.5);
      result.observation.scheduler.completeness = completeness(
          result.observation.scheduler.jobs,
          {
            scanStartedAt: atOffsetMinutes(-7.2),
            scanCompletedAt: atOffsetMinutes(-6.4),
          },
      );
      evidence.scheduler =
        structuredClone(result.observation.scheduler);
      resign(evidence);
    }, /schedulerStoppedAt predates/],
    [(evidence, result) => {
      result.observation.scheduler.completeness.scanCompletedAt =
        atOffsetMinutes(-5.9);
      evidence.scheduler =
        structuredClone(result.observation.scheduler);
      resign(evidence);
    }, /schedulerStoppedAt predates|canonical observed set/],
    [(evidence) => {
      evidence.drainTelemetry.quietWindowStartedAt =
        atOffsetMinutes(-7);
      evidence.drainTelemetry.telemetryDigest =
        computeDrainTelemetryDigest(evidence.drainTelemetry);
      resign(evidence);
    }, /quiet window starts before scheduler scan/],
  ]) {
    const evidence = evidenceFixture();
    const result = providerResultFor(evidence);
    mutate(evidence, result);
    assert.throws(
        () => validate(evidence, result),
        /genuine provider runtime context/,
    );
  }
});

test("inactive executor binding and coherent IAM family omission are rejected",
    () => {
      const inactiveBinding = evidenceFixture();
      inactiveBinding.iamPolicy.bindings.push({
        attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
        inherited: false,
        member: FIXTURE_IAM_PRINCIPAL_ALLOWLIST.find(
            ({id}) => id === "future_reset_executor",
        ).member,
        role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
        condition: null,
      });
      refreshIamObservation(
          inactiveBinding.iamPolicy,
          inactiveBinding.deploymentApprovalReceipt.resources.iamExpectedState,
      );
      resign(inactiveBinding);
      assert.throws(
          () => validate(inactiveBinding),
          /inactive future reset executor has an active IAM binding|operator evidence differs/,
      );

      const groupDerivedBinding = evidenceFixture();
      const futureMember = FIXTURE_IAM_PRINCIPAL_ALLOWLIST.find(
          ({id}) => id === "future_reset_executor",
      ).member;
      const approvedGroup =
        groupDerivedBinding.iamPolicy.groupExpansions[0];
      approvedGroup.members = [futureMember];
      approvedGroup.paths = [{
        member: futureMember,
        path: [approvedGroup.group, futureMember],
      }];
      groupDerivedBinding.iamPolicy.bindings.push({
        attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
        inherited: false,
        member: approvedGroup.group,
        role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
        condition: null,
      });
      refreshIamObservation(
          groupDerivedBinding.iamPolicy,
          groupDerivedBinding.deploymentApprovalReceipt
              .resources.iamExpectedState,
      );
      resign(groupDerivedBinding);
      assert.throws(
          () => validate(groupDerivedBinding),
          /inactive future reset executor has an active IAM binding|operator evidence differs/,
      );

      const omittedFamilyItem = evidenceFixture();
      omittedFamilyItem.iamPolicy.groupExpansions.pop();
      refreshIamObservation(
          omittedFamilyItem.iamPolicy,
          omittedFamilyItem.deploymentApprovalReceipt
              .resources.iamExpectedState,
      );
      resign(omittedFamilyItem);
      assert.throws(
          () => validate(omittedFamilyItem),
          /IAM family completeness mismatch: groupExpansions|operator evidence differs/,
      );
    });

test("sentinel, probes, and future drain checkpoints use canonical timing",
    () => {
      const futureSentinel = evidenceFixture();
      const futureVersion = atOffsetMinutes(-1);
      futureSentinel.sentinel.capturedAt = futureVersion;
      futureSentinel.sentinel.version = futureVersion;
      futureSentinel.sentinel.snapshotDigest =
        computeSentinelSnapshotDigest(futureSentinel.sentinel);
      futureSentinel.negativeProbes.forEach((probe) => {
        probe.sentinelVersion = futureVersion;
        probe.evidenceDigest = computeNegativeProbeEvidenceDigest(probe);
      });
      resign(futureSentinel);
      assert.throws(
          () => validate(futureSentinel),
          /future or self-inconsistent/,
      );

      const sentinel = evidenceFixture();
      sentinel.sentinel.capturedAt = atOffsetMinutes(-7.9);
      sentinel.sentinel.version = sentinel.sentinel.capturedAt;
      resign(sentinel);
      assert.throws(() => validate(sentinel), /sentinel canonical snapshot/);

      const probe = evidenceFixture();
      probe.negativeProbes[0].observedAt = atOffsetMinutes(-2.9);
      resign(probe);
      assert.throws(() => validate(probe), /canonical evidence digest/);

      const futureCheckpoint = evidenceFixture();
      futureCheckpoint.drainTelemetry.checkpoints[0].checkpointAt =
        atOffsetMinutes(10);
      futureCheckpoint.drainTelemetry.telemetryDigest =
        computeDrainTelemetryDigest(futureCheckpoint.drainTelemetry);
      resign(futureCheckpoint);
      assert.throws(
          () => validate(futureCheckpoint),
          /nonzero, stale, or incomplete/,
      );
    });

test("drain telemetry rejects short, active, stale, and missing-class windows",
    () => {
      for (const [mutate, pattern] of [
        [(telemetry) => {
          telemetry.quietWindowEndedAt = atOffsetMinutes(-5);
        }, /quiet window/],
        [(telemetry) => {
          telemetry.quietWindowEndedAt = atOffsetMinutes(-1);
        }, /quiet window/],
        [(telemetry) => {
          telemetry.lastWriterIngressAt = atOffsetMinutes(-5);
        }, /ingress\/completion occurred/],
        [(telemetry) => {
          telemetry.checkpoints[0].ingressCountDuringQuietWindow = 1;
        }, /nonzero/],
        [(telemetry) => {
          telemetry.sentinelGeneration += 1;
        }, /stale sentinel generation/],
        [(telemetry) => {
          telemetry.checkpoints.pop();
        }, /writer class exact set mismatch/],
      ]) {
        const evidence = evidenceFixture();
        mutate(evidence.drainTelemetry);
        evidence.drainTelemetry.telemetryDigest =
          computeDrainTelemetryDigest(evidence.drainTelemetry);
        resign(evidence);
        assert.throws(() => validate(evidence), pattern);
      }
    });

test("Rules resources bind the exact pinned project and proof identity",
    async () => {
  const accepted = evidenceFixture();
  const {providerRuntimeContext: acceptedRuntimeContext} =
    await genuineRuntimeFor(accepted);
  const acceptedProof = buildDeterministicWriteFreezeProof(accepted, {
    providerRuntimeContext: acceptedRuntimeContext,
  });
  assert.equal(acceptedProof.rulesResourceIdentity.projectId,
      EXPECTED_PROJECT_ID);
  assert.equal(acceptedProof.rulesResourceIdentity.projectNumber,
      EXPECTED_PROJECT_NUMBER);
  assert.equal(
      acceptedProof.rulesResourceIdentity.rulesetResourceName,
      accepted.deploymentApprovalReceipt.resources.rules.rulesetName,
  );
  assert.equal(
      acceptedProof.rulesResourceIdentity.releaseResourceName,
      accepted.deploymentApprovalReceipt.resources.rules.releaseName,
  );

  for (const projectId of [
    "other-production-project",
    "daegu-miami-production-copy",
    EXPECTED_PROJECT_NUMBER,
  ]) {
    const coherentForeign = evidenceFixture();
    coherentForeign.deploymentApprovalReceipt.resources.rules.rulesetName =
      `projects/${projectId}/rulesets/ruleset-123`;
    coherentForeign.deploymentApprovalReceipt.resources.rules.releaseName =
      `projects/${projectId}/releases/cloud.firestore`;
    resign(coherentForeign);
    const coherentProvider = providerResultFor(coherentForeign);
    assert.throws(
        () => validate(coherentForeign, coherentProvider),
        /genuine provider runtime context/,
    );
  }

  const oneSurface = evidenceFixture();
  const oneSurfaceProvider = providerResultFor(oneSurface);
  oneSurfaceProvider.observation.rules.rulesetName =
    "projects/other-production-project/rulesets/ruleset-123";
  assert.throws(
      () => validate(oneSurface, oneSurfaceProvider),
      /genuine provider runtime context/,
  );

  const wrongProjectNumber = evidenceFixture();
  wrongProjectNumber.deploymentApprovalReceipt.resources.projectNumber =
    "999999999999";
  resign(wrongProjectNumber);
  assert.throws(
      () => validate(wrongProjectNumber, providerResultFor(wrongProjectNumber)),
      /genuine provider runtime context/,
  );

  for (const mutate of [
    (rules) => {
      rules.rulesetName = "";
    },
    (rules) => {
      delete rules.releaseName;
    },
    (rules) => {
      rules.rulesetName = "rulesets/ruleset-123";
    },
    (rules) => {
      rules.releaseName =
        `projects/${EXPECTED_PROJECT_ID}/releases/other-release`;
    },
  ]) {
    const malformed = evidenceFixture();
    mutate(malformed.deploymentApprovalReceipt.resources.rules);
    resign(malformed);
    assert.throws(
        () => validate(malformed, providerResultFor(malformed)),
        /genuine provider runtime context/,
    );
  }

  const resourceMismatch = evidenceFixture();
  const mismatchedProvider = providerResultFor(resourceMismatch);
  mismatchedProvider.observation.rules.rulesetName =
    `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-456`;
  assert.throws(
      () => validate(resourceMismatch, mismatchedProvider),
      /genuine provider runtime context/,
  );

  const changedIdentity = evidenceFixture();
  changedIdentity.deploymentApprovalReceipt.resources.rules.rulesetName =
    `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-456`;
  resign(changedIdentity);
  const changedProvider = providerResultFor(changedIdentity);
  changedProvider.observation.rules.rulesetName =
    `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-456`;
  const changedRulesItem = {...changedProvider.observation.rules};
  delete changedRulesItem.completeness;
  changedProvider.observation.rules.completeness =
    completeness([changedRulesItem]);
  const {providerRuntimeContext: changedRuntimeContext} =
    await genuineRuntimeFor(changedIdentity);
  const changedProof = buildDeterministicWriteFreezeProof(changedIdentity, {
    providerRuntimeContext: changedRuntimeContext,
  });
  assert.notEqual(changedProof.proofDigest, acceptedProof.proofDigest);
  assert.equal(changedProof.rulesResourceIdentity.rulesetId, "ruleset-456");
});

test("IAM uses centralized exact members, roles, permissions, and disposition", () => {
  for (const mutate of [
    (principal) => {
      principal.member =
        "serviceAccount:999999999999-compute@developer.gserviceaccount.com";
    },
    (principal) => {
      principal.semanticRole = "unknown_role";
    },
    (principal) => {
      principal.disposition = "ACTIVE";
    },
    (principal) => {
      principal.effectivePermissions.push("datastore.entities.update");
    },
    (principal) => {
      principal.authPermissions.push("firebaseauth.users.update");
    },
  ]) {
    const evidence = evidenceFixture();
    mutate(evidence.iamPolicy.principals[0]);
    resign(evidence);
    assert.throws(
        () => validate(evidence),
        /IAM principal|exact set|snapshot digest|policy digest|operator evidence differs/,
    );
  }
  const duplicate = evidenceFixture();
  duplicate.iamPolicy.principals[1] =
    structuredClone(duplicate.iamPolicy.principals[0]);
  resign(duplicate);
  assert.throws(
      () => validate(duplicate),
      /IAM principal exact set mismatch|snapshot digest|operator evidence differs/,
  );

  const unknown = evidenceFixture();
  unknown.iamPolicy.principals[0].id = "unknown_backend";
  resign(unknown);
  assert.throws(
      () => validate(unknown),
      /unknown principal|operator evidence differs/,
  );

  const duplicateMember = evidenceFixture();
  duplicateMember.iamPolicy.principals[1].member =
    duplicateMember.iamPolicy.principals[0].member;
  resign(duplicateMember);
  assert.throws(
      () => validate(duplicateMember),
      /duplicate full members|snapshot digest|operator evidence differs/,
  );

  const receiptMemberMismatch = evidenceFixture();
  const receiptProviderResult = providerResultFor(receiptMemberMismatch);
  receiptMemberMismatch.deploymentApprovalReceipt
      .iamPrincipalAllowlist[0].member =
        "serviceAccount:999999999999-compute@" +
        "developer.gserviceaccount.com";
  resign(receiptMemberMismatch);
  assert.throws(
      () => validate(receiptMemberMismatch, receiptProviderResult),
      /genuine provider runtime context/,
  );

  const providerMemberMismatch = evidenceFixture();
  const mismatchedProviderResult = providerResultFor(providerMemberMismatch);
  mismatchedProviderResult.observation.iamPolicy.principals[0].member =
    "serviceAccount:999999999999-compute@" +
    "developer.gserviceaccount.com";
  assert.throws(
      () => validate(providerMemberMismatch, mismatchedProviderResult),
      /genuine provider runtime context/,
  );
});

test("pinned Production project identity rejects every IAM substitution",
    async () => {
  const accepted = evidenceFixture();
  const acceptedProvider = providerResultFor(accepted);
  assert.doesNotThrow(() => validate(accepted));

  function setComputeMemberOnEverySurface(evidence, providerResult, member) {
    evidence.deploymentApprovalReceipt.iamPrincipalAllowlist[0].member = member;
    evidence.iamPolicy.principals[0].member = member;
    providerResult.approvalReceipt.iamPrincipalAllowlist[0].member = member;
    providerResult.observation.iamPolicy.principals[0].member = member;
    resign(evidence);
  }

  for (const member of [
    "serviceAccount:999999999999-compute@developer.gserviceaccount.com",
    `serviceAccount:${EXPECTED_PROJECT_NUMBER}-compute@wrong.example.com`,
  ]) {
    const evidence = evidenceFixture();
    const providerResult = providerResultFor(evidence);
    setComputeMemberOnEverySurface(evidence, providerResult, member);
    assert.throws(
        () => validate(evidence, providerResult),
        /genuine provider runtime context/,
    );
  }

  const oneSurface = evidenceFixture();
  oneSurface.iamPolicy.principals[0].member =
    "serviceAccount:999999999999-compute@developer.gserviceaccount.com";
  resign(oneSurface);
  assert.throws(
      () => validate(oneSurface),
      /pinned project number|operator evidence differs/,
  );

  const substitutedIdentity = evidenceFixture();
  const substitutedProvider = providerResultFor(substitutedIdentity);
  for (const value of [
    substitutedIdentity,
    substitutedIdentity.deploymentApprovalReceipt,
    substitutedIdentity.deploymentApprovalReceipt.resources,
    substitutedProvider.approvalReceipt,
    substitutedProvider.approvalReceipt.resources,
    substitutedProvider.observation,
  ]) {
    value.projectId = "other-production-project";
    value.projectNumber = "999999999999";
  }
  setComputeMemberOnEverySurface(
      substitutedIdentity,
      substitutedProvider,
      "serviceAccount:999999999999-compute@developer.gserviceaccount.com",
  );
  assert.throws(
      () => validate(substitutedIdentity, substitutedProvider),
      /genuine provider runtime context/,
  );

  for (const mutateIdentity of [
    (value) => {
      delete value.projectNumber;
    },
    (value) => {
      value.projectNumber = null;
    },
    (value) => {
      value.projectNumber = Number(EXPECTED_PROJECT_NUMBER);
    },
  ]) {
    const invalidIdentity = evidenceFixture();
    const invalidProvider = providerResultFor(invalidIdentity);
    mutateIdentity(invalidIdentity);
    resign(invalidIdentity);
    assert.throws(
        () => validate(invalidIdentity, invalidProvider),
        /genuine provider runtime context/,
    );
  }

  const unknown = evidenceFixture();
  unknown.iamPolicy.principals[0].id = "unknown_backend";
  resign(unknown);
  assert.throws(
      () => validate(unknown),
      /unknown principal|operator evidence differs/,
  );

  const writable = evidenceFixture();
  writable.iamPolicy.principals[0].effectivePermissions.push(
      "datastore.entities.update",
  );
  resign(writable);
  assert.throws(
      () => validate(writable),
      /exact set|snapshot digest|operator evidence differs/,
  );

  const {providerRuntimeContext} = await genuineRuntimeFor(accepted);
  const proof = buildDeterministicWriteFreezeProof(accepted, {
    providerRuntimeContext,
  });
  assert.deepEqual(TARGET_PROJECT_IDENTITY, {
    projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
    targetProjectId: EXPECTED_PROJECT_ID,
    targetProjectNumber: EXPECTED_PROJECT_NUMBER,
  });
  assert.equal(proof.projectNumber, EXPECTED_PROJECT_NUMBER);
  assert.equal(proof.principalPolicyVersion, IAM_PRINCIPAL_POLICY_VERSION);
  assert.equal(proof.expectedIamPrincipals[0].member,
      `serviceAccount:${EXPECTED_PROJECT_NUMBER}-compute@` +
      "developer.gserviceaccount.com");
  assert.deepEqual(proof.observedIamPrincipals, proof.expectedIamPrincipals);
  const proofBody = structuredClone(proof);
  delete proofBody.proofDigest;
  assert.equal(proof.proofDigest, sha256Canonical(proofBody));
  proofBody.projectNumber = "999999999999";
  assert.notEqual(proof.proofDigest, sha256Canonical(proofBody));
});

test("scheduler allowlist rejects unknown disabled jobs and wrong targets", () => {
  const unknown = evidenceFixture();
  unknown.scheduler.jobs.push({
    ...unknown.scheduler.jobs[0],
    name: "unknownDisabledWriter",
  });
  resign(unknown);
  assert.throws(
      () => validate(unknown),
      /unknown scheduler job|operator evidence differs/,
  );

  for (const field of ["projectId", "region", "target"]) {
    const wrong = evidenceFixture();
    wrong.scheduler.jobs[0][field] = `wrong-${field}`;
    resign(wrong);
    assert.throws(
        () => validate(wrong),
        /unknown scheduler job or target|operator evidence differs/,
    );
  }
  const inFlight = evidenceFixture();
  inFlight.drainTelemetry.checkpoints[0].inFlightExecutions = 1;
  inFlight.drainTelemetry.telemetryDigest =
    computeDrainTelemetryDigest(inFlight.drainTelemetry);
  resign(inFlight);
  assert.throws(() => validate(inFlight), /nonzero/);
});

test("activation order is deployment through probes and verifiedAt", () => {
  const cases = [
    (evidence) => {
      evidence.drainTelemetry.schedulerStoppedAt = atOffsetMinutes(-9);
      evidence.drainTelemetry.telemetryDigest =
        computeDrainTelemetryDigest(evidence.drainTelemetry);
    },
    (evidence) => {
      evidence.drainTelemetry.quietWindowEndedAt = atOffsetMinutes(-5.5);
      evidence.drainTelemetry.telemetryDigest =
        computeDrainTelemetryDigest(evidence.drainTelemetry);
    },
    (evidence) => {
      evidence.iamPolicy.observedAt = atOffsetMinutes(-7);
      evidence.iamPolicy.completeness.scanStartedAt =
        atOffsetMinutes(-7.5);
      evidence.iamPolicy.completeness.scanCompletedAt =
        atOffsetMinutes(-7);
      refreshIamObservation(
          evidence.iamPolicy,
          evidence.deploymentApprovalReceipt.resources.iamExpectedState,
      );
    },
    (evidence) => {
      evidence.negativeProbes[0].observedAt = atOffsetMinutes(-6);
      evidence.negativeProbes[0].evidenceDigest =
        computeNegativeProbeEvidenceDigest(evidence.negativeProbes[0]);
    },
  ];
  for (const mutate of cases) {
    const evidence = evidenceFixture();
    mutate(evidence);
    resign(evidence);
    assert.throws(
        () => validate(evidence),
        /activation order|quiet window|schedulerStoppedAt|operator evidence differs/,
    );
  }
  const staleDeployment = evidenceFixture();
  const providerResult = providerResultFor(staleDeployment);
  providerResult.observation.observedAt = atOffsetMinutes(-7);
  assert.throws(
      () => validate(staleDeployment, providerResult),
      /genuine provider runtime context/,
  );
  const oldObservation = evidenceFixture();
  const oldProviderResult = providerResultFor(oldObservation);
  oldProviderResult.observation.observedAt = atOffsetMinutes(-70);
  assert.throws(
      () => validate(oldObservation, oldProviderResult),
      /genuine provider runtime context/,
  );
});

test("provider-observed activation chronology is exact and proof-bound",
    async () => {
  const accepted = evidenceFixture();
  const {providerRuntimeContext} = await genuineRuntimeFor(accepted);
  const acceptedProof = buildDeterministicWriteFreezeProof(accepted, {
    providerRuntimeContext,
  });
  assert.equal(
      acceptedProof.latestDeploymentObservedAt,
      RESOURCE_AT,
  );
  assert.equal(
      acceptedProof.activationChronology.activatedAt,
      accepted.freezeWindow.activatedAt,
  );

  const activationBeforeDeployment = evidenceFixture();
  activationBeforeDeployment.freezeWindow.activatedAt = atOffsetMinutes(-13);
  resign(activationBeforeDeployment);
  assert.throws(
      () => validate(
          activationBeforeDeployment,
          providerResultFor(activationBeforeDeployment),
      ),
      /genuine provider runtime context/,
  );

  const laterFunctionDeployment = evidenceFixture();
  laterFunctionDeployment.deploymentApprovalReceipt
      .resources.functions[0].updateTime = atOffsetMinutes(-8.5);
  resign(laterFunctionDeployment);
  const laterFunctionProvider = providerResultFor(laterFunctionDeployment);
  laterFunctionProvider.observation.functions.records[0].updateTime =
    atOffsetMinutes(-8.5);
  laterFunctionProvider.observation.functions.completeness = completeness(
      laterFunctionProvider.observation.functions.records,
      {
        expectedCount: EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
        pageCount: 2,
        scanCompletedAt: atOffsetMinutes(-8.4),
      },
  );
  assert.throws(
      () => validate(laterFunctionDeployment, laterFunctionProvider),
      /genuine provider runtime context/,
  );

  const activationAfterSentinel = evidenceFixture();
  activationAfterSentinel.freezeWindow.activatedAt = atOffsetMinutes(-7);
  resign(activationAfterSentinel);
  assert.throws(
      () => validate(
          activationAfterSentinel,
          providerResultFor(activationAfterSentinel),
      ),
      /genuine provider runtime context/,
  );

  for (const mutate of [
    (evidence) => {
      delete evidence.freezeWindow.activatedAt;
    },
    (evidence) => {
      evidence.freezeWindow.activatedAt = "not-a-timestamp";
    },
  ]) {
    const invalidTimestamp = evidenceFixture();
    mutate(invalidTimestamp);
    resign(invalidTimestamp);
    assert.throws(
        () => validate(invalidTimestamp, providerResultFor(invalidTimestamp)),
        /genuine provider runtime context/,
    );
  }

  const providerLaterThanActivation = evidenceFixture();
  const laterProvider = providerResultFor(providerLaterThanActivation);
  laterProvider.observation.observedAt = atOffsetMinutes(-2.5);
  assert.throws(
      () => validate(providerLaterThanActivation, laterProvider),
      /genuine provider runtime context/,
  );

  const shiftedActivation = structuredClone(accepted);
  shiftedActivation.freezeWindow.activatedAt = atOffsetMinutes(-8.5);
  resign(shiftedActivation);
  const shiftedProof = buildDeterministicWriteFreezeProof(shiftedActivation, {
    providerRuntimeContext,
  });
  assert.notEqual(shiftedProof.proofDigest, acceptedProof.proofDigest);
  assert.notDeepEqual(
      shiftedProof.activationChronology,
      acceptedProof.activationChronology,
  );
});

test("integrated chronology A-H uses exact nanoseconds and exclusive expiry",
    async () => {
      const accepted = evidenceFixture();
      const acceptedRuntime = await genuineRuntimeFor(accepted);
      const acceptedValidation = validateWriteFreezeEvidence(accepted, {
        providerRuntimeContext: acceptedRuntime.providerRuntimeContext,
      });
      assert.match(
          acceptedValidation.activationChronology
              .exactNanosecondChronologyDigest,
          /^[0-9a-f]{64}$/,
      );

      const equalExpiry = evidenceFixture();
      equalExpiry.verifiedAt = equalExpiry.freezeWindow.expiresAt;
      resign(equalExpiry);
      const equalRuntime = await genuineRuntimeFor(equalExpiry);
      assert.throws(
          () => validateWriteFreezeEvidence(equalExpiry, {
            providerRuntimeContext: equalRuntime.providerRuntimeContext,
          }),
          /freeze window/,
      );

      const oneNanosecondBeforeExpiry = evidenceFixture();
      oneNanosecondBeforeExpiry.verifiedAt =
        oneNanosecondBefore(oneNanosecondBeforeExpiry.freezeWindow.expiresAt);
      resign(oneNanosecondBeforeExpiry);
      const nearExpiryRuntime =
        await genuineRuntimeFor(oneNanosecondBeforeExpiry);
      assert.doesNotThrow(() => validateWriteFreezeEvidence(
          oneNanosecondBeforeExpiry,
          {
            currentTimestamp: oneNanosecondBeforeExpiry.verifiedAt,
            providerRuntimeContext: nearExpiryRuntime.providerRuntimeContext,
          },
      ));

      const invertedRuntimeIam = evidenceFixture();
      const activationReceipt =
        invertedRuntimeIam.deploymentApprovalReceipt
            .runtimeIamActivationReceipt;
      activationReceipt.observedAt =
        oneNanosecondAfter(IAM_READ_ONLY_AT);
      assert.equal(compareExactRfc3339UtcInstants(
          activationReceipt.observedAt,
          IAM_READ_ONLY_AT,
      ), 1);
      activationReceipt.exactChronologyDigest =
        buildTransitionReceiptChronologyDigest(
            activationReceipt,
            invertedRuntimeIam.deploymentApprovalReceipt
                .runtimeIamActivationApproval,
        );
      resign(invertedRuntimeIam);
      const invertedRuntime = await genuineRuntimeFor(invertedRuntimeIam);
      assert.throws(
          () => validateWriteFreezeEvidence(invertedRuntimeIam, {
            providerRuntimeContext: invertedRuntime.providerRuntimeContext,
          }),
          /activation order/,
      );

      const fourDigits = evidenceFixture();
      fourDigits.freezeWindow.activatedAt =
        fourDigits.freezeWindow.activatedAt.replace(
            /\.(\d{3})Z$/,
            (_, milliseconds) => `.${milliseconds}0Z`,
        );
      resign(fourDigits);
      const fourDigitRuntime = await genuineRuntimeFor(fourDigits);
      assert.doesNotThrow(() => validateWriteFreezeEvidence(fourDigits, {
        providerRuntimeContext: fourDigitRuntime.providerRuntimeContext,
      }));

      const tooPrecise = evidenceFixture();
      tooPrecise.freezeWindow.activatedAt =
        tooPrecise.freezeWindow.activatedAt.replace(
            /\.(\d{3})Z$/,
            (_, milliseconds) => `.${milliseconds}0000000Z`,
        );
      resign(tooPrecise);
      assert.throws(
          () => validateWriteFreezeEvidence(tooPrecise, {
            providerRuntimeContext: acceptedRuntime.providerRuntimeContext,
          }),
          /exact RFC3339 UTC/,
      );
    });

test("nine probes bind exact provider, entrypoint, sentinel, project, academy", () => {
  assert.equal(REQUIRED_NEGATIVE_PROBES.length, 9);
  for (const [field, value] of [
    ["provider", "unknown.googleapis.com"],
    ["entrypoint", "wrongEntrypoint"],
    ["sentinelGeneration", SENTINEL_GENERATION + 1],
    ["sentinelVersion", atOffsetMinutes(-1)],
    ["targetProjectId", "other-project"],
    ["targetAcademyId", "other-academy"],
  ]) {
    const evidence = evidenceFixture();
    evidence.negativeProbes[0][field] = value;
    resign(evidence);
    assert.throws(() => validate(evidence), /negative probe/);
  }
});

test("canonical JSON, tamper, baseline, and source pins fail closed", () => {
  const sparse = Array(2);
  assert.throws(() => assertCanonicalJsonShape(sparse), /dense array/);
  assert.throws(() => stableStringify({value: undefined}), /unsupported/);

  const tampered = evidenceFixture();
  tampered.sentinel.snapshotDigest = DIGEST_B;
  assert.throws(() => validate(tampered), /tamper detected/);

  const baseline = evidenceFixture();
  baseline.baselineComparison.digest = DIGEST_A;
  resign(baseline);
  assert.throws(() => validate(baseline), /required exact baseline/);

  const pin = evidenceFixture();
  const writer = pin.release.runtimeGit.criticalSources.find(
      ({path: sourcePath}) => sourcePath === "functions/index.js",
  );
  writer.runtimeSha256 = DIGEST_A;
  writer.headSha256 = DIGEST_A;
  pin.deploymentApprovalReceipt.localSources.functionsSha256 = DIGEST_A;
  resign(pin);
  assert.throws(() => validate(pin), /literal pin|runtime Git/);
});

test("local Git binds all 21 pinned sources as regular unskipped HEAD blobs",
    (context) => {
      const repositoryRoot = createSyntheticGitRepository(context);
      const runtimeGit = resolveRuntimeGitSourceIdentity({repositoryRoot});
      const writerPaths = new Set(
          WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile}) => sourceFile),
      );
      const boundWriters = runtimeGit.criticalSources.filter(({path}) =>
        writerPaths.has(path));
      assert.equal(boundWriters.length, 21);
      for (const source of boundWriters) {
        assert.equal(source.fileMode === "100644" ||
          source.fileMode === "100755", true);
        assert.equal(source.indexFlags, "H");
        assert.equal(source.runtimeSha256, source.headSha256);
      }
    });

test("Git binding rejects dirty, skip-worktree, assume-unchanged, and pin drift",
    async (context) => {
      for (const [name, action, pattern] of [
        ["dirty", (root) =>
          fs.appendFileSync(path.join(root, "functions/index.js"), "dirty\n"),
        /dirty|bytes differ/],
        ["skip-worktree", (root) => runGit(root, [
          "update-index", "--skip-worktree", "functions/index.js",
        ]), /unsafe index flags/],
        ["assume-unchanged", (root) => runGit(root, [
          "update-index", "--assume-unchanged", "functions/index.js",
        ]), /unsafe index flags/],
        ["pin-drift", (root) => {
          fs.appendFileSync(path.join(root, "functions/index.js"), "drift\n");
          runGit(root, ["add", "functions/index.js"]);
          runGit(root, ["commit", "-m", "drift"]);
        }, /differs from pin/],
      ]) {
        await context.test(name, (child) => {
          const repositoryRoot = createSyntheticGitRepository(child);
          action(repositoryRoot);
          assert.throws(
              () => resolveRuntimeGitSourceIdentity({repositoryRoot}),
              pattern,
          );
        });
      }
    });

test("programmatic verifier requires mock provider; CLI without adapter refuses",
    async (context) => {
      const repositoryRoot = createSyntheticGitRepository(context);
      const external = createExternalDirectory(context, "academy-freeze-output-");
      const evidence = bindEvidenceToRepository(
          evidenceFixture(),
          repositoryRoot,
      );
      const evidencePath = path.join(external, "evidence.json");
      const outputPath = path.join(external, "proof.json");
      const providerAdapter =
        await genuineAdapterForVerifier(evidence, repositoryRoot);
      fs.writeFileSync(evidencePath, JSON.stringify(evidence), {mode: 0o600});
      const result = await verifyLocalWriteFreezeEvidence({
        evidencePath,
        outputPath,
        repositoryRoot,
        providerAdapter,
      });
      assert.equal(result.proof.writeFreezeVerified, true);
      assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
      await assert.rejects(
          executeVerifierCli([
            "--evidence", evidencePath,
            "--output", path.join(external, "cli-proof.json"),
          ]),
          /no Production provider adapter/,
      );
    });

test("proof boundary rejects duck adapter before observation", async (context) => {
  const repositoryRoot = createSyntheticGitRepository(context);
  const external = createExternalDirectory(context, "academy-freeze-await-");
  const evidence = bindEvidenceToRepository(evidenceFixture(), repositoryRoot);
  const evidencePath = path.join(external, "evidence.json");
  const outputPath = path.join(external, "proof.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence), {mode: 0o600});
  let observed = false;
  await assert.rejects(verifyLocalWriteFreezeEvidence({
    evidencePath,
    outputPath,
    repositoryRoot,
    providerAdapter: {
      adapterId: APPROVED_PROVIDER_ADAPTER_ID,
      adapterContractVersion:
        PROVIDER_ADAPTER_METADATA.providerAdapterContractVersion,
      mockOnly: true,
      async observeDeployment() {
        observed = true;
        return providerResultFor(evidence);
      },
    },
  }), /genuine approved mock provider adapter/);
  assert.equal(observed, false);
  assert.equal(fs.existsSync(outputPath), false);
});

test("proof boundary rejects adapter from a different repository root",
    async (context) => {
      const firstRoot = createSyntheticGitRepository(context);
      const secondRoot = createSyntheticGitRepository(context);
      const firstEvidence =
        bindEvidenceToRepository(evidenceFixture(), firstRoot);
      const secondEvidence =
        bindEvidenceToRepository(evidenceFixture(), secondRoot);
      const providerAdapter =
        createGenuineAdapterForEvidence(firstEvidence, firstRoot);
      const external =
        createExternalDirectory(context, "academy-freeze-root-mismatch-");
      const evidencePath = path.join(external, "evidence.json");
      fs.writeFileSync(
          evidencePath,
          JSON.stringify(secondEvidence),
          {mode: 0o600},
      );
      await assert.rejects(
          verifyLocalWriteFreezeEvidence({
            evidencePath,
            outputPath: path.join(external, "proof.json"),
            repositoryRoot: secondRoot,
            providerAdapter,
          }),
          /genuine approved mock provider adapter/,
      );
    });

test("runtime context binds genuine provider and exact clean Git identity",
    async (context) => {
      const repositoryRoot = createSyntheticGitRepository(context);
      const evidence =
        bindEvidenceToRepository(evidenceFixture(), repositoryRoot);
      const providerAdapter =
        createGenuineAdapterForEvidence(evidence, repositoryRoot);
      const providerResult = await providerAdapter.observeDeployment();
      evidence.iamPolicy =
        structuredClone(providerResult.observation.iamPolicy);
      evidence.scheduler =
        structuredClone(providerResult.observation.scheduler);
      resign(evidence);
      const providerRuntimeContext =
        await createValidatedProviderRuntimeContext({
          providerAdapter,
          providerResult,
          repositoryRoot,
        });
      const otherGenuineAdapter =
        createGenuineAdapterForEvidence(evidence, repositoryRoot);
      await assert.rejects(
          createValidatedProviderRuntimeContext({
            providerAdapter: otherGenuineAdapter,
            providerResult,
            repositoryRoot,
          }),
          /GENUINE_MOCK_PROVIDER_RESULT_REQUIRED/,
      );
      assert.equal(providerRuntimeContext.repositoryRoot, repositoryRoot);
      assert.equal(providerRuntimeContext.headSha, evidence.release.sha);
      assert.equal(
          providerRuntimeContext.treeSha,
          evidence.release.runtimeGit.treeSha,
      );
      assert.equal(
          providerRuntimeContext.criticalSourceSetDigest,
          evidence.release.runtimeGit.criticalSourceSetDigest,
      );
      assert.equal(
          providerRuntimeContext.reviewedSourceDigest,
          EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
      );
      assert.doesNotThrow(() => validateWriteFreezeEvidence(evidence, {
        providerRuntimeContext,
      }));

      const arbitraryRelease = structuredClone(evidence);
      arbitraryRelease.release.sha = SHA;
      arbitraryRelease.release.runtimeGit.headSha = SHA;
      arbitraryRelease.deploymentApprovalReceipt.releaseSha = SHA;
      resign(arbitraryRelease);
      assert.throws(
          () => validateWriteFreezeEvidence(arbitraryRelease, {
            providerRuntimeContext,
          }),
          /runtime Git|Git HEAD/,
      );

      const wrongTree = structuredClone(evidence);
      wrongTree.release.runtimeGit.treeSha = TREE_SHA;
      resign(wrongTree);
      assert.throws(
          () => buildDeterministicWriteFreezeProof(wrongTree, {
            providerRuntimeContext,
          }),
          /runtime Git/,
      );

      const wrongSource = structuredClone(evidence);
      wrongSource.release.runtimeGit.reviewedSources[0].runtimeSha256 =
        DIGEST_A;
      wrongSource.release.runtimeGit.reviewedSources[0].headSha256 = DIGEST_A;
      wrongSource.release.runtimeGit.reviewedSourceSetDigest =
        sha256Canonical(wrongSource.release.runtimeGit.reviewedSources);
      resign(wrongSource);
      assert.throws(
          () => validateWriteFreezeEvidence(wrongSource, {
            providerRuntimeContext,
          }),
          /reviewed source|runtime Git/,
      );

      assert.throws(
          () => validateWriteFreezeEvidence(evidence, {
            providerRuntimeContext: structuredClone(providerRuntimeContext),
          }),
          /genuine provider runtime context/,
      );

      fs.writeFileSync(path.join(repositoryRoot, "untracked-dirty.txt"), "x");
      await assert.rejects(
          createValidatedProviderRuntimeContext({
            providerAdapter,
            providerResult,
            repositoryRoot,
          }),
          /dirty/,
      );
    });

function rawDoubleScanDenyPolicy(index = 1) {
  const attachmentPoint =
    `cloudresourcemanager.googleapis.com/projects/${EXPECTED_PROJECT_ID}`;
  return {
    name: `policies/${attachmentPoint}/denypolicies/policy-${index}`,
    updateTime: "2026-07-19T00:00:00Z",
    rules: [{
      description: `reviewed deny rule ${index}`,
      denyRule: {
        deniedPrincipals: ["principalSet://goog/public:all"],
        exceptionPrincipals: [],
        deniedPermissions: [
          "cloudresourcemanager.googleapis.com/projects.get",
        ],
        exceptionPermissions: [],
      },
    }],
  };
}

async function executeRawIamDoubleScanFixture(options = {}) {
  const evidence = evidenceFixture();
  for (const functionRecord of
    evidence.deploymentApprovalReceipt.resources.functions) {
    const source = functionRecord.providerSourceIdentity;
    source.value = source.value.replace(
        /^gs:\/\/[^/]+/,
        `gs://${STANDALONE_SOURCE_BUCKET_NAME}`,
    );
  }
  const {approvalReceipt, transportExecutor} =
    createGenuineTransportFixtureForEvidence(evidence, options);
  return executeInjectedMockRawProductionObserverHarness({
    mockOnly: true,
    sessionReceipt: approvalReceipt,
    transportExecutor,
  });
}

test("genuine IAM double-scan A-C/L — independent empty scans are stable",
    async () => {
      const result = await executeRawIamDoubleScanFixture();
      assert.equal(result.inventoryStable, true);
      assert.equal(result.providerObservationComplete, true);
      assert.equal(result.rawObservation.iam.denyPolicyAnalysisComplete, true);
      assert.equal(result.rawObservation.iam.denyPolicies.length, 0);
      assert.equal(result.counts.executedMandatoryOperationCount, 24);
      assert.equal(result.counts.notApplicableMandatoryOperationCount, 5);
      assert.equal(result.notApplicableMandatoryOperationIds.length, 5);
      assert.equal(result.blockers.length, 0);
      assert.deepEqual(
          result.operationTraceSummary,
          result.rawObservation.operationTraceSummary,
      );
      assert.deepEqual(
          result.executedMandatoryOperationIds,
          result.operationTraceSummary.executedMandatoryOperationIds,
      );
      assert.equal(
          result.digests.operationTraceDigest,
          sha256Canonical(result.rawObservation.operationTrace),
      );
      assert.equal(
          result.digests.schedulerDigest,
          sha256Canonical(result.rawObservation.scheduler.jobs),
      );
      assert.equal(
          result.rawObservation.scheduler.digest,
          result.digests.schedulerDigest,
      );
      assert.equal(
          result.digests.rawObservationDigest,
          sha256Canonical(result.rawObservation),
      );
      assert.equal(
          result.rawObservation.operationTrace.filter(({operationId}) =>
            operationId ===
              "cloudresourcemanager.v3.projects.get").length,
          2,
      );
    });

test("genuine IAM double-scan B — fully fetched deny policies are complete",
    async () => {
      const policies = [rawDoubleScanDenyPolicy()];
      const result = await executeRawIamDoubleScanFixture({
        denyPoliciesByScan: [policies, structuredClone(policies)],
      });
      assert.equal(result.inventoryStable, true);
      assert.equal(result.rawObservation.iam.denyPolicyAnalysisComplete, true);
      assert.equal(result.rawObservation.iam.denyPolicies.length, 1);
      assert.equal(result.counts.executedMandatoryOperationCount, 25);
      assert.equal(result.counts.notApplicableMandatoryOperationCount, 4);
      assert.deepEqual(
          result.blockers,
          ["DENY_POLICY_PRESENT_REQUIRES_REVIEW"],
      );
    });

test("genuine IAM double-scan G/H — empty/nonempty mismatches reject",
    async () => {
      const policies = [rawDoubleScanDenyPolicy()];
      for (const denyPoliciesByScan of [
        [[], policies],
        [policies, []],
      ]) {
        await assert.rejects(
            executeRawIamDoubleScanFixture({denyPoliciesByScan}),
            /INVENTORY_UNSTABLE/,
        );
      }
    });

test("genuine IAM double-scan E/F/K — coherent second-scan drift rejects",
    async () => {
      await assert.rejects(
          executeRawIamDoubleScanFixture({
            responseMutator: ({iamScanIndex, input, value}) =>
              iamScanIndex === 1 &&
              input.operationId ===
                "cloudresourcemanager.v3.projects.getIamPolicy" ?
                {...value, etag: "second-scan-drift"} :
                value,
          }),
          /INVENTORY_UNSTABLE/,
      );
    });

test("reviewed source root rejects missing and symlinked files", (context) => {
  for (const mode of ["missing", "symlink"]) {
    const repositoryRoot = createSyntheticGitRepository(context);
    const relativePath =
      "functions/scripts/academy-reset-freeze-provider-attestation.mjs";
    const target = path.join(repositoryRoot, relativePath);
    fs.rmSync(target);
    if (mode === "symlink") {
      fs.symlinkSync(path.join(sourceRepositoryRoot, relativePath), target);
    }
    assert.throws(
        () => validateProviderAdapterReviewedSources(repositoryRoot),
        /unreadable|regular file/,
    );
  }
});

test("evidence and proof paths retain mode, no-clobber, and cleanup safety",
    async (context) => {
      const repositoryRoot = createSyntheticGitRepository(context);
      const external = createExternalDirectory(context, "academy-freeze-path-");
      const evidence = bindEvidenceToRepository(
          evidenceFixture(),
          repositoryRoot,
      );
      const evidencePath = path.join(external, "evidence.json");
      fs.writeFileSync(evidencePath, JSON.stringify(evidence), {mode: 0o644});
      await assert.rejects(
          verifyLocalWriteFreezeEvidence({
            evidencePath,
            outputPath: path.join(external, "proof.json"),
            repositoryRoot,
            providerAdapter: mockProviderAdapter(evidence),
          }),
          /exactly 0600/,
      );
      const partial = path.join(external, "partial.json");
      assert.throws(() => writeProofAtomicNoClobber({
        outputPath: partial,
        proof: {invalid: undefined},
        repositoryRoot,
      }), /unsupported/);
      assert.equal(fs.existsSync(partial), false);
    });

test("repository-internal evidence path is rejected before Git access",
    async () => {
      await assert.rejects(
          verifyLocalWriteFreezeEvidence({
        evidencePath: path.join(
            DEFAULT_REPOSITORY_ROOT,
            "forbidden-freeze-evidence.json",
        ),
        outputPath: path.join(os.tmpdir(), "never-written-proof.json"),
        providerAdapter: {adapterId: APPROVED_PROVIDER_ADAPTER_ID},
      }),
          /outside the repository/,
      );
    });
