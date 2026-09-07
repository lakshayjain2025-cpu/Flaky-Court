require('dotenv').config();
async function testGroq() {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error('GROQ_API_KEY is not configured.');
  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model: process.env.GROQ_MODEL || 'openai/gpt-oss-120b', messages: [{ role: 'user', content: 'Reply with exactly: hello' }], max_completion_tokens: 16 }) });
  console.log(`Status: ${response.status}`);
  if (!response.ok) throw new Error((await response.text()).slice(0, 1000));
  console.log('Groq API connection verified.');
}
testGroq().catch((error) => { console.error(`Groq check failed: ${error.message}`); process.exitCode = 1; });
