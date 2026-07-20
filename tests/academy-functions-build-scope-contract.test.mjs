import assert from "node:assert/strict";
import test from "node:test";
import {
  APPROVED_ARTIFACT_REPOSITORY,
  APPROVED_CLOUD_BUILD_CONFIGURATION,
  APPROVED_INFRASTRUCTURE_EVIDENCE,
  APPROVED_SOURCE_BUCKET,
  APPROVED_UPLOAD_BUCKET,
  BUILD_CORE_PERMISSION_SET_DIGEST,
  BUILD_CORE_PERMISSIONS,
  BUILD_CORE_PROFILE,
  BUILD_RESOURCE_BINDINGS,
  BUILD_RESOURCE_BINDING_SET_DIGEST,
  BUILD_SCOPE_CONTRACT,
  BUILD_SCOPE_CONTRACT_DIGEST,
  COMPENSATING_CONTROL_DIGEST,
  CUSTOM_ROLE_SUPPORT_EVIDENCE,
  DEPLOYMENT_COMPENSATING_CONTROLS,
  DEPLOYMENT_TARGETS,
  DIRECT_PROJECT_ORGANIZATION_POLICY_RECORD_COUNT,
  DIRECT_PROJECT_ORGANIZATION_POLICY_RECORDS_DIGEST,
  DEPLOY_PERMISSIONS,
  DEPLOY_PERMISSION_SET_DIGEST,
  DEPLOY_PROFILE,
  EFFECTIVE_ORGANIZATION_POLICY_RECORD_COUNT,
  EFFECTIVE_ORGANIZATION_POLICY_RECORDS,
  EFFECTIVE_ORGANIZATION_POLICY_RECORDS_DIGEST,
  EVENTARC_EVIDENCE,
  FUNCTIONS_IDENTITIES,
  IMMUTABLE_RELEASE_EVIDENCE,
  INFRASTRUCTURE_EVIDENCE_DIGEST,
  ORGANIZATION_POLICY_COMPATIBILITY,
  ORGANIZATION_POLICY_CONSTRAINT_CATALOG_AUDIT,
  ORGANIZATION_POLICY_EVIDENCE,
  ORGANIZATION_POLICY_EVIDENCE_VERSION,
  buildOrganizationPolicyLineageReference,
  SERVICE_AGENT_FINDINGS,
  canonicalDigest,
  canonicalSetDigest,
  computeOrganizationPolicyEvidenceDigest,
  deriveOrganizationPolicyCompatibility,
  validateApprovedInfrastructureEvidence,
  validateBuildScopeContract,
  validateCompensatingControls,
  validateCustomRoleSupportEvidence,
  validateDeployProfile,
  validateEventarcEvidence,
  validateFunctionsBuildAndDeployContract,
  validateOrganizationPolicyEvidence,
  validateOrganizationPolicyLineageReference,
  validateServiceAgentFindings,
} from "../functions/scripts/academy-functions-build-scope-contract.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));

function replacePermission(profile, removed, added) {
  const changed = clone(profile);
  changed.permissions = changed.permissions.map((permission) =>
    permission === removed ? added : permission);
  return changed;
}

