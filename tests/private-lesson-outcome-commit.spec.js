import crypto from 'node:crypto';
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

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('deduction-aware outcome commit callable is exported and guarded', () => {
  const functionsSource = readSource('functions/index.js');
  const callableBlock = boundedSource(
    functionsSource,
    'exports.commitPrivateLessonOutcomeAction = onCall(',
    'exports.reversePrivateReservationOutcome = onCall('
  );
  const helperBlock = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS',
    'function normalizePrivateReservationOutcomeHashNumber('
  );
  const combinedSource = `${helperBlock}\n${callableBlock}`;

  [
    'commitPrivateLessonOutcomeAction',
    'PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS = ["complete", "no_show"]',
    'if (!request.auth)',
    'data.commit !== true',
    'data.dryRun !== false',
    'data.previewOnly !== false',
    'const planHash = requireString(data, "planHash")',
    'invalid_plan_hash',
    'unsupported_action_type',
    'committed: true',
    'idempotentReplay',
    'outcome',
    'packageId',
    'creditTransactionId',
    'updated',
    'normalizedPlan',
  ].forEach((token) => {
    expect(combinedSource).toContain(token);
  });
});

test('outcome checkpoint enforces deterministic replay and conflict handling', () => {
  const functionsSource = readSource('functions/index.js');
  const helperBlock = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS',
    'function normalizePrivateReservationOutcomeHashNumber('
  );

  [
    'privateLessonOutcomeActionBatches',
    'buildPrivateLessonOutcomeActionBatchId',
    '"privateLessonOutcomeAction"',
    'buildPrivateLessonOutcomeActionPayloadHash',
    'actorUid',
    'requestId',
    'planHash',
    'payloadHash',
    'checkpoint.payloadHash !== payloadHash',
    'checkpoint.status !== "completed"',
    'request_id_conflict',
    'checkpoint_not_completed',
    'buildPrivateLessonOutcomeCommitReplay',
    'idempotentReplay: true',
    'transaction.create(batchRef, checkpoint)',
    'status: "completed"',
    'helperResult',
    'createdAt: now',
    'completedAt: now',
  ].forEach((token) => {
    expect(helperBlock).toContain(token);
  });
});

test('outcome commit validates a fresh plan before the unchanged writer', () => {
  const functionsSource = readSource('functions/index.js');
  const allCommitHelpers = boundedSource(
    functionsSource,
    'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS',
    'function normalizePrivateReservationOutcomeHashNumber('
  );
  const helperBlock = boundedSource(
    functionsSource,
    'async function commitPrivateLessonOutcomeAction({db, auth, data})',
    'function normalizePrivateReservationOutcomeHashNumber('
  );

  const checkpointReadIndex = helperBlock.indexOf(
    'const batchSnap = await transaction.get(batchRef)'
  );
  const membershipReadIndex = helperBlock.indexOf(
    'const membershipSnap = await transaction.get(membershipRef)'
  );
  const targetReadIndex = helperBlock.indexOf(
    'resolvePrivateReservationOutcomePreviewTarget'
  );
  const planIndex = helperBlock.indexOf(
    'buildPrivateReservationOutcomePlan'
  );
  const hashIndex = helperBlock.indexOf(
    'buildPrivateReservationOutcomePlanHash'
  );
  const writerIndex = helperBlock.indexOf(
    'applyPrivateReservationOutcomeWithDeductionInTransaction'
  );
  const checkpointWriteIndex = helperBlock.indexOf(
    'transaction.create(batchRef, checkpoint)'
  );

  expect(checkpointReadIndex).toBeGreaterThanOrEqual(0);
  expect(membershipReadIndex).toBeGreaterThan(checkpointReadIndex);
  expect(targetReadIndex).toBeGreaterThan(membershipReadIndex);
  expect(planIndex).toBeGreaterThan(targetReadIndex);
  expect(hashIndex).toBeGreaterThan(planIndex);
  expect(writerIndex).toBeGreaterThan(hashIndex);
  expect(checkpointWriteIndex).toBeGreaterThan(writerIndex);

  [
    'transaction,',
    'actualPlanHash !== validation.planHash',
    'preview_stale',
    'if (!plan.ok)',
    'plan.blockedReasons',
    'assertPrivateLessonOutcomeHelperMatchesPlan',
  ].forEach((token) => {
    expect(helperBlock).toContain(token);
  });
  expect(allCommitHelpers).toContain('helper_plan_mismatch');

  [
    'transaction.update(packageRef',
    'transaction.update(reservationRef',
    'transaction.set(creditRef',
  ].forEach((token) => {
    expect(helperBlock).not.toContain(token);
  });
});

test('legacy outcome writer, mark callable, and reverse callable are exact', () => {
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

  expect(sha256(writeHelperBlock)).toBe(
    '7754c1adf5877720576d5e50a6873ebb6a5f2f050723c3940d02f984f1232e35'
  );
  expect(sha256(markBlock)).toBe(
    'd9f323cb7b215aab6492cdf61b143a067fe1839d5ec00ed0355c978dacebfd99'
  );
  expect(sha256(reverseBlock)).toBe(
    '6f558931bdfcf56849d5aae04325ba79ef5771b2222d5825b95f5e000a2be023'
  );
});

test('outcome commit changes stay inside backend and targeted tests', () => {
  const allowedPaths = new Set([
    'AuthContext.jsx',
    'Dashboard.jsx',
    'firestore.rules',
    'functions/index.js',
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx',
    'src/features/dashboard/hooks/usePrivateLessonFlow.js',
    'src/features/dashboard/sections/CalendarSection.jsx',
    'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx',
    'scripts/run-fixed-private-outcome-ledger-audit.mjs',
    'tests/fixed-private-lesson-outcome-audit.emulator.cjs',
    'tests/fixed-private-lesson-outcome-action.emulator.cjs',
    'tests/fixed-private-lesson-outcome-action.spec.js',
    'tests/fixed-private-lesson-outcome-frontend.spec.js',
    'tests/fixed-private-outcome-audit-runner.test.mjs',
    'tests/fixed-private-outcome-audit-v2.spec.js',
    'tests/fixed-private-remediation-evidence-v1.spec.js',
    'tests/fixed-private-remediation-evidence.emulator.cjs',
    'tests/fixed-private-remediation-manifest-runner.test.mjs',
    'tests/private-fixed-slot-assignment.spec.js',
    'tests/private-lesson-outcome-actions.spec.js',
    'tests/private-lesson-outcome-commit.spec.js',
    'tests/private-lesson-outcome-commit.emulator.cjs',
    'tests/private-lesson-status-actions.spec.js',
    'tests/private-reservation-outcome.spec.js',
  ]);
  const changedPaths = execFileSync(
    'git',
    ['diff', '--name-only', 'origin/product-version', '--'],
    { cwd: process.cwd(), encoding: 'utf8' }
  )
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  expect(changedPaths.every((changedPath) => allowedPaths.has(changedPath))).toBe(true);
});

test('outcome commit source passes Node syntax check', () => {
  execFileSync('node', ['--check', 'functions/index.js'], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
});
