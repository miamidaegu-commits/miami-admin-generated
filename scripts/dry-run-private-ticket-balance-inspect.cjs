#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const admin = require("firebase-admin");

function parseArgs(argv) {
  const out = {
    serviceAccount: path.join(__dirname, "..", "serviceAccountKey.json"),
    project: "",
    academyId: "",
    studentName: "",
    teacher: "",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") continue;
    if (arg.startsWith("--service-account=")) {
      out.serviceAccount = path.resolve(arg.slice("--service-account=".length));
      continue;
    }
    if (arg.startsWith("--project=")) {
      out.project = arg.slice("--project=".length).trim();
      continue;
    }
    if (arg === "--project") {
      out.project = normalizeId(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--academyId=")) {
      out.academyId = arg.slice("--academyId=".length).trim();
      continue;
    }
    if (arg === "--academyId") {
      out.academyId = normalizeId(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--academy-id=")) {
      out.academyId = arg.slice("--academy-id=".length).trim();
      continue;
    }
    if (arg === "--academy-id") {
      out.academyId = normalizeId(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--studentName=")) {
      out.studentName = arg.slice("--studentName=".length).trim();
      continue;
    }
    if (arg === "--studentName") {
      out.studentName = normalizeId(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith("--teacher=")) {
      out.teacher = arg.slice("--teacher=".length).trim();
      continue;
    }
    if (arg === "--teacher") {
      out.teacher = normalizeId(argv[index + 1]);
      index += 1;
    }
  }
  return out;
}

function normalizeId(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeId(value).toLowerCase();
}

function normalizeCount(value) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) ? Math.max(0, count) : 0;
}

function normalizeIdList(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  value.forEach((item) => {
    const id = normalizeId(item);
    if (!id || seen.has(id)) return;
    seen.add(id);
    out.push(id);
  });
  return out;
}

function getPrivateTeacherScopeKeys(...rows) {
  const stableUidKeys = [];
  const stableTeacherKeys = [];
  const displayKeys = [];
  rows.forEach((row) => {
    if (!row) return;
    [row.teacherUid, row.teacherUID, row.teacherId, row.teacherID].forEach((value) => {
      const key = normalizeKey(value);
      if (key) stableUidKeys.push(key);
    });
    [row.teacherKey].forEach((value) => {
      const key = normalizeKey(value);
      if (key) stableTeacherKeys.push(key);
    });
    [row.teacher, row.teacherName, row.displayName, row.name].forEach((value) => {
      const key = normalizeKey(value);
      if (key) displayKeys.push(key);
    });
  });
  const seen = new Set();
  const out = [];
  [...stableUidKeys, ...stableTeacherKeys, ...displayKeys].forEach((key) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(key);
  });
  return out;
}

function getKstTodayString(now = Date.now()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function getKstDateTimeMillis(dateValue, timeValue) {
  const date = normalizeId(dateValue);
  const time = normalizeId(timeValue || "23:59");
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;
  return Date.UTC(
      Number(dateMatch[1]),
      Number(dateMatch[2]) - 1,
      Number(dateMatch[3]),
      Number(timeMatch[1]) - 9,
      Number(timeMatch[2]),
      0,
      0,
  );
}

function getRowDate(row) {
  return normalizeId(row?.date || row?.lessonDate || row?.scheduleDate);
}

function getRowStartMillis(row) {
  const value = row?.startAt || row?.startsAt;
  if (value && typeof value.toMillis === "function") return value.toMillis();
  if (value && typeof value.toDate === "function") return value.toDate().getTime();
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return getKstDateTimeMillis(getRowDate(row), row?.time || row?.startTime || row?.scheduleTime);
}

function isFutureAllocation(row, now) {
  const startMillis = getRowStartMillis(row);
  if (startMillis !== null && Number.isFinite(startMillis)) return startMillis >= now;
  const date = getRowDate(row);
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= getKstTodayString(now);
}

function isActivePrivateReservationStatus(status) {
  return ["active", "reserved", "confirmed", "booked"].includes(
      normalizeId(status).toLowerCase(),
  );
}

function isPrivateLessonReleasedFromDeduction(lesson) {
  const status = normalizeId(lesson?.status).toLowerCase();
  const cancellationType = normalizeId(lesson?.cancellationType).toLowerCase();
  const cancelledReason = normalizeId(lesson?.cancelledReason).toLowerCase();
  if (lesson?.isDeductCancelled === true) return true;
  if (lesson?.noDeduction === true) return true;
  if (status === "cancelled" || status === "canceled") return true;
  if (cancellationType === "no_deduction") return true;
  if (cancellationType === "class_closure") return true;
  return ["holiday", "teacher_unavailable", "academy_closed"].includes(cancelledReason);
}

function privateRowMatchesTicketScope({
  row,
  ticket,
  academyId,
  studentId,
  teacherScope,
  packageIdFields = ["packageId"],
}) {
  if (normalizeId(row?.academyId) !== normalizeId(academyId)) return false;
  const rowStudentId = normalizeId(row?.studentId || row?.studentID);
  if (rowStudentId !== normalizeId(studentId)) return false;
  const ticketId = normalizeId(ticket?.id);
  const rowPackageIds = packageIdFields.map((key) => normalizeId(row?.[key])).filter(Boolean);
  if (rowPackageIds.length > 0) {
    if (ticketId && rowPackageIds.includes(ticketId)) return true;
  }
  const ticketKeys = getPrivateTeacherScopeKeys(ticket);
  const rowKeys = getPrivateTeacherScopeKeys(row);
  if (ticketKeys.length === 0) return false;
  if (rowKeys.length > 0) return rowKeys.some((key) => ticketKeys.includes(key));
  if (rowPackageIds.length > 0) return false;
  const requestedKeys = [
    teacherScope?.teacherUid,
    teacherScope?.teacherUID,
    teacherScope?.teacherId,
    teacherScope?.teacherID,
    teacherScope?.teacherKey,
    teacherScope?.teacher,
    teacherScope?.teacherName,
    teacherScope?.displayName,
    teacherScope?.name,
  ]
      .map(normalizeKey)
      .filter(Boolean);
  return requestedKeys.some((key) => ticketKeys.includes(key));
}

function explainScopeMatch({
  row,
  ticket,
  academyId,
  studentId,
  teacherScope,
  packageIdFields = ["packageId"],
}) {
  const reasons = [];
  const rowAcademyId = normalizeId(row?.academyId);
  const targetAcademyId = normalizeId(academyId);
  if (rowAcademyId !== targetAcademyId) {
    return {
      matched: false,
      matchedPackageIds: [],
      matchedTeacherReason: "",
      excludeReason: `academyId mismatch row=${rowAcademyId || "(missing)"} expected=${targetAcademyId}`,
    };
  }
  const rowStudentId = normalizeId(row?.studentId || row?.studentID);
  const targetStudentId = normalizeId(studentId);
  if (rowStudentId !== targetStudentId) {
    return {
      matched: false,
      matchedPackageIds: [],
      matchedTeacherReason: "",
      excludeReason: `studentId mismatch row=${rowStudentId || "(missing)"} expected=${targetStudentId}`,
    };
  }
  const ticketId = normalizeId(ticket?.id);
  const rowPackageIds = packageIdFields.map((key) => normalizeId(row?.[key])).filter(Boolean);
  const matchedPackageIds = ticketId ?
    rowPackageIds.filter((id) => id === ticketId) :
    [];
  if (matchedPackageIds.length > 0) {
    return {
      matched: true,
      matchedPackageIds,
      matchedTeacherReason: `packageId match ${matchedPackageIds.join(",")}`,
      excludeReason: "",
    };
  }
  const ticketKeys = getPrivateTeacherScopeKeys(ticket);
  const rowKeys = getPrivateTeacherScopeKeys(row);
  const overlappingKeys = rowKeys.filter((key) => ticketKeys.includes(key));
  if (ticketKeys.length === 0) {
    return {
      matched: false,
      matchedPackageIds,
      matchedTeacherReason: "",
      excludeReason: "package has no teacher scope keys",
    };
  }
  if (rowKeys.length > 0 && overlappingKeys.length > 0) {
    return {
      matched: true,
      matchedPackageIds,
      matchedTeacherReason: `teacher scope overlap ${overlappingKeys.join(",")}`,
      excludeReason: "",
    };
  }
  if (rowPackageIds.length > 0 && rowKeys.length === 0) {
    return {
      matched: false,
      matchedPackageIds,
      matchedTeacherReason: "",
      excludeReason: `packageId mismatch (${rowPackageIds.join(",")}) and row has no teacher keys`,
    };
  }
  if (rowPackageIds.length > 0) {
    return {
      matched: false,
      matchedPackageIds,
      matchedTeacherReason: "",
      excludeReason: `packageId mismatch (${rowPackageIds.join(",")}) and teacher keys do not overlap row=[${rowKeys.join(",")}] package=[${ticketKeys.join(",")}]`,
    };
  }
  const requestedKeys = [
    teacherScope?.teacherUid,
    teacherScope?.teacherUID,
    teacherScope?.teacherId,
    teacherScope?.teacherID,
    teacherScope?.teacherKey,
    teacherScope?.teacher,
    teacherScope?.teacherName,
    teacherScope?.displayName,
    teacherScope?.name,
  ]
      .map(normalizeKey)
      .filter(Boolean);
  const requestedOverlap = requestedKeys.filter((key) => ticketKeys.includes(key));
  if (requestedOverlap.length > 0) {
    return {
      matched: true,
      matchedPackageIds,
      matchedTeacherReason: `teacherScope fallback overlap ${requestedOverlap.join(",")}`,
      excludeReason: "",
    };
  }
  return {
    matched: false,
    matchedPackageIds,
    matchedTeacherReason: "",
    excludeReason: rowKeys.length === 0 ?
      `row has no teacher keys and teacherScope fallback failed requested=[${requestedKeys.join(",")}] package=[${ticketKeys.join(",")}]` :
      `teacher keys do not overlap row=[${rowKeys.join(",")}] package=[${ticketKeys.join(",")}]`,
  };
}

function formatPrivateTicketScheduleSummary(balance) {
  const fixedAllocated = Math.max(0, Number(balance.futureFixedAllocatedCount) || 0);
  const activeReservations = Math.max(0, Number(balance.activeFutureReservationCount) || 0);
  const releasedCount = Math.max(0, Number(balance.noDeductionReleasedCount) || 0);
  const makeupAvailable = Math.max(0, Number(balance.makeupAvailableCount) || 0);
  const parts = [`고정 예정 ${fixedAllocated}회`];
  if (activeReservations > 0) parts.push(`보충 예약 ${activeReservations}회`);
  const availableLabel = releasedCount > activeReservations ? "보충 가능" : "예약 가능";
  parts.push(`${availableLabel} ${makeupAvailable}회`);
  return parts.join(" · ");
}

function computePrivateTicketBalance({
  ticket,
  fixedPrivateLessons = [],
  privateReservations = [],
  studentId,
  teacherScope = {},
  academyId = ticket?.academyId,
  now = Date.now(),
}) {
  const totalCount = normalizeCount(ticket.totalCount);
  const usedCount = normalizeCount(ticket.usedCount);
  const remainingCount = normalizeCount(ticket.remainingCount);
  const rawAvailableCount =
    totalCount > 0 ? Math.min(remainingCount, Math.max(0, totalCount - usedCount)) : remainingCount;

  let futureFixedAllocatedCount = 0;
  let noDeductionReleasedCount = 0;
  fixedPrivateLessons.forEach((lesson) => {
    if (!privateRowMatchesTicketScope({
      row: lesson,
      ticket,
      academyId,
      studentId,
      teacherScope,
    })) return;
    if (isPrivateLessonReleasedFromDeduction(lesson)) {
      noDeductionReleasedCount += 1;
      return;
    }
    if (isFutureAllocation(lesson, now)) futureFixedAllocatedCount += 1;
  });

  let activeFutureReservationCount = 0;
  privateReservations.forEach((reservation) => {
    if (!isActivePrivateReservationStatus(reservation?.status)) return;
    if (!privateRowMatchesTicketScope({
      row: reservation,
      ticket,
      academyId,
      studentId,
      teacherScope,
      packageIdFields: ["packageId", "deductionPackageId"],
    })) return;
    activeFutureReservationCount += 1;
  });

  const availableToBook = Math.max(
      0,
      rawAvailableCount - futureFixedAllocatedCount - activeFutureReservationCount,
  );

  return {
    totalCount,
    usedCount,
    remainingCount,
    futureFixedAllocatedCount,
    activeFutureReservationCount,
    activeReservationCount: activeFutureReservationCount,
    noDeductionReleasedCount,
    releasedFixedCount: noDeductionReleasedCount,
    makeupReservationCount: activeFutureReservationCount,
    availableToBook,
    makeupAvailableCount: availableToBook,
    scheduleSummary: formatPrivateTicketScheduleSummary({
      futureFixedAllocatedCount,
      activeFutureReservationCount,
      noDeductionReleasedCount,
      makeupAvailableCount: availableToBook,
    }),
  };
}

function serializeTimestamp(value) {
  if (!value) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.toDate === "function") return value.toDate().toISOString();
  if (value instanceof Date) return value.toISOString();
  return value;
}

function pickFields(row, keys) {
  const out = {};
  keys.forEach((key) => {
    out[key] = row?.[key] ?? null;
  });
  return out;
}

function isPrivateLessonRow(row) {
  const groupClassId = normalizeId(row?.groupClassId || row?.groupClassID || row?.classID);
  if (groupClassId) return false;
  const packageType = normalizeKey(row?.packageType || row?.lessonType);
  const billingType = normalizeKey(row?.billingType);
  if (packageType === "private" || billingType === "private") return true;
  return Boolean(normalizeId(row?.studentId || row?.studentID) &&
    normalizeId(row?.teacher || row?.teacherName));
}

function studentDisplayName(row) {
  return normalizeId(row?.name || row?.studentName || row?.displayName);
}

function matchesStudentName(row, targetName) {
  return studentDisplayName(row) === normalizeId(targetName);
}

function matchesTeacherFilter(row, teacherFilter) {
  if (!teacherFilter) return true;
  const keys = getPrivateTeacherScopeKeys(row);
  const filterKey = normalizeKey(teacherFilter);
  return keys.includes(filterKey);
}

async function findStudents(db, {academyId, studentName, teacher}) {
  let snap;
  if (academyId) {
    snap = await db.collection("privateStudents").where("academyId", "==", academyId).get();
  } else {
    snap = await db.collection("privateStudents").get();
  }
  const matches = snap.docs
      .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}))
      .filter((row) => matchesStudentName(row, studentName))
      .filter((row) => matchesTeacherFilter(row, teacher));
  return matches;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.project) {
    throw new Error("--project is required");
  }
  if (!args.studentName) {
    throw new Error("--studentName is required");
  }

  const defaultServiceAccount = path.join(__dirname, "..", "serviceAccountKey.json");
  const productionServiceAccount = path.join(__dirname, "..", "serviceAccountKey.prod.json");
  if (
    args.project === "daegu-miami-production" &&
    args.serviceAccount === defaultServiceAccount &&
    fs.existsSync(productionServiceAccount)
  ) {
    args.serviceAccount = productionServiceAccount;
  }

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(require(args.serviceAccount)),
      projectId: args.project,
    });
  }
  const db = admin.firestore();
  const now = Date.now();

  const students = await findStudents(db, args);
  if (students.length === 0) {
    throw new Error(`No privateStudents matched studentName=${args.studentName} teacher=${args.teacher || "(any)"}`);
  }
  if (students.length > 1) {
    console.log(JSON.stringify({
      readOnly: true,
      error: "multiple students matched; provide exact studentName/academyId/teacher",
      matches: students.map((row) => ({
        id: row.id,
        name: studentDisplayName(row),
        academyId: normalizeId(row.academyId),
        teacher: normalizeId(row.teacher || row.teacherName),
        teacherKey: normalizeId(row.teacherKey),
        teacherUid: normalizeId(row.teacherUid || row.teacherUID),
      })),
    }, null, 2));
    process.exitCode = 2;
    return;
  }

  const student = students[0];
  const studentId = student.id;
  const academyId = normalizeId(args.academyId || student.academyId);
  if (!academyId) {
    throw new Error("academyId could not be resolved");
  }

  const [packageSnap, lessonSnap, reservationSnap] = await Promise.all([
    db.collection("studentPackages")
        .where("academyId", "==", academyId)
        .where("studentId", "==", studentId)
        .get(),
    db.collection("lessons")
        .where("academyId", "==", academyId)
        .where("studentId", "==", studentId)
        .get(),
    db.collection("privateLessonReservations")
        .where("academyId", "==", academyId)
        .where("studentId", "==", studentId)
        .get(),
  ]);

  const packages = packageSnap.docs
      .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}))
      .filter((pkg) => normalizeKey(pkg.packageType || "private") === "private");

  const lessons = lessonSnap.docs
      .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}))
      .filter(isPrivateLessonRow);

  const reservations = reservationSnap.docs
      .map((docSnap) => ({id: docSnap.id, ...docSnap.data()}));

  const slotIds = [...new Set(reservations.map((row) => normalizeId(row.slotId)).filter(Boolean))];
  const slotSnaps = await Promise.all(
      slotIds.map((slotId) => db.collection("privateLessonSlots").doc(slotId).get()),
  );
  const slotsById = new Map();
  slotSnaps.forEach((snap) => {
    if (snap.exists) slotsById.set(snap.id, {id: snap.id, ...snap.data()});
  });

  const packageReports = packages.map((pkg) => {
    const teacherScope = {
      teacher: pkg.teacher || pkg.teacherName,
      teacherKey: pkg.teacherKey,
      teacherUid: pkg.teacherUid,
      teacherUID: pkg.teacherUID,
      teacherId: pkg.teacherId,
    };
    const balance = computePrivateTicketBalance({
      ticket: pkg,
      fixedPrivateLessons: lessons,
      privateReservations: reservations,
      studentId,
      teacherScope,
      academyId,
      now,
    });
    return {
      packageId: pkg.id,
      ...balance,
      scheduleSummaryExpected: balance.scheduleSummary,
    };
  });

  const lessonReports = lessons.map((lesson) => {
    const perPackage = packages.map((pkg) => {
      const teacherScope = {
        teacher: pkg.teacher || pkg.teacherName,
        teacherKey: pkg.teacherKey,
        teacherUid: pkg.teacherUid,
        teacherUID: pkg.teacherUID,
        teacherId: pkg.teacherId,
      };
      const scope = explainScopeMatch({
        row: lesson,
        ticket: pkg,
        academyId,
        studentId,
        teacherScope,
      });
      let includedInFutureFixedAllocatedCount = false;
      let excludeReason = scope.excludeReason;
      if (!scope.matched) {
        includedInFutureFixedAllocatedCount = false;
      } else if (isPrivateLessonReleasedFromDeduction(lesson)) {
        includedInFutureFixedAllocatedCount = false;
        excludeReason = "released from deduction";
      } else if (!isFutureAllocation(lesson, now)) {
        includedInFutureFixedAllocatedCount = false;
        excludeReason = `not future startAt=${serializeTimestamp(lesson.startAt || lesson.startsAt)} date=${getRowDate(lesson)} time=${normalizeId(lesson.time || lesson.startTime)} now=${new Date(now).toISOString()}`;
      } else {
        includedInFutureFixedAllocatedCount = true;
        excludeReason = "";
      }
      return {
        packageId: pkg.id,
        scopeMatched: scope.matched,
        matchedPackageIds: scope.matchedPackageIds,
        matchedTeacherReason: scope.matchedTeacherReason,
        includedInFutureFixedAllocatedCount,
        excludeReason,
      };
    });
    const primary = perPackage.find((row) => row.includedInFutureFixedAllocatedCount) ||
      perPackage.find((row) => row.scopeMatched) ||
      perPackage[0] ||
      null;
    return {
      id: lesson.id,
      ...pickFields(lesson, [
        "date", "time", "startAt", "studentId", "studentID", "studentName", "student",
        "packageId", "packageType", "teacherUid", "teacherUID", "teacherId", "teacherKey",
        "teacherName", "teacher", "status", "isDeductCancelled", "noDeduction",
        "cancellationType", "cancelledReason", "academyId",
      ]),
      startAt: serializeTimestamp(lesson.startAt || lesson.startsAt),
      includedInFutureFixedAllocatedCount: Boolean(primary?.includedInFutureFixedAllocatedCount),
      excludeReason: primary?.excludeReason || "",
      matchedPackageIds: primary?.matchedPackageIds || [],
      matchedTeacherReason: primary?.matchedTeacherReason || "",
      perPackage,
    };
  });

  const reservationReports = reservations.map((reservation) => {
    const slot = slotsById.get(normalizeId(reservation.slotId)) || null;
    const perPackage = packages.map((pkg) => {
      const teacherScope = {
        teacher: pkg.teacher || pkg.teacherName,
        teacherKey: pkg.teacherKey,
        teacherUid: pkg.teacherUid,
        teacherUID: pkg.teacherUID,
        teacherId: pkg.teacherId,
      };
      const scope = explainScopeMatch({
        row: reservation,
        ticket: pkg,
        academyId,
        studentId,
        teacherScope,
        packageIdFields: ["packageId", "deductionPackageId"],
      });
      let includedInActiveReservationCount = false;
      let excludeReason = scope.excludeReason;
      if (!isActivePrivateReservationStatus(reservation?.status)) {
        includedInActiveReservationCount = false;
        excludeReason = `status not active (${normalizeId(reservation?.status) || "(missing)"})`;
      } else if (!scope.matched) {
        includedInActiveReservationCount = false;
      } else {
        includedInActiveReservationCount = true;
        excludeReason = "";
      }
      return {
        packageId: pkg.id,
        scopeMatched: scope.matched,
        matchedPackageIds: scope.matchedPackageIds,
        matchedTeacherReason: scope.matchedTeacherReason,
        includedInActiveReservationCount,
        excludeReason,
      };
    });
    const primary = perPackage.find((row) => row.includedInActiveReservationCount) ||
      perPackage.find((row) => row.scopeMatched) ||
      perPackage[0] ||
      null;
    return {
      id: reservation.id,
      ...pickFields(reservation, [
        "date", "time", "startAt", "slotId", "status", "studentId", "studentID", "studentName",
        "packageId", "deductionPackageId", "teacherUid", "teacherUID", "teacherId", "teacherKey",
        "teacherName", "teacher", "createdAt", "updatedAt", "cancelledAt", "academyId",
      ]),
      startAt: serializeTimestamp(reservation.startAt || reservation.startsAt),
      createdAt: serializeTimestamp(reservation.createdAt),
      updatedAt: serializeTimestamp(reservation.updatedAt),
      cancelledAt: serializeTimestamp(reservation.cancelledAt),
      includedInActiveReservationCount: Boolean(primary?.includedInActiveReservationCount),
      excludeReason: primary?.excludeReason || "",
      matchedPackageIds: primary?.matchedPackageIds || [],
      matchedTeacherReason: primary?.matchedTeacherReason || "",
      slotTeacherFields: slot ?
        pickFields(slot, [
          "date", "time", "teacherUid", "teacherUID", "teacherId", "teacherKey",
          "teacherName", "teacher", "status", "academyId",
        ]) :
        null,
      perPackage,
    };
  });

  const slotReports = slotIds.map((slotId) => {
    const slot = slotsById.get(slotId);
    if (!slot) return {id: slotId, missing: true};
    return {
      id: slot.id,
      ...pickFields(slot, [
        "date", "time", "teacherUid", "teacherUID", "teacherId", "teacherKey",
        "teacherName", "teacher", "status", "academyId",
      ]),
    };
  });

  const expected = {
    futureFixedAllocatedCount: 3,
    activeReservationCount: 1,
    availableToBook: 0,
    scheduleSummary: "고정 예정 3회 · 보충 예약 1회 · 예약 가능 0회",
  };

  const primaryPackage = packages.find((pkg) => matchesTeacherFilter(pkg, args.teacher)) ||
    packages.find((pkg) => normalizeCount(pkg.remainingCount) > 0) ||
    packages[0] ||
    null;
  const primaryBalance = primaryPackage ?
    packageReports.find((row) => row.packageId === primaryPackage.id) :
    null;

  const diagnosis = {
    matchesExpected: Boolean(
        primaryBalance &&
        primaryBalance.futureFixedAllocatedCount === expected.futureFixedAllocatedCount &&
        primaryBalance.activeReservationCount === expected.activeReservationCount &&
        primaryBalance.availableToBook === expected.availableToBook &&
        primaryBalance.scheduleSummary === expected.scheduleSummary,
    ),
    whyAdminShowsMakeupAvailable: "",
  };

  if (primaryBalance && !diagnosis.matchesExpected) {
    const parts = [];
    if (primaryBalance.futureFixedAllocatedCount !== expected.futureFixedAllocatedCount) {
      parts.push(`futureFixedAllocatedCount=${primaryBalance.futureFixedAllocatedCount} expected ${expected.futureFixedAllocatedCount}`);
    }
    if (primaryBalance.activeReservationCount !== expected.activeReservationCount) {
      parts.push(`activeReservationCount=${primaryBalance.activeReservationCount} expected ${expected.activeReservationCount}`);
      const excluded = reservationReports.filter((row) => !row.includedInActiveReservationCount);
      excluded.forEach((row) => {
        parts.push(`reservation ${row.id} excluded: ${row.excludeReason || "unknown"}`);
      });
    }
    if (primaryBalance.availableToBook !== expected.availableToBook) {
      parts.push(`availableToBook=${primaryBalance.availableToBook} expected ${expected.availableToBook}`);
    }
    diagnosis.whyAdminShowsMakeupAvailable = parts.join("; ");
  } else if (primaryBalance?.scheduleSummary.includes("보충 가능 1회")) {
    diagnosis.whyAdminShowsMakeupAvailable = "computed summary still includes 보충 가능 1회";
  }

  const [membershipSnap, privateAccessSummarySnap] = await Promise.all([
    db.collection("academyMemberships")
        .where("academyId", "==", academyId)
        .where("studentId", "==", studentId)
        .get(),
    db.collection("studentPrivateAccessSummary")
        .doc(`${academyId}__${studentId}`)
        .get(),
  ]);
  const memberships = membershipSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...docSnap.data(),
  }));
  const privateAccessSummary = privateAccessSummarySnap.exists ?
    privateAccessSummarySnap.data() :
    null;

  const crossStudentActiveReservations = [];
  if (reservations.length === 0) {
    const teacherFilterKey = normalizeKey(args.teacher);
    const academyReservationSnap = await db.collection("privateLessonReservations")
        .where("academyId", "==", academyId)
        .where("status", "==", "active")
        .get();
    academyReservationSnap.docs.forEach((docSnap) => {
      const row = {id: docSnap.id, ...docSnap.data()};
      if (normalizeId(row.studentId) === studentId) return;
      const rowTeacherKeys = getPrivateTeacherScopeKeys(row);
      if (teacherFilterKey && !rowTeacherKeys.includes(teacherFilterKey)) return;
      crossStudentActiveReservations.push({
        id: row.id,
        studentId: normalizeId(row.studentId),
        studentName: normalizeId(row.studentName),
        date: normalizeId(row.date),
        time: normalizeId(row.time),
        packageId: normalizeId(row.packageId),
        teacher: normalizeId(row.teacher),
        teacherName: normalizeId(row.teacherName),
        status: normalizeId(row.status),
      });
    });
  }

  const linkage = {
    academyMembershipCount: memberships.length,
    academyMemberships: memberships.map((row) => ({
      id: row.id,
      uid: normalizeId(row.uid),
      email: normalizeId(row.email),
      displayName: normalizeId(row.displayName),
      studentId: normalizeId(row.studentId),
      role: normalizeId(row.role),
      status: normalizeId(row.status),
    })),
    hasStudentLogin: memberships.some(
        (row) => normalizeKey(row.role) === "student" && normalizeKey(row.status) === "active",
    ),
    privateAccessSummary: privateAccessSummary ?
      {
        activePackageIds: privateAccessSummary.activePackageIds || [],
        teacherKeys: privateAccessSummary.teacherKeys || [],
        privateSlotBookingPilotEnabled:
          privateAccessSummary.privateSlotBookingPilotEnabled === true,
      } :
      null,
    canBookPrivateSlots: privateAccessSummary?.privateSlotBookingPilotEnabled === true &&
      memberships.some(
          (row) => normalizeKey(row.role) === "student" && normalizeKey(row.status) === "active",
      ),
  };

  if (reservations.length === 0 && crossStudentActiveReservations.length > 0) {
    diagnosis.likelySmokeTestMismatch = [
      "This student has no privateLessonReservations in Firestore.",
      "Another student has active reservations for the same teacher scope.",
      "If the student booking page shows a reservation while admin summary does not,",
      "confirm the smoke test is logged into the academyMembership linked to this studentId.",
      `Cross-student active reservations: ${crossStudentActiveReservations.map((row) =>
        `${row.studentName || row.studentId} ${row.date} ${row.time}`,
      ).join(", ")}`,
    ].join(" ");
    if (!diagnosis.whyAdminShowsMakeupAvailable) {
      diagnosis.whyAdminShowsMakeupAvailable =
        "no reservation docs for this studentId; admin summary is consistent with Firestore";
    }
  }
  if (!linkage.hasStudentLogin) {
    diagnosis.studentAccountNotLinked = [
      "privateStudents record exists but no active academyMembership with this studentId.",
      "Student booking page requires a linked student login account.",
    ].join(" ");
  }
  if (privateAccessSummary && privateAccessSummary.privateSlotBookingPilotEnabled !== true) {
    diagnosis.privateSlotBookingPilotDisabled = [
      "studentPrivateAccessSummary.privateSlotBookingPilotEnabled is not true.",
      "This student cannot book private slots from the student page until pilot is enabled in admin.",
    ].join(" ");
  }

  console.log(JSON.stringify({
    readOnly: true,
    writesPerformed: false,
    project: args.project,
    serviceAccount: path.basename(args.serviceAccount),
    academyId,
    studentName: args.studentName,
    teacherFilter: args.teacher || null,
    inspectedAt: new Date(now).toISOString(),
    student: {
      id: studentId,
      name: studentDisplayName(student),
      academyId: normalizeId(student.academyId),
      email: normalizeId(student.email) || null,
      phone: normalizeId(student.phone || student.phoneNumber) || null,
      teacher: normalizeId(student.teacher || student.teacherName) || null,
      teacherKey: normalizeId(student.teacherKey) || null,
      teacherUid: normalizeId(student.teacherUid || student.teacherUID) || null,
    },
    packages: packages.map((pkg) => ({
      id: pkg.id,
      academyId: normalizeId(pkg.academyId),
      studentId: normalizeId(pkg.studentId),
      packageType: normalizeId(pkg.packageType),
      teacherUid: normalizeId(pkg.teacherUid) || null,
      teacherUID: normalizeId(pkg.teacherUID) || null,
      teacherId: normalizeId(pkg.teacherId) || null,
      teacherKey: normalizeId(pkg.teacherKey) || null,
      teacherName: normalizeId(pkg.teacherName) || null,
      teacher: normalizeId(pkg.teacher) || null,
      title: normalizeId(pkg.title) || null,
      totalCount: normalizeCount(pkg.totalCount),
      usedCount: normalizeCount(pkg.usedCount),
      remainingCount: normalizeCount(pkg.remainingCount),
      status: normalizeId(pkg.status) || null,
      createdAt: serializeTimestamp(pkg.createdAt),
      updatedAt: serializeTimestamp(pkg.updatedAt),
      teacherScopeKeys: getPrivateTeacherScopeKeys(pkg),
    })),
    fixedPrivateLessons: lessonReports,
    privateLessonReservations: reservationReports,
    relatedPrivateLessonSlots: slotReports,
    computedBalances: packageReports,
    linkage,
    crossStudentActiveReservations,
    expected,
    diagnosis,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
