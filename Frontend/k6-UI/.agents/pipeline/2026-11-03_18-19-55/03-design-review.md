# Design Review: Fix Broken Functionality & Enterprise-Level UI — K6 Portal

**Review date:** 2026-11-03  
**Document reviewed:** `02-design.md`  
**Requirements reviewed against:** `01-requirements.md`  
**Source verified against:** `src/pages/Dashboard.jsx`, `src/pages/Report.jsx`, `src/pages/RunTest.jsx`, `src/index.css`, `src/pages/Report.css`, `src/components/Sidebar.css`, `src/pages/Dashboard.css`

---

## Findings

### Finding 1 — HIGH: `load` is declared AFTER `useEffect` — closure captures `undefined` at mount

**Location:** Design §Fix 3a / `src/pages/Dashboard.jsx`

The current `Dashboard.jsx` calls `load()` inside `useEffect(() => { load(); }, [])` on line 37, but `const load = async () => { ... }` is defined on line 39 — **after** the `useEffect` call. In JavaScript, `const` declarations are not hoisted: the `load` identifier is in the temporal dead zone when the component function body executes. Calling `load()` inside the `useEffect` callback works at runtime only because the callback executes asynchronously after the full component body has run — but this ordering is fragile and currently produces a functional component where `useEffect` cannot reference `load` in the dependency array without an eslint-disable comment.

The design proposes to modify `load` to accept a `silent` parameter and then call `setInterval(() => load(true), 30_000)`. This adds a **second closure** capturing the initial `load` reference. Because the `useEffect` deps array is `[]`, `load` captured by the interval is the version from the first render. React function components recreate `const load` on every render; the interval will hold a stale closure to the render-0 version of `load`. In this specific case the stale closure happens to call `setStats`, `setRecent`, `setTelemetry` — React state setters are stable, so this works today. But the design does **not acknowledge this stale-closure risk at all**, leaving the implementer unaware of why an `eslint-disable` is required and when it would break (e.g., if `load` ever uses non-setter state).

**Concrete fix:** The design must explicitly state that `load` must be moved above `useEffect`, or wrapped in `useCallback`, and document that the stale-closure is safe **only because all values written inside `load` are state-setter calls (stable references)**:

```jsx
// load must be declared BEFORE the useEffect that references it
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
    if (t.data) setTelemetry(t.data);
  } catch (e) {
    console.error(e);
  } finally {
    if (!silent) setLoading(false);
  }
}, []); // empty deps safe: only uses stable state setters

useEffect(() => {
  load();
  const id = setInterval(() => load(true), 30_000);
  return () => clearInterval(id);
}, [load]); // load is now stable (useCallback with [])
```

This removes the `eslint-disable` comment entirely and eliminates the stale-closure hazard.

---

### Finding 2 — HIGH: Duplicate CSS definitions across `Report.css` and `index.css` are not acknowledged — NFR-2.1 violation risk

**Location:** Design §Fix 2 (CSS audit table) / `src/pages/Report.css` vs `src/index.css`

The design's audit table claims that `.rpt-topbar`, `.rpt-title-row`, `.rpt-title`, `.rpt-sub`, `.rpt-actions`, `.rpt-back`, `.rpt-body`, `.rpt-kpis`, `.rpt-kpi-card`, `.rpt-kpi-label`, `.rpt-kpi-value`, `.rpt-kpi-unit`, `.rpt-kpi-card.warn .rpt-kpi-value`, `.rpt-metrics-card`, `.rpt-metrics-header`, `.verdict-card`, `.verdict-pass`, `.verdict-fail`, `.verdict-left` are in `src/pages/Report.css` ✅.

**Verified:** These classes ARE in `Report.css` — the design is correct there. However, reading the actual `index.css` reveals that **the same classes are also defined a second time in `index.css`** in the `/* REPORT PAGE */` section around lines 749–780:

