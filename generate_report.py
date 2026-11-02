#!/usr/bin/env python3
"""
generate_report.py

Builds a single self-contained HTML dashboard from Trivy, Semgrep and
SonarQube JSON reports. Trivy results are split into three separate views:

    * Dependency Scan        (trivy fs   -> filesystem / source dependencies)
    * Container - Frontend   (trivy image of the frontend image)
    * Container - Backend    (trivy image of the backend image)

USAGE (what Jenkins runs):

    python3 generate_report.py security-reports

Or give exact file paths:

    python3 generate_report.py --trivy-fs trivy-report.json \
        --trivy-frontend trivy-frontend-image.json \
        --trivy-backend trivy-backend-image.json \
        --semgrep semgrep-report.json --sonarqube sonarqube-report.json

Reports are identified by their content (and file name as a hint), so the
file names don't have to be exact. Any report can be missing: that section
simply shows "report not found".

Options: -o/--output (default dashboard.html), -p/--project, --serve, --port
"""

import json
import sys
import os
import glob
import argparse
import html
import http.server
import socketserver
import webbrowser
from pathlib import Path
from datetime import datetime, timezone

# ---------------------------------------------------------------------------
# Severity normalization
# ---------------------------------------------------------------------------
LEVEL_ORDER = {"critical": 0, "high": 1, "medium": 2, "low": 3, "info": 4}

LEVEL_COLORS = {
    "critical": "#ff4d5e",
    "high": "#ff9843",
    "medium": "#f2c94c",
    "low": "#4da3ff",
    "info": "#8a94a6",
}

# Ordered list of dashboard sections:
# (key, label, detail-page subtitle, overview-card subtitle, nav icon)
SECTIONS = [
    ("trivy_fs", "Dependency Scan",
     "Source dependency vulnerabilities, secrets &amp; misconfigurations (Trivy filesystem scan)",
     "Project dependencies (filesystem)", "&#9635;"),
    ("trivy_frontend", "Container \u2013 Frontend",
     "Vulnerabilities found in the built frontend container image (Trivy image scan)",
     "Frontend container image", "&#9641;"),
    ("trivy_backend", "Container \u2013 Backend",
     "Vulnerabilities found in the built backend container image (Trivy image scan)",
     "Backend container image", "&#9641;"),
    ("semgrep", "Static Analysis",
     "Static application security testing (SAST) findings",
     "Static application security testing", "&#9670;"),
    ("sonarqube", "Code Quality",
     "Code quality, bugs &amp; maintainability issues",
     "Code quality &amp; maintainability", "&#9632;"),
]
SECTION_KEYS = [s[0] for s in SECTIONS]
TOOL_LABELS = {s[0]: s[1] for s in SECTIONS}

TRIVY_MAP = {
    "CRITICAL": "critical", "HIGH": "high", "MEDIUM": "medium",
    "LOW": "low", "UNKNOWN": "info",
}
SEMGREP_MAP = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
SONAR_MAP = {
    "BLOCKER": "critical", "CRITICAL": "critical", "MAJOR": "high",
    "MINOR": "medium", "INFO": "low",
}


# ---------------------------------------------------------------------------
# Report detection
# ---------------------------------------------------------------------------
def detect_report_type(data):
    """Identify which tool produced a JSON blob by its shape."""
    if isinstance(data, dict):
        keys = set(data.keys())
        if "ArtifactName" in keys or ({"SchemaVersion", "Results"} <= keys):
            return "trivy"
        if "results" in keys and any(k in keys for k in ("errors", "paths", "engine_requested", "version")):
            return "semgrep"
        if "issues" in keys:
            return "sonarqube"
    if isinstance(data, list) and data and isinstance(data[0], dict):
        sample_keys = set(data[0].keys())
        if {"rule", "severity", "component"} & sample_keys and "severity" in sample_keys:
            return "sonarqube"
    return None


def classify_trivy(path, data):
    """
    Decide which Trivy section a report belongs to:
    trivy_fs, trivy_frontend, trivy_backend, or 'trivy_container' (an image
    scan whose side could not be determined).
    """
    name = os.path.basename(path or "").lower()
    artifact_type = str(data.get("ArtifactType", "")).lower() if isinstance(data, dict) else ""
    artifact_name = str(data.get("ArtifactName", "")).lower() if isinstance(data, dict) else ""

    is_container = artifact_type == "container_image" or "image" in name
    if not is_container:
        return "trivy_fs"

    hint = f"{name} {artifact_name}"
    if "frontend" in hint:
        return "trivy_frontend"
    if "backend" in hint:
        return "trivy_backend"
    return "trivy_container"


def discover_reports(folder):
    """Scan every *.json in `folder` and assign each to a dashboard section."""
    found = {k: None for k in SECTION_KEYS}
    unassigned_containers = []

    for path in sorted(glob.glob(os.path.join(folder, "*.json"))):
        data = load_json(path)
        rtype = detect_report_type(data)
        if rtype == "trivy":
            key = classify_trivy(path, data)
            if key == "trivy_container":
                unassigned_containers.append(path)
            elif not found[key]:
                found[key] = path
        elif rtype and not found[rtype]:
            found[rtype] = path

    # Container scans we could not tell apart fill whichever slot is free.
    for path in unassigned_containers:
        for slot in ("trivy_frontend", "trivy_backend"):
            if not found[slot]:
                found[slot] = path
                break
    return found


