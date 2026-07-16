"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");

const BASE_SHA = "935fe1fca00425a6c5f0b382e721e668e81bde90";
const TREE_SHA = "1234567890abcdef1234567890abcdef12345678";
const CRITICAL_RUNTIME_SOURCE_PATHS = [
  "functions/scripts/academy-scoped-test-data-reset-registry.mjs",
  "functions/scripts/plan-academy-scoped-test-data-reset.mjs",
];

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  throw new Error("FIRESTORE_EMULATOR_HOST is required.");
}

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  "demo-academy-reset-planner";
if (!PROJECT_ID.startsWith("demo-")) {
  throw new Error("Planner emulator test requires a demo-* project.");
}

process.env.GCLOUD_PROJECT = PROJECT_ID;
process.env.FIREBASE_CONFIG = JSON.stringify({projectId: PROJECT_ID});

const admin = require("../functions/node_modules/firebase-admin");
if (!admin.apps.length) {
  admin.initializeApp({projectId: PROJECT_ID});
}
const db = admin.firestore();

async function loadPlannerModules() {
  const [planner, registry] = await Promise.all([
    import(
        "../functions/scripts/plan-academy-scoped-test-data-reset.mjs"
    ),
    import(
        "../functions/scripts/academy-scoped-test-data-reset-registry.mjs"
    ),
  ]);
  return {planner, registry};
}

async function clearFirestore() {
  const collections = await db.listCollections();
  for (const collection of collections) {
    while (true) {
      const snapshot = await collection
          .orderBy(admin.firestore.FieldPath.documentId())
          .limit(400)
          .get();
      if (snapshot.empty) break;
      const batch = db.batch();
      snapshot.docs.forEach((document) => batch.delete(document.ref));
      await batch.commit();
    }
  }
}

function normalizedValue(value) {
  if (value == null || typeof value === "string" ||
      typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(normalizedValue);
  if (typeof value.toMillis === "function") {
    return {$timestampMillis: value.toMillis()};
  }
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return {$bytes: Buffer.from(value).toString("base64")};
  }
  if (typeof value === "object") {
    return Object.fromEntries(
        Object.keys(value).sort().map((key) => [
          key,
          normalizedValue(value[key]),
        ]),
    );
  }
  return String(value);
}

async function snapshotFirestore() {
  const result = {};
  const collections = (await db.listCollections())
      .sort((a, b) => a.id.localeCompare(b.id));
  for (const collection of collections) {
    const snapshot = await collection
        .orderBy(admin.firestore.FieldPath.documentId())
        .get();
    result[collection.id] = snapshot.docs.map((document) => ({
      id: document.id,
      data: normalizedValue(document.data()),
    }));
  }
  return result;
}

async function writeDocuments(writes) {
  for (let offset = 0; offset < writes.length; offset += 400) {
    const batch = db.batch();
    writes.slice(offset, offset + 400).forEach((write) => {
      batch.set(db.collection(write.collection).doc(write.id), write.data);
    });
    await batch.commit();
  }
}

function fullRegistryWrites(registry, academy) {
  const writes = [];
  for (const item of registry.ACADEMY_SCOPED_RESET_REGISTRY) {
    const targetId =
      item.academyScopeStrategy ===
        registry.ACADEMY_SCOPE_STRATEGIES.ACADEMY_DOCUMENT_ID ?
        academy :
        `${item.collectionName}-target`;
    const targetData =
      item.academyScopeStrategy ===
        registry.ACADEMY_SCOPE_STRATEGIES.GLOBAL_DOCUMENT ?
        {role: "admin"} :
        item.academyScopeStrategy ===
          registry.ACADEMY_SCOPE_STRATEGIES.ACADEMY_DOCUMENT_ID ?
          {status: "active"} :
          {academyId: academy};
    writes.push({
      collection: item.collectionName,
      id: targetId,
      data: targetData,
    });

    if (item.academyScopeStrategy !==
        registry.ACADEMY_SCOPE_STRATEGIES.GLOBAL_DOCUMENT) {
      const otherId =
        item.academyScopeStrategy ===
          registry.ACADEMY_SCOPE_STRATEGIES.ACADEMY_DOCUMENT_ID ?
          "academy_other" :
          `${item.collectionName}-other`;
      writes.push({
        collection: item.collectionName,
        id: otherId,
        data: item.academyScopeStrategy ===
          registry.ACADEMY_SCOPE_STRATEGIES.ACADEMY_DOCUMENT_ID ?
          {status: "active"} :
          {academyId: "academy_other"},
      });
    }
  }
  for (let index = 0; index < 6; index += 1) {
    writes.push({
      collection: "dailyMaterials",
      id: `daily-page-${index}`,
      data: {academyId: academy},
    });
  }
  return writes;
}

