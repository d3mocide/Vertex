import asyncio
import ipaddress
from urllib.parse import urlparse
import httpx

async def validate_safe_url(url: str, allowed_schemes: set[str] | None = None) -> None:
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

    await validate_safe_host(hostname)


async def validate_safe_host(hostname: str) -> None:
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
            loop = asyncio.get_running_loop()
            infos = await loop.getaddrinfo(hostname, None)
        except OSError as dns_exc:
            raise ValueError(f"Cannot resolve hostname: {dns_exc}") from dns_exc
        for info in infos:
            addr = info[4][0]
            _reject_private_ip(ipaddress.ip_address(addr))


def _reject_private_ip(ip: ipaddress.IPv4Address | ipaddress.IPv6Address) -> None:
    from config import settings
    if settings.allow_private_ips:
        return
    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_unspecified:
        raise ValueError(f"URL resolves to a non-public address: {ip}")


async def validate_request_url(request: httpx.Request):
    """Event hook for httpx.AsyncClient to validate outbound URLs."""
    try:
        await validate_safe_url(str(request.url), allowed_schemes={"http", "https"})
    except ValueError as e:
        # We raise a RequestError here so httpx catches it instead of crashing.
        raise httpx.RequestError(f"SSRF validation failed: {e}", request=request)
