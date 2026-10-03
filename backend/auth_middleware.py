import hashlib

import jwt
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

from config import settings
from db.models import User
from db.session import async_session_factory

_ALGORITHM = "HS256"
_PUBLIC_PATHS = frozenset({"/health", "/metrics"})
_PUBLIC_PREFIXES = (
    "/api/v1/weather/smoke/wms",
    "/api/v1/weather/goes/wms",
    "/api/v1/weather/radar/wms",
    "/api/v1/weather/alerts/wms",
    "/api/v1/weather/lightning/wms",
    "/api/v1/terrain/dem/",
)
_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_AUTH_PUBLIC_PATHS = frozenset({
    "/api/v1/auth/login",
    "/api/v1/auth/token",
    "/api/v1/auth/setup",
    "/api/v1/auth/status",
})
_AUTH_WRITE_EXEMPT = frozenset({"/api/v1/auth/token", "/api/v1/auth/setup"})
_ADMIN_ONLY_PATHS = frozenset({"/api/v1/summary/debug", "/api/v1/setup/packs"})
_ADMIN_ONLY_PREFIXES = ("/api/v1/admin", "/api/v1/sources", "/api/v1/alertrules")
_SESSION_COOKIE = "vertex_session"


def _hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


def _admin_only(path: str) -> bool:
    return path in _ADMIN_ONLY_PATHS or path.startswith(_ADMIN_ONLY_PREFIXES)


class AuthMiddleware(BaseHTTPMiddleware):
    """Authenticate HTTP requests and enforce the viewer/admin boundary.

    WebSocket routes perform the equivalent database-backed check in routers/ws.py.
    """

    async def dispatch(self, request: Request, call_next):
        # Use the canonical ASGI routing path. Building this decision from
        # request.url.path is vulnerable to Host-header URL confusion.
        path = str(request.scope.get("path") or "")
        if (
            path in _PUBLIC_PATHS
            or path in _AUTH_PUBLIC_PATHS
            or (request.method in {"GET", "HEAD", "OPTIONS"} and path.startswith(_PUBLIC_PREFIXES))
        ):
            return await call_next(request)

        # Unauthenticated deployments are intentionally read-only. This keeps
        # the simple local viewer mode without exposing configuration or relays.
        if not settings.auth_enabled:
            if _admin_only(path):
                return JSONResponse({"detail": "Authentication must be enabled for admin endpoints"}, status_code=403)
            if request.method in _MUTATING_METHODS:
                return JSONResponse(
                    {"detail": "Authentication must be enabled for write operations"},
                    status_code=403,
                )
            request.state.user = "local"
            request.state.role = "viewer"
            return await call_next(request)

        api_key = request.headers.get("X-API-Key", "")
        if api_key:
            async with async_session_factory() as db:
                user = await db.scalar(select(User).where(User.api_key_hash == _hash_api_key(api_key)))
            if not user:
                return JSONResponse({"detail": "Invalid API key"}, status_code=401)
            cookie_auth = False
        else:
            header = request.headers.get("Authorization", "")
            token = header[7:].strip() if header.startswith("Bearer ") else ""
            cookie_auth = not token
            if not token:
                token = request.cookies.get(_SESSION_COOKIE, "")
            if not token:
                return JSONResponse({"detail": "Not authenticated"}, status_code=401)
            try:
                payload = jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
            except jwt.InvalidTokenError:
                return JSONResponse({"detail": "Invalid or expired token"}, status_code=401)

            username = str(payload.get("sub") or "")
            async with async_session_factory() as db:
                user = await db.scalar(select(User).where(User.username == username))
            if not user or int(payload.get("ver", -1)) != (user.token_version or 0):
                return JSONResponse({"detail": "Session has been revoked"}, status_code=401)

        request.state.user = user.username
        request.state.role = user.role

        if _admin_only(path) and user.role != "admin":
            return JSONResponse({"detail": "Admin role required"}, status_code=403)

        if request.method in _MUTATING_METHODS and path not in _AUTH_WRITE_EXEMPT:
            if user.role != "admin":
                return JSONResponse({"detail": "Admin role required"}, status_code=403)
            # Bearer tokens/API keys are not ambient browser credentials. For
            # the HttpOnly cookie, require a non-simple header so cross-site
            # forms cannot perform authenticated mutations.
            if cookie_auth and request.headers.get("X-Vertex-Request") != "1":
                return JSONResponse({"detail": "CSRF check failed"}, status_code=403)

        return await call_next(request)
