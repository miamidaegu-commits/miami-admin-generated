import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PLANNER_SOURCE_PATH = fs.realpathSync(__filename);
const CRITICAL_RUNTIME_SOURCE_PATHS = Object.freeze([
  "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
  "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
]);
const RESET_PLAN_VERSION = 1;
const EXPECTED_PRODUCTION_PROJECT = "daegu-miami-production";
const EXPECTED_TARGET_ACADEMY = "academy_daegumiami";
const RESET_CLASSIFICATIONS = Object.freeze({
  RESET_ALL_ACADEMY_SCOPED: "RESET_ALL_ACADEMY_SCOPED",
  RESET_WITH_PRESERVE_FILTER: "RESET_WITH_PRESERVE_FILTER",
  ARCHIVE_OR_RETAIN: "ARCHIVE_OR_RETAIN",
  GLOBAL_NEVER_RESET: "GLOBAL_NEVER_RESET",
});
const ACADEMY_SCOPE_STRATEGIES = Object.freeze({
  ACADEMY_ID_FIELD: "academy_id_field",
  ACADEMY_DOCUMENT_ID: "academy_document_id",
  MEMBERSHIP_ACADEMY_ID_FIELD: "membership_academy_id_field",
  GLOBAL_DOCUMENT: "global_document",
});
let ACADEMY_SCOPED_RESET_REGISTRY = null;
let CREDIT_SOURCE_REFERENCE_MAPPINGS = null;
let RESET_REGISTRY_BY_COLLECTION = null;
let RESET_REGISTRY_COUNTS = null;
let assertResetRegistry = null;
let registryModulePromise = null;
const MIN_PAGE_SIZE = 1;
const MAX_PAGE_SIZE = 200;
const DEFAULT_PAGE_SIZE = 100;
const BANNED_FLAGS = new Set(["write", "commit", "delete", "execute"]);
const ALLOWED_FLAGS = new Set([
  "project",
  "academy",
  "release-sha",
  "summary-output",
  "sensitive-output",
  "page-size",
]);
const RESET_CLASS = RESET_CLASSIFICATIONS.RESET_ALL_ACADEMY_SCOPED;
const PRESERVE_CLASS =
  RESET_CLASSIFICATIONS.RESET_WITH_PRESERVE_FILTER;
const RETAIN_CLASS = RESET_CLASSIFICATIONS.ARCHIVE_OR_RETAIN;
const GLOBAL_CLASS = RESET_CLASSIFICATIONS.GLOBAL_NEVER_RESET;
const SCOPE = ACADEMY_SCOPE_STRATEGIES;
const PROHIBITED_TEXT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\bAuthorization\s*:/i,
  /\bBearer\s+[A-Za-z0-9._~-]+/i,
  /\b(?:access|refresh|id)[_-]?token\b/i,
  /\bprivate[_-]?key(?:[_-]?id)?\b/i,
];
const EMAIL_PATTERN =
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

async function loadRuntimeRegistryModule() {
  if (!registryModulePromise) {
    registryModulePromise =
      import("./academy-scoped-test-data-reset-registry.mjs")
          .then((registry) => {
            if (registry.RESET_PLAN_VERSION !== RESET_PLAN_VERSION ||
                registry.EXPECTED_PRODUCTION_PROJECT !==
                  EXPECTED_PRODUCTION_PROJECT ||
                registry.EXPECTED_TARGET_ACADEMY !==
                  EXPECTED_TARGET_ACADEMY ||
                stableStringify(registry.RESET_CLASSIFICATIONS) !==
                  stableStringify(RESET_CLASSIFICATIONS) ||
                stableStringify(registry.ACADEMY_SCOPE_STRATEGIES) !==
                  stableStringify(ACADEMY_SCOPE_STRATEGIES)) {
              throw new PlannerConfigError(
                  "critical_runtime_registry_contract_mismatch",
              );
            }
            ACADEMY_SCOPED_RESET_REGISTRY =
              registry.ACADEMY_SCOPED_RESET_REGISTRY;
            CREDIT_SOURCE_REFERENCE_MAPPINGS =
              registry.CREDIT_SOURCE_REFERENCE_MAPPINGS;
            RESET_REGISTRY_BY_COLLECTION =
              registry.RESET_REGISTRY_BY_COLLECTION;
            RESET_REGISTRY_COUNTS = registry.RESET_REGISTRY_COUNTS;
            assertResetRegistry = registry.assertResetRegistry;
            return registry;
          });
  }
  return registryModulePromise;
}

export class PlannerConfigError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlannerConfigError";
  }
}

export class PlannerIncompleteError extends Error {
  constructor(message) {
    super(message);
    this.name = "PlannerIncompleteError";
  }
}

function resolvePlannerFilesystemRepositoryRoot(
    plannerSourcePath = PLANNER_SOURCE_PATH,
) {
  const realPlannerPath = fs.realpathSync(plannerSourcePath);
  let candidate = path.dirname(realPlannerPath);
  while (true) {
    const gitMarker = path.join(candidate, ".git");
    if (fs.existsSync(gitMarker)) {
      const markerStat = fs.lstatSync(gitMarker);
      if (!markerStat.isDirectory() && !markerStat.isFile()) {
        throw new PlannerConfigError(
            "Planner repository .git marker must be a file or directory.",
        );
      }
      const repositoryRoot = fs.realpathSync(candidate);
      if (!pathInside(repositoryRoot, realPlannerPath)) {
        throw new PlannerConfigError(
            "Planner source path is outside its filesystem repository root.",
        );
      }
      return {
        repositoryRoot,
        plannerSourcePath: realPlannerPath,
        plannerRelativePath: path.relative(repositoryRoot, realPlannerPath),
      };
    }
    const parent = path.dirname(candidate);
    if (parent === candidate) {
      throw new PlannerConfigError(
          "Planner filesystem repository root is unavailable.",
      );
    }
    candidate = parent;
  }
}

function sanitizedGitEnvironment(environment = process.env) {
  const allowedNames = [
    "PATH",
    "TMPDIR",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
  ];
  return Object.fromEntries(
      allowedNames
          .filter((name) => typeof environment[name] === "string")
          .map((name) => [name, environment[name]]),
  );
}

function runGitIdentityCommand(
    execFile,
    repositoryRoot,
    args,
    environment,
) {
  return String(execFile("git", args, {
    cwd: repositoryRoot,
    env: sanitizedGitEnvironment(environment),
    encoding: "utf8",
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  })).trim();
}

