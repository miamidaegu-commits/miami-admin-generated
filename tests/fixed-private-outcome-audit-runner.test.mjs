import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import {
  AUDIT_BLOCKER_CATEGORIES,
  AUDIT_CATEGORY_NAMES,
  AUDIT_CATEGORY_REASONS,
  AUDIT_INVENTORY_CATEGORIES,
  AUDIT_SCAN_FAMILIES,
  REDACTED_PRIMARY_COHORTS,
  aggregateAuditPages,
  buildRedactedCohortArtifact,
  classifyLegacyPartitionState,
  executeAuditCli,
  exitCodeForAuditSummary,
  redactedCohortKey,
  runProductionAudit,
  validateAuditV2Page,
  writeRedactedCohortArtifact,
} from '../scripts/run-fixed-private-outcome-ledger-audit.mjs'

const ACADEMY_ID = 'production-audit-academy'
const TOKEN = 'must-never-appear-in-output'

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function withFingerprint(record) {
  return {
    ...record,
    auditFingerprint: digest(stableStringify(record)),
  }
}

function environment(overrides = {}) {
  return {
    PROJECT_ID: 'daegu-miami-production',
    CONFIRM_PRODUCTION_READONLY_AUDIT: 'YES',
    CONFIRM_FIXED_PRIVATE_WRITE_QUIET_WINDOW: 'YES',
    ACADEMY_ID,
    FIREBASE_ID_TOKEN: TOKEN,
    ...overrides,
  }
}

function categoryMap(categories, valueFactory = () => 0) {
  return Object.fromEntries(categories.map((category) => [
    category,
    valueFactory(category),
  ]))
}

function pageSummary(records) {
  const inventory = categoryMap(AUDIT_INVENTORY_CATEGORIES)
  const blocking = categoryMap(AUDIT_BLOCKER_CATEGORIES)
  const samples = categoryMap(AUDIT_CATEGORY_NAMES, () => [])
  const add = (category, record) => {
    const target = AUDIT_INVENTORY_CATEGORIES.includes(category) ? inventory : blocking
    target[category] += 1
    if (samples[category].length < 10) {
      samples[category].push({
        occurrenceKey: record.occurrenceKey,
        lessonId: record.lessonId,
        reservationId: record.reservationId,
        slotId: record.slotId,
        reason: AUDIT_CATEGORY_REASONS[category],
      })
    }
  }
  for (const record of records.filter((candidate) => candidate.kind === 'occurrence')) {
    add('currentLedgerOccurrenceTotal', record)
    if (record.provenance.ledgerMode === 'canonical') {
      add('canonicalTotal', record)
      add('currentCanonicalLedgerTotal', record)
    } else if (record.provenance.ledgerMode === 'legacy') {
      add('legacyTotal', record)
      add('currentLegacyLedgerTotal', record)
    } else {
      add('currentUnknownOrMixedLedgerTotal', record)
    }
    add('occurrenceOriginTotal', record)
    if (record.provenance.originMode === 'born_canonical') {
      add('bornCanonicalTotal', record)
    } else if (
      ['converted_legacy', 'legacy_unconverted'].includes(
        record.provenance.originMode
      ) ||
      (
        record.provenance.originMode === 'unknown' &&
        record.provenance.hasLegacyEvidence === true
      )
    ) {
      add('legacyOriginTotal', record)
    } else {
      add('unknownOriginTotal', record)
    }
    for (const category of [
      'linkMismatch',
      'missingLinkedDocument',
      'academyMismatch',
      'studentMismatch',
      'packageMismatch',
      'packageMissing',
      'unclassifiableOccurrence',
      'orphanFixedReservation',
      'orphanFixedSlot',
      'fixedProvenanceMismatch',
      'outcomeStatusMismatch',
    ]) {
      if (record.diagnostics[category]) add(category, record)
    }
    if (record.teacherIdentity.conflict) add('teacherIdentityConflict', record)
  }
  return { inventory, blocking, samples }
}

function auditPage({
  family,
  records = [],
  cursor = '',
  nextCursor = '',
  hasMore = false,
  complete = !hasMore,
  truncated = false,
  omittedCount = 0,
  academyId = ACADEMY_ID,
}) {
  const summary = pageSummary(records)
  return {
    ok: true,
    auditVersion: 2,
    dryRun: true,
    previewOnly: true,
    commit: false,
    academyId,
    scanFamily: family,
    complete,
    truncated,
    omittedCount,
    page: {
      pageSize: 50,
      returnedCount: records.length,
      scannedCount: records.length,
      matchedCount: records.length,
      limit: 50,
      cursor,
      nextCursor,
      hasMore,
      complete,
      truncated,
      omittedCount,
    },
    inventory: summary.inventory,
    blocking: summary.blocking,
    samples: summary.samples,
    reasons: { ...AUDIT_CATEGORY_REASONS },
    records,
    aggregationRequired: [
      'teacherOwnershipMissing',
      'teacherOwnershipAmbiguous',
      'duplicateDeductionCredit',
      'conflictingDeductionEvidence',
      'legacyAlreadyConverted',
      'legacyUnsafeToConvert',
    ],
    bounds: {
      pageSize: 50,
      sampleIdsPerCategory: 10,
    },
  }
}

function occurrence({
  key,
  ledgerMode = 'canonical',
  originMode = ledgerMode === 'legacy'
    ? 'legacy_unconverted'
    : 'born_canonical',
  hasLegacyEvidence = [
    'converted_legacy',
    'legacy_unconverted',
  ].includes(originMode),
  legacyEvidenceConsistent = [
    'converted_legacy',
    'legacy_unconverted',
  ].includes(originMode),
  status = 'active',
  applied = false,
  deductionIds = [],
  lessonCountsByDate = false,
  lessonEnded = true,
  reservationCountsByEvidence = false,
  packageUsedCount = reservationCountsByEvidence + lessonCountsByDate,
  diagnostics = {},
  rowFlags = [],
}) {
  const lessonId = `${key}-lesson`
  const reservationId = `${key}-reservation`
  const slotId = `${key}-slot`
  const packageTotal = 20
  const result = {
    kind: 'occurrence',
    rootFamily: 'fixedLessons',
    rootId: lessonId,
    occurrenceKey: `lesson:${lessonId}`,
    academyId: ACADEMY_ID,
    lessonId,
    reservationId,
    slotId,
    packageId: `${key}-package`,
    studentId: `${key}-student`,
    expectedCreditId: `${key}-credit`,
    fixedFamilies: { lesson: true, reservation: true, slot: true },
    exists: { lesson: true, reservation: true, slot: true, package: true },
    provenance: {
      ledgerMode,
      hasCanonicalMarker: ledgerMode === 'canonical',
      hasLegacyEvidence,
      legacyEvidenceConsistent,
      originMode,
    },
    statuses: {
      lesson: status,
      reservation: status,
      slot: 'reserved',
    },
    deduction: {
      lessonApplied: applied,
      reservationApplied: applied,
      slotApplied: false,
      ids: deductionIds,
    },
    diagnostics: {
      linkReasons: [],
      linkMismatch: false,
      missingLinkedDocument: false,
      academyMismatch: false,
      studentMismatch: false,
      packageMismatch: false,
      packageMissing: false,
      unclassifiableOccurrence: false,
      orphanFixedReservation: false,
      orphanFixedSlot: false,
      fixedProvenanceMismatch: false,
      outcomeStatusMismatch: false,
      ...diagnostics,
    },
    diagnosticReasons: {
      provenance: [],
      outcomeStatus: [],
      rowFlags,
    },
    ledgerContribution: {
      lessonCountsByDate,
      lessonEnded,
      reservationCountsByEvidence,
    },
    packageCounts: {
      totalCount: packageTotal,
      usedCount: packageUsedCount,
      remainingCount: packageTotal - packageUsedCount,
    },
    teacherIdentity: {
      conflict: false,
      tier: 'uid',
      values: [digest(`${key}-teacher-uid`)],
    },
    declaredCredits: [],
  }
  return withFingerprint(result)
}

