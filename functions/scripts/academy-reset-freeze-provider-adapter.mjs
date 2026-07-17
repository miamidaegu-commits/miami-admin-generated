import {
  APPROVED_PROVIDER_ADAPTER_ID,
  EXPECTED_DEPLOYED_FUNCTION_NAMES,
  EXPECTED_FUNCTION_GENERATION,
  EXPECTED_FUNCTION_REGION,
  EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NUMBER,
  IAM_EVIDENCE_FAMILY_NAMES,
  OBSERVATION_COMPLETENESS_VERSION,
  PROJECT_IDENTITY_CONTRACT_VERSION,
  PROVIDER_ADAPTER_METADATA,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
  PROVIDER_DEPENDENCY_CONTRACT_VERSION,
  PROVIDER_OBSERVATION_VERSION,
  REVIEWED_IAM_ROLE_DEFINITIONS,
  REVIEWED_PERMISSION_UNIVERSE,
  REVIEWED_WRITABLE_PERMISSIONS,
  SCHEDULER_JOB_ALLOWLIST,
  WRITABLE_PERMISSION_DERIVATION_VERSION,
  buildIamFamilyCompleteness,
  computeIamPolicyDigest,
  computeObservedSetDigest,
  computeProviderAdapterReviewedSourceIdentityDigest,
  EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
  KNOWN_IAM_GROUPS,
  validateProviderAdapterReviewedSources,
  sha256Canonical,
  stableStringify,
} from "./academy-reset-write-freeze-contract.mjs";
import {
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  PROVIDER_OPERATION_ALLOWLIST_VERSION,
  PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_TARGET_PROJECT_ID,
  PROVIDER_TARGET_PROJECT_NUMBER,
} from "./academy-reset-freeze-provider-operations.mjs";
import {
  assertMockProviderTransportExecutor,
} from "./academy-reset-freeze-provider-transport.mjs";

const FACTORY_KEYS = Object.freeze([
  "approvalReceipt",
  "repositoryRoot",
  "reviewedSourceIdentities",
  "transportExecutor",
]);
const adapterSessions = new WeakMap();
const genuineAdapters = new WeakSet();
const genuineProviderResults = new WeakMap();
const operationSet = new Set(PROVIDER_OPERATION_IDS);
const projectPath = Object.freeze({
  projectId: PROVIDER_TARGET_PROJECT_ID,
  location: EXPECTED_FUNCTION_REGION,
});
const projectResource = `projects/${EXPECTED_PROJECT_ID}`;

function fail(code) {
  throw new Error(`Mock academy reset provider adapter rejected: ${code}`);
}

function assertRecord(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    fail(`${label}_MUST_BE_EXACT_RECORD`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail(`${label}_SYMBOL_KEY_REJECTED`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      fail(`${label}_PROPERTY_REJECTED`);
    }
  }
  if (expectedKeys &&
      stableStringify([...keys].sort()) !==
        stableStringify([...expectedKeys].sort())) {
    fail(`${label}_KEYSET_REJECTED`);
  }
  return keys;
}

function assertDeepFrozen(value, label) {
  if (!value || typeof value !== "object" && typeof value !== "function") return;
  if (!Object.isFrozen(value)) fail(`${label}_MUST_BE_DEEP_FROZEN`);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor && Object.hasOwn(descriptor, "value")) {
      assertDeepFrozen(descriptor.value, `${label}_${String(key)}`);
    }
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function exactSet(actual, expected, code) {
  if (!Array.isArray(actual) || new Set(actual).size !== actual.length ||
      stableStringify([...actual].sort()) !==
        stableStringify([...expected].sort())) {
    fail(code);
  }
}

function parseName(value, pattern, code) {
  if (typeof value !== "string") fail(code);
  const match = pattern.exec(value);
  if (!match) fail(code);
  return match;
}

function iso(epochMs, code) {
  if (!Number.isFinite(epochMs)) fail(code);
  return new Date(epochMs).toISOString();
}

function resultStart(result) {
  return iso(result.observedAtEpochMs, "OPERATION_START_TIME_REJECTED");
}

function resultEnd(result) {
  return iso(result.completedAtEpochMs, "OPERATION_END_TIME_REJECTED");
}

function resultPayload(result, code) {
  if (result?.paginationComplete !== true || result.mockOnly !== true ||
      typeof result.operationId !== "string" ||
      typeof result.transportExecutionId !== "string" ||
      !Number.isSafeInteger(result.pageCount) || result.pageCount < 1 ||
      !Number.isSafeInteger(result.recordCount) || result.recordCount < 0) {
    fail(code);
  }
  return Object.hasOwn(result, "records") ? result.records : result.response;
}

function getSession(adapter) {
  const session = adapterSessions.get(adapter);
  if (!session) fail("ADAPTER_SESSION_REJECTED");
  return session;
}

async function execute(session, input) {
  assertRecord(input, [
    "operationId",
    "pathParams",
    ...(Object.hasOwn(input, "query") ? ["query"] : []),
    ...(Object.hasOwn(input, "body") ? ["body"] : []),
  ], "INTERNAL_OPERATION_INPUT");
  if (!operationSet.has(input.operationId)) fail("UNKNOWN_OPERATION_ID");
  const descriptor = PROVIDER_OPERATION_REGISTRY[input.operationId];
  if (descriptor.readOnlySemantic !== true ||
      !["GET", "POST"].includes(descriptor.method)) {
    session.mutationOperationCount += 1;
  }
  let result;
  try {
    result = await session.transportExecutor(input);
  } catch {
    fail("PROVIDER_OPERATION_FAILED");
  }
  resultPayload(result, "PROVIDER_OPERATION_RESULT_REJECTED");
  if (result.operationId !== input.operationId) {
    fail("PROVIDER_OPERATION_ID_MISMATCH");
  }
  session.trace.push({
    operationId: input.operationId,
    transportExecutionId: result.transportExecutionId,
    pageCount: result.pageCount,
    recordCount: result.recordCount,
    paginationComplete: result.paginationComplete,
    mockOnly: result.mockOnly,
  });
  session.started.push(resultStart(result));
  session.completed.push(resultEnd(result));
  return result;
}

function addLineage(session, binding, values) {
  const current = session.lineage.get(binding) ?? new Set();
  for (const value of values) {
    if (typeof value !== "string" || !value) fail("DYNAMIC_LINEAGE_REJECTED");
    current.add(value);
  }
  session.lineage.set(binding, current);
}

function requireLineage(session, binding, value) {
  if (!session.lineage.get(binding)?.has(value)) {
    fail(`MISSING_${binding.toUpperCase()}_LINEAGE`);
  }
  return value;
}

