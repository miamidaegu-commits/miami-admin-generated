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

test('teacher fallback resolves teacher key from options before showing missing teacher', () => {
  expect(
    formatTeacherDisplayName(
      {
        teacher: 'miketest',
        teacherKey: 'miketest',
      },
      '선생님 선택 필요',
      [
        {
          value: 'miketest',
          teacherKey: 'miketest',
          label: 'MikeTest',
        },
      ]
    )
  ).toBe('MikeTest');
});

test('group class save persists teacher display identity fields', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useGroupManagementFlow.js'),
    'utf8'
  );

  expect(source).toContain('teacher: teacherIdentity.teacher');
  expect(source).toContain('teacherKey: teacherIdentity.teacherKey');
  expect(source).toContain('teacherUid: teacherIdentity.teacherUid');
  expect(source).toContain('teacherId: teacherIdentity.teacherId');
  expect(source).toContain('teacherName: teacherIdentity.teacherName');
  expect(source).toContain('teacherDisplayName: teacherIdentity.teacherDisplayName');
  expect(source).toContain('displayName: teacherIdentity.displayName');
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

test('student package edit applies group course type policies by package type', () => {
  const modalSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/modals/StudentPackageEditModal.jsx'),
    'utf8'
  );
  const flowSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useStudentPackageAdminFlow.js'),
    'utf8'
  );

  expect(modalSource).toContain('student-package-edit-open-group-course-type-select');
  expect(modalSource).toContain('GROUP_COURSE_TYPE_OPTIONS.map');
  expect(modalSource).toContain('student-package-edit-group-course-type-readonly');
  expect(modalSource).toContain('단체반 관리 &gt; 반 수정');
  expect(flowSource).toContain('getPackageLinkedGroupCourseType(pkg, groupClasses)');
  expect(flowSource).toContain('groupCourseType: result.groupCourseType');
  expect(flowSource).toContain('groupCourseTypes: result.groupCourseTypes');
});

test('group and open group packages expose revoke button and group revoke flow', () => {
  const sectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/StudentsSection.jsx'),
    'utf8'
  );
  const flowSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useStudentPackageAdminFlow.js'),
    'utf8'
  );

  expect(sectionSource).toContain("['private', 'group', 'openGroup'].includes");
  expect(sectionSource).toContain('수강권 회수');
  expect(flowSource).toContain("packageType === 'group' || packageType === 'openGroup'");
  expect(flowSource).toContain("collection(db, 'groupStudents')");
  expect(flowSource).toContain("collection(db, 'groupLessonReservations')");
  expect(flowSource).toContain("status: 'inactive'");
  expect(flowSource).toContain('syncStudentGroupCourseTypeAccessSummary(db');
});

test('admin group lesson rows expose bookable status copy', () => {
  const groupSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/GroupsSection.jsx'),
    'utf8'
  );
  const calendarSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/CalendarSection.jsx'),
    'utf8'
  );

  expect(groupSectionSource).toContain('학생 예약 가능');
  expect(groupSectionSource).toContain('예약 비활성');
  expect(groupSectionSource).toContain('group-lesson-bookable-badge');
  expect(calendarSource).toContain('calendar-group-lesson-bookable-badge');
});
