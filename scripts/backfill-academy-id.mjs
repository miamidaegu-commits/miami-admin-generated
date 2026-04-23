import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import admin from 'firebase-admin'

const require = createRequire(import.meta.url)
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(__dirname, '..', 'serviceAccountKey.json')
const DEFAULT_ACADEMY_ID =
  process.env.DEFAULT_ACADEMY_ID ||
  process.env.E2E_DEFAULT_ACADEMY_ID ||
  'academy_default'
const DEFAULT_ACADEMY_NAME =
  process.env.DEFAULT_ACADEMY_NAME ||
  process.env.E2E_DEFAULT_ACADEMY_NAME ||
  'Default Academy'

const OPERATING_COLLECTIONS = [
  'privateStudents',
  'lessons',
  'groupClasses',
  'groupStudents',
  'groupLessons',
  'studentPackages',
  'creditTransactions',
]

const PERMISSION_KEYS = [
  'canManageAttendance',
  'canAddStudent',
  'canEditStudent',
  'canDeleteStudent',
  'canEditLesson',
  'canDeleteLesson',
  'canCreateLessonDirectly',
  'requiresLessonApproval',
]

function parseArgs(argv) {
  const options = {
    dryRun: true,
    academyId: DEFAULT_ACADEMY_ID,
    academyName: DEFAULT_ACADEMY_NAME,
    serviceAccountPath: DEFAULT_SERVICE_ACCOUNT_PATH,
    expectedProjectId:
      process.env.BACKFILL_FIREBASE_PROJECT_ID ||
      process.env.E2E_FIREBASE_PROJECT_ID ||
      process.env.VITE_FIREBASE_PROJECT_ID ||
      '',
  }

  for (const arg of argv) {
    if (arg === '--write') {
      options.dryRun = false
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    if (arg.startsWith('--academy-id=')) {
      options.academyId = arg.slice('--academy-id='.length).trim()
      continue
    }
    if (arg.startsWith('--academy-name=')) {
      options.academyName = arg.slice('--academy-name='.length).trim()
      continue
    }
    if (arg.startsWith('--service-account=')) {
      options.serviceAccountPath = path.resolve(arg.slice('--service-account='.length).trim())
      continue
    }
    if (arg.startsWith('--project-id=')) {
      options.expectedProjectId = arg.slice('--project-id='.length).trim()
      continue
    }

    throw new Error(`Unknown argument: ${arg}`)
  }

  if (!options.academyId) {
    throw new Error('Missing academy id. Pass --academy-id=<id>.')
  }

  return options
}

function initializeFirebase({ serviceAccountPath, expectedProjectId }) {
  if (admin.apps.length > 0) return

  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath)
    if (
      expectedProjectId &&
      serviceAccount.project_id &&
      serviceAccount.project_id !== expectedProjectId
    ) {
      throw new Error(
        [
          'service account project_id mismatch.',
          `Expected: ${expectedProjectId}`,
          `Received: ${serviceAccount.project_id}`,
        ].join(' ')
      )
    }

    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId: serviceAccount.project_id,
    })
    return
  }

  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  })
}

function cleanPlainObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entryValue]) => entryValue !== undefined)
  )
}

function valuesEqual(a, b) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null)
}

function buildFieldChanges(existingData, desiredFields) {
  const changes = {}

  for (const [key, value] of Object.entries(desiredFields)) {
    if (!valuesEqual(existingData?.[key], value)) {
      changes[key] = {
        from: existingData?.[key] ?? null,
        to: value,
      }
    }
  }

  return changes
}

function createOperation({ db, path: refPath, existingData, desiredFields }) {
  const changes = buildFieldChanges(existingData, desiredFields)
  if (Object.keys(changes).length === 0) return null

  const ref = db.doc(refPath)
  return {
    ref,
    path: refPath,
    action: existingData ? 'UPDATE' : 'CREATE',
    changes,
    data: cleanPlainObject({
      ...desiredFields,
      createdAt: existingData ? undefined : admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    }),
  }
}

function getUserDisplayName(uid, userData) {
  return (
    String(userData.displayName || '').trim() ||
    String(userData.name || '').trim() ||
    String(userData.email || '').trim() ||
    uid
  )
}

function getMembershipRole(uid, userData, ownerUid) {
  if (uid === ownerUid) return 'owner'
  const role = String(userData.role || '').trim()
  if (['owner', 'admin', 'teacher', 'staff'].includes(role)) return role
  return role === 'teacher' ? 'teacher' : 'staff'
}

function getMembershipPermissions(userData) {
  const permissions = {}
  for (const key of PERMISSION_KEYS) {
    permissions[key] = userData[key] === true
  }
  return permissions
}

