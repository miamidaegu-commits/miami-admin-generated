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

  expect(
    formatTeacherDisplayName(
      {
        teacherName: '선생님 선택 필요',
        teacherKey: 'miketest',
      },
      '선생님 선택 필요',
      [
        {
          value: 'teacher-option-1',
          teacherKey: 'miketest',
          label: 'MikeTest · miketest',
        },
      ]
    )
  ).toBe('MikeTest · miketest');

  expect(
    formatTeacherDisplayName(
      {
        teacher: 'legacyteacheruid1234567890',
        teacherName: '선생님 선택 필요',
        groupClassTeacherKey: 'miketest',
      },
      '선생님 선택 필요',
      [
        {
          value: 'teacher-option-1',
          teacherKey: 'miketest',
          label: 'MikeTest · miketest',
        },
      ]
    )
  ).toBe('MikeTest · miketest');
});

test('group class save persists teacher display identity fields', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useGroupManagementFlow.js'),
    'utf8'
  );
  const dashboardSource = fs.readFileSync(path.join(process.cwd(), 'Dashboard.jsx'), 'utf8');
  const viewUtilsSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/dashboardViewUtils.js'),
    'utf8'
  );
  const calendarViewModelSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useCalendarSectionViewModel.js'),
    'utf8'
  );

  expect(source).toContain('teacher: teacherIdentity.teacher');
  expect(source).toContain('teacherKey: teacherIdentity.teacherKey');
  expect(source).toContain('teacherUid: teacherIdentity.teacherUid');
  expect(source).toContain('teacherId: teacherIdentity.teacherId');
  expect(source).toContain('teacherName: teacherIdentity.teacherName');
  expect(source).toContain('teacherDisplayName: teacherIdentity.teacherDisplayName');
  expect(source).toContain('displayName: teacherIdentity.displayName');
  expect(source).toContain('resolveGroupTeacherFormValue(group, teacherSelectOptions)');
  expect(source).toContain('const teacherChanged = teacherIdentityChanged(group, teacherIdentity)');
  expect(source).toContain('const savedGroup = {');
  expect(source).toContain('setSelectedGroupClass?.((prev)');
  expect(source).toContain('futureGroupLessonsTeacherUpdate');
  expect(source).toContain('isFutureTeacherSyncTargetGroupLesson(lesson, group.id, todayYmd)');
  expect(source).toContain("where('groupClassId', '==', group.id)");
  expect(source).toContain("where('groupClassID', '==', group.id)");
  expect(source).toContain('setGroupLessons?.((prev)');
  expect(dashboardSource).toContain('const latestGroupClass = groupClasses.find');
  expect(dashboardSource).toContain('return { ...prev, ...latestGroupClass }');
  expect(dashboardSource).toContain('setGroupClasses,');
  expect(dashboardSource).toContain('setSelectedGroupClass,');
  expect(dashboardSource).toContain('setGroupLessons,');
  expect(dashboardSource).toContain('const groupClassesById = useMemo(() => {');
  expect(dashboardSource).toContain('buildGroupLessonTeacherDisplaySource');
  expect(dashboardSource).toContain('groupClassTeacherKey: groupClass?.teacherKey');
  expect(dashboardSource).toContain('formatTeacherDisplayName(');
  expect(viewUtilsSource).toContain('row?.teacherDisplayName');
  expect(viewUtilsSource).toContain('row?.teacherName');
  expect(viewUtilsSource).toContain('row?.teacherLabel');
  expect(viewUtilsSource).toContain('option?.teacherUid');
  expect(viewUtilsSource).toContain('option?.teacherId');
  expect(viewUtilsSource).toContain('row?.groupClassTeacherKey');
  expect(viewUtilsSource).toContain("normalized === '선생님 선택 필요'");
  expect(calendarViewModelSource).toContain('groupClassTeacherKey: String(gc?.teacherKey');
  expect(calendarViewModelSource).toContain('groupClassTeacherDisplayName: String(gc?.teacherDisplayName');
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
  expect(bookingSource).toContain('sortedFixedMemberLessons');
  expect(bookingSource).toContain('sortedGroupFreeBookingLessons');
  expect(bookingSource).toContain('내 반 등록 수업');
  expect(bookingSource).toContain('자유 예약 가능한 단체반');
  expect(bookingSource).toContain('예약 필요 없음');
  expect(bookingSource).toContain('현재 자유 예약 가능한 단체반 수업이 없습니다.');
  expect(bookingSource).toContain('반 등록 예정');
  expect(bookingSource).toContain('반 등록됨');

  const fixedSectionStart = bookingSource.indexOf('내 반 등록 수업');
  const freeSectionStart = bookingSource.indexOf('자유 예약 가능한 단체반');
  expect(fixedSectionStart).toBeGreaterThan(-1);
  expect(freeSectionStart).toBeGreaterThan(fixedSectionStart);
  const fixedSectionSource = bookingSource.slice(fixedSectionStart, freeSectionStart);
  expect(fixedSectionSource).toContain('student-booking-fixed-lesson-card');
  expect(fixedSectionSource).not.toContain('student-booking-reserve-button');
  expect(fixedSectionSource).not.toContain('student-booking-cancel-button');

  const freeBookingMemoStart = bookingSource.indexOf('const sortedGroupFreeBookingLessons');
  const reservationsMemoStart = bookingSource.indexOf('const sortedReservations');
  expect(freeBookingMemoStart).toBeGreaterThan(-1);
  expect(reservationsMemoStart).toBeGreaterThan(freeBookingMemoStart);
  const freeBookingMemoSource = bookingSource.slice(freeBookingMemoStart, reservationsMemoStart);
  expect(freeBookingMemoSource).not.toContain('fixedMemberLessons');
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

