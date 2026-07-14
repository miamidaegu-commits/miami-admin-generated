import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import {
  AUDIT_BLOCKER_CATEGORIES, AUDIT_CATEGORY_NAMES, AUDIT_CATEGORY_REASONS,
  AUDIT_INVENTORY_CATEGORIES, REMEDIATION_EVIDENCE_SCAN_FAMILIES,
  REMEDIATION_EVIDENCE_SCHEMA, buildTypedDocumentKey, executeAuditCli,
  evidenceVariantIdentityIds,
  remediationEvidencePageDigest, remediationEvidenceSchemaDigest, runProductionAudit,
  validateRemediationEvidencePage, validateSensitiveRemediationManifest,
  writeSensitiveRemediationManifest,
} from '../scripts/run-fixed-private-outcome-ledger-audit.mjs'

const ACADEMY_ID = 'manifest-academy-id'
const TOKEN = 'manifest-token-must-never-be-printed'
const REDACTION_KEY = 'manifest-redaction-key-at-least-32-characters'
const LESSON_ID = 'raw-sensitive-lesson-id'
const RESERVATION_ID = 'raw-sensitive-reservation-id'
const SLOT_ID = 'raw-sensitive-slot-id'
const STUDENT_ID = 'raw-sensitive-student-id'
const PACKAGE_ID = 'raw-sensitive-package-id'
const PACKAGE_ID_2 = 'raw-sensitive-package-id-2'
const MEMBERSHIP_ID = 'raw-sensitive-membership-id'
const CREDIT_ID = 'raw-sensitive-credit-id'
const RAW_KEY = `lesson:${LESSON_ID}`
const TEACHER_UID = crypto.createHash('sha256').update('teacher').digest('hex')
const SCHEMA = REMEDIATION_EVIDENCE_SCHEMA.records.occurrence
const OCCURRENCE_AUDIT_FAMILY = new Map([
  ['fixedLessons', 'fixedLessons'],
  ['fixedReservations', 'fixedReservations'],
  ['fixedSlots', 'fixedSlots'],
])

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}
const hash = (value) => crypto.createHash('sha256').update(value).digest('hex')
const fp = (record) => ({ ...record, auditFingerprint: hash(stable(record)) })
const nulls = (keys) => Object.fromEntries(keys.map((key) => [key, null]))
const categoryMap = (keys, factory = () => 0) =>
  Object.fromEntries(keys.map((key) => [key, factory(key)]))
const documentScope = (id, {
  academyId = ACADEMY_ID,
  exists = true,
} = {}) => ({
  id,
  exists,
  academyScoped: exists ? academyId === ACADEMY_ID : null,
  academyId: exists ? academyId : null,
})

function oldCredit(overrides = {}) {
  return fp({
    kind: 'credit', id: CREDIT_ID, sourceId: RESERVATION_ID,
    lessonId: LESSON_ID, slotId: SLOT_ID, packageId: PACKAGE_ID,
    studentId: STUDENT_ID, sourceType: 'fixedPrivateReservation',
    actionType: 'fixed_private_completed_deduct',
    ledgerTransition: 'reservation_increment', marker: 'reservation_v1',
    academyId: ACADEMY_ID, deltaCount: -1, ...overrides,
  })
}

function oldOccurrence({
  blocker = false,
  declaredCredits = [],
  packageExists = true,
  terminal = false,
} = {}) {
  return fp({
    kind: 'occurrence', rootFamily: 'fixedLessons', rootId: LESSON_ID,
    occurrenceKey: RAW_KEY, academyId: ACADEMY_ID, lessonId: LESSON_ID,
    reservationId: RESERVATION_ID, slotId: SLOT_ID, packageId: PACKAGE_ID,
    studentId: STUDENT_ID, expectedCreditId: CREDIT_ID,
    fixedFamilies: { lesson: true, reservation: true, slot: true },
    exists: {
      lesson: true,
      package: packageExists,
      reservation: true,
      slot: true,
    },
    provenance: {
      hasCanonicalMarker: true, hasLegacyEvidence: false,
      ledgerMode: 'canonical', legacyEvidenceConsistent: false,
      originMode: 'born_canonical',
    },
    statuses: {
      lesson: terminal ? 'completed' : 'active',
      reservation: terminal ? 'completed' : 'active', slot: 'reserved',
    },
    deduction: {
      ids: terminal ? [CREDIT_ID] : [], lessonApplied: terminal,
      reservationApplied: terminal, slotApplied: false,
    },
    diagnostics: {
      academyMismatch: false, fixedProvenanceMismatch: false,
      linkMismatch: blocker, linkReasons: blocker ? ['mismatch'] : [],
      missingLinkedDocument: false, orphanFixedReservation: false,
      orphanFixedSlot: false, outcomeStatusMismatch: false,
      packageMismatch: false,
      packageMissing: !packageExists,
      studentMismatch: false,
      unclassifiableOccurrence: false,
    },
    diagnosticReasons: { outcomeStatus: [], provenance: [], rowFlags: [] },
    ledgerContribution: {
      lessonCountsByDate: false, lessonEnded: true,
      reservationCountsByEvidence: terminal,
    },
    packageCounts: {
      remainingCount: terminal ? 19 : 20, totalCount: 20,
      usedCount: terminal ? 1 : 0,
    },
    teacherIdentity: { conflict: false, tier: 'uid', values: [TEACHER_UID] },
    declaredCredits,
  })
}

function oldMembership() {
  return fp({
    kind: 'teacherMembership', membershipKey: MEMBERSHIP_ID,
    declaredTeacherUid: TEACHER_UID,
    identity: { name: [], teacherId: [], teacherKey: [], uid: [TEACHER_UID] },
  })
}

function auditPage(family, options = {}) {
  const {
    auditCredits,
    blocker = false,
    packageExists = true,
    terminal = false,
    orphanCredit = false,
    auditOccurrences,
  } = options
  const occurrence = oldOccurrence({ blocker, terminal, ...options })
  const occurrenceRows = auditOccurrences || [occurrence]
  const records = OCCURRENCE_AUDIT_FAMILY.get(family) && !orphanCredit
    ? occurrenceRows.filter((row) =>
      row.rootFamily === OCCURRENCE_AUDIT_FAMILY.get(family)
    )
    : family === 'teacherMemberships' && !orphanCredit
      ? [oldMembership()]
      : family === 'deductionCredits' &&
          (auditCredits || terminal || orphanCredit)
        ? (auditCredits || [oldCredit()])
        : []
  const inventory = categoryMap(AUDIT_INVENTORY_CATEGORIES)
  const blocking = categoryMap(AUDIT_BLOCKER_CATEGORIES)
  const samples = categoryMap(AUDIT_CATEGORY_NAMES, () => [])
  const add = (category, row) => {
    const target = AUDIT_INVENTORY_CATEGORIES.includes(category)
      ? inventory
      : blocking
    target[category]++
    samples[category].push({
      lessonId: row.lessonId,
      occurrenceKey: row.occurrenceKey,
      reservationId: row.reservationId,
      slotId: row.slotId,
      reason: AUDIT_CATEGORY_REASONS[category],
    })
  }
  for (const row of records.filter((record) => record.kind === 'occurrence')) {
    const categories = ['currentLedgerOccurrenceTotal', 'occurrenceOriginTotal']
    if (row.provenance.ledgerMode === 'canonical') {
      categories.push('canonicalTotal', 'currentCanonicalLedgerTotal')
    } else if (row.provenance.ledgerMode === 'legacy') {
      categories.push('legacyTotal', 'currentLegacyLedgerTotal')
    } else {
      categories.push('currentUnknownOrMixedLedgerTotal')
    }
    if (row.provenance.originMode === 'born_canonical') {
      categories.push('bornCanonicalTotal')
    } else if (
      ['converted_legacy', 'legacy_unconverted'].includes(
        row.provenance.originMode
      ) ||
      (
        row.provenance.originMode === 'unknown' &&
        row.provenance.hasLegacyEvidence === true
      )
    ) {
      categories.push('legacyOriginTotal')
    } else {
      categories.push('unknownOriginTotal')
    }
    for (const category of [
      'linkMismatch', 'missingLinkedDocument', 'academyMismatch',
      'studentMismatch', 'packageMismatch', 'packageMissing',
      'unclassifiableOccurrence', 'orphanFixedReservation', 'orphanFixedSlot',
      'fixedProvenanceMismatch', 'outcomeStatusMismatch',
    ]) {
      if (row.diagnostics[category]) categories.push(category)
    }
    if (row.teacherIdentity.conflict) categories.push('teacherIdentityConflict')
    for (const category of categories) {
      add(category, row)
    }
  }
  return {
    academyId: ACADEMY_ID, aggregationRequired: [], auditVersion: 2,
    blocking, bounds: { pageSize: 50, sampleIdsPerCategory: 10 },
    commit: false, complete: true, dryRun: true, inventory, ok: true,
    omittedCount: 0, previewOnly: true, reasons: { ...AUDIT_CATEGORY_REASONS },
    records, samples, scanFamily: family, truncated: false,
    page: {
      complete: true, cursor: '', hasMore: false, limit: 50,
      matchedCount: records.length, nextCursor: '', omittedCount: 0,
      pageSize: 50, returnedCount: records.length,
      scannedCount: records.length, truncated: false,
    },
  }
}

