import { useEffect, useRef, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import API from "../services/api";
import {
  FileText, BarChart3, Download, ArrowLeft,
  CheckCircle, AlertCircle, ExternalLink, Copy, Check, Loader2,
} from "lucide-react";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, PieChart, Pie, Legend,
} from "recharts";
import Layout from "../components/Layout";
import { toast } from "react-toastify";
import "./Report.css";

const ReportChartTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;

  const point = payload[0].payload;
  return (
    <div className="rpt-chart-tooltip">
      <strong>{label || point.name}</strong>
      <span>{Number(point.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}{point.unit}</span>
    </div>
  );
};

export default function Report() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const [reportState, setReportState] = useState({ id: null, retry: null, report: null, error: "" });
  const [retry,      setRetry]      = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [copied,      setCopied]    = useState(false);
  const metricsScrolled = useRef(false);
  const reportIsCurrent = reportState.id === id && reportState.retry === retry;
  const report = reportIsCurrent ? reportState.report : null;
  const loadError = reportIsCurrent ? reportState.error : "";

  useEffect(() => {
    let active = true;
    let pollTimeout;
    metricsScrolled.current = false;

    const loadReport = async () => {
      try {
        const { data } = await API.get(`/report/${id}`);
        if (!active) return;

        setReportState({ id, retry, report: data, error: "" });
        if (data.status === "running" || data.status === "stopping") {
          pollTimeout = setTimeout(loadReport, 1200);
        }
      } catch (err) {
        if (active) {
          const message = err.response?.data?.detail || "Could not load this execution report.";
          setReportState({ id, retry, report: null, error: message });
          toast.error(message);
        }
      }
    };

    loadReport();
    return () => {
      active = false;
      clearTimeout(pollTimeout);
    };
  }, [id, retry]);

  useEffect(() => {
    if (!report || window.location.hash !== "#metrics" || metricsScrolled.current) return;
    const frame = window.requestAnimationFrame(() => {
      document.getElementById("metrics")?.scrollIntoView({ behavior: "smooth", block: "start" });
      metricsScrolled.current = true;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [report]);

  const downloadPDF = async () => {
    setDownloading(true);
    try {
      const r = await API.get(`/download-report/${id}`, { responseType:"blob" });
      const url = window.URL.createObjectURL(new Blob([r.data], { type:"application/pdf" }));
      const a = document.createElement("a");
      a.href = url; a.download = `${report?.test_name||"test"}_run_${id}.pdf`;
      document.body.appendChild(a); a.click(); a.remove();
      window.URL.revokeObjectURL(url);
      toast.success("PDF downloaded");
    } catch { toast.error("Download failed"); }
    finally { setDownloading(false); }
  };

  const copyOutput = () => {
    navigator.clipboard.writeText(report?.output || "");
    setCopied(true); setTimeout(() => setCopied(false), 2000);
    toast.success("Copied");
  };

  if (!report && loadError) return (
    <Layout>
      <div className="rpt-load-error" role="alert">
        <h2>Unable to load execution results</h2>
        <p>{loadError}</p>
        <div className="rpt-load-actions">
          <button className="btn btn-ghost" onClick={() => navigate("/history")}>
            <ArrowLeft size={14} /> Back to History
          </button>
          <button className="btn btn-primary" onClick={() => setRetry((value) => value + 1)}>
            Try again
          </button>
        </div>
      </div>
    </Layout>
  );

  if (!report) return (
    <Layout>
      <div className="loading-box" style={{ paddingTop:80 }}>
        <Loader2 size={32} className="spinner" />
        <p>Loading report #{id}…</p>
      </div>
    </Layout>
  );

  const isPassed = report.status === "completed" || report.status === "passed";

  const kpis = [
    { label:"Throughput",    value: report.throughput,        unit:"req/s" },
    { label:"Avg Response",  value: report.avg_response_time, unit:"ms" },
    { label:"P90 Latency",   value: report.p90,               unit:"ms" },
    { label:"P95 Latency",   value: report.p95,               unit:"ms" },
    { label:"Total Requests",value: report.total_requests,    unit:"" },
    { label:"Error Rate",    value: `${report.error_rate}`,   unit:"%", warn: report.error_rate > 0 },
  ];

  const metrics = [
    ["Total HTTP Requests",          report.total_requests || 0,    ""],
    ["Passed Checks / Assertions",   report.passed_checks  || 0,    ""],
    ["Failed Requests",              report.failed_requests|| 0,    ""],
    ["Throughput",                   report.throughput,              "req/s"],
    ["Min Response Time",            report.min_response_time|| 0,  "ms"],
    ["Avg Response Time",            report.avg_response_time,       "ms"],
    ["P90 Latency",                  report.p90,                     "ms"],
    ["P95 Latency",                  report.p95,                     "ms"],
    ["Max Response Time",            report.max_response_time|| 0,  "ms"],
    ["Error Rate",                   `${report.error_rate}%`,        ""],
  ];
  const latencyData = [
    { metric: "Min", value: Number(report.min_response_time) || 0, color: "#38bdf8", unit: " ms" },
    { metric: "Average", value: Number(report.avg_response_time) || 0, color: "#818cf8", unit: " ms" },
    { metric: "P90", value: Number(report.p90) || 0, color: "#a78bfa", unit: " ms" },
    { metric: "P95", value: Number(report.p95) || 0, color: "#c084fc", unit: " ms" },
    { metric: "Max", value: Number(report.max_response_time) || 0, color: "#fb7185", unit: " ms" },
  ];
  const errorRate = Math.min(100, Math.max(0, Number(report.error_rate) || 0));
  const requestOutcomes = [
    { name: "Successful", value: 100 - errorRate, color: "#10b981", unit: "%" },
    { name: "Errors", value: errorRate, color: "#f43f5e", unit: "%" },
  ];
  const hasLatencyData = latencyData.some(({ value }) => value > 0);
  const hasRequestData = Number(report.total_requests) > 0;

  return (
    <Layout>
      {/* Topbar */}
      <div className="rpt-topbar">
        <button className="rpt-back" onClick={() => navigate("/history")}>
          <ArrowLeft size={15} /> History
        </button>
        <div className="rpt-title-row">
          <div>
            <div className="rpt-title"><FileText size={18} /> {report.test_name} · Execution #{id}</div>
            <div className="rpt-sub">Generated at {report.started_at ? new Date(report.started_at).toLocaleString() : "—"}</div>
          </div>
        </div>
        <div className="rpt-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => window.open(API.getUri({ url: `/dashboard-report/${id}` }), "_blank", "noopener,noreferrer")}>
            <ExternalLink size={13} /> Live Dashboard
          </button>
          <button className="btn btn-primary btn-sm" onClick={downloadPDF} disabled={downloading}>
            <Download size={13} /> {downloading ? "Downloading…" : "Download PDF"}
          </button>
        </div>
      </div>

      <div className="rpt-body">
        {/* Verdict */}
        <div className={`verdict-card ${isPassed ? "verdict-pass" : "verdict-fail"}`}>
          <div className="verdict-left">
            {isPassed ? <CheckCircle size={26} /> : <AlertCircle size={26} />}
            <div>
              <h3>{isPassed ? "Test Execution Passed" : "Execution Completed with SLA Violations"}</h3>
              <p>Status: <strong>{report.status?.toUpperCase()}</strong> · Requests: <strong>{report.total_requests}</strong> · Error Rate: <strong>{report.error_rate}%</strong></p>
            </div>
          </div>
          <span className={`badge ${isPassed ? "badge-completed" : "badge-failed"}`}>{report.status}</span>
        </div>

        {/* KPI cards */}
        <div className="rpt-kpis">
          {kpis.map(({ label, value, unit, warn }) => (
            <div className={`rpt-kpi-card${warn ? " warn" : ""}`} key={label}>
              <div className="rpt-kpi-label">{label}</div>
              <div className="rpt-kpi-value">{value}</div>
              {unit && <div className="rpt-kpi-unit">{unit}</div>}
            </div>
          ))}
        </div>

        {/* Per-run visualizations */}
        <section id="metrics" className="rpt-chart-section" aria-label="Result visualizations">
          <div className="rpt-chart-section-header">
            <h3><BarChart3 size={17} aria-hidden="true" /> Result visualizations</h3>
            {(report.status === "running" || report.status === "stopping") && (
              <span className="rpt-live-indicator">Updating live</span>
            )}
          </div>
          <div className="rpt-chart-grid">
            <div className="rpt-chart-card">
              <div className="rpt-chart-card-header">
                <h4>Response time distribution</h4>
                <span>Milliseconds</span>
              </div>
              {hasLatencyData ? (
                <div className="rpt-chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={latencyData} margin={{ top: 8, right: 12, left: -12, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                      <XAxis dataKey="metric" tick={{ fill: "var(--tx3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: "var(--tx3)", fontSize: 11 }} axisLine={false} tickLine={false} />
                      <Tooltip content={<ReportChartTooltip />} />
                      <Bar dataKey="value" name="Response time" radius={[4, 4, 0, 0]}>
                        {latencyData.map((entry) => <Cell key={entry.metric} fill={entry.color} />)}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="rpt-chart-empty">Latency data will appear when requests have been recorded.</div>
              )}
            </div>

            <div className="rpt-chart-card">
              <div className="rpt-chart-card-header">
                <h4>Request success vs. error rate</h4>
                <span>Based on reported error rate</span>
              </div>
              {hasRequestData ? (
                <div className="rpt-chart-canvas">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={requestOutcomes}
                        dataKey="value"
                        nameKey="name"
                        innerRadius="55%"
                        outerRadius="78%"
                        paddingAngle={errorRate > 0 ? 3 : 0}
                      >
                        {requestOutcomes.map((entry) => <Cell key={entry.name} fill={entry.color} />)}
                      </Pie>
                      <Tooltip content={<ReportChartTooltip />} />
                      <Legend verticalAlign="bottom" height={28} iconType="circle" />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="rpt-chart-empty">Request outcome data will appear when requests have been recorded.</div>
              )}
            </div>
          </div>
        </section>

        {/* Aggregate metrics table */}
        <div className="rpt-metrics-card">
          <div className="rpt-metrics-header"><BarChart3 size={17} /> Aggregate Metrics Breakdown</div>
          <table className="data-table">
            <thead>
              <tr>
                <th>Performance Metric</th>
                <th style={{ textAlign:"right" }}>Measured Value</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map(([label, value, unit]) => (
                <tr key={label}>
                  <td style={{ color:"var(--tx2)" }}>{label}</td>
                  <td style={{ textAlign:"right", fontWeight:600, color:"var(--tx)" }}>
                    {value} {unit && <span style={{ color:"var(--tx3)", fontWeight:400, fontSize:11 }}>{unit}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Terminal output */}
        {report.output && (
          <div className="rpt-output-card">
            <div className="rpt-output-header">
              <span className="rpt-output-title">Execution Output & k6 Summary</span>
              <button className="btn btn-ghost btn-sm" onClick={copyOutput}>
                {copied ? <Check size={13} /> : <Copy size={13} />}
                {copied ? "Copied" : "Copy Output"}
              </button>
            </div>
            <pre className="terminal" style={{ margin:0, borderRadius:0, border:"none", maxHeight:500 }}>{report.output}</pre>
          </div>
        )}
      </div>
    </Layout>
  );
}