function runGitIdentityBufferCommand(
    execFile,
    repositoryRoot,
    args,
    environment,
) {
  const output = execFile("git", args, {
    cwd: repositoryRoot,
    env: sanitizedGitEnvironment(environment),
    encoding: null,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return Buffer.isBuffer(output) ? output : Buffer.from(output);
}

function criticalSourceError(code, relativePath) {
  return new PlannerConfigError(`${code}:${relativePath}`);
}

function resolveCriticalRuntimeFile(repositoryRoot, relativePath) {
  if (path.isAbsolute(relativePath) ||
      path.posix.normalize(relativePath) !== relativePath ||
      relativePath.split("/").includes("..")) {
    throw criticalSourceError(
        "critical_runtime_source_invalid_path",
        relativePath,
    );
  }
  const absolutePath = path.resolve(
      repositoryRoot,
      ...relativePath.split("/"),
  );
  if (!pathInside(repositoryRoot, absolutePath)) {
    throw criticalSourceError(
        "critical_runtime_source_outside_repository",
        relativePath,
    );
  }
  let sourceStat;
  try {
    sourceStat = fs.lstatSync(absolutePath);
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_missing",
        relativePath,
    );
  }
  if (sourceStat.isSymbolicLink() || !sourceStat.isFile()) {
    throw criticalSourceError(
        "critical_runtime_source_not_regular_file",
        relativePath,
    );
  }
  const realPath = fs.realpathSync(absolutePath);
  const canonicalRelativePath = path.relative(repositoryRoot, realPath)
      .split(path.sep)
      .join("/");
  if (!pathInside(repositoryRoot, realPath) ||
      canonicalRelativePath !== relativePath) {
    throw criticalSourceError(
        "critical_runtime_source_path_mismatch",
        relativePath,
    );
  }
  return realPath;
}

function resolveCriticalRuntimeSourceIdentity({
  execFile,
  repositoryRoot,
  relativePath,
  environment,
}) {
  const runtimeAbsolutePath = resolveCriticalRuntimeFile(
      repositoryRoot,
      relativePath,
  );
  let trackedPath;
  try {
    trackedPath = runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["ls-files", "--error-unmatch", "--", relativePath],
        environment,
    );
    runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["cat-file", "-e", `HEAD:${relativePath}`],
        environment,
    );
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_not_tracked",
        relativePath,
    );
  }
  if (trackedPath !== relativePath) {
    throw criticalSourceError(
        "critical_runtime_source_path_mismatch",
        relativePath,
    );
  }

  let treeEntry;
  try {
    treeEntry = runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["ls-tree", "HEAD", "--", relativePath],
        environment,
    );
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_not_tracked",
        relativePath,
    );
  }
  const treeMatch =
    /^([0-7]{6}) (blob|commit) ([0-9a-f]{40,64})\t(.+)$/.exec(treeEntry);
  if (!treeMatch || treeMatch[4] !== relativePath ||
      !["100644", "100755"].includes(treeMatch[1]) ||
      treeMatch[2] !== "blob") {
    throw criticalSourceError(
        "critical_runtime_source_not_regular_blob",
        relativePath,
    );
  }
  const headBlobOid = treeMatch[3];
  let headBytes;
  try {
    headBytes = runGitIdentityBufferCommand(
        execFile,
        repositoryRoot,
        ["cat-file", "blob", `HEAD:${relativePath}`],
        environment,
    );
  } catch {
    throw criticalSourceError(
        "critical_runtime_source_blob_unavailable",
        relativePath,
    );
  }
  const runtimeBytes = fs.readFileSync(runtimeAbsolutePath);
  const headBlobSha256 = crypto.createHash("sha256")
      .update(headBytes)
      .digest("hex");
  const runtimeSha256 = crypto.createHash("sha256")
      .update(runtimeBytes)
      .digest("hex");
  const bytesMatch = runtimeBytes.equals(headBytes);
  if (!bytesMatch) {
    throw criticalSourceError(
        "critical_runtime_source_bytes_mismatch",
        relativePath,
    );
  }

  const indexStatus = runGitIdentityCommand(
      execFile,
      repositoryRoot,
      ["ls-files", "-v", "--", relativePath],
      environment,
  );
  if (indexStatus !== `H ${relativePath}`) {
    throw criticalSourceError(
        "critical_runtime_source_index_flags",
        relativePath,
    );
  }
  return Object.freeze({
    relativePath,
    headBlobOid,
    headBlobSha256,
    runtimeSha256,
    bytesMatch: true,
    tracked: true,
    indexFlagsClean: true,
  });
}

function resolvePlannerRuntimeSourceIdentity({
  execFile = execFileSync,
  environment = process.env,
} = {}) {
  try {
    const filesystemIdentity = resolvePlannerFilesystemRepositoryRoot();
    const repositoryRoot = filesystemIdentity.repositoryRoot;
    if (filesystemIdentity.plannerRelativePath !==
        CRITICAL_RUNTIME_SOURCE_PATHS[0]) {
      throw new PlannerConfigError(
          "planner_runtime_source_path_mismatch",
      );
    }
    const discoveredRoot = runGitIdentityCommand(
        execFile,
        repositoryRoot,
        ["rev-parse", "--show-toplevel"],
        environment,
    );
    const expectedRoot = fs.realpathSync(repositoryRoot);
    const actualRoot = fs.realpathSync(discoveredRoot);
    if (actualRoot !== expectedRoot) {
      throw new PlannerConfigError(
          "Planner runtime repository root does not match its source root.",
      );
    }
    const runtimeHeadSha = runGitIdentityCommand(
        execFile,
        actualRoot,
        ["rev-parse", "HEAD"],
        environment,
    );
    const runtimeTreeSha = runGitIdentityCommand(
        execFile,
        actualRoot,
        ["rev-parse", "HEAD^{tree}"],
        environment,
    );
    const status = runGitIdentityCommand(
        execFile,
        actualRoot,
        ["status", "--porcelain=v1", "--untracked-files=all"],
        environment,
    );
    if (status !== "") {
      throw new PlannerConfigError(
          "Planner runtime Git worktree must be clean.",
      );
    }
    const criticalRuntimeSources = CRITICAL_RUNTIME_SOURCE_PATHS
        .map((relativePath) => resolveCriticalRuntimeSourceIdentity({
          execFile,
          repositoryRoot: actualRoot,
          relativePath,
          environment,
        }))
        .sort((left, right) =>
          left.relativePath.localeCompare(right.relativePath),
        );
    return {
      repositoryRoot: actualRoot,
      runtimeHeadSha,
      runtimeTreeSha,
      clean: status === "",
      criticalRuntimeSources,
    };
  } catch (error) {
    if (error instanceof PlannerConfigError) throw error;
    throw new PlannerConfigError(
        "Planner runtime Git source identity is unavailable.",
    );
  }
}

function validatePlannerRuntimeSourceIdentity({
  identity,
  releaseSha,
}) {
  if (!identity || typeof identity !== "object") {
    throw new PlannerConfigError(
        "Planner runtime Git source identity is required.",
    );
  }
  const expectedRoot = resolvePlannerFilesystemRepositoryRoot()
      .repositoryRoot;
  let actualRoot = "";
  try {
    actualRoot = fs.realpathSync(identity.repositoryRoot);
  } catch {
    throw new PlannerConfigError(
        "Planner runtime repository root is unavailable.",
    );
  }
  if (actualRoot !== expectedRoot) {
    throw new PlannerConfigError(
        "Planner runtime repository root does not match its source root.",
    );
  }
  if (!/^[0-9a-f]{40}$/.test(identity.runtimeHeadSha || "") ||
      !/^[0-9a-f]{40}$/.test(identity.runtimeTreeSha || "")) {
    throw new PlannerConfigError(
        "Planner runtime Git HEAD and tree SHA are required.",
    );
  }
  if (identity.clean !== true) {
    throw new PlannerConfigError(
        "Planner runtime Git worktree must be clean.",
    );
  }
  const criticalRuntimeSources = identity.criticalRuntimeSources;
  if (!Array.isArray(criticalRuntimeSources) ||
      criticalRuntimeSources.length !==
        CRITICAL_RUNTIME_SOURCE_PATHS.length) {
    throw new PlannerConfigError(
        "Planner critical runtime source identity is required.",
    );
  }
  const normalizedCriticalSources = [...criticalRuntimeSources]
      .sort((left, right) =>
        String(left?.relativePath || "").localeCompare(
            String(right?.relativePath || ""),
        ),
      )
      .map((source, index) => {
        const expectedPath = [...CRITICAL_RUNTIME_SOURCE_PATHS]
            .sort()[index];
        if (!source || source.relativePath !== expectedPath ||
            !/^[0-9a-f]{40,64}$/.test(source.headBlobOid || "") ||
            !/^[0-9a-f]{64}$/.test(source.headBlobSha256 || "") ||
            !/^[0-9a-f]{64}$/.test(source.runtimeSha256 || "") ||
            source.headBlobSha256 !== source.runtimeSha256 ||
            source.bytesMatch !== true ||
            source.tracked !== true ||
            source.indexFlagsClean !== true) {
          throw new PlannerConfigError(
              "Planner critical runtime source identity is invalid.",
          );
        }
        return Object.freeze({
          relativePath: source.relativePath,
          headBlobOid: source.headBlobOid,
          headBlobSha256: source.headBlobSha256,
          runtimeSha256: source.runtimeSha256,
          bytesMatch: true,
          tracked: true,
          indexFlagsClean: true,
        });
      });
  if (releaseSha !== identity.runtimeHeadSha) {
    throw new PlannerConfigError(
        "--release-sha does not match the executing Git HEAD.",
    );
  }
  return Object.freeze({
    repositoryRoot: actualRoot,
    runtimeHeadSha: identity.runtimeHeadSha,
    runtimeTreeSha: identity.runtimeTreeSha,
    clean: true,
    criticalRuntimeSources: Object.freeze(normalizedCriticalSources),
  });
}

export function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`,
    ).join(",")}}`;
  }
  return JSON.stringify(value);
}

