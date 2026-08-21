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
const dashboardPath = path.join(repositoryRoot, "Dashboard.jsx");
const deployRunbookPath = path.join(
    repositoryRoot,
    "docs",
    "production-deploy-runbook.md",
);
const runtimeIamContractPath = path.join(
    repositoryRoot,
    "functions",
    "scripts",
    "academy-private-runtime-iam-contract.mjs",
);
const functionsSource = fs.readFileSync(functionsPath, "utf8");
const dashboardSource = fs.readFileSync(dashboardPath, "utf8");
const deployRunbookSource = fs.readFileSync(deployRunbookPath, "utf8");
const runtimeIamContractSource =
  fs.readFileSync(runtimeIamContractPath, "utf8");
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
const PREVIEW_RUNTIME_SERVICE_ACCOUNT = "academy-private-preview-rt@";
const FULL_PRODUCTION_PREVIEW_RUNTIME_SERVICE_ACCOUNT =
  "academy-private-preview-rt@" +
  "daegu-miami-production.iam.gserviceaccount.com";
const FULL_DEV_PREVIEW_RUNTIME_SERVICE_ACCOUNT =
  "academy-private-preview-rt@miami-e2e.iam.gserviceaccount.com";
const COMPUTE_DEFAULT_SERVICE_ACCOUNT =
  "884850632328-compute@developer.gserviceaccount.com";
const PREVIEW_HELPER_CALL_GRAPH = Object.freeze([
  "validateFixedPrivateOutcomeActionPayload",
  "resolveFixedPrivateOutcomeTarget",
  "resolvePrivateLessonStatusActor",
  "resolveFixedPrivateOutcomePermission",
  "buildFixedPrivateOutcomePlan",
  "buildFixedPrivateOutcomePlanHash",
  "summarizeFixedPrivateOutcomeTarget",
]);
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

function functionBody(declaration, source = functionsSource) {
  const declarationIndex = source.indexOf(declaration);
  assert.notEqual(declarationIndex, -1, declaration);
  const declarationTail = source.slice(declarationIndex);
  const bodyOpening = declarationTail.match(/\)\s*\{/);
  assert.ok(bodyOpening, declaration);
  const start = declarationIndex + bodyOpening.index +
    bodyOpening[0].lastIndexOf("{");
  const end = findBalancedEnd(source, start, "{", "}");
  return source.slice(start, end);
}

function assertWriteFree(source, label) {
  const forbiddenWrites = [
    "runTransaction(",
    "writeBatch(",
    "bulkWriter(",
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
    assert.equal(source.includes(token), false, `${label}: ${token}`);
  }
}

test("P01 — Preview serviceAccount uses the exact short form", () => {
  for (const functionName of TARGETS) {
    const range = callableOptionsRange(functionName);
    assertExactTargetOptions(functionName, evaluateOptions(range));
    assertLiteralServiceAccountCannotBeOverridden(optionsSource(range));
  }
  const previewRange = callableOptionsRange(
      "previewFixedPrivateLessonOutcomeAction",
  );
  assert.equal(
      evaluateOptions(previewRange).serviceAccount,
      PREVIEW_RUNTIME_SERVICE_ACCOUNT,
  );
  assert.equal(
      optionsSource(previewRange).includes(
          `serviceAccount: "${PREVIEW_RUNTIME_SERVICE_ACCOUNT}"`,
      ),
      true,
  );
});

