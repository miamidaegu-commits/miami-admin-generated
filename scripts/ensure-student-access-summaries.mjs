import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function requiredString(args, key) {
  const value = String(args[key] || '').trim();
  if (!value) throw new Error(`Missing required --${key}`);
  return value;
}

function optionalString(args, key) {
  return String(args[key] || '').trim();
}

function loadServiceAccount(serviceAccountPath) {
  const resolved = path.resolve(repoRoot, serviceAccountPath || 'serviceAccountKey.json');
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing service account key: ${resolved}`);
  }
  return require(resolved);
}

function validateAcademyId(academyId) {
  if (!academyId || academyId === 'academy_default') {
    throw new Error('Refusing to run without a real academy id');
  }
}

function buildGroupSummaryData({ academyId, studentId }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  return {
    academyId,
    studentId,
    groupClassIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

function buildPrivateSummaryData({ academyId, studentId }) {
  const now = admin.firestore.FieldValue.serverTimestamp();
  return {
    academyId,
    studentId,
    teacherKeys: [],
    activePackageIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

async function commitCreates(db, creates) {
  let written = 0;
  for (let index = 0; index < creates.length; index += 450) {
    const batch = db.batch();
    for (const create of creates.slice(index, index + 450)) {
      batch.create(create.ref, create.data);
    }
    await batch.commit();
    written += creates.slice(index, index + 450).length;
  }
  return written;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const academyId = requiredString(args, 'academy-id');
  const write = args.write === true;
  const serviceAccount = loadServiceAccount(optionalString(args, 'service-account'));

  validateAcademyId(academyId);
  if (serviceAccount.project_id !== 'miami-e2e') {
    throw new Error(`Refusing to run against project ${serviceAccount.project_id || 'unknown'}`);
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
  }

  const db = admin.firestore();
  const membershipsSnap = await db
    .collection('academyMemberships')
    .where('academyId', '==', academyId)
    .where('role', '==', 'student')
    .where('status', '==', 'active')
    .get();

  const linkedStudents = membershipsSnap.docs
    .map((docSnap) => ({
      membershipId: docSnap.id,
      studentId: String((docSnap.data() || {}).studentId || '').trim(),
    }))
    .filter((row) => row.studentId);

  const missing = [];
  const creates = [];

  for (const linkedStudent of linkedStudents) {
    const summaryId = `${academyId}__${linkedStudent.studentId}`;
    const groupRef = db.collection('studentGroupAccessSummary').doc(summaryId);
    const privateRef = db.collection('studentPrivateAccessSummary').doc(summaryId);
    const [groupSnap, privateSnap] = await Promise.all([groupRef.get(), privateRef.get()]);

    if (!groupSnap.exists) {
      missing.push({
        membershipId: linkedStudent.membershipId,
        studentId: linkedStudent.studentId,
        collection: 'studentGroupAccessSummary',
        docId: summaryId,
      });
      creates.push({
        ref: groupRef,
        data: buildGroupSummaryData({ academyId, studentId: linkedStudent.studentId }),
      });
    }

    if (!privateSnap.exists) {
      missing.push({
        membershipId: linkedStudent.membershipId,
        studentId: linkedStudent.studentId,
        collection: 'studentPrivateAccessSummary',
        docId: summaryId,
      });
      creates.push({
        ref: privateRef,
        data: buildPrivateSummaryData({ academyId, studentId: linkedStudent.studentId }),
      });
    }
  }

  const written = write ? await commitCreates(db, creates) : 0;

  console.log(JSON.stringify({
    ok: true,
    projectId: serviceAccount.project_id,
    academyId,
    mode: write ? 'write' : 'dry-run',
    activeStudentMembershipsScanned: membershipsSnap.size,
    linkedStudentsScanned: linkedStudents.length,
    missingDocCount: missing.length,
    writtenDocCount: written,
    missing,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
});
