import assert from "node:assert/strict";
import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import * as providerTransport
  from "../functions/scripts/academy-reset-freeze-provider-transport.mjs";
import {
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_TARGET_PROJECT_ID,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";
import {
  PROVIDER_ADAPTER_METADATA,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS,
  computeProviderAdapterReviewedSourceIdentityDigest,
} from "../functions/scripts/academy-reset-write-freeze-contract.mjs";
import {
  GOOGLE_PROVIDER_READ_ONLY_SCOPE,
  MOCK_TRANSPORT_SESSION_VERSION,
  ProviderTransportError,
  assertStableProviderInventory,
  compareProviderInventoryScans,
  computeMockTransportLineageDigest,
  createMockProviderTransportExecutor,
} from "../functions/scripts/academy-reset-freeze-provider-transport.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const listOperation =
  "cloudfunctions.v2.projects.locations.functions.list";
const listPath = {
  projectId: PROVIDER_TARGET_PROJECT_ID,
  location: "us-central1",
};
const fakeSignal = new AbortController().signal;

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function mockReceipt(lineageBindings = {}) {
  const receipt = {
    schemaVersion: MOCK_TRANSPORT_SESSION_VERSION,
    mockOnly: true,
    targetProjectId: "daegu-miami-production",
    targetProjectNumber: "884850632328",
    approvedLocation: "us-central1",
    lineageBindings,
    lineageDigest: "",
  };
  receipt.lineageDigest = computeMockTransportLineageDigest(receipt);
  return deepFreeze(receipt);
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

function jsonResponse(requestUrl, value, status = 200, headers = {}) {
  return responseAtUrl(
      new Response(JSON.stringify(value), {status, headers}),
      requestUrl,
  );
}

function mockHarness(overrides = {}) {
  let clock = 1000;
  let sequence = 0;
  const counters = {
    auth: 0,
    fetch: 0,
    mutation: 0,
    sleep: [],
    timeouts: [],
  };
  const fetchImpl = overrides.fetchImpl ?? (async (url) =>
    jsonResponse(url, {functions: []}));
  const executor = createMockProviderTransportExecutor({
    receipt: overrides.receipt ?? mockReceipt(),
    ...(overrides.sessionReceipt === undefined ?
      {} :
      {sessionReceipt: overrides.sessionReceipt}),
    authHeaderProvider: overrides.authHeaderProvider ?? (async () => {
      counters.auth += 1;
      return {Authorization: "Bearer unit-token"};
    }),
    fetchImpl: async (url, options) => {
      counters.fetch += 1;
      if (["PUT", "PATCH", "DELETE"].includes(options.method)) {
        counters.mutation += 1;
      }
      return fetchImpl(url, options);
    },
    now: overrides.now ?? (() => clock++),
    randomId: overrides.randomId ?? (() => `mock-execution-${++sequence}`),
    sleep: overrides.sleep ?? (async (milliseconds) => {
      counters.sleep.push(milliseconds);
    }),
    timeoutSignalProvider:
      overrides.timeoutSignalProvider ?? ((milliseconds) => {
        counters.timeouts.push(milliseconds);
        return fakeSignal;
      }),
  });
  return {executor, counters};
}

function listInput(overrides = {}) {
  return {
    operationId: listOperation,
    pathParams: listPath,
    ...overrides,
  };
}

async function rejectsCode(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ProviderTransportError, true);
    assert.equal(error.code, code);
    return true;
  });
}

test("public transport exports are an exact mock-only allowlist", () => {
  assert.deepEqual(Object.keys(providerTransport), [
    "GOOGLE_PROVIDER_READ_ONLY_SCOPE",
    "MOCK_TRANSPORT_SESSION_VERSION",
    "PROVIDER_TRANSPORT_MAX_PAGES",
    "PROVIDER_TRANSPORT_MAX_RECORDS",
    "ProviderTransportError",
    "assertMockProviderTransportExecutor",
    "assertStableProviderInventory",
    "compareProviderInventoryScans",
    "computeMockTransportLineageDigest",
    "createMockProviderTransportExecutor",
  ]);
  assert.equal(GOOGLE_PROVIDER_READ_ONLY_SCOPE,
      "https://www.googleapis.com/auth/cloud-platform.read-only");
  assert.equal(providerTransport.createProviderTransportExecutor, undefined);
  assert.equal(providerTransport.createGoogleAuthHeaderProvider, undefined);
});

