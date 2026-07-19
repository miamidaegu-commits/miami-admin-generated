import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

const repositoryRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
);
const functionsPath = path.join(repositoryRoot, "functions", "index.js");
const functionsSource = fs.readFileSync(functionsPath, "utf8");
const BASE_FUNCTIONS_SHA256 =
  "b6cbe38ce29b1f32b53599aa159eab1651d9b5d8dbee9d23d5b9f77d26589b66";
const TARGETS = Object.freeze([
  "createFixedPrivateLessonAssignment",
  "previewFixedPrivateLessonOutcomeAction",
  "commitFixedPrivateLessonOutcomeAction",
]);
const WRITER_RUNTIME_SERVICE_ACCOUNT =
  "academy-private-writer-runtime@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const PREVIEW_RUNTIME_SERVICE_ACCOUNT =
  "academy-private-preview-runtime@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const COMPUTE_DEFAULT_SERVICE_ACCOUNT =
  "884850632328-compute@developer.gserviceaccount.com";
const EXPECTED_COMMON_OPTIONS = Object.freeze({
  region: "us-central1",
  cors: true,
  memory: "256MiB",
  timeoutSeconds: 60,
  cpu: 1,
  concurrency: 80,
  maxInstances: 10,
  ingressSettings: "ALLOW_ALL",
  enforceAppCheck: false,
  consumeAppCheckToken: false,
});
const EXPECTED_OPTIONS_BY_TARGET = Object.freeze({
  createFixedPrivateLessonAssignment: Object.freeze({
    ...EXPECTED_COMMON_OPTIONS,
    serviceAccount: WRITER_RUNTIME_SERVICE_ACCOUNT,
  }),
  previewFixedPrivateLessonOutcomeAction: Object.freeze({
    ...EXPECTED_COMMON_OPTIONS,
    serviceAccount: PREVIEW_RUNTIME_SERVICE_ACCOUNT,
  }),
  commitFixedPrivateLessonOutcomeAction: Object.freeze({
    ...EXPECTED_COMMON_OPTIONS,
    serviceAccount: WRITER_RUNTIME_SERVICE_ACCOUNT,
  }),
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function findBalancedEnd(source, startIndex, open, close) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = startIndex; index < source.length; index += 1) {
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
    if (char === "\"" || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === open) depth += 1;
    if (char === close) {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }
  throw new Error(`Unbalanced ${open}${close} source block.`);
}

function callableOptionsRange(functionName) {
  const marker = `exports.${functionName} = onCall(`;
  const markerIndex = functionsSource.indexOf(marker);
  assert.notEqual(markerIndex, -1, functionName);
  const start = functionsSource.indexOf("{", markerIndex + marker.length);
  assert.notEqual(start, -1, functionName);
  return {
    start,
    end: findBalancedEnd(functionsSource, start, "{", "}"),
  };
}

function evaluateOptions(range) {
  const source = functionsSource.slice(range.start, range.end);
  return Function(
      "REGION",
      `"use strict"; return (${source});`,
  )("us-central1");
}

function optionsSource(range) {
  return functionsSource.slice(range.start, range.end);
}

function assertExactTargetOptions(functionName, options) {
  assert.deepEqual(
      options,
      EXPECTED_OPTIONS_BY_TARGET[functionName],
      functionName,
  );
  assert.equal(
      Object.prototype.hasOwnProperty.call(options, "minInstances"),
      false,
      functionName,
  );
  assert.equal(typeof options.serviceAccount, "string", functionName);
}

function assertLiteralServiceAccountCannotBeOverridden(source) {
  assert.equal(
      source.match(/\bserviceAccount\s*:/g)?.length || 0,
      1,
      "serviceAccount key count",
  );
  assert.doesNotMatch(source, /\.\.\./, "options spread");
}

function functionBody(declaration) {
  const declarationIndex = functionsSource.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, declaration);
  const declarationTail = functionsSource.slice(declarationIndex);
  const bodyOpening = declarationTail.match(/\)\s*\{/);
  assert.ok(bodyOpening, declaration);
  const start = declarationIndex + bodyOpening.index +
    bodyOpening[0].lastIndexOf("{");
  const end = findBalancedEnd(functionsSource, start, "{", "}");
  return functionsSource.slice(start, end);
}

test("three missing private functions pin the exact approved runtime options", () => {
  for (const functionName of TARGETS) {
    const range = callableOptionsRange(functionName);
    assertExactTargetOptions(functionName, evaluateOptions(range));
    assertLiteralServiceAccountCannotBeOverridden(optionsSource(range));
  }
});

