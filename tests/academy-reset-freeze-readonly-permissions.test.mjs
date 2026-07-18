import assert from "node:assert/strict";
import crypto from "node:crypto";
import test from "node:test";

import {
  PROVIDER_MANDATORY_OPERATION_IDS,
  PROVIDER_MANDATORY_OPERATION_IDS_DIGEST as
    PROVIDER_MANDATORY_OPERATION_SET_DIGEST,
  PROVIDER_OPERATION_CLASSIFICATION_VERSION,
  PROVIDER_OPERATION_IDS,
  PROVIDER_OPERATION_REGISTRY,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS,
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS_DIGEST as
    PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_SET_DIGEST,
} from "../functions/scripts/academy-reset-freeze-provider-operations.mjs";
import {
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT,
  EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
  EXISTING_23_REVIEWED_RECORDS_DIGEST,
  EXPECTED_EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
  EXPECTED_READONLY_PERMISSION_MANIFEST_DIGEST,
  FORBIDDEN_MUTATION_PERMISSION_REGISTRY,
  FORBIDDEN_PRIVILEGE_ESCALATION_LITERAL_REGISTRY,
  IAM_EVIDENCE_POLICY_REGISTRY,
  OFFICIAL_EVIDENCE_SET_DIGEST,
  OFFICIAL_IAM_REFERENCE_REQUIRED_OPERATION_IDS,
  PERMISSION_RESEARCH_ARTIFACT_SHA256,
  READONLY_PERMISSION_MANIFEST_DIGEST,
  READONLY_PERMISSION_MANIFEST_VERSION,
  READONLY_PERMISSION_OPERATION_IDS,
  READONLY_PERMISSION_RECORD_COUNT,
  READONLY_PERMISSION_RECORDS,
  READONLY_PERMISSION_REGISTRY,
  REVIEWED_EVIDENCE_SET_DIGEST,
  assertEffectiveMandatoryPermissionContract,
  assertReadonlyPermissionManifest,
  classifySemanticTerminalAction,
  computeEffectiveMandatoryPermissionContract,
  computeReadonlyPermissionManifestDigest,
  convertPermissionRecordToReviewedEvidence,
  evaluateConditionalPermissionCompleteness,
  evaluateOptionalDiagnostic,
} from "../functions/scripts/academy-reset-freeze-readonly-permissions.mjs";