test("P02 — active source excludes the Production Preview full email", () => {
  assert.equal(
      functionsSource.includes(
          FULL_PRODUCTION_PREVIEW_RUNTIME_SERVICE_ACCOUNT,
      ),
      false,
  );
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

test("P03 — active source contains no hard-coded Dev full email", () => {
  assert.equal(
      expandSameProjectServiceAccount(
          PREVIEW_RUNTIME_SERVICE_ACCOUNT,
          "miami-e2e",
      ),
      FULL_DEV_PREVIEW_RUNTIME_SERVICE_ACCOUNT,
  );
  assert.equal(
      expandSameProjectServiceAccount(
          WRITER_RUNTIME_SERVICE_ACCOUNT,
          "miami-e2e",
      ),
      FULL_DEV_WRITER_RUNTIME_SERVICE_ACCOUNT,
  );
  assert.equal(
      functionsSource.includes(FULL_DEV_PREVIEW_RUNTIME_SERVICE_ACCOUNT),
      false,
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

test("P07 — short forms do not reuse a cross-project runtime identity", () => {
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
  const productionPreviewIdentity = expandSameProjectServiceAccount(
      PREVIEW_RUNTIME_SERVICE_ACCOUNT,
      "daegu-miami-production",
  );
  const devPreviewIdentity = expandSameProjectServiceAccount(
      PREVIEW_RUNTIME_SERVICE_ACCOUNT,
      "miami-e2e",
  );
  assert.equal(
      productionPreviewIdentity,
      FULL_PRODUCTION_PREVIEW_RUNTIME_SERVICE_ACCOUNT,
  );
  assert.equal(devPreviewIdentity, FULL_DEV_PREVIEW_RUNTIME_SERVICE_ACCOUNT);
  assert.notEqual(productionPreviewIdentity, devPreviewIdentity);
  assert.equal(
      optionsSource(callableOptionsRange(
          "previewFixedPrivateLessonOutcomeAction",
      )).includes(".iam.gserviceaccount.com"),
      false,
  );
});

test("P04 — affected export is exactly the one Preview callable", () => {
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
  const exportNames = [...functionsSource.matchAll(
      /^exports\.([A-Za-z0-9_]+)\s*=\s*onCall\(/gm,
  )].map((match) => match[1]);
  assert.deepEqual(
      exportNames.filter((functionName) =>
        optionsSource(callableOptionsRange(functionName))
            .includes(PREVIEW_RUNTIME_SERVICE_ACCOUNT)),
      ["previewFixedPrivateLessonOutcomeAction"],
  );

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

test("P08 — no default identity, spread, override, or fallback", () => {
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
  for (const functionName of TARGETS) {
    const source = optionsSource(callableOptionsRange(functionName));
    assertLiteralServiceAccountCannotBeOverridden(source);
    assert.notEqual(
        evaluateOptions(callableOptionsRange(functionName)).serviceAccount,
        COMPUTE_DEFAULT_SERVICE_ACCOUNT,
    );
    assert.doesNotMatch(
        source,
        /process\.env|\?\?|\|\||default.*serviceAccount|serviceAccount.*default/i,
    );
  }
});

test("P05 — Dev viewer and Production custom-role targets stay separate", () => {
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
  for (const token of [
    FULL_DEV_PREVIEW_RUNTIME_SERVICE_ACCOUNT,
    "enabled",
    "roles/datastore.viewer",
    "roles/iam.serviceAccountUser",
    "zero user-managed keys",
    "custom role `academyBackendReadOnly`",
  ]) {
    assert.equal(deployRunbookSource.includes(token), true, token);
  }
  assert.equal(
      runtimeIamContractSource.includes(
          "export const READ_ONLY_ROLE_ID = \"academyBackendReadOnly\"",
      ),
      true,
  );
  assert.equal(
      runtimeIamContractSource.includes("roles/datastore.viewer"),
      false,
  );
});

test("P11 — handler SHA, request tokens, and legacy API stay byte-exact", () => {
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
  const previewHandler = requestHandlerSource(
      "previewFixedPrivateLessonOutcomeAction",
  );
  for (const token of [
    "if (!request.auth)",
    "throw new HttpsError(\"unauthenticated\", \"auth_required\")",
    "db: admin.firestore()",
    "auth: request.auth",
    "data: request.data || {}",
    "throw asHttpsError(error)",
  ]) {
    assert.equal(previewHandler.includes(token), true, token);
  }
});

test("P06 — writer identity and role stay separate from Preview", () => {
  assert.notEqual(
      WRITER_RUNTIME_SERVICE_ACCOUNT,
      PREVIEW_RUNTIME_SERVICE_ACCOUNT,
  );
  for (const token of [
    "roles/datastore.user",
    "academyPrivateWriterRuntimeV1",
    "roles/datastore.viewer",
    "academyBackendReadOnly",
  ]) {
    assert.equal(deployRunbookSource.includes(token), true, token);
  }
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

test("P09 — no service-account key, env, or secret credential contract", () => {
  const previewOptions = optionsSource(callableOptionsRange(
      "previewFixedPrivateLessonOutcomeAction",
  ));
  assert.doesNotMatch(
      previewOptions,
      /process\.env|GOOGLE_APPLICATION_CREDENTIALS|privateKey|serviceAccountKey|secret/i,
  );
  assert.deepEqual(
      Object.keys(evaluateOptions(callableOptionsRange(
          "previewFixedPrivateLessonOutcomeAction",
      ))).sort(),
      Object.keys(
          EXPECTED_OPTIONS_BY_TARGET.previewFixedPrivateLessonOutcomeAction,
      ).sort(),
  );
  assert.equal(
      deployRunbookSource.includes("zero user-managed keys"),
      true,
  );
});

test("P10 — full Preview helper graph and UI stay write-free dry-run", () => {
  const preview = functionBody(
      "async function previewFixedPrivateLessonOutcomeAction(",
  );
  for (const helperName of PREVIEW_HELPER_CALL_GRAPH) {
    assert.equal(preview.includes(`${helperName}(`), true, helperName);
    assertWriteFree(
        functionBody(`function ${helperName}(`),
        helperName,
    );
  }
  assertWriteFree(preview, "previewFixedPrivateLessonOutcomeAction");
  for (const token of [
    "dryRun: true",
    "previewOnly: true",
    "commit: false",
  ]) {
    assert.equal(preview.includes(token), true, token);
  }

  const uiPreview = functionBody(
      "async function previewFixedPrivateLessonOutcomeActionOnServer(",
      dashboardSource,
  );
  for (const token of [
    "'previewFixedPrivateLessonOutcomeAction'",
    "dryRun: true",
    "previewOnly: true",
    "commit: false",
    "previewData.dryRun !== true",
    "previewData.previewOnly !== true",
    "previewData.commit !== false",
  ]) {
    assert.equal(uiPreview.includes(token), true, token);
  }
  assert.equal(
      uiPreview.match(/'previewFixedPrivateLessonOutcomeAction'/g)?.length,
      1,
  );
  assert.doesNotMatch(
      uiPreview,
      /addDoc\(|setDoc\(|updateDoc\(|deleteDoc\(|writeBatch\(|runTransaction\(/,
  );
});

test("P12 — Production Preview setup remains a future deployment gate", () => {
  const tokens = [
    "Production Preview Function",
    FULL_PRODUCTION_PREVIEW_RUNTIME_SERVICE_ACCOUNT,
    "currently absent",
    "future deployment gate",
    "custom role `academyBackendReadOnly`",
    "roles/iam.serviceAccountUser",
    "zero user-managed keys",
  ];
  for (const token of tokens) {
    assert.equal(deployRunbookSource.includes(token), true, token);
  }
  assert.equal(
      runtimeIamContractSource.includes(
          "export const READ_ONLY_ROLE_ID = \"academyBackendReadOnly\"",
      ),
      true,
  );
});
