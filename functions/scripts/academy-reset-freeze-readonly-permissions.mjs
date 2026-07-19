import crypto from "node:crypto";

import {
  computeProviderOperationIdSetDigest,
  PROVIDER_MANDATORY_OPERATION_IDS,
  PROVIDER_MANDATORY_OPERATION_IDS_DIGEST as
    PROVIDER_MANDATORY_OPERATION_SET_DIGEST,
  PROVIDER_OPERATION_CLASSIFICATION_VERSION,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST as
    PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_SET_DIGEST,
  PROVIDER_TARGET_PROJECT_ID,
  PROVIDER_TARGET_PROJECT_NUMBER,
} from "./academy-reset-freeze-provider-operations.mjs";

export const READONLY_PERMISSION_MANIFEST_VERSION =
  "academy_reset_freeze_readonly_permissions.v2";
export const OBSERVER_TOPOLOGY_PROFILE_VERSION =
  "academy_reset_observer_topology_profile.v3";
export const OBSERVER_OPERATION_EXECUTION_PROFILE_VERSION =
  "academy_reset_observer_operation_execution.v3";
export const OBSERVER_PERMISSION_PROFILE_VERSION =
  "academy_reset_observer_permission_profile.v2";
export const STANDALONE_PROJECT_TOPOLOGY_PROFILE_ID =
  "standalone_project_v1";
export const STANDALONE_SOURCE_BUCKET_NAME =
  "gcf-v2-sources-884850632328-us-central1";
export const OBSERVER_PRINCIPAL_POLICY_VERSION =
  "academy_reset_observer_principal.v1";
export const OBSERVER_SERVICE_ACCOUNT_ID =
  "academy-reset-freeze-observer";
export const OBSERVER_SERVICE_ACCOUNT_EMAIL =
  "academy-reset-freeze-observer@daegu-miami-production.iam.gserviceaccount.com";
export const OBSERVER_SERVICE_ACCOUNT_MEMBER =
  `serviceAccount:${OBSERVER_SERVICE_ACCOUNT_EMAIL}`;
export const STANDALONE_NOT_APPLICABLE_MANDATORY_OPERATION_IDS =
  Object.freeze([
    "cloudresourcemanager.v3.folders.get",
    "cloudresourcemanager.v3.folders.getIamPolicy",
    "cloudresourcemanager.v3.organizations.get",
    "cloudresourcemanager.v3.organizations.getIamPolicy",
  ]);
export const EVIDENCE_DERIVED_NOT_APPLICABLE_MANDATORY_OPERATION_IDS =
  Object.freeze([
    "iam.v2.policies.denypolicies.get",
  ]);
export const STANDALONE_REQUIRED_IAM_PERMISSIONS = Object.freeze([
  "cloudasset.assets.analyzeIamPolicy",
  "cloudasset.assets.searchAllIamPolicies",
  "cloudasset.assets.searchAllResources",
  "cloudbuild.builds.get",
  "cloudfunctions.functions.get",
  "cloudfunctions.functions.list",
  "cloudscheduler.jobs.get",
  "cloudscheduler.jobs.list",
  "firebaserules.releases.get",
  "firebaserules.rulesets.get",
  "iam.denypolicies.get",
  "iam.denypolicies.list",
  "iam.roles.get",
  "iam.roles.list",
  "iam.serviceAccounts.get",
  "iam.serviceAccounts.getIamPolicy",
  "iam.serviceAccounts.list",
  "resourcemanager.projects.get",
  "resourcemanager.projects.getIamPolicy",
  "run.revisions.get",
  "run.revisions.list",
  "run.services.get",
  "run.services.list",
  "serviceusage.services.get",
  "storage.buckets.get",
  "storage.objects.get",
]);
export const STANDALONE_AUXILIARY_IAM_PERMISSIONS = Object.freeze([
  "serviceusage.services.use",
]);
export const STANDALONE_EXCLUDED_ROLE_PERMISSIONS = Object.freeze([
  "groups.read",
  "resourcemanager.folders.get",
  "resourcemanager.folders.getIamPolicy",
  "resourcemanager.organizations.get",
  "resourcemanager.organizations.getIamPolicy",
  "storage.objects.getIamPolicy",
]);
export const PERMISSION_RESEARCH_ARTIFACT_SHA256 =
  "92c38c6007050d5427fafb8a4d09c8963592f492e7bc29345281055ed64be704";
export const REVIEWED_EVIDENCE_SET_DIGEST =
  "9b72f1f8be2800b93174d500a1b5e60d950e7748168c38ce2ca02ca666aeb301";
export const EXISTING_23_REVIEWED_RECORDS_DIGEST =
  "d276ef746d76db655dcd4d875a6a493d755d9940ab342ff631e576ca8ab76f51";
export const OFFICIAL_EVIDENCE_SET_DIGEST =
  "8f3b4b2797483f4581a3cd0e58c66efa54b4726470bfcc2bfa5c2989085d3e80";
export const EXPECTED_READONLY_PERMISSION_MANIFEST_DIGEST =
  "73cb701e479a2dc63996ad71c278ddc2b68df3cebcb04ba77cbc609e3de8679a";
export const EXPECTED_EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST =
  "957f28b97f279a58f43ad7e4b4b4e74d90610a4329753f92159aff6e6e4b57c2";

const RECORD_KEYS = Object.freeze([
  "apiFamily",
  "auxiliaryPermissions",
  "conditionalPermissions",
  "evidenceStatus",
  "httpMethod",
  "notes",
  "oauthScopes",
  "observationRequirement",
  "officialEvidence",
  "officialMethodName",
  "operationId",
  "permissionSemantics",
  "requiredIamPermissions",
  "resourceScope",
  "reviewedContentDigest",
].sort());
const OFFICIAL_EVIDENCE_KEYS = Object.freeze([
  "accessedAt",
  "evidenceType",
  "title",
  "url",
].sort());
const OFFICIAL_HOST_ALLOWLIST = Object.freeze([
  "cloud.google.com",
  "docs.cloud.google.com",
  "firebase.google.com",
  "policytroubleshooter.googleapis.com",
  "www.googleapis.com",
]);
const EXPLICIT_IAM_AUTHORIZATION_EVIDENCE_TYPES = Object.freeze([
  "iam_permissions_reference",
  "official_iam_permission_reference",
  "role_reference",
]);
const PERMISSION_CATEGORIES = Object.freeze([
  "requiredIamPermissions",
  "conditionalPermissions",
  "auxiliaryPermissions",
]);

function canonical(value) {
  if (value === undefined) throw new Error("undefined is not canonical");
  if (value === null || typeof value !== "object") {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error("uncanonical value");
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(
      typeof value === "string" ? value : canonical(value),
  ).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  for (const key of Reflect.ownKeys(value)) deepFreeze(value[key]);
  return Object.freeze(value);
}

function same(left, right) {
  return canonical(left) === canonical(right);
}

function assertOwnDataObject(value, label, prototype = Object.prototype) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== prototype) {
    throw new Error(`${label} has an unapproved prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.some((key) => typeof key !== "string")) {
    throw new Error(`${label} contains a symbol key`);
  }
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) {
      throw new Error(`${label}.${key} is not an enumerable data property`);
    }
  }
  return keys;
}

function assertFrozenCanonicalValue(value, label) {
  if (value === null || ["string", "boolean"].includes(typeof value)) return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${label} is not finite`);
    return;
  }
  if (typeof value === "undefined") throw new Error(`${label} is undefined`);
  if (Array.isArray(value)) {
    if (!Object.isFrozen(value) ||
        Object.getPrototypeOf(value) !== Array.prototype) {
      throw new Error(`${label} is not a frozen standard array`);
    }
    const actualKeys = Reflect.ownKeys(value).sort();
    const expectedKeys = [
      ...Array.from({length: value.length}, (_, index) => String(index)),
      "length",
    ].sort();
    if (!same(actualKeys, expectedKeys)) {
      throw new Error(`${label} is sparse or has custom keys`);
    }
    value.forEach((item, index) =>
      assertFrozenCanonicalValue(item, `${label}[${index}]`));
    return;
  }
  const keys = assertOwnDataObject(value, label);
  if (!Object.isFrozen(value)) throw new Error(`${label} is not frozen`);
  keys.forEach((key) =>
    assertFrozenCanonicalValue(value[key], `${label}.${key}`));
}

function assertExactKeys(value, expectedKeys, label, prototype) {
  const keys = assertOwnDataObject(value, label, prototype);
  if (!same([...keys].sort(), [...expectedKeys].sort())) {
    throw new Error(`${label} exact keyset mismatch`);
  }
}

function assertSortedUniqueStrings(values, label, {allowEmpty = true} = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) ||
      values.some((value) => typeof value !== "string" || value.length === 0) ||
      !same(values, [...new Set(values)].sort())) {
    throw new Error(`${label} must be a sorted unique string set`);
  }
}

function assertUniqueStrings(values, label, {allowEmpty = true} = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0) ||
      values.some((value) => typeof value !== "string" || value.length === 0) ||
      new Set(values).size !== values.length) {
    throw new Error(`${label} must be a unique string list`);
  }
}

export function convertPermissionRecordToReviewedEvidence(record) {
  return {
    operationId: record.operationId,
    apiFamily: record.apiFamily,
    httpMethod: record.httpMethod,
    officialMethodName: record.officialMethodName,
    resourceScope: record.resourceScope,
    requiredIamPermissions: [...record.requiredIamPermissions],
    permissionSemantics: record.permissionSemantics,
    conditionalPermissions: [...record.conditionalPermissions],
    auxiliaryPermissions: [...record.auxiliaryPermissions],
    oauthScopes: [...record.oauthScopes],
    officialSources: record.officialEvidence.map((evidence) => ({
      documentTitle: evidence.title,
      officialUrl: evidence.url,
      evidenceType: evidence.evidenceType,
      accessedAt: evidence.accessedAt,
    })),
    status: record.evidenceStatus,
    notes: record.notes,
  };
}

