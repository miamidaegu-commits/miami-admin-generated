/* eslint-disable require-jsdoc, max-len */
const {setGlobalOptions} = require("firebase-functions/v2");
const {onCall, HttpsError} = require("firebase-functions/v2/https");
const admin = require("firebase-admin");

admin.initializeApp();

setGlobalOptions({maxInstances: 10});

const OWNER_EMAIL = "miamidaegu@gmail.com";
const SCHOOL_TIME_ZONE = "Asia/Seoul";
const CANCEL_LIMIT_PER_MONTH = 2;

function normalizeString(value) {
  return String(value || "").trim();
}

function getSchoolMonth() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(new Date());
  const yearPart = parts.find((part) => part.type === "year");
  const monthPart = parts.find((part) => part.type === "month");
  const year = yearPart ? yearPart.value : "";
  const month = monthPart ? monthPart.value : "";
  return `${year}-${month}`;
}

function timestampToYmd(value) {
  if (!value) return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return value;
  }
  if (typeof value.toDate === "function") {
    const d = value.toDate();
    return formatDateToYmd(d);
  }
  if (typeof value.seconds === "number") {
    return formatDateToYmd(new Date(value.seconds * 1000));
  }
  return "";
}

function formatDateToYmd(date) {
  if (!date) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: SCHOOL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const yearPart = parts.find((part) => part.type === "year");
  const monthPart = parts.find((part) => part.type === "month");
  const dayPart = parts.find((part) => part.type === "day");
  const year = yearPart ? yearPart.value : "";
  const month = monthPart ? monthPart.value : "";
  const day = dayPart ? dayPart.value : "";
  return `${year}-${month}-${day}`;
}

function isActiveGroupStudentOnLessonDate(groupStudent, lessonDate) {
  const status = normalizeString(groupStudent.status || "active").toLowerCase();
  if (status !== "active") return false;

  const startYmd = timestampToYmd(groupStudent.startDate);
  if (startYmd && lessonDate && lessonDate < startYmd) return false;

  const studentStatus = normalizeString(groupStudent.studentStatus || "active")
      .toLowerCase();
  if (studentStatus === "onbreak") {
    const breakStart = timestampToYmd(groupStudent.breakStartDate);
    const breakEnd = timestampToYmd(groupStudent.breakEndDate);
    if (breakStart && breakEnd && breakStart <= lessonDate &&
      lessonDate <= breakEnd) {
      return false;
    }
  }

  const excludedDates = Array.isArray(groupStudent.excludedDates) ?
    groupStudent.excludedDates.map((value) => normalizeString(value)) :
    [];
  return !excludedDates.includes(lessonDate);
}

async function loadCallerContext(request) {
  if (!request.auth) {
    throw new HttpsError("unauthenticated", "Login required.");
  }

  const uid = request.auth.uid;
  const userSnap = await admin.firestore().collection("users").doc(uid).get();
  if (!userSnap.exists) {
    throw new HttpsError("permission-denied", "User profile not found.");
  }

  const user = userSnap.data() || {};
  if (user.isActive !== true) {
    throw new HttpsError("permission-denied", "Inactive user.");
  }

  const role = normalizeString(user.role);
  const academyId = normalizeString(user.academyId);
  if (!academyId) {
    throw new HttpsError("failed-precondition", "academyId is required.");
  }

  return {
    uid,
    role,
    academyId,
    studentId: normalizeString(user.studentId),
    studentName: normalizeString(user.studentName || user.displayName),
  };
}

function assertAdminOrStudent(caller) {
  if (caller.role !== "admin" && caller.role !== "student") {
    throw new HttpsError("permission-denied", "Admin or student only.");
  }
}

function resolveStudentForBooking(caller, data) {
  assertAdminOrStudent(caller);
  if (caller.role === "student") {
    if (!caller.studentId) {
      throw new HttpsError("failed-precondition", "Student profile is missing.");
    }
    return {
      studentId: caller.studentId,
      studentName: caller.studentName,
      countCancelUsage: true,
    };
  }

  const studentId = normalizeString(data.studentId);
  if (!studentId) {
    throw new HttpsError("invalid-argument", "studentId is required.");
  }
  return {
    studentId,
    studentName: normalizeString(data.studentName),
    countCancelUsage: data.asStudent === true,
  };
}

function reservationDocId(lessonId, studentId) {
  return `${lessonId}_${studentId}`;
}

function usageDocId(academyId, studentId, month) {
  return `${academyId}__${studentId}__${month}`;
}

