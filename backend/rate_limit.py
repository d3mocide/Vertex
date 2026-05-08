import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_EXEMPT_PATHS = frozenset(['/health', '/metrics'])


class RateLimitMiddleware(BaseHTTPMiddleware):
    """IP-based sliding-window rate limit: `calls` requests per `period` seconds.

    WebSocket upgrades and exempt paths are never counted.
    """

    def __init__(self, app, calls: int = 60, period: int = 60):
        super().__init__(app)
        self.calls = calls
        self.period = period

    async def dispatch(self, request: Request, call_next):
        if (
            request.headers.get('upgrade', '').lower() == 'websocket'
            or request.url.path in _EXEMPT_PATHS
        ):
            return await call_next(request)

        from redis_bus import get_redis

        client_ip = (
            request.headers.get("X-Real-IP")
            or request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
            or (request.client.host if request.client else "0.0.0.0")
        )
        window = int(time.time() // self.period)
        key = f'rl:{client_ip}:{window}'

        r = get_redis()
        count = await r.incr(key)
        if count == 1:
            await r.expire(key, self.period * 2)

        if count > self.calls:
            return JSONResponse(
                {'error': 'rate_limit_exceeded'},
                status_code=429,
                headers={'Retry-After': str(self.period)},
            )

        return await call_next(request)
