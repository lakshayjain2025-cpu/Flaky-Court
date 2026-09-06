const { execSync } = require('child_process');

function run(command) {
  console.log(`\n▶ Running: ${command}\n`);
  execSync(command, { stdio: 'inherit' });
}

console.log('=== FLAKY COURT: Full Pipeline ===\n');

console.log('STEP 1: Stress-testing the original test...');
run('node stress-test.js flaky.test.js');

console.log('\nSTEP 2: Diagnosing root cause with AI...');
run('node diagnose.js');

console.log('\nSTEP 3: Applying AI-suggested fix and re-validating...');
run('node stress-test.js flaky-fixed.test.js');

console.log('\nSTEP 4: Finalizing combined report...');
run('node finalize.js');

console.log('\n=== PIPELINE COMPLETE ===');
console.log('Results written to results.json');