test("mock executor requires an immutable canonical Production receipt", () => {
  const receipt = mockReceipt({approved_function_id: ["approvedFunction"]});
  const {executor, counters} = mockHarness({receipt});
  assert.deepEqual(executor.metadata, {
    mockOnly: true,
    lineageMode: "validated_mock_receipt",
  });
  assert.equal(counters.auth, 0);
  assert.equal(counters.fetch, 0);
  for (const invalid of [
    {...receipt, targetProjectId: "foreign-project"},
    {...receipt, approvedLocation: "europe-west1"},
    {...receipt, lineageDigest: "0".repeat(64)},
    structuredClone(receipt),
  ]) {
    assert.throws(() => mockHarness({receipt: invalid}));
  }
});

test("execution input exposes no lineage or runtime dependency injection",
    async () => {
      const forbidden = [
        {bindingContext: {lineageBindings: {}}},
        {fetchImpl: async (url) => jsonResponse(url, {functions: []})},
        {authHeaderProvider: async () => ({Authorization: "Bearer forged"})},
        {now: () => 1},
        {sleep: async () => {}},
        {timeoutSignalProvider: () => fakeSignal},
        {method: "DELETE"},
        {host: "https://cloudfunctions.googleapis.com.evil.invalid"},
      ];
      for (const extra of forbidden) {
        const {executor, counters} = mockHarness();
        await assert.rejects(executor(listInput(extra)));
        assert.deepEqual(counters, {
          auth: 0,
          fetch: 0,
          mutation: 0,
          sleep: [],
          timeouts: [],
        });
      }
    });

test("GET URL and transport semantics come only from the descriptor",
    async () => {
      const {executor, counters} = mockHarness({
        fetchImpl: async (url, options) => {
          assert.equal(url.origin, "https://cloudfunctions.googleapis.com");
          assert.equal(url.pathname,
              "/v2/projects/daegu-miami-production/locations/us-central1/functions");
          assert.equal(url.searchParams.get("pageSize"), "25");
          assert.equal(options.method, "GET");
          assert.equal(options.redirect, "error");
          assert.equal(options.body, undefined);
          return jsonResponse(url, {functions: [{name: "functions/a"}]});
        },
      });
      const result = await executor(listInput({query: {pageSize: 25}}));
      assert.equal(result.paginationComplete, true);
      assert.equal(Object.hasOwn(result, "complete"), false);
      assert.equal(result.mockOnly, true);
      assert.equal(result.recordCount, 1);
      assert.equal(counters.auth, 1);
      assert.equal(counters.fetch, 1);
      assert.equal(counters.mutation, 0);
      assert.deepEqual(counters.timeouts, [10000]);
    });

test("query descriptors cannot narrow complete inventory scans", () => {
  for (const operation of Object.values(PROVIDER_OPERATION_REGISTRY)) {
    const keys = Object.keys(operation.query.properties);
    for (const forbidden of [
      "filter",
      "orderBy",
      "showDeleted",
      "view",
    ]) {
      assert.equal(keys.includes(forbidden), false,
          `${operation.operationId}.${forbidden}`);
    }
  }
  const cloudAsset = PROVIDER_OPERATION_REGISTRY[
      "cloudasset.v1.projects.analyzeIamPolicy"
  ];
  assert.equal(cloudAsset.query.properties.executionTimeout.const, "90s");
  for (const key of [
    "options.expandGroups",
    "options.expandResources",
    "options.expandRoles",
    "options.outputGroupEdges",
    "options.outputResourceEdges",
  ]) {
    assert.equal(cloudAsset.query.properties[key].const, true);
    assert.equal(cloudAsset.query.required.includes(key), true);
  }
});

