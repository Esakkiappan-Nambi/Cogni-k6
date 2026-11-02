import React, { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlayCircle, Loader2, Trash2, Pencil, Search, Square,
  ExternalLink, FileText, Copy, Check, Terminal,
  AlertTriangle, RefreshCw, Plus, Activity, BarChart3,
  ChevronLeft, ChevronRight, Users, Clock,
  ArrowUp, ArrowDown, ArrowUpDown, Gauge, CheckCircle2,
} from "lucide-react";
import API from "../services/api";
import { toast } from "react-toastify";
import Layout from "../components/Layout";

/* ── helpers ─────────────────────────────────────────────────── */
function statusBadge(s) {
  const map = {
    completed: "badge-completed", failed: "badge-failed",
    running:   "badge-running",   stopping: "badge-stopping",
    created:   "badge-created",   stopped:  "badge-stopped",
    scheduled: "badge-scheduled",
  };
  return `badge ${map[s?.toLowerCase()] || "badge-stopped"}`;
}

const PAGE_SIZE = 8;

function Pagination({ total, page, setPage }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (total === 0) return null;

  const pages = [];
  for (let i = 1; i <= totalPages; i++) {
    if (
      i === 1 || i === totalPages ||
      (i >= page - 1 && i <= page + 1)
    ) {
      pages.push(i);
    } else if (pages[pages.length - 1] !== "...") {
      pages.push("...");
    }
  }

  return (
    <div className="pagination">
      <div className="pagination-info">
        Page <strong>{page}</strong> of <strong>{totalPages}</strong> ·{" "}
        <strong>{total}</strong> total
      </div>
      <div className="pagination-controls">
        <button
          className="page-btn"
          disabled={page === 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={14} />
        </button>
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`e-${i}`} className="page-ellipsis">…</span>
          ) : (
            <button
              key={p}
              className={`page-btn${p === page ? " active" : ""}`}
              onClick={() => setPage(p)}
            >
              {p}
            </button>
          )
        )}
        <button
          className="page-btn"
          disabled={page === totalPages}
          onClick={() => setPage(page + 1)}
        >
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

