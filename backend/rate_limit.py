import ipaddress
import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_EXEMPT_PATHS = frozenset(['/health', '/metrics'])


class RateLimitMiddleware(BaseHTTPMiddleware):
    """IP-based sliding-window rate limit: `calls` requests per `period` seconds.

    WebSocket upgrades and exempt paths are never counted.
    """

    def __init__(self, app, calls: int = 60, period: int = 60, trusted_proxies: list[str] | None = None):
        super().__init__(app)
        self.calls = calls
        self.period = period
        self.trusted_proxies = [ipaddress.ip_network(value) for value in (trusted_proxies or [])]

    async def dispatch(self, request: Request, call_next):
        if (
            request.headers.get('upgrade', '').lower() == 'websocket'
            or str(request.scope.get("path") or "") in _EXEMPT_PATHS
        ):
            return await call_next(request)

        from redis_bus import get_redis

        peer_ip = request.client.host if request.client else "0.0.0.0"
        try:
            peer = ipaddress.ip_address(peer_ip)
            trusted = any(peer in network for network in self.trusted_proxies)
        except ValueError:
            trusted = False
        client_ip = peer_ip
        if trusted:
            forwarded = (
                request.headers.get("X-Real-IP")
                or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            )
            if forwarded:
                try:
                    client_ip = str(ipaddress.ip_address(forwarded))
                except ValueError:
                    client_ip = peer_ip

        path = str(request.scope.get("path") or "")
        auth_path = path in {"/api/v1/auth/login", "/api/v1/auth/token", "/api/v1/auth/setup"}
        limit = 10 if auth_path else self.calls
        bucket = "auth" if auth_path else "general"
        window = int(time.time() // self.period)
        key = f'rl:{bucket}:{client_ip}:{window}'

        r = get_redis()
        count = await r.incr(key)
        if count == 1:
            await r.expire(key, self.period * 2)

        if count > limit:
            return JSONResponse(
                {'error': 'rate_limit_exceeded'},
                status_code=429,
                headers={'Retry-After': str(self.period)},
            )

        return await call_next(request)