async function plan(planner, registry, overrides = {}) {
  return planner.buildAcademyScopedResetPlan({
    db,
    project: PROJECT_ID,
    academy: registry.EXPECTED_TARGET_ACADEMY,
    releaseSha: BASE_SHA,
    runtimeSourceIdentity: {
      repositoryRoot: path.resolve(__dirname, ".."),
      runtimeHeadSha: BASE_SHA,
      runtimeTreeSha: TREE_SHA,
      clean: true,
      criticalRuntimeSources: CRITICAL_RUNTIME_SOURCE_PATHS.map(
          (relativePath, index) => ({
            relativePath,
            headBlobOid: String(index + 1).repeat(40),
            headBlobSha256: String(index + 1).repeat(64),
            runtimeSha256: String(index + 1).repeat(64),
            bytesMatch: true,
            tracked: true,
            regularBlob: true,
            indexFlagsClean: true,
          }),
      ),
    },
    pageSize: 2,
    ...overrides,
  });
}

async function testEmptyAcademy(planner, registry) {
  await clearFirestore();
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.consistency, true);
  assert.equal(result.summary.totals.resetCandidates, 0);
  assert.deepEqual(after, before);
}

async function testFullStableNoWrite(planner, registry) {
  await clearFirestore();
  await writeDocuments(
      fullRegistryWrites(registry, registry.EXPECTED_TARGET_ACADEMY),
  );
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.consistency, true);
  assert.equal(result.summary.totals.resetCandidates, 30);
  assert.equal(result.summary.runtimeDiscovery.unknownCollectionCount, 0);
  assert.equal(result.summary.collections.dailyMaterials.scanned, 8);
  assert.equal(result.summary.collections.dailyMaterials.pageCount, 5);
  assert.equal(result.summary.totals.retained, 2);
  assert.equal(result.summary.actualWrites, 0);
  assert.equal(result.summary.writeAuthorized, false);
  assert.equal(result.summary.executorImplemented, false);
  assert.equal(
      result.summary.planClassification,
      "non_executable_advisory",
  );
  assert.equal(result.summary.executionSafetyContractVersion, 1);
  assert.equal(result.summary.snapshotMode, "live_read_only_unfrozen");
  assert.equal(
      result.summary.writeFreezeRequiredForExecution,
      true,
  );
  assert.equal(result.summary.writeFreezeVerified, false);
  assert.equal(result.summary.freshPlanRequiredUnderWriteFreeze, true);
  assert.equal(
      result.summary.executorRevalidationRequired,
      true,
  );
  assert.equal(result.summary.executionEligible, false);
  assert.equal(result.summary.recordSetContractVersion, 2);
  assert.equal(result.summary.recordSetDigestVersion, 2);
  assert.deepEqual(after, before);
}

async function testExactAcademyIdScope(planner, registry) {
  await clearFirestore();
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  await writeDocuments([{
    collection: "lessons",
    id: "whitespace-academy-id",
    data: {academyId: ` ${academyId} `},
  }]);
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  const record = result.secondRun.records.find(
      ({collection}) => collection === "lessons",
  );
  assert.equal(result.exitCode, 2);
  assert.equal(record.scope, "malformed");
  assert.equal(record.disposition, "unknown");
  assert.equal(record.academyScopeEvidence.exactAcademyMatch, false);
  assert.equal(result.summary.totals.resetCandidates, 0);
  assert.equal(result.summary.actualWrites, 0);
  assert.deepEqual(after, before);
}

