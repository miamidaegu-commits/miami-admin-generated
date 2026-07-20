import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath, pathToFileURL} from "node:url";
import {GoogleAuth} from "google-auth-library";
import {
  PROVIDER_AUTH_DEPENDENCY,
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  PROVIDER_APPROVED_LOCATION,
  PROVIDER_HTTP_RUNTIME,
  PROVIDER_MANDATORY_OPERATION_COUNT,
  PROVIDER_MANDATORY_OPERATION_IDS,
  PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
  PROVIDER_NO_MUTATION_OPERATION_COUNT,
  PROVIDER_OPERATION_ALLOWLIST_VERSION,
  PROVIDER_OPERATION_CLASSIFICATION,
  PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
  PROVIDER_OPERATION_CLASSIFICATION_VERSION,
  PROVIDER_OPERATION_COUNT,
  PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
  PROVIDER_TARGET_PROJECT_ID,
  PROVIDER_TARGET_PROJECT_NUMBER,
  PROVIDER_TRANSPORT,
  assertProviderOperationClassification,
  assertProviderOperationRegistry,
  assertProviderPathParameters,
  assertProviderRequestBody,
  getProviderOperationDescriptor,
} from "./academy-reset-freeze-provider-operations.mjs";
import {
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT,
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
  OFFICIAL_EVIDENCE_SET_DIGEST,
  OBSERVER_PRINCIPAL_POLICY,
  PERMISSION_RESEARCH_ARTIFACT_SHA256,
  PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
  READONLY_PERMISSION_MANIFEST_DIGEST,
  READONLY_PERMISSION_MANIFEST_VERSION,
  REVIEWED_EVIDENCE_SET_DIGEST,
  EVIDENCE_DERIVED_NOT_APPLICABLE_MANDATORY_OPERATION_IDS,
  STANDALONE_NOT_APPLICABLE_MANDATORY_OPERATION_IDS,
  STANDALONE_PROJECT_OBSERVER_PROFILE,
  STANDALONE_SOURCE_BUCKET_NAME,
  assertEffectiveMandatoryPermissionContract,
  assertObserverPrincipalPolicy,
  assertReadonlyPermissionManifest,
  assertStandaloneProjectObserverProfile,
  deriveStandaloneProjectObserverProfile,
} from "./academy-reset-freeze-readonly-permissions.mjs";
import {
  EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
} from "./academy-reset-freeze-provider-reviewed-sources.mjs";
import {
  BUILD_SCOPE_CONTRACT_DIGEST,
  BUILD_SCOPE_CONTRACT_VERSION,
  COMPENSATING_CONTROL_DIGEST,
  COMPENSATING_CONTROL_VERSION,
  DEPLOY_PROFILE_DIGEST,
  DEPLOY_PROFILE_VERSION,
  ORGANIZATION_POLICY_EVIDENCE,
} from "./academy-functions-build-scope-contract.mjs";
import {
  PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
  PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
} from "./academy-private-runtime-iam-contract.mjs";
import {
  resolveRuntimeGitSourceIdentity,
  validateProviderAdapterReviewedSources,
} from "./academy-reset-freeze-runtime-identity.mjs";
import {
  EXPECTED_DEPLOYED_FUNCTION_NAMES,
  EXPECTED_FUNCTION_GENERATION,
  EXPECTED_FUNCTION_REGION,
  EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
  FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST,
  FUNCTION_HTTP_TRIGGER_CONTRACT_ID,
  FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION,
  FUNCTION_HTTP_TRIGGER_TYPE,
  KNOWN_IAM_GROUPS,
  REVIEWED_IAM_ROLE_DEFINITIONS,
  REVIEWED_PERMISSION_UNIVERSE,
  REVIEWED_WRITABLE_PERMISSIONS,
  SCHEDULER_JOB_ALLOWLIST,
  assertHttpCallableRawFunctionRecord,
  buildFunctionTriggerAbsenceEvidence,
  validateFunctionTriggerAbsenceEvidence,
} from "./academy-reset-write-freeze-contract.mjs";

export const GOOGLE_PROVIDER_READ_ONLY_SCOPE =
  "https://www.googleapis.com/auth/cloud-platform.read-only";
export const PROVIDER_TRANSPORT_MAX_PAGES = 100;
export const PROVIDER_TRANSPORT_MAX_RECORDS = 10000;
export const MOCK_TRANSPORT_SESSION_VERSION =
  "academy_reset_transport_mock_session.v1";

const EXECUTION_KEYS = Object.freeze([
  "body",
  "operationId",
  "pathParams",
  "query",
]);
const REQUIRED_EXECUTION_KEYS = Object.freeze([
  "operationId",
  "pathParams",
]);
const MOCK_FACTORY_KEYS = Object.freeze([
  "authHeaderProvider",
  "fetchImpl",
  "now",
  "randomId",
  "receipt",
  "sessionReceipt",
  "sleep",
  "timeoutSignalProvider",
]);
const REQUIRED_MOCK_FACTORY_KEYS = Object.freeze(
    MOCK_FACTORY_KEYS.filter((key) => key !== "sessionReceipt"),
);
const MOCK_RECEIPT_KEYS = Object.freeze([
  "approvedLocation",
  "lineageBindings",
  "lineageDigest",
  "mockOnly",
  "schemaVersion",
  "targetProjectId",
  "targetProjectNumber",
]);
const TRANSIENT_NETWORK_CODES = new Set([
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "ENETUNREACH",
  "ETIMEDOUT",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
]);
const TRANSIENT_NETWORK_NAMES = new Set([
  "AbortError",
  "TimeoutError",
]);
const RETRY_BACKOFF_MILLISECONDS = Object.freeze([100, 200, 400]);
const RESERVED_PARTIAL_FIELDS = new Set([
  "fullyExplored",
  "incomplete",
  "nonCriticalErrors",
  "partial",
  "partialSuccess",
  "truncated",
  "unreachable",
]);
const executorSessions = new WeakMap();
const genuineProductionExecutors = new WeakSet();
const genuineProductionPreflightContexts = new WeakSet();
const genuineRawProductionResults = new WeakMap();
const genuineInjectedMockObservations = new WeakSet();
const injectedMockRawIamStates = new WeakSet();
const injectedMockRawIamExecutors = new WeakSet();
const capturedNativeFetch = globalThis.fetch?.bind(globalThis);

export class ProviderTransportError extends Error {
  constructor(code, status = undefined) {
    super(code);
    this.name = "ProviderTransportError";
    this.code = code;
    if (status !== undefined) this.status = status;
  }
}

function fail(code, status) {
  throw new ProviderTransportError(code, status);
}

function assertRecord(value, label, {allowNullPrototype = true} = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail(`${label}_MUST_BE_EXACT_RECORD`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype &&
      !(allowNullPrototype && prototype === null)) {
    fail(`${label}_MUST_BE_EXACT_RECORD`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    fail(`${label}_MUST_HAVE_STRING_KEYS`);
  }
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) {
      fail(`${label}_MUST_HAVE_ENUMERABLE_DATA_PROPERTIES`);
    }
  }
  return keys;
}

function assertExactOrSubsetKeys(
    value,
    allowedKeys,
    requiredKeys,
    label,
) {
  const keys = assertRecord(value, label);
  if (keys.some((key) => !allowedKeys.includes(key)) ||
      requiredKeys.some((key) => !Object.hasOwn(value, key))) {
    fail(`${label}_KEYSET_REJECTED`);
  }
  return keys;
}

function assertStandardArray(value, label) {
  if (!Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label}_MUST_BE_STANDARD_ARRAY`);
  }
  const keys = Reflect.ownKeys(value);
  const expected = [
    ...Array.from({length: value.length}, (_, index) => String(index)),
    "length",
  ].sort();
  if (keys.some((key) => typeof key !== "string") ||
      JSON.stringify([...keys].sort()) !== JSON.stringify(expected)) {
    fail(`${label}_MUST_BE_DENSE_ARRAY`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const property = Object.getOwnPropertyDescriptor(value, String(index));
    if (!property?.enumerable || !Object.hasOwn(property, "value")) {
      fail(`${label}_MUST_HAVE_DATA_ITEMS`);
    }
  }
}

function assertDeepFrozen(value, label) {
  if (!value || typeof value !== "object") return;
  if (!Object.isFrozen(value)) fail(`${label}_MUST_BE_DEEP_FROZEN`);
  for (const key of Reflect.ownKeys(value)) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (property && Object.hasOwn(property, "value")) {
      assertDeepFrozen(property.value, `${label}_${String(key)}`);
    }
  }
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

export function computeMockTransportLineageDigest(receipt) {
  assertExactOrSubsetKeys(
      receipt,
      MOCK_RECEIPT_KEYS,
      MOCK_RECEIPT_KEYS,
      "MOCK_RECEIPT",
  );
  return crypto.createHash("sha256").update(canonical({
    approvedLocation: receipt.approvedLocation,
    lineageBindings: receipt.lineageBindings,
    mockOnly: receipt.mockOnly,
    schemaVersion: receipt.schemaVersion,
    targetProjectId: receipt.targetProjectId,
    targetProjectNumber: receipt.targetProjectNumber,
  })).digest("hex");
}

function validateMockReceipt(receipt) {
  assertDeepFrozen(receipt, "MOCK_RECEIPT");
  assertExactOrSubsetKeys(
      receipt,
      MOCK_RECEIPT_KEYS,
      MOCK_RECEIPT_KEYS,
      "MOCK_RECEIPT",
  );
  if (receipt.schemaVersion !== MOCK_TRANSPORT_SESSION_VERSION ||
      receipt.mockOnly !== true ||
      receipt.targetProjectId !== PROVIDER_TARGET_PROJECT_ID ||
      receipt.targetProjectNumber !== PROVIDER_TARGET_PROJECT_NUMBER ||
      receipt.approvedLocation !== PROVIDER_APPROVED_LOCATION) {
    fail("MOCK_RECEIPT_TARGET_REJECTED");
  }
  const keys = assertRecord(receipt.lineageBindings, "MOCK_LINEAGE");
  for (const key of keys) {
    if (!/^(?:approved_|discovered_)/.test(key)) {
      fail("MOCK_LINEAGE_KEY_REJECTED");
    }
    assertStandardArray(receipt.lineageBindings[key], `MOCK_LINEAGE_${key}`);
    for (const value of receipt.lineageBindings[key]) {
      if (typeof value !== "string") fail("MOCK_LINEAGE_VALUE_REJECTED");
    }
  }
  if (!/^[0-9a-f]{64}$/.test(receipt.lineageDigest) ||
      receipt.lineageDigest !==
        computeMockTransportLineageDigest(receipt)) {
    fail("MOCK_RECEIPT_DIGEST_REJECTED");
  }
  return Object.freeze({lineageBindings: receipt.lineageBindings});
}

function bindingContains(lineageBindings, binding, value) {
  return Object.hasOwn(lineageBindings, binding) &&
    lineageBindings[binding].includes(value);
}

function addLineageValue(lineageBindings, binding, value) {
  if (typeof value !== "string" || !value) return;
  const current = Object.hasOwn(lineageBindings, binding) ?
    lineageBindings[binding] :
    [];
  if (!current.includes(value)) lineageBindings[binding] = [...current, value];
}

function matchLineage(value, pattern) {
  return typeof value === "string" ? pattern.exec(value) : null;
}

function createAdapterSessionLineage(sessionReceipt) {
  const lineage = Object.create(null);
  addLineageValue(lineage, "approved_rules_release_id", "cloud.firestore");
  const principals = sessionReceipt?.iamPrincipalAllowlist ?? [];
  const runtimeTransitionPermissions = [
    sessionReceipt?.runtimeIamActivationReceipt?.before,
    sessionReceipt?.runtimeIamActivationReceipt?.after,
  ].flatMap((snapshot) =>
    snapshot?.principalPermissions?.flatMap(({permissions}) => permissions) ??
      []);
  const receiptPermissions = [...new Set([
    ...principals.flatMap((principal) => [
    ...(principal.effectivePermissions ?? []),
    ...(principal.authPermissions ?? []),
    ]),
    ...runtimeTransitionPermissions,
  ])].sort();
  if (receiptPermissions.some((permission) =>
    !REVIEWED_PERMISSION_UNIVERSE.includes(permission))) {
    fail("MOCK_SESSION_REVIEWED_PERMISSION_LINEAGE_REJECTED");
  }
  const permissions = [...REVIEWED_PERMISSION_UNIVERSE];
  const members = principals.map(({member}) => member);
  const projectResource =
    `//cloudresourcemanager.googleapis.com/projects/${PROVIDER_TARGET_PROJECT_ID}`;
  lineage.approved_permission_set = permissions;
  lineage.approved_permission = permissions;
  lineage.approved_reviewed_permission = permissions;
  lineage.approved_principal = [
    ...members,
    "group:academy-backend-readers@daegu-miami.com",
  ];
  lineage.approved_iam_principal_or_group = [
    ...members,
    "group:academy-backend-readers@daegu-miami.com",
  ];
  lineage.approved_resource_name = [projectResource];
  lineage.approved_or_discovered_target_resource = [projectResource];
  lineage.approved_service_usage_service = [
    "cloudasset.googleapis.com",
    "cloudfunctions.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "iam.googleapis.com",
    "policytroubleshooter.googleapis.com",
  ];
  addLineageValue(
      lineage,
      "discovered_parent_lineage",
      `cloudresourcemanager.googleapis.com/projects/${PROVIDER_TARGET_PROJECT_ID}`,
  );
  return lineage;
}

function deriveResponseLineage(operationId, result, lineageBindings) {
  const values = Object.hasOwn(result, "records") ?
    result.records :
    [result.response];
  for (const value of values) {
    if (!value || typeof value !== "object") continue;
    let match;
    if (operationId === "firebaserules.v1.projects.releases.get") {
      match = matchLineage(
          value.rulesetName,
          /^projects\/daegu-miami-production\/rulesets\/([^/]+)$/,
      );
      if (match) {
        addLineageValue(
            lineageBindings,
            "approved_rules_ruleset_id",
            match[1],
        );
      }
    } else if (operationId ===
        "cloudfunctions.v2.projects.locations.functions.list") {
      match = matchLineage(
          value.name,
          /^projects\/daegu-miami-production\/locations\/us-central1\/functions\/([^/]+)$/,
      );
      if (match) {
        addLineageValue(lineageBindings, "approved_function_id", match[1]);
      }
    } else if (operationId ===
        "cloudfunctions.v2.projects.locations.functions.get") {
      for (const [binding, resource, pattern] of [
        [
          "approved_service_id",
          value.serviceConfig?.service,
          /^projects\/daegu-miami-production\/locations\/us-central1\/services\/([^/]+)$/,
        ],
        [
          "approved_revision_id",
          value.serviceConfig?.revision,
          /^projects\/daegu-miami-production\/locations\/us-central1\/services\/[^/]+\/revisions\/([^/]+)$/,
        ],
        [
          "approved_build_id",
          value.buildName,
          /^projects\/daegu-miami-production\/locations\/us-central1\/builds\/([^/]+)$/,
        ],
      ]) {
        match = matchLineage(resource, pattern);
        if (match) addLineageValue(lineageBindings, binding, match[1]);
      }
      const source = value.buildConfig?.source?.storageSource;
      addLineageValue(
          lineageBindings,
          "approved_storage_source_bucket",
          source?.bucket,
      );
      addLineageValue(
          lineageBindings,
          "approved_storage_source_object",
          source?.object,
      );
      addLineageValue(
          lineageBindings,
          "approved_storage_source_generation",
          source?.generation,
      );
      addLineageValue(
          lineageBindings,
          "approved_service_account_email",
          value.serviceConfig?.serviceAccountEmail,
      );
    } else if (operationId === "cloudresourcemanager.v3.projects.get" ||
        operationId === "cloudresourcemanager.v3.folders.get") {
      match = matchLineage(value.parent, /^(folders|organizations)\/([0-9]+)$/);
      if (match) {
        addLineageValue(lineageBindings, "discovered_parent_lineage", match[2]);
        addLineageValue(
            lineageBindings,
            "discovered_parent_lineage",
            `cloudresourcemanager.googleapis.com/${match[1]}/${match[2]}`,
        );
      }
    } else if (operationId === "iam.v1.projects.roles.list") {
      match = matchLineage(
          value.name,
          /^projects\/daegu-miami-production\/roles\/([^/]+)$/,
      );
      if (match) {
        addLineageValue(lineageBindings, "approved_iam_role_id", match[1]);
      }
    } else if (operationId ===
        "iam.v1.projects.serviceAccounts.list") {
      addLineageValue(
          lineageBindings,
          "approved_service_account_email",
          value.email,
      );
    } else if (operationId ===
        "iam.v2.policies.denypolicies.list") {
      match = matchLineage(value.name, /\/denypolicies\/([^/]+)$/);
      if (match) {
        addLineageValue(
            lineageBindings,
            "discovered_deny_policy_id",
            match[1],
        );
      }
    } else if (operationId ===
        "cloudscheduler.v1.projects.locations.jobs.list") {
      match = matchLineage(
          value.name,
          /^projects\/daegu-miami-production\/locations\/us-central1\/jobs\/([^/]+)$/,
      );
      if (match) {
        addLineageValue(
            lineageBindings,
            "approved_scheduler_job_id",
            match[1],
        );
      }
    }
  }
}

function validateScalar(schema, value, label, lineageBindings) {
  const validType = schema.type === "integer" ?
    Number.isSafeInteger(value) :
    typeof value === schema.type;
  if (!validType ||
      (schema.const !== undefined && value !== schema.const) ||
      (schema.enum !== undefined && !schema.enum.includes(value)) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength) ||
      (schema.pattern !== undefined &&
        !new RegExp(schema.pattern).test(value))) {
    fail(`${label}_VALUE_REJECTED`);
  }
  if (/^(?:approved_|discovered_)/.test(schema.binding) &&
      !bindingContains(lineageBindings, schema.binding, value)) {
    fail(`${label}_LINEAGE_REJECTED`);
  }
}

function validateQuery(operation, queryValue, lineageBindings) {
  const supplied = queryValue === undefined ? {} : queryValue;
  const keys = assertRecord(supplied, "QUERY");
  const schema = operation.query;
  if (keys.some((key) => !Object.hasOwn(schema.properties, key)) ||
      schema.required.some((key) => !Object.hasOwn(supplied, key))) {
    fail("QUERY_KEYSET_REJECTED");
  }
  if (operation.pagination.mode === "paged" &&
      Object.hasOwn(supplied, operation.pagination.pageTokenQueryParam)) {
    fail("CALLER_PAGE_TOKEN_REJECTED");
  }
  const entries = [];
  for (const key of keys.sort()) {
    const value = supplied[key];
    const valueSchema = schema.properties[key];
    if (valueSchema.type === "array") {
      assertStandardArray(value, `QUERY_${key}`);
      if (value.length < valueSchema.minItems ||
          value.length > valueSchema.maxItems ||
          (valueSchema.uniqueItems &&
            new Set(value).size !== value.length)) {
        fail(`QUERY_${key}_VALUE_REJECTED`);
      }
      if (/^(?:approved_|discovered_)/.test(valueSchema.binding)) {
        const approvedSet = lineageBindings[valueSchema.binding];
        if (!Array.isArray(approvedSet) ||
            approvedSet.length !== value.length ||
            [...approvedSet].sort().some(
                (item, index) => item !== [...value].sort()[index],
            )) {
          fail(`QUERY_${key}_SET_LINEAGE_REJECTED`);
        }
      }
      for (const item of value) {
        validateScalar(
            valueSchema.items,
            item,
            `QUERY_${key}`,
            lineageBindings,
        );
        entries.push([key, String(item)]);
      }
      continue;
    }
    validateScalar(valueSchema, value, `QUERY_${key}`, lineageBindings);
    entries.push([key, String(value)]);
  }
  return entries;
}

function encodePathValue(value, encoding) {
  if (encoding === "storage_object") {
    if (/[%?#\u0000-\u001f\u007f]/.test(value) ||
        value.startsWith("/") || value.endsWith("/") ||
        value.split("/").some((part) => part === "" ||
          part === "." || part === "..")) {
      fail("PATH_VALUE_REJECTED");
    }
    return encodeURIComponent(value);
  }
  if (/[/\\%?#\u0000-\u001f\u007f]/.test(value) ||
      value === "." || value === "..") {
    if (!["iam_attachment_point", "resource_name"].includes(encoding) ||
        /[\\%?#\u0000-\u001f\u007f]/.test(value) ||
        value.split("/").some((part) => part === "" ||
          part === "." || part === "..")) {
      fail("PATH_VALUE_REJECTED");
    }
  }
  return encodeURIComponent(value);
}

function buildUrl(operation, pathParams, queryEntries, pageToken) {
  let renderedPath = operation.pathTemplate;
  for (const [key, schema] of
    Object.entries(operation.pathParams.properties)) {
    const encoded = encodePathValue(pathParams[key], schema.encoding);
    renderedPath = renderedPath.replace(`{${key}}`, encoded);
  }
  if (/[{}]/.test(renderedPath)) fail("PATH_TEMPLATE_RENDER_REJECTED");
  const url = new URL(renderedPath, `${operation.host}/`);
  for (const [key, value] of queryEntries) url.searchParams.append(key, value);
  if (pageToken !== undefined) {
    url.searchParams.set(operation.pagination.pageTokenQueryParam, pageToken);
  }
  if (url.protocol !== "https:" ||
      url.origin !== operation.host ||
      url.pathname !== renderedPath ||
      !url.pathname.startsWith(`/${operation.apiVersion}/`) &&
        !url.pathname.startsWith("/storage/v1/") ||
      url.username !== "" ||
      url.password !== "" ||
      url.hash !== "") {
    fail("DESCRIPTOR_URL_BOUNDARY_REJECTED");
  }
  return url;
}

function validateAuthorizationHeaders(value) {
  let entries;
  if (typeof Headers !== "undefined" && value instanceof Headers) {
    entries = [...value.entries()];
  } else {
    const keys = assertRecord(value, "AUTH_HEADERS", {
      allowNullPrototype: false,
    });
    entries = keys.map((key) => [key, value[key]]);
  }
  if (entries.length !== 1 ||
      entries[0][0].toLowerCase() !== "authorization" ||
      typeof entries[0][1] !== "string" ||
      !/^Bearer [^\s\u0000-\u001f\u007f]{1,8192}$/.test(entries[0][1])) {
    fail("AUTHORIZATION_HEADERS_REJECTED");
  }
  return {Authorization: entries[0][1]};
}

function isTransientNetworkError(error) {
  try {
    if (!error || typeof error !== "object") return false;
    return TRANSIENT_NETWORK_NAMES.has(error.name) ||
      TRANSIENT_NETWORK_CODES.has(error.code) ||
      TRANSIENT_NETWORK_CODES.has(error.cause?.code);
  } catch {
    return false;
  }
}

async function cancelResponseBody(response) {
  try {
    await response?.body?.cancel?.();
  } catch {
    // Provider details are intentionally discarded.
  }
}

function getHeader(response, headerName) {
  try {
    if (!response?.headers ||
        typeof response.headers.get !== "function") {
      fail("RESPONSE_HEADERS_REJECTED");
    }
    return response.headers.get(headerName);
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    fail("RESPONSE_HEADERS_REJECTED");
  }
}

async function readBoundedBody(response, maximumBytes) {
  const contentLength = getHeader(response, "content-length");
  let declaredBytes;
  if (contentLength !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(contentLength)) {
      fail("CONTENT_LENGTH_REJECTED");
    }
    declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) ||
        declaredBytes > maximumBytes) {
      fail("RESPONSE_SIZE_LIMIT_EXCEEDED");
    }
  }
  if (!response.body || typeof response.body.getReader !== "function") {
    fail("RESPONSE_BODY_MISSING");
  }
  let reader;
  try {
    reader = response.body.getReader();
  } catch {
    fail("RESPONSE_STREAM_REJECTED");
  }
  const chunks = [];
  let byteCount = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (!result || typeof result !== "object" ||
          typeof result.done !== "boolean") {
        fail("RESPONSE_STREAM_REJECTED");
      }
      if (result.done) break;
      if (!(result.value instanceof Uint8Array)) {
        fail("RESPONSE_STREAM_CHUNK_REJECTED");
      }
      byteCount += result.value.byteLength;
      if (byteCount > maximumBytes) {
        try {
          await reader.cancel();
        } catch {
          // Cancellation errors are intentionally suppressed.
        }
        fail("RESPONSE_SIZE_LIMIT_EXCEEDED");
      }
      chunks.push(result.value);
    }
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    fail("RESPONSE_STREAM_REJECTED");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // Reader cleanup cannot alter a validated result.
    }
  }
  const bytes = new Uint8Array(byteCount);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (declaredBytes !== undefined && declaredBytes !== byteCount) {
    fail("CONTENT_LENGTH_MISMATCH");
  }
  return bytes;
}

