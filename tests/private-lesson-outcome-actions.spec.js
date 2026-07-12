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

test('deduction-aware private lesson outcome preview is exported and guarded', () => {
  const functionsSource = readSource('functions/index.js');
  const callableBlock = boundedSource(
    functionsSource,
    'exports.previewPrivateLessonOutcomeAction = onCall(',
    'async function applyPrivateReservationOutcomeWithDeductionInTransaction('
  );

  [
    'previewPrivateLessonOutcomeAction',
    'if (!request.auth)',
    'const academyId = requireString(data, "academyId")',
    'const reservationId = requireString(data, "reservationId")',
    'const requestId = requireString(data, "requestId")',
    'const actionType = requireString(data, "actionType")',
    '["complete", "no_show"].includes(actionType)',
    'data.dryRun !== true',
    'data.previewOnly !== true',
    'data.commit !== false',
    'canMarkPrivateReservationOutcome',
    'normalizedOutcome',
    'dryRun: true',
    'previewOnly: true',
    'commit: false',
    'isAdmin: actor.actorRole === "admin"',
    'planHash',
  ].forEach((token) => {
    expect(callableBlock).toContain(token);
  });

  expect(callableBlock).toContain(
    'resolvePrivateReservationOutcomePreviewTarget'
  );
  expect(callableBlock).toContain('buildPrivateReservationOutcomePlan');
  expect(callableBlock).toContain('buildPrivateReservationOutcomePlanHash');
});