const EMBEDDED_REVIEWED_EVIDENCE = JSON.parse(String.raw`[{"operationId":"cloudasset.v1.projects.analyzeIamPolicy","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["cloudasset.assets.analyzeIamPolicy","cloudasset.assets.searchAllIamPolicies","cloudasset.assets.searchAllResources"],"conditionalPermissions":["iam.roles.get"],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{PROJECT_ID_OR_NUMBER}; official template {analysisQuery.scope=*/*}","officialEvidence":[{"title":"Method: analyzeIamPolicy","url":"https://docs.cloud.google.com/asset-inventory/docs/reference/rest/v1/TopLevel/analyzeIamPolicy","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Roles and permissions","url":"https://cloud.google.com/asset-inventory/docs/roles-permissions","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"},{"title":"Cloud Asset Inventory audit logging","url":"https://cloud.google.com/asset-inventory/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"Under the selected method-authorization evidence policy, the official Cloud Asset Roles and permissions REST table is authoritative and requires all three permissions: cloudasset.assets.analyzeIamPolicy, cloudasset.assets.searchAllIamPolicies, and cloudasset.assets.searchAllResources. serviceusage.services.use is auxiliary. iam.roles.get is conditional when custom roles are expanded. Google Workspace/group visibility is a separate capability and result-completeness concern, not an unresolved method-authorization gate; fullyExplored and analysisState must still be checked for partial results.","apiFamily":"Cloud Asset Inventory v1","httpMethod":"GET","officialMethodName":"google.cloud.asset.v1.AssetService.AnalyzeIamPolicy","reviewedContentDigest":"eea6dbb1b773e128058eae549e5c6a96f9c595dbcffc0419520366e54c51fe70"},{"operationId":"cloudbuild.v1.projects.locations.builds.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["cloudbuild.builds.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project}/locations/{location}/builds/{build}","officialEvidence":[{"title":"Method: projects.locations.builds.get","url":"https://cloud.google.com/build/docs/api/reference/rest/v1/projects.locations.builds/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Configuring access to Cloud Build resources","url":"https://docs.cloud.google.com/build/docs/securing-builds/configure-access-to-resources","evidenceType":"role_reference","accessedAt":"2026-07-17"}],"notes":"serviceusage.services.use is conditional only for the documented gcloud builds context when the caller otherwise has the viewer/editor role; it is not established as an additional raw REST builds.get permission. The regional path must be used for regional builds.","apiFamily":"Cloud Build v1","httpMethod":"GET","officialMethodName":"projects.locations.builds.get","reviewedContentDigest":"bd982cb35517206d423f255d5e8190c04e8362cff89592e47bd9fe569b09e13e"},{"operationId":"cloudfunctions.v2.projects.locations.functions.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["cloudfunctions.functions.get"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project}/locations/{location}/functions/{function}","officialEvidence":[{"title":"Method: projects.locations.functions.get","url":"https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/get","evidenceType":"rest_method","accessedAt":"2026-07-17"}],"notes":"The permission is checked on the named function. No location wildcard is documented for get.","apiFamily":"Cloud Functions v2","httpMethod":"GET","officialMethodName":"projects.locations.functions.get","reviewedContentDigest":"61fee1630c1719a8980ea5a1239b2c3bf6b0858c7df164712d600c5cdeffde34"},{"operationId":"cloudfunctions.v2.projects.locations.functions.list","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["cloudfunctions.functions.list"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project}/locations/{location}","officialEvidence":[{"title":"Method: projects.locations.functions.list","url":"https://cloud.google.com/functions/docs/reference/rest/v2/projects.locations.functions/list","evidenceType":"rest_method","accessedAt":"2026-07-17"}],"notes":"The permission is checked on parent. locations/- is supported; unreachable locations can be returned separately, with no additional location-specific IAM permission documented.","apiFamily":"Cloud Functions v2","httpMethod":"GET","officialMethodName":"projects.locations.functions.list","reviewedContentDigest":"23867afe28a21a18632cce803cf84bf730ff4bd3bded792a651f226f5b500b67"},{"operationId":"cloudresourcemanager.v3.folders.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["resourcemanager.folders.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloudplatformfolders","https://www.googleapis.com/auth/cloudplatformfolders.readonly"],"resourceScope":"folders/{folder_id}","officialEvidence":[{"title":"Method: folders.get","url":"https://docs.cloud.google.com/resource-manager/reference/rest/v3/folders/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Resource Manager API v3 Discovery document","url":"https://www.googleapis.com/discovery/v1/apis/cloudresourcemanager/v3/rest","evidenceType":"api_discovery","accessedAt":"2026-07-17"}],"notes":"serviceusage.services.use is conditional only when a separate quota/billing project is supplied through $userProject or X-Goog-User-Project.","apiFamily":"Cloud Resource Manager v3","httpMethod":"GET","officialMethodName":"folders.get","reviewedContentDigest":"aec3f95e5020e6aced16d6bdccd55f5a8351ba316ffddaa4a39aadf2871d1b6e"},{"operationId":"cloudresourcemanager.v3.folders.getIamPolicy","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["resourcemanager.folders.getIamPolicy"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloudplatformfolders","https://www.googleapis.com/auth/cloudplatformfolders.readonly"],"resourceScope":"folders/{folder_id}","officialEvidence":[{"title":"Method: folders.getIamPolicy","url":"https://docs.cloud.google.com/resource-manager/reference/rest/v3/folders/getIamPolicy","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Resource Manager API v3 Discovery document","url":"https://www.googleapis.com/discovery/v1/apis/cloudresourcemanager/v3/rest","evidenceType":"api_discovery","accessedAt":"2026-07-17"}],"notes":"This POST returns the allow policy and is semantically read-only. requestedPolicyVersion=3 has no separately documented IAM permission. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"Cloud Resource Manager v3","httpMethod":"POST","officialMethodName":"folders.getIamPolicy","reviewedContentDigest":"4062531ab7c536033aa9f0578526239a02f50db4c251eb34cba9d87522675f74"},{"operationId":"cloudresourcemanager.v3.organizations.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["resourcemanager.organizations.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloudplatformorganizations","https://www.googleapis.com/auth/cloudplatformorganizations.readonly"],"resourceScope":"organizations/{organization_id}","officialEvidence":[{"title":"Method: organizations.get","url":"https://docs.cloud.google.com/resource-manager/reference/rest/v3/organizations/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Access control for organization resources with IAM","url":"https://docs.cloud.google.com/resource-manager/docs/access-control-org","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"},{"title":"IAM roles and permissions for Resource Manager","url":"https://cloud.google.com/iam/docs/roles-permissions/resourcemanager","evidenceType":"official_iam_permission_reference","accessedAt":"2026-07-17"}],"notes":"The v3 REST method page exposes OAuth scopes and method identity but does not state the explicit IAM permission string. Under the revised evidence policy, the official Resource Manager IAM roles and permissions reference establishing resourcemanager.organizations.get, together with the official v3 REST method identity, is sufficient. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"Cloud Resource Manager v3","httpMethod":"GET","officialMethodName":"organizations.get","reviewedContentDigest":"71ab3fbd18e5130b965d3aaca8a9391f5eb39fd2273abcb6ab0b4f87a93c4216"},{"operationId":"cloudresourcemanager.v3.organizations.getIamPolicy","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["resourcemanager.organizations.getIamPolicy"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloudplatformorganizations","https://www.googleapis.com/auth/cloudplatformorganizations.readonly"],"resourceScope":"organizations/{organization_id}","officialEvidence":[{"title":"Method: organizations.getIamPolicy","url":"https://docs.cloud.google.com/resource-manager/reference/rest/v3/organizations/getIamPolicy","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Resource Manager API v3 Discovery document","url":"https://www.googleapis.com/discovery/v1/apis/cloudresourcemanager/v3/rest","evidenceType":"api_discovery","accessedAt":"2026-07-17"}],"notes":"This POST returns the allow policy and is semantically read-only. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"Cloud Resource Manager v3","httpMethod":"POST","officialMethodName":"organizations.getIamPolicy","reviewedContentDigest":"5763f0debbb5a7ba4ff8420dba1d2b850563515d5f6f45b73789170a39c86766"},{"operationId":"cloudresourcemanager.v3.projects.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["resourcemanager.projects.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloudplatformprojects","https://www.googleapis.com/auth/cloudplatformprojects.readonly"],"resourceScope":"projects/{project_id_or_number}","officialEvidence":[{"title":"Method: projects.get","url":"https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Resource Manager API v3 Discovery document","url":"https://www.googleapis.com/discovery/v1/apis/cloudresourcemanager/v3/rest","evidenceType":"api_discovery","accessedAt":"2026-07-17"}],"notes":"serviceusage.services.use is conditional only when a separate quota/billing project is selected.","apiFamily":"Cloud Resource Manager v3","httpMethod":"GET","officialMethodName":"projects.get","reviewedContentDigest":"504a4b5ec2edca6abb5eb30a1f24abca4cd8a22de62cf1375336f6dfa54c4d45"},{"operationId":"cloudresourcemanager.v3.projects.getIamPolicy","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["resourcemanager.projects.getIamPolicy"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloudplatformprojects","https://www.googleapis.com/auth/cloudplatformprojects.readonly"],"resourceScope":"projects/{project_id_or_number}","officialEvidence":[{"title":"Method: projects.getIamPolicy","url":"https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/getIamPolicy","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Access control for projects with IAM","url":"https://cloud.google.com/resource-manager/docs/access-control-proj","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"},{"title":"IAM roles and permissions for Resource Manager","url":"https://cloud.google.com/iam/docs/roles-permissions/resourcemanager","evidenceType":"official_iam_permission_reference","accessedAt":"2026-07-17"}],"notes":"The v3 REST method page exposes OAuth scopes and method identity but does not state the explicit IAM permission string. Under the revised evidence policy, the official Resource Manager IAM roles and permissions reference establishing resourcemanager.projects.getIamPolicy, together with the official v3 REST method identity, is sufficient. The POST is semantically read-only. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"Cloud Resource Manager v3","httpMethod":"POST","officialMethodName":"projects.getIamPolicy","reviewedContentDigest":"91f8a849f2f3a4b81b8db5f45a125ba5c33c0a41518becf65ac009c418bac1da"},{"operationId":"cloudscheduler.v1.projects.locations.jobs.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["cloudscheduler.jobs.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-scheduler"],"resourceScope":"projects/{project}/locations/{location}/jobs/{job}","officialEvidence":[{"title":"Method: projects.locations.jobs.get","url":"https://cloud.google.com/scheduler/docs/reference/rest/v1/projects.locations.jobs/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Access control with IAM — Cloud Scheduler","url":"https://cloud.google.com/scheduler/docs/access-control","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"serviceusage.services.use is conditional only when a quota/billing project is explicitly used; it is not the job-read permission.","apiFamily":"Cloud Scheduler v1","httpMethod":"GET","officialMethodName":"projects.locations.jobs.get","reviewedContentDigest":"0d3f22576a8a082c1e2083257dfbf9453e4548b5e428f5bef30273fb2e191ab0"},{"operationId":"cloudscheduler.v1.projects.locations.jobs.list","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["cloudscheduler.jobs.list"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/cloud-scheduler"],"resourceScope":"projects/{project}/locations/{location}","officialEvidence":[{"title":"Method: projects.locations.jobs.list","url":"https://docs.cloud.google.com/scheduler/docs/reference/rest/v1/projects.locations.jobs/list","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Access control with IAM — Cloud Scheduler","url":"https://cloud.google.com/scheduler/docs/access-control","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"jobs.list is distinct from jobs.get. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"Cloud Scheduler v1","httpMethod":"GET","officialMethodName":"projects.locations.jobs.list","reviewedContentDigest":"ac466590e339771468c6c6ab51773e2d8d2d18edeafd3c10796989cec085831d"},{"operationId":"firebaserules.v1.projects.releases.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["firebaserules.releases.get"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/firebase","https://www.googleapis.com/auth/firebase.readonly"],"resourceScope":"projects/{project_id}/releases/{release_id}","officialEvidence":[{"title":"Method: projects.releases.get","url":"https://firebase.google.com/docs/reference/rules/rest/v1/projects.releases/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Audit logging for Firebase Security Rules","url":"https://firebase.google.com/support/guides/cloud-audit-logging/firebase-rules","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"The REST page establishes the method and OAuth scopes; the official audit-log mapping directly connects FirebaseRulesService.GetRelease to firebaserules.releases.get.","apiFamily":"Firebase Rules v1","httpMethod":"GET","officialMethodName":"projects.releases.get","reviewedContentDigest":"0829dc6373b605df54505e135156184e4d028d1e9046fe8ac0b20056acee7641"},{"operationId":"firebaserules.v1.projects.rulesets.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["firebaserules.rulesets.get"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/firebase","https://www.googleapis.com/auth/firebase.readonly"],"resourceScope":"projects/{project_id}/rulesets/{ruleset_id}","officialEvidence":[{"title":"Method: projects.rulesets.get","url":"https://firebase.google.com/docs/reference/rules/rest/v1/projects.rulesets/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Audit logging for Firebase Security Rules","url":"https://firebase.google.com/support/guides/cloud-audit-logging/firebase-rules","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"The official audit-log mapping directly connects FirebaseRulesService.GetRuleset to firebaserules.rulesets.get; this is distinct from releases.get.","apiFamily":"Firebase Rules v1","httpMethod":"GET","officialMethodName":"projects.rulesets.get","reviewedContentDigest":"d15ae4dfd72bbdb376df355ff198c062c3cb91da7a057c3e973b408f85cd64e0"},{"operationId":"iam.v1.projects.roles.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["iam.roles.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/iam","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project_id}/roles/{custom_role_id}","officialEvidence":[{"title":"Method: projects.roles.get","url":"https://cloud.google.com/iam/docs/reference/rest/v1/projects.roles/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Identity and Access Management audit logging","url":"https://cloud.google.com/iam/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"This retrieves one project-level custom role. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"IAM v1","httpMethod":"GET","officialMethodName":"projects.roles.get","reviewedContentDigest":"60c975835bf149762958c61c2ab114f796ba5d3dbcaf3057bb97fdc8bcf4a556"},{"operationId":"iam.v1.projects.roles.list","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["iam.roles.list"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/iam","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project_id}","officialEvidence":[{"title":"Method: projects.roles.list","url":"https://cloud.google.com/iam/docs/reference/rest/v1/projects.roles/list","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Identity and Access Management audit logging","url":"https://cloud.google.com/iam/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"view=FULL and showDeleted=true have no separately documented iam.roles.get requirement. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"IAM v1","httpMethod":"GET","officialMethodName":"projects.roles.list","reviewedContentDigest":"244551291229a4bba2a28672429a0d54f069d602f6d6a424a79fbe7cd6b35852"},{"operationId":"iam.v1.projects.serviceAccounts.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["iam.serviceAccounts.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/iam","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project_id}/serviceAccounts/{email_or_unique_id}","officialEvidence":[{"title":"Method: projects.serviceAccounts.get","url":"https://cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Identity and Access Management audit logging","url":"https://cloud.google.com/iam/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"This reads service-account metadata, not its allow policy. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"IAM v1","httpMethod":"GET","officialMethodName":"projects.serviceAccounts.get","reviewedContentDigest":"de1a7e9817a56546f57e8ff028072e3e21cf832363de78b0385d4182e20da0bc"},{"operationId":"iam.v1.projects.serviceAccounts.getIamPolicy","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["iam.serviceAccounts.getIamPolicy"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/iam","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project_id}/serviceAccounts/{email_or_unique_id}","officialEvidence":[{"title":"Method: projects.serviceAccounts.getIamPolicy","url":"https://docs.cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/getIamPolicy","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Identity and Access Management audit logging","url":"https://cloud.google.com/iam/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"This semantically read-only POST reads who can access the service account; it does not show roles granted to the service account on other resources. requestedPolicyVersion=3 has no additional documented permission. serviceusage.services.use is quota-project conditional.","apiFamily":"IAM v1","httpMethod":"POST","officialMethodName":"projects.serviceAccounts.getIamPolicy","reviewedContentDigest":"1fda9affd00990e52ccb3199f320930b7209ba3fd4d045a2e28aac3c48eaee82"},{"operationId":"iam.v1.projects.serviceAccounts.list","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["iam.serviceAccounts.list"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/iam","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project_id}","officialEvidence":[{"title":"Method: projects.serviceAccounts.list","url":"https://cloud.google.com/iam/docs/reference/rest/v1/projects.serviceAccounts/list","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Identity and Access Management audit logging","url":"https://cloud.google.com/iam/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"iam.serviceAccounts.get is not an additional documented requirement. serviceusage.services.use is conditional only for an explicitly selected quota project.","apiFamily":"IAM v1","httpMethod":"GET","officialMethodName":"projects.serviceAccounts.list","reviewedContentDigest":"2ef2155b3591f48471c2393143c18d458e3972eef22ebd5a196ea42c423cdaf3"},{"operationId":"iam.v2.policies.denypolicies.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["iam.denypolicies.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/iam"],"resourceScope":"policies/{attachmentPoint}/denypolicies/{policyId}; attachment point is the URL-encoded full resource name","officialEvidence":[{"title":"Method: policies.get","url":"https://docs.cloud.google.com/iam/docs/reference/rest/v2/policies/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Identity and Access Management audit logging","url":"https://cloud.google.com/iam/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"},{"title":"IAM roles and permissions","url":"https://cloud.google.com/iam/docs/roles-permissions/iam","evidenceType":"role_reference","accessedAt":"2026-07-17"}],"notes":"The registry ID is normalized exactly, while the official method is policies.get. The attachment point represents an organization, folder, or project full resource name as one path component. serviceusage.services.use is quota-project conditional.","apiFamily":"IAM v2","httpMethod":"GET","officialMethodName":"policies.get","reviewedContentDigest":"5241b13e7bb895ca1badb083bf507f1bf0f827e2f586301b17c0ebd437779aed"},{"operationId":"iam.v2.policies.denypolicies.list","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["iam.denypolicies.list"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform","https://www.googleapis.com/auth/iam"],"resourceScope":"policies/{attachmentPoint}/denypolicies; attachment point is the URL-encoded full resource name","officialEvidence":[{"title":"Method: policies.listPolicies","url":"https://docs.cloud.google.com/iam/docs/reference/rest/v2/policies/listPolicies","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Identity and Access Management audit logging","url":"https://cloud.google.com/iam/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"},{"title":"IAM roles and permissions","url":"https://cloud.google.com/iam/docs/roles-permissions/iam","evidenceType":"role_reference","accessedAt":"2026-07-17"}],"notes":"The official method is policies.listPolicies. List returns policy metadata and omits rules, so rules require the separate get operation. serviceusage.services.use is quota-project conditional.","apiFamily":"IAM v2","httpMethod":"GET","officialMethodName":"policies.listPolicies","reviewedContentDigest":"4b437d3e2793e1f2252e93c0237e76dd368eac0aab3a99442991e59e9af7d2bc"},{"operationId":"policytroubleshooter.v3.iam.troubleshoot","observationRequirement":"optional_diagnostic","evidenceStatus":"PARTIALLY_PROVEN","permissionSemantics":"conditional","requiredIamPermissions":[],"conditionalPermissions":["groups.read"],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"accessTuple.fullResourceName and its organization/folder/project ancestry","officialEvidence":[{"title":"Method: iam.troubleshoot","url":"https://cloud.google.com/policy-intelligence/docs/reference/policytroubleshooter/rest/v3/iam/troubleshoot","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Policy Troubleshooter API Discovery document v3","url":"https://policytroubleshooter.googleapis.com/$discovery/rest?version=v3","evidenceType":"api_discovery","accessedAt":"2026-07-17"},{"title":"Troubleshoot IAM permissions","url":"https://cloud.google.com/policy-intelligence/docs/troubleshoot-access","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"No exact dedicated API-call permission is guessed, and capability bundle A is not a closed exact granular permission set. Contract B is selected: this operation is excluded from the minimal mandatory observer operation set and retained only as an optional diagnostic. Policy Troubleshooter v3 does not evaluate principal access boundary (PAB) policies, which remain a v3beta boundary. Policy, hierarchy, custom-role, and group visibility can yield omitted or unknown results; completeness must be false in those states. groups.read remains conditional for group membership resolution, and serviceusage.services.use remains auxiliary for documented quota-project or CLI contexts. This semantically read-only optional diagnostic must not establish writeFreezeVerified or execution eligibility.","apiFamily":"Policy Troubleshooter v3","httpMethod":"POST","officialMethodName":"iam.troubleshoot","reviewedContentDigest":"ad708637039b8b63044c4c117747ae338b1724a7d744af46e0661295e2ae7f2b"},{"operationId":"run.v2.projects.locations.services.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["run.services.get"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project}/locations/{location}/services/{service}","officialEvidence":[{"title":"Method: projects.locations.services.get","url":"https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Run audit logging","url":"https://cloud.google.com/run/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"The service permission is distinct from revision permissions.","apiFamily":"Cloud Run v2","httpMethod":"GET","officialMethodName":"projects.locations.services.get","reviewedContentDigest":"be702080e76788a5b289d119acb21ab70ab197a2343f230e6e95020f32716c16"},{"operationId":"run.v2.projects.locations.services.list","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["run.services.list"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project}/locations/{location}","officialEvidence":[{"title":"Method: projects.locations.services.list","url":"https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.services/list","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Run audit logging","url":"https://cloud.google.com/run/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"Cloud Run services.list explicitly does not allow locations/-, unlike Cloud Functions list.","apiFamily":"Cloud Run v2","httpMethod":"GET","officialMethodName":"projects.locations.services.list","reviewedContentDigest":"9f8e58c26be9a9ec8ca7a3e92d0a8a29e73096f13ea008d4c1c1b2862906ffc5"},{"operationId":"run.v2.projects.locations.services.revisions.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["run.revisions.get"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project}/locations/{location}/services/{service}/revisions/{revision}","officialEvidence":[{"title":"Method: projects.locations.services.revisions.get","url":"https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.services.revisions/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Run audit logging","url":"https://cloud.google.com/run/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"run.revisions.get is independent of run.services.get.","apiFamily":"Cloud Run v2","httpMethod":"GET","officialMethodName":"projects.locations.services.revisions.get","reviewedContentDigest":"1d326ac8fc0ef9417e4d15131924d0d4ab9990e224ad97005891cda207b57583"},{"operationId":"run.v2.projects.locations.services.revisions.list","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["run.revisions.list"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project}/locations/{location}/services/{service}","officialEvidence":[{"title":"Method: projects.locations.services.revisions.list","url":"https://cloud.google.com/run/docs/reference/rest/v2/projects.locations.services.revisions/list","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Run audit logging","url":"https://cloud.google.com/run/docs/audit-logging","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"The service segment can be '-' to list revisions across services, but location remains a concrete region.","apiFamily":"Cloud Run v2","httpMethod":"GET","officialMethodName":"projects.locations.services.revisions.list","reviewedContentDigest":"08b2c27df62a1c594da537d84b5597b4623832616b2cba6d4e494c846ed766c4"},{"operationId":"serviceusage.v1.projects.services.get","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["serviceusage.services.get"],"conditionalPermissions":[],"auxiliaryPermissions":["serviceusage.services.use"],"oauthScopes":["https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"projects/{project_number}/services/{service_name}","officialEvidence":[{"title":"Method: services.get","url":"https://docs.cloud.google.com/service-usage/docs/reference/rest/v1/services/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Access control with IAM — Service Usage","url":"https://docs.cloud.google.com/service-usage/docs/access-control","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"The registry ID is exact; the official method name is services.get. serviceusage.services.use is separate and conditional only when a project is used for quota/billing.","apiFamily":"Service Usage v1","httpMethod":"GET","officialMethodName":"services.get","reviewedContentDigest":"970003003e78336addb36f84ec23b194e7e508d09cd9b038714715df2e0de9e2"},{"operationId":"storage.v1.objects.getMedia","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["storage.objects.get"],"conditionalPermissions":[],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/devstorage.read_only","https://www.googleapis.com/auth/devstorage.read_write","https://www.googleapis.com/auth/devstorage.full_control","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"buckets/{bucket}/objects/{object}?alt=media","officialEvidence":[{"title":"Objects: get","url":"https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Storage OAuth 2.0 scopes","url":"https://docs.cloud.google.com/storage/docs/oauth-scopes","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"The official Objects: get method covers alt=media and requires storage.objects.get. The registry forces alt=media and exposes no projection/full input. Media does not return ACLs, so there is no conditional storage.objects.getIamPolicy permission.","apiFamily":"Cloud Storage JSON API v1","httpMethod":"GET","officialMethodName":"objects.get","reviewedContentDigest":"837daa6fc1a74d2e50b83b2f6d387e851686545f8821d6541a7a28e41d913f95"},{"operationId":"storage.v1.objects.getMetadata","observationRequirement":"mandatory","evidenceStatus":"PROVEN","permissionSemantics":"all_of","requiredIamPermissions":["storage.objects.get"],"conditionalPermissions":["storage.objects.getIamPolicy"],"auxiliaryPermissions":[],"oauthScopes":["https://www.googleapis.com/auth/devstorage.read_only","https://www.googleapis.com/auth/devstorage.read_write","https://www.googleapis.com/auth/devstorage.full_control","https://www.googleapis.com/auth/cloud-platform.read-only","https://www.googleapis.com/auth/cloud-platform"],"resourceScope":"buckets/{bucket}/objects/{object} with metadata response","officialEvidence":[{"title":"Objects: get","url":"https://docs.cloud.google.com/storage/docs/json_api/v1/objects/get","evidenceType":"rest_method","accessedAt":"2026-07-17"},{"title":"Cloud Storage OAuth 2.0 scopes","url":"https://docs.cloud.google.com/storage/docs/oauth-scopes","evidenceType":"iam_permissions_reference","accessedAt":"2026-07-17"}],"notes":"Metadata uses objects.get and requires storage.objects.get. storage.objects.getIamPolicy is conditional only when ACLs are returned. The current registry query allowlist omits projection entirely; the official API default is projection=noAcl, so projection=full and an ACL-bearing request cannot be supplied and the effective registry behavior is noAcl. The descriptor does not send an explicit projection=noAcl literal.","apiFamily":"Cloud Storage JSON API v1","httpMethod":"GET","officialMethodName":"objects.get","reviewedContentDigest":"3b1b1795c2f1520082a7ee0e47025ed1af260d28d6a8919de14f2423f60b0d32"}]`);