function parseJsonObject(bytes) {
  let text;
  try {
    text = new TextDecoder("utf-8", {fatal: true}).decode(bytes);
  } catch {
    fail("RESPONSE_UTF8_REJECTED");
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    fail("RESPONSE_JSON_REJECTED");
  }
  assertRecord(parsed, "RESPONSE_JSON");
  return parsed;
}

function validateResponseField(schema, value, label) {
  const valid = schema.type === "array" ?
    Array.isArray(value) :
    schema.type === "integer" ?
      Number.isSafeInteger(value) :
      schema.type === "object" ?
        value !== null && typeof value === "object" && !Array.isArray(value) :
        typeof value === schema.type;
  if (!valid ||
      (schema.minLength !== undefined && value.length < schema.minLength)) {
    fail(`${label}_TYPE_REJECTED`);
  }
  if (schema.type === "array") assertStandardArray(value, label);
  if (schema.type === "object") assertRecord(value, label);
}

function validatePartialIndicators(responseContract, parsed) {
  const declared = new Set(
      responseContract.partialIndicators.map(({field}) => field),
  );
  for (const field of Object.keys(parsed)) {
    if (RESERVED_PARTIAL_FIELDS.has(field) && !declared.has(field)) {
      fail("UNDECLARED_CRITICAL_RESPONSE_FIELD");
    }
  }
  for (const indicator of responseContract.partialIndicators) {
    const present = Object.hasOwn(parsed, indicator.field);
    if (indicator.required && !present) {
      fail("REQUIRED_PARTIAL_INDICATOR_MISSING");
    }
    if (!present) continue;
    const value = parsed[indicator.field];
    if (indicator.policy === "reject_true") {
      if (typeof value !== "boolean" || value === true) {
        fail("PARTIAL_RESPONSE_REJECTED");
      }
    } else if (indicator.policy === "require_true") {
      if (value !== true) fail("PARTIAL_RESPONSE_REJECTED");
    } else if (indicator.policy === "reject_nonempty_array") {
      assertStandardArray(value, `PARTIAL_${indicator.field}`);
      if (value.length !== 0) fail("PARTIAL_RESPONSE_REJECTED");
    } else {
      fail("PARTIAL_RESPONSE_POLICY_REJECTED");
    }
  }
}

function validateJsonResponse(operation, parsed) {
  const contract = operation.response;
  validatePartialIndicators(contract, parsed);
  for (const [field, schema] of Object.entries(contract.requiredFields)) {
    if (!Object.hasOwn(parsed, field)) {
      fail("REQUIRED_RESPONSE_FIELD_MISSING");
    }
    validateResponseField(schema, parsed[field], `RESPONSE_${field}`);
  }
  if (operation.pagination.mode !== "paged") {
    return {response: parsed, records: null, nextPageToken: undefined};
  }
  const records = parsed[contract.recordsField];
  for (const record of records) {
    assertRecord(record, "RESPONSE_RECORD");
    for (const [field, schema] of
      Object.entries(contract.recordRequiredFields)) {
      if (!Object.hasOwn(record, field)) {
        fail("RECORD_IDENTITY_FIELD_MISSING");
      }
      validateResponseField(
          schema,
          record[field],
          `RECORD_${field}`,
      );
    }
  }
  let nextPageToken;
  if (Object.hasOwn(parsed, contract.nextPageTokenField)) {
    nextPageToken = parsed[contract.nextPageTokenField];
    if (typeof nextPageToken !== "string" ||
        nextPageToken.length < 1 ||
        nextPageToken.length > 4096 ||
        /[\u0000-\u001f\u007f]/.test(nextPageToken)) {
      fail("RESPONSE_PAGE_TOKEN_REJECTED");
    }
  }
  return {response: parsed, records, nextPageToken};
}

async function requestAttempt({
  authHeaderProvider,
  bodyText,
  fetchImpl,
  operation,
  queryEntries,
  pageToken,
  pathParams,
  timeoutSignalProvider,
}) {
  let headers;
  try {
    headers = validateAuthorizationHeaders(await authHeaderProvider());
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    fail("AUTHORIZATION_PROVIDER_FAILED");
  }
  if (bodyText !== undefined) headers["Content-Type"] = "application/json";
  let signal;
  try {
    signal = timeoutSignalProvider(operation.timeout.milliseconds);
  } catch {
    fail("TIMEOUT_SIGNAL_FAILED");
  }
  if (!(signal instanceof AbortSignal)) fail("TIMEOUT_SIGNAL_REJECTED");
  const requestUrl = buildUrl(
      operation,
      pathParams,
      queryEntries,
      pageToken,
  );
  let response;
  try {
    response = await fetchImpl(requestUrl, {
      method: operation.method,
      headers,
      redirect: "error",
      signal,
      ...(bodyText === undefined ? {} : {body: bodyText}),
    });
  } catch (error) {
    if (isTransientNetworkError(error)) {
      return {transientNetworkFailure: true};
    }
    fail("PROVIDER_NETWORK_REQUEST_FAILED");
  }
  let status;
  let redirected;
  let responseUrl;
  try {
    if (!response || typeof response !== "object") {
      fail("PROVIDER_RESPONSE_REJECTED");
    }
    status = response.status;
    redirected = response.redirected;
    responseUrl = response.url;
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    fail("PROVIDER_RESPONSE_REJECTED");
  }
  if (!Number.isInteger(status)) {
    fail("PROVIDER_RESPONSE_REJECTED");
  }
  if (redirected !== false) {
    await cancelResponseBody(response);
    fail("PROVIDER_REDIRECT_REJECTED");
  }
  if (typeof responseUrl !== "string" ||
      responseUrl.length === 0 ||
      responseUrl !== requestUrl.href) {
    await cancelResponseBody(response);
    fail("PROVIDER_FINAL_URL_REJECTED");
  }
  if (status >= 300 && status <= 399) {
    await cancelResponseBody(response);
    fail("PROVIDER_REDIRECT_REJECTED");
  }
  if (status < 200 || status > 299) {
    await cancelResponseBody(response);
    if (operation.retry.statusCodes.includes(status)) {
      return {retryableStatus: status};
    }
    fail("PROVIDER_HTTP_STATUS_REJECTED", status);
  }
  const bytes = await readBoundedBody(response, operation.maxResponseBytes);
  if (operation.response.kind === "media") return {bytes};
  return {bytes, parsed: parseJsonObject(bytes)};
}

function validateSemanticBody(operation, body, lineageContext) {
  if (operation.method === "GET") {
    if (body !== undefined) fail("GET_BODY_REJECTED");
    return undefined;
  }
  if (body === undefined || typeof body === "string" ||
      body instanceof Uint8Array) {
    fail("SEMANTIC_BODY_REQUIRED");
  }
  try {
    assertProviderRequestBody(
        operation.operationId,
        body,
        lineageContext,
    );
  } catch {
    fail("SEMANTIC_BODY_REJECTED");
  }
  return JSON.stringify(body);
}

async function executeAttemptWithRetries(context, sleep) {
  const maximumAttempts = context.operation.retry.maxRetries + 1;
  for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
    const result = await requestAttempt(context);
    const retryable = result.transientNetworkFailure ||
      result.retryableStatus !== undefined;
    if (!retryable) return result;
    if (attempt === maximumAttempts - 1) {
      fail("PROVIDER_RETRY_LIMIT_EXCEEDED");
    }
    try {
      await sleep(RETRY_BACKOFF_MILLISECONDS[attempt]);
    } catch {
      fail("RETRY_SLEEP_FAILED");
    }
  }
  fail("PROVIDER_RETRY_LIMIT_EXCEEDED");
}

function readClock(now, code) {
  let value;
  try {
    value = now();
  } catch {
    fail(code);
  }
  if (!Number.isFinite(value)) fail(code);
  return value;
}

function resolveOperation(operationId) {
  if (typeof operationId !== "string") fail("UNKNOWN_OPERATION_ID");
  try {
    return getProviderOperationDescriptor(operationId);
  } catch {
    fail("UNKNOWN_OPERATION_ID");
  }
}

async function executeWithSession(executor, input) {
  const session = executorSessions.get(executor);
  if (!session) fail("TRANSPORT_SESSION_REJECTED");
  assertExactOrSubsetKeys(
      input,
      EXECUTION_KEYS,
      REQUIRED_EXECUTION_KEYS,
      "EXECUTION_INPUT",
  );
  assertProviderOperationRegistry(PROVIDER_OPERATION_REGISTRY);
  const operation = resolveOperation(input.operationId);
  if (operation.readOnlySemantic !== true ||
      !["GET", "POST"].includes(operation.method) ||
      (operation.method === "POST" &&
        !operation.operationId.endsWith(".getIamPolicy") &&
        operation.operationId !==
          "policytroubleshooter.v3.iam.troubleshoot")) {
    fail("OPERATION_TRANSPORT_SEMANTICS_REJECTED");
  }
  const lineageContext = {
    lineageBindings: session.lineageContext.lineageBindings,
  };
  try {
    assertProviderPathParameters(
        operation.operationId,
        input.pathParams,
        lineageContext,
    );
  } catch {
    fail("PATH_PARAMETERS_REJECTED");
  }
  const queryEntries = validateQuery(
      operation,
      input.query,
      session.lineageContext.lineageBindings,
  );
  const bodyText =
    validateSemanticBody(operation, input.body, lineageContext);
  const observedAtEpochMs =
    readClock(session.dependencies.now, "START_CLOCK_REJECTED");
  const transportExecutionId = session.dependencies.randomId();
  if (typeof transportExecutionId !== "string" ||
      transportExecutionId.length < 1) {
    fail("TRANSPORT_EXECUTION_ID_REJECTED");
  }
  const records = [];
  const seenPageTokens = new Set();
  let pageToken;
  let pageCount = 0;
  let finalResponse;
  while (true) {
    const result = await executeAttemptWithRetries({
      authHeaderProvider: session.dependencies.authHeaderProvider,
      bodyText,
      fetchImpl: session.dependencies.fetchImpl,
      operation,
      queryEntries,
      pageToken,
      pathParams: input.pathParams,
      timeoutSignalProvider: session.dependencies.timeoutSignalProvider,
    }, session.dependencies.sleep);
    pageCount += 1;
    if (operation.response.kind === "media") {
      return {
        operationId: operation.operationId,
        paginationComplete: true,
        mockOnly: session.mockOnly,
        transportExecutionId,
        pageCount,
        recordCount: 1,
        responseSchema: operation.response.schema,
        observedAtEpochMs,
        completedAtEpochMs:
          readClock(session.dependencies.now, "COMPLETION_CLOCK_REJECTED"),
        media: {
          bytes: result.bytes,
          byteLength: result.bytes.byteLength,
          md5Hash: crypto.createHash("md5")
              .update(result.bytes).digest("base64"),
          sha256: crypto.createHash("sha256").update(result.bytes).digest("hex"),
        },
      };
    }
    const validated = validateJsonResponse(operation, result.parsed);
    finalResponse = validated.response;
    if (operation.pagination.mode !== "paged") break;
    records.push(...validated.records);
    if (records.length > operation.pagination.maxRecords ||
        records.length > PROVIDER_TRANSPORT_MAX_RECORDS) {
      fail("PAGINATION_RECORD_LIMIT_EXCEEDED");
    }
    if (validated.nextPageToken === undefined) break;
    if (seenPageTokens.has(validated.nextPageToken)) {
      fail("PAGINATION_TOKEN_REPEATED");
    }
    seenPageTokens.add(validated.nextPageToken);
    if (pageCount >= operation.pagination.maxPages ||
        pageCount >= PROVIDER_TRANSPORT_MAX_PAGES ||
        records.length >= operation.pagination.maxRecords ||
        records.length >= PROVIDER_TRANSPORT_MAX_RECORDS) {
      fail("PAGINATION_INCOMPLETE_AT_LIMIT");
    }
    pageToken = validated.nextPageToken;
  }
  const executionResult = {
    operationId: operation.operationId,
    paginationComplete: true,
    mockOnly: session.mockOnly,
    transportExecutionId,
    pageCount,
    recordCount: operation.pagination.mode === "paged" ?
      records.length :
      1,
    responseSchema: operation.response.schema,
    observedAtEpochMs,
    completedAtEpochMs:
      readClock(session.dependencies.now, "COMPLETION_CLOCK_REJECTED"),
    ...(operation.pagination.mode === "paged" ?
      {records} :
      {response: finalResponse}),
  };
  deriveResponseLineage(
      operation.operationId,
      executionResult,
      session.lineageContext.lineageBindings,
  );
  return executionResult;
}

function createExecutor(session) {
  const executor = async (input) => executeWithSession(executor, input);
  const metadata = {
    mockOnly: session.mockOnly,
    lineageMode: session.mockOnly ?
      "validated_mock_receipt" :
      "validated_dynamic_production_lineage",
  };
  if (session.mockOnly) {
    Object.defineProperties(metadata, {
      sessionReceipt: {
        value: session.sessionReceipt,
        enumerable: false,
        writable: false,
        configurable: false,
      },
      providerOperationAllowlistVersion: {
        value: PROVIDER_OPERATION_ALLOWLIST_VERSION,
        enumerable: false,
        writable: false,
        configurable: false,
      },
      providerOperationDescriptorSetDigest: {
        value: PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
        enumerable: false,
        writable: false,
        configurable: false,
      },
      providerAdapterContractVersion: {
        value: PROVIDER_ADAPTER_CONTRACT_VERSION,
        enumerable: false,
        writable: false,
        configurable: false,
      },
    });
  }
  Object.defineProperty(executor, "metadata", {
    value: Object.freeze(metadata),
    enumerable: true,
    writable: false,
    configurable: false,
  });
  executorSessions.set(executor, Object.freeze(session));
  return Object.freeze(executor);
}

function createExplicitCredentialGoogleAuthHeaderProvider(parsedCredential) {
  if (parsedCredential?.client_email !== OBSERVER_PRINCIPAL_POLICY.email) {
    observerFail("OBSERVER_PRINCIPAL_REJECTED");
  }
  const auth = new GoogleAuth({
    credentials: parsedCredential,
    scopes: [GOOGLE_PROVIDER_READ_ONLY_SCOPE],
  });
  return async () => {
    try {
      return await auth.getRequestHeaders();
    } catch {
      fail("AUTHORIZATION_PROVIDER_FAILED");
    }
  };
}

function createProductionProviderTransportExecutor(
    parsedCredential,
    preflightContext,
) {
  if (!genuineProductionPreflightContexts.has(preflightContext) ||
      typeof capturedNativeFetch !== "function") {
    fail("PRODUCTION_TRANSPORT_CONTEXT_REJECTED");
  }
  const executor = createExecutor({
    mockOnly: false,
    lineageContext: Object.freeze({
      lineageBindings: createProductionSessionLineage(),
    }),
    dependencies: Object.freeze({
      authHeaderProvider:
        createExplicitCredentialGoogleAuthHeaderProvider(parsedCredential),
      fetchImpl: capturedNativeFetch,
      now: () => Date.now(),
      randomId: () => crypto.randomUUID(),
      sleep: (milliseconds) =>
        new Promise((resolve) => setTimeout(resolve, milliseconds)),
      timeoutSignalProvider: (milliseconds) => AbortSignal.timeout(milliseconds),
    }),
  });
  genuineProductionExecutors.add(executor);
  return executor;
}

export function createMockProviderTransportExecutor(options) {
  assertExactOrSubsetKeys(
      options,
      MOCK_FACTORY_KEYS,
      REQUIRED_MOCK_FACTORY_KEYS,
      "MOCK_FACTORY",
  );
  for (const key of REQUIRED_MOCK_FACTORY_KEYS.filter(
      (key) => key !== "receipt")) {
    if (typeof options[key] !== "function") {
      fail("MOCK_FACTORY_DEPENDENCY_REJECTED");
    }
  }
  if (Object.hasOwn(options, "sessionReceipt")) {
    assertDeepFrozen(options.sessionReceipt, "MOCK_SESSION_RECEIPT");
    assertRecord(options.sessionReceipt, "MOCK_SESSION_RECEIPT");
  }
  const validatedReceipt = validateMockReceipt(options.receipt);
  if (Object.hasOwn(options, "sessionReceipt") &&
      Object.keys(validatedReceipt.lineageBindings).length !== 0) {
    fail("ADAPTER_MOCK_LINEAGE_MUST_START_EMPTY");
  }
  return createExecutor({
    mockOnly: true,
    sessionReceipt: options.sessionReceipt ?? options.receipt,
    lineageContext: Object.freeze({
      lineageBindings: Object.hasOwn(options, "sessionReceipt") ?
        createAdapterSessionLineage(options.sessionReceipt) :
        validatedReceipt.lineageBindings,
    }),
    dependencies: Object.freeze({
      authHeaderProvider: options.authHeaderProvider,
      fetchImpl: options.fetchImpl,
      now: options.now,
      randomId: options.randomId,
      sleep: options.sleep,
      timeoutSignalProvider: options.timeoutSignalProvider,
    }),
  });
}

export function assertMockProviderTransportExecutor(
    executor,
    expectedSessionReceipt,
) {
  const session = executorSessions.get(executor);
  if (!session || session.mockOnly !== true ||
      executor.metadata?.mockOnly !== true ||
      expectedSessionReceipt === undefined ||
      canonical(session.sessionReceipt) !== canonical(expectedSessionReceipt)) {
    fail("GENUINE_MOCK_TRANSPORT_EXECUTOR_REQUIRED");
  }
  assertDeepFrozen(expectedSessionReceipt, "EXPECTED_SESSION_RECEIPT");
  return true;
}

function canonicalInventoryValue(value, label) {
  if (value === null || typeof value === "boolean" ||
      typeof value === "string") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail(`${label}_VALUE_REJECTED`);
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    assertStandardArray(value, label);
    return `[${value.map((item, index) =>
      canonicalInventoryValue(item, `${label}_${index}`)).join(",")}]`;
  }
  const keys = assertRecord(value, label);
  return `{${keys.sort().map((key) =>
    `${JSON.stringify(key)}:${canonicalInventoryValue(
        value[key],
        `${label}_${key}`,
    )}`).join(",")}}`;
}

function inventoryDigest(result, label) {
  assertRecord(result, label);
  if (result.paginationComplete !== true ||
      Object.hasOwn(result, "complete") ||
      typeof result.transportExecutionId !== "string" ||
      typeof result.operationId !== "string") {
    fail(`${label}_EXHAUSTIVE_RESULT_REJECTED`);
  }
  assertStandardArray(result.records, `${label}_RECORDS`);
  const canonicalRecords = result.records.map((record, index) =>
    canonicalInventoryValue(record, `${label}_${index}`)).sort();
  if (new Set(canonicalRecords).size !== canonicalRecords.length) {
    fail(`${label}_DUPLICATE_RECORD_REJECTED`);
  }
  return {
    operationId: result.operationId,
    executionId: result.transportExecutionId,
    mockOnly: result.mockOnly,
    count: canonicalRecords.length,
    digest: crypto.createHash("sha256")
        .update(`[${canonicalRecords.join(",")}]`)
        .digest("hex"),
  };
}

export function compareProviderInventoryScans(startResult, endResult) {
  const start = inventoryDigest(startResult, "START_SCAN");
  const end = inventoryDigest(endResult, "END_SCAN");
  if (start.operationId !== end.operationId ||
      start.executionId === end.executionId ||
      start.mockOnly !== end.mockOnly) {
    fail("INDEPENDENT_SCAN_PAIR_REJECTED");
  }
  return Object.freeze({
    stable: start.count === end.count && start.digest === end.digest,
    independentExecutions: true,
    operationId: start.operationId,
    count: start.count,
    startDigest: start.digest,
    endDigest: end.digest,
  });
}

export function assertStableProviderInventory(startResult, endResult) {
  const comparison =
    compareProviderInventoryScans(startResult, endResult);
  if (!comparison.stable) fail("PROVIDER_INVENTORY_UNSTABLE");
  return comparison;
}

export const PRODUCTION_OBSERVER_SCHEMA_VERSION =
  "academy_reset_freeze_raw_production_observer.v7";
export const PRODUCTION_OBSERVER_SUMMARY_FILENAME =
  "provider-observation-summary-redacted.json";
export const PRODUCTION_OBSERVER_SENSITIVE_FILENAME =
  "provider-observation-sensitive.json";
export const PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC =
  "policytroubleshooter.v3.iam.troubleshoot";

const PRODUCTION_CONFIRMATION_ENV =
  "CONFIRM_PRODUCTION_READ_ONLY_OBSERVATION";
const MAX_CREDENTIAL_BYTES = 64 * 1024;
const MAX_OBSERVATION_AGE_MS = 5 * 60 * 1000;
const MODULE_REPOSITORY_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
);
const REQUIRED_CLI_ARGUMENTS = Object.freeze([
  "credential-file",
  "project",
  "project-number",
  "release-sha",
  "sensitive-output",
  "summary-output",
]);
const ALLOWED_CLI_ARGUMENTS = Object.freeze([
  ...REQUIRED_CLI_ARGUMENTS,
  "optional-diagnostic",
].sort());
const REQUIRED_SERVICE_USAGE_SERVICES = Object.freeze([
  "cloudasset.googleapis.com",
  "cloudbuild.googleapis.com",
  "cloudfunctions.googleapis.com",
  "cloudresourcemanager.googleapis.com",
  "cloudscheduler.googleapis.com",
  "firebaserules.googleapis.com",
  "iam.googleapis.com",
  "run.googleapis.com",
  "serviceusage.googleapis.com",
  "storage.googleapis.com",
]);
const BLOCKER_CODES = Object.freeze([
  "CONDITION_ANALYSIS_INCOMPLETE",
  "DENY_POLICY_ANALYSIS_INCOMPLETE",
  "DENY_POLICY_PRESENT_REQUIRES_REVIEW",
  "FUNCTION_COUNT_MISMATCH",
  "GUARDED_FUNCTION_COUNT_MISMATCH",
  "IAM_DOMAIN_EXPANSION_INCOMPLETE",
  "IAM_EXPANSION_INCOMPLETE",
  "IAM_GROUP_EXPANSION_INCOMPLETE",
  "IAM_WRITABLE_PERMISSION_FOUND",
  "INVENTORY_UNSTABLE",
  "MANDATORY_OPERATION_COVERAGE_INCOMPLETE",
  "OBSERVATION_STALE",
  "PAGINATION_INCOMPLETE",
  "PAGINATION_TOKEN_REPEATED",
  "PROVIDER_UNREACHABLE",
  "SCHEDULER_INVENTORY_INCOMPLETE",
]);

function observerFail(code) {
  fail(`PRODUCTION_OBSERVER_${code}`);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function normalizeCanonicalJson(value, label = "VALUE") {
  if (value === null || typeof value === "string" ||
      typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) observerFail(`${label}_NONFINITE_REJECTED`);
    return value;
  }
  if (Array.isArray(value)) {
    assertStandardArray(value, label);
    return value.map((item, index) =>
      normalizeCanonicalJson(item, `${label}_${index}`));
  }
  if (!value || typeof value !== "object") {
    observerFail(`${label}_NON_JSON_REJECTED`);
  }
  const keys = assertRecord(value, label);
  const result = {};
  for (const key of keys.sort()) {
    if (value[key] !== undefined) {
      result[key] =
        normalizeCanonicalJson(value[key], `${label}_${key}`);
    }
  }
  return result;
}