test('pure outcome plan describes package, credit, and reservation changes', () => {
  const functionsSource = readSource('functions/index.js');
  const planBlock = boundedSource(
    functionsSource,
    'function mapPrivateReservationOutcomePackageBlockedReason(',
    'async function resolvePrivateReservationOutcomePreviewTarget('
  );
  const callableBlock = boundedSource(
    functionsSource,
    'exports.previewPrivateLessonOutcomeAction = onCall(',
    'async function applyPrivateReservationOutcomeWithDeductionInTransaction('
  );
  const combinedSource = `${planBlock}\n${callableBlock}`;

  [
    'buildPrivateReservationOutcomePlan',
    'actionType === "complete"',
    '"completed"',
    'actionType === "no_show"',
    '"no_show"',
    'currentUsedCount',
    'currentRemainingCount',
    'usedCountDelta: 1',
    'remainingCountDelta: -1',
    'nextUsedCount',
    'nextRemainingCount',
    'currentStatus: currentPackageStatus',
    'nextStatus: nextPackageStatus',
    'const wouldCreate = Boolean(',
    'uniqueBlockedReasons.length === 0',
    'wouldCreate,',
    'sourceType: "privateReservation"',
    'sourceId: reservationId',
    'deltaCount: -1',
    'private_reservation_completed_deduct',
    'private_reservation_no_show_deduct',
    'duplicateExists',
    'currentState',
    'proposedState',
    'deductionApplied: true',
    'deductionPackageId',
    'deductionCreditTransactionId',
    'normalizedPlan',
    'blockedReasons',
    'warnings',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  [
    'reservation_missing',
    'academy_mismatch',
    'reservation_not_active',
    'already_completed',
    'already_no_show',
    'reservation_cancelled',
    'deduction_already_applied',
    'package_missing',
    'package_academy_mismatch',
    'package_student_mismatch',
    'package_not_active',
    'package_remaining_insufficient',
    'credit_transaction_already_exists',
    'invalid_action',
  ].forEach((token) => {
    expect(planBlock).toContain(token);
  });

  expect(callableBlock).toContain(
    '차감 및 수업 상태 변경 내용을 확인한 뒤 '
  );
  expect(callableBlock).toContain(
    '차단 사유를 확인한 뒤 수강권 또는 예약 상태를 먼저 확인하세요.'
  );
});

test('outcome preview lookup is read-only and transaction-capable', () => {
  const functionsSource = readSource('functions/index.js');
  const previewBlock = boundedSource(
    functionsSource,
    'function mapPrivateReservationOutcomePackageBlockedReason(',
    'async function applyPrivateReservationOutcomeWithDeductionInTransaction('
  );

  [
    '.collection("privateLessonReservations")',
    '.collection("privateLessonSlots")',
    '.collection("studentPackages")',
    '.collection("creditTransactions")',
    'isPrivatePackageForReservation',
    'sortPrivatePackageCandidates',
    'buildDeductionKey',
    'getNextStudentPackageStatus',
    'transaction = null',
    'await transaction.get(refOrQuery)',
    'await refOrQuery.get()',
  ].forEach((token) => {
    expect(previewBlock).toContain(token);
  });

  [
    'runTransaction',
    'writeBatch',
    'transaction.set',
    'transaction.update',
    'transaction.create',
    'transaction.delete',
    '.set(',
    '.update(',
    '.create(',
    '.delete(',
    'setDoc',
    'addDoc',
    'updateDoc',
    'deleteDoc',
    'applyPrivateReservationOutcomeWithDeductionInTransaction',
  ].forEach((token) => {
    expect(previewBlock).not.toContain(token);
  });

  expect(functionsSource).toContain(
    'exports.commitPrivateLessonOutcomeAction'
  );
});

test('outcome preview plan hash is canonical and excludes display-only data', () => {
  const functionsSource = readSource('functions/index.js');
  const hashBlock = boundedSource(
    functionsSource,
    'function buildPrivateReservationOutcomePlanHashCurrentState(',
    'function mapPrivateReservationOutcomePackageBlockedReason('
  );
  const callableBlock = boundedSource(
    functionsSource,
    'exports.previewPrivateLessonOutcomeAction = onCall(',
    'async function applyPrivateReservationOutcomeWithDeductionInTransaction('
  );

  [
    'hashPrivateReservationOutcomeActionValue',
    'stableStringify',
    '.createHash("sha256")',
    'version: 1',
    'actorUid',
    'academyId',
    'reservationId',
    'requestId',
    'actionType',
    'currentState',
    'blockedReasons',
    '.sort()',
    'normalizedPlan',
    'planHash',
  ].forEach((token) => {
    expect(`${hashBlock}\n${callableBlock}`).toContain(token);
  });

  [
    'warnings:',
    'nextStep:',
    'actorName:',
    'Date.now()',
    'serverTimestamp()',
  ].forEach((token) => {
    expect(hashBlock).not.toContain(token);
  });
});

test('legacy outcome write and reverse flows remain intact', () => {
  const functionsSource = readSource('functions/index.js');
  const writeHelperBlock = boundedSource(
    functionsSource,
    'async function applyPrivateReservationOutcomeWithDeductionInTransaction(',
    'exports.markPrivateReservationOutcome = onCall('
  );
  const markBlock = boundedSource(
    functionsSource,
    'exports.markPrivateReservationOutcome = onCall(',
    'exports.updateTeacherStudentPackageCounts = onCall('
  );
  const reverseBlock = boundedSource(
    functionsSource,
    'exports.reversePrivateReservationOutcome = onCall(',
    'exports.bootstrapAdmin = onCall('
  );

  [
    'transaction.update(packageRef',
    'transaction.update(reservationRef',
    'transaction.set(creditRef',
    'sourceType: "privateReservation"',
    'deltaCount: -1',
    'deductionApplied: true',
    'deductionPackageId',
    'deductionCreditTransactionId',
    'no behavior change',
    'response shape',
  ].forEach((token) => {
    expect(writeHelperBlock).toContain(token);
  });
  [
    'const outcome = requireString(data, "outcome")',
    '["completed", "no_show"].includes(outcome)',
    'canMarkPrivateReservationOutcome',
    'db.runTransaction',
    'applyPrivateReservationOutcomeWithDeductionInTransaction',
  ].forEach((token) => {
    expect(markBlock).toContain(token);
  });
  expect(reverseBlock).not.toContain(
    'previewPrivateLessonOutcomeAction'
  );
  expect(reverseBlock).not.toContain(
    'buildPrivateReservationOutcomePlan'
  );
});

test('deduction-aware outcome preview UI is wired from the blocked status preview', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  );
  const handlerBlock = boundedSource(
    dashboardSource,
    'async function previewPrivateLessonOutcomeActionOnServer()',
    'const studentsSectionProps = {'
  );
  const modalOutcomeBlock = boundedSource(
    modalSource,
    'const showOutcomePreviewEntry =',
    '{preview ? ('
  );
  const combinedSource = `${dashboardSource}\n${modalSource}`;

  [
    'previewPrivateLessonOutcomeActionOnServer',
    'privateLessonOutcomePreviewBusy',
    'privateLessonOutcomePreviewError',
    'privateLessonOutcomePreviewResult',
    'privateLessonOutcomePreviewPayload',
    'privateLessonOutcomePreviewPlanHash',
    'previewPrivateLessonOutcomeAction',
    'private-lesson-outcome-preview-button',
    '차감 포함 미리보기',
    'private-lesson-outcome-preview-result',
    'package_or_credit_write_required',
    'planHash',
    'currentUsedCount',
    'nextUsedCount',
    'currentRemainingCount',
    'nextRemainingCount',
    'usedCountDelta',
    'remainingCountDelta',
    'creditTransactionPreview',
    'creditTransactionId',
    'wouldCreate',
    'duplicateExists',
    'normalizedPlan',
    'nextStep',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  [
    'reservationId',
    'requestId',
    'actionType',
    'dryRun: true',
    'previewOnly: true',
    'commit: false',
    "httpsCallable(firebaseFunctions, 'previewPrivateLessonOutcomeAction')",
    'setPrivateLessonOutcomePreviewResult(previewData)',
    'setPrivateLessonOutcomePreviewPayload(payload)',
    'setPrivateLessonOutcomePreviewPlanHash(planHash)',
  ].forEach((token) => {
    expect(handlerBlock).toContain(token);
  });

  [
    'Boolean(preview)',
    'hasPackageOrCreditWriteRequirement',
    "['complete', 'no_show'].includes(actionType)",
    'Boolean(reservationId)',
    'isAdmin === true',
    '!outcomePreviewBusy',
    '이 수업은 수강권 차감과 차감 기록 생성이 필요한 수업입니다.',
    'current reservation status',
    'proposed reservation status',
    'current package status → next package status',
    'creditTransactionPreview.wouldCreate',
    '처리 차단 사유가 있습니다',
    '서버 기준 미리보기부터',
  ].forEach((token) => {
    expect(modalOutcomeBlock).toContain(token);
  });
});

