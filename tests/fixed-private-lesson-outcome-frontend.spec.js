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

test('fixed source classification is independent of row kind and link completeness', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx')
  const dashboardGuard = boundedSource(
    dashboardSource,
    'function isFixedPrivateSourceRecord(',
    'function classifyFixedPrivateOutcomeCommitError('
  )
  const calendarGuards = boundedSource(
    calendarSource,
    'function isFixedPrivateSourceRecord(',
    'function isFixedPrivateOutcomeCalendarRow('
  )
  const dashboardIsFixedSource = new Function(
    `${dashboardGuard}; return isFixedPrivateSourceRecord;`
  )()
  const calendarClassifiers = new Function(
    `${calendarGuards}; return { isFixedPrivateSourceRecord, isLegacyDirectPrivateReservationRow };`
  )()
  const fixtures = [
    { sourceType: 'fixed-private-slot-assignment' },
    { reservationType: 'fixed', _calendarRowKind: 'privateReservation' },
    {
      sourceType: 'fixed-private-slot-assignment',
      _calendarRowKind: 'privateReservation',
      id: 'reservation-only',
    },
  ]

  fixtures.forEach((fixture) => {
    expect(dashboardIsFixedSource(fixture)).toBe(true)
    expect(calendarClassifiers.isFixedPrivateSourceRecord(fixture)).toBe(true)
    expect(calendarClassifiers.isLegacyDirectPrivateReservationRow(fixture)).toBe(false)
  })
  expect(
    calendarClassifiers.isLegacyDirectPrivateReservationRow({
      _calendarRowKind: 'privateReservation',
      sourceType: 'student-direct-booking',
      reservationType: 'direct',
    })
  ).toBe(true)
})

test('calendar fixed action and local ownership gate remain source-aware', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx')
  const localGate = boundedSource(
    dashboardSource,
    'function canManageFixedPrivateLessonOutcomeLocally(',
    'function normalizePrivateSlotEligibleStudentIds('
  )

  expect(localGate).toContain('isFixedPrivateSourceRecord(target)')
  expect(localGate).toContain('if (isAdmin) return true')
  expect(localGate).toContain("!['teacher', 'staff'].includes(userProfile?.membershipRole)")
  expect(localGate).toContain('userProfile?.isActive !== true')
  expect(localGate).toContain('userProfile?.canManageOwnLessonDeductions !== true')
  expect(localGate).toContain('fixedPrivateTeacherOwnershipMatches')
  expect(calendarSource).toContain('canOpenFixedPrivateLessonOutcome(lesson)')
  expect(calendarSource).toContain('fixed-private-lesson-outcome-preview-button')
  expect(calendarSource).toContain('고정수업 연결 오류 확인')
  expect(calendarSource).toContain('FIXED_PRIVATE_OUTCOME_ACTIVE_STATUSES')
})

test('teacher ownership prioritizes UID, then key, and never email', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const authSource = readSource('AuthContext.jsx')
  const ownershipSource = boundedSource(
    dashboardSource,
    'function fixedPrivateTeacherOwnershipMatches(',
    'function canManageFixedPrivateLessonOutcomeLocally('
  )
  const matches = new Function(
    'normalizeText',
    `${ownershipSource}; return fixedPrivateTeacherOwnershipMatches;`
  )((value) => String(value || '').trim().toLowerCase())

  expect(
    matches({
      target: { teacherUid: 'uid-1' },
      user: null,
      userProfile: { currentMembershipTeacherUid: 'uid-1' },
    })
  ).toBe(true)
  expect(
    matches({
      target: { teacherKey: 'teacher-key-1' },
      user: null,
      userProfile: { currentMembershipTeacherKey: 'teacher-key-1' },
    })
  ).toBe(true)
  expect(
    matches({
      target: { teacherEmail: 'teacher@example.com' },
      user: { email: 'teacher@example.com' },
      userProfile: { email: 'teacher@example.com' },
    })
  ).toBe(false)
  expect(
    matches({
      target: { teacherUid: 'uid-from-auth' },
      user: { uid: 'uid-from-auth' },
      userProfile: { teacherName: 'global teacher fallback' },
    })
  ).toBe(false)
  expect(
    matches({
      target: { teacherName: 'global teacher fallback' },
      user: null,
      userProfile: { teacherName: 'global teacher fallback' },
    })
  ).toBe(false)
  expect(
    matches({
      target: { teacherUid: 'uid-other', teacherName: 'same teacher' },
      user: null,
      userProfile: {
        currentMembershipTeacherUid: 'uid-current',
        currentMembershipTeacherName: 'same teacher',
      },
    })
  ).toBe(false)

  for (const token of [
    'currentMembershipUid',
    'currentMembershipTeacherUid',
    'currentMembershipTeacherUidAliases',
    'currentMembershipTeacherKey',
    'currentMembershipTeacherName',
    'currentMembershipTeacherAlias',
    'currentMembershipDisplayName',
    'currentMembershipName',
  ]) {
    expect(authSource).toContain(token)
  }
  expect(authSource).toContain('globalUserProfile.teacherName ||')
  expect(authSource).toContain(
    "currentMembershipTeacherName: normalizeText(sourceProfile?.teacherName || '')"
  )
  expect(ownershipSource).not.toContain('email')
  expect(ownershipSource).not.toContain('globalUserProfile')
  expect(ownershipSource).not.toContain('userProfile?.teacherName')
  expect(ownershipSource).not.toContain('user?.uid')
})

