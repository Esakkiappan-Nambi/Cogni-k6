import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  PlayCircle, Loader2, Trash2, Pencil, Search, Square,
  ExternalLink, FileText, Copy, Check, Terminal,
  AlertTriangle, RefreshCw, Plus, Activity, BarChart3,
  ChevronLeft, ChevronRight, Users, Clock,
  ArrowUp, ArrowDown, ArrowUpDown, Gauge, CheckCircle2,
  Zap, ShieldCheck, TrendingUp,
} from "lucide-react";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip
} from "recharts";
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

const CustomChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.95)",
      border: "1px solid rgba(255, 255, 255, 0.15)",
      borderRadius: 8,
      padding: "10px 14px",
      fontSize: 12,
      boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
    }}>
      <p style={{ color: "#94a3b8", marginBottom: 6, fontWeight: 600 }}>Time: {label}</p>
      {payload.map((entry) => (
        <div key={entry.name} style={{ display: "flex", justifyContent: "space-between", gap: 14, margin: "3px 0" }}>
          <span style={{ color: entry.color, display: "flex", alignItems: "center", gap: 5 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: entry.color }} />
            {entry.name}:
          </span>
          <strong style={{ color: "#f8fafc", fontFamily: "'Consolas', monospace" }}>
            {entry.value} {entry.name.includes("Latency") ? "ms" : "req/s"}
          </strong>
        </div>
      ))}
    </div>
  );
};

