import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
export const REDACTED_ARTIFACT_VERSION = 1
export const REMEDIATION_MANIFEST_VERSION = 1
export const REMEDIATION_EVIDENCE_VERSION = 1
export const REMEDIATION_EVIDENCE_CALLABLE =
  'inspectFixedPrivateLessonOutcomeRemediationEvidence'
export const REMEDIATION_EVIDENCE_ENDPOINT =
  `https://${AUDIT_REGION}-${PRODUCTION_PROJECT_ID}.cloudfunctions.net/` +
  REMEDIATION_EVIDENCE_CALLABLE
export const REMEDIATION_EVIDENCE_PURPOSE =
  'local_sensitive_remediation_manifest'
export const REMEDIATION_EVIDENCE_SCAN_FAMILIES = [
  'lessons',
  'reservations',
  'slots',
  'credits',
  'memberships',
  'packages',
]
export const LOCAL_REMEDIATION_SENSITIVITY =
  'LOCAL_ONLY_CONTAINS_RAW_FIRESTORE_IDS'
export const REDACTED_PRIMARY_COHORTS = [
  'financial_conflict_manual_only',
  'student_or_package_manual_review',
  'structural_missing_link',
  'structural_link_mismatch',
  'teacher_mapping_required',
  'unclassifiable_manual_review',
  'safe_convertible',
  'safe_other',
]
export const REDACTED_REPAIRABILITY_VALUES = [
  'safe_no_repair_required',
  'financial_manual_review_only',
  'manual_mapping_required',
  'deterministic_repair_candidate',
  'obsolete_orphan_candidate',
  'insufficient_evidence_no_write',
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
const MIN_REDACTION_KEY_LENGTH = 32
const HEX_64 = /^[a-f0-9]{64}$/
const OPAQUE_CURSOR = /^[A-Za-z0-9_-]+$/
const RUNNER_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..'
)
const OCCURRENCE_FAMILIES = new Set([
  'fixedLessons',
  'fixedReservations',
  'fixedSlots',
])
const TYPED_DOCUMENT_TYPES = new Set([
  'credit',
  'lesson',
  'membership',
  'package',
  'reservation',
  'slot',
])
const ROOT_FAMILY_DOCUMENT_TYPES = {
  fixedLessons: 'lesson',
  fixedReservations: 'reservation',
  fixedSlots: 'slot',
  lessons: 'lesson',
  reservations: 'reservation',
  slots: 'slot',
}
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
export const REMEDIATION_EVIDENCE_SCHEMA = {
  evidenceVersion: REMEDIATION_EVIDENCE_VERSION,
  responseKeys: [
    'academyId', 'commit', 'dryRun', 'evidenceVersion', 'page', 'pageDigest',
    'previewOnly', 'records', 'scanFamily', 'schemaDigest',
  ],
  pageKeys: [
    'complete', 'hasMore', 'nextCursor', 'omittedCount', 'pageSize',
    'returnedCount', 'scannedCount', 'truncated',
  ],
  records: {
    occurrence: {
      keys: [
        'academyId', 'auditFingerprint', 'creditIds', 'credits',
        'documentPresence', 'documentScopes', 'kind', 'ledgerTargeting', 'lessonId',
        'membershipIds', 'occurrenceKey', 'packageCandidateIds',
        'packageCandidates', 'packageId', 'provenance', 'reservationId',
        'resolvedLinks', 'rootFamily', 'rootId', 'schedule', 'slotId',
        'statusDeduction', 'storedLinkAliases', 'storedLinkConflict',
        'storedLinks', 'studentCandidateIds', 'studentId', 'teacher',
      ],
      resolvedLinksKeys: ['lessonId', 'reservationId', 'slotId'],
      documentFamilyKeys: ['lesson', 'reservation', 'slot'],
      storedLinkKeys: [
        'deductionPackageId', 'fixedLessonId', 'fixedPrivatePackageId',
        'lessonId', 'linkedLessonId', 'linkedPackageId',
        'linkedReservationId', 'linkedSlotId', 'packageId', 'privateLessonId',
        'privateLessonReservationId', 'privateLessonSlotId', 'reservationId',
        'slotId',
      ],
      storedLinkAliasesKeys: ['lesson', 'reservation', 'slot'],
      storedLinkAliasSourceKeys: ['lesson', 'reservation', 'slot'],
      storedLessonAliasKeys: [
        'conflict', 'fixedLessonId', 'lessonId', 'linkedLessonId',
        'privateLessonId', 'resolvedValue', 'uniqueValues',
      ],
      storedReservationAliasKeys: [
        'conflict', 'linkedReservationId', 'privateLessonReservationId',
        'reservationId', 'resolvedValue', 'uniqueValues',
      ],
      storedSlotAliasKeys: [
        'conflict', 'linkedSlotId', 'privateLessonSlotId', 'resolvedValue',
        'slotId', 'uniqueValues',
      ],
      documentPresenceKeys: [
        'credits', 'lesson', 'memberships', 'package', 'packages',
        'reservation', 'slot', 'student', 'students',
      ],
      presenceEntryKeys: ['academyId', 'academyScoped', 'exists', 'id'],
      documentScopesKeys: ['lesson', 'reservation', 'slot', 'student'],
      documentScopeKeys: ['academyId', 'academyScoped', 'exists', 'id'],
      packageCandidateKeys: [
        'academyId', 'academyScoped', 'exists', 'id', 'remainingCount',
        'scope', 'sources', 'status', 'studentId', 'totalCount', 'type',
        'usedCount',
      ],
      teacherKeys: ['lesson', 'matchedMemberships', 'reservation', 'slot'],
      persistedTeacherKeys: [
        'assignedTeacherID', 'assignedTeacherId', 'assignedTeacherKey',
        'assignedTeacherUID', 'assignedTeacherUid', 'instructorUID',
        'instructorUid', 'normalizedNameDigest', 'teacherID', 'teacherId',
        'teacherKey', 'teacherUID', 'teacherUid',
      ],
      provenanceKeys: ['classifier', 'ledger', 'origin', 'raw'],
      classifierKeys: ['evidence', 'isFixed', 'ledgerType'],
      classifierEvidenceKeys: ['field', 'rowIndex', 'value'],
      ledgerKeys: [
        'lessonLedgerContribution', 'marker', 'markers', 'mode',
        'reservationLedgerContribution',
      ],
      originKeys: [
        'hasLegacyEvidence', 'legacyEvidenceConsistent', 'originMode',
      ],
      provenanceRawKeys: [
        'createdByFlow', 'createdBySource', 'fixedLessonId',
        'fixedPrivateAssignmentBatchId', 'fixedPrivateDeductionLedger',
        'fixedPrivateMigrationMarker', 'fixedPrivatePackageId',
        'ledgerTransition', 'migrationMarker', 'migrationVersion',
        'originFlow', 'originSource', 'packageType',
        'privateLessonAvailabilityTemplateId', 'renewalBatchId',
        'reservationType', 'slotType', 'source', 'sourceType',
      ],
      statusDeductionKeys: [
        'actionType', 'actorUID', 'actorUid', 'attendance',
        'attendanceStatus', 'createdByUid', 'deductionApplied',
        'deductionAttemptNumber', 'deductionCreditTransactionId',
        'deductionPackageId', 'deductionReversed', 'deductionSource',
        'deductionStatus', 'deductionTransactionId', 'isDeductCancelled',
        'noDeduction', 'outcome', 'outcomeActionBatchId',
        'outcomeActionRequestId', 'outcomeActionType', 'outcomeActorUID',
        'outcomeActorUid', 'outcomeByUID', 'outcomeByUid',
        'outcomeReversedByUID', 'outcomeReversedByUid', 'outcomeStatus',
        'originalCreditTransactionId', 'previousOutcomeStatus', 'requestId',
        'reversalAttemptNumber', 'reversalCreditTransactionId',
        'reversalOfTransactionId', 'status', 'statusActionBatchId',
        'statusActionRequestId', 'statusActionType', 'timestamps',
        'updatedByUid',
      ],
      timestampKeys: [
        'attendanceAppliedAt', 'cancelledAt', 'completedAt', 'createdAt',
        'deductionAppliedAt', 'deductionReversedAt', 'ledgerUpdatedAt',
        'noShowAt', 'outcomeAt', 'outcomeReversedAt', 'reservedAt',
        'updatedAt',
      ],
      scheduleKeys: [
        'date', 'durationMinutes', 'endAt', 'lessonDate', 'scheduleDate',
        'scheduleTime', 'startAt', 'startTime', 'time',
      ],
      ledgerTargetingKeys: [
        'academyId', 'collectionFamily', 'date', 'deltaCount', 'documentId',
        'effect', 'isDeduction', 'isReversal', 'lessonId',
        'ledgerTransition', 'packageId', 'reservationId', 'slotId',
        'sourceType', 'studentId',
      ],
      matchedMembershipKeys: [
        'academyId', 'active', 'authUid', 'id', 'memberUid',
        'normalizedNameDigest', 'role', 'status', 'teacherID', 'teacherId',
        'teacherKey', 'teacherUID', 'teacherUid', 'uid',
      ],
    },
    credit: {
      keys: [
        'academyId', 'academyScoped', 'actionType', 'auditFingerprint',
        'deltaCount', 'effect', 'fixedPrivateDeductionLedger', 'id',
        'isDeduction', 'isDeterministicCanonicalId', 'isReversal', 'kind',
        'ledgerTargeting', 'ledgerTransition', 'packageId', 'sourceType',
        'studentId', 'targeting', 'timestamp',
      ],
      targetingKeys: [
        'fixedLessonId', 'lessonId', 'linkedLessonId',
        'linkedReservationId', 'linkedSlotId', 'originalCreditTransactionId',
        'reservationId', 'reversalOfTransactionId', 'slotId', 'sourceId',
      ],
    },
    membership: {
      keys: [
        'academyId', 'active', 'auditFingerprint', 'authUid', 'id', 'kind',
        'memberUid', 'normalizedNameDigest', 'role', 'status', 'teacherID',
        'teacherId', 'teacherKey', 'teacherUID', 'teacherUid', 'uid',
      ],
    },
    package: {
      keys: [
        'academyId', 'auditFingerprint', 'id', 'kind', 'remainingCount',
        'scope', 'status', 'studentId', 'totalCount', 'type', 'usedCount',
      ],
    },
  },
}
const EVIDENCE_RESULT_FIELDS = REMEDIATION_EVIDENCE_SCHEMA.responseKeys
const EVIDENCE_PAGE_FIELDS = REMEDIATION_EVIDENCE_SCHEMA.pageKeys
const OCCURRENCE_EVIDENCE_FIELDS =
  REMEDIATION_EVIDENCE_SCHEMA.records.occurrence.keys
const CREDIT_EVIDENCE_FIELDS = REMEDIATION_EVIDENCE_SCHEMA.records.credit.keys
const MEMBERSHIP_EVIDENCE_FIELDS =
  REMEDIATION_EVIDENCE_SCHEMA.records.membership.keys
const PACKAGE_EVIDENCE_FIELDS = REMEDIATION_EVIDENCE_SCHEMA.records.package.keys

class AuditProtocolError extends Error {
  constructor(message) {
    super(message)
    this.name = 'AuditProtocolError'
  }
}