def load_json(path):
    if path in (None, "-", ""):
        return None
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return json.load(f)
    except FileNotFoundError:
        print(f"Warning: file not found: {path}", file=sys.stderr)
        return None
    except json.JSONDecodeError as e:
        print(f"Warning: could not parse {path} as JSON ({e})", file=sys.stderr)
        return None


# ---------------------------------------------------------------------------
# Parsers -- each returns rows shaped like:
# { id, level, native_severity, title, location, extra, ref }
# ---------------------------------------------------------------------------
def parse_trivy(data):
    """
    Returns (rows, packages_scanned). Handles vulnerabilities,
    misconfigurations, secrets, and (when present) clean packages.
    """
    rows = []
    packages_scanned = 0
    if not data:
        return rows, packages_scanned
    for result in data.get("Results", []) or []:
        target = result.get("Target", "")
        packages = result.get("Packages", []) or []
        packages_scanned += len(packages)

        vulnerable_pkg_names = set()
        for v in result.get("Vulnerabilities", []) or []:
            sev = (v.get("Severity") or "UNKNOWN").upper()
            pkg_name = v.get("PkgName", "")
            vulnerable_pkg_names.add(pkg_name)
            rows.append({
                "id": v.get("VulnerabilityID", ""),
                "level": TRIVY_MAP.get(sev, "info"),
                "native_severity": sev,
                "title": v.get("Title") or v.get("VulnerabilityID", ""),
                "location": f'{pkg_name} ({target})',
                "extra": f'Installed: {v.get("InstalledVersion","-")}  \u2192  Fixed: {v.get("FixedVersion") or "not available"}',
                "ref": v.get("PrimaryURL", ""),
            })

        for m in result.get("Misconfigurations", []) or []:
            sev = (m.get("Severity") or "UNKNOWN").upper()
            rows.append({
                "id": m.get("ID", ""),
                "level": TRIVY_MAP.get(sev, "info"),
                "native_severity": sev,
                "title": m.get("Title") or m.get("ID", ""),
                "location": target,
                "extra": (m.get("Description") or "")[:180],
                "ref": m.get("PrimaryURL", ""),
            })

        for s in result.get("Secrets", []) or []:
            sev = (s.get("Severity") or "UNKNOWN").upper()
            rows.append({
                "id": s.get("RuleID", ""),
                "level": TRIVY_MAP.get(sev, "info"),
                "native_severity": sev,
                "title": s.get("Title") or s.get("RuleID", ""),
                "location": f'{target}:{s.get("StartLine", "")}',
                "extra": "Secret detected",
                "ref": "",
            })

        for p in packages:
            name = p.get("Name", "")
            if name in vulnerable_pkg_names:
                continue
            version = p.get("Version", "")
            locations = p.get("Locations", []) or []
            line = locations[0].get("StartLine") if locations else None
            purl = (p.get("Identifier", {}) or {}).get("PURL", "")
            rows.append({
                "id": "\u2014",
                "level": "info",
                "native_severity": "CLEAN",
                "title": f'{name} {version} \u2014 no known vulnerabilities',
                "location": f'{target}' + (f':{line}' if line else ''),
                "extra": purl,
                "ref": "",
            })
    return rows, packages_scanned


def parse_semgrep(data):
    rows = []
    if not data:
        return rows
    for r in data.get("results", []) or []:
        extra = r.get("extra", {}) or {}
        sev = (extra.get("severity") or "INFO").upper()
        meta = extra.get("metadata", {}) or {}
        cwe = meta.get("cwe")
        cwe_str = cwe[0] if isinstance(cwe, list) and cwe else (cwe or "")
        line = (r.get("start", {}) or {}).get("line", "")
        rows.append({
            "id": r.get("check_id", ""),
            "level": SEMGREP_MAP.get(sev, "info"),
            "native_severity": sev,
            "title": extra.get("message", "")[:220],
            "location": f'{r.get("path","")}:{line}',
            "extra": cwe_str,
            "ref": "",
        })
    return rows


def parse_sonarqube(data):
    rows = []
    if not data:
        return rows
    issues = data if isinstance(data, list) else (data.get("issues", []) or [])
    for i in issues:
        sev = (i.get("severity") or "INFO").upper()
        comp = i.get("component", "")
        line = i.get("line", "")
        loc = f'{comp}:{line}' if line else comp
        rows.append({
            "id": i.get("rule", i.get("key", "")),
            "level": SONAR_MAP.get(sev, "info"),
            "native_severity": sev,
            "title": i.get("message", ""),
            "location": loc,
            "extra": i.get("type", ""),
            "ref": "",
        })
    return rows


def summarize(rows):
    counts = {"critical": 0, "high": 0, "medium": 0, "low": 0, "info": 0}
    for r in rows:
        counts[r["level"]] = counts.get(r["level"], 0) + 1
    counts["total"] = len(rows)
    return counts