function membershipSummary() {
  return {
    id: MEMBERSHIP_ID, academyId: ACADEMY_ID, uid: TEACHER_UID,
    authUid: null, memberUid: null, teacherUid: TEACHER_UID,
    teacherUID: null, teacherId: null, teacherID: null, teacherKey: null,
    role: 'teacher', status: 'active', active: true,
    normalizedNameDigest: null,
  }
}
const membershipRecord = () => fp({ kind: 'membership', ...membershipSummary() })
function packageSummary(id = PACKAGE_ID, used = 0) {
  return {
    id, academyId: ACADEMY_ID, studentId: STUDENT_ID, type: 'fixed_private',
    scope: 'private', status: 'active', totalCount: 20, usedCount: used,
    remainingCount: 20 - used,
  }
}
const packageRecord = (id, used) => fp({
  kind: 'package', ...packageSummary(id, used),
})
function creditRecord(overrides = {}) {
  const targetingOverrides = overrides.targeting || {}
  const values = { ...overrides }
  delete values.targeting
  return fp({
    kind: 'credit', id: CREDIT_ID, academyId: ACADEMY_ID,
    academyScoped: true,
    studentId: STUDENT_ID, packageId: PACKAGE_ID,
    targeting: {
      sourceId: RESERVATION_ID, reservationId: null, lessonId: LESSON_ID,
      fixedLessonId: null, slotId: SLOT_ID, linkedReservationId: null,
      linkedLessonId: null, linkedSlotId: null,
      originalCreditTransactionId: null, reversalOfTransactionId: null,
      ...targetingOverrides,
    },
    sourceType: 'fixedPrivateReservation',
    actionType: 'fixed_private_completed_deduct', deltaCount: -1,
    ledgerTransition: 'reservation_increment',
    fixedPrivateDeductionLedger: 'reservation_v1', effect: 'deduction',
    isDeduction: true, isReversal: false,
    timestamp: '2026-07-14T00:00:00.000Z',
    isDeterministicCanonicalId: false, ...values,
    ledgerTargeting: {
      ...targeting('creditTransactions', values.id || CREDIT_ID),
      deltaCount: values.deltaCount ?? -1,
      effect: values.effect || 'deduction',
      isDeduction: values.isDeduction ?? true,
      packageId: values.packageId || PACKAGE_ID,
      reservationId: targetingOverrides.reservationId || RESERVATION_ID,
      lessonId: targetingOverrides.lessonId === undefined
        ? LESSON_ID : targetingOverrides.lessonId,
      slotId: targetingOverrides.slotId === undefined
        ? SLOT_ID : targetingOverrides.slotId,
      sourceType: values.sourceType === undefined
        ? 'fixedPrivateReservation' : values.sourceType,
      studentId: values.studentId || STUDENT_ID,
    },
  })
}
function foreignCreditRecord(id = CREDIT_ID, academyId = 'foreign-academy-id') {
  return fp({
    kind: 'credit',
    id,
    academyId,
    academyScoped: false,
    studentId: null,
    packageId: null,
    targeting: nulls(REMEDIATION_EVIDENCE_SCHEMA.records.credit.targetingKeys),
    sourceType: null,
    actionType: null,
    deltaCount: null,
    ledgerTransition: null,
    fixedPrivateDeductionLedger: null,
    effect: null,
    isDeduction: false,
    isReversal: false,
    timestamp: null,
    isDeterministicCanonicalId: false,
    ledgerTargeting: {
      ...nulls(SCHEMA.ledgerTargetingKeys),
      collectionFamily: 'creditTransactions',
      documentId: id,
      isDeduction: false,
      isReversal: false,
    },
  })
}
function generalCreditRecord() {
  const record = structuredClone(creditRecord())
  delete record.auditFingerprint
  record.id = 'general-direct-credit'
  record.sourceType = null
  record.actionType = null
  record.fixedPrivateDeductionLedger = null
  record.targeting.sourceId = null
  record.targeting.lessonId = null
  record.targeting.slotId = null
  return fp(record)
}
const teacher = (uid = null) => ({
  ...nulls(SCHEMA.persistedTeacherKeys), teacherUid: uid,
})
const rawProvenance = (overrides = {}) => ({
  ...nulls(SCHEMA.provenanceRawKeys), ...overrides,
})
function status(statusValue = null, overrides = {}) {
  return {
    ...nulls(SCHEMA.statusDeductionKeys), status: statusValue,
    requestId: statusValue ? 'raw-status-request-id' : null,
    timestamps: {
      ...nulls(SCHEMA.timestampKeys),
      createdAt: statusValue ? '2026-07-14T00:00:00.000Z' : null,
    },
    ...overrides,
  }
}
const schedule = (overrides = {}) => ({
  ...nulls(SCHEMA.scheduleKeys), ...overrides,
})
function targeting(collectionFamily, documentId) {
  return {
    ...nulls(SCHEMA.ledgerTargetingKeys), collectionFamily, documentId,
    academyId: ACADEMY_ID, effect: 'neutral',
    isDeduction: false, isReversal: false,
  }
}

function aliasEvidence(row, fields) {
  const aliases = Object.fromEntries(
    fields.map((field) => [field, row[field] || null])
  )
  const uniqueValues = [...new Set(Object.values(aliases).filter(Boolean))].sort()
  return {
    ...aliases,
    uniqueValues,
    resolvedValue: uniqueValues.length === 1 ? uniqueValues[0] : null,
    conflict: uniqueValues.length > 1,
  }
}

function linkAliases(storedLinks) {
  return Object.fromEntries(
    ['lesson', 'reservation', 'slot'].map((source) => [source, {
      lesson: aliasEvidence(storedLinks[source], [
        'lessonId', 'fixedLessonId', 'linkedLessonId', 'privateLessonId',
      ]),
      reservation: aliasEvidence(storedLinks[source], [
        'reservationId', 'linkedReservationId', 'privateLessonReservationId',
      ]),
      slot: aliasEvidence(storedLinks[source], [
        'slotId', 'linkedSlotId', 'privateLessonSlotId',
      ]),
    }])
  )
}

function applyExplicitOccurrenceLinks(record, links) {
  const source = record.rootFamily === 'lessons'
    ? 'lesson'
    : record.rootFamily === 'reservations'
      ? 'reservation'
      : 'slot'
  const aliasFields = [
    'lessonId', 'fixedLessonId', 'linkedLessonId', 'privateLessonId',
    'reservationId', 'linkedReservationId', 'privateLessonReservationId',
    'slotId', 'linkedSlotId', 'privateLessonSlotId',
  ]
  for (const sourceType of ['lesson', 'reservation', 'slot']) {
    for (const field of aliasFields) record.storedLinks[sourceType][field] = null
  }
  for (const target of ['lesson', 'reservation', 'slot']) {
    record.storedLinks[source][`${target}Id`] = links[`${target}Id`] || null
  }
  record.resolvedLinks = { ...links }
  record.storedLinkAliases = linkAliases(record.storedLinks)
  record.storedLinkConflict = false
}