class RemediationEvidenceIncompleteError extends Error {
  constructor(message) {
    super(message)
    this.name = 'RemediationEvidenceIncompleteError'
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

export function buildTypedDocumentKey(documentType, documentId) {
  const type = normalizeString(documentType)
  const id = normalizeString(documentId)
  if (!TYPED_DOCUMENT_TYPES.has(type) || !id) {
    failProtocol('Typed document identity is invalid.')
  }
  assertRawIdentifier(id, 'typed document id', { allowEmpty: false })
  return `${type}:${id}`
}

function rootFamilyDocumentType(rootFamily) {
  const documentType = ROOT_FAMILY_DOCUMENT_TYPES[rootFamily]
  if (!documentType) failProtocol('Occurrence root family is unsupported.')
  return documentType
}

function typedOccurrenceKey(value) {
  const key = normalizeString(value)
  const separator = key.indexOf(':')
  if (separator <= 0 || separator === key.length - 1) {
    failProtocol('Occurrence key is not collection-qualified.')
  }
  const documentType = key.slice(0, separator)
  if (!['lesson', 'reservation', 'slot'].includes(documentType)) {
    failProtocol('Occurrence key has an unsupported document type.')
  }
  return buildTypedDocumentKey(documentType, key.slice(separator + 1))
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

function assertDigest(value, label) {
  if (typeof value !== 'string' || !HEX_64.test(value)) {
    failProtocol(`${label} must be a digest.`)
  }
  return value
}

function assertRawIdentifier(value, label, { allowEmpty = true } = {}) {
  assertString(value, label, { allowEmpty })
  if (
    value.length > 1500 ||
    value.includes('/') ||
    /[\u0000-\u001f\u007f\s@]/u.test(value) ||
    /^bearer$/i.test(value)
  ) {
    failProtocol(`${label} is not a bounded raw identifier.`)
  }
  return value
}

function assertRawIdentifierArray(value, label) {
  assertStringArray(value, label)
  value.forEach((entry, index) =>
    assertRawIdentifier(entry, `${label}[${index}]`, { allowEmpty: false })
  )
  return value
}

export function remediationEvidenceSchemaDigest() {
  return sha256(stableStringify(REMEDIATION_EVIDENCE_SCHEMA))
}

export function remediationEvidencePageDigest(resultOrRecords) {
  const records = Array.isArray(resultOrRecords)
    ? resultOrRecords
    : resultOrRecords?.records
  if (!Array.isArray(records)) failProtocol('Evidence records are unavailable.')
  return sha256(stableStringify(records))
}

function assertNullableString(value, label, { digest = false } = {}) {
  if (value === null) return value
  assertString(value, label, { allowEmpty: false })
  if (digest && !HEX_64.test(value)) failProtocol(`${label} must be a digest.`)
  return value
}

function assertNullableIdentifier(value, label) {
  if (value === null) return value
  return assertRawIdentifier(value, label, { allowEmpty: false })
}

function assertNullableNumber(value, label) {
  if (value === null) return value
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    failProtocol(`${label} must be a finite number or null.`)
  }
  return value
}

function assertNullableTimestamp(value, label) {
  if (value === null) return value
  if (
    typeof value !== 'string' ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  ) {
    failProtocol(`${label} must be an ISO timestamp or null.`)
  }
  return value
}

function assertCanonicalIdentifierArray(value, label) {
  assertRawIdentifierArray(value, label)
  if (stableStringify(value) !== stableStringify([...value].sort())) {
    failProtocol(`${label} must be sorted.`)
  }
  return value
}

function validateDocumentScope(value, academyId, label, {
  requireId = true,
} = {}) {
  assertExactKeys(
    value,
    REMEDIATION_EVIDENCE_SCHEMA.records.occurrence.documentScopeKeys,
    label
  )
  if (requireId) {
    assertRawIdentifier(value.id, `${label}.id`, { allowEmpty: false })
  } else {
    assertNullableIdentifier(value.id, `${label}.id`)
  }
  assertBoolean(value.exists, `${label}.exists`)
  assertNullableIdentifier(value.academyId, `${label}.academyId`)
  if (value.academyScoped !== null) {
    assertBoolean(value.academyScoped, `${label}.academyScoped`)
  }
  if (
    (!value.exists && (
      value.academyScoped !== null ||
      value.academyId !== null
    )) ||
    (value.exists && value.academyScoped === null) ||
    (value.academyScoped === true && value.academyId !== academyId) ||
    (value.academyScoped === false && value.academyId === academyId)
  ) {
    failProtocol(`${label} scope state is inconsistent.`)
  }
}

function validatePresenceEntries(value, academyId, label) {
  if (!Array.isArray(value)) failProtocol(`${label} must be an array.`)
  value.forEach((entry, index) =>
    validateDocumentScope(entry, academyId, `${label}[${index}]`)
  )
  const ids = value.map((entry) => entry.id)
  if (
    new Set(ids).size !== ids.length ||
    stableStringify(ids) !== stableStringify([...ids].sort())
  ) {
    failProtocol(`${label} ids must be unique and sorted.`)
  }
}

function validateMembershipSummary(record, academyId, label, {
  fingerprint = false,
} = {}) {
  const expected = fingerprint
    ? MEMBERSHIP_EVIDENCE_FIELDS
    : REMEDIATION_EVIDENCE_SCHEMA.records.occurrence.matchedMembershipKeys
  assertExactKeys(record, expected, label)
  if (fingerprint && record.kind !== 'membership') {
    failProtocol(`${label}.kind is unsupported.`)
  }
  assertRawIdentifier(record.id, `${label}.id`, { allowEmpty: false })
  if (record.academyId !== academyId) failProtocol(`${label}.academyId mismatch.`)
  for (const field of [
    'uid', 'authUid', 'memberUid', 'teacherUid', 'teacherUID', 'teacherId',
    'teacherID', 'teacherKey', 'role', 'status',
  ]) {
    assertNullableIdentifier(record[field], `${label}.${field}`)
  }
  assertBoolean(record.active, `${label}.active`)
  assertNullableString(record.normalizedNameDigest,
    `${label}.normalizedNameDigest`, { digest: true })
  if (fingerprint) assertRecordFingerprint(record, label)
}

function validateCreditEvidenceRecord(record, academyId, label, {
  allowAcademyMismatch = false,
} = {}) {
  assertExactKeys(record, CREDIT_EVIDENCE_FIELDS, label)
  if (record.kind !== 'credit') failProtocol(`${label}.kind is unsupported.`)
  assertRawIdentifier(record.id, `${label}.id`, { allowEmpty: false })
  assertBoolean(record.academyScoped, `${label}.academyScoped`)
  if (
    (!allowAcademyMismatch && record.academyScoped !== true) ||
    (record.academyScoped && record.academyId !== academyId) ||
    (!record.academyScoped && record.academyId === academyId)
  ) {
    failProtocol(`${label}.academyId mismatch.`)
  }
  for (const field of [
    'academyId', 'studentId', 'packageId', 'sourceType', 'actionType',
    'ledgerTransition', 'fixedPrivateDeductionLedger',
  ]) {
    assertNullableIdentifier(record[field], `${label}.${field}`)
  }
  assertNullableNumber(record.deltaCount, `${label}.deltaCount`)
  if (
    record.effect !== null &&
    !['deduction', 'reversal', 'neutral'].includes(record.effect)
  ) {
    failProtocol(`${label}.effect is unsupported.`)
  }
  for (const field of [
    'isDeduction', 'isReversal', 'isDeterministicCanonicalId',
  ]) {
    assertBoolean(record[field], `${label}.${field}`)
  }
  assertNullableTimestamp(record.timestamp, `${label}.timestamp`)
  assertExactKeys(
    record.targeting,
    REMEDIATION_EVIDENCE_SCHEMA.records.credit.targetingKeys,
    `${label}.targeting`
  )
  for (const field of REMEDIATION_EVIDENCE_SCHEMA.records.credit.targetingKeys) {
    assertNullableIdentifier(record.targeting[field], `${label}.targeting.${field}`)
  }
  validateLedgerTargetingRow(
    record.ledgerTargeting,
    `${label}.ledgerTargeting`,
    { nullableEffect: !record.academyScoped }
  )
  if (!record.academyScoped) {
    const safeForeignProjection = {
      actionType: record.actionType,
      deltaCount: record.deltaCount,
      effect: record.effect,
      fixedPrivateDeductionLedger: record.fixedPrivateDeductionLedger,
      isDeduction: record.isDeduction,
      isDeterministicCanonicalId: record.isDeterministicCanonicalId,
      isReversal: record.isReversal,
      ledgerTransition: record.ledgerTransition,
      packageId: record.packageId,
      sourceType: record.sourceType,
      studentId: record.studentId,
      targeting: record.targeting,
      timestamp: record.timestamp,
    }
    const expectedSafeProjection = {
      actionType: null,
      deltaCount: null,
      effect: null,
      fixedPrivateDeductionLedger: null,
      isDeduction: false,
      isDeterministicCanonicalId: false,
      isReversal: false,
      ledgerTransition: null,
      packageId: null,
      sourceType: null,
      studentId: null,
      targeting: Object.fromEntries(
        REMEDIATION_EVIDENCE_SCHEMA.records.credit.targetingKeys.map(
          (field) => [field, null]
        )
      ),
      timestamp: null,
    }
    assertSameValue(
      safeForeignProjection,
      expectedSafeProjection,
      `${label} foreign evidence is not safely redacted.`
    )
    const expectedLedgerTargeting = {
      ...Object.fromEntries(
        REMEDIATION_EVIDENCE_SCHEMA.records.occurrence.ledgerTargetingKeys.map(
          (field) => [field, null]
        )
      ),
      collectionFamily: 'creditTransactions',
      documentId: record.id,
      isDeduction: false,
      isReversal: false,
    }
    assertSameValue(
      record.ledgerTargeting,
      expectedLedgerTargeting,
      `${label}.ledgerTargeting leaks foreign evidence.`
    )
  }
  assertRecordFingerprint(record, label)
}

function validatePackageSummary(record, academyId, label, {
  fingerprint = false,
  candidate = false,
  allowAcademyMismatch = false,
} = {}) {
  const expected = candidate
    ? REMEDIATION_EVIDENCE_SCHEMA.records.occurrence.packageCandidateKeys
    : PACKAGE_EVIDENCE_FIELDS
  assertExactKeys(record, expected, label)
  if (fingerprint && record.kind !== 'package') {
    failProtocol(`${label}.kind is unsupported.`)
  }
  assertRawIdentifier(record.id, `${label}.id`, { allowEmpty: false })
  if (
    !allowAcademyMismatch &&
    record.academyId !== null &&
    record.academyId !== academyId
  ) {
    failProtocol(`${label}.academyId mismatch.`)
  }
  for (const field of ['academyId', 'studentId', 'type', 'scope', 'status']) {
    assertNullableIdentifier(record[field], `${label}.${field}`)
  }
  for (const field of ['totalCount', 'usedCount', 'remainingCount']) {
    assertNullableNumber(record[field], `${label}.${field}`)
  }
  if (candidate) {
    assertBoolean(record.exists, `${label}.exists`)
    if (record.academyScoped !== null) {
      assertBoolean(record.academyScoped, `${label}.academyScoped`)
    }
    assertCanonicalIdentifierArray(record.sources, `${label}.sources`)
    if (
      (!record.exists && (
        record.academyScoped !== null ||
        record.academyId !== null
      )) ||
      (record.exists && record.academyScoped === null) ||
      (record.academyScoped === true && record.academyId !== academyId) ||
      (record.academyScoped === false && record.academyId === academyId)
    ) {
      failProtocol(`${label} package scope is inconsistent.`)
    }
    if (record.academyScoped !== true) {
      for (const field of [
        'studentId', 'type', 'scope', 'status', 'totalCount', 'usedCount',
        'remainingCount',
      ]) {
        if (record[field] !== null) {
          failProtocol(`${label}.${field} leaks out-of-scope package data.`)
        }
      }
    }
  }
  if (fingerprint) assertRecordFingerprint(record, label)
}

function validatePersistedTeacher(value, label) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(value, schema.persistedTeacherKeys, label)
  for (const field of schema.persistedTeacherKeys) {
    if (field === 'normalizedNameDigest') {
      assertNullableString(value[field], `${label}.${field}`, { digest: true })
    } else {
      assertNullableIdentifier(value[field], `${label}.${field}`)
    }
  }
}

function validateOccurrenceProvenance(value, label) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(value, schema.provenanceKeys, label)
  assertExactKeys(value.classifier, schema.classifierKeys, `${label}.classifier`)
  assertBoolean(value.classifier.isFixed, `${label}.classifier.isFixed`)
  if (!['', 'canonical', 'legacy'].includes(value.classifier.ledgerType)) {
    failProtocol(`${label}.classifier.ledgerType is unsupported.`)
  }
  if (!Array.isArray(value.classifier.evidence)) {
    failProtocol(`${label}.classifier.evidence must be an array.`)
  }
  value.classifier.evidence.forEach((entry, index) => {
    assertExactKeys(
      entry,
      schema.classifierEvidenceKeys,
      `${label}.classifier.evidence[${index}]`
    )
    assertSafeInteger(entry.rowIndex,
      `${label}.classifier.evidence[${index}].rowIndex`)
    assertString(entry.field, `${label}.classifier.evidence[${index}].field`, {
      allowEmpty: false,
    })
    assertString(entry.value, `${label}.classifier.evidence[${index}].value`, {
      allowEmpty: false,
    })
  })
  assertExactKeys(value.ledger, schema.ledgerKeys, `${label}.ledger`)
  if (!['canonical', 'legacy', 'inconsistent'].includes(value.ledger.mode)) {
    failProtocol(`${label}.ledger.mode is unsupported.`)
  }
  assertString(value.ledger.marker, `${label}.ledger.marker`)
  if (!Array.isArray(value.ledger.markers) ||
      value.ledger.markers.length !== 3) {
    failProtocol(`${label}.ledger.markers must contain three values.`)
  }
  value.ledger.markers.forEach((marker, index) =>
    assertString(marker, `${label}.ledger.markers[${index}]`)
  )
  assertSafeInteger(value.ledger.lessonLedgerContribution,
    `${label}.ledger.lessonLedgerContribution`)
  assertSafeInteger(value.ledger.reservationLedgerContribution,
    `${label}.ledger.reservationLedgerContribution`)
  assertExactKeys(value.origin, schema.originKeys, `${label}.origin`)
  if (![
    'born_canonical', 'converted_legacy', 'legacy_unconverted', 'unknown',
  ].includes(value.origin.originMode)) {
    failProtocol(`${label}.origin.originMode is unsupported.`)
  }
  assertBoolean(value.origin.hasLegacyEvidence,
    `${label}.origin.hasLegacyEvidence`)
  assertBoolean(value.origin.legacyEvidenceConsistent,
    `${label}.origin.legacyEvidenceConsistent`)
  assertExactKeys(value.raw, schema.documentFamilyKeys, `${label}.raw`)
  for (const family of schema.documentFamilyKeys) {
    const raw = value.raw[family]
    assertExactKeys(raw, schema.provenanceRawKeys, `${label}.raw.${family}`)
    for (const field of schema.provenanceRawKeys) {
      const scalar = raw[field]
      if (scalar !== null &&
          !['string', 'number', 'boolean'].includes(typeof scalar)) {
        failProtocol(`${label}.raw.${family}.${field} must be scalar or null.`)
      }
    }
  }
}

function validateStatusDeduction(value, label) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(value, schema.documentFamilyKeys, label)
  const booleanFields = new Set([
    'deductionApplied', 'deductionReversed', 'noDeduction', 'isDeductCancelled',
  ])
  const numberFields = new Set(['deductionAttemptNumber', 'reversalAttemptNumber'])
  for (const family of schema.documentFamilyKeys) {
    const row = value[family]
    assertExactKeys(row, schema.statusDeductionKeys, `${label}.${family}`)
    for (const field of schema.statusDeductionKeys) {
      if (field === 'timestamps') {
        assertExactKeys(row.timestamps, schema.timestampKeys,
          `${label}.${family}.timestamps`)
        for (const timestamp of schema.timestampKeys) {
          assertNullableTimestamp(
            row.timestamps[timestamp],
            `${label}.${family}.timestamps.${timestamp}`
          )
        }
      } else if (booleanFields.has(field)) {
        if (row[field] !== null) assertBoolean(row[field], `${label}.${family}.${field}`)
      } else if (numberFields.has(field)) {
        assertNullableNumber(row[field], `${label}.${family}.${field}`)
      } else {
        assertNullableString(row[field], `${label}.${family}.${field}`)
      }
    }
  }
}

function validateSchedule(value, label) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(value, schema.documentFamilyKeys, label)
  for (const family of schema.documentFamilyKeys) {
    const row = value[family]
    assertExactKeys(row, schema.scheduleKeys, `${label}.${family}`)
    for (const field of schema.scheduleKeys) {
      if (['durationMinutes'].includes(field)) {
        assertNullableNumber(row[field], `${label}.${family}.${field}`)
      } else if (['startAt', 'endAt'].includes(field)) {
        assertNullableTimestamp(row[field], `${label}.${family}.${field}`)
      } else {
        assertNullableString(row[field], `${label}.${family}.${field}`)
      }
    }
  }
}

function validateLedgerTargetingRow(row, label, {
  nullableEffect = false,
} = {}) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(row, schema.ledgerTargetingKeys, label)
  for (const field of schema.ledgerTargetingKeys) {
    if (field === 'deltaCount') {
      assertNullableNumber(row[field], `${label}.${field}`)
    } else if (['isDeduction', 'isReversal'].includes(field)) {
      assertBoolean(row[field], `${label}.${field}`)
    } else if (field === 'effect') {
      if (
        !(nullableEffect && row[field] === null) &&
        !['deduction', 'reversal', 'neutral'].includes(row[field])
      ) {
        failProtocol(`${label}.effect is unsupported.`)
      }
    } else {
      assertNullableString(row[field], `${label}.${field}`)
    }
  }
}

function validateLedgerTargeting(value, label) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(value, schema.documentFamilyKeys, label)
  for (const family of schema.documentFamilyKeys) {
    validateLedgerTargetingRow(value[family], `${label}.${family}`)
  }
}

function storedAliasKeysForTarget(schema, targetType) {
  const field = `stored${targetType[0].toUpperCase()}${targetType.slice(1)}AliasKeys`
  return schema[field]
}

function validateStoredLinkAliases(record, label) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(
    record.storedLinkAliases,
    schema.storedLinkAliasesKeys,
    `${label}.storedLinkAliases`
  )
  const sourceTypes = schema.storedLinkAliasSourceKeys
  const targetTypes = schema.storedLinkAliasesKeys
  const targetResolvedValues = Object.fromEntries(
    targetTypes.map((targetType) => [targetType, []])
  )
  let aggregateConflict = false
  for (const sourceType of sourceTypes) {
    const sourceAliases = record.storedLinkAliases[sourceType]
    assertExactKeys(
      sourceAliases,
      targetTypes,
      `${label}.storedLinkAliases.${sourceType}`
    )
    for (const targetType of targetTypes) {
      const alias = sourceAliases[targetType]
      const aliasKeys = storedAliasKeysForTarget(schema, targetType)
      const valueKeys = aliasKeys.filter((field) =>
        !['conflict', 'resolvedValue', 'uniqueValues'].includes(field)
      )
      assertExactKeys(
        alias,
        aliasKeys,
        `${label}.storedLinkAliases.${sourceType}.${targetType}`
      )
      for (const field of valueKeys) {
        assertNullableIdentifier(
          alias[field],
          `${label}.storedLinkAliases.${sourceType}.${targetType}.${field}`
        )
      }
      assertCanonicalIdentifierArray(
        alias.uniqueValues,
        `${label}.storedLinkAliases.${sourceType}.${targetType}.uniqueValues`
      )
      assertNullableIdentifier(
        alias.resolvedValue,
        `${label}.storedLinkAliases.${sourceType}.${targetType}.resolvedValue`
      )
      assertBoolean(
        alias.conflict,
        `${label}.storedLinkAliases.${sourceType}.${targetType}.conflict`
      )
      const expectedUniqueValues = uniqueStrings(
        valueKeys.map((field) => alias[field])
      )
      const expectedResolvedValue = expectedUniqueValues.length === 1
        ? expectedUniqueValues[0]
        : null
      const expectedConflict = expectedUniqueValues.length > 1
      if (
        stableStringify(alias.uniqueValues) !==
          stableStringify(expectedUniqueValues) ||
        alias.resolvedValue !== expectedResolvedValue ||
        alias.conflict !== expectedConflict
      ) {
        failProtocol(
          `${label}.storedLinkAliases.${sourceType}.${targetType} is inconsistent.`
        )
      }
      if (
        record.documentScopes[sourceType].academyScoped !== true &&
        expectedUniqueValues.length > 0
      ) {
        failProtocol(`${label} foreign or missing data created stored aliases.`)
      }
      if (alias.resolvedValue) {
        targetResolvedValues[targetType].push(alias.resolvedValue)
      }
      aggregateConflict = aggregateConflict || alias.conflict
    }
  }

  const rootType = rootFamilyDocumentType(record.rootFamily)
  for (const targetType of targetTypes) {
    const resolvedValues = uniqueStrings(targetResolvedValues[targetType])
    const targetConflict = sourceTypes.some(
      (sourceType) =>
        record.storedLinkAliases[sourceType][targetType].conflict === true
    ) || resolvedValues.length > 1
    aggregateConflict = aggregateConflict || targetConflict
    const expectedResolved = targetType === rootType
      ? record.rootId
      : !targetConflict && resolvedValues.length === 1
        ? resolvedValues[0]
        : null
    if (record.resolvedLinks[`${targetType}Id`] !== expectedResolved) {
      failProtocol(`${label}.resolvedLinks.${targetType}Id is inconsistent.`)
    }
  }
  if (record.storedLinkConflict !== aggregateConflict) {
    failProtocol(`${label}.storedLinkConflict is inconsistent.`)
  }
}