test('legacy teacher name fallback stays separate from fixed ownership aliases', () => {
  const authSource = readSource('AuthContext.jsx')
  const dashboardSource = readSource('Dashboard.jsx')
  const adapter = boundedSource(
    authSource,
    'function buildUserProfileAdapter({',
    'function getCandidateAcademyIds('
  )
  const ownership = boundedSource(
    dashboardSource,
    'function fixedPrivateTeacherOwnershipMatches(',
    'function canManageFixedPrivateLessonOutcomeLocally('
  )

  expect(adapter).toContain('sourceProfile?.teacherName ||')
  expect(adapter).toContain('sourceProfile?.teacher ||')
  expect(adapter).toContain('globalUserProfile.teacherName ||')
  for (const membershipOnlyLine of [
    "currentMembershipTeacherKey: normalizeText(sourceProfile?.teacherKey || '')",
    "currentMembershipTeacherName: normalizeText(sourceProfile?.teacherName || '')",
    "currentMembershipTeacherAlias: normalizeText(sourceProfile?.teacher || '')",
    "currentMembershipDisplayName: normalizeText(sourceProfile?.displayName || '')",
    "currentMembershipName: normalizeText(sourceProfile?.name || '')",
  ]) {
    expect(adapter).toContain(membershipOnlyLine)
  }
  expect(ownership).not.toContain('teacherName ||')
  expect(ownership).not.toContain('globalUserProfile')
  expect(ownership).not.toContain('user?.uid')
})

test('fixed preview uses only the dedicated callable and complete three-way payload', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const previewHandler = boundedSource(
    dashboardSource,
    'async function previewFixedPrivateLessonOutcomeActionOnServer()',
    'const studentsSectionProps = {'
  )

  expect(previewHandler).toContain(
    "httpsCallable(\n        firebaseFunctions,\n        'previewFixedPrivateLessonOutcomeAction'"
  )
  for (const token of [
    'academyId: scopedAcademyId',
    'lessonId',
    'reservationId',
    'slotId',
    'packageId',
    'requestId',
    'actionType',
    'dryRun: true',
    'previewOnly: true',
    'commit: false',
  ]) {
    expect(previewHandler).toContain(token)
  }
  for (const forbidden of [
    "'previewPrivateLessonStatusAction'",
    "'previewPrivateLessonOutcomeAction'",
    "'markPrivateReservationOutcome'",
    "'reversePrivateReservationOutcome'",
    'setDoc(',
    'addDoc(',
    'updateDoc(',
    'deleteDoc(',
    'writeBatch(',
  ]) {
    expect(previewHandler).not.toContain(forbidden)
  }
})

test('fixed commit reuses preview payload requestId and returned planHash', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const commitHandler = boundedSource(
    dashboardSource,
    'async function commitFixedPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  )

  expect(commitHandler).toContain('...fixedPrivateOutcomePreviewPayload')
  expect(commitHandler).toContain('planHash: fixedPrivateOutcomePreviewPlanHash')
  expect(commitHandler).toContain('commit: true')
  expect(commitHandler).toContain('dryRun: false')
  expect(commitHandler).toContain('previewOnly: false')
  expect(commitHandler).toContain("'commitFixedPrivateLessonOutcomeAction'")
  expect(commitHandler).toContain('previewData.requestId !== requestId')
  expect(commitHandler).toContain("String(previewData.planHash || '').trim() !== planHash")
  expect(commitHandler).not.toContain('Date.now()')
  expect(commitHandler).not.toContain('Math.random()')
  expect(commitHandler).not.toContain("'commitPrivateLessonStatusAction'")
  expect(commitHandler).not.toContain("'commitPrivateLessonOutcomeAction'")
  expect(commitHandler).not.toContain("'markPrivateReservationOutcome'")
  expect(commitHandler).not.toContain("'reversePrivateReservationOutcome'")
  for (const directWrite of ['setDoc(', 'addDoc(', 'updateDoc(', 'deleteDoc(', 'writeBatch(']) {
    expect(commitHandler).not.toContain(directWrite)
  }
})

test('commit error policy clears deterministic failures and retains transient payloads', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  )
  const classifierSource = boundedSource(
    dashboardSource,
    'function classifyFixedPrivateOutcomeCommitError(',
    'function getFixedPrivateLessonOutcomeTargetIds('
  )
  const classify = new Function(
    `${classifierSource}; return classifyFixedPrivateOutcomeCommitError;`
  )()
  const commitHandler = boundedSource(
    dashboardSource,
    'async function commitFixedPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  )

  for (const code of [
    'functions/failed-precondition',
    'functions/permission-denied',
    'functions/already-exists',
  ]) {
    expect(classify({ code, details: {} }).requiresFreshPreview).toBe(true)
  }
  expect(
    classify({
      code: 'functions/unavailable',
      details: { blockedReasons: ['request_id_conflict'] },
    }).requiresFreshPreview
  ).toBe(true)
  for (const code of [
    'functions/unavailable',
    'functions/deadline-exceeded',
    '',
  ]) {
    const result = classify({ code, message: 'transport failed', details: {} })
    expect(result.requiresFreshPreview).toBe(false)
    expect(result.retryWithSamePayload).toBe(true)
  }

  expect(commitHandler).toContain('if (errorClassification.requiresFreshPreview)')
  expect(commitHandler).toContain('setFixedPrivateOutcomePreviewPayload(null)')
  expect(commitHandler).toContain('retryWithSamePayload: errorClassification.retryWithSamePayload')
  expect(modalSource).toContain("data-retry-mode=")
  expect(modalSource).toContain("'same-payload'")
  expect(modalSource).toContain('동일 requestId / planHash / preview payload')
})

