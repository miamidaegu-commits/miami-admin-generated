import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
  EXPECTED_WRITE_SOURCE_IDENTITY_DIGEST,
  WRITE_SOURCE_SHA256_ALLOWLIST,
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
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NUMBER,
  IAM_PRINCIPAL_POLICY_VERSION,
  IAM_PRINCIPAL_POLICY_SCHEMA,
  IAM_EVIDENCE_FAMILY_NAMES,
  OBSERVATION_COMPLETENESS_VERSION,
  PROVIDER_DEPENDENCY_CONTRACT_VERSION,
  PROVIDER_READ_ONLY_OPERATIONS,
  PROJECT_IDENTITY_CONTRACT_VERSION,
  PROVIDER_OBSERVATION_VERSION,
  PROOF_GATE_KEYS,
  REVIEWED_IAM_ROLE_DEFINITIONS,
  REVIEWED_PERMISSION_UNIVERSE,
  REVIEWED_WRITABLE_PERMISSIONS,
  REQUIRED_COMPARISON_BASELINE_DIGEST,
  REQUIRED_NEGATIVE_PROBES,
  ROLLBACK_UNFREEZE_ORDER,
  SCHEDULER_JOB_ALLOWLIST,
  UNFREEZE_ORDER,
  WRITABLE_PERMISSION_DERIVATION_VERSION,
  WRITER_DRAIN_CLASSES,
  WRITE_FREEZE_CONTRACT_VERSION,
  TARGET_PROJECT_IDENTITY,
  assertCanonicalJsonShape,
  buildApprovedIamExpectedState,
  buildIamFamilyCompleteness,
  buildDeterministicWriteFreezeProof,
  computeDrainTelemetryDigest,
  computeEvidenceArtifactDigest,
  computeIamPolicyDigest,
  computeNegativeProbeEvidenceDigest,
  computeObservedSetDigest,
  computeSentinelSnapshotDigest,
  sha256Canonical,
  stableStringify,
  validateWriteFreezeEvidence,
} from "../functions/scripts/academy-reset-write-freeze-contract.mjs";
import {
  DEFAULT_REPOSITORY_ROOT,
  executeVerifierCli,
  resolveRuntimeGitSourceIdentity,
  verifyLocalWriteFreezeEvidence,
  writeProofAtomicNoClobber,
} from "../functions/scripts/verify-academy-reset-write-freeze.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceRepositoryRoot = path.resolve(__dirname, "..");
const SHA = "1234567890abcdef1234567890abcdef12345678";
const TREE_SHA = "abcdef1234567890abcdef1234567890abcdef12";
const DIGEST_A = "a".repeat(64);
const DIGEST_B = "b".repeat(64);
const TEST_NOW_MS = Date.now();
const atOffsetMinutes = (minutes) =>
  new Date(TEST_NOW_MS + minutes * 60 * 1000).toISOString();
const RESOURCE_AT = atOffsetMinutes(-12);
const APPROVED_AT = atOffsetMinutes(-11);
const DEPLOYMENT_AT = atOffsetMinutes(-10);
const ACTIVATED_AT = atOffsetMinutes(-9);
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
  return {
    headSha: SHA,
    treeSha: TREE_SHA,
    clean: true,
    criticalSources: CRITICAL_RUNTIME_SOURCE_PATHS.map((sourcePath) => {
      const digest = pins.get(sourcePath) ?? DIGEST_A;
      return {
        path: sourcePath,
        fileMode: "100644",
        gitBlobOid: SHA,
        indexFlags: "H",
        runtimeSha256: digest,
        headSha256: digest,
      };
    }),
  };
}

const RUNTIME_SERVICE_ACCOUNT =
  `serviceAccount:${EXPECTED_PROJECT_NUMBER}-compute@` +
  "developer.gserviceaccount.com";

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
    buildId: `build-${String(index).padStart(2, "0")}`,
    updateTime: RESOURCE_AT,
    providerSourceIdentity: {
      type: "storage_source",
      value: `gs://immutable/functions/${name}/987654321`,
    },
    runtimeServiceAccount: RUNTIME_SERVICE_ACCOUNT,
  }));
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

