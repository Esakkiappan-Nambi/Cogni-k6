"""
api_capture/auth_capture.py
────────────────────────────
Authenticated capture module.

What it does:

    1. Opens a headless browser
    2. Navigates to your login page
    3. Fills in username + password and submits the form
    4. Waits for the redirect to confirm login succeeded
    5. Saves the session (cookies + localStorage token)
    6. Navigates to your app pages WITH that session active
    7. Captures every authenticated API call made

Usage example:
    from api_capture.auth_capture import authenticated_capture

    scenario = authenticated_capture(
        login_url    = "https://myapp.com/login",
        username     = "admin@myapp.com",
        password     = "secret123",
        app_url      = "https://myapp.com/dashboard",

        # CSS selectors for your login form fields
        # (leave as None to auto-detect)
        username_selector = "#email",       # or "input[name=email]"
        password_selector = "#password",    # or "input[type=password]"
        submit_selector   = "button[type=submit]",

        # How do we know login succeeded?
        # Option A: URL changes to this after login
        success_url_contains = "/dashboard",
        # Option B: This element appears on screen after login
        success_element      = None,        # e.g. ".user-avatar"

        wait_ms = 8000,    # wait after login for lazy API calls
        interact = True,   # scroll + click after login
    )
"""

import asyncio
import json
import re
from typing import Optional
from urllib.parse import urlparse

from api_capture.capture import (
    CAPTURE_RESOURCE_TYPES,
    SKIP_URL_PATTERNS,
    SKIP_HEADERS,
    _is_api_request,
    _clean_headers,
    _try_parse_json,
    _readable_name,
    deduplicate,
)


# ── Login config dataclass ────────────────────────────────────────────────────

class LoginConfig:
    """
    Everything needed to log into your app.

    Attributes
    ----------
    login_url          : URL of the login page  e.g. "https://myapp.com/login"
    username           : Your login email / username
    password           : Your password
    app_url            : Page to visit AFTER login to trigger API calls
                        Can be a list for multiple pages.
    username_selector  : CSS selector for the username input field
                        Leave None to auto-detect (tries common patterns)
    password_selector  : CSS selector for the password input field
    submit_selector    : CSS selector for the submit button
    success_url_contains : String that appears in URL after successful login
                        e.g. "/dashboard" or "/home"
    success_element    : CSS selector for element that appears after login
                        e.g. ".user-menu" or "#app-header"
                        Used as alternative to success_url_contains
    login_timeout_ms   : Max ms to wait for login redirect (default 15000)
    """
    def __init__(
        self,
        login_url:            str,
        username:             str,
        password:             str,
        app_url:              str | list[str] = None,
        username_selector:    Optional[str]   = None,
        password_selector:    Optional[str]   = None,
        submit_selector:      Optional[str]   = None,
        success_url_contains: Optional[str]   = None,
        success_element:      Optional[str]   = None,
        login_timeout_ms:     int             = 15_000,
    ):
        self.login_url            = login_url
        self.username             = username
        self.password             = password
        self.app_url              = [app_url] if isinstance(app_url, str) else (app_url or [login_url])
        self.username_selector    = username_selector
        self.password_selector    = password_selector
        self.submit_selector      = submit_selector
        self.success_url_contains = success_url_contains
        self.success_element      = success_element
        self.login_timeout_ms     = login_timeout_ms


# ── Auto-detection selectors (tried in order) ─────────────────────────────────
# These cover most common login form patterns

USERNAME_SELECTORS = [
    "input[name='email']",
    "input[name='email' i]",
    "input[name='username']",
    "input[name='username' i]",
    "input[name='user']",
    "input[name='user' i]",
    "input[name='login']",
    "input[name='login' i]",
    "input[name='account' i]",
    "input[type='email']",
    "input[id='email']",
    "input[id='Email']",
    "input[id*='email' i]",
    "input[id='username']",
    "input[id='Username']",
    "input[id*='user' i]",
    "input[id*='login' i]",
    "input[autocomplete='email']",
    "input[autocomplete='username']",
    "input[placeholder*='email' i]",
    "input[placeholder*='username' i]",
    "input[placeholder*='user' i]",
    "input[placeholder*='login' i]",
    "input[aria-label*='email' i]",
    "input[aria-label*='username' i]",
]

