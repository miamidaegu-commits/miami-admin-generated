import fs from 'node:fs'
import path from 'node:path'
import { test, expect } from '@playwright/test'

function readSource(relativePath) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

function boundedSource(source, startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle)
  expect(start).toBeGreaterThanOrEqual(0)
  const end = source.indexOf(endNeedle, start + startNeedle.length)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

test('fixed ledger classifier distinguishes canonical, legacy, and inconsistent rows', () => {
  const source = readSource('functions/index.js')
  const classifierSource = boundedSource(
    source,
    'function classifyFixedPrivateDeductionLedger(',
    'function fixedPrivateLessonCountsByDate('
  )
  const classify = new Function(
    'normalizeId',
    'FIXED_PRIVATE_DEDUCTION_LEDGER',
    `${classifierSource}; return classifyFixedPrivateDeductionLedger;`
  )(
    (value) => String(value || '').trim(),
    'reservation_v1'
  )
  const canonical = classify({
    lesson: { fixedPrivateDeductionLedger: 'reservation_v1' },
    reservation: { fixedPrivateDeductionLedger: 'reservation_v1' },
    slot: { fixedPrivateDeductionLedger: 'reservation_v1' },
  })
  const legacy = classify({ lesson: {}, reservation: {}, slot: {} })
  const inconsistent = classify({
    lesson: { fixedPrivateDeductionLedger: 'reservation_v1' },
    reservation: {},
    slot: {},
  })

  expect(canonical.mode).toBe('canonical')
  expect(legacy.mode).toBe('legacy')
  expect(inconsistent.mode).toBe('inconsistent')
})

test('server-owned assignments and renewals stamp reservation ledger marker', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const functionsSource = readSource('functions/index.js')
  const rulesSource = readSource('firestore.rules')
  const dashboardAssignment = boundedSource(
    dashboardSource,
    'async function createPrivateFixedSlotAssignment(backfillConfirmed = false)',
    'async function createPrivateAvailabilityTemplate()'
  )
  const renewalPayloads = boundedSource(
    functionsSource,
    'function buildFixedPrivateRenewalOccurrencePayloads(',
    'function getFixedPrivateRenewalPackageTitle('
  )

  expect(dashboardAssignment).toContain(
    "httpsCallable(firebaseFunctions, 'createFixedPrivateLessonAssignment')"
  )
  expect(dashboardAssignment).not.toContain('batch.set(')
  expect(dashboardAssignment).not.toContain('fixedPrivateDeductionLedger')
  expect(
    renewalPayloads.match(/fixedPrivateDeductionLedger: "reservation_v1"/g)
  ).toHaveLength(3)
  expect(rulesSource).toContain('function isFixedPrivateReservationData(data)')
  expect(rulesSource).toContain(
    '!isFixedPrivateReservationData(request.resource.data)'
  )
})

