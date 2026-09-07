const { test, expect } = require('@playwright/test');

test('loads data on button click', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky.html');
  await page.click('#loadBtn');
  const result = page.locator('#result');
  // Wait until the element contains the expected text.
  await expect(result).toHaveText('Data Loaded', { timeout: 15000 });
});