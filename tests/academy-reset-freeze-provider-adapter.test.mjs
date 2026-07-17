import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import * as adapterModule from
  "../functions/scripts/academy-reset-freeze-provider-adapter.mjs";
import {
  APPROVED_PROVIDER_ADAPTER_ID,
  EXPECTED_DEPLOYED_FUNCTION_NAMES,
  EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NUMBER,
  IAM_EVIDENCE_FAMILY_NAMES,
  PROVIDER_ADAPTER_METADATA,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
  REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS,
  REVIEWED_IAM_ROLE_DEFINITIONS,
  REVIEWED_PERMISSION_UNIVERSE,
  REVIEWED_WRITABLE_PERMISSIONS,
  WRITABLE_PERMISSION_DERIVATION_VERSION,
  buildApprovedIamExpectedState,
  buildIamFamilyCompleteness,
  computeIamPolicyDigest,
  computeProviderAdapterReviewedSourceIdentityDigest,
  sha256Canonical,
  validateProviderAdapterReviewedSources,
} from "../functions/scripts/academy-reset-write-freeze-contract.mjs";
import {
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  PROVIDER_OPERATION_ALLOWLIST_VERSION,
  PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";
import {
  MOCK_TRANSPORT_SESSION_VERSION,
  computeMockTransportLineageDigest,
  createMockProviderTransportExecutor,
} from "../functions/scripts/academy-reset-freeze-provider-transport.mjs";

const {createMockAcademyResetFreezeProviderAdapter} = adapterModule;
const repositoryRoot =
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRootDigest = sha256Canonical({
  repositoryRoot: fs.realpathSync(repositoryRoot),
  schemaVersion: PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
});
const AT = "2026-07-17T05:00:00.000Z";
const computeEmail =
  `${EXPECTED_PROJECT_NUMBER}-compute@developer.gserviceaccount.com`;
const computeMember = `serviceAccount:${computeEmail}`;
const firebaseEmail =
  `firebase-adminsdk-prod@${EXPECTED_PROJECT_ID}.iam.gserviceaccount.com`;
const futureEmail =
  `academy-reset-executor@${EXPECTED_PROJECT_ID}.iam.gserviceaccount.com`;
const principalAllowlist = [
  {
    id: "cloud_functions_runtime",
    member: computeMember,
    semanticRole: "academy_backend_read_only",
    disposition: "ACTIVE_READ_ONLY",
    effectivePermissions: [
      "datastore.databases.get",
      "datastore.entities.get",
      "datastore.entities.list",
    ],
    authPermissions: [],
  },
  {
    id: "firebase_admin_backend",
    member: `serviceAccount:${firebaseEmail}`,
    semanticRole: "academy_backend_read_only",
    disposition: "ACTIVE_READ_ONLY",
    effectivePermissions: [
      "datastore.databases.get",
      "datastore.entities.get",
      "datastore.entities.list",
    ],
    authPermissions: [],
  },
  {
    id: "future_reset_executor",
    member: `serviceAccount:${futureEmail}`,
    semanticRole: "academy_reset_delete_only_inactive",
    disposition: "INACTIVE",
    effectivePermissions: [
      "datastore.databases.get",
      "datastore.entities.delete",
      "datastore.entities.get",
      "datastore.entities.list",
    ],
    authPermissions: [],
  },
];

function deepFreeze(value, seen = new Set()) {
  if (!value ||
      typeof value !== "object" && typeof value !== "function" ||
      seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
}

function approvalReceipt() {
  return deepFreeze({
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    providerDependencyApproval: {
      ...structuredClone(PROVIDER_ADAPTER_METADATA),
      reviewedSourceDigest:
        PROVIDER_ADAPTER_METADATA.reviewedSourceIdentityDigest,
      reviewedSourceRepositoryRootDigest: repositoryRootDigest,
    },
  });
}

function buildId(index) {
  return `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function functionRecords() {
  return EXPECTED_DEPLOYED_FUNCTION_NAMES.map((name, index) => ({
    name,
    projectId: EXPECTED_PROJECT_ID,
    region: "us-central1",
    runtime: "nodejs24",
    generation: "GEN_2",
    revisionId: `${name}-00001-abc`,
    buildId: buildId(index),
    updateTime: AT,
    providerSourceIdentity: {
      type: "storage_source",
      value: `gs://mock-source/${name}.zip/1`,
      generation: "1",
      md5Hash: "VaVACK0bpYmqIQ0mKcHfQQ==",
      sha256:
        "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
      size: "1",
    },
    runtimeServiceAccount: computeMember,
  }));
}

function principalSnapshots() {
  return principalAllowlist.map((principal) => ({
    ...structuredClone(principal),
    snapshotDigest: sha256Canonical(principal),
  }));
}

