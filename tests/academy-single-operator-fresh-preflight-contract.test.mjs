import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import nodeTest from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";

const blockerFocused = process.env.ACADEMY_BLOCKER_FOCUSED === "1";
const failedSevenFocused =
  process.env.ACADEMY_FAILED_SEVEN_FOCUSED === "1";
function test(name, optionsOrFunction, maybeFunction) {
  if (failedSevenFocused && !/^P —/u.test(name)) {
    return undefined;
  }
  if (!failedSevenFocused && blockerFocused &&
      !/^(?:blocker|L —|P —|R1|R2)/u.test(name)) {
    return undefined;
  }
  return maybeFunction === undefined ?
    nodeTest(name, optionsOrFunction) :
    nodeTest(name, optionsOrFunction, maybeFunction);
}

import * as freshContractNamespace from
  "../functions/scripts/academy-single-operator-fresh-preflight-contract.mjs";
import * as runtimeContractNamespace from
  "../functions/scripts/academy-private-runtime-iam-contract.mjs";
import {
  DEPLOYMENT_TARGETS,
  IMMUTABLE_RELEASE_EVIDENCE,
  ORGANIZATION_POLICY_EVIDENCE,
  buildOrganizationPolicyLineageReference,
} from "../functions/scripts/academy-functions-build-scope-contract.mjs";
import {
  ARTIFACT_IAM_COLLECTION_PLAN_DIGEST,
  EXPECTED_ACADEMY_SERVICE_ACCOUNT_IDS,
  EXPECTED_CUSTOM_ROLE_IDS,
  EXISTING_FUNCTION_BASELINE_DIGEST,
  LEGACY_IAM_BASELINE_DIGEST,
  LEGACY_IAM_BASELINE_RECORDS,
  PRE_PROVISIONING,
  buildPhaseEvidence,
} from "../functions/scripts/academy-legacy-iam-migration-contract.mjs";
import {
  APPROVED_SINGLE_OPERATOR_PRINCIPAL,
  EXECUTION_SERVICE_ACCOUNT_EMAILS,
  EXECUTABLE_APPROVAL_VERSION,
  SERVICE_ACCOUNT_KEY_AUDIT_VERSION,
  SINGLE_OPERATOR_CONTROL_MANIFEST_VERSION,
  SINGLE_OPERATOR_EXECUTION_STEPS,
  SINGLE_OPERATOR_JIT_V1,
  assessSingleOperatorFreshJitIssuance,
  assessSingleOperatorJitIssuance,
  buildExecutableApprovalDigest,
  validateExecutableApproval,
} from "../functions/scripts/academy-private-runtime-iam-contract.mjs";
import {
  FRESH_PREFLIGHT_AUDIT_DISPOSITION_VERSION,
  FRESH_PREFLIGHT_APPROVED_CONFIG,
  FRESH_PREFLIGHT_APPROVED_RAW_PROJECTION,
  FRESH_PREFLIGHT_CHALLENGE_HEX_LENGTH,
  FRESH_PREFLIGHT_COLLECTOR_AUTHORITY,
  FRESH_PREFLIGHT_COLLECTOR_CONFIG_DIGEST,
  FRESH_PREFLIGHT_CONTRACT_DIGEST,
  FRESH_PREFLIGHT_CONTRACT_VERSION,
  FRESH_PREFLIGHT_CURRENT_STATE_VERSION,
  FRESH_PREFLIGHT_INVOCATION_VERSION,
  FRESH_PREFLIGHT_RECEIPT_SCHEMA_VERSION,
  FRESH_PREFLIGHT_REQUIRED_CLOUD_CHECKS,
  FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_RELEASE,
  FRESH_PREFLIGHT_SOURCE_AUTHORITY_BASE_TREE,
  assessFreshPreflightApprovedConfig,
  buildApprovedFreshPreflightCurrentState,
  buildFreshPreflightReceiptCanonicalBytes,
  buildFreshPreflightReceiptDigest,
  buildFreshPreflightSourceIdentities,
  canonicalDigest,
  validateFreshPreflightContract,
  validateFreshPreflightCollectorAuthority,
  validateFreshPreflightRawProjection,
} from "../functions/scripts/academy-single-operator-fresh-preflight-contract.mjs";