test("approved infrastructure evidence is exact, canonical, and frozen", () => {
  assert.equal(Object.isFrozen(APPROVED_INFRASTRUCTURE_EVIDENCE), true);
  assert.equal(Object.isFrozen(APPROVED_SOURCE_BUCKET), true);
  assert.equal(Object.isFrozen(APPROVED_UPLOAD_BUCKET), true);
  assert.equal(Object.isFrozen(APPROVED_ARTIFACT_REPOSITORY), true);
  assert.equal(Object.isFrozen(APPROVED_CLOUD_BUILD_CONFIGURATION), true);
  assert.deepEqual(APPROVED_SOURCE_BUCKET, {
    resource: "gs://gcf-v2-sources-884850632328-us-central1",
    name: "gcf-v2-sources-884850632328-us-central1",
    ownerProjectNumber: "884850632328",
    location: "US-CENTRAL1",
    storageClass: "STANDARD",
    cmek: "NONE",
  });
  assert.deepEqual(APPROVED_UPLOAD_BUCKET, {
    resource:
      "gs://gcf-v2-uploads-884850632328.us-central1.cloudfunctions.appspot.com",
    name:
      "gcf-v2-uploads-884850632328.us-central1.cloudfunctions.appspot.com",
    ownerProjectNumber: "884850632328",
    location: "US-CENTRAL1",
    storageClass: "STANDARD",
    cmek: "NONE",
  });
  assert.deepEqual(APPROVED_ARTIFACT_REPOSITORY, {
    resource:
      "projects/daegu-miami-production/locations/us-central1/repositories/gcf-artifacts",
    location: "us-central1",
    format: "DOCKER",
    mode: "STANDARD_REPOSITORY",
    cmek: "NONE",
  });
  assert.deepEqual(APPROVED_CLOUD_BUILD_CONFIGURATION, {
    logging: "CLOUD_LOGGING_ONLY",
    logsBucket: null,
    defaultLogsBucketBehavior: "UNSET",
    workerPool: "DEFAULT",
  });
  assert.equal(
      canonicalDigest(APPROVED_INFRASTRUCTURE_EVIDENCE),
      INFRASTRUCTURE_EVIDENCE_DIGEST,
  );
  assert.equal(validateApprovedInfrastructureEvidence().valid, true);
});

test("infrastructure validator rejects bucket and Build metadata drift", () => {
  for (const [section, field, value] of [
    ["sourceBucket", "ownerProjectNumber", "000000000000"],
    ["sourceBucket", "location", "EU"],
    ["sourceBucket", "storageClass", "NEARLINE"],
    ["sourceBucket", "cmek", "projects/p/locations/l/keyRings/r/cryptoKeys/k"],
    ["uploadBucket", "name", "wrong-upload-bucket"],
    ["uploadBucket", "cmek", "CUSTOMER_MANAGED"],
    ["cloudBuild", "logging", "GCS_ONLY"],
    ["cloudBuild", "logsBucket", "gs://unexpected-logs"],
    ["cloudBuild", "defaultLogsBucketBehavior", "REGIONAL_USER_OWNED_BUCKET"],
    ["cloudBuild", "workerPool", "projects/p/locations/l/workerPools/w"],
  ]) {
    const evidence = clone(APPROVED_INFRASTRUCTURE_EVIDENCE);
    evidence[section][field] = value;
    assert.throws(
        () => validateApprovedInfrastructureEvidence(evidence),
        /exact canonical invariant/,
        `${section}.${field}`,
    );
  }
});

test("J. exact project Build Core custom profile is accepted", () => {
  assert.equal(BUILD_CORE_PROFILE.profileId, "academyFunctionsBuildCoreV1");
  assert.equal(BUILD_CORE_PROFILE.permissionCount, 2);
  assert.deepEqual(BUILD_CORE_PROFILE.permissions, [
    "logging.logEntries.create",
    "logging.logEntries.route",
  ]);
  assert.equal(BUILD_CORE_PROFILE.resource, "projects/daegu-miami-production");
  assert.equal(
      canonicalSetDigest(BUILD_CORE_PERMISSIONS),
      BUILD_CORE_PERMISSION_SET_DIGEST,
  );
  const result = validateBuildScopeContract();
  assert.equal(result.valid, true);
  assert.equal(result.contractDigest, BUILD_SCOPE_CONTRACT_DIGEST);
});

test("Build Core rejects same-count permission swaps and metadata drift", () => {
  const permissionSwap = clone(BUILD_SCOPE_CONTRACT);
  permissionSwap.coreProfile.permissions[1] = "logging.logEntries.list";
  assert.throws(
      () => validateBuildScopeContract(permissionSwap),
      /Build Core exact permission invariant/,
  );

  const metadataDrift = clone(BUILD_SCOPE_CONTRACT);
  metadataDrift.coreProfile.stage = "BETA";
  assert.throws(
      () => validateBuildScopeContract(metadataDrift),
      /exact canonical invariant/,
  );
});

