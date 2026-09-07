const { test, expect } = require('@playwright/test');

test('loads data on button click', async ({ page }) => {
  await page.goto('http://localhost:8080/flaky.html');
  await page.click('#loadBtn');
  // Explicitly wait for the element's text content to become the expected value.
  await page.waitForFunction(() => {
    const el = document.querySelector('#result');
    return el && el.textContent === 'Data Loaded';
  }, null, { timeout: 5000 });
  const text = await page.textContent('#result');
  expect(text).toBe('Data Loaded');
});