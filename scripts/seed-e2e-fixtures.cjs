const fs = require("fs");
const path = require("path");
const admin = require("firebase-admin");

const SERVICE_ACCOUNT_PATH = path.join(
  __dirname,
  "..",
  "serviceAccountKey.json"
);
const EXPECTED_PROJECT_ID =
  process.env.E2E_FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  "miami-e2e";
const SCHOOL_TIME_ZONE = "Asia/Seoul";

const IDS = {
  student: "e2e-baseline-student-inagyumi",
  groupClass: "e2e-baseline-group-advanced-english",
  groupPackage: "e2e-baseline-package-group-inagyumi",
  privatePackage: "e2e-baseline-package-private-inagyumi",
  groupStudent: "e2e-baseline-group-student-inagyumi",
  privateLesson1: "e2e-baseline-private-lesson-1",
  privateLesson2: "e2e-baseline-private-lesson-2",
  groupLesson1: "e2e-baseline-group-lesson-1",
  groupLesson2: "e2e-baseline-group-lesson-2",
  groupLesson3: "e2e-baseline-group-lesson-3",
  groupLesson4: "e2e-baseline-group-lesson-4",
  creditGroupCreated: "e2e-baseline-credit-group-created",
  creditPrivateCreated: "e2e-baseline-credit-private-created",
};

const FIXTURE = {
  teacherName: "teacher",
  studentName: "이나규미",
  groupName: "고급영어회화",
  groupSubject: "고급영어회화",
  groupTime: "19:00",
  privateLessonTime1: "18:30",
  privateLessonTime2: "20:10",
  privateLessonSubject1: "개인영어회화",
  privateLessonSubject2: "문법 클리닉",
  groupPackageTitle: "고급영어회화 그룹 수강권",
  privatePackageTitle: "이나규미 개인 수강권",
};

if (!fs.existsSync(SERVICE_ACCOUNT_PATH)) {
  throw new Error(`Missing service account key: ${SERVICE_ACCOUNT_PATH}`);
}

const serviceAccount = require(SERVICE_ACCOUNT_PATH);

if (serviceAccount.project_id !== EXPECTED_PROJECT_ID) {
  throw new Error(
    [
      "serviceAccountKey.json project_id mismatch.",
      `Expected: ${EXPECTED_PROJECT_ID}`,
      `Received: ${serviceAccount.project_id || "(missing)"}`,
      "Replace serviceAccountKey.json with the E2E Firebase service account or set E2E_FIREBASE_PROJECT_ID intentionally.",
    ].join(" ")
  );
}