async function testProfileAndReferenceEvidence(planner, registry) {
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  const profile = registry.ALL_ACADEMY_DATA_TEST_PROFILE;
  await clearFirestore();
  await writeDocuments([
    {
      collection: "academies",
      id: academyId,
      data: {status: "active"},
    },
    {
      collection: "users",
      id: "staff-user",
      data: {role: "owner"},
    },
    {
      collection: "users",
      id: "student-user",
      data: {role: "student"},
    },
    {
      collection: "privateStudents",
      id: "test-student",
      data: {academyId},
    },
    {
      collection: "academyMemberships",
      id: "staff-membership",
      data: {
        academyId,
        uid: "staff-user",
        role: "owner",
        status: "active",
        permissions: {},
      },
    },
    {
      collection: "academyMemberships",
      id: "student-membership",
      data: {
        academyId,
        role: "student",
        status: "active",
        studentId: "test-student",
        uid: "student-user",
        permissions: {},
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "test-log",
      data: {academyId, studentId: "test-student"},
    },
    {
      collection: "studentPackages",
      id: "private-package",
      data: {
        academyId,
        studentId: "test-student",
        groupClassId: null,
        teacherId: "missing-teacher",
      },
    },
    {
      collection: "privateLessonSlots",
      id: "open-slot",
      data: {
        academyId,
        reservationId: "",
        reservedStudentId: "",
      },
    },
    {
      collection: "notificationEvents",
      id: "slot-event",
      data: {academyId, reservationId: ""},
    },
  ]);
  let before = await snapshotFirestore();
  let result = await plan(planner, registry, {
    resetProfile: profile,
    operatorTestDataConfirmation: true,
    fullBackupWaiverConfirmed: true,
  });
  let after = await snapshotFirestore();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.resetProfile, profile);
  assert.equal(result.summary.operatorTestDataConfirmation, true);
  assert.equal(result.summary.fullBackupWaiverConfirmed, true);
  assert.equal(result.summary.backupPolicy, "operator_waived_full_backup");
  assert.equal(result.summary.managedExportRequired, false);
  assert.equal(result.summary.membershipProfile.preservedStaffMembershipCount, 1);
  assert.equal(result.summary.membershipProfile.resetTestMembershipCount, 1);
  assert.equal(result.summary.collections.accountProvisioningLogs.reset, 1);
  assert.equal(result.summary.totals.retained, 0);
  assert.equal(
      result.summary.totals.resetSourceMissingPreservedTargetReferences,
      1,
  );
  assert.equal(result.summary.actualWrites, 0);
  planner.assertExactPublicationParity(
      result.canonicalPlan,
      result.summary,
      result.manifest,
  );
  const tamperedManifest =
    JSON.parse(JSON.stringify(result.manifest));
  const recordWithFinding = tamperedManifest.records.find(
      ({referenceFindings}) => referenceFindings.length > 0,
  );
  assert.ok(recordWithFinding);
  recordWithFinding.referenceFindings[0].code += "_tampered";
  assert.throws(() => planner.assertExactPublicationParity(
      result.canonicalPlan,
      result.summary,
      tamperedManifest,
  ));
  const pathTamperedManifest =
    JSON.parse(JSON.stringify(result.manifest));
  pathTamperedManifest.records[0].rawDocumentPath =
    `${pathTamperedManifest.records[0].collection}/forged`;
  assert.throws(() => planner.assertExactPublicationParity(
      result.canonicalPlan,
      result.summary,
      pathTamperedManifest,
  ));
  const referenceTamperedManifest =
    JSON.parse(JSON.stringify(result.manifest));
  const recordWithReference = referenceTamperedManifest.records.find(
      ({directReferences}) => directReferences.length > 0,
  );
  assert.ok(recordWithReference);
  recordWithReference.directReferences.push({
    family: "forged",
    field: "forged",
    candidateTypedKeys: ["users:forged"],
    targetCollections: ["users"],
    lookup: "document_id",
  });
  assert.throws(() => planner.assertExactPublicationParity(
      result.canonicalPlan,
      result.summary,
      referenceTamperedManifest,
  ));
  assert.deepEqual(
      result.summary.publicationSetContract,
      result.manifest.publicationSetContract,
  );
  assert.deepEqual(
      planner.recomputeManifestPublicationSetContract(result.manifest),
      result.summary.publicationSetContract,
  );
  assert.deepEqual(
      planner.buildRuntimeSourceContract(
          result.manifest.criticalRuntimeSources,
      ),
      result.summary.runtimeSourceContract,
  );
  assert.deepEqual(after, before);

  await clearFirestore();
  await writeDocuments([
    {
      collection: "privateStudents",
      id: "test-student",
      data: {academyId},
    },
    {
      collection: "academyMemberships",
      id: "staff-pointer",
      data: {
        academyId,
        role: "owner",
        status: "active",
        studentId: "test-student",
      },
    },
    {
      collection: "academyMemberships",
      id: "ambiguous-membership",
      data: {academyId, role: "future-role"},
    },
    {
      collection: "creditTransactions",
      id: "unknown-credit",
      data: {
        academyId,
        sourceType: "legacyPackageAdjustment",
        sourceId: "opaque-source",
      },
    },
    {
      collection: "creditTransactions",
      id: "inherited-key-credit",
      data: {
        academyId,
        sourceType: "constructor",
        sourceId: "opaque-inherited-source",
      },
    },
    {
      collection: "privateLessonSlots",
      id: "malformed-slot",
      data: {
        academyId,
        reservationId: null,
        reservedStudentId: {unexpected: true},
      },
    },
    {
      collection: "studentPackages",
      id: "malformed-package",
      data: {academyId, groupClassId: ["group", 3]},
    },
    {
      collection: "notificationEvents",
      id: "malformed-event",
      data: {academyId, reservationId: false},
    },
    {
      collection: "groupClasses",
      id: "malformed-class",
      data: {academyId, teacherId: {unexpected: true}},
    },
  ]);
  before = await snapshotFirestore();
  result = await plan(planner, registry, {
    resetProfile: profile,
    operatorTestDataConfirmation: true,
    fullBackupWaiverConfirmed: true,
  });
  after = await snapshotFirestore();
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.membershipProfile.ambiguousMembershipCount, 1);
  assert.equal(
      result.summary.membershipProfile
          .preservedMembershipPointerCleanupCount,
      1,
  );
  assert.equal(result.summary.malformedReferenceShapes.length, 5);
  assert.equal(result.summary.unknownCreditSourceEvidence.length, 2);
  assert.equal(
      JSON.stringify(result.summary).includes("legacyPackageAdjustment"),
      false,
  );
  assert.equal(
      JSON.stringify(result.summary).includes("constructor"),
      false,
  );
  assert.equal(
      result.secondRun.referenceFindings.blockers.filter(
          ({code}) => code === "unknown_credit_source_type",
      ).length,
      2,
  );
  assert.equal(result.summary.actualWrites, 0);
  assert.deepEqual(after, before);
}

