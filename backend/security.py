import ipaddress
import socket
from urllib.parse import urlparse

from fastapi import HTTPException, status
from jose import JWTError, jwt

from config import settings

_ALGORITHM = "HS256"


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises HTTPException(401) on any failure."""
    try:
        return jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
    except JWTError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        ) from exc


def validate_safe_url(url: str, allowed_schemes: set[str] | None = None) -> None:
    """Raise ValueError if url is not a safe, public URL."""
    if allowed_schemes is None:
        allowed_schemes = {"http", "https", "ws", "wss", "tcp"}
    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise ValueError(f"Unparseable URL: {exc}") from exc

    if parsed.scheme not in allowed_schemes:
        raise ValueError(f"URL scheme must be one of {allowed_schemes}")

    hostname = parsed.hostname or ""
    if not hostname:
        raise ValueError("URL has no hostname")

    validate_safe_host(hostname)


def validate_safe_host(hostname: str) -> None:
    """Raise ValueError if hostname resolves to a non-public address."""
    if not hostname:
        raise ValueError("No hostname provided")
    try:
        ip = ipaddress.ip_address(hostname)
        _reject_private_ip(ip)
    except ValueError as exc:
        if "non-public address" in str(exc):
            raise
        # Not an IP literal — resolve via DNS and check each address
        try:
            infos = socket.getaddrinfo(hostname, None)
        except OSError as dns_exc:
            raise ValueError(f"Cannot resolve hostname: {dns_exc}") from dns_exc
        for info in infos:
            addr = info[4][0]
            _reject_private_ip(ipaddress.ip_address(addr))


def validate_webhook_url(url: str) -> None:
    """Raise ValueError if url is not a safe, public http/https URL."""
    validate_safe_url(url, allowed_schemes={"http", "https"})


def _reject_private_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved:
        raise ValueError(f"URL resolves to a non-public address: {ip}")
