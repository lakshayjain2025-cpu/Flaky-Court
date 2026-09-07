require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function diagnose(baselineInput, retryContext, outputFileArg) {
  let results;
  if (baselineInput && typeof baselineInput === 'object') {
    results = baselineInput;
  } else {
    const inputFile = (typeof baselineInput === 'string' && baselineInput) || process.argv[2] || 'results.json';
    const resultsPath = path.join(__dirname, inputFile);
    if (!fs.existsSync(resultsPath)) {
      console.error(`Error: ${inputFile} not found. Run stress-test.js first.`);
      process.exit(1);
    }
    results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  }

  let testCode = results.testCode || results.sourceCode || results.originalCode;
  if (!testCode && results.targetTest && fs.existsSync(path.join(__dirname, results.targetTest))) {
    testCode = fs.readFileSync(path.join(__dirname, results.targetTest), 'utf8');
  }
  const sampleFailure = results.sampleFailure;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY not found in environment or .env');
    console.error('Please create a .env file with GEMINI_API_KEY=your_api_key');
    process.exit(1);
  }

  let prompt = `Analyze this flaky Playwright test and its failure output:

Flaky Test Code:
${testCode}

Sample Failure Output:
${sampleFailure}
`;

  if (retryContext) {
    prompt += `\nPrevious Attempt Context (Self-Correction Retry):\n`;
    if (typeof retryContext === 'string') {
      prompt += `${retryContext}\n`;
    } else {
      if (retryContext.previousWinnerCandidate) {
        prompt += `Previous Winner: Candidate ${retryContext.previousWinnerCandidate}\n`;
      }
      if (retryContext.previousFixedCode) {
        prompt += `Previous Fix Attempted:\n${retryContext.previousFixedCode}\n\n`;
      }
      if (retryContext.newFailureOutput) {
        prompt += `New Failure Output After Applying Previous Fix in Confirmation Test:\n${retryContext.newFailureOutput}\n\n`;
      }
      if (retryContext.note) {
        prompt += `Note / Guidance:\n${retryContext.note}\n\n`;
      }
    }
  }

  prompt += `
Respond with ONLY raw JSON (no markdown fences, no formatting like \`\`\`json, no preamble or extra text) containing exactly these keys:
- "cause": a short uppercase snake_case label (e.g. "RACE_CONDITION")
- "explanation": a plain-language reason for the flakiness
- "candidates": an array of EXACTLY 2 candidate fix objects. Each object MUST contain:
  - "fixedCode": the complete, corrected test code ready to execute, using a genuinely different approach (e.g. one using web-first auto-retrying assertions, another using an alternative locator/wait or event-driven strategy)
  - "rationale": a plain-language explanation of why and how this specific candidate approach resolves the flakiness
- "confidence": an object with exactly two keys:
  - "level": one of exactly "low", "medium", or "high" (lowercase, no other values) — how confident you are these candidates will actually eliminate the flakiness, based on how directly the sample failure output supports the diagnosed cause
  - "reason": one short sentence explaining that confidence level
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

  const maxRetries = 5;
  const validLevels = ['low', 'medium', 'high'];
  let diagnosis = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    console.log(`[diagnose] Sending request to Gemini (attempt ${attempt}/${maxRetries})...`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err.name === 'AbortError') {
        console.warn(`[diagnose] Request timed out after 30s (attempt ${attempt}/${maxRetries}).`);
        continue;
      }
      throw err;
    }
    clearTimeout(timeoutId);
    console.log(`[diagnose] Response received — status ${response.status}`);

    if (!response.ok) {
      if (response.status === 503 || response.status === 429) {
        const waitMs = attempt * 2000;
        console.warn(`Gemini API busy (${response.status}). Retrying in ${waitMs / 1000}s...`);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      const errText = await response.text();
      console.error(`API error (${response.status}):`, errText);
      process.exit(1);
    }

    const data = await response.json();
    const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawText) {
      console.warn('[diagnose] Empty response body from Gemini, retrying...');
      continue;
    }

    let cleaned = rawText.trim();
    const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenceMatch) {
      cleaned = fenceMatch[1].trim();
    } else if (cleaned.includes('{') && cleaned.includes('}')) {
      const start = cleaned.indexOf('{');
      const end = cleaned.lastIndexOf('}');
      cleaned = cleaned.slice(start, end + 1);
    }

    let parsed;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      console.warn(`[diagnose] Response was not valid JSON, retrying... (${err.message})`);
      continue;
    }

    const hasValidCandidates = Array.isArray(parsed.candidates) && parsed.candidates.length >= 2
      && parsed.candidates.every(c => typeof c.fixedCode === 'string' && typeof c.rationale === 'string');
    const hasValidConfidence = parsed.confidence
      && validLevels.includes(parsed.confidence.level)
      && typeof parsed.confidence.reason === 'string';

    if (!hasValidCandidates || !hasValidConfidence) {
      console.warn(`[diagnose] Response missing required fields (candidates valid: ${hasValidCandidates}, confidence valid: ${hasValidConfidence}), retrying...`);
      continue;
    }

    diagnosis = parsed;
    break;
  }

  if (!diagnosis) {
    console.error(`[diagnose] Gemini failed to return a valid, complete diagnosis after ${maxRetries} attempts.`);
    console.error('Not writing a fabricated result — check the API key/model/prompt instead of retrying blindly.');
    process.exit(1);
  }

  console.log(diagnosis);

  // Explicit outputFileArg (used when called as a function from verify-loop.js)
  // takes priority over CLI argv, which is only relevant when run directly.
  const outputFile = outputFileArg || process.argv[3] || 'diagnosis-output.json';
  fs.writeFileSync(
    path.join(__dirname, outputFile),
    JSON.stringify(diagnosis, null, 2),
    'utf8'
  );
  console.log(`Diagnosis saved to ${outputFile}`);

  return diagnosis;
}

module.exports = { diagnose };

if (require.main === module) {
  diagnose().catch((err) => {
    console.error('Diagnosis failed:', err);
    process.exit(1);
  });
}