function digest(value) {
  return crypto.createHash("sha256")
      .update(typeof value === "string" ? value : stableStringify(value))
      .digest("hex");
}

function normalizeText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function canonicalizeFirestoreValue(value) {
  if (value == null || typeof value === "boolean" ||
      typeof value === "number" || typeof value === "string") {
    return value;
  }
  if (value instanceof Date) {
    return {$date: value.toISOString()};
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {$bytes: Buffer.from(value).toString("base64")};
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeFirestoreValue(item));
  }
  if (typeof value.toMillis === "function") {
    return {$timestampMillis: value.toMillis()};
  }
  if (typeof value.path === "string" &&
      typeof value.id === "string") {
    return {$documentReference: value.path};
  }
  if (typeof value.latitude === "number" &&
      typeof value.longitude === "number") {
    return {
      $geoPoint: [value.latitude, value.longitude],
    };
  }
  if (typeof value === "object") {
    return Object.fromEntries(
        Object.keys(value).sort().map((key) => [
          key,
          canonicalizeFirestoreValue(value[key]),
        ]),
    );
  }
  return String(value);
}

export function typedDocumentKey(collectionName, documentId) {
  return `${collectionName}:${documentId}`;
}

function rawValuesAtPath(value, dottedPath) {
  const parts = dottedPath.split(".");
  let current = [value];
  for (const part of parts) {
    const next = [];
    for (const item of current) {
      if (Array.isArray(item)) {
        for (const nested of item) {
          if (nested && typeof nested === "object" &&
              Object.prototype.hasOwnProperty.call(nested, part)) {
            next.push(nested[part]);
          }
        }
      } else if (item && typeof item === "object" &&
          Object.prototype.hasOwnProperty.call(item, part)) {
        next.push(item[part]);
      }
    }
    current = next;
  }
  return current;
}

function parseReferenceFieldValues({
  data,
  field,
  valueType,
  targetCollections,
}) {
  const values = [];
  const issues = [];
  for (const rawValue of rawValuesAtPath(data, field)) {
    const candidates = valueType === "array" ?
      (Array.isArray(rawValue) ? rawValue : null) :
      (Array.isArray(rawValue) ? rawValue : [rawValue]);
    if (!candidates) {
      issues.push({
        code: "malformed_reference_field",
        field,
        targetCollections,
        policyReason: "Reference field must be an array of document IDs.",
      });
      continue;
    }
    for (const candidate of candidates) {
      if (typeof candidate !== "string" || !candidate.trim()) {
        issues.push({
          code: "malformed_reference_element",
          field,
          targetCollections,
          policyReason:
            "Reference values must be non-empty string document IDs.",
        });
        continue;
      }
      values.push(candidate.trim());
    }
  }
  return {values: [...new Set(values)], issues};
}

function buildExtractedReference({
  family,
  field,
  documentId,
  targetCollections,
  aliasEvidence,
  resolvedValue,
  conflict,
}) {
  return {
    family,
    field,
    documentId,
    invalidIdentifier: documentId.includes("/"),
    candidateTypedKeys: targetCollections.map((targetCollection) =>
      typedDocumentKey(targetCollection, documentId),
    ),
    ...(aliasEvidence ? {aliasEvidence} : {}),
    ...(resolvedValue !== undefined ? {resolvedValue} : {}),
    ...(conflict !== undefined ? {conflict} : {}),
  };
}

function extractCreditSourceReferences(data) {
  const references = [];
  const issues = [];
  const sourceIdResult = parseReferenceFieldValues({
    data,
    field: "sourceId",
    valueType: "string_or_array",
    targetCollections: [],
  });
  const sourceTypeResult = parseReferenceFieldValues({
    data,
    field: "sourceType",
    valueType: "string_or_array",
    targetCollections: [],
  });
  issues.push(...sourceIdResult.issues, ...sourceTypeResult.issues);
  const sourceIds = sourceIdResult.values;
  const sourceTypes = sourceTypeResult.values;
  if (sourceIds.length > 1 || sourceTypes.length > 1) {
    issues.push({
      code: "ambiguous_credit_source",
      field: "sourceId/sourceType",
      targetCollections: [],
      policyReason: "Credit sourceId and sourceType must be singular.",
    });
    return {references, issues};
  }
  const sourceId = sourceIds[0] || "";
  const sourceType = sourceTypes[0] || "";
  if (sourceId && !sourceType) {
    issues.push({
      code: "missing_credit_source_type",
      field: "sourceType",
      targetCollections: [],
      policyReason: "Credit sourceId requires an exact sourceType.",
    });
    return {references, issues};
  }
  if (sourceType && !sourceId) {
    issues.push({
      code: "missing_credit_source_id",
      field: "sourceId",
      targetCollections: [],
      policyReason: "Credit sourceType requires a sourceId.",
    });
    return {references, issues};
  }
  if (!sourceId && !sourceType) return {references, issues};
  const mapping = CREDIT_SOURCE_REFERENCE_MAPPINGS[sourceType];
  if (!mapping) {
    issues.push({
      code: "unknown_credit_source_type",
      field: "sourceType",
      targetCollections: [],
      policyReason: "Credit sourceType is not in the exact mapping allowlist.",
    });
    return {references, issues};
  }
  references.push(buildExtractedReference({
    family: "credit_source",
    field: "sourceId",
    documentId: sourceId,
    targetCollections: [mapping.targetCollection],
  }));
  const explicitIds = [];
  for (const field of mapping.explicitIdFields) {
    const result = parseReferenceFieldValues({
      data,
      field,
      valueType: "string_or_array",
      targetCollections: [mapping.targetCollection],
    });
    issues.push(...result.issues);
    explicitIds.push(...result.values.map((value) => ({field, value})));
  }
  explicitIds.forEach(({field, value}) => {
    references.push(buildExtractedReference({
      family: "credit_source_explicit",
      field,
      documentId: value,
      targetCollections: [mapping.targetCollection],
    }));
  });
  const conflicting = explicitIds.filter(({value}) => value !== sourceId);
  if (conflicting.length > 0) {
    issues.push({
      code: "conflicting_credit_source_reference",
      field: conflicting.map(({field}) => field).join(","),
      targetCollections: [mapping.targetCollection],
      candidateTypedKeys: [
        typedDocumentKey(mapping.targetCollection, sourceId),
        ...conflicting.map(({value}) =>
          typedDocumentKey(mapping.targetCollection, value),
        ),
      ],
      policyReason:
        "Credit sourceId conflicts with its explicit typed target field.",
    });
  }
  const explicitTargetGroups = [
    {
      family: "credit_explicit_lesson",
      fields: ["lessonId", "fixedLessonId", "linkedLessonId"],
      targetCollection: sourceType === "groupLesson" ?
        "groupLessons" :
        "lessons",
    },
    {
      family: "credit_explicit_reservation",
      fields: [
        "reservationId",
        "privateLessonReservationId",
        "linkedReservationId",
      ],
      targetCollection: "privateLessonReservations",
    },
  ];
  for (const group of explicitTargetGroups) {
    for (const field of group.fields) {
      const result = parseReferenceFieldValues({
        data,
        field,
        valueType: "string_or_array",
        targetCollections: [group.targetCollection],
      });
      issues.push(...result.issues);
      result.values.forEach((value) => {
        references.push(buildExtractedReference({
          family: group.family,
          field,
          documentId: value,
          targetCollections: [group.targetCollection],
        }));
      });
    }
  }
  return {references, issues};
}

