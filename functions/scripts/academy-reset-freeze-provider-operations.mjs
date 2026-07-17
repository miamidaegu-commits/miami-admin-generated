import crypto from "node:crypto";

export const PROVIDER_OPERATION_ALLOWLIST_VERSION =
  "academy_reset_freeze_provider_operations.v4";
export const PROVIDER_ADAPTER_CONTRACT_VERSION =
  "academy_reset_freeze_provider_adapter.v4";
export const PROVIDER_TRANSPORT = "google_auth_library_native_fetch_v1";
export const PROVIDER_AUTH_DEPENDENCY = "google-auth-library@10.6.2";
export const PROVIDER_HTTP_RUNTIME = "node24_native_fetch";
export const PROVIDER_NO_MUTATION_OPERATION_COUNT = 0;
export const PROVIDER_TARGET_PROJECT_ID = "daegu-miami-production";
export const PROVIDER_TARGET_PROJECT_NUMBER = "884850632328";
export const PROVIDER_APPROVED_LOCATION = "us-central1";
export const PROVIDER_PATH_ENCODING_MODES = Object.freeze([
  "iam_attachment_point",
  "path_segment",
  "resource_name",
  "storage_object",
]);
export const PROVIDER_PATH_LINEAGE_BINDINGS = Object.freeze([
  "approved_build_id",
  "approved_function_id",
  "approved_iam_role_id",
  "approved_location",
  "approved_revision_id",
  "approved_rules_release_id",
  "approved_rules_ruleset_id",
  "approved_scheduler_job_id",
  "approved_service_account_email",
  "approved_service_id",
  "approved_service_usage_service",
  "approved_storage_source_bucket",
  "approved_storage_source_object",
  "discovered_deny_policy_id",
  "discovered_parent_lineage",
  "target_project_id",
  "target_project_number",
]);
export const PROVIDER_SEMANTIC_BODY_BINDINGS = Object.freeze([
  "approved_iam_principal_or_group",
  "approved_or_discovered_target_resource",
  "approved_reviewed_permission",
  "contract_literal",
]);

const RETRY_STATUS_CODES = Object.freeze([408, 429, 500, 502, 503, 504]);
const DESCRIPTOR_KEYS = Object.freeze([
  "apiFamily",
  "apiVersion",
  "host",
  "maxResponseBytes",
  "method",
  "officialTranscodingTemplate",
  "operationId",
  "pagination",
  "pathParams",
  "pathTemplate",
  "query",
  "readOnlySemantic",
  "redirects",
  "requestBody",
  "response",
  "retry",
  "timeout",
].sort());

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function scalar(type, {
  pattern,
  minimum,
  maximum,
  minLength,
  maxLength,
  const: constValue,
  enum: enumValues,
  binding,
  encoding,
  serialization,
} = {}) {
  return Object.fromEntries(Object.entries({
    type,
    pattern,
    minimum,
    maximum,
    minLength,
    maxLength,
    const: constValue,
    enum: enumValues,
    binding,
    encoding,
    serialization,
  }).filter(([, value]) => value !== undefined));
}

const projectId = () => scalar("string", {
  const: PROVIDER_TARGET_PROJECT_ID,
  binding: "target_project_id",
  encoding: "path_segment",
});
const projectNumber = () => scalar("string", {
  const: PROVIDER_TARGET_PROJECT_NUMBER,
  binding: "target_project_number",
  encoding: "path_segment",
});
const resourceId = (binding) => scalar("string", {
  pattern: "^[A-Za-z0-9][A-Za-z0-9._~-]{0,254}$",
  minLength: 1,
  maxLength: 255,
  binding,
  encoding: "path_segment",
});
const locationId = () => scalar("string", {
  const: PROVIDER_APPROVED_LOCATION,
  binding: "approved_location",
  encoding: "path_segment",
});
const discoveredParentId = () => scalar("string", {
  pattern: "^[0-9]{1,30}$",
  minLength: 1,
  maxLength: 30,
  binding: "discovered_parent_lineage",
  encoding: "path_segment",
});
const iamAttachmentPoint = () => scalar("string", {
  pattern:
    "^cloudresourcemanager\\.googleapis\\.com/(?:projects/daegu-miami-production|folders/[0-9]{1,30}|organizations/[0-9]{1,30})$",
  minLength: 45,
  maxLength: 110,
  binding: "discovered_parent_lineage",
  encoding: "iam_attachment_point",
});
const serviceAccountEmail = () => scalar("string", {
  pattern:
    "^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]@daegu-miami-production\\.iam\\.gserviceaccount\\.com|884850632328-compute@developer\\.gserviceaccount\\.com)$",
  minLength: 30,
  maxLength: 254,
  binding: "approved_service_account_email",
  encoding: "path_segment",
});
const pageSize = (maximum = 1000) => scalar("integer", {
  minimum: 1,
  maximum,
  binding: "contract_bounded_page_size",
});
const pageToken = () => scalar("string", {
  minLength: 1,
  maxLength: 4096,
  binding: "discovered_next_page_token",
});
const boundedString = (
    maxLength = 4096,
    binding = "approved_query_value",
) => scalar("string", {minLength: 1, maxLength, binding});

function objectSchema(properties, required = Object.keys(properties)) {
  return {
    type: "object",
    additionalProperties: false,
    required: [...required].sort(),
    properties,
  };
}

function pathParams(properties) {
  return objectSchema(properties);
}

function query(properties = {}, required = []) {
  return objectSchema(properties, required);
}

function forbiddenBody() {
  return {mode: "forbidden"};
}

function semanticBody(schema) {
  return {
    mode: "required",
    contentType: "application/json",
    exactProjection: true,
    schema,
  };
}

function paged(pageSizeQueryParam = "pageSize", maxPageSize = 1000) {
  return {
    mode: "paged",
    pageSizeQueryParam,
    pageTokenQueryParam: "pageToken",
    maxPageSize,
    maxPages: 100,
    maxRecords: 10000,
  };
}

function nonpaged(maxRecords = 1) {
  return {
    mode: "none",
    maxPages: 1,
    maxRecords,
  };
}

function responseField(type, {
  minLength,
} = {}) {
  return Object.fromEntries(Object.entries({
    type,
    minLength,
  }).filter(([, value]) => value !== undefined));
}