async function loadInstrumentedFreshModules() {
  const testDirectory = path.dirname(fileURLToPath(import.meta.url));
  const sourceDirectory = path.resolve(
      testDirectory,
      "../functions/scripts",
  );
  const temporaryRoot = fs.mkdtempSync(
      path.join(os.tmpdir(), "academy-fresh-capability-instrumentation-"),
  );
  const scriptsDirectory = path.join(temporaryRoot, "scripts");
  fs.cpSync(sourceDirectory, scriptsDirectory, {recursive: true});
  const freshPath = path.join(
      scriptsDirectory,
      "academy-single-operator-fresh-preflight-contract.mjs",
  );
  fs.appendFileSync(freshPath, `
export {
  beginSingleOperatorFreshPreflightInvocation as __testBeginProductionFresh,
  beginSingleOperatorFreshPreflightInvocationForTest as __testBeginFresh,
  buildSingleOperatorFreshPreflightReceiptForTest as __testBuildReceipt,
  finalizeSingleOperatorFreshPreflightInvocation as __testFinalizeFresh,
  inspectSingleOperatorFreshPreflightCapability as __testInspectFresh,
  validateSingleOperatorFreshPreflightAuditDisposition as __testAuditFresh,
  validateSingleOperatorFreshPreflightReceipt as __testValidateFresh
};

export function __testHasFreshFinalizationCapability(capability) {
  return freshFinalizationCapabilities.has(capability);
}
`);
  const runtimePath = path.join(
      scriptsDirectory,
      "academy-private-runtime-iam-contract.mjs",
  );
  fs.appendFileSync(runtimePath, `
import {
  FRESH_PREFLIGHT_APPROVED_CONFIG as __testApprovedFreshConfig,
  validateFreshPreflightRawProjection as __testValidateRawProjection
} from "./academy-single-operator-fresh-preflight-contract.mjs";

function __testReadClock(clock) {
  if (typeof clock !== "function") {
    fail("test instrumentation requires an explicit deterministic clock");
  }
  const value = clock();
  parseExactRfc3339UtcNanoseconds(value, "instrumented internal clock");
  return value;
}

export function __testAssessSingleOperatorAuthorizationData({
  approvalTemplate,
  clock,
  rawProjection
}) {
  __testValidateRawProjection(rawProjection);
  const challengeCreatedAt = __testReadClock(clock);
  const collectionStartedAt = __testReadClock(clock);
  const collectionCompletedAt = __testReadClock(clock);
  const validatedAt = __testReadClock(clock);
  const jitStartsAt = __testReadClock(clock);
  if (Date.parse(collectionStartedAt) < Date.parse(challengeCreatedAt) ||
      Date.parse(collectionCompletedAt) < Date.parse(collectionStartedAt) ||
      Date.parse(jitStartsAt) <= Date.parse(collectionCompletedAt)) {
    fail("instrumented pure assessment chronology is invalid");
  }
  const freshPreflightReceiptDigest = canonicalDigest({
    challengeCreatedAt,
    collectionCompletedAt,
    collectionStartedAt,
    rawProjection
  });
  const approval = buildInternallyTimedSingleOperatorApproval(
      approvalTemplate,
      {
        approvedAt: validatedAt,
        freshPreflightReceiptDigest,
        jitStartsAt
      }
  );
  const assessment = validateExecutableApprovalInternal(
      approval,
      {currentTimestamp: jitStartsAt},
      {
        prevalidatedFreshPreflight: {
          freshPreflightReceiptDigest,
          freshPreflightSameInvocationValidated: true,
          jitStartsAfterFreshCollection: true,
          mutationCommandsPublished: false,
          rollbackManifestDigest:
            __testApprovedFreshConfig.rollbackManifestDigest,
          secureAuditCopyValidated: true
        },
        requireFreshPreflight: false
      }
  );
  if (assessment.operatorMode !== SINGLE_OPERATOR_JIT_V1 ||
      assessment.executable !== true) {
    fail("instrumented fresh single-operator approval is not executable");
  }
  return deepFreeze({
    approval: deepFreeze(approval),
    assessment,
    authorizationCapability: null
  });
}

export async function __testAssessSingleOperatorAuthorization(options) {
  try {
    const assessed = __testAssessSingleOperatorAuthorizationData(options);
    return deepFreeze({
      verdict: "READY_FOR_ACTIVE_JIT_RECEIPT",
      activeJitReceiptEligible: assessed.assessment.executable,
      activeJitReceiptCreated: 0,
      authorizationCapability: null,
      deploymentEligible:
        assessed.assessment.execution.deploymentApprovalEligible,
      mutationCommandPublicationEligible:
        assessed.assessment.execution.iamMutationCommandPublication,
      mutationCommandsPublished: false,
      provisioningEligible:
        assessed.assessment.execution.actualProvisioningEligible,
      publicInvokerEligible:
        assessed.assessment.execution.publicInvokerApprovalEligible
    });
  } catch (error) {
    return deepFreeze({
      verdict: error?.code === "INPUT_REQUIRED" ?
        "INPUT_REQUIRED" : "REJECTED",
      activeJitReceiptEligible: false,
      activeJitReceiptCreated: 0,
      authorizationCapability: null,
      deploymentEligible: false,
      mutationCommandPublicationEligible: false,
      mutationCommandsPublished: false,
      provisioningEligible: false,
      publicInvokerEligible: false,
      reason: error instanceof Error ? error.message : String(error)
    });
  }
}

let __testRuntimeCapabilityMintCount = 0;
const __testOriginalRuntimeCapabilityMint =
  mintIssuedSingleOperatorAuthorizationCapability;
mintIssuedSingleOperatorAuthorizationCapability = function(...args) {
  __testRuntimeCapabilityMintCount += 1;
  return __testOriginalRuntimeCapabilityMint(...args);
};

export function __testBridgeFreshFinalization(
    freshFinalizationCapability,
    approvalTemplate
) {
  return bridgeSingleOperatorFreshFinalizationToPrivateValidation(
      freshFinalizationCapability,
      approvalTemplate
  );
}

export function __testRuntimeCapabilityMintCountValue() {
  return __testRuntimeCapabilityMintCount;
}

export function __testHasRuntimeCapability(capability) {
  return issuedSingleOperatorAuthorizationSessions.has(capability);
}
`);
  try {
    const runtimeModule = await import(
        `${pathToFileURL(runtimePath).href}?instrumented=${Date.now()}`,
    );
    const freshModule = await import(pathToFileURL(freshPath).href);
    return {freshModule, runtimeModule};
  } finally {
    fs.rmSync(temporaryRoot, {recursive: true, force: true});
  }
}

const {
  freshModule: instrumentedFresh,
  runtimeModule: instrumentedRuntime,
} = await loadInstrumentedFreshModules();
const {
  __testBeginProductionFresh: beginSingleOperatorFreshPreflightInvocation,
  __testBeginFresh: beginSingleOperatorFreshPreflightInvocationForTest,
  __testBuildReceipt: buildSingleOperatorFreshPreflightReceiptForTest,
  __testFinalizeFresh: finalizeSingleOperatorFreshPreflightInvocation,
  __testHasFreshFinalizationCapability:
    hasFreshFinalizationCapabilityForTest,
  __testInspectFresh: inspectSingleOperatorFreshPreflightCapability,
  __testAuditFresh: validateSingleOperatorFreshPreflightAuditDisposition,
  __testValidateFresh: validateSingleOperatorFreshPreflightReceipt,
} = instrumentedFresh;
const {
  __testAssessSingleOperatorAuthorization:
    assessSingleOperatorFreshJitIssuanceForTest,
  __testBridgeFreshFinalization:
    bridgeFreshFinalizationForTest,
  __testHasRuntimeCapability:
    hasRuntimeCapabilityForTest,
  __testRuntimeCapabilityMintCountValue:
    runtimeCapabilityMintCountForTest,
} = instrumentedRuntime;