- `.rpt-body` — defined in both `Report.css` (line 21) AND `index.css` (line 750)
- `.verdict-card`, `.verdict-pass`, `.verdict-fail`, `.verdict-left` — defined in both `Report.css` (lines 24–38) AND `index.css` (lines 752–763)
- `.rpt-kpis`, `.rpt-kpi-card`, `.rpt-kpi-label`, `.rpt-kpi-value`, `.rpt-kpi-unit`, `.rpt-kpi-card.warn .rpt-kpi-value` — defined in both `Report.css` (lines 41–55) AND `index.css` (lines 764–775)
- `.rpt-back` — defined in both `Report.css` (line 9) AND `index.css` (line 779)

The design **does not mention these existing duplicates**. This matters because:
1. NFR-2.1 says no existing rule may be deleted, renamed, or have its specificity changed. With duplicates already in place, the implementer has no guidance on which copy wins and whether the duplicate in `index.css` is intentional or erroneous.
2. The `index.css` and `Report.css` definitions have minor differences (e.g., `verdict-pass .verdict-left svg` vs `verdict-pass .verdict-left > svg` — a specificity difference). The design does not note this discrepancy.

The design also claims that `.rpt-topbar`, `.rpt-title-row`, `.rpt-title`, `.rpt-actions` exist only in `Report.css`. That is **correct** — they are absent from `index.css`. But the duplicate issue for the other classes is a real gap.

**Concrete fix:** The design must document the pre-existing duplicates explicitly and state which copy is authoritative. If both copies are intentional (e.g., `Report.css` is the local override), that should be stated. Otherwise, the implementation step should remove one copy — but that would violate NFR-2.1. The design must choose: acknowledge the duplicates as harmless (and explain why the later declaration wins) or instruct removal before the NFR-2.1 scope.

---

### Finding 3 — HIGH: FR-6 idle-panel condition change removes `activeRunId`/`grafanaUrl` from the first card's guard — breaks the "just-started, not-yet-polled" window

**Location:** Design §Fix 4 / `src/pages/RunTest.jsx`

The current gate on the live telemetry card is:
```jsx
{(runningTestId || activeRunId || grafanaUrl) && ( ... )}
```

The design proposes to replace this with an unconditional render (`true`), using `runningTestId` as the ternary switch inside the body (live iframes vs idle fallback).

The problem: in `runTest()`, the sequence is:
1. `setRunningTestId(testId)` — set immediately
2. `const res = await API.post(...)` — async, may take 1–3 seconds
3. `setActiveRunId(runId)` — set after the POST returns
4. `buildGrafanaUrl(runId)` — set after the POST returns
5. `pollForResult(testId, runId)` — starts polling

During steps 1–2, `runningTestId` is set. The card renders. The iframe tab content tries to render with `grafanaUrl = ""`. The design says "when `runningTestId` is set, render the existing iframe tab content — NO changes to this branch." But the existing iframe tab content for "Grafana View" is `<iframe src={grafanaUrl || "http://localhost:3000"} ...>`. With `grafanaUrl = ""`, the iframe loads `http://localhost:3000` immediately — which is the same behaviour as before the fix (since the current gate already shows the card once `runningTestId` is set). This is harmless.

However, the bigger problem is the **`lastDashboardRunId` interaction**. The design says the `lastDashboardRunId` card is left unchanged (`!runningTestId && lastDashboardRunId`). After a test completes:
- `runningTestId` is set to `null`
- `lastDashboardRunId` is set to the completed run's ID

At this point the first card (now always rendered) shows the **idle fallback** (three status cards + "Run a test above…"). The `lastDashboardRunId` card below it shows the completed run dashboard. The user now sees **two** cards: the idle status card above AND the last run card below. This is a **UX regression** — the design acknowledges this only partially ("this adds the idle fallback for when neither `runningTestId` nor `lastDashboardRunId` is set") but the current always-visible design means the idle status card is **always present even when `lastDashboardRunId` is set**, creating a redundant, confusing dual-card layout.

