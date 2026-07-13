import crypto from 'node:crypto'
import { pathToFileURL } from 'node:url'

export const AUDIT_VERSION = 2
export const PRODUCTION_PROJECT_ID = 'daegu-miami-production'
export const AUDIT_REGION = 'us-central1'
export const AUDIT_CALLABLE = 'inspectFixedPrivateLessonOutcomeLedger'
export const AUDIT_ENDPOINT =
  `https://${AUDIT_REGION}-${PRODUCTION_PROJECT_ID}.cloudfunctions.net/${AUDIT_CALLABLE}`
export const AUDIT_SCAN_FAMILIES = [
  'fixedLessons',
  'fixedReservations',
  'fixedSlots',
  'deductionCredits',
  'teacherMemberships',
]
export const AUDIT_INVENTORY_CATEGORIES = [
  'canonicalTotal',
  'canonicalReady',
  'canonicalTerminal',
  'legacyTotal',
  'currentCanonicalLedgerTotal',
  'currentLegacyLedgerTotal',
  'currentUnknownOrMixedLedgerTotal',
  'currentLedgerOccurrenceTotal',
  'bornCanonicalTotal',
  'legacyOriginTotal',
  'unknownOriginTotal',
  'occurrenceOriginTotal',
  'legacySafelyConvertible',
  'legacyAlreadyConverted',
  'legacyTerminal',
  'alreadyReservationDeductedConsistent',
]
export const AUDIT_BLOCKER_CATEGORIES = [
  'linkMismatch',
  'missingLinkedDocument',
  'academyMismatch',
  'studentMismatch',
  'packageMismatch',
  'packageMissing',
  'teacherOwnershipMissing',
  'teacherOwnershipAmbiguous',
  'teacherIdentityConflict',
  'duplicateDeductionCredit',
  'conflictingDeductionEvidence',
  'unclassifiableOccurrence',
  'orphanFixedReservation',
  'orphanFixedSlot',
  'legacyUnsafeToConvert',
  'fixedProvenanceMismatch',
  'outcomeStatusMismatch',
]
export const AUDIT_CATEGORY_NAMES = [
  ...AUDIT_INVENTORY_CATEGORIES,
  ...AUDIT_BLOCKER_CATEGORIES,
]
export const AUDIT_CATEGORY_REASONS = {
  canonicalTotal: 'canonical_ledger',
  canonicalReady: 'canonical_ready',
  canonicalTerminal: 'canonical_terminal',
  legacyTotal: 'legacy_ledger',
  currentCanonicalLedgerTotal: 'current_canonical_ledger',
  currentLegacyLedgerTotal: 'current_legacy_ledger',
  currentUnknownOrMixedLedgerTotal: 'current_unknown_or_mixed_ledger',
  currentLedgerOccurrenceTotal: 'current_ledger_occurrence_total',
  bornCanonicalTotal: 'born_canonical_origin',
  legacyOriginTotal: 'legacy_origin',
  unknownOriginTotal: 'unknown_origin',
  occurrenceOriginTotal: 'occurrence_origin_total',
  legacySafelyConvertible: 'legacy_safely_convertible',
  legacyAlreadyConverted: 'lesson_to_reservation',
  legacyTerminal: 'legacy_terminal_consistent',
  alreadyReservationDeductedConsistent: 'reservation_deduction_consistent',
  linkMismatch: 'linked_document_id_mismatch',
  missingLinkedDocument: 'required_linked_document_missing',
  academyMismatch: 'academy_id_mismatch',
  studentMismatch: 'student_id_mismatch',
  packageMismatch: 'package_mismatch',
  packageMissing: 'package_document_missing',
  teacherOwnershipMissing: 'teacher_ownership_missing',
  teacherOwnershipAmbiguous: 'teacher_ownership_ambiguous',
  teacherIdentityConflict: 'teacher_identity_conflict',
  duplicateDeductionCredit: 'multiple_deduction_credits',
  conflictingDeductionEvidence: 'deduction_evidence_conflict',
  unclassifiableOccurrence: 'unclassifiable_fixed_occurrence',
  orphanFixedReservation: 'fixed_reservation_missing_link',
  orphanFixedSlot: 'fixed_slot_missing_link',
  legacyUnsafeToConvert: 'legacy_occurrence_not_safely_convertible',
  fixedProvenanceMismatch: 'fixed_provenance_mismatch',
  outcomeStatusMismatch: 'lesson_reservation_outcome_status_mismatch',
}

const SAMPLE_LIMIT = 10
const PAGE_LIMIT = 50
const MAX_PAGES_PER_FAMILY = 10000
const MAX_RECORDS_PER_RUN = 500000
const HEX_64 = /^[a-f0-9]{64}$/
const OPAQUE_CURSOR = /^[A-Za-z0-9_-]+$/
const OCCURRENCE_FAMILIES = new Set([
  'fixedLessons',
  'fixedReservations',
  'fixedSlots',
])
const PAGE_FIELDS = [
  'complete',
  'cursor',
  'hasMore',
  'limit',
  'matchedCount',
  'nextCursor',
  'omittedCount',
  'pageSize',
  'returnedCount',
  'scannedCount',
  'truncated',
]
const RESULT_FIELDS = [
  'academyId',
  'aggregationRequired',
  'auditVersion',
  'blocking',
  'bounds',
  'commit',
  'complete',
  'dryRun',
  'inventory',
  'ok',
  'omittedCount',
  'page',
  'previewOnly',
  'reasons',
  'records',
  'samples',
  'scanFamily',
  'truncated',
]
const OCCURRENCE_FIELDS = [
  'academyId',
  'auditFingerprint',
  'declaredCredits',
  'deduction',
  'diagnosticReasons',
  'diagnostics',
  'exists',
  'expectedCreditId',
  'fixedFamilies',
  'kind',
  'ledgerContribution',
  'lessonId',
  'occurrenceKey',
  'packageCounts',
  'packageId',
  'provenance',
  'reservationId',
  'rootFamily',
  'rootId',
  'slotId',
  'statuses',
  'studentId',
  'teacherIdentity',
]
const CREDIT_FIELDS = [
  'academyId',
  'actionType',
  'auditFingerprint',
  'deltaCount',
  'id',
  'kind',
  'ledgerTransition',
  'lessonId',
  'marker',
  'packageId',
  'slotId',
  'sourceId',
  'sourceType',
  'studentId',
]
const MEMBERSHIP_FIELDS = [
  'auditFingerprint',
  'declaredTeacherUid',
  'identity',
  'kind',
  'membershipKey',
]
const LEDGER_ROW_FIELDS = [
  'academyId',
  'auditFingerprint',
  'documentId',
  'kind',
  'lessonCountsByDate',
  'packageId',
  'reservationCountsByEvidence',
  'rootFamily',
]

class AuditProtocolError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuditProtocolError'
  }
}

function failProtocol(message) {
  throw new AuditProtocolError(message)
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(',')}]`
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stableStringify(value[key])}`
    ).join(',')}}`
  }
  return JSON.stringify(value)
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function normalizeString(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function uniqueStrings(values) {
  return [...new Set((values || []).map(normalizeString).filter(Boolean))].sort()
}

function assertPlainObject(value, label) {
  if (!isPlainObject(value)) failProtocol(`${label} must be a plain object.`)
  return value
}

function assertExactKeys(value, expectedKeys, label) {
  assertPlainObject(value, label)
  const actual = Object.keys(value).sort()
  const expected = [...expectedKeys].sort()
  if (stableStringify(actual) !== stableStringify(expected)) {
    failProtocol(`${label} has an unsupported schema.`)
  }
}

function assertBoolean(value, label) {
  if (typeof value !== 'boolean') failProtocol(`${label} must be boolean.`)
  return value
}

function assertString(value, label, { allowEmpty = true } = {}) {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0)) {
    failProtocol(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}.`)
  }
  return value
}