const EXPECTED_RECORD_KEYS = [
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
].sort();
const EXPECTED_EVIDENCE_KEYS = [
  "accessedAt",
  "evidenceType",
  "title",
  "url",
].sort();
const EXPECTED_REQUIRED_PERMISSIONS = [
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
  "resourcemanager.folders.get",
  "resourcemanager.folders.getIamPolicy",
  "resourcemanager.organizations.get",
  "resourcemanager.organizations.getIamPolicy",
  "resourcemanager.projects.get",
  "resourcemanager.projects.getIamPolicy",
  "run.revisions.get",
  "run.revisions.list",
  "run.services.get",
  "run.services.list",
  "serviceusage.services.get",
  "storage.buckets.get",
  "storage.objects.get",
];
const EXPECTED_OAUTH_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/cloud-platform.read-only",
  "https://www.googleapis.com/auth/cloud-scheduler",
  "https://www.googleapis.com/auth/cloudplatformfolders",
  "https://www.googleapis.com/auth/cloudplatformfolders.readonly",
  "https://www.googleapis.com/auth/cloudplatformorganizations",
  "https://www.googleapis.com/auth/cloudplatformorganizations.readonly",
  "https://www.googleapis.com/auth/cloudplatformprojects",
  "https://www.googleapis.com/auth/cloudplatformprojects.readonly",
  "https://www.googleapis.com/auth/devstorage.full_control",
  "https://www.googleapis.com/auth/devstorage.read_only",
  "https://www.googleapis.com/auth/devstorage.read_write",
  "https://www.googleapis.com/auth/firebase",
  "https://www.googleapis.com/auth/firebase.readonly",
  "https://www.googleapis.com/auth/iam",
];
const OFFICIAL_HOSTS = new Set([
  "cloud.google.com",
  "docs.cloud.google.com",
  "firebase.google.com",
  "policytroubleshooter.googleapis.com",
  "www.googleapis.com",
]);
const EXISTING_23_RECORD_DIGEST_FIXTURE = {
  "cloudbuild.v1.projects.locations.builds.get":
    "bd982cb35517206d423f255d5e8190c04e8362cff89592e47bd9fe569b09e13e",
  "cloudfunctions.v2.projects.locations.functions.get":
    "61fee1630c1719a8980ea5a1239b2c3bf6b0858c7df164712d600c5cdeffde34",
  "cloudfunctions.v2.projects.locations.functions.list":
    "23867afe28a21a18632cce803cf84bf730ff4bd3bded792a651f226f5b500b67",
  "cloudresourcemanager.v3.folders.get":
    "aec3f95e5020e6aced16d6bdccd55f5a8351ba316ffddaa4a39aadf2871d1b6e",
  "cloudresourcemanager.v3.folders.getIamPolicy":
    "4062531ab7c536033aa9f0578526239a02f50db4c251eb34cba9d87522675f74",
  "cloudresourcemanager.v3.organizations.getIamPolicy":
    "5763f0debbb5a7ba4ff8420dba1d2b850563515d5f6f45b73789170a39c86766",
  "cloudresourcemanager.v3.projects.get":
    "504a4b5ec2edca6abb5eb30a1f24abca4cd8a22de62cf1375336f6dfa54c4d45",
  "cloudscheduler.v1.projects.locations.jobs.get":
    "0d3f22576a8a082c1e2083257dfbf9453e4548b5e428f5bef30273fb2e191ab0",
  "cloudscheduler.v1.projects.locations.jobs.list":
    "ac466590e339771468c6c6ab51773e2d8d2d18edeafd3c10796989cec085831d",
  "firebaserules.v1.projects.releases.get":
    "0829dc6373b605df54505e135156184e4d028d1e9046fe8ac0b20056acee7641",
  "firebaserules.v1.projects.rulesets.get":
    "d15ae4dfd72bbdb376df355ff198c062c3cb91da7a057c3e973b408f85cd64e0",
  "iam.v1.projects.roles.get":
    "60c975835bf149762958c61c2ab114f796ba5d3dbcaf3057bb97fdc8bcf4a556",
  "iam.v1.projects.roles.list":
    "244551291229a4bba2a28672429a0d54f069d602f6d6a424a79fbe7cd6b35852",
  "iam.v1.projects.serviceAccounts.get":
    "de1a7e9817a56546f57e8ff028072e3e21cf832363de78b0385d4182e20da0bc",
  "iam.v1.projects.serviceAccounts.getIamPolicy":
    "1fda9affd00990e52ccb3199f320930b7209ba3fd4d045a2e28aac3c48eaee82",
  "iam.v1.projects.serviceAccounts.list":
    "2ef2155b3591f48471c2393143c18d458e3972eef22ebd5a196ea42c423cdaf3",
  "iam.v2.policies.denypolicies.get":
    "5241b13e7bb895ca1badb083bf507f1bf0f827e2f586301b17c0ebd437779aed",
  "iam.v2.policies.denypolicies.list":
    "4b437d3e2793e1f2252e93c0237e76dd368eac0aab3a99442991e59e9af7d2bc",
  "run.v2.projects.locations.services.get":
    "be702080e76788a5b289d119acb21ab70ab197a2343f230e6e95020f32716c16",
  "run.v2.projects.locations.services.list":
    "9f8e58c26be9a9ec8ca7a3e92d0a8a29e73096f13ea008d4c1c1b2862906ffc5",
  "run.v2.projects.locations.services.revisions.get":
    "1d326ac8fc0ef9417e4d15131924d0d4ab9990e224ad97005891cda207b57583",
  "run.v2.projects.locations.services.revisions.list":
    "08b2c27df62a1c594da537d84b5597b4623832616b2cba6d4e494c846ed766c4",
  "serviceusage.v1.projects.services.get":
    "970003003e78336addb36f84ec23b194e7e508d09cd9b038714715df2e0de9e2",
};
const FORMERLY_PARTIALLY_PROVEN_OPERATION_IDS = [
  "cloudasset.v1.projects.analyzeIamPolicy",
  "cloudresourcemanager.v3.organizations.get",
  "cloudresourcemanager.v3.projects.getIamPolicy",
  "policytroubleshooter.v3.iam.troubleshoot",
  "storage.v1.objects.getMedia",
  "storage.v1.objects.getMetadata",
];

