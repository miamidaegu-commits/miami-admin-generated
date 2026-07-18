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
  "461f0b94acae0f7d78c73d6c481c66499c9c2bc5826ff040e17ba5392feb6170";
const TARGETS = Object.freeze([
  "createFixedPrivateLessonAssignment",
  "previewFixedPrivateLessonOutcomeAction",
  "commitFixedPrivateLessonOutcomeAction",
]);
const EXPECTED_OPTIONS = Object.freeze({
  region: "us-central1",
  cors: true,
  memory: "256MiB",
  timeoutSeconds: 60,
  cpu: 1,
  concurrency: 80,
  maxInstances: 10,
  serviceAccount:
    "884850632328-compute@developer.gserviceaccount.com",
  ingressSettings: "ALLOW_ALL",
  enforceAppCheck: false,
  consumeAppCheckToken: false,
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
    const options = evaluateOptions(callableOptionsRange(functionName));
    assert.deepEqual(options, EXPECTED_OPTIONS, functionName);
    assert.equal(
        Object.prototype.hasOwnProperty.call(options, "minInstances"),
        false,
        functionName,
    );
  }
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
      assignment.indexOf("transaction.create("),
  );
  assert.match(
      commit,
      /guardAcademyWrite\(\{[\s\S]*writeSurfaceId: "commitFixedPrivateLessonOutcomeAction"/,
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
