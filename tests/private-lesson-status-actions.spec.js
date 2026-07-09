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
