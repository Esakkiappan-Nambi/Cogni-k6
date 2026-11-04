# Requirements: SSE-Based Live Metrics Streaming for K6 Portal

## Summary

The K6 Portal currently exposes live test metrics through two mechanisms that both fail in practice:
the k6 web-dashboard at port 5665 only exists while a test is running (so it cannot be embedded reliably in an iframe), and the InfluxDB → Grafana pipeline is offline in the target environment (so Grafana panels show "No data"). The exported-HTML fallback in `RunTest.jsx` also fails because the iframe src (`/dashboard-report/{run_id}`) endpoint does not exist.

This feature replaces the iframe-based live telemetry panel with a **self-contained, zero-external-dependency live metrics system**:

- A FastAPI **Server-Sent Events (SSE) endpoint** parses k6's stdout line by line while the test runs and pushes metric snapshots to any connected browser tab.
- A **polling fallback endpoint** provides the same data for environments where `EventSource` is blocked.
- The `RunTest.jsx` page renders those snapshots in a **React/Recharts live dashboard** with KPI cards and a multi-line time-series chart — no iframe, no Grafana, no InfluxDB.
- `Dashboard.jsx` receives a minor correctness fix to its `load` function so its 30-second auto-refresh does not fail silently.

No new Python packages are introduced. No existing endpoints, DB schema, PDF reports, or test-run flow are changed.

---

## Assumptions

1. **k6 stdout format is deterministic enough for regex.** The regex patterns in the feature request match the standard k6 text-summary output. If k6 is configured to suppress text output (e.g. `--no-summary`), the parser will produce zeroes — this is acceptable behaviour (no crash, just empty metrics).
2. **`execute_k6` in `k6_runner.py` currently captures stdout.** Inspection confirms it already uses `subprocess.Popen` and reads stdout. The change is to also call `parse_k6_line` on each line read so that `live_metrics` is populated in real time.
3. **`run_k6_in_background` is the authoritative reader of the k6 process stdout.** The SSE endpoint reads from the shared `live_metrics` dict (not directly from the pipe) to avoid two consumers fighting over the same file descriptor.
4. **The frontend is served at `http://localhost:5173`** (Vite default). The existing CORS config already includes this origin.
5. **Recharts ≥ 3.x API is used.** `package.json` shows `"recharts": "^3.8.1"`. The Recharts 3.x API (e.g. `LineChart`, `CartesianGrid`, `XAxis`, `YAxis`, `Tooltip`, `Legend`, `Line` from `recharts`) is available.
6. **`Dashboard.jsx` `load` stale-closure issue.** Inspection shows `load` is declared as a plain `async` function (not wrapped in `useCallback`), and the `useEffect` that calls `load(true)` in an interval captures the initial closure. This is technically harmless in this specific case because `load` has no external dependencies other than stable `setX` dispatchers — but the feature request asks for an explicit `useCallback` fix, so it is included.
7. **The `live_metrics` dict is in-process memory only.** It is not persisted to the database. After a process restart, historical live metrics are lost; only post-run DB reports survive. This is acceptable.
8. **Concurrency model.** FastAPI runs on a single Uvicorn worker. The background thread (k6 runner) writes to `live_metrics`, and the async SSE generator reads from it. A plain dict update in CPython is effectively atomic for simple key/value writes, so no lock is required for the basic metric fields.
9. **Maximum series length is 120 data points** (one per second → 2 minutes of visible history in the chart). Older points are discarded on the frontend.
10. **`asyncio` is already available** as a standard-library module; no new package is needed for `asyncio.sleep` in the SSE generator.

---

## Functional Requirements

### FR-1: Shared Live Metrics Store (Backend)

**FR-1.1** `Backend/main.py` must declare a module-level dict `live_metrics: dict = {}` that maps integer `run_id` to a metric snapshot dict with keys: `vus`, `rps`, `p95`, `p90`, `avg_rt`, `errors`, `checks`, `total_reqs`, `ts`, `run_id`, `done`.