function occurrence({
  rootFamily = 'lessons', rootId = LESSON_ID, isFixed = true,
  occurrenceKey = RAW_KEY, terminal = false, packageIds = [PACKAGE_ID],
  missingReservation = false, rawSource = 'fixed_admin_assignment',
  creditRecords,
} = {}) {
  const sortedPackages = [...packageIds].sort()
  const embeddedCredits = creditRecords || (terminal ? [creditRecord()] : [])
  const creditIds = embeddedCredits.map((credit) => credit.id).sort()
  const storedLinks = {
    lesson: {
      ...nulls(SCHEMA.storedLinkKeys), lessonId: LESSON_ID,
      linkedReservationId: missingReservation ? null : RESERVATION_ID,
      linkedSlotId: SLOT_ID, packageId: PACKAGE_ID,
    },
    reservation: {
      ...nulls(SCHEMA.storedLinkKeys),
      lessonId: missingReservation ? null : LESSON_ID,
      reservationId: missingReservation ? null : RESERVATION_ID,
      slotId: missingReservation ? null : SLOT_ID,
      packageId: missingReservation ? null : PACKAGE_ID,
    },
    slot: {
      ...nulls(SCHEMA.storedLinkKeys), linkedLessonId: LESSON_ID,
      linkedReservationId: missingReservation ? null : RESERVATION_ID,
      slotId: SLOT_ID, packageId: PACKAGE_ID,
    },
  }
  return fp({
    kind: 'occurrence', rootFamily, rootId, occurrenceKey,
    academyId: ACADEMY_ID,
    resolvedLinks: {
      lessonId: LESSON_ID,
      reservationId: missingReservation ? null : RESERVATION_ID,
      slotId: SLOT_ID,
    },
    lessonId: LESSON_ID,
    reservationId: missingReservation ? null : RESERVATION_ID,
    slotId: SLOT_ID, studentCandidateIds: [STUDENT_ID],
    studentId: STUDENT_ID, packageCandidateIds: sortedPackages,
    packageId: packageIds.length === 1 ? packageIds[0] : null,
    membershipIds: [MEMBERSHIP_ID], creditIds,
    documentPresence: {
      lesson: true, reservation: !missingReservation, slot: true,
      student: true, package: packageIds.length === 1,
      memberships: [documentScope(MEMBERSHIP_ID)],
      credits: embeddedCredits.map((credit) =>
        documentScope(credit.id, { academyId: credit.academyId })
      ),
      packages: sortedPackages.map((id) => documentScope(id)),
      students: [documentScope(STUDENT_ID)],
    },
    documentScopes: {
      lesson: documentScope(LESSON_ID),
      reservation: documentScope(
        RESERVATION_ID,
        { exists: !missingReservation }
      ),
      slot: documentScope(SLOT_ID),
      student: documentScope(STUDENT_ID),
    },
    storedLinkAliases: linkAliases(storedLinks),
    storedLinkConflict: false,
    storedLinks,
    packageCandidates: sortedPackages.map((id) => ({
      ...packageSummary(id, terminal && id === PACKAGE_ID ? 1 : 0),
      academyScoped: true, exists: true, sources: ['lesson.packageId'],
    })),
    teacher: {
      lesson: teacher(TEACHER_UID), reservation: teacher(TEACHER_UID),
      slot: teacher(TEACHER_UID), matchedMemberships: [membershipSummary()],
    },
    provenance: {
      classifier: {
        isFixed, ledgerType: isFixed ? 'canonical' : '',
        evidence: isFixed
          ? [{ rowIndex: 0, field: 'source', value: rawSource }] : [],
      },
      ledger: {
        mode: 'canonical', marker: 'reservation_v1',
        markers: ['reservation_v1', 'reservation_v1', 'reservation_v1'],
        lessonLedgerContribution: 0, reservationLedgerContribution: 1,
      },
      origin: {
        originMode: 'born_canonical', hasLegacyEvidence: false,
        legacyEvidenceConsistent: false,
      },
      raw: {
        lesson: rawProvenance({ source: rawSource }),
        reservation: rawProvenance(), slot: rawProvenance(),
      },
    },
    statusDeduction: {
      lesson: status(terminal ? 'completed' : 'active'),
      reservation: status(terminal ? 'completed' : 'active', {
        deductionApplied: terminal,
        deductionCreditTransactionId: terminal ? CREDIT_ID : null,
      }),
      slot: status('reserved'),
    },
    schedule: {
      lesson: schedule({ date: '2026-07-14' }),
      reservation: schedule({ date: '2026-07-14' }),
      slot: schedule({ date: '2026-07-14' }),
    },
    ledgerTargeting: {
      lesson: targeting('lessons', LESSON_ID),
      reservation: targeting(
        'privateLessonReservations',
        missingReservation ? null : RESERVATION_ID
      ),
      slot: targeting('privateLessonSlots', SLOT_ID),
    },
    credits: embeddedCredits,
  })
}

function refingerprint(record) {
  const value = structuredClone(record)
  delete value.auditFingerprint
  return fp(value)
}

function sameRawUnlinkedEvidence(rawId) {
  return ['lessons', 'reservations', 'slots'].map((rootFamily) => {
    const targetType = rootFamily === 'lessons'
      ? 'lesson'
      : rootFamily === 'reservations'
        ? 'reservation'
        : 'slot'
    const row = structuredClone(occurrence({
      rootFamily,
      rootId: rawId,
      occurrenceKey: `${targetType}:${rawId}`,
    }))
    const links = { lessonId: null, reservationId: null, slotId: null }
    links[`${targetType}Id`] = rawId
    applyExplicitOccurrenceLinks(row, links)
    for (const type of ['lesson', 'reservation', 'slot']) {
      const exists = type === targetType
      row[`${type}Id`] = exists ? rawId : null
      row.documentPresence[type] = exists
      row.documentScopes[type] = documentScope(
        exists ? rawId : null,
        { exists }
      )
    }
    return refingerprint(row)
  })
}

function sameRawUnlinkedAudit(rawId) {
  return [
    ['fixedLessons', 'lesson'],
    ['fixedReservations', 'reservation'],
    ['fixedSlots', 'slot'],
  ].map(([rootFamily, targetType]) => {
    const row = structuredClone(oldOccurrence())
    delete row.auditFingerprint
    row.rootFamily = rootFamily
    row.rootId = rawId
    row.occurrenceKey = `${targetType}:${rawId}`
    row.lessonId = targetType === 'lesson' ? rawId : ''
    row.reservationId = targetType === 'reservation' ? rawId : ''
    row.slotId = targetType === 'slot' ? rawId : ''
    row.fixedFamilies = {
      lesson: targetType === 'lesson',
      reservation: targetType === 'reservation',
      slot: targetType === 'slot',
    }
    row.exists = {
      lesson: targetType === 'lesson',
      package: true,
      reservation: targetType === 'reservation',
      slot: targetType === 'slot',
    }
    return fp(row)
  })
}

function evidenceRecords({
  terminal = false, packageIds = [PACKAGE_ID], roots = ['lessons'],
  generalDirect = false, orphanCredit = false, creditRecords,
  customOccurrences,
} = {}) {
  const result = Object.fromEntries(
    REMEDIATION_EVIDENCE_SCAN_FAMILIES.map((family) => [family, []])
  )
  if (!orphanCredit) {
    if (customOccurrences) {
      for (const row of customOccurrences) result[row.rootFamily].push(row)
    } else {
      for (const rootFamily of roots) {
        result[rootFamily].push(occurrence({
          rootFamily,
          rootId: rootFamily === 'lessons' ? LESSON_ID
            : rootFamily === 'reservations' ? RESERVATION_ID : SLOT_ID,
          terminal, packageIds, creditRecords,
        }))
      }
    }
    if (generalDirect) {
      const direct = structuredClone(occurrence({
        rootFamily: 'reservations', rootId: 'general-direct',
        occurrenceKey: 'reservation:general-direct', isFixed: false,
        rawSource: null,
      }))
      applyExplicitOccurrenceLinks(direct, {
        lessonId: null,
        reservationId: 'general-direct',
        slotId: null,
      })
      direct.lessonId = null
      direct.reservationId = 'general-direct'
      direct.slotId = null
      direct.documentPresence.lesson = false
      direct.documentPresence.reservation = true
      direct.documentPresence.slot = false
      direct.documentScopes.lesson = documentScope(null, { exists: false })
      direct.documentScopes.reservation = documentScope('general-direct')
      direct.documentScopes.slot = documentScope(null, { exists: false })
      result.reservations.push(refingerprint(direct))
      result.credits.push(generalCreditRecord())
    }
    result.memberships = [membershipRecord()]
    result.packages = packageIds.map((id) =>
      packageRecord(id, terminal && id === PACKAGE_ID ? 1 : 0)
    )
  }
  if (creditRecords) result.credits = creditRecords
  else if (terminal || orphanCredit) result.credits = [creditRecord()]
  return result
}

