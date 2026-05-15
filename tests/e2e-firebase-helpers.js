const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]
const E2E_FIREBASE_PROJECT_ID = 'miami-e2e'

function getFirebaseConfigFromEnv(env) {
  const missingKeys = FIREBASE_ENV_KEYS.filter((key) => !String(env[key] || '').trim())

  if (missingKeys.length > 0) {
    throw new Error(
      `Missing Firebase environment variables for E2E helpers: ${missingKeys.join(', ')}`
    )
  }

  if (env.VITE_FIREBASE_PROJECT_ID !== E2E_FIREBASE_PROJECT_ID) {
    throw new Error(
      `E2E helpers require VITE_FIREBASE_PROJECT_ID=${E2E_FIREBASE_PROJECT_ID}, received ${String(env.VITE_FIREBASE_PROJECT_ID || '')}.`
    )
  }

  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
  }
}

const FIREBASE_VERSION = '10.12.2'
const E2E_ACADEMY_ID = 'academy_e2e_default'

export async function createTempGroupStudentAddPackage(page, params) {
  return runFirebaseTask(page, 'createTempGroupStudentAddPackage', params);
}

export async function createTempStudent(page, params) {
  return runFirebaseTask(page, 'createTempStudent', params);
}

export async function cleanupTempStudentData(page, params) {
  if (!params?.studentId && !params?.studentName) return;
  await runFirebaseTask(page, 'cleanupTempStudentData', params);
}

export async function cleanupTempGroupStudentAddSetup(page, params) {
  if (!params?.packageId && !params?.groupClassId && !params?.tempStudentId) return;
  await runFirebaseTask(page, 'cleanupTempGroupStudentAddSetup', params);
}

export async function createTempGroupAttendanceSetup(page, params) {
  return runFirebaseTask(page, 'createTempGroupAttendanceSetup', params);
}

export async function cleanupTempGroupAttendanceSetup(page, params) {
  if (!params?.packageId && !params?.groupStudentId) return;
  await runFirebaseTask(page, 'cleanupTempGroupAttendanceSetup', params);
}

export async function createTempCalendarGroupLessonSetup(page, params) {
  return runFirebaseTask(page, 'createTempCalendarGroupLessonSetup', params);
}

export async function cleanupTempCalendarGroupLessonSetup(page, params) {
  if (!params?.groupClassId && !params?.groupLessonId) return;
  await runFirebaseTask(page, 'cleanupTempCalendarGroupLessonSetup', params);
}

export async function getGroupPackageStartDate(page, params) {
  return runFirebaseTask(page, 'getGroupPackageStartDate', params);
}

export async function createTempGroupBookingSetup(page, params) {
  return runFirebaseTask(page, 'createTempGroupBookingSetup', params);
}

export async function cleanupTempGroupBookingSetup(page, params) {
  if (!params?.token && !params?.groupClassId && !params?.groupLessonId) return;
  await runFirebaseTask(page, 'cleanupTempGroupBookingSetup', params);
}

