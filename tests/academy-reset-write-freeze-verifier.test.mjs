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
  EXPECTED_FUNCTION_GENERATION,
  EXPECTED_FUNCTION_REGION,
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NUMBER,
  IAM_PRINCIPAL_POLICY_VERSION,
  IAM_PRINCIPAL_POLICY_SCHEMA,
  PROJECT_IDENTITY_CONTRACT_VERSION,
  PROVIDER_OBSERVATION_VERSION,
  REQUIRED_COMPARISON_BASELINE_DIGEST,
  REQUIRED_NEGATIVE_PROBES,
  ROLLBACK_UNFREEZE_ORDER,
  SCHEDULER_JOB_ALLOWLIST,
  UNFREEZE_ORDER,
  WRITE_FREEZE_CONTRACT_VERSION,
  TARGET_PROJECT_IDENTITY,
  assertCanonicalJsonShape,
  buildDeterministicWriteFreezeProof,
  computeEvidenceArtifactDigest,
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
const SCHEDULER_STOPPED_AT = atOffsetMinutes(-7);
const DRAINED_AT = atOffsetMinutes(-6);
const IAM_READ_ONLY_AT = atOffsetMinutes(-5);
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

function sourceBundle(name) {
  return {
    bucket: "immutable-deployment-artifacts",
    object: `releases/${SHA}/${name}.tgz`,
    generation: "987654321",
    sha256: name === "rules" ? DIGEST_A : DIGEST_B,
  };
}

function deploymentResources() {
  return {
    projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    rules: {
      rulesetId: "projects/daegu-miami-production/rulesets/ruleset-123",
      deploymentId:
        "projects/daegu-miami-production/releases/cloud.firestore",
      updateTime: RESOURCE_AT,
      sourceBundle: sourceBundle("rules"),
    },
    functions: EXPECTED_DEPLOYED_FUNCTION_NAMES.map((name, index) => ({
      name,
      projectId: EXPECTED_PROJECT_ID,
      region: EXPECTED_FUNCTION_REGION,
      generation: EXPECTED_FUNCTION_GENERATION,
      revisionId: `${name}-00001-abc`,
      buildId: `build-${String(index).padStart(2, "0")}`,
      updateTime: RESOURCE_AT,
      sourceBundle: sourceBundle(`functions-${name}`),
    })),
  };
}

function evidenceFixture() {
  const runtimeGit = runtimeGitFixture();
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
      },
      resources: deploymentResources(),
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
      snapshotDigest: DIGEST_A,
      writerRegistryDigest:
        sha256Canonical(ACADEMY_RESET_WRITE_SURFACE_REGISTRY),
    },
    scheduler: {
      stoppedAt: SCHEDULER_STOPPED_AT,
      drainedAt: DRAINED_AT,
      drainEvidenceDigest: DIGEST_B,
      inventoryComplete: true,
      callableIngressBlocked: true,
      callableInFlightExecutions: 0,
      authProvisioningIngressBlocked: true,
      authProvisioningInFlightExecutions: 0,
      jobs: SCHEDULER_JOB_ALLOWLIST.map((job) => ({
        ...job,
        state: "DISABLED",
        inFlightExecutions: 0,
        evidenceDigest: DIGEST_A,
      })),
    },
    iamPolicy: {
      readOnlyObservedAt: IAM_READ_ONLY_AT,
      inventoryComplete: true,
      policyDigest: DIGEST_B,
      principals: FIXTURE_IAM_PRINCIPAL_ALLOWLIST.map((principal, index) => ({
        id: principal.id,
        member: principal.member,
        semanticRole: principal.semanticRole,
        disposition: principal.disposition,
        effectivePermissions: [...principal.effectivePermissions],
        authPermissions: [...principal.authPermissions],
        snapshotDigest: index % 2 ? DIGEST_B : DIGEST_A,
      })),
    },
    negativeProbes: REQUIRED_NEGATIVE_PROBES.map((required) => ({
      ...required,
      sentinelGeneration: SENTINEL_GENERATION,
      sentinelVersion: SENTINEL_VERSION,
      denied: true,
      observedAt: PROBE_AT,
      evidenceDigest: DIGEST_B,
    })),
    baselineComparison: {
      comparisonOnly: true,
      digest: REQUIRED_COMPARISON_BASELINE_DIGEST,
      matched: null,
    },
    artifactDigest: "",
  };
  evidence.artifactDigest = computeEvidenceArtifactDigest(evidence);
  return evidence;
}

