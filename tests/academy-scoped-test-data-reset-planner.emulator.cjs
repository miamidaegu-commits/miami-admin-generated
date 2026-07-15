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
  assert.equal(result.summary.actualWrites, 0);
  assert.equal(result.summary.writeAuthorized, false);
  assert.equal(result.summary.executorImplemented, false);
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

async function main() {
  const {planner, registry} = await loadPlannerModules();
  try {
    await testEmptyAcademy(planner, registry);
    await testFullStableNoWrite(planner, registry);
    await testUnknownCollections(planner, registry);
    await testReferenceBlockers(planner, registry);
    await testInternalOrphansAreDiagnosticOnly(planner, registry);
    await testGroupLessonAliases(planner, registry);
    await testDoubleRunMismatch(planner, registry);
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
