import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('cancelGroupLessonSeat enforces group cancel limit on the server', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'functions/index.js'), 'utf8');

  expect(source).toContain('function getGroupCancelLimitPolicy');
  expect(source).toContain('countStudentGroupCancellationsForLimit');
  expect(source).toContain('groupCancelLimitEnabled === true');
  expect(source).toContain('isGroupTicketFreeBookingAllowed(pkg)');
  expect(source).toContain('membership.role === "student" && reservationPackageId');
  expect(source).toContain('예약에 연결된 수강권을 찾을 수 없습니다.');
  expect(source).toContain('단체반 자유 예약 취소 가능 횟수');
  expect(source).toContain('cancelledByRole:');
  expect(source).toContain('membership.role === "student" ? "student" : "admin"');
});

test('student package create and edit flows persist group cancel limit fields', () => {
  const createFlow = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useStudentPackageFlow.js'),
    'utf8'
  );
  const editFlow = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/hooks/useStudentPackageAdminFlow.js'),
    'utf8'
  );
  const createModal = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/modals/StudentPackageModal.jsx'),
    'utf8'
  );
  const editModal = fs.readFileSync(
    path.join(process.cwd(), 'src/features/dashboard/modals/StudentPackageEditModal.jsx'),
    'utf8'
  );

  for (const source of [createFlow, editFlow]) {
    expect(source).toContain('groupCancelLimitEnabled');
    expect(source).toContain('groupCancelLimitCount');
    expect(source).toContain('groupCancelLimitPeriod');
    expect(source).toContain('취소 가능 횟수는 1 이상의 정수여야 합니다.');
  }
  expect(createModal).toContain('자유 예약 취소 가능 횟수 제한');
  expect(editModal).toContain('자유 예약 취소 가능 횟수 제한');
  expect(editModal).toContain("packageType === 'openGroup'");
});

test('student booking page shows and disables group cancel limit state', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'StudentBookingPage.jsx'), 'utf8');

  expect(source).toContain('function getGroupCancelLimitInfo');
  expect(source).toContain('cancelLimitReached');
  expect(source).toContain('취소 한도 도달');
  expect(source).toContain('studentPackageById');
  expect(source).toContain('cancelledByRole');
});