test('every legacy dashboard action rejects fixed source records before writes or prompts', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const blocks = [
    boundedSource(
      dashboardSource,
      'async function handleDeductionToggle(',
      'function formatLocalYmd('
    ),
    boundedSource(
      dashboardSource,
      'async function markPrivateReservationOutcome(',
      'async function reversePrivateReservationOutcome('
    ),
    boundedSource(
      dashboardSource,
      'async function reversePrivateReservationOutcome(',
      'const busyStudentId ='
    ),
    boundedSource(
      dashboardSource,
      'async function previewPrivateLessonStatusActionOnServer()',
      'async function previewPrivateLessonOutcomeActionOnServer()'
    ),
    boundedSource(
      dashboardSource,
      'async function previewPrivateLessonOutcomeActionOnServer()',
      'async function previewFixedPrivateLessonOutcomeActionOnServer()'
    ),
  ]
  const statusCommit = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonStatusActionOnServer()',
    'async function commitPrivateLessonOutcomeActionOnServer()'
  )
  const directOutcomeCommit = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonOutcomeActionOnServer()',
    'async function commitFixedPrivateLessonOutcomeActionOnServer()'
  )

  blocks.forEach((block) => {
    const guardIndex = block.indexOf('isFixedPrivateSourceRecord')
    const operationIndexes = [
      block.indexOf('httpsCallable'),
      block.indexOf('window.prompt'),
      block.indexOf('window.confirm'),
      block.indexOf('writeBatch'),
    ].filter((index) => index >= 0)
    expect(guardIndex).toBeGreaterThanOrEqual(0)
    expect(operationIndexes.length).toBeGreaterThan(0)
    expect(guardIndex).toBeLessThan(Math.min(...operationIndexes))
  })
  expect(statusCommit).toContain('isFixedPrivateSourceRecord')
  expect(statusCommit.indexOf('isFixedPrivateSourceRecord')).toBeLessThan(
    statusCommit.indexOf('httpsCallable')
  )
  expect(statusCommit).toContain('상태만 처리 경로를 사용할 수 없습니다')
  expect(directOutcomeCommit).toContain('isFixedPrivateSourceRecord')
  expect(directOutcomeCommit.indexOf('isFixedPrivateSourceRecord')).toBeLessThan(
    directOutcomeCommit.indexOf('httpsCallable')
  )
  expect(directOutcomeCommit).toContain('직접예약 차감 처리 경로를 사용할 수 없습니다')
})

test('generic cancellation routes fixed provenance to dedicated cancellation', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const slotsSource = readSource(
    'src/features/dashboard/sections/PrivateLessonSlotsSection.jsx'
  )
  const handler = boundedSource(
    dashboardSource,
    'async function cancelPrivateSlotOrReservation(',
    'async function markPrivateReservationOutcome('
  )
  const safeRoute = boundedSource(
    slotsSource,
    'const cancelPrivateSlotOrReservationSafely =',
    'const fixedPrivateRenewalConfirmationPlan ='
  )

  expect(handler).toContain('isFixedPrivateCancellationTarget(reservation, slot)')
  expect(handler).toContain('cancelFixedPrivateLessonOccurrence(')
  expect(handler.indexOf('isFixedPrivateCancellationTarget')).toBeLessThan(
    handler.indexOf("'adminCancelPrivateLessonReservation'")
  )
  expect(safeRoute).toContain('isFixedPrivateReservation(reservation, slot)')
  expect(safeRoute).toContain('onCancelFixedPrivateLesson?.(')
  expect(safeRoute).toContain('cancelPrivateSlotOrReservation(slot, reservation, options)')
})

test('calendar detail and list deduction gates exclude every fixed source row', () => {
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx')
  const rowGate = boundedSource(
    calendarSource,
    'const canDeductionAction =',
    'const privateReservationStatus ='
  )
  const detailPayload = boundedSource(
    calendarSource,
    'const privateLessonDetailPayload =',
    'const rowKind ='
  )

  expect(rowGate).toContain('!isFixedPrivateSourceRow')
  expect(detailPayload).toContain('!isFixedPrivateSourceRow')
  expect(detailPayload).toContain('canToggleDeduction')
})

test('fixed modal contains ledger diagnostics, dedicated confirmation, and result IDs', () => {
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  )
  for (const token of [
    'fixed-private-lesson-outcome-modal',
    '3-way IDs',
    'lessonId',
    'linked reservationId',
    'slotId',
    'packageId',
    'ledger classification (canonical vs legacy)',
    'package current → next counts',
    'usedCountDelta',
    'remainingCountDelta',
    'legacy-net-zero-warning',
    'package net',
    'credit preview',
    'blockedReasons',
    'warnings',
    'normalizedPlan',
    'planHash',
    'nextStep',
    'fixed-private-lesson-outcome-commit-checkbox',
    'fixed-private-lesson-outcome-commit-button',
    'creditTransactionId',
    'batchId',
    'idempotentReplay',
    'ledger diagnostics',
    '성공 상태로 잠겼습니다',
  ]) {
    expect(modalSource).toContain(token)
  }
  expect(modalSource).toContain('creditPreview.duplicateExists === false')
  expect(modalSource).toContain('fixedLocalGatePassed === true')
  expect(modalSource).toContain('previewMatchesTargetAndAction')
  expect(modalSource).toContain('fixedOutcomeCommitConfirmed !== true')
})

