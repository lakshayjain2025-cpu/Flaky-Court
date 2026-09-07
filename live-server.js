require('dotenv').config();
const { execFile } = require('child_process');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const frontendDir = path.join(__dirname, 'dashboard', 'dist');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, __dirname),
  filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.test.js`),
});
const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.js')) {
      return cb(new Error('Only .js files are accepted.'));
    }
    cb(null, true);
  },
});

const app = express();
app.use(cors());
app.use(express.json());

let clients = [];
const verifyRuns = new Map();
const repoScans = new Map();

// Frontend connects here to receive live updates
app.get('/stream', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  clients.push(res);

  req.on('close', () => {
    clients = clients.filter((c) => c !== res);
  });
});

// stress-test.js calls this after every run
app.post('/update', (req, res) => {
  const data = req.body;
  clients.forEach((client) => {
    client.write(`data: ${JSON.stringify(data)}\n\n`);
  });
  res.sendStatus(200);
});

// --- AI call coordination lock ---
// Ensures only one diagnose.js call talks to Groq at a time, even when
// multiple verify-loop.js processes are running concurrently (repo scan).
let aiLockHeld = false;
let aiLockQueue = [];
let lastAiCallTime = 0;
const MIN_AI_GAP_MS = parseInt(process.env.GROQ_GAP_MS, 10) || 0;
function acquireAiLock(req, res) {
  const tryAcquire = () => {
    if (!aiLockHeld) {
      const now = Date.now();
      const elapsed = now - lastAiCallTime;
      const wait = Math.max(0, MIN_AI_GAP_MS - elapsed);
      aiLockHeld = true;
      setTimeout(() => {
        lastAiCallTime = Date.now();
        res.json({ acquired: true, waitedMs: wait, token: `${Date.now()}-${Math.random().toString(36).slice(2)}` });
      }, wait);
    } else {
      aiLockQueue.push(tryAcquire);
    }
  };
  tryAcquire();
}
function releaseAiLock(req, res) {
  aiLockHeld = false;
  const next = aiLockQueue.shift();
  if (next) next();
  res.json({ released: true });
}
app.post('/ai-lock', acquireAiLock);
app.post('/ai-unlock', releaseAiLock);
// Backwards-compatible aliases for clients from the Gemini-era UI.
app.post('/gemini-lock', acquireAiLock);
app.post('/gemini-unlock', releaseAiLock);

let verifyRunActive = false;

app.post('/run-stress-test', (req, res) => {
  const { testFile, outputFile, phase } = req.body;
  if (typeof testFile !== 'string') return res.status(400).json({ error: 'testFile is required' });
  execFile(process.execPath, ['stress-test.js', testFile, outputFile || 'results.json', phase || 'before'], { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ success: true, output: stdout });
  });
});

app.post('/apply-fix', (req, res) => {
  try {
    const diagnosisPath = path.join(__dirname, 'diagnosis-output.json');
    if (!fs.existsSync(diagnosisPath)) {
      return res.status(404).json({ error: 'diagnosis-output.json not found' });
    }
    const diagnosis = JSON.parse(fs.readFileSync(diagnosisPath, 'utf8'));

    // Support diagnosis.candidates[0].fixedCode as a shim, fallback to diagnosis.fixedCode
    const fixedCode = diagnosis.candidates?.[0]?.fixedCode || diagnosis.fixedCode;

    if (!fixedCode) {
      return res.status(400).json({ error: 'deprecated — use /run-verify-loop' });
    }

    fs.writeFileSync(path.join(__dirname, 'fixed.test.js'), fixedCode, 'utf8');
    res.json({ success: true, filename: 'fixed.test.js' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/run-verify-loop', (req, res) => {
  const { testFile, namespace } = req.body;
  const target = testFile || 'uploaded.test.js';
  if (typeof target !== 'string' || (namespace && typeof namespace !== 'string')) return res.status(400).json({ error: 'Invalid test file or namespace.' });
  if (verifyRunActive) return res.status(409).json({ error: 'A trial is already running. Wait for it to finish.' });

  // Respond immediately — frontend listens on SSE for verify-loop-complete/error
  const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  verifyRunActive = true;
  verifyRuns.set(runId, { status: 'running', startedAt: Date.now() });
  res.json({ success: true, runId, message: 'Verify loop started' });

  const args = ['verify-loop.js', target];
  if (namespace) args.push(namespace);
  execFile(process.execPath, args, { cwd: __dirname, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
    verifyRunActive = false;
    if (err) {
      const errMsg = (stderr || err.message || 'unknown error').slice(0, 500);
      verifyRuns.set(runId, { status: 'error', error: errMsg, finishedAt: Date.now() });
      clients.forEach((c) => c.write(`data: ${JSON.stringify({ type: 'verify-loop-error', runId, error: errMsg })}\n\n`));
      console.error('verify-loop error:', errMsg);
    } else {
      verifyRuns.set(runId, { status: 'complete', finishedAt: Date.now() });
      clients.forEach((c) => c.write(`data: ${JSON.stringify({ type: 'verify-loop-complete', runId })}\n\n`));
    }
  });
});

app.post('/run-diagnose', (req, res) => {
  const { inputFile, outputFile } = req.body;
  if ((inputFile && typeof inputFile !== 'string') || (outputFile && typeof outputFile !== 'string')) return res.status(400).json({ error: 'Invalid filename.' });
  execFile(process.execPath, ['diagnose.js', inputFile || 'results.json', outputFile || 'diagnosis-output.json'], { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ success: true, output: stdout });
  });
});

app.post('/run-repo-scan', (req, res) => {
  const { targetDir, concurrency } = req.body;
  const envConcurrency = process.env.REPO_CONCURRENCY || concurrency || 2;

  if (!targetDir) {
    return res.status(400).json({ error: 'targetDir is required' });
  }

  // Respond immediately — the scan runs in the background and pushes progress
  // via SSE (/update). The frontend listens for repo-scan-complete to know when done.
  const scanId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  repoScans.set(scanId, { status: 'running', startedAt: Date.now() });
  res.json({ success: true, scanId, message: 'Repo scan started' });

  if (typeof targetDir !== 'string') return res.status(400).json({ error: 'targetDir must be a string' });
  execFile(process.execPath, ['repo-scan.js', targetDir, String(envConcurrency)], { cwd: __dirname, maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      // Push the error to all SSE clients so the frontend can surface it
      const errMsg = (stderr || err.message || 'unknown error').slice(0, 500);
      clients.forEach((c) => c.write(`data: ${JSON.stringify({ type: 'repo-scan-error', error: errMsg })}\n\n`));
      console.error('repo-scan error:', errMsg);
      repoScans.set(scanId, { status: 'error', error: errMsg, finishedAt: Date.now() });
    } else {
      repoScans.set(scanId, { status: 'complete', finishedAt: Date.now() });
    }
  });
});

app.post('/run-finalize', (req, res) => {
  execFile(process.execPath, ['finalize.js'], { cwd: __dirname }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ success: true, output: stdout });
  });
});

app.post('/upload-test', (req, res) => {
  upload.single('testFile')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }
    res.json({ success: true, filename: req.file.filename });
  });
});

const zipStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, __dirname),
  filename: (req, file, cb) => cb(null, `uploaded-${Date.now()}.zip`),
});
const uploadZip = multer({
  storage: zipStorage,
  fileFilter: (req, file, cb) => {
    if (!file.originalname.toLowerCase().endsWith('.zip')) {
      return cb(new Error('Only .zip files are accepted.'));
    }
    cb(null, true);
  },
});

app.post('/upload-zip', (req, res) => {
  uploadZip.single('repoZip')(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) {
      return res.status(400).json({ error: 'No file was uploaded.' });
    }
    try {
      const zip = new AdmZip(req.file.path);
      const extractDir = path.join(__dirname, `repo-${Date.now()}`);
      zip.extractAllTo(extractDir, true);
      res.json({ success: true, extractedPath: extractDir });
    } catch (e) {
      res.status(500).json({ error: 'Failed to extract zip: ' + e.message });
    }
  });
});

app.get('/download-fixed', (req, res) => {
  const filePath = path.join(__dirname, 'fixed.test.js');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'No fixed file available yet' });
  }
  res.download(filePath, 'fixed.test.js');
});

app.get('/latest-results', (req, res) => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(404).json({ error: 'results.json not found' });
  }
});

app.get('/repo-scan-status/:scanId', (req, res) => {
  const scan = repoScans.get(req.params.scanId);
  if (!scan) return res.status(404).json({ error: 'Scan not found' });
  res.json(scan);
});

app.get('/latest-repo-results', (req, res) => {
  try {
    const data = fs.readFileSync(path.join(__dirname, 'repo-results.json'), 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(404).json({ error: 'repo-results.json not found' });
  }
});

// Railway starts this Express process, not Vite. Serve the production React
// bundle from the same origin so GET / and all browser API calls work there.
app.use(express.static(frontendDir));
app.get('/', (req, res) => {
  res.sendFile(path.join(frontendDir, 'index.html'), (error) => {
    if (error) {
      res.status(503).send('Frontend build is unavailable. Run the dashboard build first.');
    }
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Live server running on http://localhost:${PORT}`);
});

app.get('/verify-loop-status/:runId', (req, res) => {
  const run = verifyRuns.get(req.params.runId);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json(run);
});
