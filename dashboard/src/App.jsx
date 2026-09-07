import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [data, setData] = useState(null);
  const [liveRun, setLiveRun] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedName, setUploadedName] = useState(null);

  useEffect(() => {
    const eventSource = new EventSource('http://localhost:4000/stream');
    eventSource.onmessage = (event) => setLiveRun(JSON.parse(event.data));
    eventSource.onerror = () => { };
    return () => eventSource.close();
  }, []);

  async function handleFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);

    const formData = new FormData();
    formData.append('testFile', file);
    setStatus('Uploading…');
    await fetch('http://localhost:4000/upload-test', { method: 'POST', body: formData });
    setUploadedName(file.name);
    setStatus('');
    setData(null);
    setLiveRun(null);
  }

  function phaseLabel(phase) {
    switch (phase) {
      case 'before': return 'establishing baseline';
      case 'candidate-1': return 'testing candidate fix 1';
      case 'candidate-2': return 'testing candidate fix 2';
      case 'after': return 'verifying winning fix';
      default: return 'running tests';
    }
  }

  async function runFullPipeline() {
    setLoading(true);
    setLiveRun(null);
    setStatus('Court is in session — this may take a few minutes and retry automatically…');

    try {
      const response = await fetch('http://localhost:4000/run-verify-loop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ testFile: 'uploaded.test.js' }),
      });

      if (!response.ok) {
        throw new Error('The verification run failed.');
      }

      const result = await fetch('http://localhost:4000/latest-results').then((r) => r.json());
      setData(result);
      setStatus('');
    } catch (err) {
      setStatus('Something went wrong — check the backend terminal for details.');
    } finally {
      setLoading(false);
    }
  }

  function downloadFixed() {
    window.location.href = 'http://localhost:4000/download-fixed';
  }

  return (
    <div className="page">
      <header className="hero">
        <p className="eyebrow">// flaky-court</p>
        <h1>Put your test on trial.</h1>
        <p className="subtitle">
          Upload a test that fails sometimes. We'll measure exactly
          how often, find out why, fix it, and prove the fix holds.
        </p>
      </header>

      <section className="panel">
        <div className="panel-bar">
          <span className="panel-dot red" aria-hidden="true"></span>
          <span className="panel-dot yellow" aria-hidden="true"></span>
          <span className="panel-dot green" aria-hidden="true"></span>
          <span className="panel-label">courtroom.js</span>
        </div>
        <div className="panel-body">
          <label className="dropzone" htmlFor="file-input">
            <input id="file-input" type="file" accept=".js" onChange={handleFilePicked} className="visually-hidden" />
            {uploadedName ? (
              <span className="dropzone-filled">{uploadedName}</span>
            ) : (
              <span className="dropzone-empty">choose a test file to begin</span>
            )}
          </label>

          <div className="button-row">
            <button className="run-button" onClick={runFullPipeline} disabled={!uploadedName || loading}>
              {loading ? 'Court is in session…' : 'Run the trial'}
            </button>
            <button
              className="secondary-button"
              onClick={() => { setData(null); setLiveRun(null); setUploadedName(null); setStatus(''); }}
              disabled={loading}
            >
              Reset
            </button>
          </div>

          {status && <p className="status-line" role="status" aria-live="polite">{status}</p>}
        </div>
      </section>

      {liveRun && loading && (
        <section className="grid-block live">
          <div className="grid-header">
            <h3>live — {phaseLabel(liveRun.phase)} — run {liveRun.currentRun} of {liveRun.totalRuns}</h3>
            <span className="grid-count">
              {liveRun.runResults.filter(r => r).length} pass / {liveRun.runResults.filter(r => !r).length} fail
            </span>
          </div>
          <div className="dots">
            {liveRun.runResults.map((result, i) => (
              <span
                key={i}
                className={`dot ${result ? 'pass' : 'fail'}${i === liveRun.runResults.length - 1 ? ' enter' : ''}`}
              >
                <span className="visually-hidden">{result ? 'pass' : 'fail'}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {data && (
        <>
          <section className="stats-row">
            <div className="stat-card before">
              <h2>before</h2>
              <p className="flake-rate">{(data.flakeRateBefore * 100).toFixed(0)}%</p>
              <p className="stat-detail">{data.failuresBefore} of {data.totalRunsBefore} runs failed</p>
            </div>
            <div className="stat-card after">
              <h2>after</h2>
              <p className="flake-rate">{(data.flakeRateAfter * 100).toFixed(0)}%</p>
              <p className="stat-detail">{data.failuresAfter} of {data.totalRunsAfter} runs failed</p>
            </div>
          </section>

          {data.flakeRateAfter === 0 && (
            <p className="verdict">✓ verified — 0% flake rate across {data.totalRunsAfter} independent runs</p>
          )}

          <section className="diagnosis">
            <p className="diagnosis-cause">{data.diagnosis.cause.replace(/_/g, ' ').toLowerCase()}</p>
            <p>{data.diagnosis.explanation}</p>
          </section>

          <section className="grid-block">
            <div className="grid-header">
              <h3>the 50 runs that proved it</h3>
              <span className="grid-count">
                {data.runResults.filter(r => r).length} pass / {data.runResults.filter(r => !r).length} fail
              </span>
            </div>
            <div className="dots">
              {data.runResults.map((result, i) => (
                <span key={i} className={`dot ${result ? 'pass' : 'fail'}`}>
                  <span className="visually-hidden">{result ? 'pass' : 'fail'}</span>
                </span>
              ))}
            </div>
          </section>

          <div className="download-row">
            {data.flakeRateAfter === 0 && (
              <button className="run-button" onClick={downloadFixed}>Download fixed test</button>
            )}
            <button
              className="secondary-button"
              onClick={() => navigator.clipboard.writeText(JSON.stringify(data, null, 2))}
            >
              Copy raw JSON
            </button>
          </div>

          <section className="code-diff">
            <div className="code-block">
              <div className="code-block-bar">
                <h4>before.test.js</h4>
                <button className="copy-button" onClick={() => navigator.clipboard.writeText(data.originalCode)}>copy</button>
              </div>
              <pre>{data.originalCode}</pre>
            </div>
            <div className="code-block">
              <div className="code-block-bar">
                <h4>after.test.js</h4>
                <button className="copy-button" onClick={() => navigator.clipboard.writeText(data.fixedCode)}>copy</button>
              </div>
              <pre>{data.fixedCode}</pre>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default App;