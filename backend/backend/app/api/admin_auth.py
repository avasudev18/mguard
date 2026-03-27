"""
backend/app/api/admin_auth.py

Two-step admin authentication (when TOTP is configured):
  Step 1 — POST /api/admin/auth/login      → pre_auth_token
  Step 2 — POST /api/admin/auth/verify-totp → access_token

Single-step (when TOTP is NOT configured — totp_secret is NULL):
  POST /api/admin/auth/login → access_token directly

Other endpoints:
  GET  /api/admin/auth/setup-totp   (generate QR URI for TOTP setup)
  GET  /api/admin/auth/me           (return current admin info)
"""

from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.models.admin_models import Admin, AdminAction
from app.models.admin_schemas import (
    AdminLoginRequest,
    AdminTokenResponse,
    AdminTotpVerifyRequest,
    AdminResponse,
    TotpSetupResponse,
)
from app.utils.admin_auth import (
    create_access_token,
    create_pre_auth_token,
    generate_totp_secret,
    get_client_ip,
    get_current_admin,
    get_totp_uri,
    verify_password,
    verify_totp,
    _decode_token,
)
from app.utils.database import get_db

router = APIRouter()


@router.post("/login")
def admin_login(
    body: AdminLoginRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Login endpoint with two behaviours:

    A) totp_secret is NULL (simple mode):
       Returns a full access_token immediately after password check.
       Status: "authenticated"

    B) totp_secret is set (secure mode):
       Returns a short-lived pre_auth_token.
       Client must call /verify-totp to complete login.
       Status: "totp_required"
    """
    admin = db.query(Admin).filter(Admin.email == body.email).first()

    # Consistent timing to prevent user-enumeration
    if admin is None or not verify_password(body.password, admin.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )

    # ── Simple mode: no TOTP configured — issue full token immediately ────────
    if admin.totp_secret is None:
        admin.last_login = datetime.utcnow()
        db.commit()
        db.refresh(admin)

        access_token = create_access_token(admin.id, admin.role)
        return {
            "status": "authenticated",
            "access_token": access_token,
            "token_type": "bearer",
            "admin": AdminResponse.model_validate(admin).model_dump(),
        }

    # ── Secure mode: TOTP configured — issue pre-auth token ──────────────────
    pre_auth = create_pre_auth_token(admin.id)
    return {"status": "totp_required", "pre_auth_token": pre_auth}


@router.post("/verify-totp", response_model=AdminTokenResponse)
def verify_totp_endpoint(
    body: AdminTotpVerifyRequest,
    request: Request,
    db: Session = Depends(get_db),
):
    """
    Step 2 of TOTP login: validate pre_auth_token + 6-digit code.
    Returns a full access_token (8 hours).
    Only needed when totp_secret is configured.
    """
    payload = _decode_token(body.pre_auth_token)

    if payload.get("type") != "admin_pre_auth":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid pre-auth token")

    try:
        admin_id = int(payload["sub"])
    except (KeyError, ValueError):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid pre-auth token")

    admin = db.query(Admin).filter(Admin.id == admin_id).first()
    if admin is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Admin not found")

    if admin.totp_secret is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="TOTP not configured for this account. Use /login directly.")

    if not verify_totp(admin.totp_secret, body.totp_code):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid TOTP code")

    admin.last_login = datetime.utcnow()
    db.commit()
    db.refresh(admin)

    access_token = create_access_token(admin.id, admin.role)
    return AdminTokenResponse(
        access_token=access_token,
        token_type="bearer",
        admin=AdminResponse.model_validate(admin),
    )


@router.get("/setup-totp", response_model=TotpSetupResponse)
def setup_totp(
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    """
    Generate a new TOTP secret for the authenticated admin.
    Optional — only needed if you want to add 2FA in the future.
    Overwrites any existing TOTP secret.
    """
    secret = generate_totp_secret()
    admin.totp_secret = secret
    db.commit()

    return TotpSetupResponse(
        totp_uri=get_totp_uri(secret, admin.email),
        secret=secret,
    )


@router.get("/me", response_model=AdminResponse)
def admin_me(admin: Admin = Depends(get_current_admin)):
    """Return the current admin's profile."""
    return admin
