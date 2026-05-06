import fs from 'node:fs';
import path from 'node:path';
import admin from 'firebase-admin';

const REQUIRED_ARGS = [
  'service-account',
  'expected-project-id',
  'academy-id',
  'keep-student-id',
  'duplicate-student-id',
];

const REFERENCE_CHECKS = [
  {
    collection: 'lessons',
    fields: ['studentId', 'studentID'],
  },
  {
    collection: 'lessonRequests',
    fields: ['studentId', 'studentID'],
  },
  {
    collection: 'academyMemberships',
    fields: ['studentId'],
  },
  {
    collection: 'studentPackages',
    fields: ['studentId'],
  },
  {
    collection: 'privateLessonReservations',
    fields: ['studentId'],
  },
  {
    collection: 'groupLessonReservations',
    fields: ['studentId'],
  },
  {
    collection: 'studentPrivateAccessSummary',
    fields: ['studentId'],
    arrayFields: ['activePackageIds'],
    checkDocumentId: true,
    relatedArrayFields: ['activePackageIds'],
  },
  {
    collection: 'studentGroupAccessSummary',
    fields: ['studentId'],
    checkDocumentId: true,
  },
  {
    collection: 'studentGroupAccess',
    fields: ['studentId'],
    checkDocumentId: true,
  },
];

function parseArgs(argv) {
  const args = {
    write: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--write') {
      args.write = true;
      continue;
    }
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }

    const key = token.slice(2);
    if (!key) throw new Error('Empty argument name.');
    if (key === 'write') {
      args.write = true;
      continue;
    }

    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }

  return args;
}

function fail(message, detail = {}) {
  console.error(JSON.stringify({
    ok: false,
    error: message,
    ...detail,
  }, null, 2));
  process.exit(1);
}

function requireString(args, key) {
  const value = String(args[key] || '').trim();
  if (!value) throw new Error(`Missing required argument --${key}`);
  return value;
}

function assertRequiredArgs(args) {
  const missing = REQUIRED_ARGS.filter((key) => !String(args[key] || '').trim());
  if (missing.length > 0) {
    throw new Error(`Missing required arguments: ${missing.map((key) => `--${key}`).join(', ')}`);
  }
}

function loadServiceAccount(serviceAccountPath) {
  const resolvedPath = path.resolve(serviceAccountPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Service account file not found: ${resolvedPath}`);
  }

  let serviceAccount;
  try {
    serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read service account JSON: ${error?.message || String(error)}`);
  }

  if (!serviceAccount || typeof serviceAccount !== 'object') {
    throw new Error('Service account JSON did not parse to an object.');
  }

  return { resolvedPath, serviceAccount };
}

function validateServiceAccountProject(serviceAccount, expectedProjectId) {
  const actualProjectId = String(serviceAccount.project_id || '').trim();
  if (!actualProjectId) {
    throw new Error('Service account is missing project_id.');
  }
  if (actualProjectId !== expectedProjectId) {
    throw new Error(`Service account project mismatch. Expected ${expectedProjectId}, got ${actualProjectId}.`);
  }
  return actualProjectId;
}

function initializeAdmin(serviceAccount, projectId) {
  if (admin.apps.length === 0) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
  }
  return admin.firestore();
}

function sanitizeDocData(data) {
  return JSON.parse(JSON.stringify(data || {}, (_key, value) => {
    if (value && typeof value.toDate === 'function') {
      return value.toDate().toISOString();
    }
    if (value && typeof value === 'object' && Number.isInteger(value.seconds)) {
      return {
        seconds: value.seconds,
        nanoseconds: value.nanoseconds ?? value._nanoseconds ?? 0,
      };
    }
    return value;
  }));
}

function docSummary(docSnap) {
  if (!docSnap.exists) {
    return {
      exists: false,
      path: docSnap.ref.path,
      data: null,
    };
  }

  return {
    exists: true,
    path: docSnap.ref.path,
    data: sanitizeDocData(docSnap.data()),
  };
}

function collectionPath(collectionName) {
  return collectionName;
}

function docLooksInAcademy(docSnap, data, academyId) {
  const docAcademyId = String(data?.academyId || '').trim();
  if (docAcademyId) return docAcademyId === academyId;
  return String(docSnap.id || '').includes(academyId);
}

async function getCandidateCollectionDocs(db, spec, academyId) {
  if (spec.checkDocumentId) {
    const snap = await db.collection(collectionPath(spec.collection)).get();
    return snap.docs.filter((docSnap) => docLooksInAcademy(docSnap, docSnap.data() || {}, academyId));
  }

  const snap = await db.collection(collectionPath(spec.collection))
    .where('academyId', '==', academyId)
    .get();

  return snap.docs;
}

function fieldMatchesDuplicate(data, field, duplicateStudentId) {
  return String(data?.[field] || '').trim() === duplicateStudentId;
}

function arrayFieldMatchesDuplicate(data, field, duplicateStudentId) {
  const value = data?.[field];
  if (!Array.isArray(value)) return false;
  return value.some((entry) => String(entry || '').trim() === duplicateStudentId);
}

function documentIdMatchesDuplicate(docId, duplicateStudentId) {
  return String(docId || '').includes(duplicateStudentId);
}

function extractRelatedArrays(data, relatedArrayFields = []) {
  const related = {};
  for (const field of relatedArrayFields) {
    const value = data?.[field];
    if (Array.isArray(value) && value.length > 0) {
      related[field] = value.map((entry) => String(entry));
    }
  }
  return related;
}