# ---------------------------------------------------------------------------
# HTML rendering
# ---------------------------------------------------------------------------
def esc(s):
    return html.escape(str(s if s is not None else ""), quote=True)


def render_bar(counts):
    total = max(counts["total"], 1)
    segs = []
    for level in ["critical", "high", "medium", "low", "info"]:
        n = counts[level]
        if n <= 0:
            continue
        pct = (n / total) * 100
        segs.append(
            f'<div class="seg" style="width:{pct:.3f}%;background:{LEVEL_COLORS[level]}" '
            f'title="{level.title()}: {n}"></div>'
        )
    empty = "<div class='seg empty'></div>"
    inner = "".join(segs) if segs else empty
    return f'<div class="stackbar">{inner}</div>'


def render_severity_grid(counts, tool_key):
    boxes = []
    for level in ["critical", "high", "medium", "low", "info"]:
        n = counts[level]
        boxes.append(
            f'<button type="button" class="sev-box" style="--c:{LEVEL_COLORS[level]}" '
            f'data-jump="{tool_key}" data-jump-level="{level}" '
            f'title="View {level} findings in {esc(TOOL_LABELS.get(tool_key, tool_key))}">'
            f'<div class="sev-n">{n}</div>'
            f'<div class="sev-l">{level.title()}</div>'
            f'</button>'
        )
    return f'<div class="sev-grid">{"".join(boxes)}</div>'


def render_table_rows(rows, tool_key):
    no_match_row = (
        f'<tr class="no-match-row" data-tool="{tool_key}" style="display:none">'
        f'<td colspan="5">No findings match the current filter.</td></tr>'
    )
    if not rows:
        return '<tr class="empty-row"><td colspan="5">No findings reported.</td></tr>' + no_match_row
    rows_sorted = sorted(rows, key=lambda r: LEVEL_ORDER.get(r["level"], 99))
    out = []
    for r in rows_sorted:
        ref = f'<a href="{esc(r["ref"])}" target="_blank" rel="noopener">\u2197</a>' if r.get("ref") else ""
        out.append(
            f'<tr data-level="{r["level"]}" data-tool="{tool_key}">'
            f'<td><span class="pill" style="--c:{LEVEL_COLORS[r["level"]]}">{esc(r["native_severity"])}</span></td>'
            f'<td class="mono">{esc(r["id"])} {ref}</td>'
            f'<td>{esc(r["title"])}</td>'
            f'<td class="mono dim">{esc(r["location"])}</td>'
            f'<td class="dim">{esc(r["extra"])}</td>'
            f'</tr>'
        )
    return "".join(out) + no_match_row


def make_footnote(key, found, data, counts, packages_scanned):
    """Small line under each overview card."""
    if not found:
        return '<div class="card-foot missing">Report not found \u2014 this scan was skipped or failed</div>'
    if key in ("trivy_frontend", "trivy_backend") and isinstance(data, dict):
        image = data.get("ArtifactName", "")
        os_meta = (data.get("Metadata") or {}).get("OS") or {}
        os_str = " ".join(x for x in [os_meta.get("Family"), os_meta.get("Name")] if x)
        text = f'Image: {esc(image)}' if image else 'Container image scan'
        if os_str:
            text += f' &middot; {esc(os_str)}'
        if counts["total"] == 0:
            text += ' &mdash; no vulnerabilities detected'
        return f'<div class="card-foot">{text}</div>'
    if key == "trivy_fs" and packages_scanned:
        text = f'{packages_scanned} package(s) analyzed'
        if counts["total"] == 0:
            text += ' \u2014 no vulnerabilities detected'
        return f'<div class="card-foot">{text}</div>'
    return ""


def render_nav(reports):
    items = [
        '<button class="nav-item active" data-target="overview">'
        '<span class="nav-ic">&#9673;</span> Overview</button>'
    ]
    for key, label, _sub, _card_sub, icon in SECTIONS:
        total = reports[key]["counts"]["total"]
        items.append(
            f'<button class="nav-item" data-target="{key}">'
            f'<span class="nav-ic">{icon}</span> {esc(label)} '
            f'<span class="nav-count">{total}</span></button>'
        )
    return "\n      ".join(items)


def render_cards(reports):
    cards = []
    for key, label, _sub, card_sub, _icon in SECTIONS:
        rep = reports[key]
        counts = rep["counts"]
        cards.append(f"""
        <div class="card">
          <div class="card-head">
            <span class="card-tool">{esc(label)}</span>
            <span class="card-sub">{card_sub}</span>
          </div>
          {render_bar(counts)}
          {render_severity_grid(counts, key)}
          <div class="card-total">{counts['total']} <span>findings</span></div>
          {rep['foot']}
        </div>""")
    return "\n".join(cards)