const DIGESTS = Object.freeze({
  rawEvidenceDigest: FRESH_PREFLIGHT_APPROVED_CONFIG.rawEvidenceDigest,
  resultPackageDigest: FRESH_PREFLIGHT_APPROVED_CONFIG.resultPackageDigest,
  preflightEvidenceDigest:
    FRESH_PREFLIGHT_APPROVED_CONFIG.preflightEvidenceDigest,
  rollbackManifestDigest:
    FRESH_PREFLIGHT_APPROVED_CONFIG.rollbackManifestDigest,
  provisioningManifestDigest:
    FRESH_PREFLIGHT_APPROVED_CONFIG.provisioningManifestDigest,
  executionManifestDigest:
    FRESH_PREFLIGHT_APPROVED_CONFIG.executionManifestDigest,
  issuanceToolDigest: FRESH_PREFLIGHT_APPROVED_CONFIG.issuanceToolDigest,
});

function clone(value) {
  return structuredClone(value);
}

function addMilliseconds(timestamp, milliseconds) {
  return new Date(Date.parse(timestamp) + milliseconds).toISOString();
}

function currentStateFixture() {
  return clone(buildApprovedFreshPreflightCurrentState());
}

function invocationConfig() {
  return clone(FRESH_PREFLIGHT_APPROVED_CONFIG);
}

function receiptFixture(invocation, config, overrides = {}) {
  const collectionStartedAt = invocation.challengeCreatedAt;
  const collectionCompletedAt =
    addMilliseconds(collectionStartedAt, 1_000);
  const receipt = {
    ...clone(buildSingleOperatorFreshPreflightReceiptForTest({
      collectionCompletedAt,
      collectionStartedAt,
      invocation,
      rawProjection: FRESH_PREFLIGHT_APPROVED_RAW_PROJECTION,
    })),
    ...overrides,
  };
  receipt.receiptDigest = buildFreshPreflightReceiptDigest(receipt);
  return receipt;
}

function freshFlow() {
  const config = invocationConfig();
  const invocation =
    beginSingleOperatorFreshPreflightInvocationForTest(
        "2026-07-23T00:00:00.000Z",
    );
  const receipt = receiptFixture(invocation, config);
  const jitStartsAt =
    addMilliseconds(receipt.collectionCompletedAt, 1_000);
  return {
    config,
    invocation,
    receipt,
    receiptBytes: buildFreshPreflightReceiptCanonicalBytes(receipt),
    jitStartsAt,
    capability: null,
  };
}

function resign(receipt) {
  receipt.receiptDigest = buildFreshPreflightReceiptDigest(receipt);
  return buildFreshPreflightReceiptCanonicalBytes(receipt);
}

function auditDisposition(flow, overrides = {}) {
  return {
    schemaVersion: FRESH_PREFLIGHT_AUDIT_DISPOSITION_VERSION,
    freshPreflightReceiptDigest: flow.receipt.receiptDigest,
    secureAuditCopyComplete: true,
    receiptTransport: "IN_MEMORY_BUFFER",
    temporaryFreshnessEvidenceDisposition: "NOT_CREATED",
    mutationCommandsPublished: false,
    productionDataAccess: 0,
    mutations: 0,
    ...overrides,
  };
}

function finalizedFreshFlow() {
  const flow = freshFlow();
  const receiptCapability = validateSingleOperatorFreshPreflightReceipt(
      flow.invocation,
      flow.receiptBytes,
  );
  validateSingleOperatorFreshPreflightAuditDisposition(
      receiptCapability,
      auditDisposition(flow),
  );
  return {
    ...flow,
    finalizationCapability:
      finalizeSingleOperatorFreshPreflightInvocation(
          receiptCapability,
          {
            freshPreflightReceiptDigest: flow.receipt.receiptDigest,
            jitStartsAt: flow.jitStartsAt,
          },
      ),
  };
}

function executableApproval(flow, overrides = {}) {
  const approval = {
    schemaVersion: EXECUTABLE_APPROVAL_VERSION,
    approvalId: "academy-single-operator-fresh-preflight-test",
    approvedAt: flow.invocation.challengeCreatedAt,
    operatorMode: SINGLE_OPERATOR_JIT_V1,
    provisioningPrincipal: APPROVED_SINGLE_OPERATOR_PRINCIPAL,
    impersonationPrincipal: APPROVED_SINGLE_OPERATOR_PRINCIPAL,
    invokerOperatorPrincipal: APPROVED_SINGLE_OPERATOR_PRINCIPAL,
    jitStartsAt: flow.jitStartsAt,
    jitExpiresAt: addMilliseconds(flow.jitStartsAt, 60 * 60 * 1_000),
    freshPreflightReceiptDigest: flow.receipt.receiptDigest,
    organizationPolicy: clone(ORGANIZATION_POLICY_EVIDENCE),
    organizationPolicyLineage:
      clone(buildOrganizationPolicyLineageReference()),
    preProvisioningMigrationEvidence:
      clone(buildPhaseEvidence(PRE_PROVISIONING)),
    serviceAccountKeyAudit: {
      schemaVersion: SERVICE_ACCOUNT_KEY_AUDIT_VERSION,
      projectId: "daegu-miami-production",
      serviceAccountEmails: clone(EXECUTION_SERVICE_ACCOUNT_EMAILS),
      userManagedKeyCount: 0,
      complete: true,
    },
    singleOperatorControlManifest: {
      schemaVersion: SINGLE_OPERATOR_CONTROL_MANIFEST_VERSION,
      orderedSteps: clone(SINGLE_OPERATOR_EXECUTION_STEPS),
      legacyIamMigrationAuthorityDigest:
        flow.receipt.sourceIdentities.migrationAuthority.digest,
      deploymentSource: clone(IMMUTABLE_RELEASE_EVIDENCE),
      targets: clone(DEPLOYMENT_TARGETS),
      productionApprovalReferenceDigest: "a".repeat(64),
      rollbackManifestDigest: flow.config.rollbackManifestDigest,
      temporaryAccessRemovalPlanDigest: "b".repeat(64),
      secureAuditArtifact: {
        artifactDigest: "c".repeat(64),
        directoryMode: "0700",
        fileMode: "0600",
      },
    },
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: true,
    approvalDigest: "",
    ...overrides,
  };
  approval.approvalDigest = buildExecutableApprovalDigest(approval);
  return approval;
}

