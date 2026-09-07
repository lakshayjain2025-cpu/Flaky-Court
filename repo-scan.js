const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

async function main() {
  const targetDir = process.argv[2];
  const concurrency = parseInt(process.argv[3], 10) || 2;

  async function sendUpdate(payload) {
    try {
      await fetch('http://localhost:4000/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // live server might not be running — ignore silently
    }
  }

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

  await sendUpdate({
    type: 'repo-scan-start',
    targetDir: fullPath,
    testFiles: testFiles.map(f => path.basename(f)),
    totalFiles: testFiles.length,
  });

  // Inline concurrency limiter — avoids the ESM-only p-limit package in a CJS project.
  function makePool(limit) {
    let active = 0;
    const queue = [];
    function run(fn, resolve, reject) {
      active++;
      Promise.resolve().then(() => fn()).then(
        (v) => { active--; resolve(v); drain(); },
        (e) => { active--; reject(e); drain(); }
      );
    }
    function drain() {
      while (active < limit && queue.length) {
        const { fn, resolve, reject } = queue.shift();
        run(fn, resolve, reject);
      }
    }
    return function schedule(fn) {
      return new Promise((resolve, reject) => {
        if (active < limit) { run(fn, resolve, reject); }
        else { queue.push({ fn, resolve, reject }); }
      });
    };
  }
  const limit = makePool(concurrency);

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

        await sendUpdate({
          type: 'repo-scan-progress',
          namespace,
          file: path.basename(filePath),
          status: 'success',
          result
        });
      } catch (err) {
        console.error(`[${namespace}] Failed: ${err.message}`);
        repoErrors.push({ namespace, filePath, error: err.message });

        await sendUpdate({
          type: 'repo-scan-progress',
          namespace,
          file: path.basename(filePath),
          status: 'error',
          error: err.message
        });
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

  await sendUpdate({
    type: 'repo-scan-complete',
    summary
  });

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