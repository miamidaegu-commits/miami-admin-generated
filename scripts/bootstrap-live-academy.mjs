import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import admin from 'firebase-admin';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(repoRoot, 'serviceAccountKey.json');
const DEFAULT_EXPECTED_PROJECT_ID = 'miami-e2e';
const DEFAULT_TIMEZONE = 'Asia/Seoul';
const DEFAULT_LOCALE = 'ko-KR';

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

const OWNER_PERMISSION_OVERRIDES = {
  requiresLessonApproval: false,
};

function parseArgs(argv) {
  const options = {
    write: false,
    selfTest: false,
    academyId: '',
    academyName: '',
    ownerEmail: '',
    ownerDisplayName: '',
    password: '',
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

    if (key === 'write') {
      options.write = true;
      continue;
    }
    if (key === 'dry-run') {
      options.write = false;
      continue;
    }
    if (key === 'self-test') {
      options.selfTest = true;
      continue;
    }

    const value = inlineValue ?? argv[index + 1];
    if (!value || String(value).startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    if (inlineValue === null) index += 1;

    if (key === 'academy-id') {
      options.academyId = String(value).trim();
      continue;
    }
    if (key === 'academy-name') {
      options.academyName = String(value).trim();
      continue;
    }
    if (key === 'owner-email') {
      options.ownerEmail = normalizeEmail(value);
      continue;
    }
    if (key === 'owner-display-name') {
      options.ownerDisplayName = String(value).trim();
      continue;
    }
    if (key === 'password') {
      options.password = String(value);
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

function requireBootstrapOptions(options) {
  if (!options.expectedProjectId) throw new Error('Missing required --expected-project-id');
  validateAcademyId(options.academyId);
  if (!options.academyName) throw new Error('Missing required --academy-name');
  if (!options.ownerEmail) throw new Error('Missing required --owner-email');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(options.ownerEmail)) {
    throw new Error(`Invalid owner email: ${options.ownerEmail}`);
  }
}

function validateAcademyId(academyId) {
  const value = String(academyId || '').trim();
  if (!value) throw new Error('Missing required --academy-id');
  if (value === 'academy_default') {
    throw new Error('academy_default is not allowed. Pass a real --academy-id.');
  }
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('--academy-id may only contain letters, numbers, underscores, and hyphens.');
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

function buildOwnerPermissions() {
  return Object.fromEntries(
    PERMISSION_KEYS.map((key) => [
      key,
      Object.prototype.hasOwnProperty.call(OWNER_PERMISSION_OVERRIDES, key)
        ? OWNER_PERMISSION_OVERRIDES[key]
        : true,
    ])
  );
}

function normalizeRole(value) {
  const role = String(value || '').trim().toLowerCase();
  if (role === 'owner' || role === 'admin') return role;
  if (role) return role;
  return '';
}

function isOwnerLikeRole(value) {
  return ['owner', 'admin'].includes(normalizeRole(value));
}

function extractExistingRoles({ authUser, userData, memberships }) {
  const roles = [];
  const claimRole = normalizeRole(authUser?.customClaims?.role);
  if (claimRole) roles.push({ source: 'auth.customClaims.role', role: claimRole });

  const userRole = normalizeRole(userData?.role);
  if (userRole) roles.push({ source: 'users.role', role: userRole });

  for (const membership of memberships) {
    const role = normalizeRole(membership.data.role);
    if (role) {
      roles.push({
        source: `academyMemberships/${membership.id}.role`,
        role,
        academyId: membership.data.academyId || '',
      });
    }
  }

  return roles;
}

function assertExistingUserCanBecomeOwner({ authUser, userData, memberships }) {
  if (!authUser) {
    return {
      ok: true,
      checked: true,
      existingAuthUser: false,
      roles: [],
    };
  }

  const roles = extractExistingRoles({ authUser, userData, memberships });
  const blockingRoles = roles.filter((entry) => !isOwnerLikeRole(entry.role));
  if (blockingRoles.length > 0) {
    throw new Error(
      [
        'Refusing to modify an existing non-owner protected user.',
        'Use a dedicated owner/admin email or review the existing account manually.',
        `Blocking roles: ${blockingRoles.map((entry) => `${entry.source}=${entry.role}`).join(', ')}`,
      ].join(' ')
    );
  }

  return {
    ok: true,
    checked: true,
    existingAuthUser: true,
    roles,
  };
}

async function getAuthUserByEmail(auth, email) {
  try {
    return await auth.getUserByEmail(email);
  } catch (error) {
    if (error?.code === 'auth/user-not-found') return null;
    throw error;
  }
}

async function getMembershipsForUid(db, uid) {
  if (!uid) return [];
  const snap = await db.collection('academyMemberships').where('uid', '==', uid).get();
  return snap.docs.map((docSnap) => ({
    id: docSnap.id,
    data: docSnap.data() || {},
  }));
}

function serializableValue(value) {
  if (value && typeof value.toDate === 'function') return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map((entry) => serializableValue(entry));
  if (value && typeof value === 'object') {
    if (value.constructor && value.constructor.name !== 'Object') return String(value);
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, serializableValue(entry)])
    );
  }
  return value ?? null;
}

function buildFieldChanges(existingData, desiredData) {
  const changes = {};
  for (const [key, value] of Object.entries(desiredData)) {
    const existingValue = existingData?.[key];
    if (JSON.stringify(serializableValue(existingValue)) !== JSON.stringify(serializableValue(value))) {
      changes[key] = {
        from: serializableValue(existingValue),
        to: serializableValue(value),
      };
    }
  }
  return changes;
}

function createFirestoreOperation({ ref, snap, desiredData }) {
  const existingData = snap.exists ? snap.data() || {} : null;
  const changes = buildFieldChanges(existingData, desiredData);
  const createdAtPlan = existingData?.createdAt
    ? serializableValue(existingData.createdAt)
    : '<serverTimestamp>';

  return {
    ref,
    action: snap.exists ? 'merge' : 'create',
    path: ref.path,
    exists: snap.exists,
    changes,
    plannedData: {
      ...serializableValue(desiredData),
      createdAt: createdAtPlan,
      updatedAt: '<serverTimestamp>',
    },
    writeData: {
      ...desiredData,
      createdAt: existingData?.createdAt || admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    },
  };
}

function buildDesiredDocuments({ academyId, academyName, ownerEmail, ownerDisplayName, uid }) {
  const permissions = buildOwnerPermissions();
  const displayName = ownerDisplayName || ownerEmail;

  return {
    academy: {
      id: academyId,
      name: academyName,
      slug: academyId,
      ownerUid: uid,
      status: 'active',
      plan: 'starter',
      timezone: DEFAULT_TIMEZONE,
      locale: DEFAULT_LOCALE,
      source: 'post-reset-bootstrap',
    },
    user: {
      uid,
      email: ownerEmail,
      displayName,
      accountScope: 'global',
      role: 'admin',
      isActive: true,
      teacherName: '',
      lastSelectedAcademyId: academyId,
      ...permissions,
    },
    membership: {
      academyId,
      uid,
      email: ownerEmail,
      displayName,
      role: 'owner',
      status: 'active',
      teacherName: '',
      permissions,
    },
  };
}

async function writeFirestoreOperation(operation) {
  await operation.ref.set(operation.writeData, { merge: true });
}

function summarizeOperations(operations) {
  return operations.map((operation) => ({
    action: operation.action,
    path: operation.path,
    exists: operation.exists,
    changes: operation.changes,
    plannedData: operation.plannedData,
  }));
}

async function runBootstrap(options) {
  requireBootstrapOptions(options);

  const serviceAccount = loadServiceAccount(options.serviceAccountPath);
  initializeFirebase(serviceAccount);
  const projectId = assertExpectedProject(serviceAccount, options.expectedProjectId);
  const auth = admin.auth();
  const db = admin.firestore();
  const ownerDisplayName = options.ownerDisplayName || options.ownerEmail;
  const existingAuthUser = await getAuthUserByEmail(auth, options.ownerEmail);

  if (options.write && !existingAuthUser && !options.password) {
    throw new Error('Missing --password. A password is required when --write creates a new Auth user.');
  }

  const existingUid = existingAuthUser?.uid || '';
  const [existingUserSnap, existingMemberships] = await Promise.all([
    existingUid ? db.collection('users').doc(existingUid).get() : Promise.resolve(null),
    getMembershipsForUid(db, existingUid),
  ]);
  const safety = assertExistingUserCanBecomeOwner({
    authUser: existingAuthUser,
    userData: existingUserSnap?.exists ? existingUserSnap.data() || {} : null,
    memberships: existingMemberships,
  });

  let authUser = existingAuthUser;
  const authOperation = authUser
    ? {
        action: 'found',
        email: options.ownerEmail,
        uid: authUser.uid,
        displayName: authUser.displayName || '',
      }
    : {
        action: options.write ? 'create' : 'would-create',
        email: options.ownerEmail,
        uid: '<created-auth-uid>',
        displayName: ownerDisplayName,
        passwordRequiredForWrite: true,
      };

  if (options.write && !authUser) {
    authUser = await auth.createUser({
      email: options.ownerEmail,
      displayName: ownerDisplayName,
      password: options.password,
      disabled: false,
    });
    authOperation.action = 'created';
    authOperation.uid = authUser.uid;
  }

  const uid = authUser?.uid || '<created-auth-uid>';
  const desired = buildDesiredDocuments({
    academyId: options.academyId,
    academyName: options.academyName,
    ownerEmail: options.ownerEmail,
    ownerDisplayName,
    uid,
  });

  const academyRef = db.collection('academies').doc(options.academyId);
  const userRef = db.collection('users').doc(uid);
  const membershipRef = db.collection('academyMemberships').doc(`${options.academyId}_${uid}`);
  const [academySnap, userSnap, membershipSnap] = await Promise.all([
    academyRef.get(),
    authUser ? userRef.get() : Promise.resolve({ exists: false, data: () => ({}) }),
    authUser ? membershipRef.get() : Promise.resolve({ exists: false, data: () => ({}) }),
  ]);

  const firestoreOperations = [
    createFirestoreOperation({ ref: academyRef, snap: academySnap, desiredData: desired.academy }),
    createFirestoreOperation({ ref: userRef, snap: userSnap, desiredData: desired.user }),
    createFirestoreOperation({ ref: membershipRef, snap: membershipSnap, desiredData: desired.membership }),
  ];

  if (options.write) {
    for (const operation of firestoreOperations) {
      await writeFirestoreOperation(operation);
    }
  }

  return {
    ok: true,
    mode: options.write ? 'write' : 'dry-run',
    readOnly: !options.write,
    projectId,
    academyId: options.academyId,
    academyName: options.academyName,
    ownerEmail: options.ownerEmail,
    auth: authOperation,
    safety,
    firestore: summarizeOperations(firestoreOperations),
    notes: [
      'This script never deletes data.',
      'Dry-run is the default. Firestore writes and Auth creation only occur with --write.',
      'Existing non-owner protected users are refused before owner bootstrap writes.',
    ],
  };
}

function runSelfTest() {
  assert.throws(() => validateAcademyId(''), /Missing required --academy-id/);
  assert.throws(() => validateAcademyId('academy_default'), /academy_default is not allowed/);
  assert.doesNotThrow(() => validateAcademyId('academy_live_main'));

  assert.deepEqual(buildOwnerPermissions(), {
    canManageAttendance: true,
    canAddStudent: true,
    canEditStudent: true,
    canDeleteStudent: true,
    canEditLesson: true,
    canDeleteLesson: true,
    canCreateLessonDirectly: true,
    requiresLessonApproval: false,
  });

  assert.throws(
    () => assertExistingUserCanBecomeOwner({
      authUser: { uid: 'uid1', customClaims: { role: 'student' } },
      userData: { role: 'student' },
      memberships: [],
    }),
    /Refusing to modify an existing non-owner protected user/
  );

  assert.doesNotThrow(() => assertExistingUserCanBecomeOwner({
    authUser: { uid: 'uid1', customClaims: { role: 'admin' } },
    userData: { role: 'admin' },
    memberships: [{ id: 'academy_uid1', data: { role: 'owner', academyId: 'academy_live_main' } }],
  }));

  console.log(JSON.stringify({ ok: true, selfTest: true }, null, 2));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.selfTest) {
    runSelfTest();
    return;
  }

  const summary = await runBootstrap(options);
  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      error: error?.message || String(error),
    }, null, 2));
    process.exitCode = 1;
  });
}