test("runtime identities are exact, isolated, and non-interchangeable", () => {
  const optionsByTarget = Object.fromEntries(
      TARGETS.map((functionName) => [
        functionName,
        evaluateOptions(callableOptionsRange(functionName)),
      ]),
  );
  assert.equal(
      optionsByTarget.createFixedPrivateLessonAssignment.serviceAccount,
      WRITER_RUNTIME_SERVICE_ACCOUNT,
  );
  assert.equal(
      optionsByTarget.commitFixedPrivateLessonOutcomeAction.serviceAccount,
      WRITER_RUNTIME_SERVICE_ACCOUNT,
  );
  assert.equal(
      optionsByTarget.previewFixedPrivateLessonOutcomeAction.serviceAccount,
      PREVIEW_RUNTIME_SERVICE_ACCOUNT,
  );
  for (const options of Object.values(optionsByTarget)) {
    assert.notEqual(options.serviceAccount, COMPUTE_DEFAULT_SERVICE_ACCOUNT);
  }

  const ranges = TARGETS
      .map(callableOptionsRange)
      .sort((left, right) => right.start - left.start);
  let unrelatedSource = functionsSource;
  for (const range of ranges) {
    unrelatedSource =
      unrelatedSource.slice(0, range.start) +
      unrelatedSource.slice(range.end);
  }
  assert.equal(
      unrelatedSource.includes(WRITER_RUNTIME_SERVICE_ACCOUNT),
      false,
  );
  assert.equal(
      unrelatedSource.includes(PREVIEW_RUNTIME_SERVICE_ACCOUNT),
      false,
  );
});

test("runtime identity contract rejects malformed or overridden values", () => {
  const writerName = "createFixedPrivateLessonAssignment";
  const previewName = "previewFixedPrivateLessonOutcomeAction";
  const writerOptions = EXPECTED_OPTIONS_BY_TARGET[writerName];
  const previewOptions = EXPECTED_OPTIONS_BY_TARGET[previewName];
  const invalidWriterValues = [
    WRITER_RUNTIME_SERVICE_ACCOUNT.toUpperCase(),
    ` ${WRITER_RUNTIME_SERVICE_ACCOUNT}`,
    WRITER_RUNTIME_SERVICE_ACCOUNT.replace(
        "daegu-miami-production",
        "other-production",
    ),
    null,
    884850632328,
  ];
  for (const serviceAccount of invalidWriterValues) {
    assert.throws(() => assertExactTargetOptions(writerName, {
      ...writerOptions,
      serviceAccount,
    }));
  }
  const missingServiceAccount = {...writerOptions};
  delete missingServiceAccount.serviceAccount;
  assert.throws(
      () => assertExactTargetOptions(writerName, missingServiceAccount),
  );
  assert.throws(() => assertExactTargetOptions(writerName, {
    ...writerOptions,
    serviceAccount: PREVIEW_RUNTIME_SERVICE_ACCOUNT,
  }));
  assert.throws(() => assertExactTargetOptions(previewName, {
    ...previewOptions,
    serviceAccount: WRITER_RUNTIME_SERVICE_ACCOUNT,
  }));
  assert.throws(
      () => assertLiteralServiceAccountCannotBeOverridden(
          "{...base, serviceAccount: \"writer@example.com\"}",
      ),
  );
  assert.throws(
      () => assertLiteralServiceAccountCannotBeOverridden(
          "{serviceAccount: \"first\", serviceAccount: \"later\"}",
      ),
  );
});

test("no unrelated function source changed from the approved base", () => {
  const ranges = TARGETS
      .map(callableOptionsRange)
      .sort((left, right) => right.start - left.start);
  let normalized = functionsSource;
  for (const range of ranges) {
    normalized =
      normalized.slice(0, range.start) +
      "{region: REGION, cors: true}" +
      normalized.slice(range.end);
  }
  assert.equal(sha256(normalized), BASE_FUNCTIONS_SHA256);
});

test("both target writers retain their exact freeze guards", () => {
  const assignment = functionBody(
      "async function runFixedPrivateAssignmentWriteTransaction(",
  );
  const commit = functionBody(
      "async function commitFixedPrivateLessonOutcomeAction(",
  );
  assert.match(
      assignment,
      /guardAcademyWrite\(\{[\s\S]*writeSurfaceId: "createFixedPrivateLessonAssignment"/,
  );
  assert.ok(
      assignment.indexOf("guardAcademyWrite({") <
      assignment.indexOf("transaction.get("),
  );
  assert.ok(
      assignment.indexOf("guardAcademyWrite({") <
      assignment.indexOf("transaction.create("),
  );
  assert.match(
      commit,
      /guardAcademyWrite\(\{[\s\S]*writeSurfaceId: "commitFixedPrivateLessonOutcomeAction"/,
  );
  assert.ok(
      commit.indexOf("guardAcademyWrite({") <
      commit.indexOf("transaction.get("),
  );
  assert.ok(
      commit.indexOf("guardAcademyWrite({") <
      commit.indexOf("transaction.update("),
  );
});

test("fixed private outcome preview remains write-free", () => {
  const preview = functionBody(
      "async function previewFixedPrivateLessonOutcomeAction(",
  );
  const forbiddenWrites = [
    "runTransaction(",
    "writeBatch(",
    "transaction.set(",
    "transaction.create(",
    "transaction.update(",
    "transaction.delete(",
    ".set(",
    ".create(",
    ".update(",
    ".delete(",
    "admin.auth().",
  ];
  for (const token of forbiddenWrites) {
    assert.equal(preview.includes(token), false, token);
  }
});