**Concrete fix:** The idle fallback must only render when `!runningTestId && !lastDashboardRunId`. The ternary should be three-way:

```jsx
{runningTestId ? (
  /* existing live iframe branch */
) : lastDashboardRunId ? (
  /* existing lastDashboardRunId card content — or suppress this card entirely and keep the separate one */
) : (
  /* idle status fallback */
)}
```

The design needs to explicitly address this three-state scenario.

---

### Finding 4 — MEDIUM: `rpt-topbar`, `rpt-title-row`, `rpt-title`, `rpt-sub`, `rpt-actions` are claimed as in `Report.css` — verified correct, but design table location label is misleading

**Location:** Design §Fix 2 audit table

The design's audit table lists these classes as present in `src/pages/Report.css` ✅. Searching `index.css` confirms they are **not** in `index.css`. This is correct. **However**, the design also lists `.rpt-back` and `.rpt-body` in the same `Report.css` ✅ row — but both of these ARE also in `index.css` (see Finding 2 above). This internal inconsistency in the audit table means the implementer cannot trust the audit as a complete picture.

**Concrete fix:** The audit table must have a separate column or annotation: "Also defined in index.css? Yes/No". The duplicates must be called out, not silently omitted.

---

### Finding 5 — MEDIUM: Design's `load` modification in Dashboard does not handle the case where `t.data` is `{}` (empty object from `.catch`)

**Location:** Design §Fix 3a error handling, `if (t.data) setTelemetry(t.data)`

The design keeps the existing `if (t.data) setTelemetry(t.data)` guard. When `/telemetry-status` fails, the `.catch(() => ({ data: {} }))` returns `{ data: {} }`. An empty object `{}` is **truthy** in JavaScript, so `setTelemetry({})` is called. This **clears all telemetry state** — `grafana_online`, `influxdb_online`, `grafana_base_url`, and `grafana_dashboard_path` are all wiped to `undefined`, not their safe defaults.

The design's error handling matrix says "Telemetry defaults to offline state" when the endpoint fails — **this is wrong**. The state becomes `{}` (all fields undefined), not the `{ grafana_online: false, influxdb_online: false, ... }` initial state. The pill bar would show `undefined` for `telemetry.grafana_online` (which is falsy — so it would show amber "Offline"), but `telemetry.grafana_base_url` would be `undefined` causing the RunTest fallback panel to show `undefined` instead of `http://localhost:3000`.

**Concrete fix:** Change the guard to check for non-empty data:

```js
if (t.data && Object.keys(t.data).length > 0) setTelemetry(t.data);
```

Or use a spread merge to preserve defaults:

```js
if (t.data && Object.keys(t.data).length > 0) {
  setTelemetry(prev => ({ ...prev, ...t.data }));
}
```

---

### Finding 6 — MEDIUM: Design claims `.rpt-topbar` etc. are located in `Report.css` but the design's audit table entry for `src/pages/Report.css` does NOT correspond to `index.css` lines ~590–900 — line numbers are not verifiable

**Location:** Design §Fix 2, audit table, first column "Location already defined"

The design states line numbers in `index.css` for every class group: "lines ~640–660", "lines ~665–675", etc. Reading the actual `index.css` (offsets 0–1100+):

- `.rt-body` is found at the `/* RUN & MONITOR */` section, not at "~640" — it is at approximately line 645 (after counting the full CSS, the "Run & Monitor" section begins around line 640). These approximate line numbers are close enough to not be wrong.

However, the design states that `.rpt-topbar`, `.rpt-title-row`, `.rpt-title`, `.rpt-sub`, `.rpt-actions`, `.rpt-back`, `.rpt-body` are in `src/pages/Report.css` ✅ — but then also says `.rpt-body` is NOT in `index.css`. This contradicts the verified fact that `.rpt-body` IS in `index.css` at line 750. The design is internally inconsistent on this point.

