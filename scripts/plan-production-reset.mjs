import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const serviceAccountPath = path.join(repoRoot, 'serviceAccountKey.json');
const EXPECTED_PROJECT_ID = 'miami-e2e';

const TARGET_COLLECTIONS = [
  'academies',
  'users',
  'academyMemberships',
  'privateStudents',
  'studentPackages',
  'lessons',
  'groupClasses',
  'groupStudents',
  'groupLessons',
  'groupLessonReservations',
  'studentGroupAccess',
  'studentGroupAccessSummary',
  'privateLessonSlots',
  'privateLessonReservations',
  'studentPrivateAccessSummary',
  'creditTransactions',
  'accountProvisioningLogs',
];

const EXACT_TEST_EMAILS = [
  'admin@example.com',
  'teacher@example.com',
  'student@example.com',
];

const TEST_ACADEMY_IDS = [
  'academy_e2e_default',
  'academy_e2e_other',
];

function failHard(message, detail = {}) {
  console.error(JSON.stringify({
    ok: false,
    fatal: true,
    message,
    ...detail,
  }, null, 2));
  process.exit(1);
}

function loadServiceAccount() {
  if (!fs.existsSync(serviceAccountPath)) {
    failHard(`Missing service account key: ${serviceAccountPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  } catch (error) {
    failHard('Unable to read serviceAccountKey.json.', {
      error: error?.message || String(error),
    });
  }
}

function bootAdmin(serviceAccount) {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    }
  } catch (error) {
    failHard('Unable to initialize Firebase Admin SDK.', {
      error: error?.message || String(error),
    });
  }
}

function ensureExpectedProject(serviceAccount) {
  const actual = serviceAccount.project_id || admin.app().options.projectId || '';
  if (actual !== EXPECTED_PROJECT_ID) {
    failHard('Wrong Firebase project for production reset planning.', {
      expected: EXPECTED_PROJECT_ID,
      actual: actual || null,
    });
  }
  return actual;
}

function findEmails(value, output = []) {
  if (value == null) return output;

  if (typeof value === 'string') {
    const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const match of matches) {
      const email = match.toLowerCase();
      if (!output.includes(email)) output.push(email);
    }
    return output;
  }

  if (Array.isArray(value)) {
    for (const entry of value) findEmails(entry, output);
    return output;
  }

  if (typeof value === 'object') {
    for (const entry of Object.values(value)) findEmails(entry, output);
  }

  return output;
}

function hasTestEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (EXACT_TEST_EMAILS.includes(normalized)) return true;
  if (normalized.endsWith('@example.com')) return true;
  if (/^e2e-[^@]*@/.test(normalized)) return true;
  if (/^qa-[^@]*@/.test(normalized)) return true;
  if (/^private-slot-[^@]*@/.test(normalized)) return true;
  return false;
}

function hasTestId(value) {
  const text = String(value || '').trim().toLowerCase();
  if (!text) return false;
  return (
    text.startsWith('e2e-') ||
    text.startsWith('qa-') ||
    text.startsWith('private-slot-') ||
    text.includes('e2e') ||
    text.includes('probe-') ||
    text.includes('baseline')
  );
}

function hasTestAcademyId(value) {
  return TEST_ACADEMY_IDS.includes(String(value || '').trim());
}

function hasTestMarker(value) {
  if (value == null) return false;

  if (typeof value === 'string') {
    const text = value.trim().toLowerCase();
    return (
      text.includes('e2e') ||
      text.includes('probe') ||
      text.includes('fixture') ||
      text.includes('baseline') ||
      text.includes('private-slot')
    );
  }

  if (Array.isArray(value)) {
    return value.some((entry) => hasTestMarker(entry));
  }

  if (typeof value === 'object') {
    return Object.values(value).some((entry) => hasTestMarker(entry));
  }

  return false;
}

function summarizeReasons(reasons) {
  const result = [];
  for (const reason of reasons) {
    if (!result.includes(reason)) result.push(reason);
  }
  return result;
}

function classifyFirestoreDoc(collectionName, docId, data) {
  const emails = findEmails({ id: docId, ...data });
  const reasons = [];

  if (emails.some((email) => hasTestEmail(email))) reasons.push('test-looking-email');
  if (hasTestId(docId)) reasons.push('test-looking-id');
  if (hasTestAcademyId(data?.academyId)) reasons.push('test-academy-id');
  if (hasTestMarker(data)) reasons.push('test-looking-field-value');

  if (collectionName === 'academies' && hasTestId(docId)) {
    reasons.push('test-academy-document');
  }

  if (reasons.length > 0) {
    return {
      classification: 'resetCandidate',
      reasons: summarizeReasons(reasons),
      emails,
    };
  }

  if (TARGET_COLLECTIONS.includes(collectionName)) {
    return {
      classification: 'needsReview',
      reasons: ['in-reset-scope-but-not-obviously-test-data'],
      emails,
    };
  }

  return {
    classification: 'keepCandidate',
    reasons: ['outside-reset-scope'],
    emails,
  };
}

function classifyAuthUser(user) {
  const reasons = [];
  if (hasTestEmail(user.email)) reasons.push('test-looking-email');
  if (hasTestId(user.uid)) reasons.push('test-looking-uid');
  if (hasTestMarker(user.displayName)) reasons.push('test-looking-display-name');

  if (reasons.length > 0) {
    return {
      classification: 'resetCandidate',
      reasons: summarizeReasons(reasons),
    };
  }

  return {
    classification: 'needsReview',
    reasons: ['auth-user-not-obviously-test-data'],
  };
}

function emptyClassBuckets() {
  return {
    resetCandidate: [],
    keepCandidate: [],
    needsReview: [],
  };
}

function addClassified(target, entry) {
  target[entry.classification].push(entry);
}

function compactEntry(entry) {
  return {
    path: entry.path,
    classification: entry.classification,
    reasons: entry.reasons,
    email: entry.email || undefined,
    emails: entry.emails && entry.emails.length > 0 ? entry.emails : undefined,
    academyId: entry.academyId || undefined,
    role: entry.role || undefined,
    status: entry.status || undefined,
  };
}

async function inspectCollection(db, collectionName, allDocs, totals) {
  const snap = await db.collection(collectionName).get();
  const collectionResult = {
    count: snap.size,
    byClassification: {
      resetCandidate: 0,
      keepCandidate: 0,
      needsReview: 0,
    },
    error: null,
  };

  snap.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const classified = classifyFirestoreDoc(collectionName, docSnap.id, data);
    const entry = compactEntry({
      path: `${collectionName}/${docSnap.id}`,
      classification: classified.classification,
      reasons: classified.reasons,
      emails: classified.emails,
      academyId: data.academyId || '',
      role: data.role || '',
      status: data.status || '',
    });

    collectionResult.byClassification[classified.classification] += 1;
    totals.firestore[classified.classification] += 1;
    addClassified(allDocs, entry);
  });

  return collectionResult;
}

async function inspectCollections(db, allDocs, totals) {
  const collections = {};

  for (const collectionName of TARGET_COLLECTIONS) {
    try {
      collections[collectionName] = await inspectCollection(db, collectionName, allDocs, totals);
    } catch (error) {
      collections[collectionName] = {
        count: 0,
        byClassification: {
          resetCandidate: 0,
          keepCandidate: 0,
          needsReview: 0,
        },
        error: error?.message || String(error),
      };
    }
  }

  return collections;
}

async function inspectAuth(auth, allUsers, totals) {
  const authSummary = {
    count: 0,
    byClassification: {
      resetCandidate: 0,
      keepCandidate: 0,
      needsReview: 0,
    },
    error: null,
  };

  try {
    let nextPageToken;
    do {
      const page = await auth.listUsers(1000, nextPageToken);
      authSummary.count += page.users.length;

      for (const user of page.users) {
        const classified = classifyAuthUser(user);
        const entry = compactEntry({
          path: `authUsers/${user.uid}`,
          classification: classified.classification,
          reasons: classified.reasons,
          email: user.email || '',
        });

        authSummary.byClassification[classified.classification] += 1;
        totals.auth[classified.classification] += 1;
        addClassified(allUsers, entry);
      }

      nextPageToken = page.pageToken;
    } while (nextPageToken);
  } catch (error) {
    authSummary.error = error?.message || String(error);
  }

  return authSummary;
}

function buildChecklist(summary) {
  const lines = [];
  lines.push('DRY-RUN RESET PLANNER CHECKLIST');
  lines.push(`Project: ${summary.projectId}`);
  lines.push(`Read-only: ${summary.readOnly ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('Before any reset execution:');
  lines.push('- Confirm Firestore export completed and Cloud Storage path is recorded.');
  lines.push('- Confirm Firebase Auth user review/export completed separately.');
  lines.push('- Review every needsReview Firestore document and Auth user.');
  lines.push('- Confirm resetCandidate items are truly disposable.');
  lines.push('- Confirm source code, rules, indexes, functions, project config, and billing config are out of scope.');
  lines.push('');
  lines.push('Dry-run counts:');
  lines.push(`- Firestore resetCandidate: ${summary.totals.firestore.resetCandidate}`);
  lines.push(`- Firestore keepCandidate: ${summary.totals.firestore.keepCandidate}`);
  lines.push(`- Firestore needsReview: ${summary.totals.firestore.needsReview}`);
  lines.push(`- Auth resetCandidate: ${summary.totals.auth.resetCandidate}`);
  lines.push(`- Auth keepCandidate: ${summary.totals.auth.keepCandidate}`);
  lines.push(`- Auth needsReview: ${summary.totals.auth.needsReview}`);
  lines.push('');
  lines.push('Stop the line if any needsReview item has not been approved.');
  lines.push('This planner did not write or remove any data.');
  return lines.join('\n');
}

async function main() {
  const serviceAccount = loadServiceAccount();
  bootAdmin(serviceAccount);
  const projectId = ensureExpectedProject(serviceAccount);

  const db = admin.firestore();
  const auth = admin.auth();
  const documents = emptyClassBuckets();
  const authUsers = emptyClassBuckets();
  const totals = {
    firestore: {
      resetCandidate: 0,
      keepCandidate: 0,
      needsReview: 0,
    },
    auth: {
      resetCandidate: 0,
      keepCandidate: 0,
      needsReview: 0,
    },
  };

  const collections = await inspectCollections(db, documents, totals);
  const authSummary = await inspectAuth(auth, authUsers, totals);

  for (const bucket of Object.values(documents)) {
    bucket.sort((a, b) => a.path.localeCompare(b.path));
  }
  for (const bucket of Object.values(authUsers)) {
    bucket.sort((a, b) => a.path.localeCompare(b.path));
  }

  const summary = {
    ok: true,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    projectId,
    serviceAccountPath,
    collections,
    authSummary,
    totals,
    documents,
    authUsers,
    plannedResetScope: {
      firestoreCollections: TARGET_COLLECTIONS,
      authUserMarkers: [
        'admin@example.com',
        'teacher@example.com',
        'student@example.com',
        'e2e-*',
        'qa-*',
        'private-slot-*',
        '*@example.com',
      ],
    },
    warnings: [
      'This is a dry-run planner only.',
      'Firestore export does not restore Firebase Auth users.',
      'Review needsReview items before any reset execution.',
    ],
  };

  console.log('JSON_SUMMARY_START');
  console.log(JSON.stringify(summary, null, 2));
  console.log('JSON_SUMMARY_END');
  console.log('');
  console.log(buildChecklist(summary));
}

main().catch((error) => {
  failHard('Unexpected planner failure.', {
    error: error?.stack || error?.message || String(error),
  });
});
