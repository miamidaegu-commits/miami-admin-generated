import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  EXPECTED_PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  PROVIDER_ADAPTER_CONTRACT_VERSION,
  PROVIDER_AUTH_DEPENDENCY,
  PROVIDER_HTTP_RUNTIME,
  PROVIDER_NO_MUTATION_OPERATION_COUNT,
  PROVIDER_APPROVED_LOCATION,
  PROVIDER_OPERATION_ALLOWLIST_VERSION,
  PROVIDER_OPERATION_COUNT,
  PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_TARGET_PROJECT_ID,
  PROVIDER_TARGET_PROJECT_NUMBER,
  PROVIDER_TRANSPORT,
  assertProviderPathParameters,
  assertProviderRequestBody,
  assertProviderOperationRegistry,
  computeProviderOperationDescriptorSetDigest,
  getProviderOperationDescriptor,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const BASE_SHA = "c10a344a8c09cfacb06d7a7c8e1856d1d99bbe04";

const EXPECTED_OPERATION_IDS = [
  "cloudasset.v1.projects.analyzeIamPolicy",
  "cloudbuild.v1.projects.locations.builds.get",
  "cloudfunctions.v2.projects.locations.functions.get",
  "cloudfunctions.v2.projects.locations.functions.list",
  "cloudresourcemanager.v3.folders.get",
  "cloudresourcemanager.v3.folders.getIamPolicy",
  "cloudresourcemanager.v3.organizations.get",
  "cloudresourcemanager.v3.organizations.getIamPolicy",
  "cloudresourcemanager.v3.projects.get",
  "cloudresourcemanager.v3.projects.getIamPolicy",
  "cloudscheduler.v1.projects.locations.jobs.get",
  "cloudscheduler.v1.projects.locations.jobs.list",
  "firebaserules.v1.projects.releases.get",
  "firebaserules.v1.projects.rulesets.get",
  "iam.v1.projects.roles.get",
  "iam.v1.projects.roles.list",
  "iam.v1.projects.serviceAccounts.get",
  "iam.v1.projects.serviceAccounts.getIamPolicy",
  "iam.v1.projects.serviceAccounts.list",
  "iam.v2.policies.denypolicies.get",
  "iam.v2.policies.denypolicies.list",
  "policytroubleshooter.v3.iam.troubleshoot",
  "run.v2.projects.locations.services.get",
  "run.v2.projects.locations.services.list",
  "run.v2.projects.locations.services.revisions.get",
  "run.v2.projects.locations.services.revisions.list",
  "serviceusage.v1.projects.services.get",
  "storage.v1.objects.getMedia",
  "storage.v1.objects.getMetadata",
];

