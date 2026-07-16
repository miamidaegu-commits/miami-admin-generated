import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {fileURLToPath, pathToFileURL} from "node:url";

import {
  ACADEMY_SCOPED_RESET_REGISTRY,
  ACADEMY_SCOPE_STRATEGIES,
  ALL_ACADEMY_DATA_TEST_PROFILE,
  CREDIT_SOURCE_REFERENCE_MAPPINGS,
  EXPECTED_TARGET_ACADEMY,
  KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION,
  KNOWN_CREDIT_SOURCE_TYPE_CARDINALITY,
  KNOWN_CREDIT_SOURCE_TYPE_KEYS,
  KNOWN_CREDIT_SOURCE_TYPE_TARGETS,
  MEMBERSHIP_CLASSIFICATION_POLICY_VERSION,
  PROFILE_POLICY_VERSION,
  REFERENCE_CARDINALITY_POLICY_VERSION,
  REFERENCE_FIELD_SPECS,
  RESET_CLASSIFICATIONS,
  RESET_REGISTRY_COUNTS,
  STAFF_MEMBERSHIP_ROLES,
  assertCreditSourceAllowlistInvariant,
  assertReferenceCardinalityInvariant,
} from "../functions/scripts/academy-scoped-test-data-reset-registry.mjs";
import {
  CANONICAL_PLAN_SCHEMA,
  PlannerConfigError,
  REDACTED_SUMMARY_SCHEMA,
  SENSITIVE_MANIFEST_RECORD_KEYS,
  SENSITIVE_MANIFEST_SCHEMA,
  assertCanonicalPlanIntegrity,
  assertExactPublicationParity,
  buildAcademyScopedResetPlan,
  buildCanonicalPlanDigest,
  buildCanonicalPlanDigestInput,
  buildReferenceFieldSpecSchemaDigest,
  buildPlannerPublicationSetContract,
  buildRecordSetContract,
  buildRuntimeSourceContract,
  canonicalizeFirestoreValue,
  canonicalizeSensitiveManifestRecord,
  classifyMembershipForTestDataProfile,
  describeReferenceValueShape,
  executePlannerCli,
  findingPublicationIdentityDigest,
  firestoreDocumentDigest,
  getKnownCreditSourceMapping,
  parsePlannerArgs,
  parseReferenceFieldValues,
  publishedFindingRecordDigest,
  recomputeCanonicalPlanPublicationContract,
  recomputeManifestPublicationSetContract,
  recomputeManifestRecordSetContract,
  stableStringify,
  validateOutputPath,
  validateExactOutputSchema,
  validatePlannerOptions,
  writePlannerOutputs,
} from "../functions/scripts/plan-academy-scoped-test-data-reset.mjs";

const PROJECT = "demo-academy-reset-planner";
const ACADEMY = EXPECTED_TARGET_ACADEMY;
const BASE_SHA = "935fe1fca00425a6c5f0b382e721e668e81bde90";
const TREE_SHA = "1234567890abcdef1234567890abcdef12345678";
const REPOSITORY_ROOT = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const CRITICAL_RUNTIME_SOURCE_PATHS = [
  "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
  "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
];

class Timestamp {
  constructor(seconds = 0, nanoseconds = 0) {
    this.seconds = seconds;
    this.nanoseconds = nanoseconds;
  }

  toMillis() {
    return this.seconds * 1000 +
      Math.floor(this.nanoseconds / 1000000);
  }
}

function runtimeSourceIdentity(overrides = {}) {
  return {
    repositoryRoot: REPOSITORY_ROOT,
    runtimeHeadSha: BASE_SHA,
    runtimeTreeSha: TREE_SHA,
    clean: true,
    criticalRuntimeSources: CRITICAL_RUNTIME_SOURCE_PATHS.map(
        (relativePath, index) => ({
          relativePath,
          headBlobOid: String(index + 1).repeat(40),
          headBlobSha256: String(index + 1).repeat(64),
          runtimeSha256: String(index + 1).repeat(64),
          bytesMatch: true,
          tracked: true,
          regularBlob: true,
          indexFlagsClean: true,
        }),
    ),
    ...overrides,
  };
}

function clone(value) {
  if (value === null || typeof value !== "object") return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (Array.isArray(value)) return value.map(clone);
  const copy = Object.create(Object.getPrototypeOf(value));
  for (const [key, nested] of Object.entries(value)) {
    copy[key] = clone(nested);
  }
  return copy;
}

class FakeDocumentSnapshot {
  constructor(id, data) {
    this.id = id;
    this._data = data;
  }

  data() {
    return clone(this._data);
  }
}

class FakeQuery {
  constructor(db, collectionName, cursor = "", pageSize = 100) {
    this.db = db;
    this.collectionName = collectionName;
    this.cursor = cursor;
    this.pageSize = pageSize;
  }

  orderBy(field) {
    assert.equal(field, "__name__");
    return this;
  }

  startAfter(cursor) {
    return new FakeQuery(
        this.db,
        this.collectionName,
        cursor,
        this.pageSize,
    );
  }

  limit(pageSize) {
    return new FakeQuery(
        this.db,
        this.collectionName,
        this.cursor,
        pageSize,
    );
  }

  async get() {
    const behavior = this.db.behavior[this.collectionName] || {};
    const rows = [...(this.db.data[this.collectionName] || [])]
        .sort((a, b) => a.id.localeCompare(b.id))
        .filter(({id}) =>
          behavior.cursorLoop || !this.cursor || id > this.cursor,
        )
        .slice(
            0,
            behavior.pageBoundExceeded ?
              this.pageSize + 1 :
              this.pageSize,
        )
        .map(({id, data}) => new FakeDocumentSnapshot(id, data));
    return {docs: rows, size: rows.length};
  }
}

class FakeFirestore {
  constructor(data = {}, behavior = {}) {
    this.data = clone(data);
    this.behavior = behavior;
    this.listCollectionCount = 0;
  }

  collection(collectionName) {
    return new FakeQuery(this, collectionName);
  }

  async listCollections() {
    this.listCollectionCount += 1;
    if (this.behavior.beforeListCollections) {
      await this.behavior.beforeListCollections({
        db: this,
        callCount: this.listCollectionCount,
      });
    }
    const collections = Object.entries(this.data)
        .filter(([, documents]) => documents.length > 0)
        .map(([id]) => ({id}));
    if (this.behavior.afterListCollections) {
      await this.behavior.afterListCollections({
        db: this,
        callCount: this.listCollectionCount,
        collections,
      });
    }
    return this.behavior.reverseCollectionOrder &&
      this.listCollectionCount % 2 === 0 ?
      collections.reverse() :
      collections;
  }
}

function registryDataset() {
  const result = {};
  for (const item of ACADEMY_SCOPED_RESET_REGISTRY) {
    let id = `${item.collectionName}-target-document`;
    let data = {};
    if (item.academyScopeStrategy ===
        ACADEMY_SCOPE_STRATEGIES.ACADEMY_DOCUMENT_ID) {
      id = ACADEMY;
    } else if (item.academyScopeStrategy !==
        ACADEMY_SCOPE_STRATEGIES.GLOBAL_DOCUMENT) {
      data = {academyId: ACADEMY};
    }
    result[item.collectionName] = [{id, data}];
  }
  return result;
}

function secureTemporaryDirectory() {
  const directory = fs.mkdtempSync(
      path.join(os.tmpdir(), "academy-reset-planner-"),
  );
  fs.chmodSync(directory, 0o700);
  return directory;
}

function securePrivateTemporaryDirectory() {
  const directory = fs.mkdtempSync(
      path.join("/private/tmp", "academy-reset-planner-git-"),
  );
  fs.chmodSync(directory, 0o700);
  return directory;
}

function outputOptions(directory, overrides = {}) {
  return {
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    summaryOutput: path.join(directory, "summary.json"),
    sensitiveOutput: path.join(directory, "sensitive.json"),
    pageSize: 2,
    ...overrides,
  };
}

function gitFixtureEnvironment(overrides = {}) {
  return {
    ...Object.fromEntries(
        Object.entries(process.env)
            .filter(([name]) => !name.startsWith("GIT_")),
    ),
    ...overrides,
  };
}

function runFixtureGit(repositoryRoot, args) {
  return String(execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: gitFixtureEnvironment(),
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

function initializeFixtureRepository(repositoryRoot) {
  runFixtureGit(repositoryRoot, ["init", "--quiet"]);
  runFixtureGit(repositoryRoot, ["add", "--all"]);
  runFixtureGit(repositoryRoot, [
    "-c", "user.name=Planner Test",
    "-c", "user.email=planner-test@example.invalid",
    "commit", "--quiet", "-m", "fixture",
  ]);
  return {
    head: runFixtureGit(repositoryRoot, ["rev-parse", "HEAD"]),
    tree: runFixtureGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
  };
}

function commitFixtureChanges(repositoryRoot, message) {
  runFixtureGit(repositoryRoot, ["add", "--all"]);
  runFixtureGit(repositoryRoot, [
    "-c", "user.name=Planner Test",
    "-c", "user.email=planner-test@example.invalid",
    "commit", "--quiet", "-m", message,
  ]);
  return {
    head: runFixtureGit(repositoryRoot, ["rev-parse", "HEAD"]),
    tree: runFixtureGit(repositoryRoot, ["rev-parse", "HEAD^{tree}"]),
  };
}

function syntheticPlannerRepository({dirty = false} = {}) {
  const repositoryRoot = securePrivateTemporaryDirectory();
  const scriptsDirectory = path.join(repositoryRoot, "functions", "scripts");
  fs.mkdirSync(scriptsDirectory, {recursive: true});
  const plannerSource = path.join(
      REPOSITORY_ROOT,
      "functions",
      "scripts",
      "plan-academy-scoped-test-data-reset.mjs",
  );
  const registrySource = path.join(
      REPOSITORY_ROOT,
      "functions",
      "scripts",
      "academy-scoped-test-data-reset-registry.mjs",
  );
  const plannerPath = path.join(
      scriptsDirectory,
      "plan-academy-scoped-test-data-reset.mjs",
  );
  fs.copyFileSync(plannerSource, plannerPath);
  fs.copyFileSync(
      registrySource,
      path.join(
          scriptsDirectory,
          "academy-scoped-test-data-reset-registry.mjs",
      ),
  );
  const identity = initializeFixtureRepository(repositoryRoot);
  if (dirty) {
    fs.writeFileSync(
        path.join(repositoryRoot, "untracked-dirty-marker.txt"),
        "dirty\n",
        {mode: 0o600},
    );
  }
  return {repositoryRoot, plannerPath, ...identity};
}

function syntheticEmptyRepository() {
  const repositoryRoot = securePrivateTemporaryDirectory();
  fs.writeFileSync(
      path.join(repositoryRoot, "README.md"),
      "clean spoof repository\n",
      {mode: 0o600},
  );
  const identity = initializeFixtureRepository(repositoryRoot);
  return {repositoryRoot, ...identity};
}

function syntheticPlannerWithoutGit() {
  const repositoryRoot = securePrivateTemporaryDirectory();
  const scriptsDirectory = path.join(repositoryRoot, "functions", "scripts");
  fs.mkdirSync(scriptsDirectory, {recursive: true});
  for (const fileName of [
    "plan-academy-scoped-test-data-reset.mjs",
    "academy-scoped-test-data-reset-registry.mjs",
  ]) {
    fs.copyFileSync(
        path.join(REPOSITORY_ROOT, "functions", "scripts", fileName),
        path.join(scriptsDirectory, fileName),
    );
  }
  return {
    repositoryRoot,
    plannerPath: path.join(
        scriptsDirectory,
        "plan-academy-scoped-test-data-reset.mjs",
    ),
  };
}

function syntheticPlannerOutsideRepository() {
  const external = syntheticPlannerWithoutGit();
  const repositoryRoot = securePrivateTemporaryDirectory();
  const scriptsDirectory = path.join(repositoryRoot, "functions", "scripts");
  fs.mkdirSync(scriptsDirectory, {recursive: true});
  const plannerPath = path.join(
      scriptsDirectory,
      "plan-academy-scoped-test-data-reset.mjs",
  );
  fs.symlinkSync(external.plannerPath, plannerPath);
  const identity = initializeFixtureRepository(repositoryRoot);
  return {repositoryRoot, plannerPath, external, ...identity};
}

function executeSyntheticCliProbe({
  plannerPath,
  releaseSha,
  data = {},
  behavior = {},
  gitEnvironment = {},
  resetProfile = "",
  executionEnvironment = {},
  academy = ACADEMY,
}) {
  const outputDirectory = secureTemporaryDirectory();
  const summaryOutput = path.join(outputDirectory, "summary.json");
  const sensitiveOutput = path.join(outputDirectory, "sensitive.json");
  const harness = `
    const clone = (value) => structuredClone(value);
    class Snapshot {
      constructor(id, data) { this.id = id; this.value = data; }
      data() { return clone(this.value); }
    }
    class Query {
      constructor(db, name, cursor = "", pageSize = 100) {
        this.db = db; this.name = name; this.cursor = cursor;
        this.pageSize = pageSize;
      }
      orderBy() { return this; }
      startAfter(cursor) {
        return new Query(this.db, this.name, cursor, this.pageSize);
      }
      limit(pageSize) {
        return new Query(this.db, this.name, this.cursor, pageSize);
      }
      async get() {
        const behavior = this.db.behavior[this.name] || {};
        const docs = [...(this.db.data[this.name] || [])]
          .sort((a, b) => a.id.localeCompare(b.id))
          .filter(({id}) =>
            behavior.cursorLoop || !this.cursor || id > this.cursor)
          .slice(0, behavior.pageBoundExceeded ?
            this.pageSize + 1 : this.pageSize)
          .map(({id, data}) => new Snapshot(id, data));
        return {docs, size: docs.length};
      }
    }
    class Database {
      constructor(data, behavior) {
        this.data = clone(data); this.behavior = behavior;
        this.listCollectionCount = 0;
      }
      collection(name) { return new Query(this, name); }
      async listCollections() {
        this.listCollectionCount += 1;
        const discovery = this.behavior.$rootDiscovery || {};
        if (this.listCollectionCount === discovery.addBeforeCall) {
          this.data[discovery.collectionName] = [{
            id: "late-root-document",
            data: {academyId: "${ACADEMY}"},
          }];
        }
        const collections = Object.entries(this.data)
          .filter(([, documents]) => documents.length > 0)
          .map(([id]) => ({id}));
        if (this.listCollectionCount === discovery.addAfterCall) {
          this.data[discovery.collectionName] = [{
            id: "late-root-document",
            data: {academyId: "${ACADEMY}"},
          }];
        }
        return discovery.reverseOrder &&
          this.listCollectionCount % 2 === 0 ?
          collections.reverse() :
          collections;
      }
    }
    const {executePlannerCli} = await import(process.env.PROBE_PLANNER_URL);
    let databaseInitCount = 0;
    let networkCallCount = 0;
    globalThis.fetch = async () => {
      networkCallCount += 1;
      throw new Error("network_forbidden_in_planner_probe");
    };
    const stdout = [];
    const stderr = [];
    const exitCode = await executePlannerCli({
      argv: JSON.parse(process.env.PROBE_ARGV),
      env: {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        ...JSON.parse(process.env.PROBE_EXECUTION_ENV),
      },
      dbFactory: async () => {
        databaseInitCount += 1;
        return {
          db: new Database(
            JSON.parse(process.env.PROBE_DATA),
            JSON.parse(process.env.PROBE_BEHAVIOR),
          ),
          cleanup: async () => {},
        };
      },
      stdout: (line) => stdout.push(line),
      stderr: (line) => stderr.push(line),
    });
    console.log(JSON.stringify({
      exitCode,
      databaseInitCount,
      networkCallCount,
      stdout,
      stderr,
    }));
  `;
  const argv = [
    "--project", PROJECT,
    "--academy", academy,
    "--release-sha", releaseSha,
    "--summary-output", summaryOutput,
    "--sensitive-output", sensitiveOutput,
    "--page-size", "2",
  ];
  if (resetProfile) {
    argv.push("--reset-profile", resetProfile);
  }
  const rendered = execFileSync(
      process.execPath,
      ["--input-type=module", "--eval", harness],
      {
        encoding: "utf8",
        env: gitFixtureEnvironment({
          PROBE_PLANNER_URL: pathToFileURL(plannerPath).href,
          PROBE_ARGV: JSON.stringify(argv),
          PROBE_DATA: JSON.stringify(data),
          PROBE_BEHAVIOR: JSON.stringify(behavior),
          PROBE_EXECUTION_ENV: JSON.stringify(executionEnvironment),
          ...gitEnvironment,
        }),
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      },
  );
  return {
    ...JSON.parse(rendered.trim()),
    summaryOutput,
    sensitiveOutput,
    summary: fs.existsSync(summaryOutput) ?
      JSON.parse(fs.readFileSync(summaryOutput, "utf8")) :
      null,
    manifest: fs.existsSync(sensitiveOutput) ?
      JSON.parse(fs.readFileSync(sensitiveOutput, "utf8")) :
      null,
  };
}

async function planDataset(data, overrides = {}) {
  return buildAcademyScopedResetPlan({
    db: new FakeFirestore(data),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
    ...overrides,
  });
}

function profileDataset() {
  const data = registryDataset();
  data.academyMemberships[0].data = {
    academyId: ACADEMY,
    role: "owner",
    status: "active",
    permissions: {},
  };
  data.accountProvisioningLogs[0].data = {
    academyId: ACADEMY,
  };
  return data;
}

function testProfileOptions(overrides = {}) {
  return {
    resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
    operatorTestDataConfirmation: true,
    fullBackupWaiverConfirmed: true,
    ...overrides,
  };
}

test("registry has exact classifications and required metadata", () => {
  assert.equal(ACADEMY_SCOPED_RESET_REGISTRY.length, 29);
  assert.equal(
      RESET_REGISTRY_COUNTS[
          RESET_CLASSIFICATIONS.RESET_ALL_ACADEMY_SCOPED
      ],
      24,
  );
  assert.equal(
      RESET_REGISTRY_COUNTS[
          RESET_CLASSIFICATIONS.RESET_WITH_PRESERVE_FILTER
      ],
      3,
  );
  assert.equal(
      RESET_REGISTRY_COUNTS[
          RESET_CLASSIFICATIONS.ARCHIVE_OR_RETAIN
      ],
      1,
  );
  assert.equal(
      RESET_REGISTRY_COUNTS[
          RESET_CLASSIFICATIONS.GLOBAL_NEVER_RESET
      ],
      1,
  );
  for (const item of ACADEMY_SCOPED_RESET_REGISTRY) {
    assert.equal(typeof item.collectionName, "string");
    assert.equal(typeof item.classification, "string");
    assert.equal(typeof item.academyScopeStrategy, "string");
    assert.equal(typeof item.preserveReason, "string");
    assert.ok(Array.isArray(item.referenceExtractors));
    assert.equal(
        Number.isSafeInteger(item.expectedDeletionOrderGroup),
        true,
    );
    assert.equal(
        Number.isSafeInteger(item.profileResetDeletionOrderGroup),
        true,
    );
    assert.equal(typeof item.containsPotentialPII, "boolean");
    assert.equal(typeof item.plannerDisposition, "string");
  }
});

test("CLI rejects unknown and mutation flags", () => {
  for (const flag of ["write", "commit", "delete", "execute"]) {
    assert.throws(
        () => parsePlannerArgs([`--${flag}`, "YES"]),
        PlannerConfigError,
    );
  }
  assert.throws(
      () => parsePlannerArgs(["--unexpected", "value"]),
      PlannerConfigError,
  );
  assert.throws(
      () => parsePlannerArgs(["positional"]),
      PlannerConfigError,
  );
});

test("CLI parses strict read-only planner options", () => {
  const parsed = parsePlannerArgs([
    "--project", PROJECT,
    "--academy", ACADEMY,
    "--release-sha", BASE_SHA,
    "--summary-output", "/secure/summary.json",
    "--sensitive-output=/secure/sensitive.json",
    "--page-size", "25",
  ]);
  assert.deepEqual(parsed, {
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    summaryOutput: "/secure/summary.json",
    sensitiveOutput: "/secure/sensitive.json",
    resetProfile: "",
    pageSize: 25,
  });
});

test("test-data reset profile is exact and confirmation-gated", () => {
  const parsed = parsePlannerArgs([
    "--project", PROJECT,
    "--academy", ACADEMY,
    "--release-sha", BASE_SHA,
    "--summary-output", "/secure/summary.json",
    "--sensitive-output", "/secure/sensitive.json",
    "--reset-profile", ALL_ACADEMY_DATA_TEST_PROFILE,
  ]);
  assert.equal(parsed.resetProfile, ALL_ACADEMY_DATA_TEST_PROFILE);

  const directory = secureTemporaryDirectory();
  const options = outputOptions(directory, {
    resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
  });
  assert.throws(
      () => validatePlannerOptions(options, {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
      }),
      /test_data_confirmation_required/,
  );
  assert.throws(
      () => validatePlannerOptions(options, {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
      }),
      /full_backup_waiver_confirmation_required/,
  );
  assert.throws(
      () => validatePlannerOptions(options, {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
      }),
      /test_data_confirmation_required/,
  );
  const validated = validatePlannerOptions(options, {
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
    CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
  });
  assert.equal(validated.operatorTestDataConfirmation, true);
  assert.equal(validated.fullBackupWaiverConfirmed, true);
  for (const invalidValue of ["yes", "true", "1", "YES ", " YES", ""]) {
    assert.throws(
        () => validatePlannerOptions(options, {
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
          CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
          CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: invalidValue,
        }),
        /full_backup_waiver_confirmation_required/,
    );
    assert.throws(
        () => validatePlannerOptions(options, {
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
          CONFIRM_ALL_ACADEMY_DATA_IS_TEST: invalidValue,
          CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
        }),
        /test_data_confirmation_required/,
    );
  }
  for (const confirmationEnvironment of [
    {CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES"},
    {CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES"},
    {
      CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
      CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
    },
  ]) {
    assert.throws(
        () => validatePlannerOptions({
          ...options,
          resetProfile: "",
        }, {
          FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
          ...confirmationEnvironment,
        }),
        /confirmation_without_reset_profile/,
    );
  }
  assert.throws(
      () => validatePlannerOptions({
        ...options,
        resetProfile: "all_academy_data_test_v2",
      }, {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
        CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
      }),
      /unsupported_reset_profile/,
  );
  assert.throws(
      () => validatePlannerOptions({
        ...options,
        academy: "academy_other",
      }, {
        FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
        CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
        CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
      }),
      /--academy must be exactly/,
  );
});

test("membership profile uses exact role and conflict evidence", () => {
  assert.deepEqual(STAFF_MEMBERSHIP_ROLES, [
    "admin",
    "owner",
    "staff",
    "teacher",
  ]);
  for (const role of STAFF_MEMBERSHIP_ROLES) {
    const decision = classifyMembershipForTestDataProfile({
      role,
      status: "active",
      uid: "staff-uid",
    });
    assert.equal(decision.decision, "preserve_staff_membership");
  }
  const studentWithPrincipal = classifyMembershipForTestDataProfile({
    role: "student",
    status: "active",
    studentId: "student-id",
    uid: "student-auth-uid",
    permissions: {},
  });
  assert.equal(studentWithPrincipal.decision, "reset_test_membership");
  assert.equal(studentWithPrincipal.membershipPrincipalPresent, true);
  assert.equal(studentWithPrincipal.teacherIdentityPresent, false);

  const studentUidOnly = classifyMembershipForTestDataProfile({
    role: "student",
    status: "active",
    uid: "student-auth-uid",
    permissions: {},
  });
  assert.equal(studentUidOnly.decision, "ambiguous_membership");
  assert.equal(studentUidOnly.roleStatus, "student");
  assert.equal(studentUidOnly.teacherIdentityPresent, false);

  const matchingTeacherIdentity = classifyMembershipForTestDataProfile({
    role: "teacher",
    status: "active",
    uid: "teacher-auth-uid",
    teacherUid: "teacher-auth-uid",
  });
  assert.equal(
      matchingTeacherIdentity.decision,
      "preserve_staff_membership",
  );
  assert.equal(matchingTeacherIdentity.teacherIdentityPresent, true);

  const crossNamespaceTeacherIdentity = classifyMembershipForTestDataProfile({
    role: "teacher",
    status: "active",
    uid: "auth-uid",
    teacherId: "teacher-document-id",
  });
  assert.equal(
      crossNamespaceTeacherIdentity.decision,
      "preserve_staff_membership",
  );
  assert.equal(
      crossNamespaceTeacherIdentity.blockerReasons.includes(
          "membership_role_identity_conflict",
      ),
      false,
  );

  for (const rawRole of [
    " Student ",
    "student ",
    "STUDENT",
    "",
    null,
    undefined,
    "future_role",
  ]) {
    const data = {
      status: "active",
      studentId: "student-id",
      uid: "student-auth-uid",
    };
    if (rawRole !== undefined) data.role = rawRole;
    const decision = classifyMembershipForTestDataProfile(data);
    assert.equal(decision.decision, "ambiguous_membership");
    assert.equal(
        decision.blockerReasons.includes("invalid_membership_role_literal"),
        true,
    );
  }

  for (const rawStatus of [
    "ACTIVE",
    " active ",
    "Inactive",
    "inactive",
    "disabled",
    "",
    null,
    undefined,
  ]) {
    const data = {
      role: "student",
      studentId: "student-id",
      uid: "student-auth-uid",
    };
    if (rawStatus !== undefined) data.status = rawStatus;
    const decision = classifyMembershipForTestDataProfile(data);
    assert.equal(decision.decision, "ambiguous_membership");
    assert.equal(
        decision.blockerReasons.includes("invalid_membership_status_literal"),
        true,
    );
  }

  for (const data of [
    {},
    {role: "future_role"},
    {role: "student", teacherKey: "teacher-key"},
    {role: "student", teacherUid: "teacher-uid"},
    {role: "student", teacherId: 42},
    {role: "student", permissions: {canAddStudent: true}},
    {role: "student", status: "active"},
    {role: "student", studentId: "student-id"},
    {role: "owner", permissions: ["unexpected"]},
    {role: "owner", status: "future"},
    {role: "owner", active: true},
    {
      role: "student",
      active: true,
      studentId: "student-id",
      permissions: {},
    },
    {
      role: "teacher",
      status: "active",
      uid: "uid-a",
      teacherUid: "teacher-uid-a",
      teacherUID: "teacher-uid-b",
    },
    {
      role: "teacher",
      status: "active",
      uid: "uid-a",
      teacherUid: "uid-b",
    },
    {role: "teacher", status: "active", uid: {unexpected: true}},
    {
      role: "teacher",
      status: "active",
      uid: "uid-a",
      teacherId: "teacher-a",
      teacherID: "teacher-b",
    },
    {
      role: "teacher",
      status: "active",
      uid: "uid-a",
      teacherKey: ["key-a", "key-b"],
    },
  ]) {
    assert.equal(
        classifyMembershipForTestDataProfile(data).decision,
        "ambiguous_membership",
    );
  }
  const staffPointer = classifyMembershipForTestDataProfile({
    role: "owner",
    status: "active",
    studentId: "student-pointer",
  });
  assert.equal(staffPointer.decision, "preserve_staff_membership");
  assert.equal(staffPointer.preservedPointerCleanupRequired, true);
  assert.equal(
      classifyMembershipForTestDataProfile({
        role: "student",
        status: "active",
        studentId: "student-id",
        teacherName: "display-name-only",
      }).decision,
      "reset_test_membership",
  );
});

test("reference shape descriptors contain no raw values", () => {
  const cases = [
    [undefined, false, "missing"],
    [null, true, "null"],
    ["", true, "empty_string"],
    ["value", true, "string"],
    [1, true, "number"],
    [false, true, "boolean"],
    [[], true, "array_empty"],
    [["a", "b"], true, "array_strings"],
    [["a", 1], true, "array_mixed"],
    [{id: "not-exposed"}, true, "object"],
    [1n, true, "other"],
  ];
  cases.forEach(([value, present, expected]) => {
    assert.equal(describeReferenceValueShape(value, present), expected);
  });
});

test("output guards reject relative, repository, symlink, and overwrite", () => {
  const directory = secureTemporaryDirectory();
  assert.throws(
      () => validateOutputPath("relative.json", "Output"),
      PlannerConfigError,
  );
  assert.throws(
      () => validateOutputPath(
          path.resolve(
              "functions",
              "scripts",
              "forbidden-reset-plan.json",
          ),
          "Output",
      ),
      PlannerConfigError,
  );
  const existing = path.join(directory, "existing.json");
  fs.writeFileSync(existing, "{}");
  assert.throws(
      () => validateOutputPath(existing, "Output"),
      PlannerConfigError,
  );
  const realParent = path.join(directory, "real");
  const linkedParent = path.join(directory, "linked");
  fs.mkdirSync(realParent, {mode: 0o700});
  fs.symlinkSync(realParent, linkedParent);
  assert.throws(
      () => validateOutputPath(
          path.join(linkedParent, "output.json"),
          "Output",
      ),
      PlannerConfigError,
  );
});

test("planner completes stable double scan with exact registry counts", async () => {
  const result = await buildAcademyScopedResetPlan({
    db: new FakeFirestore(registryDataset()),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 1,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.completedRuns, 2);
  assert.equal(result.summary.consistency, true);
  assert.equal(result.summary.runtimeHeadSha, BASE_SHA);
  assert.equal(result.summary.runtimeTreeSha, TREE_SHA);
  assert.equal(result.summary.criticalRuntimeSources.length, 2);
  assert.deepEqual(
      result.summary.criticalRuntimeSources.map(({relativePath}) =>
        relativePath,
      ),
      CRITICAL_RUNTIME_SOURCE_PATHS,
  );
  result.summary.criticalRuntimeSources.forEach((source) => {
    assert.equal(source.bytesMatch, true);
    assert.equal(source.tracked, true);
    assert.equal(source.indexFlagsClean, true);
    assert.equal(source.headBlobSha256, source.runtimeSha256);
  });
  assert.equal(result.summary.totals.resetCandidates, 24);
  assert.equal(result.summary.totals.preserved, 4);
  assert.equal(result.summary.totals.retained, 1);
  assert.equal(result.summary.totals.unknownBlockers, 0);
  assert.equal(result.summary.planned.creates, 0);
  assert.equal(result.summary.planned.updates, 0);
  assert.equal(result.summary.planned.deletes, 24);
  assert.equal(result.summary.actualWrites, 0);
  assert.equal(result.summary.writeAuthorized, false);
  assert.equal(result.summary.executorImplemented, false);
  assert.equal(
      result.summary.planClassification,
      "non_executable_advisory",
  );
  assert.equal(result.summary.executionSafetyContractVersion, 1);
  assert.equal(result.summary.snapshotMode, "live_read_only_unfrozen");
  assert.equal(
      result.summary.writeFreezeRequiredForExecution,
      true,
  );
  assert.equal(result.summary.writeFreezeVerified, false);
  assert.equal(result.summary.freshPlanRequiredUnderWriteFreeze, true);
  assert.equal(
      result.summary.executorRevalidationRequired,
      true,
  );
  assert.equal(result.summary.executionEligible, false);
  assert.equal(result.manifest.records.length, 29);
});

test("plan digest binds deterministic critical source metadata", async () => {
  const data = registryDataset();
  const first = await planDataset(data);
  const changedCriticalSources =
    runtimeSourceIdentity().criticalRuntimeSources.map(
        (source, index) => ({
          ...source,
          headBlobSha256: String(index + 7).repeat(64),
          runtimeSha256: String(index + 7).repeat(64),
        }),
    );
  const second = await planDataset(data, {
    runtimeSourceIdentity: runtimeSourceIdentity({
      criticalRuntimeSources: changedCriticalSources,
    }),
  });
  assert.notEqual(first.summary.planDigest, second.summary.planDigest);
  assert.deepEqual(
      second.summary.criticalRuntimeSources,
      [...changedCriticalSources].sort((left, right) =>
        left.relativePath.localeCompare(right.relativePath),
      ),
  );
  assert.equal(
      JSON.stringify(second.summary).includes(
          runtimeSourceIdentity().repositoryRoot,
      ),
      false,
  );
});

test("other academy documents are scanned but never reset", async () => {
  const data = registryDataset();
  data.lessons.push({
    id: "other-academy-lesson",
    data: {academyId: "academy_other"},
  });
  const result = await buildAcademyScopedResetPlan({
    db: new FakeFirestore(data),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.collections.lessons.scanned, 2);
  assert.equal(result.summary.collections.lessons.reset, 1);
  assert.equal(result.summary.collections.lessons.preserved, 1);
});

test("unknown academy and global collections fail closed", async () => {
  for (const unknownData of [
    {academyId: ACADEMY},
    {globalSetting: true},
  ]) {
    const data = registryDataset();
    data.unregisteredCollection = [{
      id: "unknown-document",
      data: unknownData,
    }];
    const result = await buildAcademyScopedResetPlan({
      db: new FakeFirestore(data),
      project: PROJECT,
      academy: ACADEMY,
      releaseSha: BASE_SHA,
      runtimeSourceIdentity: runtimeSourceIdentity(),
      pageSize: 2,
    });
    assert.equal(result.exitCode, 2);
    assert.equal(
        result.summary.runtimeDiscovery.unknownCollectionCount,
        1,
    );
    assert.ok(result.summary.totals.unknownBlockers > 0);
    assert.equal(result.summary.writeAuthorized, false);
  }
});

test("malformed academy scope fails closed without guessing", async () => {
  for (const academyId of [
    undefined,
    "",
    " ",
    ` ${ACADEMY}`,
    `${ACADEMY} `,
    `\t${ACADEMY}`,
    `${ACADEMY}\n`,
    null,
    1,
    true,
    [ACADEMY],
    {value: ACADEMY},
  ]) {
    const data = registryDataset();
    data.lessons[0].data = academyId === undefined ?
      {subject: "scope missing"} :
      {academyId};
    const result = await buildAcademyScopedResetPlan({
      db: new FakeFirestore(data),
      project: PROJECT,
      academy: ACADEMY,
      releaseSha: BASE_SHA,
      runtimeSourceIdentity: runtimeSourceIdentity(),
      pageSize: 2,
    });
    const record = result.secondRun.records.find(
        ({collection}) => collection === "lessons",
    );
    assert.equal(result.exitCode, 2);
    assert.equal(result.summary.collections.lessons.unknown, 1);
    assert.equal(result.summary.collections.lessons.reset, 0);
    assert.equal(record.scope, "malformed");
    assert.equal(record.disposition, "unknown");
    assert.equal(record.academyScopeEvidence.exactAcademyMatch, false);
  }
});

test("cross-academy and preserved-to-reset references are blockers", async () => {
  const cases = [
    {
      prepare(data) {
        data.lessons[0].data.packageId = "other-package";
        data.studentPackages.push({
          id: "other-package",
          data: {academyId: "academy_other"},
        });
      },
      countKey: "crossAcademyReferences",
    },
    {
      prepare(data) {
        data.academyMemberships[0].data.studentId =
          data.privateStudents[0].id;
      },
      countKey: "preservedReferenceWarnings",
    },
  ];
  for (const item of cases) {
    const data = registryDataset();
    item.prepare(data);
    const result = await buildAcademyScopedResetPlan({
      db: new FakeFirestore(data),
      project: PROJECT,
      academy: ACADEMY,
      releaseSha: BASE_SHA,
      runtimeSourceIdentity: runtimeSourceIdentity(),
      pageSize: 2,
    });
    assert.equal(result.exitCode, 2);
    assert.ok(result.summary.totals[item.countKey] > 0);
  }
});

test("internal missing reset references are diagnostic-only", async () => {
  const data = registryDataset();
  data.lessons[0].data.reservationId = "missing-reservation";
  data.privateLessonReservations[0].data.lessonId = "missing-lesson";
  data.privateLessonSlots[0].data.reservationId = "missing-reservation";
  const result = await buildAcademyScopedResetPlan({
    db: new FakeFirestore(data),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.totals.resetCandidates, 24);
  assert.equal(result.summary.planned.deletes, 24);
  assert.equal(result.summary.verdict, "complete");
  assert.ok(result.summary.totals.referenceDiagnosticCount >= 3);
  assert.equal(result.summary.totals.referenceBlockerCount, 0);
  assert.equal(result.secondRun.referenceFindings.blockers.length, 0);
});

test("invalid and ambiguous typed references fail closed", async () => {
  const cases = [
    {
      prepare(data) {
        data.lessons[0].data.packageId = "invalid/reference/id";
      },
      code: "invalid_reference_identifier",
    },
    {
      prepare(data) {
        data.lessons[0].data.fixedPrivateAssignmentBatchId =
          "ambiguous-batch";
        data.fixedPrivateAssignmentBatches.push({
          id: "ambiguous-batch",
          data: {academyId: ACADEMY},
        });
        data.fixedPrivateRenewalBatches.push({
          id: "ambiguous-batch",
          data: {academyId: ACADEMY},
        });
      },
      code: "ambiguous_reference",
    },
  ];
  for (const item of cases) {
    const data = registryDataset();
    item.prepare(data);
    const result = await buildAcademyScopedResetPlan({
      db: new FakeFirestore(data),
      project: PROJECT,
      academy: ACADEMY,
      releaseSha: BASE_SHA,
      runtimeSourceIdentity: runtimeSourceIdentity(),
      pageSize: 2,
    });
    assert.equal(result.exitCode, 2);
    assert.equal(result.summary.executionEligible, false);
    assert.equal(result.summary.writeFreezeVerified, false);
    assert.equal(result.summary.writeAuthorized, false);
    assert.equal(result.summary.actualWrites, 0);
    assert.doesNotThrow(() => assertExactPublicationParity(
        result.canonicalPlan,
        result.summary,
        result.manifest,
    ));
    assert.ok(result.summary.totals.referenceBlockerCount > 0);
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code}) => code === item.code,
        ),
        true,
    );
  }
});

test("existing reset links warn while reset-to-preserved links do not block", async () => {
  const data = registryDataset();
  data.lessons[0].data.reservationId =
    data.privateLessonReservations[0].id;
  data.privateLessonAvailabilityTemplates[0].data.teacherId =
    data.teachers[0].id;
  const result = await planDataset(data);
  assert.equal(result.exitCode, 0);
  assert.ok(result.summary.totals.referenceWarningCount >= 2);
  assert.equal(result.summary.totals.referenceBlockerCount, 0);
  assert.equal(
      result.secondRun.referenceFindings.warnings.some(
          ({code}) => code === "reset_internal_reference",
      ),
      true,
  );
  assert.equal(
      result.secondRun.referenceFindings.warnings.some(
          ({code}) =>
            code === "reset_candidate_references_preserved_document",
      ),
      true,
  );
});

test("account provisioning retained references enforce preservation policy", async () => {
  const safeData = registryDataset();
  safeData.accountProvisioningLogs[0].data = {
    academyId: ACADEMY,
    teacherId: safeData.teachers[0].id,
    membershipId: safeData.academyMemberships[0].id,
    uid: safeData.users[0].id,
  };
  const safeResult = await planDataset(safeData);
  assert.equal(safeResult.exitCode, 0);
  assert.equal(safeResult.summary.totals.retained, 1);

  const blockedData = registryDataset();
  blockedData.accountProvisioningLogs[0].data.studentId =
    blockedData.privateStudents[0].id;
  const blockedResult = await planDataset(blockedData);
  assert.equal(blockedResult.exitCode, 2);
  assert.equal(
      blockedResult.secondRun.referenceFindings.blockers.some(
          ({code}) =>
            code === "preserved_document_references_reset_candidate",
      ),
      true,
  );

  const malformedData = registryDataset();
  malformedData.accountProvisioningLogs[0].data.studentId = {unknown: true};
  const malformedResult = await planDataset(malformedData);
  assert.equal(malformedResult.exitCode, 2);
  assert.equal(
      malformedResult.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "malformed_reference_field",
      ),
      true,
  );
});

test("provisioning teacher aliases resolve semantically and fail closed", async () => {
  const consistentData = registryDataset();
  const teacherId = consistentData.teachers[0].id;
  consistentData.teachers[0].data.teacherKey = "teacher-key-a";
  consistentData.teachers[0].data.uid = consistentData.users[0].id;
  for (const logData of [
    {academyId: ACADEMY, teacherId},
    {academyId: ACADEMY, teacherID: teacherId},
    {academyId: ACADEMY, teacherKey: "teacher-key-a"},
    {academyId: ACADEMY, teacherUid: consistentData.users[0].id},
    {academyId: ACADEMY, teacherUID: consistentData.users[0].id},
    {academyId: ACADEMY, teacherId, teacherKey: "teacher-key-a"},
    {academyId: ACADEMY, teacherId, teacherID: teacherId},
    {academyId: ACADEMY, uid: consistentData.users[0].id},
  ]) {
    const data = clone(consistentData);
    data.accountProvisioningLogs[0].data = logData;
    const result = await planDataset(data);
    assert.equal(result.exitCode, 0);
  }

  const conflictData = clone(consistentData);
  conflictData.teachers.push({
    id: "second-teacher",
    data: {academyId: ACADEMY, teacherKey: "teacher-key-b"},
  });
  conflictData.accountProvisioningLogs[0].data = {
    academyId: ACADEMY,
    teacherId,
    teacherKey: "teacher-key-b",
  };
  let result = await planDataset(conflictData);
  assert.equal(result.exitCode, 2);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "conflicting_teacher_identity_targets",
      ),
      true,
  );

  const idAliasConflictData = clone(consistentData);
  idAliasConflictData.accountProvisioningLogs[0].data = {
    academyId: ACADEMY,
    teacherId,
    teacherID: "second-teacher",
  };
  result = await planDataset(idAliasConflictData);
  assert.equal(result.exitCode, 2);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "conflicting_teacher_id_alias",
      ),
      true,
  );

  for (const [field, value, expectedCodes] of [
    ["teacherKey", {unexpected: true}, ["malformed_reference_field"]],
    ["teacherKey", "unresolved-key", ["unresolved_teacher_identity"]],
    ["teacherUid", "unresolved-uid", ["unresolved_teacher_identity"]],
    ["teacher", "legacy-display-value", ["unresolved_provisioning_identity"]],
    ["teacher", {unexpected: true}, ["malformed_reference_field"]],
  ]) {
    const data = clone(consistentData);
    data.accountProvisioningLogs[0].data = {
      academyId: ACADEMY,
      [field]: value,
    };
    result = await planDataset(data);
    assert.equal(result.exitCode, 2);
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code}) => expectedCodes.includes(code),
        ),
        true,
        `${field}:${JSON.stringify(value)}`,
    );
  }

  const profileData = profileDataset();
  profileData.teachers[0].data.teacherKey = "profile-teacher";
  profileData.accountProvisioningLogs[0].data.teacherKey = "profile-teacher";
  result = await planDataset(profileData, testProfileOptions());
  assert.equal(result.summary.collections.accountProvisioningLogs.reset, 1);
  assert.equal(result.summary.totals.referenceBlockerCount, 0);
});

