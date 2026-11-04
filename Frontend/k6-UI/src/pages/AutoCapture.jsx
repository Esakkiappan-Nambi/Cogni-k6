import { useState } from "react";

const DEFAULT_OPTS = { wait_ms:   6000,
    interact:  false,
    dedupe:    true,
    inject_auth: false,
};

export default function AutoCapture() {
    const [url,        setUrl]        = useState("");
    const [loading,    setLoading]    = useState(false);
    const [scenario,   setScenario]   = useState([]);
    const [error,      setError]      = useState("");
    const [opts,       setOpts]       = useState(DEFAULT_OPTS);
    const [testConfig, setTestConfig] = useState({
    test_name: "auto_test", users: 10, duration: 30,
    ramp_up: 5, ramp_down: 5, loop_count: 1,
});
    const [scriptPath, setScriptPath] = useState("");

  // ── Step 1: Capture APIs ─────────────────────────────────────────────────
    const handleCapture = async () => {
    if (!url.trim()) return;
    setLoading(true);
    setError("");
    setScenario([]);
    setScriptPath("");

    try {
        const res = await fetch("/api/auto-capture", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim(), ...opts }),
    });
    const data = await res.json();

    if (!res.ok) throw new Error(data.detail || "Capture failed");

      setScenario(data.scenario);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Step 2: Toggle a step on/off ─────────────────────────────────────────
  const toggleStep = (index) => {
    setScenario(prev =>
      prev.map((s, i) => i === index ? { ...s, enabled: !s.enabled } : s)
    );
  };

  // ── Step 3: Generate + Run ────────────────────────────────────────────────
  const handleGenerate = async () => {
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/auto-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url,
          ...testConfig,
          ...opts,
          scenario,         // send the (possibly edited) scenario
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Generation failed");
      setScriptPath(data.script_path);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  // ── UI ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 24, fontFamily: "sans-serif", maxWidth: 900 }}>
      <h2>🔍 Auto API Capture</h2>
      <p style={{ color: "#555" }}>
        Enter your app URL — the system will open it, capture all API calls,
        and build a k6 performance test automatically.
      </p>

      {/* URL input */}
      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <input
          style={{ flex: 1, padding: "8px 12px", fontSize: 14, borderRadius: 6,
                   border: "1px solid #ccc" }}
          placeholder="https://your-app.com"
          value={url}
          onChange={e => setUrl(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleCapture()}
        />
        <button
          onClick={handleCapture}
          disabled={loading || !url.trim()}
          style={{ padding: "8px 20px", background: "#2563eb", color: "#fff",
                   border: "none", borderRadius: 6, cursor: "pointer",
                   opacity: loading ? 0.6 : 1 }}
        >
          {loading ? "Capturing…" : "Capture APIs"}
        </button>
      </div>

      {/* Options */}
      <details style={{ marginBottom: 16 }}>
        <summary style={{ cursor: "pointer", color: "#2563eb" }}>
          ⚙ Capture Options
        </summary>
        <div style={{ display: "flex", gap: 24, marginTop: 8, flexWrap: "wrap" }}>
          <label>
            <input type="checkbox" checked={opts.interact}
              onChange={e => setOpts(o => ({ ...o, interact: e.target.checked }))} />
            {" "}Interact with page (scroll + click)
          </label>
          <label>
            <input type="checkbox" checked={opts.dedupe}
              onChange={e => setOpts(o => ({ ...o, dedupe: e.target.checked }))} />
            {" "}De-duplicate requests
          </label>
          <label>
            <input type="checkbox" checked={opts.inject_auth}
              onChange={e => setOpts(o => ({ ...o, inject_auth: e.target.checked }))} />
            {" "}Inject Authorization header
          </label>
          <label>
            Wait (ms):{" "}
            <input type="number" value={opts.wait_ms} style={{ width: 80 }}
              onChange={e => setOpts(o => ({ ...o, wait_ms: +e.target.value }))} />
          </label>
        </div>
      </details>

      {/* Error */}
      {error && (
        <div style={{ background: "#fee2e2", color: "#b91c1c", padding: 12,
                      borderRadius: 6, marginBottom: 16 }}>
          ⚠ {error}
        </div>
      )}

      {/* Captured scenario table */}
      {scenario.length > 0 && (
        <>
          <h3>Captured API Calls ({scenario.length})</h3>
          <p style={{ color: "#555", fontSize: 13 }}>
            Toggle steps on/off before generating the test.
          </p>
          <table style={{ width: "100%", borderCollapse: "collapse",
                          fontSize: 13, marginBottom: 20 }}>
            <thead>
              <tr style={{ background: "#f1f5f9" }}>
                {["#", "On", "Method", "URL", "Body?", "Extract"].map(h => (
                  <th key={h} style={{ padding: "8px 12px", textAlign: "left",
                                       borderBottom: "1px solid #e2e8f0" }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {scenario.map((step, i) => (
                <tr key={i} style={{ opacity: step.enabled ? 1 : 0.4 }}>
                  <td style={{ padding: "6px 12px" }}>{i + 1}</td>
                  <td style={{ padding: "6px 12px" }}>
                    <input type="checkbox" checked={!!step.enabled}
                      onChange={() => toggleStep(i)} />
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    <span style={{
                      background: step.method === "GET" ? "#dcfce7" :
                                  step.method === "POST" ? "#dbeafe" :
                                  step.method === "PUT"  ? "#fef9c3" : "#fee2e2",
                      color:      step.method === "GET" ? "#166534" :
                                  step.method === "POST" ? "#1d4ed8" :
                                  step.method === "PUT"  ? "#854d0e" : "#991b1b",
                      padding: "2px 8px", borderRadius: 4, fontWeight: 600,
                    }}>
                      {step.method}
                    </span>
                  </td>
                  <td style={{ padding: "6px 12px", wordBreak: "break-all",
                               maxWidth: 400 }}>
                    {step.url}
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    {step.body ? "✅" : "—"}
                  </td>
                  <td style={{ padding: "6px 12px" }}>
                    {step.extractVariable ? `→ ${step.variableName}` : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Test config + Generate button */}
          <h3>Test Configuration</h3>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap",
                        marginBottom: 16 }}>
            {[
              ["Test Name", "test_name", "text"],
              ["Virtual Users", "users", "number"],
              ["Duration (s)", "duration", "number"],
              ["Ramp Up (s)", "ramp_up", "number"],
              ["Ramp Down (s)", "ramp_down", "number"],
              ["Loop Count", "loop_count", "number"],
            ].map(([label, key, type]) => (
              <label key={key} style={{ display: "flex", flexDirection: "column",
                                        fontSize: 13, gap: 4 }}>
                {label}
                <input
                  type={type}
                  value={testConfig[key]}
                  style={{ padding: "6px 10px", borderRadius: 6,
                           border: "1px solid #ccc", width: 140 }}
                  onChange={e => setTestConfig(c => ({
                    ...c,
                    [key]: type === "number" ? +e.target.value : e.target.value,
                  }))}
                />
              </label>
            ))}
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading}
            style={{ padding: "10px 28px", background: "#16a34a", color: "#fff",
                     border: "none", borderRadius: 6, cursor: "pointer",
                     fontSize: 15, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? "Generating…" : "⚡ Generate k6 Script & Run"}
          </button>

          {scriptPath && (
            <div style={{ marginTop: 16, background: "#f0fdf4", color: "#166534",
                          padding: 12, borderRadius: 6 }}>
              ✅ Script generated: <code>{scriptPath}</code>
            </div>
          )}
        </>
      )}
    </div>
  );
}