test('fixed state clears on close, action, preview retry, and deterministic commit error', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const clearBlock = boundedSource(
    dashboardSource,
    'function clearFixedPrivateLessonOutcomeState()',
    'function clearPrivateLessonStatusActionPreview()'
  )
  const actionBlock = boundedSource(
    dashboardSource,
    'function selectPrivateLessonStatusActionMode(',
    'async function previewPrivateLessonStatusActionOnServer()'
  )
  const fixedPreview = boundedSource(
    dashboardSource,
    'async function previewFixedPrivateLessonOutcomeActionOnServer()',
    'const studentsSectionProps = {'
  )
  const fixedCommit = boundedSource(
    dashboardSource,
    'async function commitFixedPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  )

  for (const token of [
    'setFixedPrivateOutcomePreviewResult(null)',
    'setFixedPrivateOutcomePreviewPayload(null)',
    "setFixedPrivateOutcomePreviewPlanHash('')",
    'setFixedPrivateOutcomeCommitError(null)',
    'setFixedPrivateOutcomeCommitResult(null)',
    'setFixedPrivateOutcomeCommitConfirmed(false)',
  ]) {
    expect(clearBlock).toContain(token)
    expect(dashboardSource).toContain(token)
  }
  expect(actionBlock).toContain('clearPrivateLessonStatusActionPreview()')
  expect(fixedPreview).toContain('clearFixedPrivateLessonOutcomeState()')
  expect(fixedPreview).toContain('fixedPrivateOutcomePreviewEpochRef.current !== previewEpoch')
  expect(fixedCommit).toContain('if (errorClassification.requiresFreshPreview)')
  expect(fixedCommit).toContain('setFixedPrivateOutcomePreviewPayload(null)')
  expect(fixedCommit).toContain('새 requestId로 미리보기부터 다시 실행하세요')
})

test('context changes defer a full reset until every commit finishes', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const resetBlock = boundedSource(
    dashboardSource,
    'function resetPrivateLessonActionModalForContext(',
    'function getMatchedStudentId('
  )
  const statusCommit = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonStatusActionOnServer()',
    'async function commitPrivateLessonOutcomeActionOnServer()'
  )
  const directCommit = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonOutcomeActionOnServer()',
    'async function commitFixedPrivateLessonOutcomeActionOnServer()'
  )
  const fixedCommit = boundedSource(
    dashboardSource,
    'async function commitFixedPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  )

  expect(resetBlock).toContain('privateLessonActionContextResetPendingRef.current = true')
  expect(resetBlock).toContain('privateLessonStatusActionCommitBusyRef.current')
  expect(resetBlock).toContain('privateLessonOutcomeCommitBusyRef.current')
  expect(resetBlock).toContain('fixedPrivateOutcomeCommitBusyRef.current')
  expect(resetBlock).toContain('resetPrivateLessonActionModalForContext({ force: true })')
  expect(dashboardSource).toContain(
    '}, [selectedDateString, calendarMonth, currentAcademyId])'
  )
  for (const commitBlock of [statusCommit, directCommit, fixedCommit]) {
    expect(commitBlock).toContain('flushDeferredPrivateLessonActionContextReset()')
  }
})

