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

export async function cleanupTempCalendarGroupLessonSetup(page, params, options = {}) {
  if (!params?.groupClassId && !params?.groupLessonId && !params?.groupLessonIds?.length) return;
  await runFirebaseTask(page, 'cleanupTempCalendarGroupLessonSetup', params, options);
}

export async function getGroupPackageStartDate(page, params) {
  return runFirebaseTask(page, 'getGroupPackageStartDate', params);
}

export async function getStudentGroupAccessSummary(page, params) {
  return runFirebaseTask(page, 'getStudentGroupAccessSummary', params);
}

export async function getLessonRequestApprovalState(page, params) {
  return runFirebaseTask(page, 'getLessonRequestApprovalState', params);
}

export async function getTempGroupAttendanceState(page, params) {
  return runFirebaseTask(page, 'getTempGroupAttendanceState', params);
}

async function runFirebaseTask(page, taskName, params, options = {}) {
  const firebaseConfig = getFirebaseConfigFromEnv(process.env)
  const timeoutMs = getFirebaseTaskTimeoutMs(taskName, params, options);
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(createFirebaseTaskTimeoutError(taskName, params, timeoutMs));
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
        case 'getStudentGroupAccessSummary':
          return getStudentGroupAccessSummaryTask({ db, firestore, params });
        case 'getLessonRequestApprovalState':
          return getLessonRequestApprovalStateTask({ db, firestore, params });
        case 'getTempGroupAttendanceState':
          return getTempGroupAttendanceStateTask({ db, firestore, params });
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

      function getAuthDiagnostic() {
        const user = auth.currentUser;
        return {
          uid: user?.uid || '',
          email: user?.email || '',
        };
      }

      async function withFirestoreStep(stepName, context, action) {
        try {
          return await action();
        } catch (error) {
          if (error?.__firebaseTaskDiagnostic) {
            throw error;
          }

          const diagnostic = {
            taskName,
            stepName,
            collection: context?.collection || '',
            docId: context?.docId || '',
            filters: context?.filters || [],
            academyId: context?.academyId || getTaskAcademyId(params),
            studentId: context?.studentId || params?.studentId || params?.tempStudentId || '',
            groupClassId: context?.groupClassId || params?.groupClassId || '',
            packageId: context?.packageId || params?.packageId || '',
            auth: getAuthDiagnostic(),
          };
          const message = [
            `Firebase helper task failed at ${taskName}.${stepName}: ${error?.message || String(error)}`,
            `Context: ${JSON.stringify(diagnostic)}`,
          ].join('\n');
          const wrapped = new Error(message);
          wrapped.name = error?.name || 'FirebaseTaskError';
          wrapped.code = error?.code;
          wrapped.stack = `${message}\n${error?.stack || ''}`;
          wrapped.__firebaseTaskDiagnostic = true;
          throw wrapped;
        }
      }

      async function getAcademyScopedDocById(
        dbRef,
        firestoreModule,
        collectionName,
        docId,
        academyId,
        stepName,
        context = {}
      ) {
        const { collection, documentId, getDocs, query, where } = firestoreModule;
        const normalizedDocId = String(docId || '').trim();
        if (!normalizedDocId) return null;

        const snap = await withFirestoreStep(
          stepName,
          {
            collection: collectionName,
            docId: normalizedDocId,
            academyId,
            ...context,
            filters: [
              { field: 'academyId', op: '==', value: academyId },
              { field: '__name__', op: '==', value: normalizedDocId },
            ],
          },
          () =>
            getDocs(
              query(
                collection(dbRef, collectionName),
                where('academyId', '==', academyId),
                where(documentId(), '==', normalizedDocId)
              )
            )
        );

        if (snap.empty) return null;
        const docSnap = snap.docs[0];
        return {
          id: docSnap.id,
          data: docSnap.data() || {},
        };
      }

      async function deleteAcademyScopedDocById(
        dbRef,
        firestoreModule,
        collectionName,
        docId,
        academyId,
        stepName,
        context = {}
      ) {
        const { deleteDoc, doc } = firestoreModule;
        const docItem = await getAcademyScopedDocById(
          dbRef,
          firestoreModule,
          collectionName,
          docId,
          academyId,
          `${stepName}.get`,
          context
        );
        if (!docItem) return false;

        await withFirestoreStep(
          `${stepName}.delete`,
          {
            collection: collectionName,
            docId: docItem.id,
            academyId,
            ...context,
          },
          () => deleteDoc(doc(dbRef, collectionName, docItem.id))
        );
        return true;
      }

      async function getGroupClassByName(dbRef, firestoreModule, groupName, academyId) {
        const { collection, getDocs, query, where } = firestoreModule;
        const groupClassSnap = await withFirestoreStep(
          'getGroupClassByName',
          {
            collection: 'groupClasses',
            academyId,
            filters: [
              { field: 'academyId', op: '==', value: academyId },
              { field: 'name', op: '==', value: groupName },
            ],
          },
          () =>
            getDocs(
              query(
                collection(dbRef, 'groupClasses'),
                where('academyId', '==', academyId),
                where('name', '==', groupName)
              )
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

      async function getGroupClassById(dbRef, firestoreModule, groupClassId, academyId) {
        const { collection, documentId, getDocs, query, where } = firestoreModule;
        const normalizedGroupClassId = String(groupClassId);
        const groupClassSnap = await withFirestoreStep(
          'getGroupClassById',
          {
            collection: 'groupClasses',
            docId: normalizedGroupClassId,
            academyId,
            filters: [
              { field: 'academyId', op: '==', value: academyId },
              { field: '__name__', op: '==', value: normalizedGroupClassId },
            ],
          },
          () =>
            getDocs(
              query(
                collection(dbRef, 'groupClasses'),
                where('academyId', '==', academyId),
                where(documentId(), '==', normalizedGroupClassId)
              )
            )
        );

        if (groupClassSnap.empty) {
          throw new Error(`Group class not found by id: ${groupClassId}`);
        }

        const groupClassDoc = groupClassSnap.docs[0];
        return {
          id: groupClassDoc.id,
          data: groupClassDoc.data() || {},
        };
      }

      async function getGroupLessonsByClassId(dbRef, firestoreModule, groupClassId, academyId) {
        const { collection, getDocs, query, where } = firestoreModule;
        const [groupLessonsA, groupLessonsB] = await Promise.all([
          withFirestoreStep(
            'getGroupLessonsByClassId.groupClassId',
            {
              collection: 'groupLessons',
              academyId,
              filters: [
                { field: 'academyId', op: '==', value: academyId },
                { field: 'groupClassId', op: '==', value: groupClassId },
              ],
            },
            () =>
              getDocs(
                query(
                  collection(dbRef, 'groupLessons'),
                  where('academyId', '==', academyId),
                  where('groupClassId', '==', groupClassId)
                )
              )
          ),
          withFirestoreStep(
            'getGroupLessonsByClassId.groupClassID',
            {
              collection: 'groupLessons',
              academyId,
              filters: [
                { field: 'academyId', op: '==', value: academyId },
                { field: 'groupClassID', op: '==', value: groupClassId },
              ],
            },
            () =>
              getDocs(
                query(
                  collection(dbRef, 'groupLessons'),
                  where('academyId', '==', academyId),
                  where('groupClassID', '==', groupClassId)
                )
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
        const academyId = getTaskAcademyId(params);
        const groupClass = await getGroupClassByName(db, firestoreModule, groupName, academyId);
        const groupLessons = await getGroupLessonsByClassId(db, firestoreModule, groupClass.id, academyId);

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

        await withFirestoreStep(
          'createTempGroupStudentAddPackage.setStudentPackage',
          {
            collection: 'studentPackages',
            docId: packageRef.id,
            academyId,
          },
          () => setDoc(packageRef, {
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
          })
        );

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

        await withFirestoreStep(
          'createTempStudent.setPrivateStudent',
          {
            collection: 'privateStudents',
            docId: studentRef.id,
            academyId,
          },
          () => setDoc(studentRef, {
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
          })
        );

        return {
          studentId: studentRef.id,
          studentName: String(studentName || '').trim(),
        };
      }

      async function cleanupTempStudentDataTask({ db, firestore: firestoreModule, params }) {
        const { collection, deleteDoc, doc, getDocs, query, where } = firestoreModule;
        const { studentId, studentName } = params;
        const academyId = getTaskAcademyId(params);
        const studentIds = new Set();

        if (studentId) {
          studentIds.add(String(studentId));
        }

        if (studentName) {
          const studentSnap = await getDocs(
            query(
              collection(db, 'privateStudents'),
              where('academyId', '==', academyId),
              where('name', '==', studentName)
            )
          );
          studentSnap.docs.forEach((studentDoc) => studentIds.add(studentDoc.id));
        }

        for (const currentStudentId of studentIds) {
          const [groupStudentSnap, studentPackageSnap] = await Promise.all([
            getDocs(
              query(
                collection(db, 'groupStudents'),
                where('academyId', '==', academyId),
                where('studentId', '==', currentStudentId)
              )
            ),
            getDocs(
              query(
                collection(db, 'studentPackages'),
                where('academyId', '==', academyId),
                where('studentId', '==', currentStudentId)
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
        const academyId = getTaskAcademyId(params);
        const groupStudentDocIds = new Set();
        const initialStudentId = String(tempStudentId || '').trim();
        const initialGroupClassId = String(groupClassId || '').trim();
        const packageDoc =
          packageId && (!initialStudentId || !initialGroupClassId)
            ? await getAcademyScopedDocById(
              db,
              firestoreModule,
              'studentPackages',
              packageId,
              academyId,
              'cleanupTempGroupStudentAddSetup.getStudentPackage',
              {
                packageId,
                studentId: tempStudentId,
                groupClassId,
              }
            )
          : null;
        const scopedStudentId = String(initialStudentId || packageDoc?.data?.studentId || '').trim();
        const scopedGroupClassId = String(initialGroupClassId || packageDoc?.data?.groupClassId || '').trim();

        if (scopedStudentId && scopedGroupClassId) {
          const byStudentAndGroupSnap = await withFirestoreStep(
            'cleanupTempGroupStudentAddSetup.getGroupStudentsByStudentAndGroup',
            {
              collection: 'groupStudents',
              academyId,
              studentId: scopedStudentId,
              groupClassId: scopedGroupClassId,
              packageId,
              filters: [
                { field: 'academyId', op: '==', value: academyId },
                { field: 'studentId', op: '==', value: scopedStudentId },
                { field: 'groupClassId', op: '==', value: scopedGroupClassId },
              ],
            },
            () =>
              getDocs(
                query(
                  collection(db, 'groupStudents'),
                  where('academyId', '==', academyId),
                  where('studentId', '==', scopedStudentId),
                  where('groupClassId', '==', scopedGroupClassId)
                )
              )
          );

          byStudentAndGroupSnap.docs.forEach((docItem) => {
            const row = docItem.data() || {};
            if (packageId && String(row.packageId || '') !== String(packageId)) return;
            groupStudentDocIds.add(docItem.id);
          });
        }

        await Promise.all(
          Array.from(groupStudentDocIds).map((groupStudentId) =>
            withFirestoreStep(
              'cleanupTempGroupStudentAddSetup.deleteGroupStudent',
              {
                collection: 'groupStudents',
                docId: groupStudentId,
                academyId,
                studentId: scopedStudentId,
                groupClassId: scopedGroupClassId,
                packageId,
              },
              () => deleteDoc(doc(db, 'groupStudents', groupStudentId))
            )
          )
        );

        if (packageId) {
          if (scopedStudentId && scopedGroupClassId) {
            const packageSnap = await withFirestoreStep(
              'cleanupTempGroupStudentAddSetup.getStudentPackagesByStudentAndGroup',
              {
                collection: 'studentPackages',
                academyId,
                studentId: scopedStudentId,
                groupClassId: scopedGroupClassId,
                packageId,
                filters: [
                  { field: 'academyId', op: '==', value: academyId },
                  { field: 'studentId', op: '==', value: scopedStudentId },
                  { field: 'groupClassId', op: '==', value: scopedGroupClassId },
                ],
              },
              () =>
                getDocs(
                  query(
                    collection(db, 'studentPackages'),
                    where('academyId', '==', academyId),
                    where('studentId', '==', scopedStudentId),
                    where('groupClassId', '==', scopedGroupClassId)
                  )
                )
            );
            const packageDocForDelete = packageSnap.docs.find(
              (docItem) => docItem.id === String(packageId)
            );
            if (packageDocForDelete) {
              await withFirestoreStep(
                'cleanupTempGroupStudentAddSetup.deleteStudentPackage',
                {
                  collection: 'studentPackages',
                  docId: packageDocForDelete.id,
                  academyId,
                  studentId: scopedStudentId,
                  groupClassId: scopedGroupClassId,
                  packageId,
                },
                () => deleteDoc(doc(db, 'studentPackages', packageDocForDelete.id))
              );
            }
          } else {
            await deleteAcademyScopedDocById(
              db,
              firestoreModule,
              'studentPackages',
              packageId,
              academyId,
              'cleanupTempGroupStudentAddSetup.deleteStudentPackage',
              {
                packageId,
                studentId: scopedStudentId,
                groupClassId: scopedGroupClassId,
              }
            );
          }
        }
      }

      async function createTempGroupAttendanceSetupTask({ db, firestore: firestoreModule, params }) {
        const { Timestamp, collection, doc, getDocs, query, setDoc, where } = firestoreModule;
        const {
          groupName,
          groupClassId,
          studentId,
          studentName,
          lessonDate,
          tempPackageTitle,
          packageId,
          groupStudentId,
          totalCount = 4,
        } = params;
        const academyId = getTaskAcademyId(params);
        const groupClass = groupClassId
          ? await getGroupClassById(db, firestoreModule, groupClassId, academyId)
          : await getGroupClassByName(db, firestoreModule, groupName, academyId);
        let studentDoc = null;
        let studentData = null;

        if (studentId) {
          const normalizedStudentId = String(studentId);
          const studentSnap = await withFirestoreStep(
            'createTempGroupAttendanceSetup.getPrivateStudentById',
            {
              collection: 'privateStudents',
              docId: normalizedStudentId,
              academyId,
              filters: [
                { field: 'academyId', op: '==', value: academyId },
                { field: '__name__', op: '==', value: normalizedStudentId },
              ],
            },
            () =>
              getDocs(
                query(
                  collection(db, 'privateStudents'),
                  where('academyId', '==', academyId),
                  where(firestoreModule.documentId(), '==', normalizedStudentId)
                )
              )
          );
          if (studentSnap.empty) {
            throw new Error(`Student not found by id: ${studentId}`);
          }
          studentDoc = studentSnap.docs[0];
          studentData = studentDoc.data() || {};
        } else {
          const studentSnap = await withFirestoreStep(
            'createTempGroupAttendanceSetup.getPrivateStudentByName',
            {
              collection: 'privateStudents',
              academyId,
              filters: [
                { field: 'academyId', op: '==', value: academyId },
                { field: 'name', op: '==', value: studentName },
              ],
            },
            () =>
              getDocs(
                query(
                  collection(db, 'privateStudents'),
                  where('academyId', '==', academyId),
                  where('name', '==', studentName)
                )
              )
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
        const normalizedTotalCount =
          Number.isInteger(Number(totalCount)) && Number(totalCount) >= 0
            ? Number(totalCount)
            : 4;

        await withFirestoreStep(
          'createTempGroupAttendanceSetup.setStudentPackage',
          {
            collection: 'studentPackages',
            docId: packageRef.id,
            academyId,
          },
          () => setDoc(packageRef, {
          academyId,
          studentId: studentDoc.id,
          studentName: studentDisplayName,
          teacher,
          packageType: 'group',
          groupClassId: groupClass.id,
          groupClassName: String(groupClass.data.name || groupName).trim(),
          title: tempPackageTitle,
          totalCount: normalizedTotalCount,
          usedCount: 0,
          remainingCount: normalizedTotalCount,
          status: 'active',
          registrationStartDate: lessonDate,
          registrationWeeks: 1,
          coverageEndDate: '',
          expiresAt: '',
          amountPaid: 0,
          memo: 'E2E temporary package for group attendance test',
          createdAt: nowTs,
          updatedAt: nowTs,
          })
        );

        await withFirestoreStep(
          'createTempGroupAttendanceSetup.setGroupStudent',
          {
            collection: 'groupStudents',
            docId: groupStudentRef.id,
            academyId,
          },
          () => setDoc(groupStudentRef, {
          academyId,
          groupClassId: groupClass.id,
          classID: groupClass.id,
          studentId: studentDoc.id,
          studentName: studentDisplayName,
          name: studentDisplayName,
          teacher,
          packageId: packageRef.id,
          packageType: 'group',
          paidLessons: normalizedTotalCount,
          attendanceCount: 0,
          startDate: startDateTs,
          status: 'active',
          studentStatus: 'active',
          excludedDates: [],
          breakStartDate: '',
          breakEndDate: '',
          createdAt: nowTs,
          updatedAt: nowTs,
          })
        );

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
        const academyId = getTaskAcademyId(params);

        if (groupStudentId) {
          await deleteDoc(doc(db, 'groupStudents', groupStudentId)).catch(() => {});
        }

        if (packageId) {
          if (!skipCreditTransactionCleanup) {
            const creditTransactionSnap = await withFirestoreStep(
              'cleanupTempGroupAttendanceSetup.getCreditTransactionsByPackage',
              {
                collection: 'creditTransactions',
                academyId,
                filters: [
                  { field: 'academyId', op: '==', value: academyId },
                  { field: 'packageId', op: '==', value: packageId },
                ],
              },
              () => getDocs(
                query(
                  collection(db, 'creditTransactions'),
                  where('academyId', '==', academyId),
                  where('packageId', '==', packageId)
                )
              )
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

        await withFirestoreStep(
          'setTempGroupAttendanceState.commitBatch',
          {
            collection: 'groupLessons/studentPackages/groupStudents',
            academyId,
            docId: `${groupLessonId}/${packageId}/${groupStudentId}`,
          },
          () => Promise.race([
            batch.commit(),
            new Promise((_, reject) => {
              setTimeout(() => {
                reject(new Error('Timed out committing temporary group attendance state.'));
              }, timeoutMs);
            }),
          ])
        );
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

        await withFirestoreStep(
          'createTempCalendarGroupLessonSetup.setGroupClass',
          {
            collection: 'groupClasses',
            docId: groupClassRef.id,
            academyId,
          },
          () => setDoc(groupClassRef, {
          academyId,
          name: trimmedGroupName,
          teacher: normalizedTeacher,
          maxStudents: 8,
          time: String(lessonTime || '').trim(),
          subject: String(lessonSubject || '').trim(),
          weekdays: [],
          createdAt: nowTs,
          updatedAt: nowTs,
          })
        );

        await withFirestoreStep(
          'createTempCalendarGroupLessonSetup.setGroupLesson',
          {
            collection: 'groupLessons',
            docId: groupLessonRef.id,
            academyId,
          },
          () => setDoc(groupLessonRef, {
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
          })
        );

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
        const academyId = getTaskAcademyId(params);
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
              withFirestoreStep(
                'cleanupTempCalendarGroupLessonSetup.deleteKnownGroupLesson',
                {
                  collection: 'groupLessons',
                  docId: lessonId,
                  academyId,
                },
                () => deleteDoc(doc(db, 'groupLessons', lessonId))
              )
            )
          );
        }

        if (groupClassId && !strictLessonIdsOnly) {
          const [groupLessonsA, groupLessonsB] = await Promise.all([
            withFirestoreStep(
              'cleanupTempCalendarGroupLessonSetup.getGroupLessonsByGroupClassId',
              {
                collection: 'groupLessons',
                academyId,
                filters: [
                  { field: 'academyId', op: '==', value: academyId },
                  { field: 'groupClassId', op: '==', value: groupClassId },
                ],
              },
              () =>
                getDocs(
                  query(
                    collection(db, 'groupLessons'),
                    where('academyId', '==', academyId),
                    where('groupClassId', '==', groupClassId)
                  )
                )
            ),
            withFirestoreStep(
              'cleanupTempCalendarGroupLessonSetup.getGroupLessonsByGroupClassID',
              {
                collection: 'groupLessons',
                academyId,
                filters: [
                  { field: 'academyId', op: '==', value: academyId },
                  { field: 'groupClassID', op: '==', value: groupClassId },
                ],
              },
              () =>
                getDocs(
                  query(
                    collection(db, 'groupLessons'),
                    where('academyId', '==', academyId),
                    where('groupClassID', '==', groupClassId)
                  )
                )
            )
          ]);

          const lessonIds = new Set();
          for (const snap of [groupLessonsA, groupLessonsB]) {
            if (!snap || snap.empty) continue;
            snap.docs.forEach((lessonDoc) => lessonIds.add(lessonDoc.id));
          }

          await Promise.all(
            Array.from(lessonIds).map((lessonId) =>
              withFirestoreStep(
                'cleanupTempCalendarGroupLessonSetup.deleteQueriedGroupLesson',
                {
                  collection: 'groupLessons',
                  docId: lessonId,
                  academyId,
                },
                () => deleteDoc(doc(db, 'groupLessons', lessonId))
              )
            )
          );
        }

        if (groupClassId) {
          await withFirestoreStep(
            'cleanupTempCalendarGroupLessonSetup.deleteGroupClass',
            {
              collection: 'groupClasses',
              docId: groupClassId,
              academyId,
            },
            () => deleteDoc(doc(db, 'groupClasses', groupClassId))
          );
        }
      }

      async function getGroupPackageStartDateTask({ db, firestore: firestoreModule, params }) {
        const { groupName } = params;
        const academyId = getTaskAcademyId(params);
        const groupClass = await getGroupClassByName(db, firestoreModule, groupName, academyId);
        const groupLessons = await getGroupLessonsByClassId(db, firestoreModule, groupClass.id, academyId);
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

      async function getStudentGroupAccessSummaryTask({ db, firestore: firestoreModule, params }) {
        const { doc, getDoc } = firestoreModule;
        const academyId = getTaskAcademyId(params);
        const studentId = String(params?.studentId || '').trim();
        if (!studentId) return null;
        const snap = await getDoc(doc(db, 'studentGroupAccessSummary', `${academyId}__${studentId}`));
        return snap.exists() ? snap.data() : null;
      }

      async function getTempGroupAttendanceStateTask({ db, firestore: firestoreModule, params }) {
        const { doc, getDoc } = firestoreModule;
        const academyId = getTaskAcademyId(params);

        async function readDoc(collectionName, docId) {
          const normalizedDocId = String(docId || '').trim();
          if (!normalizedDocId) {
            return { exists: false };
          }

          const snap = await withFirestoreStep(
            `getTempGroupAttendanceState.${collectionName}`,
            {
              collection: collectionName,
              docId: normalizedDocId,
              academyId,
            },
            () => getDoc(doc(db, collectionName, normalizedDocId))
          );
          const data = snap.exists() ? snap.data() || {} : {};
          return {
            exists: snap.exists(),
            academyId: data.academyId || '',
            studentId: data.studentId || '',
            packageId: data.packageId || '',
            groupClassId: data.groupClassId || data.groupClassID || data.classID || '',
            countedStudentIDs: Array.isArray(data.countedStudentIDs) ? data.countedStudentIDs : [],
            usedCount: data.usedCount ?? null,
            remainingCount: data.remainingCount ?? null,
            attendanceCount: data.attendanceCount ?? null,
            status: data.status || '',
            studentStatus: data.studentStatus || '',
            updatedAtType: data.updatedAt?.toDate ? 'timestamp' : typeof data.updatedAt,
          };
        }

        const [groupLesson, studentPackage, groupStudent, privateStudent] = await Promise.all([
          readDoc('groupLessons', params?.groupLessonId),
          readDoc('studentPackages', params?.packageId),
          readDoc('groupStudents', params?.groupStudentId),
          readDoc('privateStudents', params?.studentId),
        ]);

        return {
          academyId,
          groupLesson,
          studentPackage,
          groupStudent,
          privateStudent,
        };
      }

      async function getLessonRequestApprovalStateTask({ db, firestore: firestoreModule, params }) {
        const { collection, doc, getDoc, getDocs, query, where } = firestoreModule;
        const academyId = getTaskAcademyId(params);
        const requestId = String(params.requestId || '').trim();
        if (!requestId) throw new Error('requestId is required.');

        const requestSnap = await getDoc(doc(db, 'lessonRequests', requestId));
        const requestData = requestSnap.exists() ? requestSnap.data() || {} : null;
        const lessonsSnap = await getDocs(
          query(
            collection(db, 'lessons'),
            where('academyId', '==', academyId),
            where('lessonRequestId', '==', requestId)
          )
        );

        const lessons = lessonsSnap.docs
          .map((lessonDoc) => {
            const data = lessonDoc.data() || {};
            return {
              id: lessonDoc.id,
              date: String(data.date || ''),
              time: String(data.time || ''),
              subject: String(data.subject || ''),
              studentId: String(data.studentId || ''),
              studentID: String(data.studentID || ''),
              studentName: String(data.studentName || ''),
              teacher: String(data.teacher || ''),
              completed: data.completed === true,
              isDeductCancelled: data.isDeductCancelled === true,
              deductMemo: String(data.deductMemo || ''),
              seriesID: String(data.seriesID || ''),
              sessionNumber: data.sessionNumber || null,
              packageId: String(data.packageId || ''),
            };
          })
          .sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));

        const packageSnap = requestData
          ? await getDocs(
              query(
                collection(db, 'studentPackages'),
                where('academyId', '==', academyId),
                where('studentId', '==', String(requestData.studentId || requestData.studentID || ''))
              )
            )
          : { docs: [] };
        const requestTeacher = String(requestData?.teacher || requestData?.teacherName || '');
        const packages = packageSnap.docs
          .map((packageDoc) => {
            const data = packageDoc.data() || {};
            return {
              id: packageDoc.id,
              academyId: String(data.academyId || ''),
              studentId: String(data.studentId || ''),
              studentName: String(data.studentName || ''),
              teacher: String(data.teacher || data.teacherName || ''),
              packageType: String(data.packageType || ''),
              totalCount: data.totalCount ?? null,
              usedCount: data.usedCount ?? null,
              remainingCount: data.remainingCount ?? null,
              status: String(data.status || ''),
            };
          })
          .filter((pkg) => !requestTeacher || pkg.teacher === requestTeacher)
          .sort((a, b) => a.id.localeCompare(b.id));

        return {
          exists: requestSnap.exists(),
          approvalStatus: String(requestData?.approvalStatus || ''),
          status: String(requestData?.status || ''),
          rejectionReason: String(requestData?.rejectionReason || ''),
          lessonId: String(requestData?.lessonId || requestData?.lessonID || ''),
          fixedPrivatePackageId: String(requestData?.fixedPrivatePackageId || ''),
          reviewedByUID: String(requestData?.reviewedByUID || ''),
          approvedByUID: String(requestData?.approvedByUID || ''),
          rejectedByUID: String(requestData?.rejectedByUID || ''),
          lessons,
          packages,
        };
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

function getFirebaseTaskTimeoutMs(taskName, params, options = {}) {
  const requestedOptionTimeoutMs = Number(options?.timeoutMs);
  if (Number.isFinite(requestedOptionTimeoutMs) && requestedOptionTimeoutMs >= 5000) {
    return requestedOptionTimeoutMs;
  }

  const requestedTimeoutMs = Number(params?.firebaseTaskTimeoutMs);
  if (Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs >= 5000) {
    return requestedTimeoutMs;
  }

  if (String(taskName || '').startsWith('cleanup')) {
    return 20000;
  }

  return 30000;
}

function createFirebaseTaskTimeoutError(taskName, params, timeoutMs) {
  const diagnostic = {
    taskName,
    timeoutMs,
    academyId: String(params?.academyId || DEFAULT_E2E_ACADEMY_ID || '').trim(),
    groupClassId: params?.groupClassId || '',
    groupLessonId: params?.groupLessonId || '',
    groupLessonIds: Array.isArray(params?.groupLessonIds) ? params.groupLessonIds : [],
    groupStudentId: params?.groupStudentId || '',
    packageId: params?.packageId || '',
    studentId: params?.studentId || '',
    strictLessonIdsOnly: Boolean(params?.strictLessonIdsOnly),
  };
  return new Error(
    [
      `Timed out running Firebase helper task: ${taskName} after ${timeoutMs}ms`,
      `Context: ${JSON.stringify(diagnostic)}`,
    ].join('\n')
  );
}
