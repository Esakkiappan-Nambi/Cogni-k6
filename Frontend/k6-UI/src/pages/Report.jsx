import React, { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import API from "../services/api";
import {
  FileText, BarChart3, Download, ArrowLeft, Activity,
  CheckCircle, AlertCircle, ExternalLink, Copy, Check, Loader2,
} from "lucide-react";
import Layout from "../components/Layout";
import { toast } from "react-toastify";
import "./Report.css";

export default function Report() {
  const { id }   = useParams();
  const navigate = useNavigate();
  const [report,     setReport]     = useState(null);
  const [downloading, setDownloading] = useState(false);
  const [copied,      setCopied]    = useState(false);

  useEffect(() => { fetchReport(); }, [id]);

  const fetchReport = async () => {
    try { const r = await API.get(`/report/${id}`); setReport(r.data); }
    catch { toast.error("Failed to load report"); }
  };

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
            <div className="rpt-sub">Generated at {new Date(report.started_at || Date.now()).toLocaleString()}</div>
          </div>
        </div>
        <div className="rpt-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => window.open(`http://localhost:3000/d/adfqsh7/k6-load-testing-results?var-run_id=${id}`, "_blank")}>
            <ExternalLink size={13} /> Grafana
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