const storageBucketGetRecord = {
  operationId: "storage.v1.buckets.get",
  observationRequirement: "mandatory",
  evidenceStatus: "PROVEN",
  permissionSemantics: "all_of",
  requiredIamPermissions: ["storage.buckets.get"],
  conditionalPermissions: [],
  auxiliaryPermissions: [],
  oauthScopes: [
    "https://www.googleapis.com/auth/devstorage.read_only",
    "https://www.googleapis.com/auth/devstorage.read_write",
    "https://www.googleapis.com/auth/devstorage.full_control",
    "https://www.googleapis.com/auth/cloud-platform.read-only",
    "https://www.googleapis.com/auth/cloud-platform",
  ],
  resourceScope: "buckets/{bucket}?projection=noAcl",
  officialEvidence: [
    {
      title: "Buckets: get",
      url: "https://docs.cloud.google.com/storage/docs/json_api/v1/buckets/get",
      evidenceType: "rest_method",
      accessedAt: "2026-07-18",
    },
    {
      title: "IAM permissions for Cloud Storage",
      url: "https://cloud.google.com/storage/docs/access-control/iam-permissions",
      evidenceType: "iam_permissions_reference",
      accessedAt: "2026-07-18",
    },
  ],
  notes: "The exact noAcl bucket metadata request requires storage.buckets.get. " +
    "It observes the authoritative bucket projectNumber and does not request " +
    "bucket IAM policy or ACL data.",
  apiFamily: "Cloud Storage JSON API v1",
  httpMethod: "GET",
  officialMethodName: "buckets.get",
};
storageBucketGetRecord.reviewedContentDigest =
  digest(convertPermissionRecordToReviewedEvidence(storageBucketGetRecord));
