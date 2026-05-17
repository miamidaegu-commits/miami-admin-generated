#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const admin = require('firebase-admin');

const DEFAULT_PROJECT_ID = 'daegu-miami-production';
const DEFAULT_ACADEMY_ID = 'academy_daegumiami';
const DEFAULT_GRACE_MINUTES = 60;
const DEFAULT_LIMIT = 50;

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      throw new Error(`Unexpected positional argument: ${token}`);
    }
    const key = token.slice(2);
    const value = argv[index + 1];
    if (value == null || value.startsWith('--')) {
      throw new Error(`Missing value for --${key}`);
    }
    args[key] = value;
    index += 1;
  }
  return args;
}

function normalizeId(value) {
  return String(value || '').trim();
}

function normalizeTeacherKey(value) {
  return normalizeId(value).toLowerCase();
}

function getReservationTeacherKey(reservation, slot) {
  return normalizeTeacherKey(reservation && reservation.teacher) ||
    normalizeTeacherKey(slot && slot.teacher) ||
    normalizeTeacherKey(reservation && reservation.teacherName) ||
    normalizeTeacherKey(slot && slot.teacherName);
}

function getPrivatePackageTeacherKey(pkg) {
  return normalizeTeacherKey(pkg && pkg.teacher) ||
    normalizeTeacherKey(pkg && pkg.teacherName);
}

function isEnabled(value, defaultValue = false) {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'on', 'enabled'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off', 'disabled'].includes(raw)) return false;
  return defaultValue;
}

function getTimestampMillis(value) {
  if (!value) return null;
  if (typeof value.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const millis = Date.parse(value);
    return Number.isFinite(millis) ? millis : null;
  }
  return null;
}

function getSeoulDateTimeMillis(dateValue, timeValue) {
  const date = normalizeId(dateValue);
  const time = normalizeId(timeValue);
  const dateMatch = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeMatch = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  return Date.UTC(year, month - 1, day, hour - 9, minute, 0, 0);
}

function getReservationStartMillis(reservation, slot) {
  const startAtMillis = getTimestampMillis(slot && slot.startAt);
  if (startAtMillis !== null) return startAtMillis;
  return getSeoulDateTimeMillis(
    reservation.date || (slot && slot.date),
    reservation.time || (slot && slot.time)
  );
}

function getAutoEndMillis(reservation, slot) {
  const startMillis = getReservationStartMillis(reservation, slot);
  if (startMillis === null) return null;
  const slotDuration = Number(slot && slot.durationMinutes);
  const reservationDuration = Number(reservation && reservation.durationMinutes);
  const durationMinutes =
    Number.isFinite(slotDuration) && slotDuration > 0
      ? slotDuration
      : Number.isFinite(reservationDuration) && reservationDuration > 0
        ? reservationDuration
        : 60;
  return startMillis + durationMinutes * 60 * 1000;
}

function getPrivatePackageRejectReason(pkg, reservation, slot) {
  if (!pkg) return 'package_missing';
  if (normalizeId(pkg.academyId) !== normalizeId(reservation.academyId)) {
    return 'academy_mismatch';
  }
  if (normalizeId(pkg.studentId) !== normalizeId(reservation.studentId)) {
    return 'student_mismatch';
  }
  const packageType = normalizeId(pkg.packageType).toLowerCase();
  if (packageType && packageType !== 'private') {
    return 'package_type_mismatch';
  }
  const status = normalizeId(pkg.status || 'active').toLowerCase();
  if (['ended', 'cancelled', 'canceled', 'inactive', 'expired'].includes(status)) {
    return 'package_not_active';
  }
  const remainingCount = Number(pkg.remainingCount || 0);
  if (!Number.isFinite(remainingCount) || remainingCount <= 0) {
    return 'no_remaining_count';
  }
  const teacherKey = getReservationTeacherKey(reservation, slot);
  if (!teacherKey) return 'missing_reservation_teacher';
  const packageTeacherKey = getPrivatePackageTeacherKey(pkg);
  if (!packageTeacherKey) return 'missing_package_teacher';
  if (packageTeacherKey !== teacherKey) return 'teacher_mismatch';
  return null;
}

function sortPackageCandidates(a, b) {
  const aRemaining = Number(a.data.remainingCount || 0);
  const bRemaining = Number(b.data.remainingCount || 0);
  if (aRemaining !== bRemaining) return aRemaining - bRemaining;
  return (getTimestampMillis(a.data.createdAt) || 0) -
    (getTimestampMillis(b.data.createdAt) || 0);
}

function pushUniqueCandidate(candidates, id, source) {
  const normalizedId = normalizeId(id);
  if (!normalizedId || candidates.some((candidate) => candidate.id === normalizedId)) {
    return;
  }
  candidates.push({ id: normalizedId, source });
}

function getPackageCandidateRefs(reservation, slot, summary) {
  const candidates = [];
  pushUniqueCandidate(candidates, reservation && reservation.packageId, 'reservation.packageId');
  pushUniqueCandidate(candidates, slot && slot.packageId, 'slot.packageId');
  const activePackageIds = Array.isArray(summary && summary.activePackageIds)
    ? summary.activePackageIds
    : [];
  activePackageIds.forEach((packageId) => {
    pushUniqueCandidate(candidates, packageId, 'summary.activePackageIds');
  });
  return candidates;
}