test('fixed privateReservation fixtures are rejected while normal direct fixtures keep legacy flow', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx')
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  )
  const calendarGuards = boundedSource(
    calendarSource,
    'function isFixedPrivateSourceRecord(',
    'function isFixedPrivateOutcomeCalendarRow('
  )
  const classify = new Function(
    `${calendarGuards}; return { isFixedPrivateSourceRecord, isLegacyDirectPrivateReservationRow };`
  )()
  const fixedBySource = {
    _calendarRowKind: 'privateReservation',
    id: 'fixed-reservation',
    sourceType: 'fixed-private-slot-assignment',
  }
  const fixedByType = {
    _calendarRowKind: 'privateReservation',
    id: 'fixed-reservation-type',
    reservationType: 'fixed',
  }
  const normalDirect = {
    _calendarRowKind: 'privateReservation',
    id: 'direct-reservation',
    sourceType: 'student-direct-booking',
    reservationType: 'direct',
  }

  expect(classify.isLegacyDirectPrivateReservationRow(fixedBySource)).toBe(false)
  expect(classify.isLegacyDirectPrivateReservationRow(fixedByType)).toBe(false)
  expect(classify.isLegacyDirectPrivateReservationRow(normalDirect)).toBe(true)
  expect(classify.isFixedPrivateSourceRecord(normalDirect)).toBe(false)

  const directPreviewGate = boundedSource(
    calendarSource,
    'const canOpenPrivateLessonStatusActionPreview =',
    'const rowLessonActionBusy ='
  )
  const legacyButtons = boundedSource(
    calendarSource,
    "{activeSection === 'calendar' &&\n                  isAdmin &&\n                  canUseLegacyPrivateReservationActions",
    '</span>\n              </div>'
  )
  const sharedDirectButton = boundedSource(
    calendarSource,
    '{canOpenPrivateLessonStatusActionPreview ||',
    "{activeSection === 'calendar' &&\n                  isAdmin &&\n                  canUseLegacyPrivateReservationActions"
  )
  const calendarWiring = boundedSource(
    dashboardSource,
    'const calendarSectionProps = {',
    'function clearPrivateLessonStatusActionCommitState('
  )
  const sharedOpener = boundedSource(
    dashboardSource,
    'function openPrivateLessonStatusActionPreview(',
    'function closePrivateLessonStatusActionPreview('
  )
  const statusPreviewHandler = boundedSource(
    dashboardSource,
    'async function previewPrivateLessonStatusActionOnServer(',
    'async function previewPrivateLessonOutcomeActionOnServer('
  )
  const outcomePreviewHandler = boundedSource(
    dashboardSource,
    'async function previewPrivateLessonOutcomeActionOnServer(',
    'async function previewFixedPrivateLessonOutcomeActionOnServer('
  )
  const statusCommitHandler = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonStatusActionOnServer(',
    'async function commitPrivateLessonOutcomeActionOnServer('
  )
  const outcomeCommitHandler = boundedSource(
    dashboardSource,
    'async function commitPrivateLessonOutcomeActionOnServer(',
    'async function commitFixedPrivateLessonOutcomeActionOnServer('
  )
  const modalWiring = boundedSource(
    dashboardSource,
    'const privateLessonStatusActionModalProps = {',
    '// Preserve the existing role/permission-filtered menu as the single navigation authority.'
  )
  const noShowOption = boundedSource(
    modalSource,
    'value="no_show"',
    'data-testid="private-lesson-status-action-preview-submit"'
  )
  const directSharedFlow = [
    sharedOpener,
    statusPreviewHandler,
    outcomePreviewHandler,
    statusCommitHandler,
    outcomeCommitHandler,
  ].join('\n')

  expect(directPreviewGate).toContain('canUseLegacyPrivateReservationActions')
  expect(directPreviewGate).toContain('Boolean(privateReservationId)')
  expect(directPreviewGate).toContain('Boolean(matchedStudentId)')
  expect(sharedDirectButton).toContain('canOpenPrivateLessonStatusActionPreview')
  expect(sharedDirectButton).toContain(
    'onOpenPrivateLessonStatusActionPreview?.({\n                          ...lesson,'
  )
  expect(sharedDirectButton).toContain(
    "text('teacher.calendar.action.processLesson', '수업 처리')"
  )
  expect(calendarWiring).toContain(
    'onOpenPrivateLessonStatusActionPreview: openPrivateLessonStatusActionPreview'
  )
  expect(legacyButtons.match(/canUseLegacyPrivateReservationActions/g)).toHaveLength(2)
  expect(legacyButtons).toContain("onMarkPrivateReservationOutcome?.(lesson, 'completed')")
  expect(legacyButtons).not.toContain("onMarkPrivateReservationOutcome?.(lesson, 'no_show')")
  expect(legacyButtons).toContain('onReversePrivateReservationOutcome?.(lesson)')
  expect(sharedOpener).toContain('const fixedTarget = isFixedPrivateSourceRecord(target)')
  expect(sharedOpener).toContain(': !isAdmin)')
  expect(noShowOption).toContain("checked={actionType === 'no_show'}")
  expect(noShowOption).toContain("setActionType?.('no_show')")
  expect(modalWiring).toContain('onPreview: previewPrivateLessonStatusActionOnServer')
  expect(modalWiring).toContain('onOutcomePreview: previewPrivateLessonOutcomeActionOnServer')
  expect(modalWiring).toContain('onOutcomeCommit: commitPrivateLessonOutcomeActionOnServer')
  expect(modalWiring).toContain('onCommit: commitPrivateLessonStatusActionOnServer')
  expect(statusPreviewHandler).toContain("actionType =")
  expect(statusPreviewHandler).toContain("privateLessonStatusActionMode === 'no_show'")
  expect(statusPreviewHandler).toContain(
    "httpsCallable(firebaseFunctions, 'previewPrivateLessonStatusAction')"
  )
  expect(outcomePreviewHandler).toContain(
    "httpsCallable(firebaseFunctions, 'previewPrivateLessonOutcomeAction')"
  )
  expect(statusCommitHandler).toContain(
    "httpsCallable(firebaseFunctions, 'commitPrivateLessonStatusAction')"
  )
  expect(statusCommitHandler).toContain(
    "httpsCallable(firebaseFunctions, 'reversePrivateReservationOutcome')"
  )
  expect(outcomeCommitHandler).toContain(
    "httpsCallable(firebaseFunctions, 'commitPrivateLessonOutcomeAction')"
  )
  expect(statusCommitHandler).toContain('privateLessonStatusActionCommitBusyRef.current')
  expect(outcomeCommitHandler).toContain('privateLessonOutcomeCommitBusyRef.current')
  expect(statusCommitHandler).toContain('flushDeferredPrivateLessonActionContextReset()')
  expect(outcomeCommitHandler).toContain('flushDeferredPrivateLessonActionContextReset()')
  expect(directSharedFlow).not.toMatch(
    /\b(?:setDoc|addDoc|updateDoc|deleteDoc|writeBatch)\s*\(/
  )

  const markHandler = boundedSource(
    dashboardSource,
    'async function markPrivateReservationOutcome(',
    'async function reversePrivateReservationOutcome('
  )
  expect(markHandler.indexOf('isFixedPrivateSourceRecord')).toBeLessThan(
    markHandler.indexOf('window.confirm')
  )
  expect(markHandler).toContain("'markPrivateReservationOutcome'")
})