function orchestrationFixture({
  approvalOverrides = {},
  mutateApproval,
  mutateReceipt,
} = {}) {
  const flow = freshFlow();
  const approval = executableApproval(flow, approvalOverrides);
  if (mutateApproval) {
    mutateApproval(approval);
    approval.approvalDigest = buildExecutableApprovalDigest(approval);
  }
  for (const key of [
    "approvalDigest",
    "approvedAt",
    "freshPreflightReceiptDigest",
    "jitExpiresAt",
    "jitStartsAt",
  ]) {
    delete approval[key];
  }
  const rawProjection = clone(FRESH_PREFLIGHT_APPROVED_RAW_PROJECTION);
  if (mutateReceipt) {
    mutateReceipt(rawProjection);
    delete rawProjection.projectionDigest;
    rawProjection.projectionDigest = canonicalDigest(rawProjection);
  }
  const timestamps = [
    "2026-07-23T00:00:00.000Z",
    "2026-07-23T00:00:00.001Z",
    "2026-07-23T00:00:00.002Z",
    "2026-07-23T00:00:00.003Z",
    "2026-07-23T00:00:00.004Z",
  ];
  return {
    approvalTemplate: approval,
    clock() {
      return timestamps.shift();
    },
    rawProjection,
  };
}

test("contract authority is sealed and specifies the exact projection", () => {
  assert.equal(validateFreshPreflightContract(), true);
  assert.match(FRESH_PREFLIGHT_CONTRACT_DIGEST, /^[a-f0-9]{64}$/);
  assert.equal(FRESH_PREFLIGHT_CONTRACT_VERSION,
      "academy_single_operator_fresh_preflight_contract.v2");
  assert.equal(FRESH_PREFLIGHT_REQUIRED_CLOUD_CHECKS.length, 17);
});

test("blocker A0 — production collector/config exports are closed",
    async () => {
  const arbitraryCollector = await assessSingleOperatorFreshJitIssuance({
    collectFreshPreflight() {},
  });
  assert.equal(arbitraryCollector.verdict, "REJECTED");
  assert.equal(
      arbitraryCollector.reason,
      "Academy private runtime IAM contract rejected: production fresh " +
        "issuance accepts no override parameters",
  );
  for (const name of [
    "beginSingleOperatorFreshPreflightInvocation",
    "beginSingleOperatorFreshPreflightInvocationForTest",
    "buildSingleOperatorFreshPreflightReceiptForTest",
    "finalizeSingleOperatorFreshPreflightInvocation",
    "inspectSingleOperatorFreshPreflightCapability",
    "validateSingleOperatorFreshPreflightAuditDisposition",
    "validateSingleOperatorFreshPreflightReceipt",
  ]) {
    assert.equal(Object.hasOwn(freshContractNamespace, name), false);
  }
});

test("blocker A/J — fresh finalization bridges to a real private capability",
    () => {
      const flow = finalizedFreshFlow();
      assert.equal(
          hasFreshFinalizationCapabilityForTest(
              flow.finalizationCapability,
          ),
          true,
      );
      const result = bridgeFreshFinalizationForTest(
          flow.finalizationCapability,
          orchestrationFixture().approvalTemplate,
      );
      assert.equal(
          result.assessment.freshPreflightSameInvocationValidated,
          true,
      );
      assert.equal(result.activeJitReceiptCreated, 0);
      assert.equal(
          hasFreshFinalizationCapabilityForTest(
              flow.finalizationCapability,
          ),
          false,
      );
      assert.equal(
          hasRuntimeCapabilityForTest(result.authorizationCapability),
          true,
      );
    });

test("blocker B/C — canonical finalization field and replay are exact", () => {
  const flow = finalizedFreshFlow();
  const assessment =
    instrumentedFresh.consumeSingleOperatorFreshPreflightFinalizationCapability(
        flow.finalizationCapability,
    );
  assert.equal(assessment.freshPreflightSameInvocationValidated, true);
  assert.equal(Object.hasOwn(assessment, "sameInvocationValidated"), false);
  assert.throws(
      () =>
        instrumentedFresh.
            consumeSingleOperatorFreshPreflightFinalizationCapability(
                flow.finalizationCapability,
            ),
      {
        message: "Academy single-operator fresh preflight rejected: fresh " +
          "finalization capability is absent, copied, or consumed",
      },
  );
  assert.throws(
      () => bridgeFreshFinalizationForTest(
          Object.freeze({sameInvocationValidated: true}),
          orchestrationFixture().approvalTemplate,
      ),
      {
        message: "Academy single-operator fresh preflight rejected: fresh " +
          "finalization capability is absent, copied, or consumed",
      },
  );
});

