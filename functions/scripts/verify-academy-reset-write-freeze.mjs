import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";
import {
  buildDeterministicWriteFreezeProof,
  stableStringify,
} from "./academy-reset-write-freeze-contract.mjs";
import {
  assertRuntimeGitEvidence,
  validateProviderAdapterReviewedSources,
} from "./academy-reset-freeze-runtime-identity.mjs";
import {
  createValidatedProviderRuntimeContext,
} from "./academy-reset-freeze-provider-attestation.mjs";
import {
  assertGenuineMockAcademyResetFreezeProviderAdapter,
  assertGenuineMockAcademyResetFreezeProviderResult,
} from "./academy-reset-freeze-provider-adapter.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const DEFAULT_REPOSITORY_ROOT = path.resolve(__dirname, "../..");
const MAX_EVIDENCE_BYTES = 1024 * 1024;

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

export async function observeApprovedProviderDeployment(
    providerAdapter,
    reviewedSources,
) {
  try {
    assertGenuineMockAcademyResetFreezeProviderAdapter(
        providerAdapter,
        reviewedSources,
    );
  } catch {
    throw new Error(
        "A genuine approved mock provider adapter is required; " +
        "proof generation refused.",
    );
  }
  const result = await providerAdapter.observeDeployment();
  try {
    assertGenuineMockAcademyResetFreezeProviderResult(
        result,
        reviewedSources,
    );
  } catch {
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
  const reviewedSources =
    validateProviderAdapterReviewedSources(repositoryRoot);
  const providerResult =
    await observeApprovedProviderDeployment(providerAdapter, reviewedSources);
  const providerRuntimeContext = await createValidatedProviderRuntimeContext({
    providerAdapter,
    providerResult,
    repositoryRoot,
  });
  assertRuntimeGitEvidence(evidence, providerRuntimeContext.runtimeGit);
  const proof = buildDeterministicWriteFreezeProof(evidence, {
    providerRuntimeContext,
  });
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
    _dependencies = {},
) {
  parseVerifierArguments(argv);
  throw new Error(
      "CLI has no Production provider adapter; mock proof generation refused.",
  );
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
