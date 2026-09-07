const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function main() {
  const targetDir = process.argv[2];
  const concurrency = parseInt(process.argv[3], 10) || 2;

  if (!targetDir) {
    console.error('Usage: node repo-scan.js <folder-path> [concurrency]');
    process.exit(1);
  }

  const fullPath = path.resolve(targetDir);
  if (!fs.existsSync(fullPath)) {
    console.error(`Error: folder not found: ${fullPath}`);
    process.exit(1);
  }

  console.log(`Scanning ${fullPath} for test files...`);

  function findTestFiles(dir) {
    let results = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        results = results.concat(findTestFiles(entryPath));
      } else if (entry.isFile() && entry.name.endsWith('.test.js')) {
        results.push(entryPath);
      }
    }
    return results;
  }

  const testFiles = findTestFiles(fullPath);

  if (testFiles.length === 0) {
    console.error('No *.test.js files found in this folder.');
    process.exit(1);
  }

  console.log(`Found ${testFiles.length} test file(s):`);
  testFiles.forEach((f) => console.log(`  - ${f}`));

  const pLimit = (await import('p-limit')).default;
  const limit = pLimit(concurrency);

  const repoResults = [];
  const repoErrors = [];

  const tasks = testFiles.map((filePath, index) =>
    limit(async () => {
      const namespace = `repo${index}-${path.basename(filePath, '.test.js')}`;
      console.log(`\n[${namespace}] Starting verify-loop on ${filePath}...`);
      try {
        execSync(`node verify-loop.js "${filePath}" "${namespace}"`, {
          stdio: 'inherit',
          cwd: __dirname,
        });
        const resultPath = path.join(__dirname, `${namespace}-results.json`);
        const result = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
        repoResults.push({ namespace, filePath, ...result });
        console.log(`[${namespace}] Done.`);
      } catch (err) {
        console.error(`[${namespace}] Failed: ${err.message}`);
        repoErrors.push({ namespace, filePath, error: err.message });
      }
    })
  );

  await Promise.all(tasks);

  const summary = {
    scannedFolder: fullPath,
    totalTestFiles: testFiles.length,
    succeeded: repoResults.length,
    failed: repoErrors.length,
    results: repoResults,
    errors: repoErrors,
  };

  fs.writeFileSync(
    path.join(__dirname, 'repo-results.json'),
    JSON.stringify(summary, null, 2),
    'utf8'
  );

  console.log(`\n=== Repo Scan Complete ===`);
  console.log(`Total: ${testFiles.length} | Succeeded: ${repoResults.length} | Failed: ${repoErrors.length}`);
  console.log(`Full results written to repo-results.json`);
}

main().catch((err) => {
  console.error('repo-scan failed:', err);
  process.exit(1);
});