test("K. exact source and upload bucket bindings are accepted", () => {
  const bucketBindings = BUILD_RESOURCE_BINDINGS.filter(
      ({resourceType}) => resourceType === "CLOUD_STORAGE_BUCKET",
  );
  assert.equal(bucketBindings.length, 2);
  assert.deepEqual(
      new Set(bucketBindings.map(({resource}) => resource)),
      new Set([
        APPROVED_SOURCE_BUCKET.resource,
        APPROVED_UPLOAD_BUCKET.resource,
      ]),
  );
  assert.equal(
      bucketBindings.every(({role}) =>
        role === "roles/storage.objectViewer"),
      true,
  );
  assert.equal(validateBuildScopeContract().valid, true);
});

test("L. exact Artifact Registry repository binding is accepted", () => {
  const repositoryBindings = BUILD_RESOURCE_BINDINGS.filter(
      ({resourceType}) =>
        resourceType === "ARTIFACT_REGISTRY_REPOSITORY",
  );
  assert.deepEqual(repositoryBindings, [{
    bindingId: "artifact-repository-writer",
    principal:
      "serviceAccount:" +
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    resource: APPROVED_ARTIFACT_REPOSITORY.resource,
    resourceType: "ARTIFACT_REGISTRY_REPOSITORY",
    role: "roles/artifactregistry.writer",
  }]);
  assert.equal(
      canonicalSetDigest(BUILD_RESOURCE_BINDINGS),
      BUILD_RESOURCE_BINDING_SET_DIGEST,
  );
});

test("M. Storage object viewer at project scope is rejected", () => {
  const broad = clone(BUILD_SCOPE_CONTRACT);
  broad.projectWideStorageBindings.push({
    principal:
      "serviceAccount:" +
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    resource: "projects/daegu-miami-production",
    role: "roles/storage.objectViewer",
  });
  assert.throws(
      () => validateBuildScopeContract(broad),
      /Project-wide Storage binding is forbidden/,
  );
});

test("N. Artifact Registry writer at project scope is rejected", () => {
  const broad = clone(BUILD_SCOPE_CONTRACT);
  broad.projectWideArtifactRegistryBindings.push({
    principal:
      "serviceAccount:" +
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    resource: "projects/daegu-miami-production",
    role: "roles/artifactregistry.writer",
  });
  assert.throws(
      () => validateBuildScopeContract(broad),
      /Project-wide Artifact Registry binding is forbidden/,
  );
});

test("O. wrong source or upload bucket is rejected", () => {
  for (const bindingId of [
    "source-bucket-object-viewer",
    "upload-bucket-object-viewer",
  ]) {
    const wrong = clone(BUILD_SCOPE_CONTRACT);
    wrong.resourceBindings.find(
        (binding) => binding.bindingId === bindingId,
    ).resource = "gs://wrong-bucket";
    assert.throws(
        () => validateBuildScopeContract(wrong),
        /Build resource bindings exact set invariant/,
        bindingId,
    );
  }
});

test("P. wrong repository identity, location, format, mode, or CMEK is rejected", () => {
  const wrongBinding = clone(BUILD_SCOPE_CONTRACT);
  wrongBinding.resourceBindings.find(
      ({bindingId}) => bindingId === "artifact-repository-writer",
  ).resource =
    "projects/daegu-miami-production/locations/europe-west1/repositories/gcf-artifacts";
  assert.throws(
      () => validateBuildScopeContract(wrongBinding),
      /Build resource bindings exact set invariant/,
  );

  for (const [field, value] of [
    ["resource",
      "projects/daegu-miami-production/locations/us-central1/repositories/other"],
    ["location", "europe-west1"],
    ["format", "MAVEN"],
    ["mode", "REMOTE_REPOSITORY"],
    ["cmek", "CUSTOMER_MANAGED"],
  ]) {
    const evidence = clone(APPROVED_INFRASTRUCTURE_EVIDENCE);
    evidence.artifactRepository[field] = value;
    assert.throws(
        () => validateApprovedInfrastructureEvidence(evidence),
        /exact canonical invariant/,
        field,
    );
  }
});

test("Q. same-count bucket resource swaps are rejected", () => {
  const swapped = clone(BUILD_SCOPE_CONTRACT);
  const source = swapped.resourceBindings.find(
      ({bindingId}) => bindingId === "source-bucket-object-viewer",
  );
  const upload = swapped.resourceBindings.find(
      ({bindingId}) => bindingId === "upload-bucket-object-viewer",
  );
  [source.resource, upload.resource] = [upload.resource, source.resource];
  assert.equal(swapped.resourceBindings.length, BUILD_RESOURCE_BINDINGS.length);
  assert.throws(
      () => validateBuildScopeContract(swapped),
      /Build resource bindings exact set invariant/,
  );
});

