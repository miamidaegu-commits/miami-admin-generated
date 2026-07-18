import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  OBSERVER_PRINCIPAL_POLICY,
  PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
  STANDALONE_PROJECT_OBSERVER_PROFILE,
  assertObserverPrincipalPolicy,
  assertStandaloneProjectObserverProfile,
  deriveStandaloneProjectObserverProfile,
} from "../functions/scripts/academy-reset-freeze-readonly-permissions.mjs";
import {
  computeProviderOperationIdSetDigest,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";

function clone(value) {
  return structuredClone(value);
}

function canonical(value) {
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("uncanonical value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function evidence(overrides = {}) {
  return {
    ...clone(PINNED_STANDALONE_TOPOLOGY_EVIDENCE),
    ...overrides,
  };
}

test("standalone topology is derived only from exact canonical evidence", () => {
  const accepted = deriveStandaloneProjectObserverProfile(evidence());
  assert.deepEqual(accepted, STANDALONE_PROJECT_OBSERVER_PROFILE);
  assert.equal(accepted.topologyEvidence.projectParent, null);
  assert.equal(accepted.topologyEvidence.folders.count, 0);
  assert.equal(accepted.topologyEvidence.organizations.count, 0);

  const missingParent = evidence();
  delete missingParent.projectParent;
  for (const candidate of [
    missingParent,
    evidence({projectParent: undefined}),
    evidence({projectParent: "folders/123"}),
    evidence({projectParent: "organizations/123"}),
    evidence({projectParent: {name: "folders/123"}}),
    evidence({observedFolderNames: ["folders/123"]}),
    evidence({observedOrganizationNames: ["organizations/123"]}),
    evidence({sourceBucketOwnerProjectNumber: "999999999999"}),
  ]) {
    assert.throws(
        () => deriveStandaloneProjectObserverProfile(candidate),
        /standalone|exact keyset/,
    );
  }
});

test("operation profile is exact 25 executed plus topology-derived 4 N/A",
    () => {
      const operation =
        STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution;
      assert.equal(operation.totalOperationCount, 30);
      assert.equal(operation.mandatoryOperationCount, 29);
      assert.equal(operation.executedMandatoryOperationCount, 25);
      assert.equal(operation.notApplicableMandatoryOperationCount, 4);
      assert.equal(operation.optionalDiagnosticOperationCount, 1);

      const reordered = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
      reordered.operationExecution.executedMandatoryOperationIds.reverse();
      reordered.operationExecution.notApplicableMandatoryOperationIds
          .reverse();
      assert.deepEqual(
          assertStandaloneProjectObserverProfile(reordered),
          STANDALONE_PROJECT_OBSERVER_PROFILE,
      );

      const variants = [];
      const missing = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
      missing.operationExecution.notApplicableMandatoryOperationIds.pop();
      variants.push(missing);
      const extra = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
      extra.operationExecution.notApplicableMandatoryOperationIds.push(
          "cloudresourcemanager.v3.projects.get",
      );
      variants.push(extra);
      const swapped = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
      swapped.operationExecution.notApplicableMandatoryOperationIds[0] =
        "cloudresourcemanager.v3.projects.get";
      variants.push(swapped);
      const hierarchyExecuted = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
      hierarchyExecuted.operationExecution.executedMandatoryOperationIds
          .push(hierarchyExecuted.operationExecution
              .notApplicableMandatoryOperationIds[0]);
      variants.push(hierarchyExecuted);
      const projectNotApplicable =
        clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
      projectNotApplicable.operationExecution.notApplicableMandatoryOperationIds
          .push("cloudresourcemanager.v3.projects.get");
      variants.push(projectNotApplicable);
      for (const candidate of variants) {
        assert.throws(
            () => assertStandaloneProjectObserverProfile(candidate),
            /profile claim|unique string/,
        );
      }
    });

test("effective project role is exact 26 required plus one auxiliary", () => {
  const permissions =
    STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions;
  assert.equal(permissions.effectiveRequiredPermissionCount, 26);
  assert.equal(permissions.effectiveAuxiliaryPermissionCount, 1);
  assert.equal(permissions.effectiveRolePermissionCount, 27);
  assert.deepEqual(
      permissions.effectiveAuxiliaryPermissions,
      ["serviceusage.services.use"],
  );

  const reordered = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
  reordered.effectivePermissions.effectiveRequiredPermissions.reverse();
  reordered.effectivePermissions.effectiveRolePermissions.reverse();
  assert.deepEqual(
      assertStandaloneProjectObserverProfile(reordered),
      STANDALONE_PROJECT_OBSERVER_PROFILE,
  );

  for (const permission of [
    "resourcemanager.folders.get",
    "resourcemanager.organizations.get",
    "storage.objects.getIamPolicy",
    "datastore.entities.delete",
  ]) {
    const candidate = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
    candidate.effectivePermissions.effectiveRolePermissions.push(permission);
    assert.throws(
        () => assertStandaloneProjectObserverProfile(candidate),
        /profile claim/,
    );
  }
  const missingAuxiliary = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
  missingAuxiliary.effectivePermissions.effectiveAuxiliaryPermissions = [];
  assert.throws(
      () => assertStandaloneProjectObserverProfile(missingAuxiliary),
      /profile claim/,
  );
  const sameCountSwap = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
  sameCountSwap.effectivePermissions.effectiveRequiredPermissions[0] =
    "datastore.entities.delete";
  assert.throws(
      () => assertStandaloneProjectObserverProfile(sameCountSwap),
      /profile claim/,
  );
});

test("observer principal policy requires exact non-normalized strings", () => {
  assert.equal(
      assertObserverPrincipalPolicy(OBSERVER_PRINCIPAL_POLICY),
      OBSERVER_PRINCIPAL_POLICY,
  );
  const replacements = [
    {serviceAccountId: "academy-reset-freeze-observer-copy"},
    {
      member:
        "serviceAccount:other@" +
        "daegu-miami-production.iam.gserviceaccount.com",
    },
    {email: "other@daegu-miami-production.iam.gserviceaccount.com"},
    {
      email:
        "academy-reset-freeze-observer@other-project.iam.gserviceaccount.com",
    },
    {email: OBSERVER_PRINCIPAL_POLICY.email.toUpperCase()},
    {email: ` ${OBSERVER_PRINCIPAL_POLICY.email}`},
    {email: `${OBSERVER_PRINCIPAL_POLICY.email} `},
    {email: null},
    {email: 42},
    {email: "firebase-adminsdk-ab123@" +
      "daegu-miami-production.iam.gserviceaccount.com"},
    {email: "academy-reset-executor@" +
      "daegu-miami-production.iam.gserviceaccount.com"},
  ];
  for (const replacement of replacements) {
    const candidate = clone(OBSERVER_PRINCIPAL_POLICY);
    Object.assign(candidate, replacement);
    assert.throws(
        () => assertObserverPrincipalPolicy(candidate),
        /principal policy mismatch/,
    );
  }
  for (const missing of ["email", "member", "serviceAccountId"]) {
    const candidate = clone(OBSERVER_PRINCIPAL_POLICY);
    delete candidate[missing];
    assert.throws(
        () => assertObserverPrincipalPolicy(candidate),
        /exact keyset/,
    );
  }
});

test("coherent topology operation and permission claim tamper is rejected",
    () => {
      const candidate = clone(STANDALONE_PROJECT_OBSERVER_PROFILE);
      candidate.topologyEvidence.projectParent = "folders/123";
      candidate.topologyEvidence.folders = {
        count: 1,
        names: ["folders/123"],
        setDigest: digest(["folders/123"]),
      };
      candidate.topologyEvidenceDigest =
        digest(candidate.topologyEvidence);

      const operation = candidate.operationExecution;
      const removedNa = operation.notApplicableMandatoryOperationIds.shift();
      operation.notApplicableMandatoryOperationIds.push(
          "cloudresourcemanager.v3.projects.get",
      );
      operation.notApplicableMandatoryOperationIds.sort();
      operation.executedMandatoryOperationIds =
        operation.executedMandatoryOperationIds.filter((operationId) =>
          operationId !== "cloudresourcemanager.v3.projects.get");
      operation.executedMandatoryOperationIds.push(removedNa);
      operation.executedMandatoryOperationIds.sort();
      operation.executedMandatoryOperationSetDigest =
        computeProviderOperationIdSetDigest(
            operation.executedMandatoryOperationIds,
        );
      operation.notApplicableMandatoryOperationSetDigest =
        computeProviderOperationIdSetDigest(
            operation.notApplicableMandatoryOperationIds,
        );
      candidate.operationExecutionDigest = digest(operation);

      const permissions = candidate.effectivePermissions;
      permissions.effectiveRequiredPermissions[0] =
        "datastore.entities.delete";
      permissions.effectiveRequiredPermissions.sort();
      permissions.effectiveRequiredPermissionSetDigest =
        digest(permissions.effectiveRequiredPermissions);
      permissions.effectiveRolePermissions =
        [...new Set([
          ...permissions.effectiveRequiredPermissions,
          ...permissions.effectiveAuxiliaryPermissions,
        ])].sort();
      permissions.effectiveRolePermissionSetDigest =
        digest(permissions.effectiveRolePermissions);
      candidate.effectivePermissionProfileDigest = digest(permissions);

      const projection = clone(candidate);
      delete projection.profileDigest;
      candidate.profileDigest = digest(projection);
      assert.throws(
          () => assertStandaloneProjectObserverProfile(candidate),
          /profile claim/,
      );
    });
