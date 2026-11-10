import { useEffect, useState } from "react";
import API from "../services/api";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { Activity, RefreshCw } from "lucide-react";

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: "rgba(15, 23, 42, 0.92)",
      backdropFilter: "blur(12px)",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      borderRadius: 10,
      padding: "12px 16px",
      fontSize: 12,
      boxShadow: "0 8px 32px rgba(0,0,0,0.45)",
    }}>
      <p style={{ color: "#94a3b8", marginBottom: 8, fontWeight: 600, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 4 }}>
        Execution Run #{label}
      </p>
      {payload.map((p) => (
        <div key={p.name} style={{ display: "flex", justifyContent: "space-between", gap: 16, margin: "4px 0" }}>
          <span style={{ color: p.color, display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: p.color }} />
            {p.name}:
          </span>
          <strong style={{ color: "#f8fafc", fontFamily: "'Consolas', monospace" }}>{p.value}</strong>
        </div>
      ))}
    </div>
  );
};

export default function ExecutionChart() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    let active = true;
    API.get("/execution-chart", { timeout: 15000 })
      .then((r) => {
        if (active) {
          setData(r.data || []);
          setError(false);
        }
      })
      .catch((err) => {
        console.error("Failed to load execution chart:", err);
        if (active) setError(true);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [retry]);

  if (loading) {
    return (
      <div className="dash-empty-state" role="status">
        <div className="dash-empty-icon"><Activity size={18} /></div>
        <strong>Loading execution trends</strong>
        <span>Fetching the latest run outcomes.</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dash-empty-state" role="alert">
        <div className="dash-empty-icon"><Activity size={18} /></div>
        <strong>Unable to load execution trends</strong>
        <span>Check your connection and try again.</span>
        <button
          className="dash-refresh-btn"
          onClick={() => {
            setError(false);
            setLoading(true);
            setRetry((value) => value + 1);
          }}
        >
          <RefreshCw size={12} /> Try again
        </button>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="dash-empty-state">
        <div className="dash-empty-icon"><Activity size={18} /></div>
        <strong>No executions to display yet</strong>
        <span>Run a test scenario to start building your performance history.</span>
      </div>
    );
  }

  return (
    <div style={{ width: "100%", height: 260 }}>
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 10, right: 20, left: -15, bottom: 5 }}>
        <defs>
          <linearGradient id="passedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/>
            <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
          </linearGradient>
          <linearGradient id="failedGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35}/>
            <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.0}/>
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" vertical={false} />
        <XAxis
          dataKey="run_id"
          tick={{ fill: "#64748b", fontSize: 11 }}
          axisLine={{ stroke: "rgba(255,255,255,0.06)" }}
          tickLine={false}
        />
        <YAxis
          tick={{ fill: "#64748b", fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip content={<CustomTooltip />} />
        <Area
          type="monotone"
          dataKey="failed"
          stroke="#f43f5e"
          strokeWidth={2.5}
          fillOpacity={1}
          fill="url(#failedGradient)"
          name="Failed Runs"
        />
        <Area
          type="monotone"
          dataKey="completed"
          stroke="#10b981"
          strokeWidth={2.5}
          fillOpacity={1}
          fill="url(#passedGradient)"
          name="Passed Runs"
        />
      </AreaChart>
    </ResponsiveContainer>
    </div>
  );
}
