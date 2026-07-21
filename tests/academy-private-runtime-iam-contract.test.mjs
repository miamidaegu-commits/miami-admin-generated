import assert from "node:assert/strict";
import test from "node:test";

import {
  DEPLOYMENT_TARGETS,
  IMMUTABLE_RELEASE_EVIDENCE,
  ORGANIZATION_POLICY_EVIDENCE,
  buildOrganizationPolicyLineageReference,
} from "../functions/scripts/academy-functions-build-scope-contract.mjs";
import {
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
  DEFERRED_LEGACY_IAM_RECORDS,
  FINAL_STEADY_STATE as FINAL_IAM_MIGRATION_PHASE,
  POST_PRIVATE_DEPLOY_PRE_PUBLICATION,
  POST_PROVISIONING_PRE_DEPLOY,
  POST_PUBLICATION_PRE_CLEANUP,
  PRE_PROVISIONING,
  buildFinalIamAudit,
  buildPhaseEvidence,
  buildRollbackReceipt,
} from "../functions/scripts/academy-legacy-iam-migration-contract.mjs";
import {
  ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT,
  APPROVED_SINGLE_OPERATOR_PRINCIPAL,
  APPROVED_DATASTORE_PERMISSION_UNIVERSE,
  BASELINE_RUNTIME_FUNCTION_NAMES,
  BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  DEPLOYED_FUNCTION_NAMES,
  EXACT_CHRONOLOGY_PROFILE_VERSION,
  EXECUTION_PRINCIPAL_RECEIPT_FIELDS,
  EXECUTION_SERVICE_ACCOUNT_EMAILS,
  EXECUTABLE_APPROVAL_VERSION,
  EXPECTED_BINDINGS_BY_STATE,
  EXPECTED_BINDING_SET_DIGESTS_BY_STATE,
  EXPECTED_PERMISSION_SETS_BY_STATE,
  EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE,
  FREEZE_ACTIVATION_RECEIPT_VERSION,
  FREEZE_ACTIVE_STATE,
  FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING,
  PREVIEW_RUNTIME_FUNCTION_NAMES,
  PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER,
  PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
  MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
  OPERATOR_MODE_AUTHORITY,
  OPERATOR_MODE_CONTRACT_VERSION,
  READ_ONLY_DATASTORE_PERMISSIONS,
  READ_ONLY_ROLE,
  SERVICE_ACCOUNT_KEY_AUDIT_VERSION,
  SINGLE_OPERATOR_COMPLETION_RECEIPT_VERSION,
  SINGLE_OPERATOR_CONTROL_MANIFEST_VERSION,
  SINGLE_OPERATOR_EXECUTION_STEPS,
  SINGLE_OPERATOR_INVOKER_PUBLICATION_RECEIPT_VERSION,
  SINGLE_OPERATOR_JIT_V1,
  SINGLE_OPERATOR_MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
  SINGLE_OPERATOR_PRIVATE_VALIDATION_RECEIPT_VERSION,
  SINGLE_OPERATOR_PRIVATE_VALIDATION_STEPS,
  SINGLE_OPERATOR_COMPLETION_STEPS,
  SINGLE_OPERATOR_TARGET_FUNCTION_NAMES,
  STEADY_STATE,
  TARGET_DATABASE_CMEK_KEY,
  TARGET_DATABASE_DELETE_PROTECTION,
  TARGET_DATABASE_LOCATION,
  TARGET_DATABASE_RESOURCE,
  TARGET_DATABASE_TYPE,
  TARGET_PROJECT_ID,
  TARGET_PROJECT_NUMBER,
  TARGET_PROJECT_RESOURCE,
  UNFREEZE_RESTORATION_RECEIPT_VERSION,
  THREE_PERSON_SEPARATION,
  WRITABLE_DATASTORE_PERMISSIONS,
  WRITER_RUNTIME_FUNCTION_NAMES,
  WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER,
  WRITER_STEADY_DATASTORE_PERMISSIONS,
  WRITER_STEADY_ROLE,
  buildBindingSetDigest,
  buildCanonicalSetDigest,
  buildExecutableApprovalDigest,
  buildSingleOperatorCompletionReceiptDigest,
  buildSingleOperatorInvokerPublicationReceiptDigest,
  buildSingleOperatorPrivateValidationReceiptDigest,
  buildOrganizationPolicyEvidenceDigest,
  buildPermissionSetDigest,
  buildStateSnapshot,
  buildTransitionReceiptChronologyDigest,
  canonicalDigest,
  compareExactRfc3339UtcInstants,
  exactDurationNanoseconds,
  parseExactRfc3339UtcNanoseconds,
  parseExactUserPrincipal,
  validateExecutableApproval,
  validateFreezeActivationReceipt,
  validatePrivateRuntimeIamContract,
  validateSingleOperatorCompletionReceipt,
  validateSingleOperatorInvokerPublicationReceipt,
  validateSingleOperatorPrivateValidationReceipt,
  validateStateSnapshot,
  validateUnfreezeRestorationReceipt,
} from "../functions/scripts/academy-private-runtime-iam-contract.mjs";

const NOW = Date.parse("2026-07-19T02:00:00Z");
const TEST_EXECUTION_PRINCIPALS = Object.freeze({
  provisioningPrincipal: "user:provisioner@daegu-miami.com",
  impersonationPrincipal: "user:deployer@daegu-miami.com",
  invokerOperatorPrincipal: "user:invoker@daegu-miami.com",
});

function clone(value) {
  return structuredClone(value);
}

function approvalFixture(overrides = {}) {
  const approval = {
    schemaVersion: EXECUTABLE_APPROVAL_VERSION,
    approvalId: "academy-private-runtime-change-20260719",
    approvedAt: "2026-07-19T00:30:00Z",
    operatorMode: THREE_PERSON_SEPARATION,
    ...TEST_EXECUTION_PRINCIPALS,
    jitStartsAt: "2026-07-19T01:00:00Z",
    jitExpiresAt: "2026-07-19T03:00:00Z",
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
    singleOperatorControlManifest: null,
    actualProvisioningEligible: false,
    deploymentApprovalEligible: false,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: false,
    approvalDigest: "",
    ...overrides,
  };
  approval.approvalDigest = buildExecutableApprovalDigest(approval);
  return approval;
}

function singleOperatorControlManifest() {
  return {
    schemaVersion: SINGLE_OPERATOR_CONTROL_MANIFEST_VERSION,
    orderedSteps: clone(SINGLE_OPERATOR_EXECUTION_STEPS),
    legacyIamMigrationAuthorityDigest:
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
    deploymentSource: clone(IMMUTABLE_RELEASE_EVIDENCE),
    targets: clone(DEPLOYMENT_TARGETS),
    productionApprovalReferenceDigest: "f".repeat(64),
    rollbackManifestDigest: "a".repeat(64),
    temporaryAccessRemovalPlanDigest: "b".repeat(64),
    secureAuditArtifact: {
      artifactDigest: "c".repeat(64),
      directoryMode: "0700",
      fileMode: "0600",
    },
  };
}