test("Q. same-count repository and bucket role swap is rejected", () => {
  const swapped = clone(BUILD_SCOPE_CONTRACT);
  const repository = swapped.resourceBindings.find(
      ({bindingId}) => bindingId === "artifact-repository-writer",
  );
  const source = swapped.resourceBindings.find(
      ({bindingId}) => bindingId === "source-bucket-object-viewer",
  );
  [repository.role, source.role] = [source.role, repository.role];
  assert.equal(swapped.resourceBindings.length, BUILD_RESOURCE_BINDINGS.length);
  assert.throws(
      () => validateBuildScopeContract(swapped),
      /Build resource bindings exact set invariant/,
  );
});

test("R. dedicated Build SA cannot be confused with service agent", () => {
  assert.notEqual(
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
      FUNCTIONS_IDENTITIES.googleManagedCloudBuildServiceAgent,
  );
  const confused = clone(BUILD_SCOPE_CONTRACT);
  confused.identity.dedicatedBuildServiceAccount =
    confused.identity.googleManagedCloudBuildServiceAgent;
  confused.identity.identitiesAreDistinct = true;
  assert.throws(
      () => validateBuildScopeContract(confused),
      /Dedicated Build identity must differ/,
  );
});

test("Deploy profile pins exact nine GA supported permissions", () => {
  assert.equal(DEPLOY_PROFILE.profileId, "academyFunctionsDeployV1");
  assert.equal(DEPLOY_PROFILE.permissionCount, 9);
  assert.equal(DEPLOY_PROFILE.stage, "GA");
  assert.equal(
      DEPLOY_PROFILE.customRolesSupport,
      "SUPPORTED_BY_OMISSION",
  );
  assert.deepEqual(DEPLOY_PROFILE.permissions, DEPLOY_PERMISSIONS);
  assert.equal(
      canonicalSetDigest(DEPLOY_PROFILE.permissions),
      DEPLOY_PERMISSION_SET_DIGEST,
  );
  assert.equal(validateDeployProfile().valid, true);
});

test("Deploy profile rejects wrong same-count swaps and metadata changes", () => {
  const wrong = replacePermission(
      DEPLOY_PROFILE,
      "cloudfunctions.functions.get",
      "cloudfunctions.functions.update",
  );
  assert.equal(wrong.permissions.length, 9);
  assert.throws(
      () => validateDeployProfile(wrong),
      /forbidden permission|exact 9-permission/,
  );

  for (const field of ["profileId", "stage", "customRolesSupport"]) {
    const changed = clone(DEPLOY_PROFILE);
    changed[field] = "CHANGED";
    assert.throws(
        () => validateDeployProfile(changed),
        /exact canonical invariant/,
        field,
    );
  }
});

test("Deploy profile rejects update, delete, IAM, SA, key, Scheduler, API, and broad roles", () => {
  for (const forbidden of [
    "cloudfunctions.functions.update",
    "cloudfunctions.functions.delete",
    "resourcemanager.projects.setIamPolicy",
    "iam.roles.update",
    "iam.serviceAccounts.update",
    "iam.serviceAccountKeys.create",
    "cloudscheduler.jobs.update",
    "serviceusage.services.enable",
  ]) {
    const changed = replacePermission(
        DEPLOY_PROFILE,
        "cloudfunctions.functions.get",
        forbidden,
    );
    assert.throws(
        () => validateDeployProfile(changed),
        /forbidden permission|exact 9-permission/,
        forbidden,
    );
  }
  assert.deepEqual(DEPLOY_PROFILE.forbiddenBroadRoles, [
    "roles/editor",
    "roles/owner",
  ]);
});