function extractReferences(registryEntry, data) {
  const references = [];
  const issues = [];
  for (const extractor of registryEntry.referenceExtractors) {
    const valuesByField = new Map();
    for (const field of extractor.fields) {
      const parsed = parseReferenceFieldValues({
        data,
        field,
        valueType: extractor.valueType,
        targetCollections: extractor.targetCollections,
      });
      issues.push(...parsed.issues);
      valuesByField.set(field, parsed.values);
      if (extractor.aliasPolicy !== "strict_scalar_alias") {
        for (const documentId of parsed.values) {
          references.push(buildExtractedReference({
            family: extractor.family,
            field,
            documentId,
            targetCollections: extractor.targetCollections,
          }));
        }
      }
    }
    if (extractor.aliasPolicy === "strict_scalar_alias") {
      const aliasEvidence = [...valuesByField.entries()].flatMap(
          ([field, values]) => values.map((value) => ({field, value})),
      );
      const distinctValues = new Set(
          aliasEvidence.map(({value}) => value),
      );
      const conflict = distinctValues.size > 1 ||
        [...valuesByField.values()].some((values) => values.length > 1);
      if (conflict) {
        issues.push({
          code: "ambiguous_reference_alias",
          field: extractor.fields.join(","),
          targetCollections: extractor.targetCollections,
          candidateTypedKeys: [...distinctValues].flatMap((documentId) =>
            extractor.targetCollections.map((targetCollection) =>
              typedDocumentKey(targetCollection, documentId),
            ),
          ),
          aliasEvidence,
          resolvedValue: null,
          conflict: true,
          policyReason:
            "Reference aliases contain conflicting document IDs.",
        });
      } else if (distinctValues.size === 1) {
        const [resolvedValue] = distinctValues;
        references.push(buildExtractedReference({
          family: extractor.family,
          field: [...valuesByField.entries()]
              .filter(([, values]) => values.length > 0)
              .map(([field]) => field)
              .join(","),
          documentId: resolvedValue,
          targetCollections: extractor.targetCollections,
          aliasEvidence,
          resolvedValue,
          conflict: false,
        }));
      }
    }
    if (extractor.aliasPolicy === "same_single_value") {
      const distinctValues = new Set(
          [...valuesByField.values()].flat(),
      );
      if (distinctValues.size > 1 ||
          [...valuesByField.values()].some((values) => values.length > 1)) {
        issues.push({
          code: "ambiguous_reference_alias",
          field: extractor.fields.join(","),
          targetCollections: extractor.targetCollections,
          candidateTypedKeys: [...distinctValues].flatMap((documentId) =>
            extractor.targetCollections.map((targetCollection) =>
              typedDocumentKey(targetCollection, documentId),
            ),
          ),
          policyReason:
            "Reference aliases contain conflicting document IDs.",
        });
      }
    }
  }
  if (registryEntry.collectionName === "creditTransactions") {
    const creditSource = extractCreditSourceReferences(data);
    references.push(...creditSource.references);
    issues.push(...creditSource.issues);
  }
  const unique = new Map();
  references.forEach((item) => {
    const key = stableStringify(item);
    if (!unique.has(key)) unique.set(key, item);
  });
  const uniqueIssues = new Map();
  issues.forEach((item) => {
    const key = stableStringify(item);
    if (!uniqueIssues.has(key)) uniqueIssues.set(key, item);
  });
  return {
    references: [...unique.values()].sort((a, b) =>
      stableStringify(a).localeCompare(stableStringify(b)),
    ),
    issues: [...uniqueIssues.values()].sort((a, b) =>
      stableStringify(a).localeCompare(stableStringify(b)),
    ),
  };
}

function classifyKnownDocument({
  registryEntry,
  documentId,
  data,
  academy,
}) {
  const strategy = registryEntry.academyScopeStrategy;
  let scope = "global";
  let scopeAcademyId = null;
  let malformedScope = false;
  if (strategy === SCOPE.ACADEMY_DOCUMENT_ID) {
    scope = documentId === academy ? "target_academy" : "other_academy";
    scopeAcademyId = documentId;
  } else if (strategy === SCOPE.GLOBAL_DOCUMENT) {
    scope = "global";
  } else {
    const persistedAcademyId = normalizeText(data.academyId);
    if (!persistedAcademyId) {
      scope = "malformed";
      malformedScope = true;
    } else {
      scopeAcademyId = persistedAcademyId;
      scope = persistedAcademyId === academy ?
        "target_academy" :
        "other_academy";
    }
  }

  let disposition = "preserve";
  if (malformedScope) {
    disposition = "unknown";
  } else if (scope === "target_academy" &&
      registryEntry.classification === RESET_CLASS) {
    disposition = "reset";
  } else if (registryEntry.classification === RETAIN_CLASS) {
    disposition = "retain";
  } else if (registryEntry.classification === GLOBAL_CLASS) {
    disposition = "global_preserve";
  } else if (scope === "other_academy") {
    disposition = "other_academy_preserve";
  } else if (registryEntry.classification === PRESERVE_CLASS) {
    disposition = "preserve";
  }

  return {
    scope,
    scopeAcademyId,
    malformedScope,
    disposition,
    scopeEvidence: {
      strategy,
      result: scope,
      exactAcademyMatch: scope === "target_academy",
    },
  };
}

function documentRecord({
  collectionName,
  documentId,
  data,
  registryEntry,
  academy,
}) {
  const scope = classifyKnownDocument({
    registryEntry,
    documentId,
    data,
    academy,
  });
  const extractedReferences = extractReferences(registryEntry, data);
  return {
    collection: collectionName,
    documentId,
    rawDocumentPath: `${collectionName}/${documentId}`,
    typedDocumentKey: typedDocumentKey(collectionName, documentId),
    classification: registryEntry.classification,
    disposition: scope.disposition,
    deletionOrderGroup:
      scope.disposition === "reset" ?
        registryEntry.expectedDeletionOrderGroup :
        0,
    scope: scope.scope,
    scopeAcademyId: scope.scopeAcademyId,
    academyScopeEvidence: scope.scopeEvidence,
    documentDigest: digest(canonicalizeFirestoreValue(data)),
    references: extractedReferences.references,
    referenceIssues: extractedReferences.issues,
    warnings: scope.malformedScope ? ["academy_scope_unresolved"] : [],
  };
}

function unknownDocumentRecord({
  collectionName,
  documentId,
  data,
  academy,
}) {
  const persistedAcademyId = normalizeText(data.academyId);
  const scope = !persistedAcademyId ?
    "unknown_global_or_malformed" :
    persistedAcademyId === academy ?
      "unknown_target_academy" :
      "unknown_other_academy";
  return {
    collection: collectionName,
    documentId,
    rawDocumentPath: `${collectionName}/${documentId}`,
    typedDocumentKey: typedDocumentKey(collectionName, documentId),
    classification: "UNKNOWN_BLOCKER",
    disposition: "unknown",
    deletionOrderGroup: 0,
    scope,
    scopeAcademyId: persistedAcademyId || null,
    academyScopeEvidence: {
      strategy: "unregistered_collection",
      result: scope,
      exactAcademyMatch: persistedAcademyId === academy,
    },
    documentDigest: digest(canonicalizeFirestoreValue(data)),
    references: [],
    referenceIssues: [],
    warnings: ["unknown_runtime_collection"],
  };
}

async function scanCollectionPages({
  db,
  collectionName,
  pageSize,
  buildRecord,
}) {
  const records = [];
  const cursors = new Set();
  let cursor = "";
  let pageCount = 0;
  while (true) {
    let query = db.collection(collectionName)
        .orderBy("__name__")
        .limit(pageSize);
    if (cursor) query = query.startAfter(cursor);
    const snapshot = await query.get();
    pageCount += 1;
    if (snapshot.size > pageSize) {
      throw new PlannerIncompleteError(
          `Page bound exceeded for ${collectionName}.`,
      );
    }
    for (const document of snapshot.docs) {
      records.push(buildRecord({
        documentId: document.id,
        data: document.data() || {},
      }));
    }
    if (snapshot.size < pageSize) break;
    const nextCursor = snapshot.docs[snapshot.docs.length - 1]?.id || "";
    if (!nextCursor || nextCursor === cursor || cursors.has(nextCursor)) {
      throw new PlannerIncompleteError(
          `Cursor loop detected for ${collectionName}.`,
      );
    }
    cursors.add(nextCursor);
    cursor = nextCursor;
  }
  return {records, pageCount, complete: true, truncated: false, omitted: 0};
}

function emptyCollectionCounts() {
  return {
    scanned: 0,
    reset: 0,
    preserved: 0,
    retained: 0,
    unknown: 0,
  };
}

function summarizeCollectionRecords(records) {
  const counts = emptyCollectionCounts();
  for (const record of records) {
    counts.scanned += 1;
    if (record.disposition === "reset") counts.reset += 1;
    else if (record.disposition === "retain") counts.retained += 1;
    else if (record.disposition === "unknown") counts.unknown += 1;
    else counts.preserved += 1;
  }
  return counts;
}

function isPreservedDisposition(disposition) {
  return [
    "preserve",
    "retain",
    "global_preserve",
    "other_academy_preserve",
  ].includes(disposition);
}