if (admin.apps.length === 0) {
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const auth = admin.auth();
const { FieldValue, Timestamp } = admin.firestore;

function formatYmd(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(baseDate, days) {
  const next = new Date(baseDate);
  next.setDate(next.getDate() + days);
  return next;
}

function timestampFromYmdHm(ymd, hm) {
  const [year, month, day] = String(ymd).split("-").map(Number);
  const [hour, minute] = String(hm).split(":").map(Number);
  return Timestamp.fromDate(
    new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0)
  );
}

function nextWeekdayDate(weekdayCode, weekOffset = 0) {
  const now = new Date();
  const targetJsDay = weekdayCode === 1 ? 0 : weekdayCode - 1;
  const currentJsDay = now.getDay();
  let delta = (targetJsDay - currentJsDay + 7) % 7;
  if (delta === 0) delta = 7;
  delta += weekOffset * 7;
  return addDays(now, delta);
}

function buildExistingCreatedAt(existing) {
  return existing && existing.createdAt ? existing.createdAt : FieldValue.serverTimestamp();
}

async function resolveUidByEmail(email) {
  try {
    const userRecord = await auth.getUserByEmail(email);
    return userRecord.uid;
  } catch (error) {
    if (error && error.code === "auth/user-not-found") {
      return "";
    }
    throw error;
  }
}

async function upsertDoc(collectionName, docId, data) {
  const ref = db.collection(collectionName).doc(docId);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() || {} : null;

  await ref.set(
    {
      ...data,
      createdAt: buildExistingCreatedAt(existing),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  console.log(
    `[${snap.exists ? "UPDATE" : "CREATE"}] ${collectionName}/${docId}`
  );
}

async function run() {
  console.log(
    `Seeding E2E baseline fixtures into Firebase project: ${serviceAccount.project_id}`
  );
  console.log(`Time zone baseline: ${SCHOOL_TIME_ZONE}`);

  const adminUid = await resolveUidByEmail("admin@example.com");

  const nextMonday = nextWeekdayDate(2, 0);
  const nextWednesday = nextWeekdayDate(4, 0);
  const mondayAfter = nextWeekdayDate(2, 1);
  const wednesdayAfter = nextWeekdayDate(4, 1);

  const groupLessonDates = [
    formatYmd(nextMonday),
    formatYmd(nextWednesday),
    formatYmd(mondayAfter),
    formatYmd(wednesdayAfter),
  ];

  const privateLessonDate1 = formatYmd(addDays(new Date(), 5));
  const privateLessonDate2 = formatYmd(addDays(new Date(), 12));
  const studentFirstRegisteredAt = formatYmd(addDays(new Date(), -45));
  const groupStudentStartDate = Timestamp.fromDate(addDays(new Date(), -30));
  const privatePackageExpiresAt = Timestamp.fromDate(addDays(new Date(), 120));
  const groupPackageExpiresAt = Timestamp.fromDate(addDays(new Date(), 120));
  const groupRegistrationStartDate = groupLessonDates[0];
  const groupCoverageEndDate = groupLessonDates[groupLessonDates.length - 1];

  await upsertDoc("privateStudents", IDS.student, {
    name: FIXTURE.studentName,
    teacher: FIXTURE.teacherName,
    phone: "010-0000-0000",
    carNumber: "",
    learningPurpose: "E2E baseline fixture",
    firstRegisteredAt: studentFirstRegisteredAt,
    note: "E2E baseline fixture student",
    paidLessons: 8,
    attendanceCount: 0,
  });

  await upsertDoc("groupClasses", IDS.groupClass, {
    name: FIXTURE.groupName,
    teacher: FIXTURE.teacherName,
    maxStudents: 8,
    time: FIXTURE.groupTime,
    subject: FIXTURE.groupSubject,
    weekdays: [2, 4],
  });

  await upsertDoc("studentPackages", IDS.privatePackage, {
    studentId: IDS.student,
    studentName: FIXTURE.studentName,
    teacher: FIXTURE.teacherName,
    packageType: "private",
    privatePackageMode: "countBased",
    title: FIXTURE.privatePackageTitle,
    totalCount: 8,
    usedCount: 0,
    remainingCount: 8,
    status: "active",
    registrationStartDate: privateLessonDate1,
    registrationWeeks: 0,
    weeklyFrequency: 1,
    coverageEndDate: "",
    expiresAt: privatePackageExpiresAt,
    amountPaid: 0,
    memo: "E2E baseline private package",
  });

  await upsertDoc("studentPackages", IDS.groupPackage, {
    studentId: IDS.student,
    studentName: FIXTURE.studentName,
    teacher: FIXTURE.teacherName,
    packageType: "group",
    title: FIXTURE.groupPackageTitle,
    groupClassId: IDS.groupClass,
    groupClassName: FIXTURE.groupName,
    totalCount: 8,
    usedCount: 0,
    remainingCount: 8,
    status: "active",
    registrationStartDate: groupRegistrationStartDate,
    registrationWeeks: 4,
    weeklyFrequency: 2,
    coverageEndDate: groupCoverageEndDate,
    expiresAt: groupPackageExpiresAt,
    amountPaid: 0,
    memo: "E2E baseline group package",
  });

  await upsertDoc("groupStudents", IDS.groupStudent, {
    groupClassId: IDS.groupClass,
    groupClassID: IDS.groupClass,
    classID: IDS.groupClass,
    studentId: IDS.student,
    studentName: FIXTURE.studentName,
    name: FIXTURE.studentName,
    teacher: FIXTURE.teacherName,
    packageId: IDS.groupPackage,
    packageType: "group",
    paidLessons: 8,
    attendanceCount: 0,
    startDate: groupStudentStartDate,
    status: "active",
    studentStatus: "active",
    excludedDates: [],
    breakStartDate: "",
    breakEndDate: "",
  });

  const groupLessonDocs = [
    {
      id: IDS.groupLesson1,
      date: groupLessonDates[0],
      time: FIXTURE.groupTime,
      subject: FIXTURE.groupSubject,
    },
    {
      id: IDS.groupLesson2,
      date: groupLessonDates[1],
      time: FIXTURE.groupTime,
      subject: FIXTURE.groupSubject,
    },
    {
      id: IDS.groupLesson3,
      date: groupLessonDates[2],
      time: FIXTURE.groupTime,
      subject: FIXTURE.groupSubject,
    },
    {
      id: IDS.groupLesson4,
      date: groupLessonDates[3],
      time: FIXTURE.groupTime,
      subject: FIXTURE.groupSubject,
    },
  ];

  for (const lesson of groupLessonDocs) {
    await upsertDoc("groupLessons", lesson.id, {
      groupClassId: IDS.groupClass,
      groupClassID: IDS.groupClass,
      groupClassName: FIXTURE.groupName,
      teacher: FIXTURE.teacherName,
      date: lesson.date,
      time: lesson.time,
      subject: lesson.subject,
      completed: false,
      countedStudentIDs: [],
      attendanceAppliedAt: null,
      bookingMode: "fixed",
      capacity: 8,
      bookedCount: 0,
      isBookable: false,
      generationKind: "recurring",
    });
  }

  await upsertDoc("lessons", IDS.privateLesson1, {
    studentId: IDS.student,
    studentName: FIXTURE.studentName,
    student: FIXTURE.studentName,
    teacherName: FIXTURE.teacherName,
    teacher: FIXTURE.teacherName,
    packageId: IDS.privatePackage,
    packageType: "private",
    date: privateLessonDate1,
    time: FIXTURE.privateLessonTime1,
    startAt: timestampFromYmdHm(privateLessonDate1, FIXTURE.privateLessonTime1),
    subject: FIXTURE.privateLessonSubject1,
    isDeductCancelled: false,
    deductMemo: "",
  });

  await upsertDoc("lessons", IDS.privateLesson2, {
    studentId: IDS.student,
    studentName: FIXTURE.studentName,
    student: FIXTURE.studentName,
    teacherName: FIXTURE.teacherName,
    teacher: FIXTURE.teacherName,
    packageId: IDS.privatePackage,
    packageType: "private",
    date: privateLessonDate2,
    time: FIXTURE.privateLessonTime2,
    startAt: timestampFromYmdHm(privateLessonDate2, FIXTURE.privateLessonTime2),
    subject: FIXTURE.privateLessonSubject2,
    isDeductCancelled: false,
    deductMemo: "",
  });

  await upsertDoc("creditTransactions", IDS.creditPrivateCreated, {
    studentId: IDS.student,
    studentName: FIXTURE.studentName,
    teacher: FIXTURE.teacherName,
    packageId: IDS.privatePackage,
    packageType: "private",
    packageTitle: FIXTURE.privatePackageTitle,
    groupClassName: "",
    sourceType: "package",
    sourceId: IDS.privatePackage,
    actionType: "package_created",
    deltaCount: 8,
    memo: "E2E baseline private package issued",
    actorUid: adminUid,
    actorRole: "admin",
  });

  await upsertDoc("creditTransactions", IDS.creditGroupCreated, {
    studentId: IDS.student,
    studentName: FIXTURE.studentName,
    teacher: FIXTURE.teacherName,
    packageId: IDS.groupPackage,
    packageType: "group",
    packageTitle: FIXTURE.groupPackageTitle,
    groupClassName: FIXTURE.groupName,
    sourceType: "package",
    sourceId: IDS.groupPackage,
    actionType: "package_created",
    deltaCount: 8,
    memo: "E2E baseline group package issued",
    actorUid: adminUid,
    actorRole: "admin",
  });

  console.log("");
  console.log("Fixture Summary");
  console.log(`- teacher name: ${FIXTURE.teacherName}`);
  console.log(`- student: ${FIXTURE.studentName} (${IDS.student})`);
  console.log(`- group: ${FIXTURE.groupName} (${IDS.groupClass})`);
  console.log(
    `- group lessons: ${groupLessonDocs
      .map((lesson) => `${lesson.date} ${lesson.time}`)
      .join(", ")}`
  );
  console.log(
    `- private lessons: ${privateLessonDate1} ${FIXTURE.privateLessonTime1}, ${privateLessonDate2} ${FIXTURE.privateLessonTime2}`
  );
  console.log(
    `- packages: private=${IDS.privatePackage}, group=${IDS.groupPackage}`
  );
}

run()
  .then(() => {
    process.exitCode = 0;
  })
  .catch((error) => {
    console.error("Failed to seed E2E baseline fixtures.");
    console.error(error);
    process.exitCode = 1;
  });