async function testUnknownCollections(planner, registry) {
  await clearFirestore();
  await writeDocuments([
    {
      collection: "unknownAcademyOperations",
      id: "target-row",
      data: {academyId: registry.EXPECTED_TARGET_ACADEMY},
    },
    {
      collection: "unknownGlobalSettings",
      id: "global-row",
      data: {enabled: true},
    },
  ]);
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.runtimeDiscovery.unknownCollectionCount, 2);
  assert.ok(result.summary.totals.unknownBlockers >= 2);
  assert.deepEqual(after, before);
}

async function testReferenceBlockers(planner, registry) {
  await clearFirestore();
  await writeDocuments([
    {
      collection: "privateStudents",
      id: "target-student",
      data: {academyId: registry.EXPECTED_TARGET_ACADEMY},
    },
    {
      collection: "academyMemberships",
      id: "target-membership",
      data: {
        academyId: registry.EXPECTED_TARGET_ACADEMY,
        studentId: "target-student",
      },
    },
    {
      collection: "studentPackages",
      id: "other-package",
      data: {academyId: "academy_other"},
    },
    {
      collection: "lessons",
      id: "cross-academy-lesson",
      data: {
        academyId: registry.EXPECTED_TARGET_ACADEMY,
        packageId: "other-package",
        reservationId: "missing-reservation",
      },
    },
  ]);
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 2);
  assert.ok(result.summary.totals.crossAcademyReferences > 0);
  assert.ok(result.summary.totals.preservedReferenceWarnings > 0);
  assert.ok(result.summary.totals.referenceDiagnosticCount > 0);
  assert.deepEqual(after, before);
}

async function testInternalOrphansAreDiagnosticOnly(planner, registry) {
  await clearFirestore();
  await writeDocuments([
    {
      collection: "lessons",
      id: "orphan-lesson",
      data: {
        academyId: registry.EXPECTED_TARGET_ACADEMY,
        reservationId: "missing-reservation",
      },
    },
    {
      collection: "privateLessonReservations",
      id: "orphan-reservation",
      data: {
        academyId: registry.EXPECTED_TARGET_ACADEMY,
        lessonId: "missing-lesson",
      },
    },
    {
      collection: "privateLessonSlots",
      id: "orphan-slot",
      data: {
        academyId: registry.EXPECTED_TARGET_ACADEMY,
        reservationId: "missing-reservation",
      },
    },
  ]);
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.totals.resetCandidates, 3);
  assert.equal(result.summary.planned.deletes, 3);
  assert.ok(result.summary.totals.referenceDiagnosticCount >= 3);
  assert.equal(result.summary.totals.referenceBlockerCount, 0);
  assert.deepEqual(after, before);
}