def render_detail_section(key, name, subtitle, rows, counts, found):
    notice = ""
    if not found:
        notice = '<div class="notice">No report file was found for this scan.</div>'
    return f"""
    <section id="{key}" class="panel view">
      <div class="section-head">
        <div>
          <h2>{esc(name)}</h2>
          <p class="section-sub">{subtitle}</p>
        </div>
        {render_bar(counts)}
      </div>
      {notice}
      <div class="toolbar">
        <input type="text" class="search" placeholder="Filter {esc(name)} findings by ID, message, or location..." data-scope="{key}">
        <div class="chips" data-scope="{key}">
          <button class="chip active" data-level="all">All ({counts['total']})</button>
          <button class="chip" data-level="critical" style="--c:{LEVEL_COLORS['critical']}">Critical ({counts['critical']})</button>
          <button class="chip" data-level="high" style="--c:{LEVEL_COLORS['high']}">High ({counts['high']})</button>
          <button class="chip" data-level="medium" style="--c:{LEVEL_COLORS['medium']}">Medium ({counts['medium']})</button>
          <button class="chip" data-level="low" style="--c:{LEVEL_COLORS['low']}">Low ({counts['low']})</button>
          <button class="chip" data-level="info" style="--c:{LEVEL_COLORS['info']}">Info ({counts['info']})</button>
        </div>
      </div>

      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th style="width:110px">Severity</th>
              <th style="width:220px">ID / Rule</th>
              <th>Message</th>
              <th style="width:260px">Location</th>
              <th style="width:200px">Detail</th>
            </tr>
          </thead>
          <tbody id="tbody-{key}">
            {render_table_rows(rows, key)}
          </tbody>
        </table>
      </div>

      <div class="pagination" data-scope="{key}">
        <button type="button" class="page-btn" data-action="prev">&larr; Prev</button>
        <span class="page-info">Page <span class="page-current">1</span> of <span class="page-total">1</span></span>
        <button type="button" class="page-btn" data-action="next">Next &rarr;</button>
      </div>
    </section>
    """


def build_html(reports, meta):
    grand = {lvl: sum(r["counts"][lvl] for r in reports.values())
             for lvl in ["critical", "high", "medium", "low", "info"]}
    grand_total = sum(r["counts"]["total"] for r in reports.values())

    generated = meta["generated"]
    project = esc(meta.get("project", "Unnamed Project"))

    detail_sections = "\n".join(
        render_detail_section(key, label, sub, reports[key]["rows"],
                             reports[key]["counts"], reports[key]["found"])
        for key, label, sub, _cs, _ic in SECTIONS
    )

    return f"""<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Security &amp; Quality Dashboard \u2014 {project}</title>
<style>
{CSS}
</style>
</head>
<body>

<div class="app">

  <aside class="sidebar">
    <div class="brand">
      <span class="brand-mark">&#9679;</span>
      <div>
        <div class="brand-title">SCAN CONSOLE</div>
        <div class="brand-sub">Unified Findings</div>
      </div>
    </div>

    <nav class="nav">
      {render_nav(reports)}
    </nav>

    <div class="sidebar-foot">
      <div>Generated</div>
      <div class="mono">{generated}</div>
    </div>
  </aside>

  <main class="content">

    <header class="topbar">
      <div>
        <div class="eyebrow">Consolidated Report</div>
        <h1>{project}</h1>
      </div>
      <div class="topbar-right">
        <div class="topbar-stats">
          <div class="tstat"><div class="tstat-n">{grand_total}</div><div class="tstat-l">Total</div></div>
          <div class="tstat" style="--c:{LEVEL_COLORS['critical']}"><div class="tstat-n">{grand['critical']}</div><div class="tstat-l">Critical</div></div>
          <div class="tstat" style="--c:{LEVEL_COLORS['high']}"><div class="tstat-n">{grand['high']}</div><div class="tstat-l">High</div></div>
          <div class="tstat" style="--c:{LEVEL_COLORS['medium']}"><div class="tstat-n">{grand['medium']}</div><div class="tstat-l">Medium</div></div>
          <div class="tstat" style="--c:{LEVEL_COLORS['low']}"><div class="tstat-n">{grand['low']}</div><div class="tstat-l">Low</div></div>
          <div class="tstat" style="--c:{LEVEL_COLORS['info']}"><div class="tstat-n">{grand['info']}</div><div class="tstat-l">Info</div></div>
        </div>
        <button class="theme-toggle" id="theme-toggle" title="Switch between dark and light mode" aria-label="Toggle light/dark theme">
          <span class="theme-icon theme-icon-dark">&#9789;</span>
          <span class="theme-icon theme-icon-light">&#9728;</span>
        </button>
      </div>
    </header>

    <!-- ============ OVERVIEW ============ -->
    <section id="overview" class="panel view active">
      <div class="cards">
        {render_cards(reports)}
      </div>

      <div class="legend">
        <span>Severity scale used across tools:</span>
        <span class="legend-item"><i style="background:{LEVEL_COLORS['critical']}"></i>Critical</span>
        <span class="legend-item"><i style="background:{LEVEL_COLORS['high']}"></i>High</span>
        <span class="legend-item"><i style="background:{LEVEL_COLORS['medium']}"></i>Medium</span>
        <span class="legend-item"><i style="background:{LEVEL_COLORS['low']}"></i>Low</span>
        <span class="legend-item"><i style="background:{LEVEL_COLORS['info']}"></i>Info</span>
        <span class="legend-note">Native severity labels are preserved in each detail table.</span>
      </div>
    </section>

    <!-- ============ DETAIL SECTIONS ============ -->
    {detail_sections}

  </main>
</div>

<script>
{JS}
</script>
</body>
</html>
"""