function assertCanonicalJson(value, label) {
  const normalized = normalizeCanonicalJson(value, label);
  if (canonical(normalized) !== canonical(value)) {
    observerFail(`${label}_CANONICAL_JSON_REJECTED`);
  }
}

function exactSortedSet(actual, expected, code) {
  if (!Array.isArray(actual) ||
      new Set(actual).size !== actual.length ||
      canonical([...actual].sort()) !== canonical([...expected].sort())) {
    observerFail(code);
  }
}

function assertNoSensitiveOutput(value, label = "OUTPUT") {
  const forbiddenKey = /(?:authorization|credential|private_key|client_email|client_id|token|header)/i;
  const forbiddenValue = /(?:-----BEGIN PRIVATE KEY-----|Bearer\s+[^\s]+)/;
  const visit = (current, currentLabel) => {
    if (typeof current === "string") {
      if (forbiddenValue.test(current)) observerFail(`${label}_SECRET_REJECTED`);
      return;
    }
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      assertStandardArray(current, `${currentLabel}_ARRAY`);
      current.forEach((item, index) =>
        visit(item, `${currentLabel}[${index}]`));
      return;
    }
    for (const key of Reflect.ownKeys(current)) {
      if (typeof key !== "string" || forbiddenKey.test(key)) {
        observerFail(`${label}_SECRET_KEY_REJECTED`);
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
        observerFail(`${label}_PROPERTY_REJECTED`);
      }
      visit(descriptor.value, `${currentLabel}.${key}`);
    }
  };
  visit(value, label);
}

export function parseProductionObserverArguments(argv) {
  assertStandardArray(argv, "CLI_ARGUMENTS");
  const parsed = Object.create(null);
  for (const argument of argv) {
    if (typeof argument !== "string" ||
        !argument.startsWith("--") ||
        argument.includes("\u0000")) {
      observerFail("CLI_ARGUMENT_REJECTED");
    }
    const match = /^--([a-z][a-z-]*)=(.*)$/.exec(argument);
    if (!match || !ALLOWED_CLI_ARGUMENTS.includes(match[1]) ||
        Object.hasOwn(parsed, match[1]) || match[2].length === 0) {
      observerFail("CLI_ARGUMENT_REJECTED");
    }
    parsed[match[1]] = match[2];
  }
  if (REQUIRED_CLI_ARGUMENTS.some((name) => !Object.hasOwn(parsed, name)) ||
      Object.keys(parsed).length !== REQUIRED_CLI_ARGUMENTS.length +
        (Object.hasOwn(parsed, "optional-diagnostic") ? 1 : 0)) {
    observerFail("CLI_ARGUMENT_SET_REJECTED");
  }
  if (parsed.project !== PROVIDER_TARGET_PROJECT_ID ||
      parsed["project-number"] !== PROVIDER_TARGET_PROJECT_NUMBER ||
      !/^[0-9a-f]{40}$/.test(parsed["release-sha"]) ||
      (Object.hasOwn(parsed, "optional-diagnostic") &&
        parsed["optional-diagnostic"] !==
          PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC)) {
    observerFail("CLI_TARGET_REJECTED");
  }
  return deepFreeze({
    projectId: parsed.project,
    projectNumber: parsed["project-number"],
    releaseSha: parsed["release-sha"],
    credentialFile: parsed["credential-file"],
    summaryOutput: parsed["summary-output"],
    sensitiveOutput: parsed["sensitive-output"],
    optionalDiagnostic: parsed["optional-diagnostic"] ?? null,
  });
}

function assertExactConfirmationEnvironment(environment) {
  if (!environment || typeof environment !== "object" ||
      environment[PRODUCTION_CONFIRMATION_ENV] !== "YES") {
    observerFail("CONFIRMATION_REJECTED");
  }
}

function assertSymlinkFreeExistingAncestors(absolutePath) {
  const parsedPath = path.parse(absolutePath);
  const relativeParts = absolutePath.slice(parsedPath.root.length)
      .split(path.sep).filter(Boolean);
  let current = parsedPath.root;
  for (const part of relativeParts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch {
      observerFail("OUTPUT_ANCESTOR_REJECTED");
    }
    if (stat.isSymbolicLink()) observerFail("OUTPUT_ANCESTOR_SYMLINK_REJECTED");
  }
}

function describeSecureOutputBase(parent) {
  const base = path.dirname(parent);
  assertSymlinkFreeExistingAncestors(base);
  let stat;
  try {
    stat = fs.lstatSync(base);
  } catch {
    observerFail("OUTPUT_BASE_REJECTED");
  }
  const expectedUid = typeof process.getuid === "function" ?
    process.getuid() :
    stat.uid;
  if (stat.isSymbolicLink() || !stat.isDirectory() ||
      stat.uid !== expectedUid || (stat.mode & 0o777) !== 0o700) {
    observerFail("OUTPUT_BASE_REJECTED");
  }
  return {base, baseDevice: stat.dev, baseInode: stat.ino};
}

function assertOutputDirectoryIdentity(
    outputPlan,
    parentIdentity = null,
) {
  let baseStat;
  try {
    baseStat = fs.lstatSync(outputPlan.base);
  } catch {
    observerFail("OUTPUT_DIRECTORY_IDENTITY_REJECTED");
  }
  if (baseStat.isSymbolicLink() || !baseStat.isDirectory() ||
      baseStat.dev !== outputPlan.baseDevice ||
      baseStat.ino !== outputPlan.baseInode ||
      (baseStat.mode & 0o777) !== 0o700) {
    observerFail("OUTPUT_DIRECTORY_IDENTITY_REJECTED");
  }
  if (parentIdentity === null) return;
  let parentStat;
  try {
    parentStat = fs.lstatSync(outputPlan.parent);
  } catch {
    observerFail("OUTPUT_DIRECTORY_IDENTITY_REJECTED");
  }
  if (parentStat.isSymbolicLink() || !parentStat.isDirectory() ||
      parentStat.dev !== parentIdentity.device ||
      parentStat.ino !== parentIdentity.inode ||
      (parentStat.mode & 0o777) !== 0o700) {
    observerFail("OUTPUT_DIRECTORY_IDENTITY_REJECTED");
  }
}

function validateOutputPlan(argumentsValue, repositoryRoot) {
  const summaryPath = argumentsValue.summaryOutput;
  const sensitivePath = argumentsValue.sensitiveOutput;
  if (![summaryPath, sensitivePath].every((value) =>
    typeof value === "string" && path.isAbsolute(value) &&
      path.resolve(value) === value && !value.includes("\u0000"))) {
    observerFail("OUTPUT_PATH_REJECTED");
  }
  if (path.basename(summaryPath) !== PRODUCTION_OBSERVER_SUMMARY_FILENAME ||
      path.basename(sensitivePath) !==
        PRODUCTION_OBSERVER_SENSITIVE_FILENAME) {
    observerFail("OUTPUT_FILENAME_REJECTED");
  }
  const parent = path.dirname(summaryPath);
  if (parent !== path.dirname(sensitivePath) ||
      fs.existsSync(parent) || fs.existsSync(summaryPath) ||
      fs.existsSync(sensitivePath)) {
    observerFail("OUTPUT_PARENT_MUST_BE_NEW");
  }
  const relative = path.relative(repositoryRoot, parent);
  if (relative === "" || relative === "." ||
      !relative.startsWith(`..${path.sep}`) && relative !== ".." ||
      path.isAbsolute(relative)) {
    observerFail("OUTPUT_MUST_BE_OUTSIDE_REPOSITORY");
  }
  assertSymlinkFreeExistingAncestors(parent);
  const outputBase = describeSecureOutputBase(parent);
  return deepFreeze({
    ...outputBase,
    parent,
    summaryPath,
    sensitivePath,
  });
}

function assertObserverContracts() {
  try {
    assertProviderOperationRegistry(PROVIDER_OPERATION_REGISTRY);
    assertProviderOperationClassification(
        PROVIDER_OPERATION_CLASSIFICATION,
        PROVIDER_OPERATION_REGISTRY,
    );
    assertReadonlyPermissionManifest();
    assertEffectiveMandatoryPermissionContract();
    assertObserverPrincipalPolicy();
    const topologyProfile = deriveStandaloneProjectObserverProfile(
        PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
    );
    assertStandaloneProjectObserverProfile(topologyProfile);
  } catch {
    observerFail("CONTRACT_REJECTED");
  }
  if (PROVIDER_OPERATION_COUNT !== 30 ||
      PROVIDER_MANDATORY_OPERATION_COUNT !== 29 ||
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT !== 1 ||
      PROVIDER_NO_MUTATION_OPERATION_COUNT !== 0 ||
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS.length !== 1 ||
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS[0] !==
        PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC ||
      PROVIDER_MANDATORY_OPERATION_IDS.some((operationId) =>
        !PROVIDER_OPERATION_IDS.includes(operationId)) ||
      Object.values(PROVIDER_OPERATION_REGISTRY).some((descriptor) =>
        descriptor.readOnlySemantic !== true ||
        !["GET", "POST"].includes(descriptor.method))) {
    observerFail("OPERATION_CLASSIFICATION_REJECTED");
  }
}

function validateResolvedSourceIdentity(
    sourceIdentity,
    repositoryRoot,
    releaseSha,
) {
  assertRecord(sourceIdentity, "SOURCE_IDENTITY");
  const runtimeGit = sourceIdentity.runtimeGit;
  const reviewedSources = sourceIdentity.reviewedSources;
  if (!runtimeGit || !reviewedSources ||
      runtimeGit.headSha !== releaseSha ||
      runtimeGit.clean !== true ||
      reviewedSources.repositoryRoot !== repositoryRoot ||
      reviewedSources.aggregateDigest !==
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST ||
      runtimeGit.reviewedSourceIdentityDigest !==
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST ||
      !/^[0-9a-f]{40}$/.test(runtimeGit.treeSha) ||
      !/^[0-9a-f]{64}$/.test(runtimeGit.criticalSourceSetDigest) ||
      !/^[0-9a-f]{64}$/.test(runtimeGit.reviewedSourceSetDigest)) {
    observerFail("SOURCE_IDENTITY_REJECTED");
  }
}

export function validateProductionObserverRequest({
  arguments: argumentsValue,
  environment,
  repositoryRoot,
  sourceIdentity,
} = {}) {
  assertObserverContracts();
  assertExactConfirmationEnvironment(environment);
  if (!argumentsValue || !Object.isFrozen(argumentsValue) ||
      argumentsValue.projectId !== PROVIDER_TARGET_PROJECT_ID ||
      argumentsValue.projectNumber !== PROVIDER_TARGET_PROJECT_NUMBER ||
      !/^[0-9a-f]{40}$/.test(argumentsValue.releaseSha) ||
      !path.isAbsolute(argumentsValue.credentialFile) ||
      path.resolve(argumentsValue.credentialFile) !==
        argumentsValue.credentialFile ||
      repositoryRoot !== MODULE_REPOSITORY_ROOT ||
      fs.realpathSync.native(repositoryRoot) !== repositoryRoot) {
    observerFail("REQUEST_REJECTED");
  }
  validateResolvedSourceIdentity(
      sourceIdentity,
      repositoryRoot,
      argumentsValue.releaseSha,
  );
  const topologyProfile = deriveStandaloneProjectObserverProfile(
      PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
  );
  assertObserverPrincipalPolicy(OBSERVER_PRINCIPAL_POLICY);
  const outputPlan = validateOutputPlan(argumentsValue, repositoryRoot);
  const context = deepFreeze({
    arguments: argumentsValue,
    repositoryRoot,
    sourceIdentity,
    outputPlan,
    topologyProfile,
    observerPrincipalPolicy: OBSERVER_PRINCIPAL_POLICY,
    target: {
      projectId: PROVIDER_TARGET_PROJECT_ID,
      projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
      location: PROVIDER_APPROVED_LOCATION,
    },
    contracts: {
      providerOperationClassificationVersion:
        PROVIDER_OPERATION_CLASSIFICATION_VERSION,
      providerOperationClassificationDigest:
        PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
      providerOperationAllowlistVersion: PROVIDER_OPERATION_ALLOWLIST_VERSION,
      providerOperationDescriptorSetDigest:
        PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
      providerMandatoryOperationIdsDigest:
        PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
      providerOptionalDiagnosticOperationIdsDigest:
        PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
      effectiveMandatoryPermissionContractDigest:
        EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
      topologyProfileDigest: topologyProfile.profileDigest,
      topologyEvidenceDigest: topologyProfile.topologyEvidenceDigest,
      operationExecutionDigest: topologyProfile.operationExecutionDigest,
      effectivePermissionProfileDigest:
        topologyProfile.effectivePermissionProfileDigest,
      observerPrincipalPolicyDigest:
        OBSERVER_PRINCIPAL_POLICY.policyDigest,
      readonlyPermissionManifestDigest: READONLY_PERMISSION_MANIFEST_DIGEST,
      reviewedSourceDigest:
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
    },
  });
  genuineProductionPreflightContexts.add(context);
  return context;
}

function resolveProductionSourceIdentity(repositoryRoot) {
  const reviewedSources =
    validateProviderAdapterReviewedSources(repositoryRoot);
  const runtimeGit = resolveRuntimeGitSourceIdentity({
    repositoryRoot: reviewedSources.repositoryRoot,
  });
  return deepFreeze({reviewedSources, runtimeGit});
}

function assertCredentialDescriptorAndPayload(
    credentialResult,
    expectedPath,
) {
  assertRecord(credentialResult, "CREDENTIAL_RESULT");
  assertRecord(credentialResult.descriptor, "CREDENTIAL_DESCRIPTOR");
  assertRecord(credentialResult.payload, "CREDENTIAL_PAYLOAD");
  const descriptor = credentialResult.descriptor;
  const credentialKeys = Reflect.ownKeys(credentialResult.payload);
  const allowedCredentialKeys = [
    "auth_provider_x509_cert_url",
    "auth_uri",
    "client_email",
    "client_id",
    "client_x509_cert_url",
    "private_key",
    "private_key_id",
    "project_id",
    "token_uri",
    "type",
    "universe_domain",
  ];
  const requiredCredentialKeys = [
    "client_email",
    "private_key",
    "project_id",
    "type",
  ];
  const expectedUid = typeof process.getuid === "function" ?
    process.getuid() :
    descriptor.uid;
  if (credentialKeys.some((key) =>
    typeof key !== "string" || !allowedCredentialKeys.includes(key)) ||
      requiredCredentialKeys.some((key) =>
        !Object.hasOwn(credentialResult.payload, key)) ||
      descriptor.absolutePath !== expectedPath ||
      path.isAbsolute(expectedPath) !== true ||
      descriptor.fileType !== "regular" ||
      descriptor.intermediateSymlinkFree !== true ||
      descriptor.symbolicLink !== false ||
      descriptor.mode !== 0o600 ||
      descriptor.uid !== expectedUid ||
      !Number.isSafeInteger(descriptor.size) ||
      descriptor.size < 2 || descriptor.size > MAX_CREDENTIAL_BYTES ||
      credentialResult.payload.project_id !== PROVIDER_TARGET_PROJECT_ID ||
      credentialResult.payload.client_email !==
        OBSERVER_PRINCIPAL_POLICY.email ||
      credentialResult.payload.type !== "service_account" ||
      typeof credentialResult.payload.private_key !== "string" ||
      credentialResult.payload.private_key.length === 0 ||
      typeof credentialResult.payload.client_email !== "string" ||
      credentialResult.payload.client_email.length === 0) {
    observerFail("CREDENTIAL_CONTRACT_REJECTED");
  }
  return credentialResult.payload;
}

function readExplicitProductionCredential(credentialPath) {
  if (typeof credentialPath !== "string" ||
      !path.isAbsolute(credentialPath) ||
      path.resolve(credentialPath) !== credentialPath ||
      credentialPath.includes("\u0000")) {
    observerFail("CREDENTIAL_CONTRACT_REJECTED");
  }
  const parsedPath = path.parse(credentialPath);
  const parts = credentialPath.slice(parsedPath.root.length)
      .split(path.sep).filter(Boolean);
  let current = parsedPath.root;
  for (const part of parts) {
    current = path.join(current, part);
    let item;
    try {
      item = fs.lstatSync(current);
    } catch {
      observerFail("CREDENTIAL_CONTRACT_REJECTED");
    }
    if (item.isSymbolicLink()) observerFail("CREDENTIAL_CONTRACT_REJECTED");
  }
  try {
    if (fs.realpathSync.native(credentialPath) !== credentialPath) {
      observerFail("CREDENTIAL_CONTRACT_REJECTED");
    }
  } catch (error) {
    if (error instanceof ProviderTransportError) throw error;
    observerFail("CREDENTIAL_CONTRACT_REJECTED");
  }
  let before;
  let descriptor;
  let handle;
  try {
    before = fs.lstatSync(credentialPath);
    const noFollow = fs.constants.O_NOFOLLOW ?? 0;
    handle = fs.openSync(
        credentialPath,
        fs.constants.O_RDONLY | noFollow,
    );
    descriptor = fs.fstatSync(handle);
  } catch {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {}
    }
    observerFail("CREDENTIAL_CONTRACT_REJECTED");
  }
  try {
    const expectedUid = typeof process.getuid === "function" ?
      process.getuid() :
      descriptor.uid;
    if (!before.isFile() || before.isSymbolicLink() ||
        !descriptor.isFile() ||
        before.dev !== descriptor.dev || before.ino !== descriptor.ino ||
        (descriptor.mode & 0o777) !== 0o600 ||
        descriptor.uid !== expectedUid ||
        descriptor.size < 2 || descriptor.size > MAX_CREDENTIAL_BYTES) {
      observerFail("CREDENTIAL_CONTRACT_REJECTED");
    }
    const bytes = fs.readFileSync(handle);
    if (bytes.byteLength !== descriptor.size) {
      observerFail("CREDENTIAL_CONTRACT_REJECTED");
    }
    let payload;
    try {
      payload = JSON.parse(new TextDecoder("utf-8", {fatal: true})
          .decode(bytes));
    } catch {
      observerFail("CREDENTIAL_CONTRACT_REJECTED");
    }
    const result = deepFreeze({
      descriptor: {
        absolutePath: credentialPath,
        fileType: "regular",
        intermediateSymlinkFree: true,
        symbolicLink: false,
        mode: descriptor.mode & 0o777,
        uid: descriptor.uid,
        size: descriptor.size,
      },
      payload,
    });
    assertCredentialDescriptorAndPayload(result, credentialPath);
    return result;
  } finally {
    try {
      fs.closeSync(handle);
    } catch {}
  }
}

function createProductionSessionLineage() {
  const projectResource =
    `//cloudresourcemanager.googleapis.com/projects/${PROVIDER_TARGET_PROJECT_ID}`;
  const lineage = Object.create(null);
  lineage.approved_rules_release_id = ["cloud.firestore"];
  lineage.approved_service_usage_service = [
    ...REQUIRED_SERVICE_USAGE_SERVICES,
    "policytroubleshooter.googleapis.com",
  ];
  lineage.approved_permission_set = [...REVIEWED_PERMISSION_UNIVERSE];
  lineage.approved_permission = [...REVIEWED_PERMISSION_UNIVERSE];
  lineage.approved_reviewed_permission = [...REVIEWED_PERMISSION_UNIVERSE];
  lineage.approved_resource_name = [projectResource];
  lineage.approved_or_discovered_target_resource = [projectResource];
  lineage.approved_principal = [...KNOWN_IAM_GROUPS];
  lineage.approved_iam_principal_or_group = [...KNOWN_IAM_GROUPS];
  lineage.discovered_parent_lineage = [
    `cloudresourcemanager.googleapis.com/projects/${PROVIDER_TARGET_PROJECT_ID}`,
  ];
  return lineage;
}

function addProductionLineage(executor, binding, values) {
  if (!genuineProductionExecutors.has(executor) &&
      !injectedMockRawIamExecutors.has(executor)) {
    observerFail("GENUINE_PRODUCTION_EXECUTOR_REQUIRED");
  }
  const session = executorSessions.get(executor);
  for (const value of values) {
    addLineageValue(session.lineageContext.lineageBindings, binding, value);
  }
}

function addInjectedMockRawIamLineage(executor) {
  if (!injectedMockRawIamExecutors.has(executor)) {
    observerFail("INJECTED_MOCK_RAW_IAM_EXECUTOR_REQUIRED");
  }
  const session = executorSessions.get(executor);
  for (const [binding, values] of
    Object.entries(createProductionSessionLineage())) {
    for (const value of values) {
      addLineageValue(session.lineageContext.lineageBindings, binding, value);
    }
  }
}

function rawName(value, pattern, code) {
  if (typeof value !== "string") observerFail(code);
  const match = pattern.exec(value);
  if (!match) observerFail(code);
  return match;
}

function rawPayload(result, mockOnly = false) {
  if (!result || result.mockOnly !== mockOnly ||
      result.paginationComplete !== true ||
      typeof result.operationId !== "string") {
    observerFail("RAW_OPERATION_RESULT_REJECTED");
  }
  return Object.hasOwn(result, "records") ? result.records : result.response;
}

function rawProjectionDigest(value) {
  return sha256Canonical(value);
}

async function executeRaw(state, input) {
  const genuineProductionState =
    genuineProductionExecutors.has(state.executor) &&
    genuineProductionPreflightContexts.has(state.preflight);
  const injectedMockRawIamState = injectedMockRawIamStates.has(state);
  if (!genuineProductionState && !injectedMockRawIamState ||
      !PROVIDER_MANDATORY_OPERATION_IDS.includes(input.operationId) &&
        input.operationId !== PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC) {
    observerFail("RAW_ADAPTER_BOUNDARY_REJECTED");
  }
  const descriptor = PROVIDER_OPERATION_REGISTRY[input.operationId];
  if (!descriptor || descriptor.readOnlySemantic !== true ||
      !["GET", "POST"].includes(descriptor.method)) {
    observerFail("RAW_MUTATION_OPERATION_REJECTED");
  }
  const result = await state.executor(input);
  rawPayload(result, injectedMockRawIamState);
  state.trace.push({
    operationId: result.operationId,
    transportExecutionId: result.transportExecutionId,
    pageCount: result.pageCount,
    recordCount: result.recordCount,
    observedAtEpochMs: result.observedAtEpochMs,
    completedAtEpochMs: result.completedAtEpochMs,
  });
  if (PROVIDER_MANDATORY_OPERATION_IDS.includes(result.operationId)) {
    state.executed.add(result.operationId);
  }
  return result;
}

function markNotApplicable(state, operationId, evidence) {
  if (!PROVIDER_MANDATORY_OPERATION_IDS.includes(operationId) ||
      state.executed.has(operationId) ||
      state.notApplicable.has(operationId) ||
      !(typeof evidence === "string" &&
          /^[A-Z0-9_]{3,120}$/.test(evidence) ||
        evidence && typeof evidence === "object" &&
          !Array.isArray(evidence))) {
    observerFail("NOT_APPLICABLE_EVIDENCE_REJECTED");
  }
  state.notApplicable.set(operationId, evidence);
}

function createRawObservationState(executor, preflight) {
  return {
    executor,
    preflight,
    trace: [],
    executed: new Set(),
    notApplicable: new Map(),
  };
}