async function testGroupLessonAliases(planner, registry) {
  await clearFirestore();
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  await writeDocuments([
    {
      collection: "groupClasses",
      id: "shared-class-id",
      data: {academyId},
    },
    {
      collection: "privateStudents",
      id: "shared-class-id",
      data: {academyId},
    },
    {
      collection: "groupLessons",
      id: "class-id-only",
      data: {academyId, classId: "shared-class-id"},
    },
    {
      collection: "groupLessons",
      id: "class-id-legacy-only",
      data: {academyId, classID: "shared-class-id"},
    },
    {
      collection: "groupLessons",
      id: "equal-aliases",
      data: {
        academyId,
        classId: "shared-class-id",
        classID: "shared-class-id",
      },
    },
  ]);
  let before = await snapshotFirestore();
  const validResult = await plan(planner, registry);
  let after = await snapshotFirestore();
  assert.equal(validResult.exitCode, 0);
  assert.equal(validResult.summary.totals.referenceBlockerCount, 0);
  for (const documentId of [
    "class-id-only",
    "class-id-legacy-only",
    "equal-aliases",
  ]) {
    const record = validResult.manifest.records.find(
        ({rawDocumentPath}) =>
          rawDocumentPath === `groupLessons/${documentId}`,
    );
    const references = record.directReferences.filter(
        ({family}) => family === "group_class",
    );
    assert.equal(references.length, 1, documentId);
    assert.deepEqual(
        references[0].candidateTypedKeys,
        ["groupClasses:shared-class-id"],
    );
    assert.equal(
        references[0].candidateTypedKeys.includes(
            "privateStudents:shared-class-id",
        ),
        false,
    );
  }
  const equalRecord = validResult.manifest.records.find(
      ({rawDocumentPath}) =>
        rawDocumentPath === "groupLessons/equal-aliases",
  );
  const equalReference = equalRecord.directReferences.find(
      ({family}) => family === "group_class",
  );
  assert.equal(equalReference.resolvedValue, "shared-class-id");
  assert.equal(equalReference.conflict, false);
  assert.equal(equalReference.aliasEvidence.length, 2);
  assert.deepEqual(after, before);

  await clearFirestore();
  await writeDocuments([
    {
      collection: "groupClasses",
      id: "first-class",
      data: {academyId},
    },
    {
      collection: "groupClasses",
      id: "second-class",
      data: {academyId},
    },
    {
      collection: "groupLessons",
      id: "conflicting-aliases",
      data: {
        academyId,
        classId: "first-class",
        classID: "second-class",
      },
    },
  ]);
  before = await snapshotFirestore();
  const blockedResult = await plan(planner, registry);
  after = await snapshotFirestore();
  assert.equal(blockedResult.exitCode, 2);
  const blocker = blockedResult.secondRun.referenceFindings.blockers.find(
      ({code}) => code === "ambiguous_reference_alias",
  );
  assert.ok(blocker);
  assert.equal(blocker.resolvedValue, null);
  assert.equal(blocker.conflict, true);
  const conflictRecord = blockedResult.manifest.records.find(
      ({rawDocumentPath}) =>
        rawDocumentPath === "groupLessons/conflicting-aliases",
  );
  assert.equal(
      conflictRecord.directReferences.some(
          ({family}) => family === "group_class",
      ),
      false,
  );
  assert.deepEqual(after, before);
}

