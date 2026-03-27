from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from app.utils.database import get_db
from app.models.models import User
import os

# ── Config ────────────────────────────────────────────────────────────────────
SECRET_KEY = os.getenv("SECRET_KEY", "change-me-in-production-use-a-long-random-string")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

# Admin secret — used to verify impersonation tokens (created by admin_auth)
ADMIN_SECRET_KEY = os.getenv(
    "ADMIN_SECRET_KEY",
    "admin-change-me-in-production-use-a-different-long-random-string",
)

# ── Password hashing ──────────────────────────────────────────────────────────
pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

# ── OAuth2 scheme ─────────────────────────────────────────────────────────────
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/token")


def hash_password(plain: str) -> str:
    return pwd_context.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return pwd_context.verify(plain, hashed)


def create_access_token(data: dict, expires_delta: Optional[timedelta] = None) -> str:
    to_encode = data.copy()
    expire = datetime.utcnow() + (expires_delta or timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES))
    to_encode.update({"exp": expire})
    # JWT standard: sub must be a string
    if "sub" in to_encode:
        to_encode["sub"] = str(to_encode["sub"])
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )


def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    # ── Phase 2: check if this is an impersonation token ─────────────────────
    # Impersonation tokens are signed with ADMIN_SECRET_KEY (not SECRET_KEY)
    # and carry type="impersonation". We try to decode with the admin key first.
    try:
        imp_payload = jwt.decode(token, ADMIN_SECRET_KEY, algorithms=[ALGORITHM])
        if imp_payload.get("type") == "impersonation":
            user_id_raw = imp_payload.get("sub")
            try:
                user_id = int(user_id_raw)
            except (TypeError, ValueError):
                user_id = None
            if user_id is None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                    detail="Invalid impersonation token")
            user = db.query(User).filter(User.id == user_id).first()
            if user is None:
                raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                                    detail="Impersonated user not found")
            if user.status == "disabled":
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN,
                                    detail="Impersonated account is disabled")
            # Attach impersonation metadata as a transient attribute
            user._impersonated_by_admin_id = imp_payload.get("impersonated_by_admin_id")
            return user
    except JWTError:
        pass  # Not an impersonation token — fall through to normal auth
    # ─────────────────────────────────────────────────────────────────────────

    payload = decode_access_token(token)
    user_id_raw = payload.get("sub")
    try:
        user_id = int(user_id_raw)
    except (TypeError, ValueError):
        user_id = None
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token payload")
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    if user.status == "disabled":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account is disabled")
    return user


def get_current_active_user(current_user: User = Depends(get_current_user)) -> User:
    return current_user