function singleOperatorApprovalFixture(overrides = {}) {
  return approvalFixture({
    operatorMode: SINGLE_OPERATOR_JIT_V1,
    provisioningPrincipal: APPROVED_SINGLE_OPERATOR_PRINCIPAL,
    impersonationPrincipal: APPROVED_SINGLE_OPERATOR_PRINCIPAL,
    invokerOperatorPrincipal: APPROVED_SINGLE_OPERATOR_PRINCIPAL,
    jitExpiresAt: "2026-07-19T02:00:00Z",
    singleOperatorControlManifest: singleOperatorControlManifest(),
    ...overrides,
  });
}

function stepCompletions(stepIds, firstMinute) {
  return stepIds.map((stepId, index) => ({
    stepId,
    completedAt:
      `2026-07-19T01:${String(firstMinute + index).padStart(2, "0")}:00Z`,
  }));
}

function singleOperatorPrivateValidationFixture(approval) {
  const steps = stepCompletions(SINGLE_OPERATOR_PRIVATE_VALIDATION_STEPS, 1);
  const receipt = {
    schemaVersion: SINGLE_OPERATOR_PRIVATE_VALIDATION_RECEIPT_VERSION,
    receiptId: "single-operator-private-validation",
    receiptDigest: "",
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    operatorMode: SINGLE_OPERATOR_JIT_V1,
    postProvisioningMigrationEvidence:
      clone(buildPhaseEvidence(POST_PROVISIONING_PRE_DEPLOY)),
    prePublicationMigrationEvidence:
      clone(buildPhaseEvidence(POST_PRIVATE_DEPLOY_PRE_PUBLICATION)),
    stepCompletions: steps,
    privateValidationCompletedAt: steps.at(-1).completedAt,
    targets: clone(SINGLE_OPERATOR_TARGET_FUNCTION_NAMES),
    existingFunctionBaselineDigest:
      "1cb924fc62c97771d42fb60b98934d9f48e5192abbf0b03b31d06753ff41dcfd",
    finalFunctionCount: 35,
    finalGen2FunctionCount: 35,
    allTargetsPrivate: true,
    sourceIdentityVerified: true,
    effectivePermissionAuditComplete: true,
    userManagedKeyCount: 0,
  };
  receipt.receiptDigest =
    buildSingleOperatorPrivateValidationReceiptDigest(receipt);
  return receipt;
}

function singleOperatorPublicationFixture(approval, privateReceipt) {
  const receipt = {
    schemaVersion: SINGLE_OPERATOR_INVOKER_PUBLICATION_RECEIPT_VERSION,
    receiptId: "single-operator-invoker-publication",
    receiptDigest: "",
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    operatorMode: SINGLE_OPERATOR_JIT_V1,
    privateValidationReceiptDigest: privateReceipt.receiptDigest,
    privateValidationCompletedAt:
      privateReceipt.privateValidationCompletedAt,
    publicationConfirmedAt: "2026-07-19T01:10:00Z",
    confirmationSeparated: true,
    targets: clone(SINGLE_OPERATOR_TARGET_FUNCTION_NAMES),
  };
  receipt.receiptDigest =
    buildSingleOperatorInvokerPublicationReceiptDigest(receipt);
  return receipt;
}

function singleOperatorCompletionFixture(
    approval,
    publicationReceipt,
) {
  const steps = stepCompletions(SINGLE_OPERATOR_COMPLETION_STEPS, 11);
  const receipt = {
    schemaVersion: SINGLE_OPERATOR_COMPLETION_RECEIPT_VERSION,
    receiptId: "single-operator-completion",
    receiptDigest: "",
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    operatorMode: SINGLE_OPERATOR_JIT_V1,
    publicationReceiptDigest: publicationReceipt.receiptDigest,
    stepCompletions: steps,
    publicInvokerAppliedAt: steps[0].completedAt,
    temporaryAccessRemovedAt: steps[1].completedAt,
    finalAuditCompletedAt: steps[2].completedAt,
    targets: clone(SINGLE_OPERATOR_TARGET_FUNCTION_NAMES),
    rollbackManifestDigest:
      approval.singleOperatorControlManifest.rollbackManifestDigest,
    secureAuditArtifactDigest:
      approval.singleOperatorControlManifest.secureAuditArtifact
          .artifactDigest,
    temporaryAccessRemovalEvidence: {
      tokenCreatorBindingRemoved: true,
      actAsBindingsRemoved: true,
      deployRoleBindingRemoved: true,
      evidenceDigest: "d".repeat(64),
    },
    finalAudit: {
      complete: true,
      effectivePermissionAuditComplete: true,
      keyAuditComplete: true,
      userManagedKeyCount: 0,
      existingFunctionCount: 32,
      finalFunctionCount: 35,
      finalGen2FunctionCount: 35,
      evidenceDigest: "",
    },
    postPublicationMigrationEvidence:
      clone(buildPhaseEvidence(POST_PUBLICATION_PRE_CLEANUP)),
    finalMigrationEvidence:
      clone(buildPhaseEvidence(FINAL_IAM_MIGRATION_PHASE)),
    finalIamAudit: clone(buildFinalIamAudit()),
    rollbackReceipt: clone(buildRollbackReceipt({
      phase: FINAL_IAM_MIGRATION_PHASE,
      beforeRecords: DEFERRED_LEGACY_IAM_RECORDS,
      restoredRecords: [],
    })),
  };
  receipt.finalAudit.evidenceDigest = receipt.finalIamAudit.auditDigest;
  receipt.receiptDigest =
    buildSingleOperatorCompletionReceiptDigest(receipt);
  return receipt;
}

function activationFixture(approval = approvalFixture()) {
  const receipt = {
    schemaVersion: FREEZE_ACTIVATION_RECEIPT_VERSION,
    contractDigest: PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
    exactChronologyDigest: "",
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    observedAt: "2026-07-19T02:00:00Z",
    organizationPolicyLineage:
      clone(buildOrganizationPolicyLineageReference()),
    fromState: STEADY_STATE,
    toState: FREEZE_ACTIVE_STATE,
    before: clone(buildStateSnapshot(STEADY_STATE)),
    after: clone(buildStateSnapshot(FREEZE_ACTIVE_STATE)),
  };
  receipt.exactChronologyDigest =
    buildTransitionReceiptChronologyDigest(receipt, approval);
  return receipt;
}

function restorationFixture(approval = approvalFixture()) {
  const receipt = {
    schemaVersion: UNFREEZE_RESTORATION_RECEIPT_VERSION,
    contractDigest: PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
    exactChronologyDigest: "",
    approvalId: approval.approvalId,
    approvalDigest: approval.approvalDigest,
    observedAt: "2026-07-19T02:05:00Z",
    organizationPolicyLineage:
      clone(buildOrganizationPolicyLineageReference()),
    fromState: FREEZE_ACTIVE_STATE,
    toState: STEADY_STATE,
    before: clone(buildStateSnapshot(FREEZE_ACTIVE_STATE)),
    after: clone(buildStateSnapshot(STEADY_STATE)),
    chronology: {
      iamRestoredAt: "2026-07-19T02:01:00Z",
      schedulerRestoredAt: "2026-07-19T02:02:00Z",
      sentinelDeactivatedAt: "2026-07-19T02:03:00Z",
      positiveSmokeAt: "2026-07-19T02:04:00Z",
    },
  };
  receipt.exactChronologyDigest =
    buildTransitionReceiptChronologyDigest(receipt, approval);
  return receipt;
}