function evidencePage(family, records) {
  return {
    evidenceVersion: 1, academyId: ACADEMY_ID, scanFamily: family,
    dryRun: true, previewOnly: true, commit: false,
    page: {
      pageSize: 50, returnedCount: records.length,
      scannedCount: records.length, hasMore: false, nextCursor: null,
      complete: true, truncated: false, omittedCount: 0,
    },
    records, pageDigest: remediationEvidencePageDigest(records),
    schemaDigest: remediationEvidenceSchemaDigest(),
  }
}

const baseEnv = (overrides = {}) => ({
  PROJECT_ID: 'daegu-miami-production',
  CONFIRM_PRODUCTION_READONLY_AUDIT: 'YES',
  CONFIRM_FIXED_PRIVATE_WRITE_QUIET_WINDOW: 'YES',
  ACADEMY_ID, FIREBASE_ID_TOKEN: TOKEN, ...overrides,
})
const sensitiveEnv = (directory, overrides = {}) => baseEnv({
  AUDIT_REDACTED_OUTPUT: path.join(directory, 'redacted.json'),
  AUDIT_REDACTION_KEY: REDACTION_KEY,
  AUDIT_SENSITIVE_REMEDIATION_OUTPUT: path.join(directory, 'manifest.json'),
  CONFIRM_SENSITIVE_LOCAL_REMEDIATION_MANIFEST: 'YES',
  ...overrides,
})
function mockFetch({ audit = {}, evidence = {}, mutate, calls = [] } = {}) {
  let evidenceCalls = 0
  return async (_url, options) => {
    const request = JSON.parse(options.body).data
    if (request.auditVersion === 2) {
      calls.push(`audit:${request.scanFamily}`)
      return {
        ok: true, status: 200,
        async json() {
          return { result: auditPage(request.scanFamily, audit) }
        },
      }
    }
    assert.equal(request.cursor, null)
    calls.push(`evidence:${request.scanFamily}`)
    const runIndex = Math.floor(
      evidenceCalls++ / REMEDIATION_EVIDENCE_SCAN_FAMILIES.length
    )
    const families = evidenceRecords(evidence)
    let result = evidencePage(request.scanFamily, families[request.scanFamily])
    if (mutate) {
      const returnedCount = result.page.returnedCount
      const scannedCount = result.page.scannedCount
      result = mutate(structuredClone(result), {
        family: request.scanFamily, runIndex,
      }) || result
      if (result.page.returnedCount === returnedCount) {
        result.page.returnedCount = result.records.length
      }
      if (result.page.scannedCount === scannedCount) {
        result.page.scannedCount = result.records.length
      }
      result.pageDigest = remediationEvidencePageDigest(result.records)
    }
    return { ok: true, status: 200, async json() { return { result } } }
  }
}
function temp(t, prefix = 'fixed-private-final-') {
  const directory = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), prefix))
  )
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  return directory
}
const readManifest = (env) =>
  JSON.parse(fs.readFileSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT, 'utf8'))

test('최종 스키마, fingerprint, null 종단 커서를 엄격히 검증한다', () => {
  const functionsSource = fs.readFileSync(
    new URL('../functions/index.js', import.meta.url),
    'utf8'
  )
  const schemaStart = functionsSource.indexOf(
    'const FIXED_PRIVATE_REMEDIATION_EVIDENCE_SCHEMA = '
  )
  const schemaEnd = functionsSource.indexOf(
    ';\n\nfunction fixedPrivateRemediationEvidenceDigest',
    schemaStart
  )
  assert.notEqual(schemaStart, -1)
  assert.notEqual(schemaEnd, -1)
  const callableSchemaLiteral = functionsSource
    .slice(
      schemaStart +
        'const FIXED_PRIVATE_REMEDIATION_EVIDENCE_SCHEMA = '.length,
      schemaEnd
    )
    .replace('FIXED_PRIVATE_REMEDIATION_EVIDENCE_VERSION', '1')
  const callableSchema = Function(
    `"use strict"; return (${callableSchemaLiteral});`
  )()
  assert.deepEqual(REMEDIATION_EVIDENCE_SCHEMA, callableSchema)
  assert.equal(remediationEvidenceSchemaDigest(), hash(stable(
    REMEDIATION_EVIDENCE_SCHEMA
  )))
  const valid = evidencePage('lessons', [occurrence()])
  assert.equal(validateRemediationEvidencePage(valid, {
    academyId: ACADEMY_ID, scanFamily: 'lessons',
  }), valid)
  for (const mutate of [
    (row) => { row.future = true },
    (row) => { row.page.nextCursor = '' },
    (row) => { row.records[0].future = true },
    (row) => { delete row.records[0].statusDeduction.lesson.timestamps },
    (row) => { row.records[0].credits = [{}] },
    (row) => { row.records[0].documentPresence.students = [] },
    (row) => { delete row.records[0].storedLinkAliases },
    (row) => { delete row.records[0].storedLinkConflict },
    (row) => {
      row.records[0].documentPresence.students[0].id =
        'mismatched-student-presence-id'
    },
    (row) => { row.schemaDigest = '0'.repeat(64) },
    (row) => { row.pageDigest = '0'.repeat(64) },
  ]) {
    const malformed = structuredClone(valid)
    mutate(malformed)
    assert.throws(() => validateRemediationEvidencePage(malformed, {
      academyId: ACADEMY_ID, scanFamily: 'lessons',
    }))
  }
  const mixedStudents = structuredClone(occurrence())
  delete mixedStudents.auditFingerprint
  mixedStudents.studentCandidateIds = [
    'foreign-student-id',
    'missing-student-id',
    STUDENT_ID,
  ].sort()
  mixedStudents.studentId = null
  mixedStudents.documentPresence.students = [
    documentScope('foreign-student-id', { academyId: 'foreign-academy-id' }),
    documentScope('missing-student-id', { exists: false }),
    documentScope(STUDENT_ID),
  ]
  mixedStudents.documentPresence.student = false
  mixedStudents.documentScopes.student =
    documentScope(null, { exists: false })
  const mixedPage = evidencePage('lessons', [fp(mixedStudents)])
  assert.equal(validateRemediationEvidencePage(mixedPage, {
    academyId: ACADEMY_ID,
    scanFamily: 'lessons',
  }), mixedPage)
})

test('stored link alias의 linked-only, 동일값, 충돌을 엄격히 검증한다', () => {
  const linkedOnly = structuredClone(occurrence())
  for (const [target, linkedField] of [
    ['lesson', 'linkedLessonId'],
    ['reservation', 'linkedReservationId'],
    ['slot', 'linkedSlotId'],
  ]) {
    const directField = `${target}Id`
    linkedOnly.storedLinks.lesson[linkedField] =
      linkedOnly.storedLinks.lesson[directField]
    linkedOnly.storedLinks.lesson[directField] = null
  }
  linkedOnly.storedLinkAliases = linkAliases(linkedOnly.storedLinks)
  validateRemediationEvidencePage(
    evidencePage('lessons', [refingerprint(linkedOnly)]),
    { academyId: ACADEMY_ID, scanFamily: 'lessons' }
  )

  const same = structuredClone(occurrence())
  same.storedLinks.lesson.linkedLessonId = LESSON_ID
  same.storedLinkAliases = linkAliases(same.storedLinks)
  validateRemediationEvidencePage(
    evidencePage('lessons', [refingerprint(same)]),
    { academyId: ACADEMY_ID, scanFamily: 'lessons' }
  )

  const conflict = structuredClone(occurrence())
  conflict.storedLinks.lesson.slotId = 'conflicting-slot-alias'
  conflict.storedLinkAliases = linkAliases(conflict.storedLinks)
  conflict.storedLinkConflict = true
  conflict.resolvedLinks.slotId = null
  const conflictRecord = refingerprint(conflict)
  validateRemediationEvidencePage(
    evidencePage('lessons', [conflictRecord]),
    { academyId: ACADEMY_ID, scanFamily: 'lessons' }
  )
  assert.equal(conflictRecord.storedLinkAliases.lesson.slot.resolvedValue, null)
  assert.equal(conflictRecord.storedLinkAliases.lesson.slot.conflict, true)

  const invalidResolved = structuredClone(conflictRecord)
  invalidResolved.resolvedLinks.slotId = SLOT_ID
  assert.throws(() => validateRemediationEvidencePage(
    evidencePage('lessons', [refingerprint(invalidResolved)]),
    { academyId: ACADEMY_ID, scanFamily: 'lessons' }
  ))

  const foreignAliases = structuredClone(occurrence())
  foreignAliases.documentScopes.slot =
    documentScope(SLOT_ID, { academyId: 'foreign-academy-id' })
  assert.throws(() => validateRemediationEvidencePage(
    evidencePage('lessons', [refingerprint(foreignAliases)]),
    { academyId: ACADEMY_ID, scanFamily: 'lessons' }
  ))
})

