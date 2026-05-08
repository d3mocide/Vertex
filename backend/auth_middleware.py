from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import settings

_ALGORITHM = "HS256"
_PUBLIC_PATHS = frozenset({"/health", "/metrics"})
_MUTATING_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})
# Auth routes accessible without an existing token
_AUTH_PUBLIC_PATHS = frozenset({"/api/v1/auth/login", "/api/v1/auth/token", "/api/v1/auth/setup", "/api/v1/auth/status"})
# Auth routes that are mutating but don't require an existing token (login, setup)
_AUTH_WRITE_EXEMPT = frozenset({"/api/v1/auth/token", "/api/v1/auth/setup"})


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.auth_enabled:
            return await call_next(request)

        path = request.url.path
        if path in _PUBLIC_PATHS or path in _AUTH_PUBLIC_PATHS:
            return await call_next(request)

        is_ws = request.scope.get("type") == "websocket"
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

        # Enforce admin role for all mutating requests outside auth routes
        if (
            not is_ws
            and request.method in _MUTATING_METHODS
            and path not in _AUTH_WRITE_EXEMPT
        ):
            role = payload.get("role") or "viewer"
            if role != "admin":
                return JSONResponse({"detail": "Admin role required"}, status_code=403)

        return await call_next(request)
