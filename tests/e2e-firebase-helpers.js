const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]
const E2E_FIREBASE_PROJECT_ID = 'miami-e2e'
export const DEFAULT_E2E_ACADEMY_ID = 'academy_e2e_default'
export const DEFAULT_E2E_ACADEMY_NAME = 'Miami E2E Academy'

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
  if (!params?.packageId && !params?.groupStudentId && !params?.studentId) return;
  await runFirebaseTask(page, 'cleanupTempGroupAttendanceSetup', params);
}

export async function setTempGroupAttendanceState(page, params) {
  if (!params?.groupLessonId || !params?.studentId || !params?.packageId || !params?.groupStudentId) return;
  await runFirebaseTask(page, 'setTempGroupAttendanceState', params);
}

export async function createTempCalendarGroupLessonSetup(page, params) {
  return runFirebaseTask(page, 'createTempCalendarGroupLessonSetup', params);
}

export async function cleanupTempCalendarGroupLessonSetup(page, params) {
  if (!params?.groupClassId && !params?.groupLessonId && !params?.groupLessonIds?.length) return;
  await runFirebaseTask(page, 'cleanupTempCalendarGroupLessonSetup', params);
}

export async function getGroupPackageStartDate(page, params) {
  return runFirebaseTask(page, 'getGroupPackageStartDate', params);
}

