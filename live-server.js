const { exec } = require('child_process');
const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, __dirname),
  filename: (req, file, cb) => cb(null, 'uploaded.test.js'),
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
app.post('/run-stress-test', (req, res) => {
  const { testFile, outputFile, phase } = req.body;
  exec(`node stress-test.js ${testFile} ${outputFile || 'results.json'} ${phase || 'before'}`, (err, stdout, stderr) => {    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ success: true, output: stdout });
  });
});
app.post('/apply-fix', (req, res) => {
  const fs = require('fs');
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
  const { testFile } = req.body;
  exec(`node verify-loop.js ${testFile || 'uploaded.test.js'}`, { maxBuffer: 50 * 1024 * 1024 }, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ success: true, output: stdout });
  });
});

app.post('/run-diagnose', (req, res) => {
  const { inputFile, outputFile } = req.body;
  exec(`node diagnose.js ${inputFile || 'results.json'} ${outputFile || 'diagnosis-output.json'}`, (err, stdout, stderr) => {
    if (err) {
      return res.status(500).json({ error: stderr || err.message });
    }
    res.json({ success: true, output: stdout });
  });
});

app.post('/run-finalize', (req, res) => {
  exec(`node finalize.js`, (err, stdout, stderr) => {
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
    res.json({ success: true, filename: 'uploaded.test.js' });
  });
});

app.get('/download-fixed', (req, res) => {
  const fs = require('fs');
  const filePath = path.join(__dirname, 'fixed.test.js');
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'No fixed file available yet' });
  }
  res.download(filePath, 'fixed.test.js');
});

app.get('/latest-results', (req, res) => {
  const fs = require('fs');
  const path = require('path');
  try {
    const data = fs.readFileSync(path.join(__dirname, 'results.json'), 'utf8');
    res.json(JSON.parse(data));
  } catch (e) {
    res.status(404).json({ error: 'results.json not found' });
  }
});
const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Live server running on http://localhost:${PORT}`);
});