# Requirements: Fix Broken Functionality & Enterprise-Level UI — K6 Portal

## Summary

The K6 Portal frontend has four categories of breakage:

1. **Report.jsx** uses wrong CSS variable names (`--text-secondary`, `--text-primary`) and a wrong data field name (`report.throughput` instead of `report.requests_per_second`), causing unstyled metric rows and blank throughput KPI values.
2. **index.css** is missing a subset of CSS class definitions that components already reference, causing unstyled UI blocks across RunTest, History, Report, and Dashboard pages.
3. **Dashboard.jsx** stats show zero because there is no auto-refresh to pick up newly completed runs, and there is no telemetry pill bar to surface the live status of k6, Grafana, and InfluxDB services.
4. **RunTest.jsx** hides the Live Telemetry panel behind a condition (`runningTestId || activeRunId || grafanaUrl`) so users who land on the page before starting a test see no guidance on what the telemetry panel is or how to use it.

All fixes are CSS and JSX only. No backend Python files are changed.

---

## Functional Requirements

### FR-1 — Report.jsx: Fix CSS variable names
- FR-1.1 Replace every inline-style reference to `var(--text-secondary)` in `Report.jsx` with `var(--tx2)`.
- FR-1.2 Replace every inline-style reference to `var(--text-primary)` in `Report.jsx` with `var(--tx)`.
- FR-1.3 Confirm no other design-system variable names from outside the current `:root` token set (e.g. `--text-muted`, `--bg-primary`) are used in `Report.jsx`; replace any found with their correct equivalents (`--tx3`, `--bg`, respectively).

### FR-2 — Report.jsx: Fix throughput field mapping
- FR-2.1 Replace `report.throughput` with `report.requests_per_second` in the `kpis` array (the Throughput KPI card).
- FR-2.2 Replace `report.throughput` with `report.requests_per_second` in the `metrics` array (the Aggregate Metrics table row).
- FR-2.3 Do not rename the display label ("Throughput") — only the data source field changes.

### FR-3 — index.css: Add missing CSS class definitions
Add the following class blocks to `index.css` **without removing or modifying any existing rules**:

| Class | Purpose |
|-------|---------|
| `.sort-badge-wrap` | Flex wrapper for the sort icon + select combo |
| `.sort-badge-icon` | Icon color/alignment inside sort wrapper |
| `.sort-select-modern` | Styled dark `<select>` element |
| `.sortable` | Clickable sortable table column header |
| `.sb-theme-toggle-row` | Theme toggle row in sidebar footer |
| `.sb-theme-btn` | Theme toggle button in sidebar footer |
| `.rt-body` | RunTest page body scroll container |
| `.rt-hub-card` | "Run & Monitor Hub" banner card |
| `.rt-hub-left`, `.rt-hub-icon`, `.rt-hub-title`, `.rt-hub-sub` | Hub card left section elements |
| `.rt-hub-right` | Hub card right section (search + controls) |
| `.rt-run-banner` | Active-run status banner |
| `.rt-run-banner-left` and its `h4`/`p` children | Banner left content |
| `.rt-run-banner-actions` | Banner action buttons group |
| `.rt-table-wrap` | Table container card |
| `.rt-table-top`, `.rt-table-top-left`, `.rt-table-top-title` | Table toolbar |
| `.rt-total-chip` | Record count pill |
| `.rt-page-info` | Page count label |
| `.rt-grafana-card` | Telemetry/Grafana container card |
| `.rt-grafana-hdr`, `.rt-grafana-hdr-left`, `.rt-grafana-hdr-left h3`, `.rt-grafana-hdr-left p`, `.rt-grafana-hdr-right` | Grafana card header elements |
| `.rt-grafana-body` | Grafana card body padding |
| `.rt-grafana-note` | Amber note/warning strip inside grafana card |
| `.rt-terminal-card`, `.rt-terminal-hdr`, `.rt-terminal-hdr-left`, `.rt-terminal-hdr-right` | Terminal output card and header |
| `.hist-body` | History page body scroll container |
| `.hist-table-wrap` | History table container |
| `.hist-table-top`, `.hist-table-top-left`, `.hist-table-title` | History table toolbar |
| `.hist-total-chip`, `.hist-page-info` | History count chips |
| `.rpt-topbar` | Report page top action bar |
| `.rpt-title-row`, `.rpt-title`, `.rpt-sub` | Report topbar title section |
| `.rpt-actions` | Report topbar action buttons group |
| `.rpt-back` | Report topbar back button |
| `.rpt-body` | Report page body scroll container |
| `.rpt-kpis` | 6-column KPI grid |
| `.rpt-kpi-card`, `.rpt-kpi-label`, `.rpt-kpi-value`, `.rpt-kpi-unit` | Individual KPI card elements |
| `.rpt-kpi-card.warn .rpt-kpi-value` | Error-rate KPI highlighted in red |
| `.rpt-metrics-card`, `.rpt-metrics-header` | Metrics breakdown table card |
| `.rpt-output-card`, `.rpt-output-header`, `.rpt-output-title` | Terminal output card |
| `.dash-stat-row` | 4-column dashboard stat card grid |
| `.dash-body` | Dashboard body flex column container |
| `.dash-chart-card`, `.dash-chart-hdr`, `.dash-chart-hdr-left`, `.dash-chart-legend`, `.dash-chart-legend-item`, `.legend-dot` | Dashboard chart card elements |
| `.dash-table-card`, `.dash-table-hdr`, `.dash-view-all` | Dashboard recent-tests table card elements |
| `.verdict-card`, `.verdict-pass`, `.verdict-fail`, `.verdict-left` | Report verdict banner and variants |