test("Cloud Asset constants and repeat query encoding are exact", async () => {
  const permission = "datastore.entities.get";
  const principal =
    "serviceAccount:884850632328-compute@developer.gserviceaccount.com";
  const resource =
    "//cloudresourcemanager.googleapis.com/projects/daegu-miami-production";
  const receipt = mockReceipt({
    approved_permission_set: [permission],
    approved_permission: [permission],
    approved_principal: [principal],
    approved_resource_name: [resource],
  });
  const query = {
    "analysisQuery.accessSelector.permissions": [permission],
    "analysisQuery.identitySelector.identity": principal,
    "analysisQuery.resourceSelector.fullResourceName": resource,
    executionTimeout: "90s",
    "options.expandGroups": true,
    "options.expandResources": true,
    "options.expandRoles": true,
    "options.outputGroupEdges": true,
    "options.outputResourceEdges": true,
  };
  const {executor} = mockHarness({
    receipt,
    fetchImpl: async (url) => {
      assert.deepEqual(
          url.searchParams.getAll(
              "analysisQuery.accessSelector.permissions",
          ),
          [permission],
      );
      assert.equal(url.searchParams.get("executionTimeout"), "90s");
      return jsonResponse(url, {
        fullyExplored: true,
        mainAnalysis: {},
        nonCriticalErrors: [],
      });
    },
  });
  await executor({
    operationId: "cloudasset.v1.projects.analyzeIamPolicy",
    pathParams: {projectNumber: "884850632328"},
    query,
  });
  for (const change of [
    {executionTimeout: "10s"},
    {"options.expandGroups": false},
  ]) {
    await assert.rejects(executor({
      operationId: "cloudasset.v1.projects.analyzeIamPolicy",
      pathParams: {projectNumber: "884850632328"},
      query: {...query, ...change},
    }));
  }
  const narrowed = mockHarness({
    receipt: mockReceipt({
      approved_permission_set: [permission, "datastore.entities.list"],
      approved_permission: [permission, "datastore.entities.list"],
      approved_principal: [principal],
      approved_resource_name: [resource],
    }),
  });
  await rejectsCode(narrowed.executor({
    operationId: "cloudasset.v1.projects.analyzeIamPolicy",
    pathParams: {projectNumber: "884850632328"},
    query,
  }), "QUERY_analysisQuery.accessSelector.permissions_SET_LINEAGE_REJECTED");
  assert.equal(narrowed.counters.fetch, 0);
});

test("Cloud Build path uses an exact UUID grammar", async () => {
  const operation =
    PROVIDER_OPERATION_REGISTRY[
        "cloudbuild.v1.projects.locations.builds.get"
    ];
  const pattern =
    new RegExp(operation.pathParams.properties.buildId.pattern);
  const valid = "12345678-1234-abcd-ABCD-1234567890ab";
  assert.equal(pattern.test(valid), true);
  for (const invalid of [
    "------------------------------------",
    "123456781234-abcd-ABCD-1234567890ab",
    "12345678-1234-abcd-ABCD-1234567890a-",
  ]) assert.equal(pattern.test(invalid), false);

  const {executor, counters} = mockHarness({
    receipt: mockReceipt({approved_build_id: ["------------------------------------"]}),
  });
  await assert.rejects(executor({
    operationId: operation.operationId,
    pathParams: {
      ...listPath,
      buildId: "------------------------------------",
    },
  }));
  assert.equal(counters.fetch, 0);
});

test("unknown operation errors never echo caller input", async () => {
  const secretId = "unknown.Bearer-secret?credential=value";
  const {executor, counters} = mockHarness();
  try {
    await executor(listInput({operationId: secretId}));
    assert.fail("expected rejection");
  } catch (error) {
    assert.equal(error.code, "UNKNOWN_OPERATION_ID");
    assert.doesNotMatch(String(error), /Bearer-secret|credential/);
  }
  assert.equal(counters.auth, 0);
  assert.equal(counters.fetch, 0);
});

test("opaque session rejects dynamic path values absent from its receipt",
    async () => {
      const {executor, counters} = mockHarness();
      await rejectsCode(executor({
        operationId: "cloudfunctions.v2.projects.locations.functions.get",
        pathParams: {...listPath, functionId: "callerFunction"},
      }), "PATH_PARAMETERS_REJECTED");
      assert.equal(counters.auth, 0);
      assert.equal(counters.fetch, 0);
    });

test("adapter mock session derives function lineage from validated list response",
    async () => {
      const sessionReceipt = deepFreeze({
        projectId: "daegu-miami-production",
        projectNumber: "884850632328",
        iamPrincipalAllowlist: [],
      });
      let calls = 0;
      const {executor} = mockHarness({
        receipt: mockReceipt(),
        sessionReceipt,
        fetchImpl: async (url) => {
          calls += 1;
          if (calls === 1) {
            return jsonResponse(url, {functions: [{
              name: "projects/daegu-miami-production/locations/us-central1/" +
                "functions/derivedFunction",
            }]});
          }
          assert.match(url.pathname, /\/functions\/derivedFunction$/);
          return jsonResponse(url, {
            name: "projects/daegu-miami-production/locations/us-central1/" +
              "functions/derivedFunction",
          });
        },
      });
      assert.deepEqual(executor.metadata.sessionReceipt, sessionReceipt);
      await executor(listInput());
      await executor({
        operationId: "cloudfunctions.v2.projects.locations.functions.get",
        pathParams: {...listPath, functionId: "derivedFunction"},
      });
      assert.equal(calls, 2);
    });

