import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import {
  formatTeacherDisplayName,
  resolveTeacherIdentityFields,
} from '../src/features/dashboard/dashboardViewUtils.js';

test('teacher fallback does not expose legacy existing teacher copy', () => {
  expect(
    formatTeacherDisplayName({
      teacherName: '기존 선생님',
      teacher: 'abc123abc123abc123abc123',
    })
  ).toBe('선생님 선택 필요');

  const identity = resolveTeacherIdentityFields('abc123abc123abc123abc123', []);
  expect(identity.teacher).toBe('abc123abc123abc123abc123');
  expect(identity.teacherName).toBe('');
  expect(identity.teacherDisplayName).toBe('');
});

test('group lesson form allows empty subject and keeps date time validation', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useGroupLessonManagementFlow.js'),
    'utf8'
  );

  expect(source).toContain('validateLessonDateTimeSubject(form, { requireSubject: false })');
  expect(source).toContain('resolveGroupLessonSubject({');
});

test('recurring group lesson generation fills subject and enables student booking', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');

  expect(source).toContain('resolveGroupLessonSubject({');
  expect(source).toContain('if (weekdaySet.size === 0 || !timeStr || !courseType)');
  expect(source).toContain('isBookable: true');
});

test('student group availability only returns visible free-booking candidates', () => {
  const functionsSource = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');
  const bookingSource = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');

  expect(functionsSource).toContain('withGroupClassCourseTypeFallback');
  expect(functionsSource).toContain('if (availability.remainingSeats <= 0) return null;');
  expect(functionsSource).toContain('Number(balance.availableToBook || 0) <= 0');
  expect(functionsSource).toContain('groupTicketMatchesFreeBookingScope(ticket, scopedLesson)');
  expect(functionsSource).toMatch(
    /const fixedMemberLessons[\s\S]*return !isCancelledOrDeletedGroupLesson\(lesson\)[\s\S]*activeGroupClassIds\.has\(lessonGroupId\);/
  );
  expect(bookingSource).toContain('getGroupLessonDisplaySubject');
  expect(bookingSource).toContain('student-booking-fixed-lesson-card');
});
