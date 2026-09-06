const fs = require('fs');
const path = require('path');

const beforePath = path.join(__dirname, 'before-results.json');
const afterPath = path.join(__dirname, 'after-results.json');
const diagnosisPath = path.join(__dirname, 'diagnosis-output.json');

const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));
const diagnosis = JSON.parse(fs.readFileSync(diagnosisPath, 'utf8'));

const results = {
  testName: before.targetTest,
  flakeRateBefore: before.flakeRate,
  totalRunsBefore: before.totalRuns,
  failuresBefore: before.failures,
  runResults: before.runResults,
  diagnosis: {
    cause: diagnosis.cause,
    explanation: diagnosis.explanation,
  },
  originalCode: before.testCode,
  fixedCode: diagnosis.fixedCode,
  flakeRateAfter: after.flakeRate,
  totalRunsAfter: after.totalRuns,
  failuresAfter: after.failures,
};

const resultsPath = path.join(__dirname, 'results.json');
fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2), 'utf8');
console.log('Final combined results written to results.json');
console.log(JSON.stringify(results, null, 2));