function referenceTargetClassifications(reference) {
  return [...new Set(reference.candidateTypedKeys.map((key) => {
    const separator = key.indexOf(":");
    const collectionName = separator === -1 ? "" : key.slice(0, separator);
    return RESET_REGISTRY_BY_COLLECTION[collectionName]?.classification ||
      "UNKNOWN_COLLECTION";
  }))].sort();
}

function buildReferenceFinding({
  code,
  severity,
  source,
  reference,
  policyReason,
  targetTypedKeys = reference.candidateTypedKeys,
}) {
  const finding = {
    code,
    severity,
    sourceTypedKey: source.typedDocumentKey,
    targetTypedKeys: [...new Set(targetTypedKeys)].sort(),
    sourceClassification: source.classification,
    targetCollectionClassification:
      referenceTargetClassifications(reference),
    field: reference.field,
    policyReason,
    ...(reference.aliasEvidence ?
      {aliasEvidence: reference.aliasEvidence} :
      {}),
    ...(reference.resolvedValue !== undefined ?
      {resolvedValue: reference.resolvedValue} :
      {}),
    ...(reference.conflict !== undefined ?
      {conflict: reference.conflict} :
      {}),
  };
  return {
    ...finding,
    findingDigest: digest(finding),
  };
}

export function classifyReferenceFinding({
  source,
  reference,
  targets,
  academy,
}) {
  if (source.disposition === "unknown") {
    return buildReferenceFinding({
      code: "unknown_reference_source_scope",
      severity: "blocking",
      source,
      reference,
      policyReason: "Reference source academy scope is unresolved.",
    });
  }
  if (reference.invalidIdentifier) {
    return buildReferenceFinding({
      code: "invalid_reference_identifier",
      severity: "blocking",
      source,
      reference,
      policyReason: "Document IDs cannot contain a slash.",
    });
  }
  const targetClassifications = referenceTargetClassifications(reference);
  if (targetClassifications.includes("UNKNOWN_COLLECTION")) {
    return buildReferenceFinding({
      code: "unknown_reference_target_collection",
      severity: "blocking",
      source,
      reference,
      policyReason: "Reference target collection is outside the registry.",
    });
  }
  if (targets.length === 0) {
    const resetInternal =
      source.disposition === "reset" &&
      source.scopeAcademyId === academy &&
      targetClassifications.length > 0 &&
      targetClassifications.every((classification) =>
        classification === RESET_CLASS,
      );
    return buildReferenceFinding({
      code: resetInternal ?
        "missing_reset_internal_reference" :
        "missing_reference",
      severity: resetInternal ? "diagnostic_only" : "blocking",
      source,
      reference,
      policyReason: resetInternal ?
        "Missing target is confined to the target academy reset domain." :
        "Missing target scope or preservation impact cannot be proven safe.",
    });
  }
  if (targets.length > 1) {
    return buildReferenceFinding({
      code: "ambiguous_reference",
      severity: "blocking",
      source,
      reference,
      policyReason: "Multiple typed target documents exist.",
    });
  }
  const target = targets[0];
  if (target.disposition === "unknown") {
    return buildReferenceFinding({
      code: "unknown_reference_target_scope",
      severity: "blocking",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason: "Reference target academy scope is unresolved.",
    });
  }
  const sourceIsTarget = source.scopeAcademyId === academy;
  const targetIsTarget = target.scopeAcademyId === academy;
  if (source.scopeAcademyId &&
      target.scopeAcademyId &&
      sourceIsTarget !== targetIsTarget) {
    return buildReferenceFinding({
      code: "cross_academy_reference",
      severity: "blocking",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason: "Reference crosses the target academy boundary.",
    });
  }
  if (isPreservedDisposition(source.disposition) &&
      target.disposition === "reset") {
    return buildReferenceFinding({
      code: "preserved_document_references_reset_candidate",
      severity: "blocking",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason:
        "Preserved, retained, or global source would keep a stale pointer.",
    });
  }
  if (source.disposition === "reset" &&
      isPreservedDisposition(target.disposition)) {
    return buildReferenceFinding({
      code: "reset_candidate_references_preserved_document",
      severity: "warning",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason:
        "Deleting the source does not require updating the preserved target.",
    });
  }
  if (source.disposition === "reset" &&
      target.disposition === "reset" &&
      source.scopeAcademyId === academy &&
      target.scopeAcademyId === academy) {
    return buildReferenceFinding({
      code: "reset_internal_reference",
      severity: "warning",
      source,
      reference,
      targetTypedKeys: [target.typedDocumentKey],
      policyReason:
        "Both documents are target-academy reset candidates.",
    });
  }
  return null;
}

function referenceEvidence(records, academy) {
  const byTypedKey = new Map(
      records.map((record) => [record.typedDocumentKey, record]),
  );
  const findings = {
    diagnostics: [],
    warnings: [],
    blockers: [],
  };
  const addFinding = (finding) => {
    if (!finding) return;
    if (finding.severity === "diagnostic_only") {
      findings.diagnostics.push(finding);
    } else if (finding.severity === "warning") {
      findings.warnings.push(finding);
    } else {
      findings.blockers.push(finding);
    }
  };
  for (const source of records) {
    for (const issue of source.referenceIssues) {
      const reference = {
        field: issue.field,
        candidateTypedKeys: issue.candidateTypedKeys ||
          issue.targetCollections.map((collectionName) =>
            typedDocumentKey(collectionName, "<malformed>"),
          ),
        aliasEvidence: issue.aliasEvidence,
        resolvedValue: issue.resolvedValue,
        conflict: issue.conflict,
      };
      addFinding(buildReferenceFinding({
        code: issue.code,
        severity: "blocking",
        source,
        reference,
        policyReason: issue.policyReason,
      }));
    }
    for (const reference of source.references) {
      const targets = reference.candidateTypedKeys
          .map((key) => byTypedKey.get(key))
          .filter(Boolean);
      addFinding(classifyReferenceFinding({
        source,
        reference,
        targets,
        academy,
      }));
    }
    if (source.collection === "creditTransactions") {
      const sourceReference = source.references.find((reference) =>
        reference.family === "credit_source" &&
        reference.candidateTypedKeys.some((key) =>
          key.startsWith("privateLessonReservations:"),
        ),
      );
      const explicitLessonReferences = source.references.filter(
          ({family}) => family === "credit_explicit_lesson",
      );
      const reservation = sourceReference ?
        sourceReference.candidateTypedKeys
            .map((key) => byTypedKey.get(key))
            .find(Boolean) :
        null;
      const reservationLessonKeys = new Set(
          (reservation?.references || [])
              .filter(({family}) => family === "lesson")
              .flatMap(({candidateTypedKeys}) => candidateTypedKeys),
      );
      for (const explicitReference of explicitLessonReferences) {
        if (reservationLessonKeys.size > 0 &&
            !explicitReference.candidateTypedKeys.some((key) =>
              reservationLessonKeys.has(key),
            )) {
          addFinding(buildReferenceFinding({
            code: "conflicting_credit_occurrence_reference",
            severity: "blocking",
            source,
            reference: explicitReference,
            policyReason:
              "Credit explicit lesson conflicts with its source reservation.",
          }));
        }
      }
    }
  }
  return Object.fromEntries(
      Object.entries(findings).map(([category, categoryFindings]) => {
        const unique = new Map();
        categoryFindings.forEach((finding) => {
          if (!unique.has(finding.findingDigest)) {
            unique.set(finding.findingDigest, finding);
          }
        });
        return [
          category,
          [...unique.values()].sort((a, b) =>
            a.findingDigest.localeCompare(b.findingDigest),
          ),
        ];
      }),
  );
}

function runCollectionSummary(records, pageCount) {
  const counts = summarizeCollectionRecords(records);
  return {
    ...counts,
    pageCount,
    complete: true,
    truncated: false,
    omitted: 0,
    digest: digest(records.map((record) => ({
      typedDocumentKey: record.typedDocumentKey,
      documentDigest: record.documentDigest,
      disposition: record.disposition,
      references: record.references,
      referenceIssues: record.referenceIssues,
      warnings: record.warnings,
    }))),
  };
}

