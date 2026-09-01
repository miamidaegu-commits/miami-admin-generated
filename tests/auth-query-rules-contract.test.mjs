import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

import { buildTeacherGroupClassesQuerySpec } from '../src/features/dashboard/groupClassTeacherScope.js'
import { buildTeacherPrivateReservationQuerySpec } from '../src/features/dashboard/privateLessonReservationTeacherScope.js'

const dashboard = readFileSync(new URL('../Dashboard.jsx', import.meta.url), 'utf8')
const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8')

function sourceBlock(source, start, end) {
  const startIndex = source.indexOf(start)
  assert.notEqual(startIndex, -1, `missing start marker: ${start}`)
  const endIndex = source.indexOf(end, startIndex)
  assert.notEqual(endIndex, -1, `missing end marker: ${end}`)
  return source.slice(startIndex, endIndex)
}

test('groupClasses production query is exact academyId plus Auth teacherUid', () => {
  assert.deepEqual(
    buildTeacherGroupClassesQuerySpec({
      academyId: 'academy-a',
      teacherUid: 'teacher-a',
      teacherName: 'ignored',
    }),
    [
      { field: 'academyId', operator: '==', value: 'academy-a' },
      { field: 'teacherUid', operator: '==', value: 'teacher-a' },
    ]
  )
})

test('private reservation production query is exact academyId plus Auth teacherUid', () => {
  assert.deepEqual(
    buildTeacherPrivateReservationQuerySpec({
      academyId: 'academy-a',
      teacherUid: 'teacher-a',
    }),
    [
      { field: 'academyId', operator: '==', value: 'academy-a' },
      { field: 'teacherUid', operator: '==', value: 'teacher-a' },
    ]
  )
  assert.throws(
    () => buildTeacherPrivateReservationQuerySpec({ academyId: 'academy-a', teacherUid: '' }),
    /teacherUid/
  )
})

test('Dashboard reservation listener uses only the canonical query helper', () => {
  const block = sourceBlock(
    dashboard,
    "collection(db, 'privateLessonReservations'),\n          where('academyId'",
    '  }, [canonicalTeacherIdentity, currentAcademyId, user?.uid, userProfile?.role])'
  )
  assert.match(block, /buildTeacherPrivateReservationQuerySpec\(canonicalTeacherIdentity\)/)
  assert.match(block, /privateLessonReservations\(canonical teacherUid\)/)
  assert.doesNotMatch(block, /\['teacherUID'/)
  assert.doesNotMatch(block, /\['teacherKey'/)
  assert.doesNotMatch(block, /\['teacherName'/)
  assert.doesNotMatch(block, /\['teacher'/)
})

test('group rule adds UID authority while retaining temporary live name compatibility', () => {
  const block = sourceBlock(
    rules,
    'match /groupClasses/{groupClassId}',
    'match /groupStudents/{groupStudentId}'
  )
  assert.match(block, /groupClassBelongsToTeacherUid\(resource\.data\)/)
  assert.match(block, /groupClassBelongsToTeacher\(resource\.data\)/)
  assert.doesNotMatch(block, /allow read: if signedIn\(\)/)
})

test('private reservation teacher read authority is canonical UID only', () => {
  const block = sourceBlock(
    rules,
    'match /privateLessonReservations/{reservationId}',
    'match /dailyMaterials/{materialId}'
  )
  assert.match(block, /privateReservationBelongsToTeacherUid\(resource\.data\)/)
  assert.match(block, /resource\.data\.studentId == myStudentId/)
  assert.match(block, /isAcademyAdmin\(resource\.data\.academyId\)/)
  assert.doesNotMatch(block, /myAcademyTeacherName/)
  assert.doesNotMatch(block, /teacherUID/)
  assert.doesNotMatch(block, /teacherKey/)
})

test('private student self-read is exact get linked by membership studentId', () => {
  const block = sourceBlock(
    rules,
    'match /privateStudents/{studentId}',
    'match /groupClasses/{groupClassId}'
  )
  assert.match(block, /allow get:[\s\S]*studentId == myStudentId\(resource\.data\.academyId\)/)
  assert.doesNotMatch(block, /allow list:[\s\S]*hasStudentIdentity/)
  assert.match(
    dashboard.replace(/\r\n/g, '\n'),
    /collection\(db, 'privateStudents'\),\n\s*where\('academyId'/
  )
})
