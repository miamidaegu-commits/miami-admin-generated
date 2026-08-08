import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  buildGroupClassOwnershipFields,
  buildGroupLessonCanonicalFields,
  buildGroupLessonOccurrenceId,
  buildTeacherGroupClassesQuerySpec,
  resolveCanonicalTeacherMembershipIdentity,
  scopeTeacherGroupData,
} from '../src/features/dashboard/groupClassTeacherScope.js'

const ACADEMY_ID = 'academy-a'
const TEACHER_UID = 'teacher-uid-a'
const OTHER_TEACHER_UID = 'teacher-uid-b'

function ownedClass(overrides = {}) {
  return {
    id: 'class-a',
    academyId: ACADEMY_ID,
    teacherUid: TEACHER_UID,
    teacherName: 'Alex',
    ...overrides,
  }
}

function lesson(overrides = {}) {
  return {
    id: 'lesson-a',
    academyId: ACADEMY_ID,
    groupClassId: 'class-a',
    date: '2026-08-10',
    time: '09:30',
    ...overrides,
  }
}

function scope(groupClasses, groupLessons = []) {
  return scopeTeacherGroupData({
    groupClasses,
    groupLessons,
    academyId: ACADEMY_ID,
    teacherUid: TEACHER_UID,
  })
}

test('1 canonical UID class 포함', () => {
  assert.deepEqual(scope([ownedClass()]).groupClasses.map((row) => row.id), ['class-a'])
})

test('2 other UID 제외', () => {
  assert.equal(scope([ownedClass({ teacherUid: OTHER_TEACHER_UID })]).groupClasses.length, 0)
})

test('3 same name other UID 제외', () => {
  assert.equal(
    scope([ownedClass({ teacherUid: OTHER_TEACHER_UID, teacherName: 'Alex' })]).groupClasses.length,
    0
  )
})

test('4 displayName 변경에도 canonical UID로 포함', () => {
  assert.equal(scope([ownedClass({ displayName: 'Renamed' })]).groupClasses.length, 1)
})

test('5 same email diff UID 제외', () => {
  assert.equal(
    scope([
      ownedClass({
        teacherUid: OTHER_TEACHER_UID,
        email: 'same@example.com',
      }),
    ]).groupClasses.length,
    0
  )
})

test('6 other academy 제외', () => {
  assert.equal(scope([ownedClass({ academyId: 'academy-b' })]).groupClasses.length, 0)
})

test('7 missing UID 제외', () => {
  assert.equal(scope([ownedClass({ teacherUid: '' })]).groupClasses.length, 0)
})

test('8 owned class lesson 포함', () => {
  assert.deepEqual(scope([ownedClass()], [lesson()]).groupLessons.map((row) => row.id), ['lesson-a'])
})

test('9 other class lesson 제외', () => {
  assert.equal(scope([ownedClass()], [lesson({ groupClassId: 'class-b' })]).groupLessons.length, 0)
})

test('10 missing canonical classId lesson 제외', () => {
  assert.equal(
    scope([ownedClass()], [lesson({ groupClassId: '', groupClassID: 'class-a' })]).groupLessons.length,
    0
  )
})

test('11 other academy lesson 제외', () => {
  assert.equal(scope([ownedClass()], [lesson({ academyId: 'academy-b' })]).groupLessons.length, 0)
})

test('12 duplicate lesson ID dedupe', () => {
  const result = scope([ownedClass()], [lesson(), lesson({ subject: 'duplicate copy' })])
  assert.equal(result.groupLessons.length, 1)
  assert.equal(result.excludedCounts.duplicateGroupLessons, 1)
})

test('13 scope helper는 input을 mutate하지 않음', () => {
  const groupClasses = [ownedClass()]
  const groupLessons = [lesson()]
  const beforeClasses = structuredClone(groupClasses)
  const beforeLessons = structuredClone(groupLessons)
  scope(groupClasses, groupLessons)
  assert.deepEqual(groupClasses, beforeClasses)
  assert.deepEqual(groupLessons, beforeLessons)
})

