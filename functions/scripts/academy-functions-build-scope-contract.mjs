import crypto from "node:crypto";

export const BUILD_SCOPE_CONTRACT_VERSION =
  "academy_functions_build_scope.v1";
export const DEPLOY_PROFILE_VERSION = "academy_functions_deploy.v1";
export const COMPENSATING_CONTROL_VERSION =
  "academy_functions_deploy_compensating_controls.v1";
export const INFRASTRUCTURE_EVIDENCE_VERSION =
  "academy_functions_infrastructure_evidence.v1";
export const ORGANIZATION_POLICY_EVIDENCE_VERSION =
  "academy_functions_organization_policy_evidence.v2";
export const ORGANIZATION_POLICY_LINEAGE_VERSION =
  "academy_functions_organization_policy_lineage.v1";

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function assertCanonicalValue(value, path = "$") {
  if (value === null ||
      typeof value === "string" ||
      typeof value === "boolean") {
    return;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Object.is(value, -0)) {
      throw new Error(`Non-canonical number at ${path}.`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertCanonicalValue(entry, `${path}[${index}]`));
    return;
  }
  if (!isPlainObject(value)) {
    throw new Error(`Non-canonical value at ${path}.`);
  }
  for (const key of Object.keys(value)) {
    if (!key || value[key] === undefined) {
      throw new Error(`Non-canonical field at ${path}.${key}.`);
    }
    assertCanonicalValue(value[key], `${path}.${key}`);
  }
}

function normalizeCanonical(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeCanonical);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
        Object.keys(value)
            .sort()
            .map((key) => [key, normalizeCanonical(value[key])]),
    );
  }
  return value;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

function frozen(value) {
  assertCanonicalValue(value);
  return deepFreeze(value);
}

export function canonicalJson(value) {
  assertCanonicalValue(value);
  return JSON.stringify(normalizeCanonical(value));
}

export function sha256Hex(value) {
  return crypto.createHash("sha256").update(value, "utf8").digest("hex");
}

export function canonicalDigest(value) {
  return sha256Hex(canonicalJson(value));
}

export function canonicalSetDigest(values) {
  if (!Array.isArray(values)) {
    throw new Error("Canonical set digest requires an array.");
  }
  const entries = values.map((value) => canonicalJson(value)).sort();
  if (new Set(entries).size !== entries.length) {
    throw new Error("Canonical set contains a duplicate.");
  }
  return sha256Hex(entries.join("\n"));
}

function exact(actual, expected, label) {
  if (canonicalJson(actual) !== canonicalJson(expected)) {
    throw new Error(`${label} exact canonical invariant failed.`);
  }
}

function exactSet(actual, expected, label) {
  if (!Array.isArray(actual) ||
      canonicalSetDigest(actual) !== canonicalSetDigest(expected)) {
    throw new Error(`${label} exact set invariant failed.`);
  }
}

function uniqueStrings(values, label) {
  if (!Array.isArray(values) ||
      values.some((value) => typeof value !== "string" || !value) ||
      new Set(values).size !== values.length) {
    throw new Error(`${label} must be a unique non-empty string set.`);
  }
}

export const TARGET_PROJECT = frozen({
  projectId: "daegu-miami-production",
  projectNumber: "884850632328",
  region: "us-central1",
  topology: "STANDALONE_PROJECT",
  organization: null,
  folder: null,
});

export const FUNCTIONS_IDENTITIES = frozen({
  dedicatedBuildServiceAccount:
    "academy-functions-build@daegu-miami-production.iam.gserviceaccount.com",
  deployServiceAccount:
    "academy-functions-deployer@daegu-miami-production.iam.gserviceaccount.com",
  googleManagedCloudBuildServiceAgent:
    "service-884850632328@gcp-sa-cloudbuild.iam.gserviceaccount.com",
});

export const APPROVED_SOURCE_BUCKET = frozen({
  resource: "gs://gcf-v2-sources-884850632328-us-central1",
  name: "gcf-v2-sources-884850632328-us-central1",
  ownerProjectNumber: "884850632328",
  location: "US-CENTRAL1",
  storageClass: "STANDARD",
  cmek: "NONE",
});

