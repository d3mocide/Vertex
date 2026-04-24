from jose import JWTError, jwt
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response

from config import settings

_ALGORITHM = "HS256"
_PUBLIC_PATHS = frozenset({"/health", "/metrics"})


class AuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        if not settings.auth_enabled:
            return await call_next(request)

        path = request.url.path
        if path in _PUBLIC_PATHS or path.startswith("/api/v1/auth/"):
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
            jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
        except JWTError:
            return Response(status_code=401) if is_ws else JSONResponse(
                {"detail": "Invalid or expired token"}, status_code=401
            )

        return await call_next(request)