CSS = """
:root{
  --bg:#0a0e16;
  --panel:#111826;
  --panel-2:#0d1320;
  --border:#1e2838;
  --text:#c9d3e0;
  --text-dim:#7c8aa0;
  --text-faint:#546077;
  --accent:#3ecf8e;
  --heading:#ffffff;
  --mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono", Consolas, monospace;
  --sans: ui-sans-serif, "Inter", "Segoe UI", system-ui, sans-serif;
}
html[data-theme="light"]{
  --bg:#f4f6f9;
  --panel:#ffffff;
  --panel-2:#eef1f5;
  --border:#dde3ea;
  --text:#2a3444;
  --text-dim:#5c6b80;
  --text-faint:#8a97a8;
  --accent:#1a9c63;
  --heading:#10151f;
}
*{box-sizing:border-box;}
html,body{margin:0;padding:0;background:var(--bg);color:var(--text);font-family:var(--sans);transition:background .2s ease,color .2s ease;}
.app{display:grid;grid-template-columns:250px 1fr;min-height:100vh;}

/* Sidebar */
.sidebar{background:var(--panel-2);border-right:1px solid var(--border);display:flex;flex-direction:column;padding:22px 16px;position:sticky;top:0;height:100vh;}
.brand{display:flex;align-items:center;gap:10px;padding:0 6px 22px 6px;border-bottom:1px solid var(--border);margin-bottom:18px;}
.brand-mark{color:var(--accent);font-size:14px;}
.brand-title{font-weight:700;letter-spacing:.06em;font-size:12.5px;color:var(--text);}
.brand-sub{font-size:11px;color:var(--text-faint);margin-top:1px;}
.nav{display:flex;flex-direction:column;gap:4px;}
.nav-item{display:flex;align-items:center;gap:10px;background:transparent;border:1px solid transparent;color:var(--text-dim);
  padding:10px 12px;border-radius:8px;font-size:13.5px;cursor:pointer;text-align:left;font-family:var(--sans);}
.nav-item:hover{background:color-mix(in srgb, var(--text) 6%, transparent);color:var(--text);}
.nav-item.active{background:rgba(62,207,142,.08);border-color:rgba(62,207,142,.25);color:var(--text);}
.nav-ic{font-size:10px;color:var(--text-faint);width:14px;text-align:center;}
.nav-item.active .nav-ic{color:var(--accent);}
.nav-count{margin-left:auto;font-family:var(--mono);font-size:11px;color:var(--text-faint);background:color-mix(in srgb, var(--text) 8%, transparent);
  padding:1px 7px;border-radius:20px;}
.sidebar-foot{margin-top:auto;padding-top:16px;border-top:1px solid var(--border);font-size:10.5px;color:var(--text-faint);}
.sidebar-foot .mono{font-family:var(--mono);color:var(--text-dim);margin-top:3px;font-size:11px;}

/* Content */
.content{padding:28px 36px 60px 36px;max-width:1320px;}
.topbar{display:flex;justify-content:space-between;align-items:flex-end;flex-wrap:wrap;gap:20px;margin-bottom:28px;}
.topbar-right{display:flex;align-items:center;gap:16px;}
.eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--accent);font-weight:600;margin-bottom:6px;}

.theme-toggle{position:relative;width:52px;height:28px;border-radius:20px;background:var(--panel-2);
  border:1px solid var(--border);cursor:pointer;flex-shrink:0;padding:0;}
.theme-toggle::before{content:"";position:absolute;top:2px;left:2px;width:22px;height:22px;border-radius:50%;
  background:var(--accent);transition:transform .2s ease;}
html[data-theme="light"] .theme-toggle::before{transform:translateX(24px);}
.theme-icon{position:absolute;top:50%;transform:translateY(-50%);font-size:12px;line-height:1;}
.theme-icon-dark{left:6px;}
.theme-icon-light{right:6px;}
h1{margin:0;font-size:26px;font-weight:700;color:var(--heading);letter-spacing:-.01em;}
.topbar-stats{display:flex;gap:10px;flex-wrap:wrap;}
.tstat{background:var(--panel);border:1px solid var(--border);border-top:2px solid var(--c,var(--border));
  border-radius:10px;padding:8px 14px;text-align:center;min-width:68px;}
.tstat-n{font-family:var(--mono);font-size:19px;font-weight:700;color:var(--c,var(--heading));}
.tstat-l{font-size:10px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.05em;margin-top:2px;}

.view{display:none;}
.view.active{display:block;}

/* Overview cards */
.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-bottom:20px;}
.card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:18px 20px;transition:box-shadow .15s ease,border-color .15s ease;}
.card:hover{border-color:color-mix(in srgb, var(--accent) 35%, var(--border));box-shadow:0 6px 20px rgba(0,0,0,.12);}
.card-head{display:flex;flex-direction:column;margin-bottom:14px;}
.card-tool{font-weight:700;font-size:15px;color:var(--heading);}
.card-sub{font-size:11.5px;color:var(--text-faint);margin-top:2px;}
.card-total{margin-top:14px;font-family:var(--mono);font-size:20px;font-weight:700;color:var(--heading);}
.card-total span{font-family:var(--sans);font-size:11px;color:var(--text-faint);font-weight:400;margin-left:4px;}
.card-foot{margin-top:8px;font-size:11px;color:var(--text-faint);word-break:break-all;}
.card-foot.missing{color:#f2c94c;}

.notice{background:color-mix(in srgb, #f2c94c 12%, var(--panel));border:1px solid color-mix(in srgb, #f2c94c 45%, var(--border));
  color:var(--text);border-radius:8px;padding:10px 14px;font-size:12.5px;margin-bottom:14px;}

.stackbar{display:flex;width:100%;height:8px;border-radius:6px;overflow:hidden;background:color-mix(in srgb, var(--text) 8%, transparent);}
.stackbar .seg{height:100%;}
.stackbar .seg.empty{width:100%;background:color-mix(in srgb, var(--text) 6%, transparent);}

.sev-grid{display:grid;grid-template-columns:repeat(5,1fr);gap:7px;margin-top:14px;}
.sev-box{border:1px solid var(--border);border-top:2px solid var(--c);border-radius:8px;padding:9px 4px;text-align:center;
  background:var(--panel-2);font-family:var(--sans);cursor:pointer;transition:transform .12s ease,box-shadow .12s ease,background .12s ease;}
.sev-box:hover{transform:translateY(-2px);box-shadow:0 4px 14px rgba(0,0,0,.18);background:color-mix(in srgb, var(--c) 10%, var(--panel-2));}
.sev-box:active{transform:translateY(0);}
.sev-box:focus-visible{outline:2px solid var(--c);outline-offset:2px;}
.sev-n{font-family:var(--mono);font-size:18px;font-weight:700;color:var(--c);}
.sev-l{font-size:9.5px;color:var(--text-faint);text-transform:uppercase;letter-spacing:.03em;margin-top:2px;}

.legend{display:flex;align-items:center;flex-wrap:wrap;gap:14px;font-size:11.5px;color:var(--text-faint);
  background:var(--panel);border:1px solid var(--border);border-radius:10px;padding:12px 16px;}
.legend-item{display:inline-flex;align-items:center;gap:6px;color:var(--text-dim);}
.legend-item i{width:8px;height:8px;border-radius:50%;display:inline-block;}
.legend-note{margin-left:auto;font-style:italic;}

/* Detail sections */
.panel{padding-top:6px;}
.section-head{display:flex;justify-content:space-between;align-items:center;gap:24px;margin-bottom:18px;flex-wrap:wrap;}
.section-head h2{margin:0;font-size:20px;color:var(--heading);}
.section-sub{margin:2px 0 0 0;font-size:12.5px;color:var(--text-faint);}
.section-head .stackbar{width:220px;}

.toolbar{display:flex;flex-direction:column;gap:12px;margin-bottom:14px;}
.search{background:var(--panel);border:1px solid var(--border);border-radius:8px;padding:9px 14px;color:var(--text);
  font-family:var(--sans);font-size:13px;width:100%;max-width:420px;}
.search:focus{outline:none;border-color:var(--accent);}
.search::placeholder{color:var(--text-faint);}
.chips{display:flex;gap:8px;flex-wrap:wrap;}
.chip{background:var(--panel);border:1px solid var(--border);color:var(--text-dim);font-size:11.5px;
  padding:6px 12px;border-radius:20px;cursor:pointer;font-family:var(--sans);}
.chip:hover{color:var(--text);}
.chip.active{color:var(--heading);border-color:var(--c,var(--accent));background:color-mix(in srgb, var(--c,var(--accent)) 14%, var(--panel));}

.table-wrap{background:var(--panel);border:1px solid var(--border);border-radius:12px;overflow:hidden;}
table{width:100%;border-collapse:collapse;font-size:12.8px;}
thead th{text-align:left;padding:11px 14px;background:var(--panel-2);color:var(--text-faint);
  font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;border-bottom:1px solid var(--border);}
tbody td{padding:10px 14px;border-bottom:1px solid var(--border);vertical-align:top;color:var(--text);}
tbody tr:last-child td{border-bottom:none;}
tbody tr:hover{background:color-mix(in srgb, var(--text) 4%, transparent);}
.mono{font-family:var(--mono);font-size:12px;}
.dim{color:var(--text-dim);}
.mono.dim{color:var(--text-dim);}
.pill{display:inline-block;font-family:var(--mono);font-size:10.5px;font-weight:700;color:var(--c);
  background:color-mix(in srgb, var(--c) 16%, transparent);border:1px solid color-mix(in srgb, var(--c) 45%, transparent);
  padding:2px 8px;border-radius:5px;letter-spacing:.03em;}
.empty-row td{text-align:center;color:var(--text-faint);padding:30px;font-style:italic;}
.no-match-row td{text-align:center;color:var(--text-faint);padding:30px;font-style:italic;}
a{color:var(--accent);text-decoration:none;}
a:hover{text-decoration:underline;}

/* Pagination */
.pagination{display:flex;align-items:center;justify-content:center;gap:16px;padding:16px 0 4px 0;font-size:12px;color:var(--text-dim);}
.page-btn{background:var(--panel);border:1px solid var(--border);color:var(--text-dim);padding:6px 16px;
  border-radius:8px;cursor:pointer;font-family:var(--sans);font-size:12px;transition:color .12s ease,border-color .12s ease;}
.page-btn:hover:not(:disabled){color:var(--text);border-color:var(--accent);}
.page-btn:disabled{opacity:.4;cursor:default;}
.page-info{font-family:var(--mono);font-size:12px;}
.page-current,.page-total{color:var(--heading);font-weight:600;}

@media (max-width: 860px){
  .app{grid-template-columns:1fr;}
  .sidebar{position:relative;height:auto;flex-direction:row;overflow-x:auto;align-items:center;}
  .nav{flex-direction:row;}
  .brand{border-bottom:none;margin-bottom:0;}
  .sidebar-foot{display:none;}
  .content{padding:20px;}
}
"""