function providerResultFor(evidence) {
  return {
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    approvalReceipt: structuredClone(evidence.deploymentApprovalReceipt),
    observation: {
      schemaVersion: PROVIDER_OBSERVATION_VERSION,
      adapterId: APPROVED_PROVIDER_ADAPTER_ID,
      observedAt: DEPLOYMENT_AT,
      projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
      projectId: EXPECTED_PROJECT_ID,
      projectNumber: EXPECTED_PROJECT_NUMBER,
      rules: structuredClone(evidence.deploymentApprovalReceipt.resources.rules),
      functions: structuredClone(
          evidence.deploymentApprovalReceipt.resources.functions,
      ),
      iamPolicy: {
        observedAt: evidence.iamPolicy.readOnlyObservedAt,
        inventoryComplete: evidence.iamPolicy.inventoryComplete,
        policyDigest: evidence.iamPolicy.policyDigest,
        principals: structuredClone(evidence.iamPolicy.principals),
      },
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
      result.observation.rules.rulesetId += "-stale";
    },
    (result) => {
      result.observation.functions[0].revisionId += "-stale";
    },
    (result) => {
      result.observation.functions.pop();
    },
    (result) => {
      result.observation.functions.push(
          {...result.observation.functions[0], name: "unknownFunction"},
      );
    },
  ]) {
    const evidence = evidenceFixture();
    const providerResult = providerResultFor(evidence);
    mutate(providerResult);
    assert.throws(
        () => validate(evidence, providerResult),
        /adapter|receipt|resources|function|deployed/,
    );
  }

  const digestOnly = evidenceFixture();
  const result = providerResultFor(digestOnly);
  result.observation.rules.rulesetId = "arbitrary";
  result.observation.rules.sourceBundle.sha256 =
    digestOnly.deploymentApprovalReceipt.resources.rules.sourceBundle.sha256;
  assert.throws(() => validate(digestOnly, result), /resources/);
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
      accepted.deploymentApprovalReceipt.resources.rules.rulesetId,
  );
  assert.equal(
      acceptedProof.rulesResourceIdentity.releaseResourceName,
      accepted.deploymentApprovalReceipt.resources.rules.deploymentId,
  );

  for (const projectId of [
    "other-production-project",
    "daegu-miami-production-copy",
    EXPECTED_PROJECT_NUMBER,
  ]) {
    const coherentForeign = evidenceFixture();
    coherentForeign.deploymentApprovalReceipt.resources.rules.rulesetId =
      `projects/${projectId}/rulesets/ruleset-123`;
    coherentForeign.deploymentApprovalReceipt.resources.rules.deploymentId =
      `projects/${projectId}/releases/cloud.firestore`;
    resign(coherentForeign);
    const coherentProvider = providerResultFor(coherentForeign);
    assert.throws(
        () => validate(coherentForeign, coherentProvider),
        /Rules resources do not match the pinned project identity/,
    );
  }

  const oneSurface = evidenceFixture();
  const oneSurfaceProvider = providerResultFor(oneSurface);
  oneSurfaceProvider.observation.rules.rulesetId =
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
      rules.rulesetId = "";
    },
    (rules) => {
      delete rules.deploymentId;
    },
    (rules) => {
      rules.rulesetId = "rulesets/ruleset-123";
    },
    (rules) => {
      rules.deploymentId =
        `projects/${EXPECTED_PROJECT_ID}/releases/other-release`;
    },
  ]) {
    const malformed = evidenceFixture();
    mutate(malformed.deploymentApprovalReceipt.resources.rules);
    resign(malformed);
    assert.throws(
        () => validate(malformed, providerResultFor(malformed)),
        /must be a string|unknown or missing fields|malformed Rules resource/,
    );
  }

  const resourceMismatch = evidenceFixture();
  const mismatchedProvider = providerResultFor(resourceMismatch);
  mismatchedProvider.observation.rules.rulesetId =
    `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-456`;
  assert.throws(
      () => validate(resourceMismatch, mismatchedProvider),
      /immutable deployed resources differ/,
  );

  const changedIdentity = evidenceFixture();
  changedIdentity.deploymentApprovalReceipt.resources.rules.rulesetId =
    `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-456`;
  resign(changedIdentity);
  const changedProof = buildDeterministicWriteFreezeProof(changedIdentity, {
    providerResult: providerResultFor(changedIdentity),
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
    assert.throws(() => validate(evidence), /IAM principal|exact set/);
  }
  const duplicate = evidenceFixture();
  duplicate.iamPolicy.principals[1] =
    structuredClone(duplicate.iamPolicy.principals[0]);
  resign(duplicate);
  assert.throws(() => validate(duplicate), /IAM principal exact set mismatch/);

  const unknown = evidenceFixture();
  unknown.iamPolicy.principals[0].id = "unknown_backend";
  resign(unknown);
  assert.throws(() => validate(unknown), /unknown principal/);

  const duplicateMember = evidenceFixture();
  duplicateMember.iamPolicy.principals[1].member =
    duplicateMember.iamPolicy.principals[0].member;
  resign(duplicateMember);
  assert.throws(() => validate(duplicateMember), /duplicate full members/);

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
      /provider IAM principals differ|pinned project number/,
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
  assert.throws(() => validate(writable), /exact set/);

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
  inFlight.scheduler.jobs[0].inFlightExecutions = 1;
  resign(inFlight);
  assert.throws(() => validate(inFlight), /not drained/);
});

