import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "react-toastify";
import {
  FileText, Activity, CheckCircle, Clock,
  Plus, TrendingUp, ChevronRight, Pencil,
  PlayCircle, BarChart3, Zap,
  ShieldCheck, Loader2
} from "lucide-react";
import API from "../services/api";
import Layout from "../components/Layout";
import ExecutionChart from "./ExecutionChart";
import "./Dashboard.css";

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

export default function Dashboard() {
  const navigate  = useNavigate();
  const fullName  = localStorage.getItem("full_name") || "Performance Tester";

  const [stats,     setStats]     = useState({ total_tests: 0, total_runs: 0, success_rate: 0, running_runs: 0 });
  const [recent,    setRecent]    = useState([]);
  const [telemetry, setTelemetry] = useState({
    grafana_online: false,
    influxdb_online: false,
  });
  const [loading, setLoading] = useState(true);
  const [triggeringId, setTriggeringId] = useState(null);
  const isMountedRef = useRef(false);

  const refresh = useCallback(() => {
    Promise.all([
      API.get("/dashboard-stats"),
      API.get("/recent-tests"),
      API.get("/telemetry-status").catch(() => ({ data: {} })),
    ])
      .then(([statsResponse, recentResponse, telemetryResponse]) => {
        if (!isMountedRef.current) return;
        setStats(statsResponse.data || {});
        setRecent(recentResponse.data || []);
        if (telemetryResponse.data) setTelemetry(telemetryResponse.data);
      })
      .catch((error) => {
        if (isMountedRef.current) console.error(error);
      })
      .finally(() => {
        if (isMountedRef.current) setLoading(false);
      });
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    refresh();
    const intervalId = setInterval(refresh, 15000);
    return () => {
      isMountedRef.current = false;
      clearInterval(intervalId);
    };
  }, [refresh]);

  const handleRunNow = async (testId) => {
    setTriggeringId(testId);
    try {
      await API.post(`/run-test/${testId}`);
      toast.success(`Test #${testId} launched! Redirecting to live console…`);
      navigate("/run-test");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Failed to start test");
      setTriggeringId(null);
    }
  };

  const successRate = parseFloat(stats.success_rate || 0);
  const runningTest = recent.find((t) => t.status === "running") || null;

  return (
    <Layout>
      <div className="dashboard-page">

      {/* ═══════════════════════════════════════════════════
          ACTIVE WORKLOAD BANNER (when a test is running)
          ═══════════════════════════════════════════════════ */}
      {(stats.running_runs > 0 || runningTest) && (
        <div className="dash-live-banner">
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div style={{
              width: 10, height: 10, borderRadius: "50%",
              background: "#10b981", boxShadow: "0 0 10px #10b981",
              animation: "blink 1.2s infinite"
            }} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: "var(--tx)", display: "flex", alignItems: "center", gap: 8 }}>
                <span>Active Workload Running: {runningTest?.test_name || "Load Scenario"}</span>
                <span className="badge badge-running">LIVE</span>
              </div>
              <div style={{ fontSize: 12, color: "var(--tx2)", marginTop: 2 }}>
                Simulating high concurrency virtual users with sub-millisecond metrics
              </div>
            </div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate("/run-test")}>
            <Activity size={13} /> Open Live Telemetry Console →
          </button>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════
          HERO WELCOME SECTION
          ═══════════════════════════════════════════════════ */}
      <div className="dash-hero">
        <div className="dash-hero-top">
          <div className="dash-hero-greeting">
            <div className="dash-eyebrow">PERFORMANCE OVERVIEW</div>
            <h1>Welcome back, {fullName}</h1>
            <p>
              Monitor your load-test scenarios, review execution trends, and launch your next performance test.
            </p>
          </div>
          <div className="dash-hero-actions">
            <button className="btn btn-outline" onClick={() => navigate("/run-test")}>
              <PlayCircle size={14} /> Run Test Suite
            </button>
            <button className="btn btn-primary" onClick={() => navigate("/createtest")}>
              <Plus size={14} /> New Test Scenario
            </button>
          </div>
        </div>

        {/* ── Native Telemetry status pills row ── */}
        <div className="dash-status-row">
          {/* k6 Engine */}
          <div className="dash-status-pill dash-status-ready">
            <span className="dash-status-dot" />
            k6 Engine Ready
          </div>

          {/* Native Live Metrics */}
          <div className="dash-status-pill dash-status-telemetry">
            <Zap size={11} />
            Native Telemetry
          </div>

          {/* SLA Tracking */}
          <div className="dash-status-pill dash-status-sla">
            <ShieldCheck size={11} />
            SLA Checks
          </div>

          {/* Grafana (if online) */}
          {telemetry.grafana_online && (
            <div className="dash-status-pill dash-status-ready">
              <span className="dash-status-dot" />
              Grafana Online
            </div>
          )}

          {/* Refresh button */}
          <button
            onClick={refresh}
            className="dash-refresh-btn"
            title="Refresh dashboard stats"
          >
            <BarChart3 size={12} /> Refresh
          </button>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          STAT CARDS  (Enterprise Glass Cards)
          ═══════════════════════════════════════════════════ */}
      <div className="dash-stat-row">
        {/* Configured Tests */}
        <div className="dash-stat">
          <div className="dash-stat-top">
            <div>
              <div className="dash-stat-label">Configured Tests</div>
              <div className="dash-stat-value">{stats.total_tests || 0}</div>
            </div>
            <div className="dash-stat-icon ds-blue">
              <FileText size={20} />
            </div>
          </div>
          <div className="dash-stat-sub">
            <span className="dash-catalog-state">Active catalog</span>
            <span>Scenarios available to run</span>
          </div>
        </div>

        {/* Total Executions */}
        <div className="dash-stat">
          <div className="dash-stat-top">
            <div>
              <div className="dash-stat-label">Total Executions</div>
              <div className="dash-stat-value">{stats.total_runs || 0}</div>
            </div>
            <div className="dash-stat-icon ds-cyan">
              <Activity size={20} />
            </div>
          </div>
          <div className="dash-stat-sub">
            <span>Captured in native telemetry store</span>
          </div>
        </div>

        {/* Overall Success Rate */}
        <div className="dash-stat">
          <div className="dash-stat-top">
            <div>
              <div className="dash-stat-label">Run Success Rate</div>
              <div className="dash-stat-value">{successRate.toFixed(1)}%</div>
            </div>
            <div className="dash-stat-icon ds-green">
              <CheckCircle size={20} />
            </div>
          </div>
          <div className="dash-stat-progress">
            <div className="dash-stat-progress-fill" style={{ width: `${Math.min(successRate, 100)}%` }} />
          </div>
          <div className="dash-stat-sub" style={{ marginTop: 2 }}>
            <span>Completed executions that passed</span>
          </div>
        </div>

        {/* Active Executions */}
        <div className="dash-stat">
          <div className="dash-stat-top">
            <div>
              <div className="dash-stat-label">Active Runners</div>
              <div className="dash-stat-value">{stats.running_runs || 0}</div>
            </div>
            <div className="dash-stat-icon ds-amber">
              <Clock size={20} />
            </div>
          </div>
          <div className="dash-stat-sub">
            <span>{stats.running_runs > 0 ? "Workloads currently executing" : "No active workloads"}</span>
          </div>
        </div>
      </div>

      {/* ═══════════════════════════════════════════════════
          BODY: Chart + Recent Table
          ═══════════════════════════════════════════════════ */}
      <div className="dash-body">

        {/* Execution Trend Chart */}
        <div className="dash-chart-card">
          <div className="dash-chart-hdr">
            <div className="dash-chart-hdr-left">
              <h3><TrendingUp size={17} color="var(--brand-l)" /> Execution outcomes</h3>
              <p>Cumulative completed and failed runs across your execution history</p>
            </div>
            <div className="dash-chart-legend">
              <div className="dash-chart-legend-item">
                <span className="legend-dot" style={{ background: "#f43f5e", boxShadow: "0 0 6px #f43f5e" }} />
                Failed Runs
              </div>
              <div className="dash-chart-legend-item">
                <span className="legend-dot" style={{ background: "#10b981", boxShadow: "0 0 6px #10b981" }} />
                Passed Runs
              </div>
            </div>
          </div>
          <ExecutionChart />
        </div>

        {/* Recent Test Scenarios */}
        <div className="dash-table-card">
          <div className="dash-table-hdr">
            <div>
              <h3>Recent Test Scenarios</h3>
              <p>Quick access to your latest performance test configurations</p>
            </div>
            <button className="dash-view-all" onClick={() => navigate("/run-test")}>
              View All Tests <ChevronRight size={13} />
            </button>
          </div>

          {loading ? (
            <div className="loading-box" style={{ padding: "40px" }}>
              <div className="spinner" style={{ width: 22, height: 22, border: "2px solid var(--border)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block" }} />
            </div>
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Scenario Name</th>
                  <th>Workload</th>
                  <th>Duration</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th style={{ textAlign: "center" }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {recent.length > 0 ? recent.map((t) => (
                  <tr key={t.id}>
                    <td style={{ color: "var(--tx3)", fontSize: 12 }}>#{t.id}</td>
                    <td style={{ fontWeight: 600 }}>{t.test_name}</td>
                    <td><span className="vu-chip">{t.users} VUs</span></td>
                    <td style={{ color: "var(--tx2)" }}>{t.duration}s</td>
                    <td><span className={statusBadge(t.status)}>{t.status}</span></td>
                    <td style={{ color: "var(--tx3)", fontSize: 12 }}>
                      {new Date(t.created_at).toLocaleDateString("en-GB", {
                        day: "2-digit", month: "short", year: "numeric",
                      })}
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <div style={{ display: "flex", gap: 6, justifyContent: "center" }}>
                        <button
                          className="btn-run-now"
                          disabled={triggeringId === t.id}
                          onClick={() => handleRunNow(t.id)}
                        >
                          {triggeringId === t.id ? (
                            <><Loader2 size={13} className="spinner" /> Launching…</>
                          ) : (
                            <><PlayCircle size={13} /> Run Now</>
                          )}
                        </button>
                        <button
                          className="btn btn-ghost btn-icon btn-sm"
                          title="Edit"
                          onClick={() => navigate(`/createtest/${t.id}`)}
                        >
                          <Pencil size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )) : (
                  <tr>
                    <td colSpan={7}>
                      <div className="dash-empty-state">
                        <div className="dash-empty-icon"><FileText size={18} /></div>
                        <strong>No test scenarios yet</strong>
                        <span>Create a scenario to start running performance tests.</span>
                        <button className="btn btn-primary btn-sm" onClick={() => navigate("/createtest")}>
                          <Plus size={13} /> Create a scenario
                        </button>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>

      </div>
      </div>
    </Layout>
  );
}