const EXPECTED_ENDPOINTS = {
  "cloudasset.v1.projects.analyzeIamPolicy":
    ["cloudasset", "https://cloudasset.googleapis.com", "v1", "GET",
      "/v1/projects/{projectNumber}:analyzeIamPolicy"],
  "cloudbuild.v1.projects.locations.builds.get":
    ["cloudbuild", "https://cloudbuild.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/locations/{location}/builds/{buildId}"],
  "cloudfunctions.v2.projects.locations.functions.get":
    ["cloudfunctions", "https://cloudfunctions.googleapis.com", "v2", "GET",
      "/v2/projects/{projectId}/locations/{location}/functions/{functionId}"],
  "cloudfunctions.v2.projects.locations.functions.list":
    ["cloudfunctions", "https://cloudfunctions.googleapis.com", "v2", "GET",
      "/v2/projects/{projectId}/locations/{location}/functions"],
  "cloudresourcemanager.v3.folders.get":
    ["cloudresourcemanager", "https://cloudresourcemanager.googleapis.com",
      "v3", "GET", "/v3/folders/{folderId}"],
  "cloudresourcemanager.v3.folders.getIamPolicy":
    ["cloudresourcemanager", "https://cloudresourcemanager.googleapis.com",
      "v3", "POST", "/v3/folders/{folderId}:getIamPolicy"],
  "cloudresourcemanager.v3.organizations.get":
    ["cloudresourcemanager", "https://cloudresourcemanager.googleapis.com",
      "v3", "GET", "/v3/organizations/{organizationId}"],
  "cloudresourcemanager.v3.organizations.getIamPolicy":
    ["cloudresourcemanager", "https://cloudresourcemanager.googleapis.com",
      "v3", "POST", "/v3/organizations/{organizationId}:getIamPolicy"],
  "cloudresourcemanager.v3.projects.get":
    ["cloudresourcemanager", "https://cloudresourcemanager.googleapis.com",
      "v3", "GET", "/v3/projects/{projectId}"],
  "cloudresourcemanager.v3.projects.getIamPolicy":
    ["cloudresourcemanager", "https://cloudresourcemanager.googleapis.com",
      "v3", "POST", "/v3/projects/{projectId}:getIamPolicy"],
  "cloudscheduler.v1.projects.locations.jobs.get":
    ["cloudscheduler", "https://cloudscheduler.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/locations/{location}/jobs/{jobId}"],
  "cloudscheduler.v1.projects.locations.jobs.list":
    ["cloudscheduler", "https://cloudscheduler.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/locations/{location}/jobs"],
  "firebaserules.v1.projects.releases.get":
    ["firebaserules", "https://firebaserules.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/releases/{releaseId}"],
  "firebaserules.v1.projects.rulesets.get":
    ["firebaserules", "https://firebaserules.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/rulesets/{rulesetId}"],
  "iam.v1.projects.roles.get":
    ["iam", "https://iam.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/roles/{roleId}"],
  "iam.v1.projects.roles.list":
    ["iam", "https://iam.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/roles"],
  "iam.v1.projects.serviceAccounts.get":
    ["iam", "https://iam.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/serviceAccounts/{serviceAccount}"],
  "iam.v1.projects.serviceAccounts.getIamPolicy":
    ["iam", "https://iam.googleapis.com", "v1", "POST",
      "/v1/projects/{projectId}/serviceAccounts/{serviceAccount}:getIamPolicy"],
  "iam.v1.projects.serviceAccounts.list":
    ["iam", "https://iam.googleapis.com", "v1", "GET",
      "/v1/projects/{projectId}/serviceAccounts"],
  "iam.v2.policies.denypolicies.get":
    ["iam", "https://iam.googleapis.com", "v2", "GET",
      "/v2/policies/{attachmentPoint}/denypolicies/{policyId}"],
  "iam.v2.policies.denypolicies.list":
    ["iam", "https://iam.googleapis.com", "v2", "GET",
      "/v2/policies/{attachmentPoint}/denypolicies"],
  "policytroubleshooter.v3.iam.troubleshoot":
    ["policytroubleshooter", "https://policytroubleshooter.googleapis.com",
      "v3", "POST", "/v3/iam:troubleshoot"],
  "run.v2.projects.locations.services.get":
    ["run", "https://run.googleapis.com", "v2", "GET",
      "/v2/projects/{projectId}/locations/{location}/services/{serviceId}"],
  "run.v2.projects.locations.services.list":
    ["run", "https://run.googleapis.com", "v2", "GET",
      "/v2/projects/{projectId}/locations/{location}/services"],
  "run.v2.projects.locations.services.revisions.get":
    ["run", "https://run.googleapis.com", "v2", "GET",
      "/v2/projects/{projectId}/locations/{location}/services/{serviceId}/revisions/{revisionId}"],
  "run.v2.projects.locations.services.revisions.list":
    ["run", "https://run.googleapis.com", "v2", "GET",
      "/v2/projects/{projectId}/locations/{location}/services/{serviceId}/revisions"],
  "serviceusage.v1.projects.services.get":
    ["serviceusage", "https://serviceusage.googleapis.com", "v1", "GET",
      "/v1/projects/{projectNumber}/services/{serviceName}"],
  "storage.v1.objects.getMedia":
    ["storage", "https://storage.googleapis.com", "v1", "GET",
      "/storage/v1/b/{bucket}/o/{object}"],
  "storage.v1.objects.getMetadata":
    ["storage", "https://storage.googleapis.com", "v1", "GET",
      "/storage/v1/b/{bucket}/o/{object}"],
};

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function clonedRegistry() {
  const clone = Object.create(null);
  for (const operationId of PROVIDER_OPERATION_IDS) {
    clone[operationId] = structuredClone(PROVIDER_OPERATION_REGISTRY[operationId]);
  }
  return clone;
}