test("activation order is deployment through probes and verifiedAt", () => {
  const cases = [
    (evidence) => {
      evidence.scheduler.stoppedAt = atOffsetMinutes(-9);
    },
    (evidence) => {
      evidence.scheduler.drainedAt = atOffsetMinutes(-8);
    },
    (evidence) => {
      evidence.iamPolicy.readOnlyObservedAt = atOffsetMinutes(-7);
    },
    (evidence) => {
      evidence.negativeProbes[0].observedAt = atOffsetMinutes(-6);
    },
  ];
  for (const mutate of cases) {
    const evidence = evidenceFixture();
    mutate(evidence);
    resign(evidence);
    assert.throws(
        () => validate(evidence),
        /activation order|stoppedAt must precede drainedAt/,
    );
  }
  const staleDeployment = evidenceFixture();
  const providerResult = providerResultFor(staleDeployment);
  providerResult.observation.observedAt = atOffsetMinutes(-7);
  assert.throws(
      () => validate(staleDeployment, providerResult),
      /activation order/,
  );
  const oldObservation = evidenceFixture();
  const oldProviderResult = providerResultFor(oldObservation);
  oldProviderResult.observation.observedAt = atOffsetMinutes(-70);
  assert.throws(
      () => validate(oldObservation, oldProviderResult),
      /observation is stale|provider observation predates|receipt is not valid/,
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
      acceptedProvider.observation.observedAt,
  );
  assert.equal(
      acceptedProof.activationChronology.activatedAt,
      accepted.freezeWindow.activatedAt,
  );

  const activationBeforeDeployment = evidenceFixture();
  activationBeforeDeployment.freezeWindow.activatedAt = atOffsetMinutes(-11);
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
  laterFunctionProvider.observation.observedAt = atOffsetMinutes(-8.5);
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

  const equalBoundary = evidenceFixture();
  const equalAt = atOffsetMinutes(-5);
  equalBoundary.freezeWindow.activatedAt = equalAt;
  equalBoundary.sentinel.capturedAt = equalAt;
  equalBoundary.scheduler.stoppedAt = equalAt;
  equalBoundary.scheduler.drainedAt = equalAt;
  equalBoundary.iamPolicy.readOnlyObservedAt = equalAt;
  equalBoundary.negativeProbes.forEach((probe) => {
    probe.observedAt = equalAt;
  });
  equalBoundary.verifiedAt = equalAt;
  resign(equalBoundary);
  const equalProvider = providerResultFor(equalBoundary);
  equalProvider.observation.observedAt = equalAt;
  assert.doesNotThrow(() => validate(equalBoundary, equalProvider));

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
  laterProvider.observation.observedAt = atOffsetMinutes(-8.5);
  assert.throws(
      () => validate(providerLaterThanActivation, laterProvider),
      /deployment<=activatedAt/,
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
