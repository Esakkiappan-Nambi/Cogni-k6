# Design Review: SSE-Based Live Metrics Streaming for K6 Portal

**Design document:** `02-design.md`
**Requirements document:** `01-requirements.md`
**Source verified against:** `Backend/main.py`, `Backend/k6_runner.py`, `Frontend/k6-UI/src/pages/RunTest.jsx`, `Frontend/k6-UI/src/pages/Dashboard.jsx`, `Frontend/k6-UI/package.json`

---

## Findings

### Finding 1 — HIGH: `asyncio` is NOT already imported in `main.py`

**Where:** Design §4 (SSE Endpoint) states: "Add `import asyncio`" but elsewhere in Overview the design implies it is already present. More critically, the design's "Files Modified" table does list adding it — but the design body (§1) says both `import re` and `import time` are "already present" without making the same claim about `asyncio`. The SSE generator uses `asyncio.sleep(1)` inside an `async def` which requires `asyncio` to be importable by name in the module scope.

**Verification:** `grep "import asyncio" Backend/main.py` — **no match**. `asyncio` is only imported in `Backend/api_capture/capture.py` and `Backend/api_capture/auth_capture.py`, not in `main.py`.

**Impact:** The SSE endpoint will raise `NameError: name 'asyncio' is not defined` at runtime when the first client connects. The build (`py_compile`) will pass because the error is not a syntax error — it would only surface at request time.

**Fix:** Add `import asyncio` explicitly to the imports section at the top of `main.py`, alongside `import re` and `import time`. The design's "Files Modified" table already acknowledges this; the body text must make it equally unambiguous:

```python
# Add at the top of Backend/main.py, with the other stdlib imports
import asyncio
```

---

### Finding 2 — HIGH: `Dashboard.jsx` `load` is defined AFTER `useEffect` — moving to `useCallback` changes execution order

**Where:** Design §9 (`Dashboard.jsx` Fix).

**Verification:** Reading `Dashboard.jsx` shows the actual order is:

```js
useEffect(() => {
    load();           // line 39 — load is not yet declared here
    ...
}, []);

const load = async (silent = false) => { ... };  // line 44
```

The current code works because JavaScript function expressions (using `const`) are NOT hoisted — yet the `useEffect` callback is a closure that captures `load` by reference from the enclosing scope, and the closure only executes after the component mounts (after all declarations in the function body have run). So it accidentally works today.

**The bug the design introduces:** If the implementer naively moves `const load = useCallback(...)` to appear *before* `useEffect` (which is the standard pattern and what the design implies), they must also ensure `useCallback` is imported from React. The current `Dashboard.jsx` import is:

```js
import React, { useEffect, useState } from "react";
```

`useCallback` is **not imported**. Applying the design's fix verbatim without updating the import will cause a `ReferenceError: useCallback is not defined` at runtime and a build warning/error from the linter.

**Fix:** The "Files Modified" entry must explicitly state: update the React import to include `useCallback`:

```js
import React, { useEffect, useState, useCallback } from "react";
```

---

### Finding 3 — HIGH: Design §6 (`run_scheduled_test`) contains a factual error about the call chain

**Where:** Design §6 states: "The codebase also contains a `run_scheduled_test` function (called from the APScheduler). It calls `run_k6_in_background`. No change is needed there since `run_k6_in_background` is the single point updated."

**Verification:** Reading `main.py` confirms `run_scheduled_test` does **not** call `run_k6_in_background` directly — it spawns a `threading.Thread(target=run_k6_in_background, ...)`. This is not a meaningful execution difference, but the statement "it calls `run_k6_in_background`" is technically inaccurate and may confuse the implementer into thinking they need to change `run_scheduled_test`'s call signature.