JS = """
(function(){
  const root = document.documentElement;
  const toggle = document.getElementById('theme-toggle');
  if (toggle){
    toggle.addEventListener('click', () => {
      const isLight = root.getAttribute('data-theme') === 'light';
      root.setAttribute('data-theme', isLight ? 'dark' : 'light');
    });
  }

  const navItems = document.querySelectorAll('.nav-item');
  const views = document.querySelectorAll('.view');

  function navigateTo(target){
    navItems.forEach(b => b.classList.toggle('active', b.dataset.target === target));
    views.forEach(v => v.classList.toggle('active', v.id === target));
    window.scrollTo({top:0, behavior:'instant'});
  }

  navItems.forEach(btn => btn.addEventListener('click', () => navigateTo(btn.dataset.target)));

  const PAGE_SIZE = 10;
  const pageState = {};

  function applyFilter(scope, resetPage){
    const search = document.querySelector('.search[data-scope="'+scope+'"]');
    const chipsWrap = document.querySelector('.chips[data-scope="'+scope+'"]');
    const activeChip = chipsWrap ? chipsWrap.querySelector('.chip.active') : null;
    const level = activeChip ? activeChip.dataset.level : 'all';
    const term = (search ? search.value : '').toLowerCase().trim();
    const rows = Array.from(document.querySelectorAll('#tbody-'+scope+' tr[data-tool="'+scope+'"]:not(.no-match-row)'));

    if (resetPage || !pageState[scope]) pageState[scope] = 1;

    const matches = rows.filter(r => {
      const matchesLevel = (level === 'all') || (r.dataset.level === level);
      const matchesTerm = !term || r.textContent.toLowerCase().includes(term);
      return matchesLevel && matchesTerm;
    });

    const totalPages = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
    if (pageState[scope] > totalPages) pageState[scope] = totalPages;
    if (pageState[scope] < 1) pageState[scope] = 1;

    const start = (pageState[scope] - 1) * PAGE_SIZE;
    const end = start + PAGE_SIZE;

    rows.forEach(r => { r.style.display = 'none'; });
    matches.slice(start, end).forEach(r => { r.style.display = ''; });

    const noMatchRow = document.querySelector('#tbody-'+scope+' .no-match-row');
    if (noMatchRow){
      noMatchRow.style.display = (rows.length > 0 && matches.length === 0) ? '' : 'none';
    }

    const pag = document.querySelector('.pagination[data-scope="'+scope+'"]');
    if (pag){
      const cur = pag.querySelector('.page-current');
      const tot = pag.querySelector('.page-total');
      const prevBtn = pag.querySelector('[data-action="prev"]');
      const nextBtn = pag.querySelector('[data-action="next"]');
      if (cur) cur.textContent = pageState[scope];
      if (tot) tot.textContent = totalPages;
      if (prevBtn) prevBtn.disabled = pageState[scope] <= 1;
      if (nextBtn) nextBtn.disabled = pageState[scope] >= totalPages;
      pag.style.display = matches.length > PAGE_SIZE ? '' : 'none';
    }
  }

  document.querySelectorAll('.chips').forEach(wrap => {
    const scope = wrap.dataset.scope;
    wrap.querySelectorAll('.chip').forEach(chip => {
      chip.addEventListener('click', () => {
        wrap.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        applyFilter(scope, true);
      });
    });
  });

  document.querySelectorAll('.search').forEach(input => {
    input.addEventListener('input', () => applyFilter(input.dataset.scope, true));
  });

  document.querySelectorAll('.pagination').forEach(pag => {
    const scope = pag.dataset.scope;
    pag.querySelectorAll('.page-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const delta = btn.dataset.action === 'next' ? 1 : -1;
        pageState[scope] = (pageState[scope] || 1) + delta;
        applyFilter(scope, false);
      });
    });
  });

  // Overview cards: clicking a severity box jumps to that section,
  // pre-filtered to the matching severity level.
  document.querySelectorAll('.sev-box[data-jump]').forEach(box => {
    box.addEventListener('click', () => {
      const tool = box.dataset.jump;
      const level = box.dataset.jumpLevel;
      navigateTo(tool);
      const chipsWrap = document.querySelector('.chips[data-scope="'+tool+'"]');
      if (chipsWrap){
        chipsWrap.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.level === level));
        applyFilter(tool, true);
      }
    });
  });

  document.querySelectorAll('.pagination').forEach(pag => applyFilter(pag.dataset.scope, true));
})();
"""


