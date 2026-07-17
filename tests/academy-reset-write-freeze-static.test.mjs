import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
  EXPECTED_WRITE_SOURCE_COUNT,
  WRITE_SOURCE_SHA256_ALLOWLIST,
} from "../functions/scripts/academy-reset-write-surface-registry.mjs";
import {
  EXPECTED_DEPLOYED_FUNCTION_NAMES,
  EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES,
  EXPECTED_PROJECT_ID,
  EXPECTED_PROJECT_NUMBER,
  IAM_PRINCIPAL_POLICY_SCHEMA,
  PROJECT_IDENTITY_CONTRACT_VERSION,
  ROLLBACK_UNFREEZE_ORDER,
  SCHEDULER_JOB_ALLOWLIST,
  UNFREEZE_ORDER,
  TARGET_PROJECT_IDENTITY,
} from "../functions/scripts/academy-reset-write-freeze-contract.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const functionsPath = path.join(repositoryRoot, "functions", "index.js");
const functionsSource = fs.readFileSync(functionsPath, "utf8");
const backendFreezeSource = fs.readFileSync(
    path.join(repositoryRoot, "functions", "academy-reset-write-freeze.js"),
    "utf8",
);
const verifierSource = fs.readFileSync(
    path.join(
        repositoryRoot,
        "functions",
        "scripts",
        "verify-academy-reset-write-freeze.mjs",
    ),
    "utf8",
);
const contractSource = fs.readFileSync(
    path.join(
        repositoryRoot,
        "functions",
        "scripts",
        "academy-reset-write-freeze-contract.mjs",
    ),
    "utf8",
);

function recursivelyListClientSource(directory) {
  return fs.readdirSync(directory, {withFileTypes: true})
      .flatMap((entry) => {
        const absolute = path.join(directory, entry.name);
        if (entry.isDirectory()) return recursivelyListClientSource(absolute);
        return /\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name) ? [absolute] : [];
      });
}

function scanClientDirectWriterFiles() {
  const candidates = [
    ...fs.readdirSync(repositoryRoot, {withFileTypes: true})
        .filter((entry) =>
          entry.isFile() && /\.(?:[cm]?js|jsx|ts|tsx)$/.test(entry.name))
        .map((entry) => path.join(repositoryRoot, entry.name)),
    ...recursivelyListClientSource(path.join(repositoryRoot, "src")),
  ];
  const directCall =
    /\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch|runTransaction)\s*\(/;
  return candidates
      .filter((absolute) => directCall.test(fs.readFileSync(absolute, "utf8")))
      .map((absolute) =>
        path.relative(repositoryRoot, absolute).split(path.sep).join("/"))
      .sort();
}