function refreshReceiptChronologyDigest(receipt, approval) {
  receipt.exactChronologyDigest =
    buildTransitionReceiptChronologyDigest(receipt, approval);
  return receipt;
}

test("A — project and Firestore identity are exact and project-scoped", () => {
  assert.equal(TARGET_PROJECT_ID, "daegu-miami-production");
  assert.equal(TARGET_PROJECT_NUMBER, "884850632328");
  assert.equal(TARGET_PROJECT_RESOURCE, "projects/daegu-miami-production");
  assert.equal(
      TARGET_DATABASE_RESOURCE,
      "projects/daegu-miami-production/databases/(default)",
  );
  assert.equal(TARGET_DATABASE_LOCATION, "asia-northeast3");
  assert.equal(TARGET_DATABASE_TYPE, "FIRESTORE_NATIVE");
  assert.equal(TARGET_DATABASE_CMEK_KEY, null);
  assert.equal(
      TARGET_DATABASE_DELETE_PROTECTION,
      "DELETE_PROTECTION_DISABLED",
  );
  assert.equal(
      ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT.firestoreDatabase
          .iamAttachmentScope,
      TARGET_PROJECT_RESOURCE,
  );
  assert.equal(
      JSON.stringify(ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT)
          .includes("collection"),
      false,
  );
});

test("B — steady and freeze roles pin exact permission sets", () => {
  assert.deepEqual(READ_ONLY_DATASTORE_PERMISSIONS, [
    "datastore.databases.get",
    "datastore.entities.get",
    "datastore.entities.list",
  ]);
  assert.deepEqual(WRITER_STEADY_DATASTORE_PERMISSIONS, [
    "datastore.databases.get",
    "datastore.entities.create",
    "datastore.entities.get",
    "datastore.entities.list",
    "datastore.entities.update",
  ]);
  assert.equal(
      WRITER_STEADY_ROLE,
      "projects/daegu-miami-production/roles/academyPrivateWriterRuntimeV1",
  );
  assert.equal(
      READ_ONLY_ROLE,
      "projects/daegu-miami-production/roles/academyBackendReadOnly",
  );
});

test("C — exact 35-function mapping has no wildcard or default", () => {
  assert.equal(DEPLOYED_FUNCTION_NAMES.length, 35);
  assert.equal(FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING.length, 35);
  assert.equal(new Set(DEPLOYED_FUNCTION_NAMES).size, 35);
  assert.equal(BASELINE_RUNTIME_FUNCTION_NAMES.length, 32);
  assert.deepEqual(WRITER_RUNTIME_FUNCTION_NAMES, [
    "commitFixedPrivateLessonOutcomeAction",
    "createFixedPrivateLessonAssignment",
  ]);
  assert.deepEqual(PREVIEW_RUNTIME_FUNCTION_NAMES, [
    "previewFixedPrivateLessonOutcomeAction",
  ]);
  const mapping = new Map(FUNCTION_RUNTIME_SERVICE_ACCOUNT_MAPPING.map(
      ({functionName, serviceAccountEmail}) =>
        [functionName, serviceAccountEmail],
  ));
  assert.equal(
      mapping.get("createFixedPrivateLessonAssignment"),
      WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  );
  assert.equal(
      mapping.get("commitFixedPrivateLessonOutcomeAction"),
      WRITER_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  );
  assert.equal(
      mapping.get("previewFixedPrivateLessonOutcomeAction"),
      PREVIEW_RUNTIME_SERVICE_ACCOUNT_EMAIL,
  );
  for (const functionName of BASELINE_RUNTIME_FUNCTION_NAMES) {
    assert.equal(
        mapping.get(functionName),
        BASELINE_RUNTIME_SERVICE_ACCOUNT_EMAIL,
    );
  }
  assert.equal(mapping.has("*"), false);
  assert.equal(mapping.has("default"), false);
});

test("D — state bindings and effective permissions are exact", () => {
  for (const state of [STEADY_STATE, FREEZE_ACTIVE_STATE]) {
    assert.equal(EXPECTED_BINDINGS_BY_STATE[state].length, 3);
    assert.equal(EXPECTED_PERMISSION_SETS_BY_STATE[state].length, 3);
    assert.doesNotThrow(() => validateStateSnapshot(
        clone(buildStateSnapshot(state)),
        state,
    ));
  }
  const previewPermissions = (state) =>
    EXPECTED_PERMISSION_SETS_BY_STATE[state].find(({member}) =>
      member === PREVIEW_RUNTIME_SERVICE_ACCOUNT_MEMBER).permissions;
  assert.deepEqual(
      previewPermissions(STEADY_STATE),
      READ_ONLY_DATASTORE_PERMISSIONS,
  );
  assert.deepEqual(
      previewPermissions(FREEZE_ACTIVE_STATE),
      READ_ONLY_DATASTORE_PERMISSIONS,
  );
});

test("E — canonical contract is deeply frozen and digest-bound", () => {
  function assertFrozen(value) {
    if (!value || typeof value !== "object") return;
    assert.equal(Object.isFrozen(value), true);
    Reflect.ownKeys(value).forEach((key) => assertFrozen(value[key]));
  }
  assertFrozen(ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT);
  const {contractDigest, ...projection} =
    ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT;
  assert.equal(canonicalDigest(projection), contractDigest);
  assert.equal(contractDigest, PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST);
  assert.equal(validatePrivateRuntimeIamContract(), true);
});

test("F — activation proves writer steady removal and read-only replacement",
    () => {
      const approval = approvalFixture();
      const receipt = activationFixture(approval);
      assert.equal(validateFreezeActivationReceipt(receipt, approval), false);
      assert.equal(
          receipt.before.bindingSetDigest,
          EXPECTED_BINDING_SET_DIGESTS_BY_STATE[STEADY_STATE],
      );
      assert.equal(
          receipt.after.bindingSetDigest,
          EXPECTED_BINDING_SET_DIGESTS_BY_STATE[FREEZE_ACTIVE_STATE],
      );
      assert.notEqual(
          receipt.before.permissionSetDigest,
          receipt.after.permissionSetDigest,
      );
    });

test("G — activation rejects stale approval and wrong transition digests", () => {
  const approval = approvalFixture();
  const stale = activationFixture(approval);
  stale.observedAt = "2026-07-19T03:00:00.001Z";
  refreshReceiptChronologyDigest(stale, approval);
  assert.throws(() => validateFreezeActivationReceipt(stale, approval));

  const wrongDigest = activationFixture(approval);
  wrongDigest.after.bindingSetDigest = "0".repeat(64);
  assert.throws(
      () => validateFreezeActivationReceipt(wrongDigest, approval),
      /digest mismatch/,
  );
});

test("H — unfreeze proves the exact reverse transition", () => {
  const approval = approvalFixture();
  const receipt = restorationFixture(approval);
  assert.equal(
      validateUnfreezeRestorationReceipt(receipt, approval),
      false,
  );
  assert.equal(
      receipt.before.permissionSetDigest,
      EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[FREEZE_ACTIVE_STATE],
  );
  assert.equal(
      receipt.after.permissionSetDigest,
      EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[STEADY_STATE],
  );
});