test("provisioning mixed student and teacher identities fail closed", async () => {
  const base = profileDataset();
  const studentId = base.privateStudents[0].id;
  const teacherId = base.teachers[0].id;
  base.teachers[0].data.teacherKey = "teacher-key-a";
  base.teachers[0].data.uid = base.users[0].id;
  for (const logData of [
    {academyId: ACADEMY, studentId},
    {academyId: ACADEMY, teacherId},
    {academyId: ACADEMY, teacherKey: "teacher-key-a"},
    {academyId: ACADEMY, teacherUid: base.users[0].id},
    {academyId: ACADEMY, uid: base.users[0].id},
  ]) {
    const data = clone(base);
    data.accountProvisioningLogs[0].data = logData;
    const result = await planDataset(data, testProfileOptions());
    assert.equal(result.exitCode, 0);
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code}) => code === "mixed_provisioning_identity",
        ),
        false,
    );
  }
  for (const logData of [
    {academyId: ACADEMY, studentId, teacherId},
    {academyId: ACADEMY, studentId, teacherKey: "teacher-key-a"},
    {academyId: ACADEMY, studentId, teacherUid: base.users[0].id},
    {
      academyId: ACADEMY,
      provisioningType: "student",
      studentId,
      teacherId,
    },
    {
      academyId: ACADEMY,
      provisioningType: "teacher",
      studentId,
      teacherId,
    },
  ]) {
    const data = clone(base);
    data.accountProvisioningLogs[0].data = logData;
    const result = await planDataset(data, testProfileOptions());
    assert.equal(result.summary.collections.accountProvisioningLogs.reset, 1);
    assert.equal(result.exitCode, 2);
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code}) => code === "mixed_provisioning_identity",
        ),
        true,
    );
  }
});

test("provisioning scalar studentId and membershipId reject arrays", async () => {
  const base = profileDataset();
  const scalarCases = [
    ["studentId", base.privateStudents[0].id],
    ["membershipId", base.academyMemberships[0].id],
  ];
  for (const [field, validValue] of scalarCases) {
    for (const value of [validValue]) {
      const data = clone(base);
      data.accountProvisioningLogs[0].data = {
        academyId: ACADEMY,
        [field]: value,
      };
      const result = await planDataset(data, testProfileOptions());
      assert.equal(result.exitCode, 0, `${field}:valid_string`);
    }
    const missingData = clone(base);
    missingData.accountProvisioningLogs[0].data = {academyId: ACADEMY};
    assert.equal(
        (await planDataset(missingData, testProfileOptions())).exitCode,
        0,
        `${field}:missing`,
    );
    for (const [shape, value] of [
      ["null", null],
      ["empty_string", ""],
      ["array_empty", []],
      ["array_one", [validValue]],
      ["array_multiple", [validValue, `${validValue}-other`]],
      ["array_mixed", [validValue, 7]],
      ["object", {id: validValue}],
      ["number", 7],
      ["boolean", true],
    ]) {
      const data = clone(base);
      data.accountProvisioningLogs[0].data = {
        academyId: ACADEMY,
        [field]: value,
      };
      const result = await planDataset(data, testProfileOptions());
      assert.equal(result.exitCode, 2, `${field}:${shape}`);
      assert.equal(
          result.secondRun.referenceFindings.blockers.some(
              ({code}) => code === "malformed_reference_field",
          ),
          true,
          `${field}:${shape}`,
      );
    }
  }
});

test("privateLessonSlots separates scalar and array student references", async () => {
  const base = registryDataset();
  const studentId = base.privateStudents[0].id;
  const slotId = base.privateLessonSlots[0].id;

  let data = clone(base);
  data.privateLessonSlots[0].data.studentId = studentId;
  let result = await planDataset(data);
  let slotRecord = result.secondRun.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey === `privateLessonSlots:${slotId}`,
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
      slotRecord.references.filter(({field}) => field === "studentId")
          .map(({documentId}) => documentId),
      [studentId],
  );

  for (const [shape, value] of [
    ["array_one", [studentId]],
    ["array_multiple", [studentId, `${studentId}-other`]],
    ["object", {id: studentId}],
    ["number", 7],
    ["boolean", true],
  ]) {
    data = clone(base);
    data.privateLessonSlots[0].data.studentId = value;
    result = await planDataset(data);
    slotRecord = result.secondRun.records.find(
        ({typedDocumentKey}) =>
          typedDocumentKey === `privateLessonSlots:${slotId}`,
    );
    assert.equal(result.exitCode, 2, shape);
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code, field}) =>
              code === "malformed_reference_field" &&
              field === "studentId",
        ),
        true,
        shape,
    );
    assert.equal(
        slotRecord.references.some(({field}) => field === "studentId"),
        false,
        shape,
    );
  }

  const secondStudentId = "privateStudents-second-target";
  data = clone(base);
  data.privateStudents.push({
    id: secondStudentId,
    data: {academyId: ACADEMY},
  });
  data.privateLessonSlots[0].data.eligibleStudentIds = [
    studentId,
    secondStudentId,
    studentId,
  ];
  result = await planDataset(data);
  slotRecord = result.secondRun.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey === `privateLessonSlots:${slotId}`,
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
      slotRecord.references
          .filter(({field}) => field === "eligibleStudentIds")
          .map(({documentId}) => documentId)
          .sort(),
      [secondStudentId, studentId].sort(),
  );

  data = clone(base);
  data.privateLessonSlots[0].data.eligibleStudentIds = studentId;
  result = await planDataset(data);
  assert.equal(result.exitCode, 2);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code, field}) =>
            code === "malformed_reference_field" &&
            field === "eligibleStudentIds",
      ),
      true,
  );
  for (const value of [
    [studentId, 7],
    [{id: studentId}],
    [true],
  ]) {
    data = clone(base);
    data.privateLessonSlots[0].data.eligibleStudentIds = value;
    result = await planDataset(data);
    assert.equal(result.exitCode, 2);
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code, field}) =>
              code === "malformed_reference_element" &&
              field === "eligibleStudentIds",
        ),
        true,
    );
  }

  data = clone(base);
  data.privateLessonSlots[0].data.studentId = studentId;
  data.privateLessonSlots[0].data.eligibleStudentIds = [studentId];
  result = await planDataset(data);
  slotRecord = result.secondRun.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey === `privateLessonSlots:${slotId}`,
  );
  assert.equal(result.exitCode, 0);
  assert.deepEqual(
      slotRecord.references
          .filter(({documentId}) => documentId === studentId)
          .map(({field}) => field)
          .sort(),
      ["eligibleStudentIds", "studentId"],
  );
});

test("test profile resets student memberships and provisioning logs only", async () => {
  const data = profileDataset();
  data.academyMemberships.push({
    id: "student-membership",
    data: {
      academyId: ACADEMY,
      role: "student",
      status: "active",
      studentId: data.privateStudents[0].id,
      uid: data.users[0].id,
      permissions: {},
    },
  });
  data.accountProvisioningLogs[0].data.studentId =
    data.privateStudents[0].id;
  const result = await planDataset(data, testProfileOptions());
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.resetProfile, ALL_ACADEMY_DATA_TEST_PROFILE);
  assert.equal(result.summary.operatorTestDataConfirmation, true);
  assert.equal(result.summary.fullBackupWaiverConfirmed, true);
  assert.equal(result.summary.profilePolicyVersion, PROFILE_POLICY_VERSION);
  assert.equal(
      result.summary.membershipClassificationPolicyVersion,
      MEMBERSHIP_CLASSIFICATION_POLICY_VERSION,
  );
  assert.equal(
      result.summary.knownCreditSourceAllowlistVersion,
      KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION,
  );
  assert.equal(result.summary.provisioningLogPolicy, "archive_then_reset");
  assert.equal(
      result.summary.provisioningLogPolicyReason,
      "archive_then_reset_under_operator_backup_waiver",
  );
  assert.equal(result.summary.backupPolicy, "operator_waived_full_backup");
  assert.equal(result.summary.dataRecoveryAvailable, false);
  assert.equal(result.summary.managedExportRequired, false);
  assert.equal(result.summary.managedFirestoreExportRequired, false);
  assert.equal(
      result.summary.irreversibleExecutorConfirmationName,
      "CONFIRM_IRREVERSIBLE_TEST_DATA_RESET",
  );
  assert.equal(result.summary.exactPlanDigestRequired, true);
  assert.equal(result.summary.exactDeleteCountRequired, true);
  assert.equal(result.summary.backupVerified, false);
  assert.equal(result.summary.resetApproved, false);
  assert.equal(result.summary.independentReviewApproved, false);
  assert.equal(result.summary.membershipProfile.preservedStaffMembershipCount, 1);
  assert.equal(result.summary.membershipProfile.resetTestMembershipCount, 1);
  assert.equal(result.summary.membershipProfile.ambiguousMembershipCount, 0);
  assert.equal(result.summary.totals.resetCandidates, 26);
  assert.equal(result.summary.totals.retained, 0);
  assert.equal(result.summary.collections.accountProvisioningLogs.reset, 1);
  assert.equal(result.summary.collections.academyMemberships.reset, 1);
  assert.equal(result.summary.collections.academyMemberships.preserved, 1);
  assert.equal(result.summary.collections.users.reset, 0);
  assert.equal(result.summary.collections.academies.reset, 0);
  assert.equal(result.summary.actualWrites, 0);
  assert.equal(result.summary.writeAuthorized, false);
  assert.equal(result.summary.executorImplemented, false);
  assert.equal(result.manifest.backupPolicy, "operator_waived_full_backup");
  assert.equal(result.manifest.fullBackupWaiverConfirmed, true);
  assert.equal(result.manifest.managedExportRequired, false);
  assert.equal(result.manifest.writeAuthorized, false);
});