function assertSafeInteger(value, label, { nonNegative = true } = {}) {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    (nonNegative && value < 0)
  ) {
    failProtocol(`${label} must be a ${nonNegative ? 'non-negative ' : ''}safe integer.`)
  }
  return value
}

function assertNullableSafeInteger(value, label) {
  if (value === null) return value
  return assertSafeInteger(value, label)
}

function assertStringArray(value, label, { hashes = false } = {}) {
  if (!Array.isArray(value)) failProtocol(`${label} must be an array.`)
  const seen = new Set()
  value.forEach((entry, index) => {
    assertString(entry, `${label}[${index}]`, { allowEmpty: false })
    if (hashes && !HEX_64.test(entry)) failProtocol(`${label}[${index}] must be a digest.`)
    if (seen.has(entry)) failProtocol(`${label} must not contain duplicates.`)
    seen.add(entry)
  })
  return value
}

function assertRecordFingerprint(record, label) {
  if (!HEX_64.test(record.auditFingerprint)) {
    failProtocol(`${label}.auditFingerprint is invalid.`)
  }
  const { auditFingerprint, ...fingerprintedRecord } = record
  if (sha256(stableStringify(fingerprintedRecord)) !== auditFingerprint) {
    failProtocol(`${label}.auditFingerprint does not match its content.`)
  }
}

function emptyCategoryMap(valueFactory) {
  return Object.fromEntries(
    AUDIT_CATEGORY_NAMES.map((category) => [category, valueFactory(category)])
  )
}

function validateCategoryMap(value, expectedCategories, label) {
  assertExactKeys(value, expectedCategories, label)
  for (const category of expectedCategories) {
    assertSafeInteger(value[category], `${label}.${category}`)
  }
}

function validateReasonMap(value) {
  assertExactKeys(value, AUDIT_CATEGORY_NAMES, 'reasons')
  for (const category of AUDIT_CATEGORY_NAMES) {
    if (value[category] !== AUDIT_CATEGORY_REASONS[category]) {
      failProtocol(`reasons.${category} is unsupported.`)
    }
  }
}

function validateSamples(value) {
  assertExactKeys(value, AUDIT_CATEGORY_NAMES, 'samples')
  for (const category of AUDIT_CATEGORY_NAMES) {
    const rows = value[category]
    if (!Array.isArray(rows) || rows.length > SAMPLE_LIMIT) {
      failProtocol(`samples.${category} exceeds its bound.`)
    }
    for (const [index, row] of rows.entries()) {
      assertExactKeys(
        row,
        ['lessonId', 'occurrenceKey', 'reason', 'reservationId', 'slotId'],
        `samples.${category}[${index}]`
      )
      for (const field of ['lessonId', 'occurrenceKey', 'reservationId', 'slotId']) {
        assertString(row[field], `samples.${category}[${index}].${field}`)
      }
      if (row.reason !== AUDIT_CATEGORY_REASONS[category]) {
        failProtocol(`samples.${category}[${index}].reason is unsupported.`)
      }
    }
  }
}

function validateCreditRecord(
  record,
  academyId,
  label = 'credit record',
  { allowAcademyMismatch = false } = {}
) {
  assertExactKeys(record, CREDIT_FIELDS, label)
  if (record.kind !== 'credit') failProtocol(`${label}.kind is unsupported.`)
  for (const field of [
    'id',
    'sourceId',
    'lessonId',
    'slotId',
    'packageId',
    'studentId',
    'sourceType',
    'actionType',
    'ledgerTransition',
    'marker',
    'academyId',
  ]) {
    assertString(record[field], `${label}.${field}`, {
      allowEmpty: field !== 'id' && field !== 'academyId',
    })
  }
  if (!allowAcademyMismatch && record.academyId !== academyId) {
    failProtocol(`${label}.academyId mismatch.`)
  }
  assertSafeInteger(record.deltaCount, `${label}.deltaCount`, { nonNegative: false })
  assertRecordFingerprint(record, label)
}

