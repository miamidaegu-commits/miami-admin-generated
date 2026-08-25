import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(testDir, "..");
const configPath = path.join(root, "firebase.a1-outcome-emulator.json");
const harnessPath = path.join(
    testDir,
    "private-lesson-outcome-commit.emulator.cjs",
);
const fixedHarnessPath = path.join(
    testDir,
    "fixed-private-lesson-outcome-action.emulator.cjs",
);
const functionsPath = path.join(root, "functions", "index.js");
const configSource = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(configSource);
const harness = fs.readFileSync(harnessPath, "utf8");
const fixedHarness = fs.readFileSync(fixedHarnessPath, "utf8");
const functionsSource = fs.readFileSync(functionsPath, "utf8");
const FIXED_HARNESS_SHA256 =
  "4e4516ee49616035d5691c389d2536567421431673e4c0f34dd447fddb58dbb2";
const FIXED_HARNESS_LINE_COUNT = 2649;

function functionBody(source, name) {
  const asyncDeclaration = `async function ${name}(`;
  const syncDeclaration = `function ${name}(`;
  const declaration = source.includes(asyncDeclaration) ?
    asyncDeclaration :
    syncDeclaration;
  const start = source.indexOf(declaration);
  assert.notEqual(start, -1, `${name} declaration`);
  assert.equal(
      source.indexOf(declaration, start + declaration.length),
      -1,
      `${name} declaration cardinality`,
  );

  function skipComment(index) {
    if (source[index + 1] === "/") {
      const newline = source.indexOf("\n", index + 2);
      return newline === -1 ? source.length : newline + 1;
    }
    if (source[index + 1] === "*") {
      const closing = source.indexOf("*/", index + 2);
      assert.notEqual(closing, -1, `${name} block comment`);
      return closing + 2;
    }
    return index;
  }

  function skipQuoted(index, delimiter) {
    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      const character = source[cursor];
      if (character === "\\") {
        cursor += 1;
        continue;
      }
      if (
        delimiter === "`" &&
        character === "$" &&
        source[cursor + 1] === "{"
      ) {
        cursor = scanBalanced(cursor + 1, "{", "}", "template expression");
        continue;
      }
      if (character === delimiter) return cursor + 1;
    }
    assert.fail(`${name} unterminated ${delimiter} string`);
  }

  function scanBalanced(opening, openCharacter, closeCharacter, label) {
    assert.equal(source[opening], openCharacter, `${name} ${label} opening`);
    let depth = 0;
    for (let index = opening; index < source.length;) {
      const character = source[index];
      if ("\"'`".includes(character)) {
        index = skipQuoted(index, character);
        continue;
      }
      if (
        character === "/" &&
        (source[index + 1] === "/" || source[index + 1] === "*")
      ) {
        index = skipComment(index);
        continue;
      }
      if (character === openCharacter) {
        depth += 1;
      } else if (character === closeCharacter) {
        depth -= 1;
        if (depth === 0) return index;
      }
      index += 1;
    }
    assert.fail(`${name} balanced ${label}`);
  }

  function skipTrivia(index) {
    while (index < source.length) {
      if (/\s/.test(source[index])) {
        index += 1;
        continue;
      }
      if (
        source[index] === "/" &&
        (source[index + 1] === "/" || source[index + 1] === "*")
      ) {
        index = skipComment(index);
        continue;
      }
      break;
    }
    return index;
  }

  const parameterOpening = start + declaration.length - 1;
  assert.equal(source[parameterOpening], "(", `${name} parameter opening`);
  const parameterClosing = scanBalanced(
      parameterOpening,
      "(",
      ")",
      "parameters",
  );
  const bodyOpening = skipTrivia(parameterClosing + 1);
  assert.equal(source[bodyOpening], "{", `${name} body opening`);
  const bodyClosing = scanBalanced(bodyOpening, "{", "}", "body");
  return source.slice(bodyOpening + 1, bodyClosing);
}