test("operation registry has the exact sorted keyset and endpoint semantics", () => {
  assert.equal(PROVIDER_OPERATION_COUNT, 29);
  assert.deepEqual(PROVIDER_OPERATION_IDS, EXPECTED_OPERATION_IDS);
  assert.deepEqual(Object.keys(PROVIDER_OPERATION_REGISTRY),
      EXPECTED_OPERATION_IDS);
  assert.equal(Object.getPrototypeOf(PROVIDER_OPERATION_REGISTRY), null);
  assert.equal(Object.isFrozen(PROVIDER_OPERATION_REGISTRY), true);
  assert.doesNotThrow(() => assertProviderOperationRegistry());

  const summaries = Object.fromEntries(PROVIDER_OPERATION_IDS.map(
      (operationId) => {
        const operation = PROVIDER_OPERATION_REGISTRY[operationId];
        return [operationId, [
          operation.apiFamily,
          operation.host,
          operation.apiVersion,
          operation.method,
          operation.pathTemplate,
        ]];
      },
  ));
  assert.deepEqual(summaries, EXPECTED_ENDPOINTS);
});

test("every descriptor has exact schemas and bounded transport policy", () => {
  const exactDescriptorKeys = [
    "apiFamily", "apiVersion", "host", "maxResponseBytes", "method",
    "officialTranscodingTemplate", "operationId", "pagination", "pathParams",
    "pathTemplate", "query", "readOnlySemantic", "redirects", "requestBody",
    "response", "retry", "timeout",
  ].sort();
  for (const operationId of PROVIDER_OPERATION_IDS) {
    const operation = PROVIDER_OPERATION_REGISTRY[operationId];
    assert.deepEqual(Object.keys(operation).sort(), exactDescriptorKeys);
    assert.equal(operation.operationId, operationId);
    assert.equal(operation.readOnlySemantic, true);
    assert.equal(operation.redirects, "disallow");
    assert.equal(operation.pathParams.type, "object");
    assert.equal(operation.pathParams.additionalProperties, false);
    assert.equal(operation.query.type, "object");
    assert.equal(operation.query.additionalProperties, false);
    assert.equal(operation.timeout.milliseconds,
        operation.method === "GET" ? 10000 : 30000);
    assert.deepEqual(operation.retry, {
      maxRetries: 3,
      statusCodes: [408, 429, 500, 502, 503, 504],
    });
    assert.equal(operation.pagination.maxPages <= 100, true);
    assert.equal(operation.pagination.maxRecords <= 10000, true);
    assert.equal(Number.isSafeInteger(operation.maxResponseBytes), true);
    assert.equal(operation.maxResponseBytes > 0, true);
    assert.equal(typeof operation.response.schema, "string");
    assert.equal(operation.response.version, operation.apiVersion);
    assert.equal(operation.response.kind,
        operationId === "storage.v1.objects.getMedia" ? "media" : "json");
    assert.equal(operation.response.unknownFields,
        "allow_noncritical_api_expansion");
    assert.equal(operation.response.unknownCriticalFields,
        "reject_reserved_partial_indicators");
    assert.equal(Array.isArray(operation.response.partialIndicators), true);
    assert.equal(typeof operation.response.requiredFields, "object");
    assert.equal(
        typeof operation.response.recordsField === "string",
        operation.pagination.mode === "paged",
    );
    assert.equal(
        operation.response.nextPageTokenField === "nextPageToken",
        operation.pagination.mode === "paged",
    );
    if (operation.response.kind === "json") {
      assert.equal(
          Object.keys(operation.response.requiredFields).length > 0,
          true,
      );
      assert.equal(
          operation.response.partialIndicators
              .some(({field}) => field === "partialSuccess"),
          true,
      );
    }
    if (operation.pagination.mode === "paged") {
      assert.equal(
          operation.response.requiredFields[
              operation.response.recordsField
          ].type,
          "array",
      );
      assert.equal(
          operation.response.recordRequiredFields[
              operation.response.identityField
          ].type,
          "string",
      );
    }
    assert.equal(Object.isFrozen(operation), true);
  }
});