test('generic private lesson edit and delete reject fixed sources but preserve normal lessons', () => {
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx')
  const hookSource = readSource('src/features/dashboard/hooks/usePrivateLessonFlow.js')
  const dashboardSource = readSource('Dashboard.jsx')
  const crudClassifierSource = boundedSource(
    hookSource,
    'function isFixedPrivateSourceRecordForLegacyCrud(',
    'export function validatePrivateLessonFormFields('
  )
  const isFixedForLegacyCrud = new Function(
    `${crudClassifierSource}; return isFixedPrivateSourceRecordForLegacyCrud;`
  )()
  const fixedFixtures = [
    { sourceType: 'fixed-private-slot-assignment', _calendarRowKind: 'private' },
    { reservationType: 'fixed', _calendarRowKind: 'private' },
    {
      sourceType: 'fixed-private-slot-assignment',
      reservationType: 'fixed',
      _calendarRowKind: 'privateReservation',
    },
  ]
  fixedFixtures.forEach((fixture) => expect(isFixedForLegacyCrud(fixture)).toBe(true))
  expect(
    isFixedForLegacyCrud({
      sourceType: 'admin-created',
      reservationType: 'direct',
      _calendarRowKind: 'private',
    })
  ).toBe(false)

  const calendarCrudGate = boundedSource(
    calendarSource,
    'const canUseGenericPrivateLessonCrud =',
    'const isFixedPrivateOutcomeRow ='
  )
  const calendarCrudButtons = boundedSource(
    calendarSource,
    "{activeSection === 'calendar' &&\n                  canEditLesson &&",
    '{isGroupRow ? ('
  )
  expect(calendarCrudGate).toContain(
    '!isGroupRow && !isPrivateReservationRow && !isFixedPrivateSourceRow'
  )
  expect(calendarCrudButtons.match(/canUseGenericPrivateLessonCrud/g)).toHaveLength(2)
  expect(calendarCrudButtons).toContain('openPrivateLessonEditModal(lesson)')
  expect(calendarCrudButtons).toContain('handleDeletePrivateLesson(lesson)')

  const openEditHandler = boundedSource(
    hookSource,
    'function openPrivateLessonEditModal(',
    'async function submitPrivateLessonEditModal()'
  )
  const submitEditHandler = boundedSource(
    hookSource,
    'async function submitPrivateLessonEditModal()',
    'const isPrivateLessonModalSubmitting ='
  )
  const deleteHandler = boundedSource(
    dashboardSource,
    'async function handleDeletePrivateLesson(',
    'async function cancelFixedPrivateLessonOccurrence('
  )
  expect(openEditHandler.indexOf('isFixedPrivateSourceRecordForLegacyCrud')).toBeLessThan(
    openEditHandler.indexOf('setPrivateLessonEditModal')
  )
  expect(submitEditHandler.indexOf('isFixedPrivateSourceRecordForLegacyCrud')).toBeLessThan(
    submitEditHandler.indexOf('updateDoc')
  )
  expect(deleteHandler.indexOf('isFixedPrivateSourceRecord')).toBeLessThan(
    deleteHandler.indexOf('window.confirm')
  )
  expect(deleteHandler.indexOf('isFixedPrivateSourceRecord')).toBeLessThan(
    deleteHandler.indexOf('deleteDoc')
  )
  expect(openEditHandler).toContain('고정수업 수정 범위 미리보기/일정 변경 흐름')
  expect(submitEditHandler).toContain('고정수업 일정 변경 흐름')
  expect(deleteHandler).toContain('고정수업 취소 흐름')
  expect(submitEditHandler).toContain("doc(db, 'lessons', lesson.id)")
  expect(deleteHandler).toContain("doc(db, 'lessons', lesson.id)")
})

