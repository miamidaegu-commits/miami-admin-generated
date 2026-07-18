import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const scripts = path.join(repositoryRoot, "functions", "scripts");
const authorityPath = path.join(
    scripts,
    "observe-academy-reset-freeze-production.mjs",
);
const facadePath = path.join(
    scripts,
    "academy-reset-freeze-provider-transport.mjs",
);
const permissionPath = path.join(
    scripts,
    "academy-reset-freeze-readonly-permissions.mjs",
);
const authoritySource = fs.readFileSync(authorityPath, "utf8");
const facadeSource = fs.readFileSync(facadePath, "utf8");
const permissionSource = fs.readFileSync(permissionPath, "utf8");
const BASE = "242a96a5108ac2380f724ca756178238422b2071";

function git(args, encoding = "utf8") {
  return execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding,
    maxBuffer: 16 * 1024 * 1024,
  });
}

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

test("functions index neither imports nor exports the production observer", () => {
  const indexSource =
    fs.readFileSync(path.join(repositoryRoot, "functions", "index.js"), "utf8");
  assert.doesNotMatch(
      indexSource,
      /observe-academy-reset-freeze-production|ProductionObserver|productionObserver/,
  );
});

test("transport facade is an explicit mock-safe re-export only", () => {
  assert.match(
      facadeSource,
      /^export \{\n(?:  [A-Za-z0-9_]+,\n)+\} from "\.\/observe-academy-reset-freeze-production\.mjs";\n$/,
  );
  assert.deepEqual(
      [...facadeSource.matchAll(/^  ([A-Za-z0-9_]+),$/gm)]
          .map((match) => match[1]),
      [
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
      ],
  );
  assert.doesNotMatch(
      facadeSource,
      /GoogleAuth|WeakMap|capturedNativeFetch|createProduction|executeProduction/,
  );
});