test("Eventarc absence is accepted only for exact HTTP callable targets", () => {
  assert.equal(validateEventarcEvidence().valid, true);
  assert.equal(EVENTARC_EVIDENCE.apiState, "ENABLED");
  assert.equal(
      EVENTARC_EVIDENCE.eventarcServiceAgentProjectBinding,
      "ABSENT",
  );
  assert.equal(EVENTARC_EVIDENCE.eventarcServiceAgentBindingRequired, false);

  const triggered = clone(EVENTARC_EVIDENCE);
  triggered.eventTriggerCount = 1;
  triggered.targetContract[0].triggerType = "EVENT_TRIGGER";
  triggered.targetContract[0].eventTrigger = {
    eventType: "google.cloud.firestore.document.v1.written",
  };
  assert.throws(
      () => validateEventarcEvidence(triggered),
      /only for exact HTTP callable targets/,
  );
});

test("service-agent and custom-role support findings are exact", () => {
  assert.equal(validateServiceAgentFindings(), true);
  assert.equal(SERVICE_AGENT_FINDINGS.length, 5);
  assert.equal(
      SERVICE_AGENT_FINDINGS.every(
          ({conditionalBinding}) => conditionalBinding === false,
      ),
      true,
  );
  const support = validateCustomRoleSupportEvidence();
  assert.equal(support.roleCheckCount, 19);
  assert.equal(support.uniquePermissionCount, 16);

  const wrongRole = clone(SERVICE_AGENT_FINDINGS);
  wrongRole[0].role = "roles/editor";
  assert.throws(
      () => validateServiceAgentFindings(wrongRole),
      /exact set invariant/,
  );

  const inventedSupport = clone(CUSTOM_ROLE_SUPPORT_EVIDENCE);
  inventedSupport.missingCount = 1;
  assert.throws(
      () => validateCustomRoleSupportEvidence(inventedSupport),
      /exact canonical invariant|19\/19 invariant/,
  );
});

test("Organization Policy pins exact 21-record compatible evidence", () => {
  const result = validateOrganizationPolicyEvidence();
  const lineage = buildOrganizationPolicyLineageReference();
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.contractVersion,
      ORGANIZATION_POLICY_EVIDENCE_VERSION,
  );
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.projectId,
      "daegu-miami-production",
  );
  assert.equal(ORGANIZATION_POLICY_EVIDENCE.apiEnabled, true);
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.observationStatus,
      "OBSERVED_COMPATIBLE_WITH_EXPLICIT_CONTROLS",
  );
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.directProjectPolicies.count,
      DIRECT_PROJECT_ORGANIZATION_POLICY_RECORD_COUNT,
  );
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.directProjectPolicies.digest,
      DIRECT_PROJECT_ORGANIZATION_POLICY_RECORDS_DIGEST,
  );
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.effectivePolicies.count,
      EFFECTIVE_ORGANIZATION_POLICY_RECORD_COUNT,
  );
  assert.equal(ORGANIZATION_POLICY_EVIDENCE.effectivePolicies.failedCount, 0);
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.effectivePolicies.digest,
      EFFECTIVE_ORGANIZATION_POLICY_RECORDS_DIGEST,
  );
  assert.deepEqual(
      ORGANIZATION_POLICY_EVIDENCE.effectivePolicies.records,
      EFFECTIVE_ORGANIZATION_POLICY_RECORDS,
  );
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.effectiveDecision,
      "COMPATIBLE_WITH_EXPLICIT_CONTROLS",
  );
  assert.equal(
      ORGANIZATION_POLICY_EVIDENCE.observationAvailability,
      "AVAILABLE",
  );
  assert.deepEqual(
      ORGANIZATION_POLICY_EVIDENCE.compatibility,
      ORGANIZATION_POLICY_COMPATIBILITY,
  );
  assert.deepEqual(
      ORGANIZATION_POLICY_EVIDENCE.constraintCatalogAudit,
      ORGANIZATION_POLICY_CONSTRAINT_CATALOG_AUDIT,
  );
  assert.match(ORGANIZATION_POLICY_EVIDENCE.evidenceDigest, /^[a-f0-9]{64}$/);
  assert.equal(
      computeOrganizationPolicyEvidenceDigest(ORGANIZATION_POLICY_EVIDENCE),
      ORGANIZATION_POLICY_EVIDENCE.evidenceDigest,
  );
  assert.equal(validateOrganizationPolicyLineageReference(lineage), true);
  assert.equal(result.organizationPolicyCompatible, true);
  assert.equal(result.provisioningPolicyCompatible, true);
  assert.equal(result.deploymentPolicyCompatible, true);
  assert.equal(result.publicInvokerPolicyCompatible, true);
  assert.equal(result.mutationCommandPublicationPolicyCompatible, true);

  const staleLineage = clone(lineage);
  staleLineage.organizationPolicyEvidenceDigest = "0".repeat(64);
  assert.throws(() =>
    validateOrganizationPolicyLineageReference(staleLineage));
});