test('F11 fixed no-show reversal UI is admin-only, server-previewed, and independently locked', () => {
  const dashboardSource = readSource('Dashboard.jsx')
  const calendarSource = readSource('src/features/dashboard/sections/CalendarSection.jsx')
  const modalSource = readSource(
    'src/features/dashboard/components/PrivateLessonStatusActionModal.jsx'
  )
  const studentsSource = readSource('src/features/dashboard/sections/StudentsSection.jsx')
  const calendarGuardSource = boundedSource(
    calendarSource,
    'function isFixedPrivateSourceRecord(',
    'function normalizePrivateReservationLinkText('
  )
  const guards = new Function(
    `${calendarGuardSource}; return {
      isFixedPrivateNoShowReversalCalendarTarget,
    };`
  )()
  const valid = {
    id: 'fixed-lesson-1',
    sourceType: 'fixed-private-slot-assignment',
    packageType: 'private',
    reservationId: 'fixed-reservation-1',
    slotId: 'fixed-slot-1',
    packageId: 'private-package-1',
    deductionPackageId: 'private-package-1',
    status: 'no_show',
    deductionApplied: true,
    deductionCreditTransactionId: 'fixed-deduction-1',
    deductionTransactionId: 'fixed-deduction-1',
    deductionReversed: false,
    outcomeReversedAt: null,
  }

  expect(
    guards.isFixedPrivateNoShowReversalCalendarTarget({ lesson: valid, isAdmin: true })
  ).toBe(true)
  expect(
    guards.isFixedPrivateNoShowReversalCalendarTarget({ lesson: valid, isAdmin: false })
  ).toBe(false)
  expect(
    guards.isFixedPrivateNoShowReversalCalendarTarget({
      lesson: { ...valid, status: 'completed' },
      isAdmin: true,
    })
  ).toBe(false)
  expect(
    guards.isFixedPrivateNoShowReversalCalendarTarget({
      lesson: { ...valid, deductionCreditTransactionId: '' },
      isAdmin: true,
    })
  ).toBe(false)
  expect(
    guards.isFixedPrivateNoShowReversalCalendarTarget({
      lesson: { ...valid, deductionTransactionId: 'different-deduction' },
      isAdmin: true,
    })
  ).toBe(false)
  expect(
    guards.isFixedPrivateNoShowReversalCalendarTarget({
      lesson: { ...valid, deductionReversed: true },
      isAdmin: true,
    })
  ).toBe(false)
  expect(
    guards.isFixedPrivateNoShowReversalCalendarTarget({
      lesson: { ...valid, sourceType: 'student-direct-booking' },
      isAdmin: true,
    })
  ).toBe(false)

  const openHandler = boundedSource(
    dashboardSource,
    'function openPrivateLessonStatusActionPreview(',
    'function closePrivateLessonStatusActionPreview('
  )
  const previewHandler = boundedSource(
    dashboardSource,
    'async function previewFixedPrivateLessonOutcomeActionOnServer()',
    'const studentsSectionProps = {'
  )
  const commitHandler = boundedSource(
    dashboardSource,
    'async function commitFixedPrivateLessonOutcomeActionOnServer()',
    'const privateLessonStatusActionModalProps = {'
  )
  expect(calendarSource).toContain('fixed-private-no-show-reversal-button')
  expect(calendarSource).toContain("t('teacher.calendar.action.cancelFixedNoShow')")
  expect(calendarSource).toContain("t('teacher.calendar.action.restoreOneLessonCredit')")
  expect(calendarSource).toContain('fixedNoShowReversal: true')
  expect(calendarSource).toContain('calendar-package-count-edit-button')
  expect(openHandler).toContain('fixedNoShowReversal && !isAdmin')
  expect(openHandler).toContain("'reverse_deduction'")
  expect(previewHandler).toContain(
    "privateLessonStatusActionMode === 'reverse_deduction'"
  )
  expect(previewHandler).toContain("'previewFixedPrivateLessonOutcomeAction'")
  expect(commitHandler).toContain(
    "privateLessonStatusActionMode === 'reverse_deduction'"
  )
  expect(commitHandler).toContain('...fixedPrivateOutcomePreviewPayload')
  expect(commitHandler).toContain('planHash: fixedPrivateOutcomePreviewPlanHash')
  expect(commitHandler).toContain("'commitFixedPrivateLessonOutcomeAction'")
  expect(commitHandler).toContain('fixedPrivateOutcomeCommitBusyRef.current')
  expect(commitHandler).toContain('fixedPrivateOutcomeCommitResult')
  expect(commitHandler).toContain('setFixedPrivateOutcomeCommitResult(commitData)')
  expect(commitHandler).toContain('flushDeferredPrivateLessonActionContextReset()')
  expect(modalSource).toContain('fixed-private-no-show-reversal-mode')
  expect(modalSource).toContain('fixed-private-no-show-reversal-package-impact')
  expect(modalSource).toContain('packageImpact.currentUsedCount')
  expect(modalSource).toContain('packageImpact.nextUsedCount')
  expect(modalSource).toContain('packageImpact.currentRemainingCount')
  expect(modalSource).toContain('packageImpact.nextRemainingCount')
  expect(modalSource).toContain('creditPreview.deltaCount')
  expect(modalSource).toContain('fixedOutcomeCommitConfirmed !== true')
  expect(modalSource).toContain('previewMatchesTargetAndAction')
  expect(dashboardSource).toContain("collection(db, 'studentPackages')")
  expect(dashboardSource).toContain("collection(db, 'lessons')")
  expect(dashboardSource).toContain("collection(db, 'privateLessonReservations')")
  expect(studentsSource).toContain("collection(db, 'creditTransactions')")
  expect(dashboardSource).toContain('onSnapshot(')
  expect(studentsSource).toContain('onSnapshot(')
})