test('fixed assignment callable owns three-way canonical creation', () => {
  const source = readSource('functions/index.js')
  const transactionSource = boundedSource(
    source,
    'async function runFixedPrivateAssignmentWriteTransaction(',
    'const FIXED_PRIVATE_RESCHEDULE_SCOPE_MODES'
  )
  const callableSource = boundedSource(
    source,
    'exports.createFixedPrivateLessonAssignment = onCall(',
    'exports.createFixedPrivateLessonRenewal = onCall('
  )

  expect(callableSource).toContain('requireAcademyAdmin(')
  expect(callableSource).toContain('runFixedPrivateAssignmentWriteTransaction')
  expect(transactionSource).toContain('fixedPrivateAssignmentBatches')
  expect(transactionSource).toContain('assertFixedPrivateRenewalExistingPackage')
  expect(transactionSource).toContain('assertFixedPrivateRenewalNoScheduleConflicts')
  expect(transactionSource).toContain('assertNoFixedPrivateAssignmentStudentConflicts')
  expect(transactionSource.match(/transaction\.create\(refs\./g)).toHaveLength(3)
  expect(source).toContain('fixedPrivateSlot_${compactDate}_${slotKey}')
  expect(source).toContain('fixedPrivateLesson_${compactDate}_${lessonKey}')
})

test('fixed provenance rules deny client writes while preserving direct paths', () => {
  const rulesSource = readSource('firestore.rules')
  const lessonsRules = boundedSource(
    rulesSource,
    'match /lessons/{lessonId}',
    'match /lessonRequests/{requestId}'
  )
  const slotRules = boundedSource(
    rulesSource,
    'match /privateLessonSlots/{slotId}',
    'match /privateLessonAvailabilityTemplates/{templateId}'
  )
  const reservationRules = boundedSource(
    rulesSource,
    'match /privateLessonReservations/{reservationId}',
    'match /dailyMaterials/{materialId}'
  )
  const creditRules = boundedSource(
    rulesSource,
    'match /creditTransactions/{txId}',
    'match /notificationEvents/{eventId}'
  )

  expect(lessonsRules).toContain('!isFixedLessonData(request.resource.data)')
  expect(lessonsRules).toContain('isFixedLessonData(resource.data)')
  expect(lessonsRules).toContain('isFixedLessonData(request.resource.data)')
  expect(slotRules).not.toContain('validPrivateFixedSlotAdminCreateShape()')
  expect(slotRules).toContain('isFixedPrivateSlotData(resource.data)')
  expect(slotRules).toContain('isFixedPrivateSlotData(request.resource.data)')
  expect(reservationRules).toContain('request.resource.data.source == "student"')
  expect(reservationRules).not.toContain('validPrivateFixedReservationAdminCreate')
  expect(creditRules).toContain('!isFixedPrivateCreditData(request.resource.data)')
})

test('dashboard recomputation excludes only marked lessons and counts reservation evidence', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const recomputeSource = boundedSource(
    dashboardSource,
    'async function recomputePrivatePackageUsage(',
    'async function createGroupLessonsInDateRange('
  )
  const autoSyncSource = boundedSource(
    dashboardSource,
    'const expectedUsedByPackageId = new Map()',
    'privatePackagesById.forEach('
  )

  for (const source of [recomputeSource, autoSyncSource]) {
    expect(source).toContain("fixedPrivateDeductionLedger === 'reservation_v1'")
    expect(source).toContain('deductionApplied')
    expect(source).toContain("'completed'")
    expect(source).toContain("'no_show'")
  }
  expect(recomputeSource).not.toContain(
    'privateLessonReservations usage lookup skipped'
  )
  expect(recomputeSource).not.toContain('.catch((error) =>')
})

test('automatic private deduction explicitly skips fixed reservations', () => {
  const functionsSource = readSource('functions/index.js')
  const skipHelper = boundedSource(
    functionsSource,
    'function getPrivateReservationSkipReason(',
    'function incrementDeductionSkip('
  )
  const autoDeduct = boundedSource(
    functionsSource,
    'async function autoDeductPrivateReservation(',
    'async function autoDeductGroupStudent('
  )

  expect(skipHelper).toContain('classifyFixedPrivateProvenance(reservation, ...linkedRows)')
  expect(skipHelper).toContain('return "unsupportedFixedPrivate"')
  expect(autoDeduct).toContain('getPrivateReservationSkipReason(reservation)')
  expect(autoDeduct).toContain('getPrivateLinkedLessonId(reservation, slot)')
  expect(autoDeduct).toContain('classifyFixedPrivateProvenance(')
})

test('generic slot reserve, close, and reopen guard linked fixed provenance before writes', () => {
  const functionsSource = readSource('functions/index.js')
  const reserveSource = boundedSource(
    functionsSource,
    'exports.reservePrivateLessonSlot = onCall(',
    'exports.cancelPrivateLessonReservation = onCall('
  )
  const closeSource = boundedSource(
    functionsSource,
    'exports.adminClosePrivateLessonSlot = onCall(',
    'exports.adminReopenPrivateLessonSlot = onCall('
  )
  const reopenSource = boundedSource(
    functionsSource,
    'exports.adminReopenPrivateLessonSlot = onCall(',
    'exports.adminCancelPrivateLessonReservation = onCall('
  )

  expect(reserveSource).toContain('getPrivateLinkedLessonId(')
  expect(reserveSource).toContain('assertNotFixedPrivateDirectReservation(')
  for (const source of [closeSource, reopenSource]) {
    expect(source).toContain('readPrivateSlotLinkedProvenance({')
    expect(source).toContain('assertNotFixedPrivateDirectCancel({')
    expect(source.indexOf('assertNotFixedPrivateDirectCancel({')).toBeLessThan(
      source.indexOf('transaction.update(')
    )
  }
})