test('outcome preview stays read-only and outcome commit uses only its callable', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  );
  const previewHandlerBlock = boundedSource(
    dashboardSource,
    'async function previewPrivateLessonOutcomeActionOnServer()',
    'const studentsSectionProps = {'
  );
  const commitHandlerBlock = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  );

  [
    'commitPrivateLessonOutcomeAction',
    'markPrivateReservationOutcome',
    'writeBatch',
    'runTransaction',
    'setDoc',
    'addDoc',
    'updateDoc',
    'deleteDoc',
    'transaction.set',
    'transaction.update',
    'transaction.create',
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
  ].forEach((token) => {
    expect(previewHandlerBlock).not.toContain(token);
  });

  expect(previewHandlerBlock).toContain('previewPrivateLessonOutcomeAction');
  expect(previewHandlerBlock).toContain('commit: false');
  [
    'markPrivateReservationOutcome',
    'writeBatch',
    'runTransaction',
    'setDoc',
    'addDoc',
    'updateDoc',
    'deleteDoc',
    'transaction.set',
    'transaction.update',
    'transaction.create',
    'commitPrivateLessonStatusAction',
    'previewPrivateLessonOutcomeAction',
    'previewPrivateLessonStatusAction',
  ].forEach((token) => {
    expect(commitHandlerBlock).not.toContain(token);
  });
  expect(commitHandlerBlock).toContain(
    "httpsCallable(firebaseFunctions, 'commitPrivateLessonOutcomeAction')"
  );
  expect((commitHandlerBlock.match(/httpsCallable\(/g) || []).length).toBe(1);
});