function partialIndicator(field, policy, required = false) {
  return {field, policy, required};
}

const partialSuccessIndicator = () =>
  partialIndicator("partialSuccess", "reject_true");
const unreachableIndicator = () =>
  partialIndicator("unreachable", "reject_nonempty_array");

function listResponse(recordsField, {
  partialIndicators = [partialSuccessIndicator()],
  identityField = "name",
} = {}) {
  return {
    kind: "json",
    recordsField,
    nextPageTokenField: "nextPageToken",
    requiredResponseFields: {
      [recordsField]: responseField("array"),
    },
    recordRequiredFields: {
      [identityField]: responseField("string", {minLength: 1}),
    },
    identityField,
    partialIndicators,
  };
}

function resourceResponse(
    identityField = "name",
    additionalRequiredFields = {},
) {
  return {
    requiredResponseFields: {
      [identityField]: responseField("string", {minLength: 1}),
      ...additionalRequiredFields,
    },
    recordRequiredFields: {},
    identityField,
    partialIndicators: [partialSuccessIndicator()],
  };
}

function policyResponse() {
  return {
    requiredResponseFields: {
      bindings: responseField("array"),
      etag: responseField("string", {minLength: 1}),
      version: responseField("integer"),
    },
    recordRequiredFields: {},
    identityField: null,
    partialIndicators: [partialSuccessIndicator()],
  };
}

function descriptor({
  operationId,
  apiFamily,
  apiVersion,
  host,
  method = "GET",
  pathTemplate,
  officialTranscodingTemplate = pathTemplate,
  pathParams: pathParamSchema,
  query: querySchema = query(),
  requestBody = forbiddenBody(),
  pagination = nonpaged(),
  maxResponseBytes = 16 * 1024 * 1024,
  responseSchema,
  responseKind = "json",
  recordsField = null,
  nextPageTokenField = null,
  requiredResponseFields = {},
  recordRequiredFields = {},
  identityField = null,
  partialIndicators = [],
}) {
  return deepFreeze({
    operationId,
    apiFamily,
    host,
    apiVersion,
    method,
    pathTemplate,
    officialTranscodingTemplate,
    pathParams: pathParamSchema,
    query: querySchema,
    requestBody,
    pagination,
    timeout: {milliseconds: method === "GET" ? 10000 : 30000},
    retry: {
      maxRetries: 3,
      statusCodes: [...RETRY_STATUS_CODES],
    },
    maxResponseBytes,
    response: {
      schema: responseSchema,
      version: apiVersion,
      kind: responseKind,
      recordsField,
      nextPageTokenField,
      requiredFields: requiredResponseFields,
      recordRequiredFields,
      identityField,
      partialIndicators,
      unknownFields: "allow_noncritical_api_expansion",
      unknownCriticalFields: "reject_reserved_partial_indicators",
    },
    redirects: "disallow",
    readOnlySemantic: true,
  });
}

const getIamPolicyBody = () => semanticBody(objectSchema({
  options: objectSchema({
    requestedPolicyVersion: scalar("integer", {
      const: 3,
      binding: "contract_literal",
    }),
  }),
}));

