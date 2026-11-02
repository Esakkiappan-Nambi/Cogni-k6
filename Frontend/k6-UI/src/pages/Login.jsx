import React, { useState } from "react";
import API from "../services/api";
import { toast } from "react-toastify";
import { Link, useNavigate } from "react-router-dom";
import {
  Mail,
  Lock,
  Zap,
  Activity,
  Eye,
  EyeOff,
  CheckCircle2,
  TrendingUp,
  Cpu,
  BarChart3,
  ShieldCheck,
  ArrowRight,
} from "lucide-react";
import "./Login.css";

export default function Login() {
  const navigate = useNavigate();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await API.post("/login", form);
      localStorage.clear();
      sessionStorage.setItem("token", res.data.access_token);
      if (res.data.full_name) localStorage.setItem("full_name", res.data.full_name);
      toast.success("Welcome back!");
      navigate("/dashboard");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Invalid credentials");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-wrap">
      {/* ── Background luminous elements ── */}
      <div className="auth-glow auth-glow-1" />
      <div className="auth-glow auth-glow-2" />
      <div className="auth-grid-pattern" />

      {/* ── Left branding & showcase panel ── */}
      <div className="auth-left">
        <div className="auth-logo">
          <div className="auth-logo-icon">
            <Zap size={22} className="auth-logo-svg" />
          </div>
          <div className="auth-logo-text">
            <span className="auth-logo-name">K6 <span className="auth-logo-highlight">PORTAL</span></span>
            <span className="auth-logo-tag">ENTERPRISE PERFORMANCE SUITE</span>
          </div>
        </div>

        <div className="auth-hero">
          <div className="auth-eyebrow">
            <Activity size={12} className="auth-eyebrow-icon" />
            <span>Production-Grade Load Testing</span>
          </div>
          <h1 className="auth-headline">
            Load test at <br />
            <span className="auth-headline-gradient">enterprise scale.</span>
          </h1>
          <p className="auth-subtext">
            JMeter-compatible script recorder, automated browser API capture,
            real-time InfluxDB telemetry and Grafana dashboards — engineered for modern engineering teams.
          </p>
        </div>

        {/* ── Live Performance Metric Simulation Card ── */}
        <div className="auth-telemetry-card">
          <div className="telemetry-header">
            <div className="telemetry-pulse">
              <span className="pulse-dot" />
              <span className="telemetry-title">Cluster Telemetry • Active Stream</span>
            </div>
            <span className="telemetry-badge">Grafana Live</span>
          </div>
          <div className="telemetry-stats-grid">
            <div className="telemetry-stat">
              <span className="telemetry-stat-label"><TrendingUp size={12} /> Peak Throughput</span>
              <span className="telemetry-stat-value">14,850 <small>req/s</small></span>
            </div>
            <div className="telemetry-stat">
              <span className="telemetry-stat-label"><Cpu size={12} /> Latency (P95)</span>
              <span className="telemetry-stat-value accent-green">28 <small>ms</small></span>
            </div>
            <div className="telemetry-stat">
              <span className="telemetry-stat-label"><ShieldCheck size={12} /> SLA Pass Rate</span>
              <span className="telemetry-stat-value accent-indigo">99.98%</span>
            </div>
          </div>
          <div className="telemetry-bar-wrap">
            <div className="telemetry-bar-labels">
              <span>SLA Target: &lt; 100ms</span>
              <span>100% Passed</span>
            </div>
            <div className="telemetry-bar-track">
              <div className="telemetry-bar-fill" style={{ width: "94%" }} />
            </div>
          </div>
        </div>

        {/* ── Features List ── */}
        <div className="auth-features">
          {[
            "HTTP(S) proxy recorder with persistent session history",
            "Auto API discovery with Playwright browser capture & authentication",
            "Real-time Grafana telemetry via InfluxDB v1/v2 pipelines",
            "JMeter parity: Cookie Manager, Cache Manager, UDVs & CSV loops",
            "Executive PDF SLA reports with automated compliance thresholds",
          ].map((f) => (
            <div className="auth-feat" key={f}>
              <div className="auth-feat-icon-wrap">
                <CheckCircle2 size={13} className="auth-feat-check" />
              </div>
              <span className="auth-feat-text">{f}</span>
            </div>
          ))}
        </div>

        <div className="auth-copyright">
          © {new Date().getFullYear()} K6 Portal Architecture. All rights reserved.
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="auth-right">
        <div className="auth-card">
          <div className="auth-card-header">
            <div className="auth-card-badge">
              <BarChart3 size={13} /> Secure Access
            </div>
            <h2 className="auth-card-title">Welcome back</h2>
            <p className="auth-card-sub">
              Enter your credentials to access your performance testing workspace.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="login-email">
                Email address
              </label>
              <div className="auth-input-row">
                <Mail size={16} className="auth-input-ico" />
                <input
                  id="login-email"
                  className="auth-inp"
                  type="email"
                  name="email"
                  placeholder="name@company.com"
                  value={form.email}
                  onChange={handleChange}
                  required
                  autoComplete="email"
                />
              </div>
            </div>

            <div className="auth-field">
              <div className="auth-label-row">
                <label className="auth-label" htmlFor="login-password">
                  Password
                </label>
                <span className="auth-forgot-hint">Encrypted SSL/TLS</span>
              </div>
              <div className="auth-input-row">
                <Lock size={16} className="auth-input-ico" />
                <input
                  id="login-password"
                  className="auth-inp auth-inp-pass"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="Enter your password"
                  value={form.password}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  className="auth-eye-btn"
                  onClick={() => setShowPassword(!showPassword)}
                  title={showPassword ? "Hide password" : "Show password"}
                  aria-label="Toggle password visibility"
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="auth-spinner" />
                  <span>Signing in…</span>
                </>
              ) : (
                <>
                  <Zap size={16} className="auth-btn-icon" />
                  <span>Sign In to Portal</span>
                  <ArrowRight size={15} className="auth-btn-arrow" />
                </>
              )}
            </button>
          </form>

          <div className="auth-card-footer">
            <p className="auth-foot">
              New to K6 Portal?{" "}
              <Link to="/register" className="auth-link">
                Create an account
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