function validateOccurrenceRecord(record, academyId, scanFamily, label) {
  assertExactKeys(record, OCCURRENCE_FIELDS, label)
  if (record.kind !== 'occurrence') failProtocol(`${label}.kind is unsupported.`)
  if (!OCCURRENCE_FAMILIES.has(record.rootFamily) ||
      record.rootFamily !== scanFamily) {
    failProtocol(`${label}.rootFamily mismatch.`)
  }
  for (const field of [
    'rootId',
    'occurrenceKey',
    'academyId',
    'lessonId',
    'reservationId',
    'slotId',
    'packageId',
    'studentId',
    'expectedCreditId',
  ]) {
    assertString(record[field], `${label}.${field}`, {
      allowEmpty: !['rootId', 'occurrenceKey', 'academyId'].includes(field),
    })
  }
  if (record.academyId !== academyId) failProtocol(`${label}.academyId mismatch.`)

  assertExactKeys(record.fixedFamilies, ['lesson', 'reservation', 'slot'], `${label}.fixedFamilies`)
  assertExactKeys(record.exists, ['lesson', 'package', 'reservation', 'slot'], `${label}.exists`)
  for (const value of Object.values(record.fixedFamilies)) assertBoolean(value, `${label}.fixedFamilies`)
  for (const value of Object.values(record.exists)) assertBoolean(value, `${label}.exists`)

  assertExactKeys(
    record.provenance,
    [
      'hasCanonicalMarker',
      'hasLegacyEvidence',
      'ledgerMode',
      'legacyEvidenceConsistent',
      'originMode',
    ],
    `${label}.provenance`
  )
  if (!['canonical', 'legacy', 'inconsistent'].includes(record.provenance.ledgerMode)) {
    failProtocol(`${label}.provenance.ledgerMode is unsupported.`)
  }
  if (![
    'born_canonical',
    'converted_legacy',
    'legacy_unconverted',
    'unknown',
  ].includes(record.provenance.originMode)) {
    failProtocol(`${label}.provenance.originMode is unsupported.`)
  }
  assertBoolean(record.provenance.hasCanonicalMarker, `${label}.provenance.hasCanonicalMarker`)
  assertBoolean(record.provenance.hasLegacyEvidence, `${label}.provenance.hasLegacyEvidence`)
  assertBoolean(
    record.provenance.legacyEvidenceConsistent,
    `${label}.provenance.legacyEvidenceConsistent`
  )
  if (
    record.provenance.originMode === 'born_canonical' &&
    (record.provenance.hasLegacyEvidence ||
      record.provenance.legacyEvidenceConsistent)
  ) {
    failProtocol(`${label}.provenance born-canonical evidence is inconsistent.`)
  }
  if (
    ['converted_legacy', 'legacy_unconverted'].includes(
      record.provenance.originMode
    ) &&
    (!record.provenance.hasLegacyEvidence ||
      !record.provenance.legacyEvidenceConsistent)
  ) {
    failProtocol(`${label}.provenance legacy evidence is incomplete.`)
  }

  assertExactKeys(record.statuses, ['lesson', 'reservation', 'slot'], `${label}.statuses`)
  for (const [field, value] of Object.entries(record.statuses)) {
    assertString(value, `${label}.statuses.${field}`)
  }

  assertExactKeys(
    record.deduction,
    ['ids', 'lessonApplied', 'reservationApplied', 'slotApplied'],
    `${label}.deduction`
  )
  assertBoolean(record.deduction.lessonApplied, `${label}.deduction.lessonApplied`)
  assertBoolean(record.deduction.reservationApplied, `${label}.deduction.reservationApplied`)
  assertBoolean(record.deduction.slotApplied, `${label}.deduction.slotApplied`)
  assertStringArray(record.deduction.ids, `${label}.deduction.ids`)

  const diagnosticFields = [
    'academyMismatch',
    'fixedProvenanceMismatch',
    'linkMismatch',
    'linkReasons',
    'missingLinkedDocument',
    'orphanFixedReservation',
    'orphanFixedSlot',
    'outcomeStatusMismatch',
    'packageMismatch',
    'packageMissing',
    'studentMismatch',
    'unclassifiableOccurrence',
  ]
  assertExactKeys(record.diagnostics, diagnosticFields, `${label}.diagnostics`)
  assertStringArray(record.diagnostics.linkReasons, `${label}.diagnostics.linkReasons`)
  for (const [field, value] of Object.entries(record.diagnostics)) {
    if (field !== 'linkReasons') assertBoolean(value, `${label}.diagnostics.${field}`)
  }

  assertExactKeys(
    record.diagnosticReasons,
    ['outcomeStatus', 'provenance', 'rowFlags'],
    `${label}.diagnosticReasons`
  )
  for (const [field, value] of Object.entries(record.diagnosticReasons)) {
    assertStringArray(value, `${label}.diagnosticReasons.${field}`)
  }

  assertExactKeys(
    record.ledgerContribution,
    ['lessonCountsByDate', 'lessonEnded', 'reservationCountsByEvidence'],
    `${label}.ledgerContribution`
  )
  assertBoolean(
    record.ledgerContribution.lessonCountsByDate,
    `${label}.ledgerContribution.lessonCountsByDate`
  )
  assertBoolean(
    record.ledgerContribution.lessonEnded,
    `${label}.ledgerContribution.lessonEnded`
  )
  assertBoolean(
    record.ledgerContribution.reservationCountsByEvidence,
    `${label}.ledgerContribution.reservationCountsByEvidence`
  )

  assertExactKeys(
    record.packageCounts,
    ['remainingCount', 'totalCount', 'usedCount'],
    `${label}.packageCounts`
  )
  for (const [field, value] of Object.entries(record.packageCounts)) {
    assertNullableSafeInteger(value, `${label}.packageCounts.${field}`)
  }

  assertExactKeys(record.teacherIdentity, ['conflict', 'tier', 'values'], `${label}.teacherIdentity`)
  assertBoolean(record.teacherIdentity.conflict, `${label}.teacherIdentity.conflict`)
  if (!['', 'uid', 'teacherId', 'teacherKey', 'name'].includes(record.teacherIdentity.tier)) {
    failProtocol(`${label}.teacherIdentity.tier is unsupported.`)
  }
  assertStringArray(record.teacherIdentity.values, `${label}.teacherIdentity.values`, {
    hashes: true,
  })

  if (!Array.isArray(record.declaredCredits)) {
    failProtocol(`${label}.declaredCredits must be an array.`)
  }
  record.declaredCredits.forEach((credit, index) =>
    validateCreditRecord(
      credit,
      academyId,
      `${label}.declaredCredits[${index}]`,
      { allowAcademyMismatch: true }
    )
  )
  assertRecordFingerprint(record, label)
}

function validateMembershipRecord(record, label) {
  assertExactKeys(record, MEMBERSHIP_FIELDS, label)
  if (record.kind !== 'teacherMembership') failProtocol(`${label}.kind is unsupported.`)
  assertString(record.membershipKey, `${label}.membershipKey`, { allowEmpty: false })
  assertString(record.declaredTeacherUid, `${label}.declaredTeacherUid`)
  if (record.declaredTeacherUid && !HEX_64.test(record.declaredTeacherUid)) {
    failProtocol(`${label}.declaredTeacherUid is invalid.`)
  }
  assertExactKeys(record.identity, ['name', 'teacherId', 'teacherKey', 'uid'], `${label}.identity`)
  for (const [field, values] of Object.entries(record.identity)) {
    assertStringArray(values, `${label}.identity.${field}`, { hashes: true })
  }
  assertRecordFingerprint(record, label)
}

function validateLedgerRow(record, academyId, scanFamily, label) {
  assertExactKeys(record, LEDGER_ROW_FIELDS, label)
  if (record.kind !== 'ledgerRow' ||
      !['fixedLessons', 'fixedReservations'].includes(record.rootFamily) ||
      record.rootFamily !== scanFamily) {
    failProtocol(`${label}.rootFamily is unsupported.`)
  }
  assertString(record.documentId, `${label}.documentId`, { allowEmpty: false })
  assertString(record.academyId, `${label}.academyId`, { allowEmpty: false })
  assertString(record.packageId, `${label}.packageId`, { allowEmpty: false })
  if (record.academyId !== academyId) failProtocol(`${label}.academyId mismatch.`)
  assertBoolean(record.lessonCountsByDate, `${label}.lessonCountsByDate`)
  assertBoolean(
    record.reservationCountsByEvidence,
    `${label}.reservationCountsByEvidence`
  )
  assertRecordFingerprint(record, label)
}

