"""
backend/app/api/admin.py

All admin management endpoints:

  GET    /api/admin/metrics/overview
  GET    /api/admin/metrics/costs
  GET    /api/admin/users
  GET    /api/admin/users/{user_id}
  POST   /api/admin/users/{user_id}/disable
  POST   /api/admin/users/{user_id}/enable
  DELETE /api/admin/users/{user_id}
  GET    /api/admin/audit-log

  ── Admin account management (super_admin only) ──
  GET    /api/admin/admins
  POST   /api/admin/admins
  PATCH  /api/admin/admins/{admin_id}
  DELETE /api/admin/admins/{admin_id}

Zero-regression rules honoured:
  - Queries app_users table (not "users")
  - dispute_resolutions FK is RESTRICT — catches IntegrityError → 409
  - No N+1: vehicle/invoice counts use subqueries
  - Never imports from app.utils.auth
"""

from datetime import datetime, timedelta, date
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models.admin_models import Admin, AdminAction, DailyMetrics
from app.models.admin_schemas import (
    AdminListItem,
    AdminListResponse,
    AdminUserDetail,
    AdminUserListItem,
    AdminUserListResponse,
    AuditLogItem,
    AuditLogResponse,
    CostMetricsResponse,
    CreateAdminRequest,
    DailyCostPoint,
    DeleteAdminRequest,
    DeleteUserRequest,
    DisableUserRequest,
    EnableUserRequest,
    OverviewMetrics,
    UpdateAdminRequest,
)
from app.models.models import Invoice, ServiceRecord, User, Vehicle
from app.utils.admin_auth import (
    generate_totp_secret,
    get_client_ip,
    get_current_admin,
    hash_password,
    require_super_admin,
)
from app.utils.database import get_db

router = APIRouter()


# ── Helpers ───────────────────────────────────────────────────────────────────

def _get_user_or_404(user_id: int, db: Session) -> User:
    user = db.query(User).filter(User.id == user_id).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    return user


def _get_admin_or_404(admin_id: int, db: Session) -> Admin:
    adm = db.query(Admin).filter(Admin.id == admin_id).first()
    if adm is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Admin not found")
    return adm


def _log_action(
    db: Session,
    admin: Admin,
    action_type: str,
    target_user_id: Optional[int],
    reason: Optional[str],
    ip: str,
) -> None:
    entry = AdminAction(
        admin_id=admin.id,
        action_type=action_type,
        target_user_id=target_user_id,
        reason=reason,
        ip_address=ip,
    )
    db.add(entry)


def _build_user_list_item(user: User, vehicle_count: int, invoice_count: int) -> AdminUserListItem:
    return AdminUserListItem(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        subscription_tier=user.subscription_tier,
        status=user.status,
        vehicle_count=vehicle_count,
        invoice_count=invoice_count,
        last_active_at=user.last_active_at,
        created_at=user.created_at,
        disabled_at=getattr(user, "disabled_at", None),
        disabled_reason=getattr(user, "disabled_reason", None),
    )


# ── Metrics ───────────────────────────────────────────────────────────────────