test("backup policy remains conservative by default and binds the digest", async () => {
  const data = profileDataset();
  const conservative = await planDataset(data);
  const waived = await planDataset(data, testProfileOptions());
  assert.equal(
      conservative.summary.backupPolicy,
      "managed_firestore_export_required",
  );
  assert.equal(conservative.summary.managedExportRequired, true);
  assert.equal(
      conservative.summary.managedFirestoreExportRequired,
      true,
  );
  assert.equal(conservative.summary.fullBackupWaiverConfirmed, false);
  assert.equal(waived.summary.backupPolicy, "operator_waived_full_backup");
  assert.notEqual(conservative.summary.planDigest, waived.summary.planDigest);
  for (const result of [conservative, waived]) {
    assert.equal(result.summary.writeAuthorized, false);
    assert.equal(result.summary.actualWrites, 0);
    assert.equal(result.summary.executorImplemented, false);
    assert.equal(
        result.summary.minimumSafetySnapshotsRequired.teacherMappingSnapshot,
        true,
    );
    assert.equal(
        result.summary.irreversibleExecutorConfirmationRequired,
        true,
    );
  }
});

test("summary and manifest share one canonical backup contract", async () => {
  const results = [
    await planDataset(profileDataset()),
    await planDataset(profileDataset(), testProfileOptions()),
  ];
  const parityFields = [
    "planVersion",
    "resetProfile",
    "firestoreValueCanonicalizationVersion",
    "profilePolicyVersion",
    "operatorTestDataConfirmation",
    "backupPolicy",
    "fullBackupWaiverConfirmed",
    "dataRecoveryAvailable",
    "managedExportRequired",
    "managedFirestoreExportRequired",
    "minimumSafetySnapshotsRequired",
    "irreversibleExecutorConfirmationRequired",
    "irreversibleExecutorConfirmationName",
    "irreversibleExecutorConfirmationValue",
    "exactPlanDigestRequired",
    "exactDeleteCountRequired",
    "backupVerified",
    "resetApproved",
    "independentReviewApproved",
    "writeAuthorized",
    "executorImplemented",
    "actualWrites",
  ];
  for (const result of results) {
    assert.doesNotThrow(() =>
      assertExactPublicationParity(
          result.canonicalPlan,
          result.summary,
          result.manifest,
      ));
    for (const field of parityFields) {
      assert.deepEqual(result.summary[field], result.manifest[field], field);
    }
    assert.equal(
        result.summary.planDigest,
        result.manifest.planDigest,
    );
    assert.deepEqual(
        result.summary.publicationContract,
        result.manifest.publicationContract,
    );
  }
  const assertPublishRejected = (
      summary,
      manifest,
      label,
      canonicalPlan = baseline.canonicalPlan,
  ) => {
    const directory = secureTemporaryDirectory();
    const summaryOutput = path.join(directory, `${label}-summary.json`);
    const sensitiveOutput = path.join(directory, `${label}-sensitive.json`);
    assert.throws(() => assertExactPublicationParity(
        canonicalPlan,
        summary,
        manifest,
    ));
    assert.throws(() => writePlannerOutputs({
      summaryOutput,
      sensitiveOutput,
      canonicalPlan,
      summary,
      manifest,
    }));
    assert.equal(canonicalPlan.actualWrites, 0);
    assert.equal(fs.existsSync(summaryOutput), false);
    assert.equal(fs.existsSync(sensitiveOutput), false);
    assert.deepEqual(fs.readdirSync(directory), []);
  };
  const baseline = results[1];
  const tamperedCases = [
    {
      label: "summary-complete",
      mutate(summary) {
        summary.complete = false;
      },
    },
    {
      label: "summary-plan-version",
      mutate(summary) {
        summary.planVersion = 999;
      },
    },
    {
      label: "manifest-plan-version",
      mutate(summary, manifest) {
        manifest.planVersion = 999;
      },
    },
    {
      label: "coherent-plan-version",
      mutate(summary, manifest) {
        summary.planVersion = 999;
        manifest.planVersion = 999;
      },
    },
    {
      label: "summary-verdict",
      mutate(summary) {
        summary.verdict = "incomplete";
      },
    },
    {
      label: "summary-exit-code",
      mutate(summary) {
        summary.exitCode = 3;
      },
    },
    {
      label: "summary-consistency",
      mutate(summary) {
        summary.consistency = false;
      },
    },
    {
      label: "summary-completed-runs",
      mutate(summary) {
        summary.completedRuns = 1;
      },
    },
    {
      label: "summary-state-version",
      mutate(summary) {
        summary.publicationStateContractVersion = 999;
      },
    },
    {
      label: "summary-firestore-canonicalization-version",
      mutate(summary) {
        summary.firestoreValueCanonicalizationVersion = 999;
      },
    },
    {
      label: "manifest-firestore-canonicalization-version",
      mutate(summary, manifest) {
        manifest.firestoreValueCanonicalizationVersion = 999;
      },
    },
    {
      label: "coherent-firestore-canonicalization-version",
      mutate(summary, manifest) {
        summary.firestoreValueCanonicalizationVersion = 999;
        manifest.firestoreValueCanonicalizationVersion = 999;
      },
    },
    {
      label: "manifest-state-version",
      mutate(summary, manifest) {
        manifest.publicationStateContractVersion = 999;
      },
    },
    {
      label: "summary-manifest-state-version",
      mutate(summary, manifest) {
        for (const output of [summary, manifest]) {
          output.publicationStateContractVersion = 999;
          output.publicationStateContract.publicationStateContractVersion =
            999;
        }
      },
    },
    {
      label: "summary-count",
      mutate(summary) {
        summary.totals.resetCandidates += 1;
      },
    },
    {
      label: "manifest-policy",
      mutate(summary, manifest) {
        manifest.backupPolicy = "tampered";
      },
    },
    {
      label: "plan-digest",
      mutate(summary, manifest) {
        manifest.planDigest = "0".repeat(64);
      },
    },
    {
      label: "candidate-count",
      mutate(summary, manifest) {
        const index = manifest.records.findIndex(
            ({plannerDisposition}) => plannerDisposition === "reset",
        );
        manifest.records.splice(index, 1);
      },
    },
    {
      label: "finding-count",
      mutate(summary, manifest) {
        manifest.referenceFindings.warnings.push({
          code: "tampered",
        });
      },
    },
  ];
  for (const {label, mutate} of tamperedCases) {
    const summary = clone(baseline.summary);
    const manifest = clone(baseline.manifest);
    mutate(summary, manifest);
    assertPublishRejected(summary, manifest, label);
  }
  for (const [label, value] of [
    ["missing", undefined],
    ["null", null],
    ["string", "1"],
    ["zero", 0],
    ["unsupported", 2],
  ]) {
    const summary = clone(baseline.summary);
    if (value === undefined) {
      delete summary.publicationStateContractVersion;
    } else {
      summary.publicationStateContractVersion = value;
    }
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        `summary-state-version-${label}`,
    );
  }
  assert.equal(baseline.summary.publicationStateContractVersion, 1);
  assert.equal(baseline.manifest.publicationStateContractVersion, 1);
  assert.equal(baseline.canonicalPlan.publicationStateContractVersion, 1);
  for (const [label, value] of [
    ["missing", undefined],
    ["null", null],
    ["string", "2"],
    ["zero", 0],
    ["old", 1],
    ["unsupported", 999],
  ]) {
    const summary = clone(baseline.summary);
    if (value === undefined) delete summary.planVersion;
    else summary.planVersion = value;
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        `plan-version-${label}`,
    );
  }
  assert.equal(baseline.summary.planVersion, 2);
  assert.equal(baseline.manifest.planVersion, 2);
  assert.equal(baseline.canonicalPlan.planVersion, 2);
  for (const [label, value] of [
    ["missing", undefined],
    ["null", null],
    ["string", "2"],
    ["unsupported", 999],
  ]) {
    const summary = clone(baseline.summary);
    if (value === undefined) {
      delete summary.firestoreValueCanonicalizationVersion;
    } else {
      summary.firestoreValueCanonicalizationVersion = value;
    }
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        `firestore-canonicalization-version-${label}`,
    );
  }
  assert.equal(baseline.summary.firestoreValueCanonicalizationVersion, 3);
  assert.equal(baseline.manifest.firestoreValueCanonicalizationVersion, 3);
  assert.equal(
      baseline.canonicalPlan.firestoreValueCanonicalizationVersion,
      3,
  );
  for (const [field, value] of [
    ["executionSafetyContractVersion", 999],
    ["planClassification", "executable_plan"],
    ["snapshotMode", "frozen_executable"],
    ["writeFreezeRequiredForExecution", false],
    ["writeFreezeVerified", true],
    ["freshPlanRequiredUnderWriteFreeze", false],
    ["executorRevalidationRequired", false],
    ["executionEligible", true],
    ["executorImplemented", true],
    ["writeAuthorized", true],
    ["actualWrites", 1],
  ]) {
    const summary = clone(baseline.summary);
    summary[field] = value;
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        `execution-safety-${field}`,
    );
  }
  for (const field of Object.keys(
      baseline.summary.executionSafetyContract,
  )) {
    const summary = clone(baseline.summary);
    delete summary[field];
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        `execution-safety-missing-${field}`,
    );
  }
  for (const value of [null, "1", 0]) {
    const summary = clone(baseline.summary);
    summary.executionSafetyContractVersion = value;
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        `execution-safety-version-${String(value)}`,
    );
  }
  const coherentExecutionSummary = clone(baseline.summary);
  const coherentExecutionManifest = clone(baseline.manifest);
  const coherentWrongExecutionContract = {
    executionSafetyContractVersion: 999,
    planClassification: "executable_plan",
    snapshotMode: "frozen_executable",
    writeFreezeRequiredForExecution: false,
    writeFreezeVerified: true,
    freshPlanRequiredUnderWriteFreeze: false,
    executorRevalidationRequired: false,
    executionEligible: true,
    executorImplemented: true,
    writeAuthorized: true,
    actualWrites: 0,
  };
  for (const output of [
    coherentExecutionSummary,
    coherentExecutionManifest,
  ]) {
    Object.assign(output, coherentWrongExecutionContract);
    output.executionSafetyContract =
      clone(coherentWrongExecutionContract);
    Object.assign(
        output.publicationContract.policy,
        coherentWrongExecutionContract,
    );
    output.publicationContract.policy.executionSafetyContract =
      clone(coherentWrongExecutionContract);
  }
  assertPublishRejected(
      coherentExecutionSummary,
      coherentExecutionManifest,
      "coherent-execution-safety",
  );

  const coherentStateSummary = clone(baseline.summary);
  const coherentStateManifest = clone(baseline.manifest);
  const coherentWrongState = {
    ...baseline.summary.publicationStateContract,
    complete: false,
    verdict: "incomplete",
    exitCode: 3,
    consistency: false,
  };
  for (const output of [coherentStateSummary, coherentStateManifest]) {
    Object.assign(output, coherentWrongState);
    output.publicationStateContract = clone(coherentWrongState);
    output.publicationContract.publicationStateContract =
      clone(coherentWrongState);
    output.publicationContract.consistency = false;
  }
  assert.equal(
      coherentStateSummary.planDigest,
      baseline.canonicalPlan.planDigest,
  );
  assertPublishRejected(
      coherentStateSummary,
      coherentStateManifest,
      "coherent-publication-state-stale-plan",
  );

  const blockedData = registryDataset();
  blockedData.lessons[0].data.packageId = "other-package";
  blockedData.studentPackages.push({
    id: "other-package",
    data: {academyId: "academy_other"},
  });
  const blockedAdvisory = await planDataset(blockedData);
  assert.equal(blockedAdvisory.exitCode, 2);
  assert.equal(blockedAdvisory.summary.executionEligible, false);
  assert.equal(blockedAdvisory.summary.writeFreezeVerified, false);
  assert.equal(blockedAdvisory.summary.writeAuthorized, false);
  assert.equal(blockedAdvisory.summary.actualWrites, 0);
  const blockedPublishDirectory = secureTemporaryDirectory();
  const blockedSummary =
    path.join(blockedPublishDirectory, "summary.json");
  const blockedSensitive =
    path.join(blockedPublishDirectory, "sensitive.json");
  assert.doesNotThrow(() => writePlannerOutputs({
    summaryOutput: blockedSummary,
    sensitiveOutput: blockedSensitive,
    canonicalPlan: blockedAdvisory.canonicalPlan,
    summary: blockedAdvisory.summary,
    manifest: blockedAdvisory.manifest,
  }));
  assert.equal(fs.existsSync(blockedSummary), true);
  assert.equal(fs.existsSync(blockedSensitive), true);

  const normalDirectory = secureTemporaryDirectory();
  const normalSummary = path.join(normalDirectory, "summary.json");
  const normalSensitive = path.join(normalDirectory, "sensitive.json");
  writePlannerOutputs({
    summaryOutput: normalSummary,
    sensitiveOutput: normalSensitive,
    canonicalPlan: baseline.canonicalPlan,
    summary: baseline.summary,
    manifest: baseline.manifest,
  });
  assert.equal(fs.existsSync(normalSummary), true);
  assert.equal(fs.existsSync(normalSensitive), true);

  const partialDirectory = secureTemporaryDirectory();
  const partialSummary = path.join(partialDirectory, "summary.json");
  const partialSensitive = path.join(partialDirectory, "sensitive.json");
  let linkCallCount = 0;
  assert.throws(() => writePlannerOutputs({
    summaryOutput: partialSummary,
    sensitiveOutput: partialSensitive,
    canonicalPlan: baseline.canonicalPlan,
    summary: baseline.summary,
    manifest: baseline.manifest,
    linkFile(temporaryPath, finalPath) {
      linkCallCount += 1;
      if (linkCallCount === 2) {
        throw new Error("simulated_second_publication_failure");
      }
      fs.linkSync(temporaryPath, finalPath);
    },
  }), /simulated_second_publication_failure/);
  assert.equal(fs.existsSync(partialSummary), false);
  assert.equal(fs.existsSync(partialSensitive), false);
  assert.deepEqual(fs.readdirSync(partialDirectory), []);

  const replaceRecordIdentity = (manifest, disposition, suffix) => {
    const record = manifest.records.find((candidate) =>
      candidate.plannerDisposition === disposition);
    assert.ok(record, `missing ${disposition} fixture record`);
    record.typedDocumentKey = `${record.collection}:${suffix}`;
    record.rawDocumentPath = `${record.collection}/${suffix}`;
    record.documentDigest = "f".repeat(64);
  };
  for (const [source, disposition, suffix] of [
    [baseline, "preserve", "same-count-preserve-swap"],
    [results[0], "retain", "same-count-retain-swap"],
    [baseline, "global_preserve", "same-count-global-swap"],
  ]) {
    const manifest = clone(source.manifest);
    replaceRecordIdentity(manifest, disposition, suffix);
    assertPublishRejected(
        clone(source.summary),
        manifest,
        `record-${disposition}-same-count-swap`,
        source.canonicalPlan,
    );
  }
  for (const [source, disposition, replacement, classification] of [
    [
      baseline,
      "preserve",
      "reset",
      RESET_CLASSIFICATIONS.RESET_ALL_ACADEMY_SCOPED,
    ],
    [
      results[0],
      "retain",
      "preserve",
      RESET_CLASSIFICATIONS.RESET_WITH_PRESERVE_FILTER,
    ],
    [
      baseline,
      "global_preserve",
      "preserve",
      RESET_CLASSIFICATIONS.RESET_WITH_PRESERVE_FILTER,
    ],
  ]) {
    const manifest = clone(source.manifest);
    const record = manifest.records.find((candidate) =>
      candidate.plannerDisposition === disposition);
    assert.ok(record);
    record.plannerDisposition = replacement;
    record.classification = classification;
    assertPublishRejected(
        clone(source.summary),
        manifest,
        `record-${disposition}-classification-mutation`,
        source.canonicalPlan,
    );
  }
  {
    const manifest = clone(baseline.manifest);
    const preserveRecord = manifest.records.find((record) =>
      record.plannerDisposition === "preserve");
    assert.ok(preserveRecord);
    preserveRecord.plannerDisposition = "retain";
    assertPublishRejected(
        clone(baseline.summary),
        manifest,
        "record-same-key-disposition-mutation",
    );
  }
  {
    const manifest = clone(baseline.manifest);
    manifest.records[1] = clone(manifest.records[0]);
    assertPublishRejected(
        clone(baseline.summary),
        manifest,
        "record-duplicate-with-compensating-removal",
    );
  }
  for (const [label, mutate] of [
    ["record-remove", (records) => records.pop()],
    ["record-add", (records) => records.push(clone(records[0]))],
  ]) {
    const manifest = clone(baseline.manifest);
    mutate(manifest.records);
    assertPublishRejected(clone(baseline.summary), manifest, label);
  }
  {
    const reorderedManifest = clone(baseline.manifest);
    reorderedManifest.records.reverse();
    assert.deepEqual(
        recomputeManifestRecordSetContract(reorderedManifest),
        baseline.manifest.recordSetContract,
    );
    assert.doesNotThrow(() => assertExactPublicationParity(
        baseline.canonicalPlan,
        clone(baseline.summary),
        reorderedManifest,
    ));
  }
  {
    const summary = clone(baseline.summary);
    summary.recordSetDigest = "f".repeat(64);
    summary.recordSetContract.recordSetDigest = "f".repeat(64);
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        "record-claimed-digest",
    );
  }
  assert.equal(baseline.manifest.recordSetContractVersion, 2);
  assert.equal(baseline.manifest.recordSetDigestVersion, 2);
  const actualManifestRecordKeys = [...new Set(
      baseline.manifest.records.flatMap((record) => Object.keys(record)),
  )].sort();
  assert.deepEqual(
      actualManifestRecordKeys,
      [...SENSITIVE_MANIFEST_RECORD_KEYS].sort(),
  );
  for (const record of baseline.manifest.records) {
    assert.deepEqual(
        Object.keys(canonicalizeSensitiveManifestRecord(record)).sort(),
        Object.keys(record).sort(),
    );
  }
  const assertRecordMutationRejected = (label, mutate) => {
    const manifest = clone(baseline.manifest);
    mutate(manifest);
    assertPublishRejected(clone(baseline.summary), manifest, label);
  };
  for (const [label, mutate] of [
    ["record-raw-path-other-collection", (record) => {
      record.rawDocumentPath = `forged/${record.rawDocumentPath.split("/")[1]}`;
    }],
    ["record-raw-path-other-id", (record) => {
      record.rawDocumentPath = `${record.collection}/forged-document`;
    }],
    ["record-raw-path-whitespace", (record) => {
      record.rawDocumentPath = ` ${record.rawDocumentPath}`;
    }],
    ["record-raw-path-missing", (record) => {
      delete record.rawDocumentPath;
    }],
    ["record-raw-path-type", (record) => {
      record.rawDocumentPath = ["forged", "path"];
    }],
    ["record-unknown-field", (record) => {
      record.unboundField = "forged";
    }],
    ["record-required-field-missing", (record) => {
      delete record.classification;
    }],
  ]) {
    assertRecordMutationRejected(label, (manifest) =>
      mutate(manifest.records[0]));
  }
  const referenceData = registryDataset();
  referenceData.lessons[0].data.packageId =
    referenceData.studentPackages[0].id;
  referenceData.lessons[0].data.reservationId =
    referenceData.privateLessonReservations[0].id;
  referenceData.lessons[0].data.fixedPrivateAssignmentBatchId =
    "multi-target-batch";
  referenceData.fixedPrivateAssignmentBatches.push({
    id: "multi-target-batch",
    data: {academyId: ACADEMY},
  });
  referenceData.fixedPrivateRenewalBatches.push({
    id: "multi-target-batch",
    data: {academyId: ACADEMY},
  });
  referenceData.privateLessonSlots[0].data.studentId =
    referenceData.privateStudents[0].id;
  referenceData.privateLessonSlots[0].data.reservationId =
    referenceData.privateLessonReservations[0].id;
  const referenceBaseline = await planDataset(referenceData);
  const recordWithReferences = referenceBaseline.manifest.records.find(
      ({directReferences}) => directReferences.length > 0,
  );
  const recordWithMultipleReferences =
    referenceBaseline.manifest.records.find(
      ({directReferences}) => directReferences.length > 1,
    );
  assert.ok(recordWithReferences);
  assert.ok(recordWithMultipleReferences);
  const mutateReference = (manifest, mutate) => {
    const record = manifest.records.find(
        ({typedDocumentKey: key}) =>
          key === recordWithReferences.typedDocumentKey,
    );
    mutate(record.directReferences);
  };
  const assertReferenceMutationRejected = (label, mutate) => {
    const manifest = clone(referenceBaseline.manifest);
    mutateReference(manifest, mutate);
    assertPublishRejected(
        clone(referenceBaseline.summary),
        manifest,
        label,
        referenceBaseline.canonicalPlan,
    );
  };
  const forgedReference = {
    family: "forged",
    field: "forged",
    candidateTypedKeys: ["users:forged"],
    targetCollections: ["users"],
    lookup: "document_id",
  };
  for (const [label, mutate] of [
    ["direct-reference-forged", (references) => {
      references.push(clone(forgedReference));
    }],
    ["direct-reference-removed", (references) => {
      references.pop();
    }],
    ["direct-reference-target-swap", (references) => {
      references[0].candidateTypedKeys = ["users:forged"];
    }],
    ["direct-reference-field", (references) => {
      references[0].field = "forgedField";
    }],
    ["direct-reference-kind", (references) => {
      references[0].lookup = "forged_lookup";
    }],
    ["direct-reference-state", (references) => {
      references[0].conflict = references[0].conflict !== true;
    }],
  ]) {
    assertReferenceMutationRejected(label, mutate);
  }
  {
    const manifest = clone(referenceBaseline.manifest);
    const record = manifest.records.find(
        ({typedDocumentKey: key}) =>
          key === recordWithMultipleReferences.typedDocumentKey,
    );
    record.directReferences[1] =
      clone(record.directReferences[0]);
    assertPublishRejected(
        clone(referenceBaseline.summary),
        manifest,
      "direct-reference-duplicate-compensating-removal",
        referenceBaseline.canonicalPlan,
    );
  }
  {
    const reorderedManifest = clone(referenceBaseline.manifest);
    const record = reorderedManifest.records.find(
        ({typedDocumentKey: key}) =>
          key === recordWithMultipleReferences.typedDocumentKey,
    );
    record.directReferences.reverse();
    assert.deepEqual(
        recomputeManifestRecordSetContract(reorderedManifest),
        referenceBaseline.manifest.recordSetContract,
    );
    assert.doesNotThrow(() => assertExactPublicationParity(
        referenceBaseline.canonicalPlan,
        clone(referenceBaseline.summary),
        reorderedManifest,
    ));
  }
  {
    const reorderedManifest = clone(referenceBaseline.manifest);
    const reorderable = reorderedManifest.records
        .flatMap(({directReferences}) => directReferences)
        .find((reference) =>
          reference.candidateTypedKeys.length > 1 ||
          reference.targetCollections.length > 1);
    assert.ok(reorderable);
    reorderable.candidateTypedKeys.reverse();
    reorderable.targetCollections.reverse();
    assert.deepEqual(
        recomputeManifestRecordSetContract(reorderedManifest),
        referenceBaseline.manifest.recordSetContract,
    );
    assert.doesNotThrow(() => assertExactPublicationParity(
        referenceBaseline.canonicalPlan,
        clone(referenceBaseline.summary),
        reorderedManifest,
    ));
  }
  {
    const manifest = clone(referenceBaseline.manifest);
    mutateReference(manifest, (references) => {
      references.push(clone(forgedReference));
    });
    const tamperedContract =
      recomputeManifestRecordSetContract(manifest);
    const summary = clone(referenceBaseline.summary);
    const applyClaimedRecordContract = (output) => {
      output.recordSetContract = clone(tamperedContract);
      Object.assign(output, tamperedContract);
      output.publicationContract.recordSetContract =
        clone(tamperedContract);
    };
    applyClaimedRecordContract(summary);
    applyClaimedRecordContract(manifest);
    assertPublishRejected(
        summary,
        manifest,
        "coherent-sensitive-record-contract-tamper",
        referenceBaseline.canonicalPlan,
    );
  }
  for (const value of [undefined, 1, "2", 3]) {
    const summary = clone(baseline.summary);
    if (value === undefined) {
      delete summary.recordSetContractVersion;
    } else {
      summary.recordSetContractVersion = value;
    }
    assertPublishRejected(
        summary,
        clone(baseline.manifest),
        `record-contract-version-${String(value)}`,
    );
  }
  {
    const staleCanonicalPlan = clone(baseline.canonicalPlan);
    const staleRecord = staleCanonicalPlan.recordInputs[0];
    const documentId = "canonical-forged-document";
    staleRecord.rawDocumentPath =
      `${staleRecord.collection}/${documentId}`;
    staleRecord.typedDocumentKey =
      `${staleRecord.collection}:${documentId}`;
    staleCanonicalPlan.recordSetContract =
      buildRecordSetContract(staleCanonicalPlan.recordInputs);
    staleCanonicalPlan.publicationContract.recordSetContract =
      clone(staleCanonicalPlan.recordSetContract);
    assert.notEqual(
        buildCanonicalPlanDigest(staleCanonicalPlan),
        staleCanonicalPlan.planDigest,
    );
    assert.throws(
        () => assertCanonicalPlanIntegrity(staleCanonicalPlan),
        /Canonical plan .*stale/,
    );
    assertPublishRejected(
        clone(baseline.summary),
        clone(baseline.manifest),
        "canonical-sensitive-record-stale-digest",
        staleCanonicalPlan,
    );
  }
  assert.doesNotThrow(() => assertExactPublicationParity(
      baseline.canonicalPlan,
      JSON.parse(JSON.stringify(baseline.summary)),
      JSON.parse(JSON.stringify(baseline.manifest)),
  ));

  const candidateSwapSummary = clone(baseline.summary);
  const candidateSwapManifest = clone(baseline.manifest);
  const candidateIndex = candidateSwapManifest.records.findIndex(
      ({plannerDisposition}) => plannerDisposition === "reset",
  );
  candidateSwapManifest.records[candidateIndex].typedDocumentKey =
    "dailyMaterials:same-count-candidate-swap";
  assertPublishRejected(
      candidateSwapSummary,
      candidateSwapManifest,
      "candidate-same-count-swap",
  );

  const candidateMetadataSummary = clone(baseline.summary);
  const candidateMetadataManifest = clone(baseline.manifest);
  candidateMetadataManifest.records[candidateIndex].deletionOrderGroup += 1;
  assertPublishRejected(
      candidateMetadataSummary,
      candidateMetadataManifest,
      "candidate-metadata-mutation",
  );

  const duplicateCandidateSummary = clone(baseline.summary);
  const duplicateCandidateManifest = clone(baseline.manifest);
  const candidateIndexes = duplicateCandidateManifest.records
      .map((record, index) => ({record, index}))
      .filter(({record}) => record.plannerDisposition === "reset")
      .map(({index}) => index);
  assert.ok(candidateIndexes.length >= 2);
  const firstCandidate =
    duplicateCandidateManifest.records[candidateIndexes[0]];
  const replacedCandidate =
    duplicateCandidateManifest.records[candidateIndexes[1]];
  for (const field of [
    "typedDocumentKey",
    "collection",
    "classification",
    "deletionOrderGroup",
    "plannerDisposition",
    "academyScopeEvidence",
  ]) {
    replacedCandidate[field] = clone(firstCandidate[field]);
  }
  assertPublishRejected(
      duplicateCandidateSummary,
      duplicateCandidateManifest,
      "candidate-duplicate-compensating-removal",
  );

  const reorderedCandidatesManifest = clone(baseline.manifest);
  reorderedCandidatesManifest.records.reverse();
  assert.doesNotThrow(() => assertExactPublicationParity(
      baseline.canonicalPlan,
      baseline.summary,
      reorderedCandidatesManifest,
  ));
  assert.deepEqual(
      recomputeManifestPublicationSetContract(reorderedCandidatesManifest),
      baseline.summary.publicationSetContract,
  );

  const findingData = registryDataset();
  findingData.privateLessonSlots[0].data.reservationId =
    {unexpected: true};
  findingData.privateLessonSlots[0].data.reservedStudentId =
    {unexpected: true};
  const findingResult = await planDataset(findingData);
  const findingBaseline = findingResult.manifest;
  assert.equal(findingResult.exitCode, 2);
  assert.equal(findingResult.summary.complete, true);
  assert.equal(findingResult.summary.verdict, "blocked");
  assert.ok(findingBaseline.referenceFindings.blockers.length >= 2);
  assert.ok(findingBaseline.blockers.length >= 2);
  const refreshPublishedFindingDigests = (finding) => {
    finding.findingIdentityDigest =
      findingPublicationIdentityDigest(finding);
    finding.findingDigest = finding.findingIdentityDigest;
    finding.publishedFindingDigest =
      publishedFindingRecordDigest(finding);
  };
  const assertManifestBlockerTamperRejected = (label, mutate) => {
    const manifest = clone(findingBaseline);
    const referenceFindingsBefore =
      stableStringify(manifest.referenceFindings);
    mutate(manifest.blockers);
    assert.equal(
        stableStringify(manifest.referenceFindings),
        referenceFindingsBefore,
        `${label} must mutate only manifest.blockers`,
    );
    assertPublishRejected(
        clone(findingResult.summary),
        manifest,
        label,
        findingResult.canonicalPlan,
    );
  };
  for (const [label, mutate] of [
    ["manifest-blocker-code", (finding) => {
      finding.code = `${finding.code}_tampered`;
    }],
    ["manifest-blocker-severity", (finding) => {
      finding.severity = "warning";
    }],
    ["manifest-blocker-field", (finding) => {
      finding.field = "tamperedField";
    }],
    ["manifest-blocker-target", (finding) => {
      finding.targetTypedKeys = [
        ...(finding.targetTypedKeys || []),
        "privateStudents:tampered-target",
      ];
    }],
    ["manifest-blocker-policy-reason", (finding) => {
      finding.policyReason = "tampered policy reason";
    }],
    ["manifest-blocker-expected-shape", (finding) => {
      finding.expectedShape = "tampered_expected_shape";
    }],
    ["manifest-blocker-evidence", (finding) => {
      finding.shapeEvidence = {
        ...(finding.shapeEvidence || {}),
        actualShape: "tampered_shape",
      };
    }],
  ]) {
    assertManifestBlockerTamperRejected(label, (blockers) => {
      mutate(blockers[0]);
      refreshPublishedFindingDigests(blockers[0]);
    });
  }

  assertManifestBlockerTamperRejected(
      "manifest-blocker-same-count-swap",
      (blockers) => {
        blockers[0].code = `${blockers[0].code}_replacement`;
        refreshPublishedFindingDigests(blockers[0]);
      },
  );
  assertManifestBlockerTamperRejected(
      "manifest-blocker-missing",
      (blockers) => blockers.pop(),
  );
  assertManifestBlockerTamperRejected(
      "manifest-blocker-extra",
      (blockers) => {
        const extra = clone(blockers[0]);
        extra.code = `${extra.code}_extra`;
        refreshPublishedFindingDigests(extra);
        blockers.push(extra);
      },
  );
  assertManifestBlockerTamperRejected(
      "manifest-blocker-duplicate-compensating-removal",
      (blockers) => {
        blockers[1] = clone(blockers[0]);
      },
  );

  const coherentBlockerManifest = clone(findingBaseline);
  for (const finding of [
    coherentBlockerManifest.blockers[0],
    coherentBlockerManifest.referenceFindings.blockers[0],
  ]) {
    finding.code = `${finding.code}_coherent_tamper`;
    refreshPublishedFindingDigests(finding);
  }
  assertPublishRejected(
      clone(findingResult.summary),
      coherentBlockerManifest,
      "manifest-blocker-coherent-reference-tamper",
      findingResult.canonicalPlan,
  );

  const reorderedBlockerManifest = clone(findingBaseline);
  reorderedBlockerManifest.blockers.reverse();
  reorderedBlockerManifest.referenceFindings.blockers.reverse();
  for (const finding of [
    ...reorderedBlockerManifest.blockers,
    ...reorderedBlockerManifest.referenceFindings.blockers,
  ]) {
    finding.targetTypedKeys.reverse();
  }
  assert.doesNotThrow(() => assertExactPublicationParity(
      findingResult.canonicalPlan,
      findingResult.summary,
      reorderedBlockerManifest,
  ));
  assert.doesNotThrow(() => assertExactPublicationParity(
      findingResult.canonicalPlan,
      JSON.parse(JSON.stringify(findingResult.summary)),
      JSON.parse(JSON.stringify(findingBaseline)),
  ));

  const blockedDirectory = secureTemporaryDirectory();
  const blockedSummaryOutput =
    path.join(blockedDirectory, "blocked-summary.json");
  const blockedSensitiveOutput =
    path.join(blockedDirectory, "blocked-sensitive.json");
  assert.doesNotThrow(() => writePlannerOutputs({
    summaryOutput: blockedSummaryOutput,
    sensitiveOutput: blockedSensitiveOutput,
    canonicalPlan: findingResult.canonicalPlan,
    summary: findingResult.summary,
    manifest: findingResult.manifest,
  }));
  assert.equal(fs.statSync(blockedSummaryOutput).mode & 0o777, 0o600);
  assert.equal(fs.statSync(blockedSensitiveOutput).mode & 0o777, 0o600);
  const recordFindingBaseline = findingBaseline.records.find(
      ({referenceFindings}) => referenceFindings.length >= 2,
  );
  assert.ok(recordFindingBaseline);

  for (const [label, mutate] of [
    ["record-finding-code", (finding) => {
      finding.code = `${finding.code}_tampered`;
    }],
    ["record-finding-severity", (finding) => {
      finding.severity = "warning";
    }],
    ["record-finding-field", (finding) => {
      finding.field = "tamperedField";
    }],
    ["record-finding-target", (finding) => {
      finding.targetTypedKeys = [
        ...(finding.targetTypedKeys || []),
        "privateStudents:tampered-target",
      ];
    }],
    ["record-finding-policy-reason", (finding) => {
      finding.policyReason = "tampered policy reason";
    }],
    ["record-finding-expected-shape", (finding) => {
      finding.expectedShape = "tampered_expected_shape";
    }],
    ["record-finding-shape", (finding) => {
      finding.shapeEvidence = {
        ...(finding.shapeEvidence || {}),
        actualShape: "tampered_shape",
      };
    }],
    ["record-finding-shape-type", (finding) => {
      finding.shapeEvidence = {
        ...(finding.shapeEvidence || {}),
        type: "tampered_type",
      };
    }],
  ]) {
    const manifest = clone(findingBaseline);
    const record = manifest.records.find(
        ({typedDocumentKey}) =>
          typedDocumentKey === recordFindingBaseline.typedDocumentKey,
    );
    mutate(record.referenceFindings[0]);
    record.referenceFindings[0].findingIdentityDigest =
      findingPublicationIdentityDigest({
        ...record.referenceFindings[0],
        sourceTypedKey: record.typedDocumentKey,
      });
    assertPublishRejected(
        clone(findingResult.summary),
        manifest,
        label,
        findingResult.canonicalPlan,
    );
  }

  const movedRecordFindingManifest = clone(findingBaseline);
  const movedSource = movedRecordFindingManifest.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey === recordFindingBaseline.typedDocumentKey,
  );
  const movedTarget = movedRecordFindingManifest.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey !== recordFindingBaseline.typedDocumentKey,
  );
  const movedFinding = movedSource.referenceFindings.shift();
  movedFinding.findingIdentityDigest = findingPublicationIdentityDigest({
    ...movedFinding,
    sourceTypedKey: movedTarget.typedDocumentKey,
  });
  movedTarget.referenceFindings.push(movedFinding);
  assertPublishRejected(
      clone(findingResult.summary),
      movedRecordFindingManifest,
      "record-finding-moved",
      findingResult.canonicalPlan,
  );

  const missingRecordFindingManifest = clone(findingBaseline);
  missingRecordFindingManifest.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey === recordFindingBaseline.typedDocumentKey,
  ).referenceFindings.pop();
  assertPublishRejected(
      clone(findingResult.summary),
      missingRecordFindingManifest,
      "record-finding-missing",
      findingResult.canonicalPlan,
  );

  const extraRecordFindingManifest = clone(findingBaseline);
  const extraRecord = extraRecordFindingManifest.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey === recordFindingBaseline.typedDocumentKey,
  );
  const extraFinding = clone(extraRecord.referenceFindings[0]);
  extraFinding.code = `${extraFinding.code}_extra`;
  extraFinding.findingIdentityDigest = findingPublicationIdentityDigest({
    ...extraFinding,
    sourceTypedKey: extraRecord.typedDocumentKey,
  });
  extraRecord.referenceFindings.push(extraFinding);
  assertPublishRejected(
      clone(findingResult.summary),
      extraRecordFindingManifest,
      "record-finding-extra",
      findingResult.canonicalPlan,
  );

  const duplicateRecordFindingManifest = clone(findingBaseline);
  const duplicateRecord = duplicateRecordFindingManifest.records.find(
      ({typedDocumentKey}) =>
        typedDocumentKey === recordFindingBaseline.typedDocumentKey,
  );
  duplicateRecord.referenceFindings[1] =
    clone(duplicateRecord.referenceFindings[0]);
  assertPublishRejected(
      clone(findingResult.summary),
      duplicateRecordFindingManifest,
      "record-finding-duplicate-compensating-removal",
      findingResult.canonicalPlan,
  );

  const duplicateRecordKeyManifest = clone(findingBaseline);
  const preservedRecords = duplicateRecordKeyManifest.records.filter(
      ({plannerDisposition}) => plannerDisposition !== "reset",
  );
  assert.ok(preservedRecords.length >= 2);
  preservedRecords[1].typedDocumentKey = preservedRecords[0].typedDocumentKey;
  assertPublishRejected(
      clone(findingResult.summary),
      duplicateRecordKeyManifest,
      "record-typed-key-duplicate",
      findingResult.canonicalPlan,
  );

  const reorderedRecordFindingManifest = clone(findingBaseline);
  reorderedRecordFindingManifest.records.reverse();
  for (const record of reorderedRecordFindingManifest.records) {
    record.referenceFindings.reverse();
    for (const finding of record.referenceFindings) {
      if (Array.isArray(finding.targetTypedKeys)) {
        finding.targetTypedKeys.reverse();
      }
    }
  }
  assert.doesNotThrow(() => assertExactPublicationParity(
      findingResult.canonicalPlan,
      findingResult.summary,
      reorderedRecordFindingManifest,
  ));
  assert.doesNotThrow(() => assertExactPublicationParity(
      findingResult.canonicalPlan,
      JSON.parse(JSON.stringify(findingResult.summary)),
      JSON.parse(JSON.stringify(findingBaseline)),
  ));

  const findingSwapSummary = clone(findingResult.summary);
  const findingSwapManifest = clone(findingBaseline);
  const swappedFinding = findingSwapManifest.referenceFindings.blockers[0];
  swappedFinding.code = `${swappedFinding.code}_same_count_swap`;
  swappedFinding.findingIdentityDigest =
    findingPublicationIdentityDigest(swappedFinding);
  swappedFinding.findingDigest = swappedFinding.findingIdentityDigest;
  assertPublishRejected(
      findingSwapSummary,
      findingSwapManifest,
      "finding-same-count-swap",
      findingResult.canonicalPlan,
  );

  const staleFindingSummary = clone(findingResult.summary);
  const staleFindingManifest = clone(findingBaseline);
  staleFindingManifest.referenceFindings.blockers[0].field =
    "stale-identity-field";
  assertPublishRejected(
      staleFindingSummary,
      staleFindingManifest,
      "finding-stale-identity-digest",
      findingResult.canonicalPlan,
  );

  const duplicateFindingSummary = clone(findingResult.summary);
  const duplicateFindingManifest = clone(findingBaseline);
  duplicateFindingManifest.referenceFindings.blockers[1] = clone(
      duplicateFindingManifest.referenceFindings.blockers[0],
  );
  assertPublishRejected(
      duplicateFindingSummary,
      duplicateFindingManifest,
      "finding-duplicate-compensating-removal",
      findingResult.canonicalPlan,
  );

  const reorderedFindingsManifest = clone(findingBaseline);
  for (const findings of Object.values(
      reorderedFindingsManifest.referenceFindings,
  )) {
    findings.reverse();
    for (const finding of findings) {
      if (Array.isArray(finding.targetTypedKeys)) {
        finding.targetTypedKeys.reverse();
      }
    }
  }
  assert.doesNotThrow(() => assertExactPublicationParity(
      findingResult.canonicalPlan,
      findingResult.summary,
      reorderedFindingsManifest,
  ));
  assert.deepEqual(
      recomputeManifestPublicationSetContract(reorderedFindingsManifest),
      findingResult.summary.publicationSetContract,
  );

  for (const field of [
    "candidateSetDigest",
    "findingSetDigest",
    "candidateSetDigestVersion",
    "findingSetDigestVersion",
    "publicationSetContractVersion",
  ]) {
    const summary = clone(baseline.summary);
    const manifest = clone(baseline.manifest);
    summary[field] = typeof summary[field] === "number" ?
      summary[field] + 1 :
      "0".repeat(64);
    assertPublishRejected(summary, manifest, `summary-${field}`);
  }
  for (const field of ["candidateSetDigest", "findingSetDigest"]) {
    const summary = clone(baseline.summary);
    const manifest = clone(baseline.manifest);
    manifest[field] = "f".repeat(64);
    assertPublishRejected(summary, manifest, `manifest-${field}`);
  }

  const serializedSummary =
    JSON.parse(JSON.stringify(baseline.summary));
  const serializedManifest =
    JSON.parse(JSON.stringify(baseline.manifest));
  assert.doesNotThrow(() => assertExactPublicationParity(
      baseline.canonicalPlan,
      serializedSummary,
      serializedManifest,
  ));
  for (const [field, value] of [
    ["indexFlagsClean", false],
    ["tracked", false],
    ["regularBlob", false],
    ["bytesMatch", false],
    ["runtimeSha256", "a".repeat(64)],
    ["headBlobSha256", "b".repeat(64)],
    ["headBlobOid", "c".repeat(40)],
    ["relativePath", "functions/scripts/replacement-source.mjs"],
  ]) {
    const summary = JSON.parse(JSON.stringify(baseline.summary));
    const manifest = JSON.parse(JSON.stringify(baseline.manifest));
    manifest.criticalRuntimeSources[0][field] = value;
    assertPublishRejected(summary, manifest, `runtime-source-${field}`);
  }

  const duplicateSourceSummary =
    JSON.parse(JSON.stringify(baseline.summary));
  const duplicateSourceManifest =
    JSON.parse(JSON.stringify(baseline.manifest));
  assert.equal(duplicateSourceManifest.criticalRuntimeSources.length, 2);
  duplicateSourceManifest.criticalRuntimeSources[1] = clone(
      duplicateSourceManifest.criticalRuntimeSources[0],
  );
  assertPublishRejected(
      duplicateSourceSummary,
      duplicateSourceManifest,
      "runtime-source-duplicate-compensating-removal",
  );

  const reorderedSourceManifest =
    JSON.parse(JSON.stringify(baseline.manifest));
  reorderedSourceManifest.criticalRuntimeSources.reverse();
  assert.doesNotThrow(() => assertExactPublicationParity(
      baseline.canonicalPlan,
      baseline.summary,
      reorderedSourceManifest,
  ));
  assert.deepEqual(
      buildRuntimeSourceContract(
          reorderedSourceManifest.criticalRuntimeSources,
      ),
      baseline.summary.runtimeSourceContract,
  );

  for (const target of ["summary", "manifest"]) {
    const summary = JSON.parse(JSON.stringify(baseline.summary));
    const manifest = JSON.parse(JSON.stringify(baseline.manifest));
    const output = target === "summary" ? summary : manifest;
    output.criticalRuntimeSourceSetDigest = "d".repeat(64);
    assertPublishRejected(
        summary,
        manifest,
        `${target}-runtime-source-claimed-digest`,
    );
  }

  const coherentSummary =
    JSON.parse(JSON.stringify(baseline.summary));
  const coherentManifest =
    JSON.parse(JSON.stringify(baseline.manifest));
  for (const output of [coherentSummary, coherentManifest]) {
    output.criticalRuntimeSources[0].headBlobSha256 = "a".repeat(64);
    output.criticalRuntimeSources[0].runtimeSha256 = "a".repeat(64);
  }
  const coherentRuntimeSourceContract = buildRuntimeSourceContract(
      coherentManifest.criticalRuntimeSources,
  );
  for (const output of [coherentSummary, coherentManifest]) {
    output.runtimeSourceContract =
      clone(coherentRuntimeSourceContract);
    Object.assign(output, coherentRuntimeSourceContract);
  }
  coherentSummary.publicationContract.criticalRuntimeSources =
    clone(coherentSummary.criticalRuntimeSources);
  coherentSummary.publicationContract.runtimeSourceContract =
    clone(coherentRuntimeSourceContract);
  coherentManifest.publicationContract =
    clone(coherentSummary.publicationContract);
  assert.equal(coherentSummary.planDigest, baseline.summary.planDigest);
  assertPublishRejected(
      coherentSummary,
      coherentManifest,
      "coherent-runtime-source-stale-plan-digest",
  );

  const mutateCanonicalExecutionSafety = (canonicalPlan, field, value) => {
    canonicalPlan[field] = value;
    canonicalPlan.executionSafetyContract[field] = value;
    canonicalPlan.publicationContract.policy[field] = value;
    canonicalPlan.publicationContract.policy.executionSafetyContract[field] =
      value;
  };
  for (const [label, mutate] of [
    ["canonical-runtime-source", (canonicalPlan) => {
      canonicalPlan.criticalRuntimeSources[0].headBlobSha256 =
        "a".repeat(64);
      canonicalPlan.criticalRuntimeSources[0].runtimeSha256 =
        "a".repeat(64);
      canonicalPlan.runtimeSourceContract = buildRuntimeSourceContract(
          canonicalPlan.criticalRuntimeSources,
      );
      canonicalPlan.publicationContract.criticalRuntimeSources =
        clone(canonicalPlan.criticalRuntimeSources);
      canonicalPlan.publicationContract.runtimeSourceContract =
        clone(canonicalPlan.runtimeSourceContract);
    }],
    ["canonical-candidate-contract", (canonicalPlan) => {
      canonicalPlan.publicationSetContract.candidateSetDigest =
        "a".repeat(64);
      canonicalPlan.publicationContract.publicationSetContract =
        clone(canonicalPlan.publicationSetContract);
    }],
    ["canonical-finding-contract", (canonicalPlan) => {
      canonicalPlan.publicationSetContract.findingSetDigest =
        "b".repeat(64);
      canonicalPlan.publicationContract.publicationSetContract =
        clone(canonicalPlan.publicationSetContract);
    }],
    ["canonical-collection-discovery", (canonicalPlan) => {
      const replacementDigest = "c".repeat(64);
      canonicalPlan.collectionDiscoveryContract
          .run1.startRootCollectionSetDigest = replacementDigest;
      canonicalPlan.collectionDiscoveryContract
          .run1.endRootCollectionSetDigest = replacementDigest;
      canonicalPlan.collectionDiscoveryContract
          .run2.startRootCollectionSetDigest = replacementDigest;
      canonicalPlan.collectionDiscoveryContract
          .run2.endRootCollectionSetDigest = replacementDigest;
      canonicalPlan.collectionDiscoveryContract.finalRootCollectionSetDigest =
        replacementDigest;
      canonicalPlan.publicationContract.collectionDiscoveryContract =
        clone(canonicalPlan.collectionDiscoveryContract);
    }],
    ["canonical-publication-state", (canonicalPlan) => {
      const staleState = {
        ...canonicalPlan.publicationStateContract,
        complete: false,
        verdict: "incomplete",
        exitCode: 3,
        consistency: false,
      };
      Object.assign(canonicalPlan, staleState);
      canonicalPlan.publicationStateContract = clone(staleState);
      canonicalPlan.publicationContract.publicationStateContract =
        clone(staleState);
      canonicalPlan.publicationContract.consistency = false;
    }],
    ["canonical-publication-state-version", (canonicalPlan) => {
      canonicalPlan.publicationStateContractVersion = 999;
    }],
    ["canonical-execution-safety-version", (canonicalPlan) => {
      mutateCanonicalExecutionSafety(
          canonicalPlan,
          "executionSafetyContractVersion",
          999,
      );
    }],
    ["canonical-execution-snapshot-mode", (canonicalPlan) => {
      mutateCanonicalExecutionSafety(
          canonicalPlan,
          "snapshotMode",
          "frozen_executable",
      );
    }],
    ["canonical-execution-eligible", (canonicalPlan) => {
      mutateCanonicalExecutionSafety(
          canonicalPlan,
          "executionEligible",
          true,
      );
    }],
    ["canonical-execution-write-freeze", (canonicalPlan) => {
      mutateCanonicalExecutionSafety(
          canonicalPlan,
          "writeFreezeVerified",
          true,
      );
    }],
    ["canonical-execution-fresh-plan", (canonicalPlan) => {
      mutateCanonicalExecutionSafety(
          canonicalPlan,
          "freshPlanRequiredUnderWriteFreeze",
          false,
      );
    }],
    ["canonical-backup-policy", (canonicalPlan) => {
      canonicalPlan.backupPolicy = "tampered_backup_policy";
      canonicalPlan.publicationContract.policy.backupPolicy =
        canonicalPlan.backupPolicy;
    }],
    ["canonical-firestore-canonicalization-version", (canonicalPlan) => {
      canonicalPlan.firestoreValueCanonicalizationVersion = 999;
      canonicalPlan.publicationContract.policy
          .firestoreValueCanonicalizationVersion = 999;
    }],
    ["canonical-plan-version", (canonicalPlan) => {
      canonicalPlan.planVersion = 999;
      canonicalPlan.publicationContract.planVersion = 999;
    }],
    ["canonical-delete-count", (canonicalPlan) => {
      canonicalPlan.expectedDeleteCount += 1;
      canonicalPlan.plannedMutations.deletes += 1;
      canonicalPlan.publicationContract.planned.deletes += 1;
    }],
  ]) {
    const staleCanonicalPlan = clone(baseline.canonicalPlan);
    const storedPlanDigest = staleCanonicalPlan.planDigest;
    mutate(staleCanonicalPlan);
    assert.notEqual(
        buildCanonicalPlanDigest(staleCanonicalPlan),
        storedPlanDigest,
        label,
    );
    assert.throws(
        () => assertCanonicalPlanIntegrity(staleCanonicalPlan),
        /Canonical plan .*stale|publication state contract version is unsupported|execution safety contract is not advisory-only|plan version is malformed or unsupported/,
        label,
    );
    assertPublishRejected(
        baseline.summary,
        baseline.manifest,
        label,
        staleCanonicalPlan,
    );
  }

  const reorderedCanonicalPlan = clone(baseline.canonicalPlan);
  reorderedCanonicalPlan.criticalRuntimeSources.reverse();
  reorderedCanonicalPlan.candidateInputs.reverse();
  for (const findings of Object.values(
      reorderedCanonicalPlan.referenceFindings,
  )) {
    findings.reverse();
    for (const finding of findings) {
      if (Array.isArray(finding.targetTypedKeys)) {
        finding.targetTypedKeys.reverse();
      }
    }
  }
  assert.equal(
      buildCanonicalPlanDigest(reorderedCanonicalPlan),
      baseline.canonicalPlan.planDigest,
  );
  assert.deepEqual(
      recomputeCanonicalPlanPublicationContract(reorderedCanonicalPlan),
      reorderedCanonicalPlan.publicationContract,
  );
  assert.doesNotThrow(() =>
    assertCanonicalPlanIntegrity(reorderedCanonicalPlan));
});