test("I — unfreeze requires IAM before scheduler, sentinel, and smoke", () => {
  const approval = approvalFixture();
  for (const mutate of [
    (receipt) => {
      receipt.chronology.iamRestoredAt = "2026-07-19T02:03:30Z";
    },
    (receipt) => {
      receipt.chronology.schedulerRestoredAt = "2026-07-19T02:03:30Z";
    },
    (receipt) => {
      receipt.chronology.positiveSmokeAt = "2026-07-19T02:02:30Z";
    },
  ]) {
    const receipt = restorationFixture(approval);
    mutate(receipt);
    refreshReceiptChronologyDigest(receipt, approval);
    assert.throws(
        () => validateUnfreezeRestorationReceipt(receipt, approval),
        /IAM restoration must precede/,
    );
  }
});

test("unfreeze chronology A — every stage inside JIT is accepted", () => {
  const approval = approvalFixture();
  assert.equal(
      validateUnfreezeRestorationReceipt(
          restorationFixture(approval),
          approval,
      ),
      false,
  );
});

test("unfreeze chronology B/C — expiry after IAM or smoke is rejected", () => {
  const approval = approvalFixture();
  for (const chronology of [
    {
      iamRestoredAt: "2026-07-19T03:01:00Z",
      schedulerRestoredAt: "2026-07-19T03:02:00Z",
      sentinelDeactivatedAt: "2026-07-19T03:03:00Z",
      positiveSmokeAt: "2026-07-19T03:04:00Z",
    },
    {
      iamRestoredAt: "2026-07-19T02:01:00Z",
      schedulerRestoredAt: "2026-07-19T02:02:00Z",
      sentinelDeactivatedAt: "2026-07-19T02:03:00Z",
      positiveSmokeAt: "2026-07-19T03:01:00Z",
    },
  ]) {
    const receipt = restorationFixture(approval);
    receipt.observedAt = "2026-07-19T02:59:59Z";
    receipt.chronology = chronology;
    refreshReceiptChronologyDigest(receipt, approval);
    assert.throws(
        () => validateUnfreezeRestorationReceipt(receipt, approval),
        /remain inside JIT/,
    );
  }
});

test("unfreeze chronology D/E — stages after observation are rejected", () => {
  const approval = approvalFixture();
  for (const chronology of [
    {
      iamRestoredAt: "2026-07-19T02:06:00Z",
      schedulerRestoredAt: "2026-07-19T02:07:00Z",
      sentinelDeactivatedAt: "2026-07-19T02:08:00Z",
      positiveSmokeAt: "2026-07-19T02:09:00Z",
    },
    {
      iamRestoredAt: "2026-07-19T02:01:00Z",
      schedulerRestoredAt: "2026-07-19T02:02:00Z",
      sentinelDeactivatedAt: "2026-07-19T02:03:00Z",
      positiveSmokeAt: "2026-07-19T02:06:00Z",
    },
  ]) {
    const receipt = restorationFixture(approval);
    receipt.observedAt = "2026-07-19T02:05:00Z";
    receipt.chronology = chronology;
    refreshReceiptChronologyDigest(receipt, approval);
    assert.throws(
        () => validateUnfreezeRestorationReceipt(receipt, approval),
        /remain inside JIT/,
    );
  }
});

test("unfreeze chronology F — start is inclusive and expiry is exclusive",
    () => {
      const approval = approvalFixture();
      const atStart = restorationFixture(approval);
      atStart.observedAt = approval.jitStartsAt;
      for (const key of Object.keys(atStart.chronology)) {
        atStart.chronology[key] = approval.jitStartsAt;
      }
      refreshReceiptChronologyDigest(atStart, approval);
      assert.equal(
          validateUnfreezeRestorationReceipt(atStart, approval),
          false,
      );

      const atExpiry = restorationFixture(approval);
      atExpiry.observedAt = approval.jitExpiresAt;
      for (const key of Object.keys(atExpiry.chronology)) {
        atExpiry.chronology[key] = approval.jitExpiresAt;
      }
      refreshReceiptChronologyDigest(atExpiry, approval);
      assert.throws(
          () => validateUnfreezeRestorationReceipt(atExpiry, approval),
          /JIT window/,
      );
    });

test("unfreeze chronology H — coherent timestamp digest tamper is rejected",
    () => {
      const approval = approvalFixture();
      const receipt = restorationFixture(approval);
      const originalReceiptDigest = canonicalDigest(receipt);
      receipt.chronology.positiveSmokeAt = "2026-07-19T03:01:00Z";
      receipt.observedAt = "2026-07-19T02:59:59Z";
      refreshReceiptChronologyDigest(receipt, approval);
      const tamperedReceiptDigest = canonicalDigest(receipt);
      assert.notEqual(tamperedReceiptDigest, originalReceiptDigest);
      assert.throws(
          () => validateUnfreezeRestorationReceipt(receipt, approval),
          /remain inside JIT/,
      );
    });

test("nanosecond A-C — exact two-hour duration boundaries", () => {
  const start = "2026-07-19T01:00:00.000000000Z";
  for (const [expiry, accepted] of [
    ["2026-07-19T03:00:00.000000000Z", true],
    ["2026-07-19T03:00:00.000000001Z", false],
    ["2026-07-19T02:59:59.999999999Z", true],
  ]) {
    const approval = approvalFixture({
      jitStartsAt: start,
      jitExpiresAt: expiry,
    });
    const validate = () => validateExecutableApproval(approval, {
      currentTimestamp: "2026-07-19T02:00:00.000000000Z",
    });
    if (accepted) {
      assert.equal(validate().executable, false);
    } else {
      assert.throws(validate, /longer than 2 hours/);
    }
  }
  assert.equal(
      exactDurationNanoseconds(
          start,
          "2026-07-19T03:00:00.000000000Z",
      ).toString(),
      MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
  );
});

test("nanosecond D/E — expiry is exclusive and start is inclusive", () => {
  const approval = approvalFixture({
    jitStartsAt: "2026-07-19T01:00:00.000000000Z",
    jitExpiresAt: "2026-07-19T03:00:00.000000000Z",
  });
  const atStart = restorationFixture(approval);
  atStart.observedAt = approval.jitStartsAt;
  for (const key of Object.keys(atStart.chronology)) {
    atStart.chronology[key] = approval.jitStartsAt;
  }
  refreshReceiptChronologyDigest(atStart, approval);
  assert.equal(validateUnfreezeRestorationReceipt(atStart, approval), false);

  const atExpiry = restorationFixture(approval);
  atExpiry.observedAt = approval.jitExpiresAt;
  for (const key of Object.keys(atExpiry.chronology)) {
    atExpiry.chronology[key] = approval.jitExpiresAt;
  }
  refreshReceiptChronologyDigest(atExpiry, approval);
  assert.throws(
      () => validateUnfreezeRestorationReceipt(atExpiry, approval),
      /JIT window/,
  );
});

