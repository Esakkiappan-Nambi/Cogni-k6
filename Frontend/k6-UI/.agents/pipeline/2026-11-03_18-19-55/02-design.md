# Technical Design: Fix Broken Functionality & Enterprise-Level UI — K6 Portal
## Revision 2 — addresses all 9 findings from design-review.json

## Overview

This design covers four surgical changes to three JSX files and one CSS file. The codebase uses **Vite + React 19 + React Router v7**, with a single global design-system stylesheet (`src/index.css`, ~1 270 lines) that is the authoritative source for CSS tokens and shared component classes. Each page also has a co-located CSS file (`Report.css`, `Dashboard.css`, etc.). The changes are:

- **Fix 1** — `Report.jsx`: replace three broken CSS variable names in inline styles and two occurrences of the wrong field name `report.throughput`.
- **Fix 2** — `index.css`: append only the three genuinely absent `rpt-output-*` classes. All other classes listed in the requirements already exist. A CSS cascade analysis is included.
- **Fix 3** — `Dashboard.jsx`: add `useCallback` import, refactor `load` into a `useCallback`-wrapped function declared before `useEffect`, add the auto-refresh interval, and add the telemetry pill bar row inside the hero section.
- **Fix 4** — `RunTest.jsx`: change the first telemetry card to always render and use a three-way ternary (running / post-run / idle) inside the card body, addressing the dual-panel regression.

Technology stack (locked): React 19, Vite 8, React Router v7, Lucide React icons, inline styles for one-off layout, CSS custom properties from `src/index.css`.

---

## Fix 1 — Report.jsx: Wrong CSS Variable Names and Field Name

**File:** `src/pages/Report.jsx`

The metrics table `<tbody>` (identified in the source, confirmed by reading the file) contains two `<td>` elements with inline style objects that reference three CSS variables that do not exist in the design system:

```jsx
// Current — broken
<td style={{ color:"var(--text-secondary)" }}>{label}</td>
<td style={{ textAlign:"right", fontWeight:600, color:"var(--text-primary)" }}>
  {value} {unit && <span style={{ color:"var(--text-muted)", fontWeight:400, fontSize:11 }}>{unit}</span>}
</td>
```

Replace with:

```jsx
// Fixed
<td style={{ color:"var(--tx2)" }}>{label}</td>
<td style={{ textAlign:"right", fontWeight:600, color:"var(--tx)" }}>
  {value} {unit && <span style={{ color:"var(--tx3)", fontWeight:400, fontSize:11 }}>{unit}</span>}
</td>
```

Token mapping (all three are defined in `:root` of `index.css`):
- `--text-secondary` → `--tx2` (`#94a3b8`)
- `--text-primary` → `--tx` (`#e2e8f0`)
- `--text-muted` → `--tx3` (`#64748b`)

**Throughput field name:** In `Report.jsx`, `report.throughput` appears twice: once in the `kpis` array (line ~63) and once in the `metrics` array (line ~74). Both must be changed to `report.requests_per_second`. The display label `"Throughput"` does not change.

```js
// kpis array — before
{ label:"Throughput", value: report.throughput, unit:"req/s" },
// after
{ label:"Throughput", value: report.requests_per_second, unit:"req/s" },

// metrics array — before
["Throughput", report.throughput, "req/s"],
// after
["Throughput", report.requests_per_second, "req/s"],
```

**Error handling:** Both are read-only property accesses on `report`, which is guaranteed non-null by the existing `if (!report) return (...)` loading guard. If the backend response omits `requests_per_second`, the field renders as `undefined` — an acceptable degradation equivalent to the current broken state with `throughput`. No defensive code is required.

---

## Fix 2 — index.css: CSS Cascade Analysis and Missing Classes

### Pre-existing duplicate declarations — authoritative copy declaration

Reading `index.css` (lines 749–782) and `Report.css` confirms the following classes are defined in **both** files:

| Selector | In `Report.css` | In `index.css` (lines) | Authoritative copy |
|---|---|---|---|
| `.rpt-body` | line 21 | line 750 | **`Report.css`** — it is imported after `index.css` via `import "./Report.css"` at the top of `Report.jsx`, so the `Report.css` rule wins in the cascade |
| `.verdict-card`, `.verdict-pass`, `.verdict-fail`, `.verdict-left` | lines 24–38 | lines 752–763 | **`Report.css`** — same import-order reason; note: `Report.css` uses `.verdict-left svg` (descendant) while `index.css` uses `.verdict-left > svg` (child) — the `Report.css` definition is the one that visually applies |
| `.rpt-kpis`, `.rpt-kpi-card`, `.rpt-kpi-label`, `.rpt-kpi-value`, `.rpt-kpi-unit`, `.rpt-kpi-card.warn .rpt-kpi-value` | lines 41–55 | lines 764–776 | **`Report.css`** — same import-order reason |
| `.rpt-back`, `.rpt-back:hover` | lines 9–11 | lines 779–780 | **`Report.css`** — same import-order reason |

Classes that are in `Report.css` **only** (not in `index.css`): `.rpt-topbar`, `.rpt-title-row`, `.rpt-title`, `.rpt-sub`, `.rpt-actions`.

These duplicates are **pre-existing and harmless** given the current import order. The constraint NFR-2.1 prohibits deleting or renaming existing rules, so the `index.css` duplicates are left in place. The `Report.css` copy wins in all cases because `import "./Report.css"` in `Report.jsx` loads the page-scoped CSS after the global `index.css` in the stylesheet evaluation order. No action required by the implementer — this note exists solely to prevent confusion.

### Classes existing only in index.css (not in any page CSS)

The following classes from the requirements are confirmed present in `index.css` and do **not** need to be added:
- `.sort-badge-wrap`, `.sort-badge-icon`, `.sort-select-modern`, `.sortable` — `index.css` ~1002–1023
- `.sb-theme-toggle-row`, `.sb-theme-btn` — `index.css` ~1028–1040
- `.rt-body`, `.rt-hub-card`, `.rt-hub-left`, `.rt-hub-icon`, `.rt-hub-title`, `.rt-hub-sub`, `.rt-hub-right` — `index.css` ~640–660
- `.rt-run-banner`, `.rt-run-banner-left`, `.rt-run-banner-left h4/p`, `.rt-run-banner-actions` — `index.css` ~665–675
- `.rt-table-wrap`, `.rt-table-top`, `.rt-table-top-left`, `.rt-table-top-title`, `.rt-total-chip`, `.rt-page-info` — `index.css` ~680–700
- `.rt-grafana-card`, `.rt-grafana-hdr`, `.rt-grafana-hdr-left`, `.rt-grafana-hdr-left h3/p`, `.rt-grafana-hdr-right`, `.rt-grafana-body`, `.rt-grafana-note` — `index.css` ~705–725
- `.rt-terminal-card`, `.rt-terminal-hdr`, `.rt-terminal-hdr-left`, `.rt-terminal-hdr-right` — `index.css` ~730–745
- `.hist-body`, `.hist-table-wrap`, `.hist-table-top`, `.hist-table-top-left`, `.hist-table-title`, `.hist-total-chip`, `.hist-page-info` — `index.css` ~750–775
- `.dash-stat-row`, `.dash-body`, `.dash-chart-card`, `.dash-chart-hdr`, `.dash-chart-hdr-left`, `.dash-chart-legend`, `.dash-chart-legend-item`, `.legend-dot` — `index.css` ~590–625
- `.dash-table-card`, `.dash-table-hdr`, `.dash-view-all` — `index.css` ~626–640

### What to add

Only the following three classes are absent from all CSS files:

```
.rpt-output-card     — ABSENT from index.css and Report.css ❌
.rpt-output-header   — ABSENT from index.css and Report.css ❌
.rpt-output-title    — ABSENT from index.css and Report.css ❌
```

Append a single labelled block to the bottom of `src/index.css`:

```css
/* ══════════════════════════════════════════════════════════
   REPORT — OUTPUT CARD  (rpt-output-card / header / title)
   Added 2026-11-03 — completes missing Report.jsx output section
   ══════════════════════════════════════════════════════════ */
.rpt-output-card {
  background: var(--bg2);
  border: 1px solid var(--border);
  border-radius: var(--r3);
  overflow: hidden;
  margin-bottom: 16px;
  box-shadow: 0 4px 20px -2px rgba(0,0,0,0.35);
}
.rpt-output-header {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--bg4);
}
.rpt-output-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--tx);
  display: flex;
  align-items: center;
  gap: 6px;
}
```