def main():
    ap = argparse.ArgumentParser(
        description="Generate a unified Trivy/Semgrep/SonarQube HTML dashboard "
                    "with separate dependency and container scan views."
    )
    ap.add_argument("folder", nargs="?", default=None,
                    help="Folder containing the JSON reports (auto-detected by content). "
                         "Defaults to './attachments' if that folder exists.")
    ap.add_argument("--trivy-fs", "--trivy", dest="trivy_fs", default=None,
                    help="Trivy filesystem (dependency) JSON report")
    ap.add_argument("--trivy-frontend", default=None, help="Trivy image JSON report for the frontend")
    ap.add_argument("--trivy-backend", default=None, help="Trivy image JSON report for the backend")
    ap.add_argument("--semgrep", default=None, help="Semgrep JSON report")
    ap.add_argument("--sonarqube", default=None, help="SonarQube JSON report")
    ap.add_argument("-o", "--output", default="dashboard.html", help="Output HTML file path")
    ap.add_argument("-p", "--project", default=None, help="Project name to display in the header")
    ap.add_argument("--serve", action="store_true",
                    help="After generating, host the dashboard on a local web server")
    ap.add_argument("--port", type=int, default=0, help="Port for --serve (default: auto)")
    args = ap.parse_args()

    folder = args.folder
    if folder is None and os.path.isdir("attachments"):
        folder = "attachments"

    discovered = {k: None for k in SECTION_KEYS}
    if folder:
        if not os.path.isdir(folder):
            print(f"Error: '{folder}' is not a directory.", file=sys.stderr)
            sys.exit(1)
        discovered = discover_reports(folder)

    paths = {
        "trivy_fs": args.trivy_fs or discovered["trivy_fs"],
        "trivy_frontend": args.trivy_frontend or discovered["trivy_frontend"],
        "trivy_backend": args.trivy_backend or discovered["trivy_backend"],
        "semgrep": args.semgrep or discovered["semgrep"],
        "sonarqube": args.sonarqube or discovered["sonarqube"],
    }

    if not any(paths.values()):
        print("No Trivy, Semgrep, or SonarQube JSON reports were found.", file=sys.stderr)
        if folder:
            print(f"Looked in: {os.path.abspath(folder)}", file=sys.stderr)
        sys.exit(1)

    print("Detected reports:")
    for key in SECTION_KEYS:
        print(f"  {TOOL_LABELS[key]:<24} {paths[key] or '(not found)'}")

    data = {key: (load_json(p) if p else None) for key, p in paths.items()}

    reports = {}
    packages_by_key = {}
    for key in SECTION_KEYS:
        if key.startswith("trivy"):
            rows, pkgs = parse_trivy(data[key])
        elif key == "semgrep":
            rows, pkgs = parse_semgrep(data[key]), 0
        else:
            rows, pkgs = parse_sonarqube(data[key]), 0
        counts = summarize(rows)
        found = data[key] is not None
        reports[key] = {
            "rows": rows,
            "counts": counts,
            "found": found,
            "foot": make_footnote(key, found, data[key], counts, pkgs),
        }
        packages_by_key[key] = pkgs

    project = args.project
    if not project and isinstance(data["trivy_fs"], dict):
        project = data["trivy_fs"].get("ArtifactName")
    if not project or project == ".":
        project = "Project Scan Report"

    meta = {
        "generated": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC"),
        "project": project,
    }

    doc = build_html(reports, meta)
    with open(args.output, "w", encoding="utf-8") as f:
        f.write(doc)

    output_path = Path(args.output).resolve()
    print(f"\nDashboard written to {output_path}")
    for key in SECTION_KEYS:
        print(f"  {TOOL_LABELS[key]:<24} {reports[key]['counts']['total']} findings")
    print(f"\nOpen it directly:\n  {output_path.as_uri()}")

    if args.serve:
        serve_dashboard(output_path, args.port)


def serve_dashboard(output_path, port=0):
    """Host the dashboard on a local HTTP server until Ctrl+C."""
    directory = str(output_path.parent)
    filename = output_path.name

    class QuietHandler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *a, **kw):
            super().__init__(*a, directory=directory, **kw)

        def log_message(self, fmt, *args_):
            pass

    with socketserver.TCPServer(("127.0.0.1", port), QuietHandler) as httpd:
        actual_port = httpd.server_address[1]
        url = f"http://localhost:{actual_port}/{filename}"
        print(f"\nServing dashboard at:\n  {url}")
        print("(Press Ctrl+C to stop the server)")
        try:
            webbrowser.open(url)
        except Exception:
            pass
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")


if __name__ == "__main__":
    main()