function getPackageDebug(packageId, source, pkg, rejectReason) {
  return {
    packageId,
    source,
    teacher: normalizeId(pkg && pkg.teacher),
    teacherName: normalizeId(pkg && pkg.teacherName),
    packageType: normalizeId(pkg && pkg.packageType),
    status: normalizeId(pkg && pkg.status),
    remainingCount: Number(pkg && pkg.remainingCount || 0),
    rejectReason,
  };
}

function loadServiceAccount(serviceAccountPath) {
  const resolvedPath = path.resolve(serviceAccountPath);
  if (!fs.existsSync(resolvedPath)) {
    throw new Error(`Service account file not found: ${resolvedPath}`);
  }
  return JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
}

async function findPackage(db, reservation, slot, summary) {
  const candidateRefs = getPackageCandidateRefs(reservation, slot, summary);
  const candidatePackageIds = candidateRefs.map((candidate) => candidate.id);
  const checkedPackages = [];
  const validCandidates = [];

  for (const candidate of candidateRefs) {
    const snap = await db.collection('studentPackages').doc(candidate.id).get();
    if (!snap.exists) {
      checkedPackages.push(getPackageDebug(
        candidate.id,
        candidate.source,
        null,
        'package_missing'
      ));
      continue;
    }
    const data = snap.data() || {};
    const rejectReason = getPrivatePackageRejectReason(data, reservation, slot);
    checkedPackages.push(getPackageDebug(candidate.id, candidate.source, data, rejectReason));
    if (!rejectReason) {
      validCandidates.push({ id: snap.id, data, source: candidate.source });
    }
  }

  if (validCandidates.length === 1) {
    return {
      ok: true,
      id: validCandidates[0].id,
      data: validCandidates[0].data,
      candidatePackageIds,
      checkedPackages,
    };
  }
  if (validCandidates.length > 1) {
    const explicit = validCandidates.find((candidate) =>
      candidate.source === 'reservation.packageId' ||
      candidate.source === 'slot.packageId'
    );
    if (explicit) {
      return {
        ok: true,
        id: explicit.id,
        data: explicit.data,
        candidatePackageIds,
        checkedPackages,
      };
    }
    return {
      ok: false,
      reason: 'ambiguous_matching_packages',
      candidatePackageIds,
      checkedPackages,
    };
  }

  const snap = await db
    .collection('studentPackages')
    .where('academyId', '==', normalizeId(reservation.academyId))
    .where('studentId', '==', normalizeId(reservation.studentId))
    .get();
  const candidates = snap.docs
    .map((docSnap) => {
      const data = docSnap.data() || {};
      const rejectReason = getPrivatePackageRejectReason(data, reservation, slot);
      checkedPackages.push(getPackageDebug(docSnap.id, 'fallbackQuery', data, rejectReason));
      return { id: docSnap.id, data, rejectReason };
    })
    .filter((candidate) => !candidate.rejectReason)
    .sort(sortPackageCandidates);
  if (candidates.length === 0) {
    return {
      ok: false,
      reason: 'no_remaining_matching_package',
      candidatePackageIds,
      checkedPackages,
    };
  }
  if (candidates.length > 1) {
    return {
      ok: false,
      reason: 'ambiguous_matching_packages',
      candidatePackageIds,
      checkedPackages,
    };
  }
  return {
    ok: true,
    id: candidates[0].id,
    data: candidates[0].data,
    candidatePackageIds,
    checkedPackages,
  };
}

