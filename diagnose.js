require('dotenv').config();
const fs = require('fs');
const path = require('path');

const DEFAULT_MODEL = 'openai/gpt-oss-120b';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const configNumber = (name, fallback) => {
  const value = Number.parseInt(process.env[name], 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
};
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (error) { throw new Error(`Could not read valid JSON from ${file}: ${error.message}`); }
}
function writeJsonAtomically(file, value) {
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), 'utf8');
  fs.renameSync(temporary, file);
}
function normalizeArgs(input, retryContext, outputFile) {
  if (input && typeof input === 'object' && !Array.isArray(input) && input.inputFile) return { results: readJson(path.resolve(__dirname, input.inputFile)), retryContext: input.previousAttempts || input.retryContext || null, outputPath: path.resolve(__dirname, input.outputFile || 'diagnosis-output.json') };
  if (input && typeof input === 'object' && !Array.isArray(input)) return { results: input, retryContext: retryContext || null, outputPath: path.resolve(__dirname, outputFile || 'diagnosis-output.json') };
  return { results: readJson(path.resolve(__dirname, input || process.argv[2] || 'results.json')), retryContext: retryContext || null, outputPath: path.resolve(__dirname, outputFile || process.argv[3] || 'diagnosis-output.json') };
}
function buildPrompt(results, retryContext) {
  const testCode = results.testCode || results.sourceCode || results.originalCode || '';
  if (!testCode.trim()) throw new Error('Baseline results contain no test source code.');
  const retry = retryContext ? `\nPrevious attempt context (avoid repeating its failed approach):\n${JSON.stringify(retryContext, null, 2)}` : '';
  const failureOutput = String(results.sampleFailure || 'No failure output was captured.').slice(0, 3000);
  return `Analyze the flaky Playwright test below. Preserve its intended behavior, URLs, selectors, imports, and test structure. Only change what is necessary to remove demonstrated flakiness. Do not invent application behavior, URLs, selectors, or endpoints.\n\nTEST:\n${testCode}\n\nFAILURE OUTPUT:\n${failureOutput}${retry}\n\nReturn only a JSON object with exactly this schema:\n{"cause":"SHORT_UPPERCASE_SNAKE_CASE_LABEL","explanation":"plain-language explanation","candidates":[{"fixedCode":"complete executable Playwright test code","rationale":"why it fixes the flake"},{"fixedCode":"complete executable Playwright test code","rationale":"why this distinct approach fixes the flake"}],"confidence":{"level":"low|medium|high","reason":"short reason"}}\nThere must be exactly two candidates. fixedCode must be complete code, not Markdown or a link.`;
}
function parseResponse(raw) { return JSON.parse(raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')); }
function validateDiagnosis(value, originalCode = '') {
  const valid = (item) => typeof item === 'string' && item.trim().length > 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return 'response is not an object';
  if (!valid(value.cause) || !valid(value.explanation)) return 'cause or explanation is missing';
  if (!Array.isArray(value.candidates) || value.candidates.length !== 2) return 'exactly two candidates are required';
  if (!value.candidates.every((candidate) => candidate && valid(candidate.fixedCode) && valid(candidate.rationale))) return 'a candidate is incomplete';
  if (value.candidates.some((candidate) => /\[[^\]]+\]\(https?:\/\//i.test(candidate.fixedCode) || /```/.test(candidate.fixedCode))) return 'candidate code contains Markdown';
  const urls = (text) => new Set((text.match(/https?:\/\/[^'"`\s)]+/g) || []));
  const originalUrls = urls(originalCode);
  for (const candidate of value.candidates) {
    for (const url of urls(candidate.fixedCode)) if (!originalUrls.has(url)) return `candidate invents URL ${url}`;
  }
  const paths = (text) => new Set(Array.from(text.matchAll(/['"](\/[A-Za-z0-9_./?=&%-]+)['"]/g), (match) => match[1]));
  const originalPaths = paths(originalCode);
  for (const candidate of value.candidates) {
    for (const endpoint of paths(candidate.fixedCode)) if (!originalPaths.has(endpoint)) return `candidate invents endpoint ${endpoint}`;
  }
  if (!value.confidence || !['low', 'medium', 'high'].includes(value.confidence.level) || !valid(value.confidence.reason)) return 'confidence is invalid';
  return null;
}
async function requestLock(port) {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 5000);
  try { const response = await fetch(`http://localhost:${port}/ai-lock`, { method: 'POST', signal: controller.signal }); return response.ok ? (await response.json()).token || null : null; }
  catch { return null; } finally { clearTimeout(timer); }
}
async function releaseLock(port, token) {
  if (!token) return;
  try { await fetch(`http://localhost:${port}/ai-unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }); } catch { /* server is optional */ }
}
async function diagnose(input, retryContext, outputFile) {
  const { results, retryContext: context, outputPath } = normalizeArgs(input, retryContext, outputFile);
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not set in the environment or .env file.');
  const prompt = buildPrompt(results, context), attempts = configNumber('GROQ_MAX_RETRIES', 2) + 1, baseDelay = configNumber('GROQ_RETRY_BASE_MS', 2000), timeoutMs = configNumber('GROQ_TIMEOUT_MS', 45000), port = process.env.PORT || 4000;
  let lastError = 'Groq did not return a valid diagnosis.';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const token = await requestLock(port), controller = new AbortController(), timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      console.log(`[diagnose] Groq request ${attempt}/${attempts}...`);
      const response = await fetch(GROQ_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.GROQ_MODEL || DEFAULT_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.2, max_completion_tokens: 2500, response_format: { type: 'json_object' } }), signal: controller.signal });
      console.log(`[diagnose] Groq response status: ${response.status}`);
      if (response.ok) {
        const raw = (await response.json()).choices?.[0]?.message?.content;
        if (!raw) throw new Error('Groq returned no message content.');
        const diagnosis = parseResponse(raw), invalid = validateDiagnosis(diagnosis, results.testCode || results.sourceCode || results.originalCode || '');
        if (invalid) throw new Error(`Groq returned an invalid diagnosis: ${invalid}.`);
        writeJsonAtomically(outputPath, diagnosis); console.log(`[diagnose] Diagnosis saved to ${path.basename(outputPath)}`); return diagnosis;
      }
      lastError = `Groq returned HTTP ${response.status}: ${(await response.text()).slice(0, 1000)}`;
      if (![429, 500, 502, 503, 504].includes(response.status)) break;
    } catch (error) { lastError = error.name === 'AbortError' ? `Groq request timed out after ${timeoutMs}ms.` : error.message; }
    finally { clearTimeout(timer); await releaseLock(port, token); }
    if (attempt < attempts) { const wait = baseDelay * (2 ** (attempt - 1)); console.warn(`[diagnose] ${lastError} Retrying in ${wait}ms.`); await new Promise((resolve) => setTimeout(resolve, wait)); }
  }
  throw new Error(`Diagnosis failed without writing an output file: ${lastError}`);
}
module.exports = { diagnose, validateDiagnosis };
if (require.main === module) diagnose().catch((error) => { console.error(`Diagnosis failed: ${error.message}`); process.exitCode = 1; });
