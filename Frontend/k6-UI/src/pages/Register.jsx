import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import API from "../services/api";
import { toast } from "react-toastify";
import {
  Mail,
  Lock,
  User,
  Zap,
  Activity,
  Eye,
  EyeOff,
  CheckCircle2,
  TrendingUp,
  ShieldCheck,
  Cpu,
  UserPlus,
  ArrowRight,
} from "lucide-react";
import "./Login.css";
import "./Register.css";

export default function Register() {
  const navigate = useNavigate();
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    confirmPassword: "",
  });
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    setLoading(true);
    try {
      await API.post("/register", {
        full_name: form.fullName,
        email: form.email,
        password: form.password,
        confirm_password: form.confirmPassword,
      });
      toast.success("Account created successfully — please sign in");
      navigate("/");
    } catch (err) {
      toast.error(err.response?.data?.detail || "Registration failed");
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

      {/* ── Left branding panel ── */}
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
            <span>Developer-First Infrastructure</span>
          </div>
          <h1 className="auth-headline">
            Start load testing <br />
            <span className="auth-headline-gradient">in seconds.</span>
          </h1>
          <p className="auth-subtext">
            Zero complicated configuration. Import Swagger specifications, record user journeys,
            or run autonomous Playwright crawlers with instant Grafana dashboards.
          </p>
        </div>

        {/* ── Live Performance Metric Simulation Card ── */}
        <div className="auth-telemetry-card">
          <div className="telemetry-header">
            <div className="telemetry-pulse">
              <span className="pulse-dot" />
              <span className="telemetry-title">Cluster Ready • 100k Virtual Users Ready</span>
            </div>
            <span className="telemetry-badge">Ready</span>
          </div>
          <div className="telemetry-stats-grid">
            <div className="telemetry-stat">
              <span className="telemetry-stat-label"><TrendingUp size={12} /> Test Scalability</span>
              <span className="telemetry-stat-value">50,000+ <small>VUs</small></span>
            </div>
            <div className="telemetry-stat">
              <span className="telemetry-stat-label"><Cpu size={12} /> Telemetry Latency</span>
              <span className="telemetry-stat-value accent-green">&lt; 1 <small>sec</small></span>
            </div>
            <div className="telemetry-stat">
              <span className="telemetry-stat-label"><ShieldCheck size={12} /> Script Parity</span>
              <span className="telemetry-stat-value accent-indigo">100% k6</span>
            </div>
          </div>
        </div>

        {/* ── Features List ── */}
        <div className="auth-features">
          {[
            "Instant access to full HTTP(S) proxy script recording",
            "Auto API discovery for public & login-protected pages",
            "Complete JMeter HTTP Cookie and Cache Manager equivalence",
            "Real-time Grafana metric visualization & InfluxDB export",
            "Comprehensive SLA reports with assertion breakdown",
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
              <UserPlus size={13} /> New Account
            </div>
            <h2 className="auth-card-title">Create your account</h2>
            <p className="auth-card-sub">
              Join your team to build, execute, and analyze performance tests.
            </p>
          </div>

          <form className="auth-form" onSubmit={handleSubmit}>
            <div className="auth-field">
              <label className="auth-label" htmlFor="reg-name">
                Full Name
              </label>
              <div className="auth-input-row">
                <User size={16} className="auth-input-ico" />
                <input
                  id="reg-name"
                  className="auth-inp"
                  type="text"
                  name="fullName"
                  placeholder="Jane Smith"
                  value={form.fullName}
                  onChange={handleChange}
                  required
                  autoComplete="name"
                />
              </div>
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="reg-email">
                Work Email
              </label>
              <div className="auth-input-row">
                <Mail size={16} className="auth-input-ico" />
                <input
                  id="reg-email"
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
              <label className="auth-label" htmlFor="reg-pass">
                Password
              </label>
              <div className="auth-input-row">
                <Lock size={16} className="auth-input-ico" />
                <input
                  id="reg-pass"
                  className="auth-inp auth-inp-pass"
                  type={showPassword ? "text" : "password"}
                  name="password"
                  placeholder="Minimum 8 characters"
                  value={form.password}
                  onChange={handleChange}
                  required
                  minLength={8}
                  autoComplete="new-password"
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

            <div className="auth-field">
              <label className="auth-label" htmlFor="reg-confirm">
                Confirm Password
              </label>
              <div className="auth-input-row">
                <Lock size={16} className="auth-input-ico" />
                <input
                  id="reg-confirm"
                  className="auth-inp"
                  type={showPassword ? "text" : "password"}
                  name="confirmPassword"
                  placeholder="Re-enter your password"
                  value={form.confirmPassword}
                  onChange={handleChange}
                  required
                  autoComplete="new-password"
                />
              </div>
            </div>

            <button type="submit" className="auth-submit" disabled={loading}>
              {loading ? (
                <>
                  <span className="auth-spinner" />
                  <span>Creating account…</span>
                </>
              ) : (
                <>
                  <UserPlus size={16} className="auth-btn-icon" />
                  <span>Create Account</span>
                  <ArrowRight size={15} className="auth-btn-arrow" />
                </>
              )}
            </button>
          </form>

          <div className="auth-card-footer">
            <p className="auth-foot">
              Already have an account?{" "}
              <Link to="/" className="auth-link">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