test("dedicated configuration is canonical and Firestore-only", () => {
  assert.equal(configSource, `${JSON.stringify(config, null, 2)}\n`);
  assert.deepEqual(Object.keys(config), ["emulators"]);
  assert.deepEqual(config, {
    emulators: {
      firestore: {host: "127.0.0.1", port: 8080},
      ui: {enabled: false},
      singleProjectMode: true,
    },
  });
  const emulatorKinds = [
    "auth", "database", "firestore", "functions", "hosting", "pubsub",
    "storage", "eventarc", "dataconnect",
  ].filter((key) => Object.hasOwn(config.emulators, key));
  assert.deepEqual(emulatorKinds, ["firestore"]);
  for (const forbidden of [
    "\"rules\"",
    "\"indexes\"",
    "\"hooks\"",
    "\"targets\"",
    "\"project\"",
    "http://",
    "https://",
  ]) {
    assert.equal(configSource.includes(forbidden), false);
  }
  assert.equal(
      configSource.includes(["daegu", "miami", "production"].join("-")),
      false,
  );
});

test("runtime identity fails closed before SDK initialization", () => {
  const readIndex = harness.indexOf("fs.readFileSync(EMULATOR_CONFIG_PATH");
  const hostIndex = harness.indexOf(
      "process.env.FIRESTORE_EMULATOR_HOST !==",
  );
  const sdkIndex = harness.indexOf("firebase-functions-test");
  assert.ok(readIndex > 0);
  assert.ok(hostIndex > readIndex);
  assert.ok(sdkIndex > hostIndex);
  assert.ok(harness.includes("FIRESTORE_CONFIG.host !== \"127.0.0.1\""));
  assert.ok(harness.includes("FIRESTORE_CONFIG.port !== 8080"));
  assert.ok(harness.includes(
      "const REQUIRED_PROJECT_ENV = [\"GCLOUD_PROJECT\", " +
      "\"GOOGLE_CLOUD_PROJECT\"]",
  ));
  assert.ok(harness.includes("process.env[envName] !== PROJECT_ID"));
  for (const envName of [
    "FIREBASE_TOKEN",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "FIREBASE_PROJECT",
    "FIREBASE_PROJECT_ID",
    "CLOUDSDK_CORE_PROJECT",
    "VITE_FIREBASE_PROJECT_ID",
    "FIREBASE_CONFIG",
  ]) {
    assert.ok(harness.includes(`"${envName}"`), `${envName} rejected`);
  }
  assert.equal(harness.includes("process.env.GCLOUD_PROJECT ="), false);
  assert.equal(harness.includes("process.env.GOOGLE_CLOUD_PROJECT ="), false);
  assert.equal(harness.includes("localhost"), false);
  assert.equal(harness.includes("0.0.0.0"), false);
  assert.equal(harness.includes("process.env.PORT"), false);
  assert.equal(harness.includes("http://"), false);
  assert.equal(harness.includes("https://"), false);
  assert.equal(
      harness.includes(["daegu", "miami", "production"].join("-")),
      false,
  );
});

test("manifest contains exactly 24 ordered case records", () => {
  const expected = Array.from(
      {length: 24},
      (_, index) => `[A${String(index + 1).padStart(2, "0")}]`,
  );
  const markers = harness.match(/\[A\d{2}\]/g) || [];
  assert.deepEqual(markers, expected);
  expected.forEach((marker) => {
    assert.equal(markers.filter((value) => value === marker).length, 1);
  });
  const pattern =
    /title: "(\[A\d{2}\] [^"]+)",\s+assertionId: "([^"]+)",\s+evidence: \{callable: "([^"]+)", kind: "([^"]+)"\},\s+run: (\w+),/g;
  const entries = [...harness.matchAll(pattern)].map((match) => ({
    marker: match[1].slice(0, 5),
    assertionId: match[2],
    callable: match[3],
    kind: match[4],
    run: match[5],
  }));
  assert.equal(entries.length, 24);
  assert.deepEqual(entries.map((entry) => entry.marker), expected);
  assert.equal(new Set(entries.map((entry) => entry.assertionId)).size, 24);
  assert.equal(new Set(entries.map((entry) => entry.run)).size, 24);
  entries.forEach((entry) => {
    assert.ok(entry.assertionId.length >= 12);
    assert.ok(entry.kind.length >= 5);
    assert.ok(harness.includes(`async function ${entry.run}(`));
    assert.ok(harness.includes(`functions.${entry.callable}`));
  });
  assert.ok(harness.includes(
      "for (const testCase of ACCOUNTING_CASES) {\n" +
      "      await runAccountingCase(testCase);",
  ));
});