function expectedPageSummary(records) {
  const inventory = categoryMapFor(AUDIT_INVENTORY_CATEGORIES)
  const blocking = categoryMapFor(AUDIT_BLOCKER_CATEGORIES)
  const samples = emptyCategoryMap(() => [])
  const add = (category, record) => {
    const target = AUDIT_INVENTORY_CATEGORIES.includes(category) ? inventory : blocking
    target[category] += 1
    if (samples[category].length < SAMPLE_LIMIT) {
      samples[category].push(occurrenceSample(record, category))
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

function categoryMapFor(categories) {
  return Object.fromEntries(categories.map((category) => [category, 0]))
}

export function validateAuditV2Record(record, {
  academyId,
  scanFamily,
  label = 'record',
}) {
  assertPlainObject(record, label)
  if (record.kind === 'occurrence') {
    validateOccurrenceRecord(record, academyId, scanFamily, label)
    return
  }
  if (record.kind === 'credit') {
    if (scanFamily !== 'deductionCredits') {
      failProtocol(`${label} is in the wrong scan family.`)
    }
    validateCreditRecord(record, academyId, label)
    return
  }
  if (record.kind === 'teacherMembership') {
    if (scanFamily !== 'teacherMemberships') {
      failProtocol(`${label} is in the wrong scan family.`)
    }
    validateMembershipRecord(record, label)
    return
  }
  if (record.kind === 'ledgerRow') {
    validateLedgerRow(record, academyId, scanFamily, label)
    return
  }
  failProtocol(`${label}.kind is unsupported.`)
}

export function validateAuditV2Page(result, {
  academyId,
  scanFamily,
  cursor,
}) {
  assertExactKeys(result, RESULT_FIELDS, 'result')
  if (
    result.ok !== true ||
    result.auditVersion !== AUDIT_VERSION ||
    result.academyId !== academyId ||
    result.scanFamily !== scanFamily ||
    result.dryRun !== true ||
    result.previewOnly !== true ||
    result.commit !== false
  ) {
    failProtocol('Audit callable returned an invalid protocol response.')
  }
  assertBoolean(result.complete, 'result.complete')
  assertBoolean(result.truncated, 'result.truncated')
  assertSafeInteger(result.omittedCount, 'result.omittedCount')
  if (!Array.isArray(result.records)) failProtocol('result.records must be an array.')
  result.records.forEach((record, index) =>
    validateAuditV2Record(record, {
      academyId,
      scanFamily,
      label: `result.records[${index}]`,
    })
  )

  validateCategoryMap(result.inventory, AUDIT_INVENTORY_CATEGORIES, 'inventory')
  validateCategoryMap(result.blocking, AUDIT_BLOCKER_CATEGORIES, 'blocking')
  validateSamples(result.samples)
  validateReasonMap(result.reasons)
  const expectedSummary = expectedPageSummary(result.records)
  if (
    stableStringify(result.inventory) !== stableStringify(expectedSummary.inventory) ||
    stableStringify(result.blocking) !== stableStringify(expectedSummary.blocking) ||
    stableStringify(result.samples) !== stableStringify(expectedSummary.samples)
  ) {
    failProtocol('Audit page category summary does not match its records.')
  }

  assertExactKeys(result.page, PAGE_FIELDS, 'page')
  const page = result.page
  for (const field of [
    'pageSize',
    'returnedCount',
    'scannedCount',
    'matchedCount',
    'limit',
    'omittedCount',
  ]) {
    assertSafeInteger(page[field], `page.${field}`)
  }
  if (page.pageSize < 1 || page.pageSize > PAGE_LIMIT || page.limit !== page.pageSize) {
    failProtocol('page.pageSize is outside the protocol bound.')
  }
  assertString(page.cursor, 'page.cursor')
  assertString(page.nextCursor, 'page.nextCursor')
  assertBoolean(page.hasMore, 'page.hasMore')
  assertBoolean(page.complete, 'page.complete')
  assertBoolean(page.truncated, 'page.truncated')
  if (
    page.cursor !== cursor ||
    page.returnedCount !== result.records.length ||
    page.matchedCount !== result.records.length ||
    page.scannedCount < page.returnedCount ||
    page.scannedCount > page.pageSize ||
    page.returnedCount > page.pageSize ||
    page.complete !== !page.hasMore ||
    result.complete !== page.complete ||
    result.truncated !== page.truncated ||
    result.omittedCount !== page.omittedCount ||
    (page.hasMore && (
      !page.nextCursor ||
      page.nextCursor.length > 2048 ||
      !OPAQUE_CURSOR.test(page.nextCursor)
    )) ||
    (!page.hasMore && page.nextCursor !== '')
  ) {
    failProtocol('Audit page metadata is inconsistent.')
  }
  if (!Array.isArray(result.aggregationRequired) ||
      new Set(result.aggregationRequired).size !== result.aggregationRequired.length) {
    failProtocol('aggregationRequired is invalid.')
  }
  for (const category of result.aggregationRequired) {
    if (!AUDIT_CATEGORY_NAMES.includes(category)) {
      failProtocol('aggregationRequired contains an unknown category.')
    }
  }
  assertExactKeys(result.bounds, ['pageSize', 'sampleIdsPerCategory'], 'bounds')
  if (result.bounds.pageSize !== PAGE_LIMIT ||
      result.bounds.sampleIdsPerCategory !== SAMPLE_LIMIT) {
    failProtocol('Audit bounds mismatch.')
  }
  return result
}

function mergeBooleanMap(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return Object.fromEntries([...keys].map((key) => [key, left[key] === true || right[key] === true]))
}

function occurrenceScore(record) {
  const exists = record?.exists || {}
  const rootScore = record?.rootFamily === 'fixedLessons'
    ? 30
    : record?.rootFamily === 'fixedReservations'
      ? 20
      : 10
  return rootScore + Object.values(exists).filter(Boolean).length
}

function mergeStringArrayMaps(left = {}, right = {}) {
  const keys = new Set([...Object.keys(left), ...Object.keys(right)])
  return Object.fromEntries([...keys].map((key) => [
    key,
    uniqueStrings([...(left[key] || []), ...(right[key] || [])]),
  ]))
}

function mergeOccurrenceRecords(left, right) {
  const primary = occurrenceScore(right) > occurrenceScore(left) ? right : left
  const secondary = primary === left ? right : left
  return {
    ...secondary,
    ...primary,
    fixedFamilies: mergeBooleanMap(left.fixedFamilies, right.fixedFamilies),
    exists: mergeBooleanMap(left.exists, right.exists),
    diagnostics: {
      ...mergeBooleanMap(left.diagnostics, right.diagnostics),
      linkReasons: uniqueStrings([
        ...(left.diagnostics?.linkReasons || []),
        ...(right.diagnostics?.linkReasons || []),
      ]),
    },
    diagnosticReasons: mergeStringArrayMaps(
      left.diagnosticReasons,
      right.diagnosticReasons
    ),
    ledgerContribution: mergeBooleanMap(
      left.ledgerContribution,
      right.ledgerContribution
    ),
    deduction: {
      ...secondary.deduction,
      ...primary.deduction,
      ids: uniqueStrings([...(left.deduction?.ids || []), ...(right.deduction?.ids || [])]),
    },
    declaredCredits: [
      ...(left.declaredCredits || []),
      ...(right.declaredCredits || []),
    ],
  }
}

function occurrenceIdentityIds(record) {
  return uniqueStrings([record?.lessonId, record?.reservationId, record?.slotId])
}

function collapseOccurrenceRecords(records) {
  const groups = []
  const sorted = [...records].sort((left, right) => {
    const family = left.rootFamily.localeCompare(right.rootFamily)
    return family || left.rootId.localeCompare(right.rootId)
  })
  for (const record of sorted) {
    const recordIds = occurrenceIdentityIds(record)
    const matchingIndexes = groups
      .map((group, index) => (
        recordIds.some((id) => group.ids.has(id)) ? index : -1
      ))
      .filter((index) => index >= 0)
    if (matchingIndexes.length === 0) {
      groups.push({ record, ids: new Set(recordIds) })
      continue
    }
    const target = groups[matchingIndexes[0]]
    target.record = mergeOccurrenceRecords(target.record, record)
    recordIds.forEach((id) => target.ids.add(id))
    for (const index of matchingIndexes.slice(1).reverse()) {
      const group = groups[index]
      target.record = mergeOccurrenceRecords(target.record, group.record)
      group.ids.forEach((id) => target.ids.add(id))
      groups.splice(index, 1)
    }
  }
  return groups
    .map((group) => group.record)
    .sort((left, right) => left.occurrenceKey.localeCompare(right.occurrenceKey))
}

function mergeCreditRecords(records) {
  const result = new Map()
  for (const record of records) {
    const existing = result.get(record.id)
    if (existing && stableStringify(existing) !== stableStringify(record)) {
      failProtocol(`credit record ${record.id} changed within one audit run.`)
    }
    result.set(record.id, record)
  }
  return [...result.values()].sort((left, right) => left.id.localeCompare(right.id))
}

function creditHasFixedProvenance(credit) {
  return normalizeString(credit?.sourceType).toLowerCase() ===
      'fixedprivatereservation' ||
    normalizeString(credit?.actionType).toLowerCase().startsWith('fixed_private_') ||
    credit?.marker === 'reservation_v1'
}

function isDeductionCredit(record) {
  const actionType = normalizeString(record?.actionType).toLowerCase()
  return creditHasFixedProvenance(record) ||
    Number(record?.deltaCount) < 0 ||
    (
      actionType.includes('deduct') &&
      !actionType.includes('reversal') &&
      !actionType.includes('reverse')
    )
}

function creditBelongsToOccurrence(credit, occurrence) {
  const deductionIds = occurrence?.deduction?.ids || []
  return deductionIds.includes(credit.id) ||
    (occurrence.reservationId && credit.sourceId === occurrence.reservationId) ||
    (occurrence.lessonId && credit.lessonId === occurrence.lessonId) ||
    (occurrence.slotId && credit.slotId === occurrence.slotId)
}

function creditMatchesOccurrence(credit, occurrence) {
  const sourceType = normalizeString(credit.sourceType).toLowerCase()
  const actionType = normalizeString(credit.actionType).toLowerCase()
  const convertedLegacyOrigin =
    occurrence.provenance?.originMode === 'converted_legacy' &&
    occurrence.provenance?.hasLegacyEvidence === true &&
    occurrence.provenance?.legacyEvidenceConsistent === true
  const canonicalCredit = sourceType === 'fixedprivatereservation' &&
    ['fixed_private_completed_deduct', 'fixed_private_no_show_deduct'].includes(actionType) &&
    credit.marker === 'reservation_v1' &&
    (
      (
        occurrence.provenance?.originMode === 'born_canonical' &&
        credit.ledgerTransition === 'reservation_increment'
      ) ||
      (
        convertedLegacyOrigin &&
        credit.ledgerTransition === 'lesson_to_reservation'
      )
    ) &&
    credit.id === occurrence.expectedCreditId &&
    credit.lessonId === occurrence.lessonId &&
    credit.slotId === occurrence.slotId
  const legacySource = sourceType === 'privatereservation' &&
    (
      !actionType ||
      ['private_reservation_completed_deduct', 'private_reservation_no_show_deduct']
        .includes(actionType)
    )
  const convertedLegacyEvidence = legacySource &&
    credit.ledgerTransition === 'lesson_to_reservation' &&
    convertedLegacyOrigin &&
    occurrence.provenance?.ledgerMode === 'canonical' &&
    occurrence.fixedFamilies?.lesson === true &&
    occurrence.fixedFamilies?.reservation === true &&
    occurrence.fixedFamilies?.slot === true &&
    occurrence.deduction?.lessonApplied === true &&
    occurrence.deduction?.reservationApplied === true &&
    occurrence.deduction?.ids?.length === 1 &&
    occurrence.deduction.ids[0] === credit.id &&
    occurrence.diagnosticReasons?.provenance?.length === 0 &&
    credit.lessonId === occurrence.lessonId &&
    credit.slotId === occurrence.slotId
  return (canonicalCredit || convertedLegacyEvidence) &&
    credit.deltaCount === -1 &&
    credit.academyId === occurrence.academyId &&
    credit.sourceId === occurrence.reservationId &&
    credit.packageId === occurrence.packageId &&
    credit.studentId === occurrence.studentId
}

function resolveTeacherDiagnostic(occurrence, memberships) {
  const identity = occurrence?.teacherIdentity || {}
  if (identity.conflict === true) return 'teacherIdentityConflict'
  const tier = normalizeString(identity.tier)
  const values = uniqueStrings(identity.values)
  if (!tier || values.length === 0) return 'teacherOwnershipMissing'
  const matches = memberships.filter((membership) => {
    const membershipValues = membership?.identity?.[tier] || []
    return values.some((value) => membershipValues.includes(value))
  })
  if (matches.length === 0) return 'teacherOwnershipMissing'
  if (matches.length > 1) return 'teacherOwnershipAmbiguous'
  if (
    tier === 'uid' &&
    matches[0].declaredTeacherUid &&
    !values.includes(matches[0].declaredTeacherUid)
  ) {
    return 'teacherIdentityConflict'
  }
  return ''
}

function isActiveOccurrence(occurrence) {
  const statuses = occurrence?.statuses || {}
  return ['active', 'scheduled', 'assigned', 'booked', 'confirmed', ''].includes(statuses.lesson) &&
    ['active', 'reserved', 'scheduled', 'booked', 'confirmed', ''].includes(statuses.reservation) &&
    statuses.slot === 'reserved'
}

function isTerminalOccurrence(occurrence) {
  return ['completed', 'no_show'].includes(occurrence?.statuses?.reservation)
}

function occurrenceSample(occurrence, category) {
  return {
    occurrenceKey: normalizeString(occurrence.occurrenceKey),
    lessonId: normalizeString(occurrence.lessonId),
    reservationId: normalizeString(occurrence.reservationId),
    slotId: normalizeString(occurrence.slotId),
    reason: AUDIT_CATEGORY_REASONS[category],
  }
}

function packageAggregateConflicts(occurrences, ledgerRows) {
  const byPackage = new Map()
  for (const occurrence of occurrences) {
    if (!occurrence.packageId) continue
    const rows = byPackage.get(occurrence.packageId) || []
    rows.push(occurrence)
    byPackage.set(occurrence.packageId, rows)
  }
  const conflicts = new Set()
  for (const rows of byPackage.values()) {
    const snapshots = new Set(rows.map((row) => stableStringify(row.packageCounts)))
    const counts = rows[0].packageCounts
    const fixedExpectedUsedCount = rows.reduce((sum, row) =>
      sum +
      (row.ledgerContribution?.lessonCountsByDate === true ? 1 : 0) +
      (row.ledgerContribution?.reservationCountsByEvidence === true ? 1 : 0)
    , 0)
    const supplementalExpectedUsedCount = ledgerRows
      .filter((row) => row.packageId === rows[0].packageId)
      .reduce((sum, row) =>
        sum +
        (row.lessonCountsByDate === true ? 1 : 0) +
        (row.reservationCountsByEvidence === true ? 1 : 0)
      , 0)
    const expectedUsedCount =
      fixedExpectedUsedCount + supplementalExpectedUsedCount
    const validCounts = snapshots.size === 1 &&
      counts.totalCount !== null &&
      counts.usedCount !== null &&
      counts.remainingCount !== null &&
      counts.usedCount === expectedUsedCount &&
      counts.remainingCount === Math.max(0, counts.totalCount - expectedUsedCount)
    if (!validCounts) rows.forEach((row) => conflicts.add(row.occurrenceKey))
  }
  return conflicts
}

function hasLegacyOrigin(occurrence) {
  const provenance = occurrence?.provenance || {}
  return ['converted_legacy', 'legacy_unconverted'].includes(
    provenance.originMode
  ) || (
    provenance.originMode === 'unknown' &&
    provenance.hasLegacyEvidence === true
  )
}

export function classifyLegacyPartitionState(occurrence, {
  converted,
  terminalUnconverted,
  safelyConvertible,
}) {
  if (!hasLegacyOrigin(occurrence)) return ''
  if (
    occurrence.provenance.originMode === 'converted_legacy' &&
    occurrence.provenance.ledgerMode === 'canonical' &&
    converted === true
  ) {
    return 'already_converted'
  }
  if (
    occurrence.provenance.originMode === 'legacy_unconverted' &&
    occurrence.provenance.ledgerMode === 'legacy' &&
    terminalUnconverted === true
  ) {
    return 'terminal_unconverted'
  }
  if (
    occurrence.provenance.originMode === 'legacy_unconverted' &&
    occurrence.provenance.ledgerMode === 'legacy' &&
    safelyConvertible === true
  ) {
    return 'safely_convertible'
  }
  return 'unsafe'
}

export function aggregateAuditPages(pagesByFamily) {
  const counts = emptyCategoryMap(() => 0)
  const samples = emptyCategoryMap(() => [])
  const counted = new Set()
  const scanFamilies = {}
  let truncated = false
  let omittedCount = 0
  let complete = true
  const occurrenceRecords = []
  const membershipMap = new Map()
  const creditRecords = []
  const ledgerRows = []

  for (const family of AUDIT_SCAN_FAMILIES) {
    const pages = pagesByFamily?.[family]
    if (!Array.isArray(pages) || pages.length === 0) {
      failProtocol(`scan family ${family} has no pages.`)
    }
    const lastPage = pages.at(-1)
    const familyOmitted = pages.reduce((sum, page) => sum + page.omittedCount, 0)
    const familyTruncated = pages.some((page) => page.truncated)
    const familyComplete = lastPage.complete === true &&
      lastPage.page.hasMore === false &&
      !familyTruncated &&
      familyOmitted === 0
    const fingerprints = []
    for (const page of pages) {
      for (const record of page.records) {
        fingerprints.push(`${record.kind}:${record.auditFingerprint}`)
        if (record.kind === 'occurrence') {
          occurrenceRecords.push(record)
          creditRecords.push(...record.declaredCredits)
        } else if (record.kind === 'credit') {
          creditRecords.push(record)
        } else if (record.kind === 'teacherMembership') {
          const existing = membershipMap.get(record.membershipKey)
          if (existing && stableStringify(existing) !== stableStringify(record)) {
            failProtocol(`membership ${record.membershipKey} changed within one audit run.`)
          }
          membershipMap.set(record.membershipKey, record)
        } else if (record.kind === 'ledgerRow') {
          ledgerRows.push(record)
        }
      }
    }
    const scannedCount = pages.reduce((sum, page) => sum + page.page.scannedCount, 0)
    const matchedCount = pages.reduce((sum, page) => sum + page.page.matchedCount, 0)
    scanFamilies[family] = {
      pages: pages.length,
      scannedCount,
      matchedCount,
      complete: familyComplete,
      truncated: familyTruncated,
      omittedCount: familyOmitted,
      datasetDigest: sha256(stableStringify(fingerprints.sort())),
    }
    complete = complete && familyComplete
    truncated = truncated || familyTruncated
    omittedCount += familyOmitted
  }

  const occurrences = collapseOccurrenceRecords(occurrenceRecords)
  const memberships = [...membershipMap.values()]
    .sort((left, right) => left.membershipKey.localeCompare(right.membershipKey))
  const credits = mergeCreditRecords(creditRecords)
  const matchedCreditIds = new Set()
  const packageConflicts = packageAggregateConflicts(occurrences, ledgerRows)

  const add = (category, occurrence) => {
    const key = `${category}:${occurrence.occurrenceKey}`
    if (counted.has(key)) return
    counted.add(key)
    counts[category] += 1
    samples[category].push(occurrenceSample(occurrence, category))
  }

  for (const occurrence of occurrences) {
    const ledgerMode = occurrence.provenance.ledgerMode
    const active = isActiveOccurrence(occurrence)
    const terminal = isTerminalOccurrence(occurrence)
    const blockers = new Set()

    add('currentLedgerOccurrenceTotal', occurrence)
    if (ledgerMode === 'canonical') {
      add('canonicalTotal', occurrence)
      add('currentCanonicalLedgerTotal', occurrence)
    } else if (ledgerMode === 'legacy') {
      add('legacyTotal', occurrence)
      add('currentLegacyLedgerTotal', occurrence)
    } else {
      add('currentUnknownOrMixedLedgerTotal', occurrence)
    }
    add('occurrenceOriginTotal', occurrence)
    if (occurrence.provenance.originMode === 'born_canonical') {
      add('bornCanonicalTotal', occurrence)
    } else if (hasLegacyOrigin(occurrence)) {
      add('legacyOriginTotal', occurrence)
    } else {
      add('unknownOriginTotal', occurrence)
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
      if (occurrence.diagnostics[category]) {
        add(category, occurrence)
        blockers.add(category)
      }
    }
    if (occurrence.provenance.originMode === 'unknown') {
      add('unclassifiableOccurrence', occurrence)
      blockers.add('unclassifiableOccurrence')
    }
    if (packageConflicts.has(occurrence.occurrenceKey)) {
      add('packageMismatch', occurrence)
      blockers.add('packageMismatch')
    }

    const teacherDiagnostic = resolveTeacherDiagnostic(occurrence, memberships)
    if (teacherDiagnostic) {
      add(teacherDiagnostic, occurrence)
      blockers.add(teacherDiagnostic)
    }

    const deductionCredits = credits.filter(
      (credit) => creditBelongsToOccurrence(credit, occurrence)
    )
    deductionCredits.forEach((credit) => matchedCreditIds.add(credit.id))
    if (deductionCredits.length > 1) {
      add('duplicateDeductionCredit', occurrence)
      blockers.add('duplicateDeductionCredit')
    }
    const applied = occurrence.deduction.lessonApplied === true ||
      occurrence.deduction.reservationApplied === true ||
      occurrence.deduction.slotApplied === true
    const uniqueDeductionIds = uniqueStrings(occurrence.deduction.ids)
    const evidenceConflict = uniqueDeductionIds.length > 1 ||
      (ledgerMode === 'canonical' && applied && uniqueDeductionIds.length === 0) ||
      (terminal && !applied && deductionCredits.length === 0) ||
      (applied && deductionCredits.length === 0) ||
      (!applied && deductionCredits.length > 0) ||
      deductionCredits.some((credit) => !creditMatchesOccurrence(credit, occurrence)) ||
      uniqueDeductionIds.some(
        (id) => !deductionCredits.some((credit) => credit.id === id)
      )
    if (evidenceConflict) {
      add('conflictingDeductionEvidence', occurrence)
      blockers.add('conflictingDeductionEvidence')
    }

    const singleConsistentCredit = deductionCredits.length === 1 &&
      creditMatchesOccurrence(deductionCredits[0], occurrence)
    const statusConsistent = terminal &&
      occurrence.statuses.lesson === occurrence.statuses.reservation &&
      occurrence.statuses.slot === 'reserved'
    const terminalConsistent = applied && singleConsistentCredit && statusConsistent
    if (terminalConsistent) add('alreadyReservationDeductedConsistent', occurrence)
    const converted =
      occurrence.provenance.originMode === 'converted_legacy' &&
      occurrence.provenance.hasLegacyEvidence === true &&
      occurrence.provenance.legacyEvidenceConsistent === true &&
      singleConsistentCredit &&
      deductionCredits[0].ledgerTransition === 'lesson_to_reservation'

    const canProceed = blockers.size === 0 &&
      !evidenceConflict &&
      occurrence.diagnosticReasons.rowFlags.length === 0
    if (ledgerMode === 'canonical' && terminal) add('canonicalTerminal', occurrence)
    if (ledgerMode === 'canonical' && active && canProceed) add('canonicalReady', occurrence)

    const duplicateContribution =
      occurrence.ledgerContribution.lessonCountsByDate === true &&
      occurrence.ledgerContribution.reservationCountsByEvidence === true
    const safelyConvertible = active &&
      canProceed &&
      occurrence.ledgerContribution.lessonCountsByDate === true &&
      occurrence.ledgerContribution.lessonEnded === true &&
      !duplicateContribution &&
      !packageConflicts.has(occurrence.occurrenceKey)
    const partitionState = classifyLegacyPartitionState(occurrence, {
      converted: converted && terminalConsistent && canProceed,
      terminalUnconverted: terminal && terminalConsistent && canProceed,
      safelyConvertible,
    })
    if (partitionState === 'already_converted') {
      add('legacyAlreadyConverted', occurrence)
    } else if (partitionState === 'terminal_unconverted') {
      add('legacyTerminal', occurrence)
    } else if (partitionState === 'safely_convertible') {
      add('legacySafelyConvertible', occurrence)
    } else if (partitionState === 'unsafe') {
      add('legacyUnsafeToConvert', occurrence)
      blockers.add('legacyUnsafeToConvert')
    }
  }

  for (const credit of credits) {
    if (
      !isDeductionCredit(credit) ||
      !creditHasFixedProvenance(credit) ||
      matchedCreditIds.has(credit.id)
    ) {
      continue
    }
    const syntheticOccurrence = {
      occurrenceKey: `credit:${credit.id}`,
      lessonId: credit.lessonId,
      reservationId: credit.sourceId,
      slotId: credit.slotId,
    }
    add('unclassifiableOccurrence', syntheticOccurrence)
    add('conflictingDeductionEvidence', syntheticOccurrence)
  }

  for (const category of AUDIT_CATEGORY_NAMES) {
    samples[category] = samples[category]
      .sort((left, right) => stableStringify(left).localeCompare(stableStringify(right)))
      .slice(0, SAMPLE_LIMIT)
  }
  const blockerTotal = AUDIT_BLOCKER_CATEGORIES.reduce(
    (sum, category) => sum + counts[category],
    0
  )
  const pass = complete && !truncated && omittedCount === 0 && blockerTotal === 0
  const digestPayload = {
    counts,
    samples,
    scanFamilies: Object.fromEntries(AUDIT_SCAN_FAMILIES.map((family) => [
      family,
      {
        scannedCount: scanFamilies[family].scannedCount,
        matchedCount: scanFamilies[family].matchedCount,
        datasetDigest: scanFamilies[family].datasetDigest,
      },
    ])),
    totals: {
      occurrences: occurrences.length,
      deductionCredits: credits.filter(isDeductionCredit).length,
      activeTeacherMemberships: memberships.length,
    },
  }
  return {
    auditVersion: AUDIT_VERSION,
    complete,
    truncated,
    omittedCount,
    pass,
    blockerTotal,
    counts,
    samples,
    scanFamilies,
    totals: digestPayload.totals,
    datasetDigest: sha256(stableStringify(digestPayload.scanFamilies)),
    summaryDigest: sha256(stableStringify(digestPayload)),
  }
}

export function validateProductionAuditEnvironment(env) {
  if (env.PROJECT_ID !== PRODUCTION_PROJECT_ID) {
    throw new Error(`PROJECT_ID must be exactly ${PRODUCTION_PROJECT_ID}.`)
  }
  if (env.CONFIRM_PRODUCTION_READONLY_AUDIT !== 'YES') {
    throw new Error('CONFIRM_PRODUCTION_READONLY_AUDIT must be YES.')
  }
  if (env.CONFIRM_FIXED_PRIVATE_WRITE_QUIET_WINDOW !== 'YES') {
    throw new Error('CONFIRM_FIXED_PRIVATE_WRITE_QUIET_WINDOW must be YES.')
  }
  if (!normalizeString(env.ACADEMY_ID)) throw new Error('ACADEMY_ID is required.')
  if (env.ACADEMY_ID.length > 200 || env.ACADEMY_ID.includes('/')) {
    throw new Error('ACADEMY_ID must be a bounded Firestore ID.')
  }
  if (!normalizeString(env.FIREBASE_ID_TOKEN)) {
    throw new Error('FIREBASE_ID_TOKEN is required.')
  }
  return { academyId: env.ACADEMY_ID, token: env.FIREBASE_ID_TOKEN }
}

async function callAuditPage({
  fetchImpl,
  token,
  academyId,
  scanFamily,
  cursor,
}) {
  const response = await fetchImpl(AUDIT_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        auditVersion: AUDIT_VERSION,
        academyId,
        scanFamily,
        cursor,
        limit: PAGE_LIMIT,
        dryRun: true,
        previewOnly: true,
        commit: false,
      },
    }),
  })
  if (!response?.ok) {
    throw new Error(`Audit callable failed with HTTP ${response?.status || 'unknown'}.`)
  }
  let body
  try {
    body = await response.json()
  } catch (error) {
    failProtocol('Audit callable returned malformed JSON.')
  }
  if (body?.error || !Object.prototype.hasOwnProperty.call(body || {}, 'result')) {
    failProtocol('Audit callable returned an error envelope.')
  }
  return validateAuditV2Page(body.result, { academyId, scanFamily, cursor })
}

