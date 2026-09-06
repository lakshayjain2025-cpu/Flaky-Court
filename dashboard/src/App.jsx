import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [data, setData] = useState(null);

  useEffect(() => {
    fetch('/results.json')
      .then((res) => res.json())
      .then((json) => setData(json))
      .catch((err) => console.error('Failed to load results:', err));
  }, []);

  if (!data) {
    return <div className="container loading-screen">⚖️ Convening the court...</div>;
  }

  return (
    <div className="container">
      <h1>Flaky Court — Courtroom Dashboard</h1>
      <h2>{data.testName}</h2>

      <div className="stats-row">
        <div className="stat-card before">
          <h3>Before</h3>
          <p className="flake-rate">{(data.flakeRateBefore * 100).toFixed(0)}%</p>
          <p>{data.failuresBefore} failures / {data.totalRunsBefore} runs</p>
        </div>

        <div className="stat-card after">
          <h3>After</h3>
          <p className="flake-rate">{(data.flakeRateAfter * 100).toFixed(0)}%</p>
          <p>{data.failuresAfter} failures / {data.totalRunsAfter} runs</p>
        </div>
      </div>

      <div className="diagnosis">
        <h3>AI Diagnosis: {data.diagnosis.cause}</h3>
        <p>{data.diagnosis.explanation}</p>
      </div>

      <div className="run-grid">
        <h4>50-Run Stress Test</h4>
        <div className="dots">
          {data.runResults.map((result, i) => (
            <div key={i} className={`dot ${result ? 'pass' : 'fail'}`}></div>
          ))}
        </div>
      </div>

      <div className="code-diff">
        <div className="code-block">
          <h4>Original Code</h4>
          <pre>{data.originalCode}</pre>
        </div>
        <div className="code-block">
          <h4>Fixed Code</h4>
          <pre>{data.fixedCode}</pre>
        </div>
      </div>
    </div>
  );
}

export default App;