function rawIam(functions = functionRecords()) {
  const policy = {
    observedAt: AT,
    bindings: principalAllowlist
        .filter(({disposition}) => disposition === "ACTIVE_READ_ONLY")
        .map(({member}) => ({
          attachmentPoint: `projects/${EXPECTED_PROJECT_ID}`,
          inherited: false,
          member,
          role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
          condition: null,
        })),
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
    runtimeServiceAccounts: functions.map(({name, runtimeServiceAccount}) => ({
      functionName: name,
      member: runtimeServiceAccount,
    })),
    roleDefinitions: structuredClone(REVIEWED_IAM_ROLE_DEFINITIONS),
    permissionUniverse: [...REVIEWED_PERMISSION_UNIVERSE],
    writablePermissionDerivation: {
      schemaVersion: WRITABLE_PERMISSION_DERIVATION_VERSION,
      permissionUniverseDigest:
        sha256Canonical([...REVIEWED_PERMISSION_UNIVERSE].sort()),
      writablePermissions: [...REVIEWED_WRITABLE_PERMISSIONS],
      readOnlyPermissions: REVIEWED_PERMISSION_UNIVERSE.filter((permission) =>
        !REVIEWED_WRITABLE_PERMISSIONS.includes(permission)),
    },
    principals: principalSnapshots(),
    policyDigest: "",
    completeness: null,
    familyCompleteness: null,
  };
  policy.policyDigest = computeIamPolicyDigest(policy);
  return policy;
}

function assertRawIamWritableDenial(iamPolicy) {
  const roleByName = new Map(
      iamPolicy.roleDefinitions.map((role) => [role.role, role]),
  );
  for (const binding of iamPolicy.bindings) {
    const role = roleByName.get(binding.role);
    assert.ok(role, `missing raw role definition for ${binding.role}`);
    assert.equal(binding.condition, null);
    assert.equal(role.permissions.some((permission) =>
      REVIEWED_WRITABLE_PERMISSIONS.includes(permission)), false);
  }
  assert.deepEqual(
      iamPolicy.writablePermissionDerivation.writablePermissions,
      REVIEWED_WRITABLE_PERMISSIONS,
  );
  assert.equal(iamPolicy.groupExpansions.every(({complete}) => complete), true);
  assert.deepEqual(iamPolicy.conditionEvaluations, []);
  assert.deepEqual(iamPolicy.denyPolicies, []);
  assert.deepEqual(iamPolicy.denyEvaluations, []);
  assert.deepEqual(iamPolicy.impersonationEvidence, []);
}

function fullApprovalReceipt() {
  const functions = functionRecords();
  const iam = rawIam(functions);
  const iamExpectedState = buildApprovedIamExpectedState(iam);
  iam.familyCompleteness = buildIamFamilyCompleteness(iam, iamExpectedState);
  return deepFreeze({
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    providerDependencyApproval: {
      ...structuredClone(PROVIDER_ADAPTER_METADATA),
      reviewedSourceDigest:
        PROVIDER_ADAPTER_METADATA.reviewedSourceIdentityDigest,
      reviewedSourceRepositoryRootDigest: repositoryRootDigest,
      reviewedLockDigest: "a".repeat(64),
    },
    resources: {
      rules: {
        releaseName:
          `projects/${EXPECTED_PROJECT_ID}/releases/cloud.firestore`,
        rulesetName: `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-123`,
      },
      functions,
      iamExpectedState,
    },
    iamPrincipalAllowlist: principalAllowlist,
  });
}

function mockExecutor(receipt, fetchImpl = async () => {
  throw new Error("factory tests must not execute transport");
}) {
  const lowLevelReceipt = {
    schemaVersion: MOCK_TRANSPORT_SESSION_VERSION,
    mockOnly: true,
    targetProjectId: EXPECTED_PROJECT_ID,
    targetProjectNumber: EXPECTED_PROJECT_NUMBER,
    approvedLocation: "us-central1",
    lineageBindings: {},
    lineageDigest: "",
  };
  lowLevelReceipt.lineageDigest =
    computeMockTransportLineageDigest(lowLevelReceipt);
  let clock = Date.parse(AT);
  let execution = 0;
  return createMockProviderTransportExecutor(deepFreeze({
    authHeaderProvider: async () => ({Authorization: "Bearer mock"}),
    fetchImpl,
    now: () => ++clock,
    randomId: () => `transport-${++execution}`,
    receipt: deepFreeze(lowLevelReceipt),
    sessionReceipt: receipt,
    sleep: async () => {},
    timeoutSignalProvider: () => AbortSignal.timeout(1000),
  }));
}