test("nanosecond F/G — one-nanosecond stage inversions reject", () => {
  const approval = approvalFixture({
    jitStartsAt: "2026-07-19T01:30:00.000000000Z",
    jitExpiresAt: "2026-07-19T03:30:00.000000000Z",
  });
  const stageInversion = restorationFixture(approval);
  stageInversion.chronology = {
    iamRestoredAt: "2026-07-19T03:00:00.000000002Z",
    schedulerRestoredAt: "2026-07-19T03:00:00.000000001Z",
    sentinelDeactivatedAt: "2026-07-19T03:00:00.000000003Z",
    positiveSmokeAt: "2026-07-19T03:00:00.000000004Z",
  };
  stageInversion.observedAt = "2026-07-19T03:00:00.000000005Z";
  refreshReceiptChronologyDigest(stageInversion, approval);
  assert.throws(
      () => validateUnfreezeRestorationReceipt(stageInversion, approval),
      /must precede/,
  );

  const smokeInversion = restorationFixture(approval);
  smokeInversion.chronology = {
    iamRestoredAt: "2026-07-19T01:59:59.999999999Z",
    schedulerRestoredAt: "2026-07-19T02:00:00.000000000Z",
    sentinelDeactivatedAt: "2026-07-19T02:00:00.000000001Z",
    positiveSmokeAt: "2026-07-19T02:00:00.000000002Z",
  };
  smokeInversion.observedAt = "2026-07-19T02:00:00.000000001Z";
  refreshReceiptChronologyDigest(smokeInversion, approval);
  assert.throws(
      () => validateUnfreezeRestorationReceipt(smokeInversion, approval),
      /must precede/,
  );
});

test("nanosecond H/I — activation, expiry, and Org Policy chronology reject",
    () => {
      const approval = approvalFixture({
        jitStartsAt: "2026-07-19T01:00:00.000000001Z",
        jitExpiresAt: "2026-07-19T03:00:00.000000001Z",
      });
      const activation = activationFixture(approval);
      activation.observedAt = "2026-07-19T01:00:00.000000000Z";
      refreshReceiptChronologyDigest(activation, approval);
      assert.throws(
          () => validateFreezeActivationReceipt(activation, approval),
          /JIT window/,
      );

      const afterExpiry = restorationFixture(approval);
      afterExpiry.observedAt = "2026-07-19T02:59:59.999999999Z";
      afterExpiry.chronology.positiveSmokeAt =
        "2026-07-19T03:00:00.000000002Z";
      refreshReceiptChronologyDigest(afterExpiry, approval);
      assert.throws(
          () => validateUnfreezeRestorationReceipt(afterExpiry, approval),
          /must precede/,
      );

      const orgPolicyInversion = approvalFixture({
        approvedAt: "2026-07-19T00:30:00.000000001Z",
        organizationPolicy: {
          observationStatus: "ALLOW",
          apiEnabled: true,
          effectivePolicyCount: 1,
          observedAt: "2026-07-19T00:30:00.000000002Z",
          evidenceDigest: "",
        },
      });
      assert.throws(() => validateExecutableApproval(
          orgPolicyInversion,
          {currentTimestamp: "2026-07-19T02:00:00Z"},
      ), /Organization Policy evidence/);
    });

test("nanosecond J/K — fractional precision is exact from 4 through 9",
    () => {
      for (let digits = 4; digits <= 9; digits += 1) {
        const left =
          `2026-07-19T02:00:00.${"0".repeat(digits - 1)}1Z`;
        const right =
          `2026-07-19T02:00:00.${"0".repeat(digits - 1)}2Z`;
        assert.equal(
            parseExactRfc3339UtcNanoseconds(left).fractionalDigitCount,
            digits,
        );
        assert.equal(compareExactRfc3339UtcInstants(left, right), -1);
      }
      assert.throws(
          () => parseExactRfc3339UtcNanoseconds(
              "2026-07-19T02:00:00.0000000001Z",
          ),
          /exact RFC3339 UTC/,
      );
      assert.throws(
          () => parseExactRfc3339UtcNanoseconds(
              "2026-02-29T02:00:00.000000000Z",
          ),
          /not a real timestamp/,
      );
    });

test("nanosecond L/M — coherent digest tamper rejects and equal stages pass",
    () => {
      const invalidApproval = approvalFixture({
        jitStartsAt: "2026-07-19T01:00:00.000000000Z",
        jitExpiresAt: "2026-07-19T03:00:00.000000001Z",
      });
      assert.match(invalidApproval.approvalDigest, /^[a-f0-9]{64}$/);
      assert.throws(
          () => validateExecutableApproval(invalidApproval, {
            currentTimestamp: "2026-07-19T02:00:00.000000000Z",
          }),
          /longer than 2 hours/,
      );

      const approval = approvalFixture({
        jitStartsAt: "2026-07-19T01:00:00.000000000Z",
        jitExpiresAt: "2026-07-19T03:00:00.000000000Z",
      });
      const equalStages = restorationFixture(approval);
      equalStages.observedAt = "2026-07-19T02:00:00.000000001Z";
      for (const key of Object.keys(equalStages.chronology)) {
        equalStages.chronology[key] =
          "2026-07-19T02:00:00.000000001Z";
      }
      refreshReceiptChronologyDigest(equalStages, approval);
      assert.equal(
          validateUnfreezeRestorationReceipt(equalStages, approval),
          false,
      );
      assert.equal(
          ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT.exactChronologyProfile
              .profileVersion,
          EXACT_CHRONOLOGY_PROFILE_VERSION,
      );
    });

test("S — unresolved source principals require exact receipt users and JIT",
    () => {
  const approval = approvalFixture();
  const result = validateExecutableApproval(approval, {currentTimeMs: NOW});
  assert.equal(result.executable, false);
  assert.equal(result.jitActive, true);
  assert.deepEqual(result.execution, {
    actualProvisioningEligible: false,
    deploymentApprovalEligible: false,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: false,
  });
  assert.equal(result.approvalDigest, approval.approvalDigest);
  assert.deepEqual(
      ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT.executionPrincipalReceipt,
      {
        fields: EXECUTION_PRINCIPAL_RECEIPT_FIELDS,
        resolution: "EXACT_RECEIPT_REQUIRED_NO_SOURCE_DEFAULT",
        placeholderDisposition: "REJECT",
        inferredCurrentUserDisposition: "REJECT",
        operatorModeAuthority: OPERATOR_MODE_AUTHORITY,
      },
  );
  assert.equal(
      JSON.stringify(ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT)
          .includes("miamidaegu@gmail.com"),
      true,
  );
});

test("T — approval rejects non-user and placeholder principals",
    () => {
      for (const member of [
        "",
        "serviceAccount:runtime@daegu-miami-production.iam.gserviceaccount.com",
        "user:TODO@daegu-miami.com",
        "user:operator@example.com",
        "user:<operator>@daegu-miami.com",
        "user:REPLACE_ME@daegu-miami.com",
      ]) {
        const approval = approvalFixture();
        approval.provisioningPrincipal = member;
        approval.approvalDigest = buildExecutableApprovalDigest(approval);
        assert.throws(() =>
          validateExecutableApproval(approval, {currentTimeMs: NOW}));
      }
      const sameApprovedUser = approvalFixture();
      sameApprovedUser.impersonationPrincipal =
        sameApprovedUser.provisioningPrincipal;
      sameApprovedUser.approvalDigest =
        buildExecutableApprovalDigest(sameApprovedUser);
      assert.throws(() => validateExecutableApproval(
          sameApprovedUser,
          {currentTimeMs: NOW},
      ), /distinct exact receipt users/);
    });