test("canonical plan snapshot is immutable and output-independent", async () => {
  const result = await planDataset(registryDataset());
  const canonicalBefore = stableStringify(result.canonicalPlan);
  assert.equal(Object.isFrozen(result.canonicalPlan), true);
  assert.equal(Object.isFrozen(result.canonicalPlan.candidateInputs), true);
  assert.equal(
      Object.isFrozen(result.canonicalPlan.criticalRuntimeSources),
      true,
  );
  result.summary.criticalRuntimeSources[0].runtimeSha256 = "a".repeat(64);
  result.manifest.criticalRuntimeSources[0].runtimeSha256 = "b".repeat(64);
  assert.equal(stableStringify(result.canonicalPlan), canonicalBefore);
  assert.equal(
      Object.hasOwn(buildCanonicalPlanDigestInput(result.canonicalPlan),
          "planDigest"),
      false,
  );
});

test("plan digest independently binds every policy input", () => {
  const baselineInput = {
    planVersion: 2,
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeHeadSha: BASE_SHA,
    runtimeTreeSha: TREE_SHA,
    criticalRuntimeSources: runtimeSourceIdentity().criticalRuntimeSources,
    resetProfile: null,
    topLevelOutputSchemaVersion: 1,
    canonicalPlanSchemaVersion: 1,
    summarySchemaVersion: 1,
    manifestSchemaVersion: 1,
    referenceCardinalityPolicyVersion: 1,
    referenceFieldSpecSchemaDigest: buildReferenceFieldSpecSchemaDigest(),
    firestoreValueCanonicalizationVersion: 3,
    profilePolicyVersion: PROFILE_POLICY_VERSION,
    membershipClassificationPolicyVersion:
      MEMBERSHIP_CLASSIFICATION_POLICY_VERSION,
    knownCreditSourceAllowlistVersion:
      KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION,
    operatorTestDataConfirmation: false,
    provisioningLogPolicy: "retain",
    provisioningLogPolicyReason: "retain_until_retention_review",
    backupPolicy: "managed_firestore_export_required",
    fullBackupWaiverConfirmed: false,
    dataRecoveryAvailable: false,
    managedExportRequired: true,
    managedFirestoreExportRequired: true,
    minimumSafetySnapshotsRequired: {
      finalPlanDigest: true,
      expectedDeleteCount: true,
      academyShellSnapshot: true,
      preservedStaffMembershipSnapshot: true,
      teacherMappingSnapshot: true,
      authUidInventory: true,
      postResetZeroStateAudit: true,
    },
    executionSafetyContract: {
      executionSafetyContractVersion: 1,
      planClassification: "non_executable_advisory",
      snapshotMode: "live_read_only_unfrozen",
      writeFreezeRequiredForExecution: true,
      writeFreezeVerified: false,
      freshPlanRequiredUnderWriteFreeze: true,
      executorRevalidationRequired: true,
      executionEligible: false,
      executorImplemented: false,
      writeAuthorized: false,
      actualWrites: 0,
    },
    executionSafetyContractVersion: 1,
    planClassification: "non_executable_advisory",
    snapshotMode: "live_read_only_unfrozen",
    writeFreezeRequiredForExecution: true,
    writeFreezeVerified: false,
    freshPlanRequiredUnderWriteFreeze: true,
    executorRevalidationRequired: true,
    executionEligible: false,
    irreversibleExecutorConfirmationRequired: true,
    irreversibleExecutorConfirmationName:
      "CONFIRM_IRREVERSIBLE_TEST_DATA_RESET",
    irreversibleExecutorConfirmationValue: "YES",
    exactPlanDigestRequired: true,
    exactDeleteCountRequired: true,
    backupVerified: false,
    resetApproved: false,
    independentReviewApproved: false,
    writeAuthorized: false,
    executorImplemented: false,
    actualWrites: 0,
    firstRunDigest: "run-a",
    secondRunDigest: "run-a",
    consistency: true,
    candidateSetDigest: "candidate-set-a",
    expectedDeleteCount: 24,
    findingDeduplicationResult: {
      firstRun: {diagnostics: [], warnings: [], blockers: []},
      secondRun: {diagnostics: [], warnings: [], blockers: []},
    },
    publicationSetContract: {
      publicationSetContractVersion: 1,
      candidateCount: 24,
      candidateSetDigestVersion: 1,
      candidateSetDigest: "candidate-publication-set-a",
      findingCount: 0,
      findingSetDigestVersion: 2,
      findingSetDigest: "finding-publication-set-a",
    },
    recordSetContract: {
      recordSetContractVersion: 2,
      recordCount: 29,
      recordSetDigestVersion: 2,
      recordSetDigest: "record-publication-set-a",
    },
    runtimeSourceContract: buildRuntimeSourceContract(
        runtimeSourceIdentity().criticalRuntimeSources,
    ),
    collectionDiscoveryContract: {
      collectionDiscoveryContractVersion: 1,
      rootCollectionSetDigestVersion: 1,
      run1: {
        startRootCollectionCount: 29,
        startRootCollectionSetDigest: "1".repeat(64),
        endRootCollectionCount: 29,
        endRootCollectionSetDigest: "1".repeat(64),
        rootCollectionSetStable: true,
      },
      run2: {
        startRootCollectionCount: 29,
        startRootCollectionSetDigest: "1".repeat(64),
        endRootCollectionCount: 29,
        endRootCollectionSetDigest: "1".repeat(64),
        rootCollectionSetStable: true,
      },
      finalRootCollectionCount: 29,
      finalRootCollectionSetDigest: "1".repeat(64),
      finalMatchesRun1: true,
      finalMatchesRun2: true,
    },
    publicationStateContractVersion: 1,
    complete: true,
    verdict: "complete",
    exitCode: 0,
    completedRuns: 2,
    truncated: false,
    omitted: 0,
    run1RootCollectionSetStable: true,
    run2RootCollectionSetStable: true,
    finalMatchesRun1: true,
    finalMatchesRun2: true,
    publicationStateContract: {
      publicationStateContractVersion: 1,
      complete: true,
      verdict: "complete",
      exitCode: 0,
      completedRuns: 2,
      consistency: true,
      truncated: false,
      omitted: 0,
      run1RootCollectionSetStable: true,
      run2RootCollectionSetStable: true,
      finalMatchesRun1: true,
      finalMatchesRun2: true,
    },
    registryContract: {
      total: 29,
      resetAll: 24,
      preserve: 3,
      retain: 1,
      global: 1,
    },
    collectionCounts: {
      lessons: {scanned: 1, reset: 1, preserved: 0, retained: 0, unknown: 0},
    },
    referenceCounts: {
      scanned: 1,
      resetCandidates: 1,
      preserved: 0,
      retained: 0,
      unknown: 0,
      blockerCount: 0,
      referenceDiagnosticCount: 0,
      referenceWarningCount: 0,
      referenceBlockerCount: 0,
      deduplicatedFindingCount: 0,
    },
    plannedMutations: {creates: 0, updates: 0, deletes: 24},
  };
  const baselineSnapshot = clone(baselineInput);
  const baselineDigest = buildCanonicalPlanDigest(baselineInput);
  const mutations = new Map([
    ["releaseSha", "b".repeat(40)],
    ["runtimeTreeSha", "c".repeat(40)],
    ["criticalRuntimeSources", [{
      ...baselineInput.criticalRuntimeSources[0],
      runtimeSha256: "9".repeat(64),
      headBlobSha256: "9".repeat(64),
    }]],
    ["resetProfile", ALL_ACADEMY_DATA_TEST_PROFILE],
    ["firestoreValueCanonicalizationVersion", 999],
    ["profilePolicyVersion", `${PROFILE_POLICY_VERSION}.changed`],
    ["operatorTestDataConfirmation", true],
    ["backupPolicy", "operator_waived_full_backup"],
    ["fullBackupWaiverConfirmed", true],
    ["dataRecoveryAvailable", true],
    ["managedExportRequired", false],
    ["managedFirestoreExportRequired", false],
    ["minimumSafetySnapshotsRequired", {
      ...baselineInput.minimumSafetySnapshotsRequired,
      teacherMappingSnapshot: false,
    }],
    ["executionSafetyContract", {
      ...baselineInput.executionSafetyContract,
      executionEligible: true,
    }],
    ["executionSafetyContractVersion", 999],
    ["planClassification", "executable_plan"],
    ["snapshotMode", "frozen_executable"],
    ["writeFreezeRequiredForExecution", false],
    ["writeFreezeVerified", true],
    ["freshPlanRequiredUnderWriteFreeze", false],
    ["executorRevalidationRequired", false],
    ["executionEligible", true],
    ["irreversibleExecutorConfirmationRequired", false],
    ["irreversibleExecutorConfirmationName", "CHANGED_CONFIRMATION"],
    ["irreversibleExecutorConfirmationValue", "CHANGED"],
    ["exactPlanDigestRequired", false],
    ["exactDeleteCountRequired", false],
    ["candidateSetDigest", "candidate-set-b"],
    ["expectedDeleteCount", 25],
    ["recordSetContract", {
      ...baselineInput.recordSetContract,
      recordSetDigest: "record-publication-set-b",
    }],
    ["publicationStateContractVersion", 999],
    ["complete", false],
    ["verdict", "blocked"],
    ["exitCode", 2],
    ["consistency", false],
    ["completedRuns", 3],
    ["truncated", true],
    ["omitted", 1],
    ["run1RootCollectionSetStable", false],
    ["run2RootCollectionSetStable", false],
    ["finalMatchesRun1", false],
    ["finalMatchesRun2", false],
    ["collectionDiscoveryContract", {
      ...baselineInput.collectionDiscoveryContract,
      finalRootCollectionSetDigest: "2".repeat(64),
      finalMatchesRun1: false,
      finalMatchesRun2: false,
    }],
    ["registryContract", {
      ...baselineInput.registryContract,
      total: 30,
    }],
    ["collectionCounts", {
      ...baselineInput.collectionCounts,
      lessons: {
        ...baselineInput.collectionCounts.lessons,
        scanned: 2,
      },
    }],
    ["referenceCounts", {
      ...baselineInput.referenceCounts,
      referenceWarningCount: 1,
    }],
    ["plannedMutations", {
      ...baselineInput.plannedMutations,
      deletes: 25,
    }],
    [
      "membershipClassificationPolicyVersion",
      `${MEMBERSHIP_CLASSIFICATION_POLICY_VERSION}.changed`,
    ],
    [
      "knownCreditSourceAllowlistVersion",
      `${KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION}.changed`,
    ],
    ["findingDeduplicationResult", {
      ...baselineInput.findingDeduplicationResult,
      secondRun: {
        diagnostics: [],
        warnings: [],
        blockers: ["new-finding-digest"],
      },
    }],
  ]);
  for (const [field, value] of mutations) {
    const changed = clone(baselineInput);
    changed[field] = value;
    assert.notEqual(
        buildCanonicalPlanDigest(changed),
        baselineDigest,
        field,
    );
    assert.deepEqual(baselineInput, baselineSnapshot);
  }
  for (const field of [
    "publicationSetContractVersion",
    "candidateCount",
    "candidateSetDigestVersion",
    "candidateSetDigest",
    "findingCount",
    "findingSetDigestVersion",
    "findingSetDigest",
  ]) {
    const changed = clone(baselineInput);
    changed.publicationSetContract[field] =
      typeof changed.publicationSetContract[field] === "number" ?
        changed.publicationSetContract[field] + 1 :
        `${changed.publicationSetContract[field]}.changed`;
    assert.notEqual(
        buildCanonicalPlanDigest(changed),
        baselineDigest,
        `publicationSetContract.${field}`,
    );
  }
  for (const field of [
    "runtimeSourceContractVersion",
    "criticalRuntimeSourceCount",
    "criticalRuntimeSourceSetDigestVersion",
    "criticalRuntimeSourceSetDigest",
  ]) {
    const changed = clone(baselineInput);
    changed.runtimeSourceContract[field] =
      typeof changed.runtimeSourceContract[field] === "number" ?
        changed.runtimeSourceContract[field] + 1 :
        `${changed.runtimeSourceContract[field]}.changed`;
    assert.notEqual(
        buildCanonicalPlanDigest(changed),
        baselineDigest,
        `runtimeSourceContract.${field}`,
    );
  }
  for (const [field, value] of [
    ["indexFlagsClean", false],
    ["tracked", false],
    ["regularBlob", false],
    ["bytesMatch", false],
    ["runtimeSha256", "a".repeat(64)],
    ["headBlobSha256", "b".repeat(64)],
    ["headBlobOid", "c".repeat(40)],
    ["relativePath", "functions/scripts/replacement-source.mjs"],
  ]) {
    const changed = clone(baselineInput);
    changed.criticalRuntimeSources[0][field] = value;
    changed.runtimeSourceContract = buildRuntimeSourceContract(
        changed.criticalRuntimeSources,
    );
    assert.notEqual(
        buildCanonicalPlanDigest(changed),
        baselineDigest,
        `criticalRuntimeSources.${field}`,
    );
  }
  for (const operation of ["add", "remove"]) {
    const changed = clone(baselineInput);
    if (operation === "remove") {
      changed.criticalRuntimeSources.pop();
    } else {
      changed.criticalRuntimeSources.push({
        ...clone(changed.criticalRuntimeSources[1]),
        relativePath: "functions/scripts/additional-source.mjs",
        headBlobOid: "d".repeat(40),
        headBlobSha256: "e".repeat(64),
        runtimeSha256: "e".repeat(64),
      });
    }
    changed.runtimeSourceContract = buildRuntimeSourceContract(
        changed.criticalRuntimeSources,
    );
    assert.notEqual(
        buildCanonicalPlanDigest(changed),
        baselineDigest,
        `criticalRuntimeSources.${operation}`,
    );
  }
  const reorderedSources = clone(baselineInput);
  reorderedSources.criticalRuntimeSources.reverse();
  reorderedSources.runtimeSourceContract = buildRuntimeSourceContract(
      reorderedSources.criticalRuntimeSources,
  );
  assert.equal(
      buildCanonicalPlanDigest(reorderedSources),
      baselineDigest,
      "criticalRuntimeSources reorder",
  );

  for (const ignoredFields of [
    {USER: "user-a", LOGNAME: "login-a"},
    {USER: "user-b", LOGNAME: "login-b"},
    {HOME: "/Users/user-a"},
    {HOME: "/Users/user-b"},
    {userInfoUsername: "user-a"},
    {userInfoUsername: "user-b"},
    {repositoryRoot: "/Users/user-a/project"},
    {repositoryRoot: "/opt/user-b/project"},
    {summaryOutput: "/tmp/a", sensitiveOutput: "/tmp/b"},
    {summaryOutput: "/tmp/c", sensitiveOutput: "/tmp/d"},
    {outputDirectory: "/private/output-a"},
    {outputDirectory: "/private/output-b"},
    {temporaryPath: "/private/tmp/a"},
    {temporaryPath: "/private/tmp/b"},
    {credentialPath: "/private/a.json"},
    {credentialPath: "/private/b.json"},
    {hostname: "host-a"},
    {hostname: "host-b"},
    {currentWorkingDirectory: "/Users/user-a/project"},
    {currentWorkingDirectory: "/opt/user-b/project"},
    {generatedAt: "2026-01-01T00:00:00.000Z"},
    {generatedAt: "2027-01-01T00:00:00.000Z"},
    {rawUnknownCreditSourceType: "raw-secret-a"},
    {rawUnknownCreditSourceType: "raw-secret-b"},
  ]) {
    assert.equal(
        buildCanonicalPlanDigest({...baselineInput, ...ignoredFields}),
        baselineDigest,
    );
  }
});