export const APPROVED_UPLOAD_BUCKET = frozen({
  resource:
    "gs://gcf-v2-uploads-884850632328.us-central1.cloudfunctions.appspot.com",
  name:
    "gcf-v2-uploads-884850632328.us-central1.cloudfunctions.appspot.com",
  ownerProjectNumber: "884850632328",
  location: "US-CENTRAL1",
  storageClass: "STANDARD",
  cmek: "NONE",
});

export const APPROVED_ARTIFACT_REPOSITORY = frozen({
  resource:
    "projects/daegu-miami-production/locations/us-central1/repositories/gcf-artifacts",
  location: "us-central1",
  format: "DOCKER",
  mode: "STANDARD_REPOSITORY",
  cmek: "NONE",
});

export const APPROVED_CLOUD_BUILD_CONFIGURATION = frozen({
  logging: "CLOUD_LOGGING_ONLY",
  logsBucket: null,
  defaultLogsBucketBehavior: "UNSET",
  workerPool: "DEFAULT",
});

export const REQUIRED_API_EVIDENCE = frozen([
  {service: "artifactregistry.googleapis.com", state: "ENABLED"},
  {service: "cloudbuild.googleapis.com", state: "ENABLED"},
  {service: "cloudfunctions.googleapis.com", state: "ENABLED"},
  {service: "eventarc.googleapis.com", state: "ENABLED"},
  {service: "run.googleapis.com", state: "ENABLED"},
]);

export const SERVICE_AGENT_FINDINGS = frozen([
  {
    service: "ARTIFACT_REGISTRY",
    principal:
      "service-884850632328@gcp-sa-artifactregistry.iam.gserviceaccount.com",
    role: "roles/artifactregistry.serviceAgent",
    conditionalBinding: false,
  },
  {
    service: "CLOUD_BUILD",
    principal:
      "service-884850632328@gcp-sa-cloudbuild.iam.gserviceaccount.com",
    role: "roles/cloudbuild.serviceAgent",
    conditionalBinding: false,
  },
  {
    service: "CLOUD_FUNCTIONS",
    principal:
      "service-884850632328@gcf-admin-robot.iam.gserviceaccount.com",
    role: "roles/cloudfunctions.serviceAgent",
    conditionalBinding: false,
  },
  {
    service: "CLOUD_RUN",
    principal:
      "service-884850632328@serverless-robot-prod.iam.gserviceaccount.com",
    role: "roles/run.serviceAgent",
    conditionalBinding: false,
  },
  {
    service: "FIRESTORE",
    principal:
      "service-884850632328@gcp-sa-firestore.iam.gserviceaccount.com",
    role: "roles/firestore.serviceAgent",
    conditionalBinding: false,
  },
]);

const organizationPolicyObservation = {
  contractVersion: ORGANIZATION_POLICY_EVIDENCE_VERSION,
  projectId: "daegu-miami-production",
  service: "orgpolicy.googleapis.com",
  apiEnabled: false,
  observationStatus: "UNKNOWN",
  effectivePolicyCount: null,
  effectiveDecision: "UNKNOWN",
  observationAvailability: "UNAVAILABLE_API_DISABLED",
  actualProvisioningEligible: false,
  deploymentApprovalEligible: false,
  publicInvokerApprovalEligible: false,
  iamMutationCommandPublication: false,
};
export const ORGANIZATION_POLICY_EVIDENCE = frozen({
  ...organizationPolicyObservation,
  evidenceDigest: canonicalDigest(organizationPolicyObservation),
});

export const APPROVED_INFRASTRUCTURE_EVIDENCE = frozen({
  evidenceVersion: INFRASTRUCTURE_EVIDENCE_VERSION,
  project: TARGET_PROJECT,
  sourceBucket: APPROVED_SOURCE_BUCKET,
  uploadBucket: APPROVED_UPLOAD_BUCKET,
  artifactRepository: APPROVED_ARTIFACT_REPOSITORY,
  cloudBuild: APPROVED_CLOUD_BUILD_CONFIGURATION,
  requiredApis: REQUIRED_API_EVIDENCE,
  serviceAgents: SERVICE_AGENT_FINDINGS,
  organizationPolicy: ORGANIZATION_POLICY_EVIDENCE,
});

export const BUILD_CORE_PERMISSIONS = frozen([
  "logging.logEntries.create",
  "logging.logEntries.route",
]);