function membership(key) {
  const uid = digest(`${key}-teacher-uid`)
  return withFingerprint({
    kind: 'teacherMembership',
    membershipKey: digest(`${key}-membership`),
    identity: {
      uid: [uid],
      teacherId: [],
      teacherKey: [],
      name: [],
    },
    declaredTeacherUid: uid,
  })
}

function deductionCredit(record, overrides = {}) {
  const id = overrides.id || record.deduction.ids[0] || record.expectedCreditId
  const result = {
    kind: 'credit',
    id,
    sourceId: record.reservationId,
    lessonId: record.lessonId,
    slotId: record.slotId,
    packageId: record.packageId,
    studentId: record.studentId,
    sourceType: 'fixedPrivateReservation',
    actionType: 'fixed_private_completed_deduct',
    ledgerTransition: 'reservation_increment',
    marker: 'reservation_v1',
    academyId: ACADEMY_ID,
    deltaCount: -1,
    ...overrides,
  }
  return withFingerprint(result)
}

function pagesFor({
  occurrences = [],
  credits = [],
  memberships = [],
  overrides = {},
}) {
  return Object.fromEntries(AUDIT_SCAN_FAMILIES.map((family) => {
    const records = family === 'fixedLessons'
      ? occurrences
      : family === 'deductionCredits'
        ? credits
        : family === 'teacherMemberships'
          ? memberships
          : []
    return [family, [auditPage({
      family,
      records,
      ...(overrides[family] || {}),
    })]]
  }))
}

function mockFetch(factory) {
  let callCount = 0
  return async (_url, options) => {
    const request = JSON.parse(options.body).data
    assert.equal(request.auditVersion, 2)
    assert.equal(request.dryRun, true)
    assert.equal(request.previewOnly, true)
    assert.equal(request.commit, false)
    const result = factory(request, callCount++)
    return {
      ok: true,
      status: 200,
      async json() {
        return { result }
      },
    }
  }
}

function mockStablePages(pagesByFamily) {
  return mockFetch((request) => {
    const page = pagesByFamily[request.scanFamily].find(
      (candidate) => candidate.page.cursor === request.cursor
    )
    assert.ok(page, `missing mocked page ${request.scanFamily}:${request.cursor}`)
    return structuredClone(page)
  })
}

test('production guards fail before every network request', async () => {
  for (const invalidEnv of [
    environment({ FIREBASE_ID_TOKEN: '' }),
    environment({ PROJECT_ID: 'demo-project' }),
    environment({ CONFIRM_PRODUCTION_READONLY_AUDIT: '' }),
    environment({ CONFIRM_FIXED_PRIVATE_WRITE_QUIET_WINDOW: '' }),
    environment({ ACADEMY_ID: '' }),
    environment({ ACADEMY_ID: 'invalid/id' }),
    environment({ ACADEMY_ID: 'a'.repeat(201) }),
  ]) {
    let fetchCount = 0
    const exitCode = await executeAuditCli({
      env: invalidEnv,
      fetchImpl: async () => {
        fetchCount += 1
        throw new Error('network must not run')
      },
      writeOutput() {},
      writeError() {},
    })
    assert.equal(exitCode, 1)
    assert.equal(fetchCount, 0)
  }
})

test('strict schema rejects malformed response variants', async () => {
  const valid = auditPage({ family: 'fixedLessons' })
  const variants = [
    (row) => { delete row.records },
    (row) => { row.records = null },
    (row) => { row.records = {} },
    (row) => { row.blocking.futureBlocker = 0 },
    (row) => { row.inventory.futureInventory = 0 },
    (row) => { delete row.inventory.canonicalTotal },
    (row) => { row.omittedCount = 'not-a-number' },
    (row) => { row.omittedCount = Number.NaN },
    (row) => { row.omittedCount = Number.POSITIVE_INFINITY },
    (row) => { row.omittedCount = null },
    (row) => { row.page.scannedCount = -1 },
    (row) => { row.page.matchedCount = 0.5 },
    (row) => { row.page.scannedCount = 51 },
    (row) => { row.page.returnedCount = 51 },
    (row) => { row.page.returnedCount = 1; row.page.scannedCount = 0 },
    (row) => { row.page.pageSize = 0; row.page.limit = 0 },
    (row) => { row.page.pageSize = 51; row.page.limit = 51 },
    (row) => { row.page.pageSize = '50'; row.page.limit = '50' },
    (row) => { row.page.pageSize = 1.5; row.page.limit = 1.5 },
    (row) => {
      row.page.hasMore = true
      row.page.complete = false
      row.complete = false
      row.page.nextCursor = 'not+opaque'
    },
    (row) => { row.blocking.linkMismatch = -1 },
    (row) => { row.inventory.canonicalTotal = 0.5 },
    (row) => { row.academyId = 'wrong-academy' },
    (row) => { row.page.returnedCount = 1 },
    (row) => { delete row.page.pageSize },
    (row) => { row.records = [{ kind: 'futureRecord' }]; row.page.returnedCount = 1; row.page.matchedCount = 1; row.page.scannedCount = 1 },
    (row) => { row.samples.canonicalTotal = [{ occurrenceKey: '', lessonId: '', reservationId: '', slotId: '', reason: 'unknown' }] },
  ]
  for (const mutate of variants) {
    const malformed = structuredClone(valid)
    mutate(malformed)
    const exitCode = await executeAuditCli({
      env: environment(),
      fetchImpl: mockFetch(() => malformed),
      writeOutput() {},
      writeError() {},
    })
    assert.equal(exitCode, 1)
  }
})