test("principal grammar A-L — strict ASCII dot-atom and exact principals", () => {
  for (const principal of [
    "user:miamidaegu@gmail.com",
    "user:runtime.provisioner@daegu-miami.com",
    "user:runtime.provisioner+freeze@daegu-miami.com",
  ]) {
    assert.equal(parseExactUserPrincipal(principal).principal, principal);
  }
  for (const principal of [
    "user:runtime..provisioner@daegu-miami.com",
    "user:.runtime@daegu-miami.com",
    "user:runtime.@daegu-miami.com",
    "user:runtime@@daegu-miami.com",
    "user:@daegu-miami.com",
    "user:runtime@",
    "user:runtime@-daegu-miami.com",
    "user:runtime@daegu-miami-.com",
    "user:runtime@daegu..com",
    "user: runtime@daegu-miami.com",
    "user:runtime@daegu-miami.com ",
    "user:runtime\u0000@daegu-miami.com",
    "user:runtimé@daegu-miami.com",
    "user:\"runtime\"@daegu-miami.com",
    "user:runtime@[127.0.0.1]",
    "group:runtime@daegu-miami.com",
    "domain:daegu-miami.com",
    "serviceAccount:runtime@daegu-miami.com",
    "allUsers",
    "allAuthenticatedUsers",
    "",
    null,
  ]) {
    assert.throws(() => parseExactUserPrincipal(principal));
  }

  const exactReceiptCase = approvalFixture();
  exactReceiptCase.provisioningPrincipal =
    "user:Provisioner@daegu-miami.com";
  exactReceiptCase.approvalDigest =
    buildExecutableApprovalDigest(exactReceiptCase);
  assert.equal(
      validateExecutableApproval(
          exactReceiptCase,
          {currentTimeMs: NOW},
      ).provisioningPrincipal,
      exactReceiptCase.provisioningPrincipal,
  );

  for (const key of EXECUTION_PRINCIPAL_RECEIPT_FIELDS) {
    const malformed = approvalFixture();
    malformed[key] = "user:runtime..provisioner@daegu-miami.com";
    malformed.approvalDigest = buildExecutableApprovalDigest(malformed);
    assert.throws(() => validateExecutableApproval(
        malformed,
        {currentTimeMs: NOW},
    ), /dot-atom/);
  }
});

test("U — approval rejects inactive, non-UTC, and over-two-hour JIT", () => {
  const mutations = [
    (approval) => {
      approval.jitExpiresAt = "2026-07-19T03:00:00+00:00";
    },
    (approval) => {
      approval.jitExpiresAt = "2026-07-19T03:00:00.001Z";
    },
    (approval) => {
      approval.jitExpiresAt = "2026-07-19T03:00:01Z";
    },
  ];
  const validationTimes = [NOW, Date.parse("2026-07-19T03:00:00.002Z"), NOW];
  mutations.forEach((mutate, index) => {
    const approval = approvalFixture();
    assert.throws(() => {
      mutate(approval);
      approval.approvalDigest = buildExecutableApprovalDigest(approval);
      validateExecutableApproval(approval, {
        currentTimeMs: validationTimes[index],
      });
    });
  });
});

test("V — compatible Org Policy alone leaves commands unpublished", () => {
  const approval = approvalFixture();
  const result = validateExecutableApproval(approval, {currentTimeMs: NOW});
  assert.equal(result.executable, false);
  assert.deepEqual(result.execution, {
    actualProvisioningEligible: false,
    deploymentApprovalEligible: false,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: false,
  });
  assert.equal(
      validateFreezeActivationReceipt(activationFixture(approval), approval),
      false,
  );
});

test("all exact execution inputs may become eligible", () => {
  const approval = approvalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: true,
    iamMutationCommandPublication: true,
  });
  const result = validateExecutableApproval(approval, {currentTimeMs: NOW});
  assert.equal(result.executable, true);
  assert.deepEqual(result.execution, {
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: true,
    iamMutationCommandPublication: true,
  });
  assert.equal(result.userManagedServiceAccountKeyCount, 0);
});

test("missing principal or JIT cannot become provisioning-eligible", () => {
  for (const field of [
    ...EXECUTION_PRINCIPAL_RECEIPT_FIELDS,
    "jitStartsAt",
    "jitExpiresAt",
  ]) {
    const approval = approvalFixture({
      actualProvisioningEligible: true,
      deploymentApprovalEligible: true,
      publicInvokerApprovalEligible: true,
      iamMutationCommandPublication: true,
    });
    delete approval[field];
    assert.throws(
        () => validateExecutableApproval(approval, {currentTimeMs: NOW}),
    );
  }
});

test("user-managed key count above zero rejects despite policy compatibility",
    () => {
      const approval = approvalFixture({
        actualProvisioningEligible: true,
        deploymentApprovalEligible: true,
        publicInvokerApprovalEligible: true,
        iamMutationCommandPublication: true,
      });
      approval.serviceAccountKeyAudit.userManagedKeyCount = 1;
      approval.approvalDigest = buildExecutableApprovalDigest(approval);
      assert.throws(
          () => validateExecutableApproval(approval, {currentTimeMs: NOW}),
          /zero keys/,
      );
    });

test("cross-project service account audit is rejected", () => {
  const approval = approvalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: true,
    iamMutationCommandPublication: true,
  });
  approval.serviceAccountKeyAudit.serviceAccountEmails[0] =
    "foreign-build@other-project.iam.gserviceaccount.com";
  approval.approvalDigest = buildExecutableApprovalDigest(approval);
  assert.throws(
      () => validateExecutableApproval(approval, {currentTimeMs: NOW}),
      /exact identities and zero keys/,
  );
});

test("operator mode A — three-person separation accepts distinct users", () => {
  const approval = approvalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: true,
    iamMutationCommandPublication: true,
  });
  const result = validateExecutableApproval(approval, {currentTimeMs: NOW});
  assert.equal(result.operatorMode, THREE_PERSON_SEPARATION);
  assert.equal(result.executable, true);
});

test("operator mode B — three-person separation rejects one user", () => {
  const approval = approvalFixture();
  approval.impersonationPrincipal = approval.provisioningPrincipal;
  approval.approvalDigest = buildExecutableApprovalDigest(approval);
  assert.throws(
      () => validateExecutableApproval(approval, {currentTimeMs: NOW}),
      /distinct exact receipt users/,
  );
});

test("operator mode C — exact approved single operator is structural", () => {
  const approval = singleOperatorApprovalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: true,
  });
  const result = validateExecutableApproval(approval, {
    currentTimestamp: "2026-07-19T01:30:00Z",
  });
  assert.equal(result.operatorMode, SINGLE_OPERATOR_JIT_V1);
  assert.equal(
      result.operatorModeContractVersion,
      OPERATOR_MODE_CONTRACT_VERSION,
  );
  assert.equal(result.executable, true);
  assert.equal(result.publicInvokerRequiresSeparateReceipt, true);
  assert.equal(result.execution.publicInvokerApprovalEligible, false);
});

