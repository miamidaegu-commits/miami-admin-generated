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
    if (arg === "--apply") {
      out.apply = true;
    } else if (arg.startsWith("--service-account=")) {
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

function uniqueKeys(values) {
  const out = [];
  values.forEach((value) => {
    const key = normalizeKey(value);
    if (key && !out.includes(key)) out.push(key);
  });
  return out;
}

function isPrivateLessonRow(row) {
  const groupClassId = normalizeText(row.groupClassId || row.groupClassID);
  const billingType = normalizeKey(row.billingType);
  const lessonType = normalizeKey(row.type || row.lessonType || row.packageType);
  if (groupClassId) return false;
  if (billingType === "private" || lessonType === "private") return true;
  return Boolean(
      normalizeText(row.studentId || row.studentID) &&
      normalizeText(row.teacher || row.teacherName),
  );
}

function isDisplayablePrivatePackage(pkg, academyId, studentId) {
  const packageType = normalizeKey(pkg.packageType || "private");
  const status = normalizeKey(pkg.status || "active");
  if (normalizeText(pkg.academyId) !== academyId) return false;
  if (normalizeText(pkg.studentId) !== studentId) return false;
  if (packageType && packageType !== "private") return false;
  return !["inactive", "expired", "ended", "cancelled", "canceled"]
      .includes(status);
}

function packageTeacherKeys(pkg) {
  return uniqueKeys([
    pkg.teacher,
    pkg.teacherName,
    pkg.teacherKey,
    pkg.teacherUid,
  ]);
}

function lessonTeacherKeys(lesson) {
  return uniqueKeys([
    lesson.teacher,
    lesson.teacherName,
    lesson.teacherKey,
    lesson.teacherUid,
  ]);
}

function matchesTeacher(pkg, lesson) {
  const pkgKeys = packageTeacherKeys(pkg);
  const rowKeys = lessonTeacherKeys(lesson);
  return rowKeys.some((key) => pkgKeys.includes(key));
}

function buildTeacherDirectory(membershipSnap, userSnap) {
  const byKey = new Map();
  membershipSnap.docs.forEach((docSnap) => {
    const row = docSnap.data() || {};
    const uid = normalizeText(row.uid || docSnap.id.split("_").pop());
    const teacherName = normalizeText(row.teacherName || row.displayName || row.name);
    uniqueKeys([teacherName, row.teacherKey, uid]).forEach((key) => {
      if (!byKey.has(key)) {
        byKey.set(key, {uid, teacherName, source: "academyMemberships"});
      }
    });
  });
  userSnap.docs.forEach((docSnap) => {
    const row = docSnap.data() || {};
    const uid = normalizeText(row.uid || docSnap.id);
    const teacherName = normalizeText(row.teacherName || row.displayName || row.name);
    uniqueKeys([teacherName, row.teacherKey, uid]).forEach((key) => {
      if (!byKey.has(key)) {
        byKey.set(key, {uid, teacherName, source: "users"});
      }
    });
  });
  return byKey;
}

function proposedPackageUpdates(pkg, lesson, teacherDirectory) {
  const lessonTeacherName = normalizeText(
      lesson.teacherName || lesson.teacher || lesson.teacherKey,
  );
  const teacherLookup = teacherDirectory.get(normalizeKey(lessonTeacherName));
  const teacherUid = normalizeText(teacherLookup && teacherLookup.uid);
  const teacherName = normalizeText(
      teacherLookup && teacherLookup.teacherName,
  ) || lessonTeacherName;
  const teacherKey = normalizeKey(lesson.teacherKey || teacherName);
  const updates = {};

  if (!normalizeText(pkg.teacherName) && teacherName) updates.teacherName = teacherName;
  if (!normalizeText(pkg.teacherKey) && teacherKey) updates.teacherKey = teacherKey;
  if (!normalizeText(pkg.teacherUid) && teacherUid) updates.teacherUid = teacherUid;

  return updates;
}

function classifyCandidate({lesson, candidates, matchedCandidates, updates}) {
  if (matchedCandidates.length === 1) {
    const missingTeacherFields = Object.keys(updates).length > 0;
    return {
      confidence: missingTeacherFields ? "high" : "medium",
      reason: missingTeacherFields ?
        "single teacher-name package match with missing teacher link fields" :
        "single teacher-name package match; lesson can use fallback matching",
    };
  }
  if (matchedCandidates.length > 1) {
    return {confidence: "low", reason: "multiple matching private packages"};
  }
  if (candidates.length > 0 && lessonTeacherKeys(lesson).length > 0) {
    return {
      confidence: "low",
      reason: "student has private package but teacher fields do not match",
    };
  }
  return {confidence: "low", reason: "insufficient teacher information"};
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.academyId || args.academyId === "academy_default") {
    throw new Error(
        "Usage: node scripts/dry-run-private-package-link-audit.cjs " +
        "--academy-id=<real-academy-id> [--service-account=./serviceAccountKey.json] [--apply]",
    );
  }

  const serviceAccount = require(args.serviceAccount);
  if (!admin.apps.length) {
    admin.initializeApp({credential: admin.credential.cert(serviceAccount)});
  }

  const db = admin.firestore();
  const academyId = args.academyId;
  const [
    lessonSnap,
    packageSnap,
    membershipSnap,
    userSnap,
  ] = await Promise.all([
    db.collection("lessons").where("academyId", "==", academyId).get(),
    db.collection("studentPackages").where("academyId", "==", academyId).get(),
    db.collection("academyMemberships").where("academyId", "==", academyId).get(),
    db.collection("users").get(),
  ]);

  const packages = packageSnap.docs.map((docSnap) => ({
    id: docSnap.id,
    ref: docSnap.ref,
    ...(docSnap.data() || {}),
  }));
  const teacherDirectory = buildTeacherDirectory(membershipSnap, userSnap);
  const reports = [];

  lessonSnap.docs.forEach((docSnap) => {
    const lesson = {id: docSnap.id, ...(docSnap.data() || {})};
    if (!isPrivateLessonRow(lesson)) return;

    const studentId = normalizeText(lesson.studentId || lesson.studentID);
    if (!studentId) return;

    const currentPackageId = normalizeText(lesson.packageId);
    const currentPackage = currentPackageId ?
      packages.find((pkg) => pkg.id === currentPackageId) :
      null;
    if (currentPackage && matchesTeacher(currentPackage, lesson)) return;

    const studentPackages = packages.filter((pkg) =>
      isDisplayablePrivatePackage(pkg, academyId, studentId),
    );
    if (studentPackages.length === 0) return;

    const matchedPackages = studentPackages.filter((pkg) =>
      matchesTeacher(pkg, lesson),
    );
    const selectedPackage = matchedPackages.length === 1 ?
      matchedPackages[0] :
      null;
    const updates = selectedPackage ?
      proposedPackageUpdates(selectedPackage, lesson, teacherDirectory) :
      {};
    const classification = classifyCandidate({
      lesson,
      candidates: studentPackages,
      matchedCandidates: matchedPackages,
      updates,
    });

    reports.push({
      studentId,
      studentName: normalizeText(lesson.studentName || lesson.student || "-"),
      teacherName: normalizeText(lesson.teacherName || lesson.teacher || "-"),
      lessonId: lesson.id,
      packageId: selectedPackage ? selectedPackage.id : "",
      candidatePackageIds: studentPackages.map((pkg) => pkg.id),
      currentPackageFields: selectedPackage ? {
        teacher: normalizeText(selectedPackage.teacher),
        teacherName: normalizeText(selectedPackage.teacherName),
        teacherKey: normalizeText(selectedPackage.teacherKey),
        teacherUid: normalizeText(selectedPackage.teacherUid),
        totalCount: Number(selectedPackage.totalCount || 0),
        usedCount: Number(selectedPackage.usedCount || 0),
        remainingCount: Number(selectedPackage.remainingCount || 0),
        status: normalizeText(selectedPackage.status || "active"),
      } : null,
      proposedUpdates: updates,
      confidence: classification.confidence,
      reason: classification.reason,
    });
  });

  let writesPerformed = false;
  if (args.apply) {
    const highConfidence = reports.filter((row) =>
      row.confidence === "high" &&
      row.packageId &&
      Object.keys(row.proposedUpdates || {}).length > 0,
    );
    const batch = db.batch();
    highConfidence.forEach((row) => {
      batch.update(db.collection("studentPackages").doc(row.packageId), {
        ...row.proposedUpdates,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    });
    if (highConfidence.length > 0) {
      await batch.commit();
      writesPerformed = true;
    }
  }

  console.log(JSON.stringify({
    dryRun: !args.apply,
    writesPerformed,
    academyId,
    scanned: {
      lessons: lessonSnap.size,
      studentPackages: packageSnap.size,
      academyMemberships: membershipSnap.size,
      users: userSnap.size,
    },
    candidates: reports.length,
    report: reports,
  }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