test("path encoding remains exact for validated storage lineage", async () => {
  const object = "functions/source/archive.zip";
  const receipt = mockReceipt({
    approved_storage_source_bucket: ["approved-source-bucket"],
    approved_storage_source_object: [object],
    approved_storage_source_generation: ["123"],
  });
  const {executor} = mockHarness({
    receipt,
    fetchImpl: async (url) => {
      assert.match(url.pathname,
          /\/o\/functions%2Fsource%2Farchive\.zip$/);
      assert.doesNotMatch(url.pathname, /%252F/i);
      return jsonResponse(url, {
        name: object,
        bucket: "approved-source-bucket",
        generation: "123",
        md5Hash: "VaVACK0bpYmqIQ0mKcHfQQ==",
        size: "1",
      });
    },
  });
  await executor({
    operationId: "storage.v1.objects.getMetadata",
    pathParams: {bucket: "approved-source-bucket", object},
    query: {generation: "123"},
  });
});

test("bucket ownership request is exact noAcl read-only metadata", async () => {
  const bucket = "gcf-v2-sources-884850632328-us-central1";
  const {executor, counters} = mockHarness({
    receipt: mockReceipt({
      approved_storage_source_bucket: [bucket],
    }),
    fetchImpl: async (url, options) => {
      assert.equal(url.pathname, `/storage/v1/b/${bucket}`);
      assert.equal(url.searchParams.get("projection"), "noAcl");
      assert.equal(options.method, "GET");
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, "error");
      return jsonResponse(url, {
        name: bucket,
        projectNumber: "884850632328",
        location: "US-CENTRAL1",
        storageClass: "STANDARD",
      });
    },
  });
  const result = await executor({
    operationId: "storage.v1.buckets.get",
    pathParams: {bucket},
    query: {projection: "noAcl"},
  });
  assert.equal(result.response.projectNumber, "884850632328");
  assert.equal(counters.mutation, 0);
});

test("semantic POST is receipt-bound and never becomes a mutation", async () => {
  const body = {accessTuple: {
    fullResourceName:
      "//cloudresourcemanager.googleapis.com/projects/" +
      PROVIDER_TARGET_PROJECT_ID,
    permission: "datastore.entities.get",
    principal:
      "serviceAccount:884850632328-compute@developer.gserviceaccount.com",
  }};
  const receipt = mockReceipt({
    approved_or_discovered_target_resource: [body.accessTuple.fullResourceName],
    approved_reviewed_permission: [body.accessTuple.permission],
    approved_iam_principal_or_group: [body.accessTuple.principal],
  });
  const {executor, counters} = mockHarness({
    receipt,
    fetchImpl: async (url, options) => {
      assert.equal(url.href,
          "https://policytroubleshooter.googleapis.com/v3/iam:troubleshoot");
      assert.equal(options.method, "POST");
      assert.deepEqual(JSON.parse(options.body), body);
      return jsonResponse(url, {access: "GRANTED"});
    },
  });
  const result = await executor({
    operationId: "policytroubleshooter.v3.iam.troubleshoot",
    pathParams: {},
    body,
  });
  assert.equal(result.paginationComplete, true);
  assert.equal(counters.mutation, 0);
});

test("paginated responses require records and record identity", async () => {
  for (const payload of [
    {},
    {functions: {}},
    {functions: [{}]},
    {functions: [{name: ""}]},
  ]) {
    const {executor} = mockHarness({
      fetchImpl: async (url) => jsonResponse(url, payload),
    });
    await assert.rejects(executor(listInput()));
  }
  const {executor} = mockHarness({
    fetchImpl: async (url) =>
      jsonResponse(url, {functions: [{name: "functions/valid", future: 1}]}),
  });
  assert.equal((await executor(listInput())).recordCount, 1);
});

test("get and semantic-read responses reject empty or malformed identities",
    async () => {
      const functionId = "approvedFunction";
      for (const payload of [{}, {name: 1}, {name: ""}]) {
        const {executor} = mockHarness({
          receipt: mockReceipt({approved_function_id: [functionId]}),
          fetchImpl: async (url) => jsonResponse(url, payload),
        });
        await assert.rejects(executor({
          operationId:
            "cloudfunctions.v2.projects.locations.functions.get",
          pathParams: {...listPath, functionId},
        }));
      }
      const {executor} = mockHarness({
        receipt: mockReceipt({approved_function_id: [functionId]}),
        fetchImpl: async (url) =>
          jsonResponse(
              url,
              {name: `projects/p/locations/l/functions/${functionId}`},
          ),
      });
      assert.equal((await executor({
        operationId: "cloudfunctions.v2.projects.locations.functions.get",
        pathParams: {...listPath, functionId},
      })).paginationComplete, true);
    });

