// @ts-check
const path = require('path');
const { defineConfig } = require('@playwright/test');

// stress-test.js sets this so we run exactly one file.
// Playwright CLI args are regexes, so `fixed.test.js` would also match
// other files like `flaky-fixed.test.js`.
const targetFile = process.env.PLAYWRIGHT_TEST_FILE
  ? path.resolve(__dirname, process.env.PLAYWRIGHT_TEST_FILE)
  : null;
const targetPattern = targetFile
  ? new RegExp(`^${targetFile.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/\\\\/g, '[\\\\/]')}$`)
  : null;

/**
 * @see https://playwright.dev/docs/test-configuration
 */
module.exports = defineConfig({
  testDir: './',
  // Match the complete resolved path. A basename would accidentally run archived
  // uploads and extracted repositories that happen to have the same file name.
  testMatch: targetPattern || '**/*.{test,spec}.{js,ts,mjs}',
  testIgnore: ['**/node_modules/**', '**/dashboard/**'],
  use: {
    headless: true,
  },
});
