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
    'function mapPrivateReservationOutcomePackageBlockedReason('
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
    'statusOnlyPolicy',
    'deductionEvidence',
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
    'function mapPrivateReservationOutcomePackageBlockedReason('
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
    'statusOnlyPolicy',
    'deductionEvidence',
    'packageImpact',
    'creditTransactionPreview',
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

test('private lesson status action preview and commit share package credit policy', () => {
  const functionsSource = readSource('functions/index.js');
  const policyBlock = boundedSource(
    functionsSource,
    'function buildPrivateLessonStatusPackageCreditPolicy({',
    'function buildPrivateLessonStatusPlan({actionType, target})'
  );
  const planBlock = boundedSource(
    functionsSource,
    'function buildPrivateLessonStatusPlan({actionType, target})',
    'async function previewPrivateLessonStatusAction'
  );
  const previewBlock = boundedSource(
    functionsSource,
    'async function previewPrivateLessonStatusAction',
    'async function canMarkPrivateReservationOutcome'
  );
  const commitGuardBlock = boundedSource(
    functionsSource,
    'function assertPrivateLessonStatusCommitAllowed({',
    'function buildPrivateLessonStatusCommitReplay'
  );
  const commitBlock = boundedSource(
    functionsSource,
    'async function commitPrivateLessonStatusAction({db, auth, data})',
    'function requireActiveStudentMembership'
  );
  const errorDetailsBlock = boundedSource(
    functionsSource,
    'function buildPrivateLessonStatusCommitErrorDetails({',
    'function firstPrivateLessonStatusValue'
  );
  const commitConstantsBlock = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_STATUS_COMMIT_ACTIONS',
    'function buildPrivateLessonStatusActionBatchId'
  );
  const combinedSource = [
    commitConstantsBlock,
    policyBlock,
    planBlock,
    previewBlock,
    commitGuardBlock,
    commitBlock,
    errorDetailsBlock,
  ].join('\n');

  [
    'buildPrivateLessonStatusPackageCreditPolicy',
    'package_or_credit_write_required',
    'Package or credit deduction write is not enabled for this status commit',
    'hasPrivateLessonStatusDeductionEvidence',
    'allowedStatusOnly',
    'statusOnlyPolicy',
    'deductionEvidence',
    'packageImpact',
    'creditTransactionPreview',
    'previewPrivateLessonStatusAction',
    'commitPrivateLessonStatusAction',
    'actual status-only commit requires deduction evidence',
    'preview and commit share package credit policy',
    '실제 처리는 최종 확인 후 진행할 수 있습니다',
    '차단 사유를 확인한 뒤 기존 차감 포함 처리 또는 별도 기능을 사용하세요',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  expect(planBlock).toContain('buildPrivateLessonStatusPackageCreditPolicy({');
  expect(planBlock).toContain('blockedReasons.push(...statusOnlyPolicy.blockedReasons)');
  expect(previewBlock).toContain('const plan = buildPrivateLessonStatusPlan({actionType, target})');
  expect(commitBlock).toContain('const plan = buildPrivateLessonStatusPlan({');
  expect(commitGuardBlock).toContain('const statusOnlyPolicy = plan.statusOnlyPolicy || {}');
  expect(commitGuardBlock).not.toContain('!hasPrivateLessonStatusDeductionEvidence(target)');
  expect(commitGuardBlock).not.toContain('Number(packageImpact.usedCountDelta || 0) !== 0');
  expect(errorDetailsBlock).toContain('packageImpact');
  expect(errorDetailsBlock).toContain('creditTransactionPreview');
  expect(errorDetailsBlock).toContain('statusOnlyPolicy');
  expect(errorDetailsBlock).toContain('deductionEvidence');
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

test('private lesson status action admin preview UI is wired as preview-only', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx');
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  );
  const combinedSource = `${dashboardSource}\n${calendarSource}\n${modalSource}`;
  const previewHandlerBlock = boundedSource(
    dashboardSource,
    'async function previewPrivateLessonStatusActionOnServer()',
    'const studentsSectionProps = {'
  );
  const calendarPreviewBlock = boundedSource(
    calendarSource,
    'const PRIVATE_LESSON_STATUS_ACTION_ACTIVE_STATUSES = new Set(',
    "{activeSection === 'calendar' &&"
  );

  [
    'private-lesson-status-action-preview-button',
    'private-lesson-status-action-modal',
    '개인 수업 처리 미리보기',
    '수업 처리',
    '수업완료',
    '노쇼',
    'private-lesson-status-action-type-complete',
    'private-lesson-status-action-type-no-show',
    '서버 기준 미리보기',
    'private-lesson-status-action-preview-submit',
    'previewPrivateLessonStatusAction',
    'dryRun: true',
    'previewOnly: true',
    'commit: false',
    'private-lesson-status-action-preview-result',
    'private-lesson-status-action-preview-error',
    'blockedReasons',
    'packageImpact',
    'creditTransactionPreview',
    'proposedState',
    'currentState',
    'normalizedPlan',
    '먼저 서버 기준 미리보기를 실행한 뒤',
    '통과한 결과만 실제 처리할 수 있습니다',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  [
    'reservationId',
    'lessonId',
    'slotId',
    'dryRun: true',
    'previewOnly: true',
    'commit: false',
  ].forEach((token) => {
    expect(previewHandlerBlock).toContain(token);
  });
  expect(calendarPreviewBlock).toContain('isAdmin');
  expect(calendarPreviewBlock).toContain('isPrivateReservationRow');
  expect(calendarPreviewBlock).toContain('PRIVATE_LESSON_STATUS_ACTION_ACTIVE_STATUSES');
  expect(calendarPreviewBlock).toContain('PRIVATE_LESSON_STATUS_ACTION_FINAL_STATUSES');
  expect(calendarPreviewBlock).toContain('releasedForPrivateBooking');
});

test('private lesson status action admin preview UI has no write or commit path', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx');
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  );
  const previewHandlerBlock = boundedSource(
    dashboardSource,
    'async function previewPrivateLessonStatusActionOnServer()',
    'const studentsSectionProps = {'
  );
  const calendarPreviewBlock = boundedSource(
    calendarSource,
    'const PRIVATE_LESSON_STATUS_ACTION_ACTIVE_STATUSES = new Set(',
    "{activeSection === 'calendar' &&"
  );
  const uiPreviewOnlySource = `${calendarPreviewBlock}\n${modalSource}`;

  [
    'commitPrivateLessonStatusAction',
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
  ].forEach((token) => {
    expect(previewHandlerBlock).not.toContain(token);
    expect(uiPreviewOnlySource).not.toContain(token);
  });

  ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'].forEach((token) => {
    expect(uiPreviewOnlySource).not.toContain(token);
  });
});