async function runFirebaseTask(page, taskName, params) {
  const firebaseConfig = getFirebaseConfigFromEnv(process.env)
  const timeoutMs = getFirebaseTaskTimeoutMs(taskName, params);
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Timed out running Firebase helper task: ${taskName}`));
    }, timeoutMs);
  });

  const firebaseTaskPromise = page.evaluate(
    async ({ firebaseConfig, firebaseVersion, taskName, params, defaultAcademyId }) => {
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
        case 'setTempGroupAttendanceState':
          return setTempGroupAttendanceStateTask({ db, firestore, params });
        case 'createTempCalendarGroupLessonSetup':
          return createTempCalendarGroupLessonSetupTask({ db, firestore, params });
        case 'cleanupTempCalendarGroupLessonSetup':
          return cleanupTempCalendarGroupLessonSetupTask({ db, firestore, params });
        case 'getGroupPackageStartDate':
          return getGroupPackageStartDateTask({ db, firestore, params });
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

      function getTaskAcademyId(taskParams) {
        return String(taskParams?.academyId || defaultAcademyId || '').trim();
      }

      async function getGroupClassByName(dbRef, firestoreModule, groupName) {
        const { collection, getDocs, query, where } = firestoreModule;
        const groupClassSnap = await getDocs(
          query(collection(dbRef, 'groupClasses'), where('name', '==', groupName))
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

      async function getGroupClassById(dbRef, firestoreModule, groupClassId) {
        const { doc, getDoc } = firestoreModule;
        const groupClassDoc = await getDoc(doc(dbRef, 'groupClasses', String(groupClassId)));

        if (!groupClassDoc.exists()) {
          throw new Error(`Group class not found by id: ${groupClassId}`);
        }

        return {
          id: groupClassDoc.id,
          data: groupClassDoc.data() || {},
        };
      }

      async function getGroupLessonsByClassId(dbRef, firestoreModule, groupClassId) {
        const { collection, getDocs, query, where } = firestoreModule;
        const [groupLessonsA, groupLessonsB] = await Promise.all([
          getDocs(query(collection(dbRef, 'groupLessons'), where('groupClassId', '==', groupClassId))),
          getDocs(query(collection(dbRef, 'groupLessons'), where('groupClassID', '==', groupClassId))),
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
        const academyId = getTaskAcademyId(params);
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
          academyId,
          studentId: tempStudentId,
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
        const academyId = getTaskAcademyId(params);

        const studentRef = requestedStudentId
          ? doc(db, 'privateStudents', requestedStudentId)
          : doc(collection(db, 'privateStudents'));
        const nowTs = Timestamp.now();

        await setDoc(studentRef, {
          academyId,
          name: String(studentName || '').trim(),
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
            query(collection(db, 'privateStudents'), where('name', '==', studentName))
          );
          studentSnap.docs.forEach((studentDoc) => studentIds.add(studentDoc.id));
        }

        for (const currentStudentId of studentIds) {
          const [groupStudentSnap, studentPackageSnap] = await Promise.all([
            getDocs(query(collection(db, 'groupStudents'), where('studentId', '==', currentStudentId))),
            getDocs(query(collection(db, 'studentPackages'), where('studentId', '==', currentStudentId))),
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
            query(collection(db, 'groupStudents'), where('packageId', '==', packageId))
          );
          byPackageSnap.docs.forEach((docItem) => groupStudentDocIds.add(docItem.id));
        }

        if (tempStudentId) {
          const byStudentSnap = await getDocs(
            query(collection(db, 'groupStudents'), where('studentId', '==', tempStudentId))
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
        const { Timestamp, collection, doc, getDoc, getDocs, query, setDoc, where } = firestoreModule;
        const {
          groupName,
          groupClassId,
          studentId,
          studentName,
          lessonDate,
          tempPackageTitle,
          packageId,
          groupStudentId,
        } = params;
        const academyId = getTaskAcademyId(params);
        const groupClass = groupClassId
          ? await getGroupClassById(db, firestoreModule, groupClassId)
          : await getGroupClassByName(db, firestoreModule, groupName);
        let studentDoc = null;
        let studentData = null;

        if (studentId) {
          const studentRef = doc(db, 'privateStudents', String(studentId));
          const studentSnap = await getDoc(studentRef);
          if (!studentSnap.exists()) {
            throw new Error(`Student not found by id: ${studentId}`);
          }
          studentDoc = studentSnap;
          studentData = studentSnap.data() || {};
        } else {
          const studentSnap = await getDocs(
            query(collection(db, 'privateStudents'), where('name', '==', studentName))
          );

          if (studentSnap.empty) {
            throw new Error(`Student not found: ${studentName}`);
          }

          studentDoc = studentSnap.docs[0];
          studentData = studentDoc.data() || {};
        }

        const packageRef = packageId
          ? doc(db, 'studentPackages', String(packageId))
          : doc(collection(db, 'studentPackages'));
        const groupStudentRef = groupStudentId
          ? doc(db, 'groupStudents', String(groupStudentId))
          : doc(collection(db, 'groupStudents'));
        const nowTs = Timestamp.now();
        const startDateTs = Timestamp.fromDate(new Date(`${lessonDate}T00:00:00`));
        const teacher = String(groupClass.data.teacher || '').trim().toLowerCase();
        const studentDisplayName = String(studentData.name || studentName).trim();

        await setDoc(packageRef, {
          academyId,
          studentId: studentDoc.id,
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
        });

        await setDoc(groupStudentRef, {
          academyId,
          groupClassId: groupClass.id,
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
        });

        return {
          packageId: packageRef.id,
          groupStudentId: groupStudentRef.id,
          studentId: studentDoc.id,
          studentName: studentDisplayName,
        };
      }

      async function cleanupTempGroupAttendanceSetupTask({ db, firestore: firestoreModule, params }) {
        const { collection, deleteDoc, doc, getDocs, query, where } = firestoreModule;
        const {
          packageId,
          groupStudentId,
          studentId,
          groupLessonId,
          skipCreditTransactionCleanup = false,
        } = params;

        if (groupStudentId) {
          await deleteDoc(doc(db, 'groupStudents', groupStudentId)).catch(() => {});
        }

        if (packageId) {
          if (!skipCreditTransactionCleanup) {
            const creditTransactionSnap = await getDocs(
              query(collection(db, 'creditTransactions'), where('packageId', '==', packageId))
            ).catch(() => null);

            if (creditTransactionSnap && !creditTransactionSnap.empty) {
              await Promise.all(
                creditTransactionSnap.docs
                  .filter((txDoc) => {
                    if (!groupLessonId && !studentId) return true;

                    const txData = txDoc.data() || {};
                    if (groupLessonId && String(txData.sourceId || '') !== String(groupLessonId)) {
                      return false;
                    }
                    if (studentId && String(txData.studentId || '') !== String(studentId)) {
                      return false;
                    }
                    return true;
                  })
                  .map((txDoc) =>
                    deleteDoc(doc(db, 'creditTransactions', txDoc.id)).catch(() => {})
                  )
              );
            }
          }

          await deleteDoc(doc(db, 'studentPackages', packageId)).catch(() => {});
        }

        if (studentId) {
          await deleteDoc(doc(db, 'privateStudents', String(studentId))).catch(() => {});
        }
      }

      async function setTempGroupAttendanceStateTask({ db, firestore: firestoreModule, params }) {
        const { doc, serverTimestamp, writeBatch } = firestoreModule;
        const {
          groupLessonId,
          studentId,
          packageId,
          groupStudentId,
          deducted,
          syncGuardStudentId = '',
          totalCount = 4,
        } = params;
        const academyId = getTaskAcademyId(params);
        const timeoutMs = Number(params?.firebaseTaskTimeoutMs || 10000);
        const isDeducted = deducted === true;
        const countedStudentIDs = [
          String(syncGuardStudentId || '').trim(),
          isDeducted ? String(studentId) : '',
        ].filter(Boolean);
        const batch = writeBatch(db);

        batch.set(
          doc(db, 'groupLessons', String(groupLessonId)),
          {
            academyId,
            countedStudentIDs,
            attendanceAppliedAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        batch.set(
          doc(db, 'studentPackages', String(packageId)),
          {
            academyId,
            usedCount: isDeducted ? 1 : 0,
            remainingCount: isDeducted ? Math.max(0, Number(totalCount) - 1) : Number(totalCount),
            status: 'active',
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );
        batch.set(
          doc(db, 'groupStudents', String(groupStudentId)),
          {
            academyId,
            attendanceCount: isDeducted ? 1 : 0,
            updatedAt: serverTimestamp(),
          },
          { merge: true }
        );

        await Promise.race([
          batch.commit(),
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(new Error('Timed out committing temporary group attendance state.'));
            }, timeoutMs);
          }),
        ]);
      }

      async function createTempCalendarGroupLessonSetupTask({
        db,
        firestore: firestoreModule,
        params,
      }) {
        const { Timestamp, collection, doc, serverTimestamp, setDoc } = firestoreModule;
        const {
          groupName,
          teacherName = 'e2e-calendar-teacher',
          lessonDate,
          lessonTime,
          lessonSubject,
          groupClassId,
          groupLessonId,
          skipPastAttendanceSync = false,
        } = params;
        const academyId = getTaskAcademyId(params);
        const nowTs = Timestamp.now();
        const groupClassRef = groupClassId
          ? doc(db, 'groupClasses', String(groupClassId))
          : doc(collection(db, 'groupClasses'));
        const groupLessonRef = groupLessonId
          ? doc(db, 'groupLessons', String(groupLessonId))
          : doc(collection(db, 'groupLessons'));
        const normalizedTeacher = String(teacherName || '').trim().toLowerCase();
        const trimmedGroupName = String(groupName || '').trim();

        await setDoc(groupClassRef, {
          academyId,
          name: trimmedGroupName,
          teacher: normalizedTeacher,
          maxStudents: 8,
          time: String(lessonTime || '').trim(),
          subject: String(lessonSubject || '').trim(),
          weekdays: [],
          createdAt: nowTs,
          updatedAt: nowTs,
        });

        await setDoc(groupLessonRef, {
          academyId,
          groupClassId: groupClassRef.id,
          groupClassID: groupClassRef.id,
          groupClassName: trimmedGroupName,
          teacher: normalizedTeacher,
          date: String(lessonDate || '').trim(),
          time: String(lessonTime || '').trim(),
          subject: String(lessonSubject || '').trim(),
          completed: false,
          countedStudentIDs: skipPastAttendanceSync
            ? [`__e2e_sync_guard_${groupLessonRef.id}`]
            : [],
          attendanceAppliedAt: skipPastAttendanceSync ? serverTimestamp() : null,
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
        const { collection, deleteDoc, doc, getDocs, query, where } = firestoreModule;
        const { groupClassId, groupLessonId, groupLessonIds, strictLessonIdsOnly = false } = params;
        const explicitLessonIds = new Set(
          Array.isArray(groupLessonIds)
            ? groupLessonIds.map((lessonId) => String(lessonId || '').trim()).filter(Boolean)
            : []
        );

        if (groupLessonId) {
          explicitLessonIds.add(String(groupLessonId));
        }

        if (explicitLessonIds.size > 0) {
          await Promise.all(
            Array.from(explicitLessonIds).map((lessonId) =>
              deleteDoc(doc(db, 'groupLessons', lessonId)).catch(() => {})
            )
          );
        }

        if (groupClassId && !strictLessonIdsOnly) {
          const [groupLessonsA, groupLessonsB] = await Promise.all([
            getDocs(
              query(collection(db, 'groupLessons'), where('groupClassId', '==', groupClassId))
            ).catch(() => null),
            getDocs(
              query(collection(db, 'groupLessons'), where('groupClassID', '==', groupClassId))
            ).catch(() => null),
          ]);

          const lessonIds = new Set();
          for (const snap of [groupLessonsA, groupLessonsB]) {
            if (!snap || snap.empty) continue;
            snap.docs.forEach((lessonDoc) => lessonIds.add(lessonDoc.id));
          }

          await Promise.all(
            Array.from(lessonIds).map((lessonId) =>
              deleteDoc(doc(db, 'groupLessons', lessonId)).catch(() => {})
            )
          );
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
      function formatYmdFromDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    },
    {
      firebaseConfig,
      firebaseVersion: FIREBASE_VERSION,
      taskName,
      params,
      defaultAcademyId: DEFAULT_E2E_ACADEMY_ID,
    }
  );

  try {
    return await Promise.race([firebaseTaskPromise, timeoutPromise]);
  } finally {
    clearTimeout(timeoutId);
  }
}

function getFirebaseTaskTimeoutMs(taskName, params) {
  const requestedTimeoutMs = Number(params?.firebaseTaskTimeoutMs);
  if (Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs >= 5000) {
    return requestedTimeoutMs;
  }

  if (String(taskName || '').startsWith('cleanup')) {
    return 20000;
  }

  return 30000;
}
