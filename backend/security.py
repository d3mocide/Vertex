import asyncio
import ipaddress
import socket
from urllib.parse import urljoin, urlparse

import httpx

from fastapi import HTTPException, status
import jwt

from config import settings

_ALGORITHM = "HS256"


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises HTTPException(401) on any failure."""
    try:
        return jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
    except jwt.InvalidTokenError as exc:
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
        _reject_private_ip(ip, hostname)
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
            _reject_private_ip(ipaddress.ip_address(addr), hostname)


def validate_webhook_url(url: str) -> None:
    """Raise ValueError if url is not a safe, public http/https URL."""
    validate_safe_url(url, allowed_schemes={"http", "https"})


async def validate_safe_url_async(url: str, allowed_schemes: set[str] | None = None) -> None:
    """Async wrapper for validate_safe_url — offloads blocking DNS resolution to a thread."""
    await asyncio.get_running_loop().run_in_executor(None, validate_safe_url, url, allowed_schemes)


async def validate_safe_host_async(hostname: str) -> None:
    """Async wrapper for validate_safe_host — offloads blocking DNS resolution to a thread."""
    await asyncio.get_running_loop().run_in_executor(None, validate_safe_host, hostname)


async def validate_webhook_url_async(url: str) -> None:
    """Async wrapper for validate_webhook_url — offloads blocking DNS resolution to a thread."""
    await validate_safe_url_async(url, allowed_schemes={"http", "https"})


def _private_host_allowed(hostname: str) -> bool:
    normalized = hostname.lower().rstrip(".")
    return normalized in set(getattr(settings, "private_host_allowlist", []))


def _reject_private_ip(
    ip: ipaddress.IPv4Address | ipaddress.IPv6Address,
    hostname: str = "",
) -> None:
    if _private_host_allowed(hostname):
        return
    if ip.is_loopback or ip.is_private or ip.is_link_local or ip.is_reserved or ip.is_unspecified:
        raise ValueError(f"URL resolves to a non-public address: {ip}")


async def resolve_safe_ip(hostname: str, port: int) -> str:
    loop = asyncio.get_running_loop()
    try:
        infos = await loop.getaddrinfo(hostname, port, type=socket.SOCK_STREAM)
    except OSError as exc:
        raise ValueError(f"Cannot resolve hostname: {exc}") from exc
    addresses: list[str] = []
    for info in infos:
        address = info[4][0]
        _reject_private_ip(ipaddress.ip_address(address), hostname)
        if address not in addresses:
            addresses.append(address)
    if not addresses:
        raise ValueError("Hostname resolved to no usable addresses")
    return addresses[0]


async def send_pinned_http_request(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    max_redirects: int = 0,
    stream: bool = False,
    **kwargs,
) -> httpx.Response:
    """Resolve, validate, and pin each HTTP hop to the checked IP address."""
    current = url
    for hop in range(max_redirects + 1):
        parsed = urlparse(current)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise httpx.RequestError("Unsafe outbound URL")
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        try:
            ip = await resolve_safe_ip(parsed.hostname, port)
        except ValueError as exc:
            raise httpx.RequestError(f"SSRF validation failed: {exc}") from exc

        host = parsed.hostname
        host_header = f"{host}:{port}" if parsed.port else host
        bracketed_ip = f"[{ip}]" if ":" in ip else ip
        userinfo = ""
        if parsed.username is not None:
            userinfo = parsed.username
            if parsed.password is not None:
                userinfo += f":{parsed.password}"
            userinfo += "@"
        netloc = f"{userinfo}{bracketed_ip}:{port}"
        pinned = parsed._replace(netloc=netloc).geturl()
        headers = httpx.Headers(kwargs.pop("headers", None))
        headers.setdefault("Host", host_header)
        request = client.build_request(method, pinned, headers=headers, **kwargs)
        if parsed.scheme == "https":
            request.extensions["sni_hostname"] = host.encode("idna").decode("ascii")
        response = await client.send(request, stream=stream)
        if response.is_redirect and hop < max_redirects and response.headers.get("location"):
            await response.aclose()
            current = urljoin(current, response.headers["location"])
            continue
        return response
    raise httpx.TooManyRedirects("Too many redirects")
