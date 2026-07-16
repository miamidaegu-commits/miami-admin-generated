import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";
import {
  ACADEMY_SCOPED_RESET_REGISTRY,
  CREDIT_SOURCE_REFERENCE_MAPPINGS,
  KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION,
  KNOWN_CREDIT_SOURCE_TYPE_CARDINALITY,
  KNOWN_CREDIT_SOURCE_TYPE_KEYS,
  KNOWN_CREDIT_SOURCE_TYPE_TARGETS,
  REFERENCE_CARDINALITY_POLICY_VERSION,
  REFERENCE_FIELD_SPECS,
  assertReferenceCardinalityInvariant,
} from "../functions/scripts/academy-scoped-test-data-reset-registry.mjs";
import {
  CANONICAL_PLAN_SCHEMA,
  REDACTED_SUMMARY_SCHEMA,
  SENSITIVE_MANIFEST_SCHEMA,
} from "../functions/scripts/plan-academy-scoped-test-data-reset.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(__dirname, "..");
const plannerPath = path.join(
    repositoryRoot,
    "functions",
    "scripts",
    "plan-academy-scoped-test-data-reset.mjs",
);
const registryPath = path.join(
    repositoryRoot,
    "functions",
    "scripts",
    "academy-scoped-test-data-reset-registry.mjs",
);
const plannerSource = fs.readFileSync(plannerPath, "utf8");
const registrySource = fs.readFileSync(registryPath, "utf8");