function completeness(items, startResult, endResult, expectedCount, pageCount) {
  const digest = computeObservedSetDigest(items);
  return {
    schemaVersion: OBSERVATION_COMPLETENESS_VERSION,
    scanStartedAt: resultStart(startResult),
    scanCompletedAt: resultEnd(endResult),
    pageCount,
    nextPageTokenExhausted: true,
    unreachableResources: [],
    observedCount: items.length,
    expectedCount,
    startSetDigest: digest,
    endSetDigest: digest,
    observedSetDigest: digest,
    stable: true,
  };
}

async function observeRules(session) {
  const approved = session.approvalReceipt.resources.rules;
  const releaseMatch = parseName(
      approved.releaseName,
      /^projects\/([^/]+)\/releases\/(cloud\.firestore)$/,
      "APPROVED_RULES_RELEASE_REJECTED",
  );
  if (releaseMatch[1] !== EXPECTED_PROJECT_ID) fail("FOREIGN_RULES_RELEASE");
  addLineage(session, "approved_rules_release_id", [releaseMatch[2]]);
  const releaseInput = {
    operationId: "firebaserules.v1.projects.releases.get",
    pathParams: {
      projectId: EXPECTED_PROJECT_ID,
      releaseId: releaseMatch[2],
    },
  };
  const firstRelease = await execute(session, releaseInput);
  const firstReleaseValue = firstRelease.response;
  if (firstReleaseValue.name !== approved.releaseName) {
    fail("RULES_RELEASE_NAME_MISMATCH");
  }
  const rulesetMatch = parseName(
      firstReleaseValue.rulesetName,
      /^projects\/([^/]+)\/rulesets\/([^/]+)$/,
      "RULES_RELEASE_LINEAGE_MISSING",
  );
  if (rulesetMatch[1] !== EXPECTED_PROJECT_ID ||
      firstReleaseValue.rulesetName !== approved.rulesetName) {
    fail("RULES_RULESET_LINEAGE_MISMATCH");
  }
  addLineage(session, "approved_rules_ruleset_id", [rulesetMatch[2]]);
  const rulesetInput = {
    operationId: "firebaserules.v1.projects.rulesets.get",
    pathParams: {
      projectId: EXPECTED_PROJECT_ID,
      rulesetId: rulesetMatch[2],
    },
  };
  const firstRuleset = await execute(session, rulesetInput);
  const secondRelease = await execute(session, releaseInput);
  const secondRuleset = await execute(session, rulesetInput);
  if (stableStringify(firstRelease.response) !==
        stableStringify(secondRelease.response) ||
      stableStringify(firstRuleset.response) !==
        stableStringify(secondRuleset.response)) {
    fail("RULES_INVENTORY_UNSTABLE");
  }
  if (firstRuleset.response.name !== approved.rulesetName) {
    fail("RULESET_NAME_MISMATCH");
  }
  const rules = {
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    releaseName: firstReleaseValue.name,
    rulesetName: firstRuleset.response.name,
    releaseCreateTime: firstReleaseValue.createTime,
    releaseUpdateTime: firstReleaseValue.updateTime,
    rulesetCreateTime: firstRuleset.response.createTime,
    rulesetUpdateTime: firstRuleset.response.updateTime,
  };
  const item = {...rules};
  return {
    ...rules,
    completeness: completeness(
        [item],
        firstRelease,
        secondRuleset,
        1,
        firstRelease.pageCount + firstRuleset.pageCount +
          secondRelease.pageCount + secondRuleset.pageCount,
    ),
  };
}

function storageSourceOf(fn) {
  const source = fn.buildConfig?.source?.storageSource;
  if (!source || typeof source.bucket !== "string" ||
      typeof source.object !== "string" ||
      typeof source.generation !== "string") {
    fail("FUNCTION_STORAGE_SOURCE_MISSING");
  }
  return source;
}

function idFromName(name, pattern, code) {
  return parseName(name, pattern, code).at(-1);
}