test('fixed preview and commit expose guarded read and transaction contracts', () => {
  const functionsSource = readSource('functions/index.js')
  const callableSource = boundedSource(
    functionsSource,
    'exports.previewFixedPrivateLessonOutcomeAction = onCall(',
    'exports.previewPrivateLessonOutcomeAction = onCall('
  )

  const contractTokens = [
    'previewFixedPrivateLessonOutcomeAction',
    'commitFixedPrivateLessonOutcomeAction',
    'fixedPrivateLessonOutcomeActionBatches',
    'request_id_conflict',
    'checkpoint_not_completed',
    'preview_stale',
    'package_aggregate_conflict',
    'credit_without_matching_deduction_evidence',
    '${label}_deduction_cancelled',
    'inconsistent_ledger_markers',
    'legacy_lesson_not_counted',
    'transaction.update(target.packageDoc.ref',
    'transaction.update(target.reservationDoc.ref',
    'transaction.update(target.lessonDoc.ref',
    'transaction.update(target.slotDoc.ref',
    'transaction.create(target.creditDoc.ref',
    'transaction.create(batchRef',
  ]
  contractTokens.forEach((token) => {
    expect(functionsSource).toContain(token)
  })

  expect(callableSource).toContain('if (!request.auth)')
  expect(functionsSource).toContain('ledgerTransition')
  expect(functionsSource).toContain('"lesson_to_reservation"')
  expect(functionsSource).toContain('"reservation_increment"')
})

test('fixed outcome ledger audit is admin-only, bounded, and read-only', () => {
  const functionsSource = readSource('functions/index.js')
  const auditSource = boundedSource(
    functionsSource,
    'const FIXED_PRIVATE_OUTCOME_AUDIT_MAX_LIMIT',
    'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS'
  )
  const auditCallable = boundedSource(
    functionsSource,
    'exports.inspectFixedPrivateLessonOutcomeLedger = onCall(',
    'exports.previewFixedPrivateLessonOutcomeAction = onCall('
  )

  expect(auditCallable).toContain('if (!request.auth)')
  expect(auditSource).toContain('requireAcademyAdmin')
  expect(auditSource).toContain('data.dryRun !== true')
  expect(auditSource).toContain('data.previewOnly !== true')
  expect(auditSource).toContain('data.commit !== false')
  expect(auditSource).toContain('FIXED_PRIVATE_OUTCOME_AUDIT_MAX_LIMIT')
  expect(auditSource).toContain('FIXED_PRIVATE_OUTCOME_AUDIT_SAMPLE_LIMIT')
  expect(auditSource).toContain('FIXED_PRIVATE_OUTCOME_AUDIT_LEDGER_ROW_LIMIT')
  expect(auditSource).toContain('nextCursor')
  ;[
    'canonicalReady',
    'legacyReady',
    'alreadyReservationDeducted',
    'conflict',
    'missingLink',
    'packageAggregateDiagnostics',
  ].forEach((token) => expect(auditSource).toContain(token))

  const writeTokens = [
    'runTransaction',
    'writeBatch',
    '.set(',
    '.create(',
    'transaction.update',
    'batch.update',
    '.ref.update',
    '.delete(',
    'bulkWriter',
  ]
  writeTokens.forEach((token) => {
    expect(auditCallable).not.toContain(token)
    expect(auditSource).not.toContain(token)
  })
  ;[
    'studentName',
    'email',
    'phone',
    'password',
  ].forEach((secretField) => {
    expect(auditSource).not.toContain(secretField)
  })
})