function canonical(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${canonical(value[key])}`).join(",")}}`;
}

function digest(value) {
  return crypto.createHash("sha256").update(canonical(value)).digest("hex");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) {
    return value;
  }
  Reflect.ownKeys(value).forEach((key) => deepFreeze(value[key]));
  return Object.freeze(value);
}

function cloneRegistry() {
  const clone = Object.create(null);
  for (const operationId of READONLY_PERMISSION_OPERATION_IDS) {
    clone[operationId] =
      structuredClone(READONLY_PERMISSION_REGISTRY[operationId]);
  }
  return clone;
}

function assertCanonicalFrozenShape(value) {
  if (!value || typeof value !== "object") return;
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Reflect.ownKeys(value).some((key) => typeof key === "symbol"),
      false);
  if (Array.isArray(value)) {
    assert.equal(Object.getPrototypeOf(value), Array.prototype);
    assert.deepEqual(Reflect.ownKeys(value).sort(), [
      ...Array.from({length: value.length}, (_, index) => String(index)),
      "length",
    ].sort());
    value.forEach(assertCanonicalFrozenShape);
    return;
  }
  assert.equal(Object.getPrototypeOf(value), Object.prototype);
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    assert.equal(descriptor.enumerable, true);
    assert.equal(Object.hasOwn(descriptor, "value"), true);
    assert.notEqual(descriptor.value, undefined);
    assertCanonicalFrozenShape(descriptor.value);
  }
}

test("manifest pins exact count, classifications, statuses, and key parity", () => {
  assert.equal(READONLY_PERMISSION_MANIFEST_VERSION,
      "academy_reset_freeze_readonly_permissions.v2");
  assert.equal(PERMISSION_RESEARCH_ARTIFACT_SHA256,
      "92c38c6007050d5427fafb8a4d09c8963592f492e7bc29345281055ed64be704");
  assert.equal(READONLY_PERMISSION_RECORD_COUNT, 30);
  assert.deepEqual(READONLY_PERMISSION_OPERATION_IDS, PROVIDER_OPERATION_IDS);
  assert.deepEqual(Object.keys(READONLY_PERMISSION_REGISTRY),
      PROVIDER_OPERATION_IDS);
  assert.equal(Object.getPrototypeOf(READONLY_PERMISSION_REGISTRY), null);
  assert.equal(Object.isFrozen(READONLY_PERMISSION_REGISTRY), true);
  assert.deepEqual(Object.keys(IAM_EVIDENCE_POLICY_REGISTRY),
      PROVIDER_OPERATION_IDS);
  assert.equal(Object.getPrototypeOf(IAM_EVIDENCE_POLICY_REGISTRY), null);
  assert.equal(Object.isFrozen(IAM_EVIDENCE_POLICY_REGISTRY), true);
  assert.equal(READONLY_PERMISSION_RECORDS.filter(
      ({evidenceStatus}) => evidenceStatus === "PROVEN").length, 29);
  assert.equal(READONLY_PERMISSION_RECORDS.filter(
      ({evidenceStatus}) => evidenceStatus === "PARTIALLY_PROVEN").length, 1);
  assert.equal(READONLY_PERMISSION_RECORDS.filter(
      ({evidenceStatus}) => evidenceStatus === "UNPROVEN").length, 0);
  assert.deepEqual(READONLY_PERMISSION_RECORDS.filter(
      ({observationRequirement}) => observationRequirement === "mandatory")
      .map(({operationId}) => operationId), PROVIDER_MANDATORY_OPERATION_IDS);
  assert.deepEqual(READONLY_PERMISSION_RECORDS.filter(
      ({observationRequirement}) =>
        observationRequirement === "optional_diagnostic")
      .map(({operationId}) => operationId),
  PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_IDS);
  assert.doesNotThrow(() => assertReadonlyPermissionManifest());
});