async function observeFunctionBoundary(session) {
  const listInput = {
    operationId: "cloudfunctions.v2.projects.locations.functions.list",
    pathParams: {...projectPath},
    query: {pageSize: 1000},
  };
  const functionList = await execute(session, listInput);
  const names = functionList.records.map(({name}) => idFromName(
      name,
      /^projects\/daegu-miami-production\/locations\/us-central1\/functions\/([^/]+)$/,
      "FUNCTION_LIST_NAME_REJECTED",
  ));
  exactSet(names, EXPECTED_DEPLOYED_FUNCTION_NAMES,
      "FUNCTION_LIST_EXACT_SET_MISMATCH");
  addLineage(session, "approved_function_id", names);
  const approvedByName = new Map(
      session.approvalReceipt.resources.functions.map((item) =>
        [item.name, item]),
  );
  const functionSnapshots = [];
  for (const functionId of [...names].sort()) {
    requireLineage(session, "approved_function_id", functionId);
    const result = await execute(session, {
      operationId: "cloudfunctions.v2.projects.locations.functions.get",
      pathParams: {...projectPath, functionId},
    });
    functionSnapshots.push({functionId, result, value: result.response});
  }
  const expectedServices = functionSnapshots.map(({value}) => value
      .serviceConfig?.service);
  expectedServices.forEach((serviceName) => idFromName(
      serviceName,
      /^projects\/daegu-miami-production\/locations\/us-central1\/services\/([^/]+)$/,
      "RUN_SERVICE_LINEAGE_MISSING",
  ));
  const runList = await execute(session, {
    operationId: "run.v2.projects.locations.services.list",
    pathParams: {...projectPath},
    query: {pageSize: 1000},
  });
  exactSet(
      runList.records.map(({name}) => name),
      expectedServices,
      "RUN_SERVICE_LIST_EXACT_SET_MISMATCH",
  );
  const records = [];
  const snapshots = [];
  for (const {functionId, value: fn} of functionSnapshots) {
    const fullFunctionName =
      `projects/${EXPECTED_PROJECT_ID}/locations/${EXPECTED_FUNCTION_REGION}` +
      `/functions/${functionId}`;
    if (fn.name !== fullFunctionName ||
        fn.environment !== EXPECTED_FUNCTION_GENERATION ||
        fn.buildConfig?.runtime !== "nodejs24") {
      fail("FUNCTION_RUNTIME_IDENTITY_MISMATCH");
    }
    const serviceName = fn.serviceConfig?.service;
    const revisionName = fn.serviceConfig?.revision;
    const buildName = fn.buildName;
    const serviceId = idFromName(
        serviceName,
        /^projects\/daegu-miami-production\/locations\/us-central1\/services\/([^/]+)$/,
        "RUN_SERVICE_LINEAGE_MISSING",
    );
    const revisionId = idFromName(
        revisionName,
        /^projects\/daegu-miami-production\/locations\/us-central1\/services\/[^/]+\/revisions\/([^/]+)$/,
        "RUN_REVISION_LINEAGE_MISSING",
    );
    const buildId = idFromName(
        buildName,
        /^projects\/daegu-miami-production\/locations\/us-central1\/builds\/([0-9a-fA-F-]{36})$/,
        "BUILD_LINEAGE_MISSING",
    );
    addLineage(session, "approved_service_id", [serviceId]);
    addLineage(session, "approved_revision_id", [revisionId]);
    addLineage(session, "approved_build_id", [buildId]);
    const revisionList = await execute(session, {
      operationId: "run.v2.projects.locations.services.revisions.list",
      pathParams: {...projectPath, serviceId},
      query: {pageSize: 1000},
    });
    exactSet(
        revisionList.records.map(({name}) => name),
        [revisionName],
        "RUN_REVISION_LIST_EXACT_SET_MISMATCH",
    );
    const serviceResult = await execute(session, {
      operationId: "run.v2.projects.locations.services.get",
      pathParams: {...projectPath, serviceId},
    });
    if (serviceResult.response.name !== serviceName ||
        serviceResult.response.latestReadyRevision !== revisionName) {
      fail("RUN_SERVICE_CURRENT_REVISION_MISMATCH");
    }
    const revisionResult = await execute(session, {
      operationId: "run.v2.projects.locations.services.revisions.get",
      pathParams: {...projectPath, serviceId, revisionId},
    });
    if (revisionResult.response.name !== revisionName ||
        revisionResult.response.service !== serviceName) {
      fail("RUN_REVISION_IDENTITY_MISMATCH");
    }
    const buildResult = await execute(session, {
      operationId: "cloudbuild.v1.projects.locations.builds.get",
      pathParams: {...projectPath, buildId},
    });
    if (buildResult.response.id !== buildId ||
        buildResult.response.status !== "SUCCESS") {
      fail("BUILD_IDENTITY_OR_STATUS_MISMATCH");
    }
    const source = storageSourceOf(fn);
    const buildSource = buildResult.response.source?.storageSource;
    if (stableStringify(source) !== stableStringify(buildSource)) {
      fail("BUILD_STORAGE_SOURCE_MISMATCH");
    }
    addLineage(session, "approved_storage_source_bucket", [source.bucket]);
    addLineage(session, "approved_storage_source_object", [source.object]);
    addLineage(session, "approved_storage_source_generation",
        [source.generation]);
    const storagePath = {bucket: source.bucket, object: source.object};
    const metadataResult = await execute(session, {
      operationId: "storage.v1.objects.getMetadata",
      pathParams: storagePath,
      query: {generation: source.generation},
    });
    if (metadataResult.response.bucket !== source.bucket ||
        metadataResult.response.name !== source.object ||
        metadataResult.response.generation !== source.generation ||
        !/^(?:0|[1-9][0-9]*)$/.test(metadataResult.response.size) ||
        !/^[A-Za-z0-9+/]{22}==$/.test(metadataResult.response.md5Hash)) {
      fail("STORAGE_METADATA_IDENTITY_MISMATCH");
    }
    const mediaResult = await execute(session, {
      operationId: "storage.v1.objects.getMedia",
      pathParams: storagePath,
      query: {alt: "media", generation: source.generation},
    });
    if (metadataResult.response.md5Hash !== mediaResult.media.md5Hash ||
        Number(metadataResult.response.size) !== mediaResult.media.byteLength ||
        typeof mediaResult.media.sha256 !== "string" ||
        !/^[0-9a-f]{64}$/.test(mediaResult.media.sha256)) {
      fail("STORAGE_MEDIA_DIGEST_MISMATCH");
    }
    const runtimeEmail = fn.serviceConfig?.serviceAccountEmail;
    addLineage(session, "approved_service_account_email", [runtimeEmail]);
    const record = {
      name: functionId,
      projectId: EXPECTED_PROJECT_ID,
      region: EXPECTED_FUNCTION_REGION,
      runtime: fn.buildConfig.runtime,
      generation: fn.environment,
      revisionId,
      buildId,
      updateTime: fn.updateTime,
      providerSourceIdentity: {
        type: "storage_source",
        value: `gs://${source.bucket}/${source.object}/${source.generation}`,
        generation: source.generation,
        md5Hash: mediaResult.media.md5Hash,
        sha256: mediaResult.media.sha256,
        size: String(mediaResult.media.byteLength),
      },
      runtimeServiceAccount: `serviceAccount:${runtimeEmail}`,
    };
    if (stableStringify(record) !==
        stableStringify(approvedByName.get(functionId))) {
      fail("FUNCTION_APPROVAL_RECEIPT_MISMATCH");
    }
    records.push(record);
    snapshots.push({
      functionId,
      function: fn,
      runServiceListRecord: runList.records.find(
          ({name}) => name === serviceName,
      ),
      runRevisionList: revisionList.records,
      runService: serviceResult.response,
      runRevision: revisionResult.response,
      build: buildResult.response,
      storageMetadata: metadataResult.response,
      storageMedia: {
        byteLength: mediaResult.media.byteLength,
        md5Hash: mediaResult.media.md5Hash,
        sha256: mediaResult.media.sha256,
      },
    });
  }
  return {functionList, records, snapshots};
}

async function observeFunctions(session) {
  const startTraceIndex = session.trace.length;
  const start = await observeFunctionBoundary(session);
  const end = await observeFunctionBoundary(session);
  if (start.functionList.transportExecutionId ===
        end.functionList.transportExecutionId ||
      stableStringify(start.functionList.records) !==
        stableStringify(end.functionList.records) ||
      stableStringify(start.records) !== stableStringify(end.records) ||
      stableStringify(start.snapshots) !== stableStringify(end.snapshots)) {
    fail("FUNCTION_PROVIDER_SNAPSHOTS_UNSTABLE");
  }
  const familyTrace = session.trace.slice(startTraceIndex);
  return {
    records: start.records,
    guardedExportNames: [...EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES],
    completeness: completeness(
        start.records,
        start.functionList,
        end.functionList,
        EXPECTED_DEPLOYED_FUNCTION_NAMES.length,
        familyTrace.reduce((total, item) => total + item.pageCount, 0),
    ),
  };
}

function normalizeCondition(condition) {
  if (!condition) return null;
  return {
    title: condition.title ?? "",
    description: condition.description ?? "",
    expression: condition.expression,
  };
}

function normalizePolicyBindings(policy, attachmentPoint, inherited) {
  return (policy.bindings ?? []).flatMap((binding) =>
    binding.members.map((member) => ({
      attachmentPoint,
      inherited,
      member,
      role: binding.role,
      condition: normalizeCondition(binding.condition),
    })));
}

function memberEmail(member) {
  const match = /^serviceAccount:(.+)$/.exec(member);
  if (!match) fail("SERVICE_ACCOUNT_MEMBER_REJECTED");
  return match[1];
}