test('legacy direct reservation paths reject fixed private sources', () => {
  const source = readSource('functions/index.js')
  const directGuard = boundedSource(
    source,
    'function assertNotFixedPrivateDirectReservation(...rows) {',
    'function rowHasFixedPrivateProvenance('
  )
  expect(source).toContain(
    'const FIXED_PRIVATE_DIRECT_PATH_BLOCK_REASON =\n' +
      '  "fixed_private_requires_fixed_outcome_action"'
  )
  expect(source).toContain('function classifyFixedPrivateProvenance(...rows)')
  expect(source).toContain('function assertNotFixedPrivateDirectReservation(')
  expect(source).toContain('if (isFixedPrivateDirectTarget(target))')
  expect(source).toContain(
    'if (classifyFixedPrivateProvenance(\n' +
      '      reservationData,\n' +
      '      slot,\n' +
      '      lesson,\n' +
      '  ).isFixed)'
  )

  const helper = boundedSource(
    source,
    'async function applyPrivateReservationOutcomeWithDeductionInTransaction(',
    'exports.markPrivateReservationOutcome = onCall('
  )
  const reverseTransaction = boundedSource(
    source,
    'async function reversePrivateReservationOutcomeInTransaction(',
    'exports.reversePrivateReservationOutcome = onCall('
  )
  const reverse = boundedSource(
    source,
    'exports.reversePrivateReservationOutcome = onCall(',
    'exports.bootstrapAdmin = onCall('
  )
  expect(helper).toContain(
    'assertNotFixedPrivateDirectReservation(reservation, slot, linkedLesson)'
  )
  expect(reverse).toContain(
    'return await reversePrivateReservationOutcomeInTransaction('
  )
  expect(directGuard).toContain(
    'if (!classifyFixedPrivateProvenance(...rows).isFixed) return;'
  )
  expect(directGuard).toContain(
    '{blockedReasons: [FIXED_PRIVATE_DIRECT_PATH_BLOCK_REASON]}'
  )
  const firstGuardIndex = reverseTransaction.indexOf(
    'assertNotFixedPrivateDirectReservation(reservation)'
  )
  const linkedGuardIndex = reverseTransaction.indexOf(
    'assertNotFixedPrivateDirectReservation(reservation, slot, linkedLesson)'
  )
  const accountingIndex = reverseTransaction.indexOf(
    'applyPrivateReservationOutcomeReversalAccountingInTransaction('
  )
  expect(firstGuardIndex).toBeGreaterThanOrEqual(0)
  expect(linkedGuardIndex).toBeGreaterThan(firstGuardIndex)
  expect(accountingIndex).toBeGreaterThan(linkedGuardIndex)
})

test('teacher ownership uses strict uid, teacher id, key, then unique name hierarchy', () => {
  const source = readSource('functions/index.js')
  const identity = boundedSource(
    source,
    'function getPrivateTeacherIdentity(',
    'function getPrivateTeacherScopeKeys('
  )
  const ownership = boundedSource(
    source,
    'function isTeacherOwnPrivateLessonTarget(',
    'function canPreviewPrivateLessonStatusAction('
  )
  expect(identity).toContain('uidIds')
  expect(identity).toContain('teacherIds')
  expect(identity).toContain('stableIds')
  expect(identity).toContain('teacherKeys')
  expect(identity).toContain('names')
  expect(identity).toContain('typeof value === "string" ? value : ""')
  expect(identity).toContain('uidIds: Array.from(new Set(uidIds))')
  expect(identity).toContain(
    'if (targetUids.length > 0)'
  )
  expect(identity).toContain(
    'if (targetTeacherIds.length > 0)'
  )
  expect(identity).toContain('if (targetKeys.length > 0)')
  expect(source).toContain('resolveUniqueActiveTeacherNameOwner')
  expect(source).toContain('"teacher_identity_ambiguous"')
  expect(ownership).toContain('privateTeacherIdentityMatches(')
  expect(ownership).toContain('if (targetIdentity.conflict) return false')
  expect(ownership).not.toContain('target.packageDoc')
})

test('fixed actions enforce independent three-way state and safe IDs', () => {
  const source = readSource('functions/index.js')
  const plan = boundedSource(
    source,
    'function buildFixedPrivateOutcomePlan({',
    'function fixedPrivateOutcomeHashCurrentState('
  )
  const idGuard = boundedSource(
    source,
    'const CALLABLE_DOCUMENT_ID_MAX_LENGTH',
    'function getPrivateStatusActionPermission('
  )
  ;[
    'lesson_not_active',
    'reservation_not_active',
    'slot_not_reserved',
    'teacher_identity_mismatch',
    'duplicate_fixed_occurrence_contribution',
  ].forEach((token) => expect(plan).toContain(token))
  const rowFlags = boundedSource(
    source,
    'function fixedPrivateOutcomeRowFlagReasons(',
    'function buildFixedPrivateOutcomePlan({'
  )
  expect(rowFlags).toContain('`${label}_no_deduction`')
  expect(rowFlags).toContain('`${label}_deduction_cancelled`')
  expect(rowFlags).toContain('`${label}_cancelled`')
  expect(rowFlags).toContain('`${label}_released`')
  expect(idGuard).toContain('CALLABLE_DOCUMENT_ID_MAX_LENGTH = 200')
  expect(idGuard).toContain('CALLABLE_REQUEST_ID_MAX_LENGTH = 128')
  expect(idGuard).toContain('normalized.includes("/")')
  expect(source).toContain('validateCallableDocumentId(')
  expect(source).toContain('validateCallableRequestId(')
})

