"""
api_capture/routes_auto_capture.py
────────────────────────────────────
FastAPI router — Auto Capture + Authenticated Capture endpoints.

Endpoints:
  POST /auto-capture             — public pages (no login needed)
  POST /authenticated-capture    — pages behind a login wall  <- NEW
  POST /auto-generate            — capture + k6 script in one shot
"""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Union

from api_capture.capture import (
    capture_apis, deduplicate,
    _get_seed_domain, _build_seed_scenario,
)
from api_capture.auth_capture import authenticated_capture
from api_capture.correlate import correlate, inject_auth_header

router = APIRouter()


# ── Models ────────────────────────────────────────────────────────────────────

class CaptureRequest(BaseModel):
    url:            str
    wait_ms:        int  = 8000
    interact:       bool = True
    dedupe:         bool = True
    inject_auth:    bool = False
    auth_token_var: str  = "token"
    use_js_inject:  bool = True
    debug:          bool = False


class CaptureResponse(BaseModel):
    url:      str
    scenario: list[dict]
    count:    int
    message:  str
    source:   str


class AuthCaptureRequest(BaseModel):
    login_url:            str
    username:             str
    password:             str
    app_url:              Optional[Union[list[str], str]] = None
    username_selector:    Optional[str]       = None
    password_selector:    Optional[str]       = None
    submit_selector:      Optional[str]       = None
    success_url_contains: Optional[str]       = None
    success_element:      Optional[str]       = None
    login_timeout_ms:     int                 = 15000
    wait_ms:              int                 = 8000
    interact:             bool                = True
    inject_auth:          bool                = True
    auth_token_var:       str                 = "token"
    dedupe:               bool                = True


class AuthCaptureResponse(BaseModel):
    url:           str
    scenario:      list[dict]
    count:         int
    message:       str
    login_success: bool
    token_found:   bool
    cookies_count: int
    source:        str = "authenticated-browser"


class AutoGenerateRequest(BaseModel):
    url:        str
    test_name:  str  = "auto_test"
    users:      int  = 10
    duration:   int  = 30
    ramp_up:    int  = 5
    loop_count: int  = 1
    wait_ms:    int  = 8000
    interact:   bool = True


# ── POST /auto-capture ────────────────────────────────────────────────────────

@router.post("/auto-capture", response_model=CaptureResponse)
async def auto_capture(req: CaptureRequest):
    try:
        raw = capture_apis(url=req.url, wait_ms=req.wait_ms, interact=req.interact,debug=req.debug)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Browser capture failed: {e}")

    source = "browser"
    if not raw:
        # Only fall back to seeded demo data if it's a known demo domain
        # AND real capture genuinely found nothing — never silently override
        # a real result.
        seed_domain = _get_seed_domain(req.url)
        if seed_domain:
            raw = _build_seed_scenario(req.url, seed_domain)
            source = "seed (no live traffic detected)"
        else:
            raise HTTPException(status_code=404, detail=(
                "No API calls detected. If your app requires login, "
                "use POST /authenticated-capture instead."))

    scenario = deduplicate(raw) if req.dedupe else raw
    scenario = correlate(scenario)
    if req.inject_auth:
        scenario = inject_auth_header(scenario, token_var=req.auth_token_var)
    normalised = _normalise_scenario(scenario)
    return CaptureResponse(url=req.url, scenario=normalised, count=len(normalised),
                        message=f"Captured {len(normalised)} call(s) (source: {source})",
                        source=source)


# ── POST /authenticated-capture ───────────────────────────────────────────────

