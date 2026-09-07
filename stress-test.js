const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const path = require('path');
const execFileAsync = promisify(execFile);
const positive = (value, fallback) => { const parsed = Number.parseInt(value, 10); return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback; };
async function notify(payload) { try { await fetch(`http://localhost:${process.env.PORT || 4000}/update`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }); } catch { /* CLI use has no server */ } }
async function runStressTest({ testFile, outputFile = 'results.json', phase = 'before', totalRuns = positive(process.env.STRESS_RUNS, 50) }) {
  const resolvedTest = path.resolve(__dirname, testFile);
  if (!fs.existsSync(resolvedTest)) throw new Error(`Test file not found: ${testFile}`);
  const runs = positive(totalRuns, 50), concurrency = Math.min(positive(process.env.STRESS_CONCURRENCY, 1), runs), runResults = new Array(runs).fill(null);
  let passes = 0, failures = 0, sampleFailure = null, next = 0, completed = 0; const started = Date.now();
  const playwrightCli = require.resolve('@playwright/test/cli');
  async function worker() { while (true) { const index = next++; if (index >= runs) return; const resultDir = path.join(__dirname, `.flaky-court-results-${process.pid}-${phase}-${index + 1}`); try { await execFileAsync(process.execPath, [playwrightCli, 'test', '--output', resultDir], { cwd: __dirname, windowsHide: true, maxBuffer: 10 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_TEST_FILE: resolvedTest } }); runResults[index] = 1; passes += 1; } catch (error) { runResults[index] = 0; failures += 1; if (!sampleFailure) sampleFailure = String(error.stdout || error.stderr || error.message).trim().slice(0, 10000); } finally { fs.rmSync(resultDir, { recursive: true, force: true }); completed += 1; await notify({ currentRun: completed, totalRuns: runs, runResults: runResults.filter((item) => item !== null), phase }); } } }
  console.log(`Running ${runs} iteration(s) of ${testFile} (concurrency: ${concurrency})...`);
  await Promise.all(Array.from({ length: concurrency }, worker));
  const testCode = fs.readFileSync(resolvedTest, 'utf8'); const results = { targetTest: testFile, testCode, sourceCode: testCode, sampleFailure, totalRuns: runs, passes, failures, flakeRate: failures / runs, runResults, durationSec: ((Date.now() - started) / 1000).toFixed(1) };
  fs.writeFileSync(path.resolve(__dirname, outputFile), JSON.stringify(results, null, 2), 'utf8'); console.log(`Completed: ${passes}/${runs} passed; ${(results.flakeRate * 100).toFixed(1)}% failed.`); return results;
}
module.exports = { runStressTest };
if (require.main === module) { const [, , testFile = 'flaky.test.js', outputFile = 'results.json', phase = 'before', requestedRuns] = process.argv; runStressTest({ testFile, outputFile, phase, totalRuns: requestedRuns || process.env.STRESS_RUNS }).catch((error) => { console.error(`Stress test failed: ${error.message}`); process.exitCode = 1; }); }
