const { test, expect } = require('@playwright/test');

test('submits and waits fixed time', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky3.html');
  await page.click('#submitBtn');
  await page.waitForTimeout(100); // fixed 100ms wait — response can take up to 250ms
  const text = await page.textContent('#status');
  expect(text).toBe('Success');
});