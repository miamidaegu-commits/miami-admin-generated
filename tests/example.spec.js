// @ts-check
import { test, expect } from '@playwright/test';

// Default Playwright example tests are unrelated to this app's e2e coverage
// and depend on an external site, so keep them out of the default run.
test.skip(true, '운영 앱 테스트와 무관한 Playwright 기본 예제입니다.');

test('has title', async ({ page }) => {
  await page.goto('https://playwright.dev/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Playwright/);
});

test('get started link', async ({ page }) => {
  await page.goto('https://playwright.dev/');

  // Click the get started link.
  await page.getByRole('link', { name: 'Get started' }).click();

  // Expects page to have a heading with the name of Installation.
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
});
