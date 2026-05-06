import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(repoRoot, 'serviceAccountKey.json');
const DEFAULT_EXPECTED_PROJECT_ID = 'miami-e2e';

const PERMISSION_KEYS = [
  'canManageAttendance',
  'canAddStudent',
  'canEditStudent',
  'canDeleteStudent',
  'canEditLesson',
  'canDeleteLesson',
  'canCreateLessonDirectly',
  'requiresLessonApproval',
];

function parseArgs(argv) {
  const options = {
    academyId: '',
    ownerEmail: '',
    serviceAccountPath: DEFAULT_SERVICE_ACCOUNT_PATH,
    expectedProjectId: DEFAULT_EXPECTED_PROJECT_ID,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected argument: ${token}`);
    }

    const eqIndex = token.indexOf('=');
    const key = eqIndex === -1 ? token.slice(2) : token.slice(2, eqIndex);
    const inlineValue = eqIndex === -1 ? null : token.slice(eqIndex + 1);
    const value = inlineValue ?? argv[index + 1];
    if (!value || String(value).startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    if (inlineValue === null) index += 1;

    if (key === 'academy-id') {
      options.academyId = String(value).trim();
      continue;
    }
    if (key === 'owner-email') {
      options.ownerEmail = normalizeEmail(value);
      continue;
    }
    if (key === 'service-account') {
      options.serviceAccountPath = path.resolve(repoRoot, String(value).trim());
      continue;
    }
    if (key === 'expected-project-id') {
      options.expectedProjectId = String(value).trim();
      continue;
    }

    throw new Error(`Unknown argument: --${key}`);
  }

  return options;
}

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validateAcademyId(academyId) {
  const value = String(academyId || '').trim();
  if (!value) throw new Error('Missing required --academy-id');
  if (value === 'academy_default') {
    throw new Error('academy_default is not allowed.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('--academy-id may only contain letters, numbers, underscores, and hyphens.');
  }
}

function validateOptions(options) {
  if (!options.expectedProjectId) throw new Error('Missing required --expected-project-id');
  validateAcademyId(options.academyId);
  if (!options.ownerEmail) throw new Error('Missing required --owner-email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.ownerEmail)) {
    throw new Error(`Invalid owner email: ${options.ownerEmail}`);
  }
}

function loadServiceAccount(serviceAccountPath) {
  if (!fs.existsSync(serviceAccountPath)) {
    throw new Error(`Missing service account key: ${serviceAccountPath}`);
  }

  try {
    return JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
  } catch (error) {
    throw new Error(`Unable to read service account key: ${error?.message || String(error)}`);
  }
}

function initializeFirebase(serviceAccount) {
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    });
  }
}

function assertExpectedProject(serviceAccount, expectedProjectId) {
  const projectId = serviceAccount.project_id || admin.app().options.projectId || '';
  if (projectId !== expectedProjectId) {
    throw new Error(`Expected Firebase project ${expectedProjectId}, received ${projectId || '(missing)'}`);
  }
  return projectId;
}

function createCheck(name, ok, details = {}) {
  return {
    name,
    ok: Boolean(ok),
    ...details,
  };
}

function addCheck(checks, name, ok, details = {}) {
  const check = createCheck(name, ok, details);
  checks.push(check);
  return check;
}

function normalizeRole(value) {
  return String(value || '').trim().toLowerCase();
}

function permissionSummary(permissions) {
  const source = permissions && typeof permissions === 'object' ? permissions : {};
  return Object.fromEntries(PERMISSION_KEYS.map((key) => [key, source[key] === true]));
}

async function getAuthUserByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function runSmoke(options) {
  validateOptions(options);
  const serviceAccount = loadServiceAccount(options.serviceAccountPath);
  initializeFirebase(serviceAccount);
  const projectId = assertExpectedProject(serviceAccount, options.expectedProjectId);
  const db = admin.firestore();
  const auth = admin.auth();
  const checks = [];

  addCheck(checks, 'academy_id_is_not_academy_default', options.academyId !== 'academy_default', {
    academyId: options.academyId,
  });

  const academyRef = db.collection('academies').doc(options.academyId);
  const academySnap = await academyRef.get();
  const academy = academySnap.exists ? academySnap.data() || {} : null;
  addCheck(checks, 'academy_doc_exists', academySnap.exists, { path: academyRef.path });
  addCheck(checks, 'academy_status_active', academy?.status === 'active', {
    path: academyRef.path,
    actual: academy?.status || null,
  });

  const authUser = await getAuthUserByEmail(auth, options.ownerEmail);
  addCheck(checks, 'owner_auth_user_exists', Boolean(authUser), {
    email: options.ownerEmail,
    uid: authUser?.uid || null,
  });

  const uid = authUser?.uid || '';
  const userRef = uid ? db.collection('users').doc(uid) : null;
  const membershipRef = uid
    ? db.collection('academyMemberships').doc(`${options.academyId}_${uid}`)
    : null;

  const [userSnap, membershipSnap] = await Promise.all([
    userRef ? userRef.get() : Promise.resolve(null),
    membershipRef ? membershipRef.get() : Promise.resolve(null),
  ]);

  const user = userSnap?.exists ? userSnap.data() || {} : null;
  const membership = membershipSnap?.exists ? membershipSnap.data() || {} : null;

  addCheck(checks, 'owner_user_doc_exists', Boolean(userSnap?.exists), {
    path: userRef?.path || null,
  });
  addCheck(checks, 'owner_user_role_admin', normalizeRole(user?.role) === 'admin', {
    path: userRef?.path || null,
    actual: user?.role || null,
  });
  addCheck(checks, 'owner_user_last_selected_academy_matches', user?.lastSelectedAcademyId === options.academyId, {
    path: userRef?.path || null,
    expected: options.academyId,
    actual: user?.lastSelectedAcademyId || null,
  });

  addCheck(checks, 'owner_membership_doc_exists', Boolean(membershipSnap?.exists), {
    path: membershipRef?.path || null,
  });
  addCheck(checks, 'owner_membership_role_owner', normalizeRole(membership?.role) === 'owner', {
    path: membershipRef?.path || null,
    actual: membership?.role || null,
  });
  addCheck(checks, 'owner_membership_status_active', membership?.status === 'active', {
    path: membershipRef?.path || null,
    actual: membership?.status || null,
  });

  const permissions = permissionSummary(membership?.permissions);
  const missingPermissionKeys = PERMISSION_KEYS.filter((key) => (
    !Object.prototype.hasOwnProperty.call(membership?.permissions || {}, key)
  ));
  addCheck(checks, 'owner_membership_permissions_include_all_known_keys', missingPermissionKeys.length === 0, {
    path: membershipRef?.path || null,
    expectedKeys: PERMISSION_KEYS,
    missingKeys: missingPermissionKeys,
    permissions,
  });

  addCheck(checks, 'link_student_account_readiness_note_documented', true, {
    note: 'After owner/admin smoke passes, verify linkStudentAccount callable deployment and run student account linking through the approved flow.',
    functionName: 'linkStudentAccount',
  });

  const ok = checks.every((check) => check.ok);
  return {
    ok,
    readOnly: true,
    projectId,
    academyId: options.academyId,
    ownerEmail: options.ownerEmail,
    uid: uid || null,
    checks,
    failures: checks.filter((check) => !check.ok),
    notes: [
      'This smoke script only reads Firebase Auth and Firestore.',
      'It does not verify browser login or deployed callable execution.',
      'Firestore export does not restore Firebase Auth users; Auth recovery remains separate.',
    ],
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const summary = await runSmoke(options);
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.ok) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      readOnly: true,
      error: error?.message || String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}
