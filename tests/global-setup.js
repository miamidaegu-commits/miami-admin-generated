import { chromium, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';
import { ADMIN_EMAIL, ADMIN_PASSWORD } from './fixtures/test-data.js';
import { BASE_URL } from './e2e-helpers.js';

export const ADMIN_STORAGE_STATE = 'test-results/.auth/admin.json';

export default async function globalSetup() {
  fs.mkdirSync(path.dirname(ADMIN_STORAGE_STATE), { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.goto(BASE_URL);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: '학생 관리', exact: true })).toBeVisible();

  await context.storageState({ path: ADMIN_STORAGE_STATE, indexedDB: true });
  await browser.close();
}