test("all records and evidence use exact deeply frozen data shapes", () => {
  for (const record of READONLY_PERMISSION_RECORDS) {
    assert.deepEqual(Object.keys(record).sort(), EXPECTED_RECORD_KEYS);
    assertCanonicalFrozenShape(record);
    assert.equal(record.operationId,
        READONLY_PERMISSION_REGISTRY[record.operationId].operationId);
    for (const evidence of record.officialEvidence) {
      assert.deepEqual(Object.keys(evidence).sort(), EXPECTED_EVIDENCE_KEYS);
      assert.equal(OFFICIAL_HOSTS.has(new URL(evidence.url).hostname), true);
    }
    assert.equal(
        digest(convertPermissionRecordToReviewedEvidence(record)),
        record.reviewedContentDigest,
    );
  }
});

test("reviewed evidence round-trips and preserves the existing 23 fixture", () => {
  const ids = Object.keys(EXISTING_23_RECORD_DIGEST_FIXTURE).sort();
  assert.equal(ids.length, 23);
  assert.deepEqual(ids, PROVIDER_OPERATION_IDS.filter((operationId) =>
    !FORMERLY_PARTIALLY_PROVEN_OPERATION_IDS.includes(operationId) &&
      operationId !== "storage.v1.buckets.get"));
  const projected = ids.map((operationId) => {
    const record = READONLY_PERMISSION_REGISTRY[operationId];
    assert.equal(record.reviewedContentDigest,
        EXISTING_23_RECORD_DIGEST_FIXTURE[operationId]);
    return convertPermissionRecordToReviewedEvidence(record);
  });
  assert.equal(digest(projected), EXISTING_23_REVIEWED_RECORDS_DIGEST);
  assert.equal(EXISTING_23_REVIEWED_RECORDS_DIGEST,
      "d276ef746d76db655dcd4d875a6a493d755d9940ab342ff631e576ca8ab76f51");
  assert.equal(digest(READONLY_PERMISSION_RECORDS.map(
      convertPermissionRecordToReviewedEvidence)), REVIEWED_EVIDENCE_SET_DIGEST);
});

test("manifest and official evidence digests are literal and reproducible", () => {
  assert.equal(REVIEWED_EVIDENCE_SET_DIGEST,
      "9b72f1f8be2800b93174d500a1b5e60d950e7748168c38ce2ca02ca666aeb301");
  assert.equal(OFFICIAL_EVIDENCE_SET_DIGEST,
      "8f3b4b2797483f4581a3cd0e58c66efa54b4726470bfcc2bfa5c2989085d3e80");
  assert.equal(READONLY_PERMISSION_MANIFEST_DIGEST,
      EXPECTED_READONLY_PERMISSION_MANIFEST_DIGEST);
  assert.equal(computeReadonlyPermissionManifestDigest(),
      "73cb701e479a2dc63996ad71c278ddc2b68df3cebcb04ba77cbc609e3de8679a");
});

test("Cloud Asset, Resource Manager, and Troubleshooter are exact", () => {
  const asset =
    READONLY_PERMISSION_REGISTRY["cloudasset.v1.projects.analyzeIamPolicy"];
  assert.deepEqual(asset.requiredIamPermissions, [
    "cloudasset.assets.analyzeIamPolicy",
    "cloudasset.assets.searchAllIamPolicies",
    "cloudasset.assets.searchAllResources",
  ]);
  assert.deepEqual(asset.conditionalPermissions, ["iam.roles.get"]);
  assert.deepEqual(asset.auxiliaryPermissions, ["serviceusage.services.use"]);
  assert.equal(asset.permissionSemantics, "all_of");

  for (const operationId of [
    "cloudresourcemanager.v3.organizations.get",
    "cloudresourcemanager.v3.projects.getIamPolicy",
  ]) {
    assert.equal(READONLY_PERMISSION_REGISTRY[operationId].officialEvidence
        .some(({evidenceType}) =>
          evidenceType === "official_iam_permission_reference"), true);
  }

  const troubleshooter =
    READONLY_PERMISSION_REGISTRY["policytroubleshooter.v3.iam.troubleshoot"];
  assert.equal(troubleshooter.observationRequirement, "optional_diagnostic");
  assert.equal(troubleshooter.evidenceStatus, "PARTIALLY_PROVEN");
  assert.deepEqual(troubleshooter.requiredIamPermissions, []);
  assert.deepEqual(troubleshooter.conditionalPermissions, ["groups.read"]);
});

