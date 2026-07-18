import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import * as observerModule from
  "../functions/scripts/observe-academy-reset-freeze-production.mjs";
import {
  PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC,
  PRODUCTION_OBSERVER_SCHEMA_VERSION,
  PRODUCTION_OBSERVER_SENSITIVE_FILENAME,
  PRODUCTION_OBSERVER_SUMMARY_FILENAME,
  executeInjectedMockProductionObserverHarness,
  parseProductionObserverArguments,
  publishProductionObserverArtifactPair,
} from "../functions/scripts/observe-academy-reset-freeze-production.mjs";
import {
  PROVIDER_MANDATORY_OPERATION_IDS,
  PROVIDER_TARGET_PROJECT_ID,
  PROVIDER_TARGET_PROJECT_NUMBER,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";
import {
  EXPECTED_DEPLOYED_FUNCTION_NAMES,
  EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
  KNOWN_IAM_GROUPS,
  REVIEWED_IAM_ROLE_DEFINITIONS,
  REVIEWED_WRITABLE_PERMISSIONS,
  SCHEDULER_JOB_ALLOWLIST,
} from "../functions/scripts/academy-reset-write-freeze-contract.mjs";
import {
  EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
} from "../functions/scripts/academy-reset-freeze-provider-reviewed-sources.mjs";
import {
  OBSERVER_PRINCIPAL_POLICY,
  STANDALONE_PROJECT_OBSERVER_PROFILE,
  STANDALONE_SOURCE_BUCKET_NAME,
} from "../functions/scripts/academy-reset-freeze-readonly-permissions.mjs";

const repositoryRoot =
  fs.realpathSync.native(path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
  ));
const RELEASE_SHA = "1".repeat(40);
const TREE_SHA = "2".repeat(40);
const SOURCE_SET_DIGEST = "3".repeat(64);
const STARTED_AT = Date.parse("2026-07-18T00:00:00.000Z");
const COMPLETED_AT = STARTED_AT + 1000;
const OBSERVED_AT = COMPLETED_AT + 1000;
const SECRET_KEY = [
  "-----BEGIN PRIVATE KEY-----",
  "in-memory-observer-test-only",
  "-----END PRIVATE KEY-----",
].join("\n");
const SECRET_EMAIL = OBSERVER_PRINCIPAL_POLICY.email;
const SECRET_CLIENT_ID = "123456789012345678901";

