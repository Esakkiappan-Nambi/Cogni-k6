import os
import json
from urllib.parse import urlparse

SCRIPT_FOLDER = "generated_scripts"
os.makedirs(SCRIPT_FOLDER, exist_ok=True)


def generate_k6_script(
    test_name,
    users,
    duration,
    ramp_up,
    loop_count,
    scenario,
    assertions=None,
    csv_enabled=False,
    csv_path=None,
    csv_variables=None,
    cookie_enabled=False,
    cookie_clear_each_iteration=False,
    cache_enabled=False,
    cache_clear_each_iteration=False,
    cache_max_size=75,
    user_defined_variables=None,
    ramp_down=5,
    schedule_enabled=False,
    schedule=None,
    cookie_user_cookies=None,
):
    filename = f"{test_name}.js"
    filepath = os.path.join(SCRIPT_FOLDER, filename)

    if assertions and isinstance(assertions, str):
        assertions = json.loads(assertions)

    # ── User Defined Variables Block ──────────────────────────────────────────
    udv_init = "{}"
    udv_list = user_defined_variables or []

    if udv_list:
        enabled_udvs = [
            v for v in udv_list
            if v.get("enabled", True) and v.get("name", "").strip()
        ]

        if enabled_udvs:
            udv_pairs = []
            for v in enabled_udvs:
                name = v["name"].strip()
                value = str(v.get("value", ""))
                escaped = (
                    value.replace("\\", "\\\\")
                        .replace("`", "\\`")
                        .replace("${", "\\${")
                )
                udv_pairs.append(f'    {name}: `{escaped}`')
            udv_init = "{\n" + ",\n".join(udv_pairs) + "\n}"

    # ── CSV block ─────────────────────────────────────────────────────────────
    csv_block = ""
    csv_data_access = ""

    if csv_enabled and csv_path:
        csv_path = os.path.abspath(csv_path).replace("\\", "/")
        variables = [v.strip() for v in csv_variables.split(",")] if csv_variables else []
        csv_mapping = ", ".join([f"{var}: cols[{i}]" for i, var in enumerate(variables)])

        csv_block = f"""import {{ SharedArray }} from "k6/data";

const csvData = new SharedArray("csvData", function () {{
    return open("{csv_path}")
        .split(/\\r?\\n/)
        .slice(1)
        .filter(line => line.trim() !== "")
        .map(line => {{
            const cols = line.split(",").map(c => c.trim().replace(/^["']|["']$/g, ''));
            return {{ {csv_mapping} }};
        }});
}});
"""
        csv_data_access = """const data = csvData[(__VU - 1) % csvData.length];
    console.log("VU:", __VU, "User:", JSON.stringify(data));"""

    # ── Cookie block (JMeter HTTP Cookie Manager equivalent) ───────────────────
    cookie_jar_init = ""
    cookie_iteration_clear = ""

    if cookie_enabled:
        base_urls = []
        seen = set()

        for step in scenario:
            if step.get("enabled") and step.get("url"):
                try:
                    p = urlparse(step["url"].strip())
                    base = f"{p.scheme}://{p.netloc}"

                    if base not in seen:
                        seen.add(base)
                        base_urls.append(base)

                except Exception:
                    pass

        # User-defined predefined initial cookies (JMeter Cookie Manager table)
        cookie_set_statements = []
        if cookie_user_cookies and isinstance(cookie_user_cookies, list):
            for c in cookie_user_cookies:
                c_name = str(c.get("name", "")).strip()
                c_val = str(c.get("value", "")).strip()
                c_domain = str(c.get("domain", "")).strip()
                c_path = str(c.get("path", "")).strip() or "/"
                if not c_name:
                    continue
                if c_domain:
                    if urlparse(c_domain).scheme.lower() in ("http", "https"):
                        c_url = f"{c_domain.rstrip('/')}{c_path}"
                    else:
                        c_url = f"https://{c_domain.rstrip('/')}{c_path}"
                elif base_urls:
                    c_url = f"{base_urls[0].rstrip('/')}{c_path}"
                else:
                    c_url = f"https://localhost{c_path}"
                cookie_set_statements.append(f'jar.set("{c_url}", "{c_name}", "{c_val}");')

        seed_fn = ""
        if cookie_set_statements:
            seed_body = "\n        ".join(cookie_set_statements)
            seed_fn = f"""
    function seedPredefinedCookies() {{
        {seed_body}
    }}
    seedPredefinedCookies();
"""

        # Initialize cookie jar
        cookie_jar_init = f"""
    const jar = http.cookieJar(); // HTTP Cookie Manager
    {seed_fn}
"""

        # Clear cookies every iteration if enabled, but preserve predefined cookies
        if cookie_clear_each_iteration:
            reseed = "seedPredefinedCookies();" if cookie_set_statements else ""
            if base_urls:
                clears = "\n        ".join(
                    [f'jar.clear("{u}");' for u in base_urls]
                )

                cookie_iteration_clear = f"""
    // Clear dynamic cookies each iteration (JMeter Cookie Manager semantics)
        {clears}
        {reseed}
"""
            else:
                cookie_iteration_clear = f"""
    // Re-seed predefined cookies
        {reseed}
"""

    # ── Cache Manager block ───────────────────────────────────────────────────
    cache_init = ""
    cache_helpers = ""
    cache_iteration_clear = ""

    if cache_enabled:
        cache_init = f"""
        // ── HTTP Cache Manager (JMeter equivalent) ────────────────────────────
        const __cache = {{}};
        let __cacheSize = 0;
        const __cacheMaxSize = {cache_max_size};
    """

        cache_helpers = """
        // Get cache headers for conditional GET
        function getCacheHeaders(url) {
            const entry = __cache[url];
            if (!entry) return {};

            const headers = {};
            if (entry.etag) headers["If-None-Match"] = entry.etag;
            if (entry.lastModified) headers["If-Modified-Since"] = entry.lastModified;

            return headers;
        }

        // Store response in cache (JMeter Cache Manager semantics)
        function storeCacheEntry(url, res) {
            const h = res.headers || {};
            const etag = h["ETag"] || h["Etag"] || h["etag"] || null;
            const lastModified = h["Last-Modified"] || h["last-modified"] || null;

            if (res.status === 304) {
                // 304 Not Modified: cache hit, retain cached body and refresh validators
                if (__cache[url]) {
                    if (etag) __cache[url].etag = etag;
                    if (lastModified) __cache[url].lastModified = lastModified;
                }
                return;
            }

            if (res.status >= 200 && res.status < 300) {
                if (!__cache[url] && __cacheSize >= __cacheMaxSize) {
                    const oldestKey = Object.keys(__cache)[0];
                    delete __cache[oldestKey];
                    __cacheSize--;
                }

                if (!__cache[url]) __cacheSize++;

                __cache[url] = {
                    etag: etag,
                    lastModified: lastModified,
                    body: res.body,
                    status: res.status
                };
            }
        }

        // Return cached response if 304
        function getCachedResponse(url) {
            return __cache[url] || null;
        }
    """

        if cache_clear_each_iteration:
            cache_iteration_clear = """
            // Clear cache each iteration
            Object.keys(__cache).forEach(key => delete __cache[key]);
            __cacheSize = 0;
    """

    # ── Schedule metadata block ───────────────────────────────────────────────
    schedule_comment = ""
    schedule_start_check = ""
    schedule_end_check = ""

    if schedule_enabled and schedule:
        start_time = schedule.get("startTime")
        end_time   = schedule.get("endTime")
        frequency  = schedule.get("frequency", "once")

        if start_time:
            schedule_comment = (
                f"// Scheduled Test | "
                f"Frequency: {frequency} | "
                f"Start: {start_time}"
            )

            # Ensure the datetime string ends with seconds for JS Date()
            start_iso = start_time if start_time.endswith("Z") else start_time + ":00"

            schedule_start_check = f"""
        // Scheduler: wait until start time
        const scheduleStart = new Date("{start_iso}").getTime();
        if (Date.now() < scheduleStart) {{
            const waitMs = scheduleStart - Date.now();
            console.log("Waiting until scheduled start:", "{start_iso}");
            sleep(waitMs / 1000);
        }}
"""

        if end_time:
            schedule_comment += f" | End: {end_time}"
            end_iso = end_time if end_time.endswith("Z") else end_time + ":00"

            schedule_end_check = f"""
        // Scheduler: stop after end time
        const scheduleEnd = new Date("{end_iso}").getTime();
        if (Date.now() > scheduleEnd) {{
            console.log("Schedule expired. Stopping test.");
            return;
        }}
"""

    # ── Variable extraction registry ──────────────────────────────────────────
    extracted_vars = []
    for step in scenario:
        if step.get("extractVariable") and step.get("variableName"):
            extracted_vars.append(step["variableName"])

    csv_var_list = []
    if csv_enabled and csv_variables:
        csv_var_list = [v.strip() for v in csv_variables.split(",") if v.strip()]

    def replace_vars(text):
        if not text:
            return text

        # Substitute CSV variables (${data.varName})
        for cvar in csv_var_list:
            text = text.replace(f"{{{{{cvar}}}}}", f"${{data.{cvar}}}")

        # Substitute Extracted & UDV variables (${variables.varName})
        all_vars = extracted_vars[:]
        if user_defined_variables:
            all_vars.extend([
                v["name"].strip()
                for v in user_defined_variables
                if v.get("enabled", True)
            ])

        for var in all_vars:
            text = text.replace(
                f"{{{{{var}}}}}",
                f"${{variables.{var}}}"
            )

        return text

    # ── Build per-step request code ─────────────────────────────────────────────
    # IMPORTANT: every line below stays inside this `for` loop. A previous
    # version of this function had the HTTP-call-building block dedented to
    # function level, which silently ended the loop early and meant `requests`
    # never accumulated anything per step. All per-step logic now lives at one
    # consistent indentation level inside the loop.
    requests = ""

    # `jar_option` gets spliced into every request's config object (GET, cached
    # GET, and non-GET) whenever the Cookie Manager is enabled. This is what
    # was previously missing — the jar was created but never actually attached
    # to any http.get()/http.request() call, so cookies were never sent/stored.
    jar_option = "jar: jar," if cookie_enabled else ""

    for index, step in enumerate(scenario):
        if not step.get("enabled"):
            continue

        response_var = f"res_{index}"
        method       = step.get("method", "GET").upper()
        raw_url      = step.get("url", "")
        name         = step.get("name", f"Request {index + 1}")
        headers      = step.get("headers", "")
        body         = step.get("body", "")

        # ── Retry config ──────────────────────────────────────────────────────
        retry_cfg        = step.get("retry") or {}
        retry_enabled    = retry_cfg.get("enabled", False)
        max_retries      = int(retry_cfg.get("maxRetries", 3))
        retry_delay      = int(retry_cfg.get("retryDelay", 1000))
        retry_on_codes   = retry_cfg.get("retryOn", [500, 502, 503])
        retry_on_timeout = retry_cfg.get("retryOnTimeout", True)

        # ── Build GET params query string ─────────────────────────────────────
        params_list    = step.get("params") or []
        enabled_params = [
            p for p in params_list
            if p.get("enabled", True) and p.get("name", "").strip()
        ]

        if method == "GET" and enabled_params:
            qs_parts = []
            for p in enabled_params:
                p_name  = p.get("name", "").strip()
                p_value = replace_vars(p.get("value", ""))
                encoded_name = p_name.replace(" ", "+")
                qs_parts.append(f"{encoded_name}=${{encodeURIComponent(`{p_value}`)}}")

            query_string = "&".join(qs_parts)

            if "?" in raw_url:
                full_url = f"`{replace_vars(raw_url)}&{query_string}`"
            else:
                full_url = f"`{replace_vars(raw_url)}?{query_string}`"
        else:
            full_url = f"`{replace_vars(raw_url)}`"

        # ── Parse & merge headers ─────────────────────────────────────────────
        headers_obj = {}

        if headers:
            try:
                if isinstance(headers, str):
                    parsed_headers = json.loads(headers)
                    if isinstance(parsed_headers, dict):
                        headers_obj = parsed_headers
                    else:
                        headers_obj = {}
                elif isinstance(headers, dict):
                    headers_obj = headers

                headers_obj = {
                    k: replace_vars(v) if isinstance(v, str) else v
                    for k, v in headers_obj.items()
                }

            except Exception as e:
                print("Header parse error:", e)
                headers_obj = {}

        if method != "GET":
            if not isinstance(headers_obj, dict):
                headers_obj = {}
            merged = {"Content-Type": "application/json"}
            merged.update(headers_obj)
            headers_obj = merged

        # ── Build JS literals ─────────────────────────────────────────────────
        header_parts = []
        for k, v in headers_obj.items():
            if isinstance(v, str):
                if "${" in v:
                    header_parts.append(f'  "{k}": `{v}`')
                else:
                    header_parts.append(f'  "{k}": "{v}"')
            else:
                header_parts.append(f'  "{k}": {json.dumps(v)}')
        headers_literal = "{\n" + ",\n".join(header_parts) + "\n}" if header_parts else "{}"

        # ── Process body with runtime variable substitution ────────────────────
        if body:
            raw_body_str = body if isinstance(body, str) else json.dumps(body)
            processed_body = replace_vars(raw_body_str)
            if "${" in processed_body:
                # Contains dynamic variables (${variables.x} or ${data.x}).
                # Use a JS template literal so JS evaluates them at runtime!
                escaped_body = processed_body.replace("`", "\\`")
                body_literal = f"`{escaped_body}`"
            else:
                try:
                    parsed = json.loads(processed_body)
                    body_literal = json.dumps(json.dumps(parsed))
                except Exception:
                    body_literal = json.dumps(processed_body)
        else:
            body_literal = "null"

        # ── Build HTTP call expression ───────────────────────────────────────
        # FIX 1 (Cookie Manager): `jar_option` is now spliced into the request
        # config object in ALL THREE branches below (plain GET, cached GET,
        # non-GET), so enabling the Cookie Manager actually attaches the jar
        # to every request k6 sends instead of doing nothing.
        #
        # FIX 2 (Cache Manager): the cached-GET branch previously produced
        # invalid JS — an IIFE that was never invoked (missing trailing `()`),
        # a `headers: { ... }` object opened in the wrong place, and a
        # `mergedHeaders` variable that was referenced but never declared.
        # It's rewritten below as a self-invoking arrow function that builds
        # the URL once, merges cache-conditional headers with the configured
        # headers via Object.assign, and returns the response — and it is
        # actually called via the trailing `()`.
        if method == "GET":
            if cache_enabled:
                http_call = f"""(() => {{
            const __url_{index} = {full_url};
            const __cacheHeaders_{index} = getCacheHeaders(__url_{index});
            const __mergedHeaders_{index} = Object.assign({{}}, {headers_literal}, __cacheHeaders_{index});
            const __response_{index} = http.get(__url_{index}, {{
                headers: __mergedHeaders_{index},
                {jar_option}
            }});
            storeCacheEntry(__url_{index}, __response_{index});
            if (__response_{index}.status === 304 && __cache[__url_{index}]) {{
                const __cached_{index} = __cache[__url_{index}];
                return Object.assign({{}}, __response_{index}, {{
                    body: __cached_{index}.body,
                    status: 200,
                    originalStatus: 304,
                    isFromCache: true,
                    json: function (selector) {{
                        try {{
                            const parsed = JSON.parse(__cached_{index}.body);
                            if (!selector) return parsed;
                            return selector.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), parsed);
                        }} catch (e) {{
                            return undefined;
                        }}
                    }}
                }});
            }}
            return __response_{index};
        }})()"""
            else:
                http_call = f"""http.get({full_url}, {{
            headers: {headers_literal},
            {jar_option}
        }})"""
        else:
            http_call = f"""http.request(
        "{method}",
        {full_url},
        {body_literal},
        {{ headers: {headers_literal}, {jar_option} }}
    )"""

        # ── Emit request block (with optional retry wrapper) ──────────────────
        if retry_enabled:
            retry_codes_js      = json.dumps(retry_on_codes)
            retry_on_timeout_js = "true" if retry_on_timeout else "false"

            requests += f"""
        // ── {name} (with retry logic) ──
        let {response_var};
        {{
            const __retryCodes_{index} = {retry_codes_js};
            const __maxRetries_{index} = {max_retries};
            const __retryDelay_{index} = {retry_delay};
            const __retryOnTimeout_{index} = {retry_on_timeout_js};

            for (let __attempt_{index} = 0; __attempt_{index} <= __maxRetries_{index}; __attempt_{index}++) {{
                try {{
                    {response_var} = {http_call};

                    if (!__retryCodes_{index}.includes({response_var}.status)) {{
                        if (__attempt_{index} > 0) {{
                            console.log("Retry succeeded for {name} on attempt", __attempt_{index} + 1);
                        }}
                        break;
                    }}

                    if (__attempt_{index} < __maxRetries_{index}) {{
                        console.warn(
                            "Retrying {name} (attempt", __attempt_{index} + 1, "of", __maxRetries_{index},
                            ") — status:", {response_var}.status
                        );
                        sleep(__retryDelay_{index} / 1000);
                    }} else {{
                        console.error("{name} failed after", __maxRetries_{index}, "retries — status:", {response_var}.status);
                    }}
                }} catch (__err_{index}) {{
                    if (__retryOnTimeout_{index} && __attempt_{index} < __maxRetries_{index}) {{
                        console.warn(
                            "Retrying {name} after error (attempt", __attempt_{index} + 1, "):", __err_{index}.message
                        );
                        sleep(__retryDelay_{index} / 1000);
                    }} else {{
                        console.error("{name} network error after retries:", __err_{index}.message);
                        throw __err_{index};
                    }}
                }}
            }}
        }}
"""
        else:
            requests += f"""
        // ── {name} ──
        let {response_var} = {http_call};
"""

        requests += f"""
        console.log("Request: {name}");
        console.log("Status:", {response_var}.status);
        console.log("Body:", {response_var}.body);

        aggregateResponseTime.add({response_var}.timings.duration);

        if ({response_var}.status >= 400) {{
            aggregateErrors.add(1);
            aggregateFailureRate.add(true);
        }} else {{
            aggregateFailureRate.add(false);
        }}
"""

        # ── Variable extraction (JMeter JSON Extractor equivalent) ────────────
        if step.get("extractVariable") and step.get("variableName"):
            var_name = step["variableName"].strip()
            raw_path = step.get("jsonPath", "").strip()

            if raw_path:
                clean_path = raw_path.replace("$.", "").replace("$", "")
                import re
                gjson_path = re.sub(r'\[(\d+)\]', r'.\1', clean_path).strip(".")

                requests += f"""
        // Extract variable: {var_name} (JMeter JSON Extractor)
        try {{
            let __extracted_{index} = undefined;
            try {{
                __extracted_{index} = {response_var}.json("{gjson_path}");
            }} catch (_) {{}}

            if (__extracted_{index} === undefined || __extracted_{index} === null) {{
                try {{
                    const __b_{index} = {response_var}.json();
                    if (__b_{index}) {{
                        const __keys_{index} = "{gjson_path}".split(".").filter(Boolean);
                        let __cur_{index} = __b_{index};
                        for (const __k of __keys_{index}) {{
                            if (__cur_{index} && typeof __cur_{index} === "object" && __k in __cur_{index}) {{
                                __cur_{index} = __cur_{index}[__k];
                            }} else {{
                                __cur_{index} = undefined;
                                break;
                            }}
                        }}
                        __extracted_{index} = __cur_{index};
                    }}
                }} catch (_) {{}}
            }}

            if (__extracted_{index} !== undefined && __extracted_{index} !== null) {{
                variables.{var_name} = typeof __extracted_{index} === "object" ? JSON.stringify(__extracted_{index}) : String(__extracted_{index});
                console.log("Extracted {var_name} =", variables.{var_name});
            }} else {{
                console.warn("Variable {var_name} not found with path {raw_path}");
            }}
        }} catch (e) {{
            console.warn("Failed to extract {var_name}:", e.message);
        }}
"""

        # ── Think time ────────────────────────────────────────────────────────
        think_time = step.get("thinkTime") if step.get("thinkTime") is not None else step.get("think_time")
        if think_time:
            try:
                t_ms = int(think_time)
                if t_ms > 0:
                    requests += f"        sleep({t_ms} / 1000);\n"
            except Exception:
                pass

        # ── Per-step assertions ───────────────────────────────────────────────
        step_assertions = step.get("assertions", {})
        if step_assertions and step_assertions.get("enabled"):
            status_code = step_assertions.get("status_code", 200)
            max_rt      = step_assertions.get("max_response_time", 500)

            if status_code or max_rt:
                if cache_enabled and int(status_code) == 200:
                    status_fn = "(r) => r.status === 200 || r.status === 304 || r.isFromCache === true"
                else:
                    status_fn = f"(r) => r.status === {status_code}"

                requests += f"""
        check({response_var}, {{
            "{name} status {status_code}": {status_fn},
            "{name} response time < {max_rt}ms": (r) => r.timings.duration <= {max_rt}
        }});
"""

            text_assertions = step_assertions.get("text_assertions", [])
            if text_assertions:
                check_lines = []
                for ta in text_assertions:
                    field     = ta.get("field", "body")
                    condition = ta.get("condition", "contains")
                    val_json  = json.dumps(ta.get("value", ""))
                    label_val = str(ta.get("value", "")).replace('"', "'")
                    label     = f"{name} — {field} {condition} '{label_val}'"

                    if field == "body":
                        field_expr = "r.body"
                    elif field == "status_text":
                        field_expr = "r.status_text"
                    elif field == "headers":
                        field_expr = "JSON.stringify(r.headers)"
                    else:
                        field_expr = "r.body"

                    if condition == "contains":
                        expr = f'({field_expr} || "").includes({val_json})'
                    elif condition == "not_contains":
                        expr = f'!({field_expr} || "").includes({val_json})'
                    elif condition == "equals":
                        expr = f'({field_expr} || "") === {val_json}'
                    elif condition == "starts_with":
                        expr = f'({field_expr} || "").startsWith({val_json})'
                    elif condition == "ends_with":
                        expr = f'({field_expr} || "").endsWith({val_json})'
                    elif condition == "matches_regex":
                        expr = f'new RegExp({val_json}).test({field_expr} || "")'
                    else:
                        expr = f'({field_expr} || "").includes({val_json})'

                    check_lines.append(f'            "{label}": (r) => {expr}')

                checks_block = ",\n".join(check_lines)
                requests += f"""
        check({response_var}, {{
{checks_block}
        }});
"""

        # ── Global assertions fallback ────────────────────────────────────────
        elif assertions:
            status_code = assertions.get("status_code", 200)
            max_rt      = assertions.get("max_response_time", 500)
            if cache_enabled and int(status_code) == 200:
                status_fn = "(r) => r.status === 200 || r.status === 304 || r.isFromCache === true"
            else:
                status_fn = f"(r) => r.status === {status_code}"
            requests += f"""
        check({response_var}, {{
            "status {status_code}": {status_fn},
            "response time < {max_rt}ms": (r) => r.timings.duration <= {max_rt}
        }});
"""

    # ── Global thresholds for options ─────────────────────────────────────────
    threshold_parts = []
    if assertions:
        if assertions.get("max_response_time"):
            threshold_parts.append(f"        'http_req_duration': ['p(95)<{assertions['max_response_time']}'],")
        if assertions.get("max_error_rate") is not None:
            max_rate_ratio = float(assertions["max_error_rate"]) / 100.0
            threshold_parts.append(f"        'http_req_failed': ['rate<={max_rate_ratio:.4f}'],")

    thresholds_block = ""
    if threshold_parts:
        thresholds_block = ",\n    thresholds: {\n" + "\n".join(threshold_parts) + "\n    }"

    # ── Assemble final script ─────────────────────────────────────────────────
    script = f"""import http from "k6/http";
import {{ check, sleep }} from "k6";
import {{ Trend, Counter, Rate }} from "k6/metrics";
{csv_block}

const aggregateResponseTime = new Trend("aggregate_response_time", true);
const aggregateErrors       = new Counter("aggregate_errors");
const aggregateFailureRate  = new Rate("aggregate_failure_rate");

{cache_init}
{cache_helpers}

export const options = {{
    stages: [
        {{ duration: "{ramp_up}s", target: {users} }},
        {{ duration: "{duration}s", target: {users} }},
        {{ duration: "{ramp_down}s", target: 0 }},
    ]{thresholds_block}
}};

export default function () {{
    {schedule_comment}
    const variables = {udv_init};
    {cookie_jar_init}

    {schedule_start_check}
    {schedule_end_check}

    for (let i = 0; i < {loop_count}; i++) {{
        {cookie_iteration_clear}
        {cache_iteration_clear}
        {csv_data_access}
{requests}
    }}
}}
"""

    with open(filepath, "w", encoding="utf-8") as f:
        f.write(script)

    return filepath


