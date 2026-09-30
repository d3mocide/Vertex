"""Redaction helpers for URLs and configuration returned to clients or logs."""

from copy import deepcopy
import re
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

_URL = re.compile(r"[a-z][a-z0-9+.-]*://[^\s]+", re.IGNORECASE)
_SENSITIVE_KEYS = frozenset({
    "authorization", "cookie", "password", "passwd", "secret", "token",
    "api_key", "apikey", "key", "x-api-key",
})


def redact_url(value: str | None) -> str | None:
    if not value:
        return value
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
    """Redact credentials in URL-like substrings from exception text."""
    return _URL.sub(lambda match: redact_url(match.group(0)) or "[redacted-url]", str(value))


def redact_mapping(value):
    """Recursively redact known secret fields without mutating stored config."""
    if isinstance(value, dict):
        out = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if lowered in _SENSITIVE_KEYS:
                out[key] = "***"
            elif lowered == "url" and isinstance(item, str):
                out[key] = redact_url(item)
            else:
                out[key] = redact_mapping(item)
        return out
    if isinstance(value, list):
        return [redact_mapping(item) for item in value]
    return deepcopy(value)