const operations = [
  descriptor({
    operationId: "firebaserules.v1.projects.releases.get",
    apiFamily: "firebaserules",
    apiVersion: "v1",
    host: "https://firebaserules.googleapis.com",
    pathTemplate: "/v1/projects/{projectId}/releases/{releaseId}",
    officialTranscodingTemplate: "/v1/{name=projects/*/releases/**}",
    pathParams: pathParams({
      projectId: projectId(),
      releaseId: resourceId("approved_rules_release_id"),
    }),
    responseSchema: "google.firebase.rules.v1.Release",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "firebaserules.v1.projects.rulesets.get",
    apiFamily: "firebaserules",
    apiVersion: "v1",
    host: "https://firebaserules.googleapis.com",
    pathTemplate: "/v1/projects/{projectId}/rulesets/{rulesetId}",
    officialTranscodingTemplate: "/v1/{name=projects/*/rulesets/*}",
    pathParams: pathParams({
      projectId: projectId(),
      rulesetId: resourceId("approved_rules_ruleset_id"),
    }),
    responseSchema: "google.firebase.rules.v1.Ruleset",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "cloudfunctions.v2.projects.locations.functions.list",
    apiFamily: "cloudfunctions",
    apiVersion: "v2",
    host: "https://cloudfunctions.googleapis.com",
    pathTemplate: "/v2/projects/{projectId}/locations/{location}/functions",
    officialTranscodingTemplate:
      "/v2/{parent=projects/*/locations/*}/functions",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
    }),
    query: query({
      pageSize: pageSize(1000),
      pageToken: pageToken(),
    }),
    pagination: paged(),
    responseSchema: "google.cloud.functions.v2.ListFunctionsResponse",
    ...listResponse("functions", {
      partialIndicators: [
        partialSuccessIndicator(),
        unreachableIndicator(),
      ],
    }),
  }),
  descriptor({
    operationId: "cloudfunctions.v2.projects.locations.functions.get",
    apiFamily: "cloudfunctions",
    apiVersion: "v2",
    host: "https://cloudfunctions.googleapis.com",
    pathTemplate:
      "/v2/projects/{projectId}/locations/{location}/functions/{functionId}",
    officialTranscodingTemplate:
      "/v2/{name=projects/*/locations/*/functions/*}",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
      functionId: resourceId("approved_function_id"),
    }),
    responseSchema: "google.cloud.functions.v2.Function",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "run.v2.projects.locations.services.list",
    apiFamily: "run",
    apiVersion: "v2",
    host: "https://run.googleapis.com",
    pathTemplate: "/v2/projects/{projectId}/locations/{location}/services",
    officialTranscodingTemplate:
      "/v2/{parent=projects/*/locations/*}/services",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
    }),
    query: query({
      pageSize: pageSize(1000),
      pageToken: pageToken(),
    }),
    pagination: paged(),
    responseSchema: "google.cloud.run.v2.ListServicesResponse",
    ...listResponse("services", {
      partialIndicators: [
        partialSuccessIndicator(),
        unreachableIndicator(),
      ],
    }),
  }),
  descriptor({
    operationId: "run.v2.projects.locations.services.get",
    apiFamily: "run",
    apiVersion: "v2",
    host: "https://run.googleapis.com",
    pathTemplate:
      "/v2/projects/{projectId}/locations/{location}/services/{serviceId}",
    officialTranscodingTemplate:
      "/v2/{name=projects/*/locations/*/services/*}",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
      serviceId: resourceId("approved_service_id"),
    }),
    responseSchema: "google.cloud.run.v2.Service",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "run.v2.projects.locations.services.revisions.list",
    apiFamily: "run",
    apiVersion: "v2",
    host: "https://run.googleapis.com",
    pathTemplate:
      "/v2/projects/{projectId}/locations/{location}/services/{serviceId}/revisions",
    officialTranscodingTemplate:
      "/v2/{parent=projects/*/locations/*/services/*}/revisions",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
      serviceId: resourceId("approved_service_id"),
    }),
    query: query({
      pageSize: pageSize(1000),
      pageToken: pageToken(),
    }),
    pagination: paged(),
    responseSchema: "google.cloud.run.v2.ListRevisionsResponse",
    ...listResponse("revisions", {
      partialIndicators: [
        partialSuccessIndicator(),
        unreachableIndicator(),
      ],
    }),
  }),
  descriptor({
    operationId: "run.v2.projects.locations.services.revisions.get",
    apiFamily: "run",
    apiVersion: "v2",
    host: "https://run.googleapis.com",
    pathTemplate:
      "/v2/projects/{projectId}/locations/{location}/services/{serviceId}/revisions/{revisionId}",
    officialTranscodingTemplate:
      "/v2/{name=projects/*/locations/*/services/*/revisions/*}",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
      serviceId: resourceId("approved_service_id"),
      revisionId: resourceId("approved_revision_id"),
    }),
    responseSchema: "google.cloud.run.v2.Revision",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "cloudbuild.v1.projects.locations.builds.get",
    apiFamily: "cloudbuild",
    apiVersion: "v1",
    host: "https://cloudbuild.googleapis.com",
    pathTemplate:
      "/v1/projects/{projectId}/locations/{location}/builds/{buildId}",
    officialTranscodingTemplate:
      "/v1/{name=projects/*/locations/*/builds/*}",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
      buildId: scalar("string", {
        pattern:
          "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$",
        minLength: 36,
        maxLength: 36,
        binding: "approved_build_id",
        encoding: "path_segment",
      }),
    }),
    responseSchema: "google.devtools.cloudbuild.v1.Build",
    ...resourceResponse("id"),
  }),
  descriptor({
    operationId: "storage.v1.objects.getMetadata",
    apiFamily: "storage",
    apiVersion: "v1",
    host: "https://storage.googleapis.com",
    pathTemplate: "/storage/v1/b/{bucket}/o/{object}",
    pathParams: pathParams({
      bucket: scalar("string", {
        pattern: "^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$",
        minLength: 3,
        maxLength: 222,
        binding: "approved_storage_source_bucket",
        encoding: "path_segment",
      }),
      object: scalar("string", {
        pattern:
          "^(?!/)(?!.*//)(?!.*\\/$)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*[%?#\\u0000-\\u001f\\u007f]).{1,1024}$",
        minLength: 1,
        maxLength: 1024,
        binding: "approved_storage_source_object",
        encoding: "storage_object",
      }),
    }),
    query: query({
      generation: scalar("string", {
        pattern: "^[0-9]{1,20}$",
        minLength: 1,
        maxLength: 20,
        binding: "approved_storage_source_generation",
      }),
    }, ["generation"]),
    responseSchema: "storage.v1.Object",
    ...resourceResponse("name", {
      bucket: responseField("string", {minLength: 1}),
      generation: responseField("string", {minLength: 1}),
      md5Hash: responseField("string", {minLength: 24}),
      size: responseField("string", {minLength: 1}),
    }),
  }),
  descriptor({
    operationId: "storage.v1.objects.getMedia",
    apiFamily: "storage",
    apiVersion: "v1",
    host: "https://storage.googleapis.com",
    pathTemplate: "/storage/v1/b/{bucket}/o/{object}",
    pathParams: pathParams({
      bucket: scalar("string", {
        pattern: "^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$",
        minLength: 3,
        maxLength: 222,
        binding: "approved_storage_source_bucket",
        encoding: "path_segment",
      }),
      object: scalar("string", {
        pattern:
          "^(?!/)(?!.*//)(?!.*\\/$)(?!.*(?:^|/)\\.{1,2}(?:/|$))(?!.*[%?#\\u0000-\\u001f\\u007f]).{1,1024}$",
        minLength: 1,
        maxLength: 1024,
        binding: "approved_storage_source_object",
        encoding: "storage_object",
      }),
    }),
    query: query({
      alt: scalar("string", {
        const: "media",
        binding: "contract_literal",
      }),
      generation: scalar("string", {
        pattern: "^[0-9]{1,20}$",
        minLength: 1,
        maxLength: 20,
        binding: "approved_storage_source_generation",
      }),
    }, ["alt", "generation"]),
    maxResponseBytes: 64 * 1024 * 1024,
    responseSchema: "storage.v1.ObjectMediaBytes",
    responseKind: "media",
  }),
  ...[
    ["projects", "project", projectId],
    ["folders", "folder", discoveredParentId],
    ["organizations", "organization", discoveredParentId],
  ].flatMap(([collection, singular, schemaFactory]) => [
    descriptor({
      operationId: `cloudresourcemanager.v3.${collection}.get`,
      apiFamily: "cloudresourcemanager",
      apiVersion: "v3",
      host: "https://cloudresourcemanager.googleapis.com",
      pathTemplate: `/v3/${collection}/{${singular}Id}`,
      officialTranscodingTemplate: `/v3/{name=${collection}/*}`,
      pathParams: pathParams({[`${singular}Id`]: schemaFactory()}),
      responseSchema:
        `google.cloud.resourcemanager.v3.${singular[0].toUpperCase()}${singular.slice(1)}`,
      ...resourceResponse(),
    }),
    descriptor({
      operationId: `cloudresourcemanager.v3.${collection}.getIamPolicy`,
      apiFamily: "cloudresourcemanager",
      apiVersion: "v3",
      host: "https://cloudresourcemanager.googleapis.com",
      method: "POST",
      pathTemplate: `/v3/${collection}/{${singular}Id}:getIamPolicy`,
      officialTranscodingTemplate:
        `/v3/{resource=${collection}/*}:getIamPolicy`,
      pathParams: pathParams({[`${singular}Id`]: schemaFactory()}),
      requestBody: getIamPolicyBody(),
      responseSchema: "google.iam.v1.Policy",
      ...policyResponse(),
    }),
  ]),
  descriptor({
    operationId: "cloudasset.v1.projects.analyzeIamPolicy",
    apiFamily: "cloudasset",
    apiVersion: "v1",
    host: "https://cloudasset.googleapis.com",
    pathTemplate: "/v1/projects/{projectNumber}:analyzeIamPolicy",
    officialTranscodingTemplate:
      "/v1/{analysisQuery.scope=*/*}:analyzeIamPolicy",
    pathParams: pathParams({projectNumber: projectNumber()}),
    query: query({
      "analysisQuery.accessSelector.permissions": {
        type: "array",
        minItems: 1,
        maxItems: 100,
        uniqueItems: true,
        binding: "approved_permission_set",
        serialization: "repeat_key",
        items: scalar("string", {
          pattern: "^[a-z][a-z0-9]*(?:\\.[A-Za-z0-9_]+)+$",
          minLength: 3,
          maxLength: 256,
          binding: "approved_permission",
        }),
      },
      "analysisQuery.identitySelector.identity":
        boundedString(512, "approved_principal"),
      "analysisQuery.resourceSelector.fullResourceName":
        boundedString(2048, "approved_resource_name"),
      executionTimeout: scalar("string", {
        const: "90s",
        binding: "contract_literal",
      }),
      "options.expandGroups": scalar("boolean", {
        const: true,
        binding: "contract_literal",
      }),
      "options.expandResources": scalar("boolean", {
        const: true,
        binding: "contract_literal",
      }),
      "options.expandRoles": scalar("boolean", {
        const: true,
        binding: "contract_literal",
      }),
      "options.outputGroupEdges": scalar("boolean", {
        const: true,
        binding: "contract_literal",
      }),
      "options.outputResourceEdges": scalar("boolean", {
        const: true,
        binding: "contract_literal",
      }),
    }, [
      "analysisQuery.accessSelector.permissions",
      "analysisQuery.identitySelector.identity",
      "analysisQuery.resourceSelector.fullResourceName",
      "executionTimeout",
      "options.expandGroups",
      "options.expandResources",
      "options.expandRoles",
      "options.outputGroupEdges",
      "options.outputResourceEdges",
    ]),
    pagination: nonpaged(10000),
    responseSchema: "google.cloud.asset.v1.AnalyzeIamPolicyResponse",
    requiredResponseFields: {
      fullyExplored: responseField("boolean"),
      mainAnalysis: responseField("object"),
    },
    identityField: null,
    partialIndicators: [
      partialSuccessIndicator(),
      partialIndicator("fullyExplored", "require_true", true),
      partialIndicator(
          "nonCriticalErrors",
          "reject_nonempty_array",
      ),
    ],
  }),
  descriptor({
    operationId: "policytroubleshooter.v3.iam.troubleshoot",
    apiFamily: "policytroubleshooter",
    apiVersion: "v3",
    host: "https://policytroubleshooter.googleapis.com",
    method: "POST",
    pathTemplate: "/v3/iam:troubleshoot",
    pathParams: pathParams({}),
    requestBody: semanticBody(objectSchema({
      accessTuple: objectSchema({
        fullResourceName: boundedString(
            2048,
            "approved_or_discovered_target_resource",
        ),
        permission: scalar("string", {
          pattern: "^[a-z][a-z0-9]*(?:\\.[A-Za-z0-9_]+)+$",
          minLength: 3,
          maxLength: 256,
          binding: "approved_reviewed_permission",
        }),
        principal: boundedString(
            512,
            "approved_iam_principal_or_group",
        ),
      }),
    })),
    responseSchema: "google.cloud.policytroubleshooter.iam.v3.TroubleshootIamPolicyResponse",
    requiredResponseFields: {
      access: responseField("string", {minLength: 1}),
    },
    identityField: null,
    partialIndicators: [partialSuccessIndicator()],
  }),
  descriptor({
    operationId: "iam.v2.policies.denypolicies.list",
    apiFamily: "iam",
    apiVersion: "v2",
    host: "https://iam.googleapis.com",
    pathTemplate: "/v2/policies/{attachmentPoint}/denypolicies",
    officialTranscodingTemplate:
      "/v2/{parent=policies/*/denypolicies}",
    pathParams: pathParams({
      attachmentPoint: iamAttachmentPoint(),
    }),
    query: query({
      pageSize: pageSize(100),
      pageToken: pageToken(),
    }),
    pagination: paged("pageSize", 100),
    responseSchema: "google.iam.v2.ListPoliciesResponse",
    ...listResponse("policies"),
  }),
  descriptor({
    operationId: "iam.v2.policies.denypolicies.get",
    apiFamily: "iam",
    apiVersion: "v2",
    host: "https://iam.googleapis.com",
    pathTemplate:
      "/v2/policies/{attachmentPoint}/denypolicies/{policyId}",
    officialTranscodingTemplate:
      "/v2/{name=policies/*/denypolicies/*}",
    pathParams: pathParams({
      attachmentPoint: iamAttachmentPoint(),
      policyId: resourceId("discovered_deny_policy_id"),
    }),
    responseSchema: "google.iam.v2.Policy",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "iam.v1.projects.roles.list",
    apiFamily: "iam",
    apiVersion: "v1",
    host: "https://iam.googleapis.com",
    pathTemplate: "/v1/projects/{projectId}/roles",
    officialTranscodingTemplate: "/v1/{parent=projects/*}/roles",
    pathParams: pathParams({projectId: projectId()}),
    query: query({
      pageSize: pageSize(1000),
      pageToken: pageToken(),
    }),
    pagination: paged(),
    responseSchema: "google.iam.admin.v1.ListRolesResponse",
    ...listResponse("roles"),
  }),
  descriptor({
    operationId: "iam.v1.projects.roles.get",
    apiFamily: "iam",
    apiVersion: "v1",
    host: "https://iam.googleapis.com",
    pathTemplate: "/v1/projects/{projectId}/roles/{roleId}",
    officialTranscodingTemplate: "/v1/{name=projects/*/roles/*}",
    pathParams: pathParams({
      projectId: projectId(),
      roleId: resourceId("approved_iam_role_id"),
    }),
    responseSchema: "google.iam.admin.v1.Role",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "iam.v1.projects.serviceAccounts.list",
    apiFamily: "iam",
    apiVersion: "v1",
    host: "https://iam.googleapis.com",
    pathTemplate: "/v1/projects/{projectId}/serviceAccounts",
    officialTranscodingTemplate:
      "/v1/{name=projects/*}/serviceAccounts",
    pathParams: pathParams({projectId: projectId()}),
    query: query({
      pageSize: pageSize(100),
      pageToken: pageToken(),
    }),
    pagination: paged("pageSize", 100),
    responseSchema: "google.iam.admin.v1.ListServiceAccountsResponse",
    ...listResponse("accounts"),
  }),
  descriptor({
    operationId: "iam.v1.projects.serviceAccounts.get",
    apiFamily: "iam",
    apiVersion: "v1",
    host: "https://iam.googleapis.com",
    pathTemplate:
      "/v1/projects/{projectId}/serviceAccounts/{serviceAccount}",
    officialTranscodingTemplate:
      "/v1/{name=projects/*/serviceAccounts/*}",
    pathParams: pathParams({
      projectId: projectId(),
      serviceAccount: serviceAccountEmail(),
    }),
    responseSchema: "google.iam.admin.v1.ServiceAccount",
    ...resourceResponse("name", {
      email: responseField("string", {minLength: 1}),
    }),
  }),
  descriptor({
    operationId: "iam.v1.projects.serviceAccounts.getIamPolicy",
    apiFamily: "iam",
    apiVersion: "v1",
    host: "https://iam.googleapis.com",
    method: "POST",
    pathTemplate:
      "/v1/projects/{projectId}/serviceAccounts/{serviceAccount}:getIamPolicy",
    officialTranscodingTemplate:
      "/v1/{resource=projects/*/serviceAccounts/*}:getIamPolicy",
    pathParams: pathParams({
      projectId: projectId(),
      serviceAccount: serviceAccountEmail(),
    }),
    requestBody: getIamPolicyBody(),
    responseSchema: "google.iam.v1.Policy",
    ...policyResponse(),
  }),
  descriptor({
    operationId: "cloudscheduler.v1.projects.locations.jobs.list",
    apiFamily: "cloudscheduler",
    apiVersion: "v1",
    host: "https://cloudscheduler.googleapis.com",
    pathTemplate:
      "/v1/projects/{projectId}/locations/{location}/jobs",
    officialTranscodingTemplate:
      "/v1/{parent=projects/*/locations/*}/jobs",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
    }),
    query: query({
      pageSize: pageSize(500),
      pageToken: pageToken(),
    }),
    pagination: paged("pageSize", 500),
    responseSchema: "google.cloud.scheduler.v1.ListJobsResponse",
    ...listResponse("jobs"),
  }),
  descriptor({
    operationId: "cloudscheduler.v1.projects.locations.jobs.get",
    apiFamily: "cloudscheduler",
    apiVersion: "v1",
    host: "https://cloudscheduler.googleapis.com",
    pathTemplate:
      "/v1/projects/{projectId}/locations/{location}/jobs/{jobId}",
    officialTranscodingTemplate:
      "/v1/{name=projects/*/locations/*/jobs/*}",
    pathParams: pathParams({
      projectId: projectId(),
      location: locationId(),
      jobId: resourceId("approved_scheduler_job_id"),
    }),
    responseSchema: "google.cloud.scheduler.v1.Job",
    ...resourceResponse(),
  }),
  descriptor({
    operationId: "serviceusage.v1.projects.services.get",
    apiFamily: "serviceusage",
    apiVersion: "v1",
    host: "https://serviceusage.googleapis.com",
    pathTemplate:
      "/v1/projects/{projectNumber}/services/{serviceName}",
    officialTranscodingTemplate:
      "/v1/{name=projects/*/services/*}",
    pathParams: pathParams({
      projectNumber: projectNumber(),
      serviceName: scalar("string", {
        pattern: "^[a-z][a-z0-9-]{0,62}(?:\\.[a-z][a-z0-9-]{0,62})+$",
        minLength: 3,
        maxLength: 253,
        binding: "approved_service_usage_service",
        encoding: "path_segment",
      }),
    }),
    responseSchema: "google.api.serviceusage.v1.Service",
    ...resourceResponse("name", {
      state: responseField("string", {minLength: 1}),
    }),
  }),
];

