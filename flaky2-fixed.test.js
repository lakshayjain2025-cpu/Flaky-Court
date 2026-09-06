const { test, expect } = require('@playwright/test');

test('submits the form', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky2.html');
  await page.click('.btn-primary-v2'); // corrected selector
  const text = await page.textContent('.result-text-final'); // corrected selector
  expect(text).toBe('Submitted!');
});
