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
    eventSource.onerror = () => {};
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

    async function runFullPipeline() {
    setLoading(true);
    setLiveRun(null);

    setStatus('Stress-testing your file — 50 runs…');
    await fetch('http://localhost:4000/run-stress-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testFile: 'uploaded-test.js', outputFile: 'before-results.json', phase: 'before' }),
    });

    setStatus('Diagnosing the failure with AI…');
    await fetch('http://localhost:4000/run-diagnose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inputFile: 'before-results.json', outputFile: 'diagnosis-output.json' }),
    });

    setStatus('Writing the AI-generated fix…');
    await fetch('http://localhost:4000/apply-fix', { method: 'POST' });

    setStatus('Verifying the fix — 50 more runs…');
    await fetch('http://localhost:4000/run-stress-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ testFile: 'fixed.test.js', outputFile: 'after-results.json', phase: 'after' }),
    });

    setStatus('Finalizing the verdict…');
    await fetch('http://localhost:4000/run-finalize', { method: 'POST' });

    const result = await fetch('http://localhost:4000/latest-results').then((r) => r.json());
    setData(result);
    setStatus('');
    setLoading(false);
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
          <span className="panel-dot red"></span>
          <span className="panel-dot yellow"></span>
          <span className="panel-dot green"></span>
          <span className="panel-label">courtroom.js</span>
        </div>
        <div className="panel-body">
          <label className="dropzone" htmlFor="file-input">
            <input id="file-input" type="file" accept=".js" onChange={handleFilePicked} hidden />
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

          {status && <p className="status-line">{status}</p>}
        </div>
      </section>

      {liveRun && (
        <section className="grid-block live">
          <div className="grid-header">
                  <h4>live — {liveRun.phase === 'after' ? 'verifying fix' : 'testing original'} — run {liveRun.currentRun} of {liveRun.totalRuns}</h4>
            <span className="grid-count">
              {liveRun.runResults.filter(r => r).length} pass / {liveRun.runResults.filter(r => !r).length} fail
            </span>
          </div>
          <div className="dots">
            {liveRun.runResults.map((result, i) => (
              <span key={i} className={`dot ${result ? 'pass' : 'fail'}`} style={{ animationDelay: `${i * 12}ms` }} />
            ))}
          </div>
        </section>
      )}

      {data && (
        <>
          <section className="stats-row">
            <div className="stat-card before">
              <h3>before</h3>
              <p className="flake-rate">{(data.flakeRateBefore * 100).toFixed(0)}%</p>
              <p className="stat-detail">{data.failuresBefore} of {data.totalRunsBefore} runs failed</p>
            </div>
            <div className="stat-card after">
              <h3>after</h3>
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
              <h4>the 50 runs that proved it</h4>
              <span className="grid-count">
                {data.runResults.filter(r => r).length} pass / {data.runResults.filter(r => !r).length} fail
              </span>
            </div>
            <div className="dots">
              {data.runResults.map((result, i) => (
                <span key={i} className={`dot ${result ? 'pass' : 'fail'}`} />
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