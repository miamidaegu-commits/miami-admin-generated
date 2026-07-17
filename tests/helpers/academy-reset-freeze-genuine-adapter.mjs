import {
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NUMBER,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
  REVIEWED_IAM_ROLE_DEFINITIONS,
  REVIEWED_PERMISSION_UNIVERSE,
  SCHEDULER_JOB_ALLOWLIST,
} from "../../functions/scripts/academy-reset-write-freeze-contract.mjs";
import {
  createMockAcademyResetFreezeProviderAdapter,
} from "../../functions/scripts/academy-reset-freeze-provider-adapter.mjs";
import {
  PROVIDER_OPERATION_REGISTRY,
} from "../../functions/scripts/academy-reset-freeze-provider-operations.mjs";
import {
  MOCK_TRANSPORT_SESSION_VERSION,
  computeMockTransportLineageDigest,
  createMockProviderTransportExecutor,
} from "../../functions/scripts/academy-reset-freeze-provider-transport.mjs";

function deepFreeze(value, seen = new Set()) {
  if (!value ||
      typeof value !== "object" && typeof value !== "function" ||
      seen.has(value)) return value;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key], seen);
  return Object.freeze(value);
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
  throw new Error(`unmapped mock request: ${method}`);
}

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

function sourceOf(record) {
  const match =
    /^gs:\/\/([^/]+)\/(.+)\/([0-9]+)$/.exec(
        record.providerSourceIdentity.value,
    );
  if (!match) throw new Error("invalid approved source fixture");
  return {bucket: match[1], object: match[2], generation: match[3]};
}

function providerResponseFor(evidence, operationId, pathParams, query) {
  const approval = evidence.deploymentApprovalReceipt;
  const functions = approval.resources.functions;
  const functionByName = new Map(functions.map((item) => [item.name, item]));
  const runtimeEmails = functions.map(({runtimeServiceAccount}) =>
    runtimeServiceAccount.replace(/^serviceAccount:/, ""));
  const principalEmails = approval.iamPrincipalAllowlist.map(({member}) =>
    member.replace(/^serviceAccount:/, ""));
  const serviceAccounts = [...new Set([
    ...runtimeEmails,
    ...principalEmails,
  ])].sort();
  const resourceTime = functions[0].updateTime;
  switch (operationId) {
    case "firebaserules.v1.projects.releases.get":
      return {
        name: approval.resources.rules.releaseName,
        rulesetName: approval.resources.rules.rulesetName,
        createTime: resourceTime,
        updateTime: resourceTime,
      };
    case "firebaserules.v1.projects.rulesets.get":
      return {
        name: approval.resources.rules.rulesetName,
        createTime: resourceTime,
        updateTime: resourceTime,
      };
    case "cloudfunctions.v2.projects.locations.functions.list":
      return functions.map(({name}) => ({
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `functions/${name}`,
      }));
    case "cloudfunctions.v2.projects.locations.functions.get": {
      const fn = functionByName.get(pathParams.functionId);
      const source = sourceOf(fn);
      return {
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `functions/${fn.name}`,
        environment: fn.generation,
        updateTime: fn.updateTime,
        buildName: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `builds/${fn.buildId}`,
        buildConfig: {runtime: fn.runtime, source: {storageSource: source}},
        serviceConfig: {
          serviceAccountEmail:
            fn.runtimeServiceAccount.replace(/^serviceAccount:/, ""),
          service: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${fn.name}`,
          revision: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
            `services/${fn.name}/revisions/${fn.revisionId}`,
        },
      };
    }
    case "run.v2.projects.locations.services.list":
      return functions.map(({name}) => ({
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `services/${name}`,
      }));
    case "run.v2.projects.locations.services.get": {
      const fn = functionByName.get(pathParams.serviceId);
      return {
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `services/${fn.name}`,
        latestReadyRevision:
          `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `services/${fn.name}/revisions/${fn.revisionId}`,
      };
    }
    case "run.v2.projects.locations.services.revisions.list": {
      const fn = functionByName.get(pathParams.serviceId);
      return [{
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `services/${fn.name}/revisions/${fn.revisionId}`,
        service: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `services/${fn.name}`,
      }];
    }
    case "run.v2.projects.locations.services.revisions.get":
      return {
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `services/${pathParams.serviceId}/revisions/${pathParams.revisionId}`,
        service: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/` +
          `services/${pathParams.serviceId}`,
      };
    case "cloudbuild.v1.projects.locations.builds.get": {
      const fn = functions.find(({buildId}) => buildId === pathParams.buildId);
      return {id: fn.buildId, status: "SUCCESS",
        source: {storageSource: sourceOf(fn)}};
    }
    case "storage.v1.objects.getMetadata": {
      const fn = functions.find((item) => {
        const source = sourceOf(item);
        return source.bucket === pathParams.bucket &&
          source.object === pathParams.object;
      });
      return {
        bucket: pathParams.bucket,
        name: pathParams.object,
        generation: sourceOf(fn).generation,
        md5Hash: fn.providerSourceIdentity.md5Hash,
        size: fn.providerSourceIdentity.size,
      };
    }
    case "storage.v1.objects.getMedia":
      return new Uint8Array([1]);
    case "cloudresourcemanager.v3.projects.get":
      return {
        name: `projects/${EXPECTED_PROJECT_ID}`,
        projectId: EXPECTED_PROJECT_ID,
        projectNumber: EXPECTED_PROJECT_NUMBER,
      };
    case "cloudresourcemanager.v3.projects.getIamPolicy":
      return {
        version: 3,
        etag: "fixture-etag",
        bindings: approval.iamPrincipalAllowlist
            .filter(({disposition}) => disposition === "ACTIVE_READ_ONLY")
            .map(({member}) => ({
              role: REVIEWED_IAM_ROLE_DEFINITIONS[0].role,
              members: [member],
            })),
      };
    case "iam.v1.projects.roles.list":
      return REVIEWED_IAM_ROLE_DEFINITIONS.map(({role}) => ({name: role}));
    case "iam.v1.projects.roles.get": {
      const role = REVIEWED_IAM_ROLE_DEFINITIONS.find(({role: name}) =>
        name.endsWith(`/${pathParams.roleId}`));
      return {
        name: role.role,
        includedPermissions: [...role.permissions],
        permissionsComplete: true,
        deleted: false,
        stage: role.stage,
      };
    }
    case "iam.v1.projects.serviceAccounts.list":
      return serviceAccounts.map((email) => ({
        name: `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/${email}`,
        email,
      }));
    case "iam.v1.projects.serviceAccounts.get":
      return {
        name: `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/` +
          pathParams.serviceAccount,
        email: pathParams.serviceAccount,
        projectId: EXPECTED_PROJECT_ID,
      };
    case "iam.v1.projects.serviceAccounts.getIamPolicy":
      return {version: 3, etag: "fixture-etag", bindings: []};
    case "cloudasset.v1.projects.analyzeIamPolicy": {
      const identity = query["analysisQuery.identitySelector.identity"];
      return {
        fullyExplored: true,
        mainAnalysis: {
          analysisResults: approval.iamPrincipalAllowlist
              .filter(({member, disposition}) =>
                member === identity && disposition === "ACTIVE_READ_ONLY")
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
    }
    case "policytroubleshooter.v3.iam.troubleshoot":
      return {access: "NOT_GRANTED"};
    case "iam.v2.policies.denypolicies.list":
      return [];
    case "serviceusage.v1.projects.services.get":
      return {
        name: `projects/${EXPECTED_PROJECT_NUMBER}/services/` +
          pathParams.serviceName,
        state: "ENABLED",
      };
    case "cloudscheduler.v1.projects.locations.jobs.list":
      return SCHEDULER_JOB_ALLOWLIST.map(({name}) => ({
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/jobs/` +
          name,
      }));
    case "cloudscheduler.v1.projects.locations.jobs.get": {
      const job = evidence.scheduler.jobs.find(
          ({name}) => name === pathParams.jobId,
      );
      return {
        name: `projects/${EXPECTED_PROJECT_ID}/locations/us-central1/jobs/` +
          job.name,
        httpTarget: {uri: job.target},
        state: job.state,
        updateTime: job.updateTime,
      };
    }
    default:
      throw new Error(`missing genuine adapter fixture: ${operationId}`);
  }
}