test("authority alone owns transport state, mock factory, explicit auth, and fetch",
    () => {
      assert.match(authoritySource, /const executorSessions = new WeakMap\(\)/);
      assert.match(
          authoritySource,
          /export function createMockProviderTransportExecutor\(options\)/,
      );
      assert.match(
          authoritySource,
          /import \{GoogleAuth\} from "google-auth-library";/,
      );
      assert.match(
          authoritySource,
          /const capturedNativeFetch = globalThis\.fetch\?\.bind\(globalThis\);/,
      );
      assert.match(
          authoritySource,
          /new GoogleAuth\(\{\s*credentials: parsedCredential,\s*scopes: \[GOOGLE_PROVIDER_READ_ONLY_SCOPE\],\s*\}\)/s,
      );
      assert.doesNotMatch(
          authoritySource,
          /new GoogleAuth\(\{\s*scopes\s*:/s,
      );
    });

test("no public production executor, factory, result attestation, or main exists",
    () => {
      const combined = `${facadeSource}\n${authoritySource}`;
      for (const forbidden of [
        /export (?:async )?function createProduction[A-Za-z0-9_]*/,
        /export (?:async )?function executeProduction[A-Za-z0-9_]*/,
        /export (?:async )?function assertGenuineRawProduction[A-Za-z0-9_]*/,
        /export (?:async )?function runProductionObserverCli/,
        /export \{[^}]*runProductionObserverCli/s,
      ]) {
        assert.doesNotMatch(combined, forbidden);
      }
    });

test("authority has no ambient credential or project fallback", () => {
  for (const forbidden of [
    /GOOGLE_APPLICATION_CREDENTIALS/,
    /applicationDefault\s*\(/,
    /getApplicationDefault\s*\(/,
    /defaultProject/i,
    /quotaProject/i,
    /\bgcloud\b/i,
    /user[_ -]?oauth/i,
    /authorized_user/,
    /process\.env\.(?:GCLOUD|GOOGLE_CLOUD_PROJECT|GCP_PROJECT|FIREBASE_CONFIG)/,
  ]) {
    assert.doesNotMatch(authoritySource, forbidden);
  }
  assert.match(authoritySource, /credentials: parsedCredential/);
  assert.match(authoritySource, /parsed\["credential-file"\]/);
});

test("topology and principal gates are exact and precede GoogleAuth", () => {
  assert.match(
      permissionSource,
      /STANDALONE_PROJECT_TOPOLOGY_PROFILE_ID =\s*"standalone_project_v1"/,
  );
  assert.match(
      permissionSource,
      /OBSERVER_SERVICE_ACCOUNT_EMAIL =\s*"academy-reset-freeze-observer@daegu-miami-production\.iam\.gserviceaccount\.com"/,
  );
  assert.match(
      authoritySource,
      /credentialResult\.payload\.client_email !==\s*OBSERVER_PRINCIPAL_POLICY\.email/,
  );
  assert.doesNotMatch(
      authoritySource,
      /client_email\.(?:trim|toLowerCase)\s*\(/,
  );
  const principalGate = authoritySource.indexOf(
      "parsedCredential?.client_email !== OBSERVER_PRINCIPAL_POLICY.email",
  );
  const googleAuth = authoritySource.indexOf("const auth = new GoogleAuth");
  assert.equal(principalGate >= 0, true);
  assert.equal(googleAuth > principalGate, true);
  assert.match(
      authoritySource,
      /deriveObservedStandaloneTopologyProfile\(\s*iam\.hierarchy,\s*functions\.records,\s*functions\.bucketIdentities,\s*\)/s,
  );
  assert.match(authoritySource, /operationId: "storage\.v1\.buckets\.get"/);
  assert.match(authoritySource, /query: \{projection: "noAcl"\}/);
  assert.doesNotMatch(
      authoritySource,
      /gcf-v2-sources-\(\[0-9\]\+\)-us-central1/,
  );
});

test("authority contains no Firebase Admin, Firestore, or Auth write path", () => {
  for (const forbidden of [
    /from\s+["']firebase-admin(?:\/[^"']*)?["']/,
    /require\(["']firebase-admin(?:\/[^"']*)?["']\)/,
    /\bgetFirestore\s*\(/,
    /\bgetAuth\s*\(/,
    /\b(?:batch|transaction)\.(?:set|update|delete|create)\s*\(/,
    /\b(?:firestore|document|docRef|collectionRef|auth)\.(?:set|update|delete|create)\s*\(/,
    /\bdeleteUser\s*\(/,
    /\bupdateUser\s*\(/,
  ]) {
    assert.doesNotMatch(authoritySource, forbidden);
  }
});

test("authority has no deploy, IAM/Scheduler mutation, reset, or planner command",
    () => {
      for (const forbidden of [
        /firebase\s+deploy/i,
        /gcloud\s+(?:functions|run|iam|scheduler|projects)\b/i,
        /cloudscheduler\.v1\.[A-Za-z0-9_.]+\.(?:create|patch|update|delete|pause|resume)/,
        /(?:setIamPolicy|createPolicy|updatePolicy|deletePolicy)/,
        /["'][^"']+\.(?:create|patch|update|delete|setIamPolicy)["']/,
        /academy-scoped-test-data-reset-planner/,
        /executeAcademyResetPlan/,
        /planAcademyReset/,
      ]) {
        assert.doesNotMatch(authoritySource, forbidden);
      }
      assert.match(authoritySource, /PROVIDER_NO_MUTATION_OPERATION_COUNT !== 0/);
      assert.match(authoritySource, /actualMutations: 0/);
    });

test("all production provider descriptors remain read-only semantic operations",
    () => {
      assert.match(
          authoritySource,
          /descriptor\.readOnlySemantic !== true \|\|\s*!\["GET", "POST"\]\.includes\(descriptor\.method\)/s,
      );
      assert.doesNotMatch(
          authoritySource,
          /options\.method\s*=\s*["'](?:PUT|PATCH|DELETE)["']/,
      );
    });

test("unknown IAM principals, roles, permissions, and scopes fail closed",
    () => {
      assert.match(
          authoritySource,
          /const iamExpansionComplete =\s*unknownPrincipals\.length === 0 &&\s*unknownRoles\.length === 0 &&\s*unknownPermissions\.length === 0 &&\s*unknownScopes\.length === 0;/s,
      );
      assert.match(
          authoritySource,
          /policyAnalysisComplete:\s*iamExpansionComplete &&\s*conditionAnalysisComplete &&\s*domainExpansionComplete &&\s*groupExpansionComplete &&\s*denyPolicyAnalysisComplete &&\s*writableBindings\.length === 0/s,
      );
      assert.match(
          authoritySource,
          /conditionAnalysisComplete = unresolvedConditions\.length === 0/,
      );
      assert.match(authoritySource, /domainExpansionComplete = !hasDomain/);
    });

test("deny policy presence structurally makes analysis incomplete", () => {
  assert.match(
      authoritySource,
      /const denyPolicyAnalysisComplete = denyPolicies\.length === 0;/,
  );
  assert.match(
      authoritySource,
      /denyPolicyAnalysisComplete: iamUniverse\.denyPolicyAnalysisComplete/s,
  );
  assert.match(
      authoritySource,
      /if \(!iam\.denyPolicyAnalysisComplete\) \{\s*blockers\.push\("DENY_POLICY_ANALYSIS_INCOMPLETE"\);/s,
  );
});

test("IAM observation is double-pass and writable bindings fail closed", () => {
  assert.match(
      authoritySource,
      /const firstIam = await observeRawIam\(state, functions\);\s*const secondIam = await observeRawIam\(state, functions\);\s*if \(canonical\(firstIam\) !== canonical\(secondIam\)\)/s,
  );
  assert.match(authoritySource, /REVIEWED_WRITABLE_PERMISSIONS/);
  assert.match(
      authoritySource,
      /const writableBindings = canonicalBindings\.filter\(\(\{permissions\}\) =>/s,
  );
  assert.match(authoritySource, /service_account_iam_policy/);
  assert.match(authoritySource, /bindingSetDigest/);
  assert.match(
      authoritySource,
      /analysis\.analysisResults\.length > 0 &&\s*Array\.isArray\(analysis\.groupEdges\) &&\s*analysis\.groupEdges\.length > 0/s,
  );
  assert.match(
      authoritySource,
      /if \(iam\.writableBindings\.length !== 0\) \{\s*blockers\.push\("IAM_WRITABLE_PERMISSION_FOUND"\);/s,
  );
});

test("IAM binding scope comes only from exact observed resource identities",
    () => {
      assert.match(
          authoritySource,
          /function deriveAuthoritativeIamResourceUniverse\(\{/,
      );
      assert.match(
          authoritySource,
          /const hierarchyByName = new Map\(\);/,
      );
      assert.match(
          authoritySource,
          /if \(!parent\) observerFail\("IAM_HIERARCHY_UNKNOWN_ANCESTOR_REJECTED"\);/,
      );
      assert.match(
          authoritySource,
          /if \(visited\.size !== hierarchyByName\.size\) \{\s*observerFail\("IAM_HIERARCHY_DISCONNECTED_RESOURCE_REJECTED"\);/s,
      );
      assert.match(
          authoritySource,
          /match\[2\] !== account\.email/,
      );
      assert.match(
          authoritySource,
          /binding\.attachmentPoint !== account\.name/,
      );
      assert.match(
          authoritySource,
          /SERVICE_ACCOUNT_RESOURCE_DUPLICATE_REJECTED/,
      );
      assert.match(
          authoritySource,
          /resourceUniverseDigest: sha256Canonical\(\{/,
      );
      assert.match(
          authoritySource,
          /hierarchyResourceIdentityDigest/,
      );
      assert.match(
          authoritySource,
          /serviceAccountResourceIdentityDigest/,
      );
      assert.doesNotMatch(
          authoritySource,
          /function resolveIamBindingScope\(/,
      );
    });

test("mock observations and publication directories carry private identity pins",
    () => {
      assert.match(
          authoritySource,
          /const genuineInjectedMockObservations = new WeakSet\(\)/,
      );
      assert.match(
          authoritySource,
          /PROVIDER_OBSERVATION_ATTESTATION_REJECTED/,
      );
      assert.match(authoritySource, /allowedCredentialKeys/);
      assert.match(authoritySource, /baseDevice: stat\.dev/);
      assert.match(authoritySource, /baseInode: stat\.ino/);
      assert.match(authoritySource, /OUTPUT_DIRECTORY_IDENTITY_REJECTED/);
    });

test("source captures native fetch before any production executor construction",
    () => {
      const capture = authoritySource.indexOf("const capturedNativeFetch");
      const factory =
        authoritySource.indexOf("function createProductionProviderTransportExecutor");
      assert.equal(capture >= 0, true);
      assert.equal(factory > capture, true);
      assert.match(authoritySource, /fetchImpl: capturedNativeFetch/);
      assert.doesNotMatch(authoritySource, /fetchImpl: globalThis\.fetch/);
    });

test("package manifests and locks exactly match the required base", () => {
  for (const relativePath of [
    "package.json",
    "package-lock.json",
    "functions/package.json",
    "functions/package-lock.json",
  ]) {
    const current = fs.readFileSync(path.join(repositoryRoot, relativePath));
    const baseline = git(["show", `${BASE}:${relativePath}`], null);
    assert.equal(sha256(current), sha256(baseline), relativePath);
  }
});

test("index, rules, planner, and write registry have no working-tree edits",
    () => {
      const protectedPaths = [
        "functions/index.js",
        "firestore.rules",
        "functions/academy-reset-write-freeze.js",
        "functions/scripts/academy-reset-write-surface-registry.mjs",
      ];
      const changed = git([
        "diff",
        "--name-only",
        "HEAD",
        "--",
        ...protectedPaths,
      ]).trim().split("\n").filter(Boolean);
      assert.deepEqual(changed, []);
    });

test("observer test files contain no skips, only, or unfinished-work markers",
    () => {
      const unfinishedMarker = new RegExp("\\b" + "TO" + "DO\\b", "i");
      const disabledTest = new RegExp(
          "\\b(?:test|describe|it)\\.(?:skip|only|" + "to" + "do)\\s*\\(",
      );
      for (const relativePath of [
        "tests/academy-reset-freeze-production-observer.test.mjs",
        "tests/academy-reset-freeze-production-observer-topology.test.mjs",
        "tests/academy-reset-freeze-production-observer-static.test.mjs",
        "tests/academy-reset-freeze-provider-transport.test.mjs",
      ]) {
        const source =
          fs.readFileSync(path.join(repositoryRoot, relativePath), "utf8");
        assert.doesNotMatch(source, disabledTest);
        assert.doesNotMatch(source, unfinishedMarker);
      }
    });
