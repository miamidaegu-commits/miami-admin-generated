import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const source = fs.readFileSync(path.join(root, 'functions', 'index.js'), 'utf8')

function expect(value) {
  return {
    toContain(expected) {
      assert.equal(value.includes(expected), true)
    },
    toBeGreaterThanOrEqual(expected) {
      assert.ok(value >= expected)
    },
    toBeGreaterThan(expected) {
      assert.ok(value > expected)
    },
    not: {
      toContain(expected) {
        assert.equal(value.includes(expected), false)
      },
    },
  }
}

function sourceBetween(startMarker, endMarker) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

const implementation = sourceBetween(
  'const FIXED_PRIVATE_REMEDIATION_EVIDENCE_VERSION = 1;',
  'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS'
)

test('exports the isolated us-central1 remediation evidence callable', () => {
  expect(source).toContain(
    'exports.inspectFixedPrivateLessonOutcomeRemediationEvidence = onCall('
  )
  const callable = sourceBetween(
    'exports.inspectFixedPrivateLessonOutcomeRemediationEvidence = onCall(',
    'exports.previewFixedPrivateLessonOutcomeAction = onCall('
  )
  expect(callable).toContain('{region: REGION, cors: true}')
  expect(callable).toContain('if (!request.auth)')
  expect(callable).toContain('"unauthenticated", "auth_required"')
  expect(callable).toContain(
    'inspectFixedPrivateLessonOutcomeRemediationEvidence({'
  )
  expect(source).toContain('const REGION = "us-central1";')
})

test('uses an exact fail-closed request contract and separate cursor namespace', () => {
  for (const key of [
    'academyId',
    'evidenceVersion',
    'scanFamily',
    'limit',
    'cursor',
    'purpose',
    'dryRun',
    'previewOnly',
    'commit',
  ]) {
    expect(implementation).toContain(`"${key}"`)
  }
  expect(implementation).toContain(
    '"local_sensitive_remediation_manifest"'
  )
  expect(implementation).toContain(
    '"fixed-private-remediation-evidence-v1"'
  )
  expect(implementation).toContain(
    'unsupported_remediation_evidence_request_field'
  )
  expect(implementation).toContain('evidenceVersion must be numeric 1.')
  expect(implementation).toContain('data.dryRun !== true')
  expect(implementation).toContain('data.previewOnly !== true')
  expect(implementation).toContain('data.commit !== false')
  expect(implementation).toContain('limit > FIXED_PRIVATE_OUTCOME_AUDIT_MAX_LIMIT')
  expect(implementation).toContain('validateCallableDocumentId(')
  expect(implementation).toContain(
    'remediation_evidence_cursor_scope_mismatch'
  )
  expect(implementation).toContain(
    'data.cursor === undefined || data.cursor === null'
  )
  expect(implementation).toContain('const cursorPayload = cursor !== null ?')
  expect(implementation).toContain('!cursor ||')
})

test('maps every external family to its academy-scoped collection', () => {
  for (const [family, collection] of Object.entries({
    lessons: 'lessons',
    reservations: 'privateLessonReservations',
    slots: 'privateLessonSlots',
    credits: 'creditTransactions',
    memberships: 'academyMemberships',
    packages: 'studentPackages',
  })) {
    expect(implementation).toContain(`${family}: "${collection}"`)
  }
  expect(implementation).toContain(
    '.where("academyId", "==", validation.academyId)'
  )
  expect(implementation).toContain(
    '.orderBy(admin.firestore.FieldPath.documentId())'
  )
  expect(implementation).toContain('.limit(validation.limit + 1)')
  expect(implementation).toContain(
    'encodeFixedPrivateRemediationEvidenceCursor({'
  )
})