test('page bounds reject oversized record arrays and accept valid terminal shapes', async () => {
  const oversizedRecords = Array.from({ length: 51 }, (_, index) =>
    occurrence({ key: `oversized-${index}` })
  )
  const oversized = auditPage({
    family: 'fixedLessons',
    records: oversizedRecords,
  })
  const exitCode = await executeAuditCli({
    env: environment(),
    fetchImpl: mockFetch(() => oversized),
    writeOutput() {},
    writeError() {},
  })
  assert.equal(exitCode, 1)

  for (const page of [
    auditPage({ family: 'fixedLessons' }),
    auditPage({
      family: 'fixedLessons',
      records: Array.from({ length: 3 }, (_, index) =>
        occurrence({ key: `partial-${index}` })
      ),
    }),
    auditPage({
      family: 'fixedLessons',
      records: Array.from({ length: 50 }, (_, index) =>
        occurrence({ key: `full-${index}` })
      ),
    }),
  ]) {
    assert.equal(validateAuditV2Page(page, {
      academyId: ACADEMY_ID,
      scanFamily: 'fixedLessons',
      cursor: '',
    }), page)
  }
})

test('valid quiet-window double run returns exit 0', async () => {
  const canonical = occurrence({ key: 'canonical' })
  const pages = pagesFor({
    occurrences: [canonical],
    memberships: [membership('canonical')],
  })
  const summary = await runProductionAudit({
    env: environment(),
    fetchImpl: mockStablePages(pages),
  })
  assert.equal(summary.completedRuns, 2)
  assert.equal(summary.consistency, true)
  assert.equal(summary.runDigests[0], summary.runDigests[1])
  assert.equal(summary.blockerTotal, 0)
  assert.equal(summary.pass, true)
  assert.equal(exitCodeForAuditSummary(summary), 0)
  assert.equal(exitCodeForAuditSummary({ ...summary, pass: false }), 1)
  assert.equal(exitCodeForAuditSummary({
    ...summary,
    omittedCount: 'not-a-number',
  }), 1)
})

test('current-ledger and legacy-origin inventory dimensions form exact partitions', () => {
  const safeLegacy = occurrence({
    key: 'partition-safe-legacy',
    ledgerMode: 'legacy',
    lessonCountsByDate: true,
    packageUsedCount: 1,
  })
  const converted = occurrence({
    key: 'partition-converted',
    originMode: 'converted_legacy',
    status: 'completed',
    applied: true,
    deductionIds: ['partition-converted-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [safeLegacy, converted],
    credits: [deductionCredit(converted, {
      id: 'partition-converted-credit',
      ledgerTransition: 'lesson_to_reservation',
    })],
    memberships: [
      membership('partition-safe-legacy'),
      membership('partition-converted'),
    ],
  }))
  assert.equal(summary.counts.currentCanonicalLedgerTotal, 1)
  assert.equal(summary.counts.currentLegacyLedgerTotal, 1)
  assert.equal(summary.counts.currentUnknownOrMixedLedgerTotal, 0)
  assert.equal(summary.counts.bornCanonicalTotal, 0)
  assert.equal(summary.counts.legacyOriginTotal, 2)
  assert.equal(summary.counts.unknownOriginTotal, 0)
  assert.equal(summary.counts.legacySafelyConvertible, 1)
  assert.equal(summary.counts.legacyAlreadyConverted, 1)
  assert.equal(summary.counts.legacyTerminal, 0)
  assert.equal(summary.counts.legacyUnsafeToConvert, 0)
  assert.equal(summary.pass, true)
  assert.equal(exitCodeForAuditSummary({
    ...summary,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency: true,
    runDigests: [summary.summaryDigest, summary.summaryDigest],
  }), 0)
})

test('born canonical and unknown legacy evidence stay in exclusive origin buckets', () => {
  const born = occurrence({ key: 'partition-born' })
  const unknownLegacy = occurrence({
    key: 'partition-unknown-legacy',
    originMode: 'unknown',
    hasLegacyEvidence: true,
    legacyEvidenceConsistent: false,
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [born, unknownLegacy],
    memberships: [
      membership('partition-born'),
      membership('partition-unknown-legacy'),
    ],
  }))
  assert.equal(summary.counts.bornCanonicalTotal, 1)
  assert.equal(summary.counts.legacyOriginTotal, 1)
  assert.equal(summary.counts.unknownOriginTotal, 0)
  assert.equal(summary.counts.legacyUnsafeToConvert, 1)
  assert.equal(summary.counts.unclassifiableOccurrence, 1)
  assert.equal(summary.pass, false)
  assert.equal(exitCodeForAuditSummary({
    ...summary,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency: true,
    runDigests: [summary.summaryDigest, summary.summaryDigest],
  }), 2)
})

test('legacy partition classifier assigns exactly one state by priority', () => {
  const converted = occurrence({
    key: 'partition-priority',
    originMode: 'converted_legacy',
  })
  assert.equal(classifyLegacyPartitionState(converted, {
    converted: true,
    terminalUnconverted: true,
    safelyConvertible: true,
  }), 'already_converted')
  assert.equal(classifyLegacyPartitionState(
    occurrence({ key: 'partition-born-only' }),
    {
      converted: true,
      terminalUnconverted: true,
      safelyConvertible: true,
    }
  ), '')
})

test('tampered or duplicate legacy partitions fail as protocol exit 1', async () => {
  const converted = occurrence({
    key: 'partition-tamper',
    originMode: 'converted_legacy',
    status: 'completed',
    applied: true,
    deductionIds: ['partition-tamper-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [converted],
    credits: [deductionCredit(converted, {
      id: 'partition-tamper-credit',
      ledgerTransition: 'lesson_to_reservation',
    })],
    memberships: [membership('partition-tamper')],
  }))
  const finalSummary = {
    ...summary,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency: true,
    runDigests: [summary.summaryDigest, summary.summaryDigest],
  }
  const mismatchedTotal = structuredClone(finalSummary)
  mismatchedTotal.counts.legacyOriginTotal = 0
  mismatchedTotal.pass = false
  assert.equal(exitCodeForAuditSummary(mismatchedTotal), 1)

  const duplicateAssignment = structuredClone(finalSummary)
  duplicateAssignment.counts.legacyTerminal = 1
  duplicateAssignment.pass = false
  assert.equal(exitCodeForAuditSummary(duplicateAssignment), 1)

  const recordParityMismatch = structuredClone(finalSummary)
  recordParityMismatch.counts.bornCanonicalTotal = 1
  recordParityMismatch.counts.legacyOriginTotal = 0
  recordParityMismatch.counts.legacyAlreadyConverted = 0
  recordParityMismatch.pass = false
  assert.equal(exitCodeForAuditSummary(recordParityMismatch), 1)
})