function operationInputFromRequest(urlValue, method) {
  const url = new URL(urlValue);
  const target = `${url.origin}${url.pathname}`;
  for (const descriptor of Object.values(PROVIDER_OPERATION_REGISTRY)) {
    if (descriptor.method !== method) continue;
    const names = [];
    const template = `${descriptor.host}${descriptor.pathTemplate}`;
    const pattern = template.replace(
        /[.*+?^${}()|[\]\\]/g,
        "\\$&",
    ).replace(/\\\{(\\\+)?([^}]+)\\\}/g, (_match, plus, name) => {
      names.push(name);
      return plus ? "(.+)" : "([^/]+)";
    });
    const match = new RegExp(`^${pattern}$`).exec(target);
    if (!match) continue;
    if (descriptor.operationId === "storage.v1.objects.getMedia" &&
        url.searchParams.get("alt") !== "media") continue;
    if (descriptor.operationId === "storage.v1.objects.getMetadata" &&
        url.searchParams.get("alt") === "media") continue;
    return {
      operationId: descriptor.operationId,
      pathParams: Object.fromEntries(names.map((name, index) =>
        [name, decodeURIComponent(match[index + 1])])),
      query: Object.fromEntries(url.searchParams),
    };
  }
  throw new Error(`unmapped request ${method} ${target}`);
}

const mutationCounts = new WeakMap();
const operationInputs = new WeakMap();

function responseAtUrl(response, requestUrl) {
  Object.defineProperty(response, "url", {
    value: requestUrl.href,
    configurable: false,
    enumerable: false,
    writable: false,
  });
  return response;
}

function jsonResponse(requestUrl, value) {
  return responseAtUrl(new Response(JSON.stringify(value), {
    status: 200,
    headers: {"content-type": "application/json"},
  }), requestUrl);
}

