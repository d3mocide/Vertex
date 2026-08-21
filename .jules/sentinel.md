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

## 2025-05-26 - [SSRF via Unvalidated Redirects in Pollers]
**Vulnerability:** Similar to the `proxy_stream` vulnerability, several backend poller modules (`gtfs_rt.py`, `alerts.py`, `utilities.py`, `news.py`, `weather.py`) used `httpx.AsyncClient(follow_redirects=True)` without validating the URLs of any HTTP redirects. This opened up the system to an SSRF vulnerability where external servers could redirect the poller to private/loopback IP addresses to probe the internal network. Also, the `0.0.0.0` address was not blocked which could resolve to localhost.
**Learning:** Checking for `ip.is_private`, `ip.is_loopback`, `ip.is_link_local`, and `ip.is_reserved` is insufficient on Linux. Attackers can provide `0.0.0.0` to bypass these checks, but Linux will route `0.0.0.0` to `localhost`.
**Prevention:** Implement an `event_hooks={'request': [validate_request_url]}` for all `httpx.AsyncClient` instances when `follow_redirects=True`. In addition, ensure that the centralized SSRF validation function blocks `ip.is_unspecified` (i.e. `0.0.0.0`) in addition to private/loopback/link-local/reserved addresses.
## 2025-02-15 - Missing SSRF Validation in TCP Pollers
**Vulnerability:** TCP pollers (`aprs.py`, `beast_transport.py`, `cot_receiver.py`) were directly establishing outbound connections (`asyncio.open_connection()`) to user-provided or configurable hostnames/IPs without applying Server-Side Request Forgery (SSRF) validation.
**Learning:** Poller components interacting with external configuration must be treated with the same scrutiny as web endpoints, as they can be weaponized to scan or access internal infrastructure.
**Prevention:** Always wrap hostname/IP targets with `await validate_safe_host(host)` or `await validate_safe_url(url)` via `poller/security.py` before executing outbound requests/TCP connections.

## 2026-07-10 - [Event Loop Blocking DoS via Synchronous SSRF Validation]
**Vulnerability:** In `backend/routers/radio.py`, the `_validate_request_url` event hook used to validate URLs in `httpx.AsyncClient` with `follow_redirects=True` called `validate_safe_url` synchronously. Because `validate_safe_url` performs blocking DNS resolution (`socket.getaddrinfo`), executing it in an async context blocked the backend's main event loop, creating a Denial of Service (DoS) vulnerability.
**Learning:** Using synchronous functions that perform network operations (like DNS resolution) within async event hooks or contexts blocks the asyncio event loop, causing severe latency and potential DoS under load.
**Prevention:** Always offload synchronous blocking calls (such as `socket.getaddrinfo` within SSRF validation) to a separate thread using `await asyncio.get_running_loop().run_in_executor(None, func, *args)` when used within an async context.

## 2025-05-28 - [SSRF in MeshCore Message Sending]
**Vulnerability:** The `/mesh/messages` endpoint (`send_mesh_message`) fetched the `meshcore` source URL from the database and constructed an outbound HTTP POST request to pyMC-Repeater without validating the target URL via the centralized SSRF protection. If an attacker configured a malicious `meshcore` poller source URL, they could trigger an SSRF payload.
**Learning:** Poller sources fetched from the database should not be trusted for outbound network requests without strict SSRF validation. Any outbound HTTP request dynamically constructed using user-configurable inputs stored in the database must be verified.
**Prevention:** Always use centralized SSRF validation (`validate_safe_url_async`) before dispatching outbound HTTP requests from database-stored URLs.