function normalizeAnalysisResults(response, identity, label) {
  const main = response.mainAnalysis;
  if (!main || !Array.isArray(main.analysisResults) ||
      !Array.isArray(main.groupEdges)) {
    fail(`${label}_RAW_EXPANSION_EVIDENCE_MISSING`);
  }
  return main.analysisResults.map((result) => {
    assertRecord(result, [
      "condition", "identity", "permissions", "resource", "role",
    ], `${label}_ANALYSIS_RESULT`);
    if (result.identity !== identity ||
        !Array.isArray(result.permissions)) {
      fail(`${label}_ANALYSIS_IDENTITY_REJECTED`);
    }
    return {
      identity: result.identity,
      resource: result.resource,
      role: result.role,
      permissions: [...result.permissions].sort(),
      condition: normalizeCondition(result.condition),
    };
  });
}

async function observeIamPass(session, functions) {
  const startTraceIndex = session.trace.length;
  const project = await execute(session, {
    operationId: "cloudresourcemanager.v3.projects.get",
    pathParams: {projectId: EXPECTED_PROJECT_ID},
  });
  if (project.response.name !== projectResource ||
      project.response.projectId !== EXPECTED_PROJECT_ID ||
      String(project.response.projectNumber) !== EXPECTED_PROJECT_NUMBER) {
    fail("RESOURCE_MANAGER_PROJECT_IDENTITY_MISMATCH");
  }
  const resources = [{kind: "projects", id: EXPECTED_PROJECT_ID}];
  let parent = project.response.parent;
  while (parent) {
    const match = /^(folders|organizations)\/([0-9]+)$/.exec(parent);
    if (!match) fail("RESOURCE_MANAGER_PARENT_LINEAGE_REJECTED");
    const [, kind, id] = match;
    addLineage(session, "discovered_parent_lineage", [id]);
    const parentResult = await execute(session, {
      operationId: `cloudresourcemanager.v3.${kind}.get`,
      pathParams: {[kind === "folders" ? "folderId" : "organizationId"]: id},
    });
    if (parentResult.response.name !== parent) {
      fail("RESOURCE_MANAGER_PARENT_NAME_MISMATCH");
    }
    resources.push({kind, id});
    parent = parentResult.response.parent;
  }
  const bindings = [];
  for (const [index, resource] of resources.entries()) {
    const singular = resource.kind === "projects" ? "project" :
      resource.kind === "folders" ? "folder" : "organization";
    const policy = await execute(session, {
      operationId:
        `cloudresourcemanager.v3.${resource.kind}.getIamPolicy`,
      pathParams: {[`${singular}Id`]: resource.id},
      body: {options: {requestedPolicyVersion: 3}},
    });
    bindings.push(...normalizePolicyBindings(
        policy.response,
        `${resource.kind}/${resource.id}`,
        index !== 0,
    ));
  }
  const expectedRoles = REVIEWED_IAM_ROLE_DEFINITIONS.map(({role}) => role);
  const roleListInput = {
    operationId: "iam.v1.projects.roles.list",
    pathParams: {projectId: EXPECTED_PROJECT_ID},
    query: {pageSize: 1000},
  };
  const roleStart = await execute(session, roleListInput);
  exactSet(roleStart.records.map(({name}) => name), expectedRoles,
      "IAM_ROLE_LIST_MISMATCH");
  const roleDefinitions = [];
  for (const roleName of expectedRoles) {
    const roleId = idFromName(
        roleName,
        /^projects\/daegu-miami-production\/roles\/([^/]+)$/,
        "IAM_ROLE_NAME_REJECTED",
    );
    addLineage(session, "approved_iam_role_id", [roleId]);
    const role = await execute(session, {
      operationId: "iam.v1.projects.roles.get",
      pathParams: {projectId: EXPECTED_PROJECT_ID, roleId},
    });
    const normalized = {
      role: role.response.name,
      permissions: [...role.response.includedPermissions].sort(),
      permissionsComplete: role.response.permissionsComplete === true,
      deleted: role.response.deleted === true,
      stage: role.response.stage,
    };
    if (stableStringify(normalized) !==
        stableStringify(REVIEWED_IAM_ROLE_DEFINITIONS.find(
            (item) => item.role === roleName,
        ))) {
      fail("IAM_ROLE_DEFINITION_MISMATCH");
    }
    roleDefinitions.push(normalized);
  }
  const roleEnd = await execute(session, roleListInput);
  if (roleStart.transportExecutionId === roleEnd.transportExecutionId ||
      stableStringify(roleStart.records) !==
        stableStringify(roleEnd.records)) {
    fail("IAM_ROLE_LIST_UNSTABLE");
  }
  const approvedPrincipals = session.approvalReceipt.iamPrincipalAllowlist;
  const serviceAccountEmails = [...new Set([
    ...approvedPrincipals.map(({member}) => memberEmail(member)),
    ...functions.records.map(({runtimeServiceAccount}) =>
      memberEmail(runtimeServiceAccount)),
  ])].sort();
  addLineage(session, "approved_service_account_email", serviceAccountEmails);
  const accountListInput = {
    operationId: "iam.v1.projects.serviceAccounts.list",
    pathParams: {projectId: EXPECTED_PROJECT_ID},
    query: {pageSize: 100},
  };
  const accountStart = await execute(session, accountListInput);
  const observedEmails = accountStart.records.map(({email}) => email);
  exactSet(
      observedEmails,
      serviceAccountEmails,
      "SERVICE_ACCOUNT_LIST_EXACT_SET_MISMATCH",
  );
  for (const listed of accountStart.records) {
    if (listed.name !==
        `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/${listed.email}`) {
      fail("SERVICE_ACCOUNT_LIST_RESOURCE_NAME_MISMATCH");
    }
  }
  const accountSnapshots = [];
  for (const email of [...observedEmails].sort()) {
    const account = await execute(session, {
      operationId: "iam.v1.projects.serviceAccounts.get",
      pathParams: {projectId: EXPECTED_PROJECT_ID, serviceAccount: email},
    });
    if (account.response.name !==
          `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/${email}` ||
        account.response.email !== email ||
        account.response.projectId !== EXPECTED_PROJECT_ID) {
      fail("SERVICE_ACCOUNT_IDENTITY_MISMATCH");
    }
    const accountPolicy = await execute(session, {
      operationId: "iam.v1.projects.serviceAccounts.getIamPolicy",
      pathParams: {projectId: EXPECTED_PROJECT_ID, serviceAccount: email},
      body: {options: {requestedPolicyVersion: 3}},
    });
    if ((accountPolicy.response.bindings ?? []).length !== 0) {
      fail("SERVICE_ACCOUNT_IMPERSONATION_BINDING_REJECTED");
    }
    accountSnapshots.push({
      email,
      account: account.response,
      policy: accountPolicy.response,
    });
  }
  const accountEnd = await execute(session, accountListInput);
  exactSet(
      accountEnd.records.map(({email}) => email),
      serviceAccountEmails,
      "SERVICE_ACCOUNT_END_LIST_EXACT_SET_MISMATCH",
  );
  for (const listed of accountEnd.records) {
    if (listed.name !==
        `projects/${EXPECTED_PROJECT_ID}/serviceAccounts/${listed.email}`) {
      fail("SERVICE_ACCOUNT_END_LIST_RESOURCE_NAME_MISMATCH");
    }
  }
  if (stableStringify(accountStart.records) !==
        stableStringify(accountEnd.records)) {
    fail("SERVICE_ACCOUNT_LIST_UNSTABLE");
  }
  const projectFullResource =
    `//cloudresourcemanager.googleapis.com/projects/${EXPECTED_PROJECT_ID}`;
  addLineage(session, "approved_permission_set",
      [...REVIEWED_PERMISSION_UNIVERSE]);
  addLineage(session, "approved_permission",
      [...REVIEWED_PERMISSION_UNIVERSE]);
  addLineage(session, "approved_principal",
      [
        ...approvedPrincipals.map(({member}) => member),
        ...KNOWN_IAM_GROUPS,
      ]);
  addLineage(session, "approved_resource_name", [projectFullResource]);
  addLineage(session, "approved_or_discovered_target_resource",
      [projectFullResource]);
  addLineage(session, "approved_reviewed_permission",
      [...REVIEWED_PERMISSION_UNIVERSE]);
  addLineage(session, "approved_iam_principal_or_group", [
    ...approvedPrincipals.map(({member}) => member),
    ...KNOWN_IAM_GROUPS,
  ]);
  const groupExpansions = new Map();
  const roleByName = new Map(roleDefinitions.map((role) => [role.role, role]));
  for (const principal of approvedPrincipals) {
    const analysis = await execute(session, {
      operationId: "cloudasset.v1.projects.analyzeIamPolicy",
      pathParams: {projectNumber: EXPECTED_PROJECT_NUMBER},
      query: {
        "analysisQuery.accessSelector.permissions":
          [...REVIEWED_PERMISSION_UNIVERSE],
        "analysisQuery.identitySelector.identity": principal.member,
        "analysisQuery.resourceSelector.fullResourceName": projectFullResource,
        executionTimeout: "90s",
        "options.expandGroups": true,
        "options.expandResources": true,
        "options.expandRoles": true,
        "options.outputGroupEdges": true,
        "options.outputResourceEdges": true,
      },
    });
    const analysisResults = normalizeAnalysisResults(
        analysis.response,
        principal.member,
        "PRINCIPAL",
    );
    const expectedResults = bindings
        .filter(({member}) => member === principal.member)
        .map((binding) => ({
          identity: principal.member,
          resource: projectFullResource,
          role: binding.role,
          permissions: [...(roleByName.get(binding.role)?.permissions ?? [])]
              .sort(),
          condition: binding.condition,
        }));
    if (stableStringify(analysisResults) !==
        stableStringify(expectedResults)) {
      fail("CLOUD_ASSET_PERMISSION_OR_CONDITION_CONTRADICTION");
    }
    if (analysis.response.mainAnalysis.groupEdges.length !== 0) {
      fail("PRINCIPAL_ANALYSIS_UNEXPECTED_GROUP_EDGE");
    }
    for (const edge of analysis.response.mainAnalysis.groupEdges) {
      const expansion = groupExpansions.get(edge.sourceNode) ?? {
        group: edge.sourceNode,
        complete: true,
        members: [],
        paths: [],
      };
      if (!expansion.members.includes(edge.targetNode)) {
        expansion.members.push(edge.targetNode);
        expansion.paths.push({
          member: edge.targetNode,
          path: [edge.sourceNode, edge.targetNode],
        });
      }
      groupExpansions.set(edge.sourceNode, expansion);
    }
  }
  const approvedExpansionIdentities = [...new Set([
    ...KNOWN_IAM_GROUPS,
    ...bindings.map(({member}) => member)
        .filter((member) => /^(?:group|domain):/.test(member)),
  ])].sort();
  for (const identity of approvedExpansionIdentities) {
    if (!KNOWN_IAM_GROUPS.includes(identity)) {
      fail("UNAPPROVED_GROUP_OR_DOMAIN_IDENTITY");
    }
    const analysis = await execute(session, {
      operationId: "cloudasset.v1.projects.analyzeIamPolicy",
      pathParams: {projectNumber: EXPECTED_PROJECT_NUMBER},
      query: {
        "analysisQuery.accessSelector.permissions":
          [...REVIEWED_PERMISSION_UNIVERSE],
        "analysisQuery.identitySelector.identity": identity,
        "analysisQuery.resourceSelector.fullResourceName": projectFullResource,
        executionTimeout: "90s",
        "options.expandGroups": true,
        "options.expandResources": true,
        "options.expandRoles": true,
        "options.outputGroupEdges": true,
        "options.outputResourceEdges": true,
      },
    });
    const analysisResults =
      normalizeAnalysisResults(analysis.response, identity, "GROUP");
    const expectedResults = bindings
        .filter(({member}) => member === identity)
        .map((binding) => ({
          identity,
          resource: projectFullResource,
          role: binding.role,
          permissions: [...(roleByName.get(binding.role)?.permissions ?? [])]
              .sort(),
          condition: binding.condition,
        }));
    if (stableStringify(analysisResults) !== stableStringify(expectedResults)) {
      fail("GROUP_PERMISSION_OR_CONDITION_CONTRADICTION");
    }
    const expansion = {
      group: identity,
      complete: analysis.response.fullyExplored === true,
      members: [],
      paths: [],
    };
    for (const edge of analysis.response.mainAnalysis.groupEdges) {
      assertRecord(edge, ["sourceNode", "targetNode"], "GROUP_EDGE");
      if (edge.sourceNode !== identity ||
          typeof edge.targetNode !== "string" ||
          !edge.targetNode) {
        fail("GROUP_EDGE_IDENTITY_MISMATCH");
      }
      if (!expansion.members.includes(edge.targetNode)) {
        expansion.members.push(edge.targetNode);
        expansion.paths.push({
          member: edge.targetNode,
          path: [identity, edge.targetNode],
        });
      }
    }
    groupExpansions.set(identity, expansion);
  }
  const attachmentPoints = resources.map(({kind, id}) =>
    `cloudresourcemanager.googleapis.com/${kind}/${id}`);
  addLineage(session, "discovered_parent_lineage", attachmentPoints);
  const denyPolicies = [];
  for (const attachmentPoint of attachmentPoints) {
    const list = await execute(session, {
      operationId: "iam.v2.policies.denypolicies.list",
      pathParams: {attachmentPoint},
      query: {pageSize: 100},
    });
    for (const listed of list.records) {
      const policyId = idFromName(
          listed.name,
          /^policies\/.+\/denypolicies\/([^/]+)$/,
          "DENY_POLICY_NAME_REJECTED",
      );
      addLineage(session, "discovered_deny_policy_id", [policyId]);
      const policy = await execute(session, {
        operationId: "iam.v2.policies.denypolicies.get",
        pathParams: {attachmentPoint, policyId},
      });
      if (policy.response.name !== listed.name) {
        fail("DENY_POLICY_LINEAGE_MISMATCH");
      }
      denyPolicies.push({
        attachmentPoint: `${resources[attachmentPoints.indexOf(
            attachmentPoint,
        )].kind}/${resources[attachmentPoints.indexOf(attachmentPoint)].id}`,
        policyName: policy.response.name,
        updateTime: policy.response.updateTime,
        rules: (policy.response.rules ?? []).map((rule) => ({
          condition: normalizeCondition(rule.denialCondition),
          deniedPermissions: [...(rule.deniedPermissions ?? [])],
          deniedPrincipals: [...(rule.deniedPrincipals ?? [])],
          exceptionPermissions: [...(rule.exceptionPermissions ?? [])],
          exceptionPrincipals: [...(rule.exceptionPrincipals ?? [])],
        })),
      });
    }
  }
  if (denyPolicies.length !== 0) {
    fail("MOCK_DENY_POLICY_EVALUATION_UNSUPPORTED");
  }
  for (const serviceName of [
    "cloudasset.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
  ]) {
    addLineage(session, "approved_service_usage_service", [serviceName]);
    const service = await execute(session, {
      operationId: "serviceusage.v1.projects.services.get",
      pathParams: {
        projectNumber: EXPECTED_PROJECT_NUMBER,
        serviceName,
      },
    });
    if (service.response.name !==
          `projects/${EXPECTED_PROJECT_NUMBER}/services/${serviceName}` ||
        service.response.state !== "ENABLED") {
      fail("REQUIRED_SERVICE_USAGE_DISABLED");
    }
  }
  const effectiveByMember = new Map();
  for (const binding of bindings) {
    if (binding.condition !== null) fail("IAM_CONDITION_REJECTED");
    const role = roleByName.get(binding.role);
    if (!role) fail("IAM_UNKNOWN_ROLE_REJECTED");
    if (role.permissions.some((permission) =>
      REVIEWED_WRITABLE_PERMISSIONS.includes(permission))) {
      fail("IAM_WRITABLE_BINDING_REJECTED");
    }
    const current = effectiveByMember.get(binding.member) ?? new Set();
    role.permissions.forEach((permission) => current.add(permission));
    effectiveByMember.set(binding.member, current);
  }
  const principals = approvedPrincipals.map((principal) => {
    const observedPermissions =
      [...(effectiveByMember.get(principal.member) ?? [])].sort();
    if (principal.disposition === "ACTIVE_READ_ONLY") {
      exactSet(observedPermissions, principal.effectivePermissions,
          "IAM_EFFECTIVE_PERMISSION_MISMATCH");
    } else if (observedPermissions.length !== 0) {
      fail("IAM_INACTIVE_PRINCIPAL_BOUND");
    }
    const snapshot = {
      id: principal.id,
      member: principal.member,
      semanticRole: principal.semanticRole,
      disposition: principal.disposition,
      effectivePermissions: [...principal.effectivePermissions],
      authPermissions: [...principal.authPermissions],
    };
    return {...snapshot, snapshotDigest: sha256Canonical(snapshot)};
  });
  const runtimeServiceAccounts = functions.records.map((item) => ({
    functionName: item.name,
    member: item.runtimeServiceAccount,
  }));
  const permissionUniverse = [...REVIEWED_PERMISSION_UNIVERSE];
  const iamPolicy = {
    observedAt: session.completed.at(-1),
    bindings,
    conditionEvaluations: [],
    denyPolicies,
    denyEvaluations: [],
    groupExpansions: [...groupExpansions.values()],
    impersonationEvidence: [],
    runtimeServiceAccounts,
    roleDefinitions,
    permissionUniverse,
    writablePermissionDerivation: {
      schemaVersion: WRITABLE_PERMISSION_DERIVATION_VERSION,
      permissionUniverseDigest:
        sha256Canonical([...permissionUniverse].sort()),
      writablePermissions: permissionUniverse.filter((permission) =>
        REVIEWED_WRITABLE_PERMISSIONS.includes(permission)),
      readOnlyPermissions: permissionUniverse.filter((permission) =>
        !REVIEWED_WRITABLE_PERMISSIONS.includes(permission)),
    },
    principals,
    policyDigest: "",
    completeness: null,
    familyCompleteness: null,
  };
  iamPolicy.policyDigest = computeIamPolicyDigest(iamPolicy);
  iamPolicy.familyCompleteness = buildIamFamilyCompleteness(
      iamPolicy,
      session.approvalReceipt.resources.iamExpectedState,
  );
  const approvedState =
    session.approvalReceipt.resources.iamExpectedState;
  if (iamPolicy.policyDigest !== approvedState.policyDigest ||
      iamPolicy.familyCompleteness.families.some((family) => {
        const approved = approvedState.families.find(
            ({name}) => name === family.name,
        );
        return !approved ||
          family.observedCount !== approved.expectedCount ||
          family.digest !== approved.digest;
      })) {
    fail("IAM_PASS_DIFFERS_FROM_APPROVED_EXPECTED_STATE");
  }
  const observedItems = IAM_EVIDENCE_FAMILY_NAMES.flatMap((family) =>
    iamPolicy[family].map((value) => ({family, value})));
  const iamTrace = session.trace.slice(startTraceIndex);
  const pseudoStart = {
    observedAtEpochMs: Date.parse(session.started[startTraceIndex]),
  };
  const pseudoEnd = {
    completedAtEpochMs: Date.parse(session.completed.at(-1)),
  };
  iamPolicy.completeness = completeness(
      observedItems,
      pseudoStart,
      pseudoEnd,
      observedItems.length,
      iamTrace.reduce((total, item) => total + item.pageCount, 0),
  );
  iamPolicy.observedAt = iamPolicy.completeness.scanCompletedAt;
  return {
    iamPolicy,
    firstResult: project,
    finalResult: pseudoEnd,
    acquisitionSnapshot: {
      accounts: accountSnapshots,
      resources,
    },
  };
}

