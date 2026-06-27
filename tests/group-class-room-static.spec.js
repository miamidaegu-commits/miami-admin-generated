import { test, expect } from '@playwright/test';
import {
  countActiveGroupFixedMembers,
  createDefaultGroupForm,
  resolveGroupLessonSubject,
  validateGroupFormFields,
} from '../src/features/dashboard/groupClassRoomUtils.js';

test('단체반 방 기본 정원은 4명이고 정원은 반 등록 학생 수보다 작을 수 없다', () => {
  expect(createDefaultGroupForm().maxStudents).toBe('4');
  expect(
    countActiveGroupFixedMembers(
      [
        { groupClassId: 'group-a', studentId: 's1', status: 'active' },
        { groupClassId: 'group-a', studentId: 's2', status: 'active' },
        { groupClassId: 'group-a', studentId: 's3', status: 'inactive' },
        { groupClassId: 'group-b', studentId: 's4', status: 'active' },
      ],
      'group-a'
    )
  ).toBe(2);

  const result = validateGroupFormFields(
    {
      name: '화목 단체반',
      teacher: 'teacher',
      maxStudents: '1',
      time: '16:00',
      subject: 'English',
      status: 'active',
      weekdays: [2, 4],
    },
    { forEdit: true, activeFixedMemberCount: 2 }
  );

  expect(result.valid).toBe(false);
  expect(result.errors.maxStudents).toContain('현재 반 등록 학생 2명');
});

test('단체반 생성/수정은 subject 없이 코스 유형과 반 이름으로 저장 가능하다', () => {
  const result = validateGroupFormFields(
    {
      name: '화목 단체반',
      teacher: 'teacher',
      maxStudents: '4',
      time: '16:00',
      subject: '',
      groupCourseType: '일반 영어회화',
      status: 'active',
      weekdays: [2, 4],
    },
    { forEdit: true }
  );

  expect(result.valid).toBe(true);
  expect(result.errors.subject).toBeUndefined();
  expect(result.subject).toBe('화목 단체반');
});

test('단체반 subject fallback은 반 이름 다음 코스 유형을 사용한다', () => {
  expect(
    resolveGroupLessonSubject({
      subject: '',
      groupClassName: '',
      groupCourseType: '초급 영어회화',
    })
  ).toBe('초급 영어회화');
});