test('double-run record digest mismatch fails closed with exit 3', async () => {
  const first = occurrence({ key: 'drift' })
  const second = {
    ...first,
    statuses: { ...first.statuses, lesson: 'scheduled' },
  }
  second.auditFingerprint = withFingerprint(
    Object.fromEntries(Object.entries(second).filter(([key]) =>
      key !== 'auditFingerprint'
    ))
  ).auditFingerprint
  const fetchImpl = mockFetch((request, callCount) => {
    const runIndex = Math.floor(callCount / AUDIT_SCAN_FAMILIES.length)
    const records = request.scanFamily === 'fixedLessons'
      ? [runIndex === 0 ? first : second]
      : request.scanFamily === 'teacherMemberships'
        ? [membership('drift')]
        : []
    return auditPage({ family: request.scanFamily, records })
  })
  const summary = await runProductionAudit({ env: environment(), fetchImpl })
  assert.equal(summary.consistency, false)
  assert.equal(summary.pass, false)
  assert.equal(exitCodeForAuditSummary(summary), 3)
})

test('incomplete, truncated, or omitted double runs use exit 3', async () => {
  const pages = pagesFor({
    overrides: {
      fixedLessons: {
        truncated: true,
        omittedCount: 1,
      },
    },
  })
  const summary = await runProductionAudit({
    env: environment(),
    fetchImpl: mockStablePages(pages),
  })
  assert.equal(summary.complete, false)
  assert.equal(summary.truncated, true)
  assert.equal(summary.omittedCount, 1)
  assert.equal(summary.consistency, true)
  assert.equal(exitCodeForAuditSummary(summary), 3)
})

test('repeated pagination cursor fails as protocol error', async () => {
  const token = 'opaqueCursor'
  const fetchImpl = mockFetch((request) => auditPage({
    family: request.scanFamily,
    cursor: request.cursor,
    nextCursor: token,
    hasMore: true,
  }))
  const exitCode = await executeAuditCli({
    env: environment(),
    fetchImpl,
    writeOutput() {},
    writeError() {},
  })
  assert.equal(exitCode, 1)
})

test('wrong canonical credit references and values are blockers', () => {
  for (const overrides of [
    { lessonId: 'wrong-lesson' },
    { slotId: 'wrong-slot' },
    { lessonId: 'wrong-lesson', slotId: 'wrong-slot' },
    { lessonId: '' },
    { slotId: '' },
    { sourceId: 'wrong-reservation' },
    { sourceType: 'privateReservation' },
    { deltaCount: 0 },
    { id: 'wrong-deterministic-id' },
    { studentId: 'wrong-student' },
    { packageId: 'wrong-package' },
    { academyId: 'wrong-academy' },
  ]) {
    const terminal = occurrence({
      key: `reference-${JSON.stringify(overrides)}`,
      status: 'completed',
      applied: true,
      deductionIds: ['reference-credit'],
      reservationCountsByEvidence: true,
      packageUsedCount: 1,
    })
    const credit = deductionCredit(terminal, {
      id: 'reference-credit',
      ...overrides,
    })
    const summary = aggregateAuditPages(pagesFor({
      occurrences: [terminal],
      credits: [credit],
      memberships: [membership(`reference-${JSON.stringify(overrides)}`)],
    }))
    assert.equal(summary.counts.conflictingDeductionEvidence, 1)
    assert.equal(summary.pass, false)
  }
})

test('converted legacy credit requires independent origin and complete transition evidence', () => {
  const converted = occurrence({
    key: 'converted',
    originMode: 'converted_legacy',
    status: 'completed',
    applied: true,
    deductionIds: ['legacy-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const credit = deductionCredit(converted, {
    id: 'legacy-credit',
    sourceType: 'privateReservation',
    actionType: 'private_reservation_completed_deduct',
    marker: '',
    ledgerTransition: 'lesson_to_reservation',
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [converted],
    credits: [credit],
    memberships: [membership('converted')],
  }))
  assert.equal(summary.counts.conflictingDeductionEvidence, 0)
  assert.equal(summary.counts.legacyAlreadyConverted, 1)
  assert.equal(summary.pass, true)
})

test('born-canonical legacy credit without transition is a blocker', () => {
  const canonical = occurrence({
    key: 'canonical-legacy-false-pass',
    status: 'completed',
    applied: true,
    deductionIds: ['legacy-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const legacyCredit = deductionCredit(canonical, {
    id: 'legacy-credit',
    sourceType: 'privateReservation',
    actionType: 'private_reservation_completed_deduct',
    marker: '',
    ledgerTransition: '',
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [canonical],
    credits: [legacyCredit],
    memberships: [membership('canonical-legacy-false-pass')],
  }))
  assert.equal(summary.pass, false)
  assert.ok(summary.blockerTotal > 0)
  assert.equal(summary.counts.conflictingDeductionEvidence, 1)
  assert.equal(exitCodeForAuditSummary({
    ...summary,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency: true,
    runDigests: [summary.summaryDigest, summary.summaryDigest],
  }), 2)
})

test('born-canonical legacy credit cannot self-declare a conversion', () => {
  const canonical = occurrence({
    key: 'canonical-self-declared-conversion',
    status: 'completed',
    applied: true,
    deductionIds: ['legacy-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const legacyCredit = deductionCredit(canonical, {
    id: 'legacy-credit',
    sourceType: 'privateReservation',
    actionType: 'private_reservation_completed_deduct',
    marker: '',
    ledgerTransition: 'lesson_to_reservation',
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [canonical],
    credits: [legacyCredit],
    memberships: [membership('canonical-self-declared-conversion')],
  }))
  assert.equal(canonical.provenance.hasLegacyEvidence, false)
  assert.equal(canonical.provenance.originMode, 'born_canonical')
  assert.equal(summary.pass, false)
  assert.equal(summary.counts.conflictingDeductionEvidence, 1)
  assert.equal(summary.counts.legacyAlreadyConverted, 0)
  assert.equal(exitCodeForAuditSummary({
    ...summary,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency: true,
    runDigests: [summary.summaryDigest, summary.summaryDigest],
  }), 2)
})

test('born-canonical canonical credit remains consistent', () => {
  const canonical = occurrence({
    key: 'canonical',
    status: 'completed',
    applied: true,
    deductionIds: ['canonical-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [canonical],
    credits: [deductionCredit(canonical)],
    memberships: [membership('canonical')],
  }))
  assert.equal(summary.counts.conflictingDeductionEvidence, 0)
  assert.equal(summary.counts.alreadyReservationDeductedConsistent, 1)
  assert.equal(summary.pass, true)
})

