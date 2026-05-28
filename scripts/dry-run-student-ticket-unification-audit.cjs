#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");
const admin = require("firebase-admin");

function parseArgs(argv) {
  const out = {
    serviceAccount: path.join(__dirname, "..", "serviceAccountKey.json"),
    academyId: "",
    apply: false,
  };
  argv.forEach((arg) => {
    if (arg === "--apply") out.apply = true;
    else if (arg.startsWith("--service-account=")) {
      out.serviceAccount = path.resolve(arg.slice("--service-account=".length));
    } else if (arg.startsWith("--academy-id=")) {
      out.academyId = arg.slice("--academy-id=".length).trim();
    }
  });
  return out;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase();
}

function unique(values) {
  const out = [];
  values.forEach((value) => {
    const text = normalizeText(value);
    if (text && !out.includes(text)) out.push(text);
  });
  return out;
}

function isActiveTicket(ticket) {
  const status = normalizeKey(ticket.status || "active");
  return !["inactive", "expired", "ended", "cancelled", "canceled"]
      .includes(status);
}

function isPrivateTicket(ticket) {
  const packageType = normalizeKey(ticket.packageType || "private");
  return packageType === "private" && isActiveTicket(ticket);
}

function isGroupTicket(ticket) {
  return normalizeKey(ticket.packageType) === "group" && isActiveTicket(ticket);
}

function isPrivateLesson(lesson) {
  if (normalizeText(lesson.groupClassId || lesson.groupClassID || lesson.classID)) {
    return false;
  }
  const packageType = normalizeKey(lesson.packageType || lesson.lessonType);
  const billingType = normalizeKey(lesson.billingType);
  return packageType === "private" ||
    billingType === "private" ||
    Boolean(normalizeText(lesson.studentId || lesson.studentID));
}

function getPrivateTeacherKeys(row) {
  return unique([
    row.teacher,
    row.teacherName,
    row.teacherKey,
    row.teacherUid,
  ]).map(normalizeKey).filter(Boolean);
}

function getGroupClassIds(row) {
  return unique([
    row.groupClassId,
    row.groupClassID,
    row.classID,
    row.classId,
    ...(Array.isArray(row.groupClassIds) ? row.groupClassIds : []),
  ]);
}

function getGroupCourseTypes(row) {
  return unique([
    row.groupCourseType,
    row.courseType,
    ...(Array.isArray(row.groupCourseTypes) ? row.groupCourseTypes : []),
  ]);
}

function privateMatches(ticket, lesson) {
  const ticketKeys = getPrivateTeacherKeys(ticket);
  const lessonKeys = getPrivateTeacherKeys(lesson);
  return lessonKeys.some((key) => ticketKeys.includes(key));
}

function groupMatches(ticket, row) {
  const ticketClassIds = getGroupClassIds(ticket);
  const rowClassIds = getGroupClassIds(row);
  if (rowClassIds.some((id) => ticketClassIds.includes(id))) return true;
  const ticketCourseTypes = getGroupCourseTypes(ticket).map(normalizeKey);
  const rowCourseTypes = getGroupCourseTypes(row).map(normalizeKey);
  return rowCourseTypes.some((courseType) => ticketCourseTypes.includes(courseType));
}

function studentNameFrom(...rows) {
  for (const row of rows) {
    const name = normalizeText(row && (row.studentName || row.name || row.student));
    if (name) return name;
  }
  return "";
}

function privateProposedFields(ticket, lesson) {
  const teacherName = normalizeText(
      lesson.teacherName || lesson.teacher || lesson.teacherKey,
  );
  const updates = {};
  if (!normalizeText(ticket.teacherName) && teacherName) updates.teacherName = teacherName;
  if (!normalizeText(ticket.teacherKey) && teacherName) {
    updates.teacherKey = normalizeKey(teacherName);
  }
  return updates;
}

function groupProposedFields(ticket, row) {
  const updates = {};
  const classIds = getGroupClassIds(row);
  const courseTypes = getGroupCourseTypes(row);
  if (!normalizeText(ticket.groupClassId) &&
      getGroupClassIds(ticket).length === 0 &&
      classIds.length === 1) {
    updates.groupClassId = classIds[0];
    updates.groupClassIds = classIds;
  }
  if (!normalizeText(ticket.groupCourseType) &&
      getGroupCourseTypes(ticket).length === 0 &&
      courseTypes.length === 1) {
    updates.groupCourseType = courseTypes[0];
  }
  return updates;
}