export async function scanPlannerInventoryOnce({
  db,
  academy,
  pageSize,
}) {
  await loadRuntimeRegistryModule();
  assertResetRegistry();
  const rootCollections = await db.listCollections();
  const runtimeCollections = rootCollections.map(({id}) => id).sort();
  const knownNames = new Set(
      ACADEMY_SCOPED_RESET_REGISTRY.map(({collectionName}) =>
        collectionName,
      ),
  );
  const unknownRuntimeCollections = runtimeCollections.filter(
      (name) => !knownNames.has(name),
  );
  const records = [];
  const collectionSummaries = {};

  for (const registryEntry of ACADEMY_SCOPED_RESET_REGISTRY) {
    const collectionName = registryEntry.collectionName;
    const result = await scanCollectionPages({
      db,
      collectionName,
      pageSize,
      buildRecord: ({documentId, data}) => documentRecord({
        collectionName,
        documentId,
        data,
        registryEntry,
        academy,
      }),
    });
    records.push(...result.records);
    collectionSummaries[collectionName] = runCollectionSummary(
        result.records,
        result.pageCount,
    );
  }

  const unknownCollectionSummaries = {};
  for (const collectionName of unknownRuntimeCollections) {
    const result = await scanCollectionPages({
      db,
      collectionName,
      pageSize,
      buildRecord: ({documentId, data}) => unknownDocumentRecord({
        collectionName,
        documentId,
        data,
        academy,
      }),
    });
    records.push(...result.records);
    unknownCollectionSummaries[collectionName] = runCollectionSummary(
        result.records,
        result.pageCount,
    );
  }

  records.sort((a, b) =>
    a.typedDocumentKey.localeCompare(b.typedDocumentKey),
  );
  const referenceFindings = referenceEvidence(records, academy);
  const malformedScopeBlockers = records
      .filter((record) => record.disposition === "unknown")
      .map((record) => ({
        code: record.warnings[0] || "unknown_document",
        severity: "blocking",
        sourceTypedKey: record.typedDocumentKey,
        policyReason: "Document academy scope is unresolved.",
      }));
  const unknownCollectionBlockers = unknownRuntimeCollections.map(
      (collectionName) => ({
        code: "unknown_runtime_collection",
        severity: "blocking",
        collectionName,
        policyReason: "Runtime collection is outside the strict registry.",
      }),
  );
  const blockers = [
    ...malformedScopeBlockers,
    ...unknownCollectionBlockers,
    ...referenceFindings.blockers,
  ].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
  const runIdentity = {
    runtimeCollections,
    unknownRuntimeCollections,
    collectionSummaries,
    unknownCollectionSummaries,
    resetCandidateKeys: records
        .filter(({disposition}) => disposition === "reset")
        .map(({typedDocumentKey: key}) => key),
    preservedKeys: records
        .filter(({disposition}) => isPreservedDisposition(disposition))
        .map(({typedDocumentKey: key}) => key),
    unknownKeys: records
        .filter(({disposition}) => disposition === "unknown")
        .map(({typedDocumentKey: key}) => key),
    referenceDiagnosticDigests: referenceFindings.diagnostics.map(
        ({findingDigest}) => findingDigest,
    ),
    referenceWarningDigests: referenceFindings.warnings.map(
        ({findingDigest}) => findingDigest,
    ),
    referenceBlockerDigests: referenceFindings.blockers.map(
        ({findingDigest}) => findingDigest,
    ),
    blockerDigest: digest(blockers),
  };
  return {
    complete: true,
    truncated: false,
    omitted: 0,
    runtimeCollections,
    unknownRuntimeCollections,
    collectionSummaries,
    unknownCollectionSummaries,
    records,
    referenceFindings,
    blockers,
    runDigest: digest(runIdentity),
  };
}

function aggregateCounts(collectionSummaries) {
  return Object.values(collectionSummaries).reduce(
      (totals, counts) => {
        Object.keys(totals).forEach((key) => {
          totals[key] += counts[key];
        });
        return totals;
      },
      emptyCollectionCounts(),
  );
}

function warningCount(warnings, code) {
  return warnings.filter((warning) => warning.code === code).length;
}

function redactedCollectionSummaries(collectionSummaries) {
  return Object.fromEntries(
      Object.entries(collectionSummaries).map(([name, summary]) => [
        name,
        {
          scanned: summary.scanned,
          reset: summary.reset,
          preserved: summary.preserved,
          retained: summary.retained,
          unknown: summary.unknown,
          pageCount: summary.pageCount,
          complete: summary.complete,
          truncated: summary.truncated,
          omitted: summary.omitted,
          digest: summary.digest,
        },
      ]),
  );
}

function buildRedactedSummary({
  project,
  academy,
  releaseSha,
  runtimeSourceIdentity,
  firstRun,
  secondRun,
  consistency,
  planDigest,
}) {
  const sourceRun = consistency ? secondRun : firstRun;
  const totals = aggregateCounts(sourceRun.collectionSummaries);
  return {
    planVersion: RESET_PLAN_VERSION,
    releaseSha,
    runtimeHeadSha: runtimeSourceIdentity.runtimeHeadSha,
    runtimeTreeSha: runtimeSourceIdentity.runtimeTreeSha,
    criticalRuntimeSources: runtimeSourceIdentity.criticalRuntimeSources,
    project,
    academy,
    mode: "read_only_plan",
    completedRuns: 2,
    consistency,
    verdict: !consistency ?
      "incomplete" :
      sourceRun.blockers.length > 0 ? "blocked" : "complete",
    planDigest,
    registry: {
      total: ACADEMY_SCOPED_RESET_REGISTRY.length,
      resetAll: RESET_REGISTRY_COUNTS[RESET_CLASS],
      preserve: RESET_REGISTRY_COUNTS[PRESERVE_CLASS],
      retain: RESET_REGISTRY_COUNTS[RETAIN_CLASS],
      global: RESET_REGISTRY_COUNTS[GLOBAL_CLASS],
    },
    runtimeDiscovery: {
      discoveredCollectionCount: sourceRun.runtimeCollections.length,
      unknownCollectionCount: sourceRun.unknownRuntimeCollections.length,
    },
    collections: redactedCollectionSummaries(
        sourceRun.collectionSummaries,
    ),
    totals: {
      scanned: totals.scanned,
      resetCandidates: totals.reset,
      preserved: totals.preserved,
      retained: totals.retained,
      unknown: totals.unknown,
      unknownBlockers:
        sourceRun.blockers.length -
        sourceRun.referenceFindings.blockers.length,
      referenceDiagnosticCount:
        sourceRun.referenceFindings.diagnostics.length,
      referenceWarningCount:
        sourceRun.referenceFindings.warnings.length,
      referenceBlockerCount:
        sourceRun.referenceFindings.blockers.length,
      crossAcademyReferences: warningCount(
          sourceRun.referenceFindings.blockers,
          "cross_academy_reference",
      ),
      preservedReferenceWarnings: warningCount(
          sourceRun.referenceFindings.blockers,
          "preserved_document_references_reset_candidate",
      ),
      resetInternalMissingReferences: warningCount(
          sourceRun.referenceFindings.diagnostics,
          "missing_reset_internal_reference",
      ),
    },
    planned: {
      creates: 0,
      updates: 0,
      deletes: consistency ? totals.reset : 0,
    },
    actualWrites: 0,
    writeAuthorized: false,
    executorImplemented: false,
    complete: firstRun.complete && secondRun.complete,
    truncated: firstRun.truncated || secondRun.truncated,
    omitted: firstRun.omitted + secondRun.omitted,
    backupPreconditions: {
      managedFirestoreExportRequired: true,
      authInventoryRequired: true,
      academyShellSnapshotRequired: true,
      membershipsSnapshotRequired: true,
      teachersSnapshotRequired: true,
      preResetPlanDigestRequired: true,
      postResetZeroStateAuditRequired: true,
    },
  };
}

