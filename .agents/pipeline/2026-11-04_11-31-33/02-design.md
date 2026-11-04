# Technical Design: SSE-Based Live Metrics Streaming for K6 Portal

## Overview

This design replaces the unreliable iframe/Grafana telemetry panel in `RunTest.jsx` with a self-contained live metrics system that works with zero external dependencies. The backend grows a shared in-memory dict (`live_metrics`) populated by the existing background runner thread as it reads k6's stdout. Two new FastAPI endpoints expose that data: an SSE streaming endpoint and a JSON polling fallback. The frontend `LiveMetricsDashboard` React component subscribes to the SSE stream and renders KPI cards plus a Recharts `LineChart`. The existing test-run flow, DB writes, PDF reports, and all other endpoints remain unchanged.

The architecture deliberately avoids two readers competing for the same pipe: `execute_k6` (in `k6_runner.py`) reads stdout line-by-line and returns the full accumulated output string as before, but now also calls a shared `parse_k6_line` function (defined in `main.py`) after each line. The SSE generator reads only from the `live_metrics` dict, polling it on an asyncio sleep loop. This single-producer / many-readers pattern is safe in CPython because dict writes on simple key/value assignments are GIL-protected and effectively atomic.

---

## Technology Stack (locked)

- **Backend:** Python 3, FastAPI, Starlette `StreamingResponse`, standard-library `asyncio`, `re`, `time`, `subprocess` — all already in use.
- **Frontend:** React 19, Recharts 3.8.1 (already in `package.json`), native browser `EventSource`, `axios` via the existing `API` service.
- No new packages on either side.

---

## Backend Design

### 1. `live_metrics` Global Dict and `parse_k6_line` (in `Backend/main.py`)

A module-level dict is added immediately after the existing `running_processes` declaration:

```python
live_metrics: dict = {}   # run_id (int) → metric snapshot dict
```

The `parse_k6_line` function is placed near `extract_metrics` so both metric helpers are co-located. It takes a raw k6 output line and a `run_id`, uses `live_metrics.setdefault` to create a zero-valued entry on first call, updates `ts` on every call, and applies six independent regex matches (VUs, http_reqs rate, avg/p90/p95 latency, error rate, checks). None of these branches raise on mismatch — they simply skip. Unit conversion from `s` to `ms` is handled inside the function. The full implementation is as specified in the feature request; no changes are needed to the regex logic itself.

**Placement:** The function body is inserted between `extract_metrics` and `_normalise_step`. Both `import re` (already present) and `import time` (already present at the top of `main.py`) are in scope.

### 2. `run_k6_in_background` Changes (in `Backend/main.py`)

`run_k6_in_background` currently calls `execute_k6(script_path, test_run_id, on_process_created=on_started)` and receives `(output, summary_data, summary_path)`. After the change, `execute_k6` returns an additional fourth value: the line-by-line iterator is not exposed; instead `execute_k6` accepts an optional `line_callback` parameter. See §3 below for the contract.

After `execute_k6` returns, `run_k6_in_background` must set `live_metrics[test_run_id]["done"] = True` (using `live_metrics.setdefault(test_run_id, {})["done"] = True` to be safe even if no lines were parsed). This is placed in a `finally` block at the end of the try/except so it fires even on exception, preventing the SSE generator from waiting forever.

### 3. `execute_k6` Changes (in `Backend/k6_runner.py`)

**Problem with the current implementation:** `execute_k6` currently calls `process.communicate()`, which buffers all stdout/stderr until the process exits. This means `run_k6_in_background` only gets the output string after the test finishes — too late for live parsing.

**Change:** Replace `process.communicate()` with a line-by-line read loop:

```python
# New approach: read stdout line by line
lines = []
for raw_line in process.stdout:
    line = raw_line.rstrip('\n')
    lines.append(line)
    if line_callback:
        line_callback(line)

process.wait()
stdout = '\n'.join(lines)
# stderr was merged into stdout via stderr=subprocess.STDOUT, so stderr = ""
stderr = ""
output = stdout
```

The Popen call is changed to use `stderr=subprocess.STDOUT` (merging stderr into stdout so one reader handles both):