test('converted legacy credit rejects missing, wrong, or mismatched transition evidence', () => {
  for (const overrides of [
    { ledgerTransition: '' },
    { ledgerTransition: 'reservation_increment' },
    { lessonId: '' },
    { slotId: '' },
    { lessonId: 'wrong-lesson' },
    { slotId: 'wrong-slot' },
  ]) {
    const key = `converted-invalid-${JSON.stringify(overrides)}`
    const converted = occurrence({
      key,
      originMode: 'converted_legacy',
      status: 'completed',
      applied: true,
      deductionIds: ['legacy-credit'],
      reservationCountsByEvidence: true,
      packageUsedCount: 1,
    })
    const credit = deductionCredit(converted, {
      id: 'legacy-credit',
      sourceType: 'privateReservation',
      actionType: 'private_reservation_completed_deduct',
      marker: '',
      ledgerTransition: 'lesson_to_reservation',
      ...overrides,
    })
    const summary = aggregateAuditPages(pagesFor({
      occurrences: [converted],
      credits: [credit],
      memberships: [membership(key)],
    }))
    assert.equal(summary.counts.conflictingDeductionEvidence, 1)
    assert.equal(summary.counts.legacyAlreadyConverted, 0)
    assert.equal(summary.pass, false)
  }
})

test('unknown origin cannot use a transition credit as conversion evidence', () => {
  const unknown = occurrence({
    key: 'unknown-origin',
    originMode: 'unknown',
    status: 'completed',
    applied: true,
    deductionIds: ['legacy-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const credit = deductionCredit(unknown, {
    id: 'legacy-credit',
    sourceType: 'privateReservation',
    actionType: 'private_reservation_completed_deduct',
    marker: '',
    ledgerTransition: 'lesson_to_reservation',
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [unknown],
    credits: [credit],
    memberships: [membership('unknown-origin')],
  }))
  assert.equal(summary.counts.conflictingDeductionEvidence, 1)
  assert.equal(summary.counts.legacyAlreadyConverted, 0)
  assert.equal(summary.pass, false)
})

