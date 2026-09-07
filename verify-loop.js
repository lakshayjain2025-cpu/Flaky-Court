const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { diagnose } = require('./diagnose');

async function main() {
  console.log('=== Starting Self-Correction Verify Loop (2-Candidate Tournament) ===\n');

  const targetTest = process.argv[2] || 'uploaded.test.js';

  // Clear any leftover artifacts from a previous run so a new upload is
  // never silently contaminated by stale results.
  const staleFiles = [
    'before-results.json',
    'after-results.json',
    'results.json',
    'diagnosis-output.json',
    'verify-loop-output.json',
    'verify-summary.json',
    'candidate-1.test.js',
    'candidate-1-results.json',
    'candidate-2.test.js',
    'candidate-2-results.json',
    'fixed.test.js',
  ];
  for (const file of staleFiles) {
    const filePath = path.join(__dirname, file);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`Cleared stale file: ${file}`);
    }
  }

  // Baseline — always run fresh, never reuse a cached before-results.json
  console.log(`Running: node stress-test.js ${targetTest} before-results.json before 50`);
  execSync(`node stress-test.js ${targetTest} before-results.json before 50`, {
    stdio: 'inherit',
    cwd: __dirname,
  });
  const baseline = JSON.parse(fs.readFileSync(path.join(__dirname, 'before-results.json'), 'utf8'));

  console.log(`Baseline target: ${baseline.targetTest || targetTest}`);
  console.log(`Baseline Flake Rate: ${(baseline.flakeRate * 100).toFixed(1)}% (${baseline.failures}/${baseline.totalRuns} failures)\n`);

  const MAX_ATTEMPTS = 3;
  let iterations = 0;
  const attemptHistory = [];
  let retryContext = null;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    iterations = attempt;
    console.log(`\n========================================`);
    console.log(`Attempt ${attempt} of ${MAX_ATTEMPTS}`);
    console.log(`========================================`);

    console.log(`Calling diagnose() to generate 2 candidates...`);
    const diagnosis = await diagnose(baseline, retryContext);

    if (!diagnosis.candidates || !Array.isArray(diagnosis.candidates) || diagnosis.candidates.length < 2) {
      throw new Error(`Expected at least 2 candidates from diagnose(), got: ${JSON.stringify(diagnosis.candidates)}`);
    }

    const candidate1 = diagnosis.candidates[0];
    const candidate2 = diagnosis.candidates[1];

    console.log(`\nCandidate 1 Rationale: ${candidate1.rationale}`);
    console.log(`Candidate 2 Rationale: ${candidate2.rationale}`);
    console.log(`Confidence: ${diagnosis.confidence.level.toUpperCase()} — ${diagnosis.confidence.reason}`);

    const cand1Path = path.join(__dirname, 'candidate-1.test.js');
    const cand2Path = path.join(__dirname, 'candidate-2.test.js');
    fs.writeFileSync(cand1Path, candidate1.fixedCode, 'utf8');
    fs.writeFileSync(cand2Path, candidate2.fixedCode, 'utf8');
    console.log(`\nWrote candidate-1.test.js and candidate-2.test.js`);

    console.log(`\n--- Shootout: Testing Candidate 1 (15 runs) ---`);
    execSync('node stress-test.js candidate-1.test.js candidate-1-results.json candidate-1 15', {
      stdio: 'inherit',
      cwd: __dirname,
    });
    const cand1Results = JSON.parse(fs.readFileSync(path.join(__dirname, 'candidate-1-results.json'), 'utf8'));
    console.log(`Candidate 1 Flake Rate (15 runs): ${(cand1Results.flakeRate * 100).toFixed(1)}% (${cand1Results.failures}/${cand1Results.totalRuns})`);

    console.log(`\n--- Shootout: Testing Candidate 2 (15 runs) ---`);
    execSync('node stress-test.js candidate-2.test.js candidate-2-results.json candidate-2 15', {
      stdio: 'inherit',
      cwd: __dirname,
    });
    const cand2Results = JSON.parse(fs.readFileSync(path.join(__dirname, 'candidate-2-results.json'), 'utf8'));
    console.log(`Candidate 2 Flake Rate (15 runs): ${(cand2Results.flakeRate * 100).toFixed(1)}% (${cand2Results.failures}/${cand2Results.totalRuns})`);

    let winnerIndex = 0;
    if (cand2Results.flakeRate < cand1Results.flakeRate) {
      winnerIndex = 1;
    }
    const winnerNumber = winnerIndex + 1;
    const winningCandidate = winnerIndex === 0 ? candidate1 : candidate2;
    const winnerResults = winnerIndex === 0 ? cand1Results : cand2Results;
    const winnerFlakeRate15 = winnerResults.flakeRate;

    console.log(`\n>>> Winner of 15-run shootout: Candidate ${winnerNumber} with ${(winnerFlakeRate15 * 100).toFixed(1)}% flake rate`);

    const fixedTestPath = path.join(__dirname, 'fixed.test.js');
    fs.writeFileSync(fixedTestPath, winningCandidate.fixedCode, 'utf8');
    console.log(`Copied Candidate ${winnerNumber} to fixed.test.js`);

    console.log(`\n--- Running 50-run confirmation on fixed.test.js ---`);
    execSync('node stress-test.js fixed.test.js after-results.json after 50', {
      stdio: 'inherit',
      cwd: __dirname,
    });

    const afterResults = JSON.parse(fs.readFileSync(path.join(__dirname, 'after-results.json'), 'utf8'));
    const confirmationRate = afterResults.flakeRate;
    console.log(`50-run Confirmation Flake Rate: ${(confirmationRate * 100).toFixed(1)}% (${afterResults.failures}/${afterResults.totalRuns})`);

    const attemptRecord = {
      attemptNumber: attempt,
      cause: diagnosis.cause,
      explanation: diagnosis.explanation,
      confidence: diagnosis.confidence,
      candidates: [
        {
          candidateNumber: 1,
          rationale: candidate1.rationale,
          flakeRate15: cand1Results.flakeRate,
        },
        {
          candidateNumber: 2,
          rationale: candidate2.rationale,
          flakeRate15: cand2Results.flakeRate,
        },
      ],
      winningCandidate: winnerNumber,
      winnerFlakeRate15,
      confirmationFlakeRate50: confirmationRate,
      flakeRateAfter: confirmationRate,
    };

    attemptHistory.push(attemptRecord);

    if (confirmationRate === 0) {
      console.log(`\n[SUCCESS] Attempt ${attempt}: Candidate ${winnerNumber} passed 50-run confirmation with 0% flakiness!`);
      break;
    }

    console.log(`\n[RETRY NEEDED] Attempt ${attempt} winner failed 50-run confirmation (${(confirmationRate * 100).toFixed(1)}% flake rate).`);

    if (attempt < MAX_ATTEMPTS) {
      console.log(`Building retryContext for attempt ${attempt + 1}...`);
      retryContext = {
        originalTestCode: baseline.testCode || baseline.sourceCode,
        previousWinnerCandidate: winnerNumber,
        previousFixedCode: winningCandidate.fixedCode,
        previousRationale: winningCandidate.rationale,
        winnerFlakeRate15,
        confirmationFlakeRate50: confirmationRate,
        newFailureOutput: afterResults.sampleFailure || 'Test failed during 50-run confirmation.',
        note: `Candidate ${winnerNumber} (rationale: "${winningCandidate.rationale}") won the 15-run test with ${(winnerFlakeRate15 * 100).toFixed(1)}% flake rate, but failed the 50-run confirmation with ${(confirmationRate * 100).toFixed(1)}% flake rate.\nHere is the failure output from the confirmation test:\n${afterResults.sampleFailure || 'None'}\n\nPlease propose 2 NEW and DIFFERENT candidates that avoid this failure.`,
      };
    } else {
      console.log(`Reached max attempts limit of ${MAX_ATTEMPTS}.`);
    }
  }

  const loopOutput = {
    iterations,
    attemptHistory,
  };

  const outputPath = path.join(__dirname, 'verify-loop-output.json');
  fs.writeFileSync(outputPath, JSON.stringify(loopOutput, null, 2), 'utf8');

  const lastAttempt = attemptHistory[attemptHistory.length - 1];
  const summary = {
    iterations,
    candidatesConsidered: iterations * 2,
    confidence: lastAttempt.confidence,
    finalCause: lastAttempt.cause,
    finalExplanation: lastAttempt.explanation,
    flakeRateBefore: baseline.flakeRate,
    flakeRateAfter: lastAttempt.flakeRateAfter,
  };
  fs.writeFileSync(path.join(__dirname, 'verify-summary.json'), JSON.stringify(summary, null, 2), 'utf8');

  console.log(`\n=== Verification Loop Finished ===`);
  console.log(`Results written to verify-loop-output.json:`);
  console.log(JSON.stringify(loopOutput, null, 2));
  console.log(`\nSummary written to verify-summary.json:`);
  console.log(JSON.stringify(summary, null, 2));

  console.log(`\n--- Finalizing combined report ---`);
  execSync('node finalize.js', { stdio: 'inherit', cwd: __dirname });
}

main().catch((err) => {
  console.error('verify-loop failed:', err);
  process.exit(1);
});