test("operator mode D — one different single-operator field rejects", () => {
  const approval = singleOperatorApprovalFixture();
  approval.invokerOperatorPrincipal = "user:invoker@daegu-miami.com";
  approval.approvalDigest = buildExecutableApprovalDigest(approval);
  assert.throws(
      () => validateExecutableApproval(approval, {
        currentTimestamp: "2026-07-19T01:30:00Z",
      }),
      /exact approved principal tuple/,
  );
});

test("operator mode E — another repeated user rejects", () => {
  const another = "user:another@gmail.com";
  const approval = singleOperatorApprovalFixture({
    provisioningPrincipal: another,
    impersonationPrincipal: another,
    invokerOperatorPrincipal: another,
  });
  assert.throws(
      () => validateExecutableApproval(approval, {
        currentTimestamp: "2026-07-19T01:30:00Z",
      }),
      /exact approved principal tuple/,
  );
});

test("operator mode F — a missing mode fails closed", () => {
  const approval = approvalFixture();
  delete approval.operatorMode;
  assert.throws(
      () => validateExecutableApproval(approval, {currentTimeMs: NOW}),
      /exact key set mismatch/,
  );
  assert.equal(OPERATOR_MODE_AUTHORITY.missingModeDisposition, "REJECT");
});

test("operator mode G — malformed and non-user principals reject", () => {
  for (const principal of [
    "",
    "user:TODO@gmail.com",
    "user:miamidaegu@@gmail.com",
    "group:miamidaegu@gmail.com",
    "serviceAccount:miamidaegu@gmail.com",
  ]) {
    const approval = singleOperatorApprovalFixture({
      provisioningPrincipal: principal,
      impersonationPrincipal: principal,
      invokerOperatorPrincipal: principal,
    });
    assert.throws(() => validateExecutableApproval(approval, {
      currentTimestamp: "2026-07-19T01:30:00Z",
    }));
  }
});

test("operator mode H — exact 60-minute JIT is accepted", () => {
  const approval = singleOperatorApprovalFixture();
  const result = validateExecutableApproval(approval, {
    currentTimestamp: "2026-07-19T01:30:00Z",
  });
  assert.equal(result.jitActive, true);
  assert.equal(
      SINGLE_OPERATOR_MAX_JIT_DURATION_NANOSECONDS_DECIMAL,
      "3600000000000",
  );
});

test("operator mode I — 60 minutes plus 1ns rejects", () => {
  const approval = singleOperatorApprovalFixture({
    jitExpiresAt: "2026-07-19T02:00:00.000000001Z",
  });
  assert.throws(
      () => validateExecutableApproval(approval, {
        currentTimestamp: "2026-07-19T01:30:00Z",
      }),
      /operator-mode maximum/,
  );
});

test("operator mode J — public invoker before private validation rejects", () => {
  const approval = singleOperatorApprovalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: true,
    iamMutationCommandPublication: true,
  });
  assert.throws(
      () => validateExecutableApproval(approval, {
        currentTimestamp: "2026-07-19T01:30:00Z",
      }),
      /fail closed/,
  );
});

test("operator mode K — separate private and publication receipts pass", () => {
  const approval = singleOperatorApprovalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: true,
  });
  const privateReceipt = singleOperatorPrivateValidationFixture(approval);
  const privateResult = validateSingleOperatorPrivateValidationReceipt(
      privateReceipt,
      approval,
  );
  assert.equal(privateResult.publicInvokerEligible, false);
  const publicationReceipt =
    singleOperatorPublicationFixture(approval, privateReceipt);
  const publicationResult =
    validateSingleOperatorInvokerPublicationReceipt(
        publicationReceipt,
        approval,
        privateReceipt,
    );
  assert.equal(publicationResult.publicInvokerEligible, true);
  const completionReceipt =
    singleOperatorCompletionFixture(approval, publicationReceipt);
  assert.equal(
      validateSingleOperatorCompletionReceipt(
          completionReceipt,
          approval,
          privateReceipt,
          publicationReceipt,
      ).temporaryAccessRemoved,
      true,
  );
});

test("operator mode L — missing temporary-removal evidence rejects", () => {
  const approval = singleOperatorApprovalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: true,
  });
  const privateReceipt = singleOperatorPrivateValidationFixture(approval);
  const publicationReceipt =
    singleOperatorPublicationFixture(approval, privateReceipt);
  const completionReceipt =
    singleOperatorCompletionFixture(approval, publicationReceipt);
  delete completionReceipt.temporaryAccessRemovalEvidence;
  completionReceipt.receiptDigest =
    buildSingleOperatorCompletionReceiptDigest(completionReceipt);
  assert.throws(() => validateSingleOperatorCompletionReceipt(
      completionReceipt,
      approval,
      privateReceipt,
      publicationReceipt,
  ));
});

test("operator mode M — rollback or secure audit manifest missing rejects", () => {
  for (const mutate of [
    (manifest) => delete manifest.productionApprovalReferenceDigest,
    (manifest) => delete manifest.rollbackManifestDigest,
    (manifest) => delete manifest.secureAuditArtifact,
  ]) {
    const approval = singleOperatorApprovalFixture();
    mutate(approval.singleOperatorControlManifest);
    approval.approvalDigest = buildExecutableApprovalDigest(approval);
    assert.throws(() => validateExecutableApproval(approval, {
      currentTimestamp: "2026-07-19T01:30:00Z",
    }));
  }
});

test("operator mode N — coherent semantic tamper rejects", () => {
  const tamperedMode = singleOperatorApprovalFixture();
  tamperedMode.operatorMode = THREE_PERSON_SEPARATION;
  tamperedMode.approvalDigest = buildExecutableApprovalDigest(tamperedMode);
  assert.throws(() => validateExecutableApproval(tamperedMode, {
    currentTimestamp: "2026-07-19T01:30:00Z",
  }));

  const tamperedReceiptApproval = singleOperatorApprovalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: true,
  });
  const privateReceipt =
    singleOperatorPrivateValidationFixture(tamperedReceiptApproval);
  privateReceipt.stepCompletions[0].stepId =
    SINGLE_OPERATOR_PRIVATE_VALIDATION_STEPS[1];
  privateReceipt.receiptDigest =
    buildSingleOperatorPrivateValidationReceiptDigest(privateReceipt);
  assert.throws(() => validateSingleOperatorPrivateValidationReceipt(
      privateReceipt,
      tamperedReceiptApproval,
  ), /step order/);
});

test("operator mode O — legacy three-person transitions still pass", () => {
  const approval = approvalFixture({
    actualProvisioningEligible: true,
    deploymentApprovalEligible: true,
    publicInvokerApprovalEligible: true,
    iamMutationCommandPublication: true,
  });
  assert.equal(
      validateFreezeActivationReceipt(activationFixture(approval), approval),
      true,
  );
});