test("top-level output keysets are pinned to shared schema descriptors", () => {
  const fixture = {
    canonical: {
      count: 78,
      digest: "bb183c2afef07bd759f34c67d6862274f1f2a17b63f7b0b017637b0ebf2ee2e4",
      schema: CANONICAL_PLAN_SCHEMA,
    },
    summary: {
      count: 91,
      digest: "6ab9dbc48c3cc6732b26c0887f12b732182950212aa7a54ddd22b2d2e8584d82",
      schema: REDACTED_SUMMARY_SCHEMA,
    },
    manifest: {
      count: 88,
      digest: "9671c78f1684dc48a6f3074c8beaeed33120f0ba268a1c0a262d035ef0c01153",
      schema: SENSITIVE_MANIFEST_SCHEMA,
    },
  };
  for (const {count, digest, schema} of Object.values(fixture)) {
    assert.equal(Object.isFrozen(schema), true);
    assert.equal(Object.isFrozen(schema.requiredKeys), true);
    assert.equal(Object.isFrozen(schema.optionalKeys), true);
    assert.equal(Object.isFrozen(schema.fieldTypes), true);
    assert.equal(schema.requiredKeys.length, count);
    assert.deepEqual(schema.optionalKeys, []);
    assert.equal(
        crypto.createHash("sha256")
            .update(JSON.stringify(schema.requiredKeys))
            .digest("hex"),
        digest,
    );
  }
  assert.match(plannerSource, /validateExactOutputSchema\(\s*summary,/);
  assert.match(plannerSource, /validateExactOutputSchema\(\s*manifest,/);
  assert.match(plannerSource, /validateExactOutputSchema\(\s*canonicalPlan,/);
});

test("every registry reference field has one explicit cardinality spec", () => {
  const counts = assertReferenceCardinalityInvariant();
  assert.equal(REFERENCE_CARDINALITY_POLICY_VERSION, 1);
  assert.equal(counts.totalFields, REFERENCE_FIELD_SPECS.length);
  assert.equal(counts.scalarFields + counts.arrayFields, counts.totalFields);
  assert.equal(
      new Set(REFERENCE_FIELD_SPECS.map(({collectionName, field}) =>
        `${collectionName}\u0000${field}`)).size,
      REFERENCE_FIELD_SPECS.length,
  );
  assert.equal(
      REFERENCE_FIELD_SPECS.find(({collectionName, field}) =>
        collectionName === "lessons" && field === "packageId").cardinality,
      "optional_scalar",
  );
  assert.equal(
      REFERENCE_FIELD_SPECS.find(({collectionName, field}) =>
        collectionName === "privateLessonSlots" &&
        field === "eligibleStudentIds").cardinality,
      "optional_array",
  );
  assert.doesNotMatch(registrySource, /string_or_array/);
  assert.doesNotMatch(plannerSource, /valueType:\s*"string_or_array"/);
});

test("credit source allowlist exact schema is statically pinned", () => {
  const expectedTargets = {
    "fixed-private-renewal": "fixedPrivateRenewalBatches",
    "fixedPrivateReservation": "privateLessonReservations",
    "groupClass": "groupClasses",
    "groupLesson": "groupLessons",
    "lesson": "lessons",
    "privateReservation": "privateLessonReservations",
    "studentPackage": "studentPackages",
  };
  const expectedKeys = Object.keys(expectedTargets).sort();
  assert.equal(
      Object.getPrototypeOf(CREDIT_SOURCE_REFERENCE_MAPPINGS),
      null,
  );
  assert.equal(Object.isFrozen(CREDIT_SOURCE_REFERENCE_MAPPINGS), true);
  assert.deepEqual(KNOWN_CREDIT_SOURCE_TYPE_KEYS, expectedKeys);
  assert.equal(KNOWN_CREDIT_SOURCE_TYPE_CARDINALITY, 7);
  assert.equal(expectedKeys.length, 7);
  assert.equal(
      KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION,
      "credit_source_reference_allowlist.v2",
  );
  assert.deepEqual(KNOWN_CREDIT_SOURCE_TYPE_TARGETS, expectedTargets);
  assert.deepEqual(
      Object.fromEntries(
          Object.entries(CREDIT_SOURCE_REFERENCE_MAPPINGS)
              .map(([key, mapping]) => [key, mapping.targetCollection]),
      ),
      expectedTargets,
  );
  for (const mapping of Object.values(CREDIT_SOURCE_REFERENCE_MAPPINGS)) {
    assert.equal(mapping.explicitIdCardinality, "optional_scalar");
  }
  for (const inheritedKey of [
    "constructor",
    "__proto__",
    "prototype",
    "toString",
    "valueOf",
    "hasOwnProperty",
  ]) {
    assert.equal(
        Object.hasOwn(CREDIT_SOURCE_REFERENCE_MAPPINGS, inheritedKey),
        false,
    );
  }
  assert.equal(
      /CREDIT_SOURCE_REFERENCE_MAPPINGS\s*\[/.test(plannerSource),
      false,
  );
  assert.equal(
      /(?:CREDIT_SOURCE_REFERENCE_MAPPINGS|mappings)\s*\[\s*sourceType\s*\]/
          .test(`${plannerSource}\n${registrySource}`),
      false,
  );
  assert.equal(plannerSource.includes("getKnownCreditSourceMapping"), true);
  assert.equal(
      plannerSource.includes(
          "Object.hasOwn(CREDIT_SOURCE_REFERENCE_MAPPINGS, sourceType)",
      ),
      true,
  );
});

test("planner contains no Firestore or Auth mutation implementation", () => {
  const mutationCalls = [
    /\.batch\s*\(/,
    /\.bulkWriter\s*\(/,
    /\.doc\s*\(/,
    /\.runTransaction\s*\(/,
    /\bWriteBatch\b/,
    /firebase-admin\/auth/,
    /getAuth\s*\(/,
  ];
  mutationCalls.forEach((pattern) => {
    assert.equal(
        pattern.test(plannerSource),
        false,
        `Forbidden planner capability matched ${pattern}`,
    );
  });
});

test("Firestore digest encoding is typed, versioned, and fail closed", () => {
  for (const required of [
    "const FIRESTORE_VALUE_CANONICALIZATION_VERSION = 3",
    "firestoreValueCanonicalizationVersion",
    "export function canonicalizeFirestoreValue",
    "export function firestoreDocumentDigest",
    'return ["null"]',
    'return ["boolean", value]',
    'return ["string", value]',
    'return ["number", canonicalFirestoreNumber(value)]',
    '"NaN"',
    '"+Infinity"',
    '"-Infinity"',
    '"-0"',
    '"array"',
    '"map"',
    '"firestore_timestamp"',
    "String(value.seconds)",
    "String(value.nanoseconds)",
    "value.nanoseconds <= 999999999",
    "Canonical JSON numbers must be finite.",
    "Firestore value cannot be represented canonically.",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  assert.equal(
      plannerSource.includes(
          "documentDigest: firestoreDocumentDigest(data)",
      ),
      true,
  );
  const canonicalizerStart = plannerSource.indexOf(
      "export function canonicalizeFirestoreValue",
  );
  const canonicalizerEnd = plannerSource.indexOf(
      "export function firestoreDocumentDigest",
      canonicalizerStart,
  );
  assert.equal(
      plannerSource.slice(canonicalizerStart, canonicalizerEnd)
          .includes("toMillis()"),
      false,
  );
});

test("planner hard-codes read-only release gate metadata", () => {
  for (const required of [
    'mode: "read_only_plan"',
    "writeAuthorized: false",
    "executorImplemented: false",
    "actualWrites: 0",
    "backupVerified: false",
    "independentReviewApproved: false",
    "resetApproved: false",
    "executionSafetyContractVersion: EXECUTION_SAFETY_CONTRACT_VERSION",
    'planClassification: "non_executable_advisory"',
    'snapshotMode: "live_read_only_unfrozen"',
    "writeFreezeRequiredForExecution: true",
    "writeFreezeVerified: false",
    "freshPlanRequiredUnderWriteFreeze: true",
    "executorRevalidationRequired: true",
    "executionEligible: false",
  ]) {
    assert.equal(
        plannerSource.includes(required),
        true,
        `Missing read-only contract: ${required}`,
    );
  }
});

test("academy scope uses exact raw identifiers without normalization", () => {
  const classifierStart = plannerSource.indexOf(
      "function classifyKnownDocument",
  );
  const classifierEnd = plannerSource.indexOf(
      "function documentRecord",
      classifierStart,
  );
  const classifierSource =
    plannerSource.slice(classifierStart, classifierEnd);
  assert.equal(
      classifierSource.includes(
          "exactPersistedAcademyId(data.academyId)",
      ),
      true,
  );
  assert.equal(
      classifierSource.includes("normalizeText(data.academyId)"),
      false,
  );
  assert.equal(
      plannerSource.includes("academy !== academy.trim()"),
      true,
  );
});

test("paired outputs require exact parity before atomic preparation", () => {
  assert.equal(
      plannerSource.match(/assertExactPublicationParity\(/g)
          ?.length >= 2,
      true,
  );
  const writerStart = plannerSource.indexOf(
      "export function writePlannerOutputs",
  );
  const writerSource = plannerSource.slice(writerStart);
  assert.equal(
      writerSource.indexOf(
          "assertExactPublicationParity(canonicalPlan, summary, manifest)",
      ) <
        writerSource.indexOf("serializePlannerOutput(summary)"),
      true,
  );
  assert.equal(
      writerSource.indexOf("assertCanonicalPlanIntegrity(canonicalPlan)") <
        writerSource.indexOf("serializePlannerOutput(summary)"),
      true,
  );
  assert.equal(
      writerSource.indexOf("serializePlannerOutput(manifest)") <
        writerSource.indexOf("prepareAtomicFile(output.filePath"),
      true,
  );
});

test("publication parity recomputes exact candidate and finding sets", () => {
  for (const required of [
    "publicationSetContractVersion",
    "candidateSetDigestVersion",
    "candidateSetDigest",
    "findingSetDigestVersion",
    "findingSetDigest",
    "canonicalizeCandidatePublicationIdentity",
    "canonicalizeFindingPublicationIdentity",
    "canonicalizePublishedFindingRecord",
    "publishedFindingRecordDigest",
    "PUBLISHED_FINDING_RECORD_KEYS",
    "const FINDING_SET_DIGEST_VERSION = 2",
    "recomputeManifestPublicationSetContract",
    "Duplicate candidate publication identity.",
    "Duplicate published finding record.",
    "Published finding claimed digest is stale or invalid.",
    "canonicalBlockerPublishedDigestSet",
    "canonicalBlockerPublishedDigestSetFromBuckets",
    "Canonical blocker set",
    "Sensitive manifest reference blocker set",
    "Sensitive manifest blocker set",
    "contains a duplicate blocker",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  assert.doesNotMatch(
      plannerSource,
      /manifest\.blockers\.length\s*!==\s*contract\.counts\.blockerCount/,
  );
  const recordSchemaStart = plannerSource.indexOf(
      "export const SENSITIVE_MANIFEST_RECORD_KEYS",
  );
  const recordSchemaEnd = plannerSource.indexOf(
      "const OPTIONAL_SENSITIVE_MANIFEST_RECORD_KEYS",
      recordSchemaStart,
  );
  const recordSchemaSource =
    plannerSource.slice(recordSchemaStart, recordSchemaEnd);
  for (const field of [
    "rawDocumentPath",
    "typedDocumentKey",
    "collection",
    "classification",
    "plannerDisposition",
    "deletionOrderGroup",
    "academyScopeEvidence",
    "documentDigest",
    "membershipProfileDecision",
    "creditSourceEvidence",
    "teacherIdentityEvidence",
    "profilePolicyReason",
    "directReferences",
    "referenceFindings",
  ]) {
    assert.equal(recordSchemaSource.includes(`"${field}"`), true, field);
  }
  const findingSchemaStart = plannerSource.indexOf(
      "export const PUBLISHED_FINDING_SEMANTIC_KEYS",
  );
  const findingSchemaEnd = plannerSource.indexOf(
      "const CREDIT_SOURCE_EVIDENCE_KEYS",
      findingSchemaStart,
  );
  const findingSchemaSource =
    plannerSource.slice(findingSchemaStart, findingSchemaEnd);
  for (const field of [
    "severity",
    "code",
    "sourceTypedKey",
    "targetTypedKeys",
    "sourceClassification",
    "sourceDisposition",
    "targetCollectionClassification",
    "family",
    "field",
    "policyReason",
    "shapeEvidence",
    "creditSourceEvidence",
    "findingIdentityDigest",
    "findingDigest",
    "publishedFindingDigest",
  ]) {
    assert.equal(findingSchemaSource.includes(`"${field}"`), true, field);
  }
  const validatorStart = plannerSource.indexOf(
      "export function assertExactPublicationParity",
  );
  const validatorEnd = plannerSource.indexOf(
      "function buildRedactedSummary",
      validatorStart,
  );
  const validatorSource = plannerSource.slice(validatorStart, validatorEnd);
  assert.equal(
      validatorSource.includes(
          "recomputeManifestPublicationSetContract(manifest)",
      ),
      true,
  );
  assert.equal(
      validatorSource.includes(
          "stableStringify(recomputedManifestSetContract)",
      ),
      true,
  );
  assert.equal(
      plannerSource.indexOf(
          "assertExactPublicationParity(canonicalPlan, summary, manifest)",
      ) <
        plannerSource.indexOf("serializePlannerOutput(summary)"),
      true,
  );
});

test("plan version and credit sourceId use actual strict readers", () => {
  for (const required of [
    "function createCanonicalPlanVersionContract",
    "export function readActualPlanVersion",
    'readActualPlanVersion(summary, "Planner summary")',
    'readActualPlanVersion(manifest, "Sensitive manifest")',
    "manifest.planVersion !== contract.planVersion",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const extractorStart = plannerSource.indexOf(
      "function extractCreditSourceReferences",
  );
  const extractorEnd = plannerSource.indexOf(
      "function extractReferences",
      extractorStart,
  );
  const extractorSource = plannerSource.slice(extractorStart, extractorEnd);
  const sourceIdStart = extractorSource.indexOf('field: "sourceId"');
  const sourceTypeStart = extractorSource.indexOf(
      'field: "sourceType"',
      sourceIdStart,
  );
  const sourceIdSource =
    extractorSource.slice(sourceIdStart, sourceTypeStart);
  assert.equal(sourceIdSource.includes('valueType: "string"'), true);
  assert.equal(sourceIdSource.includes("string_or_array"), false);
});

test("execution safety and whole-record contracts use actual outputs", () => {
  for (const required of [
    "createCanonicalExecutionSafetyContract",
    "readExecutionSafetyContract",
    "executionSafetyContractVersion",
    "claimedExecutionSafetyContract",
    "SENSITIVE_MANIFEST_RECORD_KEYS",
    "canonicalizeSensitiveManifestRecord",
    "canonicalizeSensitiveDirectReferences",
    "assertExactObjectKeys",
    "buildRecordSetContract",
    "recomputeManifestRecordSetContract",
    "const RECORD_SET_CONTRACT_VERSION = 2",
    "const RECORD_SET_DIGEST_VERSION = 2",
    "Duplicate record publication identity.",
    "Duplicate sensitive manifest direct reference.",
    "Sensitive manifest record path does not match its typed identity.",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const readerStart = plannerSource.indexOf(
      "export function readExecutionSafetyContract",
  );
  const readerEnd = plannerSource.indexOf(
      "function plannerSafetyContract",
      readerStart,
  );
  const readerSource = plannerSource.slice(readerStart, readerEnd);
  for (const field of [
    "value.executionSafetyContractVersion",
    "value.planClassification",
    "value.snapshotMode",
    "value.writeFreezeRequiredForExecution",
    "value.writeFreezeVerified",
    "value.freshPlanRequiredUnderWriteFreeze",
    "value.executorRevalidationRequired",
    "value.executionEligible",
    "value.executorImplemented",
    "value.writeAuthorized",
    "value.actualWrites",
  ]) {
    assert.equal(readerSource.includes(field), true, field);
  }
  const validatorStart = plannerSource.indexOf(
      "export function assertExactPublicationParity",
  );
  const validatorEnd = plannerSource.indexOf(
      "function buildRedactedSummary",
      validatorStart,
  );
  const validatorSource = plannerSource.slice(validatorStart, validatorEnd);
  assert.equal(
      validatorSource.includes(
          "recomputeManifestRecordSetContract(manifest)",
      ),
      true,
  );
  assert.equal(
      validatorSource.includes("readExecutionSafetyContract(summary)"),
      true,
  );
  assert.equal(
      validatorSource.includes("readExecutionSafetyContract(manifest)"),
      true,
  );
});

test("record-level findings are recomputed against canonical findings", () => {
  for (const required of [
    "canonicalRecordFindingMap",
    "manifestRecordFindingMap",
    "recordFindingSetMetadata",
    "canonicalizeFindingShapeEvidence",
    "Finding expected shape",
    "Finding shape type",
    "Sensitive record finding source does not match its record.",
    "Duplicate sensitive manifest record typed document key.",
    "Duplicate sensitive record published finding.",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const validatorStart = plannerSource.indexOf(
      "export function assertExactPublicationParity",
  );
  const validatorEnd = plannerSource.indexOf(
      "function buildRedactedSummary",
      validatorStart,
  );
  const validator = plannerSource.slice(validatorStart, validatorEnd);
  assert.equal(
      validator.includes(
          "canonicalRecordFindingMap(canonicalPlan.referenceFindings)",
      ),
      true,
  );
  assert.equal(
      validator.includes("manifestRecordFindingMap(manifest.records)"),
      true,
  );
});

test("every scan and publication use stable root collection discovery", () => {
  for (const required of [
    "ROOT_COLLECTION_SET_DIGEST_VERSION",
    "COLLECTION_DISCOVERY_CONTRACT_VERSION",
    "canonicalRootCollectionSet",
    "rootCollectionSetsMatch",
    "buildCollectionDiscoveryContract",
    "assertCollectionDiscoveryContract",
    "finalMatchesRun1",
    "finalMatchesRun2",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const scanStart = plannerSource.indexOf(
      "export async function scanPlannerInventoryOnce",
  );
  const scanEnd = plannerSource.indexOf(
      "function buildCollectionDiscoveryContract",
      scanStart,
  );
  const scanSource = plannerSource.slice(scanStart, scanEnd);
  assert.equal(
      scanSource.match(/discoverRootCollectionSet\(db\)/g)?.length,
      2,
  );
  const buildStart = plannerSource.indexOf(
      "export async function buildAcademyScopedResetPlan",
  );
  const buildEnd = plannerSource.indexOf(
      "function parseFlagToken",
      buildStart,
  );
  const buildSource = plannerSource.slice(buildStart, buildEnd);
  assert.equal(
      buildSource.match(/discoverRootCollectionSet\(db\)/g)?.length,
      1,
  );
  const cliStart = plannerSource.indexOf(
      "export async function executePlannerCli",
  );
  const cliSource = plannerSource.slice(cliStart);
  assert.equal(
      cliSource.indexOf("if (result.exitCode === 3)") <
        cliSource.indexOf("writePlannerOutputs({"),
      true,
  );
  const writerStart = plannerSource.indexOf(
      "export function writePlannerOutputs",
  );
  const writerSource = plannerSource.slice(writerStart, cliStart);
  assert.equal(
      writerSource.indexOf("assertPublishableCanonicalState") <
        writerSource.indexOf("prepareAtomicFile(output.filePath"),
      true,
  );
});

test("publication digest uses one immutable canonical plan snapshot", () => {
  for (const required of [
    "buildCanonicalPlanDigestInput",
    "immutableCanonicalSnapshot",
    "TRUSTED_CANONICAL_PLAN_SNAPSHOTS",
    "assertTrustedCanonicalPlanSnapshot",
    "assertCanonicalPlanIntegrity",
    "createCanonicalPublicationStateContract",
    "readPublicationStateContract",
    "assertPublicationStateSemantics",
    "assertPublishableCanonicalState",
    "publicationStateContractVersion",
    "publicationStateContract",
    "candidateInputs",
    "referenceFindings",
    "registryContract",
    "collectionCounts",
    "referenceCounts",
    "plannedMutations",
    "Canonical plan snapshot digest or contract is stale.",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const writerStart = plannerSource.indexOf(
      "export function writePlannerOutputs",
  );
  const writerSource = plannerSource.slice(writerStart);
  assert.equal(
      writerSource.indexOf("assertCanonicalPlanIntegrity(canonicalPlan)") <
        writerSource.indexOf("prepareAtomicFile(output.filePath"),
      true,
  );
  assert.equal(
      plannerSource.includes("canonicalPlan: result.canonicalPlan"),
      true,
  );
  const readerStart = plannerSource.indexOf(
      "export function readPublicationStateContract",
  );
  const readerEnd = plannerSource.indexOf(
      "function assertPublicationStateSemantics",
      readerStart,
  );
  const readerSource = plannerSource.slice(readerStart, readerEnd);
  assert.equal(
      readerSource.includes("value.publicationStateContractVersion"),
      true,
  );
  assert.equal(
      readerSource.includes("PUBLICATION_STATE_CONTRACT_VERSION"),
      true,
  );
  const digestInputStart = plannerSource.indexOf(
      "export function buildCanonicalPlanDigestInput",
  );
  const digestInputEnd = plannerSource.indexOf(
      "export function buildCanonicalPlanDigest(",
      digestInputStart,
  );
  assert.equal(
      plannerSource.slice(digestInputStart, digestInputEnd)
          .includes("requireSupportedVersion: false"),
      true,
  );
});

test("publication parity recomputes exact runtime source sets", () => {
  for (const required of [
    "runtimeSourceContractVersion",
    "criticalRuntimeSourceCount",
    "criticalRuntimeSourceSetDigestVersion",
    "criticalRuntimeSourceSetDigest",
    "canonicalizeCriticalRuntimeSourceIdentity",
    "buildRuntimeSourceContract",
    "Duplicate critical runtime source relative path.",
    "regularBlob",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const validatorStart = plannerSource.indexOf(
      "export function assertExactPublicationParity",
  );
  const validatorEnd = plannerSource.indexOf(
      "function buildRedactedSummary",
      validatorStart,
  );
  const validatorSource = plannerSource.slice(validatorStart, validatorEnd);
  assert.equal(
      validatorSource.includes(
          "buildRuntimeSourceContract(manifest.criticalRuntimeSources)",
      ),
      true,
  );
  assert.equal(
      validatorSource.includes(
          "stableStringify(recomputedManifestRuntimeSourceContract)",
      ),
      true,
  );
});

test("test-data profile is exact, confirmed, and metadata-bound", () => {
  for (const required of [
    '"all_academy_data_test_v1"',
    '"all_academy_data_test_v1.policy.v3"',
    '"reset-profile"',
    "CONFIRM_ALL_ACADEMY_DATA_IS_TEST",
    "CONFIRM_OPERATOR_WAIVES_FULL_BACKUP",
    "operatorTestDataConfirmation",
    "fullBackupWaiverConfirmed",
    "profilePolicyVersion",
    "provisioningLogPolicy",
    '"archive_then_reset"',
    '"operator_waived_full_backup"',
    '"managed_firestore_export_required"',
    "minimumSafetySnapshotsRequired",
    "CONFIRM_IRREVERSIBLE_TEST_DATA_RESET",
    "exactPlanDigestRequired",
    "exactDeleteCountRequired",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  assert.equal(
      registrySource.includes('"all_academy_data_test_v1"'),
      true,
  );
  assert.equal(
      plannerSource.includes("writeAuthorized: false"),
      true,
  );
  assert.equal(
      plannerSource.includes("executorImplemented: false"),
      true,
  );
});

test("profile policies use exact membership and field schema evidence", () => {
  for (const role of ["owner", "admin", "teacher", "staff"]) {
    assert.equal(registrySource.includes(`"${role}"`), true, role);
  }
  for (const required of [
    "classifyMembershipForTestDataProfile",
    '"preserve_staff_membership"',
    '"reset_test_membership"',
    '"ambiguous_membership"',
    '"preserved_membership_pointer_cleanup_required"',
    "preservedStaffMembershipCount",
    "resetTestMembershipCount",
    "ambiguousMembershipCount",
    "preservedMembershipPointerCleanupCount",
    "buildMembershipStatusEvidence",
    "buildMembershipPrincipalEvidence",
    "teacherIdentityEvidence",
    "conflicting_teacher_uid_alias",
    "conflicting_teacher_id_alias",
    "conflicting_teacher_key_alias",
    "membership_role_identity_conflict",
    "conflicting_teacher_identity_targets",
    "unresolved_teacher_identity",
    "unresolved_provisioning_identity",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  for (const required of [
    '"reservationId"',
    '"reservedStudentId"',
    '"groupClassId"',
    '"teacherId"',
    'groupClassId: ["null"]',
    'teacherId: ["null", "empty_string"]',
    'valueType: "string"',
  ]) {
    assert.equal(registrySource.includes(required), true, required);
  }
});

test("privateLessonSlots student cardinalities are field-specific", () => {
  const slotRegistry = ACADEMY_SCOPED_RESET_REGISTRY.find(
      ({collectionName}) => collectionName === "privateLessonSlots",
  );
  const studentExtractors = slotRegistry.referenceExtractors.filter(
      ({family}) => family === "student",
  );
  const scalar = studentExtractors.find(({fields}) =>
    fields.includes("studentId"));
  const eligible = studentExtractors.find(({fields}) =>
    fields.includes("eligibleStudentIds"));
  assert.equal(scalar.valueType, "string");
  assert.equal(scalar.fields.includes("eligibleStudentIds"), false);
  assert.deepEqual(eligible.fields, ["eligibleStudentIds"]);
  assert.equal(eligible.valueType, "array");
});

test("reference evidence is shape-only and deterministically deduplicated", () => {
  for (const required of [
    "describeReferenceValueShape",
    "safeReferenceShapeEvidence",
    "malformedReferenceShapes",
    "sourceTypeLiteral",
    "sourceTypePresent",
    "sourceTypeKnown",
    "sourceTypeCategory",
    "sourceTypeLengthBucket",
    "KNOWN_CREDIT_SOURCE_ALLOWLIST_VERSION",
    "sourceIdPresent",
    "explicitLessonIdPresent",
    "explicitReservationIdPresent",
    "explicitSlotIdPresent",
    "findingIdentityDigest",
    "sensitiveRecordFindingCount",
    "Reference finding redacted/sensitive parity mismatch.",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  assert.equal(
      plannerSource.includes(
          '"missing_reset_source_preserved_target_reference"',
      ),
      true,
  );
});

test("CLI binds release metadata before Firebase initialization", () => {
  for (const required of [
    "fileURLToPath(import.meta.url)",
    "fs.realpathSync(__filename)",
    "resolvePlannerFilesystemRepositoryRoot",
    "sanitizedGitEnvironment",
    '["rev-parse", "--show-toplevel"]',
    '["rev-parse", "HEAD"]',
    '["rev-parse", "HEAD^{tree}"]',
    '"ls-files"',
    '"--error-unmatch"',
    '["status", "--porcelain=v1", "--untracked-files=all"]',
    '"ls-tree"',
    '"cat-file"',
    '["ls-files", "-v", "--", relativePath]',
    "runtimeBytes.equals(headBytes)",
    "criticalRuntimeSources",
    "headBlobOid",
    "headBlobSha256",
    "runtimeSha256",
    "indexFlagsClean",
    "env: sanitizedGitEnvironment(environment)",
    "shell: false",
    "runtimeHeadSha",
    "runtimeTreeSha",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
  const cliBody = plannerSource.slice(
      plannerSource.indexOf("export async function executePlannerCli"),
      plannerSource.indexOf("const isMainModule"),
  );
  assert.ok(
      cliBody.indexOf("validatePlannerExecutionOptions(parsedOptions, env)") <
      cliBody.indexOf("resolvePlannerRuntimeSourceIdentity()"),
  );
  assert.ok(
      cliBody.indexOf("resolvePlannerRuntimeSourceIdentity()") <
      cliBody.indexOf("validatePlannerRuntimeSourceIdentity({"),
  );
  assert.ok(
      cliBody.indexOf("validatePlannerRuntimeSourceIdentity({") <
      cliBody.indexOf(
          "validatePlannerOutputPaths(executionOptions)",
      ),
  );
  assert.ok(
      cliBody.indexOf(
          "validatePlannerOutputPaths(executionOptions)",
      ) <
      cliBody.indexOf("await loadRuntimeRegistryModule()"),
  );
  assert.ok(
      cliBody.indexOf("await loadRuntimeRegistryModule()") <
      cliBody.indexOf("dbFactory(options.project"),
  );
  assert.equal(plannerSource.includes("sourceIdentityResolver"), false);
  assert.equal(
      plannerSource.includes(
          "export function resolvePlannerRuntimeSourceIdentity",
      ),
      false,
  );
  assert.equal(plannerSource.includes("PLANNER_BASE_SHA"), false);
  assert.equal(
      /env\.[A-Z0-9_]*(?:SOURCE|SHA|GIT)[A-Z0-9_]*/.test(plannerSource),
      false,
  );
});

test("critical local runtime imports are fixed by an exact allowlist", () => {
  const allowlistBody = plannerSource.match(
      /const CRITICAL_RUNTIME_SOURCE_PATHS = Object\.freeze\(\[([\s\S]*?)\]\);/,
  )?.[1] || "";
  const allowlist = [...allowlistBody.matchAll(/"([^"]+)"/g)]
      .map((match) => match[1]);
  assert.deepEqual(allowlist, [
    "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
    "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
  ]);
  assert.equal(
      allowlist.some((relativePath) => relativePath.startsWith("tests/")),
      false,
  );

  const plannerRelativePath =
    "functions/scripts/plan-academy-scoped-test-data-reset.mjs";
  const localImports = [
    ...plannerSource.matchAll(
        /(?:from\s+|import\s*\()\s*["'](\.[^"']+)["']/g,
    ),
  ].map((match) => path.posix.normalize(path.posix.join(
      path.posix.dirname(plannerRelativePath),
      match[1],
  )));
  assert.deepEqual(localImports, [
    "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
  ]);
  localImports.forEach((relativePath) => {
    assert.equal(allowlist.includes(relativePath), true, relativePath);
  });
});

test("registry module has no import or runtime I/O side effects", () => {
  for (const forbidden of [
    /\bimport\s*(?:\(|[\s{*])/,
    /\brequire\s*\(/,
    /\bfetch\s*\(/,
    /\bfirebase-admin\b/,
    /\bnode:(?:fs|child_process|http|https|net)\b/,
    /\bprocess\.(?:env|exit|exitCode)\b/,
  ]) {
    assert.equal(
        forbidden.test(registrySource),
        false,
        `Registry side-effect capability matched ${forbidden}`,
    );
  }
});

test("groupLessons has strict classId and classID alias resolution", () => {
  const groupLessonsEntry = registrySource.match(
      /collectionName: "groupLessons"[\s\S]*?plannerDisposition: "reset_candidate"/,
  )?.[0] || "";
  for (const required of [
    '"classId"',
    '"classID"',
    'aliasPolicy: "strict_scalar_alias"',
  ]) {
    assert.equal(groupLessonsEntry.includes(required), true, required);
  }
  for (const required of [
    'extractor.aliasPolicy === "strict_scalar_alias"',
    'code: "ambiguous_reference_alias"',
    "resolvedValue: null",
    "conflict: true",
    "aliasEvidence",
  ]) {
    assert.equal(plannerSource.includes(required), true, required);
  }
});

test("registry and planner do not load product write callables", () => {
  assert.equal(plannerSource.includes("../index.js"), false);
  assert.equal(registrySource.includes("../index.js"), false);
  assert.equal(plannerSource.includes("httpsCallable"), false);
  assert.equal(registrySource.includes("httpsCallable"), false);
});

test("planner resolves firebase-admin from its functions package", () => {
  assert.equal(
      plannerSource.includes('import("firebase-admin/app")'),
      true,
  );
  assert.equal(
      plannerSource.includes('import("firebase-admin/firestore")'),
      true,
  );
  const functionsPackage = JSON.parse(
      fs.readFileSync(
          path.join(repositoryRoot, "functions", "package.json"),
          "utf8",
      ),
  );
  assert.equal(
      Object.prototype.hasOwnProperty.call(
          functionsPackage.dependencies || {},
          "firebase-admin",
      ),
      true,
  );
});