test('deduction-aware outcome commit reuses the exact preview identity and plan', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const commitHandlerBlock = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  );

  [
    'privateLessonOutcomePreviewPayload',
    'privateLessonOutcomePreviewPlanHash',
    '...privateLessonOutcomePreviewPayload',
    'planHash: privateLessonOutcomePreviewPlanHash',
    'commit: true',
    'dryRun: false',
    'previewOnly: false',
    "['complete', 'no_show'].includes(actionType)",
    'previewPayload.reservationId !== reservationId',
    'previewPayload.actionType !== actionType',
    'previewData.requestId !== requestId',
    "String(previewData.planHash || '').trim() !== planHash",
  ].forEach((token) => {
    expect(commitHandlerBlock).toContain(token);
  });

  [
    'Date.now()',
    'Math.random()',
    'privateLessonOutcomePreview_',
    'requestId = `',
  ].forEach((token) => {
    expect(commitHandlerBlock).not.toContain(token);
  });
});

test('deduction-aware outcome commit has frontend guards and dedicated confirmation UI', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  );
  const commitHandlerBlock = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  );
  const combinedSource = `${dashboardSource}\n${modalSource}`;

  [
    'commitPrivateLessonOutcomeActionOnServer',
    'commitPrivateLessonOutcomeAction',
    'privateLessonOutcomeCommitBusy',
    'privateLessonOutcomeCommitError',
    'privateLessonOutcomeCommitResult',
    'private-lesson-outcome-commit-confirm',
    'private-lesson-outcome-commit-checkbox',
    'private-lesson-outcome-commit-button',
    '차감 포함 실제 처리 전 최종 확인',
    '차감 포함 수업 처리',
    'private-lesson-outcome-commit-result',
    'private-lesson-outcome-commit-error',
    'planHash',
    'idempotentReplay',
    'batchId',
    'creditTransactionId',
    '같은 요청을 반복해서 누르지 마세요',
    '차감 포함 미리보기를 다시 실행하세요',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });

  [
    'if (!isAdmin)',
    'if (!reservationId)',
    "['complete', 'no_show'].includes(actionType)",
    'if (!privateLessonOutcomePreviewResult)',
    'if (!privateLessonOutcomePreviewPayload)',
    'if (!requestId)',
    'if (!planHash)',
    'previewBlockedReasons.length > 0',
    'creditTransactionPreview.duplicateExists === true',
    "!packageImpact || typeof packageImpact !== 'object' || !packageImpact.packageId",
    'if (!privateLessonOutcomeCommitConfirmed)',
    'privateLessonOutcomeCommitBusy || privateLessonOutcomeCommitResult',
  ].forEach((token) => {
    expect(commitHandlerBlock).toContain(token);
  });

  [
    'const outcomePreviewPassed =',
    'outcomeBlockedReasons.length === 0',
    'outcomeCreditTransactionPreview.duplicateExists !== true',
    'Boolean(outcomePackageImpact?.packageId)',
    'outcomePreviewMatchesCurrentTargetAndAction',
    'outcomeCommitConfirmed',
    'Boolean(outcomeCommitResult)',
    '상태만 처리 경로',
    '수강권 차감이 필요하여 사용할 수 없습니다',
    'private-lesson-status-action-commit-button',
  ].forEach((token) => {
    expect(modalSource).toContain(token);
  });
});