async function observeIam(session, functions) {
  const startTraceIndex = session.trace.length;
  const start = await observeIamPass(session, functions);
  const end = await observeIamPass(session, functions);
  for (const family of IAM_EVIDENCE_FAMILY_NAMES) {
    if (stableStringify(start.iamPolicy[family]) !==
        stableStringify(end.iamPolicy[family])) {
      fail(`IAM_FAMILY_UNSTABLE_${family.toUpperCase()}`);
    }
  }
  if (start.iamPolicy.policyDigest !== end.iamPolicy.policyDigest ||
      stableStringify(start.acquisitionSnapshot) !==
        stableStringify(end.acquisitionSnapshot)) {
    fail("IAM_FULL_OBSERVATION_UNSTABLE");
  }
  const iamPolicy = start.iamPolicy;
  const observedItems = IAM_EVIDENCE_FAMILY_NAMES.flatMap((family) =>
    iamPolicy[family].map((value) => ({family, value})));
  const iamTrace = session.trace.slice(startTraceIndex);
  iamPolicy.completeness = completeness(
      observedItems,
      start.firstResult,
      end.finalResult,
      observedItems.length,
      iamTrace.reduce((total, item) => total + item.pageCount, 0),
  );
  iamPolicy.observedAt = iamPolicy.completeness.scanCompletedAt;
  return iamPolicy;
}

