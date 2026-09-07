const fs = require('fs');
const path = require('path');

const namespace = process.argv[2] || 'verify';
const source = path.join(__dirname, `${namespace}-results.json`);
if (!fs.existsSync(source)) {
  console.error(`Error: ${namespace}-results.json not found. Run verify-loop.js first.`);
  process.exitCode = 1;
} else {
  try {
    const results = JSON.parse(fs.readFileSync(source, 'utf8'));
    fs.writeFileSync(path.join(__dirname, 'results.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log('Final combined results written to results.json.');
  } catch (error) {
    console.error(`Error: could not finalize results: ${error.message}`);
    process.exitCode = 1;
  }
}