import subprocess
import json
import os
import http.client


REPORT_FOLDER = "reports"
os.makedirs(REPORT_FOLDER, exist_ok=True)


def is_influxdb_available(timeout=0.8):
    connection = http.client.HTTPConnection("127.0.0.1", 8086, timeout=timeout)
    try:
        connection.request("GET", "/ping", headers={"User-Agent": "k6-portal"})
        response = connection.getresponse()
        return response.status in (200, 204)
    except (OSError, http.client.HTTPException):
        return False
    finally:
        connection.close()


def execute_k6(script_path, run_id, on_process_created=None, on_output_chunk=None):
    absolute_script_path = os.path.abspath(script_path)

    if not os.path.exists(absolute_script_path):
        raise FileNotFoundError(
            f"Script not found: {absolute_script_path}"
        )

    summary_path = os.path.abspath(
        f"{REPORT_FOLDER}/{run_id}_summary.json"
    )

    env = os.environ.copy()

    # ── Native Web Dashboard: k6 v2.x uses env vars not --out ─────────────────
    # K6_WEB_DASHBOARD=true  → starts the live dashboard on port 5665
    # K6_WEB_DASHBOARD_PORT  → port (default 5665)
    # K6_WEB_DASHBOARD_EXPORT → path to write the standalone HTML report
    dashboard_html_path = os.path.abspath(f"{REPORT_FOLDER}/{run_id}_dashboard.html")
    env["K6_WEB_DASHBOARD"] = "true"
    env["K6_WEB_DASHBOARD_PORT"] = "5665"
    env["K6_WEB_DASHBOARD_EXPORT"] = dashboard_html_path
    env["K6_WEB_DASHBOARD_OPEN"] = "false"   # don't auto-open browser

    k6_cmd = [
        "k6",
        "run",
        "--tag",
        f"run_id={run_id}",
    ]

    # Telemetry streaming: dynamically verify InfluxDB before attaching output
    if is_influxdb_available():
        print("[k6] InfluxDB on localhost:8086 is ONLINE. Also streaming metrics to InfluxDB.")
        k6_cmd.extend(["--out", "influxdb=http://localhost:8086/k6?pushInterval=5s"])
    else:
        print("[k6] InfluxDB offline. Streaming live telemetry natively (no InfluxDB required).")

    k6_cmd.extend([
        "--summary-export",
        summary_path,
        absolute_script_path
    ])

    process = subprocess.Popen(
        k6_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="ignore",
        env=env,
        bufsize=1
    )

    if on_process_created:
        on_process_created(process)

    output_lines = []
    if process.stdout:
        for line in iter(process.stdout.readline, ""):
            output_lines.append(line)
            if on_output_chunk:
                try:
                    on_output_chunk(line)
                except Exception:
                    pass
        process.stdout.close()

    process.wait()
    output = "".join(output_lines)
    summary_data = {}

    if os.path.exists(summary_path):
        with open(summary_path, "r", encoding="utf-8") as f:
            try:
                summary_data = json.load(f)
            except Exception as e:
                print(f"[k6] Error reading summary json: {e}")

    return output, summary_data, summary_path


