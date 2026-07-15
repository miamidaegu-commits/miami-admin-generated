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
  EXPECTED_TARGET_ACADEMY,
  RESET_CLASSIFICATIONS,
  RESET_REGISTRY_COUNTS,
} from "../functions/scripts/academy-scoped-test-data-reset-registry.mjs";
import {
  PlannerConfigError,
  buildAcademyScopedResetPlan,
  executePlannerCli,
  parsePlannerArgs,
  validateOutputPath,
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
          indexFlagsClean: true,
        }),
    ),
    ...overrides,
  };
}

function clone(value) {
  return structuredClone(value);
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
  }

  collection(collectionName) {
    return new FakeQuery(this, collectionName);
  }

  async listCollections() {
    return Object.entries(this.data)
        .filter(([, documents]) => documents.length > 0)
        .map(([id]) => ({id}));
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
      }
      collection(name) { return new Query(this, name); }
      async listCollections() {
        return Object.entries(this.data)
          .filter(([, documents]) => documents.length > 0)
          .map(([id]) => ({id}));
      }
    }
    const {executePlannerCli} = await import(process.env.PROBE_PLANNER_URL);
    let databaseInitCount = 0;
    const stdout = [];
    const stderr = [];
    const exitCode = await executePlannerCli({
      argv: JSON.parse(process.env.PROBE_ARGV),
      env: {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
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
    console.log(JSON.stringify({exitCode, databaseInitCount, stdout, stderr}));
  `;
  const argv = [
    "--project", PROJECT,
    "--academy", ACADEMY,
    "--release-sha", releaseSha,
    "--summary-output", summaryOutput,
    "--sensitive-output", sensitiveOutput,
    "--page-size", "2",
  ];
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
    pageSize: 25,
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
  const data = registryDataset();
  data.lessons[0].data = {subject: "scope missing"};
  const result = await buildAcademyScopedResetPlan({
    db: new FakeFirestore(data),
    project: PROJECT,
    academy: ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: runtimeSourceIdentity(),
    pageSize: 2,
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.collections.lessons.unknown, 1);
  assert.equal(result.summary.collections.lessons.reset, 0);
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
          ({code}) => code === "malformed_reference_element",
      ),
      true,
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

test("sensitive output is mode 0600, atomic, and no-clobber", () => {
  const directory = secureTemporaryDirectory();
  const summaryOutput = path.join(directory, "summary.json");
  const sensitiveOutput = path.join(directory, "sensitive.json");
  const summary = {
    mode: "read_only_plan",
    actualWrites: 0,
    writeAuthorized: false,
    executorImplemented: false,
  };
  const manifest = {
    sensitivity: "LOCAL_ONLY_CONTAINS_RAW_FIRESTORE_PATHS",
    rawPath: "lessons/raw-document-id",
    actualWrites: 0,
    writeAuthorized: false,
    executorImplemented: false,
  };
  writePlannerOutputs({
    summaryOutput,
    sensitiveOutput,
    summary,
    manifest,
  });
  assert.equal(fs.statSync(summaryOutput).mode & 0o777, 0o600);
  assert.equal(fs.statSync(sensitiveOutput).mode & 0o777, 0o600);
  assert.throws(() => writePlannerOutputs({
    summaryOutput,
    sensitiveOutput,
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

test("planner option validation binds emulator, release, and academy", () => {
  const directory = secureTemporaryDirectory();
  const options = outputOptions(directory);
  const validated = validatePlannerOptions(
      options,
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
  );
  assert.equal(validated.project, PROJECT);
  assert.throws(() => validatePlannerOptions(
      {...options, academy: "academy_other"},
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
  ), PlannerConfigError);
  assert.throws(() => validatePlannerOptions(
      {...options, releaseSha: "wrong-release"},
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
  ), PlannerConfigError);
  assert.throws(() => validatePlannerOptions(
      {...options, pageSize: 201},
      {FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080"},
  ), PlannerConfigError);
});