**FR-1.2** A function `parse_k6_line(line: str, run_id: int)` must be defined (importable from `main.py` or colocated in the backend) that:
- Creates a default snapshot entry in `live_metrics` if none exists for `run_id`.
- Updates `ts` to the current epoch millisecond on every call.
- Extracts and updates `vus` from lines matching `(\d+) VUs?`.
- Extracts and updates `total_reqs` and `rps` from lines matching `http_reqs[.\s]+:\s+(\d+)\s+([\d.]+)/s`.
- Extracts and updates `avg_rt`, `p90`, `p95` from lines matching `avg=`, `p(90)=`, `p(95)=` patterns, converting `s` unit to `ms`.
- Extracts and updates `errors` from lines matching `http_req_failed[.\s]+:\s+([\d.]+)%`.
- Extracts and updates `checks` from lines matching `checks[.\s]+:\s+([\d.]+)%`.
- Does not raise an exception for lines that match nothing.

**FR-1.3** `run_k6_in_background` in `Backend/main.py` must call `parse_k6_line(line, test_run_id)` for each line read from the k6 process output.

**FR-1.4** When `run_k6_in_background` finishes (success, failure, or stop), it must set `live_metrics[run_id]["done"] = True` before returning.

### FR-2: SSE Metrics Stream Endpoint (Backend)

**FR-2.1** `Backend/main.py` must expose `GET /metrics-stream/{run_id}` returning a `StreamingResponse` with `media_type="text/event-stream"`.

**FR-2.2** The response must include HTTP headers:
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no`

**FR-2.3** While the test run is active (`live_metrics[run_id]["done"]` is `False` or the key does not yet exist), the generator must:
- Sleep 1 second between polls (using `asyncio.sleep(1)`).
- Yield the current snapshot as `data: {json_payload}\n\n` on each iteration.

**FR-2.4** When the snapshot's `done` field is `True`, the generator must yield one final event with `done: true` in the payload, then stop streaming.

**FR-2.5** If no snapshot exists for `run_id` after 60 seconds of polling (60 iterations), the generator must stop and yield `data: {"error": "run_not_found", "run_id": <id>}\n\n`.

**FR-2.6** The endpoint must handle client disconnect gracefully: if the client closes the connection, the generator must exit without raising an unhandled exception (catch `GeneratorExit` or equivalent).

**FR-2.7** The endpoint must not require authentication (no `Depends(get_current_user)`) so the browser's native `EventSource` can connect without custom headers.

### FR-3: Polling Fallback Endpoint (Backend)

**FR-3.1** `Backend/main.py` must expose `GET /live-metrics/{run_id}` returning a plain JSON object.

**FR-3.2** If `live_metrics[run_id]` exists, return the current snapshot.

**FR-3.3** If no snapshot exists for `run_id`, return `{"run_id": <id>, "vus": 0, "rps": 0, "p95": 0, "p90": 0, "avg_rt": 0, "errors": 0, "checks": 0, "total_reqs": 0, "ts": 0, "done": false}`.

**FR-3.4** The endpoint must not require authentication.

### FR-4: k6 Runner Stdout Capture (Backend)

**FR-4.1** `execute_k6` in `Backend/k6_runner.py` must use `stdout=subprocess.PIPE, stderr=subprocess.STDOUT` so both streams are merged and readable line by line.

**FR-4.2** The function must read stdout incrementally (line by line) rather than waiting for the process to finish before reading output, so that `run_k6_in_background` can parse lines in near-real time.

**FR-4.3** The existing return signature `(output: str, summary_data: dict, summary_path: str)` must be preserved so all existing callers continue to work.

### FR-5: Live Metrics Dashboard Component (Frontend)

**FR-5.1** `Frontend/k6-UI/src/pages/RunTest.jsx` must define an internal component `LiveMetricsDashboard({ runId, onFinish })`.

**FR-5.2** On mount, `LiveMetricsDashboard` must attempt to connect to `http://127.0.0.1:8000/metrics-stream/{runId}` via `EventSource`.

**FR-5.3** On each `onmessage` event, the component must:
- Parse the JSON payload.
- If `data.done === true`: set a `done` state flag, close the `EventSource`, and call `onFinish(data)` if provided.
- Otherwise: update a `current` state (the latest snapshot) and append a time-series entry `{ t, vus, rps, p95, errors }` to a `series` state array, keeping at most 120 entries.

**FR-5.4** On `EventSource` error, the component must close the `EventSource` and fall back to polling `GET /live-metrics/{runId}` every 2 seconds via `API.get`. The polling must stop when `data.done` is `true`.