export const BUILD_CORE_PROFILE = frozen({
  profileId: "academyFunctionsBuildCoreV1",
  role:
    "projects/daegu-miami-production/roles/academyFunctionsBuildCoreV1",
  stage: "GA",
  customRolesSupport: "SUPPORTED_BY_OMISSION",
  permissions: BUILD_CORE_PERMISSIONS,
  permissionCount: 2,
  resource: "projects/daegu-miami-production",
  resourceType: "PROJECT",
});

export const BUILD_RESOURCE_BINDINGS = frozen([
  {
    bindingId: "artifact-repository-writer",
    principal:
      "serviceAccount:" +
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    resource: APPROVED_ARTIFACT_REPOSITORY.resource,
    resourceType: "ARTIFACT_REGISTRY_REPOSITORY",
    role: "roles/artifactregistry.writer",
  },
  {
    bindingId: "source-bucket-object-viewer",
    principal:
      "serviceAccount:" +
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    resource: APPROVED_SOURCE_BUCKET.resource,
    resourceType: "CLOUD_STORAGE_BUCKET",
    role: "roles/storage.objectViewer",
  },
  {
    bindingId: "upload-bucket-object-viewer",
    principal:
      "serviceAccount:" +
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    resource: APPROVED_UPLOAD_BUCKET.resource,
    resourceType: "CLOUD_STORAGE_BUCKET",
    role: "roles/storage.objectViewer",
  },
]);

export const BUILD_SCOPE_CONTRACT = frozen({
  contractVersion: BUILD_SCOPE_CONTRACT_VERSION,
  project: TARGET_PROJECT,
  identity: {
    dedicatedBuildServiceAccount:
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    googleManagedCloudBuildServiceAgent:
      FUNCTIONS_IDENTITIES.googleManagedCloudBuildServiceAgent,
    identitiesAreDistinct: true,
  },
  buildConfiguration: APPROVED_CLOUD_BUILD_CONFIGURATION,
  coreProfile: BUILD_CORE_PROFILE,
  coreBinding: {
    principal:
      "serviceAccount:" +
      FUNCTIONS_IDENTITIES.dedicatedBuildServiceAccount,
    resource: "projects/daegu-miami-production",
    role:
      "projects/daegu-miami-production/roles/academyFunctionsBuildCoreV1",
  },
  resourceBindings: BUILD_RESOURCE_BINDINGS,
  projectWideStorageBindings: [],
  projectWideArtifactRegistryBindings: [],
  additionalLogsBucketBinding: null,
});

export const DEPLOY_PERMISSIONS = frozen([
  "cloudfunctions.functions.create",
  "cloudfunctions.functions.get",
  "cloudfunctions.functions.list",
  "cloudfunctions.functions.sourceCodeSet",
  "cloudfunctions.locations.list",
  "cloudfunctions.operations.get",
  "cloudfunctions.operations.list",
  "resourcemanager.projects.get",
  "serviceusage.services.use",
]);

export const FORBIDDEN_DEPLOY_PERMISSIONS = frozen([
  "cloudfunctions.functions.delete",
  "cloudfunctions.functions.update",
]);

export const FORBIDDEN_DEPLOY_PERMISSION_FAMILIES = frozen([
  "api_enable_disable",
  "broad_owner_editor",
  "custom_role_administration",
  "firestore_auth_mutation",
  "iam_policy_write",
  "scheduler_mutation",
  "service_account_administration",
  "service_account_key_administration",
]);

export const FORBIDDEN_DEPLOY_ROLES = frozen([
  "roles/editor",
  "roles/owner",
]);

export const DEPLOY_PROFILE = frozen({
  profileVersion: DEPLOY_PROFILE_VERSION,
  profileId: "academyFunctionsDeployV1",
  role:
    "projects/daegu-miami-production/roles/academyFunctionsDeployV1",
  principal:
    "serviceAccount:" + FUNCTIONS_IDENTITIES.deployServiceAccount,
  resource: "projects/daegu-miami-production",
  deploymentRegion: "us-central1",
  stage: "GA",
  customRolesSupport: "SUPPORTED_BY_OMISSION",
  permissions: DEPLOY_PERMISSIONS,
  permissionCount: 9,
  forbiddenPermissions: FORBIDDEN_DEPLOY_PERMISSIONS,
  forbiddenPermissionFamilies: FORBIDDEN_DEPLOY_PERMISSION_FAMILIES,
  forbiddenBroadRoles: FORBIDDEN_DEPLOY_ROLES,
});

