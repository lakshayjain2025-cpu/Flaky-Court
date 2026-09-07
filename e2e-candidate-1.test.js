const { test, expect } = require('@playwright/test');

test('loads data on button click', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky.html');
  await page.click('#loadBtn');
  // Playwright's expect will automatically retry until the text matches or timeout expires.
  await expect(page.locator('#result')).toHaveText('Data Loaded', { timeout: 5000 });
});