test('evidence page 카운트는 records와 정확히 같아야 한다', () => {
  const records = Array.from({ length: 50 }, (_, index) =>
    creditRecord({ id: `credit-page-${index}` })
  )
  const full = evidencePage('credits', records)
  assert.equal(validateRemediationEvidencePage(full, {
    academyId: ACADEMY_ID,
    scanFamily: 'credits',
  }), full)
  const zero = evidencePage('credits', [])
  assert.equal(validateRemediationEvidencePage(zero, {
    academyId: ACADEMY_ID,
    scanFamily: 'credits',
  }), zero)

  for (const mutate of [
    (page) => {
      page.page.scannedCount = 50
      page.page.returnedCount = 49
    },
    (page) => {
      page.page.scannedCount = 51
      page.page.returnedCount = 50
    },
    (page) => {
      page.records.pop()
      page.page.scannedCount = 50
      page.page.returnedCount = 50
      page.pageDigest = remediationEvidencePageDigest(page.records)
    },
  ]) {
    const invalid = structuredClone(full)
    mutate(invalid)
    assert.throws(() => validateRemediationEvidencePage(invalid, {
      academyId: ACADEMY_ID,
      scanFamily: 'credits',
    }))
  }
})

test('page count 위반과 필드 누락은 어떤 artifact도 쓰지 않는다', async (t) => {
  for (const mode of ['count', 'omission']) {
    const directory = temp(t, `no-artifact-${mode}-`)
    const env = sensitiveEnv(directory)
    const code = await executeAuditCli({
      env,
      fetchImpl: mockFetch({
        mutate(page, { family, runIndex }) {
          if (family === 'lessons' && runIndex === 0) {
            if (mode === 'count') {
              page.page.scannedCount = 50
              page.page.returnedCount = 49
            } else {
              delete page.records[0].storedLinkAliases
            }
          }
          return page
        },
      }),
      writeOutput() {},
      writeError() {},
    })
    assert.equal(code, 1)
    assert.equal(fs.existsSync(env.AUDIT_REDACTED_OUTPUT), false)
    assert.equal(fs.existsSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT), false)
    assert.equal(
      fs.readdirSync(directory).some((name) => name.endsWith('.tmp')),
      false
    )
  }
})

test('well-typed incomplete evidence는 exit3이며 매니페스트를 쓰지 않는다', async (t) => {
  for (const incomplete of ['truncated', 'omitted', 'terminal-incomplete']) {
    const directory = temp(t, `incomplete-${incomplete}-`)
    const env = sensitiveEnv(directory)
    const code = await executeAuditCli({
      env,
      fetchImpl: mockFetch({
        mutate(page, { family, runIndex }) {
          if (family !== 'lessons' || runIndex !== 0) return page
          if (incomplete === 'truncated') page.page.truncated = true
          if (incomplete === 'omitted') page.page.omittedCount = 1
          if (incomplete === 'terminal-incomplete') page.page.complete = false
          return page
        },
      }),
      writeOutput() {},
      writeError() {},
    })
    assert.equal(code, 3, incomplete)
    assert.equal(fs.existsSync(env.AUDIT_REDACTED_OUTPUT), false)
    assert.equal(fs.existsSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT), false)
  }
})

test('민감 환경과 경로 가드는 fetch 전에 실패한다', async (t) => {
  const directory = temp(t)
  const existing = path.join(directory, 'existing.json')
  fs.writeFileSync(existing, 'existing')
  const symlink = path.join(directory, 'symlink.json')
  fs.symlinkSync(existing, symlink)
  const realParent = path.join(directory, 'real-parent')
  const realChild = path.join(realParent, 'child')
  fs.mkdirSync(realChild, { recursive: true })
  const parentSymlink = path.join(directory, 'parent-symlink')
  fs.symlinkSync(realParent, parentSymlink)
  const repository = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
  const invalid = [
    baseEnv({ AUDIT_SENSITIVE_REMEDIATION_OUTPUT: path.join(directory, 'x') }),
    sensitiveEnv(directory, { AUDIT_SENSITIVE_REMEDIATION_OUTPUT: 'relative' }),
    sensitiveEnv(directory, { AUDIT_SENSITIVE_REMEDIATION_OUTPUT: existing }),
    sensitiveEnv(directory, { AUDIT_SENSITIVE_REMEDIATION_OUTPUT: symlink }),
    sensitiveEnv(directory, {
      AUDIT_SENSITIVE_REMEDIATION_OUTPUT: path.join(parentSymlink, 'direct.json'),
    }),
    sensitiveEnv(directory, {
      AUDIT_SENSITIVE_REMEDIATION_OUTPUT:
        path.join(parentSymlink, 'child', 'ancestor.json'),
    }),
    sensitiveEnv(directory, {
      AUDIT_SENSITIVE_REMEDIATION_OUTPUT: path.join(repository, '.git', 'x'),
    }),
  ]
  for (const env of invalid) {
    let fetches = 0
    const code = await executeAuditCli({
      env, fetchImpl: async () => { fetches++; throw new Error('network') },
      writeOutput() {}, writeError() {},
    })
    assert.equal(code, 1)
    assert.equal(fetches, 0)
  }
})

test('일반 직접 행 제외와 한·두 root family를 허용한다', async (t) => {
  for (const roots of [['lessons'], ['lessons', 'reservations']]) {
    const directory = temp(t, `roots-${roots.length}-`)
    const env = sensitiveEnv(directory)
    const summary = await runProductionAudit({
      env, fetchImpl: mockFetch({ evidence: { roots, generalDirect: true } }),
    })
    assert.equal(summary.pass, true)
    const manifest = readManifest(env)
    assert.equal(manifest.occurrences.length, 1)
    assert.equal(manifest.nonOccurrenceEvidence.length, 0)
    assert.equal(JSON.stringify(manifest).includes('general-direct'), false)
  }
})

test('동일 raw ID는 collection별로 분리되고 명시적 typed link만 합친다', async (t) => {
  const rawId = 'same-raw-id-across-three-collections'
  for (const linked of [false, true]) {
    let evidenceOccurrences = sameRawUnlinkedEvidence(rawId)
    let auditOccurrences = sameRawUnlinkedAudit(rawId)
    if (linked) {
      const [lessonEvidence, reservationEvidence] =
        evidenceOccurrences.map((row) => structuredClone(row))
      applyExplicitOccurrenceLinks(lessonEvidence, {
        lessonId: rawId,
        reservationId: rawId,
        slotId: null,
      })
      lessonEvidence.reservationId = rawId
      lessonEvidence.documentPresence.reservation = true
      lessonEvidence.documentScopes.reservation = documentScope(rawId)
      applyExplicitOccurrenceLinks(reservationEvidence, {
        lessonId: rawId,
        reservationId: rawId,
        slotId: null,
      })
      reservationEvidence.lessonId = rawId
      reservationEvidence.documentPresence.lesson = true
      reservationEvidence.documentScopes.lesson = documentScope(rawId)
      reservationEvidence.occurrenceKey = `lesson:${rawId}`
      evidenceOccurrences = [
        refingerprint(lessonEvidence),
        refingerprint(reservationEvidence),
        evidenceOccurrences[2],
      ]

      const [lessonAudit, reservationAudit] =
        auditOccurrences.map((row) => structuredClone(row))
      for (const row of [lessonAudit, reservationAudit]) {
        delete row.auditFingerprint
        row.lessonId = rawId
        row.reservationId = rawId
        row.occurrenceKey = `lesson:${rawId}`
        row.fixedFamilies.lesson = true
        row.fixedFamilies.reservation = true
        row.exists.lesson = true
        row.exists.reservation = true
      }
      auditOccurrences = [
        fp(lessonAudit),
        fp(reservationAudit),
        auditOccurrences[2],
      ]
    }

    const directory = temp(t, `typed-groups-${linked}-`)
    const env = sensitiveEnv(directory)
    await runProductionAudit({
      env,
      fetchImpl: mockFetch({
        audit: { auditOccurrences },
        evidence: {
          customOccurrences: evidenceOccurrences,
          roots: [],
        },
      }),
    })
    const manifest = readManifest(env)
    assert.equal(manifest.occurrences.length, linked ? 2 : 3)
    const allIdentityIds = manifest.occurrences.flatMap((row) => row.identityIds)
    for (const type of ['lesson', 'reservation', 'slot']) {
      assert.equal(
        allIdentityIds.includes(buildTypedDocumentKey(type, rawId)),
        true
      )
    }
    assert.equal(
      manifest.occurrences.every((row) =>
        row.identityIds.every((id) => /^(lesson|reservation|slot):/.test(id))
      ),
      true
    )
  }
})