EMBEDDED_REVIEWED_EVIDENCE.push(storageBucketGetRecord);
EMBEDDED_REVIEWED_EVIDENCE.sort((left, right) =>
  left.operationId.localeCompare(right.operationId));
export const READONLY_PERMISSION_RECORDS =
  deepFreeze(EMBEDDED_REVIEWED_EVIDENCE);
const permissionRegistry = Object.create(null);
for (const record of READONLY_PERMISSION_RECORDS) {
  permissionRegistry[record.operationId] = record;
}
export const READONLY_PERMISSION_REGISTRY = deepFreeze(permissionRegistry);
export const READONLY_PERMISSION_OPERATION_IDS = deepFreeze(
    READONLY_PERMISSION_RECORDS.map(({operationId}) => operationId),
);
export const READONLY_PERMISSION_RECORD_COUNT =
  READONLY_PERMISSION_OPERATION_IDS.length;

export const REST_METHOD_IAM_PROOF_OPERATION_IDS = deepFreeze([
  "cloudfunctions.v2.projects.locations.functions.get",
  "cloudfunctions.v2.projects.locations.functions.list",
  "cloudresourcemanager.v3.folders.get",
  "cloudresourcemanager.v3.folders.getIamPolicy",
  "cloudresourcemanager.v3.organizations.getIamPolicy",
  "cloudresourcemanager.v3.projects.get",
]);
export const OFFICIAL_IAM_REFERENCE_REQUIRED_OPERATION_IDS = deepFreeze([
  "cloudresourcemanager.v3.organizations.get",
  "cloudresourcemanager.v3.projects.getIamPolicy",
]);
const iamEvidencePolicyRegistry = Object.create(null);
for (const record of READONLY_PERMISSION_RECORDS) {
  const iamProofRule =
    record.evidenceStatus !== "PROVEN" ?
      "optional_partial_evidence" :
      OFFICIAL_IAM_REFERENCE_REQUIRED_OPERATION_IDS
          .includes(record.operationId) ?
        "official_iam_permission_reference_required" :
        REST_METHOD_IAM_PROOF_OPERATION_IDS.includes(record.operationId) ?
          "direct_rest_method_iam" :
          "explicit_iam_evidence_required";
  iamEvidencePolicyRegistry[record.operationId] =
    deepFreeze({iamProofRule});
}
export const IAM_EVIDENCE_POLICY_REGISTRY =
  deepFreeze(iamEvidencePolicyRegistry);