PASSWORD_SELECTORS = [
    "input[type='password']",
    "input[name='password']",
    "input[name='password' i]",
    "input[name='pass' i]",
    "input[id='password']",
    "input[id='Password']",
    "input[id*='password' i]",
    "input[id*='pass' i]",
    "input[autocomplete='current-password']",
    "input[placeholder*='password' i]",
    "input[aria-label*='password' i]",
]

SUBMIT_SELECTORS = [
    "button[type='submit']",
    "input[type='submit']",
    "button:has-text('Log In')",
    "button:has-text('Log in')",
    "button:has-text('Login')",
    "button:has-text('Sign In')",
    "button:has-text('Sign in')",
    "button:has-text('Signin')",
    "button:has-text('Submit')",
    "button:has-text('Continue')",
    "input[value*='Log in' i]",
    "input[value*='Login' i]",
    "input[value*='Sign In' i]",
    "input[value*='Sign in' i]",
    "input[value*='Submit' i]",
    "[role='button']:has-text('Log In')",
    "[role='button']:has-text('Log in')",
    "[role='button']:has-text('Login')",
    "[role='button']:has-text('Sign In')",
    "[role='button']:has-text('Sign in')",
    "form button",
]


# ── Core async function ───────────────────────────────────────────────────────

async def _authenticated_capture_async(
    config:    LoginConfig,
    wait_ms:   int  = 8000,
    interact:  bool = True,
    headless:  bool = True,
    debug:     bool = False,
) -> dict:
    """
    Full authenticated capture pipeline.

    Returns
    -------
    dict with keys:
        "scenario"       : list of captured API call dicts
        "login_success"  : bool
        "session_token"  : str | None  (extracted JWT if found)
        "cookies"        : list of cookie dicts
        "error"          : str | None
    """
    import importlib

    playwright_async_api = importlib.import_module("playwright.async_api")
    async_playwright = playwright_async_api.async_playwright

    captured:       list[dict] = []
    session_token:  Optional[str] = None
    login_success:  bool = False
    sequence:       int  = 0
    error:          Optional[str] = None

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=headless)

        # Create a persistent context so cookies survive across pages
        context = await browser.new_context(
            user_agent=(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/124.0.0.0 Safari/537.36"
            ),
            ignore_https_errors=True,
            # Accept all cookies including session cookies
            accept_downloads=False,
        )
        page = await context.new_page()

        # ── Network listener — active the whole time ──────────────────────────
        def on_request(request):
            nonlocal sequence, session_token
            req_url       = request.url
            resource_type = request.resource_type
            method = request.method

            if debug:
                passed = _is_api_request(req_url, resource_type,method)
                print(f"[auth-debug] {'✓' if passed else '✗'}  [{resource_type:8s}]  {method:6s}  {req_url[:100]}")

            if not _is_api_request(req_url, resource_type,method):
                return

            body    = _try_parse_json(request.post_data)
            headers = _clean_headers(dict(request.headers))

            # Try to grab token from Authorization header as we go
            for h_key, h_val in headers.items():
                if h_key.lower() == "authorization" and "bearer " in h_val.lower():
                    token_candidate = h_val.split(" ", 1)[-1].strip()
                    if len(token_candidate) > 20:
                        session_token = token_candidate
                        if debug:
                            print(f"[auth-debug] Token found in Authorization header: {token_candidate[:30]}...")

            captured.append({
                "name":            _readable_name(request.method, req_url, sequence),
                "method":          request.method.upper(),
                "url":             req_url,
                "headers":         headers,
                "body":            body,
                "sequence":        sequence,
                "enabled":         True,
                "extractVariable": False,
                "variableName":    "",
                "jsonPath":        "",
                "assertions": {
                    "enabled":           False,
                    "status_code":       200,
                    "max_response_time": 2000,
                },
            })
            sequence += 1

        page.on("request", on_request)

        # ── Step 1: Navigate to login page ────────────────────────────────────
        print(f"[auth] Opening login page: {config.login_url}")
        try:
            await page.goto(config.login_url, wait_until="domcontentloaded", timeout=30_000)
            try:
                await page.wait_for_load_state("networkidle", timeout=5_000)
            except Exception:
                pass
        except Exception as e:
            error = f"Could not load login page: {e}"
            print(f"[auth] ERROR: {error}")
            await browser.close()
            return {"scenario": [], "login_success": False,
                    "session_token": None, "cookies": [], "error": error}

        # ── Step 2: Find and fill username field ──────────────────────────────
        username_field = await _find_element(
            page,
            config.username_selector,
            USERNAME_SELECTORS,
            "username field",
        )
        if not username_field:
            error = (
                "Could not find username/email input field. "
                "Please set username_selector manually e.g. \"input[name='email']\""
            )
            print(f"[auth] ERROR: {error}")
            await browser.close()
            return {"scenario": [], "login_success": False,
                    "session_token": None, "cookies": [], "error": error}

        await username_field.click()
        await username_field.fill(config.username)
        print(f"[auth] Filled username: {config.username}")

        # ── Step 3: Find and fill password field ──────────────────────────────
        password_field = await _find_element(
            page,
            config.password_selector,
            PASSWORD_SELECTORS,
            "password field",
        )
        if not password_field:
            error = "Could not find password input field."
            print(f"[auth] ERROR: {error}")
            await browser.close()
            return {"scenario": [], "login_success": False,
                    "session_token": None, "cookies": [], "error": error}

        await password_field.click()
        await password_field.fill(config.password)
        print(f"[auth] Filled password: {'*' * len(config.password)}")

        # ── Step 4: Submit the form ───────────────────────────────────────────
        submit_btn = await _find_element(
            page,
            config.submit_selector,
            SUBMIT_SELECTORS,
            "submit button",
        )
        if submit_btn:
            print("[auth] Clicking submit button...")
            await submit_btn.click()
        else:
            # Fallback: press Enter in the password field
            print("[auth] No submit button found — pressing Enter...")
            await password_field.press("Enter")

        # ── Step 5: Wait for login to complete ────────────────────────────────
        print("[auth] Waiting for login redirect...")
        login_success = await _wait_for_login(
            page,
            config.success_url_contains,
            config.success_element,
            config.login_url,
            config.login_timeout_ms,
        )

        if not login_success:
            current_url = page.url
            error = (
                f"Login may have failed. Current URL: {current_url}. "
                "Check your credentials or set success_url_contains correctly."
            )
            print(f"[auth] WARNING: {error}")
            # Don't abort — still capture whatever we can
        else:
            print(f"[auth] Login succeeded! Now at: {page.url}")

        # ── Step 6: Extract session token from storage ────────────────────────
        if not session_token:
            session_token = await _extract_token_from_storage(page, debug)

        # ── Step 7: Save cookies ──────────────────────────────────────────────
        cookies = await context.cookies()
        print(f"[auth] Session has {len(cookies)} cookies")

        # ── Step 8: Navigate to app pages and capture API calls ───────────────
        for app_url in config.app_url:
            print(f"[auth] Capturing from: {app_url}")
            try:
                await page.goto(app_url, wait_until="domcontentloaded", timeout=30_000)
                try:
                    await page.wait_for_load_state("networkidle", timeout=6_000)
                except Exception:
                    pass

                if interact:
                    await _interact_authenticated(page, debug)

                await page.wait_for_timeout(wait_ms)

            except Exception as e:
                print(f"[auth] Warning navigating to {app_url}: {e}")
                continue

        await browser.close()

    # ── De-duplicate ──────────────────────────────────────────────────────────
    unique = deduplicate(captured)

    print(f"\n[auth] Capture complete:")

    print(f"Login success : {login_success}")
    print(f"Token found : {'Yes — ' + session_token[:20] + '...' if session_token else 'No'}")
    print(f"API calls : {len(unique)} unique")

    print(f"       Login success  : {login_success}")
    print(f"       Token found    : {'Yes — ' + session_token[:20] + '...' if session_token else 'No'}")
    print(f"       API calls      : {len(unique)} unique")


    return {
        "scenario":      unique,
        "login_success": login_success,
        "session_token": session_token,
        "cookies":       [_cookie_to_dict(c) for c in cookies],
        "error":         error,
    }


