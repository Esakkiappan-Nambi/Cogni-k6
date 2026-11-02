import React, { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  LayoutDashboard, FilePlus2, PlayCircle,
  BarChart3, LogOut, Zap, Radio, Sun, Moon,
} from "lucide-react";
import { toast } from "react-toastify";
import API from "../services/api";

/* NAV definition matching screenshots exactly */
const NAV_SECTIONS = [
  {
    label: "MAIN NAVIGATION",
    items: [
      { text: "Dashboard",        icon: LayoutDashboard, path: "/dashboard"  },
      { text: "Scenario Studio",  icon: FilePlus2,       path: "/createtest", badge: "BUILDER" },
      { text: "HTTP Recorder",    icon: Radio,           path: "/recorder",   badge: "NEW" },
      { text: "Run & Monitor",    icon: PlayCircle,      path: "/run-test"   },
      { text: "Reports & History",icon: BarChart3,       path: "/history"    },
    ],
  },
];

export default function Sidebar() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const fullName  = localStorage.getItem("full_name") || "User";
  const initials  = fullName.split(" ").map((n) => n[0]).slice(0, 2).join("").toUpperCase();

  const [k6Info, setK6Info] = useState({
    version: "k6.exe v2.2.0",
    commit:  "commit/00a9a1b7f5",
    go:      "go 1.26.5, windows/amd64",
    path:    "C:\\Program Files\\k6\\k6.exe",
  });

  const [theme, setTheme] = useState(() => localStorage.getItem("k6_theme") || "dark");
  const [telemetry, setTelemetry] = useState({
    influxdb_online: false,
    grafana_online: false,
    k6_dashboard_online: true
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("k6_theme", theme);
  }, [theme]);

  useEffect(() => {
    API.get("/telemetry-status")
      .then((r) => setTelemetry(r.data || {}))
      .catch(() => {});
  }, []);

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  const handleLogout = () => {
    sessionStorage.clear();
    localStorage.clear();
    toast.success("Signed out");
    navigate("/");
  };

  const isActive = (path) => {
    if (path === "/createtest") return location.pathname.startsWith("/createtest");
    return location.pathname === path;
  };

  return (
    <aside className="sidebar">
      {/* ── Brand ── */}
      <div className="sb-brand" onClick={() => navigate("/dashboard")}>
        <div className="sb-brand-icon">
          <Zap size={18} color="#fff" />
        </div>
        <div className="sb-brand-text">
          <div className="sb-brand-name">K6 <span>Portal</span></div>
          <div className="sb-brand-sub">Enterprise Load Studio</div>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="sb-nav">
        {NAV_SECTIONS.map(({ label, items }) => (
          <div key={label}>
            <div className="sb-section-label">{label}</div>
            {items.map(({ text, icon: Icon, path, badge }) => (
              <div
                key={path}
                className={`sb-item${isActive(path) ? " active" : ""}`}
                onClick={() => navigate(path)}
              >
                <span className="sb-item-ico"><Icon size={16} /></span>
                <span style={{ flex: 1 }}>{text}</span>
                {badge && <span className="sb-badge">{badge}</span>}
              </div>
            ))}
          </div>
        ))}

        <div className="sb-divider" />

        {/* ── k6 Engine Cluster Card ── */}
        <div className="sb-engine-card">
          <div className="sb-engine-header">
            <div className="sb-engine-title-wrap">
              <span className="sb-engine-dot" />
              <span className="sb-engine-title">k6 Runner Active</span>
            </div>
            <span className="sb-engine-pill">Ready</span>
          </div>
          <div className="sb-engine-chips">
            <span className="sb-chip">v2.2.0</span>
            <span className="sb-chip">win/amd64</span>
            <span className="sb-chip">Local Daemon</span>
          </div>
          <div className="sb-engine-meta" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Telemetry: {telemetry.influxdb_online ? "InfluxDB + k6" : "k6 Live Engine"}</span>
            <span style={{ color: "#34d399", fontWeight: 600 }}>Streaming</span>
          </div>
        </div>
      </nav>

      {/* ── Theme Mode Toggle ── */}
      <div className="sb-theme-toggle-row">
        <button
          className="sb-theme-btn"
          type="button"
          onClick={toggleTheme}
          title={`Switch to ${theme === "dark" ? "Light" : "Dark"} Mode`}
        >
          {theme === "dark" ? (
            <>
              <Sun size={15} style={{ color: "#fbbf24" }} />
              <span>Light Mode</span>
            </>
          ) : (
            <>
              <Moon size={15} style={{ color: "#818cf8" }} />
              <span>Dark Mode</span>
            </>
          )}
        </button>
      </div>

      {/* ── User footer ── */}
      <div className="sb-footer">
        <div className="sb-user">
          <div className="sb-avatar">{initials}</div>
          <div className="sb-user-info">
            <div className="sb-user-name">{fullName}</div>
            <div className="sb-user-role">Performance Tester</div>
          </div>
          <button className="sb-logout" title="Sign out" onClick={handleLogout}>
            <LogOut size={14} />
          </button>
        </div>
      </div>
    </aside>
  );
}