async function testTeacherIdentityEvidence(planner, registry) {
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  const profileOptions = {
    resetProfile: registry.ALL_ACADEMY_DATA_TEST_PROFILE,
    operatorTestDataConfirmation: true,
    fullBackupWaiverConfirmed: true,
  };
  await clearFirestore();
  await writeDocuments([
    {
      collection: "users",
      id: "teacher-auth-a",
      data: {role: "teacher"},
    },
    {
      collection: "teachers",
      id: "teacher-a",
      data: {
        academyId,
        teacherKey: "teacher-key-a",
        uid: "teacher-auth-a",
      },
    },
    {
      collection: "academyMemberships",
      id: "teacher-membership-a",
      data: {
        academyId,
        role: "teacher",
        status: "active",
        uid: "teacher-auth-a",
        teacherUid: "teacher-auth-a",
        teacherId: "teacher-a",
        teacherKey: "teacher-key-a",
        permissions: {},
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "teacher-log-a",
      data: {
        academyId,
        uid: "teacher-auth-a",
        teacherId: "teacher-a",
        teacherID: "teacher-a",
        teacherKey: "teacher-key-a",
        teacherUid: "teacher-auth-a",
        membershipId: "teacher-membership-a",
      },
    },
  ]);
  let before = await snapshotFirestore();
  let result = await plan(planner, registry, profileOptions);
  let after = await snapshotFirestore();
  assert.equal(result.exitCode, 0);
  assert.equal(result.summary.collections.accountProvisioningLogs.reset, 1);
  assert.equal(result.summary.membershipProfile.preservedStaffMembershipCount, 1);
  planner.assertExactPublicationParity(
      result.canonicalPlan,
      result.summary,
      result.manifest,
  );
  assert.deepEqual(after, before);

  await clearFirestore();
  await writeDocuments([
    {
      collection: "teachers",
      id: "teacher-a",
      data: {academyId, teacherKey: "teacher-key-a"},
    },
    {
      collection: "teachers",
      id: "teacher-b",
      data: {academyId, teacherKey: "teacher-key-b"},
    },
    {
      collection: "privateStudents",
      id: "student-a",
      data: {academyId},
    },
    {
      collection: "accountProvisioningLogs",
      id: "conflicting-teacher-log",
      data: {
        academyId,
        teacherId: "teacher-a",
        teacherKey: "teacher-key-b",
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "conflicting-teacher-id-alias-log",
      data: {
        academyId,
        teacherId: "teacher-a",
        teacherID: "teacher-b",
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "unresolved-legacy-teacher-log",
      data: {
        academyId,
        teacher: "legacy-display-value",
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "malformed-teacher-uid-log",
      data: {
        academyId,
        teacherUID: {unexpected: true},
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "mixed-student-teacher-log",
      data: {
        academyId,
        studentId: "student-a",
        teacherId: "teacher-a",
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "student-id-array-log",
      data: {
        academyId,
        studentId: ["student-a"],
      },
    },
    {
      collection: "accountProvisioningLogs",
      id: "membership-id-array-log",
      data: {
        academyId,
        membershipId: ["membership-a"],
      },
    },
  ]);
  before = await snapshotFirestore();
  result = await plan(planner, registry, profileOptions);
  after = await snapshotFirestore();
  assert.equal(result.exitCode, 2);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "conflicting_teacher_identity_targets",
      ),
      true,
  );
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "conflicting_teacher_id_alias",
      ),
      true,
  );
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "unresolved_provisioning_identity",
      ),
      true,
  );
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "malformed_reference_field",
      ),
      true,
  );
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code}) => code === "mixed_provisioning_identity",
      ),
      true,
  );
  const malformedFields = result.secondRun.referenceFindings.blockers
      .filter(({code}) => code === "malformed_reference_field")
      .map(({field}) => field);
  assert.equal(malformedFields.includes("studentId"), true);
  assert.equal(malformedFields.includes("membershipId"), true);
  assert.deepEqual(after, before);
}

async function testPrivateSlotStudentCardinality(planner, registry) {
  await clearFirestore();
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  await writeDocuments([
    {
      collection: "privateStudents",
      id: "slot-student-a",
      data: {academyId},
    },
    {
      collection: "privateLessonSlots",
      id: "slot-with-array-student",
      data: {
        academyId,
        studentId: ["slot-student-a"],
      },
    },
  ]);
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.actualWrites, 0);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code, field}) =>
            code === "malformed_reference_field" &&
            field === "studentId",
      ),
      true,
  );
  assert.deepEqual(after, before);
}

async function testDoubleRunMismatch(planner, registry) {
  await clearFirestore();
  const result = await plan(planner, registry, {
    beforeSecondRun: async () => {
      await db.collection("dailyMaterials").doc("between-runs").set({
        academyId: registry.EXPECTED_TARGET_ACADEMY,
      });
    },
  });
  assert.equal(result.exitCode, 3);
  assert.equal(result.summary.consistency, false);
  assert.equal(result.summary.planned.deletes, 0);
  assert.equal(result.manifest, null);
}

