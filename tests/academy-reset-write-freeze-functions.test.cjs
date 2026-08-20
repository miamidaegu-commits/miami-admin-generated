/* eslint-disable require-jsdoc, max-len, quotes */
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  RESET_WRITE_FREEZE_MODE,
  RESET_WRITE_FREEZE_KEYS,
  RESET_WRITE_FREEZE_SCHEMA_VERSION,
  TARGET_ACADEMY_ID,
  TARGET_PROJECT_ID,
  WRITE_SURFACE_INVENTORY,
  WRITE_SURFACE_INVENTORY_VERSION,
  assertAcademyResetWriteAllowed,
  assertGlobalResetWriteAllowed,
  assertRegisteredWriteSurface,
  classifyResetWriteFreeze,
  createGlobalFreezeGuardedHandler,
} = require("../functions/academy-reset-write-freeze.js");

const repositoryRoot = path.resolve(__dirname, "..");
const indexSource = fs.readFileSync(
    path.join(repositoryRoot, "functions", "index.js"),
    "utf8",
);
const freezeGuardSource = fs.readFileSync(
    path.join(
        repositoryRoot,
        "functions",
        "academy-reset-write-freeze.js",
    ),
    "utf8",
);
const writeSurfaceRegistrySource = fs.readFileSync(
    path.join(
        repositoryRoot,
        "functions",
        "scripts",
        "academy-reset-write-surface-registry.mjs",
    ),
    "utf8",
);

const READ_ONLY_CALLABLES = Object.freeze([
  "listGroupLessonAvailability",
  "listPrivateLessonSlotAvailability",
  "previewFixedPrivateLessonRescheduleScope",
  "inspectFixedPrivateLessonRescheduleScope",
  "previewPrivateLessonStatusAction",
  "inspectFixedPrivateLessonOutcomeLedger",
  "inspectFixedPrivateLessonOutcomeRemediationEvidence",
  "previewFixedPrivateLessonOutcomeAction",
  "previewPrivateLessonOutcomeAction",
]);

const NON_TRANSACTION_WRITE_CALLABLES = Object.freeze([
  "updateStudentPrivateCancelAllowance",
  "updateTeacherStudentPackageCounts",
  "bootstrapAdmin",
  "setUserRole",
  "linkStudentAccount",
  "linkTeacherAccount",
]);

function sorted(values) {
  return [...values].sort();
}

function extractBalancedFunctionBody(source, declarationIndex) {
  const declarationTail = source.slice(declarationIndex);
  const bodyOpening = declarationTail.match(/\)\s*\{/);
  assert.ok(bodyOpening);
  const openBrace = declarationIndex + bodyOpening.index +
    bodyOpening[0].lastIndexOf("{");
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = openBrace; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === "\"" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(openBrace, index + 1);
    }
  }
  throw new Error("Unbalanced function declaration.");
}

function extractFunctionSource(functionName) {
  const declaration = indexSource.indexOf(`function ${functionName}(`);
  assert.notEqual(declaration, -1, functionName);
  const body = extractBalancedFunctionBody(indexSource, declaration);
  const bodyStart = indexSource.indexOf(body, declaration);
  return indexSource.slice(declaration, bodyStart + body.length);
}

function runtimeProjectContract(env) {
  const productionDeclaration = indexSource.match(
      /const PRODUCTION_PROJECT_ID = "daegu-miami-production";/,
  );
  const emulatorDeclaration = indexSource.match(
      /const EMULATOR_PROJECT_ID = "demo-miami-e2e";/,
  );
  assert.ok(productionDeclaration);
  assert.ok(emulatorDeclaration);
  class TestHttpsError extends Error {
    constructor(code, message, details) {
      super(message);
      this.code = code;
      this.details = details;
    }
  }
  return Function(
      "process",
      "HttpsError",
      [
        "\"use strict\";",
        productionDeclaration[0],
        emulatorDeclaration[0],
        extractFunctionSource("getProjectIdFromFirebaseConfig"),
        extractFunctionSource("getRuntimeProjectId"),
        extractFunctionSource("requireWriteGuardRuntimeProjectId"),
        "return {getRuntimeProjectId, requireWriteGuardRuntimeProjectId};",
      ].join("\n"),
  )({env: {...env}}, TestHttpsError);
}