test('canonical and converted-legacy credits together are duplicate evidence', () => {
  const terminal = occurrence({
    key: 'canonical-and-legacy',
    status: 'completed',
    applied: true,
    deductionIds: ['canonical-and-legacy-credit'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const canonical = deductionCredit(terminal)
  const legacy = deductionCredit(terminal, {
    id: 'legacy-extra-credit',
    sourceType: 'privateReservation',
    actionType: 'private_reservation_completed_deduct',
    marker: '',
    ledgerTransition: 'lesson_to_reservation',
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [terminal],
    credits: [canonical, legacy],
    memberships: [membership('canonical-and-legacy')],
  }))
  assert.equal(summary.counts.duplicateDeductionCredit, 1)
  assert.equal(summary.pass, false)
})

test('credit blocker counts remain exhaustive beyond the sample cap', () => {
  const occurrences = Array.from({ length: 12 }, (_, index) =>
    occurrence({
      key: `sample-cap-${index}`,
      status: 'completed',
      applied: true,
      deductionIds: [`sample-cap-credit-${index}`],
      reservationCountsByEvidence: true,
      packageUsedCount: 1,
    })
  )
  const credits = occurrences.map((row, index) => deductionCredit(row, {
    id: `sample-cap-credit-${index}`,
    sourceType: 'privateReservation',
    actionType: 'private_reservation_completed_deduct',
    marker: '',
    ledgerTransition: '',
  }))
  const summary = aggregateAuditPages(pagesFor({
    occurrences,
    credits,
    memberships: Array.from({ length: 12 }, (_, index) =>
      membership(`sample-cap-${index}`)
    ),
  }))
  assert.equal(summary.counts.conflictingDeductionEvidence, 12)
  assert.equal(summary.samples.conflictingDeductionEvidence.length, 10)
  assert.equal(summary.pass, false)
})

test('declared cross-academy credit is a blocker, not a protocol bypass', async () => {
  const terminalBase = occurrence({
    key: 'cross-academy-credit',
    status: 'completed',
    applied: true,
    deductionIds: ['cross-academy-credit-id'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const wrongAcademyCredit = deductionCredit(terminalBase, {
    id: 'cross-academy-credit-id',
    academyId: 'different-academy',
  })
  const withoutFingerprint = { ...terminalBase }
  delete withoutFingerprint.auditFingerprint
  const terminal = withFingerprint({
    ...withoutFingerprint,
    declaredCredits: [wrongAcademyCredit],
  })
  const pages = pagesFor({
    occurrences: [terminal],
    memberships: [membership('cross-academy-credit')],
  })
  const summary = await runProductionAudit({
    env: environment(),
    fetchImpl: mockStablePages(pages),
  })
  assert.equal(summary.counts.conflictingDeductionEvidence, 1)
  assert.equal(exitCodeForAuditSummary(summary), 2)
})

test('legacy readiness and unsafe remainder are exhaustive', () => {
  const safe = occurrence({
    key: 'legacy-safe',
    ledgerMode: 'legacy',
    lessonCountsByDate: true,
    packageUsedCount: 1,
  })
  const unsafe = occurrence({
    key: 'legacy-unsafe',
    ledgerMode: 'legacy',
    lessonCountsByDate: false,
    rowFlags: ['lesson_no_deduction'],
  })
  const notEnded = occurrence({
    key: 'legacy-not-ended',
    ledgerMode: 'legacy',
    lessonCountsByDate: true,
    lessonEnded: false,
    packageUsedCount: 1,
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [safe, unsafe, notEnded],
    memberships: [
      membership('legacy-safe'),
      membership('legacy-unsafe'),
      membership('legacy-not-ended'),
    ],
  }))
  assert.equal(summary.counts.legacyTotal, 3)
  assert.equal(summary.counts.legacySafelyConvertible, 1)
  assert.equal(summary.counts.legacyUnsafeToConvert, 2)
  assert.equal(exitCodeForAuditSummary({
    ...summary,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency: true,
    runDigests: [summary.summaryDigest, summary.summaryDigest],
  }), 2)
})

test('cross-page duplicate credits fail with blocker exit 2', async () => {
  const terminal = occurrence({
    key: 'duplicate',
    status: 'completed',
    applied: true,
    deductionIds: ['duplicate-credit-a'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const cursor = 'credit-page-two'
  const pages = pagesFor({
    occurrences: [terminal],
    memberships: [membership('duplicate')],
  })
  pages.deductionCredits = [
    auditPage({
      family: 'deductionCredits',
      records: [deductionCredit(terminal, { id: 'duplicate-credit-a' })],
      nextCursor: cursor,
      hasMore: true,
    }),
    auditPage({
      family: 'deductionCredits',
      cursor,
      records: [deductionCredit(terminal, { id: 'duplicate-credit-b' })],
    }),
  ]
  const summary = await runProductionAudit({
    env: environment(),
    fetchImpl: mockStablePages(pages),
  })
  assert.equal(summary.counts.duplicateDeductionCredit, 1)
  assert.equal(summary.consistency, true)
  assert.equal(exitCodeForAuditSummary(summary), 2)
})

test('conflicting lesson reservation slot deduction IDs are blockers', () => {
  const terminal = occurrence({
    key: 'deduction-id-conflict',
    status: 'completed',
    applied: true,
    deductionIds: ['deduction-credit-a', 'deduction-credit-b'],
    reservationCountsByEvidence: true,
    packageUsedCount: 1,
  })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [terminal],
    credits: [deductionCredit(terminal, { id: 'deduction-credit-a' })],
    memberships: [membership('deduction-id-conflict')],
  }))
  assert.equal(summary.counts.conflictingDeductionEvidence, 1)
  assert.equal(summary.pass, false)
})

test('credit with deductionApplied false is conflicting evidence', () => {
  const active = occurrence({ key: 'unexpected-credit' })
  const summary = aggregateAuditPages(pagesFor({
    occurrences: [active],
    credits: [deductionCredit(active)],
    memberships: [membership('unexpected-credit')],
  }))
  assert.equal(summary.counts.conflictingDeductionEvidence, 1)
  assert.equal(summary.pass, false)
})

test('fixed deduction credit without an occurrence is redacted and reconciled', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-audit-orphan-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'artifact.json')
  const orphan = deductionCredit(occurrence({ key: 'orphan' }), {
    id: 'orphan-fixed-credit',
  })
  const pages = pagesFor({ credits: [orphan] })
  const summary = await runProductionAudit({
    env: environment({
      AUDIT_REDACTED_OUTPUT: outputPath,
      AUDIT_REDACTION_KEY: REDACTION_KEY,
    }),
    fetchImpl: mockStablePages(pages),
  })
  assert.equal(summary.counts.unclassifiableOccurrence, 1)
  assert.equal(summary.counts.conflictingDeductionEvidence, 1)
  assert.equal(exitCodeForAuditSummary(summary), 2)
  const artifact = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  assert.equal(artifact.summary.totalOccurrences, 0)
  assert.equal(artifact.summary.nonOccurrenceEvidenceCount, 1)
  assert.equal(artifact.summary.rawBlockingCategoryCount, 2)
  assert.equal(artifact.occurrences.length, 0)
  assert.equal(artifact.nonOccurrenceEvidence.length, 1)
  assert.deepEqual(
    artifact.nonOccurrenceEvidence[0].blockingCategories,
    ['conflictingDeductionEvidence', 'unclassifiableOccurrence']
  )
  assert.equal(
    artifact.overlapCounts[
      'conflictingDeductionEvidence&unclassifiableOccurrence'
    ],
    1
  )
  assert.equal(JSON.stringify(artifact).includes(orphan.id), false)
})

test('protocol page validator accepts only the exact current schema', () => {
  const page = auditPage({ family: 'fixedLessons' })
  assert.equal(validateAuditV2Page(page, {
    academyId: ACADEMY_ID,
    scanFamily: 'fixedLessons',
    cursor: '',
  }), page)
})

test('callable error envelopes and malformed JSON use exit 1', async () => {
  for (const fetchImpl of [
    async () => ({
      ok: true,
      status: 200,
      async json() {
        return { error: { status: 'PERMISSION_DENIED' } }
      },
    }),
    async () => ({
      ok: true,
      status: 200,
      async json() {
        throw new SyntaxError('invalid json')
      },
    }),
  ]) {
    const exitCode = await executeAuditCli({
      env: environment(),
      fetchImpl,
      writeOutput() {},
      writeError() {},
    })
    assert.equal(exitCode, 1)
  }
})

test('runner never writes token to stdout or stderr', async () => {
  const output = []
  const exitCode = await executeAuditCli({
    env: environment(),
    fetchImpl: async () => {
      throw new Error(`network rejected bearer ${TOKEN}`)
    },
    writeOutput(value) {
      output.push(value)
    },
    writeError(value) {
      output.push(value)
    },
  })
  assert.equal(exitCode, 1)
  assert.equal(output.join('\n').includes(TOKEN), false)
})

const REDACTION_KEY = 'artifact-redaction-key-at-least-32-characters'

function finalSummary(summary) {
  return {
    ...summary,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency: true,
    runDigests: [summary.summaryDigest, summary.summaryDigest],
  }
}

function sourceReconciliation(summary) {
  return {
    totals: { ...summary.totals },
    scanFamilies: Object.fromEntries(AUDIT_SCAN_FAMILIES.map((family) => [
      family,
      {
        scannedCount: summary.scanFamilies[family].scannedCount,
        recordCount: summary.scanFamilies[family].matchedCount,
        datasetDigest: summary.scanFamilies[family].datasetDigest,
      },
    ])),
  }
}

function safeLegacyEvidence(record) {
  return {
    occurrenceKey: record.occurrenceKey,
    blockingCategories: [],
    currentLedgerMode: 'legacy',
    originMode: 'legacy_unconverted',
    legacyPartitionState: 'safely_convertible',
    evidenceFlags: {
      activeLifecycle: true,
      terminalLifecycle: false,
      hasAllLinkedDocuments: true,
      allFixedFamilies: true,
      packageReferencePresent: true,
      teacherMappingResolved: true,
      singleConsistentDeductionEvidence: false,
      linkageEvidenceComplete: true,
    },
  }
}

test('redacted artifact opt-in guards fail before network', async () => {
  const invalidArtifactEnvironments = [
    environment({ AUDIT_REDACTED_OUTPUT: '/tmp/audit-artifact.json' }),
    environment({ AUDIT_REDACTION_KEY: REDACTION_KEY }),
    environment({
      AUDIT_REDACTED_OUTPUT: 'relative-artifact.json',
      AUDIT_REDACTION_KEY: REDACTION_KEY,
    }),
    environment({
      AUDIT_REDACTED_OUTPUT: '/tmp/audit-artifact.json',
      AUDIT_REDACTION_KEY: 'too-short',
    }),
  ]
  for (const env of invalidArtifactEnvironments) {
    let fetchCount = 0
    const exitCode = await executeAuditCli({
      env,
      fetchImpl: async () => {
        fetchCount += 1
        throw new Error('network must not run')
      },
      writeOutput() {},
      writeError() {},
    })
    assert.equal(exitCode, 1)
    assert.equal(fetchCount, 0)
  }
})

test('pre-existing artifact output fails before network', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-audit-stale-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'artifact.json')
  const staleContent = '{"stale":true}\n'
  fs.writeFileSync(outputPath, staleContent, { mode: 0o600 })
  let fetchCount = 0
  const exitCode = await executeAuditCli({
    env: environment({
      AUDIT_REDACTED_OUTPUT: outputPath,
      AUDIT_REDACTION_KEY: REDACTION_KEY,
    }),
    fetchImpl: async () => {
      fetchCount += 1
      throw new Error('network must not run')
    },
    writeOutput() {},
    writeError() {},
  })
  assert.equal(exitCode, 1)
  assert.equal(fetchCount, 0)
  assert.equal(fs.readFileSync(outputPath, 'utf8'), staleContent)
})

test('artifact opt-out preserves existing runner behavior', async () => {
  let artifactWriteCount = 0
  const summary = await runProductionAudit({
    env: environment(),
    fetchImpl: mockStablePages(pagesFor({})),
    artifactWriter: async () => {
      artifactWriteCount += 1
    },
  })
  assert.equal(exitCodeForAuditSummary(summary), 0)
  assert.equal(artifactWriteCount, 0)
})

