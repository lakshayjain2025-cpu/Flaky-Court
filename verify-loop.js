require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { diagnose } = require('./diagnose');
const { runStressTest } = require('./stress-test');
const count = (name, fallback) => { const value = Number.parseInt(process.env[name], 10); return Number.isFinite(value) && value > 0 ? value : fallback; };
const BASELINE_RUNS = count('BASELINE_RUNS', 5), CANDIDATE_RUNS = count('CANDIDATE_RUNS', 3), CONFIRMATION_RUNS = count('CONFIRMATION_RUNS', 5), MAX_ATTEMPTS = count('MAX_DIAGNOSIS_ATTEMPTS', 3);
function writeJson(file, value) { fs.writeFileSync(path.join(__dirname, file), JSON.stringify(value, null, 2), 'utf8'); }
function remove(file) { try { fs.rmSync(path.join(__dirname, file), { force: true }); } catch { /* stale output is not fatal */ } }
function resultRecord(number, candidate, results, executionError) { return { candidateNumber: number, rationale: candidate.rationale, fixedCode: candidate.fixedCode, executable: !executionError, executionError: executionError || null, flakeRate: results ? results.flakeRate : null, flakeRatePercent: results ? results.flakeRate * 100 : null, totalRuns: results ? results.totalRuns : 0, failures: results ? results.failures : 0, runResults: results ? results.runResults : [] }; }
function isBetter(left, right) { return !right || left.flakeRate < right.flakeRate || (left.flakeRate === right.flakeRate && left.failures < right.failures); }
async function main() {
  const targetArgument = process.argv[2], namespace = process.argv[3] || 'verify';
  if (!targetArgument) throw new Error('Usage: node verify-loop.js <test-file> [namespace]');
  const targetPath = path.resolve(__dirname, targetArgument);
  if (!fs.existsSync(targetPath)) throw new Error(`Test file not found: ${targetArgument}`);
  const backupPath = `${targetPath}.flaky-court.backup`;
  // Recover first if an earlier process was interrupted during an in-place trial.
  if (fs.existsSync(backupPath)) {
    fs.copyFileSync(backupPath, targetPath);
    fs.rmSync(backupPath, { force: true });
    console.warn(`Recovered the original test from ${path.basename(backupPath)}.`);
  }
  const originalCode = fs.readFileSync(targetPath, 'utf8');
  fs.writeFileSync(backupPath, originalCode, 'utf8');
  const names = { before: `${namespace}-before-results.json`, diagnosis: `${namespace}-diagnosis-output.json`, candidate1: `${namespace}-candidate-1.test.js`, candidate2: `${namespace}-candidate-2.test.js`, candidate1Results: `${namespace}-candidate-1-results.json`, candidate2Results: `${namespace}-candidate-2-results.json`, fixed: `${namespace}-fixed.test.js`, after: `${namespace}-after-results.json`, final: `${namespace}-results.json` };
  Object.values(names).forEach(remove);
  let baseline, attemptHistory = [], winner = null, confirmation = null, finalDiagnosis = null, diagnosisError = null;
  try {
    baseline = await runStressTest({ testFile: targetPath, outputFile: names.before, phase: `before-${namespace}`, totalRuns: BASELINE_RUNS });
    let retryContext = null;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      let diagnosis;
      try { diagnosis = await diagnose(baseline, retryContext, names.diagnosis); }
      catch (error) { diagnosisError = error.message; break; }
      finalDiagnosis = diagnosis;
      const candidates = [];
      for (const [index, candidate] of diagnosis.candidates.entries()) {
        const number = index + 1, candidateFile = number === 1 ? names.candidate1 : names.candidate2, candidateResults = number === 1 ? names.candidate1Results : names.candidate2Results;
        fs.writeFileSync(path.join(__dirname, candidateFile), candidate.fixedCode, 'utf8');
        let tested = null, executionError = null;
        // Test at the original path: relative imports and local configuration remain valid.
        try { fs.writeFileSync(targetPath, candidate.fixedCode, 'utf8'); tested = await runStressTest({ testFile: targetPath, outputFile: candidateResults, phase: `candidate-${number}-${namespace}`, totalRuns: CANDIDATE_RUNS }); }
        catch (error) { executionError = error.message; }
        finally { fs.writeFileSync(targetPath, originalCode, 'utf8'); }
        candidates.push(resultRecord(number, candidate, tested, executionError));
      }
      const usable = candidates.filter((candidate) => candidate.executable && candidate.totalRuns > 0);
      const selected = usable.reduce((best, candidate) => isBetter(candidate, best) ? candidate : best, null);
      const entry = { attemptNumber: attempt, cause: diagnosis.cause, explanation: diagnosis.explanation, confidence: diagnosis.confidence, candidates, winningCandidate: selected ? selected.candidateNumber : null, winnerFlakeRate: selected ? selected.flakeRate : null, confirmationFlakeRate: null, confirmationRuns: 0, confirmationFailures: 0, flakeRateAfter: null };
      if (!selected) { attemptHistory.push(entry); retryContext = { note: 'Both generated candidates could not execute.', candidates }; continue; }
      try { fs.writeFileSync(targetPath, selected.fixedCode, 'utf8'); confirmation = await runStressTest({ testFile: targetPath, outputFile: names.after, phase: `after-${namespace}`, totalRuns: CONFIRMATION_RUNS }); }
      catch (error) { confirmation = null; entry.confirmationError = error.message; }
      finally { fs.writeFileSync(targetPath, originalCode, 'utf8'); }
      entry.confirmationFlakeRate = confirmation ? confirmation.flakeRate : null; entry.confirmationRuns = confirmation ? confirmation.totalRuns : 0; entry.confirmationFailures = confirmation ? confirmation.failures : 0; entry.flakeRateAfter = entry.confirmationFlakeRate;
      attemptHistory.push(entry);
      if (confirmation && confirmation.failures === 0) { winner = selected; break; }
      retryContext = { previousWinnerCandidate: selected.candidateNumber, previousFixedCode: selected.fixedCode, newFailureOutput: confirmation?.sampleFailure || entry.confirmationError || 'Confirmation could not run.', note: 'Generate two alternatives that address the failed confirmation.' };
    }
  } finally { fs.writeFileSync(targetPath, originalCode, 'utf8'); }
  const successful = Boolean(winner && confirmation && confirmation.failures === 0);
  if (successful) { fs.writeFileSync(targetPath, winner.fixedCode, 'utf8'); fs.writeFileSync(path.join(__dirname, names.fixed), winner.fixedCode, 'utf8'); if (namespace === 'verify') fs.writeFileSync(path.join(__dirname, 'fixed.test.js'), winner.fixedCode, 'utf8'); }
  fs.rmSync(backupPath, { force: true });
  const report = { namespace, targetTest: targetArgument, testName: targetArgument, iterations: attemptHistory.length, candidatesConsidered: 2, diagnosis: finalDiagnosis ? { cause: finalDiagnosis.cause, explanation: finalDiagnosis.explanation } : null, confidence: finalDiagnosis?.confidence || null, flakeRateBefore: baseline.flakeRate, totalRunsBefore: baseline.totalRuns, failuresBefore: baseline.failures, runResults: baseline.runResults, originalCode, attemptHistory, winningCandidate: successful ? winner.candidateNumber : null, winnerFlakeRate: successful ? winner.flakeRate : null, fixedCode: successful ? winner.fixedCode : null, flakeRateAfter: confirmation?.flakeRate ?? null, totalRunsAfter: confirmation?.totalRuns ?? 0, failuresAfter: confirmation?.failures ?? 0, success: successful, failureReason: successful ? null : diagnosisError || 'No candidate completed a zero-failure confirmation run; the original test was restored.' };
  writeJson(names.final, report); writeJson(`${namespace}-verify-summary.json`, { iterations: report.iterations, candidatesConsidered: 2, confidence: report.confidence, finalCause: report.diagnosis?.cause || null, finalExplanation: report.diagnosis?.explanation || null, success: successful }); if (namespace === 'verify') writeJson('results.json', report);
  console.log(`Verification ${successful ? 'succeeded' : 'did not verify a fix'}; results written to ${names.final}.`); return report;
}
module.exports = { main };
if (require.main === module) main().catch((error) => { console.error(`Verification loop failed: ${error.message}`); process.exitCode = 1; });