test("blocker D — failed bridge validation consumes fresh capability", () => {
  const flow = finalizedFreshFlow();
  const invalidTemplate = orchestrationFixture({
    approvalOverrides: {publicInvokerApprovalEligible: true},
  }).approvalTemplate;
  const mintCountBefore = runtimeCapabilityMintCountForTest();
  assert.throws(
      () => bridgeFreshFinalizationForTest(
          flow.finalizationCapability,
          invalidTemplate,
      ),
      {
        message: "Academy private runtime IAM contract rejected: approval " +
          "execution flags do not fail closed for Organization Policy",
      },
  );
  assert.equal(runtimeCapabilityMintCountForTest(), mintCountBefore);
  assert.equal(
      hasFreshFinalizationCapabilityForTest(flow.finalizationCapability),
      false,
  );
  assert.throws(
      () => bridgeFreshFinalizationForTest(
          flow.finalizationCapability,
          orchestrationFixture().approvalTemplate,
      ),
      {
        message: "Academy single-operator fresh preflight rejected: fresh " +
          "finalization capability is absent, copied, or consumed",
      },
  );
});

test("blocker I/J — public self-validator is absent and assessment is pure",
    () => {
      assert.equal(
          Object.hasOwn(
              runtimeContractNamespace,
              "validateSingleOperatorAuthorizationCapabilityChainContract",
          ),
          false,
      );
      assert.equal(
          Object.keys(runtimeContractNamespace).some((name) =>
            /(?:ForTest|__test|CapabilityChainContract)$/.test(name)),
          false,
      );
      const before = runtimeCapabilityMintCountForTest();
      const assessment = instrumentedFresh.assessFreshPreflightApprovedConfig(
          clone(instrumentedFresh.FRESH_PREFLIGHT_APPROVED_CONFIG),
      );
      assert.equal(assessment.authorizationCapability, null);
      assert.equal(runtimeCapabilityMintCountForTest(), before);
    });

test("collector source and operation authority reject coherent drift", () => {
  const operationChanged = clone(FRESH_PREFLIGHT_COLLECTOR_AUTHORITY);
  operationChanged.operations[0].id = "ACTIVE_ACCOUNT_CHANGED";
  const changedOperationProjection = {...operationChanged};
  delete changedOperationProjection.operationConfigDigest;
  operationChanged.operationConfigDigest =
    canonicalDigest(changedOperationProjection);
  assert.throws(
      () => validateFreshPreflightCollectorAuthority(operationChanged),
      /source or operation authority mismatch/,
  );

  const sourceChanged = clone(FRESH_PREFLIGHT_COLLECTOR_AUTHORITY);
  sourceChanged.sourceSha256 = "0".repeat(64);
  assert.throws(
      () => validateFreshPreflightCollectorAuthority(sourceChanged),
      /source or operation authority mismatch/,
  );

  const sameCountSwap = clone(FRESH_PREFLIGHT_COLLECTOR_AUTHORITY);
  [sameCountSwap.operations[0], sameCountSwap.operations[1]] =
    [sameCountSwap.operations[1], sameCountSwap.operations[0]];
  assert.throws(
      () => validateFreshPreflightCollectorAuthority(sameCountSwap),
      /source or operation authority mismatch/,
  );
  assert.match(FRESH_PREFLIGHT_COLLECTOR_CONFIG_DIGEST, /^[a-f0-9]{64}$/);
});

test("coherently changed raw projection and claimed digest reject", () => {
  const changed = clone(FRESH_PREFLIGHT_APPROVED_RAW_PROJECTION);
  [changed.functions[0].buildResource, changed.functions[3].buildResource] =
    [changed.functions[3].buildResource, changed.functions[0].buildResource];
  delete changed.projectionDigest;
  changed.projectionDigest = canonicalDigest(changed);
  assert.throws(
      () => validateFreshPreflightRawProjection(changed),
      /not authoritative/,
  );
});

test("A — exact same-invocation nonce receipt is accepted", () => {
  const flow = freshFlow();
  assert.equal(flow.invocation.schemaVersion, FRESH_PREFLIGHT_INVOCATION_VERSION);
  assert.equal(flow.invocation.challengeNonce.length,
      FRESH_PREFLIGHT_CHALLENGE_HEX_LENGTH);
  assert.match(flow.invocation.challengeNonce, /^[a-f0-9]{64}$/);
  const capability = validateSingleOperatorFreshPreflightReceipt(
      flow.invocation,
      flow.receiptBytes,
  );
  const result =
    inspectSingleOperatorFreshPreflightCapability(capability);
  assert.equal(result.freshPreflightSameInvocationValidated, true);
  assert.equal(Object.hasOwn(result, "sameInvocationValidated"), false);
  assert.equal(result.nonceConsumed, true);
  assert.equal(result.mutationCommandsPublished, false);
});

test("B — wrong nonce and caller-selected nonce are rejected", () => {
  assert.throws(
      () => beginSingleOperatorFreshPreflightInvocation({
        ...invocationConfig(),
        challengeNonce: "a".repeat(64),
      }),
      {
        message: "Academy single-operator fresh preflight rejected: " +
          "production fresh invocation accepts no collector or config input",
      },
  );
  const flow = freshFlow();
  const receipt = clone(flow.receipt);
  receipt.challengeNonce = "a".repeat(64);
  assert.throws(
      () => validateSingleOperatorFreshPreflightReceipt(
          flow.invocation,
          resign(receipt),
      ),
      /nonce, source, evidence, manifest, or state mismatch/,
  );

  const missingFlow = freshFlow();
  const missingReceipt = clone(missingFlow.receipt);
  delete missingReceipt.challengeNonce;
  assert.throws(
      () => validateSingleOperatorFreshPreflightReceipt(
          missingFlow.invocation,
          resign(missingReceipt),
      ),
      /exact key set mismatch/,
  );
});

