const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { createTwoFilesPatch } = require('diff');
const { runStressTest } = require('./stress-test');
const { diagnose } = require('./diagnose');
const { sendUpdate } = require('./send-update');

const MAX_ATTEMPTS = 3;
const SCREEN_RUNS = 15;
const CONFIRM_RUNS = 50;

function writeJson(file, data) {
  fs.writeFileSync(path.join(__dirname, file), JSON.stringify(data, null, 2), 'utf8');
}

function pct(rate) {
  return `${(rate * 100).toFixed(1)}%`;
}

async function status(message, extra = {}) {
  console.log(`\n${message}\n`);
  await sendUpdate({ type: 'status', message, ...extra });
}

function writePatch(originalName, originalCode, fixedCode) {
  const patch = createTwoFilesPatch(
    originalName || 'original.test.js',
    'fixed.test.js',
    originalCode || '',
    fixedCode || '',
    'original',
    'verified fix'
  );
  fs.writeFileSync(path.join(__dirname, 'fix.patch'), patch, 'utf8');
  return patch;
}

function writePrDescription({
  testName,
  diagnosis,
  before,
  after,
  iterations,
  candidatesTried,
  converged,
}) {
  const candidateLines = candidatesTried
    .map((c) => {
      const mark = c.selectedForConfirm ? ' (selected for 50-run confirm)' : '';
      return `- Attempt ${c.attempt}, ${c.label}: ${pct(c.flakeRate)} over ${c.totalRuns} runs (${c.failures} failed)${mark}`;
    })
    .join('\n');

  const body = `# Fix flaky test: ${testName}

## Diagnosis
**Cause:** ${diagnosis.cause}
**Confidence:** ${diagnosis.confidence} — ${diagnosis.confidenceReason}

${diagnosis.explanation}

## Empirical verification
- **Before:** ${pct(before.flakeRate)} flake rate (${before.failures}/${before.totalRuns} failed)
- **After:** ${pct(after.flakeRate)} flake rate (${after.failures}/${after.totalRuns} failed)
- **Iterations:** ${iterations} of ${MAX_ATTEMPTS}
- **Converged to 0 failures:** ${converged ? 'yes' : 'no'}

## Candidates screened
${candidateLines || '- (none)'}

## Why this is measured, not a single API call
The system generated two distinct candidate fixes, stress-tested each on a ${SCREEN_RUNS}-run sample, confirmed the winner on ${CONFIRM_RUNS} runs, and if the winner was not 0/${CONFIRM_RUNS}, fed that residual failure plus the failed fix back into diagnosis (up to ${MAX_ATTEMPTS} attempts).

## Patch
See \`fix.patch\`.
`;

  fs.writeFileSync(path.join(__dirname, 'PR_DESCRIPTION.md'), body, 'utf8');
  return body;
}

function tryCreatePullRequest(title) {
  try {
    execSync('gh auth status', { encoding: 'utf8', stdio: 'pipe' });
  } catch {
    console.log('GitHub CLI not authenticated — keeping local fix.patch + PR_DESCRIPTION.md only.');
    return null;
  }

  const currentBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  const branch = `flaky-court-fix-${Date.now()}`;

  try {
    execSync(`git checkout -b ${branch}`, { stdio: 'inherit' });
    execSync('git add -- fixed.test.js fix.patch PR_DESCRIPTION.md', { stdio: 'inherit' });

    const staged = execSync('git diff --cached --name-only -- fixed.test.js fix.patch PR_DESCRIPTION.md', {
      encoding: 'utf8',
    }).trim();

    if (!staged) {
      console.log('No artifact changes to commit — skipping gh pr create.');
      execSync(`git checkout ${currentBranch}`, { stdio: 'inherit' });
      try {
        execSync(`git branch -D ${branch}`, { stdio: 'pipe' });
      } catch {
        // ignore
      }
      return null;
    }

    execSync('git commit -m "Fix flaky Playwright test after empirical verification"', {
      stdio: 'inherit',
    });
    execSync('git push -u origin HEAD', { stdio: 'inherit' });
    const prUrl = execSync(
      `gh pr create --title ${JSON.stringify(title)} --body-file PR_DESCRIPTION.md`,
      { encoding: 'utf8' }
    ).trim();
    execSync(`git checkout ${currentBranch}`, { stdio: 'inherit' });
    console.log(`Pull request created: ${prUrl}`);
    return prUrl;
  } catch (err) {
    console.log('gh pr create skipped (auth/push failed). Local patch + markdown still written.');
    console.log(err.message || String(err));
    try {
      execSync(`git checkout ${currentBranch}`, { stdio: 'pipe' });
    } catch {
      // ignore
    }
    return null;
  }
}

