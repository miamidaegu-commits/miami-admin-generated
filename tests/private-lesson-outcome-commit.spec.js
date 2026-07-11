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
    '32e200fa13aceb2286e3bcd9795f59095c9545c53616ae5eb954d2e7adab4a4a'
  );
  expect(sha256(markBlock)).toBe(
    '4b6568e89c46d15943b34cc93f4a451da458aac012c7f55e48df16c587d951ba'
  );
  expect(sha256(reverseBlock)).toBe(
    '6cf0f678829ef5d78afe5ca4686450f20167dbe00f8a077fc92c66173b16023b'
  );
});

test('outcome commit changes stay inside backend and targeted tests', () => {
  const allowedPaths = new Set([
    'functions/index.js',
    'tests/private-lesson-outcome-actions.spec.js',
    'tests/private-lesson-outcome-commit.spec.js',
    'tests/private-lesson-outcome-commit.emulator.cjs',
    'tests/private-lesson-status-actions.spec.js',
    'tests/private-reservation-outcome.spec.js',
  ]);
  const changedPaths = execFileSync(
    'git',
    ['diff', '--name-only', 'product-version', '--'],
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
