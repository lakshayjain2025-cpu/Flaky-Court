// @ts-check
const path = require('path');
const { defineConfig } = require('@playwright/test');

// stress-test.js sets this so we run exactly one file.
// Playwright CLI args are regexes, so `fixed.test.js` would also match
// other files like `flaky-fixed.test.js`.
const targetFile = process.env.PLAYWRIGHT_TEST_FILE
  ? path.resolve(__dirname, process.env.PLAYWRIGHT_TEST_FILE)
  : null;

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: targetFile ? path.dirname(targetFile) : './',
  testMatch: targetFile ? path.basename(targetFile) : '**/*.{test,spec}.{js,ts,mjs}',
  testIgnore: ['**/node_modules/**', '**/dashboard/**'],
  use: {
    headless: true,
  },
});