test('private lesson status action admin commit UI is guarded and confirmation gated', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  );
  const commitHandlerBlock = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonStatusActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  );
  const combinedSource = `${dashboardSource}\n${modalSource}`;

  [
    'privateLessonStatusActionCommitBusy',
    'privateLessonStatusActionCommitError',
    'privateLessonStatusActionCommitResult',
    'commitPrivateLessonStatusActionOnServer',
    'commitPrivateLessonStatusAction',
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
    'private-lesson-status-action-final-confirmation',
    'private-lesson-status-action-commit-confirm',
    'private-lesson-status-action-commit-button',
    'private-lesson-status-action-commit-result',
    'private-lesson-status-action-commit-error',
    '실제 처리 전 최종 확인',
    '위 내용으로 수업 처리',
    '실제 처리가 완료되었습니다',
    '같은 요청을 반복해서 누르지 마세요',
    '서버 기준 미리보기를 다시 실행하세요',
    'committed',
    'batchId',
    'idempotentReplay',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  [
    'privateLessonStatusActionPreviewPayload',
    'privateLessonStatusActionCommitBusy',
    'privateLessonStatusActionCommitResult',
    'previewData.ok !== true',
    'previewData.allowed !== true',
    'blockedReasons.length > 0',
    '...privateLessonStatusActionPreviewPayload',
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
    "httpsCallable(firebaseFunctions, 'commitPrivateLessonStatusAction')",
  ].forEach((token) => {
    expect(commitHandlerBlock).toContain(token);
  });

  ['setDoc', 'addDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'runTransaction'].forEach((token) => {
    expect(commitHandlerBlock).not.toContain(token);
    expect(modalSource).not.toContain(token);
  });
});

test('private lesson status action PR keeps protected files unchanged', () => {
  const protectedPaths = [
    'Dashboard.jsx',
    'src/features/dashboard/sections/CalendarSection.jsx',
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx',
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