export const CUSTOM_ROLE_SUPPORT_PERMISSION_NAMES = frozen([
  ...new Set([
    ...BUILD_CORE_PERMISSIONS,
    ...DEPLOY_PERMISSIONS,
    "datastore.databases.get",
    "datastore.entities.create",
    "datastore.entities.get",
    "datastore.entities.list",
    "datastore.entities.update",
  ]),
].sort());

export const CUSTOM_ROLE_SUPPORT_CHECKS = frozen([
  {
    profileId: "academyBackendReadOnly",
    permissions: [
      "datastore.databases.get",
      "datastore.entities.get",
      "datastore.entities.list",
    ],
  },
  {
    profileId: "academyFunctionsBuildCoreV1",
    permissions: BUILD_CORE_PERMISSIONS,
  },
  {
    profileId: "academyFunctionsDeployV1",
    permissions: DEPLOY_PERMISSIONS,
  },
  {
    profileId: "academyPrivateWriterRuntimeV1",
    permissions: [
      "datastore.databases.get",
      "datastore.entities.create",
      "datastore.entities.get",
      "datastore.entities.list",
      "datastore.entities.update",
    ],
  },
]);

export const CUSTOM_ROLE_SUPPORT_EVIDENCE = frozen({
  roleChecks: CUSTOM_ROLE_SUPPORT_CHECKS,
  roleCheckCount: 19,
  uniquePermissions: CUSTOM_ROLE_SUPPORT_PERMISSION_NAMES,
  uniquePermissionCount: 16,
  support: "SUPPORTED_BY_OMISSION",
  stage: "GA",
  missingCount: 0,
  notSupportedCount: 0,
  testingCount: 0,
  deprecatedCount: 0,
  apiDisabledCount: 0,
  onlyInPredefinedRoleCount: 0,
});

export const DEPLOYMENT_TARGETS = frozen([
  {
    sequence: 1,
    phase: "PREVIEW",
    functionName: "previewFixedPrivateLessonOutcomeAction",
    triggerType: "HTTP_CALLABLE",
    initialAccess: "PRIVATE",
  },
  {
    sequence: 2,
    phase: "ASSIGNMENT",
    functionName: "createFixedPrivateLessonAssignment",
    triggerType: "HTTP_CALLABLE",
    initialAccess: "PRIVATE",
  },
  {
    sequence: 3,
    phase: "OUTCOME",
    functionName: "commitFixedPrivateLessonOutcomeAction",
    triggerType: "HTTP_CALLABLE",
    initialAccess: "PRIVATE",
  },
]);

export const EVENTARC_EVIDENCE = frozen({
  apiState: "ENABLED",
  targetContract: DEPLOYMENT_TARGETS,
  eventarcServiceAgentProjectBinding: "ABSENT",
  eventarcServiceAgentBindingRequired: false,
  manualServiceAgentCreationOrBinding: "PROHIBITED",
  acceptedTriggerType: "HTTP_CALLABLE",
  eventTriggerCount: 0,
});

export const IMMUTABLE_RELEASE_EVIDENCE = frozen({
  baseBranch: "product-version",
  releaseSha: "f081bd7765d37db27642f9657bb307b5fb2da414",
  gitTree: "55f98bd0565cdf3ad3b4204a689c653769df3443",
  functionsIndexSha256:
    "754e1f559a28ca1721c5b732ede0acce91dfbb409ada6153de93092d1209db49",
  writerSourceDigest:
    "8f63180960dde64a252f12c68fbe6fed938333d1325514660e0a972b6b06209b",
  selectorLfDigest:
    "cd26a1b992337fc61562663b4f97ce08cd70f062abd6546701ba364f67f8db10",
  existingFunctionBaselineDigest:
    "1cb924fc62c97771d42fb60b98934d9f48e5192abbf0b03b31d06753ff41dcfd",
});

