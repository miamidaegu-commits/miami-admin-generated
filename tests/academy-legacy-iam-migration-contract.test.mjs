import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY,
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
  DECOMMISSION_PLAN,
  DEFERRED_LEGACY_IAM_RECORDS,
  EXPECTED_ACADEMY_SERVICE_ACCOUNTS,
  EXPECTED_CUSTOM_ROLE_DEFINITIONS,
  FINAL_STEADY_STATE,
  LEGACY_IAM_BASELINE_DIGEST,
  LEGACY_IAM_BASELINE_RECORDS,
  MIGRATION_PHASES,
  PERMANENT_BINDINGS,
  POST_PRIVATE_DEPLOY_PRE_PUBLICATION,
  POST_PROVISIONING_PRE_DEPLOY,
  POST_PUBLICATION_PRE_CLEANUP,
  PRE_PROVISIONING,
  REVIEWED_MANAGED_IDENTITY_BINDINGS,
  TEMPORARY_BINDINGS,
  buildBindingSetDigest,
  buildFinalIamAudit,
  buildFinalIamAuditDigest,
  buildFunctionStateDigest,
  buildPhaseEvidence,
  buildPhaseEvidenceDigest,
  buildPublicationReceipt,
  buildRecordDigest,
  buildResourceState,
  buildResourceStateDigest,
  buildRollbackReceipt,
  buildRollbackReceiptDigest,
  canonicalSetDigest,
  classifyManagedIdentityBinding,
  validateFinalIamAudit,
  validateLeastPrivilegeProofBindings,
  validateLegacyIamBaselineSet,
  validateMigrationAuthority,
  validatePhaseEvidence,
  validateResourceState,
  validateReviewedManagedIdentitySet,
  validateRollbackReceipt,
} from "../functions/scripts/academy-legacy-iam-migration-contract.mjs";

function clone(value) {
  return structuredClone(value);
}

function binding(member, role, scope = "projects/daegu-miami-production") {
  const record = {scope, member, role, condition: null, recordDigest: ""};
  record.recordDigest = buildRecordDigest(record);
  return record;
}

function refreshLegacyRecord(record) {
  record.baselineRecordDigest =
    buildRecordDigest(record, "baselineRecordDigest");
}

function refreshResourceState(state) {
  state.stateDigest = buildResourceStateDigest(state);
}

function refreshPhaseEvidence(evidence) {
  evidence.evidenceDigest = buildPhaseEvidenceDigest(evidence);
}

function refreshRollback(receipt) {
  receipt.beforeBindingSetDigest = canonicalSetDigest(
      receipt.beforeRecords,
      "rollback_before_bindings",
  );
  receipt.restoredBindingSetDigest = canonicalSetDigest(
      receipt.restoredRecords,
      "rollback_restored_bindings",
  );
  receipt.afterBindingSetDigest = canonicalSetDigest(
      receipt.afterRecords,
      "rollback_after_bindings",
  );
  receipt.receiptDigest = buildRollbackReceiptDigest(receipt);
}

function refreshFinalAudit(audit) {
  audit.bindingSetDigest = canonicalSetDigest([
    ...audit.projectBindings,
    ...audit.serviceAccountPolicies.flatMap(({bindings}) => bindings),
    ...audit.sourceBucketPolicy.bindings,
    ...audit.uploadBucketPolicy.bindings,
    ...audit.repositoryPolicy.bindings,
    ...audit.runInvokerBindings,
  ], "final_complete_binding_set");
  audit.projectBindingSetDigest = canonicalSetDigest(
      audit.projectBindings,
      "final_project_bindings",
  );
  audit.serviceAccountPolicySetDigest = canonicalSetDigest(
      audit.serviceAccountPolicies,
      "final_service_account_policies",
  );
  audit.resourcePolicySetDigest = canonicalSetDigest([
    audit.sourceBucketPolicy,
    audit.uploadBucketPolicy,
    audit.repositoryPolicy,
  ], "final_resource_policies");
  audit.roleDefinitionSetDigest = canonicalSetDigest(
      audit.roleDefinitions,
      "final_role_definitions",
  );
  audit.effectivePermissionDigest = canonicalSetDigest(
      audit.effectivePermissionRecords,
      "final_effective_permissions",
  );
  audit.legacyExceptionDigest = canonicalSetDigest(
      audit.legacyExceptions,
      "final_legacy_exceptions",
  );
  audit.reviewedManagedIdentityDigest = canonicalSetDigest(
      audit.reviewedManagedBindings,
      "final_reviewed_managed_bindings",
  );
  audit.temporaryAccessCount = audit.temporaryAccessBindings.length;
  audit.temporaryAccessDigest = canonicalSetDigest(
      audit.temporaryAccessBindings,
      "final_temporary_access",
  );
  audit.finalInventoryDigest = audit.functionState.inventoryDigest;
  audit.auditDigest = buildFinalIamAuditDigest(audit);
}

