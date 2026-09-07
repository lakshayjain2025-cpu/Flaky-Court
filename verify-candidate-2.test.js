const { test, expect } = require('@playwright/test');

test('submits and polls for success', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky3.html');
  await page.click('#submitBtn');
  // Poll the DOM until the status text becomes 'Success'
  await page.waitForFunction(() => {
    const el = document.querySelector('#status');
    return el && el.textContent === 'Success';
  }, null, { timeout: 3000 });
  const text = await page.textContent('#status');
  expect(text).toBe('Success');
});