import assert from "node:assert/strict";
import test from "node:test";

import {
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY,
  ACADEMY_LEGACY_IAM_MIGRATION_AUTHORITY_DIGEST,
  ALL_FUNCTION_NAMES,
  ARTIFACT_IAM_COLLECTION_PLAN,
  ARTIFACT_IAM_COLLECTION_STATUS_SCHEMA_VERSION,
  ARTIFACT_IAM_EVIDENCE_SCHEMA_VERSION,
  ARTIFACT_IAM_RAW_PATHS,
  CLOUD_BUILD_LEGACY_EVIDENCE_SCHEMA_VERSION,
  COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL,
  COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE,
  DECOMMISSION_PLAN,
  DEDICATED_ACADEMY_BUILD_SERVICE_ACCOUNT_EMAIL,
  DEDICATED_ACADEMY_BUILD_SERVICE_ACCOUNT_RESOURCE,
  DEFERRED_LEGACY_IAM_RECORDS,
  EVIDENCE_PACKAGE_INTEGRITY_SCHEMA_VERSION,
  EXPECTED_ACADEMY_SERVICE_ACCOUNTS,
  EXPECTED_CUSTOM_ROLE_DEFINITIONS,
  EXPECTED_LEGACY_CLOUD_BUILD_FACTS,
  EXISTING_FUNCTION_NAMES,
  FINAL_STEADY_STATE,
  LEGACY_CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL,
  LEGACY_IAM_BASELINE_DIGEST,
  LEGACY_IAM_BASELINE_RECORDS,
  MIGRATION_PHASES,
  PERMANENT_BINDINGS,
  POST_PRIVATE_DEPLOY_PRE_PUBLICATION,
  POST_PROVISIONING_PRE_DEPLOY,
  POST_PUBLICATION_PRE_CLEANUP,
  PRE_PROVISIONING,
  REVIEWED_MANAGED_IDENTITY_BINDINGS,
  SERVICE_AGENT_EVIDENCE_SCHEMA_VERSION,
  TEMPORARY_BINDINGS,
  analyzeArtifactRepositoryIamEvidence,
  analyzeFunctionBuildEvidence,
  analyzeReviewedServiceAgentEvidence,
  buildArtifactIamCollectionPlanDigest,
  buildArtifactIamRawManifest,
  buildArtifactIamRawManifestDigest,
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
  canonicalDigest,
  classifyManagedIdentityBinding,
  sealArtifactRepositoryIamEvidenceBundle,
  sealRawEvidenceSnapshot,
  validateEvidenceResultPackage,
  validateFinalIamAudit,
  validateLeastPrivilegeProofBindings,
  validateLegacyIamBaselineSet,
  validateLegacyIdentityRoleAssignments,
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

function successfulCollectionStatus() {
  return {exitStatus: 0, status: "SUCCESS", stderr: ""};
}

function buildRecord(buildId, serviceAccount) {
  return {
    id: buildId,
    name:
      `projects/daegu-miami-production/locations/us-central1/builds/${buildId}`,
    projectId: "daegu-miami-production",
    region: "us-central1",
    status: "SUCCESS",
    serviceAccount,
    logging: "CLOUD_LOGGING_ONLY",
    logsBucket: null,
  };
}

function functionBuildEvidence({
  includeTargets = false,
  existingBuildServiceAccount = COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE,
  existingFunctionServiceAccount = COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE,
  targetBuildServiceAccount =
    DEDICATED_ACADEMY_BUILD_SERVICE_ACCOUNT_RESOURCE,
  targetFunctionServiceAccount =
    DEDICATED_ACADEMY_BUILD_SERVICE_ACCOUNT_RESOURCE,
} = {}) {
  const legacyBuildIds = Array.from(
      {length: EXPECTED_LEGACY_CLOUD_BUILD_FACTS.uniqueBuildCount},
      (_, index) => `legacy-build-${String(index).padStart(2, "0")}`,
  );
  const functions = EXISTING_FUNCTION_NAMES.map((functionName, index) => {
    const buildId = legacyBuildIds[index % legacyBuildIds.length];
    return {
      functionName,
      generation: "GEN_2",
      region: "us-central1",
      buildServiceAccount: existingFunctionServiceAccount,
      buildRef:
        `projects/daegu-miami-production/locations/us-central1/builds/${buildId}`,
    };
  });
  const builds = legacyBuildIds.map((buildId) =>
    buildRecord(buildId, existingBuildServiceAccount));
  if (includeTargets) {
    const targetNames = ALL_FUNCTION_NAMES.filter((functionName) =>
      !EXISTING_FUNCTION_NAMES.includes(functionName));
    targetNames.forEach((functionName, index) => {
      const buildId = `academy-target-build-${index}`;
      functions.push({
        functionName,
        generation: "GEN_2",
        region: "us-central1",
        buildServiceAccount: targetFunctionServiceAccount,
        buildRef:
          `projects/daegu-miami-production/locations/us-central1/builds/${buildId}`,
      });
      builds.push(
          buildRecord(
              buildId,
              targetBuildServiceAccount,
          ),
      );
    });
  }
  return {
    schemaVersion: CLOUD_BUILD_LEGACY_EVIDENCE_SCHEMA_VERSION,
    functions,
    builds,
    buildCollectionStatuses: builds.map(({id: buildId}) => ({
      buildId,
      ...successfulCollectionStatus(),
    })),
  };
}

function artifactCollectionStatus(overrides = {}) {
  return {
    schemaVersion: ARTIFACT_IAM_COLLECTION_STATUS_SCHEMA_VERSION,
    key: "artifact_repository_iam",
    command: [
      "gcloud",
      "artifacts",
      "repositories",
      "get-iam-policy",
      "gcf-artifacts",
      "--location=us-central1",
      "--project=daegu-miami-production",
      "--format=json",
    ],
    exitCode: 0,
    failureClass: "SUCCESS",
    readOnly: true,
    productionDataAccess: 0,
    mutations: 0,
    ...overrides,
  };
}

function artifactRawBytes({
  status = artifactCollectionStatus(),
  stderr = "",
  rawPolicy = "{\"etag\":\"ACAB\"}",
} = {}) {
  return {
    [ARTIFACT_IAM_RAW_PATHS.status]: JSON.stringify(status),
    [ARTIFACT_IAM_RAW_PATHS.stderr]: stderr,
    [ARTIFACT_IAM_RAW_PATHS.policy]: rawPolicy,
  };
}

function artifactEvidenceBundle({
  collectionPlan = ARTIFACT_IAM_COLLECTION_PLAN,
  rawBytesByPath = artifactRawBytes(),
  rawManifest = buildArtifactIamRawManifest(rawBytesByPath),
} = {}) {
  return sealArtifactRepositoryIamEvidenceBundle({
    schemaVersion: ARTIFACT_IAM_EVIDENCE_SCHEMA_VERSION,
    collectionPlan,
    rawBytesByPath,
    rawManifest,
  });
}

function evidenceFile(path, marker, size = 1) {
  return {path, sha256: marker.repeat(64), size};
}

test("A — exact four-record PRE_PROVISIONING baseline is accepted", () => {
  assert.equal(
      validateLegacyIamBaselineSet(
          clone(LEGACY_IAM_BASELINE_RECORDS),
          PRE_PROVISIONING,
      ),
      true,
  );
  assert.equal(LEGACY_IAM_BASELINE_RECORDS.length, 4);
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
  assert.equal(records.length, 4);
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

test("CB-A — exact Cloud Build fourth legacy baseline record is accepted", () => {
  const record = LEGACY_IAM_BASELINE_RECORDS.find(({recordId}) =>
    recordId === "legacy-cloud-build-default-builder");
  assert.deepEqual(record, {
    recordId: "legacy-cloud-build-default-builder",
    scope: "projects/daegu-miami-production",
    role: "roles/cloudbuild.builds.builder",
    members: [
      "serviceAccount:884850632328-compute@developer.gserviceaccount.com",
      "serviceAccount:884850632328@cloudbuild.gserviceaccount.com",
    ],
    condition: null,
    disposition: "TRACKED_DEFERRED_DECOMMISSION",
    allowedMigrationPhases: MIGRATION_PHASES,
    removalTarget:
      "AFTER_DEDICATED_ACADEMY_FUNCTIONS_BUILD_SERVICE_ACCOUNT_VALIDATION",
    baselineRecordDigest: record.baselineRecordDigest,
  });
  assert.equal(validateLegacyIamBaselineSet(
      clone(LEGACY_IAM_BASELINE_RECORDS),
      PRE_PROVISIONING,
  ), true);
});

test("CB-B — Cloud Build builder member changes are rejected", () => {
  for (const mutate of [
    (record) => record.members.push(
        "serviceAccount:added@daegu-miami-production.iam.gserviceaccount.com",
    ),
    (record) => record.members.pop(),
    (record) => {
      record.members[1] =
        "serviceAccount:swapped@daegu-miami-production.iam.gserviceaccount.com";
    },
  ]) {
    const records = clone(LEGACY_IAM_BASELINE_RECORDS);
    const record = records.find(({recordId}) =>
      recordId === "legacy-cloud-build-default-builder");
    mutate(record);
    record.members.sort();
    refreshLegacyRecord(record);
    assert.throws(
        () => validateLegacyIamBaselineSet(records, PRE_PROVISIONING),
        /exact set invariant/,
    );
  }
});

test("CB-C — Cloud Build builder condition and scope changes are rejected", () => {
  for (const mutate of [
    (record) => {
      record.condition = {expression: "request.time < timestamp('2030-01-01T00:00:00Z')"};
    },
    (record) => {
      record.scope = "organizations/123456789";
    },
  ]) {
    const records = clone(LEGACY_IAM_BASELINE_RECORDS);
    const record = records.find(({recordId}) =>
      recordId === "legacy-cloud-build-default-builder");
    mutate(record);
    refreshLegacyRecord(record);
    assert.throws(
        () => validateLegacyIamBaselineSet(records, PRE_PROVISIONING),
        /record or phase|exact set invariant/,
    );
  }
});

test("CB-D — exact legacy Cloud Build identity is Google-owned", () => {
  const exact = binding(
      `serviceAccount:${LEGACY_CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL}`,
      "roles/cloudbuild.builds.builder",
  );
  const result = classifyManagedIdentityBinding(exact);
  assert.equal(
      result.classification,
      "SAME_PROJECT_GOOGLE_OWNED_LEGACY_CLOUD_BUILD",
  );
  assert.equal(result.disposition, "LEGACY_BASELINE_ONLY");
});

test("CB-E — wildcard-shaped Cloud Build identity is rejected", () => {
  const wildcardShaped = binding(
      "serviceAccount:884850632328@invented.gserviceaccount.com",
      "roles/cloudbuild.builds.builder",
  );
  assert.equal(
      classifyManagedIdentityBinding(wildcardShaped).classification,
      "REJECT",
  );
});

test("CB-F — Compute Editor and Build Builder roles require exact baselines",
    () => {
      const assignments = [
        binding(
            `serviceAccount:${COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL}`,
            "roles/editor",
        ),
        binding(
            `serviceAccount:${COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL}`,
            "roles/cloudbuild.builds.builder",
        ),
        binding(
            `serviceAccount:${LEGACY_CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL}`,
            "roles/cloudbuild.builds.builder",
        ),
      ];
      assert.equal(validateLegacyIdentityRoleAssignments(assignments), true);
    });

test("CB-G — an extra Compute default role is rejected", () => {
  const assignments = [
    binding(
        `serviceAccount:${COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL}`,
        "roles/editor",
    ),
    binding(
        `serviceAccount:${COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL}`,
        "roles/cloudbuild.builds.builder",
    ),
    binding(
        `serviceAccount:${LEGACY_CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL}`,
        "roles/cloudbuild.builds.builder",
    ),
    binding(
        `serviceAccount:${COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL}`,
        "roles/viewer",
    ),
  ];
  assert.throws(
      () => validateLegacyIdentityRoleAssignments(assignments),
      /REJECT|exact set invariant/,
  );
});

test("CB-H — legacy Cloud Build baseline cannot prove least privilege", () => {
  const record = LEGACY_IAM_BASELINE_RECORDS.find(({recordId}) =>
    recordId === "legacy-cloud-build-default-builder");
  assert.throws(
      () => validateLeastPrivilegeProofBindings(
          [clone(record)],
          POST_PROVISIONING_PRE_DEPLOY,
      ),
      /cannot satisfy least-privilege/,
  );
});

test("CB-I — 32 Functions to 14 shared Builds is accepted", () => {
  const evidence = functionBuildEvidence();
  const result = analyzeFunctionBuildEvidence(clone(evidence));
  assert.equal(result.functionCount, 32);
  assert.equal(result.uniqueBuildCount, 14);
  assert.equal(result.mappingModel, "MANY_FUNCTIONS_TO_ONE_BUILD_ALLOWED");
  assert.equal(result.completeness, "EXACT");
  assert.equal(result.resourceIdentity, "EXACT");

  const callerCounts = clone(evidence);
  callerCounts.functionCount = 32;
  callerCounts.uniqueBuildCount = 14;
  assert.throws(
      () => analyzeFunctionBuildEvidence(callerCounts),
      /exact key set mismatch/,
  );
});

test("FIX-A — existing Builds require the exact Compute resource", () => {
  const evidence = functionBuildEvidence();
  const result = analyzeFunctionBuildEvidence(evidence);
  assert.equal(result.functionCount, 32);
  assert.equal(result.uniqueBuildCount, 14);
  assert.equal(
      evidence.builds.every(({serviceAccount}) =>
        serviceAccount === COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE),
      true,
  );
});

test("FIX-B/C/D — bare, IAM-member, and wrong-project Build SAs reject",
    () => {
      for (const serviceAccount of [
        COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL,
        `serviceAccount:${COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL}`,
        `projects/wrong-project/serviceAccounts/` +
          COMPUTE_DEFAULT_SERVICE_ACCOUNT_EMAIL,
      ]) {
        const evidence = functionBuildEvidence({
          existingBuildServiceAccount: serviceAccount,
        });
        assert.throws(
            () => analyzeFunctionBuildEvidence(evidence),
            /identity, status, or configuration mismatch/,
        );
      }
    });

test("FIX-E/F — target Builds require the exact dedicated resource", () => {
  const exact = functionBuildEvidence({includeTargets: true});
  assert.equal(analyzeFunctionBuildEvidence(exact).functionCount, 35);

  const bare = functionBuildEvidence({
    includeTargets: true,
    targetBuildServiceAccount:
      DEDICATED_ACADEMY_BUILD_SERVICE_ACCOUNT_EMAIL,
    targetFunctionServiceAccount:
      DEDICATED_ACADEMY_BUILD_SERVICE_ACCOUNT_EMAIL,
  });
  assert.throws(
      () => analyzeFunctionBuildEvidence(bare),
      /Build service account resource mismatch/,
  );
});

test("FIX-G — Function buildConfig and raw Build SA mismatch rejects", () => {
  const evidence = functionBuildEvidence({
    existingFunctionServiceAccount:
      DEDICATED_ACADEMY_BUILD_SERVICE_ACCOUNT_RESOURCE,
  });
  assert.throws(
      () => analyzeFunctionBuildEvidence(evidence),
      /Build service account resource mismatch/,
  );
});

test("future Academy Functions require the dedicated Build SA", () => {
  const evidence = functionBuildEvidence({includeTargets: true});
  assert.equal(analyzeFunctionBuildEvidence(clone(evidence)).functionCount, 35);
  const targetBuild = evidence.builds.find(({id}) =>
    id.startsWith("academy-target-build-"));
  targetBuild.serviceAccount = COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE;
  assert.throws(
      () => analyzeFunctionBuildEvidence(evidence),
      /identity, status, or configuration mismatch/,
  );
});

test("CB-J — missing Build refs and duplicate Function names are rejected", () => {
  const missingRef = functionBuildEvidence();
  delete missingRef.functions[0].buildRef;
  assert.throws(
      () => analyzeFunctionBuildEvidence(missingRef),
      /exact key set mismatch/,
  );

  const duplicate = functionBuildEvidence();
  duplicate.functions[1].functionName = duplicate.functions[0].functionName;
  assert.throws(
      () => analyzeFunctionBuildEvidence(duplicate),
      /duplicate Function name/,
  );
});

test("CB-K — missing or extra raw Builds are rejected", () => {
  const missing = functionBuildEvidence();
  missing.builds.pop();
  assert.throws(
      () => analyzeFunctionBuildEvidence(missing),
      /raw Build IDs exact set/,
  );

  const extra = functionBuildEvidence();
  extra.builds.push(
      buildRecord("extra-build", COMPUTE_DEFAULT_SERVICE_ACCOUNT_RESOURCE),
  );
  assert.throws(
      () => analyzeFunctionBuildEvidence(extra),
      /extra or mixes|raw Build IDs exact set/,
  );

  const missingStatus = functionBuildEvidence();
  missingStatus.buildCollectionStatuses.pop();
  assert.throws(
      () => analyzeFunctionBuildEvidence(missingStatus),
      /collection status IDs exact set/,
  );

  const failedStatus = functionBuildEvidence();
  failedStatus.buildCollectionStatuses[0] = {
    ...failedStatus.buildCollectionStatuses[0],
    exitStatus: 1,
    status: "FAILED",
    stderr: "collection failed",
  };
  assert.throws(
      () => analyzeFunctionBuildEvidence(failedStatus),
      /collection status.*failed/,
  );
});

test("CB-L — raw Build identity and configuration mismatches are rejected",
    () => {
      for (const mutate of [
        (build) => {
          build.id = "wrong-id";
        },
        (build) => {
          build.name =
            "projects/daegu-miami-production/locations/us-central1/builds/wrong";
        },
        (build) => {
          build.projectId = "wrong-project";
        },
        (build) => {
          build.region = "asia-northeast3";
        },
        (build) => {
          build.serviceAccount = LEGACY_CLOUD_BUILD_SERVICE_ACCOUNT_EMAIL;
        },
        (build) => {
          build.status = "FAILURE";
        },
        (build) => {
          build.logging = "LEGACY";
        },
        (build) => {
          build.logsBucket = "gs://unexpected";
        },
      ]) {
        const evidence = functionBuildEvidence();
        mutate(evidence.builds[0]);
        assert.throws(
            () => analyzeFunctionBuildEvidence(evidence),
            /identity, status, or configuration|extra or mixes/,
        );
      }
    });

test("FIX-H — standalone synthetic Artifact success is INPUT_REQUIRED", () => {
  const result = analyzeArtifactRepositoryIamEvidence({
    schemaVersion: ARTIFACT_IAM_EVIDENCE_SCHEMA_VERSION,
    collectionStatus: {
      exitStatus: 0,
      status: "SUCCESS",
      stderr: "",
    },
    rawPolicy: {etag: "ACAB"},
  });
  assert.equal(result.classification, "INPUT_REQUIRED");
  assert.equal(
      result.disposition,
      "SEALED_ARTIFACT_IAM_EVIDENCE_BUNDLE_REQUIRED",
  );
});

test("FIX-I/R — exact sealed Artifact bundle normalizes etag-only policy",
    () => {
      const result =
        analyzeArtifactRepositoryIamEvidence(artifactEvidenceBundle());
      assert.equal(result.classification, "ACCEPT");
      assert.deepEqual(result.normalizedPolicy, {
        bindings: [],
        etag: "ACAB",
        version: 1,
      });
      assert.match(result.statusDigest, /^[a-f0-9]{64}$/);
      assert.match(result.rawPolicySha256, /^[a-f0-9]{64}$/);
      assert.match(result.stderrSha256, /^[a-f0-9]{64}$/);
      assert.equal(
          result.collectionPlanDigest,
          ARTIFACT_IAM_COLLECTION_PLAN.planDigest,
      );
    });

test("FIX-J — one collection-plan command token change is rejected", () => {
  const collectionPlan = clone(ARTIFACT_IAM_COLLECTION_PLAN);
  collectionPlan.command[4] = "other-repository";
  collectionPlan.planDigest =
    buildArtifactIamCollectionPlanDigest(collectionPlan);
  assert.throws(
      () => artifactEvidenceBundle({collectionPlan}),
      /collection plan exact canonical invariant failed/,
  );
});

test("FIX-K/L/M — status key, safety, mutation, and data-access drift reject",
    () => {
      for (const overrides of [
        {key: "other_operation"},
        {readOnly: false},
        {mutations: 1},
        {productionDataAccess: 1},
      ]) {
        const rawBytesByPath = artifactRawBytes({
          status: artifactCollectionStatus(overrides),
        });
        assert.throws(
            () => artifactEvidenceBundle({rawBytesByPath}),
            /collection status authority mismatch/,
        );
      }
    });

test("FIX-N — changed success stderr bytes are rejected", () => {
  const rawBytesByPath = artifactRawBytes({stderr: "unexpected stderr"});
  assert.throws(
      () => artifactEvidenceBundle({rawBytesByPath}),
      /stderr must be empty/,
  );

  const staleManifestBytes = artifactRawBytes();
  const rawManifest = buildArtifactIamRawManifest(staleManifestBytes);
  staleManifestBytes[ARTIFACT_IAM_RAW_PATHS.stderr] = "changed";
  assert.throws(
      () => artifactEvidenceBundle({
        rawBytesByPath: staleManifestBytes,
        rawManifest,
      }),
      /raw byte parity mismatch/,
  );
});

test("FIX-O — changed raw policy with caller-refreshed digests is rejected",
    () => {
      const sealed = artifactEvidenceBundle();
      const tampered = clone(sealed);
      tampered.rawBytesByPath[ARTIFACT_IAM_RAW_PATHS.policy] =
        "{\"etag\":\"CHANGED\"}";
      tampered.rawManifest =
        buildArtifactIamRawManifest(tampered.rawBytesByPath);
      const {bundleDigest: ignored, ...projection} = tampered;
      tampered.bundleDigest = canonicalDigest(projection);
      assert.throws(
          () => analyzeArtifactRepositoryIamEvidence(tampered),
          /bundle seal provenance mismatch/,
      );
    });

test("FIX-P — same-count raw-manifest path swap is rejected", () => {
  const rawBytesByPath = artifactRawBytes();
  const original = buildArtifactIamRawManifest(rawBytesByPath);
  const reordered = clone(original);
  reordered.records.reverse();
  assert.equal(
      canonicalSetDigest(
          reordered.records,
          "artifact_iam_raw_manifest_records",
      ),
      original.recordSetDigest,
  );
  assert.doesNotThrow(
      () => artifactEvidenceBundle({
        rawBytesByPath,
        rawManifest: reordered,
      }),
  );

  const rawManifest = clone(original);
  [rawManifest.records[0].path, rawManifest.records[1].path] =
    [rawManifest.records[1].path, rawManifest.records[0].path];
  rawManifest.recordSetDigest = canonicalSetDigest(
      rawManifest.records,
      "artifact_iam_raw_manifest_records",
  );
  rawManifest.manifestDigest =
    buildArtifactIamRawManifestDigest(rawManifest);
  assert.throws(
      () => artifactEvidenceBundle({rawBytesByPath, rawManifest}),
      /raw byte parity mismatch/,
  );
});

test("FIX-Q — previous result verdict cannot affect sealed adjudication", () => {
  const sealed = artifactEvidenceBundle();
  const previousResult = {verdict: "NOT_READY"};
  const before = analyzeArtifactRepositoryIamEvidence(sealed);
  previousResult.verdict = "READY";
  const after = analyzeArtifactRepositoryIamEvidence(sealed);
  assert.deepEqual(after, before);
  assert.equal(Object.hasOwn(after, "previousResult"), false);
});

test("failed or invalid sealed Artifact collections are INPUT_REQUIRED", () => {
  const failedRawBytes = artifactRawBytes({
    status: artifactCollectionStatus({
      exitCode: 1,
      failureClass: "PERMISSION_DENIED",
    }),
    stderr: "permission denied",
  });
  const failed = analyzeArtifactRepositoryIamEvidence(
      artifactEvidenceBundle({rawBytesByPath: failedRawBytes}),
  );
  assert.equal(failed.classification, "INPUT_REQUIRED");

  const invalidRawBytes = artifactRawBytes({rawPolicy: "{invalid-json"});
  const invalid = analyzeArtifactRepositoryIamEvidence(
      artifactEvidenceBundle({rawBytesByPath: invalidRawBytes}),
  );
  assert.equal(invalid.classification, "INPUT_REQUIRED");
});

test("missing Artifact plan or manifest provenance is INPUT_REQUIRED", () => {
  const result = analyzeArtifactRepositoryIamEvidence({
    schemaVersion: ARTIFACT_IAM_EVIDENCE_SCHEMA_VERSION,
    rawBytesByPath: artifactRawBytes(),
  });
  assert.equal(result.classification, "INPUT_REQUIRED");
});

test("CB-O — exact Service Agent pair tolerates optional metadata denial", () => {
  const result = analyzeReviewedServiceAgentEvidence({
    schemaVersion: SERVICE_AGENT_EVIDENCE_SCHEMA_VERSION,
    projectIamCollectionStatus: successfulCollectionStatus(),
    projectBinding: clone(REVIEWED_MANAGED_IDENTITY_BINDINGS[0]),
    describeObservation: {
      exitStatus: 1,
      status: "PERMISSION_DENIED",
      stderr: "iam.serviceAccounts.get PERMISSION_DENIED",
      permission: "iam.serviceAccounts.get",
    },
  });
  assert.equal(
      result.classification,
      "OPTIONAL_GOOGLE_MANAGED_METADATA_UNAVAILABLE",
  );
  assert.equal(
      result.disposition,
      "PROJECT_IAM_EXACT_PAIR_REMAINS_AUTHORITATIVE",
  );
});

test("CB-P — missing or wrong official project pair is rejected", () => {
  for (const mutate of [
    (record) => {
      record.role = "roles/viewer";
    },
    (record) => {
      record.condition = {expression: "request.time < timestamp('2030-01-01T00:00:00Z')"};
    },
    (record) => {
      record.member =
        "serviceAccount:service-884850632328@" +
        "gcp-sa-unknown.iam.gserviceaccount.com";
    },
  ]) {
    const wrong = clone(REVIEWED_MANAGED_IDENTITY_BINDINGS[0]);
    mutate(wrong);
    wrong.recordDigest = buildRecordDigest(wrong);
    const result = analyzeReviewedServiceAgentEvidence({
      schemaVersion: SERVICE_AGENT_EVIDENCE_SCHEMA_VERSION,
      projectIamCollectionStatus: successfulCollectionStatus(),
      projectBinding: wrong,
      describeObservation: {
        exitStatus: 1,
        status: "PERMISSION_DENIED",
        stderr: "iam.serviceAccounts.get PERMISSION_DENIED",
        permission: "iam.serviceAccounts.get",
      },
    });
    assert.equal(result.classification, "REJECT");
  }
});

test("CB-Q — result-package files do not mutate the raw evidence seal", () => {
  const rawRecords = [
    evidenceFile("raw/project-iam.json", "a", 10),
    evidenceFile("status/project-iam.json", "b", 20),
    evidenceFile("contract-config.json", "c", 30),
    evidenceFile("collection-plan.json", "d", 40),
  ];
  const rawSeal = sealRawEvidenceSnapshot(rawRecords);
  const result = validateEvidenceResultPackage({
    rawSeal,
    afterRawRecords: clone(rawRecords),
    resultPackageRecords: [
      evidenceFile("result.json", "d", 50),
      evidenceFile("canonical-manifest.json", "e", 60),
      evidenceFile("SHA256SUMS", "f", 70),
    ],
  });
  assert.equal(result.rawEvidenceIntegrity, "PASS");
  assert.equal(result.rawEvidenceDigest, rawSeal.rawEvidenceDigest);
  assert.notEqual(result.resultPackageDigest, result.rawEvidenceDigest);
  assert.equal(result.previousResultVerdictTrusted, false);
  assert.match(
      result.resultPackageDigest,
      /^[a-f0-9]{64}$/,
  );
});

test("CB-R — a raw evidence byte change is rejected", () => {
  const rawRecords = [
    evidenceFile("raw/project-iam.json", "a", 10),
    evidenceFile("status/project-iam.json", "b", 20),
  ];
  const rawSeal = sealRawEvidenceSnapshot(rawRecords);
  const afterRawRecords = clone(rawRecords);
  afterRawRecords[0].sha256 = "c".repeat(64);
  assert.throws(
      () => validateEvidenceResultPackage({
        rawSeal,
        afterRawRecords,
        resultPackageRecords: [
          evidenceFile("result.json", "d", 50),
          evidenceFile("canonical-manifest.json", "e", 60),
          evidenceFile("SHA256SUMS", "f", 70),
        ],
      }),
      /raw evidence bytes changed/,
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
