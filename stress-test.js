const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const fs = require('fs');
const path = require('path');
const pLimit = require('p-limit').default || require('p-limit');

const targetTest = process.argv[2] || 'flaky.test.js';
const outputFile = process.argv[3] || 'results.json';
let phase = 'before';
let TOTAL_RUNS = 50;

if (process.argv[5] !== undefined && !isNaN(parseInt(process.argv[5], 10))) {
  phase = process.argv[4] || 'before';
  TOTAL_RUNS = parseInt(process.argv[5], 10);
} else if (process.argv[4] !== undefined) {
  if (!isNaN(parseInt(process.argv[4], 10))) {
    TOTAL_RUNS = parseInt(process.argv[4], 10);
    phase = 'before';
  } else {
    phase = process.argv[4];
  }
}

const CONCURRENCY = 6; // how many browser tests run at once — tune based on your machine
const limit = pLimit(CONCURRENCY);

let passes = 0;
let failures = 0;
let sampleFailure = null;
let runResults = new Array(TOTAL_RUNS).fill(null);
let completedCount = 0;

console.log(`Running stress test: ${TOTAL_RUNS} iterations of ${targetTest} (concurrency: ${CONCURRENCY})...\n`);

async function sendUpdate(payload) {
  try {
    await fetch('http://localhost:4000/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    // live server might not be running — ignore silently
  }
}

function runOne(i) {
  return limit(async () => {
    try {
      await execAsync(`npx playwright test --output=test-results-run-${i}`, {
        encoding: 'utf8',
        env: {
          ...process.env,
          PLAYWRIGHT_TEST_FILE: targetTest,
        },
      });      passes++;
      runResults[i - 1] = 1;
      console.log(`Run ${i}/${TOTAL_RUNS}: PASS`);
    } catch (error) {
      failures++;
      runResults[i - 1] = 0;
      console.log(`Run ${i}/${TOTAL_RUNS}: FAIL`);
      if (!sampleFailure) {
        const stdout = error.stdout ? error.stdout.toString() : '';
        const stderr = error.stderr ? error.stderr.toString() : '';
        sampleFailure = (stdout || stderr || error.message).trim();
      }
    }
    completedCount++;
    // Send a live update using only the runs completed so far, in order
    const completedSoFar = runResults.filter((r) => r !== null);
    await sendUpdate({ currentRun: completedCount, totalRuns: TOTAL_RUNS, runResults: completedSoFar, phase });
  });
}

async function runLoop() {
  const tasks = [];
  for (let i = 1; i <= TOTAL_RUNS; i++) {
    tasks.push(runOne(i));
  }
  await Promise.all(tasks);
}

(async () => {
  const startTime = Date.now();
  await runLoop();
  const durationSec = ((Date.now() - startTime) / 1000).toFixed(1);

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
    durationSec,
  };

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
  console.log(`Duration:   ${durationSec}s`);
  console.log(`Results written to ${outputFile}`);
  // Clean up per-run temp output folders
  for (let i = 1; i <= TOTAL_RUNS; i++) {
    const dir = path.join(__dirname, `test-results-run-${i}`);
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
})();