function providerExecutor(receipt, mutate = (operationId, value) => value) {
  let execution = 0;
  let mutationCount = 0;
  const inputs = [];
  const functions = functionRecords();
  const byName = new Map(functions.map((item) => [item.name, item]));
  const serviceAccounts = [computeEmail, firebaseEmail, futureEmail];
  const rawExecutor = async ({operationId, pathParams, query}) => {
    execution += 1;
    inputs.push(structuredClone({operationId, pathParams, query}));
    if (!PROVIDER_OPERATION_IDS.includes(operationId)) {
      throw new Error("unknown operation");
    }
    if (/\.(?:create|update|delete|setIamPolicy)$/.test(operationId)) {
      mutationCount += 1;
    }
    let value;
    switch (operationId) {
      case "firebaserules.v1.projects.releases.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}/releases/cloud.firestore`,
          rulesetName:
            `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-123`,
          createTime: AT,
          updateTime: AT,
        };
        break;
      case "firebaserules.v1.projects.rulesets.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}/rulesets/ruleset-123`,
          createTime: AT,
          updateTime: AT,
        };
        break;
      case "cloudfunctions.v2.projects.locations.functions.list":
        value = functions.map(({name}) => ({
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `functions/${name}`,
        }));
        break;
      case "cloudfunctions.v2.projects.locations.functions.get": {
        const fn = byName.get(pathParams.functionId);
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `functions/${fn.name}`,
          environment: "GEN_2",
          updateTime: fn.updateTime,
          buildName:
            `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/builds/` +
            fn.buildId,
          buildConfig: {
            runtime: "nodejs24",
            source: {storageSource: {
              bucket: "mock-source",
              object: `${fn.name}.zip`,
              generation: "1",
            }},
          },
          serviceConfig: {
            serviceAccountEmail: computeEmail,
            service:
              `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
              `services/${fn.name}`,
            revision:
              `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
              `services/${fn.name}/revisions/${fn.revisionId}`,
          },
        };
        break;
      }
      case "run.v2.projects.locations.services.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${pathParams.serviceId}`,
          latestReadyRevision:
            `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${pathParams.serviceId}/revisions/` +
            `${pathParams.serviceId}-00001-abc`,
        };
        break;
      case "run.v2.projects.locations.services.list":
        value = functions.map(({name}) => ({
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${name}`,
        }));
        break;
      case "run.v2.projects.locations.services.revisions.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${pathParams.serviceId}/revisions/` +
            pathParams.revisionId,
          service:
            `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${pathParams.serviceId}`,
        };
        break;
      case "run.v2.projects.locations.services.revisions.list":
        value = [{
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${pathParams.serviceId}/revisions/` +
            `${pathParams.serviceId}-00001-abc`,
          service:
            `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${pathParams.serviceId}`,
        }];
        break;
      case "cloudbuild.v1.projects.locations.builds.get": {
        const fn = functions.find(({buildId}) =>
          buildId === pathParams.buildId);
        value = {
          id: fn.buildId,
          status: "SUCCESS",
          source: {storageSource: {
            bucket: "mock-source",
            object: `${fn.name}.zip`,
            generation: "1",
          }},
        };
        break;
      }
      case "storage.v1.objects.getMetadata":
        value = {
          bucket: pathParams.bucket,
          name: pathParams.object,
          generation: "1",
          md5Hash: "VaVACK0bpYmqIQ0mKcHfQQ==",
          size: "1",
        };
        break;
      case "storage.v1.objects.getMedia":
        value = {media: {
          bytes: new Uint8Array([1]),
          byteLength: 1,
          md5Hash: "VaVACK0bpYmqIQ0mKcHfQQ==",
          sha256:
            "4bf5122f344554c53bde2ebb8cd2b7e3d1600ad631c385a5d7cce23c7785459a",
        }};
        break;
      case "cloudresourcemanager.v3.projects.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}`,
          projectId: EXPECTED_PROJECT_ID,
          projectNumber: EXPECTED_PROJECT_NUMBER,
        };
        break;
      case "cloudresourcemanager.v3.projects.getIamPolicy":
        value = {
          version: 3,
          etag: "etag",
          bindings: principalAllowlist
              .filter(({disposition}) =>
                disposition === "ACTIVE_READ_ONLY")
              .map(({member}) => ({
                role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
                members: [member],
              })),
        };
        break;
      case "iam.v1.projects.roles.list":
        value = REVIEWED_IAM_ROLE_DEFINITIONS.map(({role}) => ({name: role}));
        break;
      case "iam.v1.projects.roles.get": {
        const role = REVIEWED_IAM_ROLE_DEFINITIONS.find(({role}) =>
          role.endsWith(`/${pathParams.roleId}`));
        value = {
          name: role.role,
          includedPermissions: [...role.permissions],
          permissionsComplete: true,
          deleted: false,
          stage: "GA",
        };
        break;
      }
      case "iam.v1.projects.serviceAccounts.list":
        value = serviceAccounts.map((email) => ({
          name: `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/${email}`,
          email,
        }));
        break;
      case "iam.v1.projects.serviceAccounts.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/` +
            pathParams.serviceAccount,
          email: pathParams.serviceAccount,
          projectId: EXPECTED_PROJECT_ID,
        };
        break;
      case "iam.v1.projects.serviceAccounts.getIamPolicy":
        value = {version: 3, etag: "etag", bindings: []};
        break;
      case "cloudasset.v1.projects.analyzeIamPolicy":
        value = {
          fullyExplored: true,
          mainAnalysis: {
            analysisResults: principalAllowlist
                .filter(({member, disposition}) =>
                  member ===
                    query["analysisQuery.identitySelector.identity"] &&
                  disposition === "ACTIVE_READ_ONLY")
                .map(({member}) => ({
                  identity: member,
                  resource:
                    `//cloudresourcemanager.googleapis.com/projects/` +
                    EXPECTED_PROJECT_ID,
                  role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
                  permissions:
                    [...REVIEWED_IAM_ROLE_DEFINITIONS[0].permissions],
                  condition: null,
                })),
            groupEdges: [],
          },
          nonCriticalErrors: [],
        };
        break;
      case "policytroubleshooter.v3.iam.troubleshoot":
        value = {access: "NOT_GRANTED"};
        break;
      case "iam.v2.policies.denypolicies.list":
        value = [];
        break;
      case "serviceusage.v1.projects.services.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_NUMBER}/services/` +
            pathParams.serviceName,
          state: "ENABLED",
        };
        break;
      case "cloudscheduler.v1.projects.locations.jobs.list":
        value = [{
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/jobs/` +
            "autoDeductPendingLessons",
        }];
        break;
      case "cloudscheduler.v1.projects.locations.jobs.get":
        value = {
          name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/jobs/` +
            "autoDeductPendingLessons",
          httpTarget: {
            uri: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
              "functions/autoDeductPendingLessons",
          },
          state: "DISABLED",
          updateTime: AT,
        };
        break;
      default:
        throw new Error(`fixture lacks ${operationId}`);
    }
    value = mutate(operationId, structuredClone(value));
    const common = {
      operationId,
      paginationComplete: true,
      mockOnly: true,
      transportExecutionId: `provider-execution-${execution}`,
      pageCount: 1,
      observedAtEpochMs: Date.parse(AT) + execution,
      completedAtEpochMs: Date.parse(AT) + execution,
    };
    if (value?.media) {
      return {...common, recordCount: 1, media: value.media};
    }
    const paged = operationId.endsWith(".list");
    return {
      ...common,
      recordCount: paged ? value.length : 1,
      ...(paged ? {records: value} : {response: value}),
    };
  };
  const executor = mockExecutor(receipt, async (url, init) => {
    const input = operationInputFromRequest(url, init.method);
    const result = await rawExecutor(input);
    if (Object.hasOwn(result, "media")) {
      return responseAtUrl(
          new Response(result.media.bytes, {status: 200}),
          url,
      );
    }
    const descriptor = PROVIDER_OPERATION_REGISTRY[input.operationId];
    if (Object.hasOwn(result, "records")) {
      return jsonResponse(url, {
        [descriptor.response.recordsField]: result.records,
      });
    }
    return jsonResponse(url, result.response);
  });
  mutationCounts.set(executor, () => mutationCount);
  operationInputs.set(executor, () => structuredClone(inputs));
  return executor;
}