test("Storage permissions match exact descriptor behavior", () => {
  const bucket = READONLY_PERMISSION_REGISTRY["storage.v1.buckets.get"];
  const media = READONLY_PERMISSION_REGISTRY["storage.v1.objects.getMedia"];
  const metadata =
    READONLY_PERMISSION_REGISTRY["storage.v1.objects.getMetadata"];
  const mediaDescriptor =
    PROVIDER_OPERATION_REGISTRY["storage.v1.objects.getMedia"];
  const metadataDescriptor =
    PROVIDER_OPERATION_REGISTRY["storage.v1.objects.getMetadata"];
  const bucketDescriptor =
    PROVIDER_OPERATION_REGISTRY["storage.v1.buckets.get"];
  assert.deepEqual(bucket.requiredIamPermissions, ["storage.buckets.get"]);
  assert.deepEqual(bucket.conditionalPermissions, []);
  assert.equal(bucketDescriptor.query.properties.projection.const, "noAcl");
  assert.deepEqual(bucketDescriptor.query.required, ["projection"]);
  assert.deepEqual(media.requiredIamPermissions, ["storage.objects.get"]);
  assert.deepEqual(media.conditionalPermissions, []);
  assert.equal(mediaDescriptor.query.properties.alt.const, "media");
  assert.equal(mediaDescriptor.query.required.includes("alt"), true);
  assert.equal(Object.hasOwn(mediaDescriptor.query.properties, "projection"),
      false);
  assert.deepEqual(metadata.requiredIamPermissions, ["storage.objects.get"]);
  assert.deepEqual(metadata.conditionalPermissions,
      ["storage.objects.getIamPolicy"]);
  assert.equal(
      Object.hasOwn(metadataDescriptor.query.properties, "projection"), false);
});

test("effective mandatory contract has exact sets, counts, and linkage", () => {
  const contract = EFFECTIVE_MANDATORY_PERMISSION_CONTRACT;
  const {contractDigest, ...digestProjection} = contract;
  assert.equal(digest(digestProjection), contractDigest);
  assert.equal(contract.contractDigest,
      EXPECTED_EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST);
  assert.equal(EFFECTIVE_MANDATORY_PERMISSION_CONTRACT_DIGEST,
      "957f28b97f279a58f43ad7e4b4b4e74d90610a4329753f92159aff6e6e4b57c2");
  assert.equal(contract.providerOperationClassificationVersion,
      PROVIDER_OPERATION_CLASSIFICATION_VERSION);
  assert.equal(contract.providerMandatoryOperationSetDigest,
      PROVIDER_MANDATORY_OPERATION_SET_DIGEST);
  assert.equal(contract.providerOptionalDiagnosticOperationSetDigest,
      PROVIDER_OPTIONAL_DIAGNOSTIC_OPERATION_SET_DIGEST);
  assert.equal(contract.mandatoryOperationCount, 29);
  assert.equal(contract.optionalDiagnosticOperationCount, 1);
  assert.equal(contract.requiredPermissionCount, 30);
  assert.equal(contract.conditionalPermissionCount, 2);
  assert.equal(contract.auxiliaryPermissionCount, 1);
  assert.equal(contract.oauthScopeCount, 15);
  assert.deepEqual(contract.requiredIamPermissions,
      EXPECTED_REQUIRED_PERMISSIONS);
  assert.deepEqual(contract.conditionalPermissions,
      ["iam.roles.get", "storage.objects.getIamPolicy"]);
  assert.deepEqual(contract.auxiliaryPermissions,
      ["serviceusage.services.use"]);
  assert.deepEqual(contract.oauthScopes, EXPECTED_OAUTH_SCOPES);
  assert.equal(contract.requiredIamPermissions.includes("groups.read"), false);
  assert.equal(contract.requiredIamPermissions
      .includes("storage.objects.getIamPolicy"), false);
  assert.deepEqual(
      contract.sourceOperations.requiredIamPermissions["storage.buckets.get"],
      ["storage.v1.buckets.get"],
  );
  assert.deepEqual(
      contract.sourceOperations.requiredIamPermissions["storage.objects.get"],
      ["storage.v1.objects.getMedia", "storage.v1.objects.getMetadata"],
  );
  assert.deepEqual(
      contract.sourceOperations.conditionalPermissions["iam.roles.get"],
      ["cloudasset.v1.projects.analyzeIamPolicy"],
  );
  assert.equal(contract.sourceOperations.auxiliaryPermissions[
      "serviceusage.services.use"].includes(
      "policytroubleshooter.v3.iam.troubleshoot"), false);
  assert.doesNotThrow(() => assertEffectiveMandatoryPermissionContract());
  assert.deepEqual(computeEffectiveMandatoryPermissionContract(), contract);
});

