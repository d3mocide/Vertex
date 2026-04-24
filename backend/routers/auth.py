from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from passlib.context import CryptContext
from pydantic import BaseModel

from config import settings

router = APIRouter(prefix="/auth", tags=["auth"])

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_ALGORITHM = "HS256"


class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuthStatus(BaseModel):
    auth_enabled: bool


@router.get("/status", response_model=AuthStatus)
async def auth_status():
    return AuthStatus(auth_enabled=settings.auth_enabled)


@router.post("/token", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    if not settings.auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

    if form.username != settings.auth_username:
        raise invalid
    if not settings.auth_password_hash or not _pwd.verify(form.password, settings.auth_password_hash):
        raise invalid

    exp = datetime.now(timezone.utc) + timedelta(hours=settings.auth_token_expire_hours)
    token = jwt.encode(
        {"sub": form.username, "exp": exp},
        settings.auth_secret_key,
        algorithm=_ALGORITHM,
    )
    return Token(access_token=token)