# ── Login success detection ───────────────────────────────────────────────────

async def _wait_for_login(
    page,
    success_url_contains: Optional[str],
    success_element:      Optional[str],
    login_url:            str,
    timeout_ms:           int,
) -> bool:
    """
    Wait for evidence that login worked.
    Tries URL change first, then element appearance, then simple URL-not-login check.
    """
    deadline = timeout_ms / 1000   # convert to seconds for asyncio

    # Strategy A: wait for URL to contain success_url_contains
    if success_url_contains:
        try:
            await page.wait_for_url(f"**{success_url_contains}**", timeout=timeout_ms)
            return True
        except Exception:
            pass

    # Strategy B: wait for a specific element to appear
    if success_element:
        try:
            await page.wait_for_selector(success_element, timeout=timeout_ms, state="visible")
            return True
        except Exception:
            pass

    # Strategy C: URL just changed away from the login page
    try:
        await page.wait_for_function(
            f"() => !window.location.href.includes('{_url_path(login_url)}')",
            timeout=timeout_ms,
        )
        return True
    except Exception:
        pass

    # Strategy D: no error shown on page (best effort)
    current_url = page.url
    if login_url not in current_url:
        return True

    return False


def _url_path(url: str) -> str:
    """Extract just the path part of a URL for comparison."""
    try:
        return urlparse(url).path
    except Exception:
        return url