operations.sort((left, right) =>
  left.operationId < right.operationId ? -1 :
    left.operationId > right.operationId ? 1 : 0);

export const PROVIDER_OPERATION_IDS = deepFreeze(
    operations.map(({operationId}) => operationId),
);
export const PROVIDER_OPERATION_COUNT = PROVIDER_OPERATION_IDS.length;

const operationMap = Object.create(null);
for (const operation of operations) operationMap[operation.operationId] = operation;
export const PROVIDER_OPERATION_REGISTRY = deepFreeze(operationMap);

function assertOwnEnumerableDataProperties(value, label, expectedPrototype) {
  if (!value || typeof value !== "object" ||
      Object.getPrototypeOf(value) !== expectedPrototype) {
    throw new Error(`${label} has an unapproved prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error(`${label} contains a symbol key`);
  }
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property || property.enumerable !== true ||
        !Object.hasOwn(property, "value")) {
      throw new Error(`${label}.${key} is not an enumerable data property`);
    }
  }
  return keys;
}

function assertFrozenCanonicalShape(value, label) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} is not finite`);
    return;
  }
  if (Array.isArray(value)) {
    if (!Object.isFrozen(value) ||
        Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error(`${label} is not a frozen standard array`);
    }
    const keys = Reflect.ownKeys(value);
    const expected = [
      ...Array.from({length: value.length}, (_, index) => String(index)),
      "length",
    ].sort();
    if (keys.some((key) => typeof key !== "string") ||
        JSON.stringify([...keys].sort()) !== JSON.stringify(expected)) {
      throw new Error(`${label} is sparse or has custom keys`);
    }
    value.forEach((item, index) =>
      assertFrozenCanonicalShape(item, `${label}[${index}]`));
    return;
  }
  const keys =
    assertOwnEnumerableDataProperties(value, label, Object.prototype);
  if (!Object.isFrozen(value)) throw new Error(`${label} is not frozen`);
  keys.forEach((key) =>
    assertFrozenCanonicalShape(value[key], `${label}.${key}`));
}

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function assertSemanticBodySchema(schema, label) {
  if (schema?.type === "object") {
    const expectedSchemaKeys = [
      "additionalProperties", "properties", "required", "type",
    ];
    const propertyKeys = Object.keys(schema.properties).sort();
    if (JSON.stringify(Object.keys(schema).sort()) !==
          JSON.stringify(expectedSchemaKeys) ||
        schema.additionalProperties !== false ||
        JSON.stringify(schema.required) !== JSON.stringify(propertyKeys)) {
      throw new Error(`${label} object schema is not exact own-key-only`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      assertSemanticBodySchema(childSchema, `${label}.${key}`);
    }
    return;
  }
  const allowedScalarKeys = [
    "binding", "const", "enum", "maxLength", "maximum", "minLength",
    "minimum", "pattern", "type",
  ];
  if (!schema || !["integer", "string"].includes(schema.type) ||
      Object.keys(schema).some((key) => !allowedScalarKeys.includes(key)) ||
      !PROVIDER_SEMANTIC_BODY_BINDINGS.includes(schema.binding)) {
    throw new Error(`${label} scalar binding/schema is not approved`);
  }
}

export function computeProviderOperationDescriptorSetDigest(
    registry = PROVIDER_OPERATION_REGISTRY,
) {
  return crypto.createHash("sha256").update(canonical({
    version: PROVIDER_OPERATION_ALLOWLIST_VERSION,
    operations: PROVIDER_OPERATION_IDS.map((operationId) => registry[operationId]),
  })).digest("hex");
}

export const EXPECTED_PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST =
  "2bc2dd2e27252549c3aa7382790ed4e49dc1752a7162bca36b7f0601a7b947e9";
export const PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST =
  computeProviderOperationDescriptorSetDigest();

export function assertProviderOperationRegistry(
    registry = PROVIDER_OPERATION_REGISTRY,
) {
  const keys =
    assertOwnEnumerableDataProperties(registry, "provider operation map", null);
  if (!Object.isFrozen(registry)) {
    throw new Error("provider operation map is not frozen");
  }
  if (JSON.stringify([...keys].sort()) !==
      JSON.stringify(PROVIDER_OPERATION_IDS)) {
    throw new Error("provider operation exact keyset mismatch");
  }
  for (const operationId of PROVIDER_OPERATION_IDS) {
    const operation = registry[operationId];
    assertFrozenCanonicalShape(operation, `provider operation ${operationId}`);
    if (JSON.stringify(Object.keys(operation).sort()) !==
        JSON.stringify(DESCRIPTOR_KEYS) ||
        operation.operationId !== operationId) {
      throw new Error(`provider operation descriptor schema mismatch: ${operationId}`);
    }
    if (!operation.host.startsWith("https://") ||
        operation.host.slice(8).includes("/") ||
        operation.redirects !== "disallow" ||
        operation.readOnlySemantic !== true) {
      throw new Error(`provider operation network boundary mismatch: ${operationId}`);
    }
    const placeholders = [
      ...operation.pathTemplate.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g),
    ].map((match) => match[1]);
    const templateWithoutPlaceholders = operation.pathTemplate.replace(
        /\{[A-Za-z][A-Za-z0-9]*\}/g,
        "",
    );
    const pathParamKeys = Object.keys(operation.pathParams.properties).sort();
    if (/[=*{}]/.test(templateWithoutPlaceholders) ||
        new Set(placeholders).size !== placeholders.length ||
        JSON.stringify([...placeholders].sort()) !==
          JSON.stringify(pathParamKeys) ||
        JSON.stringify(operation.pathParams.required) !==
          JSON.stringify(pathParamKeys) ||
        typeof operation.officialTranscodingTemplate !== "string" ||
        !operation.officialTranscodingTemplate.startsWith("/")) {
      throw new Error(`provider path template/parameter mismatch: ${operationId}`);
    }
    for (const [name, schema] of
      Object.entries(operation.pathParams.properties)) {
      if (schema.type !== "string" ||
          !PROVIDER_PATH_ENCODING_MODES.includes(schema.encoding) ||
          !PROVIDER_PATH_LINEAGE_BINDINGS.includes(schema.binding)) {
        throw new Error(
            `provider path parameter binding/encoding mismatch: ${operationId}.${name}`,
        );
      }
      if (name === "projectId" &&
          schema.const !== PROVIDER_TARGET_PROJECT_ID) {
        throw new Error(`foreign projectId schema: ${operationId}`);
      }
      if (name === "projectNumber" &&
          schema.const !== PROVIDER_TARGET_PROJECT_NUMBER) {
        throw new Error(`foreign projectNumber schema: ${operationId}`);
      }
      if (name === "location" &&
          schema.const !== PROVIDER_APPROVED_LOCATION) {
        throw new Error(`foreign location schema: ${operationId}`);
      }
      if (["folderId", "organizationId"].includes(name) &&
          (schema.binding !== "discovered_parent_lineage" ||
            !new RegExp(schema.pattern).test("123456789") ||
            new RegExp(schema.pattern).test("arbitrary"))) {
        throw new Error(`parent lineage schema mismatch: ${operationId}.${name}`);
      }
      if (schema.encoding === "storage_object") {
        const pattern = new RegExp(schema.pattern);
        if (!pattern.test("approved/source/archive.zip") ||
            ["../secret", "dir/../secret", "dir//file", "dir/file/",
              "dir%2Ffile", "dir?alt=media", "dir#fragment"]
                .some((value) => pattern.test(value))) {
          throw new Error(`storage object schema mismatch: ${operationId}.${name}`);
        }
      }
      if (schema.encoding === "iam_attachment_point") {
        const pattern = new RegExp(schema.pattern);
        if (!pattern.test(
            "cloudresourcemanager.googleapis.com/projects/" +
            PROVIDER_TARGET_PROJECT_ID,
        ) ||
            !pattern.test(
                "cloudresourcemanager.googleapis.com/folders/123456789",
            ) ||
            pattern.test(
                "cloudresourcemanager.googleapis.com%2Ffolders%2F123456789",
            ) ||
            pattern.test(
                "cloudresourcemanager.googleapis.com/projects/foreign-project",
            )) {
          throw new Error(`IAM attachment schema mismatch: ${operationId}.${name}`);
        }
      }
      if (name === "serviceAccount") {
        const pattern = new RegExp(schema.pattern);
        if (!pattern.test(
            "academy-runtime@daegu-miami-production.iam.gserviceaccount.com",
        ) ||
            !pattern.test(
                "884850632328-compute@developer.gserviceaccount.com",
            ) ||
            pattern.test(
                "academy-runtime@foreign-project.iam.gserviceaccount.com",
            )) {
          throw new Error(
              `service-account email schema mismatch: ${operationId}.${name}`,
          );
        }
      }
    }
    for (const [queryKey, schema] of
      Object.entries(operation.query.properties)) {
      if (schema.type === "array" && schema.serialization !== "repeat_key") {
        throw new Error(
            `provider query array serialization mismatch: ${operationId}.${queryKey}`,
        );
      }
      if (["filter", "orderBy", "showDeleted", "view"]
          .includes(queryKey)) {
        throw new Error(
            `provider narrowing query rejected: ${operationId}.${queryKey}`,
        );
      }
    }
    if (operationId === "cloudasset.v1.projects.analyzeIamPolicy") {
      const expectedOptions = [
        "options.expandGroups",
        "options.expandResources",
        "options.expandRoles",
        "options.outputGroupEdges",
        "options.outputResourceEdges",
      ];
      const queryKeys = Object.keys(operation.query.properties);
      const permissions =
        operation.query.properties[
            "analysisQuery.accessSelector.permissions"
        ];
      if (operation.officialTranscodingTemplate !==
            "/v1/{analysisQuery.scope=*/*}:analyzeIamPolicy" ||
          operation.pathTemplate !==
            "/v1/projects/{projectNumber}:analyzeIamPolicy" ||
          permissions.serialization !== "repeat_key" ||
          operation.query.properties.executionTimeout.const !== "90s" ||
          expectedOptions.some((key) => !queryKeys.includes(key)) ||
          expectedOptions.some((key) =>
            operation.query.properties[key].const !== true) ||
          expectedOptions.some((key) =>
            !operation.query.required.includes(key)) ||
          !operation.query.required.includes("executionTimeout") ||
          queryKeys.some((key) => key.startsWith("analysisQuery.options."))) {
        throw new Error("Cloud Asset transcoding/query contract mismatch");
      }
    }
    if (!["GET", "POST"].includes(operation.method) ||
        ["PUT", "PATCH", "DELETE"].includes(operation.method)) {
      throw new Error(`provider operation mutation method rejected: ${operationId}`);
    }
    if (operation.method === "GET" &&
        operation.requestBody.mode !== "forbidden") {
      throw new Error(`GET request body must be forbidden: ${operationId}`);
    }
    if (operation.method === "POST" &&
        (!operationId.endsWith(".getIamPolicy") &&
          operationId !== "policytroubleshooter.v3.iam.troubleshoot")) {
      throw new Error(`unapproved semantic POST: ${operationId}`);
    }
    if (operation.method === "POST") {
      if (JSON.stringify(Object.keys(operation.requestBody).sort()) !==
            JSON.stringify([
              "contentType", "exactProjection", "mode", "schema",
            ]) ||
          operation.requestBody.mode !== "required" ||
          operation.requestBody.contentType !== "application/json" ||
          operation.requestBody.exactProjection !== true) {
        throw new Error(`semantic POST body contract mismatch: ${operationId}`);
      }
      assertSemanticBodySchema(
          operation.requestBody.schema,
          `semantic POST body ${operationId}`,
      );
    }
    if (operationId === "policytroubleshooter.v3.iam.troubleshoot") {
      const tuple =
        operation.requestBody.schema.properties.accessTuple;
      const expectedBindings = {
        fullResourceName: "approved_or_discovered_target_resource",
        permission: "approved_reviewed_permission",
        principal: "approved_iam_principal_or_group",
      };
      if (JSON.stringify(Object.keys(tuple.properties).sort()) !==
            JSON.stringify(Object.keys(expectedBindings).sort()) ||
          Object.entries(expectedBindings).some(([key, binding]) =>
            tuple.properties[key].binding !== binding)) {
        throw new Error("Policy Troubleshooter body binding mismatch");
      }
    }
    if (operation.timeout.milliseconds !==
          (operation.method === "GET" ? 10000 : 30000) ||
        operation.retry.maxRetries !== 3 ||
        JSON.stringify(operation.retry.statusCodes) !==
          JSON.stringify(RETRY_STATUS_CODES) ||
        !Number.isSafeInteger(operation.maxResponseBytes) ||
        operation.maxResponseBytes <= 0) {
      throw new Error(`provider operation safety bounds mismatch: ${operationId}`);
    }
    if (operation.pagination.maxPages > 100 ||
        operation.pagination.maxRecords > 10000) {
      throw new Error(`provider pagination bound exceeded: ${operationId}`);
    }
    const responseKeys = [
      "identityField", "kind", "nextPageTokenField", "partialIndicators",
      "recordRequiredFields", "recordsField", "requiredFields", "schema",
      "unknownCriticalFields", "unknownFields", "version",
    ].sort();
    if (JSON.stringify(Object.keys(operation.response).sort()) !==
          JSON.stringify(responseKeys) ||
        !["json", "media"].includes(operation.response.kind) ||
        operation.response.unknownFields !==
          "allow_noncritical_api_expansion" ||
        operation.response.unknownCriticalFields !==
          "reject_reserved_partial_indicators" ||
        (operation.pagination.mode === "paged" &&
          (typeof operation.response.recordsField !== "string" ||
            operation.response.nextPageTokenField !== "nextPageToken" ||
            operation.response.requiredFields[
                operation.response.recordsField
            ]?.type !== "array" ||
            typeof operation.response.identityField !== "string" ||
            operation.response.recordRequiredFields[
                operation.response.identityField
            ]?.type !== "string")) ||
        (operation.pagination.mode !== "paged" &&
          (operation.response.recordsField !== null ||
            operation.response.nextPageTokenField !== null)) ||
        (operation.response.kind === "media" &&
          (operation.response.schema !== "storage.v1.ObjectMediaBytes" ||
            Object.keys(operation.response.requiredFields).length !== 0)) ||
        (operation.response.kind === "json" &&
          Object.keys(operation.response.requiredFields).length === 0)) {
      throw new Error(`provider response contract mismatch: ${operationId}`);
    }
    for (const [field, schema] of Object.entries({
      ...operation.response.requiredFields,
      ...operation.response.recordRequiredFields,
    })) {
      if (!field || !["array", "boolean", "integer", "object", "string"]
          .includes(schema.type) ||
          Object.keys(schema).some((key) =>
            !["minLength", "type"].includes(key))) {
        throw new Error(
            `provider response field schema mismatch: ${operationId}.${field}`,
        );
      }
    }
    const partialFields = new Set();
    for (const indicator of operation.response.partialIndicators) {
      if (JSON.stringify(Object.keys(indicator).sort()) !==
            JSON.stringify(["field", "policy", "required"]) ||
          typeof indicator.field !== "string" ||
          ![
            "reject_nonempty_array",
            "reject_true",
            "require_true",
          ].includes(indicator.policy) ||
          typeof indicator.required !== "boolean" ||
          partialFields.has(indicator.field)) {
        throw new Error(
            `provider partial indicator mismatch: ${operationId}`,
        );
      }
      partialFields.add(indicator.field);
    }
    if (operation.response.kind === "json" &&
        !partialFields.has("partialSuccess")) {
      throw new Error(
          `provider partialSuccess policy missing: ${operationId}`,
      );
    }
    if (operationId === "cloudbuild.v1.projects.locations.builds.get") {
      const buildPattern =
        operation.pathParams.properties.buildId.pattern;
      if (buildPattern !==
          "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$") {
        throw new Error("Cloud Build UUID schema mismatch");
      }
    }
  }
  const digest = computeProviderOperationDescriptorSetDigest(registry);
  if (digest !== EXPECTED_PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST) {
    throw new Error("provider operation descriptor-set digest mismatch");
  }
  return true;
}