function options(overrides = {}) {
  const receipt = overrides.approvalReceipt ?? approvalReceipt();
  return deepFreeze({
    approvalReceipt: receipt,
    repositoryRoot,
    reviewedSourceIdentities: PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
    transportExecutor: mockExecutor(receipt),
    ...overrides,
  });
}

test("adapter module exposes only the mock family factory", () => {
  assert.deepEqual(Object.keys(adapterModule), [
    "assertGenuineMockAcademyResetFreezeProviderAdapter",
    "assertGenuineMockAcademyResetFreezeProviderResult",
    "createMockAcademyResetFreezeProviderAdapter",
  ]);
  const adapter = createMockAcademyResetFreezeProviderAdapter(options());
  assert.deepEqual(Object.keys(adapter).sort(), [
    "adapterContractVersion",
    "adapterId",
    "mockOnly",
    "observeDeployment",
  ]);
  assert.equal(adapter.adapterId, APPROVED_PROVIDER_ADAPTER_ID);
  assert.equal(adapter.adapterContractVersion,
      PROVIDER_ADAPTER_CONTRACT_VERSION);
  assert.equal(adapter.mockOnly, true);
  assert.equal(Object.isFrozen(adapter), true);
});

test("factory rejects noncanonical, mutable, foreign, and extra inputs", () => {
  const accepted = options();
  for (const invalid of [
    {...accepted},
    deepFreeze({...accepted, callerPlan: []}),
    deepFreeze({...accepted, approvalReceipt: deepFreeze({
      ...structuredClone(accepted.approvalReceipt),
      projectId: "foreign-project",
    })}),
  ]) {
    assert.throws(
        () => createMockAcademyResetFreezeProviderAdapter(invalid),
        /rejected/,
    );
  }
});

test("factory requires exact mock session and operation metadata", () => {
  const receipt = approvalReceipt();
  const duck = async () => {};
  Object.defineProperty(duck, "metadata", {value: deepFreeze({
    mockOnly: true,
    sessionReceipt: receipt,
    providerOperationAllowlistVersion: PROVIDER_OPERATION_ALLOWLIST_VERSION,
    providerOperationDescriptorSetDigest:
      PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
    providerAdapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
  })});
  assert.throws(() => createMockAcademyResetFreezeProviderAdapter(
      deepFreeze({
        approvalReceipt: receipt,
        repositoryRoot,
        reviewedSourceIdentities: PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
        transportExecutor: Object.freeze(duck),
      }),
  ), /GENUINE_MOCK_TRANSPORT_EXECUTOR_REQUIRED/);
  const foreignReceipt = deepFreeze({
    ...structuredClone(receipt),
    projectId: "foreign-project",
  });
  assert.throws(() => createMockAcademyResetFreezeProviderAdapter(
      deepFreeze({
        approvalReceipt: receipt,
        repositoryRoot,
        reviewedSourceIdentities: PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
        transportExecutor: mockExecutor(foreignReceipt),
      }),
  ), /GENUINE_MOCK_TRANSPORT_EXECUTOR_REQUIRED/);
});

test("every coherently re-digested reviewed source identity is rejected", () => {
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.forEach((_, index) => {
    const identities =
      structuredClone(PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES);
    identities[index].sha256 = crypto.createHash("sha256")
        .update(`${identities[index].sha256}:tampered`)
        .digest("hex");
    const receipt = structuredClone(approvalReceipt());
    receipt.providerDependencyApproval.reviewedSourceDigest =
      computeProviderAdapterReviewedSourceIdentityDigest(identities);
    deepFreeze(receipt);
    assert.throws(() => createMockAcademyResetFreezeProviderAdapter(
        deepFreeze({
          approvalReceipt: receipt,
          repositoryRoot,
          reviewedSourceIdentities: identities,
          transportExecutor: mockExecutor(receipt),
        }),
    ), /REVIEWED_SOURCE_IDENTITIES_MISMATCH/);
  });
});

test("every reviewed adapter source identity matches runtime bytes", () => {
  for (const identity of PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES) {
    const bytes = fs.readFileSync(path.join(repositoryRoot, identity.path));
    const digest = crypto.createHash("sha256").update(bytes).digest("hex");
    assert.equal(digest, identity.sha256, identity.path);
  }
  const runtime = validateProviderAdapterReviewedSources(repositoryRoot);
  assert.deepEqual(runtime.identities,
      PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES);
  assert.equal(runtime.aggregateDigest,
      PROVIDER_ADAPTER_METADATA.reviewedSourceIdentityDigest);
});

