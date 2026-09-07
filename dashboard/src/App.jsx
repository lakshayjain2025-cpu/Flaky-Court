import React, { useState, useEffect, useRef } from 'react';
import './App.css';

function App() {
  const [data, setData] = useState(null);
  const [liveRun, setLiveRun] = useState(null);
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadedName, setUploadedName] = useState(null);
  const [uploadedTestFile, setUploadedTestFile] = useState(null);
  const activeRunId = useRef(null);
  const activeScanId = useRef(null);
  const statusPoll = useRef(null);

  const [isRepoMode, setIsRepoMode] = useState(false);
  const [repoExtractedPath, setRepoExtractedPath] = useState('');
  const [repoFiles, setRepoFiles] = useState([]);
  const [repoResults, setRepoResults] = useState([]);
  const [repoErrors, setRepoErrors] = useState([]);
  const [repoScanComplete, setRepoScanComplete] = useState(false);
  const [expandedRepoRow, setExpandedRepoRow] = useState(null);

  useEffect(() => {
    const eventSource = new EventSource('/stream');
    eventSource.onmessage = (event) => {
      const payload = JSON.parse(event.data);

      if (payload.type === 'repo-scan-start') {
        setRepoFiles(payload.testFiles);
        setStatus(`Scanning ${payload.totalFiles} test files...`);
      } else if (payload.type === 'repo-scan-progress') {
        if (payload.status === 'success') {
          setRepoResults(prev => {
            if (prev.find(r => r.file === payload.file)) return prev;
            return [...prev, { ...payload.result, file: payload.file }];
          });
        } else {
          setRepoErrors(prev => {
            if (prev.find(e => e.file === payload.file)) return prev;
            return [...prev, { file: payload.file, error: payload.error }];
          });
        }
      } else if (payload.type === 'repo-scan-complete') {
        finishRepoScan(payload.summary);
      } else if (payload.type === 'repo-scan-error') {
        setStatus(`Scan error: ${payload.error}`);
        setLoading(false);
        stopStatusPolling();
      } else if (payload.type === 'verify-loop-complete' && payload.runId === activeRunId.current) {
        // single-file mode done — fetch results and unblock
        finishSingleRun();
      } else if (payload.type === 'verify-loop-error' && payload.runId === activeRunId.current) {
        setStatus(`Run failed: ${payload.error}`);
        setLoading(false);
        stopStatusPolling();
      } else if (payload.phase) {
        setLiveRun(payload);
      }
    };
    eventSource.onerror = () => { };
    return () => eventSource.close();
  }, []);

  function stopStatusPolling() {
    if (statusPoll.current) {
      window.clearInterval(statusPoll.current);
      statusPoll.current = null;
    }
  }

  async function finishSingleRun() {
    stopStatusPolling();
    try {
      const response = await fetch('/latest-results');
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setData(await response.json());
      setStatus('');
    } catch {
      setStatus('Run finished but could not load results.');
    } finally {
      setLoading(false);
      activeRunId.current = null;
    }
  }

  function startStatusPolling(runId) {
    stopStatusPolling();
    const checkStatus = async () => {
      try {
        const response = await fetch(`/verify-loop-status/${runId}`);
        if (!response.ok) return;
        const run = await response.json();
        if (run.status === 'complete') return finishSingleRun();
        if (run.status === 'error') {
          stopStatusPolling();
          activeRunId.current = null;
          setStatus(`Run failed: ${run.error}`);
          setLoading(false);
        }
      } catch {
        // The server may be briefly restarting; the next poll will recover.
      }
    };
    checkStatus();
    statusPoll.current = window.setInterval(checkStatus, 2000);
  }

  function applyRepoSummary(summary) {
    setRepoResults((summary.results || []).map(result => ({
      ...result,
      file: result.filePath.split(/[\\/]/).pop(),
    })));
    setRepoErrors((summary.errors || []).map(error => ({
      ...error,
      file: error.filePath.split(/[\\/]/).pop(),
    })));
  }

  async function finishRepoScan(summary) {
    stopStatusPolling();
    try {
      const completedSummary = summary || await fetch('/latest-repo-results').then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      });
      applyRepoSummary(completedSummary);
      setRepoScanComplete(true);
      setStatus('Scan complete.');
    } catch {
      setStatus('Scan finished but could not load its results.');
    } finally {
      setLoading(false);
      activeScanId.current = null;
    }
  }

  function startRepoStatusPolling(scanId) {
    stopStatusPolling();
    const checkStatus = async () => {
      try {
        const response = await fetch(`/repo-scan-status/${scanId}`);
        if (!response.ok) return;
        const scan = await response.json();
        if (scan.status === 'complete') return finishRepoScan();
        if (scan.status === 'error') {
          stopStatusPolling();
          activeScanId.current = null;
          setStatus(`Scan error: ${scan.error}`);
          setLoading(false);
        }
      } catch {
        // The next poll will retry if the local server is briefly unavailable.
      }
    };
    checkStatus();
    statusPoll.current = window.setInterval(checkStatus, 2000);
  }

  async function handleFilePicked(e) {
    const file = e.target.files[0];
    if (!file) return;
    setSelectedFile(file);
    setUploadedName(file.name);
    setStatus('Uploading…');
    setData(null);
    setLiveRun(null);
    setRepoFiles([]);
    setRepoResults([]);
    setRepoErrors([]);
    setRepoScanComplete(false);
    setExpandedRepoRow(null);

    const formData = new FormData();
    if (file.name.toLowerCase().endsWith('.zip')) {
      setIsRepoMode(true);
      setUploadedTestFile(null);
      formData.append('repoZip', file);
      const res = await fetch('/upload-zip', { method: 'POST', body: formData });
      const json = await res.json();
      if (json.success) {
        setRepoExtractedPath(json.extractedPath);
        setStatus('');
      } else {
        setStatus('Upload failed: ' + json.error);
      }
    } else {
      setIsRepoMode(false);
      formData.append('testFile', file);
      const res = await fetch('/upload-test', { method: 'POST', body: formData });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Upload failed');
      setUploadedTestFile(json.filename);
      setStatus('');
    }
  }

  function phaseLabel(phase) {
    if (phase.includes('before')) return 'establishing baseline';
    if (phase.includes('candidate-1')) return 'testing candidate fix 1';
    if (phase.includes('candidate-2')) return 'testing candidate fix 2';
    if (phase.includes('after')) return 'verifying winning fix';
    return 'running tests';
  }

  async function runFullPipeline() {
    setLoading(true);
    setLiveRun(null);
    setData(null);

    if (isRepoMode) {
      setStatus('Starting repo scan...');
      try {
        const response = await fetch('/run-repo-scan', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ targetDir: repoExtractedPath }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
        activeScanId.current = json.scanId;
        startRepoStatusPolling(json.scanId);
      } catch (err) {
        setStatus(`Failed to start scan: ${err.message}`);
        setLoading(false);
      }
    } else {
      setStatus('Court is in session — this may take a few minutes...');
      try {
        const response = await fetch('/run-verify-loop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ testFile: uploadedTestFile }),
        });
        const json = await response.json();
        if (!response.ok) throw new Error(json.error || `HTTP ${response.status}`);
        activeRunId.current = json.runId;
        startStatusPolling(json.runId);
      } catch (err) {
        setStatus(`Failed to start: ${err.message}`);
        setLoading(false);
      }
    }
  }

  function downloadFixed() {
    window.location.href = '/download-fixed';
  }

  function renderDetailView(testData) {
    if (!testData) return null;
    return (
      <div className="detail-view">
        <section className="stats-row">
          <div className="stat-card before">
            <h2>before</h2>
            <p className="flake-rate">{(testData.flakeRateBefore * 100).toFixed(0)}%</p>
            <p className="stat-detail">{testData.failuresBefore} of {testData.totalRunsBefore} runs failed</p>
          </div>
          <div className="stat-card after">
            <h2>after</h2>
            <p className="flake-rate">{(testData.flakeRateAfter * 100).toFixed(0)}%</p>
            <p className="stat-detail">{testData.failuresAfter} of {testData.totalRunsAfter} runs failed</p>
          </div>
        </section>

        {testData.flakeRateAfter === 0 && (
          <p className="verdict">✓ verified — 0% flake rate across {testData.totalRunsAfter} independent runs</p>
        )}

        {testData.diagnosis && (
          <section className="diagnosis">
            <p className="diagnosis-cause">{testData.diagnosis.cause.replace(/_/g, ' ').toLowerCase()}</p>
            <p>{testData.diagnosis.explanation}</p>
          </section>
        )}

        {testData.runResults && (
          <section className="grid-block">
            <div className="grid-header">
              <h3>the {testData.totalRunsBefore} baseline runs</h3>
              <span className="grid-count">
                {testData.runResults.filter(r => r).length} pass / {testData.runResults.filter(r => !r).length} fail
              </span>
            </div>
            <div className="dots">
              {testData.runResults.map((result, i) => (
                <span key={i} className={`dot ${result ? 'pass' : 'fail'}`}>
                  <span className="visually-hidden">{result ? 'pass' : 'fail'}</span>
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="code-diff">
          <div className="code-block">
            <div className="code-block-bar">
              <h4>before.test.js</h4>
              <button className="copy-button" onClick={() => navigator.clipboard.writeText(testData.originalCode)}>copy</button>
            </div>
            <pre>{testData.originalCode}</pre>
          </div>
          <div className="code-block">
            <div className="code-block-bar">
              <h4>after.test.js</h4>
              <button className="copy-button" onClick={() => navigator.clipboard.writeText(testData.fixedCode)}>copy</button>
            </div>
            <pre>{testData.fixedCode}</pre>
          </div>
        </section>
      </div>
    );
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
            <input id="file-input" type="file" accept=".js,.zip" onChange={handleFilePicked} className="visually-hidden" />
            {uploadedName ? (
              <span className="dropzone-filled">{uploadedName}</span>
            ) : (
              <span className="dropzone-empty">choose a .js or .zip file to begin</span>
            )}
          </label>

          <div className="button-row">
            <button className="run-button" onClick={runFullPipeline} disabled={!uploadedName || loading}>
              {loading ? 'Court is in session…' : 'Run the trial'}
            </button>
            <button
              className="secondary-button"
              onClick={() => { setData(null); setLiveRun(null); setUploadedName(null); setUploadedTestFile(null); setStatus(''); setRepoFiles([]); setIsRepoMode(false); }}
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
                className={`dot ${result ? 'pass' : 'fail'}`}
              >
                <span className="visually-hidden">{result ? 'pass' : 'fail'}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {!isRepoMode && data && (
        <>
          {renderDetailView(data)}
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
        </>
      )}

      {isRepoMode && repoFiles.length > 0 && (
        <section className="repo-results">
          <div className="grid-header">
            <h3>Discovered Test Files ({repoFiles.length})</h3>
          </div>
          <table className="repo-table">
            <thead>
              <tr>
                <th>File</th>
                <th>Status</th>
                <th>Before</th>
                <th>After</th>
                <th>Cause</th>
                <th>Confidence</th>
                <th>Iterations</th>
              </tr>
            </thead>
            <tbody>
              {repoFiles.map((file, idx) => {
                const result = repoResults.find(r => r.file === file);
                const error = repoErrors.find(e => e.file === file);
                const isFinished = !!result || !!error;
                const isExpanded = expandedRepoRow === file;
                
                return (
                  <React.Fragment key={idx}>
                    <tr onClick={() => result && setExpandedRepoRow(isExpanded ? null : file)} className={result ? 'clickable' : ''}>
                      <td>{file}</td>
                      <td>
                        {!isFinished ? (loading ? 'Running...' : 'Pending') : (
                          error ? 'Failed' : 'Success'
                        )}
                      </td>
                      <td>{result ? `${(result.flakeRateBefore * 100).toFixed(0)}%` : '-'}</td>
                      <td>{result ? `${(result.flakeRateAfter * 100).toFixed(0)}%` : '-'}</td>
                      <td>{result && result.diagnosis ? result.diagnosis.cause : '-'}</td>
                      <td>{result && result.confidence ? result.confidence.level : '-'}</td>
                      <td>{result ? result.iterations : '-'}</td>
                    </tr>
                    {isExpanded && result && (
                      <tr className="expanded-row">
                        <td colSpan="7">
                          <div style={{ marginTop: '16px' }}>
                            {renderDetailView(result)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}

export default App;