export default function RunTest() {
  const navigate = useNavigate();

  const [tests,          setTests]          = useState([]);
  const [loading,        setLoading]        = useState(true);
  const [runningTestId,  setRunningTestId]  = useState(null);
  const [activeRunId,    setActiveRunId]    = useState(null);
  const [stoppingId,     setStoppingId]     = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);
  const [output,         setOutput]         = useState("");
  const [search,         setSearch]         = useState("");
  const [copied,         setCopied]         = useState(false);
  const [page,           setPage]           = useState(1);
  const [sortBy,         setSortBy]         = useState("created_at");
  const [sortOrder,      setSortOrder]      = useState("desc");
  const [activeTab,      setActiveTab]      = useState("metrics"); // "metrics" | "grafana"
  const [lastDashboardRunId, setLastDashboardRunId] = useState(null);
  const [telemetry,      setTelemetry]      = useState({
    grafana_online: false,
    influxdb_online: false,
  });

  // ── Native Live Metrics State ──────────────────────────────────────────
  const [liveMetrics, setLiveMetrics] = useState({
    throughput: 0,
    avg_response_time: 0,
    min_response_time: 0,
    max_response_time: 0,
    p90: 0,
    p95: 0,
    error_rate: 0,
    total_requests: 0,
    failed_requests: 0,
    passed_checks: 0,
    active_vus: 0,
    status: "idle",
  });

  const [telemetryHistory, setTelemetryHistory] = useState([]);

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder(field === "test_name" ? "asc" : "desc");
    }
  };

  const pollRef = useRef(null);
  const autoRef = useRef(null);

  /* ── load ─────────────────────────────────────────────────── */
  const loadTests = useCallback(async () => {
    try {
      const r = await API.get("/tests", { timeout: 15000 });
      setTests(r.data || []);
    } catch (err) {
      console.error("Failed to load test scenarios:", err);
      toast.error(err.response?.data?.detail || "Could not load test scenarios. Please try refreshing.");
    }
    finally { setLoading(false); }
  }, []);

  const loadTelemetry = useCallback(() => {
    API.get("/telemetry-status").then((r) => setTelemetry(r.data || {})).catch(() => {});
  }, []);

  /* ── poll live results ─────────────────────────────────────── */
  const pollForResult = useCallback((testId, runId) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const { data: r } = await API.get(`/report/${runId}`);
        if (r.output) setOutput(r.output);

        const currentTps = Number(r.throughput || 0);
        const currentRt  = Number(r.avg_response_time || 0);
        const currentVus = Number(r.active_vus || 1);

        setLiveMetrics({
          throughput: currentTps,
          avg_response_time: currentRt,
          min_response_time: Number(r.min_response_time || 0),
          max_response_time: Number(r.max_response_time || 0),
          p90: Number(r.p90 || 0),
          p95: Number(r.p95 || 0),
          error_rate: Number(r.error_rate || 0),
          total_requests: Number(r.total_requests || 0),
          failed_requests: Number(r.failed_requests || 0),
          passed_checks: Number(r.passed_checks || 0),
          active_vus: currentVus,
          status: r.status || "running",
        });

        // Push time-series point to live chart
        setTelemetryHistory((prev) => {
          const nowStr = new Date().toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const newPoint = {
            time: nowStr,
            rps: Math.round(currentTps * 10) / 10,
            latency: Math.round(currentRt * 10) / 10,
            vus: currentVus,
          };
          const slice = [...prev, newPoint];
          return slice.slice(-25); // keep latest 25 readings
        });

        if (r.status !== "running" && r.status !== "stopping") {
          clearInterval(pollRef.current);
          pollRef.current = null;
          setTests((p) => p.map((t) => t.id === testId ? { ...t, status: r.status } : t));
          setRunningTestId(null);
          setLastDashboardRunId(runId);
          if (r.status === "completed")     toast.success("✓ Test completed successfully!");
          else if (r.status === "stopped")  toast.info("Test stopped.");
          else                              toast.error("Test finished with errors.");
          loadTests();
        }
      } catch {
        clearInterval(pollRef.current);
        pollRef.current = null;
        setRunningTestId(null);
      }
    }, 1200); // 1.2s smooth polling
  }, [loadTests]);

  useEffect(() => {
    void Promise.resolve().then(() => {
      loadTests();
      loadTelemetry();
    });

    autoRef.current = setInterval(async () => {
      try {
        const r = await API.get("/tests", { timeout: 15000 });
        const all = r.data || [];
        setTests(all);
        const running = all.find((t) => t.status === "running");
        if (running && !runningTestId) {
          setRunningTestId(running.id);
          const rr = await API.get(`/latest-run/${running.id}`);
          if (rr.data?.run_id) {
            setActiveRunId(rr.data.run_id);
            pollForResult(running.id, rr.data.run_id);
          }
        }
      } catch { /* ignore */ }
    }, 10000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (autoRef.current) clearInterval(autoRef.current);
    };
  }, [loadTests, loadTelemetry, pollForResult, runningTestId]);

  /* ── run ──────────────────────────────────────────────────── */
  const runTest = async (testId) => {
    setRunningTestId(testId);
    setOutput("");
    setTelemetryHistory([]);
    setLiveMetrics({
      throughput: 0,
      avg_response_time: 0,
      min_response_time: 0,
      max_response_time: 0,
      p90: 0,
      p95: 0,
      error_rate: 0,
      total_requests: 0,
      failed_requests: 0,
      passed_checks: 0,
      active_vus: 1,
      status: "running",
    });
    setTests((p) => p.map((t) => t.id === testId ? { ...t, status: "running" } : t));

    // Smooth scroll down to live telemetry studio
    setTimeout(() => {
      const el = document.getElementById("live-telemetry-studio");
      if (el) el.scrollIntoView({ behavior: "smooth" });
    }, 100);

    try {
      const res   = await API.post(`/run-test/${testId}`);
      const runId = res.data.run_id;
      setActiveRunId(runId);
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
    if (!window.confirm("Stop this running test immediately?")) return;
    setStoppingId(testId);
    try {
      await API.post(`/stop-test/${testId}`);
      toast.info("Stopping test…");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to stop test");
    } finally {
      setStoppingId(null);
    }
  };

  /* ── delete ───────────────────────────────────────────────── */
  const deleteTest = async (testId) => {
    if (!window.confirm(`Delete test #${testId}? This action cannot be undone.`)) return;
    setDeletingId(testId);
    try {
      await API.delete(`/delete-test/${testId}`);
      toast.success("Test deleted successfully");
      setTests((p) => p.filter((t) => t.id !== testId));
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to delete test");
    } finally {
      setDeletingId(null);
    }
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(output);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Copied console output");
  };

  /* ── filter & sort ────────────────────────────────────────── */
  const filtered = useMemo(() => {
    return tests
      .filter((t) =>
        t.test_name?.toLowerCase().includes(search.toLowerCase()) ||
        String(t.id).includes(search) ||
        t.status?.toLowerCase().includes(search.toLowerCase())
      )
      .sort((a, b) => {
        let valA = a[sortBy];
        let valB = b[sortBy];

        if (sortBy === "id" || sortBy === "users" || sortBy === "duration") {
          valA = Number(valA || 0);
          valB = Number(valB || 0);
          return sortOrder === "asc" ? valA - valB : valB - valA;
        }

        if (sortBy === "created_at") {
          const dateA = new Date(valA || 0).getTime();
          const dateB = new Date(valB || 0).getTime();
          return sortOrder === "asc" ? dateA - dateB : dateB - dateA;
        }

        valA = String(valA || "").toLowerCase();
        valB = String(valB || "").toLowerCase();
        if (valA < valB) return sortOrder === "asc" ? -1 : 1;
        if (valA > valB) return sortOrder === "asc" ? 1 : -1;
        return 0;
      });
  }, [tests, search, sortBy, sortOrder]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage   = Math.min(page, totalPages);
  const paginated  = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  return (
    <Layout>
      <div className="run-test-page">

        {/* ── Page Header ── */}
        <div className="page-header">
          <div className="page-header-left">
            <div className="page-header-title">Run & Live Monitor</div>
            <div className="page-header-sub">
              Execute high-concurrency load tests, inspect live metrics, and view real-time latency graphs
            </div>
          </div>
          <div className="page-header-right">
            <div style={{
              display: "flex", alignItems: "center", gap: 7,
              background: "rgba(16, 185, 129, 0.08)", border: "1px solid rgba(16, 185, 129, 0.25)",
              borderRadius: "9999px", padding: "5px 12px",
              fontSize: 12, color: "#34d399", fontWeight: 600,
            }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
              Native k6 Telemetry: Active
            </div>
          </div>
        </div>

        {/* ── Search & Sorting Bar ── */}
        <div className="rt-table-toolbar">
          <div className="rt-search-wrap">
            <Search size={14} className="rt-search-icon" />
            <input
              type="text"
              className="rt-search-input"
              aria-label="Filter test scenarios"
              placeholder="Filter scenarios by name, ID, or status…"
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
          </div>

          <div className="rt-toolbar-actions">
            {/* Executive Sort Toolbar */}
            <div className="sort-toolbar-group">
              <span className="sort-toolbar-label">
                <ArrowUpDown size={12} /> Sort:
              </span>
              <div className="sort-select-box">
                <select
                  className="sort-select-input"
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                >
                  <option value="created_at">Date Created</option>
                  <option value="test_name">Scenario Name</option>
                  <option value="users">Virtual Users (VUs)</option>
                  <option value="duration">Duration</option>
                  <option value="status">Execution Status</option>
                  <option value="id">Scenario ID</option>
                </select>
              </div>
              <button
                type="button"
                className="sort-dir-btn"
                title={`Order: ${sortOrder === "asc" ? "Ascending" : "Descending"} (Click to flip)`}
                onClick={() => setSortOrder(prev => prev === "asc" ? "desc" : "asc")}
              >
                {sortOrder === "asc" ? <><ArrowUp size={11} /> ASC</> : <><ArrowDown size={11} /> DESC</>}
              </button>
            </div>

            <button className="btn btn-ghost btn-sm" onClick={() => loadTests()}>
              <RefreshCw size={13} /> Refresh
            </button>
            <button className="btn btn-primary btn-sm" onClick={() => navigate("/createtest")}>
              <Plus size={13} /> New Scenario
            </button>
          </div>
        </div>

        {/* ── Test scenarios table ── */}
        <div className="rt-table-wrap">
          <div className="rt-table-top">
            <div className="rt-table-top-left">
              <span className="rt-table-top-title">Test Scenarios Catalog</span>
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
                    <th className="sortable" onClick={() => handleSort("id")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        ID {sortBy === "id" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("test_name")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Scenario Name {sortBy === "test_name" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("users")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Workload {sortBy === "users" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("duration")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Duration {sortBy === "duration" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("status")}>
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        Status {sortBy === "status" ? (sortOrder === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />) : <ArrowUpDown size={11} style={{ opacity: 0.4 }} />}
                      </div>
                    </th>
                    <th className="sortable" onClick={() => handleSort("created_at")}>
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
                              ? "No results match your search filter."
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

        {/* ═══════════════════════════════════════════════════════════
            NATIVE LIVE METRICS TELEMETRY STUDIO (Zero InfluxDB / Grafana error)
            ═══════════════════════════════════════════════════════════ */}
        <div id="live-telemetry-studio" className="rt-telemetry-studio">
          <div className="rt-telemetry-hdr">
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{
                color: runningTestId ? "#10b981" : "#818cf8",
                display: "flex", alignItems: "center",
              }}>
                {runningTestId ? (
                  <Activity size={20} className="pulse-anim" />
                ) : (
                  <Gauge size={20} />
                )}
              </div>
              <div>
                <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                  Live Telemetry & Metrics Console
                  {runningTestId ? (
                    <span style={{
                      fontSize: 11, background: "rgba(16,185,129,0.15)", color: "#34d399",
                      padding: "3px 9px", borderRadius: 12, fontWeight: 700, letterSpacing: "0.04em",
                    }}>
                      ● LIVE STREAMING
                    </span>
                  ) : lastDashboardRunId ? (
                    <span style={{
                      fontSize: 11, background: "rgba(99,102,241,0.15)", color: "#a5b4fc",
                      padding: "3px 9px", borderRadius: 12, fontWeight: 600,
                    }}>
                      RUN #{lastDashboardRunId} RESULTS
                    </span>
                  ) : (
                    <span style={{
                      fontSize: 11, background: "rgba(148,163,184,0.12)", color: "#94a3b8",
                      padding: "3px 9px", borderRadius: 12, fontWeight: 600,
                    }}>
                      STANDBY
                    </span>
                  )}
                </h3>
                <p style={{ margin: "2px 0 0 0", fontSize: 12, color: "var(--tx2)" }}>
                  {runningTestId
                    ? `Active Load Run #${activeRunId || "—"} · Live metrics updating every second`
                    : lastDashboardRunId
                      ? `Execution summary for Run #${lastDashboardRunId} · Standalone metrics cached`
                      : "Native k6 Telemetry Engine ready · Direct execution metrics without external dependencies"}
                </p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              {runningTestId && (
                <button
                  className="btn btn-danger btn-sm"
                  onClick={() => stopTest(runningTestId)}
                >
                  <Square size={13} /> Stop Execution
                </button>
              )}

              {(lastDashboardRunId || activeRunId) && (
                <>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() =>
                      window.open(
                        API.getUri({
                          url: `/dashboard-report/${lastDashboardRunId || activeRunId}`,
                        }),
                        "_blank",
                        "noopener,noreferrer"
                      )
                    }
                    title="Open standalone HTML performance report"
                  >
                    <ExternalLink size={13} /> HTML Report
                  </button>
                  <button
                    className="btn btn-outline btn-sm"
                    onClick={() => navigate(`/report/${lastDashboardRunId || activeRunId}`)}
                    title="View detailed summary and charts"
                  >
                    <FileText size={13} /> View Metrics
                  </button>
                </>
              )}

              {telemetry.grafana_online && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setActiveTab(activeTab === "metrics" ? "grafana" : "metrics")}
                  title="Switch between Native Metrics and Grafana"
                >
                  <BarChart3 size={13} /> {activeTab === "grafana" ? "Native View" : "Grafana View"}
                </button>
              )}
            </div>
          </div>

          <div className="rt-telemetry-body">
            {/* If Grafana tab is manually chosen and Grafana is online */}
            {activeTab === "grafana" && telemetry.grafana_online ? (
              <div style={{ marginBottom: 16 }}>
                <iframe
                  src={`http://localhost:3000/d/adfqsh7/k6-load-testing-results?var-run_id=${activeRunId || lastDashboardRunId || ""}&refresh=5s&kiosk=tv`}
                  width="100%"
                  height="500px"
                  style={{ border: "none", borderRadius: 8 }}
                  title="Grafana Dashboard"
                />
              </div>
            ) : (
              /* NATIVE METRICS VIEW */
              <>
                {/* ── 8 High-Impact KPI Metric Cards ── */}
                <div className="rt-telemetry-grid">
                  {/* Card 1: Throughput */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">Throughput</span>
                      <div className="rt-metric-card-icon mc-emerald">
                        <Zap size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val" style={{ color: "#34d399" }}>
                      {liveMetrics.throughput.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 500 }}>/s</span>
                    </div>
                    <div className="rt-metric-card-sub">
                      {runningTestId ? (
                        <span style={{ color: "#34d399", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#10b981", animation: "blink 1.4s infinite" }} />
                          Live requests/sec
                        </span>
                      ) : (
                        <span>Mean request rate</span>
                      )}
                    </div>
                  </div>

                  {/* Card 2: Concurrency */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">Virtual Users</span>
                      <div className="rt-metric-card-icon mc-cyan">
                        <Users size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val" style={{ color: "#38bdf8" }}>
                      {liveMetrics.active_vus} <span style={{ fontSize: 13, fontWeight: 500 }}>VUs</span>
                    </div>
                    <div className="rt-metric-card-sub">
                      <span>Simulated user concurrency</span>
                    </div>
                  </div>

                  {/* Card 3: Avg Response Time */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">Avg Latency</span>
                      <div className="rt-metric-card-icon mc-indigo">
                        <Clock size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val" style={{ color: "#818cf8" }}>
                      {liveMetrics.avg_response_time.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 500 }}>ms</span>
                    </div>
                    <div className="rt-metric-card-sub">
                      <span>Mean roundtrip response</span>
                    </div>
                  </div>

                  {/* Card 4: P95 Tail Latency */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">P95 / P90 SLA</span>
                      <div className="rt-metric-card-icon mc-purple">
                        <TrendingUp size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val" style={{ color: "#c084fc" }}>
                      {liveMetrics.p95.toFixed(1)} <span style={{ fontSize: 13, fontWeight: 500 }}>ms</span>
                    </div>
                    <div className="rt-metric-card-sub">
                      <span>P90: {liveMetrics.p90.toFixed(1)} ms</span>
                    </div>
                  </div>

                  {/* Card 5: Total Transactions */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">Total Requests</span>
                      <div className="rt-metric-card-icon mc-amber">
                        <BarChart3 size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val">
                      {liveMetrics.total_requests.toLocaleString()}
                    </div>
                    <div className="rt-metric-card-sub">
                      <span>Processed HTTP transactions</span>
                    </div>
                  </div>

                  {/* Card 6: Error Rate */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">Error Rate</span>
                      <div className="rt-metric-card-icon mc-rose">
                        <AlertTriangle size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val" style={{ color: liveMetrics.error_rate > 0 ? "#fb7185" : "#34d399" }}>
                      {liveMetrics.error_rate.toFixed(1)}%
                    </div>
                    <div className="rt-metric-card-sub">
                      <span>{liveMetrics.failed_requests} failed requests</span>
                    </div>
                  </div>

                  {/* Card 7: Passed Checks */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">Checks Pass Rate</span>
                      <div className="rt-metric-card-icon mc-emerald">
                        <CheckCircle2 size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val" style={{ color: "#34d399" }}>
                      {liveMetrics.total_requests > 0
                        ? `${Math.max(0, 100 - liveMetrics.error_rate).toFixed(1)}%`
                        : "100%"}
                    </div>
                    <div className="rt-metric-card-sub">
                      <span>✓ {liveMetrics.passed_checks} passed assertions</span>
                    </div>
                  </div>

                  {/* Card 8: Engine Health */}
                  <div className="rt-metric-card">
                    <div className="rt-metric-card-top">
                      <span className="rt-metric-card-label">Execution Status</span>
                      <div className="rt-metric-card-icon mc-cyan">
                        <ShieldCheck size={16} />
                      </div>
                    </div>
                    <div className="rt-metric-card-val" style={{ fontSize: 18, textTransform: "uppercase" }}>
                      <span className={statusBadge(liveMetrics.status)}>
                        {liveMetrics.status}
                      </span>
                    </div>
                    <div className="rt-metric-card-sub">
                      <span>k6 telemetry engine</span>
                    </div>
                  </div>
                </div>

                {/* ── Real-Time Dynamic Telemetry Trend Graph ── */}
                <div className="rt-chart-box">
                  <div className="rt-chart-box-hdr">
                    <h4>
                      <TrendingUp size={16} color="var(--brand-l)" />
                      Real-Time Throughput & Latency Dynamics
                    </h4>
                    <div className="rt-chart-legend-box">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#34d399" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                        RPS (req/s)
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, color: "#818cf8" }}>
                        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#6366f1", boxShadow: "0 0 6px #6366f1" }} />
                        Latency (ms)
                      </div>
                      <span style={{
                        fontSize: 10, background: "rgba(255,255,255,0.06)", padding: "2px 8px",
                        borderRadius: 10, color: "var(--tx3)"
                      }}>
                        Live Resolution: 1.2s
                      </span>
                    </div>
                  </div>

                  <div style={{ width: "100%", height: 240 }}>
                    {telemetryHistory.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={telemetryHistory} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                          <defs>
                            <linearGradient id="rpsGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/>
                              <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                            </linearGradient>
                            <linearGradient id="latGrad" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="5%" stopColor="#6366f1" stopOpacity={0.35}/>
                              <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0}/>
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                          <XAxis dataKey="time" tick={{ fill: "#64748b", fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis yAxisId="left" tick={{ fill: "#34d399", fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis yAxisId="right" orientation="right" tick={{ fill: "#818cf8", fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip content={<CustomChartTooltip />} />
                          <Area
                            yAxisId="left"
                            type="monotone"
                            dataKey="rps"
                            name="Throughput"
                            stroke="#10b981"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#rpsGrad)"
                          />
                          <Area
                            yAxisId="right"
                            type="monotone"
                            dataKey="latency"
                            name="Avg Latency"
                            stroke="#6366f1"
                            strokeWidth={2}
                            fillOpacity={1}
                            fill="url(#latGrad)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div style={{
                        height: "100%", display: "flex", flexDirection: "column",
                        alignItems: "center", justifyContent: "center", color: "var(--tx3)", fontSize: 13, gap: 8,
                      }}>
                        <Activity size={28} style={{ opacity: 0.3 }} />
                        <span>Ready to capture live telemetry. Click <strong>Run Now</strong> on any scenario to plot real-time metrics.</span>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>

        {/* ── Terminal Output Console ── */}
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
