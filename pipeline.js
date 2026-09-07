const { main } = require('./verify-loop');
async function runPipeline({ testFile = 'uploaded.test.js', namespace = 'verify' } = {}) {
  const previous = process.argv.slice(); process.argv = [previous[0], previous[1], testFile, namespace];
  try { return await main(); } finally { process.argv = previous; }
}
module.exports = { runPipeline };
if (require.main === module) runPipeline({ testFile: process.argv[2] || 'uploaded.test.js', namespace: process.argv[3] || 'verify' }).catch((error) => { console.error(`Pipeline failed: ${error.message}`); process.exitCode = 1; });