- FR-3.1 Before adding any class, check whether it already exists in `index.css`, `Dashboard.css`, `RunTest.css`, `History.css`, or `Report.css`. Only add it if it is genuinely absent from all CSS files (avoid duplicate rules).
- FR-3.2 Responsive breakpoints must be included for `.rpt-kpis` and `.dash-stat-row` as specified in the feature request.
- FR-3.3 All new rules must reference only design-token variables already defined in the `:root` block (e.g. `--tx`, `--tx2`, `--bg2`, `--brand-dim`, `--border`, `--r`, `--r2`, `--r3`, `--t`).

### FR-4 — Dashboard.jsx: Add 30-second auto-refresh
- FR-4.1 After the initial data load in `useEffect`, set up a `setInterval` that calls `load()` every 30,000 ms.
- FR-4.2 The interval must be cleared in the `useEffect` cleanup function to prevent memory leaks.
- FR-4.3 The auto-refresh must not trigger while the component is unmounted.
- FR-4.4 No new state or loading spinners are needed for the silent refresh — re-use the existing `load()` function which already handles the `setLoading` flow.

### FR-5 — Dashboard.jsx: Add telemetry pill bar
- FR-5.1 Add a second row inside the `dash-hero` section (below the existing `dash-hero-top` row) that shows three status pills.
- FR-5.2 Pill 1 — **k6 Engine**: always displayed as "Ready" with a green dot (the k6 engine is always considered ready client-side).
- FR-5.3 Pill 2 — **Grafana**: green dot + "Online" when `telemetry.grafana_online === true`; amber dot + "Offline" otherwise.
- FR-5.4 Pill 3 — **InfluxDB**: green dot + "Streaming" when `telemetry.influxdb_online === true`; amber dot + "Offline" otherwise.
- FR-5.5 The pill bar must use only inline styles or existing CSS classes — no new CSS class names are required for this row (inline styles are acceptable here to keep it self-contained).
- FR-5.6 The `telemetry` state already exists in `Dashboard.jsx` and is populated from `GET /telemetry-status`. No new API calls or state variables are needed.

### FR-6 — RunTest.jsx: Make telemetry panel always visible
- FR-6.1 Remove the condition `{(runningTestId || activeRunId || grafanaUrl) && (...)}` that gates the entire telemetry card.
- FR-6.2 When a test IS running (`runningTestId` is set): the panel renders exactly as it does today — the iframe tabs (k6 native port 5665 / Grafana) with the "LIVE" badge.
- FR-6.3 When no test is running (`runningTestId` is null/falsy): render a "telemetry status" fallback inside the panel body instead of the iframes. The fallback shows:
  - Three status cards: k6 Native Dashboard (port 5665), Grafana (port 3000), InfluxDB (port 8086).
  - Each card shows the service name, its URL, and its online/offline status derived from `telemetry.grafana_online`, `telemetry.influxdb_online`, and `telemetry.k6_dashboard_online` (already in state).
  - A short instruction sentence: "Run a test above to activate live streaming."
- FR-6.4 The panel header, title ("Live Performance Telemetry"), and tab switcher buttons remain visible at all times so the user always knows the feature exists.
- FR-6.5 No new state variables are needed; use existing `runningTestId`, `activeRunId`, `grafanaUrl`, and `telemetry` state.

---

## Non-Functional Requirements

### NFR-1 — Build integrity
- NFR-1.1 After all changes, `npm run build` from `Frontend/k6-UI` must complete with **exit code 0** and zero ESLint errors that block the build.
- NFR-1.2 No new npm packages may be installed.