function canonical(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(",")}]`;
  }
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function fixtureOperationTraceSummary(operationTrace) {
  const counts = new Map();
  for (const {operationId} of operationTrace) {
    counts.set(operationId, (counts.get(operationId) ?? 0) + 1);
  }
  const operationIds = [...counts.keys()].sort();
  const executedMandatoryOperationIds = operationIds.filter((operationId) =>
    PROVIDER_MANDATORY_OPERATION_IDS.includes(operationId));
  const optionalDiagnosticOperationIds = operationIds.filter((operationId) =>
    !PROVIDER_MANDATORY_OPERATION_IDS.includes(operationId));
  const perOperationTraceCounts = operationIds.map((operationId) => ({
    operationId,
    traceCount: counts.get(operationId),
  }));
  return {
    traceEventCount: operationTrace.length,
    uniqueOperationCount: operationIds.length,
    operationIds,
    operationIdSetDigest: sha256Canonical(operationIds),
    executedMandatoryOperationCount: executedMandatoryOperationIds.length,
    executedMandatoryOperationIds,
    executedMandatoryOperationSetDigest:
      sha256Canonical(executedMandatoryOperationIds),
    optionalDiagnosticOperationCount:
      optionalDiagnosticOperationIds.length,
    optionalDiagnosticOperationIds,
    optionalDiagnosticOperationSetDigest:
      sha256Canonical(optionalDiagnosticOperationIds),
    perOperationTraceCounts,
    perOperationTraceCountDigest: sha256Canonical(perOperationTraceCounts),
  };
}

function fixtureSourceBucketIdentity(functionRecords, {
  bucketName = STANDALONE_SOURCE_BUCKET_NAME,
  projectNumber = PROVIDER_TARGET_PROJECT_NUMBER,
  location = "US-CENTRAL1",
  storageClass = "STANDARD",
} = {}) {
  const functionIds = functionRecords
      .filter(({source}) => source.bucket === bucketName)
      .map(({functionId}) => functionId)
      .sort();
  const response = {
    name: bucketName,
    projectNumber,
    location,
    storageClass,
  };
  const functionSourceProvenance = {
    functionCount: functionIds.length,
    functionIds,
    functionIdSetDigest: sha256Canonical(functionIds),
  };
  const identity = {
    bucketName,
    projectNumber,
    location,
    storageClass,
    observationOperationId: "storage.v1.buckets.get",
    observationResponseDigest: sha256Canonical(response),
    functionSourceProvenance,
  };
  return {
    ...identity,
    bucketIdentityDigest: sha256Canonical(identity),
  };
}

function fixtureSourceBucketIdentitySetDigest(sourceBucketIdentities) {
  return sha256Canonical([...sourceBucketIdentities]
      .sort((left, right) => left.bucketName.localeCompare(right.bucketName)));
}

function fixtureHierarchyIdentityProjection({
  resourceType,
  canonicalResourceName,
  projectId,
  projectNumber,
  parentResourceName,
  providerObservationSource,
  hierarchyDepth,
}) {
  return {
    resourceType,
    canonicalResourceName,
    projectId,
    projectNumber,
    parentResourceName,
    providerObservationSource,
    hierarchyDepth,
  };
}

function fixtureHierarchyResource({
  kind = "projects",
  singular = "project",
  id = PROVIDER_TARGET_PROJECT_ID,
  name = `projects/${PROVIDER_TARGET_PROJECT_ID}`,
  parentResourceName = null,
  hierarchyDepth = 0,
} = {}) {
  const identity = fixtureHierarchyIdentityProjection({
    resourceType: singular,
    canonicalResourceName: name,
    projectId: PROVIDER_TARGET_PROJECT_ID,
    projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
    parentResourceName,
    providerObservationSource: `cloudresourcemanager.v3.${kind}.get`,
    hierarchyDepth,
  });
  return {
    kind,
    singular,
    id,
    name,
    ...identity,
    resourceIdentityDigest: sha256Canonical(identity),
  };
}

function deriveFixtureResourceUniverse(iam) {
  const hierarchyByName =
    new Map(iam.hierarchy.map((resource) => [resource.name, resource]));
  assert.equal(hierarchyByName.size, iam.hierarchy.length);
  const projectName = `projects/${PROVIDER_TARGET_PROJECT_ID}`;
  const visited = new Set();
  const hierarchyResources = [];
  let current = hierarchyByName.get(projectName);
  let depth = 0;
  assert.ok(current);
  while (current) {
    assert.equal(visited.has(current.name), false);
    visited.add(current.name);
    assert.equal(current.hierarchyDepth, depth);
    const identity = fixtureHierarchyIdentityProjection(current);
    assert.equal(current.resourceIdentityDigest, sha256Canonical(identity));
    hierarchyResources.push({
      ...identity,
      resourceIdentityDigest: current.resourceIdentityDigest,
    });
    current = current.parentResourceName === null ?
      null :
      hierarchyByName.get(current.parentResourceName);
    depth += 1;
  }
  assert.equal(visited.size, hierarchyByName.size);
  const serviceAccountResources = iam.serviceAccounts.map((account) => {
    const identity = {
      resourceType: "serviceAccount",
      canonicalResourceName: account.name,
      projectId: PROVIDER_TARGET_PROJECT_ID,
      projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
      parentResourceName: projectName,
      providerObservationSource: "iam.v1.projects.serviceAccounts.get",
      hierarchyDepth: 1,
      email: account.email,
      uniqueId: account.uniqueId ?? null,
    };
    return {...identity, resourceIdentityDigest: sha256Canonical(identity)};
  });
  return {
    hierarchyByName,
    serviceAccountByName:
      new Map(serviceAccountResources.map((resource) =>
        [resource.canonicalResourceName, resource])),
    resourceUniverseDigest: sha256Canonical({
      hierarchyResources:
        hierarchyResources.sort((left, right) =>
          canonical(left).localeCompare(canonical(right))),
      serviceAccountResources:
        serviceAccountResources.sort((left, right) =>
          canonical(left).localeCompare(canonical(right))),
    }),
  };
}

function deriveFixtureIamUniverse(iam) {
  const resources = deriveFixtureResourceUniverse(iam);
  const roleMap = new Map(iam.roles.map((role) => [role.name, role]));
  const rawBindings = [
    ...iam.policies.flatMap((policy) => policy.bindings.map((binding) => ({
      binding,
      policySource: "resource_manager_iam_policy",
      resourceName: policy.attachmentPoint,
      hierarchyResourceIdentityDigest:
        resources.hierarchyByName.get(policy.attachmentPoint)
            .resourceIdentityDigest,
      serviceAccountResourceIdentityDigest: null,
    }))),
    ...iam.serviceAccounts.flatMap((account) =>
      account.policy.bindings.map((binding) => ({
        binding,
        policySource: "service_account_iam_policy",
        resourceName: account.name,
        hierarchyResourceIdentityDigest: null,
        serviceAccountResourceIdentityDigest:
          resources.serviceAccountByName.get(account.name)
              .resourceIdentityDigest,
      }))),
  ];
  const bindings = rawBindings.map(({
    binding,
    policySource,
    resourceName,
    hierarchyResourceIdentityDigest,
    serviceAccountResourceIdentityDigest,
  }) => {
    const role = roleMap.get(binding.role);
    const roleExpansionComplete =
      role !== undefined &&
      role.permissionsComplete === true &&
      role.deleted === false &&
      Array.isArray(role.includedPermissions);
    const permissions = roleExpansionComplete ?
      [...new Set(role.includedPermissions)].sort() :
      [];
    const resource = policySource === "resource_manager_iam_policy" ?
      resources.hierarchyByName.get(resourceName) :
      resources.serviceAccountByName.get(resourceName);
    return {
      resourceType: resource.resourceType,
      resourceName,
      canonicalResourceName: resource.canonicalResourceName,
      attachmentPoint: resourceName,
      policySource,
      accessClassification: "allow",
      member: binding.member,
      role: binding.role,
      condition: binding.condition,
      inheritance:
        ["project", "serviceAccount"].includes(resource.resourceType) ?
          "direct" :
          "inherited",
      roleExpansionComplete,
      permissions,
      permissionExpansionDigest: sha256Canonical(permissions),
      hierarchyResourceIdentityDigest,
      serviceAccountResourceIdentityDigest,
    };
  }).sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const approvedMembers = new Set([
    ...KNOWN_IAM_GROUPS,
    ...iam.serviceAccounts.map(({email}) => `serviceAccount:${email}`),
  ]);
  const unknownPrincipals = [...new Set(bindings
      .map(({member}) => member)
      .filter((member) => !approvedMembers.has(member)))].sort();
  const unknownRoles = [...new Set(bindings
      .filter(({roleExpansionComplete}) => !roleExpansionComplete)
      .map(({role}) => role))].sort();
  const reviewedPermissions = new Set([
    ...new Set(REVIEWED_IAM_ROLE_DEFINITIONS
        .flatMap(({permissions}) => permissions)),
  ]);
  const unknownPermissions = [...new Set(bindings
      .flatMap(({permissions}) => permissions)
      .filter((permission) => !reviewedPermissions.has(permission)))].sort();
  const writablePermissions = new Set(REVIEWED_WRITABLE_PERMISSIONS);
  const writableBindings = bindings.filter(({permissions}) =>
    permissions.some((permission) => writablePermissions.has(permission)));
  const unknownScopes =
    bindings.filter(({resourceType}) => resourceType === "unknown");
  const unresolvedConditions =
    bindings.filter(({condition}) => condition !== null);
  const groups = [...new Set(bindings.map(({member}) => member)
      .filter((member) => member.startsWith("group:")))];
  const groupExpansionComplete = groups.every((group) =>
    iam.cloudAssetAnalyses.some((analysis) =>
      analysis.identity === group &&
      analysis.fullyExplored === true &&
      analysis.analysisResults.length > 0 &&
      analysis.groupEdges.length > 0));
  const iamExpansionComplete =
    unknownPrincipals.length === 0 &&
    unknownRoles.length === 0 &&
    unknownPermissions.length === 0 &&
    unknownScopes.length === 0;
  const conditionAnalysisComplete = unresolvedConditions.length === 0;
  const domainExpansionComplete =
    !bindings.some(({member}) => member.startsWith("domain:"));
  const denyPolicyAnalysisComplete = iam.denyPolicies.length === 0;
  return {
    bindings,
    writableBindings,
    unknownPrincipals,
    unknownRoles,
    unknownPermissions,
    unknownScopes,
    unresolvedConditions,
    bindingSetDigest: sha256Canonical(bindings),
    resourceUniverseDigest: resources.resourceUniverseDigest,
    iamExpansionComplete,
    conditionAnalysisComplete,
    domainExpansionComplete,
    groupExpansionComplete,
    denyPolicyAnalysisComplete,
    policyAnalysisComplete:
      iamExpansionComplete &&
      conditionAnalysisComplete &&
      domainExpansionComplete &&
      groupExpansionComplete &&
      denyPolicyAnalysisComplete &&
      writableBindings.length === 0,
  };
}

function deepFreeze(value, seen = new Set()) {
  if (!value ||
      !["object", "function"].includes(typeof value) ||
      seen.has(value)) {
    return value;
  }
  seen.add(value);
  if (typeof value === "function") {
    for (const key of Reflect.ownKeys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (descriptor?.configurable && !descriptor.enumerable) {
        delete value[key];
      }
    }
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function sandbox(t, prefix = "academy-observer-test-") {
  const root = fs.mkdtempSync(
      path.join(fs.realpathSync.native(os.tmpdir()), prefix),
  );
  assert.equal(path.relative(repositoryRoot, root).startsWith(".."), true);
  t.after(() => fs.rmSync(root, {force: true, recursive: true}));
  return root;
}

function outputPaths(root, parentName = "observation") {
  const parent = path.join(root, parentName);
  const base = path.dirname(parent);
  const baseStat = fs.lstatSync(base);
  return deepFreeze({
    base,
    baseDevice: baseStat.dev,
    baseInode: baseStat.ino,
    parent,
    summaryPath: path.join(parent, PRODUCTION_OBSERVER_SUMMARY_FILENAME),
    sensitivePath: path.join(parent, PRODUCTION_OBSERVER_SENSITIVE_FILENAME),
  });
}

function exactArgv(root, overrides = {}) {
  const outputs = outputPaths(root, overrides.parentName ?? "observation");
  const values = {
    "credential-file":
      overrides.credentialFile ?? path.join(root, "credential.json"),
    project: overrides.project ?? PROVIDER_TARGET_PROJECT_ID,
    "project-number":
      overrides.projectNumber ?? PROVIDER_TARGET_PROJECT_NUMBER,
    "release-sha": overrides.releaseSha ?? RELEASE_SHA,
    "sensitive-output":
      overrides.sensitiveOutput ?? outputs.sensitivePath,
    "summary-output": overrides.summaryOutput ?? outputs.summaryPath,
  };
  if (overrides.optionalDiagnostic !== undefined) {
    values["optional-diagnostic"] = overrides.optionalDiagnostic;
  }
  return deepFreeze(Object.entries(values)
      .map(([name, value]) => `--${name}=${value}`));
}

function syntheticSourceIdentity(overrides = {}) {
  const runtimeGit = {
    headSha: RELEASE_SHA,
    treeSha: TREE_SHA,
    clean: true,
    criticalSourceSetDigest: SOURCE_SET_DIGEST,
    reviewedSourceSetDigest: "4".repeat(64),
    reviewedSourceIdentityDigest:
      EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
    ...overrides.runtimeGit,
  };
  const reviewedSources = {
    repositoryRoot,
    aggregateDigest:
      EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
    ...overrides.reviewedSources,
  };
  return deepFreeze({reviewedSources, runtimeGit});
}

function credentialResult(credentialPath, overrides = {}) {
  const payload = {
    type: "service_account",
    project_id: PROVIDER_TARGET_PROJECT_ID,
    private_key: SECRET_KEY,
    client_email: SECRET_EMAIL,
    client_id: SECRET_CLIENT_ID,
    private_key_id: "in-memory-key-id",
    ...overrides.payload,
  };
  const descriptor = {
    absolutePath: credentialPath,
    fileType: "regular",
    intermediateSymlinkFree: true,
    symbolicLink: false,
    mode: 0o600,
    uid: typeof process.getuid === "function" ? process.getuid() : 501,
    size: 1024,
    ...overrides.descriptor,
  };
  return deepFreeze({
    descriptor,
    payload: overrides.payloadValue === undefined ?
      payload :
      overrides.payloadValue,
  });
}

function completeObservation(overrides = {}) {
  const observation = {
    schemaVersion: PRODUCTION_OBSERVER_SCHEMA_VERSION,
    projectId: PROVIDER_TARGET_PROJECT_ID,
    projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
    startedAtEpochMs: STARTED_AT,
    completedAtEpochMs: COMPLETED_AT,
    providerObservationComplete: true,
    policyAnalysisComplete: true,
    paginationComplete: true,
    repeatedPageTokenDetected: false,
    unreachableResourceCount: 0,
    inventoryStable: true,
    functionCount: EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
    guardedFunctionCount: EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length,
    iamExpansionComplete: true,
    groupExpansionComplete: true,
    domainExpansionComplete: true,
    denyPolicyAnalysisComplete: true,
    conditionAnalysisComplete: true,
    schedulerInventoryComplete: true,
    stale: false,
    actualMutations: 0,
    mutationOperationCount: 0,
    mutationPermissionCount: 0,
    executedMandatoryOperationIds: [
      ...STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
          .executedMandatoryOperationIds,
    ],
    notApplicableMandatoryOperationIds: [
      ...STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
          .notApplicableMandatoryOperationIds,
    ],
    blockers: [],
    counts: {
      denyPolicyCount: 0,
      executedMandatoryOperationCount:
        STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
            .executedMandatoryOperationCount,
      functionCount: EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
      guardedFunctionCount: EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length,
      iamBindingCount: 2,
      iamConditionCount: 0,
      iamRoleCount: 2,
      mandatoryOperationCount: PROVIDER_MANDATORY_OPERATION_IDS.length,
      notApplicableMandatoryOperationCount:
        STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
            .notApplicableMandatoryOperationCount,
      operationExecutionCount:
        STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
            .executedMandatoryOperationCount,
      operationUniqueOperationCount:
        STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
            .executedMandatoryOperationCount,
      schedulerJobCount: SCHEDULER_JOB_ALLOWLIST.length,
      serviceAccountCount: 3,
      unknownIamPrincipalCount: 0,
      unknownIamPermissionCount: 0,
      unknownIamRoleCount: 0,
      unknownIamScopeCount: 0,
      writableIamBindingCount: 0,
    },
    ...overrides,
  };
  const groupMember = KNOWN_IAM_GROUPS[0];
  const safeRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
      ({role}) => role.endsWith("/academyBackendReadOnly"),
  ).role;
  const writableRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
      ({role}) => role.endsWith("/academyResetDeleteOnly"),
  ).role;
  const serviceAccounts = Array.from(
      {length: observation.counts.serviceAccountCount},
      (_, index) => {
        const email =
          `observer-${index + 1}@${PROVIDER_TARGET_PROJECT_ID}.iam.gserviceaccount.com`;
        return {
          name:
            `projects/${PROVIDER_TARGET_PROJECT_ID}/serviceAccounts/${email}`,
          email,
          uniqueId: String(index + 1),
          disabled: false,
          policy: {version: 3, etag: `etag-${index + 1}`, bindings: []},
        };
      },
  );
  const rawPolicyBindings = [
    {
      attachmentPoint: `projects/${PROVIDER_TARGET_PROJECT_ID}`,
      role: safeRole,
      member: groupMember,
      condition: null,
    },
    {
      attachmentPoint: `projects/${PROVIDER_TARGET_PROJECT_ID}`,
      role: safeRole,
      member: `serviceAccount:${serviceAccounts[0].email}`,
      condition: null,
    },
  ];
  if (observation.conditionAnalysisComplete === false) {
    rawPolicyBindings[0].condition = {
      title: "unresolved",
      description: "",
      expression: "request.time < timestamp('2099-01-01T00:00:00Z')",
    };
  }
  if (observation.domainExpansionComplete === false) {
    rawPolicyBindings.push({
      attachmentPoint: `projects/${PROVIDER_TARGET_PROJECT_ID}`,
      role: safeRole,
      member: "domain:unknown.example",
      condition: null,
    });
  }
  if (observation.iamExpansionComplete === false) {
    rawPolicyBindings.push({
      attachmentPoint: `projects/${PROVIDER_TARGET_PROJECT_ID}`,
      role: safeRole,
      member:
        `serviceAccount:unknown@${PROVIDER_TARGET_PROJECT_ID}.iam.gserviceaccount.com`,
      condition: null,
    });
  }
  if (observation.counts.writableIamBindingCount > 0) {
    serviceAccounts[0].policy.bindings.push({
      attachmentPoint: serviceAccounts[0].name,
      role: writableRole,
      member: `serviceAccount:${serviceAccounts[0].email}`,
      condition: null,
    });
  }
  const analyses = [{
    identity: groupMember,
    fullyExplored: true,
    analysisResults: observation.groupExpansionComplete ?
      [{accessControlLists: []}] :
      [],
    groupEdges: observation.groupExpansionComplete ?
      [{sourceNode: groupMember, targetNode: "user:member@example.com"}] :
      [],
    resourceEdges: [],
  }];
  const functionRecords = Array.from(
      {length: observation.counts.functionCount},
      (_, index) => ({
        functionId: `function-${index + 1}`,
        name: `function-${index + 1}`,
        source: {bucket: STANDALONE_SOURCE_BUCKET_NAME},
      }),
  );
  const roles = REVIEWED_IAM_ROLE_DEFINITIONS.map((definition) => ({
    name: definition.role,
    includedPermissions: [...definition.permissions].sort(),
    permissionsComplete: definition.permissionsComplete,
    deleted: definition.deleted,
    stage: definition.stage,
  }));
  const denyPolicies = Array.from(
      {length: observation.denyPolicyAnalysisComplete ? 0 : 1},
      (_, index) => ({
        attachmentPoint: `projects/${PROVIDER_TARGET_PROJECT_ID}`,
        name: `deny-policy-${index + 1}`,
      }),
  );
  const rules = {
    release: {
      name: "projects/test/releases/cloud.firestore",
      rulesetName: "projects/test/rulesets/mock",
      createTime: "2026-07-18T00:00:00Z",
      updateTime: "2026-07-18T00:00:00Z",
    },
    ruleset: {
      name: "projects/test/rulesets/mock",
      createTime: "2026-07-18T00:00:00Z",
      metadata: null,
      providerRulesetPayloadDigest: "1".repeat(64),
    },
  };
  const bucketIdentities = [
    fixtureSourceBucketIdentity(functionRecords),
  ];
  const sourceBucketIdentitySetDigest =
    fixtureSourceBucketIdentitySetDigest(bucketIdentities);
  const functions = {
    bucketIdentities,
    functionCount: observation.functionCount,
    guardedFunctionCount: observation.guardedFunctionCount,
    inventoryDigest: sha256Canonical({
      bucketIdentities,
      records: functionRecords,
      sourceBucketIdentitySetDigest,
    }),
    records: functionRecords,
    sourceBucketIdentitySetDigest,
  };
  const iam = {
    policyAnalysisComplete: observation.policyAnalysisComplete,
    iamExpansionComplete: observation.iamExpansionComplete,
    conditionAnalysisComplete: observation.conditionAnalysisComplete,
    domainExpansionComplete: observation.domainExpansionComplete,
    groupExpansionComplete: observation.groupExpansionComplete,
    denyPolicyAnalysisComplete: observation.denyPolicyAnalysisComplete,
    unknownPrincipals: [],
    unknownRoles: [],
    unknownPermissions: [],
    unknownScopes: [],
    unresolvedConditions: [],
    writableBindings: [],
    bindingSetDigest: "",
    resourceUniverseDigest: "",
    hierarchy: [fixtureHierarchyResource()],
    policies: [{
      attachmentPoint: `projects/${PROVIDER_TARGET_PROJECT_ID}`,
      version: 3,
      etag: "project-policy-etag",
      bindings: rawPolicyBindings,
    }],
    bindings: [],
    roles,
    serviceAccounts,
    cloudAssetAnalyses: analyses,
    denyPolicies,
    requiredServices: [],
    runtimeServiceAccounts: [],
  };
  const jobs = Array.from(
      {length: observation.counts.schedulerJobCount},
      (_, index) => ({name: `scheduler-job-${index + 1}`}),
  );
  const scheduler = {
    schedulerInventoryComplete: observation.schedulerInventoryComplete,
    jobCount: jobs.length,
    digest: sha256Canonical(jobs),
    jobs,
  };
  const operationTrace = Array.from(
      {length: observation.counts.operationExecutionCount},
      (_, index) => ({
        operationId:
          STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
              .executedMandatoryOperationIds[
                  index %
                    STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
                        .executedMandatoryOperationIds.length
          ],
      }),
  );
  const operationTraceSummary =
    fixtureOperationTraceSummary(operationTrace);
  const notApplicableEvidence = Object.fromEntries(
      observation.notApplicableMandatoryOperationIds.map((operationId) => [
        operationId,
        "DERIVED_FROM_STANDALONE_PROJECT_TOPOLOGY",
      ]),
  );
  observation.rawObservation = {
    rules,
    functions,
    iam,
    scheduler,
    topologyProfile: STANDALONE_PROJECT_OBSERVER_PROFILE,
    operationTrace,
    operationTraceSummary,
    notApplicableEvidence,
  };
  observation.topologyProfile = STANDALONE_PROJECT_OBSERVER_PROFILE;
  observation.operationTraceSummary = operationTraceSummary;
  observation.digests = {
    functionsDigest: functions.inventoryDigest,
    iamBindingSetDigest: "",
    iamDigest: "",
    operationTraceCountDigest:
      operationTraceSummary.perOperationTraceCountDigest,
    operationTraceDigest: sha256Canonical(operationTrace),
    operationTraceOperationSetDigest:
      operationTraceSummary.operationIdSetDigest,
    rawObservationDigest: "",
    rulesDigest: sha256Canonical(rules),
    schedulerDigest: scheduler.digest,
    topologyProfileDigest: STANDALONE_PROJECT_OBSERVER_PROFILE.profileDigest,
  };
  synchronizeMockIamClaims(observation);
  return deepFreeze(observation);
}

function synchronizeMockIamClaims(observation) {
  const raw = observation.rawObservation;
  const universe = deriveFixtureIamUniverse(raw.iam);
  Object.assign(raw.iam, universe);
  Object.assign(observation, {
    policyAnalysisComplete: universe.policyAnalysisComplete,
    iamExpansionComplete: universe.iamExpansionComplete,
    groupExpansionComplete: universe.groupExpansionComplete,
    domainExpansionComplete: universe.domainExpansionComplete,
    denyPolicyAnalysisComplete: universe.denyPolicyAnalysisComplete,
    conditionAnalysisComplete: universe.conditionAnalysisComplete,
  });
  Object.assign(observation.counts, {
    iamBindingCount: universe.bindings.length,
    iamConditionCount: universe.unresolvedConditions.length,
    iamRoleCount: raw.iam.roles.length,
    serviceAccountCount: raw.iam.serviceAccounts.length,
    denyPolicyCount: raw.iam.denyPolicies.length,
    unknownIamPrincipalCount: universe.unknownPrincipals.length,
    unknownIamRoleCount: universe.unknownRoles.length,
    unknownIamPermissionCount: universe.unknownPermissions.length,
    unknownIamScopeCount: universe.unknownScopes.length,
    writableIamBindingCount: universe.writableBindings.length,
  });
  raw.iam.digest = sha256Canonical({
    resources: raw.iam.hierarchy,
    policies: raw.iam.policies,
    bindings: raw.iam.bindings,
    roles: raw.iam.roles,
    accounts: raw.iam.serviceAccounts,
    analyses: raw.iam.cloudAssetAnalyses,
    denyPolicies: raw.iam.denyPolicies,
    services: raw.iam.requiredServices,
    bindingSetDigest: raw.iam.bindingSetDigest,
    resourceUniverseDigest: raw.iam.resourceUniverseDigest,
  });
  observation.digests.iamBindingSetDigest = raw.iam.bindingSetDigest;
  observation.digests.iamDigest = raw.iam.digest;
  observation.digests.rawObservationDigest = sha256Canonical(raw);
  return observation;
}

function refreshMockObservationDigests(observation) {
  const raw = observation.rawObservation;
  raw.functions.bucketIdentities.sort((left, right) =>
    left.bucketName.localeCompare(right.bucketName));
  raw.functions.sourceBucketIdentitySetDigest =
    fixtureSourceBucketIdentitySetDigest(raw.functions.bucketIdentities);
  raw.functions.inventoryDigest = sha256Canonical({
    bucketIdentities: raw.functions.bucketIdentities,
    records: raw.functions.records,
    sourceBucketIdentitySetDigest:
      raw.functions.sourceBucketIdentitySetDigest,
  });
  raw.operationTraceSummary =
    fixtureOperationTraceSummary(raw.operationTrace);
  observation.operationTraceSummary = raw.operationTraceSummary;
  observation.counts.operationExecutionCount = raw.operationTrace.length;
  observation.counts.operationUniqueOperationCount =
    raw.operationTraceSummary.uniqueOperationCount;
  raw.iam.digest = sha256Canonical({
    resources: raw.iam.hierarchy,
    policies: raw.iam.policies,
    bindings: raw.iam.bindings,
    roles: raw.iam.roles,
    accounts: raw.iam.serviceAccounts,
    analyses: raw.iam.cloudAssetAnalyses,
    denyPolicies: raw.iam.denyPolicies,
    services: raw.iam.requiredServices,
    bindingSetDigest: raw.iam.bindingSetDigest,
    resourceUniverseDigest: raw.iam.resourceUniverseDigest,
  });
  observation.digests.iamBindingSetDigest = raw.iam.bindingSetDigest;
  observation.digests.functionsDigest =
    raw.functions.inventoryDigest;
  observation.digests.iamDigest = raw.iam.digest;
  observation.digests.operationTraceDigest =
    sha256Canonical(raw.operationTrace);
  observation.digests.operationTraceOperationSetDigest =
    raw.operationTraceSummary.operationIdSetDigest;
  observation.digests.operationTraceCountDigest =
    raw.operationTraceSummary.perOperationTraceCountDigest;
  observation.digests.rulesDigest = sha256Canonical(raw.rules);
  observation.digests.schedulerDigest = raw.scheduler.digest;
  observation.digests.topologyProfileDigest =
    raw.topologyProfile.profileDigest;
  observation.digests.rawObservationDigest = sha256Canonical(raw);
  return deepFreeze(observation);
}

function nestedServiceAccountBinding({
  observation,
  role,
  member,
  condition = null,
  accountIndex = 0,
}) {
  const account =
    observation.rawObservation.iam.serviceAccounts[accountIndex];
  account.policy.bindings.push({
    attachmentPoint: account.name,
    role,
    member,
    condition,
  });
  return account;
}

function synchronizedNestedBindingObservation(options = {}) {
  const observation = clone(completeObservation());
  const safeRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
      ({role}) => role.endsWith("/academyBackendReadOnly"),
  ).role;
  const account = observation.rawObservation.iam.serviceAccounts[0];
  nestedServiceAccountBinding({
    observation,
    role: options.role ?? safeRole,
    member: options.member ?? `serviceAccount:${account.email}`,
    condition: options.condition ?? null,
  });
  synchronizeMockIamClaims(observation);
  return deepFreeze(observation);
}

function optionalResult(status = "absent") {
  return deepFreeze(
      status === "absent" ?
        {status} :
        {
          operationId: PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC,
          resultDigest: "b".repeat(64),
          status,
        },
  );
}

function publicationResult() {
  return deepFreeze({published: false, reason: "mock_noop_publisher"});
}

function exactRequest(root, overrides = {}) {
  return deepFreeze({
    argv: overrides.argv ?? exactArgv(root, overrides.argvOverrides),
    environment: overrides.environment ?? deepFreeze({
      CONFIRM_PRODUCTION_READ_ONLY_OBSERVATION: "YES",
    }),
    repositoryRoot: overrides.repositoryRoot ?? repositoryRoot,
  });
}

function exactDependencies(root, state, overrides = {}) {
  const argv = overrides.argv ?? exactArgv(root);
  const credentialArgument = argv.find((argument) =>
    typeof argument === "string" && argument.startsWith("--credential-file="));
  const credentialPath = credentialArgument ?
    credentialArgument.slice("--credential-file=".length) :
    path.join(root, "credential.json");
  return deepFreeze({
    artifactPublisher: overrides.artifactPublisher ?? (async (input) => {
      state.order.push("publish");
      state.counts.publish += 1;
      assert.equal(Object.isFrozen(input), true);
      return publicationResult();
    }),
    credentialReader: overrides.credentialReader ?? (async (input) => {
      state.order.push("credential");
      state.counts.credential += 1;
      assert.deepEqual(input, {
        credentialFile: credentialPath,
        projectId: PROVIDER_TARGET_PROJECT_ID,
      });
      assert.equal(Object.isFrozen(input), true);
      return credentialResult(credentialPath);
    }),
    gitIdentityResolver: overrides.gitIdentityResolver ?? (async (input) => {
      state.order.push("git");
      state.counts.git += 1;
      assert.deepEqual(input, {
        releaseSha: RELEASE_SHA,
        repositoryRoot,
      });
      assert.equal(Object.isFrozen(input), true);
      return syntheticSourceIdentity();
    }),
    mockOnly: true,
    now: overrides.now ?? (() => {
      state.order.push("now");
      state.counts.now += 1;
      return OBSERVED_AT;
    }),
    optionalDiagnosticRunner:
      overrides.optionalDiagnosticRunner ?? (async () => {
        state.order.push("optional");
        state.counts.optional += 1;
        return optionalResult("success");
      }),
    providerObservationRunner:
      overrides.providerObservationRunner ?? (async (input) => {
        state.order.push("provider");
        state.counts.provider += 1;
        assert.equal(input.mockOnly, true);
        assert.equal(Object.isFrozen(input), true);
        return completeObservation();
      }),
  });
}

function harnessState() {
  return {
    order: [],
    counts: {
      credential: 0,
      git: 0,
      now: 0,
      optional: 0,
      provider: 0,
      publish: 0,
    },
  };
}

async function runHarness(t, {
  requestOverrides = {},
  dependencyOverrides = {},
  state = harnessState(),
} = {}) {
  const root = requestOverrides.root ?? sandbox(t);
  const request = exactRequest(root, requestOverrides);
  const dependencies = exactDependencies(root, state, {
    argv: request.argv,
    ...dependencyOverrides,
  });
  const result =
    await executeInjectedMockProductionObserverHarness(request, dependencies);
  return {dependencies, request, result, root, state};
}

function assertNoCredentialMaterial(
    value,
    credentialPath,
    {allowPinnedIdentity = false} = {},
) {
  const serialized = typeof value === "string" ? value : JSON.stringify(value);
  for (const forbidden of [
    SECRET_KEY,
    ...(allowPinnedIdentity ? [] : [SECRET_EMAIL]),
    SECRET_CLIENT_ID,
    "in-memory-key-id",
    credentialPath,
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
}

async function assertHarnessRejectsBeforeCredential(
    t,
    requestOverrides,
    dependencyOverrides = {},
) {
  const root = requestOverrides.root ?? sandbox(t);
  const state = harnessState();
  const request = exactRequest(root, requestOverrides);
  const dependencies = exactDependencies(root, state, {
    argv: request.argv,
    ...dependencyOverrides,
  });
  await assert.rejects(
      executeInjectedMockProductionObserverHarness(request, dependencies),
      /PRODUCTION_OBSERVER_/,
  );
  assert.equal(state.counts.credential, 0);
  assert.equal(state.counts.provider, 0);
  assert.equal(state.counts.publish, 0);
  return {root, state};
}

test("exact CLI arguments parse to the frozen canonical request", (t) => {
  const root = sandbox(t);
  const argv = exactArgv(root, {
    optionalDiagnostic: PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC,
  });
  const parsed = parseProductionObserverArguments(argv);
  assert.deepEqual(parsed, {
    projectId: PROVIDER_TARGET_PROJECT_ID,
    projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
    releaseSha: RELEASE_SHA,
    credentialFile: path.join(root, "credential.json"),
    summaryOutput:
      path.join(root, "observation", PRODUCTION_OBSERVER_SUMMARY_FILENAME),
    sensitiveOutput:
      path.join(root, "observation", PRODUCTION_OBSERVER_SENSITIVE_FILENAME),
    optionalDiagnostic: PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC,
  });
  assert.equal(Object.isFrozen(parsed), true);
});

test("wrong targets, release, unknown, duplicate, and missing CLI args fail first",
    async (t) => {
      const root = sandbox(t);
      const valid = [...exactArgv(root)];
      const cases = [
        exactArgv(root, {project: "foreign-project"}),
        exactArgv(root, {projectNumber: "999999999999"}),
        exactArgv(root, {releaseSha: "not-a-release"}),
        deepFreeze([...valid, "--unknown=value"]),
        deepFreeze([...valid, valid[0]]),
        deepFreeze(valid.slice(1)),
        deepFreeze(valid.map((arg) =>
          arg.startsWith("--project=") ? "--project=" : arg)),
      ];
      for (const argv of cases) {
        await assertHarnessRejectsBeforeCredential(t, {argv, root});
      }
    });

test("only exact production confirmation YES passes preflight", async (t) => {
  const root = sandbox(t);
  for (const value of [undefined, "yes", "true", "1", "YES ", " YES"]) {
    await assertHarnessRejectsBeforeCredential(t, {
      root,
      environment: deepFreeze(value === undefined ? {} : {
        CONFIRM_PRODUCTION_READ_ONLY_OBSERVATION: value,
      }),
    });
  }
});

test("wrong HEAD, dirty, source-pin mismatch, and untracked simulations fail",
    async (t) => {
      const variants = [
        syntheticSourceIdentity({runtimeGit: {headSha: "f".repeat(40)}}),
        syntheticSourceIdentity({runtimeGit: {clean: false}}),
        syntheticSourceIdentity({
          reviewedSources: {aggregateDigest: "e".repeat(64)},
        }),
        syntheticSourceIdentity({
          runtimeGit: {reviewedSourceIdentityDigest: "d".repeat(64)},
        }),
        syntheticSourceIdentity({
          runtimeGit: {clean: false, untrackedPaths: ["synthetic-untracked"]},
        }),
      ];
      for (const sourceIdentity of variants) {
        const root = sandbox(t);
        await assertHarnessRejectsBeforeCredential(t, {root}, {
          gitIdentityResolver: deepFreeze(async () => sourceIdentity),
        });
      }
    });

test("output parent, symlink, overwrite, filename, and parent split fail early",
    async (t) => {
      {
        const root = sandbox(t);
        fs.mkdirSync(path.join(root, "observation"), {mode: 0o700});
        await assertHarnessRejectsBeforeCredential(t, {root});
      }
      {
        const root = sandbox(t);
        fs.mkdirSync(path.join(root, "observation"), {mode: 0o777});
        fs.chmodSync(path.join(root, "observation"), 0o777);
        await assertHarnessRejectsBeforeCredential(t, {root});
      }
      {
        const root = sandbox(t);
        const target = path.join(root, "symlink-target");
        fs.mkdirSync(target);
        fs.symlinkSync(target, path.join(root, "link"));
        await assertHarnessRejectsBeforeCredential(t, {
          root,
          argv: exactArgv(root, {parentName: "link/new-output"}),
        });
      }
      {
        const root = sandbox(t);
        const outputs = outputPaths(root);
        fs.mkdirSync(outputs.parent);
        fs.writeFileSync(outputs.summaryPath, "existing");
        await assertHarnessRejectsBeforeCredential(t, {root});
      }
      {
        const root = sandbox(t);
        await assertHarnessRejectsBeforeCredential(t, {
          root,
          argv: exactArgv(root, {
            summaryOutput: path.join(root, "observation", "wrong.json"),
          }),
        });
      }
      {
        const root = sandbox(t);
        await assertHarnessRejectsBeforeCredential(t, {
          root,
          argv: exactArgv(root, {
            sensitiveOutput: path.join(
                root,
                "different-parent",
                PRODUCTION_OBSERVER_SENSITIVE_FILENAME,
            ),
          }),
        });
      }
    });

test("credential read happens after every gate and before provider observation",
    async (t) => {
      const {result, state} = await runHarness(t);
      assert.deepEqual(state.order, [
        "git", "credential", "provider", "now", "publish",
      ]);
      assert.deepEqual(state.counts, {
        credential: 1,
        git: 1,
        now: 1,
        optional: 0,
        provider: 1,
        publish: 1,
      });
      assert.equal(result.artifacts.summary.providerObservationComplete, true);
      assert.equal(Object.isFrozen(result), true);
    });

test("missing and failed credential reads never call the provider", async (t) => {
  for (const error of [
    new Error("synthetic missing file"),
    new Error("synthetic read failure"),
  ]) {
    const root = sandbox(t);
    const state = harnessState();
    const request = exactRequest(root);
    const dependencies = exactDependencies(root, state, {
      argv: request.argv,
      credentialReader: deepFreeze(async () => {
        state.order.push("credential");
        state.counts.credential += 1;
        throw error;
      }),
    });
    await assert.rejects(
        executeInjectedMockProductionObserverHarness(request, dependencies),
        /PRODUCTION_OBSERVER_INJECTED_CREDENTIAL_READ_FAILED/,
    );
    assert.equal(state.counts.credential, 1);
    assert.equal(state.counts.provider, 0);
    assert.equal(state.counts.publish, 0);
  }
});

test("credential descriptor and payload failures are closed and redacted",
    async (t) => {
      const cases = [
        {descriptor: {symbolicLink: true}},
        {descriptor: {intermediateSymlinkFree: false}},
        {descriptor: {mode: 0o644}},
        {descriptor: {fileType: "directory"}},
        {payloadValue: null},
        {payloadValue: []},
        {payloadValue: {
          type: "service_account",
          project_id: PROVIDER_TARGET_PROJECT_ID,
          private_key: SECRET_KEY,
        }},
        {payload: {private_key: ""}},
        {payload: {client_email: 42}},
        {payload: {client_email: null}},
        {payload: {client_email: ""}},
        {payload: {
          client_email:
            "other-observer@daegu-miami-production.iam.gserviceaccount.com",
        }},
        {payload: {
          client_email:
            "academy-reset-freeze-observer@other-project.iam.gserviceaccount.com",
        }},
        {payload: {client_email: SECRET_EMAIL.toUpperCase()}},
        {payload: {client_email: ` ${SECRET_EMAIL}`}},
        {payload: {client_email: `${SECRET_EMAIL} `}},
        {payload: {
          client_email:
            "firebase-adminsdk-ab123@" +
            "daegu-miami-production.iam.gserviceaccount.com",
        }},
        {payload: {
          client_email:
            "academy-reset-executor@" +
            "daegu-miami-production.iam.gserviceaccount.com",
        }},
        {payload: {project_id: "foreign-project"}},
        {payload: {renamedSigningSeed: "renamed-private-material"}},
      ];
      for (const invalid of cases) {
        const root = sandbox(t);
        const state = harnessState();
        const request = exactRequest(root);
        const credentialPath =
          parseProductionObserverArguments(request.argv).credentialFile;
        const dependencies = exactDependencies(root, state, {
          argv: request.argv,
          credentialReader: deepFreeze(async () => {
            state.order.push("credential");
            state.counts.credential += 1;
            return credentialResult(credentialPath, invalid);
          }),
        });
        let thrown;
        try {
          await executeInjectedMockProductionObserverHarness(
              request,
              dependencies,
          );
          assert.fail("expected credential rejection");
        } catch (error) {
          thrown = error;
        }
        assert.match(
            String(thrown),
            /PRODUCTION_OBSERVER_|CREDENTIAL_|MUST_BE_EXACT_RECORD/,
        );
        assertNoCredentialMaterial(
            `${String(thrown)}\n${thrown.stack ?? ""}`,
            credentialPath,
        );
        assert.equal(state.counts.provider, 0);
        assert.equal(state.counts.publish, 0);
      }
    });

test("standalone observation partitions exact 25 executed and 4 N/A operations",
    async (t) => {
      assert.equal(PROVIDER_MANDATORY_OPERATION_IDS.length, 29);
      assert.equal(EXPECTED_DEPLOYED_FUNCTION_NAMES.length, 35);
      assert.equal(EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length, 26);
      const {result} = await runHarness(t);
      assert.deepEqual(
          result.artifacts.sensitive.executedMandatoryOperationIds,
          STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
              .executedMandatoryOperationIds,
      );
      assert.deepEqual(
          result.artifacts.sensitive.notApplicableMandatoryOperationIds,
          STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
              .notApplicableMandatoryOperationIds,
      );
      assert.equal(result.artifacts.summary.blockerCount, 0);
      assert.equal(result.artifacts.summary.policyAnalysisComplete, true);
    });

test("source bucket owner is derived from canonical provider metadata",
    async (t) => {
      const accepted = await runHarness(t);
      assert.equal(
          accepted.result.artifacts.summary.sourceBucketIdentities[0]
              .projectNumber,
          PROVIDER_TARGET_PROJECT_NUMBER,
      );
      for (const projectNumber of [
        "999999999999",
        null,
        884850632328,
      ]) {
        const observation = clone(completeObservation());
        observation.rawObservation.functions.bucketIdentities[0] =
          fixtureSourceBucketIdentity(
              observation.rawObservation.functions.records,
              {projectNumber},
          );
        refreshMockObservationDigests(observation);
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /PRODUCTION_OBSERVER_(?:SOURCE_BUCKET|STANDALONE_TOPOLOGY)/);
      }
      const missing = clone(completeObservation());
      delete missing.rawObservation.functions.bucketIdentities[0].projectNumber;
      refreshMockObservationDigests(missing);
      await assert.rejects(runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner: deepFreeze(async () => missing),
        },
      }), /PRODUCTION_OBSERVER_SOURCE_BUCKET/);
    });

test("bucket identity name, membership, swap, order, and coherent claims bind",
    async (t) => {
      const nameMismatch = clone(completeObservation());
      nameMismatch.rawObservation.functions.bucketIdentities[0] =
        fixtureSourceBucketIdentity(
            nameMismatch.rawObservation.functions.records,
            {bucketName: "foreign-source-bucket"},
        );
      refreshMockObservationDigests(nameMismatch);

      const externalMember = clone(completeObservation());
      externalMember.rawObservation.functions.records[0].source.bucket =
        "foreign-source-bucket";
      externalMember.rawObservation.functions.bucketIdentities = [
        fixtureSourceBucketIdentity(
            externalMember.rawObservation.functions.records,
        ),
        fixtureSourceBucketIdentity(
            externalMember.rawObservation.functions.records,
            {
              bucketName: "foreign-source-bucket",
              projectNumber: "999999999999",
            },
        ),
      ];
      refreshMockObservationDigests(externalMember);

      const swapped = clone(completeObservation());
      const originalDigest =
        swapped.rawObservation.functions.sourceBucketIdentitySetDigest;
      swapped.rawObservation.functions.records.forEach((record) => {
        record.source.bucket = "same-count-swapped-bucket";
      });
      swapped.rawObservation.functions.bucketIdentities = [
        fixtureSourceBucketIdentity(
            swapped.rawObservation.functions.records,
            {bucketName: "same-count-swapped-bucket"},
        ),
      ];
      refreshMockObservationDigests(swapped);
      assert.notEqual(
          swapped.rawObservation.functions.sourceBucketIdentitySetDigest,
          originalDigest,
      );

      for (const observation of [nameMismatch, externalMember, swapped]) {
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /PRODUCTION_OBSERVER_(?:SOURCE_BUCKET|STANDALONE_TOPOLOGY)/);
      }

      const twoBucketRecords = [
        {functionId: "a", source: {bucket: "bucket-a"}},
        {functionId: "b", source: {bucket: "bucket-b"}},
      ];
      const identities = [
        fixtureSourceBucketIdentity(
            twoBucketRecords,
            {bucketName: "bucket-a"},
        ),
        fixtureSourceBucketIdentity(
            twoBucketRecords,
            {bucketName: "bucket-b"},
        ),
      ];
      assert.equal(
          fixtureSourceBucketIdentitySetDigest(identities),
          fixtureSourceBucketIdentitySetDigest([...identities].reverse()),
      );
      const identitySwap = structuredClone(identities);
      identitySwap[1] = fixtureSourceBucketIdentity(
          twoBucketRecords,
          {bucketName: "bucket-b", storageClass: "NEARLINE"},
      );
      assert.notEqual(
          fixtureSourceBucketIdentitySetDigest(identities),
          fixtureSourceBucketIdentitySetDigest(identitySwap),
      );
    });

test("raw operation trace derives exact unique mandatory coverage",
    async (t) => {
      const baseline = completeObservation();
      assert.equal(
          baseline.operationTraceSummary.executedMandatoryOperationCount,
          25,
      );
      assert.equal(baseline.operationTraceSummary.uniqueOperationCount, 25);

      const repeated = clone(baseline);
      const first = clone(repeated.rawObservation.operationTrace[0]);
      repeated.rawObservation.operationTrace =
        Array.from({length: 25}, () => clone(first));
      refreshMockObservationDigests(repeated);

      const missing = clone(baseline);
      missing.rawObservation.operationTrace.pop();
      refreshMockObservationDigests(missing);

      const swapped = clone(baseline);
      swapped.rawObservation.operationTrace.at(-1).operationId =
        STANDALONE_PROJECT_OBSERVER_PROFILE.operationExecution
            .notApplicableMandatoryOperationIds[0];
      refreshMockObservationDigests(swapped);

      const optionalReplacement = clone(baseline);
      optionalReplacement.rawObservation.operationTrace.at(-1).operationId =
        PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC;
      refreshMockObservationDigests(optionalReplacement);

      const unknown = clone(baseline);
      unknown.rawObservation.operationTrace.at(-1).operationId =
        "unknown.v1.resources.get";
      refreshMockObservationDigests(unknown);

      const coherent = clone(repeated);
      coherent.executedMandatoryOperationIds =
        [...coherent.operationTraceSummary.executedMandatoryOperationIds];
      coherent.counts.executedMandatoryOperationCount =
        coherent.executedMandatoryOperationIds.length;

      for (const observation of [
        repeated,
        missing,
        swapped,
        optionalReplacement,
        unknown,
        deepFreeze(coherent),
      ]) {
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /PRODUCTION_OBSERVER_/);
      }

      const reordered = clone(baseline);
      const setDigest = reordered.operationTraceSummary.operationIdSetDigest;
      reordered.rawObservation.operationTrace.reverse();
      refreshMockObservationDigests(reordered);
      assert.equal(
          reordered.operationTraceSummary.operationIdSetDigest,
          setDigest,
      );
      const reorderedResult = await runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner:
            deepFreeze(async () => reordered),
        },
      });
      assert.equal(reorderedResult.result.artifacts.summary.blockerCount, 0);

      const boundedDuplicate = clone(baseline);
      boundedDuplicate.rawObservation.operationTrace.push(
          clone(boundedDuplicate.rawObservation.operationTrace[0]),
      );
      refreshMockObservationDigests(boundedDuplicate);
      const duplicateResult = await runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner:
            deepFreeze(async () => boundedDuplicate),
        },
      });
      assert.equal(
          duplicateResult.result.artifacts.summary.operationTraceSummary
              .executedMandatoryOperationCount,
          25,
      );
    });

test("missing, extra, and overlapping mandatory operation coverage reject",
    async (t) => {
      const missing = completeObservation({
        executedMandatoryOperationIds:
          PROVIDER_MANDATORY_OPERATION_IDS.slice(1),
      });
      const extra = completeObservation({
        executedMandatoryOperationIds: [
          ...PROVIDER_MANDATORY_OPERATION_IDS,
          "unapproved.v1.resources.get",
        ],
      });
      const overlap = completeObservation({
        notApplicableMandatoryOperationIds:
          [PROVIDER_MANDATORY_OPERATION_IDS[0]],
      });
      for (const observation of [missing, extra, overlap]) {
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /PRODUCTION_OBSERVER_/);
      }
    });

test("mock observation count keysets cannot encode sensitive identities",
    async (t) => {
      const valid = completeObservation();
      const observation = completeObservation({
        counts: {
          ...clone(valid.counts),
          "group:encoded-principal@example.com": 1,
        },
      });
      await assert.rejects(runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner: deepFreeze(async () => observation),
        },
      }), /PRODUCTION_OBSERVER_MOCK_PROVIDER_OBSERVATION_REJECTED/);
    });

test("family digests and IAM counts are bound to raw mock evidence",
    async (t) => {
      const digestTamper = clone(completeObservation());
      digestTamper.digests.functionsDigest = "f".repeat(64);
      const countTamper = clone(completeObservation());
      countTamper.counts.iamBindingCount -= 1;
      for (const observation of [
        deepFreeze(digestTamper),
        deepFreeze(countTamper),
      ]) {
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /PRODUCTION_OBSERVER_MOCK_RAW_OBSERVATION_BINDING_REJECTED/);
      }
    });

test("empty group analysis results or edges cannot claim complete expansion",
    async (t) => {
      for (const field of ["analysisResults", "groupEdges"]) {
        const observation = clone(completeObservation());
        observation.rawObservation.iam.cloudAssetAnalyses[0][field] = [];
        refreshMockObservationDigests(observation);
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /PRODUCTION_OBSERVER_MOCK_RAW_OBSERVATION_BINDING_REJECTED/);
      }
    });

test("nested family keys and duplicated raw booleans and counts are exact",
    async (t) => {
      const extraFamilyKey = clone(completeObservation());
      extraFamilyKey.rawObservation.functions.unreviewed = true;
      refreshMockObservationDigests(extraFamilyKey);
      const schedulerCountTamper = clone(completeObservation());
      schedulerCountTamper.rawObservation.scheduler.jobCount -= 1;
      refreshMockObservationDigests(schedulerCountTamper);
      const groupBooleanTamper = clone(completeObservation());
      groupBooleanTamper.rawObservation.iam.groupExpansionComplete = false;
      refreshMockObservationDigests(groupBooleanTamper);
      for (const observation of [
        extraFamilyKey,
        schedulerCountTamper,
        groupBooleanTamper,
      ]) {
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /(?:PRODUCTION_OBSERVER_)?(?:MOCK_RAW_|MOCK_PROVIDER_)/);
      }
    });

test("partial pagination, repeated tokens, unreachable, and instability block",
    async (t) => {
      const cases = [
        ["paginationComplete", false, "PAGINATION_INCOMPLETE"],
        [
          "repeatedPageTokenDetected",
          true,
          "PAGINATION_TOKEN_REPEATED",
        ],
        ["unreachableResourceCount", 1, "PROVIDER_UNREACHABLE"],
        ["inventoryStable", false, "INVENTORY_UNSTABLE"],
      ];
      for (const [key, value, blocker] of cases) {
        const observation = completeObservation({
          providerObservationComplete: false,
          [key]: value,
        });
        const {result} = await runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        });
        assert.equal(
            result.artifacts.sensitive.blockers.includes(blocker),
            true,
        );
        assert.equal(
            result.artifacts.summary.providerObservationComplete,
            false,
        );
      }
    });

test("function 35 and guarded 26 count mismatches reject complete claims",
    async (t) => {
      for (const observation of [
        completeObservation({functionCount: 34}),
        completeObservation({guardedFunctionCount: 25}),
      ]) {
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        }), /PRODUCTION_OBSERVER_MOCK_PROVIDER_OBSERVATION_REJECTED/);
      }
    });

test("IAM expansion, group/domain, deny, and condition uncertainty fail closed",
    async (t) => {
      const cases = [
        ["iamExpansionComplete", false, "IAM_EXPANSION_INCOMPLETE"],
        [
          "groupExpansionComplete",
          false,
          "IAM_GROUP_EXPANSION_INCOMPLETE",
        ],
        [
          "domainExpansionComplete",
          false,
          "IAM_DOMAIN_EXPANSION_INCOMPLETE",
        ],
        [
          "denyPolicyAnalysisComplete",
          false,
          "DENY_POLICY_ANALYSIS_INCOMPLETE",
        ],
        [
          "conditionAnalysisComplete",
          false,
          "CONDITION_ANALYSIS_INCOMPLETE",
        ],
      ];
      for (const [key, value, blocker] of cases) {
        const observation = completeObservation({
          policyAnalysisComplete: false,
          [key]: value,
        });
        const {result} = await runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        });
        assert.equal(
            result.artifacts.sensitive.blockers.includes(blocker),
            true,
        );
        assert.equal(result.artifacts.summary.policyAnalysisComplete, false);
      }
    });

test("known reviewed writable IAM bindings remain blockers", async (t) => {
  const valid = completeObservation();
  const observation = completeObservation({
    policyAnalysisComplete: false,
    counts: {
      ...clone(valid.counts),
      writableIamBindingCount: 1,
    },
  });
  const {result} = await runHarness(t, {
    dependencyOverrides: {
      providerObservationRunner: deepFreeze(async () => observation),
    },
  });
  assert.equal(
      result.artifacts.sensitive.blockers.includes(
          "IAM_WRITABLE_PERMISSION_FOUND",
      ),
      true,
  );
  assert.equal(result.artifacts.summary.policyAnalysisComplete, false);
});

test("nested service-account IAM A writable binding is blocked", async (t) => {
  const writableRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
      ({role}) => role.endsWith("/academyResetDeleteOnly"),
  ).role;
  const observation = synchronizedNestedBindingObservation({
    role: writableRole,
  });
  const {result} = await runHarness(t, {
    dependencyOverrides: {
      providerObservationRunner: deepFreeze(async () => observation),
    },
  });
  assert.equal(result.artifacts.summary.policyAnalysisComplete, false);
  assert.equal(
      result.artifacts.sensitive.blockers.includes(
          "IAM_WRITABLE_PERMISSION_FOUND",
      ),
      true,
  );
  assert.equal(result.artifacts.summary.counts.writableIamBindingCount, 1);
});

test("nested service-account IAM B unknown role fails closed", async (t) => {
  const observation = synchronizedNestedBindingObservation({
    role: `projects/${PROVIDER_TARGET_PROJECT_ID}/roles/unknownRole`,
  });
  const {result} = await runHarness(t, {
    dependencyOverrides: {
      providerObservationRunner: deepFreeze(async () => observation),
    },
  });
  assert.equal(result.artifacts.summary.policyAnalysisComplete, false);
  assert.equal(
      result.artifacts.sensitive.blockers.includes("IAM_EXPANSION_INCOMPLETE"),
      true,
  );
  assert.equal(result.artifacts.summary.counts.unknownIamRoleCount, 1);
});

test("nested service-account IAM C unknown principal fails closed", async (t) => {
  const observation = synchronizedNestedBindingObservation({
    member:
      `serviceAccount:unknown@${PROVIDER_TARGET_PROJECT_ID}.iam.gserviceaccount.com`,
  });
  const {result} = await runHarness(t, {
    dependencyOverrides: {
      providerObservationRunner: deepFreeze(async () => observation),
    },
  });
  assert.equal(result.artifacts.summary.policyAnalysisComplete, false);
  assert.equal(result.artifacts.summary.counts.unknownIamPrincipalCount, 1);
  assert.equal(
      result.artifacts.sensitive.blockers.includes("IAM_EXPANSION_INCOMPLETE"),
      true,
  );
});

test("nested service-account IAM D unresolved condition fails closed",
    async (t) => {
      const observation = synchronizedNestedBindingObservation({
        condition: {
          title: "unresolved",
          description: "",
          expression: "request.time < timestamp('2099-01-01T00:00:00Z')",
        },
      });
      const {result} = await runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner: deepFreeze(async () => observation),
        },
      });
      assert.equal(result.artifacts.summary.policyAnalysisComplete, false);
      assert.equal(result.artifacts.summary.counts.iamConditionCount, 1);
      assert.equal(
          result.artifacts.sensitive.blockers.includes(
              "CONDITION_ANALYSIS_INCOMPLETE",
          ),
          true,
      );
    });

test("nested service-account IAM E safe read-only binding is canonical",
    async (t) => {
      const observation = synchronizedNestedBindingObservation();
      const {result} = await runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner: deepFreeze(async () => observation),
        },
      });
      assert.equal(result.artifacts.summary.policyAnalysisComplete, true);
      assert.equal(result.artifacts.summary.blockerCount, 0);
      assert.equal(observation.rawObservation.iam.bindings.length, 3);
      assert.equal(
          observation.rawObservation.iam.bindings.some((binding) =>
            binding.policySource === "service_account_iam_policy" &&
            binding.resourceType === "serviceAccount" &&
            binding.inheritance === "direct"),
          true,
      );
    });

test("nested service-account IAM F empty claimed writable set is rejected",
    async (t) => {
      const observation = clone(completeObservation());
      const writableRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
          ({role}) => role.endsWith("/academyResetDeleteOnly"),
      ).role;
      const account = observation.rawObservation.iam.serviceAccounts[0];
      nestedServiceAccountBinding({
        observation,
        role: writableRole,
        member: `serviceAccount:${account.email}`,
      });
      refreshMockObservationDigests(observation);
      await assert.rejects(runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner:
            deepFreeze(async () => observation),
        },
      }), /(?:IAM_|MOCK_RAW_)/);
    });

test("nested service-account IAM G forged top-level count is rejected",
    async (t) => {
      const observation = clone(synchronizedNestedBindingObservation());
      observation.counts.iamBindingCount += 1;
      refreshMockObservationDigests(observation);
      await assert.rejects(runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner:
            deepFreeze(async () => observation),
        },
      }), /MOCK_RAW_OBSERVATION_BINDING_REJECTED/);
    });

test("nested service-account IAM H reorder keeps binding-set digest", () => {
  const first = clone(completeObservation());
  const safeRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
      ({role}) => role.endsWith("/academyBackendReadOnly"),
  ).role;
  const account = first.rawObservation.iam.serviceAccounts[0];
  nestedServiceAccountBinding({
    observation: first,
    role: safeRole,
    member: `serviceAccount:${account.email}`,
  });
  nestedServiceAccountBinding({
    observation: first,
    role: safeRole,
    member:
      `serviceAccount:${first.rawObservation.iam.serviceAccounts[1].email}`,
  });
  synchronizeMockIamClaims(first);
  const second = clone(first);
  second.rawObservation.iam.serviceAccounts[0].policy.bindings.reverse();
  synchronizeMockIamClaims(second);
  assert.equal(
      first.rawObservation.iam.bindingSetDigest,
      second.rawObservation.iam.bindingSetDigest,
  );
});

test("nested service-account IAM I same-count swap changes digest and rejects",
    async (t) => {
      const safe = synchronizedNestedBindingObservation();
      const forged = clone(safe);
      const writableRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
          ({role}) => role.endsWith("/academyResetDeleteOnly"),
      ).role;
      forged.rawObservation.iam.serviceAccounts[0].policy.bindings[0].role =
        writableRole;
      refreshMockObservationDigests(forged);
      await assert.rejects(runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner: deepFreeze(async () => forged),
        },
      }), /(?:IAM_|MOCK_RAW_)/);
      const corrected = clone(forged);
      synchronizeMockIamClaims(corrected);
      assert.notEqual(
          safe.rawObservation.iam.bindingSetDigest,
          corrected.rawObservation.iam.bindingSetDigest,
      );
    });

test("nested service-account IAM J duplicate binding fails closed",
    async (t) => {
      const observation = clone(synchronizedNestedBindingObservation());
      const bindings =
        observation.rawObservation.iam.serviceAccounts[0].policy.bindings;
      bindings.push(clone(bindings[0]));
      refreshMockObservationDigests(observation);
      await assert.rejects(runHarness(t, {
        dependencyOverrides: {
          providerObservationRunner:
            deepFreeze(async () => observation),
        },
      }), /IAM_DUPLICATE_BINDING_REJECTED/);
    });

test("unobserved hierarchy policy attachments fail closed", async (t) => {
  for (const attachmentPoint of [
    "folders/999999999999",
    "organizations/999999999999",
    `projects/${PROVIDER_TARGET_PROJECT_ID}-similar`,
    "folders/not-a-number",
  ]) {
    const observation = clone(completeObservation());
    const policy = observation.rawObservation.iam.policies[0];
    policy.attachmentPoint = attachmentPoint;
    for (const binding of policy.bindings) {
      binding.attachmentPoint = attachmentPoint;
    }
    refreshMockObservationDigests(observation);
    await assert.rejects(runHarness(t, {
      dependencyOverrides: {
        providerObservationRunner: deepFreeze(async () => observation),
      },
    }), /IAM_POLICY_RESOURCE_IDENTITY_REJECTED/);
  }
});

test("service-account name email and policy attachment are exact", async (t) => {
  const safeRole = REVIEWED_IAM_ROLE_DEFINITIONS.find(
      ({role}) => role.endsWith("/academyBackendReadOnly"),
  ).role;
  const mismatchedName = clone(completeObservation());
  const namedAccount = mismatchedName.rawObservation.iam.serviceAccounts[0];
  nestedServiceAccountBinding({
    observation: mismatchedName,
    role: safeRole,
    member: `serviceAccount:${namedAccount.email}`,
  });
  namedAccount.name =
    `projects/${PROVIDER_TARGET_PROJECT_ID}/serviceAccounts/` +
    `different@${PROVIDER_TARGET_PROJECT_ID}.iam.gserviceaccount.com`;
  refreshMockObservationDigests(mismatchedName);
  await assert.rejects(runHarness(t, {
    dependencyOverrides: {
      providerObservationRunner: deepFreeze(async () => mismatchedName),
    },
  }), /SERVICE_ACCOUNT_RESOURCE_IDENTITY_REJECTED/);

  const mismatchedAttachment = clone(completeObservation());
  const attachedAccount =
    mismatchedAttachment.rawObservation.iam.serviceAccounts[0];
  nestedServiceAccountBinding({
    observation: mismatchedAttachment,
    role: safeRole,
    member: `serviceAccount:${attachedAccount.email}`,
  });
  attachedAccount.policy.bindings[0].attachmentPoint =
    mismatchedAttachment.rawObservation.iam.serviceAccounts[1].name;
  refreshMockObservationDigests(mismatchedAttachment);
  await assert.rejects(runHarness(t, {
    dependencyOverrides: {
      providerObservationRunner: deepFreeze(async () => mismatchedAttachment),
    },
  }), /SERVICE_ACCOUNT_POLICY_ATTACHMENT_REJECTED/);
});

test("duplicate service-account identities fail closed", async (t) => {
  for (const duplicateField of ["name", "email", "uniqueId"]) {
    const observation = clone(completeObservation());
    const accounts = observation.rawObservation.iam.serviceAccounts;
    if (duplicateField === "uniqueId") {
      accounts[1].uniqueId = accounts[0].uniqueId;
    } else {
      accounts[1].name = accounts[0].name;
      accounts[1].email = accounts[0].email;
    }
    refreshMockObservationDigests(observation);
    await assert.rejects(runHarness(t, {
      dependencyOverrides: {
        providerObservationRunner: deepFreeze(async () => observation),
      },
    }), /SERVICE_ACCOUNT_(?:RESOURCE_DUPLICATE|UNIQUE_ID)_REJECTED/);
  }
});

test("hierarchy missing duplicate cycle and unknown ancestor fail closed",
    async (t) => {
      const fixtures = [];
      const missing = clone(completeObservation());
      missing.rawObservation.iam.hierarchy = [];
      fixtures.push(missing);

      const duplicate = clone(completeObservation());
      duplicate.rawObservation.iam.hierarchy.push(
          clone(duplicate.rawObservation.iam.hierarchy[0]),
      );
      fixtures.push(duplicate);

      const unknownAncestor = clone(completeObservation());
      unknownAncestor.rawObservation.iam.hierarchy = [
        fixtureHierarchyResource({parentResourceName: "folders/123"}),
      ];
      fixtures.push(unknownAncestor);

      const sameIdWrongType = clone(completeObservation());
      sameIdWrongType.rawObservation.iam.hierarchy = [
        fixtureHierarchyResource({parentResourceName: "organizations/123"}),
        fixtureHierarchyResource({
          kind: "folders",
          singular: "folder",
          id: "123",
          name: "folders/123",
          parentResourceName: "organizations/456",
          hierarchyDepth: 1,
        }),
        fixtureHierarchyResource({
          kind: "organizations",
          singular: "organization",
          id: "456",
          name: "organizations/456",
          hierarchyDepth: 2,
        }),
      ];
      fixtures.push(sameIdWrongType);

      const cycle = clone(completeObservation());
      cycle.rawObservation.iam.hierarchy = [
        fixtureHierarchyResource({parentResourceName: "folders/123"}),
        fixtureHierarchyResource({
          kind: "folders",
          singular: "folder",
          id: "123",
          name: "folders/123",
          parentResourceName: `projects/${PROVIDER_TARGET_PROJECT_ID}`,
          hierarchyDepth: 1,
        }),
      ];
      cycle.rawObservation.iam.policies.push({
        attachmentPoint: "folders/123",
        version: 3,
        etag: "folder-etag",
        bindings: [],
      });
      fixtures.push(cycle);

      for (const observation of fixtures) {
        refreshMockObservationDigests(observation);
        await assert.rejects(runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner: deepFreeze(async () => observation),
          },
        }), /IAM_HIERARCHY_/);
      }
    });

test("standalone IAM resource digest is order-stable and policies pass",
    async (t) => {
      const first = clone(completeObservation());
      synchronizeMockIamClaims(first);
      const second = clone(first);
      second.rawObservation.iam.serviceAccounts.reverse();
      second.rawObservation.iam.roles.reverse();
      second.rawObservation.iam.cloudAssetAnalyses.reverse();
      synchronizeMockIamClaims(second);
      assert.equal(
          first.rawObservation.iam.resourceUniverseDigest,
          second.rawObservation.iam.resourceUniverseDigest,
      );
      assert.equal(
          first.rawObservation.iam.bindingSetDigest,
          second.rawObservation.iam.bindingSetDigest,
      );
      for (const observation of [deepFreeze(first), deepFreeze(second)]) {
        const {result} = await runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner: deepFreeze(async () => observation),
          },
        });
        assert.equal(result.artifacts.summary.policyAnalysisComplete, true);
        assert.equal(result.artifacts.summary.blockerCount, 0);
      }
    });

test("unknown or incomplete Scheduler evidence never completes observation",
    async (t) => {
      for (const schedulerInventoryComplete of [false, false]) {
        const observation = completeObservation({
          providerObservationComplete: false,
          schedulerInventoryComplete,
        });
        const {result} = await runHarness(t, {
          dependencyOverrides: {
            providerObservationRunner:
              deepFreeze(async () => observation),
          },
        });
        assert.equal(
            result.artifacts.sensitive.blockers.includes(
                "SCHEDULER_INVENTORY_INCOMPLETE",
            ),
            true,
        );
        assert.equal(
            result.artifacts.summary.providerObservationComplete,
            false,
        );
      }
    });

test("stale and future observations receive the stale blocker", async (t) => {
  const cases = [
    {
      observation: completeObservation({stale: true}),
      now: OBSERVED_AT,
    },
    {
      observation: completeObservation(),
      now: COMPLETED_AT + 5 * 60 * 1000 + 1,
    },
    {
      observation: completeObservation(),
      now: COMPLETED_AT - 1,
    },
  ];
  for (const {observation, now} of cases) {
    const {result} = await runHarness(t, {
      dependencyOverrides: {
        now: deepFreeze(() => now),
        providerObservationRunner: deepFreeze(async () => observation),
      },
    });
    assert.equal(
        result.artifacts.sensitive.blockers.includes("OBSERVATION_STALE"),
        true,
    );
    assert.equal(result.artifacts.summary.providerObservationComplete, false);
  }
});

test("optional absent, success, unknown, and conflict never alter proof boundary",
    async (t) => {
      const summaries = [];
      {
        const {result} = await runHarness(t);
        summaries.push(result.artifacts.summary);
        assert.equal(result.artifacts.summary.optionalDiagnosticStatus, "absent");
      }
      for (const status of ["success", "unknown", "conflict"]) {
        const root = sandbox(t);
        const argv = exactArgv(root, {
          optionalDiagnostic: PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC,
        });
        const state = harnessState();
        const request = exactRequest(root, {argv});
        const dependencies = exactDependencies(root, state, {
          argv,
          optionalDiagnosticRunner:
            deepFreeze(async (input) => {
              state.order.push("optional");
              state.counts.optional += 1;
              assert.equal(Object.isFrozen(input), true);
              return optionalResult(status);
            }),
        });
        const result =
          await executeInjectedMockProductionObserverHarness(
              request,
              dependencies,
          );
        summaries.push(result.artifacts.summary);
        assert.equal(result.artifacts.summary.optionalDiagnosticStatus, status);
        assert.equal(result.artifacts.summary.optionalDiagnosticExecuted, true);
        assert.equal(state.counts.optional, 1);
      }
      for (const summary of summaries) {
        assert.equal(summary.providerObservationComplete, true);
        assert.equal(summary.policyAnalysisComplete, true);
        assert.equal(summary.drainTelemetryComplete, false);
        assert.equal(summary.deploymentLineageApproved, false);
        assert.equal(summary.writeFreezeVerified, false);
        assert.equal(summary.executionEligible, false);
        assert.equal(summary.writeAuthorized, false);
        assert.equal(summary.actualMutations, 0);
        assert.equal(summary.mutationOperationCount, 0);
        assert.equal(summary.mutationPermissionCount, 0);
      }
    });

test("mutation counts and true proof-boundary claims reject", async (t) => {
  for (const mutation of [
    {actualMutations: 1},
    {mutationOperationCount: 1},
    {mutationPermissionCount: 1},
    {writeAuthorized: true},
    {writeFreezeVerified: true},
    {executionEligible: true},
  ]) {
    await assert.rejects(runHarness(t, {
      dependencyOverrides: {
        providerObservationRunner:
          deepFreeze(async () => completeObservation(mutation)),
      },
    }), /PRODUCTION_OBSERVER_MOCK_PROVIDER_OBSERVATION_REJECTED/);
  }
});

test("provider failures redact credential material and never publish", async (t) => {
  const root = sandbox(t);
  const state = harnessState();
  const request = exactRequest(root);
  const credentialPath =
    parseProductionObserverArguments(request.argv).credentialFile;
  const dependencies = exactDependencies(root, state, {
    argv: request.argv,
    providerObservationRunner: deepFreeze(async () => {
      state.order.push("provider");
      state.counts.provider += 1;
      throw new Error(
          `${SECRET_KEY} ${SECRET_EMAIL} ${SECRET_CLIENT_ID} ${credentialPath}`,
      );
    }),
  });
  let thrown;
  try {
    await executeInjectedMockProductionObserverHarness(request, dependencies);
    assert.fail("expected provider failure");
  } catch (error) {
    thrown = error;
  }
  assert.match(
      String(thrown),
      /PRODUCTION_OBSERVER_INJECTED_PROVIDER_OBSERVATION_FAILED/,
  );
  assertNoCredentialMaterial(
      `${String(thrown)}\n${thrown.stack ?? ""}`,
      credentialPath,
  );
  assert.equal(state.counts.publish, 0);
});

test("artifacts bind pinned principal without credential private material",
    async (t) => {
      const {request, result} = await runHarness(t);
      const credentialPath =
        parseProductionObserverArguments(request.argv).credentialFile;
      assertNoCredentialMaterial(
          result.artifacts,
          credentialPath,
          {allowPinnedIdentity: true},
      );
      assert.doesNotMatch(
          JSON.stringify(result.artifacts),
          /credential|private_key|client_email|client_id/i,
      );
      assert.deepEqual(
          result.artifacts.summary.observerPrincipalPolicy,
          OBSERVER_PRINCIPAL_POLICY,
      );
      assert.deepEqual(
          result.artifacts.sensitive.observerPrincipalPolicy,
          OBSERVER_PRINCIPAL_POLICY,
      );
    });

test("publisher creates exactly one 0700 directory and two 0600 files",
    async (t) => {
      const {result, root} = await runHarness(t);
      const outputPlan = outputPaths(root, "published-observation");
      const publication = publishProductionObserverArtifactPair({
        artifacts: result.artifacts,
        outputPlan,
        repositoryRoot,
      });
      assert.equal(publication.published, true);
      assert.deepEqual(
          fs.readdirSync(outputPlan.parent).sort(),
          [
            PRODUCTION_OBSERVER_SENSITIVE_FILENAME,
            PRODUCTION_OBSERVER_SUMMARY_FILENAME,
          ].sort(),
      );
      assert.equal(fs.lstatSync(outputPlan.parent).mode & 0o777, 0o700);
      for (const filePath of [
        outputPlan.summaryPath,
        outputPlan.sensitivePath,
      ]) {
        const stat = fs.lstatSync(filePath);
        assert.equal(stat.isFile(), true);
        assert.equal(stat.isSymbolicLink(), false);
        assert.equal(stat.mode & 0o777, 0o600);
        assert.equal(fs.realpathSync.native(filePath), filePath);
      }
    });

test("publisher is no-clobber and rejects non-new output parents", async (t) => {
  const {result, root} = await runHarness(t);
  const outputPlan = outputPaths(root, "existing-output");
  fs.mkdirSync(outputPlan.parent, {mode: 0o700});
  const marker = path.join(outputPlan.parent, "marker");
  fs.writeFileSync(marker, "preserve");
  await assert.rejects(
      async () => publishProductionObserverArtifactPair({
        artifacts: result.artifacts,
        outputPlan,
        repositoryRoot,
      }),
      /PRODUCTION_OBSERVER_OUTPUT_PARENT_MUST_BE_NEW/,
  );
  assert.equal(fs.readFileSync(marker, "utf8"), "preserve");
});

test("publisher rejects intermediate and output symlink escapes", async (t) => {
  const {result, root} = await runHarness(t);
  const target = path.join(root, "target");
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(root, "intermediate"));
  const intermediatePlan = outputPaths(root, "intermediate/new-output");
  assert.throws(() => publishProductionObserverArtifactPair({
    artifacts: result.artifacts,
    outputPlan: intermediatePlan,
    repositoryRoot,
  }), /PRODUCTION_OBSERVER_OUTPUT_ANCESTOR_SYMLINK_REJECTED/);

  const outputPlan = outputPaths(root, "output-symlink");
  fs.mkdirSync(outputPlan.parent);
  fs.symlinkSync(
      path.join(root, "escaped-summary"),
      outputPlan.summaryPath,
  );
  assert.throws(() => publishProductionObserverArtifactPair({
    artifacts: result.artifacts,
    outputPlan,
    repositoryRoot,
  }), /PRODUCTION_OBSERVER_OUTPUT_PARENT_MUST_BE_NEW/);
  assert.equal(fs.lstatSync(outputPlan.summaryPath).isSymbolicLink(), true);
});

test("publisher rejects output base identity replacement", async (t) => {
  const {result, root} = await runHarness(t);
  const secureBase = path.join(root, "secure-base");
  const originalBase = path.join(root, "secure-base-original");
  fs.mkdirSync(secureBase, {mode: 0o700});
  const outputPlan = outputPaths(secureBase, "identity-bound-output");
  fs.renameSync(secureBase, originalBase);
  fs.mkdirSync(secureBase, {mode: 0o700});
  assert.throws(() => publishProductionObserverArtifactPair({
    artifacts: result.artifacts,
    outputPlan,
    repositoryRoot,
  }), /PRODUCTION_OBSERVER_PUBLICATION_PLAN_REJECTED/);
  assert.equal(fs.existsSync(outputPlan.summaryPath), false);
  assert.equal(fs.existsSync(outputPlan.sensitivePath), false);
});

test("publisher enforces exact filenames, same parent, and a new parent",
    async (t) => {
      const {result, root} = await runHarness(t);
      const valid = outputPaths(root, "publication-contract");
      const plans = [
        deepFreeze({...valid, summaryPath:
          path.join(valid.parent, "summary.json")}),
        deepFreeze({...valid, sensitivePath:
          path.join(root, "other", PRODUCTION_OBSERVER_SENSITIVE_FILENAME)}),
      ];
      for (const outputPlan of plans) {
        assert.throws(() => publishProductionObserverArtifactPair({
          artifacts: result.artifacts,
          outputPlan,
          repositoryRoot,
        }), /PRODUCTION_OBSERVER_OUTPUT_/);
      }
      fs.mkdirSync(valid.parent);
      assert.throws(() => publishProductionObserverArtifactPair({
        artifacts: result.artifacts,
        outputPlan: valid,
        repositoryRoot,
      }), /PRODUCTION_OBSERVER_OUTPUT_PARENT_MUST_BE_NEW/);
    });

test("second hard-link failure rolls back first file, temps, and new directory",
    async (t) => {
      const {result, root} = await runHarness(t);
      const outputPlan = outputPaths(root, "rollback-output");
      const originalLinkSync = fs.linkSync;
      let calls = 0;
      fs.linkSync = function mockedLinkSync(...args) {
        calls += 1;
        if (calls === 2) throw new Error("synthetic second hard-link failure");
        return originalLinkSync(...args);
      };
      try {
        assert.throws(() => publishProductionObserverArtifactPair({
          artifacts: result.artifacts,
          outputPlan,
          repositoryRoot,
        }), /PRODUCTION_OBSERVER_PUBLICATION_FAILED/);
      } finally {
        fs.linkSync = originalLinkSync;
      }
      assert.equal(calls, 2);
      assert.equal(fs.existsSync(outputPlan.summaryPath), false);
      assert.equal(fs.existsSync(outputPlan.sensitivePath), false);
      assert.equal(fs.existsSync(outputPlan.parent), false);
    });

test("publisher rejects secret-bearing artifacts without echoing secrets",
    async (t) => {
      const {result, root} = await runHarness(t);
      const variants = [
        deepFreeze({
          summary: deepFreeze({...result.artifacts.summary, private_key:
            SECRET_KEY}),
          sensitive: result.artifacts.sensitive,
        }),
        deepFreeze({
          summary: result.artifacts.summary,
          sensitive: deepFreeze({...result.artifacts.sensitive, detail:
            `Bearer ${SECRET_CLIENT_ID}`}),
        }),
      ];
      for (const artifacts of variants) {
        const outputPlan = outputPaths(
            root,
            `secret-output-${Math.random().toString(16).slice(2)}`,
        );
        let thrown;
        try {
          publishProductionObserverArtifactPair({
            artifacts,
            outputPlan,
            repositoryRoot,
          });
          assert.fail("expected secret rejection");
        } catch (error) {
          thrown = error;
        }
        assert.match(String(thrown), /PRODUCTION_OBSERVER_.*SECRET/);
        assertNoCredentialMaterial(
            `${String(thrown)}\n${thrown.stack ?? ""}`,
            path.join(root, "credential.json"),
        );
        assert.equal(fs.existsSync(outputPlan.parent), false);
      }
    });

test("source load ignores swapped fetch, invalid env credential, and CLI main",
    () => {
      const output = execFileSync(process.execPath, [
        "--input-type=module",
        "-e",
        [
          "let fetchCalls=0;",
          "let credentialAccesses=0;",
          "const originalFetch=globalThis.fetch;",
          "globalThis.fetch=()=>{fetchCalls+=1;throw new Error('fetch')};",
          "const m=await import(",
          "'./functions/scripts/observe-academy-reset-freeze-production.mjs');",
          "if(process.env.GOOGLE_APPLICATION_CREDENTIALS===",
          "'/invalid/credential/path')credentialAccesses=0;",
          "globalThis.fetch=originalFetch;",
          "console.log(JSON.stringify({fetchCalls,credentialAccesses,",
          "exports:Object.keys(m)}));",
        ].join(""),
      ], {
        cwd: repositoryRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          GOOGLE_APPLICATION_CREDENTIALS: "/invalid/credential/path",
        },
      });
      const loaded = JSON.parse(output);
      assert.equal(loaded.fetchCalls, 0);
      assert.equal(loaded.credentialAccesses, 0);
      assert.equal(loaded.exports.includes("runProductionObserverCli"), false);
    });

test("observer namespace exposes only safe observer and mock transport APIs",
    () => {
      assert.deepEqual(Object.keys(observerModule), [
        "GOOGLE_PROVIDER_READ_ONLY_SCOPE",
        "MOCK_TRANSPORT_SESSION_VERSION",
        "PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC",
        "PRODUCTION_OBSERVER_SCHEMA_VERSION",
        "PRODUCTION_OBSERVER_SENSITIVE_FILENAME",
        "PRODUCTION_OBSERVER_SUMMARY_FILENAME",
        "PROVIDER_TRANSPORT_MAX_PAGES",
        "PROVIDER_TRANSPORT_MAX_RECORDS",
        "ProviderTransportError",
        "assertMockProviderTransportExecutor",
        "assertStableProviderInventory",
        "compareProviderInventoryScans",
        "computeMockTransportLineageDigest",
        "createMockProviderTransportExecutor",
        "deriveProductionObserverArtifacts",
        "executeInjectedMockProductionObserverHarness",
        "parseProductionObserverArguments",
        "publishProductionObserverArtifactPair",
        "validateProductionObserverRequest",
      ]);
      for (const forbidden of [
        "createProductionProviderTransportExecutor",
        "executeProductionObserver",
        "assertGenuineRawProductionResult",
        "runProductionObserverCli",
        "main",
      ]) {
        assert.equal(Object.hasOwn(observerModule, forbidden), false);
      }
    });
