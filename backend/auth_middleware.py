import hashlib

from jose import JWTError, jwt
from sqlalchemy import select
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import settings
from db.models import User
from db.session import async_session_factory

_ALGORITHM = "HS256"
_PUBLIC_PATHS = frozenset({"/health", "/metrics"})
_PUBLIC_PREFIXES = ("/api/v1/weather/smoke/wms",)
_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
_AUTH_PUBLIC_PATHS = frozenset({"/api/v1/auth/login", "/api/v1/auth/token", "/api/v1/auth/setup", "/api/v1/auth/status"})
_AUTH_WRITE_EXEMPT = frozenset({"/api/v1/auth/token", "/api/v1/auth/setup"})


def _hash_api_key(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.auth_enabled:
            return await call_next(request)

        path = request.url.path
        if (
            path in _PUBLIC_PATHS
            or path in _AUTH_PUBLIC_PATHS
            or any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES)
        ):
            return await call_next(request)

        is_ws = request.scope.get("type") == "websocket"

        # ── X-API-Key authentication ──────────────────────────────────────────
        api_key = request.headers.get("X-API-Key", "")
        if api_key and not is_ws:
            key_hash = _hash_api_key(api_key)
            async with async_session_factory() as db:
                user = await db.scalar(select(User).where(User.api_key_hash == key_hash))
            if not user:
                return JSONResponse({"detail": "Invalid API key"}, status_code=401)
            if request.method in _MUTATING_METHODS and path not in _AUTH_WRITE_EXEMPT:
                if user.role != "admin":
                    return JSONResponse({"detail": "Admin role required"}, status_code=403)
            return await call_next(request)

        # ── JWT authentication ────────────────────────────────────────────────
        if is_ws:
            token = request.query_params.get("token", "")
        else:
            header = request.headers.get("Authorization", "")
            token = header[7:].strip() if header.startswith("Bearer ") else ""

        if not token:
            return Response(status_code=401) if is_ws else JSONResponse(
                {"detail": "Not authenticated"}, status_code=401
            )

        try:
            payload = jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
        except JWTError:
            return Response(status_code=401) if is_ws else JSONResponse(
                {"detail": "Invalid or expired token"}, status_code=401
            )

        if (
            not is_ws
            and request.method in _MUTATING_METHODS
            and path not in _AUTH_WRITE_EXEMPT
        ):
            role = payload.get("role") or "viewer"
            if role != "admin":
                return JSONResponse({"detail": "Admin role required"}, status_code=403)

        return await call_next(request)