test('keeps the callable call graph read-only with a scope-safe resolver', () => {
  expect(implementation).toContain(
    'fixedPrivateRemediationScopedDocData(docs.reservation, academyId)'
  )
  expect(implementation).toContain(
    'fixedPrivateRemediationDocumentScope(docs.slot, academyId)'
  )
  const occurrenceBuilder = sourceBetween(
    'async function buildFixedPrivateRemediationOccurrenceRecord({',
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({'
  )
  expect(occurrenceBuilder).not.toContain(
    'resolveFixedPrivateOutcomeAuditV2Occurrence'
  )
  expect(implementation).toContain('await requireAcademyAdmin(')
  for (const writeMethod of [
    '.set(',
    '.create(',
    '.delete(',
    '.batch(',
    '.runTransaction(',
    'transaction.set(',
    'transaction.create(',
    'transaction.update(',
    'transaction.delete(',
  ]) {
    assert.equal(
      implementation.includes(writeMethod),
      false,
      `read-only helper contains ${writeMethod}`
    )
  }
})

test('returns the strict page envelope and deterministic digests', () => {
  const response = sourceBetween(
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({',
    'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS'
  )
  for (const field of [
    'evidenceVersion',
    'academyId',
    'scanFamily',
    'dryRun',
    'previewOnly',
    'commit',
    'page',
    'records',
    'pageDigest',
    'schemaDigest',
  ]) {
    assert.equal(
      response.includes(`${field}:`) || response.includes(`${field},`),
      true
    )
  }
  for (const field of [
    'pageSize',
    'returnedCount',
    'scannedCount',
    'hasMore',
    'nextCursor',
    'complete',
    'truncated',
    'omittedCount',
  ]) {
    assert.equal(
      response.includes(`${field}:`) || response.includes(`${field},`),
      true
    )
  }
  expect(response).toContain('truncated: false')
  expect(response).toContain('omittedCount: 0')
  expect(response).toContain('const nextCursor = hasMore && pageDocs.length > 0 ?')
  expect(response).toContain('    null;')
  expect(response).toContain(
    'pageDigest: fixedPrivateRemediationEvidenceDigest(records)'
  )
  expect(response).toContain(
    'schemaDigest: FIXED_PRIVATE_REMEDIATION_EVIDENCE_SCHEMA_DIGEST'
  )
  expect(response).not.toContain('ok:')
})

test('emits complete evidence categories without raw PII fields', () => {
  for (const marker of [
    'storedLinks',
    'resolvedLinks',
    'documentPresence',
    'documentScopes',
    'academyScoped',
    'packageCandidateIds',
    'packageCandidates',
    'studentCandidateIds',
    'membershipIds',
    'creditIds',
    'matchedMemberships',
    'classifier',
    'ledger',
    'origin',
    'statusDeduction',
    'ledgerTargeting',
    'isDeterministicCanonicalId',
    'isDeduction',
    'isReversal',
    'normalizedNameDigest',
    'auditFingerprint',
  ]) {
    expect(implementation).toContain(marker)
  }
  const returnedEvidence = sourceBetween(
    'function fixedPrivateRemediationMembershipSummary({',
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({'
  )
  for (const forbiddenKey of [
    'studentName:',
    'teacherName:',
    'displayName:',
    'email:',
    'phone:',
    'address:',
    'token:',
    'Authorization:',
    'profile:',
    'fullProfile:',
    'actorName:',
    'outcomeActorName:',
    'outcomeReversedByName:',
    'reason:',
    'memo:',
    'packageTitle:',
    'title:',
    'subject:',
  ]) {
    expect(returnedEvidence).not.toContain(forbiddenKey)
  }
})

test('schema digest covers exact nested record contracts', () => {
  const schema = sourceBetween(
    'const FIXED_PRIVATE_REMEDIATION_EVIDENCE_SCHEMA = {',
    'function fixedPrivateRemediationEvidenceDigest(value)'
  )
  for (const schemaSection of [
    'resolvedLinksKeys',
    'documentFamilyKeys',
    'storedLinkKeys',
    'storedLinkAliasesKeys',
    'storedLinkAliasSourceKeys',
    'storedLessonAliasKeys',
    'storedReservationAliasKeys',
    'storedSlotAliasKeys',
    'documentPresenceKeys',
    'presenceEntryKeys',
    'documentScopesKeys',
    'documentScopeKeys',
    'packageCandidateKeys',
    'persistedTeacherKeys',
    'provenanceRawKeys',
    'statusDeductionKeys',
    'timestampKeys',
    'scheduleKeys',
    'ledgerTargetingKeys',
    'targetingKeys',
    'matchedMembershipKeys',
  ]) {
    expect(schema).toContain(`${schemaSection}:`)
  }
  for (const kind of ['occurrence', 'credit', 'membership', 'package']) {
    expect(schema).toContain(`${kind}: {`)
  }
  for (const nestedKey of [
    'linkedLessonId',
    'linkedReservationId',
    'linkedSlotId',
    'studentCandidateIds',
    'packageCandidates',
    'instructorUid',
    'authUid',
    'memberUid',
    'migrationMarker',
    'outcomeActionRequestId',
    'ledgerTargeting',
  ]) {
    expect(schema).toContain(`"${nestedKey}"`)
  }
  expect(schema).not.toContain('recordKinds:')
})

test('keeps stored and resolved links separate without singular guessing', () => {
  expect(implementation).toContain('resolvedLinks: {')
  expect(implementation).toContain('storedLinkAliases,')
  expect(implementation).toContain('storedLinkConflict,')
  for (const alias of [
    'linkedLessonId',
    'linkedReservationId',
    'linkedSlotId',
    'privateLessonId',
    'privateLessonReservationId',
    'privateLessonSlotId',
  ]) {
    expect(implementation).toContain(`${alias}:`)
  }
  expect(implementation).toContain(
    'studentCandidateIds.length === 1 ? studentCandidateIds[0] : null'
  )
  expect(implementation).toContain(
    'packageCandidateIds.length === 1 ? packageCandidateIds[0] : null'
  )
  expect(implementation).toContain('sources: [...sources].sort()')
  expect(implementation).toContain('credit:${docSnap.id}.${field}')
})

test('resolves typed link aliases only when all persisted values agree', () => {
  const aliases = sourceBetween(
    'function fixedPrivateRemediationAliasEvidence(row, fields)',
    'function fixedPrivateRemediationNameDigest(row)'
  )
  for (const alias of [
    '"lessonId"',
    '"fixedLessonId"',
    '"linkedLessonId"',
    '"privateLessonId"',
    '"reservationId"',
    '"linkedReservationId"',
    '"privateLessonReservationId"',
    '"slotId"',
    '"linkedSlotId"',
    '"privateLessonSlotId"',
  ]) {
    expect(aliases).toContain(alias)
  }
  expect(aliases).toContain(
    'resolvedValue: uniqueValues.length === 1 ? uniqueValues[0] : null'
  )
  expect(aliases).toContain('conflict: uniqueValues.length > 1')
  expect(aliases).toContain('uniqueValues.length > 1')
  const resolver = sourceBetween(
    'async function resolveFixedPrivateRemediationOccurrenceDocs({',
    'function fixedPrivateRemediationCreditMatchesOccurrence({'
  )
  expect(resolver).toContain(
    'fixedPrivateRemediationAggregateStoredLinkAliases({'
  )
  expect(resolver).not.toContain('fixedPrivateOutcomeAuditV2LinkedIds')
  const provenPrivateLessonUsage = sourceBetween(
    'function getFixedPrivateRescheduleLinkedLessonIds(row)',
    'function getFixedPrivateRescheduleLinkedReservationIds(row)'
  )
  expect(provenPrivateLessonUsage).toContain('row && row.privateLessonId')
})

test('seeds occurrence credits only from declared IDs and typed targets', () => {
  const matcher = sourceBetween(
    'function fixedPrivateRemediationCreditMatchesOccurrence({',
    'function fixedPrivateRemediationCreditChainIds(row)'
  )
  expect(matcher).toContain('declaredCreditIds.includes(creditId)')
  expect(matcher).toContain('reservationTargets.includes(ids.reservationId)')
  expect(matcher).toContain('lessonTargets.includes(ids.lessonId)')
  expect(matcher).toContain('slotTargets.includes(ids.slotId)')
  expect(matcher).not.toContain('studentId')
  expect(matcher).not.toContain('packageId')
  expect(matcher).not.toContain('fixedPrivateOutcomeAuditV2CreditIsRelevant')
})

test('uses only persisted membership UID aliases and expanded teacher aliases', () => {
  const membership = sourceBetween(
    'function fixedPrivateRemediationMembershipSummary({docSnap})',
    'function buildFixedPrivateRemediationMembershipRecord({docSnap})'
  )
  for (const alias of [
    'row.uid',
    'row.authUid',
    'row.memberUid',
    'row.teacherUid',
    'row.teacherUID',
    'row.teacherId',
    'row.teacherID',
    'row.teacherKey',
  ]) {
    expect(membership).toContain(alias)
  }
  expect(membership).not.toContain('activeTeacherMembershipUid')
  for (const alias of [
    'instructorUid',
    'instructorUID',
    'assignedTeacherUid',
    'assignedTeacherUID',
    'assignedTeacherId',
    'assignedTeacherID',
    'assignedTeacherKey',
  ]) {
    expect(implementation).toContain(`${alias}:`)
  }
})

test('redacts foreign point reads before classification or evidence building', () => {
  const occurrenceBuilder = sourceBetween(
    'async function buildFixedPrivateRemediationOccurrenceRecord({',
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({'
  )
  expect(occurrenceBuilder).toContain(
    'fixedPrivateRemediationScopedDocData(docs.lesson, academyId)'
  )
  expect(occurrenceBuilder).toContain(
    'fixedPrivateRemediationScopedDocData(docs.reservation, academyId)'
  )
  expect(occurrenceBuilder).toContain(
    'fixedPrivateRemediationScopedDocData(docs.slot, academyId)'
  )
  expect(occurrenceBuilder).toContain(
    'fixedPrivateRemediationDocumentScope(doc, academyId)'
  )
  expect(occurrenceBuilder).toContain(
    'const studentDocs = await Promise.all(studentCandidateIds.map((id) =>'
  )
  expect(occurrenceBuilder).toContain(
    'MAX_STUDENT_CANDIDATES'
  )
  expect(occurrenceBuilder).toContain(
    'remediation_evidence_student_candidate_limit_exceeded'
  )
  const creditSummary = sourceBetween(
    'function fixedPrivateRemediationCreditSummary(id, row, academyId)',
    'function buildFixedPrivateRemediationCreditRecord('
  )
  expect(creditSummary).toContain('if (!academyScoped)')
  expect(creditSummary).toContain('studentId: null')
  expect(creditSummary).toContain('packageId: null')
  expect(creditSummary).toContain('sourceType: null')
  expect(creditSummary).toContain('timestamp: null')
  const packageCandidate = sourceBetween(
    'function fixedPrivateRemediationPackageCandidate({',
    'function buildFixedPrivateRemediationPackageRecord('
  )
  expect(packageCandidate).toContain(
    'scope.academyScoped === true ?'
  )
  expect(packageCandidate).toContain('studentId: null')
  expect(packageCandidate).toContain('totalCount: null')
})

test('builds a bounded deterministic credit and reversal closure', () => {
  const closure = sourceBetween(
    'function fixedPrivateRemediationCreditChainIds(row)',
    'async function buildFixedPrivateRemediationOccurrenceRecord({'
  )
  expect(closure).toContain('originalCreditTransactionId')
  expect(closure).toContain('reversalOfTransactionId')
  expect(closure).toContain(
    'fixedPrivateRemediationDocumentScope(doc, academyId)'
  )
  expect(closure).toContain('.academyScoped === true')
  expect(closure).toContain(
    'const pendingCreditKeys = []'
  )
  expect(closure).toContain(
    'const visitedCreditKeys = new Set()'
  )
  expect(closure).toContain('const missingCreditKeys = new Set()')
  expect(closure).toContain('const creditDocsByKey = new Map()')
  expect(closure).toContain('const adjacency = new Map()')
  expect(closure).toContain('const reverseAdjacency = new Map()')
  expect(closure).toContain('pendingCreditKeys.push({id, key})')
  expect(closure).toContain(
    'while (queueIndex < pendingCreditKeys.length)'
  )
  expect(closure).toContain('visitedCreditKeys.add(node.key)')
  expect(closure).toContain('await loadCreditKey(node)')
  expect(closure).not.toContain('while (changed)')
  expect(closure).toContain('left.id.localeCompare(right.id)')
  for (const bound of [
    'MAX_CREDIT_CLOSURE_REFERENCED_IDS',
    'MAX_CREDIT_CLOSURE_INCLUDED_DOCS',
    'MAX_CREDIT_CLOSURE_ITERATIONS',
    'MAX_CREDIT_CLOSURE_DIRECT_POINT_READS',
  ]) {
    expect(closure).toContain(bound)
  }
  expect(closure).toContain('let queueIndex = 0')
  expect(closure).toContain('let directPointReadCount = 0')
  expect(closure).toContain(
    'referencedIds.size >= MAX_CREDIT_CLOSURE_REFERENCED_IDS'
  )
  expect(closure).toContain(
    'creditDocsByKey.size >= MAX_CREDIT_CLOSURE_INCLUDED_DOCS'
  )
  expect(closure).toContain(
    'queueIndex >= MAX_CREDIT_CLOSURE_ITERATIONS'
  )
  expect(closure).toContain(
    'directPointReadCount >=\n        MAX_CREDIT_CLOSURE_DIRECT_POINT_READS'
  )
  for (const reason of [
    'remediation_evidence_credit_reference_limit_exceeded',
    'remediation_evidence_credit_document_limit_exceeded',
    'remediation_evidence_credit_iteration_limit_exceeded',
    'remediation_evidence_credit_point_read_limit_exceeded',
  ]) {
    expect(closure).toContain(reason)
  }
  expect(closure).toContain('attemptedPointReads.has(id)')
  expect(closure).toContain(
    'remediation_evidence_credit_closure_incomplete'
  )
})

test('bounds exhaustive side reads and candidate point reads fail closed', () => {
  for (const declaration of [
    'const MAX_ACADEMY_CREDIT_SIDE_READS = 10000;',
    'const MAX_ACADEMY_MEMBERSHIP_SIDE_READS = 5000;',
    'const MAX_CREDIT_CLOSURE_REFERENCED_IDS = 2000;',
    'const MAX_CREDIT_CLOSURE_INCLUDED_DOCS = 2000;',
    'const MAX_CREDIT_CLOSURE_ITERATIONS = 2001;',
    'const MAX_CREDIT_CLOSURE_DIRECT_POINT_READS = 2000;',
    'const MAX_PACKAGE_CANDIDATES = 500;',
    'const MAX_STUDENT_CANDIDATES = 500;',
  ]) {
    expect(implementation).toContain(declaration)
  }
  const scanner = sourceBetween(
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({',
    'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS'
  )
  expect(scanner).toContain(
    '.limit(MAX_ACADEMY_CREDIT_SIDE_READS + 1)'
  )
  expect(scanner).toContain(
    '.limit(MAX_ACADEMY_MEMBERSHIP_SIDE_READS + 1)'
  )
  expect(scanner).toContain(
    'creditSnap.size > MAX_ACADEMY_CREDIT_SIDE_READS'
  )
  expect(scanner).toContain(
    'membershipSnap.size > MAX_ACADEMY_MEMBERSHIP_SIDE_READS'
  )
  expect(scanner).toContain(
    'remediation_evidence_credit_side_read_limit_exceeded'
  )
  expect(scanner).toContain(
    'remediation_evidence_membership_side_read_limit_exceeded'
  )
  const occurrenceBuilder = sourceBetween(
    'async function buildFixedPrivateRemediationOccurrenceRecord({',
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({'
  )
  expect(occurrenceBuilder).toContain(
    'packageCandidateIds.length > MAX_PACKAGE_CANDIDATES'
  )
  expect(occurrenceBuilder).toContain(
    'studentCandidateIds.length > MAX_STUDENT_CANDIDATES'
  )
  expect(occurrenceBuilder).toContain(
    'remediation_evidence_package_candidate_limit_exceeded'
  )
  expect(occurrenceBuilder).toContain(
    'remediation_evidence_student_candidate_limit_exceeded'
  )
})

test('returns all academy rows with an explicit fixed classifier', () => {
  const occurrenceBuilder = sourceBetween(
    'async function buildFixedPrivateRemediationOccurrenceRecord({',
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({'
  )
  expect(occurrenceBuilder).toContain(
    'const classifier = classifyFixedPrivateProvenance('
  )
  expect(occurrenceBuilder).toContain('classifier,')
  const scanner = sourceBetween(
    'async function inspectFixedPrivateLessonOutcomeRemediationEvidence({',
    'const PRIVATE_LESSON_OUTCOME_COMMIT_ACTIONS'
  )
  expect(scanner).toContain(
    'records = await Promise.all(pageDocs.map((rootDoc) =>'
  )
  expect(scanner).not.toContain('.filter((record)')
  expect(scanner).toContain('returnedCount: records.length')
  expect(scanner).toContain('scannedCount: pageDocs.length')
})

test('does not alter the existing audit v2 dispatch or callable', () => {
  const dispatch = sourceBetween(
    'async function inspectFixedPrivateLessonOutcomeLedger({',
    'const FIXED_PRIVATE_REMEDIATION_EVIDENCE_VERSION = 1;'
  )
  expect(dispatch).toContain(
    'return await inspectFixedPrivateLessonOutcomeLedgerV1({db, auth, data})'
  )
  expect(dispatch).toContain(
    'return await inspectFixedPrivateLessonOutcomeLedgerV2({db, auth, data})'
  )
  expect(dispatch).toContain(
    'throw new HttpsError("invalid-argument", "unsupported_audit_version")'
  )
  expect(source).toContain(
    'exports.inspectFixedPrivateLessonOutcomeLedger = onCall('
  )
})
