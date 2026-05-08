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


def validate_webhook_url(url: str) -> None:
    """Raise ValueError if url is not a safe, public http/https URL."""
    try:
        parsed = urlparse(url)
    except Exception as exc:
        raise ValueError(f"Unparseable URL: {exc}") from exc

    if parsed.scheme not in ("http", "https"):
        raise ValueError("Webhook URL must use http or https")

    hostname = parsed.hostname or ""
    if not hostname:
        raise ValueError("Webhook URL has no hostname")

    try:
        ip = ipaddress.ip_address(hostname)
        _reject_private_ip(ip)
    except ValueError as exc:
        if "private" in str(exc) or "loopback" in str(exc) or "link-local" in str(exc):
            raise
        # Not an IP literal — resolve via DNS and check each address
        try:
            infos = socket.getaddrinfo(hostname, None)
        except OSError as dns_exc:
            raise ValueError(f"Cannot resolve webhook hostname: {dns_exc}") from dns_exc
        for info in infos:
            addr = info[4][0]
            _reject_private_ip(ipaddress.ip_address(addr))


def _reject_private_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved:
        raise ValueError(f"Webhook URL resolves to a non-public address: {ip}")