# ── Token extraction from browser storage ────────────────────────────────────

async def _extract_token_from_storage(page, debug: bool = False) -> Optional[str]:
    """
    Look for JWT / bearer tokens in localStorage and sessionStorage.
    Returns the first token found, or None.
    """
    token_keys = [
        "token", "access_token", "accessToken", "jwt", "auth_token",
        "authToken", "bearer", "id_token", "idToken", "user_token",
    ]

    try:
        # Check localStorage
        for key in token_keys:
            value = await page.evaluate(f"() => localStorage.getItem('{key}')")
            if value and len(value) > 20:
                if debug:
                    print(f"[auth-debug] Token found in localStorage['{key}']: {value[:30]}...")
                return value

        # Check sessionStorage
        for key in token_keys:
            value = await page.evaluate(f"() => sessionStorage.getItem('{key}')")
            if value and len(value) > 20:
                if debug:
                    print(f"[auth-debug] Token found in sessionStorage['{key}']: {value[:30]}...")
                return value

        # Try to find anything that looks like a JWT in localStorage
        all_local = await page.evaluate("""() => {
            const items = {};
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                items[k] = localStorage.getItem(k);
            }
            return items;
        }""")

        for key, value in (all_local or {}).items():
            if value and len(value) > 40 and value.count(".") >= 2:
                # Looks like a JWT (three dot-separated base64 segments)
                if debug:
                    print(f"[auth-debug] JWT-like value in localStorage['{key}']: {value[:30]}...")
                return value

    except Exception as e:
        if debug:
            print(f"[auth-debug] Storage extraction error: {e}")

    return None


# ── Element finder ────────────────────────────────────────────────────────────

async def _find_element(page, user_selector: Optional[str], fallbacks: list[str], label: str):
    """
    Try user_selector first, then each fallback in order.
    If none match, use smart DOM traversal heuristics.
    Returns the first visible element found, or None.
    """
    selectors = ([user_selector] if user_selector else []) + fallbacks
    for sel in selectors:
        try:
            el = await page.wait_for_selector(sel, timeout=1_500, state="visible")
            if el:
                print(f"[auth] Found {label} via selector: {sel}")
                return el
        except Exception:
            continue

    # Heuristic Fallback
    try:
        if "username" in label.lower():
            inputs = await page.query_selector_all("input:not([type='hidden']):not([type='submit']):not([type='checkbox']):not([type='radio']):not([type='button'])")
            for inp in inputs:
                if await inp.is_visible():
                    t = (await inp.get_attribute("type") or "text").lower()
                    if t in ["text", "email", "tel", ""]:
                        print(f"[auth] Found {label} via fallback DOM heuristic (first visible text/email input)")
                        return inp

        elif "password" in label.lower():
            inputs = await page.query_selector_all("input[type='password']")
            for inp in inputs:
                if await inp.is_visible():
                    print(f"[auth] Found {label} via fallback password query")
                    return inp

        elif "submit" in label.lower():
            btns = await page.query_selector_all("button, input[type='submit'], input[type='button'], a.btn, a.button")
            for b in btns:
                if await b.is_visible():
                    txt = ((await b.inner_text()) or (await b.get_attribute("value") or "")).lower()
                    if any(w in txt for w in ["log in", "login", "sign in", "signin", "submit", "continue", "next"]):
                        print(f"[auth] Found {label} via fallback text match: {txt.strip()}")
                        return b
    except Exception as e:
        print(f"[auth] Heuristic search error for {label}: {e}")

    print(f"[auth] Could not find {label} with any selector or heuristic")
    return None