test("A — exact three-record PRE_PROVISIONING baseline is accepted", () => {
  assert.equal(
      validateLegacyIamBaselineSet(
          clone(LEGACY_IAM_BASELINE_RECORDS),
          PRE_PROVISIONING,
      ),
      true,
  );
  assert.equal(LEGACY_IAM_BASELINE_RECORDS.length, 3);
  assert.match(LEGACY_IAM_BASELINE_DIGEST, /^[a-f0-9]{64}$/);
});

test("B — a legacy baseline member addition is rejected", () => {
  const records = clone(LEGACY_IAM_BASELINE_RECORDS);
  records[0].members.push("user:added@example.invalid");
  records[0].members.sort();
  refreshLegacyRecord(records[0]);
  assert.throws(
      () => validateLegacyIamBaselineSet(records, PRE_PROVISIONING),
      /exact set invariant/,
  );
});

test("C — a legacy baseline condition change is rejected", () => {
  const records = clone(LEGACY_IAM_BASELINE_RECORDS);
  records[1].condition = {expression: "request.time < timestamp('2030-01-01T00:00:00Z')"};
  refreshLegacyRecord(records[1]);
  assert.throws(
      () => validateLegacyIamBaselineSet(records, PRE_PROVISIONING),
      /condition|record or phase/,
  );
});

test("D — same-count legacy role and scope swaps are rejected", () => {
  const records = clone(LEGACY_IAM_BASELINE_RECORDS);
  [records[0].role, records[1].role] = [records[1].role, records[0].role];
  [records[0].scope, records[1].scope] =
    [records[1].scope, records[0].scope];
  refreshLegacyRecord(records[0]);
  refreshLegacyRecord(records[1]);
  assert.equal(records.length, 3);
  assert.throws(
      () => validateLegacyIamBaselineSet(records, PRE_PROVISIONING),
      /exact set invariant/,
  );
});

test("E — a broad legacy binding cannot prove least privilege", () => {
  assert.throws(
      () => validateLeastPrivilegeProofBindings(
          [clone(LEGACY_IAM_BASELINE_RECORDS[0])],
          POST_PROVISIONING_PRE_DEPLOY,
      ),
      /cannot satisfy least-privilege/,
  );
  assert.equal(
      validateLeastPrivilegeProofBindings(
          clone(PERMANENT_BINDINGS),
          POST_PROVISIONING_PRE_DEPLOY,
      ),
      true,
  );
  assert.equal(PERMANENT_BINDINGS.length, 7);
});

test("F — complete all-absent PRE_PROVISIONING resources are accepted", () => {
  const state = clone(buildResourceState(PRE_PROVISIONING));
  state.notFoundConfirmations = [];
  refreshResourceState(state);
  assert.equal(validateResourceState(state, PRE_PROVISIONING), true);
  assert.equal(state.inventoryComplete, true);
  assert.deepEqual(state.serviceAccounts, []);
  assert.deepEqual(state.customRoles, []);
});

test("G — a partial Academy Service Account set is rejected", () => {
  const state = clone(buildResourceState(POST_PROVISIONING_PRE_DEPLOY));
  state.serviceAccounts.pop();
  refreshResourceState(state);
  assert.throws(
      () => validateResourceState(state, POST_PROVISIONING_PRE_DEPLOY),
      /service accounts exact set/,
  );
});