test('cohort HMAC is deterministic per key and isolated across keys', () => {
  const input = {
    academyId: ACADEMY_ID,
    occurrenceKey: 'raw-occurrence-key',
  }
  const first = redactedCohortKey({
    ...input,
    redactionKey: REDACTION_KEY,
  })
  const repeated = redactedCohortKey({
    ...input,
    redactionKey: REDACTION_KEY,
  })
  const otherKey = redactedCohortKey({
    ...input,
    redactionKey: `${REDACTION_KEY}-different`,
  })
  assert.match(first, /^[a-f0-9]{64}$/)
  assert.equal(first, repeated)
  assert.notEqual(first, otherKey)
  assert.equal(first.includes(input.occurrenceKey), false)
})

test('artifact is exhaustive, redacted, deterministic, and mode 0600', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-audit-artifact-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'cohorts.json')
  const financial = occurrence({
    key: 'artifact-financial',
    applied: true,
    deductionIds: ['artifact-financial-missing-credit'],
    diagnostics: {
      packageMismatch: true,
      missingLinkedDocument: true,
    },
  })
  const packageBlocked = occurrence({
    key: 'artifact-package',
    diagnostics: { packageMismatch: true },
  })
  const structural = occurrence({
    key: 'artifact-structural',
    diagnostics: {
      missingLinkedDocument: true,
      orphanFixedReservation: true,
    },
  })
  const linkMismatch = occurrence({
    key: 'artifact-link',
    diagnostics: {
      linkMismatch: true,
      fixedProvenanceMismatch: true,
    },
  })
  const teacherMissing = occurrence({ key: 'artifact-teacher' })
  const unsafe = occurrence({
    key: 'artifact-unsafe',
    ledgerMode: 'legacy',
    diagnostics: { unclassifiableOccurrence: true },
  })
  const safe = occurrence({
    key: 'artifact-safe',
    ledgerMode: 'legacy',
    lessonCountsByDate: true,
    packageUsedCount: 1,
  })
  const records = [
    financial,
    packageBlocked,
    structural,
    linkMismatch,
    teacherMissing,
    unsafe,
    safe,
  ]
  const memberships = records
    .filter((record) => record !== teacherMissing)
    .map((record) => membership(
      record.lessonId.replace(/-lesson$/, '')
    ))
  const summary = await runProductionAudit({
    env: environment({
      AUDIT_REDACTED_OUTPUT: outputPath,
      AUDIT_REDACTION_KEY: REDACTION_KEY,
    }),
    fetchImpl: mockStablePages(pagesFor({
      occurrences: records,
      memberships,
    })),
  })
  assert.equal(exitCodeForAuditSummary(summary), 2)
  assert.equal(fs.existsSync(outputPath), true)
  assert.equal(fs.statSync(outputPath).mode & 0o777, 0o600)

  const artifact = JSON.parse(fs.readFileSync(outputPath, 'utf8'))
  assert.equal(artifact.artifactVersion, 1)
  assert.equal(artifact.auditVersion, 2)
  assert.equal(artifact.project, 'daegu-miami-production')
  assert.equal(artifact.academy, 'REDACTED')
  assert.equal(artifact.completedRuns, 2)
  assert.equal(artifact.consistency, true)
  assert.equal(artifact.summary.totalOccurrences, records.length)
  assert.equal(artifact.summary.safeOccurrences, 1)
  assert.equal(artifact.summary.blockedOccurrences, 6)
  assert.equal(
    Object.values(artifact.primaryCohortCounts).reduce(
      (sum, value) => sum + value,
      0
    ),
    records.length
  )
  for (const cohort of [
    'financial_conflict_manual_only',
    'student_or_package_manual_review',
    'structural_missing_link',
    'structural_link_mismatch',
    'teacher_mapping_required',
    'unclassifiable_manual_review',
    'safe_convertible',
  ]) {
    assert.equal(artifact.primaryCohortCounts[cohort], 1)
  }
  assert.deepEqual(
    Object.keys(artifact.primaryCohortCounts),
    REDACTED_PRIMARY_COHORTS
  )
  assert.equal(
    artifact.overlapCounts[
      'missingLinkedDocument&orphanFixedReservation'
    ],
    1
  )
  const financialArtifact = artifact.occurrences.find(
    (row) => row.primaryCohort === 'financial_conflict_manual_only'
  )
  assert.deepEqual(financialArtifact.secondaryCategories, [
    'missingLinkedDocument',
    'packageMismatch',
  ])
  assert.equal(
    financialArtifact.repairability,
    'financial_manual_review_only'
  )
  assert.equal(
    artifact.occurrences.find(
      (row) => row.primaryCohort === 'structural_missing_link'
    ).repairability,
    'obsolete_orphan_candidate'
  )
  assert.equal(
    artifact.occurrences.find(
      (row) => row.primaryCohort === 'safe_convertible'
    ).repairability,
    'deterministic_repair_candidate'
  )
  assert.deepEqual(
    artifact.occurrences.map((row) => row.cohortKey),
    artifact.occurrences.map((row) => row.cohortKey).sort()
  )

  const serialized = JSON.stringify(artifact)
  for (const record of records) {
    for (const rawValue of [
      record.occurrenceKey,
      record.lessonId,
      record.reservationId,
      record.slotId,
      record.studentId,
      record.packageId,
      ...record.teacherIdentity.values,
    ]) {
      assert.equal(serialized.includes(rawValue), false)
    }
  }
  for (const forbidden of [
    ACADEMY_ID,
    TOKEN,
    REDACTION_KEY,
    'Authorization',
    'studentName',
    'teacherName',
    'email',
    'phone',
  ]) {
    assert.equal(serialized.includes(forbidden), false)
  }
})