test("mutation classifier and exact forbidden registry reject critical writes", () => {
  for (const terminal of [
    "setIamPolicy",
    "actAs",
    "delete",
    "update",
    "getAccessToken",
    "create",
    "patch",
    "signBlob",
    "signJwt",
    "pause",
    "resume",
    "deploy",
    "disable",
    "enable",
    "insert",
    "move",
    "restore",
    "setOrgPolicy",
    "undelete",
  ]) {
    assert.equal(
        classifySemanticTerminalAction(`fixture.v1.resource.${terminal}`)
            .classification,
        "mutation",
    );
  }
  assert.equal(classifySemanticTerminalAction(
      "fixture.v1.resource.getIamPolicy").classification, "read_only");
  assert.equal(classifySemanticTerminalAction(
      "fixture.v1.resource.updater").classification, "unknown");
  for (const permission of [
    "resourcemanager.projects.setIamPolicy",
    "iam.serviceAccounts.actAs",
    "datastore.entities.delete",
    "cloudscheduler.jobs.update",
    "iam.serviceAccounts.getAccessToken",
    "iam.serviceAccounts.signBlob",
    "iam.serviceAccountKeys.create",
    "firebaseauth.users.delete",
  ]) {
    assert.equal(Object.hasOwn(
        FORBIDDEN_MUTATION_PERMISSION_REGISTRY, permission), true);
  }
  assert.equal(Object.getPrototypeOf(
      FORBIDDEN_MUTATION_PERMISSION_REGISTRY), null);
  assert.equal(Object.isFrozen(FORBIDDEN_MUTATION_PERMISSION_REGISTRY), true);
  assert.equal(Object.hasOwn(
      FORBIDDEN_PRIVILEGE_ESCALATION_LITERAL_REGISTRY,
      "roles/iam.serviceAccountTokenCreator",
  ), true);
});

test("semantic permission actions and escalation roles fail closed in compute", () => {
  for (const permission of [
    "example.resources.delete",
    "example.resources.update",
    "example.resources.patch",
    "example.resources.setIamPolicy",
    "example.serviceAccounts.actAs",
    "iam.serviceAccounts.getAccessToken",
    "roles/iam.serviceAccountTokenCreator",
  ]) {
    const registry = cloneRegistry();
    registry["run.v2.projects.locations.services.get"]
        .requiredIamPermissions = [permission];
    const frozen = deepFreeze(registry);
    assert.throws(
        () => computeEffectiveMandatoryPermissionContract(frozen),
        /mutation or privilege escalation rejected/,
    );
    assert.throws(
        () => assertReadonlyPermissionManifest(frozen),
        /mutation or privilege escalation rejected/,
    );
  }
  for (const permission of [
    "example.resources.updater",
    "example.resources.archive",
    "example.resources.publish",
  ]) {
    const registry = cloneRegistry();
    registry["run.v2.projects.locations.services.get"]
        .requiredIamPermissions = [permission];
    const frozen = deepFreeze(registry);
    assert.throws(
        () => computeEffectiveMandatoryPermissionContract(frozen),
        /unknown permission terminal rejected/,
    );
    assert.throws(
        () => assertReadonlyPermissionManifest(frozen),
        /unknown permission terminal rejected/,
    );
  }
  const readSafeButTampered = cloneRegistry();
  readSafeButTampered["run.v2.projects.locations.services.get"]
      .requiredIamPermissions = ["run.services.list"];
  assert.throws(
      () => computeEffectiveMandatoryPermissionContract(
          deepFreeze(readSafeButTampered),
      ),
      /effective contract candidate manifest mismatch/,
  );
});