export default function RunTest() {
  const navigate = useNavigate();

  const [tests,          setTests]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [runningTestId,  setRunningTestId]  = useState(null);
  const [activeRunId,    setActiveRunId]    = useState(null);
  const [stoppingId,     setStoppingId]     = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [output,         setOutput]         = useState("");
  const [grafanaUrl,     setGrafanaUrl]     = useState("");
  const [search,         setSearch]         = useState("");
  const [copied,         setCopied]         = useState(false);
  const [page,           setPage]           = useState(1);
  const [sortBy,         setSortBy]         = useState("created_at");
  const [sortOrder,      setSortOrder]      = useState("desc");
  const [activeTab,      setActiveTab]      = useState("k6"); // "k6" | "grafana"
  const [telemetry,      setTelemetry]      = useState({
    grafana_online: false, influxdb_online: false,
    k6_dashboard_online: true,
    k6_web_dashboard_url: "http://localhost:5665",
    grafana_base_url: "http://localhost:3000",
    grafana_dashboard_path: "/d/adfqsh7/k6-load-testing-results",
  });

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "test_name" ? "asc" : "desc");
    }
  };

  const pollRef   = useRef(null);
  const autoRef   = useRef(null);

  /* ── load ─────────────────────────────────────────────────── */
  const loadTests = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const r = await API.get("/tests");
      setTests(r.data || []);
    } catch { /* ignore */ }
    finally { if (!silent) setLoading(false); }
  }, []);

  const loadTelemetry = useCallback(() => {
    API.get("/telemetry-status").then((r) => setTelemetry(r.data || {})).catch(() => {});
  }, []);

  useEffect(() => {
    loadTests();
    loadTelemetry();

    // Auto-refresh every 4s — detect externally started runs
    autoRef.current = setInterval(async () => {
      try {
        const r   = await API.get("/tests");
        const all = r.data || [];
        setTests(all);
        const running = all.find((t) => t.status === "running");
        if (running && !runningTestId) {
          setRunningTestId(running.id);
          const rr = await API.get(`/latest-run/${running.id}`);
          if (rr.data?.run_id) {
            setActiveRunId(rr.data.run_id);
            buildGrafanaUrl(rr.data.run_id);
            pollForResult(running.id, rr.data.run_id);
          }
        }
      } catch { /* ignore */ }
    }, 4000);

    return () => {
      if (pollRef.current)  clearInterval(pollRef.current);
      if (autoRef.current)  clearInterval(autoRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── grafana URL ──────────────────────────────────────────── */
  const buildGrafanaUrl = (runId) => {
    const base = telemetry.grafana_base_url || "http://localhost:3000";
    const path = telemetry.grafana_dashboard_path || "/d/adfqsh7/k6-load-testing-results";
    setGrafanaUrl(`${base}${path}?var-run_id=${runId}&refresh=5s&from=now-5m&to=now&kiosk=tv`);
  };

  /* ── poll ─────────────────────────────────────────────────── */
  const pollForResult = (testId, runId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data: r } = await API.get(`/report/${runId}`);
        if (r.output) setOutput(r.output);
        if (r.status !== "running" && r.status !== "stopping") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setTests((p) => p.map((t) => t.id === testId ? { ...t, status: r.status } : t));
          setRunningTestId(null);
          if (r.status === "completed")     toast.success("✓ Test completed successfully!");
          else if (r.status === "stopped")  toast.info("Test stopped.");
          else                              toast.error("Test completed with failures.");
          loadTests(true);
        }
      } catch {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setRunningTestId(null);
      }
    }, 3000);
  };

  /* ── run ──────────────────────────────────────────────────── */
  const runTest = async (testId) => {
    setRunningTestId(testId);
    setOutput("");
    setTests((p) => p.map((t) => t.id === testId ? { ...t, status: "running" } : t));
    try {
      const res   = await API.post(`/run-test/${testId}`);
      const runId = res.data.run_id;
      setActiveRunId(runId);
      buildGrafanaUrl(runId);
      toast.info(`Test #${testId} started — Run #${runId}`);
      pollForResult(testId, runId);
    } catch (err) {
      setRunningTestId(null);
      setTests((p) => p.map((t) => t.id === testId ? { ...t, status: "failed" } : t));
      toast.error(err.response?.data?.detail || "Failed to start test");
    }
  };

  /* ── stop ─────────────────────────────────────────────────── */
  const stopTest = async (testId) => {
    if (!window.confirm("Stop this running test?")) return;
    setStoppingId(testId);
    try {
      await API.post(`/stop-test/${testId}`);
      setTests((p) => p.map((t) => t.id === testId ? { ...t, status: "stopping" } : t));
      toast.info("Stop signal sent.");
    } catch { toast.error("Failed to stop test"); }
    finally  { setStoppingId(null); }
  };

  /* ── delete ───────────────────────────────────────────────── */
  const deleteTest = async (testId) => {
    if (!window.confirm("Delete this test plan?")) return;
    setDeletingId(testId);
    try {
      await API.delete(`/delete-test/${testId}`);
      setTests((p) => p.filter((t) => t.id !== testId));
      toast.success("Test deleted.");
    } catch { toast.error("Delete failed"); }
    finally  { setDeletingId(null); }
  };

  /* ── copy output ──────────────────────────────────────────── */
  const copyOutput = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied to clipboard");
  };

  /* ── derived with enterprise sorting ───────────────────────── */
  const sortedTests = useMemo(() => {
    return [...tests].sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];

      if (sortBy === "created_at") {
        aVal = new Date(aVal || 0).getTime();
        bVal = new Date(bVal || 0).getTime();
      } else if (sortBy === "test_name" || sortBy === "status") {
        aVal = (aVal || "").toString().toLowerCase();
        bVal = (bVal || "").toString().toLowerCase();
      } else {
        aVal = Number(aVal || 0);
        bVal = Number(bVal || 0);
      }

      if (aVal < bVal) return sortOrder === "asc" ? -1 : 1;
      if (aVal > bVal) return sortOrder === "asc" ? 1 : -1;
      return 0;
    });
  }, [tests, sortBy, sortOrder]);

  const filtered    = useMemo(() => {
    return sortedTests.filter((t) =>
      t.test_name.toLowerCase().includes(search.toLowerCase())
    );
  }, [sortedTests, search]);

  const totalPages  = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage    = Math.min(page, totalPages);
  const paginated   = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // Reset to page 1 when search changes
  useEffect(() => { setPage(1); }, [search]);

  return (
    <Layout>
      {/* ═══════════════════════════════════════════════════
          PAGE HEADER  (matches screenshot 3)
          ═══════════════════════════════════════════════════ */}
      <div className="page-header">
        <div className="page-header-left">
          <div className="page-header-title">Run & Live Monitoring</div>
          <div className="page-header-sub">Execute test scenarios and stream live terminal telemetry</div>
        </div>
        <div className="page-header-right">
          <button className="btn btn-primary" onClick={() => navigate("/createtest")}>
            <Plus size={14} /> New Test
          </button>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: "var(--r)", padding: "6px 14px",
            fontSize: 13, color: "var(--tx2)",
          }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: "var(--brand)", flexShrink: 0 }} />
            {localStorage.getItem("full_name") || "User"}
          </div>
        </div>
      </div>

      <div className="rt-body">

        {/* ── Active run banner ── */}
        {runningTestId && (
          <div className="rt-run-banner">
            <div className="rt-run-banner-left">
              <Loader2 size={22} className="spinner" style={{ color: "var(--brand-l)" }} />
              <div>
                <h4>Test #{runningTestId} is currently executing…</h4>
                <p>
                  Run ID: <strong>#{activeRunId || "—"}</strong> ·
                  Real-time metrics streaming on <strong>http://localhost:5665</strong> (Zero InfluxDB required)
                </p>
              </div>
            </div>
            <div className="rt-run-banner-actions">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => window.open("http://localhost:5665", "_blank")}
                style={{ background: "#4f46e5", color: "#fff" }}
              >
                <Gauge size={13} /> k6 Live Dashboard (5665)
              </button>
              {activeRunId && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => window.open(grafanaUrl.replace("&kiosk=tv", ""), "_blank")}
                >
                  <ExternalLink size={13} /> Grafana Live
                </button>
              )}
              <button
                className="btn btn-danger btn-sm"
                disabled={stoppingId === runningTestId}
                onClick={() => stopTest(runningTestId)}
              >
                <Square size={13} />
                {stoppingId === runningTestId ? "Stopping…" : "Stop Execution"}
              </button>
            </div>
          </div>
        )}

        {/* ── "Run & Monitor Hub" card  (matches screenshot) ── */}
        <div className="rt-hub-card">
          <div className="rt-hub-left">
            <div className="rt-hub-icon">
              <Activity size={20} />
            </div>
            <div>
              <div className="rt-hub-title">Run & Monitor Hub</div>
              <div className="rt-hub-sub">
                Execute load scenarios, monitor live execution, and view k6 output logs
              </div>
            </div>
          </div>
          <div className="rt-hub-right">
            <div className="search-box">
              <Search size={14} className="search-ico" />
              <input
                placeholder="Search scenarios…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="sort-badge-wrap" title="Sort test scenarios">
              <ArrowUpDown size={13} className="sort-badge-icon" />
              <select
                className="sort-select-modern"
                value={`${sortBy}-${sortOrder}`}
                onChange={(e) => {
                  const [f, o] = e.target.value.split("-");
                  setSortBy(f);
                  setSortOrder(o);
                }}
              >
                <option value="created_at-desc">Newest First</option>
                <option value="created_at-asc">Oldest First</option>
                <option value="test_name-asc">Name (A → Z)</option>
                <option value="test_name-desc">Name (Z → A)</option>
                <option value="users-desc">VUs (High → Low)</option>
                <option value="users-asc">VUs (Low → High)</option>
                <option value="duration-desc">Duration (Longest)</option>
                <option value="duration-asc">Duration (Shortest)</option>
                <option value="status-asc">Status</option>
              </select>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => loadTests()}>
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/createtest")}>
              <Plus size={13} /> New Scenario
            </button>
          </div>
        </div>

        {/* ── Test scenarios table  (matches screenshot) ── */}
        <div className="rt-table-wrap">
          <div className="rt-table-top">
            <div className="rt-table-top-left">
              <span className="rt-table-top-title">Test Scenarios</span>
              <span className="rt-total-chip">{filtered.length}</span>
            </div>
            <div className="rt-page-info">
              Page {safePage} of {totalPages} · {filtered.length} total
            </div>
          </div>

          {loading ? (
            <div className="loading-box">
              <Loader2 size={28} className="spinner" />
              <p>Loading test scenarios…</p>
            </div>
          ) : (
            <>
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="sortable" onClick={() => handleSort("id")} title="Click to sort by ID">
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        ID {sortBy === "id" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("test_name")} title="Click to sort by Name">
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Scenario Name {sortBy === "test_name" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("users")} title="Click to sort by VUs">
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Workload {sortBy === "users" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("duration")} title="Click to sort by Duration">
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Duration {sortBy === "duration" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("status")} title="Click to sort by Status">
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Status {sortBy === "status" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("created_at")} title="Click to sort by Created Date">
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Created {sortBy === "created_at" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th style={{ textAlign: "center" }}>Run</th>
                    <th style={{ textAlign: "center" }}>Manage</th>
                  </tr>
                </thead>
                <tbody>
                  {paginated.length > 0 ? paginated.map((t) => (
                    <tr
                      key={t.id}
                      className={runningTestId === t.id ? "row-running" : ""}
                    >
                      <td style={{ color: "var(--tx3)", fontSize: 12, fontWeight: 700, fontFamily: "'Consolas', monospace" }}>
                        #{t.id}
                      </td>
                      <td>
                        <div style={{ fontWeight: 600, color: "var(--tx)" }}>{t.test_name}</div>
                        <div style={{ fontSize: 11, color: "var(--tx3)" }}>k6 load test scenario</div>
                      </td>
                      <td>
                        <span className="vu-chip"><Users size={11} /> {t.users} VUs</span>
                      </td>
                      <td>
                        <span style={{ color: "var(--tx2)", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <Clock size={11} color="var(--tx3)" /> {t.duration}s
                        </span>
                      </td>
                      <td>
                        <span className={statusBadge(t.status)}>
                          {(t.status === "running" || t.status === "stopping") && (
                            <Loader2 size={10} className="spinner" />
                          )}
                          {t.status}
                        </span>
                      </td>
                      <td style={{ color: "var(--tx3)", fontSize: 12 }}>
                        {new Date(t.created_at).toLocaleDateString("en-GB", {
                          day: "2-digit", month: "short", year: "numeric",
                        })}
                      </td>

                      {/* Run / Stop */}
                      <td style={{ textAlign: "center" }}>
                        {t.status === "running" ? (
                          <button
                            className="btn btn-danger btn-sm"
                            disabled={stoppingId === t.id}
                            onClick={() => stopTest(t.id)}
                          >
                            {stoppingId === t.id
                              ? <><Loader2 size={12} className="spinner" /> Stopping…</>
                              : <><Square size={12} /> Stop</>}
                          </button>
                        ) : (
                          <button
                            className="btn-run-now"
                            disabled={!!runningTestId}
                            onClick={() => runTest(t.id)}
                          >
                            <PlayCircle size={13} /> Run Now
                          </button>
                        )}
                      </td>

                      {/* Manage */}
                      <td style={{ textAlign: "center" }}>
                        <div style={{ display: "flex", gap: 4, justifyContent: "center" }}>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            title="View Reports & History"
                            onClick={() => navigate("/history")}
                          >
                            <BarChart3 size={13} />
                          </button>
                          <button
                            className="btn btn-ghost btn-icon btn-sm"
                            title="Edit scenario"
                            disabled={runningTestId === t.id}
                            onClick={() => navigate(`/createtest/${t.id}`)}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            className="btn btn-danger btn-icon btn-sm"
                            title="Delete scenario"
                            disabled={deletingId === t.id || runningTestId === t.id}
                            onClick={() => deleteTest(t.id)}
                          >
                            {deletingId === t.id
                              ? <Loader2 size={13} className="spinner" />
                              : <Trash2 size={13} />}
                          </button>
                        </div>
                      </td>
                    </tr>
                  )) : (
                    <tr>
                      <td colSpan={8}>
                        <div className="empty-state">
                          <FileText size={28} />
                          <h3>No test scenarios found</h3>
                          <p>
                            {search
                              ? "No results match your search."
                              : "Create a test scenario to get started."}
                          </p>
                        </div>
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>

              {/* ── Pagination ── */}
              {filtered.length > PAGE_SIZE && (
                <Pagination
                  total={filtered.length}
                  page={safePage}
                  setPage={setPage}
                />
              )}
            </>
          )}
        </div>

        {/* ── Enterprise Live Telemetry (Native k6 Dashboard + Grafana) ── */}
        {(runningTestId || activeRunId || grafanaUrl) && (
          <div className="rt-grafana-card">
            <div className="rt-grafana-hdr">
              <div className="rt-grafana-hdr-left">
                <div
                  className="pulse-anim"
                  style={{ color: "#22c55e", display: "flex", alignItems: "center" }}
                >
                  <Activity size={18} />
                </div>
                <div>
                  <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    Live Performance Telemetry
                    <span style={{ fontSize: 11, background: "#22c55e20", color: "#22c55e", padding: "2px 8px", borderRadius: 12, fontWeight: 600 }}>LIVE</span>
                  </h3>
                  <p>Real-time RPS, latency percentiles, and virtual users · Run #{activeRunId || "Active"}</p>
                </div>
              </div>
              <div className="rt-grafana-hdr-right">
                <div style={{ display: "flex", gap: 4, background: "var(--bg3)", padding: 3, borderRadius: 6, border: "1px solid var(--border)" }}>
                  <button
                    className={`btn btn-sm ${activeTab === "k6" ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setActiveTab("k6")}
                  >
                    <Gauge size={12} /> k6 Dashboard (Native)
                  </button>
                  <button
                    className={`btn btn-sm ${activeTab === "grafana" ? "btn-primary" : "btn-ghost"}`}
                    onClick={() => setActiveTab("grafana")}
                  >
                    <BarChart3 size={12} /> Grafana View
                  </button>
                </div>
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => window.open(activeTab === "k6" ? "http://localhost:5665" : grafanaUrl.replace("&kiosk=tv", ""), "_blank")}
                >
                  <ExternalLink size={13} /> Open Tab
                </button>
                {activeRunId && (
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => navigate(`/report/${activeRunId}`)}
                  >
                    <FileText size={13} /> View Report
                  </button>
                )}
              </div>
            </div>
            <div className="rt-grafana-body">
              {activeTab === "k6" ? (
                <div>
                  <iframe
                    src="http://localhost:5665"
                    width="100%"
                    height="480px"
                    style={{ border: "none", borderRadius: 8, background: "#0e1117" }}
                    title="k6 Native Live Dashboard"
                  />
                  <div className="rt-grafana-note" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <CheckCircle2 size={14} style={{ color: "#22c55e" }} />
                      Streaming directly from k6 native engine on port 5665. <strong>No InfluxDB required.</strong>
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: 11 }}
                      onClick={() => window.open("http://localhost:5665", "_blank")}
                    >
                      Pop out dashboard ↗
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <iframe
                    src={grafanaUrl || "http://localhost:3000"}
                    width="100%"
                    height="460px"
                    style={{ border: "none", borderRadius: 8 }}
                    title="Grafana Dashboard"
                  />
                  <div className="rt-grafana-note">
                    <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
                    <span>
                      Grafana view streams from port 3000. For zero-config instant streaming without InfluxDB, switch to the <strong>k6 Dashboard (Native)</strong> tab above.
                    </span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Terminal output ── */}
        {output && (
          <div className="rt-terminal-card">
            <div className="rt-terminal-hdr">
              <div className="rt-terminal-hdr-left">
                <span style={{ display: "flex", gap: 5, marginRight: 8 }}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f43f5e", display: "inline-block" }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f59e0b", display: "inline-block" }} />
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10b981", display: "inline-block" }} />
                </span>
                <Terminal size={14} style={{ color: "var(--brand-l)" }} />
                <span>k6-runtime-telemetry.log</span>
              </div>
              <div className="rt-terminal-hdr-right">
                <button className="btn btn-ghost btn-sm" onClick={copyOutput}>
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? "Copied" : "Copy Log"}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setOutput("")}>
                  Clear
                </button>
              </div>
            </div>
            <pre className="terminal" style={{ margin: 0, borderRadius: 0, border: "none" }}>
              {output}
            </pre>
          </div>
        )}

      </div>
    </Layout>
  );
}
