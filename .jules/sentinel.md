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

## 2025-05-21 - [SSRF via Unvalidated Redirects in proxy_stream]
**Vulnerability:** The `/radio/proxy/{stream_id}` endpoint instantiated an `httpx.AsyncClient` with `follow_redirects=True`. Although the initial user-provided URL was checked against SSRF using `validate_safe_url`, if the server responded with an HTTP redirect (e.g. 302 Found) to an internal URL, the client would follow it without re-validating the target URL, leading to an SSRF vulnerability.
**Learning:** Checking a URL before making a request is insufficient if the HTTP client automatically follows redirects to new URLs. Each redirect target must also be validated against SSRF rules.
**Prevention:** If `follow_redirects=True` must be used, add an `event_hooks={'request': [_validate_request_url]}` hook to `httpx.AsyncClient` to intercept and validate every outbound request URL during the lifecycle of the client, including redirects.

## 2025-05-22 - [SSRF via Unvalidated Redirects in Pollers]
**Vulnerability:** Multiple poller services (`alerts`, `gtfs_rt`, `news`, `utilities`, `weather`) instantiated `httpx.AsyncClient` with `follow_redirects=True` without validating the target URLs of redirects. An attacker could exploit this by providing a URL that redirects to an internal service, leading to Server-Side Request Forgery (SSRF).
**Learning:** Even when polling external resources, if the client automatically follows redirects, every redirect target must be validated against SSRF rules, because an external server could redirect the request to an internal IP.
**Prevention:** When using `follow_redirects=True`, always add an `event_hooks={'request': [_validate_request_url]}` hook to `httpx.AsyncClient` to intercept and validate every outbound request URL during the lifecycle of the client.
