import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {
  WRITE_SOURCE_SHA256_ALLOWLIST,
} from "./academy-reset-write-surface-registry.mjs";
import {
  EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
  PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES,
} from "./academy-reset-freeze-provider-reviewed-sources.mjs";

const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;
export const PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION =
  "academy_reset_provider_reviewed_sources.v1";
export const PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM =
  "sha256_canonical_path_and_file_sha256.v1";
export const PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS = Object.freeze(
    PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.map(({path: sourcePath}) =>
      sourcePath),
);
const INFRASTRUCTURE_RUNTIME_SOURCE_PATHS = Object.freeze([
  "firestore.rules",
  "functions/academy-reset-write-freeze.js",
  "functions/linkStudentAccountSafety.cjs",
  "functions/scripts/academy-reset-write-freeze-contract.mjs",
  "functions/scripts/academy-reset-write-surface-registry.mjs",
  "functions/scripts/verify-academy-reset-write-freeze.mjs",
]);
export const CRITICAL_RUNTIME_SOURCE_PATHS = Object.freeze([
  ...new Set([
    ...INFRASTRUCTURE_RUNTIME_SOURCE_PATHS,
    ...WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile}) => sourceFile),
  ]),
].sort());

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function sha256Canonical(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function computeReviewedSourceDigest(identities) {
  return sha256Canonical({
    algorithm: PROVIDER_ADAPTER_REVIEWED_SOURCE_DIGEST_ALGORITHM,
    identities,
    schemaVersion: PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
  });
}

function canonicalRepositoryRoot(repositoryRootInput) {
  if (typeof repositoryRootInput !== "string" ||
      !path.isAbsolute(repositoryRootInput) ||
      repositoryRootInput.includes("\u0000")) {
    throw new Error("Repository root must be an absolute path.");
  }
  const repositoryRoot = fs.realpathSync.native(repositoryRootInput);
  const stat = fs.lstatSync(repositoryRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error("Repository root must be a regular directory.");
  }
  return repositoryRoot;
}

function assertSafeRelativePath(relativePath) {
  if (typeof relativePath !== "string" || path.isAbsolute(relativePath) ||
      relativePath.includes("\\") ||
      relativePath.split("/").includes("..")) {
    throw new Error(`Unsafe runtime source path: ${String(relativePath)}`);
  }
}

export function validateProviderAdapterReviewedSources(repositoryRootInput) {
  const repositoryRoot = canonicalRepositoryRoot(repositoryRootInput);
  const identities = PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.map((pin) => {
    assertSafeRelativePath(pin.path);
    const absolutePath = path.resolve(repositoryRoot, pin.path);
    const relativePath = path.relative(repositoryRoot, absolutePath);
    if (relativePath.startsWith(`..${path.sep}`) ||
        relativePath === ".." || path.isAbsolute(relativePath)) {
      throw new Error("Reviewed source path escapes repository.");
    }
    let stat;
    let realPath;
    let bytes;
    try {
      stat = fs.lstatSync(absolutePath);
      realPath = fs.realpathSync.native(absolutePath);
      bytes = fs.readFileSync(absolutePath);
    } catch {
      throw new Error(`Reviewed source is unreadable: ${pin.path}`);
    }
    if (!stat.isFile() || stat.isSymbolicLink() ||
        realPath !== absolutePath) {
      throw new Error(`Reviewed source is not a regular file: ${pin.path}`);
    }
    const sha256 = sha256Bytes(bytes);
    if (sha256 !== pin.sha256) {
      throw new Error(`Reviewed source literal pin mismatch: ${pin.path}`);
    }
    return Object.freeze({path: pin.path, sha256});
  });
  const aggregateDigest = computeReviewedSourceDigest(identities);
  if (aggregateDigest !==
      EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST) {
    throw new Error("Reviewed source aggregate pin mismatch.");
  }
  return Object.freeze({
    aggregateDigest,
    identities: Object.freeze(identities),
    repositoryRoot,
    repositoryRootDigest: sha256Canonical({
      repositoryRoot,
      schemaVersion: PROVIDER_ADAPTER_REVIEWED_SOURCE_CONTRACT_VERSION,
    }),
  });
}

function sanitizedGitEnvironment(environment = process.env) {
  const result = Object.create(null);
  for (const key of [
    "PATH", "HOME", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "SystemRoot",
    "COMSPEC", "PATHEXT", "LANG", "LC_ALL",
  ]) {
    if (typeof environment[key] === "string") result[key] = environment[key];
  }
  result.GIT_CONFIG_NOSYSTEM = "1";
  result.GIT_CONFIG_GLOBAL = "/dev/null";
  result.GIT_TERMINAL_PROMPT = "0";
  result.GCM_INTERACTIVE = "Never";
  result.GIT_OPTIONAL_LOCKS = "0";
  result.GIT_PAGER = "cat";
  result.PAGER = "cat";
  return result;
}

function runLocalGit(repositoryRoot, args, {buffer = false} = {}) {
  return execFileSync("git", [
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    ...args,
  ], {
    cwd: repositoryRoot,
    env: sanitizedGitEnvironment(),
    encoding: buffer ? null : "utf8",
    maxBuffer: GIT_OUTPUT_LIMIT,
    shell: false,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function singleLine(value, label) {
  const lines = value.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error(`${label} is not singular.`);
  return lines[0];
}

function inspectTrackedSource(repositoryRoot, relativePath, expectedSha256) {
  assertSafeRelativePath(relativePath);
  const tracked = singleLine(runLocalGit(repositoryRoot, [
    "ls-files", "--error-unmatch", "--", relativePath,
  ]), `Tracked source ${relativePath}`);
  if (tracked !== relativePath) {
    throw new Error(`Runtime source is not exactly tracked: ${relativePath}`);
  }
  const indexLine = singleLine(
      runLocalGit(repositoryRoot, ["ls-files", "-v", "--", relativePath]),
      `Index flags ${relativePath}`,
  );
  const indexMatch = indexLine.match(/^([A-Z]) (.+)$/);
  if (!indexMatch || indexMatch[1] !== "H" ||
      indexMatch[2] !== relativePath) {
    throw new Error(`Runtime source has unsafe index flags: ${relativePath}`);
  }
  const treeOutput = runLocalGit(repositoryRoot, [
    "ls-tree", "-z", "HEAD", "--", relativePath,
  ]);
  const treeMatch = treeOutput.match(
      /^(100644|100755) blob ([a-f0-9]{40})\t([^\u0000]+)\u0000$/,
  );
  if (!treeMatch || treeMatch[3] !== relativePath) {
    throw new Error(`Runtime source is not a regular HEAD blob: ${relativePath}`);
  }
  const absolutePath = path.join(repositoryRoot, relativePath);
  const stat = fs.lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink() ||
      fs.realpathSync.native(absolutePath) !== absolutePath) {
    throw new Error(`Runtime source is not a regular file: ${relativePath}`);
  }
  const runtimeBytes = fs.readFileSync(absolutePath);
  const headBytes = runLocalGit(
      repositoryRoot,
      ["cat-file", "blob", `HEAD:${relativePath}`],
      {buffer: true},
  );
  if (!runtimeBytes.equals(headBytes)) {
    throw new Error(`Runtime source bytes differ from HEAD: ${relativePath}`);
  }
  const runtimeSha256 = sha256Bytes(runtimeBytes);
  if (expectedSha256 && runtimeSha256 !== expectedSha256) {
    throw new Error(`Runtime source SHA-256 differs from pin: ${relativePath}`);
  }
  return Object.freeze({
    path: relativePath,
    fileMode: treeMatch[1],
    gitBlobOid: treeMatch[2],
    indexFlags: indexMatch[1],
    runtimeSha256,
    headSha256: sha256Bytes(headBytes),
  });
}

export function resolveRuntimeGitSourceIdentity({repositoryRoot} = {}) {
  const canonicalRoot = canonicalRepositoryRoot(repositoryRoot);
  const topLevel = fs.realpathSync.native(singleLine(
      runLocalGit(canonicalRoot, ["rev-parse", "--show-toplevel"]),
      "Git top-level",
  ));
  if (topLevel !== canonicalRoot) {
    throw new Error("Repository root is not the exact Git top-level.");
  }
  const headSha = singleLine(
      runLocalGit(canonicalRoot, ["rev-parse", "HEAD"]),
      "Git HEAD",
  );
  const treeSha = singleLine(
      runLocalGit(canonicalRoot, ["rev-parse", "HEAD^{tree}"]),
      "Git tree",
  );
  if (!/^[a-f0-9]{40}$/.test(headSha) || !/^[a-f0-9]{40}$/.test(treeSha)) {
    throw new Error("Git HEAD or tree does not use the required SHA format.");
  }
  const status = runLocalGit(canonicalRoot, [
    "status", "--porcelain=v1", "--untracked-files=all", "-z",
  ]);
  if (status.length !== 0) throw new Error("Runtime Git worktree is dirty.");
  const writerPins = new Map(
      WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile, sha256}) =>
        [sourceFile, sha256]),
  );
  const reviewedPins = new Map(
      PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITIES.map(({path: sourcePath,
        sha256}) => [sourcePath, sha256]),
  );
  const criticalSources = CRITICAL_RUNTIME_SOURCE_PATHS.map((sourcePath) =>
    inspectTrackedSource(canonicalRoot, sourcePath, writerPins.get(sourcePath)));
  const reviewedSources = PROVIDER_ADAPTER_REVIEWED_SOURCE_PATHS.map(
      (sourcePath) =>
        inspectTrackedSource(canonicalRoot, sourcePath,
            reviewedPins.get(sourcePath)),
  );
  return Object.freeze({
    headSha,
    treeSha,
    clean: true,
    criticalSources: Object.freeze(criticalSources),
    criticalSourceSetDigest: sha256Canonical(criticalSources),
    reviewedSources: Object.freeze(reviewedSources),
    reviewedSourceIdentityDigest:
      EXPECTED_PROVIDER_ADAPTER_REVIEWED_SOURCE_IDENTITY_DIGEST,
    reviewedSourceSetDigest: sha256Canonical(reviewedSources),
  });
}

export function assertRuntimeGitEvidence(evidence, runtimeGit) {
  if (evidence?.release?.sha !== runtimeGit.headSha ||
      evidence?.deploymentApprovalReceipt?.releaseSha !==
        runtimeGit.headSha) {
    throw new Error("Evidence release SHA does not match runtime Git HEAD.");
  }
  if (canonical(evidence.release.runtimeGit) !== canonical(runtimeGit)) {
    throw new Error("Evidence runtime Git identity does not match local Git.");
  }
  return true;
}
