"""Credential-safe formatting for configured endpoints and exceptions."""

import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_SENSITIVE_KEYS = frozenset({"authorization", "password", "secret", "token", "api_key", "apikey", "accesscode", "key"})
_URL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s]+", re.IGNORECASE)


def redact_url(value: str) -> str:
    try:
        parsed = urlsplit(value)
        host = parsed.hostname or ""
        if ":" in host and not host.startswith("["):
            host = f"[{host}]"
        if parsed.port:
            host = f"{host}:{parsed.port}"
        if parsed.username is not None or parsed.password is not None:
            host = f"***@{host}"
        query = urlencode([
            (key, "***" if key.lower() in _SENSITIVE_KEYS else val)
            for key, val in parse_qsl(parsed.query, keep_blank_values=True)
        ])
        return urlunsplit((parsed.scheme, host, parsed.path, query, parsed.fragment))
    except (TypeError, ValueError):
        return "[redacted-invalid-url]"


def redact_text(value: object) -> str:
    return _URL.sub(lambda match: redact_url(match.group(0)), str(value))