test("Organization Policy rejects direct/effective count and digest drift",
    () => {
      for (const mutate of [
        (evidence) => {
          evidence.directProjectPolicies.count = 1;
        },
        (evidence) => {
          evidence.directProjectPolicies.digest = "0".repeat(64);
        },
        (evidence) => {
          evidence.effectivePolicies.count = 20;
        },
        (evidence) => {
          evidence.effectivePolicies.digest = "0".repeat(64);
        },
      ]) {
        const evidence = clone(ORGANIZATION_POLICY_EVIDENCE);
        mutate(evidence);
        evidence.evidenceDigest =
          computeOrganizationPolicyEvidenceDigest(evidence);
        assert.throws(
            () => validateOrganizationPolicyEvidence(evidence),
            /Organization Policy/,
        );
      }
    });

test("Organization Policy derives semantics from exact effective records",
    () => {
      const changedConstraint = (constraint, rule) => {
        const records = clone(EFFECTIVE_ORGANIZATION_POLICY_RECORDS);
        records.find((record) => record.constraint === constraint)
            .spec.rules[0] = rule;
        return records;
      };
      for (const [constraint, rule] of [
        ["cloudbuild.disableCreateDefaultServiceAccount", {enforce: false}],
        ["iam.disableCrossProjectServiceAccountUsage", {enforce: false}],
        ["iam.allowedPolicyMemberDomains", {allowAll: false}],
        ["iam.managed.allowedPolicyMembers", {enforce: true}],
        ["run.managed.requireInvokerIam", {enforce: true}],
        ["cloudfunctions.restrictAllowedGenerations", {allowAll: false}],
        ["gcp.resourceLocations", {allowAll: false}],
        ["gcp.restrictNonCmekServices", {allowAll: false}],
      ]) {
        assert.throws(
            () => deriveOrganizationPolicyCompatibility(
                changedConstraint(constraint, rule),
            ),
            /Organization Policy/,
            constraint,
        );
      }

      const changedRecord = clone(ORGANIZATION_POLICY_EVIDENCE);
      changedRecord.effectivePolicies.records[0].spec.rules[0].enforce = false;
      changedRecord.evidenceDigest =
        computeOrganizationPolicyEvidenceDigest(changedRecord);
      assert.throws(
          () => validateOrganizationPolicyEvidence(changedRecord),
          /Organization Policy/,
      );
    });

test("constraint catalog digest is audit-only for compatibility derivation",
    () => {
      const before = deriveOrganizationPolicyCompatibility(
          EFFECTIVE_ORGANIZATION_POLICY_RECORDS,
      );
      const catalogOnlyChange = clone(ORGANIZATION_POLICY_CONSTRAINT_CATALOG_AUDIT);
      catalogOnlyChange.digest = "0".repeat(64);
      assert.deepEqual(
          deriveOrganizationPolicyCompatibility(
              EFFECTIVE_ORGANIZATION_POLICY_RECORDS,
          ),
          before,
      );
      assert.equal(catalogOnlyChange.disposition, "AUDIT_METADATA_ONLY");
    });