@router.get("/metrics/overview", response_model=OverviewMetrics)
def metrics_overview(
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    total_users    = db.query(func.count(User.id)).scalar() or 0
    active_users   = db.query(func.count(User.id)).filter(User.status == "active").scalar() or 0
    premium_users  = db.query(func.count(User.id)).filter(User.subscription_tier == "premium").scalar() or 0
    free_users     = db.query(func.count(User.id)).filter(User.subscription_tier == "free").scalar() or 0
    disabled_users = db.query(func.count(User.id)).filter(User.status == "disabled").scalar() or 0
    total_vehicles = db.query(func.count(Vehicle.id)).scalar() or 0
    total_invoices = db.query(func.count(Invoice.id)).scalar() or 0
    total_recs     = db.query(func.count(ServiceRecord.id)).scalar() or 0

    return OverviewMetrics(
        total_users=total_users,
        active_users=active_users,
        premium_users=premium_users,
        free_users=free_users,
        disabled_users=disabled_users,
        total_vehicles=total_vehicles,
        total_invoices=total_invoices,
        total_recommendations=total_recs,
    )


@router.get("/metrics/costs", response_model=CostMetricsResponse)
def metrics_costs(
    period: str = Query("30d", regex="^(7d|30d|90d)$"),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    days = {"7d": 7, "30d": 30, "90d": 90}[period]
    cutoff = datetime.utcnow() - timedelta(days=days)

    rows = (
        db.query(DailyMetrics)
        .filter(DailyMetrics.metric_date >= cutoff.strftime("%Y-%m-%d"))
        .order_by(DailyMetrics.metric_date)
        .all()
    )

    total_cost = sum(float(r.total_ai_cost_usd or 0) for r in rows)
    active_users = 1
    if rows:
        last = rows[-1]
        active_users = max(last.active_users or 1, 1)

    daily = [
        DailyCostPoint(
            date=str(r.metric_date),
            total_tokens=r.total_tokens_consumed or 0,
            estimated_cost_usd=float(r.total_ai_cost_usd or 0),
        )
        for r in rows
    ]

    return CostMetricsResponse(
        period_days=days,
        total_cost_usd=round(total_cost, 2),
        cost_per_active_user=round(total_cost / active_users, 4),
        daily_breakdown=daily,
    )


# ── User management ───────────────────────────────────────────────────────────

@router.get("/users", response_model=AdminUserListResponse)
def list_users(
    search: Optional[str] = Query(None, max_length=255),
    status_filter: Optional[str] = Query(None, alias="status"),
    tier_filter: Optional[str] = Query(None, alias="tier"),
    page: int = Query(1, ge=1),
    per_page: int = Query(25, ge=1, le=100),
    # Phase 2: date filters
    created_after:     Optional[date] = Query(None),
    created_before:    Optional[date] = Query(None),
    last_active_after: Optional[date] = Query(None),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    vehicle_sq = (
        select(Vehicle.owner_id, func.count(Vehicle.id).label("cnt"))
        .group_by(Vehicle.owner_id)
        .subquery()
    )
    invoice_sq = (
        select(Vehicle.owner_id, func.count(Invoice.id).label("cnt"))
        .join(Invoice, Invoice.vehicle_id == Vehicle.id)
        .group_by(Vehicle.owner_id)
        .subquery()
    )

    q = (
        db.query(
            User,
            func.coalesce(vehicle_sq.c.cnt, 0).label("vehicle_count"),
            func.coalesce(invoice_sq.c.cnt, 0).label("invoice_count"),
        )
        .outerjoin(vehicle_sq, vehicle_sq.c.owner_id == User.id)
        .outerjoin(invoice_sq, invoice_sq.c.owner_id == User.id)
    )

    if search:
        pattern = f"%{search}%"
        q = q.filter((User.email.ilike(pattern)) | (User.full_name.ilike(pattern)))
    if status_filter:
        q = q.filter(User.status == status_filter)
    if tier_filter:
        q = q.filter(User.subscription_tier == tier_filter)
    if created_after:
        q = q.filter(User.created_at >= created_after)
    if created_before:
        q = q.filter(User.created_at < created_before + timedelta(days=1))
    if last_active_after:
        q = q.filter(User.last_active_at >= last_active_after)

    total = q.count()
    rows = q.order_by(User.id.desc()).offset((page - 1) * per_page).limit(per_page).all()

    users = [_build_user_list_item(u, vc, ic) for u, vc, ic in rows]
    return AdminUserListResponse(users=users, total=total, page=page, per_page=per_page)


@router.get("/users/{user_id}", response_model=AdminUserDetail)
def get_user(
    user_id: int,
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(user_id, db)
    vehicle_count = db.query(func.count(Vehicle.id)).filter(Vehicle.owner_id == user_id).scalar() or 0
    invoice_count = (
        db.query(func.count(Invoice.id))
        .join(Vehicle, Invoice.vehicle_id == Vehicle.id)
        .filter(Vehicle.owner_id == user_id)
        .scalar() or 0
    )
    return _build_user_list_item(user, vehicle_count, invoice_count)


@router.post("/users/{user_id}/disable", status_code=status.HTTP_200_OK)
def disable_user(
    user_id: int,
    body: DisableUserRequest,
    request: Request,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(user_id, db)
    if user.status == "disabled":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already disabled")

    user.status = "disabled"
    user.disabled_at = datetime.utcnow()
    user.disabled_by_admin_id = admin.id
    user.disabled_reason = body.reason

    _log_action(db, admin, "disable_user", user_id, body.reason, get_client_ip(request))
    db.commit()
    return {"message": f"User {user.email} disabled successfully"}


@router.post("/users/{user_id}/enable", status_code=status.HTTP_200_OK)
def enable_user(
    user_id: int,
    body: EnableUserRequest,
    request: Request,
    admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    user = _get_user_or_404(user_id, db)
    if user.status == "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="User is already active")

    user.status = "active"
    user.enabled_at = datetime.utcnow()
    user.enabled_by_admin_id = admin.id
    user.disabled_reason = None
    user.disabled_at = None

    _log_action(db, admin, "enable_user", user_id, body.reason, get_client_ip(request))
    db.commit()
    return {"message": f"User {user.email} enabled successfully"}


@router.delete("/users/{user_id}", status_code=status.HTTP_200_OK)
def delete_user(
    user_id: int,
    body: DeleteUserRequest,
    request: Request,
    admin: Admin = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    if body.confirm_text != "DELETE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='confirm_text must equal the string "DELETE"',
        )

    user = _get_user_or_404(user_id, db)
    email = user.email

    _log_action(db, admin, "delete_user", user_id, f"Hard delete of {email}", get_client_ip(request))

    try:
        db.delete(user)
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Cannot delete this user: they have dispute resolution records "
                "which must be preserved for compliance. Disable the account instead."
            ),
        )

    return {"message": f"User {email} permanently deleted"}


# ── Audit log ────────────────────────────────────────────────────────────────

@router.get("/audit-log", response_model=AuditLogResponse)
def audit_log(
    page: int = Query(1, ge=1),
    per_page: int = Query(50, ge=1, le=200),
    _admin: Admin = Depends(get_current_admin),
    db: Session = Depends(get_db),
):
    total = db.query(func.count(AdminAction.id)).scalar() or 0
    rows = (
        db.query(AdminAction, Admin, User)
        .join(Admin, AdminAction.admin_id == Admin.id)
        .outerjoin(User, AdminAction.target_user_id == User.id)
        .order_by(AdminAction.timestamp.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
        .all()
    )

    items = [
        AuditLogItem(
            id=action.id,
            admin_id=action.admin_id,
            admin_email=adm.email,
            action_type=action.action_type,
            target_user_id=action.target_user_id,
            target_user_email=user.email if user else None,
            reason=action.reason,
            timestamp=action.timestamp,
            ip_address=action.ip_address,
        )
        for action, adm, user in rows
    ]

    return AuditLogResponse(actions=items, total=total)


# ── Admin account management (super_admin only) ───────────────────────────────

@router.get("/admins", response_model=AdminListResponse)
def list_admins(
    admin: Admin = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """List all admin accounts. super_admin only."""
    admins = db.query(Admin).order_by(Admin.created_at).all()
    return AdminListResponse(
        admins=[AdminListItem.model_validate(a) for a in admins],
        total=len(admins),
    )


@router.post("/admins", response_model=AdminListItem, status_code=status.HTTP_201_CREATED)
def create_admin(
    body: CreateAdminRequest,
    request: Request,
    admin: Admin = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """
    Create a new admin account.
    The new admin's TOTP is not set up yet — they must call
    GET /api/admin/auth/setup-totp on their first login.
    super_admin only.
    """
    existing = db.query(Admin).filter(Admin.email == body.email).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"An admin with email '{body.email}' already exists",
        )

    new_admin = Admin(
        email=body.email,
        password_hash=hash_password(body.password),
        role=body.role,
        totp_secret=None,   # Set on first login via setup-totp
    )
    db.add(new_admin)

    # Audit log — reuse action log with action_type 'create_admin'
    entry = AdminAction(
        admin_id=admin.id,
        action_type="create_admin",
        target_user_id=None,
        reason=f"Created admin account: {body.email} ({body.role})",
        ip_address=get_client_ip(request),
    )
    db.add(entry)
    db.commit()
    db.refresh(new_admin)

    return AdminListItem.model_validate(new_admin)


@router.patch("/admins/{admin_id}", response_model=AdminListItem)
def update_admin(
    admin_id: int,
    body: UpdateAdminRequest,
    request: Request,
    admin: Admin = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """
    Update role and/or password for an admin account.
    super_admin only. An admin cannot demote themselves.
    """
    target = _get_admin_or_404(admin_id, db)

    # Prevent self-demotion
    if target.id == admin.id and body.role and body.role != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot change your own role",
        )

    changes = []
    if body.role is not None:
        target.role = body.role
        changes.append(f"role → {body.role}")
    if body.password is not None:
        target.password_hash = hash_password(body.password)
        changes.append("password updated")

    if not changes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No changes provided")

    entry = AdminAction(
        admin_id=admin.id,
        action_type="update_admin",
        target_user_id=None,
        reason=f"Updated admin #{admin_id}: {', '.join(changes)}",
        ip_address=get_client_ip(request),
    )
    db.add(entry)
    db.commit()
    db.refresh(target)

    return AdminListItem.model_validate(target)


@router.delete("/admins/{admin_id}", status_code=status.HTTP_200_OK)
def delete_admin(
    admin_id: int,
    body: DeleteAdminRequest,
    request: Request,
    admin: Admin = Depends(require_super_admin),
    db: Session = Depends(get_db),
):
    """
    Delete an admin account. super_admin only.
    An admin cannot delete themselves.
    Requires typing "DELETE" as confirmation.
    """
    if body.confirm_text != "DELETE":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail='confirm_text must equal the string "DELETE"',
        )

    target = _get_admin_or_404(admin_id, db)

    if target.id == admin.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="You cannot delete your own admin account",
        )

    email = target.email
    entry = AdminAction(
        admin_id=admin.id,
        action_type="delete_admin",
        target_user_id=None,
        reason=f"Deleted admin account: {email}",
        ip_address=get_client_ip(request),
    )
    db.add(entry)
    db.delete(target)
    db.commit()

    return {"message": f"Admin {email} deleted successfully"}