test("C — nonce reuse is rejected", () => {
  const flow = freshFlow();
  validateSingleOperatorFreshPreflightReceipt(
      flow.invocation,
      flow.receiptBytes,
  );
  assert.throws(
      () => validateSingleOperatorFreshPreflightReceipt(
          flow.invocation,
          flow.receiptBytes,
      ),
      /already used/,
  );
});

test("opaque fresh capability cannot be copied, serialized, or reused", () => {
  const flow = freshFlow();
  const capability = validateSingleOperatorFreshPreflightReceipt(
      flow.invocation,
      flow.receiptBytes,
  );
  assert.equal(JSON.stringify(capability), "{}");
  const reconstructed = Object.freeze({});
  assert.throws(
      () => inspectSingleOperatorFreshPreflightCapability(reconstructed),
      /absent, copied, or consumed/,
  );
  validateSingleOperatorFreshPreflightAuditDisposition(
      capability,
      auditDisposition(flow),
  );
  finalizeSingleOperatorFreshPreflightInvocation(capability, {
    freshPreflightReceiptDigest: flow.receipt.receiptDigest,
    jitStartsAt: flow.jitStartsAt,
  });
  assert.throws(
      () => inspectSingleOperatorFreshPreflightCapability(capability),
      /absent, copied, or consumed/,
  );
  assert.throws(
      () => finalizeSingleOperatorFreshPreflightInvocation(capability, {
        freshPreflightReceiptDigest: flow.receipt.receiptDigest,
        jitStartsAt: flow.jitStartsAt,
      }),
      /absent, copied, or consumed/,
  );
});

test("D — standalone receipt replay and reconstructed invocation reject", () => {
  const flow = freshFlow();
  assert.throws(
      () => validateSingleOperatorFreshPreflightReceipt(
          structuredClone(flow.invocation),
          flow.receiptBytes,
      ),
      /standalone or reconstructed/,
  );
  assert.throws(
      () => validateSingleOperatorFreshPreflightReceipt(
          flow.receiptBytes,
      ),
      /standalone or reconstructed/,
  );
});

test("E — wrong operator, project, and region reject without normalization",
    () => {
      for (const [key, value] of [
        ["operatorMode", "THREE_PERSON_SEPARATION"],
        ["operatorPrincipal", "user:other@example.com"],
        ["project", "DAEGU-MIAMI-PRODUCTION"],
        ["projectNumber", 884850632328],
        ["region", "US-CENTRAL1"],
      ]) {
        const flow = freshFlow();
        const receipt = clone(flow.receipt);
        receipt[key] = value;
        assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
            flow.invocation,
            resign(receipt),
        ));
      }
    });

test("F — source, evidence, rollback, execution, and tool tamper reject", () => {
  const staleSourceConfig = invocationConfig();
  staleSourceConfig.executionSource.release = "0".repeat(40);
  assert.throws(
      () => assessFreshPreflightApprovedConfig(staleSourceConfig),
      {
        message: "Academy single-operator fresh preflight rejected: fresh " +
          "invocation configuration is not the sealed authority",
      },
  );
  const tamperCases = [
    (receipt) => {
      receipt.sourceIdentities.executionSource.release = "0".repeat(40);
    },
    (receipt) => {
      receipt.rawEvidenceDigest = "0".repeat(64);
    },
    (receipt) => {
      receipt.resultPackageDigest = "0".repeat(64);
    },
    (receipt) => {
      receipt.preflightEvidenceDigest = "0".repeat(64);
    },
    (receipt) => {
      receipt.rollbackManifestDigest = "0".repeat(64);
    },
    (receipt) => {
      receipt.provisioningManifestDigest = "0".repeat(64);
    },
    (receipt) => {
      receipt.executionManifestDigest = "0".repeat(64);
    },
    (receipt) => {
      receipt.issuanceToolDigest = "0".repeat(64);
    },
  ];
  for (const tamper of tamperCases) {
    const flow = freshFlow();
    const receipt = clone(flow.receipt);
    tamper(receipt);
    assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
        flow.invocation,
        resign(receipt),
    ));
  }
});

test("G — collection findings or input requirements reject", () => {
  for (const key of ["forbiddenFindings", "inputRequired"]) {
    const flow = freshFlow();
    const receipt = clone(flow.receipt);
    receipt[key] = ["BLOCKER"];
    assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
        flow.invocation,
        resign(receipt),
    ), /authority, safety, or digest mismatch/);
  }
});

test("H — production data access or mutations reject", () => {
  for (const key of ["productionDataAccess", "mutations"]) {
    const flow = freshFlow();
    const receipt = clone(flow.receipt);
    receipt[key] = 1;
    assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
        flow.invocation,
        resign(receipt),
    ), /authority, safety, or digest mismatch/);
  }
});

test("I — a target Function already present rejects", () => {
  const flow = freshFlow();
  const receipt = clone(flow.receipt);
  receipt.currentState.functions.targetFunctionsPresent =
    [DEPLOYMENT_TARGETS[0].functionName];
  assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
      flow.invocation,
      resign(receipt),
  ), /exact PRE_PROVISIONING projection/);
});

test("J — partial Academy service account or role state rejects", () => {
  for (const resource of ["academyServiceAccounts", "academyCustomRoles"]) {
    const flow = freshFlow();
    const receipt = clone(flow.receipt);
    receipt.currentState[resource].presentIds =
      [receipt.currentState[resource].expectedIds[0]];
    assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
        flow.invocation,
        resign(receipt),
    ), /exact PRE_PROVISIONING projection/);
  }
});

test("K — changed legacy IAM baseline rejects", () => {
  const flow = freshFlow();
  const receipt = clone(flow.receipt);
  receipt.currentState.legacyIamBaseline.recordCount = 3;
  assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
      flow.invocation,
      resign(receipt),
  ), /exact PRE_PROVISIONING projection/);
});