test("reviewed source pins reject missing extra swapped and same-count paths",
    () => {
      const pins = structuredClone(
          PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
      );
      const variants = [
        pins.slice(1),
        [...pins, {path: "functions/extra.mjs", sha256: "a".repeat(64)}],
        pins.map((pin, index) => index < 2 ? {
          ...pin,
          sha256: pins[1 - index].sha256,
        } : pin),
        pins.map((pin, index) => index === 0 ? {
          ...pin,
          path: "functions/not-package-lock.json",
        } : pin),
      ];
      for (const identities of [variants[0], variants[1], variants[3]]) {
        assert.throws(
            () => computeProviderAdapterReviewedSourceIdentityDigest(
                identities,
            ),
            /source identities|path mismatch/,
        );
      }
      const swapped = variants[2];
      const receipt = structuredClone(approvalReceipt());
      receipt.providerDependencyApproval.reviewedSourceDigest =
        computeProviderAdapterReviewedSourceIdentityDigest(swapped);
      deepFreeze(receipt);
      assert.throws(() => createMockAcademyResetFreezeProviderAdapter(
          deepFreeze({
            approvalReceipt: receipt,
            repositoryRoot,
            reviewedSourceIdentities: swapped,
            transportExecutor: mockExecutor(receipt),
          }),
      ), /REVIEWED_SOURCE_IDENTITIES_MISMATCH/);
    });

