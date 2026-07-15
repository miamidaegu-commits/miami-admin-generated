import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const plannerPath = path.join(
    repositoryRoot,
    "functions",
    "scripts",
    "plan-academy-scoped-test-data-reset.mjs",
);
const registryPath = path.join(
    repositoryRoot,
    "functions",
    "scripts",
    "academy-scoped-test-data-reset-registry.mjs",
);
const plannerSource = fs.readFileSync(plannerPath, "utf8");
const registrySource = fs.readFileSync(registryPath, "utf8");

test("planner contains no Firestore or Auth mutation implementation", () => {
  const mutationCalls = [
    /\.batch\s*\(/,
    /\.bulkWriter\s*\(/,
    /\.doc\s*\(/,
    /\.runTransaction\s*\(/,
    /\bWriteBatch\b/,
    /firebase-admin\/auth/,
    /getAuth\s*\(/,
  ];
  mutationCalls.forEach((pattern) => {
    assert.equal(
        pattern.test(plannerSource),
        false,
        `Forbidden planner capability matched ${pattern}`,
    );
  });
});

test("planner hard-codes read-only release gate metadata", () => {
  for (const required of [
    'mode: "read_only_plan"',
    "writeAuthorized: false",
    "executorImplemented: false",
    "actualWrites: 0",
    "backupVerified: false",
    "independentReviewApproved: false",
    "resetApproved: false",
  ]) {
    assert.equal(
        plannerSource.includes(required),
        true,
        `Missing read-only contract: ${required}`,
    );
  }
});

test("CLI binds release metadata before Firebase initialization", () => {
  for (const required of [
    "fileURLToPath(import.meta.url)",
    "fs.realpathSync(__filename)",
    "resolvePlannerFilesystemRepositoryRoot",
    "sanitizedGitEnvironment",
    '["rev-parse", "--show-toplevel"]',
    '["rev-parse", "HEAD"]',
    '["rev-parse", "HEAD^{tree}"]',
    '"ls-files"',
    '"--error-unmatch"',
    '["status", "--porcelain=v1", "--untracked-files=all"]',
    '"ls-tree"',
    '"cat-file"',
    '["ls-files", "-v", "--", relativePath]',
    "runtimeBytes.equals(headBytes)",
    "criticalRuntimeSources",
    "headBlobOid",
    "headBlobSha256",
    "runtimeSha256",
    "indexFlagsClean",
    "env: sanitizedGitEnvironment(environment)",
    "shell: false",
    "runtimeHeadSha",
    "runtimeTreeSha",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const cliBody = plannerSource.slice(
      plannerSource.indexOf("export async function executePlannerCli"),
      plannerSource.indexOf("const isMainModule"),
  );
  assert.ok(
      cliBody.indexOf("resolvePlannerRuntimeSourceIdentity()") <
      cliBody.indexOf("validatePlannerRuntimeSourceIdentity({"),
  );
  assert.ok(
      cliBody.indexOf("validatePlannerRuntimeSourceIdentity({") <
      cliBody.indexOf(
          "validatePlannerOutputPaths(executionOptions)",
      ),
  );
  assert.ok(
      cliBody.indexOf(
          "validatePlannerOutputPaths(executionOptions)",
      ) <
      cliBody.indexOf("await loadRuntimeRegistryModule()"),
  );
  assert.ok(
      cliBody.indexOf("await loadRuntimeRegistryModule()") <
      cliBody.indexOf("dbFactory(options.project"),
  );
  assert.equal(plannerSource.includes("sourceIdentityResolver"), false);
  assert.equal(
      plannerSource.includes(
          "export function resolvePlannerRuntimeSourceIdentity",
      ),
      false,
  );
  assert.equal(plannerSource.includes("PLANNER_BASE_SHA"), false);
  assert.equal(
      /env\.[A-Z0-9_]*(?:SOURCE|SHA|GIT)[A-Z0-9_]*/.test(plannerSource),
      false,
  );
});

test("critical local runtime imports are fixed by an exact allowlist", () => {
  const allowlistBody = plannerSource.match(
      /const CRITICAL_RUNTIME_SOURCE_PATHS = Object\.freeze\(\[([\s\S]*?)\]\);/,
  )?.[1] || "";
  const allowlist = [...allowlistBody.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1]);
  assert.deepEqual(allowlist, [
    "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
    "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
  ]);
  assert.equal(
      allowlist.some((relativePath) => relativePath.startsWith("tests/")),
      false,
  );

  const plannerRelativePath =
    "functions/scripts/plan-academy-scoped-test-data-reset.mjs";
  const localImports = [
    ...plannerSource.matchAll(
        /(?:from\s+|import\s*\()\s*["'](\.[^"']+)["']/g,
    ),
  ].map((match) => path.posix.normalize(path.posix.join(
      path.posix.dirname(plannerRelativePath),
      match[1],
  )));
  assert.deepEqual(localImports, [
    "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
  ]);
  localImports.forEach((relativePath) => {
    assert.equal(allowlist.includes(relativePath), true, relativePath);
  });
});

test("registry module has no import or runtime I/O side effects", () => {
  for (const forbidden of [
    /\bimport\s*(?:\(|[\s{*])/,
    /\brequire\s*\(/,
    /\bfetch\s*\(/,
    /\bfirebase-admin\b/,
    /\bnode:(?:fs|child_process|http|https|net)\b/,
    /\bprocess\.(?:env|exit|exitCode)\b/,
  ]) {
    assert.equal(
        forbidden.test(registrySource),
        false,
        `Registry side-effect capability matched ${forbidden}`,
    );
  }
});

test("groupLessons has strict classId and classID alias resolution", () => {
  const groupLessonsEntry = registrySource.match(
      /collectionName: "groupLessons"[\s\S]*?plannerDisposition: "reset_candidate"/,
  )?.[0] || "";
  for (const required of [
    '"classId"',
    '"classID"',
    'aliasPolicy: "strict_scalar_alias"',
  ]) {
    assert.equal(groupLessonsEntry.includes(required), true, required);
  }
  for (const required of [
    'extractor.aliasPolicy === "strict_scalar_alias"',
    'code: "ambiguous_reference_alias"',
    "resolvedValue: null",
    "conflict: true",
    "aliasEvidence",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
});

test("registry and planner do not load product write callables", () => {
  assert.equal(plannerSource.includes("../index.js"), false);
  assert.equal(registrySource.includes("../index.js"), false);
  assert.equal(plannerSource.includes("httpsCallable"), false);
  assert.equal(registrySource.includes("httpsCallable"), false);
});

test("planner resolves firebase-admin from its functions package", () => {
  assert.equal(
      plannerSource.includes('import("firebase-admin/app")'),
      true,
  );
  assert.equal(
      plannerSource.includes('import("firebase-admin/firestore")'),
      true,
  );
  const functionsPackage = JSON.parse(
      fs.readFileSync(
          path.join(repositoryRoot, "functions", "package.json"),
          "utf8",
      ),
  );
  assert.equal(
      Object.prototype.hasOwnProperty.call(
          functionsPackage.dependencies || {},
          "firebase-admin",
      ),
      true,
  );
});