test("H — a partial Academy custom-role set is rejected", () => {
  const state = clone(buildResourceState(POST_PROVISIONING_PRE_DEPLOY));
  state.customRoles.pop();
  refreshResourceState(state);
  assert.throws(
      () => validateResourceState(state, POST_PROVISIONING_PRE_DEPLOY),
      /custom roles exact set/,
  );
});

test("I — all exact Academy resources are accepted after provisioning", () => {
  const state = buildResourceState(POST_PROVISIONING_PRE_DEPLOY);
  assert.equal(
      validateResourceState(clone(state), POST_PROVISIONING_PRE_DEPLOY),
      true,
  );
  assert.equal(
      state.serviceAccounts.length,
      EXPECTED_ACADEMY_SERVICE_ACCOUNTS.length,
  );
  assert.equal(
      state.customRoles.length,
      EXPECTED_CUSTOM_ROLE_DEFINITIONS.length,
  );
  assert.equal(state.userManagedKeys.length, 0);
});

test("J — an unexpected academy-prefixed resource is rejected", () => {
  const state = clone(buildResourceState(POST_PROVISIONING_PRE_DEPLOY));
  state.unexpectedAcademyPrefixedServiceAccounts.push(
      "academy-unreviewed@daegu-miami-production.iam.gserviceaccount.com",
  );
  refreshResourceState(state);
  assert.throws(
      () => validateResourceState(state, POST_PROVISIONING_PRE_DEPLOY),
      /unexpected resource/,
  );
});

test("K — exact reviewed managed identity and role pairs are accepted", () => {
  assert.equal(
      validateReviewedManagedIdentitySet(
          clone(REVIEWED_MANAGED_IDENTITY_BINDINGS),
      ),
      true,
  );
  assert.equal(REVIEWED_MANAGED_IDENTITY_BINDINGS.length, 5);
});

test("L — an unknown service agent is classified INPUT_REQUIRED", () => {
  const unknown = binding(
      "serviceAccount:service-884850632328@" +
        "gcp-sa-unknown.iam.gserviceaccount.com",
      "roles/unknown.serviceAgent",
  );
  assert.equal(
      classifyManagedIdentityBinding(unknown).classification,
      "INPUT_REQUIRED",
  );
  assert.throws(() => validateReviewedManagedIdentitySet([
    ...clone(REVIEWED_MANAGED_IDENTITY_BINDINGS),
    unknown,
  ]), /INPUT_REQUIRED/);
});

test("M — a wildcard-shaped service agent is not automatically allowed", () => {
  const shaped = binding(
      "serviceAccount:service-884850632328@" +
        "invented.iam.gserviceaccount.com",
      "roles/invented.serviceAgent",
  );
  const result = classifyManagedIdentityBinding(shaped);
  assert.equal(result.classification, "INPUT_REQUIRED");
  assert.notEqual(result.disposition, "ALLOW_EXACT_REVIEWED_PAIR");
});

test("N — a reviewed identity with the wrong role is rejected", () => {
  const wrong = clone(REVIEWED_MANAGED_IDENTITY_BINDINGS[0]);
  wrong.role = "roles/editor";
  wrong.recordDigest = buildRecordDigest(wrong);
  assert.equal(classifyManagedIdentityBinding(wrong).classification, "REJECT");
  const set = clone(REVIEWED_MANAGED_IDENTITY_BINDINGS);
  set[0] = wrong;
  assert.throws(
      () => validateReviewedManagedIdentitySet(set),
      /REJECT/,
  );
});

test("O — exact Owner is tolerated only in early migration evidence", () => {
  const evidence = clone(buildPhaseEvidence(PRE_PROVISIONING));
  assert.equal(validatePhaseEvidence(evidence), true);
  assert.equal(
      evidence.legacyRecords.some(({role}) => role === "roles/owner"),
      true,
  );
  assert.deepEqual(MIGRATION_PHASES.slice(0, 2), [
    PRE_PROVISIONING,
    POST_PROVISIONING_PRE_DEPLOY,
  ]);
});