test("renderer placeholders exactly match bound encoded path parameters", () => {
  for (const operation of Object.values(PROVIDER_OPERATION_REGISTRY)) {
    const placeholders = [
      ...operation.pathTemplate.matchAll(/\{([A-Za-z][A-Za-z0-9]*)\}/g),
    ].map((match) => match[1]).sort();
    assert.deepEqual(placeholders,
        Object.keys(operation.pathParams.properties).sort());
    assert.doesNotMatch(operation.pathTemplate, /\{(?:name|parent|resource)=/);
    for (const [name, schema] of
      Object.entries(operation.pathParams.properties)) {
      assert.match(schema.binding, /^(?:approved_|discovered_|target_)/,
          `${operation.operationId}.${name}`);
      assert.equal([
        "iam_attachment_point",
        "path_segment",
        "resource_name",
        "storage_object",
      ].includes(schema.encoding), true, `${operation.operationId}.${name}`);
    }
  }

  const mismatch = clonedRegistry();
  const operationId =
    "cloudfunctions.v2.projects.locations.functions.get";
  mismatch[operationId].pathTemplate += "/{foreignId}";
  deepFreeze(mismatch);
  assert.throws(() => assertProviderOperationRegistry(mismatch),
      /template\/parameter mismatch/);

  const unbound = clonedRegistry();
  delete unbound[operationId].pathParams.properties.functionId.binding;
  deepFreeze(unbound);
  assert.throws(() => assertProviderOperationRegistry(unbound),
      /binding\/encoding mismatch/);
});

test("target identity, region, and discovered lineage reject caller substitution",
    () => {
      const listOperation =
        "cloudfunctions.v2.projects.locations.functions.list";
      assert.doesNotThrow(() => assertProviderPathParameters(listOperation, {
        projectId: PROVIDER_TARGET_PROJECT_ID,
        location: PROVIDER_APPROVED_LOCATION,
      }));
      for (const parameters of [
        {projectId: "foreign-project", location: PROVIDER_APPROVED_LOCATION},
        {projectId: PROVIDER_TARGET_PROJECT_ID, location: "europe-west1"},
      ]) {
        assert.throws(
            () => assertProviderPathParameters(listOperation, parameters),
            /Invalid provider path parameter/,
        );
      }
      assert.throws(() => assertProviderPathParameters(
          "cloudasset.v1.projects.analyzeIamPolicy",
          {projectNumber: "999999999999"},
      ), /Invalid provider path parameter/);

      const folderOperation = "cloudresourcemanager.v3.folders.get";
      assert.throws(
          () => assertProviderPathParameters(folderOperation, {
            folderId: "123456789",
          }),
          /lacks discovered_parent_lineage lineage/,
      );
      assert.doesNotThrow(() => assertProviderPathParameters(
          folderOperation,
          {folderId: "123456789"},
          {
            lineageBindings: {
              discovered_parent_lineage: ["123456789"],
            },
          },
      ));
      assert.throws(() => assertProviderPathParameters(
          folderOperation,
          {folderId: "987654321"},
          {
            lineageBindings: {
              discovered_parent_lineage: ["123456789"],
            },
          },
      ), /lacks discovered_parent_lineage lineage/);

      const foreignSchema = clonedRegistry();
      foreignSchema[listOperation].pathParams.properties.projectId.const =
        "foreign-project";
      deepFreeze(foreignSchema);
      assert.throws(() => assertProviderOperationRegistry(foreignSchema),
          /foreign projectId schema/);
    });

test("storage, IAM attachment, and service-account path values fail closed",
    () => {
      const storageOperation = "storage.v1.objects.getMetadata";
      const acceptedStorage = {
        bucket: "approved-source-bucket",
        object: "functions/source/archive.zip",
      };
      const storageLineage = {
        approved_storage_source_bucket: [acceptedStorage.bucket],
        approved_storage_source_object: [acceptedStorage.object],
      };
      assert.doesNotThrow(() => assertProviderPathParameters(
          storageOperation,
          acceptedStorage,
          {lineageBindings: storageLineage},
      ));
      for (const object of [
        "../secret", "dir/../secret", "dir//file", "dir/file/",
        "dir%2Ffile", "dir?alt=media", "dir#fragment", "dir/\u0000file",
      ]) {
        assert.throws(() => assertProviderPathParameters(
            storageOperation,
            {bucket: acceptedStorage.bucket, object},
            {
              lineageBindings: {
                ...storageLineage,
                approved_storage_source_object: [object],
              },
            },
        ), /Invalid provider path parameter/);
      }

      const denyOperation = "iam.v2.policies.denypolicies.list";
      const rawAttachment =
        "cloudresourcemanager.googleapis.com/projects/" +
        PROVIDER_TARGET_PROJECT_ID;
      assert.doesNotThrow(() => assertProviderPathParameters(
          denyOperation,
          {attachmentPoint: rawAttachment},
          {
            lineageBindings: {
              discovered_parent_lineage: [rawAttachment],
            },
          },
      ));
      for (const attachmentPoint of [
        "cloudresourcemanager.googleapis.com%2Fprojects%2F" +
          PROVIDER_TARGET_PROJECT_ID,
        "cloudresourcemanager.googleapis.com/projects/foreign-project",
      ]) {
        assert.throws(() => assertProviderPathParameters(
            denyOperation,
            {attachmentPoint},
            {
              lineageBindings: {
                discovered_parent_lineage: [attachmentPoint],
              },
            },
        ), /Invalid provider path parameter/);
      }

      const serviceAccountOperation =
        "iam.v1.projects.serviceAccounts.get";
      for (const serviceAccount of [
        "firebase-adminsdk-ab123@daegu-miami-production.iam.gserviceaccount.com",
        "884850632328-compute@developer.gserviceaccount.com",
      ]) {
        assert.doesNotThrow(() => assertProviderPathParameters(
            serviceAccountOperation,
            {
              projectId: PROVIDER_TARGET_PROJECT_ID,
              serviceAccount,
            },
            {
              lineageBindings: {
                approved_service_account_email: [serviceAccount],
              },
            },
        ));
      }
      for (const serviceAccount of [
        "runtime@foreign-project.iam.gserviceaccount.com",
        "999999999999-compute@developer.gserviceaccount.com",
      ]) {
        assert.throws(() => assertProviderPathParameters(
            serviceAccountOperation,
            {
              projectId: PROVIDER_TARGET_PROJECT_ID,
              serviceAccount,
            },
            {
              lineageBindings: {
                approved_service_account_email: [serviceAccount],
              },
            },
        ), /Invalid provider path parameter/);
      }
    });

test("Cloud Asset specialization pins official transcoding and repeat keys",
    () => {
      const operation =
        PROVIDER_OPERATION_REGISTRY[
            "cloudasset.v1.projects.analyzeIamPolicy"
        ];
      assert.equal(operation.pathTemplate,
          "/v1/projects/{projectNumber}:analyzeIamPolicy");
      assert.equal(operation.officialTranscodingTemplate,
          "/v1/{analysisQuery.scope=*/*}:analyzeIamPolicy");
      assert.equal(
          operation.pathParams.properties.projectNumber.const,
          PROVIDER_TARGET_PROJECT_NUMBER,
      );
      const permissions =
        operation.query.properties[
            "analysisQuery.accessSelector.permissions"
        ];
      assert.equal(permissions.serialization, "repeat_key");
      assert.equal(permissions.binding, "approved_permission_set");
      for (const key of [
        "options.expandGroups",
        "options.expandResources",
        "options.expandRoles",
        "options.outputGroupEdges",
        "options.outputResourceEdges",
      ]) assert.ok(Object.hasOwn(operation.query.properties, key));
      assert.equal(
          Object.keys(operation.query.properties)
              .some((key) => key.startsWith("analysisQuery.options.")),
          false,
      );

      const serializationMutation = clonedRegistry();
      serializationMutation[operation.operationId].query.properties[
          "analysisQuery.accessSelector.permissions"
      ].serialization = "comma_join";
      deepFreeze(serializationMutation);
      assert.throws(
          () => assertProviderOperationRegistry(serializationMutation),
          /array serialization mismatch/,
      );
    });

test("Policy Troubleshooter body requires exact own-key approval lineage",
    () => {
      const operationId = "policytroubleshooter.v3.iam.troubleshoot";
      const operation = PROVIDER_OPERATION_REGISTRY[operationId];
      const tuple =
        operation.requestBody.schema.properties.accessTuple;
      assert.deepEqual(Object.keys(tuple.properties).sort(), [
        "fullResourceName", "permission", "principal",
      ]);
      assert.deepEqual(
          Object.fromEntries(Object.entries(tuple.properties)
              .map(([key, schema]) => [key, schema.binding])),
          {
            fullResourceName: "approved_or_discovered_target_resource",
            permission: "approved_reviewed_permission",
            principal: "approved_iam_principal_or_group",
          },
      );

      const approvedBody = {
        accessTuple: {
          fullResourceName:
            "//cloudresourcemanager.googleapis.com/projects/" +
            PROVIDER_TARGET_PROJECT_ID,
          permission: "datastore.entities.get",
          principal:
            "serviceAccount:884850632328-compute@" +
            "developer.gserviceaccount.com",
        },
      };
      const lineageBindings = {
        approved_or_discovered_target_resource: [
          approvedBody.accessTuple.fullResourceName,
        ],
        approved_reviewed_permission: [
          approvedBody.accessTuple.permission,
        ],
        approved_iam_principal_or_group: [
          approvedBody.accessTuple.principal,
        ],
      };
      assert.doesNotThrow(() => assertProviderRequestBody(
          operationId,
          approvedBody,
          {lineageBindings},
      ));

      for (const body of [
        {accessTuple: {
          permission: approvedBody.accessTuple.permission,
          principal: approvedBody.accessTuple.principal,
        }},
        {accessTuple: {
          ...approvedBody.accessTuple,
          callerUrl: "https://foreign.invalid",
        }},
      ]) {
        assert.throws(() => assertProviderRequestBody(
            operationId,
            body,
            {lineageBindings},
        ), /exact keyset mismatch/);
      }

      const inheritedTuple = Object.assign(
          Object.create({principal: approvedBody.accessTuple.principal}),
          {
            fullResourceName: approvedBody.accessTuple.fullResourceName,
            permission: approvedBody.accessTuple.permission,
          },
      );
      assert.throws(() => assertProviderRequestBody(
          operationId,
          {accessTuple: inheritedTuple},
          {lineageBindings},
      ), /own-key-only object/);

      assert.throws(() => assertProviderRequestBody(
          operationId,
          approvedBody,
      ), /lacks approved_or_discovered_target_resource lineage/);
      assert.throws(() => assertProviderRequestBody(
          operationId,
          approvedBody,
          {
            lineageBindings: {
              wrong_resource_binding: [
                approvedBody.accessTuple.fullResourceName,
              ],
              approved_reviewed_permission: [
                approvedBody.accessTuple.permission,
              ],
              approved_iam_principal_or_group: [
                approvedBody.accessTuple.principal,
              ],
            },
          },
      ), /lacks approved_or_discovered_target_resource lineage/);

      const inheritedLineage = Object.create({
        approved_or_discovered_target_resource: [
          approvedBody.accessTuple.fullResourceName,
        ],
      });
      inheritedLineage.approved_reviewed_permission = [
        approvedBody.accessTuple.permission,
      ];
      inheritedLineage.approved_iam_principal_or_group = [
        approvedBody.accessTuple.principal,
      ];
      assert.throws(() => assertProviderRequestBody(
          operationId,
          approvedBody,
          {lineageBindings: inheritedLineage},
      ), /lacks approved_or_discovered_target_resource lineage/);

      for (const [field, foreignValue] of [
        [
          "fullResourceName",
          "//cloudresourcemanager.googleapis.com/projects/foreign-project",
        ],
        ["principal", "user:foreign@example.invalid"],
        ["permission", "resourcemanager.projects.delete"],
      ]) {
        const body = structuredClone(approvedBody);
        body.accessTuple[field] = foreignValue;
        assert.throws(() => assertProviderRequestBody(
            operationId,
            body,
            {lineageBindings},
        ), /lacks .* lineage/,
      );
      }
    });

test("semantic POST schema rejects missing, wrong, and inherited bindings",
    () => {
      const operationId = "policytroubleshooter.v3.iam.troubleshoot";
      const missing = clonedRegistry();
      delete missing[operationId].requestBody.schema.properties.accessTuple
          .properties.fullResourceName.binding;
      deepFreeze(missing);
      assert.throws(() => assertProviderOperationRegistry(missing),
          /scalar binding\/schema is not approved/);

      const wrong = clonedRegistry();
      wrong[operationId].requestBody.schema.properties.accessTuple
          .properties.principal.binding = "caller_arbitrary";
      deepFreeze(wrong);
      assert.throws(() => assertProviderOperationRegistry(wrong),
          /scalar binding\/schema is not approved/);

      const inherited = clonedRegistry();
      const tupleProperties = inherited[operationId].requestBody.schema
          .properties.accessTuple.properties;
      const permission = tupleProperties.permission;
      delete permission.binding;
      tupleProperties.permission = Object.assign(
          Object.create({binding: "approved_reviewed_permission"}),
          permission,
      );
      deepFreeze(inherited);
      assert.throws(() => assertProviderOperationRegistry(inherited),
          /unapproved prototype/);
    });

test("version and descriptor-set digest are deterministic literal invariants",
    () => {
      assert.equal(PROVIDER_OPERATION_ALLOWLIST_VERSION,
          "academy_reset_freeze_provider_operations.v4");
      assert.equal(PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
          "2bc2dd2e27252549c3aa7382790ed4e49dc1752a7162bca36b7f0601a7b947e9");
      assert.equal(PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
          EXPECTED_PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST);
      assert.equal(computeProviderOperationDescriptorSetDigest(),
          PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST);
      assert.equal(PROVIDER_TRANSPORT,
          "google_auth_library_native_fetch_v1");
      assert.equal(PROVIDER_AUTH_DEPENDENCY, "google-auth-library@10.6.2");
      assert.equal(PROVIDER_HTTP_RUNTIME, "node24_native_fetch");
      assert.equal(PROVIDER_ADAPTER_CONTRACT_VERSION,
          "academy_reset_freeze_provider_adapter.v4");
      assert.equal(PROVIDER_NO_MUTATION_OPERATION_COUNT, 0);
    });

test("registry has no mutation verbs and only approved semantic POSTs", () => {
  const operations = Object.values(PROVIDER_OPERATION_REGISTRY);
  assert.equal(operations.some(({method}) =>
    ["PUT", "PATCH", "DELETE"].includes(method)), false);
  assert.deepEqual(
      operations.filter(({method}) => method === "POST")
          .map(({operationId}) => operationId),
      [
        "cloudresourcemanager.v3.folders.getIamPolicy",
        "cloudresourcemanager.v3.organizations.getIamPolicy",
        "cloudresourcemanager.v3.projects.getIamPolicy",
        "iam.v1.projects.serviceAccounts.getIamPolicy",
        "policytroubleshooter.v3.iam.troubleshoot",
      ],
  );
  for (const operation of operations) {
    assert.equal(
        operation.requestBody.mode,
        operation.method === "GET" ? "forbidden" : "required",
    );
  }
});

test("unknown, inherited, and structurally exotic operation maps fail closed",
    () => {
      assert.throws(
          () => getProviderOperationDescriptor("__proto__"),
          /Unknown provider operation ID/,
      );
      assert.throws(
          () => getProviderOperationDescriptor("toString"),
          /Unknown provider operation ID/,
      );

      const inherited = Object.create(PROVIDER_OPERATION_REGISTRY);
      inherited["unapproved.inherited.get"] = PROVIDER_OPERATION_REGISTRY[
          PROVIDER_OPERATION_IDS[0]
      ];
      deepFreeze(inherited);
      assert.throws(() => assertProviderOperationRegistry(inherited),
          /unapproved prototype/);

      const nonEnumerable = clonedRegistry();
      Object.defineProperty(nonEnumerable, "hidden", {
        value: true,
        enumerable: false,
      });
      deepFreeze(nonEnumerable);
      assert.throws(() => assertProviderOperationRegistry(nonEnumerable),
          /not an enumerable data property/);

      const symbolic = clonedRegistry();
      symbolic[Symbol("hidden")] = true;
      deepFreeze(symbolic);
      assert.throws(() => assertProviderOperationRegistry(symbolic),
          /symbol key/);

      const descriptorNonEnumerable = clonedRegistry();
      const firstId = PROVIDER_OPERATION_IDS[0];
      Object.defineProperty(descriptorNonEnumerable[firstId], "hidden", {
        value: true,
        enumerable: false,
      });
      deepFreeze(descriptorNonEnumerable);
      assert.throws(
          () => assertProviderOperationRegistry(descriptorNonEnumerable),
          /not an enumerable data property/,
      );

      const descriptorSymbol = clonedRegistry();
      descriptorSymbol[firstId][Symbol("hidden")] = true;
      deepFreeze(descriptorSymbol);
      assert.throws(() => assertProviderOperationRegistry(descriptorSymbol),
          /symbol key/);
    });

test("add, remove, and descriptor mutation violate registry invariants", () => {
  const added = clonedRegistry();
  added["unapproved.v1.resources.get"] =
    structuredClone(added[PROVIDER_OPERATION_IDS[0]]);
  deepFreeze(added);
  assert.throws(() => assertProviderOperationRegistry(added),
      /exact keyset mismatch/);

  const removed = clonedRegistry();
  delete removed[PROVIDER_OPERATION_IDS[0]];
  deepFreeze(removed);
  assert.throws(() => assertProviderOperationRegistry(removed),
      /exact keyset mismatch/);

  const mutated = clonedRegistry();
  mutated[PROVIDER_OPERATION_IDS[0]].maxResponseBytes += 1;
  deepFreeze(mutated);
  assert.notEqual(
      computeProviderOperationDescriptorSetDigest(mutated),
      PROVIDER_OPERATION_DESCRIPTOR_SET_DIGEST,
  );
  assert.throws(() => assertProviderOperationRegistry(mutated),
      /descriptor-set digest mismatch/);

  const customDescriptorPrototype = clonedRegistry();
  const operationId = PROVIDER_OPERATION_IDS[0];
  customDescriptorPrototype[operationId] = Object.assign(
      Object.create({inherited: true}),
      customDescriptorPrototype[operationId],
  );
  deepFreeze(customDescriptorPrototype);
  assert.throws(
      () => assertProviderOperationRegistry(customDescriptorPrototype),
      /unapproved prototype/,
  );
});

test("Stage A registry stays transport-free while Stage B is isolated",
    () => {
      const packageChanges = execFileSync("git", [
        "diff", "--name-only", BASE_SHA, "--",
        ":(glob)**/package.json", ":(glob)**/package-lock.json",
      ], {cwd: repositoryRoot, encoding: "utf8"})
          .trim().split("\n").filter(Boolean);
      assert.deepEqual(packageChanges, [
        "functions/package-lock.json",
        "functions/package.json",
      ]);
      const scriptsDirectory =
        path.join(repositoryRoot, "functions", "scripts");
      const implementationNames = fs.readdirSync(scriptsDirectory)
          .filter((name) =>
            /(?:provider-adapter|provider-transport)/i.test(name));
      assert.deepEqual(implementationNames,
        [
          "academy-reset-freeze-provider-adapter.mjs",
          "academy-reset-freeze-provider-transport.mjs",
        ]);
      const registrySource = fs.readFileSync(path.join(
          scriptsDirectory,
          "academy-reset-freeze-provider-operations.mjs",
      ), "utf8");
      assert.doesNotMatch(registrySource, /\bfetch\s*\(/);
      assert.doesNotMatch(registrySource, /from\s+["']google-auth-library["']/);
      assert.doesNotMatch(registrySource, /\bAuthorization\s*:/);
      const transportSource = fs.readFileSync(path.join(
          scriptsDirectory,
          "academy-reset-freeze-provider-transport.mjs",
      ), "utf8");
      assert.match(transportSource,
          /import \{GoogleAuth\} from "google-auth-library";/);
      assert.doesNotMatch(transportSource,
          /from\s+["']googleapis(?:\/[^"']*)?["']/);
      const runbook = fs.readFileSync(path.join(
          repositoryRoot,
          "docs",
          "academy-reset-write-freeze-runbook.md",
      ), "utf8");
      assert.match(runbook, /academy_reset_provider_observation\.v3/);
      assert.match(runbook, /academy_reset_freeze_provider_operations\.v4/);
      assert.match(runbook,
          /2bc2dd2e27252549c3aa7382790ed4e49dc1752a7162bca36b7f0601a7b947e9/);
      assert.match(runbook, /exact 29 operations/);
      assert.match(runbook, /declared_google_auth_library_rest/);
      assert.match(runbook, /Stage A/);
      assert.doesNotMatch(runbook, /reviewed_direct_googleapis/);
    });