More importantly: `run_k6_in_background` currently calls `execute_k6(script_path, test_run_id, on_process_created=on_started)`. The design changes this signature by adding `line_callback`. The `threading.Thread` call in `run_scheduled_test` passes `args=(test_id, run_id, script_path, assertions_raw)` — these are positional arguments to `run_k6_in_background`, which is the function being updated, not `execute_k6`. So `run_scheduled_test` is indeed unaffected. However, the design's assertion needs to be more precise to avoid confusion.

**Fix:** Revise §6 to: "`run_scheduled_test` spawns a daemon thread targeting `run_k6_in_background`. Since `run_k6_in_background` is being updated to pass `line_callback` to `execute_k6`, and since `run_scheduled_test` only passes positional args to `run_k6_in_background`, no change is needed in `run_scheduled_test`."

---

### Finding 4 — MEDIUM: `execute_k6` currently merges `stdout + stderr` into `output`; the design's change loses stderr content

**Where:** Design §3 (`execute_k6` Changes).

**Verification:** Current `k6_runner.py`:

```python
process = subprocess.Popen(
    k6_cmd,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,   # separate pipe
    ...
)
stdout, stderr = process.communicate()
output = stdout + stderr      # merged after the fact
```

The design changes this to `stderr=subprocess.STDOUT` (merge into one pipe) and reads only stdout. The stated result: `stderr = ""`.

**Problem:** k6 writes its progress bars and VU metrics to **stderr**, not stdout, at least on some platforms and terminal configurations. The current code captures both and concatenates. If the design merges them into stdout via `subprocess.STDOUT`, that is fine for capturing stderr content in the line loop. However, the `summary_data` extraction relies on a `--summary-export` JSON file, not on stdout parsing, so this is unlikely to break that path.

The real risk: k6's machine-readable output (used by `extract_metrics` indirectly through the JSON summary file) is unaffected. But the `output` string stored in `TestRun.output` and shown in the terminal card **currently includes stderr** (error messages, warnings). With `stderr=subprocess.STDOUT` and the line-by-line loop, both streams are captured together in `stdout`, so the concatenated content ends up in the `output` string as before. This part is actually fine.

**However:** The design snippet sets `stderr = ""` explicitly and returns `output = stdout`. If k6 writes some content exclusively to stderr after the process exits (e.g. a panic or OS-level error), the line-by-line loop over `process.stdout` will capture it (because stderr is merged). This is correct. The design is internally consistent here but the text is misleading — it says "stderr was merged into stdout via `stderr=subprocess.STDOUT`, so `stderr = ""`" which is technically accurate but could mislead an implementer into thinking they can re-add a separate stderr pipe later without breaking anything. Severity is MEDIUM because the code as written will work, but the explanation is misleading enough to cause an incorrect future change.

**Fix:** Revise the comment in §3 to: "Stderr is redirected into stdout's pipe via `stderr=subprocess.STDOUT`. All k6 output (VU progress, error messages, metrics summary lines) arrives on the single stdout pipe and is captured in the line loop. The explicit `stderr = ""` below is only to satisfy the tuple-unpacking convention of callers that previously destructured `(stdout, stderr)`." Alternatively remove the intermediate `stderr = ""` variable entirely and directly build `output = '\n'.join(lines)`.

---

### Finding 5 — MEDIUM: SSE endpoint uses `json` without confirming it is imported in scope

**Where:** Design §4, the `event_generator` function uses `json.dumps(snapshot)`.

**Verification:** `import json` IS present in `main.py` (line 16 confirmed). So the import itself is fine. However, the design never explicitly states this — it says `import asyncio` must be added but treats `json` as already available without comment. This is correct for `json` but the asymmetry is a documentation gap that could lead an implementer who reads the design carefully to wonder if a `json` import needs to be added.

**Fix:** NIT-level documentation clarification only — see Finding 9. Escalated to MEDIUM only because the paired omission of the `asyncio` import (Finding 1) suggests the design was not systematically checked for all required imports.

*After re-evaluation:* `json` is already imported. This finding is downgraded to NIT — see Finding 9.

---

### Finding 6 — MEDIUM: State B (`lastDashboardRunId`) — `LiveMetricsDashboard` will NOT receive a `done: true` event immediately as the design claims