async function fetchAllDocs(db, collectionName) {
  const out = []
  const pageSize = 450
  let lastDoc = null

  while (true) {
    let queryRef = db
      .collection(collectionName)
      .orderBy(admin.firestore.FieldPath.documentId())
      .limit(pageSize)

    if (lastDoc) {
      queryRef = queryRef.startAfter(lastDoc)
    }

    const snap = await queryRef.get()
    if (snap.empty) break

    out.push(...snap.docs)
    if (snap.docs.length < pageSize) break
    lastDoc = snap.docs[snap.docs.length - 1]
  }

  return out
}

async function buildBackfillOperations({ db, academyId, academyName }) {
  const operations = []
  const nowIso = new Date().toISOString()
  const userDocs = await fetchAllDocs(db, 'users')
  const firstAdmin = userDocs.find((userDoc) => {
    const data = userDoc.data() || {}
    return String(data.role || '') === 'admin'
  })
  const ownerUid = firstAdmin?.id || userDocs[0]?.id || ''

  const academySnap = await db.collection('academies').doc(academyId).get()
  operations.push(
    createOperation({
      db,
      path: `academies/${academyId}`,
      existingData: academySnap.exists ? academySnap.data() || {} : null,
      desiredFields: {
        name: academyName,
        slug: academyId,
        ownerUid,
        status: 'active',
        plan: 'starter',
        timezone: 'Asia/Seoul',
        locale: 'ko-KR',
        migrationSource: 'backfill-academy-id',
        migrationPreparedAt: nowIso,
      },
    })
  )

  for (const userDoc of userDocs) {
    const userData = userDoc.data() || {}
    const uid = userDoc.id
    const displayName = getUserDisplayName(uid, userData)

    operations.push(
      createOperation({
        db,
        path: `users/${uid}`,
        existingData: userData,
        desiredFields: {
          uid,
          email: String(userData.email || '').trim(),
          displayName,
          lastSelectedAcademyId: academyId,
          accountScope: 'global',
        },
      })
    )

    const membershipId = `${academyId}_${uid}`
    const membershipSnap = await db.collection('academyMemberships').doc(membershipId).get()
    operations.push(
      createOperation({
        db,
        path: `academyMemberships/${membershipId}`,
        existingData: membershipSnap.exists ? membershipSnap.data() || {} : null,
        desiredFields: {
          academyId,
          uid,
          email: String(userData.email || '').trim(),
          displayName,
          role: getMembershipRole(uid, userData, ownerUid),
          teacherName: String(userData.teacherName || '').trim(),
          status: userData.isActive === false ? 'disabled' : 'active',
          permissions: getMembershipPermissions(userData),
          sourceUserDocId: uid,
          migrationSource: 'backfill-academy-id',
        },
      })
    )
  }

  for (const collectionName of OPERATING_COLLECTIONS) {
    const docs = await fetchAllDocs(db, collectionName)
    for (const docSnap of docs) {
      const data = docSnap.data() || {}
      operations.push(
        createOperation({
          db,
          path: `${collectionName}/${docSnap.id}`,
          existingData: data,
          desiredFields: {
            academyId,
          },
        })
      )
    }
  }

  return operations.filter(Boolean)
}

function printOperation(operation) {
  console.log(`[${operation.action}] ${operation.path}`)
  for (const [field, change] of Object.entries(operation.changes)) {
    console.log(`  - ${field}: ${JSON.stringify(change.from)} -> ${JSON.stringify(change.to)}`)
  }
}

async function commitOperations(operations) {
  const batchSize = 450
  let committed = 0

  for (let index = 0; index < operations.length; index += batchSize) {
    const batch = admin.firestore().batch()
    const slice = operations.slice(index, index + batchSize)

    for (const operation of slice) {
      batch.set(operation.ref, operation.data, { merge: true })
    }

    await batch.commit()
    committed += slice.length
    console.log(`[WRITE] committed ${committed}/${operations.length}`)
  }
}

async function run() {
  const options = parseArgs(process.argv.slice(2))
  initializeFirebase(options)

  const db = admin.firestore()
  const projectId =
    admin.app().options.projectId ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    '(unknown project)'

  console.log('AcademyId backfill plan')
  console.log(`- project: ${projectId}`)
  console.log(`- academyId: ${options.academyId}`)
  console.log(`- academyName: ${options.academyName}`)
  console.log(`- mode: ${options.dryRun ? 'dry-run' : 'write'}`)
  console.log('')

  const operations = await buildBackfillOperations({
    db,
    academyId: options.academyId,
    academyName: options.academyName,
  })

  if (operations.length === 0) {
    console.log('No changes needed.')
    return
  }

  for (const operation of operations) {
    printOperation(operation)
  }

  console.log('')
  console.log(`Planned changes: ${operations.length}`)

  if (options.dryRun) {
    console.log('Dry-run only. Re-run with --write to apply these changes.')
    return
  }

  await commitOperations(operations)
  console.log('Backfill complete.')
}

run().catch((error) => {
  console.error('Failed to backfill academyId.')
  console.error(error)
  process.exitCode = 1
})