async function getFixedStudentCount(transaction, db, {
  academyId,
  groupClassId,
  lessonDate,
}) {
  const snap = await transaction.get(
      db.collection("groupStudents")
          .where("academyId", "==", academyId)
          .where("groupClassId", "==", groupClassId)
          .where("status", "==", "active"),
  );
  let count = 0;
  snap.docs.forEach((docSnap) => {
    if (isActiveGroupStudentOnLessonDate(docSnap.data() || {}, lessonDate)) {
      count += 1;
    }
  });
  return count;
}

async function getActiveReservations(transaction, db, academyId, lessonId) {
  const snap = await transaction.get(
      db.collection("groupLessonReservations")
          .where("academyId", "==", academyId)
          .where("lessonId", "==", lessonId)
          .where("status", "==", "active"),
  );
  return snap.docs;
}

async function getStudentName(db, academyId, studentId, fallback) {
  const studentSnap = await db.collection("privateStudents").doc(studentId).get();
  const data = studentSnap.exists ? studentSnap.data() || {} : {};
  if (normalizeString(data.academyId) === academyId) {
    return normalizeString(data.name || data.studentName) || fallback || "-";
  }
  return fallback || "-";
}

exports.bootstrapAdmin = onCall(
    {region: "us-central1", cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login required.");
      }

      const callerUid = request.auth.uid;
      const callerEmail = request.auth.token.email || "";

      if (callerEmail !== OWNER_EMAIL) {
        throw new HttpsError("permission-denied", "Not allowed.");
      }

      await admin.auth().setCustomUserClaims(callerUid, {
        role: "admin",
      });

      await admin.firestore().collection("users").doc(callerUid).set(
          {
            email: callerEmail,
            role: "admin",
            isActive: true,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
      );

      return {
        success: true,
        message: "You are now admin. Please refresh your token.",
      };
    },
);

exports.setUserRole = onCall(
    {region: "us-central1", cors: true},
    async (request) => {
      if (!request.auth) {
        throw new HttpsError("unauthenticated", "Login required.");
      }

      const callerUid = request.auth.uid;
      const caller = await admin.auth().getUser(callerUid);
      const callerRole = caller.customClaims ? caller.customClaims.role : null;
      if (callerRole !== "admin") {
        throw new HttpsError("permission-denied", "Admins only.");
      }

      const {
        uid,
        role,
        academyId,
        teacherName,
        studentId,
        studentName,
        isActive,
      } = request.data || {};

      if (!uid || !role) {
        throw new HttpsError("invalid-argument", "uid and role are required.");
      }

      if (!["admin", "teacher", "student"].includes(role)) {
        throw new HttpsError(
            "invalid-argument",
            "role must be admin, teacher, or student.",
        );
      }

      await admin.auth().setCustomUserClaims(uid, {role, academyId: academyId || null});

      await admin.firestore().collection("users").doc(uid).set(
          {
            role,
            academyId: academyId || null,
            teacherName: teacherName || null,
            studentId: studentId || null,
            studentName: studentName || null,
            isActive: isActive !== false,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          },
          {merge: true},
      );

      return {
        success: true,
        message: `Role ${role} set for ${uid}`,
      };
    },
);