function validActiveSentinel(overrides = {}) {
  return {
    schemaVersion: RESET_WRITE_FREEZE_SCHEMA_VERSION,
    active: true,
    mode: RESET_WRITE_FREEZE_MODE,
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    ...overrides,
  };
}

function classifyTargetSentinel(sentinel) {
  return classifyResetWriteFreeze({
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    academyExists: true,
    sentinel,
  });
}

function fakeFirestore({
  exists = true,
  sentinel,
  readError = null,
} = {}) {
  const calls = {directGets: 0, transactionGets: 0};
  const snap = {
    exists,
    data() {
      return sentinel === undefined ? {} : {resetWriteFreeze: sentinel};
    },
  };
  const academyRef = {
    path: `academies/${TARGET_ACADEMY_ID}`,
    async get() {
      calls.directGets += 1;
      if (readError) throw readError;
      return snap;
    },
  };
  const db = {
    collection(name) {
      assert.equal(name, "academies");
      return {
        doc(id) {
          assert.equal(id, TARGET_ACADEMY_ID);
          return academyRef;
        },
      };
    },
  };
  const transaction = {
    async get(ref) {
      calls.transactionGets += 1;
      assert.equal(ref, academyRef);
      if (readError) throw readError;
      return snap;
    },
  };
  return {calls, db, transaction};
}

async function expectFreeze(promise, reason) {
  await assert.rejects(promise, (error) => {
    assert.equal(error.code, "failed-precondition");
    assert.equal(error.details.reason, reason);
    assert.equal(
        error.details.inventoryVersion,
        WRITE_SURFACE_INVENTORY_VERSION,
    );
    return true;
  });
}

test("write inventory is deeply frozen and has exact category counts", () => {
  assert.equal(Object.isFrozen(WRITE_SURFACE_INVENTORY), true);
  assert.equal(WRITE_SURFACE_INVENTORY.version, WRITE_SURFACE_INVENTORY_VERSION);
  assert.equal(
      WRITE_SURFACE_INVENTORY_VERSION,
      "academy_reset_write_surface_inventory.v2",
  );
  assert.equal(RESET_WRITE_FREEZE_SCHEMA_VERSION, "academy_reset_write_freeze.v1");
  const expectedCounts = {
    writeCallables: 25,
    transactionCallables: 19,
    scheduledWriters: 1,
    writeHelpers: 13,
    provisioningAuthCallables: 4,
    authOperations: 4,
  };
  for (const [category, expectedCount] of Object.entries(expectedCounts)) {
    assert.equal(Object.isFrozen(WRITE_SURFACE_INVENTORY[category]), true);
    assert.equal(
        WRITE_SURFACE_INVENTORY[category].length,
        expectedCount,
        category,
    );
    assert.equal(
        new Set(WRITE_SURFACE_INVENTORY[category]).size,
        expectedCount,
        `${category} contains a duplicate`,
    );
  }
  assert.deepEqual(WRITE_SURFACE_INVENTORY.writeHelpers, [
    "setMergeWithTimestamps",
    "createStudentAccessSummaryDocsIfMissing",
    "runFixedPrivateRenewalWriteTransaction",
    "runFixedPrivateAssignmentWriteTransaction",
    "runFixedPrivateRescheduleWriteTransaction",
    "commitPrivateLessonStatusAction",
    "autoDeductPrivateReservation",
    "autoDeductGroupStudent",
    "createPrivateSlotNotification",
    "commitPrivateLessonOutcomeAction",
    "commitFixedPrivateLessonOutcomeAction",
    "applyPrivateReservationOutcomeWithDeductionInTransaction",
    "reversePrivateReservationOutcomeInTransaction",
  ]);
  assert.doesNotThrow(() => assertRegisteredWriteSurface(
      "reversePrivateReservationOutcomeInTransaction",
  ));
  assert.deepEqual(
      sorted(WRITE_SURFACE_INVENTORY.provisioningAuthCallables),
      sorted(["bootstrapAdmin", "setUserRole", "linkStudentAccount",
        "linkTeacherAccount"]),
  );
  assert.equal(Object.isFrozen(RESET_WRITE_FREEZE_KEYS), true);
  assert.deepEqual(RESET_WRITE_FREEZE_KEYS, [
    "active",
    "schemaVersion",
    "mode",
    "academyId",
    "projectId",
  ]);
});