test("metadata, Build, Service Usage, and policy fields are required",
    async () => {
      const cases = [
        [
          "storage.v1.objects.getMetadata",
          {
            bucket: "approved-source-bucket",
            object: "source.zip",
          },
          {generation: "1"},
          {
            approved_storage_source_bucket: ["approved-source-bucket"],
            approved_storage_source_object: ["source.zip"],
            approved_storage_source_generation: ["1"],
          },
        ],
        [
          "cloudbuild.v1.projects.locations.builds.get",
          {
            ...listPath,
            buildId: "12345678-1234-1234-1234-1234567890ab",
          },
          undefined,
          {
            approved_build_id:
              ["12345678-1234-1234-1234-1234567890ab"],
          },
        ],
        [
          "serviceusage.v1.projects.services.get",
          {
            projectNumber: "884850632328",
            serviceName: "cloudfunctions.googleapis.com",
          },
          undefined,
          {
            approved_service_usage_service:
              ["cloudfunctions.googleapis.com"],
          },
        ],
      ];
      for (const [operationId, pathParams, query, lineage] of cases) {
        const {executor} = mockHarness({
          receipt: mockReceipt(lineage),
          fetchImpl: async (url) => jsonResponse(url, {}),
        });
        await rejectsCode(executor({operationId, pathParams, query}),
            "REQUIRED_RESPONSE_FIELD_MISSING");
      }
    });

test("declared partial and unreachable states always fail closed", async () => {
  const partialPayloads = [
    {functions: [], unreachable: ["us-east1"]},
    {functions: [], partialSuccess: true},
    {functions: [], partialSuccess: "false"},
    {functions: [], fullyExplored: false},
    {functions: [], incomplete: true},
  ];
  for (const payload of partialPayloads) {
    const {executor} = mockHarness({
      fetchImpl: async (url) => jsonResponse(url, payload),
    });
    await assert.rejects(executor(listInput()));
  }

  const permission = "datastore.entities.get";
  const principal = "user:approved@example.com";
  const resource =
    "//cloudresourcemanager.googleapis.com/projects/daegu-miami-production";
  const receipt = mockReceipt({
    approved_permission_set: [permission],
    approved_permission: [permission],
    approved_principal: [principal],
    approved_resource_name: [resource],
  });
  const query = {
    "analysisQuery.accessSelector.permissions": [permission],
    "analysisQuery.identitySelector.identity": principal,
    "analysisQuery.resourceSelector.fullResourceName": resource,
    executionTimeout: "90s",
    "options.expandGroups": true,
    "options.expandResources": true,
    "options.expandRoles": true,
    "options.outputGroupEdges": true,
    "options.outputResourceEdges": true,
  };
  for (const payload of [
    {mainAnalysis: {}},
    {mainAnalysis: {}, fullyExplored: false},
    {
      mainAnalysis: {},
      fullyExplored: true,
      nonCriticalErrors: [{code: "PARTIAL"}],
    },
  ]) {
    const {executor} = mockHarness({
      receipt,
      fetchImpl: async (url) => jsonResponse(url, payload),
    });
    await assert.rejects(executor({
      operationId: "cloudasset.v1.projects.analyzeIamPolicy",
      pathParams: {projectNumber: "884850632328"},
      query,
    }));
  }
});

test("partial state is checked before missing or invalid page tokens",
    async () => {
      for (const payload of [
        {functions: [], unreachable: ["region"]},
        {
          functions: [],
          partialSuccess: true,
          nextPageToken: 123,
        },
      ]) {
        const {executor} = mockHarness({
          fetchImpl: async (url) => jsonResponse(url, payload),
        });
        await rejectsCode(
            executor(listInput()),
            "PARTIAL_RESPONSE_REJECTED",
        );
      }
    });

test("final URL must be a non-empty exact request URL", async () => {
  const cases = [
    () => ({url: ""}),
    () => ({}),
    () => ({url: null}),
    () => ({url: "   "}),
    (url) => ({url: url.href.replace(
      "https://cloudfunctions.googleapis.com/",
      "https://cloudfunctions.googleapis.com:443/",
    )}),
    () => ({
      url: "https://cloudfunctions.googleapis.com.evil.invalid/v2/x",
    }),
  ];
  for (const finalUrl of cases) {
    let cancellations = 0;
    const {executor} = mockHarness({
      fetchImpl: async (url) => ({
        status: 200,
        redirected: false,
        ...finalUrl(url),
        headers: new Headers(),
        body: {
          cancel: async () => {
            cancellations += 1;
          },
        },
      }),
    });
    await rejectsCode(executor(listInput()), "PROVIDER_FINAL_URL_REJECTED");
    assert.equal(cancellations, 1);
  }
});