**FR-5.5** On unmount, the component must close any open `EventSource` and clear any polling interval.

**FR-5.6** The component must render four KPI cards displaying: **Current VUs**, **RPS**, **P95 Latency (ms)**, **Error Rate (%)**.

**FR-5.7** KPI card visual style:
- VUs card background: `rgba(99, 102, 241, 0.08)`, border: `1px solid rgba(99, 102, 241, 0.2)`.
- RPS card background: `rgba(16, 185, 129, 0.08)`, border: `1px solid rgba(16, 185, 129, 0.2)`.
- P95 card background: `rgba(245, 158, 11, 0.08)`, border: `1px solid rgba(245, 158, 11, 0.2)`.
- Error Rate card background: `rgba(244, 63, 94, 0.08)`, border: `1px solid rgba(244, 63, 94, 0.2)`.
- Metric value: `font-size: 28px; font-weight: 700`.
- Label: `font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em`.

**FR-5.8** The component must render a Recharts `LineChart` with:
- Time (`t`) on the X-axis.
- Left Y-axis for VUs and RPS.
- Right Y-axis for P95 latency (ms).
- Four `Line` series: VUs (left axis), RPS (left axis), P95 ms (right axis), Error Rate % (right axis or overlaid).
- A `Tooltip` and `Legend`.
- Responsive container (`ResponsiveContainer` width `100%` height `260px`).

**FR-5.9** When `done` is true, the component must display a "Run Complete" summary section showing final values from the last received snapshot.

**FR-5.10** When `series` is empty (no data received yet), the component must show a loading / waiting indicator rather than a blank chart.

### FR-6: Telemetry Panel Integration (Frontend)

**FR-6.1** In `RunTest.jsx`, the **State A** live view (test is running) must render `<LiveMetricsDashboard runId={activeRunId} onFinish={...} />` instead of the iframe pointing to `localhost:5665`.

**FR-6.2** The **State B** post-run view (test just finished) must also render `<LiveMetricsDashboard runId={lastDashboardRunId} />` showing the final frozen series, instead of the iframe pointing to `/dashboard-report/{run_id}`.

**FR-6.3** The **State C** idle view (no run) must continue to show the service status panel (k6 / InfluxDB / Grafana status cards and the how-to guide) unchanged.

**FR-6.4** The `onFinish` callback passed to `LiveMetricsDashboard` must not change the running/stopped UI state by itself — that continues to be driven by the existing `pollForResult` mechanism.

### FR-7: Dashboard.jsx Load Function Fix

**FR-7.1** The `load` function in `Dashboard.jsx` must be wrapped with `useCallback` so that the `useEffect` interval captures a stable reference and the `setX` calls are not stale.

**FR-7.2** The `useEffect` dependency array must include `load` (the memoized callback).

**FR-7.3** The `load` function must accept a `silent` boolean parameter (defaulting to `false`) that suppresses the full-page loading spinner when `true`, consistent with its existing usage in the auto-refresh interval.

---

## Non-Functional Requirements

**NFR-1: No new dependencies.** The implementation must use only packages already present in `requirements.txt` (FastAPI, Starlette `StreamingResponse`, standard-library `asyncio`, `re`, `time`) and packages already in `package.json` (`recharts` is already installed).

**NFR-2: Build must pass.** `npm run build` from the frontend directory must exit with code 0 and zero errors. `python -m py_compile` on both modified Python files must exit with code 0.

**NFR-3: No regressions.** All existing endpoints (`/run-test`, `/stop-test`, `/report`, `/create-test`, `/update-test`, `/delete-test`, `/preview-step`, `/preview-script`, and all router-mounted endpoints) must continue to function without change.

**NFR-4: Graceful degradation.** If k6 produces output in a format the regex does not match (e.g. JSON output mode, custom log format), metrics default to zero rather than crashing the SSE stream or the background runner.

**NFR-5: Memory.** The `live_metrics` dict accumulates one entry per run. Entries are not automatically evicted. This is acceptable for a development/QA tool where the server is restarted periodically. An optional cleanup (removing entries for runs more than 24 hours old) is out of scope for this iteration.

**NFR-6: SSE compatibility.** The `EventSource` API is supported natively in all modern browsers. The polling fallback covers older browsers or environments with proxy buffering.

---

## Acceptance Criteria