test('F12 fixed history labels prioritize source metadata and keep only legacy delta fallback', () => {
  const utilsSource = readSource('src/features/dashboard/dashboardViewUtils.js')
  const studentsSource = readSource('src/features/dashboard/sections/StudentsSection.jsx')
  const koSource = readSource('src/i18n/resources/ko.js')
  const enSource = readSource('src/i18n/resources/en.js')
  const utilityBlock = boundedSource(
    utilsSource,
    'export function formatCreditTransactionDeltaCountDisplay(',
    'export const GROUP_RECURRENCE_WEEKDAY_TOGGLES'
  ).replaceAll('export function', 'function')
  const utility = new Function(
    `${utilityBlock}; return {
      getCreditTransactionSourceHistoryKind,
      formatCreditTransactionActionTypeLabel,
    };`
  )()
  const statusBlock = boundedSource(
    studentsSource,
    'function creditTransactionHistoryStatus(',
    'function buildStudentInvitationMessage('
  )
  const actionLabelBlock = boundedSource(
    studentsSource,
    'const fixedActionLabelKey =',
    'return {'
  )
  const status = new Function(
    'getCreditTransactionSourceHistoryKind',
    'formatCreditTransactionActionTypeLabel',
    `${statusBlock}; return creditTransactionHistoryStatus;`
  )(
    utility.getCreditTransactionSourceHistoryKind,
    utility.formatCreditTransactionActionTypeLabel
  )
  const resourceValue = (source, key) => {
    const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const match = source.match(new RegExp(`^\\s*'${escapedKey}':\\s*'([^']*)',?$`, 'm'))
    expect(match, `${key} translation`).not.toBeNull()
    return match[1]
  }
  const translate = (key) => resourceValue(koSource, key)
  const base = {
    sourceType: 'fixedPrivateReservation',
    packageType: 'private',
  }

  expect(
    utility.getCreditTransactionSourceHistoryKind({
      ...base,
      actionType: 'fixed_private_no_show_deduct',
      deltaCount: 1,
    })
  ).toBe('fixed_no_show')
  expect(
    utility.getCreditTransactionSourceHistoryKind({
      ...base,
      actionType: 'fixed_private_completed_deduct',
      deltaCount: 1,
    })
  ).toBe('fixed_completed')
  expect(
    utility.getCreditTransactionSourceHistoryKind({
      ...base,
      actionType: 'fixed_private_no_show_deduct_reversal',
      deltaCount: -1,
    })
  ).toBe('fixed_no_show_reversal')
  expect(
    utility.getCreditTransactionSourceHistoryKind({
      sourceType: 'fixedPrivateReservation',
      outcomeStatus: 'no_show',
      deltaCount: 1,
    })
  ).toBe('fixed_no_show')
  expect(
    status(
      { ...base, actionType: 'fixed_private_no_show_deduct', deltaCount: -1 },
      translate
    )
  ).toBe('노쇼 처리됨')
  expect(
    status(
      { ...base, actionType: 'fixed_private_completed_deduct', deltaCount: -1 },
      translate
    )
  ).toBe('수업완료 처리됨')
  expect(
    status(
      {
        ...base,
        actionType: 'fixed_private_no_show_deduct_reversal',
        deltaCount: 1,
      },
      translate
    )
  ).toBe('노쇼 취소됨')
  expect(actionLabelBlock).toContain(
    "sourceHistoryKind === 'fixed_no_show_reversal'"
  )
  expect(actionLabelBlock).toContain(
    "'student.history.action.fixedNoShowReversal'"
  )
  expect(actionLabelBlock).toContain(
    "['fixed_no_show', 'fixed_completed'].includes(sourceHistoryKind)"
  )
  expect(actionLabelBlock).toContain(
    "'student.history.action.fixedOutcomeDeduction'"
  )
  expect(actionLabelBlock).toContain('t(fixedActionLabelKey)')
  expect(actionLabelBlock).toContain(
    'formatCreditTransactionDeltaCountDisplay(row.deltaCount)'
  )
  expect(
    `${resourceValue(
      koSource,
      'student.history.action.fixedOutcomeDeduction'
    )} · -1`
  ).toBe('고정 1:1 결과 차감 · -1')
  expect(
    `${resourceValue(
      koSource,
      'student.history.action.fixedNoShowReversal'
    )} · +1`
  ).toBe('고정 1:1 노쇼 취소 · +1')
  expect(utilsSource).toContain(
    'export function formatCreditTransactionActionTypeLabel(actionType, deltaCount)'
  )
  expect(
    utility.formatCreditTransactionActionTypeLabel('package_created')
  ).toBe('수강권 발급')
  for (const hardcoded of [
    '고정 1:1 결과 차감',
    '고정 1:1 노쇼 취소',
    'Fixed 1:1 outcome deduction',
    'Fixed 1:1 no-show cancellation',
  ]) {
    expect(utilsSource).not.toContain(hardcoded)
    expect(studentsSource).not.toContain(hardcoded)
  }
  expect(status({ deltaCount: -1 }, translate)).toBe('출석 처리됨')
  expect(
    status(
      {
        sourceType: 'unknown-source',
        actionType: 'unknown_action',
        deltaCount: -1,
      },
      translate
    )
  ).toBe('unknown_action')
  expect(statusBlock.indexOf('getCreditTransactionSourceHistoryKind')).toBeLessThan(
    statusBlock.indexOf('delta < 0')
  )
  expect(statusBlock).not.toContain("actionType === 'group_deduct' || delta < 0")

  const prefixes = [
    'teacher.calendar.action.cancelFixedNoShow',
    'teacher.calendar.action.restoreOneLessonCredit',
    'teacher.outcome.fixedReversal.',
    'student.history.status.',
    'student.history.action.',
  ]
  const collectKeys = (source) =>
    [...source.matchAll(/^\s*'([^']+)':/gm)]
      .map((match) => match[1])
      .filter((key) => prefixes.some((prefix) => key.startsWith(prefix)))
      .sort()
  const scopedKoKeys = collectKeys(koSource)
  const scopedEnKeys = collectKeys(enSource)
  expect(scopedKoKeys).toEqual(scopedEnKeys)
  scopedKoKeys.forEach((key) => {
    expect(resourceValue(koSource, key).trim(), `${key} ko`).not.toBe('')
    expect(resourceValue(enSource, key).trim(), `${key} en`).not.toBe('')
  })
  for (const token of [
    "'student.history.status.fixedNoShowProcessed': '노쇼 처리됨'",
    "'student.history.status.fixedLessonCompleted': '수업완료 처리됨'",
    "'student.history.status.fixedNoShowCanceled': '노쇼 취소됨'",
    "'student.history.status.fixedNoShowProcessed': 'No-show processed'",
    "'student.history.status.fixedLessonCompleted': 'Lesson completed'",
    "'student.history.status.fixedNoShowCanceled': 'No-show canceled'",
    "'student.history.action.fixedOutcomeDeduction': '고정 1:1 결과 차감'",
    "'student.history.action.fixedNoShowReversal': '고정 1:1 노쇼 취소'",
    "'student.history.action.fixedOutcomeDeduction': 'Fixed 1:1 outcome deduction'",
    "'student.history.action.fixedNoShowReversal': 'Fixed 1:1 no-show cancellation'",
  ]) {
    expect(`${koSource}\n${enSource}`).toContain(token)
  }
})