async function testNonFiniteDigestRaces(planner, registry) {
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  const recordDigest = (run) => run.records.find(
      ({collection}) => collection === "dailyMaterials",
  ).documentDigest;
  const transition = async (firstValue, secondValue, mutate = true) => {
    await clearFirestore();
    const reference = db.collection("dailyMaterials").doc("non-finite-race");
    await reference.set({academyId, marker: firstValue});
    return plan(planner, registry, {
      beforeSecondRun: mutate ?
        async () => reference.update({marker: secondValue}) :
        null,
    });
  };

  for (const [label, firstValue, secondValue] of [
    ["nan-to-null", NaN, null],
    ["null-to-nan", null, NaN],
    ["nan-to-positive-infinity", NaN, Number.POSITIVE_INFINITY],
    ["positive-to-negative-infinity",
      Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
    ["zero-to-negative-zero", 0, -0],
    ["nested-nan-to-null", {nested: {value: NaN}},
      {nested: {value: null}}],
    ["array-nan-to-null", {items: [NaN]}, {items: [null]}],
    ["array-infinity-sign", {items: [Number.POSITIVE_INFINITY]},
      {items: [Number.NEGATIVE_INFINITY]}],
  ]) {
    const result = await transition(firstValue, secondValue);
    assert.equal(result.exitCode, 3, label);
    assert.equal(result.summary.consistency, false, label);
    assert.equal(result.summary.complete, false, label);
    assert.equal(result.manifest, null, label);
    assert.equal(result.summary.actualWrites, 0, label);
    assert.notEqual(result.firstRun.runDigest, result.secondRun.runDigest, label);
    assert.notEqual(
        result.firstRun.collectionSummaries.dailyMaterials.digest,
        result.secondRun.collectionSummaries.dailyMaterials.digest,
        label,
    );
    assert.notEqual(
        recordDigest(result.firstRun),
        recordDigest(result.secondRun),
        label,
    );
  }

  for (const [label, value] of [
    ["stable-nan", NaN],
    ["stable-positive-infinity", Number.POSITIVE_INFINITY],
    ["stable-negative-infinity", Number.NEGATIVE_INFINITY],
  ]) {
    const result = await transition(value, value, false);
    assert.equal(result.exitCode, 0, label);
    assert.equal(result.summary.consistency, true, label);
    assert.equal(result.summary.complete, true, label);
    assert.ok(result.manifest, label);
    assert.equal(result.summary.actualWrites, 0, label);
    assert.equal(result.firstRun.runDigest, result.secondRun.runDigest, label);
    assert.equal(
        result.firstRun.collectionSummaries.dailyMaterials.digest,
        result.secondRun.collectionSummaries.dailyMaterials.digest,
        label,
    );
    assert.equal(
        recordDigest(result.firstRun),
        recordDigest(result.secondRun),
        label,
    );
    assert.equal(result.summary.firestoreValueCanonicalizationVersion, 3);
    assert.equal(result.manifest.firestoreValueCanonicalizationVersion, 3);
  }
}

async function testTimestampDigestRaces(planner, registry) {
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  const recordDigest = (run) => run.records.find(
      ({collection}) => collection === "dailyMaterials",
  ).documentDigest;
  const transition = async (firstValue, secondValue, mutate = true) => {
    await clearFirestore();
    const reference = db.collection("dailyMaterials").doc("timestamp-race");
    await reference.set({academyId, marker: firstValue});
    return plan(planner, registry, {
      beforeSecondRun: mutate ?
        async () => reference.update({marker: secondValue}) :
        null,
    });
  };
  for (const [label, firstValue, secondValue] of [
    ["same-millisecond-nanoseconds",
      new admin.firestore.Timestamp(100, 1),
      new admin.firestore.Timestamp(100, 999999)],
    ["timestamp-to-null", new admin.firestore.Timestamp(100, 1), null],
    ["nested-timestamp",
      {nested: {value: new admin.firestore.Timestamp(100, 1)}},
      {nested: {value: new admin.firestore.Timestamp(100, 999999)}}],
    ["array-timestamp",
      {items: [new admin.firestore.Timestamp(100, 1)]},
      {items: [new admin.firestore.Timestamp(100, 999999)]}],
  ]) {
    const result = await transition(firstValue, secondValue);
    assert.equal(result.exitCode, 3, label);
    assert.equal(result.summary.consistency, false, label);
    assert.equal(result.summary.complete, false, label);
    assert.equal(result.manifest, null, label);
    assert.equal(result.summary.actualWrites, 0, label);
    assert.notEqual(result.firstRun.runDigest, result.secondRun.runDigest, label);
    assert.notEqual(
        result.firstRun.collectionSummaries.dailyMaterials.digest,
        result.secondRun.collectionSummaries.dailyMaterials.digest,
        label,
    );
    assert.notEqual(
        recordDigest(result.firstRun),
        recordDigest(result.secondRun),
        label,
    );
  }
  const stable = await transition(
      new admin.firestore.Timestamp(100, 1),
      new admin.firestore.Timestamp(100, 1),
      false,
  );
  assert.equal(stable.exitCode, 0);
  assert.equal(stable.summary.consistency, true);
  assert.equal(stable.summary.complete, true);
  assert.ok(stable.manifest);
  assert.equal(stable.summary.actualWrites, 0);
  assert.equal(stable.firstRun.runDigest, stable.secondRun.runDigest);
  assert.equal(recordDigest(stable.firstRun), recordDigest(stable.secondRun));
  assert.equal(stable.summary.firestoreValueCanonicalizationVersion, 3);
}

async function testCreditSourceIdScalarStrictness(planner, registry) {
  await clearFirestore();
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  await writeDocuments([
    {
      collection: "privateLessonReservations",
      id: "credit-source-reservation",
      data: {academyId},
    },
    {
      collection: "creditTransactions",
      id: "credit-with-array-source",
      data: {
        academyId,
        sourceType: "privateReservation",
        sourceId: ["credit-source-reservation"],
      },
    },
  ]);
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.actualWrites, 0);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code, field}) =>
            code === "malformed_reference_field" &&
            field === "sourceId",
      ),
      true,
  );
  assert.deepEqual(after, before);
}

