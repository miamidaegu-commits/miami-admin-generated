import assert from "node:assert/strict";
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
const functionsPath = path.join(root, "functions", "index.js");
const configSource = fs.readFileSync(configPath, "utf8");
const config = JSON.parse(configSource);
const harness = fs.readFileSync(harnessPath, "utf8");
const functionsSource = fs.readFileSync(functionsPath, "utf8");

function functionBody(source, name) {
  const declaration = `async function ${name}`;
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

  const parameterOpening = skipTrivia(start + declaration.length);
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
  const reversal = functionBody(
      functionsSource,
      "reversePrivateReservationOutcomeInTransaction",
  );
  assert.ok(commit.includes("db.runTransaction"));
  assert.ok(commit.includes(
      "applyPrivateReservationOutcomeWithDeductionInTransaction",
  ));
  assert.ok(commit.includes("transaction.create(batchRef, checkpoint)"));
  assert.ok(reversal.includes("transaction.update(packageRef"));
  assert.ok(reversal.includes("transaction.create(reversalCreditRef"));
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