**Where:** Design §8 (Integration): "Since the run is already done, the component will connect to SSE, receive an immediate `done: true` event (because `live_metrics[run_id].done` will already be true), render the final frozen series, and display the 'Run Complete' banner."

**Verification:** Looking at the SSE generator in §4:

```python
async def event_generator():
    waited = 0
    while True:
        snapshot = live_metrics.get(run_id)
        if snapshot is None:
            waited += 1
            if waited >= 60:
                yield f'data: {{"error":"run_not_found","run_id":{run_id}}}\n\n'
                return
            await asyncio.sleep(1)
            continue

        waited = 0
        payload = json.dumps(snapshot)
        yield f"data: {payload}\n\n"

        if snapshot.get("done"):
            return

        await asyncio.sleep(1)
```

If `live_metrics[run_id]` exists and `done == True`, the generator will yield one event and return. This is correct. But there is a timing gap: the `live_metrics` dict is **in-process memory only** and is reset on server restart. If the user navigates away and returns after a server restart, `live_metrics[run_id]` will be `None`. The SSE generator will then wait 60 seconds and send `{"error": "run_not_found"}`. The frontend will fall back to polling, which will return the zero-value dict (not the historical metrics). The design acknowledges this in NFR-5 and the "Out of Scope" section, but §8's description of State B will mislead implementers into thinking State B always shows the final frozen chart — in fact it only does so within the same server process lifetime.

**Concrete problem:** The `LiveMetricsDashboard` in State B that receives `{"error": "run_not_found"}` will call `startPolling()` which returns the zero-value dict from `/live-metrics/{run_id}`. The chart will show zeroes, not the final run data. This is a user-visible regression from the current State B behaviour (which shows the HTML export file via the `/dashboard-report/{run_id}` iframe) that persists across restarts.

**Fix:** Add a fallback in State B: if `data.error === "run_not_found"` is received in State B context (i.e. `runId === lastDashboardRunId` and the test is not currently running), show a "Metrics not available (server restarted)" message or redirect to the `/report/{runId}` page rather than displaying zeroes. Document this clearly in §8 and in the Error Handling table.

---

### Finding 7 — MEDIUM: `JSON.parse` error in SSE `onmessage` handler — design says "caught; no action" but the code shown does not catch it

**Where:** Design §7 (Validation Rules table) and the `onmessage` handler code block.

**The handler shown:**

```jsx
es.onmessage = (e) => {
    const data = JSON.parse(e.data);
    if (data.error) { es.close(); startPolling(); return; }
    ...
};
```

**Problem:** `JSON.parse(e.data)` is not wrapped in a `try/catch`. The Validation Rules table claims "JSON.parse error caught; no action" — but the code snippet in §7 does not show this try/catch. If the server sends a malformed line (e.g. a partial flush, proxy buffering artefact, or the `\n\n` frame boundary straddling two browser-side read events), the uncaught `SyntaxError` will propagate and trigger `es.onerror`, which closes the SSE and falls back to polling. In a degraded network this means polling is always used rather than SSE, defeating the primary mechanism.

**Fix:** Wrap the JSON parse in try/catch as the validation table claims:

```jsx
es.onmessage = (e) => {
    let data;
    try {
        data = JSON.parse(e.data);
    } catch {
        return; // malformed frame — skip, wait for next event
    }
    if (data.error) { es.close(); startPolling(); return; }
    ...
};
```

---

### Finding 8 — MEDIUM: `startPolling` and `stopPolling` are referenced but not defined in the component spec

**Where:** Design §7 — the SSE lifecycle useEffect references `startPolling()` and `stopPolling()` as if they are functions defined elsewhere in the component, but the design never provides their implementations.

**What is described:**
- "Uses a `useRef`-stored `setInterval` that calls `API.get('/live-metrics/${runId}')` every 2 seconds."
- "If `data.done` is true or the component unmounts, the interval is cleared."
- "The polling ref is also cleared in the `useEffect` cleanup."