test("redirected true rejects and exact non-redirected URL accepts", async () => {
  let redirectCancellations = 0;
  const redirected = mockHarness({
    fetchImpl: async (url) => ({
      status: 200,
      redirected: true,
      url: url.href,
      headers: new Headers(),
      body: {
        cancel: async () => {
          redirectCancellations += 1;
        },
      },
    }),
  });
  await rejectsCode(
      redirected.executor(listInput()),
      "PROVIDER_REDIRECT_REJECTED",
  );
  assert.equal(redirectCancellations, 1);

  const accepted = mockHarness({
    fetchImpl: async (url) => jsonResponse(url, {functions: []}),
  });
  const result = await accepted.executor(listInput());
  assert.equal(result.mockOnly, true);
  assert.equal(accepted.counters.auth, 1);
  assert.equal(accepted.counters.fetch, 1);
  assert.equal(accepted.counters.mutation, 0);
});

test("retry remains bounded and auth is called once per attempt", async () => {
  let attempts = 0;
  const {executor, counters} = mockHarness({
    fetchImpl: async (url) => {
      attempts += 1;
      return attempts < 4 ?
        jsonResponse(url, {error: "discard"}, 503) :
        jsonResponse(url, {functions: []});
    },
  });
  await executor(listInput());
  assert.equal(attempts, 4);
  assert.equal(counters.auth, 4);
  assert.deepEqual(counters.sleep, [100, 200, 400]);
});

test("redirects, ordinary 4xx, and non-network TypeError do not retry",
    async () => {
      for (const fetchImpl of [
        async (url) => responseAtUrl(new Response(null, {
          status: 302,
          headers: {Location: "https://evil.invalid"},
        }), url),
        async (url) => jsonResponse(url, {error: "private"}, 401),
        async () => {
          throw new TypeError("implementation bug with Bearer secret");
        },
      ]) {
        const {executor, counters} = mockHarness({fetchImpl});
        await assert.rejects(executor(listInput()));
        assert.equal(counters.fetch, 1);
        assert.equal(counters.auth, 1);
      }
    });

test("response body, auth, and query details never enter errors", async () => {
  const token = "Bearer highly-sensitive-token";
  const cases = [
    {
      authHeaderProvider: async () => {
        throw new Error(`${token} auth failure`);
      },
    },
    {
      fetchImpl: async (url) =>
        jsonResponse(url, {error: `${token}?secret=query`}, 400),
    },
    {
      fetchImpl: async (url) =>
        responseAtUrl(
            new Response(`${token}?secret=query`, {status: 200}),
            url,
        ),
    },
  ];
  for (const overrides of cases) {
    const {executor} = mockHarness(overrides);
    try {
      await executor(listInput());
      assert.fail("expected rejection");
    } catch (error) {
      assert.doesNotMatch(String(error), /highly-sensitive|secret=query/);
      assert.doesNotMatch(error.stack ?? "", /highly-sensitive|secret=query/);
    }
  }
});

test("byte limits, invalid JSON, and malformed streams fail closed", async () => {
  const maximum =
    PROVIDER_OPERATION_REGISTRY[listOperation].maxResponseBytes;
  const responseFactories = [
    (url) => responseAtUrl(new Response("{}", {
      headers: {"Content-Length": String(maximum + 1)},
    }), url),
    (url) => responseAtUrl(
        new Response("{}", {headers: {"Content-Length": "1"}}),
        url,
    ),
    (url) => responseAtUrl(new Response("{"), url),
    (url) => ({
      status: 200,
      redirected: false,
      url: url.href,
      headers: new Headers(),
      body: null,
    }),
  ];
  for (const responseFactory of responseFactories) {
    const {executor} = mockHarness({
      fetchImpl: async (url) => responseFactory(url),
    });
    await assert.rejects(executor(listInput()));
  }
});

test("pagination exhausts internally controlled tokens", async () => {
  const urls = [];
  let calls = 0;
  const {executor} = mockHarness({
    fetchImpl: async (url) => {
      urls.push(url.href);
      calls += 1;
      return calls === 1 ?
        jsonResponse(url, {
          functions: [{name: "a"}],
          nextPageToken: "next",
        }) :
        jsonResponse(url, {functions: [{name: "b"}]});
    },
  });
  const result = await executor(listInput());
  assert.equal(urls[0].includes("pageToken"), false);
  assert.equal(new URL(urls[1]).searchParams.get("pageToken"), "next");
  assert.deepEqual(result.records, [{name: "a"}, {name: "b"}]);
  assert.equal(result.paginationComplete, true);
  assert.equal(Object.hasOwn(result, "complete"), false);
});

