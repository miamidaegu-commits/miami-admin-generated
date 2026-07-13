const PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GCLOUD_PROJECT ||
  'demo-fixed-private-rules'
const ACADEMY_ID = 'fixed-private-rules-academy'
const ADMIN_UID = 'fixed-private-rules-admin'
const emulatorHost = process.env.FIRESTORE_EMULATOR_HOST

if (!emulatorHost) {
  throw new Error(
    'FIRESTORE_EMULATOR_HOST is required; refusing live Firestore access.'
  )
}
if (!PROJECT_ID.startsWith('demo-')) {
  throw new Error(
    `A demo- project ID is required; refusing project "${PROJECT_ID}".`
  )
}

const [hostname, portText] = emulatorHost.split(':')
const emulatorPort = Number(portText)
if (!hostname || !Number.isInteger(emulatorPort) || emulatorPort <= 0) {
  throw new Error('FIRESTORE_EMULATOR_HOST must include a valid host and port.')
}

const [{ initializeApp }, firestoreClient, adminModule] = await Promise.all([
  import('firebase/app'),
  import('firebase/firestore'),
  import('firebase-admin'),
])
const {
  connectFirestoreEmulator,
  deleteDoc,
  doc,
  getFirestore,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
} = firestoreClient
const admin = adminModule.default

if (!admin.apps.length) admin.initializeApp({ projectId: PROJECT_ID })
const adminDb = admin.firestore()
const clientApp = initializeApp(
  {
    apiKey: 'demo-api-key',
    authDomain: 'demo.firebaseapp.com',
    projectId: PROJECT_ID,
    appId: 'demo-fixed-private-rules-app',
  },
  `fixed-private-rules-${Date.now()}`
)
const clientDb = getFirestore(clientApp)
connectFirestoreEmulator(clientDb, hostname, emulatorPort, {
  mockUserToken: {
    sub: ADMIN_UID,
    user_id: ADMIN_UID,
    email: 'fixed-private-rules-admin@example.com',
    role: 'admin',
  },
})
const studentApp = initializeApp(
  {
    apiKey: 'demo-api-key',
    authDomain: 'demo.firebaseapp.com',
    projectId: PROJECT_ID,
    appId: 'demo-fixed-private-rules-student-app',
  },
  `fixed-private-rules-student-${Date.now()}`
)
const studentDb = getFirestore(studentApp)
const STUDENT_UID = 'fixed-private-rules-student'
const STUDENT_ID = 'rules-student'
connectFirestoreEmulator(studentDb, hostname, emulatorPort, {
  mockUserToken: {
    sub: STUDENT_UID,
    user_id: STUDENT_UID,
    email: 'fixed-private-rules-student@example.com',
    role: 'student',
  },
})

let passed = 0
let fixedDenyCount = 0
let nonFixedAllowCount = 0

async function expectDenied(name, operation, category = 'fixed') {
  try {
    await operation()
    throw new Error(`${name}: expected permission-denied, but write succeeded`)
  } catch (error) {
    if (error?.code !== 'permission-denied') throw error
    passed += 1
    if (category === 'fixed') fixedDenyCount += 1
  }
}

async function expectAllowed(name, operation) {
  try {
    await operation()
    passed += 1
    nonFixedAllowCount += 1
  } catch (error) {
    throw new Error(`${name}: expected allowed write: ${error?.message || error}`)
  }
}

function normalSlotData({ slotId, createdByUid, timestamp }) {
  return {
    academyId: ACADEMY_ID,
    teacher: 'rules-normal-teacher',
    date: '2099-05-10',
    time: '10:00',
    startAt: timestamp,
    durationMinutes: 50,
    status: 'open',
    reservedStudentId: '',
    reservationId: '',
    createdByUid,
    createdAt: timestamp,
    updatedAt: timestamp,
    reservedAt: null,
    cancelledAt: null,
    probeSlotId: slotId,
  }
}

function withoutProbeField(slot) {
  const { probeSlotId: _probeSlotId, ...data } = slot
  return data
}

