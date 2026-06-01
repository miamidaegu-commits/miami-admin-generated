import { test, expect } from '@playwright/test';
import {
  STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT,
  computeStudentPrivateCancelAllowance,
  formatAdminStudentCancelAllowanceSummary,
  formatStudentPrivateCancelPolicyGuide,
  formatTeacherRosterStudentCancelLabel,
  validateStudentCancelLimitInput,
} from '../src/features/booking/studentPrivateCancelAllowance.js';

test('computeStudentPrivateCancelAllowance uses default limit and remaining counts', () => {
  expect(computeStudentPrivateCancelAllowance({})).toEqual({
    used: 0,
    limit: 2,
    remaining: 2,
  });
  expect(
    computeStudentPrivateCancelAllowance({
      studentCancelCount: 2,
    })
  ).toEqual({
    used: 2,
    limit: 2,
    remaining: 0,
  });
  expect(
    computeStudentPrivateCancelAllowance({
      studentCancelCount: 2,
      studentCancelLimit: 6,
    })
  ).toEqual({
    used: 2,
    limit: 6,
    remaining: 4,
  });
});

test('validateStudentCancelLimitInput rejects limit below used count', () => {
  expect(
    validateStudentCancelLimitInput({
      limit: 1,
      used: 2,
    })
  ).toEqual({
    ok: false,
    message: '이미 2회 사용했으므로 한도는 2회 이상이어야 합니다.',
  });
  expect(
    validateStudentCancelLimitInput({
      limit: 6,
      used: 2,
    })
  ).toEqual({
    ok: true,
    limit: 6,
  });
});

test('format labels use friendly cancellation wording', () => {
  const allowance = computeStudentPrivateCancelAllowance({
    studentCancelCount: 2,
    studentCancelLimit: 6,
  });
  expect(formatTeacherRosterStudentCancelLabel(allowance)).toBe('취소 가능 4/6회');
  expect(formatAdminStudentCancelAllowanceSummary(allowance)).toBe(
    '취소 사용 2/6회 · 남은 4회'
  );
  expect(formatStudentPrivateCancelPolicyGuide({ limit: 6, remaining: 4 })).toEqual([
    '예약 취소는 최대 6회까지 가능합니다.',
    '남은 취소 가능 횟수: 4/6회',
  ]);
  expect(STUDENT_PRIVATE_CANCEL_DEFAULT_LIMIT).toBe(2);
});

test('updateStudentPrivateCancelAllowance callable enforces admin and limit rules', async () => {
  const fs = await import('node:fs/promises');
  const source = await fs.readFile('functions/index.js', 'utf8');
  expect(source).toContain('exports.updateStudentPrivateCancelAllowance');
  expect(source).toMatch(
    /updateStudentPrivateCancelAllowance[\s\S]*requireAcademyAdmin\(db, academyId, uid\)/
  );
  expect(source).toMatch(
    /updateStudentPrivateCancelAllowance[\s\S]*studentCancelLimit cannot be less than current/
  );
  expect(source).toMatch(
    /cancelPrivateLessonReservation[\s\S]*resolveStudentPrivateCancelAllowance\(stats\)/
  );
  const adminCancelBlock =
    source.match(
      /exports\.adminCancelPrivateLessonReservation[\s\S]*?exports\.updateStudentPrivateCancelAllowance/
    )?.[0] || '';
  expect(adminCancelBlock).not.toContain('studentCancelCount');
});