test("pagination rejects repeated tokens and incomplete bounds", async () => {
  let calls = 0;
  const repeated = mockHarness({
    fetchImpl: async (url) => {
      calls += 1;
      return jsonResponse(url, {functions: [], nextPageToken: "same"});
    },
  });
  await rejectsCode(repeated.executor(listInput()),
      "PAGINATION_TOKEN_REPEATED");
  assert.equal(calls, 2);

  calls = 0;
  const bounded = mockHarness({
    fetchImpl: async (url) => {
      calls += 1;
      return jsonResponse(url, {
        functions: [],
        nextPageToken: `token-${calls}`,
      });
    },
  });
  await rejectsCode(bounded.executor(listInput()),
      "PAGINATION_INCOMPLETE_AT_LIMIT");
  assert.equal(calls, 100);
});

test("stable inventory comparison requires two independent exhaustive results",
    () => {
      const result = (executionId, records) => ({
        operationId: listOperation,
        paginationComplete: true,
        mockOnly: true,
        transportExecutionId: executionId,
        records,
      });
      const first = result("scan-1", [{name: "a"}, {name: "b"}]);
      const reordered = result("scan-2", [{name: "b"}, {name: "a"}]);
      const swapped = result("scan-3", [{name: "a"}, {name: "c"}]);
      assert.equal(
          assertStableProviderInventory(first, reordered).stable,
          true,
      );
      assert.equal(
          compareProviderInventoryScans(first, swapped).stable,
          false,
      );
      assert.throws(() => compareProviderInventoryScans(first, first),
          /INDEPENDENT_SCAN_PAIR_REJECTED/);
      assert.throws(() => compareProviderInventoryScans(
          {...first, paginationComplete: false},
          reordered,
      ), /EXHAUSTIVE_RESULT_REJECTED/);
    });

test("media result is transport-complete only and contains no auth metadata",
    async () => {
      const object = "approved/rules/source.txt";
      const content = new TextEncoder().encode("rules source bytes");
      const {executor} = mockHarness({
        receipt: mockReceipt({
          approved_storage_source_bucket: ["approved-source-bucket"],
          approved_storage_source_object: [object],
          approved_storage_source_generation: ["42"],
        }),
        fetchImpl: async (url) => responseAtUrl(new Response(content), url),
      });
      const result = await executor({
        operationId: "storage.v1.objects.getMedia",
        pathParams: {bucket: "approved-source-bucket", object},
        query: {alt: "media", generation: "42"},
      });
      assert.equal(result.paginationComplete, true);
      assert.equal(Object.hasOwn(result, "complete"), false);
      assert.equal(result.media.sha256,
          crypto.createHash("sha256").update(content).digest("hex"));
      assert.doesNotMatch(JSON.stringify(result), /unit-token|Authorization/);
    });

test("static transport surface exposes only the mock executor factory",
    () => {
      const facadeSource = fs.readFileSync(path.join(
          repositoryRoot,
          "functions/scripts/academy-reset-freeze-provider-transport.mjs",
      ), "utf8");
      const authoritySource = fs.readFileSync(path.join(
          repositoryRoot,
          "functions/scripts/observe-academy-reset-freeze-production.mjs",
      ), "utf8");
      assert.match(facadeSource,
          /^export \{\n(?:  [A-Za-z0-9_]+,\n)+\} from "\.\/observe-academy-reset-freeze-production\.mjs";\n$/);
      assert.doesNotMatch(facadeSource, /WeakMap|GoogleAuth|function\s+/);
      assert.doesNotMatch(facadeSource,
          /createProviderTransportExecutor|createGoogleAuthHeaderProvider/);
      assert.doesNotMatch(authoritySource,
          /export (?:async )?function executeProviderOperation/);
      assert.doesNotMatch(authoritySource, /"bindingContext"/);
      assert.match(authoritySource, /const executorSessions = new WeakMap\(\)/);
      assert.doesNotMatch(authoritySource,
          /export function createProviderTransportExecutor/);
      assert.doesNotMatch(authoritySource,
          /export function createGoogleAuthHeaderProvider/);
      assert.match(authoritySource,
          /export function createMockProviderTransportExecutor\(options\)/);
      assert.match(authoritySource, /mockOnly: true/);
      assert.match(authoritySource,
          /import \{GoogleAuth\} from "google-auth-library";/);
      assert.doesNotMatch(authoritySource,
          /from\s+["'](?:googleapis|[^"']*node_modules|[^"']*build\/src)/);
      assert.equal(PROVIDER_OPERATION_IDS.length, 30);
    });

