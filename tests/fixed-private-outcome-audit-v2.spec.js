import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const functionsSource = fs.readFileSync(
  path.join(root, 'functions', 'index.js'),
  'utf8'
)
const runnerSource = fs.readFileSync(
  path.join(root, 'scripts', 'run-fixed-private-outcome-ledger-audit.mjs'),
  'utf8'
)

function functionBody(source, functionName, nextMarker) {
  const start = source.indexOf(`async function ${functionName}`)
  const end = source.indexOf(nextMarker, start)
  expect(start).toBeGreaterThanOrEqual(0)
  expect(end).toBeGreaterThan(start)
  return source.slice(start, end)
}

test('audit v2 exposes every bounded academy-scoped scan family', () => {
  for (const [family, collection] of Object.entries({
    fixedLessons: 'lessons',
    fixedReservations: 'privateLessonReservations',
    fixedSlots: 'privateLessonSlots',
    deductionCredits: 'creditTransactions',
    teacherMemberships: 'academyMemberships',
  })) {
    expect(functionsSource).toContain(`${family}: "${collection}"`)
  }
  expect(functionsSource).toContain('auditVersion: FIXED_PRIVATE_OUTCOME_AUDIT_VERSION')
  expect(functionsSource).toContain('truncated: false')
  expect(functionsSource).toContain('omittedCount: 0')
  expect(functionsSource).toContain('inventory: pageSummary.inventory')
  expect(functionsSource).toContain('blocking: pageSummary.blocking')
  expect(functionsSource).toContain('reasons: FIXED_PRIVATE_OUTCOME_AUDIT_V2_CATEGORY_REASONS')
  expect(functionsSource).toContain('nextCursor:')
  expect(functionsSource).toContain('hasMore')
})

test('audit v2 remains admin-only and read-only', () => {
  const body = functionBody(
    functionsSource,
    'inspectFixedPrivateLessonOutcomeLedgerV2',
    'async function inspectFixedPrivateLessonOutcomeLedger({'
  )
  expect(body).toContain('await requireAcademyAdmin(')
  expect(body).toContain('.where("academyId", "==", validation.academyId)')
  for (const writeMethod of [
    '.set(',
    '.update(',
    '.create(',
    '.delete(',
    '.runTransaction(',
    '.batch(',
  ]) {
    expect(body).not.toContain(writeMethod)
  }
})

test('audit v2 returns no raw teacher names or contact fields', () => {
  const membershipBody = functionsSource.slice(
    functionsSource.indexOf('function buildFixedPrivateOutcomeAuditV2MembershipRecord'),
    functionsSource.indexOf('async function assertFixedPrivateOutcomeAuditV2Cursor')
  )
  expect(membershipBody).toContain('fixedPrivateOutcomeAuditV2IdentityDigest')
  const returnedRecord = membershipBody.slice(membershipBody.lastIndexOf('return {'))
  expect(returnedRecord).not.toContain('email:')
  expect(returnedRecord).not.toContain('phone:')
  expect(returnedRecord).not.toContain('teacherName:')
  expect(returnedRecord).not.toContain('displayName:')
})

test('production runner is pinned and fail-closed', () => {
  expect(runnerSource).toContain("PRODUCTION_PROJECT_ID = 'daegu-miami-production'")
  expect(runnerSource).toContain("AUDIT_REGION = 'us-central1'")
  expect(runnerSource).toContain(
    "AUDIT_CALLABLE = 'inspectFixedPrivateLessonOutcomeLedger'"
  )
  expect(runnerSource).toContain("CONFIRM_PRODUCTION_READONLY_AUDIT !== 'YES'")
  expect(runnerSource).toContain("CONFIRM_FIXED_PRIVATE_WRITE_QUIET_WINDOW !== 'YES'")
  expect(runnerSource).toContain('FIREBASE_ID_TOKEN is required.')
  expect(runnerSource).toContain('dryRun: true')
  expect(runnerSource).toContain('previewOnly: true')
  expect(runnerSource).toContain('commit: false')
  expect(runnerSource).toContain('return 3')
  expect(runnerSource).toContain('if (summary.blockerTotal > 0) return 2')
  expect(runnerSource).toContain('return summary.pass === true ? 0 : 1')
  expect(runnerSource).toContain('validateAuditV2Page')
  expect(runnerSource).toContain('validateFinalAuditSummary')
  expect(runnerSource).toContain('const first = await runSingleAudit')
  expect(runnerSource).toContain('const second = await runSingleAudit')
  expect(runnerSource).toContain('MAX_PAGES_PER_FAMILY')
  expect(runnerSource).toContain('MAX_RECORDS_PER_RUN')
})

test('audit v2 version and cursor protocol are structurally fail-closed', () => {
  expect(functionsSource).toContain(
    'const hasAuditVersion = Object.prototype.hasOwnProperty.call('
  )
  expect(functionsSource).toContain(
    'if (payload.auditVersion === FIXED_PRIVATE_OUTCOME_AUDIT_VERSION)'
  )
  expect(functionsSource).toContain(
    'throw new HttpsError("invalid-argument", "unsupported_audit_version")'
  )
  expect(functionsSource).toContain('cursorVersion: FIXED_PRIVATE_OUTCOME_AUDIT_CURSOR_VERSION')
  expect(functionsSource).toContain('scanFamily,')
  expect(functionsSource).toContain('lastDocumentId,')
  expect(functionsSource).toContain('audit_cursor_scope_mismatch')
})

test('runner validates credit lesson and slot references', () => {
  const creditMatcher = runnerSource.slice(
    runnerSource.indexOf('function creditMatchesOccurrence'),
    runnerSource.indexOf('function resolveTeacherDiagnostic')
  )
  expect(creditMatcher).toContain('credit.lessonId === occurrence.lessonId')
  expect(creditMatcher).toContain('credit.slotId === occurrence.slotId')
  expect(creditMatcher).toContain(
    "occurrence.provenance?.originMode === 'converted_legacy'"
  )
  expect(creditMatcher).toContain(
    'occurrence.provenance?.legacyEvidenceConsistent === true'
  )
})

test('runner separates ledger and origin inventory with fail-closed partitions', () => {
  for (const field of [
    'currentCanonicalLedgerTotal',
    'currentLegacyLedgerTotal',
    'currentUnknownOrMixedLedgerTotal',
    'bornCanonicalTotal',
    'legacyOriginTotal',
    'unknownOriginTotal',
  ]) {
    expect(runnerSource).toContain(`'${field}'`)
  }
  expect(runnerSource).toContain('function hasLegacyOrigin')
  expect(runnerSource).toContain('classifyLegacyPartitionState')
  expect(runnerSource).toContain(
    "return 'already_converted'"
  )
  expect(runnerSource).toContain(
    "failProtocol('Legacy-origin partition invariant failed.')"
  )
  expect(runnerSource).toContain(
    "failProtocol('Audit summary digest does not match its aggregate records.')"
  )
})