async function testLessonPackageIdScalarStrictness(planner, registry) {
  await clearFirestore();
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  await writeDocuments([
    {
      collection: "studentPackages",
      id: "lesson-package",
      data: {academyId},
    },
    {
      collection: "lessons",
      id: "lesson-with-array-package",
      data: {
        academyId,
        packageId: ["lesson-package"],
      },
    },
  ]);
  const before = await snapshotFirestore();
  const result = await plan(planner, registry);
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 2);
  assert.equal(result.summary.actualWrites, 0);
  assert.equal(
      result.secondRun.referenceFindings.blockers.some(
          ({code, field}) =>
            code === "malformed_reference_field" &&
            field === "packageId",
      ),
      true,
  );
  assert.deepEqual(after, before);
}

async function testRootCollectionDiscoveryRace(planner, registry) {
  await clearFirestore();
  const academyId = registry.EXPECTED_TARGET_ACADEMY;
  const before = await snapshotFirestore();
  let discoveryCount = 0;
  const raceDb = {
    collection: (...args) => db.collection(...args),
    async listCollections() {
      discoveryCount += 1;
      const collections = await db.listCollections();
      if (discoveryCount === 3) {
        await db.collection("lateUnknownCollection").doc("late-row").set({
          academyId,
        });
      }
      return collections;
    },
  };
  const result = await plan(planner, registry, {db: raceDb});
  const after = await snapshotFirestore();
  assert.equal(result.exitCode, 3);
  assert.equal(result.summary.complete, false);
  assert.equal(result.summary.consistency, false);
  assert.equal(result.secondRun.rootCollectionSetStable, false);
  assert.equal(result.manifest, null);
  assert.equal(result.summary.actualWrites, 0);
  assert.deepEqual(before, {});
  assert.deepEqual(after, {
    lateUnknownCollection: [{
      id: "late-row",
      data: {academyId},
    }],
  });
}

async function main() {
  const {planner, registry} = await loadPlannerModules();
  try {
    await testEmptyAcademy(planner, registry);
    await testFullStableNoWrite(planner, registry);
    await testExactAcademyIdScope(planner, registry);
    await testProfileAndReferenceEvidence(planner, registry);
    await testUnknownCollections(planner, registry);
    await testReferenceBlockers(planner, registry);
    await testInternalOrphansAreDiagnosticOnly(planner, registry);
    await testGroupLessonAliases(planner, registry);
    await testTeacherIdentityEvidence(planner, registry);
    await testPrivateSlotStudentCardinality(planner, registry);
    await testDoubleRunMismatch(planner, registry);
    await testNonFiniteDigestRaces(planner, registry);
    await testTimestampDigestRaces(planner, registry);
    await testCreditSourceIdScalarStrictness(planner, registry);
    await testLessonPackageIdScalarStrictness(planner, registry);
    await testRootCollectionDiscoveryRace(planner, registry);
    console.log("ACADEMY_SCOPED_RESET_PLANNER_EMULATOR_PASS");
  } finally {
    await clearFirestore();
    await admin.app().delete();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