test("P — Owner remaining before publication is rejected", () => {
  const evidence =
    clone(buildPhaseEvidence(POST_PRIVATE_DEPLOY_PRE_PUBLICATION));
  evidence.legacyRecords.push(clone(LEGACY_IAM_BASELINE_RECORDS[0]));
  refreshPhaseEvidence(evidence);
  assert.throws(
      () => validatePhaseEvidence(evidence),
      /phase mismatch|exact set invariant/,
  );
});

test("Q — exact deferred records with the decommission digest are accepted",
    () => {
      const evidence =
        clone(buildPhaseEvidence(POST_PRIVATE_DEPLOY_PRE_PUBLICATION));
      assert.deepEqual(evidence.legacyRecords, DEFERRED_LEGACY_IAM_RECORDS);
      assert.deepEqual(evidence.decommissionPlan, DECOMMISSION_PLAN);
      assert.equal(validatePhaseEvidence(evidence), true);
    });

test("R — a changed deferred legacy binding is rejected", () => {
  const evidence =
    clone(buildPhaseEvidence(POST_PRIVATE_DEPLOY_PRE_PUBLICATION));
  evidence.legacyRecords[0].members[0] =
    "serviceAccount:swapped@daegu-miami-production.iam.gserviceaccount.com";
  refreshLegacyRecord(evidence.legacyRecords[0]);
  refreshPhaseEvidence(evidence);
  assert.throws(
      () => validatePhaseEvidence(evidence),
      /record or phase mismatch|exact set invariant/,
  );
});

test("S — public invoker publication before private gate is rejected", () => {
  const evidence =
    clone(buildPhaseEvidence(POST_PROVISIONING_PRE_DEPLOY));
  evidence.publicationReceipt = clone(buildPublicationReceipt());
  refreshPhaseEvidence(evidence);
  assert.throws(
      () => validatePhaseEvidence(evidence),
      /publication is premature/,
  );
});

test("T — final steady state rejects remaining temporary access", () => {
  const evidence = clone(buildPhaseEvidence(FINAL_STEADY_STATE));
  evidence.temporaryAccessBindings = clone(TEMPORARY_BINDINGS);
  refreshPhaseEvidence(evidence);
  assert.throws(
      () => validatePhaseEvidence(evidence),
      /temporary Academy access exact set/,
  );
});

test("U — exact original baseline restoration in an approved phase passes",
    () => {
      const receipt = buildRollbackReceipt();
      assert.equal(validateRollbackReceipt(clone(receipt)), true);
      assert.equal(receipt.originalBaselineDigest, LEGACY_IAM_BASELINE_DIGEST);
    });

test("V — rollback cannot restore a record absent from the baseline", () => {
  const receipt = clone(buildRollbackReceipt());
  const invented = clone(LEGACY_IAM_BASELINE_RECORDS[2]);
  invented.recordId = "invented-token-creator";
  invented.members = [
    "serviceAccount:invented@" +
      "daegu-miami-production.iam.gserviceaccount.com",
  ];
  refreshLegacyRecord(invented);
  receipt.restoredRecords = [invented];
  receipt.afterRecords = [invented];
  refreshRollback(receipt);
  assert.throws(
      () => validateRollbackReceipt(receipt),
      /original baseline subset/,
  );
});

test("W — rollback rejects member, role, and scope widening", () => {
  for (const mutate of [
    (record) => {
      record.members.push("user:additional@example.invalid");
      record.members.sort();
    },
    (record) => {
      record.role = "roles/owner";
    },
    (record) => {
      record.scope = "organizations/123456789";
    },
  ]) {
    const receipt = clone(buildRollbackReceipt({
      restoredRecords: [LEGACY_IAM_BASELINE_RECORDS[1]],
    }));
    mutate(receipt.restoredRecords[0]);
    refreshLegacyRecord(receipt.restoredRecords[0]);
    receipt.afterRecords = clone(receipt.restoredRecords);
    refreshRollback(receipt);
    assert.throws(
        () => validateRollbackReceipt(receipt),
        /original baseline subset/,
    );
  }
});