test("L — changed Function, Build, or mapping baseline rejects", () => {
  const mutations = [
    (state) => {
      state.functions.totalCount = 31;
    },
    (state) => {
      state.builds.uniqueBuildCount = 13;
    },
    (state) => {
      state.functionRunBuildMapping.complete = false;
    },
    (state) => {
      state.builds.rawBuildSetDigest = "0".repeat(64);
    },
    (state) => {
      state.functionRunBuildMapping.functionBuildReferenceDigest =
        "0".repeat(64);
    },
  ];
  for (const mutate of mutations) {
    const flow = freshFlow();
    const receipt = clone(flow.receipt);
    mutate(receipt.currentState);
    assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
        flow.invocation,
        resign(receipt),
    ), {
      message: "Academy single-operator fresh preflight rejected: fresh " +
        "current state is not the exact PRE_PROVISIONING projection",
    });
  }
});

test("Artifact authority digest tamper rejects at PRE_PROVISIONING", () => {
  for (const key of [
    "evidenceDigest",
    "metadataEvidenceDigest",
    "iamEvidenceDigest",
    "policyDigest",
  ]) {
    const flow = freshFlow();
    const receipt = clone(flow.receipt);
    receipt.currentState.artifactRepository[key] = "0".repeat(64);
    assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
        flow.invocation,
        resign(receipt),
    ), /not the exact PRE_PROVISIONING projection/);
  }
});

test("M — JIT start before fresh collection completion rejects", () => {
  const flow = freshFlow();
  const capability = validateSingleOperatorFreshPreflightReceipt(
      flow.invocation,
      flow.receiptBytes,
  );
  validateSingleOperatorFreshPreflightAuditDisposition(
      capability,
      auditDisposition(flow),
  );
  assert.throws(() => finalizeSingleOperatorFreshPreflightInvocation(
      capability,
      {
        freshPreflightReceiptDigest: flow.receipt.receiptDigest,
        jitStartsAt: flow.receipt.collectionStartedAt,
      },
  ), /receipt digest or JIT start ordering/);

  const equalFlow = freshFlow();
  const equalCapability = validateSingleOperatorFreshPreflightReceipt(
      equalFlow.invocation,
      equalFlow.receiptBytes,
  );
  validateSingleOperatorFreshPreflightAuditDisposition(
      equalCapability,
      auditDisposition(equalFlow),
  );
  assert.throws(() => finalizeSingleOperatorFreshPreflightInvocation(
      equalCapability,
      {
        freshPreflightReceiptDigest: equalFlow.receipt.receiptDigest,
        jitStartsAt: equalFlow.receipt.collectionCompletedAt,
      },
  ), /receipt digest or JIT start ordering/);
});

test("N — JIT duration over 60 minutes rejects", () => {
  const flow = freshFlow();
  const approval = executableApproval(flow, {
    jitExpiresAt:
      addMilliseconds(flow.jitStartsAt, 60 * 60 * 1_000 + 1),
  });
  assert.throws(() => validateExecutableApproval(approval, {
    currentTimestamp: flow.jitStartsAt,
    freshPreflightInvocation: flow.invocation,
    freshPreflightReceiptBytes: flow.receiptBytes,
  }), /operator-mode maximum/);
});

test("production and template caller timestamps are rejected", async () => {
  const production = await assessSingleOperatorFreshJitIssuance({
    jitStartsAt: "2026-07-23T00:00:00Z",
    jitExpiresAt: "2026-07-23T01:00:00Z",
  });
  assert.equal(production.verdict, "REJECTED");

  const fixture = orchestrationFixture();
  fixture.approvalTemplate.jitStartsAt = "2026-07-23T00:00:00Z";
  const testOnly = await assessSingleOperatorFreshJitIssuanceForTest(fixture);
  assert.equal(testOnly.verdict, "REJECTED");
  assert.match(testOnly.reason, /exact key set mismatch/);
});

test("O — exact fresh flow is eligible while commands remain unpublished",
    async () => {
      const result = await assessSingleOperatorFreshJitIssuance(
      );
      assert.equal(result.verdict, "INPUT_REQUIRED");
      const testResult = await assessSingleOperatorFreshJitIssuanceForTest(
          orchestrationFixture(),
      );
      assert.deepEqual({...testResult, authorizationCapability: null}, {
        verdict: "READY_FOR_ACTIVE_JIT_RECEIPT",
        activeJitReceiptEligible: true,
        activeJitReceiptCreated: 0,
        authorizationCapability: null,
        deploymentEligible: true,
        mutationCommandPublicationEligible: true,
        mutationCommandsPublished: false,
        provisioningEligible: true,
        publicInvokerEligible: false,
      });
    });

test("P — safety-counter drift violates exact projection authority",
    async () => {
  const testResult = await assessSingleOperatorFreshJitIssuanceForTest(
      orchestrationFixture({
        mutateReceipt(receipt) {
          receipt.mutations = 1;
        },
      }),
  );
  assert.equal(testResult.verdict, "REJECTED");
  assert.equal(
      testResult.reason,
      "Academy single-operator fresh preflight rejected: fresh raw " +
        "projection or recomputed digest is not authoritative",
  );
  assert.equal(testResult.activeJitReceiptCreated, 0);
  assert.equal(testResult.provisioningEligible, false);
  assert.equal(testResult.deploymentEligible, false);
  assert.equal(testResult.publicInvokerEligible, false);
  assert.equal(testResult.mutationCommandPublicationEligible, false);
  assert.equal(testResult.mutationCommandsPublished, false);
});