# ── Post-login interaction ────────────────────────────────────────────────────

async def _interact_authenticated(page, debug: bool = False):
    """
    After login, interact with the page to trigger more authenticated API calls.
    Scrolls and clicks navigation items, tabs, and data-loading buttons.
    """
    try:
        # Scroll through the page to trigger lazy-loaded API calls
        for _ in range(5):
            await page.evaluate("window.scrollBy(0, window.innerHeight)")
            await page.wait_for_timeout(500)

        # Click navigation links (sidebar, tabs, menu items)
        nav_selectors = [
            "nav a", "aside a", ".sidebar a", ".menu a",
            "[role='tab']", "[role='menuitem']",
            ".nav-item", ".tab", ".menu-item",
        ]
        for sel in nav_selectors:
            elements = await page.query_selector_all(sel)
            for el in elements[:4]:
                try:
                    await el.scroll_into_view_if_needed()
                    await el.click(timeout=1_500)
                    await page.wait_for_timeout(800)
                    if debug:
                        print(f"[auth-debug] Clicked nav element: {sel}")
                except Exception:
                    pass

        # Click data-loading buttons (not submit/logout)
        buttons = await page.query_selector_all(
            "button:not([type=submit]):not([class*='logout']):not([class*='delete'])"
        )
        for btn in buttons[:6]:
            try:
                txt = (await btn.inner_text()).strip().lower()
                # Skip dangerous buttons
                if any(w in txt for w in ["logout", "delete", "remove", "sign out", "cancel"]):
                    continue
                await btn.scroll_into_view_if_needed()
                await btn.click(timeout=1_500)
                await page.wait_for_timeout(600)
            except Exception:
                pass

    except Exception as e:
        print(f"[auth] Interact warning: {e}")


# ── Cookie helper ─────────────────────────────────────────────────────────────

def _cookie_to_dict(cookie) -> dict:
    """Convert a Playwright cookie object to a plain dict."""
    return {
        "name":     cookie.get("name", ""),
        "value":    cookie.get("value", ""),
        "domain":   cookie.get("domain", ""),
        "path":     cookie.get("path", "/"),
        "httpOnly": cookie.get("httpOnly", False),
        "secure":   cookie.get("secure", False),
    }


# ── Public sync wrapper ───────────────────────────────────────────────────────

def authenticated_capture(
    login_url:            str,
    username:             str,
    password:             str,
    app_url:              str | list[str] = None,
    username_selector:    Optional[str]   = None,
    password_selector:    Optional[str]   = None,
    submit_selector:      Optional[str]   = None,
    success_url_contains: Optional[str]   = None,
    success_element:      Optional[str]   = None,
    login_timeout_ms:     int             = 15_000,
    wait_ms:              int             = 8000,
    interact:             bool            = True,
    headless:             bool            = True,
    debug:                bool            = False,
) -> dict:
    """
    Synchronous entry point for authenticated capture.

    Parameters
    ----------
    login_url            : Your app's login page URL
    username             : Login email or username
    password             : Password
    app_url              : Page(s) to visit after login (str or list of str)
    username_selector    : CSS selector for username field (auto-detected if None)
    password_selector    : CSS selector for password field (auto-detected if None)
    submit_selector      : CSS selector for submit button (auto-detected if None)
    success_url_contains : String expected in URL after successful login
    success_element      : CSS selector for element that appears after login
    login_timeout_ms     : Max wait time for login to complete (ms)
    wait_ms              : Extra wait time after page load for lazy API calls (ms)
    interact             : Whether to scroll + click after login
    headless             : Run browser invisibly (True) or visibly (False for debugging)
    debug                : Print all request details

    Returns
    -------
    dict:
        scenario      : list[dict]  — captured API steps
        login_success : bool
        session_token : str | None
        cookies       : list[dict]
        error         : str | None
    """
    config = LoginConfig(
        login_url            = login_url,
        username             = username,
        password             = password,
        app_url              = app_url,
        username_selector    = username_selector,
        password_selector    = password_selector,
        submit_selector      = submit_selector,
        success_url_contains = success_url_contains,
        success_element      = success_element,
        login_timeout_ms     = login_timeout_ms,
    )

    import concurrent.futures
    with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(
            asyncio.run,
            _authenticated_capture_async(config, wait_ms, interact, headless, debug),
        )
        return future.result(timeout=300)   # 5 min max