test('admin group lesson rows separate seat and direct booking status copy', () => {
  const groupSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/GroupsSection.jsx'),
    'utf8'
  );
  const calendarSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/CalendarSection.jsx'),
    'utf8'
  );

  expect(groupSectionSource).toContain('학생 직접 예약: 가능');
  expect(groupSectionSource).toContain('학생 직접 예약: 비활성');
  expect(groupSectionSource).toContain('좌석: {reservationStatusLabel}');
  expect(groupSectionSource).toContain('group-lesson-bookable-badge');
  expect(groupSectionSource).toContain('group-lesson-action-seat-label');
  expect(groupSectionSource).toContain('group-lesson-action-bookable-label');
  expect(groupSectionSource).toContain('getGroupLessonAttendanceActionLabel(gl)');
  expect(groupSectionSource).toContain("'자리 공개 관리'");
  expect(groupSectionSource).toContain('수업 전체 휴강');
  expect(groupSectionSource).toContain('자리 공개가 아니라 이 회차 전체를 차감 없이 닫습니다.');
  expect(groupSectionSource).toContain('반 등록 학생 —');
  expect(groupSectionSource).toContain('아직 반 등록 학생이 없습니다.');
  expect(groupSectionSource).toContain('남은 선착순 좌석은');
  expect(calendarSource).toContain('calendar-group-lesson-bookable-badge');
  expect(calendarSource).toContain('calendar-group-lesson-seat-badge');
  expect(calendarSource).toContain("'좌석: 예약 가능'");
  expect(calendarSource).toContain("'좌석: 마감'");
  expect(calendarSource).toContain("'학생 직접 예약: 가능'");
  expect(calendarSource).toContain("'학생 직접 예약: 비활성'");
  expect(calendarSource).not.toContain("'학생 예약 가능'");
});

test('group attendance modal separates future seat release from attendance deduction copy', () => {
  const modalSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/modals/GroupLessonAttendanceModal.jsx'),
    'utf8'
  );
  const attendanceFlowSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useGroupAttendanceFlow.js'),
    'utf8'
  );
  const studentBookingSource = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');
  const groupSectionSource = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/sections/GroupsSection.jsx'),
    'utf8'
  );

  expect(modalSource).toContain("row.isReleased) return isPastLesson ? '차감취소됨' : '자리 공개됨'");
  expect(modalSource).toContain("isPastLesson ? '출결 / 차감' : '자리 공개 관리'");
  expect(modalSource).toContain("'자리 복구'");
  expect(modalSource).toContain("'자리 공개'");
  expect(modalSource).toContain("'차감복구'");
  expect(attendanceFlowSource).toContain('자리 공개 실패');
  expect(attendanceFlowSource).toContain('자리 복구 실패');
  const legacyFixedStudentCopy = ['고정', ' 학생'].join('');
  for (const source of [studentBookingSource, groupSectionSource, modalSource]) {
    expect(source).not.toContain(legacyFixedStudentCopy);
  }
});
