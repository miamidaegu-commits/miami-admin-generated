const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyDgF4BT9KnyRpApMY23ScZgbBMSmu-ExuU',
  authDomain: 'miamiacademyschedule.firebaseapp.com',
  projectId: 'miamiacademyschedule',
  storageBucket: 'miamiacademyschedule.firebasestorage.app',
  messagingSenderId: '1086077006833',
  appId: '1:1086077006833:web:344e89ad2f30b5c0b44a50',
};

const FIREBASE_VERSION = '10.12.2';

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

async function runFirebaseTask(page, taskName, params) {
  return page.evaluate(
    async ({ firebaseConfig, firebaseVersion, taskName, params }) => {
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
        const { Timestamp, collection, doc, getDocs, query, setDoc, where } = firestoreModule;
        const { groupName, studentName, lessonDate, tempPackageTitle } = params;
        const groupClass = await getGroupClassByName(db, firestoreModule, groupName);
        const studentSnap = await getDocs(
          query(collection(db, 'privateStudents'), where('name', '==', studentName))
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

        await setDoc(packageRef, {
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

      function formatYmdFromDate(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
      }
    },
    {
      firebaseConfig: FIREBASE_CONFIG,
      firebaseVersion: FIREBASE_VERSION,
      taskName,
      params,
    }
  );
}