test('충돌한 stored alias는 occurrence identity edge로 재사용하지 않는다', () => {
  const record = structuredClone(occurrence())
  record.resolvedLinks.reservationId = null
  record.storedLinks.lesson.reservationId = 'reservation-alias-a'
  record.storedLinks.slot.reservationId = 'reservation-alias-b'
  record.storedLinkAliases = linkAliases(record.storedLinks)
  record.storedLinkConflict = true

  const identities = evidenceVariantIdentityIds(record)
  assert.equal(
    identities.includes(
      buildTypedDocumentKey('reservation', 'reservation-alias-a')
    ),
    false
  )
  assert.equal(
    identities.includes(
      buildTypedDocumentKey('reservation', 'reservation-alias-b')
    ),
    false
  )
  assert.equal(
    identities.includes(buildTypedDocumentKey('lesson', LESSON_ID)),
    true
  )
  assert.equal(
    identities.every((id) => /^(lesson|reservation|slot):/.test(id)),
    true
  )
})

test('링크 disagreement는 variants로 보존하고 실행 drift는 exit3이다', async (t) => {
  for (const runDrift of [false, true]) {
    const directory = temp(t, `drift-${runDrift}-`)
    const env = sensitiveEnv(directory)
    const code = await executeAuditCli({
      env,
      fetchImpl: mockFetch({
        evidence: { roots: runDrift ? ['lessons'] : ['lessons', 'reservations'] },
        mutate(page, { family, runIndex }) {
          if (
            (!runDrift && family === 'reservations') ||
            (runDrift && runIndex === 1 && family === 'lessons')
          ) {
            const changed = structuredClone(page.records[0])
            changed.schedule.lesson.date = '2026-07-15'
            if (!runDrift) {
              changed.storedLinks.reservation.linkedSlotId =
                'raw-mismatched-slot-id'
              changed.storedLinkAliases = linkAliases(changed.storedLinks)
              changed.storedLinkConflict = true
              changed.resolvedLinks.slotId = null
            }
            delete changed.auditFingerprint
            page.records[0] = fp(changed)
          }
          return page
        },
      }),
      writeOutput() {}, writeError() {},
    })
    assert.equal(code, runDrift ? 3 : 0)
    assert.equal(
      fs.existsSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT),
      !runDrift
    )
    if (!runDrift) {
      const row = readManifest(env).occurrences[0]
      assert.equal(row.occurrenceKey, RAW_KEY)
      assert.equal(row.evidenceVariants.length, 2)
      assert.deepEqual(
        row.evidenceVariants.map((variant) => variant.rootFamily),
        ['lessons', 'reservations']
      )
      assert.equal(
        row.evidenceVariants[1].resolvedLinks.slotId,
        null
      )
    }
  }
})

test('같은 root의 상충 duplicate는 fail-closed 한다', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  const code = await executeAuditCli({
    env,
    fetchImpl: mockFetch({
      mutate(page, { family }) {
        if (family === 'lessons') {
          const duplicate = structuredClone(page.records[0])
          duplicate.schedule.lesson.date = '2026-07-15'
          delete duplicate.auditFingerprint
          page.records.push(fp(duplicate))
        }
        return page
      },
    }),
    writeOutput() {}, writeError() {},
  })
  assert.equal(code, 1)
  assert.equal(fs.existsSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT), false)
})

test('중간 ID bridge를 통한 전이적 overlap을 한 그룹으로 합친다', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env,
    fetchImpl: mockFetch({
      evidence: { roots: ['lessons', 'reservations', 'slots'] },
      mutate(page, { family }) {
        if (!['lessons', 'reservations', 'slots'].includes(family)) return page
        const changed = structuredClone(page.records[0])
        if (family === 'lessons') {
          applyExplicitOccurrenceLinks(changed, {
            lessonId: LESSON_ID,
            reservationId: 'bridge-reservation-id',
            slotId: null,
          })
          changed.reservationId = 'bridge-reservation-id'
          changed.slotId = null
          changed.documentScopes.reservation =
            documentScope('bridge-reservation-id')
          changed.documentScopes.slot = documentScope(null, { exists: false })
          changed.documentPresence.reservation = true
          changed.documentPresence.slot = false
        } else if (family === 'reservations') {
          changed.rootId = 'bridge-reservation-id'
          applyExplicitOccurrenceLinks(changed, {
            lessonId: null,
            reservationId: 'bridge-reservation-id',
            slotId: 'bridge-slot-id',
          })
          changed.lessonId = null
          changed.reservationId = 'bridge-reservation-id'
          changed.slotId = 'bridge-slot-id'
          changed.documentScopes.lesson = documentScope(null, { exists: false })
          changed.documentScopes.reservation =
            documentScope('bridge-reservation-id')
          changed.documentScopes.slot = documentScope('bridge-slot-id')
          changed.documentPresence.lesson = false
          changed.documentPresence.reservation = true
          changed.documentPresence.slot = true
        } else {
          changed.rootId = 'bridge-slot-id'
          applyExplicitOccurrenceLinks(changed, {
            lessonId: null,
            reservationId: null,
            slotId: 'bridge-slot-id',
          })
          changed.lessonId = null
          changed.reservationId = null
          changed.slotId = 'bridge-slot-id'
          changed.documentScopes.lesson = documentScope(null, { exists: false })
          changed.documentScopes.reservation =
            documentScope(null, { exists: false })
          changed.documentScopes.slot = documentScope('bridge-slot-id')
          changed.documentPresence.lesson = false
          changed.documentPresence.reservation = false
          changed.documentPresence.slot = true
        }
        delete changed.auditFingerprint
        page.records = [fp(changed)]
        return page
      },
    }),
  })
  const row = readManifest(env).occurrences[0]
  assert.equal(row.evidenceVariants.length, 3)
  assert.deepEqual(row.identityIds, [
    buildTypedDocumentKey('lesson', LESSON_ID),
    buildTypedDocumentKey('reservation', 'bridge-reservation-id'),
    buildTypedDocumentKey('slot', 'bridge-slot-id'),
  ].sort())
})

test('누락 링크 null과 다중 패키지를 추측 없이 유지한다', async (t) => {
  const missing = occurrence({ missingReservation: true })
  validateRemediationEvidencePage(evidencePage('lessons', [missing]), {
    academyId: ACADEMY_ID, scanFamily: 'lessons',
  })
  assert.equal(missing.resolvedLinks.reservationId, null)
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env, fetchImpl: mockFetch({
      evidence: { packageIds: [PACKAGE_ID, PACKAGE_ID_2] },
    }),
  })
  const row = readManifest(env).occurrences[0]
  assert.equal(row.evidenceVariants[0].packageId, null)
  assert.deepEqual(row.packageCandidateIds, [PACKAGE_ID, PACKAGE_ID_2])
})

test('missing package와 credit를 명시적 null join으로 보존한다', async (t) => {
  for (const missingFamily of ['packages', 'credits']) {
    const directory = temp(t, `missing-join-${missingFamily}-`)
    const env = sensitiveEnv(directory)
    const missingCredit = missingFamily === 'credits'
    const fetchImpl = mockFetch({
        audit: missingCredit
          ? { auditCredits: [], missingCredit: true, terminal: true }
          : { packageExists: false },
        evidence: { terminal: missingCredit },
        mutate(page, { family }) {
          if (family === 'lessons') {
            const changed = structuredClone(page.records[0])
            if (missingCredit) {
              changed.credits = []
              changed.documentPresence.credits = [
                documentScope(CREDIT_ID, { exists: false }),
              ]
            } else {
              changed.documentPresence.package = false
              changed.packageCandidates[0] = {
                ...changed.packageCandidates[0],
                academyId: null,
                academyScoped: null,
                exists: false,
                remainingCount: null,
                scope: null,
                status: null,
                studentId: null,
                totalCount: null,
                type: null,
                usedCount: null,
              }
              changed.documentPresence.packages[0] =
                documentScope(PACKAGE_ID, { exists: false })
            }
            delete changed.auditFingerprint
            page.records = [fp(changed)]
          } else if (family === missingFamily) {
            page.records = []
          }
          return page
        },
    })
    const summary = await runProductionAudit({ env, fetchImpl })
    assert.equal(summary.blockerTotal > 0, true, missingFamily)
    const join = readManifest(env).occurrences[0].joinEvidence[
      missingFamily
    ][0]
    assert.deepEqual(join, {
      academyScoped: null,
      evidence: null,
      exists: false,
      id: missingFamily === 'credits' ? CREDIT_ID : PACKAGE_ID,
    })
  }
})