function addReport(reports, row) {
  reports.push({
    studentId: row.studentId || "",
    studentName: row.studentName || "",
    ticketType: row.ticketType,
    scope: row.scope || "",
    currentPackageId: row.currentPackageId || "",
    proposedFields: row.proposedFields || {},
    confidence: row.confidence || "low",
    reason: row.reason || "",
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.academyId || args.academyId === "academy_default") {
    throw new Error(
        "Usage: node scripts/dry-run-student-ticket-unification-audit.cjs " +
        "--academy-id=<real-academy-id> [--service-account=./serviceAccountKey.json] [--apply]",
    );
  }
  const serviceAccount = require(args.serviceAccount);
  if (!admin.apps.length) {
    admin.initializeApp({credential: admin.credential.cert(serviceAccount)});
  }
  const db = admin.firestore();
  const academyId = args.academyId;

  const [lessonsSnap, groupLessonsSnap, groupStudentsSnap, packagesSnap] =
    await Promise.all([
      db.collection("lessons").where("academyId", "==", academyId).get(),
      db.collection("groupLessons").where("academyId", "==", academyId).get(),
      db.collection("groupStudents").where("academyId", "==", academyId).get(),
      db.collection("studentPackages").where("academyId", "==", academyId).get(),
    ]);

  const packages = packagesSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ref: docSnap.ref,
    ...(docSnap.data() || {}),
  }));
  const groupStudents = groupStudentsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() || {}),
  }));
  const groupLessons = groupLessonsSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() || {}),
  }));
  const reports = [];

  lessonsSnap.docs.forEach((docSnap) => {
    const lesson = {id: docSnap.id, ...(docSnap.data() || {})};
    if (!isPrivateLesson(lesson)) return;
    const studentId = normalizeText(lesson.studentId || lesson.studentID);
    if (!studentId) return;
    const studentTickets = packages.filter((ticket) =>
      normalizeText(ticket.studentId) === studentId && isPrivateTicket(ticket),
    );
    const matching = studentTickets.filter((ticket) => privateMatches(ticket, lesson));
    const scope = getPrivateTeacherKeys(lesson).join(", ");
    if (studentTickets.length === 0) {
      addReport(reports, {
        studentId,
        studentName: studentNameFrom(lesson),
        ticketType: "private",
        scope,
        confidence: "high",
        reason: "private fixed lesson exists but student has no private ticket",
      });
      return;
    }
    if (matching.length !== 1) {
      addReport(reports, {
        studentId,
        studentName: studentNameFrom(lesson, studentTickets[0]),
        ticketType: "private",
        scope,
        currentPackageId: matching.map((ticket) => ticket.id).join(", "),
        confidence: "low",
        reason: matching.length > 1 ?
          "ambiguous private ticket candidates" :
          "student has private ticket but teacher scope does not link",
      });
      return;
    }
    const proposedFields = privateProposedFields(matching[0], lesson);
    if (Object.keys(proposedFields).length > 0) {
      addReport(reports, {
        studentId,
        studentName: studentNameFrom(lesson, matching[0]),
        ticketType: "private",
        scope,
        currentPackageId: matching[0].id,
        proposedFields,
        confidence: "high",
        reason: "legacy private ticket missing teacherKey/teacherUid-compatible fields",
      });
    }
  });

  groupStudents.forEach((groupStudent) => {
    const studentId = normalizeText(groupStudent.studentId);
    if (!studentId) return;
    const scope = getGroupClassIds(groupStudent).join(", ");
    const studentTickets = packages.filter((ticket) =>
      normalizeText(ticket.studentId) === studentId && isGroupTicket(ticket),
    );
    const matching = studentTickets.filter((ticket) => groupMatches(ticket, groupStudent));
    if (studentTickets.length === 0) {
      addReport(reports, {
        studentId,
        studentName: studentNameFrom(groupStudent),
        ticketType: "group",
        scope,
        confidence: "high",
        reason: "group fixed student exists but student has no group ticket",
      });
      return;
    }
    if (matching.length !== 1) {
      addReport(reports, {
        studentId,
        studentName: studentNameFrom(groupStudent, studentTickets[0]),
        ticketType: "group",
        scope,
        currentPackageId: matching.map((ticket) => ticket.id).join(", "),
        confidence: "low",
        reason: matching.length > 1 ?
          "ambiguous group ticket candidates" :
          "student has group ticket but course/class scope does not link",
      });
      return;
    }
    const lessonForScope = groupLessons.find((lesson) =>
      getGroupClassIds(lesson).some((id) => getGroupClassIds(groupStudent).includes(id)),
    ) || {};
    const proposedFields = groupProposedFields(matching[0], {
      ...lessonForScope,
      ...groupStudent,
    });
    if (Object.keys(proposedFields).length > 0) {
      addReport(reports, {
        studentId,
        studentName: studentNameFrom(groupStudent, matching[0]),
        ticketType: "group",
        scope,
        currentPackageId: matching[0].id,
        proposedFields,
        confidence: "high",
        reason: "legacy group ticket missing courseType/groupClassIds scope fields",
      });
    }
  });

  console.log(JSON.stringify({
    academyId,
    apply: args.apply,
    reportCount: reports.length,
    reports,
  }, null, 2));

  if (args.apply) {
    console.warn("--apply is intentionally not implemented for this audit.");
    process.exitCode = 2;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