All five tokens (`--bg2`, `--bg4`, `--border`, `--r3`, `--tx`) are defined in `:root`. No new variables are introduced. No existing rules are modified.

**Error handling / edge cases:** CSS has no runtime errors. If the element is absent from the DOM the rule is dormant. Accidental future duplication is harmless because no other rule currently defines these three selectors; the later declaration would win.

---

## Fix 3 — Dashboard.jsx: Auto-Refresh + Telemetry Pill Bar

### 3a — Refactor `load` with `useCallback` (addresses Finding 1)

**File:** `src/pages/Dashboard.jsx`

**Problem confirmed by reading the source:** `useEffect` is declared on line 37 and `const load = async () => {}` is declared on line 39. In JavaScript, `const` declarations in a function body are not hoisted — `load` is in the temporal dead zone at the point where `useEffect(() => { load(); }, [])` is parsed. The callback works at runtime only because `useEffect` callbacks execute asynchronously after the component function body finishes. However, adding `setInterval(() => load(true), ...)` inside the same empty-dep `useEffect` creates a **stale closure**: the interval captures the render-0 `load` reference. Because today `load` exclusively calls stable React state setters (`setStats`, `setRecent`, `setTelemetry`, `setLoading`), the stale closure is safe — but the design must make this explicit and use `useCallback` to eliminate the problem for future maintainers.

**Required changes:**

1. Add `useCallback` to the React import line:
   ```js
   // Before
   import React, { useEffect, useState } from "react";
   // After
   import React, { useEffect, useState, useCallback } from "react";
   ```

2. Move the `load` declaration to **before** `useEffect`, and wrap it in `useCallback`. This is a source-code reorganisation: cut the existing `const load = async () => { ... }` block and paste it above the `useEffect` call, then wrap it:

   ```jsx
   // load must be declared BEFORE useEffect
   const load = useCallback(async (silent = false) => {
     if (!silent) setLoading(true);
     try {
       const [s, r, t] = await Promise.all([
         API.get("/dashboard-stats"),
         API.get("/recent-tests"),
         API.get("/telemetry-status").catch(() => ({ data: {} })),
       ]);
       setStats(s.data   || {});
       setRecent(r.data  || []);
       // Spread-merge to preserve initial defaults if the endpoint returns partial data
       if (t.data && Object.keys(t.data).length > 0) {
         setTelemetry(prev => ({ ...prev, ...t.data }));
       }
     } catch (e) {
       console.error(e);
     } finally {
       if (!silent) setLoading(false);
     }
   }, []); // empty deps: only calls stable state setters — safe

   useEffect(() => {
     load();
     const refreshInterval = setInterval(() => load(true), 30_000);
     return () => clearInterval(refreshInterval);
   }, [load]); // load is stable (useCallback with []) — no eslint-disable needed
   ```

   Key decisions:
   - `useCallback([])` is correct here because `load` only calls state setters (which are stable references guaranteed by React). If in the future `load` references a prop or non-setter state variable, the deps array must be updated — `useCallback` makes this constraint visible.
   - The `setInterval(() => load(true), 30_000)` fires every 30 seconds. `silent = true` skips `setLoading(true/false)` so the UI does not flash the loading skeleton on background refreshes.
   - `[load]` in `useEffect`'s deps array is technically the correct lint-clean pattern; because `useCallback([])` makes `load` stable across renders, this is equivalent to `[]` in practice but does not require a lint-disable comment.

**Telemetry state guard (addresses Finding 5):**

The existing guard `if (t.data) setTelemetry(t.data)` has a bug: when `/telemetry-status` fails, the `.catch(() => ({ data: {} }))` returns an empty object. `{}` is truthy, so `setTelemetry({})` is called, wiping `grafana_online`, `influxdb_online`, and the URL fields to `undefined`. The correct guard, as shown in the `useCallback` body above, is:

