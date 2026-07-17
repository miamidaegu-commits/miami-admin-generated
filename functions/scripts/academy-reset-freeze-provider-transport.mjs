import crypto from "node:crypto";
import {GoogleAuth} from "google-auth-library";
import {
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  PROVIDER_APPROVED_LOCATION,
  PROVIDER_OPERATION_ALLOWLIST_VERSION,
  PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_TARGET_PROJECT_ID,
  PROVIDER_TARGET_PROJECT_NUMBER,
  assertProviderOperationRegistry,
  assertProviderPathParameters,
  assertProviderRequestBody,
  getProviderOperationDescriptor,
} from "./academy-reset-freeze-provider-operations.mjs";

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
  const permissions = [...new Set(principals.flatMap((principal) => [
    ...(principal.effectivePermissions ?? []),
    ...(principal.authPermissions ?? []),
  ]))].sort();
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
      "fixed_production_identity_only",
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

function createGoogleAuthHeaderProvider(...args) {
  if (args.length !== 0) fail("AUTH_FACTORY_ARGUMENT_REJECTED");
  const auth = new GoogleAuth({scopes: [GOOGLE_PROVIDER_READ_ONLY_SCOPE]});
  return async () => {
    try {
      return await auth.getRequestHeaders();
    } catch {
      fail("AUTHORIZATION_PROVIDER_FAILED");
    }
  };
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