const forbiddenPermissionEntries = [
  ["cloudbuild.builds.create", "build"],
  ["cloudfunctions.functions.create", "deploy"],
  ["cloudfunctions.functions.delete", "delete"],
  ["cloudfunctions.functions.update", "update"],
  ["cloudscheduler.jobs.create", "create"],
  ["cloudscheduler.jobs.delete", "delete"],
  ["cloudscheduler.jobs.pause", "pause"],
  ["cloudscheduler.jobs.resume", "resume"],
  ["cloudscheduler.jobs.update", "update"],
  ["datastore.entities.create", "firestore"],
  ["datastore.entities.delete", "firestore"],
  ["datastore.entities.update", "firestore"],
  ["firebaseauth.users.create", "auth"],
  ["firebaseauth.users.delete", "auth"],
  ["firebaseauth.users.update", "auth"],
  ["firebaserules.releases.create", "deploy"],
  ["firebaserules.releases.delete", "delete"],
  ["firebaserules.releases.update", "update"],
  ["firebaserules.rulesets.create", "create"],
  ["firebaserules.rulesets.delete", "delete"],
  ["iam.roles.create", "create"],
  ["iam.roles.delete", "delete"],
  ["iam.roles.update", "update"],
  ["iam.serviceAccountKeys.create", "service_account_key"],
  ["iam.serviceAccountKeys.delete", "service_account_key"],
  ["iam.serviceAccounts.actAs", "impersonation"],
  ["iam.serviceAccounts.create", "create"],
  ["iam.serviceAccounts.delete", "delete"],
  ["iam.serviceAccounts.getAccessToken", "token_creator"],
  ["iam.serviceAccounts.setIamPolicy", "set_iam_policy"],
  ["iam.serviceAccounts.signBlob", "token_creator"],
  ["iam.serviceAccounts.signJwt", "token_creator"],
  ["iam.serviceAccounts.update", "update"],
  ["identitytoolkit.accounts.create", "auth"],
  ["identitytoolkit.accounts.delete", "auth"],
  ["identitytoolkit.accounts.update", "auth"],
  ["resourcemanager.folders.setIamPolicy", "set_iam_policy"],
  ["resourcemanager.organizations.setIamPolicy", "set_iam_policy"],
  ["resourcemanager.projects.setIamPolicy", "set_iam_policy"],
  ["run.services.create", "deploy"],
  ["run.services.delete", "delete"],
  ["run.services.update", "update"],
  ["storage.buckets.setIamPolicy", "set_iam_policy"],
  ["storage.objects.create", "create"],
  ["storage.objects.delete", "delete"],
  ["storage.objects.update", "update"],
].sort(([left], [right]) => left.localeCompare(right));
const forbiddenPermissionRegistry = Object.create(null);
for (const [permission, category] of forbiddenPermissionEntries) {
  forbiddenPermissionRegistry[permission] = deepFreeze({category});
}
export const FORBIDDEN_MUTATION_PERMISSION_REGISTRY =
  deepFreeze(forbiddenPermissionRegistry);
export const FORBIDDEN_MUTATION_PERMISSIONS =
  deepFreeze(Object.keys(FORBIDDEN_MUTATION_PERMISSION_REGISTRY));
const forbiddenPrivilegeEscalationEntries = [
  ["roles/editor", "broad_project_mutation"],
  ["roles/iam.roleAdmin", "iam_role_mutation"],
  ["roles/iam.securityAdmin", "iam_policy_mutation"],
  ["roles/iam.serviceAccountAdmin", "service_account_mutation"],
  ["roles/iam.serviceAccountTokenCreator", "token_creator"],
  ["roles/owner", "broad_project_mutation"],
  ["roles/resourcemanager.projectIamAdmin", "iam_policy_mutation"],
];
const forbiddenPrivilegeEscalationRegistry = Object.create(null);
for (const [literal, category] of forbiddenPrivilegeEscalationEntries) {
  forbiddenPrivilegeEscalationRegistry[literal] = deepFreeze({category});
}
export const FORBIDDEN_PRIVILEGE_ESCALATION_LITERAL_REGISTRY =
  deepFreeze(forbiddenPrivilegeEscalationRegistry);

export const FORBIDDEN_MUTATION_TERMINAL_ACTIONS = deepFreeze([
  "actAs",
  "create",
  "createKey",
  "delete",
  "deleteKey",
  "deploy",
  "disable",
  "enable",
  "getAccessToken",
  "insert",
  "move",
  "patch",
  "pause",
  "restore",
  "resume",
  "setIamPolicy",
  "setOrgPolicy",
  "signBlob",
  "signJwt",
  "undelete",
  "update",
].sort());
const READ_ONLY_TERMINAL_ACTIONS = new Set([
  "analyzeIamPolicy",
  "get",
  "getIamPolicy",
  "getMedia",
  "getMetadata",
  "list",
  "listPolicies",
  "read",
  "searchAllIamPolicies",
  "searchAllResources",
  "troubleshoot",
  "use",
]);

export function classifySemanticTerminalAction(operationId) {
  if (typeof operationId !== "string" || operationId.length === 0) {
    throw new Error("operationId must be a non-empty string");
  }
  const terminalAction = operationId.split(".").at(-1);
  return deepFreeze({
    terminalAction,
    classification: FORBIDDEN_MUTATION_TERMINAL_ACTIONS
        .includes(terminalAction) ?
      "mutation" :
      READ_ONLY_TERMINAL_ACTIONS.has(terminalAction) ?
        "read_only" :
        "unknown",
  });
}

function assertSafePermissionLiteral(permission, label) {
  if (typeof permission !== "string" || permission.length === 0) {
    throw new Error(`invalid permission literal: ${label}`);
  }
  const semanticAction = classifySemanticTerminalAction(permission);
  if (Object.hasOwn(FORBIDDEN_MUTATION_PERMISSION_REGISTRY, permission) ||
      Object.hasOwn(
          FORBIDDEN_PRIVILEGE_ESCALATION_LITERAL_REGISTRY,
          permission,
      ) ||
      semanticAction.classification === "mutation") {
    throw new Error(`mutation or privilege escalation rejected: ${label}`);
  }
  if (semanticAction.classification !== "read_only") {
    throw new Error(
        `unknown permission terminal rejected: ${label}; ` +
        `terminal=${semanticAction.terminalAction}`,
    );
  }
}

function assertRecordIamEvidencePolicy(record) {
  const policy = IAM_EVIDENCE_POLICY_REGISTRY[record.operationId];
  if (!policy) {
    throw new Error(`IAM evidence policy missing: ${record.operationId}`);
  }
  const evidenceTypes =
    record.officialEvidence.map(({evidenceType}) => evidenceType);
  const proven = record.evidenceStatus === "PROVEN";
  const ruleSatisfied =
    policy.iamProofRule === "optional_partial_evidence" ?
      !proven :
      policy.iamProofRule ===
        "official_iam_permission_reference_required" ?
        proven &&
          evidenceTypes.includes("official_iam_permission_reference") :
        policy.iamProofRule === "direct_rest_method_iam" ?
          proven && evidenceTypes.includes("rest_method") :
          policy.iamProofRule === "explicit_iam_evidence_required" ?
            proven && evidenceTypes.some((evidenceType) =>
              EXPLICIT_IAM_AUTHORIZATION_EVIDENCE_TYPES
                  .includes(evidenceType)) :
            false;
  if (!ruleSatisfied) {
    throw new Error(
        `OAuth-only evidence cannot prove IAM for ${record.operationId}; ` +
        `policy=${policy.iamProofRule}`,
    );
  }
}

function computeOfficialEvidenceSetDigest(registry) {
  return digest(Object.keys(registry).sort().map((operationId) => ({
    operationId,
    officialEvidence: registry[operationId].officialEvidence,
  })));
}

function computeReviewedEvidenceSetDigest(registry) {
  return digest(Object.keys(registry).sort().map((operationId) =>
    convertPermissionRecordToReviewedEvidence(registry[operationId])));
}

export function computeReadonlyPermissionManifestDigest(
    registry = READONLY_PERMISSION_REGISTRY,
    {
      manifestVersion = READONLY_PERMISSION_MANIFEST_VERSION,
      researchArtifactSha256 = PERMISSION_RESEARCH_ARTIFACT_SHA256,
      reviewedEvidenceSetDigest = computeReviewedEvidenceSetDigest(registry),
      officialEvidenceSetDigest = computeOfficialEvidenceSetDigest(registry),
    } = {},
) {
  return digest({
    manifestVersion,
    researchArtifactSha256,
    reviewedEvidenceSetDigest,
    officialEvidenceSetDigest,
    records: Object.keys(registry).sort().map((operationId) =>
      registry[operationId]),
  });
}

export const READONLY_PERMISSION_MANIFEST_DIGEST =
  computeReadonlyPermissionManifestDigest();

function sortedUniqueFromRecords(records, key) {
  return [...new Set(records.flatMap((record) => record[key]))].sort();
}

function sourceOperationLinkage(records, key) {
  return Object.fromEntries(sortedUniqueFromRecords(records, key).map(
      (value) => [
        value,
        records.filter((record) => record[key].includes(value))
            .map((record) => record.operationId).sort(),
      ],
  ));
}

function effectiveContractDigestProjection(contract) {
  const {
    contractDigest: ignoredContractDigest,
    ...projection
  } = contract;
  return projection;
}

function assertEffectiveContractCandidateSets(
    registry,
    {
      mandatoryOperationIds,
      optionalDiagnosticOperationIds,
      mandatoryOperationSetDigest,
      optionalDiagnosticOperationSetDigest,
      operationClassificationVersion,
    },
) {
  assertExactKeys(
      registry,
      PROVIDER_OPERATION_IDS,
      "effective contract permission registry",
      null,
  );
  if (!Object.isFrozen(registry) ||
      !same(mandatoryOperationIds, PROVIDER_MANDATORY_OPERATION_IDS) ||
      !same(
          optionalDiagnosticOperationIds,
          PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
      ) ||
      !same(
          [...mandatoryOperationIds, ...optionalDiagnosticOperationIds].sort(),
          PROVIDER_OPERATION_IDS,
      ) ||
      mandatoryOperationSetDigest !==
        computeProviderOperationIdSetDigest(mandatoryOperationIds) ||
      optionalDiagnosticOperationSetDigest !==
        computeProviderOperationIdSetDigest(optionalDiagnosticOperationIds) ||
      operationClassificationVersion !==
        PROVIDER_OPERATION_CLASSIFICATION_VERSION) {
    throw new Error("effective contract operation classification mismatch");
  }
  for (const operationId of PROVIDER_OPERATION_IDS) {
    const record = registry[operationId];
    assertExactKeys(
        record,
        RECORD_KEYS,
        `effective contract record ${operationId}`,
    );
    const mandatory = mandatoryOperationIds.includes(operationId);
    if (record.operationId !== operationId ||
        (mandatory &&
          (record.observationRequirement !== "mandatory" ||
            record.evidenceStatus !== "PROVEN" ||
            record.permissionSemantics !== "all_of" ||
            record.requiredIamPermissions.length === 0)) ||
        (!mandatory &&
          record.observationRequirement !== "optional_diagnostic")) {
      throw new Error(
          `effective contract record classification mismatch: ${operationId}`,
      );
    }
    for (const key of PERMISSION_CATEGORIES) {
      assertUniqueStrings(record[key], `${operationId}.${key}`);
      for (const permission of record[key]) {
        assertSafePermissionLiteral(
            permission,
            `${operationId}.${key}.${permission}`,
        );
      }
    }
  }
  if (computeReviewedEvidenceSetDigest(registry) !==
        REVIEWED_EVIDENCE_SET_DIGEST ||
      computeOfficialEvidenceSetDigest(registry) !==
        OFFICIAL_EVIDENCE_SET_DIGEST ||
      computeReadonlyPermissionManifestDigest(registry, {
        reviewedEvidenceSetDigest: REVIEWED_EVIDENCE_SET_DIGEST,
        officialEvidenceSetDigest: OFFICIAL_EVIDENCE_SET_DIGEST,
      }) !== EXPECTED_READONLY_PERMISSION_MANIFEST_DIGEST) {
    throw new Error("effective contract candidate manifest mismatch");
  }
}

