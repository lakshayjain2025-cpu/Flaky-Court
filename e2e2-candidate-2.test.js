const { test, expect } = require('@playwright/test');

test('loads data on button click', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky.html');
  await page.click('#loadBtn');
  // Poll the DOM until the text appears or timeout expires.
  await page.waitForFunction(() => {
    const el = document.querySelector('#result');
    return el && el.textContent.trim() === 'Data Loaded';
  }, null, { timeout: 15000 });
  const text = await page.textContent('#result');
  expect(text).toBe('Data Loaded');
});