test('audit/evidence package 존재 모순은 fail-closed 한다', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  const code = await executeAuditCli({
    env,
    fetchImpl: mockFetch({
      mutate(page, { family }) {
        if (family === 'lessons') {
          const changed = structuredClone(page.records[0])
          changed.documentPresence.package = false
          changed.packageCandidates[0] = {
            ...changed.packageCandidates[0],
            academyId: null,
            academyScoped: null,
            exists: false,
            remainingCount: null,
            scope: null,
            status: null,
            studentId: null,
            totalCount: null,
            type: null,
            usedCount: null,
          }
          changed.documentPresence.packages[0] =
            documentScope(PACKAGE_ID, { exists: false })
          delete changed.auditFingerprint
          page.records = [fp(changed)]
        } else if (family === 'packages') {
          page.records = []
        }
        return page
      },
    }),
    writeOutput() {}, writeError() {},
  })
  assert.equal(code, 1)
  assert.equal(fs.existsSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT), false)
})

test('joins와 완전한 원시 evidence를 매니페스트에 보존한다', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env, fetchImpl: mockFetch({
      audit: { terminal: true }, evidence: { terminal: true },
    }),
  })
  const manifest = readManifest(env)
  validateSensitiveRemediationManifest(manifest)
  const row = manifest.occurrences[0]
  assert.deepEqual(row.creditIds, [CREDIT_ID])
  assert.equal(row.joinEvidence.credits[0].evidence.id, CREDIT_ID)
  assert.equal(row.joinEvidence.credits[0].academyScoped, true)
  assert.deepEqual(row.membershipIds, [MEMBERSHIP_ID])
  assert.equal(row.joinEvidence.memberships[0].evidence.id, MEMBERSHIP_ID)
  assert.equal(row.joinEvidence.packages[0].evidence.id, PACKAGE_ID)
  const variant = row.evidenceVariants[0]
  assert.equal(variant.teacher.matchedMemberships[0].id, MEMBERSHIP_ID)
  assert.equal(variant.provenance.raw.lesson.source, 'fixed_admin_assignment')
  assert.equal(variant.statusDeduction.lesson.requestId, 'raw-status-request-id')
  assert.equal(variant.schedule.lesson.date, '2026-07-14')
  assert.equal(variant.ledgerTargeting.lesson.collectionFamily, 'lessons')
  const incompleteJoin = structuredClone(manifest)
  incompleteJoin.occurrences[0].joinEvidence.packages = []
  assert.throws(() => validateSensitiveRemediationManifest(incompleteJoin))
  const falseScope = structuredClone(manifest)
  falseScope.occurrences[0].joinEvidence.credits[0].academyScoped = false
  assert.throws(() => validateSensitiveRemediationManifest(falseScope))
})

test('generic negative linked credit는 parity에 포함하되 unmatched로 만들지 않는다', async (t) => {
  const id = 'generic-negative-linked-credit'
  const auditCredit = oldCredit({
    id,
    actionType: '',
    lessonId: '',
    ledgerTransition: '',
    marker: '',
    slotId: '',
    sourceType: '',
  })
  const evidenceCredit = creditRecord({
    id,
    actionType: null,
    fixedPrivateDeductionLedger: null,
    ledgerTransition: null,
    sourceType: null,
    targeting: {
      lessonId: null,
      slotId: null,
      sourceId: RESERVATION_ID,
    },
  })
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env,
    fetchImpl: mockFetch({
      audit: { auditCredits: [auditCredit] },
      evidence: { creditRecords: [evidenceCredit] },
    }),
  })
  const manifest = readManifest(env)
  assert.deepEqual(manifest.occurrences[0].creditIds, [id])
  assert.equal(manifest.nonOccurrenceEvidence.length, 0)
})

test('positive non-fixed declared credit는 deduction parity에서 제외한다', async (t) => {
  const id = 'positive-non-fixed-declared-credit'
  const auditCredit = oldCredit({
    id,
    actionType: '',
    deltaCount: 1,
    ledgerTransition: '',
    marker: '',
    sourceType: '',
  })
  const evidenceCredit = creditRecord({
    id,
    actionType: null,
    deltaCount: 1,
    effect: 'neutral',
    fixedPrivateDeductionLedger: null,
    isDeduction: false,
    ledgerTransition: null,
    sourceType: null,
    targeting: {
      lessonId: null,
      slotId: null,
      sourceId: RESERVATION_ID,
    },
  })
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env,
    fetchImpl: mockFetch({
      audit: { auditCredits: [auditCredit] },
      evidence: { creditRecords: [evidenceCredit] },
    }),
  })
  const manifest = readManifest(env)
  assert.deepEqual(manifest.occurrences[0].creditIds, [id])
  assert.equal(manifest.nonOccurrenceEvidence.length, 0)
})

test('reservationId-only evidence source는 audit sourceId fallback과 일치한다', async (t) => {
  const evidenceCredit = creditRecord({
    targeting: {
      reservationId: RESERVATION_ID,
      sourceId: null,
    },
  })
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env,
    fetchImpl: mockFetch({
      audit: { auditCredits: [oldCredit()] },
      evidence: { creditRecords: [evidenceCredit] },
    }),
  })
  const manifest = readManifest(env)
  assert.equal(
    manifest.occurrences[0].joinEvidence.credits[0].evidence.targeting.sourceId,
    null
  )
  assert.equal(
    manifest.occurrences[0].joinEvidence.credits[0].evidence.targeting
      .reservationId,
    RESERVATION_ID
  )
})

test('student/package-only fixed credit는 occurrence에 붙이지 않고 unmatched로 보존한다', async (t) => {
  const auditCredit = oldCredit({
    lessonId: '',
    sourceId: '',
    slotId: '',
  })
  const evidenceCredit = creditRecord({
    targeting: {
      sourceId: null,
      reservationId: null,
      linkedReservationId: null,
      lessonId: null,
      fixedLessonId: null,
      linkedLessonId: null,
      slotId: null,
      linkedSlotId: null,
    },
  })
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  const code = await executeAuditCli({
    env,
    fetchImpl: mockFetch({
      audit: { auditCredits: [auditCredit] },
      evidence: { creditRecords: [evidenceCredit] },
    }),
    writeOutput() {},
    writeError() {},
  })
  assert.equal(code, 2)
  const manifest = readManifest(env)
  assert.deepEqual(manifest.occurrences[0].creditIds, [])
  assert.equal(manifest.nonOccurrenceEvidence.length, 1)
  assert.equal(
    manifest.nonOccurrenceEvidence[0].evidenceKey,
    `credit:${CREDIT_ID}`
  )
  assert.equal(manifest.nonOccurrenceEvidence[0].creditEvidence.id, CREDIT_ID)
})

test('서로 다른 typed 그룹을 가리키는 credit는 ambiguous fail-closed 한다', async (t) => {
  const rawId = 'ambiguous-credit-target-id'
  const auditOccurrences = sameRawUnlinkedAudit(rawId)
  const evidenceOccurrences = sameRawUnlinkedEvidence(rawId)
  const auditCredit = oldCredit({
    sourceId: rawId,
    lessonId: rawId,
    slotId: '',
  })
  const evidenceCredit = creditRecord({
    targeting: {
      sourceId: rawId,
      lessonId: rawId,
      slotId: null,
    },
  })
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  const code = await executeAuditCli({
    env,
    fetchImpl: mockFetch({
      audit: { auditCredits: [auditCredit], auditOccurrences },
      evidence: {
        creditRecords: [evidenceCredit],
        customOccurrences: evidenceOccurrences,
      },
    }),
    writeOutput() {},
    writeError() {},
  })
  assert.equal(code, 1)
  assert.equal(fs.existsSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT), false)
  assert.equal(fs.existsSync(env.AUDIT_REDACTED_OUTPUT), false)
})