async function observeScheduler(session) {
  const listInput = {
    operationId: "cloudscheduler.v1.projects.locations.jobs.list",
    pathParams: {...projectPath},
    query: {pageSize: 500},
  };
  const expectedNames = SCHEDULER_JOB_ALLOWLIST.map(({name}) => name);
  const observeBoundary = async () => {
    const list = await execute(session, listInput);
    const names = list.records.map(({name}) => idFromName(
        name,
        /^projects\/daegu-miami-production\/locations\/us-central1\/jobs\/([^/]+)$/,
        "SCHEDULER_JOB_NAME_REJECTED",
    ));
    exactSet(names, expectedNames, "SCHEDULER_JOB_LIST_MISMATCH");
    addLineage(session, "approved_scheduler_job_id", names);
    const jobs = [];
    const snapshots = [];
    for (const jobId of [...names].sort()) {
      const result = await execute(session, {
        operationId: "cloudscheduler.v1.projects.locations.jobs.get",
        pathParams: {...projectPath, jobId},
      });
      const expected = SCHEDULER_JOB_ALLOWLIST.find(({name}) => name === jobId);
      const expectedFullName =
        `projects/${EXPECTED_PROJECT_ID}/locations/${EXPECTED_FUNCTION_REGION}` +
        `/jobs/${jobId}`;
      if (result.response.name !== expectedFullName) {
        fail("SCHEDULER_JOB_RESOURCE_NAME_MISMATCH");
      }
      const observedTarget = result.response.httpTarget?.uri ??
        result.response.pubsubTarget?.topicName ??
        result.response.appEngineHttpTarget?.relativeUri;
      const job = {
        name: jobId,
        projectId: EXPECTED_PROJECT_ID,
        region: EXPECTED_FUNCTION_REGION,
        target: observedTarget,
        state: result.response.state,
        updateTime: result.response.updateTime,
      };
      if (job.target !== expected.target || job.state !== "DISABLED") {
        fail("SCHEDULER_JOB_STATE_OR_TARGET_MISMATCH");
      }
      jobs.push(job);
      snapshots.push({listRecord: list.records.find(
        ({name}) => name.endsWith(`/jobs/${jobId}`),
      ), get: result.response});
    }
    return {list, jobs, snapshots};
  };
  const startTraceIndex = session.trace.length;
  const start = await observeBoundary();
  const end = await observeBoundary();
  if (start.list.transportExecutionId === end.list.transportExecutionId ||
      stableStringify(start.snapshots) !== stableStringify(end.snapshots)) {
    fail("SCHEDULER_FULL_SNAPSHOT_UNSTABLE");
  }
  const schedulerTrace = session.trace.slice(startTraceIndex);
  return {
    jobs: start.jobs,
    completeness: completeness(
        start.jobs,
        start.list,
        end.list,
        SCHEDULER_JOB_ALLOWLIST.length,
        schedulerTrace.reduce((total, item) => total + item.pageCount, 0),
    ),
  };
}

