"""
Authentication and authorisation.

Two things worth knowing about the design.

First, the institution comes from the token, never from the URL. A route still
takes a slug for readability, but if the slug does not match the caller's own
institution the request is refused. Without that, any logged-in treasurer
could read another mosque's ledger by editing the address bar.

Second, roles are enforced by dependency rather than by inline checks, so a
route declares the permission it needs and cannot silently forget to check.
"""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone

from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Institution, Role, User

# In production this must come from the environment. The fallback exists so a
# fresh clone runs without configuration, and is deliberately obvious.
SECRET_KEY = os.getenv("AMANAH_SECRET_KEY", "dev-only-change-me-before-deploy")
ALGORITHM = "HS256"
TOKEN_TTL_HOURS = int(os.getenv("AMANAH_TOKEN_TTL_HOURS", "12"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="auth/login")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(user: User) -> str:
    expires = datetime.now(timezone.utc) + timedelta(hours=TOKEN_TTL_HOURS)
    payload = {
        "sub": user.id,
        "inst": user.institution_id,
        "role": user.role.value,
        "name": user.name,
        "exp": expires,
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def authenticate(db: Session, email: str, password: str) -> User | None:
    user = db.scalars(select(User).where(User.email == email)).first()
    if user is None or not user.active or not user.password_hash:
        return None
    if not verify_password(password, user.password_hash):
        return None
    return user


# ------------------------------------------------------------- dependencies


def get_current_user(token: str = Depends(oauth2_scheme), db: Session = None) -> User:
    """Resolve the caller from their token. Wired up in main.py with the db."""

    credentials_error = HTTPException(
        status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise credentials_error

    user_id = payload.get("sub")
    if not user_id:
        raise credentials_error

    user = db.get(User, user_id)
    if user is None or not user.active:
        raise credentials_error
    return user


def require_roles(*allowed: Role):
    """Guard a route behind one or more roles.

    Usage: `user: User = Depends(require_roles(Role.TREASURER, Role.ADMIN))`
    """

    def guard(user: User) -> User:
        if user.role not in allowed:
            raise HTTPException(
                status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "insufficient_role",
                    "message_en": (
                        f"This action needs one of: "
                        f"{', '.join(r.value for r in allowed)}. "
                        f"You are signed in as {user.role.value}."
                    ),
                    "message_ms": "Peranan anda tidak dibenarkan untuk tindakan ini.",
                },
            )
        return user

    return guard


def assert_same_institution(user: User, institution: Institution) -> None:
    """Tenant isolation.

    The slug in the URL is for readability. This is the check that actually
    decides what a caller may see.
    """

    if user.institution_id != institution.id:
        # 404 rather than 403 on purpose: a wrong-institution request should
        # not confirm that the other institution exists.
        raise HTTPException(
            status.HTTP_404_NOT_FOUND,
            detail=f"No institution with slug '{institution.slug}'",
        )
