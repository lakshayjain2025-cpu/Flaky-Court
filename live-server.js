const express = require('express');
const cors = require('cors');

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

const PORT = 4000;
app.listen(PORT, () => {
  console.log(`Live server running on http://localhost:${PORT}`);
});