```python
process = subprocess.Popen(
    k6_cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.STDOUT,   # merge stderr into stdout
    text=True,
    encoding="utf-8",
    errors="ignore",
    env=env
)
```

The function signature gains an optional parameter `line_callback: callable = None`. The return value `(output, summary_data, summary_path)` is unchanged.

**Caller update in `run_k6_in_background`:** The call becomes:

```python
output, summary_data, summary_path = execute_k6(
    script_path, test_run_id,
    on_process_created=on_started,
    line_callback=lambda line: parse_k6_line(line, test_run_id),
)
```

This cleanly decouples the parsing logic (which lives in `main.py` and has access to `live_metrics`) from the subprocess management (which lives in `k6_runner.py`).

**Existing callers:** Only `run_k6_in_background` and `run_scheduled_test` call `execute_k6`. Both callers in `main.py` are updated; `run_scheduled_test` gets `line_callback=lambda line: parse_k6_line(line, run_id)` too so scheduled runs also populate `live_metrics`. The `preview_script` endpoint does not call `execute_k6`, so it is unaffected.

### 4. SSE Endpoint `GET /metrics-stream/{run_id}` (in `Backend/main.py`)

```python
from fastapi.responses import StreamingResponse
import asyncio

@app.get("/metrics-stream/{run_id}")
async def metrics_stream(run_id: int):
    async def event_generator():
        waited = 0
        try:
            while True:
                snapshot = live_metrics.get(run_id)
                if snapshot is None:
                    waited += 1
                    if waited >= 60:
                        yield f'data: {{"error":"run_not_found","run_id":{run_id}}}\n\n'
                        return
                    await asyncio.sleep(1)
                    continue

                waited = 0  # reset once run appears
                payload = json.dumps(snapshot)
                yield f"data: {payload}\n\n"

                if snapshot.get("done"):
                    return

                await asyncio.sleep(1)
        except GeneratorExit:
            pass  # client disconnected

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
```

**Why async generator instead of a thread:** FastAPI's `StreamingResponse` with an async generator runs in the event loop. Using `asyncio.sleep(1)` yields control correctly without blocking the event loop between polls. The background k6 thread writes to `live_metrics` independently; the async generator only reads from it.

**Client disconnect:** `GeneratorExit` is raised when the generator's `close()` is called (FastAPI/Starlette handles this when the client disconnects). Catching it silently is the correct pattern for SSE generators.

**Authentication:** No `Depends(get_current_user)` because browsers cannot attach `Authorization` headers to native `EventSource`.

**CORS:** Already covered — the existing `CORSMiddleware` with `allow_origins=["http://localhost:5173","http://10.10.40.107:5173"]` and `allow_methods=["*"]` covers all routes including these new ones. No CORS change needed.

### 5. Polling Endpoint `GET /live-metrics/{run_id}` (in `Backend/main.py`)

```python
@app.get("/live-metrics/{run_id}")
def live_metrics_snapshot(run_id: int):
    snapshot = live_metrics.get(run_id)
    if snapshot is None:
        return {
            "run_id": run_id, "vus": 0, "rps": 0.0, "p95": 0.0, "p90": 0.0,
            "avg_rt": 0.0, "errors": 0.0, "checks": 0.0,
            "total_reqs": 0, "ts": 0, "done": False,
        }
    return snapshot
```

This is a sync endpoint (no `async def`) consistent with other query endpoints in `main.py`. No auth.

### 6. `run_scheduled_test` Update

The codebase also contains a `run_scheduled_test` function (called from the APScheduler). It calls `run_k6_in_background`. No change is needed there since `run_k6_in_background` is the single point updated.

---

## Frontend Design

### 7. `LiveMetricsDashboard` Component (in `RunTest.jsx`)

The component is defined as a named function *inside* `RunTest.jsx`, above the `RunTest` default export. It is not exported; it is a file-private component. This avoids creating a new file and matches the existing pattern in `RunTest.jsx` (the `Pagination` component is also defined inline).

**State:**