function validateOccurrenceEvidenceRecord(record, academyId, scanFamily, label) {
  const schema = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
  assertExactKeys(record, OCCURRENCE_EVIDENCE_FIELDS, label)
  if (
    record.kind !== 'occurrence' ||
    record.rootFamily !== scanFamily ||
    !['lessons', 'reservations', 'slots'].includes(record.rootFamily)
  ) {
    failProtocol(`${label} occurrence family is unsupported.`)
  }
  assertRawIdentifier(record.rootId, `${label}.rootId`, { allowEmpty: false })
  assertRawIdentifier(record.occurrenceKey, `${label}.occurrenceKey`, {
    allowEmpty: false,
  })
  if (typedOccurrenceKey(record.occurrenceKey) !== record.occurrenceKey) {
    failProtocol(`${label}.occurrenceKey is not canonical.`)
  }
  if (record.academyId !== academyId) failProtocol(`${label}.academyId mismatch.`)
  for (const field of ['lessonId', 'reservationId', 'slotId', 'studentId', 'packageId']) {
    assertNullableIdentifier(record[field], `${label}.${field}`)
  }
  assertCanonicalIdentifierArray(record.studentCandidateIds,
    `${label}.studentCandidateIds`)
  assertCanonicalIdentifierArray(record.packageCandidateIds,
    `${label}.packageCandidateIds`)
  assertCanonicalIdentifierArray(record.membershipIds, `${label}.membershipIds`)
  assertCanonicalIdentifierArray(record.creditIds, `${label}.creditIds`)
  assertExactKeys(record.resolvedLinks, schema.resolvedLinksKeys,
    `${label}.resolvedLinks`)
  for (const field of schema.resolvedLinksKeys) {
    assertNullableIdentifier(record.resolvedLinks[field],
      `${label}.resolvedLinks.${field}`)
  }
  assertExactKeys(record.storedLinks, schema.documentFamilyKeys,
    `${label}.storedLinks`)
  for (const family of schema.documentFamilyKeys) {
    assertExactKeys(record.storedLinks[family], schema.storedLinkKeys,
      `${label}.storedLinks.${family}`)
    for (const field of schema.storedLinkKeys) {
      assertNullableIdentifier(record.storedLinks[family][field],
        `${label}.storedLinks.${family}.${field}`)
    }
  }
  assertExactKeys(record.documentPresence, schema.documentPresenceKeys,
    `${label}.documentPresence`)
  assertExactKeys(record.documentScopes, schema.documentScopesKeys,
    `${label}.documentScopes`)
  for (const family of schema.documentScopesKeys) {
    validateDocumentScope(
      record.documentScopes[family],
      academyId,
      `${label}.documentScopes.${family}`,
      { requireId: false }
    )
    if (
      record.documentPresence[family] !==
        record.documentScopes[family].exists ||
      (family !== 'student' && record[`${family}Id`] !== (
        record.documentScopes[family].exists
          ? record.documentScopes[family].id
          : null
      ))
    ) {
      failProtocol(`${label}.${family} scope and presence disagree.`)
    }
  }
  assertBoolean(record.storedLinkConflict, `${label}.storedLinkConflict`)
  validateStoredLinkAliases(record, label)
  for (const field of ['lesson', 'reservation', 'slot', 'student', 'package']) {
    assertBoolean(record.documentPresence[field],
      `${label}.documentPresence.${field}`)
  }
  for (const field of ['memberships', 'credits', 'packages', 'students']) {
    validatePresenceEntries(record.documentPresence[field], academyId,
      `${label}.documentPresence.${field}`)
  }
  const studentPresenceIds = record.documentPresence.students.map(
    (entry) => entry.id
  )
  assertSameValue(
    studentPresenceIds,
    record.studentCandidateIds,
    `${label} student presence ids disagree with candidates.`
  )
  if (record.studentCandidateIds.length === 1) {
    const studentPresence = record.documentPresence.students[0]
    if (
      record.studentId !== record.studentCandidateIds[0] ||
      record.documentPresence.student !== studentPresence.exists ||
      stableStringify(record.documentScopes.student) !==
        stableStringify(studentPresence)
    ) {
      failProtocol(`${label} singular student scope is inconsistent.`)
    }
  } else {
    const missingStudentScope = {
      academyId: null,
      academyScoped: null,
      exists: false,
      id: null,
    }
    if (
      record.studentId !== null ||
      record.documentPresence.student !== false ||
      stableStringify(record.documentScopes.student) !==
        stableStringify(missingStudentScope)
    ) {
      failProtocol(`${label} ambiguous student scope must be explicitly missing.`)
    }
  }
  if (!Array.isArray(record.packageCandidates)) {
    failProtocol(`${label}.packageCandidates must be an array.`)
  }
  record.packageCandidates.forEach((candidate, index) =>
    validatePackageSummary(candidate, academyId,
      `${label}.packageCandidates[${index}]`, {
        candidate: true,
        allowAcademyMismatch: true,
      })
  )
  assertSameValue(
    record.documentPresence.packages,
    record.packageCandidates.map((candidate) => ({
      academyId: candidate.academyId,
      academyScoped: candidate.academyScoped,
      exists: candidate.exists,
      id: candidate.id,
    })),
    `${label} package presence and candidates disagree.`
  )
  assertExactKeys(record.teacher, schema.teacherKeys, `${label}.teacher`)
  for (const family of schema.documentFamilyKeys) {
    validatePersistedTeacher(record.teacher[family],
      `${label}.teacher.${family}`)
  }
  if (!Array.isArray(record.teacher.matchedMemberships)) {
    failProtocol(`${label}.teacher.matchedMemberships must be an array.`)
  }
  record.teacher.matchedMemberships.forEach((membership, index) =>
    validateMembershipSummary(
      membership,
      academyId,
      `${label}.teacher.matchedMemberships[${index}]`
    )
  )
  validateOccurrenceProvenance(record.provenance, `${label}.provenance`)
  validateStatusDeduction(record.statusDeduction, `${label}.statusDeduction`)
  validateSchedule(record.schedule, `${label}.schedule`)
  validateLedgerTargeting(record.ledgerTargeting, `${label}.ledgerTargeting`)
  if (!Array.isArray(record.credits)) failProtocol(`${label}.credits must be an array.`)
  record.credits.forEach((credit, index) =>
    validateCreditEvidenceRecord(
      credit,
      academyId,
      `${label}.credits[${index}]`,
      { allowAcademyMismatch: true }
    )
  )
  const creditPresence = new Map(
    record.documentPresence.credits.map((entry) => [entry.id, entry])
  )
  for (const credit of record.credits) {
    const presence = creditPresence.get(credit.id)
    if (
      !presence?.exists ||
      presence.academyScoped !== credit.academyScoped ||
      presence.academyId !== credit.academyId
    ) {
      failProtocol(`${label} embedded credit scope disagrees with presence.`)
    }
  }
  if (
    record.credits.some((credit) => !record.creditIds.includes(credit.id)) ||
    record.documentPresence.credits.some(
      (entry) => entry.exists &&
        !record.credits.some((credit) => credit.id === entry.id)
    )
  ) {
    failProtocol(`${label} embedded credit records are incomplete.`)
  }
  assertRecordFingerprint(record, label)
}

export function validateRemediationEvidenceRecord(record, {
  academyId,
  scanFamily,
  label = 'evidence record',
}) {
  assertPlainObject(record, label)
  if (['lessons', 'reservations', 'slots'].includes(scanFamily)) {
    validateOccurrenceEvidenceRecord(record, academyId, scanFamily, label)
  } else if (scanFamily === 'credits') {
    validateCreditEvidenceRecord(record, academyId, label)
  } else if (scanFamily === 'memberships') {
    validateMembershipSummary(record, academyId, label, { fingerprint: true })
  } else if (scanFamily === 'packages') {
    validatePackageSummary(record, academyId, label, { fingerprint: true })
  } else {
    failProtocol('Evidence scan family is unsupported.')
  }
  return record
}