test('fixed reverse action validation is exact and fail closed', () => {
  const source = readSource('functions/index.js')
  const actionContract = boundedSource(
    source,
    'const FIXED_PRIVATE_OUTCOME_ACTIONS = [',
    'function fixedPrivateOutcomeBatchId('
  )
  const allowlist = actionContract.match(
    /const FIXED_PRIVATE_OUTCOME_ACTIONS = \[([\s\S]*?)\];/
  )
  expect(allowlist).not.toBeNull()
  expect(
    [...allowlist[1].matchAll(/"([^"]+)"/g)].map((match) => match[1])
  ).toEqual(['complete', 'no_show', 'reverse_deduction'])
  expect(actionContract).toContain(
    'if (!FIXED_PRIVATE_OUTCOME_ACTIONS.includes(actionType))'
  )
  expect(actionContract).toContain(
    'throw new HttpsError("invalid-argument", "unsupported_action_type")'
  )
  expect(actionContract).toContain('requireString(data, "requestId")')
  expect(actionContract).toContain('requireString(data, "planHash")')
  expect(actionContract).toContain('/^[a-f0-9]{64}$/.test(planHash)')
  expect(actionContract).not.toContain('actionType.startsWith(')
  expect(actionContract).not.toContain('actionType.includes(')
  expect(actionContract).not.toContain('actionType ||')
  expect(actionContract).not.toContain('defaultAction')
})

test('fixed reverse preview pins identity impact hash and write-free planning', () => {
  const source = readSource('functions/index.js')
  const resolver = boundedSource(
    source,
    'async function resolveFixedPrivateOutcomeTarget({',
    'function fixedPrivateOutcomeValuesConflict('
  )
  const reversalPlan = boundedSource(
    source,
    'function buildFixedPrivateOutcomeReversalPlan({',
    'function buildFixedPrivateOutcomePlan({'
  )
  const planHash = boundedSource(
    source,
    'function buildFixedPrivateOutcomePlanHash({',
    'function summarizeFixedPrivateOutcomeTarget('
  )
  const preview = boundedSource(
    source,
    'async function previewFixedPrivateLessonOutcomeAction({',
    'const FIXED_PRIVATE_OUTCOME_AUDIT_MAX_LIMIT'
  )

  expect(resolver).toContain(
    'getPrivateReservationDeductionPointer(reservation)'
  )
  expect(resolver).toContain(
    'buildPrivateReservationOutcomeReversalCreditId(activeDeductionId)'
  )
  expect(resolver).toContain('reversalCreditTransactionId')
  expect(resolver).toContain('reversalCreditDoc')
  expect(resolver).toContain('deductionCycleIdentity')
  ;[
    'currentState',
    'activeDeductionId',
    'originalCreditTransactionId',
    'reversalCreditTransactionId',
    'canonicalDeductionId',
    'deductionCycleNumber',
    'packageUsedCount',
    'packageRemainingCount',
    'usedCountDelta: -1',
    'remainingCountDelta: 1',
    'deltaCount: 1',
    'additionalPackageRestore: 1',
  ].forEach((token) => expect(reversalPlan).toContain(token))
  expect(reversalPlan).toContain(
    'buildPrivateReservationOutcomeReversalCreditId('
  )
  expect(reversalPlan).toContain(
    'buildPrivateReservationOutcomeDeductionCycleIdentity({'
  )
  expect(planHash).toContain('actionType: validation.actionType')
  expect(planHash).toContain(
    'currentState: fixedPrivateOutcomeHashCurrentState(target, plan)'
  )
  expect(planHash).toContain('normalizedPlan: plan.normalizedPlan')
  expect(preview).toContain('resolveFixedPrivateOutcomeTarget({')
  expect(preview).toContain('buildFixedPrivateOutcomePlan({')
  expect(preview).toContain('buildFixedPrivateOutcomePlanHash({')
  expect(preview).toContain('dryRun: true')
  expect(preview).toContain('previewOnly: true')
  expect(preview).toContain('commit: false')
  for (const writeToken of [
    'runTransaction(',
    'transaction.update(',
    'transaction.create(',
    '.set(',
    '.update(',
    '.delete(',
  ]) {
    expect(preview).not.toContain(writeToken)
    expect(reversalPlan).not.toContain(writeToken)
  }
})

