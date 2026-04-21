import { expect } from '@playwright/test';

export const BASE_URL = 'http://localhost:5173/';

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function loginAsAdmin(page, email, password) {
  await page.goto(BASE_URL);

  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();

  await expect(page).toHaveURL(/\/dashboard/);
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible();
}

export async function openDashboardSection(page, sectionName) {
  await page.getByRole('button', { name: sectionName, exact: true }).click();
  await expect(page.getByRole('heading', { name: sectionName, level: 1 })).toBeVisible();
}

export function getStudentSearchInput(page) {
  // 취약한 selector 공통화: placeholder 문구 변경 시 이 함수만 data-testid로 교체하면 됩니다.
  return page.getByPlaceholder('이름, 전화번호, 차번호, 수강 목적 검색');
}

export function getStudentRow(page, studentName) {
  // 취약한 selector 공통화: 현재 학생 row는 안정적인 role/test id가 없어 class+버튼명+텍스트를 함께 씁니다.
  return page
    .locator('.table-row')
    .filter({
      has: page.getByRole('button', { name: '수강권 추가', exact: true }),
      hasText: studentName,
    })
    .first();
}

export function getGroupRow(page, groupName) {
  // 취약한 selector 공통화: 현재 그룹 row는 role="button" + class + 텍스트 조합에 의존합니다.
  return page
    .locator('.table-row[role="button"]')
    .filter({ hasText: groupName })
    .first();
}

export function getRegisteredStudentsHeading(page, groupName) {
  return page.getByRole('heading', {
    name: new RegExp(`등록 학생\\s*[—-]\\s*${escapeRegExp(groupName)}`),
  });
}