test("publication set contract is exact and order independent", () => {
  const candidates = [
    {
      typedDocumentKey: "dailyMaterials:candidate-a",
      collection: "dailyMaterials",
      classification: "ACADEMY_SCOPED_RESET",
      deletionOrderGroup: 2,
      disposition: "reset",
      academyScopeEvidence: {
        strategy: "academy_id_field",
        result: "target_academy",
        exactAcademyMatch: true,
      },
    },
    {
      typedDocumentKey: "lessons:candidate-b",
      collection: "lessons",
      classification: "ACADEMY_SCOPED_RESET",
      deletionOrderGroup: 3,
      disposition: "reset",
      academyScopeEvidence: {
        strategy: "academy_id_field",
        result: "target_academy",
        exactAcademyMatch: true,
      },
    },
  ];
  const makeFinding = (overrides = {}) => {
    const finding = {
      severity: "warning",
      code: "existing_reset_reference",
      sourceTypedKey: "lessons:candidate-b",
      field: "slotId",
      targetTypedKeys: [
        "privateLessonSlots:slot-b",
        "privateLessonSlots:slot-a",
      ],
      policyReason: "Both source and target are reset candidates.",
      sourceClassification: "ACADEMY_SCOPED_RESET",
      sourceDisposition: "reset",
      targetCollectionClassification: ["ACADEMY_SCOPED_RESET"],
      family: "private_slot",
      ...overrides,
    };
    finding.findingIdentityDigest =
      findingPublicationIdentityDigest(finding);
    finding.findingDigest = finding.findingIdentityDigest;
    finding.publishedFindingDigest =
      publishedFindingRecordDigest(finding);
    return finding;
  };
  const finding = makeFinding();
  const run = {
    records: candidates,
    referenceFindings: {
      diagnostics: [],
      warnings: [finding],
      blockers: [],
    },
  };
  const baseline = buildPlannerPublicationSetContract(run);
  assert.equal(baseline.publicationSetContractVersion, 1);
  assert.equal(baseline.candidateCount, 2);
  assert.equal(baseline.findingCount, 1);

  const reordered = clone(run);
  reordered.records.reverse();
  reordered.referenceFindings.warnings[0].targetTypedKeys.reverse();
  assert.deepEqual(
      buildPlannerPublicationSetContract(reordered),
      baseline,
  );

  const candidateSwap = clone(run);
  candidateSwap.records[0].typedDocumentKey =
    "dailyMaterials:candidate-replacement";
  const candidateSwapContract =
    buildPlannerPublicationSetContract(candidateSwap);
  assert.equal(candidateSwapContract.candidateCount, baseline.candidateCount);
  assert.notEqual(
      candidateSwapContract.candidateSetDigest,
      baseline.candidateSetDigest,
  );

  const candidateMetadata = clone(run);
  candidateMetadata.records[0].deletionOrderGroup += 1;
  assert.notEqual(
      buildPlannerPublicationSetContract(candidateMetadata)
          .candidateSetDigest,
      baseline.candidateSetDigest,
  );

  for (const findingOverride of [
    {code: "different_code"},
    {field: "differentField"},
    {targetTypedKeys: ["privateLessonSlots:different-slot"]},
    {policyReason: "Different policy reason."},
  ]) {
    const changedRun = clone(run);
    changedRun.referenceFindings.warnings = [
      makeFinding(findingOverride),
    ];
    const changedContract =
      buildPlannerPublicationSetContract(changedRun);
    assert.equal(changedContract.findingCount, baseline.findingCount);
    assert.notEqual(
        changedContract.findingSetDigest,
        baseline.findingSetDigest,
    );
  }

  const severityRun = clone(run);
  severityRun.referenceFindings.warnings = [];
  severityRun.referenceFindings.blockers = [
    makeFinding({severity: "blocking"}),
  ];
  assert.notEqual(
      buildPlannerPublicationSetContract(severityRun).findingSetDigest,
      baseline.findingSetDigest,
  );
});

test("runtime source contract is exact and order independent", () => {
  const sources = runtimeSourceIdentity().criticalRuntimeSources;
  const baseline = buildRuntimeSourceContract(sources);
  assert.equal(baseline.runtimeSourceContractVersion, 1);
  assert.equal(baseline.criticalRuntimeSourceCount, 2);
  assert.equal(baseline.criticalRuntimeSourceSetDigestVersion, 1);
  assert.deepEqual(
      buildRuntimeSourceContract([...sources].reverse()),
      baseline,
  );
  for (const [field, value] of [
    ["indexFlagsClean", false],
    ["tracked", false],
    ["regularBlob", false],
    ["bytesMatch", false],
    ["runtimeSha256", "a".repeat(64)],
    ["headBlobSha256", "b".repeat(64)],
    ["headBlobOid", "c".repeat(40)],
    ["relativePath", "functions/scripts/replacement-source.mjs"],
  ]) {
    const changed = clone(sources);
    changed[0][field] = value;
    const changedContract = buildRuntimeSourceContract(changed);
    assert.equal(
        changedContract.criticalRuntimeSourceCount,
        baseline.criticalRuntimeSourceCount,
    );
    assert.notEqual(
        changedContract.criticalRuntimeSourceSetDigest,
        baseline.criticalRuntimeSourceSetDigest,
        field,
    );
  }
  const duplicate = clone(sources);
  duplicate[1] = clone(duplicate[0]);
  assert.throws(
      () => buildRuntimeSourceContract(duplicate),
      /Duplicate critical runtime source relative path/,
  );
});

test("test profile blocks ambiguous and preserved staff pointers", async () => {
  const pointerData = profileDataset();
  pointerData.academyMemberships[0].data.studentId =
    pointerData.privateStudents[0].id;
  let result = await planDataset(pointerData, testProfileOptions());
  assert.equal(result.exitCode, 2);
  assert.equal(
      result.summary.membershipProfile
          .preservedMembershipPointerCleanupCount,
      1,
  );
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) =>
            code === "preserved_membership_pointer_cleanup_required",
      ),
      true,
  );

  const ambiguousData = profileDataset();
  ambiguousData.academyMemberships[0].data.role = "future-role";
  result = await planDataset(ambiguousData, testProfileOptions());
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.membershipProfile.ambiguousMembershipCount, 1);
  assert.equal(
      result.secondRun.blockers.some(
          ({code}) => code === "invalid_membership_role_literal",
      ),
      true,
  );
});

test("membership semantic identities conflict only after typed resolution", async () => {
  const data = profileDataset();
  const firstTeacherId = data.teachers[0].id;
  data.teachers[0].data.teacherKey = "teacher-key-a";
  data.teachers.push({
    id: "teacher-b",
    data: {academyId: ACADEMY, teacherKey: "teacher-key-b"},
  });
  data.academyMemberships[0].data = {
    academyId: ACADEMY,
    role: "teacher",
    status: "active",
    uid: data.users[0].id,
    teacherUid: data.users[0].id,
    teacherId: firstTeacherId,
    teacherKey: "teacher-key-b",
    permissions: {},
  };
  const result = await planDataset(data, testProfileOptions());
  assert.equal(result.exitCode, 2);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "conflicting_teacher_identity_targets",
      ),
      true,
  );

  const otherData = profileDataset();
  otherData.academyMemberships.push({
    id: "other-academy-membership",
    data: {
      academyId: "academy_other",
      role: "student",
      status: "active",
      studentId: "other-student",
    },
  });
  otherData.privateStudents.push({
    id: "other-student",
    data: {academyId: "academy_other"},
  });
  otherData.accountProvisioningLogs.push({
    id: "other-academy-log",
    data: {academyId: "academy_other"},
  });
  const otherResult = await planDataset(otherData, testProfileOptions());
  assert.equal(otherResult.exitCode, 0);
  assert.equal(
      otherResult.summary.collections.academyMemberships.reset,
      0,
  );
  assert.equal(
      otherResult.summary.collections.accountProvisioningLogs.reset,
      1,
  );
});

test("field-specific absence and malformed shape policies are strict", async () => {
  const absenceData = registryDataset();
  absenceData.privateLessonSlots[0].data = {
    academyId: ACADEMY,
    reservationId: "",
    reservedStudentId: "",
  };
  absenceData.studentPackages[0].data.groupClassId = null;
  absenceData.notificationEvents[0].data.reservationId = "";
  absenceData.groupClasses[0].data.teacherId = "";
  absenceData.groupClasses.push({
    id: "group-class-null-teacher",
    data: {academyId: ACADEMY, teacherId: null},
  });
  let result = await planDataset(absenceData);
  assert.equal(result.exitCode, 0);
  assert.deepEqual(result.summary.malformedReferenceShapes, []);

  const malformedData = registryDataset();
  malformedData.privateLessonSlots[0].data.reservationId = null;
  malformedData.privateLessonSlots[0].data.reservedStudentId = {
    raw: "must-not-leak",
  };
  malformedData.studentPackages[0].data.groupClassId = ["valid", 3];
  malformedData.notificationEvents[0].data.reservationId = false;
  malformedData.groupClasses[0].data.teacherId = {unexpected: true};
  result = await planDataset(malformedData);
  assert.equal(result.exitCode, 2);
  const shapeKeys = result.summary.malformedReferenceShapes.map(
      ({collection, field, actualShape}) =>
        `${collection}:${field}:${actualShape}`,
  );
  for (const expected of [
    "privateLessonSlots:reservationId:null",
    "privateLessonSlots:reservedStudentId:object",
    "studentPackages:groupClassId:array_mixed",
    "notificationEvents:reservationId:boolean",
    "groupClasses:teacherId:object",
  ]) {
    assert.equal(shapeKeys.includes(expected), true, expected);
  }
  assert.equal(
      JSON.stringify(result.summary).includes("must-not-leak"),
      false,
  );
  assert.equal(
      JSON.stringify(result.manifest).includes("must-not-leak"),
      false,
  );
});