test("optional diagnostic evaluation never establishes mandatory gates", () => {
  for (const status of ["skipped", "success"]) {
    const result = evaluateOptionalDiagnostic({status});
    assert.equal(result.mandatoryCompletenessUnaffected, true);
    assert.equal(result.policyAnalysisComplete, false);
    assert.equal(result.writeFreezeVerified, false);
    assert.equal(result.executionEligible, false);
    assert.equal(result.blocker, false);
  }
  for (const status of ["unknown", "omitted", "incomplete", "failed"]) {
    assert.equal(
        evaluateOptionalDiagnostic({status}).supplementalFailure, true);
  }
  const conflict = evaluateOptionalDiagnostic({
    status: "success",
    conflictsWithMandatoryIam: true,
  });
  assert.equal(conflict.blocker, true);
  assert.equal(conflict.manualReviewRequired, true);
  assert.equal(conflict.supplementalFailure, true);
});

test("conditional completeness fails closed for unresolved custom roles", () => {
  assert.deepEqual(evaluateConditionalPermissionCompleteness({
    customRolesObserved: true,
    evidencedPermissions: [],
  }), {
    requiredConditionalPermissions: ["iam.roles.get"],
    missingConditionalPermissions: ["iam.roles.get"],
    policyAnalysisComplete: false,
  });
  assert.equal(evaluateConditionalPermissionCompleteness({
    customRolesObserved: true,
    evidencedPermissions: ["iam.roles.get"],
  }).policyAnalysisComplete, true);
  assert.equal(evaluateConditionalPermissionCompleteness({
    customRolesObserved: false,
  }).policyAnalysisComplete, true);
});

test("manifest rejects add, remove, swap, and reclassification tampering", () => {
  const added = cloneRegistry();
  added["unapproved.v1.resources.get"] =
    structuredClone(added[READONLY_PERMISSION_OPERATION_IDS[0]]);
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(added)));

  const removed = cloneRegistry();
  delete removed[READONLY_PERMISSION_OPERATION_IDS[0]];
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(removed)));

  const swapped = cloneRegistry();
  const [first, second] = READONLY_PERMISSION_OPERATION_IDS;
  [swapped[first], swapped[second]] = [swapped[second], swapped[first]];
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(swapped)));

  const reclassified = cloneRegistry();
  reclassified[first].observationRequirement = "optional_diagnostic";
  assert.throws(() =>
    assertReadonlyPermissionManifest(deepFreeze(reclassified)));
});

test("manifest rejects category, mutation, evidence, and coherent tampering", () => {
  const operationId = "run.v2.projects.locations.services.get";

  const moved = cloneRegistry();
  moved[operationId].conditionalPermissions =
    moved[operationId].requiredIamPermissions;
  moved[operationId].requiredIamPermissions = [];
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(moved)));

  const mutation = cloneRegistry();
  mutation[operationId].requiredIamPermissions =
    ["iam.serviceAccounts.getAccessToken"];
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(mutation)));

  const evidence = cloneRegistry();
  evidence[operationId].officialEvidence[0].url =
    "https://example.com/unapproved";
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(evidence)));

  const oauthOnly = cloneRegistry();
  oauthOnly[operationId].officialEvidence = [{
    title: "Discovery",
    url: "https://www.googleapis.com/discovery/v1/apis/run/v2/rest",
    evidenceType: "api_discovery",
    accessedAt: "2026-07-17",
  }];
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(oauthOnly)));

  const coherent = cloneRegistry();
  coherent[operationId].notes = `${coherent[operationId].notes} tampered`;
  coherent[operationId].reviewedContentDigest = digest(
      convertPermissionRecordToReviewedEvidence(coherent[operationId]),
  );
  assert.throws(() => assertReadonlyPermissionManifest(deepFreeze(coherent)));
});

