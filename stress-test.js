const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const targetTest = process.argv[2] || 'flaky.test.js';
const TOTAL_RUNS = 50;
let passes = 0;
let failures = 0;
let sampleFailure = null;
let runResults = [];

console.log(`Running stress test: ${TOTAL_RUNS} iterations of ${targetTest}...\n`);

for (let i = 1; i <= TOTAL_RUNS; i++) {
  try {
    execSync(`npx playwright test ${targetTest}`, {
      encoding: 'utf8',
      stdio: 'pipe',
    });
    passes++;
    runResults.push(1);
    console.log(`Run ${i}/${TOTAL_RUNS}: PASS`);
  } catch (error) {
    failures++;
    runResults.push(0);
    console.log(`Run ${i}/${TOTAL_RUNS}: FAIL`);
    if (!sampleFailure) {
      const stdout = error.stdout ? error.stdout.toString() : '';
      const stderr = error.stderr ? error.stderr.toString() : '';
      sampleFailure = (stdout || stderr || error.message).trim();
    }
  }
}

const flakeRate = failures / TOTAL_RUNS;
const testCode = fs.readFileSync(path.join(__dirname, targetTest), 'utf8');

const results = {
  targetTest,
  testCode,
  sourceCode: testCode,
  sampleFailure,
  totalRuns: TOTAL_RUNS,
  passes,
  failures,
  flakeRate,
  runResults,
};

const outputFile = process.argv[3] || 'results.json';
fs.writeFileSync(
  path.join(__dirname, outputFile),
  JSON.stringify(results, null, 2),
  'utf8'
);

console.log('\n--- Stress Test Completed ---');
console.log(`Target:     ${targetTest}`);
console.log(`Total Runs: ${TOTAL_RUNS}`);
console.log(`Passes:     ${passes}`);
console.log(`Failures:   ${failures}`);
console.log(`Flake Rate: ${(flakeRate * 100).toFixed(1)}%`);
console.log(`Results written to ${outputFile}`);

