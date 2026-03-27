"""
backend/app/utils/admin_auth.py

Authentication helpers for the admin subsystem.
COMPLETELY SEPARATE from app.utils.auth — different secret key env var,
different OAuth2 scheme, different token URL.
Never import from app.utils.auth in admin code.
"""

import os
from datetime import datetime, timedelta
from typing import Optional

import pyotp
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from passlib.context import CryptContext
from sqlalchemy.orm import Session

from app.models.admin_models import Admin
from app.utils.database import get_db

# ── Config ────────────────────────────────────────────────────────────────────
# Use a DIFFERENT secret from the user JWT secret
ADMIN_SECRET_KEY = os.getenv(
    "ADMIN_SECRET_KEY",
    "admin-change-me-in-production-use-a-different-long-random-string",
)
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 480       # 8 hours for admin sessions
PRE_AUTH_TOKEN_EXPIRE_MINUTES = 5       # Short-lived: issued after password, before TOTP

# ── Password hashing ──────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── OAuth2 scheme — separate token URL, separate scheme object ────────────────
# This ensures FastAPI's dependency injection never confuses user vs admin tokens.
admin_oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/admin/auth/login")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_token(data: dict, expires_minutes: int) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=expires_minutes)
    to_encode.update({"exp": expire})
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    return jwt.encode(to_encode, ADMIN_SECRET_KEY, algorithm=ALGORITHM)


def create_access_token(admin_id: int, role: str) -> str:
    return create_token(
        {"sub": str(admin_id), "role": role, "type": "admin_access"},
        ACCESS_TOKEN_EXPIRE_MINUTES,
    )


def create_pre_auth_token(admin_id: int) -> str:
    """Issued after password check passes, before TOTP is verified."""
    return create_token(
        {"sub": str(admin_id), "type": "admin_pre_auth"},
        PRE_AUTH_TOKEN_EXPIRE_MINUTES,
    )


def _decode_token(token: str) -> dict:
    try:
        return jwt.decode(token, ADMIN_SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate admin credentials",
        )


# ── TOTP helpers ──────────────────────────────────────────────────────────────

def generate_totp_secret() -> str:
    """Generate a new base32 TOTP secret."""
    return pyotp.random_base32()


def get_totp_uri(secret: str, admin_email: str) -> str:
    """Return the otpauth:// URI for QR code generation."""
    return pyotp.totp.TOTP(secret).provisioning_uri(
        name=admin_email,
        issuer_name="MaintenanceGuard Admin",
    )


def verify_totp(secret: str, code: str) -> bool:
    """Verify a 6-digit TOTP code. Allows 1-interval drift."""
    totp = pyotp.TOTP(secret)
    return totp.verify(code, valid_window=1)


# ── FastAPI dependencies ──────────────────────────────────────────────────────

def get_current_admin(
    token: str = Depends(admin_oauth2_scheme),
    db: Session = Depends(get_db),
) -> Admin:
    """
    Dependency: validates admin JWT and returns the Admin ORM object.
    Raises 401 if token is invalid/expired, 403 if TOTP not yet verified.
    """
    payload = _decode_token(token)

    # Reject pre-auth tokens on protected endpoints
    if payload.get("type") != "admin_access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="TOTP verification required",
        )

    admin_id_raw = payload.get("sub")
    try:
        admin_id = int(admin_id_raw)
    except (TypeError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")

    admin = db.query(Admin).filter(Admin.id == admin_id).first()
    if admin is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Admin not found")

    return admin


def require_super_admin(admin: Admin = Depends(get_current_admin)) -> Admin:
    """Dependency: ensures the admin has the super_admin role."""
    if admin.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Super admin role required",
        )
    return admin


def get_client_ip(request: Request) -> str:
    """Extract real client IP, honouring X-Forwarded-For if present."""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"