export function computeEffectiveMandatoryPermissionContract(
    registry = READONLY_PERMISSION_REGISTRY,
    {
      mandatoryOperationIds = PROVIDER_MANDATORY_OPERATION_IDS,
      optionalDiagnosticOperationIds =
        PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
      mandatoryOperationSetDigest =
        PROVIDER_MANDATORY_OPERATION_SET_DIGEST,
      optionalDiagnosticOperationSetDigest =
        PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_SET_DIGEST,
      operationClassificationVersion =
        PROVIDER_OPERATION_CLASSIFICATION_VERSION,
    } = {},
) {
  assertEffectiveContractCandidateSets(registry, {
    mandatoryOperationIds,
    optionalDiagnosticOperationIds,
    mandatoryOperationSetDigest,
    optionalDiagnosticOperationSetDigest,
    operationClassificationVersion,
  });
  const mandatoryIdSet = new Set(mandatoryOperationIds);
  const mandatoryRecords = Object.keys(registry).sort()
      .filter((operationId) => mandatoryIdSet.has(operationId))
      .map((operationId) => registry[operationId]);
  const requiredIamPermissions =
    sortedUniqueFromRecords(mandatoryRecords, "requiredIamPermissions");
  const conditionalPermissions =
    sortedUniqueFromRecords(mandatoryRecords, "conditionalPermissions");
  const auxiliaryPermissions =
    sortedUniqueFromRecords(mandatoryRecords, "auxiliaryPermissions");
  const oauthScopes = sortedUniqueFromRecords(mandatoryRecords, "oauthScopes");
  const contract = {
    manifestVersion: READONLY_PERMISSION_MANIFEST_VERSION,
    manifestDigest: computeReadonlyPermissionManifestDigest(registry),
    officialEvidenceSetDigest: computeOfficialEvidenceSetDigest(registry),
    researchArtifactSha256: PERMISSION_RESEARCH_ARTIFACT_SHA256,
    reviewedEvidenceSetDigest: computeReviewedEvidenceSetDigest(registry),
    providerOperationClassificationVersion: operationClassificationVersion,
    providerMandatoryOperationSetDigest: mandatoryOperationSetDigest,
    providerOptionalDiagnosticOperationSetDigest:
      optionalDiagnosticOperationSetDigest,
    mandatoryOperationCount: mandatoryRecords.length,
    optionalDiagnosticOperationCount: optionalDiagnosticOperationIds.length,
    requiredPermissionCount: requiredIamPermissions.length,
    conditionalPermissionCount: conditionalPermissions.length,
    auxiliaryPermissionCount: auxiliaryPermissions.length,
    oauthScopeCount: oauthScopes.length,
    mandatoryOperationIds: [...mandatoryOperationIds],
    optionalDiagnosticOperationIds: [...optionalDiagnosticOperationIds],
    requiredIamPermissions,
    conditionalPermissions,
    auxiliaryPermissions,
    oauthScopes,
    sourceOperations: {
      requiredIamPermissions:
        sourceOperationLinkage(mandatoryRecords, "requiredIamPermissions"),
      conditionalPermissions:
        sourceOperationLinkage(mandatoryRecords, "conditionalPermissions"),
      auxiliaryPermissions:
        sourceOperationLinkage(mandatoryRecords, "auxiliaryPermissions"),
      oauthScopes: sourceOperationLinkage(mandatoryRecords, "oauthScopes"),
    },
  };
  contract.contractDigest = digest(effectiveContractDigestProjection(contract));
  return deepFreeze(contract);
}

export const EFFECTIVE_MANDATORY_PERMISSION_CONTRACT =
  computeEffectiveMandatoryPermissionContract();
export const EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST =
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT.contractDigest;

const STANDALONE_TOPOLOGY_EVIDENCE_KEYS = Object.freeze([
  "observedFolderNames",
  "observedOrganizationNames",
  "projectId",
  "projectNumber",
  "projectParent",
  "sourceBucketName",
  "sourceBucketOwnerProjectNumber",
]);

function sortedUnique(values, label) {
  assertUniqueStrings(values, label);
  return [...values].sort();
}

function topologySetProjection(values) {
  return {
    count: values.length,
    names: values,
    setDigest: digest(values),
  };
}

export const OBSERVER_PRINCIPAL_POLICY = (() => {
  const policy = {
    policyVersion: OBSERVER_PRINCIPAL_POLICY_VERSION,
    serviceAccountId: OBSERVER_SERVICE_ACCOUNT_ID,
    email: OBSERVER_SERVICE_ACCOUNT_EMAIL,
    member: OBSERVER_SERVICE_ACCOUNT_MEMBER,
  };
  return deepFreeze({
    ...policy,
    policyDigest: digest(policy),
  });
})();

export function assertObserverPrincipalPolicy(
    value = OBSERVER_PRINCIPAL_POLICY,
) {
  assertExactKeys(
      value,
      [
        "email",
        "member",
        "policyDigest",
        "policyVersion",
        "serviceAccountId",
      ],
      "observer principal policy",
  );
  const projection = {
    policyVersion: value.policyVersion,
    serviceAccountId: value.serviceAccountId,
    email: value.email,
    member: value.member,
  };
  if (!same(projection, {
    policyVersion: OBSERVER_PRINCIPAL_POLICY_VERSION,
    serviceAccountId: OBSERVER_SERVICE_ACCOUNT_ID,
    email: OBSERVER_SERVICE_ACCOUNT_EMAIL,
    member: OBSERVER_SERVICE_ACCOUNT_MEMBER,
  }) || value.policyDigest !== digest(projection)) {
    throw new Error("observer principal policy mismatch");
  }
  return value;
}

export function deriveStandaloneProjectObserverProfile(
    evidence,
    evidenceDerivedNotApplicableOperationIds = [],
) {
  assertExactKeys(
      evidence,
      STANDALONE_TOPOLOGY_EVIDENCE_KEYS,
      "standalone topology evidence",
  );
  if (evidence.projectId !== PROVIDER_TARGET_PROJECT_ID ||
      evidence.projectNumber !== PROVIDER_TARGET_PROJECT_NUMBER ||
      evidence.projectParent !== null ||
      evidence.sourceBucketName !== STANDALONE_SOURCE_BUCKET_NAME ||
      evidence.sourceBucketOwnerProjectNumber !==
        PROVIDER_TARGET_PROJECT_NUMBER) {
    throw new Error("standalone topology identity mismatch");
  }
  const observedFolderNames = sortedUnique(
      evidence.observedFolderNames,
      "standalone observed folders",
  );
  const observedOrganizationNames = sortedUnique(
      evidence.observedOrganizationNames,
      "standalone observed organizations",
  );
  if (observedFolderNames.length !== 0 ||
      observedOrganizationNames.length !== 0) {
    throw new Error("standalone topology contains hierarchy ancestors");
  }

  const topologyNotApplicableMandatoryOperationIds =
    [...STANDALONE_NOT_APPLICABLE_MANDATORY_OPERATION_IDS].sort();
  const evidenceDerivedNotApplicableMandatoryOperationIds = sortedUnique(
      evidenceDerivedNotApplicableOperationIds,
      "evidence-derived N/A mandatory operations",
  );
  if (evidenceDerivedNotApplicableMandatoryOperationIds.some((operationId) =>
    !EVIDENCE_DERIVED_NOT_APPLICABLE_MANDATORY_OPERATION_IDS.includes(
        operationId,
    ))) {
    throw new Error("evidence-derived N/A operation is not approved");
  }
  const notApplicableMandatoryOperationIds = [
    ...topologyNotApplicableMandatoryOperationIds,
    ...evidenceDerivedNotApplicableMandatoryOperationIds,
  ].sort();
  const notApplicableSet =
    new Set(notApplicableMandatoryOperationIds);
  const executedMandatoryOperationIds = PROVIDER_MANDATORY_OPERATION_IDS
      .filter((operationId) => !notApplicableSet.has(operationId))
      .sort();
  const coveredOperationIds = [
    ...executedMandatoryOperationIds,
    ...notApplicableMandatoryOperationIds,
  ].sort();
  if (!same(coveredOperationIds, [...PROVIDER_MANDATORY_OPERATION_IDS].sort()) ||
      executedMandatoryOperationIds.some((operationId) =>
        notApplicableSet.has(operationId)) ||
      executedMandatoryOperationIds.length +
        notApplicableMandatoryOperationIds.length !==
          PROVIDER_MANDATORY_OPERATION_IDS.length) {
    throw new Error("standalone operation execution partition mismatch");
  }

  const capabilityOperationIds = PROVIDER_MANDATORY_OPERATION_IDS
      .filter((operationId) =>
        !topologyNotApplicableMandatoryOperationIds.includes(operationId))
      .sort();
  const executedRecords = capabilityOperationIds.map((operationId) => {
    const record = READONLY_PERMISSION_REGISTRY[operationId];
    if (!record) throw new Error("standalone permission record missing");
    return record;
  });
  const effectiveRequiredPermissions =
    sortedUniqueFromRecords(executedRecords, "requiredIamPermissions");
  const reviewedConditionalPermissions =
    sortedUniqueFromRecords(executedRecords, "conditionalPermissions");
  const effectiveAuxiliaryPermissions =
    sortedUniqueFromRecords(executedRecords, "auxiliaryPermissions");
  const effectiveRolePermissions = [...new Set([
    ...effectiveRequiredPermissions,
    ...effectiveAuxiliaryPermissions,
  ])].sort();
  if (!same(effectiveRequiredPermissions,
      STANDALONE_REQUIRED_IAM_PERMISSIONS) ||
      !same(effectiveAuxiliaryPermissions,
          STANDALONE_AUXILIARY_IAM_PERMISSIONS) ||
      effectiveRolePermissions.length !== 27 ||
      STANDALONE_EXCLUDED_ROLE_PERMISSIONS.some((permission) =>
        effectiveRolePermissions.includes(permission))) {
    throw new Error("standalone effective permission profile mismatch");
  }

  const folders = topologySetProjection(observedFolderNames);
  const organizations =
    topologySetProjection(observedOrganizationNames);
  const topologyEvidence = {
    projectId: evidence.projectId,
    projectNumber: evidence.projectNumber,
    projectParent: evidence.projectParent,
    folders,
    organizations,
    sourceBucketName: evidence.sourceBucketName,
    sourceBucketOwnerProjectNumber:
      evidence.sourceBucketOwnerProjectNumber,
  };
  const operationExecution = {
    operationExecutionProfileVersion:
      OBSERVER_OPERATION_EXECUTION_PROFILE_VERSION,
    totalOperationCount: PROVIDER_OPERATION_IDS.length,
    mandatoryOperationCount: PROVIDER_MANDATORY_OPERATION_IDS.length,
    executedMandatoryOperationCount: executedMandatoryOperationIds.length,
    executedMandatoryOperationIds,
    executedMandatoryOperationSetDigest:
      computeProviderOperationIdSetDigest(executedMandatoryOperationIds),
    topologyNotApplicableMandatoryOperationCount:
      topologyNotApplicableMandatoryOperationIds.length,
    topologyNotApplicableMandatoryOperationIds,
    topologyNotApplicableMandatoryOperationSetDigest:
      computeProviderOperationIdSetDigest(
          topologyNotApplicableMandatoryOperationIds,
      ),
    evidenceDerivedNotApplicableMandatoryOperationCount:
      evidenceDerivedNotApplicableMandatoryOperationIds.length,
    evidenceDerivedNotApplicableMandatoryOperationIds,
    evidenceDerivedNotApplicableMandatoryOperationSetDigest:
      computeProviderOperationIdSetDigest(
          evidenceDerivedNotApplicableMandatoryOperationIds,
      ),
    notApplicableMandatoryOperationCount:
      notApplicableMandatoryOperationIds.length,
    notApplicableMandatoryOperationIds,
    notApplicableMandatoryOperationSetDigest:
      computeProviderOperationIdSetDigest(
          notApplicableMandatoryOperationIds,
      ),
    optionalDiagnosticOperationCount:
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS.length,
    optionalDiagnosticOperationIds:
      [...PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS],
    optionalDiagnosticOperationSetDigest:
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_SET_DIGEST,
  };
  const effectivePermissions = {
    permissionProfileVersion: OBSERVER_PERMISSION_PROFILE_VERSION,
    effectiveRequiredPermissionCount: effectiveRequiredPermissions.length,
    effectiveRequiredPermissions,
    effectiveRequiredPermissionSetDigest:
      digest(effectiveRequiredPermissions),
    reviewedConditionalPermissions,
    reviewedConditionalPermissionSetDigest:
      digest(reviewedConditionalPermissions),
    effectiveAuxiliaryPermissionCount: effectiveAuxiliaryPermissions.length,
    effectiveAuxiliaryPermissions,
    effectiveAuxiliaryPermissionSetDigest:
      digest(effectiveAuxiliaryPermissions),
    effectiveRolePermissionCount: effectiveRolePermissions.length,
    effectiveRolePermissions,
    effectiveRolePermissionSetDigest: digest(effectiveRolePermissions),
    excludedRolePermissions: [...STANDALONE_EXCLUDED_ROLE_PERMISSIONS],
    excludedRolePermissionSetDigest:
      digest(STANDALONE_EXCLUDED_ROLE_PERMISSIONS),
  };
  const profile = {
    topologyProfileVersion: OBSERVER_TOPOLOGY_PROFILE_VERSION,
    topologyProfileId: STANDALONE_PROJECT_TOPOLOGY_PROFILE_ID,
    topologyEvidence,
    topologyEvidenceDigest: digest(topologyEvidence),
    operationExecution,
    operationExecutionDigest: digest(operationExecution),
    effectivePermissions,
    effectivePermissionProfileDigest: digest(effectivePermissions),
    observerPrincipalPolicy: OBSERVER_PRINCIPAL_POLICY,
  };
  return deepFreeze({
    ...profile,
    profileDigest: digest(profile),
  });
}