export const DEPLOYMENT_COMPENSATING_CONTROLS = frozen({
  controlVersion: COMPENSATING_CONTROL_VERSION,
  project: "projects/daegu-miami-production",
  region: "us-central1",
  deployProfileId: "academyFunctionsDeployV1",
  immutableRelease: IMMUTABLE_RELEASE_EVIDENCE,
  targets: DEPLOYMENT_TARGETS,
  deploymentAccess: {
    jitRequired: true,
    resource: "projects/daegu-miami-production",
    region: "us-central1",
    maximumDurationSeconds: 7200,
  },
  deploymentMode: {
    ordered: true,
    privateUntilFullValidation: true,
    verificationImmediatelyAfterEachDeployment: true,
    perStepVerification: [
      "CLOUD_FUNCTION",
      "CLOUD_BUILD",
      "CLOUD_RUN",
      "SOURCE_IDENTITY",
    ],
  },
  inventoryGate: {
    existingFunctionCount: 32,
    targetFunctionCount: 3,
    finalFunctionCount: 35,
    finalGen2FunctionCount: 35,
  },
  invokerGate: {
    publicInvokerAllowedOnlyAfterFullValidation: true,
    publicInvokerAppliedBeforeFullValidation: false,
  },
  temporaryAccess: {
    deployBindingRemoved: true,
    impersonationBindingRemoved: true,
  },
  secureAuditArtifact: {
    required: true,
    directoryMode: "0700",
    fileMode: "0600",
  },
});

export const INFRASTRUCTURE_EVIDENCE_DIGEST =
  canonicalDigest(APPROVED_INFRASTRUCTURE_EVIDENCE);
export const BUILD_CORE_PERMISSION_SET_DIGEST =
  canonicalSetDigest(BUILD_CORE_PERMISSIONS);
export const BUILD_RESOURCE_BINDING_SET_DIGEST =
  canonicalSetDigest(BUILD_RESOURCE_BINDINGS);
export const BUILD_SCOPE_CONTRACT_DIGEST =
  canonicalDigest(BUILD_SCOPE_CONTRACT);
export const DEPLOY_PERMISSION_SET_DIGEST =
  canonicalSetDigest(DEPLOY_PERMISSIONS);
export const DEPLOY_PROFILE_DIGEST = canonicalDigest(DEPLOY_PROFILE);
export const CUSTOM_ROLE_SUPPORT_EVIDENCE_DIGEST =
  canonicalDigest(CUSTOM_ROLE_SUPPORT_EVIDENCE);
export const EVENTARC_EVIDENCE_DIGEST =
  canonicalDigest(EVENTARC_EVIDENCE);
export const COMPENSATING_CONTROL_DIGEST =
  canonicalDigest(DEPLOYMENT_COMPENSATING_CONTROLS);

export function validateApprovedInfrastructureEvidence(
    evidence = APPROVED_INFRASTRUCTURE_EVIDENCE,
) {
  exact(
      evidence,
      APPROVED_INFRASTRUCTURE_EVIDENCE,
      "Approved infrastructure evidence",
  );
  if (canonicalDigest(evidence) !== INFRASTRUCTURE_EVIDENCE_DIGEST) {
    throw new Error("Approved infrastructure evidence digest failed.");
  }
  return frozen({
    valid: true,
    digest: INFRASTRUCTURE_EVIDENCE_DIGEST,
  });
}

export function validateServiceAgentFindings(
    findings = SERVICE_AGENT_FINDINGS,
) {
  exactSet(findings, SERVICE_AGENT_FINDINGS, "Service agent findings");
  if (findings.some(({conditionalBinding}) => conditionalBinding !== false)) {
    throw new Error("Conditional service-agent binding is forbidden.");
  }
  return true;
}

export function computeOrganizationPolicyEvidenceDigest(evidence) {
  if (!isPlainObject(evidence)) {
    throw new Error("Organization Policy evidence must be canonical.");
  }
  const {evidenceDigest: ignored, ...projection} = evidence;
  return canonicalDigest(projection);
}

export function buildOrganizationPolicyLineageReference(
    evidence = ORGANIZATION_POLICY_EVIDENCE,
) {
  validateOrganizationPolicyEvidence(evidence);
  return frozen({
    lineageVersion: ORGANIZATION_POLICY_LINEAGE_VERSION,
    organizationPolicyContractVersion: evidence.contractVersion,
    organizationPolicyProjectId: evidence.projectId,
    organizationPolicyEvidenceDigest: evidence.evidenceDigest,
    organizationPolicyApiEnabled: evidence.apiEnabled,
    organizationPolicyObservationStatus: evidence.observationStatus,
    organizationPolicyEffectivePolicyCount: evidence.effectivePolicyCount,
    organizationPolicyEffectiveDecision: evidence.effectiveDecision,
    organizationPolicyObservationAvailability:
      evidence.observationAvailability,
  });
}

