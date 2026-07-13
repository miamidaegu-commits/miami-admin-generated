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
  expect(directPreviewGate).toContain('canUseLegacyPrivateReservationActions')
  expect(legacyButtons.match(/canUseLegacyPrivateReservationActions/g)).toHaveLength(2)
  expect(legacyButtons).toContain("onMarkPrivateReservationOutcome?.(lesson, 'completed')")
  expect(legacyButtons).toContain("onMarkPrivateReservationOutcome?.(lesson, 'no_show')")
  expect(legacyButtons).toContain('onReversePrivateReservationOutcome?.(lesson)')

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