test("compensating controls pin immutable release and ordered private deployment", () => {
  assert.deepEqual(
      DEPLOYMENT_TARGETS.map(({phase}) => phase),
      ["PREVIEW", "ASSIGNMENT", "OUTCOME"],
  );
  assert.deepEqual(
      DEPLOYMENT_TARGETS.map(({functionName}) => functionName),
      [
        "previewFixedPrivateLessonOutcomeAction",
        "createFixedPrivateLessonAssignment",
        "commitFixedPrivateLessonOutcomeAction",
      ],
  );
  assert.equal(
      DEPLOYMENT_COMPENSATING_CONTROLS.immutableRelease.releaseSha,
      "c7eaa7b27fc9c5e9d74ae97043de6536f41a75db",
  );
  assert.equal(
      DEPLOYMENT_COMPENSATING_CONTROLS.immutableRelease.gitTree,
      "3b0bf8c310d7e8067ac09305dc93ec3f07090bd7",
  );
  assert.equal(
      DEPLOYMENT_COMPENSATING_CONTROLS.immutableRelease.functionsIndexSha256,
      "754e1f559a28ca1721c5b732ede0acce91dfbb409ada6153de93092d1209db49",
  );
  assert.equal(
      DEPLOYMENT_COMPENSATING_CONTROLS.immutableRelease.writerSourceDigest,
      "8f63180960dde64a252f12c68fbe6fed938333d1325514660e0a972b6b06209b",
  );
  assert.equal(
      DEPLOYMENT_COMPENSATING_CONTROLS.immutableRelease.selectorLfDigest,
      "cd26a1b992337fc61562663b4f97ce08cd70f062abd6546701ba364f67f8db10",
  );
  assert.equal(
      DEPLOYMENT_COMPENSATING_CONTROLS.immutableRelease
          .existingFunctionBaselineDigest,
      "1cb924fc62c97771d42fb60b98934d9f48e5192abbf0b03b31d06753ff41dcfd",
  );
  assert.equal(
      validateCompensatingControls().finalInventory,
      "35/35",
  );
});

test("release binding rejects old, mismatched, shortened, and coherent tamper",
    () => {
      for (const mutate of [
        (release) => {
          release.releaseSha =
            "f081bd7765d37db27642f9657bb307b5fb2da414";
          release.gitTree = "55f98bd0565cdf3ad3b4204a689c653769df3443";
        },
        (release) => {
          release.releaseSha = "0".repeat(40);
        },
        (release) => {
          release.gitTree = "0".repeat(40);
        },
        (release) => {
          release.releaseSha = IMMUTABLE_RELEASE_EVIDENCE.releaseSha.slice(0, 12);
        },
        (release) => {
          release.gitTree = IMMUTABLE_RELEASE_EVIDENCE.gitTree.slice(0, 12);
        },
        (release) => {
          release.functionsIndexSha256 = "0".repeat(64);
          release.writerSourceDigest = "1".repeat(64);
          release.selectorLfDigest = "2".repeat(64);
        },
      ]) {
        const changed = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
        mutate(changed.immutableRelease);
        assert.throws(
            () => validateCompensatingControls(
                changed,
                canonicalDigest(changed),
            ),
            /Immutable release evidence|digest invariant/,
        );
      }
    });

test("Build scope rejects every default service-account fallback", () => {
  for (const mutate of [
    (selection) => {
      selection.mode = "DEFAULT";
    },
    (selection) => {
      selection.serviceAccount =
        FUNCTIONS_IDENTITIES.googleManagedCloudBuildServiceAgent;
    },
    (selection) => {
      selection.defaultFallbackAllowed = true;
    },
  ]) {
    const changed = clone(BUILD_SCOPE_CONTRACT);
    mutate(changed.identity.buildServiceAccountSelection);
    assert.throws(
        () => validateBuildScopeContract(changed),
        /selected explicitly/,
    );
  }
});

test("compensating controls reject missing baseline and wrong selector digest", () => {
  const missingBaseline = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
  delete missingBaseline.immutableRelease.existingFunctionBaselineDigest;
  assert.throws(
      () => validateCompensatingControls(missingBaseline),
      /Immutable release evidence/,
  );

  const wrongSelector = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
  wrongSelector.immutableRelease.selectorLfDigest = "0".repeat(64);
  assert.throws(
      () => validateCompensatingControls(wrongSelector),
      /Immutable release evidence/,
  );
});

test("compensating controls reject reordered targets and incomplete verification", () => {
  const reordered = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
  [reordered.targets[0], reordered.targets[1]] =
    [reordered.targets[1], reordered.targets[0]];
  assert.throws(
      () => validateCompensatingControls(reordered),
      /Private deployment order invariant/,
  );

  const incomplete = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
  incomplete.deploymentMode.perStepVerification =
    incomplete.deploymentMode.perStepVerification.filter(
        (kind) => kind !== "SOURCE_IDENTITY",
    );
  assert.throws(
      () => validateCompensatingControls(incomplete),
      /Per-step verification/,
  );
});

