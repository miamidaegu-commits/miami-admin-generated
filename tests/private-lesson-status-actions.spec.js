import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { test, expect } from '@playwright/test';

function readSource(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8');
}

function boundedSource(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  expect(end).toBeGreaterThan(start);
  return source.slice(start, end);
}

test('private lesson status action preview callable is exported and guarded', () => {
  const functionsSource = readSource('functions/index.js');
  const callableBlock = boundedSource(
    functionsSource,
    'exports.previewPrivateLessonStatusAction = onCall(',
    'exports.markPrivateReservationOutcome = onCall('
  );
  const helperBlock = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_STATUS_ACTIONS',
    'async function canMarkPrivateReservationOutcome'
  );
  const combinedSource = `${helperBlock}\n${callableBlock}`;

  [
    'previewPrivateLessonStatusAction',
    'complete',
    'no_show',
    'reverse_deduction',
    '수업완료',
    '결석',
    '노쇼',
    '차감취소',
    'canManageOwnLessonDeductions',
    'canReverseOwnPrivateLessonDeduction',
    'teacher_not_owner',
    'teacher_permission_missing',
    'reverse_deduction_is_high_risk',
    'no_show_keeps_deduction',
    'complete_keeps_deduction',
    'deduction_not_applied',
    'deduction_already_reversed',
    'packageImpact',
    'creditTransactionPreview',
    'blockedReasons',
    'proposedState',
    'normalizedPlan',
    'nextStep',
    'allowed',
    'dryRun',
    'previewOnly',
    'commit: false',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  expect(callableBlock).toContain('if (!request.auth)');
  expect(callableBlock).toContain('data.dryRun !== true');
  expect(callableBlock).toContain('data.previewOnly !== true');
  expect(callableBlock).toContain('data.commit === true');
  expect(callableBlock).toContain('data.commit !== false');
});

test('private lesson status action preview callable stays read-only', () => {
  const functionsSource = readSource('functions/index.js');
  const callableBlock = boundedSource(
    functionsSource,
    'exports.previewPrivateLessonStatusAction = onCall(',
    'exports.markPrivateReservationOutcome = onCall('
  );
  const helperBlock = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_STATUS_ACTIONS',
    'async function canMarkPrivateReservationOutcome'
  );
  const combinedSource = `${helperBlock}\n${callableBlock}`;

  [
    'runTransaction',
    'writeBatch',
    'transaction.set',
    'transaction.update',
    'transaction.delete',
    '.set(',
    '.update(',
    '.delete(',
    '.create(',
    '.add(',
    'setDoc',
    'addDoc',
    'updateDoc',
    'deleteDoc',
  ].forEach((token) => {
    expect(combinedSource).not.toContain(token);
  });

  expect(combinedSource).toContain('packageImpact');
  expect(combinedSource).toContain('creditTransactionPreview');
  expect(combinedSource).toContain('private_lesson_deduction_reversed');
  expect(combinedSource).toContain('private-lesson-status-action');
});

test('private lesson status action commit callable is exported and guarded', () => {
  const functionsSource = readSource('functions/index.js');
  const callableBlock = boundedSource(
    functionsSource,
    'exports.commitPrivateLessonStatusAction = onCall(',
    'exports.reversePrivateReservationOutcome = onCall('
  );
  const helperBlock = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_STATUS_COMMIT_ACTIONS',
    'function requireActiveStudentMembership'
  );
  const combinedSource = `${helperBlock}\n${callableBlock}`;

  [
    'commitPrivateLessonStatusAction',
    'privateLessonStatusActionBatches',
    'payloadHash',
    'idempotentReplay',
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
    'complete',
    'no_show',
    'reverse_deduction commit is not enabled in this release',
    'Package or credit deduction write is not enabled for this status commit',
    'runTransaction',
    'transaction.get',
    'transaction.set',
    'transaction.update',
    'statusActionBatchId',
    'statusActionRequestId',
    'attendanceStatus',
    'statusUpdatedAt',
    'statusUpdatedBy',
    'completedAt',
    'noShowAt',
    'updated',
    'normalizedPlan',
    'blockedReasons',
    'permission-denied',
    'already-exists',
    'failed-precondition',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  expect(callableBlock).toContain('if (!request.auth)');
  expect(callableBlock).toContain('data.actionType === "reverse_deduction"');
  expect(callableBlock).toContain('data.commit !== true');
  expect(callableBlock).toContain('data.dryRun !== false');
  expect(callableBlock).toContain('data.previewOnly !== false');
  expect(helperBlock).toContain(
    'PRIVATE_LESSON_STATUS_COMMIT_ACTIONS = ["complete", "no_show"]'
  );
  expect(helperBlock).toContain('checkpoint.status === "completed"');
  expect(helperBlock).toContain('checkpoint.payloadHash === payloadHash');
});

test('private lesson status action commit writes checkpoint and reservation only', () => {
  const functionsSource = readSource('functions/index.js');
  const helperBlock = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_STATUS_COMMIT_ACTIONS',
    'function requireActiveStudentMembership'
  );

  expect(helperBlock).toContain('transaction.update(target.reservationDoc.ref');
  expect(helperBlock).toContain('transaction.set(batchRef');
  expect(helperBlock).toContain('PRIVATE_LESSON_STATUS_ACTION_BATCH_COLLECTION');
  expect(helperBlock).toContain('"privateLessonStatusActionBatches"');
  expect(helperBlock).toContain('.collection("privateLessonReservations")');
  expect(helperBlock).toContain('"lessons"');
  expect(helperBlock).toContain('"privateLessonSlots"');
  expect(helperBlock).toContain('"studentPackages"');
  expect(helperBlock).toContain('.collection("creditTransactions")');

  [
    'transaction.update(packageRef',
    'transaction.update(slotRef',
    'transaction.update(lessonRef',
    'transaction.update(target.lessonDoc.ref',
    'transaction.update(target.slotDoc.ref',
    'transaction.update(target.packageDoc.ref',
    'transaction.set(creditRef',
    'transaction.create(',
    '.collection("creditTransactions").add',
    '.collection("studentPackages").add',
  ].forEach((token) => {
    expect(helperBlock).not.toContain(token);
  });
});

test('private lesson status action PR keeps protected files unchanged', () => {
  const protectedPaths = [
    'Dashboard.jsx',
    'src/features/dashboard/sections/CalendarSection.jsx',
    'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx',
    'firestore.rules',
    'package.json',
    'package-lock.json',
    'functions/package.json',
    'functions/package-lock.json',
    'StudentBookingPage.jsx',
    'index.css',
  ];
  const changedProtectedFiles = execFileSync(
    'git',
    ['diff', '--name-only', '--', ...protectedPaths],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  expect(changedProtectedFiles).toEqual([]);
});

test('private lesson status action source passes Node syntax check', () => {
  execFileSync('node', ['--check', 'functions/index.js'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
});
