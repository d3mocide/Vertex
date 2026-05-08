from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
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


class CreateUserRequest(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)
    role: str = Field(default="viewer", pattern=r"^(admin|viewer)$")


class UserInfo(BaseModel):
    username: str
    role: str


class UserDetail(BaseModel):
    id: int
    username: str
    role: str
    created_at: str
    last_login: str | None


class UpdateRoleRequest(BaseModel):
    role: str = Field(pattern=r"^(admin|viewer)$")


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_token(username: str, role: str) -> str:
    exp = datetime.now(timezone.utc) + timedelta(hours=settings.auth_token_expire_hours)
    return jwt.encode({"sub": username, "role": role, "exp": exp}, settings.auth_secret_key, algorithm=_ALGORITHM)


async def _user_count(db: AsyncSession) -> int:
    return await db.scalar(select(func.count(User.id))) or 0


def _decode_admin(request: Request) -> dict:
    """Decode JWT and assert admin role; raises HTTPException on failure."""
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.startswith("Bearer ") else ""
    try:
        payload = jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if (payload.get("role") or "viewer") != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin role required")
    return payload


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

    user = User(
        username=body.username,
        password_hash=_pwd.hash(body.password),
        role="admin",
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Setup already complete")
    return Token(access_token=_make_token(body.username, "admin"))


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
    return Token(access_token=_make_token(user.username, user.role))


@router.get("/me", response_model=UserInfo)
async def me(request: Request, db: AsyncSession = Depends(get_db)):
    """Return the username and role of the currently authenticated user."""
    if not settings.auth_enabled:
        return UserInfo(username="local", role="admin")
    header = request.headers.get("Authorization", "")
    token = header[7:].strip() if header.startswith("Bearer ") else ""
    try:
        payload = jwt.decode(token, settings.auth_secret_key, algorithms=[_ALGORITHM])
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    username = payload.get("sub", "")
    role = payload.get("role") or "viewer"
    return UserInfo(username=username, role=role)


@router.post("/users", response_model=UserInfo, status_code=status.HTTP_201_CREATED)
async def create_user(body: CreateUserRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Admin-only: create a new user account (admin or viewer role)."""
    if not settings.auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    _decode_admin(request)
    existing = await db.scalar(select(User).where(User.username == body.username))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Username already exists")
    user = User(
        username=body.username,
        password_hash=_pwd.hash(body.password),
        role=body.role,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    await db.commit()
    return UserInfo(username=user.username, role=user.role)


@router.get("/users", response_model=list[UserDetail])
async def list_users(request: Request, db: AsyncSession = Depends(get_db)):
    """Admin-only: list all user accounts."""
    if not settings.auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    _decode_admin(request)
    rows = await db.scalars(select(User).order_by(User.id))
    return [
        UserDetail(
            id=u.id,
            username=u.username,
            role=u.role,
            created_at=u.created_at.isoformat() if u.created_at else "",
            last_login=u.last_login.isoformat() if u.last_login else None,
        )
        for u in rows
    ]


@router.patch("/users/{user_id}", response_model=UserDetail)
async def update_user_role(user_id: int, body: UpdateRoleRequest, request: Request, db: AsyncSession = Depends(get_db)):
    """Admin-only: change a user's role. Cannot change your own role."""
    if not settings.auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    caller = _decode_admin(request)
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.username == caller.get("sub", ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot change your own role")
    user.role = body.role
    await db.commit()
    return UserDetail(
        id=user.id,
        username=user.username,
        role=user.role,
        created_at=user.created_at.isoformat() if user.created_at else "",
        last_login=user.last_login.isoformat() if user.last_login else None,
    )


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(user_id: int, request: Request, db: AsyncSession = Depends(get_db)):
    """Admin-only: delete a user account. Cannot delete yourself."""
    if not settings.auth_enabled:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND)
    caller = _decode_admin(request)
    user = await db.scalar(select(User).where(User.id == user_id))
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if user.username == caller.get("sub", ""):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Cannot delete yourself")
    await db.delete(user)
    await db.commit()
