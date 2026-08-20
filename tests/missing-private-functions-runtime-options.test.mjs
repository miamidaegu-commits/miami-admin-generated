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
  "fb81864df591de5b484773cd66110ae0c39a3aee0470deec8f927cd9244f9910";
const TARGETS = Object.freeze([
  "createFixedPrivateLessonAssignment",
  "previewFixedPrivateLessonOutcomeAction",
  "commitFixedPrivateLessonOutcomeAction",
]);
const WRITER_RUNTIME_SERVICE_ACCOUNT = "academy-private-writer-runtime@";
const FULL_PRODUCTION_WRITER_RUNTIME_SERVICE_ACCOUNT =
  "academy-private-writer-runtime@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const FULL_DEV_WRITER_RUNTIME_SERVICE_ACCOUNT =
  "academy-private-writer-runtime@miami-e2e.iam.gserviceaccount.com";
const PREVIEW_RUNTIME_SERVICE_ACCOUNT =
  "academy-private-preview-rt@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const COMPUTE_DEFAULT_SERVICE_ACCOUNT =
  "884850632328-compute@developer.gserviceaccount.com";
const LEGACY_REQUEST_HANDLER_SHA256_BY_TARGET = Object.freeze({
  createFixedPrivateLessonAssignment:
    "8b6eca90695112b1b1788d0e48f7ad846e291824ad51fe315bbc953b034e726b",
  previewFixedPrivateLessonOutcomeAction:
    "b08c275c1c412533435e7e55257a8d855cd19c7cefdae7cbaddda6f6546c1b96",
  commitFixedPrivateLessonOutcomeAction:
    "49f3b3a5c1ac894d08737267649a0bc4dbe6f5f749be6d5edfabd61d04bccd0a",
});
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

function requestHandlerSource(functionName) {
  const options = callableOptionsRange(functionName);
  const start = functionsSource.indexOf("async (request) => {", options.end);
  assert.notEqual(start, -1, functionName);
  const bodyStart = functionsSource.indexOf("{", start);
  const end = findBalancedEnd(functionsSource, bodyStart, "{", "}");
  return functionsSource.slice(start, end);
}

function expandSameProjectServiceAccount(serviceAccount, projectId) {
  assert.match(serviceAccount, /^[a-z][a-z0-9-]*@$/);
  assert.match(projectId, /^[a-z][a-z0-9-]*$/);
  return `${serviceAccount}${projectId}.iam.gserviceaccount.com`;
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

test("I01 — Production source uses writer short form without full email", () => {
  for (const functionName of TARGETS) {
    const range = callableOptionsRange(functionName);
    assertExactTargetOptions(functionName, evaluateOptions(range));
    assertLiteralServiceAccountCannotBeOverridden(optionsSource(range));
  }
  for (const functionName of [
    "createFixedPrivateLessonAssignment",
    "commitFixedPrivateLessonOutcomeAction",
  ]) {
    const source = optionsSource(callableOptionsRange(functionName));
    assert.equal(source.includes(WRITER_RUNTIME_SERVICE_ACCOUNT), true);
    assert.equal(
        source.includes(FULL_PRODUCTION_WRITER_RUNTIME_SERVICE_ACCOUNT),
        false,
    );
  }
});

test("I02 — Dev uses the same short form without a full Dev email", () => {
  assert.equal(
      expandSameProjectServiceAccount(
          WRITER_RUNTIME_SERVICE_ACCOUNT,
          "miami-e2e",
      ),
      FULL_DEV_WRITER_RUNTIME_SERVICE_ACCOUNT,
  );
  for (const functionName of [
    "createFixedPrivateLessonAssignment",
    "commitFixedPrivateLessonOutcomeAction",
  ]) {
    const source = optionsSource(callableOptionsRange(functionName));
    assert.equal(source.includes(WRITER_RUNTIME_SERVICE_ACCOUNT), true);
    assert.equal(source.includes(FULL_DEV_WRITER_RUNTIME_SERVICE_ACCOUNT), false);
  }
});

test("I10 — Production writer identity is not reused in Dev", () => {
  const productionIdentity = expandSameProjectServiceAccount(
      WRITER_RUNTIME_SERVICE_ACCOUNT,
      "daegu-miami-production",
  );
  const devIdentity = expandSameProjectServiceAccount(
      WRITER_RUNTIME_SERVICE_ACCOUNT,
      "miami-e2e",
  );
  assert.equal(productionIdentity, FULL_PRODUCTION_WRITER_RUNTIME_SERVICE_ACCOUNT);
  assert.equal(devIdentity, FULL_DEV_WRITER_RUNTIME_SERVICE_ACCOUNT);
  assert.notEqual(productionIdentity, devIdentity);
});

test("I11 — exact affected exports share the intended runtime identity", () => {
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
    `${WRITER_RUNTIME_SERVICE_ACCOUNT} `,
    WRITER_RUNTIME_SERVICE_ACCOUNT.slice(0, -1),
    FULL_PRODUCTION_WRITER_RUNTIME_SERVICE_ACCOUNT,
    FULL_DEV_WRITER_RUNTIME_SERVICE_ACCOUNT,
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

test("I12 — legacy API request contract remains byte-exact", () => {
  assert.deepEqual(
      Object.keys(LEGACY_REQUEST_HANDLER_SHA256_BY_TARGET).sort(),
      [...TARGETS].sort(),
  );
  for (const functionName of TARGETS) {
    assert.equal(
        sha256(requestHandlerSource(functionName)),
        LEGACY_REQUEST_HANDLER_SHA256_BY_TARGET[functionName],
        functionName,
    );
  }
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
