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

const namespace = process.argv[2] || null;
const f = (name) => (namespace ? `${namespace}-${name}` : name);

const beforePath = path.join(__dirname, f('before-results.json'));
const afterPath = path.join(__dirname, f('after-results.json'));
const diagnosisPath = path.join(__dirname, f('diagnosis-output.json'));
const summaryPath = path.join(__dirname, f('verify-summary.json'));
const loopOutputPath = path.join(__dirname, f('verify-loop-output.json'));
const fixedTestPath = path.join(__dirname, f('fixed.test.js'));

const before = readJsonIfExists(beforePath);
const after = readJsonIfExists(afterPath);
const diagnosis = readJsonIfExists(diagnosisPath);
const summary = readJsonIfExists(summaryPath);
const loopOutput = readJsonIfExists(loopOutputPath);

if (!before) { console.error(`Error: ${f('before-results.json')} not found. Run verify-loop.js first.`); process.exit(1); }
if (!after) { console.error(`Error: ${f('after-results.json')} not found. Run verify-loop.js first.`); process.exit(1); }
if (!diagnosis) { console.error(`Error: ${f('diagnosis-output.json')} not found. Run verify-loop.js first.`); process.exit(1); }
if (!summary) { console.error(`Error: ${f('verify-summary.json')} not found. Run verify-loop.js first.`); process.exit(1); }
if (!loopOutput) { console.error(`Error: ${f('verify-loop-output.json')} not found. Run verify-loop.js first.`); process.exit(1); }
if (!fs.existsSync(fixedTestPath)) { console.error(`Error: ${f('fixed.test.js')} not found — no winning candidate was written to disk.`); process.exit(1); }

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

// Always write the namespaced copy (needed for repo-level aggregation).
const namespacedOutputPath = path.join(__dirname, f('results.json'));
fs.writeFileSync(namespacedOutputPath, JSON.stringify(results, null, 2), 'utf8');
console.log(`Final combined results written to ${f('results.json')} (all fields verified present, nothing fabricated)`);

// Also write the plain results.json — this keeps the existing single-file
// dashboard flow working unchanged when verify-loop.js is run without a
// namespace, or is the only/last file processed in a batch.
if (namespace) {
  fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
}

console.log(JSON.stringify(results, null, 2));