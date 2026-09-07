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

module.exports = { sendUpdate };