@router.post("/authenticated-capture", response_model=AuthCaptureResponse)
async def auth_capture_endpoint(req: AuthCaptureRequest):
    """
    Log in with username + password, then capture all authenticated API calls.

    Minimal example body:
        {
            "login_url": "https://myapp.com/login",
            "username":  "admin@myapp.com",
            "password":  "secret123",
            "app_url":   ["https://myapp.com/dashboard"],
            "success_url_contains": "/dashboard"
        }
    """
    raw_app_urls = req.app_url
    if isinstance(raw_app_urls, str):
        app_urls = [u.strip() for u in raw_app_urls.split(",") if u.strip()] or [req.login_url]
    elif isinstance(raw_app_urls, list):
        app_urls = raw_app_urls or [req.login_url]
    else:
        app_urls = [req.login_url]

    try:
        result = authenticated_capture(
            login_url            = req.login_url,
            username             = req.username,
            password             = req.password,
            app_url              = app_urls,
            username_selector    = req.username_selector,
            password_selector    = req.password_selector,
            submit_selector      = req.submit_selector,
            success_url_contains = req.success_url_contains,
            success_element      = req.success_element,
            login_timeout_ms     = req.login_timeout_ms,
            wait_ms              = req.wait_ms,
            interact             = req.interact,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Authenticated capture failed: {e}")

    if result.get("error") and not result.get("scenario"):
        raise HTTPException(status_code=401, detail=(
            f"Login failed: {result['error']}. "
            "Check credentials, login_url, and success_url_contains."))

    scenario = result["scenario"]
    if not scenario:
        raise HTTPException(status_code=404, detail=(
            "Login succeeded but no API calls captured. "
            "Add more pages to app_url or set interact=true."))

    if req.dedupe:
        scenario = deduplicate(scenario)

    scenario = correlate(scenario)

    if req.inject_auth and result.get("session_token"):
        scenario = inject_auth_header(scenario, token_var=req.auth_token_var)

    normalised = _normalise_scenario(scenario)

    return AuthCaptureResponse(
        url           = req.login_url,
        scenario      = normalised,
        count         = len(normalised),
        login_success = result.get("login_success", False),
        token_found   = bool(result.get("session_token")),
        cookies_count = len(result.get("cookies", [])),
        message       = (
            f"Authenticated capture: {len(normalised)} API calls from "
            f"{len(app_urls)} page(s). "
            f"Login: {'OK' if result.get('login_success') else 'uncertain'}. "
            f"Token: {'found' if result.get('session_token') else 'not found'}."
        ),
    )


# ── POST /auto-generate ───────────────────────────────────────────────────────

@router.post("/auto-generate")
async def auto_generate(req: AutoGenerateRequest):
    from k6_runner import generate_k6_script
    seed_domain = _get_seed_domain(req.url)
    if seed_domain:
        scenario = _build_seed_scenario(req.url, seed_domain)
    else:
        try:
            raw = capture_apis(req.url, wait_ms=req.wait_ms, interact=req.interact)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Capture failed: {e}")
        if not raw:
            raise HTTPException(status_code=404, detail="No API calls detected.")
        scenario = deduplicate(raw)
    scenario = correlate(scenario)
    script_path = generate_k6_script(test_name=req.test_name, users=req.users,
                                    duration=req.duration, ramp_up=req.ramp_up,
                                    loop_count=req.loop_count, scenario=scenario)
    return {"message": "Script generated", "script_path": script_path,
            "scenario": scenario, "count": len(scenario)}


# ── Helpers ───────────────────────────────────────────────────────────────────

def _normalise_scenario(scenario):
    import json
    result = []
    for i, step in enumerate(scenario):
        headers = step.get("headers") or {}
        body    = step.get("body")
        result.append({
            "id": i + 1, "name": step.get("name") or f"Request {i+1}",
            "method": step.get("method", "GET").upper(), "url": step.get("url", ""),
            "enabled": True, "sequence": step.get("sequence", i),
            "headers": _js(headers), "body": _js(body) if body else "",
            "params": [], "thinkTime": "",
            "extractVariable": bool(step.get("extractVariable", False)),
            "variableName": step.get("variableName", ""),
            "jsonPath": step.get("jsonPath", ""),
            "assertions": {
                "enabled": bool(step.get("assertions", {}).get("enabled", False)),
                "status_code": step.get("assertions", {}).get("status_code", 200),
                "max_response_time": step.get("assertions", {}).get("max_response_time", 2000),
                "max_error_rate": "", "text_assertions": [],
            },
            "retry": {"enabled": False, "maxRetries": 3, "retryDelay": 1000,
                    "retryOn": [500, 502, 503], "retryOnTimeout": True},
        })
    return result


def _js(value) -> str:
    import json
    if value is None: return ""
    if isinstance(value, str): return value
    try: return json.dumps(value)
    except Exception: return str(value)