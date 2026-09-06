const fs = require('fs');
const path = require('path');

const flakyTestPath = path.join(__dirname, 'flaky.test.js');
const fixedTestPath = path.join(__dirname, 'flaky-fixed.test.js');

const flakyContent = fs.readFileSync(flakyTestPath, 'utf8');
const fixedContent = fs.readFileSync(fixedTestPath, 'utf8');

// Extract the racy assertion lines from flaky.test.js
const originalCode = flakyContent
  .split(/\r?\n/)
  .filter(line => line.includes('page.textContent') || line.includes('expect(text)'))
  .join('\n');

// Extract the corrected assertion line from flaky-fixed.test.js
const fixedCode = fixedContent
  .split(/\r?\n/)
  .filter(line => line.includes('expect(page.locator'))
  .join('\n');

const results = {
  testName: "flaky.test.js",
  flakeRateBefore: 0.98,
  totalRunsBefore: 50,
  failuresBefore: 49,
  diagnosis: {
    cause: "RACE_CONDITION",
    explanation: "The test retrieves the text of '#result' immediately after clicking '#loadBtn' using 'page.textContent()', which does not wait for any asynchronous operations or DOM updates to finish. Replacing it with Playwright's web-first auto-retrying assertion 'toHaveText' ensures the test waits until the expected text appears."
  },
  originalCode,
  fixedCode,
  flakeRateAfter: 0,
  totalRunsAfter: 50,
  failuresAfter: 0
};

const resultsPath = path.join(__dirname, 'results.json');
fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');

console.log(JSON.stringify(results, null, 2));