async function observeDeployment(adapter) {
  const session = getSession(adapter);
  if (session.used) fail("ADAPTER_SESSION_ALREADY_OBSERVED");
  session.used = true;
  const rules = await observeRules(session);
  const functions = await observeFunctions(session);
  const scheduler = await observeScheduler(session);
  const iamPolicy = await observeIam(session, functions);
  const executedOperationIds =
    [...new Set(session.trace.map(({operationId}) => operationId))].sort();
  if (executedOperationIds.some((operationId) => !operationSet.has(operationId))) {
    fail("UNKNOWN_EXECUTED_OPERATION");
  }
  const executionTraceDigest = sha256Canonical(session.trace);
  const mutationOperationCount = session.mutationOperationCount;
  if (mutationOperationCount !== 0) {
    fail("MUTATION_OPERATION_EXECUTED");
  }
  const scanStartedAt = session.started[0];
  const scanCompletedAt = session.completed.at(-1);
  const reviewedSourceDigest =
    computeProviderAdapterReviewedSourceIdentityDigest(
        session.reviewedSourceIdentities,
    );
  const approval = session.approvalReceipt.providerDependencyApproval;
  if (approval.reviewedSourceDigest !== reviewedSourceDigest) {
    fail("REVIEWED_SOURCE_APPROVAL_MISMATCH");
  }
  const adapterMetadata = {
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
    mockOnly: true,
    actualMutations: mutationOperationCount,
    mutationOperationCount,
    unknownOperationCount: 0,
    providerOperationAllowlistVersion:
      PROVIDER_OPERATION_ALLOWLIST_VERSION,
    providerOperationDescriptorSetDigest:
      PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
    executedOperationIds,
    executedOperationCount: executedOperationIds.length,
    executionTraceCount: session.trace.length,
    executionTraceDigest,
    reviewedSourceDigest,
    reviewedSourceRepositoryRootDigest:
      session.runtimeSources.repositoryRootDigest,
    reviewedSourceIdentities:
      session.reviewedSourceIdentities.map((identity) => ({...identity})),
  };
  const observation = {
    schemaVersion: PROVIDER_OBSERVATION_VERSION,
    providerObservationVersion: PROVIDER_OBSERVATION_VERSION,
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
    mockOnly: true,
    actualMutations: mutationOperationCount,
    mutationOperationCount,
    unknownOperationCount: 0,
    scanStartedAt,
    scanCompletedAt,
    observedAt: scanCompletedAt,
    projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
    projectId: EXPECTED_PROJECT_ID,
    projectNumber: EXPECTED_PROJECT_NUMBER,
    providerAdapterMetadata: {
      ...PROVIDER_ADAPTER_METADATA,
    },
    adapterMetadata,
    dependencyContract: {
      ...PROVIDER_ADAPTER_METADATA,
      reviewedSourceIdentities:
        session.reviewedSourceIdentities.map((identity) => ({...identity})),
      schemaVersion: PROVIDER_DEPENDENCY_CONTRACT_VERSION,
      strategy: "declared_google_auth_library_rest",
      module: "google-auth-library",
      directDependencyReviewed: true,
      publicApiOnly: true,
      reviewedSourceDigest,
      reviewedSourceRepositoryRootDigest:
        session.runtimeSources.repositoryRootDigest,
      reviewedLockDigest: approval.reviewedLockDigest,
      approvalLineageDigest: sha256Canonical(session.approvalReceipt),
    },
    operationExecution: {
      providerOperationAllowlistVersion:
        PROVIDER_OPERATION_ALLOWLIST_VERSION,
      providerOperationDescriptorSetDigest:
        PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
      reviewedSourceRepositoryRootDigest:
        session.runtimeSources.repositoryRootDigest,
      executedOperationIds,
      executedOperationCount: executedOperationIds.length,
      executionTrace: session.trace.map((item) => ({...item})),
      executionTraceCount: session.trace.length,
      executionTraceDigest,
      unknownOperationCount: 0,
      actualMutations: mutationOperationCount,
      mutationOperationCount,
    },
    rules,
    functions,
    iamPolicy,
    scheduler,
  };
  const providerResult = deepFreeze({
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
    approvalReceipt: session.approvalReceipt,
    metadata: adapterMetadata,
    observation,
  });
  genuineProviderResults.set(providerResult, adapter);
  return providerResult;
}