### NFR-2 — CSS preservation
- NFR-2.1 No existing CSS rule, selector, or variable in `index.css` or any page-level CSS file may be deleted, renamed, or have its specificity changed.
- NFR-2.2 New rules must be appended in a clearly labelled section at the end of `index.css`, not scattered inline.

### NFR-3 — Scope containment
- NFR-3.1 Only these four files are modified: `src/index.css`, `src/pages/Report.jsx`, `src/pages/Dashboard.jsx`, `src/pages/RunTest.jsx`.
- NFR-3.2 No backend Python files are touched.
- NFR-3.3 No business logic, API endpoints, or state-management patterns are altered.

---

## Acceptance Criteria

1. **AC-1** Opening `/report/<id>` and inspecting the metrics table in DevTools shows the `td` elements using `color: var(--tx2)` and `color: var(--tx)` rather than the broken `var(--text-secondary)` / `var(--text-primary)`.
2. **AC-2** The Throughput KPI card on the Report page displays a numeric value (not `undefined` or blank) when the run has a populated `requests_per_second` field in the backend response.
3. **AC-3** Both `report.throughput` references in `Report.jsx` are replaced with `report.requests_per_second`; a search for `report.throughput` in the file returns zero matches.
4. **AC-4** All CSS classes listed in FR-3 are resolvable in the browser (no "unknown class" behaviour / missing styles); spot-checked by confirming the RunTest hub card, the Report KPI grid, the History table, and the Dashboard chart card all render with the correct background colours and borders.
5. **AC-5** Dashboard stat cards show non-zero values after completing a test run without a manual page refresh (auto-refresh fires within 30 seconds and updates the displayed counts).
6. **AC-6** The Dashboard telemetry pill bar is visible below the hero greeting row, showing three labelled pills; when `grafana_online` is false the Grafana pill shows an amber dot, and when true it shows a green dot.
7. **AC-7** Navigating to `/run-test` with no active run shows the Live Performance Telemetry card with three service-status sub-cards and the instruction text "Run a test above to activate live streaming."
8. **AC-8** While a test IS running, the telemetry card renders the iframe tab switcher (k6 native / Grafana) exactly as before — the always-visible change must not break the existing live-run display.
9. **AC-9** `npm run build` exits with code 0 and produces a `dist/` artefact with no build errors.
10. **AC-10** No existing CSS rules in `index.css` are deleted or modified; a diff of the file shows only additions.

---

## Out of Scope

- Any backend Python changes (models, routes, serialisers).
- Changes to `Recorder.jsx`, `CreateTest.jsx`, `Login.jsx`, `Register.jsx`, `History.jsx`, `AutoCapture.jsx`, `ProtectedRoute.jsx`, `ReportList.jsx`, `ExecutionChart.jsx`, or any component under `src/components/`.
- Adding new npm packages or updating existing ones.
- Dark/light theme toggle behaviour (the sidebar already handles this).
- Real WebSocket or server-sent-events integration for the telemetry status pills (polling is sufficient).
- PDF download or Grafana URL generation logic changes.
- Any CI/CD pipeline or Jenkinsfile changes.

---

## Assumptions

> These were inferred from the codebase and feature description. The design review should flag any that are wrong.

- **A1** Several classes listed in the feature request (e.g. `.sort-badge-wrap`, `.rt-body`, `.rt-hub-card`, `.rpt-kpis`, `.dash-stat-row`, `.verdict-card`) already exist in `index.css` with slightly different property values than specified. The requirement is to ensure correct definitions are present; if an existing definition already satisfies the visual intent it need not be duplicated. Before adding each rule the implementer must verify absence.
- **A2** `--text-muted` (used in `Report.jsx` for the unit label inside metrics rows) maps to `--tx3` in the current design token set. This should be fixed in the same pass as FR-1.
- **A3** The `telemetry.k6_dashboard_online` field is already part of the `telemetry` state initialiser in `RunTest.jsx` (`k6_dashboard_online: true`) and is populated from the `/telemetry-status` endpoint; the Dashboard component can use `true` as a default since the k6 engine is co-located.
- **A4** The "always visible" telemetry panel in RunTest (FR-6) does not need to show an iframe when no test is running — a static status grid is sufficient and avoids loading a blank iframe that would show a browser error page.
- **A5** `lastDashboardRunId` state in RunTest is used to keep the grafana iframe loaded after a test finishes; the FR-6 change must not clear this behaviour (the condition for switching between live-iframe and status-fallback should be `runningTestId`, not `activeRunId || grafanaUrl`).
