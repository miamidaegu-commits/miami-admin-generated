const providerRuntimeContexts = new WeakSet();

export async function createValidatedProviderRuntimeContext({
  providerAdapter,
  providerResult,
  repositoryRoot,
}) {
  const {
    resolveRuntimeGitSourceIdentity,
    validateProviderAdapterReviewedSources,
  } = await import("./academy-reset-freeze-runtime-identity.mjs");
  const {
    assertGenuineMockAcademyResetFreezeProviderAdapter,
    assertGenuineMockAcademyResetFreezeProviderResult,
  } = await import("./academy-reset-freeze-provider-adapter.mjs");
  const reviewedSources =
    validateProviderAdapterReviewedSources(repositoryRoot);
  const runtimeGit = resolveRuntimeGitSourceIdentity({
    repositoryRoot: reviewedSources.repositoryRoot,
  });
  assertGenuineMockAcademyResetFreezeProviderAdapter(
      providerAdapter,
      reviewedSources,
  );
  assertGenuineMockAcademyResetFreezeProviderResult(
      providerResult,
      reviewedSources,
      providerAdapter,
  );
  const rootDigest = reviewedSources.repositoryRootDigest;
  if (providerResult.metadata.reviewedSourceRepositoryRootDigest !==
        rootDigest ||
      providerResult.observation.operationExecution
          .reviewedSourceRepositoryRootDigest !== rootDigest ||
      providerResult.observation.dependencyContract
          .reviewedSourceRepositoryRootDigest !== rootDigest ||
      providerResult.approvalReceipt.providerDependencyApproval
          .reviewedSourceRepositoryRootDigest !== rootDigest) {
    throw new Error("Provider runtime source root binding mismatch.");
  }
  const context = Object.freeze({
    providerResult,
    repositoryRoot: reviewedSources.repositoryRoot,
    headSha: runtimeGit.headSha,
    treeSha: runtimeGit.treeSha,
    criticalSourceSetDigest: runtimeGit.criticalSourceSetDigest,
    reviewedSourceDigest: reviewedSources.aggregateDigest,
    reviewedSourceRepositoryRootDigest: rootDigest,
    reviewedSourceSetDigest: runtimeGit.reviewedSourceSetDigest,
    iamContractSourceIdentity: runtimeGit.iamContractSourceIdentity,
    iamContractSourceSetDigest: runtimeGit.iamContractSourceSetDigest,
    runtimeGit,
  });
  providerRuntimeContexts.add(context);
  return context;
}

export function assertValidatedProviderRuntimeContext(context) {
  if (!providerRuntimeContexts.has(context)) {
    throw new Error("Genuine provider runtime context is required.");
  }
  return true;
}