test('fixed reverse commit replans then delegates shared transaction accounting', () => {
  const source = readSource('functions/index.js')
  const commit = boundedSource(
    source,
    'async function commitFixedPrivateLessonOutcomeAction({',
    'exports.inspectFixedPrivateLessonOutcomeLedger = onCall('
  )
  const reversalBranch = boundedSource(
    commit,
    'if (validation.actionType === "reverse_deduction") {',
    'const targetStatus = normalizedPlan.normalizedOutcome'
  )
  const fixedIdentity = boundedSource(
    source,
    'function buildFixedPrivateReversalAccountingIdentity({',
    'function applyPrivateReservationOutcomeReversalAccountingInTransaction('
  )
  const sharedAccounting = boundedSource(
    source,
    'function applyPrivateReservationOutcomeReversalAccountingInTransaction(',
    'function buildPrivateReservationOutcomeReversalPlan({'
  )

  const resolveIndex = commit.indexOf('resolveFixedPrivateOutcomeTarget({')
  const planIndex = commit.indexOf('buildFixedPrivateOutcomePlan({')
  const hashIndex = commit.indexOf('buildFixedPrivateOutcomePlanHash({')
  const branchIndex = commit.indexOf(
    'if (validation.actionType === "reverse_deduction") {'
  )
  expect(commit).toContain(
    'validateFixedPrivateOutcomeActionPayload(data || {}, true)'
  )
  expect(commit).toContain('db.runTransaction(async (transaction) =>')
  expect(commit).toContain('requestId: validation.requestId')
  expect(commit).toContain('planHash: validation.planHash')
  expect(resolveIndex).toBeGreaterThanOrEqual(0)
  expect(planIndex).toBeGreaterThan(resolveIndex)
  expect(hashIndex).toBeGreaterThan(planIndex)
  expect(branchIndex).toBeGreaterThan(hashIndex)
  expect(commit).toContain('actualPlanHash !== validation.planHash')
  expect(reversalBranch).toContain(
    'buildFixedPrivateReversalAccountingIdentity({'
  )
  expect(reversalBranch).toContain(
    'applyPrivateReservationOutcomeReversalAccountingInTransaction('
  )
  expect(reversalBranch).not.toContain(
    'transaction.update(target.packageDoc.ref'
  )
  expect(reversalBranch).not.toContain(
    'transaction.create(target.reversalCreditDoc.ref'
  )
  expect(fixedIdentity).toContain(
    'sourceType: "fixedPrivateReservation"'
  )
  expect(fixedIdentity).toContain(
    'actionType: "fixed_private_no_show_deduct_reversal"'
  )
  expect(sharedAccounting).toContain('const usedAfter = usedBefore - 1')
  expect(sharedAccounting).toContain(
    'const remainingAfter = remainingBefore + 1'
  )
  expect(sharedAccounting).toContain('transaction.update(packageRef')
  expect(sharedAccounting).toContain('transaction.update(originalCreditRef')
  expect(sharedAccounting).toContain('transaction.create(reversalCreditRef')
  expect(sharedAccounting).toContain('originalCreditTransactionId')
  expect(sharedAccounting).toContain(
    'reversalOfTransactionId: originalCreditTransactionId'
  )
  expect(sharedAccounting).not.toContain('totalCount:')
  ;[
    'status: "active"',
    'status: "reserved"',
    'deductionApplied: false',
    'deductionReversed: true',
    'deductionStatus: "reversed"',
    'fixedPrivateDeductionLedger: FIXED_PRIVATE_DEDUCTION_LEDGER',
    'originalDeductionCreditTransactionId:',
    'reversalCreditTransactionId:',
    'outcomeReversalPlanHash: actualPlanHash',
  ].forEach((token) => expect(reversalBranch).toContain(token))
})

