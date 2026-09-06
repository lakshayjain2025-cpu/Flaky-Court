require('dotenv').config();
const fs = require('fs');
const path = require('path');

async function diagnose() {
  const resultsPath = path.join(__dirname, 'results.json');
  if (!fs.existsSync(resultsPath)) {
    console.error('Error: results.json not found. Run stress-test.js first.');
    process.exit(1);
  }

  const results = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
  const testCode = results.testCode || results.sourceCode;
  const sampleFailure = results.sampleFailure;

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY not found in environment or .env');
    console.error('Please create a .env file with GEMINI_API_KEY=your_api_key');
    process.exit(1);
  }

  const prompt = `Analyze this flaky Playwright test and its failure output:

Flaky Test Code:
${testCode}

Sample Failure Output:
${sampleFailure}

Respond with ONLY raw JSON (no markdown fences, no formatting like \`\`\`json, no preamble or extra text) containing exactly these keys:
- "cause": a short uppercase snake_case label (e.g. "RACE_CONDITION")
- "explanation": a plain-language reason for the flakiness
- "fixedCode": a corrected version of the test assertion using Playwright's auto-retrying web-first assertions (e.g. expect(locator).toHaveText(...)) instead of an immediate textContent check
`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }],
        },
      ],
      generationConfig: {
        responseMimeType: 'application/json',
      },
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`API error (${response.status}):`, errText);
    process.exit(1);
  }

  const data = await response.json();
  const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!rawText) {
    console.error('Unexpected response format:', JSON.stringify(data, null, 2));
    process.exit(1);
  }

  // Parse defensively — strip ```json / ``` fences if present or extract JSON substring
  let cleaned = rawText.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenceMatch) {
    cleaned = fenceMatch[1].trim();
  } else if (cleaned.includes('{') && cleaned.includes('}')) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    cleaned = cleaned.slice(start, end + 1);
  }

  const diagnosis = JSON.parse(cleaned);
  console.log(diagnosis);
  return diagnosis;
}

module.exports = { diagnose };

if (require.main === module) {
  diagnose().catch((err) => {
    console.error('Diagnosis failed:', err);
    process.exit(1);
  });
}