test("missing preserved targets are diagnostic only for reset sources", async () => {
  const resetData = registryDataset();
  resetData.studentPackages[0].data.teacherId = "missing-teacher-a";
  resetData.privateLessonAvailabilityTemplates[0].data.teacherId =
    "missing-teacher-b";
  let result = await planDataset(resetData);
  assert.equal(result.exitCode, 0);
  assert.equal(
      result.summary.totals.resetSourceMissingPreservedTargetReferences,
      2,
  );

  const preservedData = registryDataset();
  preservedData.academyMemberships[0].data.studentId = "missing-student";
  result = await planDataset(preservedData);
  assert.equal(result.exitCode, 2);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "missing_reference",
      ),
      true,
  );

  const retainedData = registryDataset();
  retainedData.accountProvisioningLogs[0].data.studentId =
    "missing-student";
  result = await planDataset(retainedData);
  assert.equal(result.exitCode, 2);
});

test("credit source allowlist has an exact writer-backed schema", () => {
  const expectedTargets = {
    "fixed-private-renewal": "fixedPrivateRenewalBatches",
    "fixedPrivateReservation": "privateLessonReservations",
    "groupClass": "groupClasses",
    "groupLesson": "groupLessons",
    "lesson": "lessons",
    "privateReservation": "privateLessonReservations",
    "studentPackage": "studentPackages",
  };
  const expectedKeys = Object.keys(expectedTargets).sort();
  const inheritedKeys = [
    "constructor",
    "__proto__",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ];
  assert.equal(
      Object.getPrototypeOf(CREDIT_SOURCE_REFERENCE_MAPPINGS),
      null,
  );
  assert.equal(Object.isFrozen(CREDIT_SOURCE_REFERENCE_MAPPINGS), true);
  assert.deepEqual(KNOWN_CREDIT_SOURCE_TYPE_KEYS, expectedKeys);
  assert.equal(KNOWN_CREDIT_SOURCE_TYPE_CARDINALITY, expectedKeys.length);
  assert.deepEqual(KNOWN_CREDIT_SOURCE_TYPE_TARGETS, expectedTargets);
  assert.deepEqual(
      Object.fromEntries(
          Object.entries(CREDIT_SOURCE_REFERENCE_MAPPINGS)
              .map(([key, value]) => [key, value.targetCollection]),
      ),
      expectedTargets,
  );
  assert.equal(assertCreditSourceAllowlistInvariant(), true);
  for (const key of expectedKeys) {
    assert.equal(
        CREDIT_SOURCE_REFERENCE_MAPPINGS[key].explicitIdCardinality,
        "optional_scalar",
    );
    assert.equal(
        getKnownCreditSourceMapping(key)?.targetCollection,
        expectedTargets[key],
    );
  }
  for (const key of inheritedKeys) {
    assert.equal(
        Object.hasOwn(CREDIT_SOURCE_REFERENCE_MAPPINGS, key),
        false,
    );
    assert.equal(getKnownCreditSourceMapping(key), null);
  }

  const frozenNullMap = (entries) => Object.freeze(
      Object.assign(Object.create(null), entries),
  );
  const mappings = Object.fromEntries(
      Object.entries(CREDIT_SOURCE_REFERENCE_MAPPINGS)
          .map(([key, mapping]) => [key, clone(mapping)]),
  );
  assert.throws(
      () => assertCreditSourceAllowlistInvariant(frozenNullMap({
        ...mappings,
        invented: mappings.lesson,
      })),
      /exact keyset invariant/,
  );
  const removed = {...mappings};
  delete removed[expectedKeys[0]];
  assert.throws(
      () => assertCreditSourceAllowlistInvariant(frozenNullMap(removed)),
      /exact keyset invariant/,
  );
  const caseChanged = {...mappings};
  caseChanged.PrivateReservation = caseChanged.privateReservation;
  delete caseChanged.privateReservation;
  assert.throws(
      () => assertCreditSourceAllowlistInvariant(
          frozenNullMap(caseChanged),
      ),
      /exact keyset invariant/,
  );
  const targetChanged = clone(mappings);
  targetChanged.lesson.targetCollection = "groupLessons";
  assert.throws(
      () => assertCreditSourceAllowlistInvariant(
          frozenNullMap(targetChanged),
      ),
      /target invariant/,
  );
});

test("unknown credit source emits only redacted presence evidence", async () => {
  const sameSafeGroupingResults = [];
  for (const [sourceType, lengthBucket] of [
    ["legacyPackageAdjustment", "17-32"],
    ["550e8400-e29b-41d4-a716-446655440000", "33-64"],
    ["operator@example.invalid", "17-32"],
    ["legacy/path/source", "17-32"],
    ["x".repeat(80), "65+"],
    ["Lesson", "1-16"],
    ["constructor", "1-16"],
    ["__proto__", "1-16"],
    ["prototype", "1-16"],
    ["toString", "1-16"],
    ["valueOf", "1-16"],
    ["hasOwnProperty", "1-16"],
  ]) {
    const data = registryDataset();
    data.creditTransactions[0].data = {
      academyId: ACADEMY,
      packageId: data.studentPackages[0].id,
      sourceType,
      sourceId: "opaque-source-id",
    };
    const result = await planDataset(data);
    if (lengthBucket === "17-32" &&
        sameSafeGroupingResults.length < 2) {
      sameSafeGroupingResults.push(result);
    }
    assert.equal(result.exitCode, 2);
    assert.deepEqual(result.summary.unknownCreditSourceEvidence, [{
      sourceTypePresent: true,
      sourceTypeKnown: false,
      sourceTypeCategory: "unknown",
      actualShape: "string",
      lengthBucket,
      sourceIdPresent: true,
      explicitLessonIdPresent: false,
      explicitReservationIdPresent: false,
      explicitSlotIdPresent: false,
      creditDocumentDisposition: "reset",
      academyScopeResult: "target_academy",
      count: 1,
    }]);
    assert.equal(
        JSON.stringify(result.summary).includes(JSON.stringify(sourceType)),
        false,
    );
    assert.equal(
        JSON.stringify(result.manifest).includes(JSON.stringify(sourceType)),
        false,
    );
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code}) => code === "unknown_credit_source_type",
        ),
        true,
    );
  }
  assert.deepEqual(
      sameSafeGroupingResults[0].summary.unknownCreditSourceEvidence,
      sameSafeGroupingResults[1].summary.unknownCreditSourceEvidence,
  );
  assert.notEqual(
      sameSafeGroupingResults[0].summary.planDigest,
      sameSafeGroupingResults[1].summary.planDigest,
      "Snapshot digest must bind changed document bytes without exposing them",
  );
});

test("credit sourceId is an exact optional scalar reference", async () => {
  const valid = registryDataset();
  valid.creditTransactions[0].data = {
    academyId: ACADEMY,
    sourceType: "privateReservation",
    sourceId: valid.privateLessonReservations[0].id,
  };
  assert.equal((await planDataset(valid)).exitCode, 0);

  const absent = registryDataset();
  absent.creditTransactions[0].data = {academyId: ACADEMY};
  const absentResult = await planDataset(absent);
  assert.equal(absentResult.exitCode, 0);
  assert.equal(
      absentResult.secondRun.records.find(
          ({collection}) => collection === "creditTransactions",
      ).creditSourceEvidence.sourceIdPresent,
      false,
  );

  for (const [label, sourceId] of [
    ["one-array", ["privateLessonReservations-target-document"]],
    ["multi-array", ["one", "two"]],
    ["null", null],
    ["empty", ""],
    ["object", {id: "opaque-secret-source"}],
    ["number", 7],
    ["boolean", true],
  ]) {
    const malformed = registryDataset();
    malformed.creditTransactions[0].data = {
      academyId: ACADEMY,
      sourceType: "privateReservation",
      sourceId,
    };
    const result = await planDataset(malformed);
    assert.equal(result.exitCode, 2, label);
    assert.equal(result.summary.actualWrites, 0, label);
    assert.equal(
        result.secondRun.referenceFindings.blockers.some(
            ({code, field}) =>
              code === "malformed_reference_field" &&
              field === "sourceId",
        ),
        true,
        label,
    );
    assert.equal(
        JSON.stringify(result.manifest).includes("opaque-secret-source"),
        false,
        label,
    );
  }

  const unknownMalformed = registryDataset();
  unknownMalformed.creditTransactions[0].data = {
    academyId: ACADEMY,
    sourceType: "unknown-type",
    sourceId: ["opaque-secret-source"],
  };
  const unknownResult = await planDataset(unknownMalformed);
  assert.equal(unknownResult.exitCode, 2);
  const blockerCodes = unknownResult.secondRun.referenceFindings.blockers
      .map(({code}) => code);
  assert.equal(blockerCodes.includes("malformed_reference_field"), true);
  assert.equal(blockerCodes.includes("unknown_credit_source_type"), true);
  assert.equal(
      JSON.stringify(unknownResult.manifest).includes("opaque-secret-source"),
      false,
  );
});

test("credit explicit source references are exact optional scalars", async () => {
  for (const [sourceType, mapping] of Object.entries(
      CREDIT_SOURCE_REFERENCE_MAPPINGS,
  )) {
    for (const field of mapping.explicitIdFields) {
      const data = registryDataset();
      const sourceId = data[mapping.targetCollection][0].id;
      data.creditTransactions[0].data = {
        academyId: ACADEMY,
        sourceType,
        sourceId,
        [field]: [sourceId],
      };
      const result = await planDataset(data);
      assert.equal(result.exitCode, 2, `${sourceType}.${field}`);
      assert.ok(result.secondRun.referenceFindings.blockers.some(
          ({code, field: actualField}) =>
            code === "malformed_reference_field" &&
            actualField === field,
      ), `${sourceType}.${field}`);
      assert.equal(result.summary.actualWrites, 0);
    }
  }

  for (const field of [
    "lessonId",
    "fixedLessonId",
    "linkedLessonId",
    "reservationId",
    "privateLessonReservationId",
    "linkedReservationId",
    "slotId",
    "privateLessonSlotId",
    "linkedSlotId",
  ]) {
    const data = registryDataset();
    const sourceId = data.privateLessonReservations[0].id;
    data.creditTransactions[0].data = {
      academyId: ACADEMY,
      sourceType: "privateReservation",
      sourceId,
      [field]: [sourceId],
    };
    const result = await planDataset(data);
    assert.equal(result.exitCode, 2, field);
    assert.ok(result.secondRun.referenceFindings.blockers.some(
        ({code, field: actualField}) =>
          code === "malformed_reference_field" &&
          actualField === field,
    ), field);
  }
});

test("published finding evidence is fully bound across manifest surfaces", async () => {
  const data = registryDataset();
  data.creditTransactions[0].data = {
    academyId: ACADEMY,
    sourceType: "unknown-type",
    sourceId: "opaque-source-id",
  };
  const baseline = await planDataset(data);
  const serializedSummary =
    JSON.parse(JSON.stringify(baseline.summary));
  const serializedManifest =
    JSON.parse(JSON.stringify(baseline.manifest));
  assert.doesNotThrow(() => assertExactPublicationParity(
      baseline.canonicalPlan,
      serializedSummary,
      serializedManifest,
  ));
  const findSurfaces = (manifest) => {
    const topLevel = manifest.referenceFindings.blockers.find(
        ({code}) => code === "unknown_credit_source_type",
    );
    const recordLevel = manifest.records
        .flatMap(({referenceFindings}) => referenceFindings)
        .find(({code}) => code === "unknown_credit_source_type");
    assert.ok(topLevel);
    assert.ok(recordLevel);
    return {topLevel, recordLevel};
  };
  const assertFindingTamperRejected = (manifest, label) => {
    const summary = JSON.parse(JSON.stringify(baseline.summary));
    assert.throws(() => assertExactPublicationParity(
        baseline.canonicalPlan,
        summary,
        manifest,
    ), undefined, label);
    const directory = secureTemporaryDirectory();
    const summaryOutput = path.join(directory, `${label}-summary.json`);
    const sensitiveOutput = path.join(directory, `${label}-sensitive.json`);
    assert.throws(() => writePlannerOutputs({
      summaryOutput,
      sensitiveOutput,
      canonicalPlan: baseline.canonicalPlan,
      summary,
      manifest,
    }), undefined, label);
    assert.equal(fs.existsSync(summaryOutput), false, label);
    assert.equal(fs.existsSync(sensitiveOutput), false, label);
    assert.deepEqual(fs.readdirSync(directory), [], label);
    assert.equal(baseline.summary.actualWrites, 0, label);
  };
  const changedEvidence = [
    ["sourceIdPresent", false],
    ["sourceTypePresent", false],
    ["sourceTypeKnown", true],
    ["sourceTypeCategory", "known"],
    ["actualShape", "array_strings"],
    ["lengthBucket", "17-32"],
    ["explicitLessonIdPresent", true],
    ["explicitReservationIdPresent", true],
    ["explicitSlotIdPresent", true],
  ];
  for (const [field, value] of changedEvidence) {
    for (const surface of ["topLevel", "recordLevel"]) {
      const manifest =
        JSON.parse(JSON.stringify(baseline.manifest));
      findSurfaces(manifest)[surface].creditSourceEvidence[field] = value;
      assertFindingTamperRejected(manifest, `${surface}.${field}`);
    }
  }
  for (const mutation of [
    (finding) => {
      finding.creditSourceEvidence.unbound = true;
    },
    (finding) => {
      delete finding.creditSourceEvidence.sourceIdPresent;
    },
    (finding) => {
      finding.unbound = true;
    },
  ]) {
    const manifest = JSON.parse(JSON.stringify(baseline.manifest));
    mutation(findSurfaces(manifest).topLevel);
    assertFindingTamperRejected(manifest, "finding-schema-tamper");
  }

  const coherentManifest =
    JSON.parse(JSON.stringify(baseline.manifest));
  const coherent = findSurfaces(coherentManifest);
  for (const finding of [coherent.topLevel, coherent.recordLevel]) {
    finding.creditSourceEvidence.sourceIdPresent = false;
    finding.publishedFindingDigest =
      publishedFindingRecordDigest(finding);
  }
  assertFindingTamperRejected(coherentManifest, "coherent-finding-tamper");

  const reorderedManifest =
    JSON.parse(JSON.stringify(baseline.manifest));
  const reordered = findSurfaces(reorderedManifest);
  for (const finding of [reordered.topLevel, reordered.recordLevel]) {
    finding.creditSourceEvidence = Object.fromEntries(
        Object.entries(finding.creditSourceEvidence).reverse(),
    );
  }
  assert.doesNotThrow(() => assertExactPublicationParity(
      baseline.canonicalPlan,
      JSON.parse(JSON.stringify(baseline.summary)),
      reorderedManifest,
  ));
});

test("finding identity deduplicates paths but preserves fields and shapes", async () => {
  const data = registryDataset();
  data.creditTransactions[0].data = {
    academyId: ACADEMY,
    sourceType: "privateReservation",
    sourceId: data.privateLessonReservations[0].id,
    reservationId: data.privateLessonReservations[0].id,
    slotId: data.privateLessonSlots[0].id,
  };
  const result = await planDataset(data);
  assert.equal(result.exitCode, 0);
  const record = result.manifest.records.find(
      ({collection}) => collection === "creditTransactions",
  );
  const slotFindings = record.referenceFindings.filter(
      ({field}) => field === "slotId",
  );
  assert.equal(slotFindings.length, 1);
  const globalFindingCount = Object.values(
      result.secondRun.referenceFindings,
  ).flat().length;
  assert.equal(result.manifest.referenceFindingCount, globalFindingCount);
  assert.equal(
      result.manifest.sensitiveRecordFindingCount,
      globalFindingCount,
  );

  const malformedData = registryDataset();
  malformedData.fixedPrivateRenewalBatches[0].data.created = [
    {lessons: null},
    {lessons: {unexpected: true}},
  ];
  const malformedResult = await planDataset(malformedData);
  const malformedFindings =
    malformedResult.secondRun.referenceFindings.blockers.filter(
        ({sourceTypedKey, field}) =>
          sourceTypedKey.startsWith("fixedPrivateRenewalBatches:") &&
          field === "created.lessons",
    );
  assert.deepEqual(
      malformedFindings.map(({shapeEvidence}) =>
        shapeEvidence.actualShape).sort(),
      ["null", "object"],
  );
});

test("legacy group class aliases agree or fail as ambiguous", async () => {
  const sameData = registryDataset();
  const groupId = sameData.groupClasses[0].id;
  sameData.groupStudents[0].data = {
    academyId: ACADEMY,
    groupClassId: groupId,
    classID: groupId,
  };
  const sameResult = await planDataset(sameData);
  assert.equal(sameResult.exitCode, 0);
  const manifestGroupStudent = sameResult.manifest.records.find(
      ({collection}) => collection === "groupStudents",
  );
  assert.deepEqual(
      manifestGroupStudent.directReferences
          .filter(({family}) => family === "group_class")
          .map(({field}) => field)
          .sort(),
      ["classID", "groupClassId"],
  );

  const conflictData = registryDataset();
  conflictData.groupStudents[0].data = {
    academyId: ACADEMY,
    groupClassId: conflictData.groupClasses[0].id,
    classID: "different-group",
  };
  const conflictResult = await planDataset(conflictData);
  assert.equal(conflictResult.exitCode, 2);
  assert.equal(
      conflictResult.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "ambiguous_reference_alias",
      ),
      true,
  );
});

test("groupLessons resolves classId and classID as one typed alias", async () => {
  const runCase = async (lessonData) => {
    const data = registryDataset();
    const groupClassId = data.groupClasses[0].id;
    data.privateStudents.push({
      id: groupClassId,
      data: {academyId: ACADEMY},
    });
    data.groupLessons[0].data = {
      academyId: ACADEMY,
      ...lessonData(groupClassId),
    };
    return {
      result: await planDataset(data),
      groupClassId,
    };
  };

  for (const field of ["classId", "classID"]) {
    const {result, groupClassId} = await runCase((value) => ({
      [field]: value,
    }));
    assert.equal(result.exitCode, 0, `${field} only`);
    assert.equal(result.summary.totals.referenceBlockerCount, 0);
    const record = result.manifest.records.find(
        ({collection}) => collection === "groupLessons",
    );
    const references = record.directReferences.filter(
        ({family}) => family === "group_class",
    );
    assert.equal(references.length, 1);
    assert.deepEqual(
        references[0].candidateTypedKeys,
        [`groupClasses:${groupClassId}`],
    );
    assert.equal(
        references[0].candidateTypedKeys.includes(
            `privateStudents:${groupClassId}`,
        ),
        false,
    );
  }

  const equal = await runCase((value) => ({
    classId: value,
    classID: value,
  }));
  assert.equal(equal.result.exitCode, 0);
  const equalRecord = equal.result.manifest.records.find(
      ({collection}) => collection === "groupLessons",
  );
  const equalReferences = equalRecord.directReferences.filter(
      ({family}) => family === "group_class",
  );
  assert.equal(equalReferences.length, 1);
  assert.equal(equalReferences[0].conflict, false);
  assert.equal(equalReferences[0].resolvedValue, equal.groupClassId);
  assert.deepEqual(
      equalReferences[0].aliasEvidence,
      [
        {field: "classId", value: equal.groupClassId},
        {field: "classID", value: equal.groupClassId},
      ],
  );

  const conflictData = registryDataset();
  const firstGroupClassId = conflictData.groupClasses[0].id;
  const secondGroupClassId = "second-group-class";
  conflictData.groupClasses.push({
    id: secondGroupClassId,
    data: {academyId: ACADEMY},
  });
  conflictData.groupLessons[0].data = {
    academyId: ACADEMY,
    classId: firstGroupClassId,
    classID: secondGroupClassId,
  };
  const conflictResult = await planDataset(conflictData);
  assert.equal(conflictResult.exitCode, 2);
  const conflictRecord = conflictResult.manifest.records.find(
      ({collection}) => collection === "groupLessons",
  );
  assert.equal(
      conflictRecord.directReferences.some(
          ({family}) => family === "group_class",
      ),
      false,
  );
  const aliasBlocker =
    conflictResult.secondRun.referenceFindings.blockers.find(
        ({code, sourceTypedKey}) =>
          code === "ambiguous_reference_alias" &&
          sourceTypedKey.startsWith("groupLessons:"),
    );
  assert.ok(aliasBlocker);
  assert.equal(aliasBlocker.resolvedValue, null);
  assert.equal(aliasBlocker.conflict, true);
  assert.deepEqual(aliasBlocker.aliasEvidence, [
    {field: "classId", value: firstGroupClassId},
    {field: "classID", value: secondGroupClassId},
  ]);
  const redacted = JSON.stringify(conflictResult.summary);
  assert.equal(redacted.includes(firstGroupClassId), false);
  assert.equal(redacted.includes(secondGroupClassId), false);
});

test("reschedule updated ID arrays are typed and fail closed", async () => {
  const validData = registryDataset();
  validData.fixedPrivateRescheduleBatches[0].data = {
    academyId: ACADEMY,
    updatedLessonIds: [validData.lessons[0].id, validData.lessons[0].id],
    updatedSlotIds: [validData.privateLessonSlots[0].id],
    updatedReservationIds: [validData.privateLessonReservations[0].id],
  };
  const validResult = await planDataset(validData);
  assert.equal(validResult.exitCode, 0);
  assert.ok(validResult.summary.totals.referenceWarningCount >= 3);

  const missingData = registryDataset();
  missingData.fixedPrivateRescheduleBatches[0].data.updatedLessonIds =
    ["missing-lesson"];
  const missingResult = await planDataset(missingData);
  assert.equal(missingResult.exitCode, 0);
  assert.ok(missingResult.summary.totals.referenceDiagnosticCount > 0);

  for (const malformedValue of ["not-an-array", ["valid", 7]]) {
    const malformedData = registryDataset();
    malformedData.fixedPrivateRescheduleBatches[0].data.updatedLessonIds =
      malformedValue;
    const malformedResult = await planDataset(malformedData);
    assert.equal(malformedResult.exitCode, 2);
  }

  const crossData = registryDataset();
  crossData.lessons.push({
    id: "other-academy-lesson",
    data: {academyId: "academy_other"},
  });
  crossData.fixedPrivateRescheduleBatches[0].data.updatedLessonIds =
    ["other-academy-lesson"];
  const crossResult = await planDataset(crossData);
  assert.equal(crossResult.exitCode, 2);
  assert.equal(
      crossResult.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "cross_academy_reference",
      ),
      true,
  );
});

test("credit sourceId uses exact sourceType mappings", async () => {
  const validData = registryDataset();
  validData.creditTransactions[0].data = {
    academyId: ACADEMY,
    sourceType: "privateReservation",
    sourceId: validData.privateLessonReservations[0].id,
    reservationId: validData.privateLessonReservations[0].id,
  };
  const validResult = await planDataset(validData);
  assert.equal(validResult.exitCode, 0);

  for (const [sourceType, targetCollection] of [
    ["lesson", "lessons"],
    ["groupClass", "groupClasses"],
  ]) {
    const knownData = registryDataset();
    knownData.creditTransactions[0].data = {
      academyId: ACADEMY,
      sourceType,
      sourceId: knownData[targetCollection][0].id,
    };
    const knownResult = await planDataset(knownData);
    assert.equal(knownResult.exitCode, 0, sourceType);
    const creditRecord = knownResult.manifest.records.find(
        ({collection}) => collection === "creditTransactions",
    );
    assert.equal(
        creditRecord.creditSourceEvidence.sourceTypeLiteral,
        sourceType,
    );
    assert.equal(creditRecord.creditSourceEvidence.sourceTypeKnown, true);
    assert.equal(
        creditRecord.directReferences.some(
            ({family, candidateTypedKeys}) =>
              family === "credit_source" &&
              candidateTypedKeys.includes(
                  `${targetCollection}:${knownData[targetCollection][0].id}`,
              ),
        ),
        true,
        sourceType,
    );
  }

  for (const sourceData of [
    {sourceId: "missing-reservation"},
    {sourceType: "unknown-type", sourceId: "missing-reservation"},
    {
      sourceType: "privateReservation",
      sourceId: validData.privateLessonReservations[0].id,
      reservationId: "different-reservation",
    },
  ]) {
    const blockedData = registryDataset();
    blockedData.creditTransactions[0].data = {
      academyId: ACADEMY,
      ...sourceData,
    };
    const blockedResult = await planDataset(blockedData);
    assert.equal(blockedResult.exitCode, 2);
  }

  const missingData = registryDataset();
  missingData.creditTransactions[0].data = {
    academyId: ACADEMY,
    sourceType: "privateReservation",
    sourceId: "missing-reservation",
  };
  const missingResult = await planDataset(missingData);
  assert.equal(missingResult.exitCode, 0);
  assert.ok(missingResult.summary.totals.referenceDiagnosticCount > 0);

  const crossData = registryDataset();
  crossData.privateLessonReservations.push({
    id: "other-reservation",
    data: {academyId: "academy_other"},
  });
  crossData.creditTransactions[0].data = {
    academyId: ACADEMY,
    sourceType: "privateReservation",
    sourceId: "other-reservation",
  };
  const crossResult = await planDataset(crossData);
  assert.equal(crossResult.exitCode, 2);
});