export function createGenuineAdapterForEvidence(evidence, repositoryRoot) {
  const approvalReceipt = deepFreeze(
      structuredClone(evidence.deploymentApprovalReceipt),
  );
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
  let clock = Date.parse(evidence.freezeWindow.activatedAt) - 120000;
  let execution = 0;
  const transportExecutor = createMockProviderTransportExecutor(deepFreeze({
    authHeaderProvider: async () => ({Authorization: "Bearer fixture"}),
    fetchImpl: async (url, init) => {
      const input = operationInputFromRequest(url, init.method);
      if (input.operationId === "cloudresourcemanager.v3.projects.get") {
        clock = Math.max(
            clock,
            Date.parse(evidence.negativeProbes[0].observedAt) - 60000,
        );
      }
      if (input.operationId ===
          "cloudscheduler.v1.projects.locations.jobs.list") {
        clock = Math.max(
            clock,
            Date.parse(evidence.scheduler.jobs[0].updateTime) + 1000,
        );
      }
      const value = providerResponseFor(
          evidence,
          input.operationId,
          input.pathParams,
          input.query,
      );
      if (value instanceof Uint8Array) {
        return responseAtUrl(new Response(value, {status: 200}), url);
      }
      const descriptor = PROVIDER_OPERATION_REGISTRY[input.operationId];
      return jsonResponse(url, Array.isArray(value) ? {
        [descriptor.response.recordsField]: value,
      } : value);
    },
    now: () => ++clock,
    randomId: () => `genuine-fixture-${++execution}`,
    receipt: deepFreeze(lowLevelReceipt),
    sessionReceipt: approvalReceipt,
    sleep: async () => {},
    timeoutSignalProvider: () => AbortSignal.timeout(1000),
  }));
  return createMockAcademyResetFreezeProviderAdapter(deepFreeze({
    approvalReceipt,
    repositoryRoot,
    reviewedSourceIdentities: PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
    transportExecutor,
  }));
}