export function validateRemediationEvidencePage(result, {
  academyId,
  scanFamily,
}) {
  assertExactKeys(result, EVIDENCE_RESULT_FIELDS, 'evidence result')
  if (
    result.evidenceVersion !== REMEDIATION_EVIDENCE_VERSION ||
    result.academyId !== academyId ||
    result.scanFamily !== scanFamily ||
    result.dryRun !== true ||
    result.previewOnly !== true ||
    result.commit !== false
  ) {
    failProtocol('Evidence callable returned an invalid protocol response.')
  }
  const expectedSchemaDigest = remediationEvidenceSchemaDigest()
  if (result.schemaDigest !== expectedSchemaDigest) {
    failProtocol('Evidence schema digest mismatch.')
  }
  if (!Array.isArray(result.records)) {
    failProtocol('evidence result.records must be an array.')
  }
  result.records.forEach((record, index) =>
    validateRemediationEvidenceRecord(record, {
      academyId,
      scanFamily,
      label: `evidence result.records[${index}]`,
    })
  )
  assertExactKeys(result.page, EVIDENCE_PAGE_FIELDS, 'evidence page')
  const page = result.page
  for (const field of [
    'pageSize',
    'returnedCount',
    'scannedCount',
    'omittedCount',
  ]) {
    assertSafeInteger(page[field], `evidence page.${field}`)
  }
  for (const field of ['hasMore', 'complete', 'truncated']) {
    assertBoolean(page[field], `evidence page.${field}`)
  }
  if (
    page.pageSize < 1 ||
    page.pageSize > PAGE_LIMIT ||
    page.returnedCount !== result.records.length ||
    page.scannedCount !== result.records.length ||
    page.scannedCount !== page.returnedCount ||
    page.returnedCount > page.pageSize ||
    page.omittedCount < 0 ||
    (page.hasMore && page.complete) ||
    (page.hasMore && (
      typeof page.nextCursor !== 'string' ||
      !page.nextCursor ||
      page.nextCursor.length > 2048 ||
      !OPAQUE_CURSOR.test(page.nextCursor)
    )) ||
    (!page.hasMore && page.nextCursor !== null)
  ) {
    failProtocol('Evidence page metadata is inconsistent.')
  }
  assertDigest(result.pageDigest, 'evidence result.pageDigest')
  if (result.pageDigest !== remediationEvidencePageDigest(result)) {
    failProtocol('Evidence page digest mismatch.')
  }
  if (
    page.truncated ||
    page.omittedCount > 0 ||
    (!page.hasMore && page.complete !== true)
  ) {
    throw new RemediationEvidenceIncompleteError(
      'Evidence scan is incomplete.'
    )
  }
  return result
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
  const rootType = rootFamilyDocumentType(record?.rootFamily)
  return uniqueStrings([
    typedOccurrenceKey(record?.occurrenceKey),
    buildTypedDocumentKey(rootType, record?.rootId),
    record?.lessonId
      ? buildTypedDocumentKey('lesson', record.lessonId)
      : null,
    record?.reservationId
      ? buildTypedDocumentKey('reservation', record.reservationId)
      : null,
    record?.slotId
      ? buildTypedDocumentKey('slot', record.slotId)
      : null,
  ])
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
      groups.push({
        record,
        ids: new Set(recordIds),
      })
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
    const key = buildTypedDocumentKey('credit', record.id)
    const existing = result.get(key)
    if (existing && stableStringify(existing) !== stableStringify(record)) {
      failProtocol(`credit record ${record.id} changed within one audit run.`)
    }
    result.set(key, record)
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

function evidenceCreditHasFixedProvenance(record) {
  return normalizeString(record?.sourceType).toLowerCase() ===
      'fixedprivatereservation' ||
    normalizeString(record?.actionType).toLowerCase().startsWith(
      'fixed_private_'
    ) ||
    record?.fixedPrivateDeductionLedger === 'reservation_v1'
}

function evidenceCreditIsAuditRelevant(record) {
  return Boolean(
    evidenceCreditTypedTargets(record).length > 0 ||
    evidenceCreditHasFixedProvenance(record)
  )
}

function isEvidenceDeductionCredit(record) {
  const actionType = normalizeString(record?.actionType).toLowerCase()
  return evidenceCreditHasFixedProvenance(record) ||
    Number(record?.deltaCount) < 0 ||
    (
      actionType.includes('deduct') &&
      !actionType.includes('reversal') &&
      !actionType.includes('reverse')
    )
}

function auditCreditTypedTargets(credit) {
  return uniqueStrings([
    credit?.sourceId
      ? buildTypedDocumentKey('reservation', credit.sourceId)
      : null,
    credit?.lessonId
      ? buildTypedDocumentKey('lesson', credit.lessonId)
      : null,
    credit?.slotId
      ? buildTypedDocumentKey('slot', credit.slotId)
      : null,
  ])
}

function evidenceCreditTypedTargets(credit) {
  const targeting = credit?.targeting || {}
  return uniqueStrings([
    ...['sourceId', 'reservationId', 'linkedReservationId'].map((field) =>
      targeting[field]
        ? buildTypedDocumentKey('reservation', targeting[field])
        : null
    ),
    ...['lessonId', 'fixedLessonId', 'linkedLessonId'].map((field) =>
      targeting[field]
        ? buildTypedDocumentKey('lesson', targeting[field])
        : null
    ),
    ...['slotId', 'linkedSlotId'].map((field) =>
      targeting[field]
        ? buildTypedDocumentKey('slot', targeting[field])
        : null
    ),
  ])
}

function creditBelongsToOccurrence(credit, occurrence) {
  const occurrenceIds = new Set(occurrenceIdentityIds(occurrence))
  return auditCreditTypedTargets(credit).some((id) => occurrenceIds.has(id))
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
    const packageKey = buildTypedDocumentKey('package', occurrence.packageId)
    const rows = byPackage.get(packageKey) || []
    rows.push(occurrence)
    byPackage.set(packageKey, rows)
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
      .filter((row) =>
        row.packageId &&
        buildTypedDocumentKey('package', row.packageId) ===
          buildTypedDocumentKey('package', rows[0].packageId)
      )
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

function sortedBlockingCategories(categories) {
  const order = new Map(AUDIT_BLOCKER_CATEGORIES.map((category, index) => [
    category,
    index,
  ]))
  return [...new Set(categories)].sort(
    (left, right) => order.get(left) - order.get(right)
  )
}

function occurrenceEvidenceFlags(occurrence, {
  active,
  terminal,
  singleConsistentCredit,
  teacherDiagnostic,
}) {
  const hasAllLinkedDocuments = ['lesson', 'reservation', 'slot'].every(
    (family) => occurrence.exists?.[family] === true
  )
  const allFixedFamilies = ['lesson', 'reservation', 'slot'].every(
    (family) => occurrence.fixedFamilies?.[family] === true
  )
  const packageReferencePresent =
    normalizeString(occurrence.packageId) !== '' &&
    occurrence.exists?.package === true
  const linkageEvidenceComplete =
    hasAllLinkedDocuments &&
    allFixedFamilies &&
    packageReferencePresent &&
    normalizeString(occurrence.studentId) !== '' &&
    occurrence.diagnostics?.linkMismatch !== true &&
    occurrence.diagnostics?.missingLinkedDocument !== true &&
    occurrence.diagnostics?.academyMismatch !== true &&
    occurrence.diagnostics?.studentMismatch !== true &&
    occurrence.diagnostics?.packageMismatch !== true &&
    occurrence.diagnostics?.packageMissing !== true &&
    (occurrence.diagnosticReasons?.rowFlags || []).length === 0
  return {
    activeLifecycle: active,
    terminalLifecycle: terminal,
    hasAllLinkedDocuments,
    allFixedFamilies,
    packageReferencePresent,
    teacherMappingResolved: !teacherDiagnostic,
    singleConsistentDeductionEvidence: singleConsistentCredit,
    linkageEvidenceComplete,
  }
}

function aggregateAuditPagesWithEvidence(pagesByFamily) {
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
  const occurrenceEvidence = []
  const unmatchedEvidence = []

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
          const membershipKey = buildTypedDocumentKey(
            'membership',
            record.membershipKey
          )
          const existing = membershipMap.get(membershipKey)
          if (existing && stableStringify(existing) !== stableStringify(record)) {
            failProtocol(`membership ${record.membershipKey} changed within one audit run.`)
          }
          membershipMap.set(membershipKey, record)
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
  const creditOwners = new Map()
  for (const credit of credits.filter(isDeductionCredit)) {
    const targets = auditCreditTypedTargets(credit)
    const matches = occurrences.filter((occurrence) => {
      const identityIds = new Set(occurrenceIdentityIds(occurrence))
      return targets.some((target) => identityIds.has(target))
    })
    if (matches.length > 1) {
      failProtocol('Credit has ambiguous typed occurrence attribution.')
    }
    if (matches.length === 1) {
      creditOwners.set(
        buildTypedDocumentKey('credit', credit.id),
        matches[0].occurrenceKey
      )
    }
  }
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

    const deductionCredits = credits.filter((credit) =>
      isDeductionCredit(credit) &&
      creditOwners.get(buildTypedDocumentKey('credit', credit.id)) ===
        occurrence.occurrenceKey
    )
    deductionCredits.forEach((credit) =>
      matchedCreditIds.add(buildTypedDocumentKey('credit', credit.id))
    )
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
    occurrenceEvidence.push({
      occurrenceKey: occurrence.occurrenceKey,
      blockingCategories: sortedBlockingCategories(blockers),
      currentLedgerMode: occurrence.provenance.ledgerMode,
      originMode: occurrence.provenance.originMode,
      legacyPartitionState: partitionState || 'not_legacy_origin',
      evidenceFlags: occurrenceEvidenceFlags(occurrence, {
        active,
        terminal,
        singleConsistentCredit,
        teacherDiagnostic,
      }),
    })
  }

  for (const credit of credits) {
    if (
      !isDeductionCredit(credit) ||
      !creditHasFixedProvenance(credit) ||
      matchedCreditIds.has(buildTypedDocumentKey('credit', credit.id))
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
    unmatchedEvidence.push({
      evidenceKey: syntheticOccurrence.occurrenceKey,
      evidenceType: 'unmatched_fixed_deduction_credit',
      blockingCategories: sortedBlockingCategories([
        'conflictingDeductionEvidence',
        'unclassifiableOccurrence',
      ]),
    })
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
  const summary = {
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
  return {
    summary,
    occurrenceEvidence: occurrenceEvidence.sort(
      (left, right) => left.occurrenceKey.localeCompare(right.occurrenceKey)
    ),
    unmatchedEvidence: unmatchedEvidence.sort(
      (left, right) => left.evidenceKey.localeCompare(right.evidenceKey)
    ),
    sourceReconciliation: {
      totals: {
        occurrences: occurrences.length,
        deductionCredits: credits.filter(isDeductionCredit).length,
        activeTeacherMemberships: memberships.length,
      },
      scanFamilies: Object.fromEntries(AUDIT_SCAN_FAMILIES.map((family) => [
        family,
        {
          scannedCount: pagesByFamily[family].reduce(
            (sum, page) => sum + page.page.scannedCount,
            0
          ),
          recordCount: pagesByFamily[family].reduce(
            (sum, page) => sum + page.records.length,
            0
          ),
          datasetDigest: sha256(stableStringify(
            pagesByFamily[family].flatMap((page) =>
              page.records.map((record) =>
                `${record.kind}:${record.auditFingerprint}`
              )
            ).sort()
          )),
        },
      ])),
    },
    rawAuditEvidence: {
      occurrences,
      credits,
      memberships,
      ledgerRows: [...ledgerRows].sort((left, right) =>
        stableStringify(left).localeCompare(stableStringify(right))
      ),
    },
  }
}

export function aggregateAuditPages(pagesByFamily) {
  return aggregateAuditPagesWithEvidence(pagesByFamily).summary
}

const PRIMARY_COHORT_RULES = [
  {
    name: 'financial_conflict_manual_only',
    categories: ['conflictingDeductionEvidence', 'duplicateDeductionCredit'],
  },
  {
    name: 'student_or_package_manual_review',
    categories: ['studentMismatch', 'packageMismatch', 'packageMissing', 'academyMismatch'],
  },
  {
    name: 'structural_missing_link',
    categories: ['missingLinkedDocument', 'orphanFixedReservation', 'orphanFixedSlot'],
  },
  {
    name: 'structural_link_mismatch',
    categories: ['linkMismatch', 'fixedProvenanceMismatch', 'outcomeStatusMismatch'],
  },
  {
    name: 'teacher_mapping_required',
    categories: [
      'teacherOwnershipMissing',
      'teacherOwnershipAmbiguous',
      'teacherIdentityConflict',
    ],
  },
  {
    name: 'unclassifiable_manual_review',
    categories: ['unclassifiableOccurrence', 'legacyUnsafeToConvert'],
  },
]

function classifyPrimaryCohort(evidence) {
  const blockers = new Set(evidence.blockingCategories)
  for (const rule of PRIMARY_COHORT_RULES) {
    if (rule.categories.some((category) => blockers.has(category))) return rule
  }
  if (blockers.size > 0) {
    failProtocol('Occurrence has a blocking category without a primary cohort.')
  }
  if (evidence.legacyPartitionState === 'safely_convertible') {
    return { name: 'safe_convertible', categories: [] }
  }
  return { name: 'safe_other', categories: [] }
}

function classifyRepairability(evidence, primaryCohort) {
  if (primaryCohort === 'financial_conflict_manual_only') {
    return 'financial_manual_review_only'
  }
  if ([
    'student_or_package_manual_review',
    'teacher_mapping_required',
  ].includes(primaryCohort)) {
    return 'manual_mapping_required'
  }
  if (primaryCohort === 'structural_missing_link') {
    return evidence.blockingCategories.some((category) =>
      ['orphanFixedReservation', 'orphanFixedSlot'].includes(category)
    )
      ? 'obsolete_orphan_candidate'
      : 'insufficient_evidence_no_write'
  }
  if (primaryCohort === 'safe_convertible') {
    return evidence.evidenceFlags.linkageEvidenceComplete === true &&
      evidence.evidenceFlags.teacherMappingResolved === true
      ? 'deterministic_repair_candidate'
      : 'insufficient_evidence_no_write'
  }
  if (primaryCohort === 'safe_other') return 'safe_no_repair_required'
  return 'insufficient_evidence_no_write'
}

export function redactedCohortKey({
  redactionKey,
  academyId,
  occurrenceKey,
}) {
  if (
    normalizeString(redactionKey).length < MIN_REDACTION_KEY_LENGTH ||
    !normalizeString(academyId) ||
    !normalizeString(occurrenceKey)
  ) {
    failProtocol('Redacted cohort key input is invalid.')
  }
  return crypto.createHmac('sha256', redactionKey)
    .update(`${academyId}:${occurrenceKey}`)
    .digest('hex')
}

function countEvidenceBy(evidenceRows, field, values) {
  return Object.fromEntries(values.map((value) => [
    value,
    evidenceRows.filter((row) => row[field] === value).length,
  ]))
}

function validateSourceReconciliation(summary, sourceReconciliation) {
  assertPlainObject(sourceReconciliation, 'sourceReconciliation')
  assertExactKeys(
    sourceReconciliation,
    ['scanFamilies', 'totals'],
    'sourceReconciliation'
  )
  assertExactKeys(
    sourceReconciliation.totals,
    ['activeTeacherMemberships', 'deductionCredits', 'occurrences'],
    'sourceReconciliation.totals'
  )
  for (const field of [
    'activeTeacherMemberships',
    'deductionCredits',
    'occurrences',
  ]) {
    assertSafeInteger(
      sourceReconciliation.totals[field],
      `sourceReconciliation.totals.${field}`
    )
    if (sourceReconciliation.totals[field] !== summary.totals[field]) {
      failProtocol('Redacted artifact source total parity failed.')
    }
  }
  assertExactKeys(
    sourceReconciliation.scanFamilies,
    AUDIT_SCAN_FAMILIES,
    'sourceReconciliation.scanFamilies'
  )
  for (const family of AUDIT_SCAN_FAMILIES) {
    const value = sourceReconciliation.scanFamilies[family]
    assertExactKeys(
      value,
      ['datasetDigest', 'recordCount', 'scannedCount'],
      `sourceReconciliation.scanFamilies.${family}`
    )
    assertSafeInteger(
      value.recordCount,
      `sourceReconciliation.scanFamilies.${family}.recordCount`
    )
    assertSafeInteger(
      value.scannedCount,
      `sourceReconciliation.scanFamilies.${family}.scannedCount`
    )
    if (!HEX_64.test(value.datasetDigest)) {
      failProtocol('Redacted artifact source dataset digest is invalid.')
    }
    if (
      value.recordCount !== summary.scanFamilies[family].matchedCount ||
      value.scannedCount !== summary.scanFamilies[family].scannedCount ||
      value.datasetDigest !== summary.scanFamilies[family].datasetDigest
    ) {
      failProtocol('Redacted artifact scan-family record parity failed.')
    }
  }
  return {
    totals: { ...sourceReconciliation.totals },
    scanFamilies: Object.fromEntries(AUDIT_SCAN_FAMILIES.map((family) => [
      family,
      { ...sourceReconciliation.scanFamilies[family] },
    ])),
  }
}

export function buildRedactedCohortArtifact({
  summary,
  occurrenceEvidence,
  unmatchedEvidence,
  sourceReconciliation,
  academyId,
  redactionKey,
}) {
  if (!Array.isArray(occurrenceEvidence) || !Array.isArray(unmatchedEvidence)) {
    failProtocol('Record evidence is unavailable for redacted artifact.')
  }
  const occurrenceKeys = occurrenceEvidence.map((row) =>
    normalizeString(row.occurrenceKey)
  )
  if (
    occurrenceKeys.some((key) => !key) ||
    new Set(occurrenceKeys).size !== occurrenceEvidence.length
  ) {
    failProtocol('Redacted artifact occurrence keys are not unique.')
  }
  if (occurrenceEvidence.length !== summary.totals.occurrences) {
    failProtocol('Redacted artifact occurrence total mismatch.')
  }
  const unmatchedKeys = unmatchedEvidence.map((row) =>
    normalizeString(row.evidenceKey)
  )
  if (
    unmatchedKeys.some((key) => !key) ||
    new Set(unmatchedKeys).size !== unmatchedEvidence.length ||
    new Set([...occurrenceKeys, ...unmatchedKeys]).size !==
      occurrenceKeys.length + unmatchedKeys.length
  ) {
    failProtocol('Redacted artifact non-occurrence evidence keys are invalid.')
  }
  const sourceCounts = validateSourceReconciliation(
    summary,
    sourceReconciliation
  )

  const categoryCounts = categoryMapFor(AUDIT_BLOCKER_CATEGORIES)
  const primaryCohortCounts = categoryMapFor(REDACTED_PRIMARY_COHORTS)
  const currentLedgerCounts = countEvidenceBy(
    occurrenceEvidence,
    'currentLedgerMode',
    ['canonical', 'legacy', 'inconsistent']
  )
  const originCounts = countEvidenceBy(
    occurrenceEvidence,
    'originMode',
    ['born_canonical', 'converted_legacy', 'legacy_unconverted', 'unknown']
  )
  const legacyPartitionCounts = countEvidenceBy(
    occurrenceEvidence,
    'legacyPartitionState',
    ['already_converted', 'terminal_unconverted', 'safely_convertible', 'unsafe']
  )
  const cohortKeySet = new Set()
  let safeOccurrences = 0
  let blockedOccurrences = 0
  const addBlockingCategories = (categories) => {
    const blockingCategories = sortedBlockingCategories(categories)
    for (const category of blockingCategories) {
      if (!AUDIT_BLOCKER_CATEGORIES.includes(category)) {
        failProtocol('Redacted artifact contains an unknown blocking category.')
      }
      categoryCounts[category] += 1
    }
    return blockingCategories
  }
  const addCohortKey = (rawKey) => {
    const cohortKey = redactedCohortKey({
      redactionKey,
      academyId,
      occurrenceKey: rawKey,
    })
    if (cohortKeySet.has(cohortKey)) {
      failProtocol('Redacted artifact cohort key collision.')
    }
    cohortKeySet.add(cohortKey)
    return cohortKey
  }

  const occurrences = occurrenceEvidence.map((evidence) => {
    const blockingCategories = addBlockingCategories(evidence.blockingCategories)
    const blocked = blockingCategories.length > 0
    if (blocked) blockedOccurrences += 1
    else safeOccurrences += 1
    const rule = classifyPrimaryCohort({
      ...evidence,
      blockingCategories,
    })
    primaryCohortCounts[rule.name] += 1
    return {
      cohortKey: addCohortKey(evidence.occurrenceKey),
      primaryCohort: rule.name,
      secondaryCategories: blockingCategories.filter(
        (category) => !rule.categories.includes(category)
      ),
      blockingCategories,
      currentLedgerMode: evidence.currentLedgerMode,
      originMode: evidence.originMode,
      legacyPartitionState: evidence.legacyPartitionState,
      repairability: classifyRepairability(evidence, rule.name),
      evidenceFlags: { ...evidence.evidenceFlags },
    }
  }).sort((left, right) => left.cohortKey.localeCompare(right.cohortKey))

  const nonOccurrenceEvidence = unmatchedEvidence.map((evidence) => {
    if (evidence.evidenceType !== 'unmatched_fixed_deduction_credit') {
      failProtocol('Redacted artifact contains an unknown evidence type.')
    }
    return {
      cohortKey: addCohortKey(evidence.evidenceKey),
      evidenceType: evidence.evidenceType,
      blockingCategories: addBlockingCategories(evidence.blockingCategories),
      repairability: 'financial_manual_review_only',
    }
  }).sort((left, right) => left.cohortKey.localeCompare(right.cohortKey))

  const rawBlockingCategoryCount = Object.values(categoryCounts).reduce(
    (sum, value) => sum + value,
    0
  )
  const totalOccurrences = occurrences.length
  const primaryTotal = Object.values(primaryCohortCounts).reduce(
    (sum, value) => sum + value,
    0
  )
  const blockedPrimaryTotal = PRIMARY_COHORT_RULES.reduce(
    (sum, rule) => sum + primaryCohortCounts[rule.name],
    0
  )
  if (
    safeOccurrences + blockedOccurrences !== totalOccurrences ||
    primaryTotal !== totalOccurrences ||
    blockedPrimaryTotal !== blockedOccurrences ||
    rawBlockingCategoryCount !== summary.blockerTotal
  ) {
    failProtocol('Redacted artifact occurrence reconciliation failed.')
  }
  for (const category of AUDIT_BLOCKER_CATEGORIES) {
    if (categoryCounts[category] !== summary.counts[category]) {
      failProtocol('Redacted artifact category parity failed.')
    }
  }
  if (
    currentLedgerCounts.canonical !== summary.counts.currentCanonicalLedgerTotal ||
    currentLedgerCounts.legacy !== summary.counts.currentLegacyLedgerTotal ||
    currentLedgerCounts.inconsistent !==
      summary.counts.currentUnknownOrMixedLedgerTotal ||
    originCounts.born_canonical !== summary.counts.bornCanonicalTotal ||
    (
      originCounts.converted_legacy +
      originCounts.legacy_unconverted +
      occurrenceEvidence.filter((row) =>
        row.originMode === 'unknown' &&
        row.legacyPartitionState !== 'not_legacy_origin'
      ).length
    ) !== summary.counts.legacyOriginTotal ||
    legacyPartitionCounts.already_converted !==
      summary.counts.legacyAlreadyConverted ||
    legacyPartitionCounts.terminal_unconverted !== summary.counts.legacyTerminal ||
    legacyPartitionCounts.safely_convertible !==
      summary.counts.legacySafelyConvertible ||
    legacyPartitionCounts.unsafe !== summary.counts.legacyUnsafeToConvert
  ) {
    failProtocol('Redacted artifact inventory parity failed.')
  }
  const expectedUnknownOrigin = occurrenceEvidence.filter((row) =>
    row.originMode === 'unknown' &&
    row.legacyPartitionState === 'not_legacy_origin'
  ).length
  if (expectedUnknownOrigin !== summary.counts.unknownOriginTotal) {
    failProtocol('Redacted artifact origin partition failed.')
  }

  const allBlockingEvidence = [
    ...occurrenceEvidence,
    ...unmatchedEvidence,
  ]
  const overlapCounts = {}
  for (let leftIndex = 0; leftIndex < AUDIT_BLOCKER_CATEGORIES.length; leftIndex++) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < AUDIT_BLOCKER_CATEGORIES.length;
      rightIndex++
    ) {
      const left = AUDIT_BLOCKER_CATEGORIES[leftIndex]
      const right = AUDIT_BLOCKER_CATEGORIES[rightIndex]
      overlapCounts[`${left}&${right}`] = allBlockingEvidence.filter((row) => {
        const categories = new Set(row.blockingCategories)
        return categories.has(left) && categories.has(right)
      }).length
    }
  }

  return {
    artifactVersion: REDACTED_ARTIFACT_VERSION,
    auditVersion: AUDIT_VERSION,
    project: PRODUCTION_PROJECT_ID,
    academy: 'REDACTED',
    completedRuns: summary.completedRuns,
    consistency: summary.consistency,
    runDigests: [...summary.runDigests],
    summary: {
      totalOccurrences,
      safeOccurrences,
      blockedOccurrences,
      rawBlockingCategoryCount,
      nonOccurrenceEvidenceCount: nonOccurrenceEvidence.length,
    },
    sourceCounts,
    primaryCohortCounts,
    categoryCounts,
    overlapCounts,
    occurrences,
    nonOccurrenceEvidence,
  }
}

export function validateRedactedArtifactEnvironment(env) {
  const outputPath = normalizeString(env.AUDIT_REDACTED_OUTPUT)
  const redactionKey = normalizeString(env.AUDIT_REDACTION_KEY)
  if (!outputPath && !redactionKey) return null
  if (!outputPath || !redactionKey) {
    throw new Error(
      'AUDIT_REDACTED_OUTPUT and AUDIT_REDACTION_KEY must be provided together.'
    )
  }
  if (!path.isAbsolute(outputPath)) {
    throw new Error('AUDIT_REDACTED_OUTPUT must be an absolute path.')
  }
  if (redactionKey.length < MIN_REDACTION_KEY_LENGTH) {
    throw new Error(
      `AUDIT_REDACTION_KEY must be at least ${MIN_REDACTION_KEY_LENGTH} characters.`
    )
  }
  const resolvedOutputPath = path.resolve(outputPath)
  if (fs.existsSync(resolvedOutputPath)) {
    throw new Error('AUDIT_REDACTED_OUTPUT must not already exist.')
  }
  const parent = path.dirname(resolvedOutputPath)
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new Error('AUDIT_REDACTED_OUTPUT parent directory must exist.')
  }
  return {
    outputPath: resolvedOutputPath,
    redactionKey,
  }
}

function pathHasGitSegment(value) {
  return path.resolve(value).split(path.sep).includes('.git')
}

function pathIsWithin(candidate, parent) {
  const relative = path.relative(parent, candidate)
  return relative === '' || (
    relative !== '..' &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  )
}

function lstatIfPresent(value) {
  try {
    return fs.lstatSync(value)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

function findAncestorRepository(startPath) {
  let current = startPath
  while (true) {
    if (lstatIfPresent(path.join(current, '.git'))) return current
    const parent = path.dirname(current)
    if (parent === current) return ''
    current = parent
  }
}

export function validateSensitiveRemediationEnvironment(
  env,
  { repositoryRoot = RUNNER_REPOSITORY_ROOT } = {}
) {
  const hasSensitiveOutput = Object.prototype.hasOwnProperty.call(
    env,
    'AUDIT_SENSITIVE_REMEDIATION_OUTPUT'
  )
  const hasSensitiveConfirmation = Object.prototype.hasOwnProperty.call(
    env,
    'CONFIRM_SENSITIVE_LOCAL_REMEDIATION_MANIFEST'
  )
  if (!hasSensitiveOutput && !hasSensitiveConfirmation) return null

  const outputPath = normalizeString(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT)
  const confirmation = env.CONFIRM_SENSITIVE_LOCAL_REMEDIATION_MANIFEST
  const redactedOutput = normalizeString(env.AUDIT_REDACTED_OUTPUT)
  const redactionKey = normalizeString(env.AUDIT_REDACTION_KEY)
  if (
    !outputPath ||
    confirmation !== 'YES' ||
    !redactedOutput ||
    !redactionKey
  ) {
    throw new Error(
      'Sensitive remediation output requires AUDIT_SENSITIVE_REMEDIATION_OUTPUT, ' +
      'CONFIRM_SENSITIVE_LOCAL_REMEDIATION_MANIFEST=YES, ' +
      'AUDIT_REDACTED_OUTPUT, and AUDIT_REDACTION_KEY.'
    )
  }
  if (!path.isAbsolute(outputPath)) {
    throw new Error('AUDIT_SENSITIVE_REMEDIATION_OUTPUT must be an absolute path.')
  }
  const resolvedOutputPath = path.resolve(outputPath)
  if (pathHasGitSegment(resolvedOutputPath)) {
    throw new Error('Sensitive remediation output must not target .git.')
  }
  if (lstatIfPresent(resolvedOutputPath)) {
    throw new Error(
      'AUDIT_SENSITIVE_REMEDIATION_OUTPUT must not already exist or be a symlink.'
    )
  }
  const parent = path.dirname(resolvedOutputPath)
  const parentStat = lstatIfPresent(parent)
  if (!parentStat?.isDirectory()) {
    throw new Error(
      'AUDIT_SENSITIVE_REMEDIATION_OUTPUT parent directory must exist.'
    )
  }
  const realParent = fs.realpathSync(parent)
  if (path.resolve(parent) !== realParent || pathHasGitSegment(realParent)) {
    throw new Error(
      'Sensitive remediation output parent must not use symlinks or .git.'
    )
  }
  const realCandidate = path.join(realParent, path.basename(resolvedOutputPath))
  const resolvedRepositoryRoot = path.resolve(repositoryRoot)
  const realRepositoryRoot = fs.realpathSync(resolvedRepositoryRoot)
  if (
    pathIsWithin(resolvedOutputPath, resolvedRepositoryRoot) ||
    pathIsWithin(realCandidate, realRepositoryRoot) ||
    findAncestorRepository(realParent)
  ) {
    throw new Error(
      'Sensitive remediation output must be outside every repository or worktree.'
    )
  }
  if (resolvedOutputPath === path.resolve(redactedOutput)) {
    throw new Error('Sensitive and redacted output paths must be different.')
  }
  return {
    outputPath: resolvedOutputPath,
    redactionKey,
  }
}

export async function writeRedactedCohortArtifact(outputPath, artifact) {
  const parent = path.dirname(outputPath)
  const temporaryPath = path.join(
    parent,
    `.${path.basename(outputPath)}.${process.pid}.` +
      `${crypto.randomBytes(12).toString('hex')}.tmp`
  )
  let handle
  try {
    handle = await fs.promises.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(artifact, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.chmod(temporaryPath, 0o600)
    await fs.promises.rename(temporaryPath, outputPath)
  } catch {
    if (handle) await handle.close().catch(() => {})
    await fs.promises.unlink(temporaryPath).catch(() => {})
    throw new Error('Redacted cohort artifact write failed.')
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
  const redactedArtifact = validateRedactedArtifactEnvironment(env)
  const sensitiveRemediation = validateSensitiveRemediationEnvironment(env)
  return {
    academyId: env.ACADEMY_ID,
    token: env.FIREBASE_ID_TOKEN,
    redactedArtifact,
    sensitiveRemediation,
  }
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
  return aggregateAuditPagesWithEvidence(pagesByFamily)
}

async function callRemediationEvidencePage({
  fetchImpl,
  token,
  academyId,
  scanFamily,
  cursor,
}) {
  const response = await fetchImpl(REMEDIATION_EVIDENCE_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        evidenceVersion: REMEDIATION_EVIDENCE_VERSION,
        academyId,
        scanFamily,
        limit: PAGE_LIMIT,
        cursor,
        purpose: REMEDIATION_EVIDENCE_PURPOSE,
        dryRun: true,
        previewOnly: true,
        commit: false,
      },
    }),
  })
  if (!response?.ok) {
    throw new Error(
      `Evidence callable failed with HTTP ${response?.status || 'unknown'}.`
    )
  }
  let body
  try {
    body = await response.json()
  } catch {
    failProtocol('Evidence callable returned malformed JSON.')
  }
  if (body?.error || !Object.prototype.hasOwnProperty.call(body || {}, 'result')) {
    failProtocol('Evidence callable returned an error envelope.')
  }
  return validateRemediationEvidencePage(body.result, {
    academyId,
    scanFamily,
  })
}

function evidenceRecordUniqueKey(record) {
  return record.kind === 'occurrence'
    ? `${record.kind}:${record.rootId}`
    : `${record.kind}:${record.id}`
}

export function evidenceVariantIdentityIds(record) {
  const identities = [
    typedOccurrenceKey(record.occurrenceKey),
    buildTypedDocumentKey(
      rootFamilyDocumentType(record.rootFamily),
      record.rootId
    ),
  ]
  for (const targetType of ['lesson', 'reservation', 'slot']) {
    const resolvedId = record.resolvedLinks?.[`${targetType}Id`]
    if (resolvedId) {
      identities.push(buildTypedDocumentKey(targetType, resolvedId))
    }
  }
  return uniqueStrings(identities)
}

function collapseEvidenceVariantGroups(records) {
  const groups = []
  const familyOrder = new Map(
    ['lessons', 'reservations', 'slots'].map((family, index) => [family, index])
  )
  const sorted = [...records].sort((left, right) =>
    familyOrder.get(left.rootFamily) - familyOrder.get(right.rootFamily) ||
    left.rootId.localeCompare(right.rootId)
  )
  for (const record of sorted) {
    const ids = evidenceVariantIdentityIds(record)
    const matchingIndexes = groups
      .map((group, index) => ids.some((id) => group.ids.has(id)) ? index : -1)
      .filter((index) => index >= 0)
    if (matchingIndexes.length === 0) {
      groups.push({ ids: new Set(ids), variants: [record] })
      continue
    }
    const target = groups[matchingIndexes[0]]
    target.variants.push(record)
    ids.forEach((id) => target.ids.add(id))
    for (const index of matchingIndexes.slice(1).reverse()) {
      const source = groups[index]
      target.variants.push(...source.variants)
      source.ids.forEach((id) => target.ids.add(id))
      groups.splice(index, 1)
    }
  }
  return groups.map((group) => {
    const identityIds = [...group.ids].sort()
    const variants = group.variants.sort((left, right) =>
      familyOrder.get(left.rootFamily) - familyOrder.get(right.rootFamily) ||
      left.rootId.localeCompare(right.rootId)
    )
    const occurrenceKeys = uniqueStrings(
      variants.map((variant) => variant.occurrenceKey)
    )
    if (
      occurrenceKeys.length !== 1 ||
      !identityIds.includes(occurrenceKeys[0])
    ) {
      failProtocol('Evidence identity group has an invalid occurrence key.')
    }
    return {
      groupKey: sha256(stableStringify(identityIds)),
      identityIds,
      occurrenceKey: occurrenceKeys[0],
      variants,
    }
  }).sort((left, right) => left.groupKey.localeCompare(right.groupKey))
}

function aggregateRemediationEvidencePages(pagesByFamily) {
  const recordsByFamily = {}
  const familyDigests = {}
  const occurrenceGroups = new Map()
  let totalRecords = 0

  for (const family of REMEDIATION_EVIDENCE_SCAN_FAMILIES) {
    const pages = pagesByFamily?.[family]
    if (!Array.isArray(pages) || pages.length === 0) {
      failProtocol(`Evidence scan family ${family} has no pages.`)
    }
    if (
      pages.some((page) => page.page.truncated || page.page.omittedCount > 0) ||
      pages.at(-1).page.complete !== true ||
      pages.at(-1).page.hasMore !== false
    ) {
      failProtocol(`Evidence scan family ${family} is incomplete.`)
    }
    const recordMap = new Map()
    for (const record of pages.flatMap((page) => page.records)) {
      const key = evidenceRecordUniqueKey(record)
      const existing = recordMap.get(key)
      if (existing && existing.auditFingerprint !== record.auditFingerprint) {
        failProtocol(
          `Evidence scan family ${family} contains a conflicting duplicate.`
        )
      }
      recordMap.set(key, record)
    }
    const records = [...recordMap.values()].sort((left, right) =>
      evidenceRecordUniqueKey(left).localeCompare(evidenceRecordUniqueKey(right))
    )
    totalRecords += records.length
    if (totalRecords > MAX_RECORDS_PER_RUN) {
      failProtocol('Evidence exceeded the record safety bound.')
    }
    recordsByFamily[family] = records
    familyDigests[family] = sha256(stableStringify({
      schemaDigest: remediationEvidenceSchemaDigest(),
      pages: pages.map((page) => ({
        page: page.page,
        pageDigest: page.pageDigest,
        recordFingerprints: page.records.map((record) =>
          record.auditFingerprint
        ),
      })),
    }))
    if (['lessons', 'reservations', 'slots'].includes(family)) {
      for (const record of records.filter(
        (candidate) => candidate.provenance.classifier.isFixed === true
      )) {
        occurrenceGroups.set(
          `${record.rootFamily}:${record.rootId}`,
          record
        )
      }
    }
  }

  const occurrences = collapseEvidenceVariantGroups(
    [...occurrenceGroups.values()]
  )
  const rawOccurrenceSet = occurrences.map((group) => group.groupKey)
  const uniqueRecordMap = (records, label, documentType) => {
    const result = new Map()
    for (const record of records) {
      const key = buildTypedDocumentKey(documentType, record.id)
      if (result.has(key)) {
        failProtocol(`${label} contains duplicate document ids.`)
      }
      result.set(key, record)
    }
    return result
  }
  const creditMap = uniqueRecordMap(
    recordsByFamily.credits,
    'Credit evidence',
    'credit'
  )
  const membershipMap = uniqueRecordMap(
    recordsByFamily.memberships,
    'Membership evidence',
    'membership'
  )
  const packageMap = uniqueRecordMap(
    recordsByFamily.packages,
    'Package evidence',
    'package'
  )
  const creditOwners = new Map()
  for (const credit of creditMap.values()) {
    if (
      credit.academyScoped !== true ||
      !isEvidenceDeductionCredit(credit)
    ) {
      continue
    }
    const targets = evidenceCreditTypedTargets(credit)
    const matches = occurrences.filter((occurrence) =>
      targets.some((target) => occurrence.identityIds.includes(target))
    )
    if (matches.length > 1) {
      failProtocol('Credit has ambiguous typed occurrence attribution.')
    }
    if (matches.length === 1) {
      creditOwners.set(
        buildTypedDocumentKey('credit', credit.id),
        matches[0].groupKey
      )
      const studentIds = uniqueStrings(matches[0].variants.flatMap(
        (variant) => variant.studentCandidateIds
      ))
      const packageIds = uniqueStrings(matches[0].variants.flatMap(
        (variant) => variant.packageCandidateIds
      ))
      if (
        (credit.studentId && !studentIds.includes(credit.studentId)) ||
        (credit.packageId && !packageIds.includes(credit.packageId))
      ) {
        matches[0].conflictingCreditEvidence = true
      }
    }
  }
  const joins = new Map()
  const addJoin = (map, entry, label) => {
    const existing = map.get(entry.id)
    if (existing && stableStringify(existing) !== stableStringify(entry)) {
      failProtocol(`${label} disagrees across evidence variants.`)
    }
    map.set(entry.id, entry)
  }
  for (const occurrence of occurrences) {
    const occurrenceLabel = 'Evidence occurrence'
    const packageIds = new Set()
    const creditIds = new Set()
    const membershipIds = new Set()
    const studentIds = new Set()
    const joinedPackageMap = new Map()
    const joinedCreditMap = new Map()
    const joinedMembershipMap = new Map()
    for (const variant of occurrence.variants) {
      if (
        variant.studentId !==
          (variant.studentCandidateIds.length === 1
            ? variant.studentCandidateIds[0]
            : null) ||
        variant.packageId !==
          (variant.packageCandidateIds.length === 1
            ? variant.packageCandidateIds[0]
            : null)
      ) {
        failProtocol(`${occurrenceLabel} guessed an ambiguous candidate.`)
      }
      variant.studentCandidateIds.forEach((id) => studentIds.add(id))
      variant.packageCandidateIds.forEach((id) => packageIds.add(id))
      variant.membershipIds.forEach((id) => membershipIds.add(id))

      const packageCandidateIds = variant.packageCandidates.map(
        (candidate) => candidate.id
      )
      if (stableStringify(packageCandidateIds) !==
          stableStringify(variant.packageCandidateIds)) {
        failProtocol(`${occurrenceLabel} package candidate ids disagree.`)
      }
      const packagePresence = new Map(
        variant.documentPresence.packages.map(
          (entry) => [entry.id, entry]
        )
      )
      if (stableStringify([...packagePresence.keys()]) !==
          stableStringify(variant.packageCandidateIds)) {
        failProtocol(`${occurrenceLabel} package presence disagrees.`)
      }
      for (const candidate of variant.packageCandidates) {
        const presence = packagePresence.get(candidate.id)
        if (
          presence.exists !== candidate.exists ||
          presence.academyScoped !== candidate.academyScoped ||
          presence.academyId !== candidate.academyId
        ) {
          failProtocol(`${occurrenceLabel} package existence disagrees.`)
        }
        const familyRecord = packageMap.get(
          buildTypedDocumentKey('package', candidate.id)
        )
        if (!candidate.exists) {
          if (familyRecord) {
            failProtocol('Missing package candidate unexpectedly exists.')
          }
          addJoin(joinedPackageMap, {
            academyScoped: null,
            evidence: null,
            exists: false,
            id: candidate.id,
          }, 'Missing package join')
          continue
        }
        if (candidate.academyScoped === true) {
          if (!familyRecord) {
            failProtocol('Same-academy package family evidence is missing.')
          }
          const { kind, auditFingerprint, ...summary } = familyRecord
          const {
            academyScoped,
            exists,
            sources,
            ...candidateSummary
          } = candidate
          assertSameValue(
            candidateSummary,
            summary,
            'Package candidate and family evidence disagree.'
          )
          addJoin(joinedPackageMap, {
            academyScoped: true,
            evidence: familyRecord,
            exists: true,
            id: candidate.id,
          }, 'Package join')
        } else {
          if (familyRecord) {
            failProtocol('Foreign package appeared in academy family evidence.')
          }
          addJoin(joinedPackageMap, {
            academyScoped: false,
            evidence: candidate,
            exists: true,
            id: candidate.id,
          }, 'Package join')
        }
      }

      const matchedMembershipIds = variant.teacher.matchedMemberships.map(
        (membership) => membership.id
      )
      if (stableStringify(matchedMembershipIds) !==
          stableStringify(variant.membershipIds)) {
        failProtocol(`${occurrenceLabel} membership ids disagree.`)
      }
      const membershipPresence = new Map(
        variant.documentPresence.memberships.map(
          (entry) => [entry.id, entry.exists]
        )
      )
      if (
        stableStringify([...membershipPresence.keys()]) !==
          stableStringify(variant.membershipIds) ||
        [...membershipPresence.values()].some((exists) => exists !== true)
      ) {
        failProtocol(`${occurrenceLabel} membership presence disagrees.`)
      }
      for (const membership of variant.teacher.matchedMemberships) {
        const familyRecord = membershipMap.get(
          buildTypedDocumentKey('membership', membership.id)
        )
        if (!familyRecord) {
          failProtocol('Referenced membership evidence is missing.')
        }
        const { kind, auditFingerprint, ...summary } = familyRecord
        assertSameValue(
          membership,
          summary,
          'Membership summary and family evidence disagree.'
        )
        addJoin(joinedMembershipMap, {
          academyScoped: true,
          evidence: familyRecord,
          exists: true,
          id: membership.id,
        }, 'Membership join')
      }

      const embeddedCreditMap = uniqueRecordMap(
        variant.credits,
        'Embedded credit evidence',
        'credit'
      )
      const creditPresence = new Map(
        variant.documentPresence.credits.map(
          (entry) => [entry.id, entry]
        )
      )
      if (stableStringify([...creditPresence.keys()]) !==
          stableStringify(variant.creditIds)) {
        failProtocol(`${occurrenceLabel} credit presence disagrees.`)
      }
      for (const creditId of variant.creditIds) {
        const presence = creditPresence.get(creditId)
        const typedCreditId = buildTypedDocumentKey('credit', creditId)
        const embedded = embeddedCreditMap.get(typedCreditId)
        const familyRecord = creditMap.get(typedCreditId)
        if (!presence.exists) {
          if (embedded || familyRecord) {
            failProtocol('Declared missing credit unexpectedly exists.')
          }
          addJoin(joinedCreditMap, {
            academyScoped: null,
            evidence: null,
            exists: false,
            id: creditId,
          }, 'Missing credit join')
          creditIds.add(creditId)
          continue
        }
        if (!embedded) failProtocol('Embedded credit evidence is missing.')
        if (
          embedded.academyScoped !== presence.academyScoped ||
          embedded.academyId !== presence.academyId
        ) {
          failProtocol('Embedded credit scope disagrees with presence.')
        }
        if (embedded.academyScoped === true) {
          if (!familyRecord) {
            failProtocol('Same-academy credit family evidence is missing.')
          }
          assertSameValue(
            embedded,
            familyRecord,
            'Embedded and family credit evidence disagree.'
          )
          if (
            isEvidenceDeductionCredit(familyRecord) &&
            creditOwners.get(typedCreditId) !== occurrence.groupKey
          ) {
            continue
          }
          addJoin(joinedCreditMap, {
            academyScoped: true,
            evidence: familyRecord,
            exists: true,
            id: creditId,
          }, 'Credit join')
        } else {
          if (familyRecord) {
            failProtocol('Foreign credit appeared in academy family evidence.')
          }
          addJoin(joinedCreditMap, {
            academyScoped: false,
            evidence: embedded,
            exists: true,
            id: creditId,
          }, 'Credit join')
        }
        creditIds.add(creditId)
      }
      if (
        [...embeddedCreditMap.keys()].some((id) =>
          !variant.creditIds.some(
            (creditId) => buildTypedDocumentKey('credit', creditId) === id
          )
        )
      ) {
        failProtocol('Embedded credit evidence contains an unknown record.')
      }
    }
    for (const [typedCreditId, owner] of creditOwners) {
      if (owner !== occurrence.groupKey) continue
      const familyRecord = creditMap.get(typedCreditId)
      if (!familyRecord) {
        failProtocol('Attributed credit family evidence is missing.')
      }
      addJoin(joinedCreditMap, {
        academyScoped: true,
        evidence: familyRecord,
        exists: true,
        id: familyRecord.id,
      }, 'Attributed credit join')
      creditIds.add(familyRecord.id)
    }
    occurrence.studentCandidateIds = [...studentIds].sort()
    occurrence.packageCandidateIds = [...packageIds].sort()
    occurrence.creditIds = [...creditIds].sort()
    occurrence.membershipIds = [...membershipIds].sort()
    occurrence.joins = {
      credits: [...joinedCreditMap.values()].sort((a, b) =>
        a.id.localeCompare(b.id)
      ),
      memberships: [...joinedMembershipMap.values()].sort((a, b) =>
        a.id.localeCompare(b.id)
      ),
      packages: [...joinedPackageMap.values()].sort((a, b) =>
        a.id.localeCompare(b.id)
      ),
    }
    joins.set(occurrence.groupKey, occurrence.joins)
  }
  const embeddedCredits = occurrences.flatMap((occurrence) =>
    occurrence.joins.credits
      .filter((join) => join.exists)
      .map((join) => join.evidence)
  )
  const allCreditMap = new Map()
  for (const record of [
    ...recordsByFamily.credits,
    ...embeddedCredits,
  ]) {
    const typedCreditId = buildTypedDocumentKey('credit', record.id)
    const existing = allCreditMap.get(typedCreditId)
    if (existing &&
        stableStringify(existing) !== stableStringify(record)) {
      failProtocol('Credit evidence disagrees across sources.')
    }
    allCreditMap.set(typedCreditId, record)
  }
  const relevantCredits = [...allCreditMap.values()]
    .filter((record) =>
      record.academyScoped === true &&
      evidenceCreditIsAuditRelevant(record) &&
      isEvidenceDeductionCredit(record)
    )
    .sort((left, right) => left.id.localeCompare(right.id))
  const nonOccurrenceCredits = [...allCreditMap.values()].filter(
    (record) =>
      !creditOwners.has(buildTypedDocumentKey('credit', record.id)) &&
      isEvidenceDeductionCredit(record) &&
      evidenceCreditHasFixedProvenance(record)
  )
  const linksStatusProvenanceDigest = sha256(stableStringify(
    occurrences.map((group) => ({
      groupKey: group.groupKey,
      identityIds: group.identityIds,
      conflictingCreditEvidence: group.conflictingCreditEvidence === true,
      variants: group.variants.map((record) => ({
        auditFingerprint: record.auditFingerprint,
        rootFamily: record.rootFamily,
        rootId: record.rootId,
      })),
    }))
  ))
  const runDigest = sha256(stableStringify({
    familyDigests,
    rawOccurrenceSet,
    linksStatusProvenanceDigest,
    relevantCreditIds: relevantCredits.map((record) => record.id),
  }))
  return {
    recordsByFamily,
    familyDigests,
    occurrences,
    joins,
    relevantCredits,
    nonOccurrenceCredits,
    rawOccurrenceSet,
    linksStatusProvenanceDigest,
    totalRecords,
    runDigest,
  }
}

async function runSingleRemediationEvidence({ fetchImpl, token, academyId }) {
  const pagesByFamily = Object.fromEntries(
    REMEDIATION_EVIDENCE_SCAN_FAMILIES.map((family) => [family, []])
  )
  for (const scanFamily of REMEDIATION_EVIDENCE_SCAN_FAMILIES) {
    let cursor = null
    const seenCursors = new Set()
    while (true) {
      if (pagesByFamily[scanFamily].length >= MAX_PAGES_PER_FAMILY) {
        failProtocol(
          `Evidence scan family ${scanFamily} exceeded the page safety bound.`
        )
      }
      const page = await callRemediationEvidencePage({
        fetchImpl,
        token,
        academyId,
        scanFamily,
        cursor,
      })
      pagesByFamily[scanFamily].push(page)
      if (!page.page.hasMore) break
      const nextCursor = page.page.nextCursor
      if (nextCursor === cursor || seenCursors.has(nextCursor)) {
        failProtocol('Evidence pagination cursor did not advance.')
      }
      seenCursors.add(nextCursor)
      cursor = nextCursor
    }
  }
  return aggregateRemediationEvidencePages(pagesByFamily)
}

function assertSameValue(left, right, message) {
  if (stableStringify(left) !== stableStringify(right)) failProtocol(message)
}

function auditOccurrenceClassification(auditRun, occurrenceKey) {
  const classification = auditRun.occurrenceEvidence.find(
    (row) => row.occurrenceKey === occurrenceKey
  )
  if (!classification) {
    failProtocol('Audit occurrence classification is missing.')
  }
  return classification
}

export function reconcileAuditAndRemediationEvidence({
  auditRun,
  evidenceRun,
  redactedArtifact,
  academyId,
  redactionKey,
}) {
  assertPlainObject(auditRun, 'auditRun')
  assertPlainObject(evidenceRun, 'evidenceRun')
  assertPlainObject(redactedArtifact, 'redactedArtifact')
  const auditOccurrences = auditRun.rawAuditEvidence?.occurrences
  if (!Array.isArray(auditOccurrences)) {
    failProtocol('Raw audit occurrence evidence is unavailable.')
  }
  const auditKeys = auditOccurrences
    .map((record) => record.occurrenceKey)
    .sort()
  if (new Set(auditKeys).size !== auditKeys.length) {
    failProtocol('Audit occurrence keys contain duplicates.')
  }
  if (
    auditKeys.length !== auditRun.summary.totals.occurrences ||
    evidenceRun.occurrences.length !== auditKeys.length ||
    redactedArtifact.occurrences.length !== auditKeys.length
  ) {
    failProtocol('Audit and remediation evidence occurrence counts differ.')
  }
  const redactedByKey = new Map(
    redactedArtifact.occurrences.map((row) => [row.cohortKey, row])
  )
  const reconciledOccurrences = []
  const nullableAuditId = (value) => normalizeString(value) || null

  const matchedGroupKeys = new Set()
  for (const audit of [...auditOccurrences].sort((left, right) =>
    left.occurrenceKey.localeCompare(right.occurrenceKey)
  )) {
    const auditIdentityIds = uniqueStrings([
      typedOccurrenceKey(audit.occurrenceKey),
      nullableAuditId(audit.lessonId)
        ? buildTypedDocumentKey('lesson', audit.lessonId)
        : null,
      nullableAuditId(audit.reservationId)
        ? buildTypedDocumentKey('reservation', audit.reservationId)
        : null,
      nullableAuditId(audit.slotId)
        ? buildTypedDocumentKey('slot', audit.slotId)
        : null,
    ])
    const matches = evidenceRun.occurrences.filter((group) =>
      auditIdentityIds.some((id) => group.identityIds.includes(id))
    )
    if (matches.length !== 1 || matchedGroupKeys.has(matches[0]?.groupKey)) {
      failProtocol(
        'Audit occurrence must match exactly one unused evidence identity group.'
      )
    }
    const evidenceGroup = matches[0]
    if (evidenceGroup.occurrenceKey !== audit.occurrenceKey) {
      failProtocol('Audit and evidence occurrence keys differ.')
    }
    matchedGroupKeys.add(evidenceGroup.groupKey)
    const evidence = {
      ...evidenceGroup,
      occurrenceKey: audit.occurrenceKey,
    }
    const classification = auditOccurrenceClassification(
      auditRun,
      audit.occurrenceKey
    )
    if (
      evidence.conflictingCreditEvidence === true &&
      !classification.blockingCategories.includes(
        'conflictingDeductionEvidence'
      )
    ) {
      failProtocol(
        'Conflicting credit evidence lacks the matching audit blocker.'
      )
    }
    if (audit.studentId &&
        !evidence.studentCandidateIds.includes(audit.studentId)) {
      failProtocol('Audit student id is absent from evidence candidates.')
    }
    if (audit.packageId &&
        !evidence.packageCandidateIds.includes(audit.packageId)) {
      failProtocol('Audit package id is absent from evidence candidates.')
    }
    const classifierParity = evidence.variants.some((variant) =>
      variant.provenance.ledger.mode === audit.provenance.ledgerMode &&
      variant.provenance.origin.originMode === audit.provenance.originMode &&
      variant.provenance.origin.hasLegacyEvidence ===
        audit.provenance.hasLegacyEvidence &&
      variant.provenance.origin.legacyEvidenceConsistent ===
        audit.provenance.legacyEvidenceConsistent
    )
    if (!classifierParity) {
      failProtocol('Audit and evidence ledger/origin classifiers differ.')
    }
    if (evidence.variants.some(
      (variant) => variant.provenance.classifier.isFixed !== true
    )) {
      failProtocol('Manifest occurrence is not fixed-private evidence.')
    }
    const packageCandidates = evidence.variants
      .flatMap((variant) => variant.packageCandidates)
      .filter((candidate) => candidate.id === audit.packageId)
    const existingPackageCandidates = packageCandidates.filter(
      (candidate) => candidate.exists
    )
    const scopedPackageCandidates = existingPackageCandidates.filter(
      (candidate) => candidate.academyScoped === true
    )
    if (
      (audit.exists.package === true &&
        existingPackageCandidates.length === 0) ||
      (audit.exists.package === false &&
        existingPackageCandidates.length > 0)
    ) {
      failProtocol('Audit and evidence package existence differ.')
    }
    if (
      audit.exists.package === true &&
      scopedPackageCandidates.length > 0 &&
      !scopedPackageCandidates.some((candidate) =>
        stableStringify({
          remainingCount: candidate.remainingCount,
          totalCount: candidate.totalCount,
          usedCount: candidate.usedCount,
        }) === stableStringify(audit.packageCounts)
      )
    ) {
      failProtocol('Audit and evidence package counts differ.')
    }
    const auditCredits = auditRun.rawAuditEvidence.credits
      .filter((credit) => creditBelongsToOccurrence(credit, audit))
      .sort((left, right) => left.id.localeCompare(right.id))
    const requiredCreditIds = uniqueStrings([
      ...auditCredits.map((credit) => credit.id),
      ...(audit.deduction?.ids || []),
    ])
    if (requiredCreditIds.some((id) => !evidence.creditIds.includes(id))) {
      failProtocol('Audit credit id is absent from remediation evidence.')
    }
    for (const auditCredit of auditCredits) {
      const joined = evidence.joins.credits.find(
        (entry) => entry.id === auditCredit.id
      )
      const sameAcademy = auditCredit.academyId === academyId
      if (
        !joined?.exists ||
        joined.academyScoped !== sameAcademy ||
        (sameAcademy && joined.evidence?.academyId !== academyId) ||
        (!sameAcademy &&
          joined.evidence?.academyId !== auditCredit.academyId)
      ) {
        failProtocol('Audit and evidence declared credit scopes differ.')
      }
    }
    const cohortKey = redactedCohortKey({
      redactionKey,
      academyId,
      occurrenceKey: audit.occurrenceKey,
    })
    const redacted = redactedByKey.get(cohortKey)
    if (!redacted) failProtocol('Redacted cohort parity failed.')
    if (
      redacted.currentLedgerMode !== classification.currentLedgerMode ||
      redacted.originMode !== classification.originMode ||
      redacted.legacyPartitionState !== classification.legacyPartitionState ||
      stableStringify(redacted.blockingCategories) !==
        stableStringify(classification.blockingCategories)
    ) {
      failProtocol('Redacted and audit occurrence classifications differ.')
    }
    reconciledOccurrences.push({
      audit,
      classification,
      evidence,
      joins: evidenceGroup.joins,
      redacted,
      cohortKey,
    })
  }
  if (matchedGroupKeys.size !== evidenceRun.occurrences.length) {
    failProtocol('Evidence identity group was not matched by the audit.')
  }

  const auditRelevantCredits = auditRun.rawAuditEvidence.credits
    .filter((credit) =>
      credit.academyId === academyId && isDeductionCredit(credit)
    )
    .sort((left, right) => left.id.localeCompare(right.id))
  const evidenceRelevantCredits = [...evidenceRun.relevantCredits]
    .sort((left, right) => left.id.localeCompare(right.id))
  if (stableStringify(auditRelevantCredits.map((credit) => credit.id)) !==
      stableStringify(evidenceRelevantCredits.map((credit) => credit.id))) {
    failProtocol('Audit and evidence relevant credit sets differ.')
  }
  for (const auditCredit of auditRelevantCredits) {
    const evidenceCredit = evidenceRelevantCredits.find(
      (credit) => credit.id === auditCredit.id
    )
    if (evidenceCredit.academyScoped !== true) {
      failProtocol('Same-academy audit credit has foreign evidence scope.')
    }
    if (
      stableStringify(auditCreditTypedTargets(auditCredit)) !==
      stableStringify(evidenceCreditTypedTargets(evidenceCredit))
    ) {
      failProtocol('Audit and evidence relevant credit targets differ.')
    }
    const comparisons = [
      [auditCredit.packageId, evidenceCredit.packageId],
      [auditCredit.studentId, evidenceCredit.studentId],
      [auditCredit.sourceType, evidenceCredit.sourceType],
      [auditCredit.actionType, evidenceCredit.actionType],
      [auditCredit.ledgerTransition, evidenceCredit.ledgerTransition],
      [auditCredit.marker, evidenceCredit.fixedPrivateDeductionLedger],
    ]
    if (
      auditCredit.deltaCount !== evidenceCredit.deltaCount ||
      comparisons.some(([auditValue, evidenceValue]) =>
        nullableAuditId(auditValue) !== evidenceValue
      )
    ) {
      failProtocol('Audit and evidence relevant credit details differ.')
    }
  }

  const redactedNonOccurrenceByKey = new Map(
    redactedArtifact.nonOccurrenceEvidence.map((row) => [row.cohortKey, row])
  )
  const unmatchedByKey = new Map(
    auditRun.unmatchedEvidence.map((row) => [row.evidenceKey, row])
  )
  const nonOccurrenceEvidence = evidenceRun.nonOccurrenceCredits.map((credit) => {
    const evidenceKey = `credit:${credit.id}`
    const auditEvidence = unmatchedByKey.get(evidenceKey)
    if (!auditEvidence) {
      failProtocol('Relevant non-occurrence credit lacks audit blocker evidence.')
    }
    const cohortKey = redactedCohortKey({
      redactionKey,
      academyId,
      occurrenceKey: evidenceKey,
    })
    const redacted = redactedNonOccurrenceByKey.get(cohortKey)
    if (
      !redacted ||
      redacted.evidenceType !== auditEvidence.evidenceType ||
      stableStringify(redacted.blockingCategories) !==
        stableStringify(auditEvidence.blockingCategories)
    ) {
      failProtocol('Redacted non-occurrence credit parity failed.')
    }
    return { auditEvidence, cohortKey, credit, evidenceKey, redacted }
  })
  if (
    nonOccurrenceEvidence.length !== auditRun.unmatchedEvidence.length ||
    nonOccurrenceEvidence.length !== redactedArtifact.nonOccurrenceEvidence.length
  ) {
    failProtocol('Non-occurrence credit evidence count differs.')
  }
  return {
    occurrences: reconciledOccurrences.sort((left, right) =>
      left.cohortKey.localeCompare(right.cohortKey)
    ),
    nonOccurrenceEvidence: nonOccurrenceEvidence.sort((left, right) =>
      left.cohortKey.localeCompare(right.cohortKey)
    ),
  }
}

const MANIFEST_TOP_LEVEL_FIELDS = [
  'academyId',
  'auditVersion',
  'cohortIndexes',
  'completedRuns',
  'consistency',
  'createdAt',
  'evidenceRunDigests',
  'evidenceVersion',
  'generatedForReadOnlyTriage',
  'manifestVersion',
  'nonOccurrenceEvidence',
  'occurrences',
  'productionWriteAuthorized',
  'project',
  'redactedArtifactDigest',
  'repairPlanApproved',
  'runDigests',
  'sensitivity',
  'summary',
]
const MANIFEST_OCCURRENCE_FIELDS = [
  'blockingCategories',
  'cohortKey',
  'creditIds',
  'currentLedgerMode',
  'evidenceFlags',
  'evidenceVariants',
  'identityIds',
  'joinEvidence',
  'legacyPartitionState',
  'membershipIds',
  'occurrenceKey',
  'originMode',
  'packageCandidateIds',
  'primaryCohort',
  'repairability',
  'secondaryCategories',
  'studentCandidateIds',
]
const MANIFEST_JOIN_FIELDS = ['credits', 'memberships', 'packages']
const MANIFEST_JOIN_ENTRY_FIELDS = [
  'academyScoped', 'evidence', 'exists', 'id',
]
const MANIFEST_NON_OCCURRENCE_FIELDS = [
  'blockingCategories',
  'cohortKey',
  'creditEvidence',
  'evidenceKey',
  'evidenceType',
  'repairability',
]
const MANIFEST_EVIDENCE_FLAG_FIELDS = [
  'activeLifecycle',
  'allFixedFamilies',
  'hasAllLinkedDocuments',
  'linkageEvidenceComplete',
  'packageReferencePresent',
  'singleConsistentDeductionEvidence',
  'teacherMappingResolved',
  'terminalLifecycle',
]

function manifestOccurrenceFromReconciliation(row) {
  const evidence = row.evidence
  return {
    cohortKey: row.cohortKey,
    occurrenceKey: evidence.occurrenceKey,
    identityIds: [...evidence.identityIds],
    evidenceVariants: structuredClone(evidence.variants),
    studentCandidateIds: [...evidence.studentCandidateIds],
    packageCandidateIds: [...evidence.packageCandidateIds],
    membershipIds: [...evidence.membershipIds],
    creditIds: [...evidence.creditIds],
    joinEvidence: structuredClone(row.joins),
    primaryCohort: row.redacted.primaryCohort,
    secondaryCategories: [...row.redacted.secondaryCategories],
    blockingCategories: [...row.redacted.blockingCategories],
    currentLedgerMode: row.redacted.currentLedgerMode,
    originMode: row.redacted.originMode,
    legacyPartitionState: row.redacted.legacyPartitionState,
    repairability: row.redacted.repairability,
    evidenceFlags: { ...row.redacted.evidenceFlags },
  }
}

function manifestNonOccurrenceFromReconciliation(row) {
  return {
    cohortKey: row.cohortKey,
    evidenceKey: row.evidenceKey,
    evidenceType: row.redacted.evidenceType,
    blockingCategories: [...row.redacted.blockingCategories],
    repairability: row.redacted.repairability,
    creditEvidence: structuredClone(row.credit),
  }
}

function buildCohortIndexes(occurrences) {
  const indexes = {
    byPrimaryCohort: Object.fromEntries(
      REDACTED_PRIMARY_COHORTS.map((value) => [value, []])
    ),
    byRepairability: Object.fromEntries(
      REDACTED_REPAIRABILITY_VALUES.map((value) => [value, []])
    ),
    byBlockingCategory: Object.fromEntries(
      AUDIT_BLOCKER_CATEGORIES.map((value) => [value, []])
    ),
  }
  occurrences.forEach((occurrence, index) => {
    indexes.byPrimaryCohort[occurrence.primaryCohort].push(index)
    indexes.byRepairability[occurrence.repairability].push(index)
    for (const category of occurrence.blockingCategories) {
      indexes.byBlockingCategory[category].push(index)
    }
  })
  return indexes
}

export function buildSensitiveRemediationManifest({
  auditSummary,
  auditRun,
  evidenceRun,
  redactedArtifact,
  academyId,
  redactionKey,
  evidenceRunDigests,
  createdAt = new Date().toISOString(),
}) {
  if (
    auditSummary.consistency !== true ||
    auditSummary.completedRuns !== 2 ||
    !Array.isArray(evidenceRunDigests) ||
    evidenceRunDigests.length !== 2 ||
    evidenceRunDigests.some((digest) => !HEX_64.test(digest))
  ) {
    failProtocol('Sensitive remediation manifest requires two consistent runs.')
  }
  const reconciled = reconcileAuditAndRemediationEvidence({
    auditRun,
    evidenceRun,
    redactedArtifact,
    academyId,
    redactionKey,
  })
  const occurrences = reconciled.occurrences.map(
    manifestOccurrenceFromReconciliation
  )
  const nonOccurrenceEvidence = reconciled.nonOccurrenceEvidence.map(
    manifestNonOccurrenceFromReconciliation
  )
  const evidenceFamilyRecordCounts = Object.fromEntries(
    REMEDIATION_EVIDENCE_SCAN_FAMILIES.map((family) => [
      family,
      evidenceRun.recordsByFamily[family].length,
    ])
  )
  const manifest = {
    manifestVersion: REMEDIATION_MANIFEST_VERSION,
    auditVersion: AUDIT_VERSION,
    evidenceVersion: REMEDIATION_EVIDENCE_VERSION,
    sensitivity: LOCAL_REMEDIATION_SENSITIVITY,
    project: PRODUCTION_PROJECT_ID,
    academyId,
    createdAt,
    completedRuns: 2,
    consistency: true,
    runDigests: [...auditSummary.runDigests],
    evidenceRunDigests: [...evidenceRunDigests],
    redactedArtifactDigest: sha256(stableStringify(redactedArtifact)),
    summary: {
      totalOccurrences: redactedArtifact.summary.totalOccurrences,
      safeOccurrences: redactedArtifact.summary.safeOccurrences,
      blockedOccurrences: redactedArtifact.summary.blockedOccurrences,
      rawBlockingCategoryCount:
        redactedArtifact.summary.rawBlockingCategoryCount,
      evidenceRecordCount: evidenceRun.totalRecords,
      reconciledOccurrences: occurrences.length,
      nonOccurrenceEvidenceCount: nonOccurrenceEvidence.length,
      evidenceFamilyRecordCounts,
    },
    productionWriteAuthorized: false,
    repairPlanApproved: false,
    generatedForReadOnlyTriage: true,
    occurrences,
    nonOccurrenceEvidence,
    cohortIndexes: buildCohortIndexes(occurrences),
  }
  return validateSensitiveRemediationManifest(manifest)
}

function validateManifestIndexMap(value, keys, occurrenceCount, label) {
  assertExactKeys(value, keys, label)
  for (const key of keys) {
    const indexes = value[key]
    if (!Array.isArray(indexes)) failProtocol(`${label}.${key} must be an array.`)
    if (
      indexes.some((index) =>
        !Number.isSafeInteger(index) || index < 0 || index >= occurrenceCount
      ) ||
      new Set(indexes).size !== indexes.length ||
      stableStringify(indexes) !== stableStringify([...indexes].sort((a, b) => a - b))
    ) {
      failProtocol(`${label}.${key} contains invalid occurrence indexes.`)
    }
  }
}

function validateManifestClassification(value, label) {
  assertStringArray(value.blockingCategories, `${label}.blockingCategories`)
  assertStringArray(value.secondaryCategories, `${label}.secondaryCategories`)
  if (
    value.blockingCategories.some((category) =>
      !AUDIT_BLOCKER_CATEGORIES.includes(category)
    ) ||
    stableStringify(value.blockingCategories) !==
      stableStringify(sortedBlockingCategories(value.blockingCategories))
  ) {
    failProtocol(`${label}.blockingCategories are invalid.`)
  }
  if (!REDACTED_PRIMARY_COHORTS.includes(value.primaryCohort)) {
    failProtocol(`${label}.primaryCohort is unsupported.`)
  }
  if (!REDACTED_REPAIRABILITY_VALUES.includes(value.repairability)) {
    failProtocol(`${label}.repairability is unsupported.`)
  }
  if (!['canonical', 'legacy', 'inconsistent'].includes(value.currentLedgerMode) ||
      ![
        'born_canonical', 'converted_legacy', 'legacy_unconverted', 'unknown',
      ].includes(value.originMode) ||
      ![
        'already_converted', 'terminal_unconverted', 'safely_convertible',
        'unsafe', 'not_legacy_origin',
      ].includes(value.legacyPartitionState)) {
    failProtocol(`${label} classification value is unsupported.`)
  }
  assertExactKeys(
    value.evidenceFlags,
    MANIFEST_EVIDENCE_FLAG_FIELDS,
    `${label}.evidenceFlags`
  )
  for (const field of MANIFEST_EVIDENCE_FLAG_FIELDS) {
    assertBoolean(value.evidenceFlags[field], `${label}.evidenceFlags.${field}`)
  }
  const expectedPrimary = classifyPrimaryCohort(value)
  const expectedSecondary = value.blockingCategories.filter(
    (category) => !expectedPrimary.categories.includes(category)
  )
  const expectedRepairability = classifyRepairability(
    value,
    expectedPrimary.name
  )
  if (
    value.primaryCohort !== expectedPrimary.name ||
    stableStringify(value.secondaryCategories) !==
      stableStringify(expectedSecondary) ||
    value.repairability !== expectedRepairability
  ) {
    failProtocol(`${label} classification is not derivable from its evidence.`)
  }
}

function validateManifestOccurrence(value, index, academyId) {
  const label = `manifest.occurrences[${index}]`
  assertExactKeys(value, MANIFEST_OCCURRENCE_FIELDS, label)
  assertDigest(value.cohortKey, `${label}.cohortKey`)
  assertRawIdentifier(value.occurrenceKey, `${label}.occurrenceKey`, {
    allowEmpty: false,
  })
  for (const field of [
    'identityIds',
    'studentCandidateIds',
    'packageCandidateIds',
    'membershipIds',
    'creditIds',
  ]) {
    assertCanonicalIdentifierArray(value[field], `${label}.${field}`)
  }
  if (!Array.isArray(value.evidenceVariants) ||
      value.evidenceVariants.length === 0) {
    failProtocol(`${label}.evidenceVariants must be non-empty.`)
  }
  value.evidenceVariants.forEach((variant, variantIndex) =>
    validateOccurrenceEvidenceRecord(
      variant,
      academyId,
      variant.rootFamily,
      `${label}.evidenceVariants[${variantIndex}]`
    )
  )
  const familyOrder = new Map(
    ['lessons', 'reservations', 'slots'].map((family, order) => [family, order])
  )
  const sortedVariants = [...value.evidenceVariants].sort((left, right) =>
    familyOrder.get(left.rootFamily) - familyOrder.get(right.rootFamily) ||
    left.rootId.localeCompare(right.rootId)
  )
  if (
    stableStringify(sortedVariants) !== stableStringify(value.evidenceVariants) ||
    new Set(value.evidenceVariants.map((variant) =>
      `${variant.rootFamily}:${variant.rootId}`
    )).size !== value.evidenceVariants.length ||
    value.evidenceVariants.some(
      (variant) => variant.provenance.classifier.isFixed !== true
    )
  ) {
    failProtocol(`${label}.evidenceVariants are invalid.`)
  }
  if (collapseEvidenceVariantGroups(value.evidenceVariants).length !== 1) {
    failProtocol(`${label}.evidenceVariants are not one transitive group.`)
  }
  const expectedIdentityIds = uniqueStrings(
    value.evidenceVariants.flatMap(evidenceVariantIdentityIds)
  )
  const expectedStudentIds = uniqueStrings(
    value.evidenceVariants.flatMap((variant) => variant.studentCandidateIds)
  )
  const expectedPackageIds = uniqueStrings(
    value.evidenceVariants.flatMap((variant) => variant.packageCandidateIds)
  )
  const expectedMembershipIds = uniqueStrings(
    value.evidenceVariants.flatMap((variant) => variant.membershipIds)
  )
  for (const [actual, expected, field] of [
    [value.identityIds, expectedIdentityIds, 'identityIds'],
    [value.studentCandidateIds, expectedStudentIds, 'studentCandidateIds'],
    [value.packageCandidateIds, expectedPackageIds, 'packageCandidateIds'],
    [value.membershipIds, expectedMembershipIds, 'membershipIds'],
  ]) {
    assertSameValue(actual, expected, `${label}.${field} union is invalid.`)
  }
  assertExactKeys(value.joinEvidence, MANIFEST_JOIN_FIELDS,
    `${label}.joinEvidence`)
  const expectedJoinIds = {
    credits: value.creditIds,
    memberships: value.membershipIds,
    packages: value.packageCandidateIds,
  }
  for (const family of MANIFEST_JOIN_FIELDS) {
    const entries = value.joinEvidence[family]
    if (!Array.isArray(entries)) {
      failProtocol(`${label}.joinEvidence.${family} must be an array.`)
    }
    entries.forEach((entry, entryIndex) => {
      const entryLabel = `${label}.joinEvidence.${family}[${entryIndex}]`
      assertExactKeys(entry, MANIFEST_JOIN_ENTRY_FIELDS, entryLabel)
      assertRawIdentifier(entry.id, `${entryLabel}.id`, { allowEmpty: false })
      assertBoolean(entry.exists, `${entryLabel}.exists`)
      if (entry.academyScoped !== null) {
        assertBoolean(entry.academyScoped, `${entryLabel}.academyScoped`)
      }
      if (!entry.exists) {
        if (entry.academyScoped !== null || entry.evidence !== null) {
          failProtocol(`${entryLabel} missing join state is invalid.`)
        }
      } else if (entry.academyScoped === null || entry.evidence === null) {
        failProtocol(`${entryLabel} existing join state is invalid.`)
      } else if (family === 'credits') {
        validateCreditEvidenceRecord(entry.evidence, academyId,
          `${entryLabel}.evidence`, {
            allowAcademyMismatch: !entry.academyScoped,
          })
      } else if (family === 'memberships') {
        validateMembershipSummary(entry.evidence, academyId,
          `${entryLabel}.evidence`, { fingerprint: true })
      } else if (entry.academyScoped) {
        validatePackageSummary(entry.evidence, academyId,
          `${entryLabel}.evidence`, { fingerprint: true })
      } else {
        validatePackageSummary(entry.evidence, academyId,
          `${entryLabel}.evidence`, {
            candidate: true,
            allowAcademyMismatch: true,
          })
      }
      if (entry.exists && (
        entry.evidence.id !== entry.id ||
        (entry.academyScoped && entry.evidence.academyId !== academyId) ||
        (!entry.academyScoped && entry.evidence.academyId === academyId)
      )) {
        failProtocol(`${entryLabel} scope marker is invalid.`)
      }
      const embeddedMatches = value.evidenceVariants.some((variant) => {
        if (family === 'credits') {
          const presence = variant.documentPresence.credits.find(
            (candidate) => candidate.id === entry.id
          )
          if (!entry.exists) return presence?.exists === false
          const embeddedMatch = variant.credits.some((credit) =>
            credit.id === entry.id &&
            stableStringify(credit) === stableStringify(entry.evidence)
          )
          const directTypedMatch = entry.academyScoped === true &&
            evidenceCreditTypedTargets(entry.evidence).some((target) =>
              value.identityIds.includes(target)
            )
          return embeddedMatch || directTypedMatch
        }
        if (family === 'memberships') {
          if (!entry.exists) return false
          return variant.teacher.matchedMemberships.some((membership) => {
            const { kind, auditFingerprint, ...summary } = entry.evidence
            return membership.id === entry.id &&
              stableStringify(membership) === stableStringify(summary)
          })
        }
        return variant.packageCandidates.some((candidate) => {
          if (!entry.exists) {
            return candidate.id === entry.id && candidate.exists === false
          }
          if (!entry.academyScoped) {
            return candidate.id === entry.id &&
              stableStringify(candidate) === stableStringify(entry.evidence)
          }
          const { kind, auditFingerprint, ...summary } = entry.evidence
          const {
            academyScoped,
            exists,
            sources,
            ...candidateSummary
          } = candidate
          return candidate.id === entry.id &&
            stableStringify(candidateSummary) === stableStringify(summary)
        })
      })
      if (!embeddedMatches) {
        failProtocol(`${entryLabel} does not match embedded evidence.`)
      }
    })
    if (
      new Set(entries.map((entry) => entry.id)).size !== entries.length ||
      stableStringify(entries) !== stableStringify([...entries].sort(
        (left, right) => left.id.localeCompare(right.id)
      ))
    ) {
      failProtocol(`${label}.joinEvidence.${family} is not canonical.`)
    }
    assertSameValue(
      entries.map((entry) => entry.id),
      expectedJoinIds[family],
      `${label}.joinEvidence.${family} is incomplete.`
    )
  }
  validateManifestClassification(value, label)
}

function validateManifestNonOccurrence(value, index, academyId) {
  const label = `manifest.nonOccurrenceEvidence[${index}]`
  assertExactKeys(value, MANIFEST_NON_OCCURRENCE_FIELDS, label)
  assertDigest(value.cohortKey, `${label}.cohortKey`)
  assertRawIdentifier(value.evidenceKey, `${label}.evidenceKey`, {
    allowEmpty: false,
  })
  if (value.evidenceType !== 'unmatched_fixed_deduction_credit') {
    failProtocol(`${label}.evidenceType is unsupported.`)
  }
  assertStringArray(value.blockingCategories, `${label}.blockingCategories`)
  if (
    value.blockingCategories.some((category) =>
      !AUDIT_BLOCKER_CATEGORIES.includes(category)
    ) ||
    stableStringify(value.blockingCategories) !==
      stableStringify(sortedBlockingCategories(value.blockingCategories))
  ) {
    failProtocol(`${label}.blockingCategories are invalid.`)
  }
  if (value.repairability !== 'financial_manual_review_only') {
    failProtocol(`${label}.repairability is unsupported.`)
  }
  validateCreditEvidenceRecord(value.creditEvidence, academyId,
    `${label}.creditEvidence`)
}

export function validateSensitiveRemediationManifest(manifest) {
  assertExactKeys(manifest, MANIFEST_TOP_LEVEL_FIELDS, 'manifest')
  if (
    manifest.manifestVersion !== REMEDIATION_MANIFEST_VERSION ||
    manifest.auditVersion !== AUDIT_VERSION ||
    manifest.evidenceVersion !== REMEDIATION_EVIDENCE_VERSION ||
    manifest.sensitivity !== LOCAL_REMEDIATION_SENSITIVITY ||
    manifest.project !== PRODUCTION_PROJECT_ID ||
    manifest.completedRuns !== 2 ||
    manifest.consistency !== true ||
    manifest.productionWriteAuthorized !== false ||
    manifest.repairPlanApproved !== false ||
    manifest.generatedForReadOnlyTriage !== true
  ) {
    failProtocol('Sensitive remediation manifest metadata is invalid.')
  }
  assertRawIdentifier(manifest.academyId, 'manifest.academyId', {
    allowEmpty: false,
  })
  if (
    typeof manifest.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(manifest.createdAt)) ||
    new Date(manifest.createdAt).toISOString() !== manifest.createdAt
  ) {
    failProtocol('manifest.createdAt must be an ISO timestamp.')
  }
  for (const field of ['runDigests', 'evidenceRunDigests']) {
    if (
      !Array.isArray(manifest[field]) ||
      manifest[field].length !== 2 ||
      manifest[field].some((value) => typeof value !== 'string' || !HEX_64.test(value))
    ) {
      failProtocol(`manifest.${field} must contain two digests.`)
    }
  }
  assertDigest(manifest.redactedArtifactDigest, 'manifest.redactedArtifactDigest')
  assertExactKeys(manifest.summary, [
    'blockedOccurrences',
    'evidenceFamilyRecordCounts',
    'evidenceRecordCount',
    'nonOccurrenceEvidenceCount',
    'rawBlockingCategoryCount',
    'reconciledOccurrences',
    'safeOccurrences',
    'totalOccurrences',
  ], 'manifest.summary')
  for (const field of [
    'blockedOccurrences',
    'evidenceRecordCount',
    'nonOccurrenceEvidenceCount',
    'rawBlockingCategoryCount',
    'reconciledOccurrences',
    'safeOccurrences',
    'totalOccurrences',
  ]) {
    assertSafeInteger(manifest.summary[field], `manifest.summary.${field}`)
  }
  assertExactKeys(
    manifest.summary.evidenceFamilyRecordCounts,
    REMEDIATION_EVIDENCE_SCAN_FAMILIES,
    'manifest.summary.evidenceFamilyRecordCounts'
  )
  for (const family of REMEDIATION_EVIDENCE_SCAN_FAMILIES) {
    assertSafeInteger(
      manifest.summary.evidenceFamilyRecordCounts[family],
      `manifest.summary.evidenceFamilyRecordCounts.${family}`
    )
  }
  if (!Array.isArray(manifest.occurrences)) {
    failProtocol('manifest.occurrences must be an array.')
  }
  if (!Array.isArray(manifest.nonOccurrenceEvidence)) {
    failProtocol('manifest.nonOccurrenceEvidence must be an array.')
  }
  manifest.occurrences.forEach((occurrence, index) =>
    validateManifestOccurrence(occurrence, index, manifest.academyId)
  )
  manifest.nonOccurrenceEvidence.forEach((evidence, index) =>
    validateManifestNonOccurrence(evidence, index, manifest.academyId)
  )
  const expectedEvidenceRecordCount =
    REMEDIATION_EVIDENCE_SCAN_FAMILIES.reduce(
      (sum, family) =>
        sum + manifest.summary.evidenceFamilyRecordCounts[family],
      0
    )
  const expectedRawBlockingCategoryCount = [
    ...manifest.occurrences,
    ...manifest.nonOccurrenceEvidence,
  ].reduce((sum, row) => sum + row.blockingCategories.length, 0)
  const expectedBlockedOccurrences = manifest.occurrences.filter(
    (row) => row.blockingCategories.length > 0
  ).length
  const expectedSafeOccurrences =
    manifest.occurrences.length - expectedBlockedOccurrences
  if (
    manifest.summary.totalOccurrences !== manifest.occurrences.length ||
    manifest.summary.reconciledOccurrences !== manifest.occurrences.length ||
    manifest.summary.safeOccurrences + manifest.summary.blockedOccurrences !==
      manifest.occurrences.length ||
    manifest.summary.safeOccurrences !== expectedSafeOccurrences ||
    manifest.summary.blockedOccurrences !== expectedBlockedOccurrences ||
    manifest.summary.rawBlockingCategoryCount !==
      expectedRawBlockingCategoryCount ||
    manifest.summary.evidenceRecordCount !== expectedEvidenceRecordCount ||
    new Set(manifest.occurrences.map((row) => row.occurrenceKey)).size !==
      manifest.occurrences.length ||
    new Set(manifest.occurrences.map((row) => row.cohortKey)).size !==
      manifest.occurrences.length ||
    manifest.summary.nonOccurrenceEvidenceCount !==
      manifest.nonOccurrenceEvidence.length ||
    new Set(manifest.nonOccurrenceEvidence.map((row) => row.evidenceKey)).size !==
      manifest.nonOccurrenceEvidence.length ||
    new Set([
      ...manifest.occurrences.map((row) => row.cohortKey),
      ...manifest.nonOccurrenceEvidence.map((row) => row.cohortKey),
    ]).size !== manifest.occurrences.length + manifest.nonOccurrenceEvidence.length
  ) {
    failProtocol('Sensitive remediation manifest occurrence totals are invalid.')
  }
  assertExactKeys(manifest.cohortIndexes, [
    'byBlockingCategory',
    'byPrimaryCohort',
    'byRepairability',
  ], 'manifest.cohortIndexes')
  validateManifestIndexMap(
    manifest.cohortIndexes.byBlockingCategory,
    AUDIT_BLOCKER_CATEGORIES,
    manifest.occurrences.length,
    'manifest.cohortIndexes.byBlockingCategory'
  )
  validateManifestIndexMap(
    manifest.cohortIndexes.byPrimaryCohort,
    REDACTED_PRIMARY_COHORTS,
    manifest.occurrences.length,
    'manifest.cohortIndexes.byPrimaryCohort'
  )
  validateManifestIndexMap(
    manifest.cohortIndexes.byRepairability,
    REDACTED_REPAIRABILITY_VALUES,
    manifest.occurrences.length,
    'manifest.cohortIndexes.byRepairability'
  )
  const expectedIndexes = buildCohortIndexes(manifest.occurrences)
  assertSameValue(
    manifest.cohortIndexes,
    expectedIndexes,
    'Sensitive remediation manifest cohort indexes are invalid.'
  )
  return manifest
}

