#!/usr/bin/env node
/* eslint-disable no-console */
const path = require("node:path");
const admin = require("firebase-admin");

function parseArgs(argv) {
  const out = {
    serviceAccount: path.join(__dirname, "..", "serviceAccountKey.json"),
    academyId: "",
  };
  argv.forEach((arg) => {
    if (arg.startsWith("--service-account=")) {
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

function toDateString(value) {
  const text = normalizeText(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function seoulTodayYmd() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  return `${byType.get("year")}-${byType.get("month")}-${byType.get("day")}`;
}

function isPrivateLessonRow(data) {
  const billingType = normalizeText(data.billingType);
  const groupClassId = normalizeText(data.groupClassId || data.groupClassID);
  const type = normalizeText(data.type || data.lessonType || data.packageType);
  if (groupClassId) return false;
  if (billingType === "private" || type === "private") return true;
  return Boolean(normalizeText(data.studentId || data.studentID) && normalizeText(data.teacher || data.teacherName));
}

function isActivePrivatePackage(data, {academyId, studentId, teacher}) {
  const packageType = normalizeText(data.packageType || "private");
  const status = normalizeText(data.status || "active").toLowerCase();
  if (normalizeText(data.academyId) !== academyId) return false;
  if (normalizeText(data.studentId) !== studentId) return false;
  if (packageType && packageType !== "private") return false;
  if (["inactive", "expired", "ended", "cancelled", "canceled"].includes(status)) return false;
  return normalizeText(data.teacher || data.teacherName) === teacher;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.academyId || args.academyId === "academy_default") {
    throw new Error("Usage: node scripts/dry-run-fixed-private-package-backfill.cjs --academy-id=<real-academy-id> [--service-account=./serviceAccountKey.json]");
  }

  const serviceAccount = require(args.serviceAccount);
  if (!admin.apps.length) {
    admin.initializeApp({credential: admin.credential.cert(serviceAccount)});
  }

  const db = admin.firestore();
  const academyId = args.academyId;
  const today = seoulTodayYmd();

  const [studentSnap, lessonSnap, packageSnap] = await Promise.all([
    db.collection("privateStudents").where("academyId", "==", academyId).get(),
    db.collection("lessons").where("academyId", "==", academyId).get(),
    db.collection("studentPackages").where("academyId", "==", academyId).get(),
  ]);

  const studentsById = new Map();
  studentSnap.docs.forEach((docSnap) => {
    studentsById.set(docSnap.id, {id: docSnap.id, ...(docSnap.data() || {})});
  });

  const packages = packageSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ...(docSnap.data() || {}),
  }));

  const groups = new Map();
  lessonSnap.docs.forEach((docSnap) => {
    const data = docSnap.data() || {};
    if (!isPrivateLessonRow(data)) return;
    if (normalizeText(data.packageId)) return;
    const studentId = normalizeText(data.studentId || data.studentID);
    const teacher = normalizeText(data.teacher || data.teacherName);
    if (!studentId || !teacher) return;
    const student = studentsById.get(studentId);
    if (!student) return;
    const paidLessons = Number(student.paidLessons || 0);
    if (!Number.isFinite(paidLessons) || paidLessons <= 0) return;

    const key = `${studentId}__${teacher}`;
    if (!groups.has(key)) {
      groups.set(key, {
        academyId,
        studentId,
        studentName: normalizeText(student.name || student.studentName || data.studentName || data.student),
        teacher,
        fixedPrivateLessonCount: 0,
        alreadyDeductedCount: 0,
        proposedTotalCount: Math.floor(paidLessons),
        lessonsToLink: [],
      });
    }
    const row = groups.get(key);
    row.fixedPrivateLessonCount += 1;
    const date = toDateString(data.date || data.lessonDate);
    if (date && date <= today && data.isDeductCancelled !== true) {
      row.alreadyDeductedCount += 1;
    }
    row.lessonsToLink.push(docSnap.id);
  });

  const report = Array.from(groups.values()).map((row) => {
    const matches = packages.filter((pkg) =>
      isActivePrivatePackage(pkg, {
        academyId: row.academyId,
        studentId: row.studentId,
        teacher: row.teacher,
      }),
    );
    const proposedTotalCount = row.proposedTotalCount || row.fixedPrivateLessonCount;
    const proposedUsedCount = Math.min(row.alreadyDeductedCount, proposedTotalCount);
    return {
      academyId: row.academyId,
      studentId: row.studentId,
      studentName: row.studentName || "-",
      teacher: row.teacher,
      fixedPrivateLessonCount: row.fixedPrivateLessonCount,
      alreadyDeductedCount: row.alreadyDeductedCount,
      proposedTotalCount,
      proposedUsedCount,
      proposedRemainingCount: Math.max(0, proposedTotalCount - proposedUsedCount),
      existingPackageMatch: matches.map((pkg) => ({
        packageId: pkg.id,
        title: normalizeText(pkg.title),
        totalCount: Number(pkg.totalCount || 0),
        usedCount: Number(pkg.usedCount || 0),
        remainingCount: Number(pkg.remainingCount || 0),
        status: normalizeText(pkg.status || "active"),
      })),
      wouldCreatePackage: matches.length === 0,
      lessonsToLinkPackageId: row.lessonsToLink,
    };
  });

  console.log(JSON.stringify({
    dryRun: true,
    writesPerformed: false,
    academyId,
    scanned: {
      privateStudents: studentSnap.size,
      lessons: lessonSnap.size,
      studentPackages: packageSnap.size,
    },
    candidates: report.length,
    report,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