function assertExactInputRecord(value, expectedKeys, label) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    throw new Error(`${label} must be an own-key-only object`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error(`${label} contains symbol keys`);
  }
  for (const key of keys) {
    const property = Object.getOwnPropertyDescriptor(value, key);
    if (!property?.enumerable || !Object.hasOwn(property, "value")) {
      throw new Error(`${label}.${key} is not an enumerable data property`);
    }
  }
  if (JSON.stringify([...keys].sort()) !==
      JSON.stringify([...expectedKeys].sort())) {
    throw new Error(`${label} exact keyset mismatch`);
  }
}

export function assertProviderPathParameters(
    operationId,
    parameters,
    {lineageBindings = Object.create(null)} = {},
) {
  const operation = getProviderOperationDescriptor(operationId);
  const schemas = operation.pathParams.properties;
  assertExactInputRecord(parameters, Object.keys(schemas), "path parameters");
  for (const [name, schema] of Object.entries(schemas)) {
    const value = parameters[name];
    if (typeof value !== "string" ||
        (schema.const !== undefined && value !== schema.const) ||
        (schema.minLength !== undefined && value.length < schema.minLength) ||
        (schema.maxLength !== undefined && value.length > schema.maxLength) ||
        (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))) {
      throw new Error(`Invalid provider path parameter: ${name}`);
    }
    if (schema.const === undefined &&
        /^(?:approved_|discovered_)/.test(schema.binding)) {
      const approvedValues = Object.hasOwn(lineageBindings, schema.binding) ?
        lineageBindings[schema.binding] :
        undefined;
      if (!Array.isArray(approvedValues) || !approvedValues.includes(value)) {
        throw new Error(
            `Provider path parameter lacks ${schema.binding} lineage: ${name}`,
        );
      }
    }
  }
  return true;
}

