from __future__ import annotations

from typing import Any


def sanitize_text(value: str | None) -> str | None:
    if value is None:
        return None
    return value.replace("\x00", "")


def sanitize_payload(value: Any) -> Any:
    # ⚡ Bolt Optimization: Cache the type of the value to skip costly consecutive isinstance() calls
    # for the base case. Primitive types (int, float, bool, None) have no children to traverse,
    # so we return them early.
    val_type = type(value)
    if val_type is str:
        return sanitize_text(value)
    if val_type is float or val_type is int or val_type is bool or value is None:
        return value
    if val_type is dict:
        return {sanitize_payload(key): sanitize_payload(item) for key, item in value.items()}
    if val_type is list:
        return [sanitize_payload(item) for item in value]
    if val_type is tuple:
        return tuple(sanitize_payload(item) for item in value)
    if val_type is set:
        return {sanitize_payload(item) for item in value}

    # Fallback to isinstance() to properly handle subclasses (e.g. custom dicts)
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
