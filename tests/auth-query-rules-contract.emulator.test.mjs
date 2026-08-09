import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'

import admin from 'firebase-admin'
import { deleteApp, initializeApp } from 'firebase/app'
import {
  collection,
  connectFirestoreEmulator,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  query,
  where,
} from 'firebase/firestore'

const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST || ''
assert.ok(emulatorHost, 'FIRESTORE_EMULATOR_HOST is required')

const separator = emulatorHost.lastIndexOf(':')
assert.notEqual(separator, -1, 'FIRESTORE_EMULATOR_HOST must include a port')
const hostname = emulatorHost.slice(0, separator).replace(/^\[|\]$/g, '')
const port = Number(emulatorHost.slice(separator + 1))
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(hostname))
assert.ok(Number.isInteger(port) && port > 0 && port <= 65535)

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'demo-auth-query-rules-contract'
assert.match(PROJECT_ID, /^demo-/)

const suffix = `${process.pid}-${Date.now()}`
const ACADEMY_A = `academy-a-${suffix}`
const ACADEMY_B = `academy-b-${suffix}`
const TEACHER_UID = `teacher-a-${suffix}`
const OTHER_TEACHER_UID = `teacher-b-${suffix}`
const ADMIN_UID = `admin-a-${suffix}`
const OWNER_UID = `owner-a-${suffix}`
const STUDENT_UID = `student-auth-a-${suffix}`
const STUDENT_ID = `student-a-${suffix}`
const OTHER_STUDENT_ID = `student-b-${suffix}`
const LEGACY_TEACHER_NAME = `legacy-teacher-${suffix}`

const clientApps = []
const fixtureRefs = []
let adminApp
let adminDb
let teacherDb
let adminClientDb
let ownerDb
let studentDb
let unauthDb

function clientFor(label, mockUserToken) {
  const app = initializeApp(
    {
      apiKey: 'demo-api-key',
      authDomain: 'demo.firebaseapp.com',
      projectId: PROJECT_ID,
      appId: `auth-query-rules-${label}-${suffix}`,
    },
    `auth-query-rules-${label}-${suffix}`
  )
  clientApps.push(app)
  const db = getFirestore(app)
  const options = mockUserToken ? { mockUserToken } : undefined
  connectFirestoreEmulator(db, hostname, port, options)
  return db
}

function token(uid, role) {
  return {
    sub: uid,
    user_id: uid,
    email: `${uid}@example.test`,
    role,
  }
}

function track(collectionName, documentId) {
  const ref = adminDb.collection(collectionName).doc(documentId)
  fixtureRefs.push(ref)
  return ref
}

