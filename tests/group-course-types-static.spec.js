import { test, expect } from '@playwright/test';
import {
  DEFAULT_GROUP_COURSE_TYPE,
  GROUP_COURSE_TYPE_OPTIONS,
  getGroupCourseTypeLabel,
  groupCourseTypesMatch,
  normalizeGroupCourseType,
} from '../src/features/group-booking/groupCourseTypes.js';

test('group course type options use Korean values and labels', () => {
  expect(GROUP_COURSE_TYPE_OPTIONS.map((opt) => opt.value)).toEqual([
    '일반 영어회화',
    '초급 영어회화',
    '중급 영어회화',
    '고급 영어회화',
    '시험/특강',
  ]);
  expect(GROUP_COURSE_TYPE_OPTIONS.every((opt) => opt.value === opt.label)).toBe(true);
  expect(DEFAULT_GROUP_COURSE_TYPE).toBe('일반 영어회화');
});

test('legacy English course type slugs normalize to Korean canonical values', () => {
  expect(normalizeGroupCourseType('general_conversation')).toBe('일반 영어회화');
  expect(normalizeGroupCourseType('beginner_conversation')).toBe('초급 영어회화');
  expect(normalizeGroupCourseType('intermediate_conversation')).toBe('중급 영어회화');
  expect(normalizeGroupCourseType('free_talking')).toBe('일반 영어회화');
  expect(getGroupCourseTypeLabel('beginner_conversation')).toBe('초급 영어회화');
  expect(groupCourseTypesMatch('free_talking', '일반 영어회화')).toBe(true);
  expect(groupCourseTypesMatch('beginner_conversation', '초급 영어회화')).toBe(true);
});