```js
if (t.data && Object.keys(t.data).length > 0) {
  setTelemetry(prev => ({ ...prev, ...t.data }));
}
```

This uses a spread-merge so a partial API response (e.g., only `grafana_online` is returned) does not accidentally clear the URL fields that were set at initialisation.

**Memory leak prevention:** The `useEffect` return always calls `clearInterval(refreshInterval)`. If the component unmounts before the first 30-second tick, the interval is cancelled immediately.

### 3b — Telemetry pill bar (k6 / Grafana / InfluxDB)

Add a second row directly inside the `dash-hero` `<div>`, as an immediate sibling after the closing `</div>` of `dash-hero-top`. Use inline styles only (no new CSS class names, matching the project's existing pattern for one-off layout rows):

```jsx
{/* ── Service Telemetry Pill Bar ── */}
<div style={{
  display: "flex", alignItems: "center", gap: 10,
  position: "relative", zIndex: 1, flexWrap: "wrap",
  paddingTop: 12,
}}>
  {/* k6 Engine — always Ready (intentionally hardcoded; see design note below) */}
  <div style={{
    display: "flex", alignItems: "center", gap: 7,
    background: "rgba(16,185,129,0.08)",
    border: "1px solid rgba(16,185,129,0.2)",
    borderRadius: 9999, padding: "4px 12px",
    fontSize: 12, color: "#34d399", fontWeight: 600,
  }}>
    <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#10b981",
      boxShadow: "0 0 6px #10b981", flexShrink: 0 }} />
    k6 Engine · Ready
  </div>

  {/* Grafana — driven by telemetry.grafana_online */}
  <div style={{
    display: "flex", alignItems: "center", gap: 7,
    background: telemetry.grafana_online ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
    border: `1px solid ${telemetry.grafana_online ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
    borderRadius: 9999, padding: "4px 12px",
    fontSize: 12, color: telemetry.grafana_online ? "#34d399" : "#fbbf24", fontWeight: 600,
  }}>
    <span style={{
      width: 7, height: 7, borderRadius: "50%",
      background: telemetry.grafana_online ? "#10b981" : "#f59e0b",
      boxShadow: `0 0 6px ${telemetry.grafana_online ? "#10b981" : "#f59e0b"}`,
      flexShrink: 0,
    }} />
    Grafana · {telemetry.grafana_online ? "Online" : "Offline"}
  </div>

  {/* InfluxDB — driven by telemetry.influxdb_online */}
  <div style={{
    display: "flex", alignItems: "center", gap: 7,
    background: telemetry.influxdb_online ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)",
    border: `1px solid ${telemetry.influxdb_online ? "rgba(16,185,129,0.2)" : "rgba(245,158,11,0.2)"}`,
    borderRadius: 9999, padding: "4px 12px",
    fontSize: 12, color: telemetry.influxdb_online ? "#34d399" : "#fbbf24", fontWeight: 600,
  }}>
    <span style={{
      width: 7, height: 7, borderRadius: "50%",
      background: telemetry.influxdb_online ? "#10b981" : "#f59e0b",
      boxShadow: `0 0 6px ${telemetry.influxdb_online ? "#10b981" : "#f59e0b"}`,
      flexShrink: 0,
    }} />
    InfluxDB · {telemetry.influxdb_online ? "Streaming" : "Offline"}
  </div>