test("source-load then swapped global fetch exposes no non-mock path", () => {
  const output = execFileSync(process.execPath, [
    "--input-type=module",
    "-e",
    [
      "const transport=await import(",
      "'./functions/scripts/academy-reset-freeze-provider-transport.mjs');",
      "let forgedCalls=0;",
      "globalThis.fetch=()=>{forgedCalls+=1;throw new Error('forged fetch')};",
      "if('createProviderTransportExecutor'in transport)throw new Error('prod');",
      "if('createGoogleAuthHeaderProvider'in transport)throw new Error('auth');",
      "try{transport.createMockProviderTransportExecutor()}catch{}",
      "if(forgedCalls!==0)throw new Error('forged fetch called');",
      "console.log(JSON.stringify({forgedCalls}));",
    ].join(""),
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: {...process.env, GOOGLE_APPLICATION_CREDENTIALS: "/does/not/exist"},
  });
  assert.deepEqual(JSON.parse(output), {forgedCalls: 0});
});

test("dependency remains exact and package changes stay functions-only", () => {
  const functionsPackage = JSON.parse(fs.readFileSync(path.join(
      repositoryRoot,
      "functions/package.json",
  )));
  const functionsLock = JSON.parse(fs.readFileSync(path.join(
      repositoryRoot,
      "functions/package-lock.json",
  )));
  assert.equal(functionsPackage.dependencies["google-auth-library"], "10.6.2");
  assert.equal(
      functionsLock.packages["node_modules/google-auth-library"].version,
      "10.6.2",
  );
  const packageChanges = execFileSync("git", [
    "diff", "--name-only", "c10a344a8c09cfacb06d7a7c8e1856d1d99bbe04",
    "--", ":(glob)**/package.json", ":(glob)**/package-lock.json",
  ], {
    cwd: repositoryRoot,
    encoding: "utf8",
  }).trim().split("\n").filter(Boolean);
  assert.deepEqual(packageChanges, [
    "functions/package-lock.json",
    "functions/package.json",
  ]);
});

test("approval lineage binds the exact reviewed Stage B source path set", () => {
  assert.deepEqual(PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS, [
    "functions/package-lock.json",
    "functions/package.json",
    "functions/scripts/academy-reset-freeze-provider-adapter.mjs",
    "functions/scripts/academy-reset-freeze-provider-attestation.mjs",
    "functions/scripts/academy-reset-freeze-provider-operations.mjs",
    "functions/scripts/academy-reset-freeze-provider-transport.mjs",
    "functions/scripts/academy-reset-freeze-readonly-permissions.mjs",
    "functions/scripts/academy-reset-freeze-runtime-identity.mjs",
    "functions/scripts/academy-reset-write-freeze-contract.mjs",
    "functions/scripts/observe-academy-reset-freeze-production.mjs",
    "functions/scripts/verify-academy-reset-write-freeze.mjs",
  ]);
  assert.equal(PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
      "academy_reset_provider_reviewed_sources.v1");
  assert.equal(PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM,
      "sha256_canonical_path_and_file_sha256.v1");
  assert.deepEqual(
      PROVIDER_ADAPTER_METADATA.reviewedSourcePaths,
      PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS,
  );
  assert.equal(
      PROVIDER_ADAPTER_METADATA.reviewedSourceIdentityPinStatus,
      "literal_sha256_pinned",
  );
  const identities = PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS.map(
      (sourcePath) => ({
        path: sourcePath,
        sha256: crypto.createHash("sha256")
            .update(fs.readFileSync(path.join(repositoryRoot, sourcePath)))
            .digest("hex"),
      }),
  );
  const digest =
    computeProviderAdapterReviewedSourceIdentityDigest(identities);
  assert.match(digest, /^[0-9a-f]{64}$/);
  identities.forEach((identity, index) => {
    const changed = structuredClone(identities);
    changed[index].sha256 = crypto.createHash("sha256")
        .update(`${identity.sha256}:changed-bytes`)
        .digest("hex");
    assert.notEqual(
        computeProviderAdapterReviewedSourceIdentityDigest(changed),
        digest,
        identity.path,
    );
  });
  assert.throws(() =>
    computeProviderAdapterReviewedSourceIdentityDigest(identities.slice(1)));
});
