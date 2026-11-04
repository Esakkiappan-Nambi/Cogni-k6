import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import {
  Radio, Plus, RefreshCw, Upload, Square,
  Info, X, Globe, Clock, Filter,
  FileCode, Wifi, Trash2, ArrowRight,
  Download, Database, History,
} from "lucide-react";
import { toast } from "react-toastify";
import API from "../services/api";
import Layout from "../components/Layout";
import "./Recorder.css";

/* ── helpers ── */
const statusClass = (code) => {
  if (!code) return "";
  if (code < 300) return "rec-status-2xx";
  if (code < 400) return "rec-status-3xx";
  return "rec-status-4xx";
};

const fmt = (ms) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`;

const STORAGE_KEY = "k6_recorder_sessions_v2";

const createDefaultSession = (name, port = 8888, filter = "") => ({
  id: Date.now(),
  name: name || "Default Recording Session",
  proxyPort: port,
  filter: filter,
  status: "idle",   // idle | recording | stopped
  requests: [],
  createdAt: new Date().toISOString(),
});

/* ── HAR parser ── */
function parseHAR(harText) {
  try {
    const har = JSON.parse(harText);
    const entries = har?.log?.entries || [];
    return entries.map((e, i) => {
      const req = e.request || {};
      const res = e.response || {};
      const url = req.url || "";
      const body = req.postData?.text || "";
      const headers = {};
      (req.headers || []).forEach((h) => { headers[h.name] = h.value; });
      return {
        id: Date.now() + i,
        method: req.method || "GET",
        url,
        status: res.status || 0,
        duration: Math.round(e.time || 0),
        size: res.content?.size || 0,
        body,
        headers,
        responseBody: res.content?.text || "",
        contentType: res.content?.mimeType || "",
        timestamp: e.startedDateTime || new Date().toISOString(),
      };
    }).filter((r) => r.url && (r.url.startsWith("http://") || r.url.startsWith("https://")));
  } catch {
    return [];
  }
}

export default function Recorder() {
  const navigate = useNavigate();
  const fileRef  = useRef();

  // Load initial sessions from localStorage if present
  const [sessions, setSessions] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn("Could not load stored recorder sessions", e);
    }
    return [createDefaultSession("Session 1 (Initial)")];
  });

  const [activeId, setActiveId]         = useState(() => sessions[0]?.id || Date.now());
  const [showModal, setShowModal]       = useState(false);
  const [newName, setNewName]           = useState("");
  const [newPort, setNewPort]           = useState(8888);
  const [newFilter, setNewFilter]       = useState("");
  const [methodFilter, setMethodFilter] = useState("ALL");
  const [searchFilter, setSearchFilter] = useState("");
  const [selectedReq, setSelectedReq]   = useState(null);
  const [converting, setConverting]     = useState(false);
  const pollRef = useRef(null);

  const activeSession = sessions.find((s) => s.id === activeId) || sessions[0] || createDefaultSession("Session 1");

  // Save sessions to localStorage whenever they change
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
    } catch (e) {
      console.warn("Could not persist sessions to localStorage", e);
    }
  }, [sessions]);

  // Sync with backend on component mount
  useEffect(() => {
    const fetchBackendSessions = async () => {
      try {
        const res = await API.get("/recorder/sessions");
        if (res.data?.sessions && Array.isArray(res.data.sessions) && res.data.sessions.length > 0) {
          const backendList = res.data.sessions;
          
          setSessions((currentLocal) => {
            const merged = [...currentLocal];
            backendList.forEach((bs) => {
              const existingIdx = merged.findIndex((ls) => ls.id === bs.id);
              if (existingIdx >= 0) {
                merged[existingIdx] = {
                  ...merged[existingIdx],
                  name: bs.name || merged[existingIdx].name,
                  proxyPort: bs.port || merged[existingIdx].proxyPort,
                  filter: bs.filter ?? merged[existingIdx].filter,
                  status: bs.status || merged[existingIdx].status,
                };
              } else {
                merged.push({
                  id: bs.id,
                  name: bs.name || `Session ${bs.id}`,
                  proxyPort: bs.port || 8888,
                  filter: bs.filter || "",
                  status: bs.status || "stopped",
                  requests: [],
                  createdAt: bs.created_at || new Date().toISOString(),
                });
              }
            });
            return merged;
          });
        }
      } catch (err) {
        console.warn("Backend /recorder/sessions not reachable yet:", err);
      }
    };

    fetchBackendSessions();
  }, []);

  // When activeId changes, if session has 0 requests in memory, fetch requests from backend
  useEffect(() => {
    const loadSessionRequests = async () => {
      if (!activeId) return;
      const cur = sessions.find((s) => s.id === activeId);
      if (cur && (!cur.requests || cur.requests.length === 0)) {
        try {
          const res = await API.get(`/recorder/session/${activeId}/requests`);
          if (res.data?.requests && res.data.requests.length > 0) {
            setSessions((prev) =>
              prev.map((s) => s.id === activeId ? { ...s, requests: res.data.requests } : s)
            );
          }
        } catch {
          // ignore error
        }
      }
    };
    loadSessionRequests();
  }, [activeId, sessions]);

  /* ── polling for live proxy captures ── */
  const startPoll = (sessionId) => {
    stopPoll();
    pollRef.current = setInterval(async () => {
      try {
        const res = await API.get(`/recorder/session/${sessionId}/requests`);
        if (res.data?.requests) {
          setSessions((prev) =>
            prev.map((s) =>
              s.id === sessionId ? { ...s, requests: res.data.requests } : s
            )
          );
        }
      } catch {
        /* proxy polling */
      }
    }, 1500);
  };

  const stopPoll = () => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  };

  useEffect(() => () => stopPoll(), []);

  /* ── start recording ── */
  const startRecording = async (session, append = false) => {
    try {
      await API.post("/recorder/start", {
        session_id: session.id,
        name: session.name,
        port: session.proxyPort,
        filter: session.filter,
        append: append,
      });

      setSessions((prev) =>
        prev.map((s) =>
          s.id === session.id
            ? { ...s, status: "recording", requests: append ? s.requests : [] }
            : s
        )
      );
      setActiveId(session.id);
      startPoll(session.id);
      toast.success(
        `Proxy active on port ${session.proxyPort} — set your browser proxy to 127.0.0.1:${session.proxyPort}`
      );
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to start proxy recorder.");
    }
  };

  /* ── stop recording ── */
  const stopRecording = async (session) => {
    stopPoll();
    try {
      await API.post("/recorder/stop", { session_id: session.id });
      // update backend with latest requests
      await API.post("/recorder/session/save", {
        session_id: session.id,
        name: session.name,
        port: session.proxyPort,
        filter: session.filter,
        requests: session.requests,
      });
    } catch {
      /* ignore */
    }

    setSessions((prev) =>
      prev.map((s) =>
        s.id === session.id ? { ...s, status: "stopped" } : s
      )
    );
    toast.info(`Recording saved to disk — ${session.requests.length} request(s) preserved`);
  };

  /* ── clear requests in current session ── */
  const clearSessionRequests = async (sessionId) => {
    stopPoll();
    try {
      await API.delete(`/recorder/session/${sessionId}/clear`);
    } catch {
      // ignore
    }
    setSessions((prev) =>
      prev.map((s) => s.id === sessionId ? { ...s, requests: [] } : s)
    );
    setSelectedReq(null);
    toast.info("Cleared requests for active session");
  };

  /* ── HAR import ── */
  const handleHARImport = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const parsed = parseHAR(ev.target.result);
      if (!parsed.length) {
        toast.error("No valid HTTP entries found in HAR file");
        return;
      }
      const updatedRequests = [...(activeSession.requests || []), ...parsed];
      setSessions((prev) =>
        prev.map((s) =>
          s.id === activeId
            ? { ...s, requests: updatedRequests, status: "stopped" }
            : s
        )
      );

      // Persist to backend
      try {
        await API.post("/recorder/session/save", {
          session_id: activeId,
          name: activeSession.name,
          port: activeSession.proxyPort,
          filter: activeSession.filter,
          requests: updatedRequests,
        });
      } catch {
        // ignore
      }

      toast.success(`Imported and saved ${parsed.length} request(s) from ${file.name}`);
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  /* ── Export session to JSON or HAR ── */
  const exportSessionJSON = () => {
    if (!activeSession.requests.length) {
      toast.error("No requests to export");
      return;
    }
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(activeSession, null, 2));
    const dlAnchor = document.createElement("a");
    dlAnchor.setAttribute("href", dataStr);
    dlAnchor.setAttribute("download", `${activeSession.name.replace(/\s+/g, "_")}_recording.json`);
    dlAnchor.click();
    toast.success("Recording exported as JSON");
  };

  /* ── convert to k6 / import into scenario builder ── */
  const convertToScenario = async () => {
    if (!activeSession.requests.length) {
      toast.error("No requests to convert");
      return;
    }
    setConverting(true);
    try {
      const steps = activeSession.requests
        .filter((r) => methodFilter === "ALL" || r.method === methodFilter)
        .map((r, i) => {
          let pathname;
          try { pathname = new URL(r.url).pathname; } catch { pathname = "/"; }
          return {
            id: Date.now() + i,
            name: `Step ${i + 1} — ${r.method} ${pathname}`,
            method: r.method,
            url: r.url,
            headers: JSON.stringify(r.headers || {}),
            body: r.body || "",
            enabled: true,
            thinkTime: 1000,
            extractVariable: false,
            variableName: "",
            jsonPath: "",
            params: [],
            assertions: {
              enabled: true,
              status_code: r.status || 200,
              max_response_time: 2000,
              text_assertions: [],
            },
            retry: { enabled: false, maxRetries: 3, retryDelay: 1000, retryOn: [500, 502, 503], retryOnTimeout: true },
          };
        });

      // Store in sessionStorage for CreateTest to pick up
      sessionStorage.setItem("recorder_import", JSON.stringify(steps));
      toast.success(`${steps.length} request(s) converted — opening Scenario Studio`);
      setTimeout(() => navigate("/createtest"), 800);
    } catch {
      toast.error("Conversion failed");
    } finally {
      setConverting(false);
    }
  };

  /* ── create new session ── */
  const createSession = async () => {
    const name = newName.trim() || `Session ${sessions.length + 1}`;
    const s = createDefaultSession(name, newPort, newFilter.trim());
    
    // Save to backend
    try {
      await API.post("/recorder/session/save", {
        session_id: s.id,
        name: s.name,
        port: s.proxyPort,
        filter: s.filter,
        requests: [],
      });
    } catch {
      // ignore
    }

    setSessions((prev) => [s, ...prev]);
    setActiveId(s.id);
    setShowModal(false);
    setNewName("");
    setNewPort(8888);
    setNewFilter("");
    toast.success(`Created session "${name}"`);
  };

  /* ── delete session ── */
  const deleteSession = async (id) => {
    if (sessions.length === 1) {
      toast.error("Cannot delete the only session. Create another first.");
      return;
    }
    try {
      await API.delete(`/recorder/session/${id}`);
    } catch {
      // ignore
    }
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (activeId === id) {
      setActiveId(remaining[0]?.id);
    }
    toast.success("Session deleted");
  };

  /* ── filtered requests ── */
  const filtered = (activeSession.requests || []).filter((r) => {
    const matchesMethod = methodFilter === "ALL" || r.method === methodFilter;
    const matchesSearch = !searchFilter.trim() || r.url.toLowerCase().includes(searchFilter.toLowerCase());
    return matchesMethod && matchesSearch;
  });

  const METHODS = ["ALL", "GET", "POST", "PUT", "PATCH", "DELETE"];

  return (
    <Layout>
      <div className="rec-page">
        {/* ── Topbar ── */}
        <div className="rec-topbar">
          <div className="rec-topbar-left">
            <div className="rec-badge-row">
              <span className="rec-top-badge">
                <Radio size={12} className="rec-top-icon" /> JMeter-Style HTTP Proxy
              </span>
              <span className="rec-persistence-badge">
                <Database size={11} /> Persistent Storage Active
              </span>
            </div>
            <h2>HTTP(S) Test Script Recorder</h2>
            <p>
              Capture browser traffic through the proxy and permanently store previous recordings to build k6 load scenarios.
            </p>
          </div>
          <div className="rec-topbar-actions">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                stopPoll();
                if (activeId) {
                  API.get(`/recorder/session/${activeId}/requests`).then((res) => {
                    if (res.data?.requests) {
                      setSessions((p) =>
                        p.map((s) => s.id === activeId ? { ...s, requests: res.data.requests } : s)
                      );
                      toast.info("Refreshed from disk");
                    }
                  });
                }
              }}
            >
              <RefreshCw size={13} /> Refresh
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".har,application/json"
              style={{ display: "none" }}
              onChange={handleHARImport}
            />
            <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current.click()}>
              <Upload size={13} /> Import HAR
            </button>
            <button className="btn btn-ghost btn-sm" onClick={exportSessionJSON} disabled={!activeSession.requests?.length}>
              <Download size={13} /> Export JSON
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => setShowModal(true)}>
              <Plus size={13} /> New Session
            </button>
          </div>
        </div>

        {/* ── Quick-start instructional guide ── */}
        <div className="rec-quickstart">
          <Info size={15} style={{ flexShrink: 0, marginTop: 2, color: "#818cf8" }} />
          <span>
            <strong>Recorder Workflow:</strong> Select or create a session
            <span className="rec-qs-arrow">→</span> Click <strong>Start Recording</strong>
            <span className="rec-qs-arrow">→</span> Point your browser / system proxy to <code>127.0.0.1:{activeSession.proxyPort}</code>
            <span className="rec-qs-arrow">→</span> Perform transactions
            <span className="rec-qs-arrow">→</span> Click <strong>Stop Recording</strong> (automatically saved to persistent storage).
            All previous sessions remain safely preserved below!
          </span>
        </div>

        {/* ── Main Body Split ── */}
        <div className="rec-body">
          {/* ── Left Sessions Drawer (Previous Records) ── */}
          <div className="rec-sessions-panel">
            <div className="rec-sessions-header">
              <span className="rec-sessions-title">
                <History size={13} /> Saved Recordings
              </span>
              <span className="rec-session-count">{sessions.length}</span>
            </div>

            <div className="rec-sessions-list">
              {sessions.map((s) => {
                const reqCount = s.requests?.length || 0;
                return (
                  <div
                    key={s.id}
                    className={`rec-session-item${s.id === activeId ? " active" : ""}`}
                    onClick={() => {
                      if (s.id !== activeId) {
                        setSelectedReq(null);
                        setActiveId(s.id);
                      }
                    }}
                  >
                    <div className="rec-session-row-top">
                      <div className="rec-session-name" title={s.name}>{s.name}</div>
                      <span className={`rec-session-status ${s.status === "recording" ? "rec-status-recording" : s.status === "stopped" ? "rec-status-stopped" : "rec-status-idle"}`}>
                        {s.status === "recording" && (
                          <span
                            className="rec-blink"
                            style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block", marginRight: 4 }}
                          />
                        )}
                        {s.status.toUpperCase()}
                      </span>
                    </div>

                    <div className="rec-session-meta">
                      <span className="rec-session-port">
                        <Globe size={11} /> :{s.proxyPort}
                      </span>
                      <span className="rec-session-req-badge">
                        {reqCount} request{reqCount !== 1 ? "s" : ""}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="rec-sessions-footer">
              <button
                className="btn btn-ghost btn-sm"
                style={{ width: "100%", justifyContent: "center" }}
                onClick={() => setShowModal(true)}
              >
                <Plus size={13} /> Create Another Session
              </button>
            </div>
          </div>

          {/* ── Right Session Workspace ── */}
          <div className="rec-right">
            {/* Session Detail Header */}
            <div className="rec-detail-header">
              <div className="rec-detail-left">
                <div className="rec-detail-title-wrap">
                  <h3 className="rec-detail-name">{activeSession.name}</h3>
                  <span className={`rec-session-status ${activeSession.status === "recording" ? "rec-status-recording" : activeSession.status === "stopped" ? "rec-status-stopped" : "rec-status-idle"}`}>
                    {activeSession.status === "recording" && (
                      <span
                        className="rec-blink"
                        style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444", display: "inline-block", marginRight: 4 }}
                      />
                    )}
                    {activeSession.status.toUpperCase()}
                  </span>
                </div>

                <div className="rec-detail-meta">
                  <span className="rec-meta-chip">
                    <Globe size={12} /> Local Proxy: <code>127.0.0.1:{activeSession.proxyPort}</code>
                  </span>
                  {activeSession.filter && (
                    <span className="rec-meta-chip">
                      <Filter size={12} /> Filter: <code>{activeSession.filter}</code>
                    </span>
                  )}
                  <span className="rec-meta-chip">
                    <Clock size={12} /> Saved: {new Date(activeSession.createdAt).toLocaleDateString()}
                  </span>
                </div>
              </div>

              <div className="rec-detail-actions">
                {activeSession.status === "recording" ? (
                  <button className="btn btn-danger btn-sm" onClick={() => stopRecording(activeSession)}>
                    <Square size={13} /> Stop &amp; Save
                  </button>
                ) : (
                  <>
                    <button className="btn btn-rec btn-sm" onClick={() => startRecording(activeSession, false)}>
                      <Radio size={13} /> Fresh Record
                    </button>
                    {activeSession.requests?.length > 0 && (
                      <button className="btn btn-ghost btn-sm" title="Append additional traffic to this session" onClick={() => startRecording(activeSession, true)}>
                        <Plus size={13} /> Append Traffic
                      </button>
                    )}
                  </>
                )}

                {activeSession.requests?.length > 0 && (
                  <button
                    className="btn btn-ghost btn-sm"
                    title="Clear captured requests in this session"
                    onClick={() => clearSessionRequests(activeSession.id)}
                  >
                    Clear Calls
                  </button>
                )}

                <button
                  className="btn btn-ghost btn-sm btn-icon"
                  title="Delete this entire session"
                  onClick={() => deleteSession(activeSession.id)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>

            {/* Filter toolbar & search */}
            <div className="rec-requests-toolbar">
              <div className="rec-filter-pills">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    className={`rec-filter-pill${methodFilter === m ? " active" : ""}`}
                    onClick={() => setMethodFilter(m)}
                  >
                    {m}
                  </button>
                ))}
              </div>

              <div className="rec-search-box">
                <input
                  type="text"
                  className="rec-search-input"
                  placeholder="Filter by URL path or keyword…"
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                />
              </div>

              <span className="rec-req-count">
                {filtered.length} of {activeSession.requests?.length || 0} captured
              </span>
            </div>

            {/* Requests Table + Inspection Drawer */}
            <div className="rec-requests-area">
              <div className="rec-table-container">
                {filtered.length > 0 ? (
                  <table className="rec-req-table">
                    <thead>
                      <tr>
                        <th style={{ width: 36 }}>#</th>
                        <th style={{ width: 70 }}>Method</th>
                        <th>URL</th>
                        <th style={{ width: 70 }}>Status</th>
                        <th style={{ width: 85 }}>Duration</th>
                        <th style={{ width: 85 }}>Size</th>
                        <th style={{ width: 85 }}>Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r, i) => (
                        <tr
                          key={r.id || i}
                          className={selectedReq?.id === r.id ? "selected" : ""}
                          onClick={() => setSelectedReq(selectedReq?.id === r.id ? null : r)}
                        >
                          <td style={{ color: "var(--text-muted)", fontSize: 11 }}>{i + 1}</td>
                          <td>
                            <span className={`m-badge m-${r.method}`}>{r.method}</span>
                          </td>
                          <td className="rec-url-cell" title={r.url}>{r.url}</td>
                          <td className={`rec-status-code ${statusClass(r.status)}`}>
                            {r.status || "—"}
                          </td>
                          <td style={{ color: "var(--text-secondary)", fontSize: 11 }}>{fmt(r.duration)}</td>
                          <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                            {r.size ? `${(r.size / 1024).toFixed(1)} KB` : "—"}
                          </td>
                          <td style={{ color: "var(--text-muted)", fontSize: 11 }}>
                            {r.timestamp ? new Date(r.timestamp).toLocaleTimeString() : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : (
                  <div className="rec-empty">
                    <div className="rec-empty-icon"><Wifi size={24} /></div>
                    <h3>No recorded requests in this session</h3>
                    <p>
                      Click <strong>Fresh Record</strong> to capture live browser traffic, or{" "}
                      <a style={{ color: "var(--brand-light)", cursor: "pointer", textDecoration: "underline" }} onClick={() => fileRef.current?.click()}>
                        import a HAR file
                      </a>{" "}
                      to populate this session.
                    </p>
                  </div>
                )}
              </div>

              {/* Request detail inspection drawer */}
              {selectedReq && (
                <div className="rec-drawer fade-in">
                  <div className="rec-drawer-header">
                    <span className="rec-drawer-title">Request Inspection</span>
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSelectedReq(null)}>
                      <X size={14} />
                    </button>
                  </div>
                  <div className="rec-drawer-body">
                    <div className="rec-drawer-section">
                      <div className="rec-drawer-section-title">HTTP Request</div>
                      <div className="rec-drawer-kv">
                        <strong>{selectedReq.method}</strong> {selectedReq.url}{"\n\n"}
                        <em>Headers:</em>{"\n"}
                        {Object.entries(selectedReq.headers || {}).map(([k, v]) => `${k}: ${v}`).join("\n")}
                        {selectedReq.body ? `\n\nPayload:\n${selectedReq.body}` : ""}
                      </div>
                    </div>
                    <div className="rec-drawer-section">
                      <div className="rec-drawer-section-title">Server Response</div>
                      <div className="rec-drawer-kv">
                        Status Code: <strong>{selectedReq.status}</strong>{"\n"}
                        Content-Type: {selectedReq.contentType || "—"}{"\n"}
                        Response Time: {fmt(selectedReq.duration)}{"\n"}
                        {selectedReq.responseBody ? `\nPreview Body:\n${selectedReq.responseBody.slice(0, 2000)}` : ""}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Convert to Scenario Studio Action Bar */}
            {activeSession.requests?.length > 0 && (
              <div className="rec-convert-banner">
                <FileCode size={20} style={{ color: "var(--brand-light)", flexShrink: 0 }} />
                <div className="rec-convert-info">
                  <strong>{activeSession.requests.length} request(s) stored in session.</strong>{" "}
                  Convert this recording into a k6 execution pipeline with smart assertions, think times, and virtual user loops.
                </div>
                <button className="btn btn-primary" onClick={convertToScenario} disabled={converting}>
                  {converting ? "Converting…" : <><ArrowRight size={14} /> Convert to k6 Scenario</>}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ── New Session Modal ── */}
      {showModal && (
        <div className="rec-modal-overlay" onClick={(e) => e.target === e.currentTarget && setShowModal(false)}>
          <div className="rec-modal fade-in">
            <h3>Create New Recording Session</h3>
            <p>Each session records independently and remains permanently saved in your history.</p>
            <div className="rec-modal-fields">
              <div className="form-group">
                <label className="form-label">Session Name</label>
                <input
                  className="form-input"
                  placeholder="e.g. User Authentication & Checkout Flow"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && createSession()}
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Proxy Port</label>
                <input
                  className="form-input"
                  type="number"
                  min={1024}
                  max={65535}
                  value={newPort}
                  onChange={(e) => setNewPort(Number(e.target.value))}
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                  Browser proxy will listen on <code style={{ fontFamily: "monospace" }}>127.0.0.1:{newPort}</code>
                </span>
              </div>
              <div className="form-group">
                <label className="form-label">URL Filter (Optional)</label>
                <input
                  className="form-input"
                  placeholder="e.g. api.mycompany.com"
                  value={newFilter}
                  onChange={(e) => setNewFilter(e.target.value)}
                />
                <span style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
                  Only capture traffic targeting this host or path substring
                </span>
              </div>
            </div>
            <div className="rec-modal-actions">
              <button className="btn btn-ghost" onClick={() => setShowModal(false)}>Cancel</button>
              <button className="btn btn-primary" onClick={createSession}>
                <Plus size={13} /> Save Session
              </button>
            </div>
          </div>
        </div>
      )}
    </Layout>
  );
}