This is subsumed by Finding 2 — calling it out separately here as it directly misleads the implementer about which file to check.

**Concrete fix:** Combine with Finding 2's resolution. The audit table should have been produced by automated search, not manual reading.

---

### Finding 7 — MEDIUM: Dashboard `telemetry` state initializer is missing `k6_dashboard_online` field — FR-5.2 "always Ready" pill relies on a literal `true` hardcode in JSX

**Location:** Design §Fix 3b / `src/pages/Dashboard.jsx`

The Dashboard `telemetry` state initializer is:
```js
const [telemetry, setTelemetry] = useState({
  grafana_online: false, influxdb_online: false,
  grafana_base_url: "http://localhost:3000",
  grafana_dashboard_path: "/d/adfqsh7/k6-load-testing-results",
});
```

Note that `k6_dashboard_online` is **absent** from the Dashboard's `telemetry` state (it is present in `RunTest.jsx`'s telemetry state, but not in `Dashboard.jsx`'s). The design's pill bar JSX for the k6 Engine pill hardcodes the "always Ready" label and green dot directly in the JSX (no conditional on any state field), which is correct per FR-5.2. But the design's A3 note says "Dashboard component can use `true` as a default since the k6 engine is co-located" — this is only correct if the pill JSX does **not** attempt to read `telemetry.k6_dashboard_online`. The provided pill JSX correctly hardcodes the green state, so this is not a runtime bug.

**The issue:** the design claims in the Assumptions section that "A3 (validated): `telemetry.k6_dashboard_online` is already in RunTest state initialiser as `true`; Dashboard telemetry state does not have this field but Fix 3 does not need it." This is correct reasoning but should be stated as a deliberate design decision, not buried in the Assumptions. If a future implementer sees `k6_dashboard_online` used in the RunTest fallback panel and also reads the Dashboard telemetry type, they may try to add it to Dashboard — but that would produce an inconsistency with the `/telemetry-status` API response overwriting it.

**Concrete fix:** Add an explicit note in Fix 3b: "The k6 pill uses hardcoded `true` — do not add `k6_dashboard_online` to the Dashboard telemetry initializer. The `/telemetry-status` endpoint does not reliably set this field client-side."

---

### Finding 8 — NIT: The design references `--bg4` for `.rpt-output-header` but `--bg4` is not defined in the same token palette description

**Location:** Design §Fix 2 CSS snippet for `.rpt-output-header`

```css
.rpt-output-header {
  ...
  background: var(--bg4);
}
```

`--bg4` IS defined in the `:root` block of `index.css` as `#1c283f`. The design's token cross-reference section ("All three tokens (`--bg2`, `--bg4`, `--border`, `--r3`, `--tx`) are defined in `:root`") correctly lists it. This is accurate — no runtime issue — but the design failed to list `--bg4` in its initial statement "All three tokens (`--bg2`, `--bg4`, ...)": it says "three" but lists five. Minor prose error.

**Concrete fix:** Change "All three tokens" to "All five tokens."

---

### Finding 9 — NIT: The design's §Fix 4 header comment "...tab buttons remain visible" contradicts the idle-state tab behaviour description

**Location:** Design §Fix 4, "Header tab buttons when idle"

The design says: "When `!runningTestId`, the tab buttons … continue to be rendered as they are today; the tab state is irrelevant when no iframe is shown." This is consistent with FR-6.4.

But the tab buttons switch `activeTab` state between `"k6"` and `"grafana"`. When no test is running, clicking "Grafana View" tab would set `activeTab = "grafana"`. When a new test is then started, the iframe would immediately load Grafana (not k6 Native). This is a pre-existing behaviour, not a regression from this change. The design should note this explicitly rather than leaving it ambiguous with "tab state is irrelevant."

**Concrete fix:** Add: "The `activeTab` state persists across the idle/live transition. If a user clicks the Grafana tab while idle and then starts a test, the Grafana iframe will be shown first. This is acceptable existing behaviour."

---