1. **AC-1 (SSE endpoint exists):** `GET http://127.0.0.1:8000/metrics-stream/999` returns HTTP 200 with `Content-Type: text/event-stream` and immediately begins streaming `data:` lines.

2. **AC-2 (Live metrics populated):** When a k6 test is running, `GET /live-metrics/{run_id}` returns a JSON object with non-zero `ts` within 3 seconds of the test starting.

3. **AC-3 (VU count parsed):** The `vus` field in `/live-metrics/{run_id}` reflects the configured virtual user count within 5 seconds of test start (assuming k6 logs a `VUs` progress line).

4. **AC-4 (RPS parsed):** The `rps` field in `/live-metrics/{run_id}` is greater than zero once k6 has issued at least one `http_reqs` summary line.

5. **AC-5 (Done flag set):** After the test finishes, `/live-metrics/{run_id}` returns `"done": true`.

6. **AC-6 (SSE done event):** The SSE stream for an active run sends a final event with `"done": true` in the payload after the k6 process exits.

7. **AC-7 (Frontend renders KPI cards):** While a test is running, the RunTest page shows four KPI cards (VUs, RPS, P95, Error Rate) with non-zero values within 5 seconds of test start.

8. **AC-8 (Frontend renders chart):** While a test is running, the RunTest page shows a Recharts `LineChart` with at least one data point within 5 seconds of test start.

9. **AC-9 (No iframe for live view):** Inspecting the DOM of the RunTest page while a test is running shows no `<iframe>` element referencing `localhost:5665` or `/dashboard-report/`.

10. **AC-10 (Post-run chart persists):** After a test finishes, the RunTest page continues to display the LiveMetricsDashboard with the final series data and a "Run Complete" banner — not a blank panel.

11. **AC-11 (Idle state unchanged):** When no test has been run in the current session, the RunTest page shows the service status cards (k6 / InfluxDB / Grafana) and the how-to guide, not a chart.

12. **AC-12 (SSE fallback polling):** If the `EventSource` connection emits an error event (simulated by disabling the SSE endpoint), the frontend falls back to polling `/live-metrics/{run_id}` every 2 seconds and continues updating the KPI cards.

13. **AC-13 (Frontend build passes):** Running `npm run build` from `Frontend/k6-UI` exits with code 0 and zero errors.

14. **AC-14 (Backend syntax clean):** `python -m py_compile Backend/main.py` and `python -m py_compile Backend/k6_runner.py` both exit with code 0.

15. **AC-15 (Dashboard auto-refresh works):** The Dashboard page's 30-second auto-refresh interval correctly calls the memoized `load(true)` without a "stale closure" React warning in the console.

16. **AC-16 (Existing endpoints unaffected):** After the changes, `POST /run-test/{id}`, `POST /stop-test/{id}`, `GET /report/{run_id}`, and `GET /tests` all return correct responses identical to their pre-change behaviour.

17. **AC-17 (CORS allows new endpoints):** `OPTIONS http://127.0.0.1:8000/metrics-stream/1` and `OPTIONS http://127.0.0.1:8000/live-metrics/1` return HTTP 200 with `Access-Control-Allow-Origin: http://localhost:5173`.

---

## Out of Scope

- **InfluxDB or Grafana integration changes.** The Grafana tab and InfluxDB status indicators remain as-is; this feature does not fix or remove them.
- **Authentication on SSE/polling endpoints.** The two new endpoints are intentionally unauthenticated (browsers cannot send `Authorization` headers via native `EventSource`). Adding token-based auth (e.g. via query parameter) is a future hardening task.
- **Persistent live metrics storage.** Metrics are in-process memory only; they are not written to the database and are lost on server restart.
- **Long-term `live_metrics` eviction.** Automatic cleanup of old entries from the dict is not required in this iteration.
- **k6 JSON output mode parsing.** Only k6's default text/console output is parsed. JSON output mode (`--out json`) is not targeted.
- **Multi-worker / multi-process Uvicorn deployments.** The shared dict approach only works with a single Uvicorn worker, which is the current deployment model.
- **Changes to PDF report generation, CSV handling, cookie/cache managers, scheduler, recorder router, or any other existing feature.**
- **Mobile-responsive chart layout.** The chart renders correctly at desktop widths (≥ 1024 px); further mobile breakpoints are not in scope.