function fixedBase() {
  return {
    academyId: ACADEMY_ID,
    source: 'fixed_admin',
    sourceType: 'fixed-private-slot-assignment',
    reservationType: 'fixed',
    fixedPrivateDeductionLedger: 'reservation_v1',
    fixedPrivateAssignmentBatchId: 'rules-fixed-batch',
    fixedLessonId: 'rules-fixed-lesson',
    fixedPrivatePackageId: 'rules-fixed-package',
    privateLessonAvailabilityTemplateId: 'rules-fixed-template',
  }
}

async function main() {
  const now = admin.firestore.Timestamp.now()
  await adminDb.collection('academyMemberships').doc(`${ACADEMY_ID}_${ADMIN_UID}`).set({
    academyId: ACADEMY_ID,
    uid: ADMIN_UID,
    role: 'owner',
    status: 'active',
    permissions: {},
    updatedAt: now,
  })
  await Promise.all([
    adminDb.collection('academyMemberships').doc(`${ACADEMY_ID}_${STUDENT_UID}`).set({
      academyId: ACADEMY_ID,
      uid: STUDENT_UID,
      role: 'student',
      studentId: STUDENT_ID,
      status: 'active',
      permissions: {},
      updatedAt: now,
    }),
    adminDb.collection('studentPrivateAccessSummary')
      .doc(`${ACADEMY_ID}__${STUDENT_ID}`)
      .set({
        academyId: ACADEMY_ID,
        studentId: STUDENT_ID,
        teacherKeys: ['rules-normal-teacher'],
        activePackageIds: ['rules-normal-package'],
        createdAt: now,
        updatedAt: now,
      }),
  ])

  await expectDenied('client fixed lesson create', () =>
    setDoc(doc(clientDb, 'lessons', 'client-fixed-lesson'), {
      ...fixedBase(),
      status: 'active',
    })
  )
  await expectDenied('client fixed slot create', () =>
    setDoc(doc(clientDb, 'privateLessonSlots', 'client-fixed-slot'), {
      ...fixedBase(),
      slotType: 'fixed',
      status: 'reserved',
    })
  )
  await expectDenied('client fixed reservation create', () =>
    setDoc(doc(clientDb, 'privateLessonReservations', 'client-fixed-reservation'), {
      ...fixedBase(),
      slotId: 'client-fixed-slot',
      studentId: 'rules-student',
      status: 'active',
    })
  )

  await Promise.all([
    adminDb.collection('lessons').doc('canonical-fixed-lesson').set({
      ...fixedBase(),
      status: 'active',
    }),
    adminDb.collection('lessons').doc('legacy-fixed-lesson').set({
      academyId: ACADEMY_ID,
      sourceType: 'weekly-slot-fixed-assignment',
      fixedLessonId: 'legacy-fixed-lesson',
      status: 'active',
    }),
    adminDb.collection('privateLessonSlots').doc('canonical-fixed-slot').set({
      ...fixedBase(),
      slotType: 'fixed',
      status: 'reserved',
    }),
    adminDb.collection('privateLessonReservations').doc('canonical-fixed-reservation').set({
      ...fixedBase(),
      slotId: 'canonical-fixed-slot',
      studentId: 'rules-student',
      status: 'active',
    }),
    adminDb.collection('privateLessonSlots').doc('weekly-fixed-slot').set({
      academyId: ACADEMY_ID,
      sourceType: 'weekly-slot-fixed-assignment-v0',
      status: 'reserved',
    }),
    adminDb.collection('privateLessonReservations').doc('fixed-admin-reservation').set({
      academyId: ACADEMY_ID,
      source: 'fixed_admin_legacy',
      slotId: 'fixed-admin-slot',
      studentId: STUDENT_ID,
      status: 'active',
    }),
    adminDb.collection('lessons').doc('fixed-id-only-lesson').set({
      academyId: ACADEMY_ID,
      fixedLessonId: 'fixed-id-only-lesson',
      status: 'active',
    }),
    adminDb.collection('creditTransactions').doc('seeded-fixed-credit').set({
      academyId: ACADEMY_ID,
      fixedPrivateDeductionLedger: 'reservation_v1',
      sourceType: 'fixedPrivateReservation',
      actionType: 'fixed_private_completed_deduct',
    }),
  ])

  await expectDenied('canonical marker update', () =>
    updateDoc(doc(clientDb, 'lessons', 'canonical-fixed-lesson'), {
      fixedPrivateDeductionLedger: 'other',
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('fixed outcome update', () =>
    updateDoc(doc(clientDb, 'privateLessonReservations', 'canonical-fixed-reservation'), {
      status: 'completed',
      deductionApplied: true,
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('fixed slot direct update', () =>
    updateDoc(doc(clientDb, 'privateLessonSlots', 'canonical-fixed-slot'), {
      status: 'released',
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('fixed lesson delete', () =>
    deleteDoc(doc(clientDb, 'lessons', 'canonical-fixed-lesson'))
  )
  await expectDenied('legacy fixed lesson update', () =>
    updateDoc(doc(clientDb, 'lessons', 'legacy-fixed-lesson'), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('legacy fixed lesson delete', () =>
    deleteDoc(doc(clientDb, 'lessons', 'legacy-fixed-lesson'))
  )
  await expectDenied('canonical fixed credit create', () =>
    setDoc(doc(clientDb, 'creditTransactions', 'client-fixed-credit'), {
      academyId: ACADEMY_ID,
      fixedPrivateDeductionLedger: 'reservation_v1',
      sourceType: 'fixedPrivateReservation',
      actionType: 'fixed_private_completed_deduct',
    })
  )
  await expectDenied('marker-only fixed lesson create', () =>
    setDoc(doc(clientDb, 'lessons', 'marker-only-fixed-lesson'), {
      academyId: ACADEMY_ID,
      fixedPrivateDeductionLedger: 'reservation_v1',
      status: 'active',
    })
  )
  await expectDenied('weekly fixed slot update', () =>
    updateDoc(doc(clientDb, 'privateLessonSlots', 'weekly-fixed-slot'), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('weekly fixed slot delete', () =>
    deleteDoc(doc(clientDb, 'privateLessonSlots', 'weekly-fixed-slot'))
  )
  await expectDenied('fixed_admin reservation update', () =>
    updateDoc(doc(clientDb, 'privateLessonReservations', 'fixed-admin-reservation'), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('fixed_admin reservation delete', () =>
    deleteDoc(doc(clientDb, 'privateLessonReservations', 'fixed-admin-reservation'))
  )
  await expectDenied('fixedLessonId-only lesson update', () =>
    updateDoc(doc(clientDb, 'lessons', 'fixed-id-only-lesson'), {
      status: 'cancelled',
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('fixedLessonId-only lesson delete', () =>
    deleteDoc(doc(clientDb, 'lessons', 'fixed-id-only-lesson'))
  )
  await expectDenied('fixed deduction update', () =>
    updateDoc(doc(clientDb, 'privateLessonReservations', 'canonical-fixed-reservation'), {
      deductionApplied: true,
      deductionPackageId: 'other-package',
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('fixed link update', () =>
    updateDoc(doc(clientDb, 'privateLessonReservations', 'canonical-fixed-reservation'), {
      lessonId: 'other-lesson',
      slotId: 'other-slot',
      updatedAt: serverTimestamp(),
    })
  )
  await expectDenied('fixed slot delete', () =>
    deleteDoc(doc(clientDb, 'privateLessonSlots', 'canonical-fixed-slot'))
  )
  await expectDenied('fixed reservation delete', () =>
    deleteDoc(doc(clientDb, 'privateLessonReservations', 'canonical-fixed-reservation'))
  )
  await expectDenied('fixed credit update', () =>
    updateDoc(doc(clientDb, 'creditTransactions', 'seeded-fixed-credit'), {
      memo: 'forbidden',
    })
  )
  await expectDenied('fixed credit delete', () =>
    deleteDoc(doc(clientDb, 'creditTransactions', 'seeded-fixed-credit'))
  )

  await expectAllowed('non-fixed lesson create', () =>
    setDoc(doc(clientDb, 'lessons', 'client-direct-lesson'), {
      academyId: ACADEMY_ID,
      status: 'active',
      sourceType: 'direct',
    })
  )
  await expectAllowed('non-fixed lesson status update', () =>
    updateDoc(doc(clientDb, 'lessons', 'client-direct-lesson'), {
      status: 'completed',
      updatedAt: serverTimestamp(),
    })
  )

  const normalSlotId = 'client-normal-slot'
  const normalReservationId = `${ACADEMY_ID}__${normalSlotId}__${STUDENT_ID}`
  await expectAllowed('non-fixed slot create', () => {
    const timestamp = serverTimestamp()
    return setDoc(
      doc(clientDb, 'privateLessonSlots', normalSlotId),
      withoutProbeField(normalSlotData({
        slotId: normalSlotId,
        createdByUid: ADMIN_UID,
        timestamp,
      }))
    )
  })
  await expectAllowed('non-fixed slot reserve and reservation create', () =>
    runTransaction(studentDb, async (transaction) => {
      const slotRef = doc(studentDb, 'privateLessonSlots', normalSlotId)
      const reservationRef = doc(
        studentDb,
        'privateLessonReservations',
        normalReservationId
      )
      transaction.set(reservationRef, {
        academyId: ACADEMY_ID,
        slotId: normalSlotId,
        studentId: STUDENT_ID,
        teacher: 'rules-normal-teacher',
        date: '2099-05-10',
        time: '10:00',
        status: 'active',
        source: 'student',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        cancelledAt: null,
      })
      transaction.update(slotRef, {
        status: 'reserved',
        reservedStudentId: STUDENT_ID,
        reservationId: normalReservationId,
        reservedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
  )
  await expectAllowed('student non-fixed reservation cancel', () =>
    runTransaction(studentDb, async (transaction) => {
      const slotRef = doc(studentDb, 'privateLessonSlots', normalSlotId)
      const reservationRef = doc(
        studentDb,
        'privateLessonReservations',
        normalReservationId
      )
      transaction.update(reservationRef, {
        status: 'cancelled',
        cancelledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
      transaction.update(slotRef, {
        status: 'open',
        reservedStudentId: '',
        reservationId: '',
        reservedAt: null,
        updatedAt: serverTimestamp(),
      })
    })
  )
  await expectAllowed('non-fixed slot re-reserve', () =>
    runTransaction(studentDb, async (transaction) => {
      const slotRef = doc(studentDb, 'privateLessonSlots', normalSlotId)
      const reservationRef = doc(
        studentDb,
        'privateLessonReservations',
        normalReservationId
      )
      transaction.update(reservationRef, {
        status: 'active',
        cancelledAt: null,
        updatedAt: serverTimestamp(),
      })
      transaction.update(slotRef, {
        status: 'reserved',
        reservedStudentId: STUDENT_ID,
        reservationId: normalReservationId,
        reservedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      })
    })
  )

  const adminReservationId =
    `${ACADEMY_ID}__normal-admin-cancel-slot__${STUDENT_ID}`
  await adminDb.collection('privateLessonReservations').doc(adminReservationId).set({
    academyId: ACADEMY_ID,
    slotId: 'normal-admin-cancel-slot',
    studentId: STUDENT_ID,
    teacher: 'rules-normal-teacher',
    date: '2099-05-11',
    time: '10:00',
    status: 'active',
    source: 'student',
    createdAt: now,
    updatedAt: now,
    cancelledAt: null,
  })
  await expectAllowed('admin non-fixed reservation cancel', () =>
    updateDoc(doc(clientDb, 'privateLessonReservations', adminReservationId), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  )

  const closeSlotId = 'normal-admin-close-slot'
  await adminDb.collection('privateLessonSlots').doc(closeSlotId).set(
    withoutProbeField(normalSlotData({
      slotId: closeSlotId,
      createdByUid: ADMIN_UID,
      timestamp: now,
    }))
  )
  await expectAllowed('admin non-fixed slot close', () =>
    updateDoc(doc(clientDb, 'privateLessonSlots', closeSlotId), {
      status: 'cancelled',
      cancelledAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
  )

  console.log(JSON.stringify({
    passed,
    fixedDenyCount,
    nonFixedAllowCount,
    falseDenials: 0,
  }))
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
