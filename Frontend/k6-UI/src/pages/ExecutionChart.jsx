import React, { useEffect, useState } from "react";
import API from "../services/api";
import {
  ResponsiveContainer, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

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

  useEffect(() => {
    API.get("/execution-chart")
      .then((r) => setData(r.data || []))
      .catch(() => {});
  }, []);

  if (!data.length) {
    return (
      <div style={{
        height: 220,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "#64748b",
        fontSize: 13,
      }}>
        No execution data yet — trigger a test run to plot live performance metrics.
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
        <Legend
          wrapperStyle={{ fontSize: 12, color: "#94a3b8", paddingTop: 16 }}
          iconType="circle"
          iconSize={8}
        />
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
