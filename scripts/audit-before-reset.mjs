import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const serviceAccountPath = path.join(repoRoot, 'serviceAccountKey.json');
const EXPECTED_PROJECT_ID = 'miami-e2e';

const COLLECTIONS = [
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

const EXACT_SUSPICIOUS_EMAILS = new Set([
  'admin@example.com',
  'teacher@example.com',
  'student@example.com',
]);

function fatalConfigError(message, detail = {}) {
  console.error(JSON.stringify({
    ok: false,
    fatal: true,
    reason: 'service-account-config-unreadable',
    message,
    ...detail,
  }, null, 2));
  process.exit(1);
}

function loadServiceAccount() {
  if (!fs.existsSync(serviceAccountPath)) {
    fatalConfigError(`Missing service account key: ${serviceAccountPath}`);
  }

  try {
    const raw = fs.readFileSync(serviceAccountPath, 'utf8');
    return JSON.parse(raw);
  } catch (error) {
    fatalConfigError('Unable to read or parse serviceAccountKey.json.', {
      error: error?.message || String(error),
    });
  }
}

function initializeFirebase(serviceAccount) {
  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        projectId: serviceAccount.project_id,
      });
    }
  } catch (error) {
    fatalConfigError('Unable to initialize Firebase Admin SDK from serviceAccountKey.json.', {
      error: error?.message || String(error),
    });
  }
}

function emptyAcademyIdSummary() {
  return {
    withAcademyId: 0,
    missingAcademyId: 0,
    byValue: {},
  };
}

function increment(map, key) {
  const normalizedKey = String(key || '(missing)');
  map[normalizedKey] = (map[normalizedKey] || 0) + 1;
}

function addAcademyId(summary, value) {
  const academyId = typeof value === 'string' ? value.trim() : '';
  if (!academyId) {
    summary.missingAcademyId += 1;
    return;
  }

  summary.withAcademyId += 1;
  increment(summary.byValue, academyId);
}

function extractEmails(value, emails = new Set()) {
  if (value == null) return emails;

  if (typeof value === 'string') {
    const matches = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi) || [];
    for (const match of matches) {
      emails.add(match.toLowerCase());
    }
    return emails;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      extractEmails(entry, emails);
    }
    return emails;
  }

  if (typeof value === 'object') {
    for (const entry of Object.values(value)) {
      extractEmails(entry, emails);
    }
  }

  return emails;
}

function isSuspiciousEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!normalized) return false;
  if (EXACT_SUSPICIOUS_EMAILS.has(normalized)) return true;
  if (normalized.endsWith('@example.com')) return true;
  if (/^e2e-[^@]*@/.test(normalized)) return true;
  if (/^qa-[^@]*@/.test(normalized)) return true;
  if (/^private-slot-[^@]*@/.test(normalized)) return true;
  return false;
}

function addSuspiciousEmail(found, { email, source, path: sourcePath }) {
  const normalized = String(email || '').trim().toLowerCase();
  if (!isSuspiciousEmail(normalized)) return;

  if (!found.has(normalized)) {
    found.set(normalized, {
      email: normalized,
      sources: [],
    });
  }

  const entry = found.get(normalized);
  const sourceRecord = { source, path: sourcePath };
  if (!entry.sources.some((existing) => (
    existing.source === sourceRecord.source && existing.path === sourceRecord.path
  ))) {
    entry.sources.push(sourceRecord);
  }
}

async function auditFirestoreCollection(db, collectionName, suspiciousEmails, totalAcademyIds) {
  const collectionSummary = {
    count: 0,
    academyIdValues: emptyAcademyIdSummary(),
    error: null,
  };

  try {
    const snap = await db.collection(collectionName).get();
    collectionSummary.count = snap.size;

    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const docPath = `${collectionName}/${docSnap.id}`;
      addAcademyId(collectionSummary.academyIdValues, data.academyId);
      addAcademyId(totalAcademyIds, data.academyId);

      const emails = extractEmails({ id: docSnap.id, ...data });
      for (const email of emails) {
        addSuspiciousEmail(suspiciousEmails, {
          email,
          source: 'firestore',
          path: docPath,
        });
      }
    });
  } catch (error) {
    collectionSummary.error = error?.message || String(error);
  }

  return collectionSummary;
}

async function auditMemberships(db) {
  const byRoleStatus = {};

  try {
    const snap = await db.collection('academyMemberships').get();
    snap.forEach((docSnap) => {
      const data = docSnap.data() || {};
      const role = String(data.role || '(missing)').trim() || '(missing)';
      const status = String(data.status || '(missing)').trim() || '(missing)';
      const key = `${role}/${status}`;
      increment(byRoleStatus, key);
    });

    return {
      byRoleStatus,
      error: null,
    };
  } catch (error) {
    return {
      byRoleStatus,
      error: error?.message || String(error),
    };
  }
}

async function auditAuthUsers(auth, suspiciousEmails) {
  const summary = {
    checked: true,
    totalScanned: 0,
    error: null,
  };

  let nextPageToken;
  try {
    do {
      const result = await auth.listUsers(1000, nextPageToken);
      summary.totalScanned += result.users.length;
      for (const user of result.users) {
        addSuspiciousEmail(suspiciousEmails, {
          email: user.email,
          source: 'auth',
          path: `authUsers/${user.uid}`,
        });
      }
      nextPageToken = result.pageToken;
    } while (nextPageToken);
  } catch (error) {
    summary.error = error?.message || String(error);
  }

  return summary;
}

async function main() {
  const serviceAccount = loadServiceAccount();
  initializeFirebase(serviceAccount);

  const db = admin.firestore();
  const auth = admin.auth();
  const suspiciousEmails = new Map();
  const totalAcademyIds = emptyAcademyIdSummary();
  const collections = {};

  for (const collectionName of COLLECTIONS) {
    collections[collectionName] = await auditFirestoreCollection(
      db,
      collectionName,
      suspiciousEmails,
      totalAcademyIds
    );
  }

  const memberships = await auditMemberships(db);
  const authUsers = await auditAuthUsers(auth, suspiciousEmails);
  const configuredProjectId = serviceAccount.project_id || admin.app().options.projectId || '';
  const projectCheck = {
    expected: EXPECTED_PROJECT_ID,
    actual: configuredProjectId || null,
    ok: configuredProjectId === EXPECTED_PROJECT_ID,
  };

  const summary = {
    ok: projectCheck.ok,
    generatedAt: new Date().toISOString(),
    readOnly: true,
    serviceAccountPath,
    projectCheck,
    collections,
    memberships,
    academyIdValues: totalAcademyIds,
    suspiciousEmails: Array.from(suspiciousEmails.values())
      .sort((a, b) => a.email.localeCompare(b.email)),
    authUsers,
    notes: [
      'This audit only reads Firestore and Firebase Auth metadata.',
      'Firestore export does not back up Firebase Authentication users.',
      'Review suspicious/test-looking emails before any reset.',
    ],
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  fatalConfigError('Unexpected audit startup failure.', {
    error: error?.stack || error?.message || String(error),
  });
});
