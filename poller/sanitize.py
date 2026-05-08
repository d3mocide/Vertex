from __future__ import annotations

from typing import Any


def sanitize_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.replace("\x00", "")


def sanitize_payload(value: Any) -> Any:
    if isinstance(value, str):
        return sanitize_text(value)
    if isinstance(value, dict):
        return {sanitize_payload(key): sanitize_payload(item) for key, item in value.items()}
    if isinstance(value, list):
        return [sanitize_payload(item) for item in value]
    if isinstance(value, tuple):
        return tuple(sanitize_payload(item) for item in value)
    if isinstance(value, set):
        return {sanitize_payload(item) for item in value}
    return value


def safe_stripped(value: Any, fallback: str = "") -> str:
    if value is None:
        return fallback
    if not isinstance(value, str):
        value = str(value)
    return sanitize_text(value).strip() or fallback