export function validateOrganizationPolicyLineageReference(reference) {
  exact(
      reference,
      buildOrganizationPolicyLineageReference(),
      "Organization Policy lineage",
  );
  return true;
}

export function validateOrganizationPolicyEvidence(
    evidence = ORGANIZATION_POLICY_EVIDENCE,
) {
  exact(evidence, ORGANIZATION_POLICY_EVIDENCE, "Organization Policy evidence");
  if (evidence.contractVersion !== ORGANIZATION_POLICY_EVIDENCE_VERSION ||
      evidence.projectId !== "daegu-miami-production" ||
      evidence.observationStatus !== "UNKNOWN" ||
      evidence.apiEnabled !== false ||
      evidence.effectivePolicyCount !== null ||
      evidence.effectiveDecision !== "UNKNOWN" ||
      evidence.observationAvailability !== "UNAVAILABLE_API_DISABLED" ||
      evidence.evidenceDigest !==
        computeOrganizationPolicyEvidenceDigest(evidence) ||
      evidence.actualProvisioningEligible !== false ||
      evidence.deploymentApprovalEligible !== false ||
      evidence.publicInvokerApprovalEligible !== false ||
      evidence.iamMutationCommandPublication !== false) {
    throw new Error("Organization Policy UNKNOWN must fail closed.");
  }
  return frozen({
    observationStatus: "UNKNOWN",
    actualProvisioningEligible: false,
    deploymentApprovalEligible: false,
    publicInvokerApprovalEligible: false,
    iamMutationCommandPublication: false,
  });
}

export function validateCustomRoleSupportEvidence(
    evidence = CUSTOM_ROLE_SUPPORT_EVIDENCE,
) {
  exact(evidence, CUSTOM_ROLE_SUPPORT_EVIDENCE, "Custom-role support evidence");
  const checks = evidence.roleChecks.flatMap(({permissions}) => permissions);
  uniqueStrings(evidence.uniquePermissions, "Unique support permissions");
  const derivedUnique = [...new Set(checks)].sort();
  if (checks.length !== 19 ||
      evidence.roleCheckCount !== checks.length ||
      derivedUnique.length !== 16 ||
      evidence.uniquePermissionCount !== derivedUnique.length ||
      canonicalSetDigest(derivedUnique) !==
        canonicalSetDigest(evidence.uniquePermissions) ||
      evidence.stage !== "GA" ||
      evidence.support !== "SUPPORTED_BY_OMISSION" ||
      [
        evidence.missingCount,
        evidence.notSupportedCount,
        evidence.testingCount,
        evidence.deprecatedCount,
        evidence.apiDisabledCount,
        evidence.onlyInPredefinedRoleCount,
      ].some((count) => count !== 0)) {
    throw new Error("Custom-role support 19/19 invariant failed.");
  }
  return frozen({
    roleCheckCount: 19,
    uniquePermissionCount: 16,
    digest: CUSTOM_ROLE_SUPPORT_EVIDENCE_DIGEST,
  });
}

export function validateBuildScopeContract(
    contract = BUILD_SCOPE_CONTRACT,
) {
  if (!contract || !isPlainObject(contract)) {
    throw new Error("Build scope contract is required.");
  }
  if (contract.identity?.dedicatedBuildServiceAccount ===
      contract.identity?.googleManagedCloudBuildServiceAgent ||
      contract.identity?.identitiesAreDistinct !== true) {
    throw new Error(
        "Dedicated Build identity must differ from Cloud Build service agent.",
    );
  }
  if (contract.projectWideStorageBindings?.length !== 0) {
    throw new Error("Project-wide Storage binding is forbidden.");
  }
  if (contract.projectWideArtifactRegistryBindings?.length !== 0) {
    throw new Error("Project-wide Artifact Registry binding is forbidden.");
  }
  if (contract.additionalLogsBucketBinding !== null) {
    throw new Error("Additional logs bucket binding is forbidden.");
  }
  uniqueStrings(contract.coreProfile?.permissions, "Build Core permissions");
  if (contract.coreProfile.permissionCount !==
      contract.coreProfile.permissions.length ||
      canonicalSetDigest(contract.coreProfile.permissions) !==
        BUILD_CORE_PERMISSION_SET_DIGEST) {
    throw new Error("Build Core exact permission invariant failed.");
  }
  exactSet(
      contract.resourceBindings,
      BUILD_RESOURCE_BINDINGS,
      "Build resource bindings",
  );
  exact(contract, BUILD_SCOPE_CONTRACT, "Build scope contract");
  if (canonicalDigest(contract) !== BUILD_SCOPE_CONTRACT_DIGEST) {
    throw new Error("Build scope contract digest failed.");
  }
  return frozen({
    valid: true,
    contractDigest: BUILD_SCOPE_CONTRACT_DIGEST,
    corePermissionSetDigest: BUILD_CORE_PERMISSION_SET_DIGEST,
    resourceBindingSetDigest: BUILD_RESOURCE_BINDING_SET_DIGEST,
  });
}

