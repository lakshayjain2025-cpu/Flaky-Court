import React, { useEffect, useRef, useState } from 'react';
import './App.css';

// Local Vite development continues to call the Express server on port 4000.
// A production build served by Express calls the API on its own origin instead.
const API = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:4000' : window.location.origin);
const pct = value => typeof value === 'number' ? `${Math.round(value * 100)}%` : '—';

function Icon({ name, size = 18 }) {
  const shapes = {
    spark: <path d="m12 2 1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8L12 2Z" />,
    upload: <><path d="M12 16V3M7 8l5-5 5 5M5 14v5a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-5" /></>,
    play: <path d="m8 5 10 7-10 7V5Z" fill="currentColor" stroke="none" />,
    refresh: <><path d="M20 11a8 8 0 1 0 2 5.5M20 4v7h-7" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M5 21h14" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>,
    check: <path d="m5 12 4.2 4.2L19 6.5" />,
    file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z" /><path d="M14 2v6h6" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{shapes[name]}</svg>;
}

function Dots({ results = [] }) { return <div className="result-dots" aria-label={`${results.filter(Boolean).length} passed, ${results.filter(v => !v).length} failed`}>{results.map((result, i) => <span key={i} className={`result-dot ${result ? 'pass' : 'fail'}`}><span className="visually-hidden">{result ? 'Pass' : 'Fail'}</span></span>)}</div>; }
function Badge({ status }) { const label = status === 'fixed' ? 'Fixed' : status === 'stable' ? 'Stable' : status === 'unverified' ? 'Needs review' : status || 'Pending'; const tone = ['fixed', 'stable'].includes(status) ? 'success' : ['unverified', 'Failed'].includes(status) ? 'danger' : 'neutral'; return <span className={`badge ${tone}`}>{label}</span>; }
function CodePanel({ title, code, copy }) { return <article className="code-panel"><header><span>{title}</span><button onClick={() => copy(code)} disabled={!code}><Icon name="copy" size={14} /> Copy</button></header><pre>{code || 'No code is available for this result.'}</pre></article>; }
function DetailView({ data, copy }) {
  if (!data) return null;
  const verified = data.flakeRateAfter === 0;
  return <div className="detail-view">
    <div className="metrics"><article className="metric before"><span>Flake rate before</span><strong>{pct(data.flakeRateBefore)}</strong><small>{data.failuresBefore ?? 0} failures across {data.totalRunsBefore ?? 0} runs</small></article><article className="metric after"><span>Flake rate after</span><strong>{pct(data.flakeRateAfter)}</strong><small>{data.failuresAfter ?? 0} failures across {data.totalRunsAfter ?? 0} runs</small></article><article className="metric"><span>Verdict</span><strong className="word">{verified ? 'Verified' : data.status === 'stable' ? 'Stable' : 'Review'}</strong><small>{data.iterations ?? 0} diagnostic iteration{data.iterations === 1 ? '' : 's'}</small></article></div>
    {verified && <p className="success-note"><Icon name="check" size={16} /> Fix confirmed across {data.totalRunsAfter} independent runs.</p>}
    {data.diagnosis && <section className="diagnosis"><div><span className="kicker">Diagnosis</span><h3>{data.diagnosis.cause.replace(/_/g, ' ').toLowerCase()}</h3></div><p>{data.diagnosis.explanation}</p></section>}
    {data.runResults && <section className="runs"><div className="section-heading"><div><span className="kicker">Evidence</span><h3>Baseline run history</h3></div><span>{data.runResults.filter(Boolean).length} pass · {data.runResults.filter(v => !v).length} fail</span></div><Dots results={data.runResults} /></section>}
    <section className="code-grid"><CodePanel title="Original test" code={data.originalCode} copy={copy} /><CodePanel title="Recommended fix" code={data.fixedCode} copy={copy} /></section>
  </div>;
}

export default function App() {
  const [data, setData] = useState(null), [live, setLive] = useState(null), [status, setStatus] = useState(''), [loading, setLoading] = useState(false), [name, setName] = useState(null), [testFile, setTestFile] = useState(null), [repoMode, setRepoMode] = useState(false), [repoPath, setRepoPath] = useState(''), [repoFiles, setRepoFiles] = useState([]), [repoResults, setRepoResults] = useState([]), [repoErrors, setRepoErrors] = useState([]), [expanded, setExpanded] = useState(null);
  const runId = useRef(null), scanId = useRef(null), poll = useRef(null);
  const stopPolling = () => { if (poll.current) { clearInterval(poll.current); poll.current = null; } };
  const finishError = message => { stopPolling(); runId.current = null; scanId.current = null; setStatus(message); setLoading(false); };
  const responseJson = async response => { const body = await response.json(); if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`); return body; };
  const copy = value => { if (value) navigator.clipboard?.writeText(value).then(() => setStatus('Copied to clipboard.')).catch(() => setStatus('Could not copy to clipboard.')); };

  const applySummary = summary => { setRepoResults((summary.results || []).map(r => ({ ...r, file: r.filePath.split(/[\\/]/).pop() }))); setRepoErrors((summary.errors || []).map(e => ({ ...e, file: e.filePath.split(/[\\/]/).pop() }))); };
  const finishSingle = async () => { stopPolling(); try { setData(await responseJson(await fetch(`${API}/latest-results`))); setStatus('Trial complete.'); } catch { setStatus('The trial finished, but results could not be loaded.'); } finally { setLoading(false); runId.current = null; } };
  const finishScan = async summary => { stopPolling(); try { applySummary(summary || await responseJson(await fetch(`${API}/latest-repo-results`))); setStatus('Repository scan complete.'); } catch { setStatus('The scan finished, but results could not be loaded.'); } finally { setLoading(false); scanId.current = null; } };

  useEffect(() => {
    const stream = new EventSource(`${API}/stream`);
    stream.onmessage = event => { let p; try { p = JSON.parse(event.data); } catch { return; } if (p.type === 'repo-scan-start') { setRepoFiles(p.testFiles || []); setStatus(`Scanning ${p.totalFiles} test files…`); } else if (p.type === 'repo-scan-progress') { if (p.status === 'success') setRepoResults(old => old.some(x => x.file === p.file) ? old : [...old, { ...p.result, file: p.file }]); else setRepoErrors(old => old.some(x => x.file === p.file) ? old : [...old, { file: p.file, error: p.error }]); } else if (p.type === 'repo-scan-complete') finishScan(p.summary); else if (p.type === 'repo-scan-error') finishError(`Scan error: ${p.error}`); else if (p.type === 'verify-loop-complete' && p.runId === runId.current) finishSingle(); else if (p.type === 'verify-loop-error' && p.runId === runId.current) finishError(`Run failed: ${p.error}`); else if (p.phase) setLive(p); };
    return () => { stream.close(); stopPolling(); };
  }, []);

  const startRunPolling = id => { stopPolling(); const check = async () => { try { const state = await responseJson(await fetch(`${API}/verify-loop-status/${id}`)); if (state.status === 'complete') finishSingle(); else if (state.status === 'error') finishError(`Run failed: ${state.error}`); } catch {} }; check(); poll.current = setInterval(check, 2000); };
  const startScanPolling = id => { stopPolling(); const check = async () => { try { const state = await responseJson(await fetch(`${API}/repo-scan-status/${id}`)); if (state.status === 'complete') finishScan(); else if (state.status === 'error') finishError(`Scan error: ${state.error}`); } catch {} }; check(); poll.current = setInterval(check, 2000); };
  async function selectFile(event) { const file = event.target.files?.[0]; if (!file) return; const isRepo = file.name.toLowerCase().endsWith('.zip'); setName(file.name); setRepoMode(isRepo); setData(null); setLive(null); setRepoFiles([]); setRepoResults([]); setRepoErrors([]); setExpanded(null); setStatus('Uploading file…'); const form = new FormData(); try { if (isRepo) { setTestFile(null); form.append('repoZip', file); const body = await responseJson(await fetch(`${API}/upload-zip`, { method: 'POST', body: form })); setRepoPath(body.extractedPath); } else { form.append('testFile', file); const body = await responseJson(await fetch(`${API}/upload-test`, { method: 'POST', body: form })); setTestFile(body.filename); } setStatus('Ready to start the trial.'); } catch (error) { setName(null); setTestFile(null); setStatus(`Upload failed: ${error.message}`); } }
  async function runTrial() { setLoading(true); setLive(null); setData(null); setStatus(repoMode ? 'Starting repository scan…' : 'Court is in session — this can take a few minutes…'); try { const route = repoMode ? 'run-repo-scan' : 'run-verify-loop'; const body = await responseJson(await fetch(`${API}/${route}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(repoMode ? { targetDir: repoPath } : { testFile }) })); if (repoMode) { scanId.current = body.scanId; startScanPolling(body.scanId); } else { runId.current = body.runId; startRunPolling(body.runId); } } catch (error) { finishError(`Could not start: ${error.message}`); } }
  const reset = () => { stopPolling(); setData(null); setLive(null); setName(null); setTestFile(null); setRepoPath(''); setRepoFiles([]); setRepoResults([]); setRepoErrors([]); setRepoMode(false); setExpanded(null); setStatus(''); };
  const label = phase => phase?.includes('before') ? 'Establishing baseline' : phase?.includes('candidate-1') ? 'Testing candidate 1' : phase?.includes('candidate-2') ? 'Testing candidate 2' : phase?.includes('after') ? 'Verifying best fix' : 'Running tests';
  const canRun = Boolean(name && (repoMode ? repoPath : testFile));

  return <main className="app-shell"><nav className="topbar"><a className="brand" href="#top"><b><Icon name="spark" size={17} /></b> Flaky Court</a><span>AI-powered test reliability</span></nav><div className="page" id="top"><header className="hero"><div className="hero-label"><i />Test reliability workspace</div><h1>Turn flaky tests into <em>trusted</em> checks.</h1><p>Upload a Playwright test or a repository. We measure the flake, diagnose the cause, and verify a fix without changing your intent.</p></header>
    <section className="workspace"><div className="workspace-heading"><div><span className="kicker">New trial</span><h2>Bring your test to court</h2></div><span className="file-type">.js or .zip</span></div><label className={`dropzone ${name ? 'has-file' : ''}`} htmlFor="file-input"><input id="file-input" type="file" accept=".js,.zip" onChange={selectFile} className="visually-hidden" /><b><Icon name={name ? 'file' : 'upload'} size={22} /></b><span><strong>{name || 'Choose a test file or repository'}</strong><small>{name ? (repoMode ? 'Repository ready to scan' : 'Test ready for analysis') : 'Drop it here, or browse from your computer'}</small></span><i>Browse</i></label><div className="actions"><button className="primary" onClick={runTrial} disabled={!canRun || loading}><Icon name="play" size={16} />{loading ? 'Trial in progress…' : repoMode ? 'Scan repository' : 'Run trial'}</button><button className="secondary" onClick={reset} disabled={loading}><Icon name="refresh" size={16} /> Reset</button>{status && <p className={/failed|error/i.test(status) ? 'error' : ''} role="status">{status}</p>}</div></section>
    {live && loading && <section className="live"><div className="section-heading"><div><span className="kicker">Live progress</span><h2>{label(live.phase)}</h2></div><span>Run {live.currentRun} of {live.totalRuns}</span></div><Dots results={live.runResults || []} /></section>}
    {!repoMode && data && <section className="results"><div className="results-heading"><div><span className="kicker">Trial results</span><h2>Evidence and recommendation</h2></div><div>{data.flakeRateAfter === 0 && <a className="primary compact" href={`${API}/download-fixed`}><Icon name="download" size={16} /> Download fix</a>}<button className="secondary compact" onClick={() => copy(JSON.stringify(data, null, 2))}><Icon name="copy" size={15} /> Copy JSON</button></div></div><DetailView data={data} copy={copy} /></section>}
    {repoMode && repoFiles.length > 0 && <section className="repository"><div className="section-heading"><div><span className="kicker">Repository results</span><h2>{repoFiles.length} discovered test file{repoFiles.length === 1 ? '' : 's'}</h2></div><span>{loading ? 'Analysis running' : 'Select a completed row for details'}</span></div><div className="table-wrap"><table><thead><tr><th>Test file</th><th>Verdict</th><th>Before</th><th>After</th><th>Diagnosis</th><th>Confidence</th></tr></thead><tbody>{repoFiles.map(file => { const result = repoResults.find(x => x.file === file), err = repoErrors.find(x => x.file === file), expandedRow = expanded === file; return <React.Fragment key={file}><tr className={result ? 'clickable' : ''} onClick={() => result && setExpanded(expandedRow ? null : file)}><td><Icon name="file" size={15} />{file}</td><td><Badge status={err ? 'Failed' : result?.status} /></td><td>{result ? pct(result.flakeRateBefore) : '—'}</td><td>{result ? pct(result.flakeRateAfter) : '—'}</td><td>{err ? 'Scan error' : result?.diagnosis?.cause?.replace(/_/g, ' ') || (result?.status === 'stable' ? 'Already stable' : '—')}</td><td>{result?.confidence?.level || '—'}</td></tr>{expandedRow && <tr className="details"><td colSpan="6"><DetailView data={result} copy={copy} /></td></tr>}</React.Fragment>; })}</tbody></table></div></section>}
  </div></main>;
}