test("production callables and transaction helpers remain exercised", () => {
  for (const name of [
    "previewPrivateLessonOutcomeAction",
    "commitPrivateLessonOutcomeAction",
    "markPrivateReservationOutcome",
    "reversePrivateReservationOutcome",
    "runAutoDeductPendingLessonsForTest",
  ]) {
    assert.ok(harness.includes(`functions.${name}`));
    assert.ok(functionsSource.includes(`exports.${name}`));
  }
  const commit = functionBody(
      functionsSource,
      "commitPrivateLessonOutcomeAction",
  );
  const directReversal = functionBody(
      functionsSource,
      "reversePrivateReservationOutcomeInTransaction",
  );
  const sharedReversalAccounting = functionBody(
      functionsSource,
      "applyPrivateReservationOutcomeReversalAccountingInTransaction",
  );
  const reversal = `${directReversal}\n${sharedReversalAccounting}`;
  assert.ok(commit.includes("db.runTransaction"));
  assert.ok(commit.includes(
      "applyPrivateReservationOutcomeWithDeductionInTransaction",
  ));
  assert.ok(commit.includes("transaction.create(batchRef, checkpoint)"));
  assert.ok(reversal.includes("transaction.update(packageRef"));
  assert.ok(reversal.includes("transaction.create(reversalCreditRef"));
  assert.ok(directReversal.includes(
      "applyPrivateReservationOutcomeReversalAccountingInTransaction(",
  ));
  assert.ok(functionsSource.includes(
      "return `reverse_${normalizeId(deductionId)}`",
  ));
});

