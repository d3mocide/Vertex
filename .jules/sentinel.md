## 2025-05-11 - [XML Injection in Cursor-on-Target (CoT) Emitter]
**Vulnerability:** The XML formatting utility `_xe` used for generating Cursor-on-Target (CoT) XML events for TAK clients was using `xml.sax.saxutils.escape(str(val))` without escaping quotes. This allowed XML injection via user-controlled or external attributes (e.g. `callsign`) because attributes were defined via f-strings and injected with `"{value}"`.
**Learning:** `xml.sax.saxutils.escape` by default only escapes `<`, `>`, and `&`. It does NOT escape `"` or `'`. Thus, when used to safely interpolate variables into XML attributes, it is insufficient against a quote-based breakout attack.
**Prevention:** Always provide the `entities={'"': "&quot;", "'": "&apos;"}` argument when calling `xml.sax.saxutils.escape` for attribute values, or alternatively use `xml.sax.saxutils.quoteattr()`.

## 2026-05-14 - [SSRF in Remote Feed Probe Utility]
**Vulnerability:** The `admin_debug` router provided functions (`_http_get_check`, `_http_post_check`, `_probe_ws`, `_probe_aprs_tcp`) that accepted arbitrary URLs or hosts from user-provided feed configurations. These functions lacked validation, allowing an attacker with admin access to probe internal services or cloud metadata endpoints via Server-Side Request Forgery (SSRF).
**Learning:** Reusable diagnostic tools that perform outbound requests must strictly validate destinations against private IP ranges and internal hostnames, even when limited to authenticated administrators.
**Prevention:** Centralize URL/Host validation logic. Resolve hostnames before connection and check all resulting IP addresses against loopback, private, link-local, and reserved ranges (`ipaddress.IPv4Address.is_private`, etc.). For multi-protocol tools, also validate allowed URL schemes.