async function runPipeline({ testFile = 'uploaded.test.js' } = {}) {
  const previousAttempts = [];
  const candidatesTried = [];
  const attempts = [];
  let iterations = 0;
  let lastDiagnosis = null;
  let afterResults = null;
  let winningCandidate = null;

  await status(`Stress-testing original test — ${CONFIRM_RUNS} runs…`, { attempt: 0 });
  const before = await runStressTest({
    testFile,
    outputFile: 'before-results.json',
    phase: 'before',
    totalRuns: CONFIRM_RUNS,
  });

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    iterations = attempt;
    await status(`Diagnosing with AI — attempt ${attempt}/${MAX_ATTEMPTS}…`, {
      attempt,
      maxAttempts: MAX_ATTEMPTS,
    });

    const diagnosis = await diagnose({
      inputFile: 'before-results.json',
      outputFile: 'diagnosis-output.json',
      previousAttempts,
    });
    lastDiagnosis = diagnosis;

    if (!diagnosis.candidates.length) {
      throw new Error('Diagnosis returned no candidate fixes.');
    }

    const screened = [];
    for (let i = 0; i < diagnosis.candidates.length; i++) {
      const candidate = diagnosis.candidates[i];
      const candidateFile = `candidate-${i + 1}.test.js`;
      fs.writeFileSync(path.join(__dirname, candidateFile), candidate.fixedCode, 'utf8');

      await status(
        `Attempt ${attempt}: screening candidate ${i + 1}/${diagnosis.candidates.length} (${candidate.label}) — ${SCREEN_RUNS} runs…`,
        { attempt, candidateLabel: candidate.label }
      );

      const screen = await runStressTest({
        testFile: candidateFile,
        outputFile: `candidate-${i + 1}-results.json`,
        phase: `candidate-${i + 1}`,
        totalRuns: SCREEN_RUNS,
        attempt,
        candidateLabel: candidate.label,
      });

      const record = {
        attempt,
        index: i + 1,
        label: candidate.label,
        fixedCode: candidate.fixedCode,
        flakeRate: screen.flakeRate,
        failures: screen.failures,
        totalRuns: screen.totalRuns,
        sampleFailure: screen.sampleFailure,
        selectedForConfirm: false,
      };
      screened.push(record);
      candidatesTried.push(record);
    }

    screened.sort((a, b) => a.flakeRate - b.flakeRate || a.failures - b.failures);
    const winner = screened[0];
    winner.selectedForConfirm = true;
    winningCandidate = winner;
    fs.writeFileSync(path.join(__dirname, 'fixed.test.js'), winner.fixedCode, 'utf8');

    await status(
      `Attempt ${attempt}: confirming winner "${winner.label}" — ${CONFIRM_RUNS} runs…`,
      { attempt, candidateLabel: winner.label }
    );

    afterResults = await runStressTest({
      testFile: 'fixed.test.js',
      outputFile: 'after-results.json',
      phase: 'after',
      totalRuns: CONFIRM_RUNS,
      attempt,
      candidateLabel: winner.label,
    });

    attempts.push({
      attempt,
      winnerLabel: winner.label,
      screenFlakeRate: winner.flakeRate,
      confirmFlakeRate: afterResults.flakeRate,
      confirmFailures: afterResults.failures,
      confirmRuns: afterResults.totalRuns,
    });

    console.log(
      `\n=== Iteration ${attempt}/${MAX_ATTEMPTS}: confirm ${afterResults.failures}/${afterResults.totalRuns} failed (${pct(afterResults.flakeRate)}) ===\n`
    );

    if (afterResults.failures === 0) {
      console.log(`Converged in ${iterations} iteration(s).`);
      break;
    }

    previousAttempts.push({
      attempt,
      label: winner.label,
      fixedCode: winner.fixedCode,
      flakeRate: afterResults.flakeRate,
      failures: afterResults.failures,
      totalRuns: afterResults.totalRuns,
      sampleFailure: afterResults.sampleFailure,
      whyItDidntWork: `Selected candidate "${winner.label}" screened at ${pct(winner.flakeRate)} over ${SCREEN_RUNS} runs, then still failed ${afterResults.failures}/${afterResults.totalRuns} on full confirmation. Residual failure must be addressed by a different strategy.`,
    });
  }

  const converged = Boolean(afterResults && afterResults.failures === 0);
  if (!converged) {
    console.log(`Did not reach 0/${CONFIRM_RUNS} after ${iterations} iteration(s).`);
  }

  lastDiagnosis = lastDiagnosis || {};
  lastDiagnosis.fixedCode = winningCandidate ? winningCandidate.fixedCode : lastDiagnosis.fixedCode;
  writeJson('diagnosis-output.json', lastDiagnosis);

  writePatch(before.targetTest, before.testCode, lastDiagnosis.fixedCode);
  writePrDescription({
    testName: before.targetTest,
    diagnosis: lastDiagnosis,
    before,
    after: afterResults,
    iterations,
    candidatesTried,
    converged,
  });

  const prTitle = `Fix flaky test ${before.targetTest} (${lastDiagnosis.cause || 'flake'})`;
  const prUrl = tryCreatePullRequest(prTitle);

  const results = {
    testName: before.targetTest,
    flakeRateBefore: before.flakeRate,
    totalRunsBefore: before.totalRuns,
    failuresBefore: before.failures,
    runResults: before.runResults,
    diagnosis: {
      cause: lastDiagnosis.cause,
      explanation: lastDiagnosis.explanation,
      confidence: lastDiagnosis.confidence,
      confidenceReason: lastDiagnosis.confidenceReason,
    },
    originalCode: before.testCode,
    fixedCode: lastDiagnosis.fixedCode,
    flakeRateAfter: afterResults ? afterResults.flakeRate : null,
    totalRunsAfter: afterResults ? afterResults.totalRuns : 0,
    failuresAfter: afterResults ? afterResults.failures : 0,
    afterRunResults: afterResults ? afterResults.runResults : [],
    iterations,
    maxAttempts: MAX_ATTEMPTS,
    candidatesTried: candidatesTried.map(({ fixedCode, sampleFailure, ...rest }) => rest),
    attempts,
    converged,
    artifacts: {
      patchFile: 'fix.patch',
      prDescriptionFile: 'PR_DESCRIPTION.md',
      prUrl,
    },
  };

  writeJson('results.json', results);
  console.log('Final combined results written to results.json');
  console.log(`Iterations: ${iterations} | Confidence: ${lastDiagnosis.confidence} | Converged: ${converged}`);
  return results;
}

module.exports = { runPipeline, MAX_ATTEMPTS, SCREEN_RUNS, CONFIRM_RUNS };

if (require.main === module) {
  runPipeline({ testFile: process.argv[2] || 'uploaded.test.js' }).catch((err) => {
    console.error('Pipeline failed:', err);
    process.exit(1);
  });
}