from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle
)
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet
import os


from reportlab.platypus import (
    SimpleDocTemplate,
    Paragraph,
    Spacer,
    Table,
    TableStyle,
    HRFlowable,
)
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
import os
from datetime import datetime


def generate_pdf_report(run_id, test_name, metrics, output):
    os.makedirs("reports", exist_ok=True)
    report_path = f"reports/{run_id}_report.pdf"

    doc = SimpleDocTemplate(
        report_path,
        pagesize=A4,
        rightMargin=40,
        leftMargin=40,
        topMargin=40,
        bottomMargin=40,
    )

    styles = getSampleStyleSheet()

    # ── Custom styles ─────────────────────────────────────────────────────────
    title_style = ParagraphStyle(
        "ReportTitle",
        parent=styles["Title"],
        fontSize=20,
        textColor=colors.HexColor("#111827"),
        spaceAfter=4,
        alignment=TA_CENTER,
    )
    subtitle_style = ParagraphStyle(
        "ReportSubtitle",
        parent=styles["Normal"],
        fontSize=10,
        textColor=colors.HexColor("#6b7280"),
        spaceAfter=2,
        alignment=TA_CENTER,
    )
    section_style = ParagraphStyle(
        "SectionHeading",
        parent=styles["Normal"],
        fontSize=11,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#374151"),
        spaceBefore=16,
        spaceAfter=8,
    )
    status_pass = ParagraphStyle(
        "StatusPass",
        parent=styles["Normal"],
        fontSize=13,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#16a34a"),
        alignment=TA_CENTER,
    )
    status_fail = ParagraphStyle(
        "StatusFail",
        parent=styles["Normal"],
        fontSize=13,
        fontName="Helvetica-Bold",
        textColor=colors.HexColor("#dc2626"),
        alignment=TA_CENTER,
    )

    elements = []

    # ── HEADER ────────────────────────────────────────────────────────────────
    elements.append(Paragraph(f"{test_name}", title_style))
    elements.append(Paragraph("Load Test Report", subtitle_style))
    elements.append(Paragraph(
        f"Run ID: {run_id} &nbsp;&nbsp;|&nbsp;&nbsp; Generated: {datetime.now().strftime('%d %b %Y, %H:%M:%S')}",
        subtitle_style
    ))
    elements.append(Spacer(1, 10))
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb")))
    elements.append(Spacer(1, 10))

    # ── OVERALL STATUS ────────────────────────────────────────────────────────
    error_rate = metrics.get("error_rate", 0)
    passed     = metrics.get("passed_checks", 0)
    failed_req = metrics.get("failed_requests", 0)

    overall_status = "✔  PASSED" if error_rate < 1 and failed_req == 0 else "✘  FAILED"
    status_style   = status_pass if "PASSED" in overall_status else status_fail

    status_data = [[Paragraph(overall_status, status_style)]]
    status_table = Table(status_data, colWidths=["100%"])
    status_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f9fafb")),
        ("BOX",        (0, 0), (-1, -1), 1, colors.HexColor("#e5e7eb")),
        ("ROUNDEDCORNERS", [6]),
        ("TOPPADDING",    (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
    ]))
    elements.append(status_table)
    elements.append(Spacer(1, 14))

    # ── KEY METRICS — 3-column summary cards ─────────────────────────────────
    elements.append(Paragraph("Key Metrics", section_style))

    def card(label, value, color="#111827"):
        return Table(
        [
            [
                Paragraph(
                    f'<font size="18" color="{color}"><b>{value}</b></font>',
                    ParagraphStyle(
                        "cv",
                        alignment=TA_CENTER,
                        leading=22,
                    ),
                )
            ],
            [
                Paragraph(
                    f'<font size="9" color="#6b7280">{label}</font>',
                    ParagraphStyle(
                        "cl",
                        alignment=TA_CENTER,
                        leading=12,
                    ),
                )
            ],
        ],
        colWidths=["100%"],
    )

    avg_rt  = round(metrics.get("avg_response_time", 0), 1)
    p90     = round(metrics.get("p90", 0), 1)
    p95     = round(metrics.get("p95", 0), 1)
    tput    = round(metrics.get("throughput", 0), 2)
    total   = metrics.get("total_requests", 0)
    err_pct = round(error_rate, 2)

    # Row 1 — 3 cards
    row1 = [
        card("Total Requests", total),
        card("Throughput", f"{tput} req/s"),
        card(
            "Error Rate",
            f"{err_pct}%",
            "#dc2626" if err_pct > 0 else "#16a34a"
        ),]
    cards1 = Table([row1], colWidths=[doc.width / 3] * 3)
    cards1.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f9fafb")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    elements.append(cards1)
    elements.append(Spacer(1, 8))

    # Row 2 — 3 cards
    row2 = [
        card("Avg Response Time", f"{avg_rt} ms"),
        card("P90", f"{p90} ms"),
        card("P95", f"{p95} ms"),
    ]
    cards2 = Table([row2], colWidths=[doc.width / 3] * 3)
    cards2.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f9fafb")),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (0, 0), (-1, -1), "CENTER"),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
    ]))
    elements.append(cards2)
    elements.append(Spacer(1, 14))

    # ── RESPONSE TIME BREAKDOWN ───────────────────────────────────────────────
    elements.append(Paragraph("Response Time Breakdown", section_style))

    rt_data = [
        ["Metric", "Value"],
        ["Minimum",  f'{round(metrics.get("min_response_time", 0), 2)} ms'],
        ["Average",  f'{avg_rt} ms'],
        ["P90",      f'{p90} ms'],
        ["P95",      f'{p95} ms'],
        ["Maximum",  f'{round(metrics.get("max_response_time", 0), 2)} ms'],
    ]

    rt_table = Table(rt_data, colWidths=[doc.width * 0.6, doc.width * 0.4])
    rt_table.setStyle(TableStyle([
        # Header row
        ("BACKGROUND",    (0, 0), (-1, 0),  colors.HexColor("#111827")),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0),  10),
        ("ALIGN",         (0, 0), (-1, 0),  "CENTER"),
        ("TOPPADDING",    (0, 0), (-1, 0),  8),
        ("BOTTOMPADDING", (0, 0), (-1, 0),  8),
        # Data rows
        ("FONTSIZE",      (0, 1), (-1, -1), 10),
        ("ALIGN",         (1, 1), (1, -1),  "CENTER"),
        ("TOPPADDING",    (0, 1), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 7),
        ("LEFTPADDING",   (0, 1), (0, -1),  14),
        # Alternating rows
        ("BACKGROUND",    (0, 1), (-1, 1),  colors.HexColor("#f9fafb")),
        ("BACKGROUND",    (0, 2), (-1, 2),  colors.white),
        ("BACKGROUND",    (0, 3), (-1, 3),  colors.HexColor("#f9fafb")),
        ("BACKGROUND",    (0, 4), (-1, 4),  colors.white),
        ("BACKGROUND",    (0, 5), (-1, 5),  colors.HexColor("#f9fafb")),
        # Grid
        ("GRID",          (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
    ]))
    elements.append(rt_table)
    elements.append(Spacer(1, 14))

    # ── REQUEST SUMMARY ───────────────────────────────────────────────────────
    elements.append(Paragraph("Request Summary", section_style))

    req_data = [
        ["Metric", "Value"],
        ["Total Requests",  str(total)],
        ["Passed Checks",   str(passed)],
        ["Failed Requests", str(failed_req)],
        ["Error Rate",      f"{err_pct}%"],
    ]

    req_table = Table(req_data, colWidths=[doc.width * 0.6, doc.width * 0.4])
    req_table.setStyle(TableStyle([
        ("BACKGROUND",    (0, 0), (-1, 0),  colors.HexColor("#111827")),
        ("TEXTCOLOR",     (0, 0), (-1, 0),  colors.white),
        ("FONTNAME",      (0, 0), (-1, 0),  "Helvetica-Bold"),
        ("FONTSIZE",      (0, 0), (-1, 0),  10),
        ("ALIGN",         (0, 0), (-1, 0),  "CENTER"),
        ("TOPPADDING",    (0, 0), (-1, 0),  8),
        ("BOTTOMPADDING", (0, 0), (-1, 0),  8),
        ("FONTSIZE",      (0, 1), (-1, -1), 10),
        ("ALIGN",         (1, 1), (1, -1),  "CENTER"),
        ("TOPPADDING",    (0, 1), (-1, -1), 7),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 7),
        ("LEFTPADDING",   (0, 1), (0, -1),  14),
        ("BACKGROUND",    (0, 1), (-1, 1),  colors.HexColor("#f9fafb")),
        ("BACKGROUND",    (0, 2), (-1, 2),  colors.white),
        ("BACKGROUND",    (0, 3), (-1, 3),  colors.HexColor("#f9fafb")),
        ("BACKGROUND",    (0, 4), (-1, 4),  colors.white),
        # Highlight failed row in red if failures exist
        *([("TEXTCOLOR", (1, 3), (1, 3), colors.HexColor("#dc2626")),
        ("FONTNAME",  (1, 3), (1, 3), "Helvetica-Bold")]
        if failed_req > 0 else []),
        ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e7eb")),
    ]))
    elements.append(req_table)
    elements.append(Spacer(1, 14))

    # ── FOOTER ────────────────────────────────────────────────────────────────
    elements.append(HRFlowable(width="100%", thickness=1, color=colors.HexColor("#e5e7eb")))
    elements.append(Spacer(1, 6))
    elements.append(Paragraph(
        f'<font size="8" color="#9ca3af">Generated by K6 Load Testing Portal &nbsp;|&nbsp; Run ID: {run_id}</font>',
        ParagraphStyle("footer", alignment=TA_CENTER)
    ))

    doc.build(elements)
    return report_path