exports.reserveGroupLesson = onCall(
    {region: "us-central1", cors: true},
    async (request) => {
      const caller = await loadCallerContext(request);
      const db = admin.firestore();
      const data = request.data || {};
      const lessonId = normalizeString(data.lessonId);
      if (!lessonId) {
        throw new HttpsError("invalid-argument", "lessonId is required.");
      }

      const student = resolveStudentForBooking(caller, data);
      const studentName = await getStudentName(
          db,
          caller.academyId,
          student.studentId,
          student.studentName,
      );
      const reservationId = reservationDocId(lessonId, student.studentId);

      return db.runTransaction(async (transaction) => {
        const lessonRef = db.collection("groupLessons").doc(lessonId);
        const reservationRef =
          db.collection("groupLessonReservations").doc(reservationId);
        const lessonSnap = await transaction.get(lessonRef);
        if (!lessonSnap.exists) {
          throw new HttpsError("not-found", "수업을 찾을 수 없습니다.");
        }

        const lesson = lessonSnap.data() || {};
        if (normalizeString(lesson.academyId) !== caller.academyId) {
          throw new HttpsError("permission-denied", "다른 academy 수업입니다.");
        }
        if (lesson.isBookable !== true) {
          throw new HttpsError("failed-precondition", "예약 가능한 수업이 아닙니다.");
        }

        const groupClassId = normalizeString(lesson.groupClassId ||
          lesson.groupClassID);
        const lessonDate = normalizeString(lesson.date);
        const capacity = Number(lesson.capacity || 0);
        if (!Number.isFinite(capacity) || capacity <= 0) {
          throw new HttpsError("failed-precondition", "정원이 설정되지 않았습니다.");
        }

        const fixedSnap = await transaction.get(
            db.collection("groupStudents")
                .where("academyId", "==", caller.academyId)
                .where("groupClassId", "==", groupClassId)
                .where("studentId", "==", student.studentId)
                .where("status", "==", "active"),
        );
        const fixedAlreadyParticipates = fixedSnap.docs.some((docSnap) =>
          isActiveGroupStudentOnLessonDate(docSnap.data() || {}, lessonDate));
        if (fixedAlreadyParticipates) {
          throw new HttpsError(
              "already-exists",
              "이미 고정 등록으로 참여하는 수업입니다.",
          );
        }

        const reservationSnap = await transaction.get(reservationRef);
        if (reservationSnap.exists &&
          (reservationSnap.data() || {}).status === "active") {
          throw new HttpsError("already-exists", "이미 예약한 수업입니다.");
        }

        const fixedCount = await getFixedStudentCount(transaction, db, {
          academyId: caller.academyId,
          groupClassId,
          lessonDate,
        });
        const activeReservationDocs = await getActiveReservations(
            transaction,
            db,
            caller.academyId,
            lessonId,
        );
        const remaining = capacity - fixedCount - activeReservationDocs.length;
        if (remaining <= 0) {
          transaction.update(lessonRef, {
            bookedCount: activeReservationDocs.length,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          });
          throw new HttpsError("resource-exhausted", "정원이 마감되었습니다.");
        }

        transaction.set(reservationRef, {
          academyId: caller.academyId,
          lessonId,
          groupClassId,
          studentId: student.studentId,
          studentName,
          status: "active",
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledAt: null,
          cancelledByUid: "",
          cancelMonth: "",
          createdByUid: caller.uid,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        }, {merge: true});
        transaction.update(lessonRef, {
          bookedCount: activeReservationDocs.length + 1,
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          reservationId,
          lessonId,
          remainingSeats: remaining - 1,
        };
      });
    },
);

exports.cancelGroupLessonReservation = onCall(
    {region: "us-central1", cors: true},
    async (request) => {
      const caller = await loadCallerContext(request);
      const db = admin.firestore();
      const data = request.data || {};
      const lessonId = normalizeString(data.lessonId);
      const requestedReservationId = normalizeString(data.reservationId);
      const student = resolveStudentForBooking(caller, data);
      const reservationId = requestedReservationId ||
        reservationDocId(lessonId, student.studentId);
      if (!reservationId) {
        throw new HttpsError("invalid-argument", "reservationId is required.");
      }

      const month = getSchoolMonth();
      const countCancelUsage = caller.role === "student" ||
        student.countCancelUsage;

      return db.runTransaction(async (transaction) => {
        const reservationRef =
          db.collection("groupLessonReservations").doc(reservationId);
        const reservationSnap = await transaction.get(reservationRef);
        if (!reservationSnap.exists) {
          throw new HttpsError("not-found", "예약을 찾을 수 없습니다.");
        }
        const reservation = reservationSnap.data() || {};
        if (normalizeString(reservation.academyId) !== caller.academyId) {
          throw new HttpsError("permission-denied", "다른 academy 예약입니다.");
        }
        if (caller.role === "student" &&
          normalizeString(reservation.studentId) !== caller.studentId) {
          throw new HttpsError("permission-denied", "본인 예약만 취소할 수 있습니다.");
        }
        if (normalizeString(reservation.studentId) !== student.studentId) {
          throw new HttpsError("permission-denied", "학생 정보가 일치하지 않습니다.");
        }
        if (reservation.status !== "active") {
          throw new HttpsError("failed-precondition", "이미 취소된 예약입니다.");
        }

        const reservationLessonId = normalizeString(reservation.lessonId);
        const lessonRef = db.collection("groupLessons").doc(reservationLessonId);
        const activeReservationDocs = await getActiveReservations(
            transaction,
            db,
            caller.academyId,
            reservationLessonId,
        );

        if (countCancelUsage) {
          const usageRef = db.collection("groupLessonCancelUsage").doc(
              usageDocId(caller.academyId, student.studentId, month),
          );
          const usageSnap = await transaction.get(usageRef);
          const currentCount = usageSnap.exists ?
            Number((usageSnap.data() || {}).count || 0) :
            0;
          if (currentCount >= CANCEL_LIMIT_PER_MONTH) {
            throw new HttpsError(
                "resource-exhausted",
                "이번 달 예약 취소 가능 횟수 2회를 모두 사용했습니다.",
            );
          }
          transaction.set(usageRef, {
            academyId: caller.academyId,
            studentId: student.studentId,
            month,
            count: currentCount + 1,
            updatedAt: admin.firestore.FieldValue.serverTimestamp(),
          }, {merge: true});
        }

        transaction.update(reservationRef, {
          status: "cancelled",
          cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
          cancelledByUid: caller.uid,
          cancelMonth: countCancelUsage ? month : "",
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        transaction.update(lessonRef, {
          bookedCount: Math.max(0, activeReservationDocs.length - 1),
          updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        });

        return {
          reservationId,
          lessonId: reservationLessonId,
          cancelMonth: countCancelUsage ? month : "",
        };
      });
    },
);

exports.listBookableGroupLessons = onCall(
    {region: "us-central1", cors: true},
    async (request) => {
      const caller = await loadCallerContext(request);
      assertAdminOrStudent(caller);
      const data = request.data || {};
      const student = resolveStudentForBooking(caller, data);
      const db = admin.firestore();
      const today = formatDateToYmd(new Date());

      const lessonsSnap = await db.collection("groupLessons")
          .where("academyId", "==", caller.academyId)
          .where("isBookable", "==", true)
          .get();
      const ownReservationsSnap = await db.collection("groupLessonReservations")
          .where("academyId", "==", caller.academyId)
          .where("studentId", "==", student.studentId)
          .get();
      const ownReservationsByLesson = new Map();
      ownReservationsSnap.docs.forEach((docSnap) => {
        const row = docSnap.data() || {};
        ownReservationsByLesson.set(normalizeString(row.lessonId), {
          id: docSnap.id,
          ...row,
        });
      });

      const rows = [];
      for (const lessonDoc of lessonsSnap.docs) {
        const lesson = lessonDoc.data() || {};
        const lessonDate = normalizeString(lesson.date);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(lessonDate) || lessonDate < today) {
          continue;
        }
        const groupClassId = normalizeString(lesson.groupClassId ||
          lesson.groupClassID);
        const capacity = Number(lesson.capacity || 0);
        if (!Number.isFinite(capacity) || capacity <= 0) continue;

        const [fixedSnap, activeReservationsSnap] = await Promise.all([
          db.collection("groupStudents")
              .where("academyId", "==", caller.academyId)
              .where("groupClassId", "==", groupClassId)
              .where("status", "==", "active")
              .get(),
          db.collection("groupLessonReservations")
              .where("academyId", "==", caller.academyId)
              .where("lessonId", "==", lessonDoc.id)
              .where("status", "==", "active")
              .get(),
        ]);

        let fixedCount = 0;
        let fixedSelf = false;
        fixedSnap.docs.forEach((docSnap) => {
          const row = docSnap.data() || {};
          if (!isActiveGroupStudentOnLessonDate(row, lessonDate)) return;
          fixedCount += 1;
          if (normalizeString(row.studentId) === student.studentId) {
            fixedSelf = true;
          }
        });

        const activeReservationCount = activeReservationsSnap.size;
        const remainingSeats = Math.max(
            0,
            capacity - fixedCount - activeReservationCount,
        );
        const ownReservation = ownReservationsByLesson.get(lessonDoc.id) || null;
        const ownActiveReservation =
          ownReservation && ownReservation.status === "active" ?
            ownReservation :
            null;

        rows.push({
          id: lessonDoc.id,
          groupClassId,
          groupClassName: normalizeString(lesson.groupClassName),
          date: lessonDate,
          time: normalizeString(lesson.time),
          subject: normalizeString(lesson.subject),
          capacity,
          fixedCount,
          bookedCount: activeReservationCount,
          remainingSeats,
          isFull: remainingSeats <= 0,
          fixedSelf,
          ownReservationId: ownActiveReservation ? ownActiveReservation.id : "",
          ownReservationStatus: ownReservation ? ownReservation.status : "",
        });
      }

      rows.sort((a, b) => `${a.date} ${a.time}`.localeCompare(
          `${b.date} ${b.time}`,
      ));

      return {lessons: rows.slice(0, 100)};
    },
);
