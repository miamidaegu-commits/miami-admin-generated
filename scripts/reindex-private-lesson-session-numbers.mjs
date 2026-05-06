import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const require = createRequire(import.meta.url);
const WRITE_BATCH_SIZE = 450;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    index += 1;
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
  const resolved = path.resolve(repoRoot, serviceAccountPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`Missing service account key: ${resolved}`);
  }
  return require(resolved);
}

function getLessonStudentId(lesson) {
  return String(lesson?.studentId || lesson?.studentID || '').trim();
}

function getLessonTeacher(lesson) {
  return String(lesson?.teacher || lesson?.teacherName || '').trim();
}

function isActiveLesson(lesson) {
  const status = String(lesson?.status || '').trim().toLowerCase();
  return lesson?.isDeductCancelled !== true &&
    lesson?.cancelled !== true &&
    status !== 'cancelled' &&
    status !== 'canceled';
}

function hasValidDate(lesson) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(lesson?.date || '').trim());
}

function sortLessons(a, b) {
  const aKey = `${String(a.date || '')} ${String(a.time || '')} ${a.id}`;
  const bKey = `${String(b.date || '')} ${String(b.time || '')} ${b.id}`;
  return aKey.localeCompare(bKey);
}

async function fetchMatchingLessons(db, { academyId, studentId, teacher }) {
  const snap = await db.collection('lessons').where('academyId', '==', academyId).get();
  const matching = [];
  const skipped = [];

  snap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    const row = {
      id: docSnap.id,
      ref: docSnap.ref,
      ...data,
    };

    if (getLessonStudentId(data) !== studentId) return;
    if (teacher && getLessonTeacher(data) !== teacher) return;

    if (!isActiveLesson(data)) {
      skipped.push({
        id: docSnap.id,
        reason: 'inactive-or-deduct-cancelled',
        date: String(data.date || ''),
        time: String(data.time || ''),
        teacher: getLessonTeacher(data),
        sessionNumber: data.sessionNumber || null,
      });
      return;
    }

    if (!hasValidDate(data)) {
      skipped.push({
        id: docSnap.id,
        reason: 'invalid-date',
        date: String(data.date || ''),
        time: String(data.time || ''),
        teacher: getLessonTeacher(data),
        sessionNumber: data.sessionNumber || null,
      });
      return;
    }

    matching.push(row);
  });

  return {
    scannedCount: snap.size,
    matching,
    skipped,
  };
}

function buildPlan(lessons) {
  return [...lessons].sort(sortLessons).map((lesson, index) => {
    const before = Number.isFinite(Number(lesson.sessionNumber))
      ? Number(lesson.sessionNumber)
      : null;
    const after = index + 1;
    return {
      id: lesson.id,
      date: String(lesson.date || ''),
      time: String(lesson.time || ''),
      teacher: getLessonTeacher(lesson),
      studentId: getLessonStudentId(lesson),
      before,
      after,
      changed: before !== after,
      ref: lesson.ref,
    };
  });
}

async function writePlan(db, plan) {
  const changed = plan.filter((row) => row.changed);
  let written = 0;

  for (let index = 0; index < changed.length; index += WRITE_BATCH_SIZE) {
    const batch = db.batch();
    const chunk = changed.slice(index, index + WRITE_BATCH_SIZE);
    chunk.forEach((row) => {
      batch.update(row.ref, {
        sessionNumber: row.after,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    await batch.commit();
    written += chunk.length;
  }

  return written;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serviceAccountPath = requiredString(args, 'service-account');
  const expectedProjectId = requiredString(args, 'expected-project-id');
  const academyId = requiredString(args, 'academy-id');
  const studentId = requiredString(args, 'student-id');
  const teacher = optionalString(args, 'teacher');
  const write = args.write === true;

  if (academyId === 'academy_default') {
    throw new Error('Refusing to run against academy_default.');
  }

  const serviceAccount = loadServiceAccount(serviceAccountPath);
  if (serviceAccount.project_id !== expectedProjectId) {
    throw new Error(
      `Service account project mismatch: expected ${expectedProjectId}, received ${serviceAccount.project_id || '(missing)'}.`
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    projectId: expectedProjectId,
  });

  const db = admin.firestore();
  const { scannedCount, matching, skipped } = await fetchMatchingLessons(db, {
    academyId,
    studentId,
    teacher,
  });
  const plan = buildPlan(matching);
  const printablePlan = plan.map(({ ref, ...row }) => row);
  const changedCount = plan.filter((row) => row.changed).length;
  const writtenCount = write ? await writePlan(db, plan) : 0;

  console.log(JSON.stringify({
    ok: true,
    mode: write ? 'write' : 'dry-run',
    projectId: expectedProjectId,
    academyId,
    studentId,
    teacher: teacher || null,
    scannedLessonCount: scannedCount,
    plannedLessonCount: plan.length,
    changedLessonCount: changedCount,
    writtenLessonCount: writtenCount,
    skipped,
    plan: printablePlan,
  }, null, 2));

  await admin.app().delete();
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    message: error?.message || String(error),
  }, null, 2));
  process.exitCode = 1;
});
