import { test, expect } from '@playwright/test'
import {
  getEffectiveLessonCourseTypes,
  getLessonGroupClassIds,
  hasGroupLessonAccess,
} from '../src/features/group-booking/groupLessonAccess.js'

test('group lesson access is additive across class ids and course types', () => {
  const summary = {
    groupClassIds: ['free-class', 'legacy-class'],
    groupCourseTypes: ['beginner_conversation'],
  }
  const groupClassById = new Map([
    ['free-class', { id: 'free-class', groupCourseType: 'free_talking' }],
    ['legacy-class', { id: 'legacy-class' }],
  ])

  expect(
    hasGroupLessonAccess({
      summary,
      lesson: {
        groupClassId: 'free-class',
        groupCourseType: 'free_talking',
        subject: 'Course Free Visible',
      },
      groupClassById,
    })
  ).toBe(true)

  expect(
    hasGroupLessonAccess({
      summary,
      lesson: {
        groupClassId: 'legacy-class',
        subject: 'Course Legacy Visible',
      },
      groupClassById,
    })
  ).toBe(true)

  expect(
    hasGroupLessonAccess({
      summary,
      lesson: {
        groupClassId: 'beginner-class',
        groupCourseType: 'beginner_conversation',
        subject: 'Course Beginner Only',
      },
      groupClassById,
    })
  ).toBe(true)

  expect(
    hasGroupLessonAccess({
      summary,
      lesson: {
        groupClassId: 'hidden-class',
        groupCourseType: 'free_talking',
        subject: 'Course Hidden',
      },
      groupClassById,
    })
  ).toBe(false)
})

test('legacy lesson groupClassIds intersect summary class ids', () => {
  expect(
    getLessonGroupClassIds({
      groupClassIds: ['legacy-class'],
    })
  ).toEqual(['legacy-class'])

  expect(
    hasGroupLessonAccess({
      summary: { groupClassIds: ['legacy-class'], groupCourseTypes: [] },
      lesson: { groupClassIds: ['legacy-class'], subject: 'Legacy Array Lesson' },
    })
  ).toBe(true)
})

test('course type access can come from linked group class metadata', () => {
  const groupClassById = new Map([
    ['free-class', { id: 'free-class', groupCourseType: 'free_talking' }],
  ])

  expect(
    getEffectiveLessonCourseTypes(
      { groupClassId: 'free-class' },
      groupClassById
    )
  ).toEqual(['일반 영어회화'])

  expect(
    hasGroupLessonAccess({
      summary: { groupClassIds: [], groupCourseTypes: ['free_talking'] },
      lesson: { groupClassId: 'free-class', subject: 'Course Free Visible' },
      groupClassById,
    })
  ).toBe(true)
})
