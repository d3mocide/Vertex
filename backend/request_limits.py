from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse

_MUTATING = frozenset({"POST", "PUT", "PATCH"})


class RequestSizeLimitMiddleware(BaseHTTPMiddleware):
    def __init__(self, app, max_bytes: int = 1024 * 1024):
        super().__init__(app)
        self.max_bytes = max_bytes

    async def dispatch(self, request: Request, call_next):
        if request.method in _MUTATING and request.headers.get("content-type"):
            raw_length = request.headers.get("content-length")
            if raw_length is None:
                return JSONResponse({"detail": "Content-Length required"}, status_code=411)
            try:
                length = int(raw_length)
            except ValueError:
                return JSONResponse({"detail": "Invalid Content-Length"}, status_code=400)
            if length < 0 or length > self.max_bytes:
                return JSONResponse({"detail": "Request body too large"}, status_code=413)
        return await call_next(request)