test('outcome preview state clears on every stale boundary and status commit remains guarded', () => {
  const dashboardSource = readSource('Dashboard.jsx');
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  );
  const clearBlock = boundedSource(
    dashboardSource,
    'function clearPrivateLessonOutcomePreview()',
    'async function previewPrivateLessonStatusActionOnServer()'
  );
  const commitClearBlock = boundedSource(
    dashboardSource,
    'function clearPrivateLessonOutcomeCommitState()',
    'function clearPrivateLessonOutcomePreview()'
  );
  const outcomePreviewHandlerBlock = boundedSource(
    dashboardSource,
    'async function previewPrivateLessonOutcomeActionOnServer()',
    'const studentsSectionProps = {'
  );
  const dateClearBlock = boundedSource(
    dashboardSource,
    'useEffect(() => {\n    if (privateLessonOutcomeCommitBusyRef.current) return',
    'const {\n    groupModal,'
  );

  [
    "setPrivateLessonOutcomePreviewError('')",
    'setPrivateLessonOutcomePreviewResult(null)',
    'setPrivateLessonOutcomePreviewPayload(null)',
    "setPrivateLessonOutcomePreviewPlanHash('')",
    'clearPrivateLessonOutcomePreview()',
    'openPrivateLessonStatusActionPreview',
    'closePrivateLessonStatusActionPreview',
    'selectPrivateLessonStatusActionMode',
  ].forEach((token) => {
    expect(clearBlock).toContain(token);
  });

  [
    'privateLessonOutcomeCommitBusyRef.current',
    'setPrivateLessonOutcomeCommitBusy(false)',
    'setPrivateLessonOutcomeCommitError(null)',
    'setPrivateLessonOutcomeCommitResult(null)',
    'setPrivateLessonOutcomeCommitConfirmed(false)',
  ].forEach((token) => {
    expect(commitClearBlock).toContain(token);
  });
  expect(clearBlock).toContain('clearPrivateLessonOutcomeCommitState()');
  expect(outcomePreviewHandlerBlock).toContain('clearPrivateLessonOutcomePreview()');

  [
    'if (privateLessonOutcomeCommitBusyRef.current) return',
    'setPrivateLessonOutcomePreviewBusy(false)',
    "setPrivateLessonOutcomePreviewError('')",
    'setPrivateLessonOutcomePreviewResult(null)',
    'setPrivateLessonOutcomePreviewPayload(null)',
    "setPrivateLessonOutcomePreviewPlanHash('')",
    'setPrivateLessonOutcomeCommitBusy(false)',
    'setPrivateLessonOutcomeCommitError(null)',
    'setPrivateLessonOutcomeCommitResult(null)',
    'setPrivateLessonOutcomeCommitConfirmed(false)',
    '[selectedDateString, calendarMonth]',
  ].forEach((token) => {
    expect(dateClearBlock).toContain(token);
  });

  expect(dashboardSource).toContain('commitPrivateLessonStatusActionOnServer');
  expect(modalSource).toContain('private-lesson-status-action-commit-button');
  expect(modalSource).toContain('const previewPassed =');
  expect(modalSource).toContain('blockedReasons.length === 0');
  expect(modalSource).toContain('!outcomeCommitBusy');
  expect(modalSource).toContain('Boolean(outcomeCommitResult)');
});

test('outcome preview UI changes stay inside the approved frontend and test scope', () => {
  const allowedPaths = new Set([
    'Dashboard.jsx',
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx',
    'tests/private-lesson-outcome-actions.spec.js',
    'tests/private-lesson-status-actions.spec.js',
  ]);
  const changedPaths = execFileSync('git', ['diff', '--name-only'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  expect(changedPaths.filter((changedPath) => !allowedPaths.has(changedPath))).toEqual([]);
});

test('outcome preview UI keeps backend and protected files unchanged', () => {
  const protectedPaths = [
    'functions/index.js',
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
