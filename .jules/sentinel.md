## 2025-05-11 - [XML Injection in Cursor-on-Target (CoT) Emitter]
**Vulnerability:** The XML formatting utility `_xe` used for generating Cursor-on-Target (CoT) XML events for TAK clients was using `xml.sax.saxutils.escape(str(val))` without escaping quotes. This allowed XML injection via user-controlled or external attributes (e.g. `callsign`) because attributes were defined via f-strings and injected with `"{value}"`.
**Learning:** `xml.sax.saxutils.escape` by default only escapes `<`, `>`, and `&`. It does NOT escape `"` or `'`. Thus, when used to safely interpolate variables into XML attributes, it is insufficient against a quote-based breakout attack.
**Prevention:** Always provide the `entities={'"': "&quot;", "'": "&apos;"}` argument when calling `xml.sax.saxutils.escape` for attribute values, or alternatively use `xml.sax.saxutils.quoteattr()`.

## 2025-05-14 - [SSRF in Admin Debug Endpoint]
**Vulnerability:** The `/admin/debug/remote-feeds/probe` and `/admin/debug/meshcore/probe` endpoints accepted an arbitrary user-controlled URL (`source_url`) and used it directly in backend HTTP/TCP requests without validation. This created a Server-Side Request Forgery (SSRF) vulnerability.
**Learning:** Even internal admin debug/probing endpoints need SSRF protection to prevent an authenticated attacker from bypassing firewalls to access internal services (like `http://127.0.0.1:8080/`).
**Prevention:** Always use centralized SSRF validation (e.g., `validate_safe_url`) to check user-provided URLs against a strict whitelist of schemes and block private/loopback/link-local IP addresses before making any outbound request.

## 2025-05-18 - [SSRF in Radio Proxy Stream]
**Vulnerability:** The `/radio/proxy/{stream_id}` endpoint in `backend/routers/radio.py` accepted stream URLs from the database (which can be created via user input on `/radio/streams`) and fetched them without validating the URL resolved to a safe external IP. It only checked `url.startswith(("http://", "https://"))`. This created a Server-Side Request Forgery (SSRF) vulnerability.
**Learning:** Checking URL scheme prefixes is insufficient for SSRF protection. If the input allows internal hostnames (e.g., `localhost`) or private IPs, an attacker can proxy requests to internal services through the backend. This is particularly dangerous for proxy endpoints which return the response content.
**Prevention:** Always use centralized SSRF validation (e.g., `validate_safe_url`) to check URLs against a strict list of allowed schemes and block private, loopback, or link-local IP addresses before making any outbound HTTP requests.