export function validateDeployProfile(profile = DEPLOY_PROFILE) {
  if (!profile || !isPlainObject(profile)) {
    throw new Error("Deploy profile is required.");
  }
  uniqueStrings(profile.permissions, "Deploy permissions");
  if (profile.permissionCount !== profile.permissions.length ||
      profile.permissions.length !== 9 ||
      canonicalSetDigest(profile.permissions) !==
        DEPLOY_PERMISSION_SET_DIGEST) {
    throw new Error("Deploy exact 9-permission invariant failed.");
  }
  const forbiddenPrefixes = [
    "cloudscheduler.",
    "firebaseauth.",
    "iam.roles.",
    "iam.serviceAccountKeys.",
    "iam.serviceAccounts.",
    "resourcemanager.projects.setIamPolicy",
    "serviceusage.services.disable",
    "serviceusage.services.enable",
  ];
  if (profile.permissions.some((permission) =>
    FORBIDDEN_DEPLOY_PERMISSIONS.includes(permission) ||
    forbiddenPrefixes.some((prefix) => permission.startsWith(prefix)))) {
    throw new Error("Deploy profile contains a forbidden permission.");
  }
  exact(profile, DEPLOY_PROFILE, "Deploy profile");
  if (canonicalDigest(profile) !== DEPLOY_PROFILE_DIGEST) {
    throw new Error("Deploy profile digest failed.");
  }
  return frozen({
    valid: true,
    profileDigest: DEPLOY_PROFILE_DIGEST,
    permissionSetDigest: DEPLOY_PERMISSION_SET_DIGEST,
  });
}

export function validateEventarcEvidence(evidence = EVENTARC_EVIDENCE) {
  if (evidence?.eventTriggerCount !== 0 ||
      evidence?.targetContract?.some((target) =>
        target.triggerType !== "HTTP_CALLABLE" ||
        Object.hasOwn(target, "eventTrigger")) ||
      evidence?.eventarcServiceAgentProjectBinding !== "ABSENT" ||
      evidence?.eventarcServiceAgentBindingRequired !== false) {
    throw new Error("Eventarc is valid only for exact HTTP callable targets.");
  }
  exact(evidence, EVENTARC_EVIDENCE, "Eventarc evidence");
  return frozen({
    valid: true,
    digest: EVENTARC_EVIDENCE_DIGEST,
  });
}