export const PINNED_STANDALONE_TOPOLOGY_EVIDENCE = deepFreeze({
  projectId: PROVIDER_TARGET_PROJECT_ID,
  projectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
  projectParent: null,
  observedFolderNames: [],
  observedOrganizationNames: [],
  sourceBucketName: STANDALONE_SOURCE_BUCKET_NAME,
  sourceBucketOwnerProjectNumber: PROVIDER_TARGET_PROJECT_NUMBER,
});
export const STANDALONE_PROJECT_OBSERVER_PROFILE =
  deriveStandaloneProjectObserverProfile(
      PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
  );

export function assertStandaloneProjectObserverProfile(
    value,
    evidence = PINNED_STANDALONE_TOPOLOGY_EVIDENCE,
    evidenceDerivedNotApplicableOperationIds = [],
) {
  const expected = deriveStandaloneProjectObserverProfile(
      evidence,
      evidenceDerivedNotApplicableOperationIds,
  );
  assertExactKeys(
      value,
      Object.keys(expected),
      "standalone observer profile",
  );
  assertExactKeys(
      value.topologyEvidence,
      Object.keys(expected.topologyEvidence),
      "standalone observer topology evidence",
  );
  for (const family of ["folders", "organizations"]) {
    assertExactKeys(
        value.topologyEvidence[family],
        Object.keys(expected.topologyEvidence[family]),
        `standalone observer topology ${family}`,
    );
  }
  assertExactKeys(
      value.operationExecution,
      Object.keys(expected.operationExecution),
      "standalone observer operation execution",
  );
  assertExactKeys(
      value.effectivePermissions,
      Object.keys(expected.effectivePermissions),
      "standalone observer effective permissions",
  );
  assertObserverPrincipalPolicy(value.observerPrincipalPolicy);
  const normalized = {
    ...value,
    topologyEvidence: {
      ...value.topologyEvidence,
      folders: {
        ...value.topologyEvidence.folders,
        names: sortedUnique(
            value.topologyEvidence.folders.names,
            "standalone observer folder names",
        ),
      },
      organizations: {
        ...value.topologyEvidence.organizations,
        names: sortedUnique(
            value.topologyEvidence.organizations.names,
            "standalone observer organization names",
        ),
      },
    },
    operationExecution: {
      ...value.operationExecution,
      executedMandatoryOperationIds: sortedUnique(
          value.operationExecution.executedMandatoryOperationIds,
          "standalone executed mandatory operations",
      ),
      topologyNotApplicableMandatoryOperationIds: sortedUnique(
          value.operationExecution.topologyNotApplicableMandatoryOperationIds,
          "standalone topology N/A mandatory operations",
      ),
      evidenceDerivedNotApplicableMandatoryOperationIds: sortedUnique(
          value.operationExecution
              .evidenceDerivedNotApplicableMandatoryOperationIds,
          "standalone evidence-derived N/A mandatory operations",
      ),
      notApplicableMandatoryOperationIds: sortedUnique(
          value.operationExecution.notApplicableMandatoryOperationIds,
          "standalone N/A mandatory operations",
      ),
      optionalDiagnosticOperationIds: sortedUnique(
          value.operationExecution.optionalDiagnosticOperationIds,
          "standalone optional diagnostic operations",
      ),
    },
    effectivePermissions: {
      ...value.effectivePermissions,
      effectiveRequiredPermissions: sortedUnique(
          value.effectivePermissions.effectiveRequiredPermissions,
          "standalone effective required permissions",
      ),
      reviewedConditionalPermissions: sortedUnique(
          value.effectivePermissions.reviewedConditionalPermissions,
          "standalone reviewed conditional permissions",
      ),
      effectiveAuxiliaryPermissions: sortedUnique(
          value.effectivePermissions.effectiveAuxiliaryPermissions,
          "standalone effective auxiliary permissions",
      ),
      effectiveRolePermissions: sortedUnique(
          value.effectivePermissions.effectiveRolePermissions,
          "standalone effective role permissions",
      ),
      excludedRolePermissions: sortedUnique(
          value.effectivePermissions.excludedRolePermissions,
          "standalone excluded role permissions",
      ),
    },
  };
  if (!same(normalized, expected)) {
    throw new Error("standalone observer profile claim mismatch");
  }
  return expected;
}

function assertStorageLinkage(registry, operationRegistry) {
  const bucket = registry["storage.v1.buckets.get"];
  const media = registry["storage.v1.objects.getMedia"];
  const metadata = registry["storage.v1.objects.getMetadata"];
  const bucketDescriptor = operationRegistry["storage.v1.buckets.get"];
  const mediaDescriptor = operationRegistry["storage.v1.objects.getMedia"];
  const metadataDescriptor =
    operationRegistry["storage.v1.objects.getMetadata"];
  if (!same(bucket.requiredIamPermissions, ["storage.buckets.get"]) ||
      bucket.conditionalPermissions.length !== 0 ||
      !same(media.requiredIamPermissions, ["storage.objects.get"]) ||
      media.conditionalPermissions.length !== 0 ||
      !same(metadata.requiredIamPermissions, ["storage.objects.get"]) ||
      !same(metadata.conditionalPermissions,
          ["storage.objects.getIamPolicy"]) ||
      !bucketDescriptor || !mediaDescriptor || !metadataDescriptor ||
      !same(Object.keys(bucketDescriptor.query.properties),
          ["projection"]) ||
      bucketDescriptor.query.properties.projection?.const !== "noAcl" ||
      !bucketDescriptor.query.required.includes("projection") ||
      !same(Object.keys(mediaDescriptor.query.properties).sort(),
          ["alt", "generation"]) ||
      mediaDescriptor.query.properties.alt?.const !== "media" ||
      !mediaDescriptor.query.required.includes("alt") ||
      Object.hasOwn(mediaDescriptor.query.properties, "projection") ||
      Object.hasOwn(metadataDescriptor.query.properties, "projection")) {
    throw new Error("Cloud Storage permission/descriptor linkage mismatch");
  }
}

function assertSpecialEvidence(registry) {
  const cloudAsset =
    registry["cloudasset.v1.projects.analyzeIamPolicy"];
  if (!same(cloudAsset.requiredIamPermissions, [
    "cloudasset.assets.analyzeIamPolicy",
    "cloudasset.assets.searchAllIamPolicies",
    "cloudasset.assets.searchAllResources",
  ]) ||
      !same(cloudAsset.conditionalPermissions, ["iam.roles.get"]) ||
      !same(cloudAsset.auxiliaryPermissions, ["serviceusage.services.use"]) ||
      cloudAsset.permissionSemantics !== "all_of") {
    throw new Error("Cloud Asset all-of permission contract mismatch");
  }
  const resourceManagerEvidenceIds = [
    "cloudresourcemanager.v3.organizations.get",
    "cloudresourcemanager.v3.projects.getIamPolicy",
  ];
  for (const operationId of resourceManagerEvidenceIds) {
    if (!registry[operationId].officialEvidence.some(({evidenceType}) =>
      evidenceType === "official_iam_permission_reference")) {
      throw new Error(`Resource Manager IAM evidence missing: ${operationId}`);
    }
  }
  const troubleshooter =
    registry["policytroubleshooter.v3.iam.troubleshoot"];
  if (troubleshooter.observationRequirement !== "optional_diagnostic" ||
      troubleshooter.evidenceStatus !== "PARTIALLY_PROVEN" ||
      troubleshooter.requiredIamPermissions.length !== 0) {
    throw new Error("Policy Troubleshooter classification mismatch");
  }
}