test("P — one non-executable approval flag creates nothing", async () => {
  const result = await assessSingleOperatorFreshJitIssuanceForTest(
      orchestrationFixture({
        approvalOverrides: {
          actualProvisioningEligible: false,
        },
      }),
  );
  assert.equal(result.verdict, "REJECTED");
  assert.equal(
      result.reason,
      "Academy private runtime IAM contract rejected: instrumented fresh " +
        "single-operator approval is not executable",
  );
  assert.equal(result.activeJitReceiptEligible, false);
  assert.equal(result.activeJitReceiptCreated, 0);
  assert.equal(result.provisioningEligible, false);
  assert.equal(result.deploymentEligible, false);
  assert.equal(result.publicInvokerEligible, false);
  assert.equal(result.mutationCommandPublicationEligible, false);
  assert.equal(result.mutationCommandsPublished, false);
});

test("fresh receipt and approval rollback digests must remain identical",
    async () => {
      const result = await assessSingleOperatorFreshJitIssuanceForTest(
          orchestrationFixture({
            mutateApproval(approval) {
              approval.singleOperatorControlManifest.rollbackManifestDigest =
                "0".repeat(64);
            },
          }),
      );
      assert.equal(result.verdict, "REJECTED");
      assert.equal(result.activeJitReceiptCreated, 0);
      assert.equal(result.mutationCommandsPublished, false);
    });

test("Q — previous READY approval without fresh receipt is INPUT_REQUIRED",
    () => {
      const flow = freshFlow();
      const result =
        assessSingleOperatorJitIssuance(executableApproval(flow), {
          currentTimestamp: flow.jitStartsAt,
        });
      assert.equal(result.verdict, "INPUT_REQUIRED");
      assert.equal(result.activeJitReceiptCreated, 0);
      assert.equal(result.mutationCommandsPublished, false);
    });

test("R1 — production API rejects collector and config override surface",
    async () => {
  const result = await assessSingleOperatorFreshJitIssuance({
    collectFreshPreflight() {},
    freshPreflightConfig: clone(FRESH_PREFLIGHT_APPROVED_CONFIG),
  });
  assert.equal(result.verdict, "REJECTED");
  assert.equal(
      result.reason,
      "Academy private runtime IAM contract rejected: production fresh " +
        "issuance accepts no override parameters",
  );
  assert.equal(result.activeJitReceiptCreated, 0);
});

test("R2 — reviewed collector/config tamper invokes each mutator once", () => {
  const cases = [
    {
      base: () => clone(FRESH_PREFLIGHT_COLLECTOR_AUTHORITY),
      mutate(authority) {
        authority.operations[0].id = "ACTIVE_ACCOUNT_CHANGED";
      },
      validate: validateFreshPreflightCollectorAuthority,
      message: "Academy single-operator fresh preflight rejected: fresh " +
        "collector source or operation authority mismatch",
    },
    {
      base: () => clone(FRESH_PREFLIGHT_COLLECTOR_AUTHORITY),
      mutate(authority) {
        [
          authority.operations[0],
          authority.operations[1],
        ] = [
          authority.operations[1],
          authority.operations[0],
        ];
      },
      validate: validateFreshPreflightCollectorAuthority,
      message: "Academy single-operator fresh preflight rejected: fresh " +
        "collector source or operation authority mismatch",
    },
    {
      base: () => clone(FRESH_PREFLIGHT_APPROVED_CONFIG),
      mutate(config) {
        config.collectorSourceSha256 = "0".repeat(64);
      },
      validate: assessFreshPreflightApprovedConfig,
      message: "Academy single-operator fresh preflight rejected: fresh " +
        "invocation configuration is not the sealed authority",
    },
    {
      base: () => clone(FRESH_PREFLIGHT_APPROVED_CONFIG),
      mutate(config) {
        config.configDigest = "0".repeat(64);
      },
      validate: assessFreshPreflightApprovedConfig,
      message: "Academy single-operator fresh preflight rejected: fresh " +
        "invocation configuration is not the sealed authority",
    },
  ];
  for (const fixture of cases) {
    let mutateConfigCallCount = 0;
    const candidate = fixture.base();
    const mutateConfig = (value) => {
      mutateConfigCallCount += 1;
      fixture.mutate(value);
    };
    mutateConfig(candidate);
    assert.equal(mutateConfigCallCount, 1);
    assert.throws(() => fixture.validate(candidate), {
      message: fixture.message,
    });
  }
});

test("different collector schema and noncanonical bytes reject", () => {
  const schemaFlow = freshFlow();
  const receipt = clone(schemaFlow.receipt);
  receipt.schemaVersion = "academy_single_operator_fresh_preflight_receipt.v0";
  assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
      schemaFlow.invocation,
      resign(receipt),
  ), /authority, safety, or digest mismatch/);

  const canonicalFlow = freshFlow();
  const pretty = Buffer.from(
      `${JSON.stringify(canonicalFlow.receipt, null, 2)}\n`,
  );
  assert.throws(() => validateSingleOperatorFreshPreflightReceipt(
      canonicalFlow.invocation,
      pretty,
  ), /not exact canonical JSON/);
});

test("secure audit copy is mandatory and fail-closed", () => {
  const missingAuditFlow = freshFlow();
  const missingAuditCapability = validateSingleOperatorFreshPreflightReceipt(
      missingAuditFlow.invocation,
      missingAuditFlow.receiptBytes,
  );
  assert.throws(() => finalizeSingleOperatorFreshPreflightInvocation(
      missingAuditCapability,
      {
        freshPreflightReceiptDigest:
          missingAuditFlow.receipt.receiptDigest,
        jitStartsAt: missingAuditFlow.jitStartsAt,
      },
  ), /secure audit copy/);

  const mutationFlow = freshFlow();
  const mutationCapability = validateSingleOperatorFreshPreflightReceipt(
      mutationFlow.invocation,
      mutationFlow.receiptBytes,
  );
  assert.throws(() =>
    validateSingleOperatorFreshPreflightAuditDisposition(
        mutationCapability,
        auditDisposition(mutationFlow, {mutations: 1}),
    ), /not exact or read-only/);
});