async function inspectReservation(db, docSnap, options) {
  const reservation = { id: docSnap.id, ...(docSnap.data() || {}) };
  const academyId = normalizeId(reservation.academyId);
  const studentId = normalizeId(reservation.studentId);
  const slotId = normalizeId(reservation.slotId);

  if (reservation.deductionApplied === true) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'already_deducted' };
  }
  if (normalizeId(reservation.status) !== 'active') {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'not_active' };
  }
  if (!studentId || !slotId) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'missing_student_or_slot' };
  }
  if (reservation.outcomeReversedAt) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'outcome_reversed' };
  }

  const [slotSnap, summarySnap] = await Promise.all([
    db.collection('privateLessonSlots').doc(slotId).get(),
    db.collection('studentPrivateAccessSummary').doc(`${academyId}__${studentId}`).get(),
  ]);
  if (!slotSnap.exists) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'slot_missing', slotId };
  }
  const slot = slotSnap.data() || {};
  if (normalizeId(slot.academyId) !== academyId) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'slot_academy_mismatch', slotId };
  }
  if (normalizeId(slot.status) !== 'reserved') {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'slot_not_reserved', slotId };
  }
  if (normalizeId(slot.reservationId) && normalizeId(slot.reservationId) !== docSnap.id) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'slot_reservation_mismatch', slotId };
  }

  const startMillis = getReservationStartMillis(reservation, slot);
  if (options.notBeforeMillis !== null && (startMillis === null || startMillis < options.notBeforeMillis)) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'before_cutoff', slotId };
  }
  const endMillis = getAutoEndMillis(reservation, slot);
  if (endMillis === null) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'missing_schedule', slotId };
  }
  const dueMillis = endMillis + options.graceMinutes * 60 * 1000;
  if (Date.now() < dueMillis) {
    return {
      reservationId: docSnap.id,
      wouldDeduct: false,
      reason: 'not_due',
      slotId,
      dueAt: new Date(dueMillis).toISOString(),
    };
  }

  const summary = summarySnap.exists ? summarySnap.data() || {} : null;
  if (options.pilotOnly && (!summary || summary.privateSlotBookingPilotEnabled !== true)) {
    return { reservationId: docSnap.id, wouldDeduct: false, reason: 'pilot_not_enabled', slotId, studentId };
  }

  const summaryActivePackageIds = Array.isArray(summary && summary.activePackageIds)
    ? summary.activePackageIds.map(normalizeId).filter(Boolean)
    : [];
  const packageResult = await findPackage(db, reservation, slot, summary);
  if (!packageResult.ok) {
    return {
      reservationId: docSnap.id,
      wouldDeduct: false,
      reason: packageResult.reason,
      slotId,
      studentId,
      slotTeacher: normalizeId(slot.teacher),
      slotTeacherName: normalizeId(slot.teacherName),
      reservationTeacher: normalizeId(reservation.teacher),
      reservationTeacherName: normalizeId(reservation.teacherName),
      summaryActivePackageIds,
      candidatePackageIds: packageResult.candidatePackageIds || [],
      checkedPackages: packageResult.checkedPackages || [],
    };
  }

  const beforeRemaining = Number(packageResult.data.remainingCount || 0);
  const beforeUsed = Number(packageResult.data.usedCount || 0);
  return {
    reservationId: docSnap.id,
    wouldDeduct: true,
    academyId,
    studentId,
    slotId,
    date: normalizeId(reservation.date || slot.date),
    time: normalizeId(reservation.time || slot.time),
    packageId: packageResult.id,
    beforeRemaining,
    afterRemaining: Math.max(0, beforeRemaining - 1),
    beforeUsed,
    afterUsed: beforeUsed + 1,
    slotTeacher: normalizeId(slot.teacher),
    slotTeacherName: normalizeId(slot.teacherName),
    reservationTeacher: normalizeId(reservation.teacher),
    reservationTeacherName: normalizeId(reservation.teacherName),
    summaryActivePackageIds,
    candidatePackageIds: packageResult.candidatePackageIds || [],
    checkedPackages: packageResult.checkedPackages || [],
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const serviceAccountPath =
    args['service-account'] ||
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH ||
    path.join(process.cwd(), 'serviceAccountKey.prod.json');
  const serviceAccount = loadServiceAccount(serviceAccountPath);
  const projectId = normalizeId(args.project || serviceAccount.project_id || DEFAULT_PROJECT_ID);
  if (projectId !== DEFAULT_PROJECT_ID) {
    throw new Error(`Expected ${DEFAULT_PROJECT_ID}, received ${projectId}`);
  }

  const academyId = normalizeId(args['academy-id'] || DEFAULT_ACADEMY_ID);
  const graceMinutes = Number.parseInt(args['grace-minutes'] || `${DEFAULT_GRACE_MINUTES}`, 10);
  const limit = Number.parseInt(args.limit || `${DEFAULT_LIMIT}`, 10);
  const notBeforeRaw = normalizeId(args['not-before'] || '');
  const notBeforeMillis = notBeforeRaw ? Date.parse(notBeforeRaw) : null;
  if (notBeforeRaw && !Number.isFinite(notBeforeMillis)) {
    throw new Error(`Invalid --not-before value: ${notBeforeRaw}`);
  }
  const pilotOnly = isEnabled(args['pilot-only'], true);

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
      projectId,
    });
  }
  const db = admin.firestore();

  let queryRef = db
    .collection('privateLessonReservations')
    .where('academyId', '==', academyId)
    .where('status', '==', 'active')
    .limit(Number.isInteger(limit) && limit > 0 ? limit : DEFAULT_LIMIT);
  if (args['student-id']) {
    queryRef = queryRef.where('studentId', '==', normalizeId(args['student-id']));
  }
  if (args['slot-id']) {
    queryRef = queryRef.where('slotId', '==', normalizeId(args['slot-id']));
  }

  const snap = await queryRef.get();
  const rows = [];
  for (const docSnap of snap.docs) {
    rows.push(await inspectReservation(db, docSnap, {
      graceMinutes: Number.isInteger(graceMinutes) && graceMinutes >= 0
        ? graceMinutes
        : DEFAULT_GRACE_MINUTES,
      notBeforeMillis,
      pilotOnly,
    }));
  }

  console.log(JSON.stringify({
    ok: true,
    dryRun: true,
    projectId,
    academyId,
    scanned: snap.size,
    wouldDeduct: rows.filter((row) => row.wouldDeduct).length,
    rows,
  }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({
    ok: false,
    error: error.message || String(error),
  }, null, 2));
  process.exit(1);
});