export function assertReadonlyPermissionManifest(
    registry = READONLY_PERMISSION_REGISTRY,
    operationRegistry = PROVIDER_OPERATION_REGISTRY,
    {
      operationIds = PROVIDER_OPERATION_IDS,
      mandatoryOperationIds = PROVIDER_MANDATORY_OPERATION_IDS,
      optionalDiagnosticOperationIds =
        PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
      manifestVersion = READONLY_PERMISSION_MANIFEST_VERSION,
      researchArtifactSha256 = PERMISSION_RESEARCH_ARTIFACT_SHA256,
      reviewedEvidenceSetDigest = REVIEWED_EVIDENCE_SET_DIGEST,
      officialEvidenceSetDigest = OFFICIAL_EVIDENCE_SET_DIGEST,
      manifestDigest = EXPECTED_READONLY_PERMISSION_MANIFEST_DIGEST,
    } = {},
) {
  assertExactKeys(registry, operationIds, "permission registry", null);
  assertExactKeys(
      operationRegistry,
      operationIds,
      "provider operation registry",
      null,
  );
  if (!Object.isFrozen(registry)) {
    throw new Error("permission registry is not frozen");
  }
  if (!Object.isFrozen(operationRegistry)) {
    throw new Error("provider operation registry is not frozen");
  }
  assertSortedUniqueStrings(operationIds, "provider operation IDs", {
    allowEmpty: false,
  });
  assertSortedUniqueStrings(mandatoryOperationIds, "mandatory operation IDs", {
    allowEmpty: false,
  });
  assertSortedUniqueStrings(
      optionalDiagnosticOperationIds,
      "optional diagnostic operation IDs",
      {allowEmpty: false},
  );
  if (!same([...mandatoryOperationIds, ...optionalDiagnosticOperationIds]
      .sort(), operationIds) ||
      mandatoryOperationIds.some((operationId) =>
        optionalDiagnosticOperationIds.includes(operationId))) {
    throw new Error("provider operation classification partition mismatch");
  }
  for (const operationId of operationIds) {
    const record = registry[operationId];
    assertFrozenCanonicalValue(record, `permission record ${operationId}`);
    assertExactKeys(record, RECORD_KEYS, `permission record ${operationId}`);
    if (record.operationId !== operationId ||
        typeof record.apiFamily !== "string" ||
        typeof record.officialMethodName !== "string" ||
        typeof record.resourceScope !== "string" ||
        typeof record.notes !== "string" ||
        !["GET", "POST"].includes(record.httpMethod) ||
        !["all_of", "conditional"].includes(record.permissionSemantics) ||
        !["PROVEN", "PARTIALLY_PROVEN"].includes(record.evidenceStatus) ||
        !["mandatory", "optional_diagnostic"]
            .includes(record.observationRequirement) ||
        !/^[a-f0-9]{64}$/.test(record.reviewedContentDigest)) {
      throw new Error(`permission record scalar mismatch: ${operationId}`);
    }
    for (const key of [
      ...PERMISSION_CATEGORIES,
      "oauthScopes",
    ]) {
      assertUniqueStrings(record[key], `${operationId}.${key}`, {
        allowEmpty: key !== "oauthScopes",
      });
    }
    for (const key of PERMISSION_CATEGORIES) {
      for (const permission of record[key]) {
        assertSafePermissionLiteral(
            permission,
            `${operationId}.${key}.${permission}`,
        );
      }
    }
    if (!Array.isArray(record.officialEvidence) ||
        record.officialEvidence.length === 0) {
      throw new Error(`official evidence missing: ${operationId}`);
    }
    for (const [index, evidence] of record.officialEvidence.entries()) {
      assertExactKeys(
          evidence,
          OFFICIAL_EVIDENCE_KEYS,
          `${operationId}.officialEvidence[${index}]`,
      );
      if (Object.values(evidence).some((value) =>
        typeof value !== "string" || value.length === 0)) {
        throw new Error(`official evidence scalar mismatch: ${operationId}`);
      }
      let url;
      try {
        url = new URL(evidence.url);
      } catch {
        throw new Error(`invalid official evidence URL: ${operationId}`);
      }
      if (url.protocol !== "https:" ||
          !OFFICIAL_HOST_ALLOWLIST.includes(url.hostname)) {
        throw new Error(`unapproved official evidence host: ${operationId}`);
      }
    }
    assertRecordIamEvidencePolicy(record);
    const reviewed = convertPermissionRecordToReviewedEvidence(record);
    if (digest(reviewed) !== record.reviewedContentDigest) {
      throw new Error(`reviewed record digest mismatch: ${operationId}`);
    }
    const descriptor = operationRegistry[operationId];
    if (!descriptor || descriptor.operationId !== operationId ||
        descriptor.method !== record.httpMethod ||
        descriptor.readOnlySemantic !== true ||
        classifySemanticTerminalAction(operationId).classification !==
          "read_only") {
      throw new Error(`provider descriptor is not read-only: ${operationId}`);
    }
    if (record.observationRequirement === "mandatory" &&
        (record.evidenceStatus !== "PROVEN" ||
          record.permissionSemantics !== "all_of" ||
          record.requiredIamPermissions.length === 0 ||
          !mandatoryOperationIds.includes(operationId))) {
      throw new Error(`mandatory permission evidence mismatch: ${operationId}`);
    }
    if (record.observationRequirement === "optional_diagnostic" &&
        !optionalDiagnosticOperationIds.includes(operationId)) {
      throw new Error(`optional permission evidence mismatch: ${operationId}`);
    }
  }
  assertStorageLinkage(registry, operationRegistry);
  assertSpecialEvidence(registry);
  if (manifestVersion !== READONLY_PERMISSION_MANIFEST_VERSION ||
      researchArtifactSha256 !== PERMISSION_RESEARCH_ARTIFACT_SHA256 ||
      reviewedEvidenceSetDigest !== REVIEWED_EVIDENCE_SET_DIGEST ||
      officialEvidenceSetDigest !== OFFICIAL_EVIDENCE_SET_DIGEST ||
      computeReviewedEvidenceSetDigest(registry) !==
        REVIEWED_EVIDENCE_SET_DIGEST ||
      computeOfficialEvidenceSetDigest(registry) !==
        OFFICIAL_EVIDENCE_SET_DIGEST ||
      computeReadonlyPermissionManifestDigest(registry, {
        manifestVersion,
        researchArtifactSha256,
        reviewedEvidenceSetDigest,
        officialEvidenceSetDigest,
      }) !== manifestDigest ||
      manifestDigest !== EXPECTED_READONLY_PERMISSION_MANIFEST_DIGEST) {
    throw new Error("permission manifest literal pin mismatch");
  }
  return true;
}

export function assertEffectiveMandatoryPermissionContract(
    contract = EFFECTIVE_MANDATORY_PERMISSION_CONTRACT,
    registry = READONLY_PERMISSION_REGISTRY,
    classification = {},
) {
  const recomputed =
    computeEffectiveMandatoryPermissionContract(registry, classification);
  if (!same(contract, recomputed) ||
      digest(effectiveContractDigestProjection(contract)) !==
        contract.contractDigest ||
      contract.contractDigest !==
        EXPECTED_EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST ||
      contract.providerMandatoryOperationSetDigest !==
        (classification.mandatoryOperationSetDigest ??
          PROVIDER_MANDATORY_OPERATION_SET_DIGEST) ||
      contract.providerOptionalDiagnosticOperationSetDigest !==
        (classification.optionalDiagnosticOperationSetDigest ??
          PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_SET_DIGEST) ||
      contract.providerOperationClassificationVersion !==
        (classification.operationClassificationVersion ??
          PROVIDER_OPERATION_CLASSIFICATION_VERSION) ||
      contract.requiredPermissionCount !== 30 ||
      contract.conditionalPermissionCount !== 2 ||
      contract.auxiliaryPermissionCount !== 1 ||
      contract.oauthScopeCount !== 15 ||
      contract.mandatoryOperationCount !== 29 ||
      contract.optionalDiagnosticOperationCount !== 1 ||
      contract.requiredIamPermissions.includes("storage.objects.getIamPolicy") ||
      contract.requiredIamPermissions.includes("groups.read")) {
    throw new Error("effective mandatory permission contract mismatch");
  }
  return true;
}

export function evaluateOptionalDiagnostic({
  status,
  conflictsWithMandatoryIam = false,
} = {}) {
  if (![
    "failed",
    "incomplete",
    "omitted",
    "skipped",
    "success",
    "unknown",
  ].includes(status) || typeof conflictsWithMandatoryIam !== "boolean") {
    throw new Error("invalid optional diagnostic evaluation");
  }
  const conflict = conflictsWithMandatoryIam === true;
  const supplementalFailure = conflict ||
    ["failed", "incomplete", "omitted", "unknown"].includes(status);
  return deepFreeze({
    status,
    mandatoryCompletenessUnaffected: true,
    supplementalFailure,
    blocker: conflict,
    manualReviewRequired: conflict,
    policyAnalysisComplete: false,
    writeFreezeVerified: false,
    executionEligible: false,
  });
}

export function evaluateConditionalPermissionCompleteness({
  customRolesObserved = false,
  evidencedPermissions = [],
} = {}) {
  if (typeof customRolesObserved !== "boolean" ||
      !Array.isArray(evidencedPermissions) ||
      evidencedPermissions.some((permission) =>
        typeof permission !== "string")) {
    throw new Error("invalid conditional permission evidence");
  }
  const requiredConditionalPermissions =
    customRolesObserved ? ["iam.roles.get"] : [];
  const evidence = new Set(evidencedPermissions);
  const missingConditionalPermissions =
    requiredConditionalPermissions.filter((permission) =>
      !evidence.has(permission));
  return deepFreeze({
    requiredConditionalPermissions,
    missingConditionalPermissions,
    policyAnalysisComplete: missingConditionalPermissions.length === 0,
  });
}

assertReadonlyPermissionManifest();
assertEffectiveMandatoryPermissionContract();
