const { test, expect } = require('@playwright/test');

test('loads data on button click', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky.html');
  await page.click('#loadBtn');
  await page.waitForSelector('#result', { state: 'attached' });
  const text = await page.textContent('#result');
  expect(text).toBe('Data Loaded');
});