test('direct reversal preserves guards and delegates the shared helper', () => {
  const source = readSource('functions/index.js')
  const directTransaction = boundedSource(
    source,
    'async function reversePrivateReservationOutcomeInTransaction(',
    'exports.reversePrivateReservationOutcome = onCall('
  )
  const directPublic = boundedSource(
    source,
    'exports.reversePrivateReservationOutcome = onCall(',
    'exports.bootstrapAdmin = onCall('
  )
  const reversalIdentity = boundedSource(
    source,
    'function buildPrivateReservationOutcomeReversalCreditId(',
    'function buildDirectPrivateReversalAccountingIdentity({'
  )

  expect(
    directTransaction.match(/assertNotFixedPrivateDirectReservation\(/g)
  ).toHaveLength(2)
  expect(directTransaction).toContain(
    'buildDirectPrivateReversalAccountingIdentity({'
  )
  expect(directTransaction).toContain(
    'applyPrivateReservationOutcomeReversalAccountingInTransaction('
  )
  expect(directTransaction).not.toContain('transaction.update(packageRef')
  expect(directTransaction).not.toContain(
    'transaction.update(originalCreditRef'
  )
  expect(directTransaction).not.toContain(
    'transaction.create(reversalCreditRef'
  )
  expect(reversalIdentity).toContain(
    'return `reverse_${normalizeId(deductionId)}`'
  )
  ;[
    'optionalString(data, "requestId")',
    'optionalString(data, "planHash")',
    'optionalString(data, "packageId")',
    'optionalString(data, "activeDeductionId")',
    '"reversalCreditTransactionId"',
    'requireString(data, "reason")',
    'requestMode = hasRequestId ? "current" : "legacy"',
    'mixed_reversal_request_shape',
  ].forEach((token) => expect(directPublic).toContain(token))
})

test('fixed reverse exports collections and mutation surfaces stay bounded', () => {
  const source = readSource('functions/index.js')
  const fixedCallables = boundedSource(
    source,
    'exports.inspectFixedPrivateLessonOutcomeLedger = onCall(',
    'exports.previewPrivateLessonOutcomeAction = onCall('
  )
  const resolver = boundedSource(
    source,
    'async function resolveFixedPrivateOutcomeTarget({',
    'function fixedPrivateOutcomeValuesConflict('
  )
  const reversalPlan = boundedSource(
    source,
    'function buildFixedPrivateOutcomeReversalPlan({',
    'function buildFixedPrivateOutcomePlan({'
  )
  const commit = boundedSource(
    source,
    'async function commitFixedPrivateLessonOutcomeAction({',
    'exports.inspectFixedPrivateLessonOutcomeLedger = onCall('
  )
  const sharedAccounting = boundedSource(
    source,
    'function applyPrivateReservationOutcomeReversalAccountingInTransaction(',
    'function buildPrivateReservationOutcomeReversalPlan({'
  )

  expect(
    [...fixedCallables.matchAll(/exports\.(\w+) = onCall\(/g)]
      .map((match) => match[1])
  ).toEqual([
    'inspectFixedPrivateLessonOutcomeLedger',
    'inspectFixedPrivateLessonOutcomeRemediationEvidence',
    'previewFixedPrivateLessonOutcomeAction',
    'commitFixedPrivateLessonOutcomeAction',
  ])
  for (const internalName of [
    'buildFixedPrivateOutcomeReversalPlan',
    'buildFixedPrivateReversalAccountingIdentity',
    'applyPrivateReservationOutcomeReversalAccountingInTransaction',
  ]) {
    expect(source).not.toContain(`exports.${internalName}`)
  }
  expect(
    [...resolver.matchAll(/collectionName: "([^"]+)"/g)]
      .map((match) => match[1])
  ).toEqual([
    'lessons',
    'privateLessonReservations',
    'privateLessonSlots',
    'studentPackages',
    'creditTransactions',
    'creditTransactions',
  ])
  expect(source).toContain(
    'const FIXED_PRIVATE_OUTCOME_BATCH_COLLECTION =\n' +
      '  "fixedPrivateLessonOutcomeActionBatches"'
  )
  expect(fixedCallables.match(
    /exports\.previewFixedPrivateLessonOutcomeAction = onCall\(/g
  )).toHaveLength(1)
  expect(fixedCallables.match(
    /exports\.commitFixedPrivateLessonOutcomeAction = onCall\(/g
  )).toHaveLength(1)
  expect(reversalPlan).not.toContain('"legacy"')
  for (const forbidden of [
    'setDoc(',
    'updateDoc(',
    'addDoc(',
    'writeBatch(',
    'firebase/firestore',
    'firestore.rules',
    'firestore.indexes',
  ]) {
    expect(commit).not.toContain(forbidden)
    expect(sharedAccounting).not.toContain(forbidden)
    expect(reversalPlan).not.toContain(forbidden)
  }
})
