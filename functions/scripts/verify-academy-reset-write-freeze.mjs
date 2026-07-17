import crypto from "node:crypto";
import {execFileSync} from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {
  APPROVED_PROVIDER_ADAPTER_ID,
  CRITICAL_RUNTIME_SOURCE_PATHS,
  buildDeterministicWriteFreezeProof,
  stableStringify,
} from "./academy-reset-write-freeze-contract.mjs";
import {
  WRITE_SOURCE_SHA256_ALLOWLIST,
} from "./academy-reset-write-surface-registry.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const MAX_EVIDENCE_BYTES = 1024 * 1024;
const GIT_OUTPUT_LIMIT = 16 * 1024 * 1024;

function isWithin(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === "" ||
    (!relative.startsWith(`..${path.sep}`) && relative !== ".." &&
      !path.isAbsolute(relative));
}

function assertAbsoluteExternalPath(candidate, repositoryRoot, label) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate) ||
      candidate.includes("\u0000")) {
    throw new Error(`${label} must be an absolute path.`);
  }
  const resolvedRepository = fs.realpathSync(repositoryRoot);
  const resolvedCandidate = path.resolve(candidate);
  if (isWithin(resolvedRepository, resolvedCandidate)) {
    throw new Error(`${label} must be outside the repository.`);
  }
  return resolvedCandidate;
}