test('14 query builder에 teacherName ownership 조건 없음', () => {
  const dashboard = readFileSync('Dashboard.jsx', 'utf8')
  const spec = buildTeacherGroupClassesQuerySpec({
    academyId: ACADEMY_ID,
    teacherUid: TEACHER_UID,
    teacherName: 'ignored',
  })
  assert.equal(JSON.stringify(spec).includes('teacherName'), false)
  assert.doesNotMatch(dashboard, /teacherName groupClasses/)
  assert.doesNotMatch(dashboard, /queryByTeacherName/)
})

test('15 query builder는 exact academyId+teacherUid equality만 반환', () => {
  assert.deepEqual(
    buildTeacherGroupClassesQuerySpec({
      academyId: ACADEMY_ID,
      teacherUid: TEACHER_UID,
    }),
    [
      { field: 'academyId', operator: '==', value: ACADEMY_ID },
      { field: 'teacherUid', operator: '==', value: TEACHER_UID },
    ]
  )
  assert.match(
    readFileSync('Dashboard.jsx', 'utf8'),
    /buildTeacherGroupClassesQuerySpec\(canonicalTeacherIdentity\)/
  )
})

test('16 모든 production class create/update ownership writer가 canonical helper를 사용', () => {
  const source = readFileSync(
    'src/features/dashboard/hooks/useGroupManagementFlow.js',
    'utf8'
  )
  assert.match(source, /const ownershipFields = buildGroupClassOwnershipFields\(/)
  assert.match(source, /addDoc\(collection\(db, 'groupClasses'\), \{\s*\.\.\.ownershipFields,/)
  assert.match(source, /const groupClassUpdate = \{\s*\.\.\.ownershipFields,/)
})

test('17 class writer helper는 academyId와 non-empty canonical teacherUid를 강제', () => {
  assert.deepEqual(
    buildGroupClassOwnershipFields({
      academyId: ACADEMY_ID,
      teacherIdentity: {
        academyId: ACADEMY_ID,
        teacherUid: TEACHER_UID,
        teacherName: 'Alex',
      },
      status: 'active',
    }),
    {
      academyId: ACADEMY_ID,
      teacherUid: TEACHER_UID,
      teacherName: 'Alex',
      status: 'active',
    }
  )
  assert.throws(
    () =>
      buildGroupClassOwnershipFields({
        academyId: ACADEMY_ID,
        teacherIdentity: { academyId: ACADEMY_ID, teacherUid: '', teacherName: 'Alex' },
        status: 'active',
      }),
    /teacherUid/
  )
})

test('18 모든 production lesson create 경로가 canonical class identity를 전달', () => {
  const dashboard = readFileSync('Dashboard.jsx', 'utf8')
  const lessonFlow = readFileSync(
    'src/features/dashboard/hooks/useGroupLessonManagementFlow.js',
    'utf8'
  )
  const rebuildFlow = readFileSync(
    'src/features/dashboard/hooks/useGroupScheduleRebuildFlow.js',
    'utf8'
  )
  assert.match(dashboard, /buildGroupLessonCanonicalFields\(\{\s*academyId: scopedAcademyId/)
  assert.match(lessonFlow, /buildGroupLessonCanonicalFields\(\{[\s\S]*?groupClass: selectedGroupClass/)
  assert.match(lessonFlow, /groupClassId: gc\.id,[\s\S]*?teacherUid: gc\.teacherUid/)
  assert.match(rebuildFlow, /groupClassId: gid,[\s\S]*?teacherUid: g\.teacherUid/)
})

test('19 lesson writer helper는 academyId와 groupClassId를 모두 강제', () => {
  const fields = buildGroupLessonCanonicalFields({
    academyId: ACADEMY_ID,
    groupClass: ownedClass(),
    date: '2026-08-10',
    time: '09:30',
  })
  assert.equal(fields.academyId, ACADEMY_ID)
  assert.equal(fields.groupClassId, 'class-a')
  assert.throws(
    () =>
      buildGroupLessonCanonicalFields({
        academyId: ACADEMY_ID,
        groupClass: ownedClass({ id: '' }),
        date: '2026-08-10',
        time: '09:30',
      }),
    /groupClassId/
  )
})

test('20 same occurrence는 항상 same ID', () => {
  const input = {
    academyId: ACADEMY_ID,
    groupClassId: 'class-a',
    date: '2026-08-10',
    time: '09:30',
  }
  assert.equal(buildGroupLessonOccurrenceId(input), buildGroupLessonOccurrenceId({ ...input }))
})

test('21 다른 class/date/time occurrence는 모두 distinct', () => {
  const base = {
    academyId: ACADEMY_ID,
    groupClassId: 'class-a',
    date: '2026-08-10',
    time: '09:30',
  }
  const ids = new Set([
    buildGroupLessonOccurrenceId(base),
    buildGroupLessonOccurrenceId({ ...base, groupClassId: 'class-b' }),
    buildGroupLessonOccurrenceId({ ...base, date: '2026-08-11' }),
    buildGroupLessonOccurrenceId({ ...base, time: '10:30' }),
  ])
  assert.equal(ids.size, 4)
})

test('22 rebuild rerun은 같은 deterministic document 하나로 수렴', () => {
  const input = {
    academyId: ACADEMY_ID,
    groupClassId: 'class-a',
    date: '2026-08-10',
    time: '09:30',
  }
  const writes = new Map()
  writes.set(buildGroupLessonOccurrenceId(input), { run: 1 })
  writes.set(buildGroupLessonOccurrenceId(input), { run: 2 })
  assert.equal(writes.size, 1)
})

test('23 concurrent callers도 같은 canonical ID를 계산', async () => {
  const input = {
    academyId: ACADEMY_ID,
    groupClassId: 'class-a',
    date: '2026-08-10',
    time: '09:30',
  }
  const ids = await Promise.all(
    Array.from({ length: 20 }, async () => buildGroupLessonOccurrenceId({ ...input }))
  )
  assert.equal(new Set(ids).size, 1)
})

test('24 teacherName은 occurrence ID에 영향을 주지 않음', () => {
  const base = {
    academyId: ACADEMY_ID,
    groupClassId: 'class-a',
    date: '2026-08-10',
    time: '09:30',
  }
  assert.equal(
    buildGroupLessonOccurrenceId({ ...base, teacherName: 'Alex' }),
    buildGroupLessonOccurrenceId({ ...base, teacherName: 'Renamed' })
  )
})

test('25 canonical membership identity는 Auth UID와 active teacher membership만 허용', () => {
  assert.deepEqual(
    resolveCanonicalTeacherMembershipIdentity({
      authUid: TEACHER_UID,
      academyId: ACADEMY_ID,
      membership: {
        academyId: ACADEMY_ID,
        uid: TEACHER_UID,
        role: 'teacher',
        status: 'active',
        displayName: 'Alex',
      },
    }),
    { academyId: ACADEMY_ID, teacherUid: TEACHER_UID, teacherName: 'Alex' }
  )
})

test('26 membership UID mismatch는 query 전에 fail closed', () => {
  assert.throws(
    () =>
      resolveCanonicalTeacherMembershipIdentity({
        authUid: TEACHER_UID,
        academyId: ACADEMY_ID,
        membership: {
          academyId: ACADEMY_ID,
          uid: OTHER_TEACHER_UID,
          role: 'teacher',
          status: 'active',
        },
      }),
    /does not match/
  )
})

test('27 cross-academy membership은 fail closed', () => {
  assert.throws(
    () =>
      resolveCanonicalTeacherMembershipIdentity({
        authUid: TEACHER_UID,
        academyId: ACADEMY_ID,
        membership: {
          academyId: 'academy-b',
          uid: TEACHER_UID,
          role: 'teacher',
          status: 'active',
        },
      }),
    /another academy/
  )
})

test('28 lesson teacherUid는 linked class ownership에서 exact denormalize', () => {
  const fields = buildGroupLessonCanonicalFields({
    academyId: ACADEMY_ID,
    groupClass: ownedClass(),
    date: '2026-08-10',
    time: '09:30',
  })
  assert.equal(fields.teacherUid, TEACHER_UID)
  assert.equal(fields.status, 'scheduled')
})