</div>
```

**Design note — k6 pill hardcoded green (addresses Finding 7):** The k6 Engine pill is intentionally hardcoded to the green "Ready" state. Do **not** add a `k6_dashboard_online` field to `Dashboard.jsx`'s `telemetry` state initializer and do not gate this pill on any backend field. Rationale: the k6 engine is a co-located CLI process that is either not running (no test active) or running (test active). From the client's perspective it is always "ready to run" — the distinction between "k6 engine idle" and "k6 engine actively serving a dashboard on :5665" is not relevant at the Dashboard level. The `RunTest.jsx` component uses `k6_dashboard_online` for its per-run iframe logic, but that field is absent from Dashboard's telemetry initializer intentionally. If `/telemetry-status` begins returning `k6_dashboard_online`, the spread-merge (`{ ...prev, ...t.data }`) will add it to the state object but the pill JSX will not read it — the hardcoded green is preserved.

**State dependency:** `telemetry` is already in state, initialised to `{ grafana_online: false, influxdb_online: false, grafana_base_url: "...", grafana_dashboard_path: "..." }`. The pills render on mount with amber "Offline" state and update correctly after `load()` completes. The spread-merge guard ensures that if `/telemetry-status` fails, pills stay amber (both fields remain `false` from the initializer).

---

## Fix 4 — RunTest.jsx: Three-State Always-Visible Telemetry Panel

**File:** `src/pages/RunTest.jsx`

### Three states confirmed by reading the source

After reading `RunTest.jsx` in full, three distinct states exist for the telemetry panel area:

| State | Condition | Desired UI |
|---|---|---|
| **Running** | `runningTestId` is set | First card shows live iframes (existing content, unchanged) |
| **Post-run** | `!runningTestId && lastDashboardRunId` | Second card shows the last-run dashboard iframe (already exists, unchanged) |
| **Idle** | `!runningTestId && !lastDashboardRunId` | First card shows idle status grid (new fallback) |

### Problem with the previous design (Finding 3)

The previous design proposed making the first telemetry card unconditionally render and using only `runningTestId` as a switch, while leaving the second card (`!runningTestId && lastDashboardRunId`) unchanged. This created a regression: after a test completes, the first card would show the idle fallback while the second card showed the completed-run dashboard — a confusing dual-card layout.

### Chosen approach

**Use the existing `lastDashboardRunId` card as the post-run display.** The first card (currently gated by `(runningTestId || activeRunId || grafanaUrl)`) is changed to show only when either `runningTestId` is truthy **or** when neither `runningTestId` nor `lastDashboardRunId` is set (idle state). The second card (`!runningTestId && lastDashboardRunId`) is left completely unchanged.

The new gate for the first card becomes:

```jsx
{(runningTestId || (!runningTestId && !lastDashboardRunId)) && (
  <div className="rt-grafana-card">
    ...
    <div className="rt-grafana-body">
      {runningTestId ? (
        /* === RUNNING STATE: existing iframe content — NO CHANGES === */
        activeTab === "k6" ? ( ...existing k6 iframe... ) : ( ...existing grafana iframe... )
      ) : (
        /* === IDLE STATE: service status grid === */
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <p style={{ fontSize: 12, color: "var(--tx2)", marginBottom: 4 }}>
            No test is currently running. Start a test above to activate live streaming.
          </p>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 12 }}>

            {/* k6 Native Dashboard card */}
            <div style={{
              background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: "var(--r2)", padding: "14px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: "#10b981", boxShadow: "0 0 6px #10b981", flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tx)" }}>k6 Native Dashboard</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--tx3)", marginBottom: 4 }}>Port 5665 · Active during test run</div>
              <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'Consolas', monospace" }}>
                {telemetry.k6_web_dashboard_url || "http://localhost:5665"}
              </div>
            </div>

            {/* Grafana card */}
            <div style={{
              background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: "var(--r2)", padding: "14px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: telemetry.grafana_online ? "#10b981" : "#f59e0b",
                  boxShadow: `0 0 6px ${telemetry.grafana_online ? "#10b981" : "#f59e0b"}`,
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tx)" }}>Grafana</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--tx3)", marginBottom: 4 }}>
                Port 3000 · {telemetry.grafana_online ? "Online" : "Offline"}
              </div>
              <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'Consolas', monospace" }}>
                {telemetry.grafana_base_url || "http://localhost:3000"}
              </div>
            </div>

            {/* InfluxDB card */}
            <div style={{
              background: "var(--bg3)", border: "1px solid var(--border)",
              borderRadius: "var(--r2)", padding: "14px 16px",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <span style={{
                  width: 8, height: 8, borderRadius: "50%",
                  background: telemetry.influxdb_online ? "#10b981" : "#f59e0b",
                  boxShadow: `0 0 6px ${telemetry.influxdb_online ? "#10b981" : "#f59e0b"}`,
                  flexShrink: 0,
                }} />
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--tx)" }}>InfluxDB</span>
              </div>
              <div style={{ fontSize: 11, color: "var(--tx3)", marginBottom: 4 }}>
                Port 8086 · {telemetry.influxdb_online ? "Streaming" : "Offline"}
              </div>
              <div style={{ fontSize: 11, color: "var(--tx3)", fontFamily: "'Consolas', monospace" }}>
                http://localhost:8086
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  </div>
)}
```

The simplified gate `(runningTestId || (!runningTestId && !lastDashboardRunId))` is logically equivalent to `(runningTestId || !lastDashboardRunId)`. Either form is acceptable; the longer form is more explicit about the intent.

### Header tab buttons in idle state (addresses Finding 9)

The `rt-grafana-hdr` block (tab buttons, "Open Tab" button, "View Report" button) is rendered by the same first card and will be visible in both the running and idle states. This is acceptable behaviour — the tab buttons switch `activeTab` state between `"k6"` and `"grafana"`. The `activeTab` state persists across idle/live transitions: if a user clicks the "Grafana View" tab while idle and then starts a test, the Grafana iframe will load first rather than the k6 Dashboard. This is pre-existing behaviour, not a regression from this change, and no reset logic is required.

### State matrix confirming no dual-panel regression

| `runningTestId` | `lastDashboardRunId` | First card visible? | Content | Second card visible? |
|---|---|---|---|---|
| set | any | Yes | Live iframes | No |
| null | null | Yes | Idle status grid | No |
| null | set | **No** | — | Yes (last run iframe) |

The third row confirms the regression is eliminated.

---

## File Change Summary

| File | Change type | Key lines affected |
|---|---|---|
| `src/pages/Report.jsx` | String replacements | ~5 lines (2× field name, 3× CSS var) |
| `src/index.css` | Append only | +22 lines (rpt-output-* at end of file) |
| `src/pages/Dashboard.jsx` | Import + refactor + JSX addition | ~25 lines modified/added |
| `src/pages/RunTest.jsx` | Gate change + idle-state JSX | ~45 lines added, 1 line changed |

No other files are modified. No packages are installed.

---

## Testability

- **Unit test (Report.jsx):** Render `<Report />` with a mocked API response that includes `requests_per_second: 250`. Assert the KPI card for "Throughput" shows `250`. Assert metrics table row for "Throughput" shows `250 req/s`. Assert no `undefined` text is rendered.
- **Unit test (Dashboard.jsx load()):** Render `<Dashboard />` with a mocked API where `/telemetry-status` fails (rejects). Assert that `grafana_online` remains `false` (not wiped to `undefined`). Assert that the Grafana pill shows "Offline".
- **Unit test (Dashboard.jsx auto-refresh):** Use `jest.useFakeTimers()`, advance by 30 s, assert the mocked `/dashboard-stats` endpoint was called a second time with silent=true behaviour (loading state did not flip to `true`).
- **Integration test (RunTest.jsx three-state):** (a) No test running, no `lastDashboardRunId` set → first card visible with idle grid. (b) Test running (`runningTestId` set) → first card shows iframes. (c) Test completed (`lastDashboardRunId` set, `runningTestId` null) → first card hidden, second card visible.
- **Build smoke test:** `npm run build` from `Frontend/k6-UI` exits with code 0. This is the primary verification gate.

---

## Error Handling Matrix

| Operation | Failure condition | Recoverable? | Caller sees | Logged? |
|---|---|---|---|---|
| `load()` initial load in Dashboard | Network error or 5xx | Yes — user can refresh page | `stats` stays at zero defaults, `recent` stays empty | `console.error` |
| `load(true)` auto-refresh in Dashboard | Network error or 5xx | Yes — next 30 s tick retries | Stale data silently shown; no toast | `console.error` |
| `/telemetry-status` call in Dashboard | Endpoint unavailable | Yes — `.catch(() => ({ data:{} }))` + non-empty guard | Telemetry state stays at initial defaults (`grafana_online: false`, `influxdb_online: false`) — pills show amber "Offline" | No |
| `report.requests_per_second` access | Field absent from API response | N/A — display only | KPI card and metrics row show `undefined`; no crash | No |
| CSS missing class (rpt-output-*) | Class absent from all CSS files | N/A | Element unstyled; no JS error | No |
| RunTest telemetry fallback URL | `telemetry.grafana_base_url` is `undefined` | N/A — display only | Idle card shows hardcoded `"http://localhost:3000"` via `|| "http://localhost:3000"` fallback | No |

---

## Assumptions

- **A1 (verified):** Most classes from the requirements already exist. Only `rpt-output-*` are genuinely absent. Audit confirmed by grep across all CSS files.
- **A2 (verified):** `--text-muted` maps to `--tx3: #64748b`. `--text-secondary` maps to `--tx2: #94a3b8`. `--text-primary` maps to `--tx: #e2e8f0`. All confirmed in `:root` of `index.css`.
- **A3 (verified):** Dashboard's `telemetry` state does **not** have `k6_dashboard_online`. This is intentional — the Dashboard k6 pill is hardcoded. `RunTest.jsx` line 102 has `k6_dashboard_online: true` in its own separate telemetry state.
- **A4 (verified):** The idle telemetry panel uses `<div>` status cards, not a blank iframe. No blank-iframe flash.
- **A5 (verified):** `lastDashboardRunId` is the correct sentinel for post-run display, set in `pollForResult` when the test finishes. The second telemetry card (`!runningTestId && lastDashboardRunId`) is preserved unchanged.
- **A6 (new):** The `Report.css` copy of duplicate selectors is authoritative (it is imported after `index.css`). The `index.css` duplicates are harmless.
- **A7 (new):** The three-state gate `(runningTestId || !lastDashboardRunId)` correctly eliminates the dual-panel regression confirmed by the review.

---

## Responses to Design Review Findings

| Finding | Severity | Response |
|---|---|---|
| **F1** — `load` declared after `useEffect`, stale closure risk | HIGH | **Addressed.** Fix 3a now wraps `load` in `useCallback([])` and explicitly moves it before `useEffect`. The `useEffect` deps array uses `[load]` eliminating the `eslint-disable`. The design explains why the empty `useCallback` deps are safe (state setters only) and what breaks that assumption in the future. |
| **F2** — CSS audit missed pre-existing duplicates | HIGH | **Addressed.** Fix 2 now includes a full cascade analysis table naming every duplicate, declaring `Report.css` as authoritative, and explaining the import-order reason. |
| **F3** — Idle card + `lastDashboardRunId` card both render simultaneously | HIGH | **Addressed.** Fix 4 now uses the three-state gate `(runningTestId \|\| !lastDashboardRunId)` for the first card. The state matrix table in Fix 4 explicitly shows the post-run row where the first card is suppressed. |
| **F4** — Audit table internally inconsistent for Report.css entries | MEDIUM | **Addressed.** Subsumed by F2 resolution. The cascade analysis table separates Report.css-only entries from dual-defined entries and calls out each duplicate. |
| **F5** — `setTelemetry({})` wipes defaults when `/telemetry-status` fails | MEDIUM | **Addressed.** Fix 3a now uses `if (t.data && Object.keys(t.data).length > 0) { setTelemetry(prev => ({ ...prev, ...t.data })); }` — both the empty-object guard and the spread-merge to preserve initial defaults. |
| **F6** — Line numbers not verifiable, rpt-body claimed absent from index.css incorrectly | MEDIUM | **Addressed.** Subsumed by F2 resolution. The corrected audit table now explicitly marks `.rpt-body` as present in both files. |
| **F7** — Design should explicitly prohibit `k6_dashboard_online` in Dashboard initializer | MEDIUM | **Addressed.** Fix 3b now has an explicit "Design note" paragraph stating the hardcoded rationale and forbidding the addition of `k6_dashboard_online` to Dashboard's telemetry state. |
| **F8** — "All three tokens" prose says three but lists five | NIT | **Addressed.** The revised text reads "All five tokens" in Fix 2. |
| **F9** — `activeTab` persists across idle/live transition not documented | NIT | **Addressed.** Fix 4 "Header tab buttons in idle state" section now explicitly documents the persistence and states it is acceptable existing behaviour. |