test("exact evidence policy rejects OAuth-only promoted IAM proof", () => {
  assert.deepEqual(OFFICIAL_IAM_REFERENCE_REQUIRED_OPERATION_IDS, [
    "cloudresourcemanager.v3.organizations.get",
    "cloudresourcemanager.v3.projects.getIamPolicy",
  ]);
  for (const operationId of OFFICIAL_IAM_REFERENCE_REQUIRED_OPERATION_IDS) {
    assert.equal(
        IAM_EVIDENCE_POLICY_REGISTRY[operationId].iamProofRule,
        "official_iam_permission_reference_required",
    );
    const registry = cloneRegistry();
    registry[operationId].officialEvidence = [
      {
        title: "Method identity and OAuth scopes only",
        url: "https://docs.cloud.google.com/resource-manager/reference/rest/v3/projects/get",
        evidenceType: "rest_method",
        accessedAt: "2026-07-17",
      },
      {
        title: "Discovery OAuth scopes",
        url: "https://www.googleapis.com/discovery/v1/apis/cloudresourcemanager/v3/rest",
        evidenceType: "api_discovery",
        accessedAt: "2026-07-17",
      },
    ];
    assert.throws(
        () => assertReadonlyPermissionManifest(deepFreeze(registry)),
        /OAuth-only evidence cannot prove IAM.*official_iam_permission_reference_required/,
    );
  }
  assert.equal(
      IAM_EVIDENCE_POLICY_REGISTRY[
          "cloudfunctions.v2.projects.locations.functions.get"
      ].iamProofRule,
      "direct_rest_method_iam",
  );
});

test("literal metadata and candidate contract tampering fails closed", () => {
  assert.throws(() => assertReadonlyPermissionManifest(
      READONLY_PERMISSION_REGISTRY,
      PROVIDER_OPERATION_REGISTRY,
      {manifestVersion: "academy_reset_freeze_readonly_permissions.v1"},
  ));
  assert.throws(() => assertReadonlyPermissionManifest(
      READONLY_PERMISSION_REGISTRY,
      PROVIDER_OPERATION_REGISTRY,
      {manifestDigest: "0".repeat(64)},
  ));
  assert.throws(() => assertReadonlyPermissionManifest(
      READONLY_PERMISSION_REGISTRY,
      PROVIDER_OPERATION_REGISTRY,
      {officialEvidenceSetDigest: "0".repeat(64)},
  ));
  assert.throws(() => computeEffectiveMandatoryPermissionContract(
      READONLY_PERMISSION_REGISTRY,
      {operationClassificationVersion: "tampered.v2"},
  ), /effective contract operation classification mismatch/);
  assert.throws(() => computeEffectiveMandatoryPermissionContract(
      READONLY_PERMISSION_REGISTRY,
      {mandatoryOperationSetDigest: "0".repeat(64)},
  ), /effective contract operation classification mismatch/);

  for (const mutate of [
    (contract) => contract.requiredIamPermissions.pop(),
    (contract) => contract.requiredIamPermissions.push("storage.objects.delete"),
    (contract) => {
      [contract.requiredIamPermissions[0], contract.requiredIamPermissions[1]] =
        [contract.requiredIamPermissions[1], contract.requiredIamPermissions[0]];
    },
    (contract) => {
      contract.conditionalPermissions[0] = "groups.read";
    },
    (contract) => {
      contract.contractDigest = "0".repeat(64);
    },
  ]) {
    const contract =
      structuredClone(EFFECTIVE_MANDATORY_PERMISSION_CONTRACT);
    mutate(contract);
    assert.throws(() => assertEffectiveMandatoryPermissionContract(
        deepFreeze(contract)));
  }
});
