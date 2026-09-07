const { test, expect } = require('@playwright/test');

test('submits and waits for success text', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky3.html');
  await page.click('#submitBtn');
  // Wait until the status element contains the expected text instead of a fixed timeout
  await expect(page.locator('#status')).toHaveText('Success', { timeout: 3000 });
});