**Problem:** No actual function signature or variable declaration for `startPolling` / `stopPolling` is shown in §7. The description is sufficiently detailed for an experienced developer to reconstruct them, but the design promises concrete implementation details and this section violates that contract. An implementer who reads only the code snippets (not the prose paragraphs) will produce incomplete code.

**Fix:** Add the explicit implementation:

```jsx
const pollingRef = useRef(null);

function startPolling() {
    if (pollingRef.current) return;
    pollingRef.current = setInterval(async () => {
        try {
            const { data } = await API.get(`/live-metrics/${runId}`);
            setCurrent(data);
            setSeries(prev => appendPoint(prev, data));
            if (data.done) {
                setDone(true);
                clearInterval(pollingRef.current);
                pollingRef.current = null;
                if (onFinish) onFinish(data);
            }
        } catch { /* ignore */ }
    }, 2000);
}

function stopPolling() {
    clearInterval(pollingRef.current);
    pollingRef.current = null;
}
```

---

### Finding 9 — NIT: Design §4 SSE endpoint is missing `json` import annotation (documentation clarity)

**Where:** Design §4, "Files Modified" table entry for `main.py`.

`json` is already imported in `main.py`. The design correctly notes to add `import asyncio`. However, there is no explicit note that `json` is already available. This is a documentation gap (not a code bug) since `json` is verified present.

**Fix:** Add a parenthetical: "Add `import asyncio` (already have `import json`, `import re`, `import time`)."

---

### Finding 10 — NIT: Design §7 KPI card grid uses inline styles "consistent with `RunTest.jsx`" but `RunTest.jsx` does NOT use inline styles uniformly throughout its telemetry panel

**Where:** Design §7: "Inline styles are used exactly as specified in the requirements (no new CSS classes needed, consistent with the rest of `RunTest.jsx` which uses heavy inline styles for the telemetry panel)."

**Verification:** `RunTest.jsx` mixes inline styles with CSS class references (`className="rt-grafana-card"`, `className="rt-grafana-hdr"`, `className="rt-grafana-body"`, etc.). The telemetry panel is not exclusively inline-styled. The claim that inline styles are used "consistent with the rest of RunTest.jsx" is accurate for *some* elements but overstated.

**Fix:** Change the wording to "Inline styles are used for the KPI cards and chart wrapper, consistent with the pattern used for the status cards and how-to guide in the idle State C panel of `RunTest.jsx`."

---

### Finding 11 — NIT: `appendPoint` helper treats `data.ts` as epoch milliseconds via `new Date(data.ts)` but `ts` is set with `time.time() * 1000` — document units explicitly

**Where:** Design §7: `appendPoint` helper, `t: new Date(data.ts).toLocaleTimeString()`.

**Observation:** The design specifies `ts` is "current epoch millisecond" (FR-1.2 and §1). `new Date(epoch_ms).toLocaleTimeString()` works correctly for millisecond timestamps. However, the `parse_k6_line` function description says "Updates `ts` to the current epoch millisecond on every call" but the implementation detail (`time.time() * 1000`) is only implied. The unit contract should be explicitly stated in the function spec so the frontend consumer is unambiguous.

**Fix:** In FR-1.2, add: "`ts` must be set to `int(time.time() * 1000)` (Unix epoch milliseconds, compatible with `new Date(ts)` in JavaScript)."

---

## Verified Assumptions