function assertReviewedSourceBinding(reviewedSources, session, label) {
  if (!reviewedSources || typeof reviewedSources !== "object" ||
      reviewedSources.repositoryRoot !==
        session.runtimeSources.repositoryRoot ||
      reviewedSources.repositoryRootDigest !==
        session.runtimeSources.repositoryRootDigest ||
      reviewedSources.aggregateDigest !==
        session.runtimeSources.aggregateDigest ||
      stableStringify(reviewedSources.identities) !==
        stableStringify(session.runtimeSources.identities)) {
    fail(`${label}_REVIEWED_SOURCE_ROOT_MISMATCH`);
  }
}

export function assertGenuineMockAcademyResetFreezeProviderAdapter(
    adapter,
    reviewedSources,
) {
  if (!genuineAdapters.has(adapter)) {
    fail("GENUINE_MOCK_PROVIDER_ADAPTER_REQUIRED");
  }
  assertReviewedSourceBinding(
      reviewedSources,
      getSession(adapter),
      "ADAPTER",
  );
  return true;
}

export function assertGenuineMockAcademyResetFreezeProviderResult(
    providerResult,
    reviewedSources,
    providerAdapter,
) {
  const originatingAdapter = genuineProviderResults.get(providerResult);
  if (!originatingAdapter ||
      (providerAdapter !== undefined && originatingAdapter !== providerAdapter)) {
    fail("GENUINE_MOCK_PROVIDER_RESULT_REQUIRED");
  }
  if (providerResult.metadata.reviewedSourceRepositoryRootDigest !==
      reviewedSources?.repositoryRootDigest ||
      providerResult.metadata.reviewedSourceDigest !==
        reviewedSources?.aggregateDigest ||
      stableStringify(providerResult.metadata.reviewedSourceIdentities) !==
        stableStringify(reviewedSources?.identities)) {
    fail("PROVIDER_RESULT_REVIEWED_SOURCE_ROOT_MISMATCH");
  }
  return true;
}

export function createMockAcademyResetFreezeProviderAdapter(options) {
  assertRecord(options, FACTORY_KEYS, "ADAPTER_FACTORY");
  assertDeepFrozen(options, "ADAPTER_FACTORY");
  try {
    assertMockProviderTransportExecutor(
        options.transportExecutor,
        options.approvalReceipt,
    );
  } catch {
    fail("GENUINE_MOCK_TRANSPORT_EXECUTOR_REQUIRED");
  }
  if (typeof options.transportExecutor !== "function" ||
      options.transportExecutor.metadata?.mockOnly !== true ||
      options.transportExecutor.metadata?.sessionReceipt === undefined ||
      stableStringify(options.transportExecutor.metadata.sessionReceipt) !==
        stableStringify(options.approvalReceipt) ||
      options.transportExecutor.metadata.providerOperationAllowlistVersion !==
        PROVIDER_OPERATION_ALLOWLIST_VERSION ||
      options.transportExecutor.metadata.providerOperationDescriptorSetDigest !==
        PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST ||
      options.transportExecutor.metadata.providerAdapterContractVersion !==
        PROVIDER_ADAPTER_CONTRACT_VERSION) {
    fail("MOCK_TRANSPORT_SESSION_RECEIPT_MISMATCH");
  }
  if (options.approvalReceipt.projectId !== EXPECTED_PROJECT_ID ||
      options.approvalReceipt.projectNumber !== EXPECTED_PROJECT_NUMBER ||
      options.approvalReceipt.providerDependencyApproval
          ?.providerOperationAllowlistVersion !==
        PROVIDER_OPERATION_ALLOWLIST_VERSION ||
      options.approvalReceipt.providerDependencyApproval
          ?.providerOperationDescriptorSetDigest !==
        PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST ||
      options.approvalReceipt.providerDependencyApproval
          ?.providerAdapterContractVersion !==
        PROVIDER_ADAPTER_CONTRACT_VERSION) {
    fail("APPROVAL_RECEIPT_OPERATION_CONTRACT_MISMATCH");
  }
  computeProviderAdapterReviewedSourceIdentityDigest(
      options.reviewedSourceIdentities,
  );
  const runtimeSources =
    validateProviderAdapterReviewedSources(options.repositoryRoot);
  if (stableStringify(options.reviewedSourceIdentities) !==
        stableStringify(PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES) ||
      stableStringify(runtimeSources.identities) !==
        stableStringify(PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES) ||
      computeProviderAdapterReviewedSourceIdentityDigest(
          options.reviewedSourceIdentities,
      ) !== EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST ||
      runtimeSources.aggregateDigest !==
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST ||
      options.approvalReceipt.providerDependencyApproval
          ?.reviewedSourceRepositoryRootDigest !==
        runtimeSources.repositoryRootDigest) {
    fail("REVIEWED_SOURCE_IDENTITIES_MISMATCH");
  }
  let adapter;
  adapter = {
    adapterId: APPROVED_PROVIDER_ADAPTER_ID,
    adapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
    mockOnly: true,
    observeDeployment: () => observeDeployment(adapter),
  };
  adapter = Object.freeze(adapter);
  genuineAdapters.add(adapter);
  adapterSessions.set(adapter, {
    approvalReceipt: options.approvalReceipt,
    reviewedSourceIdentities: options.reviewedSourceIdentities,
    runtimeSources,
    transportExecutor: options.transportExecutor,
    lineage: new Map(),
    trace: [],
    started: [],
    completed: [],
    mutationOperationCount: 0,
    used: false,
  });
  return adapter;
}