test("compensating controls require exact JIT project and region access", () => {
  for (const [field, value] of [
    ["jitRequired", false],
    ["resource", "projects/wrong-project"],
    ["region", "europe-west1"],
    ["maximumDurationSeconds", 7201],
  ]) {
    const changed = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
    changed.deploymentAccess[field] = value;
    assert.throws(
        () => validateCompensatingControls(changed),
        /compensating-control gate/,
        field,
    );
  }
});

test("compensating controls reject public invoker before validation", () => {
  const earlyPublic = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
  earlyPublic.invokerGate.publicInvokerAppliedBeforeFullValidation = true;
  assert.throws(
      () => validateCompensatingControls(earlyPublic),
      /compensating-control gate/,
  );
});

test("compensating controls reject temporary binding retention", () => {
  for (const field of [
    "deployBindingRemoved",
    "impersonationBindingRemoved",
  ]) {
    const retained = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
    retained.temporaryAccess[field] = false;
    assert.throws(
        () => validateCompensatingControls(retained),
        /compensating-control gate/,
        field,
    );
  }
});

test("compensating controls reject an insecure or missing audit artifact", () => {
  for (const [field, value] of [
    ["required", false],
    ["directoryMode", "0755"],
    ["fileMode", "0644"],
  ]) {
    const changed = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
    changed.secureAuditArtifact[field] = value;
    assert.throws(
        () => validateCompensatingControls(changed),
        /compensating-control gate/,
        field,
    );
  }
});

test("coherent control/count/digest tamper cannot self-authorize", () => {
  const tampered = clone(DEPLOYMENT_COMPENSATING_CONTROLS);
  tampered.inventoryGate.existingFunctionCount = 31;
  tampered.inventoryGate.targetFunctionCount = 3;
  tampered.inventoryGate.finalFunctionCount = 34;
  tampered.inventoryGate.finalGen2FunctionCount = 34;
  const selfDerivedDigest = canonicalDigest(tampered);
  assert.notEqual(selfDerivedDigest, COMPENSATING_CONTROL_DIGEST);
  assert.throws(
      () => validateCompensatingControls(tampered, selfDerivedDigest),
      /compensating-control gate|digest invariant/,
  );
});

test("aggregate approval rejects update or delete despite exact controls", () => {
  for (const forbidden of [
    "cloudfunctions.functions.update",
    "cloudfunctions.functions.delete",
  ]) {
    const profile = replacePermission(
        DEPLOY_PROFILE,
        "cloudfunctions.functions.get",
        forbidden,
    );
    assert.throws(
        () => validateFunctionsBuildAndDeployContract({
          deployProfile: profile,
        }),
        /forbidden permission|exact 9-permission/,
        forbidden,
    );
  }
});

test("set digests are order invariant and reject duplicates", () => {
  assert.equal(
      canonicalSetDigest([...DEPLOY_PERMISSIONS].reverse()),
      DEPLOY_PERMISSION_SET_DIGEST,
  );
  assert.equal(
      canonicalSetDigest([...BUILD_RESOURCE_BINDINGS].reverse()),
      BUILD_RESOURCE_BINDING_SET_DIGEST,
  );
  assert.throws(
      () => canonicalSetDigest([
        DEPLOY_PERMISSIONS[0],
        DEPLOY_PERMISSIONS[0],
      ]),
      /duplicate/,
  );
});

test("aggregate local contract validates but remains provisioning-ineligible", () => {
  const result = validateFunctionsBuildAndDeployContract();
  assert.equal(result.validLocalContract, true);
  assert.equal(result.organizationPolicyCompatible, true);
  assert.equal(result.actualProvisioningEligible, false);
  assert.equal(result.deploymentApprovalEligible, false);
  assert.equal(result.publicInvokerApprovalEligible, false);
  assert.equal(result.iamMutationCommandPublication, false);
  assert.equal(result.executionApprovalRequired, true);
});