export async function callGroupBookingFunction(page, functionName, payload) {
  const firebaseConfig = getFirebaseConfigFromEnv(process.env);

  return page.evaluate(
    async ({ firebaseConfig, firebaseVersion, functionName, payload }) => {
      const [
        { getApp, getApps, initializeApp },
        { getAuth, onAuthStateChanged },
        { getFunctions, httpsCallable },
      ] =
        await Promise.all([
          import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-app.js`),
          import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-auth.js`),
          import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-functions.js`),
        ]);
      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
      const auth = getAuth(app);
      if (!auth.currentUser) {
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Auth user not ready for callable.')), 30000);
          const unsub = onAuthStateChanged(auth, (user) => {
            if (!user) return;
            clearTimeout(timeout);
            unsub();
            resolve();
          });
        });
      }
      const fn = httpsCallable(getFunctions(app, 'us-central1'), functionName);
      try {
        const result = await fn(payload || {});
        return { ok: true, data: result.data || null };
      } catch (error) {
        return {
          ok: false,
          code: error?.code || '',
          message: error?.message || String(error),
        };
      }
    },
    { firebaseConfig, firebaseVersion: FIREBASE_VERSION, functionName, payload }
  );
}

async function runFirebaseTask(page, taskName, params) {
  const firebaseConfig = getFirebaseConfigFromEnv(process.env)

  return page.evaluate(
    async ({ firebaseConfig, firebaseVersion, taskName, params, academyId }) => {
      const [{ getApp, getApps, initializeApp }, { getAuth, onAuthStateChanged }, firestore] =
        await Promise.all([
          import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-app.js`),
          import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-auth.js`),
          import(`https://www.gstatic.com/firebasejs/${firebaseVersion}/firebase-firestore.js`),
        ]);

      const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
      const auth = getAuth(app);

      await waitForCurrentUser(auth, onAuthStateChanged, taskName);

      const db = firestore.getFirestore(app);

      switch (taskName) {
        case 'createTempStudent':
          return createTempStudentTask({ db, firestore, params });
        case 'cleanupTempStudentData':
          return cleanupTempStudentDataTask({ db, firestore, params });
        case 'createTempGroupStudentAddPackage':
          return createTempGroupStudentAddPackageTask({ db, firestore, params });
        case 'cleanupTempGroupStudentAddSetup':
          return cleanupTempGroupStudentAddSetupTask({ db, firestore, params });
        case 'createTempGroupAttendanceSetup':
          return createTempGroupAttendanceSetupTask({ db, firestore, params });
        case 'cleanupTempGroupAttendanceSetup':
          return cleanupTempGroupAttendanceSetupTask({ db, firestore, params });
        case 'createTempCalendarGroupLessonSetup':
          return createTempCalendarGroupLessonSetupTask({ db, firestore, params });
        case 'cleanupTempCalendarGroupLessonSetup':
          return cleanupTempCalendarGroupLessonSetupTask({ db, firestore, params });
        case 'getGroupPackageStartDate':
          return getGroupPackageStartDateTask({ db, firestore, params });
        case 'createTempGroupBookingSetup':
          return createTempGroupBookingSetupTask({ db, firestore, params });
        case 'cleanupTempGroupBookingSetup':
          return cleanupTempGroupBookingSetupTask({ db, firestore, params });
        default:
          throw new Error(`Unknown Firebase helper task: ${taskName}`);
      }

      async function waitForCurrentUser(currentAuth, subscribeToAuth, currentTaskName) {
        if (currentAuth.currentUser) return;

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error(`Auth user not ready in browser context for ${currentTaskName}.`));
          }, 30000);

          const unsub = subscribeToAuth(currentAuth, (user) => {
            if (!user) return;
            clearTimeout(timeout);
            unsub();
            resolve();
          });
        });
      }

      async function getGroupClassByName(dbRef, firestoreModule, groupName) {
        const { collection, getDocs, query, where } = firestoreModule;
        const groupClassSnap = await getDocs(
          query(
            collection(dbRef, 'groupClasses'),
            where('name', '==', groupName),
            where('academyId', '==', academyId)
          )
        );

        if (groupClassSnap.empty) {
          throw new Error(`Group class not found: ${groupName}`);
        }

        const groupClassDoc = groupClassSnap.docs[0];
        return {
          id: groupClassDoc.id,
          data: groupClassDoc.data() || {},
        };
      }

      async function getGroupLessonsByClassId(dbRef, firestoreModule, groupClassId) {
        const { collection, getDocs, query, where } = firestoreModule;
        const [groupLessonsA, groupLessonsB] = await Promise.all([
          getDocs(
            query(
              collection(dbRef, 'groupLessons'),
              where('groupClassId', '==', groupClassId),
              where('academyId', '==', academyId)
            )
          ),
          getDocs(
            query(
              collection(dbRef, 'groupLessons'),
              where('groupClassID', '==', groupClassId),
              where('academyId', '==', academyId)
            )
          ),
        ]);

        const lessons = [];
        const seenLessonIds = new Set();

        for (const snap of [groupLessonsA, groupLessonsB]) {
          for (const lessonDoc of snap.docs) {
            if (seenLessonIds.has(lessonDoc.id)) continue;
            seenLessonIds.add(lessonDoc.id);
            lessons.push({
              id: lessonDoc.id,
              data: lessonDoc.data() || {},
            });
          }
        }

        return lessons;
      }

      async function createTempGroupStudentAddPackageTask({ db, firestore: firestoreModule, params }) {
        const { Timestamp, collection, doc, setDoc } = firestoreModule;
        const { groupName, tempStudentId, tempStudentName, tempPackageTitle } = params;
        const groupClass = await getGroupClassByName(db, firestoreModule, groupName);
        const groupLessons = await getGroupLessonsByClassId(db, firestoreModule, groupClass.id);

        const todayYmd = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());

        let earliestFutureLessonYmd = '';
        for (const lesson of groupLessons) {
          const lessonDate = String(lesson.data.date || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate)) continue;
          if (lessonDate < todayYmd) continue;
          if (!earliestFutureLessonYmd || lessonDate < earliestFutureLessonYmd) {
            earliestFutureLessonYmd = lessonDate;
          }
        }

        const fallbackStartDate = (() => {
          const [year, month, day] = todayYmd.split('-').map(Number);
          return formatYmdFromDate(new Date(year, month - 1, day + 7));
        })();
        const startDateYmd = earliestFutureLessonYmd || fallbackStartDate;

        const packageRef = doc(collection(db, 'studentPackages'));
        const nowTs = Timestamp.now();
        const teacher = String(groupClass.data.teacher || '').trim().toLowerCase();

        await setDoc(packageRef, {
          studentId: tempStudentId,
          academyId,
          studentName: tempStudentName,
          teacher,
          packageType: 'group',
          groupClassId: groupClass.id,
          groupClassName: String(groupClass.data.name || groupName).trim(),
          title: tempPackageTitle,
          totalCount: 6,
          usedCount: 0,
          remainingCount: 6,
          status: 'active',
          registrationStartDate: startDateYmd,
          registrationWeeks: 2,
          weeklyFrequency: 1,
          coverageEndDate: '',
          expiresAt: '',
          amountPaid: 0,
          memo: 'E2E temporary package for group student add save test',
          createdAt: nowTs,
          updatedAt: nowTs,
        });

        return {
          packageId: packageRef.id,
          groupClassId: groupClass.id,
          startDateYmd,
        };
      }

      async function createTempStudentTask({ db, firestore: firestoreModule, params }) {
        const { Timestamp, collection, doc, setDoc } = firestoreModule;
        const {
          studentId: requestedStudentId,
          studentName,
          teacherName = '',
          firstRegisteredAt = formatYmdFromDate(new Date()),
          note = 'E2E temporary student',
        } = params;

        const studentRef = requestedStudentId
          ? doc(db, 'privateStudents', requestedStudentId)
          : doc(collection(db, 'privateStudents'));
        const nowTs = Timestamp.now();

        await setDoc(studentRef, {
          name: String(studentName || '').trim(),
          academyId,
          teacher: String(teacherName || '').trim(),
          phone: '',
          carNumber: '',
          learningPurpose: '',
          firstRegisteredAt,
          note,
          paidLessons: 0,
          attendanceCount: 0,
          createdAt: nowTs,
          updatedAt: nowTs,
        });

        return {
          studentId: studentRef.id,
          studentName: String(studentName || '').trim(),
        };
      }

      async function cleanupTempStudentDataTask({ db, firestore: firestoreModule, params }) {
        const { collection, deleteDoc, doc, getDocs, query, where } = firestoreModule;
        const { studentId, studentName } = params;
        const studentIds = new Set();

        if (studentId) {
          studentIds.add(String(studentId));
        }

        if (studentName) {
          const studentSnap = await getDocs(
            query(
              collection(db, 'privateStudents'),
              where('name', '==', studentName),
              where('academyId', '==', academyId)
            )
          );
          studentSnap.docs.forEach((studentDoc) => studentIds.add(studentDoc.id));
        }

        for (const currentStudentId of studentIds) {
          const [groupStudentSnap, studentPackageSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, 'groupStudents'),
                where('studentId', '==', currentStudentId),
                where('academyId', '==', academyId)
              )
            ),
            getDocs(
              query(
                collection(db, 'studentPackages'),
                where('studentId', '==', currentStudentId),
                where('academyId', '==', academyId)
              )
            ),
          ]);

          await Promise.all(
            groupStudentSnap.docs.map((groupStudentDoc) =>
              deleteDoc(doc(db, 'groupStudents', groupStudentDoc.id)).catch(() => {})
            )
          );

          await Promise.all(
            studentPackageSnap.docs.map((studentPackageDoc) =>
              deleteDoc(doc(db, 'studentPackages', studentPackageDoc.id)).catch(() => {})
            )
          );

          await deleteDoc(doc(db, 'privateStudents', currentStudentId)).catch(() => {});
        }
      }

      async function cleanupTempGroupStudentAddSetupTask({ db, firestore: firestoreModule, params }) {
        const { collection, deleteDoc, doc, getDocs, query, where } = firestoreModule;
        const { packageId, groupClassId, tempStudentId } = params;
        const groupStudentDocIds = new Set();

        if (packageId) {
          const byPackageSnap = await getDocs(
            query(
              collection(db, 'groupStudents'),
              where('packageId', '==', packageId),
              where('academyId', '==', academyId)
            )
          );
          byPackageSnap.docs.forEach((docItem) => groupStudentDocIds.add(docItem.id));
        }

        if (tempStudentId) {
          const byStudentSnap = await getDocs(
            query(
              collection(db, 'groupStudents'),
              where('studentId', '==', tempStudentId),
              where('academyId', '==', academyId)
            )
          );
          byStudentSnap.docs.forEach((docItem) => {
            const row = docItem.data() || {};
            if (groupClassId && String(row.groupClassId || '') !== String(groupClassId)) return;
            groupStudentDocIds.add(docItem.id);
          });
        }

        await Promise.all(
          Array.from(groupStudentDocIds).map((groupStudentId) =>
            deleteDoc(doc(db, 'groupStudents', groupStudentId)).catch(() => {})
          )
        );

        if (packageId) {
          await deleteDoc(doc(db, 'studentPackages', packageId)).catch(() => {});
        }
      }

      async function createTempGroupAttendanceSetupTask({ db, firestore: firestoreModule, params }) {
        const { Timestamp, collection, doc, getDocs, query, setDoc, where } = firestoreModule;
        const { groupName, studentName, lessonDate, tempPackageTitle } = params;
        const groupClass = await getGroupClassByName(db, firestoreModule, groupName);
        const studentSnap = await withFirebaseStep('query attendance student fixture', () =>
          getDocs(
            query(
              collection(db, 'privateStudents'),
              where('name', '==', studentName),
              where('academyId', '==', academyId)
            )
          )
        );

        if (studentSnap.empty) {
          throw new Error(`Student not found: ${studentName}`);
        }

        const studentDoc = studentSnap.docs[0];
        const studentData = studentDoc.data() || {};
        const packageRef = doc(collection(db, 'studentPackages'));
        const groupStudentRef = doc(collection(db, 'groupStudents'));
        const nowTs = Timestamp.now();
        const startDateTs = Timestamp.fromDate(new Date(`${lessonDate}T00:00:00`));
        const teacher = String(groupClass.data.teacher || '').trim().toLowerCase();
        const studentDisplayName = String(studentData.name || studentName).trim();

        await withFirebaseStep('create attendance package fixture', () => setDoc(packageRef, {
          studentId: studentDoc.id,
          academyId,
          studentName: studentDisplayName,
          teacher,
          packageType: 'group',
          groupClassId: groupClass.id,
          groupClassName: String(groupClass.data.name || groupName).trim(),
          title: tempPackageTitle,
          totalCount: 4,
          usedCount: 0,
          remainingCount: 4,
          status: 'active',
          registrationStartDate: lessonDate,
          registrationWeeks: 1,
          coverageEndDate: '',
          expiresAt: '',
          amountPaid: 0,
          memo: 'E2E temporary package for group attendance test',
          createdAt: nowTs,
          updatedAt: nowTs,
        }));

        await withFirebaseStep('create attendance group student fixture', () => setDoc(groupStudentRef, {
          groupClassId: groupClass.id,
          academyId,
          classID: groupClass.id,
          studentId: studentDoc.id,
          studentName: studentDisplayName,
          name: studentDisplayName,
          teacher,
          packageId: packageRef.id,
          packageType: 'group',
          paidLessons: 4,
          attendanceCount: 0,
          startDate: startDateTs,
          status: 'active',
          studentStatus: 'active',
          excludedDates: [],
          breakStartDate: '',
          breakEndDate: '',
          createdAt: nowTs,
          updatedAt: nowTs,
        }));

        return {
          packageId: packageRef.id,
          groupStudentId: groupStudentRef.id,
        };
      }

      async function cleanupTempGroupAttendanceSetupTask({ db, firestore: firestoreModule, params }) {
        const { deleteDoc, doc } = firestoreModule;
        const { packageId, groupStudentId } = params;

        if (groupStudentId) {
          await deleteDoc(doc(db, 'groupStudents', groupStudentId)).catch(() => {});
        }

        if (packageId) {
          await deleteDoc(doc(db, 'studentPackages', packageId)).catch(() => {});
        }
      }

      async function createTempCalendarGroupLessonSetupTask({
        db,
        firestore: firestoreModule,
        params,
      }) {
        const { Timestamp, collection, doc, setDoc } = firestoreModule;
        const {
          groupName,
          teacherName = 'e2e-calendar-teacher',
          lessonDate,
          lessonTime,
          lessonSubject,
        } = params;
        const nowTs = Timestamp.now();
        const groupClassRef = doc(collection(db, 'groupClasses'));
        const groupLessonRef = doc(collection(db, 'groupLessons'));
        const normalizedTeacher = String(teacherName || '').trim().toLowerCase();
        const trimmedGroupName = String(groupName || '').trim();

        await setDoc(groupClassRef, {
          name: trimmedGroupName,
          academyId,
          teacher: normalizedTeacher,
          maxStudents: 8,
          time: String(lessonTime || '').trim(),
          subject: String(lessonSubject || '').trim(),
          weekdays: [],
          createdAt: nowTs,
          updatedAt: nowTs,
        });

        await setDoc(groupLessonRef, {
          groupClassId: groupClassRef.id,
          academyId,
          groupClassID: groupClassRef.id,
          groupClassName: trimmedGroupName,
          teacher: normalizedTeacher,
          date: String(lessonDate || '').trim(),
          time: String(lessonTime || '').trim(),
          subject: String(lessonSubject || '').trim(),
          completed: false,
          countedStudentIDs: [],
          attendanceAppliedAt: null,
          bookingMode: 'fixed',
          capacity: 8,
          bookedCount: 0,
          isBookable: false,
          generationKind: 'manual',
          createdAt: nowTs,
          updatedAt: nowTs,
        });

        return {
          groupClassId: groupClassRef.id,
          groupLessonId: groupLessonRef.id,
          groupName: trimmedGroupName,
          lessonDate: String(lessonDate || '').trim(),
          lessonTime: String(lessonTime || '').trim(),
          lessonSubject: String(lessonSubject || '').trim(),
        };
      }

      async function cleanupTempCalendarGroupLessonSetupTask({
        db,
        firestore: firestoreModule,
        params,
      }) {
        const { deleteDoc, doc } = firestoreModule;
        const { groupClassId, groupLessonId } = params;

        if (groupLessonId) {
          await deleteDoc(doc(db, 'groupLessons', groupLessonId)).catch(() => {});
        }

        if (groupClassId) {
          await deleteDoc(doc(db, 'groupClasses', groupClassId)).catch(() => {});
        }
      }

      async function getGroupPackageStartDateTask({ db, firestore: firestoreModule, params }) {
        const { groupName } = params;
        const groupClass = await getGroupClassByName(db, firestoreModule, groupName);
        const groupLessons = await getGroupLessonsByClassId(db, firestoreModule, groupClass.id);
        const todayYmd = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Asia/Seoul',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        }).format(new Date());

        let earliestFutureLessonYmd = '';
        for (const lesson of groupLessons) {
          const lessonDate = String(lesson.data.date || '').trim();
          if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate)) continue;
          if (lessonDate < todayYmd) continue;
          if (!earliestFutureLessonYmd || lessonDate < earliestFutureLessonYmd) {
            earliestFutureLessonYmd = lessonDate;
          }
        }

        if (!earliestFutureLessonYmd) {
          throw new Error(`No future lessons found for group class: ${groupName}`);
        }

        return earliestFutureLessonYmd;
      }

      async function createTempGroupBookingSetupTask({ db, firestore: firestoreModule, params }) {
        const { Timestamp, collection, doc, setDoc } = firestoreModule;
        const {
          token,
          capacity = 5,
          fixedCount = 0,
          bookable = true,
          lessonDate,
          otherAcademy = false,
        } = params;
        const academyIdForDocs = otherAcademy ? `academy_other_${token}` : academyId;
        const nowTs = Timestamp.now();
        const normalizedToken = String(token || Date.now()).trim();
        const groupClassRef = doc(collection(db, 'groupClasses'));
        const groupLessonRef = doc(collection(db, 'groupLessons'));
        const groupName = `E2E 예약반 ${normalizedToken}`;
        const lessonDateValue = String(lessonDate || getFutureYmd(14)).trim();
        const teacher = `booking-teacher-${normalizedToken}`.toLowerCase();

        await setDoc(groupClassRef, {
          academyId: academyIdForDocs,
          name: groupName,
          teacher,
          maxStudents: Number(capacity),
          time: '18:30',
          subject: 'Booking',
          weekdays: [],
          createdAt: nowTs,
          updatedAt: nowTs,
        });
        await setDoc(groupLessonRef, {
          academyId: academyIdForDocs,
          groupClassId: groupClassRef.id,
          groupClassID: groupClassRef.id,
          groupClassName: groupName,
          teacher,
          date: lessonDateValue,
          time: '18:30',
          subject: 'Booking',
          completed: false,
          countedStudentIDs: [],
          attendanceAppliedAt: null,
          bookingMode: bookable ? 'hybrid' : 'fixed',
          capacity: Number(capacity),
          bookedCount: 0,
          isBookable: bookable === true,
          generationKind: 'manual',
          createdAt: nowTs,
          updatedAt: nowTs,
        });

        const fixedStudents = [];
        for (let i = 0; i < Number(fixedCount || 0); i += 1) {
          const studentRef = doc(collection(db, 'privateStudents'));
          const packageRef = doc(collection(db, 'studentPackages'));
          const groupStudentRef = doc(collection(db, 'groupStudents'));
          const studentName = `E2E 고정 ${normalizedToken} ${i + 1}`;
          await setDoc(studentRef, {
            academyId: academyIdForDocs,
            name: studentName,
            teacher,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
          await setDoc(packageRef, {
            academyId: academyIdForDocs,
            studentId: studentRef.id,
            studentName,
            teacher,
            packageType: 'group',
            groupClassId: groupClassRef.id,
            groupClassName: groupName,
            title: `E2E 고정권 ${normalizedToken} ${i + 1}`,
            totalCount: 4,
            usedCount: 0,
            remainingCount: 4,
            status: 'active',
            registrationStartDate: lessonDateValue,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
          await setDoc(groupStudentRef, {
            academyId: academyIdForDocs,
            groupClassId: groupClassRef.id,
            classID: groupClassRef.id,
            studentId: studentRef.id,
            studentName,
            name: studentName,
            teacher,
            packageId: packageRef.id,
            packageType: 'group',
            paidLessons: 4,
            attendanceCount: 0,
            startDate: Timestamp.fromDate(new Date(`${lessonDateValue}T00:00:00`)),
            status: 'active',
            studentStatus: 'active',
            excludedDates: [],
            createdAt: nowTs,
            updatedAt: nowTs,
          });
          fixedStudents.push({
            studentId: studentRef.id,
            studentName,
            packageId: packageRef.id,
            groupStudentId: groupStudentRef.id,
          });
        }

        const bookingStudents = [];
        for (let i = 0; i < 5; i += 1) {
          const studentRef = doc(collection(db, 'privateStudents'));
          const packageRef = doc(collection(db, 'studentPackages'));
          const studentName = `E2E 예약학생 ${normalizedToken} ${i + 1}`;
          await setDoc(studentRef, {
            academyId: academyIdForDocs,
            name: studentName,
            teacher,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
          await setDoc(packageRef, {
            academyId: academyIdForDocs,
            studentId: studentRef.id,
            studentName,
            teacher,
            packageType: 'group',
            groupClassId: groupClassRef.id,
            groupClassName: groupName,
            title: `E2E 예약권 ${normalizedToken} ${i + 1}`,
            totalCount: 4,
            usedCount: 0,
            remainingCount: 4,
            status: 'active',
            registrationStartDate: lessonDateValue,
            createdAt: nowTs,
            updatedAt: nowTs,
          });
          bookingStudents.push({
            studentId: studentRef.id,
            studentName,
            packageId: packageRef.id,
          });
        }

        return {
          token: normalizedToken,
          academyId: academyIdForDocs,
          groupClassId: groupClassRef.id,
          groupLessonId: groupLessonRef.id,
          groupName,
          lessonDate: lessonDateValue,
          fixedStudents,
          bookingStudents,
        };
      }

      async function cleanupTempGroupBookingSetupTask({ db, firestore: firestoreModule, params }) {
        const { collection, deleteDoc, doc, getDocs, query, where } = firestoreModule;
        const { token, groupClassId, groupLessonId, bookingStudents = [], fixedStudents = [] } = params;
        const docIds = {
          privateStudents: new Set(),
          studentPackages: new Set(),
          groupStudents: new Set(),
          groupLessonReservations: new Set(),
          groupLessonCancelUsage: new Set(),
        };

        if (groupLessonId) {
          try {
            const reservationSnap = await getDocs(
              query(
                collection(db, 'groupLessonReservations'),
                where('academyId', '==', academyId),
                where('lessonId', '==', groupLessonId)
              )
            );
            reservationSnap.docs.forEach((item) => docIds.groupLessonReservations.add(item.id));
          } catch (_) {
            // Older deployed rules may not expose the new reservation collection yet.
          }
        }
        if (groupClassId) {
          const [packageSnap, groupStudentSnap] = await Promise.all([
            getDocs(query(collection(db, 'studentPackages'), where('academyId', '==', academyId), where('groupClassId', '==', groupClassId))),
            getDocs(query(collection(db, 'groupStudents'), where('academyId', '==', academyId), where('groupClassId', '==', groupClassId))),
          ]);
          packageSnap.docs.forEach((item) => docIds.studentPackages.add(item.id));
          groupStudentSnap.docs.forEach((item) => docIds.groupStudents.add(item.id));
        }
        if (token) {
          const studentSnap = await getDocs(query(collection(db, 'privateStudents'), where('academyId', '==', academyId), where('teacher', '==', `booking-teacher-${token}`.toLowerCase())));
          studentSnap.docs.forEach((item) => docIds.privateStudents.add(item.id));
        }
        for (const student of [...bookingStudents, ...fixedStudents]) {
          const studentId = String(student?.studentId || '').trim();
          if (!studentId) continue;
          try {
            const usageSnap = await getDocs(query(collection(db, 'groupLessonCancelUsage'), where('academyId', '==', academyId), where('studentId', '==', studentId)));
            usageSnap.docs.forEach((item) => docIds.groupLessonCancelUsage.add(item.id));
          } catch (_) {
            // Older deployed rules may not expose the new usage collection yet.
          }
        }

        await Promise.all([
          ...Array.from(docIds.groupLessonReservations).map((id) => deleteDoc(doc(db, 'groupLessonReservations', id)).catch(() => {})),
          ...Array.from(docIds.groupLessonCancelUsage).map((id) => deleteDoc(doc(db, 'groupLessonCancelUsage', id)).catch(() => {})),
          ...Array.from(docIds.groupStudents).map((id) => deleteDoc(doc(db, 'groupStudents', id)).catch(() => {})),
          ...Array.from(docIds.studentPackages).map((id) => deleteDoc(doc(db, 'studentPackages', id)).catch(() => {})),
          ...Array.from(docIds.privateStudents).map((id) => deleteDoc(doc(db, 'privateStudents', id)).catch(() => {})),
          groupLessonId ? deleteDoc(doc(db, 'groupLessons', groupLessonId)).catch(() => {}) : Promise.resolve(),
          groupClassId ? deleteDoc(doc(db, 'groupClasses', groupClassId)).catch(() => {}) : Promise.resolve(),
        ]);
      }

      function getFutureYmd(offsetDays) {
        const now = new Date();
        return formatYmdFromDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays));
      }

      function formatYmdFromDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }

      async function withFirebaseStep(stepName, action) {
        try {
          return await action();
        } catch (error) {
          throw new Error(`${stepName}: ${error?.code || error?.name || 'Error'} ${error?.message || error}`);
        }
      }
    },
    {
      firebaseConfig,
      firebaseVersion: FIREBASE_VERSION,
      taskName,
      params,
      academyId: E2E_ACADEMY_ID,
    }
  );
}