test("X — automatic Owner restore after publication is rejected", () => {
  const automatic = buildRollbackReceipt({
    phase: POST_PUBLICATION_PRE_CLEANUP,
    restoredRecords: [LEGACY_IAM_BASELINE_RECORDS[0]],
    automatic: true,
  });
  assert.throws(
      () => validateRollbackReceipt(clone(automatic)),
      /break-glass SHA/,
  );

  const breakGlass = buildRollbackReceipt({
    phase: POST_PUBLICATION_PRE_CLEANUP,
    restoredRecords: [LEGACY_IAM_BASELINE_RECORDS[0]],
    automatic: false,
    breakGlassApprovalSha256: "a".repeat(64),
  });
  assert.equal(validateRollbackReceipt(clone(breakGlass)), true);
});

test("Y — exact canonical final IAM audit is accepted", () => {
  const audit = buildFinalIamAudit();
  assert.equal(validateFinalIamAudit(clone(audit)), true);
  assert.equal(audit.phase, FINAL_STEADY_STATE);
  assert.equal(audit.temporaryAccessCount, 0);
  assert.equal(audit.runInvokerBindings.length, 3);
  assert.equal(audit.functionState.finalFunctionCount, 35);
});

test("Z — coherent caller count and digest rewrites after a swap reject", () => {
  const audit = clone(buildFinalIamAudit());
  const first = audit.projectBindings.find(({recordId}) =>
    recordId === "build-core-project");
  const second = audit.projectBindings.find(({recordId}) =>
    recordId === "writer-runtime-project");
  [first.member, second.member] = [second.member, first.member];
  first.recordDigest = buildRecordDigest(first);
  second.recordDigest = buildRecordDigest(second);
  refreshFinalAudit(audit);
  assert.equal(
      audit.projectBindingSetDigest,
      buildBindingSetDigest(audit.projectBindings, "final_project_bindings"),
  );
  assert.throws(
      () => validateFinalIamAudit(audit),
      /exact canonical invariant/,
  );
});

test("AA — an unapproved broad final binding is rejected", () => {
  const audit = clone(buildFinalIamAudit());
  audit.projectBindings.push(clone(LEGACY_IAM_BASELINE_RECORDS[0]));
  refreshFinalAudit(audit);
  assert.throws(
      () => validateFinalIamAudit(audit),
      /exact canonical invariant/,
  );
});

test("AB — a user-managed key in the final audit is rejected", () => {
  const audit = clone(buildFinalIamAudit());
  audit.userManagedKeys.push({
    serviceAccount:
      "academy-functions-build@" +
      "daegu-miami-production.iam.gserviceaccount.com",
    keyId: "user-managed-key",
  });
  refreshFinalAudit(audit);
  assert.throws(
      () => validateFinalIamAudit(audit),
      /exact canonical invariant|contains temporary access/,
  );
});

test("AC — a changed existing 32-Function baseline is rejected", () => {
  const audit = clone(buildFinalIamAudit());
  audit.functionState.existingFunctionBaselineDigest = "0".repeat(64);
  audit.functionState.existingBaselineUnchanged = false;
  audit.functionState.stateDigest =
    buildFunctionStateDigest(audit.functionState);
  audit.finalInventoryDigest = audit.functionState.inventoryDigest;
  audit.auditDigest = buildFinalIamAuditDigest(audit);
  assert.throws(
      () => validateFinalIamAudit(audit),
      /exact canonical invariant|baseline pin/,
  );
});

test("authority is deeply frozen and digest-bound", () => {
  const assertFrozen = (value) => {
    if (!value || typeof value !== "object") return;
    assert.equal(Object.isFrozen(value), true);
    Object.values(value).forEach(assertFrozen);
  };
  assertFrozen(ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY);
  assert.equal(validateMigrationAuthority(), true);
  assert.equal(
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY.authorityDigest,
      ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
  );
});