async function expectDenied(operation) {
  await assert.rejects(operation, (error) => {
    assert.equal(String(error?.code || '').replace(/^firestore\//, ''), 'permission-denied')
    return true
  })
}

function groupQuery(db, ...constraints) {
  return getDocs(query(collection(db, 'groupClasses'), ...constraints))
}

function reservationQuery(db, ...constraints) {
  return getDocs(query(collection(db, 'privateLessonReservations'), ...constraints))
}

function academyMembership(academyId, uid, role, extra = {}) {
  return {
    academyId,
    uid,
    role,
    status: 'active',
    teacherName: role === 'teacher' ? LEGACY_TEACHER_NAME : '',
    permissions: {},
    ...extra,
  }
}

before(async () => {
  adminApp = admin.initializeApp({ projectId: PROJECT_ID }, `auth-query-rules-admin-${suffix}`)
  adminDb = admin.firestore(adminApp)
  teacherDb = clientFor('teacher', token(TEACHER_UID, 'teacher'))
  adminClientDb = clientFor('admin', token(ADMIN_UID, 'admin'))
  ownerDb = clientFor('owner', token(OWNER_UID, 'owner'))
  studentDb = clientFor('student', token(STUDENT_UID, 'student'))
  unauthDb = clientFor('unauth')

  await Promise.all([
    track('academyMemberships', `${ACADEMY_A}_${TEACHER_UID}`).set(
      academyMembership(ACADEMY_A, TEACHER_UID, 'teacher')
    ),
    track('academyMemberships', `${ACADEMY_A}_${ADMIN_UID}`).set(
      academyMembership(ACADEMY_A, ADMIN_UID, 'admin')
    ),
    track('academyMemberships', `${ACADEMY_A}_${OWNER_UID}`).set(
      academyMembership(ACADEMY_A, OWNER_UID, 'owner')
    ),
    track('academyMemberships', `${ACADEMY_A}_${STUDENT_UID}`).set(
      academyMembership(ACADEMY_A, STUDENT_UID, 'student', { studentId: STUDENT_ID })
    ),
    track('groupClasses', `group-own-${suffix}`).set({
      academyId: ACADEMY_A,
      teacherUid: TEACHER_UID,
      teacherName: LEGACY_TEACHER_NAME,
      status: 'active',
    }),
    track('groupClasses', `group-renamed-${suffix}`).set({
      academyId: ACADEMY_A,
      teacherUid: TEACHER_UID,
      teacherName: `renamed-${suffix}`,
      status: 'active',
    }),
    track('groupClasses', `group-other-teacher-${suffix}`).set({
      academyId: ACADEMY_A,
      teacherUid: OTHER_TEACHER_UID,
      teacherName: `other-${suffix}`,
      status: 'active',
    }),
    track('groupClasses', `group-other-academy-${suffix}`).set({
      academyId: ACADEMY_B,
      teacherUid: TEACHER_UID,
      teacherName: LEGACY_TEACHER_NAME,
      status: 'active',
    }),
    track('privateLessonReservations', `reservation-own-${suffix}`).set({
      academyId: ACADEMY_A,
      teacherUid: TEACHER_UID,
      teacherName: `renamed-${suffix}`,
      studentId: OTHER_STUDENT_ID,
      status: 'active',
    }),
    track('privateLessonReservations', `reservation-other-teacher-${suffix}`).set({
      academyId: ACADEMY_A,
      teacherUid: OTHER_TEACHER_UID,
      studentId: OTHER_STUDENT_ID,
      status: 'active',
    }),
    track('privateLessonReservations', `reservation-other-academy-${suffix}`).set({
      academyId: ACADEMY_B,
      teacherUid: TEACHER_UID,
      studentId: OTHER_STUDENT_ID,
      status: 'active',
    }),
    track('privateLessonReservations', `reservation-student-${suffix}`).set({
      academyId: ACADEMY_A,
      teacherUid: OTHER_TEACHER_UID,
      studentId: STUDENT_ID,
      status: 'active',
    }),
    track('privateStudents', STUDENT_ID).set({
      academyId: ACADEMY_A,
      name: `Student A ${suffix}`,
    }),
    track('privateStudents', OTHER_STUDENT_ID).set({
      academyId: ACADEMY_A,
      name: `Student B ${suffix}`,
    }),
    track('privateStudents', `other-academy-student-${suffix}`).set({
      academyId: ACADEMY_B,
      name: `Other academy student ${suffix}`,
    }),
  ])
})

after(async () => {
  await Promise.all(fixtureRefs.reverse().map((ref) => ref.delete().catch(() => {})))
  await Promise.all(clientApps.map((app) => deleteApp(app).catch(() => {})))
  if (adminApp) await adminApp.delete()
})

test('1 own academy+teacherUid group query allow', async () => {
  const snapshot = await groupQuery(
    teacherDb,
    where('academyId', '==', ACADEMY_A),
    where('teacherUid', '==', TEACHER_UID)
  )
  assert.equal(snapshot.size, 2)
})

test('2 other teacher group query deny', async () => {
  await expectDenied(() =>
    groupQuery(
      teacherDb,
      where('academyId', '==', ACADEMY_A),
      where('teacherUid', '==', OTHER_TEACHER_UID)
    )
  )
})

test('3 other academy group query deny', async () => {
  await expectDenied(() =>
    groupQuery(
      teacherDb,
      where('academyId', '==', ACADEMY_B),
      where('teacherUid', '==', TEACHER_UID)
    )
  )
})

test('4 unscoped group query deny', async () => {
  await expectDenied(() => groupQuery(teacherDb))
})

test('5 unauthenticated group query deny', async () => {
  await expectDenied(() =>
    groupQuery(
      unauthDb,
      where('academyId', '==', ACADEMY_A),
      where('teacherUid', '==', TEACHER_UID)
    )
  )
})

test('6 admin and owner group access preserved', async () => {
  const constraints = [where('academyId', '==', ACADEMY_A)]
  assert.equal((await groupQuery(adminClientDb, ...constraints)).size, 3)
  assert.equal((await groupQuery(ownerDb, ...constraints)).size, 3)
})

test('7 current live name query compatibility preserved', async () => {
  const snapshot = await groupQuery(
    teacherDb,
    where('academyId', '==', ACADEMY_A),
    where('teacherName', '==', LEGACY_TEACHER_NAME)
  )
  assert.equal(snapshot.size, 1)
})

test('8 canonical group query is independent of display name', async () => {
  const snapshot = await groupQuery(
    teacherDb,
    where('academyId', '==', ACADEMY_A),
    where('teacherUid', '==', TEACHER_UID)
  )
  assert.ok(snapshot.docs.some((row) => row.data().teacherName === `renamed-${suffix}`))
})

test('9 own canonical reservation query allow', async () => {
  const snapshot = await reservationQuery(
    teacherDb,
    where('academyId', '==', ACADEMY_A),
    where('teacherUid', '==', TEACHER_UID)
  )
  assert.equal(snapshot.size, 1)
})

test('10 other UID reservation query deny', async () => {
  await expectDenied(() =>
    reservationQuery(
      teacherDb,
      where('academyId', '==', ACADEMY_A),
      where('teacherUid', '==', OTHER_TEACHER_UID)
    )
  )
})

test('11 other academy reservation query deny', async () => {
  await expectDenied(() =>
    reservationQuery(
      teacherDb,
      where('academyId', '==', ACADEMY_B),
      where('teacherUid', '==', TEACHER_UID)
    )
  )
})

test('12 student own reservation access preserved', async () => {
  const snapshot = await reservationQuery(
    studentDb,
    where('academyId', '==', ACADEMY_A),
    where('studentId', '==', STUDENT_ID)
  )
  assert.equal(snapshot.size, 1)
})

test('13 unauthenticated reservation query deny', async () => {
  await expectDenied(() =>
    reservationQuery(
      unauthDb,
      where('academyId', '==', ACADEMY_A),
      where('teacherUid', '==', TEACHER_UID)
    )
  )
})

function reservationListenerBlock() {
  const source = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8')
  const marker = "      setPrivateLessonReservations([])\n      setPrivateLessonReservationsLoading(false)"
  const markerIndex = source.indexOf(marker)
  assert.notEqual(markerIndex, -1)
  const startIndex = source.lastIndexOf('  useEffect(() => {', markerIndex)
  const endMarker =
    '  }, [canonicalTeacherIdentity, currentAcademyId, user?.uid, userProfile?.role])'
  const endIndex = source.indexOf(endMarker, markerIndex)
  assert.notEqual(endIndex, -1)
  return source.slice(startIndex, endIndex + endMarker.length)
}

test('14 source has no teacherUID reservation listener', () => {
  assert.doesNotMatch(reservationListenerBlock(), /\['teacherUID'/)
})

test('15 source has no teacherKey reservation listener', () => {
  assert.doesNotMatch(reservationListenerBlock(), /\['teacherKey'/)
})

test('16 needed privateStudent exact self get allow', async () => {
  const snapshot = await getDoc(doc(studentDb, 'privateStudents', STUDENT_ID))
  assert.equal(snapshot.exists(), true)
})

test('17 other privateStudent deny', async () => {
  await expectDenied(() => getDoc(doc(studentDb, 'privateStudents', OTHER_STUDENT_ID)))
})

test('18 other academy privateStudent deny', async () => {
  await expectDenied(() =>
    getDoc(doc(studentDb, 'privateStudents', `other-academy-student-${suffix}`))
  )
})

test('19 unscoped privateStudents list deny', async () => {
  await expectDenied(() => getDocs(collection(studentDb, 'privateStudents')))
})

test('20 unauthenticated privateStudent get deny', async () => {
  await expectDenied(() => getDoc(doc(unauthDb, 'privateStudents', STUDENT_ID)))
})

test('21 student privateStudents production path has no collection listener', () => {
  const source = readFileSync(new URL('../StudentBookingPage.jsx', import.meta.url), 'utf8')
  assert.match(source, /getDoc\(doc\(db, 'privateStudents', scopedStudentId\)\)/)
  assert.doesNotMatch(
    source,
    /onSnapshot\(\s*(?:query\(\s*)?collection\(db, 'privateStudents'\)/
  )
})