## Verified Assumptions

| # | Assumption | Verified? | Evidence |
|---|---|---|---|
| A1 | Most classes from FR-3 already exist in CSS files; only add genuinely absent ones | **Partially verified** — most `rt-*`, `hist-*`, `dash-*`, and `sort-*` classes exist in `index.css`. `rpt-output-*` trio is absent from all CSS files. However, the audit missed pre-existing duplicates between `Report.css` and `index.css`. |
| A2 | `--text-muted` maps to `--tx3` | **Verified** — `--tx3: #64748b` in `:root`; `--text-muted` does not exist in `index.css`. The mapping is correct. |
| A3 | `telemetry.k6_dashboard_online` is in RunTest state as `true` | **Verified** — `src/pages/RunTest.jsx` line 102: `k6_dashboard_online: true`. Dashboard `telemetry` state does not have this field, confirmed by reading `Dashboard.jsx`. |
| A4 | Idle telemetry panel uses static status grid (no blank iframe) | **Verified by design** — the JSX uses `<div>` cards, not `<iframe>`. Correct approach. |
| A5 | `lastDashboardRunId` is the correct sentinel for post-run display | **Verified** — `src/pages/RunTest.jsx` confirms `lastDashboardRunId` is set in `pollForResult` when test finishes. The `lastDashboardRunId` card guard `!runningTestId && lastDashboardRunId` exists at the bottom of RunTest. The concern from Finding 3 is about the interaction, not the sentinel itself. |

---

## Unverified / Wrong Assumptions

| # | Claim in design | Status | Evidence |
|---|---|---|---|
| Fix 2 audit | `.rpt-topbar`, `.rpt-title-row`, `.rpt-title`, `.rpt-sub`, `.rpt-actions` are only in `Report.css` | **Correct** (verified: absent from `index.css`) | grep of `index.css` returns no matches |
| Fix 2 audit | `.rpt-back`, `.rpt-body`, `.verdict-card`, `.verdict-pass`, `.verdict-fail`, `.verdict-left`, `.rpt-kpis`, `.rpt-kpi-card` etc. are only in `Report.css` | **WRONG** — they exist in BOTH `Report.css` AND `index.css` | See `index.css` lines 750–780; `Report.css` lines 2–55. Both files define these classes with slight variations. |
| Fix 3a error matrix | "Telemetry defaults to offline state" when `/telemetry-status` fails | **WRONG** — `setTelemetry({})` is called, wiping defaults to `undefined` | `if (t.data) setTelemetry(t.data)` — `{}` is truthy; `telemetry.grafana_base_url` becomes `undefined` |
| Fix 3a | `load` defined after `useEffect` — "safe because state setters are stable" | **Not documented, risks silent regression** — the design does not document the stale closure or why it's safe; implementer has no guidance | Verified in `Dashboard.jsx`: `useEffect` is line 37, `const load` is line 39; the design omits discussion of this ordering |
| Fix 4 | Always-visible card + `lastDashboardRunId` card creates no UX issue | **WRONG** — when `!runningTestId && lastDashboardRunId`, the always-visible idle fallback and the `lastDashboardRunId` card both render simultaneously, creating a confusing dual-card state | Structural analysis of RunTest.jsx JSX confirms both cards will render |

---

## Verdict

Findings by severity:
- HIGH: 3 (Findings 1, 2, 3)
- MEDIUM: 4 (Findings 4, 5, 6, 7)
- NIT: 2 (Findings 8, 9)

**CHANGES_REQUESTED**

The three HIGH findings must be resolved before implementation:
1. The `load` stale-closure / hoisting issue in Dashboard must be addressed (move before `useEffect` or use `useCallback`).
2. The pre-existing CSS duplicates between `Report.css` and `index.css` must be documented and the authoritative copy must be declared.
3. The three-state idle/running/post-run scenario in RunTest must be handled — the always-visible idle card must suppress itself when `lastDashboardRunId` is set.
