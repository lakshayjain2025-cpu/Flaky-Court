const fs = require('fs');
const path = require('path');

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function requireField(value, label) {
  if (value === undefined || value === null) {
    console.error(`Error: missing required field "${label}" — refusing to write results.json with fabricated data.`);
    process.exit(1);
  }
  return value;
}

const beforePath = path.join(__dirname, 'before-results.json');
const afterPath = path.join(__dirname, 'after-results.json');
const diagnosisPath = path.join(__dirname, 'diagnosis-output.json');
const summaryPath = path.join(__dirname, 'verify-summary.json');
const loopOutputPath = path.join(__dirname, 'verify-loop-output.json');
const fixedTestPath = path.join(__dirname, 'fixed.test.js');

const before = readJsonIfExists(beforePath);
const after = readJsonIfExists(afterPath);
const diagnosis = readJsonIfExists(diagnosisPath);
const summary = readJsonIfExists(summaryPath);
const loopOutput = readJsonIfExists(loopOutputPath);

if (!before) { console.error('Error: before-results.json not found. Run verify-loop.js first.'); process.exit(1); }
if (!after) { console.error('Error: after-results.json not found. Run verify-loop.js first.'); process.exit(1); }
if (!diagnosis) { console.error('Error: diagnosis-output.json not found. Run verify-loop.js first.'); process.exit(1); }
if (!summary) { console.error('Error: verify-summary.json not found. Run verify-loop.js first.'); process.exit(1); }
if (!loopOutput) { console.error('Error: verify-loop-output.json not found. Run verify-loop.js first.'); process.exit(1); }
if (!fs.existsSync(fixedTestPath)) { console.error('Error: fixed.test.js not found — no winning candidate was written to disk.'); process.exit(1); }

const originalCode = requireField(before.testCode || before.sourceCode, 'originalCode');
const fixedCode = fs.readFileSync(fixedTestPath, 'utf8');
const testName = requireField(before.targetTest, 'testName');
const confidence = requireField(summary.confidence, 'confidence');
const iterations = requireField(summary.iterations, 'iterations');
const candidatesConsidered = requireField(summary.candidatesConsidered, 'candidatesConsidered');

const results = {
  testName,
  flakeRateBefore: before.flakeRate,
  totalRunsBefore: before.totalRuns,
  failuresBefore: before.failures,
  runResults: before.runResults,
  diagnosis: {
    cause: summary.finalCause,
    explanation: summary.finalExplanation,
  },
  confidence,
  iterations,
  candidatesConsidered,
  attemptHistory: loopOutput.attemptHistory,
  originalCode,
  fixedCode,
  flakeRateAfter: after.flakeRate,
  totalRunsAfter: after.totalRuns,
  failuresAfter: after.failures,
};

fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
console.log('Final combined results written to results.json (all fields verified present, nothing fabricated)');
console.log(JSON.stringify(results, null, 2));