async function findReferencesInCollection({
  db,
  academyId,
  duplicateStudentId,
  spec,
}) {
  const docs = await getCandidateCollectionDocs(db, spec, academyId);
  const references = [];

  for (const docSnap of docs) {
    const data = docSnap.data() || {};
    const matchedBy = [];

    if (spec.checkDocumentId && documentIdMatchesDuplicate(docSnap.id, duplicateStudentId)) {
      matchedBy.push('documentId');
    }

    for (const field of spec.fields || []) {
      if (fieldMatchesDuplicate(data, field, duplicateStudentId)) {
        matchedBy.push(field);
      }
    }

    for (const field of spec.arrayFields || []) {
      if (arrayFieldMatchesDuplicate(data, field, duplicateStudentId)) {
        matchedBy.push(field);
      }
    }

    if (matchedBy.length === 0) continue;

    references.push({
      collection: spec.collection,
      path: docSnap.ref.path,
      id: docSnap.id,
      matchedBy,
      relatedArrays: extractRelatedArrays(data, spec.relatedArrayFields),
      data: sanitizeDocData(data),
    });
  }

  return references;
}

async function fetchPrivateStudentDoc(db, studentId) {
  const ref = db.collection('privateStudents').doc(studentId);
  return ref.get();
}

function assertPrivateStudentInAcademy(label, doc, academyId, studentId) {
  if (!doc.exists) {
    throw new Error(`${label} privateStudents/${studentId} does not exist.`);
  }
  const actualAcademyId = String(doc.data()?.academyId || '').trim();
  if (actualAcademyId !== academyId) {
    throw new Error(
      `${label} privateStudents/${studentId} academy mismatch. Expected ${academyId}, got ${actualAcademyId || '(missing)'}.`
    );
  }
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
    assertRequiredArgs(args);
  } catch (error) {
    fail(error?.message || String(error), {
      usage: 'node scripts/check-duplicate-private-student.mjs --service-account ./serviceAccountKey.json --expected-project-id daegu-miami-production --academy-id academy_daegumiami --keep-student-id 70G3HuLcolh9JjfOcVMV --duplicate-student-id iylASix1aRbQWnS48325 [--write]',
    });
  }

  const serviceAccountPath = requireString(args, 'service-account');
  const expectedProjectId = requireString(args, 'expected-project-id');
  const academyId = requireString(args, 'academy-id');
  const keepStudentId = requireString(args, 'keep-student-id');
  const duplicateStudentId = requireString(args, 'duplicate-student-id');
  const write = args.write === true;

  if (academyId === 'academy_default') {
    fail('Refusing to run against academy_default.', { academyId });
  }
  if (keepStudentId === duplicateStudentId) {
    fail('keep-student-id and duplicate-student-id must be different.', {
      keepStudentId,
      duplicateStudentId,
    });
  }

  const { resolvedPath, serviceAccount } = loadServiceAccount(serviceAccountPath);
  const actualProjectId = validateServiceAccountProject(serviceAccount, expectedProjectId);
  const db = initializeAdmin(serviceAccount, actualProjectId);

  const [keepStudentSnap, duplicateStudentSnap] = await Promise.all([
    fetchPrivateStudentDoc(db, keepStudentId),
    fetchPrivateStudentDoc(db, duplicateStudentId),
  ]);

  assertPrivateStudentInAcademy('keep', keepStudentSnap, academyId, keepStudentId);
  assertPrivateStudentInAcademy('duplicate', duplicateStudentSnap, academyId, duplicateStudentId);

  const referenceGroups = await Promise.all(
    REFERENCE_CHECKS.map((spec) =>
      findReferencesInCollection({
        db,
        academyId,
        duplicateStudentId,
        spec,
      })
    )
  );

  const blockingReferences = referenceGroups.flat();
  const safeToDelete = blockingReferences.length === 0;
  const result = {
    ok: true,
    dryRun: !write,
    writeRequested: write,
    serviceAccountPath: resolvedPath,
    projectId: actualProjectId,
    academyId,
    keepStudentId,
    duplicateStudentId,
    privateStudents: {
      keep: docSummary(keepStudentSnap),
      duplicate: docSummary(duplicateStudentSnap),
    },
    checkedCollections: REFERENCE_CHECKS.map((spec) => ({
      collection: spec.collection,
      fields: spec.fields,
      arrayFields: spec.arrayFields || [],
      checkDocumentId: spec.checkDocumentId === true,
      relatedArrayFields: spec.relatedArrayFields || [],
    })),
    safeToDelete,
    blockingReferences,
    action: {
      attempted: false,
      deletedDuplicatePrivateStudent: false,
      message: safeToDelete
        ? 'Duplicate private student has no blocking references. Dry-run only unless --write is passed.'
        : 'Duplicate private student has blocking references. It will not be deleted.',
    },
  };

  if (write) {
    result.action.attempted = true;

    if (!safeToDelete) {
      result.action.message = 'Refused --write because safeToDelete is false.';
      console.log(JSON.stringify(result, null, 2));
      process.exit(2);
    }

    if (duplicateStudentId === keepStudentId) {
      result.action.message = 'Refused --write because duplicate matches keep student.';
      console.log(JSON.stringify(result, null, 2));
      process.exit(2);
    }

    await db.collection('privateStudents').doc(duplicateStudentId).delete();
    result.action.deletedDuplicatePrivateStudent = true;
    result.action.message = `Deleted only privateStudents/${duplicateStudentId}. No referenced docs were deleted.`;
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  fail(error?.message || String(error), {
    stack: error?.stack || null,
  });
});
