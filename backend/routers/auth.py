from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from config import settings
from db.models import User
from deps import get_db

router = APIRouter(prefix="/auth", tags=["auth"])

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_ALGORITHM = "HS256"


# ── Schemas ───────────────────────────────────────────────────────────────────

class Token(BaseModel):
    access_token: str
    token_type: str = "bearer"


class AuthStatus(BaseModel):
    auth_enabled: bool
    setup_required: bool


class SetupRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_token(username: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.auth_token_expire_hours)
    return jwt.encode({"sub": username, "exp": exp}, settings.auth_secret_key, algorithm=_ALGORITHM)


async def _user_count(db: AsyncSession) -> int:
    return await db.scalar(select(func.count(User.id))) or 0


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/status", response_model=AuthStatus)
async def auth_status(db: AsyncSession = Depends(get_db)):
    if not settings.auth_enabled:
        return AuthStatus(auth_enabled=False, setup_required=False)
    return AuthStatus(auth_enabled=True, setup_required=await _user_count(db) == 0)


@router.post("/setup", response_model=Token, status_code=status.HTTP_201_CREATED)
async def setup(body: SetupRequest, db: AsyncSession = Depends(get_db)):
    """Create the first admin account. Returns a JWT so the caller is immediately logged in.
    Responds 409 once any user exists — setup cannot be repeated."""
    if not settings.auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    if await _user_count(db) > 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Setup already complete")

    user = User(
        username=body.username,
        password_hash=_pwd.hash(body.password),
        role="admin",
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    return Token(access_token=_make_token(body.username))


@router.post("/token", response_model=Token)
async def login(form: OAuth2PasswordRequestForm = Depends(), db: AsyncSession = Depends(get_db)):
    if not settings.auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)

    invalid = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Incorrect username or password",
        headers={"WWW-Authenticate": "Bearer"},
    )

    user = await db.scalar(select(User).where(User.username == form.username))
    if not user or not _pwd.verify(form.password, user.password_hash):
        raise invalid

    user.last_login = datetime.now(timezone.utc)
    await db.commit()
    return Token(access_token=_make_token(user.username))