test("every callable is exactly classified as read-only or write", () => {
  const exportedCallables = [
    ...indexSource.matchAll(
        /exports\.([A-Za-z0-9_]+)\s*=\s*onCall\b/g,
    ),
  ].map((match) => match[1]);
  assert.equal(new Set(exportedCallables).size, exportedCallables.length);
  assert.deepEqual(
      sorted(exportedCallables),
      sorted([
        ...READ_ONLY_CALLABLES,
        ...WRITE_SURFACE_INVENTORY.writeCallables,
      ]),
  );
  assert.equal(exportedCallables.length, 34);
});

test("transaction and non-transaction callable allowlists are exact", () => {
  assert.deepEqual(
      sorted(WRITE_SURFACE_INVENTORY.transactionCallables),
      sorted(WRITE_SURFACE_INVENTORY.writeCallables.filter(
          (name) => !NON_TRANSACTION_WRITE_CALLABLES.includes(name),
      )),
  );
  assert.equal(
      indexSource.includes(
          'assertRegisteredWriteSurface("runAutoDeductPendingLessonsForTest")',
      ),
      true,
  );
  for (const name of NON_TRANSACTION_WRITE_CALLABLES) {
    const start = indexSource.indexOf(`exports.${name} = onCall`);
    const nextExport = indexSource.indexOf("\nexports.", start + 1);
    const callableBody = indexSource.slice(
        start,
        nextExport === -1 ? indexSource.length : nextExport,
    );
    const guardIndex = callableBody.indexOf(`writeSurfaceId: "${name}"`);
    const mutationIndex = callableBody.search(
        /\.(?:setCustomUserClaims|createUser|updateUser|set|update|add)\s*\(/,
    );
    assert.notEqual(guardIndex, -1, `${name} has no freeze guard`);
    assert.notEqual(mutationIndex, -1, `${name} has no mutation`);
    assert.ok(guardIndex < mutationIndex, `${name} mutates before freeze guard`);
  }
});

test("all 20 transaction runners guard before their first transaction read", () => {
  const runnerMatches = [...indexSource.matchAll(/runTransaction\s*\(/g)];
  const delegatedReadHelperByRunner = new Map([
    [
      "markPrivateReservationOutcome",
      "applyPrivateReservationOutcomeWithDeductionInTransaction",
    ],
    [
      "reversePrivateReservationOutcome",
      "reversePrivateReservationOutcomeInTransaction",
    ],
  ]);
  assert.equal(delegatedReadHelperByRunner.size, 2);
  assert.equal(new Set(delegatedReadHelperByRunner.values()).size, 2);
  assert.equal(
      delegatedReadHelperByRunner.get("reversePrivateReservationOutcome"),
      "reversePrivateReservationOutcomeInTransaction",
  );
  assert.equal(runnerMatches.length, 20);
  for (let index = 0; index < runnerMatches.length; index += 1) {
    const start = runnerMatches[index].index;
    const nextRunner = runnerMatches[index + 1];
    const end = nextRunner ? nextRunner.index : indexSource.length;
    const transactionBody = indexSource.slice(start, end);
    const guardIndex = transactionBody.indexOf("guardAcademyWrite({");
    const firstReadIndex = transactionBody.indexOf("transaction.get(");
    const runnerSurfaceId = transactionBody.match(
        /writeSurfaceId:\s*"([^"]+)"/,
    )?.[1];
    const delegatedHelperName =
      delegatedReadHelperByRunner.get(runnerSurfaceId);
    const delegatedHelperCallIndex = delegatedHelperName ?
      transactionBody.indexOf(`return await ${delegatedHelperName}(`) :
      -1;
    const delegatedTransactionRead = delegatedHelperCallIndex !== -1;
    assert.notEqual(guardIndex, -1, `transaction ${index + 1} has no guard`);
    assert.equal(
        firstReadIndex !== -1 || delegatedTransactionRead,
        true,
        `transaction ${index + 1} has no direct or delegated read`,
    );
    if (delegatedHelperName) {
      assert.notEqual(
          delegatedHelperCallIndex,
          -1,
          `${runnerSurfaceId} does not call ${delegatedHelperName}`,
      );
      assert.ok(
          guardIndex < delegatedHelperCallIndex,
          `${runnerSurfaceId} calls ${delegatedHelperName} before its guard`,
      );
      const helperDeclaration = indexSource.indexOf(
          `async function ${delegatedHelperName}(`,
      );
      assert.notEqual(helperDeclaration, -1, delegatedHelperName);
      const helperBody =
        extractBalancedFunctionBody(indexSource, helperDeclaration);
      assert.notEqual(
          helperBody.indexOf("transaction.get("),
          -1,
          `${delegatedHelperName} has no transaction read`,
      );
    }
    if (firstReadIndex !== -1) {
      assert.ok(
          guardIndex < firstReadIndex,
          `transaction ${index + 1} reads before freeze guard`,
      );
    }
  }
  const reversalRunner = "reversePrivateReservationOutcome";
  const reversalHelper = "reversePrivateReservationOutcomeInTransaction";
  assert.equal(
      indexSource.split(`exports.${reversalRunner} = onCall(`).length - 1,
      1,
  );
  assert.equal(
      indexSource.split(`async function ${reversalHelper}(`).length - 1,
      1,
  );
  assert.equal(
      indexSource.split(`return await ${reversalHelper}(`).length - 1,
      1,
  );
  const reversalHelperDeclaration =
    indexSource.indexOf(`async function ${reversalHelper}(`);
  const reversalHelperBody =
    extractBalancedFunctionBody(indexSource, reversalHelperDeclaration);
  assert.equal(
      reversalHelperBody.indexOf("transaction.get(") <
        reversalHelperBody.indexOf("transaction.update("),
      true,
  );
  assert.equal(
      WRITE_SURFACE_INVENTORY.writeHelpers.filter(
          (helperName) => helperName === reversalHelper,
      ).length,
      1,
  );
  assert.equal(
      writeSurfaceRegistrySource.split(`"${reversalHelper}"`).length - 1,
      1,
  );
  const transactionGuardIds = [
    ...indexSource.matchAll(
        /transaction,\s*\n\s*academyId(?::[^,\n]+)?,\s*\n\s*writeSurfaceId:\s*"([^"]+)"/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(
      sorted(transactionGuardIds),
      sorted([
        ...WRITE_SURFACE_INVENTORY.transactionCallables.filter(
            (name) => name !== "runAutoDeductPendingLessonsForTest",
        ),
        "autoDeductPrivateReservation",
        "autoDeductGroupStudent",
      ]),
  );
});