export async function writeSensitiveRemediationManifest(outputPath, manifest) {
  validateSensitiveRemediationManifest(manifest)
  const parent = path.dirname(outputPath)
  const temporaryPath = path.join(
    parent,
    `.${path.basename(outputPath)}.${process.pid}.` +
      `${crypto.randomBytes(12).toString('hex')}.tmp`
  )
  let handle
  try {
    handle = await fs.promises.open(temporaryPath, 'wx', 0o600)
    await handle.writeFile(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    await handle.sync()
    await handle.close()
    handle = null
    await fs.promises.chmod(temporaryPath, 0o600)
    await fs.promises.link(temporaryPath, outputPath)
    await fs.promises.unlink(temporaryPath)
  } catch {
    if (handle) await handle.close().catch(() => {})
    await fs.promises.unlink(temporaryPath).catch(() => {})
    throw new Error('Sensitive remediation manifest write failed.')
  }
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
  artifactWriter = writeRedactedCohortArtifact,
  sensitiveManifestWriter = writeSensitiveRemediationManifest,
  now = () => new Date(),
} = {}) {
  const {
    academyId,
    token,
    redactedArtifact,
    sensitiveRemediation,
  } = validateProductionAuditEnvironment(env)
  if (typeof fetchImpl !== 'function') throw new Error('fetch is unavailable.')
  const firstRun = await runSingleAudit({ fetchImpl, token, academyId })
  const firstEvidenceRun = sensitiveRemediation
    ? await runSingleRemediationEvidence({ fetchImpl, token, academyId })
    : null
  const secondRun = await runSingleAudit({ fetchImpl, token, academyId })
  const secondEvidenceRun = sensitiveRemediation
    ? await runSingleRemediationEvidence({ fetchImpl, token, academyId })
    : null
  const first = firstRun.summary
  const second = secondRun.summary
  const summaryConsistency = stableStringify(consistencyPayload(first)) ===
    stableStringify(consistencyPayload(second))
  const artifactEvidenceConsistency = !redactedArtifact ||
    stableStringify({
      occurrenceEvidence: firstRun.occurrenceEvidence,
      unmatchedEvidence: firstRun.unmatchedEvidence,
      sourceReconciliation: firstRun.sourceReconciliation,
    }) === stableStringify({
      occurrenceEvidence: secondRun.occurrenceEvidence,
      unmatchedEvidence: secondRun.unmatchedEvidence,
      sourceReconciliation: secondRun.sourceReconciliation,
    })
  const evidenceConsistency = !sensitiveRemediation ||
    stableStringify({
      familyDigests: firstEvidenceRun.familyDigests,
      rawOccurrenceSet: firstEvidenceRun.rawOccurrenceSet,
      linksStatusProvenanceDigest:
        firstEvidenceRun.linksStatusProvenanceDigest,
      runDigest: firstEvidenceRun.runDigest,
    }) === stableStringify({
      familyDigests: secondEvidenceRun.familyDigests,
      rawOccurrenceSet: secondEvidenceRun.rawOccurrenceSet,
      linksStatusProvenanceDigest:
        secondEvidenceRun.linksStatusProvenanceDigest,
      runDigest: secondEvidenceRun.runDigest,
    })
  const consistency =
    summaryConsistency && artifactEvidenceConsistency && evidenceConsistency
  const result = {
    ...second,
    quietWindowConfirmed: true,
    completedRuns: 2,
    consistency,
    runDigests: [first.summaryDigest, second.summaryDigest],
    pass: second.pass && first.pass && consistency,
  }
  validateFinalAuditSummary(result)
  let redactedCohortArtifact
  let sensitiveManifest
  if (
    redactedArtifact &&
    result.complete === true &&
    result.truncated === false &&
    result.omittedCount === 0 &&
    result.consistency === true
  ) {
    redactedCohortArtifact = buildRedactedCohortArtifact({
      summary: result,
      occurrenceEvidence: secondRun.occurrenceEvidence,
      unmatchedEvidence: secondRun.unmatchedEvidence,
      sourceReconciliation: secondRun.sourceReconciliation,
      academyId,
      redactionKey: redactedArtifact.redactionKey,
    })
    if (sensitiveRemediation) {
      reconcileAuditAndRemediationEvidence({
        auditRun: firstRun,
        evidenceRun: firstEvidenceRun,
        redactedArtifact: redactedCohortArtifact,
        academyId,
        redactionKey: redactedArtifact.redactionKey,
      })
      sensitiveManifest = buildSensitiveRemediationManifest({
        auditSummary: result,
        auditRun: secondRun,
        evidenceRun: secondEvidenceRun,
        redactedArtifact: redactedCohortArtifact,
        academyId,
        redactionKey: redactedArtifact.redactionKey,
        evidenceRunDigests: [
          firstEvidenceRun.runDigest,
          secondEvidenceRun.runDigest,
        ],
        createdAt: now().toISOString(),
      })
    }
    await artifactWriter(redactedArtifact.outputPath, redactedCohortArtifact)
    if (sensitiveManifest) {
      await sensitiveManifestWriter(
        sensitiveRemediation.outputPath,
        sensitiveManifest
      )
    }
  }
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
  artifactWriter = writeRedactedCohortArtifact,
  sensitiveManifestWriter = writeSensitiveRemediationManifest,
  writeOutput = (value) => process.stdout.write(`${value}\n`),
  writeError = (value) => process.stderr.write(`${value}\n`),
} = {}) {
  try {
    const summary = await runProductionAudit({
      env,
      fetchImpl,
      artifactWriter,
      sensitiveManifestWriter,
    })
    const sensitiveMode = Object.prototype.hasOwnProperty.call(
      env,
      'AUDIT_SENSITIVE_REMEDIATION_OUTPUT'
    ) || Object.prototype.hasOwnProperty.call(
      env,
      'CONFIRM_SENSITIVE_LOCAL_REMEDIATION_MANIFEST'
    )
    writeOutput(JSON.stringify(sensitiveMode
      ? {
          auditVersion: summary.auditVersion,
          completedRuns: summary.completedRuns,
          complete: summary.complete,
          truncated: summary.truncated,
          omittedCount: summary.omittedCount,
          consistency: summary.consistency,
          blockerTotal: summary.blockerTotal,
          pass: summary.pass,
          datasetDigest: summary.datasetDigest,
          summaryDigest: summary.summaryDigest,
          sensitiveRemediationMode: 'LOCAL_ONLY',
          occurrenceCount: summary.totals.occurrences,
        }
      : summary))
    return exitCodeForAuditSummary(summary)
  } catch (error) {
    const token = normalizeString(env.FIREBASE_ID_TOKEN)
    const redactionKey = normalizeString(env.AUDIT_REDACTION_KEY)
    const academyId = normalizeString(env.ACADEMY_ID)
    const sensitiveMode = Object.prototype.hasOwnProperty.call(
      env,
      'AUDIT_SENSITIVE_REMEDIATION_OUTPUT'
    ) || Object.prototype.hasOwnProperty.call(
      env,
      'CONFIRM_SENSITIVE_LOCAL_REMEDIATION_MANIFEST'
    )
    const rawMessage = sensitiveMode
      ? 'sensitive_remediation_audit_failed'
      : normalizeString(error?.message) || 'audit_failed'
    const safeMessage = [token, redactionKey, academyId]
      .filter(Boolean)
      .reduce(
        (message, secret) => message.split(secret).join('[REDACTED]'),
        rawMessage
      )
    writeError(JSON.stringify({
      auditVersion: AUDIT_VERSION,
      error: safeMessage,
    }))
    return error instanceof RemediationEvidenceIncompleteError ? 3 : 1
  }
}

const isMain = process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (isMain) process.exitCode = await executeAuditCli()