function validateNotApplicableEvidence(evidenceByOperationId) {
  const keys = assertRecord(
      evidenceByOperationId,
      "NOT_APPLICABLE_EVIDENCE",
  ).sort();
  const topologyIds =
    [...STANDALONE_NOT_APPLICABLE_MANDATORY_OPERATION_IDS].sort();
  const evidenceDerivedIds = keys.filter((operationId) =>
    !topologyIds.includes(operationId));
  if (evidenceDerivedIds.some((operationId) =>
    !EVIDENCE_DERIVED_NOT_APPLICABLE_MANDATORY_OPERATION_IDS.includes(
        operationId,
    )) ||
      topologyIds.some((operationId) => !keys.includes(operationId)) ||
      topologyIds.some((operationId) =>
        typeof evidenceByOperationId[operationId] !== "string")) {
    observerFail("NOT_APPLICABLE_EVIDENCE_REJECTED");
  }
  for (const operationId of evidenceDerivedIds) {
    const evidence = evidenceByOperationId[operationId];
    const evidenceKeys =
      assertRecord(evidence, "EVIDENCE_DERIVED_NOT_APPLICABLE").sort();
    const expectedKeys = [
      "emptyNameSetDigest",
      "listedResourceCount",
      "operationId",
      "paginationComplete",
      "parentResources",
      "prerequisiteListOperationId",
      "rawListEvidenceDigest",
      "reasonCode",
      "sourceLineage",
    ].sort();
    if (canonical(evidenceKeys) !== canonical(expectedKeys) ||
        evidence.operationId !== operationId ||
        evidence.reasonCode !== "EXHAUSTIVE_DENY_POLICY_LISTS_EMPTY" ||
        evidence.prerequisiteListOperationId !==
          "iam.v2.policies.denypolicies.list" ||
        evidence.paginationComplete !== true ||
        evidence.listedResourceCount !== 0 ||
        evidence.emptyNameSetDigest !== sha256Canonical([]) ||
        !Array.isArray(evidence.parentResources) ||
        new Set(evidence.parentResources).size !==
          evidence.parentResources.length ||
        !Array.isArray(evidence.sourceLineage) ||
        evidence.sourceLineage.length !== evidence.parentResources.length) {
      observerFail("NOT_APPLICABLE_EVIDENCE_REJECTED");
    }
    const sortedLineage = [...evidence.sourceLineage].sort((left, right) =>
      left.attachmentPoint.localeCompare(right.attachmentPoint));
    for (const [index, item] of sortedLineage.entries()) {
      const itemKeys =
        assertRecord(item, "NOT_APPLICABLE_SOURCE_LINEAGE").sort();
      const expectedItemKeys = [
        "attachmentPoint",
        "completedAtEpochMs",
        "nameSetDigest",
        "observedAtEpochMs",
        "operationId",
        "pageCount",
        "paginationComplete",
        "rawListResultDigest",
        "recordCount",
        "records",
        "transportExecutionId",
      ].sort();
      const digestProjection = {...item};
      delete digestProjection.rawListResultDigest;
      if (canonical(itemKeys) !== canonical(expectedItemKeys) ||
          item.attachmentPoint !== evidence.parentResources[index] ||
          item.operationId !== evidence.prerequisiteListOperationId ||
          item.paginationComplete !== true ||
          !Number.isSafeInteger(item.pageCount) ||
          item.pageCount < 1 ||
          item.recordCount !== 0 ||
          !Array.isArray(item.records) ||
          item.records.length !== 0 ||
          item.nameSetDigest !== evidence.emptyNameSetDigest ||
          item.rawListResultDigest !== sha256Canonical(digestProjection)) {
        observerFail("NOT_APPLICABLE_EVIDENCE_REJECTED");
      }
    }
    if (evidence.rawListEvidenceDigest !== sha256Canonical(sortedLineage) ||
        canonical(evidence.parentResources) !==
          canonical([...evidence.parentResources].sort())) {
      observerFail("NOT_APPLICABLE_EVIDENCE_REJECTED");
    }
  }
  return evidenceDerivedIds.sort();
}

function notApplicableStabilityProjection(evidenceByOperationId) {
  return Object.fromEntries(
      Object.entries(evidenceByOperationId)
          .sort(([left], [right]) => left.localeCompare(right))
          .map(([operationId, evidence]) => {
            if (typeof evidence === "string") {
              return [operationId, evidence];
            }
            return [operationId, {
              emptyNameSetDigest: evidence.emptyNameSetDigest,
              listedResourceCount: evidence.listedResourceCount,
              operationId: evidence.operationId,
              paginationComplete: evidence.paginationComplete,
              parentResources: [...evidence.parentResources],
              prerequisiteListOperationId:
                evidence.prerequisiteListOperationId,
              reasonCode: evidence.reasonCode,
              sourceLineage: evidence.sourceLineage.map((item) => ({
                attachmentPoint: item.attachmentPoint,
                nameSetDigest: item.nameSetDigest,
                operationId: item.operationId,
                pageCount: item.pageCount,
                paginationComplete: item.paginationComplete,
                recordCount: item.recordCount,
                records: item.records,
              })),
            }];
          }),
  );
}

function buildIamScanResult(state, iam) {
  const executedMandatoryOperationIds = [...state.executed].sort();
  const notApplicableMandatoryOperationIds =
    [...state.notApplicable.keys()].sort();
  if (executedMandatoryOperationIds.some((operationId) =>
    state.notApplicable.has(operationId))) {
    observerFail("IAM_SCAN_OPERATION_OVERLAP_REJECTED");
  }
  const notApplicableEvidence =
    Object.fromEntries([...state.notApplicable.entries()].sort());
  const evidenceDerivedNotApplicableOperationIds =
    validateNotApplicableEvidence(notApplicableEvidence);
  const standaloneProfile = deriveStandaloneProjectObserverProfile(
      PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
      evidenceDerivedNotApplicableOperationIds,
  );
  const operationProfile = {
    executedMandatoryOperationIds,
    notApplicableMandatoryOperationIds,
    evidenceDerivedNotApplicableOperationIds,
    notApplicableEvidence:
      notApplicableStabilityProjection(notApplicableEvidence),
    standaloneProfile,
  };
  const stabilityProjection = {
    iam,
    operationProfile,
  };
  return {
    iam,
    operationTrace: [...state.trace],
    executedMandatoryOperationIds,
    notApplicableMandatoryOperationIds,
    notApplicableEvidence,
    evidenceDerivedNotApplicableOperationIds,
    operationProfile,
    stabilityProjection,
    stabilityDigest: sha256Canonical(stabilityProjection),
  };
}

function mergeStableIamScan(parentState, firstScan, secondScan) {
  if (firstScan.stabilityDigest !== secondScan.stabilityDigest ||
      canonical(firstScan.stabilityProjection) !==
        canonical(secondScan.stabilityProjection)) {
    observerFail("INVENTORY_UNSTABLE");
  }
  for (const operationId of firstScan.executedMandatoryOperationIds) {
    if (parentState.notApplicable.has(operationId)) {
      observerFail("IAM_SCAN_OPERATION_OVERLAP_REJECTED");
    }
    parentState.executed.add(operationId);
  }
  for (const [operationId, evidence] of
    Object.entries(firstScan.notApplicableEvidence)) {
    markNotApplicable(parentState, operationId, evidence);
  }
  parentState.trace.push(
      ...firstScan.operationTrace,
      ...secondScan.operationTrace,
  );
}

async function observeStableRawIamPair(parentState, functions) {
  const firstState =
    createRawObservationState(parentState.executor, parentState.preflight);
  const secondState =
    createRawObservationState(parentState.executor, parentState.preflight);
  if (injectedMockRawIamStates.has(parentState)) {
    injectedMockRawIamStates.add(firstState);
    injectedMockRawIamStates.add(secondState);
  }
  const firstScan =
    buildIamScanResult(firstState, await observeRawIam(firstState, functions));
  const secondScan =
    buildIamScanResult(secondState, await observeRawIam(secondState, functions));
  mergeStableIamScan(parentState, firstScan, secondScan);
  return {firstScan, secondScan, iam: firstScan.iam};
}