| Assumption | Source checked | Result |
|---|---|---|
| `execute_k6` uses `subprocess.Popen` with `stdout=subprocess.PIPE, stderr=subprocess.PIPE` | `k6_runner.py` line ~814–826 | ✅ Confirmed. Uses `Popen` + `process.communicate()` |
| `execute_k6` returns `(output, summary_data, summary_path)` as a 3-tuple | `k6_runner.py` | ✅ Confirmed |
| `run_k6_in_background` is the only function that directly calls `execute_k6` in `main.py` | `main.py` grep for `execute_k6` | ✅ Confirmed — only one call site at line ~570 |
| `run_scheduled_test` does NOT call `execute_k6` directly — it spawns a thread targeting `run_k6_in_background` | `main.py` grep for `run_scheduled_test` | ✅ Confirmed |
| `import re` is already present in `main.py` | `main.py` imports | ✅ Confirmed (line 8) |
| `import time` is already present in `main.py` | `main.py` imports | ✅ Confirmed (line 10) |
| `import json` is already present in `main.py` | `main.py` imports | ✅ Confirmed (line 16) |
| `running_processes: dict = {}` is already declared in `main.py` | `main.py` | ✅ Confirmed (after line ~43) |
| `extract_metrics` and `_normalise_step` exist in `main.py` | `main.py` | ✅ Confirmed (lines 78 and 106) |
| `recharts: ^3.8.1` is in `package.json` | `package.json` | ✅ Confirmed |
| Frontend served at `localhost:5173` (Vite default) | `package.json` scripts `"dev": "vite --host"` | ✅ Confirmed |
| CORS `allow_origins` includes `http://localhost:5173` and `http://10.10.40.107:5173` | `main.py` | ✅ Confirmed |
| `RunTest.jsx` has a `Pagination` component defined inline | `RunTest.jsx` | ✅ Confirmed |
| `RunTest.jsx` has three telemetry panel states (A/B/C) | `RunTest.jsx` telemetry section | ✅ Confirmed — State A is the `localhost:5665` iframe, State B is the `dashboard-report` iframe, State C is the idle panel |
| `RunTest.jsx` already imports `useCallback` | `RunTest.jsx` line 1 | ✅ Confirmed |
| `Dashboard.jsx` `load` function is a plain `async` function NOT wrapped in `useCallback` | `Dashboard.jsx` | ✅ Confirmed — `load` is declared as `const load = async (...)` at line 44, after `useEffect` |
| `Dashboard.jsx` does NOT import `useCallback` | `Dashboard.jsx` import line | ✅ Confirmed — only `useEffect, useState` are imported |

---

## Unverified / Wrong Assumptions

| Assumption in design | Status | Evidence |
|---|---|---|
| "`import asyncio` — already available as standard-library module; no new package needed" (implied no action in body text, but listed in Files Modified) | **WRONG in body** — `asyncio` is NOT imported in `main.py` | Grep confirmed zero matches for `import asyncio` in `main.py`. This is Finding 1 (HIGH). |
| "Both `import re` (already present) and `import time` (already present at the top of `main.py`) are in scope" — implying all needed stdlib imports are covered | **Incomplete** — `asyncio` is the missing one | See Finding 1. |
| "The `Pagination` component is also defined inline" (used to justify `LiveMetricsDashboard` being file-private) | ✅ True, but the design uses this to argue a pattern that is only partly applicable — `Pagination` is 20 lines; `LiveMetricsDashboard` is a substantial component. Not wrong, just a weak justification. | NIT only. |
| "Since the run is already done, the component will connect to SSE, receive an immediate `done: true` event" (State B behaviour) | **PARTIALLY WRONG** — only true within the same server process lifetime; not true after restart | `live_metrics` is in-process memory. This is Finding 6 (MEDIUM). |
| "The `useEffect` that calls `load(true)` in an interval captures the initial closure. This is technically harmless in this specific case because `load` has no external dependencies other than stable `setX` dispatchers" | **TRUE** as diagnosed, and the fix is still valid per the requirements | The stale closure is harmless but the fix is required by FR-7. |

---

## Verdict

| Severity | Count |
|---|---|
| HIGH | 3 (Findings 1, 2, 3) |
| MEDIUM | 4 (Findings 4, 6, 7, 8) |
| NIT | 3 (Findings 9, 10, 11) |

**CHANGES_REQUESTED** — 7 HIGH/MEDIUM findings must be resolved before implementation.