test('직접 target과 student/package 불일치는 audit blocker와 함께 보존한다', async (t) => {
  const conflictingStudent = 'conflicting-credit-student-id'
  const auditCredit = oldCredit({ studentId: conflictingStudent })
  const evidenceCredit = creditRecord({ studentId: conflictingStudent })
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  const code = await executeAuditCli({
    env,
    fetchImpl: mockFetch({
      audit: { auditCredits: [auditCredit] },
      evidence: { creditRecords: [evidenceCredit] },
    }),
    writeOutput() {},
    writeError() {},
  })
  assert.equal(code, 2)
  const row = readManifest(env).occurrences[0]
  assert.deepEqual(row.creditIds, [CREDIT_ID])
  assert.equal(
    row.blockingCategories.includes('conflictingDeductionEvidence'),
    true
  )
  assert.equal(row.joinEvidence.credits[0].evidence.studentId, conflictingStudent)
})

test('foreign package와 credit는 비 academy-scoped join으로 보존한다', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env,
    fetchImpl: mockFetch({
      audit: {
        auditCredits: [],
        declaredCredits: [
          oldCredit({ academyId: 'foreign-academy-id' }),
        ],
        terminal: true,
      },
      evidence: { terminal: true },
      mutate(page, { family }) {
        if (family === 'lessons') {
          const changed = structuredClone(page.records[0])
          changed.packageCandidates[0].academyId = 'foreign-academy-id'
          changed.packageCandidates[0].academyScoped = false
          for (const field of [
            'studentId', 'type', 'scope', 'status', 'totalCount', 'usedCount',
            'remainingCount',
          ]) changed.packageCandidates[0][field] = null
          changed.documentPresence.packages[0] = documentScope(
            PACKAGE_ID,
            { academyId: 'foreign-academy-id' }
          )
          changed.credits = [foreignCreditRecord()]
          changed.documentPresence.credits[0] = documentScope(
            CREDIT_ID,
            { academyId: 'foreign-academy-id' }
          )
          delete changed.auditFingerprint
          page.records = [fp(changed)]
        } else if (family === 'packages' || family === 'credits') {
          page.records = []
        }
        return page
      },
    }),
  })
  const row = readManifest(env).occurrences[0]
  assert.deepEqual(row.joinEvidence.packages.map(({ academyScoped, id }) => ({
    academyScoped, id,
  })), [{ academyScoped: false, id: PACKAGE_ID }])
  assert.deepEqual(row.joinEvidence.credits.map(({ academyScoped, id }) => ({
    academyScoped, id,
  })), [{ academyScoped: false, id: CREDIT_ID }])
  assert.equal(
    row.joinEvidence.packages[0].evidence.academyId,
    'foreign-academy-id'
  )
  assert.equal(
    row.joinEvidence.credits[0].evidence.academyId,
    'foreign-academy-id'
  )
  const unsafeForeignCredit = structuredClone(readManifest(env))
  const unsafeCredit =
    unsafeForeignCredit.occurrences[0].joinEvidence.credits[0].evidence
  delete unsafeCredit.auditFingerprint
  unsafeCredit.studentId = 'foreign-student-must-not-leak'
  Object.assign(unsafeCredit, fp(unsafeCredit))
  assert.throws(() =>
    validateSensitiveRemediationManifest(unsafeForeignCredit)
  )
  const unsafeForeignPackage = structuredClone(readManifest(env))
  unsafeForeignPackage.occurrences[0].joinEvidence.packages[0]
    .evidence.studentId = 'foreign-student-must-not-leak'
  assert.throws(() =>
    validateSensitiveRemediationManifest(unsafeForeignPackage)
  )
})

test('same-academy package와 credit의 family 누락은 fail-closed 한다', async (t) => {
  for (const missingFamily of ['packages', 'credits']) {
    const directory = temp(t, `same-academy-${missingFamily}-`)
    const env = sensitiveEnv(directory)
    const terminal = missingFamily === 'credits'
    const code = await executeAuditCli({
      env,
      fetchImpl: mockFetch({
        audit: { terminal },
        evidence: { terminal },
        mutate(page, { family }) {
          if (family === missingFamily) page.records = []
          return page
        },
      }),
      writeOutput() {}, writeError() {},
    })
    assert.equal(code, 1)
    assert.equal(fs.existsSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT), false)
  }
})

test('unmatched fixed credit를 nonOccurrenceEvidence로 보존한다', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  const code = await executeAuditCli({
    env, fetchImpl: mockFetch({
      audit: { orphanCredit: true }, evidence: { orphanCredit: true },
    }),
    writeOutput() {}, writeError() {},
  })
  assert.equal(code, 2)
  const manifest = readManifest(env)
  assert.equal(manifest.occurrences.length, 0)
  assert.equal(manifest.nonOccurrenceEvidence.length, 1)
  assert.equal(manifest.nonOccurrenceEvidence[0].evidenceKey, `credit:${CREDIT_ID}`)
  assert.deepEqual(
    manifest.cohortIndexes.byPrimaryCohort.financial_conflict_manual_only, []
  )
})

test('매니페스트 summary와 분류를 원시 evidence에서 재계산한다', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  await runProductionAudit({
    env,
    fetchImpl: mockFetch({ audit: { blocker: true } }),
  })
  const manifest = readManifest(env)
  const mutations = [
    (value) => { value.summary.evidenceRecordCount++ },
    (value) => { value.summary.rawBlockingCategoryCount++ },
    (value) => {
      value.summary.safeOccurrences = 1
      value.summary.blockedOccurrences = 0
    },
    (value) => {
      value.occurrences[0].primaryCohort = 'unclassifiable_manual_review'
      value.cohortIndexes.byPrimaryCohort.structural_link_mismatch = []
      value.cohortIndexes.byPrimaryCohort.unclassifiable_manual_review = [0]
    },
    (value) => {
      value.occurrences[0].repairability = 'manual_mapping_required'
      value.cohortIndexes.byRepairability.insufficient_evidence_no_write = []
      value.cohortIndexes.byRepairability.manual_mapping_required = [0]
    },
    (value) => {
      value.occurrences[0].secondaryCategories = ['linkMismatch']
    },
  ]
  for (const mutate of mutations) {
    const tampered = structuredClone(manifest)
    mutate(tampered)
    assert.throws(() => validateSensitiveRemediationManifest(tampered))
  }
})

test('redacted parity, 0600, 무PII, stdout 비노출과 atomic cleanup', async (t) => {
  const directory = temp(t)
  const env = sensitiveEnv(directory)
  const output = []
  const code = await executeAuditCli({
    env, fetchImpl: mockFetch({ audit: { blocker: true } }),
    writeOutput: (value) => output.push(value),
    writeError: (value) => output.push(value),
  })
  assert.equal(code, 2)
  assert.equal(fs.statSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT).mode & 0o777, 0o600)
  const manifest = readManifest(env)
  assert.equal(manifest.occurrences[0].primaryCohort, 'structural_link_mismatch')
  assert.deepEqual(manifest.occurrences[0].blockingCategories, ['linkMismatch'])
  assert.equal(manifest.productionWriteAuthorized, false)
  assert.equal(manifest.repairPlanApproved, false)
  assert.equal(manifest.generatedForReadOnlyTriage, true)
  const serialized = JSON.stringify(manifest)
  for (const forbidden of [
    '"name"', '"email"', '"phone"', '"address"', '"token"', '"Authorization"',
    '"credentials"', '"writePayload"', TOKEN, REDACTION_KEY,
  ]) assert.equal(serialized.includes(forbidden), false)
  for (const forbidden of [
    RAW_KEY, LESSON_ID, RESERVATION_ID, SLOT_ID, STUDENT_ID, PACKAGE_ID,
    PACKAGE_ID_2, MEMBERSHIP_ID, CREDIT_ID, TEACHER_UID, ACADEMY_ID, TOKEN,
    REDACTION_KEY, 'cohortKey',
  ]) assert.equal(output.join('\n').includes(forbidden), false)
  fs.unlinkSync(env.AUDIT_SENSITIVE_REMEDIATION_OUTPUT)
  const missing = path.join(directory, 'missing', 'manifest.json')
  await assert.rejects(
    writeSensitiveRemediationManifest(missing, manifest),
    /Sensitive remediation manifest write failed/
  )
  assert.equal(fs.existsSync(missing), false)
  const existing = path.join(directory, 'existing-manifest.json')
  fs.writeFileSync(existing, 'do-not-overwrite', { mode: 0o600 })
  await assert.rejects(
    writeSensitiveRemediationManifest(existing, manifest),
    /Sensitive remediation manifest write failed/
  )
  assert.equal(fs.readFileSync(existing, 'utf8'), 'do-not-overwrite')
  assert.equal(fs.readdirSync(directory).some((name) => name.endsWith('.tmp')), false)
})