function assertProviderBodyValue(schema, value, lineageBindings, label) {
  if (schema.type === "object") {
    assertExactInputRecord(value, Object.keys(schema.properties), label);
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      assertProviderBodyValue(
          childSchema,
          value[key],
          lineageBindings,
          `${label}.${key}`,
      );
    }
    return;
  }
  const typeValid =
    schema.type === "integer" ?
      Number.isSafeInteger(value) :
      typeof value === schema.type;
  if (!typeValid ||
      (schema.const !== undefined && value !== schema.const) ||
      (schema.enum !== undefined && !schema.enum.includes(value)) ||
      (schema.minLength !== undefined && value.length < schema.minLength) ||
      (schema.maxLength !== undefined && value.length > schema.maxLength) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value))) {
    throw new Error(`Invalid provider semantic body value: ${label}`);
  }
  if (schema.binding !== "contract_literal") {
    const approvedValues = Object.hasOwn(lineageBindings, schema.binding) ?
      lineageBindings[schema.binding] :
      undefined;
    if (!Array.isArray(approvedValues) || !approvedValues.includes(value)) {
      throw new Error(
          `Provider semantic body value lacks ${schema.binding} lineage: ${label}`,
      );
    }
  }
}

export function assertProviderRequestBody(
    operationId,
    body,
    {lineageBindings = Object.create(null)} = {},
) {
  const operation = getProviderOperationDescriptor(operationId);
  if (operation.method !== "POST" ||
      operation.requestBody.mode !== "required") {
    throw new Error(`Provider operation has no semantic request body: ${operationId}`);
  }
  assertProviderBodyValue(
      operation.requestBody.schema,
      body,
      lineageBindings,
      "requestBody",
  );
  return true;
}

export function getProviderOperationDescriptor(
    operationId,
    registry = PROVIDER_OPERATION_REGISTRY,
) {
  assertProviderOperationRegistry(registry);
  if (typeof operationId !== "string" ||
      !Object.hasOwn(registry, operationId)) {
    throw new Error(`Unknown provider operation ID: ${String(operationId)}`);
  }
  return registry[operationId];
}

assertProviderOperationRegistry();