test("adapter source has no production factory, auth, fetch, CLI, or mutation",
    () => {
      const source = fs.readFileSync(path.join(
          repositoryRoot,
          "functions/scripts/academy-reset-freeze-provider-adapter.mjs",
      ), "utf8");
      for (const forbidden of [
        /createProviderTransportExecutor/,
        /createGoogleAuthHeaderProvider/,
        /\bfetch\s*\(/,
        /service.?account.?key/i,
        /GOOGLE_APPLICATION_CREDENTIALS/,
        /\b(?:PUT|PATCH|DELETE)\b/,
        /process\.argv/,
        /firebase deploy/,
        /\bgcloud\b/,
      ]) assert.doesNotMatch(source, forbidden);
      assert.match(source, /const adapterSessions = new WeakMap\(\)/);
      assert.match(source, /mutationOperationCount/);
    });

test("mock adapter derives all families and a canonical zero-mutation trace",
    async () => {
      const receipt = fullApprovalReceipt();
      const executor = providerExecutor(receipt);
      const adapter = createMockAcademyResetFreezeProviderAdapter(deepFreeze({
        approvalReceipt: receipt,
        repositoryRoot,
        reviewedSourceIdentities:
          PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
        transportExecutor: executor,
      }));
      const result = await adapter.observeDeployment();
      const reviewedSources =
        validateProviderAdapterReviewedSources(repositoryRoot);
      assert.equal(
          adapterModule.assertGenuineMockAcademyResetFreezeProviderAdapter(
              adapter,
              reviewedSources,
          ),
          true,
      );
      assert.equal(
          adapterModule.assertGenuineMockAcademyResetFreezeProviderResult(
              result,
              reviewedSources,
          ),
          true,
      );
      assert.throws(
          () => adapterModule
              .assertGenuineMockAcademyResetFreezeProviderResult(
                  structuredClone(result),
                  reviewedSources,
              ),
          /GENUINE_MOCK_PROVIDER_RESULT_REQUIRED/,
      );
      assert.equal(Object.isFrozen(result), true);
      assert.equal(Object.isFrozen(result.observation.functions.records), true);
      assert.deepEqual(
          result.observation.functions.records.map(({name}) => name),
          EXPECTED_DEPLOYED_FUNCTION_NAMES,
      );
      assert.deepEqual(
          result.observation.functions.guardedExportNames,
          EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
      );
      assert.equal(result.observation.rules.completeness.stable, true);
      assert.equal(result.observation.functions.completeness.stable, true);
      assert.equal(result.observation.iamPolicy.completeness.stable, true);
      assert.equal(result.observation.scheduler.completeness.stable, true);
      assert.equal(result.metadata.mockOnly, true);
      assert.equal(result.metadata.actualMutations, 0);
      assert.equal(result.metadata.unknownOperationCount, 0);
      assert.equal(mutationCounts.get(executor)(), 0);
      assert.equal(
          result.observation.operationExecution.executionTraceDigest,
          sha256Canonical(
              result.observation.operationExecution.executionTrace,
          ),
      );
      assert.equal(result.metadata.executedOperationIds.every((operationId) =>
        PROVIDER_OPERATION_IDS.includes(operationId)), true);
      const troubleshooterOperationId =
        "policytroubleshooter.v3.iam.troubleshoot";
      assert.equal(PROVIDER_OPERATION_IDS.includes(
          troubleshooterOperationId,
      ), true);
      assert.equal(
          PROVIDER_OPERATION_REGISTRY[troubleshooterOperationId]
              .observationRequirement,
          "optional_diagnostic",
      );
      assert.equal(result.metadata.executedOperationIds.includes(
          troubleshooterOperationId,
      ), false);
      assert.equal(
          result.observation.operationExecution.executionTrace.some(
              ({operationId}) => operationId === troubleshooterOperationId,
          ),
          false,
      );
      const inputs = operationInputs.get(executor)();
      assert.equal(inputs.some(({operationId}) =>
        operationId === troubleshooterOperationId), false);
      assert.equal(inputs.some(({operationId, pathParams}) =>
        operationId === "serviceusage.v1.projects.services.get" &&
        pathParams.serviceName ===
          "policytroubleshooter.googleapis.com"), false);
      assert.deepEqual(
          result.metadata.executedOperationIds,
          REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS,
      );
      assertRawIamWritableDenial(result.observation.iamPolicy);
      await assert.rejects(adapter.observeDeployment(),
          /ADAPTER_SESSION_ALREADY_OBSERVED/);
    });

test("optional Troubleshooter responses do not control mock observation",
    async () => {
      for (const optionalResponse of [
        {access: "UNKNOWN"},
        {access: "ACCESS_STATE_UNSPECIFIED"},
        {},
      ]) {
        let optionalResponseConsumed = false;
        const receipt = fullApprovalReceipt();
        const executor = providerExecutor(receipt, (operationId, value) => {
          if (operationId !==
              "policytroubleshooter.v3.iam.troubleshoot") return value;
          optionalResponseConsumed = true;
          return structuredClone(optionalResponse);
        });
        const adapter = createMockAcademyResetFreezeProviderAdapter(
            deepFreeze({
              approvalReceipt: receipt,
              repositoryRoot,
              reviewedSourceIdentities:
                PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
              transportExecutor: executor,
            }),
        );
        const result = await adapter.observeDeployment();
        assert.equal(optionalResponseConsumed, false);
        assert.equal(operationInputs.get(executor)().some(({operationId}) =>
          operationId ===
            "policytroubleshooter.v3.iam.troubleshoot"), false);
        assert.deepEqual(
            result.metadata.executedOperationIds,
            REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS,
        );
        assertRawIamWritableDenial(result.observation.iamPolicy);
      }
    });

test("foreign Rules and stale Run revision fail without mutations", async () => {
  for (const mutate of [
    (operationId, value) => operationId ===
      "firebaserules.v1.projects.releases.get" ?
      {...value, name: "projects/foreign/releases/cloud.firestore"} :
      value,
    (operationId, value) => operationId ===
      "run.v2.projects.locations.services.get" ?
      {...value, latestReadyRevision: `${value.name}/revisions/stale`} :
      value,
  ]) {
    const receipt = fullApprovalReceipt();
    const executor = providerExecutor(receipt, mutate);
    const adapter = createMockAcademyResetFreezeProviderAdapter(deepFreeze({
      approvalReceipt: receipt,
      repositoryRoot,
      reviewedSourceIdentities: PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
      transportExecutor: executor,
    }));
    await assert.rejects(adapter.observeDeployment(), /rejected/);
    assert.equal(mutationCounts.get(executor)(), 0);
  }
});

test("independent Function Run Build and Storage boundaries fail closed",
    async () => {
      const functionGetCalls = new Map();
      const schedulerCases = [
        (operationId, value) => {
          if (operationId !== "run.v2.projects.locations.services.list") {
            return value;
          }
          return [...value, {
            name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
              "services/foreign-extra",
          }];
        },
        (operationId, value) => operationId ===
          "run.v2.projects.locations.services.revisions.list" ?
          [...value, {
            name: `${value[0].service}/revisions/stale`,
            service: value[0].service,
          }] : value,
        (operationId, value) => {
          if (operationId !==
              "cloudfunctions.v2.projects.locations.functions.get") {
            return value;
          }
          const count = (functionGetCalls.get(value.name) ?? 0) + 1;
          functionGetCalls.set(value.name, count);
          return count === 2 ? {...value, updateTime:
            "2026-07-17T05:00:01.000Z"} : value;
        },
        (operationId, value) => operationId ===
          "cloudbuild.v1.projects.locations.builds.get" ?
          {...value, status: "WORKING"} : value,
        (operationId, value) => operationId ===
          "storage.v1.objects.getMetadata" ?
          {...value, md5Hash: "AAAAAAAAAAAAAAAAAAAAAA=="} : value,
        (operationId, value) => {
          if (operationId !== "storage.v1.objects.getMetadata") return value;
          delete value.md5Hash;
          return value;
        },
      ];
      for (const mutate of schedulerCases) {
        const receipt = fullApprovalReceipt();
        const executor = providerExecutor(receipt, mutate);
        const adapter = createMockAcademyResetFreezeProviderAdapter(
            deepFreeze({
              approvalReceipt: receipt,
              repositoryRoot,
              reviewedSourceIdentities:
                PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
              transportExecutor: executor,
            }),
        );
        await assert.rejects(adapter.observeDeployment(), /rejected/);
        assert.equal(mutationCounts.get(executor)(), 0);
      }
    });

test("IAM raw role group and service-account evidence fail closed",
    async () => {
      const roleGetCalls = new Map();
      for (const mutate of [
        (operationId, value) => operationId ===
          "iam.v1.projects.serviceAccounts.list" ?
          [...value, {
            name: `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/` +
              `extra@${EXPECTED_PROJECT_ID}.iam.gserviceaccount.com`,
            email: `extra@${EXPECTED_PROJECT_ID}.iam.gserviceaccount.com`,
          }] : value,
        (operationId, value) => operationId ===
          "iam.v1.projects.serviceAccounts.list" ? value.slice(1) : value,
        (operationId, value) => operationId ===
          "iam.v1.projects.serviceAccounts.list" ? value.map((account, index) =>
            index === 0 ? {
              ...account,
              name: `projects/foreign-project/serviceAccounts/${account.email}`,
            } : account) : value,
        (operationId, value) => operationId ===
          "iam.v1.projects.serviceAccounts.get" ? {
            ...value,
            name: `projects/foreign-project/serviceAccounts/${value.email}`,
          } : value,
        (operationId, value) => operationId ===
          "cloudasset.v1.projects.analyzeIamPolicy" ?
          {...value, mainAnalysis: {}} : value,
        (operationId, value) => {
          if (operationId !==
              "cloudasset.v1.projects.analyzeIamPolicy" ||
              value.mainAnalysis.analysisResults.length === 0) return value;
          value.mainAnalysis.analysisResults[0].permissions.push(
              "datastore.entities.delete",
          );
          return value;
        },
        (operationId, value) => {
          if (operationId !==
              "cloudasset.v1.projects.analyzeIamPolicy" ||
              value.mainAnalysis.analysisResults.length === 0) return value;
          value.mainAnalysis.analysisResults[0].condition = {
            title: "contradiction",
            description: "",
            expression: "request.time < timestamp('2027-01-01T00:00:00Z')",
          };
          return value;
        },
        (operationId, value) => {
          if (operationId !==
              "cloudresourcemanager.v3.projects.getIamPolicy") return value;
          value.bindings.push({
            role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
            members: ["domain:unresolved.example"],
          });
          return value;
        },
        (operationId, value) => {
          if (operationId !== "iam.v1.projects.roles.get") return value;
          const count = (roleGetCalls.get(value.name) ?? 0) + 1;
          roleGetCalls.set(value.name, count);
          return count === 2 ? {
            ...value,
            includedPermissions: [
              ...value.includedPermissions,
              "datastore.entities.delete",
            ],
          } : value;
        },
      ]) {
        const receipt = fullApprovalReceipt();
        const executor = providerExecutor(receipt, mutate);
        const adapter = createMockAcademyResetFreezeProviderAdapter(
            deepFreeze({
              approvalReceipt: receipt,
              repositoryRoot,
              reviewedSourceIdentities:
                PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
              transportExecutor: executor,
            }),
        );
        await assert.rejects(adapter.observeDeployment(), /rejected/);
        assert.equal(mutationCounts.get(executor)(), 0);
      }
    });

test("Scheduler list and get boundaries reject extras and instability",
    async () => {
      let schedulerGetCount = 0;
      for (const mutate of [
        (operationId, value) => operationId ===
          "cloudscheduler.v1.projects.locations.jobs.list" ?
          [...value, {
            name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
              "jobs/foreign-disabled",
          }] : value,
        (operationId, value) => {
          if (operationId !==
              "cloudscheduler.v1.projects.locations.jobs.get") return value;
          schedulerGetCount += 1;
          return schedulerGetCount === 2 ?
            {...value, updateTime: "2026-07-17T05:00:01.000Z"} :
            value;
        },
        (operationId, value) => operationId ===
          "cloudscheduler.v1.projects.locations.jobs.get" ? {
            ...value,
            name: `projects/foreign-project/locations/us-central1/jobs/` +
              "autoDeductPendingLessons",
          } : value,
      ]) {
        const receipt = fullApprovalReceipt();
        const executor = providerExecutor(receipt, mutate);
        const adapter = createMockAcademyResetFreezeProviderAdapter(
            deepFreeze({
              approvalReceipt: receipt,
              repositoryRoot,
              reviewedSourceIdentities:
                PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
              transportExecutor: executor,
            }),
        );
        await assert.rejects(adapter.observeDeployment(), /rejected/);
        assert.equal(mutationCounts.get(executor)(), 0);
      }
    });