function evidenceFixture() {
  const runtimeGit = runtimeGitFixture();
  const approvedIamSnapshot = iamObservation();
  const iamExpectedState =
    buildApprovedIamExpectedState(approvedIamSnapshot);
  const iamPolicy = iamObservation(functionRecords(), iamExpectedState);
  const byPath = new Map(
      runtimeGit.criticalSources.map((source) => [source.path, source]),
  );
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
      providerDependencyApproval: {
        strategy: "declared_google_auth_library_rest",
        module: "google-auth-library",
        allowedOperations: [...PROVIDER_READ_ONLY_OPERATIONS],
        reviewedSourceDigest: DIGEST_A,
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
  return {
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    approvalReceipt,
    observation: {
      schemaVersion: PROVIDER_OBSERVATION_VERSION,
      adapterId: APPROVED_PROVIDER_ADAPTER_ID,
      observedAt: PROVIDER_OBSERVED_AT,
      projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
      projectId: EXPECTED_PROJECT_ID,
      projectNumber: EXPECTED_PROJECT_NUMBER,
      dependencyContract: {
        schemaVersion: PROVIDER_DEPENDENCY_CONTRACT_VERSION,
        strategy: "declared_google_auth_library_rest",
        module: "google-auth-library",
        directDependencyReviewed: true,
        publicApiOnly: true,
        allowedOperations: [...dependencyApproval.allowedOperations],
        reviewedSourceDigest: dependencyApproval.reviewedSourceDigest,
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

function validate(evidence, providerResult = providerResultFor(evidence)) {
  return validateWriteFreezeEvidence(evidence, {providerResult});
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
  for (const relativePath of CRITICAL_RUNTIME_SOURCE_PATHS) {
    const source = path.join(sourceRepositoryRoot, relativePath);
    const destination = path.join(repositoryRoot, relativePath);
    fs.mkdirSync(path.dirname(destination), {recursive: true, mode: 0o700});
    fs.copyFileSync(source, destination);
  }
  runGit(repositoryRoot, ["add", "--", ...CRITICAL_RUNTIME_SOURCE_PATHS]);
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
  return resign(evidence);
}

test("valid provider-bound evidence produces deterministic proof", () => {
  const evidence = evidenceFixture();
  const providerResult = providerResultFor(evidence);
  const validation = validate(evidence, providerResult);
  assert.equal(validation.writerCount, 58);
  const first = buildDeterministicWriteFreezeProof(evidence, {providerResult});
  const second = buildDeterministicWriteFreezeProof(
      structuredClone(evidence),
      {providerResult: structuredClone(providerResult)},
  );
  assert.deepEqual(first, second);
  assert.equal(first.writeFreezeVerified, true);
  assert.deepEqual(first.unfreezeOrder, UNFREEZE_ORDER);
  assert.deepEqual(first.rollbackUnfreezeOrder, ROLLBACK_UNFREEZE_ORDER);
  assert.match(first.providerObservationDigest, /^[a-f0-9]{64}$/);
  assert.equal(first.providerObservationCompletedAt, PROVIDER_OBSERVED_AT);
  assert.equal(first.latestDeploymentObservedAt, RESOURCE_AT);
  assert.equal(first.latestDeploymentScanCompletedAt, DEPLOYMENT_AT);
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
  for (const gate of PROOF_GATE_KEYS) assert.equal(first[gate], true);
});

test("provider adapter and immutable resource receipt comparison fail closed", () => {
  const missingProvider = evidenceFixture();
  assert.throws(() => validateWriteFreezeEvidence(missingProvider),
      /provider adapter result is required/);

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
        /adapter|receipt|resources|function|deployed|Rules|observed set/,
    );
  }

  const digestOnly = evidenceFixture();
  const result = providerResultFor(digestOnly);
  result.observation.rules.rulesetName = "arbitrary";
  assert.throws(() => validate(digestOnly, result), /Rules resource/);
});

test("provider completeness, dependency, lineage, and proof gates fail closed",
    () => {
      for (const [mutate, pattern] of [
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
        }, /source\/lock lineage/],
        [(result) => {
          result.observation.dependencyContract.allowedOperations.push(
              "cloudfunctions.functions.call",
          );
        }, /operation exact set mismatch/],
      ]) {
        const evidence = evidenceFixture();
        const result = providerResultFor(evidence);
        mutate(result);
        assert.throws(() => validate(evidence, result), pattern);
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
        const rejected = evidenceFixture();
        rejected.gateStates[gate] = false;
        resign(rejected);
        assert.throws(
            () => buildDeterministicWriteFreezeProof(rejected, {
              providerResult: providerResultFor(rejected),
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
      for (const [mutate, pattern] of mutations) {
        const evidence = evidenceFixture();
        const result = providerResultFor(evidence);
        mutate(result.observation.iamPolicy);
        assert.throws(() => validate(evidence, result), pattern);
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
          /runtime service account is not approved/,
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
      for (const [mutate, pattern] of cases) {
        const evidence = evidenceFixture();
        const result = providerResultFor(evidence);
        mutate(result.observation.iamPolicy);
        assert.throws(() => validate(evidence, result), pattern);
      }
    });

test("IAM family completeness requires exact family counts and digests", () => {
  for (const [mutate, pattern] of [
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
    assert.throws(() => validate(evidence, result), pattern);
  }
});

test("provider and scheduler scan chronology fail closed", () => {
  for (const [mutate, pattern] of [
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
    }, /sub-observation scan completion/],
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
    assert.throws(() => validate(evidence, result), pattern);
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
          /inactive future reset executor has an active IAM binding/,
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
          /inactive future reset executor has an active IAM binding/,
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
          /IAM family completeness mismatch: groupExpansions/,
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

test("Rules resources bind the exact pinned project and proof identity", () => {
  const accepted = evidenceFixture();
  const acceptedProvider = providerResultFor(accepted);
  const acceptedProof = buildDeterministicWriteFreezeProof(accepted, {
    providerResult: acceptedProvider,
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
        /Rules approval lineage/,
    );
  }

  const oneSurface = evidenceFixture();
  const oneSurfaceProvider = providerResultFor(oneSurface);
  oneSurfaceProvider.observation.rules.rulesetName =
    "projects/other-production-project/rulesets/ruleset-123";
  assert.throws(
      () => validate(oneSurface, oneSurfaceProvider),
      /Rules resources do not match the pinned project identity/,
  );

  const wrongProjectNumber = evidenceFixture();
  wrongProjectNumber.deploymentApprovalReceipt.resources.projectNumber =
    "999999999999";
  resign(wrongProjectNumber);
  assert.throws(
      () => validate(wrongProjectNumber, providerResultFor(wrongProjectNumber)),
      /pinned target project identity/,
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
        /must be a string|unknown or missing fields|Rules approval lineage/,
    );
  }

  const resourceMismatch = evidenceFixture();
  const mismatchedProvider = providerResultFor(resourceMismatch);
  mismatchedProvider.observation.rules.rulesetName =
    `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-456`;
  assert.throws(
      () => validate(resourceMismatch, mismatchedProvider),
      /approval lineage|observed set/,
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
  const changedProof = buildDeterministicWriteFreezeProof(changedIdentity, {
    providerResult: changedProvider,
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
        /IAM principal|exact set|snapshot digest|policy digest/,
    );
  }
  const duplicate = evidenceFixture();
  duplicate.iamPolicy.principals[1] =
    structuredClone(duplicate.iamPolicy.principals[0]);
  resign(duplicate);
  assert.throws(
      () => validate(duplicate),
      /IAM principal exact set mismatch|snapshot digest/,
  );

  const unknown = evidenceFixture();
  unknown.iamPolicy.principals[0].id = "unknown_backend";
  resign(unknown);
  assert.throws(() => validate(unknown), /unknown principal/);

  const duplicateMember = evidenceFixture();
  duplicateMember.iamPolicy.principals[1].member =
    duplicateMember.iamPolicy.principals[0].member;
  resign(duplicateMember);
  assert.throws(
      () => validate(duplicateMember),
      /duplicate full members|snapshot digest/,
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
      /approval receipt|pinned project number/,
  );

  const providerMemberMismatch = evidenceFixture();
  const mismatchedProviderResult = providerResultFor(providerMemberMismatch);
  mismatchedProviderResult.observation.iamPolicy.principals[0].member =
    "serviceAccount:999999999999-compute@" +
    "developer.gserviceaccount.com";
  assert.throws(
      () => validate(providerMemberMismatch, mismatchedProviderResult),
      /provider IAM principals differ|pinned project number|snapshot digest/,
  );
});

test("pinned Production project identity rejects every IAM substitution", () => {
  const accepted = evidenceFixture();
  const acceptedProvider = providerResultFor(accepted);
  assert.doesNotThrow(() => validate(accepted, acceptedProvider));

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
        /pinned project number/,
    );
  }

  const oneSurface = evidenceFixture();
  oneSurface.iamPolicy.principals[0].member =
    "serviceAccount:999999999999-compute@developer.gserviceaccount.com";
  resign(oneSurface);
  assert.throws(() => validate(oneSurface), /pinned project number/);

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
      /pinned target project identity/,
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
        /unknown or missing fields|pinned target project identity/,
    );
  }

  const unknown = evidenceFixture();
  unknown.iamPolicy.principals[0].id = "unknown_backend";
  resign(unknown);
  assert.throws(() => validate(unknown), /unknown principal/);

  const writable = evidenceFixture();
  writable.iamPolicy.principals[0].effectivePermissions.push(
      "datastore.entities.update",
  );
  resign(writable);
  assert.throws(() => validate(writable), /exact set|snapshot digest/);

  const proof = buildDeterministicWriteFreezeProof(accepted, {
    providerResult: acceptedProvider,
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
  assert.throws(() => validate(unknown), /unknown scheduler job/);

  for (const field of ["projectId", "region", "target"]) {
    const wrong = evidenceFixture();
    wrong.scheduler.jobs[0][field] = `wrong-${field}`;
    resign(wrong);
    assert.throws(() => validate(wrong), /unknown scheduler job or target/);
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
        /activation order|quiet window|schedulerStoppedAt/,
    );
  }
  const staleDeployment = evidenceFixture();
  const providerResult = providerResultFor(staleDeployment);
  providerResult.observation.observedAt = atOffsetMinutes(-7);
  assert.throws(
      () => validate(staleDeployment, providerResult),
      /sub-observation scan completion/,
  );
  const oldObservation = evidenceFixture();
  const oldProviderResult = providerResultFor(oldObservation);
  oldProviderResult.observation.observedAt = atOffsetMinutes(-70);
  assert.throws(
      () => validate(oldObservation, oldProviderResult),
      /sub-observation scan completion|provider observation predates/,
  );
});

test("provider-observed activation chronology is exact and proof-bound", () => {
  const accepted = evidenceFixture();
  const acceptedProvider = providerResultFor(accepted);
  const acceptedProof = buildDeterministicWriteFreezeProof(accepted, {
    providerResult: acceptedProvider,
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
      /deployment<=activatedAt/,
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
      /deployment<=activatedAt/,
  );

  const activationAfterSentinel = evidenceFixture();
  activationAfterSentinel.freezeWindow.activatedAt = atOffsetMinutes(-7);
  resign(activationAfterSentinel);
  assert.throws(
      () => validate(
          activationAfterSentinel,
          providerResultFor(activationAfterSentinel),
      ),
      /deployment<=activatedAt/,
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
        /unknown or missing fields|ISO UTC timestamp/,
    );
  }

  const providerLaterThanActivation = evidenceFixture();
  const laterProvider = providerResultFor(providerLaterThanActivation);
  laterProvider.observation.observedAt = atOffsetMinutes(-2.5);
  assert.doesNotThrow(
      () => validate(providerLaterThanActivation, laterProvider),
  );

  const shiftedActivation = evidenceFixture();
  shiftedActivation.freezeWindow.activatedAt = atOffsetMinutes(-8.5);
  resign(shiftedActivation);
  const shiftedProof = buildDeterministicWriteFreezeProof(shiftedActivation, {
    providerResult: providerResultFor(shiftedActivation),
  });
  assert.notEqual(shiftedProof.proofDigest, acceptedProof.proofDigest);
  assert.notDeepEqual(
      shiftedProof.activationChronology,
      acceptedProof.activationChronology,
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
  assert.throws(() => validate(pin), /literal pin/);
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
      fs.writeFileSync(evidencePath, JSON.stringify(evidence), {mode: 0o600});
      const result = await verifyLocalWriteFreezeEvidence({
        evidencePath,
        outputPath,
        repositoryRoot,
        providerAdapter: mockProviderAdapter(evidence),
      });
      assert.equal(result.proof.writeFreezeVerified, true);
      assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600);
      await assert.rejects(
          executeVerifierCli([
            "--evidence", evidencePath,
            "--output", path.join(external, "cli-proof.json"),
          ]),
          /no approved provider adapter/,
      );
    });

test("proof write waits for asynchronous provider observation", async (context) => {
  const repositoryRoot = createSyntheticGitRepository(context);
  const external = createExternalDirectory(context, "academy-freeze-await-");
  const evidence = bindEvidenceToRepository(evidenceFixture(), repositoryRoot);
  const evidencePath = path.join(external, "evidence.json");
  const outputPath = path.join(external, "proof.json");
  fs.writeFileSync(evidencePath, JSON.stringify(evidence), {mode: 0o600});
  let releaseObservation;
  const observationPending = new Promise((resolve) => {
    releaseObservation = resolve;
  });
  const verification = verifyLocalWriteFreezeEvidence({
    evidencePath,
    outputPath,
    repositoryRoot,
    providerAdapter: {
      adapterId: APPROVED_PROVIDER_ADAPTER_ID,
      async observeDeployment() {
        return observationPending;
      },
    },
  });
  await Promise.resolve();
  assert.equal(fs.existsSync(outputPath), false);
  releaseObservation(providerResultFor(evidence));
  const result = await verification;
  assert.equal(result.proof.writeFreezeVerified, true);
  assert.equal(fs.existsSync(outputPath), true);
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