test("parallel cases use real concurrent handler calls", () => {
  const commits = functionBody(
      harness,
      "accountingCaseA07ConcurrentCommitRequests",
  );
  assert.ok(commits.includes("Promise.all("));
  assert.ok(commits.includes("previewFixture("));
  assert.ok(commits.includes("Promise.allSettled("));
  assert.ok(commits.includes("commitOutcome("));
  assert.ok(commits.includes("result.status === \"fulfilled\""));
  assert.ok(commits.includes("result.status === \"rejected\""));
  const reversals = functionBody(
      harness,
      "accountingCaseA13ConcurrentReversalRequests",
  );
  assert.ok(reversals.includes("Promise.all(["));
  assert.equal((reversals.match(/reverseFixture\(\{/g) || []).length, 2);
  assert.ok(reversals.includes("result.idempotentReplay === false"));
  assert.ok(reversals.includes("result.idempotentReplay === true"));
});

test("inventory and field contracts prove bounded writes", () => {
  const entitlement = functionBody(
      harness,
      "accountingCaseA03EntitlementInventory",
  );
  assert.ok(entitlement.includes("getAccountingInventory()"));
  assert.ok(entitlement.includes("addedInventoryIds("));
  assert.ok(entitlement.includes("Number(credit.deltaCount) > 0"));
  assert.ok(entitlement.includes("getPackageCounts("));
  const inventory = functionBody(
      harness,
      "accountingCaseA23CanonicalWriteInventory",
  );
  assert.ok(inventory.includes("\"creditTransactions\""));
  assert.ok(inventory.includes("\"privateLessonOutcomeActionBatches\""));
  assert.ok(inventory.includes("commitOutcome({auth, data: payload})"));
  assert.ok(inventory.includes("reverseFixture({"));
  assert.ok(inventory.includes("getAccountingInventory()"));
  const fields = harness.match(
      /const FORBIDDEN_ACCOUNTING_FIELDS = \[([\s\S]*?)\];/,
  );
  assert.ok(fields);
  assert.deepEqual(
      [...fields[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
      [
        "notice", "noticeId", "noticeStatus", "makeup", "makeupCount",
        "makeupCredit", "makeupEntitlement", "entitlement", "entitlementId",
      ],
  );
  const fieldCase = functionBody(harness, "accountingCaseA04ForbiddenFields");
  assert.ok(fieldCase.includes("assertForbiddenAccountingFieldsAbsent("));
  assert.ok(fieldCase.includes("getOutcomeCheckpoint(requestId)"));
});

test("replay identity and preservation have separate evidence", () => {
  const different = functionBody(
      harness,
      "accountingCaseA06DifferentCommitRequest",
  );
  assert.ok(different.includes("commitOutcome({"));
  assert.ok(different.includes("secondPreview.allowed, true"));
  assert.ok(different.includes("additionalPackageDeduction, 0"));
  assert.ok(different.includes("reduce((total, credit)"));
  const identity = functionBody(
      harness,
      "accountingCaseA15DeterministicReversalIdentity",
  );
  assert.ok(identity.includes(
      "const expectedReversalId = `reverse_${result.creditTransactionId}`",
  ));
  assert.ok(identity.includes("credit.id).sort()"));
  assert.ok(identity.includes("deltaCount) === 1"));
  const sentinels = functionBody(
      harness,
      "accountingCaseA16PackageSentinelPreservation",
  );
  assert.ok(sentinels.includes("accountingSentinelScalar"));
  assert.ok(sentinels.includes("accountingSentinelNested"));
  assert.ok(sentinels.includes("accountingSentinelArray"));
  assert.equal((sentinels.match(/assert\.deepStrictEqual\(/g) || []).length, 2);
});

test("R01-R14 remediation regressions are exact and executed", () => {
  const manifest = harness.match(
      /const REMEDIATION_CASES = \[([\s\S]*?)\]\.map\(\(\[title, run\]\)/,
  );
  assert.ok(manifest);
  const entries = [...manifest[1].matchAll(
      /\["(\[R(\d{2})\] [^"]+)", (remediationCase\w+)\]/g,
  )].map((match) => ({
    title: match[1],
    number: Number(match[2]),
    run: match[3],
  }));
  assert.equal(entries.length, 14);
  assert.deepEqual(entries.map((entry) => entry.number),
      Array.from({length: 14}, (_, index) => index + 1));
  entries.forEach((entry) => {
    assert.ok(harness.includes(`async function ${entry.run}(`));
  });
  const main = functionBody(harness, "main");
  assert.ok(main.includes("for (const testCase of REMEDIATION_CASES)"));
  assert.ok(main.includes("await runRemediationCase(testCase)"));
  const validatorManifest = harness.match(
      /const VALIDATOR_CASES = \[([\s\S]*?)\]\.map\(\(\[title, run\]\)/,
  );
  assert.ok(validatorManifest);
  const validatorEntries = [...validatorManifest[1].matchAll(
      /\["(\[V(\d{2})\] [^"]+)", (validatorCase\w+)\]/g,
  )].map((match) => ({
    number: Number(match[2]),
    run: match[3],
  }));
  assert.equal(validatorEntries.length, 9);
  assert.deepEqual(validatorEntries.map((entry) => entry.number),
      Array.from({length: 9}, (_, index) => index + 1));
  validatorEntries.forEach((entry) => {
    assert.ok(harness.includes(`async function ${entry.run}(`));
  });
  assert.ok(main.includes("for (const testCase of VALIDATOR_CASES)"));
  assert.ok(main.includes("await runValidatorCase(testCase)"));
  const newFormatManifest = harness.match(
      /const NEW_FORMAT_CASES = \[([\s\S]*?)\]\.map\(\(\[title, run\]\)/,
  );
  assert.ok(newFormatManifest);
  const newFormatEntries = [...newFormatManifest[1].matchAll(
      /\["(\[N(\d{2})\] [^"]+)", (newFormatCase\w+)\]/g,
  )].map((match) => ({
    number: Number(match[2]),
    run: match[3],
  }));
  assert.equal(newFormatEntries.length, 14);
  assert.deepEqual(newFormatEntries.map((entry) => entry.number),
      Array.from({length: 14}, (_, index) => index + 1));
  newFormatEntries.forEach((entry) => {
    assert.ok(harness.includes(`async function ${entry.run}(`));
  });
  assert.ok(main.includes("for (const testCase of NEW_FORMAT_CASES)"));
  assert.ok(main.includes("await runNewFormatCase(testCase)"));
  const statusReversalManifest = harness.match(
      /const STATUS_REVERSAL_GUARD_CASES = \[([\s\S]*?)\]\.map\(\(\[title, run\]\)/,
  );
  assert.ok(statusReversalManifest);
  const statusReversalEntries = [...statusReversalManifest[1].matchAll(
      /\["(\[S(\d{2})\] [^"]+)", (statusReversalCase\w+)\]/g,
  )].map((match) => ({
    number: Number(match[2]),
    run: match[3],
  }));
  assert.equal(statusReversalEntries.length, 14);
  assert.deepEqual(statusReversalEntries.map((entry) => entry.number),
      Array.from({length: 14}, (_, index) => index + 1));
  statusReversalEntries.forEach((entry) => {
    assert.ok(harness.includes(`async function ${entry.run}(`));
  });
  assert.ok(main.includes(
      "for (const testCase of STATUS_REVERSAL_GUARD_CASES)",
  ));
  assert.ok(main.includes("await runStatusReversalGuardCase(testCase)"));
});

test("cycle, reversal hash, and legacy shape contracts are fail closed", () => {
  for (const token of [
    "buildPrivateReservationOutcomeDeductionCycleIdentity",
    "reuse_existing_active_deduction",
    "additionalPackageDeduction",
    "buildPrivateReservationOutcomeReversalPlanHash",
    "mixed_reversal_request_shape",
    "reversal_identity_mismatch",
    "buildLegacyPrivateReservationReversalRequestId",
    "requestMode === \"current\"",
    "requestMode === \"legacy\"",
    "getPrivateLessonStatusCanonicalActiveDeductionEvidence",
    "getPrivateReservationCanonicalActiveDeductionEvidence",
    "target.activeDeductionCredit",
    "target.activeDeductionReversalCredit",
    "deterministicReversalCreditTransactionExists === true",
    "normalizeId(packageData.academyId) !== academyId",
    "normalizeId(packageData.studentId) !== studentId",
  ]) {
    assert.ok(functionsSource.includes(token), token);
  }
  const reversalStart = functionsSource.indexOf(
      "function buildPrivateReservationOutcomeReversalCreditId(",
  );
  const reversalEnd = functionsSource.indexOf(
      "exports.bootstrapAdmin = onCall(",
      reversalStart,
  );
  const reversalSource = functionsSource.slice(reversalStart, reversalEnd);
  assert.equal(reversalSource.includes("Math.random()"), false);
  assert.equal(reversalSource.includes("Date.now()"), false);
  assert.ok(reversalSource.includes(
      "normalizeId(originalCredit.reversalOfTransactionId)",
  ));
  assert.ok(reversalSource.includes(
      "normalizeId(originalCredit.reversalCreditTransactionId) !==",
  ));
  assert.ok(reversalSource.includes(
      "{blockedReasons: [\"reversal_checkpoint_incomplete\"]}",
  ));
  const directOutcomeWriter = functionBody(
      functionsSource,
      "applyPrivateReservationOutcomeWithDeductionInTransaction",
  );
  assert.ok(directOutcomeWriter.includes(
      "getPrivateReservationCanonicalActiveDeductionEvidence({",
  ));
  assert.ok(directOutcomeWriter.includes(
      "buildPrivateReservationOutcomeReversalCreditId(creditTransactionId)",
  ));
  assert.ok(directOutcomeWriter.includes(
      "deterministicReversalCreditTransactionExists:",
  ));
  assert.equal(directOutcomeWriter.includes(
      "reservation.deductionCreditTransactionId ||",
  ), false);
  for (const fetchName of [
    "fetchPrivateLessonStatusCreditCandidates",
    "transactionFetchPrivateLessonStatusCreditCandidates",
  ]) {
    const directFetch = functionBody(functionsSource, fetchName);
    assert.ok(directFetch.includes("collection(\"creditTransactions\")"));
    assert.ok(directFetch.includes(".doc(directId)"));
    assert.equal(directFetch.includes(".where("), false);
    assert.equal(directFetch.includes(".limit("), false);
  }
  const validatorStart = functionsSource.indexOf(
      "function getPrivateLessonStatusCanonicalActiveDeductionEvidence(",
  );
  const validatorEnd = functionsSource.indexOf(
      "function buildPrivateLessonStatusCreditPreview(",
      validatorStart,
  );
  const validatorSource = functionsSource.slice(validatorStart, validatorEnd);
  assert.ok(validatorSource.includes("!deductionCreditTransactionId"));
  assert.ok(validatorSource.includes("!deductionTransactionId"));
  assert.ok(validatorSource.includes(
      "deductionCreditTransactionId !== deductionTransactionId",
  ));
  assert.equal(validatorSource.includes("creditTransactionCandidates"), false);
});

test("fixed F01-F10 runner identity and cardinality are exact", () => {
  const digest = crypto.createHash("sha256")
      .update(fixedHarness)
      .digest("hex");
  assert.equal(digest, FIXED_HARNESS_SHA256);
  assert.equal(fixedHarness.endsWith("\n"), true);
  assert.equal(
      fixedHarness.split("\n").length - 1,
      FIXED_HARNESS_LINE_COUNT,
  );
  const adminAuthMatch = fixedHarness.match(
      /const adminAuth = \{([\s\S]*?)\n\};\nconst teacherAuth =/,
  );
  assert.ok(adminAuthMatch);
  const adminTokenRoleMatch = adminAuthMatch[1].match(
      /\n    role: "([^"]+)",/,
  );
  assert.ok(adminTokenRoleMatch);
  assert.equal(adminTokenRoleMatch[1], "owner");
  const expected = [
    "testF01FixedReversalPreview",
    "testF02FixedReversalCommit",
    "testF03SameRequestReplay",
    "testF04DifferentRequestReplay",
    "testF05ConcurrentFixedReversal",
    "testF06AlreadyReversedFailClosed",
    "testF07StaleReversalPlanHash",
    "testF08CrossReservationAndCycleReuse",
    "testF09ReNoShowCreatesNewCycle",
    "testF10SecondCycleReversal",
  ];
  const declarations = [
    ...fixedHarness.matchAll(
        /^async function (testF(?:0[1-9]|10)[A-Za-z0-9_]*)\(/gm,
    ),
  ].map((match) => match[1]);
  assert.deepEqual(declarations, expected);
  assert.equal(new Set(declarations).size, 10);
  const main = functionBody(fixedHarness, "main");
  const adminMembershipRoleMatch = main.match(
      /await seedMembership\(ADMIN_UID, \{role: "([^"]+)"\}\);/,
  );
  assert.ok(adminMembershipRoleMatch);
  assert.equal(adminMembershipRoleMatch[1], "owner");
  assert.equal(adminTokenRoleMatch[1], adminMembershipRoleMatch[1]);
  expected.forEach((name) => {
    assert.equal(
        (fixedHarness.match(new RegExp(`async function ${name}\\(`, "g")) ||
          []).length,
        1,
        `${name} declaration cardinality`,
    );
    assert.equal(
        (main.match(new RegExp(`await ${name}\\(`, "g")) || []).length,
        1,
        `${name} execution cardinality`,
    );
  });
  assert.deepEqual(fixedHarness.match(/\b(?:skip|todo)\b/gi) || [], []);
  assert.equal(fixedHarness.includes(".skip("), false);
  assert.equal(fixedHarness.includes(".todo("), false);
});

test("fixed F01-F10 runner invokes production handlers directly", () => {
  assert.ok(fixedHarness.includes(
      "functions.previewFixedPrivateLessonOutcomeAction",
  ));
  assert.ok(fixedHarness.includes(
      "functions.commitFixedPrivateLessonOutcomeAction",
  ));
  assert.ok(functionsSource.includes(
      "exports.previewFixedPrivateLessonOutcomeAction = onCall(",
  ));
  assert.ok(functionsSource.includes(
      "exports.commitFixedPrivateLessonOutcomeAction = onCall(",
  ));
  const requiredCalls = new Map([
    ["testF01FixedReversalPreview", ["previewFixture("]],
    ["testF02FixedReversalCommit", ["commitOutcome("]],
    ["testF03SameRequestReplay", ["commitOutcome("]],
    ["testF04DifferentRequestReplay", ["commitOutcome("]],
    ["testF05ConcurrentFixedReversal", [
      "previewFixture(",
      "commitOutcome(",
      "Promise.allSettled(",
    ]],
    ["testF06AlreadyReversedFailClosed", [
      "previewFixture(",
      "commitOutcome(",
    ]],
    ["testF07StaleReversalPlanHash", [
      "previewFixture(",
      "commitOutcome(",
    ]],
    ["testF08CrossReservationAndCycleReuse", [
      "previewFixture(",
      "commitOutcome(",
    ]],
    ["testF09ReNoShowCreatesNewCycle", [
      "previewFixture(",
      "commitOutcome(",
    ]],
    ["testF10SecondCycleReversal", [
      "previewFixture(",
      "commitOutcome(",
    ]],
  ]);
  requiredCalls.forEach((tokens, name) => {
    const body = functionBody(fixedHarness, name);
    tokens.forEach((token) => {
      assert.ok(body.includes(token), `${name} ${token}`);
    });
  });
  assert.equal(fixedHarness.includes("runTransaction("), false);
  for (const internalName of [
    "buildFixedPrivateOutcomeReversalPlan",
    "applyPrivateReservationOutcomeReversalAccountingInTransaction",
    "buildFixedPrivateReversalAccountingIdentity",
  ]) {
    assert.equal(
        fixedHarness.includes(`function ${internalName}(`),
        false,
        `${internalName} must not be reimplemented by the runner`,
    );
  }
});

test("fixed reverse action, plan hash, and cycle fields are pinned", () => {
  const allowlist = functionsSource.match(
      /const FIXED_PRIVATE_OUTCOME_ACTIONS = \[([\s\S]*?)\];/,
  );
  assert.ok(allowlist);
  assert.deepEqual(
      [...allowlist[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]),
      ["complete", "no_show", "reverse_deduction"],
  );
  const validator = functionBody(
      functionsSource,
      "validateFixedPrivateOutcomeActionPayload",
  );
  assert.ok(validator.includes(
      "FIXED_PRIVATE_OUTCOME_ACTIONS.includes(actionType)",
  ));
  assert.ok(validator.includes("requireString(data, \"planHash\")"));
  assert.equal(validator.includes("actionType ||"), false);
  const fixedPlan = functionBody(
      functionsSource,
      "buildFixedPrivateOutcomePlan",
  );
  assert.ok(fixedPlan.includes(
      "validation.actionType === \"reverse_deduction\"",
  ));
  assert.ok(fixedPlan.includes("buildFixedPrivateOutcomeReversalPlan({"));
  const reversalPlan = functionBody(
      functionsSource,
      "buildFixedPrivateOutcomeReversalPlan",
  );
  for (const token of [
    "currentState",
    "activeDeductionId",
    "originalCreditTransactionId",
    "reversalCreditTransactionId",
    "canonicalDeductionId",
    "deductionCycleNumber",
    "packageUsedCount",
    "packageRemainingCount",
    "additionalPackageRestore: 1",
    "usedCountDelta: -1",
    "remainingCountDelta: 1",
    "deltaCount: 1",
  ]) {
    assert.ok(reversalPlan.includes(token), token);
  }
  const preview = functionBody(
      functionsSource,
      "previewFixedPrivateLessonOutcomeAction",
  );
  const commit = functionBody(
      functionsSource,
      "commitFixedPrivateLessonOutcomeAction",
  );
  assert.ok(preview.includes("buildFixedPrivateOutcomePlanHash({"));
  assert.ok(commit.includes("buildFixedPrivateOutcomePlanHash({"));
  assert.ok(commit.includes("actualPlanHash !== validation.planHash"));
  assert.ok(functionsSource.includes(
      "function buildFixedPrivateOutcomePlanHash({",
  ));
});

test("fixed and direct reversal share server transaction accounting", () => {
  const commit = functionBody(
      functionsSource,
      "commitFixedPrivateLessonOutcomeAction",
  );
  const shared = functionBody(
      functionsSource,
      "applyPrivateReservationOutcomeReversalAccountingInTransaction",
  );
  const fixedIdentity = functionBody(
      functionsSource,
      "buildFixedPrivateReversalAccountingIdentity",
  );
  assert.ok(commit.includes("db.runTransaction"));
  assert.ok(commit.includes("buildFixedPrivateReversalAccountingIdentity({"));
  assert.ok(commit.includes(
      "applyPrivateReservationOutcomeReversalAccountingInTransaction(",
  ));
  assert.ok(shared.includes("transaction.update(packageRef"));
  assert.ok(shared.includes("transaction.update(originalCreditRef"));
  assert.ok(shared.includes("transaction.create(reversalCreditRef"));
  assert.ok(shared.includes("usedBefore - 1"));
  assert.ok(shared.includes("remainingBefore + 1"));
  assert.ok(fixedIdentity.includes(
      "sourceType: \"fixedPrivateReservation\"",
  ));
  assert.ok(fixedIdentity.includes(
      "actionType: \"fixed_private_no_show_deduct_reversal\"",
  ));
  assert.ok(fixedIdentity.includes(
      "fixedPrivateDeductionLedger: FIXED_PRIVATE_DEDUCTION_LEDGER",
  ));
  const direct = functionBody(
      functionsSource,
      "reversePrivateReservationOutcomeInTransaction",
  );
  assert.ok(direct.includes(
      "applyPrivateReservationOutcomeReversalAccountingInTransaction(",
  ));
  assert.ok(direct.includes("buildDirectPrivateReversalAccountingIdentity({"));
  assert.ok(direct.includes("assertNotFixedPrivateDirectReservation("));
  for (const internalName of [
    "applyPrivateReservationOutcomeReversalAccountingInTransaction",
    "buildFixedPrivateReversalAccountingIdentity",
    "buildDirectPrivateReversalAccountingIdentity",
  ]) {
    assert.equal(functionsSource.includes(`exports.${internalName}`), false);
  }
  const clientWrites = ["setDoc(", "updateDoc(", "addDoc(", "writeBatch("];
  for (const clientWrite of clientWrites) {
    assert.equal(commit.includes(clientWrite), false);
    assert.equal(shared.includes(clientWrite), false);
  }
});

test("direct reversal request shape and fixed exports remain bounded", () => {
  const direct = functionBody(
      functionsSource,
      "reversePrivateReservationOutcomeInTransaction",
  );
  assert.ok(
      (direct.match(/assertNotFixedPrivateDirectReservation\(/g) || [])
          .length >= 2,
  );
  const publicStart = functionsSource.indexOf(
      "exports.reversePrivateReservationOutcome = onCall(",
  );
  const publicEnd = functionsSource.indexOf(
      "exports.bootstrapAdmin = onCall(",
      publicStart,
  );
  assert.ok(publicStart > 0);
  assert.ok(publicEnd > publicStart);
  const publicSource = functionsSource.slice(publicStart, publicEnd);
  for (const token of [
    "optionalString(data, \"requestId\")",
    "optionalString(data, \"planHash\")",
    "optionalString(data, \"packageId\")",
    "optionalString(data, \"activeDeductionId\")",
    "\"reversalCreditTransactionId\"",
    "requireString(data, \"reason\")",
    "requestMode = hasRequestId ? \"current\" : \"legacy\"",
  ]) {
    assert.ok(publicSource.includes(token), token);
  }
  for (const exportName of [
    "previewFixedPrivateLessonOutcomeAction",
    "commitFixedPrivateLessonOutcomeAction",
  ]) {
    assert.equal(
        (functionsSource.match(
            new RegExp(`exports\\.${exportName} = onCall\\(`, "g"),
        ) || []).length,
        1,
    );
  }
});

test("teacher UID mismatch is authoritative and write-free", () => {
  const mismatch = functionBody(
      harness,
      "accountingCaseA22CanonicalTeacherUidMismatch",
  );
  assert.ok(mismatch.includes("const occurrenceUid"));
  assert.ok(mismatch.includes("const packageUid"));
  assert.ok(mismatch.includes("teacherUid: occurrenceUid"));
  assert.ok(mismatch.includes("teacherUid: packageUid"));
  assert.ok(mismatch.includes("teacher_identity_mismatch"));
  assert.ok(mismatch.includes("commitOutcome({"));
  assert.ok(mismatch.includes("beforeCommit"));
  assert.ok(mismatch.includes("getSourceCredits("));
  assert.ok(functionsSource.includes(
      "const tiers = [\"uidIds\", \"teacherIds\", \"teacherKeys\", \"names\"]",
  ));
});

test("loopback cleanup surrounds runtime execution", () => {
  const cleanup = functionBody(
      harness,
      "clearDedicatedFirestoreEmulator",
  );
  assert.ok(cleanup.includes("hostname: FIRESTORE_CONFIG.host"));
  assert.ok(cleanup.includes("port: FIRESTORE_CONFIG.port"));
  assert.ok(cleanup.includes("method: \"DELETE\""));
  assert.ok(cleanup.includes("/databases/(default)/documents"));
  const main = functionBody(harness, "main");
  assert.ok(main.includes("try {"));
  assert.ok(main.includes("finally {"));
  assert.equal(
      (main.match(/clearDedicatedFirestoreEmulator\(\)/g) || []).length,
      3,
  );
});
