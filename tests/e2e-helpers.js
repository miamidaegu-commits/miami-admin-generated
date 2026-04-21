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
  return page.getByTestId('student-search-input');
}

export function getStudentRow(page, studentName) {
  return page.locator(`[data-testid="student-row"][data-student-name="${studentName}"]`).first();
}

export function getGroupRow(page, groupName) {
  return page.locator(`[data-testid="group-row"][data-group-name="${groupName}"]`).first();
}

export function getRegisteredStudentsHeading(page, groupName) {
  return page.getByRole('heading', {
    name: new RegExp(`등록 학생\\s*[—-]\\s*${escapeRegExp(groupName)}`),
  });
}