test("scheduled and Auth/provisioning surfaces match exact source inventory", () => {
  const scheduled = [
    ...indexSource.matchAll(
        /exports\.([A-Za-z0-9_]+)\s*=\s*onSchedule\b/g,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(scheduled, WRITE_SURFACE_INVENTORY.scheduledWriters);
  assert.match(
      indexSource,
      /const autoDeductPendingLessonsHandler\s*=\s*[\s\S]*?createGlobalFreezeGuardedHandler\(\{[\s\S]*?guardGlobalWrite,[\s\S]*?runner:\s*async\s*\(\)\s*=>[\s\S]*?writeSurfaceId:\s*"autoDeductPendingLessons"[\s\S]*?\}\);/,
  );
  assert.match(
      indexSource,
      /exports\.autoDeductPendingLessons\s*=\s*onSchedule\([\s\S]*?autoDeductPendingLessonsHandler,\s*\);/,
  );

  const actualAuthOperations = sorted(new Set([
    ...indexSource.matchAll(
        /\.(setCustomUserClaims|createUser|updateUser|generatePasswordResetLink)\s*\(/g,
    ),
  ].map((match) => match[1])));
  assert.deepEqual(
      actualAuthOperations,
      sorted(WRITE_SURFACE_INVENTORY.authOperations),
  );
  for (const name of WRITE_SURFACE_INVENTORY.provisioningAuthCallables) {
    assert.equal(
        indexSource.includes(`writeSurfaceId: "${name}"`),
        true,
        `${name} has no global freeze guard`,
    );
  }
});

test("scheduled fixture statically guards before metadata and runner", () => {
  const declaration = freezeGuardSource.indexOf(
      "function createGlobalFreezeGuardedHandler(",
  );
  assert.notEqual(declaration, -1);
  const body = extractBalancedFunctionBody(freezeGuardSource, declaration);
  const registrationIndex = body.indexOf("assertRegisteredWriteSurface(");
  const guardIndex = body.indexOf("await guardGlobalWrite({");
  const enabledIndex = body.indexOf("isEnabled()");
  const runnerIndex = body.indexOf("return runner(");
  for (const index of [
    registrationIndex,
    guardIndex,
    enabledIndex,
    runnerIndex,
  ]) {
    assert.notEqual(index, -1);
  }
  assert.ok(registrationIndex < guardIndex);
  assert.ok(guardIndex < enabledIndex);
  assert.ok(enabledIndex < runnerIndex);
});

test("active freeze blocks disabled metadata and all mutations", async () => {
  const {db} = fakeFirestore({sentinel: validActiveSentinel()});
  const calls = {
    isEnabled: 0,
    onDisabled: 0,
    runner: 0,
    writes: 0,
    authMutations: 0,
  };
  const handler = createGlobalFreezeGuardedHandler({
    getDb: () => db,
    guardGlobalWrite: ({db: guardedDb, writeSurfaceId}) =>
      assertGlobalResetWriteAllowed({
        db: guardedDb,
        projectId: TARGET_PROJECT_ID,
        writeSurfaceId,
      }),
    isEnabled: () => {
      calls.isEnabled += 1;
      return false;
    },
    onDisabled: () => {
      calls.onDisabled += 1;
      return {disabled: true};
    },
    runner: async () => {
      calls.runner += 1;
      calls.writes += 1;
      calls.authMutations += 1;
      return {ran: true};
    },
    writeSurfaceId: "autoDeductPendingLessons",
  });

  await expectFreeze(handler(), "reset_write_freeze_active");
  assert.deepEqual(calls, {
    isEnabled: 0,
    onDisabled: 0,
    runner: 0,
    writes: 0,
    authMutations: 0,
  });
});

test("scheduled handler preserves the inactive runner path", async () => {
  const {db} = fakeFirestore({
    sentinel: validActiveSentinel({active: false}),
  });
  const calls = {runner: 0};
  const handler = createGlobalFreezeGuardedHandler({
    getDb: () => db,
    guardGlobalWrite: ({db: guardedDb, writeSurfaceId}) =>
      assertGlobalResetWriteAllowed({
        db: guardedDb,
        projectId: TARGET_PROJECT_ID,
        writeSurfaceId,
      }),
    isEnabled: () => true,
    onDisabled: () => ({disabled: true}),
    runner: async () => {
      calls.runner += 1;
      return {ran: true};
    },
    writeSurfaceId: "autoDeductPendingLessons",
  });

  assert.deepEqual(await handler(), {ran: true});
  assert.deepEqual(calls, {runner: 1});
});

test("unknown runtime projects fail closed before backend write guards", () => {
  const declaration = indexSource.indexOf(
      "function requireWriteGuardRuntimeProjectId()",
  );
  assert.notEqual(declaration, -1);
  const body = extractBalancedFunctionBody(indexSource, declaration);
  assert.match(body, /projectId === PRODUCTION_PROJECT_ID/);
  assert.match(body, /Boolean\(process\.env\.FIRESTORE_EMULATOR_HOST\)/);
  assert.match(body, /projectId === EMULATOR_PROJECT_ID/);
  assert.match(body, /new HttpsError\(/);
  assert.match(body, /unknown_runtime_project/);
  assert.doesNotMatch(body, /startsWith|includes|\/\^demo-/);
  assert.match(
      indexSource,
      /assertAcademyResetWriteAllowed\(\{[\s\S]*?projectId:\s*requireWriteGuardRuntimeProjectId\(\)/,
  );
  assert.match(
      indexSource,
      /assertGlobalResetWriteAllowed\(\{[\s\S]*?projectId:\s*requireWriteGuardRuntimeProjectId\(\)/,
  );
});

test("runtime project identity contract is exact and emulator-bound", () => {
  const productionProject = "daegu-miami-production";
  const emulatorProject = "demo-miami-e2e";
  const emulatorHost = "127.0.0.1:8080";
  const matchingEnv = (projectId, extras = {}) => ({
    GCLOUD_PROJECT: projectId,
    GOOGLE_CLOUD_PROJECT: projectId,
    FIREBASE_CONFIG: JSON.stringify({projectId}),
    ...extras,
  });
  const requireProject = (env) =>
    runtimeProjectContract(env).requireWriteGuardRuntimeProjectId();
  const expectUnknownRuntime = (env) => {
    assert.throws(
        () => requireProject(env),
        (error) => {
          assert.equal(error.code, "failed-precondition");
          assert.equal(error.details?.reason, "unknown_runtime_project");
          return true;
        },
    );
  };

  assert.equal(
      requireProject(matchingEnv(productionProject)),
      productionProject,
  );
  assert.equal(
      requireProject(matchingEnv(emulatorProject, {
        FIRESTORE_EMULATOR_HOST: emulatorHost,
      })),
      emulatorProject,
  );

  expectUnknownRuntime(matchingEnv(emulatorProject));
  expectUnknownRuntime(matchingEnv("miami-e2e", {
    FIRESTORE_EMULATOR_HOST: emulatorHost,
  }));
  expectUnknownRuntime(matchingEnv("demo-other", {
    FIRESTORE_EMULATOR_HOST: emulatorHost,
  }));
  expectUnknownRuntime(matchingEnv("foreign-project", {
    FIRESTORE_EMULATOR_HOST: emulatorHost,
  }));

  expectUnknownRuntime({
    ...matchingEnv(productionProject),
    GOOGLE_CLOUD_PROJECT: emulatorProject,
  });
  expectUnknownRuntime({
    ...matchingEnv(emulatorProject, {
      FIRESTORE_EMULATOR_HOST: emulatorHost,
    }),
    FIREBASE_CONFIG: JSON.stringify({projectId: "foreign-project"}),
  });

  for (const projectId of [
    productionProject.toUpperCase(),
    emulatorProject.toUpperCase(),
    ` ${productionProject}`,
    `${productionProject} `,
    ` ${emulatorProject}`,
    `${emulatorProject} `,
  ]) {
    expectUnknownRuntime(matchingEnv(projectId, {
      FIRESTORE_EMULATOR_HOST: emulatorHost,
    }));
  }
});

test("write helper declarations are pinned to the exact inventory", () => {
  const newHelperName = "reversePrivateReservationOutcomeInTransaction";
  assert.equal(
      WRITE_SURFACE_INVENTORY.writeHelpers.filter(
          (helperName) => helperName === newHelperName,
      ).length,
      1,
  );
  assert.equal(
      (indexSource.match(
          /^async function reversePrivateReservationOutcomeInTransaction\(/gm,
      ) || []).length,
      1,
  );
  for (const helperName of WRITE_SURFACE_INVENTORY.writeHelpers) {
    assert.match(
        indexSource,
        new RegExp(`(?:async\\s+)?function\\s+${helperName}\\s*\\(`),
        helperName,
    );
  }
  const namedWriterHelpers = [];
  for (const declaration of indexSource.matchAll(
      /^(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/gm,
  )) {
    const body = extractBalancedFunctionBody(indexSource, declaration.index);
    if (
      /\.runTransaction\s*\(/.test(body) ||
      /\btransaction\.(?:create|set|update|delete)\s*\(/.test(body) ||
      /\b(?:ref|[A-Za-z0-9_]+Ref)\.(?:create|set|update|delete)\s*\(/.test(
          body,
      )
    ) {
      namedWriterHelpers.push(declaration[1]);
    }
  }
  assert.deepEqual(
      sorted(namedWriterHelpers),
      sorted(WRITE_SURFACE_INVENTORY.writeHelpers),
  );
});

test("unknown write surfaces fail closed before any sentinel read", async () => {
  assert.throws(
      () => assertRegisteredWriteSurface("futureUnknownWriter"),
      (error) => {
        assert.equal(error.code, "failed-precondition");
        assert.equal(error.details.reason, "unknown_write_surface");
        return true;
      },
  );
  const {db, calls} = fakeFirestore();
  await expectFreeze(assertAcademyResetWriteAllowed({
    db,
    academyId: "another_academy",
    projectId: "another-project",
    writeSurfaceId: "futureUnknownWriter",
  }), "unknown_write_surface");
  assert.equal(calls.directGets, 0);
});

test("exact active target sentinel blocks with failed-precondition", async () => {
  const {db} = fakeFirestore({sentinel: validActiveSentinel()});
  await expectFreeze(assertAcademyResetWriteAllowed({
    db,
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    writeSurfaceId: "updateStudentPrivateCancelAllowance",
  }), "reset_write_freeze_active");
});

test("malformed and partial target sentinels fail closed", async () => {
  const cases = [
    ["sentinel_malformed", "active"],
    ["sentinel_malformed", null],
    ["sentinel_malformed", []],
    ["sentinel_keys_invalid", {}],
    ["sentinel_active_invalid", validActiveSentinel({active: "true"})],
    ["sentinel_keys_invalid", {active: false}],
    ["sentinel_schema_invalid", validActiveSentinel({schemaVersion: "v0"})],
    ["sentinel_mode_invalid", validActiveSentinel({mode: "other"})],
    ["sentinel_academy_invalid", validActiveSentinel({academyId: "other"})],
    ["sentinel_project_invalid", validActiveSentinel({projectId: "other"})],
  ];
  for (const [reason, sentinel] of cases) {
    const {db} = fakeFirestore({sentinel});
    await expectFreeze(assertAcademyResetWriteAllowed({
      db,
      academyId: TARGET_ACADEMY_ID,
      projectId: TARGET_PROJECT_ID,
      writeSurfaceId: "updateTeacherStudentPackageCounts",
    }), reason);
  }

  const {db} = fakeFirestore({exists: false});
  await expectFreeze(assertAcademyResetWriteAllowed({
    db,
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    writeSurfaceId: "updateTeacherStudentPackageCounts",
  }), "academy_document_missing");
});

test("sentinel exact own-key schema rejects adversarial objects", () => {
  for (const active of [true, false]) {
    const extraEnumerable = validActiveSentinel({active});
    extraEnumerable.operator = "unexpected";

    const extraNonEnumerable = validActiveSentinel({active});
    Object.defineProperty(extraNonEnumerable, "operator", {
      value: "unexpected",
      enumerable: false,
    });

    const symbolField = validActiveSentinel({active});
    symbolField[Symbol("operator")] = "unexpected";

    const nonEnumerableExpected = validActiveSentinel({active});
    Object.defineProperty(nonEnumerableExpected, "mode", {
      value: RESET_WRITE_FREEZE_MODE,
      enumerable: false,
    });

    for (const sentinel of [
      extraEnumerable,
      extraNonEnumerable,
      symbolField,
      nonEnumerableExpected,
    ]) {
      assert.deepEqual(
          classifyTargetSentinel(sentinel),
          {blocked: true, reason: "sentinel_keys_invalid"},
      );
    }
  }

  for (const missingKey of RESET_WRITE_FREEZE_KEYS) {
    const sentinel = validActiveSentinel();
    delete sentinel[missingKey];
    assert.deepEqual(
        classifyTargetSentinel(sentinel),
        {blocked: true, reason: "sentinel_keys_invalid"},
        missingKey,
    );
  }

  const customPrototype = Object.assign(
      Object.create({custom: true}),
      validActiveSentinel(),
  );
  class SentinelRecord {
    constructor() {
      Object.assign(this, validActiveSentinel());
    }
  }
  for (const sentinel of [customPrototype, new SentinelRecord(), new Date()]) {
    assert.deepEqual(
        classifyTargetSentinel(sentinel),
        {blocked: true, reason: "sentinel_prototype_invalid"},
    );
  }

  let getterCalls = 0;
  const accessorField = validActiveSentinel();
  Object.defineProperty(accessorField, "active", {
    enumerable: true,
    get() {
      getterCalls += 1;
      return true;
    },
  });
  assert.deepEqual(
      classifyTargetSentinel(accessorField),
      {blocked: true, reason: "sentinel_keys_invalid"},
  );
  assert.equal(getterCalls, 0);

  for (const sentinel of [
    new Proxy(validActiveSentinel(), {
      getPrototypeOf() {
        throw new Error("prototype trap");
      },
    }),
    new Proxy(validActiveSentinel(), {
      ownKeys() {
        throw new Error("ownKeys trap");
      },
    }),
  ]) {
    assert.deepEqual(
        classifyTargetSentinel(sentinel),
        {blocked: true, reason: "sentinel_malformed"},
    );
  }
});

test("sentinel exact field types and literals fail closed", () => {
  const cases = [
    ["sentinel_active_invalid", {active: 1}],
    ["sentinel_active_invalid", {active: "false"}],
    ["sentinel_schema_invalid", {
      schemaVersion: Object(RESET_WRITE_FREEZE_SCHEMA_VERSION),
    }],
    ["sentinel_mode_invalid", {mode: Object(RESET_WRITE_FREEZE_MODE)}],
    ["sentinel_academy_invalid", {academyId: 1}],
    ["sentinel_project_invalid", {projectId: true}],
  ];
  for (const [reason, override] of cases) {
    assert.deepEqual(
        classifyTargetSentinel(validActiveSentinel(override)),
        {blocked: true, reason},
    );
  }
});

test("plain and null-prototype exact Firestore maps remain compatible", () => {
  const inactiveNullPrototype = Object.assign(
      Object.create(null),
      validActiveSentinel({active: false}),
  );
  assert.deepEqual(
      classifyTargetSentinel(inactiveNullPrototype),
      {blocked: false, reason: "sentinel_inactive"},
  );

  const activeNullPrototype = Object.assign(
      Object.create(null),
      validActiveSentinel(),
  );
  assert.deepEqual(
      classifyTargetSentinel(activeNullPrototype),
      {blocked: true, reason: "reset_write_freeze_active"},
  );

  const reorderedInactive = {
    projectId: TARGET_PROJECT_ID,
    academyId: TARGET_ACADEMY_ID,
    mode: RESET_WRITE_FREEZE_MODE,
    schemaVersion: RESET_WRITE_FREEZE_SCHEMA_VERSION,
    active: false,
  };
  assert.deepEqual(
      classifyTargetSentinel(reorderedInactive),
      {blocked: false, reason: "sentinel_inactive"},
  );
});

test("absent or explicitly inactive sentinel preserves target behavior", async () => {
  for (const sentinel of [
    undefined,
    validActiveSentinel({active: false}),
  ]) {
    const {db} = fakeFirestore({sentinel});
    const result = await assertAcademyResetWriteAllowed({
      db,
      academyId: TARGET_ACADEMY_ID,
      projectId: TARGET_PROJECT_ID,
      writeSurfaceId: "updateStudentPrivateCancelAllowance",
    });
    assert.equal(result.allowed, true);
  }
});

test("other academy and project bypass without reading target sentinel", async () => {
  for (const scope of [
    {academyId: "academy_other", projectId: TARGET_PROJECT_ID},
    {academyId: TARGET_ACADEMY_ID, projectId: "other-project"},
    {academyId: ` ${TARGET_ACADEMY_ID}`, projectId: TARGET_PROJECT_ID},
    {academyId: TARGET_ACADEMY_ID, projectId: ` ${TARGET_PROJECT_ID}`},
  ]) {
    const {db, calls} = fakeFirestore({sentinel: validActiveSentinel()});
    const result = await assertAcademyResetWriteAllowed({
      db,
      ...scope,
      writeSurfaceId: "updateStudentPrivateCancelAllowance",
    });
    assert.equal(result.reason, "outside_exact_target");
    assert.equal(calls.directGets, 0);
  }
});

test("transaction guard reads sentinel through the same transaction", async () => {
  const {db, transaction, calls} = fakeFirestore({
    sentinel: validActiveSentinel({active: false}),
  });
  await assertAcademyResetWriteAllowed({
    db,
    transaction,
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    writeSurfaceId: "reserveGroupLessonSeat",
  });
  assert.deepEqual(calls, {directGets: 0, transactionGets: 1});
});

test("global Auth guard blocks on active target maintenance", async () => {
  const {db} = fakeFirestore({sentinel: validActiveSentinel()});
  await expectFreeze(assertGlobalResetWriteAllowed({
    db,
    projectId: TARGET_PROJECT_ID,
    writeSurfaceId: "linkTeacherAccount",
  }), "reset_write_freeze_active");
});

test("sentinel read failures fail closed and classifier is exact", async () => {
  const {db} = fakeFirestore({readError: new Error("read unavailable")});
  await expectFreeze(assertAcademyResetWriteAllowed({
    db,
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    writeSurfaceId: "reservePrivateLessonSlot",
  }), "sentinel_read_failed");

  assert.deepEqual(classifyResetWriteFreeze({
    academyId: TARGET_ACADEMY_ID,
    projectId: TARGET_PROJECT_ID,
    academyExists: true,
    sentinel: validActiveSentinel({active: false}),
  }), {blocked: false, reason: "sentinel_inactive"});
});
