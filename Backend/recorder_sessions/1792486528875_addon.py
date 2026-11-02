
import json, os, time, threading

CAPTURE_FILE = 'C:\\Users\\Esakkiappan-Nambi\\Pictures\\Screenshots\\K6-UI\\Backend\\recorder_sessions\\1792486528875_captures.json'
URL_FILTER    = 'demowebshop.tricentis.com'

class K6Recorder:
    def __init__(self):
        self.requests = []
        self._lock = threading.Lock()

    def response(self, flow):
        url = flow.request.pretty_url
        if URL_FILTER and URL_FILTER not in url:
            return
        # Skip common noise
        skip_ext = (".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico",
                    ".woff", ".woff2", ".ttf", ".css", ".js")
        if any(url.lower().endswith(e) for e in skip_ext):
            return
        skip_hosts = ("google-analytics", "analytics", "facebook",
                      "gtm.", "hotjar", "cdn.", "fonts.googleapis")
        if any(h in url for h in skip_hosts):
            return

        try:
            headers = dict(flow.request.headers)
            body = ""
            try:
                body = flow.request.content.decode("utf-8", errors="replace")
            except Exception:
                pass

            resp_body = ""
            try:
                resp_body = flow.response.content.decode("utf-8", errors="replace")[:2048]
            except Exception:
                pass

            entry = {
                "id": int(time.time() * 1000),
                "method": flow.request.method,
                "url": url,
                "status": flow.response.status_code,
                "duration": int(flow.response.timestamp_end * 1000 - flow.request.timestamp_start * 1000),
                "size": len(flow.response.content),
                "body": body,
                "headers": headers,
                "responseBody": resp_body,
                "contentType": flow.response.headers.get("content-type", ""),
                "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            }

            with self._lock:
                self.requests.append(entry)

            # Persist to file so the FastAPI process can read it
            with self._lock:
                with open(CAPTURE_FILE, "w") as f:
                    json.dump(self.requests, f)

        except Exception as e:
            pass


addons = [K6Recorder()]