function deriveOperationTraceSummary(operationTrace) {
  assertStandardArray(operationTrace, "OPERATION_TRACE");
  const counts = new Map();
  for (const event of operationTrace) {
    const keys = assertRecord(event, "OPERATION_TRACE_EVENT");
    if (!keys.includes("operationId") ||
        typeof event.operationId !== "string" ||
        !PROVIDER_OPERATION_IDS.includes(event.operationId)) {
      observerFail("OPERATION_TRACE_EVENT_REJECTED");
    }
    counts.set(event.operationId, (counts.get(event.operationId) ?? 0) + 1);
  }
  const operationIds = [...counts.keys()].sort();
  const executedMandatoryOperationIds = operationIds
      .filter((operationId) =>
        PROVIDER_MANDATORY_OPERATION_IDS.includes(operationId));
  const optionalDiagnosticOperationIds = operationIds
      .filter((operationId) =>
        PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS.includes(operationId));
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

async function observeRawRules(state) {
  const releaseInput = {
    operationId: "firebaserules.v1.projects.releases.get",
    pathParams: {
      projectId: PROVIDER_TARGET_PROJECT_ID,
      releaseId: "cloud.firestore",
    },
  };
  const firstRelease = await executeRaw(state, releaseInput);
  const release = firstRelease.response;
  if (release.name !==
      `projects/${PROVIDER_TARGET_PROJECT_ID}/releases/cloud.firestore`) {
    observerFail("RULES_RELEASE_IDENTITY_REJECTED");
  }
  const rulesetId = rawName(
      release.rulesetName,
      /^projects\/daegu-miami-production\/rulesets\/([^/]+)$/,
      "RULESET_LINEAGE_REJECTED",
  )[1];
  const rulesetInput = {
    operationId: "firebaserules.v1.projects.rulesets.get",
    pathParams: {
      projectId: PROVIDER_TARGET_PROJECT_ID,
      rulesetId,
    },
  };
  const firstRuleset = await executeRaw(state, rulesetInput);
  const secondRelease = await executeRaw(state, releaseInput);
  const secondRuleset = await executeRaw(state, rulesetInput);
  const projection = {
    release: {
      name: release.name,
      rulesetName: release.rulesetName,
      createTime: release.createTime,
      updateTime: release.updateTime,
    },
    ruleset: {
      name: firstRuleset.response.name,
      createTime: firstRuleset.response.createTime,
      metadata: firstRuleset.response.metadata ?? null,
        providerRulesetPayloadDigest:
          sha256Canonical(firstRuleset.response.source ?? null),
    },
  };
  const secondProjection = {
    release: {
      name: secondRelease.response.name,
      rulesetName: secondRelease.response.rulesetName,
      createTime: secondRelease.response.createTime,
      updateTime: secondRelease.response.updateTime,
    },
    ruleset: {
      name: secondRuleset.response.name,
      createTime: secondRuleset.response.createTime,
      metadata: secondRuleset.response.metadata ?? null,
        providerRulesetPayloadDigest:
          sha256Canonical(secondRuleset.response.source ?? null),
    },
  };
  if (canonical(projection) !== canonical(secondProjection) ||
      firstRuleset.response.name !== release.rulesetName) {
    observerFail("RULES_INVENTORY_UNSTABLE");
  }
  return projection;
}

function functionIdentityProjection(value) {
  try {
    assertHttpCallableRawFunctionRecord(value);
  } catch {
    observerFail("FUNCTION_EVENT_TRIGGER_REVIEW_REQUIRED");
  }
  const functionId = rawName(
      value.name,
      /^projects\/daegu-miami-production\/locations\/us-central1\/functions\/([^/]+)$/,
      "FUNCTION_IDENTITY_REJECTED",
  )[1];
  const serviceId = rawName(
      value.serviceConfig?.service,
      /^projects\/daegu-miami-production\/locations\/us-central1\/services\/([^/]+)$/,
      "FUNCTION_SERVICE_LINEAGE_REJECTED",
  )[1];
  const revisionId = rawName(
      value.serviceConfig?.revision,
      /^projects\/daegu-miami-production\/locations\/us-central1\/services\/[^/]+\/revisions\/([^/]+)$/,
      "FUNCTION_REVISION_LINEAGE_REJECTED",
  )[1];
  const buildId = rawName(
      value.buildName,
      /^projects\/daegu-miami-production\/locations\/us-central1\/builds\/([0-9a-fA-F-]{36})$/,
      "FUNCTION_BUILD_LINEAGE_REJECTED",
  )[1];
  const source = value.buildConfig?.source?.storageSource;
  if (value.environment !== EXPECTED_FUNCTION_GENERATION ||
      value.buildConfig?.runtime !== "nodejs24" ||
      !source || typeof source.bucket !== "string" ||
      typeof source.object !== "string" ||
      typeof source.generation !== "string" ||
      typeof value.serviceConfig?.serviceAccountEmail !== "string") {
    observerFail("FUNCTION_RUNTIME_CONTRACT_REJECTED");
  }
  return {
    functionId,
    name: value.name,
    environment: value.environment,
    runtime: value.buildConfig.runtime,
    updateTime: value.updateTime,
    serviceId,
    serviceName: value.serviceConfig.service,
    revisionId,
    revisionName: value.serviceConfig.revision,
    buildId,
    buildName: value.buildName,
    serviceAccountEmail: value.serviceConfig.serviceAccountEmail,
    triggerContractVersion: FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION,
    triggerContractId: FUNCTION_HTTP_TRIGGER_CONTRACT_ID,
    triggerContractDigest: FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST,
    triggerType: FUNCTION_HTTP_TRIGGER_TYPE,
    eventTriggerAbsent: true,
    source: {
      bucket: source.bucket,
      object: source.object,
      generation: source.generation,
    },
  };
}

function assertHttpCallableFunctionProjection(value) {
  if (!value || typeof value !== "object" ||
      Object.hasOwn(value, "eventTrigger") ||
      value.triggerContractVersion !== FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION ||
      value.triggerContractId !== FUNCTION_HTTP_TRIGGER_CONTRACT_ID ||
      value.triggerContractDigest !== FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST ||
      value.triggerType !== FUNCTION_HTTP_TRIGGER_TYPE ||
      value.eventTriggerAbsent !== true) {
    observerFail("FUNCTION_EVENT_TRIGGER_REVIEW_REQUIRED");
  }
}

function canonicalFunctionRecords(records) {
  return [...records].sort((left, right) =>
    left.functionId.localeCompare(right.functionId) ||
    canonical(left).localeCompare(canonical(right)));
}

function computeFunctionInventoryDigest({
  bucketIdentities,
  records,
  sourceBucketIdentitySetDigest,
  triggerEvidence,
}) {
  return sha256Canonical({
    bucketIdentities: [...bucketIdentities].sort((left, right) =>
      left.bucketName.localeCompare(right.bucketName)),
    records: canonicalFunctionRecords(records),
    sourceBucketIdentitySetDigest,
    triggerEvidence,
  });
}

function deriveSourceBucketIdentity(response, requestedBucket, functions) {
  const responseProjection = {
    name: response?.name,
    projectNumber: response?.projectNumber,
    location: response?.location,
    storageClass: response?.storageClass,
  };
  if (responseProjection.name !== requestedBucket ||
      typeof responseProjection.projectNumber !== "string" ||
      !/^[0-9]{1,30}$/.test(responseProjection.projectNumber) ||
      responseProjection.location !== "US-CENTRAL1" ||
      typeof responseProjection.storageClass !== "string" ||
      responseProjection.storageClass.length === 0) {
    observerFail("SOURCE_BUCKET_IDENTITY_REJECTED");
  }
  const functionIds = functions
      .filter(({source}) => source.bucket === requestedBucket)
      .map(({functionId}) => functionId)
      .sort();
  if (functionIds.length === 0 ||
      new Set(functionIds).size !== functionIds.length) {
    observerFail("SOURCE_BUCKET_PROVENANCE_REJECTED");
  }
  const functionSourceProvenance = {
    functionCount: functionIds.length,
    functionIds,
    functionIdSetDigest: sha256Canonical(functionIds),
  };
  const identity = {
    bucketName: requestedBucket,
    projectNumber: responseProjection.projectNumber,
    location: responseProjection.location,
    storageClass: responseProjection.storageClass,
    observationOperationId: "storage.v1.buckets.get",
    observationResponseDigest: sha256Canonical(responseProjection),
    functionSourceProvenance,
  };
  return {
    ...identity,
    bucketIdentityDigest: sha256Canonical(identity),
  };
}

function computeSourceBucketIdentitySetDigest(sourceBucketIdentities) {
  assertStandardArray(
      sourceBucketIdentities,
      "SOURCE_BUCKET_IDENTITY_SET",
  );
  if (sourceBucketIdentities.some(({bucketName}) =>
    typeof bucketName !== "string" || bucketName.length === 0) ||
      new Set(sourceBucketIdentities.map(({bucketName}) => bucketName)).size !==
        sourceBucketIdentities.length) {
    observerFail("SOURCE_BUCKET_IDENTITY_SET_REJECTED");
  }
  return sha256Canonical([...sourceBucketIdentities]
      .sort((left, right) => left.bucketName.localeCompare(right.bucketName)));
}

async function observeRawFunctionBoundary(state) {
  const projectPath = {
    projectId: PROVIDER_TARGET_PROJECT_ID,
    location: EXPECTED_FUNCTION_REGION,
  };
  const list = await executeRaw(state, {
    operationId: "cloudfunctions.v2.projects.locations.functions.list",
    pathParams: projectPath,
    query: {pageSize: 1000},
  });
  for (const record of list.records) {
    try {
      assertHttpCallableRawFunctionRecord(record);
    } catch {
      observerFail("FUNCTION_EVENT_TRIGGER_REVIEW_REQUIRED");
    }
  }
  const functionIds = list.records.map(({name}) => rawName(
      name,
      /^projects\/daegu-miami-production\/locations\/us-central1\/functions\/([^/]+)$/,
      "FUNCTION_LIST_IDENTITY_REJECTED",
  )[1]);
  exactSortedSet(
      functionIds,
      EXPECTED_DEPLOYED_FUNCTION_NAMES,
      "FUNCTION_COUNT_MISMATCH",
  );
  addProductionLineage(
      state.executor,
      "approved_function_id",
      functionIds,
  );
  const functions = [];
  const rawGetRecords = [];
  for (const functionId of [...functionIds].sort()) {
    const result = await executeRaw(state, {
      operationId: "cloudfunctions.v2.projects.locations.functions.get",
      pathParams: {...projectPath, functionId},
    });
    rawGetRecords.push(result.response);
    functions.push(functionIdentityProjection(result.response));
  }
  const bucketIdentities = [];
  const sourceBucketNames = [...new Set(functions.map(({source}) =>
    source.bucket))].sort();
  for (const bucket of sourceBucketNames) {
    const result = await executeRaw(state, {
      operationId: "storage.v1.buckets.get",
      pathParams: {bucket},
      query: {projection: "noAcl"},
    });
    bucketIdentities.push(
        deriveSourceBucketIdentity(result.response, bucket, functions),
    );
  }
  const sourceBucketIdentitySetDigest =
    computeSourceBucketIdentitySetDigest(bucketIdentities);
  const expectedServiceNames =
    functions.map(({serviceName}) => serviceName).sort();
  const servicesList = await executeRaw(state, {
    operationId: "run.v2.projects.locations.services.list",
    pathParams: projectPath,
    query: {pageSize: 1000},
  });
  exactSortedSet(
      servicesList.records.map(({name}) => name),
      expectedServiceNames,
      "RUN_SERVICE_LIST_MISMATCH",
  );
  const details = [];
  for (const item of functions) {
    const revisionsList = await executeRaw(state, {
      operationId: "run.v2.projects.locations.services.revisions.list",
      pathParams: {...projectPath, serviceId: item.serviceId},
      query: {pageSize: 1000},
    });
    if (!revisionsList.records.some(({name}) =>
      name === item.revisionName)) {
      observerFail("RUN_REVISION_LIST_MISMATCH");
    }
    const service = await executeRaw(state, {
      operationId: "run.v2.projects.locations.services.get",
      pathParams: {...projectPath, serviceId: item.serviceId},
    });
    const revision = await executeRaw(state, {
      operationId: "run.v2.projects.locations.services.revisions.get",
      pathParams: {
        ...projectPath,
        serviceId: item.serviceId,
        revisionId: item.revisionId,
      },
    });
    const build = await executeRaw(state, {
      operationId: "cloudbuild.v1.projects.locations.builds.get",
      pathParams: {...projectPath, buildId: item.buildId},
    });
    if (service.response.name !== item.serviceName ||
        service.response.latestReadyRevision !== item.revisionName ||
        revision.response.name !== item.revisionName ||
        build.response.id !== item.buildId ||
        build.response.status !== "SUCCESS" ||
        canonical(build.response.source?.storageSource) !==
          canonical(item.source)) {
      observerFail("FUNCTION_FIXED_LINEAGE_MISMATCH");
    }
    const storagePath = {
      bucket: item.source.bucket,
      object: item.source.object,
    };
    const metadata = await executeRaw(state, {
      operationId: "storage.v1.objects.getMetadata",
      pathParams: storagePath,
      query: {generation: item.source.generation},
    });
    const media = await executeRaw(state, {
      operationId: "storage.v1.objects.getMedia",
      pathParams: storagePath,
      query: {alt: "media", generation: item.source.generation},
    });
    if (metadata.response.bucket !== item.source.bucket ||
        metadata.response.name !== item.source.object ||
        metadata.response.generation !== item.source.generation ||
        metadata.response.md5Hash !== media.media.md5Hash ||
        Number(metadata.response.size) !== media.media.byteLength) {
      observerFail("FUNCTION_STORAGE_LINEAGE_MISMATCH");
    }
    details.push({
      ...item,
      service: {
        name: service.response.name,
        latestReadyRevision: service.response.latestReadyRevision,
        updateTime: service.response.updateTime,
      },
      revision: {
        name: revision.response.name,
        service: revision.response.service,
        createTime: revision.response.createTime,
      },
      build: {
        id: build.response.id,
        status: build.response.status,
        createTime: build.response.createTime,
        finishTime: build.response.finishTime,
      },
      storage: {
        bucket: metadata.response.bucket,
        name: metadata.response.name,
        generation: metadata.response.generation,
        size: metadata.response.size,
        md5Hash: metadata.response.md5Hash,
        sha256: media.media.sha256,
      },
    });
  }
  const sortedDetails = details.sort((left, right) =>
    left.functionId.localeCompare(right.functionId));
  const triggerEvidence = buildFunctionTriggerAbsenceEvidence(
      rawGetRecords,
      sortedDetails,
      list.records,
  );
  return {
    listExecutionId: list.transportExecutionId,
    bucketIdentities,
    sourceBucketIdentitySetDigest,
    triggerEvidence,
    records: sortedDetails,
  };
}

async function observeRawFunctions(state) {
  if (EXPECTED_DEPLOYED_FUNCTION_NAMES.length !== 35 ||
      EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length !== 26) {
    observerFail("LOCAL_FUNCTION_CONTRACT_REJECTED");
  }
  const first = await observeRawFunctionBoundary(state);
  const second = await observeRawFunctionBoundary(state);
  if (first.listExecutionId === second.listExecutionId ||
      canonical(first.records) !== canonical(second.records) ||
      canonical(first.triggerEvidence) !== canonical(second.triggerEvidence) ||
      canonical(first.bucketIdentities) !==
        canonical(second.bucketIdentities) ||
      first.sourceBucketIdentitySetDigest !==
        second.sourceBucketIdentitySetDigest) {
    observerFail("INVENTORY_UNSTABLE");
  }
  const inventory = {
    bucketIdentities: first.bucketIdentities,
    records: first.records,
    sourceBucketIdentitySetDigest: first.sourceBucketIdentitySetDigest,
    triggerEvidence: first.triggerEvidence,
  };
  return {
    functionCount: first.records.length,
    guardedFunctionCount: EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length,
    inventoryDigest: computeFunctionInventoryDigest(inventory),
    bucketIdentities: first.bucketIdentities,
    sourceBucketIdentitySetDigest: first.sourceBucketIdentitySetDigest,
    triggerEvidence: first.triggerEvidence,
    records: first.records,
  };
}

function normalizePolicyBindings(policy, attachmentPoint) {
  if (!Array.isArray(policy.bindings)) {
    observerFail("IAM_POLICY_BINDINGS_REJECTED");
  }
  return policy.bindings.flatMap((binding) => {
    if (typeof binding.role !== "string" ||
        !Array.isArray(binding.members)) {
      observerFail("IAM_POLICY_BINDING_REJECTED");
    }
    return binding.members.map((member) => {
      if (typeof member !== "string") {
        observerFail("IAM_POLICY_MEMBER_REJECTED");
      }
      return {
        attachmentPoint,
        role: binding.role,
        member,
        condition: binding.condition ? {
          title: binding.condition.title ?? "",
          description: binding.condition.description ?? "",
          expression: binding.condition.expression,
        } : null,
      };
    });
  });
}

function hasCompleteGroupExpansionEvidence(bindings, analyses) {
  const knownGroups = [...new Set(bindings
      .map(({member}) => member)
      .filter((member) => member.startsWith("group:")))];
  return knownGroups.every((group) => analyses.some((analysis) =>
    analysis.identity === group &&
    analysis.fullyExplored === true &&
    Array.isArray(analysis.analysisResults) &&
    analysis.analysisResults.length > 0 &&
    Array.isArray(analysis.groupEdges) &&
    analysis.groupEdges.length > 0));
}

function hierarchyIdentityProjection({
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

function createObservedHierarchyResource({
  kind,
  singular,
  id,
  name,
  parentResourceName,
  hierarchyDepth,
}) {
  const identity = hierarchyIdentityProjection({
    resourceType: singular,
    canonicalResourceName: name,
    projectId: PROVIDER_TARGET_PROJECT_ID,
    projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
    parentResourceName,
    providerObservationSource:
      `cloudresourcemanager.v3.${kind}.get`,
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

function deriveAuthoritativeIamResourceUniverse({
  hierarchy,
  serviceAccounts,
  denyPolicies,
}) {
  for (const [label, value] of [
    ["IAM_HIERARCHY", hierarchy],
    ["IAM_SERVICE_ACCOUNTS", serviceAccounts],
    ["IAM_DENY_POLICIES", denyPolicies],
  ]) assertStandardArray(value, label);
  const hierarchyByName = new Map();
  const hierarchyByIdentity = new Map();
  for (const resource of hierarchy) {
    const expectedKeys = [
      "canonicalResourceName",
      "hierarchyDepth",
      "id",
      "kind",
      "name",
      "parentResourceName",
      "projectId",
      "projectNumber",
      "providerObservationSource",
      "resourceIdentityDigest",
      "resourceType",
      "singular",
    ];
    assertExactOrSubsetKeys(
        resource,
        expectedKeys,
        expectedKeys,
        "IAM_HIERARCHY_RESOURCE",
    );
    const kindMatch =
      /^(projects|folders|organizations)$/.exec(resource.kind);
    if (!kindMatch) observerFail("IAM_HIERARCHY_RESOURCE_REJECTED");
    const expectedSingular = resource.kind.slice(0, -1);
    const expectedName = resource.kind === "projects" ?
      `projects/${PROVIDER_TARGET_PROJECT_ID}` :
      `${resource.kind}/${resource.id}`;
    const idPattern = resource.kind === "projects" ?
      /^daegu-miami-production$/ :
      /^[0-9]+$/;
    const expectedSource =
      `cloudresourcemanager.v3.${resource.kind}.get`;
    if (resource.singular !== expectedSingular ||
        resource.resourceType !== expectedSingular ||
        typeof resource.id !== "string" ||
        !idPattern.test(resource.id) ||
        resource.name !== expectedName ||
        resource.canonicalResourceName !== expectedName ||
        resource.projectId !== PROVIDER_TARGET_PROJECT_ID ||
        resource.projectNumber !== PROVIDER_TARGET_PROJECT_NUMBER ||
        resource.providerObservationSource !== expectedSource ||
        !Number.isSafeInteger(resource.hierarchyDepth) ||
        resource.hierarchyDepth < 0 ||
        !(resource.parentResourceName === null ||
          typeof resource.parentResourceName === "string")) {
      observerFail("IAM_HIERARCHY_RESOURCE_REJECTED");
    }
    const identity = hierarchyIdentityProjection(resource);
    if (resource.resourceIdentityDigest !== sha256Canonical(identity)) {
      observerFail("IAM_HIERARCHY_RESOURCE_DIGEST_REJECTED");
    }
    if (hierarchyByName.has(resource.name)) {
      observerFail("IAM_HIERARCHY_DUPLICATE_RESOURCE_REJECTED");
    }
    const typeAndId = `${resource.resourceType}:${resource.id}`;
    if (hierarchyByIdentity.has(typeAndId)) {
      observerFail("IAM_HIERARCHY_DUPLICATE_RESOURCE_REJECTED");
    }
    hierarchyByName.set(resource.name, resource);
    hierarchyByIdentity.set(typeAndId, resource.name);
  }
  const projectName = `projects/${PROVIDER_TARGET_PROJECT_ID}`;
  const project = hierarchyByName.get(projectName);
  if (!project || project.resourceType !== "project") {
    observerFail("IAM_HIERARCHY_PROJECT_REJECTED");
  }
  const ancestry = [];
  const visited = new Set();
  let current = project;
  let expectedDepth = 0;
  while (current) {
    if (visited.has(current.name)) {
      observerFail("IAM_HIERARCHY_CYCLE_REJECTED");
    }
    visited.add(current.name);
    if (current.hierarchyDepth !== expectedDepth) {
      observerFail("IAM_HIERARCHY_DEPTH_REJECTED");
    }
    ancestry.push(current);
    const parentName = current.parentResourceName;
    if (current.resourceType === "organization") {
      if (parentName !== null) observerFail("IAM_HIERARCHY_ROOT_REJECTED");
      current = null;
      continue;
    }
    if (parentName === null) {
      if (current.resourceType === "folder") {
        observerFail("IAM_HIERARCHY_ROOT_REJECTED");
      }
      current = null;
      continue;
    }
    const parent = hierarchyByName.get(parentName);
    if (!parent) observerFail("IAM_HIERARCHY_UNKNOWN_ANCESTOR_REJECTED");
    if (current.resourceType === "project" &&
        !["folder", "organization"].includes(parent.resourceType)) {
      observerFail("IAM_HIERARCHY_TYPE_REJECTED");
    }
    if (current.resourceType === "folder" &&
        !["folder", "organization"].includes(parent.resourceType)) {
      observerFail("IAM_HIERARCHY_TYPE_REJECTED");
    }
    current = parent;
    expectedDepth += 1;
  }
  if (visited.size !== hierarchyByName.size) {
    observerFail("IAM_HIERARCHY_DISCONNECTED_RESOURCE_REJECTED");
  }
  const hierarchyResources = ancestry
      .map((resource) => ({
        ...hierarchyIdentityProjection(resource),
        resourceIdentityDigest: resource.resourceIdentityDigest,
      }))
      .sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const serviceAccountResources = [];
  const accountNames = new Set();
  const accountEmails = new Set();
  const accountUniqueIds = new Set();
  for (const account of serviceAccounts) {
    const match = typeof account.name === "string" ?
      /^projects\/(daegu-miami-production)\/serviceAccounts\/([^/@\s]+@[^/@\s]+\.gserviceaccount\.com)$/
          .exec(account.name) :
      null;
    if (!match ||
        typeof account.email !== "string" ||
        match[1] !== PROVIDER_TARGET_PROJECT_ID ||
        match[2] !== account.email ||
        !account.policy ||
        typeof account.policy !== "object" ||
        !Array.isArray(account.policy.bindings)) {
      observerFail("SERVICE_ACCOUNT_RESOURCE_IDENTITY_REJECTED");
    }
    if (accountNames.has(account.name) || accountEmails.has(account.email)) {
      observerFail("SERVICE_ACCOUNT_RESOURCE_DUPLICATE_REJECTED");
    }
    accountNames.add(account.name);
    accountEmails.add(account.email);
    if (account.uniqueId !== undefined) {
      if (typeof account.uniqueId !== "string" ||
          account.uniqueId.length === 0 ||
          accountUniqueIds.has(account.uniqueId)) {
        observerFail("SERVICE_ACCOUNT_UNIQUE_ID_REJECTED");
      }
      accountUniqueIds.add(account.uniqueId);
    }
    if (account.policy.bindings.some((binding) =>
      binding.attachmentPoint !== account.name)) {
      observerFail("SERVICE_ACCOUNT_POLICY_ATTACHMENT_REJECTED");
    }
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
    serviceAccountResources.push({
      ...identity,
      resourceIdentityDigest: sha256Canonical(identity),
    });
  }
  const hierarchyResourceByName =
    new Map(hierarchyResources.map((resource) =>
      [resource.canonicalResourceName, resource]));
  const serviceAccountResourceByName =
    new Map(serviceAccountResources.map((resource) =>
      [resource.canonicalResourceName, resource]));
  for (const denyPolicy of denyPolicies) {
    if (!hierarchyResourceByName.has(denyPolicy.attachmentPoint)) {
      observerFail("IAM_DENY_POLICY_ATTACHMENT_REJECTED");
    }
  }
  return {
    hierarchyResourceByName,
    serviceAccountResourceByName,
    approvedServiceAccountMembers:
      new Set(serviceAccountResources.map(({email}) =>
        `serviceAccount:${email}`)),
    resourceUniverseDigest: sha256Canonical({
      hierarchyResources,
      serviceAccountResources:
        [...serviceAccountResources].sort((left, right) =>
          canonical(left).localeCompare(canonical(right))),
    }),
  };
}

function deriveCanonicalIamBindingUniverse({
  hierarchy,
  policies,
  serviceAccounts,
  roles,
  analyses,
  denyPolicies,
}) {
  for (const [label, value] of [
    ["IAM_HIERARCHY", hierarchy],
    ["IAM_POLICIES", policies],
    ["IAM_SERVICE_ACCOUNTS", serviceAccounts],
    ["IAM_ROLES", roles],
    ["IAM_ANALYSES", analyses],
    ["IAM_DENY_POLICIES", denyPolicies],
  ]) assertStandardArray(value, label);
  const resources = deriveAuthoritativeIamResourceUniverse({
    hierarchy,
    serviceAccounts,
    denyPolicies,
  });
  const roleMap = new Map(roles.map((role) => [role.name, role]));
  const policyAttachments = new Set();
  const rawBindings = [
    ...policies.flatMap((policy) => {
      const resource =
        resources.hierarchyResourceByName.get(policy.attachmentPoint);
      if (!resource ||
          policyAttachments.has(policy.attachmentPoint) ||
          !Array.isArray(policy.bindings) ||
          policy.bindings.some((binding) =>
            binding.attachmentPoint !== policy.attachmentPoint)) {
        observerFail("IAM_POLICY_RESOURCE_IDENTITY_REJECTED");
      }
      policyAttachments.add(policy.attachmentPoint);
      return policy.bindings.map((binding) => ({
        binding,
        policySource: "resource_manager_iam_policy",
        resourceName: policy.attachmentPoint,
        hierarchyResourceIdentityDigest: resource.resourceIdentityDigest,
        serviceAccountResourceIdentityDigest: null,
      }));
    }),
    ...serviceAccounts.flatMap((account) => {
      const resource =
        resources.serviceAccountResourceByName.get(account.name);
      if (!resource) observerFail("SERVICE_ACCOUNT_RESOURCE_IDENTITY_REJECTED");
      return account.policy.bindings.map((binding) => ({
        binding,
        policySource: "service_account_iam_policy",
        resourceName: account.name,
        hierarchyResourceIdentityDigest: null,
        serviceAccountResourceIdentityDigest: resource.resourceIdentityDigest,
      }));
    }),
  ];
  if (policyAttachments.size !== resources.hierarchyResourceByName.size) {
    observerFail("IAM_POLICY_RESOURCE_COVERAGE_REJECTED");
  }
  const canonicalBindings = rawBindings.map(({
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
      resources.hierarchyResourceByName.get(resourceName) :
      resources.serviceAccountResourceByName.get(resourceName);
    if (!resource) observerFail("IAM_BINDING_RESOURCE_IDENTITY_REJECTED");
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
        resource.resourceType === "project" ? "direct" :
        resource.resourceType === "serviceAccount" ? "direct" :
        "inherited",
      roleExpansionComplete,
      permissions,
      permissionExpansionDigest: sha256Canonical(permissions),
      hierarchyResourceIdentityDigest,
      serviceAccountResourceIdentityDigest,
    };
  }).sort((left, right) => canonical(left).localeCompare(canonical(right)));
  const bindingIdentities = canonicalBindings.map(canonical);
  if (new Set(bindingIdentities).size !== bindingIdentities.length) {
    observerFail("IAM_DUPLICATE_BINDING_REJECTED");
  }
  const approvedMembers = new Set([
    ...KNOWN_IAM_GROUPS,
    ...resources.approvedServiceAccountMembers,
  ]);
  const unknownPrincipals = [...new Set(canonicalBindings
      .map(({member}) => member)
      .filter((member) => !approvedMembers.has(member)))].sort();
  const unknownRoles = [...new Set(canonicalBindings
      .filter(({roleExpansionComplete}) => !roleExpansionComplete)
      .map(({role}) => role))].sort();
  const reviewedPermissions = new Set(REVIEWED_PERMISSION_UNIVERSE);
  const expandedPermissions =
    canonicalBindings.flatMap(({permissions}) => permissions);
  const analyzedPermissions = analyses.flatMap(({analysisResults}) =>
    analysisResults.flatMap((result) =>
      result?.accessControlLists?.flatMap((list) =>
        list?.accesses?.map(({permission}) => permission) ?? []) ?? []));
  const unknownPermissions = [...new Set([
    ...expandedPermissions,
    ...analyzedPermissions,
  ].filter((permission) =>
    typeof permission !== "string" ||
      !reviewedPermissions.has(permission)))].sort();
  const writablePermissions = new Set(REVIEWED_WRITABLE_PERMISSIONS);
  const writableBindings = canonicalBindings.filter(({permissions}) =>
    permissions.some((permission) => writablePermissions.has(permission)));
  const unresolvedConditions =
    canonicalBindings.filter(({condition}) => condition !== null);
  const unknownScopes =
    canonicalBindings.filter(({resourceType}) => resourceType === "unknown");
  const hasDomain =
    canonicalBindings.some(({member}) => member.startsWith("domain:"));
  const groupExpansionComplete =
    hasCompleteGroupExpansionEvidence(canonicalBindings, analyses);
  const exactStringSet = (value) =>
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && item.length > 0) &&
    new Set(value).size === value.length;
  const denyPolicyAnalysisComplete = denyPolicies.every((policy) => {
    if (!policy || typeof policy !== "object" ||
        typeof policy.attachmentPoint !== "string" ||
        typeof policy.name !== "string" ||
        typeof policy.updateTime !== "string" ||
        !Array.isArray(policy.rules)) {
      return false;
    }
    return policy.rules.every((rule) => {
      if (!rule || typeof rule !== "object" || Array.isArray(rule) ||
          Object.keys(rule).some((key) =>
            !["denyRule", "description"].includes(key)) ||
          typeof rule.denyRule !== "object" ||
          rule.denyRule === null ||
          Array.isArray(rule.denyRule)) {
        return false;
      }
      const denyRule = rule.denyRule;
      if (Object.keys(denyRule).some((key) => ![
        "deniedPrincipals",
        "exceptionPrincipals",
        "deniedPermissions",
        "exceptionPermissions",
        "denialCondition",
      ].includes(key)) ||
          !exactStringSet(denyRule.deniedPrincipals ?? []) ||
          !exactStringSet(denyRule.exceptionPrincipals ?? []) ||
          !exactStringSet(denyRule.deniedPermissions ?? []) ||
          !exactStringSet(denyRule.exceptionPermissions ?? [])) {
        return false;
      }
      const condition = denyRule.denialCondition;
      return condition === undefined ||
        condition !== null &&
        typeof condition === "object" &&
        !Array.isArray(condition) &&
        Object.keys(condition).every((key) =>
          ["title", "description", "expression", "location"].includes(key)) &&
        typeof condition.expression === "string" &&
        condition.expression.length > 0;
    });
  });
  const iamExpansionComplete =
    unknownPrincipals.length === 0 &&
    unknownRoles.length === 0 &&
    unknownPermissions.length === 0 &&
    unknownScopes.length === 0;
  const conditionAnalysisComplete = unresolvedConditions.length === 0;
  const domainExpansionComplete = !hasDomain;
  const bindingSetDigest = sha256Canonical(canonicalBindings);
  return {
    bindings: canonicalBindings,
    writableBindings,
    unknownPrincipals,
    unknownRoles,
    unknownPermissions,
    unknownScopes,
    unresolvedConditions,
    bindingSetDigest,
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

async function observeRawIam(state, functions) {
  const project = await executeRaw(state, {
    operationId: "cloudresourcemanager.v3.projects.get",
    pathParams: {projectId: PROVIDER_TARGET_PROJECT_ID},
  });
  if (project.response.name !==
        `projects/${PROVIDER_TARGET_PROJECT_ID}` ||
      project.response.projectId !== PROVIDER_TARGET_PROJECT_ID ||
      String(project.response.projectNumber) !==
        PROVIDER_TARGET_PROJECT_NUMBER) {
    observerFail("PROJECT_IDENTITY_REJECTED");
  }
  let parent = project.response.parent ?? null;
  if (parent !== null && typeof parent !== "string") {
    observerFail("PROJECT_HIERARCHY_REJECTED");
  }
  const resources = [createObservedHierarchyResource({
    kind: "projects",
    singular: "project",
    id: PROVIDER_TARGET_PROJECT_ID,
    name: project.response.name,
    parentResourceName: parent,
    hierarchyDepth: 0,
  })];
  const observedHierarchyNames = new Set([project.response.name]);
  let hierarchyDepth = 1;
  while (parent !== null) {
    const match = /^(folders|organizations)\/([0-9]+)$/.exec(parent);
    if (!match) observerFail("PROJECT_HIERARCHY_REJECTED");
    if (observedHierarchyNames.has(parent)) {
      observerFail("PROJECT_HIERARCHY_CYCLE_REJECTED");
    }
    const kind = match[1];
    const singular = kind === "folders" ? "folder" : "organization";
    const id = match[2];
    addProductionLineage(state.executor, "discovered_parent_lineage", [
      id,
      `cloudresourcemanager.googleapis.com/${kind}/${id}`,
    ]);
    const parentResult = await executeRaw(state, {
      operationId: `cloudresourcemanager.v3.${kind}.get`,
      pathParams: {[`${singular}Id`]: id},
    });
    if (parentResult.response.name !== parent) {
      observerFail("PROJECT_HIERARCHY_IDENTITY_REJECTED");
    }
    const nextParent = parentResult.response.parent ?? null;
    if (nextParent !== null && typeof nextParent !== "string") {
      observerFail("PROJECT_HIERARCHY_REJECTED");
    }
    if (kind === "organizations" && nextParent !== null) {
      observerFail("PROJECT_HIERARCHY_ROOT_REJECTED");
    }
    resources.push(createObservedHierarchyResource({
      kind,
      singular,
      id,
      name: parent,
      parentResourceName: nextParent,
      hierarchyDepth,
    }));
    observedHierarchyNames.add(parent);
    parent = nextParent;
    hierarchyDepth += 1;
  }
  for (const {kind} of [
    {kind: "folders"},
    {kind: "organizations"},
  ]) {
    if (!resources.some((resource) => resource.kind === kind)) {
      markNotApplicable(
          state,
          `cloudresourcemanager.v3.${kind}.get`,
          `VALIDATED_HIERARCHY_CONTAINS_NO_${kind.toUpperCase()}`,
      );
      markNotApplicable(
          state,
          `cloudresourcemanager.v3.${kind}.getIamPolicy`,
          `VALIDATED_HIERARCHY_CONTAINS_NO_${kind.toUpperCase()}`,
      );
    }
  }
  const policies = [];
  for (const resource of resources) {
    const result = await executeRaw(state, {
      operationId:
        `cloudresourcemanager.v3.${resource.kind}.getIamPolicy`,
      pathParams: {[`${resource.singular}Id`]: resource.id},
      body: {options: {requestedPolicyVersion: 3}},
    });
    const normalized =
      normalizePolicyBindings(result.response, resource.name);
    policies.push({
      attachmentPoint: resource.name,
      version: result.response.version,
      etag: result.response.etag,
      bindings: normalized,
    });
  }
  const roleListInput = {
    operationId: "iam.v1.projects.roles.list",
    pathParams: {projectId: PROVIDER_TARGET_PROJECT_ID},
    query: {pageSize: 1000},
  };
  const firstRoles = await executeRaw(state, roleListInput);
  exactSortedSet(
      firstRoles.records.map(({name}) => name),
      REVIEWED_IAM_ROLE_DEFINITIONS.map(({role}) => role),
      "IAM_ROLE_INVENTORY_REJECTED",
  );
  const roles = [];
  for (const listed of firstRoles.records) {
    const roleId = rawName(
        listed.name,
        /^projects\/daegu-miami-production\/roles\/([^/]+)$/,
        "IAM_ROLE_IDENTITY_REJECTED",
    )[1];
    const role = await executeRaw(state, {
      operationId: "iam.v1.projects.roles.get",
      pathParams: {
        projectId: PROVIDER_TARGET_PROJECT_ID,
        roleId,
      },
    });
    const normalized = {
      name: role.response.name,
      includedPermissions:
        [...role.response.includedPermissions].sort(),
      permissionsComplete: role.response.permissionsComplete === true,
      deleted: role.response.deleted === true,
      stage: role.response.stage,
    };
    const reviewed = REVIEWED_IAM_ROLE_DEFINITIONS.find(
        ({role: name}) => name === normalized.name,
    );
    if (!reviewed ||
        canonical(normalized.includedPermissions) !==
          canonical([...reviewed.permissions].sort()) ||
        normalized.permissionsComplete !== reviewed.permissionsComplete ||
        normalized.deleted !== reviewed.deleted ||
        normalized.stage !== reviewed.stage) {
      observerFail("IAM_ROLE_DEFINITION_REJECTED");
    }
    roles.push(normalized);
  }
  const secondRoles = await executeRaw(state, roleListInput);
  if (canonical(firstRoles.records) !== canonical(secondRoles.records)) {
    observerFail("INVENTORY_UNSTABLE");
  }
  const accountListInput = {
    operationId: "iam.v1.projects.serviceAccounts.list",
    pathParams: {projectId: PROVIDER_TARGET_PROJECT_ID},
    query: {pageSize: 100},
  };
  const firstAccounts = await executeRaw(state, accountListInput);
  const accountEmails = firstAccounts.records.map(({email}) => email).sort();
  if (accountEmails.length === 0 || new Set(accountEmails).size !==
      accountEmails.length) {
    observerFail("SERVICE_ACCOUNT_INVENTORY_REJECTED");
  }
  addProductionLineage(
      state.executor,
      "approved_service_account_email",
      accountEmails,
  );
  const accounts = [];
  for (const email of accountEmails) {
    const account = await executeRaw(state, {
      operationId: "iam.v1.projects.serviceAccounts.get",
      pathParams: {
        projectId: PROVIDER_TARGET_PROJECT_ID,
        serviceAccount: email,
      },
    });
    const policy = await executeRaw(state, {
      operationId: "iam.v1.projects.serviceAccounts.getIamPolicy",
      pathParams: {
        projectId: PROVIDER_TARGET_PROJECT_ID,
        serviceAccount: email,
      },
      body: {options: {requestedPolicyVersion: 3}},
    });
    if (account.response.name !==
          `projects/${PROVIDER_TARGET_PROJECT_ID}/serviceAccounts/${email}` ||
        account.response.email !== email ||
        account.response.projectId !== PROVIDER_TARGET_PROJECT_ID) {
      observerFail("SERVICE_ACCOUNT_IDENTITY_REJECTED");
    }
    accounts.push({
      name: account.response.name,
      email,
      uniqueId: account.response.uniqueId,
      disabled: account.response.disabled === true,
      policy: {
        version: policy.response.version,
        etag: policy.response.etag,
        bindings: normalizePolicyBindings(
            policy.response,
            account.response.name,
        ),
      },
    });
  }
  const secondAccounts = await executeRaw(state, accountListInput);
  if (canonical(firstAccounts.records) !== canonical(secondAccounts.records)) {
    observerFail("INVENTORY_UNSTABLE");
  }
  const projectFullResource =
    `//cloudresourcemanager.googleapis.com/projects/${PROVIDER_TARGET_PROJECT_ID}`;
  const collectedRawBindings = [
    ...policies.flatMap(({bindings: policyBindings}) => policyBindings),
    ...accounts.flatMap(({policy}) => policy.bindings),
  ];
  const observedIdentities = [...new Set([
    ...KNOWN_IAM_GROUPS,
    ...accountEmails.map((email) => `serviceAccount:${email}`),
    ...collectedRawBindings.map(({member}) => member)
        .filter((member) =>
          /^(?:serviceAccount|group|domain):/.test(member)),
  ])].sort();
  addProductionLineage(
      state.executor,
      "approved_principal",
      observedIdentities,
  );
  addProductionLineage(
      state.executor,
      "approved_iam_principal_or_group",
      observedIdentities,
  );
  const analyses = [];
  for (const identity of observedIdentities) {
    const analysis = await executeRaw(state, {
      operationId: "cloudasset.v1.projects.analyzeIamPolicy",
      pathParams: {projectNumber: PROVIDER_TARGET_PROJECT_NUMBER},
      query: {
        "analysisQuery.accessSelector.permissions":
          [...REVIEWED_PERMISSION_UNIVERSE],
        "analysisQuery.identitySelector.identity": identity,
        "analysisQuery.resourceSelector.fullResourceName":
          projectFullResource,
        executionTimeout: "90s",
        "options.expandGroups": true,
        "options.expandResources": true,
        "options.expandRoles": true,
        "options.outputGroupEdges": true,
        "options.outputResourceEdges": true,
      },
    });
    if (analysis.response.fullyExplored !== true ||
        !Array.isArray(analysis.response.mainAnalysis?.analysisResults) ||
        !Array.isArray(analysis.response.mainAnalysis?.groupEdges)) {
      observerFail("IAM_EXPANSION_INCOMPLETE");
    }
    analyses.push({
      identity,
      fullyExplored: true,
      analysisResults: analysis.response.mainAnalysis.analysisResults,
      groupEdges: analysis.response.mainAnalysis.groupEdges,
      resourceEdges: analysis.response.mainAnalysis.resourceEdges ?? [],
    });
  }
  const denyPolicies = [];
  const denyListSourceLineage = [];
  const listedDenyPolicyNames = new Set();
  for (const resource of resources) {
    const attachmentPoint =
      `cloudresourcemanager.googleapis.com/${resource.kind}/${resource.id}`;
    const list = await executeRaw(state, {
      operationId: "iam.v2.policies.denypolicies.list",
      pathParams: {attachmentPoint},
      query: {pageSize: 100},
    });
    const listedNames = list.records.map(({name}) => name).sort();
    const listLineageProjection = {
      attachmentPoint: resource.name,
      operationId: list.operationId,
      transportExecutionId: list.transportExecutionId,
      pageCount: list.pageCount,
      recordCount: list.recordCount,
      paginationComplete: list.paginationComplete,
      observedAtEpochMs: list.observedAtEpochMs,
      completedAtEpochMs: list.completedAtEpochMs,
      records: list.records,
      nameSetDigest: sha256Canonical(listedNames),
    };
    denyListSourceLineage.push({
      ...listLineageProjection,
      rawListResultDigest: sha256Canonical(listLineageProjection),
    });
    for (const listed of list.records) {
      const policyId = rawName(
          listed.name,
          /\/denypolicies\/([^/]+)$/,
          "DENY_POLICY_IDENTITY_REJECTED",
      )[1];
      const acceptedNames = [
        `policies/${attachmentPoint}/denypolicies/${policyId}`,
        `policies/${encodeURIComponent(attachmentPoint)}` +
          `/denypolicies/${policyId}`,
      ];
      if (!acceptedNames.includes(listed.name) ||
          listedDenyPolicyNames.has(listed.name)) {
        observerFail("DENY_POLICY_IDENTITY_REJECTED");
      }
      listedDenyPolicyNames.add(listed.name);
      const policy = await executeRaw(state, {
        operationId: "iam.v2.policies.denypolicies.get",
        pathParams: {attachmentPoint, policyId},
      });
      if (policy.response.name !== listed.name) {
        observerFail("DENY_POLICY_LINEAGE_REJECTED");
      }
      denyPolicies.push({
        attachmentPoint: resource.name,
        name: policy.response.name,
        updateTime: policy.response.updateTime,
        rules: policy.response.rules ?? [],
      });
    }
  }
  if (denyPolicies.length === 0) {
    const sourceLineage = denyListSourceLineage.sort((left, right) =>
      left.attachmentPoint.localeCompare(right.attachmentPoint));
    const parentResources =
      sourceLineage.map(({attachmentPoint}) => attachmentPoint);
    markNotApplicable(
        state,
        "iam.v2.policies.denypolicies.get",
        {
          operationId: "iam.v2.policies.denypolicies.get",
          reasonCode: "EXHAUSTIVE_DENY_POLICY_LISTS_EMPTY",
          prerequisiteListOperationId: "iam.v2.policies.denypolicies.list",
          parentResources,
          paginationComplete:
            sourceLineage.every(({paginationComplete}) =>
              paginationComplete === true),
          listedResourceCount:
            sourceLineage.reduce((total, item) =>
              total + item.recordCount, 0),
          emptyNameSetDigest: sha256Canonical([]),
          rawListEvidenceDigest: sha256Canonical(sourceLineage),
          sourceLineage,
        },
    );
  }
  const services = [];
  for (const serviceName of REQUIRED_SERVICE_USAGE_SERVICES) {
    const service = await executeRaw(state, {
      operationId: "serviceusage.v1.projects.services.get",
      pathParams: {
        projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
        serviceName,
      },
    });
    if (service.response.name !==
          `projects/${PROVIDER_TARGET_PROJECT_NUMBER}/services/${serviceName}` ||
        service.response.state !== "ENABLED") {
      observerFail("REQUIRED_SERVICE_DISABLED");
    }
    services.push({name: serviceName, state: service.response.state});
  }
  const iamUniverse = deriveCanonicalIamBindingUniverse({
    hierarchy: resources,
    policies,
    serviceAccounts: accounts,
    roles,
    analyses,
    denyPolicies,
  });
  return {
    policyAnalysisComplete: iamUniverse.policyAnalysisComplete,
    iamExpansionComplete: iamUniverse.iamExpansionComplete,
    conditionAnalysisComplete: iamUniverse.conditionAnalysisComplete,
    domainExpansionComplete: iamUniverse.domainExpansionComplete,
    groupExpansionComplete: iamUniverse.groupExpansionComplete,
    denyPolicyAnalysisComplete: iamUniverse.denyPolicyAnalysisComplete,
    unknownPrincipals: iamUniverse.unknownPrincipals,
    unknownRoles: iamUniverse.unknownRoles,
    unknownPermissions: iamUniverse.unknownPermissions,
    unknownScopes: iamUniverse.unknownScopes,
    unresolvedConditions: iamUniverse.unresolvedConditions,
    writableBindings: iamUniverse.writableBindings,
    bindingSetDigest: iamUniverse.bindingSetDigest,
    resourceUniverseDigest: iamUniverse.resourceUniverseDigest,
    hierarchy: resources,
    policies,
    bindings: iamUniverse.bindings,
    roles,
    serviceAccounts: accounts,
    cloudAssetAnalyses: analyses,
    denyPolicies,
    requiredServices: services,
    runtimeServiceAccounts:
      functions.records.map(({functionId, serviceAccountEmail}) =>
        ({functionId, serviceAccountEmail})),
    digest: sha256Canonical({
      resources,
      policies,
      bindings: iamUniverse.bindings,
      roles,
      accounts,
      analyses,
      denyPolicies,
      services,
      bindingSetDigest: iamUniverse.bindingSetDigest,
      resourceUniverseDigest: iamUniverse.resourceUniverseDigest,
    }),
  };
}

async function observeRawSchedulerBoundary(state) {
  const list = await executeRaw(state, {
    operationId: "cloudscheduler.v1.projects.locations.jobs.list",
    pathParams: {
      projectId: PROVIDER_TARGET_PROJECT_ID,
      location: PROVIDER_APPROVED_LOCATION,
    },
    query: {pageSize: 500},
  });
  const jobIds = list.records.map(({name}) => rawName(
      name,
      /^projects\/daegu-miami-production\/locations\/us-central1\/jobs\/([^/]+)$/,
      "SCHEDULER_JOB_IDENTITY_REJECTED",
  )[1]);
  exactSortedSet(
      jobIds,
      SCHEDULER_JOB_ALLOWLIST.map(({name}) => name),
      "SCHEDULER_INVENTORY_INCOMPLETE",
  );
  const jobs = [];
  for (const jobId of [...jobIds].sort()) {
    const result = await executeRaw(state, {
      operationId: "cloudscheduler.v1.projects.locations.jobs.get",
      pathParams: {
        projectId: PROVIDER_TARGET_PROJECT_ID,
        location: PROVIDER_APPROVED_LOCATION,
        jobId,
      },
    });
    const expected = SCHEDULER_JOB_ALLOWLIST.find(({name}) => name === jobId);
    const target = result.response.httpTarget?.uri ??
      result.response.pubsubTarget?.topicName ??
      result.response.appEngineHttpTarget?.relativeUri;
    if (!expected || target !== expected.target) {
      observerFail("SCHEDULER_TARGET_REJECTED");
    }
    jobs.push({
      name: result.response.name,
      target,
      state: result.response.state,
      schedule: result.response.schedule,
      timeZone: result.response.timeZone,
      updateTime: result.response.updateTime,
    });
  }
  return {executionId: list.transportExecutionId, jobs};
}

async function observeRawScheduler(state) {
  const first = await observeRawSchedulerBoundary(state);
  const second = await observeRawSchedulerBoundary(state);
  if (first.executionId === second.executionId ||
      canonical(first.jobs) !== canonical(second.jobs)) {
    observerFail("INVENTORY_UNSTABLE");
  }
  return {
    schedulerInventoryComplete: true,
    jobCount: first.jobs.length,
    digest: sha256Canonical(first.jobs),
    jobs: first.jobs,
  };
}

function deriveObservedStandaloneTopologyProfile(
    hierarchy,
    functionRecords,
    sourceBucketIdentities,
    evidenceDerivedNotApplicableOperationIds = [],
) {
  assertStandardArray(hierarchy, "OBSERVED_TOPOLOGY_HIERARCHY");
  assertStandardArray(functionRecords, "OBSERVED_TOPOLOGY_FUNCTIONS");
  assertStandardArray(
      sourceBucketIdentities,
      "OBSERVED_SOURCE_BUCKET_IDENTITIES",
  );
  const projects = hierarchy.filter(({kind}) => kind === "projects");
  const sourceBuckets = [...new Set(functionRecords.map((record) =>
    record?.source?.bucket))].sort();
  const observedBuckets = sourceBucketIdentities
      .map((identity) => {
        const keys = assertRecord(identity, "SOURCE_BUCKET_IDENTITY");
        const expectedKeys = [
          "bucketIdentityDigest",
          "bucketName",
          "functionSourceProvenance",
          "location",
          "observationOperationId",
          "observationResponseDigest",
          "projectNumber",
          "storageClass",
        ];
        if (canonical([...keys].sort()) !==
            canonical(expectedKeys.sort())) {
          observerFail("SOURCE_BUCKET_IDENTITY_REJECTED");
        }
        const provenance = identity.functionSourceProvenance;
        const provenanceKeys =
          assertRecord(provenance, "SOURCE_BUCKET_PROVENANCE");
        if (canonical([...provenanceKeys].sort()) !== canonical([
          "functionCount",
          "functionIdSetDigest",
          "functionIds",
        ]) ||
            !Array.isArray(provenance.functionIds)) {
          observerFail("SOURCE_BUCKET_PROVENANCE_REJECTED");
        }
        const expectedFunctionIds = functionRecords
            .filter((record) => record?.source?.bucket === identity.bucketName)
            .map(({functionId}) => functionId)
            .sort();
        const responseProjection = {
          name: identity.bucketName,
          projectNumber: identity.projectNumber,
          location: identity.location,
          storageClass: identity.storageClass,
        };
        const digestProjection = {
          bucketName: identity.bucketName,
          projectNumber: identity.projectNumber,
          location: identity.location,
          storageClass: identity.storageClass,
          observationOperationId: identity.observationOperationId,
          observationResponseDigest: identity.observationResponseDigest,
          functionSourceProvenance: provenance,
        };
        if (identity.observationOperationId !== "storage.v1.buckets.get" ||
            typeof identity.projectNumber !== "string" ||
            !/^[0-9]{1,30}$/.test(identity.projectNumber) ||
            identity.location !== "US-CENTRAL1" ||
            typeof identity.storageClass !== "string" ||
            identity.storageClass.length === 0 ||
            canonical(provenance.functionIds) !==
              canonical(expectedFunctionIds) ||
            provenance.functionCount !== expectedFunctionIds.length ||
            provenance.functionIdSetDigest !==
              sha256Canonical(expectedFunctionIds) ||
            identity.observationResponseDigest !==
              sha256Canonical(responseProjection) ||
            identity.bucketIdentityDigest !==
              sha256Canonical(digestProjection)) {
          observerFail("SOURCE_BUCKET_IDENTITY_REJECTED");
        }
        return identity;
      })
      .sort((left, right) => left.bucketName.localeCompare(right.bucketName));
  const observedBucketNames =
    observedBuckets.map(({bucketName}) => bucketName);
  if (projects.length !== 1 ||
      projects[0].name !== `projects/${PROVIDER_TARGET_PROJECT_ID}` ||
      !Object.hasOwn(projects[0], "parentResourceName") ||
      sourceBuckets.length !== 1 ||
      sourceBuckets[0] !== STANDALONE_SOURCE_BUCKET_NAME ||
      canonical(observedBucketNames) !== canonical(sourceBuckets) ||
      observedBuckets[0]?.projectNumber !== PROVIDER_TARGET_PROJECT_NUMBER) {
    observerFail("STANDALONE_TOPOLOGY_EVIDENCE_REJECTED");
  }
  try {
    return deriveStandaloneProjectObserverProfile({
      projectId: PROVIDER_TARGET_PROJECT_ID,
      projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
      projectParent: projects[0].parentResourceName,
      observedFolderNames: hierarchy
          .filter(({kind}) => kind === "folders")
          .map(({name}) => name),
      observedOrganizationNames: hierarchy
          .filter(({kind}) => kind === "organizations")
          .map(({name}) => name),
      sourceBucketName: sourceBuckets[0],
      sourceBucketOwnerProjectNumber:
        observedBuckets[0].projectNumber,
    }, evidenceDerivedNotApplicableOperationIds);
  } catch {
    observerFail("STANDALONE_TOPOLOGY_EVIDENCE_REJECTED");
  }
}

async function collectRawProductionObservation(
    executor,
    preflight,
    {mockOnly = false} = {},
) {
  const state = createRawObservationState(executor, preflight);
  if (mockOnly) injectedMockRawIamStates.add(state);
  const rules = await observeRawRules(state);
  const functions = await observeRawFunctions(state);
  const scheduler = await observeRawScheduler(state);
  const {iam} = await observeStableRawIamPair(state, functions);
  const covered = [
    ...state.executed,
    ...state.notApplicable.keys(),
  ].sort();
  exactSortedSet(
      covered,
      PROVIDER_MANDATORY_OPERATION_IDS,
      "MANDATORY_OPERATION_COVERAGE_INCOMPLETE",
  );
  const executedMandatoryOperationIds = [...state.executed].sort();
  const notApplicableMandatoryOperationIds =
    [...state.notApplicable.keys()].sort();
  const notApplicableEvidence =
    Object.fromEntries([...state.notApplicable.entries()].sort());
  const evidenceDerivedNotApplicableOperationIds =
    validateNotApplicableEvidence(notApplicableEvidence);
  const topologyProfile = deriveObservedStandaloneTopologyProfile(
      iam.hierarchy,
      functions.records,
      functions.bucketIdentities,
      evidenceDerivedNotApplicableOperationIds,
  );
  const operationTraceSummary = deriveOperationTraceSummary(state.trace);
  if (canonical(operationTraceSummary.executedMandatoryOperationIds) !==
        canonical(executedMandatoryOperationIds) ||
      operationTraceSummary.optionalDiagnosticOperationCount !== 0 ||
      canonical(executedMandatoryOperationIds) !==
        canonical(topologyProfile.operationExecution
            .executedMandatoryOperationIds) ||
      canonical(notApplicableMandatoryOperationIds) !==
        canonical(topologyProfile.operationExecution
            .notApplicableMandatoryOperationIds)) {
    observerFail("STANDALONE_OPERATION_PROFILE_REJECTED");
  }
  const startedAtEpochMs = Math.min(
      ...state.trace.map(({observedAtEpochMs}) => observedAtEpochMs),
  );
  const completedAtEpochMs = Math.max(
      ...state.trace.map(({completedAtEpochMs}) => completedAtEpochMs),
  );
  const blockers = [];
  if (!iam.conditionAnalysisComplete) {
    blockers.push("CONDITION_ANALYSIS_INCOMPLETE");
  }
  if (!iam.domainExpansionComplete) {
    blockers.push("IAM_DOMAIN_EXPANSION_INCOMPLETE");
  }
  if (!iam.groupExpansionComplete) {
    blockers.push("IAM_GROUP_EXPANSION_INCOMPLETE");
  }
  if (!iam.iamExpansionComplete) {
    blockers.push("IAM_EXPANSION_INCOMPLETE");
  }
  if (!iam.denyPolicyAnalysisComplete) {
    blockers.push("DENY_POLICY_ANALYSIS_INCOMPLETE");
  }
  if (iam.denyPolicyAnalysisComplete && iam.denyPolicies.length > 0) {
    blockers.push("DENY_POLICY_PRESENT_REQUIRES_REVIEW");
  }
  if (iam.writableBindings.length !== 0) {
    blockers.push("IAM_WRITABLE_PERMISSION_FOUND");
  }
  const rawObservation = normalizeCanonicalJson({
    rules,
    functions,
    iam,
    scheduler,
    topologyProfile,
    operationTrace: state.trace,
    operationTraceSummary,
    notApplicableEvidence,
  }, "RAW_PRODUCTION_OBSERVATION");
  const result = deepFreeze({
    schemaVersion: PRODUCTION_OBSERVER_SCHEMA_VERSION,
    projectId: PROVIDER_TARGET_PROJECT_ID,
    projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
    startedAtEpochMs,
    completedAtEpochMs,
    providerObservationComplete: true,
    policyAnalysisComplete: iam.policyAnalysisComplete,
    paginationComplete: true,
    repeatedPageTokenDetected: false,
    unreachableResourceCount: 0,
    inventoryStable: true,
    functionCount: functions.functionCount,
    guardedFunctionCount: functions.guardedFunctionCount,
    iamExpansionComplete: iam.iamExpansionComplete,
    groupExpansionComplete: iam.groupExpansionComplete,
    domainExpansionComplete: iam.domainExpansionComplete,
    denyPolicyAnalysisComplete: iam.denyPolicyAnalysisComplete,
    conditionAnalysisComplete: iam.conditionAnalysisComplete,
    schedulerInventoryComplete: scheduler.schedulerInventoryComplete,
    stale: false,
    actualMutations: 0,
    mutationOperationCount: 0,
    mutationPermissionCount: 0,
    topologyProfile,
    operationTraceSummary,
    executedMandatoryOperationIds,
    notApplicableMandatoryOperationIds,
    blockers: [...new Set(blockers)].sort(),
    counts: {
      mandatoryOperationCount: PROVIDER_MANDATORY_OPERATION_COUNT,
      executedMandatoryOperationCount:
        executedMandatoryOperationIds.length,
      notApplicableMandatoryOperationCount:
        notApplicableMandatoryOperationIds.length,
      operationExecutionCount: state.trace.length,
      operationUniqueOperationCount:
        operationTraceSummary.uniqueOperationCount,
      functionCount: functions.functionCount,
      guardedFunctionCount: functions.guardedFunctionCount,
      schedulerJobCount: scheduler.jobCount,
      iamBindingCount: iam.bindings.length,
      iamRoleCount: iam.roles.length,
      serviceAccountCount: iam.serviceAccounts.length,
      denyPolicyCount: iam.denyPolicies.length,
      iamConditionCount: iam.unresolvedConditions.length,
      unknownIamPrincipalCount: iam.unknownPrincipals.length,
      unknownIamRoleCount: iam.unknownRoles.length,
      unknownIamPermissionCount: iam.unknownPermissions.length,
      unknownIamScopeCount: iam.unknownScopes.length,
      writableIamBindingCount: iam.writableBindings.length,
    },
    digests: {
      rawObservationDigest: sha256Canonical(rawObservation),
      operationTraceDigest: sha256Canonical(state.trace),
      operationTraceOperationSetDigest:
        operationTraceSummary.operationIdSetDigest,
      operationTraceCountDigest:
        operationTraceSummary.perOperationTraceCountDigest,
      rulesDigest: sha256Canonical(rules),
      functionsDigest: functions.inventoryDigest,
      iamDigest: iam.digest,
      iamBindingSetDigest: iam.bindingSetDigest,
      schedulerDigest: scheduler.digest,
      topologyProfileDigest: topologyProfile.profileDigest,
    },
    rawObservation,
  });
  return result;
}

async function runRawProductionObservation(executor, preflight) {
  if (!genuineProductionExecutors.has(executor) ||
      !genuineProductionPreflightContexts.has(preflight)) {
    observerFail("GENUINE_PRODUCTION_CONTEXT_REQUIRED");
  }
  const result = await collectRawProductionObservation(executor, preflight);
  genuineRawProductionResults.set(result, {executor, preflight});
  return result;
}

export async function executeInjectedMockRawProductionObserverHarness(input) {
  assertExactOrSubsetKeys(
      input,
      ["mockOnly", "sessionReceipt", "transportExecutor"],
      ["mockOnly", "sessionReceipt", "transportExecutor"],
      "MOCK_RAW_PRODUCTION_OBSERVER_INPUT",
  );
  if (input.mockOnly !== true ||
      typeof input.transportExecutor !== "function") {
    observerFail("MOCK_RAW_PRODUCTION_OBSERVER_INPUT_REJECTED");
  }
  assertMockProviderTransportExecutor(
      input.transportExecutor,
      input.sessionReceipt,
  );
  injectedMockRawIamExecutors.add(input.transportExecutor);
  addInjectedMockRawIamLineage(input.transportExecutor);
  assertDeepFrozen(input.sessionReceipt, "MOCK_RAW_SESSION_RECEIPT");
  const result = await collectRawProductionObservation(
      input.transportExecutor,
      null,
      {mockOnly: true},
  );
  assertCanonicalMockObservation(result);
  genuineInjectedMockObservations.add(result);
  return result;
}

async function runOptionalProductionDiagnostic(executor, preflight) {
  if (!genuineProductionExecutors.has(executor) ||
      !genuineProductionPreflightContexts.has(preflight) ||
      preflight.arguments.optionalDiagnostic !==
        PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC) {
    observerFail("OPTIONAL_DIAGNOSTIC_CONTEXT_REJECTED");
  }
  const permission = "datastore.entities.get";
  const principal = KNOWN_IAM_GROUPS[0];
  const fullResourceName =
    `//cloudresourcemanager.googleapis.com/projects/${PROVIDER_TARGET_PROJECT_ID}`;
  if (!REVIEWED_PERMISSION_UNIVERSE.includes(permission) ||
      typeof principal !== "string" ||
      !principal.startsWith("group:")) {
    observerFail("OPTIONAL_DIAGNOSTIC_TARGET_ABSENT");
  }
  addProductionLineage(executor, "approved_reviewed_permission", [permission]);
  addProductionLineage(
      executor,
      "approved_iam_principal_or_group",
      [principal],
  );
  addProductionLineage(
      executor,
      "approved_or_discovered_target_resource",
      [fullResourceName],
  );
  const state = {
    executor,
    preflight,
    trace: [],
    executed: new Set(),
    notApplicable: new Map(),
  };
  const result = await executeRaw(state, {
    operationId: PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC,
    pathParams: {},
    body: {
      accessTuple: {fullResourceName, permission, principal},
    },
  });
  const access = result.response.access;
  return deepFreeze({
    status: ["GRANTED", "DENIED"].includes(access) ? "success" : "unknown",
    operationId: PRODUCTION_OBSERVER_OPTIONAL_DIAGNOSTIC,
    resultDigest: sha256Canonical({access}),
  });
}

function assertMockRawObservationSemantics(value) {
  const raw = value.rawObservation;
  const expectedRawKeys = [
    "functions",
    "iam",
    "notApplicableEvidence",
    "operationTrace",
    "operationTraceSummary",
    "rules",
    "scheduler",
    "topologyProfile",
  ];
  if (canonical(Object.keys(raw).sort()) !==
      canonical(expectedRawKeys.sort())) {
    observerFail("MOCK_RAW_OBSERVATION_REJECTED");
  }
  for (const [label, item] of [
    ["MOCK_RAW_RULES", raw.rules],
    ["MOCK_RAW_FUNCTIONS", raw.functions],
    ["MOCK_RAW_IAM", raw.iam],
    ["MOCK_RAW_SCHEDULER", raw.scheduler],
    ["MOCK_RAW_NOT_APPLICABLE", raw.notApplicableEvidence],
    ["MOCK_RAW_OPERATION_TRACE_SUMMARY", raw.operationTraceSummary],
    ["MOCK_RAW_TOPOLOGY_PROFILE", raw.topologyProfile],
  ]) assertRecord(item, label);
  for (const [label, item, keys] of [
    [
      "MOCK_RAW_RULES",
      raw.rules,
      ["release", "ruleset"],
    ],
    [
      "MOCK_RAW_RULES_RELEASE",
      raw.rules.release,
      ["createTime", "name", "rulesetName", "updateTime"],
    ],
    [
      "MOCK_RAW_RULESET",
      raw.rules.ruleset,
      ["createTime", "metadata", "name", "providerRulesetPayloadDigest"],
    ],
    [
      "MOCK_RAW_FUNCTIONS",
      raw.functions,
      [
        "bucketIdentities",
        "functionCount",
        "guardedFunctionCount",
        "inventoryDigest",
        "records",
        "sourceBucketIdentitySetDigest",
        "triggerEvidence",
      ],
    ],
    [
      "MOCK_RAW_IAM",
      raw.iam,
      [
        "bindings",
        "bindingSetDigest",
        "cloudAssetAnalyses",
        "conditionAnalysisComplete",
        "denyPolicies",
        "denyPolicyAnalysisComplete",
        "digest",
        "domainExpansionComplete",
        "groupExpansionComplete",
        "hierarchy",
        "iamExpansionComplete",
        "policies",
        "policyAnalysisComplete",
        "requiredServices",
        "resourceUniverseDigest",
        "roles",
        "runtimeServiceAccounts",
        "serviceAccounts",
        "unknownPrincipals",
        "unknownPermissions",
        "unknownRoles",
        "unknownScopes",
        "unresolvedConditions",
        "writableBindings",
      ],
    ],
    [
      "MOCK_RAW_SCHEDULER",
      raw.scheduler,
      ["digest", "jobCount", "jobs", "schedulerInventoryComplete"],
    ],
  ]) assertExactOrSubsetKeys(item, keys, keys, label);
  for (const [label, array] of [
    ["MOCK_RAW_FUNCTION_BUCKET_IDENTITIES", raw.functions.bucketIdentities],
    ["MOCK_RAW_FUNCTION_RECORDS", raw.functions.records],
    ["MOCK_RAW_IAM_HIERARCHY", raw.iam.hierarchy],
    ["MOCK_RAW_IAM_POLICIES", raw.iam.policies],
    ["MOCK_RAW_IAM_BINDINGS", raw.iam.bindings],
    ["MOCK_RAW_IAM_ROLES", raw.iam.roles],
    ["MOCK_RAW_IAM_SERVICE_ACCOUNTS", raw.iam.serviceAccounts],
    ["MOCK_RAW_IAM_ANALYSES", raw.iam.cloudAssetAnalyses],
    ["MOCK_RAW_IAM_DENY_POLICIES", raw.iam.denyPolicies],
    ["MOCK_RAW_IAM_REQUIRED_SERVICES", raw.iam.requiredServices],
    ["MOCK_RAW_IAM_UNKNOWN_PRINCIPALS", raw.iam.unknownPrincipals],
    ["MOCK_RAW_IAM_UNKNOWN_ROLES", raw.iam.unknownRoles],
    ["MOCK_RAW_IAM_UNKNOWN_PERMISSIONS", raw.iam.unknownPermissions],
    ["MOCK_RAW_IAM_UNKNOWN_SCOPES", raw.iam.unknownScopes],
    ["MOCK_RAW_IAM_UNRESOLVED_CONDITIONS", raw.iam.unresolvedConditions],
    ["MOCK_RAW_IAM_WRITABLE_BINDINGS", raw.iam.writableBindings],
    ["MOCK_RAW_SCHEDULER_JOBS", raw.scheduler.jobs],
    ["MOCK_RAW_OPERATION_TRACE", raw.operationTrace],
  ]) assertStandardArray(array, label);
  for (const functionRecord of raw.functions.records) {
    assertHttpCallableFunctionProjection(functionRecord);
  }
  if (raw.operationTrace.some(({operationId}) =>
    !PROVIDER_MANDATORY_OPERATION_IDS.includes(operationId))) {
    observerFail("MOCK_RAW_OPERATION_TRACE_REJECTED");
  }
  const iamUniverse = deriveCanonicalIamBindingUniverse({
    hierarchy: raw.iam.hierarchy,
    policies: raw.iam.policies,
    serviceAccounts: raw.iam.serviceAccounts,
    roles: raw.iam.roles,
    analyses: raw.iam.cloudAssetAnalyses,
    denyPolicies: raw.iam.denyPolicies,
  });
  const evidenceDerivedNotApplicableOperationIds =
    validateNotApplicableEvidence(raw.notApplicableEvidence);
  const denyGetNotApplicable =
    evidenceDerivedNotApplicableOperationIds.includes(
        "iam.v2.policies.denypolicies.get",
    );
  if (denyGetNotApplicable !== (raw.iam.denyPolicies.length === 0)) {
    observerFail("DENY_POLICY_OPERATION_PARTITION_REJECTED");
  }
  const topologyProfile = deriveObservedStandaloneTopologyProfile(
      raw.iam.hierarchy,
      raw.functions.records,
      raw.functions.bucketIdentities,
      evidenceDerivedNotApplicableOperationIds,
  );
  const sortedBucketIdentities = [...raw.functions.bucketIdentities]
      .sort((left, right) => left.bucketName.localeCompare(right.bucketName));
  const sourceBucketIdentitySetDigest =
    computeSourceBucketIdentitySetDigest(sortedBucketIdentities);
  const functionInventoryDigest = computeFunctionInventoryDigest({
    bucketIdentities: sortedBucketIdentities,
    records: raw.functions.records,
    sourceBucketIdentitySetDigest,
    triggerEvidence: raw.functions.triggerEvidence,
  });
  try {
    validateFunctionTriggerAbsenceEvidence(
        raw.functions.triggerEvidence,
        raw.functions.records,
    );
  } catch {
    observerFail("FUNCTION_TRIGGER_EVIDENCE_REJECTED");
  }
  const operationTraceSummary =
    deriveOperationTraceSummary(raw.operationTrace);
  const iamDigestProjection = {
    resources: raw.iam.hierarchy,
    policies: raw.iam.policies,
    bindings: raw.iam.bindings,
    roles: raw.iam.roles,
    accounts: raw.iam.serviceAccounts,
    analyses: raw.iam.cloudAssetAnalyses,
    denyPolicies: raw.iam.denyPolicies,
    services: raw.iam.requiredServices,
    bindingSetDigest: iamUniverse.bindingSetDigest,
    resourceUniverseDigest: iamUniverse.resourceUniverseDigest,
  };
  if (value.digests.rulesDigest !== sha256Canonical(raw.rules) ||
      raw.functions.inventoryDigest !==
        functionInventoryDigest ||
      raw.functions.sourceBucketIdentitySetDigest !==
        sourceBucketIdentitySetDigest ||
      value.digests.functionsDigest !== raw.functions.inventoryDigest ||
      raw.iam.digest !== sha256Canonical(iamDigestProjection) ||
      value.digests.iamDigest !== raw.iam.digest ||
      value.digests.iamBindingSetDigest !== iamUniverse.bindingSetDigest ||
      raw.iam.bindingSetDigest !== iamUniverse.bindingSetDigest ||
      raw.iam.resourceUniverseDigest !==
        iamUniverse.resourceUniverseDigest ||
      canonical(raw.topologyProfile) !== canonical(topologyProfile) ||
      canonical(value.topologyProfile) !== canonical(topologyProfile) ||
      value.digests.topologyProfileDigest !== topologyProfile.profileDigest ||
      canonical(raw.iam.bindings) !== canonical(iamUniverse.bindings) ||
      canonical(raw.iam.writableBindings) !==
        canonical(iamUniverse.writableBindings) ||
      canonical(raw.iam.unknownPrincipals) !==
        canonical(iamUniverse.unknownPrincipals) ||
      canonical(raw.iam.unknownRoles) !== canonical(iamUniverse.unknownRoles) ||
      canonical(raw.iam.unknownPermissions) !==
        canonical(iamUniverse.unknownPermissions) ||
      canonical(raw.iam.unknownScopes) !==
        canonical(iamUniverse.unknownScopes) ||
      canonical(raw.iam.unresolvedConditions) !==
        canonical(iamUniverse.unresolvedConditions) ||
      raw.scheduler.digest !== sha256Canonical(raw.scheduler.jobs) ||
      value.digests.schedulerDigest !== raw.scheduler.digest ||
      value.digests.operationTraceDigest !==
        sha256Canonical(raw.operationTrace) ||
      canonical(raw.operationTraceSummary) !==
        canonical(operationTraceSummary) ||
      canonical(value.operationTraceSummary) !==
        canonical(operationTraceSummary) ||
      canonical(value.executedMandatoryOperationIds) !==
        canonical(operationTraceSummary.executedMandatoryOperationIds) ||
      operationTraceSummary.optionalDiagnosticOperationCount !== 0 ||
      value.digests.operationTraceOperationSetDigest !==
        operationTraceSummary.operationIdSetDigest ||
      value.digests.operationTraceCountDigest !==
        operationTraceSummary.perOperationTraceCountDigest ||
      value.counts.operationExecutionCount !== raw.operationTrace.length ||
      value.counts.operationUniqueOperationCount !==
        operationTraceSummary.uniqueOperationCount ||
      value.counts.functionCount !== raw.functions.records.length ||
      value.counts.iamBindingCount !== raw.iam.bindings.length ||
      value.counts.iamRoleCount !== raw.iam.roles.length ||
      value.counts.serviceAccountCount !== raw.iam.serviceAccounts.length ||
      value.counts.denyPolicyCount !== raw.iam.denyPolicies.length ||
      value.counts.iamConditionCount !==
        iamUniverse.unresolvedConditions.length ||
      value.counts.unknownIamPrincipalCount !==
        iamUniverse.unknownPrincipals.length ||
      value.counts.unknownIamRoleCount !== raw.iam.unknownRoles.length ||
      value.counts.unknownIamPermissionCount !==
        raw.iam.unknownPermissions.length ||
      value.counts.writableIamBindingCount !==
        raw.iam.writableBindings.length ||
      value.counts.unknownIamScopeCount !== iamUniverse.unknownScopes.length ||
      value.counts.schedulerJobCount !== raw.scheduler.jobs.length ||
      raw.scheduler.jobCount !== raw.scheduler.jobs.length ||
      value.functionCount !== raw.functions.functionCount ||
      value.guardedFunctionCount !== raw.functions.guardedFunctionCount ||
      value.schedulerInventoryComplete !==
        raw.scheduler.schedulerInventoryComplete ||
      value.iamExpansionComplete !== iamUniverse.iamExpansionComplete ||
      raw.iam.iamExpansionComplete !== iamUniverse.iamExpansionComplete ||
      value.groupExpansionComplete !== iamUniverse.groupExpansionComplete ||
      raw.iam.groupExpansionComplete !== iamUniverse.groupExpansionComplete ||
      value.domainExpansionComplete !== iamUniverse.domainExpansionComplete ||
      raw.iam.domainExpansionComplete !==
        iamUniverse.domainExpansionComplete ||
      value.denyPolicyAnalysisComplete !==
        iamUniverse.denyPolicyAnalysisComplete ||
      raw.iam.denyPolicyAnalysisComplete !==
        iamUniverse.denyPolicyAnalysisComplete ||
      value.conditionAnalysisComplete !==
        iamUniverse.conditionAnalysisComplete ||
      raw.iam.conditionAnalysisComplete !==
        iamUniverse.conditionAnalysisComplete ||
      value.policyAnalysisComplete !== iamUniverse.policyAnalysisComplete ||
      raw.iam.policyAnalysisComplete !== iamUniverse.policyAnalysisComplete) {
    observerFail("MOCK_RAW_OBSERVATION_BINDING_REJECTED");
  }
}

function assertCanonicalMockObservation(value) {
  assertDeepFrozen(value, "MOCK_PROVIDER_OBSERVATION");
  const keys = assertRecord(value, "MOCK_PROVIDER_OBSERVATION");
  const expectedKeys = [
    "actualMutations",
    "blockers",
    "completedAtEpochMs",
    "conditionAnalysisComplete",
    "counts",
    "denyPolicyAnalysisComplete",
    "digests",
    "domainExpansionComplete",
    "executedMandatoryOperationIds",
    "functionCount",
    "groupExpansionComplete",
    "guardedFunctionCount",
    "iamExpansionComplete",
    "inventoryStable",
    "mutationOperationCount",
    "mutationPermissionCount",
    "notApplicableMandatoryOperationIds",
    "operationTraceSummary",
    "paginationComplete",
    "policyAnalysisComplete",
    "projectId",
    "projectNumber",
    "providerObservationComplete",
    "rawObservation",
    "repeatedPageTokenDetected",
    "schedulerInventoryComplete",
    "schemaVersion",
    "stale",
    "startedAtEpochMs",
    "topologyProfile",
    "unreachableResourceCount",
  ];
  if (canonical([...keys].sort()) !== canonical(expectedKeys.sort())) {
    observerFail("MOCK_PROVIDER_OBSERVATION_REJECTED");
  }
  const booleanKeys = [
    "providerObservationComplete",
    "policyAnalysisComplete",
    "paginationComplete",
    "repeatedPageTokenDetected",
    "inventoryStable",
    "iamExpansionComplete",
    "groupExpansionComplete",
    "domainExpansionComplete",
    "denyPolicyAnalysisComplete",
    "conditionAnalysisComplete",
    "schedulerInventoryComplete",
    "stale",
  ];
  if (value.schemaVersion !== PRODUCTION_OBSERVER_SCHEMA_VERSION ||
      value.projectId !== PROVIDER_TARGET_PROJECT_ID ||
      value.projectNumber !== PROVIDER_TARGET_PROJECT_NUMBER ||
      booleanKeys.some((key) => typeof value[key] !== "boolean") ||
      !Number.isFinite(value.startedAtEpochMs) ||
      !Number.isFinite(value.completedAtEpochMs) ||
      value.completedAtEpochMs < value.startedAtEpochMs ||
      !Number.isSafeInteger(value.unreachableResourceCount) ||
      value.unreachableResourceCount < 0 ||
      value.functionCount !== EXPECTED_DEPLOYED_FUNCTION_NAMES.length &&
        value.providerObservationComplete === true ||
      value.guardedFunctionCount !==
          EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length &&
        value.providerObservationComplete === true ||
      value.actualMutations !== 0 ||
      value.mutationOperationCount !== 0 ||
      value.mutationPermissionCount !== 0) {
    observerFail("MOCK_PROVIDER_OBSERVATION_REJECTED");
  }
  for (const operationIds of [
    value.executedMandatoryOperationIds,
    value.notApplicableMandatoryOperationIds,
  ]) {
    assertStandardArray(operationIds, "MANDATORY_OPERATION_COVERAGE");
    if (new Set(operationIds).size !== operationIds.length ||
        operationIds.some((operationId) =>
          !PROVIDER_MANDATORY_OPERATION_IDS.includes(operationId))) {
      observerFail("MANDATORY_OPERATION_COVERAGE_REJECTED");
    }
  }
  if (value.executedMandatoryOperationIds.some((operationId) =>
    value.notApplicableMandatoryOperationIds.includes(operationId))) {
    observerFail("MANDATORY_OPERATION_COVERAGE_OVERLAP");
  }
  if (value.providerObservationComplete) {
    exactSortedSet(
        [
          ...value.executedMandatoryOperationIds,
          ...value.notApplicableMandatoryOperationIds,
        ],
        PROVIDER_MANDATORY_OPERATION_IDS,
        "MANDATORY_OPERATION_COVERAGE_INCOMPLETE",
    );
  }
  if (canonical(value.executedMandatoryOperationIds) !==
        canonical(value.topologyProfile.operationExecution
            .executedMandatoryOperationIds) ||
      canonical(value.notApplicableMandatoryOperationIds) !==
        canonical(value.topologyProfile.operationExecution
            .notApplicableMandatoryOperationIds)) {
    observerFail("STANDALONE_OPERATION_PROFILE_REJECTED");
  }
  assertRecord(value.counts, "MOCK_OBSERVATION_COUNTS");
  assertRecord(value.digests, "MOCK_OBSERVATION_DIGESTS");
  assertRecord(value.rawObservation, "MOCK_RAW_OBSERVATION");
  const expectedCountKeys = [
    "denyPolicyCount",
    "executedMandatoryOperationCount",
    "functionCount",
    "guardedFunctionCount",
    "iamBindingCount",
    "iamConditionCount",
    "iamRoleCount",
    "mandatoryOperationCount",
    "notApplicableMandatoryOperationCount",
    "operationExecutionCount",
    "operationUniqueOperationCount",
    "schedulerJobCount",
    "serviceAccountCount",
    "unknownIamPrincipalCount",
    "unknownIamPermissionCount",
    "unknownIamRoleCount",
    "unknownIamScopeCount",
    "writableIamBindingCount",
  ];
  const expectedDigestKeys = [
    "functionsDigest",
    "iamBindingSetDigest",
    "iamDigest",
    "operationTraceCountDigest",
    "operationTraceDigest",
    "operationTraceOperationSetDigest",
    "rawObservationDigest",
    "rulesDigest",
    "schedulerDigest",
    "topologyProfileDigest",
  ];
  if (canonical(Object.keys(value.counts).sort()) !==
        canonical(expectedCountKeys.sort()) ||
      canonical(Object.keys(value.digests).sort()) !==
        canonical(expectedDigestKeys.sort())) {
    observerFail("MOCK_PROVIDER_OBSERVATION_REJECTED");
  }
  assertCanonicalJson(value.counts, "MOCK_OBSERVATION_COUNTS");
  assertCanonicalJson(value.digests, "MOCK_OBSERVATION_DIGESTS");
  assertCanonicalJson(value.rawObservation, "MOCK_RAW_OBSERVATION");
  assertMockRawObservationSemantics(value);
  for (const count of Object.values(value.counts)) {
    if (!Number.isSafeInteger(count) || count < 0) {
      observerFail("MOCK_OBSERVATION_COUNT_REJECTED");
    }
  }
  for (const digest of Object.values(value.digests)) {
    if (typeof digest !== "string" || !/^[0-9a-f]{64}$/.test(digest)) {
      observerFail("MOCK_OBSERVATION_DIGEST_REJECTED");
    }
  }
  if (value.counts.mandatoryOperationCount !==
        PROVIDER_MANDATORY_OPERATION_COUNT ||
      value.counts.executedMandatoryOperationCount !==
        value.executedMandatoryOperationIds.length ||
      value.counts.notApplicableMandatoryOperationCount !==
        value.notApplicableMandatoryOperationIds.length ||
      value.counts.operationExecutionCount <
        value.executedMandatoryOperationIds.length ||
      value.counts.functionCount !== value.functionCount ||
      value.counts.guardedFunctionCount !== value.guardedFunctionCount ||
      value.counts.schedulerJobCount !== SCHEDULER_JOB_ALLOWLIST.length &&
        value.schedulerInventoryComplete ||
      value.digests.rawObservationDigest !==
        sha256Canonical(value.rawObservation) ||
      value.policyAnalysisComplete && [
        value.counts.iamConditionCount,
        value.counts.unknownIamPrincipalCount,
        value.counts.unknownIamPermissionCount,
        value.counts.unknownIamRoleCount,
        value.counts.unknownIamScopeCount,
        value.counts.writableIamBindingCount,
      ].some((count) => count !== 0)) {
    observerFail("MOCK_PROVIDER_OBSERVATION_REJECTED");
  }
  assertStandardArray(value.blockers, "MOCK_OBSERVATION_BLOCKERS");
  if (value.blockers.some((blocker) => !BLOCKER_CODES.includes(blocker)) ||
      new Set(value.blockers).size !== value.blockers.length) {
    observerFail("MOCK_OBSERVATION_BLOCKER_REJECTED");
  }
  assertNoSensitiveOutput(value.rawObservation, "MOCK_RAW_OBSERVATION");
  return value;
}

function deriveBlockers(observation, observedAtEpochMs) {
  const blockers = new Set(observation.blockers);
  if (!observation.paginationComplete) blockers.add("PAGINATION_INCOMPLETE");
  if (observation.repeatedPageTokenDetected) {
    blockers.add("PAGINATION_TOKEN_REPEATED");
  }
  if (observation.unreachableResourceCount !== 0) {
    blockers.add("PROVIDER_UNREACHABLE");
  }
  if (!observation.inventoryStable) blockers.add("INVENTORY_UNSTABLE");
  if (observation.functionCount !== EXPECTED_DEPLOYED_FUNCTION_NAMES.length) {
    blockers.add("FUNCTION_COUNT_MISMATCH");
  }
  if (observation.guardedFunctionCount !==
      EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES.length) {
    blockers.add("GUARDED_FUNCTION_COUNT_MISMATCH");
  }
  if (!observation.iamExpansionComplete) {
    blockers.add("IAM_EXPANSION_INCOMPLETE");
  }
  if (observation.counts.writableIamBindingCount !== 0) {
    blockers.add("IAM_WRITABLE_PERMISSION_FOUND");
  }
  if (!observation.groupExpansionComplete) {
    blockers.add("IAM_GROUP_EXPANSION_INCOMPLETE");
  }
  if (!observation.domainExpansionComplete) {
    blockers.add("IAM_DOMAIN_EXPANSION_INCOMPLETE");
  }
  if (!observation.denyPolicyAnalysisComplete) {
    blockers.add("DENY_POLICY_ANALYSIS_INCOMPLETE");
  }
  if (observation.denyPolicyAnalysisComplete &&
      observation.counts.denyPolicyCount > 0) {
    blockers.add("DENY_POLICY_PRESENT_REQUIRES_REVIEW");
  }
  if (!observation.conditionAnalysisComplete) {
    blockers.add("CONDITION_ANALYSIS_INCOMPLETE");
  }
  if (!observation.schedulerInventoryComplete) {
    blockers.add("SCHEDULER_INVENTORY_INCOMPLETE");
  }
  if (observation.stale ||
      observedAtEpochMs - observation.completedAtEpochMs >
        MAX_OBSERVATION_AGE_MS ||
      observedAtEpochMs < observation.completedAtEpochMs) {
    blockers.add("OBSERVATION_STALE");
  }
  if (observation.executedMandatoryOperationIds.length +
      observation.notApplicableMandatoryOperationIds.length !==
        PROVIDER_MANDATORY_OPERATION_COUNT) {
    blockers.add("MANDATORY_OPERATION_COVERAGE_INCOMPLETE");
  }
  return [...blockers].sort();
}

function validateOptionalDiagnosticResult(value, requested) {
  if (!requested) {
    if (value?.status !== "absent") {
      observerFail("OPTIONAL_DIAGNOSTIC_RESULT_REJECTED");
    }
    return deepFreeze({status: "absent"});
  }
  assertDeepFrozen(value, "OPTIONAL_DIAGNOSTIC_RESULT");
  if (!value || !["success", "unknown", "conflict"].includes(value.status)) {
    observerFail("OPTIONAL_DIAGNOSTIC_RESULT_REJECTED");
  }
  assertCanonicalJson(value, "OPTIONAL_DIAGNOSTIC_RESULT");
  return value;
}

export function deriveProductionObserverArtifacts({
  preflight,
  providerObservation,
  optionalDiagnostic,
  observedAtEpochMs,
} = {}) {
  if (!preflight || !Object.isFrozen(preflight) ||
      !Number.isFinite(observedAtEpochMs)) {
    observerFail("ARTIFACT_INPUT_REJECTED");
  }
  const observation = assertCanonicalMockObservation(providerObservation);
  if (!genuineInjectedMockObservations.has(observation) &&
      !genuineRawProductionResults.has(observation)) {
    observerFail("PROVIDER_OBSERVATION_ATTESTATION_REJECTED");
  }
  const optional = validateOptionalDiagnosticResult(
      optionalDiagnostic,
      preflight.arguments.optionalDiagnostic !== null,
  );
  const evidenceDerivedNotApplicableOperationIds =
    validateNotApplicableEvidence(
        observation.rawObservation.notApplicableEvidence,
    );
  const observedTopologyProfile = assertStandaloneProjectObserverProfile(
      observation.topologyProfile,
      PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
      evidenceDerivedNotApplicableOperationIds,
  );
  if (preflight.target?.projectId !== PROVIDER_TARGET_PROJECT_ID ||
      preflight.target?.projectNumber !== PROVIDER_TARGET_PROJECT_NUMBER ||
      preflight.contracts?.providerOperationClassificationDigest !==
        PROVIDER_OPERATION_CLASSIFICATION_DIGEST ||
      preflight.contracts?.providerOperationDescriptorSetDigest !==
        PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST ||
      preflight.contracts?.effectiveMandatoryPermissionContractDigest !==
        EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST ||
      preflight.contracts?.topologyProfileDigest !==
        STANDALONE_PROJECT_OBSERVER_PROFILE.profileDigest ||
      preflight.contracts?.observerPrincipalPolicyDigest !==
        OBSERVER_PRINCIPAL_POLICY.policyDigest ||
      canonical(preflight.topologyProfile) !==
        canonical(STANDALONE_PROJECT_OBSERVER_PROFILE) ||
      canonical(preflight.observerPrincipalPolicy) !==
        canonical(OBSERVER_PRINCIPAL_POLICY) ||
      canonical(observation.topologyProfile) !==
        canonical(observedTopologyProfile)) {
    observerFail("ARTIFACT_PREFLIGHT_REJECTED");
  }
  const blockers = deriveBlockers(observation, observedAtEpochMs);
  const providerBlockers = new Set([
    "FUNCTION_COUNT_MISMATCH",
    "GUARDED_FUNCTION_COUNT_MISMATCH",
    "INVENTORY_UNSTABLE",
    "MANDATORY_OPERATION_COVERAGE_INCOMPLETE",
    "OBSERVATION_STALE",
    "PAGINATION_INCOMPLETE",
    "PAGINATION_TOKEN_REPEATED",
    "PROVIDER_UNREACHABLE",
    "SCHEDULER_INVENTORY_INCOMPLETE",
  ]);
  const providerObservationComplete =
    observation.providerObservationComplete &&
    !blockers.some((blocker) => providerBlockers.has(blocker));
  const policyAnalysisComplete =
    observation.policyAnalysisComplete &&
    observation.iamExpansionComplete &&
    observation.groupExpansionComplete &&
    observation.domainExpansionComplete &&
    observation.denyPolicyAnalysisComplete &&
    observation.conditionAnalysisComplete &&
    !blockers.some((blocker) => blocker.startsWith("IAM_") ||
      blocker.includes("DENY_") || blocker.includes("CONDITION_"));
  const optionalDiagnosticExecuted = optional.status !== "absent";
  const summary = {
    schemaVersion: PRODUCTION_OBSERVER_SCHEMA_VERSION,
    artifactType: "provider_observation_summary_redacted",
    observationPhase: "pre_freeze",
    projectId: PROVIDER_TARGET_PROJECT_ID,
    projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
    releaseSha: preflight.arguments.releaseSha,
    providerObservationComplete,
    policyAnalysisComplete,
    drainTelemetryComplete: false,
    deploymentLineageApproved: false,
    writeFreezeVerified: false,
    executionEligible: false,
    writeAuthorized: false,
    actualMutations: 0,
    mutationOperationCount: 0,
    mutationPermissionCount: 0,
    optionalDiagnosticExecuted,
    optionalDiagnosticStatus: optional.status,
    blockerCount: blockers.length,
    counts: {...observation.counts},
    operationTraceSummary: observation.operationTraceSummary,
    sourceBucketIdentities:
      observation.rawObservation.functions.bucketIdentities,
    digests: {
      rawObservationDigest: sha256Canonical(observation.rawObservation),
      providerObservationDigest: sha256Canonical({
        schemaVersion: observation.schemaVersion,
        projectId: observation.projectId,
        projectNumber: observation.projectNumber,
        startedAtEpochMs: observation.startedAtEpochMs,
        completedAtEpochMs: observation.completedAtEpochMs,
        providerObservationComplete:
          observation.providerObservationComplete,
        policyAnalysisComplete: observation.policyAnalysisComplete,
        counts: observation.counts,
        executedMandatoryOperationIds:
          observation.executedMandatoryOperationIds,
        notApplicableMandatoryOperationIds:
          observation.notApplicableMandatoryOperationIds,
        topologyProfile: observation.topologyProfile,
        rawObservation: observation.rawObservation,
      }),
      releaseSha: preflight.arguments.releaseSha,
      providerOperationClassificationDigest:
        PROVIDER_OPERATION_CLASSIFICATION_DIGEST,
      providerOperationDescriptorSetDigest:
        PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
      providerMandatoryOperationIdsDigest:
        PROVIDER_MANDATORY_OPERATION_IDS_DIGEST,
      providerOptionalDiagnosticOperationIdsDigest:
        PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST,
      readonlyPermissionManifestDigest: READONLY_PERMISSION_MANIFEST_DIGEST,
      effectiveMandatoryPermissionContractDigest:
        EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
      topologyProfileDigest:
        observation.topologyProfile.profileDigest,
      topologyEvidenceDigest:
        observation.topologyProfile.topologyEvidenceDigest,
      operationExecutionDigest:
        observation.topologyProfile.operationExecutionDigest,
      effectivePermissionProfileDigest:
        observation.topologyProfile
            .effectivePermissionProfileDigest,
      observerPrincipalPolicyDigest:
        OBSERVER_PRINCIPAL_POLICY.policyDigest,
      reviewedSourceDigest:
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
      reviewedEvidenceSetDigest: REVIEWED_EVIDENCE_SET_DIGEST,
      officialEvidenceSetDigest: OFFICIAL_EVIDENCE_SET_DIGEST,
      permissionResearchArtifactSha256:
        PERMISSION_RESEARCH_ARTIFACT_SHA256,
    },
    sourceBinding: {
      headSha: preflight.sourceIdentity.runtimeGit.headSha,
      treeSha: preflight.sourceIdentity.runtimeGit.treeSha,
      criticalSourceSetDigest:
        preflight.sourceIdentity.runtimeGit.criticalSourceSetDigest,
      runtimeReviewedSourceSetDigest:
        preflight.sourceIdentity.runtimeGit.reviewedSourceSetDigest,
      reviewedSourceIdentityDigest:
        EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
    },
    iamContractLineage: {
      privateRuntimeIamContractVersion: PRIVATE_RUNTIME_IAM_CONTRACT_VERSION,
      privateRuntimeIamContractDigest: PRIVATE_RUNTIME_IAM_CONTRACT_DIGEST,
      buildScopeContractVersion: BUILD_SCOPE_CONTRACT_VERSION,
      buildScopeContractDigest: BUILD_SCOPE_CONTRACT_DIGEST,
      deployProfileVersion: DEPLOY_PROFILE_VERSION,
      deployProfileDigest: DEPLOY_PROFILE_DIGEST,
      compensatingControlVersion: COMPENSATING_CONTROL_VERSION,
      compensatingControlDigest: COMPENSATING_CONTROL_DIGEST,
      organizationPolicyObservationStatus:
        ORGANIZATION_POLICY_EVIDENCE.observationStatus,
      organizationPolicyContractVersion:
        ORGANIZATION_POLICY_EVIDENCE.contractVersion,
      organizationPolicyEffectiveDecision:
        ORGANIZATION_POLICY_EVIDENCE.effectiveDecision,
      organizationPolicyEvidenceDigest:
        ORGANIZATION_POLICY_EVIDENCE.evidenceDigest,
      actualProvisioningEligible: false,
      deploymentApprovalEligible: false,
      publicInvokerApprovalEligible: false,
      iamMutationCommandPublication: false,
    },
    contractVersions: {
      providerOperationClassificationVersion:
        PROVIDER_OPERATION_CLASSIFICATION_VERSION,
      providerOperationAllowlistVersion: PROVIDER_OPERATION_ALLOWLIST_VERSION,
      providerAdapterContractVersion: PROVIDER_ADAPTER_CONTRACT_VERSION,
      readonlyPermissionManifestVersion: READONLY_PERMISSION_MANIFEST_VERSION,
      topologyProfileVersion:
        observation.topologyProfile.topologyProfileVersion,
      topologyProfileId:
        observation.topologyProfile.topologyProfileId,
      operationExecutionProfileVersion:
        observation.topologyProfile.operationExecution
            .operationExecutionProfileVersion,
      effectivePermissionProfileVersion:
        observation.topologyProfile.effectivePermissions
            .permissionProfileVersion,
      observerPrincipalPolicyVersion:
        OBSERVER_PRINCIPAL_POLICY.policyVersion,
      providerTransport: PROVIDER_TRANSPORT,
      providerAuthDependency: PROVIDER_AUTH_DEPENDENCY,
      providerHttpRuntime: PROVIDER_HTTP_RUNTIME,
    },
    permissions: {
      required:
        STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
            .effectiveRequiredPermissions,
      reviewedConditional:
        STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
            .reviewedConditionalPermissions,
      auxiliary:
        STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
            .effectiveAuxiliaryPermissions,
      effectiveRole:
        STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
            .effectiveRolePermissions,
      excluded:
        STANDALONE_PROJECT_OBSERVER_PROFILE.effectivePermissions
            .excludedRolePermissions,
    },
    topologyProfile: observation.topologyProfile,
    observerPrincipalPolicy: OBSERVER_PRINCIPAL_POLICY,
  };
  const sensitive = {
    schemaVersion: PRODUCTION_OBSERVER_SCHEMA_VERSION,
    artifactType: "provider_observation_sensitive",
    observationPhase: "pre_freeze",
    summaryDigest: sha256Canonical(summary),
    blockers,
    executedMandatoryOperationIds:
      observation.executedMandatoryOperationIds,
    notApplicableMandatoryOperationIds:
      observation.notApplicableMandatoryOperationIds,
    operationTraceSummary: observation.operationTraceSummary,
    sourceBucketIdentities:
      observation.rawObservation.functions.bucketIdentities,
    topologyProfile: STANDALONE_PROJECT_OBSERVER_PROFILE,
    observerPrincipalPolicy: OBSERVER_PRINCIPAL_POLICY,
    optionalDiagnostic: optional,
    rawObservation: observation.rawObservation,
  };
  assertNoSensitiveOutput(summary, "SUMMARY");
  assertNoSensitiveOutput(sensitive, "SENSITIVE");
  return deepFreeze({summary, sensitive});
}

function assertCredentialMaterialAbsent(value, credentialPath, credential) {
  const serialized = canonical(value);
  const forbiddenValues = [
    credentialPath,
    ...Object.entries(credential ?? {})
        .filter(([key]) => [
          "client_id",
          "client_x509_cert_url",
          "private_key",
          "private_key_id",
        ].includes(key))
        .map(([, item]) => item),
  ].filter((item) => typeof item === "string" && item.length > 0);
  if (forbiddenValues.some((item) => serialized.includes(item))) {
    observerFail("CREDENTIAL_MATERIAL_DISCLOSURE_REJECTED");
  }
}

function assertDeepFrozenDependencies(value, label) {
  if (!value ||
      !["object", "function"].includes(typeof value) ||
      !Object.isFrozen(value)) {
    observerFail(`${label}_MUST_BE_DEEP_FROZEN`);
  }
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      observerFail(`${label}_PROPERTY_REJECTED`);
    }
    if (descriptor.value &&
        ["object", "function"].includes(typeof descriptor.value)) {
      assertDeepFrozenDependencies(
          descriptor.value,
          `${label}_${String(key)}`,
      );
    }
  }
}

export async function executeInjectedMockProductionObserverHarness(
    request,
    dependencies,
) {
  const dependencyKeys = [
    "artifactPublisher",
    "credentialReader",
    "gitIdentityResolver",
    "mockOnly",
    "now",
    "optionalDiagnosticRunner",
    "providerObservationRunner",
  ];
  assertExactOrSubsetKeys(
      dependencies,
      dependencyKeys,
      dependencyKeys,
      "INJECTED_DEPENDENCIES",
  );
  assertDeepFrozenDependencies(dependencies, "INJECTED_DEPENDENCIES");
  if (dependencies.mockOnly !== true ||
      dependencyKeys.filter((key) =>
        !["mockOnly"].includes(key)).some((key) =>
        typeof dependencies[key] !== "function")) {
    observerFail("INJECTED_DEPENDENCIES_REJECTED");
  }
  assertExactOrSubsetKeys(
      request,
      ["argv", "environment", "repositoryRoot"],
      ["argv", "environment", "repositoryRoot"],
      "INJECTED_REQUEST",
  );
  const argumentsValue = parseProductionObserverArguments(request.argv);
  if (request.repositoryRoot !== MODULE_REPOSITORY_ROOT) {
    observerFail("INJECTED_REPOSITORY_ROOT_REJECTED");
  }
  let sourceIdentity;
  try {
    sourceIdentity = await dependencies.gitIdentityResolver(deepFreeze({
      repositoryRoot: request.repositoryRoot,
      releaseSha: argumentsValue.releaseSha,
    }));
  } catch {
    observerFail("INJECTED_SOURCE_RESOLUTION_FAILED");
  }
  const preflight = validateProductionObserverRequest({
    arguments: argumentsValue,
    environment: request.environment,
    repositoryRoot: request.repositoryRoot,
    sourceIdentity,
  });
  let credentialResult;
  try {
    credentialResult = await dependencies.credentialReader(deepFreeze({
      credentialFile: argumentsValue.credentialFile,
      projectId: PROVIDER_TARGET_PROJECT_ID,
    }));
  } catch {
    observerFail("INJECTED_CREDENTIAL_READ_FAILED");
  }
  assertDeepFrozen(credentialResult, "INJECTED_CREDENTIAL_RESULT");
  const credential = assertCredentialDescriptorAndPayload(
      credentialResult,
      argumentsValue.credentialFile,
  );
  let providerObservation;
  try {
    providerObservation =
      await dependencies.providerObservationRunner(deepFreeze({
        mockOnly: true,
        preflight,
        credential,
      }));
  } catch {
    observerFail("INJECTED_PROVIDER_OBSERVATION_FAILED");
  }
  assertCanonicalMockObservation(providerObservation);
  genuineInjectedMockObservations.add(providerObservation);
  let optionalDiagnostic = deepFreeze({status: "absent"});
  if (argumentsValue.optionalDiagnostic !== null) {
    try {
      optionalDiagnostic =
        await dependencies.optionalDiagnosticRunner(deepFreeze({
          mockOnly: true,
          preflight,
          providerObservation,
        }));
    } catch {
      observerFail("INJECTED_OPTIONAL_DIAGNOSTIC_FAILED");
    }
  }
  const observedAtEpochMs = dependencies.now();
  if (!Number.isFinite(observedAtEpochMs)) {
    observerFail("INJECTED_CLOCK_REJECTED");
  }
  const artifacts = deriveProductionObserverArtifacts({
    preflight,
    providerObservation,
    optionalDiagnostic,
    observedAtEpochMs,
  });
  assertCredentialMaterialAbsent(
      artifacts,
      argumentsValue.credentialFile,
      credential,
  );
  let publication;
  try {
    publication = await dependencies.artifactPublisher(deepFreeze({
      artifacts,
      outputPlan: preflight.outputPlan,
      repositoryRoot: preflight.repositoryRoot,
    }));
  } catch {
    observerFail("INJECTED_ARTIFACT_PUBLICATION_FAILED");
  }
  return deepFreeze({artifacts, publication});
}

function writeExclusiveTemp(parent, bytes, label) {
  const tempPath = path.join(
      parent,
      `.${label}.${process.pid}.${crypto.randomUUID()}.tmp`,
  );
  const flags = fs.constants.O_CREAT | fs.constants.O_EXCL |
    fs.constants.O_WRONLY | (fs.constants.O_NOFOLLOW ?? 0);
  let handle;
  try {
    handle = fs.openSync(tempPath, flags, 0o600);
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = undefined;
    const stat = fs.lstatSync(tempPath);
    if (!stat.isFile() || stat.isSymbolicLink() ||
        (stat.mode & 0o777) !== 0o600) {
      observerFail("PUBLICATION_TEMP_REJECTED");
    }
    return tempPath;
  } catch (error) {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {}
    }
    try {
      fs.unlinkSync(tempPath);
    } catch {}
    if (error instanceof ProviderTransportError) throw error;
    observerFail("PUBLICATION_TEMP_FAILED");
  }
}

function fsyncDirectory(directory) {
  let handle;
  try {
    handle = fs.openSync(directory, fs.constants.O_RDONLY);
    fs.fsyncSync(handle);
  } catch {
    observerFail("PUBLICATION_FSYNC_FAILED");
  } finally {
    if (handle !== undefined) {
      try {
        fs.closeSync(handle);
      } catch {}
    }
  }
}

export function publishProductionObserverArtifactPair({
  artifacts,
  outputPlan,
  repositoryRoot,
} = {}) {
  if (!artifacts || !Object.isFrozen(artifacts) ||
      !outputPlan || !Object.isFrozen(outputPlan) ||
      repositoryRoot !== MODULE_REPOSITORY_ROOT) {
    observerFail("PUBLICATION_INPUT_REJECTED");
  }
  const validatedPlan = validateOutputPlan({
    summaryOutput: outputPlan.summaryPath,
    sensitiveOutput: outputPlan.sensitivePath,
  }, repositoryRoot);
  if (canonical(validatedPlan) !== canonical(outputPlan)) {
    observerFail("PUBLICATION_PLAN_REJECTED");
  }
  assertNoSensitiveOutput(artifacts.summary, "SUMMARY");
  assertNoSensitiveOutput(artifacts.sensitive, "SENSITIVE");
  const summaryBytes = Buffer.from(
      `${canonical(artifacts.summary)}\n`,
      "utf8",
  );
  const sensitiveBytes = Buffer.from(
      `${canonical(artifacts.sensitive)}\n`,
      "utf8",
  );
  let directoryCreated = false;
  let summaryTemp;
  let sensitiveTemp;
  let summaryPublished = false;
  let sensitivePublished = false;
  let parentIdentity;
  try {
    assertOutputDirectoryIdentity(outputPlan);
    fs.mkdirSync(outputPlan.parent, {mode: 0o700, recursive: false});
    directoryCreated = true;
    const directoryStat = fs.lstatSync(outputPlan.parent);
    if (!directoryStat.isDirectory() ||
        directoryStat.isSymbolicLink() ||
        (directoryStat.mode & 0o777) !== 0o700) {
      observerFail("PUBLICATION_DIRECTORY_REJECTED");
    }
    parentIdentity = {
      device: directoryStat.dev,
      inode: directoryStat.ino,
    };
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    summaryTemp =
      writeExclusiveTemp(outputPlan.parent, summaryBytes, "summary");
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    sensitiveTemp =
      writeExclusiveTemp(outputPlan.parent, sensitiveBytes, "sensitive");
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    fs.linkSync(summaryTemp, outputPlan.summaryPath);
    summaryPublished = true;
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    fs.unlinkSync(summaryTemp);
    summaryTemp = undefined;
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    fs.linkSync(sensitiveTemp, outputPlan.sensitivePath);
    sensitivePublished = true;
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    fs.unlinkSync(sensitiveTemp);
    sensitiveTemp = undefined;
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    for (const finalPath of [
      outputPlan.summaryPath,
      outputPlan.sensitivePath,
    ]) {
      const stat = fs.lstatSync(finalPath);
      if (!stat.isFile() || stat.isSymbolicLink() ||
          (stat.mode & 0o777) !== 0o600) {
        observerFail("PUBLICATION_FINAL_REJECTED");
      }
    }
    fsyncDirectory(outputPlan.parent);
    assertOutputDirectoryIdentity(outputPlan, parentIdentity);
    return deepFreeze({
      published: true,
      summaryFilename: PRODUCTION_OBSERVER_SUMMARY_FILENAME,
      sensitiveFilename: PRODUCTION_OBSERVER_SENSITIVE_FILENAME,
      summaryDigest: sha256Canonical(artifacts.summary),
      sensitiveDigest: sha256Canonical(artifacts.sensitive),
    });
  } catch (error) {
    let cleanupSafe = false;
    if (parentIdentity !== undefined) {
      try {
        assertOutputDirectoryIdentity(outputPlan, parentIdentity);
        cleanupSafe = true;
      } catch {}
    }
    if (cleanupSafe) {
      if (sensitivePublished) {
        try {
          fs.unlinkSync(outputPlan.sensitivePath);
        } catch {}
      }
      if (summaryPublished) {
        try {
          fs.unlinkSync(outputPlan.summaryPath);
        } catch {}
      }
      for (const tempPath of [summaryTemp, sensitiveTemp]) {
        if (tempPath) {
          try {
            fs.unlinkSync(tempPath);
          } catch {}
        }
      }
      if (directoryCreated) {
        try {
          fs.rmdirSync(outputPlan.parent);
        } catch {}
      }
    }
    if (error instanceof ProviderTransportError) throw error;
    observerFail("PUBLICATION_FAILED");
  }
}

async function runProductionObserverCli() {
  const argumentsValue =
    parseProductionObserverArguments(process.argv.slice(2));
  const sourceIdentity =
    resolveProductionSourceIdentity(MODULE_REPOSITORY_ROOT);
  const preflight = validateProductionObserverRequest({
    arguments: argumentsValue,
    environment: process.env,
    repositoryRoot: MODULE_REPOSITORY_ROOT,
    sourceIdentity,
  });
  const credentialResult =
    readExplicitProductionCredential(argumentsValue.credentialFile);
  const parsedCredential = assertCredentialDescriptorAndPayload(
      credentialResult,
      argumentsValue.credentialFile,
  );
  const executor = createProductionProviderTransportExecutor(
      parsedCredential,
      preflight,
  );
  const providerObservation =
    await runRawProductionObservation(executor, preflight);
  if (genuineRawProductionResults.get(providerObservation)?.executor !==
      executor) {
    observerFail("RAW_RESULT_ATTESTATION_REJECTED");
  }
  let optionalDiagnostic = deepFreeze({status: "absent"});
  if (argumentsValue.optionalDiagnostic !== null) {
    try {
      optionalDiagnostic =
        await runOptionalProductionDiagnostic(executor, preflight);
    } catch {
      optionalDiagnostic = deepFreeze({
        status: "unknown",
        resultDigest: sha256Canonical({
          status: "optional_diagnostic_failed_closed",
        }),
      });
    }
  }
  const artifacts = deriveProductionObserverArtifacts({
    preflight,
    providerObservation,
    optionalDiagnostic,
    observedAtEpochMs: Date.now(),
  });
  assertCredentialMaterialAbsent(
      artifacts,
      argumentsValue.credentialFile,
      parsedCredential,
  );
  publishProductionObserverArtifactPair({
    artifacts,
    outputPlan: preflight.outputPlan,
    repositoryRoot: preflight.repositoryRoot,
  });
}

const invokedAsMain = process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsMain) {
  runProductionObserverCli().catch((error) => {
    const code = error instanceof ProviderTransportError ?
      error.code :
      "PRODUCTION_OBSERVER_FAILED";
    process.stderr.write(`${code}\n`);
    process.exitCode = 1;
  });
}