| State var | Type | Purpose |
|---|---|---|
| `series` | `Array<{t,vus,rps,p95,errors}>` | Time series, max 120 points |
| `current` | `{vus,rps,p95,errors,avg_rt,total_reqs,checks}` | Latest snapshot |
| `done` | `boolean` | Whether the run has finished |
| `connected` | `boolean` | SSE connected (for loading indicator) |

**SSE connection lifecycle:**

```jsx
useEffect(() => {
  if (!runId) return;
  const es = new EventSource(`http://127.0.0.1:8000/metrics-stream/${runId}`);
  esRef.current = es;
  setConnected(false);

  es.onopen = () => setConnected(true);

  es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.error) { es.close(); startPolling(); return; }
    if (data.done) {
      setDone(true);
      setCurrent(data);
      setSeries(prev => appendPoint(prev, data));
      es.close();
      if (onFinish) onFinish(data);
      return;
    }
    setConnected(true);
    setCurrent(data);
    setSeries(prev => appendPoint(prev, data));
  };

  es.onerror = () => { es.close(); startPolling(); };

  return () => { es.close(); stopPolling(); };
}, [runId]);
```

`appendPoint` is a pure helper: `prev => [...prev.slice(-119), { t: new Date(data.ts).toLocaleTimeString(), vus: data.vus, rps: data.rps, p95: data.p95, errors: data.errors }]`.

**Polling fallback (`startPolling`):** Uses a `useRef`-stored `setInterval` that calls `API.get(\`/live-metrics/${runId}\`)` every 2 seconds. If `data.done` is true or the component unmounts, the interval is cleared. The polling ref is also cleared in the `useEffect` cleanup. No double-polling risk because `startPolling` is only called from `es.onerror` and `es.onmessage` with `data.error`.

**Recharts chart:** Uses `ResponsiveContainer`, `LineChart`, `CartesianGrid`, `XAxis`, `YAxis` (two instances with different `yAxisId`), `Tooltip`, `Legend`, and four `Line` components from `recharts`. All are available in Recharts 3.x. The chart height is fixed at `260` inside `ResponsiveContainer height={260}`. The left axis handles VUs (integer) and RPS (float); the right axis handles P95 ms and Error %. All four lines use distinct colours:

| Metric | Colour | yAxisId |
|---|---|---|
| VUs | `#6366f1` (indigo) | `left` |
| RPS | `#10b981` (green) | `left` |
| P95 ms | `#f59e0b` (amber) | `right` |
| Error % | `#f43f5e` (rose) | `right` |

**Empty-state:** When `series.length === 0` and `!done`, show a centred `<Loader2 className="spinner" />` with the text "Waiting for metrics…" at `height: 260px`. This prevents Recharts from rendering a blank/broken chart.

**"Run Complete" banner:** When `done === true`, render a green-tinted summary row above the chart showing `current.total_reqs`, `current.rps`, `current.p95`, `current.errors` as final values. The chart remains visible with the frozen series.

**KPI cards:** Four cards in a CSS grid (`display: grid; gridTemplateColumns: repeat(4, 1fr); gap: 10px`) rendered above the chart. Inline styles are used exactly as specified in the requirements (no new CSS classes needed, consistent with the rest of `RunTest.jsx` which uses heavy inline styles for the telemetry panel).

### 8. Integration into `RunTest.jsx` Telemetry Panel

The three conditional states (A, B, C) in the `rt-grafana-body` div are updated:

**State A (running):** Replace the `<iframe src="http://localhost:5665" ...>` with `<LiveMetricsDashboard runId={activeRunId} onFinish={handleLiveDone} />`. The tab switcher for "k6 Native" / "Grafana" is retained; the Grafana tab (when `telemetry.grafana_online`) still shows its iframe — that is not removed per requirements.

**State B (just finished):** Replace the `<iframe src="http://localhost:8000/dashboard-report/..."...>` with `<LiveMetricsDashboard runId={lastDashboardRunId} />`. Since the run is already done, the component will connect to SSE, receive an immediate `done: true` event (because `live_metrics[run_id].done` will already be true), render the final frozen series, and display the "Run Complete" banner.

**State C (idle):** No change — the service status cards and how-to guide are untouched.

**`handleLiveDone` callback:** A simple function `(data) => {}` (no-op or optional future hook). The running/stopped UI state continues to be driven by `pollForResult` as before. This satisfies FR-6.4.

**Imports added:** `LineChart`, `Line`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `Legend`, `ResponsiveContainer` from `recharts`. These are added to the existing import block.

### 9. `Dashboard.jsx` Fix

The `load` function is converted from a plain `async` function inside the component body to a `useCallback`:

```jsx
const load = useCallback(async (silent = false) => {
  if (!silent) setLoading(true);
  try {
    const [s, r, t] = await Promise.all([
      API.get("/dashboard-stats"),
      API.get("/recent-tests"),
      API.get("/telemetry-status").catch(() => ({ data: {} })),
    ]);
    setStats(s.data || {});
    setRecent(r.data || []);
    if (t.data) setTelemetry(t.data);
  } catch (e) {
    console.error(e);
  } finally {
    setLoading(false);
  }
}, []);  // no external deps — setX functions are stable
```

The `useEffect` is updated to include `load` in its dependency array:

```jsx
useEffect(() => {
  load();
  const iv = setInterval(() => load(true), 30000);
  return () => clearInterval(iv);
}, [load]);
```

This eliminates the stale closure: the interval always captures the current `load` reference, and since `useCallback` with `[]` deps produces a stable function reference, the effect fires only once on mount.

---

## Error Handling

| Operation | Failure condition | Recoverable? | Caller receives | Logged |
|---|---|---|---|---|
| `parse_k6_line` — regex on malformed line | No match | Yes | No-op, metric unchanged | No (NFR-4) |
| `execute_k6` — process exits non-zero | Non-zero returncode | Fatal for the run | `output` string contains error text, `summary_data = {}` | Yes, via existing `[k6]` print statements |
| `execute_k6` — stdout readline raises | IOError / broken pipe | Fatal | Exception propagates to `run_k6_in_background`, which catches it and marks run as failed | Yes, `[k6] Exception: ...` |
| `run_k6_in_background` — `live_metrics` cleanup | Any exception | N/A | `done = True` is set in `finally` block so SSE generator terminates | Existing error handling unchanged |
| SSE generator — `asyncio.sleep` interrupted | `GeneratorExit` on client disconnect | Yes | Generator exits cleanly | No |
| SSE generator — `run_id` never appears | 60 s timeout | Yes | `{"error": "run_not_found"}` event, then stream closes | No |
| SSE generator — `json.dumps` failure | Should not occur (all values are primitives) | N/A | — | — |
| `EventSource` in browser — connection error | `onerror` fires | Yes | Component falls back to polling | No (silent fallback) |
| Polling fallback — API call fails | HTTP error | Yes (retried on next tick) | No UI update for that tick | No |
| `Dashboard.jsx` `load()` — any API fails | Network/auth error | Yes | `console.error(e)`, UI shows stale data | Console only |

---

## Validation Rules

| Input | Source | Type | Required | Limit | On failure |
|---|---|---|---|---|---|
| `run_id` in `/metrics-stream/{run_id}` | Path param | `int` | Yes | FastAPI validates automatically | 422 Unprocessable Entity |
| `run_id` in `/live-metrics/{run_id}` | Path param | `int` | Yes | FastAPI validates automatically | 422 Unprocessable Entity |
| `line` in `parse_k6_line` | k6 stdout | `str` | Yes | Any length; function reads only first match | No exception; all regex ops are optional |
| SSE `onmessage` data | JSON string from backend | `string` | Yes | Browser handles disconnect | `JSON.parse` error caught; no action |

---

## Invariants and Layer Ownership

- **`live_metrics[run_id]["done"] = True`** is set exclusively by `run_k6_in_background` in its `finally` block. The SSE generator only reads `done`; it never writes it. This ownership rule prevents race conditions where the generator might set `done` prematurely.
- **Series array length ≤ 120** is enforced exclusively in the frontend `appendPoint` helper via `prev.slice(-119)`. The backend has no knowledge of frontend buffer size.
- **One k6 process per `test_run_id`** is enforced by the existing `running_processes` dict in `main.py`. `live_metrics` follows the same keying scheme (`run_id = test_run_id`).

---

## Testability

**Unit testable (backend):**
- `parse_k6_line`: pure function operating on a string + a mutable dict. Feed it sample k6 output lines and assert dict values. No mocking needed.
- `live_metrics_snapshot` endpoint: call it directly with a pre-seeded `live_metrics` dict; assert JSON response.

**Integration testable (backend):**
- `metrics_stream` SSE endpoint: start a test async client, connect to the endpoint, seed `live_metrics[run_id]` from a separate thread, assert `data:` events arrive and `done` event closes the stream.

**Unit testable (frontend):**
- `LiveMetricsDashboard`: render with a mocked `EventSource` (replace `window.EventSource` in test setup), fire `onmessage` events, assert KPI card values update and `series` grows.
- `appendPoint` helper: pure function, test slice behaviour at 120 entries.

**Integration testable (frontend):**
- Cypress/Playwright: start a real test run, assert `<LiveMetricsDashboard>` appears, assert KPI card numbers change, assert no `<iframe>` in the DOM.

The SSE generator is the hardest to unit-test in isolation because it requires `asyncio` and a running event loop. A pytest `asyncio` fixture with `async for` iteration is the recommended approach, but this is beyond the scope of this design to prescribe as a deliverable test.

---

## Files Modified

| File | Change summary |
|---|---|
| `Backend/main.py` | Add `live_metrics` dict; add `parse_k6_line` function; add `import asyncio`; update `run_k6_in_background` to pass `line_callback` and set `done` flag; add `GET /metrics-stream/{run_id}`; add `GET /live-metrics/{run_id}` |
| `Backend/k6_runner.py` | Change `execute_k6` to use `stderr=subprocess.STDOUT`; replace `process.communicate()` with line-by-line read loop; add optional `line_callback` parameter |
| `Frontend/k6-UI/src/pages/RunTest.jsx` | Add `LiveMetricsDashboard` component; add Recharts imports; replace State A iframe with `<LiveMetricsDashboard>`; replace State B iframe with `<LiveMetricsDashboard>` |
| `Frontend/k6-UI/src/pages/Dashboard.jsx` | Wrap `load` in `useCallback`; add `load` to `useEffect` dependency array |

No other files are touched.

---

## Edge Cases

1. **Test runs for < 2 seconds (too fast for SSE to deliver data):** The `done: true` event is the first event the frontend receives. `LiveMetricsDashboard` sets `done = true`, renders the KPI cards with whatever values are in `current` (likely zeroes), shows the "Run Complete" banner, and the chart stays empty. This is correct behaviour.

2. **SSE consumer connects after the test has already finished:** `live_metrics[run_id]["done"]` is already `True`. The generator yields one event (the final snapshot with `done: true`) and then returns. The frontend receives it, shows the frozen state immediately.

3. **Two browser tabs watching the same run:** Both connect to the SSE endpoint. The generator is instantiated independently for each request; both read from the same `live_metrics[run_id]` dict. No state is shared between generators. Both tabs receive identical event streams.

4. **Test is stopped mid-run:** `run_k6_in_background` catches the exception / the process exits, marks `live_metrics[run_id]["done"] = True` in `finally`. The SSE generator delivers the final event. The frontend correctly shows the last known values.

5. **`live_metrics` entry missing for `run_id` (e.g. wrong run_id):** The SSE generator waits up to 60 seconds, then sends `{"error": "run_not_found"}` and closes. The frontend `onmessage` handler checks for `data.error` and falls back to polling; polling returns the zero-value dict from the `/live-metrics/{run_id}` fallback. No crash.

6. **k6 configured with `--out json` or `--no-summary`:** Console output is suppressed or reformatted. All regex matches return no result. `live_metrics` accumulates only the default zero values with updated `ts`. The chart shows flatlines. No crash (NFR-4).

7. **Recharts renders with an empty `series` array:** The loading state guard (`series.length === 0 && !done`) prevents `LineChart` from being rendered at all, avoiding the "no data" error Recharts 3.x emits when data is an empty array.

8. **`Dashboard.jsx` — `load` called before `useCallback` stabilises:** React guarantees `useCallback` returns a stable reference across renders when deps are `[]`. The effect fires once, calling `load()` immediately and scheduling the interval. No timing issue.