test("pagination completes with more documents than page size", async () => {
  const data = registryDataset();
  data.dailyMaterials = Array.from({length: 7}, (_, index) => ({
    id: `daily-material-${String(index).padStart(2, "0")}`,
    data: {academyId: ACADEMY},
  }));
  const result = await buildAcademyScopedResetPlan({
    db: new FakeFirestore(data),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.collections.dailyMaterials.scanned, 7);
  assert.equal(result.summary.collections.dailyMaterials.pageCount, 4);
  assert.equal(result.summary.collections.dailyMaterials.complete, true);
  assert.equal(result.summary.collections.dailyMaterials.truncated, false);
  assert.equal(result.summary.collections.dailyMaterials.omitted, 0);
});

test("typed Firestore canonicalization preserves every value type", () => {
  class DocumentReference {
    constructor() {
      this.path = "users/user-1";
      this.id = "user-1";
    }
  }
  class GeoPoint {
    constructor() {
      this.latitude = 35.1;
      this.longitude = 128.2;
    }
  }
  assert.deepEqual(canonicalizeFirestoreValue(null), ["null"]);
  assert.deepEqual(canonicalizeFirestoreValue(true), ["boolean", true]);
  assert.deepEqual(canonicalizeFirestoreValue("NaN"), ["string", "NaN"]);
  assert.deepEqual(canonicalizeFirestoreValue(NaN), ["number", "NaN"]);
  assert.deepEqual(
      canonicalizeFirestoreValue(Number.POSITIVE_INFINITY),
      ["number", "+Infinity"],
  );
  assert.deepEqual(
      canonicalizeFirestoreValue(Number.NEGATIVE_INFINITY),
      ["number", "-Infinity"],
  );
  assert.deepEqual(canonicalizeFirestoreValue(-0), ["number", "-0"]);
  assert.deepEqual(canonicalizeFirestoreValue(0), ["number", "0"]);
  assert.deepEqual(
      canonicalizeFirestoreValue(new Date("2026-01-02T03:04:05.000Z")),
      ["date", "2026-01-02T03:04:05.000Z"],
  );
  assert.deepEqual(
      canonicalizeFirestoreValue(Buffer.from([0, 1, 255])),
      ["bytes", "AAH/"],
  );
  assert.deepEqual(
      canonicalizeFirestoreValue(new Timestamp(0, 123000000)),
      ["firestore_timestamp", "0", "123000000"],
  );
  assert.deepEqual(
      canonicalizeFirestoreValue(new DocumentReference()),
      ["documentReference", "users/user-1"],
  );
  assert.deepEqual(
      canonicalizeFirestoreValue(new GeoPoint()),
      ["geoPoint", ["35.1", "128.2"]],
  );

  const unequalPairs = [
    [NaN, null],
    [NaN, Number.POSITIVE_INFINITY],
    [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    [0, -0],
    [NaN, "NaN"],
    [Number.POSITIVE_INFINITY, "Infinity"],
    [{nested: {value: NaN}}, {nested: {value: null}}],
    [{items: [NaN]}, {items: [null]}],
    [{items: [Number.POSITIVE_INFINITY]},
      {items: [Number.NEGATIVE_INFINITY]}],
    [[NaN, null], [null, NaN]],
    [NaN, {type: "number", value: "NaN"}],
    [new Timestamp(), {toMillis: 123}],
    [new Timestamp(100, 1), new Timestamp(100, 999999)],
    [new Timestamp(100, 0), new Date(100000)],
    [new Timestamp(100, 1), {
      0: "firestore_timestamp",
      1: "100",
      2: "1",
    }],
    [new Timestamp(100, 1), ["firestore_timestamp", "100", "1"]],
    [new DocumentReference(),
      {path: "users/user-1", id: "user-1"}],
    [new GeoPoint(), {latitude: 35.1, longitude: 128.2}],
    [null, ["null"]],
    [null, "null"],
  ];
  for (const [left, right] of unequalPairs) {
    assert.notEqual(
        firestoreDocumentDigest(left),
        firestoreDocumentDigest(right),
        `${String(left)} must not collide with ${String(right)}`,
    );
  }
  assert.equal(firestoreDocumentDigest(NaN), firestoreDocumentDigest(NaN));
  assert.equal(
      firestoreDocumentDigest(new Timestamp(-62135596800, 0)),
      firestoreDocumentDigest(new Timestamp(-62135596800, 0)),
  );
  assert.equal(
      firestoreDocumentDigest(Number.POSITIVE_INFINITY),
      firestoreDocumentDigest(Number.POSITIVE_INFINITY),
  );
  assert.equal(
      firestoreDocumentDigest(Number.NEGATIVE_INFINITY),
      firestoreDocumentDigest(Number.NEGATIVE_INFINITY),
  );
  assert.equal(
      firestoreDocumentDigest({a: 1, b: {x: 2, y: 3}}),
      firestoreDocumentDigest({b: {y: 3, x: 2}, a: 1}),
  );

  for (const value of [
    NaN,
    Number.POSITIVE_INFINITY,
    Number.NEGATIVE_INFINITY,
    undefined,
    1n,
    Symbol("unsupported"),
    () => {},
  ]) {
    assert.throws(
        () => stableStringify(value),
        PlannerConfigError,
    );
  }
});

test("double-run digest detects non-finite Firestore value races", async () => {
  const planTransition = async (firstValue, secondValue) => {
    const data = registryDataset();
    data.dailyMaterials[0].data.marker = clone(firstValue);
    const db = new FakeFirestore(data);
    return buildAcademyScopedResetPlan({
      db,
      project: PROJECT,
      academy: ACADEMY,
      releaseSha: BASE_SHA,
      runtimeSourceIdentity: runtimeSourceIdentity(),
      pageSize: 2,
      beforeSecondRun: async () => {
        db.data.dailyMaterials[0].data.marker = clone(secondValue);
      },
    });
  };
  const dailyMaterialDigest = (run) => run.records.find(
      ({collection}) => collection === "dailyMaterials",
  ).documentDigest;

  const mismatches = [
    ["nan-to-null", NaN, null],
    ["null-to-nan", null, NaN],
    ["nan-to-positive-infinity", NaN, Number.POSITIVE_INFINITY],
    ["positive-to-negative-infinity",
      Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ["zero-to-negative-zero", 0, -0],
    ["nested-nan-to-null", {nested: {value: NaN}},
      {nested: {value: null}}],
    ["array-nan-to-null", {items: [NaN]}, {items: [null]}],
    ["array-infinity-sign", {items: [Number.POSITIVE_INFINITY]},
      {items: [Number.NEGATIVE_INFINITY]}],
    ["array-order", {items: [NaN, null]}, {items: [null, NaN]}],
    ["timestamp-nanoseconds",
      new Timestamp(100, 1), new Timestamp(100, 999999)],
    ["timestamp-to-null", new Timestamp(100, 1), null],
    ["timestamp-to-date",
      new Timestamp(100, 0), new Date(100000)],
    ["nested-timestamp", {nested: {value: new Timestamp(100, 1)}},
      {nested: {value: new Timestamp(100, 999999)}}],
    ["array-timestamp", {items: [new Timestamp(100, 1)]},
      {items: [new Timestamp(100, 999999)]}],
  ];
  for (const [label, firstValue, secondValue] of mismatches) {
    const result = await planTransition(firstValue, secondValue);
    assert.equal(result.exitCode, 3, label);
    assert.equal(result.summary.consistency, false, label);
    assert.equal(result.summary.complete, false, label);
    assert.equal(result.manifest, null, label);
    assert.equal(result.summary.actualWrites, 0, label);
    assert.notEqual(result.firstRun.runDigest, result.secondRun.runDigest, label);
    assert.notEqual(
        result.firstRun.collectionSummaries.dailyMaterials.digest,
        result.secondRun.collectionSummaries.dailyMaterials.digest,
        label,
    );
    assert.notEqual(
        dailyMaterialDigest(result.firstRun),
        dailyMaterialDigest(result.secondRun),
        label,
    );
    assert.equal(
        result.firstRun.firestoreValueCanonicalizationVersion,
        3,
        label,
    );
    assert.equal(
        result.secondRun.firestoreValueCanonicalizationVersion,
        3,
        label,
    );
  }

  for (const [label, firstValue, secondValue] of [
    ["stable-nan", NaN, NaN],
    ["stable-positive-infinity",
      Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY],
    ["stable-negative-infinity",
      Number.NEGATIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ["map-key-order", {a: NaN, b: Number.POSITIVE_INFINITY},
      {b: Number.POSITIVE_INFINITY, a: NaN}],
    ["stable-timestamp",
      new Timestamp(100, 1), new Timestamp(100, 1)],
  ]) {
    const result = await planTransition(firstValue, secondValue);
    assert.equal(result.exitCode, 0, label);
    assert.equal(result.summary.consistency, true, label);
    assert.equal(result.summary.complete, true, label);
    assert.ok(result.manifest, label);
    assert.equal(result.summary.actualWrites, 0, label);
    assert.equal(result.firstRun.runDigest, result.secondRun.runDigest, label);
    assert.equal(
        result.firstRun.collectionSummaries.dailyMaterials.digest,
        result.secondRun.collectionSummaries.dailyMaterials.digest,
        label,
    );
    assert.equal(
        dailyMaterialDigest(result.firstRun),
        dailyMaterialDigest(result.secondRun),
        label,
    );
  }

  const rejected = await planTransition(NaN, null);
  const directory = secureTemporaryDirectory();
  assert.throws(() => writePlannerOutputs({
    summaryOutput: path.join(directory, "summary.json"),
    sensitiveOutput: path.join(directory, "sensitive.json"),
    canonicalPlan: rejected.canonicalPlan,
    summary: rejected.summary,
    manifest: rejected.manifest,
  }));
  assert.deepEqual(fs.readdirSync(directory), []);
});

test("double-run mismatch returns exit 3 and no sensitive manifest", async () => {
  const db = new FakeFirestore(registryDataset());
  const result = await buildAcademyScopedResetPlan({
    db,
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
    beforeSecondRun: async () => {
      db.data.dailyMaterials.push({
        id: "inserted-between-runs",
        data: {academyId: ACADEMY},
      });
    },
  });
  assert.equal(result.exitCode, 3);
  assert.equal(result.summary.consistency, false);
  assert.equal(result.summary.planned.deletes, 0);
  assert.equal(result.manifest, null);
});

test("root collection discovery fails closed across scan and final races", async () => {
  const planWithBehavior = (behavior) => buildAcademyScopedResetPlan({
    db: new FakeFirestore(registryDataset(), behavior),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
  });
  const assertIncompleteNotPublishable = (result, label) => {
    const directory = secureTemporaryDirectory();
    const summaryOutput = path.join(directory, `${label}-summary.json`);
    const sensitiveOutput = path.join(directory, `${label}-sensitive.json`);
    assert.throws(() => writePlannerOutputs({
      summaryOutput,
      sensitiveOutput,
      canonicalPlan: result.canonicalPlan,
      summary: result.summary,
      manifest: result.manifest,
    }), /Only a complete and consistent plan pair can be published/);
    assert.deepEqual(fs.readdirSync(directory), []);
    assert.equal(result.summary.actualWrites, 0);
  };

  const addedDuringSecondRun = await planWithBehavior({
    afterListCollections({db, callCount}) {
      if (callCount === 3) {
        db.data.lateUnknownCollection = [{
          id: "late-row",
          data: {academyId: ACADEMY},
        }];
      }
    },
  });
  assert.equal(addedDuringSecondRun.exitCode, 3);
  assert.equal(addedDuringSecondRun.summary.complete, false);
  assert.equal(addedDuringSecondRun.summary.consistency, false);
  assert.equal(
      addedDuringSecondRun.secondRun.rootCollectionSetStable,
      false,
  );
  assert.equal(addedDuringSecondRun.manifest, null);
  assert.equal(addedDuringSecondRun.summary.actualWrites, 0);
  assertIncompleteNotPublishable(
      addedDuringSecondRun,
      "run-start-end-addition",
  );

  const addedBeforeFinalDiscovery = await planWithBehavior({
    beforeListCollections({db, callCount}) {
      if (callCount === 5) {
        db.data.finalUnknownCollection = [{
          id: "final-row",
          data: {academyId: ACADEMY},
        }];
      }
    },
  });
  assert.equal(addedBeforeFinalDiscovery.exitCode, 3);
  assert.equal(addedBeforeFinalDiscovery.summary.complete, false);
  assert.equal(addedBeforeFinalDiscovery.summary.consistency, false);
  assert.equal(addedBeforeFinalDiscovery.firstRun.rootCollectionSetStable, true);
  assert.equal(
      addedBeforeFinalDiscovery.secondRun.rootCollectionSetStable,
      true,
  );
  assert.equal(addedBeforeFinalDiscovery.finalMatchesRun1, false);
  assert.equal(addedBeforeFinalDiscovery.finalMatchesRun2, false);
  assert.equal(addedBeforeFinalDiscovery.manifest, null);
  assertIncompleteNotPublishable(
      addedBeforeFinalDiscovery,
      "end-final-addition",
  );

  const sameCountSwap = await planWithBehavior({
    afterListCollections({db, callCount}) {
      if (callCount === 3) {
        delete db.data.dailyMaterials;
        db.data.sameCountReplacementCollection = [{
          id: "replacement-row",
          data: {academyId: ACADEMY},
        }];
      }
    },
  });
  assert.equal(sameCountSwap.exitCode, 3);
  assert.equal(sameCountSwap.summary.consistency, false);
  assert.equal(sameCountSwap.secondRun.rootCollectionSetStable, false);
  assert.equal(
      sameCountSwap.secondRun.startRootCollectionCount,
      sameCountSwap.secondRun.endRootCollectionCount,
  );
  assert.notEqual(
      sameCountSwap.secondRun.startRootCollectionSetDigest,
      sameCountSwap.secondRun.endRootCollectionSetDigest,
  );
  assertIncompleteNotPublishable(sameCountSwap, "same-count-swap");

  const reorderedOnly = await planWithBehavior({
    reverseCollectionOrder: true,
  });
  assert.equal(reorderedOnly.exitCode, 0);
  assert.equal(reorderedOnly.summary.complete, true);
  assert.equal(reorderedOnly.summary.consistency, true);
  assert.equal(reorderedOnly.firstRun.rootCollectionSetStable, true);
  assert.equal(reorderedOnly.secondRun.rootCollectionSetStable, true);
  assert.equal(reorderedOnly.finalMatchesRun1, true);
  assert.equal(reorderedOnly.finalMatchesRun2, true);
  assert.equal(
      reorderedOnly.firstRun.startRootCollectionSetDigest,
      reorderedOnly.firstRun.endRootCollectionSetDigest,
  );
});

test("collection discovery inconsistency publishes no files", () => {
  const source = syntheticPlannerRepository();
  for (const [label, rootDiscovery] of [
    ["run-start-end-addition", {
      addAfterCall: 3,
      collectionName: "lateUnknownCollection",
    }],
    ["end-final-addition", {
      addBeforeCall: 5,
      collectionName: "finalUnknownCollection",
    }],
  ]) {
    const probe = executeSyntheticCliProbe({
      plannerPath: source.plannerPath,
      releaseSha: source.head,
      data: registryDataset(),
      behavior: {$rootDiscovery: rootDiscovery},
    });
    assert.equal(probe.exitCode, 3, label);
    assert.equal(probe.stdout.length, 0, label);
    assert.equal(JSON.parse(probe.stderr[0]).actualWrites, 0, label);
    assert.equal(fs.existsSync(probe.summaryOutput), false, label);
    assert.equal(fs.existsSync(probe.sensitiveOutput), false, label);
    assert.deepEqual(fs.readdirSync(path.dirname(probe.summaryOutput)), []);
  }
});

test("redacted summary excludes raw paths and PII", async () => {
  const data = registryDataset();
  data.dailyMaterials[0].id = "distinctive-raw-document-9274";
  const result = await buildAcademyScopedResetPlan({
    db: new FakeFirestore(data),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
  });
  const rendered = JSON.stringify(result.summary);
  assert.equal(rendered.includes("distinctive-raw-document-9274"), false);
  assert.equal(rendered.includes("@example.com"), false);
  for (const forbidden of [
    "rawDocumentPath",
    "typedDocumentKey",
    "documentId",
  ]) {
    assert.equal(rendered.includes(forbidden), false);
  }
});

test("sensitive output is mode 0600, atomic, and no-clobber", async () => {
  const directory = secureTemporaryDirectory();
  const summaryOutput = path.join(directory, "summary.json");
  const sensitiveOutput = path.join(directory, "sensitive.json");
  const result = await planDataset(registryDataset());
  const {summary, manifest} = result;
  writePlannerOutputs({
    summaryOutput,
    sensitiveOutput,
    canonicalPlan: result.canonicalPlan,
    summary,
    manifest,
  });
  assert.equal(fs.statSync(summaryOutput).mode & 0o777, 0o600);
  assert.equal(fs.statSync(sensitiveOutput).mode & 0o777, 0o600);
  assert.throws(() => writePlannerOutputs({
    summaryOutput,
    sensitiveOutput,
    canonicalPlan: result.canonicalPlan,
    summary,
    manifest,
  }));
  assert.equal(
      fs.readdirSync(directory).some((name) => name.endsWith(".tmp")),
      false,
  );
});

test("CLI writes aggregate-only output and never authorizes writes", async () => {
  const source = syntheticPlannerRepository();
  const probe = executeSyntheticCliProbe({
    plannerPath: source.plannerPath,
    releaseSha: source.head,
    data: registryDataset(),
  });
  assert.equal(probe.exitCode, 0);
  assert.equal(probe.databaseInitCount, 1);
  assert.equal(probe.stderr.length, 0);
  assert.equal(probe.stdout.length, 1);
  const output = JSON.parse(probe.stdout[0]);
  assert.equal(output.actualWrites, 0);
  assert.equal(output.writeAuthorized, false);
  assert.equal(output.executorImplemented, false);
  assert.equal(
      probe.stdout[0].includes("privateStudents-target-document"),
      false,
  );
  assert.equal(fs.existsSync(probe.summaryOutput), true);
  assert.equal(fs.existsSync(probe.sensitiveOutput), true);
  assert.equal(probe.summary.runtimeHeadSha, source.head);
  assert.equal(probe.summary.runtimeTreeSha, source.tree);
  assert.equal(probe.summary.criticalRuntimeSources.length, 2);
  probe.summary.criticalRuntimeSources.forEach((criticalSource) => {
    assert.equal(criticalSource.tracked, true);
    assert.equal(criticalSource.bytesMatch, true);
    assert.equal(criticalSource.indexFlagsClean, true);
    assert.equal(
        criticalSource.runtimeSha256,
        criticalSource.headBlobSha256,
    );
  });
});

test("Git environment cannot redirect source identity validation", () => {
  const dirtySource = syntheticPlannerRepository({dirty: true});
  const cleanSpoof = syntheticEmptyRepository();
  assert.notEqual(
      runFixtureGit(dirtySource.repositoryRoot, [
        "status", "--porcelain=v1", "--untracked-files=all",
      ]),
      "",
  );
  assert.equal(
      runFixtureGit(cleanSpoof.repositoryRoot, [
        "status", "--porcelain=v1", "--untracked-files=all",
      ]),
      "",
  );
  const probe = executeSyntheticCliProbe({
    plannerPath: dirtySource.plannerPath,
    releaseSha: dirtySource.head,
    gitEnvironment: {
      GIT_DIR: path.join(cleanSpoof.repositoryRoot, ".git"),
      GIT_WORK_TREE: cleanSpoof.repositoryRoot,
    },
  });
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.databaseInitCount, 0);
  assert.equal(probe.stdout.length, 0);
  assert.equal(fs.existsSync(probe.summaryOutput), false);
  assert.equal(fs.existsSync(probe.sensitiveOutput), false);
});

test("sanitized Git identity accepts only the clean planner repository", () => {
  const source = syntheticPlannerRepository();
  const spoof = syntheticEmptyRepository();
  const probe = executeSyntheticCliProbe({
    plannerPath: source.plannerPath,
    releaseSha: source.head,
    gitEnvironment: {
      GIT_DIR: path.join(spoof.repositoryRoot, ".git"),
      GIT_WORK_TREE: spoof.repositoryRoot,
      GIT_COMMON_DIR: path.join(spoof.repositoryRoot, ".git"),
      GIT_INDEX_FILE: path.join(spoof.repositoryRoot, ".git", "index"),
      GIT_OBJECT_DIRECTORY:
        path.join(spoof.repositoryRoot, ".git", "objects"),
      GIT_ALTERNATE_OBJECT_DIRECTORIES:
        path.join(spoof.repositoryRoot, ".git", "objects"),
      GIT_NAMESPACE: "spoof",
      GIT_CEILING_DIRECTORIES: source.repositoryRoot,
      GIT_DISCOVERY_ACROSS_FILESYSTEM: "1",
      GIT_EXEC_PATH: "/definitely/not/a/git/exec/path",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "core.worktree",
      GIT_CONFIG_VALUE_0: spoof.repositoryRoot,
    },
  });
  assert.equal(probe.exitCode, 0);
  assert.equal(probe.databaseInitCount, 1);
  assert.equal(probe.summary.runtimeHeadSha, source.head);
  assert.equal(probe.summary.runtimeTreeSha, source.tree);
});

test("runtime release identity failures precede Firestore and outputs", () => {
  const cleanSource = syntheticPlannerRepository();
  const dirtySource = syntheticPlannerRepository({dirty: true});
  const withoutGit = syntheticPlannerWithoutGit();
  const outsideRepository = syntheticPlannerOutsideRepository();
  const misplacedSource = syntheticPlannerRepository();
  const misplacedPlannerPath = path.join(
      misplacedSource.repositoryRoot,
      "functions",
      "scripts",
      "planner-copy.mjs",
  );
  fs.copyFileSync(misplacedSource.plannerPath, misplacedPlannerPath);
  const misplacedIdentity = commitFixtureChanges(
      misplacedSource.repositoryRoot,
      "add misplaced planner copy",
  );
  const cases = [
    {
      name: "wrong release SHA",
      plannerPath: cleanSource.plannerPath,
      releaseSha: "f".repeat(40),
    },
    {
      name: "arbitrary 40-character SHA",
      plannerPath: cleanSource.plannerPath,
      releaseSha: "a".repeat(40),
    },
    {
      name: "dirty worktree",
      plannerPath: dirtySource.plannerPath,
      releaseSha: dirtySource.head,
    },
    {
      name: "missing Git metadata",
      plannerPath: withoutGit.plannerPath,
      releaseSha: cleanSource.head,
    },
    {
      name: "planner source outside repository",
      plannerPath: outsideRepository.plannerPath,
      releaseSha: outsideRepository.head,
    },
    {
      name: "planner source at non-allowlisted repository path",
      plannerPath: misplacedPlannerPath,
      releaseSha: misplacedIdentity.head,
    },
  ];
  for (const item of cases) {
    const probe = executeSyntheticCliProbe(item);
    assert.equal(probe.exitCode, 1, item.name);
    assert.equal(probe.databaseInitCount, 0, item.name);
    assert.equal(probe.stdout.length, 0, item.name);
    assert.equal(fs.existsSync(probe.summaryOutput), false, item.name);
    assert.equal(fs.existsSync(probe.sensitiveOutput), false, item.name);
  }
});

test("planner source file must be tracked by the runtime HEAD", () => {
  const source = syntheticPlannerRepository();
  runFixtureGit(source.repositoryRoot, [
    "rm", "--cached",
    "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
  ]);
  fs.writeFileSync(
      path.join(source.repositoryRoot, ".gitignore"),
      "functions/scripts/plan-academy-scoped-test-data-reset.mjs\n",
      {mode: 0o600},
  );
  runFixtureGit(source.repositoryRoot, ["add", ".gitignore"]);
  runFixtureGit(source.repositoryRoot, [
    "-c", "user.name=Planner Test",
    "-c", "user.email=planner-test@example.invalid",
    "commit", "--quiet", "-m", "untrack planner",
  ]);
  const head = runFixtureGit(source.repositoryRoot, ["rev-parse", "HEAD"]);
  const probe = executeSyntheticCliProbe({
    plannerPath: source.plannerPath,
    releaseSha: head,
  });
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.databaseInitCount, 0);
  assert.equal(fs.existsSync(probe.summaryOutput), false);
  assert.equal(fs.existsSync(probe.sensitiveOutput), false);
});

test("ignored local registry is rejected when absent from HEAD", () => {
  const source = syntheticPlannerRepository();
  const registryPath =
    "functions/scripts/academy-scoped-test-data-reset-registry.mjs";
  runFixtureGit(source.repositoryRoot, [
    "rm", "--cached", registryPath,
  ]);
  fs.writeFileSync(
      path.join(source.repositoryRoot, ".gitignore"),
      `${registryPath}\n`,
      {mode: 0o600},
  );
  const identity = commitFixtureChanges(
      source.repositoryRoot,
      "remove runtime registry from HEAD",
  );
  fs.appendFileSync(
      path.join(source.repositoryRoot, registryPath),
      "\nthrow new Error(\"UNTRACKED_REGISTRY_EVALUATED\");\n",
  );
  assert.equal(
      fs.existsSync(path.join(source.repositoryRoot, registryPath)),
      true,
  );
  assert.equal(
      runFixtureGit(source.repositoryRoot, [
        "status", "--porcelain=v1", "--untracked-files=all",
      ]),
      "",
  );
  assert.throws(() => runFixtureGit(source.repositoryRoot, [
    "cat-file", "-e", `HEAD:${registryPath}`,
  ]));

  const probe = executeSyntheticCliProbe({
    plannerPath: source.plannerPath,
    releaseSha: identity.head,
  });
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.databaseInitCount, 0);
  assert.equal(probe.stdout.length, 0);
  assert.equal(fs.existsSync(probe.summaryOutput), false);
  assert.equal(fs.existsSync(probe.sensitiveOutput), false);
  assert.match(
      JSON.parse(probe.stderr[0]).error,
      /^critical_runtime_source_not_tracked:/,
  );
  assert.equal(
      probe.stderr.some((line) =>
        line.includes("UNTRACKED_REGISTRY_EVALUATED"),
      ),
      false,
  );
});

test("critical runtime source symlinks are rejected", () => {
  const source = syntheticPlannerRepository();
  const scriptsDirectory = path.join(
      source.repositoryRoot,
      "functions",
      "scripts",
  );
  const registryName =
    "academy-scoped-test-data-reset-registry.mjs";
  const targetName = "registry-symlink-target.mjs";
  fs.renameSync(
      path.join(scriptsDirectory, registryName),
      path.join(scriptsDirectory, targetName),
  );
  fs.symlinkSync(targetName, path.join(scriptsDirectory, registryName));
  const identity = commitFixtureChanges(
      source.repositoryRoot,
      "replace runtime registry with symlink",
  );
  assert.equal(
      runFixtureGit(source.repositoryRoot, [
        "ls-tree", "HEAD", "--",
        `functions/scripts/${registryName}`,
      ]).startsWith("120000 blob "),
      true,
  );
  const probe = executeSyntheticCliProbe({
    plannerPath: source.plannerPath,
    releaseSha: identity.head,
  });
  assert.equal(probe.exitCode, 1);
  assert.equal(probe.databaseInitCount, 0);
  assert.equal(fs.existsSync(probe.summaryOutput), false);
  assert.equal(fs.existsSync(probe.sensitiveOutput), false);
  assert.match(
      JSON.parse(probe.stderr[0]).error,
      /^critical_runtime_source_not_regular_file:/,
  );
});

test("hidden critical source byte changes fail closed", () => {
  const cases = [
    {
      name: "skip-worktree planner",
      flag: "--skip-worktree",
      paths: [
        "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
      ],
    },
    {
      name: "skip-worktree registry",
      flag: "--skip-worktree",
      paths: [
        "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
      ],
    },
    {
      name: "skip-worktree both",
      flag: "--skip-worktree",
      paths: [...CRITICAL_RUNTIME_SOURCE_PATHS],
    },
    {
      name: "assume-unchanged planner",
      flag: "--assume-unchanged",
      paths: [
        "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
      ],
    },
    {
      name: "skip-worktree with Git environment spoof",
      flag: "--skip-worktree",
      paths: [
        "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
      ],
      spoofGitEnvironment: true,
    },
  ];
  for (const item of cases) {
    const source = syntheticPlannerRepository();
    runFixtureGit(source.repositoryRoot, [
      "update-index", item.flag, ...item.paths,
    ]);
    item.paths.forEach((relativePath) => {
      fs.appendFileSync(
          path.join(source.repositoryRoot, relativePath),
          `\n// hidden source mutation: ${item.name}\n`,
      );
      assert.notEqual(
          runFixtureGit(source.repositoryRoot, [
            "hash-object", relativePath,
          ]),
          runFixtureGit(source.repositoryRoot, [
            "rev-parse", `HEAD:${relativePath}`,
          ]),
          item.name,
      );
    });
    assert.equal(
        runFixtureGit(source.repositoryRoot, [
          "status", "--porcelain=v1", "--untracked-files=all",
        ]),
        "",
        item.name,
    );
    let gitEnvironment = {};
    if (item.spoofGitEnvironment) {
      const spoof = syntheticEmptyRepository();
      gitEnvironment = {
        GIT_DIR: path.join(spoof.repositoryRoot, ".git"),
        GIT_WORK_TREE: spoof.repositoryRoot,
      };
    }
    const probe = executeSyntheticCliProbe({
      plannerPath: source.plannerPath,
      releaseSha: source.head,
      gitEnvironment,
    });
    assert.equal(probe.exitCode, 1, item.name);
    assert.equal(probe.databaseInitCount, 0, item.name);
    assert.equal(probe.stdout.length, 0, item.name);
    assert.equal(fs.existsSync(probe.summaryOutput), false, item.name);
    assert.equal(fs.existsSync(probe.sensitiveOutput), false, item.name);
    assert.match(
        JSON.parse(probe.stderr[0]).error,
        /^critical_runtime_source_bytes_mismatch:/,
        item.name,
    );
  }
});

test("critical source index flags fail even when bytes match HEAD", () => {
  const cases = [
    {
      name: "skip-worktree",
      flag: "--skip-worktree",
      path: "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
      expectedPrefix: "S ",
    },
    {
      name: "assume-unchanged",
      flag: "--assume-unchanged",
      path:
        "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
      expectedPrefix: "h ",
    },
  ];
  for (const item of cases) {
    const source = syntheticPlannerRepository();
    runFixtureGit(source.repositoryRoot, [
      "update-index", item.flag, item.path,
    ]);
    assert.equal(
        runFixtureGit(source.repositoryRoot, [
          "ls-files", "-v", "--", item.path,
        ]),
        `${item.expectedPrefix}${item.path}`,
        item.name,
    );
    assert.equal(
        runFixtureGit(source.repositoryRoot, [
          "hash-object", item.path,
        ]),
        runFixtureGit(source.repositoryRoot, [
          "rev-parse", `HEAD:${item.path}`,
        ]),
        item.name,
    );
    const probe = executeSyntheticCliProbe({
      plannerPath: source.plannerPath,
      releaseSha: source.head,
    });
    assert.equal(probe.exitCode, 1, item.name);
    assert.equal(probe.databaseInitCount, 0, item.name);
    assert.equal(fs.existsSync(probe.summaryOutput), false, item.name);
    assert.equal(fs.existsSync(probe.sensitiveOutput), false, item.name);
    assert.match(
        JSON.parse(probe.stderr[0]).error,
        /^critical_runtime_source_index_flags:/,
        item.name,
    );
  }
});

test("pagination protocol failures map to exit 3 without outputs", () => {
  const source = syntheticPlannerRepository();
  const cases = [
    {
      behavior: {privateStudents: {pageBoundExceeded: true}},
      documents: 3,
    },
    {
      behavior: {privateStudents: {cursorLoop: true}},
      documents: 2,
    },
  ];
  for (const [index, item] of cases.entries()) {
    const data = registryDataset();
    data.privateStudents = Array.from(
        {length: item.documents},
        (_, documentIndex) => ({
          id: `protocol-student-${documentIndex}`,
          data: {academyId: ACADEMY},
        }),
    );
    const probe = executeSyntheticCliProbe({
      plannerPath: source.plannerPath,
      releaseSha: source.head,
      data,
      behavior: item.behavior,
    });
    assert.equal(probe.exitCode, 3, `case ${index}`);
    assert.equal(JSON.parse(probe.stderr[0]).exitCode, 3);
    assert.equal(fs.existsSync(probe.summaryOutput), false);
    assert.equal(fs.existsSync(probe.sensitiveOutput), false);
  }
});

test("production confirmation and config errors stop before database access", async () => {
  const directory = secureTemporaryDirectory();
  const options = outputOptions(directory, {
    project: "daegu-miami-production",
  });
  const stderr = [];
  let databaseAccessed = false;
  const exitCode = await executePlannerCli({
    argv: [
      "--project", options.project,
      "--academy", options.academy,
      "--release-sha", options.releaseSha,
      "--summary-output", options.summaryOutput,
      "--sensitive-output", options.sensitiveOutput,
      "--page-size", String(options.pageSize),
    ],
    env: {},
    dbFactory: async () => {
      databaseAccessed = true;
      throw new Error("must not run");
    },
    stdout: () => assert.fail("stdout must remain empty"),
    stderr: (line) => stderr.push(line),
  });
  assert.equal(exitCode, 1);
  assert.equal(databaseAccessed, false);
  assert.equal(stderr.length, 1);
  const errorOutput = JSON.parse(stderr[0]);
  assert.equal(errorOutput.exitCode, 1);
  assert.equal(errorOutput.actualWrites, 0);
  assert.equal(errorOutput.writeAuthorized, false);
  assert.equal(errorOutput.executorImplemented, false);
  assert.equal(fs.existsSync(options.summaryOutput), false);
  assert.equal(fs.existsSync(options.sensitiveOutput), false);
});

test("CLI academy target rejects non-exact raw values before database access", () => {
  const source = syntheticPlannerRepository();
  for (const academy of [
    " academy_daegumiami",
    "academy_daegumiami ",
    "\tacademy_daegumiami",
    "academy_daegumiami\n",
    "",
  ]) {
    const probe = executeSyntheticCliProbe({
      plannerPath: source.plannerPath,
      releaseSha: source.head,
      academy,
    });
    assert.equal(probe.exitCode, 1);
    assert.equal(probe.databaseInitCount, 0);
    assert.equal(probe.networkCallCount, 0);
    assert.equal(probe.stdout.length, 0);
    assert.equal(fs.existsSync(probe.summaryOutput), false);
    assert.equal(fs.existsSync(probe.sensitiveOutput), false);
  }
});

test("test profile confirmation fails before database initialization", () => {
  const source = syntheticPlannerRepository();
  const invalidConfirmationValues = ["yes", "true", "1", "YES ", " YES", ""];
  const invalidProfileConfirmationCases =
    invalidConfirmationValues.flatMap((value) => [
      {
        resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
        executionEnvironment: {
          CONFIRM_ALL_ACADEMY_DATA_IS_TEST: value,
          CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
        },
        expected: /test_data_confirmation_required/,
      },
      {
        resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
        executionEnvironment: {
          CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
          CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: value,
        },
        expected: /full_backup_waiver_confirmation_required/,
      },
    ]);
  const invalidStandaloneConfirmationCases =
    invalidConfirmationValues.flatMap((value) => [
      {
        executionEnvironment: {
          CONFIRM_ALL_ACADEMY_DATA_IS_TEST: value,
        },
        expected: /confirmation_without_reset_profile/,
      },
      {
        executionEnvironment: {
          CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: value,
        },
        expected: /confirmation_without_reset_profile/,
      },
    ]);
  for (const item of [
    {
      resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
      expected: /test_data_confirmation_required/,
    },
    {
      resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
      executionEnvironment: {
        CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
      },
      expected: /full_backup_waiver_confirmation_required/,
    },
    {
      resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
      executionEnvironment: {
        CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
      },
      expected: /test_data_confirmation_required/,
    },
    {
      resetProfile: "all_academy_data_test_v2",
      executionEnvironment: {
        CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
        CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
      },
      expected: /unsupported_reset_profile/,
    },
    {
      executionEnvironment: {
        CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
      },
      expected: /confirmation_without_reset_profile/,
    },
    {
      executionEnvironment: {
        CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
      },
      expected: /confirmation_without_reset_profile/,
    },
    {
      executionEnvironment: {
        CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
        CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
      },
      expected: /confirmation_without_reset_profile/,
    },
    ...invalidProfileConfirmationCases,
    ...invalidStandaloneConfirmationCases,
  ]) {
    const probe = executeSyntheticCliProbe({
      plannerPath: source.plannerPath,
      releaseSha: source.head,
      resetProfile: item.resetProfile,
      executionEnvironment: item.executionEnvironment,
    });
    assert.equal(probe.exitCode, 1);
    assert.equal(probe.databaseInitCount, 0);
    assert.equal(probe.networkCallCount, 0);
    assert.equal(probe.stdout.length, 0);
    assert.equal(fs.existsSync(probe.summaryOutput), false);
    assert.equal(fs.existsSync(probe.sensitiveOutput), false);
    const errorResult = JSON.parse(probe.stderr[0]);
    assert.match(errorResult.error, item.expected);
    assert.equal(errorResult.actualWrites, 0);
  }

  const success = executeSyntheticCliProbe({
    plannerPath: source.plannerPath,
    releaseSha: source.head,
    resetProfile: ALL_ACADEMY_DATA_TEST_PROFILE,
    executionEnvironment: {
      CONFIRM_ALL_ACADEMY_DATA_IS_TEST: "YES",
      CONFIRM_OPERATOR_WAIVES_FULL_BACKUP: "YES",
    },
    data: profileDataset(),
  });
  assert.equal(success.exitCode, 0);
  assert.equal(success.databaseInitCount, 1);
  assert.equal(success.summary.fullBackupWaiverConfirmed, true);
  assert.equal(success.summary.actualWrites, 0);
});

test("planner option validation binds emulator, release, and academy", () => {
  const directory = secureTemporaryDirectory();
  const options = outputOptions(directory);
  const validated = validatePlannerOptions(
      options,
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
  );
  assert.equal(validated.project, PROJECT);
  for (const academy of [
    "academy_other",
    " academy_daegumiami",
    "academy_daegumiami ",
    "\tacademy_daegumiami",
    "academy_daegumiami\n",
    "",
    null,
    1,
    true,
  ]) {
    assert.throws(() => validatePlannerOptions(
        {...options, academy},
        {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
    ), PlannerConfigError);
  }
  assert.throws(() => validatePlannerOptions(
      {...options, releaseSha: "wrong-release"},
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
  ), PlannerConfigError);
  assert.throws(() => validatePlannerOptions(
      {...options, pageSize: 201},
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
  ), PlannerConfigError);
});

test("top-level output schemas exactly cover both planner modes", async () => {
  for (const options of [{}, testProfileOptions()]) {
    const data = options.resetProfile ? profileDataset() : registryDataset();
    const result = await planDataset(data, options);
    for (const [value, schema, label] of [
      [result.canonicalPlan, CANONICAL_PLAN_SCHEMA, "canonical plan"],
      [result.summary, REDACTED_SUMMARY_SCHEMA, "summary"],
      [result.manifest, SENSITIVE_MANIFEST_SCHEMA, "manifest"],
    ]) {
      assert.deepEqual(
          Object.keys(value).sort(),
          [...schema.requiredKeys].sort(),
          `${label} builder keys must equal its shared schema`,
      );
      assert.deepEqual(schema.optionalKeys, []);
      assert.equal(validateExactOutputSchema(value, schema, label), true);
    }
  }
});

test("top-level schemas reject unknown, missing, wrong-type, and coherent tamper",
    async () => {
      const result = await planDataset(registryDataset());
      const unknownValues = [
        "forged",
        7,
        true,
        {semantic: "forged"},
        ["forged"],
        null,
        undefined,
      ];
      for (const value of unknownValues) {
        const canonicalPlan = structuredClone(result.canonicalPlan);
        canonicalPlan.unboundSerializedField = value;
        assert.throws(
            () => validateExactOutputSchema(
                canonicalPlan,
                CANONICAL_PLAN_SCHEMA,
                "canonical plan",
            ),
            /top-level schema mismatch/,
        );
      }
      for (const target of ["summary", "manifest", "both"]) {
        for (const value of unknownValues) {
          const summary = structuredClone(result.summary);
          const manifest = structuredClone(result.manifest);
          if (target !== "manifest") {
            summary.unboundSerializedField = value;
          }
          if (target !== "summary") {
            manifest.unboundSerializedField = value;
          }
          assert.throws(
              () => assertExactPublicationParity(
                  result.canonicalPlan,
                  summary,
                  manifest,
              ),
              /top-level schema mismatch/,
          );
          const directory = secureTemporaryDirectory();
          assert.throws(() => writePlannerOutputs({
            summaryOutput: path.join(directory, "summary.json"),
            sensitiveOutput: path.join(directory, "manifest.json"),
            canonicalPlan: result.canonicalPlan,
            summary,
            manifest,
          }), /top-level schema mismatch/);
          assert.deepEqual(fs.readdirSync(directory), []);
          fs.rmSync(directory, {recursive: true, force: true});
        }
      }

      for (const [surface, schema] of [
        ["canonicalPlan", CANONICAL_PLAN_SCHEMA],
        ["summary", REDACTED_SUMMARY_SCHEMA],
        ["manifest", SENSITIVE_MANIFEST_SCHEMA],
      ]) {
        for (const key of schema.requiredKeys) {
          const value = structuredClone(result[surface]);
          delete value[key];
          assert.throws(
              () => validateExactOutputSchema(value, schema, surface),
              /top-level schema mismatch/,
              `${surface}.${key} must be required`,
          );
        }
      }

      const wrongTypes = [
        ["planVersion", ["2", null, {}]],
        ["actualWrites", ["0", NaN, Infinity]],
        ["complete", ["true", 1]],
        ["publicationContract", [[], null]],
        ["planDigest", ["", 7]],
      ];
      for (const [surface, schema] of [
        ["canonicalPlan", CANONICAL_PLAN_SCHEMA],
        ["summary", REDACTED_SUMMARY_SCHEMA],
        ["manifest", SENSITIVE_MANIFEST_SCHEMA],
      ]) {
        for (const [field, values] of wrongTypes) {
          for (const value of values) {
            const output = structuredClone(result[surface]);
            output[field] = value;
            assert.throws(
                () => validateExactOutputSchema(output, schema, surface),
                /invalid top-level field type/,
            );
          }
        }
      }

      const polluted = structuredClone(result.summary);
      Object.setPrototypeOf(polluted, {unboundSerializedField: "inherited"});
      assert.throws(
          () => validateExactOutputSchema(
              polluted,
              REDACTED_SUMMARY_SCHEMA,
              "summary",
          ),
          /plain top-level object/,
      );
      const withSymbol = structuredClone(result.manifest);
      withSymbol[Symbol("unbound")] = "forged";
      assert.throws(
          () => validateExactOutputSchema(
              withSymbol,
              SENSITIVE_MANIFEST_SCHEMA,
              "manifest",
          ),
          /unsupported symbol fields/,
      );
      const withNonEnumerable = structuredClone(result.summary);
      Object.defineProperty(withNonEnumerable, "unboundSerializedField", {
        value: "forged",
        enumerable: false,
      });
      assert.throws(
          () => validateExactOutputSchema(
              withNonEnumerable,
              REDACTED_SUMMARY_SCHEMA,
              "summary",
          ),
          /top-level schema mismatch/,
      );
      const nullPrototypeSummary = Object.assign(
          Object.create(null),
          result.summary,
      );
      assert.equal(validateExactOutputSchema(
          nullPrototypeSummary,
          REDACTED_SUMMARY_SCHEMA,
          "summary",
      ), true);

      const reorderedSummary = Object.fromEntries(
          Object.entries(result.summary).reverse(),
      );
      const reorderedManifest = Object.fromEntries(
          Object.entries(result.manifest).reverse(),
      );
      assert.equal(assertExactPublicationParity(
          result.canonicalPlan,
          reorderedSummary,
          reorderedManifest,
      ), undefined);
    });

test("registry reference cardinality is complete and mutation-resistant", () => {
  const counts = assertReferenceCardinalityInvariant();
  assert.equal(counts.totalFields, REFERENCE_FIELD_SPECS.length);
  assert.equal(
      counts.scalarFields + counts.arrayFields,
      counts.totalFields,
  );
  assert.ok(counts.scalarFields > 0);
  assert.ok(counts.arrayFields > 0);
  assert.equal(REFERENCE_CARDINALITY_POLICY_VERSION, 1);

  const cloneRegistry = () => structuredClone(ACADEMY_SCOPED_RESET_REGISTRY);
  const missingCardinality = cloneRegistry();
  delete missingCardinality[0].referenceExtractors[0].fieldSpecs[0].cardinality;
  assert.throws(
      () => assertReferenceCardinalityInvariant(missingCardinality),
      /invalid field cardinality/,
  );

  const permissiveScalar = cloneRegistry();
  permissiveScalar
      .find(({collectionName}) => collectionName === "lessons")
      .referenceExtractors
      .find(({fields}) => fields.includes("packageId"))
      .fieldSpecs
      .find(({field}) => field === "packageId")
      .cardinality = "string_or_array";
  assert.throws(
      () => assertReferenceCardinalityInvariant(permissiveScalar),
      /invalid field cardinality/,
  );

  const conflicting = cloneRegistry();
  const firstExtractor = conflicting[0].referenceExtractors[0];
  firstExtractor.fields.push(firstExtractor.fields[0]);
  firstExtractor.fieldSpecs.push(structuredClone(firstExtractor.fieldSpecs[0]));
  assert.throws(
      () => assertReferenceCardinalityInvariant(conflicting),
      /conflicting cardinality registrations/,
  );
});

test("all registry field specs enforce their exact scalar or array shape", () => {
  const parse = (fieldSpec, value, present = true) => {
    const data = {};
    if (present) {
      const segments = fieldSpec.field.split(".");
      let target = data;
      for (const segment of segments.slice(0, -1)) {
        target[segment] = {};
        target = target[segment];
      }
      target[segments.at(-1)] = value;
    }
    return parseReferenceFieldValues({
      data,
      field: fieldSpec.field,
      valueType: fieldSpec.cardinality.endsWith("_array") ?
        "array" :
        "string",
      cardinality: fieldSpec.cardinality,
      deduplicate: fieldSpec.deduplicate,
      targetCollections: fieldSpec.targetCollections,
      allowedAbsenceShapes: [
        ...(fieldSpec.allowNull ? ["null"] : []),
        ...(fieldSpec.allowEmptyString ? ["empty_string"] : []),
      ],
    });
  };

  for (const fieldSpec of REFERENCE_FIELD_SPECS) {
    const label = `${fieldSpec.collectionName}.${fieldSpec.field}`;
    assert.deepEqual(parse(fieldSpec, undefined, false), {
      values: [],
      issues: [],
    }, `${label} missing field follows optional cardinality`);
    if (fieldSpec.cardinality.endsWith("_scalar")) {
      assert.deepEqual(parse(fieldSpec, "target-id").issues, [], label);
      for (const invalid of [
        ["target-id"],
        ["a", "b"],
        {id: "target-id"},
        1,
        true,
      ]) {
        const parsed = parse(fieldSpec, invalid);
        assert.ok(parsed.issues.length > 0, label);
        assert.deepEqual(parsed.values, [], label);
        assert.doesNotMatch(JSON.stringify(parsed.issues), /target-id/);
      }
      assert.equal(
          parse(fieldSpec, null).issues.length === 0,
          fieldSpec.allowNull,
          `${label} null policy`,
      );
      assert.equal(
          parse(fieldSpec, "").issues.length === 0,
          fieldSpec.allowEmptyString,
          `${label} empty-string policy`,
      );
    } else {
      assert.deepEqual(parse(fieldSpec, ["a", "b"]), {
        values: ["a", "b"],
        issues: [],
      }, label);
      assert.deepEqual(parse(fieldSpec, ["same", "same"]).values, ["same"]);
      assert.deepEqual(parse(fieldSpec, []).issues, [], label);
      for (const invalid of [
        "target-id",
        ["a", 1],
        {id: "target-id"},
        1,
        true,
        null,
      ]) {
        const parsed = parse(fieldSpec, invalid);
        assert.ok(parsed.issues.length > 0, label);
        assert.doesNotMatch(JSON.stringify(parsed.issues), /target-id/);
      }
    }
  }
});

test("lessons.packageId is an exact optional scalar reference", async () => {
  const packageId = "studentPackages-target-document";
  const lessonWith = (packageIdValue, present = true) => {
    const data = registryDataset();
    data.lessons[0].data = {
      academyId: ACADEMY,
      ...(present ? {packageId: packageIdValue} : {}),
    };
    return data;
  };
  const valid = await planDataset(lessonWith(packageId));
  assert.equal(valid.exitCode, 0);
  assert.equal(
      valid.secondRun.records
          .find(({collection}) => collection === "lessons")
          .references
          .some((reference) =>
            reference.field === "packageId" &&
            reference.documentId === packageId),
      true,
  );

  for (const invalid of [
    [packageId],
    ["a", "b"],
    {id: packageId},
    1,
    true,
    null,
    "",
  ]) {
    const blocked = await planDataset(lessonWith(invalid));
    assert.equal(blocked.exitCode, 2);
    assert.equal(blocked.summary.actualWrites, 0);
    assert.ok(blocked.secondRun.referenceFindings.blockers.some(
        ({code, field}) =>
          code === "malformed_reference_field" && field === "packageId",
    ));
    assert.equal(
        blocked.secondRun.records
            .find(({collection}) => collection === "lessons")
            .references
            .some((reference) => reference.field === "packageId"),
        false,
    );
  }
  const missing = await planDataset(lessonWith(undefined, false));
  assert.equal(missing.exitCode, 0);
});

test("schema and cardinality policy metadata are digest-bound", async () => {
  const result = await planDataset(registryDataset());
  assert.equal(result.summary.topLevelOutputSchemaVersion, 1);
  assert.equal(result.summary.summarySchemaVersion, 1);
  assert.equal(result.manifest.manifestSchemaVersion, 1);
  assert.equal(result.summary.referenceCardinalityPolicyVersion, 1);
  assert.equal(
      result.summary.referenceFieldSpecSchemaDigest,
      buildReferenceFieldSpecSchemaDigest(),
  );
  assert.equal(
      buildReferenceFieldSpecSchemaDigest([...REFERENCE_FIELD_SPECS].reverse()),
      result.summary.referenceFieldSpecSchemaDigest,
  );
  const mutatedSpecs = structuredClone(REFERENCE_FIELD_SPECS);
  mutatedSpecs.find(({collectionName, field}) =>
    collectionName === "lessons" && field === "packageId",
  ).cardinality = "optional_array";
  assert.notEqual(
      buildReferenceFieldSpecSchemaDigest(mutatedSpecs),
      result.summary.referenceFieldSpecSchemaDigest,
  );
  const mutatedCreditMappings = structuredClone(
      CREDIT_SOURCE_REFERENCE_MAPPINGS,
  );
  mutatedCreditMappings.privateReservation.explicitIdCardinality =
    "optional_array";
  assert.notEqual(
      buildReferenceFieldSpecSchemaDigest(
          REFERENCE_FIELD_SPECS,
          mutatedCreditMappings,
      ),
      result.summary.referenceFieldSpecSchemaDigest,
  );

  for (const field of [
    "topLevelOutputSchemaVersion",
    "summarySchemaVersion",
    "manifestSchemaVersion",
    "referenceCardinalityPolicyVersion",
  ]) {
    const summary = structuredClone(result.summary);
    const manifest = structuredClone(result.manifest);
    summary[field] += 1;
    manifest[field] += 1;
    assert.throws(
        () => assertExactPublicationParity(
            result.canonicalPlan,
            summary,
            manifest,
        ),
        /policy|canonical|schema|parity/i,
    );
  }
});