test('artifact builder fails closed on occurrence and count mismatches', () => {
  const safe = occurrence({
    key: 'artifact-reconcile',
    ledgerMode: 'legacy',
    lessonCountsByDate: true,
    packageUsedCount: 1,
  })
  const summary = finalSummary(aggregateAuditPages(pagesFor({
    occurrences: [safe],
    memberships: [membership('artifact-reconcile')],
  })))
  const evidence = safeLegacyEvidence(safe)
  const artifact = buildRedactedCohortArtifact({
    summary,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: sourceReconciliation(summary),
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  })
  assert.equal(artifact.summary.totalOccurrences, 1)
  assert.equal(artifact.summary.safeOccurrences, 1)
  assert.deepEqual(
    buildRedactedCohortArtifact({
      summary,
      occurrenceEvidence: [structuredClone(evidence)],
      unmatchedEvidence: [],
      sourceReconciliation: sourceReconciliation(summary),
      academyId: ACADEMY_ID,
      redactionKey: REDACTION_KEY,
    }),
    artifact
  )

  assert.throws(() => buildRedactedCohortArtifact({
    summary,
    occurrenceEvidence: [evidence, structuredClone(evidence)],
    unmatchedEvidence: [],
    sourceReconciliation: sourceReconciliation(summary),
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))

  const wrongTotal = structuredClone(summary)
  wrongTotal.totals.occurrences = 2
  assert.throws(() => buildRedactedCohortArtifact({
    summary: wrongTotal,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: sourceReconciliation(summary),
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))

  const wrongBlockingTotal = structuredClone(summary)
  wrongBlockingTotal.blockerTotal = 1
  assert.throws(() => buildRedactedCohortArtifact({
    summary: wrongBlockingTotal,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: sourceReconciliation(summary),
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))

  const wrongCategoryCount = structuredClone(summary)
  wrongCategoryCount.counts.linkMismatch = 1
  wrongCategoryCount.blockerTotal = 1
  assert.throws(() => buildRedactedCohortArtifact({
    summary: wrongCategoryCount,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: sourceReconciliation(summary),
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))

  const wrongSourceTotal = sourceReconciliation(summary)
  wrongSourceTotal.totals.deductionCredits += 1
  assert.throws(() => buildRedactedCohortArtifact({
    summary,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: wrongSourceTotal,
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))

  const wrongScanFamily = sourceReconciliation(summary)
  wrongScanFamily.scanFamilies.fixedLessons.recordCount += 1
  assert.throws(() => buildRedactedCohortArtifact({
    summary,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: wrongScanFamily,
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))

  const wrongScannedCount = sourceReconciliation(summary)
  wrongScannedCount.scanFamilies.fixedLessons.scannedCount += 1
  assert.throws(() => buildRedactedCohortArtifact({
    summary,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: wrongScannedCount,
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))

  const wrongScanDigest = sourceReconciliation(summary)
  wrongScanDigest.scanFamilies.fixedLessons.datasetDigest = '0'.repeat(64)
  assert.throws(() => buildRedactedCohortArtifact({
    summary,
    occurrenceEvidence: [evidence],
    unmatchedEvidence: [],
    sourceReconciliation: wrongScanDigest,
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  }))
})

test('non-convertible blocker-free occurrence is safe_other', () => {
  const canonical = occurrence({ key: 'artifact-safe-other' })
  const summary = finalSummary(aggregateAuditPages(pagesFor({
    occurrences: [canonical],
    memberships: [membership('artifact-safe-other')],
  })))
  const artifact = buildRedactedCohortArtifact({
    summary,
    occurrenceEvidence: [{
      occurrenceKey: canonical.occurrenceKey,
      blockingCategories: [],
      currentLedgerMode: 'canonical',
      originMode: 'born_canonical',
      legacyPartitionState: 'not_legacy_origin',
      evidenceFlags: {
        activeLifecycle: true,
        terminalLifecycle: false,
        hasAllLinkedDocuments: true,
        allFixedFamilies: true,
        packageReferencePresent: true,
        teacherMappingResolved: true,
        singleConsistentDeductionEvidence: false,
        linkageEvidenceComplete: true,
      },
    }],
    unmatchedEvidence: [],
    sourceReconciliation: sourceReconciliation(summary),
    academyId: ACADEMY_ID,
    redactionKey: REDACTION_KEY,
  })
  assert.equal(artifact.primaryCohortCounts.safe_other, 1)
  assert.equal(
    artifact.occurrences[0].repairability,
    'safe_no_repair_required'
  )
})

test('artifact writer leaves no partial file on failure', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-audit-partial-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'missing-parent', 'artifact.json')
  await assert.rejects(
    writeRedactedCohortArtifact(outputPath, { artifactVersion: 1 }),
    /Redacted cohort artifact write failed/
  )
  assert.equal(fs.existsSync(outputPath), false)
  assert.deepEqual(fs.readdirSync(directory), [])
})

test('artifact write failure overrides a successful audit with exit 1', async () => {
  let fetchCount = 0
  const pages = pagesFor({})
  const fetchImpl = mockFetch((request) => {
    fetchCount += 1
    return structuredClone(pages[request.scanFamily][0])
  })
  const errors = []
  const exitCode = await executeAuditCli({
    env: environment({
      AUDIT_REDACTED_OUTPUT: '/tmp/redacted-artifact.json',
      AUDIT_REDACTION_KEY: REDACTION_KEY,
    }),
    fetchImpl,
    artifactWriter: async () => {
      throw new Error(`artifact failed ${REDACTION_KEY}`)
    },
    writeOutput() {},
    writeError(value) {
      errors.push(value)
    },
  })
  assert.equal(fetchCount, AUDIT_SCAN_FAMILIES.length * 2)
  assert.equal(exitCode, 1)
  assert.equal(errors.join('\n').includes(REDACTION_KEY), false)
})

test('artifact contents and output path are never written to stdout', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-audit-stdout-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'artifact.json')
  const output = []
  const exitCode = await executeAuditCli({
    env: environment({
      AUDIT_REDACTED_OUTPUT: outputPath,
      AUDIT_REDACTION_KEY: REDACTION_KEY,
    }),
    fetchImpl: mockStablePages(pagesFor({})),
    writeOutput(value) {
      output.push(value)
    },
    writeError(value) {
      output.push(value)
    },
  })
  const serializedOutput = output.join('\n')
  assert.equal(exitCode, 0)
  assert.equal(fs.existsSync(outputPath), true)
  assert.equal(serializedOutput.includes(outputPath), false)
  assert.equal(serializedOutput.includes('artifactVersion'), false)
  assert.equal(serializedOutput.includes('cohortKey'), false)
  assert.equal(serializedOutput.includes(REDACTION_KEY), false)
})

test('artifact is not written when double-run occurrence evidence differs', async (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'fixed-audit-drift-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const outputPath = path.join(directory, 'artifact.json')
  const first = occurrence({ key: 'artifact-drift' })
  const second = occurrence({
    key: 'artifact-drift',
    diagnostics: { linkMismatch: true },
  })
  const firstPages = pagesFor({
    occurrences: [first],
    memberships: [membership('artifact-drift')],
  })
  const secondPages = pagesFor({
    occurrences: [second],
    memberships: [membership('artifact-drift')],
  })
  let callCount = 0
  const fetchImpl = mockFetch((request) => {
    const runPages = callCount++ < AUDIT_SCAN_FAMILIES.length
      ? firstPages
      : secondPages
    return structuredClone(runPages[request.scanFamily][0])
  })
  const summary = await runProductionAudit({
    env: environment({
      AUDIT_REDACTED_OUTPUT: outputPath,
      AUDIT_REDACTION_KEY: REDACTION_KEY,
    }),
    fetchImpl,
  })
  assert.equal(summary.consistency, false)
  assert.equal(exitCodeForAuditSummary(summary), 3)
  assert.equal(fs.existsSync(outputPath), false)
})