test("Organization Policy lineage M-X — exact 21-record source is authoritative",
    () => {
  const matching = approvalFixture();
  const matchingResult =
    validateExecutableApproval(matching, {currentTimeMs: NOW});
  assert.equal(matchingResult.executable, false);
  assert.equal(
      validateFreezeActivationReceipt(activationFixture(matching), matching),
      false,
  );

  for (const mutate of [
    (approval) => {
      approval.organizationPolicy.effectivePolicies.count = 20;
      approval.organizationPolicy.evidenceDigest =
        buildOrganizationPolicyEvidenceDigest(approval.organizationPolicy);
    },
    (approval) => {
      approval.organizationPolicy.effectivePolicies.records[0]
          .spec.rules[0].enforce = false;
      approval.organizationPolicy.evidenceDigest =
        buildOrganizationPolicyEvidenceDigest(approval.organizationPolicy);
    },
    (approval) => {
      approval.organizationPolicyLineage.organizationPolicyEvidenceDigest =
        "0".repeat(64);
    },
    (approval) => {
      approval.organizationPolicyLineage.organizationPolicyObservationStatus =
        "ALLOW";
      approval.organizationPolicyLineage.organizationPolicyEffectiveDecision =
        "ALLOW";
    },
  ]) {
    const approval = approvalFixture();
    mutate(approval);
    approval.approvalDigest = buildExecutableApprovalDigest(approval);
    assert.throws(() => validateExecutableApproval(
        approval,
        {currentTimeMs: NOW},
    ));
  }

  for (const organizationPolicyLineage of [null, undefined]) {
    const approval = approvalFixture();
    if (organizationPolicyLineage === undefined) {
      delete approval.organizationPolicyLineage;
      assert.throws(() => validateExecutableApproval(
          approval,
          {currentTimeMs: NOW},
      ));
    } else {
      approval.organizationPolicyLineage = organizationPolicyLineage;
      approval.approvalDigest = buildExecutableApprovalDigest(approval);
      assert.throws(() => validateExecutableApproval(
          approval,
          {currentTimeMs: NOW},
      ));
    }
  }

  const genericAllowReceipt = clone(ORGANIZATION_POLICY_EVIDENCE);
  genericAllowReceipt.observationStatus = "ALLOW";
  genericAllowReceipt.effectiveDecision = "ALLOW";
  genericAllowReceipt.evidenceDigest =
    buildOrganizationPolicyEvidenceDigest(genericAllowReceipt);
  const futureCanonicalSource = {
    ...genericAllowReceipt,
    contractVersion: "academy_functions_organization_policy_evidence.v4",
  };
  futureCanonicalSource.evidenceDigest =
    buildOrganizationPolicyEvidenceDigest(futureCanonicalSource);
  assert.notEqual(
      futureCanonicalSource.evidenceDigest,
      ORGANIZATION_POLICY_EVIDENCE.evidenceDigest,
  );
  assert.throws(() => validateExecutableApproval(
      approvalFixture({organizationPolicy: futureCanonicalSource}),
      {currentTimeMs: NOW},
  ), /Organization Policy evidence/);
});

test("W — state validation rejects unknown, inherited, conditional, and writes",
    () => {
      const unknown = clone(buildStateSnapshot(FREEZE_ACTIVE_STATE));
      unknown.principalPermissions[0].permissions.push(
          "datastore.entities.delete",
      );
      unknown.permissionSetDigest =
        buildPermissionSetDigest(unknown.principalPermissions);
      assert.throws(() => validateStateSnapshot(unknown, FREEZE_ACTIVE_STATE),
          /unknown permission/);

      const inherited = clone(buildStateSnapshot(FREEZE_ACTIVE_STATE));
      inherited.bindings[0].inherited = true;
      inherited.bindingSetDigest = buildBindingSetDigest(inherited.bindings);
      assert.throws(() =>
        validateStateSnapshot(inherited, FREEZE_ACTIVE_STATE), /inherited/);

      const conditional = clone(buildStateSnapshot(FREEZE_ACTIVE_STATE));
      conditional.bindings[0].condition = {expression: "request.time < now"};
      conditional.bindingSetDigest = buildBindingSetDigest(
          conditional.bindings,
      );
      assert.throws(() =>
        validateStateSnapshot(conditional, FREEZE_ACTIVE_STATE), /conditional/);

      const writable = clone(buildStateSnapshot(FREEZE_ACTIVE_STATE));
      writable.principalPermissions.find(({member}) =>
        member === WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER).permissions.push(
          WRITABLE_DATASTORE_PERMISSIONS[0],
      );
      writable.permissionSetDigest =
        buildPermissionSetDigest(writable.principalPermissions);
      assert.throws(() =>
        validateStateSnapshot(writable, FREEZE_ACTIVE_STATE), /exact/);
    });

test("X — canonical set digests are order invariant", () => {
  for (const state of [STEADY_STATE, FREEZE_ACTIVE_STATE]) {
    const bindings = clone(EXPECTED_BINDINGS_BY_STATE[state]).reverse();
    const permissions =
      clone(EXPECTED_PERMISSION_SETS_BY_STATE[state]).reverse();
    permissions.forEach((record) => record.permissions.reverse());
    assert.equal(
        buildBindingSetDigest(bindings),
        EXPECTED_BINDING_SET_DIGESTS_BY_STATE[state],
    );
    assert.equal(
        buildPermissionSetDigest(permissions),
        EXPECTED_PERMISSION_SET_DIGESTS_BY_STATE[state],
    );
  }
  assert.equal(
      buildCanonicalSetDigest(["b", "a"], "fixture"),
      buildCanonicalSetDigest(["a", "b"], "fixture"),
  );
});

test("Y — exact state and contract digests reject direct tampering", () => {
  assert.deepEqual(APPROVED_DATASTORE_PERMISSION_UNIVERSE, [
    "datastore.databases.get",
    "datastore.entities.create",
    "datastore.entities.get",
    "datastore.entities.list",
    "datastore.entities.update",
  ]);
  const contract = clone(ACADEMY_PRIVATE_RUNTIME_IAM_CONTRACT);
  contract.firestoreDatabase.locationId = "us-central1";
  const {contractDigest: ignored, ...projection} = contract;
  contract.contractDigest = canonicalDigest(projection);
  assert.throws(() => validatePrivateRuntimeIamContract(contract));
});

test("Z — coherent set-and-digest tampering still fails closed", () => {
  const approval = approvalFixture();
  const receipt = activationFixture(approval);
  const writer = receipt.after.principalPermissions.find(({member}) =>
    member === WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER);
  writer.permissions.push("datastore.entities.update");
  writer.permissions.sort();
  receipt.after.permissionSetDigest =
    buildPermissionSetDigest(receipt.after.principalPermissions);
  assert.throws(
      () => validateFreezeActivationReceipt(receipt, approval),
      /exact freeze_active permissions/,
  );

  const bindingReceipt = activationFixture(approval);
  bindingReceipt.after.bindings.find(({member}) =>
    member === WRITER_RUNTIME_SERVICE_ACCOUNT_MEMBER).role =
      WRITER_STEADY_ROLE;
  bindingReceipt.after.bindingSetDigest =
    buildBindingSetDigest(bindingReceipt.after.bindings);
  assert.throws(
      () => validateFreezeActivationReceipt(bindingReceipt, approval),
      /exact freeze_active bindings/,
  );
});