export function validateCompensatingControls(
    controls = DEPLOYMENT_COMPENSATING_CONTROLS,
    claimedDigest = COMPENSATING_CONTROL_DIGEST,
) {
  if (!controls || !isPlainObject(controls)) {
    throw new Error("Deployment compensating controls are required.");
  }
  const targets = controls.targets;
  if (!Array.isArray(targets) ||
      targets.length !== DEPLOYMENT_TARGETS.length ||
      targets.some((target, index) =>
        target.sequence !== index + 1 ||
        target.triggerType !== "HTTP_CALLABLE" ||
        target.initialAccess !== "PRIVATE")) {
    throw new Error("Private deployment order invariant failed.");
  }
  exact(targets, DEPLOYMENT_TARGETS, "Deployment targets");
  exact(
      controls.immutableRelease,
      IMMUTABLE_RELEASE_EVIDENCE,
      "Immutable release evidence",
  );
  exact(
      controls.deploymentMode.perStepVerification,
      DEPLOYMENT_COMPENSATING_CONTROLS.deploymentMode.perStepVerification,
      "Per-step verification",
  );
  if (controls.deploymentAccess.jitRequired !== true ||
      controls.deploymentAccess.resource !==
        "projects/daegu-miami-production" ||
      controls.deploymentAccess.region !== "us-central1" ||
      controls.deploymentAccess.maximumDurationSeconds !== 7200 ||
      controls.deploymentMode.ordered !== true ||
      controls.deploymentMode.privateUntilFullValidation !== true ||
      controls.deploymentMode.verificationImmediatelyAfterEachDeployment !==
        true ||
      controls.inventoryGate.existingFunctionCount !== 32 ||
      controls.inventoryGate.targetFunctionCount !== targets.length ||
      controls.inventoryGate.finalFunctionCount !== 35 ||
      controls.inventoryGate.finalGen2FunctionCount !== 35 ||
      controls.invokerGate.publicInvokerAllowedOnlyAfterFullValidation !==
        true ||
      controls.invokerGate.publicInvokerAppliedBeforeFullValidation !== false ||
      controls.temporaryAccess.deployBindingRemoved !== true ||
      controls.temporaryAccess.impersonationBindingRemoved !== true ||
      controls.secureAuditArtifact.required !== true ||
      controls.secureAuditArtifact.directoryMode !== "0700" ||
      controls.secureAuditArtifact.fileMode !== "0600") {
    throw new Error("Deployment compensating-control gate failed.");
  }
  exact(
      controls,
      DEPLOYMENT_COMPENSATING_CONTROLS,
      "Deployment compensating controls",
  );
  if (claimedDigest !== COMPENSATING_CONTROL_DIGEST ||
      canonicalDigest(controls) !== COMPENSATING_CONTROL_DIGEST) {
    throw new Error("Compensating-control digest invariant failed.");
  }
  return frozen({
    valid: true,
    digest: COMPENSATING_CONTROL_DIGEST,
    finalInventory: "35/35",
  });
}

export function validateFunctionsBuildAndDeployContract(input = {}) {
  const evidence =
    input.infrastructureEvidence ?? APPROVED_INFRASTRUCTURE_EVIDENCE;
  const buildScope = input.buildScope ?? BUILD_SCOPE_CONTRACT;
  const deployProfile = input.deployProfile ?? DEPLOY_PROFILE;
  const eventarcEvidence = input.eventarcEvidence ?? EVENTARC_EVIDENCE;
  const supportEvidence =
    input.customRoleSupportEvidence ?? CUSTOM_ROLE_SUPPORT_EVIDENCE;
  const organizationPolicy =
    input.organizationPolicy ?? ORGANIZATION_POLICY_EVIDENCE;
  const controls =
    input.compensatingControls ?? DEPLOYMENT_COMPENSATING_CONTROLS;
  const claimedControlDigest =
    input.compensatingControlDigest ?? COMPENSATING_CONTROL_DIGEST;

  validateApprovedInfrastructureEvidence(evidence);
  validateBuildScopeContract(buildScope);
  validateDeployProfile(deployProfile);
  validateEventarcEvidence(eventarcEvidence);
  validateServiceAgentFindings(evidence.serviceAgents);
  validateCustomRoleSupportEvidence(supportEvidence);
  const organizationPolicyResult =
    validateOrganizationPolicyEvidence(organizationPolicy);
  validateCompensatingControls(controls, claimedControlDigest);

  return frozen({
    validLocalContract: true,
    actualProvisioningEligible:
      organizationPolicyResult.actualProvisioningEligible,
    deploymentApprovalEligible:
      organizationPolicyResult.deploymentApprovalEligible,
    publicInvokerApprovalEligible:
      organizationPolicyResult.publicInvokerApprovalEligible,
    iamMutationCommandPublication:
      organizationPolicyResult.iamMutationCommandPublication,
    buildScopeContractDigest: BUILD_SCOPE_CONTRACT_DIGEST,
    deployProfileDigest: DEPLOY_PROFILE_DIGEST,
    compensatingControlDigest: COMPENSATING_CONTROL_DIGEST,
  });
}

export const assertApprovedInfrastructureEvidence =
  validateApprovedInfrastructureEvidence;
export const assertBuildScopeContract = validateBuildScopeContract;
export const assertDeployProfile = validateDeployProfile;
export const assertCompensatingControls = validateCompensatingControls;

validateFunctionsBuildAndDeployContract();
