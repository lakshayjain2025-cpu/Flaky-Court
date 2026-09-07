const { runPipeline } = require('./pipeline');
runPipeline({ testFile: process.argv[2] || 'flaky.test.js', namespace: process.argv[3] || 'verify' })
  .then((result) => { if (!result.success) process.exitCode = 1; })
  .catch((error) => { console.error(`Pipeline failed: ${error.message}`); process.exitCode = 1; });