function scanBackendWriterExports() {
  const exportsByName = new Map([
    ...functionsSource.matchAll(
        /^exports\.([A-Za-z0-9_]+)\s*=\s*(onCall|onSchedule)/gm,
    ),
  ].map((match) => [match[1], match[2]]));
  const guardedSurfaceIds = [
    ...functionsSource.matchAll(/writeSurfaceId:\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
  const publicGuardedWriters = guardedSurfaceIds.filter((surfaceId) =>
    exportsByName.has(surfaceId));
  const scheduledWriters = [...exportsByName]
      .filter(([, trigger]) => trigger === "onSchedule")
      .map(([name]) => name);
  assert.match(
      functionsSource,
      /exports\.runAutoDeductPendingLessonsForTest[\s\S]*?runAutoDeductPendingLessons\s*\(/,
  );
  return [...new Set([
    ...publicGuardedWriters,
    ...scheduledWriters,
    "runAutoDeductPendingLessonsForTest",
  ])].sort();
}

function inventoryList(name) {
  const body = backendFreezeSource.match(
      new RegExp(`${name}:\\s*frozenList\\(\\[([\\s\\S]*?)\\]\\)`),
  )?.[1];
  assert.ok(body, `${name} inventory is missing`);
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
}

test("actual client source scan exactly matches the direct-writer allowlist", () => {
  const scanned = scanClientDirectWriterFiles();
  const registered = ACADEMY_RESET_WRITE_SURFACE_REGISTRY
      .filter(({category}) => category === "client_direct_writer")
      .map(({sourceFile}) => sourceFile)
      .sort();
  assert.deepEqual(scanned, registered);
});

test("all writer source runtime bytes match literal pinned SHA-256 identities", () => {
  assert.equal(WRITE_SOURCE_SHA256_ALLOWLIST.length, EXPECTED_WRITE_SOURCE_COUNT);
  const runtimeIdentities = WRITE_SOURCE_SHA256_ALLOWLIST.map((identity) => {
    const absolute = path.join(repositoryRoot, identity.sourceFile);
    const stat = fs.lstatSync(absolute);
    assert.equal(stat.isFile(), true, identity.sourceFile);
    assert.equal(stat.isSymbolicLink(), false, identity.sourceFile);
    return {
      sourceFile: identity.sourceFile,
      sha256: crypto.createHash("sha256")
          .update(fs.readFileSync(absolute))
          .digest("hex"),
    };
  });
  assert.deepEqual(runtimeIdentities, WRITE_SOURCE_SHA256_ALLOWLIST);
  const scannedSources = scanClientDirectWriterFiles();
  assert.deepEqual(
      WRITE_SOURCE_SHA256_ALLOWLIST
          .map(({sourceFile}) => sourceFile)
          .filter((sourceFile) => sourceFile !== "functions/index.js")
          .sort(),
      scannedSources,
  );
});

test("actual exported backend source scan exactly matches public writers", () => {
  const scanned = scanBackendWriterExports();
  const registered = ACADEMY_RESET_WRITE_SURFACE_REGISTRY
      .filter(({category}) => [
        "callable_writer",
        "scheduled_writer",
        "auth_global_writer",
      ].includes(category))
      .map(({entryHelper}) => entryHelper)
      .sort();
  assert.deepEqual(scanned, registered);
  assert.deepEqual(scanned, EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES);
  assert.equal(scanned.length, 26);
});

test("deployed functions, IAM, scheduler, and unfreeze use central exact sets",
    () => {
      const deployed = [
        ...functionsSource.matchAll(
            /^exports\.([A-Za-z0-9_]+)\s*=\s*(?:onCall|onSchedule)/gm,
        ),
      ].map((match) => match[1]).sort();
      assert.deepEqual(deployed, EXPECTED_DEPLOYED_FUNCTION_NAMES);
      assert.equal(deployed.length, 35);
      assert.equal(new Set(deployed).size, deployed.length);
      assert.equal(IAM_PRINCIPAL_POLICY_SCHEMA.length, 3);
      assert.deepEqual(TARGET_PROJECT_IDENTITY, {
        projectIdentityContractVersion: PROJECT_IDENTITY_CONTRACT_VERSION,
        targetProjectId: EXPECTED_PROJECT_ID,
        targetProjectNumber: EXPECTED_PROJECT_NUMBER,
      });
      assert.equal(EXPECTED_PROJECT_ID, "daegu-miami-production");
      assert.equal(EXPECTED_PROJECT_NUMBER, "884850632328");
      assert.deepEqual(
          IAM_PRINCIPAL_POLICY_SCHEMA.map(({id, memberBinding}) => ({
            id,
            memberBinding,
          })),
          [
            {
              id: "cloud_functions_runtime",
              memberBinding: "project_number_derived",
            },
            {
              id: "firebase_admin_backend",
              memberBinding: "approval_receipt_exact",
            },
            {
              id: "future_reset_executor",
              memberBinding: "approval_receipt_exact",
            },
          ],
      );
      assert.equal(
          IAM_PRINCIPAL_POLICY_SCHEMA.some((principal) =>
            Object.hasOwn(principal, "member")),
          false,
      );
      assert.equal(SCHEDULER_JOB_ALLOWLIST.length, 1);
      assert.deepEqual(UNFREEZE_ORDER, [
        "audit",
        "iamRestore",
        "schedulerRestore",
        "sentinelDeactivate",
        "positiveSmoke",
      ]);
      assert.deepEqual(ROLLBACK_UNFREEZE_ORDER, UNFREEZE_ORDER);
      assert.doesNotMatch(contractSource, /memberMatchesPrincipal|new RegExp/);
      assert.doesNotMatch(
          contractSource,
          /123456789012|firebase-adminsdk-ab123/,
      );
      assert.doesNotMatch(contractSource, /rules\.sourceBundle/);
      assert.match(contractSource, /reviewed_direct_googleapis/);
      assert.match(contractSource, /declared_google_auth_library_rest/);
    });

test("every registered transaction helper is present and mutating", () => {
  const transactionEntries = ACADEMY_RESET_WRITE_SURFACE_REGISTRY
      .filter(({category}) => category === "transaction_writer");
  for (const entry of transactionEntries) {
    const declaration = new RegExp(
        `(?:async\\s+)?function\\s+${entry.entryHelper}\\s*\\(`,
    );
    assert.match(functionsSource, declaration, entry.entryHelper);
  }
  assert.match(functionsSource, /\bdb\.runTransaction\s*\(/);
  assert.match(
      functionsSource,
      /\btransaction\.(?:create|set|update|delete)\s*\(/,
  );
});

test("backend callable, scheduler, and helper inventories have exact coverage", () => {
  const registeredPublic = ACADEMY_RESET_WRITE_SURFACE_REGISTRY
      .filter(({category}) =>
        ["callable_writer", "auth_global_writer"].includes(category))
      .map(({entryHelper}) => entryHelper)
      .sort();
  const registeredScheduled = ACADEMY_RESET_WRITE_SURFACE_REGISTRY
      .filter(({category}) => category === "scheduled_writer")
      .map(({entryHelper}) => entryHelper)
      .sort();
  const registeredHelpers = ACADEMY_RESET_WRITE_SURFACE_REGISTRY
      .filter(({category}) => category === "transaction_writer")
      .map(({entryHelper}) => entryHelper)
      .sort();
  assert.deepEqual(inventoryList("writeCallables"), registeredPublic);
  assert.deepEqual(inventoryList("scheduledWriters"), registeredScheduled);
  assert.deepEqual(inventoryList("writeHelpers"), registeredHelpers);
});

test("verifier and contract are local-only and mutation-incapable", () => {
  const combined = `${verifierSource}\n${contractSource}`;
  for (const forbidden of [
    /\bfirebase-admin\b/,
    /\bfirebase\/(?:firestore|auth)\b/,
    /\bfetch\s*\(/,
    /\bnode:(?:http|https|net|dns)\b/,
    /\bexecSync\s*\(/,
    /\bspawn(?:Sync)?\s*\(/,
    /\bgetFirestore\s*\(/,
    /\bgetAuth\s*\(/,
  ]) {
    assert.equal(
        forbidden.test(combined),
        false,
        `Forbidden verifier capability matched ${forbidden}`,
    );
  }
  for (const required of [
    'import {execFileSync} from "node:child_process"',
    "sanitizedGitEnvironment",
    'execFileSync("git", [',
    "shell: false",
    'result.GIT_TERMINAL_PROMPT = "0"',
    'result.GIT_CONFIG_NOSYSTEM = "1"',
    'result.GIT_CONFIG_GLOBAL = "/dev/null"',
  ]) {
    assert.equal(verifierSource.includes(required), true, required);
  }
});

test("advisory planner writeFreezeVerified remains false", () => {
  const plannerSource = fs.readFileSync(
      path.join(
          repositoryRoot,
          "functions",
          "scripts",
          "plan-academy-scoped-test-data-reset.mjs",
      ),
      "utf8",
  );
  assert.equal(plannerSource.includes("writeFreezeVerified: false"), true);
  assert.equal(contractSource.includes("comparison_only_not_a_gate"), true);
  assert.doesNotMatch(contractSource, /baselineComparison\.matched\s*!==\s*true/);
});

test("no freeze activation, IAM mutation, or reset executor is implemented", () => {
  const combined = `${verifierSource}\n${contractSource}`;
  for (const forbidden of [
    /setIamPolicy/,
    /addIamPolicyBinding/,
    /removeIamPolicyBinding/,
    /writeFreezeActive\s*:\s*true/,
    /deleteResetCandidate/,
    /executeAcademyReset/,
    /firebase deploy/,
    /gcloud\s+/,
  ]) {
    assert.equal(
        forbidden.test(combined),
        false,
        `Forbidden implementation matched ${forbidden}`,
    );
  }
});