function manifestRecord(record, findingBySource) {
  return {
    rawDocumentPath: record.rawDocumentPath,
    typedDocumentKey: record.typedDocumentKey,
    collection: record.collection,
    classification: record.classification,
    plannerDisposition: record.disposition,
    deletionOrderGroup: record.deletionOrderGroup,
    academyScopeEvidence: record.academyScopeEvidence,
    documentDigest: record.documentDigest,
    directReferences: record.references.map((reference) => ({
      family: reference.family,
      field: reference.field,
      candidateTypedKeys: reference.candidateTypedKeys,
      ...(reference.aliasEvidence ?
        {aliasEvidence: reference.aliasEvidence} :
        {}),
      ...(reference.resolvedValue !== undefined ?
        {resolvedValue: reference.resolvedValue} :
        {}),
      ...(reference.conflict !== undefined ?
        {conflict: reference.conflict} :
        {}),
    })),
    referenceFindings:
      findingBySource.get(record.typedDocumentKey) || [],
  };
}

function buildSensitiveManifest({
  project,
  academy,
  releaseSha,
  runtimeSourceIdentity,
  run,
  planDigest,
}) {
  const findingBySource = new Map();
  const findings = [
    ...run.referenceFindings.diagnostics,
    ...run.referenceFindings.warnings,
    ...run.referenceFindings.blockers,
  ];
  for (const finding of findings) {
    const source = finding.sourceTypedKey || "";
    if (!findingBySource.has(source)) findingBySource.set(source, []);
    findingBySource.get(source).push({
      code: finding.code,
      severity: finding.severity,
      field: finding.field || null,
      targetTypedKeys: finding.targetTypedKeys || [],
      sourceClassification: finding.sourceClassification,
      targetCollectionClassification:
        finding.targetCollectionClassification,
      policyReason: finding.policyReason,
      ...(finding.aliasEvidence ?
        {aliasEvidence: finding.aliasEvidence} :
        {}),
      ...(finding.resolvedValue !== undefined ?
        {resolvedValue: finding.resolvedValue} :
        {}),
      ...(finding.conflict !== undefined ?
        {conflict: finding.conflict} :
        {}),
    });
  }
  return {
    planVersion: RESET_PLAN_VERSION,
    releaseSha,
    runtimeHeadSha: runtimeSourceIdentity.runtimeHeadSha,
    runtimeTreeSha: runtimeSourceIdentity.runtimeTreeSha,
    criticalRuntimeSources: runtimeSourceIdentity.criticalRuntimeSources,
    project,
    academy,
    mode: "read_only_plan",
    sensitivity: "LOCAL_ONLY_CONTAINS_RAW_FIRESTORE_PATHS",
    planDigest,
    completedRuns: 2,
    consistency: true,
    writeAuthorized: false,
    executorImplemented: false,
    backupVerified: false,
    independentReviewApproved: false,
    resetApproved: false,
    actualWrites: 0,
    records: run.records.map((record) =>
      manifestRecord(record, findingBySource),
    ),
    referenceFindings: run.referenceFindings,
    blockers: run.blockers,
  };
}

function assertNoProhibitedContent(value, label) {
  const rendered = stableStringify(value);
  if (EMAIL_PATTERN.test(rendered)) {
    throw new PlannerConfigError(`${label} contains an email address.`);
  }
  for (const pattern of PROHIBITED_TEXT_PATTERNS) {
    if (pattern.test(rendered)) {
      throw new PlannerConfigError(
          `${label} contains prohibited credential or token material.`,
      );
    }
  }
}

function assertRedactedSummary(summary) {
  const forbiddenKeys = new Set([
    "documentid",
    "rawdocumentpath",
    "typeddocumentkey",
    "uid",
    "email",
    "name",
    "phone",
    "address",
    "token",
    "authorization",
  ]);
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeys.has(key.toLowerCase())) {
        throw new PlannerConfigError(
            `Redacted summary contains forbidden key: ${key}.`,
        );
      }
      visit(nested);
    }
  };
  visit(summary);
  assertNoProhibitedContent(summary, "Redacted summary");
}

export async function buildAcademyScopedResetPlan({
  db,
  project,
  academy,
  releaseSha,
  runtimeSourceIdentity,
  pageSize = DEFAULT_PAGE_SIZE,
  beforeSecondRun = null,
}) {
  validatePlannerIdentity({project, academy, releaseSha, pageSize});
  const validatedRuntimeSourceIdentity =
    validatePlannerRuntimeSourceIdentity({
      identity: runtimeSourceIdentity,
      releaseSha,
    });
  const firstRun = await scanPlannerInventoryOnce({
    db,
    academy,
    pageSize,
  });
  if (beforeSecondRun) await beforeSecondRun();
  const secondRun = await scanPlannerInventoryOnce({
    db,
    academy,
    pageSize,
  });
  const consistency = firstRun.runDigest === secondRun.runDigest;
  const planDigest = digest({
    planVersion: RESET_PLAN_VERSION,
    project,
    academy,
    releaseSha,
    runtimeHeadSha: validatedRuntimeSourceIdentity.runtimeHeadSha,
    runtimeTreeSha: validatedRuntimeSourceIdentity.runtimeTreeSha,
    criticalRuntimeSources:
      validatedRuntimeSourceIdentity.criticalRuntimeSources,
    firstRunDigest: firstRun.runDigest,
    secondRunDigest: secondRun.runDigest,
    consistency,
  });
  const summary = buildRedactedSummary({
    project,
    academy,
    releaseSha,
    runtimeSourceIdentity: validatedRuntimeSourceIdentity,
    firstRun,
    secondRun,
    consistency,
    planDigest,
  });
  assertRedactedSummary(summary);
  const manifest = consistency ? buildSensitiveManifest({
    project,
    academy,
    releaseSha,
    runtimeSourceIdentity: validatedRuntimeSourceIdentity,
    run: secondRun,
    planDigest,
  }) : null;
  if (manifest) assertNoProhibitedContent(manifest, "Sensitive manifest");
  const exitCode = !consistency ? 3 :
    secondRun.blockers.length > 0 ? 2 : 0;
  return {
    exitCode,
    summary,
    manifest,
    firstRun,
    secondRun,
  };
}

function parseFlagToken(token) {
  const body = token.slice(2);
  const separator = body.indexOf("=");
  if (separator === -1) return {key: body, inlineValue: null};
  return {
    key: body.slice(0, separator),
    inlineValue: body.slice(separator + 1),
  };
}

export function parsePlannerArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new PlannerConfigError(`Unexpected positional argument: ${token}`);
    }
    const {key, inlineValue} = parseFlagToken(token);
    if (BANNED_FLAGS.has(key)) {
      throw new PlannerConfigError(`Forbidden mutation flag: --${key}`);
    }
    if (!ALLOWED_FLAGS.has(key)) {
      throw new PlannerConfigError(`Unknown flag: --${key}`);
    }
    if (Object.prototype.hasOwnProperty.call(values, key)) {
      throw new PlannerConfigError(`Duplicate flag: --${key}`);
    }
    const value = inlineValue == null ? argv[index + 1] : inlineValue;
    if (inlineValue == null) index += 1;
    if (!value || value.startsWith("--")) {
      throw new PlannerConfigError(`Missing value for --${key}`);
    }
    values[key] = value;
  }
  return {
    project: values.project || "",
    academy: values.academy || "",
    releaseSha: values["release-sha"] || "",
    summaryOutput: values["summary-output"] || "",
    sensitiveOutput: values["sensitive-output"] || "",
    pageSize: values["page-size"] == null ?
      DEFAULT_PAGE_SIZE :
      Number(values["page-size"]),
  };
}

function validatePlannerIdentity({
  project,
  academy,
  releaseSha,
  pageSize,
}) {
  if (!normalizeText(project)) {
    throw new PlannerConfigError("--project is required.");
  }
  if (academy !== EXPECTED_TARGET_ACADEMY) {
    throw new PlannerConfigError(
        `--academy must be exactly ${EXPECTED_TARGET_ACADEMY}.`,
    );
  }
  if (!/^[0-9a-f]{40}$/.test(releaseSha)) {
    throw new PlannerConfigError(
        "--release-sha must be a lowercase 40-character Git SHA.",
    );
  }
  if (!Number.isSafeInteger(pageSize) ||
      pageSize < MIN_PAGE_SIZE ||
      pageSize > MAX_PAGE_SIZE) {
    throw new PlannerConfigError(
        `--page-size must be between ${MIN_PAGE_SIZE} and ${MAX_PAGE_SIZE}.`,
    );
  }
}

function pathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validateOutputPath(filePath, label) {
  if (!path.isAbsolute(filePath)) {
    throw new PlannerConfigError(`${label} must be an absolute path.`);
  }
  if (fs.existsSync(filePath)) {
    throw new PlannerConfigError(`${label} already exists.`);
  }
  const parent = path.dirname(filePath);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new PlannerConfigError(`${label} parent directory must exist.`);
  }
  if (fs.lstatSync(parent).isSymbolicLink()) {
    throw new PlannerConfigError(`${label} parent must not be a symlink.`);
  }
  const parentMode = fs.statSync(parent).mode & 0o777;
  if ((parentMode & 0o077) !== 0) {
    throw new PlannerConfigError(
        `${label} parent directory must not permit group/other access.`,
    );
  }
  const realParent = fs.realpathSync(parent);
  const resolvedOutput = path.join(realParent, path.basename(filePath));
  const repositoryRealPath =
    resolvePlannerFilesystemRepositoryRoot().repositoryRoot;
  if (pathInside(repositoryRealPath, resolvedOutput) ||
      pathInside(path.join(repositoryRealPath, ".git"), resolvedOutput)) {
    throw new PlannerConfigError(
        `${label} must be outside the repository and .git.`,
    );
  }
  return resolvedOutput;
}

function validatePlannerExecutionOptions(options, env = process.env) {
  validatePlannerIdentity(options);
  const emulatorHost = normalizeText(env.FIRESTORE_EMULATOR_HOST);
  if (emulatorHost) {
    if (!options.project.startsWith("demo-")) {
      throw new PlannerConfigError(
          "Emulator planner requires a demo-* project.",
      );
    }
  } else {
    if (options.project !== EXPECTED_PRODUCTION_PROJECT) {
      throw new PlannerConfigError(
          `Non-emulator project must be ${EXPECTED_PRODUCTION_PROJECT}.`,
      );
    }
    if (env.CONFIRM_PRODUCTION_READONLY_RESET_PLAN !== "YES") {
      throw new PlannerConfigError(
          "CONFIRM_PRODUCTION_READONLY_RESET_PLAN=YES is required.",
      );
    }
  }
  return {...options};
}

function validatePlannerOutputPaths(options) {
  if (!options.summaryOutput || !options.sensitiveOutput) {
    throw new PlannerConfigError(
        "--summary-output and --sensitive-output are required.",
    );
  }
  if (options.summaryOutput === options.sensitiveOutput) {
    throw new PlannerConfigError("Output paths must be different.");
  }
  return {
    ...options,
    summaryOutput: validateOutputPath(
        options.summaryOutput,
        "Summary output",
    ),
    sensitiveOutput: validateOutputPath(
        options.sensitiveOutput,
        "Sensitive output",
    ),
  };
}

export function validatePlannerOptions(options, env = process.env) {
  return validatePlannerOutputPaths(
      validatePlannerExecutionOptions(options, env),
  );
}

function prepareAtomicFile(filePath, value) {
  const payload = `${JSON.stringify(value, null, 2)}\n`;
  const temporaryPath = path.join(
      path.dirname(filePath),
      `.${path.basename(filePath)}.${process.pid}.` +
      `${crypto.randomBytes(8).toString("hex")}.tmp`,
  );
  let descriptor;
  try {
    descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY |
        fs.constants.O_CREAT |
        fs.constants.O_EXCL,
        0o600,
    );
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.chmodSync(temporaryPath, 0o600);
    return {filePath, temporaryPath};
  } catch (error) {
    if (descriptor != null) fs.closeSync(descriptor);
    try {
      fs.unlinkSync(temporaryPath);
    } catch {
      // The temporary file may not have been created.
    }
    throw error;
  }
}

function publishPreparedFiles(prepared) {
  const published = [];
  try {
    for (const item of prepared) {
      fs.linkSync(item.temporaryPath, item.filePath);
      published.push(item.filePath);
    }
  } catch (error) {
    published.forEach((filePath) => {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Best-effort rollback of a partially published output pair.
      }
    });
    throw error;
  } finally {
    prepared.forEach(({temporaryPath}) => {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The temporary file may already have been removed.
      }
    });
  }
  published.forEach((filePath) => fs.chmodSync(filePath, 0o600));
}

export function writePlannerOutputs({
  summaryOutput,
  sensitiveOutput,
  summary,
  manifest,
}) {
  assertRedactedSummary(summary);
  const prepared = [];
  try {
    prepared.push(prepareAtomicFile(summaryOutput, summary));
    if (manifest) {
      assertNoProhibitedContent(manifest, "Sensitive manifest");
      prepared.push(prepareAtomicFile(sensitiveOutput, manifest));
    }
    publishPreparedFiles(prepared);
  } catch (error) {
    prepared.forEach(({temporaryPath}) => {
      try {
        fs.unlinkSync(temporaryPath);
      } catch {
        // The atomic publisher may already have removed the file.
      }
    });
    throw error;
  }
  return {
    summaryWritten: true,
    sensitiveWritten: Boolean(manifest),
  };
}

async function createCliFirestore(project, env) {
  const {
    applicationDefault,
    deleteApp,
    getApps,
    initializeApp,
  } = await import("firebase-admin/app");
  const {getFirestore} = await import("firebase-admin/firestore");
  const emulator = Boolean(normalizeText(env.FIRESTORE_EMULATOR_HOST));
  const app = getApps().find((item) => item.name === "reset-planner") ||
    initializeApp(
        emulator ? {projectId: project} : {
          projectId: project,
          credential: applicationDefault(),
        },
        "reset-planner",
    );
  return {
    db: getFirestore(app),
    cleanup: async () => deleteApp(app),
  };
}

function safeErrorMessage(error) {
  if (error instanceof PlannerConfigError ||
      error instanceof PlannerIncompleteError) {
    return error.message;
  }
  return error?.name || "PlannerError";
}

export async function executePlannerCli({
  argv = process.argv.slice(2),
  env = process.env,
  dbFactory = createCliFirestore,
  stdout = console.log,
  stderr = console.error,
  beforeSecondRun = null,
} = {}) {
  let connection = null;
  try {
    const parsedOptions = parsePlannerArgs(argv);
    const sourceIdentity = resolvePlannerRuntimeSourceIdentity();
    const executionOptions =
      validatePlannerExecutionOptions(parsedOptions, env);
    const runtimeSourceIdentity =
      validatePlannerRuntimeSourceIdentity({
        identity: sourceIdentity,
        releaseSha: executionOptions.releaseSha,
      });
    const options = validatePlannerOutputPaths(executionOptions);
    await loadRuntimeRegistryModule();
    connection = await dbFactory(options.project, env);
    const result = await buildAcademyScopedResetPlan({
      db: connection.db,
      project: options.project,
      academy: options.academy,
      releaseSha: options.releaseSha,
      runtimeSourceIdentity,
      pageSize: options.pageSize,
      beforeSecondRun,
    });
    const writes = writePlannerOutputs({
      summaryOutput: options.summaryOutput,
      sensitiveOutput: options.sensitiveOutput,
      summary: result.summary,
      manifest: result.manifest,
    });
    stdout(JSON.stringify({
      ok: result.exitCode === 0,
      exitCode: result.exitCode,
      mode: "read_only_plan",
      completedRuns: 2,
      consistency: result.summary.consistency,
      resetCandidates: result.summary.totals.resetCandidates,
      unknownBlockers: result.summary.totals.unknownBlockers,
      referenceDiagnostics:
        result.summary.totals.referenceDiagnosticCount,
      referenceWarnings: result.summary.totals.referenceWarningCount,
      referenceBlockers: result.summary.totals.referenceBlockerCount,
      plannedDeletes: result.summary.planned.deletes,
      actualWrites: 0,
      writeAuthorized: false,
      executorImplemented: false,
      summaryWritten: writes.summaryWritten,
      sensitiveWritten: writes.sensitiveWritten,
    }));
    return result.exitCode;
  } catch (error) {
    const exitCode = error instanceof PlannerIncompleteError ? 3 : 1;
    stderr(JSON.stringify({
      ok: false,
      exitCode,
      mode: "read_only_plan",
      error: safeErrorMessage(error),
      actualWrites: 0,
      writeAuthorized: false,
      executorImplemented: false,
    }));
    return exitCode;
  } finally {
    if (connection?.cleanup) await connection.cleanup();
  }
}

const isMainModule = process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;
if (isMainModule) {
  process.exitCode = await executePlannerCli();
}
