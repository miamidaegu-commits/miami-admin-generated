import { test, expect } from '@playwright/test';
import {
  countActiveGroupFixedMembers,
  createDefaultGroupForm,
  validateGroupFormFields,
} from '../src/features/dashboard/groupClassRoomUtils.js';

test('단체반 방 기본 정원은 4명이고 정원은 고정 학생 수보다 작을 수 없다', () => {
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
  expect(result.errors.maxStudents).toContain('현재 고정 학생 2명');
});