function assertNotSymlink(candidate, label) {
  let stat;
  try {
    stat = fs.lstatSync(candidate);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  if (stat.isSymbolicLink()) throw new Error(`${label} must not be a symlink.`);
}

function assertSafeExistingInput(inputPath, repositoryRoot) {
  const resolved = assertAbsoluteExternalPath(
      inputPath,
      repositoryRoot,
      "Evidence path",
  );
  assertNotSymlink(resolved, "Evidence path");
  const stat = fs.statSync(resolved);
  if (!stat.isFile()) throw new Error("Evidence path must be a regular file.");
  if ((stat.mode & 0o777) !== 0o600) {
    throw new Error("Evidence file mode must be exactly 0600.");
  }
  if (stat.size <= 0 || stat.size > MAX_EVIDENCE_BYTES) {
    throw new Error("Evidence file size is outside the allowed range.");
  }
  const real = fs.realpathSync(resolved);
  if (real !== resolved) {
    throw new Error("Evidence path must not traverse symlink components.");
  }
  if (isWithin(fs.realpathSync(repositoryRoot), real)) {
    throw new Error("Evidence path resolves inside the repository.");
  }
  return real;
}

function assertSafeNewOutput(outputPath, repositoryRoot) {
  const resolved = assertAbsoluteExternalPath(
      outputPath,
      repositoryRoot,
      "Proof output path",
  );
  assertNotSymlink(resolved, "Proof output path");
  if (fs.existsSync(resolved)) {
    throw new Error("Proof output already exists (no-clobber).");
  }
  const parent = path.dirname(resolved);
  assertNotSymlink(parent, "Proof output directory");
  const parentStat = fs.statSync(parent);
  if (!parentStat.isDirectory()) {
    throw new Error("Proof output parent must be a directory.");
  }
  if ((parentStat.mode & 0o777) !== 0o700) {
    throw new Error("Proof output parent mode must be exactly 0700.");
  }
  const realParent = fs.realpathSync(parent);
  if (realParent !== parent) {
    throw new Error("Proof output path must not traverse symlink components.");
  }
  if (isWithin(fs.realpathSync(repositoryRoot), realParent)) {
    throw new Error("Proof output resolves inside the repository.");
  }
  return path.join(realParent, path.basename(resolved));
}

export function sanitizedGitEnvironment(environment = process.env) {
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
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
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

function sha256Bytes(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function singleLine(value, label) {
  const lines = value.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length !== 1) throw new Error(`${label} is not singular.`);
  return lines[0];
}

export function resolveRuntimeGitSourceIdentity({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
} = {}) {
  const canonicalRoot = fs.realpathSync(repositoryRoot);
  const topLevel = fs.realpathSync(singleLine(
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
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
    "-z",
  ]);
  if (status.length !== 0) {
    throw new Error("Runtime Git worktree is dirty.");
  }
  const writerPinByPath = new Map(
      WRITE_SOURCE_SHA256_ALLOWLIST.map(({sourceFile, sha256}) =>
        [sourceFile, sha256]),
  );
  const criticalSources = CRITICAL_RUNTIME_SOURCE_PATHS.map((relativePath) => {
    if (path.isAbsolute(relativePath) || relativePath.includes("\\") ||
        relativePath.split("/").includes("..")) {
      throw new Error(`Unsafe critical runtime source: ${relativePath}`);
    }
    const tracked = singleLine(
        runLocalGit(canonicalRoot, [
          "ls-files",
          "--error-unmatch",
          "--",
          relativePath,
        ]),
        `Tracked source ${relativePath}`,
    );
    if (tracked !== relativePath) {
      throw new Error(`Critical runtime source is not exactly tracked: ${relativePath}`);
    }
    const indexLine = singleLine(
        runLocalGit(canonicalRoot, ["ls-files", "-v", "--", relativePath]),
        `Index flags ${relativePath}`,
    );
    const indexMatch = indexLine.match(/^([A-Z]) (.+)$/);
    if (!indexMatch || indexMatch[1] !== "H" ||
        indexMatch[2] !== relativePath) {
      throw new Error(`Critical runtime source has unsafe index flags: ${relativePath}`);
    }
    const treeOutput = runLocalGit(canonicalRoot, [
      "ls-tree",
      "-z",
      "HEAD",
      "--",
      relativePath,
    ]);
    const treeMatch = treeOutput.match(
        /^(100644|100755) blob ([a-f0-9]{40})\t([^\u0000]+)\u0000$/,
    );
    if (!treeMatch || treeMatch[3] !== relativePath) {
      throw new Error(`Critical runtime source is not a regular HEAD blob: ${relativePath}`);
    }
    const absolutePath = path.join(canonicalRoot, relativePath);
    const stat = fs.lstatSync(absolutePath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Critical runtime source is not a regular file: ${relativePath}`);
    }
    const runtimeBytes = fs.readFileSync(absolutePath);
    const headBytes = runLocalGit(
        canonicalRoot,
        ["cat-file", "blob", `HEAD:${relativePath}`],
        {buffer: true},
    );
    if (!runtimeBytes.equals(headBytes)) {
      throw new Error(`Critical runtime source bytes differ from HEAD: ${relativePath}`);
    }
    const runtimeSha256 = sha256Bytes(runtimeBytes);
    const writerPin = writerPinByPath.get(relativePath);
    if (writerPin && runtimeSha256 !== writerPin) {
      throw new Error(
          `Runtime writer source SHA-256 differs from pin: ${relativePath}`,
      );
    }
    return Object.freeze({
      path: relativePath,
      fileMode: treeMatch[1],
      gitBlobOid: treeMatch[2],
      indexFlags: indexMatch[1],
      runtimeSha256,
      headSha256: sha256Bytes(headBytes),
    });
  });
  return Object.freeze({
    headSha,
    treeSha,
    clean: true,
    criticalSources: Object.freeze(criticalSources),
  });
}

export function assertRuntimeGitEvidence(evidence, runtimeGit) {
  if (evidence?.release?.sha !== runtimeGit.headSha) {
    throw new Error("Evidence release SHA does not match local Git HEAD.");
  }
  if (stableStringify(evidence.release.runtimeGit) !==
      stableStringify(runtimeGit)) {
    throw new Error("Evidence runtime Git identity does not match local Git.");
  }
  return true;
}

export async function observeApprovedProviderDeployment(providerAdapter) {
  if (!providerAdapter || typeof providerAdapter !== "object" ||
      providerAdapter.adapterId !== APPROVED_PROVIDER_ADAPTER_ID ||
      typeof providerAdapter.observeDeployment !== "function") {
    throw new Error(
        "An approved provider adapter is required; proof generation refused.",
    );
  }
  const result = await providerAdapter.observeDeployment();
  if (!result || typeof result !== "object" ||
      result.adapterId !== APPROVED_PROVIDER_ADAPTER_ID) {
    throw new Error("Approved provider adapter returned an invalid result.");
  }
  return result;
}

export function readLocalEvidenceFile({
  evidencePath,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
}) {
  const safePath = assertSafeExistingInput(evidencePath, repositoryRoot);
  const flags = fs.constants.O_RDONLY |
    (fs.constants.O_NOFOLLOW || 0);
  const descriptor = fs.openSync(safePath, flags);
  try {
    const stat = fs.fstatSync(descriptor);
    if (!stat.isFile() || (stat.mode & 0o777) !== 0o600 ||
        stat.size <= 0 || stat.size > MAX_EVIDENCE_BYTES) {
      throw new Error("Evidence descriptor is not an allowed regular file.");
    }
    const text = fs.readFileSync(descriptor, "utf8");
    let evidence;
    try {
      evidence = JSON.parse(text);
    } catch {
      throw new Error("Evidence file is not valid JSON.");
    }
    return evidence;
  } finally {
    fs.closeSync(descriptor);
  }
}

export function writeProofAtomicNoClobber({
  outputPath,
  proof,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
}) {
  const safeOutput = assertSafeNewOutput(outputPath, repositoryRoot);
  const temporaryPath =
    `${safeOutput}.tmp-${process.pid}-${Date.now().toString(36)}`;
  let temporaryCreated = false;
  let outputLinked = false;
  try {
    const descriptor = fs.openSync(
        temporaryPath,
        fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL,
        0o600,
    );
    temporaryCreated = true;
    try {
      fs.writeFileSync(descriptor, `${stableStringify(proof)}\n`, "utf8");
      fs.fsyncSync(descriptor);
      fs.fchmodSync(descriptor, 0o600);
    } finally {
      fs.closeSync(descriptor);
    }
    fs.linkSync(temporaryPath, safeOutput);
    outputLinked = true;
    fs.chmodSync(safeOutput, 0o600);
    const directoryDescriptor = fs.openSync(path.dirname(safeOutput), "r");
    try {
      fs.fsyncSync(directoryDescriptor);
    } finally {
      fs.closeSync(directoryDescriptor);
    }
  } catch (error) {
    if (outputLinked) {
      try {
        fs.unlinkSync(safeOutput);
      } catch (cleanupError) {
        if (cleanupError?.code !== "ENOENT") {
          error.message += `; output cleanup failed: ${cleanupError.message}`;
        }
      }
    }
    if (error?.code === "EEXIST") {
      throw new Error("Proof output already exists (no-clobber).");
    }
    throw error;
  } finally {
    if (temporaryCreated) {
      try {
        fs.unlinkSync(temporaryPath);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }
  }
  return safeOutput;
}

export async function verifyLocalWriteFreezeEvidence({
  evidencePath,
  outputPath,
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  providerAdapter,
}) {
  const evidence = readLocalEvidenceFile({evidencePath, repositoryRoot});
  const providerResult =
    await observeApprovedProviderDeployment(providerAdapter);
  const runtimeGit = resolveRuntimeGitSourceIdentity({repositoryRoot});
  assertRuntimeGitEvidence(evidence, runtimeGit);
  const proof = buildDeterministicWriteFreezeProof(evidence, {providerResult});
  const writtenPath = writeProofAtomicNoClobber({
    outputPath,
    proof,
    repositoryRoot,
  });
  return Object.freeze({proof, writtenPath});
}

export function parseVerifierArguments(argv) {
  const result = {evidencePath: "", outputPath: ""};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--evidence" || token === "--output") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error(`${token} requires one absolute path.`);
      }
      const key = token === "--evidence" ? "evidencePath" : "outputPath";
      if (result[key]) throw new Error(`${token} may be supplied only once.`);
      result[key] = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown verifier argument: ${token}`);
  }
  if (!result.evidencePath || !result.outputPath) {
    throw new Error("--evidence and --output are required.");
  }
  return Object.freeze(result);
}

export async function executeVerifierCli(
    argv = process.argv.slice(2),
    {providerAdapter} = {},
) {
  const options = parseVerifierArguments(argv);
  if (!providerAdapter) {
    throw new Error(
        "CLI has no approved provider adapter; proof generation refused.",
    );
  }
  const result =
    await verifyLocalWriteFreezeEvidence({...options, providerAdapter});
  process.stdout.write(`${stableStringify({
    ok: true,
    proofDigest: result.proof.proofDigest,
    outputPath: result.writtenPath,
  })}\n`);
  return result;
}

const isMainModule = process.argv[1] &&
  fs.realpathSync(process.argv[1]) === fs.realpathSync(__filename);
if (isMainModule) {
  try {
    await executeVerifierCli();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