async function runSingleAudit({ fetchImpl, token, academyId }) {
  const pagesByFamily = Object.fromEntries(
    AUDIT_SCAN_FAMILIES.map((family) => [family, []])
  )
  let totalRecords = 0
  for (const scanFamily of AUDIT_SCAN_FAMILIES) {
    let cursor = ''
    const seenCursors = new Set()
    while (true) {
      if (pagesByFamily[scanFamily].length >= MAX_PAGES_PER_FAMILY) {
        failProtocol(`Audit scan family ${scanFamily} exceeded the page safety bound.`)
      }
      const page = await callAuditPage({
        fetchImpl,
        token,
        academyId,
        scanFamily,
        cursor,
      })
      pagesByFamily[scanFamily].push(page)
      totalRecords += page.records.length
      if (totalRecords > MAX_RECORDS_PER_RUN) {
        failProtocol('Audit exceeded the record safety bound.')
      }
      if (page.truncated || page.omittedCount > 0 || !page.page.hasMore) break
      const nextCursor = page.page.nextCursor
      if (nextCursor === cursor || seenCursors.has(nextCursor)) {
        failProtocol('Audit pagination cursor did not advance.')
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
  }
  return aggregateAuditPages(pagesByFamily)
}

function consistencyPayload(summary) {
  return {
    complete: summary.complete,
    truncated: summary.truncated,
    omittedCount: summary.omittedCount,
    counts: summary.counts,
    samples: summary.samples,
    scanFamilies: Object.fromEntries(AUDIT_SCAN_FAMILIES.map((family) => [
      family,
      summary.scanFamilies[family],
    ])),
    totals: summary.totals,
    datasetDigest: summary.datasetDigest,
    summaryDigest: summary.summaryDigest,
  }
}

export async function runProductionAudit({
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const { academyId, token } = validateProductionAuditEnvironment(env)
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable.')
  const first = await runSingleAudit({ fetchImpl, token, academyId })
  const second = await runSingleAudit({ fetchImpl, token, academyId })
  const consistency = stableStringify(consistencyPayload(first)) ===
    stableStringify(consistencyPayload(second))
  const result = {
    ...second,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency,
    runDigests: [first.summaryDigest, second.summaryDigest],
    pass: second.pass && first.pass && consistency,
  }
  validateFinalAuditSummary(result)
  return result
}

export function validateInventoryInvariants(summary) {
  const counts = summary.counts
  if (counts.canonicalTotal !== counts.currentCanonicalLedgerTotal ||
      counts.legacyTotal !== counts.currentLegacyLedgerTotal) {
    failProtocol('Deprecated ledger aliases do not match current-ledger counts.')
  }
  const legacyPartitionTotal =
    counts.legacySafelyConvertible +
    counts.legacyAlreadyConverted +
    counts.legacyTerminal +
    counts.legacyUnsafeToConvert
  if (counts.legacyOriginTotal !== legacyPartitionTotal) {
    failProtocol('Legacy-origin partition invariant failed.')
  }
  const originTotal =
    counts.bornCanonicalTotal +
    counts.legacyOriginTotal +
    counts.unknownOriginTotal
  if (counts.occurrenceOriginTotal !== originTotal) {
    failProtocol('Occurrence-origin total invariant failed.')
  }
  const currentLedgerTotal =
    counts.currentCanonicalLedgerTotal +
    counts.currentLegacyLedgerTotal +
    counts.currentUnknownOrMixedLedgerTotal
  if (counts.currentLedgerOccurrenceTotal !== currentLedgerTotal) {
    failProtocol('Current-ledger total invariant failed.')
  }
  if (
    counts.occurrenceOriginTotal !== summary.totals.occurrences ||
    counts.currentLedgerOccurrenceTotal !== summary.totals.occurrences
  ) {
    failProtocol('Inventory counts do not match deduplicated occurrence records.')
  }
  if (
    counts.unclassifiableOccurrence <
      Math.max(
        counts.unknownOriginTotal,
        counts.currentUnknownOrMixedLedgerTotal
      )
  ) {
    failProtocol('Unknown occurrence inventory is not fail-closed.')
  }
}

function validateSummaryDigests(summary) {
  const scanFamilyDigestPayload = Object.fromEntries(
    AUDIT_SCAN_FAMILIES.map((family) => [
      family,
      {
        scannedCount: summary.scanFamilies[family].scannedCount,
        matchedCount: summary.scanFamilies[family].matchedCount,
        datasetDigest: summary.scanFamilies[family].datasetDigest,
      },
    ])
  )
  const expectedDatasetDigest = sha256(
    stableStringify(scanFamilyDigestPayload)
  )
  const expectedSummaryDigest = sha256(stableStringify({
    counts: summary.counts,
    samples: summary.samples,
    scanFamilies: scanFamilyDigestPayload,
    totals: summary.totals,
  }))
  if (
    summary.datasetDigest !== expectedDatasetDigest ||
    summary.summaryDigest !== expectedSummaryDigest ||
    summary.runDigests[1] !== summary.summaryDigest ||
    (
      summary.consistency === true &&
      summary.runDigests[0] !== summary.summaryDigest
    )
  ) {
    failProtocol('Audit summary digest does not match its aggregate records.')
  }
}

export function validateFinalAuditSummary(summary) {
  assertExactKeys(summary, [
    'auditVersion',
    'blockerTotal',
    'completedRuns',
    'complete',
    'consistency',
    'counts',
    'datasetDigest',
    'omittedCount',
    'pass',
    'quietWindowConfirmed',
    'runDigests',
    'samples',
    'scanFamilies',
    'summaryDigest',
    'totals',
    'truncated',
  ], 'summary')
  if (summary.auditVersion !== AUDIT_VERSION) failProtocol('summary.auditVersion mismatch.')
  assertBoolean(summary.complete, 'summary.complete')
  assertBoolean(summary.truncated, 'summary.truncated')
  assertSafeInteger(summary.omittedCount, 'summary.omittedCount')
  assertBoolean(summary.pass, 'summary.pass')
  assertSafeInteger(summary.blockerTotal, 'summary.blockerTotal')
  validateCategoryMap(summary.counts, AUDIT_CATEGORY_NAMES, 'summary.counts')
  validateSamples(summary.samples)
  if (summary.quietWindowConfirmed !== true || summary.completedRuns !== 2) {
    failProtocol('summary did not complete the required quiet-window double run.')
  }
  assertBoolean(summary.consistency, 'summary.consistency')
  if (!Array.isArray(summary.runDigests) || summary.runDigests.length !== 2 ||
      summary.runDigests.some((digest) => !HEX_64.test(digest))) {
    failProtocol('summary.runDigests is invalid.')
  }
  if (!HEX_64.test(summary.datasetDigest) || !HEX_64.test(summary.summaryDigest)) {
    failProtocol('summary digest is invalid.')
  }
  assertExactKeys(summary.scanFamilies, AUDIT_SCAN_FAMILIES, 'summary.scanFamilies')
  for (const family of AUDIT_SCAN_FAMILIES) {
    const value = summary.scanFamilies[family]
    assertExactKeys(value, [
      'complete',
      'datasetDigest',
      'matchedCount',
      'omittedCount',
      'pages',
      'scannedCount',
      'truncated',
    ], `summary.scanFamilies.${family}`)
    for (const field of ['matchedCount', 'omittedCount', 'pages', 'scannedCount']) {
      assertSafeInteger(value[field], `summary.scanFamilies.${family}.${field}`)
    }
    assertBoolean(value.complete, `summary.scanFamilies.${family}.complete`)
    assertBoolean(value.truncated, `summary.scanFamilies.${family}.truncated`)
    if (!HEX_64.test(value.datasetDigest)) {
      failProtocol(`summary.scanFamilies.${family}.datasetDigest is invalid.`)
    }
  }
  assertExactKeys(
    summary.totals,
    ['activeTeacherMemberships', 'deductionCredits', 'occurrences'],
    'summary.totals'
  )
  for (const [field, value] of Object.entries(summary.totals)) {
    assertSafeInteger(value, `summary.totals.${field}`)
  }
  validateInventoryInvariants(summary)
  validateSummaryDigests(summary)
  const computedBlockers = AUDIT_BLOCKER_CATEGORIES.reduce(
    (sum, category) => sum + summary.counts[category],
    0
  )
  if (summary.blockerTotal !== computedBlockers) {
    failProtocol('summary.blockerTotal mismatch.')
  }
  const expectedPass = summary.complete === true &&
    summary.truncated === false &&
    summary.omittedCount === 0 &&
    summary.consistency === true &&
    summary.blockerTotal === 0
  if (summary.pass !== expectedPass) {
    failProtocol('summary.pass is inconsistent with release-gate state.')
  }
  return summary
}

export function exitCodeForAuditSummary(summary) {
  try {
    validateFinalAuditSummary(summary)
  } catch (error) {
    return 1
  }
  if (
    summary.complete !== true ||
    summary.truncated === true ||
    summary.omittedCount > 0 ||
    summary.consistency !== true
  ) {
    return 3
  }
  if (summary.blockerTotal > 0) return 2
  return summary.pass === true ? 0 : 1
}

export async function executeAuditCli({
  env = process.env,
  fetchImpl = globalThis.fetch,
  writeOutput = (value) => process.stdout.write(`${value}\n`),
  writeError = (value) => process.stderr.write(`${value}\n`),
} = {}) {
  try {
    const summary = await runProductionAudit({ env, fetchImpl })
    writeOutput(JSON.stringify(summary))
    return exitCodeForAuditSummary(summary)
  } catch (error) {
    const token = normalizeString(env.FIREBASE_ID_TOKEN)
    const rawMessage = normalizeString(error?.message) || 'audit_failed'
    const safeMessage = token ? rawMessage.split(token).join('[REDACTED]') : rawMessage
    writeError(JSON.stringify({
      auditVersion: AUDIT_VERSION,
      error: safeMessage,
    }))
    return 1
  }
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) process.exitCode = await executeAuditCli()
