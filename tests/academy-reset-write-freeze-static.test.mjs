import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import * as writeFreezeContract from
  "../functions/scripts/academy-reset-write-freeze-contract.mjs";
import {
  ACADEMY_RESET_WRITE_SURFACE_REGISTRY,
  EXPECTED_WRITE_SOURCE_COUNT,
  EXPECTED_WRITE_SURFACE_COUNT,
  WRITE_SOURCE_SHA256_ALLOWLIST,
  WRITE_SURFACE_REGISTRY_VERSION,
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
import {
  PROVIDER_MANDATORY_OPERATION_COUNT,
  PROVIDER_MANDATORY_OPERATION_IDS,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";
import {
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT,
  READONLY_PERMISSION_MANIFEST_DIGEST,
  READONLY_PERMISSION_MANIFEST_VERSION,
} from "../functions/scripts/academy-reset-freeze-readonly-permissions.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const functionsPath = path.join(repositoryRoot, "functions", "index.js");
const functionsSource = fs.readFileSync(functionsPath, "utf8");
const backendFreezeSource = fs.readFileSync(
    path.join(repositoryRoot, "functions", "academy-reset-write-freeze.js"),
    "utf8",
);

const APPROVED_PUBLIC_EXPORTS = Object.freeze([
  "APPROVED_IAM_STATE_CONTRACT_VERSION",
  "APPROVED_PROVIDER_ADAPTER_ID",
  "CRITICAL_RUNTIME_SOURCE_PATHS",
  "DEPLOYMENT_APPROVAL_RECEIPT_VERSION",
  "EXPECTED_ACADEMY_ID",
  "EXPECTED_DEPLOYED_FUNCTION_NAMES",
  "EXPECTED_FUNCTION_GENERATION",
  "EXPECTED_FUNCTION_REGION",
  "EXPECTED_GUARDED_FUNCTION_EXPORT_NAMES",
  "EXPECTED_PROJECT_ID",
  "EXPECTED_PROJECT_NUMBER",
  "EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST",
  "FREEZE_IAM_CONTRACT_LINEAGE_VERSION",
  "FUNCTION_HTTP_TRIGGER_CONTRACT_DIGEST",
  "FUNCTION_HTTP_TRIGGER_CONTRACT_ID",
  "FUNCTION_HTTP_TRIGGER_CONTRACT_VERSION",
  "FUNCTION_HTTP_TRIGGER_TYPE",
  "FUNCTION_TRIGGER_ABSENCE_EVIDENCE_VERSION",
  "FUTURE_EXECUTOR_EFFECTIVE_PERMISSIONS",
  "IAM_EVIDENCE_FAMILY_NAMES",
  "IAM_FAMILY_COMPLETENESS_VERSION",
  "IAM_PRINCIPAL_POLICY_SCHEMA",
  "IAM_PRINCIPAL_POLICY_VERSION",
  "KNOWN_IAM_GROUPS",
  "MAX_DRAIN_QUIET_WINDOW_SECONDS",
  "MAX_FREEZE_WINDOW_SECONDS",
  "MIN_DRAIN_QUIET_WINDOW_SECONDS",
  "NON_EXECUTOR_EFFECTIVE_PERMISSIONS",
  "OBSERVATION_COMPLETENESS_VERSION",
  "OBSERVER_PRINCIPAL_POLICY",
  "PINNED_STANDALONE_TOPOLOGY_EVIDENCE",
  "PROJECT_IDENTITY_CONTRACT_VERSION",
  "PROOF_GATE_KEYS",
  "PROVIDER_ADAPTER_METADATA",
  "PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION",
  "PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM",
  "PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES",
  "PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS",
  "PROVIDER_DEPENDENCY_CONTRACT_VERSION",
  "PROVIDER_DEPENDENCY_STRATEGIES",
  "PROVIDER_OBSERVATION_VERSION",
  "PROVIDER_READ_ONLY_OPERATIONS",
  "REQUIRED_COMPARISON_BASELINE_DIGEST",
  "REQUIRED_IAM_PRINCIPAL_IDS",
  "REQUIRED_NEGATIVE_PROBES",
  "REQUIRED_PROVIDER_OBSERVATION_OPERATION_IDS",
  "REVIEWED_IAM_ROLE_DEFINITIONS",
  "REVIEWED_PERMISSION_UNIVERSE",
  "REVIEWED_WRITABLE_PERMISSIONS",
  "ROLLBACK_UNFREEZE_ORDER",
  "SCHEDULER_JOB_ALLOWLIST",
  "STANDALONE_PROJECT_OBSERVER_PROFILE",
  "TARGET_PROJECT_IDENTITY",
  "UNFREEZE_ORDER",
  "WRITABLE_PERMISSION_DERIVATION_VERSION",
  "WRITER_DRAIN_CLASSES",
  "WRITE_FREEZE_CONTRACT_VERSION",
  "WRITE_FREEZE_PROOF_VERSION",
  "WRITE_FREEZE_SENTINEL_MODE",
  "assertCanonicalJsonShape",
  "assertHttpCallableRawFunctionRecord",
  "assertNoSecretOrPii",
  "assertObserverPrincipalPolicy",
  "assertStandaloneProjectObserverProfile",
  "buildApprovedIamExpectedState",
  "buildDeterministicWriteFreezeProof",
  "buildEvidenceDigestInput",
  "buildFreezeIamContractLineage",
  "buildFunctionTriggerAbsenceEvidence",
  "buildIamFamilyCompleteness",
  "computeDrainTelemetryDigest",
  "computeEvidenceArtifactDigest",
  "computeIamPolicyDigest",
  "computeNegativeProbeEvidenceDigest",
  "computeObservedSetDigest",
  "computeProviderAdapterReviewedSourceIdentityDigest",
  "computeSentinelSnapshotDigest",
  "deriveCapabilitiesFromEffectivePermissions",
  "deriveStandaloneProjectObserverProfile",
  "expectedIamPrincipalMember",
  "parseRulesResourceIdentity",
  "sha256Canonical",
  "stableStringify",
  "validateFunctionTriggerAbsenceEvidence",
  "validateObservationCompleteness",
  "validateProviderAdapterReviewedSources",
  "validateProviderDependencyContract",
  "validateWriteFreezeEvidence",
]);

function assertExactPublicExports(
    actualExports,
    approvedExports = APPROVED_PUBLIC_EXPORTS,
) {
  assert.equal(
      new Set(approvedExports).size,
      approvedExports.length,
      "approved public export allowlist must not contain duplicates",
  );
  assert.deepEqual([...actualExports].sort(), [...approvedExports].sort());
}

test("write-freeze full public namespace matches the exact allowlist", () => {
  assertExactPublicExports(Object.keys(writeFreezeContract));
  assert.equal(APPROVED_PUBLIC_EXPORTS.length, 88);
});

test("write-freeze export boundary rejects every prefix and keyset bypass",
    () => {
      const actual = Object.keys(writeFreezeContract);
      const without = (name) => actual.filter((entry) => entry !== name);
      const withUnexpected = (name) => [...actual, name];

      // The former prefix-filtered subset did not observe public assert* exports.
      assert.throws(() => assertExactPublicExports(
          actual,
          APPROVED_PUBLIC_EXPORTS.filter((name) =>
            name !== "assertHttpCallableRawFunctionRecord"),
      ));
      for (const unexpected of [
        "assertUnexpectedRuntimeExport",
        "createUnexpectedRuntimeExport",
        "zUnexpectedExport",
      ]) {
        assert.throws(() =>
          assertExactPublicExports(withUnexpected(unexpected)));
      }
      assert.throws(() =>
        assertExactPublicExports(without("stableStringify")));
      assert.throws(() => assertExactPublicExports(
          actual,
          [...APPROVED_PUBLIC_EXPORTS, "missingApprovedRuntimeExport"],
      ));
      assert.throws(() => assertExactPublicExports(
          actual,
          [...APPROVED_PUBLIC_EXPORTS,
            "buildFunctionTriggerAbsenceEvidence"],
      ));
      assert.doesNotThrow(() => assertExactPublicExports(
          [...actual].reverse(),
          [...APPROVED_PUBLIC_EXPORTS].reverse(),
      ));
      for (const helper of [
        "buildFunctionTriggerAbsenceEvidence",
        "validateFunctionTriggerAbsenceEvidence",
      ]) {
        assert.throws(() => assertExactPublicExports(without(helper)));
      }
      assert.throws(() => assertExactPublicExports(
          actual.map((name) =>
            name === "assertHttpCallableRawFunctionRecord" ?
              "assertUnexpectedRuntimeExport" :
              name),
      ));
    });
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
const permissionManifestSource = fs.readFileSync(
    path.join(
        repositoryRoot,
        "functions",
        "scripts",
        "academy-reset-freeze-readonly-permissions.mjs",
    ),
    "utf8",
);
const runbookSource = fs.readFileSync(
    path.join(
        repositoryRoot,
        "docs",
        "academy-reset-write-freeze-runbook.md",
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
      assert.equal(IAM_PRINCIPAL_POLICY_SCHEMA.length, 5);
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
              id: "private_writer_runtime",
              memberBinding: "canonical_runtime_contract",
            },
            {
              id: "private_preview_runtime",
              memberBinding: "canonical_runtime_contract",
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
      assert.match(contractSource, /declared_google_auth_library_rest/);
      assert.doesNotMatch(contractSource, /reviewed_direct_googleapis/);
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

test("reversal helper is exactly represented by both v2 current owners", () => {
  const helperName = "reversePrivateReservationOutcomeInTransaction";
  assert.equal(
      WRITE_SURFACE_REGISTRY_VERSION,
      "academy_reset_write_surface.v2",
  );
  assert.equal(EXPECTED_WRITE_SURFACE_COUNT, 59);
  assert.equal(
      ACADEMY_RESET_WRITE_SURFACE_REGISTRY.filter(
          ({category}) => category === "transaction_writer",
      ).length,
      13,
  );
  assert.equal(
      (backendFreezeSource.match(
          /"academy_reset_write_surface_inventory\.v2"/g,
      ) || []).length,
      1,
  );
  assert.equal(
      (backendFreezeSource.match(/"academy_reset_write_freeze\.v1"/g) || [])
          .length,
      1,
  );
  assert.equal(
      inventoryList("writeHelpers").filter((name) => name === helperName)
          .length,
      1,
  );

  const helperStart = functionsSource.indexOf(`async function ${helperName}(`);
  const helperEnd = functionsSource.indexOf(
      "\nexports.reversePrivateReservationOutcome = onCall(",
      helperStart,
  );
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  const helperSource = functionsSource.slice(helperStart, helperEnd);
  const mutations = [...helperSource.matchAll(
      /transaction\.(create|set|update|delete)\(\s*([A-Za-z][A-Za-z0-9]*)/g,
  )].map((match) => `${match[1]}:${match[2]}`);
  assert.deepEqual(mutations, [
    "update:packageRef",
    "update:reservationRef",
    "update:originalCreditRef",
    "create:reversalCreditRef",
  ]);
  for (const reference of [
    'const packageRef = db.collection("studentPackages").doc(packageId);',
    '.collection("privateLessonReservations")',
    'const originalCreditRef = db.collection("creditTransactions")',
    'const reversalCreditRef = db.collection("creditTransactions")',
  ]) {
    assert.equal(helperSource.includes(reference), true, reference);
  }
  assert.equal(
      (functionsSource.match(
          /^async function reversePrivateReservationOutcomeInTransaction\(/gm,
      ) || []).length,
      1,
  );
  assert.equal(
      (functionsSource.match(
          /return await reversePrivateReservationOutcomeInTransaction\(/g,
      ) || []).length,
      1,
  );
  assert.equal(
      functionsSource.includes(
          "return `reverse_${normalizeId(deductionId)}`;",
      ),
      true,
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
  const runtimeIdentitySource = fs.readFileSync(
      path.join(
          repositoryRoot,
          "functions/scripts/academy-reset-freeze-runtime-identity.mjs",
      ),
      "utf8",
  );
  const combined =
    `${verifierSource}\n${contractSource}\n${runtimeIdentitySource}`;
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
    assert.equal(runtimeIdentitySource.includes(required), true, required);
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

test("permission manifest preserves mandatory 29 plus optional diagnostic", () => {
  assert.equal(PROVIDER_MANDATORY_OPERATION_COUNT, 29);
  assert.equal(PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_COUNT, 1);
  assert.equal(PROVIDER_MANDATORY_OPERATION_IDS.length, 29);
  assert.deepEqual(PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS, [
    "policytroubleshooter.v3.iam.troubleshoot",
  ]);
  assert.equal(
      PROVIDER_MANDATORY_OPERATION_IDS.includes(
          "policytroubleshooter.v3.iam.troubleshoot",
      ),
      false,
  );
  assert.match(
      contractSource,
      /cannot mix optional diagnostics into mandatory evidence/,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.mandatoryOperationCount,
      29,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT
          .optionalDiagnosticOperationCount,
      1,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.requiredIamPermissions
          .includes("storage.objects.get"),
      true,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.requiredIamPermissions
          .includes("storage.objects.getIamPolicy"),
      false,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.conditionalPermissions
          .includes("storage.objects.getIamPolicy"),
      true,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.conditionalPermissions
          .includes("iam.roles.get"),
      true,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.auxiliaryPermissions
          .includes("serviceusage.services.use"),
      true,
  );
  assert.equal(
      EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.oauthScopes
          .includes("https://www.googleapis.com/auth/cloud-platform"),
      true,
  );
});

test("permission integration adds no Production observer or mutation path", () => {
  const combined = `${contractSource}\n${permissionManifestSource}`;
  for (const forbidden of [
    /\bGoogleAuth\s*\(/,
    /\bgetClient\s*\(/,
    /\bAuthorization\s*:/,
    /\bfetch\s*\(/,
    /\bwriteFile(?:Sync)?\s*\(/,
    /\bsetIamPolicy\s*\(/,
    /\bcreateProduction[A-Za-z]*Observer\b/,
    /\bcredentialProvider\s*\(/,
  ]) {
    assert.equal(
        forbidden.test(combined),
        false,
        `Forbidden permission integration capability matched ${forbidden}`,
    );
  }
  for (const forbiddenPath of [
    "functions/package.json",
    "functions/package-lock.json",
    "functions/index.js",
    "firestore.rules",
    "plan-academy-scoped-test-data-reset.mjs",
  ]) {
    assert.equal(
        permissionManifestSource.includes(forbiddenPath),
        false,
        forbiddenPath,
    );
  }
});

test("runbook binds manifest and 29 plus 1 non-proof semantics", () => {
  for (const required of [
    "필수 29개",
    "선택 진단 1개",
    "Policy Troubleshooter",
    "proof 입력이 아니다",
    READONLY_PERMISSION_MANIFEST_VERSION,
    READONLY_PERMISSION_MANIFEST_DIGEST,
    "OAuth scope",
    "IAM permission",
    "noAcl",
    "iam.roles.get",
    "Production observer",
    "actualWrites: 0",
  ]) {
    assert.equal(runbookSource.includes(required), true, required);
  }
});
